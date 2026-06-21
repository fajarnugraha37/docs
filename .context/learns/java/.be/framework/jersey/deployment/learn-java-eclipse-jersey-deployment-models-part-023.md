# learn-java-eclipse-jersey-deployment-models-part-023  
# Part 23 — Threading Model Across Deployment Modes

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 23 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami di thread mana request Jersey berjalan, bagaimana blocking memengaruhi runtime, dan bagaimana sizing thread/executor harus dilakukan di berbagai deployment model.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: Servlet container threads, Grizzly workers, Jetty `QueuedThreadPool`, JDK HTTP executor, Netty event loop, Jakarta Concurrency, virtual threads, Kubernetes CPU limits, blocking boundary, backpressure, dan failure diagnostics.

---

## 1. Mengapa Threading Model Penting?

Dalam REST API biasa, kita sering menulis resource Jersey seperti ini:

```java
@GET
@Path("/{id}")
public UserDto get(@PathParam("id") String id) {
    User user = userRepository.findById(id);
    return mapper.toDto(user);
}
```

Kode terlihat sederhana.

Tetapi deployment model menentukan:

```text
Thread mana yang menjalankan method ini?
Apa yang terjadi jika method blocking?
Berapa banyak request bisa berjalan bersamaan?
Apakah queue terbentuk?
Apakah event loop bisa kelaparan?
Apakah DB pool menjadi bottleneck?
Apakah Kubernetes CPU limit membuat thread pool terlalu besar?
Apakah virtual thread aman?
```

Threading model memengaruhi:

- throughput,
- latency,
- p99,
- memory,
- CPU context switching,
- graceful shutdown,
- timeout behavior,
- overload behavior,
- failure blast radius,
- diagnostics.

Top-tier mental model:

> Deployment model bukan hanya “server mana”.  
> Deployment model adalah **execution model**: di thread mana kode berjalan dan bagaimana work dijadwalkan.

---

## 2. Fundamental: Thread, Request, Blocking, Queue

Sebelum membandingkan server, pahami elemen dasar.

### Thread

Unit eksekusi di JVM.

Jenis umum:

```text
platform thread:
  OS-backed Java thread

virtual thread:
  lightweight Java thread managed by JVM, introduced as final feature in Java 21
```

### Request

Satu HTTP request bisa melalui:

```text
socket accept
HTTP parse
routing
filter
resource method
service logic
DB/downstream calls
serialization
response write
```

### Blocking

Thread menunggu sesuatu:

```text
DB query
HTTP call
file I/O
lock
sleep
queue
connection pool
external service
```

### Queue

Work menunggu giliran:

```text
socket accept queue
server executor queue
Tomcat/Jetty request queue
DB pool wait queue
HTTP client queue
application executor queue
message broker queue
```

Aplikasi lambat bukan hanya karena CPU tinggi. Sering karena queue panjang.

---

## 3. The Universal Capacity Equation

Untuk blocking service:

```text
concurrency_needed ≈ throughput * latency
```

Little’s Law:

```text
L = λ * W
```

Where:

```text
L:
  average concurrency / work in system

λ:
  arrival rate

W:
  average time in system
```

Example:

```text
throughput:
  100 requests/second

average latency:
  200 ms = 0.2s

needed concurrency:
  100 * 0.2 = 20 concurrent requests
```

If latency rises to 2s:

```text
100 * 2 = 200 concurrent requests
```

This explains outage behavior:

```text
same traffic + slower DB = many more threads needed
```

If thread pool max is 100, queue forms.

If queue grows, latency rises more.

This is why downstream slowness collapses web servers.

---

## 4. Request Thread Per Request Model

Traditional Servlet model:

```text
one request occupies one server thread while processing
```

During blocking DB call:

```text
thread waits
request holds thread
```

Pros:

- simple mental model,
- easy stack traces,
- natural synchronous code,
- good for many enterprise REST APIs.

Cons:

- many blocking requests need many threads,
- thread memory overhead,
- context switching,
- thread pool exhaustion,
- queue buildup.

Tomcat/Jetty Servlet deployments are usually understood this way.

---

## 5. Event Loop Model

