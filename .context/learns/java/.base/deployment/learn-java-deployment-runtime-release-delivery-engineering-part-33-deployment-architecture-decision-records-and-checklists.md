# learn-java-deployment-runtime-release-delivery-engineering — Part 33
# Deployment Architecture Decision Records and Checklists

> **Series:** `learn-java-deployment-runtime-release-delivery-engineering`  
> **Part:** 33 of 35  
> **Topic:** Deployment Architecture Decision Records and Checklists  
> **Scope:** Java 8–25, deployment architecture, ADR, checklists, decision governance, runtime choice, artifact choice, rollout strategy, config/secrets, observability, rollback, database migration, Kubernetes, app server, enterprise deployment  
> **Goal:** Membuat keputusan deployment Java menjadi eksplisit, traceable, reviewable, dan reusable melalui ADR dan checklist yang benar-benar berguna, bukan dokumentasi formalitas.

---

## 0. Posisi Part Ini Dalam Series

Part sebelumnya membahas enterprise governance: Change Request, approval, auditability, compliance, evidence, dan defensibility.

Part ini masuk ke artefak desain yang lebih teknis:

> **Bagaimana kita mendokumentasikan keputusan deployment agar tim tidak kehilangan konteks, tidak mengulang debat yang sama, dan tidak membuat keputusan berbahaya tanpa sadar?**

Deployment Java berisi banyak keputusan arsitektural:

1. memakai JAR atau WAR?
2. memakai Java 8, 17, 21, atau 25?
3. memakai Temurin, Corretto, Oracle JDK, Azul, atau vendor lain?
4. memakai fat JAR, layered JAR, jlink runtime, atau app server?
5. deploy di VM/systemd, container, Kubernetes, atau hybrid?
6. rolling, blue-green, canary, atau shadow?
7. config lewat env var, file, config server, Parameter Store, Vault, atau Kubernetes Secret?
8. health check memakai endpoint apa?
9. rollback app-only atau app+config+DB?
10. apakah DB migration backward-compatible?
11. observability minimum apa yang wajib?
12. siapa yang boleh deploy dan bagaimana evidence-nya?

Jika keputusan-keputusan ini hanya hidup di kepala senior engineer, maka sistem bergantung pada memori manusia.

ADR dan checklist adalah cara membuat keputusan tersebut menjadi:

1. eksplisit;
2. mudah direview;
3. mudah diaudit;
4. mudah diwariskan;
5. bisa dipakai ulang;
6. bisa dievaluasi ulang ketika konteks berubah.

---

## 1. Apa Itu ADR?

**ADR** berarti **Architecture Decision Record**.

Secara praktis:

> ADR adalah catatan ringkas tentang keputusan arsitektural penting, konteks yang melatarbelakanginya, opsi yang dipertimbangkan, keputusan yang diambil, dan konsekuensinya.

ADR bukan dokumen desain besar.

ADR adalah “rekam jejak keputusan”.

Template ADR populer dari Michael Nygard biasanya memakai struktur seperti:

```text
Title
Status
Context
Decision
Consequences
```

Thoughtworks juga mempopulerkan lightweight ADR sebagai teknik untuk mencatat keputusan arsitektur penting beserta konteks dan konsekuensinya.

Dalam deployment Java, ADR berguna karena deployment decision sering lebih berdampak daripada perubahan code biasa.

Contoh keputusan yang layak ADR:

```text
Use Java 21 as production runtime baseline for new backend services.
Use Spring Boot layered JAR for container image layering.
Use Kubernetes rolling update with readiness gate for standard services.
Use blue-green deployment for monolith with high rollback risk.
Use app-only rollback for additive database migrations.
Use truststore reload by restart, not live reload, for services X/Y.
Use OpenTelemetry Java Agent for standard service telemetry.
Use immutable image digest in production manifests.
```

---

## 2. ADR vs Runbook vs CR vs Design Document

Banyak tim bingung: “Bukannya CR/runbook sudah cukup?”

Tidak.

Setiap artefak menjawab pertanyaan berbeda.

| Artefak | Pertanyaan Utama | Lifespan |
|---|---|---|
| ADR | Mengapa keputusan ini diambil? | long-lived |
| Runbook | Bagaimana menjalankan operasi ini? | operational / maintained |
| CR | Perubahan spesifik apa yang akan dilakukan sekarang? | per change |
| Design Doc | Bagaimana solusi bekerja secara menyeluruh? | project/system |
| Checklist | Apakah hal penting sudah diperiksa? | reusable |
| RCA | Mengapa incident terjadi dan apa pembelajaran? | after incident |

Contoh:

### ADR

```text
We will deploy case-service as containerized Spring Boot layered JAR on Kubernetes.
```

### Runbook

```text
How to deploy case-service v1.24.0 to production namespace.
```

### CR

```text
Deploy case-service v1.24.0 on 2026-06-18 with DB migration V20260618_01.
```

### Checklist

```text
Before deploying Java service to Kubernetes, verify resource limits, probes, config, secrets, rollback, smoke test.
```

ADR berisi **why**.

Runbook berisi **how**.

CR berisi **what/when/who**.

Checklist berisi **did we remember the critical things?**

---

## 3. Mengapa Deployment Perlu ADR?

Deployment sering dianggap “implementation detail”. Ini salah.

Deployment menentukan:

1. failure mode;
2. rollback ability;
3. startup behavior;
4. observability;
5. security posture;
6. resource consumption;
7. operational burden;
8. upgrade path;
9. compliance evidence;
10. team ownership model.

Contoh:

```text
Decision: deploy as fat JAR on VM with systemd.
```

Konsekuensi:

1. simpler than Kubernetes for small system;
2. rollback can use symlink;
3. resource isolation weaker than container;
4. scaling more manual;
5. OS patching matters;
6. deployment evidence must be collected from VM;
7. systemd unit becomes part of runtime contract.

Contoh lain:

```text
Decision: deploy as Spring Boot container on Kubernetes.
```

Konsekuensi:

1. need image governance;
2. need probes;
3. need resource requests/limits;
4. need graceful shutdown;
5. need config/secret mounting;
6. need rollout strategy;
7. need cluster capacity;
8. need container diagnostics strategy.

Tanpa ADR, orang hanya melihat hasil akhirnya dan lupa trade-off awal.

---

## 4. Kapan Perlu ADR?

Tidak semua keputusan butuh ADR.

Gunakan ADR jika keputusan:

1. sulit diubah;
2. berdampak ke banyak service;
3. berisiko production;
4. memengaruhi security/compliance;
5. memengaruhi rollback;
6. memengaruhi database/data;
7. akan menjadi standar tim;
8. memiliki trade-off tidak obvious;
9. pernah diperdebatkan berulang;
10. perlu dijelaskan ke auditor/stakeholder;
11. menjadi dependency keputusan lain.

### 4.1 Keputusan yang Biasanya Perlu ADR

