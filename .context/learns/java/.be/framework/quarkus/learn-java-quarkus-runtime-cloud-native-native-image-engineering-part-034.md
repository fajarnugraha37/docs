# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-034
# Enterprise Architecture with Quarkus: Modular Monolith, Microservices, Regulatory Workflows

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Part: `034`  
> Topik: Enterprise Architecture with Quarkus: Modular Monolith, Microservices, Regulatory Workflows  
> Status: Materi lanjutan advance — setelah extension engineering  
> Target: Software engineer / tech lead yang mampu mendesain arsitektur enterprise Quarkus untuk workflow regulatory, case management, audit, compliance, modular monolith, microservices, event-driven integration, dan production ownership

---

## 0. Ringkasan Besar

Quarkus sering diposisikan sebagai framework cloud-native untuk microservices.

Itu benar, tetapi tidak lengkap.

Quarkus juga sangat cocok untuk:

- modular monolith,
- batch/job services,
- event-driven services,
- API gateway-adjacent services,
- command-line tools,
- serverless functions,
- enterprise integration,
- regulatory workflow,
- case management systems,
- audit-heavy applications,
- hybrid monolith-to-microservice migration.

Dokumentasi dan blog resmi Quarkus menekankan bahwa Quarkus dibangun di atas reactive core, mendukung beragam development model, dan cocok untuk aplikasi modern yang scalable dan resilient. Salah satu blog resmi Quarkus tentang aplikasi besar juga menyebut bahwa meskipun Quarkus awalnya banyak ditargetkan untuk microservices, Quarkus juga cocok untuk large monoliths, baik untuk migrasi aplikasi existing maupun membangun aplikasi baru.

Part ini membahas arsitektur enterprise, bukan sekadar coding Quarkus.

Pertanyaan utama:

```text
Kapan memakai modular monolith?
Kapan memecah microservice?
Bagaimana menjaga boundary?
Bagaimana regulatory workflow dimodelkan?
Bagaimana audit/compliance menjadi first-class?
Bagaimana transaction boundary dan event boundary dirancang?
Bagaimana Quarkus membantu tanpa membuat arsitektur over-engineered?
```

---

## 1. Mental Model: Architecture Is Boundary Design

Enterprise architecture bukan tentang memilih:

```text
monolith vs microservices
REST vs messaging
JVM vs native
blocking vs reactive
```

Architecture adalah desain boundary:

```text
business boundary
transaction boundary
team boundary
deployment boundary
security boundary
data ownership boundary
audit boundary
operational boundary
failure boundary
```

Microservices gagal jika boundary salah.

Monolith gagal jika boundary hilang.

Modular monolith sukses jika boundary kuat meski deployment satu.

Quarkus membantu di banyak sisi:

- CDI untuk modular composition,
- REST/JAX-RS/Quarkus REST untuk API,
- Hibernate/JTA untuk transaction boundary,
- Reactive Messaging untuk event boundary,
- OIDC/security untuk security boundary,
- SmallRye Health/Micrometer/OTel untuk operational boundary,
- extension model untuk platform boundary,
- native/JVM/container untuk deployment strategy.

Tetapi Quarkus tidak memilih boundary untukmu.

---

## 2. Modular Monolith vs Microservices

### 2.1 Monolith Buruk

Monolith buruk biasanya:

```text
semua module akses semua table
semua service panggil semua repository
tidak ada ownership
tidak ada package boundary
transaction besar
deploy lambat
test lambat
perubahan kecil berisiko global
```

Ini bukan masalah “monolith”.

Ini masalah “tanpa modularity”.

### 2.2 Modular Monolith

Modular monolith:

```text
satu deployable artifact,
tetapi internal domain modules punya boundary jelas.
```

Karakteristik:

- module ownership jelas,
- package boundary,
- internal API antar module,
- data ownership logical,
- transaction boundary sadar,
- event internal bisa dipakai,
- dependency direction dikontrol,
- test per module,
- bisa dipecah menjadi microservice bila boundary matang.

### 2.3 Microservices

Microservices:

```text
banyak deployable artifact,
setiap service punya data dan operation boundary sendiri.
```

Karakteristik:

- independent deployment,
- independent scaling,
- independent data ownership,
- remote communication,
- distributed transactions avoided,
- eventual consistency,
- observability wajib,
- operational overhead tinggi.

### 2.4 Keputusan

Pilih modular monolith jika:

- domain belum stabil,
- tim belum banyak,
- transaction boundary masih berubah,
- operasi microservice terlalu mahal,
- latency rendah dibutuhkan,
- data sangat terhubung,
- release cadence sama.

Pilih microservices jika:

- boundary sudah matang,
- team ownership terpisah,
- scaling berbeda,
- deployment lifecycle berbeda,
- data ownership jelas,
- compliance/security boundary perlu isolasi,
- fault isolation penting,
- organisasi siap operasional.

Rule:

```text
Start modular. Split only when boundary and operational reason are clear.
```

---

## 3. Quarkus for Large Applications

Quarkus official blog on faster builds notes that Quarkus is also perfectly suited for large monoliths, not only microservices. This matters because many enterprise systems are not naturally hundreds of independent services.

For regulatory systems, a modular monolith can be better initially because:

- workflow states highly coupled,
- transaction consistency matters,
- audit trail must be complete,
- cross-module reporting common,
- domain model evolves,
- team is not huge,
- deployment governance is centralized.

Quarkus can still keep the monolith cloud-native:

- fast startup relative to traditional enterprise stacks,
- container-ready,
- health/metrics/traces,
- build-time optimization,
- native option,
- Dev Services,
- extension ecosystem,
- REST/messaging/security support.

---

## 4. Bounded Context

Bounded context is a domain boundary where terms/models have specific meaning.

Example regulatory/case system contexts:

```text
Application Management
Case Management
Compliance
Appeal
Correspondence
Document
Payment/Revenue
Profile
Examination
Notification
Survey
Audit
Administration
Reporting
```

Term example:

```text
"Status"
```

Meaning differs:

- application status,
- case status,
- payment status,
- document status,
- user account status.

Do not use one global enum for all statuses.

Bounded context owns its model.

---

## 5. Module Organization in Quarkus

Example modular monolith package layout:

```text
com.acme.regulatory
  application
    api
    app
    domain
    persistence
    integration
  casework
    api
    app
    domain
    persistence
    integration
  compliance
    api
    app
    domain
    persistence
    integration
  document
    api
    app
    domain
    persistence
    integration
  audit
    api
    app
    domain
    persistence
  shared
    kernel
    security
    observability
```

Layer meaning:

- `api`: REST DTO/resource or public module API.
- `app`: application services/use cases.
- `domain`: entities, value objects, policies.
- `persistence`: repositories, ORM mapping.
- `integration`: outbound gateways, event adapters.

Avoid:

```text
shared everything
common mega module
util dumping ground
cross-context entity reuse
```

---

## 6. Dependency Direction

Good dependency direction:

```text
api -> app -> domain
app -> persistence interfaces/gateways
persistence implements repository
integration implements outbound ports
```

Within modular monolith:

```text
application.app can call casework.api internal facade
but should not access casework.persistence directly
```

Bad:

```java
application.ApplicationService
    -> casework.CaseRepository
    -> compliance.ComplianceEntity
```

Better:

```java
application.ApplicationService
    -> casework.api.CaseCreationPort
```

Boundary should be visible in package and code.

---

## 7. Internal Module API

Expose internal module API:

```java
public interface CaseCreationPort {
    CaseId createCaseForApplication(ApplicationCaseRequest request);
}
```

Application module uses port:

```java
@ApplicationScoped
public class ApplicationSubmissionService {

    private final CaseCreationPort caseCreationPort;

    public SubmitResult submit(SubmitCommand command) {
        ...
        CaseId caseId = caseCreationPort.createCaseForApplication(...);
        ...
    }
}
```

Case module owns implementation:

```java
@ApplicationScoped
public class CaseCreationService implements CaseCreationPort {
    ...
}
```

This gives modular boundary even in one artifact.

If later split to microservice, `CaseCreationPort` can become REST/messaging gateway.

---

## 8. Data Ownership

In modular monolith, database may be physically shared, but ownership should be logical.

Example:

```text
application_* tables owned by Application module
case_* tables owned by Case module
document_* tables owned by Document module
audit_* tables owned by Audit module
```

Rules:

- module can write only own tables,
- other modules access via API/facade,
- cross-module query read models allowed only deliberately,
- reporting uses read model/replica/view if needed,
- no random joins across contexts in business logic.

In microservices, physical ownership becomes stronger:

```text
one service owns its database/schema
other services cannot directly query it
```

---

## 9. Regulatory Workflow Modeling

