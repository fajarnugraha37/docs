# Learn Java Microservices Patterns — Advanced Engineering
## Part 31 — Incident, Failure Analysis, and Reliability Operations

**Filename:** `learn-java-microservices-patterns-advanced-engineering-31-incident-failure-analysis-reliability-operations.md`  
**Series:** `learn-java-microservices-patterns-advanced-engineering`  
**Part:** 31 of 35  
**Target:** Advanced Java engineers, tech leads, architects, principal-level engineers  
**Java range:** Java 8–25  

---

## 0. Why This Part Exists

Microservices do not fail as one neat block.

They fail through partial outages, slow dependencies, retry storms, stale projections, message backlogs, leaked resources, bad configuration, unbounded queues, cascading failure, silent data corruption, and human misunderstanding under time pressure.

A top-tier engineer is not only someone who can design services. A top-tier engineer can operate them when reality becomes messy.

This part is about **incident thinking**:

```text
How do we detect that the system is unhealthy?
How do we know the blast radius?
How do we stop the bleeding?
How do we recover safely?
How do we distinguish symptom from mechanism?
How do we learn without blaming?
How do we turn one incident into stronger architecture?
```

The goal is not to become a full-time SRE, but to think like an engineer who owns production consequences.

---

## 1. Mental Model: An Incident Is a Violation of Expected Service Behavior

An incident is not merely “an error in logs”.

An incident happens when the system no longer provides an acceptable level of service to users, operators, downstream systems, or business processes.

Examples:

| Situation | Incident? | Why |
|---|---:|---|
| One pod restarts and traffic is unaffected | Usually no | Self-healing worked |
| API p99 latency jumps from 300 ms to 12 seconds | Yes | User-facing quality degraded |
| Kafka consumer lag grows but users unaffected yet | Maybe | Latent incident / pre-incident |
| Projection is stale for 2 hours | Yes if freshness SLO violated | Correctness/UX impact |
| Payment duplicate charge | Yes | Business correctness failure |
| Audit trail missing transition actor | Yes | Regulatory defensibility failure |
| CPU 90% but latency normal | Not necessarily | Resource symptom without service impact |
| Database storage 99% used | Maybe critical risk | Imminent availability risk |

A production-grade incident model separates:

```text
metric anomaly
→ service degradation
→ business impact
→ user impact
→ regulatory/compliance impact
→ recovery requirement
```

Do not let the team confuse telemetry noise with service failure. Also do not ignore early signals just because users have not complained yet.

---

## 2. Incident Thinking vs Debugging Thinking

Debugging is local.

Incident response is systemic.

Debugging asks:

```text
Where is the bug?
```

Incident response asks:

```text
What is the current impact?
Is the impact expanding?
What must be stabilized first?
What is safe to change now?
What evidence do we need before acting?
What action reduces risk fastest?
```

During an incident, the first goal is usually **stabilization**, not perfect root cause discovery.

A weak incident response pattern:

```text
Alert fires
→ everyone jumps into logs
→ people debate possible root cause
→ no one owns communication
→ someone restarts random services
→ symptoms change
→ evidence is lost
→ outage lasts longer
```

A stronger incident response pattern:

```text
Alert fires
→ declare incident
→ assign roles
→ assess impact
→ contain blast radius
→ mitigate user impact
→ preserve evidence
→ recover safely
→ verify correctness
→ communicate status
→ review and harden
```

---

## 3. Incident Lifecycle

A practical lifecycle:

```text
Preparedness
→ Detection
→ Declaration
→ Triage
→ Containment
→ Mitigation
→ Recovery
→ Verification
→ Communication
→ Post-incident review
→ Reliability backlog execution
```

Atlassian describes incident response as a lifecycle for identifying and reacting to outages or threats, while Google SRE emphasizes structured response, incident roles, and blameless learning. Google SRE also treats postmortems as an essential tool for reducing recurrence.

---

## 4. Preparedness: Reliability Is Built Before the Incident

A team that only starts thinking during an outage is already late.

Preparedness includes:

1. Clear ownership.
2. Alert routing.
3. Runbooks.
4. Dashboards.
5. Deployment metadata.
6. Dependency map.
7. Rollback/roll-forward procedures.
8. Feature flags and kill switches.
9. Backup and restore validation.
10. Data reconciliation tools.
11. Access readiness.
12. On-call handover.
13. Incident severity definitions.
14. Communication templates.
15. Postmortem process.

### 4.1 Preparedness Anti-Pattern

```text
“We will figure it out when it happens.”
```

This is not engineering. It is hope.

Preparedness is not bureaucracy. It is precomputed thinking.

---

## 5. Detection: How Incidents Become Visible

Incidents are detected through several channels:

| Detection source | Example | Strength | Weakness |
|---|---|---|---|
| Technical alert | p99 latency, error rate, pod crash | Fast | Can be noisy |
| Business metric | submission count drops | High signal | May be delayed |
| Synthetic check | login flow fails | User-like | Limited coverage |
| User report | helpdesk ticket | Real impact | Late |
| Partner report | external agency reports failed callback | Real integration signal | May lack detail |
| Operator observation | backlog dashboard red | Context-rich | Human-dependent |
| Security alert | unusual auth failure rate | Risk-focused | Needs triage |

Top-tier teams do not rely only on CPU/memory alerts.

They alert on service behavior:

```text
Can users submit?
Can officers approve?
Can correspondence be generated?
Can payments be reconciled?
Can SLA timers progress?
Can audit trail be queried?
Can external callbacks be processed?
```

### 5.1 Alert Quality

Good alert:

```text
A user-facing or business-critical condition is degraded,
and a human action may be required.
```

Bad alert:

```text
CPU is above 80%.
```

CPU above 80% can be useful telemetry, but by itself it is not necessarily actionable.

A better alert:

```text
Application Approval API p95 latency > 3s for 10 minutes
AND error rate > 2%
AND successful approval throughput below normal baseline.
```

---

## 6. Incident Severity

Severity should be based on impact, not drama.

Example severity model:

| Severity | Description | Example |
|---|---|---|
| SEV-1 | Critical business outage or data integrity risk | Users cannot log in; approvals impossible; duplicate irreversible actions |
| SEV-2 | Major degradation with workaround or limited scope | One module down; one tenant affected; backlog growing fast |
| SEV-3 | Degraded functionality with low immediate impact | Report generation delayed; non-critical email queue delayed |
| SEV-4 | Minor defect or risk | Warning threshold crossed; single failed batch recovered |

Severity should drive:

1. Escalation path.
2. Communication frequency.
3. Required roles.
4. Postmortem requirement.
5. SLA/management notification.
6. Customer/agency notification.

### 6.1 Severity Must Be Reassessed

Incidents evolve.

A SEV-3 backlog can become SEV-1 if it blocks legal deadlines.

A SEV-2 latency issue can become SEV-1 if retry storm causes database saturation.

A top-tier engineer keeps asking:

```text
Is impact expanding?
Is recovery confidence decreasing?
Is data correctness at risk?
Is the incident crossing tenant/module/system boundary?
```

---

## 7. Incident Roles

During serious incidents, role clarity matters more than heroism.

Common roles:

| Role | Responsibility |
|---|---|
| Incident Commander | Coordinates response, sets priority, avoids chaos |
| Tech Lead / Investigation Lead | Drives technical diagnosis |
| Communications Lead | Sends updates to stakeholders |
| Operations Lead | Executes infra/runtime actions |
| Scribe | Records timeline, actions, hypotheses, evidence |
| Domain Lead | Explains business impact and correctness risks |
| Security/Compliance Lead | Handles security/regulatory implications |

In small teams, one person may hold multiple roles, but the responsibilities should still be explicit.

### 7.1 Anti-Pattern: Everyone Is Debugging

When everyone is debugging:

1. No one tracks impact.
2. No one writes timeline.
3. No one informs stakeholders.
4. No one validates recovery.
5. Multiple people may apply conflicting changes.

During an incident, uncontrolled parallelism increases risk.

---

## 8. First 10 Minutes: What to Do

The first minutes should reduce uncertainty and prevent random action.

Checklist:

```text
1. Confirm alert/user report.
2. Declare incident if impact is real or risk is high.
3. Assign incident commander.
4. Open incident channel/bridge.
5. Start timeline.
6. Identify affected user journey/business capability.
7. Identify affected services/dependencies.
8. Check recent changes.
9. Check blast radius.
10. Decide immediate containment or rollback if obvious and safe.
```

Avoid:

```text
- restarting random pods
- manually changing database rows without plan
- clearing queues blindly
- increasing timeout without understanding downstream pressure
- scaling out a service that is failing due to database saturation
- disabling security controls without approval
```

---

## 9. Triage: From Symptom to Impact

Triage should answer:

```text
What is broken?
Who is affected?
How badly?
Since when?
Is it getting worse?
What changed?
What is the safest immediate mitigation?
```

### 9.1 Symptom Classification

| Symptom | Possible mechanisms |
|---|---|
| HTTP 500 spike | app bug, dependency error, DB error, bad config |
| HTTP 504 spike | downstream slow, gateway timeout, thread exhaustion |
| CPU high | traffic spike, tight loop, GC, crypto, serialization, compression |
| memory high | leak, cache growth, large payload, stuck batch, native memory |
| DB connection pool exhausted | slow queries, leaked connections, pool too small, DB saturated |
| Kafka/Rabbit lag grows | consumer down, slow processing, poison message, downstream bottleneck |
| duplicate events | retry, replay, producer bug, outbox relay issue |
| missing events | outbox stuck, CDC failure, relay crash, filter misconfig |
| stale read model | projection lag, handler error, schema incompatibility |
| auth failures | IdP issue, cert expired, clock skew, token audience mismatch |
| one tenant affected | tenant config, data skew, quota, permission, specific workflow state |

### 9.2 Impact Mapping

Do not stop at service name.

Map service failure to user journey:

```text
service failure
→ API endpoint affected
→ user journey affected
→ business operation affected
→ SLA/legal/compliance impact
```

Example:

```text
correspondence-service 500
→ send decision letter fails
→ approval cannot be completed
→ applicants do not receive decision
→ statutory notification SLA at risk
```

---

## 10. Recent Change Analysis

Many incidents are triggered by change.

Check:

1. Application deployment.
2. Database migration.
3. Configuration change.
4. Secret/certificate rotation.
5. Infrastructure change.
6. DNS/routing change.
7. Feature flag change.
8. Dependency deployment.
9. External provider change.
10. Data load/batch job.
11. Traffic shape change.
12. Schema/event contract change.

Recent change does not automatically mean root cause, but it is a high-value hypothesis.

A good deployment pipeline should expose:

```text
service version
commit hash
build id
deployment time
deployment owner
config version
schema migration version
feature flag state
runtime image digest
```

Without deployment metadata, incident diagnosis becomes archaeology.

---

## 11. Containment vs Mitigation vs Recovery

These are different.

| Term | Meaning | Example |
|---|---|---|
| Containment | Stop impact from spreading | Disable expensive feature, pause consumer, block bad tenant |
| Mitigation | Reduce user/business impact | Route to fallback, increase capacity, rollback release |
| Recovery | Restore intended function | Fix bug, replay events, rebuild projection |
| Verification | Prove service and data are correct | Check SLO, reconcile records, validate workflows |

A restart may be mitigation, but not recovery.

A rollback may be mitigation, but data may still require repair.

A queue drain may be recovery, but only if messages are processed correctly.

---

## 12. Failure Mode: Partial Outage

Microservices often fail partially:

```text
Only one endpoint is slow.
Only one tenant is affected.
Only one consumer group is stuck.
Only one projection is stale.
Only one zone is degraded.
Only callbacks to one external system fail.
Only users with a specific role fail authorization.
```

Partial outage is hard because global health may look fine.

### 12.1 Partial Outage Detection

Use dimensions:

```text
service
endpoint
operation
module
tenant
role
region/zone
external dependency
message topic
consumer group
workflow state
data partition
```

But control cardinality.

Do not create unbounded labels such as raw user id, raw case id, or raw request id as metric labels.

---

## 13. Failure Mode: Brownout

A brownout is degraded service without total outage.

Examples:

1. Slow page loads.
2. Search unavailable but submission works.
3. Notifications delayed.
4. Reports stale.
5. API returns partial data.
6. System accepts commands but read models lag.

Brownout can be intentional or accidental.

Intentional brownout:

```text
Under high load, disable non-critical dashboard widgets
so core submission and approval remain healthy.
```

Accidental brownout:

```text
External profile lookup is slow,
causing all application pages to load slowly
because the BFF waits synchronously for it.
```

Top-tier systems define graceful degradation before production.

---

## 14. Failure Mode: Cascading Failure

Google SRE defines cascading failure as a failure that grows over time due to positive feedback: one failed portion increases pressure on remaining portions, increasing the chance that they fail too.

Common cascade mechanisms:

1. Retry storm.
2. Connection pool exhaustion.
3. Thread pool exhaustion.
4. Queue growth.
5. Cache outage causing database overload.
6. Slow dependency causing caller saturation.
7. One zone failure shifting too much load to other zones.
8. Bad deployment causing all replicas to crash loop.
9. Service mesh retry multiplying application retry.
10. Batch job competing with online traffic.

### 14.1 Cascade Prevention

Use:

```text
timeout
retry budget
jitter
circuit breaker
bulkhead
rate limiter
load shedding
backpressure
queue limit
connection pool limit
fallback
kill switch
capacity reservation
```

During incident response, ask:

```text
Are we protecting the failing dependency?
Are retries making things worse?
Are queues hiding overload?
Are callers timing out before callees finish?
Are we consuming work faster than downstream can accept?
```

---

## 15. Failure Mode: Retry Storm

Retry storm pattern:

```text
Dependency slows down
→ caller times out
→ caller retries
→ traffic to dependency increases
→ dependency gets slower
→ more callers retry
→ system collapses
```

Incident response actions:

1. Reduce retry count.
2. Increase jitter.
3. Disable retry for non-idempotent paths.
4. Enable circuit breaker.
5. Shed low-priority traffic.
6. Apply per-tenant/per-endpoint limits.
7. Pause background jobs.
8. Increase timeout only if downstream capacity exists.

Do not blindly increase timeout. Longer timeout can hold threads/connections longer and worsen saturation.

---

## 16. Failure Mode: Queue Backlog

A backlog is not always an outage, but it is stored pain.

Backlog incident questions:

```text
Which queue/topic/partition?
Which consumer group?
How fast is lag growing?
What is normal lag?
What is oldest message age?
Is consumer processing or failing?
Is the bottleneck CPU, DB, external API, lock, poison message, or downstream?
Can we scale consumers safely?
Can downstream absorb catch-up traffic?
Do messages expire or violate SLA?
Does ordering matter?
Can we skip/park poison messages?
```

### 16.1 Backlog Recovery Pattern

```text
1. Stop new damage.
2. Identify poison messages.
3. Move poison messages to parking lot if safe.
4. Fix handler or dependency.
5. Scale consumers only within downstream capacity.
6. Process backlog with rate limit.
7. Monitor age-of-oldest-message, throughput, error rate.
8. Reconcile business state.
```

### 16.2 Dangerous Backlog Actions

```text
- deleting messages without audit
- replaying without idempotency
- scaling consumers 10x while DB is bottleneck
- ignoring message order requirement
- clearing DLQ without classification
- reprocessing sensitive data without compliance review
```

---

## 17. Failure Mode: Data Corruption

Data corruption is often more severe than downtime.

Types:

| Type | Example |
|---|---|
| Wrong state transition | APPROVED without required review |
| Duplicate side effect | two decision letters sent |
| Missing side effect | payment accepted but receipt not generated |
| Projection corruption | worklist shows wrong officer |
| Referential inconsistency | case references deleted applicant snapshot |
| Tenant leakage | data from tenant A visible to tenant B |
| Audit gap | state changed without actor/reason |
| Temporal corruption | SLA deadline recalculated incorrectly |
| Authorization corruption | role mapping wrong after sync |

Data incident response differs from availability incident response.

You must answer:

```text
Which records are affected?
What is the source of truth?
When did corruption start?
Is corruption still happening?
Can corrupted records be identified deterministically?
Is repair reversible?
Is manual review required?
Is audit/legal notification required?
```

### 17.1 Data Repair Principles

1. Stop further corruption first.
2. Preserve evidence.
3. Define affected cohort.
4. Create deterministic repair script.
5. Test repair on snapshot/staging.
6. Backup before repair.
7. Run repair in controlled batches.
8. Record every change.
9. Reconcile after repair.
10. Produce post-incident data report.

Never run ad-hoc production updates without peer review, backup, and audit trail.

---

## 18. Failure Mode: Projection Staleness

CQRS/materialized views introduce a specific incident class: write-side is correct but read-side is stale or wrong.

Symptoms:

1. User submits application but worklist does not update.
2. Officer approves but applicant dashboard still shows pending.
3. Audit listing omits recent action.
4. Report totals disagree with source system.

Investigation:

```text
Is event published?
Is event in broker?
Did consumer receive it?
Did handler fail?
Is schema incompatible?
Is projection DB locked/full/down?
Is consumer lag high?
Is event out of order?
Was replay interrupted?
```

Recovery:

```text
1. Fix projection handler.
2. Replay affected event range.
3. Rebuild projection if necessary.
4. Compare source-of-truth count vs projection count.
5. Communicate freshness impact.
```

Projection freshness must have an SLO:

```text
95% of worklist updates visible within 10 seconds.
99% within 60 seconds.
Alert if oldest unprojected event age > 5 minutes.
```

---

## 19. Failure Mode: External Dependency Incident

External dependencies include:

1. Identity provider.
2. Payment gateway.
3. Address lookup.
4. Email/SMS provider.
5. Agency integration.
6. Object storage.
7. Third-party API.
8. Government platform service.

Questions:

```text
Is dependency down or slow?
Is failure global or tenant-specific?
Is our auth/token/cert expired?
Is their contract changed?
Is our rate limit exceeded?
Can we degrade gracefully?
Can we queue and retry later?
Is operation idempotent?
What is user-visible message?
```

Patterns:

| Dependency type | Preferred mitigation |
|---|---|
| IdP login down | status page, retry later, maybe session grace if allowed |
| Email provider down | queue email and send later |
| Address lookup slow | cached lookup, manual input fallback |
| Payment gateway unknown outcome | reconcile before retrying charge |
| External callback down | outbox retry with backoff and DLQ |
| Object storage slow | circuit breaker, limited retry, partial feature disable |

---

## 20. Failure Mode: Bad Configuration

Configuration incidents are common because config is code without compilation.

Examples:

1. Wrong endpoint URL.
2. Wrong timeout.
3. Wrong feature flag condition.
4. Wrong tenant routing.
5. Wrong OAuth audience.
6. Wrong DB pool size.
7. Wrong topic name.
8. Wrong secret version.
9. Wrong certificate chain.
10. Wrong cache TTL.

Prevention:

```text
config schema
config validation at startup
config diff review
safe defaults
environment guard
tenant config validation
progressive rollout
config version observability
```

Incident response:

```text
1. Identify config version.
2. Compare previous effective config.
3. Roll back config if safe.
4. Restart/reload affected services carefully.
5. Verify downstream impact.
```

---

## 21. Failure Mode: Certificate, Secret, and Token Expiry

Security material expiry incidents are preventable.

Common symptoms:

1. sudden TLS handshake failures
2. OAuth client authentication failure
3. JWT validation failure
4. service-to-service calls fail after deployment
5. external callback rejected

Prevention:

```text
expiry inventory
auto-renewal
expiry alerting at 30/14/7/3/1 days
rotation runbook
staged validation
dual-secret support
dual-certificate trust window
```

Response:

```text
1. Confirm failing identity/cert/secret.
2. Validate expiry or mismatch.
3. Rotate or roll back trust bundle.
4. Restart/reload affected services.
5. Verify all clients, not only one path.
6. Record missed expiry alert gap.
```

---

## 22. Failure Mode: Database Saturation

Symptoms:

1. high DB CPU
2. high active sessions
3. slow queries
4. connection pool exhaustion
5. lock wait
6. transaction timeout
7. storage full
8. temp/undo pressure
9. replication lag
10. deadlocks

Questions:

```text
Is DB CPU, IO, lock, memory, connection, storage, or query-plan bound?
Which service is generating load?
Which endpoint/job/query is responsible?
Did deployment or data volume change?
Are retries increasing DB pressure?
Can background jobs be paused?
Can expensive features be disabled?
Can traffic be shed?
Can read traffic move to replica/projection/cache?
```

Immediate mitigations:

1. Pause heavy batch/report jobs.
2. Disable expensive feature flags.
3. Rate-limit offending endpoint.
4. Reduce retry pressure.
5. Kill runaway query only if understood.
6. Scale DB only if bottleneck is capacity and scaling is safe.
7. Add emergency index only after review.
8. Increase pool size only if DB has capacity.

Pool size mistake:

```text
API is slow because DB is saturated.
Team increases every service pool from 20 to 100.
DB receives more concurrent load.
Latency worsens.
Everything collapses.
```

---

## 23. Failure Mode: Memory Leak / Resource Leak

Symptoms:

1. increasing heap usage
2. increasing native memory
3. GC frequency increases
4. p99 latency worsens
5. OOMKilled
6. file descriptors exhausted
7. DB connections not returned
8. thread count grows

Java incident evidence:

```text
heap dump
thread dump
JFR recording
GC logs
container memory metrics
native memory tracking if enabled
connection pool metrics
cache size metrics
object allocation profile
```

Mitigation:

1. Restart as temporary mitigation if safe.
2. Reduce traffic or disable leak-triggering feature.
3. Bound cache/queue.
4. Roll back release if leak introduced recently.
5. Capture evidence before restart when possible.

Do not treat restart as root cause resolution.

---

## 24. Failure Mode: CrashLoop / Bad Deployment

Symptoms:

1. pods repeatedly restart
2. readiness never passes
3. startup probe fails
4. config validation fails
5. migration fails
6. incompatible Java version/class file version
7. missing secret/config
8. bad container image

Response:

```text
1. Stop rollout.
2. Check deployment event and container logs.
3. Roll back if previous version is known good.
4. Check config/secrets/image digest.
5. Check startup dependency assumptions.
6. Verify readiness behavior.
7. Confirm no partial migration side effect.
```

Java-specific examples:

| Symptom | Possible cause |
|---|---|
| `UnsupportedClassVersionError` | compiled with newer Java than runtime |
| `OutOfMemoryError` immediately | heap sizing mismatch in container |
| startup slow / probe kills pod | startup probe too aggressive or app too slow |
| native image starts but fails reflection path | missing reflection/resource config |
| virtual-thread app hangs | pinned carrier threads or blocking synchronized section |

---

## 25. Failure Mode: Message Poisoning

A poison message is a message that repeatedly fails processing.

Causes:

1. invalid schema
2. unknown enum
3. missing required field
4. bad business state
5. handler bug
6. downstream permanent failure
7. tenant-specific data issue
8. corrupted payload

Response:

```text
1. Identify poison message fingerprint.
2. Stop infinite retry.
3. Move to DLQ/parking lot if safe.
4. Classify as transient/permanent/business/manual.
5. Fix handler or data.
6. Replay only after idempotency validation.
7. Document affected business objects.
```

DLQ is not trash.

DLQ is an operational workflow.

---

## 26. Failure Mode: Silent Failure

The worst incidents are not noisy.

Examples:

1. email sending silently disabled
2. outbox relay stopped but app still commits DB changes
3. projection not updating but API still returns old data
4. SLA timer job not running
5. audit enrichment failing silently
6. event consumer skipping unknown schema
7. reconciliation job not scheduled

Detection requires:

```text
heartbeat metrics
age-of-oldest-unprocessed-item
business throughput baseline
missing-event detection
end-to-end synthetic transactions
reconciliation reports
watchdog jobs
```

Ask:

```text
What must happen regularly?
How do we know it stopped?
```

---

## 27. Timeline Reconstruction

A reliable timeline is more valuable than speculation.

Track:

```text
Timestamps
Observed symptoms
Alerts fired
Deployments/config changes
Hypotheses considered
Actions taken
Who took the action
System response after action
Communication updates
Recovery validation
Open questions
```

