# Part 15 — Connection Pooling and Resource Management

Series: `learn-java-io-network-http-grpc-protocol-engineering`  
Target Java: 8–25  
Status: Part 15 of 35

---

## 0. Why This Part Exists

A connection pool looks simple from the outside:

```java
HttpClient client = HttpClient.newHttpClient();
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

or:

```java
CloseableHttpClient client = HttpClients.custom()
    .setConnectionManager(poolingConnectionManager)
    .build();
```

or:

```java
ManagedChannel channel = ManagedChannelBuilder
    .forAddress(host, port)
    .useTransportSecurity()
    .build();
```

But in production, the pool/channel is not just an optimization. It is a **stateful network resource manager**.

It decides:

- how many concurrent requests can actually leave the process;
- how long threads/tasks wait before acquiring a connection;
- whether stale sockets are reused;
- whether the client keeps talking to a dead endpoint;
- whether DNS changes are respected;
- whether load balancers receive balanced traffic;
- whether retries amplify a dependency outage;
- whether memory, file descriptors, ephemeral ports, and event-loop threads are protected;
- whether failures are explicit, delayed, or hidden behind queues.

A top-tier Java engineer does not treat connection pooling as “turn on keep-alive and set max connections.” A top-tier engineer treats the pool as a **bounded concurrency governor for remote communication**.

The core thesis of this part:

> A connection pool is not merely a cache of TCP connections. It is a resource boundary, a queue, a failure amplifier, a load distribution mechanism, and an observability point.

---

## 1. What We Will Not Repeat

You already learned Java socket basics, NIO, HTTP semantics, HTTP/1.1, HTTP/2, timeout engineering, and retry/idempotency.

So this part will not re-explain:

- what TCP is;
- how HTTP request/response works;
- what `InputStream` and `Socket` do;
- how to create a basic REST client;
- how to configure a simple timeout;
- why retry needs backoff.

Instead, we focus on the production behavior that emerges when many Java calls share finite connections.

---

## 2. The Mental Model: Pool as a Stateful Boundary

A single outbound call has this simplified path:

```text
Application thread/task
  -> client wrapper
  -> retry/deadline layer
  -> connection/channel acquisition
  -> protocol stream/request creation
  -> TLS/TCP connection reuse or creation
  -> write request
  -> wait for response
  -> consume body
  -> release/reuse/close connection
```

The connection pool sits in the middle:

```text
caller concurrency
      |
      v
+-------------------------------+
| connection acquisition queue   |
+-------------------------------+
      |
      v
+-------------------------------+
| leased / active connections    |
+-------------------------------+
      |
      v
+-------------------------------+
| remote endpoint capacity       |
+-------------------------------+
```

For HTTP/1.1, one connection is usually occupied by one in-flight request at a time.

For HTTP/2 and gRPC, one physical connection can carry multiple concurrent streams, but the same principle remains: there is still a finite concurrency boundary, only now the unit is often **stream capacity** rather than raw connection count.

Therefore, never ask only:

```text
How many connections do we have?
```

Ask:

```text
How many in-flight operations can leave this process for this dependency,
under this protocol,
through this pool/channel,
before calls start queueing or failing?
```

---

## 3. Connection Reuse: Why Pools Exist

Opening a new remote connection is expensive because it may involve:

```text
DNS resolution
-> TCP handshake
-> TLS handshake
-> ALPN negotiation
-> HTTP request write
-> server processing
-> response read
```

Connection reuse avoids repeatedly paying the setup cost.

With TLS, reuse is especially valuable because handshakes consume CPU, network round trips, and sometimes remote cryptographic resources.

But reuse has a downside: the client now holds **state** about the remote world.

That state may become stale:

- DNS records change;
- Kubernetes pods rotate;
- load balancer target set changes;
- NAT mappings expire;
- firewall state expires;
- server closes idle connection;
- certificate rotates;
- remote deploy drains connections;
- proxy sends `GOAWAY`;
- service mesh changes route;
- idle socket becomes half-closed.

So the core tension is:

```text
reuse enough to reduce overhead
but not so aggressively that stale topology and stale sockets dominate behavior
```

---

## 4. Three Different “Keep Alive” Concepts

Many incidents happen because engineers use “keepalive” ambiguously.

There are at least three different concepts.

### 4.1 HTTP Persistent Connection / HTTP Keep-Alive

This means the HTTP client keeps the underlying connection open after a response so the next request can reuse it.

For HTTP/1.1, persistent connections are normal unless either side closes the connection.

This is about **reuse**.

### 4.2 TCP Keepalive

TCP keepalive is an operating-system-level mechanism that can probe whether an idle TCP connection is still alive.

This is about detecting dead peers on otherwise idle connections.

It is usually slow by default and not a replacement for request timeouts.

### 4.3 gRPC / HTTP/2 Keepalive Ping

gRPC keepalive uses HTTP/2 PING frames to keep a transport alive or detect broken connections.

This is protocol-level and must be configured carefully because overly aggressive keepalive can create unnecessary load or trigger server enforcement.

### 4.4 Practical Rule

Use clear vocabulary:

```text
HTTP connection reuse      = can the connection be reused after response?
TCP keepalive              = OS-level idle connection probing
HTTP/2/gRPC keepalive ping = protocol-level ping on an HTTP/2 connection
idle eviction              = client closes unused pooled connections
connection TTL             = maximum connection age regardless of activity
request timeout            = maximum time for a request attempt
operation deadline         = maximum time for the full logical operation
```

Never solve a request latency problem by blindly enabling TCP keepalive.

---

## 5. Pool State Machine

A pooled connection typically moves through these states:

```text
created
  -> connecting
  -> handshaking
  -> idle/available
  -> leased/active
  -> returned to pool
  -> idle/available
  -> expired/stale/closed
```

For HTTP/1.1:

```text
idle connection
  -> leased to one request
  -> request writes body
  -> response reads body completely
  -> returned if reusable
  -> closed if protocol/server/client says not reusable
```

For HTTP/2/gRPC:

```text
connection/channel
  -> multiple streams active
  -> stream finishes independently
  -> connection remains usable while stream capacity remains
  -> connection drains on GOAWAY/shutdown
  -> new streams rejected/queued/routed elsewhere