| Domain | Contoh |
|---|---|
| Runtime | Java 21 baseline untuk service baru |
| Artifact | layered JAR vs WAR |
| Container | distroless vs Temurin JRE image |
| Platform | Kubernetes vs VM/systemd |
| Rollout | canary untuk external-facing API |
| Database | expand-contract migration |
| Secrets | Vault vs Kubernetes Secret vs cloud secret manager |
| Observability | OpenTelemetry Java Agent standard |
| Security | non-root/read-only filesystem baseline |
| Governance | production deploy by GitOps only |
| Diagnostics | enable JFR on demand |

### 4.2 Keputusan yang Tidak Perlu ADR

Biasanya tidak perlu ADR untuk:

1. typo config kecil;
2. patch version update dengan no behavior change;
3. one-off script di DEV;
4. temporary workaround yang tidak masuk production;
5. implementation detail lokal yang mudah diubah.

Namun hati-hati:

“kecil” bukan berarti low-risk.

Perubahan satu line authorization predicate bisa butuh ADR atau minimal design note jika dampaknya besar.

---

## 5. Status ADR

ADR harus punya status.

Umum:

```text
Proposed
Accepted
Rejected
Deprecated
Superseded
Amended
```

### 5.1 Proposed

Keputusan sedang diusulkan.

```text
Status: Proposed
```

Dipakai untuk review.

### 5.2 Accepted

Keputusan berlaku.

```text
Status: Accepted
```

Tim harus mengikuti kecuali ada ADR baru yang menggantikan.

### 5.3 Rejected

Opsi dipertimbangkan tetapi tidak dipilih.

ADR rejected tetap berguna karena menjelaskan mengapa opsi tidak dipakai.

### 5.4 Deprecated

Keputusan masih ada dalam sistem lama, tetapi tidak disarankan untuk penggunaan baru.

Contoh:

```text
Status: Deprecated
Decision: Deploy Java services directly to VM using manual SCP.
Reason: Replaced by CI/CD + GitOps for new services.
```

### 5.5 Superseded

Keputusan diganti oleh ADR lain.

```text
Status: Superseded by ADR-0042
```

ADR lama jangan dihapus. Simpan sejarah.

---

## 6. Struktur ADR untuk Deployment Java

Template umum:

```markdown
# ADR-XXXX: <Title>

## Status
Proposed / Accepted / Rejected / Deprecated / Superseded

## Date
YYYY-MM-DD

## Context
What problem, constraint, risk, or change motivated this decision?

## Decision
What decision are we making?

## Options Considered
1. Option A
2. Option B
3. Option C

## Decision Drivers
- security
- operability
- rollback
- performance
- compatibility
- compliance
- team skill
- cost
- supportability

## Consequences
### Positive
-
### Negative
-
### Neutral / Trade-off
-

## Operational Impact
- deployment:
- monitoring:
- rollback:
- support:
- runbook:

## Security and Compliance Impact
-

## Migration Plan
-

## Validation
How will we know this decision works?

## Related Artifacts
- Runbook:
- CR:
- Design doc:
- Dashboard:
- Pipeline:
- Previous ADR:
```

Untuk deployment, saya sarankan menambahkan bagian:

1. **Operational Impact**
2. **Rollback Impact**
3. **Observability Impact**
4. **Security/Compliance Impact**
5. **Migration/Transition Plan**

Karena deployment decision tanpa operational consequence biasanya tidak cukup.

---

## 7. Deployment ADR Quality Bar

ADR yang baik harus:

1. ringkas tetapi cukup konteks;
2. menyebut opsi yang ditolak;
3. menjelaskan trade-off, bukan hanya keputusan;
4. menyebut konsekuensi negatif;
5. bisa dipahami engineer baru;
6. punya link ke runbook/pipeline/config;
7. punya status;
8. tidak menjadi sales pitch;
9. tidak pura-pura semua keputusan positif;
10. dapat direvisi saat konteks berubah.

ADR buruk:

```text
We use Kubernetes because it is industry standard.
```

ADR baik:

```text
We use Kubernetes for stateless Java services that require horizontal scaling, rolling deployments, and standardized observability. We will not migrate legacy WAR-on-WebLogic services immediately because their session model, JNDI dependencies, and operational certification require a separate migration path.
```

---

## 8. Decision Drivers untuk Java Deployment

Saat menulis ADR deployment, gunakan decision drivers.

### 8.1 Operability

Pertanyaan:

```text
Can the team deploy, verify, debug, restart, and rollback this safely?
```

### 8.2 Compatibility

```text
Does this work across Java 8–25, framework versions, app server, OS, container, and dependencies?
```

### 8.3 Rollback Safety

```text
Can we revert without data loss or prolonged outage?
```

### 8.4 Observability

```text
Can we prove the system is healthy after deployment?
```

### 8.5 Security

```text
Does it reduce or increase attack surface?
```

### 8.6 Compliance

```text
Can we produce evidence for audit/change review?
```

### 8.7 Performance

```text
Does it affect startup, memory, throughput, latency, GC, CPU throttling?
```

### 8.8 Cost

```text
Does it increase infrastructure, support, license, or cognitive cost?
```

### 8.9 Team Capability

```text
Can the team operate this without one specialist?
```

### 8.10 Vendor/Platform Risk

```text
Does this lock us into a vendor or unsupported runtime?
```

---

## 9. ADR Example 1 — Java Runtime Baseline

```markdown
# ADR-0001: Use Java 21 as Baseline Runtime for New Backend Services

## Status
Accepted

## Date
2026-06-18

## Context
Existing services run on mixed Java versions: 8, 11, 17, and 21. New backend services require long-term support, container awareness, modern GC defaults, virtual threads availability, and compatibility with current Spring Boot/Jakarta ecosystem.

Java 8 services remain supported for legacy systems but should not be the default for new services.

## Decision
New backend services will use Java 21 as the default production runtime baseline.

Java 8 may only be used for legacy compatibility.
Java 17 may be used for services constrained by library/vendor certification.
Java 25 may be evaluated for non-critical services first before production baseline adoption.

## Options Considered

### Option A — Java 8
Pros:
- broad legacy compatibility;
- existing team familiarity.

Cons:
- old baseline;
- weaker modern container/cloud-native ergonomics;
- many modern frameworks have moved forward;
- technical debt for new services.

### Option B — Java 17
Pros:
- mature LTS;
- strong ecosystem support;
- lower migration risk than Java 21.

Cons:
- misses Java 21 virtual threads as final feature;
- may become transitional baseline.

### Option C — Java 21
Pros:
- current modern LTS baseline;
- virtual threads finalized;
- strong Spring Boot/Jakarta alignment;
- good container support.

Cons:
- requires dependency compatibility verification;
- requires JVM flag cleanup for older services.

### Option D — Java 25
Pros:
- newest platform;
- useful for forward-looking services.

Cons:
- not yet internal standard;
- needs operational certification and support matrix.

## Decision Drivers
- supportability;
- ecosystem compatibility;
- production stability;
- cloud-native deployment;
- team skill;
- upgrade path.

## Consequences

### Positive
- consistent baseline for new services;
- better modern framework compatibility;
- easier standardization of Docker images and JVM flags;
- access to virtual threads when appropriate.

### Negative
- legacy Java 8 services still need separate maintenance;
- migration requires dependency and test effort;
- monitoring agents and app server compatibility must be verified.

## Operational Impact
- Standard base images must include Java 21.
- CI/CD pipelines must validate target bytecode.
- Runtime metadata must expose Java version.
- JVM flags must be reviewed for Java 21 compatibility.

## Rollback Impact
Rollback to Java 17/8 is not assumed safe unless artifact is compiled and tested for that target.

## Validation
- deploy representative service in UAT;
- validate startup, TLS, memory, GC logs, observability agent;
- run performance baseline;
- verify rollback path.

## Related Artifacts
- Runtime support matrix
- Java deployment runbook
- JVM options checklist
```

