# learn-java-eclipse-jersey-deployment-models-part-021  
# Part 21 — Kubernetes Deployment Model

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 21 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami deployment Jersey sebagai service yang diorkestrasi Kubernetes secara production-grade.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: Pod, Deployment, Service, Ingress, probes, resource requests/limits, ConfigMap/Secret, rolling update, graceful termination, scaling, observability, security context, dan failure model untuk aplikasi Jersey.

---

## 1. Mengapa Kubernetes Deployment Perlu Dibahas Terpisah?

Docker menjawab:

```text
Bagaimana aplikasi dibungkus menjadi image dan process?
```

Kubernetes menjawab:

```text
Bagaimana process itu dijalankan, diawasi, di-scale, diupdate, diberi traffic, diberi config, dihentikan, dan dipulihkan?
```

Aplikasi Jersey yang berjalan baik di Docker belum tentu siap untuk Kubernetes.

Masalah yang sering muncul:

```text
- app bind ke localhost, bukan 0.0.0.0
- readiness probe salah path
- liveness probe terlalu agresif
- startup lambat lalu dibunuh liveness
- memory limit terlalu kecil lalu OOMKilled
- CPU limit menyebabkan throttling
- SIGTERM tidak ditangani
- rolling update memutus request aktif
- DB pool terlalu besar setelah replica scale-out
- ConfigMap berubah tapi app tidak reload
- Secret dibaca sebagai env tapi rotasi tidak terlihat
- ingress path rewrite tidak cocok dengan context path
- Service selector salah
- app server hidup tapi WAR gagal deploy
- autoscaling berdasarkan CPU tidak menangkap bottleneck downstream
```

Top-tier mental model:

> Kubernetes tidak membuat aplikasi production-ready.  
> Kubernetes hanya mengeksekusi kontrak yang kita tulis di manifest.  
> Jika kontraknya salah, Kubernetes akan mengotomasi kegagalan.

---

## 2. Kubernetes Object Mental Model

Untuk Jersey service, object utama:

```text
Container Image
  ↓
Pod
  ↓
Deployment / ReplicaSet
  ↓
Service
  ↓
Ingress / Gateway
  ↓
External client
```

Tambahan:

```text
ConfigMap
Secret
ServiceAccount
HorizontalPodAutoscaler
PodDisruptionBudget
NetworkPolicy
PersistentVolume if needed
```

Mental model traffic:

```text
Client
  ↓
Ingress / Gateway / Load Balancer
  ↓
Kubernetes Service
  ↓
Ready Pod endpoints
  ↓
Container port
  ↓
Jersey app
```

Important:

```text
Service sends traffic only to ready endpoints.
Readiness determines traffic eligibility.
Liveness determines restart.
Startup probe protects slow startup.
```

---

## 3. Pod: Smallest Deployable Unit

A Pod wraps one or more containers sharing:

```text
network namespace
IP address
volumes
lifecycle
```

For most Jersey services:

```text
one Pod = one app container
```

Possible sidecars:

```text
service mesh proxy
log collector
metrics agent
config reloader
security agent
```

But each sidecar consumes CPU/memory and changes lifecycle.

Simple Jersey app should start with:

```text
one app container
```

Add sidecars only when platform requires them.

---

## 4. Deployment: Desired State for Replica Pods

Deployment defines:

```text
desired replica count
Pod template
rolling update strategy
selector
image version
resource config
probes
```

Example skeleton:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: case-api
  template:
    metadata:
      labels:
        app: case-api
    spec:
      containers:
        - name: app
          image: registry.example.com/case-api:1.0.0
          ports:
            - containerPort: 8080
```

Deployment creates ReplicaSet, ReplicaSet manages Pods.

You usually do not create ReplicaSet manually.

---

## 5. Service: Stable Network Identity

Pods are ephemeral.

Service gives stable access:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: case-api
spec:
  selector:
    app: case-api
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

Meaning:

```text
Service DNS:
  case-api.<namespace>.svc.cluster.local

Service port:
  80

Pod container port:
  8080
```

Selector must match Pod labels.

If selector wrong:

```text
Service has no endpoints
traffic fails
```

Diagnostic:

```bash
kubectl get endpoints case-api
kubectl describe service case-api
```

---

## 6. Ingress / Gateway

Ingress/Gateway exposes service externally.

Example Ingress concept:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: case-api
spec:
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /case-api
            pathType: Prefix
            backend:
              service:
                name: case-api
                port:
                  number: 80
```

