# learn-java-eclipse-jersey-deployment-models-part-028  
# Part 28 — Failure Modes: Startup, Runtime, Redeploy, Shutdown

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 28 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami failure mode Jersey secara menyeluruh sepanjang lifecycle deployment.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: startup failures, deployment failures, classpath/provider discovery, runtime saturation, dependency failure, redeploy leaks, graceful shutdown, Kubernetes rollout, diagnostics, dan incident playbooks.

---

## 1. Mengapa Failure Modes Harus Dipelajari Terpisah?

Sampai bagian sebelumnya, kita sudah membahas banyak deployment model:

```text
WAR di Tomcat/Jetty
embedded Grizzly
embedded Jetty
JDK HTTP Server
Netty
GlassFish/Payara
Open Liberty
Docker
Kubernetes
Reverse proxy/API gateway
```

Setiap model punya failure mode sendiri.

Aplikasi Jersey bisa gagal di:

```text
build time
startup time
deployment time
first request
high traffic runtime
dependency outage
redeploy
rolling update
shutdown
post-shutdown cleanup
```

Top-tier mental model:

> Production failure jarang datang sebagai satu error tunggal.  
> Ia adalah kombinasi lifecycle stage + runtime model + dependency state + configuration + traffic.

Jika kita tahu failure modes, kita bisa:

```text
mencegah sebelum terjadi
mendeteksi lebih cepat
mendiagnosis lebih sistematis
memperbaiki tanpa menebak
membuat runbook yang nyata
```

---

## 2. Lifecycle Map

Jersey deployment lifecycle:

```text
Build
  ↓
Package
  ↓
Image/Distribution Build
  ↓
Deploy
  ↓
Server Startup
  ↓
Application Initialization
  ↓
Readiness
  ↓
Runtime Traffic
  ↓
Overload/Dependency Failure
  ↓
Redeploy/Rolling Update
  ↓
Shutdown/Termination
  ↓
Cleanup/Resource Release
```

Failure can occur at every step.

Simplified:

```text
Startup failure:
  app never becomes ready

Runtime failure:
  app was ready, then breaks/degrades

Redeploy failure:
  old/new versions interact badly

Shutdown failure:
  app cannot stop cleanly or drops work
```

---

## 3. Failure Classification

Classify failure by dimension.

### By lifecycle

```text
startup
runtime
redeploy
shutdown
```

### By layer

```text
build/package
classpath/module path
server/container
Jersey runtime
CDI/HK2/injection
JSON/provider
configuration
network/proxy
security
dependency
JVM
Kubernetes
```

### By symptom

```text
404
500
502
503
504
OOMKilled
CrashLoopBackOff
NoSuchMethodError
ClassNotFoundException
MessageBodyWriter not found
readiness failure
thread pool exhaustion
DB pool exhaustion
memory leak
shutdown timeout
```

### By blast radius

```text
single endpoint
single pod
single deployment
all replicas
downstream dependency
database
whole platform
```

A good incident report identifies all four dimensions.

---

## 4. Startup Failure Overview

Startup failure means the app cannot reach a stable ready state.

Symptoms:

```text
process exits
container restarts
Kubernetes CrashLoopBackOff
server starts but WAR deployment fails
app deployed but readiness never passes
HTTP port not listening
health endpoint 404
first dependency validation fails
```

Main categories:

```text
Java version mismatch
classpath/dependency mismatch
javax/jakarta mismatch
missing Jersey modules
provider discovery failure
config missing/invalid
port bind failure
JNDI resource missing
CDI/HK2 injection failure
DB migration/startup validation failure
server feature missing
Kubernetes env/secret/config mount error
```

Startup failure is good if it fails fast for unsafe config.

Startup failure is bad if it is mysterious or flaps.

---

## 5. Java Version Mismatch

Symptoms:

```text
UnsupportedClassVersionError
class file has wrong version
application starts locally but fails in image/server
```

Cause:

```text
compiled with newer Java than runtime supports
```

Example:

```text
compiled with Java 21
running on Java 17
```

Fix:

```text
align build and runtime
use --release
pin Docker/server Java version
log Java version at startup
```

Maven:

```xml
<maven.compiler.release>21</maven.compiler.release>
```

Gradle:

```groovy
tasks.withType(JavaCompile).configureEach {
    options.release = 21
}
```

Production check:

```bash
java -version
jar tf app.jar
jdeps if needed
```

---

## 6. `javax.*` vs `jakarta.*` Mismatch

Symptoms:

```text
ClassNotFoundException: javax/ws/rs/Path
ClassNotFoundException: jakarta/ws/rs/Path
resource not discovered
404 for all resources
deployment error
```

Cause:

```text
Jersey/server generation and app imports differ
```

Examples:

```text
Jersey 2.x + javax app on Jakarta EE 10 server
Jersey 3.x/4.x + jakarta app on Java EE 8 server
Tomcat 9 with jakarta servlet app
Tomcat 10+ with javax servlet app
```

Fix:

```text
align server generation
align Jersey version
align API namespace
align deployment descriptors
inspect final artifact
```

Checklist:

```text
[ ] imports are consistently javax or jakarta
[ ] servlet container generation matches
[ ] Jakarta EE server generation matches
[ ] WAR does not include conflicting APIs
```

---

## 7. Missing Jersey Module

Symptoms:

```text
ClassNotFoundException: org.glassfish.jersey.servlet.ServletContainer
InjectionManagerFactory not found
MessageBodyWriter not found
404 resources not loaded
```

Causes:

```text
jersey-container-servlet-core missing
jersey-hk2 missing
JSON provider missing
multipart provider missing
dependency scope wrong
server expected app to package Jersey
```

Example Tomcat WAR:

```text
servlet-api:
  provided

jersey-container-servlet-core:
  packaged
```

If `jersey-container-servlet-core` is marked `provided`, Tomcat cannot load Jersey servlet.

Fix:

```text
review dependency scopes by deployment model
use Jersey BOM
inspect WAR WEB-INF/lib
```

---

## 8. Provider Discovery Failure

Symptoms:

```text
MessageBodyReader not found
MessageBodyWriter not found
JSON not serialized
ExceptionMapper not called
Feature not registered
```

Causes:

```text
provider dependency missing
META-INF/services lost in shaded jar
package scanning not configured
ResourceConfig missing register/package
provider not annotated with @Provider
server/app JSON provider conflict
```

For shaded/fat jar:

```text
META-INF/services must be merged
```

Fix:

```text
merge service descriptors
explicitly register providers
test final artifact, not only IDE classpath
```

Smoke test:

```text
GET JSON endpoint
POST JSON endpoint
validation error
exception mapper
multipart if used
```

---

## 9. HK2/CDI Injection Failure

Symptoms:

```text
UnsatisfiedDependencyException
MultiException
Null injection
provider not managed
resource constructor not called as expected
```

Causes:

```text
HK2 binder missing
CDI feature missing
beans.xml/discovery issue
Jersey-CDI integration mismatch
manual object construction
dependency not registered
server feature not enabled
```

Fix:

```text
make injection ownership explicit
register binder/features
enable CDI/server feature
use managed components
integration test on target runtime
```

Mental model:

```text
Jersey-managed object != CDI-managed object unless integration exists.
```

---

## 10. Configuration Startup Failure

Symptoms:

```text
missing env var
invalid URI
invalid integer
secret not mounted
wrong ConfigMap key
startup validation fails
readiness never true
```

This is often desirable if config is unsafe.

Good failure:

```text
Missing required config: DB_URL
```

Bad failure:

```text
NullPointerException during first request
```

Fix:

```text
typed config
startup validation
safe error messages
config schema
effective config log with redaction
```

Kubernetes diagnostics:

```bash
kubectl describe pod
kubectl logs pod
kubectl get configmap
kubectl get secret
```

---

## 11. Port Bind Failure

Symptoms:

```text
Address already in use
connection refused
container starts then exits
Kubernetes readiness fails
```

Causes:

```text
port already used
app binds localhost instead of 0.0.0.0
containerPort/probe port mismatch
server config wrong
Open Liberty/Tomcat port not matching Service
```

Fix:

```text
bind 0.0.0.0 in container
align APP_PORT, server port, Docker EXPOSE, K8s containerPort, Service targetPort
```