---

## 10. ADR Example 2 — Artifact Type

```markdown
# ADR-0002: Use Spring Boot Layered Executable JAR for Containerized Services

## Status
Accepted

## Context
Most new backend services are Spring Boot services deployed as containers. Current images rebuild large layers even for application-only changes, increasing registry traffic and deployment time.

We need an artifact structure that supports reproducible builds, efficient container layering, simple execution, and standard deployment.

## Decision
Containerized Spring Boot services will be packaged as executable layered JARs.

The Dockerfile/build process must extract or preserve Spring Boot layers:
- dependencies;
- spring-boot-loader;
- snapshot-dependencies;
- application.

WAR packaging remains allowed for services deployed to external servlet containers or app servers.

## Options Considered
1. simple fat JAR copied into image;
2. layered Spring Boot JAR;
3. thin JAR with external dependencies;
4. WAR deployed to Tomcat;
5. jlink custom runtime image.

## Decision Drivers
- image rebuild efficiency;
- operational simplicity;
- rollback clarity;
- compatibility with Spring Boot;
- team familiarity.

## Consequences

### Positive
- application-only changes rebuild smaller image layer;
- standard execution model;
- easier local reproduction;
- no dependency volume management.

### Negative
- still larger than custom jlink image;
- nested JAR/classloader behavior remains;
- not suitable for external app server deployment.

## Operational Impact
- Dockerfile must preserve layers.
- Image labels must include build metadata.
- Actuator `/info` must expose build and Git data.
- Runtime config remains externalized.

## Rollback Impact
Rollback is by image digest/tag, not by modifying files inside container.

## Validation
- compare image layer cache behavior;
- verify startup;
- verify classpath;
- verify container scanning;
- verify rollout and rollback.
```

---

## 11. ADR Example 3 — Rollout Strategy

```markdown
# ADR-0003: Use Rolling Update as Default and Canary for High-Risk Services

## Status
Accepted

## Context
Most Java services are stateless HTTP APIs deployed on Kubernetes. Standard rolling update is sufficient for low/medium risk changes, but high-risk changes need progressive validation before 100% traffic.

## Decision
Default rollout strategy:
- RollingUpdate for low/medium-risk stateless services.
- Canary rollout for high-risk user-facing or integration-sensitive services.
- Blue-green for monoliths or deployments requiring fast whole-environment switch.
- Shadow traffic only for read-only/non-mutating validation.

## Options Considered
1. Recreate;
2. RollingUpdate;
3. Blue-green;
4. Canary;
5. Shadow traffic;
6. Ring deployment.

## Decision Drivers
- availability;
- rollback speed;
- operational complexity;
- state compatibility;
- observability maturity.

## Consequences

### Positive
- simple default for most services;
- better safety for risky changes;
- progressive delivery aligns with metrics gates.

### Negative
- canary requires traffic routing and observability;
- rolling update allows old/new versions to coexist;
- blue-green doubles capacity during switch.

## Operational Impact
- Services must support version skew during rolling update.
- Readiness probes must be accurate.
- Metrics must be tagged by version/pod.
- Runbook must define rollback criteria.

## Rollback Impact
- Rolling: `rollout undo`.
- Canary: stop promotion and shift traffic back.
- Blue-green: switch route back if old environment intact.

## Validation
- perform UAT canary rehearsal;
- verify metrics per version;
- verify rollback command.
```

---

## 12. ADR Example 4 — Config and Secret Strategy

```markdown
# ADR-0004: Externalize Runtime Configuration and Use Managed Secret Source

## Status
Accepted

## Context
Java services currently mix environment variables, application properties, and manually mounted secret files. This creates inconsistency and makes rotation difficult.

## Decision
Runtime configuration must be externalized.

Non-sensitive config:
- Kubernetes ConfigMap or environment-specific GitOps values.

Sensitive config:
- managed secret source integrated into platform;
- Kubernetes Secret may be used as delivery mechanism;
- secrets must not be committed to Git.

Secret rotation must be documented per service.

## Options Considered
1. packaged config inside JAR;
2. environment variables only;
3. ConfigMap + Secret;
4. cloud secret manager;
5. Vault;
6. config server.

## Decision Drivers
- security;
- auditability;
- rotation;
- operational consistency;
- local development ergonomics.

## Consequences

### Positive
- artifact can be promoted across environments;
- rotation becomes explicit;
- config diff can be reviewed;
- secrets are separated from code.

### Negative
- more moving parts;
- app restart may be required for some config;
- secret propagation delay must be understood.

## Operational Impact
- Runbook must include config version.
- Deployment evidence must show config source, not secret value.
- Secret changes require verification.
- Services must fail fast on missing required config.

## Rollback Impact
- Config rollback may require pod restart.
- Secret rollback may be unsafe if external provider already rotated.

## Validation
- verify startup with missing required config fails clearly;
- verify secret mount/env injection;
- verify rotation runbook.
```

---

## 13. ADR Example 5 — Observability Baseline

```markdown
# ADR-0005: Standard Observability Baseline for Java Services

## Status
Accepted

## Context
Deployment verification is inconsistent across services. Some services expose health endpoints and metrics; others rely only on logs. Incident diagnosis is slow when build version, runtime version, and correlation IDs are missing.

## Decision
All production Java services must expose or emit:
- build/version metadata;
- structured logs;
- correlation/request ID;
- health/readiness/liveness signal;
- metrics for request rate/error/latency;
- JVM metrics;
- GC logs or equivalent telemetry;
- distributed tracing where applicable;
- safe diagnostic path for thread dump/JFR.

## Options Considered
1. logs only;
2. Spring Boot Actuator per service;
3. OpenTelemetry Java Agent standard;
4. custom telemetry library;
5. service mesh only.

## Decision Drivers
- deployment verification;
- incident diagnosis;
- SLO monitoring;
- audit evidence;
- platform consistency.

## Consequences

### Positive
- faster incident diagnosis;
- better release gates;
- easier cross-service correlation;
- stronger deployment evidence.

### Negative
- telemetry cost;
- endpoint exposure risk;
- agent compatibility must be managed.

## Operational Impact
- deployment runbook must include dashboard links;
- metrics must include version/build labels where possible;
- actuator endpoints must be secured;
- logs must avoid PII/secrets.

## Rollback Impact
Observability agent/config change can be rolled back independently only if separated from app artifact.

## Validation
- verify health endpoints;
- verify metrics scrape;
- verify trace emission;
- verify log correlation;
- verify diagnostic access.
```

