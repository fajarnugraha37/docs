# Part 35 — Capstone: Designing a Production-Grade Spring System End-to-End

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `35-capstone-production-grade-spring-system-end-to-end.md`  
> Status: **PART TERAKHIR — SERI SELESAI**  
> Target: Java 8 sampai Java 25, dengan fokus utama Spring Framework, Spring Boot, Spring Security, Spring Data, Spring Modulith, Spring Cloud, Spring Batch, Spring Integration, Actuator, Micrometer, AOT/native, dan production engineering.

---

## 0. Tujuan Capstone

Part ini bukan lagi membahas satu fitur Spring secara terpisah.

Part ini menyatukan seluruh seri menjadi kemampuan yang lebih tinggi:

```text
mendesain, membangun, menguji, mengoperasikan, dan mengevolusikan sistem Spring production-grade
```

Seorang engineer yang benar-benar kuat dalam Spring tidak hanya tahu:

```java
@RestController
@Service
@Repository
@Transactional
```

Engineer yang kuat tahu:

1. Di mana boundary sistem berada.
2. Bean mana yang harus dibuat oleh container dan mana yang tidak.
3. Transaction boundary mana yang aman.
4. Operation mana yang idempotent.
5. Error mana yang retryable.
6. Authorization dilakukan di layer mana.
7. Event mana yang boleh dikirim sebelum commit dan mana yang harus setelah commit.
8. Cache mana yang aman dan cache mana yang berbahaya.
9. Scheduler mana yang aman di multi-replica deployment.
10. Test mana yang perlu full Spring context dan mana yang tidak.
11. Metrik mana yang menunjukkan health sistem dan mana yang hanya noise.
12. Migrasi framework mana yang bisa dilakukan bertahap dan mana yang harus atomic.
13. Runtime assumption mana yang harus ditulis sebagai invariant.

Capstone ini menggunakan contoh konseptual sistem enterprise yang cocok untuk regulatory/case-management style domain:

```text
Regulatory Case Management Platform
```

Namun pola yang dibahas juga berlaku untuk:

- government service platform
- internal enterprise workflow system
- financial case review system
- compliance workflow
- approval/maker-checker system
- complaint/appeal/enforcement platform
- SaaS multi-tenant business platform
- document-heavy enterprise platform
- event-driven modular monolith
- microservice-backed platform

---

## 1. Mental Model Akhir: Spring sebagai Runtime Boundary Engine

Setelah seluruh seri, cara melihat Spring harus berubah.

Spring bukan hanya dependency injection framework.

Spring adalah runtime boundary engine untuk:

| Boundary | Spring Mechanism |
|---|---|
| Object graph | IoC container, `BeanDefinition`, DI resolution |
| Configuration | `Environment`, `PropertySource`, config binding |
| Lifecycle | bean lifecycle, context refresh, startup/shutdown hooks |
| Cross-cutting behavior | AOP proxy, interceptor chain |
| Transaction | `PlatformTransactionManager`, synchronization, resource binding |
| Web request | `DispatcherServlet`, handler mapping, argument resolver |
| Security | filter chain, method security, authorization manager |
| Persistence abstraction | Spring Data repository factory/proxy |
| Async execution | `TaskExecutor`, `@Async`, scheduler |
| Domain events | `ApplicationEvent`, transactional event listener |
| Messaging | listener container, converter, retry, DLQ |
| Integration flow | Spring Integration channel/endpoint/flow |
| Batch job | Spring Batch job repository and step state |
| Observability | Actuator, Micrometer, Observation API |
| Modularity | Spring Modulith application modules |
| Runtime packaging | Boot executable jar, layers, AOT/native |
| Platform convention | starters, auto-configuration, BOM, guardrails |

The top-level insight:

```text
Spring gives you programmable boundaries.
Production engineering is the discipline of making those boundaries explicit, testable, observable, and evolvable.
```

---

## 2. Capstone Scenario

Kita akan desain sistem bernama:

```text
ReguFlow — Regulatory Workflow and Case Management Platform
```

### 2.1 Problem Domain

ReguFlow menangani proses:

1. Application submission.
2. Eligibility screening.
3. Case creation.
4. Officer assignment.
5. Document review.
6. Clarification request.
7. Appeal submission.
8. Enforcement case escalation.
9. Legal review.
10. Decision approval.
11. Notification delivery.
12. Audit trail.
13. Reporting.
14. Batch reconciliation.
15. External agency integration.

### 2.2 Non-Functional Requirements

| Requirement | Target |
|---|---|
| Correctness | no lost state transition, no unauthorized transition |
| Auditability | every material decision traceable |
| Availability | degraded operation preferred over full outage |
| Data integrity | transactionally consistent internal state |
| Integration safety | external calls never corrupt internal state |
| Security | least privilege, tenant-aware authorization |
| Observability | every request/job/event traceable |
| Operability | health/readiness/runbook available |
| Evolvability | module boundary enforced |
| Testability | behavior testable at correct layer |
| Migration | Spring version upgrades planned and rehearsable |

### 2.3 Architectural Style

Default choice:

```text
modular monolith first, event-driven internally, with controlled external integration boundaries
```

Why not microservices immediately?

Because the domain has high consistency coupling:

- case status
- assignment
- decision
- appeal
- audit
- authorization
- document lifecycle

Splitting prematurely creates distributed transaction pressure and duplicated authorization logic.

The recommended starting topology:

```text
Spring Boot modular monolith
  ├─ clear module boundaries
  ├─ relational database
  ├─ internal domain events
  ├─ outbox for external events
  ├─ async workers for side effects
  ├─ batch jobs for reconciliation/reporting
  ├─ Actuator/Micrometer for operations
  └─ internal platform starter for conventions
```

---

## 3. Target Runtime Stack

### 3.1 Modern Runtime Recommendation

For a new production-grade system:

```text
Java              : 21 LTS or 25 LTS
Spring Boot       : 4.x where ecosystem is ready, otherwise latest 3.5.x as transition
Spring Framework  : 7.x through Boot 4.x, or 6.2.x through Boot 3.5.x
Spring Security   : aligned with Boot line
Spring Data       : aligned with Boot line
Spring Modulith   : aligned with Boot line
Database          : PostgreSQL / Oracle / MySQL depending enterprise constraint
Messaging         : Kafka/RabbitMQ/JMS depending delivery requirement
Observability     : Micrometer + tracing backend + log aggregation
Container         : Docker/Kubernetes
```

### 3.2 Java 8–25 Compatibility View

