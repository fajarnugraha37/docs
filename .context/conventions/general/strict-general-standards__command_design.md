# Strict General Standards: Command Design

> This document is a mandatory implementation standard for LLM/code agents designing, modifying, reviewing, or generating commands, command handlers, write APIs, command messages, application services, use cases, workflows, or mutation requests.

---

## 1. Purpose

Command design is about representing a request to perform an action in a way that is explicit, authorized, validated, idempotent, transactional, observable, and safe under retries and concurrency.

An LLM/code agent MUST treat commands as business intent entering a consistency boundary, not as thin wrappers around CRUD operations.

The goal is to ensure that every generated command:

- has clear intent;
- targets one owner;
- validates preconditions;
- enforces authorization;
- preserves invariants;
- behaves safely under retries;
- produces auditable outcomes;
- emits appropriate events only after committed state change.

---

## 2. Scope

This standard applies to:

- command objects;
- command handlers;
- application services;
- write-side APIs;
- CQRS write models;
- state transition requests;
- async commands;
- long-running operations;
- command messages over queues/brokers;
- transactional command processing;
- idempotency keys;
- validation and authorization around mutations;
- command result models;
- command-to-event flows;
- command tests and failure modeling.

This standard does not define event design. Use `strict-general-standards__event_design.md` for facts that already happened.

---

## 3. Mandatory Language

The terms below are normative:

- **MUST**: required.
- **MUST NOT**: prohibited.
- **SHOULD**: recommended unless there is documented justification.
- **MAY**: optional, but must not violate mandatory rules.

---

## 4. Core Principle

> A command MUST express a specific business intent to change system state, not a database operation, UI action, transport detail, or vague update request.

Good command names:

```text
SubmitCase
AssignCaseOfficer
ApproveLicenceApplication
RejectPayment
ScheduleInspection
CancelAppointment
```

Bad command names:

```text
UpdateCase
SaveData
HandleRequest
ProcessPayload
PatchEntity
DoAction
```

A valid command sentence should read naturally as:

```text
"Please do this: <command name>."
```

If the sentence reads like a fact that already happened, the design probably needs an event.

---

## 5. Command vs Event vs Query Boundary

LLM/code agents MUST classify every message before implementation.

| Message type | Meaning                   | Time orientation | Expected receiver              | Return value             |
| ------------ | ------------------------- | ---------------: | ------------------------------ | ------------------------ |
| Command      | Request to perform action |           Future | One logical owner              | Accepted/rejected/result |
| Event        | Fact that happened        |             Past | Zero, one, or many subscribers | No direct return         |
| Query        | Request for data          |     Present/past | Read model/service             | Data response            |

### Required Decision Rule

Use a command when:

- a caller asks the system to do something;
- validation or authorization may reject the request;
- exactly one logical owner should decide the outcome;
- the caller needs acceptance, rejection, or operation tracking;
- business invariants must be checked before mutation.

Use an event when:

- a committed fact is being announced;
- consumers are unknown or multiple;
- no direct response is expected from consumers.

Use a query when:

- no mutation should occur.

---

## 6. Command Ownership

Every command MUST have one owning boundary:

- one aggregate;
- one application service;
- one bounded context;
- one microservice;
- one workflow owner.

The owner is responsible for:

- validation;
- authorization;
- invariant enforcement;
- transaction boundary;
- idempotency behavior;
- emitted events;
- audit logging;
- error semantics;
- command versioning where applicable.

A command MUST NOT update state owned by multiple services directly.

---

## 7. Command Naming Rules

Command names MUST:

- be imperative verb phrases;
- describe business intent;
- target a meaningful domain operation;
- avoid transport names;
- avoid UI widget names;
- avoid generic CRUD wording when intent is richer than CRUD.

Good:

```text
SubmitCase
WithdrawApplication
ChangeCasePriority
AssignInspector
RecordPaymentFailure
```

Bad:

```text
PostCase
ButtonSubmitClicked
UpdateRow
KafkaCommand
SaveCaseDto
```

### 7.1 CRUD Commands

CRUD-style commands MAY be acceptable for simple master data or admin configuration.

Even then, they MUST be explicit:

```text
CreateProductCategory
RenameProductCategory
DeactivateProductCategory
```

Avoid vague commands:

```text
UpdateProductCategory
```

unless the field set is intentionally generic and invariants are simple.

---

## 8. Command Shape

A command MUST contain only data needed to decide and execute the requested action.

Recommended structure:

```json
{
  "commandId": "01J...",
  "commandType": "SubmitCase",
  "targetId": "CASE-123",
  "expectedVersion": 6,
  "requestedBy": "user-456",
  "requestedAt": "2026-06-10T09:00:00Z",
  "idempotencyKey": "client-key-123",
  "reason": "Applicant submitted completed form",
  "payload": {}
}
```

### 8.1 Required Fields

Most commands SHOULD include:

- command ID;
- command type;
- actor/subject;
- target resource or aggregate ID;
- request timestamp;
- idempotency key for externally retried commands;
- expected version for concurrency-sensitive updates;
- payload;
- correlation ID or trace context.

### 8.2 Prohibited Fields

Commands MUST NOT include:

- server-trusted role flags from client;
- raw access tokens in payload;
- passwords except in authentication-specific commands with strict handling;
- ORM entity snapshots;
- fields the caller is not authorized to set;
- server-computed fields unless explicitly part of a trusted internal command.

---

## 9. Validation Rules

Validation MUST be layered.

### 9.1 Structural Validation

Structural validation checks whether command data is well-formed.

Examples:

- required fields;
- string length;
- number range;
- enum membership;
- date format;
- payload schema.

### 9.2 Semantic Validation

Semantic validation checks business meaning.

Examples:

- due date must be after submission date;
- case can be submitted only from DRAFT;
- officer must belong to allowed unit;
- payment amount must match invoice balance.

### 9.3 Invariant Enforcement

Business invariants MUST be enforced inside the owner boundary and protected by transaction/concurrency controls.

Client-side validation is never sufficient.

API-level validation is never sufficient if another internal caller can bypass it.

### 9.4 Validation Error Model

Validation errors SHOULD be machine-readable.

Example:

```json
{
  "type": "https://errors.example.com/validation-error",
  "title": "Validation failed",
  "status": 400,
  "errors": [
    {
      "field": "inspectionDate",
      "code": "MUST_BE_FUTURE_DATE"
    }
  ]
}
```

---

## 10. Authorization Rules

Every command MUST enforce authorization before mutation.

Authorization MUST be based on:

- subject;
- action;
- resource;
- context;
- tenant;
- state;
- ownership/delegation where applicable.

Example:

```text
Subject: user-456
Action: case.submit
Resource: case/CASE-123
Context: tenant=T1, state=DRAFT, channel=PORTAL
```

### 10.1 Object-Level Authorization

Commands that target resources MUST verify access to the specific object, not only the endpoint or role.

Bad:

```text
Role CASE_OFFICER can assign any case.
```

Good:

```text
Role CASE_OFFICER can assign cases within permitted unit, tenant, status, and conflict-of-interest constraints.
```

### 10.2 Authorization Timing

Authorization MUST be checked:

- before expensive work;
- again at state transition if state or ownership may change concurrently;
- inside the service/domain boundary, not only at gateway or frontend.

---

## 11. Idempotency Rules

Externally retried commands MUST be idempotent or explicitly marked non-idempotent with safeguards.

### 11.1 Idempotency Key

Commands received over HTTP, queues, or unreliable networks SHOULD require an idempotency key for non-safe operations.

The idempotency record SHOULD store:

- idempotency key;
- caller identity;
- command type;
- request hash;
- result/status;
- created time;
- expiry time;
- target resource.

### 11.2 Same Key, Different Payload

If the same idempotency key is reused with a different request hash, the system MUST reject it as a conflict.

### 11.3 Idempotent Outcome

For a repeated identical command, the system SHOULD return the original result or current operation status.

Bad:

```text
Retry SubmitCase creates duplicate submissions.
```

Good:

```text
Retry SubmitCase returns existing accepted submission result.
```

---

## 12. Concurrency Rules

Commands that modify existing state MUST define concurrency behavior.

Allowed approaches:

- optimistic locking with expected version;
- pessimistic lock when contention is high and duration is short;
- unique constraints for natural uniqueness;
- compare-and-set state transition;
- serializable transaction for strong invariants;
- saga/workflow for cross-service consistency.

### 12.1 Expected Version

For aggregate commands, expected version SHOULD be used when stale writes are possible.

Example:

```json
{
  "caseId": "CASE-123",
  "expectedVersion": 6
}
```

If current version is not 6, reject with conflict.

### 12.2 Lost Update Prevention

Commands MUST NOT overwrite state blindly.

Bad:

```sql
UPDATE case SET status = 'SUBMITTED' WHERE id = :id;
```

Good:

```sql
UPDATE case
SET status = 'SUBMITTED', version = version + 1
WHERE id = :id
  AND status = 'DRAFT'
  AND version = :expectedVersion;
```

---

## 13. Transaction Boundary Rules

A command handler MUST define one clear transaction boundary for local state mutation.

