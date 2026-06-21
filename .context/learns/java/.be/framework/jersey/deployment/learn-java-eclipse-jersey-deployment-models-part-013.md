# learn-java-eclipse-jersey-deployment-models-part-013  
# Part 13 — Netty-Based Deployment Model

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 13 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami deployment Jersey pada level runtime network, event loop, threading boundary, performance, failure mode, dan production trade-off.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: deployment Jersey menggunakan **Netty HTTP Server** melalui `jersey-container-netty-http`.

---

## 1. Apa Itu Netty-Based Deployment Model?

Netty-based deployment model adalah model ketika Jersey dijalankan di atas Netty sebagai HTTP server runtime.

Topology sederhananya:

```text
Client
  ↓
Netty ServerBootstrap
  ↓
Boss EventLoopGroup
  ↓
Worker EventLoopGroup
  ↓
ChannelPipeline
  ↓
HTTP decoder/encoder
  ↓
Jersey Netty container adapter
  ↓
Jersey runtime
  ↓
Resource method
  ↓
Provider pipeline
  ↓
Netty response write
  ↓
Client
```

Jersey menyediakan modul:

```text
jersey-container-netty-http
```

yang memungkinkan Jersey berjalan di atas Netty HTTP server.

Dokumentasi Jersey menyebut Netty sebagai NIO client/server framework untuk membangun network applications dan menyatakan bahwa Jersey mendukung Netty sebagai container maupun client connector. Dalam deployment server-side, Jersey memakai Netty HTTP Server sebagai container. Referensi resmi Jersey juga menyediakan contoh “Using Jersey with Netty HTTP Server”.

Mental model paling penting:

> Netty bukan servlet container.  
> Netty adalah asynchronous event-driven network framework.

Jadi ketika Jersey dijalankan di atas Netty, Anda harus memahami boundary antara:

```text
event-loop network runtime
```

dan:

```text
JAX-RS/Jersey resource execution model
```

Kesalahan di boundary ini dapat menghasilkan masalah serius:

- event-loop starvation,
- latency spike,
- throughput collapse,
- queue growth,
- timeout cascade,
- false backpressure,
- stuck connections,
- memory pressure dari buffer,
- response tidak ter-flush,
- blocking operation di thread yang salah.

---

## 2. Mengapa Netty Berbeda dari Grizzly, Jetty, dan JDK HTTP Server?

Grizzly, Jetty, dan JDK HTTP Server bisa juga memakai non-blocking I/O di bawahnya, tetapi Netty secara eksplisit adalah framework event-driven.

Netty core mental model:

```text
Channel
  connection/socket abstraction

EventLoop
  thread that handles I/O events for channels

EventLoopGroup
  group of event loop threads

ChannelPipeline
  ordered chain of handlers

ChannelHandler
  unit that handles inbound/outbound events

ByteBuf
  Netty byte buffer abstraction
```

Dalam Netty, performa tinggi berasal dari:

- sedikit thread,
- non-blocking I/O,
- event loop,
- pipeline event processing,
- buffer management,
- asynchronous writes,
- minimal context switching,
- scalable connection handling.

Tetapi model ini punya syarat:

```text
Do not block event loop.
```

Ini adalah invariant utama.

---

## 3. The Golden Rule: Jangan Block Event Loop

Event loop seharusnya melakukan pekerjaan cepat:

```text
read socket
decode HTTP
dispatch event
write response
schedule async task
```

Event loop tidak boleh melakukan operasi blocking panjang seperti:

```text
database query blocking
downstream HTTP blocking
file read besar
sleep
synchronized lock lama
CPU-heavy JSON transformation
PDF generation
large compression
remote service call
cryptographic heavy operation
waiting on Future.get()
Thread.sleep()
```

Jika event loop ter-block, satu thread event loop tidak bisa melayani channel lain yang ditugaskan kepadanya.

Akibatnya:

```text
one slow request can delay many connections
```

Ini berbeda dengan traditional thread-per-request model, di mana satu blocking request biasanya hanya mengikat satu worker thread.

Pada event-loop model, blocking kecil bisa punya blast radius lebih besar.

---

