# learn-aws-cloud-architecture-mastery-for-java-engineers-part-033.md

# Part 033 — AWS Architecture Case Studies: Production-Grade Java Systems

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin berpikir seperti architect produksi di AWS  
> Fokus: menerapkan seluruh mental model AWS sebelumnya ke desain nyata, lengkap dengan trade-off, failure mode, security, cost, operability, dan defensibility.

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas building block: account, IAM, networking, compute, storage, data, event integration, workflow, security, observability, reliability, performance, cost, IaC, deployment, configuration, API, governance, SaaS, AWS API resilience, analytics, AI, migration, dan platform engineering.

Bagian ini mengubah semua itu menjadi **case study architecture**.

Targetnya bukan hafal diagram. Targetnya adalah membentuk kemampuan untuk melihat workload dan langsung bertanya:

1. Apa user journey kritikalnya?
2. Apa state yang paling penting?
3. Apa failure domain-nya?
4. Apa boundary identity dan authorization-nya?
5. Apa dependency yang boleh gagal tanpa menjatuhkan core flow?
6. Apa RTO/RPO tiap capability?
7. Apa unit cost-nya?
8. Apa bukti audit yang harus tersedia?
9. Apa deployment blast radius-nya?
10. Apa yang harus bisa dijelaskan saat architecture review?

AWS Well-Architected Framework memberi cara konsisten untuk menilai workload terhadap pilar operational excellence, security, reliability, performance efficiency, cost optimization, dan sustainability. Dalam case study ini, setiap desain akan dibaca dengan lensa tersebut, bukan hanya “service apa yang dipakai”.

---

## 1. Cara Membaca Case Study AWS

Setiap case study akan memakai struktur yang sama:

```text
1. Business context
2. Functional capability
3. Non-functional requirements
4. Core AWS architecture
5. Runtime flow
6. Data flow
7. Identity and security model
8. Reliability model
9. Observability model
10. Deployment model
11. Cost model
12. Failure mode catalog
13. Review questions
14. Evolution path
```

Struktur ini penting karena arsitektur AWS yang baik bukan susunan ikon. Arsitektur yang baik adalah **sekumpulan keputusan yang bisa diuji**.

Diagram yang terlihat sama bisa punya kualitas sangat berbeda jika:

- credential strategy berbeda;
- retry behavior berbeda;
- DLQ tidak dimonitor;
- failover belum pernah diuji;
- data restore belum pernah disimulasikan;
- CloudTrail data event tidak aktif untuk evidence bucket;
- cost allocation tag tidak konsisten;
- tenant context tidak dipaksakan di authorization layer;
- migration rollback tidak realistis.

---

## 2. Case Study 1 — Java REST API di ECS Fargate, ALB, RDS, Redis, S3

### 2.1 Business Context

Sebuah organisasi ingin menjalankan backend Java REST API untuk aplikasi internal dan eksternal.

Contoh domain:

- case management;
- customer portal;
- order management;
- licensing system;
- regulatory submission portal.

Workload ini memiliki karakteristik:

- request/response synchronous;
- membutuhkan relational transaction;
- menyimpan dokumen;
- butuh cache untuk read-heavy data;
- harus aman, observable, dan deployable tanpa downtime.

### 2.2 Functional Capability

Capability utama:

1. User login melalui IdP atau authorization service.
2. Submit request/case.
3. Upload supporting document.
4. Query case status.
5. Update workflow state.
6. Emit domain event saat state berubah.
7. Generate audit trail.

### 2.3 Non-Functional Requirements

Contoh requirement:

| Area | Requirement |
|---|---|
| Availability | 99.9% untuk API utama |
| Latency | p95 < 300 ms untuk read endpoint umum |
| Durability | Dokumen dan audit event tidak boleh hilang |
| Security | Tidak ada public database, secret tidak hardcoded |
| Compliance | Semua perubahan state harus dapat diaudit |
| Deployment | Rolling/blue-green tanpa downtime |
| Cost | Bisa scale down di non-prod |
| Recovery | RPO database <= 15 menit, RTO <= 2 jam |

### 2.4 Core Architecture

Komponen utama:

```text
Client
  -> Route 53
  -> CloudFront optional
  -> AWS WAF optional
  -> Application Load Balancer
  -> ECS Fargate Service: Java API
  -> RDS/Aurora PostgreSQL or MySQL
  -> ElastiCache Redis
  -> S3 for documents
  -> SQS/EventBridge for asynchronous event emission
  -> CloudWatch/X-Ray/OpenTelemetry
  -> Secrets Manager / Parameter Store / AppConfig
```

### 2.5 Why ECS Fargate?

ECS Fargate cocok jika:

- tim ingin containerized deployment tanpa mengelola worker node;
- aplikasi Java adalah long-running HTTP service;
- butuh connection pooling ke database;
- cold start Lambda tidak ideal;
- tidak butuh Kubernetes API/custom controller;
- operational simplicity lebih penting daripada ecosystem extensibility EKS.