```

The important point: **release is not always automatic when headers arrive**.

For many clients, a connection is reusable only after the response body is consumed, discarded, or closed properly.

A common leak:

```java
HttpResponse<InputStream> response = client.send(request, BodyHandlers.ofInputStream());
if (response.statusCode() >= 400) {
    throw new RemoteCallException("failed"); // input stream not consumed/closed
}
```

Correct pattern:

```java
HttpResponse<InputStream> response = client.send(request, BodyHandlers.ofInputStream());
try (InputStream body = response.body()) {
    if (response.statusCode() >= 400) {
        byte[] errorBytes = body.readNBytes(8192); // bounded diagnostic read
        throw new RemoteCallException("failed: " + response.statusCode());
    }
    process(body);
}
```

For body handlers that fully buffer response data, the client may release the connection after buffering completes. For streaming body handlers, the application owns the responsibility to close/consume.

---

## 6. Pool Capacity Is Not Just “Max Connections”

Pool capacity has several dimensions.

### 6.1 Physical Connections

```text
max total connections
max connections per route/origin/host
max idle connections
max connection lifetime
max idle lifetime
```

### 6.2 Logical Concurrency

For HTTP/1.1:

```text
max in-flight requests per route ≈ max leased connections per route
```

For HTTP/2:

```text
max in-flight requests per origin ≈ number of connections * max concurrent streams per connection
```

For gRPC:

```text
max in-flight RPCs ≈ channels * connections per channel * max concurrent streams per connection
```

The server can advertise or enforce max concurrent streams. When the active RPC count reaches the limit, extra RPCs may queue client-side.

### 6.3 Queue Capacity

Many clients have an implicit or explicit acquisition queue:

```text
caller waits for a connection/stream slot
```

This queue is dangerous if unbounded because it converts overload into latency.

A healthy system should usually prefer:

```text
bounded wait -> fail fast -> retry/backoff/load shed
```

over:

```text
wait forever -> consume caller threads/tasks -> miss deadlines -> retry late -> amplify outage
```

### 6.4 File Descriptors

Every TCP connection consumes a file descriptor.

If a JVM opens too many outbound connections, it can hit OS limits:

```text
java.net.SocketException: Too many open files
```

### 6.5 Ephemeral Ports

Outbound TCP connections consume local ephemeral ports. Excessive connection churn can exhaust ephemeral ports, especially if many connections enter `TIME_WAIT`.

A pool helps reduce churn, but a misconfigured pool can also hold too many connections for too long.

### 6.6 Memory and Buffers

Connections carry buffers:

- socket receive buffer;
- socket send buffer;
- TLS buffers;
- HTTP parser buffers;
- Netty `ByteBuf`s;
- application response buffers;
- compression buffers;
- pending write queues.

A “small” max connection increase can become a large memory increase when payloads are large or clients are slow.

---

## 7. Pool Sizing: A Practical Model

Do not size a pool by guessing.

Start from this model:

```text
needed_concurrency ≈ target_throughput_per_second * average_service_time_seconds
```

This is Little’s Law in practical form.

If your service sends 200 calls/sec to dependency X and average dependency latency is 100 ms:

```text
needed concurrency ≈ 200 * 0.100 = 20
```

If p95 latency becomes 500 ms during load:

```text
needed concurrency ≈ 200 * 0.500 = 100
```

This means latency spikes increase required concurrency. If your pool is fixed at 20, callers start queueing.

But blindly increasing the pool to 100 may overload the dependency.

So pool sizing must satisfy both:

```text
client demand can be served without excessive queueing
remote dependency is protected from excessive concurrency
```

### 7.1 HTTP/1.1 Pool Sizing Example

Suppose:

```text
Target outbound rate to Payment API: 100 req/s
Normal p95 latency: 200 ms
Incident p95 latency budget before fail-fast: 800 ms
Remote team says safe concurrency: 50
```

Normal concurrency:

```text
100 * 0.2 = 20
```

Worst tolerated concurrency:

```text
100 * 0.8 = 80
```

Remote safe concurrency is 50.

A reasonable starting design:

```text
max per route: 40–50
pool acquisition timeout: small, e.g. 50–150 ms depending on SLA
request timeout/deadline: bounded, e.g. 800 ms or less
retry budget: small and deadline-aware
bulkhead: separate pool for this dependency
```

This says:

```text
We accept bounded queueing, but we do not let caller concurrency exceed remote capacity indefinitely.
```

### 7.2 HTTP/2 Pool Sizing Example

Suppose one HTTP/2 connection supports 100 concurrent streams, but you have long-lived streaming calls.

If 80 streams are long-lived, only 20 are effectively available for short calls.

So the question is not:

```text
Do we have an HTTP/2 connection?
```

The question is:

```text
How much stream capacity remains for the traffic class that matters?
```

You may need separate clients/channels for:

- short unary calls;
- long streaming calls;
- bulk transfer;
- low-priority background work.

### 7.3 gRPC Channel Sizing Example

A gRPC channel is not just a socket. It is a virtual connection abstraction that can manage underlying HTTP/2 connections and subchannels depending on resolver and load-balancing configuration.

For many applications, one reused channel per target is correct.

But at high load, or with long-lived streams, a single connection’s max concurrent streams can become a hidden queue. gRPC performance guidance explicitly notes that each channel uses zero or more HTTP/2 connections, each connection usually has a concurrent stream limit, and calls may queue when active RPCs reach that limit.

Practical options:

```text
reuse channels by default
measure queued RPC behavior
separate high-volume stream traffic from unary traffic
use appropriate load-balancing policy
consider multiple channels only when stream limits/queueing justify it
avoid creating a channel per RPC
```

---

## 8. Per-Dependency Isolation

A common anti-pattern:

```text
one global HTTP client/pool for all outbound dependencies
```

This creates cross-dependency interference.

If Dependency A becomes slow and consumes all pool slots, calls to Dependency B may fail even though B is healthy.

Better model:

```text
client/pool per dependency or per dependency class
```

Example:

```text
User API client       -> max 50, deadline 500 ms
Document API client   -> max 20, deadline 2 s, streaming enabled
Notification client   -> max 10, deadline 1 s
Audit sink client     -> max 30, deadline 300 ms, fail-open or buffer based on policy
External agency API   -> max 5, deadline 5 s, strict rate limit
```

This is bulkhead design.

Each dependency gets its own:

- connection limit;
- acquisition timeout;
- request timeout;
- retry policy;
- circuit breaker;
- rate limiter;
- metrics;
- logging category;
- alert threshold.

Top-tier systems rarely use one undifferentiated outbound client for everything.

---

## 9. Pool Acquisition Timeout

Many engineers set connect timeout and request timeout, but forget acquisition timeout.

Pool acquisition timeout answers:

```text
How long may a caller wait before it even gets a connection/stream slot?
```

Without an acquisition timeout:

```text
remote slow -> active connections occupied longer
-> pool exhausted
-> callers queue indefinitely
-> caller threads/tasks pile up
-> deadlines are missed before request even starts
-> retries arrive late
-> service appears globally slow
```

Healthy pattern:

```text
if no capacity quickly, fail with explicit local saturation error
```

This is not being pessimistic. It is protecting the service.

### 9.1 Distinguish Local Saturation from Remote Failure

If a request fails because no connection was available, that is not the same as the remote returning 503.

Use distinct classification:

```text
REMOTE_CONNECT_TIMEOUT
REMOTE_READ_TIMEOUT
REMOTE_5XX
REMOTE_429
LOCAL_POOL_TIMEOUT
LOCAL_BULKHEAD_REJECTED
LOCAL_DEADLINE_EXCEEDED_BEFORE_SEND
```

This matters for alerting.

If you see `LOCAL_POOL_TIMEOUT`, the immediate mitigation may be:

- reduce caller concurrency;
- increase pool if remote can handle it;
- split traffic classes;
- reduce retries;
- fix response body leaks;
- tune slow dependency timeout;
- add bulkhead/load shedding.

If you only log “HTTP call failed”, you lose the diagnosis.

---

## 10. Idle Timeout, Keep-Alive Timeout, and Connection TTL

These three settings are often confused.

### 10.1 Idle Timeout / Idle Eviction

How long may a connection sit unused in the pool?

If too long:

- stale sockets increase;
- DNS/load balancer changes are ignored longer;
- server may close first;
- next reuse may fail.

If too short:

- excessive connection churn;
- more TLS handshakes;
- more CPU;
- more latency;
- possible ephemeral port pressure.

### 10.2 Keep-Alive Timeout

In HTTP client libraries, this often means how long to keep idle persistent connections alive before closing.

But always verify library semantics.

### 10.3 Connection TTL

Maximum age of a connection regardless of whether it is active or idle.

TTL is useful when:

- DNS changes should be respected eventually;
- load balancer target rotation matters;
- long-lived connections pin traffic to old backends;
- certificate or network path changes need eventual turnover;
- NAT/firewall path behavior is unpredictable.

### 10.4 Recommended Mental Model

Use both:

```text
idle timeout -> closes unused connections
connection TTL -> prevents immortal connections
```

The right values depend on:

- DNS TTL;
- load balancer idle timeout;
- server keep-alive timeout;
- request rate;
- TLS handshake cost;
- failure tolerance;
- deployment frequency;
- service mesh/proxy behavior.

---

## 11. Stale Connections and Half-Closed Sockets

A stale connection is a connection the client thinks is reusable, but the network/server has already made unusable.

Example path:

```text
client sends request
-> connection reused from pool
-> server/proxy had already closed idle connection
-> client write/read fails
-> IOException / reset / EOF
```

This is common with idle timeout mismatch:

```text
client idle keepalive: 5 minutes
load balancer idle timeout: 60 seconds
server idle timeout: 75 seconds
```

At 2 minutes, the client may reuse a socket the LB has already killed.

Mitigations:

```text
client idle timeout shorter than LB/server idle timeout
stale connection validation if library supports it
retry only if request is safe/idempotent/replayable
connection TTL
consume/close response bodies correctly
observe resets on reused connections
```

Do not treat occasional stale connection errors as surprising. They are normal in distributed systems. The goal is to make them bounded, observable, and safely retryable when appropriate.

---

## 12. DNS, Load Balancing, and Connection Pinning

Connection pooling interacts strongly with DNS and load balancing.

Suppose DNS resolves:

```text
api.example.local -> 10.0.1.10, 10.0.1.11, 10.0.1.12
```

The client opens a persistent connection to `10.0.1.10`.

If request rate is high and connection reuse is strong, that connection may stay hot for a long time. DNS may rotate, but the existing connection does not care.

Important invariant:

> DNS affects new connections, not already established connections.

This matters for:

- blue/green deployments;
- Kubernetes endpoint rotation;
- load balancer target draining;
- failover;
- uneven traffic distribution;
- sticky long-lived HTTP/2/gRPC connections.

### 12.1 HTTP/1.1

Multiple connections may distribute across resolved IPs depending on client behavior and resolver behavior.

### 12.2 HTTP/2/gRPC

One connection can carry many streams. This improves efficiency, but can reduce natural connection spreading.

A single long-lived HTTP/2 connection may pin much traffic to one backend/load-balancer path unless the client/load-balancer architecture accounts for this.

### 12.3 Practical Controls

Use:

```text
connection TTL
resolver refresh
client-side load balancing where appropriate
server-side LB aware of HTTP/2/gRPC
separate channels for long-lived streams
GOAWAY/draining behavior during deploy
metrics by remote address/backend when possible
```

---

## 13. HTTP/1.1 vs HTTP/2 Pooling

### 13.1 HTTP/1.1

Mental model:

```text
one request occupies one connection
```

Therefore:

```text
max connections ≈ max concurrent in-flight requests
```

With HTTP/1.1, pool sizing is direct but connection count can grow high.

Failure modes:

- pool exhausted;
- many sockets;
- TIME_WAIT churn if no reuse;
- stale idle sockets;
- per-route imbalance;
- head-of-line blocking per connection;
- body not consumed prevents reuse.

### 13.2 HTTP/2

Mental model:

```text
many streams share one connection
```

Therefore:

```text
max connections != max concurrent requests
```

Concurrency is governed by stream limits, flow-control windows, server settings, and client implementation.

Failure modes:

- hidden stream queueing;
- one TCP connection experiences packet loss and affects all streams;
- large stream consumes flow-control window;
- GOAWAY drains connection;
- max concurrent streams reached;
- long-lived streams reduce capacity for short calls;
- fewer connections may mean less backend distribution.

### 13.3 Practical Comparison

| Concern | HTTP/1.1 | HTTP/2 / gRPC |
|---|---:|---:|
| Physical connection count | Often higher | Often lower |
| In-flight per connection | Usually 1 | Many streams |
| Pool sizing unit | Connection | Stream capacity + connection |
| Natural backend spreading | More connections can spread | Long-lived connection can pin |
| Head-of-line blocking | Application/protocol per connection | TCP-level still exists |
| Body leak impact | Occupies connection | Occupies stream and flow-control resources |
| Idle timeout issue | Common | Common but via connection/channel |
| GOAWAY handling | Not applicable in HTTP/1.1 sense | Critical |

---

## 14. Java Client-Specific Notes

### 14.1 JDK `java.net.http.HttpClient`

JDK `HttpClient` is immutable once built and can be reused for many requests. It supports HTTP/1.1 and HTTP/2 in Java 25.

Important production notes:

- create one long-lived client per dependency profile, not one per request;
- configure connect timeout;
- configure request timeout per request;
- understand that detailed pool knobs are not as explicit as Apache HttpClient;
- use system properties carefully if you need global HTTP client behavior;
- observe behavior through metrics/logging wrappers because the built-in pool is not exposed like a traditional pool manager;
- avoid unbounded `sendAsync` fan-out;
- body handling controls memory and connection reuse.

Example dependency-specific client wrapper:

```java
public final class AgencyClient {
    private final HttpClient client;
    private final URI baseUri;
    private final Duration operationTimeout;
    private final Semaphore concurrency;

