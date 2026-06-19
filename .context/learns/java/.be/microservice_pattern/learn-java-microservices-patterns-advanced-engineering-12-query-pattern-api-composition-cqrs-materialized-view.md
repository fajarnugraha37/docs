# Learn Java Microservices Patterns — Advanced Engineering
## Part 12 — Query Pattern: API Composition, CQRS, and Materialized Views

**Filename:** `learn-java-microservices-patterns-advanced-engineering-12-query-pattern-api-composition-cqrs-materialized-view.md`  
**Series:** `learn-java-microservices-patterns-advanced-engineering`  
**Part:** 12 of 35  
**Level:** Advanced / Principal Engineer Track  
**Scope:** Java 8–25, microservices architecture, distributed query design, API composition, CQRS, materialized views, read models, projection engineering, query consistency, operational correctness

---

## 0. Why This Part Exists

After Part 11, we accepted a difficult but necessary rule:

> A microservice should own its own data. Other services should not freely read or mutate its private tables.

That rule protects autonomy, deployment independence, data integrity, and ownership. But immediately it creates a practical problem:

> Real users do not care that your data is split by service boundary. They want screens, reports, dashboards, search pages, exports, and workflows that often need data from many services at once.

This is the **microservices query problem**.

Example:

A regulatory officer opens an application dashboard and expects to see:

- application number
- applicant name
- current application status
- assigned officer
- payment status
- outstanding document status
- latest correspondence date
- latest compliance flag
- SLA due date
- appeal indicator
- risk score
- last updated by
- last updated time

In a database-per-service architecture, that data may belong to many services:

```text
Application Service       -> application lifecycle and status
Profile Service           -> applicant identity and contact information
Payment Service           -> payment status
Document Service          -> uploaded documents and verification status
Correspondence Service    -> letters and notices
Compliance Service        -> flags and inspections
Workflow Service          -> task assignment and SLA
Risk Service              -> risk scoring
Audit Service             -> user/activity history
```

In a monolith or shared database system, a developer might write one SQL query with joins.

In microservices, that direct join is usually a boundary violation.

So this part answers:

1. How do we implement cross-service queries without shared database access?
2. When should we compose APIs synchronously?
3. When should we build a separate read model?
4. When is CQRS justified?
5. How do materialized views stay fresh?
6. Who owns a read model that combines data from many services?
7. How do we handle stale data, missing data, partial failure, replay, and reprocessing?
8. How do we design Java services that keep the query side maintainable from Java 8 to Java 25?

This part does **not** repeat basic SQL, JPA, Kafka, RabbitMQ, HTTP client, Redis, or Spring Boot mechanics. Those were covered in earlier series. Here we focus on architecture-level query design.

---

## 1. Core Mental Model

The central mental model:

> In microservices, **writes follow ownership**, but **reads follow use cases**.

A service boundary should usually be defined around data ownership and business authority. But a query is often defined around user experience, workflow, reporting, investigation, search, or operational decision-making.

That creates a tension:

```text
Write model wants autonomy.
Read model wants convenience.
```

A mature microservices architecture does not pretend this tension does not exist. It handles it explicitly.

There are three major approaches:

```text
1. API Composition
   Query-time aggregation by calling owning services.

2. CQRS / Read Model
   Separate command/write model from query/read model.

3. Materialized View / Projection
   Precomputed, denormalized, query-optimized data maintained from events, CDC, scheduled sync, or controlled replication.
```

A top-tier engineer does not ask:

> Should we use CQRS everywhere?

They ask:

> What query shape, latency, freshness, ownership, and failure tolerance does this use case need?

---

## 2. The Microservices Query Problem

### 2.1 Why the Problem Exists

If each service owns its database, then no service can simply join private tables from another service.

That avoids:

- hidden runtime dependency
- schema coupling
- uncoordinated query load
- accidental data leakage
- broken encapsulation
- deployment lockstep
- foreign key coupling across teams
- uncontrolled reporting queries

But it also removes the easiest way to answer business questions.

A query that was once:

```sql
SELECT a.id,
       a.status,
       p.full_name,
       pay.status,
       d.pending_count,
       c.latest_flag
FROM application a
JOIN profile p ON p.id = a.profile_id
LEFT JOIN payment pay ON pay.application_id = a.id
LEFT JOIN document_summary d ON d.application_id = a.id
LEFT JOIN compliance_summary c ON c.application_id = a.id
WHERE a.status = 'UNDER_REVIEW';
```

may now require one of these designs:

```text
Option A: API composition
Application Listing API -> calls Profile, Payment, Document, Compliance at query time.

Option B: Materialized read model
Application Query Service maintains denormalized application_listing_view.

Option C: Reporting/search store
A projection pipeline builds an OpenSearch/PostgreSQL/ClickHouse read store.

Option D: Product-specific BFF
Web BFF composes only the data needed by a specific frontend page.
```

None of these is universally correct.

---

## 3. Query Types in Microservices

Before choosing a pattern, classify the query.

### 3.1 Entity Lookup

Example:

```text
Get application by ID.
```

Usually belongs to the owning service.

```text
GET /applications/{applicationId}
```

Do not over-engineer this into CQRS unless read volume, latency, security, or projection shape requires it.

---

### 3.2 Detail Page Query

Example:

```text
Show application detail with applicant, documents, payment, task, correspondence summary.
```

This may use API composition or a read model.

Decision depends on:

- number of dependencies
- latency target
- freshness target
- partial failure tolerance
- frequency of access
- complexity of joins
- authorization rules

---

### 3.3 Listing Query

Example:

```text
Show all pending applications assigned to officer X, sorted by SLA due date.
```

Listing queries are often dangerous for API composition because they require filtering, sorting, and pagination across service-owned data.

If the query requires cross-service filtering or sorting, materialized views often become more appropriate.

---

### 3.4 Search Query

Example:

```text
Search applications by applicant name, application number, license number, status, date range, and risk flag.
```

Search queries often need a search-optimized read model.

Possible stores:

- OpenSearch / Elasticsearch
- PostgreSQL with GIN indexes
- ClickHouse for analytical search
- dedicated denormalized relational table
- document database

---

### 3.5 Dashboard Query

Example:

```text
Count applications by status, age bucket, team, officer, case type, and SLA risk.
```

Dashboards usually need aggregated read models because synchronous fan-out can become expensive and unstable.

---

### 3.6 Report Query

Example:

```text
Monthly regulatory submission report.
```

Reports frequently need:

- historical consistency
- reproducibility
- point-in-time semantics
- auditability
- large scans
- controlled extraction

They should rarely hit transactional service APIs directly.

---

### 3.7 Workflow Query

Example:

```text
Find all cases waiting for supervisor approval where payment is completed but documents are incomplete.
```

This query combines state, task, payment, and document readiness.

Usually better served by a workflow/read model, not live fan-out.

---

## 4. Pattern 1 — API Composition

### 4.1 Definition

API Composition means:

> A query service, gateway, BFF, or aggregator calls multiple services that own data, combines their responses in memory, and returns a composed result.

