# learn-kafka-event-streaming-mastery-for-java-engineers-part-034.md

# Part 034 — Capstone: Build a Production-Grade Kafka-Based Enforcement Lifecycle Platform

> **Series:** Kafka, Kafka Connect, ksqlDB, Kafka Streams, and Event Streaming Mastery for Java Engineers  
> **Part:** 034 of 034  
> **Focus:** End-to-end production architecture using Kafka for a regulatory enforcement lifecycle platform  
> **Audience:** Java software engineers, tech leads, architects, platform engineers  
> **Goal:** Turn the mental models from Parts 000–033 into a defensible, operable, testable, and evolvable Kafka-based system design.

---

## 0. Why This Capstone Exists

The previous parts taught Kafka as a set of concepts:

- log
- topic
- partition
- offset
- producer
- consumer
- replication
- schema
- Connect
- CDC
- ksqlDB
- Kafka Streams
- security
- observability
- performance
- failure modelling
- governance
- architecture decision records

This capstone connects them into one realistic system:

> A production-grade **regulatory enforcement lifecycle platform** where cases move through intake, triage, investigation, escalation, evidence review, decision, appeal, remediation, closure, and audit reconstruction.

This is not a toy example.

A regulatory enforcement platform has the exact qualities that make Kafka valuable:

1. **Long-running lifecycle**
   - A case can live for days, months, or years.

2. **Many state transitions**
   - Intake, assigned, investigated, escalated, remediated, closed.

3. **Many independent consumers**
   - Audit, reporting, SLA monitor, notification, search index, risk scoring, case projection, data lake.

4. **Need for immutable history**
   - The platform must explain not only current state, but how current state was reached.

5. **Human-in-the-loop workflow**
   - Events come from users, systems, schedulers, integrations, and automated rules.

6. **Regulatory defensibility**
   - You need causality, traceability, correction history, and replay.

7. **Operational risk**
   - Duplicate events, late events, poison records, bad schema, lag, region outage, and replay mistakes can all cause business harm.

The goal of this part is to demonstrate how a top-tier engineer thinks from first principles.

---

## 1. Source Context and Technology Baseline

This capstone assumes modern Kafka ecosystem behavior:

- Apache Kafka is an event streaming platform for capturing, storing, processing, and routing event streams in real time and retrospectively.
- Kafka Connect provides source/sink integration and supports distributed mode for scalability and fault tolerance.
- Schema Registry provides central schema storage and compatibility validation.
- ksqlDB supports persistent, push, and pull queries, and runs Kafka Streams applications underneath.
- Kafka Streams is a Java library for building stream processing topologies with state, changelog topics, windowing, joins, and processing guarantees.
- Modern Kafka cluster architecture uses KRaft for metadata management rather than relying on ZooKeeper in new deployments.

This capstone is intentionally vendor-neutral in core Kafka concepts, while acknowledging common ecosystem components such as Schema Registry, Kafka Connect, Debezium-style CDC, ksqlDB, and Kafka Streams.

---

## 2. Problem Statement

We need to build a platform for regulatory enforcement cases.

### 2.1 Business Capabilities

The platform must support:

1. Case intake
2. Duplicate detection
3. Case triage
4. Assignment to officer/team
5. SLA monitoring
6. Investigation activities
7. Evidence ingestion
8. Request for information
9. Escalation
10. Decision proposal
11. Decision approval
12. Enforcement action
13. Remediation tracking
14. Appeal/review
15. Closure
16. Audit reconstruction
17. Reporting and analytics
18. Search and dashboard projection
19. Data export to lake/warehouse
20. Operational replay and recovery

### 2.2 Non-Functional Requirements

The system must provide:

1. **Traceability**
   - Every state transition has a reason, actor, time, correlation id, and causation id.

2. **Replayability**
   - Derived views can be rebuilt from event history.

3. **At-least-once safety**
   - Consumers must tolerate duplicates.

4. **Ordering by case**
   - Events for a single case should be processed in deterministic order where possible.

5. **Schema compatibility**
   - Producers and consumers owned by different teams must evolve safely.

6. **Operational isolation**
   - Analytics pipelines must not break the operational case lifecycle.

7. **Audit defensibility**
   - Historical facts must not be overwritten silently.

8. **Recovery**
   - Bad consumers, broken projections, or downstream outages must be recoverable.

9. **Security**
   - Case/evidence data must be access-controlled by topic, service, environment, and data sensitivity.

10. **Governance**
   - Topics, schemas, ACLs, retention, and ownership must be explicit.

---

## 3. Architecture Overview

At a high level:

```text
                          ┌─────────────────────┐
                          │  Case Management UI │
                          └──────────┬──────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │ Case Command API    │
                          │ Java/Spring Service │
                          └──────────┬──────────┘
                                     │ transaction
                                     ▼
                          ┌─────────────────────┐
                          │ Operational DB      │
                          │ cases, tasks,       │
                          │ outbox_events       │
                          └──────────┬──────────┘
                                     │ CDC
                                     ▼
                          ┌─────────────────────┐
                          │ Kafka Connect / CDC │
                          └──────────┬──────────┘
                                     │
                                     ▼
 ┌───────────────────────────────────────────────────────────────┐
 │                          Kafka Cluster                         │
 │                                                               │
 │  case.lifecycle.v1                                            │
 │  case.assignment.v1                                           │
 │  case.evidence.v1                                             │
 │  case.sla.v1                                                  │
 │  case.decision.v1                                             │
 │  case.audit.v1                                                │
 │  case.dlq.v1                                                  │
 │                                                               │
 └───────────────┬───────────────┬───────────────┬──────────────┘
                 │               │               │
                 ▼               ▼               ▼
       ┌────────────────┐ ┌──────────────┐ ┌──────────────────┐
       │ Kafka Streams  │ │ ksqlDB       │ │ Kafka Connect    │
       │ projections    │ │ monitoring   │ │ sinks            │
       └───────┬────────┘ └──────┬───────┘ └────────┬─────────┘
               │                 │                  │
               ▼                 ▼                  ▼
      ┌────────────────┐ ┌──────────────┐ ┌──────────────────┐
      │ Case Read DB   │ │ SLA Tables   │ │ Search/Lakehouse │
      │ Search Index   │ │ Alerts       │ │ Warehouse        │
      └────────────────┘ └──────────────┘ └──────────────────┘
```

### 3.1 Key Architectural Principle

Kafka is not the only source of truth for every concern.

A strong design separates:

| Concern | Suggested System of Record |
|---|---|
| Command validation | Command service |
| Transactional write | Operational database |
| Event publication | Transactional outbox + CDC |
| Event distribution | Kafka |
| Derived read models | Projection stores |
| Audit reconstruction | Event log + immutable audit storage |
| Analytics | Lakehouse/warehouse |
| Search | Search index |
| Real-time SLA monitoring | Kafka Streams / ksqlDB |

