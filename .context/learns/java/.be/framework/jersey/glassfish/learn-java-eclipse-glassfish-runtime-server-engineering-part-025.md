# learn-java-eclipse-glassfish-runtime-server-engineering-part-025  
# Part 25 — Clustering, Load Balancing, Session Replication, dan High Availability

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 25 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang sudah memahami Jakarta EE API dan ingin memahami GlassFish sebagai runtime produksi  
> Fokus part ini: **GlassFish clustering dan high availability engineering**: cluster, instance, load balancing, sticky session, session replication, failover, rolling deployment, graceful draining, dan HA trade-off

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. memahami model clustering GlassFish: domain, DAS, node, instance, cluster, config, target;
2. membedakan **scalability**, **availability**, **fault tolerance**, **failover**, dan **disaster recovery**;
3. memahami bagaimana load balancer berinteraksi dengan GlassFish instances;
4. memahami sticky session vs non-sticky session;
5. memahami risiko HTTP session replication;
6. memahami konsekuensi stateful EJB, EJB timers, JMS, dan batch workload dalam cluster;
7. menyusun strategi rolling deployment dan graceful draining;
8. memahami failure mode:
   - instance down;
   - DAS down;
   - node unreachable;
   - partial deployment;
   - session failover failure;
   - split routing;
   - cluster config drift;
9. memahami kapan GlassFish clustering cocok dan kapan lebih baik memakai stateless app + externalized state;
10. membuat production HA checklist.

Part ini tidak mengulang domain model Part 3, deployment Part 8, monitoring Part 21, atau troubleshooting Part 24. Di sini kita fokus pada **runtime topology untuk high availability**.

---

## 1. Mental Model: HA Bukan Sama dengan “Ada 2 Server”

Banyak desain enterprise menulis:

```text
2 servers behind load balancer = HA
```

Itu belum tentu benar.

HA berarti sistem tetap memenuhi service objective ketika sebagian komponen gagal.

Pertanyaan yang harus dijawab:

```text
Jika satu instance mati, apakah traffic otomatis pindah?
Jika request sedang berjalan saat instance mati, apa yang terjadi?
Jika session ada di instance yang mati, apakah user logout?
Jika DAS mati, apakah running apps tetap melayani traffic?
Jika deployment hanya sukses di sebagian instance, apa dampaknya?
Jika DB down, apakah cluster membantu?
Jika load balancer salah health check, apakah traffic dikirim ke instance rusak?
```

Cluster tidak menghilangkan kebutuhan desain stateless, idempotency, timeout, monitoring, dan rollback.

---

## 2. Istilah Dasar

### 2.1 Availability

Kemampuan sistem tersedia untuk digunakan.

Contoh:

```text
99.9% availability
```

### 2.2 High Availability

Desain agar sistem tetap tersedia meskipun ada kegagalan komponen tertentu.

Contoh:

```text
Jika satu GlassFish instance mati, instance lain melayani traffic.
```

### 2.3 Scalability

Kemampuan menangani load lebih besar dengan menambah resource.

Contoh:

```text
Tambah instance dari 2 menjadi 4 untuk menaikkan throughput.
```

Scalability tidak otomatis berarti HA. Jika semua instance bergantung pada single DB yang down, cluster tetap down.

### 2.4 Fault Tolerance

Kemampuan tetap berjalan walau ada fault.

HA biasanya mencakup fault tolerance untuk sebagian failure, tetapi tidak semua.

### 2.5 Failover

Perpindahan service dari komponen gagal ke komponen sehat.

Contoh:

```text
User session dari instance A failover ke instance B.
```

### 2.6 Disaster Recovery

Pemulihan dari kegagalan besar seperti region/data center failure.

GlassFish cluster lokal bukan DR penuh.

---

## 3. GlassFish Cluster Model Recap

Model:

```text
Domain
  |
  |-- DAS
  |
  |-- Cluster
        |
        |-- Instance 1
        |-- Instance 2
        |-- Instance 3
        |-- Instance 4
```

Komponen penting:

```text
DAS:
  control plane/admin

Instance:
  JVM process yang melayani aplikasi

Cluster:
  logical group of instances

Config:
  shared configuration assigned to cluster/instance

Node:
  host/location where instance runs

Target:
  where app/resource/config is applied
```

Mental model:

```text
DAS controls.
Instances serve.
Cluster groups.
Load balancer routes.
```

---

## 4. DAS Down: Apakah Aplikasi Down?

DAS adalah control plane. Running instances biasanya tetap dapat melayani traffic meskipun DAS down.

Namun ketika DAS down, kamu kehilangan kemampuan:

- administrasi terpusat;
- deploy/undeploy;
- config changes;
- start/stop remote instances via DAS;
- cluster management;
- monitoring/admin operations tertentu.

Mental model:

```text
DAS down:
  data plane may continue

Instance down:
  user traffic affected depending load balancer/HA
```

Production implication:

```text
DAS harus diproteksi dan dibackup,
tetapi jangan jadikan DAS sebagai request path user.
```

---

## 5. Cluster vs Load Balancer

GlassFish cluster adalah logical runtime grouping.

Load balancer adalah traffic router.

```text
Client
  |
  v
Load Balancer
  |
  |-- GlassFish instance A
  |-- GlassFish instance B
  |-- GlassFish instance C
```

Cluster tidak otomatis berarti traffic terbagi. Kamu butuh load balancer:

- hardware LB;
- Nginx;
- Apache HTTPD;
- HAProxy;
- AWS ALB/NLB;
- Kubernetes Service/Ingress;
- other reverse proxy.

Load balancer harus tahu:

- backend host/port;
- health check endpoint;
- routing policy;
- timeout;
- sticky session config;
- connection draining;
- TLS termination.

---

## 6. Load Balancing Algorithms

Common policies:

### 6.1 Round Robin

Traffic dibagi bergiliran.

Kelebihan:

- sederhana;
- cukup jika instance homogen.

Kekurangan:

- tidak mempertimbangkan load aktual;
- long request bisa menyebabkan imbalance.

### 6.2 Least Connections

Kirim ke backend dengan connection paling sedikit.

Kelebihan:

- lebih adaptif.

Kekurangan:

- connection count tidak selalu sama dengan request cost.

### 6.3 Weighted

Instance dengan kapasitas lebih besar mendapat traffic lebih banyak.

Useful jika:

```text
instance A 8 CPU
instance B 4 CPU
```

### 6.4 IP Hash / Sticky by Source

Client IP menentukan backend.

Risiko:

- NAT besar membuat banyak user ke satu backend;
- tidak cocok untuk mobile networks;
- uneven distribution.

### 6.5 Cookie-Based Stickiness

LB menaruh cookie untuk mengarahkan user ke backend sama.

Umum untuk sessionful web apps.

---

## 7. Sticky Session

Sticky session berarti request user yang sama diarahkan ke instance yang sama.

```text
User A -> instance 1
User A next request -> instance 1
```

Kelebihan:

- session lokal bisa dipakai;
- lebih sedikit replication traffic;
- lebih sederhana;
- performa lebih baik untuk sessionful app.

Kekurangan:

- instance failure bisa membuat session hilang jika tidak ada replication;
- load imbalance;
- rolling deployment lebih tricky;
- user terikat ke backend;
- scaling down harus hati-hati.

Sticky session cocok jika:

- app masih menyimpan state di HTTP session;
- session tidak mudah externalized;
- failover session bukan requirement kuat;
- user logout saat node failure masih acceptable.

---

## 8. Non-Sticky Session

Non-sticky berarti request user bisa ke instance mana saja.

```text
Request 1 -> instance A
Request 2 -> instance B
Request 3 -> instance C
```

Syarat:

- app stateless; atau
- session replicated; atau
- session externalized; atau
- token-based auth/client state.

Kelebihan:

- better load distribution;
- easier scaling;
- easier rolling deploy;
- no backend affinity.

Kekurangan:

- requires stronger architecture;
- session replication/external store overhead;
- app must avoid local state assumptions.

Top-level recommendation:

```text
Prefer stateless app design.
Use sticky session as compatibility tool, not ideal architecture.
```

---

## 9. HTTP Session State

HTTP session can contain:

- user identity/cache;
- shopping/cart-like state;
- search criteria;
- workflow step;
- CSRF token;
- temporary UI state;
- large accidental objects.

In GlassFish cluster, session strategy matters.

Options:

```text
1. Local session only + sticky
2. Replicated session
3. Externalized session store
4. Stateless token/session
5. Hybrid
```

---

## 10. Local Session Only

```text
Session stored in memory of one instance.
LB sticky routes user to same instance.
```

Pros:

- fastest;
- simple;
- no replication overhead.

Cons:

- node failure loses session;
- rolling restart logs out affected users unless drained;
- not true session failover.

Use when:

- logout on node failure acceptable;
- app low criticality;
- session data minimal;
- simple deployment.

---

## 11. Session Replication

Session replication copies session state to other instance(s).

Goal:

```text
If instance A dies,
instance B can resume session.
```

Costs:

- serialization;
- network traffic;
- memory overhead on multiple nodes;
- latency overhead;
- consistency complexity;
- failover bugs if session object not serializable;
- large session multiplies pain.

Rule:

```text
Session replication punishes large sessions.
```

If session is 1 MB and active sessions are 5,000, replication can become impossible.

---

## 12. Requirements for Replicable Session

Session attributes should be:

- serializable;
- small;
- version-compatible during rolling deploy;
- not hold DB connections;
- not hold file streams;
- not hold thread/executor;
- not hold entity manager;
- not hold non-serializable framework proxy;
- not hold huge collections;
- not hold sensitive data unnecessarily.

Bad:

```java
session.setAttribute("entityManager", em);
session.setAttribute("uploadedFile", byteArray);
session.setAttribute("caseResults", listOf10000Records);
```

Better:

```java
session.setAttribute("userId", userId);
session.setAttribute("csrfToken", token);
session.setAttribute("searchCriteria", smallDto);
```

---

## 13. Session Replication Failure Modes

### 13.1 Serialization Failure

```text
NotSerializableException
```

A session attribute cannot replicate.

### 13.2 Version Mismatch

During rolling deploy:

```text
Instance A has class v1
Instance B has class v2
Session serialized by A cannot deserialize on B
```

### 13.3 Large Session Latency

Replication slows request.

### 13.4 Split Brain / Inconsistent Session

Concurrent requests update same session on different nodes.

### 13.5 Memory Blow-up

Replicated sessions multiply memory footprint.

---

## 14. Externalized Session

Session stored in external system:

- Redis;
- database;
- distributed cache;
- dedicated session store;
- SSO/token store.

Pros:

- app instances stateless-ish;
- failover easier;
- no in-memory replication between GlassFish instances;
- scaling simpler.

Cons:

- external store becomes dependency;
- latency per session access;
- serialization/versioning still matters;
- session store capacity/HA required;
- security/encryption considerations;
- not always native GlassFish feature.

Pattern:

```text
GlassFish instances
  |
  v
External session store
```

But for many Jakarta EE apps, introducing externalized session may require framework/library/app changes.

---

## 15. Stateless Preferred Design

Best scalable design:

```text
No business state in server memory.
Use short-lived request processing.
Persist durable state in DB.
Use tokens/SSO for identity.
Use caches as optional acceleration.
Use async queues for long-running work.
```

Benefits:

- any instance can serve request;
- easy horizontal scale;
- easy rolling deployment;
- no session failover complexity;
- lower memory pressure;
- simpler disaster recovery.

