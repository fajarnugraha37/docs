# learn-java-eclipse-glassfish-runtime-server-engineering-part-033  
# Part 33 — Case Study: Building a Production-Grade GlassFish Runtime from Zero

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 33 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang ingin menyatukan seluruh konsep GlassFish runtime engineering menjadi desain produksi nyata  
> Fokus part ini: **case study end-to-end membangun runtime GlassFish production-grade dari nol**: requirement, topology, security, domain/config, resources, deployment, observability, HA, performance baseline, incident runbook, dan go-live checklist

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. menerjemahkan requirement bisnis/operasional menjadi runtime architecture GlassFish;
2. mendesain topology production-grade dari nol;
3. memilih deployment model:
   - VM/traditional domain;
   - container/Kubernetes;
   - hybrid;
4. membuat domain/config baseline:
   - JVM options;
   - listeners;
   - thread pools;
   - JDBC resources;
   - JMS resources;
   - security realms;
   - logging;
   - monitoring;
5. menyusun resource pool sizing awal;
6. mengamankan admin/control plane;
7. mendesain CI/CD dan release flow;
8. mendesain observability dashboard dan alert;
9. menyusun failure mode dan runbook;
10. melakukan go-live readiness review.

Part ini adalah integrasi seluruh part sebelumnya. Formatnya bukan teori lepas, tetapi **case study berurutan**.

---

## 1. Scenario

Kita akan membangun runtime production-grade untuk aplikasi:

```text
Nama sistem:
  GovCase Platform

Jenis:
  Regulatory case management platform

Pengguna:
  - Public applicant portal
  - Internal officer portal
  - Supervisor/approver
  - Batch operator
  - System integration users

Core capabilities:
  - submit application
  - review case
  - approve/reject
  - upload/download documents
  - audit trail
  - notifications
  - external address lookup
  - daily reconciliation
  - report export

Runtime target:
  GlassFish 8
  Java 21
  Jakarta EE 11

Architecture target:
  production-grade
  high availability
  rolling deployment
  auditable release
  secure admin
  observable operations
```

External dependencies:

```text
Oracle/PostgreSQL DB
JMS broker
OIDC identity provider
External address API with 300 requests/minute limit
Object/document storage
SMTP/email gateway
Central logging
Metrics/alerting platform
```

---

## 2. Non-Functional Requirements

### Availability

```text
Business hours availability target: 99.9%
One app instance failure must not take service down.
Rolling deployment should not require full outage.
```

### Performance

```text
p95 for normal page/API: < 500ms
p95 for search: < 2s
Report export: async, not request-thread synchronous
Address lookup: p95 < 1.5s including cache
```

### Security

```text
Admin port not public.
Admin Console disabled or internal-only.
OIDC for users.
Role-based authorization.
Audit trail for business actions.
No cleartext secrets in domain.xml.
TLS terminated at proxy; backend private network.
```

### Operability

```text
All instances expose readiness/liveness.
Logs centralized.
Metrics dashboard exists.
Thread/heap dump runbook exists.
CI/CD deploys same artifact across environments.
Rollback plan defined.
```

### Compliance

```text
Release evidence archived.
DB migration reviewed.
Audit trail immutable enough for business requirement.
Access to logs/dumps restricted.
```

---

## 3. Architecture Decision: VM or Kubernetes?

We consider two deployment models.

### Option A — Traditional VM GlassFish Cluster

```text
DAS
 |
 +-- web-cluster
 |     +-- instance web-1
 |     +-- instance web-2
 |
 +-- worker-cluster
       +-- instance worker-1
       +-- instance worker-2
```

Pros:

- familiar GlassFish model;
- `asadmin` cluster targeting;
- strong app server semantics;
- easier if organization already operates app servers.

Cons:

- mutable server risk;
- more manual server lifecycle;
- config drift risk;
- scaling slower.

### Option B — Kubernetes Deployment

```text
Ingress/LB
 |
 +-- Deployment govcase-web replicas=4
 +-- Deployment govcase-worker replicas=2
```

Pros:

- immutable deployment;
- rolling rollout;
- pod replacement;
- platform health/routing;
- better cloud-native ops.

Cons:

- GlassFish domain mutability must be controlled;
- app server clustering model overlaps with Kubernetes;
- session/state must be externalized/minimized.

### Decision for Case Study

We choose:

```text
Kubernetes-style architecture
one GlassFish instance per pod
separate web and worker deployments
state externalized
```

Why:

- better rolling deployment;
- clean web/worker split;
- avoids mutable cluster operations;
- aligns with production-grade modern ops.

But we keep notes for VM equivalent.

---

## 4. High-Level Topology

```text
                         +----------------------+
                         | OIDC Identity Provider|
                         +-----------+----------+
                                     |
                                     v
+-----------+        +-----------------------------+
| Users     +------->| WAF / Ingress / Reverse LB  |
+-----------+        | TLS / routing / rate limit  |
                     +--------------+--------------+
                                    |
                                    v
                     +-----------------------------+
                     | Kubernetes Service govcase  |
                     +--------------+--------------+
                                    |
              +---------------------+---------------------+
              |                                           |
              v                                           v
+-----------------------------+             +-----------------------------+
| GlassFish Web Pod 1..4      |             | GlassFish Worker Pod 1..2   |
| - public/internal APIs      |             | - JMS consumers             |
| - UI/backend                |             | - outbox processing         |
| - auth/session              |             | - reports/reconciliation    |
+-------------+---------------+             +--------------+--------------+
              |                                            |
              +--------------------+-----------------------+
                                   |
        +--------------------------+---------------------------+
        |                          |                           |
        v                          v                           v
+---------------+          +---------------+           +----------------+
| DB            |          | JMS Broker     |           | Object Storage |
| OLTP + audit  |          | async queues   |           | documents      |
+---------------+          +---------------+           +----------------+
        |
        v
+----------------+
| Central Logs   |
| Metrics Alerts |
+----------------+
```

---

## 5. Runtime Separation: Web vs Worker

### Web Deployment

Responsibilities:

```text
- serve user-facing HTTP/API
- authenticate/authorize
- validate commands
- persist transactional state
- write outbox events
- enqueue async work
- read document metadata
- serve download link/proxy if needed
```

Does not:

```text
- generate large reports synchronously
- perform long reconciliation
- perform unbounded external API retries
- consume heavy JMS workloads
```

### Worker Deployment

Responsibilities:

```text
- consume JMS/outbox events
- call external APIs with rate limit
- generate reports
- send email
- reconcile data
- retry failed integration
```

Benefit:

```text
A slow external API does not consume all web HTTP threads.
Report generation does not starve user requests.
```

---

## 6. Application Packaging

Option:

```text
govcase-web.war
govcase-worker.jar/war/ear
```

If using EAR:

```text
govcase.ear
  |
  |-- govcase-web.war
  |-- govcase-api.war
  |-- govcase-services.jar
  |-- govcase-worker-ejb.jar
  |-- govcase-domain.jar
  |-- govcase-integration.jar
```

For Kubernetes web/worker split, two image variants are cleaner:

```text
govcase-web-glassfish:1.0.0
govcase-worker-glassfish:1.0.0
```

They may share same codebase but enable different modules/features.

---

## 7. Domain Baseline

Each pod has:

```text
GlassFish 8
Java 21
domain1 baseline
application deployed/baked
runtime config injected
```

Domain baseline includes:

```text
HTTP listener 8080
admin listener internal only/not exposed
JVM options
logging config
JDBC pool/resource definitions
JMS resource definitions
security realm/OIDC integration config if server-managed
monitoring settings
```

Avoid:

```text
manual admin console mutation
runtime deploy by kubectl exec
cleartext secrets in domain.xml
persistent mutable domain volume
```

---

## 8. Image Build Plan

Image contains:

```text
JDK 21 runtime
GlassFish 8 distribution
domain baseline
application artifact
startup script
health endpoint configuration
```

Build metadata:

```text
app version
git commit
build time
GlassFish version
JDK version
SBOM
checksum
```

Production rule:

```text
Build once, promote same image digest.
```

