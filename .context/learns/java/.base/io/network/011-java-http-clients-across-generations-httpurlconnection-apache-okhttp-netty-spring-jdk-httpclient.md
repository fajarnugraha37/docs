# Part 11 — Java HTTP Clients Across Generations: `HttpURLConnection`, Apache HttpClient, OkHttp, Netty, Spring, and JDK `HttpClient`

Series: `learn-java-io-network-http-grpc-protocol-engineering`  
File: `011-java-http-clients-across-generations-httpurlconnection-apache-okhttp-netty-spring-jdk-httpclient.md`  
Scope: Java 8–25  
Status: Part 11 of 35

---

## 0. Why This Part Exists

Most Java engineers learn HTTP clients in this order:

1. call an endpoint,
2. deserialize JSON,
3. set a timeout,
4. maybe add retry,
5. move on.

That is enough for toy systems, internal scripts, and low-risk integration.

It is not enough for production systems where HTTP calls sit on critical request paths, depend on load balancers, run under TLS, reuse connections, queue inside pools, cross proxies, receive partial responses, suffer slow downstreams, and participate in cascading failures.

A top-tier engineer does not ask only:

> “Which HTTP client should I use?”

They ask:

> “What execution model, pooling model, protocol model, timeout model, TLS model, observability model, and failure model does this client impose on the system?”

This part is a comparative deep dive across generations of Java HTTP clients:

- `HttpURLConnection`
- Apache HttpClient 4.x / 5.x
- OkHttp
- Netty
- Reactor Netty / Spring WebClient
- Spring `RestTemplate` / new Spring clients conceptually
- JDK `java.net.http.HttpClient`
- gRPC Java client as an HTTP/2-specialized cousin

The goal is not to memorize API syntax. The goal is to become fluent in choosing, configuring, debugging, and migrating HTTP clients under real production constraints.

---

## 1. The Core Mental Model

Every HTTP client is not just a function that sends a request.

It is a runtime subsystem.

```text
Application code
  -> client abstraction / SDK
  -> request builder
  -> serializer
  -> interceptor/filter pipeline
  -> timeout/deadline policy
  -> retry/circuit/rate-limit layer
  -> connection acquisition
  -> DNS resolution
  -> proxy selection
  -> TCP connect
  -> TLS handshake
  -> protocol negotiation via ALPN
  -> HTTP/1.1 or HTTP/2 encoding
  -> request body streaming
  -> response header parsing
  -> response body consumption
  -> connection reuse or close
  -> metric/log/trace emission
  -> exception mapping
  -> domain result
```

Different clients expose and hide different pieces of that path.

That hiding is not always bad. A good abstraction reduces unnecessary complexity. But if the abstraction hides a resource queue, a multiplexed stream limit, an unbounded async executor, a missing read timeout, or a non-replayable request body, it can become dangerous.

A mature engineer asks five questions before selecting a client:

1. **Protocol:** Does it support the protocol versions I need: HTTP/1.1, HTTP/2, cleartext h2c, TLS ALPN, WebSocket?
2. **Concurrency:** Is it blocking, async, reactive, event-loop based, or virtual-thread-friendly?
3. **Pooling:** How does it reuse TCP/TLS connections, and where can requests queue?
4. **Failure:** How do timeout, cancellation, retry, body replay, and connection close work?
5. **Operations:** Can I observe pool saturation, DNS/TLS/connect latency, p95/p99 latency, errors, and payload size safely?

---

## 2. Historical Map of Java HTTP Clients

A simplified timeline:

```text
Java 1.1+
  java.net.URL / URLConnection / HttpURLConnection

Java ecosystem era
  Apache Commons HttpClient 3.x
  Apache HttpComponents HttpClient 4.x
  OkHttp
  AsyncHttpClient
  Netty-based custom clients

Java 8 era
  HttpURLConnection still built-in
  Apache HttpClient 4.x dominant in enterprise
  OkHttp popular especially Android and modern JVM apps
  Netty dominant for high-performance frameworks
  Spring RestTemplate widely used

Java 9/10 incubator era
  incubating JDK HTTP Client

Java 11+
  java.net.http.HttpClient standardized
  HTTP/1.1 and HTTP/2 support built into JDK
  CompletableFuture async model
  WebSocket API included

Java 17/21/25 era
  JDK HttpClient is a strong default for many use cases
  virtual threads change blocking-client ergonomics
  reactive clients still matter for streaming/backpressure/event-loop systems
  Apache HttpClient 5.x improves modern transport options
  Netty/Reactor Netty remain important in frameworks and high-control systems
```

The important point is not “newer is always better”. The important point is that each client emerged from a different design era:

| Client | Era | Design Center |
|---|---:|---|
| `HttpURLConnection` | early JDK | basic blocking HTTP built into Java |
| Apache HttpClient 4.x | enterprise Java | configurable HTTP/1.1, pooling, proxy/TLS/auth |
| Apache HttpClient 5.x | modernized Apache stack | redesigned APIs, classic/async/reactive-ish transport, HTTP/2 async support |
| OkHttp | modern client/mobile | simple API, efficient pooling, HTTP/2, interceptors |
| Netty | framework/runtime | event-driven networking, protocol control |
| Reactor Netty | reactive framework | Netty + Reactive Streams + Spring WebFlux ecosystem |
| Spring RestTemplate | application framework | synchronous template abstraction |
| JDK `HttpClient` | modern JDK | built-in immutable client, HTTP/1.1/2, sync/async, WebSocket |

---

## 3. Selection Criteria That Actually Matter

Do not select an HTTP client by popularity alone.

Use this decision surface.

### 3.1 Runtime Compatibility

Ask:

- Are we on Java 8, 11, 17, 21, or 25?
- Can we add third-party dependencies?
- Are we in a regulated environment where dependencies require review?
- Do we need Android support?
- Do we need GraalVM native image support?
- Do we need FIPS/security-provider constraints?

For Java 8, the JDK `java.net.http.HttpClient` is not available. You typically use Apache HttpClient, OkHttp, Netty, Spring abstractions, or legacy `HttpURLConnection`.

For Java 11+, JDK `HttpClient` becomes a serious default.

For Java 21–25, virtual threads make blocking-style clients more ergonomic, but they do not remove network resource constraints.

### 3.2 Protocol Support

Ask:

- HTTP/1.1 only?
- HTTP/2 required?
- h2c required inside private networks?
- WebSocket required?
- Proxy tunneling required?
- mTLS required?
- ALPN required?
- Custom protocol over TCP?

HTTP/2 support is not just a checkbox. You must ask:

- Is HTTP/2 supported over TLS only or also h2c?
- Is it automatic or explicit?
- Can I configure max concurrent streams?
- Can I observe stream resets?
- Can I tune flow control?
- Can I isolate large and small calls?

### 3.3 Execution Model

HTTP clients commonly fall into five execution styles:

```text
Blocking synchronous
  caller thread writes request and waits for response

Blocking with thread pool
  caller delegates to worker thread or executor

Future/promise async
  request returns CompletableFuture / callback

Event-loop async
  request is driven by small number of event-loop threads

Reactive streams
  request/response body supports demand/backpressure protocol
```

