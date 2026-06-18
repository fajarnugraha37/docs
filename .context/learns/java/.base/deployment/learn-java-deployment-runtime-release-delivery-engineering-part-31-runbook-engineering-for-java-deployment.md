# learn-java-deployment-runtime-release-delivery-engineering — Part 31  
# Runbook Engineering for Java Deployment

> **Series:** `learn-java-deployment-runtime-release-delivery-engineering`  
> **Part:** 31 of 35  
> **Topic:** Runbook Engineering for Java Deployment  
> **Scope:** Java 8–25, Linux VM, systemd, container, Kubernetes, Spring Boot, servlet container, app server, distributed services  
> **Goal:** Membuat runbook deployment Java yang bisa dieksekusi oleh engineer lain secara aman, repeatable, auditable, dan tidak bergantung pada hero knowledge.

---

## 0. Posisi Part Ini Dalam Series

Sampai titik ini kita sudah membahas:

1. mental model deployment;
2. evolusi Java 8–25;
3. artifact taxonomy;
4. runtime selection;
5. OS/process/filesystem contract;
6. configuration deployment;
7. JVM options;
8. Linux server packaging;
9. containerization;
10. Dockerfile patterns;
11. `jlink`, `jdeps`, `jpackage`;
12. classpath/module/classloader failure;
13. application server deployment;
14. Spring Boot deployment;
15. Kubernetes deployment;
16. probes, graceful shutdown, traffic draining;
17. resource sizing;
18. release strategies;
19. database-aware deployment;
20. stateful deployment;
21. secret/certificate rotation;
22. observability-ready deployment;
23. deployment verification;
24. CI/CD pipeline;
25. supply chain security;
26. deployment security hardening;
27. multi-environment deployment;
28. multi-service deployment;
29. legacy deployment;
30. modern Java deployment;
31. failure modeling and RCA.

Part ini menjawab pertanyaan:

> “Bagaimana semua pengetahuan deployment tadi diubah menjadi **runbook** yang bisa dipakai saat real deployment, maintenance window, incident, rollback, dan audit?”

Runbook adalah jembatan antara **architecture knowledge** dan **operational execution**.

Engineer junior biasanya menulis runbook sebagai daftar command.

Engineer senior menulis runbook sebagai **decision system**.

Engineer top-tier menulis runbook sebagai **safety mechanism**: runbook mengurangi ambiguity, mempercepat recovery, mencegah aksi destruktif, memberi evidence, dan membuat sistem tetap bisa dioperasikan walau orang paling paham sedang tidak tersedia.

---

## 1. Apa Itu Runbook?

Secara praktis:

> **Runbook adalah dokumen operasional yang menjelaskan cara menjalankan, memverifikasi, memulihkan, dan mengeskalasi aktivitas production secara repeatable.**

Dalam konteks Java deployment, runbook harus menjawab:

1. Apa yang akan berubah?
2. Siapa yang boleh melakukan?
3. Kapan boleh dilakukan?
4. Apa precondition-nya?
5. Apa langkah deployment-nya?
6. Apa yang harus dicek setelah setiap fase?
7. Apa gejala failure yang mungkin muncul?
8. Apa keputusan rollback/roll-forward?
9. Bagaimana mengambil diagnostic evidence?
10. Bagaimana mengkomunikasikan status?
11. Bagaimana membuktikan deployment berhasil?
12. Bagaimana menutup aktivitas dengan audit trail?

Runbook bukan hanya SOP.

Runbook adalah **operational contract**.

---

## 2. Runbook vs Checklist vs Playbook vs SOP

Istilah sering tertukar. Untuk deployment engineering, bedakan seperti ini.

| Istilah | Fokus | Contoh |
|---|---|---|
| Checklist | daftar pengecekan ringkas | “artifact uploaded?”, “DB backup verified?”, “health OK?” |
| SOP | prosedur standar | “cara deploy service X ke UAT” |
| Runbook | prosedur operasional executable + decision points | “deploy, verify, rollback, capture evidence” |
| Playbook | kumpulan runbook untuk skenario tertentu | “production deployment playbook”, “incident response playbook” |
| Postmortem/RCA template | pembelajaran setelah incident | “timeline, impact, root cause, action item” |

Runbook yang baik biasanya berisi checklist di dalamnya, tetapi tidak berhenti sebagai checklist.

---

## 3. Mental Model: Runbook Sebagai State Machine

Cara paling kuat memahami runbook adalah menganggap deployment sebagai state machine.

```text
[Planned]
   |
   v
[Pre-Check]
   |
   | all gates pass
   v
[Deploying]
   |
   | artifact/config/runtime applied
   v
[Stabilizing]
   |
   | readiness + traffic + dependency checks
   v
[Verifying]
   |
   | smoke/synthetic/metrics/logs OK
   v
[Completed]
```

Tetapi real production tidak linear.

Ada branches:

```text
[Deploying]
   |
   +--> [Deployment Failed Before Traffic]
   |          |
   |          +--> rollback artifact/config
   |
   +--> [Traffic Receiving But Error Rising]
   |          |
   |          +--> drain traffic
   |          +--> rollback/canary pause
   |
   +--> [DB Migration Partially Applied]
   |          |
   |          +--> stop app rollout
   |          +--> apply forward fix or compatibility patch
   |
   +--> [Unknown Failure]
              |
              +--> freeze changes
              +--> capture diagnostics
              +--> escalate
```

Runbook harus eksplisit tentang:

1. state saat ini;
2. allowed transition;
3. forbidden transition;
4. rollback condition;
5. evidence yang harus dikumpulkan sebelum state berubah.

Top-tier engineer tidak hanya bertanya:

> “Command apa yang dijalankan?”

Mereka bertanya:

> “State apa yang berubah, invariant apa yang harus tetap benar, dan bagaimana kita tahu transition aman?”

---

## 4. Prinsip Utama Runbook Deployment Java

### 4.1 Runbook Harus Executable

Runbook yang baik bisa dijalankan oleh engineer lain tanpa harus membaca pikiran penulisnya.

Buruk:

```text
Deploy latest version.
Check logs.
Rollback if needed.
```

Baik:

```text
Deploy image:
registry.example.com/payment-service:2026.06.18.1430-a1b2c3d

Run:
kubectl -n payment rollout status deploy/payment-service --timeout=10m

Verify:
curl -fsS https://internal.example.com/payment/actuator/health/readiness

Rollback if:
- 5xx rate > 1% for 5 minutes
- readiness fails for all new pods
- DB connection pool active = max for 3 consecutive samples
- business smoke transaction fails twice
```

### 4.2 Runbook Harus Memisahkan Observation dan Action

Observation:

```text
Check current pod status.
Check current error rate.
Check current DB pool saturation.
```

Action:

```text
Scale down new version.
Rollback deployment revision.
Disable feature flag.
Restart consumer group.
```

Jika observation dan action dicampur, engineer mudah melakukan tindakan berlebihan.

Buruk:

```text
If app looks slow, restart pods.
```

Baik:

```text
If p95 latency > baseline by 2x:
1. Check CPU throttling.
2. Check DB connection pool saturation.
3. Check downstream timeout.
4. Check GC pause.
5. Restart only if evidence indicates stuck process, deadlock, or unrecoverable resource leak.
```

### 4.3 Runbook Harus Mengandung Stop Conditions

Runbook bukan instruksi untuk terus maju apa pun yang terjadi.

Harus ada kondisi berhenti:

```text
STOP deployment if:
- artifact checksum does not match release evidence;
- DB backup verification failed;
- target environment has active P1/P2 incident;
- dependency service is degraded;
- smoke test from previous deployment is already failing;
- migration lock cannot be acquired safely;
- approval window has expired;
- rollback artifact is not available.
```

