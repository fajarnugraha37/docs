# Strict General Standards: Microservices Pattern

> File: `strict-general-standards__microservices_pattern.md`  
> Category: General Engineering Standard  
> Principle: Microservices Architecture Patterns, Service Autonomy, Distributed Reliability, and Evolutionary Delivery  
> Status: Mandatory for LLM-assisted architecture design, implementation, refactoring, review, documentation, and migration involving microservices

---

## 1. Purpose

This standard defines how an LLM code agent MUST design, implement, modify, review, and document systems that use or propose microservices.

The goal is to prevent shallow “service-per-repository” implementations that look modern but behave as fragile distributed monoliths. A microservice architecture is only acceptable when it improves independent delivery, domain ownership, operational isolation, and evolvability enough to justify distributed-system complexity.

This file defines approved microservices patterns and the conditions under which they MAY or MUST be used. Microservices smells and prohibited designs are defined in `strict-general-standards__microservices_anti_pattern.md`.

---

## 2. Source Baseline

The LLM MUST align microservice work with these baseline references:

- Chris Richardson / Microservices.io pattern language for microservice architecture, database-per-service, saga, API gateway, discovery, observability, testing, and deployment patterns.
- Martin Fowler guidance on microservice prerequisites, monolith-first thinking, and the microservice premium.
- Microsoft Azure Architecture Center microservices patterns and cloud design patterns.
- AWS Prescriptive Guidance cloud design patterns such as strangler fig, saga, circuit breaker, and transactional outbox.
- Domain-Driven Design concepts: bounded context, aggregate, ubiquitous language, context mapping, anti-corruption layer.
- Enterprise project standards for API, OpenAPI, HTTP, security, observability, deployment, data retention, auditability, and incident response.

References are listed at the end of this document.

---

## 3. Core Interpretation

### 3.1 Microservices are an architectural and organizational boundary

The LLM MUST treat a microservice as a unit of:

- domain responsibility;
- runtime ownership;
- data ownership;
- deployment ownership;
- operational accountability;
- security boundary;
- contract evolution;
- failure isolation;
- observability.

A service is not a microservice merely because it has:

- a separate repository;
- a separate container;
- a separate port;
- a separate database connection pool;
- a REST controller;
- a queue consumer;
- a deployment manifest.

A proposed service MUST be justified by a business/domain boundary and independent lifecycle pressure.

### 3.2 Microservices are not the default architecture

The LLM MUST NOT propose microservices by default.

Before introducing or splitting a service, the LLM MUST answer:

1. What business capability or bounded context owns this service?
2. Which team or owner can independently evolve and operate it?
3. What data does it own exclusively?
4. What contract does it expose?
5. What failure mode is isolated by splitting it?
6. What deployment or scaling pressure requires separation?
7. What operational overhead is introduced?
8. What can go wrong because this is now distributed?

If those answers are weak, the LLM MUST prefer a modular monolith, module boundary, package boundary, library boundary, feature module, or internal component instead.

### 3.3 Microservices optimize independent change, not small code size

The LLM MUST NOT split services based on line count, table count, controller count, or superficial “smallness.”

A microservice boundary is justified when it reduces coordination cost for independent change. A small service that cannot be deployed, tested, understood, or operated independently is not a good microservice.

### 3.4 Distribution makes correctness harder

Every microservice implementation MUST assume:

- the network fails;
- remote calls are slow;
- responses can arrive late, duplicated, reordered, or not at all;
- clocks differ;
- retries can duplicate side effects;
- partial failure is normal;
- data consistency is often eventual;
- observability must be explicit;
- cross-service transactions are not local transactions;
- deployments are rolling and version-skewed.

The LLM MUST design for these facts explicitly.

---

## 4. Mandatory Decision Gate Before Using Microservices

Before creating a new microservice or splitting an existing component, the LLM MUST produce a decision record containing:

```md
# Microservice Boundary Decision

## Proposed Service

- Name:
- Business capability:
- Owning team/persona:

## Boundary Justification

- Domain reason:
- Independent change reason:
- Independent deployment reason:
- Independent scaling reason:
- Failure isolation reason:
- Security/compliance reason:

## Owned Data

- Owned aggregates/entities:
- Owned tables/collections/topics/files:
- Read-only external data dependencies:
- Data that must NOT be directly accessed by other services:

## Public Contract

- API/events exposed:
- Consumers:
- Compatibility rules:
- Versioning/deprecation strategy:

## Distributed-System Cost

- New network calls:
- New failure modes:
- Consistency model:
- Required observability:
- Required operational runbooks:

## Alternatives Considered

- Modular monolith:
- Module/package boundary:
- Shared library:
- Existing service extension:
- Reason rejected:
```

If the decision record cannot be completed with concrete facts, the LLM MUST NOT create the service.

---

## 5. Approved Pattern Categories

The LLM MAY use the following pattern categories when the applicability conditions are met:

1. Service decomposition patterns.
2. Data ownership and consistency patterns.
3. Communication patterns.
4. Edge/API composition patterns.
5. Resilience patterns.
6. Observability patterns.
7. Security patterns.
8. Deployment and configuration patterns.
9. Migration patterns.
10. Testing and verification patterns.