Critical for Jersey:

```text
Does ingress preserve /case-api?
Does ingress strip /case-api?
Does app context path include /case-api?
Does Jersey @ApplicationPath include /api?
```

Path composition must be explicit.

---

## 7. Path Composition for Jersey in Kubernetes

Embedded app:

```text
bind:
  0.0.0.0:8080

base path:
  /

resource:
  /health/ready

probe:
  /health/ready
```

Tomcat ROOT.war + Jersey `/api/*`:

```text
context:
  /

servlet mapping:
  /api/*

resource:
  /health/ready

probe:
  /api/health/ready
```

Tomcat `case-api.war` + Jersey `/api/*`:

```text
context:
  /case-api

servlet mapping:
  /api/*

resource:
  /health/ready

probe:
  /case-api/api/health/ready
```

Open Liberty MicroProfile Health:

```text
probe:
  /health/ready
```

depending configuration/version.

Rule:

```text
Probe path must match actual internal container path, not external route assumption.
```

---

## 8. Probes: Liveness, Readiness, Startup

Kubernetes defines probes as diagnostics performed periodically by kubelet. Probe results can cause Kubernetes to restart unhealthy containers or stop sending traffic to containers that are not ready.

Three probe types:

```text
startupProbe:
  protects slow startup

livenessProbe:
  decides whether container should be restarted

readinessProbe:
  decides whether Pod should receive traffic
```

This distinction is foundational.

Bad:

```text
same deep DB check for all probes
```

Good:

```text
startup:
  has app finished boot?

liveness:
  is process/runtime alive?

readiness:
  can app serve traffic now?
```

---

## 9. Startup Probe

Use startup probe when app may start slowly.

Examples:

- Payara/GlassFish startup,
- Open Liberty feature loading,
- Tomcat WAR deployment,
- large Jersey classpath scanning,
- DB/resource validation,
- JIT warmup if strict,
- migrations if done outside app but app waits.

Example:

```yaml
startupProbe:
  httpGet:
    path: /health/live
    port: 8080
  periodSeconds: 3
  failureThreshold: 60
```

This gives:

```text
3s * 60 = 180s startup window
```

During startup probe failure, liveness/readiness handling is protected according to Kubernetes probe behavior.

Do not use liveness alone for slow startup.

---

## 10. Liveness Probe

Liveness answers:

```text
Should this container be restarted?
```

Good liveness:

```text
JVM process is responsive
HTTP server/event loop not dead
app can answer simple local check
```

Bad liveness:

```text
DB down -> liveness fails
downstream API down -> liveness fails
Kafka unavailable -> liveness fails
```

Because restart does not fix external dependency outage.

Bad outcome:

```text
all pods restart repeatedly
outage amplified
```

Example:

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3
```

This restarts after roughly 30s of failed liveness, depending timing.

---

## 11. Readiness Probe

Readiness answers:

```text
Should this Pod receive traffic?
```

Readiness can depend on:

```text
app initialized
Jersey runtime ready
WAR deployed
critical config valid
DB pool available if DB is required for every request
not shutting down
overload state maybe
```

Example:

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 2
```

If readiness fails:

```text
Pod remains running
but removed from Service endpoints
```

This is ideal for:

- startup not ready,
- dependency temporarily unavailable,
- draining shutdown,
- overload/load shedding.

---

## 12. Probe Design for Jersey

Jersey health resources:

```java
@Path("/health")
public final class HealthResource {

    private final HealthState state;

    public HealthResource(HealthState state) {
        this.state = state;
    }

    @GET
    @Path("/live")
    public String live() {
        return "live";
    }

    @GET
    @Path("/ready")
    public Response ready() {
        if (state.isReady()) {
            return Response.ok("ready").build();
        }
        return Response.status(503).entity("not ready").build();
    }
}
```

For managed runtimes, use MicroProfile Health if available.

But maintain semantics:

```text
live:
  do not include normal dependency failure

ready:
  include traffic eligibility

started:
  startup complete
```

---

## 13. Readiness During Shutdown

On SIGTERM, app should:

```text
mark readiness false
stop accepting new work
drain in-flight work
close server/resources
exit
```

If readiness remains true during shutdown:

```text
Service may still send traffic to terminating Pod
```

Kubernetes endpoint removal is not instantaneous.

Good sequence:

```text
SIGTERM received
  ↓
readiness false
  ↓
small drain window if needed
  ↓
server graceful stop
  ↓
process exit
```

This requires application/server lifecycle integration.

---

## 14. Container Lifecycle Hooks and Termination

Kubernetes documentation states `PreStop` hooks are not executed asynchronously from the signal to stop the container; the hook must complete before TERM can be sent, and the termination grace period includes both the PreStop hook time and normal container stop time.

Implication:

```text
If preStop sleeps 10s and terminationGracePeriodSeconds is 30s,
app has at most about 20s left for shutdown after TERM.
```

Do not set:

```yaml
preStop:
  sleep 30
terminationGracePeriodSeconds: 30
```

That leaves no time for app graceful shutdown.

---

## 15. terminationGracePeriodSeconds

Example:

```yaml
terminationGracePeriodSeconds: 45
```

This should cover:

```text
preStop hook duration
readiness removal propagation
in-flight request drain
server stop
DB/HTTP client close
telemetry flush
```

For Jersey services:

```text
short APIs:
  30-45s often enough

long APIs/reporting:
  longer or redesign async job model
```

If request can take 5 minutes, do not rely on normal HTTP request during rolling update unless you have strong graceful termination policy.

---

## 16. Rolling Update Strategy

Deployment rolling update controls how pods are replaced.

Example:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

Meaning:

```text
do not reduce available replicas below desired
allow one extra pod during rollout
```

For critical APIs, `maxUnavailable: 0` is often safer.

But if cluster lacks spare capacity, rollout may stall.

Trade-off:

```text
availability vs capacity
```

Top-tier rule:

```text
Rolling update only works safely if readiness is correct.
```

If readiness lies, rollout sends traffic too early.

---

## 17. Resource Requests and Limits

Kubernetes resource management docs state that when specifying a Pod, you can optionally specify how much of each resource a container needs. Memory request is guaranteed for scheduling, and memory limit restricts usage.

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

Requests:

```text
used for scheduling
reserve capacity expectation
```

Limits:

```text
enforced maximum
memory over limit can cause OOMKilled
CPU over limit can be throttled
```

For JVM, memory limit is critical.

---

## 18. Memory Limit and JVM Budget

Container memory includes:

```text
heap
metaspace
thread stacks
direct memory
code cache
GC/native structures
JIT
Netty buffers
TLS/native allocations
```

Do not set heap equal to memory limit.

Example:

```text
memory limit:
  1Gi

Max heap:
  650Mi to 750Mi depending app

headroom:
  non-heap/native/direct/threads
```

JVM flag:

```text
-XX:MaxRAMPercentage=65
```

For Netty deployment, direct memory may require more headroom.

For Tomcat with many threads, thread stacks need headroom.

---

## 19. CPU Requests/Limits and Java

CPU request affects scheduling.

CPU limit can throttle.

Consequences:

```text
GC slower
request latency higher
JIT slower
Tomcat/Jetty thread scheduling affected
HPA CPU signal affected
```

If CPU limit is too low and app is latency-sensitive, throttling can cause p99 spikes.

For Java services, some teams set CPU requests and avoid strict CPU limits, depending cluster policy, to reduce throttling. But this must follow organization policy.

At minimum:

```text
test under the same CPU limit used in production
```

---

## 20. JVM Container Awareness

Modern JVMs understand container resource limits better than old JVMs.

But verify with logs:

```text
-Xlog:os+container=info
```

or:

```bash
java -XshowSettings:system -version
```

Log at startup:

```text
Java version
available processors
max heap
container memory limit if detectable
active profiles/config
```

Do not diagnose Kubernetes performance without knowing what JVM thinks its resources are.

---

## 21. Quality of Service Classes

Kubernetes assigns QoS classes based on requests/limits:

```text
Guaranteed
Burstable
BestEffort
```

General idea:

```text
Guaranteed:
  requests == limits for CPU and memory

Burstable:
  some requests/limits set, not all equal

BestEffort:
  no requests/limits
```

BestEffort pods are more likely to be evicted under pressure.

