# learn-aws-cloud-architecture-mastery-for-java-engineers-part-035.md

# Part 035 — AWS Mastery Capstone: Design, Build, Operate, Break, and Defend a Production Workload

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin berpikir seperti top-tier AWS engineer  
> Fokus: capstone end-to-end — bukan menambah katalog service, tetapi membuktikan bahwa desain bisa dibangun, dioperasikan, dirusak secara terkontrol, dipulihkan, diaudit, dan dipertanggungjawabkan.

---

## 0. Posisi Part Ini dalam Seri

Bagian ini adalah **bagian terakhir** dari seri AWS.

Semua part sebelumnya membangun primitive dan cara berpikir:

- Part 000–004: fondasi AWS, account, IAM, credential, Java SDK.
- Part 005–010: networking, entry traffic, compute, EC2, ECS/Fargate, Lambda.
- Part 011–015: storage, data services, DynamoDB, event integration, workflow.
- Part 016–021: security, KMS, observability, reliability, performance, cost.
- Part 022–026: IaC, deployment, config, API architecture, governance.
- Part 027–034: SaaS, resilient AWS API integration, analytics, AI, migration, platform engineering, case studies, architecture review.

Part ini menggabungkan semuanya menjadi satu latihan besar:

```text
Design -> Build -> Operate -> Break -> Recover -> Review -> Defend
```

Top engineer tidak hanya bisa menggambar arsitektur. Ia harus bisa menjawab:

1. Apa business capability yang dilayani?
2. Apa boundary keamanannya?
3. Apa failure mode-nya?
4. Apa invariant yang tidak boleh dilanggar?
5. Apa yang terjadi saat AZ gagal?
6. Apa yang terjadi saat dependency lambat?
7. Apa yang terjadi saat deployment gagal?
8. Apa yang terjadi saat human operator salah klik?
9. Apa yang terjadi saat tenant besar menyerang sistem secara tidak sengaja?
10. Apa evidence bahwa sistem bekerja sesuai klaim?

AWS Well-Architected Framework mendefinisikan enam pilar utama: **operational excellence, security, reliability, performance efficiency, cost optimization, dan sustainability**. Capstone ini memakai keenam pilar tersebut sebagai alat validasi desain, bukan sebagai checklist kosmetik.

---

## 1. Capstone Scenario

Kita akan mendesain workload berikut:

```text
Regulated Case Management Platform on AWS
```

Konteks bisnis:

Sebuah organisasi regulator ingin membangun platform untuk mengelola lifecycle kasus enforcement:

1. case intake;
2. evidence upload;
3. triage;
4. assignment;
5. investigation workflow;
6. escalation;
7. decision recommendation;
8. approval;
9. notice generation;
10. audit trail;
11. reporting;
12. search;
13. tenant-aware access;
14. compliance evidence;
15. disaster recovery.

Platform ini digunakan oleh beberapa tenant/agency. Setiap tenant memiliki data sensitif dan tidak boleh bocor ke tenant lain.

Karakter workload:

- Backend utama ditulis dengan Java.
- API bersifat internal dan eksternal terbatas.
- Dokumen/evidence bisa besar.
- Beberapa proses bersifat synchronous, sebagian asynchronous, sebagian long-running workflow.
- Auditability sangat penting.
- Sistem harus bisa menjelaskan siapa melakukan apa, kapan, dari mana, terhadap entitas apa, dan berdasarkan policy apa.
- Deployment harus aman.
- Cost harus terkendali.
- Recovery harus diuji.

---

## 2. Requirement Breakdown

### 2.1 Functional Requirements

Capability utama:

1. User login melalui enterprise identity provider.
2. User membuat case baru.
3. User mengunggah dokumen/evidence.
4. Sistem melakukan virus scan / content validation / metadata extraction.
5. Case masuk ke queue triage.
6. Supervisor assign case ke investigator.
7. Investigator menambahkan finding, note, document, dan action.
8. Workflow melakukan escalation berdasarkan severity, SLA, dan rule.
9. Decision package dibuat.
10. Approver menyetujui atau menolak decision.
11. Sistem menghasilkan notice document.
12. Semua perubahan tercatat sebagai audit event.
13. User dapat mencari case berdasarkan metadata dan status.
14. Reporting dapat membaca data analitik tanpa membebani OLTP.
15. Admin dapat melihat operational dashboard.

### 2.2 Non-Functional Requirements

Non-functional requirement yang harus eksplisit:

| Area | Requirement |
|---|---|
| Availability | API utama tersedia minimal 99.9% untuk business hours, dengan graceful degradation untuk fitur non-kritis |
| Durability | Evidence dan audit event tidak boleh hilang |
| RTO | 4 jam untuk core case operations |
| RPO | 15 menit untuk core metadata, near-zero untuk immutable evidence jika replication aktif |
| Security | Tenant isolation, least privilege, encryption at rest/in transit |
| Auditability | Semua state transition penting harus memiliki audit trail |
| Performance | p95 API read < 300ms untuk query umum, p95 write < 800ms tanpa document upload |
| Cost | Unit cost per active case dan per evidence GB harus dapat diukur |
| Compliance | Evidence immutable untuk retention tertentu |
| Operability | Semua alarm punya runbook |
| Deployability | Deployment harus reversible untuk application code |

### 2.3 Critical Invariants

Invariant adalah aturan yang tidak boleh dilanggar walaupun sistem sedang gagal.

Contoh invariant:

1. User tenant A tidak boleh membaca data tenant B.
2. Case tidak boleh berubah status tanpa domain transition yang valid.
3. Evidence object tidak boleh dianggap accepted sebelum validation selesai.
4. Audit event untuk state transition wajib dibuat.
5. Decision tidak boleh approved oleh user yang sama dengan submitter jika policy segregation-of-duty berlaku.
6. Workflow retry tidak boleh membuat side effect ganda.
7. Search index boleh stale, tetapi source of truth tidak boleh dikompromikan.
8. Analytics boleh tertunda, tetapi OLTP tidak boleh menunggu analytics pipeline.
9. Secret tidak boleh masuk log.
10. Deployment gagal tidak boleh menghancurkan data.

---

## 3. Workload Boundary

Sebelum memilih service, kita definisikan workload boundary.

### 3.1 Workload Name

```text
regulated-case-management-core
```

### 3.2 Business Capabilities

Core:

- case lifecycle;
- evidence management;
- workflow orchestration;
- audit trail;
- access control;
- notification;
- search projection;
- reporting projection.

Non-core tetapi penting:

- observability;
- deployment;
- compliance evidence;
- cost allocation;
- backup/restore;
- DR.