Example tags:

```text
registry/govcase-web-glassfish:1.0.0
registry/govcase-web-glassfish@sha256:...
```

---

## 9. Startup Flow

Pod startup:

```text
1. container starts as non-root user
2. startup script validates required env/secrets
3. password aliases created/updated from mounted secrets
4. optional cert/truststore setup
5. GlassFish domain starts
6. app readiness endpoint becomes available
7. startup probe succeeds
8. readiness probe succeeds
9. pod receives traffic
```

No deployment download from random runtime URL. Artifact is already in image.

---

## 10. JVM Sizing Initial Baseline

Assume web pod:

```text
container memory limit: 6Gi
CPU request: 1
CPU limit: 2
```

Initial JVM:

```text
-Xms3g
-Xmx3g
-XX:+UseG1GC
-XX:MaxMetaspaceSize=512m
-Xlog:gc*,safepoint:file=/opt/glassfish/glassfish/domains/domain1/logs/gc.log:time,uptime,level,tags:filecount=10,filesize=50M
```

Memory budget:

```text
heap: 3Gi
metaspace: 512Mi
direct/native/thread/code/GC/APM/logging: ~1.5-2Gi
safety margin: ~0.5-1Gi
```

Worker pod may need different heap depending report generation.

Never set:

```text
-Xmx6g
```

inside 6Gi container.

---

## 11. HTTP Thread Pool Initial Baseline

Requirement:

```text
peak normal traffic: 300 req/s
normal p95: 500ms
```

Approx active concurrency:

```text
300 * 0.5 = 150 active requests
```

Across 4 web pods:

```text
~38 active requests per pod
```

Initial HTTP max threads per pod:

```text
75-100
```

But DB and external dependencies must constrain real concurrency.

We do not blindly set 500 threads.

---

## 12. JDBC Pool Sizing

Assume DB allows app budget:

```text
max DB sessions for app: 160
web pods: 4
worker pods: 2
reserved admin/ops: 20
available app runtime: 140
```

Initial allocation:

```text
web main pool:
  20 per pod * 4 = 80

worker main pool:
  15 per pod * 2 = 30

report pool:
  5 per worker * 2 = 10

audit pool if separate:
  5 per web * 4 = 20

total potential:
  140
```

This is an initial budget, not final truth.

GlassFish pools:

```text
jdbc/govcase/main
jdbc/govcase/report
jdbc/govcase/audit
```

Why split report pool?

```text
report/export cannot exhaust main transaction pool.
```

---

## 13. JMS Resource Plan

Destinations:

```text
jms/govcase/notificationQueue
jms/govcase/reportQueue
jms/govcase/reconciliationQueue
jms/govcase/integrationQueue
jms/govcase/dlq
```

Rules:

```text
- DLQ configured
- redelivery policy known
- message schema versioned
- consumers idempotent
- concurrency bounded
```

Worker deployment consumes queues.

Web deployment usually produces messages but does not consume heavy workloads.

---

## 14. External API Rate Limit Plan

External address API:

```text
limit: 300/min global
```

We must not do:

```text
each pod limit 300/min
```

Options:

### Option A — Redis token bucket

```text
all web/worker pods share Redis limiter
```

### Option B — Integration worker queue

```text
all address lookup requests queued
worker processes max 250/min
```

### Option C — Dedicated address service

```text
GlassFish calls address-service
address-service owns token/rate/cache
```

Case study decision:

```text
Dedicated integration module with Redis-backed token bucket.
Exact postal-code cache.
In-flight dedup.
Timeout + retry budget.
```

---

## 15. HTTP Session Strategy

Goal:

```text
minimize session state
```

Session stores:

```text
user session id
CSRF token
small UI preference
small workflow marker
```

Not stored:

```text
large search result
file bytes
JPA entity
EntityManager
DB connection
huge DTO graph
```

Load balancer:

```text
prefer non-sticky if session minimal and app supports it
or sticky temporarily for legacy UI
```

Case study decision:

```text
sticky session enabled initially for UI compatibility
session size budget < 50KB
migration roadmap to stateless/tokenized UI
```

