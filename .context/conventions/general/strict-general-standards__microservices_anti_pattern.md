# Strict General Standards: Microservices Anti-Pattern

> File: `strict-general-standards__microservices_anti_pattern.md`  
> Category: General Engineering Standard  
> Principle: Microservices Anti-Patterns, Distributed-System Smells, and Architecture Failure Prevention  
> Status: Mandatory for LLM-assisted architecture design, implementation, refactoring, review, documentation, and migration involving microservices

---

## 1. Purpose

This standard defines microservices anti-patterns that an LLM code agent MUST detect, challenge, and avoid.

The goal is to prevent systems that claim to be microservices but fail in practice because they are over-distributed, under-owned, under-observed, tightly coupled, inconsistent, hard to deploy, hard to debug, or unsafe under failure.

This document is intentionally strict. Microservices failures are often not caused by missing framework code. They are caused by bad boundaries, false consistency assumptions, operational immaturity, hidden coupling, and uncontrolled distributed complexity.

Approved patterns are defined in `strict-general-standards__microservices_pattern.md`.

---

## 2. Source Baseline

The LLM MUST evaluate microservices anti-patterns against these baseline references:

- Martin Fowler guidance on microservice premium, prerequisites, and monolith-first strategy.
- Microservices.io pattern language for service boundaries, data ownership, communication, observability, and testing.
- Microsoft Azure Architecture Center cloud anti-patterns, including retry storm, chatty I/O, noisy neighbor, monolithic persistence, and synchronous I/O.
- AWS Prescriptive Guidance for cloud design patterns that mitigate distributed failure.
- Research taxonomy of microservices anti-patterns, including organizational, technical, intra-service, and inter-service anti-patterns.
- Existing project standards for REST, OpenAPI, HTTP, web, security, observability, and deployment.

References are listed at the end of this document.

---

## 3. Core Interpretation

### 3.1 A microservice anti-pattern is usually a coupling problem

Most microservice anti-patterns are forms of hidden coupling:

- deployment coupling;
- database coupling;
- schema coupling;
- temporal coupling;
- workflow coupling;
- team coupling;
- runtime coupling;
- security coupling;
- observability coupling;
- release coupling.

The LLM MUST look beyond repository/container boundaries and identify the real coupling.

### 3.2 “It works locally” is irrelevant for microservices correctness

Microservice correctness MUST be evaluated under:

- network failure;
- partial failure;
- duplicate request/message;
- delayed response;
- out-of-order event;
- downstream timeout;
- rolling deployment;
- schema version skew;
- data staleness;
- operator intervention;
- incident diagnosis.

If the design only works in the happy path, it is not production-grade.

### 3.3 The LLM must challenge microservices-by-default

If the user asks to “make it microservices” without a boundary rationale, the LLM MUST challenge the premise and provide safer alternatives.

The default alternatives are:

- modular monolith;
- package/module boundary;
- plugin/module architecture;
- separate bounded context inside one deployable;
- background worker inside same service;
- library extraction;
- strangler fig migration plan;
- read model/projection rather than service split.

---

## 4. Anti-Pattern Severity

The LLM MUST classify anti-patterns by severity:

| Severity | Meaning                                                 | Required LLM Action                           |
| -------- | ------------------------------------------------------- | --------------------------------------------- |
| Blocker  | Will likely break correctness, security, or operability | Refuse implementation as-is; propose redesign |
| High     | Creates strong coupling or incident risk                | Challenge and require mitigation              |
| Medium   | Creates maintainability/performance risk                | Flag and propose improvement                  |
| Low      | Style/design smell                                      | Mention during review if relevant             |

---

## 5. Anti-Pattern Catalog

## 5.1 Microservices by Default

### Smell

The design starts by creating many services before proving domain boundaries, team ownership, or independent deployment needs.

### Why harmful

Microservices introduce operational, consistency, deployment, observability, and failure-handling cost. If the domain is not complex enough to require distributed boundaries, the architecture pays distributed-system cost without receiving independent-delivery benefits.

### LLM must detect

- “Create user-service, order-service, payment-service, notification-service” before modeling the domain.
- New project starts with many services but no capability map.
- Services are generated from nouns in a requirement document.
- No team ownership or deployment independence exists.

### Required correction

Prefer modular monolith first unless microservice boundary is justified.

```md
Before splitting into services, define:

- business capability;
- owner;
- owned data;
- independent deployment reason;
- scaling/failure isolation reason;
- consistency model;
- operational overhead.
```

### Severity

High, Blocker for new systems without boundary evidence.

---

## 5.2 Distributed Monolith

### Smell

The system consists of multiple services, but they must be built, deployed, tested, released, scaled, or changed together.

### Why harmful

It keeps the coordination cost of a monolith while adding network calls, partial failure, distributed debugging, and operational overhead.

### LLM must detect

- Lockstep releases across many services.
- Shared database schema across services.
- Circular synchronous calls.
- One user request requires a long chain of mandatory service calls.
- Contract changes require simultaneous updates everywhere.
- One service outage causes most services to fail.
- Services cannot run/test independently.

### Required correction

- Collapse into modular monolith if independence is fake.
- Redesign boundaries around capabilities.
- Introduce backward-compatible contracts.
- Remove direct database coupling.
- Use async events/read models where appropriate.
- Define independent deployment and ownership.

### Severity

Blocker.

---

## 5.3 Nanoservices

### Smell

Services are so small that network, deployment, monitoring, security, and coordination overhead dominate the business value.

### Why harmful

Too many tiny services increase cognitive load, runtime calls, operational surfaces, and failure points. “Small” becomes fragmentation rather than autonomy.