The LLM MUST NOT apply patterns as cargo cult. Every pattern use MUST include applicability, trade-off, and operational consequence.

---

## 6. Service Decomposition Patterns

### 6.1 Decompose by business capability

The LLM SHOULD decompose services around stable business capabilities rather than technical layers.

Good candidates:

- licensing application intake;
- case investigation;
- inspection scheduling;
- payment collection;
- notification delivery;
- document generation;
- identity and access management;
- audit event collection.

Bad candidates:

- `UserControllerService`;
- `DatabaseService`;
- `ValidationService` containing all validation for all domains;
- `UtilityService`;
- `CommonService` containing unrelated shared logic;
- one service per database table;
- one service per CRUD screen.

Mandatory rules:

- A service MUST own a business capability, not a technical layer.
- A service MUST expose business operations, not raw table operations.
- A service MUST have a clear reason to change independently.
- A service MUST have a clear owner.

### 6.2 Decompose by bounded context

The LLM SHOULD use bounded contexts when domain language, rules, lifecycle, and data semantics differ.

A bounded context is appropriate when the same word means different things in different parts of the business.

Example:

- `Application` in licensing may mean an application for a licence.
- `Application` in platform engineering may mean a deployed software system.
- `Case` in enforcement may mean investigation workflow.
- `Case` in customer support may mean a helpdesk ticket.

Mandatory rules:

- Each service MUST define its local domain language.
- Shared terms MUST be mapped explicitly at integration boundaries.
- The LLM MUST NOT force a global canonical domain model unless the business actually has one.
- Cross-context translation MUST happen through API contracts, events, or anti-corruption layers.

### 6.3 Decompose by aggregate ownership

The LLM MAY align a service around one or more aggregates that must be transactionally consistent within a local database boundary.

Mandatory rules:

- One aggregate root MUST have one authoritative owner service.
- Invariants requiring immediate consistency SHOULD remain inside one service boundary.
- Cross-aggregate workflows SHOULD use saga, process manager, or domain events.
- The LLM MUST NOT split tightly coupled invariants across services without stating the consistency trade-off.

### 6.4 Team-aligned service boundary

The LLM SHOULD align service boundaries with long-lived team ownership.

Mandatory rules:

- A service without an accountable owner is not production-ready.
- A service owned by “everyone” is treated as ownerless.
- A service that requires synchronized changes from multiple teams for most modifications has a bad boundary.
- The LLM MUST flag unclear ownership as an architectural risk.

### 6.5 Capability map before service map

Before proposing services, the LLM SHOULD produce a capability map:

```md
| Capability         | Business Owner  | Data Owned                     | Change Frequency | Scaling Pressure | Compliance Criticality | Suggested Boundary |
| ------------------ | --------------- | ------------------------------ | ---------------- | ---------------- | ---------------------- | ------------------ |
| Application Intake | Licensing Ops   | Application draft/submission   | High             | Medium           | High                   | Service or module  |
| Case Investigation | Enforcement Ops | Case, allegation, evidence     | High             | Medium           | High                   | Service            |
| Notification       | Platform        | Message template, delivery log | Medium           | High burst       | Medium                 | Service            |
```

Service names MUST follow business capability language.

---

## 7. Database per Service Pattern

### 7.1 Rule

Each microservice MUST own its persistent data. Other services MUST access that data only through the owning service’s published contract.

Permitted ownership models:

- database server per service;
- schema per service;
- table set per service with strict database grants;
- collection namespace per service;
- topic/log ownership per service;
- object-store prefix ownership per service with access policy isolation.

The LLM MUST NOT create direct cross-service table reads as the default solution.

### 7.2 Applicability

Use database-per-service when:

- independent deployability matters;
- data model changes must not break other services;
- services have different scaling/storage needs;
- failure isolation matters;
- team ownership requires clear persistence boundaries.

### 7.3 Required controls

The LLM MUST define:

- owner service for each table/collection/topic/object prefix;
- database credentials scoped to owned data only;
- migration ownership;
- backup/restore ownership;
- retention ownership;
- audit ownership;
- data access path for consumers;
- read model or event strategy for cross-service queries.

### 7.4 Forbidden implementation

```text
Service A --> directly SELECTs tables owned by Service B
Service C --> writes status column in Service B database
Reporting Job --> joins all service databases as if they are one schema
```

Allowed alternative:

```text
Service B owns source data
Service B emits domain events or exposes API
Service C consumes event/API
Service C maintains local read model if needed
Reporting reads from governed warehouse/read replica/event-fed projection
```

### 7.5 Data ownership checklist

For every persisted object, the LLM MUST identify:

- owner service;
- allowed writers;
- allowed readers;
- source of truth;
- replication model;
- consistency expectation;
- retention rule;
- audit requirement;
- PII/security classification.

---

## 8. API Gateway Pattern

### 8.1 Rule

