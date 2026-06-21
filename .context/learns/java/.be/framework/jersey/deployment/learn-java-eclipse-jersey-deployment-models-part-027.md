# learn-java-eclipse-jersey-deployment-models-part-027  
# Part 27 — Observability per Deployment Model

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 27 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami observability aplikasi Jersey secara production-grade di berbagai deployment model.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: logs, access logs, metrics, traces, correlation ID, health/readiness, JVM telemetry, runtime-specific observability, Kubernetes signals, dashboards, alerting, dan incident diagnostics.

---

## 1. Mengapa Observability Bukan Sekadar Logging?

Banyak tim merasa sudah “observable” karena aplikasi menulis log.

Padahal production incident sering membutuhkan jawaban yang log saja tidak cukup:

```text
Apakah request masuk ke proxy?
Apakah request sampai ke Jersey?
Berapa latency di gateway vs app?
Apakah 504 berasal dari ingress atau dari app?
Apakah thread pool penuh?
Apakah DB pool menunggu koneksi?
Apakah GC pause naik?
Apakah pod OOMKilled?
Apakah readiness flapping?
Apakah dependency circuit breaker open?
Apakah error hanya di satu replica?
Apakah release versi baru menyebabkan p99 naik?
```

Observability harus menjawab:

```text
What happened?
Where did it happen?
Why did it happen?
Who/what was affected?
Is it still happening?
How bad is it?
What changed?
```

Top-tier mental model:

> Logging adalah salah satu sinyal.  
> Observability adalah kemampuan memahami internal state sistem dari sinyal eksternal: logs, metrics, traces, events, health, profiles, dumps, dan audit.

---

## 2. The Three Pillars and Beyond

Kubernetes documentation describes observability as collecting and analyzing metrics, logs, and traces, often called the three pillars of observability, to understand internal state, performance, and health of a cluster.

For Jersey services, the pillars are:

```text
Logs:
  discrete events and textual/structured records

Metrics:
  numeric time-series

Traces:
  request journey across services/components
```

But production needs more:

```text
health/readiness
JVM telemetry
thread dumps
heap dumps
GC logs
access logs
Kubernetes events
deployment events
audit logs
configuration snapshots
profiling/JFR
```

Observability maturity is not “we have dashboards”.

It is:

```text
we can diagnose failure quickly and safely.
```

---

## 3. Observability Layers

A Jersey request can pass through:

```text
Client
  ↓
CDN/WAF
  ↓
API Gateway / Ingress
  ↓
Kubernetes Service / Load Balancer
  ↓
Container
  ↓
Server runtime
  ↓
Jersey filters/resources
  ↓
Service/domain code
  ↓
DB/downstream/cache/message broker
```

Each layer emits different signals.

Layer map:

| Layer | Key Signals |
|---|---|
| Gateway/proxy | access log, upstream latency, 4xx/5xx, route |
| Kubernetes | pod status, restarts, events, probes, resource usage |
| JVM | heap, GC, threads, classloading, direct memory |
| Server | request threads, connector metrics, access logs |
| Jersey | request filters, resource latency, exception mappers |
| App/domain | business events, use-case success/failure |
| Dependencies | DB pool, HTTP client latency, queue depth |
| Security/audit | auth decisions, denied access, sensitive actions |

If you observe only Jersey logs, you miss the system.

---

## 4. Golden Signals

Useful service-level signals:

```text
Latency:
  how long requests take

Traffic:
  request rate / throughput

Errors:
  error rate by code/type

Saturation:
  how full resources are
```

For Jersey:

```text
Latency:
  p50/p95/p99 per endpoint/status

Traffic:
  RPS per endpoint/method

Errors:
  4xx/5xx by endpoint/error code

Saturation:
  thread pool usage
  DB pool active/pending
  executor queue depth
  CPU/memory
  GC pressure
```

Do not alert only on CPU.

Many Java outages happen with normal CPU but saturated DB pool or blocked threads.

---

## 5. RED and USE

### RED for request services

```text
Rate
Errors
Duration
```

For Jersey endpoint:

```text
http.server.requests.rate
http.server.requests.errors
http.server.requests.duration
```

### USE for resources

```text
Utilization
Saturation
Errors
```

For DB pool:

```text
utilization:
  active connections / max

saturation:
  pending threads waiting

errors:
  connection acquisition timeout
```

Use both RED and USE.

---

## 6. Structured Logging

Plain text logs are hard to query.

Prefer structured logs:

```json
{
  "timestamp": "2026-06-21T10:15:30Z",
  "level": "INFO",
  "service": "case-api",
  "version": "1.0.0",
  "requestId": "req-123",
  "traceId": "abc",
  "spanId": "def",
  "method": "POST",
  "path": "/api/cases",
  "status": 201,
  "durationMs": 42,
  "message": "case created"
}
```

Fields to standardize:

```text
timestamp
level
service
environment
version
pod/instance
requestId
traceId
spanId
user/principal safe id
method
path template
status
duration
error code
exception type
```

Avoid raw full URLs if they contain sensitive query params.

---

## 7. Log Levels

Use levels consistently:

```text
TRACE:
  local deep debugging, usually disabled

DEBUG:
  diagnostic details, non-prod or temporary

INFO:
  important lifecycle/business/system events

WARN:
  unexpected but handled condition

ERROR:
  failed operation needing attention
```

Bad:

```text
log every request body at INFO
log expected validation errors as ERROR
log stack trace for normal 404
```

Good:

```text
validation error:
  INFO/DEBUG with safe summary

dependency timeout:
  WARN or ERROR depending impact

unhandled exception:
  ERROR with requestId
```

Log volume is an operational cost.

---

## 8. Request Logging in Jersey

Jersey filter can log request/response summary.

Example concept:

```java
@Provider
public class RequestLogFilter
        implements ContainerRequestFilter, ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext request) {
        request.setProperty("startedNanos", System.nanoTime());
    }

    @Override
    public void filter(ContainerRequestContext request,
                       ContainerResponseContext response) {
        long started = (long) request.getProperty("startedNanos");
        long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);

        // log method, path template if available, status, duration, requestId
    }
}
```

Be careful:

```text
Do not log Authorization header.
Do not log Cookie header.
Do not log full body by default.
Do not log PII-heavy payload.
```

For access-like logs, server/proxy access log may be better.

For app context, Jersey filter is useful.

---

## 9. Access Logs vs Application Logs

Access log:

```text
HTTP request record
```

Application log:

```text
application/domain event
```

Access log fields:

```text
remote IP
method
path
status
bytes
duration
user agent
request ID
upstream time
```

Application log fields:

```text
use case
business id
domain outcome
dependency status
exception context
```

Do not mix them blindly.

You need both.

---

## 10. Tomcat Observability

Tomcat provides:

```text
access logs via AccessLogValve
JMX monitoring
thread/connector metrics
server logs
manager/status tools if enabled
```

Tomcat documentation says Access Log Valve creates log files in the same format as standard web servers, suitable for analysis by log tools.

Tomcat monitoring documentation describes JMX-based monitoring and management, including JMXProxyServlet for JMX queries via HTTP interface.

For Jersey on Tomcat, observe:

```text
http-nio threads busy/idle
maxThreads
currentThreadCount
currentThreadsBusy
request count
error count
processing time
bytes sent/received
access log status/latency
WAR deployment errors
GC/JVM metrics
```

Common Tomcat incident signals:

```text
currentThreadsBusy near max
DB pool pending high
access log duration high
gateway 504 high
```

---

## 11. Jetty Observability

Jetty observability depends on setup:

```text
JMX modules
request logs
thread pool metrics
server/connector stats
application metrics
```

For Jersey on Jetty, observe:

```text
QueuedThreadPool busy threads
queue size
connector connections
request duration
handler errors
JVM metrics
access/request logs
```

Thread names often:

```text
qtp...
```

Incident clue:

```text
qtp threads blocked on DB or downstream
```

Jetty external and embedded need different collection setup, but same concepts.

---

## 12. Grizzly Observability

Embedded Grizzly needs explicit observability.

Observe:

```text
worker thread pool
selector/thread metrics if available
request latency
active connections
error count
Jersey exceptions
JVM metrics
custom app metrics
```

Because embedded runtimes often lack rich preconfigured ops tooling, you must add:

```text
structured logs
metrics endpoint
health endpoint
JFR/GC logging support
thread dump procedure
```

Do not assume embedded means invisible.

---

## 13. Netty Observability

For Netty-based Jersey deployment, observe:

```text
event loop lag
event loop thread blocking
active connections
direct memory
ByteBuf leak detector output
request latency
offload executor queue
channel errors
connection resets
backpressure/writability
```

Netty failures often appear as:

```text
low CPU
high latency
few event loop threads blocked
many requests timing out
```

Thread dump is critical.

If event loop threads are waiting on DB/HTTP/lock, the deployment model is wrong.

---

## 14. JDK HTTP Server Observability

JDK HTTP Server is minimal.

If using it with Jersey, you must provide:

```text
explicit executor metrics
request logs
health endpoints
JVM metrics
thread dump plan
access-like logging
```

If you set custom executor, instrument it:

```text
active count
pool size
queue size
completed tasks
rejections
```

Minimal runtime means observability is your responsibility.

---

## 15. Payara/GlassFish Observability

Managed servers provide:

```text
server logs
admin console
JMX/monitoring
HTTP listener metrics
JDBC pool metrics
deployment status
transaction/JPA metrics depending config
```

For Jersey/Jakarta REST on Payara/GlassFish, observe:

```text
JDBC pool active/free/wait
HTTP thread pools
transaction failures
deployment errors
CDI startup errors
JPA persistence errors
resource lookup failures
access logs
security/audit events
```

Because server manages resources, app-level metrics alone are insufficient.

If DB pool is server-managed, app cannot see it unless exposed through server metrics/JMX/admin tooling.

---

## 16. Open Liberty Observability

Open Liberty has strong MicroProfile integration.

Open Liberty MicroProfile Health docs describe endpoints such as `/health/ready` for readiness and related health endpoints.

Open Liberty MicroProfile Metrics documentation states that MicroProfile metrics provides a `/metrics` endpoint for metrics emitted by the server and deployed applications.

Observe:

```text
/health/ready
/health/live
/health/started
/metrics
server messages
application logs
JVM metrics
HTTP metrics
thread pool
JDBC/JPA if configured
```

Open Liberty pairs well with Kubernetes probes and Prometheus-style scraping.

But protect sensitive endpoints where needed.

---

## 17. Kubernetes Observability

Kubernetes adds signals:

```text
pod phase
container state
restart count
last termination state
events
readiness/liveness/startup probe failures
OOMKilled
CrashLoopBackOff
image pull errors
scheduling failures
CPU/memory usage
network errors
node pressure
rollout status
ReplicaSet changes
```

Commands:

```bash
kubectl get pods
kubectl describe pod <pod>
kubectl logs <pod>
kubectl logs <pod> --previous
kubectl get events --sort-by=.lastTimestamp
kubectl rollout status deployment/<name>
```

Important:

```text
Application logs alone may not show OOMKilled.
Kubernetes events may not show app stack trace.
You need both.
```

---

## 18. Metrics

Metrics should be low-cardinality, numeric, aggregatable.

Good dimensions:

```text
service
environment
version
method
route template
status class
dependency name
exception type
```

Dangerous high-cardinality labels:

```text
user id
email
full URL with IDs/query
request id
raw exception message
case id
token
```

Example HTTP metrics:

```text
http_server_requests_seconds_count
http_server_requests_seconds_sum
http_server_requests_seconds_bucket
http_server_requests_active
```

Use route template:

```text
/cases/{id}
```

not:

```text
/cases/123456789
```

---

## 19. Histograms and Percentiles

Average latency hides pain.

Need:

```text
p50
p95
p99
max maybe
histogram buckets
```

Example:

```text
average:
  100ms

p99:
  5s
```

Users feel p99.

Dashboards should show percentile latency by route/status.

Be careful with client-side percentile aggregation; prefer histograms where possible.

---

## 20. Tracing