### LLM must detect

- One service per CRUD operation.
- One service per database table.
- One service with only pass-through logic.
- Service has no independent business reason to exist.
- Most changes touch many tiny services.

### Required correction

Merge into a larger service/module aligned to cohesive business capability.

### Severity

High.

---

## 5.4 Service per Technical Layer

### Smell

The architecture separates controller service, business service, validation service, repository service, database service, or utility service.

### Why harmful

This is a layered monolith stretched over the network. Every business operation crosses service boundaries, increasing latency and failure without improving autonomy.

### LLM must detect

- `api-service` calls `business-service` calls `dao-service`.
- `validation-service` contains validation for all domains.
- `repository-service` owns database access for many domains.
- `utility-service` becomes a shared runtime dependency.

### Required correction

Keep technical layers inside a service. Split by business capability or bounded context, not by code layer.

### Severity

Blocker.

---

## 5.5 Shared Database

### Smell

Multiple services read/write the same tables, schema, or collections directly.

### Why harmful

Shared databases create hidden coupling. Schema changes break other services, data ownership becomes unclear, and services cannot evolve independently.

### LLM must detect

- Two services use same DB credentials.
- Service A queries Service B tables directly.
- Many services write shared status columns.
- Reporting queries join operational service tables directly.
- Database is treated as integration layer.

### Required correction

- Assign data ownership.
- Enforce access with database grants/credentials.
- Expose data through owning service API/events.
- Use read models/projections/warehouse for reporting.
- If temporary during migration, document expiry and replacement.

### Severity

Blocker, except explicitly temporary migration state with governance.

---

## 5.6 Monolithic Persistence

### Smell

A single persistence model or database technology is forced onto unrelated services despite different access patterns, scalability needs, and ownership boundaries.

### Why harmful

It couples services through storage assumptions and prevents each service from choosing the right data model. It can also create shared bottlenecks and unclear operational ownership.

### LLM must detect

- One central database team controls all schemas.
- Every service must use same shared schema conventions despite domain mismatch.
- High-throughput logs, document metadata, workflow state, and transactional data are forced into one persistence model without reason.

### Required correction

Use database-per-service ownership. Allow different storage models only when justified by service needs and operational capability.

### Severity

High.

---

## 5.7 Entity Service / CRUD Service Anti-Pattern

### Smell

A service exposes raw CRUD operations around an entity/table but does not own meaningful business behavior.

### Why harmful

Business workflows become scattered across callers. Invariants are unenforced or duplicated. The service becomes a remote table, not a domain boundary.

### LLM must detect

- `GET /cases/{id}`, `PATCH /cases/{id}` with arbitrary field patching but no domain commands.
- Generic `updateStatus` used by many services.
- Callers decide domain transition validity.
- Service contains no state machine or invariant enforcement.

### Required correction

Expose domain operations:

```text
POST /cases/{id}/assign
POST /cases/{id}/request-information
POST /cases/{id}/close
POST /cases/{id}/escalate
```

The owning service validates allowed transitions.

### Severity

High.

---

## 5.8 Anemic Service Boundary

### Smell

The service only forwards calls, maps DTOs, or delegates all meaningful decisions to other services/libraries.

### Why harmful

It adds latency and failure points without owning behavior or data. It often exists only because a framework template made service creation easy.

### LLM must detect

- Service with no owned data, no policy, no workflow, no state, and no independent scaling need.
- Service exists only to call another service with renamed fields.
- Business logic lives in shared library consumed by all services.

### Required correction

Remove/merge the service or turn it into a real capability owner.

### Severity

Medium to High.

---

## 5.9 God Service / Central Orchestrator Everything

### Smell

One service coordinates most workflows, owns too much business logic, knows every service’s internal semantics, or becomes mandatory for all changes.

### Why harmful

It becomes a monolith in service form. It centralizes change pressure and failure risk.

### LLM must detect

- `workflow-service` knows every domain rule.
- `common-service` validates all entities.
- All state transitions require central service changes.
- Many services become passive CRUD stores.

### Required correction

- Move domain rules to owning services.
- Use process manager only for workflow coordination, not domain ownership.
- Split orchestration by bounded workflow where appropriate.
- Define responsibility matrix.

### Severity

High.

---

## 5.10 Gateway as Business Logic Dumping Ground

### Smell

API Gateway contains domain validation, workflow decisions, persistence logic, or cross-service business transactions.

### Why harmful

Gateway logic is hard to test as domain code, becomes a central bottleneck, and bypasses service ownership.

### LLM must detect

- Gateway decides whether a case can close.
- Gateway checks business invariants across services.
- Gateway writes to databases.
- Gateway contains large custom scripts per business flow.

### Required correction

Gateway handles edge concerns only. Domain logic belongs to owning service. Client-specific composition belongs in BFF if justified.

### Severity

High.

---

## 5.11 BFF Abuse

### Smell

Backends for Frontends become duplicate domain services or copy-paste business rules for each client.

### Why harmful

Rules diverge between clients. Security behavior differs unpredictably. Backend services lose authority.

### LLM must detect

- Mobile BFF and web BFF each implement different eligibility rules.
- BFF mutates core workflow state directly.
- BFF owns persistence for domain entities.

### Required correction

BFF may shape client experience and aggregate data, but domain decisions remain in owning services.

### Severity

High.

---

## 5.12 Chatty I/O

### Smell

A request performs many small remote calls or database calls, often inside loops.

### Why harmful

Network and I/O overhead accumulate. Latency becomes unpredictable. Failure probability grows with every call.