### 3.3 External Dependencies

| Dependency | Type | Failure Impact |
|---|---|---|
| Enterprise IdP | Authentication | Login failure, existing sessions may continue |
| Email/SMS provider | Notification | Notification delayed, workflow must not lose state |
| Document generation service | Side effect | Notice generation delayed |
| Malware scanning service | Async validation | Evidence remains quarantined |
| Analytics consumers | Projection | Reporting stale, OLTP unaffected |

### 3.4 Source of Truth

| Data | Source of Truth | Projection |
|---|---|---|
| Case metadata | Aurora PostgreSQL / RDS PostgreSQL | OpenSearch, analytics lake |
| Case state transition | Workflow + case DB transaction | Audit stream, reporting |
| Evidence binary | S3 evidence bucket | Metadata DB, analytics catalog |
| Audit event | append-only audit store/S3 + DB pointer | Search/reporting |
| User/role mapping | enterprise identity + application authorization DB | cache |
| Workflow execution | Step Functions + domain DB | dashboard |

Mental model penting:

```text
Projection boleh stale.
Source of truth harus benar.
Audit harus lengkap.
```

---

## 4. Target Architecture Overview

High-level architecture:

```text
Users / Partners
   |
Route 53
   |
CloudFront + WAF
   |
API Gateway / ALB
   |
ECS Fargate Java API Services
   |
   +-- Aurora PostgreSQL / RDS PostgreSQL  (case metadata, transactional state)
   +-- S3 Evidence Bucket                  (documents, evidence, generated notices)
   +-- SQS                                 (async jobs)
   +-- Step Functions                      (long-running workflow)
   +-- EventBridge                         (domain event routing)
   +-- OpenSearch                          (search projection)
   +-- DynamoDB                            (idempotency / workflow guards / rate state)
   +-- Secrets Manager / Parameter Store / AppConfig
   +-- KMS
   +-- CloudWatch / X-Ray / OpenTelemetry
   +-- CloudTrail / Config / Security Hub / GuardDuty
   +-- Glue / Athena / S3 Data Lake         (analytics projection)
```

Important: diagram ini bukan jawaban final. Ini hanya starting topology. Jawaban final ada pada kontrak, invariant, failure handling, IAM, audit, cost, dan operations.

---

## 5. Account Architecture

### 5.1 Recommended Accounts

Untuk regulated workload, jangan menaruh semua resource dalam satu account.

Minimal:

| Account | Purpose |
|---|---|
| management | AWS Organizations management account, tidak menjalankan workload |
| security-tooling | Security Hub, GuardDuty admin, IAM Access Analyzer, security automation |
| log-archive | CloudTrail organization trail, immutable logs, centralized evidence |
| network | shared networking, Transit Gateway, centralized egress jika diperlukan |
| shared-services | CI/CD, artifact registry, shared observability components |
| dev-workload | development environment |
| staging-workload | staging/pre-prod |
| prod-workload | production workload |
| analytics | analytics lake / BI / non-OLTP consumers |

Untuk tenant yang sangat sensitif:

```text
tenant-silo-prod-account
```

bisa dipertimbangkan.

### 5.2 Account Invariants

1. Management account tidak menjalankan workload.
2. Log archive tidak bisa dimodifikasi oleh workload account.
3. Production role tidak bisa diasumsikan dari developer laptop secara langsung.
4. CI/CD deployment role dibatasi per environment.
5. Security tooling punya read/detect authority lintas account, tetapi write authority harus sangat terbatas.
6. SCP melarang region yang tidak disetujui.
7. SCP melarang public S3 bucket kecuali exception formal.
8. SCP melarang disabling CloudTrail/Config/GuardDuty dari workload account.

### 5.3 Human Access

Human access harus melalui IAM Identity Center / federated identity.

Principle:

```text
Human authenticates through federation.
Workload uses role.
No long-lived access key for production workload.
```

Break-glass role:

- protected by MFA;
- monitored;
- logged;
- rarely used;
- has documented runbook;
- triggers immediate alert.

---

## 6. Network Architecture

### 6.1 VPC Layout

Production VPC:

- 3 Availability Zones jika tersedia;
- public subnets untuk ALB/NAT jika diperlukan;
- private application subnets untuk ECS tasks;
- private data subnets untuk databases;
- isolated subnets untuk workloads yang tidak perlu internet egress;
- VPC endpoints untuk AWS APIs.

Example:

```text
VPC: 10.40.0.0/16

AZ-a:
  public-a: 10.40.0.0/24
  app-a:    10.40.10.0/24
  data-a:   10.40.20.0/24

AZ-b:
  public-b: 10.40.1.0/24
  app-b:    10.40.11.0/24
  data-b:   10.40.21.0/24

AZ-c:
  public-c: 10.40.2.0/24
  app-c:    10.40.12.0/24
  data-c:   10.40.22.0/24
```

### 6.2 Traffic Entry

Recommended baseline:

```text
Route 53 -> CloudFront -> WAF -> ALB or API Gateway -> ECS Fargate
```

Choice:

- Use API Gateway when you need API-level throttling, JWT authorizer, usage plans, request validation, API keys for partners, or Lambda/service integration.
- Use ALB when you primarily expose containerized Java HTTP services with path-based routing and lower API management needs.
- Put CloudFront/WAF in front when edge protection, caching, TLS policy, bot filtering, or global access pattern matters.

### 6.3 Egress

Default stance:

```text
No uncontrolled internet egress from application subnets.
```

Patterns:

- VPC endpoints for S3, DynamoDB, Secrets Manager, SSM, CloudWatch Logs, ECR, STS where relevant.
- NAT Gateway only for unavoidable external dependencies.
- Centralized egress only when organization has enough maturity to operate it safely.

### 6.4 Network Failure Modes

| Failure | Mitigation |
|---|---|
| NAT Gateway failure or cost spike | multi-AZ NAT, endpoint-first design, egress monitoring |
| Security group too broad | SG per service, least privilege inbound/outbound |
| Private DNS mismatch | explicit endpoint DNS testing |
| Cross-AZ dependency latency/cost | topology-aware placement, Multi-AZ DB semantics review |
| ALB health check wrong path | explicit `/health/live` and `/health/ready` separation |
| Subnet IP exhaustion | capacity planning for ECS tasks and endpoints |

---

## 7. Identity and Authorization Architecture

### 7.1 Authentication

Use enterprise IdP or Cognito depending on organization context.

For regulated internal platform:

```text
Enterprise IdP -> SAML/OIDC -> application session/JWT
```

Do not confuse authentication with domain authorization.

