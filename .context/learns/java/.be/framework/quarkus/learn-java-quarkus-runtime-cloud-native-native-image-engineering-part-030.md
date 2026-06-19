# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-030
# Kubernetes and Container Engineering: Image Build, Probes, ConfigMap, Secret, Service Binding

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Part: `030`  
> Topik: Kubernetes and Container Engineering: Image Build, Probes, ConfigMap, Secret, Service Binding  
> Status: Materi lanjutan advance — setelah native image compatibility  
> Target: Software engineer yang mampu mendesain deployment Quarkus ke container/Kubernetes secara production-grade, bukan sekadar “app bisa jalan di cluster”

---

## 0. Ringkasan Besar

Banyak engineer menganggap deployment Quarkus ke Kubernetes cukup dengan:

```bash
docker build
kubectl apply
```

Atau:

```bash
./mvnw package -Dquarkus.kubernetes.deploy=true
```

Namun production deployment bukan hanya “pod running”.

Production deployment harus menjawab:

1. Image dibangun dengan cara apa?
2. Image berisi JVM app atau native executable?
3. Base image aman dan sesuai?
4. User container non-root?
5. Config masuk dari mana?
6. Secret dikelola bagaimana?
7. Build-time config dan runtime config dibedakan?
8. Liveness/readiness/startup probe benar?
9. Resource request/limit benar?
10. Graceful shutdown bekerja?
11. Rolling update aman?
12. Pod menerima traffic hanya saat benar-benar ready?
13. Deployment bisa rollback?
14. Observability tersedia?
15. Service binding dan dependency discovery jelas?
16. External dependency failure tidak menyebabkan restart storm?
17. Autoscaling tidak membuat dependency collapse?
18. Manifest generated atau hand-written?
19. Environment-specific overlay dikelola bagaimana?
20. Apa bukti deployment ready untuk production?

Part ini membahas Kubernetes/container engineering untuk Quarkus sebagai sistem operasional.

---

## 1. Mental Model: Container Image Adalah Runtime Contract

Container image bukan sekadar packaging.

Container image adalah contract:

```text
Application binary
+ runtime OS/libraries
+ user/permission model
+ exposed ports
+ entrypoint
+ config expectations
+ filesystem assumptions
+ certificate/timezone/font availability
+ JVM/native runtime behavior
```

Kubernetes manifest juga contract:

```text
How many pods?
What config?
What secrets?
What health checks?
What resource budget?
What lifecycle behavior?
How traffic reaches app?
How rollout happens?
```

Deployment bug sering bukan code bug, tetapi contract mismatch:

```text
App expects cert file, image does not contain CA.
App expects env var, Secret key name different.
Liveness checks DB, DB down causes restart storm.
Readiness says ready before migration/cache warmup complete.
CPU limit too low, app throttled.
Memory limit too low, pod OOMKilled.
Native image starts fast, all pods hit DB at once.
Graceful shutdown too short, requests cut.
```

---

## 2. Quarkus Kubernetes and Container Ecosystem

Quarkus provides:

1. **Container image extensions**
   - Jib,
   - Docker,
   - Podman,
   - OpenShift,
   - Buildpack.

2. **Kubernetes extension**
   - generate Kubernetes resources,
   - configure deployment, service, probes, env, labels,
   - integrate with container image extensions.

3. **Kubernetes Config extension**
   - read ConfigMaps and Secrets as configuration sources without manually mounting them into the pod.

4. **SmallRye Health**
   - liveness/readiness/startup health endpoints.

5. **Service Binding**
   - integrate bound services into configuration model.

6. **Kubernetes/OpenShift deployment guides**
   - generate manifests,
   - deploy to cluster,
   - pass configuration.

Quarkus container image guide states Quarkus provides extensions for building and pushing container images, currently supporting Jib, Docker, Podman, OpenShift, and Buildpack. Quarkus Kubernetes guide explains deployment resource generation and configuration. Kubernetes Config guide explains the `kubernetes-config` extension can use ConfigMaps and Secrets as configuration sources without mounting them into the pod.

---

## 3. Deployment Strategy Choices

You have several deployment workflows.

### 3.1 Hand-Written Dockerfile + YAML

```text
Write Dockerfile manually.
Write Deployment/Service YAML manually.
Use Helm/Kustomize/GitOps.
```

Pros:

- full control,
- familiar to platform teams,
- easy to integrate with enterprise standards,
- good for complex production deployment.

Cons:

- more boilerplate,
- drift risk,
- app metadata duplicated,
- developers need Kubernetes knowledge.

### 3.2 Quarkus Generated Kubernetes Resources

```text
Add quarkus-kubernetes.
Configure application.properties.
Build generates Kubernetes YAML.
```

Pros:

- fast start,
- metadata close to app,
- consistent defaults,
- integrated probes/container image.

Cons:

- generated manifest may need overlay,
- complex org standards may still need Helm/Kustomize,
- developers must understand generated output.

### 3.3 Helm/Kustomize/GitOps

Common production approach:

```text
Quarkus builds image.
Manifests managed by Helm/Kustomize/ArgoCD/Flux.
```

Pros:

- environment overlays,
- GitOps audit,
- platform governance,
- release/rollback controls.

Cons:

- more moving parts,
- app config and infra config split,
- drift if not managed.

### 3.4 Decision

For learning and small teams:

```text
Quarkus Kubernetes extension is excellent.
```

For regulated enterprise:

```text
Use Quarkus generation where useful,
but final production deployment often goes through GitOps/Helm/Kustomize/platform pipeline.
```

---

## 4. JVM Image vs Native Image

### 4.1 JVM Container Image

Contains:

```text
JDK/JRE runtime
application jar
dependencies
entrypoint java -jar /app/quarkus-run.jar
```

Pros:

- broad compatibility,
- easier debugging/profiling,
- JIT throughput,
- faster build,
- mature runtime tooling.

Cons:

- slower startup,
- higher memory,
- larger image.

### 4.2 Native Container Image

Contains:

```text
native executable
minimal runtime OS libs
entrypoint ./application
```

Pros:

- faster startup,
- lower memory often,
- small image possible,
- good for scale-to-zero/serverless.

Cons:

- slower build,
- native compatibility constraints,
- debugging/profiling different,
- sometimes lower peak throughput,
- container OS assets still matter.

### 4.3 Deployment Implication

Kubernetes config differs:

| Dimension | JVM | Native |
|---|---|---|
| startupProbe | often needed for slow boot | may be shorter, but warmup still matters |
| memory request | higher | often lower |
| CPU startup | JVM warmup/JIT | native build ahead-of-time |
| debugging | jcmd/jfr/thread dump | more limited |
| image base | JRE/JDK | minimal/native runtime |
| readiness | after app init | after app init, not just fast process start |
| scale-out | slower | faster, but dependency burst risk |

---

## 5. Container Image Build Options

Quarkus container image guide lists supported image build extensions:

- Jib,
- Docker,
- Podman,
- OpenShift,
- Buildpack.

### 5.1 Jib

Builds container image without Docker daemon.

Good for:

- CI without Docker daemon,
- reproducible Java layering,
- JVM app images,
- simple pipelines.

Add:

```bash
./mvnw quarkus:add-extension -Dextensions="container-image-jib"
```

Build:

```bash
./mvnw package -Dquarkus.container-image.build=true
```

### 5.2 Docker

Uses Dockerfile / Docker daemon.

Good for:

- full Dockerfile control,
- native image container packaging,
- enterprise base image customization,
- custom OS packages.

Add:

```bash
./mvnw quarkus:add-extension -Dextensions="container-image-docker"
```

Build:

```bash
./mvnw package -Dquarkus.container-image.build=true
```

### 5.3 Podman

Similar to Docker but daemonless/rootless-friendly.

Good for:

- Red Hat/OpenShift ecosystems,
- rootless builds,
- local Linux environments.

### 5.4 Buildpack

Uses Cloud Native Buildpacks.

Good for:

- standardized buildpacks,
- platform-managed builds,
- less custom Dockerfile.

### 5.5 OpenShift

Uses OpenShift build features.

Good for:

- OpenShift-native environments,
- S2I/build configs.

---

## 6. Container Image Configuration

Common properties:

```properties
quarkus.container-image.group=my-org
quarkus.container-image.name=application-service
quarkus.container-image.tag=1.0.0
quarkus.container-image.registry=registry.example.com
quarkus.container-image.build=true
quarkus.container-image.push=false
```

In CI:

```properties
quarkus.container-image.tag=${GIT_COMMIT_SHA}
```

Do not only tag `latest`.

Recommended tags:

```text
semantic version
git SHA
build number
environment promotion tag
```

Example:

```text
registry.example.com/aceas/application-service:1.4.2
registry.example.com/aceas/application-service:git-a1b2c3d
```