### LLM must detect

- For each item in a list, call another service.
- UI page load triggers dozens of backend calls.
- Service joins data by repeatedly calling remote APIs.
- No batching, caching, or projection exists.

### Required correction

Use:

- batch API;
- API composition with strict call budget;
- read model/projection;
- caching;
- server-side aggregation;
- event-fed denormalized view.

### Severity

High for critical paths.

---

## 5.13 Synchronous Call Chain

### Smell

One user request requires a chain such as A -> B -> C -> D -> E, where every service must respond before the user receives a result.

### Why harmful

Latency and failure probability compound. One slow dependency delays the whole flow. Retries multiply load.

### LLM must detect

- Deep dependency chains.
- No total deadline budget.
- No fallback.
- Every service blocks on next service.
- User waits for non-critical side effects.

### Required correction

- Reduce chain depth.
- Move non-critical work async.
- Use read model for query aggregation.
- Define total timeout budget.
- Use circuit breaker and fallback.

### Severity

High.

---

## 5.14 Event as RPC

### Smell

Events are used as disguised commands or synchronous RPC, with producers expecting specific consumers to act immediately.

### Why harmful

It creates temporal coupling while hiding control flow. Events lose meaning as domain facts and become fragile integration commands.

### LLM must detect

- Event names like `ValidateApplicationNow` or `CallPaymentService`.
- Producer depends on one specific consumer response.
- Event includes instructions rather than facts.
- Consumer failure breaks producer’s business operation unexpectedly.

### Required correction

Use commands for requests. Use domain events for facts that already happened. Use saga/process manager for workflow coordination.

### Severity

High.

---

## 5.15 Choreography Spaghetti

### Smell

Many services react to events in a complex workflow, but no single place explains the end-to-end process state.

### Why harmful

The workflow becomes difficult to debug, audit, modify, or recover. Regulatory workflows become especially risky because process state and responsibility are hidden.

### LLM must detect

- No explicit state machine.
- Many event handlers mutate workflow state.
- Business users cannot see process progress.
- Stuck process requires reading logs across services.
- Adding one step requires changing many consumers.

### Required correction

Use orchestration/process manager for complex workflows. Document state machine, compensation, terminal states, manual intervention, and observability.

### Severity

Blocker for regulated or high-criticality workflows.

---

## 5.16 Dual Write

### Smell

A service updates its database and publishes a message, updates another service, or writes another datastore in separate non-atomic operations.

### Why harmful

A crash between writes creates inconsistent state: database changed but event missing, or event published but database rolled back.

### LLM must detect

```text
save(entity)
publish(event)
```

without outbox or transactional guarantee.

### Required correction

Use transactional outbox, inbox, event sourcing, or another explicit consistency mechanism.

### Severity

Blocker.

---

## 5.17 Two-Phase Commit by Default

### Smell

The design uses distributed transactions/2PC across services to preserve ACID semantics without considering coupling and availability cost.

### Why harmful

It couples participants tightly, reduces autonomy, complicates failure recovery, and often conflicts with independent service ownership.

### LLM must detect

- Cross-service database transaction spanning multiple services.
- XA transaction used as first option.
- Requirement says “all services must commit or rollback together” without business compensation analysis.

### Required correction

Prefer local transactions plus saga/compensation/eventual consistency. If distributed transaction is truly required, document why microservices boundary is appropriate at all.

### Severity

High to Blocker.

---

## 5.18 Exactly-Once Delivery Illusion

### Smell

The design assumes messages or requests will be processed exactly once end-to-end.

### Why harmful

Most real systems can duplicate, retry, redeliver, or partially process messages. Assuming exactly-once causes duplicate side effects and inconsistent state.

### LLM must detect

- No idempotency key.
- No processed-message tracking.
- Consumer not safe on duplicate delivery.
- Retryable mutation has no deduplication.

### Required correction

Design effectively-once behavior with idempotent consumers, unique operation IDs, inbox/outbox, and version checks.

### Severity

Blocker for side-effecting flows.

---

## 5.19 Retry Storm

### Smell

Clients/services retry too aggressively or at multiple layers until the failing dependency becomes even more overloaded.

### Why harmful

Retries amplify incidents. A transient failure becomes a system-wide outage due to synchronized repeated calls.

### LLM must detect

- `while(true)` retry loop.
- No max attempts.
- No backoff/jitter.
- Retries at browser, gateway, service, SDK, and service mesh simultaneously.
- Mutating operation retried without idempotency.

### Required correction

Use bounded retries with exponential backoff, jitter, total deadline, idempotency, circuit breaker, and retry budget.

### Severity

Blocker for production remote calls.

---

## 5.20 Missing Timeout / Infinite Wait

### Smell

Remote calls rely on library defaults or wait indefinitely.

### Why harmful

Threads, connections, queues, and user requests pile up. Failure becomes resource exhaustion.

### LLM must detect

- HTTP client created without timeout.
- DB/broker calls have no timeout/deadline.
- Blocking call in request path has no cancellation.
- Timeout values are undocumented.

### Required correction

Define explicit connection, request/read, queue, and total deadline timeouts.

### Severity

Blocker.

---

## 5.21 Timeout Guessing

### Smell

Timeouts are arbitrary magic numbers copied across services without latency data or user/business deadline.

### Why harmful

Too-short timeouts create false failures and retries. Too-long timeouts cause slow incident detection and poor user experience.

### LLM must detect

- Every service uses `30s` by default.
- Timeout exceeds upstream deadline.
- Timeout does not consider p95/p99 latency.
- No monitoring validates timeout choice.

### Required correction