Diagnostic:

```bash
kubectl port-forward
kubectl describe pod
netstat/ss inside container if available
```

---

## 12. JNDI/Server Resource Missing

Managed server symptoms:

```text
NameNotFoundException
No suitable datasource
deployment fails
first DB call fails
```

Causes:

```text
JDBC resource not created
wrong JNDI name
resource targeted to wrong server/cluster
driver missing from server lib
credential invalid
connection pool ping fails
```

Fix:

```text
provision resources as code
startup validation
stable JNDI names across environments
server logs/admin tooling
```

For Payara/GlassFish:

```text
asadmin scripts should be part of release
```

For Open Liberty:

```text
server.xml datasource config must be versioned
```

---

## 13. Server Feature Missing

Open Liberty example:

```text
app uses Jakarta REST but restfulWS feature missing
app uses CDI but cdi feature missing
app uses JPA but persistence feature missing
```

Symptoms:

```text
deployment failure
annotations ignored
injection unavailable
endpoint not exposed
```

Fix:

```xml
<featureManager>
    <feature>restfulWS-3.1</feature>
    <feature>cdi-4.0</feature>
</featureManager>
```

Rule:

```text
Feature-based runtimes fail by missing capability.
Full app servers fail by conflict/ownership more often.
```

---

## 14. Docker Image Startup Failure

Symptoms:

```text
container exits immediately
image pull works but app not running
permission denied
file not found
invalid entrypoint
Java not found
no main manifest attribute
```

Causes:

```text
wrong COPY path
non-root user cannot read/write
ENTRYPOINT wrong
fat jar missing Main-Class
line endings CRLF in script
script not executable
working directory wrong
```

Fix:

```text
docker run locally
inspect image
use exec-form ENTRYPOINT
chmod scripts
run as non-root with correct permissions
test final image
```

---

## 15. Kubernetes Startup Failure

Symptoms:

```text
CrashLoopBackOff
ImagePullBackOff
CreateContainerConfigError
ErrImagePull
readiness never true
startup probe failing
```

Diagnostics:

```bash
kubectl describe pod <pod>
kubectl logs <pod>
kubectl logs <pod> --previous
kubectl get events --sort-by=.lastTimestamp
```

Common causes:

```text
image tag/digest wrong
secret/configmap missing
env var reference invalid
volume mount invalid
security context blocks writes
startup probe path wrong
Java version mismatch
app exits due config validation
```

Do not debug only app code. Inspect Pod events.

---

## 16. Runtime Failure Overview

Runtime failure means app was ready, then degraded.

Categories:

```text
traffic spike
thread pool exhaustion
DB pool exhaustion
dependency slow/down
timeout mismatch
retry storm
memory leak
GC pressure
CPU throttling
event loop blocking
connection leak
file descriptor leak
security/auth outage
proxy/gateway issue
```

Runtime failures are often cascading.

Example:

```text
downstream slow
  ↓
threads block
  ↓
queue grows
  ↓
latency rises
  ↓
gateway timeouts
  ↓
clients retry
  ↓
traffic multiplies
  ↓
all pods saturated
```

---

## 17. Thread Pool Exhaustion

Symptoms:

```text
latency high
requests hang
active threads near max
thread dumps show many WAITING/TIMED_WAITING
readiness slow
gateway 504
```

Causes:

```text
DB slow
downstream slow
large synchronous work
executor queue full
common pool blocked
deadlock
lock contention
```

Diagnostics:

```text
thread dump
server thread metrics
DB pool pending
HTTP client pool pending
traces
dependency latency
```

Fix:

```text
timeouts
bulkheads
reduce blocking
increase capacity only if bottleneck supports it
load shedding
job model for long work
```

---

## 18. DB Pool Exhaustion

Symptoms:

```text
connection acquisition timeout
DB pool active=max
pending/waiting high
threads waiting on getConnection
```

Causes:

```text
slow queries
connection leak
pool too small
replica count too high
long transactions
DB overloaded
```

Diagnostics:

```text
pool metrics
thread dump
DB active sessions
slow query log
leak detection
recent deployment/config
```