Use an API Gateway when clients need a stable edge entry point, security enforcement, routing, request normalization, protocol translation, or cross-cutting edge controls.

The API Gateway MAY handle:

- routing to backend services;
- authentication enforcement;
- token validation;
- rate limiting;
- request size limits;
- TLS termination;
- coarse-grained authorization delegation;
- correlation ID propagation;
- request/response transformation at the edge;
- protocol bridging;
- client-specific aggregation when intentionally designed.

The API Gateway MUST NOT become a domain logic dumping ground.

### 8.2 Gateway responsibilities

Allowed:

```text
Validate token shape
Reject unauthenticated request
Route /applications/** to application service
Apply request body size limit
Attach correlation ID
Map public path to internal path
```

Not allowed:

```text
Decide whether an enforcement case can be closed
Mutate case workflow state
Perform cross-service business transaction
Contain duplicate domain validation copied from services
Join arbitrary data from many services for every request without ownership
```

### 8.3 Gateway design requirements

The LLM MUST define:

- public route contract;
- owning backend service per route;
- authentication and authorization responsibility split;
- timeout policy;
- retry policy;
- rate limit policy;
- request/response size limit;
- logging and tracing propagation;
- error mapping;
- deprecation strategy.

---

## 9. Backends for Frontends Pattern

### 9.1 Rule

Use BFF when different clients have materially different interaction patterns, latency budgets, payload shapes, security constraints, or release cadence.

Examples:

- public web portal;
- internal officer console;
- mobile app;
- partner API;
- machine-to-machine integration.

### 9.2 Applicability

BFF is appropriate when:

- one generic API forces all clients into poor compromises;
- mobile needs smaller payloads and fewer round trips;
- internal UI needs richer aggregation;
- public clients require different security exposure;
- client teams deploy independently.

### 9.3 Guardrails

The BFF MUST:

- remain client-experience orchestration, not core domain owner;
- delegate domain decisions to backend services;
- avoid duplicating business rules;
- have clear ownership by the client/platform team;
- expose contracts appropriate to one client family;
- use strict timeout, fallback, and observability policy.

The LLM MUST NOT create a BFF merely to avoid designing proper service APIs.

---

## 10. Anti-Corruption Layer Pattern

### 10.1 Rule

Use an anti-corruption layer when integrating with a legacy system, external product, partner API, or service whose domain model must not leak into the new bounded context.

The ACL MUST translate:

- concepts;
- identifiers;
- status/state values;
- error codes;
- temporal semantics;
- units of measure;
- validation differences;
- protocol differences;
- data shape differences.

### 10.2 Mandatory usage

The LLM MUST consider ACL when:

- replacing a monolith incrementally;
- integrating with legacy database schemas;
- consuming third-party APIs;
- handling government/enterprise systems with incompatible code lists;
- working with external identity, payment, address, geospatial, or document services.

### 10.3 Forbidden shortcut

The LLM MUST NOT copy external models directly into core domain entities.

Bad:

```text
Internal case status enum exactly mirrors legacy table codes.
External partner payload is passed throughout domain code.
Legacy database primary key becomes internal aggregate identity everywhere.
```

Good:

```text
Adapter receives external payload.
ACL maps external code to internal domain concept.
Domain logic sees stable local model.
Integration layer stores mapping metadata separately.
```

---

## 11. Strangler Fig Migration Pattern

### 11.1 Rule

Use the strangler fig pattern when migrating from a monolith or legacy system incrementally while reducing business disruption.

Mandatory behavior:

- route selected capabilities to new service;
- keep un-migrated capabilities in legacy system;
- use facade/proxy/routing layer;
- migrate by bounded capability, not arbitrary tables;
- define rollback path;
- retire legacy path after migration is complete.

### 11.2 Migration slice requirements

Every migration slice MUST define:

- capability being migrated;
- users/clients affected;
- data ownership during transition;
- source of truth during transition;
- synchronization approach;
- cutover criteria;
- rollback criteria;
- audit and reconciliation plan;
- operational dashboards;
- legacy decommission condition.

### 11.3 LLM migration rule

The LLM MUST prefer evolutionary migration over big-bang rewrite unless there is a hard external constraint that makes incremental migration impossible.

---

## 12. Communication Patterns

### 12.1 Synchronous request/response

Use synchronous calls only when the caller genuinely needs an immediate answer to continue.

Mandatory controls:

- explicit timeout;
- bounded retry with backoff and jitter when safe;
- circuit breaker for unstable downstream dependencies;
- idempotency key for retryable mutations;
- correlation ID propagation;
- typed error contract;
- fallback or graceful degradation where possible;
- observability of downstream latency and error rate.

The LLM MUST NOT create long chains of synchronous calls for a user request without justifying latency and failure amplification.

### 12.2 Asynchronous messaging

Use asynchronous messaging when:

- work can complete later;
- consumers are independent;
- fan-out is needed;
- temporal decoupling matters;
- producer should not wait for all downstream work;
- eventual consistency is acceptable;
- audit trail/event history is useful.

Mandatory controls:

- event schema ownership;
- durable broker/topic/queue;
- idempotent consumer;
- duplicate handling;
- ordering assumption documented;
- retry and dead-letter policy;
- poison message handling;
- schema compatibility rules;
- correlation/causation IDs;
- monitoring for lag and failure.

### 12.3 Domain event

A domain event MUST represent something meaningful that already happened in the domain.

Good:

```text
ApplicationSubmitted
CaseAssigned
InspectionCompleted
PaymentReceived
LicenceApproved
```

Bad:

```text
DoValidateApplication
CallCaseService
UpdateDatabaseRow
ProcessStep2
```

Mandatory rules:

- Event names MUST be past tense.
- Events MUST not expose internal persistence schema unnecessarily.
- Events MUST carry stable identifiers and business-relevant facts.
- Events MUST have explicit versioning/compatibility policy.
- Consumers MUST not assume producer internals.

### 12.4 Command message

A command represents a request for another component to do something.

Mandatory rules:

- Commands MUST have a clear target owner.
- Commands SHOULD be rejected explicitly if invalid.
- Commands MUST be idempotent or carry idempotency keys.
- Commands MUST not be broadcast as if they were facts.

---

## 13. Saga Pattern

### 13.1 Rule

Use saga when a business process spans multiple services and cannot be implemented as one local ACID transaction.

A saga is a sequence of local transactions coordinated through choreography or orchestration. Each local transaction commits within its service boundary. If a compensable step fails, compensating actions are executed.

### 13.2 Applicability

Use saga when:

- multiple services must participate in a workflow;
- each service owns its own data;
- business process tolerates eventual consistency;
- compensation is meaningful;
- the workflow has clear states and terminal outcomes;
- distributed transaction/two-phase commit is inappropriate.

### 13.3 Required saga model

The LLM MUST define:

```md
## Saga Name

## Business Goal

## Participants

| Step | Service | Local Transaction | Emits/Returns | Compensation | Retryable? |
| ---- | ------- | ----------------- | ------------- | ------------ | ---------- |

## State Machine

- Initial state:
- Intermediate states:
- Terminal success state:
- Terminal failure states:

## Consistency Model

- What is immediately consistent:
- What is eventually consistent:
- Maximum acceptable delay:

## Failure Handling

- Retry policy:
- Compensation policy:
- Manual intervention policy:
- Idempotency keys:
- Correlation IDs:

## Observability

- Metrics:
- Logs:
- Traces:
- Dashboard:
- Alerts:
```

### 13.4 Orchestration vs choreography

Use orchestration when:

- workflow is complex;
- state machine must be explicit;
- operations need auditability;
- compensation logic needs central visibility;
- human intervention is possible;
- business users need process status.

Use choreography when:

- flow is simple;
- participants are loosely coupled;
- event relationships are easy to reason about;
- adding a central orchestrator would overcomplicate the design.

The LLM MUST NOT use choreography for complex compliance workflows if it makes the process invisible and hard to audit.

### 13.5 Saga correctness rules

- Every step MUST be idempotent or deduplicated.
- Every message MUST include correlation ID and saga ID.
- Every terminal state MUST be explicit.
- Compensation MUST be business-valid, not merely technical rollback.
- Irreversible steps MUST be identified as pivot points.
- Retryable steps after pivot MUST be safe to retry.
- Manual remediation MUST be defined for stuck sagas.

---

## 14. Transactional Outbox Pattern

### 14.1 Rule

Use transactional outbox when a service must atomically persist local state and publish a message/event.

The LLM MUST NOT implement dual write as:

```text
1. Save database row
2. Publish event to broker
```

without handling failure between steps.

### 14.2 Required design

Allowed pattern:

```text
1. In one local database transaction:
   - update domain tables
   - insert outbox event row
2. Outbox relay publishes event to broker
3. Consumer processes event idempotently
4. Published events are marked/swept according to retention policy
```

Mandatory fields:

```text
event_id
aggregate_type
aggregate_id
event_type
event_version
payload
headers
correlation_id
causation_id
created_at
published_at or status
retry_count
```

### 14.3 Required controls

- Outbox insert MUST be in the same transaction as domain state change.
- Event IDs MUST be globally unique.
- Relay MUST be restart-safe.
- Publishing MUST tolerate duplicates.
- Consumers MUST be idempotent.
- Failed publishing MUST be observable.
- Retention/archival policy MUST exist.

---

## 15. Idempotent Consumer Pattern

### 15.1 Rule

Every message consumer that causes side effects MUST be idempotent.

The LLM MUST assume messages can be delivered more than once.

### 15.2 Implementation options

Use one or more:

- processed-message table keyed by message ID;
- natural idempotency key;
- unique constraint on business operation ID;
- version check on aggregate;
- compare-and-set update;
- inbox table;
- consumer offset plus transactional processing where supported.

### 15.3 Required behavior

On duplicate message:

- do not repeat side effect;
- return/ack safely;
- log at debug/info, not error, unless duplicate indicates upstream bug;
- preserve metrics for duplicate rate.

---

## 16. CQRS and Read Model Pattern

### 16.1 Rule