Set timeout from latency budget, downstream SLO, operation type, and total request deadline. Monitor and adjust.

### Severity

Medium to High.

---

## 5.22 No Circuit Breaker for Fragile Dependency

### Smell

A service repeatedly calls a dependency known to fail or become slow, without circuit breaker or fail-fast behavior.

### Why harmful

The caller wastes resources on calls likely to fail and contributes to cascading failure.

### LLM must detect

- Synchronous calls to external API without circuit breaker.
- High latency dependency blocks all requests.
- Retry exists but no breaker.

### Required correction

Add circuit breaker with metrics, fallback/fail-fast behavior, and alerting.

### Severity

High.

---

## 5.23 No Bulkhead

### Smell

All remote calls, tenants, consumers, or workloads share the same resource pool.

### Why harmful

One dependency, tenant, queue, or traffic class can exhaust resources and affect unrelated flows.

### LLM must detect

- One thread pool for all outbound calls.
- One DB pool for all workloads regardless of priority.
- One consumer pool for slow and fast topics.
- No tenant isolation in multi-tenant system.

### Required correction

Use separate pools/queues/rate limits/resource quotas for critical boundaries.

### Severity

High in high-traffic or multi-tenant systems.

---

## 5.24 No Backpressure

### Smell

The service accepts more work than it can process and relies on queues/memory/threads growing indefinitely.

### Why harmful

Unbounded load causes memory exhaustion, latency collapse, stale work, and cascading failure.

### LLM must detect

- Unbounded queue.
- No consumer lag alert.
- No rate limit.
- Async endpoint accepts unlimited jobs.
- Batch job overwhelms downstream services.

### Required correction

Use bounded queues, rate limits, load shedding, priority, admission control, and lag monitoring.

### Severity

High.

---

## 5.25 Shared Library Coupling

### Smell

Many services depend on a shared business/domain library that changes frequently and forces coordinated releases.

### Why harmful

The shared library becomes a hidden monolith. Business rule changes ripple across services.

### LLM must detect

- Shared library contains domain workflows for multiple services.
- Library release requires many service upgrades.
- Services cannot evolve independently because common package owns domain model.

### Required correction

Keep shared libraries limited to stable technical utilities, generated clients/contracts, or platform concerns. Domain logic belongs to owning services.

### Severity

High.

---

## 5.26 Common Service Dumping Ground

### Smell

A `common-service`, `shared-service`, or `master-service` accumulates unrelated responsibilities.

### Why harmful

It becomes a bottleneck and unclear ownership zone. Every feature depends on it.

### LLM must detect

- Common service owns reference data, validation, notifications, users, settings, files, and workflows together.
- Many teams change same service for unrelated reasons.
- Service name says nothing about business capability.

### Required correction

Split by capability or define it as explicit platform service with narrow responsibility.

### Severity

High.

---

## 5.27 Polyglot Chaos

### Smell

Every service uses different languages, frameworks, persistence technologies, build systems, and observability conventions without operational justification.

### Why harmful

Operational complexity explodes. Teams cannot support each other. Security patching, deployment, and debugging become inconsistent.

### LLM must detect

- Technology chosen by personal preference.
- No platform support for chosen stack.
- Inconsistent logging/tracing/metrics.
- Too many database technologies for team maturity.

### Required correction

Use governed technology choices. Allow polyglot only with clear benefit, support model, and operational maturity.

### Severity

Medium to High.

---

## 5.28 Version Explosion

### Smell

Every API/event change creates a new version, and old versions remain forever.

### Why harmful

Maintenance cost grows, behavior diverges, and consumers become stuck on incompatible versions.

### LLM must detect

- `/v1`, `/v2`, `/v3`, `/v4` all active indefinitely.
- No deprecation policy.
- Event consumers depend on obsolete schema forever.
- Breaking changes used for additive evolution.

### Required correction

Use backward-compatible additive changes by default. Define deprecation windows, consumer migration tracking, and removal policy.

### Severity

Medium to High.

---

## 5.29 Breaking Contract Without Migration

### Smell

Provider changes API/event schema in a way that breaks consumers without compatibility plan.

### Why harmful

Independent deployment fails. Consumers break at runtime.

### LLM must detect

- Removing fields.
- Changing field meaning/type.
- Renaming enum values.
- Changing error contract.
- Changing event semantics.
- Database migration breaks old service version.

### Required correction

Use expand-and-contract migration, additive fields, compatibility tests, deprecation notices, and consumer readiness checks.

### Severity

Blocker.

---

## 5.30 No Contract Tests

### Smell

Services integrate by assumption, manual testing, or generated clients only.

### Why harmful

Providers break consumers without knowing. Independent deployment becomes unsafe.

### LLM must detect

- No OpenAPI/event compatibility check in CI.
- No consumer-driven tests.
- No schema registry compatibility.
- Errors not specified/tested.

### Required correction

Add provider/consumer contract tests and compatibility gates.

### Severity

High.

---

## 5.31 Observability Afterthought

### Smell

Logs, metrics, traces, health checks, and dashboards are added after production incidents rather than designed upfront.

### Why harmful

Microservices are impossible to debug without end-to-end visibility. Incidents become guesswork.

### LLM must detect

- No correlation ID.
- No structured logs.
- No distributed tracing.
- No dependency metrics.
- No queue lag metrics.
- No business workflow metrics.
- No dashboard/runbook.

### Required correction

Add observability as part of service contract and acceptance criteria.

### Severity

Blocker for production services.

---

## 5.32 Log Everything / Sensitive Logging

### Smell