## 4. Jersey Resource Model vs Netty Event Loop Model

Jersey/JAX-RS resource method biasanya ditulis seperti ini:

```java
@GET
@Path("/{id}")
public UserDto getUser(@PathParam("id") String id) {
    User user = userRepository.findById(id); // blocking database
    return mapper.toDto(user);
}
```

Ini natural dalam JAX-RS.

Namun dalam Netty runtime, pertanyaannya:

```text
Thread mana yang menjalankan method ini?
Apakah resource method berjalan di event loop?
Apakah Jersey container adapter melakukan offload?
Apakah blocking call aman?
Bagaimana executor dikonfigurasi?
Apa efeknya pada latency channel lain?
```

Anda tidak boleh berasumsi.

Deployment Netty hanya aman jika Anda tahu:

```text
where blocking code runs
```

dan:

```text
how request execution is isolated from event loop
```

---

## 5. Netty Deployment Bukan Otomatis Lebih Cepat

Kalimat umum yang menyesatkan:

```text
"Netty lebih cepat, jadi Jersey di Netty pasti lebih cepat."
```

Ini framing yang salah.

Netty cepat untuk network/event-driven workloads ketika digunakan sesuai modelnya.

Tetapi jika aplikasi Jersey:

- blocking DB,
- blocking HTTP client,
- heavy JSON,
- synchronous validation,
- large request body,
- synchronous file I/O,
- thread-blocking domain logic,

maka bottleneck bukan Netty.

Bottleneck adalah:

```text
application blocking profile
```

atau:

```text
downstream latency
```

Netty tidak menghilangkan bottleneck tersebut.

Bahkan, kalau blocking berjalan di event loop, Netty bisa menjadi lebih buruk daripada thread-per-request runtime.

Rule:

```text
Netty is powerful when your application model respects event-loop constraints.
```

---

## 6. Kapan Jersey + Netty Cocok?

Jersey + Netty cocok jika:

1. Anda butuh embedded HTTP runtime yang event-driven.
2. Aplikasi low-level networking awareness cukup tinggi.
3. Workload banyak koneksi idle/keep-alive.
4. Anda punya streaming/event-driven use case.
5. Anda bisa mengendalikan blocking boundary.
6. Anda ingin runtime footprint/network behavior tertentu.
7. Anda tidak butuh Servlet API.
8. Anda punya tim yang paham Netty operational model.
9. Anda melakukan benchmark nyata, bukan asumsi.
10. Anda butuh custom pipeline/transport behavior.

Jersey + Netty kurang cocok jika:

- resource method mayoritas blocking,
- tim tidak paham event loop,
- hanya ingin REST API biasa,
- tidak ada kebutuhan Netty spesifik,
- ingin Servlet filter ecosystem,
- ingin Jakarta EE server features,
- workload lebih cocok di Tomcat/Jetty/Grizzly,
- observability Netty belum siap,
- tidak punya load test/failure test.

Top-tier decision rule:

```text
Choose Netty because its model matches your workload,
not because "Netty is fast".
```

---

## 7. Jersey Netty Minimal Example

Contoh konseptual Jersey 3.x / Jakarta style:

```java
package com.example;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

@Path("/hello")
public final class HelloResource {

    @GET
    @Produces(MediaType.TEXT_PLAIN)
    public String hello() {
        return "hello";
    }
}
```

Bootstrap konseptual:

```java
package com.example;

import java.net.URI;

import org.glassfish.jersey.netty.httpserver.NettyHttpContainerProvider;
import org.glassfish.jersey.server.ResourceConfig;

public final class Main {

    public static void main(String[] args) {
        URI baseUri = URI.create("http://0.0.0.0:8080/");

        ResourceConfig config = new ResourceConfig()
            .register(HelloResource.class);

        NettyHttpContainerProvider
            .createHttp2Server(baseUri, config, null);
    }
}
```

Catatan penting:

```text
API factory dan overload dapat berbeda antar versi Jersey.
Selalu cek API sesuai Jersey major/minor yang dipakai.
```

Dokumentasi Jersey 3.x menunjukkan contoh Netty HTTP Server melalui `NettyHttpContainerProvider`.

