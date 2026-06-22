# learn-java-microservices-patterns-advanced-engineering-34-capstone-architecture-review

> Series: `learn-java-microservices-patterns-advanced-engineering`  
> Part: `34 / 34`  
> Title: `Capstone: Architecture Review, Design Exercise, and Decision Framework`  
> Scope: Java 8–25 microservices architecture, architecture review, trade-off analysis, failure modeling, decision framework, production readiness  
> Level: Advanced / Principal-level engineering

---

## 0. Why This Capstone Exists

The previous parts taught individual forces and patterns:

- boundary engineering
- distributed systems reality
- domain modeling
- synchronous API communication
- asynchronous messaging
- event-driven architecture
- saga and compensation
- outbox/inbox/CDC
- consistency and distributed invariants
- data ownership
- query/read model strategies
- API gateway and BFF
- service discovery and runtime topology
- resilience patterns
- backpressure and capacity-aware design
- idempotency and deduplication
- workflow and process managers
- state machines
- service-to-service security
- multi-tenancy
- observability
- testing strategy
- compatibility engineering
- release safety
- Kubernetes, service mesh, and JVM runtime
- performance engineering
- caching
- monolith decomposition
- governance
- incident operations
- cost and architecture economics
- anti-pattern taxonomy

This final part does not introduce a new isolated pattern.

Instead, it answers a harder question:

> Given a real enterprise system, how do we combine all patterns into a coherent architecture that is correct, operable, evolvable, secure, and economically defensible?

A top-tier engineer is not top-tier because they know many patterns.

A top-tier engineer can answer:

```text
Which pattern should be used here?
Which pattern should not be used here?
What invariant are we protecting?
What failure mode are we accepting?
What operational burden are we creating?
What cost are we introducing?
Who owns the result?
How will we know it is failing?
How will we recover?
How will this evolve safely over 5 years?
```

That is the purpose of this capstone.

---

## 1. The Core Mental Model

Microservices architecture is a system of trade-offs across five dimensions:

```text
Domain correctness
+ Runtime reliability
+ Organizational ownership
+ Delivery independence
+ Economic sustainability
```

If one dimension is optimized while the others are ignored, the architecture becomes unstable.

Examples:

| Optimization | Common Failure |
|---|---|
| Split everything for team autonomy | Distributed monolith and cognitive overload |
| Use events everywhere | Event soup and hidden dependencies |
| Use synchronous APIs everywhere | Cascading latency and temporal coupling |
| Use shared database for convenience | No real service ownership |
| Add retries everywhere | Retry storm |
| Add cache everywhere | Stale/security-leaking data |
| Add service mesh everywhere | Invisible behavior and double retries |
| Add workflow engine for everything | Centralized process monolith |
| Add strict governance everywhere | Delivery paralysis |
| Add no governance | Incompatible chaos |

The mature architecture question is never:

```text
Is this pattern good?
```

It is:

```text
Good for which force?
Bad for which force?
Under which constraints?
With which failure modes?
Owned by whom?
Operated how?
Evolved how?
```

---

## 2. Capstone Case Study

We will use a realistic enterprise/regulatory system.

### 2.1 Business Context

Imagine a regulatory agency platform called:

```text
Regulatory Enforcement and Licensing Platform (RELP)
```

The platform supports:

1. Public license applications.
2. Renewal submissions.
3. Officer review.
4. Screening against risk rules.
5. Case creation for suspicious applications.
6. Compliance inspection.
7. Enforcement action.
8. Appeal handling.
9. Correspondence generation.
10. Payment and revenue tracking.
11. Document upload and retention.
12. Audit trail and reporting.
13. Multi-agency segmentation.
14. Internal and external portals.

### 2.2 Main Actors

| Actor | Description |
|---|---|
| Public applicant | External user submitting applications |
| Company admin | External user managing company submissions |
| Licensing officer | Internal reviewer |
| Compliance officer | Internal investigation/inspection user |
| Enforcement officer | Handles enforcement lifecycle |
| Appeal officer | Handles appeal submission and outcome |
| Finance user | Tracks payment/revenue |
| System scheduler | Runs deadlines, SLA checks, reminders |
| External identity provider | Provides login/user profile data |
| External payment gateway | Handles payment confirmation |
| External geocoding service | Validates address/postal code |
| External screening service | Returns risk/sanction/watchlist matches |
| Agency admin | Configures rules, templates, and routing |

### 2.3 Non-Functional Constraints

| Constraint | Meaning |
|---|---|
| High auditability | Every legally meaningful action must be traceable |
| Moderate latency sensitivity | User-facing APIs should feel responsive |
| Strong correctness on lifecycle transitions | Invalid state transition is unacceptable |
| Eventual consistency acceptable for reporting | Reports may lag within defined SLA |
| External dependency instability | Payment, identity, geocoding, and screening can fail |
| Multi-agency isolation | One agency's data must not leak to another |
| Long-running workflows | Application review and enforcement may take days/months |
| Regulatory retention | Records may need years of retention |
| Controlled release | Breaking regulatory flows during release is unacceptable |
| Team ownership constraints | Teams are organized by business modules and platform capabilities |

---

## 3. Architecture Review Method

A serious architecture review should proceed in layers.

Do not start with technology.

Start with forces.

```text
1. Business capability map
2. Domain lifecycle map
3. Data ownership map
4. Invariant map
5. Interaction map
6. Failure mode map
7. Runtime topology map
8. Security boundary map
9. Observability map
10. Release and migration map
11. Cost and ownership map
12. Decision record
```

This order matters.

If we start from Kubernetes, Kafka, Spring Boot, or service mesh, we will likely create infrastructure-shaped architecture.

If we start from domain, invariant, and ownership, we can choose infrastructure deliberately.

---

## 4. Step 1 — Business Capability Map

A business capability is a stable business function, not a UI screen, database table, or technical layer.

Candidate capabilities:

```text
Identity and Access
Applicant Profile
License Application
License Renewal
Officer Review
Risk Screening
Case Management
Compliance Inspection
Enforcement Action
Appeal Management
Payment and Revenue
Correspondence
Document Management
Notification
Rule Configuration
Template Management
Audit Trail
Reporting and Analytics
Reference Data
Agency Administration
```

### 4.1 Capability Grouping

Not every capability must become a microservice immediately.

Group them by cohesion.