Service logs full payloads, tokens, PII, credentials, documents, or business-sensitive data.

### Why harmful

Logs become a data breach and compliance liability.

### LLM must detect

- `log.info(requestBody)`.
- Authorization headers logged.
- Full document or user profile logged.
- Error logs include secrets.
- Debug logs enabled in production.

### Required correction

Use structured logs with redaction, allowlist fields, secure log storage, retention policy, and audit controls.

### Severity

Blocker for sensitive systems.

---

## 5.33 Security Ends at Gateway

### Smell

Services trust all internal traffic because the gateway authenticated the original request.

### Why harmful

Internal compromise, misrouting, SSRF, bad network policy, or bypass path can access services without proper authorization.

### LLM must detect

- Services do not validate identity/claims where required.
- Domain authorization exists only at gateway.
- Internal endpoints have no auth.
- Service-to-service identity is absent.

### Required correction

Use defense in depth: gateway controls plus service-level authorization and least-privilege service identity.

### Severity

Blocker.

---

## 5.34 Trusting Client-Supplied State

### Smell

The service trusts client-provided roles, workflow states, prices, permissions, ownership, or calculated totals.

### Why harmful

Clients are untrusted. Attackers can manipulate state and bypass server rules.

### LLM must detect

- Client sends `isAdmin` or `allowedActions` and server trusts it.
- Client sends next workflow state directly.
- Client-supplied total/payment amount is trusted.
- UI-hidden field controls authorization.

### Required correction

Server-side owning service computes and validates domain decisions.

### Severity

Blocker.

---

## 5.35 Service Mesh Cargo Cult

### Smell

Service mesh is introduced to “solve microservices” before service boundaries, contracts, and failure behavior are understood.

### Why harmful

Mesh can add complexity, latency, operational burden, and debugging challenges. It does not fix bad domain boundaries or business logic coupling.

### LLM must detect

- Mesh proposed before basic timeout/retry/observability policy exists.
- App-level idempotency missing but mesh retry enabled.
- Teams cannot operate mesh.
- No clear use case beyond trend adoption.

### Required correction

First fix boundaries, contracts, timeouts, retries, idempotency, and observability. Introduce mesh only for clear platform capabilities.

### Severity

Medium to High.

---

## 5.36 Kubernetes as Architecture

### Smell

The design assumes deploying containers to Kubernetes automatically makes the system microservices-ready.

### Why harmful

Kubernetes manages runtime deployment, not domain boundaries, data ownership, consistency, or service contracts.

### LLM must detect

- Architecture justification focuses on pods, ingress, Helm, and replicas but not service ownership.
- No domain model.
- No consistency strategy.
- No contract strategy.

### Required correction

Separate platform deployment design from service architecture design.

### Severity

Medium.

---

## 5.37 Big-Bang Rewrite

### Smell

A legacy system is replaced by a new microservice architecture all at once.

### Why harmful

Large rewrites accumulate unknown requirements, migration risk, data mismatch, and business disruption.

### LLM must detect

- “Rewrite entire monolith into microservices” without incremental slices.
- No coexistence plan.
- No rollback plan.
- No strangler routing.
- No data reconciliation.

### Required correction

Use strangler fig/evolutionary migration by capability slice. Define source of truth, cutover, reconciliation, and rollback.

### Severity

High to Blocker.

---

## 5.38 Data-First Decomposition

### Smell

Migration starts by splitting databases before understanding behavior, workflows, ownership, and domain boundaries.

### Why harmful

Data dependencies are often symptoms of hidden business behavior. Splitting data first can freeze wrong boundaries and create synchronization problems.

### LLM must detect

- Service split maps directly to existing table groups.
- Data migration plan exists before capability map.
- Behavior remains in monolith but data moves away.

### Required correction

Decompose by capability and behavior first. Move data ownership as part of an end-to-end slice.

### Severity

High.

---

## 5.39 Report Query Against Operational Services

### Smell

Reports and dashboards directly query multiple service databases or call many service APIs for large datasets.

### Why harmful

Reporting workloads overload operational systems, violate data ownership, and create fragile cross-service joins.

### LLM must detect

- BI query joins service-owned tables.
- Scheduled report loops through APIs for many records.
- Read-heavy dashboard calls operational services repeatedly.

### Required correction

Use governed analytical store, projections, event-fed read model, warehouse, or reporting replica with explicit data contract.

### Severity

High.

---

## 5.40 No Local Development Strategy

### Smell

Developers need the entire distributed system running to change one service.

### Why harmful

Development slows down, tests become flaky, and service autonomy is fake.

### LLM must detect

- Cannot run one service with test doubles.
- Local environment requires dozens of services.
- No contract stubs.
- No seed data.
- No repeatable environment setup.

### Required correction

Provide local service mode, contract stubs, containers for owned dependencies, and documented dev workflow.

### Severity

Medium to High.

---

## 5.41 Ownerless Service

### Smell

No team/person owns the service’s roadmap, incidents, security, releases, data, and documentation.

### Why harmful

Ownerless services decay and become production risk.

### LLM must detect

- “Shared by all teams.”
- No on-call owner.
- No documentation owner.
- No data owner.
- Changes require finding whoever last touched it.

### Required correction

Assign explicit ownership or merge into an owned service/platform component.

### Severity

High.

---

## 5.42 No Runbook

### Smell

Service is production-critical but has no operational guide for incidents.

### Why harmful

Microservices fail in partial and complex ways. Without runbooks, recovery depends on tribal knowledge.

### LLM must detect

- No dashboard links.
- No alert explanation.
- No retry/replay procedure.
- No DLQ handling.
- No stuck saga remediation.
- No rollback steps.