Within one transaction, it MAY:

- load required current state;
- validate invariant;
- update aggregate state;
- insert audit record;
- insert outbox events;
- persist idempotency result.

A command transaction MUST NOT:

- wait for user input;
- perform slow network calls without justification;
- call multiple remote services as part of a local DB transaction;
- publish broker events as an unsafe dual-write;
- hold locks during large file processing.

---

## 14. Command Handler Rules

A command handler MUST be deterministic with respect to current state and command input, except for explicitly injected time/ID providers and external dependencies.

Recommended command handler flow:

```text
1. Parse command.
2. Validate structure.
3. Authenticate caller context.
4. Authorize action on resource.
5. Load current state.
6. Validate semantic preconditions.
7. Check idempotency/concurrency.
8. Execute domain behavior.
9. Persist state, audit, outbox in one transaction.
10. Return result or accepted operation reference.
```

### 14.1 Thin vs Fat Handler

Command handlers SHOULD orchestrate. Domain logic SHOULD live in domain model/domain service/application policy where appropriate.

Bad:

```text
Controller directly mutates tables and emits events.
```

Good:

```text
Controller maps request -> command.
Command handler enforces use case.
Domain object validates transition.
Repository persists aggregate and outbox.
```

---

## 15. Command Result Rules

Every command MUST define its result semantics.

Allowed result types:

- success with resource representation;
- success with resource ID;
- accepted with operation ID;
- validation rejection;
- authorization rejection;
- conflict;
- not found or concealed not found;
- duplicate/idempotent replay result;
- failure with retry guidance.

### 15.1 Synchronous Command

Use synchronous result when:

- operation completes quickly;
- caller needs immediate decision;
- mutation occurs within one local boundary;
- failure is known immediately.

### 15.2 Asynchronous Command

Use asynchronous command when:

- operation is long-running;
- external systems are involved;
- approval/workflow steps are needed;
- eventual processing is acceptable;
- request should be accepted before completion.

Async commands SHOULD return:

```text
202 Accepted
Location: /operations/{operationId}
Retry-After: <seconds>
```

or equivalent operation-tracking contract.

---

## 16. Command-to-Event Rules

A command MAY produce one or more events after successful state transition.

The emitted events MUST describe facts that happened, not the command itself.

Command:

```text
SubmitCase
```

Events:

```text
CaseSubmitted
CaseStatusChanged
```

Bad event:

```text
SubmitCaseCommandHandled
```

unless this is an internal technical audit event, not a domain integration event.

Events MUST be persisted/published using an outbox or equivalent atomicity mechanism when command state and event publication span different systems.

---

## 17. CQRS Rules

CQRS MUST NOT be introduced by default.

It MAY be used when:

- write model and read model have substantially different shapes;
- read scaling needs differ from write scaling;
- business commands are richer than CRUD;
- audit/event stream/projection needs justify complexity;
- eventual consistency is acceptable and visible to users.

CQRS MUST include:

- explicit command model;
- explicit query/read model;
- projection update flow;
- consistency/lag behavior;
- reconciliation strategy;
- operational monitoring.

If these are not needed, use a simpler CRUD/service model.

---

## 18. State Machine Command Rules

Commands that change lifecycle state MUST specify:

- current allowed states;
- target state;
- transition guard conditions;
- actor permissions;
- side effects;
- emitted events;
- audit fields;
- invalid transition behavior.

Example:

```text
Command: SubmitCase
Allowed from: DRAFT
Target: SUBMITTED
Guards: required documents uploaded, applicant owns case, no validation errors
Event: CaseSubmitted
Invalid: 409 Conflict or domain validation error
```

Commands MUST NOT allow arbitrary status assignment unless the domain explicitly supports administrative correction with audit and authorization.

---

## 19. Workflow and Saga Command Rules

Commands that start or advance long-running workflows MUST separate:

- command acceptance;
- workflow state;
- individual local transactions;
- compensating actions;
- timeout behavior;
- retry behavior;
- user-visible status.

A saga/workflow command MUST NOT pretend to be one ACID transaction across services.

---

## 20. Security Rules

Commands are high-risk because they mutate state.

Every command MUST consider:

- authentication;
- authorization;
- object-level access;
- tenant isolation;
- CSRF when browser cookie credentials are used;
- replay protection;
- idempotency abuse;
- input validation;
- rate limiting;
- audit logging;
- sensitive data minimization.

Commands MUST NOT trust fields supplied by clients for identity, role, tenant, ownership, approval status, or server-side decision flags.

---

## 21. Audit Rules

Commands that affect regulated, financial, security, or lifecycle-critical state MUST create audit records.