Fix:

```text
close connections
optimize queries
set query/acquisition timeout
size pool by max replicas
separate bulkheads
do not simply increase pool without DB capacity
```

---

## 19. HTTP Client Pool Exhaustion

Symptoms:

```text
waiting for connection from pool
downstream calls time out
one dependency starves others
```

Causes:

```text
response not closed
pool too small
downstream slow
connection leak
single shared pool
stale connections
```

Fix:

```text
close response body
per-dependency pool
connect/read/call timeout
idle eviction
bulkhead/circuit breaker
```

For Jersey Client:

```java
try (Response response = target.request().get()) {
    return response.readEntity(String.class);
}
```

---

## 20. Event Loop Blocking

Netty failure.

Symptoms:

```text
all connections assigned to loop slow
event loop lag high
thread dump shows nioEventLoopGroup blocked
low CPU but high timeout
```

Causes:

```text
blocking DB call on event loop
synchronized lock held during blocking
Thread.sleep on event loop
heavy JSON/CPU work on event loop
```

Fix:

```text
offload blocking work
use bounded worker executor
monitor event loop lag
avoid blocking APIs on event loop
```

---

## 21. Memory Leak

Symptoms:

```text
heap grows over time
GC frequency increases
eventual OutOfMemoryError
Kubernetes OOMKilled
metaspace grows after redeploy
direct memory grows
```

Kinds:

```text
heap leak
metaspace/classloader leak
direct buffer leak
thread leak
connection leak
classloader redeploy leak
cache unbounded growth
MDC/ThreadLocal leak
```

Diagnostics:

```text
heap dump
JFR
GC logs
Native Memory Tracking
thread count
classloader count
direct buffer metrics
```

Fix depends on leak type.

---

## 22. OOMKilled vs Java OutOfMemoryError

Java OOM:

```text
OutOfMemoryError stack trace often visible
```

Container OOMKilled:

```text
exit code 137
Kubernetes reason OOMKilled
may have no Java stack trace
```

Causes beyond heap:

```text
direct memory
thread stacks
metaspace
native memory
mapped files
off-heap caches
container limit too low
```

Diagnose with:

```text
kubectl describe pod
memory metrics
GC logs
heap/non-heap metrics
NMT if enabled
```

Do not assume `-Xmx` is the only issue.

---

## 23. GC Pressure

Symptoms:

```text
latency spikes
CPU high
GC time high
full GC
allocation rate high
throughput drops
```

Causes:

```text
heap too small
large JSON payloads
excessive allocations
cache churn
memory leak
too many objects per request
```

Diagnostics:

```text
GC logs
JFR
allocation profiling
heap histogram
metrics
```

Fix:

```text
reduce allocation
tune heap/container memory
fix leak
paginate/stream large responses
avoid loading huge payload in memory
```

---

## 24. CPU Throttling

Kubernetes CPU limit can throttle Java process.

Symptoms:

```text
latency high
CPU usage appears at limit
throttling metrics high
GC slower
timeouts under load
```

Causes:

```text
CPU limit too low
too many threads
CPU-heavy endpoint
JSON serialization heavy
compression/encryption/report generation
```

Fix:

```text
increase CPU request/limit
optimize CPU work
separate CPU-heavy endpoints
async job model
avoid excessive threads
```

---

## 25. Proxy/Gateway Runtime Failure

Symptoms:

```text
502
503
504
413
431
CORS failure
wrong redirect
wrong client IP
```

Causes:

```text
backend unhealthy
timeout mismatch
body/header limit
path rewrite mismatch
forwarded headers wrong
TLS mismatch
no ready endpoints
```

Diagnostics:

```text
gateway access logs
upstream latency
Jersey logs
Kubernetes endpoints
curl through ingress vs service vs pod
```

Fix depends on source layer.

Always identify which layer generated status.

---

## 26. Security Runtime Failure

Symptoms:

```text
all requests 401
valid users get 403
JWT validation fails
CORS preflight fails
cookie not sent
redirect loop
```

Causes:

```text
JWKS unavailable
issuer/audience config wrong
clock skew
gateway stripping Authorization
CORS misconfig
SameSite cookie issue
forwarded proto missing
domain authorization bug
```