Tracing shows request journey.

OpenTelemetry describes itself as an open-source observability framework for cloud-native software, providing APIs, libraries, agents, and collector services to capture distributed traces and metrics.

For Java, OpenTelemetry documentation introduces APIs/SDKs for metrics, logs, and traces.

Trace spans:

```text
HTTP server span
Jersey resource span
DB query span
HTTP client span
message publish span
cache call span
```

Trace context headers:

```text
traceparent
tracestate
baggage
```

Goal:

```text
for requestId/traceId, see where time was spent.
```

---

## 21. Auto-Instrumentation vs Manual Instrumentation

### Auto-Instrumentation

Java agent:

```bash
-javaagent:/otel/opentelemetry-javaagent.jar
```

Pros:

- fast adoption,
- instruments common libraries,
- fewer code changes.

Cons:

- less domain context,
- version compatibility,
- overhead/config tuning,
- may miss custom code.

### Manual Instrumentation

Add spans/metrics in code.

Pros:

- domain-specific visibility,
- precise boundaries,
- better business signals.

Cons:

- more code,
- instrumentation discipline needed.

Best approach:

```text
auto-instrument platform/library calls
manual-instrument important domain operations
```

---

## 22. Correlation ID vs Trace ID

Correlation ID:

```text
business/debug request identifier
often from gateway/client
used in logs/responses
```

Trace ID:

```text
distributed tracing identifier
generated/propagated by tracing system
```

They may be same or different.

Best practice:

```text
include both in logs if available
return requestId in response header
propagate trace context downstream
```

Response header:

```text
X-Request-ID: ...
```

Log fields:

```text
requestId
traceId
spanId
```

---

## 23. Jersey Correlation Filter