None is universally best.

Blocking is often easiest to reason about.
Async can scale well but complicates cancellation/context/error handling.
Reactive is strong for streaming and backpressure, but can be overkill for CRUD-style service calls.
Event-loop systems are efficient but fragile if application code blocks on event-loop threads.
Virtual threads improve blocking ergonomics but still need connection budgets, deadlines, and backpressure.

### 3.4 Pooling Model

Most production HTTP client incidents involve pooling in some form.

Questions:

- Is there a connection pool?
- Is it per-client, global, per-host, per-route, or hidden?
- What is the max connection count?
- Is there a pending acquisition queue?
- Is that queue bounded?
- What is the acquisition timeout?
- Are idle connections evicted?
- Is there connection TTL?
- Are stale connections detected?
- Does HTTP/2 multiplex many requests over one TCP connection?
- Can a slow response body block reuse?

The pool is not just an optimization. It is a concurrency control surface.

### 3.5 Timeout Model

At minimum you need to distinguish:

```text
DNS resolution timeout
TCP connect timeout
TLS handshake timeout
connection pool acquisition timeout
request write timeout
response header timeout
response body read timeout
overall request timeout
business deadline
retry budget deadline
```

Some clients expose all of these. Some expose only a few. Some require wrappers to enforce an overall deadline.

A top-tier engineer treats missing timeout semantics as a design risk, not an implementation detail.

### 3.6 Body Streaming Model

Ask:

- Is request body buffered or streamed?
- Is response body buffered or streamed?
- What happens if caller does not consume/close the body?
- Is retry possible if request body was already partially sent?
- Is backpressure supported?
- Is large upload/download memory-safe?
- Can body processing be cancelled?

A client that works perfectly for 10 KB JSON can fail catastrophically for 500 MB export files.

### 3.7 Observability Model

Ask:

- Can I emit metrics per dependency?
- Can I separate connect/TLS/request/response latency?
- Can I monitor pool active/idle/pending?
- Can I trace outbound calls?
- Can I propagate correlation id and trace context?
- Can I log request/response metadata without leaking secrets or PII?
- Can I identify retries separately from original attempts?

If the client cannot be observed, it will eventually become an incident blind spot.

---

## 4. `HttpURLConnection`: The Legacy Built-In Client

### 4.1 What It Is

`HttpURLConnection` is the old built-in JDK HTTP client.

Typical code:

```java
URL url = new URL("https://api.example.com/v1/items");
HttpURLConnection conn = (HttpURLConnection) url.openConnection();
conn.setRequestMethod("GET");
conn.setConnectTimeout(2_000);
conn.setReadTimeout(5_000);

int status = conn.getResponseCode();
try (InputStream in = status < 400 ? conn.getInputStream() : conn.getErrorStream()) {
    byte[] bytes = in.readAllBytes();
}
```

### 4.2 Strengths

- Available in all Java versions.
- No dependency.
- Good enough for simple scripts or very constrained environments.
- Blocking model is easy to understand.

### 4.3 Weaknesses

- Awkward API.
- Limited modern protocol ergonomics.
- Poor composability.
- Harder to instrument cleanly.
- Connection reuse behavior is implicit and easy to misuse.
- Error-stream handling is clumsy.
- Timeout model is limited.
- Not ideal for modern high-volume clients.

### 4.4 Production Risks

#### Risk 1 — Not closing response streams

If response streams are not fully consumed or closed, connection reuse can break and resource leaks can accumulate.

Bad:

```java
HttpURLConnection conn = (HttpURLConnection) url.openConnection();
int status = conn.getResponseCode();
if (status == 200) {
    return true;
}
// response/error stream ignored
```

Better:

```java
HttpURLConnection conn = (HttpURLConnection) url.openConnection();
conn.setConnectTimeout(2_000);
conn.setReadTimeout(5_000);

int status = conn.getResponseCode();
InputStream stream = status < 400 ? conn.getInputStream() : conn.getErrorStream();
if (stream != null) {
    try (InputStream in = stream) {
        while (in.read() != -1) {
            // drain or parse safely
        }
    }
}
```

#### Risk 2 — Treating read timeout as full request timeout

`setReadTimeout` is not the same as an overall deadline. A response that sends one byte periodically may avoid a read timeout while still exceeding business SLA.

#### Risk 3 — Hard-to-standardize behavior

In large systems, hundreds of ad-hoc `HttpURLConnection` usages create inconsistent timeout, headers, TLS, proxy, logging, and retry behavior.

### 4.5 When To Use

Use only when:

- dependency-free code is required,
- volume is low,
- behavior is simple,
- you wrap it behind a controlled abstraction,
- modern HTTP/2 is not required.

Avoid for core service-to-service communication in serious systems unless constraints force it.

---

## 5. Apache HttpClient 4.x / 5.x

### 5.1 Why Apache HttpClient Became Common

Apache HttpClient became widely used because it gave Java applications much more explicit control over:

- connection pooling,
- routes,
- proxy,
- authentication,
- TLS,
- cookies,
- interceptors,
- request configuration,
- retry handlers,
- keep-alive strategy.

It fit enterprise Java well.

### 5.2 Apache HttpClient 4.x Mental Model

Classic Apache HttpClient is typically blocking and pool-based.

```text
CloseableHttpClient
  -> PoolingHttpClientConnectionManager
  -> per-route connection limits
  -> request config
  -> execute(request)
  -> CloseableHttpResponse
  -> consume/close entity
  -> connection returned to pool
```

Example:

```java
PoolingHttpClientConnectionManager cm = new PoolingHttpClientConnectionManager();
cm.setMaxTotal(200);
cm.setDefaultMaxPerRoute(50);

RequestConfig requestConfig = RequestConfig.custom()
        .setConnectTimeout(Timeout.ofSeconds(2))
        .setResponseTimeout(Timeout.ofSeconds(5))
        .setConnectionRequestTimeout(Timeout.ofSeconds(1))
        .build();

try (CloseableHttpClient client = HttpClients.custom()
        .setConnectionManager(cm)
        .setDefaultRequestConfig(requestConfig)
        .build()) {

    HttpGet get = new HttpGet("https://api.example.com/v1/items");
    try (CloseableHttpResponse response = client.execute(get)) {
        int status = response.getCode();
        String body = EntityUtils.toString(response.getEntity());
    }
}
```

Conceptually, there are three critical timeouts:

```text
connection request timeout
  time waiting to get a connection from the pool

connect timeout
  time to establish TCP connection

response/read timeout
  time waiting for server response/read progress
```

### 5.3 Why Connection Request Timeout Matters

This is one of the biggest differences between amateur and senior HTTP client configuration.

If all connections are busy, a new request does not immediately connect to remote server. It waits in a local pool queue.

```text
caller thread
  -> waits for pool lease
  -> only after lease, maybe connects/sends request
```

If you do not bound pool acquisition time, your application can pile up threads waiting for connections even when the remote dependency is already saturated.

This causes:

- thread exhaustion,
- request latency amplification,
- upstream timeout,
- retry storm,
- health-check failure,
- full service outage.

### 5.4 Apache HttpClient 5.x

Apache HttpClient 5.x is a modernized generation with separate classic and async APIs. It improves API design and introduces stronger modern transport options. A crucial distinction: classic blocking APIs are not the same as async HTTP/2-focused APIs.

Mental model:

```text
Classic HttpClient
  blocking request/response style
  natural fit for HTTP/1.1 and synchronous systems

Async HttpClient
  non-blocking/event-driven style
  supports HTTP/2-specific use cases
```

This matters during migration. Moving from 4.x classic to 5.x classic does not automatically mean you have adopted an HTTP/2 multiplexed architecture.

### 5.5 Strengths

- Mature enterprise feature set.
- Explicit connection pool configuration.
- Strong proxy/auth/TLS support.
- Good for Java 8+ environments.
- Strong fit for synchronous service-to-service calls.
- Large ecosystem knowledge base.

### 5.6 Weaknesses

- More configuration surface.
- API changes between 4.x and 5.x require careful migration.
- Misconfiguration is common.
- Classic blocking model needs thread budgeting unless paired with virtual threads carefully.
- HTTP/2 story depends on which API/transport path you choose.

### 5.7 Production Rules

1. Always configure max total and per-route limits.
2. Always configure pool acquisition timeout.
3. Always consume or close response entity.
4. Always define idle eviction and connection TTL strategy.
5. Always instrument pool metrics.
6. Never create a new client per request.
7. Use one configured client per dependency class or per outbound policy group.

### 5.8 When To Use

Use Apache HttpClient when:

- Java 8 compatibility matters,
- enterprise proxy/auth/TLS features matter,
- you need explicit pool management,
- blocking service-to-service calls are acceptable,
- you want mature behavior under controlled configuration.

---

## 6. OkHttp

### 6.1 What It Is

OkHttp is a modern HTTP client from Square. It is popular because it combines a clean API with serious transport behavior:

- connection pooling,
- transparent HTTP/2 multiplexing,
- interceptors,
- TLS support,
- WebSocket support,
- simple synchronous and asynchronous APIs.

### 6.2 Mental Model

```text
OkHttpClient
  -> immutable-ish configured client
  -> dispatcher controls async concurrency
  -> connection pool reuses HTTP/1.x connections
  -> HTTP/2 multiplexes streams over shared connection
  -> interceptors wrap request/response chain
  -> Response body must be closed
```

Example:

```java
OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(Duration.ofSeconds(2))
        .readTimeout(Duration.ofSeconds(5))
        .writeTimeout(Duration.ofSeconds(5))
        .callTimeout(Duration.ofSeconds(8))
        .build();

Request request = new Request.Builder()
        .url("https://api.example.com/v1/items")
        .get()
        .build();

try (Response response = client.newCall(request).execute()) {
    if (!response.isSuccessful()) {
        throw new IOException("Unexpected status " + response.code());
    }
    String body = response.body().string();
}
```

The `callTimeout` concept is especially valuable: it approximates an overall limit for the full call lifecycle.

### 6.3 Interceptors

OkHttp popularized a very ergonomic interceptor model.

Common uses:

- add headers,
- add correlation id,
- add auth token,
- log metadata,
- collect metrics,
- rewrite request,
- map response,
- implement retry with caution.

Example conceptual interceptor:

```java
class CorrelationInterceptor implements Interceptor {
    @Override
    public Response intercept(Chain chain) throws IOException {
        Request original = chain.request();
        String cid = Correlation.currentOrNew();
        Request next = original.newBuilder()
                .header("X-Correlation-Id", cid)
                .build();
        return chain.proceed(next);
    }
}
```

### 6.4 Strengths

- Clean API.
- Excellent default ergonomics.
- HTTP/2 support.
- Good connection pooling.
- Good timeout model including call timeout.
- Interceptor model is easy to standardize.
- Strong Android/JVM usage history.

### 6.5 Weaknesses

- Less enterprise-style configurability than Apache in some areas.
- Pool and dispatcher behavior still need understanding.
- HTTP/2 multiplexing can create hidden coupling between streams on a shared connection.
- Large streaming responses must be handled carefully.
- In non-Android enterprise Java, teams may prefer Apache/JDK/Spring ecosystem defaults.

### 6.6 Production Rules

1. Reuse `OkHttpClient`; do not create per request.
2. Always close `Response`.
3. Set `callTimeout` for full-call protection.
4. Configure dispatcher limits for async use.
5. Be careful with interceptors that buffer bodies.
6. Do not log full payloads by default.
7. Treat HTTP/2 shared connection as a shared bottleneck.

### 6.7 When To Use

Use OkHttp when:

- you want a clean modern client,
- Java 8 compatibility matters,
- HTTP/2 support matters,
- interceptors are useful,
- Android compatibility matters,
- you want good defaults but still enough control.

---

## 7. Netty as HTTP Client Foundation

### 7.1 What Netty Is

Netty is not just an HTTP client library. It is an asynchronous event-driven network framework.

It gives you lower-level control over:

- event loops,
- channels,
- pipelines,
- handlers,
- buffers,
- codecs,
- backpressure,
- native transport,
- custom protocols.

HTTP is one thing you can build on it.

gRPC Java’s main transport commonly uses Netty. Reactor Netty builds a higher-level reactive API on top of Netty.

### 7.2 Mental Model

```text
EventLoopGroup
  -> Bootstrap
  -> Channel
  -> ChannelPipeline
  -> HTTP codec / HTTP/2 codec
  -> handlers
  -> ByteBuf lifecycle
  -> Future/Promise callbacks
```

Netty is powerful because it exposes the real network runtime.

Netty is dangerous because it exposes the real network runtime.

### 7.3 Event Loop Rule

The most important Netty rule:

> Never block the event loop.

Bad:

```java
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    database.callBlocking();       // bad
    remoteHttpCallBlocking();      // bad
    Thread.sleep(1000);            // terrible
}
```

Blocking event loop causes:

- delayed reads/writes for many connections,
- timeout storms,
- poor tail latency,
- throughput collapse,
- misleading CPU profile.

### 7.4 ByteBuf Rule

Netty uses `ByteBuf`, often with reference counting.

This means memory management matters.

Failure modes:

- buffer leak,
- double release,
- use after release,
- direct memory exhaustion,
- GC not seeing native/direct pressure clearly enough.

### 7.5 Strengths

- Highest control.
- Strong performance potential.
- Protocol engineering flexibility.
- HTTP/1.1, HTTP/2, WebSocket, custom protocols.
- Event-loop scalability.
- Foundation for many frameworks.

### 7.6 Weaknesses

- Much more complex.
- Requires deep understanding of threading and buffers.
- Easy to misuse.
- Application teams often should not use raw Netty directly unless they need control.
- Observability must be engineered carefully.

### 7.7 When To Use Directly

Use Netty directly when:

- building infrastructure/framework code,
- implementing custom protocols,
- needing fine-grained HTTP/2 behavior,
- building gateway/proxy/high-throughput network service,
- integrating at transport level,
- you have team expertise to operate it.

Do not use raw Netty just because it is “fast”.

Most business applications should use a higher-level client unless direct control is justified.

---

## 8. Reactor Netty and Spring WebClient

### 8.1 What It Is

Reactor Netty combines Netty with Reactor’s reactive programming model. Spring WebClient commonly uses Reactor Netty as its runtime in WebFlux applications.

Mental model:

```text
WebClient
  -> ExchangeFunction
  -> Reactor Netty HttpClient
  -> Netty event loop
  -> Reactive Streams Publisher/Subscriber
  -> backpressure-aware body processing
```

### 8.2 Why It Exists

It is designed for:

- non-blocking I/O,
- reactive request pipelines,
- streaming request/response bodies,
- high concurrency with fewer platform threads,
- composition with reactive systems.

### 8.3 Strengths

- Strong fit for reactive applications.
- Good streaming/backpressure story.
- Integrated with Spring WebFlux.
- Built on Netty’s performance model.
- Flexible filter pipeline.
- Useful for high-concurrency I/O-bound services.

### 8.4 Weaknesses

- Reactive complexity is real.
- Debugging can be harder.
- Context propagation requires discipline.
- Blocking inside reactive pipeline can damage event loop behavior.
- Teams often misuse `.block()` in the wrong place.
- Not always necessary for simple request-response systems, especially with virtual threads.

### 8.5 The `.block()` Trap

Using `.block()` is not inherently evil. Blocking at the application boundary can be acceptable in some architectures.

But blocking on an event-loop thread is harmful.

Bad mental model:

```text
WebClient is always faster.
```

Better mental model:

```text
WebClient is a reactive client. It is powerful when the application preserves non-blocking flow or needs streaming/backpressure. If used as a complicated blocking client, it may add complexity without benefit.
```

### 8.6 When To Use

Use WebClient/Reactor Netty when:

- application is already WebFlux/reactive,
- streaming/backpressure matters,
- high concurrency with non-blocking pipelines matters,
- you need Netty behavior through Spring abstractions,
- team understands reactive failure/cancellation/context models.

Avoid using it purely because RestTemplate is “old” if your system is synchronous and virtual-thread-friendly.

---

## 9. Spring `RestTemplate` and Synchronous Framework Clients

### 9.1 What It Is

`RestTemplate` is a synchronous Spring abstraction over HTTP client implementations. It can use different request factories underneath, such as JDK, Apache, or OkHttp-style integrations depending on configuration/version.

The abstraction is not the transport.

```text
RestTemplate
  -> ClientHttpRequestFactory
  -> underlying HTTP client
  -> actual pooling/timeout/TLS behavior
```

### 9.2 Strengths

- Simple synchronous programming model.
- Fits Spring MVC applications.
- Easy JSON mapping.
- Easy interceptors.
- Familiar to many enterprise teams.

### 9.3 Weaknesses

- Can hide the underlying client behavior.
- Default request factory may not be production-grade enough.
- Timeout and pool settings depend on the underlying factory.
- Less natural for streaming/reactive scenarios.

### 9.4 Production Rule

Never say:

> “We use RestTemplate, so our HTTP behavior is known.”

Say:

> “We use RestTemplate backed by this specific client factory, with these pool limits, these timeouts, this TLS config, and these interceptors.”

### 9.5 When To Use

Use synchronous Spring clients when:

- application is Spring MVC/blocking style,
- calls are normal request-response,
- you configure the underlying transport explicitly,
- you can standardize interceptors and error handling.

---

## 10. JDK `java.net.http.HttpClient`

### 10.1 What It Is

The JDK `HttpClient` is the modern built-in HTTP client standardized in Java 11 and available through `java.net.http`.

It supports:

- HTTP/1.1,
- HTTP/2,
- synchronous send,
- asynchronous send via `CompletableFuture`,
- WebSocket,
- immutable reusable client instances,
- request and response body publishers/handlers.

Example:

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(2))
        .version(HttpClient.Version.HTTP_2)
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://api.example.com/v1/items"))
        .timeout(Duration.ofSeconds(5))
        .header("Accept", "application/json")
        .GET()
        .build();

HttpResponse<String> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofString()
);

if (response.statusCode() >= 400) {
    throw new IllegalStateException("HTTP " + response.statusCode());
}
```

Async:

```java
CompletableFuture<HttpResponse<String>> future = client.sendAsync(
        request,
        HttpResponse.BodyHandlers.ofString()
);

future.thenApply(HttpResponse::body)
      .thenAccept(System.out::println);
```

### 10.2 Mental Model

```text
HttpClient
  immutable shared client
  owns configuration and resources
  sends many requests
  can prefer HTTP/2 but may fall back depending on server/proxy
  request has per-request timeout
  async uses CompletableFuture
  body handling is explicit through BodyPublisher and BodyHandler
```

### 10.3 Strengths

- Built into JDK 11+.
- No dependency.
- Modern API.
- HTTP/2 support.
- Sync and async support.
- Good fit with virtual threads for blocking `send()` usage.
- WebSocket included.
- Reasonable default for many Java 11–25 services.

### 10.4 Weaknesses

- Less feature-rich than Apache for some enterprise needs.
- Pool tuning/observability may be less explicit than dedicated libraries.
- Does not support HTTP/3 in Java 25.
- Some advanced use cases still need wrappers or another client.
- `CompletableFuture` async composition can become hard without discipline.

### 10.5 Timeout Nuance

There are two common timeouts:

```java
HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(2));

HttpRequest.newBuilder()
        .timeout(Duration.ofSeconds(5));
```

The client connect timeout protects connection establishment.
The request timeout protects the request as a whole at the API level.

But in production, you may still need an outer business deadline, especially when retries or multiple downstream calls are involved.

### 10.6 BodyHandlers Matter

`BodyHandlers.ofString()` buffers the body into memory.

Good for small JSON.
Dangerous for large downloads.

For large responses, use file or streaming body handlers.

Example:

```java
HttpResponse<Path> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofFile(Path.of("download.bin"))
);
```

The top-tier mental model:

> Body handler selection is a memory architecture decision.

### 10.7 JDK HttpClient With Virtual Threads

With Java 21+, virtual threads make synchronous code attractive:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<HttpResponse<String>>> futures = urls.stream()
            .map(url -> executor.submit(() -> client.send(
                    HttpRequest.newBuilder(URI.create(url))
                            .timeout(Duration.ofSeconds(5))
                            .GET()
                            .build(),
                    HttpResponse.BodyHandlers.ofString()
            )))
            .toList();
}
```

This can be much simpler than callback chains.

But do not confuse virtual threads with unlimited downstream capacity.

You still need:

- bounded concurrency,
- connection pool awareness,
- rate limits,
- deadlines,
- cancellation,
- memory-safe body handling,
- downstream protection.

Virtual threads make blocking cheaper. They do not make remote systems faster.

### 10.8 When To Use

Use JDK `HttpClient` when:

- Java 11+ is available,
- no extra dependency is preferred,
- HTTP/1.1/HTTP/2 is enough,
- you want simple sync/async API,
- you can wrap it for metrics/retry/error policy,
- you do not need advanced Apache/Netty-specific features.

---

## 11. gRPC Java Client as an HTTP/2-Specialized Cousin

Although gRPC is not a generic HTTP client, it belongs in this comparison because it uses HTTP/2 as transport and solves a different problem: typed RPC with Protobuf, deadlines, metadata, status codes, streaming, and channel management.

Mental model:

```text
ManagedChannel
  -> name resolver
  -> load balancer
  -> HTTP/2 transport, commonly Netty
  -> generated stub
  -> RPC deadline
  -> metadata
  -> status/trailers
```

Use gRPC when:

- both sides can share `.proto` contracts,
- low-latency internal RPC matters,
- streaming RPC matters,
- strict schema evolution matters,
- deadline/cancellation propagation matters,
- HTTP semantics/resource modeling is less important than typed operations.

Use HTTP/REST when:

- broad client compatibility matters,
- browser/public API compatibility matters,
- resource-oriented semantics matter,
- caching/conditional requests matter,
- human inspectability matters.

---

## 12. Comparison Matrix

### 12.1 High-Level Matrix

| Client | Java 8 | Java 11+ | HTTP/2 | Async | Reactive | Pool Control | Best Fit |
|---|---:|---:|---:|---:|---:|---:|---|
| `HttpURLConnection` | Yes | Yes | Limited/legacy-dependent | No | No | Hidden/limited | Simple legacy/no dependency |
| Apache HttpClient 4.x | Yes | Yes | Mostly HTTP/1.1 classic | Some variants | No | Strong | Enterprise blocking HTTP/1.1 |
| Apache HttpClient 5.x | Yes | Yes | Yes in async HTTP/2 path | Yes | Some streaming APIs | Strong | Modern enterprise/custom transport |
| OkHttp | Yes | Yes | Yes | Callback async | No | Moderate | Simple modern JVM/Android HTTP |
| Netty | Yes | Yes | Yes | Yes | Not by itself | Very strong | Framework/protocol/high control |
| Reactor Netty/WebClient | Yes depending versions | Yes | Yes | Yes | Yes | Strong | Reactive Spring/high-concurrency streaming |
| RestTemplate | Yes | Yes | Depends underneath | No | No | Depends underneath | Synchronous Spring apps |
| JDK HttpClient | No | Yes | Yes | CompletableFuture | Flow body APIs | Moderate/less explicit | Modern dependency-free JDK client |
| gRPC Java | Yes | Yes | HTTP/2 based | Yes | Streaming APIs | Channel-based | Typed internal RPC |

### 12.2 Decision Matrix by Scenario

| Scenario | Recommended Direction |
|---|---|
| Java 8 enterprise system, HTTP/1.1, proxy/mTLS | Apache HttpClient |
| Java 17/21 service, simple outbound JSON calls | JDK HttpClient or Apache/OkHttp depending standards |
| Android or shared JVM/mobile library | OkHttp |
| Spring MVC synchronous app | RestTemplate/new synchronous Spring client backed by Apache/JDK, configured explicitly |
| Spring WebFlux reactive app | WebClient/Reactor Netty |
| High-throughput custom gateway | Netty/Reactor Netty |
| Typed internal service-to-service RPC | gRPC Java |
| Dependency-minimal Java 11+ tool | JDK HttpClient |
| Large streaming downloads | JDK streaming BodyHandler, Apache streaming entity, OkHttp ResponseBody stream, or Reactor Netty depending app model |
| Fine HTTP/2 flow-control tuning | Netty/gRPC specialized stack |

---

## 13. The Hidden Cost of “Simple” HTTP Calls

A one-line client call can hide many queues:

```text
incoming request queue
  -> servlet/worker/virtual thread scheduling
  -> application semaphore
  -> HTTP client pool pending queue
  -> DNS resolver queue
  -> TCP SYN backlog / connect wait
  -> TLS handshake
  -> remote load balancer queue
  -> remote server accept queue
  -> remote worker queue
  -> remote DB pool queue
```

When latency rises, most teams only see:

```text
java.net.SocketTimeoutException: Read timed out
```

A top-tier engineer asks:

- Did we wait before even sending request?
- Did we connect slowly?
- Did TLS handshake stall?
- Did the request body upload slowly?
- Did the remote server accept but not respond?
- Did we receive headers but stall on body?
- Did we exhaust local pool?
- Did HTTP/2 stream limit queue us locally?
- Did retry multiply traffic?
- Did an LB close idle connections?

---

## 14. Building a Standard HTTP Client Wrapper

In serious systems, application code should rarely use raw client APIs directly everywhere.

Create a standard wrapper or SDK per dependency class.

### 14.1 Wrapper Responsibilities

```text
- base URL / endpoint discovery
- timeout and deadline policy
- connection pool policy
- retry and idempotency policy
- circuit breaker / bulkhead / rate limiter
- request serialization
- response deserialization
- error mapping
- correlation id propagation
- trace context propagation
- metrics
- safe logging
- auth token injection
- TLS/mTLS configuration
- body size limits
- response close/consume discipline
```

### 14.2 Example Interface

```java
public interface PaymentGatewayClient {
    PaymentStatus getStatus(PaymentId id, Deadline deadline);
    PaymentResult submitPayment(PaymentCommand command, IdempotencyKey key, Deadline deadline);
}
```

The rest of the application should not know:

- URL paths,
- HTTP status mappings,
- retry policy,
- JSON field quirks,
- header conventions,
- client library details.

### 14.3 Dependency-Specific Client

```java
public final class HttpPaymentGatewayClient implements PaymentGatewayClient {
    private final HttpClient httpClient;
    private final URI baseUri;
    private final ObjectMapper mapper;
    private final Metrics metrics;

    @Override
    public PaymentStatus getStatus(PaymentId id, Deadline deadline) {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(baseUri.resolve("/payments/" + id.value()))
                .timeout(deadline.remainingOrThrow())
                .header("Accept", "application/json")
                .header("X-Correlation-Id", Correlation.current())
                .GET()
                .build();

        long start = System.nanoTime();
        try {
            HttpResponse<String> response = httpClient.send(
                    request,
                    HttpResponse.BodyHandlers.ofString()
            );
            metrics.record("payment.status.http", response.statusCode(), start);
            return mapStatus(response);
        } catch (IOException e) {
            throw mapTransportFailure(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ClientInterruptedException(e);
        }
    }
}
```

This is not about boilerplate. This is about preventing network complexity from leaking into business logic.

---

## 15. Timeout and Deadline Wrapper Pattern

### 15.1 Why Per-Client Timeout Is Not Enough

Suppose user request SLA is 2 seconds.

Your service calls three downstreams:

```text
A: max 700 ms
B: max 500 ms
C: max 500 ms
response assembly: 100 ms
buffer: 200 ms
```

If every HTTP client has a static 5-second timeout, the system violates its own SLA under failure.

### 15.2 Deadline Object