    public AgencyClient(URI baseUri, int maxConcurrent, Duration connectTimeout, Duration operationTimeout) {
        this.baseUri = baseUri;
        this.operationTimeout = operationTimeout;
        this.concurrency = new Semaphore(maxConcurrent);
        this.client = HttpClient.newBuilder()
            .connectTimeout(connectTimeout)
            .version(HttpClient.Version.HTTP_2)
            .build();
    }

    public String getCase(String caseId) throws Exception {
        if (!concurrency.tryAcquire(50, TimeUnit.MILLISECONDS)) {
            throw new LocalSaturationException("agency-client bulkhead exhausted");
        }
        try {
            HttpRequest request = HttpRequest.newBuilder(baseUri.resolve("/cases/" + caseId))
                .timeout(operationTimeout)
                .GET()
                .header("Accept", "application/json")
                .build();

            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                throw new RemoteHttpException(response.statusCode(), response.body());
            }
            return response.body();
        } finally {
            concurrency.release();
        }
    }
}
```

Why add a semaphore if the client has a pool?

Because JDK `HttpClient` does not give the same explicit per-route pool-acquisition controls as Apache HttpClient. A wrapper-level bulkhead makes concurrency intentional and observable.

### 14.2 Apache HttpClient 5

Apache HttpClient is strong when you need explicit control over:

- max total connections;
- max per route;
- connection request timeout;
- connect timeout;
- response timeout;
- connection TTL;
- idle eviction;
- stale connection validation;
- route-specific configuration.

Mental model:

```text
PoolingHttpClientConnectionManager = explicit HTTP/1.1/HTTP client pool manager
```

Typical concerns:

```text
set maxTotal
set defaultMaxPerRoute
set connection request timeout
set connect timeout
set response timeout
set TTL/idle timeout
close idle/expired connections
consume entities
```

Pseudo-configuration:

```java
PoolingHttpClientConnectionManager cm = PoolingHttpClientConnectionManagerBuilder.create()
    .setDefaultConnectionConfig(ConnectionConfig.custom()
        .setConnectTimeout(Timeout.ofMilliseconds(300))
        .setSocketTimeout(Timeout.ofMilliseconds(800))
        .setTimeToLive(TimeValue.ofMinutes(5))
        .build())
    .setMaxConnTotal(100)
    .setMaxConnPerRoute(50)
    .build();

