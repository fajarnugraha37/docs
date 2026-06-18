# learn-java-deployment-runtime-release-delivery-engineering — Part 34
# Capstone: Designing a Production-Grade Java Deployment Platform

> **Series:** `learn-java-deployment-runtime-release-delivery-engineering`  
> **Part:** 34 of 35  
> **Topic:** Capstone — Designing a Production-Grade Java Deployment Platform  
> **Scope:** Java 8–25, legacy WAR/EAR, Spring Boot executable JAR, Kubernetes, VM/systemd, application server, CI/CD, GitOps, secrets, observability, database migration, rollout strategy, rollback, security, governance, auditability, multi-environment operations  
> **Goal:** Menyatukan seluruh konsep deployment series menjadi blueprint platform deployment Java production-grade yang bisa dipakai untuk enterprise systems, regulatory systems, dan distributed Java backends.

---

## 0. Posisi Part Ini Dalam Series

Part ini adalah **capstone design**.

Sebelumnya kita sudah membahas bagian-bagian individual:

1. mental model deployment;
2. Java 8–25 deployment evolution;
3. artifact taxonomy;
4. runtime selection;
5. OS/process contract;
6. configuration deployment;
7. JVM options;
8. Linux packaging;
9. containerizing Java;
10. Dockerfile patterns;
11. jlink/jdeps/jpackage;
12. classpath/module failure;
13. servlet container/app server deployment;
14. Spring Boot deployment;
15. Kubernetes deployment;
16. probes and graceful shutdown;
17. resource sizing;
18. release strategy;
19. database-aware deployment;
20. stateful deployment;
21. secret/cert rotation;
22. observability-ready deployment;
23. deployment verification;
24. CI/CD;
25. supply chain security;
26. deployment hardening;
27. multi-environment deployment;
28. multi-service distributed deployment;
29. legacy deployment;
30. modern Java deployment;
31. failure modeling/RCA;
32. runbook engineering;
33. enterprise governance;
34. ADR and checklists.

Part ini menjawab:

> “Kalau kita harus mendesain platform deployment Java production-grade dari nol atau memodernisasi platform yang ada, seperti apa desainnya?”

Bukan hanya:

```text
pakai Kubernetes
```

Bukan hanya:

```text
pakai CI/CD
```

Bukan hanya:

```text
pakai Docker
```

Tapi desain yang menghubungkan:

```text
developer workflow
→ source control
→ build
→ artifact
→ scan/sign/SBOM
→ release candidate
→ approval
→ deployment manifest
→ environment promotion
→ runtime execution
→ traffic control
→ config/secrets
→ DB migration
→ observability
→ verification
→ rollback/roll-forward
→ evidence
→ incident learning
```

---

## 1. Problem Statement

Kita ingin membangun deployment platform untuk organisasi enterprise yang memiliki campuran:

1. Java 8 legacy systems;
2. Java 17/21/25 modern services;
3. Spring Boot executable JAR;
4. WAR/EAR on application servers;
5. Kubernetes workloads;
6. VM/systemd workloads;
7. Oracle/PostgreSQL/MySQL databases;
8. Redis cache;
9. RabbitMQ/Kafka;
10. identity provider integration;
11. external APIs;
12. multi-environment lifecycle: DEV, SIT, UAT, staging, PROD, DR;
13. audit/compliance requirements;
14. regulatory workflows;
15. controlled release process.

Target platform harus memenuhi:

```text
safe delivery
repeatable deployment
fast rollback
traceable release
observable runtime
secure supply chain
controlled configuration
secret/cert rotation
database compatibility
stateful workload safety
audit evidence
team operability
```

---

## 2. North Star Architecture

High-level architecture:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Developer Workflow                                                   │
│ - branch, PR, code review, tests                                      │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                v
┌─────────────────────────────────────────────────────────────────────┐
│ CI Build Plane                                                       │
│ - compile, test, package                                             │
│ - SBOM, SCA, SAST, container scan                                    │
│ - artifact signing/provenance                                        │
│ - immutable artifact/image digest                                    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                v
┌─────────────────────────────────────────────────────────────────────┐
│ Release Control Plane                                                │
│ - release candidate                                                  │
│ - CR / approval                                                      │
│ - risk classification                                                │
│ - deployment manifest                                                │
│ - promotion gates                                                    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                v
┌─────────────────────────────────────────────────────────────────────┐
│ Deployment Execution Plane                                           │
│ - GitOps / CI-CD deployer                                            │
│ - Kubernetes / VM / App Server                                       │
│ - DB migration execution                                             │
│ - config and secret delivery                                         │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                v
┌─────────────────────────────────────────────────────────────────────┐
│ Runtime Plane                                                        │
│ - Java process                                                       │
│ - JVM options                                                        │
│ - health/readiness/liveness                                          │
│ - graceful shutdown                                                  │
│ - resource limits                                                    │
│ - traffic routing                                                    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                v
┌─────────────────────────────────────────────────────────────────────┐
│ Observability and Verification Plane                                 │
│ - logs, metrics, traces                                              │
│ - JFR/dumps/GC logs                                                  │
│ - smoke/synthetic checks                                             │
│ - SLO/error budget                                                   │
│ - release gates                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                v
┌─────────────────────────────────────────────────────────────────────┐
│ Governance and Learning Plane                                        │
│ - evidence                                                           │
│ - audit trail                                                        │
│ - incident/RCA                                                       │
│ - ADR/checklist updates                                              │
│ - continuous improvement                                             │
└─────────────────────────────────────────────────────────────────────┘
```

Key idea:

> A production-grade Java deployment platform is not one tool.  
> It is a coordinated system of controls, automation, runtime contracts, and feedback loops.

---

## 3. Design Principles

### 3.1 Build Once, Promote Many

Artifact should be built once and promoted across environments.

Bad:

```text
build separately for DEV, UAT, PROD
```

Risk:

1. PROD artifact may differ from tested artifact;
2. impossible to prove equivalence;
3. environment-specific code/config mixing;
4. weak auditability.

Good:

```text
same artifact → different external config
```

Example:

```text
case-service:1.24.0-a1b2c3d
  → DEV with dev config
  → SIT with sit config
  → UAT with uat config
  → PROD with prod config
