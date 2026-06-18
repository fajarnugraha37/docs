# learn-java-deployment-runtime-release-delivery-engineering — Part 35
# Final Mastery Review: Top 1% Java Deployment Engineer Mindset

> **Series:** `learn-java-deployment-runtime-release-delivery-engineering`  
> **Part:** 35 of 35  
> **Topic:** Final Mastery Review — Top 1% Java Deployment Engineer Mindset  
> **Scope:** Java 8–25, deployment mastery, production thinking, release safety, operational invariants, failure modeling, decision frameworks, deployment architecture, governance, observability, rollback, legacy-modern bridge  
> **Goal:** Mengikat seluruh series menjadi mental model final: bagaimana engineer kelas atas berpikir, mengambil keputusan, mencegah failure, dan membangun sistem deployment Java yang aman, cepat, traceable, dan operable.

---

## 0. Status Series

Ini adalah **bagian terakhir** dari series:

```text
learn-java-deployment-runtime-release-delivery-engineering
```

Total:

```text
35 parts
```

Dengan selesainya Part 35, series **Java Deployment** ini selesai.

Namun “selesai” di sini berarti fondasi dan peta mastery sudah lengkap. Dalam praktik nyata, deployment engineering adalah kemampuan yang terus diasah melalui:

1. real production release;
2. incident;
3. RCA;
4. platform improvement;
5. automation;
6. governance refinement;
7. migration;
8. operational rehearsal.

---

## 1. Apa yang Sebenarnya Dipelajari Dalam Series Ini?

Di awal, “Java Deployment” mungkin terdengar seperti:

```text
cara menjalankan JAR
cara membuat Dockerfile
cara deploy ke Kubernetes
```

Namun setelah 35 part, kita bisa melihat bahwa deployment Java yang production-grade jauh lebih luas.

Deployment Java adalah disiplin yang menggabungkan:

1. Java runtime;
2. artifact engineering;
3. OS/process lifecycle;
4. JVM options;
5. container behavior;
6. app server behavior;
7. Kubernetes lifecycle;
8. configuration;
9. secrets;
10. database migration;
11. traffic management;
12. stateful workload safety;
13. observability;
14. verification;
15. CI/CD;
16. supply chain security;
17. runtime hardening;
18. multi-environment governance;
19. distributed system compatibility;
20. legacy modernization;
21. incident response;
22. runbook engineering;
23. enterprise auditability;
24. ADR/checklist discipline;
25. platform design.

Deployment bukan satu langkah.

Deployment adalah perubahan terkendali terhadap sistem hidup.

---

## 2. Final Mental Model: Deployment as Controlled Change

Definisi paling penting:

> **Deployment adalah proses mengubah state production system dari satu versi operasional ke versi operasional lain, dengan risiko yang dikendalikan, evidence yang dikumpulkan, dan recovery path yang tersedia.**

Dengan model ini, deployment bukan:

```text
kubectl apply
```

bukan:

```text
copy JAR
```

bukan:

```text
restart service
```

Itu hanya action.

Deployment adalah state transition:

```text
current known good state
→ planned change
→ controlled execution
→ verified new state
→ monitored stability
→ evidence-backed closure
```

Atau jika gagal:

```text
current known good state
→ planned change
→ failure detected
→ diagnostic capture
→ rollback/roll-forward
→ recovered state
→ RCA/learning
```

Top-tier engineer tidak hanya mengeksekusi action.

Mereka mengelola state transition.

---

## 3. The Deployment Equation

Gunakan persamaan mental ini:

```text
Deployment Safety =
  Artifact Integrity
× Runtime Compatibility
× Environment Correctness
× Config/Secret Correctness
× Data Compatibility
× Traffic Safety
× State Safety
× Observability
× Rollback Feasibility
× Human/Process Control
```

Jika satu faktor nol, deployment safety bisa runtuh.

Contoh:

```text
Artifact benar, runtime benar, Kubernetes benar,
tetapi DB migration tidak backward-compatible.
```

Risiko tetap tinggi.

Contoh lain:

```text
App sehat, DB sehat, config benar,
tetapi readiness probe selalu true walau dependency gagal.
```

Traffic bisa masuk ke instance yang tidak siap.

Deployment safety tidak bisa dinilai dari satu signal saja.

---

## 4. The Top 1% Deployment Engineer Mindset

Engineer biasa bertanya:

```text
Bagaimana cara deploy?
```

Engineer kuat bertanya:

```text
Bagaimana cara deploy tanpa downtime?
```

Senior engineer bertanya:

```text
Bagaimana rollback jika gagal?
```

Top 1% engineer bertanya:

```text
Apa saja state yang berubah?
Apa invariant yang harus tetap benar?
Apa failure mode yang mungkin muncul?
Bagaimana kita mendeteksi failure lebih awal?
Bagaimana kita membatasi blast radius?
Apakah rollback benar-benar aman?
Jika rollback tidak aman, apa roll-forward path?
Evidence apa yang membuktikan deployment berhasil?
Bagaimana keputusan ini diwariskan ke tim?
Bagaimana platform mencegah kesalahan serupa?
```