---

## 14. ADR Example 6 — Database Migration Strategy

```markdown
# ADR-0006: Use Expand-Contract Pattern for Production Schema Changes

## Status
Accepted

## Context
Application rollback becomes unsafe when schema migration removes or renames fields used by old application versions. Rolling deployments also require old and new versions to coexist temporarily.

## Decision
Production database migrations must follow expand-contract where practical:
1. expand schema in backward-compatible way;
2. deploy app that can handle old/new shape;
3. backfill data safely;
4. switch reads/writes;
5. contract/remove old schema only after all consumers are migrated.

Destructive changes require separate CR and explicit approval.

## Options Considered
1. direct destructive migration;
2. expand-contract;
3. blue-green database;
4. dual-write migration;
5. manual data correction.

## Decision Drivers
- rollback safety;
- rolling deployment compatibility;
- data integrity;
- operational risk;
- auditability.

## Consequences

### Positive
- app rollback safer;
- supports rolling update;
- reduces outage risk;
- improves migration auditability.

### Negative
- multiple releases may be needed;
- temporary duplicate schema;
- more code complexity during transition.

## Operational Impact
- migration runbook must classify each migration phase;
- schema history evidence required;
- cleanup phase tracked separately;
- rollback must distinguish app rollback and DB rollback.

## Rollback Impact
Additive expand step usually remains after app rollback.
Destructive contract step may be irreversible and needs special approval.

## Validation
- test old app with expanded schema;
- test new app with old data;
- verify migration duration;
- verify rollback to old app.
```

---

## 15. ADR Example 7 — Production Deployment Access Model

```markdown
# ADR-0007: Production Deployments Must Go Through CI/CD or GitOps

## Status
Accepted

## Context
Manual production deployments reduce traceability and increase the risk of unapproved changes. Enterprise audit requires evidence linking approved change, artifact, operator, and deployment result.

## Decision
Production Java deployments must be executed through approved CI/CD or GitOps workflow.

Direct manual changes are allowed only under break-glass emergency procedure and must be documented afterward.

## Options Considered
1. manual SSH/kubectl by engineer;
2. CI/CD deployment;
3. GitOps deployment;
4. hybrid manual approval with automated execution.

## Decision Drivers
- auditability;
- repeatability;
- access control;
- evidence capture;
- reduced human error.

## Consequences

### Positive
- stronger traceability;
- automatic evidence;
- fewer manual mistakes;
- easier rollback history.

### Negative
- pipeline outage can block deployment;
- emergency procedure required;
- pipeline permissions must be governed.

## Operational Impact
- pipeline must log artifact digest, CR ID, operator, and result;
- production credentials must not be local developer secrets;
- break-glass access must be audited.

## Rollback Impact
Rollback should also go through approved automated path where possible.

## Validation
- test pipeline deploy/rollback;
- verify audit logs;
- verify CR evidence attachment.
```

---

## 16. Checklist vs ADR

ADR captures decision.

Checklist verifies readiness.

Example:

ADR says:

```text
We use rolling update for stateless services.
```

Checklist asks:

```text
[ ] Does service support old/new version coexistence?
[ ] Are readiness probes accurate?
[ ] Is graceful shutdown configured?
[ ] Are database changes backward-compatible?
[ ] Is rollback command tested?
```

ADR without checklist risks being conceptual.

Checklist without ADR risks being mechanical without reason.

Together:

```text
ADR = why this is the standard
Checklist = how to avoid violating it
```

---

## 17. Master Deployment Decision Checklist

Use this before major Java deployment design.

### 17.1 Runtime

```text
[ ] Target Java version selected.
[ ] Runtime vendor selected.
[ ] Support policy understood.
[ ] OS/container base compatible.
[ ] JVM flags compatible with target Java version.
[ ] Observability agent compatible.
[ ] TLS/cert behavior verified.
[ ] GC/logging diagnostics configured.
```

### 17.2 Artifact

```text
[ ] Artifact type selected: JAR/WAR/EAR/native/custom image.
[ ] Dependency packaging understood.
[ ] Classpath/module path behavior known.
[ ] Build metadata embedded.
[ ] Artifact immutable.
[ ] Artifact checksum/signature available.
[ ] Rollback artifact retained.
```

### 17.3 Platform

```text
[ ] Deployment platform selected: VM/systemd, app server, container, Kubernetes.
[ ] Process lifecycle understood.
[ ] Signal handling supported.
[ ] Writable paths defined.
[ ] Logs/metrics/dumps path defined.
[ ] Non-root/security model defined.
[ ] Capacity model defined.
```

### 17.4 Configuration

```text
[ ] Config externalized.
[ ] Required config validated at startup.
[ ] Config precedence documented.
[ ] Environment-specific values controlled.
[ ] Secrets separated from config.
[ ] Rotation behavior documented.
[ ] Config rollback defined.
```

### 17.5 Rollout

```text
[ ] Rollout strategy selected.
[ ] Old/new version coexistence verified.
[ ] Readiness probe accurate.
[ ] Graceful shutdown configured.
[ ] Traffic drain behavior understood.
[ ] Monitoring per version available.
[ ] Rollback trigger defined.
```

### 17.6 Database

```text
[ ] Migration tool selected.
[ ] Migration classified.
[ ] Backward compatibility verified.
[ ] Lock risk assessed.
[ ] Backup/restore or forward-fix plan defined.
[ ] App rollback vs DB rollback separated.
[ ] Data validation query defined.
```

### 17.7 State

```text
[ ] Sessions behavior understood.
[ ] Cache invalidation strategy defined.
[ ] Queue consumer drain behavior defined.
[ ] Scheduler/job behavior defined.
[ ] Idempotency verified.
[ ] Duplicate processing risk assessed.
[ ] Distributed lock behavior understood.
```

### 17.8 Observability

```text
[ ] Health/readiness/liveness exposed.
[ ] Build/version info exposed.
[ ] Logs structured.
[ ] Correlation ID propagated.
[ ] Metrics available.
[ ] Traces available where needed.
[ ] JVM diagnostics available.
[ ] Dashboard exists.
[ ] Alert thresholds defined.
```

### 17.9 Security