### 4.4 Runbook Harus Menghindari “Hero Commands”

Hero command adalah command yang hanya aman jika dijalankan oleh orang yang sangat paham konteks.

Contoh berbahaya:

```bash
kubectl delete pod -n prod --all
```

atau:

```sql
DROP TABLE TEMP_OLD_CASE_DATA;
```

atau:

```bash
kill -9 $(pgrep java)
```

Jika command destruktif memang diperlukan, runbook harus memaksa validasi:

```text
Before executing destructive command:
- Confirm namespace = prod-case-management.
- Confirm deployment = case-service only.
- Confirm current traffic = drained.
- Confirm incident commander approval.
- Paste output of current pods.
- Execute one pod at a time.
```

### 4.5 Runbook Harus Capture Evidence

Tanpa evidence, deployment hanya menjadi “katanya berhasil”.

Evidence minimal:

1. artifact version;
2. Git commit;
3. image digest;
4. deployment timestamp;
5. operator;
6. environment;
7. pre-check result;
8. post-check result;
9. key metrics before/after;
10. log excerpt if relevant;
11. rollback status if rollback occurred;
12. final sign-off.

---

## 5. Anatomy of a Production Java Deployment Runbook

Template besar:

```text
1. Metadata
2. Scope
3. Change Summary
4. Preconditions
5. Risk Classification
6. System Context
7. Dependency Map
8. Artifact and Version Evidence
9. Configuration Evidence
10. Database/Migration Plan
11. Deployment Steps
12. Verification Steps
13. Monitoring Window
14. Rollback / Roll-forward Plan
15. Diagnostic Capture
16. Communication Plan
17. Escalation Matrix
18. Completion Criteria
19. Audit Evidence
20. Post-Deployment Notes
```

Mari kita bedah satu per satu.

---

## 6. Section 1 — Metadata

Metadata membuat runbook searchable, auditable, dan traceable.

```markdown
# Deployment Runbook — Case Service v2026.06.18

| Field | Value |
|---|---|
| System | ACEAS Case Management |
| Service | case-service |
| Environment | UAT / PROD |
| Release ID | REL-2026-06-18-001 |
| Change Request | CRQ-123456 |
| Git Commit | a1b2c3d4 |
| Artifact | case-service.jar |
| Image Digest | sha256:... |
| Java Version | Java 21.0.x |
| Runtime Vendor | Eclipse Temurin |
| Deployment Type | Kubernetes rolling update |
| Rollout Strategy | Canary 10% → 50% → 100% |
| Prepared By | ... |
| Approved By | ... |
| Maintenance Window | 2026-06-18 22:00–23:00 |
```

Kenapa image digest penting?

Karena tag bisa mutable.

```text
payment-service:latest
```

bukan evidence yang kuat.

Lebih kuat:

```text
payment-service@sha256:9f8d...
```

---

## 7. Section 2 — Scope

Scope menjawab apa yang berubah dan apa yang tidak berubah.

Contoh:

```markdown
## Scope

This runbook covers deployment of:
- case-service backend;
- new Kubernetes ConfigMap version;
- Flyway migration V20260618_01;
- updated truststore mounted as Kubernetes Secret.

This runbook does not cover:
- frontend deployment;
- Keycloak realm configuration;
- database parameter group change;
- RabbitMQ topology change.
```

Scope harus eksplisit karena banyak incident terjadi akibat hidden change.

Misalnya deployment “backend only” ternyata juga mengubah:

1. DB schema;
2. cache key;
3. queue payload format;
4. config endpoint;
5. certificate;
6. role mapping;
7. JVM flags.

---

## 8. Section 3 — Change Summary

Change summary harus bisa dibaca oleh operator, PM, QA, security, dan support.

Buruk:

```text
Deploy new build.
```

Baik:

```text
This release changes case escalation calculation logic.
The service remains backward-compatible with existing case records.
No API path is removed.
A nullable column ESCALATION_REASON_CODE is added.
The feature is disabled by default and enabled only for agency ABC after post-deployment verification.
```

Format bagus:

```markdown
## Change Summary

### Functional Change
- Adds escalation reason code to enforcement case escalation flow.
- Existing cases without escalation reason remain valid.

### Technical Change
- Adds nullable DB column.
- Adds new API response field.
- Adds config flag `case.escalation.reason.enabled`.

### Operational Impact
- Requires rolling restart of `case-service`.
- No expected downtime.
- Requires 30-minute monitoring window.

### Compatibility
- Old app version can run against new DB schema.
- New app version can process old records.
- Rollback of app does not require DB rollback.
```

---

## 9. Section 4 — Preconditions

Preconditions adalah gate sebelum deployment.

### 9.1 Common Preconditions

```markdown
## Preconditions

- Change request approved.
- Release artifact built from approved commit.
- Artifact checksum verified.
- Container image scanned.
- SBOM generated.
- Deployment window active.
- Previous deployment is stable.
- No active P1/P2 incident on target environment.
- Rollback artifact available.
- Required personnel available.
- Monitoring dashboard accessible.
- Logs accessible.
- Database backup completed if migration is included.
- Feature flags default to safe state.
```

### 9.2 Java-Specific Preconditions

```markdown
## Java Runtime Preconditions

- Target Java runtime version matches certified matrix.
- JVM options reviewed and compatible with runtime.
- Required `--add-opens` / `--add-exports` flags documented if applicable.
- Heap/non-heap sizing reviewed against container limit.
- JFR/GC log/heap dump path writable.
- Timezone and encoding explicitly configured if required.
- Truststore/keystore mounted and readable.
- Application user has no unnecessary write permission.
```

### 9.3 Kubernetes Preconditions

```markdown
## Kubernetes Preconditions

- Target namespace confirmed.
- Current pods are healthy.
- HPA status normal.
- Node capacity sufficient.
- No pending pods in namespace.
- Deployment revision history available.
- PodDisruptionBudget not blocking rollout unexpectedly.
- ConfigMap/Secret versions confirmed.
- Service endpoints currently populated.
- Ingress/route health confirmed.
```

Useful commands:

```bash
kubectl -n <namespace> get deploy,rs,pod,svc,endpoints
kubectl -n <namespace> describe deploy <deployment>
kubectl -n <namespace> get events --sort-by=.metadata.creationTimestamp
kubectl -n <namespace> top pod
```

### 9.4 Database Preconditions

```markdown
## Database Preconditions

- DB connectivity verified.
- Migration tool baseline validated.
- Schema history table healthy.
- No unexpected pending migration.
- Migration lock strategy understood.
- Backup/restore procedure confirmed if destructive migration exists.
- Migration is backward-compatible.
- Expected lock duration documented.
```

---

## 10. Section 5 — Risk Classification

Not all deployments need the same ceremony.

Classify risk.

| Risk Level | Example | Runbook Depth |
|---|---|---|
| Low | config text copy change, no DB, no dependency | simple runbook + smoke |
| Medium | backend logic change, rolling deploy | standard runbook |
| High | DB migration, auth, payment, case state transition | full runbook + rollback + monitoring |
| Critical | schema destructive change, certificate rotation, infrastructure migration | full runbook + war room + rehearsal |

Risk dimensions:

1. downtime potential;
2. rollback difficulty;
3. data mutation;
4. security impact;
5. external dependency impact;
6. user-facing criticality;
7. regulatory/compliance relevance;
8. traffic volume;
9. number of services involved;
10. compatibility risk;
11. statefulness;
12. operational novelty.

A deployment is high-risk if rollback is not trivial.