Regulatory workflows are stateful.

Examples:

```text
DRAFT
SUBMITTED
PENDING_PAYMENT
UNDER_REVIEW
PENDING_DOCUMENTS
APPROVED
REJECTED
EXPIRED
WITHDRAWN
SUSPENDED
```

Do not model workflow as arbitrary string update.

Use state machine concepts:

```text
state
transition
guard
actor
reason
side effects
audit event
deadline
SLA
```

Example:

```java
public StateTransition approve(Officer officer, String reason) {
    requireState(ApplicationStatus.UNDER_REVIEW);
    requirePermission(officer, Permission.APPROVE_APPLICATION);
    requireReason(reason);

    ApplicationStatus from = status;
    status = ApplicationStatus.APPROVED;

    return new StateTransition(from, status, "APPROVE", reason);
}
```

State transition is domain logic, not controller logic.

---

## 10. Workflow Side Effects

State transition may trigger side effects:

- audit event,
- notification,
- case creation,
- document lock,
- payment update,
- screening request,
- event publication,
- SLA timer,
- report projection.

Separate:

```text
state change transaction
side-effect publication
```

Use outbox for asynchronous side effects.

Bad:

```java
@Transactional
public void approve(...) {
    application.approve(...);
    emailClient.send(...);
    externalRegistry.update(...);
}
```

Better:

```java
@Transactional
public void approve(...) {
    StateTransition transition = application.approve(...);
    auditRepository.insert(...);
    outbox.insert(ApplicationApprovedEvent.from(...));
}
```

Publisher handles external side effects.

---

## 11. Transaction Boundary

Quarkus transactions guide explains that the `quarkus-narayana-jta` extension provides a transaction manager based on Jakarta Transactions, and Hibernate ORM guide recommends wrapping database-modifying methods in `@Transactional`, commonly at application entry point boundaries.

In architecture terms:

```text
transaction boundary should align with consistency boundary.
```

Good transaction boundary:

```text
approve application
  update application
  insert audit event
  insert outbox event
commit
```

Bad transaction boundary:

```text
approve application
  update application
  call external identity API
  send email
  update external case system
  commit
```

Remote calls are not part of local ACID transaction.

Use:

- outbox,
- idempotency,
- saga/process manager,
- reconciliation,
- compensating action.

---

## 12. Consistency Models

Enterprise systems need multiple consistency models:

### 12.1 Strong Local Consistency

Within one aggregate/module transaction:

```text
application status and audit event commit together
```

### 12.2 Eventual Consistency

Across modules/services:

```text
application approved -> notification eventually sent
application approved -> reporting projection eventually updated
```

### 12.3 Read-Your-Writes

User expects immediate confirmation.

Could be satisfied by local write response, even if projections lag.

### 12.4 Monotonic Workflow

State must not go backwards unless explicit transition.

### 12.5 Idempotent External Consistency

External side effect can be retried safely.

Know which model applies.

---

## 13. Transactional Outbox

Outbox pattern:

```text
In same DB transaction:
  update business table
  insert outbox row
After commit:
  publisher reads outbox and publishes event
```

Benefits:

- no lost event after DB commit,
- no event published before rollback,
- retryable publishing,
- auditability,
- decouples external systems.

Quarkus ecosystem includes messaging and Debezium-friendly patterns; Quarkus blog/newsletter posts have covered implementing transactional outbox with Debezium in Quarkus, and Hibernate Search has an outbox-polling coordination extension for indexing. For general architecture, the outbox pattern remains a core strategy.

Outbox row:

```text
id
aggregate_type
aggregate_id
event_type
event_version
payload
status
created_at
published_at
attempt_count
next_attempt_at
correlation_id
idempotency_key
```

Publisher can be:

- polling job,
- Debezium CDC,
- database trigger/stream,
- message relay.

---

## 14. Saga / Process Manager

When workflow spans multiple services:

```text
Application service
Payment service
Case service
Notification service
External registry
```

Do not use distributed transaction by default.

Use saga/process manager:

```text
submit application
  -> request payment
  -> wait payment confirmed
  -> create case
  -> notify applicant
```

Each step:

- command/event,
- idempotency,
- timeout,
- retry,
- compensation,
- audit.

Saga state:

```text
saga_id
business_id
current_step
status
last_event
deadline
retry_count
correlation_id
```

Quarkus can implement saga with:

- DB state,
- scheduler/job,
- reactive messaging,
- outbox,
- REST clients,
- fault tolerance.

---

## 15. Audit and Compliance as First-Class Architecture

Regulatory systems require audit by design.

Audit should not be optional logging.

Audit event must answer:

```text
who
did what
to which object
from what state
to what state
when
under what authority
with what reason
with what result
```

Audit requirements:

- same transaction for critical business changes,
- immutable/append-only,
- retention policy,
- access control,
- search/query,
- redaction strategy,
- correlation ID,
- actor type,
- system/job actor support.

Architecture rule:

```text
If a business action changes legal/regulatory state, audit is part of transaction.
```

---

## 16. Security Boundary

Enterprise Quarkus app needs layered security:

1. Authentication
   - OIDC/JWT/session.

2. Coarse authorization
   - endpoint role.

3. Fine-grained authorization
   - domain permission/resource ownership.

4. Tenant boundary
   - data access and cache keys.

5. Method security
   - service-level protection.

6. Outbound token strategy
   - propagation vs client credentials.

7. Audit of denied/high-risk actions.

Quarkus Security overview says Quarkus security framework provides built-in mechanisms including Basic, Form, and mTLS authentication, and OIDC guides cover bearer token/auth code flows. OAuth2 RBAC guide covers secured access to REST endpoints using OAuth2 tokens.

But role checks alone are not enough.

Example:

```java
@RolesAllowed("OFFICER")
public void approve(String applicationId) {
    ...
}
```

Need domain check:

```text
Is officer assigned?
Same tenant?
Application in correct state?
Permission granted for this operation?
Conflict of interest?
Delegation valid?
```

---

## 17. Tenant Boundary

Tenant must be part of:

- authentication claims,
- authorization checks,
- repository filters,
- cache keys,
- audit events,
- logs/MDC,
- metrics only if low-cardinality/safe,
- outbox events,
- message headers,
- external calls.

Bad:

```java
repository.findById(id);
```

Better:

```java
repository.findByTenantAndId(tenantId, id);
```

Cache key:

```text
tenant:{tenantId}:application:{applicationId}
```

Audit:

```json
{
  "tenantId": "CEA",
  "aggregateId": "APP-123"
}
```

Tenant leak is high severity.

---

## 18. Authorization as Domain Policy

Do not bury authorization in controller only.

Example policy:

```java
public final class ApplicationApprovalPolicy {

    public Decision canApprove(Officer officer, Application application) {
        if (!officer.tenantId().equals(application.tenantId())) {
            return Decision.deny("WRONG_TENANT");
        }

        if (!officer.hasPermission("application.approve")) {
            return Decision.deny("MISSING_PERMISSION");
        }

        if (!application.isAssignedTo(officer)) {
            return Decision.deny("NOT_ASSIGNED");
        }

        if (!application.status().canApprove()) {
            return Decision.deny("INVALID_STATE");
        }

        return Decision.allow();
    }
}
```

Test policy heavily with unit tests.

Use Quarkus security to authenticate and enforce coarse access, then domain policy for resource-level decision.

---

## 19. API Boundary

REST API design for enterprise workflow:

- explicit command endpoints,
- not generic CRUD for state transition,
- stable error contract,
- idempotency key for side effects,
- correlation ID,
- pagination,
- optimistic locking/version,
- validation error details,
- role/permission behavior documented.

Bad:

```http
PATCH /applications/APP-123
{ "status": "APPROVED" }
```

Better:

```http
POST /applications/APP-123/approve
Idempotency-Key: approve-APP-123-20260620

{
  "reason": "Documents verified",
  "version": 12
}
```

This expresses business command.

---

## 20. Error Contract

Enterprise API should avoid random 500.

Error taxonomy:

```text
VALIDATION_ERROR
AUTHENTICATION_REQUIRED
AUTHORIZATION_DENIED
RESOURCE_NOT_FOUND
STATE_CONFLICT
IDEMPOTENCY_CONFLICT
DEPENDENCY_UNAVAILABLE
RATE_LIMITED
UNEXPECTED_ERROR
```

Response:

```json
{
  "type": "https://example.com/errors/state-conflict",
  "title": "Invalid state transition",
  "status": 409,
  "code": "STATE_CONFLICT",
  "correlationId": "corr-123",
  "details": {
    "fromState": "DRAFT",
    "requiredState": "UNDER_REVIEW"
  }
}
```

This supports frontend, support, logs, and audit.