| Era | Recommended Treatment |
|---|---|
| Java 8 + Spring 5.3/Boot 2.7 | legacy maintenance only; minimize new feature work |
| Java 11 + Spring 5.3/Boot 2.7 | intermediate legacy; prepare for Java 17 upgrade |
| Java 17 + Spring 6/Boot 3 | modern Jakarta baseline |
| Java 21 + Spring 6/Boot 3 or Spring 7/Boot 4 | strong default for current production |
| Java 25 + Spring 7/Boot 4 | modern LTS direction, validate ecosystem carefully |

Top-tier engineering decision:

```text
Do not upgrade Java, Spring, Jakarta namespace, app server assumptions, database driver, security model, and deployment topology all at once unless forced.
```

Separate migration dimensions where possible.

---

## 4. High-Level Architecture

```text
                    +-------------------------------+
                    |        External Users         |
                    |  Citizen / Officer / Admin    |
                    +---------------+---------------+
                                    |
                                    v
                         +----------+----------+
                         | API Gateway / WAF   |
                         +----------+----------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                         ReguFlow Spring Boot App                      |
|                                                                       |
|  +----------------+   +----------------+   +----------------------+   |
|  | Application    |   | Case           |   | Enforcement          |   |
|  | Module         |   | Module         |   | Module               |   |
|  +----------------+   +----------------+   +----------------------+   |
|                                                                       |
|  +----------------+   +----------------+   +----------------------+   |
|  | Document       |   | Notification   |   | Audit                |   |
|  | Module         |   | Module         |   | Module               |   |
|  +----------------+   +----------------+   +----------------------+   |
|                                                                       |
|  +----------------+   +----------------+   +----------------------+   |
|  | Reporting      |   | Integration    |   | Security / Policy    |   |
|  | Module         |   | Module         |   | Module               |   |
|  +----------------+   +----------------+   +----------------------+   |
|                                                                       |
|  Cross-cutting: config, transaction, events, observability, error      |
+-----------------------------------------------------------------------+
           |                    |                         |
           v                    v                         v
   +---------------+    +----------------+        +----------------+
   | Relational DB |    | Message Broker |        | Object Storage |
   +---------------+    +----------------+        +----------------+
           |
           v
   +----------------+
   | Reporting / BI |
   +----------------+
```

This architecture is not defined by technology boxes.

It is defined by boundaries.

---

## 5. Module Boundary Design

### 5.1 Candidate Modules

| Module | Responsibility |
|---|---|
| `application` | application submission, applicant-facing lifecycle |
| `case` | internal case file, assignment, review state |
| `enforcement` | enforcement escalation and action lifecycle |
| `appeal` | appeal process after decision |
| `document` | document metadata, storage reference, scan status |
| `notification` | email/SMS/inbox delivery orchestration |
| `audit` | immutable audit event recording and query projection |
| `reporting` | reporting views, export jobs, operational reports |
| `integration` | external agency/API adapters |
| `security-policy` | authorization rules, permission matrix helpers |
| `platform` | shared Spring conventions, not business logic |

### 5.2 Package Strategy

Prefer:

```text
com.example.reguflow.application
com.example.reguflow.casefile
com.example.reguflow.enforcement
com.example.reguflow.appeal
com.example.reguflow.document
com.example.reguflow.notification
com.example.reguflow.audit
com.example.reguflow.reporting
com.example.reguflow.integration
com.example.reguflow.securitypolicy
com.example.reguflow.platform
```

Avoid generic package-by-layer as primary organization:

```text
controller/
service/
repository/
dto/
entity/
```

Why?

Because package-by-layer optimizes for framework stereotype, not business boundary.

Better internal shape:

```text
casefile/
  api/
  application/
  domain/
  infrastructure/
  events/
  internal/
```

### 5.3 Module Access Rule

Example:

```text
casefile may depend on document public API
casefile may publish CaseApproved event
notification may listen to CaseApproved event
notification must not call casefile repository
reporting may read projections, not mutate domain aggregate
integration must not own business decision state
platform must not contain business rules
```

### 5.4 Dependency Verification

For serious systems, module boundary is not a convention only.

It must be tested.

Example conceptual rule:

```java
@Test
void modules_are_well_structured() {
    ApplicationModules.of(ReguFlowApplication.class).verify();
}
```

The important mental model:

```text
Modularity is not the presence of packages.
Modularity is the enforced absence of illegal dependencies.
```

---

## 6. Domain Model and State Machine Boundary

### 6.1 Case Lifecycle Example

```text
DRAFT
  -> SUBMITTED
  -> SCREENING
  -> ASSIGNED
  -> UNDER_REVIEW
  -> CLARIFICATION_REQUESTED
  -> CLARIFICATION_RECEIVED
  -> RECOMMENDED
  -> APPROVED
  -> REJECTED
  -> APPEALED
  -> ENFORCEMENT_ESCALATED
  -> CLOSED
```

### 6.2 State Transition Invariant

Every state transition must answer:

1. What is the current state?
2. What is the requested next state?
3. Who requested it?
4. Is the actor allowed?
5. Is the transition valid?
6. Is supporting data complete?
7. Is the decision auditable?
8. Are side effects internal or external?
9. Can the operation be retried?
10. What must happen after commit?

### 6.3 Anti-Pattern: Controller-Driven State Machine

Bad shape:

```java
@PostMapping("/cases/{id}/approve")
@Transactional
public void approve(@PathVariable Long id) {
    CaseEntity c = repo.findById(id).orElseThrow();
    c.setStatus("APPROVED");
    mailClient.send(...);
}
```

Problems:

- no explicit transition policy
- external side effect inside transaction
- no audit reason
- no idempotency
- no authorization at object level
- no event after commit
- status as string without invariant
- controller owns domain logic

Better shape:

```java
@PostMapping("/cases/{id}/approval")
public ResponseEntity<CaseDecisionResponse> approve(
        @PathVariable CaseId id,
        @Valid @RequestBody ApproveCaseRequest request,
        AuthenticatedOfficer officer) {

    CaseDecisionResult result = approveCaseUseCase.approve(id, request.toCommand(officer));
    return ResponseEntity.ok(CaseDecisionResponse.from(result));
}
```

Then application service:

```java
@Service
public class ApproveCaseUseCase {

    private final CaseRepository caseRepository;
    private final CasePolicy casePolicy;
    private final DomainEventPublisher events;
    private final AuditRecorder audit;

    @Transactional
    public CaseDecisionResult approve(CaseId id, ApproveCaseCommand command) {
        CaseFile caseFile = caseRepository.getRequired(id);

        casePolicy.assertCanApprove(command.actor(), caseFile);
        caseFile.approve(command.reason(), command.decisionAt());

        audit.recordCaseApproved(caseFile, command.actor(), command.reason());
        events.publish(new CaseApproved(caseFile.id(), command.actor().id()));

        return CaseDecisionResult.from(caseFile);
    }
}
```