Kafka is the backbone for event distribution and replay, not a replacement for all storage.

---

## 4. Domain Model

### 4.1 Core Entities

```text
Case
Investigation
Assignment
Evidence
SLA
Decision
EnforcementAction
RemediationPlan
Appeal
AuditEntry
Notification
RiskScore
```

### 4.2 Case Lifecycle State Machine

A simplified lifecycle:

```text
DRAFT
  └── SUBMITTED
        ├── REJECTED_AT_INTAKE
        └── ACCEPTED
              └── TRIAGED
                    └── ASSIGNED
                          └── UNDER_INVESTIGATION
                                ├── REQUEST_INFO
                                ├── ESCALATED
                                ├── DECISION_PROPOSED
                                │      └── DECISION_APPROVED
                                │             └── ACTION_ISSUED
                                │                    └── REMEDIATION_MONITORING
                                │                           └── CLOSED
                                └── CLOSED_NO_ACTION
```

### 4.3 State Transition Invariants

For a regulatory platform, state changes must be defensible.

Examples:

1. A case cannot be assigned before being accepted.
2. Evidence cannot be attached to a case that does not exist.
3. A decision cannot be approved without a proposed decision.
4. Closure requires a closure reason.
5. Escalation requires an escalation reason and target authority.
6. SLA breach must reference the SLA policy version used at evaluation time.
7. Correction must not erase the original fact.
8. Appeal must reference a prior decision.
9. Reopened case must reference the closure event being challenged.
10. Actor identity must be captured for human actions.

---

## 5. Event Taxonomy

A strong Kafka architecture starts with event taxonomy, not with topic creation.

### 5.1 Event Categories

| Category | Meaning | Example |
|---|---|---|
| Lifecycle event | Case state changed | `CaseAccepted` |
| Assignment event | Ownership changed | `CaseAssigned` |
| Evidence event | Evidence changed | `EvidenceAttached` |
| SLA event | Time policy outcome | `CaseSlaBreached` |
| Decision event | Regulatory decision | `DecisionApproved` |
| Action event | Enforcement action | `EnforcementActionIssued` |
| Remediation event | Remediation progress | `RemediationCompleted` |
| Correction event | Prior event corrected | `CaseEventCorrected` |
| Audit event | Audit-oriented immutable fact | `AuditEntryRecorded` |
| Integration event | External system sync | `ExternalReferenceLinked` |

### 5.2 Commands vs Events

Commands are requests:

```text
SubmitCase
AssignCase
AttachEvidence
EscalateCase
ApproveDecision
CloseCase
```

Events are facts:

```text
CaseSubmitted
CaseAssigned
EvidenceAttached
CaseEscalated
DecisionApproved
CaseClosed
```

A command may fail.

An event should represent something that already happened.

### 5.3 Why This Matters

If your Kafka topic contains commands pretending to be events, consumers cannot reason safely.

Bad:

```json
{
  "type": "ApproveDecision",
  "caseId": "CASE-123"
}
```

This says someone wants approval to happen.

Better:

```json
{
  "eventType": "DecisionApproved",
  "caseId": "CASE-123",
  "decisionId": "DEC-456",
  "approvedBy": "user-789",
  "approvedAt": "2026-06-19T09:20:00Z"
}
```

This says approval already happened.

---

## 6. Event Envelope

Every event should have a standard envelope.

### 6.1 Envelope Fields

```json
{
  "eventId": "01JZ...ULID",
  "eventType": "CaseAssigned",
  "eventVersion": 1,
  "occurredAt": "2026-06-19T09:20:00Z",
  "publishedAt": "2026-06-19T09:20:02Z",
  "tenantId": "regulator-id",
  "caseId": "CASE-123",
  "aggregateType": "Case",
  "aggregateId": "CASE-123",
  "sequence": 42,
  "correlationId": "CORR-1000",
  "causationId": "EVT-999",
  "actor": {
    "actorType": "USER",
    "actorId": "officer-456",
    "role": "Investigator"
  },
  "source": {
    "service": "case-command-service",
    "environment": "prod",
    "region": "ap-southeast-1"
  },
  "schemaRef": {
    "subject": "case.lifecycle.v1-value",
    "version": 7
  },
  "payload": {}
}
```

### 6.2 Field Meaning

| Field | Purpose |
|---|---|
| `eventId` | Idempotency and audit identity |
| `eventType` | Semantic meaning |
| `eventVersion` | Event type evolution |
| `occurredAt` | Business/event time |
| `publishedAt` | Publication time |
| `tenantId` | Isolation and authorization |
| `caseId` | Business aggregate key |
| `aggregateId` | Ordering domain |
| `sequence` | Per-case monotonic version |
| `correlationId` | User/process/request chain |
| `causationId` | Which event/command caused this event |
| `actor` | Human/system origin |
| `source` | Producing service identity |
| `schemaRef` | Schema governance trace |
| `payload` | Event-specific data |

### 6.3 Event Identity vs Business Identity

Do not confuse:

```text
eventId      = unique fact identity
caseId       = business aggregate identity
decisionId   = domain entity identity
offset       = Kafka log position
```

Offset is not a business identifier.

Event ID is not a case ID.

Case ID is not a partition offset.

---

## 7. Topic Architecture

### 7.1 Recommended Topic Families

```text
case.lifecycle.v1
case.assignment.v1
case.evidence.v1
case.sla.v1
case.decision.v1
case.enforcement-action.v1
case.remediation.v1
case.appeal.v1
case.audit.v1
case.notification.v1
case.projection-changelog.v1
case.dead-letter.v1
case.quarantine.v1
case.replay.v1
```

### 7.2 Alternative: One Big Case Event Topic

```text
case.events.v1
```

Advantages:

- Simple ordering by `caseId`
- Easy replay of all case-related history
- Fewer topics

Disadvantages:

- ACL granularity is poor
- Retention/sensitivity differs by event type
- Consumer filtering burden increases
- Evidence payload metadata and lifecycle events may have different governance needs
- Topic becomes a dumping ground

### 7.3 Alternative: Many Domain-Specific Topics

Advantages:

- Better ownership
- Better access control
- Better retention tuning
- Better consumer clarity

Disadvantages:

- Cross-topic ordering is harder
- More governance overhead
- More topic lifecycle management
- Consumers needing full timeline must merge streams

### 7.4 Practical Recommendation

Use a hybrid model:

1. `case.lifecycle.v1` for core case state transitions
2. Separate topics for sensitive or high-volume subdomains:
   - `case.evidence.v1`
   - `case.audit.v1`
   - `case.notification.v1`
   - `case.sla.v1`