Production deployment should pin immutable image digest/tag.

---

## 7. Dockerfile for JVM Mode

Quarkus generated project often includes Dockerfiles.

Conceptual JVM Dockerfile:

```dockerfile
FROM eclipse-temurin:21-jre

WORKDIR /work/
COPY target/quarkus-app/lib/ /work/lib/
COPY target/quarkus-app/*.jar /work/
COPY target/quarkus-app/app/ /work/app/
COPY target/quarkus-app/quarkus/ /work/quarkus/

EXPOSE 8080
USER 1001

ENTRYPOINT ["java", "-jar", "/work/quarkus-run.jar"]
```

Production considerations:

- use trusted base image,
- non-root user,
- minimal packages,
- CA certificates,
- timezone if needed,
- JVM flags via env,
- writable dirs only where needed,
- no secrets baked into image,
- SBOM/scanning,
- image signing.

---

## 8. Dockerfile for Native Mode

Conceptual native Dockerfile:

```dockerfile
FROM registry.access.redhat.com/ubi9/ubi-minimal

WORKDIR /work/
COPY target/*-runner /work/application

RUN chmod 775 /work/application
EXPOSE 8080
USER 1001

ENTRYPOINT ["/work/application"]
```

Consider:

- CA certs,
- glibc/musl compatibility,
- timezone,
- fonts,
- truststore,
- native libs,
- permissions,
- writable `/tmp`,
- health endpoint port.

Native binary can still need OS assets.

---

## 9. Image Security

Production image requirements:

- non-root user,
- minimal base image,
- no shell if not needed,
- no build tools,
- no secrets,
- patched base image,
- vulnerability scan,
- SBOM,
- image signing,
- immutable tag/digest,
- least privilege file permissions,
- read-only root filesystem where possible,
- drop Linux capabilities where possible.

Kubernetes securityContext:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL
```

If read-only root FS is enabled, ensure app writes only to allowed volume like `/tmp`.

---

## 10. Quarkus Kubernetes Extension

Add:

```bash
./mvnw quarkus:add-extension -Dextensions="kubernetes"
```

Build manifests:

```bash
./mvnw package
```

Generated resources typically go under:

```text
target/kubernetes/
```

Deploy directly:

```bash
./mvnw package -Dquarkus.kubernetes.deploy=true
```

Use direct deploy carefully. In enterprise production, prefer CI/GitOps controlled deployment.

### 10.1 Basic Kubernetes Config

```properties
quarkus.kubernetes.name=application-service
quarkus.kubernetes.namespace=aceas-dev
quarkus.kubernetes.replicas=2
```

Generated objects can include:

- Deployment,
- Service,
- ConfigMap/Secret references,
- probes,
- labels/annotations.

Always inspect generated YAML.

---

## 11. Generated YAML Is Not Magic

Quarkus can generate Kubernetes resources, but you remain responsible for:

- resource requests/limits,
- security context,
- probes,
- secrets,
- config,
- labels/annotations,
- service account,
- network policies,
- ingress/route,
- HPA,
- PDB,
- rollout strategy,
- topology spread,
- anti-affinity,
- observability annotations.

Rule:

```text
Generated manifest is a starting point, not a production exemption.
```

---

## 12. ConfigMap and Secret: Basic Kubernetes Model

### 12.1 ConfigMap

ConfigMap stores non-sensitive config.

Examples:

```text
feature flags
endpoint URLs
log levels
batch sizes
timeouts
cache TTL
scheduler cron
```

### 12.2 Secret

Secret stores sensitive config.

Examples:

```text
DB password
client secret
API key
TLS key
token signing secret
keystore password
```

Do not store secrets in ConfigMap.

Do not bake secrets into image.

Do not commit Kubernetes Secret plaintext to Git.

Use external secret manager if possible:

- AWS Secrets Manager,
- AWS SSM Parameter Store,
- Vault,
- External Secrets Operator,
- Sealed Secrets,
- cloud provider secret integration.

---

## 13. Quarkus Configuration Sources in Kubernetes

Quarkus config comes from SmallRye Config.

Common sources:

- application.properties packaged in image,
- environment variables,
- system properties,
- mounted files,
- Kubernetes ConfigMap/Secret via env,
- Kubernetes Config extension,
- external config/secrets.

Quarkus Kubernetes Config extension allows using ConfigMaps and Secrets as configuration sources without mounting them into the pod or modifying Deployment.

Add:

```bash
./mvnw quarkus:add-extension -Dextensions="kubernetes-config"
```

Conceptual config:

```properties
quarkus.kubernetes-config.enabled=true
quarkus.kubernetes-config.config-maps=application-config
quarkus.kubernetes-config.secrets=application-secret
```

Permissions are needed because the application reads Kubernetes API.

Implication:

```text
The pod ServiceAccount must be allowed to read those ConfigMaps/Secrets.
```

This has security implications.

---

## 14. ConfigMap/Secret via Environment Variables

Simple pattern:

```yaml
env:
  - name: EXTERNAL_API_URL
    valueFrom:
      configMapKeyRef:
        name: application-config
        key: external-api-url

  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: application-secret
        key: db-password