Mereka tidak hanya mengejar sukses.

Mereka mendesain sistem agar gagal secara terkendali.

---

## 5. Core Invariants of Java Deployment

Ini adalah invariant yang harus terus benar.

### Invariant 1 — We Know What Is Running

Selalu tahu:

```text
service
version
Git commit
artifact/image digest
Java version
config version
deployment timestamp
environment
```

Jika tidak tahu versi yang running, rollback, RCA, audit, dan vulnerability response akan lemah.

### Invariant 2 — Artifact Is Immutable

Production artifact tidak boleh berubah setelah build.

Bad:

```text
same tag, different content
```

Good:

```text
immutable version + image digest + checksum
```

### Invariant 3 — Config Is Part of Deployment

Artifact tanpa config bukan sistem yang berjalan.

Deployment identity harus mencakup:

```text
artifact + config + secrets + runtime + environment
```

### Invariant 4 — Runtime Compatibility Is Explicit

Java version, vendor, JVM flags, framework version, app server version, dan container base harus compatible.

Jangan berharap runtime mismatch “ketahuan sendiri” saat production.

### Invariant 5 — Readiness Means Traffic Safety

Readiness bukan sekadar process hidup.

Readiness berarti:

```text
this instance can safely receive traffic now
```

### Invariant 6 — Liveness Must Not Kill Slow Startup

Liveness untuk mendeteksi proses unrecoverable, bukan menghukum startup lambat.

Gunakan startup probe untuk Java service yang cold start-nya panjang.

### Invariant 7 — Graceful Shutdown Must Protect In-Flight Work

Rolling update tidak aman jika shutdown membunuh request, transaction, queue message, atau job secara kasar.

### Invariant 8 — DB State May Outlive App Version

Database migration sering tidak ikut rollback.

Karena itu, app rollback dan DB rollback harus dipisahkan.

### Invariant 9 — Old and New Versions Often Coexist

Rolling/canary berarti beberapa versi hidup bersamaan.

Maka perlu compatibility:

1. API;
2. DB;
3. event schema;
4. cache key;
5. session;
6. config;
7. feature flags.

### Invariant 10 — Observability Is Deployment Infrastructure

Logs, metrics, traces, health, JFR, dumps, and version metadata bukan tambahan.

Mereka adalah komponen deployment safety.

### Invariant 11 — Rollback Must Be Designed Before Deployment

Rollback yang ditulis setelah incident bukan rollback plan.

### Invariant 12 — Evidence Must Survive the Deployment

Deployment tanpa evidence tidak bisa diaudit, sulit di-RCA, dan lemah untuk compliance.

### Invariant 13 — Runbook Must Be Executable by Others

Jika hanya satu orang yang paham deployment, itu bukan sistem matang.

### Invariant 14 — Governance Must Match Risk

Low-risk change harus cepat.

High-risk change harus dikontrol.

Same process for all changes adalah tanda governance belum matang.

### Invariant 15 — Incidents Must Improve the System

Setiap failed deployment harus memperbaiki:

1. runbook;
2. checklist;
3. ADR;
4. tests;
5. pipeline;
6. observability;
7. policy.

---

## 6. Java-Specific Mastery Checklist

Seorang deployment engineer Java yang sangat kuat harus bisa menjawab hal-hal berikut.

### 6.1 Runtime

```text
[ ] Java version apa yang dipakai?
[ ] Vendor/distribution apa?
[ ] Support policy bagaimana?
[ ] Target bytecode berapa?
[ ] JVM flags compatible?
[ ] GC logging configured?
[ ] Heap/non-heap/native memory accounted?
[ ] TLS/cert behavior verified?
[ ] Monitoring agent compatible?
[ ] App server/framework certified?
```

### 6.2 Artifact

```text
[ ] Artifact type apa: JAR/WAR/EAR/native/jlink?
[ ] Dependency packaging bagaimana?
[ ] Classpath/module path risk apa?
[ ] Build metadata ada?
[ ] Artifact immutable?
[ ] Checksum/digest ada?
[ ] Rollback artifact available?
```

### 6.3 Runtime Environment

```text
[ ] Process user siapa?
[ ] Working directory apa?
[ ] Writable paths apa?
[ ] Temp path cukup?
[ ] Dump path writable?
[ ] File descriptor limit cukup?
[ ] Signal handling benar?
[ ] Timezone/encoding explicit?
[ ] CA certificates present?
```

### 6.4 Container/Kubernetes

```text
[ ] Image base approved?
[ ] Non-root?
[ ] Memory limit vs heap benar?
[ ] Readiness/liveness/startup probes benar?
[ ] Graceful shutdown configured?
[ ] Resource request/limit realistic?
[ ] NetworkPolicy appropriate?
[ ] Rollout strategy selected?
[ ] Rollback tested?
```

### 6.5 App Server