The event publisher must be designed carefully.

If the event triggers email or external API, prefer after-commit handling.

---

## 7. API Boundary Design

### 7.1 API Is Not Database Shape

A good API expresses a use case.

Bad:

```text
PUT /case-table/{id}
PATCH /case-entity/{id}
GET /case-status-master
```

Better:

```text
POST /cases
GET  /cases/{caseId}
POST /cases/{caseId}/submission
POST /cases/{caseId}/assignment
POST /cases/{caseId}/approval
POST /cases/{caseId}/clarification-requests
POST /cases/{caseId}/appeals
GET  /cases/{caseId}/timeline
GET  /cases/{caseId}/audit-events
```

### 7.2 Command-Oriented Endpoint for Business Action

Approval is not a generic update.

It is a command:

```json
{
  "decision": "APPROVE",
  "reason": "Applicant satisfies all eligibility conditions.",
  "version": 17
}
```

Response:

```json
{
  "caseId": "CASE-2026-000123",
  "status": "APPROVED",
  "version": 18,
  "approvedAt": "2026-06-21T09:00:00Z",
  "links": {
    "timeline": "/cases/CASE-2026-000123/timeline",
    "audit": "/cases/CASE-2026-000123/audit-events"
  }
}
```

### 7.3 Optimistic Concurrency

Use one of:

```text
If-Match: "17"
```

or explicit version in command body.

The invariant:

```text
No command that changes business state should overwrite someone else's decision silently.
```

### 7.4 Idempotency

For externally retried commands:

```text
Idempotency-Key: 0191e8db-7c3b-7d13-9f14-b86a9ed3a9ef
```

Store idempotency result:

| Field | Meaning |
|---|---|
| key | client-supplied idempotency key |
| actor | caller identity |
| request hash | detect key reuse with different payload |
| result reference | previously produced result |
| status | processing/succeeded/failed |
| expires_at | retention boundary |

### 7.5 Error Contract

Use Problem Details style:

```json
{
  "type": "https://errors.example.com/case/invalid-transition",
  "title": "Invalid case transition",
  "status": 409,
  "detail": "Case cannot be approved while clarification is pending.",
  "instance": "/cases/CASE-2026-000123/approval",
  "errorCode": "CASE_INVALID_TRANSITION",
  "correlationId": "01JZ...",
  "retryable": false
}
```

Good error contract distinguishes:

| Error | HTTP | Retryable |
|---|---:|---:|
| malformed JSON | 400 | no |
| validation failure | 400/422 | no |
| unauthorized | 401 | maybe after login |
| forbidden | 403 | no |
| not found | 404 | usually no |
| optimistic conflict | 409 | yes after refetch |
| rate limited | 429 | yes with backoff |
| external dependency unavailable | 503 | yes |
| internal bug | 500 | unknown/no blind retry |

---

## 8. Spring Bean and Application Layer Design

### 8.1 Recommended Stereotype Semantics

| Stereotype | Meaning |
|---|---|
| `@RestController` | transport adapter only |
| `@Service` application service | use-case orchestration |
| domain object | business invariant, not necessarily Spring bean |
| domain service | pure business policy, maybe Spring bean if dependency needed |
| repository interface | persistence boundary |
| adapter/client | external system boundary |
| configuration class | bean wiring only |
| platform starter bean | cross-cutting convention |

### 8.2 Application Service Pattern

Application service should orchestrate:

1. Load aggregate/state.
2. Authorize actor.
3. Validate command-level invariant.
4. Call domain behavior.
5. Persist state.
6. Record audit.
7. Publish event.
8. Return result.

Application service should not:

- format HTTP response
- know JSON field names
- directly call external API inside DB transaction
- hide authorization in repository query only
- swallow domain exception
- mutate unrelated aggregate casually

### 8.3 Domain Object Should Not Depend on Spring

Prefer:

```java
public final class CaseFile {
    public void approve(DecisionReason reason, Instant now) {
        if (!status.canApprove()) {
            throw new InvalidCaseTransition(id, status, CaseStatus.APPROVED);
        }
        this.status = CaseStatus.APPROVED;
        this.approvedAt = now;
        this.decisionReason = reason;
        this.version = this.version.next();
    }
}
```

This makes domain behavior testable without Spring context.

---

## 9. Transaction Boundary Design

### 9.1 Golden Rule

```text
A transaction should protect internal state consistency, not external world consistency.
```

Inside transaction:

- database read/write
- aggregate mutation
- audit row insert
- outbox row insert
- idempotency record update

Outside or after commit:

- email sending
- HTTP call
- Kafka publish if not using transactional outbox
- file transfer
- cache invalidation if not transaction-aware
- notification to external agency

### 9.2 Transaction Boundary Example

```java
@Transactional
public ApprovalResult approve(ApproveCaseCommand command) {
    CaseFile caseFile = caseRepository.getRequired(command.caseId());

    policy.assertCanApprove(command.actor(), caseFile);
    caseFile.approve(command.reason(), clock.instant());

    audit.record(...);
    outbox.enqueue(new CaseApprovedIntegrationEvent(...));

    return ApprovalResult.from(caseFile);
}
```

Then outbox worker:

```java
@Scheduled(fixedDelayString = "${reguflow.outbox.poll-delay:PT5S}")
public void publishPendingEvents() {
    outboxPublisher.publishBatch();
}
```

### 9.3 Propagation Heuristic

| Propagation | Use Carefully For |
|---|---|
| `REQUIRED` | default use-case transaction |
| `REQUIRES_NEW` | audit/log/outbox only if independent failure semantics are intended |
| `NESTED` | partial rollback with savepoint, DB support required |
| `SUPPORTS` | read utility methods |
| `NOT_SUPPORTED` | external call deliberately outside transaction |

### 9.4 Avoid Transactional Illusion

This does not work as many expect:

```java
public void outer() {
    innerTransactional();
}

@Transactional
public void innerTransactional() {}
```

Self-invocation bypasses proxy.

Fix by:

- moving boundary to another bean
- making public application service method transactional
- using `TransactionTemplate` deliberately
- not splitting transaction randomly

---

## 10. Authorization Architecture

### 10.1 Authorization Layers