RequestConfig requestConfig = RequestConfig.custom()
    .setConnectionRequestTimeout(Timeout.ofMilliseconds(100))
    .setResponseTimeout(Timeout.ofMilliseconds(800))
    .build();

CloseableHttpClient client = HttpClients.custom()
    .setConnectionManager(cm)
    .setDefaultRequestConfig(requestConfig)
    .evictExpiredConnections()
    .evictIdleConnections(TimeValue.ofSeconds(30))
    .build();
```

The exact API changes across versions, but the engineering idea is stable:

```text
bound the pool
bound acquisition wait
bound connect
bound response
expire stale resources
observe pool stats
```

### 14.3 OkHttp

OkHttp is efficient by default and has its own connection pool behavior.

It is common in Android and also used in JVM clients.

Key ideas:

- reuse a singleton `OkHttpClient` per configuration;
- do not create a new client per request;
- configure dispatcher if you need max concurrent request control;
- configure connection pool if idle behavior matters;
- configure timeouts explicitly;
- understand that max idle connections is not the same as max active connections.

Example:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .connectionPool(new ConnectionPool(20, 5, TimeUnit.MINUTES))
    .connectTimeout(Duration.ofMillis(300))
    .readTimeout(Duration.ofMillis(800))
    .writeTimeout(Duration.ofMillis(800))
    .callTimeout(Duration.ofSeconds(1))
    .build();
```

OkHttp also has a `Dispatcher` to limit concurrent calls:

```java
Dispatcher dispatcher = new Dispatcher();
dispatcher.setMaxRequests(100);
dispatcher.setMaxRequestsPerHost(20);

OkHttpClient client = new OkHttpClient.Builder()
    .dispatcher(dispatcher)
    .build();
```

This separation is important:

```text
ConnectionPool controls idle connection reuse.
Dispatcher controls call concurrency.
```

### 14.4 Netty / Reactor Netty

Netty is lower-level and event-loop based.

In Netty-based clients, resource management includes:

- event loop groups;
- connection provider/pool;
- channel pipeline;
- pending acquire queue;
- pending acquire timeout;
- max connections;
- idle/lifetime eviction;
- ByteBuf allocation/leak detection;
- avoiding blocking inside event loops.

Reactor Netty exposes connection provider concepts such as max connections and pending acquire behavior.

The most important mental model:

```text
Event loop threads are scarce. Do not block them.
```

If connection pooling is wrong in a Netty client, symptoms may include:

- pending acquire timeout;
- event loop blocked warning;
- write queue growth;
- memory pressure from pending buffers;
- ByteBuf leak;
- high tail latency despite low CPU.

### 14.5 gRPC Java

gRPC Java usually uses Netty transport for server/client in backend systems.

Best practice:

```text
reuse ManagedChannel
reuse stubs built on that channel
shutdown channels gracefully at application shutdown
avoid channel-per-call
```

But do not oversimplify.

A gRPC channel can multiplex RPCs over HTTP/2. If active streams hit server/client limits, additional RPCs may queue. Long-lived streaming RPCs can consume stream capacity. Load balancing policy and name resolution affect how subchannels/connections are used.

Production considerations:

```text
channel reuse
deadline per RPC
keepalive only when justified
max inbound message size
flow-control behavior for streaming
separate channels for long-lived streaming vs unary traffic
client-side load balancing when needed
observe channel state and RPC latency
```

---

## 15. Response Body Handling and Pool Leaks

Connection leaks often happen when application code does not finish the response lifecycle.

### 15.1 Buffered Body

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

This fully reads the response into memory. It is easy for reuse but dangerous for large responses.

### 15.2 Streaming Body