Caveat:

- not every legacy app can become stateless quickly;
- migration may be incremental.

---

## 16. Load Balancer Health Check

Health check should route traffic only to instances that can serve.

Health endpoint types:

```text
/live
/ready
/deep-health
```

For load balancer, use readiness-like check.

Readiness should validate:

- GlassFish app deployed;
- app initialized;
- critical resources available enough;
- instance not draining;
- dependency policy according to design.

Do not use only TCP port open if app can be deployed-broken.

Bad:

```text
LB checks port 8080 only.
GlassFish responds but app deployment failed.
Traffic still routed -> 404/500.
```

Better:

```text
LB checks /internal/ready of the application.
```

---

## 17. Graceful Draining

Before stopping/redeploying instance:

```text
1. Mark instance not ready.
2. Load balancer stops sending new traffic.
3. Wait for in-flight requests to complete.
4. Stop/redeploy instance.
5. Start instance.
6. Wait until readiness UP.
7. Return to pool.
```

Without draining:

```text
in-flight requests fail
users see 502/503
transactions may rollback
file upload/download interrupted
```

Drain timeout must match request behavior.

Long-running request paths should be async/offloaded so draining doesn't take forever.

---

## 18. Rolling Deployment

Rolling deployment updates instances one by one.

Example with 4 instances:

```text
Take instance 1 out of LB
Deploy/restart instance 1
Health check ready
Return instance 1
Repeat for 2, 3, 4
```

Requirements:

- enough capacity with one instance removed;
- backward-compatible DB schema;
- session compatibility or sticky/drain strategy;
- version compatibility for messages/session;
- no singleton job running on every instance incorrectly;
- clear rollback.

---

## 19. Rolling Deployment Risks

### 19.1 Capacity Drop

If 4 instances and one removed:

```text
capacity drops to 75%
```

If normal peak uses 80%, rolling deploy causes saturation.

Need headroom.

### 19.2 Mixed Version

During rollout:

```text
v1 and v2 run together
```

Must ensure:

- DB schema compatible;
- JMS message formats compatible;
- session serialization compatible;
- external API behavior compatible;
- feature flags controlled.

### 19.3 Partial Deployment

Some instances v2, some v1 due to failure.

Need:

- detection;
- rollback/roll-forward plan;
- version dashboard;
- no ambiguous state.

---

## 20. Blue-Green Deployment

Two environments:

```text
Blue = current prod
Green = new prod candidate
```

Flow:

```text
Deploy to Green
Smoke test Green
Switch traffic
Monitor
Rollback by switching back to Blue
```

Pros:

- fast rollback;
- full environment test;
- avoids mixed version in same pool.

Cons:

- double infrastructure;
- DB migration compatibility still hard;
- session cutover issue;
- external integrations need careful routing.

For GlassFish, blue-green can be easier with container/VM groups than traditional in-place domain mutation.

---

## 21. Canary Deployment

Send small traffic to new version.

```text
1% traffic -> v2
monitor
10%
50%
100%
```

Requires:

- traffic splitting;
- version observability;
- SLO monitoring;
- rollback automation;
- compatibility.

GlassFish itself does not magically provide canary. Use LB/ingress/platform.

---

## 22. Cluster and Resources

Resources must be targeted correctly.

If app deploys to cluster:

```text
JDBC resource must be available to cluster target.
JMS resources must be available.
Connector resources must be available.
Security realm/config must exist.
```

Failure:

```text
Instance A has resource.
Instance B missing resource.
Traffic to B fails.
```

Baseline:

```text
Resource config should be cluster-targeted and IaC-managed.
```

---

## 23. Cluster and JDBC Pool Aggregate Capacity

Per-instance pool multiplies.

Example:

```text
4 instances
JDBC pool max 50 each
```

Aggregate:

```text
200 possible DB connections
```

If Oracle app session budget is 120, this is dangerous.

Formula:

```text
total possible DB connections =
  instance count × pool max per instance
```

Cluster tuning must be aggregate, not per-node only.

---

## 24. Cluster and External API Rate Limit

Same issue:

```text
4 instances
each allows 100 calls/min
```

Aggregate:

```text
400 calls/min
```

If external API limit is 300/min, cluster can violate rate limit.

Need:

- distributed rate limiter;
- centralized token bucket;
- per-instance budget = global limit / instance count;
- queue worker coordination;
- backpressure.

---

## 25. Cluster and Scheduled Jobs

If each instance runs same scheduled job:

```text
4 instances -> job runs 4 times
```

This can be catastrophic for:

- email sending;
- payment instruction;
- report generation;
- data archival;
- notification;
- synchronization.

Strategies:

1. run scheduler only on dedicated instance;
2. use DB/advisory lock;
3. use leader election;
4. use external scheduler;
5. use queue-based work distribution;
6. design job idempotent.

EJB timers in cluster require special attention. Understand whether timer is per instance, persistent, clustered, or singleton-like based on configuration/runtime behavior.

---

## 26. Cluster and JMS Consumers

Multiple instances consuming from same queue can be good.

```text
Queue -> consumers across instances
```

Benefits:

- parallelism;
- failover;
- backlog drain.

Risks:

- message ordering changes;
- duplicate/redelivery;
- downstream DB/API saturation;
- poison message loop;
- consumer version mismatch during rolling deploy.

Control:

- consumer concurrency;
- max sessions;
- transaction/redelivery policy;
- idempotency;
- DLQ.

---

## 27. Cluster and Stateful EJB

Stateful EJB in cluster is complex.

Concerns:

- state replication/passivation;
- serialization compatibility;
- failover semantics;
- memory footprint;
- sticky routing;
- conversational state consistency.

For scalable HA web apps, prefer stateless services unless stateful behavior is explicitly justified.

---

## 28. Cluster and Singleton Behavior

Some workloads should run only once cluster-wide:

- scheduled reconciliation;
- daily report;
- external sync;
- cache warmup that mutates global state;
- cleanup job;
- notification batch;
- data export.

Do not rely on “only one instance will happen to run it.”

Use explicit singleton coordination.

Options:

```text
DB lock:
  acquire lock row before running

Queue:
  one job message consumed by one worker

External scheduler:
  trigger one endpoint/job

Dedicated worker instance:
  only worker target has scheduler

Leader election:
  one active leader
```

---

## 29. Cluster and Cache

Local in-memory cache per instance:

```text
instance A cache != instance B cache
```

Risks:

- inconsistent data;
- stale authorization;
- stale config;
- uneven warmup;
- larger total memory;
- cache stampede during restart.

Options:

- accept eventual/local cache if safe;
- short TTL;
- invalidation event;
- distributed cache;
- central data source;
- no cache for security-critical data.

---

## 30. Failure Mode: Instance Down

What should happen:

```text
LB detects unhealthy instance.
Stops routing new traffic.
Existing requests fail or complete depending failure type.
Other instances take traffic.
Alerts fire.
Capacity remains sufficient.
```

Check:

- health check interval;
- unhealthy threshold;
- connection draining;
- retry behavior;
- session failover;
- capacity headroom.

If one of four instances down and remaining capacity insufficient, cluster is not HA for peak load.

---

## 31. Failure Mode: Node Unreachable

If a host/node fails:

- multiple instances may be lost;
- local session lost;
- local logs/dumps inaccessible;
- DAS may not reach node agent;
- load balancer must remove backends;
- monitoring must distinguish node vs app failure.

Design:

```text
spread instances across nodes/AZs
avoid all instances on one host
avoid shared local disk dependency
centralize logs
```

---

## 32. Failure Mode: DAS Down

As noted, running instances may continue.

But operational capability reduced.

Prepare:

- DAS backup;
- domain config backup;
- admin access runbook;
- restore procedure;
- avoid request path dependency on DAS;
- monitor DAS separately.

---

## 33. Failure Mode: Partial Deployment

Scenario:

```text
Deployment succeeds on instance A/B.
Fails on C/D.
LB sends traffic to all.
Users get inconsistent behavior.
```

Prevention:

- deploy to cluster as unit;
- verify app version per instance;
- readiness includes version;
- failed deployment removes instance from traffic;
- rollback plan.

Detection:

```text
dashboard panel: app version by instance
```

---

## 34. Failure Mode: Split Config / Drift

Config drift:

```text
Instance A uses pool max 50.
Instance B uses pool max 20.
Instance C missing resource.
```

Causes:

- manual admin console changes;
- direct domain.xml edits;
- failed command;
- per-instance override;
- out-of-band hotfix.

Prevention:

- configuration as code;
- cluster-level config;
- export/diff domain config;
- no manual prod changes without record;
- drift detection.

---

## 35. Failure Mode: Session Failover Fails

Symptoms:

```text
User gets logged out after instance failure.
ClassNotFoundException during session deserialization.
NotSerializableException.
Session state missing/inconsistent.
```

Causes:

- local session only;
- non-serializable attributes;
- version mismatch;
- replication disabled/misconfigured;
- too large session;
- sticky cookie points to dead backend.

Mitigation:

- accept re-login if allowed;
- drain before restart;
- reduce session size;
- avoid storing complex objects;
- externalize state.

---

## 36. Failure Mode: Cluster-Wide Cascading Failure

One dependency slows down.

```text
External API slow
  |
  v
All instances hold HTTP threads
  |
  v
Thread pools saturate
  |
  v
LB sees instances unhealthy
  |
  v
Traffic retries amplify load
  |
  v
Cluster-wide outage
```

Prevention:

- timeout;
- circuit breaker;
- bulkhead;
- per-instance concurrency limit;
- queue async work;
- fail fast;
- rate limit;
- isolate external integration pool.

Cluster can amplify failure if every node repeats the same bad behavior.

---

## 37. Bulkhead Pattern

Separate capacity for different workloads.

Examples:

```text
User request threads
Batch worker threads
JMS consumer concurrency
External API worker pool
Report/export pool
```

If report/export saturates, it should not consume all user request capacity.

In GlassFish:

- separate endpoints;
- separate executor/work manager where possible;
- separate pools;
- separate instances for batch/worker workloads;
- separate cluster for background jobs.

---

## 38. Dedicated Worker Cluster

For heavy async work:

```text
web cluster:
  handles user HTTP

worker cluster:
  handles JMS/batch/jobs
```

Benefits:

- user traffic isolated from batch;
- independent scaling;
- different JVM/pool tuning;
- safer deployments;
- background failure less likely to break UI.

Cost:

- more infrastructure;
- more deployment topology;
- operational complexity.

---

## 39. HA and Database

App cluster does not fix single database outage.

Database HA must be designed separately:

- primary/standby;
- RAC/cluster if Oracle;
- failover connection string;
- connection validation;
- retry policy;
- transaction behavior;
- DNS/failover time;
- pool refresh on failover;
- data consistency.

App readiness should reflect DB availability policy.

But liveness should usually not kill app just because DB is temporarily down.

---

## 40. HA and JMS/Broker

If JMS is critical:

- broker HA/persistence;
- durable storage;
- failover;
- DLQ;
- redelivery;
- consumer reconnection;
- message ordering;
- backup/restore.

If broker down:

```text
HTTP app may still serve read-only functions.
Write/async operations may degrade.
```

Design graceful degradation if possible.

---

## 41. HA and File Storage

Local filesystem is dangerous in cluster.

If instance A writes file locally:

```text
Instance B cannot read it.
```

Use:

- shared storage;
- object storage;
- database BLOB if appropriate;
- document service;
- replication;
- sticky routing only as temporary workaround.