| Layer | Example |
|---|---|
| Request-level | only officers can access `/officer/**` |
| Method-level | `@PreAuthorize` on use case |
| Object-level | officer can approve this specific case |
| State-level | case status allows approval |
| Tenant-level | actor belongs to same tenant/agency |
| Data-level | query only returns visible cases |
| Export-level | report rows filtered by permission |

### 10.2 Policy Object

```java
@Component
public class CaseApprovalPolicy {

    public void assertCanApprove(OfficerActor actor, CaseFile caseFile) {
        if (!actor.hasPermission("case.approve")) {
            throw ForbiddenProblem.permissionMissing("case.approve");
        }
        if (!actor.agencyId().equals(caseFile.ownerAgencyId())) {
            throw ForbiddenProblem.crossAgencyAccess();
        }
        if (!caseFile.status().canApprove()) {
            throw new InvalidCaseTransition(...);
        }
        if (caseFile.wasPreparedBy(actor.id())) {
            throw ForbiddenProblem.makerCheckerViolation();
        }
    }
}
```

### 10.3 Authorization Audit

Every denied material action should produce a security/audit event with safe fields:

```text
actor_id
agency_id
action
resource_type
resource_id
reason_code
correlation_id
time
```

Do not log sensitive payload unnecessarily.

### 10.4 Query-Level Authorization

Never rely only on UI hiding.

For listing cases:

```java
Page<CaseSummary> searchVisibleCases(CaseSearchCriteria criteria, Actor actor)
```

The repository should receive a visibility specification:

```text
criteria + actor visibility policy -> database predicate
```

---

## 11. External Integration Boundary

### 11.1 Adapter Pattern

Do not call external system from domain/application code directly.

Use port:

```java
public interface IdentityVerificationGateway {
    IdentityVerificationResult verify(ApplicantIdentity identity);
}
```

Adapter:

```java
@Component
class HttpIdentityVerificationGateway implements IdentityVerificationGateway {
    private final IdentityVerificationClient client;
    private final ExternalCallRecorder recorder;

    @Override
    public IdentityVerificationResult verify(ApplicantIdentity identity) {
        // timeout, error mapping, correlation id, safe logging
    }
}
```

### 11.2 Timeout Taxonomy

Every outbound client needs:

- connection timeout
- response/read timeout
- connection acquisition timeout
- total operation deadline
- retry budget
- rate limit behavior

No outbound call should have infinite wait.

### 11.3 Error Mapping

External error should not leak raw provider semantics into domain.

Map:

```text
HTTP 400 from provider -> ExternalRejectedRequestProblem
HTTP 401/403 from provider -> ExternalCredentialProblem
HTTP 404 from provider -> ExternalResourceNotFound or domain-specific not found
HTTP 429 from provider -> ExternalRateLimitedProblem retryable=true
HTTP 5xx/timeouts -> ExternalUnavailableProblem retryable=true
invalid response -> ExternalProtocolProblem retryable=depends
```

### 11.4 External Call and Transaction

Bad:

```java
@Transactional
public void approve(...) {
    caseFile.approve();
    repo.save(caseFile);
    externalAgencyClient.notifyApproval(...); // risky inside transaction
}
```

Better:

```text
transaction commits internal approval + outbox event
outbox worker calls external agency
worker records success/failure
reconciliation handles stuck state
```

---

## 12. Event and Messaging Design

### 12.1 Event Types

| Event Type | Scope | Example |
|---|---|---|
| Domain event | internal domain fact | `CaseApproved` |
| Application event | Spring in-process event | `CaseApprovalCompleted` |
| Integration event | external contract | `CaseApprovedV1` |
| Audit event | immutable compliance record | `CASE_APPROVED` |
| Notification event | delivery instruction | `SendCaseApprovedEmail` |

Do not mix all into one class.

### 12.2 Event Naming

Use past tense for facts:

```text
CaseSubmitted
CaseAssigned
CaseApproved
ClarificationRequested
AppealLodged
EnforcementEscalated
```

Use command-style names for requested work:

```text
SendApprovalNotification
GenerateCaseReport
SyncCaseToExternalAgency
```

### 12.3 Transactional Event Handling

If event handling depends on committed data, use after-commit semantics.

Conceptual shape:

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void on(CaseApproved event) {
    notificationCommands.enqueueApprovalEmail(event.caseId());
}
```

But for mission-critical external delivery, prefer outbox because in-memory after-commit event can be lost on process crash after commit and before handling completes.

### 12.4 Idempotent Consumer

Every external message consumer should be idempotent.

Store processed message key:

```text
consumer_name
message_id
message_type
processed_at
result_status
```

Invariant:

```text
Duplicate delivery must not duplicate business side effects.
```

---

## 13. Persistence and Data Ownership

### 13.1 Ownership Rule

Each module owns its tables conceptually.

Example:

| Module | Owns |
|---|---|
| casefile | `case_file`, `case_assignment`, `case_decision` |
| document | `document`, `document_scan`, `document_storage_ref` |
| audit | `audit_event` |
| notification | `notification_request`, `notification_delivery` |
| integration | `outbox_event`, `external_call_log` |
| reporting | projections/materialized views |

Cross-module joins are allowed only if intentionally designed.

### 13.2 Write Model vs Read Model

Write model should protect invariants.

Read model should optimize query needs.

For dashboard/listing:

```text
case_summary_view
case_worklist_projection
officer_task_projection
agency_performance_projection
```

Do not overload aggregate queries for large listing/reporting.

### 13.3 Audit Table

Audit event should be append-only.

Minimum fields:

```text
audit_id
occurred_at
actor_id
actor_type
agency_id
action
resource_type
resource_id
case_id
reason_code
summary
metadata_json
correlation_id
request_id
ip_or_channel
```

Audit should not be a random log table.

It is a compliance artifact.

---

## 14. Caching Strategy

### 14.1 What Can Be Cached Safely

Good candidates:

- reference data
- configuration lookup
- external token with TTL
- postal code/address lookup
- expensive read-only metadata
- permission matrix version if invalidation is strong

Dangerous candidates:

- case status if status changes frequently
- authorization result without tenant/resource/version key
- mutable entity object
- list result without complete filter key
- data involved in approval/concurrency decision

### 14.2 Cache Key Design

Cache key must include all dimensions that affect result.

Example:

```text
case-worklist:{tenantId}:{actorId}:{roleHash}:{criteriaHash}:{page}:{sort}:{version}
```

If user/tenant/role affects result but is missing from cache key, data leak is possible.

### 14.3 Cache and Transaction

If a transaction updates case status, do not evict/update cache before commit.

Preferred patterns:

- evict after commit
- publish event after commit to invalidate cache
- use short TTL where strict consistency is not required
- avoid caching sensitive mutable decisions

---

## 15. Async, Scheduling, and Background Work

### 15.1 Work Classification

| Work Type | Recommended Mechanism |
|---|---|
| quick after-commit side effect | transactional event listener with caution |
| reliable external delivery | outbox worker |
| recurring reconciliation | scheduled job with distributed lock |
| large file/report generation | Spring Batch |
| message-driven integration | Kafka/RabbitMQ/JMS listener |
| in-process parallelism | `TaskExecutor` with bounded policy |

### 15.2 Scheduler in Kubernetes

If 4 replicas run:

```java
@Scheduled(cron = "0 */5 * * * *")
public void reconcile() {}
```

then all 4 replicas may execute unless guarded.

Need one of:

- DB lock
- distributed lock
- leader election
- external scheduler triggering one job
- queue-based work claiming

### 15.3 Background Work Table Pattern

For reliable async internal work:

```text
work_item
  id
  type
  payload
  status
  attempts
  next_attempt_at
  locked_by
  locked_until
  created_at
  updated_at
