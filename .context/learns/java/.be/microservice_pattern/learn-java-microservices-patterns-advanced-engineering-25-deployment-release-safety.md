# Part 25 — Deployment Pattern and Release Safety

**Series:** `learn-java-microservices-patterns-advanced-engineering`  
**File:** `learn-java-microservices-patterns-advanced-engineering-25-deployment-release-safety.md`  
**Scope:** Java 8–25, microservices, release engineering, deployment safety, compatibility, rollback/roll-forward, runtime readiness, operational governance.  
**Position in series:** Part 25 of 35.

---

## 0. Why This Part Exists

Microservices promise **independent deployment**. In practice, many organizations only achieve **independent build artifacts**, not independent safe release.

A service is not truly independently deployable if every release requires:

- coordinating five other teams,
- manually checking consumer compatibility,
- deploying database migration at exactly the same second,
- disabling traffic manually,
- asking QA to run a full regression suite across the whole platform,
- hoping that old consumers and new providers never overlap,
- hoping that rollback will work even after data has changed,
- hoping that in-flight workflows are not broken.

That is not microservices maturity. That is a distributed release train with extra operational cost.

This part teaches deployment and release safety as an architectural discipline. The central question is not:

> How do I deploy a Java service?

The real question is:

> How do I make a Java microservice safely releasable while old versions, new versions, old data, new data, old consumers, new consumers, in-flight requests, in-flight messages, long-running workflows, database migrations, caches, projections, and operators all coexist?

A top-tier engineer treats deployment as a **compatibility, correctness, observability, and risk-control problem**.

---

## 1. Core Mental Model

Deployment and release are different things.

| Concept | Meaning | Example |
|---|---|---|
| Build | Produce an artifact | JAR, container image, native binary |
| Deploy | Put artifact into runtime | Kubernetes Deployment rollout |
| Release | Expose behavior to users/traffic | Enable feature flag for 10% users |
| Rollback | Revert runtime artifact or traffic | Route back to previous version |
| Roll-forward | Deploy a corrective version | Patch bug with v42.1 |
| Migration | Change schema/data/config/contract | Add nullable column |
| Cutover | Switch authority/path | Route new submissions to new service |
| Promotion | Move artifact/config across environments | DEV → UAT → PROD |

The dangerous mistake is treating deployment as the same as release.

A safer model:

```text
Code merged
  -> artifact built
  -> artifact tested
  -> artifact deployed dark
  -> runtime becomes healthy
  -> feature remains disabled
  -> limited traffic enabled
  -> telemetry checked
  -> wider rollout
  -> old path retired later
```

In mature microservices, the safest release is often:

```text
Deploy first. Release later.
```

This is why feature flags, backward-compatible schema changes, readiness probes, canary deployments, shadow traffic, observability, and rollback strategy belong together.

---

## 2. Deployment Independence Is Not Binary

A service can be independent at one layer but dependent at another.

| Layer | Independent if... | Coupled if... |
|---|---|---|
| Code | service can be compiled alone | shared library changes force all services |
| Artifact | service has own deployable artifact | bundled monorelease artifact |
| Runtime | can restart/scale alone | shared runtime process/container |
| Contract | old/new clients remain compatible | provider deploy breaks consumers |
| Data | schema changes do not break old code | migration requires simultaneous code switch |
| Workflow | in-flight workflows survive version change | old workflow state cannot be interpreted |
| Operations | team can deploy and observe own service | centralized manual release coordination |
| Security | credentials/certs rotate per service | shared secrets across platform |

The goal is not maximum independence everywhere. The goal is **safe independence where change frequency and risk justify it**.

---

## 3. The Release Safety Stack

Release safety is a stack of controls.

```text
Source control discipline
  -> build reproducibility
  -> artifact immutability
  -> automated tests
  -> contract compatibility
  -> database migration safety
  -> deployment strategy
  -> runtime readiness
  -> traffic shaping
  -> feature flagging
  -> observability
  -> rollback / roll-forward plan
  -> post-release verification
```

If one layer is weak, the others must compensate.

For example:

- weak contract testing requires slower rollout and stronger monitoring,
- risky database migration requires expand-contract and feature flags,
- poor observability makes canary meaningless,
- no rollback strategy requires stronger pre-production validation,
- slow startup requires startup probes and longer rollout windows,
- long-running workflows require versioned process definitions.

---

## 4. Build Artifact Immutability

A release-safe system starts with immutable artifacts.

Bad pattern:

```text
Build once for DEV
Modify properties inside artifact
Rebuild for UAT
Rebuild for PROD
```

This means PROD is not running the same artifact that was tested.

Better pattern:

```text
Build once
Tag immutably
Sign/scan artifact
Promote same artifact across environments
Inject environment-specific config at runtime
```

For Java:

```text
source code -> JAR -> container image -> image digest -> promoted release candidate
```