---

## 21. Module Communication Patterns

Within modular monolith:

1. Direct internal facade call.
2. Domain event in same process.
3. Outbox even inside same DB.
4. Shared read model.
5. Query service.

Avoid:

- direct repository access across module,
- entity sharing,
- circular dependencies.

For microservices:

1. REST synchronous command/query.
2. Messaging asynchronous event.
3. CDC/outbox.
4. API gateway.
5. read model replication.

Choose based on consistency and ownership.

---

## 22. Synchronous vs Asynchronous Integration

Use synchronous when:

- caller needs answer now,
- dependency latency reliable,
- operation part of user decision,
- failure can be shown directly,
- transaction not held during remote call.

Use asynchronous when:

- side effect can happen later,
- dependency unreliable/slow,
- retry required,
- operation high volume,
- event-driven projection,
- email/notification/reporting,
- external registry update.

Examples:

```text
Identity validation before submit: sync, strict timeout.
Email notification after approval: async outbox.
Reporting projection: async event.
Payment confirmation: async saga/event, maybe sync check depending UX.
```

---

## 23. Regulatory Workflow Example

Flow:

```text
Applicant submits application.
System validates identity.
Application becomes SUBMITTED.
Audit event inserted.
Outbox emits ApplicationSubmitted.
Case module creates review case.
Officer reviews documents.
Officer approves/rejects.
Notification sent.
Reporting projection updated.
```

Architecture:

```text
Application module:
  owns application state

Case module:
  owns review case state

Audit module:
  owns audit events

Notification module:
  async side effects

Reporting module:
  read model/projection
```

Transaction:

```text
submit:
  insert application
  insert audit
  insert outbox
commit
```

Async:

```text
outbox publisher -> ApplicationSubmitted event -> Case module creates case
```

---

## 24. Case Management Boundary

Case management should not be a generic “task table” for everything.

Case has:

- case type,
- lifecycle,
- assignment,
- SLA,
- priority,
- queue,
- documents,
- notes,
- decisions,
- audit.

Application may create case, but Case module owns:

```text
case state
assignment
case SLA
case decision workflow
```

Application module should not update case tables directly.

---

## 25. Document Boundary

Documents often have special compliance rules:

- storage,
- retention,
- virus scan,
- access control,
- download audit,
- metadata,
- redaction,
- versioning,
- classification,
- encryption,
- external object storage.

Document module owns:

```text
document metadata
access rules
storage reference
scan status
download audit
```

Other modules reference document IDs.

Do not embed document binary in every module table.

---

## 26. Reporting Boundary

Reporting often tempts cross-module joins.

Better patterns:

- read model/projection,
- materialized views,
- analytics store,
- CDC to warehouse,
- OpenSearch/ClickHouse,
- scheduled export.

Avoid:

```text
business transaction queries 20 module tables for report
```

Reporting is read-optimized and can be eventually consistent.

Regulatory reports may need snapshot/audit consistency; design explicitly.

---

## 27. Search Boundary

Search is not source of truth.

Search index can lag.

Use:

- Hibernate Search/OpenSearch,
- outbox/CDC indexing,
- rebuild process,
- index version,
- fallback to DB for critical exact lookup.

Do not store authoritative state only in search.

---

## 28. External System Boundary

External systems:

- identity provider,
- payment provider,
- address API,
- regulator registry,
- notification provider,
- document scan service.

Wrap with gateway:

```java
public interface IdentityVerificationPort {
    IdentityResult verify(ApplicantId id);
}
```

Implementation:

```java
@ApplicationScoped
public class IdentityVerificationGateway implements IdentityVerificationPort {
    ...
}
```

Gateway owns:

- REST client,
- timeout,
- retry,
- error mapping,
- token strategy,
- cache,
- rate limit,
- observability.

Domain uses port, not HTTP client.

---

## 29. Operational Ownership

Every module/service needs owner.

Ownership includes:

- code,
- data,
- API contract,
- alerts,
- dashboards,
- runbooks,
- deployment,
- incident response,
- data retention,
- security controls.

Microservices without ownership become distributed monolith.

Modular monolith without ownership becomes big ball of mud.

---

## 30. Migration Strategy: Monolith to Modular to Microservice

Good path:

```text
1. Identify bounded contexts.
2. Introduce package/module boundary.
3. Stop cross-module repository access.
4. Introduce internal facades/ports.
5. Separate tables logically.
6. Introduce outbox events.
7. Build read models.
8. Extract service when boundary stable and operational reason exists.
```