Diagnostics:

```text
auth failure logs by reason
token claims
issuer/JWKS reachability
gateway header logs
browser network tab
server clock
```

Do not log full tokens.

---

## 27. Dependency Outage

Symptoms:

```text
timeouts
circuit breaker open
fallback active
503 dependency unavailable
thread pool saturation
```

Causes:

```text
downstream down
DNS failure
network policy
TLS/cert expiry
rate limit
DB unavailable
credential expired
```

Diagnostics:

```text
dependency metrics
traces
DNS tests
TLS errors
network policy events
secret/config changes
```

Fix:

```text
timeouts
circuit breaker
fallback if safe
retry with jitter only if safe
dependency owner escalation
```

---

## 28. Redeploy Failure Overview

Redeploy means replacing app without fully replacing runtime.

Common in:

```text
Tomcat WAR redeploy
Jetty WAR redeploy
Payara/GlassFish redeploy
Open Liberty app update
```

Risks:

```text
classloader leak
thread leak
JDBC driver leak
MDC/ThreadLocal leak
static singleton leak
old app still referenced
file lock
partial deploy
old/new config mismatch
JPA/metamodel cache issue
```

Container image immutable deployment avoids some redeploy issues by replacing process/pod, but rolling update still has old/new version coexistence.

---

## 29. Classloader Leak

Tomcat documentation describes a JRE Memory Leak Prevention Listener that works around cases where JRE code uses the context class loader to load singleton objects, which can cause memory leaks if a web application class loader is the context class loader at that time.

Classloader leak symptoms:

```text
metaspace grows after each redeploy
old classes still retained
old threads still running
OutOfMemoryError: Metaspace
```

Common causes:

```text
static references
ThreadLocal values
unclosed executor
JDBC driver registration
logging framework references
MBeans
Timer threads
custom classloaders
JRE singleton initialized with webapp classloader
```

Fix:

```text
close resources on undeploy
remove ThreadLocals
deregister drivers/MBeans if needed
avoid app classes in global singletons
restart process instead of hot redeploy where possible
```

---

## 30. Thread Leak on Redeploy

Symptoms:

```text
old app threads still alive after undeploy
classloader retained
shutdown hangs
duplicate scheduled jobs
```

Causes:

```text
Executors.newScheduledThreadPool not shutdown
Timer not cancelled
HTTP client dispatcher not closed
telemetry exporter not closed
custom background worker not stopped
```

Fix:

```java
@PreDestroy
public void close() {
    executor.shutdown();
}
```

or:

```java
public void contextDestroyed(ServletContextEvent sce) {
    executor.shutdownNow();
}
```

Prefer managed executors in Jakarta EE.

---

## 31. JDBC Driver Leak

In servlet containers, webapp may register JDBC driver.

On redeploy, if driver remains registered in global `DriverManager`, old classloader can leak.

Mitigation:

```text
server-managed datasource
driver in server/lib if appropriate
deregister driver on undeploy if app registers
use container leak detection
```

For modern frameworks/containers, some cleanup happens, but do not rely blindly.

---

## 32. ThreadLocal/MDC Leak

Thread pools reuse threads.

If app stores per-request data in ThreadLocal/MDC and does not clear:

```text
next request may see stale data
memory retained
classloader retained on redeploy
```

Pattern:

```java
try {
    MDC.put("requestId", requestId);
    chain();
} finally {
    MDC.remove("requestId");
}
```

Always clear in finally.

Async and virtual thread models need propagation/cleanup strategy.

---

## 33. Rolling Update Failure

Kubernetes rolling update failure modes:

```text
new pods never ready
readiness passes too early
old pods terminated too fast
maxUnavailable too high
resource capacity insufficient for surge
new version incompatible with DB
config missing
image pull failure
```

Diagnostics:

```bash
kubectl rollout status deployment/case-api
kubectl describe deployment case-api
kubectl describe pod <new-pod>
kubectl logs <new-pod>
kubectl get rs
```

Fix:

```text
readiness correctness
startup probe
maxUnavailable/maxSurge
rollback
schema compatibility
config validation
```

---