Use image digest, not only mutable tags:

```text
registry.example.com/application-service@sha256:...
```

Tags like `latest`, `prod`, or `stable` are convenient but dangerous as release evidence.

### Java-specific artifact considerations

| Java generation | Release concern |
|---|---|
| Java 8 | legacy dependency graph, old TLS defaults, classpath conflicts |
| Java 11 | common migration baseline, stronger container awareness than Java 8 |
| Java 17 | modern LTS baseline, sealed classes/records available from previous features |
| Java 21 | virtual threads available, runtime behavior may alter concurrency limits |
| Java 25 | latest GA/LTS-era runtime; validate library, agent, profiler, APM compatibility before rollout |

Java 25 reached General Availability on 16 September 2025 according to OpenJDK, but production adoption should still validate framework, agents, container base image, GC behavior, security provider, and operational tooling compatibility before fleet-wide rollout.

---

## 5. Environment Promotion

A mature pipeline promotes **artifacts**, not source branches.

```text
Commit
  -> CI build
  -> unit/component/contract tests
  -> image produced
  -> scan/sign/SBOM
  -> deploy to DEV
  -> deploy same digest to UAT
  -> deploy same digest to PROD
```

Environment-specific differences should be explicit:

- config values,
- secrets,
- endpoints,
- scaling limits,
- feature flag state,
- database URL,
- external system credentials,
- observability sink.

They should not be hidden in different code builds.

### Environment parity principle

Environment parity does not mean DEV has the same size as PROD. It means the **failure-relevant behavior** is comparable.

Examples:

| Concern | Needs parity? | Why |
|---|---:|---|
| Runtime Java version | Yes | classloading, GC, TLS, threading behavior |
| DB engine/version | Yes | SQL, locking, migration behavior |
| Messaging semantics | Yes | ack/retry/DLQ behavior |
| Feature flag framework | Yes | release path must be tested |
| Full data volume | Not always | but performance tests need representative volume |
| Node count | Not always | but HA/rolling behavior needs multi-replica test |
| External system | Usually simulated/stubbed in lower env | but contract and timeout behavior must be realistic |

---

## 6. Deployment Strategies

Deployment strategy is how new runtime versions replace or coexist with old versions.

### 6.1 Recreate Deployment

```text
Stop old version
Start new version
```

Simple but causes downtime unless the service is not user-facing or has redundancy elsewhere.

Use for:

- internal batch worker,
- offline admin tool,
- low-criticality service,
- environment where downtime is acceptable.

Avoid for:

- user-facing API,
- gateway/BFF,
- critical workflow processor,
- service with strict availability target.

### 6.2 Rolling Deployment

Rolling deployment incrementally replaces old instances with new instances.

```text
v1 v1 v1 v1
v2 v1 v1 v1
v2 v2 v1 v1
v2 v2 v2 v1
v2 v2 v2 v2
```

Kubernetes Deployment rolling update is a common implementation. Kubernetes documents rolling update as replacing old Pods incrementally so an application can update without downtime when configured correctly.

Key requirements:

- multiple replicas,
- correct readiness probe,
- graceful shutdown,
- backward-compatible contract,
- old and new versions can coexist,
- no destructive database migration during rollout,
- load balancer respects readiness.

Rolling deployment is unsafe when old and new versions cannot coexist.

Example unsafe change:

```text
v1 expects column `status`
v2 migration renames `status` to `application_status`
rolling deploy creates mixed v1/v2 window
v1 crashes after migration
```

Fix with expand-contract migration.

### 6.3 Blue-Green Deployment

Two production-like environments exist:

```text
Blue  = current live
Green = new candidate
```

Traffic switch happens at edge/load balancer level.

Benefits:

- quick traffic rollback,
- full environment validation before switch,
- less mixed-version runtime during switch.

Costs:

- duplicated infrastructure,
- database compatibility still hard,
- stateful systems still require careful cutover,
- not always trivial with long-lived connections and async consumers.

Blue-green does not solve data migration safety by itself.

### 6.4 Canary Release

Canary release exposes new version to a small subset of traffic first.

```text
1% traffic -> v2
99% traffic -> v1
observe
5% -> v2
25% -> v2
50% -> v2
100% -> v2
```

Canary is useful when:

- traffic can be split safely,
- telemetry can distinguish canary vs stable,
- failure signal appears quickly enough,
- user impact can be limited,
- old and new versions can coexist.

Canary is weak when:

- low traffic hides bugs,
- bug only appears on rare tenant/data shape,
- state mutation by canary cannot be rolled back,
- database migration affects all traffic,
- metrics are too slow/noisy.

### 6.5 Shadow Traffic

Shadow traffic sends a copy of real production traffic to a new version, but responses are not returned to users.

```text
user request -> v1 -> user response
             -> v2 shadow -> discard response / compare
```

Use for:

- validating new read path,
- performance comparison,
- serialization compatibility,
- algorithm comparison,
- migration confidence.

Be careful:

- shadow service must not perform real side effects,
- external calls must be disabled/stubbed,
- message publish must be suppressed,
- writes must go to isolated storage or dry-run mode,
- PII handling must be approved.

### 6.6 Dark Launch

Deploy code and infrastructure, but keep behavior disabled.

```text
v2 deployed
feature flag OFF
runtime warm
observability active
feature turned on later
```

Dark launch reduces risk because deployment and behavioral release are separated.

### 6.7 Feature-Flagged Release

Feature flags allow runtime control of behavior.

Common flag types:

| Flag type | Purpose | Example |
|---|---|---|
| Release flag | hide incomplete feature | `newReviewFlow.enabled` |
| Ops flag | kill switch | `externalVerification.enabled` |
| Experiment flag | A/B test | `searchRanking.variant` |
| Permission flag | tenant/user entitlement | `tenant.caseBulkAction.enabled` |
| Migration flag | route to old/new implementation | `useNewProjectionService` |

Feature flags are powerful but dangerous if unmanaged.

Risks:

- stale flags,
- flag explosion,
- untested flag combinations,
- hidden production-only behavior,
- authorization confused with feature entitlement,
- flags used as permanent architecture.

A production-ready flag has:

- owner,
- purpose,
- default,
- expiry/removal date,
- allowed values,
- audit trail,
- emergency override,
- test coverage for important states.

---

## 7. Database Migration Safety

Database changes are the most common reason microservices are not independently deployable.

### 7.1 Dangerous migration types

| Change | Risk |
|---|---|
| Drop column | old code may still read it |
| Rename column | old code breaks immediately |
| Change column type | old code/driver may fail |
| Add NOT NULL without default | existing inserts fail |
| Tighten constraint | old writes rejected |
| Rebuild large index online incorrectly | lock/performance incident |
| Change enum values | old code cannot parse |
| Data backfill in single transaction | locks, undo pressure, replication lag |

### 7.2 Expand-Contract Pattern

Safe schema evolution usually follows expand-contract.

#### Step 1 — Expand

Add new structure without breaking old code.

```sql
ALTER TABLE application ADD review_status VARCHAR(50);
```

Old code still uses `status`. New code can write both.

#### Step 2 — Dual write / backfill

```text
new writes: status + review_status
old rows: background backfill review_status
```

#### Step 3 — Switch read path

Feature flag or versioned code reads from `review_status`.

#### Step 4 — Stop old write

After confidence, stop writing `status`.

#### Step 5 — Contract

After all old versions are gone and retention window passes:

```sql
ALTER TABLE application DROP COLUMN status;
```

The contract phase is delayed intentionally.

### 7.3 Forward-only migrations

In microservices, database rollback is often harder than code rollback.

Safer principle:

```text
Prefer forward-compatible migrations and roll-forward fixes.
```

Rollback is still useful, but assume:

- data may have been transformed,
- new rows may use new schema,
- old code may not understand new values,
- external side effects may already have happened.

### 7.4 Migration ownership

Only the owning service should migrate its private schema.

Bad:

```text
central DBA changes all schemas for all services without service owner release plan
```

Better:

```text
service owner ships schema migration with service release lifecycle
DBA reviews operational risk for high-impact changes
```

### 7.5 Backfill design

Large backfill should be treated as production workload.

Rules:

- chunk data,
- checkpoint progress,
- throttle load,
- observe lag/locks/CPU/IO,
- make idempotent,
- support resume,
- avoid huge single transaction,
- separate schema change from data migration where possible.

Example checkpoint table:

```sql
CREATE TABLE migration_checkpoint (
  migration_name VARCHAR(200) PRIMARY KEY,
  last_processed_id BIGINT,
  updated_at TIMESTAMP
);
```

---

## 8. Contract Compatibility During Release

Deployment safety depends on compatibility windows.

During a rolling/canary release, these combinations may exist:

```text
old client -> old provider
old client -> new provider
new client -> old provider
new client -> new provider
```

If any combination breaks, the deployment is unsafe.

### 8.1 API compatibility rules

Generally safe:

- add optional response field,
- add optional request field,
- add new endpoint,
- accept wider input,
- return documented error code,
- add enum value only if consumers are tolerant.

Generally unsafe:

- remove field,
- rename field,
- change field type,
- make optional field required,
- change semantic meaning,
- return new enum to strict consumer,
- change error contract unexpectedly.

### 8.2 Event compatibility rules

Safe event evolution is stricter because consumers may replay old messages.

Rules:

- never change meaning of existing field,
- add optional field,
- avoid removing fields until all consumers and replay windows are safe,
- version event schema when semantics change,
- keep unknown-field tolerant consumers,
- keep replay safety.

### 8.3 Semantic compatibility