| Capability Group | Candidate Service Boundary | Notes |
|---|---|---|
| External identity integration | Identity Adapter | Often adapter around external IdP |
| Profile and party data | Profile Service | May own applicant/company profile snapshot |
| License application lifecycle | Application Service | Strong lifecycle/state machine ownership |
| Renewal lifecycle | Renewal Service | Could be separate if lifecycle differs materially |
| Officer review | Review Service or inside Application Service | Depends on invariant cohesion |
| Risk screening | Screening Service | External integration + rules + result ownership |
| Case lifecycle | Case Service | Strong state machine and assignment logic |
| Compliance inspection | Inspection Service | May be separate from case if lifecycle differs |
| Enforcement action | Enforcement Service | Legal lifecycle boundary |
| Appeal lifecycle | Appeal Service | Independent long-running process |
| Payment | Payment Service | External payment integration and reconciliation |
| Correspondence | Correspondence Service | Template rendering + delivery record |
| Document | Document Service | Metadata + storage abstraction |
| Notification | Notification Service | Email/SMS/in-app delivery |
| Audit | Audit Service | Append-only audit record or central audit pipeline |
| Reporting | Reporting Service | Read model/reporting store |
| Reference data | Reference Data Service | Carefully governed shared reference source |
| Configuration/rules | Rules/Policy Service | Needs strict versioning |

### 4.2 Boundary Warning

A capability map is not a service map.

A capability map is input to boundary design.

Top-tier architecture does not mechanically convert every capability into a service.

Instead, ask:

```text
Does this capability own data?
Does it own lifecycle?
Does it own invariants?
Does it change independently?
Does it need independent scaling?
Does it have a different security boundary?
Does it have a different operational profile?
Does a team own it end-to-end?
```

Only then consider a service.

---

## 5. Step 2 — Domain Lifecycle Map

For RELP, the main lifecycle is application processing.

Example application lifecycle:

```text
DRAFT
  -> SUBMITTED
  -> PAYMENT_PENDING
  -> PAYMENT_CONFIRMED
  -> SCREENING_PENDING
  -> SCREENING_COMPLETED
  -> REVIEW_PENDING
  -> CLARIFICATION_REQUESTED
  -> CLARIFICATION_SUBMITTED
  -> APPROVED
  -> REJECTED
  -> LICENSE_ISSUED
  -> WITHDRAWN
  -> EXPIRED
```

But this is not enough.

A production lifecycle model must also describe:

| Concept | Example |
|---|---|
| Allowed transition | `SUBMITTED -> PAYMENT_PENDING` |
| Actor | Applicant, Officer, System |
| Guard | Required documents uploaded |
| Policy version | Rule set effective on submission date |
| Side effects | Publish event, create task, send email |
| Idempotency key | Submission command ID |
| Audit reason | User action or system action |
| Deadline | Clarification due date |
| Compensation | Cancel payment reservation |
| External dependency | Payment gateway, screening service |

### 5.1 State Transition Example

```text
Transition: SUBMIT_APPLICATION
From: DRAFT
To: SUBMITTED
Actor: Applicant
Guards:
  - Applicant is authenticated
  - Required fields complete
  - Required documents uploaded
  - Applicant has permission for company
Actions:
  - Persist application state change
  - Store submission timestamp
  - Append audit record
  - Insert outbox event ApplicationSubmitted
Side effects after commit:
  - Notify officer queue
  - Trigger payment preparation if payment required
  - Trigger screening if configured
```

### 5.2 Why Lifecycle Mapping Matters

If lifecycle and side effects are not explicit, developers will scatter logic across:

```text
Controller
Service class
Event listener
Scheduler
Database trigger
Frontend status check
Batch job
```

That creates a hidden state machine.

A hidden state machine is dangerous because nobody can review correctness.

A top-tier system makes lifecycle explicit.

---

## 6. Step 3 — Invariant Map

An invariant is something that must remain true.

Microservices design starts by classifying invariants.

### 6.1 Example Invariants

| Invariant | Type | Owner | Enforcement Strategy |
|---|---|---|---|
| Application cannot be submitted without mandatory documents | Local strong invariant | Application Service | Same transaction validation |
| Application cannot be approved before screening completes | Local or cross-service invariant | Application + Screening | Screening result snapshot + transition guard |
| Payment must not be marked confirmed without payment provider confirmation | External consistency invariant | Payment Service | Provider callback + reconciliation |
| License number must be unique | Local strong invariant | License Service | DB unique constraint |
| Officer cannot approve own application | Authorization/business invariant | Application/Review Service | Policy check at transition |
| Appeal must reference a rejected decision | Cross-service invariant | Appeal Service + Application Service | Verified snapshot at appeal creation |
| Audit trail must exist for every legal decision | Audit/legal invariant | Owning service + Audit pipeline | Transactional audit/outbox |
| Reports must reflect approved licenses within 15 minutes | Eventual invariant | Reporting Service | Projection lag SLO |
| Tenant A data must never appear to Tenant B | Security invariant | All services | Tenant context + DB/search/cache isolation |

### 6.2 Invariant Classification

```text
Local invariant
  Can be enforced in one service transaction.

Cross-service invariant
  Requires coordination between services.

Temporal invariant
  Must become true within a time window.

Eventual invariant
  Can temporarily be false but must converge.

Compensatable invariant
  Can be corrected by a later action.

Non-compensatable invariant
  Must be prevented before side effect occurs.

Audit/legal invariant
  Must be explainable and defensible later.
```

### 6.3 Top-Tier Rule

Never design service boundaries before classifying invariants.

If two concepts share many non-compensatable invariants, splitting them into different services may be a mistake.

---

## 7. Step 4 — Service Boundary Proposal

A reasonable initial architecture for RELP:

```text
External Portal / Internal Portal
        |
        v
API Gateway / BFF Layer
        |
        +--> Identity Adapter
        +--> Profile Service
        +--> Application Service
        +--> Screening Service
        +--> Payment Service
        +--> Case Service
        +--> Compliance Service
        +--> Enforcement Service
        +--> Appeal Service
        +--> Document Service
        +--> Correspondence Service
        +--> Notification Service
        +--> Audit Service
        +--> Reporting Service
        +--> Reference Data Service
        +--> Policy/Rules Service
```

But this is only a candidate.

Now we validate each boundary.

### 7.1 Application Service

Owns:

```text
Application aggregate
Application lifecycle
Submission rules
Review decision state
Application transition audit
ApplicationSubmitted / ApplicationApproved / ApplicationRejected events
```

Should not own:

```text
Payment provider protocol
Screening provider protocol
Email rendering/delivery
Long-term analytics store
Document binary storage internals
```

### 7.2 Screening Service

Owns:

```text
Screening request
Screening result
Screening provider integration
Screening rule version
ScreeningCompleted event
```

Does not decide final approval unless business says screening is the final decision authority.

### 7.3 Payment Service

Owns:

```text
Payment intent
Payment provider interaction
Payment confirmation
Payment reconciliation
Refund/void process if applicable
PaymentConfirmed event
```

Payment Service should not directly mutate Application state.

It publishes facts.

Application Service consumes facts and advances its own lifecycle.