```text
[ ] Server version certified?
[ ] WAR/EAR deployment path automated?
[ ] Datasource/JNDI binding correct?
[ ] Shared libraries documented?
[ ] Classloader policy understood?
[ ] Session behavior known?
[ ] Cluster rollout order defined?
[ ] Admin CLI evidence captured?
```

### 6.6 Database

```text
[ ] Migration tool used?
[ ] Migration classified?
[ ] Expand-contract followed?
[ ] Locks estimated?
[ ] Old app compatible with new schema?
[ ] New app compatible with old data?
[ ] Rollback/roll-forward realistic?
[ ] Validation query defined?
```

### 6.7 Stateful Workloads

```text
[ ] Session strategy?
[ ] Cache invalidation?
[ ] Queue ack semantics?
[ ] Consumer drain?
[ ] Scheduler behavior?
[ ] Job idempotency?
[ ] Distributed lock?
[ ] Duplicate processing risk?
```

### 6.8 Observability

```text
[ ] Version visible?
[ ] Logs structured?
[ ] Correlation ID?
[ ] Metrics available?
[ ] Traces available?
[ ] JVM telemetry?
[ ] Dashboard?
[ ] Alerts?
[ ] Diagnostic capture path?
```

### 6.9 Security

```text
[ ] No secrets in image/Git/logs?
[ ] Secret rotation defined?
[ ] Truststore/keystore lifecycle?
[ ] Admin endpoints protected?
[ ] JMX/debug ports restricted?
[ ] Image scanned?
[ ] SBOM available?
[ ] Runtime hardening?
```

### 6.10 Governance

```text
[ ] CR accurate?
[ ] Risk classified?
[ ] Approvals obtained?
[ ] Runbook linked?
[ ] Evidence plan?
[ ] Monitoring window?
[ ] Closure criteria?
[ ] PIR/RCA path?
```

---

## 7. Deployment Failure Taxonomy

A top-tier engineer thinks in failure categories.

### 7.1 Artifact Failure

Symptoms:

```text
ClassNotFoundException
NoClassDefFoundError
NoSuchMethodError
UnsupportedClassVersionError
bad manifest
missing dependency
wrong artifact version
```

Causes:

1. wrong build;
2. dependency mismatch;
3. Java target mismatch;
4. classpath conflict;
5. app server shared library conflict;
6. mutable tag.

### 7.2 Runtime Failure

Symptoms:

```text
JVM fails to start
invalid JVM option
GC flag error
illegal reflective access failure
TLS handshake issue
native library error
```

Causes:

1. Java version change;
2. removed flags;
3. missing modules;
4. OS/container incompatibility;
5. cert/truststore mismatch.

### 7.3 Config Failure

Symptoms:

```text
startup binding error
wrong endpoint
auth failure
timeout regression
pool exhaustion
feature unexpectedly enabled
```

Causes:

1. wrong profile;
2. missing env var;
3. wrong secret;
4. config precedence surprise;
5. stale ConfigMap/Secret;
6. manual config drift.

### 7.4 Infrastructure Failure

Symptoms:

```text
Pod Pending
ImagePullBackOff
CrashLoopBackOff
OOMKilled
CPU throttling
DNS failure
volume mount failure
ingress route failure
```

Causes:

1. insufficient resources;
2. registry auth;
3. node capacity;
4. wrong service account;
5. NetworkPolicy;
6. DNS/cache;
7. storage issue.

### 7.5 Probe/Lifecycle Failure

Symptoms:

```text
pod restarts during startup
traffic sent too early
rollout never completes
requests dropped during termination
```

Causes:

1. aggressive liveness;
2. fake readiness;
3. missing startup probe;
4. too-short termination grace;
5. no graceful shutdown;
6. slow dependency init.

### 7.6 Database Failure

Symptoms:

```text
migration hangs
app errors after migration
old app cannot rollback
DB locks
invalid objects
query latency spike
```

Causes:

1. destructive migration;
2. lock-heavy DDL;
3. missing index;
4. incompatible schema;
5. partial migration;
6. unexpected row volume.

### 7.7 Stateful Failure

Symptoms:

```text
duplicate messages
lost jobs
stuck scheduler
session loss
cache inconsistency
dead-letter spike
```

Causes:

1. no drain;
2. auto-ack too early;
3. non-idempotent processing;
4. local state;
5. rolling update with incompatible state;
6. leader election issue.

### 7.8 Observability Failure

Symptoms:

```text
deployment “looks okay” but users fail
no logs
no version label
metrics not split by version
smoke absent
```

Causes:

1. health-only verification;
2. no synthetic check;
3. poor logging;
4. missing correlation ID;
5. no release dashboard.

### 7.9 Governance Failure

Symptoms:

```text
CR says one thing, deployment did another
approval lacks artifact identity
rollback impossible
evidence missing
emergency changes common
```

Causes:

1. weak process;
2. manual bypass;
3. mutable artifact;
4. no risk classification;
5. no audit discipline.

---

## 8. Deployment Decision Framework

When facing any deployment decision, use this sequence.

### Step 1 — Identify Change Type

```text
code?
config?
runtime?
database?
secret/cert?
infrastructure?
traffic?
data?
stateful processing?
```

