# learn-java-eclipse-glassfish-runtime-server-engineering-part-034  
# Part 34 — Top 1% GlassFish Engineer Playbook: Invariants, Heuristics, dan Decision Framework

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 34 dari 35  
> Status seri: **selesai — ini adalah bagian terakhir**  
> Target pembaca: Java backend / enterprise engineer yang ingin menginternalisasi GlassFish sebagai runtime produksi, bukan sekadar menghafal command/config  
> Fokus part ini: **playbook final engineer GlassFish top 1%**: invariant, heuristik, decision framework, troubleshooting mental model, production baseline, migration strategy, dan operating principles

---

## 0. Tujuan Part Ini

Part terakhir ini bertujuan menyatukan seluruh seri menjadi satu **operating playbook**.

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. berpikir seperti engineer runtime, bukan sekadar application developer;
2. membedakan masalah aplikasi, container, database, broker, network, JVM, dan konfigurasi;
3. menggunakan invariant untuk mengambil keputusan cepat dan benar;
4. melakukan tuning berdasarkan evidence;
5. melakukan troubleshooting berdasarkan boundary search;
6. mendesain deployment GlassFish yang repeatable, secure, observable, dan rollbackable;
7. menentukan kapan GlassFish cocok, kapan Payara/WildFly/Liberty/Spring Boot lebih cocok;
8. memodernisasi aplikasi Java EE/Jakarta EE tanpa merusak produksi;
9. membuat production readiness review;
10. mengembangkan mental model jangka panjang sebagai engineer GlassFish level top 1%.

Ini bukan part yang menambah fitur baru. Ini adalah part untuk **mengunci cara berpikir**.

---

## 1. The Core Identity: Apa Itu GlassFish bagi Engineer Top 1%?

GlassFish bukan hanya:

```text
server untuk deploy WAR/EAR
```

GlassFish adalah:

```text
Jakarta EE runtime
  +
container-of-containers
  +
resource manager
  +
deployment engine
  +
classloading boundary
  +
transaction/security/naming runtime
  +
admin/config system
  +
operational platform
```

Ia menjalankan:

- Servlet/JSP/JSF;
- JAX-RS/Jersey;
- EJB;
- CDI;
- JPA/EclipseLink integration;
- JTA;
- JMS/OpenMQ integration;
- JCA/resource adapters;
- Security realms/role mapping;
- JNDI/naming;
- deployment descriptors;
- server-specific descriptors;
- monitoring/logging;
- admin commands.

Engineer top 1% memahami:

```text
GlassFish bukan black box.
GlassFish adalah runtime yang bisa diobservasi, dikonfigurasi, dibatasi, dan dianalisis.
```

---

## 2. The Master Mental Model

Semua part sebelumnya bisa diringkas menjadi:

```text
GlassFish receives traffic
  |
  v
Network/HTTP listener accepts request
  |
  v
Thread pool executes request
  |
  v
Container dispatches to app
  |
  v
App uses container services:
  - naming
  - security
  - transaction
  - persistence
  - messaging
  - resources
  |
  v
External dependencies:
  - DB
  - JMS
  - EIS
  - external API
  - file/object storage
  |
  v
Response / async event / transaction outcome
```

Masalah produksi biasanya terjadi karena:

```text
One boundary becomes slow, unavailable, misconfigured, or overloaded.
```

Troubleshooting berarti mencari boundary tersebut.

---

## 3. Invariant 1 — Runtime Version Defines Reality

Dokumentasi, contoh blog, dan memory engineer bisa salah jika tidak cocok dengan versi.

Selalu mulai dari:

```text
GlassFish version
Jakarta EE version
JDK version
application version
deployment topology
```

Pertanyaan wajib:

```text
Ini GlassFish 4, 5, 6, 7, atau 8?
Ini Java EE javax atau Jakarta jakarta?
Ini JDK 8, 11, 17, 21, atau 25?
Ini VM cluster atau Kubernetes pods?
```

Jangan debugging dengan asumsi GlassFish 8 jika produksi GlassFish 5.

---

## 4. Invariant 2 — `javax` vs `jakarta` adalah Runtime Boundary

Migrasi Java EE ke Jakarta EE bukan kosmetik.

```text
javax.servlet.Filter != jakarta.servlet.Filter
javax.persistence.Entity != jakarta.persistence.Entity
```