### 7.4 Case Service

Owns:

```text
Case lifecycle
Assignment
Escalation
Case tasks
Case notes
Case outcome
```

If enforcement lifecycle is legally distinct, Enforcement Service may own enforcement action.

If case and enforcement are tightly bound in one lifecycle with many shared invariants, they may initially remain together.

### 7.5 Audit Service

Two possible designs:

#### Design A — Each service owns its audit records

Pros:

```text
Strong local consistency
Clear domain context
No central bottleneck
```

Cons:

```text
Harder centralized search
Requires audit projection/reporting
```

#### Design B — Central Audit Service

Pros:

```text
Centralized audit search
Uniform audit schema
```

Cons:

```text
Risk of central dependency
Can become write bottleneck
Can weaken transactional audit guarantee
```

Mature design often combines both:

```text
Each service persists legal audit facts locally in the same transaction.
A central audit projection consumes audit events for search/reporting.
```

---

## 8. Step 5 — Data Ownership Design

### 8.1 Service-Owned Data

| Service | Owns | Does Not Own |
|---|---|---|
| Application | Application state, submission data, decision | Payment provider raw events |
| Payment | Payment intent, confirmation, reconciliation | Application approval decision |
| Screening | Screening request/result | Final license decision |
| Document | Document metadata, storage pointer, hash | Business lifecycle state |
| Case | Case state, assignment, escalation | License issuance |
| Correspondence | Generated correspondence record | Application decision |
| Audit | Central audit projection/search | Original domain transaction source of truth |
| Reporting | Projections/reports | Command-side truth |

### 8.2 Avoid Shared Database

Bad design:

```text
Application Service writes APPLICATION table.
Payment Service updates APPLICATION.PAYMENT_STATUS.
Screening Service updates APPLICATION.SCREENING_STATUS.
Reporting Service joins APPLICATION, PAYMENT, SCREENING directly.
```

This creates shared ownership.

Better design:

```text
Application DB owns application lifecycle.
Payment DB owns payment records.
Screening DB owns screening records.
Reporting DB owns projections built from events.
```

### 8.3 Data Duplication Is Not Automatically Bad

Microservices often duplicate data intentionally.

Example Application Service may store:

```text
applicantNameSnapshot
companyNameSnapshot
paymentStatusSnapshot
screeningStatusSnapshot
policyVersionAtSubmission
```

These are not accidental duplication.

They are business snapshots that preserve decision context.

---

## 9. Step 6 — Communication Design

### 9.1 Synchronous Calls

Use synchronous calls when:

```text
User is waiting.
The response is needed to continue.
The dependency is reliable enough.
The latency budget is clear.
The operation is read-like or bounded.
```

Example:

```text
Portal -> BFF -> Application Service: Get application detail
BFF -> Reference Data Service: Get dropdown list
Application Service -> Document Service: Validate required document metadata
```

### 9.2 Asynchronous Events

Use asynchronous events when:

```text
The fact already happened.
Consumers should react independently.
The producer should not wait for every consumer.
The side effect can happen after commit.
Replay/reprocessing may be needed.
```

Example events:

```text
ApplicationSubmitted
PaymentConfirmed
ScreeningCompleted
ApplicationApproved
LicenseIssued
CaseCreated
CorrespondenceGenerated
```

### 9.3 Commands vs Events

Command:

```text
ApproveApplication
RequestScreening
GenerateCorrespondence
CreateCase
```

Event:

```text
ApplicationApproved
ScreeningRequested
CorrespondenceGenerated
CaseCreated
```

A command asks for something.

An event states that something happened.

Confusing the two creates orchestration ambiguity.

---

## 10. Step 7 — End-to-End Flow Design

### 10.1 Application Submission Flow

```text
Applicant
  -> Portal
  -> BFF
  -> Application Service
       - validate command
       - check local invariants
       - persist Application state SUBMITTED
       - insert outbox ApplicationSubmitted
       - commit
  -> returns submission confirmation

Outbox Relay
  -> publishes ApplicationSubmitted

Payment Service
  -> consumes ApplicationSubmitted if payment required
  -> creates PaymentIntent
  -> publishes PaymentRequested

Screening Service
  -> consumes ApplicationSubmitted if screening required
  -> creates ScreeningRequest
  -> calls external screening provider asynchronously or via worker
  -> publishes ScreeningCompleted

Application Service
  -> consumes PaymentConfirmed
  -> updates payment snapshot
  -> consumes ScreeningCompleted
  -> updates screening snapshot
  -> when guards satisfied, transitions to REVIEW_PENDING
  -> publishes ApplicationReadyForReview

Review Worklist Projection
  -> consumes ApplicationReadyForReview
  -> updates officer worklist
```

### 10.2 Why This Design Works

It avoids:

```text
Holding database transaction while calling external services.
Application Service knowing payment provider protocol.
Payment Service directly mutating application state.
Screening Service directly approving application.
Reporting joining command-side databases.
```

It supports:

```text
Retry-safe side effects.
Clear data ownership.
Eventual consistency with traceability.
Independent scaling.
Replayable projections.
Auditability.
```

### 10.3 What This Design Costs

It introduces:

```text
More moving parts.
Event schema governance.
Outbox relay operations.
Duplicate event handling.
Projection lag.
Cross-service debugging complexity.
More testing dimensions.
```

No architecture is free.

The review must explicitly decide whether the cost is justified.

---

## 11. Step 8 — Saga and Workflow Design

### 11.1 Is Application Submission a Saga?

It depends.

If application submission only records the submission and later processes payment/screening asynchronously, it may not need a saga.

But if the business operation is:

```text
Submit application
Reserve payment
Start screening
Create review task
Send confirmation
```

and the platform must track overall progress, timeout, compensation, and recovery, then a process manager/saga may be justified.

### 11.2 Saga Candidate: Application Intake Process

```text
STARTED
  -> APPLICATION_SUBMITTED
  -> PAYMENT_REQUESTED
  -> PAYMENT_CONFIRMED
  -> SCREENING_REQUESTED
  -> SCREENING_COMPLETED
  -> REVIEW_TASK_CREATED
  -> INTAKE_COMPLETED
```

Failure transitions:

```text
PAYMENT_FAILED
SCREENING_FAILED
TIMEOUT_WAITING_PAYMENT
TIMEOUT_WAITING_SCREENING
INTAKE_CANCELLED
INTAKE_REQUIRES_MANUAL_REVIEW
```

### 11.3 Compensation Examples

| Step | Possible Compensation |
|---|---|
| Payment reserved | Void authorization |
| Payment captured | Refund, if policy allows |
| Screening requested | Mark screening obsolete; cannot un-call external provider |
| Review task created | Cancel task |
| Email sent | Cannot unsend; send correction notice |
| Case created | Close as created-in-error with audit reason |