```

Quarkus property mapping supports environment variables.

Example:

```properties
external.api.url=${EXTERNAL_API_URL}
db.password=${DB_PASSWORD}
```

Pros:

- simple,
- transparent,
- no Kubernetes API read permission required by app.

Cons:

- env var values visible to process env,
- update requires pod restart,
- many env vars can be messy.

---

## 15. ConfigMap/Secret via Mounted Files

Pattern:

```yaml
volumeMounts:
  - name: app-config
    mountPath: /deployments/config
    readOnly: true

volumes:
  - name: app-config
    configMap:
      name: application-config
```

Quarkus can read config from locations with `SMALLRYE_CONFIG_LOCATIONS`.

Quarkus Kubernetes guide notes that passing config from external locations usually requires setting env/system property; when using config map/secret as application configuration, you define volume, mount it, and set `SMALLRYE_CONFIG_LOCATIONS`.

Pros:

- can mount config files,
- secret files can be rotated by platform,
- useful for truststores/certs.

Cons:

- path management,
- app reload behavior not automatic unless designed,
- file permission issues.

---

## 16. Kubernetes Config Extension vs Env/Mount

Decision:

| Approach | Pros | Cons |
|---|---|---|
| Env vars | simple, common | restart required, env exposure |
| Mounted files | good for certs/files | path/permission management |
| Kubernetes Config extension | no mount/env wiring for config source | app needs K8s API permission |
| External secret operator | GitOps friendly | platform dependency |
| Service Binding | standardized binding files | requires binding support |

Rule:

```text
Use the simplest config path that meets security and operational requirements.
```

For secrets, prefer platform secret manager integration.

---

## 17. Build-Time vs Runtime Config in Deployment

Quarkus has build-time and runtime configuration.

Deployment must respect that.

Bad:

```text
Build native once with build-time config A.
Deploy expecting build-time config B via env.
```

May not work.

Examples of runtime config:

- datasource URL,
- passwords,
- external URLs,
- log levels,
- timeouts,
- feature flags if runtime.

Examples of build-time-ish config:

- package type,
- enabled extensions,
- native resources,
- some framework behavior,
- certain optimization decisions.

Document:

```text
This image is built with build-time config X.
This deployment supplies runtime config Y.
```

---

## 18. Service Binding

Service Binding provides a way for services to expose connection information to applications using a standard binding format, often mounted as files.

Use cases:

- database binding,
- messaging broker binding,
- cache binding,
- service credentials.

Quarkus service binding support lets applications consume binding data and map it into configuration for supported services.

Benefits:

- decouples app from secret/config key names,
- platform can bind service to app,
- standardizes connection info.

Considerations:

- platform support,
- binding format,
- security,
- rotation behavior,
- debugging,
- local dev equivalent.

---

## 19. Probes: Liveness, Readiness, Startup

From Part 025:

- liveness: should restart container?
- readiness: should receive traffic?
- startup: has startup completed?

Quarkus SmallRye Health exposes endpoints such as:

```text
/q/health/live
/q/health/ready
/q/health/started
```

Add:

```bash
./mvnw quarkus:add-extension -Dextensions="smallrye-health"
```

Kubernetes probes should call these.

### 19.1 Liveness

Should be process-local.

Do not fail because DB or external API is down.

### 19.2 Readiness

Should indicate whether pod can serve traffic.

May include critical dependencies, but not optional ones.

### 19.3 Startup

Useful when app needs longer initialization.

Prevents liveness from killing pod before it starts.

---

## 20. Probe Tuning

Example:

```yaml
livenessProbe:
  httpGet:
    path: /q/health/live
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /q/health/ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3

startupProbe:
  httpGet:
    path: /q/health/started
    port: 8080
  periodSeconds: 5
  failureThreshold: 30