Production Jersey services should not be BestEffort.

Define requests at minimum.

---

## 22. ConfigMap

ConfigMap stores non-secret config.

Example:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: case-api-config
data:
  APP_PORT: "8080"
  LOG_LEVEL: "INFO"
```

Use as env:

```yaml
envFrom:
  - configMapRef:
      name: case-api-config
```

Or mount as file:

```yaml
volumes:
  - name: config
    configMap:
      name: case-api-config
```

Remember:

```text
env var values from ConfigMap do not update inside running process automatically
```

Mounted files can update eventually, but app must reload if needed.

Most Java services should treat config as startup-time immutable unless designed for reload.

---

## 23. Secret

Secret stores sensitive config.

Example:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: case-api-secret
type: Opaque
stringData:
  DB_PASSWORD: "example"
```

Use carefully.

Secrets can be mounted as env or files.

Security concerns:

```text
RBAC access
etcd encryption
logs accidentally printing env
process diagnostics
secret rotation
```

Do not print config blindly at startup.

Log only non-secret effective config.

---

## 24. Environment Variables vs Mounted Files

### Env vars

Pros:

```text
simple
common
easy with MicroProfile Config
```

Cons:

```text
rotation requires restart
can leak through diagnostics
large config awkward
```

### Mounted files

Pros:

```text
better for certificates/keys
can update mounted content
less visible in env dump
```

Cons:

```text
app must read files
reload logic needed
permissions
```

Use files for:

- TLS certs,
- service account tokens,
- large config,
- sensitive key material.

Use env for:

- simple non-secret config,
- port,
- profile,
- feature flags with restart.

---

## 25. ServiceAccount and RBAC

By default, Pods may have a ServiceAccount.

If app does not need Kubernetes API access, restrict it.

Production principle:

```text
least privilege
```

If Jersey app reads Kubernetes API:

```text
define dedicated ServiceAccount
define Role/RoleBinding
limit verbs/resources/namespaces
```

Do not run apps with broad cluster-admin permission.

---

## 26. SecurityContext

Example:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL
```

Container image must support it.

If read-only root filesystem enabled:

```text
Tomcat/Jetty/Liberty/Payara may need writable work dirs
Jersey multipart uploads may need temp dir
logs should go stdout
```

Mount `emptyDir` where needed.

---

## 27. Volumes and `emptyDir`

Use `emptyDir` for temporary writable storage:

```yaml
volumes:
  - name: tmp
    emptyDir: {}

volumeMounts:
  - name: tmp
    mountPath: /tmp
```

For upload temp:

```yaml
volumeMounts:
  - name: upload-tmp
    mountPath: /app/tmp
```

Do not use container writable layer for large temp files.

Set size limits if appropriate:

```yaml
emptyDir:
  sizeLimit: 1Gi
```

---

## 28. Statelessness

REST services should usually be stateless.

Avoid:

```text
local filesystem state
in-memory session state
sticky pod assumptions
local cache required for correctness
```

Use external systems for durable state:

```text
database
Redis
object storage
message broker
```

Local cache is okay if:

```text
rebuildable
bounded
not source of truth
eviction safe
```

Kubernetes pods are disposable.

Design accordingly.

---

## 29. Horizontal Scaling

Scale replicas:

```yaml
spec:
  replicas: 3
```

But scaling app replicas affects dependencies.

Example DB pool:

```text
DB max app connections:
  120

replicas:
  6

safe pool per replica:
  20 or less
```

Formula:

```text
pool_per_pod * pod_count <= DB_connection_budget
```

If HPA can scale to 20 pods, use max replicas in sizing.

Do not size DB pool only for current replicas.

---

## 30. HorizontalPodAutoscaler

HPA can scale based on CPU/memory/custom metrics.

Example CPU HPA:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: case-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: case-api
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

CPU-based HPA is not always enough.

Jersey apps often bottleneck on:

```text
DB latency
downstream API
thread pool saturation
queue depth
connection pool saturation
```

Consider custom metrics:

```text
request latency
in-flight requests
executor queue
DB pool wait
HTTP client queue
```

---

## 31. Scaling and Readiness

When new pods start:

```text
Deployment creates pod
container starts
startup probe passes
readiness passes
Service endpoints include pod
traffic begins
```

If readiness passes too early:

```text
traffic hits cold/uninitialized pod
errors spike
```

If readiness is too strict/noisy:

```text
pods flap in/out of service
traffic unstable
```

Good readiness is stable and meaningful.

---

## 32. PodDisruptionBudget

PDB protects availability during voluntary disruptions.

Example:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: case-api
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: case-api
```