## 34. Old/New Version Compatibility

During rolling update, old and new versions coexist.

Must be compatible for:

```text
database schema
message format
cache format
API contracts
idempotency records
feature flags
background jobs
scheduled tasks
```

Bad:

```text
new version writes column old version cannot read
```

Good:

```text
expand-contract migration
backward-compatible schema
feature flag rollout
```

Deployment is distributed, not instant.

---

## 35. Shutdown Failure Overview

Shutdown failure means app does not stop cleanly.

Symptoms:

```text
requests dropped
pod killed after grace period
logs missing final flush
DB transactions aborted unexpectedly
background job duplicated
JVM hangs
Kubernetes force kills container
old process keeps running
```

Shutdown must handle:

```text
stop accepting traffic
drain in-flight requests
stop background workers
close HTTP clients/DB pools
flush telemetry/logs
release locks
mark job state
exit before grace period
```

---

## 36. Kubernetes Termination Semantics

Kubernetes Pod lifecycle documentation states that when a container enters Terminated state, you can see reason, exit code, and timing, and if a PreStop hook is configured it runs before the container enters Terminated state.

Kubernetes container lifecycle hook docs also note that if a PreStop hook hangs, the Pod remains Terminating until killed after `terminationGracePeriodSeconds`.

Implication:

```text
PreStop time consumes shutdown grace.
```

Do not spend entire grace period sleeping in PreStop.

---

## 37. SIGTERM Handling

Docker/Kubernetes send termination signal.

For Java:

```text
SIGTERM triggers JVM shutdown hooks
```

if JVM receives it.

Bad shell entrypoint:

```bash
java -jar app.jar
```

Good:

```bash
exec java -jar app.jar
```

If shell is PID 1 and does not forward signal, JVM may not shut down gracefully.

Use exec-form Docker ENTRYPOINT when possible.

---

## 38. Readiness on Shutdown

On shutdown:

```text
readiness should become false
```

so traffic stops.

Sequence:

```text
SIGTERM
  ↓
mark not ready
  ↓
allow endpoint removal propagation
  ↓
drain in-flight
  ↓
close server/resources
  ↓
exit
```

If readiness stays true until process dies:

```text
new requests may arrive during shutdown
```

Server/framework behavior varies.

Test it.

---

## 39. In-Flight Request Drain

Short requests:

```text
wait until completion within grace
```

Long requests:

```text
may exceed termination grace
```

Options:

```text
increase grace
make operation async job
support cancellation
return 503 during draining
client retry/idempotency
```

For critical state-changing writes, ensure:

```text
transaction boundaries safe
idempotency exists
audit consistency
```

---

## 40. Background Job Shutdown

Background jobs must be coordinated.

Problems:

```text
job killed mid-work
two pods run same scheduled task
old pod still processing after new pod starts
lock not released
message not acked correctly
```

Solutions:

```text
distributed lock with TTL
leader election
job checkpointing
message ack after success
idempotent processing
graceful worker shutdown
```

Do not run critical scheduled jobs in every replica unless designed.

---

## 41. Telemetry Flush

Tracing/logging exporters may buffer.

On shutdown:

```text
flush spans
flush logs
flush metrics
close exporters
```

If not:

```text
last errors/disconnect cause missing
```

But do not block shutdown forever.

Use bounded flush timeout.

---

## 42. Failure Mode Diagnostic Matrix

| Symptom | Likely Layer | First Checks |
|---|---|---|
| `UnsupportedClassVersionError` | Java version | runtime Java, build `--release` |
| `ClassNotFoundException javax/jakarta` | namespace mismatch | server/Jersey generation |
| `MessageBodyWriter not found` | provider packaging | JSON provider, service files |
| 404 all endpoints | mapping/bootstrap | context path, ApplicationPath, ResourceConfig |
| 500 on injection | CDI/HK2 | binder/feature/discovery |
| readiness never true | startup/config/dependency | logs, probes, config |
| 502 | proxy/backend | gateway logs, app port, TLS |
| 503 | readiness/overload | endpoints, readiness reason |
| 504 | timeout | timeout chain, thread dumps |
| OOMKilled | memory/cgroup | pod describe, memory metrics |
| Metaspace leak | redeploy/classloader | classloader/thread leak |
| Terminating stuck | shutdown/preStop | lifecycle hook, thread dump |
| Rollout stalled | Kubernetes | new pod readiness/events |