```

### 3.2 Immutable Artifact, Mutable Runtime Configuration

Artifact:

```text
immutable
```

Config:

```text
externalized, versioned, controlled
```

This enables:

1. reproducible release;
2. environment promotion;
3. rollback clarity;
4. audit traceability.

### 3.3 Deployment Is a State Transition

Deployment changes system state.

State transition must have:

1. precondition;
2. command/action;
3. verification;
4. rollback/roll-forward;
5. evidence.

### 3.4 Default Safe, Advanced Optional

The platform should provide safe defaults:

```text
standard Dockerfile
standard JVM flags
standard probes
standard resource model
standard logging
standard CI/CD gates
standard rollback
standard runbook
```

Advanced options are allowed, but require ADR.

### 3.5 Risk-Based Governance

Low-risk changes should be fast.

High-risk changes should be controlled.

The platform should not apply identical manual burden to every change.

### 3.6 Observability Is Required, Not Optional

If we cannot observe it, we cannot safely deploy it.

Every production Java service must expose:

1. identity;
2. health;
3. logs;
4. metrics;
5. traces where needed;
6. JVM telemetry;
7. deployment version.

### 3.7 Rollback Is Designed Before Deployment

Rollback cannot be invented during incident.

Rollback design must include:

1. artifact rollback;
2. config rollback;
3. secret/cert rollback;
4. DB rollback/roll-forward;
5. traffic rollback;
6. feature flag rollback;
7. queue/scheduler safety.

### 3.8 Platform Supports Both Legacy and Modern Java

A real enterprise platform must support:

1. Java 8 legacy;
2. app server deployment;
3. VM/systemd;
4. modern Java 17/21/25;
5. containers;
6. Kubernetes;
7. phased migration.

Platform that only supports greenfield systems is incomplete.

---

## 4. Workload Taxonomy

Before designing platform, classify workloads.

### 4.1 Workload Types

| Type | Example | Deployment Pattern |
|---|---|---|
| Modern stateless API | Spring Boot REST service | Kubernetes Deployment |
| Legacy WAR | Java 8 WAR on Tomcat/WebLogic | App server or VM |
| Enterprise EAR | Java EE/Jakarta EE app | App server |
| Batch job | report generator | Kubernetes Job / scheduler |
| Scheduled service | nightly case escalation | CronJob / Quartz |
| Queue consumer | RabbitMQ/Kafka worker | Deployment with consumer drain |
| Stateful service | session-heavy monolith | app server cluster / StatefulSet if needed |
| CLI tool | migration/repair utility | controlled Job |
| Desktop/internal package | Java client app | jpackage/native installer |
| Native image service | fast-start small service | container native binary |

### 4.2 Workload Decision Rule

Ask:

```text
Is it long-running?
Does it receive HTTP traffic?
Does it process queues?
Does it hold session state?
Does it need stable identity/storage?
Does it require app server features?
Does it mutate database?
Does it need scheduling?
Does it require manual approval?
```

Do not force all Java workloads into one deployment model.

---

## 5. Runtime Baseline Strategy

A production-grade platform should define runtime baselines.

### 5.1 Recommended Baseline Model

```text
Legacy baseline:
- Java 8 only for certified legacy apps.

Maintenance baseline:
- Java 17 for services constrained by dependencies/certification.

Modern baseline:
- Java 21 for new long-lived backend services.

Forward evaluation:
- Java 25 for pilot/non-critical services before becoming standard.
```

### 5.2 Runtime Support Matrix

| Java Version | Use | Deployment Notes |
|---|---|---|
| Java 8 | legacy only | old flags, TLS, app server compatibility |
| Java 11 | migration bridge | avoid for new systems unless required |
| Java 17 | stable modern LTS | common baseline |
| Java 21 | preferred modern baseline | virtual threads available, modern ecosystem |
| Java 25 | evaluation/new advanced baseline | verify tooling/support/certification |

### 5.3 Runtime Vendor Strategy

Possible vendors:

1. Eclipse Temurin;
2. Amazon Corretto;
3. Oracle JDK;
4. Red Hat OpenJDK;
5. Azul Zulu/Prime;
6. BellSoft Liberica;
7. Microsoft Build of OpenJDK;
8. IBM Semeru/OpenJ9;
9. GraalVM.

Selection criteria:

```text
support policy
security patch cadence
container images
platform architecture
diagnostics
licensing
vendor support
FIPS/compliance needs
performance profile
internal certification
```

### 5.4 Platform Decision

Create a standard:

```text
Default: Eclipse Temurin Java 21 for new Kubernetes services.
Alternative: Amazon Corretto for AWS-integrated support requirements.
Legacy: certified vendor runtime required by app server.
Exception: ADR required.
```

---

## 6. Artifact Strategy

### 6.1 Standard Artifact Types

| Workload | Artifact |
|---|---|
| Spring Boot service | layered executable JAR |
| Plain Java service | executable JAR or distribution tar |
| App server service | WAR/EAR |
| Batch job | executable JAR/container image |
| Custom runtime | jlink image |
| Fast startup special case | native image |
| Desktop/internal app | jpackage |

### 6.2 Artifact Requirements

Every artifact should include:

1. version;
2. Git commit;
3. build timestamp;
4. build tool version if useful;
5. Java target version;
6. dependency metadata/SBOM;
7. checksum;
8. signature/provenance if required.

### 6.3 Artifact Repository

Use artifact repository:

```text
Maven repository for JAR/WAR/EAR
Container registry for images
Object storage/release repository for distribution bundles
```

Artifact retention policy:

```text
retain all production artifacts
retain rollback versions
retain evidence-linked artifacts
delete unpromoted snapshots after retention window
```

### 6.4 Artifact Anti-Patterns

Avoid:

1. `latest` in production;
2. rebuilding for production after UAT;
3. modifying artifact after build;
4. embedding production secrets;
5. bundling environment config inside JAR;
6. copying random dependency to server manually;
7. untracked hotfix JAR.

---

## 7. Container Image Strategy

### 7.1 Image Types

| Image Type | Use |
|---|---|
| JDK image | build/debug, not always runtime |
| JRE/runtime image | standard runtime |
| distroless | hardened minimal runtime |
| Alpine/musl | only if compatibility verified |
| Debian/Ubuntu slim | practical runtime with glibc |
| jlink image | custom runtime |
| native image | no JVM runtime |

### 7.2 Standard Java Image Requirements

```text
- non-root user
- immutable app directory
- writable /tmp or configured temp path
- CA certificates present
- timezone behavior defined
- no secrets baked in
- image labels with Git/build metadata
- ENTRYPOINT handles JVM options
- health endpoint available at runtime
- diagnostics strategy defined
```

### 7.3 Recommended Image Labeling

```dockerfile
LABEL org.opencontainers.image.title="case-service"
LABEL org.opencontainers.image.version="1.24.0"
LABEL org.opencontainers.image.revision="a1b2c3d4"
LABEL org.opencontainers.image.created="2026-06-18T12:00:00Z"
LABEL com.company.change-id="CRQ-123456"
LABEL com.company.release-id="REL-2026-06-18-001"
```

### 7.4 Dockerfile Standard Pattern

```dockerfile
FROM eclipse-temurin:21-jre-jammy