Example:

```text
10:02 - Alert: approval-api p99 latency > 8s
10:04 - Incident declared SEV-2
10:05 - Recent deployment approval-service v2026.06.19.3 identified
10:08 - DB active sessions 5x baseline
10:11 - Background report job paused
10:14 - Latency drops to 2s, error rate remains high
10:17 - New query plan regression found in audit listing endpoint
10:20 - Feature flag disabled for audit summary widget
10:25 - User-facing approval flow healthy
10:40 - Backlog drained
10:50 - Incident mitigated, root cause analysis pending
```

Timeline should distinguish:

```text
fact
hypothesis
action
impact
open question
```

---

## 28. Root Cause vs Trigger vs Contributing Factors

Do not reduce incident analysis to one simplistic root cause.

Better model:

```text
trigger
+ latent defect
+ missing guardrail
+ detection gap
+ response gap
+ recovery gap
= incident impact
```

Example:

```text
Trigger:
New deployment increased query frequency.

Latent defect:
Audit listing query had no selective index for high-volume tenant.

Missing guardrail:
No performance regression test for large audit dataset.

Detection gap:
Alert only monitored CPU, not query latency by endpoint.

Response gap:
No kill switch for audit summary widget.

Impact:
Approval page p99 latency exceeded SLO for 46 minutes.
```

This is more useful than:

```text
Root cause: bad query.
```

---

## 29. Blameless Post-Incident Review

Blameless does not mean consequence-free.

It means the analysis targets system improvement rather than personal shame.

Google SRE emphasizes blameless postmortems because blaming individuals discourages people from exposing facts needed for learning.

A good post-incident review asks:

```text
What happened?
What was the impact?
What detected it?
What delayed detection?
What mitigated it?
What made mitigation harder?
What assumptions were wrong?
What guardrails were missing?
What should change in code, config, process, tests, dashboards, runbooks, ownership?
```

### 29.1 Bad Postmortem Language

Bad:

```text
Engineer forgot to validate config.
```

Better:

```text
The deployment process allowed a config value without schema validation or peer review.
```

Bad:

```text
The team carelessly deployed a bad query.
```

Better:

```text
The performance test dataset did not represent production tenant volume, so query regression was not detected before rollout.
```

---

## 30. Postmortem Template

Use a consistent template.

```markdown
# Incident Postmortem: <Title>

## Summary
Short factual summary of what happened.

## Severity
SEV level and reason.

## User / Business Impact
Who was affected, how, for how long.

## Timeline
Timestamped facts, actions, and observations.

## Detection
How the incident was detected.
What should have detected it earlier?

## Root Cause Analysis
Trigger, latent conditions, contributing factors.

## What Went Well
Things that reduced impact.

## What Went Poorly
Things that increased impact or slowed response.

## Where We Got Lucky
Risks that did not materialize but could have.

## Corrective Actions
Action, owner, due date, priority, validation method.

## Preventive Controls
Tests, alerts, guardrails, automation, design changes.

## Follow-up Validation
How we know the fix worked.

## Open Questions
Things not yet understood.
```

---

## 31. Corrective Action Quality

Weak action item:

```text
Be more careful when deploying config.
```

Strong action item:

```text
Add schema validation for tenant-routing config at startup and in CI.
Owner: Platform Team.
Due: 2026-07-10.
Validation: invalid config fails deployment pipeline and service startup.
```

Weak:

```text
Monitor queue better.
```

Strong:

```text
Add alert: oldest unprocessed correspondence event age > 5 minutes for 10 minutes.
Owner: Messaging Platform.
Due: 2026-07-03.
Validation: synthetic delayed event triggers alert in staging.
```

Strong action items have:

1. owner
2. due date
3. measurable outcome
4. validation method
5. priority
6. link to incident
7. tracking status

---

## 32. Reliability Backlog

Postmortems are useless if actions disappear.

Create a reliability backlog with categories:

| Category | Examples |
|---|---|
| Code fix | query optimization, idempotency bug fix |
| Guardrail | config validation, migration check |
| Test | replay test, performance regression test |
| Observability | new SLI, trace attribute, dashboard |
| Runbook | DLQ recovery, rollback guide |
| Architecture | remove synchronous dependency, add outbox |
| Platform | readiness probe, autoscaling, resource limit |
| Process | release checklist, ownership mapping |
| Security | secret rotation alert, cert inventory |
| Data | reconciliation job, repair script framework |

Reliability work must compete with feature work explicitly.

If the organization always deprioritizes reliability backlog, incidents will repeat.

---

## 33. Microservices Incident Dependency Map

During an incident, you need dependency visibility.

A dependency map should show:

```text
service → service calls
service → database
service → broker/topic/queue
service → cache
service → external system
service → identity provider
service → object storage
service → scheduler/job
service → feature flags
service → secrets/certs
service → owning team
service → dashboards/runbooks
```

Without this, responders rely on memory.

Memory fails under pressure.

---

## 34. Runbooks

A runbook is executable operational knowledge.

A good runbook includes:

```text
Symptoms
Impact
Dashboards
Queries/commands
Safe mitigations
Unsafe actions
Rollback steps
Escalation contacts
Validation steps
Known false positives
Related incidents
```

Example runbook sections for message backlog:

```text
1. Identify topic/queue and consumer group.
2. Check lag and age of oldest message.
3. Check consumer error rate.
4. Check DLQ growth.
5. Check downstream DB/API latency.
6. If poison message detected, move to parking lot.
7. If downstream saturated, do not scale consumers.
8. If handler fixed, replay parked messages with rate limit.
9. Validate business state reconciliation.
```

Runbooks must be tested.

An untested runbook is a hypothesis.

---

## 35. Playbooks vs Runbooks

Runbook:

```text
Specific operational procedure.
Example: how to drain DLQ safely.
```

Playbook:

```text
Higher-level response strategy.
Example: how to handle external payment provider outage.
```

Both are useful.

---

## 36. Communication During Incidents

Good communication reduces panic and duplicated work.

Stakeholders need:

```text
What is affected?
Who is affected?
Current severity?
What are we doing?
Known workaround?
Next update time?
```