ECS bukan “Kubernetes versi sederhana”. ECS adalah orchestrator AWS-native dengan integrasi kuat ke IAM task role, CloudWatch Logs, ALB target group, Service Auto Scaling, Secrets Manager, dan deployment controller.

### 2.6 Runtime Flow

```text
1. Client mengirim HTTPS request ke domain API.
2. Route 53 resolve ke ALB atau CloudFront.
3. WAF mengevaluasi rule jika aktif.
4. ALB melakukan TLS termination dan routing ke target group.
5. ECS task menerima request.
6. Java service memvalidasi JWT/session/context.
7. Java service membaca config dari AppConfig/Parameter Store cache.
8. Java service mengambil secret database dari Secrets Manager/cache.
9. Java service melakukan query/update ke RDS.
10. Java service menyimpan/ambil dokumen dari S3.
11. Java service menulis audit log/domain event.
12. Response dikembalikan ke client.
```

### 2.7 Data Flow

Relational database menyimpan:

- case header;
- user-visible state;
- workflow state;
- ownership/assignment;
- transactional consistency boundaries;
- audit index jika dibutuhkan untuk query cepat.

S3 menyimpan:

- uploaded documents;
- generated reports;
- immutable evidence object;
- export files.

Redis menyimpan:

- short-lived cache;
- reference data cache;
- token introspection cache jika sesuai;
- rate-limit counter jika tidak menggunakan API Gateway/WAF-native control.

EventBridge/SQS menyimpan/mengirim:

- `CaseSubmitted`;
- `CaseAssigned`;
- `DocumentUploaded`;
- `DecisionIssued`;
- `NotificationRequested`.

### 2.8 Critical Design Decision: Metadata in DB, Body in S3

Anti-pattern umum: menyimpan dokumen besar di relational database.

Lebih baik:

```text
RDS:
- document_id
- case_id
- s3_bucket
- s3_key
- object_version
- checksum
- content_type
- size
- classification
- uploaded_by
- uploaded_at
- retention_policy

S3:
- actual binary object
```

Dengan model ini:

- relational transaction tetap ringan;
- dokumen bisa memakai lifecycle policy;
- S3 versioning/object lock bisa dipakai;
- audit trail bisa menyimpan object version;
- query metadata tetap efisien.

### 2.9 Security Model

Security decisions:

1. ALB only accepts HTTPS.
2. ECS service berada di private subnets.
3. Database berada di isolated/private subnets.
4. RDS security group hanya menerima traffic dari ECS security group.
5. ECS task role hanya diberi akses ke bucket/prefix yang diperlukan.
6. Execution role hanya untuk pull image dan write logs.
7. Database credential di Secrets Manager.
8. S3 bucket block public access aktif.
9. SSE-KMS untuk S3/RDS jika requirement menuntut customer-managed key.
10. CloudTrail aktif untuk management events dan data events pada bucket evidence kritikal.

### 2.10 Java Application Design

Java service harus:

- reuse AWS SDK client;
- reuse database connection pool;
- set HTTP client timeout;
- support graceful shutdown pada SIGTERM;
- expose `/health/live` dan `/health/ready`;
- tidak melakukan heavy initialization di request pertama;
- menggunakan structured logging;
- membawa correlation ID;
- memisahkan domain error dari infrastructure error;
- melakukan idempotency untuk endpoint write yang bisa diulang.

Contoh pseudo-pattern:

```java
public final class SubmitCaseHandler {
    public SubmitCaseResult handle(SubmitCaseCommand command) {
        // 1. Validate command
        // 2. Check idempotency key
        // 3. Start DB transaction
        // 4. Insert case
        // 5. Insert audit record
        // 6. Store outbox event
        // 7. Commit
        // 8. Async publisher later sends event to EventBridge/SQS
        // 9. Return stable case id
    }
}
```

Untuk write path penting, hindari emit event langsung sebelum commit database. Gunakan outbox atau transactional publication strategy.

### 2.11 Reliability Model

Reliability controls:

- ECS service minimum task count >= 2;
- task tersebar di minimal dua AZ;
- RDS Multi-AZ;
- ALB health check ke readiness endpoint;
- retry hanya untuk safe/transient error;
- idempotency untuk create/update;
- SQS DLQ untuk async workers;
- backup database otomatis;
- restore test terjadwal;
- alarms untuk 5xx, latency, unhealthy target, DB connection, CPU/memory, Redis errors, DLQ depth.

### 2.12 Cost Model

Cost drivers:

- Fargate vCPU/memory runtime;
- ALB hourly + LCU;
- RDS instance/storage/IO/backup;
- NAT Gateway hourly + data processed;
- CloudWatch Logs ingestion/retention;
- S3 storage/request/lifecycle;
- Redis node hours;
- data transfer cross-AZ/outbound.

Cost controls:

- right-size ECS task memory;
- reduce noisy logs;
- VPC endpoint for S3/DynamoDB where appropriate;
- scale non-prod down;
- lifecycle old S3 objects;
- set log retention explicitly;
- use Graviton-compatible runtime if tested.

### 2.13 Failure Mode Catalog