### Required correction

Add runbook covering symptoms, diagnosis, remediation, escalation, and post-incident evidence.

### Severity

High for production services.

---

## 5.43 Ignoring Version Skew

### Smell

The implementation assumes all services update simultaneously.

### Why harmful

Rolling deployments mean old and new versions run together. Incompatible changes break live traffic.

### LLM must detect

- Database migration removes column used by old version.
- Event producer changes schema before consumers upgrade.
- API provider requires new field before clients send it.
- Feature flag absent for rollout.

### Required correction

Use expand-contract migrations, additive schemas, feature flags, compatibility tests, and staged rollout.

### Severity

Blocker.

---

## 5.44 Cache as Source of Truth

### Smell

Cache is treated as authoritative data store without ownership, invalidation, consistency, or recovery model.

### Why harmful

Stale or lost cache data causes incorrect business behavior.

### LLM must detect

- Workflow state stored only in cache.
- Authorization decisions cached without invalidation.
- Cache rebuild not defined.
- Cache TTL arbitrary.

### Required correction

Define source of truth, cache invalidation, TTL, consistency model, and rebuild path.

### Severity

High for business-critical data.

---

## 5.45 Over-Centralized Reference Data

### Smell

All code lists, statuses, labels, rules, and metadata are placed into one central reference-data service used synchronously by every request.

### Why harmful

It becomes a bottleneck and single point of failure. Domain-specific meaning becomes centralized incorrectly.

### LLM must detect

- Every service calls reference service during validation.
- Reference service owns domain statuses for many contexts.
- Outage blocks unrelated workflows.

### Required correction

Separate global reference data from domain-owned state. Cache safely, replicate read-only data, or include needed facts in events/contracts.

### Severity

Medium to High.

---

## 5.46 Cross-Service Authorization Ambiguity

### Smell

It is unclear which service decides whether an actor may perform an action.

### Why harmful

Authorization gaps appear between gateway, BFF, service, and data layer. One path may enforce rules while another bypasses them.

### LLM must detect

- Gateway checks role but service does not check resource ownership.
- BFF hides button but backend allows action.
- Downstream service trusts upstream service blindly for user permissions.

### Required correction

Define authorization responsibility per operation. Domain service must enforce resource-level rules.

### Severity

Blocker.

---

## 5.47 Hidden Temporal Coupling

### Smell

Service A only works if Service B has processed a message or updated state within an undocumented time window.

### Why harmful

Eventual consistency becomes accidental. Users see inconsistent behavior and engineers cannot reason about correctness.

### LLM must detect

- Immediate read-after-write expected from a projection.
- Workflow assumes consumer processed event instantly.
- No staleness contract.
- UI shows stale data as final truth.

### Required correction

Document consistency window, expose process state, use polling/SSE/status endpoint, or choose synchronous/local transaction when immediate consistency is required.

### Severity

High.

---

## 5.48 Workflow State Split Across Services Without Owner

### Smell

Different services own fragments of one workflow state, but no service owns the full process lifecycle.

### Why harmful

Invalid transitions, stuck states, and inconsistent audit trails become likely.

### LLM must detect

- Application service has `status`.
- Review service has `reviewStatus`.
- Notification service has `notificationStatus`.
- Case service infers status from other services.
- No canonical state machine.

### Required correction

Define workflow owner/process manager and state machine. Other services own local facts, not the global process truth unless explicitly modeled.

### Severity

Blocker for regulated workflows.

---

## 5.49 Lack of Auditability

### Smell

Business-critical state changes happen without durable audit trail, actor identity, reason, source, and before/after context.

### Why harmful

Regulated systems cannot defend decisions or reconstruct incident/business history.

### LLM must detect

- Status changes overwrite previous state.
- No actor/correlation/reason captured.
- Async workflow cannot explain why it reached terminal state.
- Manual admin actions unaudited.

### Required correction

Add audit event model, immutable audit records, correlation IDs, actor identity, reason codes, and retention policy.

### Severity

Blocker for regulated/compliance workflows.

---

## 5.50 Unbounded Fan-Out

### Smell

One event or request triggers many downstream calls/messages without capacity, ordering, priority, or failure strategy.

### Why harmful

Fan-out amplifies load and failure. One upstream event can overload many systems.

### LLM must detect

- Event has many heavy consumers.
- Producer sends per-recipient/per-record messages without batching.
- No consumer lag monitoring.
- No backpressure or quota.

### Required correction

Use batching, partitioning, quotas, async processing, consumer isolation, and lag alerts.

### Severity

High.

---

## 5.51 No Dead Letter Strategy

### Smell

Message processing fails repeatedly with no DLQ, parking lot, retry classification, or manual remediation path.

### Why harmful

Poison messages can block partitions/queues or disappear silently.

### LLM must detect

- Infinite consumer retry.
- Message dropped after failure without record.
- DLQ exists but no process to inspect/replay.
- No alert for DLQ growth.

### Required correction

Define retry policy, DLQ, replay tooling, poison classification, alerting, and owner.

### Severity

High.

---

## 5.52 Blind Event Replay

### Smell

The system can replay events but handlers are not idempotent or replay-safe.

### Why harmful

Replay can duplicate side effects such as emails, payments, tasks, notifications, or audit records.

### LLM must detect

- Reprocessing sends external notifications again.
- Consumer does not separate state projection from side effects.
- No replay mode.

### Required correction

Make handlers idempotent. Separate projection rebuild from side-effect execution. Track processed message IDs.

### Severity

High.

---

## 5.53 Environment Parity Drift