Microservices.io describes API Composition as implementing queries by invoking the services that own the data and performing an in-memory join.

Conceptually:

```text
Client
  |
  v
Application Detail Composer
  |---- GET /applications/{id}
  |---- GET /profiles/{profileId}
  |---- GET /payments/by-application/{id}
  |---- GET /documents/summary?applicationId={id}
  |---- GET /workflow/tasks/current?applicationId={id}
  |
  v
Composed DTO
```

---

### 4.2 When API Composition Works Well

API composition is good when:

1. Query is simple.
2. Dependency count is small.
3. Query volume is moderate.
4. Data freshness must be high.
5. Query result is for one entity or small bounded set.
6. Partial result is acceptable or well-defined.
7. Latency budget can tolerate remote calls.
8. Dependencies expose stable, purpose-fit APIs.
9. No cross-service sorting/filtering/pagination is needed.

Good examples:

```text
Application detail page by applicationId.
User profile popover.
Order summary by orderId.
Case header card.
License detail overview.
```

---

### 4.3 When API Composition Becomes Dangerous

API composition becomes risky when:

1. It fans out to many services.
2. It performs N+1 remote calls.
3. It needs cross-service filtering.
4. It needs cross-service sorting.
5. It needs stable pagination.
6. It powers high-volume listing pages.
7. It is used for reporting.
8. It depends on slow services.
9. It hides business orchestration in the aggregator.
10. It becomes a god service.

Danger example:

```text
GET /applications?status=UNDER_REVIEW&page=1&pageSize=50

Application service returns 50 application IDs.
Composer calls Profile Service 50 times.
Composer calls Payment Service 50 times.
Composer calls Document Service 50 times.
Composer calls Workflow Service 50 times.

Total remote calls: 201.
```

This looks harmless in development and collapses under production load.

---

### 4.4 API Composition Latency Model

Assume a detail query calls four services in parallel:

```text
Application Service:    p95 80ms
Profile Service:        p95 120ms
Payment Service:        p95 150ms
Document Service:       p95 200ms
Composer overhead:      30ms
```

If calls are parallel, approximate p95 latency is not sum of all calls, but roughly:

```text
max(dependency latency) + composer overhead
= 200ms + 30ms
= 230ms
```

But the tail risk increases because any dependency can be slow.

If dependency count grows, the probability that at least one dependency is slow increases.

For independent dependencies:

```text
Probability all 5 dependencies are below p95 = 0.95^5 = 77.4%
Probability at least one exceeds p95 = 22.6%
```

For 10 dependencies:

```text
0.95^10 = 59.9%
Probability at least one exceeds p95 = 40.1%
```

This is why fan-out hurts tail latency.

---

### 4.5 API Composer Responsibilities

A good API composer should handle:

- timeout budget
- parallel calls
- dependency-specific timeout
- partial failure policy
- result shaping
- correlation ID propagation
- authorization context propagation
- caching if safe
- input validation
- response schema ownership
- observability
- dependency degradation

It should not own:

- core business state transitions
- authoritative business rules
- data mutation across services
- hidden workflow orchestration
- cross-service transactions

---

### 4.6 Java API Composition Example

This is conceptual Java 21-style code using `CompletableFuture`. The same idea works in Java 8, but Java 21+ gives better options with virtual threads and structured concurrency concepts.

```java
public final class ApplicationDetailQueryService {

    private final ApplicationClient applicationClient;
    private final ProfileClient profileClient;
    private final PaymentClient paymentClient;
    private final DocumentClient documentClient;

    public ApplicationDetailView getApplicationDetail(String applicationId) {
        Deadline deadline = Deadline.afterMillis(800);

        ApplicationDto application = applicationClient.getApplication(applicationId, deadline.remaining());

        CompletableFuture<ProfileDto> profileFuture = CompletableFuture.supplyAsync(() ->
                profileClient.getProfile(application.profileId(), deadline.remaining())
        );

        CompletableFuture<PaymentSummaryDto> paymentFuture = CompletableFuture.supplyAsync(() ->
                paymentClient.getPaymentSummary(applicationId, deadline.remaining())
        );

        CompletableFuture<DocumentSummaryDto> documentFuture = CompletableFuture.supplyAsync(() ->
                documentClient.getDocumentSummary(applicationId, deadline.remaining())
        );

        ProfileDto profile = profileFuture.join();
        PaymentSummaryDto payment = paymentFuture.join();
        DocumentSummaryDto document = documentFuture.join();

        return ApplicationDetailView.from(application, profile, payment, document);
    }
}
```

But this code is incomplete for production.

It still needs:

- bounded executor or virtual-thread executor
- deadline propagation
- exception mapping
- partial response policy
- timeout handling
- cancellation
- metrics per dependency
- trace propagation
- authorization propagation
- circuit breaker / bulkhead if needed

---

### 4.7 Java 21+ Virtual Thread Variant

With virtual threads, synchronous-looking code can be acceptable for blocking I/O if the client stack and drivers behave well.

```java
public ApplicationDetailView getApplicationDetail(String applicationId) throws Exception {
    Deadline deadline = Deadline.afterMillis(800);

    ApplicationDto app = applicationClient.getApplication(applicationId, deadline.remaining());

    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        Future<ProfileDto> profile = executor.submit(() ->
                profileClient.getProfile(app.profileId(), deadline.remaining())
        );
        Future<PaymentSummaryDto> payment = executor.submit(() ->
                paymentClient.getPaymentSummary(applicationId, deadline.remaining())
        );
        Future<DocumentSummaryDto> document = executor.submit(() ->
                documentClient.getDocumentSummary(applicationId, deadline.remaining())
        );

        return ApplicationDetailView.from(
                app,
                profile.get(deadline.remainingMillis(), TimeUnit.MILLISECONDS),
                payment.get(deadline.remainingMillis(), TimeUnit.MILLISECONDS),
                document.get(deadline.remainingMillis(), TimeUnit.MILLISECONDS)
        );
    }
}
```

Important:

Virtual threads reduce the cost of blocking threads. They do **not** remove:

- dependency latency
- remote failure
- rate limits
- downstream overload
- database bottlenecks
- fan-out amplification
- need for timeout and backpressure

A top-tier engineer does not use virtual threads as an excuse to ignore distributed system design.

---

## 5. Pattern 2 — CQRS

### 5.1 Definition

CQRS means **Command Query Responsibility Segregation**.

At its core:

> Use a different model for writes than for reads.

Martin Fowler describes CQRS as separating the model used to update information from the model used to read information, while warning that CQRS adds risky complexity and should be used selectively.

CQRS is not automatically:

- event sourcing
- Kafka
- separate database
- microservices
- eventual consistency
- asynchronous messaging

Those are common combinations, not mandatory definitions.

The minimal CQRS idea:

```text
Command side:
  validates intent
  enforces invariants
  changes authoritative state

Query side:
  optimizes retrieval
  shapes data for read use cases
  avoids mutating business state
```

---

### 5.2 Simple CQRS Inside One Service

Even inside one service, CQRS can mean:

```text
ApplicationCommandService
  submitApplication()
  approveApplication()
  rejectApplication()

ApplicationQueryService
  getApplicationDetail()
  searchApplications()
  getApplicationDashboard()
```

Both can still use the same database.

This is often a good first step before distributed CQRS.

---

### 5.3 Distributed CQRS

In microservices, CQRS often becomes:

```text
Command side services own transactional writes.
They publish events when state changes.
Query/read-model service consumes events.
It maintains query-optimized read models.
Clients query the read model.
```

Example:

```text
Application Service -> ApplicationSubmitted event
Profile Service     -> ApplicantProfileUpdated event
Payment Service     -> PaymentCompleted event
Document Service    -> DocumentVerificationChanged event
Workflow Service    -> TaskAssigned event

Application Query Service consumes all relevant events
and updates application_listing_read_model.
```

---

### 5.4 When CQRS Is Justified

CQRS is justified when:

1. Read shape differs significantly from write shape.
2. Read volume is much higher than write volume.
3. Query latency requirements are strict.
4. Query requires data from many services.
5. Cross-service filtering/sorting/pagination is required.
6. Reporting/dashboard/search workloads hurt transactional systems.
7. Multiple UX views need denormalized data.
8. Read model can tolerate freshness lag.
9. There is enough operational maturity to run projections.
10. The team can handle schema/versioning/replay complexity.

---

### 5.5 When CQRS Is Overkill

CQRS is probably overkill when:

1. The service is simple CRUD.
2. Read and write models are nearly identical.
3. Query volume is low.
4. Data freshness must be strongly consistent.
5. Team has no operational maturity for event pipelines.
6. The read model cannot be rebuilt.
7. There is no clear owner for projection correctness.
8. You are using CQRS because it sounds advanced.

Bad reason:

```text
“We use CQRS because microservices should use CQRS.”
```

Good reason:

```text
“Our case listing page requires filtering and sorting across application status, SLA bucket, assigned officer, applicant type, payment state, and document completeness. Live fan-out is too slow and fragile, so we need a read-optimized projection.”
```

---

## 6. Pattern 3 — Materialized View / Projection

### 6.1 Definition

A materialized view is:

> A precomputed, query-optimized representation of data derived from one or more authoritative sources.

Azure Architecture Center describes the Materialized View pattern as generating prepopulated views of data when source data is not in a suitable format for querying.

In microservices, materialized views are usually implemented as:

- denormalized relational tables
- document read models
- search indexes
- analytical tables
- cache-backed projections
- dashboard aggregates
- workflow worklists

---

### 6.2 Projection vs Cache

A projection is not just a cache.

| Aspect | Cache | Projection / Materialized View |
|---|---|---|
| Purpose | Speed up access | Provide query-specific model |
| Source | Usually one canonical query | One or more event/data sources |
| Shape | Often similar to source | Often denormalized/restructured |
| Rebuild | May be optional | Must be intentionally rebuildable |
| Freshness | TTL-based often acceptable | Must define lag and correctness rules |
| Ownership | Often local optimization | Architectural component |
| Failure impact | May fall back to source | Query feature may depend on it |

A cache optimizes access.

A projection models a read use case.

---

### 6.3 Projection Ownership

A frequent question:

> If a materialized view combines data from multiple services, who owns it?

Answer:

> The team/service that owns the **query use case** owns the projection, while source services own the source facts.

Example:

```text
Application Service owns application lifecycle facts.
Profile Service owns applicant identity facts.
Payment Service owns payment facts.
Document Service owns document facts.

Application Query Service owns the application listing read model.
```

This means:

- Source services own event correctness.
- Query service owns projection correctness.
- Consumers should not directly mutate projection data.
- Projection schema is not the source-of-truth schema.
- Projection can be dropped and rebuilt.

---

## 7. Query Pattern Decision Framework

### 7.1 Core Decision Questions

Before choosing a pattern, answer:

1. What is the query use case?
2. Is this detail, listing, search, report, dashboard, or workflow query?
3. What is the latency target?
4. What is the freshness target?
5. What is the consistency expectation?
6. How many services own the needed data?
7. Is cross-service filtering required?
8. Is cross-service sorting required?
9. Is stable pagination required?
10. Can partial result be returned?
11. Can the query tolerate stale data?
12. How often is the query executed?
13. How large is the result set?
14. Does the query require historical point-in-time semantics?
15. Who owns the query model?
16. Can the read model be rebuilt?
17. What is the failure behavior?
18. What is the security/authorization model?

---

### 7.2 Pattern Selection Matrix

| Situation | Better Pattern |
|---|---|
| One entity, few dependencies, freshness required | API Composition |
| Detail page, bounded data, moderate latency | API Composition or BFF |
| Listing with cross-service filters | Materialized View / CQRS |
| Search by text and multiple attributes | Search Projection |
| Dashboard aggregates | Materialized Aggregate View |
| Heavy reporting | Reporting Store / Analytical Projection |
| Workflow worklist | Workflow Read Model |
| Need point-in-time historical reconstruction | Event Sourcing or Audit/History Projection |
| Low volume admin screen | API Composition may be enough |
| Strict strong consistency read after write | Owning service query or synchronous confirmation |
| High read scale with eventual freshness accepted | CQRS Read Model |

---

### 7.3 The Three-Axis Model

Use three axes:

```text
1. Query Shape
   simple lookup -> complex search/report/dashboard

2. Freshness Requirement
   immediate -> seconds -> minutes -> batch/day

3. Operational Complexity Budget
   low -> medium -> high
```

Mapping:

```text
Simple + fresh + low complexity
  -> API composition or owning service query

Complex + seconds freshness + medium/high complexity
  -> CQRS/materialized view

Complex + minutes/hours freshness + analytical workload
  -> reporting/analytics projection
```

---

## 8. API Composition Design in Depth

### 8.1 Aggregator Location

API composition can live in different places.

| Location | Use Case | Risk |
|---|---|---|
| API Gateway | edge routing, simple shaping | god gateway |
| BFF | frontend-specific data shape | duplicated logic across BFFs |
| Query Service | reusable query use case | becomes reporting monolith |
| Domain Service | local domain-owned composition | boundary creep |
| Frontend | very simple aggregation | exposes complexity to UI |

Best default:

```text
Use BFF for experience-specific composition.
Use Query Service for reusable business query use cases.
Avoid putting complex business composition in a generic API Gateway.
```

---

### 8.2 Parallelism

Sequential composition:

```text
Call A -> Call B -> Call C -> Call D
```

Latency roughly sums.

Parallel composition:

```text
Call A
Call B
Call C
Call D
```

Latency roughly follows the slowest dependency.

But parallelism increases instantaneous load.

A composer must define:

- maximum concurrency
- per-dependency timeout
- total deadline
- cancellation policy
- fallback policy
- partial response model

---

### 8.3 Timeout Budget

Do not give every dependency the full client timeout.

Bad:

```text
Client timeout: 5s
Application timeout: 5s
Profile timeout: 5s
Payment timeout: 5s
Document timeout: 5s
```