Important:

```text
Compensation is not database rollback.
Compensation is a business action that repairs or explains the outcome.
```

### 11.4 Orchestration or Choreography?

Use choreography when:

```text
Flow is simple.
Consumers are independent.
No central state is required.
No complex timeout/compensation exists.
```

Use orchestration/process manager when:

```text
The flow is long-running.
There are many steps.
Timeout and escalation matter.
Compensation must be controlled.
Audit wants one process timeline.
Business users need process visibility.
```

For RELP, major lifecycles such as enforcement or appeal may benefit from explicit workflow/process manager modeling.

---

## 12. Step 9 — Consistency Decision

### 12.1 Application Approval Decision

Approval must enforce:

```text
Application is in REVIEW_PENDING or CLARIFICATION_SUBMITTED.
Screening is completed.
Payment is confirmed if required.
Officer is authorized.
Required documents are valid.
No conflicting active license exists.
```

Which checks are local?

```text
Application state: local
Officer assignment: local if owned by Application/Review
Payment confirmed: local snapshot, sourced from Payment event
Screening completed: local snapshot, sourced from Screening event
Document metadata: possibly synchronous validation or local snapshot
Conflicting active license: depends on License Service ownership
```

### 12.2 Strong or Eventual?

For approval, the decision itself should be locally strong inside the owning service.

But the inputs may be eventually updated via events.

This pattern is:

```text
Local strong decision over replicated/snapshotted facts.
```

That means Application Service must know:

```text
Which snapshot version was used.
When it was received.
Which event produced it.
Whether it is still valid enough for decision.
```

### 12.3 Decision Context Snapshot

When approving, store:

```text
applicationVersion
paymentStatusAtDecision
paymentEventId
screeningStatusAtDecision
screeningResultVersion
policyVersion
officerId
decisionTimestamp
reasonCode
supportingDocumentHashes
```

This is crucial for audit defensibility.

---

## 13. Step 10 — API Design

### 13.1 Command API

Example:

```http
POST /applications/{applicationId}/commands/submit
Idempotency-Key: 4ec48b4f-...
X-Correlation-Id: ...
```

Request:

```json
{
  "actorId": "user-123",
  "companyId": "company-456",
  "submissionDeclaration": true,
  "clientRequestId": "submit-2026-00001"
}
```

Response:

```json
{
  "applicationId": "app-001",
  "state": "SUBMITTED",
  "version": 7,
  "submittedAt": "2026-06-19T10:15:30+07:00",
  "next": {
    "paymentRequired": true,
    "screeningRequired": true
  }
}
```

### 13.2 Query API

```http
GET /applications/{applicationId}
```

Response includes:

```json
{
  "applicationId": "app-001",
  "state": "REVIEW_PENDING",
  "version": 12,
  "payment": {
    "status": "CONFIRMED",
    "lastUpdatedAt": "2026-06-19T10:17:00+07:00"
  },
  "screening": {
    "status": "COMPLETED",
    "riskLevel": "LOW",
    "lastUpdatedAt": "2026-06-19T10:18:10+07:00"
  },
  "links": {
    "approve": "/applications/app-001/commands/approve",
    "reject": "/applications/app-001/commands/reject"
  }
}
```

### 13.3 Worklist Query

Officer worklists should probably not fan out to every service on every page load.

Better:

```text
Application events + assignment events + screening/payment summary events
  -> Worklist Projection
  -> Officer Worklist API
```

This supports sorting, filtering, and pagination.

---

## 14. Step 11 — Event Design

### 14.1 Event Envelope

```json
{
  "eventId": "evt-001",
  "eventType": "ApplicationSubmitted",
  "eventVersion": 1,
  "occurredAt": "2026-06-19T10:15:30+07:00",
  "publishedAt": "2026-06-19T10:15:31+07:00",
  "producer": "application-service",
  "tenantId": "agency-001",
  "correlationId": "corr-001",
  "causationId": "cmd-001",
  "traceId": "trace-001",
  "subject": {
    "type": "Application",
    "id": "app-001",
    "version": 7
  },
  "data": {
    "applicationId": "app-001",
    "applicationType": "NEW_LICENSE",
    "submittedBy": "user-123",
    "companyId": "company-456",
    "submittedAt": "2026-06-19T10:15:30+07:00"
  }
}
```

### 14.2 Event Review Checklist

Before publishing an event, ask:

```text
Is this a fact that already happened?
Who owns its meaning?
Is the name past tense?
Is the payload stable enough?
Does it expose PII unnecessarily?
Can it be replayed safely?
Can consumers ignore unknown fields?
Is event versioning defined?
Is ordering required?
What is the partition key?
What is the retention policy?
What is the DLQ policy?
What metric tells us consumers are lagging?
```

---

## 15. Step 12 — Outbox/Inbox Design

### 15.1 Outbox Table

```sql
CREATE TABLE outbox_event (
    id              VARCHAR(64) PRIMARY KEY,
    aggregate_type  VARCHAR(100) NOT NULL,
    aggregate_id    VARCHAR(100) NOT NULL,
    aggregate_ver   BIGINT NOT NULL,
    event_type      VARCHAR(100) NOT NULL,
    event_version   INT NOT NULL,
    tenant_id       VARCHAR(100) NOT NULL,
    correlation_id  VARCHAR(100),
    causation_id    VARCHAR(100),
    payload_json    CLOB NOT NULL,
    status          VARCHAR(30) NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    published_at    TIMESTAMP NULL,
    retry_count     INT NOT NULL DEFAULT 0,
    last_error      VARCHAR(1000) NULL
);
```

### 15.2 Inbox Table

```sql
CREATE TABLE inbox_message (
    message_id      VARCHAR(64) PRIMARY KEY,
    consumer_name   VARCHAR(100) NOT NULL,
    tenant_id       VARCHAR(100) NOT NULL,
    received_at     TIMESTAMP NOT NULL,
    processed_at    TIMESTAMP NULL,
    status          VARCHAR(30) NOT NULL,
    error_message   VARCHAR(1000) NULL
);
```

### 15.3 Outbox/Inbox Rule

```text
Outbox protects producer-side atomicity.
Inbox protects consumer-side idempotency.
```

Together they support effectively-once business effects.

---

## 16. Step 13 — Resilience Design

### 16.1 Timeout Budget Example

Assume user-facing request budget:

```text
Total budget: 2 seconds
```

Possible allocation:

```text
Gateway/BFF overhead: 100 ms
Application Service: 300 ms
Document metadata validation: 300 ms
Reference data check: 100 ms
Database transaction: 300 ms
Network overhead: 100 ms
Buffer: 800 ms
```

But approval should not synchronously call:

```text
Payment gateway
Screening provider
Email provider
Reporting store
```

Those should be precomputed, event-driven, or asynchronous.

### 16.2 Retry Rules

Retry only when:

```text
The operation is idempotent.
The error is likely transient.
The retry stays within deadline.
The system has retry budget.
The dependency can tolerate it.
```

Never blindly retry:

```text
validation error
authorization error
business rule violation
non-idempotent side effect
known permanent failure
```

### 16.3 Circuit Breaker Placement

Potential circuit breakers:

```text
BFF -> Application Service
Application Service -> Document Service
Screening Service -> External Screening Provider
Payment Service -> Payment Gateway
Correspondence Service -> Email Provider
```

But do not duplicate contradictory retry/circuit policies across:

```text
HTTP client
service mesh
gateway
load balancer
library wrapper
```

There must be one coherent resilience policy.

---

## 17. Step 14 — Backpressure and Capacity Design

### 17.1 Critical Limits

Each service should define:

```text
max inbound HTTP concurrency
max DB connections
max outbound dependency concurrency
max queue consumer concurrency
max retry rate
max batch size
max request payload size
max per-tenant throughput
```

### 17.2 Example Application Service Limits

```text
HTTP worker concurrency: 200
DB pool max: 40
Outbox publisher concurrency: 8
Inbound event consumer concurrency: 16
Per-tenant submit rate: 60/min
Max upload metadata validation batch: 100 documents
```

The numbers are not universal.

The principle is:

```text
Every queue and pool must be bounded.
Every dependency must have a concurrency budget.
Every overload path must fail predictably.
```

### 17.3 Load Shedding

When overloaded:

```text
Reject non-critical search/reporting first.
Degrade dashboard freshness.
Pause expensive exports.
Limit per-tenant burst.
Protect command-side state transitions.
Protect audit writes.
```

This is business-aware degradation.

---

## 18. Step 15 — Security Design

### 18.1 Trust Boundaries

```text
Internet -> API Gateway
API Gateway -> BFF
BFF -> Internal Services
Internal Service -> Internal Service
Service -> Database
Service -> Broker
Service -> External Provider
Admin User -> Admin API
Support User -> Tenant Data
```

Each boundary needs authentication, authorization, and audit.

### 18.2 Service-to-Service Security

Options:

```text
mTLS for workload identity
OAuth2 client credentials for service authorization
JWT token exchange for delegated user context
Audience-restricted tokens
Short token lifetime
Central policy decision for complex authorization
Local policy enforcement for domain invariants
```

### 18.3 Authorization Rule

Gateway can enforce coarse rules:

```text
Is authenticated?
Is route allowed?
Is token valid?
Is tenant claim present?
```

Domain service must enforce domain-specific rules:

```text
Can this officer approve this specific application?
Can this agency view this case?
Can this user perform this transition in this state?
Can this support user access this tenant record?
```

Do not put object-level regulatory authorization only at the gateway.

---

## 19. Step 16 — Multi-Tenancy Design

### 19.1 Tenant Context

Every request/event/log/metric/audit record should carry tenant context where applicable.

```text
tenantId
agencyId
businessUnitId
jurisdictionId
caseVisibilityGroup
```

### 19.2 Tenant Isolation Matrix

| Layer | Isolation Strategy |
|---|---|
| API | Tenant claim validation and route authorization |
| DB | Tenant discriminator, schema, or database depending on risk |
| Cache | Tenant included in key; no shared unscoped cache key |
| Search | Tenant filter enforced server-side |
| Event | Tenant in envelope and partitioning consideration |
| Logs | Tenant field with privacy controls |
| Metrics | Tenant cardinality controlled; high-risk tenants tracked explicitly |
| Admin tools | Break-glass access audited |
| Reports | Tenant scope enforced by projection design |

### 19.3 Common Failure

```text
Cache key = application:{id}
```

Better:

```text
Cache key = tenant:{tenantId}:application:{id}:v{schemaVersion}
```

But also ask:

```text
Should this object be cached at all?
Does authorization vary by user?
Can cached data leak across roles?
```

---

## 20. Step 17 — Observability Design

### 20.1 Traceability Fields

Minimum fields:

```text
traceId
spanId
correlationId
causationId
requestId
messageId
tenantId
actorId
serviceName
operationName
businessObjectType
businessObjectId
stateBefore
stateAfter
version
```

### 20.2 Business Observability

For Application Service:

```text
applications_submitted_total
applications_approved_total
applications_rejected_total
application_state_transition_total
application_transition_failure_total
application_approval_latency_seconds
application_stuck_in_state_total
outbox_pending_count
outbox_publish_lag_seconds
inbox_duplicate_count
consumer_lag
projection_lag_seconds
```

### 20.3 Golden Signals + Business Signals

Technical:

```text
latency
traffic
errors
saturation
```

Business:

```text
submission success rate
payment confirmation lag
screening completion lag
review backlog
SLA breach count
case escalation count
projection freshness
```

A mature system observes both.

---

## 21. Step 18 — Testing Strategy

### 21.1 Test Portfolio

| Test Type | Purpose |
|---|---|
| Unit test | Validate local logic and guards |
| State machine test | Validate allowed/forbidden transitions |
| Component test | Validate service with real DB/broker adapters |
| Contract test | Validate API/event compatibility |
| Integration test | Validate dependency integration |
| Consumer replay test | Validate old events still process |
| Migration test | Validate schema/data migration |
| Resilience test | Validate timeout/retry/fallback behavior |
| Performance test | Validate capacity and latency budget |
| Security test | Validate tenant/object authorization |
| E2E smoke test | Validate critical happy path |
| Synthetic production test | Validate live system behavior safely |

### 21.2 Avoid E2E-Only Strategy

E2E tests are useful but insufficient.

They are:

```text
slow
flaky
hard to diagnose
expensive to maintain
poor at covering failure modes
poor at isolating ownership
```

Use E2E for critical journey confidence.

Use contract/component/replay tests for scalable confidence.

---

## 22. Step 19 — Release Design

### 22.1 Compatibility-First Release

Every service release must answer:

```text
Can old consumers still call the new provider?
Can new consumers call old provider during rollout?
Can old events still be consumed?
Can new events be ignored by old consumers?
Can old projections still be rebuilt?
Can DB migration be rolled forward safely?
Can long-running workflows continue?
```

### 22.2 Expand-Contract Example

To rename field `applicantName` to `applicantDisplayName`:

```text
Release 1: Provider emits both fields.
Release 2: Consumers switch to new field.
Release 3: Compatibility checks confirm no old consumers.
Release 4: Remove old field.
```

Do not remove first and hope consumers update.

### 22.3 Database Migration Rule

Deployment-safe migrations are usually:

```text
add nullable column
backfill safely
dual write if needed
switch reads
make non-null after verified
remove old column later
```

Avoid:

```text
rename column and deploy all services together
change enum value without compatibility
drop column used by old version
modify event schema incompatibly
```

---

## 23. Step 20 — Runtime Platform Design

### 23.1 Java Runtime Baseline

For a modern platform:

```text
Java 17: strong enterprise baseline
Java 21: better modern baseline, virtual threads available
Java 25: latest horizon, evaluate after ecosystem support and organizational readiness
```

Java 8 services may exist in legacy environments, but new architecture should avoid designing around Java 8 limitations unless required.

### 23.2 JVM in Container

Review:

```text
heap sizing
native memory
thread stack usage
GC selection
CPU throttling
startup behavior
JIT warmup
readiness probe timing
graceful shutdown
connection draining
```

### 23.3 Kubernetes Health

Use:

```text
startupProbe: protects slow startup
readinessProbe: controls traffic eligibility
livenessProbe: restarts genuinely stuck process
```

Bad liveness probes cause self-inflicted outages.

Readiness should represent whether the service can safely receive traffic.

### 23.4 Service Mesh Caution

Service mesh can help with:

```text
mTLS
traffic routing
observability
policy enforcement
```

But it can also hide:

```text
retries
timeouts
circuit breaking
latency overhead
sidecar resource consumption
configuration drift
```

Application and mesh policies must be coordinated.

---

## 24. Step 21 — Performance Review

### 24.1 Critical Path

For `SubmitApplication`:

```text
Gateway
  -> BFF
  -> Application Service
  -> DB transaction
  -> Outbox insert
  -> response
```

This path should not synchronously wait for:

```text
screening provider
payment provider
email provider
reporting projection
analytics pipeline
```

### 24.2 Fan-Out Risk

For `GetApplicationDashboard`, avoid:

```text
BFF calls 15 services for every dashboard load.
```

Prefer:

```text
Dashboard projection optimized for dashboard query.
```

### 24.3 Capacity Formula

Use Little's Law as a sanity check:

```text
Concurrency = Throughput × Latency
```

If target throughput is 100 requests/sec and p95 latency is 500 ms:

```text
Approx concurrency = 100 × 0.5 = 50 concurrent requests
```

Then add headroom, failure mode assumptions, and dependency limits.

---

## 25. Step 22 — Caching Review

### 25.1 Cache Candidates

Good candidates:

```text
reference data
feature flags
public/static configuration
template metadata
read-only dropdowns
frequently read low-change data
```

Risky candidates:

```text
authorization-sensitive objects
rapidly changing state
workflow transition eligibility
payment status
screening result before decision
multi-tenant sensitive data
```

### 25.2 Cache Rule

Cache should not become hidden source of truth.

For decision-making transitions, prefer:

```text
local transaction state
versioned snapshots
explicit freshness rules
```

Not:

```text
whatever Redis says right now
```

---

## 26. Step 23 — Incident Review Design

Before production, define failure playbooks.

### 26.1 Incident Scenarios

```text
Payment callback delayed.
Screening provider down.
Application outbox stuck.
Kafka/RabbitMQ consumer lag grows.
Worklist projection stale.
DB connection pool exhausted.
API gateway returns 504.
Tenant data leak suspected.
Bad deployment breaks approval transition.
Cache cluster unavailable.
Service mesh config causes retry storm.
```

### 26.2 Incident Questions

For each scenario:

```text
How is it detected?
Who is paged?
What dashboard is used?
What is the immediate containment action?
What can be safely disabled?
What data may need reconciliation?
What is the customer/user impact?
What is the audit/compliance impact?
How do we recover?
How do we verify recovery?
```

---

## 27. Architecture Decision Record Example

```markdown
# ADR-014: Use Transactional Outbox for Application Domain Events

## Status
Accepted

## Context
Application Service must publish domain/integration events such as ApplicationSubmitted,
ApplicationApproved, and ApplicationRejected after committing state changes. Publishing directly
to the broker inside the request path creates a dual-write problem: the database commit may succeed
while broker publish fails, or broker publish may succeed while the database transaction rolls back.

## Decision
Application Service will write domain events into an `outbox_event` table in the same database
transaction as the application state change. A separate outbox relay will publish pending events to
the broker. Consumers must implement idempotency using message ID/inbox semantics.

## Consequences
Positive:
- State change and event creation are atomic.
- Failed publishes can be retried.
- Events can be audited and replayed.
- Application request path does not depend directly on broker availability.

Negative:
- Requires relay process and monitoring.
- Requires outbox cleanup/retention policy.
- Consumers still need idempotency.
- Event publish is eventually consistent, not immediate.

## Alternatives Considered
1. Publish directly after DB commit.
   Rejected due to lost event risk.
2. Distributed transaction between DB and broker.
   Rejected due to complexity and operational coupling.
3. Poll application table directly.
   Rejected due to weak semantic event boundary.

## Operational Requirements
- Alert if outbox pending count exceeds threshold.
- Alert if publish lag exceeds 2 minutes.
- Relay must be horizontally safe with row-level locking or equivalent claiming.
- Events must include correlation ID, causation ID, tenant ID, aggregate version.
```

---

## 28. Full Architecture Review Checklist

### 28.1 Domain and Boundary

```text
[ ] Services are organized around business capability, not technical layer.
[ ] Each service has clear data ownership.
[ ] Each service owns its lifecycle/invariants.
[ ] No service writes another service's private database.
[ ] Shared library usage does not create shared domain model coupling.
[ ] Boundary decisions have ADRs.
[ ] Boundary smells are documented and accepted only deliberately.
```

### 28.2 Data and Consistency

```text
[ ] Database-per-service or schema ownership is enforced.
[ ] Cross-service queries avoid direct joins across private stores.
[ ] Invariants are classified as local/cross-service/eventual/compensatable/legal.
[ ] Sagas/process managers are used only when justified.
[ ] Outbox/inbox or equivalent reliable publishing exists.
[ ] Reconciliation strategy exists for eventual consistency.
[ ] Reporting data is clearly not command-side truth.
```

### 28.3 API and Events

```text
[ ] API contracts are explicit and versioned.
[ ] Event contracts are explicit and versioned.
[ ] Commands and events are not confused.
[ ] Error model is standardized enough for clients.
[ ] Idempotency is defined for side-effecting commands.
[ ] Pagination/filtering/sorting are designed for real data volume.
[ ] Consumer-driven contract tests exist for critical integrations.
```

### 28.4 Resilience and Runtime