| Failure | Symptom | Prevention/Detection | Response |
|---|---|---|---|
| Bad ECS deployment | 5xx rises, unhealthy target | deployment circuit breaker, canary | rollback/roll forward |
| DB connection exhaustion | timeout, elevated latency | pool limit, RDS metrics | reduce concurrency, tune pool |
| S3 access denied | document upload fails | IAM test, integration test | fix task role/bucket policy |
| Redis unavailable | degraded read latency | cache fallback | bypass cache temporarily |
| NAT saturation/cost spike | slow AWS API calls, high bill | VPC endpoints, metrics | route optimization |
| Log explosion | CloudWatch cost spike | sampling, retention | reduce log verbosity |
| Partial event publish | DB committed but event missing | outbox pattern | replay outbox |

### 2.14 Architecture Review Questions

- What is the synchronous critical path?
- Can the API continue if Redis fails?
- What is the database connection pool limit per task and total fleet?
- What happens if the same submit request is retried?
- What happens if S3 upload succeeds but DB commit fails?
- Is document access checked by domain authorization, not only S3 permission?
- Is every state transition auditable?
- Can we restore RDS and map S3 object versions consistently?

---

## 3. Case Study 2 — Event-Driven Document Processing with S3, Lambda, SQS, Step Functions

### 3.1 Business Context

Aplikasi menerima dokumen besar dari user, lalu melakukan:

- virus scan;
- metadata extraction;
- OCR;
- classification;
- validation;
- enrichment;
- approval routing;
- notification.

Dokumen bisa berupa PDF, image, archive, atau generated file.

### 3.2 Why Not Process Inside API Request?

Karena:

- durasi bisa panjang;
- downstream bisa lambat;
- OCR/AI call mahal;
- retry synchronous berbahaya;
- user tidak perlu menunggu seluruh proses selesai;
- processing harus bisa diulang dan diaudit.

Maka flow lebih baik asynchronous.

### 3.3 Core Architecture

```text
Client
  -> API Gateway / ALB Java API
  -> Generate presigned S3 upload URL
  -> Client uploads to S3 landing bucket
  -> S3 event notification / EventBridge
  -> SQS buffering
  -> Step Functions workflow
      -> validation Lambda
      -> virus scan task / ECS task
      -> OCR/Textract task
      -> metadata extraction
      -> classification
      -> persistence update
      -> notification
  -> DLQ / failure queue
  -> CloudWatch / X-Ray / audit events
```

AWS Lambda supports event-driven architecture through direct invocation and event source mappings, and S3 can trigger Lambda processing when objects are created. For more controlled long-running business process orchestration, Step Functions can model workflows as a series of steps that call Lambda, containers, databases, or queues.

### 3.4 Upload Flow

```text
1. Java API validates user authorization to upload document for case X.
2. Java API creates document metadata row with status UPLOAD_PENDING.
3. Java API generates presigned S3 URL with scoped key.
4. Client uploads object directly to S3.
5. S3 event is emitted.
6. Event enters SQS or EventBridge.
7. Processing workflow starts.
8. Workflow validates object checksum, content type, size, and metadata.
9. Workflow updates document status progressively.
10. Final state becomes ACCEPTED, REJECTED, or MANUAL_REVIEW_REQUIRED.
```

### 3.5 Why SQS Between S3 and Processor?

SQS provides:

- buffering;
- backpressure;
- retry isolation;
- DLQ;
- visibility timeout;
- consumer concurrency control.

Direct S3 -> Lambda is simple, but S3 -> SQS -> Lambda/Step Functions is often safer for production if processing can fail, spike, or require controlled concurrency.

### 3.6 Workflow State Machine

Example states:

```text
DocumentUploaded
  -> ValidateMetadata
  -> CheckDuplicate
  -> ScanForMalware
  -> ExtractText
  -> ClassifyDocument
  -> ValidateAgainstCaseType
  -> PersistResult
  -> NotifyCaseOwner
  -> Completed
```

Failure states:

```text
InvalidObject
MalwareDetected
ExtractionFailed
UnsupportedFormat
ManualReviewRequired
ProcessingTimedOut
```

### 3.7 Idempotency Model

Every processing step must tolerate repeated execution.

Use stable idempotency keys:

```text
case_id + document_id + s3_object_version + processing_step
```

Persist step result:

```text
processing_step_result
- document_id
- object_version
- step_name
- status
- attempt_count
- output_location
- started_at
- completed_at
- error_code
```

### 3.8 Security Model

- Upload bucket is not public.
- Client only gets presigned URL for specific key and limited time.
- Object key includes tenant/case/document namespace.
- S3 object metadata must not be trusted blindly.
- Processing role only reads landing bucket and writes processed bucket/prefix.
- KMS key policy allows only intended roles.
- Workflow execution records must avoid storing sensitive payload if not needed.
- CloudTrail data events enabled for sensitive buckets.

### 3.9 Reliability Model

- Landing upload and processing are decoupled.
- SQS absorbs spikes.
- Lambda reserved concurrency or Step Functions Map concurrency limits downstream load.
- DLQ captures unprocessable events.
- Manual replay path exists.
- Processing result is durable.
- User-visible document status reflects actual state.