```

Tuning considerations:

- JVM startup time,
- native startup time,
- migration/warmup,
- dependency latency,
- expected cold start,
- node CPU pressure,
- pod scheduling delay.

Anti-pattern:

```text
timeoutSeconds too low,
failureThreshold too low,
liveness checks dependency,
startupProbe absent for slow app,
readiness returns UP before app ready.
```

---

## 21. Resource Requests and Limits

Kubernetes scheduler uses requests.

Limits enforce maximum.

Example:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "1Gi"
```

### 21.1 CPU

If CPU limit too low:

- JVM startup slower,
- native app can still be throttled,
- p99 latency increases,
- GC slower,
- event loop delayed,
- liveness/readiness timeouts possible.

### 21.2 Memory

If memory limit too low:

- JVM OOM,
- native process killed,
- direct memory pressure,
- cache OOM,
- container OOMKilled.

### 21.3 JVM Memory in Container

For JVM mode:

- set memory ergonomics,
- consider heap vs non-heap/direct/metaspace/thread stacks,
- avoid heap = full container memory.

Example JVM env:

```yaml
env:
  - name: JAVA_OPTS_APPEND
    value: "-XX:MaxRAMPercentage=70 -XX:+ExitOnOutOfMemoryError"
```

Actual flags depend on base image/entrypoint.

### 21.4 Native Memory

Native RSS includes:

- executable,
- heap,
- stacks,
- native allocations,
- TLS/native libs,
- buffers.

Still monitor RSS.

Native does not mean unlimited safety.

---

## 22. Graceful Shutdown

Kubernetes sends SIGTERM, then waits `terminationGracePeriodSeconds`.

App should:

1. stop accepting new requests,
2. fail readiness quickly,
3. finish in-flight requests,
4. stop consumers/jobs safely,
5. flush telemetry/logs,
6. close connections,
7. exit before grace period.

Quarkus supports graceful shutdown behavior via configuration/lifecycle hooks.

Kubernetes config:

```yaml
terminationGracePeriodSeconds: 30
```

Readiness during termination:

```text
Pod should be removed from service before process exits.
```

PreStop hook sometimes used:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 5"]
```

Use carefully; not a substitute for proper shutdown.

---

## 23. Rolling Update Strategy

Deployment rolling update:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

Consider:

- readiness gate,
- startup time,
- DB migration compatibility,
- old/new version compatibility,
- event schema compatibility,
- cache key versioning,
- sticky sessions if any,
- graceful shutdown,
- HPA interactions.

Rule:

```text
Old and new version must coexist during rolling deployment.
```

This affects:

- database migrations,
- REST contracts,
- event contracts,
- cache values,
- config keys,
- feature flags.

---

## 24. Deployment and Database Migration

Dangerous:

```text
App startup automatically runs destructive migration.
Rolling update starts multiple pods.
Each pod attempts migration.
```

Better patterns:

1. dedicated migration job before deployment,
2. backward-compatible expand/contract migrations,
3. leader-only migration if safe,
4. migration controlled by pipeline,
5. app startup validates schema only.

Expand/contract:

```text
Release N:
  add nullable column / new table
  app writes old+new if needed

Release N+1:
  backfill
  switch reads

Release N+2:
  drop old column
```

For zero-downtime, migrations must be compatible with old and new app versions.

---

## 25. Environment Variables and Quarkus Config Mapping

Use ConfigMapping:

```java
import io.smallrye.config.ConfigMapping;
import java.time.Duration;

@ConfigMapping(prefix = "external.identity")
public interface IdentityConfig {
    String baseUrl();
    Duration timeout();
}
```

`application.properties`:

```properties
external.identity.base-url=${EXTERNAL_IDENTITY_BASE_URL}
external.identity.timeout=${EXTERNAL_IDENTITY_TIMEOUT:PT1S}
```

Kubernetes:

```yaml
env:
  - name: EXTERNAL_IDENTITY_BASE_URL
    valueFrom:
      configMapKeyRef:
        name: application-config
        key: external-identity-base-url
```

This gives:

- typed config,
- defaults,
- validation,
- explicit dependency.

---

## 26. Secret Handling

Rules:

```text
No secrets in image.
No secrets in Git plaintext.
No secrets in logs.
No secrets in ConfigMap.
No secrets in command line if avoidable.
No production secrets during build.
```

Kubernetes Secret basic use:

```yaml
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: db-secret
        key: password