A contract can be syntactically compatible but semantically breaking.

Example:

```json
{
  "status": "APPROVED"
}
```

Old meaning:

```text
approved by officer
```

New meaning:

```text
approved by automated pre-screening
```

Same field. Same value. Different business meaning. Breaking change.

Top-tier engineers review semantic compatibility, not only schema diff.

---

## 9. Runtime Readiness and Graceful Shutdown

Deployment safety is not only about code. It depends on how runtime joins and leaves traffic.

### 9.1 Readiness

Readiness answers:

> Should this instance receive traffic now?

A service is ready only when:

- HTTP server started,
- dependencies needed for serving are reachable or degradation policy is active,
- DB pool initialized,
- migrations handled or not needed,
- caches required for correctness loaded,
- message consumers ready if they are part of workload,
- service has registered metrics/tracing/logging.

Readiness should fail when receiving traffic would cause user-visible failure.

### 9.2 Liveness

Liveness answers:

> Should the platform restart this instance?

Liveness should not fail just because a dependency is temporarily down. Otherwise, dependency outage causes all services to restart and worsen the incident.

Bad liveness:

```text
liveness = database reachable AND redis reachable AND external API reachable
```

Better liveness:

```text
liveness = process event loop responsive AND JVM not deadlocked AND app can make progress internally
```

### 9.3 Startup probe

Startup probe protects slow-starting applications from premature liveness failure.

Useful for:

- large Spring Boot apps,
- JIT warmup-sensitive services,
- services with schema validation,
- native vs JVM startup differences,
- cold cache initialization.

### 9.4 Graceful shutdown

During shutdown:

```text
SIGTERM received
  -> stop accepting new traffic
  -> readiness becomes false
  -> drain in-flight requests
  -> stop message consumption
  -> finish/commit/ack safe work
  -> close pools
  -> exit before termination grace period
```

Unsafe shutdown causes:

- duplicate processing,
- partial side effects,
- broken long requests,
- message redelivery storm,
- transaction rollback spike,
- client retry amplification.

### 9.5 Message consumer shutdown

For message-driven services:

```text
stop polling/consuming
finish current message or checkpoint safely
commit offset / ack only after durable business effect
close consumer
```

Never ack before durable effect unless loss is acceptable.

---

## 10. Rollback vs Roll-Forward

Rollback means returning to previous artifact/config/traffic path.

Roll-forward means deploying a new corrective change.

### 10.1 When rollback works well

Rollback is effective when:

- no irreversible data change occurred,
- old code understands new data,
- external side effects were not triggered,
- contract remains backward compatible,
- previous artifact still available,
- config/secrets still valid,
- runtime route can switch quickly.

### 10.2 When rollback is dangerous

Rollback may fail when:

- schema was contracted,
- new enum values were persisted,
- messages emitted by new version cannot be consumed by old version,
- cache format changed,
- workflow state format changed,
- external notifications/payments/emails were sent,
- old binary is incompatible with current infrastructure/security baseline.

### 10.3 Roll-forward as primary strategy

Many mature systems prefer roll-forward for data-affecting releases.

That requires:

- fast build pipeline,
- small changes,
- strong observability,
- feature flags,
- safe migrations,
- on-call ownership,
- tested emergency patch path.

Rollback and roll-forward should both be planned.

---

## 11. Release Train vs Independent Release

Microservices do not automatically mean every service deploys independently all the time.

### Release train

A release train coordinates multiple services into one scheduled release.

Useful when:

- organization is still transitioning,
- regulatory approval requires grouped release,
- many changes are tightly coupled,
- operational maturity is low,
- downstream environment windows are strict.

Risk:

- slow feedback,
- large blast radius,
- cross-team waiting,
- harder rollback,
- accumulated change complexity.

### Independent release

Each service can release when ready.

Requires:

- strong ownership,
- contract compatibility,
- automated tests,
- safe database migration,
- observability,
- deployment automation,
- runtime isolation,
- clear incident response.

A realistic enterprise often uses hybrid:

```text
low-risk service changes -> independent release
cross-service workflow changes -> coordinated release window
regulatory/high-risk changes -> controlled release train
```

The goal is not ideology. The goal is risk-appropriate release governance.

---

## 12. Dependency Release Ordering

Some changes require release ordering.

### 12.1 Provider-first compatible change

If provider adds optional response field:

```text
provider v2 deploys first
consumer can adopt later
```

### 12.2 Consumer-first tolerant change

If provider will later return new enum value:

```text
consumer v2 tolerant reader deploys first
provider v2 emits new enum later
```

### 12.3 Database expand-contract ordering

```text
1. schema expand
2. app writes both old and new
3. backfill
4. app reads new
5. app stops old writes
6. schema contract later
```

### 12.4 Event migration ordering