```java
HttpResponse<InputStream> response = client.send(request, BodyHandlers.ofInputStream());
```

This avoids buffering the whole response, but the caller must close the stream.

### 15.3 Apache Entity Consumption

With Apache HttpClient, failing to consume or close an entity can prevent the connection from returning to the pool.

Conceptual pattern:

```java
try (CloseableHttpResponse response = client.execute(request)) {
    HttpEntity entity = response.getEntity();
    try (InputStream in = entity.getContent()) {
        process(in);
    }
}
```

or use utility consumption where appropriate.

### 15.4 Anti-Pattern: Throw Before Close

```java
var response = client.execute(request);
if (response.getCode() != 200) {
    throw new RuntimeException("bad response");
}
```

This may leak the response resource.

Correct:

```java
try (var response = client.executeOpen(null, request, null)) {
    int code = response.getCode();
    String body = response.getEntity() == null
        ? ""
        : EntityUtils.toString(response.getEntity());

    if (code / 100 != 2) {
        throw new RemoteHttpException(code, body);
    }
    return body;
}
```

The exact API may vary, but the invariant does not:

> Every response must be fully consumed, explicitly discarded, or closed.

---

## 16. Resource Budgeting Across the JVM

A network client consumes more than connections.

### 16.1 Threads

Blocking clients consume caller threads while waiting.

Virtual threads reduce the cost of blocking, but they do not remove:

- remote capacity limits;
- connection limits;
- memory pressure;
- database pool limits;
- rate limits;
- deadlines;
- queueing effects.

Virtual threads make it easier to write synchronous code, not safe to issue unlimited concurrent remote calls.

### 16.2 Event Loops

Async/event-loop clients use fewer threads but require strict non-blocking behavior.

One blocking operation inside an event loop can delay many connections.

### 16.3 Memory

Watch:

- pending request queue;
- response buffering;
- compression buffers;
- TLS buffers;
- direct buffers;
- Netty pooled buffers;
- error body logging;
- request aggregation.

### 16.4 File Descriptors

Each socket uses descriptors. Also watch files, pipes, logs, and database sockets.

### 16.5 CPU

Connection churn increases:

- TLS handshake CPU;
- certificate validation cost;
- compression cost;
- parsing cost;
- context switching.

### 16.6 Remote Capacity

Your pool is also a remote-protection device.

If remote can safely handle only 30 concurrent calls from your service, setting pool to 500 is not generosity. It is an outage plan.

---

## 17. Connection Pool Metrics

A production pool should expose at least:

```text
max connections
active/leased connections
idle/available connections
pending acquisition count
pool acquisition latency
pool acquisition timeout count
connection creation count
connection close count
idle eviction count
expired connection close count
stale connection failure count
request latency by dependency
request latency excluding pool wait
request latency including pool wait
error classification
remote address/backend when possible
protocol version
HTTP/2 active stream count if available
gRPC channel state / active RPCs if available
```

### 17.1 Separate Latency Components

Do not measure only total latency.

Break it down:

```text
queue/acquisition time
connect time
TLS handshake time
request write time
time to first byte
body read time
application processing time
```

Even if not all clients expose every component, wrappers and traces should separate at least:

```text
local wait vs remote wait
```

Because the mitigation differs.

### 17.2 Key Alert Patterns

| Symptom | Likely Meaning |
|---|---|
| pending acquisition rising | pool saturation or leak |
| active high, idle zero | capacity exhausted |
| active low, pending high | broken pool/config/thread issue |
| connection creation spike | reuse broken or idle timeout too low |
| reset on first write/read after idle | stale connection / LB idle mismatch |
| p99 high, p50 normal | queueing, retries, GC, packet loss, remote tail |
| high TLS handshake count | connection churn |
| high CLOSE_WAIT | response/socket close leak |
| many TIME_WAIT | connection churn / no reuse |

---

## 18. Queueing: The Hidden Enemy

When pool capacity is exhausted, requests queue.

Queueing creates nonlinear latency.

Example:

```text
pool capacity: 20
normal active: 15
remote latency: 100 ms
```

Fine.

Now remote latency rises to 1 second.

```text
same arrival rate
connections occupied 10x longer
active quickly reaches 20
new callers queue
queued callers still consume threads/tasks/deadline
retries may add more callers
```

This is why latency failures become availability failures.

### 18.1 Good Queueing

Small bounded queue:

```text
absorbs tiny bursts
fails quickly under real overload
measurable
```

### 18.2 Bad Queueing

Large/unbounded queue:

```text
hides overload
increases tail latency
causes deadline misses
makes retries late
consumes memory
produces synchronized timeout waves
```

### 18.3 Practical Rule

For remote calls, default to:

```text
small acquisition timeout
bounded concurrency
deadline-aware retry
clear local-saturation error
```

---

## 19. Interaction with Retry

Retry multiplies pool pressure.

Suppose:

```text
original traffic: 100 req/s
retry attempts: 2 additional attempts
```

Worst-case offered load:

```text
300 attempts/s
```

If remote is slow, each attempt occupies connections longer.

So the pool sees both:

```text
higher arrival rate
higher service time
```

That is a double multiplier.

### 19.1 Retry Must Be Pool-Aware

Before retrying, ask:

```text
Is there remaining deadline?
Is the operation idempotent/replayable?
Was the failure before write, after write, or unknown?
Is the local pool already saturated?
Is circuit breaker open?
Is Retry-After present?
Is remote rate-limiting us?
```

If failure is `LOCAL_POOL_TIMEOUT`, retrying immediately through the same saturated pool is usually wrong.

### 19.2 Retry Budget

Use retry budget:

```text
max retry attempts per operation
max global retry rate
deadline-aware backoff
jitter
```

The pool should not be treated as infinite retry capacity.

---

## 20. Interaction with Circuit Breaker and Bulkhead

Pool, bulkhead, rate limiter, and circuit breaker are related but different.

### 20.1 Pool

Manages transport resources.

### 20.2 Bulkhead

Limits concurrent work per dependency or traffic class.

### 20.3 Rate Limiter

Limits request rate over time.

### 20.4 Circuit Breaker

Stops sending attempts when failure rate/latency indicates dependency is unhealthy.

### 20.5 Combined Model

```text
caller
  -> rate limiter
  -> bulkhead/concurrency limit
  -> circuit breaker permission
  -> retry/deadline layer
  -> connection/stream acquisition
  -> remote call
```

Ordering may vary, but the intent is stable:

```text
avoid entering expensive network path when local policy already knows the attempt should not proceed
```

---

## 21. Pooling and Load Balancers

Load balancers also have connection state.

Important LB settings:

```text
idle timeout
connection draining duration
max connection age
backend deregistration delay
HTTP/2 support
TLS termination
keep-alive behavior
```

### 21.1 Idle Timeout Mismatch

If client idle timeout is longer than LB idle timeout, stale connection errors increase.

Suggested direction:

```text
client idle timeout < load balancer idle timeout < server idle timeout
```

This is not universal, but it is a useful starting point.

### 21.2 Draining

During deploy, backend instance may drain.

For HTTP/1.1:

- server may close keep-alive connections;
- LB stops routing new connections;
- existing requests complete.

For HTTP/2/gRPC:

- server/proxy may send GOAWAY;
- existing streams continue;
- new streams should use a different connection.

Client must handle this gracefully.

### 21.3 Long-Lived Connections

Long-lived HTTP/2/gRPC connections can delay traffic redistribution after deploy or autoscaling.

Use:

```text
GOAWAY/draining support
connection max age / TTL where available
client-side LB/resolver strategy
graceful server shutdown
```

---

## 22. Pooling in Kubernetes / Service Mesh Environments

In Kubernetes, a Java service may call:

```text
service-name.namespace.svc.cluster.local
```

The request path may include:

```text
JVM
-> pod network namespace
-> sidecar proxy
-> kube-proxy/eBPF/service routing
-> remote pod or gateway
```

Connection pooling interacts with:

- service DNS;
- ClusterIP routing;
- sidecar connection pools;
- Envoy circuit breakers;
- mTLS between sidecars;
- pod termination/draining;
- readiness changes;
- endpoint updates.

### 22.1 Double Pooling

If your Java client pools connections to local sidecar, and sidecar pools upstream connections, there are two layers of pooling.

```text
Java app -> local sidecar pool -> upstream sidecar/backend pool
```

Retries may also exist at both layers.

This can create:

- retry multiplication;
- hidden queueing in sidecar;
- misleading app metrics;
- uneven backend distribution;
- timeout mismatch.

### 22.2 Practical Rule

In service mesh environments, document:

```text
where connection pooling happens
where retries happen
where circuit breaking happens
where TLS terminates
where deadlines are enforced
where metrics are emitted
```

If you cannot answer this, you cannot reliably debug production latency.

---

## 23. Pooling and Virtual Threads

Virtual threads change Java concurrency economics, but not network physics.

With platform threads, you might have been forced to cap concurrency because threads were expensive.

With virtual threads, it becomes easy to start many blocking calls:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request r : requests) {
        executor.submit(() -> client.send(toHttpRequest(r), BodyHandlers.ofString()));
    }
}
```

This code is readable, but unsafe without a concurrency boundary.

You still need:

```text
max outbound concurrency per dependency
pool acquisition limit or semaphore
operation deadlines
retry budget
body size limit
remote rate limit
```

Virtual threads solve “thread-per-blocking-call is too expensive.”

They do not solve:

```text
remote service has finite capacity
connection pool has finite capacity
memory is finite
bandwidth is finite
timeouts still matter
retry can still amplify load
```

Use virtual threads to simplify code, but keep bulkheads.

---

## 24. Pooling for Large Payloads

Large payloads change pool behavior.

A 500 MB download over one connection may occupy the connection for a long time.

If the same pool handles small latency-sensitive calls, large transfers can starve them.

Use separate clients/pools for:

```text
small control-plane calls
large upload/download
streaming calls
background synchronization
```

For large payloads:

- use streaming body handlers;
- avoid full buffering;
- use bounded temp files;
- enforce max body size;
- apply read deadlines;
- handle cancellation;
- compute checksum while streaming;
- close body on failure;
- do not log payload.

---

## 25. Pooling for Multi-Tenant / Case-Management Systems

In regulatory/case-management platforms, outbound calls are often not equal.

Examples:

```text
identity provider
payment gateway
document repository
notification service
audit service
external government API
address lookup API
screening engine
report generation service
```

Each has different semantics:

| Dependency | Traffic Shape | Suggested Pool Policy |
|---|---|---|
| Identity provider | bursty login, user-facing | low latency, strict timeout, small retry |
| Document repository | large upload/download | separate streaming pool, larger deadline |
| Audit service | high frequency, critical | bounded, maybe async buffer/outbox |
| Address lookup | user-facing, rate-limited | small pool + rate limiter + cache |
| Screening engine | heavier backend call | bulkhead + longer deadline |
| Report service | long-running | async job, not synchronous pool pressure |

Do not let a slow report download consume the same pool needed for login validation.

---

## 26. Design Pattern: Dependency Client Capsule

A mature Java system encapsulates each remote dependency behind a client capsule.

```text
Domain service
  -> DependencyClient interface
      -> generated/raw HTTP/gRPC client
      -> timeout/deadline policy
      -> pool/channel policy
      -> retry policy
      -> idempotency policy
      -> metrics/tracing/logging
      -> error mapping
```

Example structure:

```text
com.example.integration.agency
  AgencyClient.java
  AgencyClientConfig.java
  AgencyHttpClient.java
  AgencyErrorMapper.java
  AgencyMetrics.java
  AgencyRetryPolicy.java
  AgencyClientException.java
```

Benefits:

- one place to configure resource limits;
- consistent error classification;
- testable failure behavior;
- no random `HttpClient.newHttpClient()` across codebase;
- no duplicated timeout/retry logic;
- easier incident diagnosis.

---

## 27. Production-Grade HTTP Client Wrapper: Conceptual Blueprint

A strong wrapper has this flow:

```text
validate request
-> compute operation deadline
-> acquire bulkhead permit
-> build HTTP request
-> inject correlation/trace/idempotency headers
-> perform attempt with request timeout
-> classify response/failure
-> maybe retry if allowed and deadline remains
-> consume/close body safely
-> emit metrics/traces/logs
-> release permit
```

Pseudo-code:

```java
public final class ResilientHttpClient {
    private final HttpClient client;
    private final Semaphore bulkhead;
    private final Clock clock;