Avoid:

```text
- speculative root cause
- blaming language
- too much technical detail for business stakeholders
- silence
- overpromising ETA
```

Example update:

```text
SEV-2 update, 10:30 WIB:
Application approval pages are currently slow for internal officers.
Submission by public users remains available.
The team has identified high database load from the audit summary query and disabled the non-critical audit summary widget as mitigation.
Approval latency is improving; we are monitoring for full recovery.
Next update in 30 minutes or sooner if severity changes.
```

---

## 37. Recovery Verification

Do not close incident just because the graph looks green.

Verify:

1. User journey works.
2. Error rate normal.
3. Latency normal.
4. Backlog drained or under control.
5. DLQ classified.
6. Data consistency checked.
7. Projections caught up.
8. External callbacks retried or reconciled.
9. Audit trail complete.
10. Security controls restored.
11. Feature flags restored or tracked.
12. Temporary capacity/config changes documented.

Recovery statement should be evidence-based:

```text
Approval API p95 returned below 500 ms for 30 minutes,
error rate is below 0.1%,
oldest approval event lag is below 30 seconds,
and synthetic approval workflow passes successfully.
```

---

## 38. Java 8–25 Incident Considerations

### 38.1 Java 8

Common incident concerns:

1. Older GC behavior and less container-awareness unless updated.
2. `Date`/timezone mistakes in legacy code.
3. Thread pool exhaustion from blocking calls.
4. Limited modern language modeling for state/invariants.
5. Older TLS/security defaults depending on update level.
6. Legacy libraries with poor observability.

Recommended operational discipline:

```text
GC logs enabled
thread dumps available
heap dump procedure known
connection pool metrics exposed
JMX secured
library versions inventoried
```

### 38.2 Java 11

Improvement baseline:

1. Better HTTP Client availability.
2. Better container support than older Java 8 baselines.
3. Better TLS defaults.
4. JFR available for production profiling.

Operational discipline:

```text
Use JFR for incident evidence.
Expose build/runtime metadata.
Standardize JVM flags per service class.
```

### 38.3 Java 17

Modern LTS baseline:

1. Sealed classes help model incident/domain states.
2. Records reduce DTO boilerplate.
3. Better GC options.
4. Stronger runtime baseline for framework support.

Operational discipline:

```text
Use records for immutable telemetry/event DTOs carefully.
Use sealed hierarchies for finite failure classification.
Use JFR templates for service profiles.
```

### 38.4 Java 21

Virtual threads become final in Java 21.

Incident implication:

Virtual threads can reduce thread exhaustion for blocking IO workloads, but they do not remove downstream capacity limits.

You still need:

```text
connection pool limits
concurrency limiters
timeouts
backpressure
bulkheads
rate limits
```

Virtual-thread incident risks:

1. Too many concurrent DB calls.
2. Carrier thread pinning.
3. Hidden unbounded concurrency.
4. Metrics misleading if team only watches platform thread count.

### 38.5 Java 25

Java 25 is the current latest Java generation in this series scope. Treat it as a runtime horizon for modern services, but apply organizational upgrade discipline.

Incident considerations:

1. Do not mix compile/runtime versions carelessly.
2. Validate framework/library support.
3. Validate container/JVM flags.
4. Validate GC behavior under production-like load.
5. Validate observability agents.
6. Validate native image/toolchain if used.

Operational rule:

```text
Runtime upgrade is a reliability change, not just a build change.
```

---

## 39. JVM Evidence Collection During Incident

For Java services, prepare evidence procedures.

### 39.1 Thread Dump

Use when:

```text
high latency
request stuck
deadlock suspected
thread pool exhausted
blocked synchronized section
virtual thread pinning suspected
```

Look for:

```text
blocked threads
waiting threads
lock owner
thread pool saturation
DB driver calls
HTTP client calls
message listener threads
scheduler threads
```

### 39.2 Heap Dump

Use when:

```text
memory leak suspected
OOM before restart
cache growth suspected
large payload retained
```

Risk:

Heap dumps may contain sensitive data.

Controls:

```text
restricted access
encrypted storage
retention limit
PII handling process
```

### 39.3 JFR

Use when:

```text
CPU high
allocation high
lock contention
GC pressure
latency unexplained
virtual thread behavior unknown
```

JFR is often better than guessing from logs.

### 39.4 GC Logs

Use when:

```text
latency spikes
memory pressure
allocation rate high
container memory issue
```

Track:

```text
pause time
allocation rate
heap after GC
promotion failure
humongous allocation
concurrent cycle behavior
```

---

## 40. Incident Queries and Dashboards

Minimum dashboard set for microservices:

### 40.1 Service Dashboard

```text
request rate
error rate
latency p50/p95/p99
saturation
in-flight requests
thread/concurrency usage
connection pool usage
JVM heap/native memory
GC pause
pod restarts
current version/config
```

### 40.2 Dependency Dashboard

```text
downstream call rate
downstream error rate
downstream latency
retry count
circuit breaker state
fallback count
timeout count
```

### 40.3 Messaging Dashboard

```text
producer rate
consumer rate
lag
oldest message age
handler error rate
retry topic rate
DLQ rate
processing latency
replay mode status
```

### 40.4 Business Dashboard

```text
submissions per minute
approvals per minute
rejections per minute
pending applications
SLA nearing breach
letters generated
payments reconciled
external callbacks pending
```

### 40.5 Data Correctness Dashboard

```text
source/projection count mismatch
outbox unpublished age
inbox duplicate count
orphan records
failed reconciliation count
state transition anomalies
missing audit records
```

---

## 41. Incident Response Decision Matrix

| Situation | Prefer | Avoid |
|---|---|---|
| Recent bad deployment | stop rollout, rollback/roll-forward | debugging for hours while users down |
| DB saturated | shed load, pause jobs, reduce retries | increasing all pools blindly |
| Queue backlog | classify bottleneck, rate-limited catch-up | deleting messages blindly |
| Poison message | park message, fix handler/data | infinite retry loop |
| External API down | circuit break, queue, degrade | retry storm |
| Projection stale | fix handler, replay, reconcile | manual projection edits without source validation |
| Data corruption | stop corruption, cohort analysis, repair plan | ad-hoc SQL patch |
| Auth/cert failure | rotate/restore trust, verify identity path | bypass auth broadly |
| Memory leak | capture evidence, mitigate, rollback | restart-only resolution |
| Tenant-specific issue | isolate tenant, tenant config/data review | global risky change |

