# learn-java-eclipse-glassfish-runtime-server-engineering-part-032  
# Part 32 — Production Architecture Patterns dengan GlassFish

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 32 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang ingin mampu mendesain arsitektur produksi berbasis GlassFish, bukan hanya deploy aplikasi ke server  
> Fokus part ini: **production architecture patterns dengan GlassFish**: monolith enterprise, modular EAR, stateless web tier, worker split, integration gateway, batch, messaging, HA topology, security zones, operational baseline, migration-ready architecture, dan anti-pattern

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. melihat GlassFish sebagai **runtime node dalam arsitektur produksi**, bukan hanya tempat deploy WAR/EAR;
2. memilih pola arsitektur yang sesuai dengan karakter aplikasi:
   - monolith enterprise;
   - modular monolith;
   - web + worker split;
   - integration gateway;
   - batch processing;
   - message-driven processing;
   - blue-green runtime;
   - containerized runtime;
3. memahami bagaimana GlassFish berinteraksi dengan:
   - reverse proxy / load balancer;
   - database;
   - JMS/broker;
   - external API;
   - identity provider;
   - object/document storage;
   - logging/metrics/tracing platform;
4. memahami pola HA dan failure containment;
5. memahami pola security zoning untuk internet/intranet/admin;
6. memahami resource boundary:
   - JDBC pool;
   - JMS consumer;
   - connector pool;
   - thread pool;
   - external API quota;
7. menghindari anti-pattern arsitektur umum;
8. menyusun reference architecture untuk production GlassFish;
9. membuat decision framework kapan tetap memakai GlassFish dan kapan memecah fungsi ke service lain;
10. mempersiapkan Part 33 case study production-grade runtime from zero.

---

## 1. Mental Model: Production Architecture adalah Boundary Design

GlassFish production architecture bukan hanya:

```text
User -> GlassFish -> Database
```

Arsitektur produksi adalah desain boundary:

```text
Traffic boundary
Security boundary
Transaction boundary
State boundary
Failure boundary
Deployment boundary
Operational boundary
Integration boundary
Data ownership boundary
```

Jika boundary salah, tuning runtime tidak cukup.

Contoh:

```text
GlassFish cluster 4 node
  tetapi semua request sinkron menunggu external API 120 detik
```

Masalahnya bukan kurang node. Masalahnya boundary external dependency tidak dikontrol.

Top 1% engineer bertanya:

```text
Apa yang boleh gagal tanpa menjatuhkan semua sistem?
Apa yang harus sinkron?
Apa yang bisa async?
State disimpan di mana?
Pool mana yang membatasi dependency?
Traffic mana yang boleh masuk zone mana?
Bagaimana rollout dan rollback dilakukan?
Bagaimana evidence dikumpulkan saat incident?
```

---

## 2. Pattern 1 — Classic Enterprise Monolith

Topology:

```text
Users
  |
  v
Reverse Proxy / Load Balancer
  |
  v
GlassFish Cluster
  |
  |-- WAR/JSF/JAX-RS
  |-- EJB
  |-- JPA
  |-- JMS MDB
  |-- Batch
  |
  v
Oracle/PostgreSQL/DB
```

Karakter:

- satu aplikasi besar;
- banyak modul business;
- deployment satu EAR/WAR besar;
- server-managed resources;
- transaction boundary kuat;
- ops sederhana secara topology;
- release risk besar karena blast radius besar.

Cocok jika:

- domain tightly coupled;
- team kecil/menengah;
- deployment window manageable;
- transaction consistency penting;
- legacy Java EE/Jakarta EE app;
- organisasi nyaman dengan app server operations.

Risiko:

- build/deploy lambat;
- testing regression besar;
- satu bug bisa mempengaruhi semua modul;
- scaling per-module sulit;
- batch/report bisa mengganggu user traffic;
- modernization lebih berat.

Hardening:

```text
- module boundary internal jelas
- feature flags
- resource pools per function
- async untuk long-running work
- regression suite kuat
- observability per module
- release checklist ketat
```

---

## 3. Pattern 2 — Modular Monolith EAR