Use CQRS/read models when query requirements do not fit cleanly into the write model or when cross-service query composition would create chatty, fragile runtime joins.

### 16.2 Applicability

CQRS/read model is appropriate when:

- UI needs aggregated view from multiple services;
- reporting queries are heavy;
- read shape differs significantly from write shape;
- write-side invariants must remain isolated;
- read latency can tolerate eventual consistency;
- denormalized projection improves stability/performance.

### 16.3 Required documentation

Every read model MUST define:

- source events/APIs;
- projection owner;
- rebuild process;
- staleness expectation;
- consistency warning shown to users if needed;
- reconciliation process;
- schema evolution strategy.

### 16.4 Guardrail

The LLM MUST NOT introduce CQRS just to make CRUD code look sophisticated. CQRS adds operational complexity and MUST have a real query/write separation need.

---

## 17. API Composition Pattern

### 17.1 Rule

Use API composition for simple aggregation where data volume is small, latency budget is acceptable, and eventual consistency through a read model is not necessary.

### 17.2 Required controls

The LLM MUST define:

- maximum number of downstream calls;
- timeout per call;
- total timeout budget;
- partial response behavior;
- fallback behavior;
- caching policy;
- error mapping;
- tracing across all calls.

### 17.3 Warning

If API composition requires many calls per request, nested calls, or repeated joins at runtime, the LLM MUST consider a read model instead.

---

## 18. Resilience Patterns

### 18.1 Timeout

Every remote call MUST have explicit timeouts.

Timeout policy MUST include:

- connection timeout;
- read/request timeout;
- total deadline;
- queue timeout when applicable;
- default value source;
- override mechanism;
- monitoring.

The LLM MUST NOT rely on library default timeouts without verifying them.

### 18.2 Retry with backoff and jitter

Retry is allowed only when the operation is safe to retry.

Mandatory rules:

- Retry MUST be bounded.
- Retry MUST use backoff.
- Retry SHOULD use jitter.
- Retry MUST respect total deadline.
- Mutating operations MUST use idempotency keys or deduplication.
- Retry MUST NOT be layered blindly at client, gateway, service mesh, and SDK simultaneously.

### 18.3 Circuit breaker

Use circuit breaker for synchronous calls to dependencies that can become slow or unavailable.

Mandatory states:

- closed;
- open;
- half-open.

Mandatory metrics:

- failure rate;
- slow call rate;
- open/half-open transitions;
- rejected calls;
- recovery rate.

Mandatory controls:

- fallback or fail-fast behavior;
- alerting when open;
- dashboard per dependency;
- clear threshold configuration;
- no infinite half-open storm.

### 18.4 Bulkhead

Use bulkheads to isolate resource pools between workloads or dependencies.

Examples:

- separate thread pools per downstream dependency;
- separate connection pools per tenant/workload;
- separate consumer groups;
- queue partitioning;
- workload-specific rate limits.

The LLM MUST apply bulkheads when one slow dependency or tenant can exhaust resources for unrelated flows.

### 18.5 Rate limiting and load shedding

Use rate limiting at:

- edge gateway;
- service boundary;
- tenant boundary;
- expensive operation boundary;
- integration boundary.

Use load shedding when continuing to accept work would cause worse failure.

Mandatory behavior:

- return clear error contract;
- preserve priority traffic where required;
- emit metrics;
- avoid retry storms by communicating retry-after semantics when appropriate.

### 18.6 Graceful degradation

When downstream functionality is non-critical, the LLM SHOULD design graceful degradation.

Examples:

- show cached profile while notification service is down;
- accept application submission and process document scan asynchronously;
- defer non-critical audit enrichment while preserving required audit event;
- hide recommendation widget rather than fail entire page.

The LLM MUST NOT degrade legally/compliance-critical behavior silently.

---

## 19. Observability Patterns

### 19.1 Correlation ID

Every external request, internal request, message, batch job, and scheduled task MUST carry a correlation ID.

Required IDs:

- correlation ID: ties a user/business request together;
- causation ID: identifies triggering event/message;
- request ID: identifies a single request attempt;
- trace ID/span ID: distributed tracing context;
- idempotency key where mutation can be retried.

### 19.2 Structured logging

Logs MUST be structured and machine-queryable.

Required fields:

```text
timestamp
level
service
version
environment
correlation_id
trace_id
span_id
operation
business_entity_type
business_entity_id when safe
tenant/user/org identifier when safe
outcome
error_code
latency_ms
```

PII and secrets MUST NOT be logged.

### 19.3 Metrics

Every service MUST expose:

- request rate;
- error rate;
- duration/latency percentiles;
- saturation/resource usage;
- dependency latency/error rate;
- queue lag;
- consumer failures;
- retry counts;
- circuit breaker state;
- business process counters.

### 19.4 Distributed tracing

Use tracing for:

- synchronous call chains;
- asynchronous message flows;
- saga/process workflows;
- scheduled jobs;
- external integrations.

The LLM MUST propagate trace context across HTTP and messaging where supported.

### 19.5 Health check API