RUN groupadd -r app && useradd -r -g app app

WORKDIR /app

COPY --chown=app:app app.jar /app/app.jar

USER app

ENV JAVA_TOOL_OPTIONS=""

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

For Spring Boot layered JAR, use layer extraction or buildpack.

---

## 8. CI Build Plane

### 8.1 CI Responsibilities

CI must:

1. compile;
2. run unit tests;
3. run integration tests if available;
4. package artifact;
5. generate SBOM;
6. scan dependencies;
7. scan secrets;
8. run static analysis;
9. build image;
10. scan image;
11. sign artifact/image;
12. publish immutable artifact;
13. produce build evidence.

### 8.2 CI Output

Output should be release candidate metadata:

```json
{
  "service": "case-service",
  "version": "1.24.0",
  "gitCommit": "a1b2c3d4",
  "buildNumber": "8910",
  "javaVersion": "21",
  "artifact": "case-service-1.24.0.jar",
  "image": "registry.example.com/case-service@sha256:...",
  "sbom": "cyclonedx-case-service-1.24.0.json",
  "scanResult": "pass",
  "createdAt": "2026-06-18T12:00:00Z"
}
```

### 8.3 CI Gates

Recommended gates:

```text
[ ] tests pass
[ ] no critical SCA vulnerability without waiver
[ ] no secret scan finding
[ ] image scan pass
[ ] SBOM generated
[ ] artifact signed
[ ] image uses approved base
[ ] artifact version unique
[ ] no mutable latest production tag
```

### 8.4 Build Once Rule Enforcement

CI should prevent:

```text
same version rebuilt with different content
```

Use:

1. immutable repository;
2. version uniqueness;
3. checksums;
4. image digest;
5. provenance.

---

## 9. Release Control Plane

### 9.1 Release Candidate

A release candidate binds:

```text
source commit + artifact + config proposal + migration + runbook + evidence
```

Release candidate is not just a version number.

### 9.2 Release Metadata

```yaml
releaseId: REL-2026-06-18-001
service: case-service
version: 1.24.0
gitCommit: a1b2c3d4
imageDigest: sha256:...
javaRuntime: "21.0.x Temurin"
databaseMigrations:
  - V20260618_01__add_escalation_reason.sql
configChanges:
  - case.escalation.reason.enabled=false
riskLevel: high
rollback:
  previousVersion: 1.23.4
  dbRollbackRequired: false
```

### 9.3 Promotion Flow

```text
DEV → SIT → UAT → STAGING → PROD
```

Each promotion should verify:

1. same artifact;
2. environment config only changes;
3. tests appropriate for environment;
4. evidence stored;
5. approval if required.

### 9.4 Release Freeze and Calendar

The platform should support:

1. release calendar;
2. blackout/freeze periods;
3. emergency change process;
4. conflict detection between releases;
5. maintenance window assignment.

---

## 10. Deployment Execution Models

### 10.1 GitOps Model

Flow:

```text
CI builds artifact/image
  ↓
PR updates environment manifest with image digest/config version
  ↓
review/approval
  ↓
merge
  ↓
Argo CD/Flux syncs desired state
  ↓
health/sync status observed
```

Strengths:

1. desired state versioned;
2. PR review for deployment;
3. drift detection;
4. audit trail;
5. rollback via Git revert.

Risks:

1. DB migration side effects not automatically reverted;
2. secrets in Git risk;
3. auto-sync can surprise if not governed;
4. direct cluster change can bypass Git;
5. health status does not equal business correctness.

### 10.2 Pipeline Push Model

Flow:

```text
CI/CD pipeline deploys directly to target
```

Strengths:

1. straightforward;
2. good for VM/app server;
3. simpler for legacy;
4. easy approval gates.

Risks:

1. pipeline credentials powerful;
2. desired state may not be versioned;
3. drift harder to detect;
4. manual reruns can cause ambiguity.

### 10.3 Hybrid Model

Use GitOps for Kubernetes manifests, pipeline for:

1. app server deployment;
2. VM/systemd deployment;
3. DB migration;
4. external configuration API;
5. emergency rollback.

Hybrid is common in enterprises.

---

## 11. Kubernetes Platform Design

### 11.1 Namespace Strategy

Possible model:

```text
dev-case
sit-case
uat-case
prod-case
dr-case
```

or:

```text
case-dev
case-sit
case-uat
case-prod
```

Namespace should align with:

1. environment;
2. ownership;
3. RBAC;
4. network policy;
5. resource quota;
6. audit;
7. blast radius.

### 11.2 Standard Kubernetes Resources Per Service

```text
Deployment
Service
Ingress/HTTPRoute
ConfigMap
Secret reference
ServiceAccount
Role/RoleBinding if needed
HorizontalPodAutoscaler if needed
PodDisruptionBudget
NetworkPolicy
ServiceMonitor/PodMonitor if Prometheus
```