Topology:

```text
case-platform.ear
  |
  |-- case-web.war
  |-- case-api.war
  |-- case-services-ejb.jar
  |-- case-batch-ejb.jar
  |-- case-domain.jar
  |-- case-integration.jar
  |-- lib/
```

Tujuan:

```text
Tetap satu deployable unit,
tetapi struktur internal modular.
```

Boundary:

- module per bounded context;
- shared domain library minimal;
- integration adapter terpisah;
- API layer tidak langsung akses DB;
- batch module tidak mencemari web module.

Kelebihan:

- lebih disiplin daripada monolith acak;
- transaction masih mudah;
- deployment masih satu unit;
- cocok untuk Java EE/Jakarta EE;
- migration bisa bertahap per module internal.

Kekurangan:

- release tetap satu artifact;
- runtime scaling per module masih terbatas;
- module dependency bisa bocor jika tidak dijaga.

Best practice:

```text
case-web -> application services -> domain -> repository/integration
```

Jangan:

```text
JSF backing bean langsung query DB dan call external API.
```

---

## 4. Pattern 3 — Stateless Web Tier

Topology:

```text
Load Balancer
  |
  |-- GlassFish Web Instance 1
  |-- GlassFish Web Instance 2
  |-- GlassFish Web Instance 3
  |
  v
DB / Redis / Broker / Object Storage
```

Prinsip:

```text
Instance tidak menyimpan business state penting di local memory.
```

State durable:

- database;
- object storage;
- external session store jika perlu;
- broker;
- distributed cache.

Kelebihan:

- scaling mudah;
- rolling deploy mudah;
- failover lebih bersih;
- no sticky session required;
- pod/instance disposable.

Kekurangan:

- perlu desain session/token;
- latency external state;
- consistency harus dipikirkan;
- legacy JSF/session-heavy app sulit.

Cocok untuk:

- REST APIs;
- web apps dengan session kecil;
- Kubernetes;
- high availability.

---

## 5. Pattern 4 — Sticky Session Web Cluster

Topology:

```text
Load Balancer with Cookie Affinity
  |
  |-- GlassFish Instance A
  |-- GlassFish Instance B
```

User diarahkan ke instance yang sama.

Cocok untuk:

- aplikasi legacy sessionful;
- JSF/session-heavy app;
- migration transitional;
- failover session tidak wajib.

Risiko:

- instance mati -> session hilang jika tidak replicated;
- load imbalance;
- rolling deploy butuh draining;
- memory pressure per instance;
- scaling down rumit.

Guideline:

```text
Gunakan sticky session sebagai compatibility mechanism.
Rencanakan pengurangan session state secara bertahap.
```

---

## 6. Pattern 5 — Web + Worker Split

Topology:

```text
Users
  |
  v
GlassFish Web Cluster
  |
  | writes command/event
  v
JMS Queue / Broker
  |
  v
GlassFish Worker Cluster
  |
  v
DB / External Systems
```

Tujuan:

```text
Pisahkan request-response user dari long-running/background processing.
```

Contoh workload worker:

- email notification;
- document generation;
- external sync;
- report export;
- data archival;
- payment/enforcement instruction;
- large file processing;
- retryable integration.

Kelebihan:

- user traffic tidak habis oleh batch;
- worker bisa scale berbeda;
- retry/backoff lebih natural;
- failure external dependency tidak langsung menjatuhkan UI;
- better bulkhead.

Kekurangan:

- eventual consistency;
- duplicate message handling;
- idempotency wajib;
- monitoring backlog;
- operational topology lebih kompleks.

Design rules:

```text
- command/event must have idempotency key
- consumer idempotent
- DLQ configured
- redelivery policy known
- worker concurrency respects DB/external capacity
```

---

## 7. Pattern 6 — Integration Gateway inside GlassFish

Topology:

```text
Application Modules
  |
  v
Integration Gateway Module
  |
  |-- HTTP client adapter
  |-- SOAP adapter
  |-- JCA adapter
  |-- JMS adapter
  |-- retry/timeout/circuit breaker
  |-- mapping/error translation
  v
External Systems
```