### 3.10 Failure Mode Catalog

| Failure | Bad Design Symptom | Better Design |
|---|---|---|
| Duplicate S3 event | duplicate processing | idempotent step result |
| Large file timeout | Lambda timeout | ECS task / Step Functions activity / chunked processing |
| OCR downstream slow | retry storm | queue + concurrency limit |
| Partial processing | document stuck PROCESSING | timeout watchdog + repair job |
| Invalid file | generic 500 | domain failure state |
| Malware found | file remains accessible | quarantine prefix/bucket |
| Workflow payload too large | Step Functions failure | store large payload in S3, pass pointer |

### 3.11 Review Questions

- Can processing be replayed safely?
- Can a user see the file before validation completes?
- What is the maximum document size?
- Is every failure mapped to a user-visible/business state?
- What is the DLQ operating procedure?
- Does the workflow store sensitive data unnecessarily?
- Is the object version captured in metadata?

---

## 4. Case Study 3 — Regulated Case Management Platform with Audit Trail and Workflow

### 4.1 Business Context

A regulatory organization manages enforcement lifecycle:

1. intake;
2. triage;
3. assignment;
4. investigation;
5. evidence collection;
6. escalation;
7. review;
8. decision;
9. notification;
10. appeal;
11. closure;
12. retention/destruction.

This is not just CRUD. It is a governed state machine with auditability requirements.

### 4.2 Core Architectural Principle

The platform must separate:

| Concern | Storage/Runtime |
|---|---|
| Current case state | relational DB |
| State transition history | append-only audit/event log |
| Documents/evidence | S3 with versioning/Object Lock if required |
| Workflow orchestration | Step Functions or domain workflow service |
| Notifications | SQS/SNS/EventBridge |
| Search | OpenSearch projection |
| Analytics | S3 data lake + Glue/Athena |
| Authorization | domain-level policy + IAM boundary |

### 4.3 State Machine Model

Example case states:

```text
DRAFT
SUBMITTED
TRIAGE_PENDING
TRIAGED
ASSIGNED
UNDER_INVESTIGATION
EVIDENCE_REQUESTED
ESCALATION_REVIEW
DECISION_PENDING
DECISION_ISSUED
APPEAL_PERIOD
CLOSED
ARCHIVED
```

Each transition must define:

- allowed source states;
- target state;
- actor role;
- required evidence;
- side effects;
- timeout/escalation rule;
- audit record;
- notification policy.

Example transition contract:

```yaml
transition: SUBMIT_CASE
from: DRAFT
into: SUBMITTED
actor: CASE_OWNER
preconditions:
  - required_fields_complete
  - at_least_one_document_uploaded
side_effects:
  - emit CaseSubmitted
  - schedule triage SLA timer
audit:
  include:
    - actor_id
    - tenant_id
    - case_id
    - old_state
    - new_state
    - timestamp
    - reason
```

### 4.4 Recommended AWS Architecture

```text
Frontend
  -> CloudFront + WAF
  -> API Gateway or ALB
  -> Java Case API on ECS Fargate
  -> Aurora/RDS for case state
  -> S3 evidence bucket
  -> Step Functions for long-running workflow where appropriate
  -> EventBridge for domain events
  -> SQS workers for notifications/search indexing/exports
  -> OpenSearch for search projection
  -> S3 data lake for analytics
  -> CloudTrail + Config + Security Hub + GuardDuty
  -> KMS for encryption boundary
```

### 4.5 Domain State vs Workflow State

Do not confuse:

```text
Domain state: what the case means to the business.
Workflow state: where the orchestration currently is technically.
```

Example:

- Domain state: `EVIDENCE_REQUESTED`.
- Workflow state: `WaitForExternalSubmissionCallback`.

The domain state must remain queryable even if Step Functions execution history retention or payload limits are not suitable as primary business storage.

### 4.6 Audit Trail Design

Audit event should be append-only.

Minimum fields:

```text
- audit_event_id
- tenant_id
- case_id
- actor_type
- actor_id
- actor_role
- action
- old_state
- new_state
- timestamp
- request_id
- correlation_id
- source_ip / device context if appropriate
- reason / note
- policy_decision
- evidence_refs
- schema_version
```

Important distinction:

- Application audit log: business event/evidence.
- CloudTrail: AWS API control plane/data plane audit.
- Access log: HTTP/network access.
- Application log: debugging/operational telemetry.

All are useful, but they are not interchangeable.

### 4.7 Authorization Model

IAM answers: “Can this workload role call this AWS API?”

Domain authorization answers: “Can this actor perform this case transition?”

Both are required.

Example:

```text
IAM permits Java service to write Case table.
Domain policy decides whether investigator A may transition case X from UNDER_INVESTIGATION to ESCALATION_REVIEW.
```

Never encode all business authorization in IAM unless your domain is truly AWS-resource-native. Most case management authorization is domain-level.

### 4.8 Evidence Storage

S3 evidence bucket should consider:

- block public access;
- versioning;
- SSE-KMS;
- Object Lock if regulatory retention requires WORM behavior;
- lifecycle policy;
- CloudTrail data events;
- access logs if needed;
- bucket policy with secure transport condition;
- prefix per tenant/case;
- object tags for classification/retention.

### 4.9 Search Projection

OpenSearch should be projection, not source of truth.

```text
RDS/Aurora -> outbox -> SQS/EventBridge -> indexer worker -> OpenSearch
```

If indexing fails:

- source of truth remains correct;
- indexer can replay;
- UI can show “search index delayed” if needed;
- DLQ is monitored.

### 4.10 Analytics Projection

Analytics should not query OLTP directly for heavy workloads.

Better:

```text
Domain events / CDC / scheduled export
  -> S3 raw zone
  -> Glue catalog
  -> Athena/Redshift
  -> governance via Lake Formation if needed
```

### 4.11 Failure Mode Catalog

| Failure | Consequence | Control |
|---|---|---|
| Invalid state transition | regulatory inconsistency | transition table + DB transaction |
| Audit write missing | defensibility loss | same transaction or durable outbox |
| Evidence overwritten | evidence integrity loss | S3 versioning/Object Lock |
| Search index stale | user confusion | index lag metric + replay |
| Workflow stuck | SLA breach | timeout, heartbeat, watchdog |
| Authorization bug | cross-case access | tenant/case policy tests |
| Notification failure | user misses deadline | SQS DLQ + retry + manual retry |
| Report query overloads OLTP | production slowdown | analytics projection |

### 4.12 Architecture Review Questions

- What is the canonical source of case state?
- Is audit written atomically with state transition?
- Can an audit record be deleted or modified?
- Does every transition have a policy and reason?
- Can workflow be resumed after technical failure?
- Are evidence object versions captured?
- Are search and analytics projections replayable?
- Are SLA timers represented explicitly?

---

## 5. Case Study 4 — Multi-Tenant SaaS with Tenant Isolation and Cost Allocation

### 5.1 Business Context

A SaaS vendor offers case management to multiple organizations.

Tenants differ by:

- data classification;
- scale;
- compliance requirement;
- customization;
- region/residency;
- support tier;
- isolation expectation.

### 5.2 Tenancy Model

Possible models:

```text
Silo: tenant gets dedicated resources.
Pool: tenants share resources.
Bridge: mixture of shared and dedicated resources.
```

AWS SaaS guidance emphasizes tenant isolation as a foundational requirement: each tenant must be prevented from accessing another tenant’s resources. This is not automatically solved by Lambda/ECS/container isolation; the workload must carry and enforce tenant context across storage, identity, API, observability, and operations.

### 5.3 Reference Architecture

```text
SaaS Control Plane
  - tenant catalog
  - onboarding service
  - plan/tier management
  - tenant config
  - tenant identity mapping
  - provisioning workflow

SaaS Application Plane
  - shared API services
  - shared or tiered data stores
  - tenant-aware authorization
  - tenant-aware observability
  - tenant-aware billing/cost allocation
```

### 5.4 Tenant Catalog

Tenant catalog records:

```text
- tenant_id
- legal_name
- tier
- region
- status
- isolation_model
- account_id if silo/bridge
- database/schema/table partition
- s3_prefix/bucket
- kms_key_id
- rate_limit_policy
- feature_flags
- retention_policy
```

Every request must resolve tenant context early.

### 5.5 Tenant Context Propagation

Request path:

```text
JWT claims / mTLS / API key
  -> tenant resolver
  -> tenant context object
  -> domain authorization
  -> data access layer
  -> audit log
  -> metrics/logs/traces
  -> cost tags/metadata
```

Never rely on UI-supplied tenant ID alone.

### 5.6 Data Isolation Options

Relational options:

| Model | Pros | Cons |
|---|---|---|
| Database per tenant | strong isolation | operational overhead |
| Schema per tenant | moderate isolation | migration complexity |
| Shared schema with tenant_id | efficient | requires strict guardrails |

DynamoDB options:

```text
PK = TENANT#<tenant_id>#CASE#<case_id>
```

or

```text
PK = TENANT#<tenant_id>
SK = CASE#<case_id>
```

S3 options:

```text
s3://bucket/tenant/<tenant_id>/case/<case_id>/document/<document_id>
```

Search index options:

- index per tenant;
- shared index with tenant filter;
- index per tier/classification.

### 5.7 Tenant Isolation Controls

Layers:

1. API authorization.
2. Domain policy.
3. Data access filter.
4. IAM condition/session tag where appropriate.
5. KMS key boundary for high-sensitivity tenants.
6. S3 prefix/bucket policy.
7. Test suite for cross-tenant access.
8. Observability with tenant-aware redaction.

### 5.8 Noisy Neighbor Controls

Controls:

- per-tenant API rate limit;
- per-tenant queue;
- per-tenant worker concurrency;
- per-tenant DB connection budget;
- per-tenant cache key namespace;
- tier-based autoscaling;
- tenant-level circuit breaker;
- cost anomaly detection.

### 5.9 Cost Allocation

Use:

- tenant_id in business metrics;
- AWS tags where resource-dedicated;
- application-level metering for pooled resources;
- S3 prefix storage metrics if needed;
- request count, workflow count, document count, OCR page count;
- showback/chargeback model.

### 5.10 Failure Mode Catalog

| Failure | Consequence | Control |
|---|---|---|
| Missing tenant filter | data leak | repository guard + tests |
| Cache key lacks tenant_id | cross-tenant data leak | tenant-prefixed keys |
| Shared queue dominated by one tenant | SLA breach | per-tenant/tier queues |
| Tenant-specific migration fails | partial outage | migration status per tenant |
| Dedicated tenant key disabled | tenant outage | key monitoring + break-glass |
| Logs include PII | compliance risk | redaction + classification |

### 5.11 Review Questions

- Where is tenant context resolved?
- Can tenant context be spoofed?
- Is tenant_id present in audit logs?
- Are cache keys tenant-scoped?
- How do we throttle one tenant without hurting others?
- Can high-tier tenants be migrated to silo resources?
- How is cost calculated per tenant in pooled infrastructure?

---

## 6. Case Study 5 — High-Throughput Ingestion with Kinesis/MSK, S3, Glue, Athena

### 6.1 Business Context

A platform ingests high-volume events:

- user activity;
- audit events;
- telemetry;
- integration events;
- regulatory submissions;
- document processing results.

Need:

- durable ingestion;
- near real-time processing;
- analytical storage;
- replay;
- schema evolution;
- cost control.

### 6.2 Core Architecture Option A — Kinesis-Native

```text
Java producers
  -> Kinesis Data Streams
  -> Lambda/KCL consumers for near real-time processing
  -> Firehose to S3 data lake
  -> Glue Data Catalog
  -> Athena / Redshift Spectrum
  -> dashboards/reports
```

### 6.3 Core Architecture Option B — MSK/Kafka-Native

```text
Java producers
  -> MSK topic
  -> Kafka consumers / Kafka Connect
  -> S3 sink
  -> Glue Data Catalog
  -> Athena / Redshift
```

Use MSK if:

- Kafka ecosystem compatibility is required;
- existing teams already operate Kafka semantics;
- consumer group semantics and Kafka tooling are central;
- cross-platform portability matters.

Use Kinesis if:

- AWS-native integration is preferred;
- operational simplicity matters;
- shard model is acceptable;
- integration with Firehose/Lambda is enough.

### 6.4 Event Contract

Minimum envelope:

```json
{
  "event_id": "uuid",
  "event_type": "CaseStateChanged",
  "schema_version": "1.0",
  "tenant_id": "tenant-123",
  "occurred_at": "2026-06-20T10:00:00Z",
  "producer": "case-service",
  "correlation_id": "...",
  "causation_id": "...",
  "payload": {}
}
```

### 6.5 Partitioning Strategy

Choose partition key based on ordering requirement.

Examples:

```text
case_id      -> ordered per case
tenant_id    -> grouped per tenant, risk hot tenant
event_type   -> usually bad for hot partition
random/id    -> good distribution, no ordering
```

### 6.6 S3 Lake Layout

```text
s3://data-lake/raw/source=case-service/event_type=CaseStateChanged/year=2026/month=06/day=20/hour=10/...
```

Avoid only ingestion-date partition if business query mostly uses event date. Avoid too many tiny files.

### 6.7 Glue/Athena Design

Glue Data Catalog stores table metadata.

Athena query cost is tied to data scanned, so:

- use columnar formats like Parquet;
- partition intelligently;
- compact small files;
- compress data;
- avoid SELECT *;
- apply partition projection where useful.

### 6.8 Failure Mode Catalog

| Failure | Consequence | Control |
|---|---|---|
| Bad partition key | hot shard/partition | model cardinality |
| Consumer falls behind | stale analytics | lag alarms |
| Schema change breaks query | failed report | schema registry/compatibility tests |
| Small files explosion | slow/costly Athena | compaction job |
| Duplicate events | inflated metrics | event_id deduplication |
| Firehose delivery failure | data loss/delay | backup/error prefix + alarms |
| PII lands in raw lake | compliance risk | classification + Lake Formation |

### 6.9 Review Questions

- What ordering is required?
- What is acceptable ingestion lag?
- Can consumers replay from source?
- What is the schema compatibility policy?
- What is raw vs curated boundary?
- Who owns data quality?
- How are bad records quarantined?

---

## 7. Case Study 6 — DR-Ready Multi-AZ and Warm Standby Architecture

### 7.1 Business Context

A regulated workload cannot depend only on “AWS is highly available”. It must define recovery capability.

Critical capabilities:

- case submission;
- case view;
- document retrieval;
- enforcement decision issuance;
- audit trail preservation;
- notification.

Not all capabilities require same RTO/RPO.

### 7.2 Capability-Based Recovery Targets

| Capability | RTO | RPO | Notes |
|---|---:|---:|---|
| Case submission | 1 hour | 15 min | public-facing critical |
| Case read | 30 min | 15 min | read-only fallback possible |
| Document upload | 2 hours | 0-15 min | S3 replication consideration |
| Decision issuance | 4 hours | 15 min | can degrade to manual process |
| Audit trail | 1 hour | near-zero | must not lose evidence |
| Analytics | 24 hours | 24 hours | not critical path |