```java
public final class Deadline {
    private final Instant expiresAt;

    private Deadline(Instant expiresAt) {
        this.expiresAt = expiresAt;
    }

    public static Deadline after(Duration duration) {
        return new Deadline(Instant.now().plus(duration));
    }

    public Duration remainingOrThrow() {
        Duration remaining = Duration.between(Instant.now(), expiresAt);
        if (remaining.isNegative() || remaining.isZero()) {
            throw new DeadlineExceededException();
        }
        return remaining;
    }
}
```

Usage:

```java
HttpRequest request = HttpRequest.newBuilder(uri)
        .timeout(deadline.remainingOrThrow())
        .GET()
        .build();
```

### 15.3 Retry Budget

Retry must consume the same deadline.

Bad:

```text
try 1: 5 seconds
try 2: 5 seconds
try 3: 5 seconds
```

Better:

```text
overall deadline: 2 seconds
attempt 1: up to 700 ms
backoff: 100 ms
attempt 2: remaining budget
stop when deadline nearly exhausted
```

---

## 16. Retry Compatibility by Client

Retry does not belong blindly inside HTTP client configuration.

It must understand:

- method idempotency,
- request body replayability,
- status code,
- exception type,
- deadline remaining,
- idempotency key,
- remote side effect risk.

### 16.1 Replayability

Request bodies can be:

```text
fully buffered
  replayable but memory-costly

file-backed
  replayable if file still available and seekable

streaming from InputStream
  usually not replayable

generated publisher
  maybe replayable depending implementation
```

A retry wrapper must know whether it can safely send again.

### 16.2 Method Rules

| Method | Retry Default |
|---|---|
| GET | often safe if no side effect |
| HEAD | often safe |
| PUT | often safe if idempotent contract holds |
| DELETE | can be idempotent but domain-dependent |
| POST | unsafe unless idempotency key or explicit contract |
| PATCH | usually unsafe unless explicitly designed |

### 16.3 Status Rules

| Status / Failure | Retry? |
|---|---|
| Connect timeout | maybe, if deadline allows |
| Connection refused | maybe, but often dependency unavailable |
| Read timeout after body sent | dangerous for non-idempotent calls |
| 429 | maybe after `Retry-After`, with budget |
| 500 | maybe for idempotent calls |
| 502/503/504 | often retryable with backoff |
| 400/401/403/404 | usually not retryable without state change |
| 409/412 | not transport retry; needs domain handling |

---

## 17. Pool Sizing Across Clients

A useful formula:

```text
needed concurrency ≈ throughput_per_second × average_latency_seconds
```

If you need 500 requests/sec to a dependency and average latency is 100 ms:

```text
500 × 0.1 = 50 concurrent in-flight requests
```

Then add headroom and account for p95 latency.

If p95 latency becomes 500 ms:

```text
500 × 0.5 = 250 concurrent in-flight requests
```

This is why fixed small connection pools collapse when downstream latency rises.

But simply increasing the pool can overload the downstream.

Better strategy:

```text
- set pool max based on dependency capacity
- set pool acquisition timeout
- add bulkhead/semaphore
- add circuit breaker
- add retry budget
- add backpressure/load shedding
- monitor pending queue
```

---

## 18. HTTP/1.1 vs HTTP/2 Client Strategy

### 18.1 HTTP/1.1

Concurrency usually means multiple TCP connections.

```text
1 connection -> 1 active response at a time in practical non-pipelined use
many concurrent requests -> many connections
```

Pros:

- simple isolation,
- mature behavior,
- easier mental model,
- less stream-level coupling.

Cons:

- more TCP/TLS overhead,
- more file descriptors,
- more load balancer state,
- head-of-line blocking per connection.

### 18.2 HTTP/2

Concurrency usually means many streams over fewer TCP connections.

```text
1 TCP/TLS connection
  -> many HTTP/2 streams
```

Pros:

- fewer connections,
- multiplexing,
- header compression,
- better for many small concurrent calls.

Cons:

- one TCP connection can become shared failure domain,
- flow control complexity,
- max concurrent stream limits,
- large response can interfere with small responses,
- proxy/LB behavior matters,
- debugging is harder.

### 18.3 Production Strategy

Do not assume HTTP/2 is always faster.

Use HTTP/2 when:

- many small concurrent requests,
- server/proxy path is stable,
- observability can distinguish stream errors,
- flow-control issues are understood,
- gRPC is used.

Use HTTP/1.1 when:

- middlebox compatibility matters,
- simple isolation matters,
- large streaming responses dominate,
- debugging simplicity matters,
- HTTP/2 behavior through gateways is uncertain.

---

## 19. Observability Standard for Any HTTP Client

Every outbound dependency should emit these metrics:

```text
requests_total{dependency, method, status_class, status_code}
request_duration_seconds{dependency, method, outcome}
request_body_bytes{dependency, method}
response_body_bytes{dependency, method, status_class}
errors_total{dependency, error_type}
retries_total{dependency, reason}
timeouts_total{dependency, phase}
circuit_state{dependency}
bulkhead_available{dependency}
```

If supported:

```text
pool_active_connections{dependency}
pool_idle_connections{dependency}
pool_pending_acquisitions{dependency}
pool_max_connections{dependency}
connect_duration_seconds{dependency}
tls_handshake_duration_seconds{dependency}
dns_duration_seconds{dependency}
http2_active_streams{dependency}
http2_stream_resets_total{dependency}
```

### 19.1 Trace Attributes

For traces, capture:

```text
http.request.method
url.scheme
server.address
server.port
http.response.status_code
network.protocol.name
network.protocol.version
error.type
retry.attempt
peer.service or dependency name
```

Avoid capturing:

- full URLs with secrets,
- authorization headers,
- cookies,
- PII payload,
- tokens,
- large request/response bodies.

### 19.2 Log Events

Useful structured log events:

```text
outbound_request_started
outbound_request_finished
outbound_request_failed
outbound_request_retried
outbound_pool_saturated
outbound_deadline_exceeded
outbound_circuit_open
```

Each should include:

```text
dependency
operation
correlation_id
trace_id
attempt
elapsed_ms
remaining_deadline_ms
status_code or error_type
safe endpoint template
```

---

## 20. Migration Patterns

### 20.1 Legacy `HttpURLConnection` to Standard Client

Migration goal:

```text
ad-hoc URL calls
  -> dependency-specific client wrapper
  -> standard timeout/retry/metrics/error policy
```

Steps:

1. Inventory all outbound calls.
2. Group by dependency.
3. Identify method, URL, timeout, auth, retry behavior.
4. Define standard interface per dependency.
5. Choose underlying client.
6. Add tests with fake server.
7. Roll out per dependency.
8. Monitor latency/error/pool metrics.
9. Remove ad-hoc client code.

### 20.2 Apache 4.x to 5.x

Migration risks:

- API package changes,
- timeout type changes,
- connection manager changes,
- retry behavior changes,
- TLS config differences,
- classic vs async API decision,
- metric integration changes.

Do not treat this as mechanical import replacement.

### 20.3 RestTemplate to WebClient