### 11.3 Deployment Template Requirements

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
  labels:
    app: case-service
    version: "1.24.0"
    change-id: "CRQ-123456"
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: case-service
  template:
    metadata:
      labels:
        app: case-service
        version: "1.24.0"
    spec:
      terminationGracePeriodSeconds: 60
      securityContext:
        runAsNonRoot: true
      containers:
        - name: case-service
          image: registry.example.com/case-service@sha256:...
          ports:
            - containerPort: 8080
          env:
            - name: JAVA_TOOL_OPTIONS
              valueFrom:
                configMapKeyRef:
                  name: case-service-jvm
                  key: java-tool-options
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 20
            timeoutSeconds: 2
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 10
            failureThreshold: 30
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              memory: "1536Mi"
```

### 11.4 Resource Model

Platform should define:

1. memory request/limit policy;
2. CPU request policy;
3. CPU limit policy;
4. HPA baseline;
5. JVM heap percentage standard;
6. native memory headroom;
7. thread stack consideration;
8. direct memory consideration.

Example:

```text
container memory = 1536Mi
max heap = 60–70%
native headroom = 30–40%
```

Never default:

```text
-Xmx == container limit
```

### 11.5 Probes

Standard:

```text
startupProbe protects slow startup
readinessProbe controls traffic
livenessProbe detects unrecoverable stuck runtime
```

Readiness must not be a fake always-up endpoint.

### 11.6 Shutdown

Standard:

```text
SIGTERM → readiness false/drain → finish in-flight → close pools → exit before grace
```

For Spring Boot:

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=45s
```

Kubernetes:

```yaml
terminationGracePeriodSeconds: 60
```

---

## 12. VM/systemd Platform Design

Not all Java deployment belongs to Kubernetes.

For VM/systemd:

### 12.1 Standard Layout

```text
/opt/<service>/
  releases/
    1.23.4/
      app.jar
    1.24.0/
      app.jar
  current -> releases/1.24.0
  config/
  logs/
  dumps/
  tmp/
```

### 12.2 systemd Unit

```ini
[Unit]
Description=Case Service
After=network.target

[Service]
User=case
Group=case
WorkingDirectory=/opt/case-service/current
EnvironmentFile=/etc/case-service/case-service.env
ExecStart=/usr/bin/java $JAVA_OPTS -jar /opt/case-service/current/app.jar
SuccessExitStatus=143
Restart=on-failure
RestartSec=10
TimeoutStopSec=60
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

### 12.3 VM Deployment Flow

```text
upload release
verify checksum
switch symlink
restart service
verify health
monitor logs/metrics
retain previous release
```

### 12.4 VM Governance

Need:

1. SSH access control;
2. sudo policy;
3. systemd logs;
4. artifact checksum;
5. deployment evidence;
6. rollback symlink;
7. logrotate;
8. OS patching;
9. file permission baseline.

---

## 13. Application Server Platform Design

For WAR/EAR:

### 13.1 Supported Server Matrix

```text
Tomcat / Jetty / Undertow for servlet apps
WildFly / Payara / Open Liberty for Jakarta EE
WebLogic / WebSphere for certified enterprise workloads
```

### 13.2 App Server Deployment Must Define

1. server version;
2. Java runtime version;
3. Jakarta/Java EE level;
4. artifact type;
5. context path;
6. datasource/JNDI;
7. JMS/resource adapter;
8. shared libraries;
9. classloader policy;
10. session clustering;
11. deployment order;
12. admin CLI;
13. rollback artifact;
14. log path;
15. diagnostic commands.

### 13.3 App Server Automation

Avoid manual console-only deployment.

Use:

1. CLI;
2. REST admin API;
3. domain deployment scripts;
4. pipeline;
5. evidence capture.

### 13.4 Legacy App Server Migration Path

```text
stabilize current deployment
→ externalize config
→ automate deployment
→ add version metadata
→ add health/smoke verification
→ reduce shared libraries
→ move to modern runtime if certified
→ containerize if appropriate
→ split or migrate later
```

Do not jump straight from fragile legacy app server to Kubernetes without stabilizing deployment contracts.

---

## 14. Configuration Platform

### 14.1 Config Taxonomy

| Config Type | Example | Source |
|---|---|---|
| environment identity | `prod`, `uat` | manifest/env |
| JVM config | heap, GC, dumps | ConfigMap/env |
| app config | timeout, endpoint | config file/ConfigMap |
| feature flag | feature enablement | flag system/config |
| secret | password, API key | secret manager |
| certificate | truststore/keystore | secret/cert manager |
| operational toggle | consumer enabled | runtime config |

### 14.2 Config Principles

1. config external to artifact;
2. config versioned;
3. secret separated;
4. config precedence documented;
5. startup validates required config;
6. unsafe defaults avoided;
7. config rollback defined;
8. evidence records config version, not secret value.

### 14.3 Config Delivery Options

```text
Kubernetes ConfigMap
Kubernetes Secret
Cloud Secret Manager
Vault
SSM Parameter Store
Spring Cloud Config
MicroProfile Config
App server config store
systemd EnvironmentFile
```

### 14.4 Config Drift Control

Use:

1. GitOps;
2. checksum annotation;
3. config version label;
4. environment diff;
5. periodic drift detection.

---

## 15. Secret and Certificate Platform

### 15.1 Secret Lifecycle

```text
create
→ store
→ deliver
→ use
→ rotate
→ revoke
→ audit
```

### 15.2 Secret Requirements

1. not in Git;
2. not in image;
3. not in logs;
4. access controlled;
5. rotation path;
6. dual-validity where possible;
7. expiry monitoring;
8. emergency rotation runbook.

### 15.3 Java-Specific Cert Handling

Java apps may need:

1. truststore;
2. keystore;
3. PKCS12/JKS/PEM conversion;
4. mTLS client certificate;
5. IdP signing cert;
6. OAuth/JWKS validation;
7. database TLS cert;
8. external API trust chain.

### 15.4 Platform Standard

```text
- use managed secret source as authority;
- deliver to workload via platform mechanism;
- do not expose raw values in CR/evidence;
- prefer restart-based reload unless live reload is tested;
- monitor expiry.
```

---

## 16. Database Migration Platform

### 16.1 Standard Tooling

Choose:

```text
Flyway or Liquibase
```

Do not rely on undocumented manual SQL in production.

### 16.2 Migration Pipeline Position

Options:

1. migration before app rollout;
2. migration as init job;
3. migration as separate controlled pipeline;
4. migration embedded in app startup.

For enterprise systems, prefer:

```text
separate controlled migration step for high-risk DB changes
```

because app startup should not unexpectedly execute long/high-risk DDL.

### 16.3 Migration Standard

```text
- every migration has ID
- every migration reviewed
- every migration tested
- every migration classified
- backward compatibility required for rolling deployment
- destructive migration separated
- migration evidence captured
```

### 16.4 Expand-Contract Platform Pattern

```text
Release N:
  expand schema

Release N+1:
  app writes/reads new shape

Release N+2:
  backfill / migrate consumers