This allows the entire request to exceed expected budget and creates resource pile-up.

Better:

```text
Total API budget: 800ms
Composer overhead: 50ms
Application Service: 150ms
Profile Service: 150ms
Payment Service: 200ms
Document Service: 200ms
Reserve: 50ms
```

Even better: pass deadline context.

```text
Deadline: 2026-06-19T10:15:30.800+07:00
Each dependency uses remaining time.
```

---

### 8.4 Partial Response Policy

Not every dependency has equal importance.

Example application detail page:

| Dependency | Critical? | If unavailable |
|---|---:|---|
| Application | Yes | fail whole response |
| Profile | Yes | fail or show restricted detail |
| Payment summary | Maybe | show `paymentStatusUnavailable` |
| Document summary | Maybe | show `documentStatusUnavailable` |
| Correspondence summary | No | omit widget |
| Audit summary | No | lazy-load separately |

A mature API response can include data quality metadata:

```json
{
  "applicationId": "APP-2026-0001",
  "status": "UNDER_REVIEW",
  "applicantName": "PT Example",
  "payment": {
    "status": "UNAVAILABLE",
    "reason": "PAYMENT_SERVICE_TIMEOUT"
  },
  "_meta": {
    "partial": true,
    "generatedAt": "2026-06-19T10:15:30+07:00",
    "correlationId": "c-123"
  }
}
```

---

### 8.5 Avoiding N+1 Remote Calls

Bad:

```java
List<ApplicationDto> apps = applicationClient.search(...);
for (ApplicationDto app : apps) {
    ProfileDto profile = profileClient.getProfile(app.profileId());
    PaymentDto payment = paymentClient.getPayment(app.id());
}
```

Better:

```text
GET /profiles/batch?ids=p1,p2,p3
GET /payments/summary?applicationIds=a1,a2,a3
```

But batch APIs can become hidden query services.

Batch endpoints should be:

- bounded in size
- authorized carefully
- rate limited
- indexed
- observable
- not arbitrary join endpoints

---

## 9. Materialized View Design in Depth

### 9.1 Read Model Shape

Design read models from query use cases, not from source tables.

Example listing read model:

```sql
CREATE TABLE application_listing_read_model (
    application_id          VARCHAR(64) PRIMARY KEY,
    application_no          VARCHAR(64) NOT NULL,
    application_type        VARCHAR(64) NOT NULL,
    application_status      VARCHAR(64) NOT NULL,
    applicant_id            VARCHAR(64) NOT NULL,
    applicant_name          VARCHAR(256),
    applicant_type          VARCHAR(64),
    assigned_officer_id     VARCHAR(64),
    assigned_officer_name   VARCHAR(256),
    payment_status          VARCHAR(64),
    document_status         VARCHAR(64),
    latest_correspondence_at TIMESTAMP,
    sla_due_at              TIMESTAMP,
    sla_bucket              VARCHAR(32),
    compliance_flag_count   INTEGER NOT NULL DEFAULT 0,
    risk_level              VARCHAR(32),
    source_version          BIGINT NOT NULL,
    projection_version      BIGINT NOT NULL,
    last_projected_at       TIMESTAMP NOT NULL,
    data_quality            VARCHAR(64) NOT NULL
);
```

This is not normalized. That is intentional.

Read models optimize reads, not writes.

---

### 9.2 Projection Update Sources

A materialized view can be updated from:

1. Domain/integration events.
2. Transactional outbox events.
3. CDC streams.
4. Scheduled sync jobs.
5. API polling.
6. Manual import/export.
7. Hybrid methods.

Preferred for microservices:

```text
Transactional outbox or domain/integration events.
```

CDC can be useful when extracting from legacy systems.

Scheduled sync can be acceptable for low-freshness reporting.

API polling is usually least desirable but sometimes necessary for external systems.

---

### 9.3 Projection Handler Example

```java
public final class ApplicationListingProjectionHandler {

    private final ApplicationListingRepository repository;

    public void on(ApplicationSubmitted event) {
        repository.upsertApplication(new ApplicationListingRow(
                event.applicationId(),
                event.applicationNo(),
                event.applicationType(),
                "SUBMITTED",
                event.applicantId(),
                null,
                null,
                event.submittedAt(),
                event.eventVersion()
        ));
    }

    public void on(ApplicantProfileUpdated event) {
        repository.updateApplicantFields(
                event.applicantId(),
                event.displayName(),
                event.applicantType(),
                event.eventVersion()
        );
    }

    public void on(PaymentStatusChanged event) {
        repository.updatePaymentStatus(
                event.applicationId(),
                event.paymentStatus(),
                event.eventVersion()
        );
    }

    public void on(DocumentVerificationChanged event) {
        repository.updateDocumentStatus(
                event.applicationId(),
                event.documentStatus(),
                event.eventVersion()
        );
    }
}
```

This seems simple, but production-grade projection requires much more.

---

### 9.4 Projection Correctness Requirements

A projection must define:

- source events consumed
- ordering assumptions
- idempotency behavior
- duplicate handling
- out-of-order handling
- missing event detection
- rebuild process
- replay safety
- schema evolution strategy
- freshness SLA
- data quality indicators
- reconciliation rules
- ownership
- security rules

---

### 9.5 Idempotent Projection

Projection handlers must be idempotent because events/messages can be delivered more than once.

Typical strategies:

1. Store processed message IDs.
2. Store per-aggregate last sequence number.
3. Use deterministic upsert.
4. Use unique constraints.
5. Ignore stale events.
6. Use event version/sequence checks.

Example:

```sql
CREATE TABLE processed_projection_event (
    message_id VARCHAR(128) PRIMARY KEY,
    processed_at TIMESTAMP NOT NULL
);
```

Or per aggregate:

```sql
ALTER TABLE application_listing_read_model
ADD COLUMN application_source_version BIGINT NOT NULL DEFAULT 0;
```

Then:

```java
public void on(ApplicationStatusChanged event) {
    repository.updateStatusIfNewer(
            event.applicationId(),
            event.newStatus(),
            event.aggregateVersion()
    );
}
```

SQL concept:

```sql
UPDATE application_listing_read_model
SET application_status = ?,
    application_source_version = ?,
    last_projected_at = CURRENT_TIMESTAMP
WHERE application_id = ?
  AND application_source_version < ?;
```

---

### 9.6 Out-of-Order Events

Events may arrive out of order.

Example:

```text
v10 ApplicationApproved arrives before v9 ApplicationUnderReview.
```

Projection should not regress state.

Bad:

```text
Set status to UNDER_REVIEW after APPROVED because older event arrived later.
```

Better:

```text
Use aggregate version or transition ordering.
Ignore stale event if version <= current version.
```

But not all events share the same aggregate.

For multi-source projections:

```text
Application aggregate version controls application fields.
Payment aggregate version controls payment fields.
Document aggregate version controls document fields.
```

Do not use one global version unless the architecture truly provides global ordering.

---

### 9.7 Missing Data

A projection may receive events in this order:

```text
PaymentCompleted(applicationId=APP-1)
ApplicationSubmitted(applicationId=APP-1)
```

If row does not exist yet, options:

1. Create partial row.
2. Store pending event.
3. Retry later.
4. Query source service to hydrate missing context.
5. Ignore and rely on replay.

Production design should be explicit.

Partial row example:

```sql
application_id = APP-1
payment_status = COMPLETED
application_status = UNKNOWN
applicant_name = NULL
data_quality = PARTIAL
```

Later, ApplicationSubmitted completes the row.

---

### 9.8 Rebuildability

A read model should be rebuildable.

Rebuild sources may be:

- event log from beginning
- event store
- compacted topic
- CDC history
- authoritative service export
- snapshot + incremental events

Rebuild process should define:

1. Create new projection table/index.
2. Replay source events into new projection.
3. Validate counts and checksums.
4. Run sampled reconciliation.
5. Switch read traffic.
6. Retain old projection temporarily.
7. Roll back if needed.

Avoid destructive rebuilds directly against live projection unless downtime and correctness risk are acceptable.

---

## 10. CQRS Read Model Freshness

### 10.1 Freshness Is a Product Decision

A read model is usually eventually consistent.

But “eventual” is not precise enough.

Define freshness explicitly:

```text
Application listing freshness target: p95 < 5 seconds after source commit.
Dashboard freshness target: p95 < 60 seconds.
Monthly report freshness target: daily batch by 02:00.
Search index freshness target: p95 < 15 seconds.
```

---

### 10.2 Freshness Metadata

Expose freshness where useful:

```json
{
  "items": [],
  "_meta": {
    "readModel": "application-listing-v3",
    "generatedAt": "2026-06-19T10:15:00+07:00",
    "lastProjectedAt": "2026-06-19T10:14:58+07:00",
    "freshnessLagMs": 2000
  }
}
```

For internal/admin systems, this metadata is extremely useful during incidents.

---

### 10.3 Read-Your-Writes Problem

User submits an application and immediately opens listing page.

Command succeeded, but listing projection has not updated yet.

The user says:

```text
“I just submitted it. Why is it not visible?”
```

Solutions:

1. Redirect to owning service detail page.
2. Return command result with enough detail for immediate display.
3. Use client-side optimistic update.
4. Wait for projection catch-up within bounded timeout.
5. Use read-your-writes token/version.
6. Show “processing / updating list” message.
7. Query command side for immediate confirmation.

Do not hide this problem. Design the UX around it.

---

### 10.4 Read-Your-Writes Token

Command response:

```json
{
  "applicationId": "APP-1",
  "status": "SUBMITTED",
  "writeVersion": 42,
  "projectionHint": {
    "stream": "application",
    "aggregateId": "APP-1",
    "version": 42
  }
}
```

Query request:

```text
GET /application-listing?minimumApplicationVersion[APP-1]=42
```

Query service can:

- wait briefly until projection catches up
- return stale data with metadata
- redirect to command-side detail
- respond `202 Accepted` style for still-building view

This is advanced but useful for high-value workflows.

---

## 11. Cross-Service Filtering, Sorting, and Pagination

### 11.1 Why API Composition Fails Here

Suppose user asks:

```text
Show page 3 of applications where:
- status = UNDER_REVIEW
- paymentStatus = PAID
- documentStatus = INCOMPLETE
- applicantType = COMPANY
- sort by slaDueAt ascending
```

Data belongs to multiple services.

API composition cannot easily do this correctly because:

1. Each service can filter only its own data.
2. Sorting requires complete combined data.
3. Pagination must happen after filtering and sorting.
4. Fetching all candidate records is too expensive.
5. Partial dependency failure corrupts result semantics.

Materialized view is usually better.

---

### 11.2 Stable Pagination

Offset pagination over changing data can produce duplicates or missing rows.

Better options:

- keyset pagination
- cursor pagination
- snapshot token
- stable sort key

Example sort key:

```text
ORDER BY sla_due_at ASC, application_id ASC
```

Cursor:

```json
{
  "lastSlaDueAt": "2026-06-20T09:00:00+07:00",
  "lastApplicationId": "APP-2026-1001"
}
```

Query:

```sql
WHERE (sla_due_at, application_id) > (?, ?)
ORDER BY sla_due_at ASC, application_id ASC
LIMIT 50
```

---

### 11.3 Count Accuracy

Listing often wants total count:

```json
{
  "total": 123456,
  "items": []
}
```

But exact count can be expensive.

Options:

1. Exact count for small/filtered datasets.
2. Approximate count.
3. Count capped at threshold.
4. Async count.
5. No total count; use cursor pagination.
6. Precomputed count aggregate.

For high-scale systems, exact count on every search is often a hidden performance killer.

---

## 12. Query Authorization

### 12.1 Authorization Is Harder for Projections

A projection may contain data from multiple services with different access rules.

Example:

```text
Application fields visible to officer.
Payment fields visible only to finance role.
Compliance flags visible only to compliance role.
Applicant PII visible only to authorized users.
```

If the projection stores everything in one row, query API must still enforce field-level and row-level security.

---

### 12.2 Authorization Strategies

Possible strategies:

1. Store only generally visible fields.
2. Create separate projections per access class.
3. Apply row-level filters at query time.
4. Apply field masking at query time.
5. Split sensitive data into separate secure projection.
6. Use policy decision service.
7. Encrypt selected fields.
8. Avoid projecting sensitive fields unless necessary.

---

### 12.3 Security Smell

Dangerous statement:

```text
“It is only a read model, so security is less important.”
```

Wrong.

Read models are often more dangerous because they denormalize sensitive data into convenient access shapes.

A read model can become the easiest place to leak PII or restricted regulatory information.

---

## 13. Projection Storage Choices

### 13.1 Relational Database

Good for:

- listing
- filtering
- sorting
- transactional updates
- strong query semantics
- moderate-scale dashboards
- operational admin screens

Common choice:

```text
PostgreSQL / MySQL / Oracle / SQL Server
```

Pros:

- familiar SQL
- indexes
- transactions
- constraints
- mature operations

Cons:

- may not handle full-text search well at very large scale
- schema evolution needed
- aggregation at high volume may hurt

---

### 13.2 Search Index

Good for:

- text search
- fuzzy search
- faceted search
- multi-criteria search
- user-facing search

Possible choice:

```text
OpenSearch / Elasticsearch
```

Pros:

- search optimized
- scoring
- analyzers
- faceting

Cons:

- eventual consistency
- operational complexity
- mapping evolution
- index rebuilds
- not source of truth

---

### 13.3 Analytical Store

Good for:

- reporting
- dashboards
- historical analytics
- large scans
- time-series aggregates

Possible choices:

```text
ClickHouse / BigQuery / Athena / Redshift / Snowflake / DuckDB for offline workflows
```

Pros:

- fast analytical query
- columnar storage
- high compression

Cons:

- not ideal for transactional detail page
- eventual/batch freshness
- separate governance needed

---

### 13.4 Document Store

Good for:

- detail view documents
- nested read models
- flexible schema