Each service MUST provide health endpoints with clear semantics:

- liveness: process is alive;
- readiness: service can accept traffic;
- startup: service has completed startup;
- dependency health: exposed carefully, not used to cascade restarts unnecessarily.

Readiness MUST fail when required dependencies are unavailable and accepting traffic would cause errors.

---

## 20. Security Patterns

### 20.1 Zero trust between services

The LLM MUST NOT assume internal network equals trusted network.

Every service-to-service call MUST have appropriate:

- authentication;
- authorization;
- transport security;
- identity propagation or service identity;
- least privilege access;
- audit logging for sensitive actions.

### 20.2 Access token pattern

Services MUST validate access tokens at the boundary or rely on a trusted gateway plus internal service identity policy.

Mandatory controls:

- token issuer validation;
- audience validation;
- expiry validation;
- scope/role/permission mapping;
- tenant/org boundary validation;
- no blind forwarding of unvalidated claims.

### 20.3 Authorization ownership

The LLM MUST define where authorization decisions are made:

- gateway for coarse-grained access;
- service for domain-level authorization;
- policy engine for centralized policy when needed;
- database/security layer for data-level restrictions where applicable.

Domain authorization MUST remain enforceable inside the owning service.

### 20.4 Secrets and configuration

Secrets MUST NOT be stored in source code, container images, logs, or OpenAPI examples.

Use externalized configuration and secret management.

---

## 21. Deployment and Runtime Patterns

### 21.1 Independent deployment

A service MUST be independently deployable in practice.

The LLM MUST check:

- service can be built independently;
- service can be tested independently;
- service can be deployed without lockstep deployment of unrelated services;
- backward-compatible contracts exist;
- database migrations are backward/forward compatible;
- feature flags exist for risky rollout;
- rollback strategy exists.

### 21.2 Externalized configuration

Runtime configuration MUST be externalized.

Examples:

- endpoint URLs;
- timeouts;
- retry limits;
- feature flags;
- credentials references;
- rate limits;
- queue/topic names;
- tenant-specific settings.

The LLM MUST NOT hardcode environment-specific values.

### 21.3 Blue-green/canary/rolling deployment

For production services, deployment strategy MUST account for version skew.

Mandatory rules:

- new version must tolerate old clients/messages;
- old version must tolerate new optional fields where possible;
- database migrations must not break currently running pods/instances;
- event schema changes must be backward-compatible;
- rollback must be possible unless explicitly declared impossible.

### 21.4 Sidecar pattern

Use sidecar only for cross-cutting runtime capabilities that are better isolated from application code.

Examples:

- service mesh proxy;
- log shipper;
- metrics agent;
- security proxy;
- local cache/proxy in specific cases.

The LLM MUST NOT introduce sidecars when a library, platform config, or simple process is sufficient.

---

## 22. Testing Patterns

### 22.1 Contract testing

Every public API/event consumed by another service MUST have contract verification.

Mandatory checks:

- provider contract published;
- consumer expectations tested;
- backward compatibility verified;
- breaking changes fail CI;
- examples are valid;
- error contracts are tested.

### 22.2 Service component testing

Each service MUST have tests that run the service with realistic dependencies replaced by controlled test doubles or containers.

Test scope:

- API behavior;
- domain rules;
- persistence behavior;
- migration behavior;
- authorization behavior;
- idempotency behavior;
- outbox/inbox behavior;
- failure behavior.

### 22.3 Integration testing

Integration tests MUST cover critical service interactions, not every possible combination.

Prioritize:

- high-risk workflows;
- compliance-critical workflows;
- saga/process flows;
- security boundaries;
- migration paths;
- external integrations.

### 22.4 Resilience testing

The LLM SHOULD include resilience tests for:

- downstream timeout;
- downstream error;
- duplicate message;
- out-of-order message;
- broker unavailability;
- database contention;
- partial deployment/version skew;
- retry exhaustion;
- circuit breaker open state.

---

## 23. Service API Design Rules

The LLM MUST comply with general REST/OpenAPI standards in:

- `strict-general-standards__restfull_api.md`;
- `strict-general-standards__open_api.md`;
- `strict-general-standards__http_for_web.md`.

Microservice-specific additions:

- APIs MUST expose domain capability, not database tables.
- APIs MUST be version-compatible.
- Mutating APIs SHOULD support idempotency where duplicate requests are possible.
- APIs MUST return stable error contracts.
- APIs MUST not leak internal service names, table names, or stack traces.
- APIs MUST document consistency model where data may be stale.
- APIs MUST document ownership and lifecycle of resources.

---

## 24. Event Design Rules

Every event schema MUST define:

```yaml
eventType: ApplicationSubmitted
eventVersion: 1
eventId: globally unique id
occurredAt: timestamp from producer
producer: application-service
correlationId: id tying business request together
causationId: id of command/event that caused this event
aggregateType: Application
aggregateId: application id
payload: stable domain facts
```

Mandatory rules:

- Additive compatible changes are preferred.
- Removing or changing meaning of fields is breaking.
- Consumers MUST ignore unknown fields when compatible.
- Events MUST not require consumers to call producer synchronously to understand basic meaning.
- Event payload MUST not expose secrets or unnecessary PII.
- Event retention MUST be defined.

---

## 25. State Machine and Workflow Rules

For business workflows across services, the LLM MUST define state explicitly.

Required model:

```md
## State Machine

| State        | Meaning               | Allowed Transitions                | Owner               | Entry Action       | Exit Condition      | Terminal? |
| ------------ | --------------------- | ---------------------------------- | ------------------- | ------------------ | ------------------- | --------- |
| SUBMITTED    | Application received  | UNDER_REVIEW, REJECTED             | Application Service | Persist submission | Validation complete | No        |
| UNDER_REVIEW | Officer review active | APPROVED, REJECTED, INFO_REQUESTED | Review Service      | Assign task        | Decision recorded   | No        |
| APPROVED     | Approved by authority | LICENCE_ISSUED                     | Licensing Service   | Generate approval  | Licence created     | No        |
| REJECTED     | Rejected              | None                               | Application Service | Notify applicant   | N/A                 | Yes       |
```

Mandatory rules:

- State owner MUST be clear.
- Invalid transitions MUST be rejected.
- Transition side effects MUST be idempotent.
- Cross-service transitions MUST use saga/process manager or events.
- Audit trail MUST capture who/what/when/why for regulated workflows.

---

## 26. Data Consistency Rules

The LLM MUST classify consistency for every cross-service flow:

| Consistency Type                   | Use When                                | Required Pattern           |
| ---------------------------------- | --------------------------------------- | -------------------------- |
| Local strong consistency           | Invariant is within one service         | Local transaction          |
| Cross-service eventual consistency | Process spans service data ownership    | Saga/events/outbox         |
| Read-side eventual consistency     | Query aggregates multiple owners        | Read model/projection      |
| External reconciliation            | Third-party or legacy system may differ | Reconciliation job + audit |
| Manual consistency repair          | Business exception needs human decision | Case/task/work queue       |

The LLM MUST NOT promise global ACID semantics across independent services unless using an explicitly justified transaction technology and accepting the coupling cost.

---

## 27. Required Documentation per Service

Every service MUST have a service README or architecture document containing:

```md
# Service Name

## Responsibility

## Non-Responsibilities

## Owned Data

## Public APIs

## Published Events

## Consumed Events

## Downstream Dependencies

## Upstream Consumers

## Security Model

## Consistency Model

## Failure Modes

## Retry/Timeout/Circuit Breaker Policy

## Observability

## Deployment

## Runbook

## Data Retention and Audit

## Known Risks
```

---

## 28. LLM Implementation Rules

When implementing microservice code, the LLM MUST:

1. Identify service boundary and owner.
2. Identify source of truth for every data item.
3. Avoid direct cross-service database access.
4. Add explicit remote call timeouts.
5. Avoid unbounded retries.
6. Add idempotency to retryable mutations and message consumers.
7. Use outbox/inbox where needed.
8. Propagate correlation and trace context.
9. Keep domain logic inside owning service.
10. Avoid putting business logic in gateway/BFF/shared library by default.
11. Document consistency and failure behavior.
12. Add tests for duplicate, timeout, failure, and version compatibility paths.
13. Keep changes backward-compatible unless a breaking-change plan exists.

---

## 29. Pattern Selection Matrix

| Problem                                       | Prefer                                              | Avoid                               |
| --------------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| Need independent business capability delivery | Decompose by capability/bounded context             | Service per table                   |
| Need cross-service transaction                | Saga + outbox + idempotency                         | 2PC by default, dual write          |
| Need publish event after DB change            | Transactional outbox                                | Save then publish without atomicity |
| Need consume messages safely                  | Idempotent consumer/inbox                           | Assume exactly-once delivery        |
| Need aggregate UI view                        | BFF/API composition/read model                      | Browser calls 10 services directly  |
| Need heavy cross-service query                | Projection/read model/CQRS                          | Runtime joins across services       |
| Need legacy migration                         | Strangler fig + ACL                                 | Big-bang rewrite                    |
| Need downstream fault isolation               | Timeout + retry budget + circuit breaker + bulkhead | Infinite retry, no timeout          |
| Need edge routing/security                    | API Gateway                                         | Gateway owns domain logic           |
| Need client-specific backend                  | BFF                                                 | One bloated API for all clients     |
| Need external model isolation                 | Anti-corruption layer                               | External schema leaks into domain   |

---

## 30. Mandatory Review Checklist

Before accepting microservice design or implementation, verify:

### Boundary

- [ ] Service has business capability or bounded context.
- [ ] Service has clear owner.
- [ ] Service has explicit non-responsibilities.
- [ ] Boundary is not based on table/controller/layer only.
- [ ] Alternative modular monolith/module was considered.

### Data

- [ ] Owned data is listed.
- [ ] No direct cross-service database access exists.
- [ ] Migrations are owned by the service.
- [ ] Cross-service query strategy is defined.
- [ ] Consistency model is documented.

### Communication