Authentication answers:

```text
Who is this user?
```

Authorization answers:

```text
Can this user perform this action on this resource under this tenant and state?
```

### 7.2 Domain Authorization

Domain authorization should not be delegated entirely to API Gateway or IAM.

Example rule:

```text
An investigator can add a finding only if:
- user belongs to the same tenant;
- case is assigned to the user's team or user;
- case status is IN_INVESTIGATION;
- case is not locked by approval workflow;
- user has capability CASE_FINDING_WRITE;
- there is no conflict-of-interest marker.
```

This belongs in application/domain policy layer.

### 7.3 Workload IAM

Each service has its own task role.

Example:

| Service | AWS Permission |
|---|---|
| case-api | read/write Aurora via secret, publish case event, read AppConfig |
| evidence-api | create presigned upload, write evidence metadata, access quarantine bucket |
| evidence-validator | read quarantine object, write validated object, publish validation result |
| workflow-adapter | start/advance Step Functions execution |
| notification-worker | read notification queue, call email provider secret |
| search-indexer | consume events, write OpenSearch documents |

Never use one mega role for all ECS tasks.

### 7.4 IAM Invariants

1. Application role cannot administer IAM.
2. Application role cannot read unrelated tenant KMS keys if tenant silo encryption is used.
3. CI role can deploy only approved stacks.
4. Runtime role cannot mutate infrastructure.
5. Human support role cannot directly query production database unless break-glass procedure is invoked.
6. Read-only audit role cannot modify evidence or audit logs.

---

## 8. Data Architecture

### 8.1 OLTP Store

Use Aurora PostgreSQL or RDS PostgreSQL for core transactional metadata if the case model is relational and strongly consistent.

Core tables:

```text
tenant
user_profile
case
case_assignment
case_transition
case_note
case_finding
evidence_metadata
decision_package
approval
outbox_event
idempotency_record
audit_event_pointer
```

### 8.2 S3 Evidence Store

Buckets:

```text
evidence-quarantine-prod
evidence-validated-prod
evidence-generated-prod
evidence-audit-export-prod
```

Object key example:

```text
tenant_id=<tenant-id>/case_id=<case-id>/evidence_id=<evidence-id>/version=<version>/object
```

Do not rely only on S3 key structure for authorization. Authorization must be enforced before creating presigned URLs and in IAM/bucket/KMS policy where possible.

### 8.3 Evidence Lifecycle

```text
REQUEST_UPLOAD
  -> presigned URL issued
UPLOADED_QUARANTINE
  -> validation queued
VALIDATING
  -> malware/content/metadata checks
VALIDATED
  -> copied/moved to validated bucket
REJECTED
  -> reason recorded
RETAINED
  -> object lock/lifecycle applies
EXPIRED
  -> lifecycle policy after retention if legally allowed
```

### 8.4 Search Projection

OpenSearch is a projection, not the source of truth.

Rules:

1. Search result must include source version.
2. Search index rebuild must be possible from source events/snapshots.
3. Stale search must not authorize access.
4. Search document must not contain unnecessary PII.

### 8.5 Analytics Projection

Data lake zones:

```text
raw
cleaned
curated
analytics
archive
```

Events flow:

```text
Aurora outbox -> event publisher -> EventBridge/Kinesis/Firehose -> S3 raw -> Glue Catalog -> Athena/Redshift
```

Critical distinction:

```text
Domain event is for business meaning.
CDC is for data movement.
```

Do not confuse them.

---

## 9. Workflow Architecture

### 9.1 Why Step Functions

The platform has long-running business processes:

- evidence validation;
- triage;
- assignment;
- investigation SLA escalation;
- approval chain;
- notice generation;
- external notification;
- waiting for human response.

These should not be hidden inside ad-hoc cron jobs or invisible queues.

### 9.2 Workflow vs Domain State

Important boundary:

```text
Workflow tracks orchestration progress.
Domain DB tracks business truth.
```

Step Functions execution state is not a substitute for domain model.

### 9.3 Example Decision Workflow

```text
DraftDecision
  -> ValidateCompleteness
  -> CheckSegregationOfDuty
  -> SubmitForApproval
  -> WaitForApprovalCallback
  -> Choice: Approved?
       -> GenerateNotice
       -> PublishDecisionFinalized
       -> CloseWorkflow
     Else:
       -> ReturnForRevision
```

### 9.4 Workflow Idempotency

Every external side effect must be idempotent:

| Side Effect | Idempotency Key |
|---|---|
| create decision package | caseId + decisionVersion |
| send notification | notificationId |
| generate document | documentRequestId |
| publish event | eventId |
| apply status transition | caseId + expectedVersion + transitionId |

---

## 10. Event Architecture

### 10.1 Domain Events

Examples:

```text
CaseCreated
EvidenceUploadRequested
EvidenceUploaded
EvidenceValidated
CaseAssigned
CaseEscalated
FindingAdded
DecisionSubmitted
DecisionApproved
NoticeGenerated
CaseClosed
```

### 10.2 Event Envelope

```json
{
  "eventId": "uuid",
  "eventType": "CaseAssigned",
  "eventVersion": 1,
  "occurredAt": "2026-06-20T10:15:30Z",
  "tenantId": "tenant-123",
  "actor": {
    "type": "USER",
    "id": "user-456"
  },
  "correlationId": "corr-789",
  "causationId": "cmd-111",
  "source": "case-service",
  "data": {
    "caseId": "case-abc",
    "assigneeId": "user-999"
  }
}
```

### 10.3 Outbox Pattern

For transactional state + event emission:

```text
BEGIN TRANSACTION
  update case
  insert case_transition
  insert audit_event
  insert outbox_event
COMMIT

publisher reads outbox_event -> publishes -> marks published
```

This prevents:

- DB updated but event not published;
- event published but DB rolled back;
- audit missing for transition.

### 10.4 At-Least-Once Reality

Assume:

1. events can duplicate;
2. events can arrive late;
3. consumers can fail after side effect;
4. publisher can retry;
5. projection can drift;
6. replay will happen.

Therefore consumers must be idempotent.

---

## 11. Compute Architecture

### 11.1 Recommended Compute Mix

| Workload | Compute |
|---|---|
| Core Java API | ECS Fargate |
| Async Java workers | ECS Fargate service consuming SQS |
| Small event glue | Lambda |
| Long-running workflow | Step Functions |
| Heavy batch transformation | AWS Batch / Glue / ECS task |
| Analytics ETL | Glue / EMR depending complexity |

### 11.2 Why ECS Fargate for Core Java API

Good fit because:

- Java service is long-running;
- connection pools matter;
- predictable API latency matters;
- container packaging is already common;
- Kubernetes-level control is not required for this capstone;
- operational overhead is lower than EKS.

### 11.3 Java API Runtime Contract

Each service must expose:

```text
GET /health/live
GET /health/ready
GET /version
GET /metrics or OTEL metrics endpoint pattern
```

Readiness should check only dependencies required to serve traffic.

Bad readiness check:

```text
Checks every downstream service, analytics system, email provider, and optional dependency.
```

Good readiness check:

```text
Checks database connectivity and required config validity for core request path.
```

### 11.4 Graceful Shutdown

On SIGTERM:

1. stop accepting new requests;
2. fail readiness;
3. drain in-flight requests;
4. stop polling queues;
5. finish current message or extend visibility timeout if needed;
6. flush logs/traces/metrics;
7. close connections.

---

## 12. API Architecture

### 12.1 API Classes

| API Class | Example | Entry Pattern |
|---|---|---|
| Internal user API | create case, assign case | CloudFront/WAF/API Gateway or ALB |
| Partner API | submit external evidence | API Gateway with throttling and authorizer |
| Admin API | manage config/tenant | private/internal restricted API |
| Async command API | start export, generate report | returns operation ID |
| Webhook receiver | external callback | API Gateway + strict validation + idempotency |

### 12.2 API Contract Rules

1. Every write endpoint accepts idempotency key where retry is expected.
2. Every response includes correlation ID.
3. Error response uses stable machine-readable code.
4. API versioning preserves backward compatibility.
5. Authorization failure does not leak resource existence across tenants.
6. Async operation returns `202 Accepted` with operation tracking.
7. Payload size limits are explicit.
8. Large document upload goes to S3 presigned URL, not through Java API body.

### 12.3 Example Error Response

```json
{
  "errorCode": "CASE_INVALID_STATE_TRANSITION",
  "message": "The requested transition is not allowed for the current case state.",
  "correlationId": "corr-789",
  "details": {
    "currentState": "UNDER_REVIEW",
    "requestedTransition": "ASSIGN_INVESTIGATOR"
  }
}
```

For security-sensitive errors, omit details.

---

## 13. Security Architecture

### 13.1 Security Layers

```text
Identity
  -> Network
    -> Workload IAM
      -> Domain authorization
        -> Data policy
          -> KMS
            -> Audit
```

No single layer is enough.

### 13.2 Encryption

At rest:

- S3 SSE-KMS;
- RDS/Aurora encryption;
- EBS encryption;
- OpenSearch encryption;
- SQS/SNS/EventBridge where applicable;
- Secrets Manager encryption.

In transit:

- TLS at edge;
- TLS from load balancer to target if required by policy;
- TLS to database;
- TLS for AWS API calls.

### 13.3 KMS Key Strategy

Baseline:

| Data Class | KMS Strategy |
|---|---|
| general app data | environment-level CMK |
| evidence | dedicated evidence CMK |
| audit logs | dedicated audit/log CMK in log archive/security boundary |
| tenant-sensitive data | tenant-tier or tenant-specific CMK for high-risk tenants |
| secrets | Secrets Manager CMK or service-managed depending policy |

Do not create tenant-specific KMS keys unless you need the isolation/audit benefit. Too many keys increase operational burden.

### 13.4 Data Protection

Controls:

1. S3 Block Public Access.
2. Bucket policy requiring TLS.
3. Bucket policy requiring specific KMS key.
4. Object Lock for immutable evidence/audit where legally required.
5. Macie for sensitive data discovery if applicable.
6. CloudTrail data events for sensitive buckets.
7. Least privilege presigned URL generation.
8. Short TTL for upload/download URLs.
9. Malware/content validation before evidence becomes accepted.

### 13.5 Threat Model Highlights

| Threat | Control |
|---|---|
| Tenant data leak | tenant context validation, ABAC, DB constraints, test suite |
| Stolen credential | temporary credentials, no long-lived keys, IAM least privilege |
| Public S3 exposure | SCP, bucket policy, Block Public Access, Config rule |
| Insider data access | break-glass workflow, CloudTrail, query audit, least privilege |
| Prompt injection in AI assistant | guardrails, retrieval filtering, output validation, no autonomous state change |
| Replay attack | idempotency key, nonce/timestamp for webhook, signature verification |
| Confused deputy | external ID/source ARN/source account conditions |
| Log data leakage | logging allowlist, secret redaction, PII minimization |

---

## 14. Observability Architecture

### 14.1 Observability Goals

The system must answer:

1. Is the platform healthy?
2. Which tenant is affected?
3. Which user journey is degraded?
4. Which dependency is failing?
5. Was data lost?
6. Is audit complete?
7. Is cost abnormal?
8. Did deployment cause regression?

### 14.2 Signals

Logs:

- structured JSON;
- correlation ID;
- tenant ID hashed or controlled;
- actor ID if allowed;
- case ID where appropriate;
- event ID;
- workflow execution ID.

Metrics:

- API latency p50/p95/p99;
- error rate by endpoint;
- queue depth;
- message age;
- workflow failures;
- DB connection pool usage;
- idempotency conflict count;
- audit event write failure count;
- tenant throttling count;
- evidence validation duration;
- search indexing lag;
- cost/unit metrics.

Traces:

- request path across API -> DB -> event publisher;
- workflow-triggered tasks;
- AWS SDK calls where useful;
- external provider calls.

### 14.3 Alarm Classes

| Alarm | Page? |
|---|---|
| Core API 5xx high | yes |
| DB unavailable | yes |
| audit event write failure | yes |
| evidence validation DLQ > 0 sustained | yes |
| search lag high | maybe, depending SLA |
| analytics delay | no, ticket unless critical reporting window |
| cost anomaly | no immediate page, but fast review |
| single canary failure | depends on severity |

### 14.4 Runbook Format

Every page-worthy alarm must have:

```text
Alarm name:
Impact:
Possible causes:
Immediate checks:
Safe mitigations:
Commands/dashboards:
Escalation:
Rollback criteria:
Post-incident evidence:
```

---

## 15. Reliability Architecture

### 15.1 Failure Domain Strategy

| Layer | Strategy |
|---|---|
| API service | ECS service across multiple AZs |
| Load balancing | ALB across multiple AZs |
| Database | Multi-AZ RDS/Aurora |
| Evidence | S3 regional durability, optional CRR for DR |
| Queue | SQS managed regional service |
| Workflow | Step Functions managed regional service |
| Search | Multi-AZ OpenSearch domain if required |
| Analytics | asynchronous, can lag |