Library yang compiled against `javax` tidak otomatis cocok dengan runtime `jakarta`.

Tetapi tidak semua `javax` berubah:

```text
javax.sql
javax.naming
javax.net
javax.crypto
javax.management
```

banyak yang tetap Java SE.

Heuristik:

```text
If it is Jakarta EE spec API, likely migrated to jakarta.
If it is Java SE/JDK API, likely remains javax/java.
```

---

## 5. Invariant 3 — GlassFish Config Is Runtime State

`domain.xml` bukan file dekorasi.

Ia menentukan:

- listeners;
- resources;
- pools;
- security;
- logging;
- monitoring;
- JVM options;
- deployment target;
- cluster config.

Manual change di Admin Console tanpa version control adalah config drift.

Rule:

```text
Production config must be reproducible.
```

Use:

```text
asadmin scripts
IaC
Kubernetes manifests
config repository
release notes
approval trail
```

---

## 6. Invariant 4 — Admin Plane Is More Dangerous Than App Plane

Jika attacker menguasai admin plane, ia bisa:

- deploy malicious app;
- ubah resource credentials;
- disable security;
- stop runtime;
- read/change config;
- pivot ke DB/JMS/external systems.

Baseline:

```text
Admin console not public.
Secure admin if remote admin.
Strong admin password.
Admin port network-restricted.
No blank/default credentials.
Audit admin actions.
```

Control plane harus jauh lebih dijaga daripada endpoint biasa.

---

## 7. Invariant 5 — Pools Are Capacity Contracts

Thread pool, JDBC pool, JMS consumer pool, connector pool bukan sekadar angka tuning.

Mereka adalah kontrak:

```text
How much concurrency is allowed to hit a dependency?
```

Jika pool terlalu kecil:

```text
queue/wait/timeout
```

Jika pool terlalu besar:

```text
dependency overload/cascading failure
```

Golden rule:

```text
Pool size must respect downstream useful capacity.
```

Contoh:

```text
4 instances × JDBC max 50 = 200 potential DB sessions
```

Jika DB hanya sanggup 120, app cluster dapat menjatuhkan DB.

---

## 8. Invariant 6 — More Threads Do Not Fix Slow Dependencies

Jika external API 30 detik:

```text
menambah HTTP threads hanya membuat lebih banyak request menunggu 30 detik
```

Jika DB query full scan:

```text
menambah JDBC pool hanya memberi DB lebih banyak pekerjaan buruk
```

Jika broker lambat:

```text
menambah consumer bisa memperparah downstream DB/API
```

Heuristik:

```text
If threads are waiting, find what they wait for.
If CPU is low and latency high, suspect blocking dependency/pool/lock.
If CPU is high, profile code/GC.
```

---

## 9. Invariant 7 — Transaction Boundary Must Be Short and Intentional

Bad:

```text
begin transaction
read DB
call external API
generate PDF
send email
update DB
commit
```

Good:

```text
transaction:
  validate
  update DB
  write audit
  write outbox
commit

async:
  call external API
  generate PDF
  send email
```

Long transactions cause:

- lock contention;
- JDBC pool exhaustion;
- timeout;
- rollback cost;
- deadlock;
- poor throughput.

Top engineer asks:

```text
What exactly is inside the transaction?
```

---

## 10. Invariant 8 — HTTP Session Is a Scalability Liability Unless Kept Small

HTTP session is easy to misuse.

Bad session attributes:

```text
large search results
uploaded file bytes
JPA entities
EntityManager
DB connection
huge DTO graph
non-serializable objects
```

Session bloat hurts:

- heap;
- replication;
- failover;
- rolling deployment;
- memory predictability.

Rule:

```text
Session should contain small identity/UI state, not business data payloads.
```

---

## 11. Invariant 9 — Deployment Is a State Transition

Production release is not:

```bash
asadmin deploy app.war
```

Production release includes:

```text
artifact
config
resources
DB migration
secrets
certificates
health
smoke tests
observability
rollback
audit
```

If rollback is unknown, release risk is unknown.

Golden rule:

```text
Build once. Promote same artifact. Deploy with evidence.
```

---

## 12. Invariant 10 — Observability Is Part of Architecture

You cannot operate what you cannot see.

Minimum production signals:

```text
HTTP request rate/latency/errors
GlassFish thread pools
JDBC active/wait
JMS queue depth/oldest age
GC pause/heap/metaspace
CPU/memory/RSS
DB active sessions/locks/slow SQL
external API latency/status/rate limit
deployment version
readiness/liveness
```

Logs without metrics are incomplete. Metrics without logs lack context. Dumps without timestamps are hard to use.

---

## 13. Invariant 11 — Heap Is Not Total Memory

JVM memory:

```text
Java heap
metaspace
code cache
thread stacks
direct buffers
GC native structures
JIT/compiler
mmap
native libraries
APM/logging overhead
```

Container memory limit sees total RSS.

Rule:

```text
Xmx must leave native headroom.
```

If container limit 6Gi, `-Xmx6g` is wrong.

---

## 14. Invariant 12 — Classloader Leaks Are App Server Reality

Hot redeploy can leak classloaders if old app is retained by:

- ThreadLocal;
- unmanaged thread;
- static cache;
- MBean;
- JDBC driver registration;
- logging context;
- shutdown hook;
- third-party cache.

Symptom:

```text
Metaspace grows after redeploy.
Old app classes remain.
```

Mitigation:

```text
lifecycle cleanup
rolling restart
immutable deployment
avoid repeated hot redeploy in production
```

---

## 15. Invariant 13 — Spec Compatibility Does Not Mean Operational Portability

Jakarta EE portability helps app code.

But migration between runtimes still faces:

- server descriptors;
- resources;
- JNDI names;
- security realms;
- admin commands;
- classloading;
- JPA provider differences;
- JMS provider differences;
- transaction nuances;
- deployment pipeline;
- monitoring tools.

Runtime migration requires full operational inventory.

---

## 16. Invariant 14 — Security Hardening Must Be Automated

Manual one-time hardening decays.

Hardening must be:

```text
scripted
reviewed
tested
versioned
audited
reapplied
```

Security baseline:

- no public admin;
- no cleartext secrets;
- password aliases/secret manager;
- least privilege;
- TLS;
- patching;
- safe logs;
- restricted dumps/backups;
- role tests.

---

## 17. Invariant 15 — Source Code Is the Final Documentation

When docs are ambiguous:

```text
read source
```

But read source with discipline:

```text
version tag
stack trace
log message
command name
module boundary
tests
spec contract
```

Do not wander randomly through repository.

---

## 18. The 10 Diagnostic Questions

When incident happens, ask:

```text
1. What changed?
2. Is impact global or endpoint-specific?
3. Is it all instances or one instance?
4. Is CPU high or low?
5. Are HTTP threads busy?
6. Is JDBC pool waiting?
7. Is DB slow/locked?
8. Is external API slow?
9. Is GC causing pauses?
10. Do logs/metrics/thread dumps agree?
```

These questions prevent random guessing.

---

## 19. Thread Dump Heuristics

Take 3 dumps, not one.

Patterns:

```text
Many HTTP threads waiting for JDBC:
  DB/pool/transaction issue

Many threads socketRead external API:
  external dependency/timeout issue

Many BLOCKED on same monitor:
  lock contention

One thread high CPU same stack:
  loop/regex/serialization/hot method

Many idle executor threads:
  not necessarily issue

Thread count increasing:
  thread leak/unmanaged executor
```

Thread state alone is not enough. Stack context matters.

---

## 20. GC Heuristics

Healthy:

```text
heap sawtooth
after-GC baseline stable
pause within SLO
```

Leak/bloat:

```text
after-GC baseline rises continuously
```

Allocation pressure:

```text
GC frequent but after-GC drops well
```

Wrong blame:

```text
GC pause 50ms, request latency 60s
```

Then GC is not primary root cause.

---

## 21. Pool Exhaustion Heuristics

JDBC pool exhausted can mean:

```text
pool too small
DB slow
DB lock
connection leak
transaction too long
traffic spike
report/batch competing
external call inside transaction
```

Do not “fix” by increasing pool until you understand which one.

Question:

```text
Are connections busy doing useful DB work or just held while waiting elsewhere?
```

---

## 22. Timeout Heuristics

Timeouts should be nested:

```text
external call timeout < app request budget < proxy timeout
```

Bad:

```text
proxy 60s
external API timeout 120s
DB query timeout none
```