Release N+3:
  contract/remove old shape
```

### 16.5 Migration Evidence

1. schema history row;
2. migration log;
3. duration;
4. validation query;
5. object existence;
6. row count/checksum if data migration;
7. invalid object check if Oracle;
8. lock issue report if any.

---

## 17. Observability Platform

### 17.1 Minimum Signals

For every production Java service:

```text
logs
metrics
traces where needed
health
version info
JVM telemetry
GC telemetry
diagnostic access
```

### 17.2 Standard Metrics

HTTP:

1. request rate;
2. error rate;
3. duration p95/p99;
4. status code;
5. endpoint route.

JVM:

1. heap used/max;
2. non-heap;
3. GC pause/count;
4. threads;
5. class loading;
6. direct buffer if available.

Infrastructure:

1. CPU usage;
2. CPU throttling;
3. RSS;
4. pod restarts;
5. network;
6. disk/tmp usage.

Dependencies:

1. DB pool active/idle/pending;
2. Redis latency/errors;
3. queue depth;
4. consumer lag/unacked;
5. external API error/latency.

Business:

1. case created;
2. case submitted;
3. workflow transition success/failure;
4. email generated;
5. payment/transaction status;
6. SLA breach count.

### 17.3 Version-Aware Observability

Deployment dashboard must show:

```text
version = 1.24.0
gitCommit = a1b2c3d4
imageDigest = sha256:...
environment = prod
```

Without version label, canary analysis is weak.

### 17.4 Diagnostics

Platform should define:

1. how to capture thread dump;
2. how to capture heap dump;
3. how to start JFR;
4. where files are stored;
5. access control;
6. redaction/PII handling;
7. retention.

### 17.5 OpenTelemetry

OpenTelemetry Java agent can instrument Java 8+ applications with low code change burden. Use it as standard where compatible.

---

## 18. Verification Platform

### 18.1 Verification Layers

```text
Layer 0: artifact exists and matches approved digest
Layer 1: deployment rollout completed
Layer 2: process/pod healthy
Layer 3: readiness/liveness OK
Layer 4: dependency health OK
Layer 5: smoke test OK
Layer 6: synthetic business workflow OK
Layer 7: metrics/logs stable
Layer 8: monitoring window complete
```

### 18.2 Smoke Test Platform

Smoke tests should be:

1. safe;
2. fast;
3. deterministic;
4. environment-aware;
5. non-destructive or controlled;
6. auditable;
7. runnable by pipeline.

### 18.3 Synthetic Business Checks

For case management system:

```text
login
→ search case
→ open details
→ perform allowed state transition on smoke record
→ verify audit trail
→ verify notification/correspondence if relevant
```

### 18.4 Metric Gates

Example:

```text
5xx < 0.5%
p95 latency < baseline + 20%
no CrashLoopBackOff
readiness stable
DB pool active < 80%
queue depth not growing abnormally
no critical new error signature
```

### 18.5 Automated Rollback

Use cautiously.

Automated rollback safe when:

1. failure signal is reliable;
2. rollback is app-only;
3. no irreversible DB/data change;
4. old version compatible;
5. false positives are low.

For high-risk DB/data/security changes, automated pause plus human decision may be better.

---

## 19. Release Strategy Platform

### 19.1 Standard Strategy by Risk

| Risk | Strategy |
|---|---|
| low stateless | rolling |
| medium | rolling + monitoring gate |
| high user-facing | canary |
| monolith high blast radius | blue-green or maintenance window |
| external integration | canary/ring |
| data migration | expand-contract + controlled rollout |
| batch/queue | drain + phased consumer enablement |

### 19.2 Traffic Control

Use one or more:

1. Kubernetes rolling update;
2. ingress/controller weights;
3. service mesh;
4. blue-green route switch;
5. feature flags;
6. tenant/ring routing;
7. queue consumer enablement.

### 19.3 Version Skew Policy

Every rolling deployment requires:

```text
old and new versions can coexist
```

Validate:

1. API compatibility;
2. DB compatibility;
3. event schema compatibility;
4. cache key compatibility;
5. session compatibility;
6. feature flag compatibility.

---

## 20. Rollback / Roll-Forward Platform

### 20.1 Rollback Scope

| Scope | Mechanism |
|---|---|
| artifact | previous image/JAR/WAR |
| config | previous ConfigMap/values |
| secret | previous secret if still valid |
| feature | disable flag |
| traffic | route back |
| DB | app-only rollback or forward fix |
| queue | pause/resume consumers |
| scheduler | disable/enable triggers |

### 20.2 Rollback Inventory

Platform must retain:

1. previous artifact;
2. previous image digest;
3. previous config;
4. previous manifest;
5. previous DB migration state;
6. rollback runbook.

### 20.3 Roll-Forward

Roll-forward required when:

1. DB/data state changed incompatibly;
2. old version cannot process new records;
3. security rotation cannot be undone;
4. emergency patch is faster/safer than revert.

Platform should support expedited hotfix pipeline.

---

## 21. Security Platform

### 21.1 Supply Chain

Required:

1. dependency scanning;
2. SBOM;
3. image scanning;
4. signing;
5. provenance;
6. base image governance;
7. vulnerability exception process.

### 21.2 Runtime Hardening

Required baseline:

```text
non-root
least privilege
read-only filesystem where feasible
drop capabilities
network policy
admin endpoint isolation
debug/JMX disabled or restricted
secrets not logged
actuator restricted
```

### 21.3 Access Control

Production deployment access:

1. individual identity;
2. RBAC;
3. environment approval;
4. break-glass process;
5. audit logs;
6. no shared admin account.

### 21.4 Policy as Code

Enforce:

1. no `latest` tag;
2. required resource requests/limits;
3. required readiness probe;
4. non-root;
5. signed image;
6. approved registry;
7. CR ID label/annotation;
8. restricted capabilities.

---

## 22. Governance Platform

### 22.1 CR Integration

CR should auto-populate from release metadata:

1. service;
2. version;
3. commit;
4. artifact;
5. image digest;
6. SBOM;
7. scan result;
8. migration list;
9. config diff;
10. rollout strategy;
11. rollback plan.

### 22.2 Risk Classification

Automate suggestion based on:

```text
DB migration present
security config present
external dependency changed
multi-service release
runtime upgrade
stateful workload
production environment
manual data script
```

Human can override with justification.

### 22.3 Evidence Capture

Pipeline should attach:

1. build result;
2. test result;
3. scan result;
4. deployment output;
5. health result;
6. smoke result;
7. monitoring gate result;
8. rollback result if any.

### 22.4 ADR and Checklist

Platform standards should link to ADRs:

1. runtime baseline ADR;
2. artifact ADR;
3. rollout ADR;
4. config/secrets ADR;
5. observability ADR;
6. DB migration ADR;
7. security baseline ADR;
8. production access ADR.

---

## 23. Multi-Environment Platform

### 23.1 Environment Purpose

| Environment | Purpose |
|---|---|
| DEV | fast feedback |
| SIT | integration |
| UAT | business validation |
| Staging | production-like rehearsal |
| PROD | live users |
| DR | continuity/failover |

### 23.2 Environment Parity

High parity required for:

1. Java runtime;
2. container base;
3. database version;
4. app server version;
5. identity provider behavior;
6. network routes;
7. config structure;
8. secrets mechanism;
9. monitoring.

Data volume may differ, but performance-sensitive tests need representative data.

### 23.3 Promotion Controls

```text
DEV can be flexible.
SIT validates integration.
UAT validates business behavior.
Staging validates deployment/runbook.
PROD requires evidence and approval.
DR requires failover rehearsal.
```

### 23.4 Drift Management

Detect drift in:

1. manifests;
2. config;
3. DB schema;
4. runtime version;
5. app server config;
6. secrets/certs;
7. network policy;
8. resource limits.

---

## 24. DR and Resilience Integration

Deployment platform must account for DR.

### 24.1 DR Questions

1. Are artifacts available in DR?
2. Are images replicated?
3. Are secrets available/rotatable in DR?
4. Are DB migrations replicated?
5. Is schema compatible?
6. Are config values DR-specific?
7. Are DNS/traffic switch procedures documented?
8. Are runbooks tested?
9. Are monitoring/alerts available in DR?
10. Is rollback possible after failover?

### 24.2 Active-Passive

Need:

1. deployment order primary/secondary;
2. replication lag awareness;
3. DR smoke test;
4. failover runbook.

### 24.3 Active-Active

Need:

1. data conflict strategy;
2. session strategy;
3. traffic routing;
4. schema migration compatibility across regions;
5. eventual consistency awareness.

---

## 25. Platform Operating Model

### 25.1 Roles

| Role | Responsibility |
|---|---|
| Application team | code, service runbook, smoke tests |
| Platform team | CI/CD, Kubernetes, base image, policy |
| Security team | scanning, secrets, hardening, exceptions |
| DBA | migration review, DB safety |
| QA | test evidence, UAT validation |
| Ops/SRE | monitoring, incident response |
| Change manager | CR/CAB coordination |
| Business owner | user impact and sign-off |

### 25.2 Service Ownership

Each service must define:

1. owner team;
2. escalation contact;
3. runbook;
4. dashboard;
5. SLO;
6. dependency map;
7. deployment model;
8. rollback model.

No orphan service in production.

### 25.3 Golden Path

Platform should provide a golden path:

```text
create service from template
→ includes Dockerfile
→ includes CI pipeline
→ includes Kubernetes manifests
→ includes probes
→ includes observability
→ includes security baseline
→ includes runbook template
→ includes ADR template
```

Exceptions require ADR.

---

## 26. Golden Path for New Spring Boot Service

### 26.1 Repository Layout

```text
case-service/
  src/
  build.gradle / pom.xml
  Dockerfile
  deploy/
    base/
    overlays/
      dev/
      sit/
      uat/
      prod/
  runbooks/
    deploy.md
    rollback.md
  docs/
    adr/
      0001-runtime.md
      0002-artifact.md
  .github/workflows/ or Jenkinsfile