```

Worker claims due items and processes with retry/backoff.

This is often more defensible than fire-and-forget `@Async` for business-critical work.

---

## 16. Observability Design

### 16.1 Observability Questions

For every request/job/event, production support should answer:

1. What happened?
2. Who initiated it?
3. Which resource was affected?
4. Which module handled it?
5. Which transaction committed?
6. Which external call was made?
7. What was the latency?
8. Did retry happen?
9. Was the operation denied?
10. What correlation ID ties logs, metrics, trace, audit together?

### 16.2 Core Metrics

| Metric | Why |
|---|---|
| HTTP request latency by route/status | API SLO |
| error rate by problem code | failure classification |
| DB pool active/pending | bottleneck detection |
| transaction duration | lock/contention risk |
| outbound client latency/error | dependency health |
| message lag | async backlog |
| outbox pending count | delivery health |
| scheduled job duration/failure | operations health |
| batch job status | recoverability |
| authorization denied count | security signal |
| cache hit/miss by cache | performance/correctness |
| executor active/queue/rejected | saturation |

### 16.3 Cardinality Discipline

Bad metric tag:

```text
case_id=CASE-2026-000123
user_id=123456
email=person@example.com
```

Good metric tag:

```text
module=casefile
action=approve
status=success
problem_code=CASE_INVALID_TRANSITION
```

High-cardinality identifiers belong in logs/traces/audit, not metric labels.

### 16.4 Health vs Readiness

Do not put every dependency in liveness.

Liveness means:

```text
should Kubernetes restart this process?
```

Readiness means:

```text
should this process receive traffic now?
```

External dependency unavailable may make readiness down for a specific app, but should not necessarily trigger restart loop.

---

## 17. Testing Strategy

### 17.1 Test Pyramid for Spring System

```text
Many  : pure unit/domain tests
Many  : application service tests with fake ports
Some  : repository/integration tests
Some  : MVC slice tests
Some  : security tests
Some  : messaging/batch tests
Few   : full @SpringBootTest tests
Few   : end-to-end tests
```

### 17.2 What Should Not Need Spring Context

- state transition logic
- policy object with fake actor/resource
- value object parsing
- error code mapping
- command validation beyond Bean Validation
- idempotency decision rules
- retry classifier

### 17.3 What Needs Spring Context

- DI graph correctness
- auto-configuration behavior
- transaction behavior
- repository mapping
- MVC argument resolver and controller advice
- Spring Security filter chain/method security
- actuator exposure/security
- config binding
- module verification

### 17.4 Contract Tests

For API compatibility:

- request/response schema
- error schema
- version behavior
- idempotency behavior
- optimistic conflict behavior
- authorization status behavior

For external adapters:

- timeout handling
- retryable error mapping
- non-retryable error mapping
- invalid payload handling
- token refresh behavior

### 17.5 Test Data Discipline

Avoid test data hidden in giant SQL dumps.

Prefer builders:

```java
CaseFileFixture.submittedCase()
    .ownedBy(agencyId)
    .assignedTo(officerId)
    .withVersion(17)
    .build();
```

---

## 18. Configuration and Environment Governance

### 18.1 Configuration Ownership

Every production property should answer:

| Question | Example |
|---|---|
| Who owns it? | platform/team/module |
| Is it secret? | yes/no |
| Can it change at runtime? | yes/no |
| Is default safe? | yes/no |
| Is it tenant-specific? | yes/no |
| Is it validated? | yes/no |
| Is it documented? | yes/no |

### 18.2 Safe Defaults

Bad:

```yaml
external-agency:
  timeout: 0
  retry: true
  base-url: http://localhost:8080
```

Better:

```yaml
reguflow:
  external-agency:
    connect-timeout: 2s
    response-timeout: 5s
    max-attempts: 3
    backoff: 500ms
```

Then validate:

```java
@ConfigurationProperties("reguflow.external-agency")
@Validated
public record ExternalAgencyProperties(
    @NotNull Duration connectTimeout,
    @NotNull Duration responseTimeout,
    @Min(1) @Max(5) int maxAttempts,
    @NotNull Duration backoff
) {}
```

### 18.3 Profile Discipline

Avoid business behavior hidden in profiles.

Bad:

```java
@Profile("prod")
@Service
class RealApprovalPolicy {}