### Smell

Development, test, staging, and production differ enough that behavior cannot be trusted before release.

### Why harmful

Distributed systems are sensitive to configuration, network, resource, and dependency differences.

### LLM must detect

- Different broker/database versions.
- Different auth configuration.
- Missing rate limits in lower environments.
- Different feature flags.
- No production-like integration testing.

### Required correction

Use environment parity standards, config validation, infrastructure-as-code, and deployment smoke tests.

### Severity

Medium to High.

---

## 5.54 Configuration Sprawl

### Smell

Timeouts, endpoints, topic names, credentials, feature flags, and limits are scattered across code, manifests, dashboards, and manual docs.

### Why harmful

Runtime behavior becomes unpredictable and hard to audit.

### LLM must detect

- Hardcoded endpoint URLs.
- Timeout duplicated in code and mesh config.
- Secret in environment file committed to repo.
- Feature flags undocumented.

### Required correction

Centralize configuration ownership, validate config at startup, document defaults, and manage secrets properly.

### Severity

Medium to High.

---

## 5.55 Generic “Manager” Service

### Smell

Service names like `manager`, `processor`, `handler`, `engine`, or `coordinator` hide actual business responsibility.

### Why harmful

Vague names allow scope creep and unclear ownership.

### LLM must detect

- `case-manager-service` owns unrelated case, document, assignment, notification, and report logic.
- `processor-service` processes many unrelated message types.
- `engine-service` contains all rules for many domains.

### Required correction

Rename and bound by explicit capability. Split or merge based on ownership.

### Severity

Medium.

---

## 5.56 Siloed Data Without Access Strategy

### Smell

Services own data, but no plan exists for legitimate cross-service reads, search, reporting, reconciliation, or user views.

### Why harmful

Teams bypass boundaries later through direct DB access because the architecture did not provide a sanctioned data access path.

### LLM must detect

- Database-per-service is declared but no read model/event/API plan exists.
- UI requires aggregated data but only single-service APIs exist.
- Reporting needs ignored.

### Required correction

Design read models, APIs, event streams, search indexing, or analytical pipelines intentionally.

### Severity

High.

---

## 5.57 Ignoring Deletion, Retention, and Privacy

### Smell

Data is copied across services/events/read models without deletion, retention, masking, or privacy plan.

### Why harmful

Data proliferates beyond control, creating compliance and security risks.

### LLM must detect

- Events contain full PII unnecessarily.
- Read models keep data forever.
- No deletion propagation.
- No retention classification.
- Logs contain copied personal data.

### Required correction

Apply data minimization, retention policies, deletion workflows, masking, and audit controls.

### Severity

Blocker for sensitive systems.

---

## 5.58 Ignoring Cost of Operations

### Smell

The design creates many services, databases, queues, dashboards, and deployments without operational capacity.

### Why harmful

The team cannot patch, monitor, secure, test, and operate the system sustainably.

### LLM must detect

- Small team owns dozens of services without platform automation.
- No CI/CD standard.
- No observability standard.
- No on-call model.
- No dependency/security patch process.

### Required correction

Reduce service count, standardize platform, automate CI/CD/observability, and assign ownership.

### Severity

High.

---

## 6. Mandatory LLM Detection Algorithm

When reviewing any microservice design or code, the LLM MUST execute this algorithm:

```text
1. Identify services and claimed responsibilities.
2. Identify actual data ownership.
3. Identify actual deployment coupling.
4. Identify actual runtime call graph.
5. Identify actual workflow ownership.
6. Identify contract/versioning strategy.
7. Identify consistency model.
8. Identify failure handling.
9. Identify observability coverage.
10. Identify security enforcement points.
11. Compare findings against anti-pattern catalog.
12. Classify severity.
13. Propose corrective design.
```

The LLM MUST NOT stop at code-level review if architecture-level anti-patterns are visible.

---

## 7. Anti-Pattern Review Checklist

### Boundary and ownership

- [ ] Are services split by business capability rather than technical layer?
- [ ] Does every service have an owner?
- [ ] Can each service be deployed independently?
- [ ] Are non-responsibilities explicit?
- [ ] Is there a capability map?

### Data

- [ ] Is every table/collection/topic owned by exactly one service?
- [ ] Is direct cross-service DB access absent?
- [ ] Are read models/reporting paths designed?
- [ ] Is data retention/deletion defined?
- [ ] Is copied data minimized?

### Communication

- [ ] Are synchronous chains shallow and justified?
- [ ] Are events facts, not disguised commands?
- [ ] Are commands targeted and idempotent?
- [ ] Are retries bounded?
- [ ] Are timeouts explicit?

### Consistency

- [ ] Is local vs eventual consistency documented?
- [ ] Are sagas/process managers explicit for workflows?
- [ ] Are compensations business-valid?
- [ ] Are duplicate/out-of-order messages handled?
- [ ] Are stale reads communicated where relevant?

### Reliability

- [ ] Are circuit breakers used for fragile dependencies?
- [ ] Are bulkheads used for resource isolation?
- [ ] Is backpressure implemented?
- [ ] Is DLQ/replay strategy defined?
- [ ] Are retry storms prevented?

### Security

- [ ] Is service-level authorization enforced?
- [ ] Are internal services authenticated?
- [ ] Are secrets externalized?
- [ ] Are logs redacted?
- [ ] Are audit trails complete?

### Delivery

- [ ] Are contract tests present?
- [ ] Is version skew handled?
- [ ] Are migrations backward-compatible?
- [ ] Is rollback possible?
- [ ] Is local development practical?

### Operations