Tujuan:

```text
External integration logic terpusat dan tidak bocor ke semua service.
```

Kelebihan:

- consistent timeout;
- consistent logging/correlation;
- secret handling terpusat;
- error mapping konsisten;
- easier migration from SOAP to REST;
- easier mocking/testing.

Anti-pattern:

```text
Setiap business service membuat HTTP client sendiri,
timeout sendiri,
retry sendiri,
logging sendiri,
credential sendiri.
```

Gateway contract:

```java
public interface AddressLookupPort {
    AddressResult lookupPostalCode(String postalCode);
}
```

Implementation:

```text
OneMapAddressLookupAdapter
```

---

## 8. Pattern 7 — Externalized Integration Service

Topology:

```text
GlassFish App
  |
  v
Integration Microservice
  |
  v
External APIs / Legacy EIS
```

Cocok jika:

- external integration kompleks;
- rate limit global perlu dikelola;
- adapter punya lifecycle berbeda;
- protocol/library tidak cocok di GlassFish;
- external dependency unstable;
- ingin isolate failure;
- ingin modern stack untuk integration.

Kelebihan:

- bulkhead kuat;
- independent deploy;
- easier scaling;
- central API quota control;
- language/runtime flexibility.

Kekurangan:

- network hop;
- distributed system complexity;
- auth between services;
- tracing/correlation needed;
- eventual consistency/retry design.

Use case:

```text
GlassFish core case system calls address-service for OneMap.
address-service handles token, rate limit, Redis cache, retry, circuit breaker.
```

---

## 9. Pattern 8 — Database-Centric Transactional Core

Topology:

```text
GlassFish App
  |
  v
Relational DB as System of Record
  |
  |-- outbox table
  |-- audit table
  |-- workflow state
  |-- integration state
```

Cocok untuk regulatory/case systems:

- strong audit;
- transactional state;
- workflow;
- reporting;
- consistency;
- relational queries.

Pattern:

```text
HTTP request:
  validate
  transaction:
    update domain table
    write audit
    write outbox
  commit

Async worker:
  read outbox
  call external system
  update integration status
```

Kelebihan:

- local transaction strong;
- recoverable integration;
- auditable;
- no distributed XA needed in many cases.

Kekurangan:

- DB can become bottleneck;
- schema governance critical;
- outbox processor needed;
- eventual external consistency.

---

## 10. Pattern 9 — Outbox Integration

Outbox table:

```text
OUTBOX_EVENT
  id
  aggregate_type
  aggregate_id
  event_type
  payload
  status
  created_at
  next_attempt_at
  attempt_count
  correlation_id
```

Flow:

```text
Business transaction
  |
  |-- update business state
  |-- insert outbox event
  v
commit

Worker
  |
  |-- poll outbox
  |-- publish/call external
  |-- mark sent/failed/retry
```

Why useful with GlassFish:

- avoids holding transaction during external call;
- avoids XA;
- retryable;
- observable;
- fits EJB/JTA/JPA;
- fits JMS bridge.

Key design:

```text
idempotency key
unique constraints
retry backoff
DLQ/manual intervention
payload versioning
monitor pending/oldest age
```

---

## 11. Pattern 10 — Inbound Event Consumer

Topology:

```text
External System / Broker
  |
  v
JMS Queue / Adapter
  |
  v
GlassFish MDB / Worker
  |
  v
Domain Service / DB
```

Cocok untuk:

- asynchronous status update;
- document processing result;
- payment result;
- external case status;
- notification callback.

Rules:

```text
- consumer idempotent
- duplicate safe
- transaction boundary clear
- redelivery policy configured
- poison message goes DLQ
- correlation ID preserved
```

MDB is powerful, but dangerous if:

- non-idempotent;
- DB locks;
- external call inside message transaction;
- unbounded concurrency.

---

## 12. Pattern 11 — Batch Processing Runtime

Options:

### Option A — Batch inside same GlassFish cluster

```text
Web + batch in same runtime
```

Simple but risky.

### Option B — Dedicated batch GlassFish instances