### 15.2 RTO/RPO Mapping

| Capability | RTO | RPO | Strategy |
|---|---:|---:|---|
| Case read/write | 4h | 15m | Multi-AZ + backup/PITR + warm standby option |
| Evidence retrieval | 4h | near-zero if replicated | S3 versioning + replication/object lock |
| Audit trail | 4h | near-zero target | append-only, replicated logs, outbox |
| Search | 8h | rebuild allowed | rebuild from source |
| Analytics | 24h | hours acceptable | replay from S3/events |
| Notification | 24h | no lost notification intent | queue + retry + DLQ |

### 15.3 Graceful Degradation

If OpenSearch fails:

- disable advanced search;
- allow direct case lookup by ID from OLTP;
- show degraded banner;
- keep case write path available.

If notification provider fails:

- persist notification intent;
- retry later;
- show notification delayed state;
- do not roll back case state if notification is non-blocking.

If analytics pipeline fails:

- preserve raw events;
- delay reports;
- do not affect OLTP.

If document generation fails:

- keep decision approved;
- mark notice generation pending;
- retry;
- allow manual fallback if required.

### 15.4 Disaster Recovery Strategy

Baseline:

- Multi-AZ for local resilience.
- Automated backups and PITR for databases.
- S3 versioning and replication for critical buckets.
- IaC can recreate infrastructure.
- Runbooks for restore.
- Regular restore tests.

For stricter requirement:

- warm standby in second Region;
- replicated data stores where service supports it;
- Route 53 failover or controlled DNS cutover;
- tested promotion procedure.

AWS DR guidance commonly categorizes strategies such as backup and restore, pilot light, warm standby, and multi-site active/active. The right choice must be driven by RTO/RPO, cost, and operational maturity, not prestige.

---

## 16. Performance Architecture

### 16.1 Latency Budget Example

For `GET /cases/{caseId}` target p95 < 300ms:

| Segment | Budget |
|---|---:|
| edge/load balancer | 20ms |
| auth/session validation | 30ms |
| app logic | 50ms |
| DB query | 100ms |
| serialization | 30ms |
| network overhead | 40ms |
| buffer | 30ms |

If a single endpoint calls five downstream services synchronously, this budget will fail.

### 16.2 Scaling Strategy

| Component | Scaling Signal |
|---|---|
| API service | CPU, memory, request count per target, p95 latency |
| Worker service | queue depth, oldest message age |
| DB | connection count, CPU, read/write IOPS, lock wait |
| Search | indexing lag, CPU, heap pressure |
| Lambda glue | concurrency, throttles, duration |
| Workflow | execution failure, throttling, transition rate |

### 16.3 Java Performance Controls

1. Use bounded connection pools.
2. Set explicit timeouts for all HTTP/AWS SDK/DB calls.
3. Avoid unbounded async executor queues.
4. Tune heap relative to container memory.
5. Handle SIGTERM correctly.
6. Avoid chatty AWS API calls in hot path.
7. Cache config/secrets safely with TTL.
8. Avoid loading large S3 objects fully into memory.
9. Use streaming for file transfer.
10. Protect against retry storm.

---

## 17. Cost Architecture

### 17.1 Unit Economics

Define units:

```text
cost_per_active_case
cost_per_closed_case
cost_per_evidence_gb_month
cost_per_1000_api_requests
cost_per_workflow_execution
cost_per_search_query
cost_per_report_run
cost_per_tenant_month
```

Without unit economics, cost optimization becomes random.

### 17.2 Major Cost Drivers

| Driver | Control |
|---|---|
| ECS/Fargate compute | right-size CPU/memory, autoscaling, Graviton if possible |
| NAT Gateway | VPC endpoints, egress review |
| CloudWatch logs | log sampling, retention, structured fields, avoid debug in prod |
| OpenSearch | index lifecycle, shard sizing, avoid storing unnecessary fields |
| RDS/Aurora | right-size, read replicas only when needed, connection pooling |
| S3 | lifecycle, storage class, delete incomplete multipart upload |
| Step Functions | workflow type choice, state transition optimization |
| Lambda | memory tuning, timeout, avoid retry loops |
| Data transfer | avoid cross-AZ chatter, inspect architecture path |

### 17.3 Cost Guardrails

1. Budgets per account/environment.
2. Cost anomaly detection.
3. Mandatory tags.
4. Non-prod schedules.
5. Log retention defaults.
6. Service quota reviews.
7. Cost review for every architecture decision.
8. Unit cost dashboard.
9. Tenant cost allocation.
10. Cleanup automation for ephemeral resources.

---

## 18. Infrastructure as Code and Deployment

### 18.1 IaC Stack Boundaries

Recommended split:

```text
org-baseline
security-baseline
network-baseline
shared-observability
prod-data
prod-app-platform
prod-services
prod-analytics
```

Avoid one giant stack that replaces critical resources accidentally.

### 18.2 Deployment Pipeline

```text
commit
  -> build
  -> unit test
  -> static analysis
  -> container image build
  -> vulnerability scan
  -> publish immutable artifact
  -> deploy dev
  -> integration test
  -> deploy staging
  -> migration compatibility test
  -> approval gate
  -> deploy prod canary/rolling/blue-green
  -> automated verification
  -> promote or rollback
```

### 18.3 Database Migration

Use expand-and-contract:

1. add new nullable column/table;
2. deploy app that writes both if needed;
3. backfill;
4. read from new model;
5. stop writing old model;
6. remove old column/table later.

Never couple irreversible migration with risky application deployment without rollback plan.

### 18.4 Deployment Invariants

1. Artifact is immutable.
2. Same artifact is promoted across environments.
3. Config changes are versioned.
4. DB migrations are backward compatible for at least one deployment window.
5. Rollback path is known.
6. Deployment emits release metadata.
7. Alarms are watched during rollout.
8. Failed deployment does not delete data.

---

## 19. Build Plan

A practical build sequence:

### Phase 1 — Foundation

Deliver:

- AWS Organizations/OUs/accounts;
- CloudTrail organization trail;
- AWS Config baseline;
- Security Hub/GuardDuty;
- IAM Identity Center;
- baseline SCPs;
- log archive bucket;
- KMS baseline.

Exit criteria:

- account access is federated;
- logs are centralized;
- production account has guardrails;
- no workload yet.

### Phase 2 — Network and Platform

Deliver:

- prod VPC;
- subnets across AZs;
- endpoints;
- ALB/API Gateway baseline;
- WAF baseline;
- ECS cluster/Fargate baseline;
- ECR;
- CloudWatch logs/metrics/traces baseline.