Netty-style:

```text
small number of event loop threads handle many connections
```

Event loop should do fast non-blocking work:

```text
read
decode
dispatch
write
schedule
```

If event loop blocks:

```text
many channels assigned to that loop suffer
```

Pros:

- scalable connections,
- fewer threads,
- efficient I/O.

Cons:

- blocking is dangerous,
- more complex offload boundary,
- harder debugging,
- application code must respect model.

Rule:

```text
Never casually run blocking Jersey resource logic on event loop threads.
```

---

## 6. Hybrid Models

Many real servers are hybrid.

Example:

```text
acceptor/selectors/event loops handle I/O
worker threads run application logic
```

Jetty, Grizzly, Tomcat NIO, and others may use non-blocking internals but expose synchronous request processing.

So do not oversimplify:

```text
Tomcat == blocking sockets
Jetty == non-blocking
Netty == always async
```

The real question:

```text
Where does my Jersey resource method execute?
```

Find that thread, then reason.

---

## 7. How to Discover Execution Thread

Add a temporary diagnostic endpoint:

```java
@Path("/debug/thread")
public class ThreadDebugResource {

    @GET
    @Produces(MediaType.TEXT_PLAIN)
    public String thread() {
        Thread thread = Thread.currentThread();
        return thread.getName()
            + " virtual=" + thread.isVirtual();
    }
}
```

Call:

```bash
curl http://localhost:8080/debug/thread
```

Example names:

```text
http-nio-8080-exec-10
qtp123456789-42
grizzly-http-server-0
pool-1-thread-3
nioEventLoopGroup-3-1
ForkJoinPool.commonPool-worker-1
VirtualThread[#123]/runnable
```

This is not enough for all cases, but it is a useful starting point.

Do not leave open debug endpoint in production.

---

## 8. Tomcat Threading Model

Tomcat HTTP Connector processes requests through connector infrastructure and request processing threads.

Tomcat connector config includes parameters such as:

```xml
<Connector
    port="8080"
    protocol="org.apache.coyote.http11.Http11NioProtocol"
    maxThreads="200"
    minSpareThreads="10"
    acceptCount="100"
    connectionTimeout="20000" />
```

Tomcat documentation describes the HTTP Connector as a connector listening on a TCP port and forwarding requests to the associated Engine for request processing and response creation.

For Jersey on Tomcat:

```text
Tomcat request thread
  ↓
Servlet filter chain
  ↓
Jersey ServletContainer
  ↓
Jersey resource method
```

Resource method usually runs on Tomcat request thread.

If method blocks on DB, Tomcat thread waits.

---

## 9. Tomcat `maxThreads`

`maxThreads` is often misunderstood.

It is not “performance”.

It is:

```text
maximum concurrent request processing threads
```

If too low:

```text
requests queue earlier
latency rises under load
```

If too high:

```text
too many blocked threads
memory pressure
context switching
downstream overload
```

Example bad sizing:

```text
Tomcat maxThreads=500
DB pool=20
average DB latency=2s during incident
```

500 threads wait for 20 DB connections.

This does not create 500x throughput.

It creates contention.

Better:

```text
Tomcat threads aligned with DB/downstream capacity
timeouts short enough
queue/rejection understood
readiness degrades under severe saturation
```

---

## 10. Jetty Threading Model

Jetty uses a thread pool model; Jetty documentation describes `QueuedThreadPool` as the default Jetty thread pool implementation.

Jetty architecture:

```text
Server
  ↓
Connector/selectors
  ↓
Handler chain / ServletContextHandler
  ↓
Jersey ServletContainer
  ↓
Resource method
```

For external/embedded Servlet Jetty:

```text
Jersey resource usually runs on Jetty thread pool thread
```

Thread names often look like:

```text
qtp123456789-42
```

Jetty `QueuedThreadPool` can also be configured with virtual thread executor in modern Jetty versions.

---

## 11. Jetty Virtual Threads

Jetty 12 documentation shows `QueuedThreadPool` can be configured to use virtual threads by specifying a virtual thread executor, and also mentions a bounded `VirtualThreadPool` as a preferred configurable option.

Conceptual:

```java
QueuedThreadPool threadPool = new QueuedThreadPool();

VirtualThreadPool virtualExecutor = new VirtualThreadPool();
virtualExecutor.setMaxConcurrentTasks(128);

threadPool.setVirtualThreadsExecutor(virtualExecutor);
```

Important:

```text
Virtual threads reduce blocking thread cost.
They do not remove downstream bottlenecks.
```

If DB pool has 20 connections, 10,000 virtual threads will still wait.

Use virtual threads to simplify blocking concurrency, not to ignore capacity control.

---

## 12. Grizzly Threading Model

Embedded Grizzly with Jersey usually follows:

```text
Grizzly HTTP server
  ↓
Grizzly worker threads / filters
  ↓
Jersey container
  ↓
Resource method
```

Grizzly has its own transport and worker thread configuration.

Typical concern:

```text
resource method blocks on worker thread
```

If worker pool saturates:

```text
requests queue or stall
latency rises
```

Production questions:

```text
How many worker threads?
How many selector threads?
Are resource methods blocking?
How many DB connections?
What are timeouts?
```

Even if Grizzly is lightweight, thread and downstream sizing still matter.

---

## 13. JDK HTTP Server Threading Model

JDK `HttpServer` can use an executor:

```java
server.setExecutor(executor);
```

If executor is null, implementation uses a default executor.

For Jersey JDK HTTP deployment:

```text
JDK HttpServer executor thread
  ↓
Jersey adapter
  ↓
Resource method
```

Production rule:

```text
Set executor explicitly.
```

Example:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    16,
    64,
    60,
    TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1000),
    namedThreadFactory("jdk-http"),
    new ThreadPoolExecutor.AbortPolicy()
);

server.setExecutor(executor);
```

Do not deploy serious service with unknown default executor behavior.

---

## 14. Netty Threading Model

Netty describes itself as an asynchronous event-driven network application framework.

Netty typical server:

```text
boss EventLoopGroup:
  accepts connections

worker EventLoopGroup:
  handles channel I/O events

ChannelPipeline:
  handlers process inbound/outbound events
```

Thread names:

```text
nioEventLoopGroup-2-1
```

For Jersey on Netty, the critical question:

```text
Does Jersey resource execute on event loop or offloaded executor?
```

If resource method blocks on event loop:

```text
event loop starvation
many connections affected
```

Netty code that performs blocking work should be offloaded to a separate executor/event executor group.

---

## 15. Event Loop Starvation

Symptoms:

```text
all endpoints become slow
health slow
CPU may not be high
few event loop threads blocked
thread dump shows event loop waiting on DB/HTTP/lock
timeouts cascade
```

Thread dump red flag:

```text
nioEventLoopGroup-... waiting for JDBC
nioEventLoopGroup-... waiting on Future.get()
nioEventLoopGroup-... in Thread.sleep()
```

Fix:

```text
offload blocking work
use async non-blocking clients
limit concurrency
timeouts
load shedding
```

Do not solve by increasing event loop threads blindly.

---

## 16. Jakarta EE Managed Concurrency

In Jakarta EE server, do not create raw unmanaged threads casually.

Jakarta Concurrency specification provides standardized APIs for using concurrency from Jakarta EE application components without compromising container integrity while preserving platform benefits.

Managed resources:

```text
ManagedExecutorService
ManagedScheduledExecutorService
ContextService
```

Usage:

```java
@Resource
ManagedExecutorService executor;
```

or in newer Jakarta EE generations, injection support may be available depending spec/runtime.

Why managed?

Because container can propagate/manage:

- naming context,
- security context,
- classloader,
- lifecycle,
- monitoring,
- transaction rules where applicable.

Rule:

```text
In managed Jakarta EE runtime, prefer managed executors.
```

---

## 17. Raw Executors in Managed Servers

Bad:

```java
private final ExecutorService executor =
    Executors.newFixedThreadPool(10);