@Profile("uat")
@Service
class RelaxedApprovalPolicy {}
```

This changes correctness by environment.

Prefer config values only for infrastructure differences, not domain rules.

---

## 19. Deployment and Runtime Model

### 19.1 Spring Boot Runtime Units

Common production packaging:

```text
boot executable jar
container image
Kubernetes Deployment
ConfigMap/Secret
Service
Ingress/Gateway
Horizontal Pod Autoscaler
```

### 19.2 Graceful Shutdown

Need graceful shutdown for:

- HTTP request draining
- scheduler stop
- listener container stop
- batch job safety
- outbox lock release
- DB connection close
- tracing/log flushing

### 19.3 Readiness Startup Sequence

The app should become ready only after:

1. Application context refreshed.
2. Database migration complete or verified.
3. Required caches/reference data initialized if blocking startup.
4. Messaging listener ready if necessary.
5. Critical config validated.
6. Health groups reflect operational state.

### 19.4 Resource Sizing

Capacity is constrained by:

```text
min(HTTP threads/virtual threads, DB pool, external API rate, CPU, memory, broker partition concurrency, downstream latency)
```

Virtual threads do not remove DB pool or downstream bottleneck.

---

## 20. Security and Secret Handling

### 20.1 Secret Boundary

Secrets should not appear in:

- logs
- metrics tags
- trace attributes
- error detail
- actuator env endpoint exposed to broad users
- API response
- database audit metadata unless encrypted/masked

### 20.2 Actuator Security

Recommended:

- expose minimal endpoints externally
- put sensitive endpoints behind internal network/auth
- never expose `/env`, `/configprops`, `/heapdump`, `/threaddump` casually
- health/readiness can be exposed with sanitized details
- metrics exposure controlled

### 20.3 Authentication vs Authorization

Authentication answers:

```text
Who are you?
```

Authorization answers:

```text
Can you do this action on this resource in this state under this tenant context?
```

Do not collapse these into role string checks in controllers.

---

## 21. Migration and Evolution Strategy

### 21.1 Evolution Dimensions

Separate these where possible:

1. Java version upgrade.
2. Spring Boot upgrade.
3. Spring Framework upgrade.
4. `javax.*` to `jakarta.*` migration.
5. Spring Security configuration migration.
6. Persistence provider upgrade.
7. Database driver upgrade.
8. Build plugin upgrade.
9. Container base image upgrade.
10. Observability pipeline upgrade.

### 21.2 Upgrade Playbook

```text
1. inventory dependencies
2. identify unsupported libraries
3. upgrade tests first
4. run deprecation cleanup
5. apply automated rewrite where safe
6. migrate namespace
7. fix compile errors
8. fix runtime errors
9. run integration tests
10. run load/regression tests
11. deploy to lower env
12. compare metrics
13. canary rollout
14. rollback plan ready
```

### 21.3 Compatibility Matrix

Maintain a living table:

| Component | Current | Target | Owner | Risk | Status |
|---|---|---|---|---|---|
| Java | 17 | 21/25 | platform | medium | planned |
| Spring Boot | 3.5 | 4.x | platform | high | assess |
| Spring Security | aligned | aligned | security | high | planned |
| Hibernate | 6.x | compatible | persistence | medium | assess |
| DB driver | current | target | DBA/platform | medium | test |
| Observability | current | target | SRE | low/medium | planned |

---

## 22. Internal Platform Starter Application

### 22.1 Platform Starter Modules

Potential internal starters:

```text
reguflow-platform-web-starter
reguflow-platform-error-starter
reguflow-platform-security-starter
reguflow-platform-observability-starter
reguflow-platform-http-client-starter
reguflow-platform-audit-starter
reguflow-platform-tenant-starter
reguflow-platform-messaging-starter
reguflow-platform-test-starter
```

### 22.2 Starter Rules

Good starter:

- has clear properties
- backs off when user defines bean
- exposes customizer extension point
- documents behavior
- has tests with `ApplicationContextRunner`
- supports AOT/native if needed
- avoids business logic

Bad starter:

- creates hidden beans that cannot be overridden
- changes transaction behavior globally
- catches all exceptions
- hides security decisions
- depends on business module
- forces all apps into same architecture

---

## 23. Production Failure Mode Analysis

### 23.1 API Failure

| Failure | Prevention/Handling |
|---|---|
| duplicate submit | idempotency key |
| lost update | optimistic version/ETag |
| invalid state transition | domain state machine |
| unsafe error leak | Problem Details + safe detail |
| large response timeout | pagination/streaming/export job |

### 23.2 Transaction Failure

| Failure | Prevention/Handling |
|---|---|
| external call succeeds but DB rolls back | outbox/after-commit boundary |
| DB commits but event lost | transactional outbox |
| rollback rule wrong | explicit rollback tests |
| self-invocation bypasses transaction | proxy-aware design |
| transaction too long | move external work outside |

### 23.3 Security Failure

| Failure | Prevention/Handling |
|---|---|
| role too broad | permission/action model |
| cross-tenant access | tenant predicate + policy check |
| object-level bypass | service-layer policy enforcement |
| method security bypass | avoid internal proxy bypass assumptions |
| stale authorization cache | versioned key + short TTL + invalidation |

### 23.4 Messaging Failure

| Failure | Prevention/Handling |
|---|---|
| duplicate message | idempotent consumer |
| poison message retry storm | retry limit + DLQ |
| out-of-order processing | partition/key strategy |
| broker unavailable | backoff + readiness signal |
| message schema break | versioned contract |

### 23.5 Operations Failure

| Failure | Prevention/Handling |
|---|---|
| app receives traffic before ready | readiness probe |
| pod killed mid-job | graceful shutdown + work claiming |
| actuator leaks secrets | endpoint exposure/security policy |
| metrics cardinality explosion | tag governance |
| no trace across modules | correlation propagation |

---

## 24. End-to-End Request Walkthrough: Approve Case

### 24.1 Request

```http
POST /cases/CASE-2026-000123/approval
Authorization: Bearer <token>
Idempotency-Key: 0191e8db-7c3b-7d13-9f14-b86a9ed3a9ef
If-Match: "17"
Content-Type: application/json

{
  "reason": "All required checks passed."
}
```

### 24.2 Runtime Flow

```text
1. API gateway accepts request
2. Spring Security filter chain authenticates JWT/session
3. Tenant/actor context resolved
4. DispatcherServlet maps route
5. Argument resolvers bind path/body/principal
6. Bean Validation validates request
7. Controller maps request to command
8. Application service begins transaction
9. Idempotency key checked/claimed
10. Case aggregate loaded with version
11. Authorization policy validates actor/resource/state
12. Domain transition approve() executes
13. Audit event inserted
14. Outbox event inserted
15. Transaction commits
16. Response returned
17. Outbox worker later sends notification/external event
18. Metrics/logs/traces/audit correlate via correlation ID
```

### 24.3 What Must Be True

```text
- invalid actor cannot approve
- maker cannot approve own prepared case if policy forbids
- stale version gets 409
- duplicate request returns same result or safe conflict
- external notification failure does not rollback approval
- audit exists for approval
- outbox eventually delivers or surfaces failure
- logs contain correlation ID
- metrics record latency and outcome
```

This is the level of thinking expected in real production systems.

---

## 25. Architecture Decision Records

### ADR Example: Modular Monolith First

```text
Title: Use modular monolith as initial architecture

Context:
ReguFlow has tightly coupled workflow, authorization, audit, and case lifecycle rules.
Splitting services early would introduce distributed consistency and duplicated policy logic.

Decision:
Use Spring Boot modular monolith with Spring Modulith verification. Use internal events and outbox for external integration.