```text
Web cluster
Batch cluster
```

Better isolation.

### Option C — External scheduler triggers app endpoint/job

```text
Kubernetes CronJob / enterprise scheduler -> GlassFish job endpoint
```

### Option D — Separate batch service

```text
batch-worker app/service
```

Best for heavy batch.

Batch concerns:

- idempotency;
- restartability;
- checkpoint;
- locking;
- concurrency;
- time windows;
- DB impact;
- reporting;
- audit.

Never let batch silently compete with user traffic without limits.

---

## 13. Pattern 12 — Report/Export Architecture

Bad:

```text
HTTP request generates huge report synchronously.
```

Symptoms:

- HTTP thread held for minutes;
- DB connection held too long;
- memory spike;
- proxy timeout;
- user retry duplicates work.

Better:

```text
User requests report
  |
  v
create report job
  |
  v
worker generates file
  |
  v
store in object/document storage
  |
  v
user downloads when ready
```

Benefits:

- controlled concurrency;
- retry;
- progress tracking;
- no proxy timeout;
- memory bounded;
- audit.

---

## 14. Pattern 13 — Document/File Storage Boundary

Do not store durable documents only on GlassFish local disk.

Options:

- object storage;
- document management system;
- database BLOB for small controlled files;
- shared file service with HA;
- content-addressed storage.

GlassFish local filesystem is good for:

- temp files;
- generated runtime artifacts;
- logs before shipping;
- short-lived processing.

Not good for:

- business documents;
- user uploads;
- cross-instance files;
- disaster recovery.

---

## 15. Pattern 14 — API Facade

Topology:

```text
External Clients
  |
  v
API Gateway / Reverse Proxy
  |
  v
GlassFish API WAR
  |
  v
Internal Services/Domain
```

API facade handles:

- auth token validation;
- request shaping;
- versioned endpoints;
- rate limiting;
- response mapping;
- backward compatibility.

Useful when legacy internal model is not clean API.

Keep facade thin:

```text
API layer maps and delegates.
Business logic stays in application service/domain.
```

---

## 16. Pattern 15 — Admin / Backoffice Zone Split

Many enterprise apps have:

```text
public/user-facing module
internal/admin module
```

Architecture:

```text
Internet Zone:
  public API/web

Intranet Zone:
  admin/backoffice

Shared:
  DB/core services
```

Options:

- separate WARs;
- separate GlassFish clusters;
- separate context roots;
- separate security policies;
- network segmentation;
- different WAF/rate limits.

Benefits:

- reduced attack surface;
- admin not internet-exposed;
- different scaling/security;
- clearer audit.

---

## 17. Pattern 16 — Internet / Intranet Runtime Split

Topology:

```text
Internet LB
  |
  v
GlassFish Internet Cluster
  |
  v
Shared DB / Broker / Internal APIs
  ^
  |
GlassFish Intranet Cluster
  ^
  |
Intranet LB
```

Use when:

- public users and internal officers have different zones;
- network rules differ;
- security classification differs;
- workload differs;
- deployment windows differ.

Risks:

- shared DB contention;
- duplicated app deployment;
- role/config drift;
- cross-zone API needs;
- consistency.

Mitigation:

- clear resource naming;
- separate pools;
- separate monitoring;
- separate deployment pipeline;
- shared core carefully designed.

---

## 18. Pattern 17 — Read/Write Separation

If workload has heavy read/report:

```text
Write path -> primary DB
Read/report path -> replica/warehouse/search index
```

GlassFish app:

- command operations use primary;
- query/report operations use read replica or search;
- async sync via CDC/outbox.

Benefits:

- protect OLTP;
- scale reads;
- optimize report queries.

Risks:

- replication lag;
- stale reads;
- consistency expectations;
- transaction boundary complexity.

Use only when business accepts read lag.

---

## 19. Pattern 18 — Search Offload

Bad:

```text
Case search performs complex LIKE/full-text queries on OLTP tables.
```

Better:

```text
DB/outbox/CDC -> search index
GlassFish search endpoint -> OpenSearch/Elasticsearch
Detail/transaction -> DB
```