Exit criteria:

- hello-world Java service deployed privately;
- health check works;
- logs/traces visible;
- no public unmanaged exposure.

### Phase 3 — Core Case API

Deliver:

- Aurora/RDS schema;
- case-service;
- tenant context;
- domain authorization;
- audit event write;
- outbox event;
- basic API contract.

Exit criteria:

- create/read/update case works;
- audit event exists for transitions;
- tenant isolation tests pass.

### Phase 4 — Evidence Pipeline

Deliver:

- S3 buckets;
- presigned upload;
- quarantine state;
- validation worker;
- SQS DLQ;
- object metadata;
- evidence lifecycle.

Exit criteria:

- document upload does not pass through API memory;
- invalid document rejected;
- duplicate event safe;
- evidence cannot be accessed cross-tenant.

### Phase 5 — Workflow

Deliver:

- Step Functions decision workflow;
- callback approval;
- escalation timers;
- compensation logic;
- workflow dashboard.

Exit criteria:

- workflow can resume after worker failure;
- retry does not duplicate side effects;
- stuck workflow alarm works.

### Phase 6 — Search and Analytics

Deliver:

- OpenSearch projection;
- indexer;
- data lake raw zone;
- Glue catalog;
- Athena queries;
- reporting projection.

Exit criteria:

- projection rebuild procedure exists;
- search stale state is visible;
- analytics failure does not block OLTP.

### Phase 7 — DR and Game Day

Deliver:

- backup policies;
- restore runbook;
- failover simulation;
- DLQ replay runbook;
- chaos tests;
- incident response template.

Exit criteria:

- restore test completed;
- RTO/RPO evidence captured;
- failure-mode inventory updated.

---

## 20. Operate Plan

### 20.1 Daily Operations

Check:

- alarm state;
- DLQ depth;
- queue age;
- workflow failures;
- deployment status;
- security findings;
- cost anomaly;
- backup status;
- failed audit writes;
- tenant throttling.

### 20.2 Weekly Operations

Review:

- top errors;
- slow endpoints;
- expensive tenants;
- unused resources;
- access changes;
- failed login patterns;
- stale config;
- open security findings;
- incident trends.

### 20.3 Monthly Operations

Perform:

- restore test;
- access review;
- cost review;
- dependency review;
- DR readiness review;
- Well-Architected improvement item review;
- runbook update;
- game day planning.

### 20.4 Quarterly Operations

Perform:

- architecture review;
- threat model refresh;
- tenant isolation test;
- chaos experiment;
- DR exercise;
- compliance evidence package review;
- capacity planning;
- platform roadmap review.

---

## 21. Break Plan: Failure Injection Scenarios

A system is not production-ready until you know how it fails.

### 21.1 Scenario: DB Primary Failover

Inject:

- trigger failover in staging;
- observe API behavior;
- validate connection pool recovery.

Expected:

- temporary error spike;
- retry only safe operations;
- no duplicate transitions;
- readiness may fail briefly;
- service recovers without restart if possible.

Evidence:

- timeline;
- p95 latency;
- error rate;
- audit completeness;
- customer-visible impact;
- remediation action.

### 21.2 Scenario: OpenSearch Unavailable

Expected:

- advanced search disabled/degraded;
- case lookup by ID works;
- indexer retries safely;
- no data loss;
- backlog visible.

### 21.3 Scenario: SQS Poison Message

Expected:

- message retries up to threshold;
- moves to DLQ;
- alarm fires;
- runbook identifies payload and failure reason;
- replay after fix is idempotent.

### 21.4 Scenario: Evidence Validator Down

Expected:

- uploaded evidence remains quarantined;
- case workflow waits or marks pending;
- no invalid evidence becomes accepted;
- queue age alarm fires.

### 21.5 Scenario: Bad Deployment

Expected:

- canary/rolling detects issue;
- rollback or forward fix executed;
- DB migration compatibility preserved;
- old version can still read/write safely.

### 21.6 Scenario: Tenant Flood

Expected:

- tenant-specific rate limiting activates;
- other tenants remain healthy;
- noisy tenant visible in dashboard;
- cost impact attributable.

### 21.7 Scenario: Missing KMS Permission

Expected:

- affected operation fails explicitly;
- alarm or structured error indicates KMS access issue;
- no fallback to unencrypted storage;
- runbook checks key policy, IAM policy, grants, SCP, endpoint policy.

### 21.8 Scenario: Region-Level DR Exercise

Expected:

- declared recovery procedure starts;
- backup/replication status verified;
- infrastructure recreated/promoted;
- DNS or traffic route adjusted;
- RTO/RPO measured;
- gaps recorded.

---

## 22. Defend Plan: Architecture Review Against Six Pillars

### 22.1 Operational Excellence

Questions:

1. Are operations defined as code?
2. Are deployments small and reversible?
3. Do alarms have runbooks?
4. Are incidents reviewed?
5. Are game days performed?
6. Is workload ownership clear?

Evidence:

- IaC repositories;
- runbooks;
- deployment history;
- incident reports;
- dashboard links;
- operational readiness checklist.

### 22.2 Security

Questions:

1. Are human and workload identities separated?
2. Is least privilege enforced?
3. Is tenant isolation tested?
4. Are logs and evidence protected?
5. Are secrets rotated and never logged?
6. Are detective controls active?

Evidence:

- IAM policies;
- CloudTrail events;
- Config compliance;
- Security Hub findings;
- access review records;
- tenant isolation tests;
- KMS key policies.

### 22.3 Reliability

Questions:

1. What are RTO/RPO per capability?
2. What happens when AZ fails?
3. What happens when DB fails over?
4. Are backups restored regularly?
5. Are DLQs monitored?
6. Are retries bounded and idempotent?

Evidence:

- restore test result;
- chaos/game day report;
- DLQ dashboard;
- RTO/RPO measurement;
- failure-mode catalog;
- idempotency design.

### 22.4 Performance Efficiency

Questions:

1. Is there a latency budget?
2. Are scaling signals correct?
3. Are hot paths bounded?
4. Are connection pools sized?
5. Are caches correct and observable?
6. Are p95/p99 tracked per journey?

Evidence:

- load test result;
- latency dashboard;
- scaling policy;
- JVM metrics;
- database performance metrics;
- cache metrics.

### 22.5 Cost Optimization

Questions:

1. Is cost measured per business unit?
2. Are tags enforced?
3. Are expensive services justified?
4. Are logs retained appropriately?
5. Is data transfer understood?
6. Are non-prod costs controlled?

Evidence:

- Cost Explorer/CUR reports;
- budget alerts;
- unit cost dashboard;
- tagging compliance;
- cost ADRs;
- rightsizing actions.

### 22.6 Sustainability

Questions:

1. Are resources right-sized?
2. Are idle environments reduced?
3. Is data lifecycle managed?
4. Are inefficient polling loops avoided?
5. Are compute architectures efficient for actual demand?
6. Are storage classes and retention policies used?

Evidence:

- utilization metrics;
- lifecycle policies;
- autoscaling policies;
- non-prod scheduling;
- stale resource cleanup;
- storage class reports.

---

## 23. Architecture Decision Records

### 23.1 ADR Template

```markdown
# ADR-XXX: <Decision Title>

## Status
Proposed | Accepted | Superseded | Deprecated

## Context
What problem are we solving?
What business capability is affected?
What constraints exist?

## Decision
What did we choose?

## Alternatives Considered
1. Option A
2. Option B
3. Option C

## Consequences
Positive:
- ...

Negative:
- ...

Operational impact:
- ...

Security impact:
- ...

Cost impact:
- ...

Failure modes:
- ...

## Invariants
- ...

## Validation
How do we know this decision works?

## Review Date
YYYY-MM-DD
```

### 23.2 Example ADRs for Capstone

Required ADRs:

1. Choose ECS Fargate for core Java APIs.
2. Choose Aurora/RDS PostgreSQL for case metadata.
3. Choose S3 with Object Lock for evidence.
4. Choose Step Functions for long-running approval workflow.
5. Choose outbox pattern for domain event publishing.
6. Choose OpenSearch as search projection.
7. Choose Glue/Athena for analytics projection.
8. Choose KMS key strategy.
9. Choose tenant isolation model.
10. Choose DR strategy.
11. Choose deployment strategy.
12. Choose API entry pattern.

---

## 24. Production Readiness Checklist

### 24.1 Architecture

- [ ] Workload boundary documented.
- [ ] Business capabilities mapped.
- [ ] Source of truth identified.
- [ ] Projections identified.
- [ ] Critical invariants documented.
- [ ] Dependency graph documented.
- [ ] Failure-mode inventory created.
- [ ] ADRs written.

### 24.2 Security

- [ ] Federated human access.
- [ ] No long-lived production access keys.
- [ ] Runtime IAM roles per service.
- [ ] KMS key policies reviewed.
- [ ] S3 public access blocked.
- [ ] Secret access least privilege.
- [ ] Tenant isolation tests pass.
- [ ] CloudTrail organization trail enabled.
- [ ] GuardDuty/Security Hub enabled.
- [ ] Break-glass process tested.

### 24.3 Reliability

- [ ] Multi-AZ deployment.
- [ ] Backup policy configured.
- [ ] Restore tested.
- [ ] DLQ configured and alarmed.
- [ ] Retry strategy bounded.
- [ ] Idempotency implemented.
- [ ] Graceful shutdown tested.
- [ ] RTO/RPO documented.
- [ ] DR runbook tested.

### 24.4 Observability

- [ ] Structured logs.
- [ ] Correlation ID propagated.
- [ ] Metrics dashboard.
- [ ] Tracing enabled for critical paths.
- [ ] Page-worthy alarms have runbooks.
- [ ] Audit write failures alarmed.
- [ ] Queue age alarmed.
- [ ] Workflow failures alarmed.
- [ ] Cost anomaly monitored.

### 24.5 Deployment

- [ ] Immutable artifact.
- [ ] Build once, promote same artifact.
- [ ] Deployment strategy documented.
- [ ] Rollback tested.
- [ ] DB migration backward compatible.
- [ ] Config versioned.
- [ ] Production deployment emits release metadata.

### 24.6 Cost

- [ ] Cost allocation tags active.
- [ ] Budget alerts active.
- [ ] Unit cost dashboard defined.
- [ ] NAT Gateway usage reviewed.
- [ ] Log retention configured.
- [ ] S3 lifecycle configured.
- [ ] Non-prod cost controls active.

---

## 25. Practical Implementation Skeleton

This is not full code, but a structural map.

### 25.1 Java Service Modules

```text
case-platform/
  case-api/
  case-domain/
  case-application/
  case-infrastructure/
  evidence-api/
  evidence-worker/
  workflow-adapter/
  notification-worker/
  search-indexer/
  audit-library/
  tenant-context-library/
  idempotency-library/
  platform-observability-library/
```

### 25.2 Service Responsibilities

`case-domain`:

- state machine rules;
- invariant enforcement;
- domain events;
- authorization checks at domain boundary.

`case-application`:

- transaction orchestration;
- outbox write;
- idempotency;
- audit event creation.

`case-infrastructure`:

- repositories;
- AWS SDK clients;
- database adapters;
- event publisher;
- config loader.

`audit-library`:

- audit event envelope;
- actor context;
- correlation context;
- append-only write contract.

`tenant-context-library`:

- tenant resolution;
- tenant validation;
- tenant propagation;
- tenant-safe logging helpers.

### 25.3 Command Handler Shape

```java
public CaseResult handle(CreateCaseCommand command, RequestContext context) {
    // 1. Validate idempotency key
    // 2. Resolve tenant context
    // 3. Authorize domain capability
    // 4. Start DB transaction
    // 5. Create aggregate/change state
    // 6. Insert audit event
    // 7. Insert outbox event
    // 8. Commit transaction
    // 9. Return stable response
}
```

Critical rule:

```text
Do not publish external event before transaction commits.
Do not mutate domain state without audit event.
```

---

## 26. Maturity Model

### Level 1 — Service User

Can:

- launch services;
- deploy simple app;
- use console;
- follow tutorials.

Risk:

- weak IAM;
- unclear network;
- manual operations;
- no failure model.

### Level 2 — Production Implementer

Can:

- deploy Java service with ECS/Lambda/EC2;
- configure IAM role;
- use RDS/S3/SQS;
- set logs and alarms.

Risk:

- incomplete DR;
- weak cost model;
- shallow security review.

### Level 3 — Senior Cloud Engineer

Can:

- design multi-account environment;
- reason about failure domains;
- implement least privilege;
- operate IaC pipeline;
- design observability;
- perform restore tests;
- control cost.

Risk:

- may still under-model organizational governance or tenant isolation.

### Level 4 — Staff-Level AWS Engineer

Can:

- connect business risk to architecture;
- define workload invariants;
- lead architecture review;
- design for auditability;
- evaluate trade-offs across all six pillars;
- simplify platform choices;
- make systems operable by teams;
- drive improvement plan.