---

## 11. Section 6 — System Context

Runbook should show enough architecture context so operator understands blast radius.

Example:

```text
[User]
  |
  v
[Ingress / API Gateway]
  |
  v
[case-service]
  |-- Oracle DB
  |-- Redis cache
  |-- RabbitMQ case-events
  |-- document-service
  |-- notification-service
```

Important context:

1. inbound traffic path;
2. outbound dependencies;
3. database schema;
4. queues/topics;
5. scheduler/jobs;
6. cache usage;
7. identity provider;
8. file/object storage;
9. external APIs;
10. monitoring dashboards.

A good runbook does not need a full architecture document, but it should contain the **operational dependency map**.

---

## 12. Section 7 — Dependency Map and Health Gates

For each dependency:

| Dependency | Type | Required for Startup? | Required for Readiness? | Degraded Behavior | Verification |
|---|---|---:|---:|---|---|
| Oracle DB | Database | Yes | Yes | app not ready | DB health check |
| Redis | Cache | No | Maybe | slower / cache miss | cache ping |
| RabbitMQ | Queue | No | consumer disabled | delayed async processing | queue depth |
| Keycloak | IdP | No at startup | auth flows fail | login failure | token request |
| S3/Object storage | file | No | file upload/download fail | feature degraded | object put/get |

This avoids binary thinking.

Not every dependency must block readiness.

For example:

- DB down may mean service should be not ready.
- optional notification service down may not block all traffic.
- Redis down may degrade performance but not correctness.
- queue down may block async workflows but not read-only APIs.

Runbook should state this explicitly.

---

## 13. Section 8 — Artifact and Version Evidence

A production deployment runbook must eliminate “which version is running?” ambiguity.

### 13.1 Artifact Evidence

```markdown
## Artifact Evidence

| Item | Value |
|---|---|
| Git Commit | a1b2c3d4 |
| Build Number | 2026.06.18.1430 |
| Maven Version | 1.24.0 |
| Java Target | 21 |
| Container Image | registry.example.com/case-service |
| Image Tag | 1.24.0-20260618-a1b2c3d |
| Image Digest | sha256:... |
| SBOM | attached |
| Signature | verified |
```

### 13.2 Runtime Evidence

```bash
java -version
```

In Kubernetes:

```bash
kubectl -n <namespace> exec deploy/<deployment> -- java -version
```

But be careful: distroless image may not have shell or tools.

Better pattern: expose build/runtime metadata through safe endpoint.

Example Spring Boot:

```text
/actuator/info
/actuator/health
```

Useful info:

```json
{
  "build": {
    "artifact": "case-service",
    "version": "1.24.0",
    "time": "2026-06-18T14:30:00Z"
  },
  "git": {
    "commit": {
      "id": "a1b2c3d4"
    }
  },
  "runtime": {
    "java": "21.0.x",
    "vendor": "Eclipse Temurin"
  }
}
```

---

## 14. Section 9 — Configuration Evidence

Many deployment incidents are not artifact incidents. They are config incidents.

Runbook should include:

```markdown
## Configuration Evidence

| Config | Expected Value | Source | Runtime Verification |
|---|---|---|---|
| `SPRING_PROFILES_ACTIVE` | `prod` | Deployment env | `/actuator/env` restricted |
| `JAVA_TOOL_OPTIONS` | documented JVM flags | Deployment manifest | process args |
| DB URL | prod Oracle endpoint | Secret | app logs / health |
| Redis host | prod Redis endpoint | Secret/ConfigMap | health check |
| Feature flag | disabled initially | config service | flag dashboard |
| Truststore version | 2026-06 bundle | Secret | TLS test |
```

Avoid exposing secret values.

Evidence should show:

1. secret name/version;
2. checksum;
3. mount path;
4. last rotation date;
5. runtime verification result.

Not the secret itself.

---

## 15. Section 10 — Database / Migration Plan

If migration exists, runbook must include a dedicated section.

### 15.1 Migration Classification

| Type | Example | Risk |
|---|---|---|
| Additive | add nullable column | low-medium |
| Additive with backfill | add column + populate | medium |
| Index creation | create index | medium/high depending DB |
| Constraint addition | not null / FK / unique | high |
| Destructive | drop/rename column | high |
| Data transformation | rewrite rows | high |
| Stored procedure/package change | DB-side logic change | medium/high |

### 15.2 Migration Runbook Section

```markdown
## Database Migration

Migration Tool: Flyway
Schema History Table: flyway_schema_history
Migration Files:
- V20260618_01__add_escalation_reason_code.sql
- V20260618_02__create_case_escalation_index.sql

Expected Duration:
- < 2 minutes in UAT
- < 5 minutes in PROD based on row count estimate

Compatibility:
- Old app can run with new schema.
- New app can run with old records.
- DB rollback is not required for app rollback.

Pre-Migration Checks:
- verify no invalid objects;
- verify active sessions;
- verify table row count;
- verify no blocking locks;
- verify backup completed.

Post-Migration Checks:
- schema history updated;
- expected column/index exists;
- no invalid objects;
- app health OK.
```

### 15.3 Migration Decision Rule

Example:

```text
If migration fails before applying any DDL:
- stop deployment;
- keep old app running;
- investigate migration script.

If migration applies additive DDL but app deployment fails:
- rollback app only;
- keep DB schema as-is;
- create follow-up cleanup CR if needed.

If migration partially applies destructive DDL:
- do not blindly rollback;
- freeze deployment;
- capture DB state;
- escalate to DBA and app owner.
```

---

## 16. Section 11 — Deployment Steps

Deployment steps should be precise.

### 16.1 Kubernetes Rolling Deployment Example

```markdown
## Deployment Steps — Kubernetes

1. Confirm current deployment revision.

```bash
kubectl -n case-prod rollout history deploy/case-service
kubectl -n case-prod get deploy case-service -o wide
```

2. Confirm current pods are healthy.

```bash
kubectl -n case-prod get pods -l app=case-service
kubectl -n case-prod get endpoints case-service
```

3. Apply manifest.

```bash
kubectl -n case-prod apply -f manifests/prod/case-service.yaml
```

4. Monitor rollout.

```bash
kubectl -n case-prod rollout status deploy/case-service --timeout=10m
```

5. Confirm new ReplicaSet.

```bash
kubectl -n case-prod get rs -l app=case-service
```

6. Confirm all new pods ready.

```bash
kubectl -n case-prod get pods -l app=case-service -o wide
```
```

### 16.2 Helm Example

```bash
helm upgrade case-service ./chart \
  --namespace case-prod \
  --values values-prod.yaml \
  --set image.tag=1.24.0-20260618-a1b2c3d \
  --atomic \
  --timeout 10m
```

Important:

`--atomic` can rollback Helm release if upgrade fails, but it cannot always reverse external side effects such as DB migrations, message emissions, or changed external configuration.

### 16.3 Argo CD / GitOps Example

```bash
argocd app diff case-service-prod
argocd app sync case-service-prod
argocd app wait case-service-prod --health --timeout 600
```

GitOps runbook should include:

1. commit SHA of desired state repo;
2. application name;
3. sync policy;
4. auto-sync or manual sync;
5. prune behavior;
6. rollback commit.

### 16.4 systemd VM Deployment Example

```bash
sudo systemctl status case-service

sudo install -o case -g case -m 0644 \
  case-service-1.24.0.jar \
  /opt/case-service/releases/1.24.0/case-service.jar

sudo ln -sfn /opt/case-service/releases/1.24.0 /opt/case-service/current

sudo systemctl restart case-service

sudo systemctl status case-service --no-pager
journalctl -u case-service -n 200 --no-pager
```