---

## 42. Microservices Incident Anti-Patterns

### 42.1 Restart-Driven Operations

```text
Everything is fixed by restart.
```

Restart may hide root cause and erase evidence.

### 42.2 Metric Tunnel Vision

```text
CPU is high, so CPU is the problem.
```

CPU may be symptom of retry storm, serialization, GC, query plan, compression, or traffic spike.

### 42.3 Random Walk Debugging

```text
Open logs, grep errors, guess, restart.
```

Use structured triage.

### 42.4 No Incident Commander

Everyone acts independently.

### 42.5 No Timeline

Postmortem becomes memory-based fiction.

### 42.6 Root Cause Reductionism

One person or one bug is blamed, while missing systemic conditions.

### 42.7 Unowned Follow-Up

Postmortem action items are created but never implemented.

### 42.8 Alert Fatigue

Too many low-quality alerts cause real incidents to be ignored.

### 42.9 Silent Degradation

Background jobs fail without business-level detection.

### 42.10 Manual Production Surgery

Ad-hoc DB updates without review, backup, or audit.

---

## 43. Regulatory / Case Management Incident Example

### Scenario

A regulatory case management platform has these services:

```text
application-service
case-service
workflow-service
correspondence-service
audit-service
notification-service
projection-service
identity-service integration
external-agency-connector
```

Incident:

```text
Officers report that approved applications are not appearing in the “Ready for Letter Generation” worklist.
```

### 43.1 Initial Symptoms

```text
Application approval API success rate normal.
Workflow transition audit exists.
No user-facing 500.
Projection lag alert fired.
Correspondence worklist count stopped increasing.
Kafka consumer lag for projection-service growing.
```

### 43.2 Triage

Questions:

```text
Are approvals actually committed?
Are ApprovalCompleted events published?
Is projection consumer running?
Is handler failing?
Is schema incompatible?
Is this all tenants or one agency?
Is letter generation blocked?
Is statutory notification SLA at risk?
```

### 43.3 Evidence

Findings:

```text
application-service publishes ApprovalCompleted v3.
projection-service deployed yesterday only supports v2 enum value.
Consumer fails on new enum DECISION_READY.
Messages retry repeatedly.
Lag grows.
DLQ disabled for this topic.
```

### 43.4 Immediate Containment

```text
1. Stop projection-service retry storm.
2. Pause consumer group or route failing messages to parking lot.
3. Disable UI count depending on stale projection or show freshness warning.
4. Confirm approval source data remains correct.
```

### 43.5 Mitigation

```text
1. Deploy projection-service fix supporting new enum.
2. Reprocess parked messages with rate limit.
3. Monitor oldest unprojected event age.
4. Confirm worklist updates.
```

### 43.6 Recovery Verification

```text
- Source approvals count for time window: 1,240
- Projection ready-for-letter count increment: 1,240
- Consumer lag: 0
- Oldest unprojected event age: < 10 seconds
- Letter generation synthetic flow: pass
- Audit trail complete
```

### 43.7 Postmortem

Trigger:

```text
application-service deployed event enum extension.
```

Latent defect:

```text
projection-service had non-tolerant enum parser.
```

Missing guardrail:

```text
No event contract compatibility test in CI.
```

Detection gap:

```text
Alert fired on lag after 30 minutes; no alert on handler exception rate within 5 minutes.
```

Corrective actions:

```text
1. Add event contract compatibility test for ApprovalCompleted.
2. Change projection parser to tolerate unknown enum with parking-lot classification.
3. Add DLQ/parking-lot policy for projection topics.
4. Add metric for projection handler failure by event type/schema version.
5. Add deployment gate: provider event change must verify registered consumers.
```

---

## 44. Production Readiness Checklist

Before a service is considered production-ready, ask:

### 44.1 Ownership

```text
[ ] Service owner defined
[ ] On-call owner defined
[ ] Business owner defined
[ ] Data owner defined
[ ] Runbook owner defined
[ ] Dashboard owner defined
```

### 44.2 Detection

```text
[ ] User journey SLI exists
[ ] Error rate alert exists
[ ] Latency alert exists
[ ] Saturation alert exists
[ ] Dependency alert exists
[ ] Business throughput alert exists
[ ] Silent failure watchdog exists
```

### 44.3 Mitigation

```text
[ ] Rollback/roll-forward procedure documented
[ ] Feature flags/kill switches identified
[ ] Queue pause/replay procedure documented
[ ] Safe traffic shedding strategy exists
[ ] Dependency fallback strategy exists
[ ] Data repair process exists for critical records
```

### 44.4 Evidence

```text
[ ] Logs include correlation/trace/business IDs
[ ] Metrics include service and dependency health
[ ] Traces cover sync/async boundaries
[ ] Deployment metadata visible
[ ] Config version visible
[ ] JVM evidence collection process exists
```

### 44.5 Recovery

```text
[ ] Recovery validation checklist exists
[ ] Reconciliation job exists where needed
[ ] Projection rebuild/replay process exists
[ ] DLQ handling process exists
[ ] Backup/restore tested
[ ] Postmortem process exists
```

### 44.6 Learning

```text
[ ] Postmortem template exists
[ ] Action item tracking exists
[ ] Reliability backlog reviewed regularly
[ ] Incident patterns feed architecture review
```

---

## 45. Senior / Principal Engineer Review Questions

Use these to evaluate a microservice architecture:

```text
1. What user journeys can fail partially?
2. What is the worst silent failure mode?
3. What alert tells us the business is degraded, not just CPU is high?
4. What is the blast radius of this service failing?
5. What dependencies can cause cascading failure?
6. Which retries can amplify outage?
7. Which queues can accumulate unbounded business risk?
8. How do we recover from poisoned messages?
9. How do we reconcile source-of-truth vs projection?
10. How do we detect duplicate business effects?
11. What runbook exists for DB saturation?
12. What runbook exists for external dependency outage?
13. What is safe to disable under load?
14. What must never be disabled?
15. What recent changes are visible during incident?
16. What evidence is lost on restart?
17. How do we collect JVM evidence securely?
18. Who can approve production data repair?
19. How are postmortem actions tracked to completion?
20. Which past incidents are likely to repeat?
```