Benefits:

- faster search;
- reduces DB load;
- better text search.

Risks:

- eventual consistency;
- index rebuild;
- security filtering;
- data masking;
- operational complexity.

---

## 20. Pattern 19 — Audit Trail as First-Class Architecture

Regulatory systems need audit.

Audit should be:

```text
append-only
transactionally written with business change if needed
queryable
protected
retained
not dependent on debug logs
```

Architecture:

```text
Business transaction:
  update domain state
  insert audit event
  commit
```

Audit event:

```text
actor
action
target
before/after summary
timestamp
correlation ID
source IP/session
outcome
```

Do not rely solely on server.log for business audit.

---

## 21. Pattern 20 — Security Gateway + App Authorization

External gateway may authenticate:

```text
OIDC/SAML/session validation
```

But application still authorizes:

```text
role permission
case ownership
workflow state
agency boundary
data classification
```

Architecture:

```text
Identity Provider
  |
  v
Gateway / SSO
  |
  v
GlassFish App
  |
  v
Domain Authorization Service
```

Do not outsource all authorization to reverse proxy if business rules are domain-specific.

---

## 22. Pattern 21 — Multi-Tenant / Multi-Agency Runtime

Options:

### Single app, shared schema

```text
tenant_id column
```

Pros:

- simple deployment;
- shared resources.

Cons:

- data isolation risk;
- query filters critical;
- noisy neighbor.

### Single app, schema per tenant

Pros:

- stronger DB isolation;
- per-tenant migration complexity.

### App/runtime per tenant

Pros:

- strong isolation;
- higher cost/ops.

GlassFish considerations:

- resource pools per tenant;
- JNDI naming;
- transaction;
- memory;
- deployment automation;
- security realm/role mapping.

---

## 23. Pattern 22 — Config-as-Code Runtime

Production architecture includes config lifecycle.

Pattern:

```text
Git config repo
  |
  v
CI/CD
  |
  v
asadmin scripts / Kubernetes manifests
  |
  v
GlassFish runtime
```

Config categories:

- domain baseline;
- JVM options;
- thread pools;
- JDBC resources;
- JMS resources;
- security realms;
- logging levels;
- monitoring;
- password aliases;
- certificates.

No manual console drift.

---

## 24. Pattern 23 — Observability-First Architecture

Every boundary emits signals.

```text
Ingress:
  access log, 5xx, latency

GlassFish:
  HTTP threads, JDBC pools, transactions, GC

Application:
  operation count, error, duration, correlation ID

DB:
  active sessions, slow SQL, locks

JMS:
  queue depth, oldest age, redelivery

External:
  latency, status, timeout, retry
```

Architecture must include:

- central logs;
- metrics;
- dashboards;
- alerts;
- runbooks;
- trace/correlation ID.

Observability is not add-on after production. It is part of architecture.

---

## 25. Pattern 24 — Bulkhead by Resource Pool

GlassFish provides pools. Use them as boundaries.

Examples:

```text
jdbc/main
jdbc/report
jdbc/audit

thread-pool/http
executor/report
executor/external-api

jms/criticalQueue
jms/bulkQueue
```

If report DB pool saturates, main transaction pool remains healthy.

Rules:

- separate critical and non-critical workloads;
- set per-pool max;
- monitor per-pool;
- avoid shared bottleneck if isolation is required.

---

## 26. Pattern 25 — Circuit Breaker and Degraded Mode

External dependency failure should not collapse whole cluster.

Pattern:

```text
External API unhealthy
  |
  v
Circuit opens
  |
  v
Requests fail fast or use fallback
  |
  v
HTTP threads preserved
```

Degraded modes:

- read-only mode;
- cached address lookup;
- queue request for later;
- show temporary unavailable;
- skip optional integration;
- disable non-critical features.

GlassFish itself may not provide circuit breaker. Implement at app/integration layer or external service.

---

## 27. Pattern 26 — Rate Limit and Quota Boundary

External APIs often have quota.

If 4 GlassFish instances each send 100/min:

```text
total = 400/min
```

If quota is 300/min, you need global coordination.