```

Quarkus:

```properties
quarkus.datasource.password=${DB_PASSWORD}
```

Better enterprise pattern:

- External Secrets Operator,
- Vault Agent,
- cloud secret manager,
- CSI secret store,
- sealed/encrypted secrets.

Secret rotation:

- does app need restart?
- can connection pool pick new password?
- token refresh?
- cert reload?
- rollout automation?

---

## 27. ServiceAccount and RBAC

If app only needs normal runtime:

```text
No Kubernetes API permissions needed.
```

If using Kubernetes Config extension or Kubernetes client:

- app may need permission to read ConfigMaps/Secrets,
- use least privilege Role/RoleBinding,
- restrict namespace,
- restrict resource names if possible.

Example:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: application-config-reader
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["application-config"]
    verbs: ["get"]
```

Secrets permission is sensitive.

Grant carefully.

---

## 28. Network and Service Discovery

Kubernetes Service gives stable DNS:

```text
http://identity-service.namespace.svc.cluster.local
```

Quarkus config:

```properties
external.identity.base-url=http://identity-service:8080
```

Consider:

- service name,
- namespace,
- port,
- DNS caching,
- timeout,
- retry,
- circuit breaker,
- mTLS/service mesh,
- network policy.

Do not hardcode cluster-specific FQDN if environment differs.

Use config.

---

## 29. Service Mesh Considerations

If using Istio/Linkerd/Envoy:

- sidecar readiness,
- mTLS,
- retries/timeouts at mesh layer,
- app retries + mesh retries can multiply,
- probe rewriting,
- telemetry duplication,
- graceful shutdown order,
- outbound policy,
- certificates.

Rule:

```text
Coordinate app-level resilience with mesh-level resilience.
```

Do not configure:

```text
app retry 3x + mesh retry 3x
```

This can create 9 attempts.

---

## 30. Config and Secret Reload

Kubernetes ConfigMap/Secret changes do not always automatically update app behavior.

Env var changes require pod restart.

Mounted files may update eventually, but app must reload/read them.

Kubernetes Config extension reads config source; dynamic reload depends on application/config behavior and should not be assumed.

Policy:

```text
For most production Quarkus config, use rollout restart for config change.
```

For dynamic runtime config:

- use database/feature flag service,
- watch mechanism,
- explicit admin reload,
- small scoped config.

Avoid accidental half-updated pods.

---

## 31. Horizontal Scaling and Autoscaling

HPA scales pods based on metrics.

Common metrics:

- CPU,
- memory,
- custom metrics,
- request rate,
- queue lag.

Quarkus app considerations:

- startup/readiness time,
- cold cache,
- DB connection pool per pod,
- external API rate limit,
- Kafka partition count,
- Redis connection count,
- native fast scale burst.

If each pod has DB pool max 50 and HPA scales to 20 pods:

```text
1000 DB connections possible
```

May exceed DB capacity.

Autoscaling must account for downstream limits.

---

## 32. Pod Disruption Budget

PDB protects availability during voluntary disruptions.

Example:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: application-service-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: application-service
```

Use when:

- multiple replicas,
- service must maintain availability during node drains,
- rolling maintenance.

PDB does not protect against involuntary failure.

---

## 33. Topology Spread and Anti-Affinity

Avoid all pods on one node/zone.

Topology spread:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app: application-service
```

Anti-affinity:

```yaml
podAntiAffinity:
  preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        labelSelector:
          matchLabels:
            app: application-service
        topologyKey: kubernetes.io/hostname
```

Important for high availability.

---

## 34. Scheduling Jobs in Kubernetes vs Quarkus Scheduler

From Part 020:

Use Kubernetes CronJob if:

- workload is process/container oriented,
- isolated resource profile,
- batch command,
- lower frequency,
- simpler cluster ownership.

Use Quarkus scheduler if:

- task lightweight,
- tied to app runtime,
- high-frequency,
- local node task,
- or paired with lock/Quartz for cluster-global.

Kubernetes CronJob config:

```yaml
concurrencyPolicy: Forbid
successfulJobsHistoryLimit: 3
failedJobsHistoryLimit: 3
```

For critical jobs:

- idempotency,
- checkpoint,
- job_run table,
- resource limits,
- retry/backoff,
- observability.

Kubernetes CronJob does not solve business idempotency.

---

## 35. Observability in Kubernetes

Expose:

- `/q/health/live`,
- `/q/health/ready`,
- `/q/metrics` if Micrometer/Prometheus,
- logs to stdout JSON,
- OpenTelemetry OTLP to collector,
- trace correlation,
- version/build info endpoint,
- pod labels.

Labels:

```yaml
labels:
  app.kubernetes.io/name: application-service
  app.kubernetes.io/version: "1.4.2"
  app.kubernetes.io/component: backend
  app.kubernetes.io/part-of: aceas
```

Annotations may be used for:

- Prometheus scraping,
- sidecar injection,
- config checksum,
- Git commit,
- deployment metadata.

---

## 36. Config Checksum Rollout

When ConfigMap/Secret changes, Deployment may not restart automatically.

Pattern:

```yaml
metadata:
  annotations:
    checksum/config: "<hash-of-config>"
```

Helm/Kustomize can compute hash.

When config changes, pod template changes, triggering rollout.

This avoids stale config.

---

## 37. Version and Build Info

Expose build info:

```text
version
git commit
build time
runtime mode JVM/native
Quarkus version
Java version
```

Endpoint:

```text
GET /q/info
or custom /version
```

Useful for incident:

```text
Which version is running in this pod?
```

Do not expose sensitive build metadata.

---

## 38. Example Deployment YAML

Conceptual:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: application-service
  labels:
    app.kubernetes.io/name: application-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: application-service
  template:
    metadata:
      labels:
        app.kubernetes.io/name: application-service
    spec:
      serviceAccountName: application-service
      terminationGracePeriodSeconds: 30
      containers:
        - name: application-service
          image: registry.example.com/aceas/application-service:git-a1b2c3d
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: QUARKUS_PROFILE
              value: prod
            - name: EXTERNAL_IDENTITY_BASE_URL
              valueFrom:
                configMapKeyRef:
                  name: application-config
                  key: external-identity-base-url
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: application-secret
                  key: db-password
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "1"
              memory: "1Gi"
          livenessProbe:
            httpGet:
              path: /q/health/live
              port: http
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /q/health/ready
              port: http
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /q/health/started
              port: http
            periodSeconds: 5
            failureThreshold: 30
          securityContext:
            runAsNonRoot: true
            runAsUser: 1001
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
```

This is a starting point, not universal.

---

## 39. Example Service YAML

```yaml
apiVersion: v1
kind: Service
metadata:
  name: application-service
spec:
  selector:
    app.kubernetes.io/name: application-service
  ports:
    - name: http
      port: 80
      targetPort: http