Concept:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class CorrelationIdFilter
        implements ContainerRequestFilter, ContainerResponseFilter {

    private static final String HEADER = "X-Request-ID";

    @Override
    public void filter(ContainerRequestContext request) {
        String requestId = request.getHeaderString(HEADER);
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString();
        }

        request.setProperty("requestId", requestId);
        MDC.put("requestId", requestId);
    }

    @Override
    public void filter(ContainerRequestContext request,
                       ContainerResponseContext response) {
        Object requestId = request.getProperty("requestId");
        if (requestId != null) {
            response.getHeaders().putSingle(HEADER, requestId.toString());
        }
        MDC.remove("requestId");
    }
}
```

Caution:

```text
MDC with async/virtual threads needs propagation strategy.
Always clear MDC.
```

---

## 24. Exception Mapping and Observability

Global exception mapper should:

```text
map exceptions to safe error response
log unexpected errors
include requestId
avoid leaking stack trace to client
increment/emit metrics if framework does not
```

Example response:

```json
{
  "code": "INTERNAL_ERROR",
  "message": "Unexpected error occurred.",
  "requestId": "..."
}
```

Log:

```text
error code
exception class
request id
route
safe domain id if allowed
```

Do not log sensitive payload.

---

## 25. Health vs Metrics vs Logs

Health:

```text
binary/limited state for automation
```

Metrics:

```text
numeric trend for monitoring/alerting
```

Logs:

```text
event details for investigation
```

Do not put everything in health endpoint.

Bad health response:

```json
{
  "dbPassword": "...",
  "allConfig": "...",
  "last100Errors": "..."
}
```

Good:

```json
{
  "status": "UP",
  "checks": [
    {"name": "database", "status": "UP"}
  ]
}
```

Keep sensitive diagnostics protected separately.

---

## 26. Readiness Observability

Track readiness transitions.

Log:

```text
readiness changed from false to true
readiness changed from true to false reason=DB_POOL_EXHAUSTED
readiness false during shutdown
```

Metric:

```text
app_readiness_state
```

Kubernetes only sees current probe result.

Your logs/metrics should explain why readiness changed.

---

## 27. JVM Metrics

Collect:

```text
heap used/max
non-heap used
metaspace
GC count/time
thread count
daemon thread count
class loaded/unloaded
direct buffer memory
mapped buffer memory
CPU process/system
safepoint time if available
```

For Java 21/25:

```text
virtual thread metrics may require updated tooling
JFR can help
```

JVM metrics are essential for Java services.

---

## 28. GC Logs

GC logs answer:

```text
Are pauses causing latency?
Is heap too small?
Is allocation rate high?
Is full GC happening?
Is container memory too tight?
```

Modern flag:

```text
-Xlog:gc*:stdout:time,uptime,level,tags
```

In containers, stdout logs may be collected with app logs.

Be careful with volume.

For deep analysis, use JFR or dedicated GC log collection.

---

## 29. Thread Dumps

Thread dumps are crucial for:

```text
deadlocks
blocked DB calls
event loop blocking
thread pool exhaustion
shutdown hangs
lock contention
```

Incident procedure:

```bash
jcmd <pid> Thread.print
```

or:

```bash
kill -3 <pid>
```

In Kubernetes:

```bash
kubectl exec <pod> -- jcmd 1 Thread.print
```

if `jcmd` exists and JVM PID is 1.

Minimal images may lack tools.

Plan ahead.

---

## 30. Heap Dumps

Heap dumps help memory leaks but are sensitive.

They may contain:

```text
tokens
passwords
PII
request bodies
business data
```

If enabled:

```text
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
```

Ensure:

```text
secure volume
enough disk
access control
retention policy
incident handling
```

Do not casually upload heap dumps to public tools.

---

## 31. Java Flight Recorder

JFR is powerful for:

```text
CPU profiling
allocation profiling
lock contention
thread activity
GC events
I/O
method profiling
latency investigation
```

For production, JFR can often be used with lower overhead than ad-hoc profilers, but still needs policy.

Useful:

```bash
jcmd 1 JFR.start name=incident settings=profile duration=120s filename=/tmp/incident.jfr
```

Need:

- JDK/runtime support,
- storage,
- security process,
- analysis workflow.

---

## 32. Business Metrics

Technical metrics tell health.

Business metrics tell impact.

Examples:

```text
cases_created_total
case_approval_success_total
case_approval_failure_total
audit_write_failure_total
documents_uploaded_total
payment_submission_total
authorization_denied_total
```

Use labels carefully:

```text
module
operation
outcome
reason category
```

Do not label by caseId/userId.

Business metrics answer:

```text
Are users actually completing workflows?
```

---

## 33. Audit vs Observability

Audit logs:

```text
compliance/security evidence
```

Observability logs:

```text
operations/debugging
```

Do not mix retention/security model casually.

Audit requires:

- integrity,
- retention,
- access control,
- searchable identity/object/action,
- no excessive sensitive payload,
- tamper resistance depending requirement.

Observability logs can be more ephemeral.

---

## 34. Dependency Observability

For every dependency:

```text
base URL / target
request count
latency
error count
timeout count
retry count
circuit state
pool active/idle/pending
status code distribution
```

For DB:

```text
pool active/idle/pending
connection acquisition time
query latency
transaction duration
deadlocks/timeouts
slow query count
```

For Redis/cache:

```text
hit/miss
latency
error
connection count
eviction
```

For message broker:

```text
publish latency
consumer lag
ack/nack
reconnect count
```

---

## 35. Circuit Breaker Observability

If using circuit breakers:

Metrics/logs:

```text
state: closed/open/half-open
failure rate
slow call rate
not permitted calls
successful/failed calls
transition events
```

Alert:

```text
critical dependency circuit open sustained
```

Do not only alert on 5xx.

Circuit breaker opening may prevent 5xx explosion but still means degraded service.

---

## 36. Rate Limit and Backpressure Observability

Track:

```text
429 count
503 overload count
bulkhead rejected count
queue size
queue wait time
executor rejected count
readiness false reason
```

If you intentionally reject work, observe it.

Controlled overload is better than collapse, but it is still user impact.

---

## 37. Dashboards

Minimum dashboard sections:

```text
Service overview:
  RPS, error rate, p95/p99, saturation

Endpoint detail:
  latency/errors by route

Dependencies:
  DB, HTTP clients, cache, broker

JVM:
  heap, GC, threads, CPU