Production bootstrap harus jauh lebih eksplisit daripada demo.

---

## 8. Dependencies

### 8.1 Jersey 3.x Style Maven

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.glassfish.jersey</groupId>
      <artifactId>jersey-bom</artifactId>
      <version>${jersey.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependencies>
  <dependency>
    <groupId>org.glassfish.jersey.containers</groupId>
    <artifactId>jersey-container-netty-http</artifactId>
  </dependency>

  <dependency>
    <groupId>org.glassfish.jersey.inject</groupId>
    <artifactId>jersey-hk2</artifactId>
  </dependency>

  <dependency>
    <groupId>org.glassfish.jersey.media</groupId>
    <artifactId>jersey-media-json-jackson</artifactId>
  </dependency>
</dependencies>
```

Meaning:

```text
jersey-container-netty-http:
  adapts Netty HTTP server to Jersey server runtime.

jersey-hk2:
  Jersey injection/lifecycle support.

jersey-media-json-jackson:
  JSON provider.
```

Also consider Netty transitive dependencies.

Do not mix Netty versions casually. Netty modules are also a family:

```text
netty-buffer
netty-codec
netty-codec-http
netty-common
netty-handler
netty-transport
```

A version mismatch across Netty artifacts can produce subtle runtime failures.

Use dependency convergence.

---

## 9. Java 8 to Java 25 Compatibility Perspective

### Java 8

Likely universe:

```text
Jersey 2.x
javax.ws.rs
Netty 4.x
classpath
```

### Java 11

Transition universe:

```text
Jersey 2.x or 3.x
javax or jakarta depending migration
module path possible but not always worth it
```

### Java 17

Modern baseline:

```text
Jersey 3.x / 4.x depending target
jakarta.ws.rs
stronger encapsulation awareness
better GC/container support
```

### Java 21/25

Modern LTS deployment:

```text
virtual threads may be considered for offloaded blocking work
Netty event loop remains event loop
container ergonomics improved
dependency compatibility must be validated
```

Important:

```text
Virtual threads do not turn Netty event loops into blocking-friendly threads.
```

If using virtual threads, they should typically be used as offload executors for blocking application work, not as replacement for event-loop discipline.

---

## 10. `javax.*` vs `jakarta.*`

Same invariant:

```text
Jersey 2.x:
  javax.ws.rs.*

Jersey 3.x/4.x:
  jakarta.ws.rs.*
```

Wrong combination:

```java
import javax.ws.rs.Path;
```

with Jersey 3.x.

Netty does not change this.

Netty only hosts HTTP.

Jersey still detects annotations based on its runtime namespace.

---

## 11. Netty ChannelPipeline Mental Model

Netty pipeline is an ordered chain of handlers.

Conceptually:

```text
ChannelPipeline
  ├─ SSL handler
  ├─ HTTP server codec
  ├─ HTTP object aggregator?
  ├─ Jersey container handler
  └─ outbound write handlers
```

Inbound flow:

```text
socket bytes
  ↓
ByteBuf
  ↓
decoder
  ↓
HTTP request object
  ↓
Jersey adapter
  ↓
Jersey request
```

Outbound flow:

```text
Jersey response
  ↓
HTTP response object
  ↓
encoder
  ↓
ByteBuf
  ↓
socket write
```

This is powerful because you can compose protocol behavior.

But every handler must respect Netty rules:

```text
- do not block event loop
- manage ByteBuf lifecycle
- avoid unbounded aggregation
- handle exceptions
- propagate events correctly
```

If you do not need this power, you may not need Netty.

---

## 12. ByteBuf and Memory

Netty uses `ByteBuf`, often with pooled direct memory.

This means memory behavior is not only Java heap.

Memory surfaces:

```text
Java heap
direct memory
Netty pooled buffers
thread stacks
native transport memory
TLS buffers
application objects
JSON buffers
```

Potential failure:

```text
OutOfMemoryError: Direct buffer memory
```

or leak warnings:

```text
LEAK: ByteBuf.release() was not called
```

In Jersey adapter usage, you may not directly handle ByteBuf often, but Netty runtime still uses it.

Operational checklist:

```text
- monitor direct memory
- monitor heap
- configure MaxDirectMemorySize if needed
- use Netty leak detection in non-prod
- avoid large unbounded request aggregation
- understand upload/download behavior
```

Top-tier perspective:

```text
Netty performance comes partly from explicit buffer strategy.
Ignoring direct memory is unsafe.
```

---

## 13. Request Body Aggregation Risk

HTTP request bodies may arrive in chunks.

Frameworks often aggregate body before passing it to higher layers.

Risk:

```text
large request body -> large memory allocation
many concurrent large requests -> memory pressure
slow upload -> event loop/resources occupied
```

For JSON APIs, define maximum payload size.

Protection layers:

```text
reverse proxy body limit
Netty aggregator/max content length if configurable
Jersey/entity provider limits
application validation
rate limiting
```

Never allow unbounded request bodies.

---

## 14. Blocking Boundary Pattern

The safest conceptual pattern for Netty + blocking Jersey-style work:

```text
event loop:
  decode request quickly
  hand off blocking work to worker executor
  return to event loop

worker executor:
  run blocking resource/service logic
  produce response

event loop:
  write response
```

The key is offload.

But whether/how Jersey Netty integration handles this depends on implementation/version/configuration. Therefore:

```text
verify with thread names and load test
```

Add diagnostic logging temporarily:

```java
@GET
@Path("/thread")
public String thread() {
    return Thread.currentThread().getName();
}
```

Then call endpoint and inspect:

```text
Is this a Netty event loop thread?
Is this an application worker thread?
```

If blocking resource methods run on event loop threads, you need to redesign.

---

## 15. Worker Executor Design

If you offload blocking work, the executor itself must be bounded.

Bad:

```java
Executors.newCachedThreadPool()
```

Risk:

```text
unbounded threads under outage
```

Better conceptual:

```java
ThreadPoolExecutor blockingExecutor = new ThreadPoolExecutor(
    32,
    128,
    60,
    TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1000),
    namedThreadFactory("blocking-worker"),
    new ThreadPoolExecutor.AbortPolicy()
);
```

But choose numbers based on:

- CPU cores,
- blocking ratio,
- DB pool size,
- downstream concurrency limit,
- latency SLO,
- memory,
- retry behavior.

Invariant:

```text
Executor capacity must align with downstream capacity.
```

If DB pool has 20 connections, allowing 500 blocking DB worker threads usually creates queueing and timeouts, not throughput.

---

## 16. Backpressure Illusion

Netty supports backpressure concepts at the network/channel level.

But that does not automatically mean your application has end-to-end backpressure.

Example:

```text
client sends request
Netty accepts
Jersey dispatches
resource calls DB
DB pool exhausted
requests queue in executor
gateway retries
more requests arrive
```

Netty may be handling sockets efficiently, but application queue is exploding.

True backpressure requires:

```text
- bounded queues
- rejection policy
- retry-after or 503
- rate limits
- downstream concurrency limits
- timeout budgets
- circuit breakers
- load shedding
```

Without those, you just moved the queue somewhere less visible.

Top-tier rule:

```text
Backpressure must be designed across layers, not assumed from Netty.
```

---

## 17. Event Loop Starvation Symptoms

Symptoms:

```text
latency spikes across unrelated requests
CPU not fully utilized
connections open but responses delayed
health endpoint slow although app logic simple
thread dump shows event loop blocked
Netty logs warn about blocked event loop if instrumentation exists
timeouts cascade
```

Thread dump clues:

```text
nioEventLoopGroup-... waiting on database
nioEventLoopGroup-... waiting on HTTP client
nioEventLoopGroup-... in JSON serialization
nioEventLoopGroup-... blocked on synchronized lock
```

This is a red flag.

Event loop should not be in long blocking stack traces.

---

## 18. CPU-Heavy Work

Even if work is not blocking I/O, CPU-heavy work can starve event loop.

Examples:

```text
large JSON serialization
encryption/signature verification
PDF/Excel generation
image processing
large compression
complex regex
large object mapping
```

If CPU-heavy work runs on event loop:

```text
event loop is blocked
```

Offload CPU-heavy work too, but use a different sizing logic from I/O blocking.

CPU executor:

```text
bounded near CPU core count
```

Blocking I/O executor:

```text
bounded by downstream capacity and latency profile
```

Do not mix all work into one giant executor without reasoning.

---

## 19. Netty Native Transports

Netty can use native transports on some platforms, such as epoll on Linux.

Potential advantages:

- lower overhead,
- better OS integration,
- improved scalability,
- transport-specific options.

But in Jersey deployment, native transport is an advanced optimization.

Questions:

```text
Does Jersey container integration expose transport selection?
Does Docker base image include required native libs?
Is architecture x86_64 or ARM64?
Is fallback behavior known?
Do benchmarks show benefit?
```

Do not start with native transport.

Start with correctness, then tune.

---

## 20. TLS and HTTP/2

Netty has strong TLS/HTTP protocol capabilities.

But if Jersey Netty deployment owns TLS, application owns:

- SSL context,
- certificates,
- trust store,
- mTLS,
- cipher policy,
- protocol versions,
- ALPN if HTTP/2,
- certificate reload,
- security incident response.

In Kubernetes/cloud, TLS often terminates at:

```text
ingress / API gateway / ALB / service mesh
```

Then app listens internally over HTTP.

Use Netty TLS only when:

- direct exposure,
- custom protocol control,
- mTLS at app boundary,
- gateway cannot meet requirement,
- operational ownership is clear.

---

## 21. Reverse Proxy and Forwarded Headers

Behind proxy, app may see:

```text
scheme: http
host: internal-service:8080
remote addr: proxy IP
path: rewritten path
```

But client saw:

```text
https://api.example.com/my-service
```

You need a strategy for:

```text
Forwarded
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
X-Request-Id
```

Netty itself does not magically solve public URI reconstruction.

In Jersey:

- configure public base URI explicitly if needed,
- normalize trusted headers at gateway,
- avoid absolute URL generation unless necessary,
- audit direct remote address and trusted client address separately.

Rule:

```text
Trust forwarded headers only from trusted proxy boundary.
```

---

## 22. Health Endpoints

Health resource:

```java
@Path("/health")
public final class HealthResource {