3. Derived topics for projections:
   - `case.current-state.v1`
   - `case.sla-status.v1`
   - `case.search-document.v1`

This avoids both extremes.

---

## 8. Partitioning Strategy

### 8.1 Primary Rule

For case lifecycle topics:

```text
partition key = caseId
```

Why?

Events for the same case should land on the same partition, preserving per-case ordering.

### 8.2 Ordering Domain

The ordering domain is:

```text
one case lifecycle
```

Not:

```text
all cases globally
all events globally
all cases for an officer
all cases for a tenant
```

Global ordering is expensive and usually unnecessary.

### 8.3 Partition Key by Topic

| Topic | Key | Reason |
|---|---|---|
| `case.lifecycle.v1` | `caseId` | Preserve case transition order |
| `case.assignment.v1` | `caseId` | Assignment belongs to case lifecycle |
| `case.evidence.v1` | `caseId` or `evidenceId` | Choose based on access pattern |
| `case.sla.v1` | `caseId` | SLA status by case |
| `case.decision.v1` | `caseId` | Decision sequence tied to case |
| `case.audit.v1` | `caseId` | Reconstruct audit timeline |
| `case.notification.v1` | `notificationId` or `recipientId` | Depends on delivery semantics |
| `case.current-state.v1` | `caseId` | Compacted latest state |

### 8.4 Partition Count Strategy

Start from workload shape:

```text
expected events/sec
average record size
peak multiplier
consumer processing cost
retention duration
replication factor
growth horizon
```

Then model:

```text
required parallelism = peak processing time / acceptable latency
```

Do not blindly use 100 partitions.

Too few partitions:

- Insufficient consumer parallelism
- Hot partition risk
- Harder to scale

Too many partitions:

- More file handles
- More metadata
- More leader elections
- More recovery cost
- More consumer assignment complexity
- More small batches

### 8.5 Hot Case Problem

Regulatory platforms may have “mega cases” with huge activity.

Symptoms:

- One partition has disproportionate throughput
- Consumer lag concentrated on one partition
- SLA projections delayed for that partition
- Other consumers idle

Mitigations:

1. Keep lifecycle events keyed by `caseId`.
2. Move high-volume substreams to separate topics:
   - evidence upload events
   - document processing events
   - notification delivery events
3. Use sub-aggregate keys where ordering boundary allows:
   - `evidenceId`
   - `documentId`
   - `taskId`
4. Avoid breaking ordering for true lifecycle transitions.

---

## 9. Schema Design

### 9.1 Use Schema Registry

Do not publish arbitrary JSON strings for core lifecycle events.

Use one of:

- Avro
- Protobuf
- JSON Schema

For governance-heavy platforms, Avro or Protobuf are usually stronger choices than ad hoc JSON because they force explicit schema evolution.

### 9.2 Compatibility Policy

Recommended default:

```text
BACKWARD compatibility
```

Meaning new consumers can read old data.

For highly shared public event topics:

```text
FULL_TRANSITIVE compatibility
```

This is stricter and more expensive, but safer for long-lived event history.

### 9.3 Example Schema: CaseAssigned

Conceptual Avro-like schema:

```json
{
  "type": "record",
  "name": "CaseAssigned",
  "namespace": "com.example.regulatory.caseevents.v1",
  "fields": [
    {"name": "eventId", "type": "string"},
    {"name": "caseId", "type": "string"},
    {"name": "assignmentId", "type": "string"},
    {"name": "assignedToUserId", "type": "string"},
    {"name": "assignedTeamId", "type": ["null", "string"], "default": null},
    {"name": "assignedBy", "type": "string"},
    {"name": "assignmentReason", "type": "string"},
    {"name": "occurredAt", "type": "string"},
    {"name": "correlationId", "type": "string"},
    {"name": "causationId", "type": ["null", "string"], "default": null},
    {"name": "caseSequence", "type": "long"}
  ]
}
```

### 9.4 Schema Evolution Rules

Safe:

- Add optional field with default
- Add nullable field with default
- Widen certain compatible logical meanings carefully
- Add new event type in a union, if consumers tolerate it

Dangerous:

- Remove required field
- Rename field without alias/migration
- Change semantic meaning while keeping same field
- Change key schema without migration
- Reuse enum value for different meaning
- Publish different event shapes under one uncontrolled subject

### 9.5 Event Version vs Schema Version

These are not always the same.

```text
eventVersion = semantic version of event type
schemaVersion = registry version of encoded schema
```

If you add a nullable metadata field, schema version changes, but event semantic version may not.

If you change business meaning, event version should change.

---

## 10. Producer Design

### 10.1 Preferred Publication Pattern

Use transactional outbox.

Command service writes:

1. Domain state change
2. Outbox event row

in the same database transaction.

Then CDC publishes outbox rows to Kafka.

```text
Command API
  └── DB transaction
        ├── update case table
        └── insert outbox event
              ↓
          CDC connector
              ↓
          Kafka topic
```

### 10.2 Why Not Direct Kafka Send from Command Handler?

Direct dual-write:

```text
update database
send Kafka event
```

Failure windows:

1. DB success, Kafka fail
2. Kafka success, DB fail
3. DB commit unknown, Kafka retry
4. App crashes between DB commit and Kafka send
5. Kafka send succeeds but callback lost

Transactional outbox removes the cross-system dual-write problem.

### 10.3 Outbox Table Example

```sql
CREATE TABLE outbox_events (
    id                  VARCHAR(64) PRIMARY KEY,
    aggregate_type      VARCHAR(100) NOT NULL,
    aggregate_id        VARCHAR(100) NOT NULL,
    aggregate_sequence  BIGINT NOT NULL,
    event_type          VARCHAR(200) NOT NULL,
    event_version       INT NOT NULL,
    topic_name          VARCHAR(200) NOT NULL,
    partition_key       VARCHAR(200) NOT NULL,
    payload             JSONB NOT NULL,
    headers             JSONB NOT NULL,
    occurred_at         TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    published_at        TIMESTAMP WITH TIME ZONE NULL
);
```

### 10.4 Per-Case Sequence

Maintain a per-case sequence:

```text
caseSequence = 1, 2, 3, 4, ...
```

This gives downstream consumers a business ordering invariant independent of Kafka offset.

Benefits:

- Detect gaps
- Detect duplicates
- Detect out-of-order application-level processing
- Support audit reconstruction
- Support projection correctness

### 10.5 Producer Config for Direct Producers

Some services may still produce directly, especially derived-event producers.

Typical baseline:

```properties
acks=all
enable.idempotence=true
compression.type=zstd
linger.ms=5
batch.size=32768
delivery.timeout.ms=120000
request.timeout.ms=30000
max.in.flight.requests.per.connection=5
```