```

Service gives stable internal DNS.

Ingress/Route/API Gateway handles external exposure.

---

## 40. Production Checklist

### 40.1 Image

- [ ] immutable tag/digest used.
- [ ] no secrets in image.
- [ ] non-root user.
- [ ] minimal trusted base.
- [ ] CA/timezone/fonts if needed.
- [ ] vulnerability scan.
- [ ] SBOM generated.
- [ ] image signed if required.
- [ ] JVM/native mode documented.

### 40.2 Config and Secret

- [ ] build-time vs runtime config documented.
- [ ] ConfigMap for non-secret.
- [ ] Secret/external secret for sensitive data.
- [ ] secret not logged.
- [ ] config change rollout strategy.
- [ ] config validation at startup.
- [ ] ServiceAccount/RBAC least privilege.

### 40.3 Kubernetes Runtime

- [ ] liveness correct.
- [ ] readiness correct.
- [ ] startup probe if needed.
- [ ] resource requests/limits sized.
- [ ] graceful shutdown tested.
- [ ] rolling update safe.
- [ ] PDB if HA needed.
- [ ] topology spread/anti-affinity if HA needed.
- [ ] securityContext hardened.

### 40.4 Quarkus

- [ ] health endpoints enabled.
- [ ] metrics/tracing/logging enabled.
- [ ] JVM flags or native mode tuned.
- [ ] runtime config typed with ConfigMapping.
- [ ] scheduler/job behavior safe on multi-replica.
- [ ] Dev/prod profiles separate.
- [ ] native/JVM deployment tested as applicable.

### 40.5 Operations

- [ ] dashboard exists.
- [ ] alerts exist.
- [ ] runbook exists.
- [ ] smoke test exists.
- [ ] rollback tested.
- [ ] migration strategy compatible.
- [ ] HPA/downstream capacity reviewed.
- [ ] service mesh policy coordinated.

---

## 41. Anti-Pattern Umum

### 41.1 Liveness Depends on DB

Causes restart storm during DB outage.

### 41.2 Readiness Always UP

Pod receives traffic before ready.

### 41.3 No Startup Probe for Slow JVM App

Pod killed before startup completes.

### 41.4 Secrets Baked Into Image

Irreversible credential leakage risk.

### 41.5 Using `latest` Tag in Production

Rollback/debug impossible.

### 41.6 No Resource Requests

Scheduler cannot place pod reliably.

### 41.7 CPU Limit Too Low

Latency spikes due throttling.

### 41.8 Memory Limit Too Low

OOMKilled under normal load.

### 41.9 All Pods Start and Hit DB

Scale-out causes dependency storm.

### 41.10 ConfigMap Change Without Rollout

Pods run stale config.

### 41.11 Direct Deploy from Developer Machine

Bypasses release governance.

### 41.12 Quarkus Scheduler Global Job on Every Replica

Duplicate job execution.

---

## 42. Latihan

### Latihan 1 — Image Strategy

Untuk service:

```text
Quarkus REST + Hibernate + Kafka + Redis + OIDC
```

Tentukan:

- JVM image atau native image,
- image build method,
- base image,
- securityContext,
- resource estimate,
- native/JVM test gate.

### Latihan 2 — Probe Design

Buat liveness/readiness/startup policy untuk:

```text
Application service with DB required, Redis optional cache, Identity API external required only for submit flow.
```

Tentukan dependency mana masuk readiness dan mana tidak.

### Latihan 3 — Config/Secret Mapping

Buat mapping untuk:

- DB URL,
- DB username,
- DB password,
- Identity API URL,
- Identity client secret,
- scheduler enabled,
- log level,
- cache TTL.

Tentukan ConfigMap vs Secret vs runtime env.

### Latihan 4 — Rolling Update Safety

Aplikasi mengubah event schema dan DB column.

Buat deployment plan yang aman untuk rolling update.

### Latihan 5 — HPA Capacity

Jika setiap pod punya DB pool max 40 dan DB hanya aman untuk 240 connections, berapa max replica aman?

Apa yang harus diubah jika HPA ingin scale sampai 12 pod?

---

## 43. Ringkasan Invariants

Ingat invariants berikut:

```text
Container image is runtime contract.
Generated Kubernetes YAML is starting point, not production guarantee.
JVM and native images have different operational profiles.
Do not bake secrets into image.
Build-time and runtime config must be separated.
Liveness should not depend on external dependencies.
Readiness controls traffic eligibility.
Startup probe protects slow initialization.
Resource requests/limits are part of correctness.
Graceful shutdown must be tested.
Rolling updates require old/new compatibility.
Kubernetes CronJob solves trigger lifecycle, not business idempotency.
Autoscaling must respect downstream capacity.
ConfigMap/Secret changes need rollout strategy.
SecurityContext matters.
Observability must be present in deployment, not only code.
```

---

## 44. Referensi Resmi yang Relevan

Referensi yang perlu dibaca saat implementasi nyata:

- Quarkus Container Images guide.
- Quarkus Kubernetes extension / Deploying to Kubernetes guide.
- Quarkus Kubernetes Config guide.
- Quarkus Configuration Reference guide.
- Quarkus Secrets in Configuration guide.
- Quarkus SmallRye Health guide.
- Quarkus Micrometer/OpenTelemetry observability guides.
- Quarkus Native Reference guide.
- Quarkus Service Binding guide/reference.
- Kubernetes official documentation for probes, deployments, resources, secrets, configmaps, RBAC, PDB, HPA.

---

## 45. Kapan Seri Ini Lanjut ke Part Berikutnya

Part ini menyelesaikan Kubernetes dan container engineering dasar untuk Quarkus production deployment.

Bagian berikutnya:

```text
Part 031 — Cloud-Native Runtime Tuning: JVM Mode vs Native Mode, Memory, GC, Startup, Throughput
```

Di part berikutnya, fokus bergeser ke runtime tuning:

- JVM vs native decision with evidence,
- memory sizing,
- heap vs RSS,
- GC strategy,
- ZGC/G1 considerations,
- CPU limits/throttling,
- startup/readiness,
- throughput,
- p95/p99 latency,
- container ergonomics,
- autoscaling metrics,
- Quarkus runtime knobs,
- production benchmarking.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-029.md">⬅️ Native Image II: Making Real Applications Native-Compatible</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-031.md">Native Runtime Tuning: JVM Mode vs Native Mode, Memory, GC, Startup, Throughput ➡️</a>
</div>