Kubernetes:
  pods, restarts, readiness, CPU/memory, OOMKilled

Deployment:
  version, rollout events, config version

Security/business:
  auth failures, authorization denials, audit failures
```

Dashboard should answer incident questions quickly.

---

## 38. Alerting Philosophy

Alert on user impact and actionable leading indicators.

Good alerts:

```text
5xx rate > threshold for 5 min
p99 latency > SLO for 10 min
readiness failing for > N pods
DB pool pending high
circuit breaker open for critical dependency
OOMKilled occurred
CrashLoopBackOff
audit write failures
```

Bad alerts:

```text
CPU > 70% once
one 500 error
debug log pattern
heap > 60% always
```

Alert fatigue kills response quality.

---

## 39. SLO and Error Budget

Define SLO:

```text
99.9% successful requests under 500ms over 30 days
```

Error budget:

```text
allowed unreliability
```

For Jersey service, define:

- availability,
- latency,
- correctness for critical workflows,
- dependency-specific degradation if relevant.

Do not treat all endpoints equally.

Example:

```text
/cases/{id} view:
  high availability

/report/export:
  lower latency SLO or async
```

---

## 40. Release Observability

Every log/metric/trace should identify version.

Fields:

```text
app.version
git.commit
build.id
image.digest
config.version
deployment.environment
```

When incident starts after deploy, you need correlation.

Kubernetes labels:

```yaml
labels:
  app: case-api
  version: "1.0.3"
```

Metrics labels should use low-cardinality version labels carefully.

---

## 41. Configuration Observability

Log safe effective config summary.

Metric/metadata:

```text
config version
feature flags state
dependency target names
pool sizes
timeout values
```

Do not expose secrets.

When config changes, record event:

```text
config changed from version A to B
```

Config incidents are common.

---

## 42. Logging in Containers

Container best practice:

```text
stdout/stderr
structured logs
platform collector
```

Avoid only writing to file unless collector reads file.

Server-specific logs must be routed:

```text
Tomcat catalina/access
Jetty request log
Liberty messages
Payara server logs
application logs
```

In Kubernetes, `kubectl logs` sees stdout/stderr, not arbitrary files unless redirected/collected.

---

## 43. Access Log in Proxy vs App

Proxy access log sees:

```text
external client
external route
upstream latency
gateway status
```

App access log sees:

```text
internal path
app status
app duration
server thread behavior
```

Both are useful.

Example 504:

```text
proxy status:
  504

app status:
  maybe no response or still processing
```

Need request ID to correlate.

---

## 44. Incident Playbook: 504

Check:

```text
gateway/proxy logs:
  upstream timeout?

app logs:
  request started/finished?

trace:
  where time spent?

metrics:
  p99 latency
  DB pool pending
  thread pool busy
  downstream timeout

Kubernetes:
  restarts?
  CPU throttling?
```

Likely causes:

```text
app slow
DB slow
downstream slow
thread pool saturated
timeout chain mismatch
```

Do not start by increasing gateway timeout blindly.

---

## 45. Incident Playbook: 503

Source matters.

503 from app:

```text
readiness false
overload rejection
circuit breaker open
maintenance mode
```

503 from gateway:

```text
no healthy upstream
no ready endpoints
target group unhealthy
```

Check:

```bash
kubectl get endpoints
kubectl describe pod
kubectl get events
gateway target health
app readiness logs
```

---

## 46. Incident Playbook: OOMKilled

Kubernetes shows:

```text
last state terminated reason OOMKilled
exit code 137
```

App may have no Java OOM stack trace.

Check:

```text
container memory usage
heap max
GC logs
direct memory
thread count
native memory
recent traffic
large payloads
heap dump if available
```

If Java heap was not full, suspect:

```text
direct buffers
thread stacks
metaspace
native memory
container limit too low
```

---

## 47. Incident Playbook: Thread Pool Exhaustion

Signals:

```text
request latency rises
server active threads near max
DB pool pending high
thread dumps show waiting
health slow
```

Actions:

```text
capture thread dump
check DB/downstream latency
check executor queue
check recent deployment/config
check incoming RPS
check retry storm
```

Do not simply raise thread count without identifying bottleneck.

---

## 48. Incident Playbook: Event Loop Blocking

Netty symptoms:

```text
event loop lag high
few event loop threads blocked
all routes slow
thread dump shows nioEventLoopGroup waiting
```

Fix:

```text
move blocking work off event loop
bound offload executor
add event loop lag alert
review integration
```

This is deployment-model specific.

---

## 49. Observability for Security

Track:

```text
401 rate
403 rate
auth failures by reason
JWT validation failures
expired token count
forbidden object access
CORS rejection
rate limit 429
SSRF block count
admin endpoint access
audit write failures
```

Security logs must avoid secrets.

For suspicious events, include request ID and safe principal.

---

## 50. OpenTelemetry Deployment Model

OpenTelemetry deployment options:

```text
Java agent directly exports to collector
application SDK exports to collector
sidecar collector
daemonset collector
gateway collector
```

Common Kubernetes pattern:

```text
app container
  ↓ OTLP