This is not just a library migration.

It is often a concurrency model migration.

Bad migration:

```text
RestTemplate blocking call
  -> WebClient call
  -> immediately .block()
  -> no transport improvement
  -> more complexity
```

Good migration:

```text
- clarify why reactive is needed
- preserve non-blocking pipeline if WebFlux
- configure Reactor Netty connection provider
- add backpressure-aware body handling
- add context propagation
- test cancellation and timeout behavior
```

### 20.4 Third-Party Client to JDK HttpClient

Reasons to migrate:

- reduce dependencies,
- Java 11+ baseline,
- simple HTTP/1.1/2 needs,
- virtual-thread-friendly synchronous code.

Risks:

- missing advanced pool controls,
- different exception taxonomy,
- different redirect/cookie/proxy behavior,
- different TLS defaults,
- observability integration changes.

---

## 21. Failure Catalogue by Client Category

### 21.1 Blocking Pool-Based Clients

Common failures:

```text
pool exhausted
pending acquisition unbounded
caller threads blocked
response body not closed
stale idle connection reused
LB idle timeout mismatch
retry storm from many blocked threads
read timeout after remote side effect
```

Typical symptoms:

```text
ConnectionPoolTimeoutException
SocketTimeoutException
NoHttpResponseException
Connection reset
thread dump full of HTTP execute calls
p99 latency spike
```

### 21.2 Async/Event-Loop Clients

Common failures:

```text
event loop blocked
callback chain loses context
cancellation not propagated
unbounded in-flight futures
body publisher overwhelms consumer
ByteBuf leak
direct memory pressure
```

Typical symptoms:

```text
low CPU but high latency
all requests slow together
direct buffer OOM
reactor blocked thread warnings
pending promises/futures accumulating
```

### 21.3 HTTP/2 Multiplexed Clients

Common failures:

```text
MAX_CONCURRENT_STREAMS reached
large response starves small responses
flow control window exhausted
GOAWAY not handled gracefully
RST_STREAM storm
single connection shared bottleneck
LB/proxy downgrades to HTTP/1.1 unexpectedly
```

Typical symptoms:

```text
local queueing despite few TCP connections
stream reset errors
deadline exceeded
sporadic unavailable errors
dependency looks healthy but client p99 spikes
```

### 21.4 Reactive Clients

Common failures:

```text
.block() on event loop
missing subscribe
double subscription
lost error signal
backpressure ignored
context lost across scheduler boundary
body aggregated accidentally into memory
```

Typical symptoms:

```text
request never sent
memory grows under large response
hard-to-read stack traces
trace id missing in downstream calls
```

---

## 22. Anti-Patterns

### 22.1 Creating Client Per Request

Bad:

```java
public String call(String url) {
    HttpClient client = HttpClient.newHttpClient();
    return client.send(...).body();
}
```

Why bad:

- loses pooling benefits,
- repeats TLS setup,
- creates resource churn,
- hides lifecycle ownership.

Better:

```java
public final class ExternalClient {
    private final HttpClient client;

    public ExternalClient(HttpClient client) {
        this.client = client;
    }
}
```

### 22.2 Infinite or Missing Timeouts

Bad:

```text
connect timeout default
read timeout default
overall timeout missing
```

Better:

```text
connect timeout: short
pool acquisition timeout: short
request timeout/deadline: based on SLA
retry budget: within deadline
```

### 22.3 Retrying POST Without Idempotency Key

Bad:

```text
POST /payments
read timeout
retry automatically
customer charged twice
```

Better:

```text
POST /payments
Idempotency-Key: stable-key
server stores duplicate suppression record
client retries only within deadline
```

### 22.4 Logging Full Payload

Bad:

```text
log request body and response body in production
```

Risk:

- PII leak,
- token leak,
- compliance issue,
- huge log volume,
- latency impact.

Better:

```text
log method, endpoint template, status, dependency, correlation id, elapsed time, body size, safe error code
```

### 22.5 Mixing Business Error and Transport Error

Bad:

```java
throw new RuntimeException("Call failed");
```

Better taxonomy:

```text
RemoteValidationException
RemoteUnauthorizedException
RemoteConflictException
RemoteRateLimitedException
RemoteUnavailableException
RemoteTimeoutException
RemoteProtocolException
RemoteDeserializationException
```

---

## 23. Practical Selection Guidelines

### 23.1 Default Recommendations

For Java 8:

```text
Apache HttpClient or OkHttp
```

For Java 11–25 normal service-to-service HTTP:

```text
JDK HttpClient is a strong default if requirements are moderate.
Apache HttpClient remains strong for enterprise configurability.
OkHttp remains strong for clean API and HTTP/2 ergonomics.
```

For Spring MVC synchronous application:

```text
Use a synchronous Spring abstraction backed by a configured transport.
Do not rely on defaults blindly.
```

For Spring WebFlux/reactive application:

```text
Use WebClient/Reactor Netty.
Preserve non-blocking flow.
```

For custom protocol/gateway/high-control networking:

```text
Use Netty, but only with enough expertise.
```

For typed internal RPC:

```text
Use gRPC Java.
```

### 23.2 The Real Rule

The best client is the one whose failure model your team can operate.

Not the one with the prettiest API.
Not the one with the most benchmarks.
Not the one another company uses.

---

## 24. Design Exercise: Choosing a Client for a Case Management Platform

Imagine a Java 21 Spring Boot system for regulatory case management.

Dependencies:

```text
Identity provider
Document storage service
Notification service
Payment service
GIS/address lookup service
Internal case workflow service
Reporting export service
```

Requirements:

```text
- mTLS for internal services
- OAuth2 bearer token for external APIs
- JSON REST for public/external APIs
- gRPC optional for internal workflow service
- large report download up to 1 GB
- strict audit logging
- no PII payload logs
- p95 < 500 ms for normal lookup
- retry allowed only for idempotent calls
- Java 21 baseline
```

A good architecture:

```text
JDK HttpClient or Apache HttpClient for normal outbound REST
  -> wrapped per dependency
  -> standard deadline/retry/metrics/error mapping

Streaming-capable path for report download
  -> file/body streaming
  -> checksum
  -> size limit
  -> cancellation

gRPC Java for internal workflow service if both sides own contract
  -> deadline propagation
  -> channel metrics
  -> status mapping

No raw client usage in business services
  -> all access via dependency-specific SDK interfaces
```

A poor architecture:

```text
- random RestTemplate/WebClient/HttpURLConnection usage mixed everywhere
- no standard timeout
- no pool metrics
- retry in each method manually
- response bodies logged during debugging
- large export loaded into byte[]
- auth token code duplicated
- downstream errors exposed directly to UI
```

---

## 25. Checklist: Production-Ready HTTP Client

Before approving an HTTP client for production, answer all of these.

### 25.1 Runtime

```text
[ ] Java version compatibility is clear
[ ] dependency/security review is done
[ ] lifecycle ownership is clear
[ ] client is reused, not created per request
```

### 25.2 Protocol