If you run 3 replicas:

```text
at least 2 should remain available during voluntary disruption
```

PDB does not protect from all failures.

It helps with:

- node drain,
- voluntary maintenance,
- cluster upgrades.

---

## 33. Affinity and Topology Spread

Avoid all replicas on one node/zone.

Use topology spread constraints:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app: case-api
```

This improves availability across zones/nodes.

For critical services, combine:

- multiple replicas,
- PDB,
- topology spread,
- anti-affinity,
- multi-zone cluster.

---

## 34. NetworkPolicy

If cluster enforces NetworkPolicy, define allowed traffic.

Example conceptual:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: case-api
spec:
  podSelector:
    matchLabels:
      app: case-api
  policyTypes:
    - Ingress
    - Egress
```

Then add allowed ingress/egress rules.

For Jersey service:

```text
ingress from ingress controller/gateway
egress to DB
egress to Redis
egress to external API proxy
egress to DNS
```

Least privilege network is production-grade.

---

## 35. DNS and Service Discovery

Kubernetes DNS:

```text
service-name.namespace.svc.cluster.local
```

Use service names for internal calls:

```text
http://user-api.default.svc.cluster.local
```

But for Java HTTP clients:

```text
DNS caching matters
connection pool stale endpoints matter
timeouts matter
retry policy matters
```

JVM DNS cache can hold values.

In Kubernetes, services provide stable virtual IP/DNS, but headless services/stateful workloads can require more care.

---

## 36. Timeouts Across Layers

Timeout chain:

```text
client
ingress/gateway
service mesh if any
Jersey app/server
downstream HTTP client
database
message broker
```

If ingress timeout is 30s but app timeout is 120s:

```text
client gets timeout
app keeps working
threads wasted
possible duplicate retry
```

Set consistent budgets.

Example:

```text
client timeout:
  10s

ingress timeout:
  15s

app request budget:
  12s

downstream HTTP:
  connect 1s, read 4s

DB query:
  8s

termination grace:
  45s
```

No infinite waits.

---

## 37. Ingress Path Rewrite

Example:

External:

```text
/api/case/*
```

Internal app expects:

```text
/case-api/api/*
```

If ingress rewrites incorrectly:

```text
404
wrong redirects
wrong OpenAPI server URL
wrong cookies
wrong CORS
```

Document:

```text
external path
rewrite rule
service port
container path
context root
Jersey mapping
resource path
```

Test through ingress, not only port-forward.

---

## 38. TLS Termination

Options:

```text
Ingress terminates TLS
service mesh terminates mTLS
app/server terminates TLS
```

Most Kubernetes Jersey apps:

```text
TLS at ingress/gateway
HTTP to pod
```

If app terminates TLS:

- manage certs,
- mount secrets,
- reload certificates,
- configure server TLS,
- health probes may need HTTPS,
- mTLS complexity.

Choose boundary explicitly.

---

## 39. Config Reload

Kubernetes can update ConfigMap/Secret, but Java app may not reload.

Options:

```text
restart pods on config change
app watches mounted file
sidecar reloader
MicroProfile Config reload if supported
operator-driven rollout
```

Most production Java services use:

```text
config change triggers rollout
```

This is safer than ad-hoc live reload unless designed.

---

## 40. Deployment Rollback

Kubernetes Deployment supports rollout history/rollback if configured.

But production rollback needs:

```text
previous image available
previous config available
DB compatibility
feature flags
migration rollback/forward plan
```

Command:

```bash
kubectl rollout undo deployment/case-api
```

But this only solves image/spec rollback.

If database migration is not backward compatible, rollback may fail.

Top-tier rule:

```text
Application rollout and schema rollout must be coordinated.
```

---

## 41. Database Migration Strategy

Do not run unsafe migrations from every pod at startup.

Risks:

```text
race condition
multiple pods run migration
startup delay
partial failure
rollback impossible
```

Better options:

```text
CI/CD migration step
Kubernetes Job
init container with locking
migration tool with DB lock
expand-contract deployment
```

For high availability:

```text
1. expand schema backward compatible
2. deploy app that writes both/reads new
3. migrate data
4. contract old schema later
```

---

## 42. Init Containers

Init containers run before app container.

Use for:

- waiting for dependency only if justified,
- one-time setup,
- permission setup,
- config generation,
- migration with caution.

Example:

```yaml
initContainers:
  - name: wait-for-db
    image: busybox
    command: ["sh", "-c", "until nc -z db 5432; do sleep 2; done"]
```

Be careful:

```text
waiting for DB port open does not mean DB schema ready
```

Avoid hiding dependency problems with infinite init waits.

---

## 43. Sidecars

Possible sidecars:

```text
service mesh proxy
log shipper
config reloader
metrics exporter
secrets agent
```

Sidecar implications:

- resource requests/limits,
- startup ordering,
- shutdown ordering,
- readiness interaction,
- network path,
- debugging complexity.

If using service mesh, Jersey app may see proxy as remote peer.

Forwarded headers and mTLS identity may be handled by mesh.

---

## 44. Observability in Kubernetes

Observe at multiple layers:

```text
Kubernetes:
  pod status
  restarts
  OOMKilled
  events
  readiness
  rollout state

Container:
  CPU/memory
  filesystem
  network

JVM:
  heap
  GC
  threads
  direct memory
  classloading

Server/Jersey:
  request count
  latency
  status code
  exception mapper
  active requests

Dependencies:
  DB pool
  HTTP clients
  message broker
  Redis

Business:
  use-case success/failure
  audit events
```

No single metric is enough.

---

## 45. Logging and Correlation

Kubernetes log collection usually reads stdout/stderr.

Ensure:

```text
request ID generated or propagated
request ID included in response
request ID included in logs
ingress forwards request ID
downstream calls include request ID
```

Jersey filter:

```java
@Provider
public class RequestIdFilter implements ContainerRequestFilter, ContainerResponseFilter {
    ...
}
```

Structured logs help query by:

```text
namespace
pod
container
app
version
requestId
status
errorCode
```

---

## 46. Metrics

Useful metrics:

```text
http.server.requests.count
http.server.requests.duration
status code counts
active requests
JVM heap/non-heap
GC pauses
thread count
DB pool active/idle/wait
HTTP client latency
executor queue depth
readiness state
startup time
pod restarts
OOMKilled count
```

For autoscaling, CPU may be insufficient.

Use custom metrics if bottleneck is not CPU.

---

## 47. Tracing

Distributed tracing useful when Jersey service calls:

```text
other REST APIs
message brokers
database
external systems
```

Trace propagation headers:

```text
traceparent
baggage
x-request-id
```

Instrument:

- Jersey server inbound,
- HTTP client outbound,
- DB calls,
- message publishing/consuming.

Be careful with PII in spans.

---

## 48. ImagePullPolicy and Tags

Avoid mutable tags for production.

Bad:

```yaml
image: case-api:latest
imagePullPolicy: Always
```

Better:

```yaml
image: case-api:1.0.0
```

Best for strict reproducibility:

```yaml
image: case-api@sha256:...
```

If tag is mutable, rollout/rollback is ambiguous.

---

## 49. Namespaces and Environments

Use namespaces for environment/team isolation:

```text
dev
uat
prod
```

But do not rely only on namespace for safety.

Also use:

- RBAC,
- NetworkPolicy,
- resource quotas,
- admission policies,
- separate clusters for strong prod isolation if required.

Environment differences should be config, not image rebuild.

---

## 50. Complete Example: Embedded Jersey Deployment

Example for embedded Jersey at `/health/*`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-api
  labels:
    app: case-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: case-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    metadata:
      labels:
        app: case-api
        version: "1.0.0"
    spec:
      terminationGracePeriodSeconds: 45
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
      containers:
        - name: app
          image: registry.example.com/case-api:1.0.0
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: APP_BIND_HOST
              value: "0.0.0.0"
            - name: APP_PORT
              value: "8080"
            - name: JAVA_TOOL_OPTIONS
              value: "-XX:MaxRAMPercentage=65 -Xlog:os+container=info"
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "1"
              memory: "1Gi"
          startupProbe:
            httpGet:
              path: /health/live
              port: http
            periodSeconds: 3
            failureThreshold: 60
          livenessProbe:
            httpGet:
              path: /health/live
              port: http
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 2
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
```

Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: case-api
spec:
  selector:
    app: case-api
  ports:
    - name: http
      port: 80
      targetPort: http
```