---

## 16. Document Storage

Do not store documents on GlassFish pod local disk.

Flow:

```text
upload request
  |
  v
stream to object/document storage
  |
  v
store metadata in DB
  |
  v
write audit event
```

For downloads:

```text
authorization check in GlassFish
  |
  v
generate signed URL or stream from storage
```

Controls:

- size limit;
- virus scan if required;
- content type validation;
- encryption at rest;
- audit;
- retention policy.

---

## 17. Audit Trail

Business audit is DB-backed.

Audit event fields:

```text
id
timestamp
actor_user_id
actor_role
action
target_type
target_id
outcome
correlation_id
source_ip
module
summary
before_hash/after_hash or structured diff if needed
```

Audit write:

```text
inside same transaction as business change when required
```

Do not rely on server.log as business audit.

---

## 18. Authentication and Authorization

Authentication:

```text
OIDC via IdP
```

Authorization:

```text
application role mapping
domain permission service
case ownership check
workflow state check
```

Roles:

```text
PUBLIC_APPLICANT
OFFICER
SUPERVISOR
ADMIN
BATCH_OPERATOR
SYSTEM_INTEGRATION
```

Rules:

```text
- deny by default
- test negative cases
- no broad admin role for normal users
- audit privileged actions
```

---

## 19. Admin Plane Hardening

Admin rules:

```text
- admin port not exposed publicly
- admin console disabled or internal-only
- secure admin enabled if remote admin used
- strong admin password
- CI/CD deploy identity limited
- no manual console changes except break-glass
- password files protected
- admin operations audited
```

Kubernetes:

```text
No public Service/Ingress for 4848.
Use port-forward/bastion if emergency admin access needed.
```

---

## 20. Secrets Plan

Secrets:

```text
DB password
JMS password
OIDC client secret
SMTP credential
external API credential
keystore password
admin password
```

Sources:

```text
secret manager -> Kubernetes Secret/external secret -> mounted files/env -> startup alias creation
```

Rules:

```text
- no secrets in image
- no secrets in ConfigMap
- no secrets in git
- no secrets in logs
- rotate process documented
```

GlassFish resources use password aliases where applicable.

---

## 21. TLS and Proxy Plan

Ingress terminates TLS:

```text
Client HTTPS -> Ingress/WAF -> HTTP private backend
```

Optional backend TLS/mTLS if policy requires.

Proxy sets:

```text
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-For
```

Application trusts forwarded headers only from known proxy path.

Headers:

```text
HSTS
CSP
X-Content-Type-Options
Referrer-Policy
Cache-Control sensitive pages
```

Test UI compatibility, especially if JSF/JSP.

---

## 22. Kubernetes Deployment Baseline

Web deployment:

```yaml
replicas: 4
maxUnavailable: 0
maxSurge: 1
startupProbe: generous startup window
livenessProbe: local liveness
readinessProbe: app readiness
terminationGracePeriodSeconds: 60
resources:
  requests: 1 CPU, 4Gi
  limits: 2 CPU, 6Gi
```

Worker deployment:

```yaml
replicas: 2
different resources
no public ingress
consumes JMS/outbox
```

PDB:

```text
web minAvailable: 3
worker minAvailable: 1
```

Topology spread:

```text
spread across nodes/zones where possible
```

---

## 23. Health Endpoints

Endpoints:

```text
/internal/live
/internal/ready
/internal/deep-health
/internal/version
```

`/live`:

```text
process responsive
basic app alive
does not check DB
```

`/ready`:

```text
app initialized
critical local resources
not draining
optional DB lightweight check depending policy
```

`/deep-health`:

```text
DB
JMS
OIDC metadata
external API status/cache
object storage
```

`/version`:

```text
app version
commit
build time
runtime version
```

Do not expose sensitive info publicly.

---

## 24. Logging Plan

Logs:

```text
server.log
application log
access log
GC log
audit log/business audit
security events
```

Centralization:

```text
container stdout/stderr or sidecar/agent
structured logs preferred
correlation ID included
```

Log fields:

```text
timestamp
level
service
version
pod
module
correlation_id
user_id hash or safe identifier
operation
duration
status
error_code
```

Never log:

```text
password
token
full JWT
session cookie
PII payload
full document content
```

---

## 25. Metrics Plan

Dashboards:

### Web

```text
request rate
p50/p95/p99 latency
HTTP 4xx/5xx
busy HTTP threads
JDBC active/wait
CPU/memory
GC pause
session count
```

### Worker

```text
queue depth
oldest message age
consumer rate
failure/redelivery
DLQ count
worker duration
DB pool usage
external API latency
```

### DB

```text
active sessions
CPU
slow SQL
locks
connection count
tablespace/disk
```

### External API

```text
rate limit remaining if available
calls/min
cache hit
429 count
timeout
p95 latency
circuit state
```

---

## 26. Alerts

Examples:

```text
HTTP 5xx > threshold for 5 min
p95 latency > SLO
readiness failures
pod restart/OOMKilled
JDBC pool wait > threshold
JMS oldest message age > threshold
DLQ count > 0
GC pause p99 high
DB lock wait high
external API 429/timeout spike
admin login failure spike
certificate expiry < 30 days
```

Each alert links to runbook.

---

## 27. CI/CD Pipeline

Pipeline:

```text
1. build app
2. run unit tests
3. run integration tests
4. package WAR/EAR
5. generate SBOM
6. scan dependencies
7. build GlassFish image
8. scan image
9. push immutable digest
10. deploy to DEV
11. smoke test
12. promote same digest to UAT
13. run regression/performance smoke
14. approval
15. deploy PROD rolling
16. smoke PROD
17. observe release window
```

No manual pod deploy.

---

## 28. DB Migration Plan

Use expand/contract.

Example release:

```text
V1:
  add nullable column
  add index concurrently/online if supported
  add outbox table

Deploy app:
  writes new column if present

Later:
  backfill
  enforce not null
  remove old column in separate release
```

Migration runs as separate controlled job, not every app pod.

---

## 29. Release Strategy

Normal releases:

```text
rolling deployment
maxUnavailable=0
maxSurge=1
readiness gate
smoke test
```

Major runtime upgrade:

```text
blue-green
parallel environment
traffic switch
rollback by route switch
```

Feature risk:

```text
feature flag
canary enablement
```

Rollback must consider DB/schema/message compatibility.

---

## 30. Failure Mode Analysis

### Instance/Pod Down

Expected:

```text
Service removes pod.
Remaining pods handle traffic.
Alert if replicas below desired.
```

### DB Slow

Expected:

```text
JDBC wait alert.
Timeouts protect threads.
Batch/report paused if needed.
```

### External API Down

Expected:

```text
circuit opens.
address lookup degraded/cached.
worker retries with backoff.
web threads not held indefinitely.
```

### JMS Broker Down

Expected:

```text
web persists outbox if possible.
worker stops consuming.
alert on broker.
async features delayed.
```

### Object Storage Down

Expected:

```text
document upload/download fails gracefully.
case transaction not partially committed incorrectly.
```

---

## 31. Runbook: High 504 Rate

Steps:

```text
1. Check ingress/proxy 504 metrics.
2. Check if requests reach GlassFish access logs.
3. Check web pod readiness.
4. Check HTTP thread busy.
5. Take thread dump from affected pod.
6. Check JDBC pool wait.
7. Check external API latency.
8. Check DB locks/slow SQL.
9. Mitigate:
   - disable expensive endpoint
   - reduce traffic
   - open circuit
   - rollback release
   - scale if bottleneck is app CPU and downstream OK
10. Record evidence.
```

---

## 32. Runbook: JDBC Pool Exhaustion

Steps:

```text
1. Identify pool.
2. Check active/max/wait.
3. Check thread dump stack.
4. Check DB active sessions/locks.
5. Check recent release/query change.
6. Check connection leak.
7. Mitigation:
   - stop offending batch/report
   - kill DB blocker if approved
   - rollback
   - temporary pool increase only if DB capacity allows
8. Fix root query/transaction/leak.
```