Possible choices:

```text
MongoDB / document-style PostgreSQL JSONB / OpenSearch document
```

Pros:

- natural fit for denormalized view
- flexible shape

Cons:

- complex consistency rules
- update paths can become tricky
- query constraints depend on store

---

### 13.5 Cache Store

Good for:

- hot lookup
- expensive summary
- short-lived derived data

Possible choice:

```text
Redis / local cache / CDN edge cache
```

Pros:

- low latency
- simple for hot data

Cons:

- memory cost
- invalidation complexity
- persistence/rebuild concern
- not ideal as sole projection for critical data unless designed carefully

---

## 14. Projection Pipeline Architecture

### 14.1 Basic Pipeline

```text
Source Service
  -> Local transaction
  -> Outbox row
  -> Message relay / CDC
  -> Broker / stream
  -> Projection consumer
  -> Read model database
  -> Query API
  -> Client
```

---

### 14.2 Projection Consumer Responsibilities

A projection consumer must handle:

- deserialization
- schema version compatibility
- validation
- idempotency
- ordering
- dead-letter handling
- retries
- metrics
- tracing
- logging
- security classification
- upsert/update logic
- replay mode
- migration mode
- reconciliation

---

### 14.3 Replay Mode vs Live Mode

Projection logic should know whether it is:

```text
Live mode:
  processing new events and serving production queries.

Replay mode:
  rebuilding or repairing read model from historical events.
```

Differences:

| Concern | Live Mode | Replay Mode |
|---|---|---|
| Alerting | strict | relaxed/noisy alerts suppressed |
| Throughput | bounded by live traffic | optimized for bulk |
| Side effects | avoid external side effects | must be disabled |
| Metrics | production lag | rebuild progress |
| Error policy | DLQ/parking lot | stop or quarantine batch |

Projection handlers should avoid non-idempotent external side effects.

---

## 15. Data Quality and Reconciliation

### 15.1 Data Quality States

A read model can expose data quality:

```text
COMPLETE
PARTIAL
STALE
REBUILDING
DEGRADED
UNKNOWN_SOURCE
RECONCILIATION_REQUIRED
```

Example:

```json
{
  "applicationId": "APP-1",
  "paymentStatus": "PAID",
  "documentStatus": "UNKNOWN",
  "dataQuality": "PARTIAL"
}
```

This is better than silently returning incorrect-looking data.

---

### 15.2 Reconciliation

Reconciliation checks whether projection data matches authoritative sources.

Types:

1. Count reconciliation.
2. Checksum reconciliation.
3. Sample-based reconciliation.
4. Per-aggregate reconciliation.
5. Time-window reconciliation.
6. Full rebuild comparison.

Example checks:

```text
Number of ApplicationSubmitted events = number of read model rows.
Number of PAID payment statuses in projection = count from Payment Service export.
Latest aggregate version in projection >= latest event version per aggregate.
No row has UNKNOWN status for more than 10 minutes.
```

---

### 15.3 Repair Strategy

If reconciliation fails:

1. Identify affected rows.
2. Rehydrate from source service or event log.
3. Replay affected aggregate events.
4. Mark rows as degraded if uncertain.
5. Trigger rebuild if systemic.
6. Record audit of repair.

Avoid manual SQL patching without audit trail.

---

## 16. Query API Design

### 16.1 Query API Should Expose Read Model Semantics

Example:

```http
GET /application-listing?status=UNDER_REVIEW&paymentStatus=PAID&sort=slaDueAt.asc&pageSize=50
```

Response:

```json
{
  "items": [
    {
      "applicationId": "APP-1",
      "applicationNo": "APP-2026-0001",
      "status": "UNDER_REVIEW",
      "applicantName": "PT Example",
      "paymentStatus": "PAID",
      "documentStatus": "INCOMPLETE",
      "slaDueAt": "2026-06-20T09:00:00+07:00"
    }
  ],
  "nextCursor": "eyJzbGFE...",
  "meta": {
    "readModel": "application-listing-v3",
    "freshnessLagMs": 1800,
    "partial": false
  }
}
```

---

### 16.2 Query Parameter Governance

Avoid arbitrary query APIs that expose internal schema too directly.

Bad:

```text
GET /query?where=payment_status='PAID' and document_status='INCOMPLETE'
```

Better:

```text
GET /application-worklist?queue=UNDER_REVIEW_READY_FOR_ACTION
GET /application-listing?status=UNDER_REVIEW&paymentStatus=PAID
```

The query API should express supported business query use cases.

---

### 16.3 Sorting Governance

Not every field should be sortable.

Define:

- allowed sort fields
- default sort
- stable tie-breaker
- index support
- max page size
- cursor semantics

Example:

```text
Allowed sort:
- submittedAt.desc
- slaDueAt.asc
- lastUpdatedAt.desc
- riskLevel.desc

Always append:
- applicationId.asc
```

---

## 17. Java 8–25 Considerations

### 17.1 Java 8 Baseline

Java 8 systems often use:

- `CompletableFuture`
- classic thread pools
- blocking HTTP clients
- JDBC/JPA
- Spring MVC
- executor-based concurrency

For query composition:

- use bounded executors
- avoid unbounded `ForkJoinPool.commonPool()` usage
- define explicit timeouts
- avoid N+1 remote calls
- instrument dependency calls

---

### 17.2 Java 11 Baseline

Java 11 adds standard `java.net.http.HttpClient`.

Useful for:

- async HTTP composition
- HTTP/2 support
- standardized client without external dependency

Still requires:

- timeout discipline
- connection pool awareness
- retry policy outside default client
- observability instrumentation

---

### 17.3 Java 17 Baseline

Java 17 is a strong modern LTS baseline.

Useful language/runtime features:

- records for immutable DTOs
- sealed classes for result/error modeling
- pattern matching improvements across later versions
- better GC/runtime defaults than Java 8

Example:

```java
public sealed interface QueryResult<T> permits QueryResult.Complete, QueryResult.Partial, QueryResult.Failed {
    record Complete<T>(T value) implements QueryResult<T> {}
    record Partial<T>(T value, List<String> warnings) implements QueryResult<T> {}
    record Failed<T>(String reason) implements QueryResult<T> {}
}
```

---

### 17.4 Java 21 Baseline

Java 21 adds virtual threads as a final feature.

Implication:

- API composition can be written in a simpler blocking style.
- High concurrency blocking I/O becomes cheaper.
- Thread pool starvation is reduced for blocking workloads.

But:

- remote service capacity does not increase magically
- database connection pools still cap concurrency
- downstream rate limits still matter
- fan-out still amplifies load
- timeout/retry/backpressure still required

---

### 17.5 Java 25 Horizon

Java 25 is the latest LTS generation after Java 21. For architecture, the important point is not one syntax feature, but the maturity of the modern Java runtime:

- virtual-thread-friendly service code
- more expressive data carriers
- improved runtime behavior
- better observability ecosystem integration
- continued evolution of language ergonomics

Architecture rule:

```text
Do not design query architecture around a Java version feature alone.
Use Java version features to make the chosen architecture safer and simpler.
```

---

## 18. Spring, Jakarta, MicroProfile, Quarkus, and Plain Java Positioning

### 18.1 Spring Ecosystem

Spring-based systems can implement these patterns using:

- Spring MVC / WebFlux for query APIs
- RestClient / WebClient for API composition
- Spring Data JDBC/JPA for read models
- Spring Kafka / AMQP for projection consumers
- Spring Cloud for config, routing, resilience, discovery
- Micrometer/OpenTelemetry for metrics/tracing

Do not confuse Spring Cloud tools with the architecture itself.

---

### 18.2 Jakarta / MicroProfile

MicroProfile provides useful specs for:

- REST Client
- Config
- Fault Tolerance
- OpenAPI
- Health
- Telemetry
- JWT Auth

This path is useful for Jakarta EE / Quarkus / Open Liberty / Payara / Helidon-style architectures.

---

### 18.3 Quarkus

Quarkus is attractive for:

- fast startup
- container-native deployment
- reactive messaging
- MicroProfile support
- build-time optimization
- native image use cases

For projection consumers, startup and memory footprint may matter, but correctness still matters more.

---

### 18.4 Plain Java

Plain Java is viable for core projection logic:

- event handlers
- query model update rules
- DTO mapping
- idempotency checks
- compatibility logic
- domain-specific query rules

Frameworks should wrap this logic, not own it.

---

## 19. Anti-Patterns

### 19.1 Query Service as New Monolith

Symptom:

```text
All UI queries, reports, dashboards, exports, and business logic move into one Query Service.
```

Problem:

- query service becomes too large
- every team depends on it
- deployment bottleneck
- unclear ownership
- security complexity
- hidden business logic

Better:

```text
Read models should be owned by product/domain/query use case boundaries.
```

---

### 19.2 God BFF

Symptom:

```text
BFF contains workflow logic, authorization logic, retries, business rules, and cross-service state transitions.
```

A BFF should shape experience, not become the actual domain.

---

### 19.3 Materialized View as Source of Truth

Symptom:

```text
Teams start editing projection tables manually or using projection data for authoritative decisions without knowing freshness/correctness.
```

A projection is derived.

If it becomes source of truth, ownership must be redesigned.

---

### 19.4 Event Soup Projection

Symptom:

```text
Projection consumes many poorly named events with unclear semantics.
Nobody knows which event updates which field.
```

Fix:

- event catalog
- field lineage map
- projection dependency map
- schema governance
- owner per event

---

### 19.5 Live Fan-Out Reporting

Symptom:

```text
Monthly report calls 12 services repeatedly to build thousands of rows.
```

Problem:

- slow
- fragile
- hard to reproduce
- overloads transactional services
- inconsistent snapshot

Use reporting projection or export pipeline.

---

### 19.6 Fake CQRS

Symptom:

```text
Code has CommandService and QueryService classes, but both mutate data and share unclear models.
```

CQRS is not naming. It is responsibility separation.

---

### 19.7 No Rebuild Path

Symptom:

```text
Read model exists, but nobody knows how to rebuild it.
```

That is operational debt.

A projection without rebuild strategy is a future incident.

---

## 20. Case Study — Regulatory Application Worklist

### 20.1 Requirement

Build a worklist for officers:

```text
Show applications that are ready for officer action.
Filter by:
- application status
- assigned team
- officer
- SLA bucket
- payment status
- document completion
- applicant type
- risk level

Sort by:
- SLA due date
- risk level
- submitted date

Page size:
- 50

Freshness:
- within 5 seconds p95

Availability:
- worklist must remain available even if Payment Service is temporarily unavailable
```

---

### 20.2 Bad Design — Live API Composition

```text
Application Worklist API
  -> Application Service search UNDER_REVIEW
  -> For each row call Payment Service
  -> For each row call Document Service
  -> For each row call Risk Service
  -> Sort and filter in memory
```

Problems:

- N+1 calls
- unstable pagination
- cannot sort correctly before full dataset loaded
- slow
- fragile
- overloads dependencies
- inconsistent result if dependencies change mid-query

---

### 20.3 Better Design — Worklist Projection

```text
Application Service publishes application lifecycle events.
Payment Service publishes payment status events.
Document Service publishes document status events.
Risk Service publishes risk score events.
Workflow Service publishes assignment/SLA events.

Application Worklist Projection consumes events.
It maintains application_worklist_read_model.
Officer UI queries this read model.
```

---

### 20.4 Read Model Example

```sql
CREATE TABLE application_worklist_read_model (
    application_id        VARCHAR(64) PRIMARY KEY,
    application_no        VARCHAR(64) NOT NULL,
    status                VARCHAR(64) NOT NULL,
    assigned_team_id      VARCHAR(64),
    assigned_officer_id   VARCHAR(64),
    payment_status        VARCHAR(64),
    document_status       VARCHAR(64),
    applicant_type        VARCHAR(64),
    risk_level            VARCHAR(32),
    sla_due_at            TIMESTAMP,
    sla_bucket            VARCHAR(32),
    ready_for_action      BOOLEAN NOT NULL,
    last_projected_at     TIMESTAMP NOT NULL,
    data_quality          VARCHAR(64) NOT NULL,
    application_version   BIGINT NOT NULL DEFAULT 0,
    payment_version       BIGINT NOT NULL DEFAULT 0,
    document_version      BIGINT NOT NULL DEFAULT 0,
    risk_version          BIGINT NOT NULL DEFAULT 0,
    workflow_version      BIGINT NOT NULL DEFAULT 0
);
```

---

### 20.5 Query API

```http
GET /officer-worklist?teamId=T1&slaBucket=DUE_SOON&readyForAction=true&sort=slaDueAt.asc&pageSize=50
```

---

### 20.6 Projection Rule

```text
ready_for_action =
  application.status == UNDER_REVIEW
  AND payment.status == PAID
  AND document.status == COMPLETE
  AND workflow.assignedOfficerId IS NOT NULL
  AND risk.level != BLOCKED
```

This is a derived query rule.

Question:

> Who owns this rule?

Possible answer:

```text
The Worklist/Workflow domain owns “ready for action”, because it represents operational readiness, not merely application lifecycle, payment, or document ownership.
```

But this must be explicit.

---

## 21. Production Readiness Checklist

Before deploying an API composition endpoint:

```text
[ ] Is dependency count bounded?
[ ] Are calls parallelized safely?
[ ] Is there a total deadline?
[ ] Does each dependency have timeout?
[ ] Is partial failure behavior defined?
[ ] Are retries bounded and safe?
[ ] Are correlation IDs propagated?
[ ] Are dependency metrics emitted?
[ ] Is N+1 remote call avoided?
[ ] Is authorization enforced correctly?
[ ] Is response schema owned and versioned?
[ ] Is rate limiting considered?
[ ] Is the endpoint safe under dependency slowness?
```

Before deploying a materialized view:

```text
[ ] Is the read model owner clear?
[ ] Are source events documented?
[ ] Is field lineage documented?
[ ] Are projection update rules deterministic?
[ ] Are handlers idempotent?
[ ] Is out-of-order handling defined?
[ ] Is duplicate handling defined?
[ ] Is missing data handling defined?
[ ] Is freshness SLA defined?
[ ] Is projection lag measured?
[ ] Is rebuild process documented and tested?
[ ] Is replay safe?
[ ] Is reconciliation implemented?
[ ] Is security/PII handling reviewed?
[ ] Is schema evolution strategy defined?
[ ] Is migration/rollback strategy defined?
[ ] Is operational alerting configured?
```

Before adopting CQRS:

```text
[ ] Is there a real read/write model mismatch?
[ ] Is the complexity justified?
[ ] Can the team operate projection pipelines?
[ ] Can the business tolerate eventual consistency?
[ ] Are read-your-writes cases handled?
[ ] Are query use cases stable enough?
[ ] Are projection stores supported operationally?
[ ] Is the command side still authoritative?
[ ] Are source events reliable?
[ ] Are contracts versioned?
```

---

## 22. Architecture Review Questions

A senior/principal engineer should ask:

1. Why is API composition sufficient or insufficient here?
2. How many services are called per query?
3. What is the worst-case fan-out?
4. What is the p95/p99 latency target?
5. What is the freshness SLA?
6. What happens if one dependency is down?
7. What happens if one dependency is slow?
8. Can this query return partial data?
9. Does the query require cross-service filtering?
10. Does the query require cross-service sorting?
11. Does the query require stable pagination?
12. Who owns this read model?
13. Which source events populate each field?
14. Can we rebuild the read model?
15. How do we know projection is correct?
16. How do we reconcile with source of truth?
17. Is sensitive data duplicated?
18. How is authorization enforced?
19. What is the migration path from current query design?
20. What is the rollback plan?

---

## 23. Practical Exercises

### Exercise 1 — Classify Query Types

Take five screens from an enterprise system and classify each as:

```text
entity lookup
small detail composition
listing
search
dashboard
report
workflow worklist
```

Then choose:

```text
owning service query
API composition
BFF composition
materialized view
search projection
reporting store
```

Explain why.

---

### Exercise 2 — Detect Fan-Out Risk

For one existing API endpoint, draw:

```text
client -> service -> dependencies -> database/cache/broker
```

Calculate:

- number of remote calls
- sequential vs parallel calls
- worst-case dependency latency
- timeout budget
- retry multiplier
- total downstream call amplification

---

### Exercise 3 — Design a Projection

Design a read model for:

```text
Officer application worklist.
```

Include:

- table/index schema
- source events
- field lineage
- idempotency rule
- out-of-order rule
- freshness SLA
- rebuild plan
- reconciliation plan
- authorization model

---

### Exercise 4 — Read-Your-Writes Handling

For a command:

```text
Submit application.
```

Design what user sees immediately after submission.

Options:

- detail page from command side
- listing projection wait
- optimistic UI
- processing state
- read-your-writes token

Explain trade-offs.

---

## 24. Key Takeaways

1. Database-per-service creates the microservices query problem.
2. API composition is simple and useful, but dangerous for fan-out, listing, search, reporting, sorting, and pagination.
3. CQRS separates write model and read model, but should be used selectively because it adds complexity.
4. Materialized views are derived, query-optimized models, not authoritative source-of-truth data.
5. Projection ownership follows query use case ownership.
6. Read models must define freshness, idempotency, ordering, rebuild, reconciliation, and security.
7. Cross-service filtering/sorting/pagination usually indicates need for a read model.
8. Stale data is not automatically a bug, but undefined freshness is a design failure.
9. Java 21+ virtual threads can simplify API composition code, but do not remove distributed-systems risk.
10. Top-tier engineers design query architecture from use case, latency, freshness, ownership, and failure behavior — not from framework preference.

---

## 25. References

- Microservices.io — Database per Service Pattern: https://microservices.io/patterns/data/database-per-service.html
- Microservices.io — API Composition Pattern: https://microservices.io/patterns/data/api-composition.html
- Microservices.io — CQRS Pattern: https://microservices.io/patterns/data/cqrs.html
- Microservices.io — Event Sourcing Pattern: https://microservices.io/patterns/data/event-sourcing.html
- Martin Fowler — CQRS: https://martinfowler.com/bliki/CQRS.html
- Martin Fowler — Microservices: https://martinfowler.com/articles/microservices.html
- Microsoft Azure Architecture Center — CQRS Pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs
- Microsoft Azure Architecture Center — Materialized View Pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view
- Microsoft Azure Architecture Center — Data considerations for microservices: https://learn.microsoft.com/en-us/azure/architecture/microservices/design/data-considerations
- AWS Prescriptive Guidance — CQRS Pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/cqrs-pattern.html
- AWS Prescriptive Guidance — Patterns for enabling data persistence: https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/enabling-patterns.html
- OpenJDK — JDK 25 Project: https://openjdk.org/projects/jdk/25/

---

## 26. Series Progress

```text
Completed:
[00] Introduction and Mental Model
[01] Distributed Systems Reality
[02] Service Boundary Engineering
[03] Domain Modeling for Microservices
[04] Microservice Architecture Styles
[05] Synchronous API Communication
[06] Asynchronous Messaging
[07] Event-Driven Architecture Deep Dive
[08] Transaction Pattern: Local Transaction, Saga, and Compensation
[09] Transactional Outbox, Inbox, CDC, and Reliable Publishing
[10] Consistency Pattern and Distributed Invariants
[11] Data Ownership and Database-per-Service Pattern
[12] Query Pattern: API Composition, CQRS, and Materialized Views

Remaining:
[13] API Gateway, Edge, BFF, and Experience Layer
[14] Service Discovery, Configuration, and Runtime Topology
[15] Resilience Pattern: Timeout, Retry, Circuit Breaker, Bulkhead
[16] Backpressure, Flow Control, and Capacity-Aware Design
[17] Idempotency, Deduplication, and Exactly-Once Business Effect
[18] Workflow, Orchestration, Choreography, and Process Managers
[19] State Machine Pattern for Microservices
[20] Service-to-Service Security Patterns
[21] Multi-Tenancy, Isolation, and Regulatory Segmentation
[22] Observability Pattern for Microservices
[23] Testing Strategy for Microservices
[24] Contract, Schema, and Compatibility Engineering
[25] Deployment Pattern and Release Safety
[26] Runtime Platform Pattern: Kubernetes, Service Mesh, and Java Runtime
[27] Performance Engineering for Microservices
[28] Caching Pattern in Microservices
[29] Data Migration, Monolith Decomposition, and Strangler Fig
[30] Governance, Ownership, and Socio-Technical Architecture
[31] Incident, Failure Analysis, and Reliability Operations
[32] Cost, Complexity, and Architecture Economics
[33] Microservices Anti-Patterns and Failure Taxonomy
[34] Capstone: Architecture Review, Design Exercise, and Decision Framework
```

Seri belum selesai. Ini adalah **Part 12 dari 35**.