Better with staged deployment:

```text
1. upload new release directory;
2. verify checksum;
3. update symlink;
4. restart;
5. health check;
6. retain previous symlink target for rollback.
```

---

## 17. Section 12 — Verification Steps

Verification must be layered.

### 17.1 Layer 1 — Process/Pod Verification

```bash
kubectl -n case-prod get pods -l app=case-service
kubectl -n case-prod describe pod <pod>
kubectl -n case-prod logs deploy/case-service --since=10m
```

For systemd:

```bash
systemctl status case-service
journalctl -u case-service --since "10 minutes ago"
```

### 17.2 Layer 2 — Runtime Verification

Check:

1. Java version;
2. active profile;
3. build version;
4. JVM options;
5. memory limit awareness;
6. timezone;
7. configuration source;
8. health endpoint.

Example:

```bash
curl -fsS https://case.example.com/actuator/health/readiness
curl -fsS https://case.example.com/actuator/info
```

### 17.3 Layer 3 — Dependency Verification

```text
- DB connection healthy
- Redis ping OK
- Queue connection OK
- external API auth OK
- object storage read/write OK
- truststore works for TLS dependency
```

### 17.4 Layer 4 — Functional Smoke

Smoke test should verify critical path only.

Example:

```text
1. Login as test user.
2. Search existing case.
3. Open case detail.
4. Trigger non-mutating validation endpoint.
5. Submit controlled test transaction if allowed.
6. Confirm audit record created.
```

### 17.5 Layer 5 — Business Synthetic

Synthetic check is stronger than health check.

Health check says:

> “The service process can respond.”

Synthetic check says:

> “The system can perform meaningful workflow.”

Example for enforcement/case system:

```text
Create draft case → assign officer → add note → generate correspondence preview → verify audit trail.
```

### 17.6 Layer 6 — Metrics and Logs

Minimum post-deployment window:

```text
Monitor for 15–30 minutes:
- HTTP 5xx rate
- p95/p99 latency
- pod restarts
- readiness flaps
- DB pool usage
- queue depth
- GC pause
- heap/RSS
- CPU throttling
- error log rate
- business transaction failure
```

---

## 18. Section 13 — Monitoring Window

Runbook must define how long to observe before closure.

Example:

```markdown
## Monitoring Window

Duration: 30 minutes after 100% traffic.

Success Criteria:
- 5xx rate < 0.5%;
- p95 latency within 20% of baseline;
- no CrashLoopBackOff;
- no repeated readiness failure;
- DB pool active < 80%;
- queue depth not increasing abnormally;
- no new high-severity error signature;
- business smoke test passed.
```

For high-risk release:

```text
Observe:
- T+5 minutes
- T+15 minutes
- T+30 minutes
- T+60 minutes
- next business peak
```

Some deployments only fail at traffic peak.

So runbook should state:

```text
Final closure is provisional until next peak-hour monitoring passes.
```

---

## 19. Section 14 — Rollback Plan

A rollback plan is not:

```text
rollback if failed
```

It must specify exactly what rollback means.

### 19.1 Artifact Rollback

Kubernetes:

```bash
kubectl -n case-prod rollout undo deploy/case-service
kubectl -n case-prod rollout status deploy/case-service --timeout=10m
```

Helm:

```bash
helm history case-service -n case-prod
helm rollback case-service <REVISION> -n case-prod --timeout 10m
```

systemd symlink:

```bash
sudo ln -sfn /opt/case-service/releases/1.23.4 /opt/case-service/current
sudo systemctl restart case-service
```

### 19.2 Config Rollback

```text
- restore previous ConfigMap/Secret version;
- restart pods if app does not support live reload;
- verify runtime config;
- validate health.
```

### 19.3 Feature Flag Rollback

```text
- disable flag;
- flush config cache if required;
- verify flag read path;
- monitor business metric.
```

Feature flag rollback is usually safer than artifact rollback, but only if:

1. flag is truly runtime controllable;
2. old and new code paths both work;
3. state created by new path is compatible;
4. flag value propagation is fast enough;
5. flag dashboard access is controlled.

### 19.4 Database Rollback

Database rollback is hardest.

Runbook should avoid pretending it is simple.

For additive migration:

```text
App rollback only. Leave DB column/index in place.
```

For destructive migration:

```text
No immediate DB rollback unless pre-approved restore plan exists.
Freeze app deployment and escalate.
```

### 19.5 Rollback Decision Matrix

| Symptom | First Action | Rollback? |
|---|---|---|
| New pods fail readiness | pause rollout, inspect logs | likely yes |
| 5xx rises only on new pods | shift traffic away | yes/canary rollback |
| DB migration failed before app rollout | stop deployment | no app rollback needed |
| New feature wrong but flag available | disable flag | no artifact rollback |
| CPU throttling due wrong limit | patch resource/config | maybe no |
| classpath error at startup | rollback artifact | yes |
| schema incompatible with old app | roll forward fix | rollback may be unsafe |
| certificate invalid | restore previous cert/truststore | config rollback |
| queue duplicate processing | stop consumers, inspect idempotency | not blindly |

---

## 20. Section 15 — Roll-Forward Plan

Top-tier runbook includes roll-forward.

Rollback is not always safest.

Roll-forward is preferred when:

1. DB schema already changed incompatibly;
2. old version cannot process new data;
3. new version created data shape old version rejects;
4. fix is small and verified;
5. rollback would extend outage;
6. traffic can be isolated while patch deploys.

Roll-forward runbook should include:

```text
- fix artifact source;
- emergency build procedure;
- expedited approval path;
- smoke test scope;
- deployment path;
- rollback-from-rollforward risk.
```

Do not improvise this during incident.

---

## 21. Section 16 — Diagnostic Capture

Runbook should tell engineer what to capture **before** restarting or rolling back, because restart destroys evidence.

### 21.1 Kubernetes Evidence

```bash
kubectl -n <ns> get deploy,rs,pod,svc,endpoints -o wide
kubectl -n <ns> describe deploy <deployment>
kubectl -n <ns> describe pod <pod>
kubectl -n <ns> get events --sort-by=.metadata.creationTimestamp
kubectl -n <ns> logs <pod> --previous
kubectl -n <ns> logs <pod> --since=30m
```

If pod restarted, `--previous` is often crucial.

### 21.2 JVM Evidence

If tools are available:

```bash
jcmd <pid> VM.version
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
jcmd <pid> Thread.print
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
```

Heap dump:

```bash
jcmd <pid> GC.heap_dump /path/to/heapdump.hprof
```

JFR:

```bash
jcmd <pid> JFR.start name=incident settings=profile duration=120s filename=/path/to/incident.jfr
```

Thread dump repeated:

```bash
for i in 1 2 3; do
  jcmd <pid> Thread.print > thread-dump-$i.txt
  sleep 10
done
```

Why repeated?

A single thread dump is a snapshot. Repeated dumps show whether threads are stuck, progressing, or cycling.

### 21.3 Spring Boot Actuator Evidence

If exposed securely:

```text
/actuator/health
/actuator/health/liveness
/actuator/health/readiness
/actuator/info
/actuator/metrics
/actuator/loggers
/actuator/threaddump
/actuator/heapdump
```

Be careful:

1. heapdump can contain sensitive data;
2. threaddump can expose URLs/tokens in thread names/log context;
3. env/config endpoints can leak secrets;
4. actuator must not be broadly exposed.

### 21.4 Linux/systemd Evidence

```bash
systemctl status case-service --no-pager
journalctl -u case-service --since "30 minutes ago" --no-pager
ps -ef | grep java
ss -ltnp
lsof -p <pid> | wc -l
top -Hp <pid>
```