Bad path:

```text
split database tables into services first,
then discover transactions/business rules were coupled.
```

Extract only when:

- module has clear data ownership,
- API contract stable,
- events defined,
- team owns it,
- deployment independence valuable,
- eventual consistency accepted.

---

## 31. Quarkus Architecture Blueprint

Example enterprise Quarkus modular monolith:

```text
application-service
  Quarkus REST
  Hibernate ORM
  Narayana JTA
  Reactive Messaging
  OIDC Security
  Micrometer/OTel
  SmallRye Health

Modules:
  application
  casework
  document
  audit
  notification
  reporting
  administration

Infrastructure:
  Oracle/PostgreSQL
  Redis
  Kafka/RabbitMQ
  OpenSearch/ClickHouse for reporting/search
  S3/object storage
  Keycloak/OIDC
```

Deployment:

```text
single artifact initially
module boundaries enforced in code
outbox for async boundary
read model for reporting/search
later extract high-pressure module
```

---

## 32. Testing Architecture

Test per layer:

- domain unit tests,
- module component tests,
- API contract tests,
- security matrix tests,
- transaction/outbox integration tests,
- event contract tests,
- audit tests,
- migration tests,
- performance tests for critical workflows,
- native/container tests if applicable.

Critical tests:

```text
state transition
authorization denial
tenant isolation
audit insertion
outbox consistency
idempotency
rollback behavior
event schema compatibility
```

---

## 33. Observability Architecture

For each business workflow, expose:

- logs with correlationId/business key,
- audit events,
- metrics,
- traces,
- health,
- job status.

Business metrics:

```text
application_submitted_total
application_approved_total
case_escalated_total
authorization_denied_total
outbox_pending_total
audit_persist_failed_total
sla_breached_total
```

Dashboards should be business-aware, not only CPU/memory.

---

## 34. Data Retention and Archival

Regulatory systems need retention strategy:

- audit retention,
- document retention,
- application/case retention,
- legal hold,
- deletion/redaction,
- archive to cheaper storage,
- searchable history,
- reporting snapshots.

Architecture:

```text
hot OLTP DB
archive store
search/index
analytics store
audit immutable store
```

Archival must preserve:

- referential meaning,
- audit chain,
- access control,
- legal retention,
- restore/replay if needed.

---

## 35. Enterprise Architecture Anti-Patterns

### 35.1 Premature Microservices

Splitting before boundary is clear.

### 35.2 Distributed Monolith

Many services, one shared database, synchronized releases.

### 35.3 Shared Entity Library

All services share JPA entities.

### 35.4 Generic CRUD Workflow

State transitions reduced to status patch.

### 35.5 No Audit Transaction

Business change without guaranteed audit.

### 35.6 Cross-Module Repository Access

Boundary violation.

### 35.7 Event Without Idempotency

Duplicate processing corrupts state.

### 35.8 Reporting Queries in Transaction Path

Slow operational path.

### 35.9 Role-Only Authorization

No resource/tenant/state policy.

### 35.10 No Operational Owner

Nobody owns alerts/runbooks/data.

### 35.11 Everything Shared Module

`common` becomes hidden coupling.

### 35.12 Remote Call Inside DB Transaction

Locks and uncertain side effects.

---

## 36. Production Checklist

### 36.1 Boundary

- [ ] Bounded contexts identified.
- [ ] Package/module boundaries enforced.
- [ ] Internal module APIs defined.
- [ ] Cross-module repository access forbidden.
- [ ] Data ownership documented.
- [ ] Extraction candidates identified.

### 36.2 Workflow

- [ ] State machines explicit.
- [ ] Transitions validated.
- [ ] Actor/reason captured.
- [ ] SLA/deadline modeled.
- [ ] Idempotency designed.
- [ ] Compensation/reconciliation defined.

### 36.3 Transaction and Events

- [ ] Transaction boundary aligned with consistency boundary.
- [ ] Outbox used for async side effects.
- [ ] Event schema versioned.
- [ ] Consumer idempotency implemented.
- [ ] Saga/process manager for cross-service workflow.
- [ ] No remote call inside long transaction.

### 36.4 Security and Tenant

- [ ] Authentication configured.
- [ ] Role and permission model defined.
- [ ] Domain authorization policy implemented.
- [ ] Tenant boundary enforced in repository/cache/event/audit.
- [ ] Denied high-risk actions audited.
- [ ] Token propagation/client credentials strategy defined.