Good:

```text
external API 1.5s
DB statement 2s
request 3s
proxy 5s
```

Not every operation same budget. Reports/batch should be async.

---

## 23. Retry Heuristics

Retries are load multipliers.

```text
3 retries × 10s timeout = 30s capacity hostage
```

Safe retry:

- idempotent operation;
- short timeout;
- exponential backoff;
- jitter;
- max attempts;
- circuit breaker;
- budgeted within request/job SLA.

Do not retry non-idempotent external calls blindly.

---

## 24. Architecture Heuristics

Keep in GlassFish when:

```text
- strong local transaction needed
- domain tightly coupled
- Jakarta EE services valuable
- migration risk high
- module is core business logic
```

Extract when:

```text
- independent scaling needed
- heavy batch/report
- unstable external dependency
- global quota coordination
- different security zone
- independent lifecycle
```

Do not extract because “microservice is modern.” Extract because boundary is real.

---

## 25. Runtime Selection Heuristics

Choose GlassFish when:

```text
Jakarta EE spec fidelity, learning, open implementation, or existing GlassFish continuity matters.
```

Choose Payara when:

```text
GlassFish-like runtime + production support is needed.
```

Choose WildFly/EAP when:

```text
Red Hat enterprise ecosystem/support and modular app server model fit.
```

Choose Liberty when:

```text
IBM/Liberty support, feature-based lightweight Jakarta EE/MicroProfile runtime fits.
```

Choose Spring Boot when:

```text
app-centric microservice framework and ecosystem productivity matter more than full Jakarta EE container semantics.
```

---

## 26. Migration Heuristics

For GlassFish 4/5 → 7/8:

```text
1. Inventory first.
2. Build tests before migration.
3. Separate JDK, namespace, dependency, runtime changes if possible.
4. Use automated tools but review manually.
5. Do not globally replace every javax.
6. Upgrade third-party libraries.
7. Validate descriptors.
8. Deploy to real target runtime.
9. Run dual-runtime comparison.
10. Plan rollback/parallel run.
```

If app is large and critical:

```text
strangler or stepwise migration beats big bang.
```

---

## 27. Deployment Heuristics

Safe deployment requires:

```text
preflight
deploy
readiness
smoke
observe
rollback criteria
```

Do not declare success after deploy command alone.

Ask:

```text
Is expected version serving traffic?
Are all instances consistent?
Are 5xx/latency normal?
Are pools stable?
Are logs clean?
```

---

## 28. Kubernetes Heuristics

In Kubernetes:

```text
pod is disposable
image is artifact
config is declared
state is externalized
admin console is not deployment path
```

Use:

- startup probe for slow start;
- liveness for process health;
- readiness for traffic;
- graceful shutdown;
- resource limits with native headroom;
- PDB/topology spread;
- immutable rollout.

Avoid:

```text
kubectl exec -> asadmin deploy
persistent mutable domain volume
admin port public
Xmx == memory limit
```

---

## 29. Security Heuristics

Security priorities:

```text
1. protect admin plane
2. externalize secrets
3. least privilege resources
4. TLS/proxy correctness
5. auth/role tests
6. patch lifecycle
7. safe logging/dumps
8. supply chain controls
```

Most dangerous mistakes:

```text
public admin console
debug port exposed
plaintext DB password
old unpatched runtime
logs with tokens
broad admin roles
```

---

## 30. Performance Heuristics

Performance tuning order:

```text
1. define workload/SLO
2. baseline
3. measure bottleneck
4. hypothesize
5. change one thing
6. retest
7. document
```

Do not tune by folklore.

Little's Law:

```text
concurrency ≈ throughput × latency
```

Use it for thread/pool sanity.

---

## 31. CI/CD Heuristics

Release artifacts:

```text
WAR/EAR/RAR or image
checksum
SBOM
build metadata
test evidence
release notes
rollback plan
```

Pipeline invariant:

```text
same artifact promoted across environments
```

Manual production change creates drift unless reconciled.

---

## 32. Observability Heuristics

Every alert should answer:

```text
what broke?
where?
impact?
first action?
runbook?
```

Bad alert:

```text
CPU high
```

Better:

```text
govcase-web p95 latency > 2s for 10m, HTTP threads 95%, JDBC wait increasing. Runbook: JDBC pool exhaustion.
```