### 21.5 Database Evidence

```text
- active sessions
- blocking locks
- connection count
- long-running SQL
- migration history
- invalid objects
- tablespace/free storage
```

SQL differs by database, so runbook should include DB-specific queries for Oracle/PostgreSQL/MySQL as appropriate.

---

## 22. Section 17 — Restart Runbook

Restart is often treated casually. It should not be.

A restart can:

1. drop in-flight requests;
2. duplicate queue messages;
3. release locks;
4. abandon transactions;
5. clear caches;
6. trigger thundering herd;
7. move leadership;
8. hide evidence;
9. amplify DB load;
10. break sticky sessions.

### 22.1 Safe Restart Decision

Restart only if:

```text
- process is unhealthy and cannot recover;
- evidence has been captured if incident is active;
- traffic can be drained;
- readiness can be set false or pod can be removed from service;
- consumer can stop fetching new messages;
- scheduler/leader election behavior is understood;
- restart order is documented.
```

### 22.2 Kubernetes Safe Restart

For Deployment:

```bash
kubectl -n <ns> rollout restart deploy/<deployment>
kubectl -n <ns> rollout status deploy/<deployment> --timeout=10m
```

For one pod only:

```bash
kubectl -n <ns> delete pod <pod>
```

But before deleting:

```bash
kubectl -n <ns> describe pod <pod>
kubectl -n <ns> logs <pod> --since=30m > pod.log
kubectl -n <ns> logs <pod> --previous > pod.previous.log
```

### 22.3 systemd Safe Restart

```bash
sudo systemctl stop case-service
# wait for process termination and port release
sudo systemctl start case-service
sudo systemctl status case-service --no-pager
```

Prefer graceful stop/start over blind restart when shutdown has side effects.

---

## 23. Section 18 — Traffic Drain Runbook

Traffic draining is essential for Java services.

### 23.1 HTTP Service Drain

Expected sequence:

```text
1. Mark instance not ready.
2. Load balancer removes endpoint.
3. Stop accepting new traffic.
4. Finish in-flight requests.
5. Close server gracefully.
6. Close pools.
7. Exit process.
```

Kubernetes concepts:

```text
readiness false → endpoint removed → SIGTERM → grace period → SIGKILL if not exited
```

Runbook should specify:

```text
terminationGracePeriodSeconds = 60
spring.lifecycle.timeout-per-shutdown-phase = 45s
preStop sleep = only if needed for LB propagation
```

### 23.2 Queue Consumer Drain

For RabbitMQ/Kafka/JMS consumers:

```text
1. Stop fetching new messages.
2. Finish current message.
3. Ack only after successful processing.
4. Do not ack failed/incomplete work.
5. Close consumer connection.
6. Verify queue depth and unacked messages.
```

Do not kill queue consumers blindly.

### 23.3 Scheduler Drain

For scheduled jobs:

```text
1. Identify active job.
2. Check if job is idempotent.
3. Disable scheduler trigger if needed.
4. Wait for job completion or safe checkpoint.
5. Restart.
6. Re-enable trigger.
```

For Quartz cluster:

```text
- verify cluster check-in;
- verify fired triggers;
- avoid duplicate scheduler identity;
- check misfire behavior.
```

---

## 24. Section 19 — Communication Plan

Runbook should define communication, especially for production.

Example:

```markdown
## Communication Plan

Channel:
- Primary: #prod-release-case
- Incident: #incident-war-room
- Stakeholder update: email distribution list

Roles:
- Deployment Operator: executes commands
- Verifier: runs smoke/synthetic tests
- Observer: monitors dashboard/logs
- Decision Owner: rollback/roll-forward decision
- Communicator: updates stakeholders
- DBA: migration support if needed
- Infra: cluster/network support if needed
```

### 24.1 Status Update Template

```text
[10:05] Deployment started for case-service v1.24.0 in PROD.
Scope: backend rolling update + additive DB migration.
Current status: migration completed, rollout at 25%.
Health: readiness OK, no elevated 5xx.
Next update: T+10 minutes or on status change.
```

### 24.2 Rollback Update Template

```text
[10:17] Rollback initiated for case-service v1.24.0.
Reason: new pods show repeated readiness failure due config binding error.
Impact: no user traffic served by new version; old version remains healthy.
Action: rollback to v1.23.4 in progress.
Next update: after rollout status completes.
```

### 24.3 Completion Update Template

```text
[10:45] Deployment completed for case-service v1.24.0.
Verification passed:
- readiness/liveness OK
- smoke test passed
- 5xx within baseline
- DB pool normal
- queue depth normal
Monitoring will continue until 11:15.
```

---

## 25. Section 20 — Escalation Matrix

Escalation should be explicit.

| Condition | Escalate To | Time |
|---|---|---|
| DB migration lock > expected duration | DBA | immediately |
| P1 user impact | Incident Commander | immediately |
| Security secret/cert issue | Security/Infra | immediately |
| rollback failed | App Owner + Infra | immediately |
| unknown production degradation > 10 min | Incident Manager | 10 min |
| dependency outage | Dependency owner | immediately |
| data corruption suspected | Product owner + DBA + incident lead | immediately |

A runbook without escalation is not production-ready.

---

## 26. Section 21 — Completion Criteria

Deployment is complete only when criteria pass.

Example:

```markdown
## Completion Criteria

Deployment can be marked complete only if:

- desired version is running on all intended instances;
- old version is no longer receiving traffic unless canary/ring strategy says otherwise;
- readiness/liveness stable;
- smoke test passed;
- synthetic business transaction passed;
- metrics within threshold;
- no new critical log signature;
- DB migration completed and recorded;
- queue depth stable;
- rollback artifact remains available;
- evidence attached to CR;
- stakeholders notified.
```

Avoid:

```text
rollout status completed = deployment successful
```

That only means Kubernetes reached desired replica state.

It does not prove business health.

---

## 27. Section 22 — Audit Evidence

For enterprise/regulatory systems, runbook should produce audit trail.

Evidence package:

```text
- approved CR;
- release note;
- artifact metadata;
- image digest/signature;
- SBOM/scanning result;
- pre-check screenshot/output;
- migration output;
- deployment command/output;
- post-check output;
- smoke test result;
- monitoring dashboard snapshot;
- incident/rollback notes if any;
- final approval/closure.
```

Do not rely on screenshots only. Prefer machine-readable outputs when possible.

Example:

```bash
kubectl -n case-prod rollout history deploy/case-service > evidence-rollout-history.txt
kubectl -n case-prod get pods -l app=case-service -o wide > evidence-pods-after.txt
curl -fsS https://case.example.com/actuator/info > evidence-actuator-info.json
curl -fsS https://case.example.com/actuator/health/readiness > evidence-readiness.json
```

---

## 28. Different Runbook Types for Java Deployment

### 28.1 Standard Deployment Runbook

Used for normal release.

Includes:

1. pre-check;
2. deploy;
3. verify;
4. monitor;
5. close.

### 28.2 Rollback Runbook

Must be separately executable.

Why?

During incident, people should not scroll through 30 pages to find rollback.

Rollback runbook should start with:

```text
Use this runbook when:
- new deployment causes user-impacting error;
- readiness/liveness fails;
- new version cannot be stabilized;
- decision owner approves rollback.
```

### 28.3 Hotfix Runbook

For urgent production fix.

Must include:

1. abbreviated approval path;
2. evidence requirements;
3. reduced but sufficient testing;
4. rollback plan;
5. post-hotfix retrospective.

### 28.4 Restart Runbook

For operational restart.