### Level 5 — Principal / Platform Architect

Can:

- design organizational AWS operating model;
- set golden paths;
- create guardrails without blocking teams;
- manage multi-account governance;
- quantify risk/cost/reliability trade-offs;
- mentor teams through migration and modernization;
- evolve architecture over years.

---

## 27. Final Mental Models

### 27.1 AWS Is Not a List of Services

AWS is:

```text
APIs + identities + policies + networks + managed control planes + failure domains + cost meters
```

A good engineer asks:

```text
What contract does this service provide?
What does AWS own?
What do we still own?
What fails?
How do we know?
How do we recover?
How do we prove it?
```

### 27.2 Managed Does Not Mean Risk-Free

Managed means AWS takes some operational responsibility.

It does not remove your responsibility for:

- data model;
- access control;
- retry behavior;
- quotas;
- cost;
- backup validation;
- domain correctness;
- audit trail;
- incident response;
- deployment safety.

### 27.3 Architecture Is a Set of Reversible and Irreversible Bets

Some choices are easy to change:

- ECS service CPU/memory;
- log retention;
- autoscaling threshold;
- dashboard layout;
- feature flag value.

Some choices are harder:

- account boundary;
- tenant isolation model;
- primary database;
- event contract;
- KMS key structure;
- data retention policy;
- API contract;
- workflow state model.

Spend more review effort on irreversible choices.

### 27.4 Source of Truth Must Be Explicit

If every system is source of truth, no system is source of truth.

For every entity, know:

```text
Where is truth?
Where are projections?
How do projections rebuild?
How is access enforced?
How is change audited?
```

### 27.5 Failure Is a Design Input

Do not ask:

```text
Will this fail?
```

Ask:

```text
When it fails, what happens to user, data, money, audit, and recovery?
```

---

## 28. Capstone Exercises

### Exercise 1 — Draw the Architecture

Draw:

1. account layout;
2. VPC layout;
3. API request path;
4. evidence upload path;
5. workflow path;
6. event path;
7. audit path;
8. analytics path;
9. DR path.

For each arrow, write:

```text
protocol
identity
permission
failure mode
observability signal
```

### Exercise 2 — Write 10 ADRs

Write ADRs for:

1. compute selection;
2. database selection;
3. tenant isolation;
4. evidence storage;
5. workflow orchestration;
6. event publishing;
7. search projection;
8. analytics projection;
9. DR strategy;
10. deployment strategy.

### Exercise 3 — Build the Failure-Mode Inventory

For each component:

- how can it fail?
- who notices?
- what alarm fires?
- what data is at risk?
- what is the mitigation?
- what is the runbook?
- how do we test recovery?

### Exercise 4 — Design Tenant Isolation Tests

Test:

1. tenant A cannot read tenant B case;
2. tenant A cannot access tenant B S3 object;
3. tenant A search does not show tenant B result;
4. tenant A analytics export is filtered;
5. tenant A admin cannot assume tenant B role;
6. malformed tenant context is rejected;
7. missing tenant context is rejected.

### Exercise 5 — Run a Game Day

Simulate:

1. DB failover;
2. OpenSearch down;
3. validator worker down;
4. DLQ poison message;
5. bad deployment;
6. KMS permission error;
7. tenant flood;
8. backup restore.

Document:

- actual result;
- expected result;
- gap;
- improvement item;
- owner;
- due date.

---

## 29. Suggested Final Deliverables

A top-tier capstone output should include:

```text
01-workload-context.md
02-requirements.md
03-architecture-diagram.md
04-account-architecture.md
05-network-architecture.md
06-iam-model.md
07-data-architecture.md
08-event-workflow-architecture.md
09-security-model.md
10-observability-model.md
11-reliability-dr-plan.md
12-cost-model.md
13-deployment-plan.md
14-runbooks.md
15-failure-mode-inventory.md
16-adr-index.md
17-well-architected-review.md
18-improvement-plan.md
```

If these documents exist and are kept current, architecture becomes operationally useful.

If they do not exist, architecture is mostly tribal knowledge.

---

## 30. Improvement Plan Template

```markdown
# Improvement Plan

## Workload
regulated-case-management-core

## Review Date
YYYY-MM-DD

## High-Risk Issues

| ID | Pillar | Issue | Impact | Mitigation | Owner | Due Date | Status |
|---|---|---|---|---|---|---|---|
| HRI-001 | Reliability | Restore not tested | RTO/RPO unproven | Run restore test | platform | YYYY-MM-DD | Open |
| HRI-002 | Security | Tenant isolation tests incomplete | Data leak risk | Build automated tests | app-sec | YYYY-MM-DD | Open |
| HRI-003 | Cost | No unit cost dashboard | Cost blind spot | Build CUR/Athena dashboard | finops | YYYY-MM-DD | Open |

## Medium-Risk Issues
...

## Accepted Risks
...

## Next Review
YYYY-MM-DD
```

AWS Well-Architected review should not end at “we reviewed it.” The value is the improvement plan and follow-through.

---

## 31. What Mastery Looks Like After This Series

After completing this series, you should be able to:

1. Explain AWS as a programmable distributed platform.
2. Design multi-account architecture with clear blast-radius boundaries.
3. Model IAM authorization across identity policy, resource policy, SCP, boundary, session policy, endpoint policy, and KMS key policy.
4. Build Java services that use AWS SDK safely with timeout, retry, idempotency, pagination, and credential refresh.
5. Design VPC/networking with explicit reachability and egress control.
6. Choose compute based on workload semantics.
7. Use S3/RDS/DynamoDB/SQS/SNS/EventBridge/Step Functions intentionally.
8. Build audit-friendly workflows.
9. Separate source of truth from projections.
10. Design observability around user journeys and failure modes.
11. Define RTO/RPO and test restore.
12. Build deployment systems with rollback and migration safety.
13. Control cost using unit economics.
14. Evaluate architecture with Well-Architected pillars.
15. Defend design decisions using ADRs, evidence, and operational data.

That is the difference between “knows AWS services” and “can own production architecture on AWS.”

---

## 32. Closing

This capstone intentionally does not teach a new AWS service. It teaches how to combine services into a workload that can survive reality.

The final standard is not:

```text
Can the system run?
```

The final standard is:

```text
Can the system run, fail, recover, explain itself, control cost, protect data, and evolve safely?
```

When you can answer that with evidence, you are operating at a much higher level than service familiarity.

---

# End of Series

This is the final part of:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers
```

The AWS series is now complete.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-034.md">⬅️ Part 034 — AWS Architecture Review Method: How Top Engineers Evaluate Designs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