```

### 26.2 Build

```text
compile
unit test
integration test
package layered JAR
generate SBOM
build image
scan image
sign image
publish digest
```

### 26.3 Deploy

```text
update manifest with digest
promote to DEV/SIT/UAT/PROD
run smoke
monitor
capture evidence
```

### 26.4 Runtime

```text
Java 21
non-root container
readiness/liveness/startup probes
graceful shutdown
OpenTelemetry agent
Actuator secured
resource sizing baseline
```

---

## 27. Golden Path for Legacy Java 8 WAR

### 27.1 Stabilization First

Before modernization:

1. identify Java/app server version;
2. document artifact deployment;
3. externalize config;
4. automate current deployment;
5. add version endpoint/log;
6. add smoke test;
7. document rollback;
8. document shared libraries;
9. document DB migration;
10. capture app server config.

### 27.2 Legacy Pipeline

```text
build WAR
run tests
scan dependencies
publish WAR
deploy to app server via CLI
verify context health
run smoke
capture app server evidence
```

### 27.3 Modernization Path

```text
manual → scripted
scripted → pipeline
pipeline → versioned config
versioned config → container/app server image
app server image → Kubernetes if appropriate
Java 8 → Java 17/21 when certified
```

Do not skip safety steps.

---

## 28. Platform Templates

### 28.1 Service Metadata Template

```yaml
service:
  name: case-service
  owner: case-team
  runtime:
    java: "21"
    vendor: "Temurin"
  artifact:
    type: "spring-boot-layered-jar"
  deployment:
    platform: "kubernetes"
    strategy: "rolling"
  database:
    migrationTool: "flyway"
  observability:
    dashboard: "..."
    logs: "..."
    traces: "..."
  runbooks:
    deploy: "runbooks/deploy.md"
    rollback: "runbooks/rollback.md"
  governance:
    riskDefault: "medium"
```

### 28.2 Release Manifest Template

```yaml
release:
  id: REL-2026-06-18-001
  service: case-service
  version: 1.24.0
  gitCommit: a1b2c3d4
  imageDigest: sha256:...
  javaVersion: "21"
  changeId: CRQ-123456
  migrations:
    - V20260618_01__add_escalation_reason.sql
  configVersion: prod-20260618-01
  rollout:
    strategy: canary
    steps:
      - 10
      - 50
      - 100
  verification:
    smoke: true
    synthetic: true
    monitoringWindow: 30m