For uploads:

```text
store durable file before acknowledging success
```

---

## 42. HA and In-Memory State

Local memory state includes:

- cache;
- session;
- rate limiter;
- feature flag cache;
- sequence generator;
- idempotency map;
- temporary workflow state.

Ask:

```text
What happens if this instance dies?
What happens if another instance handles next request?
What happens during rolling deployment?
```

---

## 43. Kubernetes vs Traditional GlassFish Cluster

Traditional GlassFish clustering:

```text
DAS manages instances/nodes/clusters.
```

Kubernetes model:

```text
Pods are disposable.
Service/Ingress load balances.
ConfigMap/Secret inject config.
Deployment controls rollout.
```

Tension:

- DAS mutable control plane vs immutable pods;
- domain config state vs container image;
- node/instance management duplicated by Kubernetes;
- local domain state ephemeral;
- admin console less central.

Modern container strategy often:

```text
one GlassFish instance per pod
Kubernetes handles scaling/rolling
external LB/Ingress handles routing
config baked/injected
logs to stdout/agent
state externalized
```

In this model, GlassFish cluster features may be less important than platform orchestration.

---

## 44. When to Use GlassFish Cluster Features

Use GlassFish cluster features when:

- operating traditional VM/bare-metal app server estate;
- need centralized DAS administration;
- apps rely on GlassFish clustering semantics;
- organization has established GlassFish ops model;
- deployment target is not Kubernetes-native;
- cluster-targeted resources/apps simplify governance.

Use platform-native scaling when:

- running in Kubernetes/cloud;
- apps are stateless;
- deployment is immutable;
- health/readiness are externalized;
- LB/Ingress handles routing;
- config/IaC manages environment.

---

## 45. Architecture Patterns

### Pattern A — Simple HA Web Cluster

```text
LB
 |
 |-- GF instance 1
 |-- GF instance 2
 |
DB
```

- sticky session optional;
- resources cluster-targeted;
- basic failover.

### Pattern B — Stateless Web Cluster

```text
LB
 |
 |-- GF instance 1
 |-- GF instance 2
 |-- GF instance 3
 |
DB / Redis / JMS / Object Storage
```

- no local business state;
- best for scaling.

### Pattern C — Web + Worker Separation

```text
LB -> Web GlassFish cluster
        |
        v
      JMS Queue
        |
        v
Worker GlassFish cluster
```

- background jobs isolated.

### Pattern D — Blue-Green GlassFish Groups

```text
LB
 |
 |-- Blue cluster
 |-- Green cluster
```

- traffic switch deployment.

---

## 46. Capacity Headroom for HA

If you have N instances and want to survive one failure:

```text
each instance normal utilization should be <= (N-1)/N capacity threshold
```

For 4 instances:

```text
If one fails, remaining capacity = 75%.
Normal load should fit into 75%, ideally with extra margin.
```

If normal load uses 90% of cluster:

```text
one failure causes saturation.
```

HA requires spare capacity.

---

## 47. HA Testing

Test failure, don't assume.

Scenarios:

```text
kill one instance
kill host/node
stop DB temporarily
restart broker
break external API
deploy partial/failure
expire certificate
remove backend from LB
simulate slow DB
simulate large session failover
rolling deployment during traffic
```

Observe:

- user impact;
- recovery time;
- session behavior;
- alerts;
- logs;
- rollback;
- data consistency.

---

## 48. Production HA Checklist