- [ ] Are logs structured?
- [ ] Are metrics and tracing present?
- [ ] Are dashboards and alerts defined?
- [ ] Are runbooks available?
- [ ] Is operational ownership sustainable?

---

## 8. Mandatory Review Output Format

When the LLM finds microservices anti-patterns, it MUST report them as:

```md
## Microservices Anti-Pattern Review

| Anti-Pattern         | Severity | Evidence                              | Risk                                          | Required Correction                              |
| -------------------- | -------- | ------------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| Distributed Monolith | Blocker  | Services share DB and deploy together | Cannot change independently; failure cascades | Rework boundaries or merge into modular monolith |

## Highest-Risk Issue

## Recommended Target Architecture

## Safe Migration Steps

## Tests/Controls Required Before Merge
```

---

## 9. Refactoring Playbook

### 9.1 If services are too coupled

1. Map actual dependencies.
2. Identify services that always change together.
3. Merge or redraw boundaries around capabilities.
4. Introduce stable contracts.
5. Remove direct DB access.
6. Add contract tests.
7. Re-establish independent deployment.

### 9.2 If shared database exists

1. Identify table ownership.
2. Restrict writes first.
3. Replace cross-service reads with API/events/read model.
4. Add database grants to enforce ownership.
5. Migrate consumers incrementally.
6. Remove shared access.

### 9.3 If dual write exists

1. Identify all write + publish/update pairs.
2. Add outbox table in same transaction as local state change.
3. Add outbox relay.
4. Make consumers idempotent.
5. Add replay and DLQ handling.
6. Monitor publish lag/failures.

### 9.4 If synchronous chain is too deep

1. Draw call graph with latency and failure rate.
2. Identify non-critical side effects.
3. Move side effects async.
4. Replace repeated queries with projection/read model.
5. Add timeout budget and circuit breakers.
6. Add fallback behavior.

### 9.5 If workflow is invisible

1. Define explicit state machine.
2. Identify workflow owner.
3. Introduce saga/process manager if needed.
4. Add correlation IDs.
5. Add audit events.
6. Add dashboard/runbook for stuck states.

---

## 10. LLM Refusal Rules

The LLM MUST refuse to implement a requested microservice change as-is when it requires any of the following without mitigation:

- direct cross-service database writes;
- dual write without outbox or equivalent;
- unbounded retry;
- remote call without timeout;
- service with no owner/responsibility;
- gateway/BFF holding domain rules;
- security only at UI or gateway for domain actions;
- workflow state split without owner;
- breaking API/event contract without migration;
- sensitive data logging;
- assuming exactly-once delivery;
- claiming strong cross-service consistency without mechanism;
- big-bang rewrite without migration/rollback plan.

The LLM MUST provide a safer alternative and explain the risk clearly.

---

## 11. Acceptance Criteria

A microservice design passes anti-pattern review only if:

1. It is not microservices-by-default.
2. It is not a distributed monolith.
3. Services have clear business boundaries and owners.
4. Data ownership is exclusive and enforceable.
5. Contracts are compatible and tested.
6. Failure behavior is explicit.
7. Consistency model is honest.
8. Security is enforced at service/domain boundaries.
9. Observability is sufficient for production diagnosis.
10. Deployment can tolerate version skew.
11. Operational cost is sustainable.
12. Migration path avoids big-bang risk.

---

## 12. References

- Martin Fowler — Microservice Premium: `https://martinfowler.com/bliki/MicroservicePremium.html`
- Martin Fowler — Microservice Prerequisites: `https://martinfowler.com/bliki/MicroservicePrerequisites.html`
- Martin Fowler — Monolith First: `https://martinfowler.com/bliki/MonolithFirst.html`
- Microservices.io — Pattern: Microservice Architecture: `https://microservices.io/patterns/microservices.html`
- Microservices.io — Pattern: Database per Service: `https://microservices.io/patterns/data/database-per-service.html`
- Microsoft Azure Architecture Center — Performance testing and antipatterns: `https://learn.microsoft.com/en-us/azure/architecture/antipatterns/`
- Microsoft Azure Architecture Center — Retry Storm antipattern: `https://learn.microsoft.com/en-us/azure/architecture/antipatterns/retry-storm/`
- Microsoft Azure Architecture Center — Chatty I/O antipattern: `https://learn.microsoft.com/en-us/azure/architecture/antipatterns/chatty-io/`
- Microsoft Azure Architecture Center — Noisy Neighbor antipattern: `https://learn.microsoft.com/en-us/azure/architecture/antipatterns/noisy-neighbor/noisy-neighbor`
- AWS Prescriptive Guidance — Transactional outbox pattern: `https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html`
- AWS Prescriptive Guidance — Circuit breaker pattern: `https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/circuit-breaker.html`
- Davide Taibi, Valentina Lenarduzzi, Claus Pahl — Microservices Anti Patterns: A Taxonomy: `https://arxiv.org/abs/1908.04101`

````

---

## 13. Enforcement Snippet for LLM Code Agents

```md
When reviewing or implementing microservices, you MUST actively search for distributed monolith, shared database, service-per-layer, nanoservice, CRUD/entity service, dual write, retry storm, missing timeout, missing idempotency, invisible workflow, hidden temporal coupling, gateway/BFF domain logic, insufficient observability, and security-at-gateway-only anti-patterns. If any blocker anti-pattern is present, do not implement as-is. Explain the risk and propose a corrected architecture using service boundary ownership, database-per-service, explicit contracts, outbox/inbox, saga/process manager, bounded retries, timeouts, circuit breakers, contract tests, and observability.
````