Options:

- central rate limiter service;
- Redis token bucket;
- integration microservice;
- queue worker with fixed throughput;
- per-instance budget = global/N with safety;
- API gateway egress policy.

Per-instance local limiter is not enough if replica count changes.

---

## 28. Pattern 27 — Feature Flag for Runtime Risk

Feature flags help decouple deploy and enablement.

Use for:

- new integration path;
- new report engine;
- new security policy;
- gradual rollout;
- emergency disable.

But:

- flag state must be audited;
- stale flags removed;
- security-sensitive flags require approval;
- flag defaults safe;
- flags included in incident context.

---

## 29. Pattern 28 — Blue-Green GlassFish Runtime

Topology:

```text
LB
 |
 |-- Blue GlassFish cluster
 |-- Green GlassFish cluster
```

Flow:

```text
deploy Green
smoke Green
switch traffic
monitor
rollback by switching Blue
```

Good for:

- critical releases;
- migration;
- major runtime upgrade;
- Jakarta migration;
- large EAR.

Constraints:

- DB compatibility;
- session cutover;
- message consumers;
- external callbacks;
- background jobs must not double-run.

---

## 30. Pattern 29 — Canary Runtime

Topology:

```text
95% traffic -> v1
5% traffic -> v2
```

Requires:

- route split;
- version labels;
- error/latency monitoring;
- rollback;
- DB/message compatibility.

GlassFish app servers can be canaried through LB/Ingress, not because GlassFish itself magically provides canary.

---

## 31. Pattern 30 — Dedicated Runtime Per Workload Class

Separate deployments:

```text
case-web
case-admin
case-worker
case-batch
case-report
case-integration
```

All may run GlassFish or mixed runtimes.

Benefits:

- scaling per workload;
- failure isolation;
- separate resource limits;
- safer releases;
- clearer ownership.

Cost:

- more deployments;
- integration overhead;
- more operational complexity;
- transaction boundary changes.

This is the bridge from monolith to service architecture.

---

## 32. Pattern 31 — Legacy Adapter Boundary

For old systems:

```text
GlassFish core app
  |
  v
Legacy Adapter Layer
  |
  v
Mainframe / SOAP / File / EIS
```

Adapter responsibilities:

- protocol;
- credential;
- mapping;
- retry;
- timeout;
- idempotency;
- error translation;
- audit;
- monitoring.

The rest of app talks to a clean port interface.

This makes modernization possible:

```text
Legacy SOAP today
REST tomorrow
event-driven later
```

without rewriting domain logic.

---

## 33. Pattern 32 — Migration-Ready Modular Architecture

Design now for future extraction.

Rules:

```text
1. Domain services behind interfaces.
2. Integration behind ports/adapters.
3. UI/API separated from domain logic.
4. DB access behind repositories.
5. No server API in domain core.
6. Async boundaries explicit.
7. Events/outbox modeled.
8. Module dependencies acyclic.
9. Test domain without GlassFish when possible.
10. Runtime-specific code isolated.
```

This lets you later move module to:

- separate GlassFish app;
- Spring Boot service;
- Quarkus service;
- batch worker;
- integration service.

---

## 34. Reference Architecture: Production GlassFish Enterprise App

```text
                    +----------------------+
                    | Identity Provider    |
                    +----------+-----------+
                               |
                               v
+---------+        +----------------------+        +----------------+
| Users   +------->| WAF / Reverse Proxy  +------->| GlassFish Web  |
+---------+        | TLS / Rate Limit     |        | Cluster        |
                   +----------+-----------+        +--+----------+--+
                              |                       |          |
                              |                       |          |
                              v                       v          v
                   +----------------------+     +---------+  +---------+
                   | Central Logging      |     | Oracle  |  | JMS     |
                   | Metrics / Alerts     |     | DB      |  | Broker  |
                   +----------------------+     +----+----+  +----+----+
                                                     |            |
                                                     v            v
                                               +------------------------+
                                               | GlassFish Worker       |
                                               | Cluster                |
                                               +-----------+------------+
                                                           |
                                                           v
                                               +------------------------+
                                               | External API / EIS     |
                                               +------------------------+
```