---

## 51. Complete Example: Tomcat WAR Deployment

Assume:

```text
ROOT.war
Jersey mapping /api/*
health resource /health
```

Probe path:

```text
/api/health/ready
```

Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-api-tomcat
spec:
  replicas: 3
  selector:
    matchLabels:
      app: case-api-tomcat
  template:
    metadata:
      labels:
        app: case-api-tomcat
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: tomcat
          image: registry.example.com/case-api-tomcat:1.0.0
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: JAVA_OPTS
              value: "-XX:MaxRAMPercentage=65"
          resources:
            requests:
              cpu: "500m"
              memory: "768Mi"
            limits:
              cpu: "1"
              memory: "1536Mi"
          startupProbe:
            httpGet:
              path: /api/health/live
              port: http
            periodSeconds: 3
            failureThreshold: 80
          livenessProbe:
            httpGet:
              path: /api/health/live
              port: http
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /api/health/ready
              port: http
            periodSeconds: 5
            failureThreshold: 2
```

If WAR is not ROOT:

```text
/case-api/api/health/ready
```

---

## 52. Common Kubernetes Failure Modes

### 52.1 CrashLoopBackOff

Causes:

```text
app exits
config missing
port bind failure
ClassNotFoundException
JVM memory error
migration failure
```

Diagnostics:

```bash
kubectl logs pod-name --previous
kubectl describe pod pod-name
kubectl get events
```

### 52.2 OOMKilled

Cause:

```text
container memory exceeded
```

Fix:

```text
heap/non-heap budget
memory limit
thread count
direct memory
leak investigation
```

### 52.3 Readiness Never Passes

Causes:

```text
wrong path
app not ready
dependency check fails
binding localhost
startup too slow
```

### 52.4 Liveness Restarts Healthy-but-Slow App

Cause:

```text
liveness too strict
startup probe missing
timeout too low
dependency check in liveness
```

### 52.5 Service Has No Endpoints

Causes:

```text
selector mismatch
readiness failing
pods not running
labels wrong
```

### 52.6 Rolling Update Causes Downtime

Causes:

```text
readiness lies
maxUnavailable too high
no startup probe
insufficient capacity
termination not graceful
```

---

## 53. Anti-Patterns

### Anti-Pattern 1 — Only Defining Deployment, No Service/Probe/Resources

Manifest incomplete for production.

### Anti-Pattern 2 — Liveness Checks Database

Restart storm.

### Anti-Pattern 3 — No Startup Probe for Slow Server

CrashLoop during startup.

### Anti-Pattern 4 — No Resource Requests

Unreliable scheduling and BestEffort behavior.

### Anti-Pattern 5 — CPU/Memory Limits Copied Randomly

Performance/OOM issues.

### Anti-Pattern 6 — Readiness Always 200

Traffic sent to broken app.

### Anti-Pattern 7 — DB Pool Ignores Replica Count

Database overload after scaling.

### Anti-Pattern 8 — Mutable Image Tags

Rollback/reproducibility issue.

### Anti-Pattern 9 — Ignoring Termination

Request drops during rollout.

### Anti-Pattern 10 — Probe External Ingress Instead of Internal App Path

Kubelet probes Pod IP, not public ingress path.

---

## 54. Decision Matrix

| Concern | Kubernetes Decision |
|---|---|
| Traffic eligibility | readinessProbe |
| Restart unhealthy app | livenessProbe |
| Slow startup | startupProbe |
| Replica management | Deployment |
| Stable internal DNS | Service |
| External traffic | Ingress/Gateway |
| Config | ConfigMap |
| Secrets | Secret/external secret |
| Scheduling capacity | resource requests |
| Enforcement | resource limits |
| Safe rollout | rolling strategy + readiness |
| Voluntary disruption | PodDisruptionBudget |
| Multi-zone availability | topology spread |
| Network restriction | NetworkPolicy |
| Scaling | HPA/custom metrics |
| Graceful stop | terminationGracePeriodSeconds + app shutdown |

---

## 55. Top-Tier Engineering Perspective

A basic engineer says:

```text
I have a Deployment YAML.
```

A senior engineer asks:

```text
Are probes and resources configured?
```

A top-tier engineer defines:

```text
- final internal health paths
- startup vs liveness vs readiness semantics
- resource request/limit budgets
- JVM memory calculation
- DB pool sizing by max replicas
- rollout strategy
- graceful termination sequence
- ingress rewrite contract
- config/secret ownership
- observability signals
- HPA metric validity
- PDB/topology availability model
- security context/RBAC/network policy
- rollback and schema migration strategy
```

Kubernetes does not remove architecture.

It forces architecture to become YAML and runtime behavior.

---

## 56. Production Readiness Checklist

```text
[ ] Deployment uses immutable image tag/digest.
[ ] App binds to 0.0.0.0.
[ ] Container port matches app port.
[ ] Service selector matches Pod labels.
[ ] Service targetPort matches named container port.
[ ] Ingress/Gateway path rewrite documented.
[ ] Startup probe configured for slow startup.
[ ] Liveness probe does not check normal downstream outage.
[ ] Readiness probe reflects traffic eligibility.
[ ] Probe paths include context/mapping correctly.
[ ] Resource requests set.
[ ] Memory limit and JVM heap budget aligned.
[ ] CPU limit/request tested.
[ ] JAVA_TOOL_OPTIONS/JVM flags defined.
[ ] ConfigMap/Secret injection defined.
[ ] Secrets not logged.
[ ] ServiceAccount least privilege.
[ ] SecurityContext non-root configured.
[ ] Writable temp dirs handled.
[ ] Logs go to stdout/stderr.
[ ] Metrics/tracing configured.
[ ] Request correlation propagated.
[ ] terminationGracePeriodSeconds aligned with shutdown.
[ ] SIGTERM graceful shutdown tested.
[ ] Rolling update strategy defined.
[ ] PDB defined for critical services.
[ ] Topology spread/anti-affinity considered.
[ ] HPA max replicas aligned with DB pool capacity.
[ ] NetworkPolicy defined if cluster supports it.
[ ] Rollback tested.
[ ] DB migration rollout strategy defined.
[ ] OOMKilled and CrashLoop diagnostics documented.
```

---

## 57. Summary

Kubernetes deployment is where Jersey becomes an orchestrated service.

The main shift:

```text
Docker:
  can this process run?