```

---

## 29. End-to-End Deployment Flow

### 29.1 Normal Release

```text
1. Developer opens PR.
2. PR reviewed.
3. CI validates.
4. Artifact/image produced.
5. SBOM/scans/signature produced.
6. Release candidate created.
7. CR auto-populated.
8. Risk classified.
9. Approval obtained.
10. Manifest updated.
11. Deploy to UAT.
12. UAT smoke/business validation.
13. Promote same artifact to PROD.
14. Run pre-check.
15. Deploy using selected rollout.
16. Run smoke/synthetic.
17. Monitor metrics/logs/traces.
18. Capture evidence.
19. Close CR.
20. Update ADR/runbook if needed.
```

### 29.2 Emergency Release

```text
1. Incident/security issue identified.
2. Emergency change created.
3. Minimal approval obtained.
4. Fix built from controlled branch.
5. CI critical gates run.
6. Artifact signed/published.
7. Deploy with emergency runbook.
8. Verify.
9. Monitor.
10. Capture evidence.
11. Complete post-implementation review.
12. Add long-term corrective actions.
```

### 29.3 Failed Release

```text
1. Detection gate fails.
2. Pause rollout.
3. Capture diagnostics.
4. Decide rollback/roll-forward.
5. Execute recovery.
6. Verify recovery.
7. Communicate status.
8. Attach evidence.
9. RCA/PIR.
10. Improve platform control.
```

---

## 30. Capstone Case Study

### 30.1 Scenario

An enterprise regulatory case management platform includes:

1. `case-service` — Spring Boot Java 21 API on Kubernetes;
2. `notification-service` — Spring Boot Java 17 queue consumer;
3. `report-service` — Java 8 WAR on Tomcat VM;
4. Oracle database;
5. Redis;
6. RabbitMQ;
7. Keycloak;
8. external address API;
9. CI/CD pipeline;
10. UAT/PROD/DR environments.

We need to deploy a feature:

```text
Add escalation reason code to case escalation workflow.
```

Changes:

1. DB: add nullable column;
2. API: add response field;
3. UI: not covered here;
4. queue event: add optional field;
5. feature flag: disabled by default;
6. audit trail: add reason code;
7. report-service later consumes field.

### 30.2 Platform Design Response

#### DB Strategy

Use expand-contract.

Release 1:

```text
add nullable column ESCALATION_REASON_CODE
new app can write if flag enabled
old app ignores column
```

#### API Compatibility

Response field optional.

Consumers tolerate unknown field.

#### Event Compatibility

Add optional event field.

Do not rename existing fields.

#### Feature Flag

Default off.

Enable for smoke tenant first.

#### Rollout

Canary:

```text
10% → 50% → 100%
```

or ring:

```text
internal agency → pilot agency → all
```

#### Observability

Dashboard:

1. escalation API error rate;
2. DB pool;
3. RabbitMQ publish failure;
4. audit insert failure;
5. case transition failure;
6. latency by version;
7. logs for `escalationReason`.

#### Rollback

App rollback safe because DB migration additive.

Feature flag disable is first rollback.

If app rollback needed, keep DB column.

#### Governance

CR risk = high because enforcement workflow/audit behavior changes.

Approvals:

1. TL;
2. QA;
3. business owner;
4. DBA;
5. security if role/audit exposure changed.

Evidence:

1. migration result;
2. smoke workflow;
3. audit trail record;
4. version info;
5. monitoring window.

### 30.3 Deployment Sequence

```text
1. Apply DB additive migration.
2. Verify schema.
3. Deploy case-service canary.
4. Verify readiness.
5. Run smoke case transition with flag off.
6. Enable flag for smoke tenant.
7. Run synthetic escalation workflow.
8. Check audit trail.
9. Promote canary.
10. Monitor.
11. Close CR if stable.
```

### 30.4 Failure Branches

If migration fails:

```text
stop deployment, old app remains running
```

If new app fails startup:

```text
rollback app; DB column remains
```

If escalation workflow wrong:

```text
disable feature flag; investigate
```

If audit trail missing:

```text
disable feature flag; do not proceed to full rollout
```

If DB pool saturates:

```text
pause canary; inspect SQL/index/connection pool
```

---

## 31. Maturity Model

### Level 0 — Manual and Tribal

Characteristics:

1. manual deploy;
2. no clear artifact identity;
3. no rollback test;
4. logs only;
5. no CR evidence;
6. hero engineer required.

### Level 1 — Scripted

1. deployment scripts;
2. basic artifact repo;
3. manual approval;
4. simple smoke test;
5. partial rollback.

### Level 2 — Standardized

1. standard Dockerfile;
2. CI pipeline;
3. health checks;
4. basic monitoring;
5. runbook;
6. config externalized.

### Level 3 — Controlled

1. immutable artifacts;
2. scans/SBOM;
3. approval gates;
4. environment promotion;
5. rollback defined;
6. evidence attached.

### Level 4 — Progressive

1. canary/blue-green;
2. metric gates;
3. GitOps;
4. policy as code;
5. strong observability;
6. automated evidence.

### Level 5 — Self-Improving

1. incident feedback updates ADR/checklists;
2. automated risk classification;
3. platform golden path;
4. safe emergency release;
5. reliable DR rehearsal;
6. continuous governance improvement.

---

## 32. Platform Anti-Patterns

### 32.1 Kubernetes as a Silver Bullet

Moving Java app to Kubernetes without:

1. readiness;
2. graceful shutdown;
3. resource sizing;
4. logs/metrics;
5. config/secrets;
6. rollback;
7. probes;
8. DB migration safety

just moves fragility into Kubernetes.

### 32.2 CI/CD Without Release Control

A pipeline that can deploy anything quickly without:

1. artifact identity;
2. approval;
3. evidence;
4. rollback;
5. verification

is an outage accelerator.

### 32.3 Observability Afterthought

If dashboard is built after incident, platform is immature.

### 32.4 Security as End-of-Pipeline Blocker

Security should be integrated early:

1. base image;
2. dependencies;
3. secrets;
4. policy;
5. RBAC;
6. runtime hardening.

### 32.5 One Deployment Model for Everything

Do not force:

1. legacy WAR;
2. queue consumer;
3. batch job;
4. stateless API;
5. stateful monolith

into identical deployment flow.

### 32.6 Rollback Theater

A rollback plan that ignores DB/data/config is not real.

### 32.7 Evidence by Screenshot Only

Screenshots help, but machine-readable logs/metadata are better.

---

## 33. Design Review Questions

When reviewing a Java deployment platform, ask:

```text
[ ] Can we prove exactly what version is running?
[ ] Can we deploy the same artifact across environments?
[ ] Can we rollback app-only quickly?
[ ] Do we know when app rollback is unsafe?
[ ] Are DB migrations backward-compatible?
[ ] Are secrets rotatable?
[ ] Are certificates monitored for expiry?
[ ] Are probes accurate?
[ ] Does graceful shutdown work?
[ ] Are resources sized based on heap/native/thread model?
[ ] Can we see logs/metrics/traces by version?
[ ] Can we capture JVM diagnostics safely?
[ ] Are production deployments auditable?
[ ] Are emergency changes controlled?
[ ] Is there a golden path for new services?
[ ] Are legacy systems included in the platform strategy?
[ ] Do incidents feed back into ADR/checklists?
```

If the answer is mostly “yes”, the platform is mature.

---

## 34. Implementation Roadmap

### Phase 1 — Inventory

```text
- list services
- list Java versions
- list artifact types
- list deployment platforms
- list owners
- list DB dependencies
- list secrets/certs
- list runbooks
- list dashboards
```

### Phase 2 — Stabilize

```text
- add artifact identity
- add version metadata
- add basic health endpoint
- externalize config
- define rollback artifacts
- write basic runbooks
```

### Phase 3 — Standardize

```text
- standard Dockerfiles
- standard JVM flags
- standard Kubernetes templates
- standard systemd/app server scripts
- standard CI pipeline
- standard evidence
```

### Phase 4 — Secure

```text
- SBOM
- scans
- signatures
- secret management
- non-root
- NetworkPolicy
- admin endpoint protection
```

### Phase 5 — Observe

```text
- structured logs
- metrics
- traces
- JVM telemetry
- dashboards
- alerts
- synthetic checks
```

### Phase 6 — Control

```text
- CR integration
- approval gates
- policy as code
- GitOps
- immutable deployment
- environment promotion
```

### Phase 7 — Optimize

```text
- canary
- metric gates
- automated rollback where safe
- risk classification
- DR rehearsal
- platform scorecards
```

---

## 35. Platform Scorecard

Use this quarterly.

```text
Runtime
[ ] Java runtime matrix exists.
[ ] Unsupported runtimes identified.
[ ] Runtime upgrade path exists.