```text
[Topology]
- At least 2 instances for HA.
- Instances spread across nodes/AZs where possible.
- DAS not in user request path.
- LB health check configured.

[Load Balancer]
- readiness endpoint used.
- connection draining enabled.
- timeout aligned.
- sticky session decision documented.
- backend capacity monitored.

[State]
- session strategy documented.
- session size bounded.
- stateful EJB usage reviewed.
- local file storage avoided.
- local cache consistency understood.

[Resources]
- JDBC/JMS/connector resources targeted to cluster.
- aggregate pool capacity checked.
- external API global rate limits respected.
- DB/JMS HA designed separately.

[Deployment]
- rolling/blue-green strategy defined.
- readiness gates rollout.
- version per instance visible.
- rollback tested.
- schema compatibility handled.

[Failure]
- instance failure tested.
- node failure tested.
- dependency failure tested.
- session failover tested if required.
- cascading failure prevention in place.

[Observability]
- per-instance metrics.
- pool metrics.
- readiness state.
- app version labels.
- LB 5xx/timeout metrics.
- alerts with runbooks.
```

---

## 49. Decision Framework: Sticky, Replicated, External, or Stateless?

| Requirement | Recommended Direction |
|---|---|
| Small app, logout on node fail acceptable | Sticky + local session |
| Need session survive node failure | Replication or external session |
| High scale, cloud-native | Stateless/externalized state |
| Legacy app with large session | Reduce session first; replication will hurt |
| Strict rolling deployment compatibility | Stateless or version-compatible session |
| Security-sensitive session data | Minimize session, protect storage, avoid unnecessary replication |
| Multi-region DR | Stateless + durable external systems |

---

## 50. Top 1% Takeaways

1. **HA is not “two servers”; HA is tested failure behavior.**
2. **DAS is control plane; instances are data plane.**
3. **Cluster does not remove need for load balancer health/readiness.**
4. **Sticky session is compatibility, not ideal scalability.**
5. **Session replication is expensive and punishes large sessions.**
6. **Per-instance pool size multiplies across cluster.**
7. **Scheduled jobs and singleton workloads must be explicitly coordinated.**
8. **Rolling deployment requires spare capacity and version compatibility.**
9. **Cluster can amplify cascading failures if timeouts/bulkheads are wrong.**
10. **Stateless design plus externalized durable state is usually the cleanest HA foundation.**

---

## 51. Mini Exercise

Design HA for this GlassFish system:

```text
Regulatory case management app.
4 GlassFish instances.
AWS ALB/Nginx in front.
Oracle DB.
OpenMQ JMS.
Users have HTTP session.
App has daily scheduled reconciliation job.
External address API has global rate limit 300/min.
Peak load uses 65% cluster capacity.
```

Answer:

1. Sticky or non-sticky routing?
2. Is session replication needed?
3. What is the risk if session size is 2 MB?
4. What is JDBC pool max per instance if DB allows 160 app sessions?
5. How do you enforce external API 300/min across 4 instances?
6. How do you prevent reconciliation job from running 4 times?
7. What readiness endpoint checks?
8. What happens if one instance dies?
9. What happens during rolling deploy?
10. Which failure tests must be performed before production?

---

## 52. Referensi

Referensi utama:

- Eclipse GlassFish High Availability Administration Guide  
  https://glassfish.org/docs/

- Eclipse GlassFish Administration Guide, Release 8  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish Reference Manual, Release 8  
  https://glassfish.org/docs/latest/reference-manual.html

- Eclipse GlassFish Application Deployment Guide, Release 8  
  https://glassfish.org/docs/latest/application-deployment-guide.html

- Jakarta Servlet Specification — HTTP session model  
  https://jakarta.ee/specifications/servlet/

- Jakarta Enterprise Beans Specification — timer/session bean behavior  
  https://jakarta.ee/specifications/enterprise-beans/

- Kubernetes Probes Concepts  
  https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/

---

## 53. Status Seri

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
```

Seri belum selesai.

Part berikutnya:

```text
Part 26 — Containerization dan Kubernetes Deployment untuk GlassFish
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-024.md">⬅️ Part 24 — Troubleshooting Runtime Failures: Thread Dump, Heap Dump, Stuck Request, Deadlock, Timeout</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-026.md">Part 26 — Containerization dan Kubernetes Deployment untuk GlassFish ➡️</a>
</div>