---

## 33. Runbook: JMS Backlog

Steps:

```text
1. Identify queue and oldest message age.
2. Check consumer pod health.
3. Check redelivery/DLQ.
4. Check DB/external dependency used by consumer.
5. Check poison message.
6. Mitigation:
   - pause producer
   - scale worker if downstream can handle
   - move poison to DLQ
   - fix dependency
7. Backlog drain plan.
```

---

## 34. Runbook: OOMKilled

Steps:

```text
1. Check pod events.
2. Check memory RSS trend.
3. Check heap/metaspace/direct/thread metrics.
4. Check GC log.
5. Check recent traffic/release.
6. Capture heap dump if safe/repro.
7. Check session/cache/report memory.
8. Mitigation:
   - restart affected pod
   - reduce traffic/job
   - increase memory only with evidence
9. Fix leak/bloat/sizing.
```

---

## 35. Go-Live Readiness Review

Checklist:

```text
[Architecture]
- web/worker split implemented
- DB/JMS/object storage dependencies documented
- failure modes reviewed

[Security]
- admin port protected
- secrets externalized
- TLS/certs valid
- auth/role tests passed
- logs no secrets

[Performance]
- baseline load test completed
- p95/p99 within SLO
- DB pool sizing validated
- report async path tested

[Observability]
- dashboards live
- alerts configured
- runbooks linked
- correlation ID propagated

[Release]
- pipeline build once/promote
- rollback tested
- DB migration tested
- smoke tests automated

[Operations]
- on-call trained
- backup/restore tested
- dump collection secure
- patch plan defined
```

---

## 36. Production Baseline Config Summary

```text
GlassFish:
  version: 8.x
  Java: 21 supported JDK
  admin console: disabled/internal only
  secure admin: enabled if remote admin
  JVM: fixed heap with native headroom
  GC logs: enabled
  monitoring: enabled

Web:
  replicas: 4
  HTTP max threads: 75-100 initial
  main JDBC pool: 20/pod
  audit JDBC pool: 5/pod
  session: small/sticky transitional

Worker:
  replicas: 2
  main JDBC pool: 15/pod
  report JDBC pool: 5/pod
  JMS consumer concurrency bounded

Security:
  OIDC
  role mapping
  password aliases
  network isolation

Observability:
  logs + metrics + alerts + runbooks
```

---

## 37. Architecture Review: Why This is Production-Grade

It is production-grade because:

```text
1. traffic is routed through controlled ingress
2. admin/control plane is isolated
3. web and worker workloads are separated
4. resource pools are budgeted
5. external API quota is globally controlled
6. large reports are async
7. documents are externalized
8. audit is transactional and first-class
9. releases are immutable and observable
10. failure modes have runbooks
```

Production-grade does not mean “perfect”. It means risks are known, bounded, monitored, and recoverable.

---

## 38. What We Intentionally Did Not Do

We did not:

```text
- store documents on pod local disk
- expose admin console publicly
- run all workloads in one GlassFish deployment
- use one JDBC pool for everything
- generate reports synchronously in HTTP request
- let every pod call external API freely
- rely on manual deployment
- set Xmx equal to container memory
- treat logs as audit trail
- ignore rollback
```

These omissions are deliberate engineering decisions.

---

## 39. Variants

### VM Variant

Use:

```text
DAS + web-cluster + worker-cluster
asadmin deploy --target
external load balancer
central logs/metrics agent
```

Same patterns apply.

### Smaller System Variant

If small:

```text
2 web instances
1 worker instance
sticky session
single DB pool
manual release with strong checklist
```

But keep:

- secrets;
- admin hardening;
- logs;
- runbooks;
- rollback.

### Larger System Variant

If large:

```text
split integration service
separate report service
dedicated search index
read replica
multiple worker pools
blue-green always
```

---

## 40. Common Case Study Mistakes

### Mistake 1 — Start with Server Config Before Requirements

Config should serve requirements.

### Mistake 2 — One Runtime for Every Workload

User traffic, batch, report, integration need different boundaries.

### Mistake 3 — HA Without Headroom