### Step 2 — Identify Blast Radius

```text
one instance?
one service?
one workflow?
one tenant?
all users?
external partners?
database-wide?
platform-wide?
```

### Step 3 — Identify Reversibility

```text
easy app rollback?
config rollback?
traffic rollback?
feature flag rollback?
DB/data forward-only?
secret rotation irreversible?
```

### Step 4 — Identify Compatibility Window

```text
will old and new coexist?
for how long?
what contracts must remain compatible?
```

### Step 5 — Identify Signals

```text
what proves success?
what detects failure?
what metric/log/trace/smoke?
```

### Step 6 — Choose Rollout Strategy

```text
rolling?
canary?
blue-green?
shadow?
ring?
maintenance recreate?
```

### Step 7 — Define Recovery

```text
rollback?
roll-forward?
disable flag?
pause consumers?
restore route?
DB fix?
```

### Step 8 — Define Evidence

```text
what must be captured before/during/after?
```

### Step 9 — Document Decision

```text
ADR if long-lived
CR if specific change
runbook if operational
checklist if repeated
```

---

## 9. Release Strategy Final Review

### Rolling Update

Good when:

1. stateless;
2. backward-compatible;
3. old/new coexist safe;
4. readiness accurate.

Bad when:

1. schema incompatible;
2. session state incompatible;
3. event format incompatible;
4. old/new cannot coexist.

### Blue-Green

Good when:

1. need quick traffic switch;
2. full environment validation;
3. rollback by route switch.

Bad when:

1. database shared and incompatible;
2. double capacity impossible;
3. background jobs duplicate;
4. state synchronization unclear.

### Canary

Good when:

1. risk moderate/high;
2. metrics by version exist;
3. traffic routing possible;
4. rollback by traffic shift.

Bad when:

1. no reliable metrics;
2. low traffic hides issues;
3. side effects irreversible;
4. users cannot be segmented.

### Shadow

Good when:

1. validate read-only behavior;
2. compare output;
3. no side effects.

Dangerous when:

1. writes occur;
2. external calls are duplicated;
3. emails/payments/messages emitted.

### Ring

Good when:

1. tenants/users can be segmented;
2. business rollout phased;
3. support can monitor pilot group.

Bad when:

1. data shared globally;
2. routing identity unreliable;
3. cross-tenant interactions exist.

---

## 10. Rollback Final Review

Rollback is not one thing.

### App Rollback

```text
deploy previous artifact/image
```

Usually easy if DB/config compatible.

### Config Rollback

```text
restore previous config
restart/reload app
```

May be harder if config changed external dependency behavior.

### Feature Flag Rollback

```text
disable feature
```

Fast, but only if state remains compatible.

### Traffic Rollback

```text
route back to old version/environment
```

Works for blue-green/canary if old environment still valid.

### DB Rollback

Often unsafe.

Prefer:

```text
expand-contract
app rollback only
forward fix
```

### Secret/Cert Rollback

May be impossible if external party already rotated.

Need dual-validity window.

### Queue/Scheduler Rollback

Must consider:

1. messages already emitted;
2. job partially processed;
3. retries;
4. idempotency;
5. dead-letter behavior.

---

## 11. Production Readiness Final Review

A Java service is production-ready when:

```text
it can be deployed
it can be configured
it can be observed
it can be scaled
it can be restarted
it can be rolled back
it can fail gracefully
it can be diagnosed
it can be audited
it has an owner
```

Not production-ready:

```text
it works on my machine
```

Not production-ready:

```text
it passed unit tests
```

Not production-ready:

```text
the pod is running
```

Production readiness includes operability.

---

## 12. Legacy vs Modern Mastery

Top-tier Java deployment engineer can operate both.

### Legacy Java 8 / App Server Skills

Need to understand:

1. WAR/EAR;
2. JNDI;
3. shared libraries;
4. app server classloading;
5. datasource binding;
6. session clustering;
7. admin CLI;
8. old JVM flags;
9. TLS legacy;
10. manual-to-automated migration.

### Modern Java 17/21/25 / Cloud-Native Skills

Need to understand:

1. container images;
2. Kubernetes probes;
3. resource limits;
4. graceful shutdown;
5. OpenTelemetry;
6. SBOM/signing;
7. GitOps;
8. canary;
9. policy as code;
10. virtual threads deployment implications.

The best engineers bridge both worlds.

They do not mock legacy systems.

They stabilize them, automate them, and migrate them safely.

---

## 13. What Separates Top 1% From Average?

### 13.1 They Think in Contracts

They define contracts between:

1. build and deploy;
2. artifact and runtime;
3. app and OS;
4. app and container;
5. app and Kubernetes;
6. app and database;
7. old and new version;
8. service and dependency;
9. team and governance;
10. deployment and audit.

### 13.2 They Think in Invariants

They ask:

```text
what must remain true no matter which version runs?
```

### 13.3 They Think in Failure Modes

They precompute failure paths before deployment.

### 13.4 They Think in Evidence