Artifact
[ ] Production artifacts immutable.
[ ] Image digests used.
[ ] SBOM generated.

CI/CD
[ ] Build once promote many.
[ ] Tests/scans required.
[ ] Deployment evidence captured.

Config/Secrets
[ ] Config externalized.
[ ] Secrets not in Git/image/logs.
[ ] Rotation runbook exists.

Deployment
[ ] Standard rollout strategy.
[ ] Probes configured.
[ ] Graceful shutdown tested.
[ ] Rollback tested.

Database
[ ] Migration tool used.
[ ] Expand-contract standard.
[ ] Migration evidence captured.

Observability
[ ] Logs/metrics/traces.
[ ] Version visible.
[ ] Dashboard per service.
[ ] JVM diagnostics path.

Security
[ ] Non-root baseline.
[ ] Admin endpoints restricted.
[ ] Policy as code.

Governance
[ ] CR linked to release.
[ ] Approvals risk-based.
[ ] Evidence attached.
[ ] Emergency process exists.

Learning
[ ] RCA action items tracked.
[ ] ADR/checklists updated.
[ ] Runbooks tested.
```

---

## 36. Top 1% Perspective

Most engineers can deploy an app.

Strong engineers can deploy reliably.

Top-tier engineers design systems where deployment reliability is not dependent on luck, memory, or heroics.

They think in layers:

```text
artifact integrity
runtime contract
environment contract
traffic safety
state safety
data compatibility
observability
rollback feasibility
governance
learning
```

They do not ask only:

```text
How do I deploy this?
```

They ask:

```text
What can go wrong during deployment?
How will we detect it?
How will we recover?
How will we prove what happened?
How will the next engineer understand this decision?
How will the platform prevent this class of mistake next time?
```

That is the difference between deploying software and engineering deployment systems.

---

## 37. Summary

A production-grade Java deployment platform is a coordinated system consisting of:

1. runtime standards;
2. artifact standards;
3. CI/CD build and release controls;
4. deployment execution model;
5. Kubernetes/VM/app server runtime patterns;
6. config and secret delivery;
7. database migration safety;
8. rollout and traffic control;
9. observability and verification;
10. rollback and roll-forward design;
11. security hardening;
12. governance and evidence;
13. runbooks, ADRs, and checklists;
14. incident learning.

The core capstone mental model:

> Java deployment platform is not a pipeline.  
> It is an operating system for safe change.

A platform is mature when it makes the safe path the easy path, the risky path visible, and the emergency path controlled.

---

## 38. References

- Kubernetes Documentation — Production environment: https://kubernetes.io/docs/setup/production-environment/
- Kubernetes Documentation — Deployments: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/
- Kubernetes Documentation — ConfigMaps: https://kubernetes.io/docs/concepts/configuration/configmap/
- Kubernetes Documentation — Secrets: https://kubernetes.io/docs/concepts/configuration/secret/
- Spring Boot Documentation — Graceful Shutdown: https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html
- Spring Boot Documentation — Actuator / Production-ready Features: https://docs.spring.io/spring-boot/reference/actuator/index.html
- OpenTelemetry Documentation — Java Agent: https://opentelemetry.io/docs/zero-code/java/agent/
- Argo CD Documentation — Declarative GitOps CD for Kubernetes: https://argo-cd.readthedocs.io/en/stable/
- Argo CD Documentation — Automated Sync Policy: https://argo-cd.readthedocs.io/en/latest/user-guide/auto_sync/
- NIST Secure Software Development Framework SP 800-218: https://csrc.nist.gov/pubs/sp/800/218/final
- OpenSSF SLSA: https://slsa.dev/
- CycloneDX SBOM Standard: https://cyclonedx.org/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 33 — Deployment Architecture Decision Records and Checklists](./learn-java-deployment-runtime-release-delivery-engineering-part-33-deployment-architecture-decision-records-and-checklists.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 35 — Final Mastery Review: Top 1% Java Deployment Engineer Mindset](./learn-java-deployment-runtime-release-delivery-engineering-part-35-final-mastery-review.md)