```text
[ ] HTTP version requirement is known
[ ] TLS/mTLS config is known
[ ] proxy/LB/gateway behavior is known
[ ] redirect behavior is explicit
[ ] cookie behavior is explicit
```

### 25.3 Timeouts

```text
[ ] connect timeout exists
[ ] pool acquisition timeout exists where applicable
[ ] read/response timeout exists
[ ] overall request timeout/deadline exists
[ ] retry respects deadline
```

### 25.4 Pooling

```text
[ ] max total connections configured
[ ] max per route/dependency configured
[ ] idle eviction configured
[ ] connection TTL considered
[ ] pool metrics available
[ ] response body close/consume rule enforced
```

### 25.5 Resilience

```text
[ ] retry policy is method-aware
[ ] idempotency key is used for unsafe operations if retryable
[ ] backoff and jitter exist
[ ] retry budget exists
[ ] circuit breaker/bulkhead/rate limiter considered
```

### 25.6 Payload

```text
[ ] max request size exists
[ ] max response size exists
[ ] large body streaming strategy exists
[ ] compression behavior is explicit
[ ] deserialization errors are mapped
```

### 25.7 Observability

```text
[ ] metrics per dependency exist
[ ] status/error taxonomy exists
[ ] trace context is propagated
[ ] correlation id is propagated
[ ] safe structured logs exist
[ ] no secret/PII payload logging by default
```

### 25.8 Testing

```text
[ ] success test
[ ] 4xx mapping test
[ ] 5xx mapping test
[ ] timeout test
[ ] connection refused test
[ ] retry test
[ ] non-retryable POST test
[ ] large body test
[ ] cancellation test
[ ] TLS/proxy test if relevant
```

---

## 26. Common Interview-Level Questions With Senior Answers

### Q1. “Which Java HTTP client is fastest?”

Weak answer:

> “Netty is fastest.”

Senior answer:

> “Fastest depends on workload shape: small JSON vs large streaming, HTTP/1.1 vs HTTP/2, TLS reuse, concurrency, connection pool settings, body handling, and whether the caller model is blocking/reactive/event-loop. Netty gives high control and performance potential, but a misused Netty client can be slower and less reliable than a well-configured JDK or Apache client.”

### Q2. “Should we use WebClient instead of RestTemplate?”

Weak answer:

> “Yes, because RestTemplate is old.”

Senior answer:

> “It depends whether we are changing the concurrency model. If the app is synchronous Spring MVC and calls are ordinary request-response, a configured blocking client can be simpler, especially with virtual threads. If we need reactive streaming/backpressure or are already WebFlux, WebClient/Reactor Netty makes sense. Migration without preserving non-blocking flow may only add complexity.”

### Q3. “Does HTTP/2 remove the need for connection pooling?”

Weak answer:

> “Yes, one connection is enough.”

Senior answer:

> “No. HTTP/2 multiplexes streams over connections, but max concurrent streams, flow control, TCP-level head-of-line blocking, server settings, large response interference, and connection failure domain still matter. You still need channel/connection lifecycle, stream concurrency limits, and observability.”

### Q4. “Do virtual threads replace async HTTP clients?”

Weak answer:

> “Yes.”

Senior answer:

> “Virtual threads make blocking style much cheaper and simpler for many I/O-bound workloads, but they do not remove the need for bounded concurrency, connection pools, deadlines, cancellation, or backpressure. Reactive/event-loop clients still matter for streaming and high-control non-blocking systems.”

---

## 27. Exercises

### Exercise 1 — Inventory Outbound Calls

For one real application, create a table:

| Dependency | Client Used | Java Version | Timeout | Pool | Retry | Auth | Observability |
|---|---|---:|---|---|---|---|---|

Then identify:

```text
- duplicate clients
- missing timeouts
- unbounded pools
- unsafe retries
- missing metrics
- payload logging risks
```

### Exercise 2 — Design a Standard Client Wrapper

Choose one dependency and define:

```text
- Java interface
- request DTO
- response DTO
- error taxonomy
- timeout policy
- retry policy
- metrics
- logs
- tests
```

### Exercise 3 — Pool Sizing

Given:

```text
throughput = 300 requests/sec
p95 latency = 250 ms
remote max safe concurrency = 120
```

Compute approximate concurrency:

```text
300 × 0.25 = 75
```

Then decide:

```text
pool max around 80–100 with headroom
bulkhead max <= remote safe concurrency
pool acquisition timeout short
retry budget bounded
```

### Exercise 4 — Migration Review

Suppose a team wants to migrate all `RestTemplate` calls to `WebClient`.

Write a review checklist:

```text
- why reactive?
- where will `.block()` be used?
- is caller thread event-loop or worker?
- are timeouts equivalent?
- are pool limits equivalent?
- are metrics equivalent?
- is context propagation preserved?
- are body memory semantics equivalent?
```

---

## 28. Key Takeaways

1. An HTTP client is a runtime subsystem, not just an API wrapper.
2. Client choice must consider protocol, concurrency, pooling, failure, and observability.
3. `HttpURLConnection` is legacy and should be wrapped or avoided for critical paths.
4. Apache HttpClient is strong for enterprise blocking clients with explicit pool control.
5. OkHttp is clean, modern, and strong for HTTP/2-friendly use cases.
6. Netty is powerful but should be used directly only when transport control is justified.
7. Reactor Netty/WebClient is excellent for reactive and streaming systems, but not automatically better for all applications.
8. JDK `HttpClient` is a strong Java 11–25 default for many systems.
9. Virtual threads make blocking clients more attractive, but do not remove network limits.
10. The best HTTP client is the one whose operational behavior your team can understand, observe, and control.

---

## 29. References

- Java SE 25 `HttpClient` API — `java.net.http.HttpClient`, immutable reusable client, HTTP/1.1 and HTTP/2 preference, sync/async request sending.
- Java SE 25 `java.net.http` module documentation — HTTP Client and WebSocket APIs plus relevant system properties.
- Apache HttpComponents Client 5.x migration documentation — classic vs async/HTTP/2 migration considerations.
- OkHttp documentation — connection pooling and HTTP/2 multiplexing behavior.
- OkHttp concurrency notes — concurrency considerations for HTTP/2 connections and connection pool.
- Netty project documentation — asynchronous event-driven network framework for protocol clients and servers.
- Reactor Netty reference documentation — HTTP client built on Netty with Reactive Streams backpressure.
- RFC 9110 — HTTP Semantics.
- RFC 9112 — HTTP/1.1.
- RFC 9113 — HTTP/2.

---

## 30. Series Progress

```text
Part 11 of 35 complete.
Series is not complete.
Next part: Part 12 — JDK java.net.http.HttpClient: Architecture, Usage, and Production Patterns
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./010-http3-quic-for-java-engineers-what-changes-what-does-not.md">⬅️ Part 10 — HTTP/3 and QUIC for Java Engineers: What Changes, What Does Not</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./012-jdk-java-net-http-httpclient-architecture-usage-production-patterns.md">Part 12 — JDK `java.net.http.HttpClient`: Architecture, Usage, and Production Patterns ➡️</a>
</div>