Dashboards should reflect architecture boundaries.

---

## 33. HA Heuristics

HA means tested failure behavior.

Ask:

```text
Can we lose one instance?
Can we lose one node?
Can DB failover work?
Can broker restart?
Can external API go down?
Can deployment fail halfway?
Can user session survive or fail gracefully?
```

If not tested, it is assumption, not HA.

---

## 34. Source Reading Heuristics

When reading GlassFish source:

```text
1. match version tag
2. start from stack trace/log/command
3. locate module
4. read tests
5. read interface/contract
6. read implementation
7. check spec requirement
8. build minimal repro
```

Respect boundaries:

```text
JAX-RS -> Jersey
JPA -> EclipseLink
HTTP -> Grizzly
DI internal -> HK2
JMS -> OpenMQ
JSF -> Mojarra
```

---

## 35. Top 50 Production Checklist

```text
[Version]
1. GlassFish version documented
2. JDK version documented
3. Jakarta EE version documented
4. app version endpoint exists
5. dependency SBOM generated

[Admin]
6. admin password changed
7. admin port restricted
8. secure admin enabled if remote admin
9. admin console disabled/internal-only
10. admin actions audited

[Secrets]
11. no cleartext secrets in domain.xml
12. password aliases/secret manager used
13. password files protected
14. keystores protected
15. secret rotation process exists

[Runtime]
16. JVM heap set with native headroom
17. GC logs enabled
18. thread pools sized intentionally
19. JDBC pools sized by DB capacity
20. unused listeners/services disabled

[Deployment]
21. build once/promote same artifact
22. target explicit
23. preflight checks exist
24. smoke tests automated
25. rollback plan tested

[Application]
26. session size bounded
27. external calls have timeouts
28. retries bounded/idempotent
29. transactions short
30. reports/long jobs async

[Security]
31. authN tested
32. authZ negative tests exist
33. security headers reviewed
34. cookies hardened
35. logs redact secrets

[Observability]
36. HTTP latency/errors dashboard
37. JDBC pool dashboard
38. JMS backlog dashboard
39. GC/memory dashboard
40. external dependency dashboard

[HA]
41. readiness/liveness/startup defined
42. graceful shutdown tested
43. one-instance failure tested
44. rolling deployment tested
45. session/failover strategy documented

[Ops]
46. thread dump runbook
47. heap dump security process
48. incident postmortem template
49. patch process
50. config drift detection
```

---

## 36. Decision Framework: Diagnose Before Acting

When pressured during incident, use:

```text
Observe -> Classify -> Contain -> Prove -> Fix -> Prevent
```

### Observe

Collect evidence.

### Classify

Which boundary?

```text
app / GlassFish / JVM / DB / JMS / external / proxy / network / OS
```

### Contain

Reduce impact.

### Prove

Root cause mechanism.

### Fix

Code/config/runtime/data change.

### Prevent

Alert/test/runbook/architecture improvement.

---

## 37. The “Do Not” List

Do not:

```text
- increase all pools blindly
- restart without evidence when evidence can be safely collected
- expose admin console publicly
- store secrets in domain.xml/git/image
- hold DB transaction during external call
- store large objects in HTTP session
- deploy manually into Kubernetes pods
- use latest tags in production
- run old unpatched GlassFish/JDK indefinitely
- blame GC without GC evidence
- blame DB without DB evidence
- assume Jakarta migration is just import rename
- trust forwarded headers from internet clients
- use local disk for durable cluster state
- treat server.log as business audit trail
```

---

## 38. The “Always” List

Always:

```text
- know exact runtime version
- make deployment target explicit
- use evidence-based tuning
- keep transactions short
- set timeouts
- bound retries
- protect admin plane
- externalize secrets
- monitor pools and queues
- record release evidence
- test failure modes
- keep session small
- document architecture decisions
- build rollback plan
- read source when docs are insufficient
```

---

## 39. Final Mental Map of the Whole Series