They know “success” must be provable.

### 13.5 They Think in Time

They understand:

1. startup time;
2. drain time;
3. readiness propagation;
4. DNS/cache delay;
5. secret projection delay;
6. migration duration;
7. monitoring window;
8. rollback duration.

### 13.6 They Think in State

They know:

1. DB state persists;
2. messages persist;
3. sessions persist;
4. caches may lie;
5. jobs may be mid-flight;
6. feature flags create behavioral state.

### 13.7 They Think in Human Systems

They design:

1. runbooks;
2. checklists;
3. escalation;
4. ownership;
5. communication;
6. approval;
7. learning loops.

---

## 14. The 10 Questions Before Any Production Deployment

Ask these every time.

### 1. What exactly is changing?

Not “backend”.

Exact:

```text
artifact, config, DB, runtime, secret, traffic, infra
```

### 2. What is the current known-good state?

Version, config, runtime, dependency, metrics.

### 3. What is the desired new state?

Version, config, runtime, schema, traffic, feature flags.

### 4. What can fail during transition?

Startup, readiness, DB, traffic, dependency, state, security.

### 5. How will we detect failure?

Logs, metrics, traces, smoke, synthetic, user signal.

### 6. How do we stop blast radius?

Canary, ring, flag, traffic shift, pause rollout.

### 7. How do we recover?

Rollback, roll-forward, disable flag, restore config, drain queues.

### 8. Is rollback actually safe?

Especially DB/data/secret/state.

### 9. What evidence proves success?

Runtime version, health, smoke, metrics, migration result, logs.

### 10. Who decides under ambiguity?

Decision owner, escalation, incident commander.

---

## 15. The Final Deployment Readiness Scorecard

Score each 0–2:

```text
0 = absent
1 = partial
2 = strong
```

### Artifact

```text
[ ] immutable artifact
[ ] image digest/checksum
[ ] build metadata
[ ] SBOM/scans
```

### Runtime

```text
[ ] Java version certified
[ ] JVM flags reviewed
[ ] memory model defined
[ ] diagnostics configured
```

### Environment

```text
[ ] config externalized
[ ] secrets controlled
[ ] environment parity understood
[ ] drift checked
```

### Platform

```text
[ ] probes correct
[ ] graceful shutdown
[ ] resource sizing
[ ] rollout strategy
```

### Data

```text
[ ] migration classified
[ ] backward compatibility
[ ] validation query
[ ] rollback/roll-forward
```

### State

```text
[ ] session/cache/queue/jobs analyzed
[ ] drain behavior
[ ] idempotency
[ ] duplicate risk
```

### Observability

```text
[ ] logs
[ ] metrics
[ ] traces
[ ] dashboard/alerts
[ ] version labels
```

### Security

```text
[ ] non-root/least privilege
[ ] admin endpoints restricted
[ ] secrets not leaked
[ ] image/dependency scanned
```

### Governance

```text
[ ] CR accurate
[ ] approval
[ ] runbook
[ ] evidence
[ ] closure criteria
```

Interpretation:

```text
0–20: dangerous
21–40: fragile
41–60: acceptable with risk
61–80: production mature
81+: high maturity
```

The scoring is not a universal standard, but it forces structured thinking.

---

## 16. Advanced Interview/System Design Lens

If asked:

> “How would you design deployment for Java services?”

A shallow answer:

```text
Use Docker and Kubernetes.
```

A strong answer:

```text
I would define runtime baseline, immutable artifacts, CI/CD, external config, secrets, Kubernetes probes, resource sizing, observability, and rollback.
```

A top-tier answer:

```text
I would first classify workloads: stateless APIs, stateful consumers, batch jobs, and legacy app server apps. Then I would define a build-once-promote-many artifact model with immutable JAR/WAR/image digests, runtime support matrix for Java 8–25, externalized config/secrets, database migration strategy using expand-contract, rollout strategy by risk, observability baseline with version-aware metrics/logs/traces, and governance that links CR, artifact, deployment evidence, and rollback. I would provide golden paths for Spring Boot Kubernetes services and legacy WAR deployments, while enforcing policy as code for non-root, signed images, no latest tags, probes, and resource definitions. Rollback would be designed per scope: app, config, traffic, DB, secret, queue, and feature flag.
```

This answer shows system thinking.

---

## 17. The Hidden Skill: Knowing When Not to Deploy

Top-tier deployment engineer knows when to stop.

Stop deployment if:

1. rollback artifact missing;
2. DB backup not verified;
3. migration not tested;
4. target environment already unstable;
5. monitoring unavailable;
6. required approver absent;
7. artifact identity unclear;
8. config diff unexpected;
9. dependency degraded;
10. runbook incomplete;
11. smoke test already failing before deployment;
12. secret/cert state uncertain;
13. old/new compatibility unknown;
14. incident ongoing.

Speed is valuable.

But speed into uncertainty is not engineering.

---

## 18. The Hidden Skill: Designing for Boring Deployments

The best deployment platform makes release boring.

Boring means:

1. no surprise;
2. known steps;
3. known signals;
4. known rollback;
5. known owners;
6. known evidence;
7. known failure modes.

Boring does not mean simple.

It means complexity is controlled.

Great deployment engineering turns dangerous changes into routine controlled operations.

---

## 19. The Hidden Skill: Managing Partial Success

Many deployment incidents are not total failure.

They are partial success:

```text
pods running but auth broken
app healthy but business flow broken
DB migrated but one consumer incompatible
canary good at low traffic but fails at peak
old and new versions coexist but cache inconsistent
feature flag disabled but data already written
```

Top-tier engineer asks:

```text
What does partial success look like?
How do we detect it?
What state has already changed?
Can we safely pause?
Can we safely rollback?
What must not be touched?
```

Partial success is harder than total failure.

---

## 20. The Hidden Skill: Separating Symptom, Cause, and Action

Symptom:

```text
pod restarted
```

Possible causes:

1. OOMKilled;
2. liveness failure;
3. app crash;
4. node eviction;
5. config error;
6. dependency timeout during startup.

Bad action:

```text
restart again
```

Good process:

```text
capture previous logs
describe pod
check events
check exit code
check memory
check probe history
check startup logs
then decide
```

Never let symptom directly trigger action without diagnosis, unless safety demands immediate rollback.

---

## 21. Final Anti-Pattern Catalog

### 21.1 Mutable Production Tag

```text
image: service:latest
```

### 21.2 Environment-Specific Build

```text
build prod artifact separately
```

### 21.3 Config Hidden Inside Artifact

```text
application-prod.properties packaged into JAR
```

### 21.4 Fake Health Check

```text
/health always returns OK
```

### 21.5 Aggressive Liveness

Kills slow Java startup.

### 21.6 No Graceful Shutdown

Drops in-flight requests/messages.

### 21.7 Xmx Equals Container Limit

Causes OOMKilled.

### 21.8 Manual DB Script Without Migration History

Destroys traceability.

### 21.9 Rollback Plan Ignores DB

False safety.

### 21.10 No Version Metadata

Cannot prove what runs.

### 21.11 No Synthetic Check

Health passes but business broken.

### 21.12 Direct Production Hotfix

No artifact traceability.

### 21.13 Shared Production Account

No accountability.

### 21.14 Heap Dump in CR Attachment

Potential PII/secret leakage.

### 21.15 Kubernetes Migration Without Operability

Containerized fragility.

---

## 22. Final Design Pattern Catalog

### 22.1 Build Once, Promote Many

Same artifact across environments.

### 22.2 Immutable Artifact Identity

Version + digest + commit.

### 22.3 Externalized Config

Environment changes without rebuilding.

### 22.4 Expand-Contract DB Migration

Backward-compatible schema evolution.

### 22.5 Version-Aware Observability

Metrics/logs/traces tagged by version.

### 22.6 Readiness as Traffic Gate

Only ready instances receive traffic.

### 22.7 Startup Probe for Slow Java

Avoid premature liveness restarts.

### 22.8 Graceful Shutdown

Finish in-flight work.

### 22.9 Canary for High-Risk Change

Limit blast radius.

### 22.10 Feature Flag as Runtime Safety Valve

Disable behavior without artifact rollback.

### 22.11 Runbook as State Machine

Steps + branches + stop conditions.

### 22.12 ADR for Long-Lived Decisions

Decision memory.

### 22.13 Policy as Code

Automate recurring controls.

### 22.14 Evidence as Artifact

Deployment success is provable.

### 22.15 Incident Feedback Loop

Failed deployment improves platform.

---

## 23. Mastery Exercise 1 — Diagnose Deployment Failure

Scenario:

```text
After deploying Java 21 Spring Boot service to Kubernetes:
- rollout completes;
- readiness OK;
- users report intermittent 500;
- logs show NoSuchMethodError;
- only some pods show error.
```

Reasoning:

1. rollout success only means pods ready;
2. intermittent suggests version skew, traffic subset, or dependency path;
3. `NoSuchMethodError` suggests library version mismatch;
4. only some pods suggests not all pods run same artifact or path-specific classloading;
5. check image digest per pod;
6. check build metadata;
7. check dependency tree;
8. check config enabling path only on some pods;
9. pause rollout;
10. rollback if new version causes user impact.

Learning:

```text
Readiness does not catch all classpath/runtime incompatibilities.
Need smoke/synthetic exercising affected code path.
Need version label and artifact digest per pod.
```

---

## 24. Mastery Exercise 2 — Choose Deployment Strategy

Scenario:

```text
A Java service adds optional field to API response and additive DB column.
Old clients tolerate unknown fields.
Feature is behind flag.
```

Recommended:

```text
rolling or canary depending business criticality
```

Why:

1. DB migration additive;
2. old app compatible;
3. old clients tolerate unknown field;
4. flag reduces risk;
5. rollback app-only safe.

Verification:

1. migration result;
2. readiness;
3. smoke;
4. flag-off behavior;
5. flag-on smoke tenant;
6. metrics.