```text
1. consumers accept old + new event version
2. producer emits old + new or new version
3. verify consumers
4. stop old event
5. remove old consumer support after replay/retention window
```

### 12.5 Workflow version ordering

```text
1. deploy engine capable of running old + new definitions
2. start new instances on new definition
3. allow old instances to finish or migrate explicitly
4. remove old definition only after no live instances remain
```

---

## 13. Progressive Delivery

Progressive delivery means gradually exposing a change while using automated or human judgment to decide whether to continue.

Typical stages:

```text
0% users: deployed dark
internal users
1% traffic
5% traffic
25% traffic
50% traffic
100% traffic
cleanup
```

Each stage needs promotion criteria.

Example criteria:

```text
error rate not worse than baseline by > 0.5%
p95 latency not worse than baseline by > 10%
no increase in 5xx
no increase in business validation failures
no DLQ spike
no unusual database lock wait
no tenant-specific anomaly
no security/auth rejection spike
```

Canary without automated or disciplined observation is just slow failure.

---

## 14. Release Observability

Every release should be observable as a first-class event.

Emit deployment metadata:

```text
service.name
service.version
git.commit
build.number
image.digest
java.version
framework.version
deployment.environment
deployment.time
feature.flag.snapshot
schema.version
```

Use dimensions carefully to avoid unbounded cardinality.

### Release dashboard

A release dashboard should show:

- version distribution,
- request rate by version,
- error rate by version,
- latency by version,
- dependency errors by version,
- DB pool usage by version,
- GC/CPU/memory by version,
- message lag by version,
- DLQ count,
- business failure metrics,
- feature flag state,
- deployment events annotated on charts.

### Business correctness metrics

Technical metrics are not enough.

Examples:

- application submissions per minute,
- approval transition failures,
- duplicate submission attempts,
- stuck workflow count,
- compensation count,
- reconciliation mismatch count,
- unauthorized access rejection rate,
- tenant-specific anomaly.

---

## 15. Release Safety for Long-Running Workflows

Long-running workflows complicate deployment.

A workflow instance may outlive many service versions.

Risks:

- old state cannot be interpreted,
- new code expects new step field,
- old timer semantics change,
- compensation logic changes,
- external callback arrives for old workflow version,
- in-flight human task changes meaning.

Rules:

1. Version workflow definitions.
2. Keep old handlers until old instances finish or migrate.
3. Make migration explicit, audited, and reversible where possible.
4. Separate workflow state schema from transient code DTOs.
5. Do not delete old transition logic too early.
6. Treat human task forms as versioned contracts.
7. Track workflow instances by definition version.

Example:

```text
ApplicationApprovalWorkflow:v1
ApplicationApprovalWorkflow:v2
```

New applications start on v2. Existing v1 applications either finish on v1 or migrate through a controlled command.

---

## 16. Release Safety for Messaging Systems

Message-driven systems have their own release hazards.

### 16.1 Consumer compatibility

A consumer may read:

- old messages produced before deploy,
- new messages produced by new producer,
- replayed historical messages,
- poison messages from previous bugs.

Consumer must be tolerant across retention/replay window.

### 16.2 Producer rollout

Producer change should consider:

- schema compatibility,
- topic routing,
- partition key stability,
- ordering implications,
- outbox format,
- consumer readiness.

### 16.3 Consumer rollout

Consumer change should consider:

- idempotency,
- offset/ack strategy,
- poison message handling,
- DLQ compatibility,
- replay behavior,
- concurrency changes.

### 16.4 Deployment sequencing example

Adding new event field:

```text
1. consumer tolerates missing field
2. producer emits optional field
3. dashboards verify adoption
4. consumer starts using field when present
5. only much later consider requiring it
```

---

## 17. Release Safety for Caches and Projections

Caches and projections are often forgotten in release planning.

Risks:

- old cache value shape incompatible with new code,
- new code writes cache format old code cannot read,
- stale cache hides release failure,
- projection schema changes break dashboard,
- search index mapping incompatible,
- blue-green uses shared cache causing cross-version pollution.

Patterns:

### 17.1 Versioned cache key

```text
application:summary:v1:{id}
application:summary:v2:{id}
```

### 17.2 Tolerant cache reader

New code can read old value and upgrade lazily.

### 17.3 Cache warmup

Warm cache before traffic shift where latency matters.

### 17.4 Projection rebuild strategy

Projection changes need:

- build new projection side by side,
- compare counts/checksums,
- switch query path,
- keep old projection until rollback window expires.

---

## 18. Java 8–25 Deployment Considerations

### 18.1 Java 8

Common concerns:

- older container awareness unless updated JVM,
- classpath dependency conflict,
- older TLS/cipher defaults,
- older GC behavior,
- javax-era libraries,
- slower startup in heavy frameworks,
- weaker language support for modeling compatibility.

Release advice:

- pin JVM update version,
- validate container memory behavior,
- explicitly test TLS and security provider behavior,
- avoid library upgrades bundled with functional releases.

### 18.2 Java 11

Common concerns:

- migration from Java 8 module removals,
- dependency compatibility,
- container ergonomics better than older Java 8,
- common baseline for enterprise modernization.

Release advice:

- separate Java runtime upgrade from business feature release,
- test agents/APM/logging/security libraries,
- compare GC and memory metrics before/after.

### 18.3 Java 17

Common concerns:

- strong LTS baseline,
- modern language features useful for domain modeling,
- framework baselines often require Java 17+.

Release advice:

- validate framework major upgrades separately,
- use records/sealed classes carefully in DTOs if serialization compatibility matters.

### 18.4 Java 21

Common concerns:

- virtual threads affect concurrency model,
- blocking code can scale differently,
- connection pools/database limits remain real,
- thread-local/security context propagation must be checked.

Release advice:

- do not enable virtual threads as a hidden performance flag without load testing,
- retune concurrency limit, DB pool, and bulkhead,
- observe carrier thread pinning where relevant.

### 18.5 Java 25

Common concerns:

- latest GA/LTS-era runtime adoption,
- dependency and agent compatibility,
- container base image availability,
- security policy/commercial support choice,
- library ecosystem readiness.

Release advice:

- treat Java 25 rollout as platform migration,
- canary by service class,
- compare GC, CPU, memory, latency, startup, TLS, serialization, reflection behavior,
- separate runtime upgrade from business changes.

---

## 19. Framework and Runtime Positioning

### 19.1 Spring Boot / Spring Cloud

Useful for:

- actuator health/readiness/liveness,
- graceful shutdown,
- configuration integration,
- Micrometer observability,
- Spring Cloud Gateway,
- config/discovery/resilience ecosystem.

Risk:

- actuator health groups misconfigured,
- dependency health in liveness,
- overly broad auto-configured readiness,
- startup time ignored,
- feature release hidden in framework upgrade.

### 19.2 Jakarta EE / MicroProfile

Useful for:

- enterprise runtime standardization,
- MicroProfile Config,
- Health,
- Metrics/Telemetry,
- Fault Tolerance,
- REST Client,
- JWT.

Risk:

- application server version coupling,
- shared runtime deployment coordination,
- inconsistent vendor behavior if not tested.

### 19.3 Quarkus

Useful for:

- fast startup,
- Kubernetes-native deployment style,
- build-time optimization,
- native image option,
- MicroProfile support.

Risk:

- native image reflection/resource config,
- JVM vs native behavior differences,
- build-time config surprises,
- agent/tool compatibility differences.

### 19.4 Plain Java

Useful for:

- controlled runtime behavior,
- small services/workers,
- explicit dependencies,
- custom platform integration.

Risk:

- building too much platform plumbing manually,
- inconsistent health/readiness/metrics conventions,
- missing standard operational endpoints.

---

## 20. Deployment Risk Matrix

Before release, classify risk.

| Risk dimension | Low risk | High risk |
|---|---|---|
| Contract | additive optional change | remove/rename/change semantics |
| Data | no schema change | destructive schema/data migration |
| Runtime | same JVM/framework | JVM/framework major upgrade |
| Workflow | stateless request | long-running process change |
| Messaging | no schema/ordering change | event schema/partition change |
| Security | no auth change | token/audience/permission change |
| Traffic | low-volume internal | high-volume public critical path |
| Observability | strong dashboard/alerts | weak/no release visibility |
| Rollback | simple traffic switch | irreversible data/side effects |

High-risk releases need stronger controls:

- smaller change set,
- staging validation,
- contract tests,
- canary,
- feature flag,
- database expand-contract,
- dry-run/shadow,
- rollback/roll-forward plan,
- on-call coverage,
- explicit go/no-go criteria.

---

## 21. Production Release Checklist

### 21.1 Artifact

- [ ] Artifact built once and promoted.
- [ ] Image digest recorded.
- [ ] SBOM generated where required.
- [ ] Vulnerability scan completed.
- [ ] Build provenance available.
- [ ] Java version recorded.
- [ ] Framework/runtime versions recorded.

### 21.2 Contract

- [ ] API compatibility checked.
- [ ] Event compatibility checked.
- [ ] Error contract checked.
- [ ] Enum evolution checked.
- [ ] Old/new provider-consumer matrix reviewed.
- [ ] Consumer-driven contract tests pass if applicable.

### 21.3 Data

- [ ] Migration is backward compatible.
- [ ] Expand-contract plan exists.
- [ ] Backfill is chunked/idempotent/resumable.
- [ ] Rollback/roll-forward implications known.
- [ ] Lock/IO/undo impact reviewed.
- [ ] Data validation query prepared.

### 21.4 Runtime