But config must be tested under real workload.

Do not copy blindly.

---

## 11. Consumer Design

### 11.1 Consumer Types

| Consumer | Purpose |
|---|---|
| Case projection consumer | Build read model |
| Audit timeline consumer | Build audit store |
| SLA monitor | Evaluate deadlines |
| Notification consumer | Send email/task alerts |
| Search indexer | Update search document |
| Data lake sink | Export events |
| Risk scoring consumer | Trigger risk model |
| External integration consumer | Notify external agencies |
| DLQ inspector | Classify bad records |

### 11.2 Idempotency Rule

Every consumer must be safe under duplicate delivery.

At-least-once is the default operational assumption.

### 11.3 Idempotency Table Example

```sql
CREATE TABLE processed_events (
    consumer_name   VARCHAR(200) NOT NULL,
    event_id        VARCHAR(100) NOT NULL,
    processed_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer_name, event_id)
);
```

Consumer flow:

```text
poll event
start transaction
  check processed_events
  if exists: skip side effect
  apply side effect
  insert processed_events
commit transaction
commit Kafka offset
```

If the app crashes after DB commit but before offset commit, event is re-read but skipped safely.

### 11.4 Consumer Processing Skeleton

```java
while (running) {
    ConsumerRecords<String, CaseEvent> records = consumer.poll(Duration.ofMillis(500));

    for (ConsumerRecord<String, CaseEvent> record : records) {
        try {
            processIdempotently(record.key(), record.value(), record.headers());
        } catch (RecoverableException e) {
            retryLater(record, e);
            consumer.pause(Set.of(new TopicPartition(record.topic(), record.partition())));
        } catch (NonRecoverableException e) {
            publishToDlq(record, e);
        }
    }

    consumer.commitSync();
}
```

This is simplified. Real systems also need:

- per-partition offset tracking
- graceful shutdown
- backpressure
- DLQ headers
- retry budget
- observability
- rebalance listener
- poison event handling
- batch transaction boundaries

---

## 12. Kafka Streams Design

Kafka Streams is useful when the platform needs continuously maintained derived state.

### 12.1 Candidate Streams Applications

1. Case current-state projection
2. SLA status projection
3. Escalation detection
4. Officer workload aggregation
5. Duplicate case candidate detection
6. Risk score enrichment
7. Timeline materialization
8. Derived audit events

### 12.2 Case Current State Topology

Input:

```text
case.lifecycle.v1
case.assignment.v1
case.decision.v1
case.remediation.v1
```

Output:

```text
case.current-state.v1
```

State store:

```text
case-current-state-store
```

Conceptual topology:

```text
case.lifecycle.v1 ─┐
case.assignment.v1 ├── merge by caseId ── aggregate latest state ── case.current-state.v1
case.decision.v1  ─┘
```

### 12.3 Invariant

Projection must be rebuildable.

If the read model is corrupted:

```text
delete projection store
reset application offsets
replay from Kafka
rebuild state
```

This is only safe if:

- source topics retain sufficient history
- events are deterministic
- external calls are not embedded in replay
- event schema remains readable
- projection code handles old event versions

### 12.4 SLA Monitoring Topology

Input:

```text
case.lifecycle.v1
case.assignment.v1
case.sla-policy.v1
clock.tick.v1
```

Output:

```text
case.sla-status.v1
case.sla-breached.v1
```

Important: SLA evaluation must capture policy version.

Bad:

```text
CaseSlaBreached(caseId, breachedAt)
```

Better:

```text
CaseSlaBreached(
  caseId,
  slaPolicyId,
  slaPolicyVersion,
  dueAt,
  breachedAt,
  basisEventId
)
```

This makes future audit possible.

---

## 13. ksqlDB Design

ksqlDB is useful for:

- operational stream-derived tables
- simple monitoring views
- near-real-time analytical projections
- SQL-accessible stream transformations
- rapid prototyping

### 13.1 Example: Current SLA Breaches

```sql
CREATE STREAM case_sla_events (
  caseId STRING KEY,
  eventType STRING,
  slaPolicyId STRING,
  dueAt STRING,
  breachedAt STRING
) WITH (
  KAFKA_TOPIC='case.sla.v1',
  VALUE_FORMAT='AVRO'
);

CREATE TABLE open_sla_breaches AS
SELECT
  caseId,
  LATEST_BY_OFFSET(slaPolicyId) AS slaPolicyId,
  LATEST_BY_OFFSET(dueAt) AS dueAt,
  LATEST_BY_OFFSET(breachedAt) AS breachedAt
FROM case_sla_events
WHERE eventType = 'CaseSlaBreached'
GROUP BY caseId;
```

### 13.2 Caution

ksqlDB is not a substitute for all business logic.

Use ksqlDB when:

- transformation is stream-native
- logic is explainable in SQL
- state size and query model fit
- operational ownership is clear

Prefer Java/Kafka Streams when:

- complex domain logic
- custom state store behavior
- sophisticated testing requirements
- complex error handling
- strong type-safe codebase governance

---

## 14. Kafka Connect Design

### 14.1 Source Connectors

Possible source connectors:

| Source | Purpose |
|---|---|
| CDC from operational DB | Publish outbox events |
| Reference data DB | Publish policy/rules/reference streams |
| External registry | Bring external entity updates |
| File/object source | Ingest batch evidence metadata |

### 14.2 Sink Connectors

Possible sink connectors:

| Sink | Purpose |
|---|---|
| S3/object storage | Immutable event archive |
| Elasticsearch/OpenSearch | Case search |
| Warehouse | Analytics/reporting |
| JDBC sink | Read model or integration DB |
| Notification platform | Delivery handoff |

### 14.3 Connect Internal Topics

Distributed Connect depends on internal topics:

```text
connect-configs
connect-offsets
connect-status
```

Treat these as production state.

They need:

- replication factor
- backup/recovery consideration
- ACL protection
- monitoring
- retention/compaction correctness

### 14.4 DLQ Strategy for Connect

DLQ event should include:

- original topic
- original partition
- original offset
- connector name
- task id
- exception class
- exception message
- original headers
- schema id
- timestamp
- classification if known

Never make DLQ a black hole.

---

## 15. Data Stores

### 15.1 Operational DB

Stores command-side state:

```text
cases
assignments
evidence_metadata
decisions
tasks
sla_instances
outbox_events
```

### 15.2 Read Model DB

Stores query-optimized projection:

```text
case_summary
case_current_state
case_timeline
case_work_queue
officer_dashboard
sla_dashboard
```

### 15.3 Search Index

Stores denormalized search documents:

```json
{
  "caseId": "CASE-123",
  "status": "UNDER_INVESTIGATION",
  "assignedTo": "officer-456",
  "riskLevel": "HIGH",
  "subjectNames": ["..."],
  "tags": ["AML", "late-response"],
  "lastUpdatedAt": "2026-06-19T10:20:00Z"
}
```