```text
[ ] Timeout budget exists for synchronous flows.
[ ] Retry policies include backoff, jitter, and retry budget.
[ ] Circuit breakers are used where failure isolation is needed.
[ ] Bulkheads/concurrency limits protect critical dependencies.
[ ] Queues and executors are bounded.
[ ] Load shedding policy exists.
[ ] Kubernetes probes are meaningful and safe.
[ ] Graceful shutdown handles in-flight requests/messages.
[ ] Service mesh policy does not conflict with application policy.
```

### 28.5 Security and Tenancy

```text
[ ] Trust boundaries are mapped.
[ ] Service identity is established.
[ ] User delegation is explicit where needed.
[ ] Audience/scope/permission are understood separately.
[ ] Domain services enforce object-level authorization.
[ ] Tenant context is propagated safely.
[ ] Cache/search/event/log layers are tenant-aware.
[ ] Secrets and certificates have rotation strategy.
[ ] Break-glass/admin access is audited.
```

### 28.6 Observability and Operations

```text
[ ] Logs are structured and correlated.
[ ] Metrics include technical and business correctness signals.
[ ] Traces work across sync and async paths.
[ ] Outbox/inbox/projection lag is observable.
[ ] SLOs exist for critical flows.
[ ] Alerts map to user impact or imminent risk.
[ ] Runbooks exist for common incidents.
[ ] Postmortem process feeds reliability backlog.
```

### 28.7 Testing and Release

```text
[ ] Test strategy is not E2E-only.
[ ] Contract tests protect API/event compatibility.
[ ] Replay tests protect event consumers.
[ ] Migration tests protect database changes.
[ ] Security tests cover tenant/object-level access.
[ ] Performance tests cover realistic fan-out and data volume.
[ ] Releases are backward/forward compatible.
[ ] Rollback/roll-forward strategy is defined.
[ ] Long-running workflows survive deployment.
```

### 28.8 Economics and Governance

```text
[ ] Each service has an owner.
[ ] Operational ownership is explicit.
[ ] Cost drivers are visible.
[ ] Cognitive load is considered.
[ ] Golden path exists for common service capabilities.
[ ] Governance is federated enough to avoid chaos without blocking autonomy.
[ ] Complexity budget is reviewed periodically.
[ ] Consolidation is considered when services no longer justify their cost.
```

---

## 29. Design Review Questions for Top-Tier Engineers

Use these questions during architecture review.

### 29.1 Boundary

```text
What invariant would be broken if this service is unavailable?
What data does this service authoritatively own?
Who is allowed to mutate that data?
Can this service be deployed independently in practice?
What other service must change whenever this service changes?
Is this boundary aligned to a team boundary?
```

### 29.2 Communication

```text
Why is this call synchronous?
What happens if the dependency is slow?
What happens if the dependency returns success but response is lost?
What happens if the message is delivered twice?
What happens if events arrive out of order?
Can this consumer replay all historical events safely?
```

### 29.3 Consistency

```text
Which invariant must be immediate?
Which invariant may converge later?
What is the allowed inconsistency window?
How is inconsistency detected?
How is inconsistency corrected?
What audit evidence proves the decision was valid?
```

### 29.4 Runtime

```text
What is the timeout budget?
What is the concurrency budget?
What is the retry budget?
What is the maximum queue depth?
What is the blast radius of this service failing?
What is the graceful degradation path?
```

### 29.5 Security

```text
Who is the actor?
Is this user action, service action, or delegated action?
Which service enforces object-level permission?
How is tenant isolation guaranteed?
Can cached/projected data leak across tenants or roles?
How is admin/support access audited?
```

### 29.6 Operations

```text
How will we know this is broken?
What metric changes first?
What dashboard shows user impact?
What log field connects the chain?
What is the first containment action?
What is the recovery verification step?
```

### 29.7 Economics

```text
Why is this a separate service?
What cost does this split create?
What cost does it remove?
What team owns it?
What happens if we merge it?
What happens if we split it further?
What is the complexity budget?
```

---

## 30. Example Final Architecture Diagram

```text
                         +--------------------+
                         |  External Portal   |
                         +---------+----------+
                                   |
                         +---------v----------+
                         |    API Gateway     |
                         +---------+----------+
                                   |
                         +---------v----------+
                         |        BFF         |
                         +----+----+----+-----+
                              |         |
          +-------------------+         +------------------+
          |                                                |
+---------v----------+                           +---------v----------+
| Application Service |                           |  Profile Service   |
| - lifecycle         |                           | - applicant data   |
| - transition guard  |                           | - company snapshot |
| - outbox            |                           +--------------------+
+----+-----------+----+
     |           |
     | events    | sync metadata validation
     |           |
+----v-----------v----+       +--------------------+
|      Broker         |<----->|  Document Service  |
+----+-----------+----+       +--------------------+
     |
     +--------------------+------------------+-------------------+
                          |                  |                   |
              +-----------v-----+  +---------v--------+  +-------v---------+
              | Payment Service |  | Screening Service|  | Reporting       |
              | - provider      |  | - provider       |  | Projection      |
              | - recon         |  | - risk result    |  | - worklist      |
              +-----------+-----+  +---------+--------+  +-----------------+
                          |                  |
              +-----------v-----+  +---------v--------+
              | Payment Gateway |  | External Screening|
              +-----------------+  +------------------+

+------------------+       +--------------------+       +------------------+
| Case Service     |<----->| Enforcement Service|<----->| Appeal Service   |
+------------------+       +--------------------+       +------------------+

+------------------+       +--------------------+       +------------------+
| Correspondence   |------>| Notification       |------>| Email/SMS        |
+------------------+       +--------------------+       +------------------+

+------------------+       +--------------------+
| Audit Projection |<------| Domain Audit Events|
+------------------+       +--------------------+
```

This diagram is not the architecture.

It is a communication artifact.

The real architecture is the set of ownership, contracts, invariants, failure modes, and operational commitments behind it.

---

## 31. Java 8–25 Capstone Guidance

### 31.1 Java 8

Suitable for legacy services, but limitations include:

```text
No records
No sealed classes
No pattern matching switch
No virtual threads
Older GC/container ergonomics
Older ecosystem support pressure
```

Use with caution for new microservices.

### 31.2 Java 11

Better baseline than Java 8.

```text
Modern HTTP client
Improved JVM/container behavior
Long-term support history
```

Still lacks many modern modeling/runtime improvements.

### 31.3 Java 17

Strong modern enterprise baseline.

```text
records
sealed classes
improved GC/runtime
mature Spring Boot 3 ecosystem baseline
```

Good default for stable enterprise services.

### 31.4 Java 21

Important for virtual threads.

Useful for:

```text
blocking IO-heavy services
simpler concurrency model
high-concurrency request handling
```

But virtual threads do not remove the need for:

```text
connection pool limits
rate limits
backpressure
timeouts
bulkheads
```

### 31.5 Java 25

Latest horizon for Java platform evolution.

Adopt based on:

```text
framework support
runtime support
container image support
security approval
performance testing
organizational standard
```

Do not adopt just because it is newer.

Do not stay on old Java just because migration is uncomfortable.

Use architecture economics.

---

## 32. Final Decision Framework

When deciding a microservices pattern, use this matrix.

| Question | If Yes | If No |
|---|---|---|
| Does it need independent lifecycle ownership? | Consider service boundary | Keep modular boundary |
| Does it own non-compensatable invariant with another module? | Avoid splitting too early | Split may be safe |
| Does user need immediate result? | Synchronous API may fit | Async/event may fit |
| Is side effect retryable/idempotent? | Retry possible | Avoid automatic retry |
| Is query cross-service and high-volume? | Projection/CQRS likely | API composition may suffice |
| Is workflow long-running? | Process manager/workflow | Simple event choreography may suffice |
| Is failure blast radius high? | Add bulkhead/circuit/isolation | Simpler resilience may suffice |
| Is data used for legal decision? | Store snapshot/version/audit | Stale projection may be acceptable |
| Is tenant/security risk high? | Stronger isolation | Shared model may be acceptable |
| Is service cost > benefit? | Merge/consolidate | Keep separate |

---

## 33. Top 1% Synthesis

A top 1% engineer understands that microservices are not primarily about:

```text
Spring Boot
Kafka
Docker
Kubernetes
REST
gRPC
service mesh
cloud
```

Those are implementation tools.

Microservices are about designing a distributed socio-technical system where:

```text
business capabilities have ownership,
data authority is explicit,
invariants are protected,
communication is intentional,
failure is expected,
latency is budgeted,
retries are bounded,
side effects are idempotent,
workflows are visible,
security is contextual,
tenancy is isolated,
contracts evolve safely,
observability is built in,
incidents are recoverable,
and complexity is economically justified.
```

The most senior architecture move is often not to add a pattern.

It is to remove a pattern that is not justified.

Examples:

```text
Do not add Kafka when synchronous workflow is simpler and safe.
Do not add saga when one local transaction is enough.
Do not split a service if invariants demand same boundary.
Do not add cache where correctness matters more than speed.
Do not add service mesh retries when application retries already exist.
Do not add workflow engine when a simple state machine is clearer.
Do not add microservices where modular monolith gives enough independence.
```

Microservices excellence is controlled complexity.

---

## 34. Final Exercises

### Exercise 1 — Boundary Review

Pick an existing enterprise module.

Answer:

```text
What data does it own?
What lifecycle does it own?
What invariants does it protect?
Which services depend on it?
Which services does it depend on?
Can it be deployed independently?
What would break if it is down?
```

### Exercise 2 — Event Review

Design one event.

Include:

```text
event name
event owner
event version
payload
tenant context
correlation/causation
ordering key
retention
PII classification
replay behavior
consumer expectations
```

### Exercise 3 — Failure Mode Review

For one critical user journey, list:

```text
all synchronous dependencies
all asynchronous dependencies
all databases
all caches
all external systems
all queues/topics
all timeout points
all retry points
all recovery actions
```

### Exercise 4 — Architecture Economics Review

For one candidate service split, calculate:

```text
benefits:
  - independent deployability
  - ownership clarity
  - scaling need
  - security isolation
  - domain clarity

costs:
  - infra cost
  - testing cost
  - observability cost
  - incident cost
  - coordination cost
  - cognitive load
```

Then decide:

```text
split now
keep modular monolith
extract later
merge back
```

---

## 35. References and Further Reading

Core microservices architecture:

- Martin Fowler and James Lewis — Microservices.
- Microservices.io — Microservice patterns including Saga, Transactional Outbox, Database per Service, API Composition, CQRS, and Event Sourcing.
- Sam Newman — Building Microservices, Monolith to Microservices.
- Chris Richardson — Microservices Patterns.

Reliability and operations:

- Google SRE Book — Addressing Cascading Failures, Handling Overload, Postmortem Culture, Emergency Response.
- AWS Well-Architected Reliability Pillar — failure management and fault isolation.

Architecture governance:

- Architecture Decision Records by Michael Nygard / Cognitect.
- Team Topologies — team interaction, cognitive load, platform teams.

Java/runtime:

- OpenJDK JDK 25 project and release notes.
- Java virtual threads documentation.
- Spring Boot, Spring Cloud, MicroProfile, Quarkus documentation.

---

## 36. Final Summary

This capstone connected all previous parts into one architecture review method.

The final mental model is:

```text
Microservices are not a goal.
They are a tool for managing domain, delivery, ownership, and runtime complexity.
```

Use them when they reduce the right kind of complexity.

Avoid them when they only convert local complexity into distributed complexity.

A top-tier engineer can design, critique, operate, and evolve microservices by reasoning from:

```text
boundary
invariant
data ownership
communication
failure
security
observability
release safety
cost
ownership
```

not from framework fashion.

---

# End of Series

This is the final part of the series:

```text
learn-java-microservices-patterns-advanced-engineering
```

Completed parts:

```text
00 Introduction and Mental Model
01 Distributed Systems Reality
02 Service Boundary Engineering
03 Domain Modeling for Microservices
04 Microservice Architecture Styles
05 Synchronous API Communication
06 Asynchronous Messaging
07 Event-Driven Architecture
08 Transaction, Saga, and Compensation
09 Outbox, Inbox, CDC, and Reliable Publishing
10 Consistency and Distributed Invariants
11 Data Ownership and Database per Service
12 Query Pattern, API Composition, CQRS, Materialized Views
13 API Gateway, Edge, BFF, Experience Layer
14 Service Discovery, Configuration, Runtime Topology
15 Resilience: Timeout, Retry, Circuit Breaker, Bulkhead
16 Backpressure, Flow Control, Capacity-Aware Design
17 Idempotency, Deduplication, Exactly-Once Business Effect
18 Workflow, Orchestration, Choreography, Process Managers
19 State Machine Pattern
20 Service-to-Service Security Patterns
21 Multi-Tenancy, Isolation, Regulatory Segmentation
22 Observability Patterns
23 Testing Strategy
24 Contract, Schema, Compatibility Engineering
25 Deployment and Release Safety
26 Runtime Platform: Kubernetes, Service Mesh, Java Runtime
27 Performance Engineering
28 Caching Patterns
29 Migration, Monolith Decomposition, Strangler Fig
30 Governance, Ownership, Socio-Technical Architecture
31 Incident, Failure Analysis, Reliability Operations
32 Cost, Complexity, Architecture Economics
33 Anti-Patterns and Failure Taxonomy
34 Capstone Architecture Review
```

The series is complete.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-33-antipatterns-failure-taxonomy.md">⬅️ 0. Posisi Part Ini Dalam Seri</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