Audit records SHOULD include:

- command ID;
- command type;
- actor;
- resource;
- before/after state where appropriate;
- reason code;
- timestamp;
- correlation ID;
- authorization context;
- outcome;
- rejection reason where appropriate.

Audit logs MUST be tamper-resistant according to system requirements.

---

## 22. Observability Rules

Every command handler MUST emit logs/metrics/traces for:

- command received;
- validation failure;
- authorization failure;
- conflict;
- idempotency replay;
- success;
- failure;
- duration;
- emitted events;
- downstream workflow initiation.

Logs MUST include:

- command ID;
- command type;
- correlation ID;
- actor ID where safe;
- resource ID;
- outcome;
- error code.

Logs MUST NOT include secrets or sensitive payload fields.

---

## 23. API Mapping Rules

### 23.1 HTTP Commands

HTTP write endpoints SHOULD map to commands explicitly.

Example:

```http
POST /cases/{caseId}:submit
```

or REST-style transition resource:

```http
POST /cases/{caseId}/submissions
```

Both are acceptable if project API standards allow them and semantics are documented.

### 23.2 Avoid Generic PATCH for Business Transitions

Business transitions SHOULD NOT be hidden behind generic PATCH when they have domain-specific rules.

Bad:

```http
PATCH /cases/{id}
{ "status": "SUBMITTED" }
```

Good:

```http
POST /cases/{id}/submissions
```

or:

```http
POST /cases/{id}:submit
```

### 23.3 Status Code Guidance

Typical command status mapping:

| Outcome                |                           HTTP status |
| ---------------------- | ------------------------------------: |
| Created resource       |                                   201 |
| Completed mutation     |                            200 or 204 |
| Async accepted         |                                   202 |
| Validation error       | 400 or 422 depending project standard |
| Unauthorized           |                                   401 |
| Forbidden              |                                   403 |
| Not found/concealed    |                                   404 |
| Conflict/stale version |                                   409 |
| Rate limited           |                                   429 |

---

## 24. Message-Based Command Rules

Commands sent through a broker MUST still target one logical owner.

Message command envelope SHOULD include:

- command ID;
- command type;
- source;
- target/owner;
- subject/resource;
- timestamp;
- correlation ID;
- reply-to channel if response is required;
- idempotency key;
- payload schema version.

Command messages MUST NOT be broadcast as if every service should decide whether to act.

If many services need to react, emit an event after the owner accepts/executes the command.

---

## 25. Error Handling Rules

Command errors MUST be explicit and stable enough for clients.

Do not expose raw exceptions.

Recommended error categories:

- `VALIDATION_FAILED`;
- `UNAUTHORIZED`;
- `FORBIDDEN`;
- `RESOURCE_NOT_FOUND`;
- `CONFLICT`;
- `INVALID_STATE_TRANSITION`;
- `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`;
- `OPERATION_ALREADY_COMPLETED`;
- `DEPENDENCY_UNAVAILABLE`;
- `RATE_LIMITED`.

Command handlers MUST distinguish business rejection from technical failure.

---

## 26. Testing Requirements

Generated command implementation MUST include tests for:

- valid command success path;
- structural validation failure;
- semantic validation failure;
- unauthorized subject;
- forbidden object access;
- invalid state transition;
- stale expected version;
- duplicate idempotency key same payload;
- duplicate idempotency key different payload;
- transaction rollback;
- outbox event creation;
- audit record creation;
- retry behavior;
- concurrency conflict;
- async operation status where applicable.

State transition commands MUST include transition table tests.

---

## 27. Anti-Patterns

### 27.1 Anemic Update Command

Bad:

```text
UpdateCase(command) sets arbitrary fields from request.
```

This bypasses domain intent and invariants.

### 27.2 Command Without Owner

Bad:

```text
Any service can handle RecalculateEverything.
```

Commands need one logical authority.

### 27.3 Trusting Client Authority Fields

Bad:

```json
{
  "userId": "attacker",
  "role": "ADMIN",
  "tenantId": "victim-tenant"
}
```

Identity and authority must come from trusted context, not arbitrary payload.

### 27.4 Command as Event

Bad:

```text
Publishing SubmitCase to all services and hoping one handles it.
```

This is ambiguous ownership.

### 27.5 Event as Command

Bad:

```text
Consumer receives CaseSubmitted and directly changes producer-owned case state.
```

Events are facts; consumers should update their own state or send commands to owners.

### 27.6 Missing Idempotency

Bad:

```text
POST /payments captures money again on retry.
```

External commands must handle retry safety.