### 7.3 Multi-AZ Baseline

Before multi-region, ensure multi-AZ is real:

```text
- ECS tasks across >=2 AZs
- ALB spans >=2 AZs
- RDS Multi-AZ or Aurora multi-AZ cluster
- NAT Gateway per AZ if egress-heavy
- subnet route tables per AZ
- no single-AZ shared dependency
- health checks detect zonal issue
```

### 7.4 DR Strategy Options

AWS commonly discusses DR patterns such as backup/restore, pilot light, warm standby, and multi-site active/active. Warm standby keeps a scaled-down but functional copy of production in another Region, reducing time to recovery compared with pilot light because the workload is already running at smaller scale.

### 7.5 Warm Standby Architecture

```text
Primary Region
  - full ECS/API capacity
  - primary DB
  - active S3 bucket
  - active queues/workflows
  - full observability

Secondary Region
  - scaled-down ECS/API
  - replicated DB/read replica or restore-ready DB
  - replicated S3 evidence bucket
  - prepared queues/config/secrets
  - Route 53 / ARC routing control
```

### 7.6 Data Replication

Data classes:

| Data | Replication Strategy |
|---|---|
| Relational case state | Aurora Global Database / cross-region replica / backup restore |
| Documents | S3 Cross-Region Replication |
| Secrets | replicate manually or managed process |
| Config | IaC/AppConfig multi-region deployment |
| Audit events | replicated stream/lake or dual-write with caution |
| Search index | rebuildable projection |

### 7.7 Failover Procedure

A failover runbook must include:

1. Determine incident scope.
2. Freeze risky write paths if needed.
3. Verify latest replication status.
4. Promote secondary database if applicable.
5. Scale secondary compute.
6. Switch DNS/routing control.
7. Validate API health.
8. Validate auth/session behavior.
9. Validate evidence access.
10. Communicate degraded capabilities.
11. Capture audit of failover decision.

### 7.8 Failback Procedure

Failback is often harder than failover.

Questions:

- Did writes happen in secondary?
- How are divergent records reconciled?
- Is primary rebuilt from secondary?
- Do object versions match?
- Are workflow executions duplicated?
- Are notifications replayed?

### 7.9 Failure Mode Catalog

| Failure | Consequence | Control |
|---|---|---|
| Multi-AZ not actually tested | surprise outage | AZ game day |
| Backup cannot restore | false confidence | restore test |
| DNS TTL too high | slow failover | planned TTL/routing control |
| Secondary config stale | failover broken | IaC multi-region deployment |
| Secrets missing in DR | app starts but fails | secret replication test |
| Data divergence | invalid state | write freeze/reconciliation |
| Search not available in DR | degraded UX | rebuild projection/runbook |

### 7.10 Review Questions

- What exact event triggers failover?
- Who can approve failover?
- What is the last successful restore test date?
- What is the measured, not estimated, RTO?
- What is the measured replication lag?
- What features are disabled in DR mode?
- Can we run in read-only mode?

---

## 8. Cross-Case Architecture Principles

### 8.1 Separate Source of Truth from Projection

Source of truth:

- case state database;
- audit event store;
- evidence object store.

Projection:

- OpenSearch index;
- analytics lake curated tables;
- cache;
- report snapshots.

Projection failure should not corrupt source of truth.

### 8.2 Make Async Work Explicit

Async is not a way to hide complexity. It is a way to move complexity into:

- queues;
- workflow state;
- retries;
- DLQs;
- replay;
- idempotency;
- observability.

If those are not designed, async makes the system less reliable.

### 8.3 Treat IAM as Infrastructure Boundary, Not Business Policy

IAM should control AWS API access.

Business rules should live in application/domain authorization.

Use IAM session tags/ABAC only when it actually maps to AWS resource access and can be tested safely.

### 8.4 Every Critical Write Needs an Idempotency Story

Critical writes:

- case submission;
- payment;
- document registration;
- decision issuance;
- notification request;
- export generation;
- tenant onboarding.

Each needs:

- idempotency key;
- stable response;
- duplicate detection;
- retry policy;
- audit event.

### 8.5 Logs Are Not Audit

Logs are operational telemetry. Audit events are business evidence.

Do not rely on application logs as the only proof of state transition.

### 8.6 Cost Is a Design Input

For each case study, define unit cost:

```text
cost per API request
cost per submitted case
cost per document page processed
cost per workflow execution
cost per tenant per month
cost per GB analytics scanned
cost per DR readiness month
```

Without unit economics, cloud cost becomes reactive.

---

## 9. Architecture Decision Record Template for Case Studies

```markdown
# ADR: <Architecture Decision>

## Status
Proposed | Accepted | Deprecated | Superseded

## Context
What business and technical forces require this decision?

## Decision
What are we choosing?

## Alternatives Considered
1. Option A
2. Option B
3. Option C

## Consequences
### Positive
- ...

### Negative
- ...

### Risks
- ...

## Failure Modes
- ...

## Operational Requirements
- alarms
- dashboards
- runbooks
- backup/restore
- replay
- manual override

## Security Requirements
- IAM role
- KMS key
- audit trail
- data classification

## Cost Implications
- main cost drivers
- unit cost metric

## Review Date
YYYY-MM-DD
```