### 36.5 Audit and Compliance

- [ ] Audit event schema defined.
- [ ] Critical audit in same transaction.
- [ ] Actor model supports user/system/job/service.
- [ ] Immutable/append-only strategy.
- [ ] Retention/legal hold policy.
- [ ] Query/reporting access controlled.

### 36.6 Operations

- [ ] Ownership per module/service.
- [ ] Dashboards and alerts.
- [ ] Runbooks.
- [ ] SLOs.
- [ ] Migration strategy.
- [ ] Deployment rollback strategy.
- [ ] Performance baseline.
- [ ] Observability by business workflow.

---

## 37. Latihan

### Latihan 1 — Modular Monolith Design

Design modular monolith untuk domain:

```text
Application, Case, Document, Compliance, Notification, Audit, Reporting
```

Tentukan:

- module boundary,
- owned tables,
- internal API,
- events,
- transaction boundary,
- audit events.

### Latihan 2 — Microservice Extraction

Pilih satu module untuk diekstrak menjadi microservice.

Tentukan:

- alasan ekstraksi,
- data ownership,
- API contract,
- event contract,
- migration path,
- consistency model,
- rollback plan.

### Latihan 3 — Regulatory Workflow

Model workflow:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED/REJECTED/EXPIRED
```

Tentukan:

- transition methods,
- actor/permission,
- audit event,
- outbox event,
- notification,
- SLA timer.

### Latihan 4 — Authorization Policy

Buat policy untuk:

```text
Officer can approve application only if assigned, same tenant, role valid, status UNDER_REVIEW, no conflict of interest.
```

Tentukan unit test matrix.

### Latihan 5 — Outbox Design

Buat outbox table dan publisher design untuk event:

```text
ApplicationApproved
DocumentUploaded
CaseEscalated
```

Tentukan idempotency dan retry policy.

---

## 38. Ringkasan Invariants

Ingat invariants berikut:

```text
Architecture is boundary design.
Modular monolith is valid when boundaries are strong.
Microservices require operational maturity and data ownership.
Quarkus supports both large monoliths and microservices.
Bounded context owns its model and language.
Do not share JPA entities across contexts/services.
Workflow state transitions must be explicit.
Audit is business evidence, not debug logging.
Transaction boundary must match consistency boundary.
Use outbox for async side effects.
Domain authorization is more than roles.
Tenant boundary must exist in data, cache, event, and audit.
Reporting/search are read models, not source of truth.
Extract microservices only when boundary and reason are mature.
```

---

## 39. Referensi Resmi yang Relevan

Referensi yang perlu dibaca saat implementasi nyata:

- Quarkus Versatility page.
- Quarkus blog: building large applications / large monoliths.
- Quarkus Reactive Architecture guide.
- Quarkus Hibernate ORM guide.
- Quarkus Transactions guide.
- Quarkus Reactive Messaging Kafka guide.
- Quarkus Security overview.
- Quarkus OIDC bearer token guide.
- Quarkus OAuth2 RBAC guide.
- Quarkus Event Bus guide.
- Quarkus Observability, Micrometer, OpenTelemetry, and Health guides.
- Quarkus Kubernetes and Container Images guides.
- Quarkus Extension guides for internal platform patterns.

---

## 40. Kapan Seri Ini Lanjut ke Part Berikutnya

Part ini menyelesaikan enterprise architecture dengan Quarkus: modular monolith, microservices, regulatory workflow, audit/compliance, transaction boundary, outbox, saga, tenant/security boundary, reporting/search, testing, observability, dan migration strategy.

Bagian berikutnya:

```text
Part 035 — Production Masterclass: Operating Quarkus at Top-Tier Engineering Standard
```

Di part berikutnya, kita masuk ke bagian terakhir seri ini:

- production readiness master checklist,
- deployment governance,
- runtime operation,
- incident response,
- SLO/error budget,
- scaling strategy,
- security operation,
- release strategy,
- migration/upgrade strategy,
- cost management,
- architecture review checklist,
- “top-tier engineering standard” untuk Quarkus.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-033.md">⬅️ Custom Extension Engineering: Membuat Extension Quarkus Sendiri</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-035.md">Production Masterclass: Operating Quarkus at Top-Tier Engineering Standard ➡️</a>
</div>