```

inside application server without lifecycle cleanup.

Risks:

- classloader leak,
- redeploy leak,
- unmanaged lifecycle,
- security context loss,
- transaction confusion,
- server cannot monitor/control,
- process does not stop cleanly.

If you must create raw executor:

```text
name threads
bound queue
close in @PreDestroy/contextDestroyed
document why managed executor not used
```

But default should be managed concurrency.

---

## 18. Virtual Threads in Java 21+

Virtual threads are lightweight threads suitable for blocking-style code.

Example:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<User> future = executor.submit(() -> repository.findById(id));
}
```

For server request handling, virtual threads can make synchronous blocking code scale with lower thread overhead.

But:

```text
virtual threads do not make blocking I/O faster
virtual threads do not increase DB connections
virtual threads do not remove timeouts
virtual threads can still pin carrier threads in some cases
virtual threads need observability changes
```

Top-tier rule:

```text
Virtual threads are a concurrency mechanism, not a capacity plan.
```

---

## 19. Platform Thread vs Virtual Thread Cost

Platform thread:

```text
OS thread
higher memory stack reservation
OS scheduler
expensive at very large counts
```

Virtual thread:

```text
JVM-managed
cheap to create
parks/unparks efficiently for many blocking operations
scheduled on carrier platform threads
```

Good for:

```text
many concurrent blocking I/O operations
simple synchronous code
request-per-task style
```

Less helpful for:

```text
CPU-bound work
DB pool bottleneck
synchronized pinning
native blocking calls
unbounded memory per request
```

---

## 20. Pinning and Blocking Caveats

Virtual threads can be pinned in some situations, such as blocking while holding a monitor or native calls.

Example risk:

```java
synchronized (lock) {
    blockingHttpCall();
}
```

This may reduce virtual thread scalability.

Use diagnostics:

```text
JDK Flight Recorder
thread dumps
virtual thread pinning diagnostics depending JDK flags
load tests
```

Do not migrate to virtual threads without testing real workload.

---

## 21. CPU-Bound Work

Threading for CPU-bound work is different.

CPU-bound examples:

```text
large JSON serialization
PDF generation
image processing
encryption/signature
complex regex
large sorting
compression
report generation
```

If CPU-bound, adding more threads than cores usually hurts.

Use:

```text
bounded CPU executor near CPU core count
queue limits
async job model for long work
```

For Kubernetes:

```text
CPU limit matters
```

A pod with 1 CPU cannot efficiently run 100 CPU-heavy threads.

---

## 22. Blocking I/O Work

Blocking I/O examples:

```text
database query
downstream HTTP call
file read/write
S3 call
LDAP call
SMTP call
message broker call
```

Thread count needed depends on latency.

Use:

```text
timeouts
bounded pools
bulkheads
circuit breakers
pool size alignment
```

For blocking I/O, virtual threads can help reduce thread overhead, but downstream capacity still controls throughput.

---

## 23. DB Pool as Concurrency Gate

DB pool is often the real concurrency gate.

If:

```text
DB pool max = 20
```

then at most 20 concurrent DB operations per pod.

If server threads:

```text
200
```

then 180 may wait for DB connection.

This is not useful unless non-DB endpoints dominate.

Formula:

```text
total DB connections = pool_per_pod * max_pods
```

Must be <= DB budget.

Thread pool sizing without DB pool sizing is incomplete.

---

## 24. HTTP Client Pooling

Downstream HTTP clients also have pools.

Examples:

```text
JDK HttpClient
Apache HttpClient
OkHttp
Jersey Client
Netty client
```

Control:

```text
connection pool size
max requests per host
connect timeout
read timeout
call timeout
retry policy
dispatcher threads
```

If server has 200 request threads but HTTP client max 20 connections to downstream, queue forms.

Align:

```text
request concurrency
downstream pool
timeout
retry
bulkhead
```

---

## 25. Queueing and Backpressure

Queues can hide overload.

Unbounded queues are dangerous.

Bad:

```java
new LinkedBlockingQueue<>()
```

without capacity.

Better:

```java
new ArrayBlockingQueue<>(1000)
```

with rejection policy.

But rejection must be handled:

```text
return 503
set Retry-After if appropriate
record metric
do not crash randomly
```

Backpressure means the system refuses or slows intake before collapse.

Queueing without limit is not backpressure.

---