---

## 25. Mastery Exercise 3 — Identify Unsafe Rollback

Scenario:

```text
Deployment renames column CASE_STATUS to STATUS.
New app deployed.
Some new records created.
Failure detected.
Team wants to rollback app.
```

Unsafe because:

1. old app expects `CASE_STATUS`;
2. column renamed;
3. new records may use new shape;
4. rollback app may fail or corrupt behavior.

Better:

1. avoid direct rename;
2. use expand-contract;
3. if already happened, consider roll-forward fix;
4. involve DBA;
5. freeze writes if needed;
6. capture DB state.

---

## 26. Mastery Exercise 4 — Legacy Modernization

Scenario:

```text
Java 8 WAR on Tomcat manually copied to server.
No version endpoint.
Rollback is replacing WAR manually.
Logs in local file.
```

Do not jump immediately to Kubernetes.

Stabilization path:

1. artifact repository;
2. checksum/version;
3. scripted deploy;
4. symlink or controlled WAR deployment;
5. runbook;
6. health/smoke;
7. central logs;
8. config externalized;
9. CI build;
10. app server CLI deployment;
11. runtime compatibility review;
12. then consider containerization.

---

## 27. Mastery Exercise 5 — Secret Rotation

Scenario:

```text
OAuth client secret expires tomorrow.
Java service reads secret from env var at startup.
```

Plan:

1. create emergency/expedited CR;
2. add new secret at provider;
3. update secret source;
4. restart service in controlled rolling manner;
5. verify token request;
6. smoke auth flow;
7. monitor auth failures;
8. revoke old secret after dual-validity window;
9. attach evidence;
10. create expiry monitoring action.

Risk:

```text
rollback may fail if old secret revoked
```

So sequence matters.

---

## 28. The Deployment Engineer’s Personal Operating System

To operate at high level, build your own habit loop.

### Before Deployment

```text
understand change
map affected state
check rollback
check observability
check runbook
check evidence
```

### During Deployment

```text
execute slowly enough to observe
watch leading indicators
communicate status
pause on ambiguity
capture evidence
```

### After Deployment

```text
verify beyond health
monitor through window
close evidence
note deviations
update runbook/checklist
```

### After Failure

```text
stabilize first
diagnose with evidence
avoid blame
fix systemic gap
add guardrail
```

---

## 29. Deployment Language Precision

Use precise language.

Avoid:

```text
deploy code
```

Say:

```text
deploy image digest sha256:... for service X to environment Y
```

Avoid:

```text
rollback database
```

Say:

```text
rollback app only; leave additive schema in place
```

Avoid:

```text
health is OK
```

Say:

```text
readiness passed on all new pods, smoke workflow passed, 5xx baseline stable
```

Avoid:

```text
config updated
```

Say:

```text
ConfigMap version prod-20260618-01 applied and pods restarted
```

Precision reduces incident ambiguity.

---

## 30. What to Memorize vs What to Systematize

Do not memorize every command.

Systematize:

1. decision frameworks;
2. checklists;
3. runbooks;
4. templates;
5. dashboards;
6. scripts;
7. policies.

Memorize invariants and failure patterns.

Tools change.

Invariants remain.

---

## 31. Final Learning Map

After this series, your learning can continue in adjacent directions:

### 31.1 Platform Engineering

1. golden paths;
2. internal developer platform;
3. service catalog;
4. backstage;
5. policy as code;
6. multi-cluster deployment.

### 31.2 SRE

1. SLO/error budget;
2. incident command;
3. reliability testing;
4. chaos engineering;
5. capacity planning;
6. toil reduction.

### 31.3 Security Engineering

1. supply chain security;
2. artifact signing;
3. SLSA;
4. admission control;
5. secrets lifecycle;
6. runtime threat detection.

### 31.4 Database Reliability

1. online schema migration;
2. zero-downtime migration;
3. replication;
4. backup/restore drills;
5. data correction governance.

### 31.5 Legacy Modernization

1. strangler pattern;
2. app server migration;
3. Java 8 to 17/21;
4. modularization;
5. containerization strategy.

### 31.6 Release Engineering

1. progressive delivery;
2. release orchestration;
3. automated verification;
4. change risk scoring;
5. fleet deployment.

---

## 32. Final Compact Model

If you need to compress the entire series into one diagram:

```text
Source
  ↓
Build
  ↓
Artifact
  ↓
Verify / Scan / Sign
  ↓
Release Candidate
  ↓
Approval / Risk / CR
  ↓
Deploy Manifest
  ↓
Runtime Environment
  ↓
Traffic
  ↓
State / Data
  ↓
Observability
  ↓
Verification
  ↓
Rollback or Closure
  ↓
Evidence
  ↓
Learning
```

At every arrow, ask:

```text
what can fail?
how do we know?
how do we recover?
how do we prove?
```

---

## 33. Final Top 1% Principles