- [ ] Readiness probe correct.
- [ ] Liveness probe does not depend on external dependencies incorrectly.
- [ ] Startup probe configured where needed.
- [ ] Graceful shutdown tested.
- [ ] Resource requests/limits reviewed.
- [ ] DB/message/cache pool sizing reviewed.

### 21.5 Deployment Strategy

- [ ] Rolling/blue-green/canary/shadow/dark launch strategy selected.
- [ ] Old and new versions can coexist.
- [ ] Traffic split mechanism tested.
- [ ] Feature flags default safe.
- [ ] Kill switch available.

### 21.6 Observability

- [ ] Dashboard ready.
- [ ] Deployment annotation available.
- [ ] Metrics by version available.
- [ ] Logs include service version/correlation ID.
- [ ] Traces include version metadata.
- [ ] Business correctness metrics available.
- [ ] Alert thresholds agreed.

### 21.7 Operations

- [ ] Runbook updated.
- [ ] Owner/on-call known.
- [ ] Rollback command known.
- [ ] Roll-forward path known.
- [ ] Communication plan prepared for high-risk release.
- [ ] Post-release verification steps defined.

---

## 22. Regulatory Case Management Example

Imagine an `Application Service` with states:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> ISSUED
```

A new release introduces a new screening step:

```text
SUBMITTED -> PRE_SCREENING -> UNDER_REVIEW
```

Naive release:

1. Add new state enum.
2. Deploy new code.
3. Start writing `PRE_SCREENING`.
4. Old consumers fail because they do not understand the new enum.
5. Worklist projection fails.
6. Officers cannot see applications.
7. Rollback fails because database now contains `PRE_SCREENING`.

Safe release:

### Phase 1 — Consumer tolerance

Deploy all consumers with tolerant enum handling:

```text
unknown state -> display as Pending Processing / route to fallback queue
```

### Phase 2 — Schema expand

If needed, add fields:

```sql
ALTER TABLE application ADD screening_status VARCHAR(50);
```

### Phase 3 — Dark deploy producer

Deploy new service code with flag off:

```text
preScreening.enabled=false
```

### Phase 4 — Shadow or internal canary

Run pre-screening in dry-run mode:

```text
calculate result
store audit/dry-run output
no state transition yet
```

### Phase 5 — Limited release

Enable for internal tenant or small percentage:

```text
preScreening.enabled=true for tenant=pilot
```

Monitor:

- transition failure rate,
- stuck application count,
- officer worklist count,
- projection lag,
- pre-screening timeout,
- state mismatch count.

### Phase 6 — Wider rollout

Expand to all tenants after stable metrics.

### Phase 7 — Cleanup

Remove fallback only after:

- old versions gone,
- old workflows completed/migrated,
- replay window safe,
- audit evidence retained.

This is release engineering as system correctness.

---

## 23. Common Anti-Patterns

### 23.1 Deploy Equals Release

Deploying code immediately exposes behavior.

Fix:

- feature flags,
- dark launch,
- progressive rollout.

### 23.2 Destructive Migration First

Dropping/renaming schema before all code is compatible.

Fix:

- expand-contract,
- delayed cleanup.

### 23.3 Rollback Fantasy

Assuming rollback always works.

Fix:

- classify irreversible side effects,
- test rollback,
- prefer roll-forward for data changes.

### 23.4 Canary Without Observability

Canary exists but nobody can detect regression.

Fix:

- versioned metrics,
- baseline comparison,
- business metrics.

### 23.5 Liveness Depends on Database

Database issue causes every pod to restart.

Fix:

- readiness checks dependency availability,
- liveness checks process health.

### 23.6 Shared Release Train Forever

All services deploy together because contracts are unsafe.

Fix:

- contract compatibility,
- ownership,
- incremental decoupling.

### 23.7 Feature Flag Graveyard

Flags are never removed.

Fix:

- expiry date,
- owner,
- cleanup backlog,
- flag governance.

### 23.8 Runtime Upgrade Mixed With Business Feature

JDK/framework/platform upgrade bundled with large feature.

Fix:

- separate platform migrations from behavior changes.

---

## 24. Architecture Review Questions

Ask these before approving a release design:

1. Can old and new versions run at the same time?
2. Can old consumers call new provider?
3. Can new consumers call old provider?
4. Can old consumers parse new events?
5. Can new consumers replay old events?
6. Is the database migration backward compatible?
7. What data is changed irreversibly?
8. What external side effects can happen?
9. What is the rollback plan?
10. What is the roll-forward plan?
11. What metrics prove the release is healthy?
12. What business metric proves correctness?
13. What is the blast radius of failure?
14. Can we disable the feature without redeploy?
15. Does graceful shutdown protect in-flight work?
16. Are readiness/liveness/startup probes correct?
17. Are long-running workflows versioned?
18. Are message consumers replay-safe?
19. Are cache/projection formats versioned?
20. Who owns the release during and after deployment?

---

## 25. Practical Java Example: Release Metadata Endpoint

A service should expose release metadata for diagnostics.

```java
public final class ReleaseInfo {
    private final String serviceName;
    private final String version;
    private final String gitCommit;
    private final String buildNumber;
    private final String imageDigest;
    private final String javaVersion;
    private final String deployedAt;