## 26. Rejection Strategy

If executor full, options:

```text
AbortPolicy:
  reject task

CallerRunsPolicy:
  caller thread runs task

DiscardPolicy:
  silently drops task

Custom:
  return controlled 503
```

For HTTP request handling, silent discard is unacceptable.

A controlled failure is better:

```text
503 Service Unavailable
error code OVERLOADED
Retry-After optional
```

In Servlet containers, rejection may happen before Jersey sees request.

In app-level executor, you can map rejection to response.

---

## 27. Timeout Budget and Threads

Threads stuck in waiting states cause saturation.

Every blocking call should have timeout:

```text
DB query timeout
DB connection acquisition timeout
HTTP connect timeout
HTTP read/call timeout
lock acquisition timeout if possible
queue offer timeout
```

No infinite waits.

If downstream timeout is 60s, then under outage:

```text
threads blocked for 60s
```

If it is 3s:

```text
threads recover faster
```

But too short causes false failures.

Use budget based on SLO.

---

## 28. Thread Pool Sizing Method

Steps:

```text
1. Define workload:
   target RPS, latency SLO, blocking profile.

2. Identify bottleneck:
   DB, CPU, downstream, cache, external API.

3. Size downstream pools:
   DB connections, HTTP client connections.

4. Size request threads:
   enough for expected concurrency, not wildly above bottleneck.

5. Set queues:
   bounded.

6. Set timeouts:
   all layers.

7. Load test:
   normal, burst, slow downstream, partial outage.

8. Observe:
   p95/p99, queue depth, thread count, CPU, memory, pool wait.
```

Do not tune by folklore.

---

## 29. Kubernetes CPU Limits Interaction

If pod has:

```text
cpu limit: 500m
```

then effective CPU is half core.

Having:

```text
Tomcat maxThreads=300
```

may create high context switching and latency.

Also JVM may size:

- GC threads,
- JIT threads,
- common pool,
- server pools,

based on perceived processors.

Verify with:

```text
-Xlog:os+container=info
```

and runtime diagnostics.

Thread sizing must consider container CPU.

---

## 30. Kubernetes Memory Limits and Threads

Each platform thread has stack memory.

If many threads:

```text
memory used by stacks rises
```

Even if heap is fine, process may exceed cgroup memory.

Symptoms:

```text
OOMKilled exit 137
no Java heap OOM
```

Reduce:

- thread count,
- stack size if appropriate and tested,
- executor pools,
- server max threads,
- use virtual threads if suitable,
- increase memory limit.

---

## 31. Common Pool Risks

Java `CompletableFuture.supplyAsync()` without executor uses common ForkJoinPool.

Bad in server app:

```java
CompletableFuture.supplyAsync(() -> blockingDbCall());
```

Risks:

- common pool polluted by blocking work,
- unpredictable contention,
- unrelated tasks affected.

Better:

```java
CompletableFuture.supplyAsync(() -> blockingDbCall(), blockingExecutor);
```

In Jakarta EE server, use managed executor.

In Netty, do not offload to arbitrary common pool without capacity control.

---

## 32. Async Jersey APIs

JAX-RS/Jakarta REST supports async response patterns.

Example:

```java
@GET
public void get(@Suspended AsyncResponse async) {
    executor.submit(() -> {
        try {
            async.resume(service.get());
        } catch (Throwable t) {
            async.resume(t);
        }
    });
}
```

This frees container request thread while work continues elsewhere.

But it does not eliminate concurrency need.

It moves work to another executor.

You must still size:

```text
async executor
queues
timeouts
cancellation
shutdown
```

Async API without bounded executor is dangerous.

---

## 33. Reactive/CompletionStage Resources

Some Jakarta REST implementations support returning:

```java
CompletionStage<Response>
```

This can integrate with async pipelines.

But if inside you do:

```java
CompletableFuture.supplyAsync(blockingCall)
```

with unbounded/default executor, you still have issues.

Reactive return type is not automatically non-blocking.

True non-blocking requires:

- non-blocking HTTP client,
- non-blocking DB driver or offload,
- careful context propagation,
- backpressure model,
- timeout/cancellation.

---