    public <T> T execute(RemoteOperation<T> operation) throws Exception {
        Instant deadline = clock.instant().plus(operation.deadline());

        if (!bulkhead.tryAcquire(operation.poolWait().toMillis(), TimeUnit.MILLISECONDS)) {
            throw new LocalSaturationException(operation.name());
        }

        try {
            int attempt = 0;
            Throwable lastFailure = null;

            while (clock.instant().isBefore(deadline)) {
                attempt++;
                Duration remaining = Duration.between(clock.instant(), deadline);
                if (remaining.isNegative() || remaining.isZero()) {
                    break;
                }

                HttpRequest request = operation.toRequest(remaining);
                long startNanos = System.nanoTime();
                try {
                    HttpResponse<byte[]> response = client.send(
                        request,
                        HttpResponse.BodyHandlers.ofByteArray()
                    );

                    RemoteResult<T> result = operation.map(response);
                    recordSuccess(operation.name(), attempt, startNanos, response.statusCode());
                    return result.value();
                } catch (Exception e) {
                    lastFailure = e;
                    FailureKind kind = classify(e);
                    recordFailure(operation.name(), attempt, kind, startNanos);

                    if (!operation.retryPolicy().mayRetry(kind, attempt, deadline)) {
                        throw e;
                    }

                    Thread.sleep(operation.retryPolicy().backoff(attempt, deadline).toMillis());
                }
            }

            throw new DeadlineExceededException(operation.name(), lastFailure);
        } finally {
            bulkhead.release();
        }
    }
}
```

This is simplified, but the shape is important.

The pool is not hidden. It is part of the operation contract.

---

## 28. Production Failure Catalogue

### 28.1 Pool Exhausted Because Response Body Not Closed

Symptoms:

```text
active/leased connections high
idle zero
pending acquisition rising
remote service looks healthy
thread dumps show callers waiting for connection
```

Root cause:

```text
error path throws before closing response body
```

Fix:

```text
try-with-resources
bounded error body read
integration test for error path
pool metrics alert
```

### 28.2 LB Idle Timeout Shorter Than Client Idle Timeout

Symptoms:

```text
first request after idle fails with connection reset / EOF
retry often succeeds
errors correlate with low traffic periods
```

Root cause:

```text
client reuses socket already closed by LB
```

Fix:

```text
client idle eviction shorter than LB idle timeout
stale check if available
safe retry for idempotent operations
```

### 28.3 Pool Too Large, Remote Overloaded

Symptoms:

```text
local pool fine
remote p99 latency high
remote CPU/thread pool saturated
more retries
more 503/504
```

Root cause:

```text
client concurrency exceeds remote capacity
```

Fix:

```text
reduce max concurrency
add rate limiter
add circuit breaker
coordinate capacity contract with remote owner
```

### 28.4 Pool Too Small, Local Queueing

Symptoms:

```text
pending acquisition latency high
remote latency normal
caller timeout before request sent
```

Root cause:

```text
pool cannot support normal required concurrency
```

Fix:

```text
increase pool if remote capacity allows
reduce per-request latency
split pools
cache
batch where semantically safe
```

### 28.5 HTTP/2 Stream Limit Hidden Queue

Symptoms:

```text
gRPC calls queued client-side
few physical connections
high active stream count
long-lived streams present
unary calls p99 high
```

Root cause:

```text
single HTTP/2 connection stream capacity saturated
```

Fix:

```text
separate channels for streaming/unary
client-side load balancing
multiple channels only if justified
server max concurrent streams tuning
```

### 28.6 DNS Failover Ignored Due to Long-Lived Connections

Symptoms:

```text
DNS changed
client still sends traffic to old IP/path
restarts fix issue
```

Root cause:

```text
existing pooled connections survive DNS change
```

Fix:

```text
connection TTL
pool eviction on resolver event if possible
shorter max connection age
graceful drain strategy
```

### 28.7 Connection Churn and TLS CPU Spike

Symptoms:

```text
high connection creation rate
high TLS handshakes
CPU spike
latency increase
many TIME_WAIT sockets
```

Root cause:

```text
pool not reused, idle timeout too short, client recreated per request, server closes aggressively
```

Fix:

```text
reuse client
increase idle lifetime carefully
align server/client keepalive
avoid client-per-call
```

### 28.8 Shared Pool Causes Cross-Dependency Outage

Symptoms:

```text
Dependency A slow
Dependency B calls fail locally
pool pending high globally
```

Root cause:

```text
one global pool shared by unrelated dependencies
```

Fix:

```text
per-dependency pools/bulkheads
priority isolation
separate timeout/retry policies
```

---

## 29. Diagnostic Playbook

When an outbound dependency is slow/failing, ask in order.

### 29.1 Is the Request Leaving the JVM?

Check:

```text
pool acquisition latency
pending acquisition count
local saturation errors
thread dump waiting points
```

If it never leaves, do not blame the remote yet.

### 29.2 Is the Client Creating or Reusing Connections?

Check:

```text
connection creation rate
TLS handshake count
idle vs active pool stats
TIME_WAIT count
```

### 29.3 Are Connections Stale?

Check:

```text
resets after idle
EOF on first read
LB idle timeout
client idle timeout
server keepalive timeout
```

### 29.4 Is DNS/Topology Stale?

Check:

```text
resolved IPs
actual remote IPs connected
connection age
deployment/draining event
DNS TTL
JVM DNS cache
```

### 29.5 Is HTTP/2/gRPC Stream Capacity Saturated?

Check:

```text
active streams
queued RPCs
long-lived streams
GOAWAY/RST_STREAM
max concurrent streams
channel state
```

### 29.6 Is Retry Amplifying Load?

Check:

```text
attempts per operation
retry rate
retry reason
retry after pool timeout
deadline remaining at retry
```

### 29.7 Is the Response Body Leaking?

Check:

```text
leased connections never return
heap/direct memory growth
CLOSE_WAIT
error path code review
```

---

## 30. Configuration Checklist

For every outbound dependency, define:

```text
Dependency name
Protocol: HTTP/1.1, HTTP/2, gRPC
Client library
Base endpoint / resolver strategy
Max concurrent operations
Max connections or stream capacity
Pool acquisition timeout
Connect timeout
TLS handshake expectation
Request/response timeout
Overall deadline
Idle timeout
Connection TTL / max age
Retry policy
Idempotency policy
Rate limit
Circuit breaker policy
Metrics names
Trace attributes
Log fields
Error classification
Large payload policy
Shutdown/draining behavior
```

If this information is not documented, the system is not production-ready.

---

## 31. Code Review Checklist

Ask these questions in code review:

1. Is a new client/channel created per request?
2. Is the client shared across unrelated dependencies?
3. Is there a per-dependency concurrency limit?
4. Is pool acquisition bounded?
5. Are connect/request/deadline timeouts explicit?
6. Are response bodies always consumed or closed?
7. Is error body reading bounded?
8. Is retry aware of idempotency and remaining deadline?
9. Are local saturation errors classified separately?
10. Are large uploads/downloads isolated from small calls?
11. Does HTTP/2/gRPC traffic have stream capacity visibility?
12. Are metrics emitted for active/idle/pending pool state?
13. Is shutdown graceful?
14. Is DNS/LB idle timeout interaction considered?
15. Are virtual threads guarded by a bulkhead?

---

## 32. Testing Pool Behavior

You cannot trust pool behavior if you only test happy-path HTTP 200.

Test:

### 32.1 Pool Exhaustion

Create a fake server that delays responses. Send more concurrent requests than pool size.

Assert:

```text
some calls fail with local pool timeout
not all caller threads hang
metrics show pending acquisition
```

### 32.2 Body Leak

Create a server returning error with a body. Ensure error paths close/consume body.

Assert:

```text
pool active count returns to zero
subsequent requests still succeed
```

### 32.3 Stale Connection

Simulate server closing idle connections.

Assert:

```text
client handles stale connection
safe request may retry once
non-idempotent request does not blindly retry
```

### 32.4 Slow Body

Server sends headers quickly but body slowly.

Assert:

```text
body read timeout/deadline works
connection released/closed correctly
```

### 32.5 DNS / Endpoint Rotation

In integration environment, change endpoint target or use a fake resolver.

Assert:

```text
connection TTL eventually moves traffic
old endpoint drains
```

### 32.6 gRPC Stream Saturation

Run long-lived streaming RPCs and unary RPCs through same channel.

Assert:

```text
unary p99 does not collapse
or separate channel/policy is introduced
```

---

## 33. Practical Defaults: Starting Points, Not Universal Truth

These are not magic values. They are starting points.

For user-facing internal HTTP calls:

```text
connect timeout: 100–500 ms depending on network
pool acquisition timeout: 50–200 ms
operation deadline: 300 ms–2 s depending on UX/SLA
max per dependency: based on throughput * latency and remote capacity
idle timeout: shorter than LB idle timeout
connection TTL: minutes, if topology changes matter
retry: 0–2 attempts, only when safe, jittered, deadline-aware
```

For external government/partner APIs:

```text
small pool
strict rate limiter
longer deadline if API is slow
very careful retry
idempotency key for mutations
cache safe lookups
audit request/response metadata, not sensitive body
```

For large file transfer:

```text
separate pool
streaming body
longer deadline
max body size
checksum
resume support where possible
no shared low-latency pool
```

For gRPC unary high-throughput internal calls:

```text
reuse channel
deadline every RPC
observe active/queued streams
client-side LB if needed
separate long-lived streaming traffic
```

---

## 34. Top 1% Mental Model

The average engineer says:

```text
We need more max connections.
```

The stronger engineer asks:

```text
Which dependency?
Which traffic class?
What is the current active/idle/pending state?
Is the queue local or remote?
Is body consumption leaking leases?
Is remote capacity known?
Is retry multiplying pressure?
Is HTTP/2 stream capacity saturated?
Are long-lived connections pinning traffic?
Are idle timeout and LB timeout aligned?
Do we need higher concurrency, lower latency, lower retry, or better isolation?
```

The top-tier engineer designs this up front:

```text
per-dependency client capsule
bounded concurrency
bounded acquisition wait
explicit deadlines
safe retry
separate large/streaming traffic
clear error taxonomy
pool metrics
trace correlation
failure tests
shutdown/draining behavior
```

Connection pooling is not a tuning detail.

It is one of the core control surfaces of distributed system reliability.

---

## 35. Summary

Key takeaways:

1. A pool is a stateful resource boundary, not merely a performance cache.
2. HTTP/1.1 pool sizing is connection-oriented; HTTP/2/gRPC sizing is stream-capacity-oriented.
3. Pool acquisition timeout is as important as connect and read timeout.
4. Response bodies must be consumed, discarded, or closed to release resources.
5. Idle timeout, keep-alive, TCP keepalive, gRPC keepalive, and connection TTL are different concepts.
6. DNS changes affect new connections, not existing pooled connections.
7. Shared pools create cross-dependency failure coupling.
8. Retry multiplies pool pressure and must be deadline/idempotency aware.
9. Virtual threads simplify blocking code but do not remove resource limits.
10. Production readiness requires metrics for active, idle, pending, creation, eviction, timeout, and error classification.

---

## 36. Exercises

### Exercise 1 — Pool Sizing from Throughput

Given:

```text
outbound rate: 300 req/s
normal p95 latency: 80 ms
incident p95 latency: 400 ms
remote safe concurrency: 100
```

Calculate:

1. normal required concurrency;
2. incident required concurrency;
3. reasonable max concurrency;
4. acquisition timeout strategy;
5. retry risk.

### Exercise 2 — Diagnose Pool Exhaustion

You see:

```text
active connections: 50/50
idle connections: 0
pending acquisition: 400
remote API p50: 90 ms
local p99: 5 s
CLOSE_WAIT increasing
```

Explain likely root causes and investigation order.

### Exercise 3 — HTTP/2 Stream Starvation

A gRPC channel handles:

```text
80 long-lived streams
200 unary req/s
server max concurrent streams: 100
```

Explain why unary calls may queue and propose a redesign.

### Exercise 4 — LB Idle Timeout

Given:

```text
client idle keepalive: 300 s
load balancer idle timeout: 60 s
server keepalive timeout: 120 s
```

Predict the failure pattern and propose safer values.

### Exercise 5 — Design a Dependency Client Capsule

Design a Java client capsule for an external address lookup API with:

```text
rate limit: 300 req/min
user-facing latency target: 1 s
safe GET lookup by postal code
cacheable response
occasional 429
```

Include:

- pool limit;
- rate limiter;
- timeout;
- retry;
- idempotency/caching;
- metrics;
- error classification.

---

## 37. References

- Oracle Java SE 25 `java.net.http.HttpClient` API documentation.
- Apache HttpClient 5.x connection management documentation.
- OkHttp connection pool and dispatcher documentation.
- gRPC performance best practices and keepalive documentation.
- RFC 9110 HTTP Semantics.
- RFC 9112 HTTP/1.1.
- RFC 9113 HTTP/2.
- Google SRE and AWS Builders Library materials on overload, timeout, retry, and backoff.

---

## 38. Series Status

```text
Part 15 of 35 complete.
Series is not finished yet.
Next: Part 16 — TLS, mTLS, Certificates, Trust Stores, Key Stores, ALPN, and Java Security Runtime
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 14 — Retry, Idempotency, Backoff, Jitter, Hedging, and Duplicate Suppression](./014-retry-idempotency-backoff-jitter-hedging-duplicate-suppression.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 16 — TLS, mTLS, Certificates, Trust Stores, Key Stores, ALPN, and Java Security Runtime](./016-tls-mtls-certificates-truststores-keystores-alpn-java-security-runtime.md)