### 27.7 Hidden Cross-Service Transaction

Bad:

```text
Command handler calls three services and assumes all succeed atomically.
```

Use workflow/saga and compensating behavior.

### 27.8 Gateway-Only Authorization

Bad:

```text
API gateway checks role, service blindly performs command.
```

The owner must enforce authorization.

---

## 28. Required LLM Workflow

When asked to design or implement a command, the LLM/code agent MUST follow this sequence:

1. Classify the message as command, event, or query.
2. Name command as imperative business intent.
3. Identify command owner.
4. Identify target aggregate/resource.
5. Define actor and trusted caller context.
6. Define structural validation.
7. Define semantic validation and invariants.
8. Define authorization rule.
9. Define idempotency behavior.
10. Define concurrency control.
11. Define transaction boundary.
12. Define result/error model.
13. Define emitted events after commit.
14. Define audit and observability.
15. Define tests for success, rejection, failure, and retry.

If any item is unknown, document assumptions instead of silently inventing behavior.

---

## 29. Command Design Template

```md
# Command: <ImperativeCommandName>

## Intent

<Business action being requested.>

## Owner

<Service/application/bounded context/aggregate.>

## Actor

<Who can request this command and trusted identity source.>

## Target Resource

<Resource or aggregate affected.>

## Input

<Fields and schema.>

## Structural Validation

<Format, required fields, type/range checks.>

## Semantic Validation

<Business preconditions.>

## Authorization

<Subject-action-resource-context rule.>

## Idempotency

<Key, request hash, replay behavior, expiry.>

## Concurrency

<Expected version/lock/unique constraint/etc.>

## Transaction Boundary

<What is committed atomically.>

## Result

<Success/accepted/rejection/conflict model.>

## Emitted Events

<Past-tense facts emitted after commit.>

## Audit

<Audit fields and retention.>

## Observability

<Logs, metrics, traces.>

## Tests

<Required test cases.>
```

---

## 30. Review Checklist

Before approving command design, verify:

- [ ] Command name is imperative and business meaningful.
- [ ] Command is not a disguised event or query.
- [ ] One owner is defined.
- [ ] Actor identity comes from trusted context.
- [ ] Target resource is explicit.
- [ ] Structural validation exists.
- [ ] Semantic validation exists.
- [ ] Authorization includes object-level checks.
- [ ] Idempotency is defined for retried commands.
- [ ] Concurrency control is defined.
- [ ] Transaction boundary is explicit.
- [ ] Cross-service behavior uses workflow/saga if needed.
- [ ] Result/error semantics are documented.
- [ ] Events emitted after success are past-tense facts.
- [ ] Audit logging exists where required.
- [ ] Observability exists.
- [ ] Tests cover success, rejection, retry, and conflict.

---

## 31. Acceptance Criteria

A command design is acceptable only if:

1. It represents an explicit business intent.
2. It targets one owner/authority.
3. It validates input and business preconditions.
4. It enforces authorization at the owner boundary.
5. It defines retry/idempotency behavior.
6. It defines concurrency behavior.
7. It preserves invariants inside a clear transaction boundary.
8. It has stable result/error semantics.
9. It emits events only after committed state changes.
10. It is auditable and observable.
11. It includes tests for failure modes.

---

## 32. Enforcement Snippet for LLM/Code Agent

```text
Before generating mutation code, model the operation as a Command with imperative business intent.
Every command must have one owner, trusted actor context, target resource, structural validation, semantic validation, authorization, idempotency behavior, concurrency control, transaction boundary, result/error model, audit logging, observability, and tests.
Never implement business transitions as arbitrary field updates.
Never trust client-supplied role, tenant, owner, or approval fields.
Never emit events before the command's state change is committed.
```

---

## 33. References

- Martin Fowler: CQRS: https://martinfowler.com/bliki/CQRS.html
- Azure Architecture Center: CQRS Pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs
- Enterprise Integration Patterns: Command Message: https://www.enterpriseintegrationpatterns.com/patterns/messaging/CommandMessage.html
- Enterprise Integration Patterns: Request-Reply: https://www.enterpriseintegrationpatterns.com/patterns/messaging/RequestReply.html
- Microsoft Azure REST API Guidelines: https://github.com/microsoft/api-guidelines/blob/vNext/azure/Guidelines.md
- Azure Long-Running Operations: https://learn.microsoft.com/en-us/rest/api/fabric/core/long-running-operations
- Microservices.io: Transactional Outbox: https://microservices.io/patterns/data/transactional-outbox.html
- Azure Architecture Center: Saga Pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/saga
- OWASP API Security Top 10: https://owasp.org/API-Security/