Four pods at 95% load cannot survive one pod loss.

### Mistake 4 — Kubernetes but Mutable App Server Behavior

Manual deploy into pods breaks immutability.

### Mistake 5 — Monitoring Only CPU/Memory

Need pool, queue, latency, dependency metrics.

### Mistake 6 — No Business Audit

Server logs are not enough.

### Mistake 7 — No External API Quota Design

Scaling pods breaks quota.

---

## 41. Final Production Blueprint

```text
Runtime:
  GlassFish 8 + Java 21

Deployment:
  immutable image, Kubernetes rolling deployment

Topology:
  web deployment replicas=4
  worker deployment replicas=2

State:
  DB for transactional state
  object storage for documents
  JMS/outbox for async
  small session only

Security:
  OIDC
  role mapping
  admin plane isolated
  secrets externalized
  TLS at ingress

Reliability:
  readiness/liveness/startup probes
  PDB/topology spread
  async reports
  circuit breaker/rate limit
  DLQ

Operations:
  central logs
  metrics dashboards
  alerts
  runbooks
  release pipeline
  rollback plan
```

---

## 42. Top 1% Takeaways

1. **Start from requirements, not from `domain.xml`.**
2. **Production-grade GlassFish is an architecture, not a single server.**
3. **Separate web, worker, report, and integration workloads when failure isolation matters.**
4. **Resource pools are capacity contracts.**
5. **External API quota must be globally coordinated.**
6. **Documents, audit, and session state need explicit storage strategy.**
7. **Admin/control plane must be isolated and hardened.**
8. **CI/CD, observability, and runbooks are part of runtime design.**
9. **Go-live readiness is evidence-based, not confidence-based.**
10. **A good runtime design makes failure contained, diagnosable, and recoverable.**

---

## 43. Mini Exercise

Create your own production-grade GlassFish runtime plan for:

```text
System:
  Insurance claim platform

Requirements:
  - public claim submission
  - internal review
  - document upload
  - fraud scoring external API
  - nightly batch settlement
  - PDF report generation
  - PostgreSQL
  - RabbitMQ/JMS bridge
  - SSO/OIDC
  - Kubernetes
  - 99.9% availability
```

Answer:

1. What deployments do you create?
2. Which workloads go to web vs worker?
3. What is your DB pool budget?
4. How do you handle fraud scoring timeout/rate limit?
5. Where do documents live?
6. How do you implement audit?
7. What probes do you expose?
8. What dashboards do you build?
9. What release strategy do you use?
10. What is your rollback plan?

---

## 44. Referensi

Referensi utama:

- Eclipse GlassFish Deployment Planning Guide, Release 8  
  https://glassfish.org/docs/latest/deployment-planning-guide.html

- Eclipse GlassFish Administration Guide, Release 8  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish Performance Tuning Guide, Release 8  
  https://glassfish.org/docs/latest/performance-tuning-guide.html

- Eclipse GlassFish Security Guide, Release 8  
  https://glassfish.org/docs/latest/security-guide.html

- Kubernetes Workloads and Probes  
  https://kubernetes.io/docs/concepts/workloads/  
  https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/

- Enterprise Integration Patterns  
  https://www.enterpriseintegrationpatterns.com/

- Microservices.io Patterns — Transactional Outbox, Saga, Circuit Breaker, Bulkhead  
  https://microservices.io/patterns/

---

## 45. Status Seri

Part ini selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
Part 21 - selesai
Part 22 - selesai
Part 23 - selesai
Part 24 - selesai
Part 25 - selesai
Part 26 - selesai
Part 27 - selesai
Part 28 - selesai
Part 29 - selesai
Part 30 - selesai
Part 31 - selesai
Part 32 - selesai
Part 33 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 34 — Top 1% GlassFish Engineer Playbook: Invariants, Heuristics, dan Decision Framework
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-032.md">⬅️ Part 32 — Production Architecture Patterns dengan GlassFish</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-034.md">Part 34 — Top 1% GlassFish Engineer Playbook: Invariants, Heuristics, dan Decision Framework ➡️</a>
</div>