OpenTelemetry Collector
  ↓
backend: Prometheus/Tempo/Jaeger/Elastic/Datadog/etc.
```

Benefits:

- vendor-neutral instrumentation,
- consistent traces/metrics/logs,
- centralized export policy.

But configure:

```text
sampling
resource attributes
service.name
service.version
environment
exporter endpoint
security
```

---

## 51. Sampling

Tracing every request can be expensive.

Sampling strategies:

```text
always on in dev
ratio sampling in prod
tail-based sampling for errors/slow requests
parent-based sampling
```

For incident analysis, error/slow traces are valuable.

If sampling drops all rare failures, tracing loses value.

Design sampling policy intentionally.

---

## 52. Cardinality Control

High-cardinality metrics can break observability systems.

Bad labels:

```text
userId
requestId
caseId
email
full path with IDs
exception message
```

Good labels:

```text
route=/cases/{id}
status=2xx
method=GET
dependency=document-service
exception=TimeoutException
```

Logs can contain request ID.

Metrics should not.

---

## 53. Privacy and Data Governance

Observability data may contain sensitive information.

Protect:

```text
logs
traces
span attributes
metrics labels
heap dumps
JFR files
audit logs
access logs
```

Do not record:

```text
Authorization header
cookies
passwords
full PII payloads
credit card numbers
private keys
```

If logs are sent to third-party SaaS, check policy.

---

## 54. Production Observability Checklist

```text
[ ] Structured application logs.
[ ] Access logs enabled at proxy/server as needed.
[ ] Request ID generated/propagated.
[ ] Trace ID/span ID included in logs.
[ ] OpenTelemetry or equivalent tracing configured.
[ ] HTTP metrics by route/status/method.
[ ] Dependency metrics for DB/HTTP/cache/broker.
[ ] JVM metrics collected.
[ ] GC logging/JFR strategy defined.
[ ] Thread dump procedure documented.
[ ] Heap dump policy defined and secured.
[ ] Health/readiness endpoints implemented.
[ ] Readiness transition reasons logged.
[ ] Kubernetes events/restarts monitored.
[ ] OOMKilled/CrashLoopBackOff alerts.
[ ] Circuit breaker/bulkhead/retry metrics.
[ ] Dashboards include service/dependency/JVM/K8s layers.
[ ] Alerts tied to SLO/user impact.
[ ] Version/config metadata visible.
[ ] Sensitive data redaction policy enforced.
[ ] Audit logs separated from debug logs.
[ ] Incident playbooks exist for 500/503/504/OOM/thread exhaustion.
```

---

## 55. Anti-Patterns

### Anti-Pattern 1 — Only Logs, No Metrics

You cannot see trends or saturation.

### Anti-Pattern 2 — Only Metrics, No Logs

You know something is wrong but not what happened.

### Anti-Pattern 3 — Only App Observability, No Proxy/K8s

You miss routing, probe, OOM, and gateway failures.

### Anti-Pattern 4 — Full URL Metrics Labels

Cardinality explosion.

### Anti-Pattern 5 — Logging Secrets

Security incident.

### Anti-Pattern 6 — No Request ID

Multi-layer debugging becomes guesswork.

### Anti-Pattern 7 — Health Endpoint as Diagnostics Dump

Leaks internals.

### Anti-Pattern 8 — Alerting on Noise

Alert fatigue.

### Anti-Pattern 9 — No Version in Telemetry

Cannot correlate deploy with incident.

### Anti-Pattern 10 — No Thread Dump Capability

Java incident diagnosis crippled.

---

## 56. Decision Matrix

| Question | Signal |
|---|---|
| Is service receiving traffic? | RPS/access logs |
| Are users affected? | error rate, latency, business metrics |
| Is one endpoint slow? | route latency histogram |
| Is dependency slow? | dependency latency/traces |
| Is DB pool saturated? | pool active/pending/acquire time |
| Are threads exhausted? | thread pool metrics/thread dump |
| Is JVM memory issue? | heap/GC/OOMKilled/heap dump |
| Is gateway timing out? | proxy logs/upstream time |
| Is Kubernetes killing pods? | pod status/events/restarts |
| Did deploy cause issue? | version labels/rollout events |
| Is security being attacked? | auth failures/rate limits/security logs |
| Is app ready? | readiness metrics/probe logs |

---

## 57. Top-Tier Engineering Perspective

A basic engineer says:

```text
We have logs.
```

A senior engineer asks:

```text
Can we see latency and errors by endpoint?
```

A top-tier engineer defines:

```text
- signal ownership per layer
- correlation ID propagation
- route-level metrics
- dependency metrics
- JVM/server runtime metrics
- Kubernetes lifecycle observability
- trace sampling policy
- dashboards by failure mode
- alerts tied to SLO
- secure diagnostic artifact handling
- incident playbooks
```

Observability is not tool installation.

Observability is operational understanding.

---

## 58. Summary

Observability per Jersey deployment model means each runtime needs specific visibility.

Tomcat needs connector/thread/access/JMX signals.

Jetty needs thread pool/request/connector signals.

Grizzly/JDK HTTP need explicit app-added metrics.

Netty needs event loop and direct memory visibility.

Payara/GlassFish need server-managed resource metrics.

Open Liberty benefits from MicroProfile Health/Metrics.

Kubernetes adds pod/probe/event/resource signals.

Across all models, you need:

```text
structured logs
request IDs
metrics
traces
health/readiness
JVM telemetry
dependency metrics
dashboards
alerts
incident playbooks
```

Top-tier conclusion:

> If you cannot see saturation before failure, you do not have production observability.  
> If you cannot correlate proxy, app, JVM, dependency, and Kubernetes signals, you do not have deployment observability.

---

## 59. How This Part Connects to the Next Part

This part covered observability.

Next:

```text
Part 28 — Failure Modes: Startup, Runtime, Redeploy, Shutdown
```

We will map failure modes across the full lifecycle:

- startup failures,
- deployment failures,
- config failures,
- classpath/provider failures,
- runtime saturation,
- dependency failure,
- redeploy leaks,
- graceful shutdown problems,
- Kubernetes rollout failures,
- and how to diagnose each systematically.

---

## References

- OpenTelemetry Java documentation: https://opentelemetry.io/docs/languages/java/
- OpenTelemetry overview: https://opentelemetry.io/
- Kubernetes Observability documentation: https://kubernetes.io/docs/concepts/cluster-administration/observability/
- Open Liberty Health checks for microservices: https://openliberty.io/docs/latest/health-check-microservices.html
- Open Liberty MicroProfile Metrics feature: https://openliberty.io/docs/latest/reference/feature/mpMetrics-2.0.html
- Apache Tomcat Monitoring and Managing Tomcat: https://tomcat.apache.org/tomcat-9.0-doc/monitoring.html
- Apache Tomcat Access Log Valve documentation: https://tomcat.apache.org/tomcat-9.0-doc/config/valve.html


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-026.md">⬅️ Part 26 — Security Deployment Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-028.md">Part 28 — Failure Modes: Startup, Runtime, Redeploy, Shutdown ➡️</a>
</div>