## 34. Request Cancellation

Client may disconnect.

Proxy may timeout.

But server task may continue.

Questions:

```text
Does Jersey know client disconnected?
Does async task cancel?
Does DB query cancel?
Does downstream HTTP call cancel?
Does executor continue work?
```

For long operations, implement:

- request deadline,
- cancellation tokens if available,
- timeout at downstream,
- idempotency,
- async job model.

Do not assume client disconnect stops backend work.

---

## 35. Long-Running Requests

Long synchronous HTTP requests are hard in Kubernetes/proxy/server thread models.

Examples:

```text
report generation
bulk export
large import
PDF generation
data reconciliation
external workflow wait
```

Better pattern:

```text
POST /jobs
  returns 202 Accepted + jobId

GET /jobs/{id}
  returns status/result

worker processes job asynchronously
```

This avoids tying request threads to long work.

For Jersey deployment reliability, convert long operations to job model when possible.

---

## 36. Graceful Shutdown and Threads

Shutdown requires:

```text
stop accepting new requests
drain in-flight requests
stop executors
cancel/finish background work
close pools
flush telemetry/logs
```

If custom executor not stopped:

```text
JVM may hang
classloader leak on redeploy
Kubernetes termination forced
```

For embedded:

```java
Runtime.getRuntime().addShutdownHook(...)
```

For Servlet:

```java
ServletContextListener.contextDestroyed(...)
```

For CDI:

```java
@PreDestroy
```

For Jakarta EE:

```text
managed executors lifecycle managed by container
```

---

## 37. Thread Naming

Always name custom threads.

Bad:

```text
pool-1-thread-7
```

Good:

```text
case-api-blocking-7
case-api-scheduler-1
case-api-httpclient-3
```

Use custom `ThreadFactory`.

```java
public static ThreadFactory namedThreadFactory(String prefix) {
    AtomicInteger seq = new AtomicInteger();
    return runnable -> {
        Thread t = new Thread(runnable);
        t.setName(prefix + "-" + seq.incrementAndGet());
        return t;
    };
}
```

For virtual threads:

```java
Thread.ofVirtual()
    .name("case-api-vt-", 0)
    .factory();
```

Thread names are critical for thread dump diagnostics.

---

## 38. Thread Dump Diagnostics

Use thread dumps to diagnose:

```text
thread pool exhaustion
deadlock
DB wait
HTTP wait
lock contention
event loop blocking
GC pressure symptoms
shutdown hang
```

Tools:

```bash
jcmd <pid> Thread.print
jstack <pid>
kill -3 <pid>
JFR
```

In container:

```bash
kubectl exec
kubectl debug
jcmd availability depends on image
```

Minimal JRE images may not include diagnostic tools.

Plan diagnostics strategy.

---

## 39. Metrics for Threading

Expose/collect:

```text
active request count
server thread pool active
server thread pool max
executor active count
executor queue size
executor completed task count
executor rejected count
DB pool active/idle/wait
HTTP client pool active/idle
event loop lag for Netty
JVM thread count
virtual thread count if observable
GC pause
CPU throttling
```

Without queue metrics, overload diagnosis is guesswork.

---

## 40. Event Loop Lag Metric

For Netty/event-loop runtime, event loop lag is critical.

Concept:

```text
schedule task every interval
measure delay from expected execution time
```

High lag means event loop is blocked or overloaded.

If lag rises:

```text
health slow
all channels affected
timeouts
```

Monitor event loop lag for Netty-based Jersey deployment.

---

## 41. Threading Model by Deployment Mode

| Deployment | Resource Execution Model | Main Risk |
|---|---|---|
| Tomcat WAR | servlet request thread | maxThreads exhaustion |
| External Jetty WAR | Jetty thread pool thread | thread pool/handler saturation |
| Embedded Jetty Servlet | Jetty thread pool thread | same as above |
| Grizzly embedded | Grizzly worker thread | worker saturation |
| JDK HTTP Server | configured executor thread | unknown/default executor |
| Netty | event loop or offload depending integration | event loop blocking |
| GlassFish/Payara | managed server request thread | server pool/JTA/resource interaction |
| Open Liberty | server-managed request thread/feature runtime | feature/server pool tuning |
| Async Jersey | custom/managed executor | hidden unbounded executor |
| Virtual-thread server | virtual thread per request/task | downstream capacity ignored |