---

## 46. Practical Exercises

### Exercise 1 — Incident Timeline

Given this data:

```text
09:00 deployment v42
09:07 p99 latency increases
09:10 API 504 starts
09:14 DB active sessions spike
09:16 retry count 8x normal
09:20 user reports approval page timeout
09:25 rollback starts
09:31 latency improves
09:45 backlog drains
```

Create:

1. Incident summary.
2. Timeline.
3. Trigger hypothesis.
4. Immediate mitigation.
5. Corrective actions.

### Exercise 2 — Queue Backlog Runbook

Design a runbook for:

```text
notification-service email queue backlog age > 30 minutes
```

Include:

1. Detection.
2. Impact mapping.
3. Bottleneck classification.
4. Safe actions.
5. Unsafe actions.
6. Recovery validation.

### Exercise 3 — Data Corruption Incident

Scenario:

```text
A bug approved 80 applications without required second review.
```

Design response:

1. Stop corruption.
2. Identify affected cohort.
3. Decide repair vs manual review.
4. Notify stakeholders.
5. Preserve audit evidence.
6. Prevent recurrence.

### Exercise 4 — Postmortem Rewrite

Rewrite this blameful statement:

```text
Developer X forgot to update the consumer, causing the outage.
```

Into systemic language.

### Exercise 5 — Reliability Backlog

For a service you own, list:

1. Top 5 incident risks.
2. Top 5 missing alerts.
3. Top 5 missing runbooks.
4. Top 5 reliability backlog items.

---

## 47. Key Takeaways

1. Microservices incidents are usually partial, distributed, and ambiguous.
2. Incident response prioritizes stabilization before perfect root cause discovery.
3. The first minutes should establish roles, impact, timeline, and safe containment.
4. Cascading failure is often caused by positive feedback loops such as retries, queues, and resource saturation.
5. Data corruption incidents require different discipline from availability incidents.
6. Queue backlog is stored business risk, not just a technical metric.
7. Projection staleness is a first-class incident in CQRS/event-driven systems.
8. Blameless postmortems are not soft; they are a mechanism for better facts and better systems.
9. Corrective actions must be concrete, owned, dated, and verifiable.
10. Reliability operations are part of architecture.

---

## 48. References

- Google SRE Book — Emergency Response: https://sre.google/sre-book/emergency-response/
- Google SRE Book — Addressing Cascading Failures: https://sre.google/sre-book/addressing-cascading-failures/
- Google SRE Book — Postmortem Culture: https://sre.google/sre-book/postmortem-culture/
- Google SRE Workbook — Incident Response: https://sre.google/workbook/incident-response/
- Google SRE Workbook — Postmortem Culture: https://sre.google/workbook/postmortem-culture/
- Google SRE Incident Management Guide: https://sre.google/resources/practices-and-processes/incident-management-guide/
- AWS Well-Architected Framework — Reliability Pillar: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html
- AWS Reliability Pillar — Resiliency and Components of Reliability: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/resiliency-and-the-components-of-reliability.html
- Atlassian Incident Management: https://www.atlassian.com/incident-management
- Atlassian Incident Response Lifecycle: https://www.atlassian.com/incident-management/incident-response/lifecycle
- Atlassian Postmortems: https://www.atlassian.com/incident-management/handbook/postmortems
- OpenJDK JDK 25 Project: https://openjdk.org/projects/jdk/25/
- Oracle Java Virtual Threads Guide: https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html

---

## 49. Series Progress

```text
Completed:
Part 0  - Introduction and Mental Model
Part 1  - Distributed Systems Reality
Part 2  - Service Boundary Engineering
Part 3  - Domain Modeling for Microservices
Part 4  - Microservice Architecture Styles
Part 5  - Synchronous API Communication
Part 6  - Asynchronous Messaging
Part 7  - Event-Driven Architecture
Part 8  - Transaction, Saga, and Compensation
Part 9  - Outbox, Inbox, CDC, and Reliable Publishing
Part 10 - Consistency and Distributed Invariants
Part 11 - Data Ownership and Database-per-Service
Part 12 - Query Pattern, API Composition, CQRS, Materialized View
Part 13 - API Gateway, Edge, BFF, Experience Layer
Part 14 - Service Discovery, Configuration, Runtime Topology
Part 15 - Resilience: Timeout, Retry, Circuit Breaker, Bulkhead
Part 16 - Backpressure, Flow Control, Capacity-Aware Design
Part 17 - Idempotency, Deduplication, Exactly-Once Business Effect
Part 18 - Workflow, Orchestration, Choreography, Process Managers
Part 19 - State Machine Pattern for Microservices
Part 20 - Service-to-Service Security Patterns
Part 21 - Multi-Tenancy, Isolation, Regulatory Segmentation
Part 22 - Observability Patterns
Part 23 - Testing Strategy for Microservices
Part 24 - Contract, Schema, Compatibility Engineering
Part 25 - Deployment Pattern and Release Safety
Part 26 - Runtime Platform: Kubernetes, Service Mesh, Java Runtime
Part 27 - Performance Engineering for Microservices
Part 28 - Caching Patterns
Part 29 - Data Migration, Monolith Decomposition, Strangler Fig
Part 30 - Governance, Ownership, Socio-Technical Architecture
Part 31 - Incident, Failure Analysis, Reliability Operations

Remaining:
Part 32 - Cost, Complexity, and Architecture Economics
Part 33 - Microservices Anti-Patterns and Failure Taxonomy
Part 34 - Capstone Architecture Review
```

Seri belum selesai. Part berikutnya adalah:

```text
Part 32 — Cost, Complexity, and Architecture Economics
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-30-governance-ownership-socio-technical-architecture.md">⬅️ Learn Java Microservices Patterns — Advanced Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-32-cost-complexity-architecture-economics.md">0. Posisi Part Ini di Dalam Series ➡️</a>
</div>