### 15.4 Object Storage

Stores:

- raw event archive
- evidence binaries
- exported topic snapshots
- DLQ samples
- replay manifests
- audit export bundles

Kafka should not store large evidence binaries directly.

Store binary content in object storage and publish metadata/reference events.

---

## 16. Security Model

### 16.1 Principal Categories

```text
case-command-service
case-projection-service
sla-monitor-service
search-indexer-service
notification-service
audit-export-service
data-lake-sink-connector
cdc-source-connector
ksqldb-server
streams-app-case-state
platform-admin
```

### 16.2 ACL Design

Example:

| Principal | Produce | Consume |
|---|---|---|
| `case-command-service` | none/direct or outbox only | none |
| `cdc-source-connector` | `case.*.v1` | DB CDC source only |
| `case-projection-service` | `case.current-state.v1` | `case.lifecycle.v1`, `case.assignment.v1` |
| `sla-monitor-service` | `case.sla.v1` | `case.lifecycle.v1`, `case.assignment.v1` |
| `search-indexer-service` | none | curated topics only |
| `data-lake-sink-connector` | none | allowed archive topics |
| `audit-service` | `case.audit.v1` | all required audit topics |

### 16.3 Sensitive Topic Segregation

Evidence and personal data should not be casually mixed into broad topics.

Use:

```text
case.evidence-metadata.v1
case.evidence-access.v1
case.pii-restricted.v1
```

Access to sensitive topics should be exceptional and audited.

---

## 17. Retention and Compaction

### 17.1 Topic Retention Matrix

| Topic | Cleanup | Retention | Rationale |
|---|---|---|---|
| `case.lifecycle.v1` | delete | years or compliance period | audit/replay |
| `case.audit.v1` | delete/archive | compliance period | legal audit |
| `case.current-state.v1` | compact | indefinite/latest | latest state |
| `case.sla-status.v1` | compact | latest | status projection |
| `case.notification.v1` | delete | shorter | operational delivery |
| `case.dead-letter.v1` | delete | investigation window | remediation |
| `case.quarantine.v1` | delete | longer than DLQ | manual analysis |
| `case.replay.v1` | delete | temporary | replay operations |

### 17.2 Archive Requirement

For long regulatory periods, Kafka retention alone may not be enough.

Use object storage sink for immutable event archive.

Pattern:

```text
Kafka topic
  └── S3/object storage sink
        └── partition by event date/topic/tenant
```

### 17.3 Compacted State Topics

For current state:

```text
case.current-state.v1
```

Use compaction with key:

```text
caseId
```

Tombstone means:

```text
delete latest state for this case from compacted topic
```

Do not use tombstone casually for legal deletion without understanding audit and retention obligations.

---

## 18. Observability Design

### 18.1 Broker/Cluster Metrics

Monitor:

- under-replicated partitions
- offline partitions
- active controller count
- request latency
- produce/fetch request rate
- network processor idle
- request handler idle
- disk usage
- log flush time
- ISR shrink/expand
- controller event queue
- metadata propagation issues

### 18.2 Producer Metrics

Monitor:

- record send rate
- record error rate
- request latency
- retry rate
- batch size
- compression rate
- buffer exhausted count
- metadata age

### 18.3 Consumer Metrics

Monitor:

- consumer lag by partition
- lag by time, not just offset
- processing latency
- poll interval
- commit latency
- rebalance rate
- records consumed rate
- records processed rate
- DLQ rate
- retry rate

### 18.4 Business Metrics

Kafka metrics are not enough.

Also monitor:

- cases submitted per hour
- cases accepted/rejected
- open cases by status
- SLA breaches by policy
- escalation rate
- average time in state
- stuck cases
- duplicate case candidates
- decision approval time
- evidence processing delay

### 18.5 Alert Examples

Good alert:

```text
case-projection-service consumer lag time > 10 minutes for 15 minutes
AND records consumed rate < expected minimum
AND topic case.lifecycle.v1 has new records
```

Bad alert:

```text
consumer lag > 1000
```

Offset lag alone lacks context.

---

## 19. Failure Modelling

### 19.1 Failure Scenario: Command Succeeds, Event Missing

With transactional outbox:

- Case row and outbox row commit together.
- CDC connector eventually publishes event.
- If connector is down, outbox remains.
- Recovery: restart connector and resume from CDC offset.

Invariant:

```text
No committed case state change without an outbox event row.
```

### 19.2 Failure Scenario: Duplicate Event Published

Consumers must deduplicate by:

```text
eventId
```

or by:

```text
consumerName + eventId
```

Invariant:

```text
A duplicate event must not duplicate irreversible side effects.
```

### 19.3 Failure Scenario: Consumer Crashes After DB Write Before Offset Commit

Recovery:

- Event is re-delivered.
- Idempotency table detects already processed event.
- Offset is committed after skip.

Invariant:

```text
Side effect and processed-event marker commit atomically.
```

### 19.4 Failure Scenario: Bad Schema Released

Controls:

- compatibility check in CI
- Schema Registry compatibility mode
- canary consumer
- rollback producer
- quarantine bad records
- avoid deleting old consumer logic immediately

Invariant:

```text
A producer cannot publish incompatible schema to shared production topic.
```

### 19.5 Failure Scenario: Projection Corrupted

Recovery:

1. Stop projection app.
2. Snapshot corrupted state for forensics.
3. Reset consumer group offsets.
4. Clear projection DB/state store.
5. Replay from source topics.
6. Compare derived counts/checksums.
7. Resume service.

Invariant:

```text
Projection can be rebuilt from retained source events.
```

### 19.6 Failure Scenario: Hot Partition

Symptoms:

- one partition lagging
- one consumer thread overloaded
- high processing time for one key
- uneven bytes per partition

Mitigation:

- split high-volume subdomain topic
- isolate evidence/document processing
- do not break lifecycle ordering casually
- introduce sub-aggregate partition keys where semantics allow

Invariant:

```text
Ordering boundary must be explicit before repartitioning.
```

### 19.7 Failure Scenario: Replay Triggers External Side Effects

Never replay directly into side-effecting consumers without replay mode.

Risk:

- duplicate emails
- duplicate enforcement notices
- duplicate external API calls
- duplicate warehouse rows

Mitigation:

- replay topics
- replay headers
- side-effect suppression
- idempotency keys
- dry-run replay
- approval gate

Invariant:

```text
Replay must not accidentally re-execute irreversible external actions.
```

---

## 20. Replay Strategy

### 20.1 Replay Types