```text
Part 0-3:
  What GlassFish is and how domain/cluster model works

Part 4-6:
  Admin/config/bootstrap lifecycle

Part 7-9:
  Classloading, deployment, descriptors

Part 10-13:
  HTTP, threads, JDBC, transactions

Part 14-19:
  JMS, EJB, CDI/HK2, security, naming, JCA

Part 20-24:
  logging, monitoring, performance, memory, troubleshooting

Part 25-27:
  HA, Kubernetes, CI/CD

Part 28-31:
  modernization, hardening, source code, runtime comparison

Part 32-34:
  production architecture, case study, final playbook
```

This is the full mental stack.

---

## 40. What “Top 1% GlassFish Engineer” Means

It does not mean memorizing every `asadmin` option.

It means:

```text
You can reason from symptom to subsystem.
You can design runtime boundaries.
You can protect production.
You can migrate safely.
You can read source when needed.
You can explain trade-offs.
You can build reproducible operations.
You can prevent incidents, not only fix them.
```

Top 1% is not a title. It is a discipline.

---

## 41. Final Exercise: Production Review Board

You are asked to approve production go-live:

```text
GlassFish 8
Java 21
4 web pods
2 worker pods
Oracle DB
JMS broker
OIDC
external API
object storage
rolling deployment
```

Questions:

1. What exact versions are running?
2. How is admin plane protected?
3. Where are secrets stored?
4. What is Xmx vs container memory?
5. What are JDBC pool sizes and aggregate total?
6. What is external API timeout and rate-limit design?
7. What happens if one pod dies?
8. What happens if DB is slow?
9. What happens if external API is down?
10. Are long jobs async?
11. How are documents stored?
12. Is audit trail business-grade?
13. Is deployment immutable?
14. Is rollback tested?
15. Are smoke tests automated?
16. Are dashboards ready?
17. Are runbooks ready?
18. Are security negative tests passed?
19. Are logs free of secrets?
20. What would make you reject go-live?

If you can answer these with evidence, you are operating at production-grade level.

---

## 42. Final Reference Checklist

Core references to keep bookmarked:

- Eclipse GlassFish Documentation  
  https://glassfish.org/docs/

- Eclipse GlassFish GitHub Repository  
  https://github.com/eclipse-ee4j/glassfish

- Jakarta EE Specifications  
  https://jakarta.ee/specifications/

- Eclipse Jersey  
  https://github.com/eclipse-ee4j/jersey

- Eclipse Grizzly  
  https://github.com/eclipse-ee4j/grizzly

- EclipseLink  
  https://github.com/eclipse-ee4j/eclipselink

- OpenMQ  
  https://github.com/eclipse-ee4j/openmq

- Eclipse HK2  
  https://github.com/eclipse-ee4j/glassfish-hk2

- Kubernetes Documentation  
  https://kubernetes.io/docs/

- OWASP Cheat Sheet Series  
  https://cheatsheetseries.owasp.org/

- Enterprise Integration Patterns  
  https://www.enterpriseintegrationpatterns.com/

- Microservices Patterns  
  https://microservices.io/patterns/

---

## 43. Penutup Seri

Seri `learn-java-eclipse-glassfish-runtime-server-engineering` selesai.

Kamu sekarang sudah melalui:

```text
- konsep dasar GlassFish sebagai runtime enterprise
- domain, DAS, node, instance, cluster
- asadmin, admin API, config-as-code
- bootstrap lifecycle
- classloading
- deployment WAR/EAR/EJB/RAR
- descriptors dan vendor extensions
- HTTP/Grizzly
- thread pools
- JDBC pools
- transactions
- JMS/OpenMQ
- EJB
- CDI/HK2
- security
- JNDI/naming
- JCA/resource adapters
- logging
- monitoring
- performance tuning
- memory and leak diagnosis
- troubleshooting
- clustering and HA
- Kubernetes/containerization
- CI/CD and release engineering
- legacy modernization
- hardening
- source code contribution-level understanding
- runtime comparison
- production architecture patterns
- production-grade case study
- final top 1% playbook
```

Jika seri ini dipraktikkan, kamu bukan hanya bisa “deploy aplikasi ke GlassFish”, tetapi bisa:

```text
design,
operate,
debug,
secure,
modernize,
and reason about GlassFish as a production runtime.
```

---

## 44. Status Seri

Part ini selesai.

Progress final:

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
Part 34 - selesai
```

Status seri:

```text
SELESAI
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-033.md">⬅️ Part 33 — Case Study: Building a Production-Grade GlassFish Runtime from Zero</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<span></span>
</div>