```text
[ ] Non-root runtime.
[ ] Least privilege.
[ ] No secret in image/logs.
[ ] Admin endpoints protected.
[ ] Debug/JMX disabled or restricted.
[ ] TLS/truststore verified.
[ ] Image scanned.
[ ] SBOM/signature available.
```

### 17.10 Governance

```text
[ ] CR linked.
[ ] Risk classification documented.
[ ] Required approvals obtained.
[ ] Runbook linked.
[ ] Evidence plan defined.
[ ] Rollback owner assigned.
[ ] Monitoring window defined.
[ ] Closure criteria measurable.
```

---

## 18. Checklist: Java Runtime Selection ADR

Use this when deciding Java version/vendor.

```markdown
# Java Runtime Selection Checklist

## Context
[ ] New service or existing service?
[ ] Current Java version:
[ ] Target Java version:
[ ] Framework version:
[ ] App server/container:
[ ] OS/container base:
[ ] CPU architecture:

## Support
[ ] Runtime vendor support policy reviewed.
[ ] Security patch cadence acceptable.
[ ] Enterprise support requirement satisfied.
[ ] Licensing acceptable.
[ ] Internal certification available.

## Compatibility
[ ] Source/target bytecode compatible.
[ ] Dependencies support target runtime.
[ ] Framework supports target runtime.
[ ] App server supports target runtime.
[ ] Monitoring agent supports target runtime.
[ ] JVM flags reviewed.
[ ] TLS/cert behavior tested.

## Deployment
[ ] Base image available.
[ ] Image scanning supported.
[ ] Diagnostics tools available.
[ ] Container memory behavior verified.
[ ] Startup time acceptable.
[ ] Rollback to previous runtime possible or not needed.

## Decision
[ ] ADR written.
[ ] Runtime matrix updated.
[ ] CI/CD updated.
[ ] Runbook updated.
```

---

## 19. Checklist: Artifact Type ADR

```markdown
# Artifact Type Decision Checklist

## Artifact Options
[ ] Executable JAR
[ ] Layered executable JAR
[ ] Thin JAR
[ ] WAR
[ ] EAR
[ ] Native image
[ ] jlink custom runtime

## Decision Drivers
[ ] Deployment platform:
[ ] Startup requirement:
[ ] Image size requirement:
[ ] Classloading complexity:
[ ] App server requirement:
[ ] Rollback strategy:
[ ] Debuggability:
[ ] Security scanning:
[ ] Dependency patching:
[ ] Team familiarity:

## Validation
[ ] Artifact runs locally.
[ ] Artifact runs in target platform.
[ ] Version metadata available.
[ ] Logs/metrics available.
[ ] Rollback artifact exists.
[ ] Dependency conflict check done.
[ ] Runtime compatibility tested.
```

---

## 20. Checklist: Kubernetes Java Deployment ADR

```markdown
# Kubernetes Java Deployment Checklist

## Workload
[ ] Deployment / StatefulSet / Job / CronJob selected correctly.
[ ] Replica count defined.
[ ] Pod labels stable.
[ ] Service selector correct.
[ ] Ingress/route defined.
[ ] Namespace confirmed.

## Container
[ ] Image immutable by digest/tag.
[ ] Non-root user.
[ ] Read-only filesystem if feasible.
[ ] Writable tmp/log/dump path defined.
[ ] ENTRYPOINT handles signals.
[ ] Timezone/CA cert requirements met.

## Resources
[ ] CPU request defined.
[ ] Memory request defined.
[ ] CPU limit decision documented.
[ ] Memory limit defined.
[ ] Heap sizing leaves native headroom.
[ ] Direct memory/thread stack considered.
[ ] HPA/VPA behavior understood.

## Probes
[ ] Startup probe if slow startup possible.
[ ] Readiness probe reflects traffic safety.
[ ] Liveness probe not too aggressive.
[ ] Probe timeouts realistic.
[ ] Health dependency behavior defined.

## Shutdown
[ ] SIGTERM handled.
[ ] Graceful shutdown configured.
[ ] terminationGracePeriodSeconds sufficient.
[ ] preStop used only when justified.
[ ] In-flight requests drained.
[ ] Queue consumers drained if relevant.

## Rollout
[ ] Rolling/canary/blue-green strategy selected.
[ ] maxUnavailable/maxSurge set.
[ ] PDB considered.
[ ] Rollback tested.
[ ] Old/new compatibility verified.
```

---

## 21. Checklist: App Server Deployment ADR

```markdown
# App Server / Servlet Container Deployment Checklist

## Runtime
[ ] Server selected: Tomcat/Jetty/Undertow/WildFly/Payara/Open Liberty/WebLogic/WebSphere.
[ ] Java version supported.
[ ] Jakarta/Java EE version supported.
[ ] Vendor support/certification confirmed.

## Artifact
[ ] WAR/EAR/exploded deployment selected.
[ ] Context path defined.
[ ] Shared libraries documented.
[ ] Provided vs packaged dependencies reviewed.
[ ] Classloader policy understood.

## Configuration
[ ] Datasource/JNDI binding defined.
[ ] JMS/resource adapter binding defined.
[ ] Security realm/identity integration defined.
[ ] Environment-specific config externalized.

## Deployment
[ ] Admin CLI or automation path defined.
[ ] Manual console deployment avoided or controlled.
[ ] Hot deploy risk understood.
[ ] Restart requirement documented.
[ ] Cluster rollout order defined.

## Operations
[ ] Logs path known.
[ ] Thread dump method known.
[ ] Heap dump method known.
[ ] Session persistence understood.
[ ] Rollback artifact available.
```

---

## 22. Checklist: Rollout Strategy ADR

```markdown
# Rollout Strategy Checklist

## Change Type
[ ] Stateless code change
[ ] Stateful processing change
[ ] DB migration
[ ] Auth/security change
[ ] External integration change
[ ] High-traffic endpoint
[ ] User-visible workflow

## Compatibility
[ ] Old and new versions can coexist.
[ ] API is backward-compatible.
[ ] Event schema is compatible.
[ ] DB schema is compatible.
[ ] Cache keys are compatible.
[ ] Session state is compatible.

## Strategy
[ ] Rolling update
[ ] Blue-green
[ ] Canary
[ ] Shadow
[ ] Ring
[ ] Maintenance-window recreate

## Safety
[ ] Metrics by version available.
[ ] Rollback trigger defined.
[ ] Smoke test defined.
[ ] Synthetic test defined.
[ ] Traffic shifting mechanism available.
[ ] Capacity for parallel versions available.
```

---

## 23. Checklist: Database Migration ADR