Key boundaries:

- web user traffic isolated from worker;
- DB as transactional core;
- JMS for async;
- integration layer for external systems;
- observability centralized;
- security at proxy + app;
- pools/rate limits protect dependencies.

---

## 35. Deployment Architecture

For VM/traditional:

```text
DAS
 |
 +-- cluster: web-cluster
 +-- cluster: worker-cluster

CI/CD:
  asadmin deploy --target web-cluster web.ear
  asadmin deploy --target worker-cluster worker.ear
```

For Kubernetes:

```text
Deployment case-web
Deployment case-worker
Service case-web
Ingress case-web
ConfigMap/Secret
HPA/PDB
```

Avoid hybrid confusion:

```text
Kubernetes controls replicas,
GlassFish DAS controls cluster,
manual console controls deploy
```

unless deliberately designed.

---

## 36. Security Zone Architecture

Zones:

```text
Internet Zone:
  public ingress, WAF, public endpoints

Application Zone:
  GlassFish web/admin internal services

Data Zone:
  DB, broker, cache, object storage

Admin Zone:
  CI/CD, bastion, admin console/asadmin
```

Rules:

```text
Internet cannot reach admin port.
App can reach DB/broker only required ports.
DB cannot be public.
Admin access via bastion/VPN.
Logs/metrics have controlled access.
```

Network design is security design.

---

## 37. Failure Containment Architecture

Map failure:

```text
External API down:
  integration circuit breaker opens, user sees degraded response, workers retry later

DB slow:
  JDBC pool wait alert, user traffic protected by timeout, batch paused

JMS broker down:
  write outbox locally if possible, async features degraded

Worker failure:
  queue backlog grows, web still serves

Report engine slow:
  report queue delayed, core transactions unaffected

One GlassFish instance down:
  LB removes, capacity remains
```

If one dependency failure causes all endpoints down, architecture lacks containment.

---

## 38. Architecture Decision Records

Use ADRs.

Example ADRs:

```text
ADR-001: Use GlassFish 8 for Jakarta EE runtime
ADR-002: Use web+worker split
ADR-003: Use outbox instead of XA for external integration
ADR-004: Use sticky session temporarily
ADR-005: Externalize document storage to S3-compatible object store
ADR-006: Use Redis token bucket for OneMap rate limit
ADR-007: Use blue-green for major runtime upgrades
```

ADR should include:

- context;
- decision;
- alternatives;
- consequences;
- rollback/revisit trigger.

---

## 39. Architecture Fitness Functions

Automated checks:

```text
No domain code imports jakarta.servlet
No direct HTTP client outside integration package
No DB access from web/controller package
No unbounded cache
No external call inside transaction annotation
No secrets in config repo
All endpoints have auth annotation or explicit public marker
All outbound calls set timeout
```

These keep architecture from decaying.

---

## 40. Anti-Patterns

### Anti-pattern 1 — Everything in One WAR with No Internal Boundary

Hard to test, migrate, scale, or reason.

### Anti-pattern 2 — Synchronous External Calls Inside DB Transaction

Creates long locks and inconsistent failure behavior.

### Anti-pattern 3 — Batch and User Traffic Share All Pools

Batch can take down user-facing app.

### Anti-pattern 4 — Local Files as Durable Storage

Breaks cluster/failover.

### Anti-pattern 5 — Huge HTTP Session

Kills memory, failover, and rolling deployment.

### Anti-pattern 6 — Manual Admin Console Architecture

No reproducibility or audit.

### Anti-pattern 7 — One DB Account for Everything

No least privilege, poor audit.

### Anti-pattern 8 — External API Rate Limit Per Instance Only

Cluster scaling breaks quota.

### Anti-pattern 9 — No DLQ/Poison Message Strategy

One bad message can block processing.

### Anti-pattern 10 — Observability Afterthought

Incident response becomes guesswork.

---

## 41. Decision Framework: Keep in GlassFish or Extract?

Keep in GlassFish if:

```text
- needs local transaction with existing domain
- tightly coupled business logic
- low independent scaling need
- Jakarta EE container features helpful
- migration risk high
```

Extract if:

```text
- independent lifecycle
- heavy CPU/batch/report
- unstable external dependency
- global rate limit coordination
- different scaling/security requirements
- team wants different runtime
- can define clear API/event boundary
```

Extraction requires:

- ownership;
- API contract;
- data ownership;
- auth;
- observability;
- deployment pipeline;
- rollback story.

---

## 42. Architecture Review Checklist

```text
[Traffic]
- ingress path known
- proxy timeouts aligned
- health/readiness defined
- rate limits

[State]
- HTTP session strategy
- durable file storage
- cache strategy
- DB as source of truth

[Resources]
- JDBC pools per workload
- JMS consumers controlled
- external API quota
- thread pools

[Failure]
- dependency down behavior
- retry/backoff
- DLQ
- circuit breaker/degraded mode
- graceful shutdown

[Security]
- zones
- admin isolation
- least privilege DB/JMS
- authN/authZ
- audit

[Deployment]
- blue-green/rolling
- config-as-code
- DB migration strategy
- rollback

[Observability]
- logs
- metrics
- traces/correlation
- dashboards
- alerts/runbooks

[Migration]
- runtime-specific code isolated
- modules clean
- integration adapters
- extraction path
```

---

## 43. Top 1% Takeaways

1. **GlassFish production architecture is boundary design.**
2. **Monolith is not automatically bad; unbounded monolith is bad.**
3. **Web + worker split is one of the most valuable production patterns.**
4. **Outbox often beats XA for external integration.**
5. **Local HTTP session and local files are cluster liabilities.**
6. **Resource pools are architectural bulkheads, not just tuning knobs.**
7. **External API quota must be global, not per instance.**
8. **Observability, security zones, and release strategy are architecture, not ops afterthought.**
9. **Architecture should make failure contained, diagnosable, and recoverable.**
10. **Migration-ready architecture isolates domain, integration, runtime, and deployment concerns.**

---

## 44. Mini Exercise

Design a production architecture for:

```text
Regulatory case management platform
- Public portal
- Internal officer portal
- Oracle DB
- JMS broker
- External address API with 300/min limit
- Document uploads/downloads
- Daily batch reconciliation
- Report export
- SSO/OIDC
- Requirement: rolling deployment, audit trail, and HA
```

Answer:

1. How many GlassFish deployments/clusters do you create?
2. Which modules stay in web tier?
3. Which workloads move to worker tier?
4. How do you store documents?
5. How do you enforce external API 300/min?
6. How do you design audit trail?
7. What are JDBC pool boundaries?
8. What is session strategy?
9. How do you deploy safely?
10. What dashboards/alerts are mandatory?

---

## 45. Referensi

Referensi utama:

- Eclipse GlassFish Deployment Planning Guide, Release 8  
  https://glassfish.org/docs/latest/deployment-planning-guide.html

- Eclipse GlassFish Administration Guide, Release 8  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish Performance Tuning Guide, Release 8  
  https://glassfish.org/docs/latest/performance-tuning-guide.html

- Eclipse GlassFish Security Guide, Release 8  
  https://glassfish.org/docs/latest/security-guide.html

- Jakarta EE Specifications  
  https://jakarta.ee/specifications/

- Enterprise Integration Patterns  
  https://www.enterpriseintegrationpatterns.com/

- Microservices.io Patterns — Transactional Outbox / Saga / Bulkhead / Circuit Breaker  
  https://microservices.io/patterns/

- Kubernetes Architecture and Workload Concepts  
  https://kubernetes.io/docs/concepts/

---

## 46. Status Seri

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
```

Seri belum selesai.

Part berikutnya:

```text
Part 33 — Case Study: Building a Production-Grade GlassFish Runtime from Zero
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-031.md">⬅️ Part 31 — Comparative Engineering: GlassFish vs Payara vs WildFly vs Liberty vs Spring Boot</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-033.md">Part 33 — Case Study: Building a Production-Grade GlassFish Runtime from Zero ➡️</a>
</div>