Must cover:

1. evidence capture;
2. traffic drain;
3. restart;
4. verification;
5. escalation if restart fails.

### 28.5 Certificate Rotation Runbook

Must cover:

1. current cert expiry;
2. new cert deployment;
3. trust chain verification;
4. dual-validity;
5. restart/reload;
6. TLS verification;
7. rollback to previous cert if possible.

### 28.6 Database Migration Runbook

Must cover:

1. lock risk;
2. backup;
3. migration order;
4. validation;
5. app compatibility;
6. rollback/roll-forward.

### 28.7 Incident Diagnostic Runbook

Must cover:

1. what to capture;
2. in what order;
3. what not to restart yet;
4. safe diagnostic commands;
5. escalation path.

---

## 29. Java-Specific Runbook Concerns

### 29.1 Java Version Drift

Runbook should catch:

```text
build target = Java 21
runtime = Java 17
```

Failure examples:

```text
UnsupportedClassVersionError
NoSuchMethodError due different library/runtime
TLS behavior changes
illegal reflective access errors
GC flag invalid
```

Verification:

```bash
java -version
```

or `/actuator/info`.

### 29.2 JVM Flag Compatibility

Java 8 flags may fail on Java 17/21/25.

Example issues:

```text
- removed GC flags;
- CMS removed;
- PermGen flags invalid;
- illegal access defaults changed;
- module opens needed;
- container flags changed;
- unified logging syntax changed.
```

Runbook should list approved JVM flags per Java baseline.

### 29.3 Memory Boundary

Runbook should verify:

```text
container limit > heap + metaspace + direct memory + thread stacks + code cache + native overhead
```

Bad pattern:

```text
container memory = 1024Mi
-Xmx = 1024m
```

This invites OOMKilled.

### 29.4 Diagnostics Availability

Distroless/minimal images may not include:

1. shell;
2. `jcmd`;
3. `jstack`;
4. `jmap`;
5. `curl`;
6. `ps`;
7. CA tools.

Runbook must state how to debug:

```text
- use ephemeral container;
- use sidecar diagnostics;
- use JFR pre-enabled;
- expose safe Actuator endpoints;
- produce heap dump to writable volume;
- use kubectl debug if allowed.
```

### 29.5 Classpath / Module Failure

Runbook should include expected symptoms:

| Symptom | Likely Area |
|---|---|
| `ClassNotFoundException` | dependency missing |
| `NoClassDefFoundError` | class existed at compile but absent at runtime |
| `NoSuchMethodError` | version mismatch |
| `IllegalAccessError` | module/access conflict |
| `UnsupportedClassVersionError` | runtime too old |
| `ServiceConfigurationError` | SPI/provider mismatch |
| `LinkageError` | classloader conflict |

---

## 30. Kubernetes-Specific Runbook Concerns

### 30.1 Namespace Safety

Every command should require namespace.

Bad:

```bash
kubectl get pods
```

Better:

```bash
kubectl -n case-prod get pods
```

Even better:

```bash
export NS=case-prod
kubectl -n "$NS" get pods
```

### 30.2 Context Safety

Before production action:

```bash
kubectl config current-context
kubectl cluster-info
```

Runbook should require operator to paste:

```text
Current context:
Namespace:
Deployment:
Image:
```

### 30.3 Revision History

Before deployment:

```bash
kubectl -n "$NS" rollout history deploy/case-service
```

After deployment:

```bash
kubectl -n "$NS" rollout history deploy/case-service
```

### 30.4 Events Are First-Class Evidence

Kubernetes events often reveal:

1. failed scheduling;
2. image pull error;
3. probe failure;
4. OOMKilled;
5. backoff;
6. failed mount;
7. insufficient CPU/memory;
8. secret/config missing.

Command:

```bash
kubectl -n "$NS" get events --sort-by=.metadata.creationTimestamp
```

### 30.5 Pod Restart Reason

```bash
kubectl -n "$NS" describe pod <pod>
```

Look for:

```text
Last State:
  Terminated:
    Reason: OOMKilled
    Exit Code: 137
```

---

## 31. App Server / Servlet Container Runbook Concerns

For Tomcat/WildFly/WebLogic/WebSphere/Open Liberty/Payara deployments, runbook should include:

1. artifact type: WAR/EAR/exploded;
2. deployment target;
3. server/domain/profile;
4. datasource/JNDI mapping;
5. shared library version;
6. classloader policy;
7. session persistence;
8. cluster node order;
9. admin CLI command;
10. rollback artifact;
11. server restart requirement;
12. log path;
13. thread dump method;
14. heap dump method.

Example Tomcat concerns:

```text
- remove old exploded WAR if needed;
- avoid partial copy into webapps;
- check catalina.out/application logs;
- confirm context path;
- confirm old session behavior;
- confirm connector draining if behind LB.
```

Example WildFly concerns:

```text
- standalone vs domain mode;
- deployment content repository;
- enable/disable deployment;
- datasource test connection;
- server group rollout plan;
- CLI history/evidence.
```

---

## 32. Runbook as Decision Tree

Good runbooks contain decision trees.

Example: startup failure.

```text
Application does not become ready within 5 minutes
|
+-- Pod status Pending?
|     |
|     +-- check scheduling/resources/PVC/image pull
|
+-- Pod status ImagePullBackOff?
|     |
|     +-- check image tag, registry auth, digest
|
+-- Pod status CrashLoopBackOff?
|     |
|     +-- check previous logs
|     +-- check Java exception
|
+-- Pod running but readiness failing?
      |
      +-- check /health/readiness detail
      +-- check DB/cache/dependency
      +-- check startup time vs probe timeout
```

Example: elevated 5xx after deployment.

```text
5xx increased after rollout
|
+-- only new pods?
|     |
|     +-- rollback/canary pause
|
+-- all pods including old?
|     |
|     +-- check dependency or shared config
|
+-- only specific endpoint?
|     |
|     +-- disable feature flag or route
|
+-- correlated with DB errors?
      |
      +-- check pool/locks/migration
```

Example: memory issue.

```text
Pod restarted
|
+-- Reason OOMKilled?
|     |
|     +-- container memory exceeded
|     +-- check RSS, heap, native/direct/thread
|
+-- Java OutOfMemoryError?
|     |
|     +-- JVM heap/metaspace/direct OOME
|     +-- capture heap dump if configured
|
+-- CPU throttling?
      |
      +-- check limits/request and p95 latency
```

---

## 33. Anti-Patterns in Deployment Runbooks

### 33.1 “Check Logs” Without Log Query

Bad:

```text
Check logs.
```

Better:

```bash
kubectl -n case-prod logs deploy/case-service --since=15m | grep -E "ERROR|Exception|Failed|Timeout"
```

Better still:

```text
Check centralized log dashboard:
query = service="case-service" AND level>=ERROR AND timestamp >= deployment_start
Compare error signatures with baseline.
```

### 33.2 “Rollback If Needed”

Bad:

```text
Rollback if needed.
```

Better:

```text
Rollback if any of the following occurs:
- readiness failure for all new pods for > 5 minutes;
- 5xx rate > 1% for 5 minutes;
- business smoke fails twice;
- DB migration causes blocking lock > 2 minutes;
- security/auth flow broken for test user;
- incident decision owner approves rollback.
```

### 33.3 No Evidence Capture Before Restart

Bad:

```text
Restart service when stuck.
```

Better:

```text
Before restart:
- capture logs;
- capture thread dump;
- capture heap/native memory info if memory-related;
- capture pod describe/events;
- note timestamp and symptom.
```

### 33.4 Environment-Specific Tribal Knowledge

Bad:

```text
Deploy as usual in UAT.
```

Better:

```text
UAT uses namespace `case-uat`, DB service `oracle-uat-svc`, and config profile `uat`.
Unlike PROD, UAT has single replica and no HPA.
Readiness thresholds differ.
```

### 33.5 Copy-Paste Command Without Variables

Bad:

```bash
kubectl -n prod delete pod payment-abc123
```

Better:

```bash
export NS=<target-namespace>
export APP=<target-app>
kubectl -n "$NS" get pods -l app="$APP"
```

### 33.6 Unsafe Actuator Exposure

Bad:

```text
Use /actuator/shutdown to restart app.
```

This can be dangerous if exposed broadly.

Better:

```text
Do not expose shutdown endpoint publicly.
Use platform-controlled restart:
- Kubernetes rollout restart; or
- systemd restart with approval.
```

### 33.7 Assuming Kubernetes Success Means Business Success

Bad:

```text
rollout status success; deployment complete.
```

Better:

```text
rollout status success → readiness stable → smoke test → synthetic business test → metrics/logs baseline → monitoring window complete.
```

---

## 34. Example Complete Runbook Skeleton

```markdown
# Deployment Runbook — <Service> <Version>

## 1. Metadata
- System:
- Service:
- Environment:
- Release ID:
- CR:
- Git Commit:
- Artifact/Image:
- Java Version:
- Runtime Vendor:
- Deployment Window:
- Operator:
- Verifier:
- Decision Owner:

## 2. Scope
### In Scope
-
### Out of Scope
-

## 3. Change Summary
### Functional
-
### Technical
-
### Operational Impact
-
### Compatibility
-

## 4. Risk Classification
- Risk Level:
- Reason:
- Rollback Complexity:
- Data Impact:
- User Impact:

## 5. Preconditions
### Approval
-
### Artifact
-
### Runtime
-
### Environment
-
### Database
-
### Monitoring
-

## 6. Dependency Map
| Dependency | Required? | Verification | Degraded Behavior |
|---|---:|---|---|

## 7. Deployment Plan
### Step 1 — Pre-check
```bash
...
```

### Step 2 — Deploy
```bash
...
```

### Step 3 — Monitor Rollout
```bash
...
```

## 8. Verification Plan
### Health
-
### Smoke
-
### Synthetic
-
### Metrics
-
### Logs
-

## 9. Rollback Plan
### Rollback Criteria
-
### Rollback Command
```bash
...
```
### Rollback Verification
-

## 10. Diagnostic Capture
### Before Restart/Rollback
```bash
...
```

## 11. Communication
### Start Message
-
### Progress Message
-
### Rollback Message
-
### Completion Message
-

## 12. Escalation
| Condition | Owner | SLA |
|---|---|---|

## 13. Completion Criteria
-

## 14. Evidence
- Pre-check output:
- Deployment output:
- Post-check output:
- Dashboard snapshot:
- Smoke result:
- CR closure note:
```

---

## 35. Example Kubernetes Java Deployment Runbook

Below is a condensed but realistic example.

```markdown
# Deployment Runbook — case-service v1.24.0

## Metadata

| Field | Value |
|---|---|
| Environment | PROD |
| Namespace | case-prod |
| Deployment | case-service |
| Image | registry.example.com/case-service:1.24.0-20260618-a1b2c3d |
| Digest | sha256:... |
| Java | 21.0.x |
| Strategy | RollingUpdate |
| CR | CRQ-123456 |

## Preconditions

- CR approved.
- Image digest verified.
- Previous version `1.23.4` available.
- Current pods healthy.
- DB migration V20260618_01 verified in UAT.
- Monitoring dashboard accessible.
- Rollback owner available.

## Pre-check Commands

```bash
export NS=case-prod
export APP=case-service

kubectl config current-context
kubectl -n "$NS" get deploy "$APP" -o wide
kubectl -n "$NS" rollout history deploy/"$APP"
kubectl -n "$NS" get pods -l app="$APP" -o wide
kubectl -n "$NS" get endpoints "$APP"
kubectl -n "$NS" get events --sort-by=.metadata.creationTimestamp | tail -50
```

## Deploy

```bash
kubectl -n "$NS" set image deploy/"$APP" \
  "$APP"=registry.example.com/case-service:1.24.0-20260618-a1b2c3d

kubectl -n "$NS" rollout status deploy/"$APP" --timeout=10m
```

## Verify

```bash
kubectl -n "$NS" get pods -l app="$APP" -o wide
kubectl -n "$NS" logs deploy/"$APP" --since=10m
curl -fsS https://case.example.com/actuator/health/readiness
curl -fsS https://case.example.com/actuator/info
```

## Smoke Test

- Login as smoke user.
- Search case `SMOKE-CASE-001`.
- Open case details.
- Add internal note in smoke-only record.
- Verify audit trail entry.

## Metrics Gate

Deployment passes if for 30 minutes:
- 5xx < 0.5%;
- p95 latency < baseline + 20%;
- no CrashLoopBackOff;
- DB pool active < 80%;
- queue depth stable;
- no new critical error signature.

## Rollback Criteria

Rollback if:
- rollout fails;
- all new pods fail readiness;
- smoke test fails twice;
- 5xx > 1% for 5 minutes;
- auth/login broken;
- DB pool saturation caused by new version;
- decision owner requests rollback.

## Rollback

```bash
kubectl -n "$NS" rollout undo deploy/"$APP"
kubectl -n "$NS" rollout status deploy/"$APP" --timeout=10m
```

## Rollback Verification

```bash
curl -fsS https://case.example.com/actuator/health/readiness
curl -fsS https://case.example.com/actuator/info
kubectl -n "$NS" logs deploy/"$APP" --since=10m
```

## Diagnostic Capture Before Rollback

```bash
kubectl -n "$NS" get deploy,rs,pod,svc,endpoints -o wide
kubectl -n "$NS" describe deploy "$APP"
kubectl -n "$NS" get events --sort-by=.metadata.creationTimestamp
kubectl -n "$NS" logs deploy/"$APP" --since=30m
```

## Completion

Attach:
- rollout history;
- actuator info;
- readiness result;
- smoke result;
- dashboard snapshot;
- final status message.
```

---

## 36. Example systemd Java Deployment Runbook

```markdown
# Deployment Runbook — report-service v2.8.0 on VM

## Metadata

| Field | Value |
|---|---|
| Host | report-prod-01 |
| User | report |
| Service | report-service |
| Current Version | 2.7.5 |
| Target Version | 2.8.0 |
| Java | 17.0.x |
| Artifact | report-service-2.8.0.jar |
| Install Path | /opt/report-service |
| Rollback Version | 2.7.5 |

## Pre-check

```bash
hostname
whoami
java -version
sudo systemctl status report-service --no-pager
curl -fsS http://localhost:8080/actuator/health/readiness
journalctl -u report-service --since "30 minutes ago" --no-pager | tail -100
```

## Install Artifact

```bash
sudo mkdir -p /opt/report-service/releases/2.8.0

sudo install -o report -g report -m 0644 \
  report-service-2.8.0.jar \
  /opt/report-service/releases/2.8.0/report-service.jar

sha256sum /opt/report-service/releases/2.8.0/report-service.jar
```

## Switch Release

```bash
sudo ln -sfn /opt/report-service/releases/2.8.0 /opt/report-service/current
sudo systemctl restart report-service
```

## Verify

```bash
sudo systemctl status report-service --no-pager
curl -fsS http://localhost:8080/actuator/health/readiness
curl -fsS http://localhost:8080/actuator/info
journalctl -u report-service --since "10 minutes ago" --no-pager
```

## Rollback

```bash
sudo ln -sfn /opt/report-service/releases/2.7.5 /opt/report-service/current
sudo systemctl restart report-service
sudo systemctl status report-service --no-pager
curl -fsS http://localhost:8080/actuator/health/readiness
```
```