---

## 43. Startup Runbook

When app does not start:

```text
1. Check process/container status.
2. Read startup logs.
3. Check Java version.
4. Check config/env/secret availability.
5. Check port bind.
6. Check classpath/dependency errors.
7. Check javax/jakarta mismatch.
8. Check Jersey providers/resources registered.
9. Check server-specific deployment logs.
10. Check readiness/startup probe path.
```

Commands:

```bash
kubectl describe pod <pod>
kubectl logs <pod>
kubectl logs <pod> --previous
kubectl get events --sort-by=.lastTimestamp
```

For WAR server:

```text
check server logs, not only app logs.
```

---

## 44. Runtime Incident Runbook

When service degrades:

```text
1. Identify user impact: latency/errors.
2. Identify source status: app/proxy/gateway.
3. Check recent changes: deploy/config/dependency.
4. Check pod health/restarts/OOM.
5. Check server thread metrics.
6. Check DB pool metrics.
7. Check dependency latency/errors.
8. Capture thread dump if saturation suspected.
9. Check GC/memory.
10. Check retry/circuit breaker/backpressure metrics.
```

Do not change random tuning before identifying bottleneck.

---

## 45. Redeploy Runbook

Before redeploy:

```text
[ ] old/new DB compatibility
[ ] old/new cache/message compatibility
[ ] readiness correct
[ ] rollback artifact available
[ ] resource capacity for surge
```

During redeploy:

```text
watch rollout
watch new pod logs
watch readiness
watch error/latency metrics
```

After redeploy:

```text
check old pods terminated
check no thread/classloader leaks if same server
check scheduled jobs not duplicated
check business metrics
```

For traditional WAR hot redeploy, strongly consider process restart if leak risk is high.

---

## 46. Shutdown Runbook

Test:

```text
docker stop
kubectl delete pod
rolling update under load
node drain
preStop behavior
SIGTERM handling
```

Verify:

```text
readiness false
no new traffic
in-flight requests finish or fail safely
resources close
process exits before grace
telemetry flushed
no duplicate background job
```

If pod is killed by SIGKILL:

```text
termination grace too short
shutdown hook hangs
preStop consumes time
non-daemon threads stuck
server not stopping
```

---

## 47. Failure Injection Tests

Test failure modes intentionally:

```text
missing config
wrong secret
DB down at startup
DB slow at runtime
downstream timeout
invalid JWT issuer
large request body
proxy timeout
SIGTERM during request
rolling update with traffic
Jersey provider missing in fat jar
wrong context path
memory pressure
CPU throttling
```

Use:

- integration tests,
- Docker Compose,
- Kubernetes test namespace,
- Toxiproxy,
- WireMock,
- chaos tools,
- load tests.

Reliability requires tested failure behavior.

---

## 48. Design for Safe Failure

Safe failure properties:

```text
fail fast on invalid config
fail closed on auth/security
fail with structured error
fail before exhausting all threads
fail without corrupting data
fail without duplicate side effects
fail without leaking secrets
fail with observability
fail in a way orchestration can handle
```

Bad failure:

```text
hang forever
retry forever
return 200 with wrong result
leak secret in stack trace
accept write twice
keep readiness green while broken
```

---

## 49. Common Anti-Patterns

### Anti-Pattern 1 — Debug by Guessing

Change timeout/thread/pool randomly.

### Anti-Pattern 2 — Startup Validation Missing

App becomes ready then fails first request.

### Anti-Pattern 3 — Readiness Always 200

Kubernetes sends traffic to broken app.

### Anti-Pattern 4 — Hot Redeploy Forever

Classloader leaks accumulate.

### Anti-Pattern 5 — Shutdown Ignored

Rollout drops user requests.

### Anti-Pattern 6 — No Thread Dump Access

Java incident diagnosis blocked.

### Anti-Pattern 7 — Retry as Recovery Strategy

Retry storm.