---

## 10. Production Readiness Checklist

### Business and Domain

- [ ] Critical user journeys identified.
- [ ] State transitions explicitly modeled.
- [ ] Source of truth identified.
- [ ] Projection systems are replayable.
- [ ] Business audit events are durable.

### Security

- [ ] No public database.
- [ ] Workload identity uses role, not static credential.
- [ ] Secrets are not stored in code/image.
- [ ] KMS policy reviewed.
- [ ] S3 block public access enabled.
- [ ] Cross-account access explicitly designed.
- [ ] Tenant isolation tested if SaaS.

### Reliability

- [ ] Multi-AZ deployment validated.
- [ ] Backup and restore tested.
- [ ] DLQ exists and is monitored.
- [ ] Retry policy bounded.
- [ ] Idempotency exists for critical writes.
- [ ] Health checks represent readiness, not just process liveness.

### Observability

- [ ] Structured logs.
- [ ] Correlation ID across services/events.
- [ ] Metrics for business and infrastructure.
- [ ] Alarms mapped to runbooks.
- [ ] Tracing on critical paths.
- [ ] Dashboard per capability.

### Deployment

- [ ] Artifact is immutable.
- [ ] Rollback/roll-forward decision is defined.
- [ ] DB migration is backward compatible.
- [ ] Feature flags have owner and expiry.
- [ ] IaC changes reviewed for replacement risk.

### Cost

- [ ] Cost allocation tags active.
- [ ] Log retention set.
- [ ] NAT/data transfer reviewed.
- [ ] Non-prod scale-down strategy exists.
- [ ] Unit cost metric defined.

---

## 11. Exercises

### Exercise 1 — Redesign a CRUD App

Take a simple Java CRUD app and redesign it as production AWS architecture.

Must include:

- API entry;
- compute choice;
- database;
- document storage;
- authentication;
- audit trail;
- async notifications;
- deployment path;
- observability;
- failure mode table.

### Exercise 2 — Break the Document Pipeline

List what happens if:

1. S3 event is duplicated.
2. OCR provider times out.
3. Step Functions execution fails halfway.
4. User uploads same file twice.
5. Malware scanner is unavailable.
6. DLQ grows for 6 hours.

For each, define system behavior and operator response.

### Exercise 3 — Tenant Isolation Test Plan

Design tests proving tenant A cannot:

- read tenant B case;
- fetch tenant B S3 document;
- see tenant B search result;
- consume tenant B event;
- infer tenant B through logs/metrics;
- exhaust shared resource without throttling.

### Exercise 4 — DR Game Day

Define a game day for regional impairment:

- assumptions;
- trigger;
- participants;
- failover steps;
- validation steps;
- rollback/failback;
- metrics to capture;
- lessons learned.

---

## 12. Key Takeaways

1. AWS architecture is not a diagram of services; it is a set of operationally testable decisions.
2. Good Java systems on AWS separate synchronous critical path from asynchronous side effects.
3. ECS/Fargate is often a pragmatic default for long-running Java APIs.
4. Lambda is powerful for event handlers, but retry/idempotency/cold start/concurrency must be designed.
5. Step Functions is excellent for explicit long-running workflows, especially when auditability matters.
6. RDS/Aurora is often source of truth; S3 is often evidence/body storage; OpenSearch and analytics lake should usually be projections.
7. Multi-tenant SaaS requires tenant context propagation everywhere, not just tenant_id in a table.
8. DR readiness is measured by tested recovery, not declared architecture.
9. Every architecture should have failure mode catalog, cost model, security model, and runbook.
10. Top engineers do not ask “can AWS do this?” first. They ask “what invariant must survive failure?”

---

## 13. Referensi Resmi yang Relevan

- AWS Well-Architected Framework — framework untuk menilai workload terhadap pilar operational excellence, security, reliability, performance efficiency, cost optimization, dan sustainability.
- AWS Lambda documentation — event-driven architecture, S3 event notifications, and Lambda invocation models.
- AWS Step Functions documentation — workflow orchestration, service integration, and business process modeling.
- AWS SaaS Lens / SaaS architecture fundamentals — tenant isolation, multi-tenant microservices, silo/pool/bridge thinking.
- AWS Disaster Recovery whitepaper — backup/restore, pilot light, warm standby, and multi-site active/active patterns.
- Amazon Route 53 Application Recovery Controller documentation — zonal and regional recovery control concepts.

---

## 14. Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-034.md
```

Judul:

```text
AWS Architecture Review Method: How Top Engineers Evaluate Designs
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-032.md">⬅️ Part 032 — Enterprise Architecture on AWS: Platform Engineering, Shared Services, Golden Path, dan Developer Experience</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-034.md">Part 034 — AWS Architecture Review Method: How Top Engineers Evaluate Designs ➡️</a>
</div>