---

## 37. Runbook Quality Rubric

A runbook is mature if it passes these checks.

### 37.1 Clarity

- Can someone outside the original author execute it?
- Are environment names explicit?
- Are commands copy-paste safe?
- Are variables clearly defined?
- Are destructive actions marked?

### 37.2 Safety

- Are stop conditions present?
- Are rollback criteria explicit?
- Is diagnostic capture before restart/rollback?
- Is namespace/context validation required?
- Are secrets protected?

### 37.3 Completeness

- Are preconditions covered?
- Are dependencies covered?
- Are deployment steps complete?
- Are verification steps layered?
- Is monitoring window defined?
- Is escalation defined?

### 37.4 Auditability

- Does it record artifact/version?
- Does it record operator/timestamp?
- Does it produce evidence?
- Does it link to CR/release note?
- Does it capture final result?

### 37.5 Maintainability

- Is it version-controlled?
- Is owner clear?
- Is last tested date clear?
- Are assumptions explicit?
- Are environment differences documented?

---

## 38. Runbook Testing

A runbook that has never been tested is a hypothesis.

Test runbook in:

1. DEV;
2. SIT;
3. UAT;
4. staging;
5. game day / rehearsal;
6. controlled maintenance.

Testing should verify:

1. commands still work;
2. permissions are sufficient;
3. dashboards still exist;
4. endpoints still correct;
5. rollback still possible;
6. evidence path still valid;
7. escalation contacts still accurate;
8. timings are realistic.

A stale runbook is dangerous because it creates false confidence.

---

## 39. Runbook Versioning

Runbook should live with code or platform repository.

Recommended:

```text
repo/
  runbooks/
    deployment/
      case-service-prod.md
      case-service-uat.md
    rollback/
      case-service-rollback.md
    diagnostics/
      java-thread-dump.md
      java-oom.md
    rotations/
      truststore-rotation.md
```

Each runbook should have:

```markdown
| Field | Value |
|---|---|
| Owner | Team ABC |
| Last Updated | 2026-06-18 |
| Last Tested | 2026-06-10 |
| Applies To | Java 21 Spring Boot service on Kubernetes |
| Review Cycle | quarterly or after major incident |
```

Runbook changes should go through review.

Why?

Because a runbook is operational code.

Bad runbook change can cause production incident.

---

## 40. Runbook and Automation

Runbook can be manual, semi-automated, or fully automated.

### 40.1 Manual Runbook

Good for:

1. rare operation;
2. high-risk change;
3. human approval needed;
4. ambiguous decision;
5. early maturity.

### 40.2 Semi-Automated Runbook

Example:

```bash
./deploy.sh --env prod --service case-service --version 1.24.0
./verify.sh --env prod --service case-service
./rollback.sh --env prod --service case-service
```

Runbook still explains:

1. when to run;
2. what script does;
3. expected output;
4. failure handling.

### 40.3 Fully Automated Runbook

Examples:

1. CI/CD pipeline gates;
2. Argo Rollouts analysis;
3. automated canary rollback;
4. synthetic checks;
5. alert-triggered remediation.

Even then, runbook remains necessary because automation itself can fail.

Runbook becomes:

```text
- how automation works;
- how to verify automation result;
- how to override safely;
- how to recover automation failure.
```

---

## 41. Top 1% Perspective: Runbook as Socio-Technical Design

A deployment runbook is not merely technical documentation.

It coordinates:

1. human roles;
2. system state;
3. irreversible operations;
4. evidence;
5. timing;
6. communication;
7. decision-making under uncertainty.

A weak engineer writes commands.

A strong engineer writes steps.

A senior engineer writes steps plus rollback.

A top-tier engineer writes:

1. invariants;
2. preconditions;
3. decision boundaries;
4. failure branches;
5. evidence capture;
6. escalation;
7. communication;
8. audit trail;
9. learning loop.

The goal is not to make deployment “look controlled”.

The goal is to make it **actually controllable**.

---

## 42. Practical Runbook Invariants

Use these invariants in every Java deployment runbook.

### Invariant 1 — Identity Must Be Known

At all times, know:

```text
what version is running where
```

### Invariant 2 — Traffic Must Only Reach Ready Instances

Readiness must reflect real ability to serve traffic.

### Invariant 3 — Rollback Must Be Available Before Deployment

Do not deploy first and invent rollback later.

### Invariant 4 — Evidence Must Be Captured Before Destructive Actions

Restart, rollback, delete, redeploy can destroy forensic data.

### Invariant 5 — Config Is Part of Release

Artifact without config is not the deployed system.

### Invariant 6 — DB State May Outlive App Version

Database changes must be compatible across versions.

### Invariant 7 — Stateful Workloads Need Drain Semantics

HTTP, queue, scheduler, and batch each need different shutdown behavior.

### Invariant 8 — Health Check Is Not Business Correctness

Readiness is necessary but not sufficient.

### Invariant 9 — Every Emergency Path Must Have Owner

Ambiguous ownership increases outage duration.

### Invariant 10 — Runbook Must Be Tested

Untested runbook is operational fiction.

---

## 43. Final Checklist for This Part

Before using a Java deployment runbook in production, ask:

```text
[ ] Is the target environment explicit?
[ ] Is the artifact version immutable?
[ ] Is the Java runtime version explicit?
[ ] Are JVM flags documented?
[ ] Are config and secrets versioned?
[ ] Are DB migrations classified?
[ ] Are pre-check commands listed?
[ ] Are deployment commands listed?
[ ] Are verification commands listed?
[ ] Are smoke/synthetic checks defined?
[ ] Are rollback criteria explicit?
[ ] Are rollback commands tested?
[ ] Are diagnostics captured before restart/rollback?
[ ] Are communication templates included?
[ ] Are escalation owners listed?
[ ] Are completion criteria measurable?
[ ] Is evidence required for closure?
[ ] Was the runbook tested recently?
```

If many answers are “no”, the deployment is not truly production-ready.

---

## 44. Summary

Runbook engineering is where Java deployment knowledge becomes operational capability.

A good runbook:

1. reduces uncertainty;
2. prevents dangerous improvisation;
3. preserves evidence;
4. accelerates recovery;
5. supports audit;
6. enables delegation;
7. improves team maturity;
8. makes rollback/roll-forward explicit;
9. turns deployment into a controlled state transition.

The central mental model:

> A deployment runbook is not a document of commands.  
> It is a controlled state machine for changing a production system safely.

---

## 45. References

- Google SRE Book — Managing Incidents: https://sre.google/sre-book/managing-incidents/
- Google SRE Book — Table of Contents / Emergency Response / Postmortem Culture: https://sre.google/sre-book/table-of-contents/
- Kubernetes Documentation — Debug Running Pods: https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/
- Kubernetes Documentation — Debug Services: https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/
- Spring Boot Documentation — Actuator Endpoints: https://docs.spring.io/spring-boot/reference/actuator/endpoints.html
- Spring Boot Documentation — Shutdown Actuator Endpoint: https://docs.spring.io/spring-boot/api/rest/actuator/shutdown.html
- Oracle Java 25 Documentation — `jdk.jcmd` module and diagnostic tools: https://docs.oracle.com/en/java/javase/25/docs/api/jdk.jcmd/module-summary.html
- Oracle Java Troubleshooting Guide — Diagnostic Tools / Flight Recorder: https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html