| Replay Type | Purpose |
|---|---|
| Projection rebuild | Recreate read model |
| Audit reconstruction | Recreate timeline |
| Backfill derived topic | New transformation |
| Incident recovery | Repair corrupted data |
| Analytics replay | Reload warehouse/lake |
| Legal inquiry replay | Reproduce case history |

### 20.2 Replay Design

Use replay metadata:

```json
{
  "replayId": "REPLAY-2026-06-19-001",
  "reason": "rebuild-search-index",
  "requestedBy": "platform-admin",
  "approvedBy": "compliance-owner",
  "sourceTopic": "case.lifecycle.v1",
  "fromOffset": 0,
  "toOffset": 123456789,
  "startedAt": "2026-06-19T10:00:00Z"
}
```

### 20.3 Replay Safety Checklist

Before replay:

- Identify source topics
- Identify offset/time range
- Identify target consumers
- Disable side-effect consumers if needed
- Confirm schema compatibility
- Confirm retention coverage
- Estimate throughput impact
- Reserve capacity
- Define rollback plan
- Define validation checks
- Record approval

After replay:

- Validate counts
- Validate checksums
- Validate sample timelines
- Validate business dashboards
- Validate no unintended side effects
- Archive replay manifest

---

## 21. DLQ and Quarantine Design

### 21.1 DLQ Categories

| Category | Example | Action |
|---|---|---|
| Deserialization error | bad payload | fix producer/schema |
| Validation error | missing required semantic field | quarantine |
| Referential error | case not found | retry or investigate |
| Transient downstream error | DB unavailable | retry |
| Permanent downstream error | invalid state transition | quarantine |
| Security error | unauthorized tenant | security incident |
| Poison event | always crashes consumer | isolate and patch |

### 21.2 DLQ Record Format

```json
{
  "dlqEventId": "DLQ-001",
  "originalTopic": "case.lifecycle.v1",
  "originalPartition": 3,
  "originalOffset": 998877,
  "originalKey": "CASE-123",
  "originalEventId": "EVT-456",
  "consumerGroup": "case-projection-service",
  "errorClass": "InvalidTransitionException",
  "errorMessage": "Cannot close case from SUBMITTED",
  "stackTraceHash": "abc123",
  "failedAt": "2026-06-19T11:00:00Z",
  "classification": "DOMAIN_VALIDATION",
  "payloadRef": "s3://restricted-dlq/..."
}
```

### 21.3 DLQ Operating Rule

DLQ is not success.

A DLQ means:

```text
business flow has been interrupted
```

There must be ownership, SLA, dashboard, and remediation.

---

## 22. Testing Strategy

### 22.1 Unit Tests

Test:

- event builders
- schema mapping
- idempotency logic
- state transition rules
- partition key derivation
- envelope creation
- correlation/causation propagation

### 22.2 Contract Tests

Test:

- schema compatibility
- required fields
- event semantic examples
- old consumer with new event
- new consumer with old event
- tombstone handling
- enum evolution

### 22.3 Integration Tests

Use Testcontainers or equivalent to run:

- Kafka broker
- Schema Registry
- Connect when needed
- real producer/consumer
- projection database

### 22.4 Kafka Streams Tests

Use topology tests for deterministic logic:

- input event sequence
- output event sequence
- state store content
- window behavior
- late event behavior
- duplicate event behavior

### 22.5 Failure Tests

Simulate:

- consumer crash before commit
- consumer crash after side effect
- rebalance during processing
- broker restart
- schema incompatibility
- poison event
- DLQ overflow
- downstream DB unavailable
- high lag
- replay

### 22.6 Production Readiness Tests

Before go-live:

- load test
- soak test
- partition skew test
- failover test
- DR test
- replay test
- schema rollback test
- consumer group rolling deploy test
- connector restart test
- ACL denial test

---

## 23. Deployment Model

### 23.1 Recommended Environments

```text
local/dev
shared integration
performance
staging
production
dr/secondary
```

### 23.2 Environment Isolation

Avoid sharing production Kafka with lower environments.

Topic naming:

```text
prod.case.lifecycle.v1
stg.case.lifecycle.v1
```

or cluster-level environment separation.

Cluster-level separation is usually cleaner.

### 23.3 Deployment Units

```text
case-command-service
cdc-connect-cluster
case-projection-streams-app
sla-monitor-streams-app
ksqldb-cluster
search-sink-connector
data-lake-sink-connector
audit-service
notification-service
schema-registry
monitoring-stack
```

### 23.4 Rolling Deployment Risks

Rolling deploy can trigger:

- consumer group rebalance
- state restore
- temporary lag
- duplicate processing
- partition ownership movement
- Connect task rebalance

Mitigation:

- cooperative rebalancing
- static membership where appropriate
- graceful shutdown
- drain mode
- standby replicas for Kafka Streams
- deployment window metrics

---

## 24. Multi-Region and DR

### 24.1 DR Objective

Define:

```text
RPO = how much data can be lost
RTO = how fast service must recover
```

If RPO is near zero and RTO is low, architecture cost and complexity rise sharply.

### 24.2 Active-Passive

Primary region handles writes.

Secondary region receives replicated topics.

Pros:

- simpler conflict model
- easier audit reasoning
- clearer ownership

Cons:

- failover complexity
- replication lag
- offset translation
- cold/warm standby cost

### 24.3 Active-Active

Multiple regions accept writes.

Pros:

- regional availability
- lower local latency

Cons:

- conflict resolution
- global ordering impossible
- duplicate events
- case ownership split risk
- harder audit story

### 24.4 Recommendation for Enforcement Lifecycle

Use active-passive or region-owned active-active.

For strict regulatory case lifecycle, prefer:

```text
one writable home region per case
```

If active-active is required, route by:

```text
case jurisdiction / tenant / home region
```

Do not allow the same case aggregate to be concurrently written in multiple regions unless conflict rules are formally defined.

---

## 25. Governance Model

### 25.1 Topic Request Template

```yaml
topic: case.lifecycle.v1
ownerTeam: case-platform
businessOwner: enforcement-operations
dataClassification: confidential
producers:
  - cdc-source-connector
consumers:
  - case-projection-service
  - audit-service
  - sla-monitor-service
keySchema: CaseKeyV1
valueSchema: CaseLifecycleEventV1
partitionKey: caseId
orderingGuarantee: per-case
retention: 7 years
cleanupPolicy: delete
replicationFactor: 3
minInsyncReplicas: 2
compatibility: FULL_TRANSITIVE
pii: true
replayAllowed: true
dlqTopic: case.dead-letter.v1
```

### 25.2 Schema Review Checklist

- Is event name a fact?
- Is payload semantically stable?
- Are required fields truly required?
- Are defaults defined?
- Is compatibility mode sufficient?
- Are correlation and causation present?
- Is actor captured?
- Is event time captured?
- Is tenant captured?
- Is sensitive data minimized?
- Can old consumers ignore new fields?
- Can new consumers read old events?