Kubernetes:
  can this service be scheduled, routed, probed, scaled, updated, stopped, and recovered safely?
```

For Jersey, Kubernetes readiness depends heavily on:

- correct health endpoints,
- context path/mapping,
- startup behavior,
- JVM resource sizing,
- graceful shutdown,
- dependency capacity,
- rollout strategy.

Top-tier conclusion:

> Kubernetes is not a magic production layer.  
> It is a contract executor.  
> A Jersey service becomes reliable on Kubernetes only when the contract is explicit and correct.

---

## 58. How This Part Connects to the Next Part

This part covered Kubernetes.

Next:

```text
Part 22 — Reverse Proxy and API Gateway Deployment
```

We will zoom into the traffic entry layer:

- nginx/HAProxy/ALB/API Gateway/Ingress,
- path rewriting,
- forwarded headers,
- TLS termination,
- timeouts,
- request size limits,
- CORS,
- rate limiting,
- auth offload,
- correlation IDs,
- 502/503/504 debugging,
- how proxy behavior affects Jersey routing and generated URLs.

---

## References

- Kubernetes documentation — Resource Management for Pods and Containers: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
- Kubernetes documentation — Liveness, Readiness, and Startup Probes: https://kubernetes.io/docs/concepts/workloads/pods/probes/
- Kubernetes documentation — Configure Liveness, Readiness and Startup Probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Kubernetes documentation — Container Lifecycle Hooks: https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/
- Kubernetes documentation — Pod Lifecycle: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
- Kubernetes documentation — Assign Memory Resources to Containers and Pods: https://kubernetes.io/docs/tasks/configure-pod-container/assign-memory-resource/


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-020.md">⬅️ Part 20 — Docker Deployment Model for Jersey</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-022.md">Part 22 — Reverse Proxy and API Gateway Deployment ➡️</a>
</div>