### Anti-Pattern 8 — Only App Logs, No Platform Events

Miss OOMKilled/probe/image/config failures.

### Anti-Pattern 9 — No Old/New Compatibility

Rolling update breaks data/schema/message compatibility.

### Anti-Pattern 10 — No Failure Testing

First test happens in PROD.

---

## 50. Production Readiness Checklist

```text
[ ] Java runtime version aligned with build.
[ ] javax/jakarta generation validated.
[ ] Dependency convergence checked.
[ ] Final artifact smoke-tested.
[ ] Jersey resources/providers registered/tested.
[ ] JSON provider tested.
[ ] Config validates at startup.
[ ] Secrets/config mounts tested.
[ ] Server features/resources provisioned as code.
[ ] Health/readiness/startup probes correct.
[ ] Thread pool metrics available.
[ ] DB/HTTP pool metrics available.
[ ] Timeout/retry/circuit metrics available.
[ ] OOMKilled detection/alerting configured.
[ ] Thread dump procedure documented.
[ ] Heap/JFR policy defined.
[ ] Graceful shutdown tested.
[ ] Readiness false during shutdown tested.
[ ] Rolling update under load tested.
[ ] Old/new schema compatibility plan.
[ ] Redeploy/classloader leak strategy defined.
[ ] Background jobs idempotent and shutdown-safe.
[ ] Failure injection tests run.
[ ] Runbooks exist for startup/runtime/redeploy/shutdown.
```

---

## 51. Top-Tier Engineering Perspective

A basic engineer says:

```text
It works on my machine.
```

A senior engineer asks:

```text
Does it start in the target container/server?
```

A top-tier engineer defines:

```text
- startup validation
- classpath/provider verification
- readiness semantics
- runtime saturation controls
- dependency failure behavior
- redeploy leak prevention
- rolling update compatibility
- graceful shutdown sequence
- diagnostic evidence collection
- failure injection coverage
```

Failure modes are not exceptions to architecture.

They are architecture.

---

## 52. Summary

Jersey deployment failures occur across lifecycle stages:

```text
startup:
  Java version, namespace, classpath, config, resources, probes

runtime:
  saturation, dependency failure, timeouts, memory, proxy/security issues

redeploy:
  classloader leaks, old/new incompatibility, partial rollout

shutdown:
  dropped requests, stuck hooks, leaked resources, killed pods
```

The best systems are designed to fail safely:

```text
fail fast
fail closed
fail bounded
fail observable
fail recoverably
```

Top-tier conclusion:

> Production-readiness is not proven by successful startup.  
> It is proven by controlled behavior across startup, runtime stress, redeploy, and shutdown.

---

## 53. How This Part Connects to the Next Part

This part covered lifecycle failure modes.

Next:

```text
Part 29 — Performance Engineering for Deployment Models
```

We will focus on:

- startup time,
- throughput,
- latency,
- p99,
- allocation rate,
- JSON serialization,
- thread/pool tuning,
- warmup,
- GC,
- container CPU/memory,
- benchmark methodology,
- and how performance differs between WAR, embedded, Netty, Liberty, Payara, and Kubernetes deployments.

---

## References

- Jersey documentation — Application Deployment and Runtime: https://eclipse-ee4j.github.io/jersey.github.io/documentation/2.28/deployment.html
- Apache Tomcat LifeCycle Listener — JRE Memory Leak Prevention Listener: https://tomcat.apache.org/tomcat-9.0-doc/config/listeners.html
- Apache Tomcat JRE Memory Leak Prevention Listener API: https://tomcat.apache.org/tomcat-10.0-doc/api/org/apache/catalina/core/JreMemoryLeakPreventionListener.html
- Kubernetes Pod Lifecycle: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
- Kubernetes Container Lifecycle Hooks: https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/
- Open Liberty getting started — logs and FFDC: https://openliberty.io/guides/getting-started.html
- IBM documentation — Troubleshooting Liberty: https://www.ibm.com/docs/en/was-liberty/base?topic=troubleshooting-liberty

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-027.md">⬅️ Part 27 — Observability per Deployment Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-029.md">Part 29 — Performance Engineering for Deployment Models ➡️</a>
</div>