    private final HealthState state;

    public HealthResource(HealthState state) {
        this.state = state;
    }

    @GET
    @Path("/live")
    @Produces(MediaType.TEXT_PLAIN)
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

But for Netty, health endpoint must be protected against event-loop starvation.

If `/health/live` is slow because event loop is blocked, Kubernetes may restart pod.

That may be valid if runtime is unhealthy, but it can also amplify outage if root cause is downstream saturation.

Design:

```text
readiness false when overloaded
liveness should indicate process/runtime deadlock, not dependency outage
```

---

## 23. Readiness Under Overload

Readiness should not only mean “startup complete”.

It may also mean:

```text
can accept traffic now
```

Under severe overload:

```text
executor queue full
downstream circuit open
memory pressure high
event loop delay high
```

service may be technically alive but should stop receiving traffic.

Advanced readiness can consider:

```text
- startup state
- shutdown state
- executor queue saturation
- critical dependency circuit state
- memory pressure
- event loop lag
```

But avoid making readiness too noisy.

Noisy readiness causes traffic flapping.

Rule:

```text
Readiness should reflect ability to serve, but must be stable enough for orchestration.
```

---

## 24. Graceful Shutdown

Shutdown sequence:

```text
SIGTERM
  ↓
mark readiness false
  ↓
stop accepting new requests
  ↓
drain in-flight requests
  ↓
close Netty channels/server
  ↓
shutdown worker executors
  ↓
close app dependencies
  ↓
exit
```

Critical:

```text
Do not kill event loop before response writes finish.
Do not leave worker executor running.
Do not accept new requests after readiness false grace window.
```

In Netty, shutdown often involves:

```text
bossGroup.shutdownGracefully()
workerGroup.shutdownGracefully()
```

Depending on Jersey container factory, lifecycle APIs may abstract or hide this.

You need to know how to stop the server returned by the Jersey Netty integration.

---

## 25. Docker Deployment

Dockerfile is similar to other embedded models:

```Dockerfile
FROM eclipse-temurin:21-jre

RUN useradd --system --create-home --uid 10001 appuser

WORKDIR /app

COPY target/app.jar /app/app.jar

USER 10001

EXPOSE 8080

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
```

Netty-specific considerations:

```text
- direct memory
- native transport libs if used
- architecture compatibility
- file descriptor limits
- container CPU quota
- event loop thread count
- memory visibility
```

If using direct memory heavily, consider:

```text
-XX:MaxDirectMemorySize=...
```

But tune based on measurement.

---

## 26. Kubernetes Deployment

Conceptual deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jersey-netty-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: jersey-netty-api
  template:
    metadata:
      labels:
        app: jersey-netty-api
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: api
          image: example/jersey-netty-api:1.0.0
          ports:
            - containerPort: 8080
          env:
            - name: APP_BIND_HOST
              value: "0.0.0.0"
            - name: APP_BIND_PORT
              value: "8080"
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            periodSeconds: 5
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /health/live
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /health/live
              port: 8080
            periodSeconds: 2
            failureThreshold: 30
```

For Netty workloads, also consider:

```text
resources.requests.cpu
resources.limits.cpu
file descriptor limits
connection count
event loop thread count vs CPU quota
```

If CPU limit is 1 core and event loop group assumes many cores, behavior may not match expectation.

---

## 27. Observability

Netty deployment needs observability for both HTTP/application and network runtime.

Observe:

```text
request count
status code
latency histogram
in-flight requests
executor queue depth
executor rejection count
event loop lag
direct memory
heap
GC pause
connection count
active channels
request body size
response size
downstream latency
timeout count
circuit breaker state
```

Without event-loop lag and executor queue metrics, Netty issues are hard to diagnose.

Access logging:

```text
method
path
status
duration
request id
remote address
forwarded client
bytes
```

Application logs:

```text
correlation id
domain event
error code
dependency latency
```

Do not log raw bodies by default.

---

## 28. Request Correlation

Same Jersey filter approach:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public final class RequestIdFilter
        implements ContainerRequestFilter, ContainerResponseFilter {

    private static final String HEADER = "X-Request-Id";

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String requestId = requestContext.getHeaderString(HEADER);
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString();
        }
        requestContext.setProperty(HEADER, requestId);
    }

    @Override
    public void filter(
            ContainerRequestContext requestContext,
            ContainerResponseContext responseContext
    ) {
        Object requestId = requestContext.getProperty(HEADER);
        if (requestId != null) {
            responseContext.getHeaders().putSingle(HEADER, requestId.toString());
        }
    }
}
```

For Netty async/event-loop models, MDC propagation can be tricky.

If using async callbacks/offload executors, ensure correlation context propagates.

---

## 29. JSON Provider and CPU Cost

JSON serialization can be CPU-heavy.

In simple REST APIs this is fine.

In high-throughput Netty deployment, JSON can become bottleneck.

Consider:

```text
- DTO size
- object allocation
- date/time serialization
- polymorphic serialization
- large collections
- streaming vs aggregation
- compression cost
```

Do not benchmark Netty alone.

Benchmark:

```text
real endpoint
real JSON payload
real provider
real validation
real auth filter
real downstream stub latency
```

---

## 30. Integration Testing

Netty deployment must be tested as deployment, not just resources.

Test:

```text
server starts
GET /health/live
GET /health/ready
GET JSON
POST JSON
large payload rejection
invalid JSON
exception mapper
request id
timeout behavior
shutdown
concurrent requests
blocking endpoint under load
```

Add a diagnostic endpoint in non-prod:

```java
@GET
@Path("/debug/thread")
public String thread() {
    return Thread.currentThread().getName();
}
```

Use it to verify execution threads.

Remove or protect debug endpoints in production.

---

## 31. Load Testing Focus

For Netty/Jersey, load testing should answer:

```text
Does resource execution block event loop?
What happens when DB latency increases?
What happens when downstream times out?
What happens when request rate exceeds worker capacity?
Does readiness go false?
Do we return 503 or just queue?
Does event-loop lag increase?
Does direct memory grow?
Are ByteBuf leaks reported?
What is p99 latency under overload?
```

Use scenario-based tests:

```text
normal load
burst load
slow downstream
DB pool exhaustion
large payload
slow client
client disconnect
shutdown under load
```

Netty deployment without failure load test is risky.

---

## 32. Common Failure Modes

### 32.1 Event Loop Blocking

Symptom:

```text
all requests slow
health slow
CPU maybe low
thread dump shows event loop in blocking call
```

Fix:

```text
offload blocking work
add timeouts
separate CPU/blocking executors
limit concurrency
```

---

### 32.2 Direct Memory OOM

Symptom:

```text
OutOfMemoryError: Direct buffer memory
```

Causes:

```text
large buffers
leaks
unbounded aggregation
high connection count
insufficient direct memory
```

Fix:

```text
limit request size
monitor direct memory
enable leak detection in non-prod
tune direct memory
upgrade/fix leaking code
```

---

### 32.3 Provider Missing

Symptom:

```text
MessageBodyWriter not found
```

Causes:

```text
JSON provider missing
service descriptor lost
wrong namespace
provider not registered
```

Fix:

```text
add jersey-media-json-jackson
register JacksonFeature
merge service files
align javax/jakarta
```

---

### 32.4 Netty Version Conflict

Symptom:

```text
NoSuchMethodError
NoClassDefFoundError
pipeline behavior failure
```

Cause:

```text
Netty artifacts mixed versions
transitive dependency overrides
```

Fix:

```text
dependency convergence
Netty BOM if managing directly
inspect dependency tree
```

---

### 32.5 Readiness Lies

Symptom:

```text
pod ready but executor queue full
p99 explodes
timeouts increase
```

Fix:

```text
readiness includes saturation signal carefully
load shedding
bounded queues
timeouts
circuit breaker
```

---

### 32.6 Shutdown Drops Responses

Cause:

```text
event loop closed before writes flush
worker executor killed too early
readiness not false before stop
```

Fix:

```text
graceful shutdown sequence
drain period
coordinated channel/executor close
termination grace alignment
```

---

## 33. Anti-Patterns

### Anti-Pattern 1 — Choosing Netty Because It Sounds Fast

Netty is not a magic speed layer.

Use it when event-driven model is needed.

---

### Anti-Pattern 2 — Blocking in Event Loop

This destroys Netty’s core advantage.

---

### Anti-Pattern 3 — Unbounded Worker Executor

This converts overload into thread explosion.

---

### Anti-Pattern 4 — Unbounded Request Aggregation

This converts large payloads into memory incidents.

---

### Anti-Pattern 5 — No Direct Memory Monitoring

Netty can fail outside normal heap expectations.

---

### Anti-Pattern 6 — No Failure Load Test

Netty behavior under normal load may look great.

Under failure, hidden queues and event-loop blocking become visible.

---

## 34. Decision Matrix

| Dimension | Jersey + Netty |
|---|---|
| Runtime type | Embedded event-driven HTTP runtime |
| Servlet support | No |
| Best for | event-driven/network-sensitive services |
| Main strength | scalable connection/event processing |
| Main risk | blocking event loop |
| Threading model | event loop + possible offload executors |
| Memory model | heap + direct buffers |
| Complexity | high |
| Operational requirement | strong metrics/load testing |
| Good default for normal REST CRUD? | usually no |
| Good when Netty-specific need exists? | yes |
| Requires team Netty knowledge? | strongly yes |

---

## 35. When to Choose Netty

Choose Jersey + Netty if:

```text
- you need event-driven network behavior
- you understand blocking boundaries
- you can monitor event loop/direct memory
- you need many connections or streaming-style patterns
- you do not need Servlet API
- you have strong load/failure tests
- your team can operate Netty
```

Do not choose it if:

```text
- typical blocking CRUD REST service
- team expects servlet mental model
- no event-loop observability
- no load testing
- only reason is “performance”
- dependency graph already complex
```

In many enterprise APIs, embedded Jetty/Grizzly/Tomcat-style deployment is easier and safer.

---

## 36. Top-Tier Engineering Perspective

A basic engineer says:

```text
Netty is fast.
```

A senior engineer says:

```text
Netty is event-driven and must not be blocked.
```

A top-tier engineer asks:

```text
What thread executes resource methods?
What work is blocking?
Where is offload boundary?
What queues exist?
What is bounded?
What is rejected?
What happens when DB slows down?
What happens to event-loop lag?
How is direct memory monitored?
Can readiness reflect saturation?
How do we drain connections at shutdown?
What does p99 do under partial outage?
```

That is the level required to use Netty safely.

---

## 37. Production Readiness Checklist

```text
[ ] Java version pinned.
[ ] Jersey version family aligned.
[ ] jersey-container-netty-http included.
[ ] Netty versions converged.
[ ] No mixed javax/jakarta namespace.
[ ] ResourceConfig explicit for critical resources/providers.
[ ] JSON provider present and tested.
[ ] Resource execution thread verified.
[ ] Event loop not blocked by resource logic.
[ ] Blocking executor bounded if used.
[ ] Executor queue and rejection monitored.
[ ] Downstream timeouts configured.
[ ] Request body size bounded.
[ ] Direct memory monitored.
[ ] ByteBuf leak detection used in non-prod.
[ ] Event loop lag monitored.
[ ] Health live/ready implemented.
[ ] Readiness false before shutdown.
[ ] Graceful shutdown sequence tested.
[ ] Docker memory/direct memory considered.
[ ] Kubernetes probes aligned.
[ ] Access logging strategy defined.
[ ] Request correlation propagates through async boundaries.
[ ] Reverse proxy forwarded header strategy defined.
[ ] TLS ownership decided.
[ ] Load test includes normal, burst, slow downstream, overload, shutdown.
[ ] Operational limitations documented.
```

---

## 38. Summary

Netty-based Jersey deployment is powerful but easy to misuse.

Its essence:

```text
Netty handles event-driven network I/O.
Jersey handles REST resource dispatch.
Application must protect event loops from blocking work.
```

Compared to Grizzly/Jetty/JDK HTTP Server, Netty requires stronger understanding of:

- event loops,
- pipelines,
- direct memory,
- executor offload,
- request aggregation,
- backpressure,
- overload,
- latency under failure.

The right conclusion is not:

```text
Netty is better.
```

The right conclusion is:

```text
Netty is better for workloads that match Netty’s model.
```

For ordinary blocking enterprise REST APIs, Netty can be unnecessary complexity.

For carefully designed event-driven/high-connection/network-sensitive services, it can be a strong runtime choice.

---

## 39. How This Part Connects to the Next Part

This part covered Netty-based deployment as an embedded event-driven runtime.

Next:

```text
Part 14 — Jakarta EE Server Deployment: GlassFish, Payara, Open Liberty, WildFly, dan Runtime Managed Model
```

The mental model will shift again.

From:

```text
application owns HTTP runtime
```

to:

```text
application is deployed into managed enterprise runtime
```

Part 14 will focus on:

- container-managed Jakarta REST,
- CDI,
- transactions,
- security,
- classloader/module ownership,
- app server-provided APIs,
- WAR deployment into full platform,
- runtime services vs application-owned services,
- why dependency scope changes dramatically in managed servers.

---

## References

- Eclipse Jersey documentation — Application Deployment and Runtime, Netty HTTP Server section: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/deployment.html
- Netty official home: https://netty.io/
- Netty User Guide for 4.x: https://netty.io/wiki/user-guide-for-4.x.html
- Netty `ChannelPipeline` API documentation: https://netty.io/4.1/api/io/netty/channel/ChannelPipeline.html
- Maven Central — `jersey-container-netty-http`: https://repo1.maven.org/maven2/org/glassfish/jersey/containers/jersey-container-netty-http/
- Jakarta RESTful Web Services 4.0: https://jakarta.ee/specifications/restful-ws/4.0/


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-012.md">⬅️ Part 12 — JDK HTTP Server and Lightweight Deployment</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-014.md">Part 14 — Jakarta EE Server Deployment: GlassFish, Payara, Open Liberty, WildFly, dan Runtime Managed Model ➡️</a>
</div>