```markdown
# Database Migration Decision Checklist

## Migration Type
[ ] Add nullable column
[ ] Add index
[ ] Add table
[ ] Add constraint
[ ] Rename/drop column
[ ] Data backfill
[ ] Data correction
[ ] Stored procedure/package change

## Compatibility
[ ] Old app works with new schema.
[ ] New app works with old data.
[ ] Rolling deployment safe.
[ ] Rollback app-only possible.
[ ] DB rollback needed?
[ ] Roll-forward plan available.

## Risk
[ ] Lock duration estimated.
[ ] Row count known.
[ ] Index creation method reviewed.
[ ] Backup verified.
[ ] Migration tested in representative environment.
[ ] DBA approval obtained if needed.

## Verification
[ ] Schema history table checked.
[ ] Object exists.
[ ] Data count/checksum verified.
[ ] Invalid objects checked.
[ ] App health verified.
```

---

## 24. Checklist: Secret and Certificate ADR

```markdown
# Secret / Certificate Deployment Checklist

## Secret Type
[ ] DB password
[ ] OAuth client secret
[ ] API key
[ ] TLS private key
[ ] Truststore
[ ] Keystore
[ ] SAML/OIDC signing cert
[ ] mTLS client certificate

## Source
[ ] Kubernetes Secret
[ ] Cloud Secret Manager
[ ] Vault
[ ] Parameter Store
[ ] Manual file
[ ] App server credential store

## Rotation
[ ] Rotation owner defined.
[ ] Expiry known.
[ ] Dual-validity window available.
[ ] Reload vs restart defined.
[ ] Propagation delay understood.
[ ] Rollback possible?
[ ] Consumers identified.
[ ] Smoke test defined.

## Security
[ ] Secret not in image.
[ ] Secret not in Git.
[ ] Secret not logged.
[ ] Evidence redacted.
[ ] Access audited.
```

---

## 25. Checklist: Observability ADR

```markdown
# Observability Baseline Checklist

## Identity
[ ] Service name.
[ ] Version.
[ ] Git commit.
[ ] Build time.
[ ] Runtime Java version.
[ ] Environment.

## Logs
[ ] Structured logs.
[ ] Correlation ID.
[ ] Error classification.
[ ] No secrets/PII.
[ ] Centralized log shipping.

## Metrics
[ ] Request rate.
[ ] Error rate.
[ ] Latency p95/p99.
[ ] JVM memory.
[ ] GC.
[ ] Threads.
[ ] DB pool.
[ ] Queue depth.
[ ] Business metric.

## Traces
[ ] Inbound request traced.
[ ] Outbound HTTP traced.
[ ] DB spans if appropriate.
[ ] Queue spans if appropriate.
[ ] Trace sampled appropriately.

## Health
[ ] Liveness.
[ ] Readiness.
[ ] Startup.
[ ] Dependency health semantics defined.

## Diagnostics
[ ] Thread dump path.
[ ] Heap dump path.
[ ] JFR path.
[ ] GC log path.
[ ] Access control.
```

---

## 26. Checklist: Security Hardening ADR

```markdown
# Deployment Security Hardening Checklist

## Container/Process
[ ] Non-root user.
[ ] Read-only root filesystem.
[ ] Least privilege.
[ ] Linux capabilities dropped.
[ ] seccomp/AppArmor profile considered.
[ ] No shell in production image unless justified.
[ ] Debug tools strategy defined.

## Network
[ ] NetworkPolicy defined.
[ ] Egress restricted where feasible.
[ ] Admin endpoints isolated.
[ ] TLS enabled.
[ ] mTLS if required.

## JVM/Admin Surface
[ ] JMX disabled or restricted.
[ ] Debug port disabled.
[ ] Attach mechanism policy defined.
[ ] Actuator endpoints restricted.
[ ] Heap/thread dump access controlled.

## Supply Chain
[ ] Image scanned.
[ ] SBOM generated.
[ ] Artifact signed.
[ ] Base image approved.
[ ] No mutable latest tag in production.

## Evidence
[ ] Security review linked.
[ ] Exception documented.
[ ] Expiry/review date for exception.
```

---

## 27. Checklist: Rollback ADR

```markdown
# Rollback Decision Checklist

## Rollback Scope
[ ] App artifact.
[ ] Config.
[ ] Secret/cert.
[ ] Database.
[ ] Feature flag.
[ ] Traffic route.
[ ] Queue consumer.
[ ] Scheduler/job.
[ ] Infrastructure.

## Rollback Feasibility
[ ] Previous artifact available.
[ ] Previous config available.
[ ] Previous image digest known.
[ ] Old app compatible with current DB.
[ ] Data shape compatible.
[ ] External dependency state compatible.
[ ] Rollback tested in lower environment.
[ ] Rollback time estimate known.

## Trigger
[ ] Health failure.
[ ] Smoke failure.
[ ] Error rate threshold.
[ ] Latency threshold.
[ ] Business KPI failure.
[ ] Security/auth failure.
[ ] Manual decision owner.

## Verification
[ ] Health OK.
[ ] Version reverted.
[ ] Metrics recovered.
[ ] Logs normal.
[ ] Business smoke passed.
[ ] Evidence captured.
```

---

## 28. Checklist: Production Readiness ADR

```markdown
# Production Readiness Checklist for Java Service

## Build and Artifact
[ ] Reproducible build.
[ ] Immutable artifact.
[ ] Version metadata.
[ ] SBOM.
[ ] Scan result.
[ ] Signature/digest.

## Runtime
[ ] Java version certified.
[ ] JVM flags reviewed.
[ ] Memory sizing reviewed.
[ ] Diagnostics configured.

## Deployment
[ ] Platform selected.
[ ] Rollout strategy selected.
[ ] Health probes configured.
[ ] Graceful shutdown configured.
[ ] Rollback tested.

## Config and Secrets
[ ] Externalized config.
[ ] Secret source approved.
[ ] Rotation documented.
[ ] No secrets in logs/image/Git.

## Data
[ ] Migration strategy.
[ ] Backup if needed.
[ ] Compatibility verified.
[ ] Data validation defined.

## Observability
[ ] Logs.
[ ] Metrics.
[ ] Traces.
[ ] Dashboard.
[ ] Alerts.
[ ] Smoke/synthetic.

## Security
[ ] Least privilege.
[ ] Network controls.
[ ] Admin endpoint restrictions.
[ ] Vulnerability scan.

## Governance
[ ] Owner.
[ ] Runbook.
[ ] CR process.
[ ] Support model.
[ ] Escalation.
```

---

## 29. Decision Matrix: When to Use Which Deployment Platform

| Context | Preferred Deployment | Why |
|---|---|---|
| Small internal tool, low traffic | VM/systemd or simple container | simple operations |
| Modern stateless API | Kubernetes Deployment | scaling, rollout, probes |
| Legacy WAR with JNDI/app server features | App server | compatibility |
| Batch job | Kubernetes Job/CronJob or scheduler | lifecycle fit |
| Stateful broker/database-like workload | StatefulSet or managed service | stable identity/storage |
| Desktop/internal installed Java app | jpackage | native OS packaging |
| Ultra-low startup CLI | native image maybe | startup/footprint |
| Strict app server certification | WebLogic/WebSphere/JBoss EAP | vendor support |