### 25.3 Consumer Registration

Every consumer should declare:

```yaml
consumerGroup: case-projection-service
ownerTeam: case-platform
topics:
  - case.lifecycle.v1
  - case.assignment.v1
sideEffects:
  - writes case_read_db
idempotency: processed_events table
replaySafe: true
dlq: case.dead-letter.v1
lagSlo: "p95 event-to-projection latency < 60s"
onCall: case-platform-oncall
```

---

## 26. Architecture Decision Records

### 26.1 ADR: Use Transactional Outbox

```markdown
# ADR-001: Publish case lifecycle events through transactional outbox

## Status
Accepted

## Context
Case state changes must be atomically reflected as events. Direct DB write + Kafka send creates dual-write failure windows.

## Decision
The command service writes domain changes and outbox events in the same database transaction. A CDC connector publishes outbox events to Kafka.

## Consequences
Positive:
- No committed state transition without event row
- Event publication can recover after connector outage
- Clear audit trail

Negative:
- CDC infrastructure required
- Slight publication delay
- Outbox schema and cleanup must be operated

## Failure Modes
- CDC connector lag
- outbox table growth
- malformed outbox payload
- duplicate event after connector retry

## Invariants
- Every committed lifecycle transition must create exactly one outbox event row.
- Consumers must tolerate duplicate event publication.
```

### 26.2 ADR: Partition Case Lifecycle by Case ID

```markdown
# ADR-002: Partition case lifecycle topic by caseId

## Status
Accepted

## Context
Downstream projections require deterministic per-case ordering.

## Decision
All records in case.lifecycle.v1 use caseId as Kafka record key.

## Consequences
Positive:
- Preserves order for events of one case
- Simplifies projection logic
- Supports per-case state machine reconstruction

Negative:
- Hot case can create hot partition
- Increasing partition count later can affect key-to-partition mapping for future records

## Failure Modes
- badly chosen key
- null key
- inconsistent key format
- hot partition

## Invariants
- Null keys are rejected for lifecycle events.
- Event payload caseId must equal record key.
```

### 26.3 ADR: Use Compact Topic for Current State

```markdown
# ADR-003: Publish case.current-state.v1 as compacted topic

## Status
Accepted

## Context
Many consumers need latest case state without replaying full lifecycle.

## Decision
A Kafka Streams projection writes latest case state into case.current-state.v1 keyed by caseId with cleanup.policy=compact.

## Consequences
Positive:
- Efficient latest-state distribution
- New consumers can bootstrap current state
- Supports cache warmup

Negative:
- Not a complete audit history
- Compaction is eventual
- Tombstone semantics must be controlled

## Invariants
- Source lifecycle topic remains the audit source.
- Current-state topic is derived and rebuildable.
```

---

## 27. End-to-End Flow Example

### 27.1 Assign Case

User action:

```text
Officer manager assigns CASE-123 to investigator INV-9.
```

Command:

```json
{
  "commandId": "CMD-001",
  "commandType": "AssignCase",
  "caseId": "CASE-123",
  "assignedTo": "INV-9",
  "reason": "Specialist expertise required"
}
```

Command service:

1. Validates case exists.
2. Validates case is assignable.
3. Writes assignment row.
4. Updates case status if needed.
5. Inserts outbox event.

Outbox event:

```json
{
  "eventId": "EVT-001",
  "eventType": "CaseAssigned",
  "caseId": "CASE-123",
  "caseSequence": 17,
  "assignedTo": "INV-9",
  "assignmentReason": "Specialist expertise required",
  "occurredAt": "2026-06-19T12:00:00Z",
  "correlationId": "CORR-001",
  "causationId": "CMD-001"
}
```

CDC publishes:

```text
topic: case.assignment.v1
key: CASE-123
value: CaseAssigned
```

Consumers:

- projection updates case read model
- notification sends task assignment
- audit appends timeline entry
- SLA app recalculates due date
- search indexer updates assignee field
- data lake sink archives event

### 27.2 Failure During Notification

If notification service crashes after sending email but before committing offset:

- event is re-read
- notification service checks idempotency key:
  ```text
  notificationType + caseId + eventId
  ```
- duplicate email is not sent
- offset commits

---

## 28. Production Readiness Checklist

### 28.1 Event Design

- [ ] Event names are facts, not commands.
- [ ] Envelope includes event ID, correlation ID, causation ID, actor, tenant, source, event time.
- [ ] Partition key is explicit.
- [ ] Payload avoids unnecessary sensitive data.
- [ ] Event examples exist.
- [ ] Versioning strategy exists.
- [ ] Correction strategy exists.

### 28.2 Topic Design

- [ ] Topic owner defined.
- [ ] Producer list defined.
- [ ] Consumer list defined.
- [ ] Retention defined.
- [ ] Cleanup policy defined.
- [ ] Partition count justified.
- [ ] Replication factor defined.
- [ ] `min.insync.replicas` defined.
- [ ] ACLs defined.
- [ ] Quotas defined.
- [ ] DLQ topic defined.

### 28.3 Schema Governance

- [ ] Schema Registry subject defined.
- [ ] Compatibility mode defined.
- [ ] CI compatibility check enabled.
- [ ] Schema examples exist.
- [ ] Breaking change process exists.
- [ ] Deprecation policy exists.

### 28.4 Producer

- [ ] Idempotence enabled where direct producer is used.
- [ ] `acks=all` for critical events.
- [ ] Retry and timeout behavior understood.
- [ ] Outbox used for domain state changes.
- [ ] Event ID generated deterministically or safely uniquely.
- [ ] Record key validated.
- [ ] Producer metrics monitored.

### 28.5 Consumer

- [ ] Manual commit strategy explicit.
- [ ] Idempotency implemented.
- [ ] DLQ implemented.
- [ ] Retry policy implemented.
- [ ] Poison pill handling implemented.
- [ ] Graceful shutdown implemented.
- [ ] Rebalance behavior tested.
- [ ] Lag alerting configured.

### 28.6 Kafka Streams / ksqlDB

- [ ] Source topics retained long enough for rebuild.
- [ ] State store sizing estimated.
- [ ] Changelog topics monitored.
- [ ] Repartition topics understood.
- [ ] Processing guarantee selected.
- [ ] Replay/reset procedure documented.
- [ ] Interactive query routing, if used, documented.

### 28.7 Kafka Connect

- [ ] Distributed mode used for production.
- [ ] Internal topics configured correctly.
- [ ] Connector offsets understood.
- [ ] DLQ configured.
- [ ] Connector restart tested.
- [ ] Backpressure behavior tested.
- [ ] Sink idempotency understood.