1. **Never deploy what you cannot identify.**
2. **Never change what you cannot observe.**
3. **Never rely on rollback you have not reasoned through.**
4. **Never treat DB rollback as equivalent to app rollback.**
5. **Never let readiness lie.**
6. **Never make liveness punish startup.**
7. **Never ignore graceful shutdown.**
8. **Never bury config inside artifact.**
9. **Never let secrets leak into evidence.**
10. **Never let CR scope differ from real change.**
11. **Never let governance become theater.**
12. **Never let automation hide risk.**
13. **Never let legacy become undocumented magic.**
14. **Never close deployment on rollout status alone.**
15. **Never waste an incident; convert it into a guardrail.**

---

## 34. Final Summary

Java deployment mastery is not about knowing one tool.

It is about understanding the entire chain:

```text
code → artifact → runtime → environment → traffic → state → data → observability → recovery → governance
```

A top-tier Java deployment engineer can:

1. package correctly;
2. choose runtime intentionally;
3. deploy safely;
4. configure explicitly;
5. size resources realistically;
6. handle Kubernetes lifecycle;
7. support legacy app servers;
8. evolve database safely;
9. manage stateful workloads;
10. rotate secrets/certs;
11. observe production;
12. verify deployment;
13. rollback/roll-forward;
14. secure the supply chain;
15. produce audit evidence;
16. write runbooks/ADRs/checklists;
17. design deployment platforms;
18. learn from incidents.

The most important final idea:

> Deployment is not the last step of software engineering.  
> Deployment is where software engineering meets reality.

If the system cannot be safely deployed, operated, observed, and recovered, it is not truly production-ready.

---

## 35. Series Completion

This completes:

```text
learn-java-deployment-runtime-release-delivery-engineering
```

Completed parts:

1. Part 0 — Deployment Mental Model
2. Part 1 — Java Deployment Evolution: Java 8 to Java 25
3. Part 2 — Artifact Taxonomy
4. Part 3 — Runtime Selection Engineering
5. Part 4 — Java Runtime Layout
6. Part 5 — Configuration Deployment
7. Part 6 — JVM Options as Deployment Contract
8. Part 7 — Packaging for Linux Servers
9. Part 8 — Containerizing Java Applications Correctly
10. Part 9 — Dockerfile Patterns for Java 8–25
11. Part 10 — jlink, jdeps, jpackage, and Custom Runtime Images
12. Part 11 — Classpath, Module Path, ClassLoader, and Deployment Failure Modes
13. Part 12 — Application Server and Servlet Container Deployment
14. Part 13 — Spring Boot Deployment Deep Dive
15. Part 14 — Kubernetes Deployment for Java Applications
16. Part 15 — Kubernetes Probes, Graceful Shutdown, and Traffic Draining
17. Part 16 — Resource Sizing
18. Part 17 — Release Strategy
19. Part 18 — Database-Aware Deployment and Schema Migration
20. Part 19 — Stateful Java Deployment
21. Part 20 — Configuration, Secret Rotation, Certificate Rotation, and Truststore Deployment
22. Part 21 — Observability-Ready Deployment
23. Part 22 — Deployment Verification
24. Part 23 — CI/CD Pipeline for Java Deployment
25. Part 24 — Supply Chain Security
26. Part 25 — Deployment Security Hardening
27. Part 26 — Multi-Environment Deployment
28. Part 27 — Multi-Service and Distributed Java Deployment
29. Part 28 — Legacy Java Deployment
30. Part 29 — Modern Java Deployment
31. Part 30 — Failure Modeling
32. Part 31 — Runbook Engineering
33. Part 32 — Enterprise Governance
34. Part 33 — Deployment ADR and Checklists
35. Part 34 — Capstone Deployment Platform
36. Part 35 — Final Mastery Review

Note: Numbering in file names starts from Part 00, while the conceptual list includes Part 0 through Part 35.

---

## 36. References and Further Reading

- Kubernetes Documentation — Deployments: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/
- Kubernetes Documentation — Pod Lifecycle: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
- Kubernetes Documentation — Probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Spring Boot Documentation — Actuator: https://docs.spring.io/spring-boot/reference/actuator/index.html
- Spring Boot Documentation — Graceful Shutdown: https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html
- OpenTelemetry Java Agent: https://opentelemetry.io/docs/zero-code/java/agent/
- OpenJDK JEP 444 — Virtual Threads: https://openjdk.org/jeps/444
- Oracle Java Documentation — Java command and JVM options: https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html
- Google SRE Book: https://sre.google/sre-book/table-of-contents/
- NIST Secure Software Development Framework SP 800-218: https://csrc.nist.gov/pubs/sp/800/218/final
- OpenSSF SLSA: https://slsa.dev/
- CycloneDX: https://cyclonedx.org/
- Thoughtworks — Lightweight Architecture Decision Records: https://www.thoughtworks.com/radar/techniques/lightweight-architecture-decision-records

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-deployment-runtime-release-delivery-engineering — Part 34](./learn-java-deployment-runtime-release-delivery-engineering-part-34-capstone-designing-java-deployment-platform.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dsa-part-000.md](../dsa/learn-java-dsa-part-000.md)

</div>