Consequences:
+ simpler transaction boundary
+ stronger local consistency
+ easier refactoring
+ lower operational overhead
- requires discipline on module boundaries
- service extraction must be planned later
```

### ADR Example: Transactional Outbox

```text
Title: Use transactional outbox for external integration events

Context:
Case approval must commit internal state and eventually notify external parties. Direct HTTP/broker publish inside transaction can cause inconsistent side effects.

Decision:
Write outbox event in same database transaction as case state change. A worker publishes events with retry and DLQ semantics.

Consequences:
+ no lost committed event
+ retryable delivery
+ operational visibility
- eventual consistency
- requires outbox cleanup/reconciliation
```

### ADR Example: Problem Details Error Contract

```text
Title: Standardize API errors using Problem Details with internal error code

Context:
Clients need consistent error shape and retry semantics.

Decision:
Expose Problem Details style response with errorCode, correlationId, retryable flag, and safe detail.

Consequences:
+ consistent client handling
+ better observability
+ safer error exposure
- requires governance for error catalog
```

---

## 26. Code Skeleton

### 26.1 Package Skeleton

```text
com.example.reguflow
  ReguFlowApplication.java

com.example.reguflow.casefile
  api/
    CaseController.java
    CaseResponse.java
    ApproveCaseRequest.java
  application/
    ApproveCaseUseCase.java
    AssignCaseUseCase.java
    SearchCasesQueryService.java
  domain/
    CaseFile.java
    CaseStatus.java
    CaseRepository.java
    CaseApprovalPolicy.java
    CaseApproved.java
  infrastructure/
    JpaCaseRepository.java
    CaseFileEntity.java
    CaseMapper.java
  internal/

com.example.reguflow.notification
  application/
  domain/
  infrastructure/

com.example.reguflow.audit
  application/
  domain/
  infrastructure/

com.example.reguflow.integration
  outbox/
  externalagency/

com.example.reguflow.platform
  error/
  security/
  observability/
  tenancy/
  web/
```

### 26.2 Controller

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    private final ApproveCaseUseCase approveCase;

    @PostMapping("/{caseId}/approval")
    ResponseEntity<CaseDecisionResponse> approve(
            @PathVariable String caseId,
            @RequestHeader("If-Match") String version,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody ApproveCaseRequest request,
            AuthenticatedActor actor) {

        ApproveCaseCommand command = request.toCommand(
                CaseId.parse(caseId),
                VersionHeader.parse(version),
                IdempotencyKey.parse(idempotencyKey),
                actor
        );

        CaseDecisionResult result = approveCase.approve(command);
        return ResponseEntity.ok(CaseDecisionResponse.from(result));
    }
}
```

### 26.3 Use Case

```java
@Service
class ApproveCaseUseCase {

    private final CaseRepository cases;
    private final CaseApprovalPolicy policy;
    private final AuditService audit;
    private final Outbox outbox;
    private final IdempotencyService idempotency;
    private final Clock clock;

    @Transactional
    public CaseDecisionResult approve(ApproveCaseCommand command) {
        return idempotency.execute(command.idempotencyKey(), command.requestHash(), () -> {
            CaseFile caseFile = cases.getRequired(command.caseId());
            caseFile.assertVersion(command.expectedVersion());

            policy.assertCanApprove(command.actor(), caseFile);
            caseFile.approve(command.reason(), clock.instant());

            audit.recordCaseApproved(caseFile, command.actor(), command.reason());
            outbox.enqueue(CaseApprovedIntegrationEvent.from(caseFile));

            return CaseDecisionResult.from(caseFile);
        });
    }
}
```

### 26.4 Domain

```java
public final class CaseFile {

    private final CaseId id;
    private CaseStatus status;
    private Version version;
    private DecisionReason decisionReason;
    private Instant approvedAt;

    public void approve(DecisionReason reason, Instant now) {
        if (!status.canApprove()) {
            throw CaseProblems.invalidTransition(id, status, CaseStatus.APPROVED);
        }
        this.status = CaseStatus.APPROVED;
        this.decisionReason = reason;
        this.approvedAt = now;
        this.version = version.next();
    }
}
```

### 26.5 Outbox Worker

```java
@Component
class OutboxWorker {

    private final OutboxService outbox;

    @Scheduled(fixedDelayString = "${reguflow.outbox.poll-delay:PT5S}")
    void publish() {
        outbox.publishDueEvents();
    }
}
```

In multi-replica deployment, this must use safe claiming/locking.

---

## 27. Review Rubric: Is This Production-Grade?

Use this checklist in architecture review or PR review.

### 27.1 Boundary

```text
[ ] Module boundary is explicit
[ ] Illegal module dependency is tested
[ ] Controller does not own business logic
[ ] Domain invariant is not hidden in UI
[ ] External API model does not leak into domain
[ ] Platform starter does not contain business rule
```

### 27.2 Transaction

```text
[ ] Transaction boundary is at use-case level
[ ] External calls are outside transaction or via outbox
[ ] Rollback behavior is explicit
[ ] Self-invocation does not break transaction/proxy expectation
[ ] Long-running work is not inside DB transaction
[ ] Optimistic conflict is handled
```

### 27.3 API

```text
[ ] API expresses use case, not table update
[ ] Error contract is consistent
[ ] Idempotency exists for retryable commands
[ ] Version/ETag prevents lost update
[ ] Pagination/streaming handles large data
[ ] Sensitive fields are not exposed
```

### 27.4 Security

```text
[ ] Authentication is separate from authorization
[ ] Object-level authorization exists for material actions
[ ] Tenant isolation is enforced in service/query layer
[ ] Method security/proxy limitation is understood
[ ] Security-denied events are auditable
[ ] Export/report endpoints enforce same visibility rule
```

### 27.5 Messaging/Async

```text
[ ] Business-critical async work is durable
[ ] Consumers are idempotent
[ ] Retry limit and DLQ exist
[ ] Poison messages do not block everything
[ ] Scheduler is safe in multi-replica deployment
[ ] Backlog is observable
```

### 27.6 Observability

```text
[ ] Correlation ID propagates across request/job/event
[ ] Metrics have low-cardinality tags
[ ] Logs are structured and safe
[ ] Traces cover external calls
[ ] Audit is not confused with debug log
[ ] Health/readiness/liveness are correctly separated
```

### 27.7 Testing

```text
[ ] Domain behavior has pure unit tests
[ ] Use cases have transaction/policy tests
[ ] Controllers have slice tests
[ ] Security matrix is tested
[ ] Repository behavior is tested with real DB/container where needed
[ ] Full context tests are few and meaningful
[ ] Contract tests protect API compatibility
```

### 27.8 Operations