    public ReleaseInfo(
            String serviceName,
            String version,
            String gitCommit,
            String buildNumber,
            String imageDigest,
            String javaVersion,
            String deployedAt
    ) {
        this.serviceName = serviceName;
        this.version = version;
        this.gitCommit = gitCommit;
        this.buildNumber = buildNumber;
        this.imageDigest = imageDigest;
        this.javaVersion = javaVersion;
        this.deployedAt = deployedAt;
    }

    public String serviceName() { return serviceName; }
    public String version() { return version; }
    public String gitCommit() { return gitCommit; }
    public String buildNumber() { return buildNumber; }
    public String imageDigest() { return imageDigest; }
    public String javaVersion() { return javaVersion; }
    public String deployedAt() { return deployedAt; }
}
```

For Java 16+ you can model this as a record:

```java
public record ReleaseInfo(
        String serviceName,
        String version,
        String gitCommit,
        String buildNumber,
        String imageDigest,
        String javaVersion,
        String deployedAt
) {}
```

But do not leak this internal model as an unstable public contract if external clients depend on it.

---

## 26. Practical Java Example: Graceful Worker Stop

Simplified message worker lifecycle:

```java
public final class Worker implements AutoCloseable {
    private final AtomicBoolean running = new AtomicBoolean(true);
    private final ExecutorService executor;
    private final MessageClient client;

    public Worker(ExecutorService executor, MessageClient client) {
        this.executor = executor;
        this.client = client;
    }

    public void start() {
        executor.submit(() -> {
            while (running.get()) {
                Message message = client.poll();
                if (message == null) {
                    continue;
                }

                try {
                    handle(message);
                    client.ack(message);
                } catch (RetryableException e) {
                    client.nackWithDelay(message);
                } catch (Exception e) {
                    client.sendToDeadLetter(message, e);
                }
            }
        });
    }

    private void handle(Message message) {
        // Apply durable business effect before ack.
    }

    @Override
    public void close() {
        running.set(false);
        executor.shutdown();
        try {
            if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            executor.shutdownNow();
        } finally {
            client.close();
        }
    }
}
```

Principle:

```text
Stop accepting new work before killing in-flight work.
Ack only after durable effect.
```

---

## 27. Practical Exercise

Take one service you know and fill this release safety table.

| Question | Answer |
|---|---|
| Service name | |
| Current Java version | |
| Runtime platform | |
| Deployment strategy | |
| Can old/new versions coexist? | |
| Contract changes? | |
| Schema changes? | |
| Migration type | |
| Feature flags? | |
| Rollback possible? | |
| Roll-forward plan? | |
| Readiness check? | |
| Liveness check? | |
| Graceful shutdown tested? | |
| Business correctness metrics? | |
| Release owner | |

Then identify the top three release risks.

---

## 28. Summary

Deployment and release safety is where microservices become real.

The key ideas:

1. Deployment is not release.
2. Independent deployment requires compatibility, not only separate artifacts.
3. Rolling/canary/blue-green are unsafe without backward-compatible data and contracts.
4. Database migration safety usually requires expand-contract.
5. Rollback is not guaranteed after data and side effects change.
6. Feature flags separate deployment from behavior exposure.
7. Readiness, liveness, startup probes, and graceful shutdown are correctness mechanisms.
8. Long-running workflows need versioning.
9. Message consumers must survive old, new, duplicate, and replayed messages.
10. Observability is required to know whether a release is safe.
11. Java runtime upgrades are platform migrations and should be released separately from business changes.
12. A top-tier engineer can explain not only how to deploy, but why a release is safe.

---

## 29. References

- OpenJDK — JDK 25: https://openjdk.org/projects/jdk/25/
- Kubernetes — Performing a Rolling Update: https://kubernetes.io/docs/tutorials/kubernetes-basics/update/update-intro/
- Kubernetes — Liveness, Readiness, and Startup Probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Martin Fowler — Canary Release: https://martinfowler.com/bliki/CanaryRelease.html
- Martin Fowler — Feature Toggles: https://martinfowler.com/articles/feature-toggles.html
- Martin Fowler — Blue-Green Deployment: https://martinfowler.com/bliki/BlueGreenDeployment.html
- Spring — Liveness and Readiness Probes with Spring Boot: https://spring.io/blog/2020/03/25/liveness-and-readiness-probes-with-spring-boot
- Spring Boot Reference Documentation — Actuator, Availability, Graceful Shutdown: https://docs.spring.io/spring-boot/docs/current/reference/html/