ADR should explain why one was chosen and why alternatives were rejected.

---

## 30. Decision Matrix: Artifact Type

| Artifact | Good For | Avoid When |
|---|---|---|
| executable JAR | simple Java service | app server required |
| layered JAR | Spring Boot container | non-Boot app |
| thin JAR | controlled dependency sharing | dependency drift risk |
| WAR | servlet container/app server | standalone simplicity needed |
| EAR | enterprise app server packaging | microservice-style deployment |
| native image | fast startup/small memory | heavy reflection/dynamic runtime without support |
| jlink image | modular/custom runtime | classpath legacy with unclear modules |

---

## 31. Decision Matrix: Rollout Strategy

| Strategy | Good For | Risk |
|---|---|---|
| Rolling | stateless compatible services | old/new coexistence |
| Recreate | simple low availability systems | downtime |
| Blue-green | quick switch/rollback | double capacity, data compatibility |
| Canary | high-risk progressive validation | needs metrics/routing |
| Shadow | read-only behavior validation | duplicate side effects if unsafe |
| Ring | user/tenant phased rollout | segmentation complexity |

---

## 32. Decision Matrix: Config Strategy

| Strategy | Good For | Risk |
|---|---|---|
| env var | simple scalar config | weak structure, restart needed |
| config file | structured config | mount/version management |
| ConfigMap | Kubernetes non-secret config | propagation/restart semantics |
| Kubernetes Secret | basic secret delivery | not full secret lifecycle alone |
| Vault/cloud secret manager | strong secret lifecycle | integration complexity |
| config server | dynamic centralized config | availability dependency |

---

## 33. ADR Repository Structure

Recommended:

```text
docs/
  adr/
    0001-use-java-21-baseline.md
    0002-use-layered-jar-for-spring-boot.md
    0003-default-rollout-strategy.md
    0004-config-and-secret-strategy.md
    0005-observability-baseline.md
    0006-database-migration-strategy.md
  checklists/
    java-runtime-selection.md
    artifact-type.md
    kubernetes-deployment.md
    app-server-deployment.md
    database-migration.md
    secret-certificate-rotation.md
    production-readiness.md
  runbooks/
    deploy-case-service.md
    rollback-case-service.md
```

ADR should be version controlled.

Why?

1. reviewable through PR;
2. searchable;
3. history preserved;
4. linked to code/config;
5. avoids doc drift.

---

## 34. Naming ADRs

Good names:

```text
0001-use-java-21-as-default-runtime.md
0002-package-spring-boot-services-as-layered-jars.md
0003-use-gitops-for-production-deployment.md
0004-use-expand-contract-for-db-migrations.md
```

Bad names:

```text
architecture.md
deployment.md
decision-final-v2.md
new-approach.md
```

ADR title should include the decision.

---

## 35. ADR Lifecycle

ADR lifecycle:

```text
identify decision
→ draft ADR
→ review options
→ accept/reject
→ implement
→ link runbook/checklist
→ validate in deployment
→ revisit after incident or context change
```

### 35.1 When to Revisit ADR

Revisit when:

1. Java version support changes;
2. vendor support changes;
3. platform changes;
4. incident exposes flaw;
5. cost changes;
6. team capability changes;
7. security requirement changes;
8. compliance requirement changes;
9. scaling assumptions change;
10. app architecture changes.

ADR should not be immutable dogma.

It is a record of decision under a context.

When context changes, decision may change.

---

## 36. ADR Review Questions

When reviewing ADR, ask:

```text
[ ] Is the problem clear?
[ ] Is the context specific?
[ ] Are options real, not strawman?
[ ] Are trade-offs honest?
[ ] Are negative consequences included?
[ ] Is rollback/operational impact described?
[ ] Is security/compliance impact described?
[ ] Is validation measurable?
[ ] Are related runbooks/checklists linked?
[ ] Is ownership clear?
[ ] Is the decision actionable?
```

ADR review should not become wordsmithing.

Focus on decision quality.

---

## 37. Checklist Quality Rules

Checklist harus:

1. singkat;
2. actionable;
3. spesifik;
4. punya yes/no outcome;
5. dipakai di waktu yang tepat;
6. tidak terlalu banyak item low-value;
7. punya owner;
8. diperbarui setelah incident;
9. tidak menggantikan engineering judgment;
10. tidak menjadi ritual kosong.

Bad checklist item:

```text
[ ] System is good.
```

Good checklist item:

```text
[ ] Readiness endpoint returns UP from all new pods for at least 5 minutes.
```

Bad:

```text
[ ] Security checked.
```

Good:

```text
[ ] No Actuator sensitive endpoints are exposed outside internal admin network.
```

---

## 38. Checklist Placement in SDLC

Different checklist at different phase.

| Phase | Checklist |
|---|---|
| Architecture | ADR decision checklist |
| Implementation | config/security/artifact checklist |
| Pre-release | production readiness checklist |
| CR approval | risk/evidence checklist |
| Deployment | runbook checklist |
| Post-deploy | verification checklist |
| Incident | diagnostic checklist |
| RCA | learning/action checklist |

Do not use one giant checklist for everything.

Use phase-specific checklists.

---

## 39. Linking ADR to Automated Controls

ADR should not remain passive text.

Example:

ADR:

```text
Production deployments must not use mutable latest tag.
```

Automated controls:

1. CI rejects `:latest`;
2. admission policy rejects mutable tag;
3. GitOps PR template requires digest;
4. checklist includes image digest;
5. CR evidence captures digest.

ADR:

```text
Services must expose readiness endpoint.
```

Automated controls:

1. Kubernetes manifest validation requires readinessProbe;
2. pipeline smoke calls readiness;
3. dashboard alerts on readiness flaps.

ADR:

```text
Containers must run as non-root.
```

Automated controls:

1. Dockerfile creates app user;
2. manifest sets `runAsNonRoot`;
3. admission policy enforces;
4. security scan reports exceptions.

Top-tier approach:

```text
decision → checklist → pipeline/policy → evidence
```

---

## 40. Deployment ADR Pack for a New Java Service

When starting a new production Java service, create a compact ADR pack:

```text
ADR-0001 Runtime baseline
ADR-0002 Artifact packaging
ADR-0003 Deployment platform
ADR-0004 Rollout strategy
ADR-0005 Config/secrets strategy
ADR-0006 Observability baseline
ADR-0007 Database migration strategy
ADR-0008 Security hardening baseline
ADR-0009 CI/CD and production access model
ADR-0010 Rollback model
```

This may sound heavy, but each ADR can be 1–2 pages.

The value is huge:

1. onboarding faster;
2. deployment safer;
3. review clearer;
4. audit easier;
5. fewer repeated debates;
6. better incident response.

---

## 41. Deployment ADR Pack for Legacy Modernization

For Java 8 legacy migration:

```text
ADR-0001 Keep Java 8 for current production until app server certification complete
ADR-0002 Introduce Java 17/21 compatibility test branch
ADR-0003 Move manual deployment to pipeline-controlled deployment
ADR-0004 Externalize environment config
ADR-0005 Add build/runtime metadata endpoint
ADR-0006 Adopt expand-contract DB migration
ADR-0007 Introduce smoke test before PROD closure
ADR-0008 Define rollback via previous WAR/EAR and config snapshot
ADR-0009 Define session strategy for rolling restart
ADR-0010 Define target state container/Kubernetes migration path
```

Legacy modernization ADRs should avoid pretending everything can change at once.

---

## 42. Common ADR Anti-Patterns

### 42.1 Decision Without Context

Bad:

```text
We use Kubernetes.
```

Missing why.

### 42.2 Context Without Decision

Bad:

```text
We have many deployment problems...
```

But no actual decision.

### 42.3 All Options Look Bad Except Favorite

Bad ADR writes fake alternatives.

Good ADR honestly compares real trade-offs.

### 42.4 No Negative Consequence

If ADR has no downside, it is probably incomplete.

### 42.5 ADR as Permission Slip

Bad:

```text
We already decided, write ADR after the fact to justify.
```

Sometimes retroactive ADR is needed, but it should still be honest.

### 42.6 Too Large ADR

If ADR covers 20 unrelated decisions, split it.

### 42.7 ADR Never Updated

ADR must be superseded when context changes.

### 42.8 Checklist as Bureaucracy

Checklist filled after deployment just to close ticket is not a safety mechanism.

Checklist must influence decisions before action.

---

## 43. Practical Exercise: Write ADR From Deployment Problem

Problem:

```text
A Java service deployed on Kubernetes often fails during rolling update because startup takes 90 seconds, liveness probe starts too early, and pods get restarted before becoming ready.
```

Bad fix:

```text
Increase liveness timeout randomly.
```

Better ADR:

```markdown
# ADR: Use Startup Probe for Slow-Starting Java Services

## Context
Some Java services require long startup due dependency initialization, schema validation, cache warmup, or classloading. Current liveness probe starts before application can complete startup, causing restart loops.

## Decision
Java services with startup time > readiness initial delay must configure startupProbe. Liveness probe will only protect against deadlock after startupProbe succeeds.

## Consequences
Positive:
- avoids premature restarts;
- separates startup failure from runtime failure.

Negative:
- bad startup may take longer to fail;
- probe thresholds must be tuned per service.

## Validation
- test cold startup;
- verify no restart loop;
- verify readiness only true after dependencies ready.
```

Then checklist:

```text
[ ] Cold startup time measured.
[ ] startupProbe configured.
[ ] readinessProbe dependency semantics defined.
[ ] livenessProbe not aggressive.
[ ] rollout tested.
```

---

## 44. Practical Exercise: ADR for DB Migration

Problem:

```text
Team wants to rename column CASE_STATUS to STATUS in one release.
```

Risk:

1. old app breaks;
2. rollback unsafe;
3. reports/integrations may break;
4. migration may lock table;
5. data scripts need update.

ADR decision:

```text
Use expand-contract:
1. add STATUS nullable;
2. dual-write CASE_STATUS and STATUS;
3. backfill;
4. switch reads;
5. update consumers;
6. remove CASE_STATUS in later release.
```

Checklist:

```text
[ ] old app works after add column;
[ ] new app works before backfill complete;
[ ] backfill idempotent;
[ ] reports updated;
[ ] rollback app-only possible after phase 1;
[ ] contract phase has separate CR.
```

This is how ADR improves deployment safety.

---

## 45. Top 1% Perspective: Decision Memory

Top-tier engineers understand that systems fail not only because code is wrong.

Systems fail because:

1. context is forgotten;
2. trade-offs are hidden;
3. assumptions expire;
4. decisions are repeated inconsistently;
5. new engineers copy old patterns without knowing why;
6. platform changes invalidate old choices;
7. operational consequences were never written down.

ADR is institutional memory.

Checklist is institutional caution.

Together they create decision discipline.

The goal is not documentation volume.

The goal is **decision survivability**.

A decision survives when future engineers can understand:

```text
what was decided
why it was decided
what alternatives were rejected
what consequences were accepted
how to validate it
when to revisit it
```

---

## 46. Final Master Checklist for Deployment ADR Maturity

```text
[ ] We have ADRs for runtime baseline.
[ ] We have ADRs for artifact packaging.
[ ] We have ADRs for deployment platform.
[ ] We have ADRs for rollout strategy.
[ ] We have ADRs for config/secrets.
[ ] We have ADRs for database migration.
[ ] We have ADRs for observability baseline.
[ ] We have ADRs for deployment security baseline.
[ ] We have ADRs for CI/CD production access.
[ ] We have ADRs for rollback model.
[ ] ADRs are version-controlled.
[ ] ADRs have status.
[ ] ADRs include consequences.
[ ] ADRs link to runbooks/checklists.
[ ] Checklists are used before deployment, not after.
[ ] Some ADR decisions are enforced by pipeline/policy.
[ ] ADRs are revisited after incidents and major platform changes.
```

If your team has this, deployment maturity is far above average.

---

## 47. Summary

Deployment ADRs and checklists turn implicit operational wisdom into explicit engineering assets.

ADR answers:

```text
Why did we choose this deployment approach?
```

Checklist answers:

```text
Did we verify the important things before acting?
```

For Java deployment, ADRs should cover:

1. runtime version/vendor;
2. artifact strategy;
3. deployment platform;
4. rollout strategy;
5. config/secrets;
6. observability;
7. database migration;
8. security hardening;
9. CI/CD governance;
10. rollback model.

The central mental model:

> ADR captures deployment decisions.  
> Checklist operationalizes deployment decisions.  
> Pipeline/policy enforces deployment decisions.  
> Evidence proves deployment decisions were followed.

This is how deployment knowledge becomes durable team capability.

---

## 48. References

- Michael Nygard ADR template — Decision record template: https://github.com/joelparkerhenderson/architecture-decision-record/blob/main/locales/en/templates/decision-record-template-by-michael-nygard/index.md
- Thoughtworks Technology Radar — Lightweight Architecture Decision Records: https://www.thoughtworks.com/radar/techniques/lightweight-architecture-decision-records
- ADR GitHub organization and templates: https://adr.github.io/
- Kubernetes Documentation — Production environment: https://kubernetes.io/docs/setup/production-environment/
- Kubernetes Documentation — Deployments: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/
- Spring Boot Documentation — Production-ready Features / Actuator: https://docs.spring.io/spring-boot/reference/actuator/index.html
- Spring Blog — Liveness and Readiness Probes with Spring Boot: https://spring.io/blog/2020/03/25/liveness-and-readiness-probes-with-spring-boot
- NIST Secure Software Development Framework SP 800-218: https://csrc.nist.gov/pubs/sp/800/218/final