---

## 42. Choosing Platform Threads vs Virtual Threads

Choose platform threads when:

```text
traffic moderate
thread count manageable
server runtime stable
team tooling expects platform threads
CPU-bound work dominates
```

Choose virtual threads when:

```text
many concurrent blocking I/O requests
Java 21+
runtime supports it
observability updated
downstream capacity controlled
pinning tested
```

Do not choose virtual threads only because they are new.

Use load tests.

---

## 43. Deployment-Specific Recommendations

### Tomcat

```text
set maxThreads consciously
align with DB pool
configure timeouts
avoid huge queues
monitor active threads
```

### Jetty

```text
understand QueuedThreadPool
size min/max
consider virtual threads only after testing
monitor queue and busy threads
```

### JDK HTTP

```text
set executor explicitly
bounded queue
custom rejection behavior
do not rely on default executor
```

### Netty

```text
verify resource thread
never block event loop
offload blocking work
monitor event loop lag/direct memory
```

### Jakarta EE Server

```text
use managed executors
avoid raw unmanaged threads
test transaction/security context propagation
```

### Kubernetes

```text
thread counts must match CPU/memory limits
DB pool * max replicas must fit DB
probe readiness under saturation
```

---

## 44. Failure Scenarios

### Scenario 1 — DB Slowdown

```text
DB latency 100ms -> 5s
server threads fill
DB pool wait grows
readiness still true
gateway timeouts
clients retry
traffic increases
collapse
```

Mitigation:

```text
DB timeout
connection pool wait timeout
circuit breaker
bulkhead
readiness degradation
retry control
```

### Scenario 2 — Event Loop Block

```text
Netty event loop runs blocking resource
one request waits on DB
many channels delayed
health slow
timeouts
```

Mitigation:

```text
offload blocking code
thread diagnostics
event loop lag metrics
```

### Scenario 3 — Virtual Threads Without Pool Limits

```text
10,000 virtual threads call DB
DB pool 20
huge wait queue
memory grows
latency explodes
```

Mitigation:

```text
semaphore/bulkhead
DB pool sizing
timeouts
backpressure
```

### Scenario 4 — Common Pool Pollution

```text
CompletableFuture.supplyAsync blocking calls
common pool saturated
unrelated tasks slow
```

Mitigation:

```text
explicit bounded executor
managed executor in Jakarta EE
```

---

## 45. Backpressure Design

Backpressure layers:

```text
gateway rate limit
Kubernetes readiness
server max threads
executor queue limit
DB pool limit
HTTP client pool limit
circuit breaker
bulkhead
application 503
```

Good design:

```text
reject early and cheaply
```

Bad design:

```text
accept everything and queue until timeout
```

For Jersey:

```text
return 503 with structured error when overloaded
```

where possible.

---

## 46. Structured Overload Response

Example:

```json
{
  "code": "SERVICE_OVERLOADED",
  "message": "The service is temporarily overloaded. Please retry later.",
  "requestId": "..."
}
```

HTTP:

```text
503 Service Unavailable
Retry-After: 5
```

Do not return 500 for controlled overload.

Do not let timeouts be the only overload response.

---

## 47. Production Readiness Checklist

```text
[ ] Resource execution thread identified per deployment model.
[ ] Blocking operations inventoried.
[ ] Server thread pool configured consciously.
[ ] Custom executors are bounded.
[ ] Executor queues are bounded.
[ ] Rejection policy defined.
[ ] DB pool size aligned with request concurrency.
[ ] DB pool size aligned with max replicas.
[ ] HTTP client pools configured.
[ ] Downstream timeouts configured.
[ ] No blocking work on Netty event loop.
[ ] Managed executors used in Jakarta EE runtime.
[ ] Raw executors closed on shutdown.
[ ] Long-running operations converted to async jobs where appropriate.
[ ] Common ForkJoinPool not used for blocking server work.
[ ] Thread names are meaningful.
[ ] Thread dump procedure documented.
[ ] Thread/executor metrics exposed.
[ ] Event loop lag monitored for Netty.
[ ] JVM container CPU/memory interaction tested.
[ ] Virtual threads tested before production.
[ ] Pinning/observability considered for virtual threads.
[ ] Readiness behavior under saturation tested.
[ ] Graceful shutdown drains in-flight work.
```