### 28.8 Security

- [ ] TLS enabled.
- [ ] Authentication enabled.
- [ ] ACL least privilege enforced.
- [ ] Sensitive topics isolated.
- [ ] Secrets not stored in plaintext config.
- [ ] Audit access logged.
- [ ] Service principals documented.

### 28.9 Observability

- [ ] Broker metrics dashboard.
- [ ] Producer metrics dashboard.
- [ ] Consumer metrics dashboard.
- [ ] Connect dashboard.
- [ ] Streams dashboard.
- [ ] Business metrics dashboard.
- [ ] Lag by time available.
- [ ] DLQ dashboard.
- [ ] Runbooks linked from alerts.

### 28.10 Recovery

- [ ] Replay procedure tested.
- [ ] Projection rebuild tested.
- [ ] DLQ replay tested.
- [ ] Schema rollback tested.
- [ ] Consumer offset reset tested.
- [ ] DR failover tested.
- [ ] Data archive restore tested.

---

## 29. Common Anti-Patterns

### 29.1 Kafka as RPC Bus

Bad:

```text
Service A sends command to Kafka and waits for Service B response as if Kafka is HTTP.
```

Kafka can support request/reply patterns, but using it as synchronous RPC usually damages both Kafka and service design.

### 29.2 One Topic for Everything

Bad:

```text
events
```

Problems:

- no ownership
- weak ACL
- unclear retention
- schema chaos
- consumer filtering everywhere

### 29.3 No Schema Governance

Bad:

```text
String payload = objectMapper.writeValueAsString(anything)
```

This works until multiple teams depend on the topic.

### 29.4 Offset as Business State

Bad:

```text
Last processed case event = Kafka offset 12345
```

Offsets are log positions, not domain facts.

Use event ID, case sequence, and audit timeline.

### 29.5 Replay Without Side-Effect Control

Bad:

```text
Reset offsets for notification consumer and replay production topic.
```

This can resend notices, emails, and external calls.

### 29.6 Compacted Topic as Audit Log

Bad:

```text
case.current-state.v1 is compacted; therefore we have case history.
```

Compaction removes older values eventually.

Use append-only lifecycle/audit topics for history.

### 29.7 DLQ Without Ownership

Bad:

```text
Messages go to DLQ and nobody watches it.
```

DLQ is a production workflow requiring triage, remediation, and closure.

---

## 30. Mental Model Summary

A production-grade Kafka enforcement lifecycle platform is built on these invariants:

1. Kafka stores and distributes facts.
2. Domain state changes publish events through outbox or equivalent atomic pattern.
3. Events are immutable; corrections are new events.
4. Topic is a contract, not a random pipe.
5. Partition key defines ordering domain.
6. Offset is a log position, not business identity.
7. Consumers are at-least-once by default.
8. Idempotency is application responsibility.
9. Schemas are public contracts.
10. Derived state is rebuildable.
11. DLQ is not success.
12. Replay is a controlled operation.
13. Security is topic/principal/data-classification aware.
14. Observability must include technical and business lag.
15. Architecture decisions must include failure modes.

---

## 31. Final Capstone Exercise

Design your own version of this system.

### 31.1 Exercise Inputs

Assume:

```text
100,000 active cases
5 million lifecycle events/year
20 million evidence metadata events/year
10,000 users
30 regulatory teams
7-year audit retention
RPO <= 5 minutes
RTO <= 1 hour
p95 projection latency <= 60 seconds
```

### 31.2 Tasks

1. Define event taxonomy.
2. Define topic list.
3. Define partition keys.
4. Define retention policies.
5. Define schema compatibility modes.
6. Define outbox table.
7. Define producer strategy.
8. Define consumer idempotency.
9. Define DLQ design.
10. Define current-state projection.
11. Define SLA monitoring topology.
12. Define Connect source/sink plan.
13. Define security ACL model.
14. Define observability dashboard.
15. Define replay procedure.
16. Define DR strategy.
17. Write three ADRs.
18. Identify ten failure modes.
19. Define production readiness checklist.
20. Defend which parts use Kafka Streams, ksqlDB, Connect, or custom Java services.

### 31.3 Evaluation Criteria

Your design is strong if:

- every event has clear ownership
- every topic has clear purpose
- every ordering guarantee has a partitioning explanation
- every consumer is idempotent
- every derived state is rebuildable
- every side effect is replay-safe or replay-isolated
- every schema can evolve safely
- every DLQ has owner and SLA
- every alert maps to action
- every architecture decision includes consequences and failure modes

---

## 32. What a Top 1% Kafka Engineer Should Be Able to Explain

After this series, you should be able to explain:

1. Why Kafka is a distributed log, not just a queue.
2. Why partitioning is a domain modelling decision.
3. Why offset commit does not prove business success.
4. Why exactly-once is bounded and contextual.
5. Why outbox solves dual-write better than wishful retry logic.
6. Why log compaction is latest-state retention, not audit.
7. Why schema compatibility is organizational safety.
8. Why consumer lag must be interpreted by time, partition, and business impact.
9. Why replay can be dangerous.
10. Why topic governance is platform engineering, not bureaucracy.
11. Why Kafka Connect is useful but not magic.
12. Why ksqlDB is powerful but not a replacement for all domain logic.
13. Why Kafka Streams state is local, replicated through changelog, and operationally significant.
14. Why regulatory systems need causation, correlation, correction, and temporal reconstruction.
15. Why failure modelling is more important than memorizing config values.

---

## 33. Series Completion

This is the final part of the series:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-034.md
```

The complete series contains:

```text
Part 000 through Part 034
```

That is 35 parts total.

The intended learning arc is complete:

```text
Kafka mental model
→ broker/cluster internals
→ producer/consumer semantics
→ schema/topic/event design
→ Connect/CDC
→ ksqlDB/Kafka Streams
→ Java/Spring integration
→ testing/observability/performance/failure
→ architecture/governance
→ capstone production platform
```

---

## 34. Final Closing Thought

Kafka mastery is not about knowing many configuration names.

Kafka mastery is the ability to answer these questions under pressure:

1. What fact happened?
2. Who produced it?
3. What key controls its ordering?
4. Which consumers depend on it?
5. Can the schema evolve safely?
6. Can this be replayed?
7. What happens if it is duplicated?
8. What happens if it arrives late?
9. What happens if the consumer crashes?
10. What happens if the topic grows 10x?
11. What happens if one region fails?
12. Can we prove why a case reached its final state?

If your Kafka design can answer those questions clearly, it is no longer just “using Kafka”.

It is an event streaming platform with architectural discipline.

---

# End of Series


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-033.md">⬅️ Part 033 — Advanced Design Review: Kafka Architecture Decision Records and Trade-Off Analysis</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