```text
[ ] Graceful shutdown is configured
[ ] Actuator exposure is secured
[ ] Runbook exists for common failures
[ ] Outbox/retry/DLQ has operational visibility
[ ] Config properties are validated
[ ] Migration plan exists for framework upgrades
```

---

## 28. Common Capstone Anti-Patterns

### 28.1 Annotation-Driven Architecture Without Model

Symptom:

```text
everything works because annotation magic says so
```

Failure:

- proxy bypass
- hidden transaction issue
- untestable logic
- accidental side effects

Fix:

```text
make boundaries explicit and test them
```

### 28.2 Service Layer as Transaction Script Dump

Symptom:

```java
@Service
class CaseService {
   // 3000 lines of if/else workflow
}
```

Fix:

- split use cases
- extract policy
- move invariant to domain model
- use state transition object
- introduce module boundary

### 28.3 Repository as Business Policy

Symptom:

```java
findApprovableCasesForOfficerWithAllRules(...)
```

Fix:

- repository filters data
- policy explains decision
- service composes both

### 28.4 Cache as Correctness Layer

Symptom:

```text
system is only correct when cache is warm
```

Fix:

```text
cache improves performance; source of truth remains durable state
```

### 28.5 Event as Synchronous Function Call Replacement

Symptom:

```text
module A publishes event because it does not want to call module B, but actually expects B to finish immediately
```

Fix:

- if synchronous result is required, call explicit port
- if event is fact, do not depend on immediate handling
- if external consistency required, use workflow/outbox/reconciliation

### 28.6 Microservices as Escape from Bad Modularity

Symptom:

```text
monolith is messy, so split it into services
```

Result:

```text
distributed messy monolith
```

Fix:

```text
first create real module boundaries inside the monolith
```

---

## 29. What Top 1% Spring Engineering Looks Like

Top-tier Spring engineering is not memorizing every annotation.

It looks like this:

1. You can explain startup failure by phase.
2. You can predict whether an annotation uses proxy and when it fails.
3. You design transaction boundary before coding repository calls.
4. You treat external calls as unreliable by default.
5. You design idempotency for retryable operations.
6. You know when not to use cache.
7. You know when not to use WebFlux.
8. You know virtual threads reduce thread cost but not downstream bottlenecks.
9. You can build custom starter without making hidden magic.
10. You can test auto-configuration with small context.
11. You can diagnose bean ambiguity from dependency resolution rules.
12. You can migrate Spring versions by inventory and risk, not hope.
13. You can produce architecture decisions with consequences.
14. You can draw module boundaries that match business invariants.
15. You can make observability useful for support, not just dashboard decoration.

The difference is not syntax.

The difference is judgment.

---

## 30. Final System Blueprint Summary

A strong Spring production system has these properties:

```text
- explicit module boundaries
- clear use-case application services
- domain invariants outside controllers
- transaction boundaries around internal consistency
- external side effects through outbox/async boundary
- object-level authorization
- tenant-aware data access
- consistent Problem Details error contract
- idempotency for retryable commands
- optimistic concurrency for state changes
- durable audit trail
- observable request/job/event flow
- tested DI/config/security/transaction behavior
- secure actuator exposure
- bounded async execution
- safe scheduler in multi-replica runtime
- documented ADRs
- migration-ready dependency governance
- internal starters that create guardrails, not hidden traps
```

This is the capstone mental model:

```text
Spring is powerful because it provides boundaries.
Production systems fail when those boundaries are implicit.
Advanced engineers make those boundaries explicit, verified, observable, and evolvable.
```

---

## 31. Source References

Official references used as grounding for this capstone and the series direction:

1. Spring Framework Reference — Core Technologies: https://docs.spring.io/spring-framework/reference/core.html
2. Spring Boot Reference — Production-ready Features / Actuator: https://docs.spring.io/spring-boot/reference/actuator/index.html
3. Spring Boot Project Page: https://spring.io/projects/spring-boot
4. Spring Security Reference — Servlet Authorization Architecture: https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html
5. Spring Security Reference — Authorization: https://docs.spring.io/spring-security/reference/servlet/authorization/index.html
6. Spring Modulith Reference — Application Events: https://docs.spring.io/spring-modulith/reference/events.html
7. Spring Modulith Project Repository: https://github.com/spring-projects/spring-modulith

---

## 32. Seri Selesai

Dengan Part 35 ini, seri:

```text
learn-java-spring-framework-boot-enterprise-runtime-engineering
```

sudah selesai dari Part 0 sampai Part 35.

Daftar lengkap:

```text
00-spring-as-runtime-scope-roadmap.md
01-ioc-container-beandefinition-beanfactory-applicationcontext.md
02-dependency-injection-resolution-algorithm.md
03-bean-lifecycle-extension-points.md
04-annotation-metadata-component-scanning-internals.md
05-configuration-model-bean-full-lite-mode.md
06-environment-propertysource-profiles-config-binding.md
07-spring-boot-auto-configuration-internals.md
08-application-startup-bootstrap-failure-diagnostics.md
09-spring-aop-proxy-method-interception.md
10-spring-transaction-management-beyond-transactional.md
11-spring-data-integration-model.md
12-spring-webmvc-runtime-internals.md
13-rest-api-engineering-with-spring.md
14-webflux-reactive-spring-architecture.md
15-spring-http-clients-restclient-webclient-http-interface.md
16-validation-binding-conversion-data-boundary.md
17-error-handling-problem-details-failure-semantics.md
18-spring-security-application-architecture.md
19-spring-caching-semantics-consistency-risk.md
20-async-scheduling-events-execution-model.md
21-virtual-threads-concurrency-spring-java-21-25.md
22-spring-messaging-jms-amqp-kafka-boundary.md
23-spring-integration-enterprise-integration-patterns.md
24-spring-batch-stateful-job-runtime.md
25-spring-boot-actuator-micrometer-observability.md
26-testing-spring-applications-at-scale.md
27-modular-monolith-spring-modulith.md
28-multitenancy-enterprise-platform-patterns.md
29-native-image-aot-runtime-hints.md
30-performance-engineering-for-spring-applications.md
31-spring-cloud-distributed-system-integration.md
32-spring-security-advanced-authorization-policy.md
33-migration-engineering-spring5-6-7-boot2-3-4.md
34-building-internal-spring-platform-starters-guardrails.md
35-capstone-production-grade-spring-system-end-to-end.md
```



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./34-building-internal-spring-platform-starters-guardrails.md">⬅️ Part 34 — Building Internal Spring Platform: Starters, Conventions, Guardrails</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<span></span>
</div>