---

## 48. Anti-Patterns

### Anti-Pattern 1 — Increasing Threads to Fix Everything

More threads can worsen overload.

### Anti-Pattern 2 — Thread Pool Bigger Than Downstream Capacity

Creates waiting, not throughput.

### Anti-Pattern 3 — Blocking Netty Event Loop

Destroys event-driven model.

### Anti-Pattern 4 — Using Common Pool for Blocking Work

Hidden global contention.

### Anti-Pattern 5 — Unbounded Executor Queue

Latency and memory bomb.

### Anti-Pattern 6 — Virtual Threads Without Backpressure

Cheap threads can still overload dependencies.

### Anti-Pattern 7 — Ignoring Kubernetes CPU Limit

Thread tuning on laptop does not match pod.

### Anti-Pattern 8 — No Thread Dumps in Incident Playbook

You cannot diagnose blocked Java service well.

### Anti-Pattern 9 — Liveness Restarts Thread-Saturated But Recoverable App

Restart storm.

### Anti-Pattern 10 — Long Reports as Synchronous HTTP

Use job model.

---

## 49. Top-Tier Engineering Perspective

A basic engineer says:

```text
Jersey handles requests.
```

A senior engineer asks:

```text
How many request threads do we have?
```

A top-tier engineer defines:

```text
- exact execution thread per runtime
- blocking map per endpoint
- concurrency budget
- downstream pool budgets
- timeout budgets
- queue and rejection policies
- virtual/platform thread decision
- Kubernetes CPU/memory implications
- diagnostics and metrics
- graceful shutdown behavior
- overload response semantics
```

Threading is where deployment model becomes runtime behavior.

---

## 50. Summary

Threading model determines how Jersey survives real traffic.

The same resource code behaves differently depending on:

```text
Tomcat request threads
Jetty QueuedThreadPool
Grizzly workers
JDK HTTP executor
Netty event loop/offload
Jakarta managed executors
virtual threads
Kubernetes CPU/memory limits
```

The core rules:

```text
Know where resource methods run.
Do not block event loops.
Bound every executor queue.
Align server threads with downstream capacity.
Set timeouts everywhere.
Use managed executors in Jakarta EE.
Test virtual threads with real workload.
Monitor thread pools, queues, and event-loop lag.
```

Top-tier conclusion:

> Threads are not implementation detail.  
> Threads are the currency of request execution.

---

## 51. How This Part Connects to the Next Part

This part covered threading across deployment modes.

Next:

```text
Part 24 — Connection, Timeout, and Backpressure Engineering
```

We will go deeper into:

- connection pools,
- keep-alive,
- HTTP client pools,
- DB pools,
- timeout budgets,
- retry storms,
- circuit breakers,
- rate limits,
- bounded queues,
- backpressure,
- bulkheads,
- overload response,
- and how these interact with Jersey deployment runtime.

---

## References

- Apache Tomcat 10.1 HTTP Connector Configuration Reference: https://tomcat.apache.org/tomcat-10.1-doc/config/http.html
- Eclipse Jetty 12.1 Threading Architecture: https://jetty.org/docs/jetty/12.1/programming-guide/arch/threads.html
- Netty project overview: https://github.com/netty/netty
- Netty User Guide for 4.x: https://netty.io/wiki/user-guide-for-4.x.html
- Jakarta Concurrency 3.1 Specification: https://jakarta.ee/specifications/concurrency/3.1/jakarta-concurrency-spec-3.1
- Java SE 25 API — `Executors`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html
- Kubernetes Resource Management for Pods and Containers: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-022.md">⬅️ Part 22 — Reverse Proxy and API Gateway Deployment</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-024.md">Part 24 — Connection, Timeout, and Backpressure Engineering ➡️</a>
</div>