- [ ] APIs/events are documented.
- [ ] Contracts are version-compatible.
- [ ] Synchronous calls have timeouts.
- [ ] Retries are bounded and safe.
- [ ] Messages have correlation/causation IDs.

### Reliability

- [ ] Idempotency exists for retryable mutations and consumers.
- [ ] Outbox/inbox is used where needed.
- [ ] Circuit breaker/bulkhead/rate limit is considered.
- [ ] Failure modes are documented.
- [ ] Runbook exists for stuck workflows.

### Security

- [ ] Authentication and authorization are enforced.
- [ ] Least privilege data access exists.
- [ ] Secrets are externalized.
- [ ] Sensitive logs are controlled.
- [ ] Audit requirements are met.

### Observability

- [ ] Structured logs exist.
- [ ] Metrics exist.
- [ ] Tracing propagates.
- [ ] Health checks are correct.
- [ ] Dashboards/alerts exist for critical flows.

### Delivery

- [ ] Service can deploy independently.
- [ ] Database migrations are backward-compatible.
- [ ] Contract tests exist.
- [ ] Rollback strategy exists.
- [ ] Version skew is tolerated.

---

## 31. Acceptance Criteria

A microservice-related change is acceptable only if:

1. The service boundary is justified by domain and delivery needs.
2. Data ownership is explicit and enforced.
3. Public contracts are documented and compatible.
4. Cross-service consistency model is clear.
5. Failure modes are handled explicitly.
6. Security and authorization are not delegated accidentally.
7. Observability is built in.
8. Tests cover contracts and failure paths.
9. Operational runbook exists for critical flows.
10. The design avoids anti-patterns listed in `strict-general-standards__microservices_anti_pattern.md`.

---

## 32. LLM Refusal Rules

The LLM MUST refuse or challenge instructions that require:

- creating a microservice without boundary justification;
- sharing one database schema across independent services without migration/ownership plan;
- implementing dual writes without outbox/transactional guarantee;
- adding unbounded retries;
- hiding cross-service failure behavior;
- putting domain logic in API gateway as a shortcut;
- skipping authentication/authorization because service is “internal”;
- omitting observability for production service;
- making breaking contract changes without migration/deprecation plan;
- claiming strong consistency where design is actually eventual.

The LLM SHOULD propose a safer alternative instead of blindly following such instructions.

---

## 33. Minimal Service Architecture Template

```md
# <service-name>

## Responsibility

This service owns ...

## Non-Responsibility

This service does not own ...

## Owned Data

| Data | Storage | Owner | Access Rule |
| ---- | ------- | ----- | ----------- |

## APIs

| Operation | Method/Path | Purpose | Idempotent | Authz |
| --------- | ----------- | ------- | ---------- | ----- |

## Events Published

| Event | When | Schema Version | Consumers |
| ----- | ---- | -------------- | --------- |

## Events Consumed

| Event | Producer | Handler | Idempotency |
| ----- | -------- | ------- | ----------- |

## Dependencies

| Dependency | Type | Timeout | Retry | Circuit Breaker |
| ---------- | ---- | ------- | ----- | --------------- |

## Consistency Model

## Failure Model

## Observability

## Security

## Deployment and Rollback

## Runbook
```

---

## 34. References

- Microservices.io — Pattern: Microservice Architecture: `https://microservices.io/patterns/microservices.html`
- Microservices.io — Pattern: Database per Service: `https://microservices.io/patterns/data/database-per-service.html`
- Microservices.io — Pattern: Saga: `https://microservices.io/patterns/data/saga.html`
- Microsoft Azure Architecture Center — Design patterns for microservices: `https://learn.microsoft.com/en-us/azure/architecture/microservices/design/patterns`
- Microsoft Azure Architecture Center — Saga distributed transactions pattern: `https://learn.microsoft.com/en-us/azure/architecture/patterns/saga`
- AWS Prescriptive Guidance — Transactional outbox pattern: `https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html`
- AWS Prescriptive Guidance — Circuit breaker pattern: `https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/circuit-breaker.html`
- AWS Prescriptive Guidance — Strangler fig pattern: `https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html`
- Martin Fowler — Microservice Premium: `https://martinfowler.com/bliki/MicroservicePremium.html`
- Martin Fowler — Microservice Prerequisites: `https://martinfowler.com/bliki/MicroservicePrerequisites.html`
- Martin Fowler — Monolith First: `https://martinfowler.com/bliki/MonolithFirst.html`

````

---

## 35. Enforcement Snippet for LLM Code Agents

```md
When working on microservices, you MUST first identify service boundary, owner, owned data, public contract, consistency model, and failure model. Do not create services by technical layer, table, controller, or repository count. Prefer modular monolith/module boundaries unless independent deployability, data ownership, and operational accountability are justified. For all remote calls, define timeout, retry budget, circuit breaker need, idempotency, and observability. For cross-service workflows, use saga/process manager/events/outbox rather than dual write or hidden distributed transactions. Reject direct cross-service database access unless explicitly documented as temporary migration debt with owner, expiry, and replacement plan.
````
