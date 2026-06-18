# Part 9 — HTTP/2 Deep Dive: Streams, Frames, Multiplexing, HPACK, Flow Control, and Prioritization

Series: `learn-java-io-network-http-grpc-protocol-engineering`  
File: `009-http2-deep-dive-streams-frames-multiplexing-hpack-flow-control-prioritization.md`  
Scope: Java 8–25, advanced network/protocol engineering  
Status: Part 9 of 35

---

## 1. Why This Part Matters

HTTP/2 is one of the most misunderstood protocols in backend engineering.

Many engineers summarize it as:

> HTTP/2 is faster because it multiplexes many requests over one connection.

That sentence is directionally useful, but dangerously incomplete.

A top-tier Java engineer must understand that HTTP/2 is not merely “HTTP/1.1 but faster”. HTTP/2 changes the transport behavior between client and server. It turns one TCP connection into a framed, multiplexed, stateful communication channel where many logical streams share the same physical connection.

That solves some HTTP/1.1 problems, but introduces new ones.

HTTP/1.1 problem:

```text
one connection -> one in-flight response at a time in practice
many concurrent requests -> many TCP connections
many TCP connections -> handshake cost, TLS cost, port usage, pool tuning, unfairness
```

HTTP/2 improvement:

```text
one connection -> many concurrent logical streams
one TCP/TLS connection can carry many requests/responses at once
```

HTTP/2 new risks:

```text
one connection becomes a shared fate domain
one stalled TCP connection can affect many logical requests
flow-control misconfiguration can stall streams
large responses can interfere with small responses
MAX_CONCURRENT_STREAMS can become hidden queueing
connection-level events like GOAWAY affect many requests at once
proxy/LB/service-mesh behavior becomes more important
```

The mental upgrade is this:

```text
HTTP/1.1 thinking:
  concurrency ~= number of connections

HTTP/2 thinking:
  concurrency ~= streams per connection * number of usable connections,
  bounded by flow-control windows, max concurrent streams, server settings,
  network bandwidth, remote capacity, client dispatcher, and deadline budgets
```

---

## 2. What We Will Not Repeat

You already studied Java I/O, networking, servlet, websocket, JAX-RS, JSON/XML, concurrency, reliability, and HTTP/1.1 basics. This part will not repeat:

- what HTTP methods mean,
- how to make a basic REST endpoint,
- how to use `InputStream`, `Socket`, or `ByteBuffer` from scratch,
- how TLS fundamentally works,
- how to write a basic Java HTTP client call,
- how to create a basic gRPC service.

This part focuses on HTTP/2 as a **runtime protocol substrate** for Java systems.

---

## 3. Learning Outcomes

After this part, you should be able to:

1. Explain HTTP/2 as a binary framed protocol, not a text protocol.
2. Distinguish connection, stream, frame, message, and application request.
3. Explain multiplexing and why it reduces HTTP/1.1 connection pressure.
4. Identify where HTTP/2 still suffers from TCP-level head-of-line blocking.
5. Understand the role of `SETTINGS_MAX_CONCURRENT_STREAMS`.
6. Explain stream states and why stream lifecycle matters for cancellation and retry.
7. Understand flow control at stream and connection level.
8. Reason about `WINDOW_UPDATE`, backpressure, large responses, and slow consumers.
9. Understand HPACK and why header compression creates stateful behavior.
10. Explain ALPN and protocol negotiation from a Java client perspective.
11. Diagnose common HTTP/2 production failures: GOAWAY, REFUSED_STREAM, stream reset, flow-control stalls, idle timeout mismatch, and proxy downgrade.
12. Decide when HTTP/2 is a better fit than HTTP/1.1, and when it is not enough.
13. Connect HTTP/2 concepts to gRPC Java.

---

## 4. The Core Mental Model

HTTP/2 separates **semantic HTTP messages** from **wire-level frames**.

In HTTP/1.1, the protocol is text-oriented:

```text
GET /cases/123 HTTP/1.1

Host: api.example.com

Accept: application/json



```

In HTTP/2, the logical meaning is still HTTP:

```text
GET /cases/123
Accept: application/json
```

But on the wire, it becomes binary frames:

```text
connection
  stream 1
    HEADERS frame
    DATA frame(s)
  stream 3
    HEADERS frame
    DATA frame(s)
  stream 5
    HEADERS frame
    DATA frame(s)
```

The protocol has layers:

```text
HTTP semantics
  method, path, status, headers, body

HTTP/2 message mapping
  pseudo-headers, request/response headers, trailers

HTTP/2 frame layer
  HEADERS, DATA, SETTINGS, WINDOW_UPDATE, RST_STREAM, GOAWAY, PING, etc.

TLS + ALPN, usually for HTTPS

TCP byte stream
```

A top-tier engineer does not debug HTTP/2 as “API call failed”. They ask:

```text
Did DNS resolve correctly?
Did TLS negotiation complete?
Was h2 selected via ALPN?
Was a stream opened?
Was the stream accepted under MAX_CONCURRENT_STREAMS?
Were HEADERS sent?
Was DATA flow-control blocked?
Was the stream reset?
Was the connection GOAWAY-ed?
Did a proxy downgrade to HTTP/1.1?
Did the client silently open another connection?
Did deadline expire while queued behind stream limits?
```

---

## 5. HTTP/2 Is Binary Framed

HTTP/2 does not send human-readable request lines and headers like HTTP/1.1.

It sends frames. Each frame belongs either to:

- a specific stream, or
- the connection as a whole.

Conceptually:

```text
TCP connection
  frame: SETTINGS        stream=0
  frame: HEADERS         stream=1
  frame: DATA            stream=1
  frame: HEADERS         stream=3
  frame: DATA            stream=3
  frame: WINDOW_UPDATE   stream=0
  frame: WINDOW_UPDATE   stream=3
  frame: RST_STREAM      stream=1
  frame: GOAWAY          stream=0
```

Important distinction:

```text
stream id = logical request/response flow
stream 0 = connection-level control frames
```

HTTP/2 frame types include:

| Frame | Purpose |
|---|---|
| `DATA` | Carries request or response body bytes |
| `HEADERS` | Carries header block fragments |
| `PRIORITY` | Historical priority signal; much less important in many modern stacks |
| `RST_STREAM` | Aborts a stream |
| `SETTINGS` | Exchanges peer configuration |
| `PUSH_PROMISE` | Server push mechanism; largely deprecated or disabled in many deployments |
| `PING` | Measures or keeps connection liveness |
| `GOAWAY` | Initiates connection shutdown / drain |
| `WINDOW_UPDATE` | Increases flow-control window |
| `CONTINUATION` | Continues a header block split across frames |

The important thing is not memorizing frame names. The important thing is knowing that HTTP/2 is **stateful** at both connection and stream levels.

---

## 6. Connection, Stream, Frame, Message, Request

These terms are often mixed up.

### 6.1 Connection

A connection is usually one TCP connection, often protected by TLS:

```text
client socket <---- TCP/TLS ----> server socket
```

A single HTTP/2 connection can carry many streams.

### 6.2 Stream

A stream is a bidirectional logical flow inside an HTTP/2 connection.

For normal HTTP request/response:

```text
client opens stream
client sends request HEADERS
client optionally sends request DATA
server sends response HEADERS
server optionally sends response DATA
server closes stream
```

Each HTTP request normally maps to one stream.

### 6.3 Frame

A frame is the smallest HTTP/2 wire unit.

Frames are interleaved:

```text
stream 1 HEADERS
stream 3 HEADERS
stream 1 DATA chunk
stream 5 HEADERS
stream 3 DATA chunk
stream 1 DATA chunk
stream 5 DATA chunk
```

This is how multiplexing works.

### 6.4 Message

An HTTP message is semantic:

```text
request = headers + optional body
response = headers + optional body + optional trailers
```

HTTP/2 represents a message as a sequence of frames.

### 6.5 Application Request

Your Java code sees an application request:

```java
HttpRequest request = HttpRequest.newBuilder(uri)
    .GET()
    .build();
```

But the network sees:

```text
stream allocation
header compression
HEADERS frame(s)
flow-control accounting
DATA frame(s), if body exists
response frames
stream close
```

The operational lesson:

> The Java API hides the frame layer, but production failures often happen at the frame/stream/connection layer.

---

## 7. HTTP/2 Request and Response Mapping

HTTP/2 removes the textual request line and status line. Instead, it uses pseudo-headers.

HTTP/1.1 request:

```http
GET /cases/123?include=history HTTP/1.1
Host: api.internal
Accept: application/json
```

HTTP/2 equivalent pseudo-headers:

```text
:method = GET
:scheme = https
:authority = api.internal
:path = /cases/123?include=history
accept = application/json
```

HTTP/1.1 response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

HTTP/2 response:

```text
:status = 200
content-type = application/json
```

Important rules:

- Pseudo-headers are not ordinary application headers.
- Pseudo-headers must appear before regular headers.
- Header names are lowercase in HTTP/2.
- Connection-specific HTTP/1.1 headers such as `Connection` do not belong in HTTP/2 message semantics.

Operational implication:

```text
If an old proxy, gateway, or custom integration incorrectly translates headers,
you can get weird protocol errors even when application code looks correct.
```

---

## 8. Multiplexing

HTTP/2 multiplexing means many streams share one connection concurrently.

HTTP/1.1 common pattern:

```text
connection A -> request 1 -> response 1
connection B -> request 2 -> response 2
connection C -> request 3 -> response 3
```

HTTP/2 pattern:

```text
connection A:
  stream 1 -> request 1 / response 1
  stream 3 -> request 2 / response 2
  stream 5 -> request 3 / response 3
```

This reduces:

- TCP connection count,
- TLS handshake count,
- socket/file descriptor pressure,
- ephemeral port pressure,
- pool tuning complexity in some cases,
- latency caused by connection establishment.

But multiplexing does not mean unlimited concurrency.

Actual concurrency is bounded by:

```text
server SETTINGS_MAX_CONCURRENT_STREAMS
client max streams policy
connection-level flow-control window
stream-level flow-control window
bandwidth
remote CPU/thread capacity
server application concurrency
proxy/service mesh settings
client executor/dispatcher
Java async executor behavior
request deadline
```

A dangerous misconception:

> HTTP/2 uses one connection, therefore connection pooling no longer matters.

Correct model:

> HTTP/2 changes what connection pooling means. Instead of one request per connection, one connection has a stream budget. You still need to reason about connection count, stream count, queueing, draining, flow control, and failure domain size.

---

## 9. HTTP/2 Does Not Eliminate All Head-of-Line Blocking

HTTP/2 solves HTTP/1.1 application-layer head-of-line blocking on a single connection.

HTTP/1.1:

```text
request A response is slow
request B behind it waits on same connection
```

HTTP/2:

```text
stream A can be slow
stream B frames can still be interleaved
```

But HTTP/2 over TCP still has TCP-level head-of-line blocking.

If one TCP packet is lost, TCP must deliver bytes in order to the HTTP/2 layer. Frames for other streams behind the missing TCP segment cannot be processed until retransmission fills the gap.

So:

```text
HTTP/2 removes HTTP-message HOL blocking,
but not TCP byte-stream HOL blocking.
```

This matters for:

- high packet loss networks,
- mobile networks,
- cross-region traffic,
- overloaded network paths,
- very large multiplexed flows,
- one connection carrying many high-value requests.

This is one reason HTTP/3/QUIC exists, which will be discussed later.

---

## 10. Stream States and Lifecycle

HTTP/2 streams have a lifecycle.

Simplified states:

```text
idle
  -> open
  -> half-closed local
  -> half-closed remote
  -> closed
```

For a simple GET:

```text
client sends HEADERS with END_STREAM
  client side: half-closed local
server sends response HEADERS + DATA + END_STREAM
  stream closed
```

For a POST with body:

```text
client sends HEADERS
client sends DATA frames
client sends END_STREAM
server sends response
server sends END_STREAM
```

For streaming protocols such as gRPC:

```text
stream can remain open longer
client and server can exchange DATA over time
trailers are important for final status
```

Why stream states matter:

- retry is different before vs after request body is sent,
- cancellation maps to stream reset,
- partial response can make retry unsafe,
- long-lived streams occupy stream capacity,
- deadlines must close or cancel streams cleanly,
- leaks can hold memory/window/resources.

---

## 11. Stream IDs

HTTP/2 streams have numeric IDs.

Common rule:

```text
client-initiated streams use odd stream IDs
server-initiated streams use even stream IDs
```

Example:

```text
client request 1 -> stream 1
client request 2 -> stream 3
client request 3 -> stream 5
```

This explains why HTTP/2 logs often show odd stream IDs for client requests.

Stream IDs are not reused on the same connection. When the ID space is exhausted, the connection must be replaced.

In normal backend systems, exhaustion is rare, but connection draining and replacement are normal.

---

## 12. SETTINGS Frame and Peer Configuration

HTTP/2 peers exchange `SETTINGS` frames.

Settings define how the peer wants the connection to behave.

Important settings include:

| Setting | Meaning |
|---|---|
| `SETTINGS_MAX_CONCURRENT_STREAMS` | Maximum concurrent streams the peer allows |
| `SETTINGS_INITIAL_WINDOW_SIZE` | Initial stream-level flow-control window |
| `SETTINGS_MAX_FRAME_SIZE` | Maximum frame payload size |
| `SETTINGS_MAX_HEADER_LIST_SIZE` | Advisory max header size |
| `SETTINGS_ENABLE_PUSH` | Whether server push is enabled |

Operationally, `MAX_CONCURRENT_STREAMS` is one of the most important.

If the server advertises:

```text
SETTINGS_MAX_CONCURRENT_STREAMS = 100
```

Then the client should not create more than 100 concurrent streams on that connection.

If application concurrency is 1000, the client must either:

```text
queue requests
open additional connections if implementation allows/chooses
fail fast
apply backpressure
```

Different Java HTTP/gRPC libraries may choose different behavior.

Your code should not assume:

```text
HTTP/2 = infinite parallelism
```

---

## 13. MAX_CONCURRENT_STREAMS as a Hidden Bulkhead

`MAX_CONCURRENT_STREAMS` is effectively a protocol-level bulkhead.

It protects the peer from too many active streams on one connection.

But to the application, it can look like unexplained latency.

Example:

```text
client wants to send 500 concurrent requests
server allows 100 streams per connection
client has 1 HTTP/2 connection

100 requests active
400 requests queued somewhere inside client/library
```

Symptoms:

```text
p50 latency looks fine
p95/p99 latency rises sharply
remote service CPU is not saturated
connection count is low
client-side pending requests increase
application sees timeouts before remote receives requests
```

Diagnostic question:

> Did the request timeout while waiting for a stream slot, or after being sent to the server?

Top-tier systems distinguish:

```text
queue wait time before stream creation
request write time
server processing time
response read time
full end-to-end deadline
```

---

## 14. Flow Control: The Most Important Hidden Mechanism

HTTP/2 has flow control.

Flow control prevents a sender from overwhelming a receiver with DATA frames.

There are two levels:

```text
connection-level flow control
stream-level flow control
```

A sender can send DATA only while it has window available.

When the receiver consumes bytes and wants more, it sends `WINDOW_UPDATE`.

Simplified:

```text
sender window = 65535 bytes
sender sends 16KB DATA
window decreases
receiver consumes bytes
receiver sends WINDOW_UPDATE
sender window increases
```

Important:

- Flow control applies to DATA frames.
- Flow control does not apply to all frame types equally.
- It is directional.
- It exists both per stream and per connection.

---

## 15. Stream-Level vs Connection-Level Flow Control

Imagine one connection with three streams:

```text
connection window = 1 MB
stream 1 window = 256 KB
stream 3 window = 256 KB
stream 5 window = 256 KB
```

If stream 1 is a large download and the client stops consuming it:

```text
stream 1 window eventually reaches 0
server cannot send more DATA on stream 1
```

But if connection window is still available, stream 3 and 5 may continue.

If the client stops consuming all streams or the connection-level window is exhausted:

```text
connection window reaches 0
server cannot send DATA on any stream
```

This can create system-wide stalls.

Production symptom:

```text
connections established
no obvious errors
requests appear stuck
CPU low
network low
threads waiting
no response progress
```

Possible cause:

```text
flow-control window exhausted because application is not reading/consuming bodies
```

---

## 16. Flow Control and Java Application Behavior

In Java, flow control is often hidden by the client/server library.

But application behavior still affects it.

Bad pattern:

```java
HttpResponse<InputStream> response = client.send(request, BodyHandlers.ofInputStream());

// Application reads only some bytes and forgets to close/consume the body.
InputStream body = response.body();
byte[] firstBytes = body.readNBytes(100);
// body not fully consumed, not closed
```

Potential effects:

```text
stream resources retained
connection reuse affected
flow-control window may not be replenished
pool/channel capacity reduced
future requests may stall
```

Better pattern:

```java
try (InputStream body = response.body()) {
    body.transferTo(outputStream);
}
```

Or use a body handler that fully materializes safely when size is bounded:

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

But for large bodies, materializing as string/byte array can cause memory pressure.

The mature rule:

```text
Every response body must be one of:
  fully consumed,
  streamed to a bounded sink,
  explicitly cancelled/closed,
  rejected early based on size/content rules.
```

---

## 17. Large Response vs Small Response Interference

HTTP/2 multiplexing allows interleaving. But one large response can still affect others through:

- bandwidth usage,
- connection-level flow control,
- server prioritization,
- client consumer speed,
- TCP congestion window,
- kernel buffers,
- library write scheduling.

Example:

```text
stream 1 -> 500 MB report download
stream 3 -> small /health response
stream 5 -> small /case/123 response
```

HTTP/2 can interleave frames, but if stream 1 consumes most bandwidth or connection-level window, small responses may see increased latency.

This is why production systems often separate traffic classes:

```text
small latency-sensitive API calls -> one client/channel/pool
large downloads/uploads -> separate client/channel/pool
streaming/reporting -> separate route or host
```

Do not blindly put all traffic over one HTTP/2 connection because multiplexing exists.

---

## 18. HPACK Header Compression

HTTP/2 uses HPACK for header compression.

Why?

HTTP headers are often repetitive:

```text
authorization: Bearer ...
content-type: application/json
accept: application/json
user-agent: ...
traceparent: ...
```

Sending full headers repeatedly wastes bandwidth.

HPACK compresses headers using:

- static table,
- dynamic table,
- indexed representations,
- Huffman encoding.

Core idea:

```text
first request sends header values
later requests can refer to table indexes
```

This makes HTTP/2 header handling stateful at the connection level.

Operational implications:

1. Header compression improves efficiency.
2. Huge or high-cardinality headers can damage compression efficiency.
3. Sensitive headers need careful handling.
4. Dynamic table state means corrupted/invalid header compression state can break the connection.
5. Header size limits still matter.

Bad header patterns:

```text
very large JWT in Authorization
large cookie header
many tracing/baggage entries
large custom metadata
per-request unique high-cardinality headers
```

For backend Java systems, HPACK is often invisible, but header discipline remains essential.

---

## 19. Header Size Still Matters

HTTP/2 is binary and compressed, but that does not mean headers can be unbounded.

Large headers can cause:

- memory pressure,
- compression table churn,
- proxy rejection,
- `431 Request Header Fields Too Large`,
- HTTP/2 stream errors,
- gateway incompatibility,
- gRPC metadata failures.

Common causes:

```text
JWT too large because roles/permissions are embedded
cookies forwarded unnecessarily
trace baggage abuse
base64 documents in headers
complex serialized filters in query/header
```

Mature design:

```text
Keep headers small, bounded, and operationally meaningful.
Use body for structured request data.
Use opaque reference IDs for large context.
Avoid forwarding browser cookies into internal service mesh unnecessarily.
```

---

## 20. ALPN: How HTTP/2 Is Negotiated

For HTTPS, HTTP/2 is typically negotiated during TLS using ALPN: Application-Layer Protocol Negotiation.

Client says during TLS handshake:

```text
I support: h2, http/1.1
```

Server chooses:

```text
h2
```

Then HTTP/2 is used.

If negotiation fails or server/proxy does not support HTTP/2:

```text
client may fall back to HTTP/1.1
```

Java implication:

```java
HttpClient client = HttpClient.newBuilder()
    .version(HttpClient.Version.HTTP_2)
    .build();
```

This expresses a preferred version. It does not guarantee every request will use HTTP/2 in every environment. TLS, ALPN, server support, proxy behavior, and implementation rules still matter.

Operational lesson:

> Always verify negotiated protocol in real environments, especially behind ingress, API gateway, corporate proxy, ALB/NLB, or service mesh.

---

## 21. Java JDK HttpClient and HTTP/2

The JDK `java.net.http.HttpClient` supports HTTP/1.1 and HTTP/2 and is created via a builder. Once built, the client is immutable and can be reused across requests.

Basic HTTP/2-preferred client:

```java
HttpClient client = HttpClient.newBuilder()
    .version(HttpClient.Version.HTTP_2)
    .connectTimeout(Duration.ofSeconds(3))
    .build();
```

Request with explicit version preference:

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com/cases/123"))
    .version(HttpClient.Version.HTTP_2)
    .timeout(Duration.ofSeconds(5))
    .GET()
    .build();
```

Inspect actual response version:

```java
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

System.out.println("Protocol used: " + response.version());
```

Do not assume:

```text
I requested HTTP_2 == I got HTTP_2
```

Instead, instrument:

```text
requested protocol version
actual protocol version
remote address/route
TLS handshake result, when available
response latency
failure type
```

---

## 22. Async HTTP/2 in Java

HTTP/2 is commonly paired with async usage because multiplexing supports many concurrent streams.

Example:

```java
HttpClient client = HttpClient.newBuilder()
    .version(HttpClient.Version.HTTP_2)
    .connectTimeout(Duration.ofSeconds(3))
    .build();

List<CompletableFuture<HttpResponse<String>>> futures = caseIds.stream()
    .map(id -> {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("https://api.example.com/cases/" + id))
            .timeout(Duration.ofSeconds(5))
            .GET()
            .build();

        return client.sendAsync(request, HttpResponse.BodyHandlers.ofString());
    })
    .toList();

CompletableFuture<Void> all = CompletableFuture.allOf(
    futures.toArray(CompletableFuture[]::new)
);

all.join();
```

But this code has hidden risks:

```text
unbounded concurrency if caseIds is huge
no bulkhead
no retry budget
no cancellation propagation beyond join failure
no per-request classification
no queue wait measurement
all futures may continue after first failure unless controlled
```

A better production design adds:

```text
bounded concurrency
per-request deadline
overall batch deadline
cancellation
result classification
metrics
retry only for safe conditions
```

---

## 23. Virtual Threads and HTTP/2

Java virtual threads make blocking style much cheaper from a Java thread scalability perspective.

This means you can write:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<HttpResponse<String>>> futures = caseIds.stream()
        .map(id -> executor.submit(() -> {
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://api.example.com/cases/" + id))
                .timeout(Duration.ofSeconds(5))
                .GET()
                .build();

            return client.send(request, HttpResponse.BodyHandlers.ofString());
        }))
        .toList();
}
```

This is more readable than many `CompletableFuture` graphs.

But virtual threads do not remove these limits:

```text
MAX_CONCURRENT_STREAMS
connection-level flow-control window
remote service capacity
client connection/channel capacity
rate limit
bandwidth
kernel socket buffers
memory for response bodies
server queueing
end-to-end deadline
```

Important rule:

> Virtual threads reduce the cost of waiting in Java. They do not increase the capacity of the remote system or the network.

So even with virtual threads, use:

```text
semaphores
bulkheads
rate limiters
deadlines
bounded queues
response body limits
backpressure
```

---

## 24. HTTP/2 and gRPC

gRPC uses HTTP/2 as its transport foundation.

That means many gRPC behaviors are HTTP/2 behaviors in RPC clothing:

| gRPC Concept | HTTP/2 Substrate |
|---|---|
| RPC call | HTTP/2 stream |
| Request metadata | HTTP/2 headers |
| Response metadata | HTTP/2 headers |
| Message payload | HTTP/2 DATA frames |
| Final status | HTTP/2 trailers |
| Cancellation | RST_STREAM / stream close behavior |
| Keepalive | HTTP/2 PING |
| Deadline exceeded | deadline/cancellation mapped to RPC status |
| Streaming RPC | long-lived HTTP/2 stream |
| Flow control | HTTP/2 flow control plus gRPC/library buffering |

This is why learning HTTP/2 deeply makes gRPC easier.

When a gRPC bidirectional stream stalls, possible causes include:

```text
application not requesting/consuming messages
HTTP/2 stream flow-control exhausted
connection flow-control exhausted
Netty event loop blocked
server max concurrent streams hit
channel in transient failure
proxy does not support long-lived HTTP/2 correctly
keepalive policy violation
deadline/cancellation propagated
```

---

## 25. GOAWAY: Connection Draining and Shutdown

`GOAWAY` is a connection-level frame.

It tells the peer:

```text
I am closing/draining this HTTP/2 connection.
Do not create new streams here.
Streams up to last-stream-id may have been processed.
```

GOAWAY is not always an error. It can be normal during:

- server restart,
- load balancer draining,
- max connection age reached,
- deployment rollout,
- graceful shutdown,
- maintenance,
- protocol policy violation.

But it has consequences.

If client receives GOAWAY:

```text
existing streams may continue depending on last-stream-id
new streams should use another connection
some streams may need retry if safe and unprocessed
```

Production logging should capture:

```text
GOAWAY debug data, if available
last stream id
active stream count
request ids on affected streams
whether retry happened
whether request was idempotent
```

A mature client wrapper does not treat all GOAWAY cases the same.

---

## 26. RST_STREAM: Stream-Level Abort

`RST_STREAM` aborts one stream without necessarily closing the whole connection.

Possible reasons:

- cancellation,
- timeout/deadline,
- protocol error,
- refused stream,
- remote overload,
- application abort,
- client no longer wants response,
- server rejects request early.

In Java HTTP client code, this may surface as exceptions or failed futures. In gRPC, it may map to status codes depending on circumstances.

Important retry question:

```text
Was the request processed by the server?
```

If no:

```text
retry may be safe if method/idempotency allows
```

If yes or unknown:

```text
retry may duplicate side effects
```

This is why idempotency keys, request IDs, and server-side deduplication matter.

---

## 27. REFUSED_STREAM and Retry Semantics

`REFUSED_STREAM` indicates the stream was refused before processing.

In theory, this can be retried safely because the stream was not processed.

But application design must still be careful.

Safe retry conditions:

```text
request body is replayable
deadline budget remains
retry budget available
method/operation is idempotent or deduplicated
library correctly classifies refusal
```

Unsafe retry pattern:

```text
large streaming upload body cannot be replayed
non-idempotent operation without idempotency key
retry happens after deadline expired
multiple layers retry simultaneously
```

HTTP/2 makes retry classification more precise at protocol level, but business-level side-effect safety still belongs to application design.

---

## 28. PING and Keepalive

HTTP/2 has a PING frame.

It can be used for:

- liveness checking,
- measuring round-trip time,
- keeping idle connections alive,
- gRPC keepalive.

But keepalive must be configured carefully.

Too frequent keepalive can:

```text
increase network noise
trigger server enforcement policies
cause connection termination
amplify load during outages
interact badly with mobile/NAT/proxy paths
```

Too infrequent keepalive can:

```text
allow stale connections to sit undetected
cause first request after idle to fail
hide broken middlebox paths
```

Distinguish:

```text
TCP keepalive      -> kernel-level socket liveness
HTTP/2 PING        -> protocol-level connection liveness
application health -> semantic dependency health
```

They are not interchangeable.

---

## 29. HTTP/2 Prioritization

HTTP/2 originally included stream prioritization.

The idea:

```text
client can tell server which streams are more important
server can schedule response frames accordingly
```

In practice, prioritization has been inconsistently implemented and less central in many backend systems than the original design suggested.

For backend Java systems, practical prioritization usually happens outside HTTP/2 priority frames:

```text
separate clients/channels for traffic classes
separate hostnames/routes
separate bulkheads
separate worker pools
separate rate limits
separate queues
separate timeout budgets
```

Example:

```text
case lookup API       -> low latency, small payload
report export API     -> large payload, longer deadline
batch reconciliation  -> background throughput-oriented
```

Do not rely on HTTP/2 priority alone to protect latency-sensitive traffic.

---

## 30. Server Push

HTTP/2 introduced server push via `PUSH_PROMISE`.

For modern backend service-to-service systems, server push is usually irrelevant or disabled.

Reasons:

- difficult caching semantics,
- poor deployment consistency,
- browser ecosystem shift,
- complexity through proxies/CDNs,
- not useful for most API/gRPC workloads.

For backend engineering, you should recognize it, but you usually should not design around it.

---

## 31. HTTP/2 Through Proxies, Gateways, and Load Balancers

Real production traffic often travels through middleboxes:

```text
Java client
  -> corporate proxy / egress proxy
  -> API gateway
  -> ingress controller
  -> service mesh sidecar
  -> load balancer
  -> server
```

Each hop may use a different protocol:

```text
client -> gateway: HTTP/2
 gateway -> service: HTTP/1.1

client -> gateway: HTTP/1.1
 gateway -> service: HTTP/2

client -> sidecar: HTTP/1.1
 sidecar -> sidecar: HTTP/2
 sidecar -> app: HTTP/1.1
```

This matters because symptoms can be misleading.

You may think:

```text
My client uses HTTP/2.
```

But actual path could be:

```text
client to proxy: HTTP/2
proxy to upstream: HTTP/1.1
```

Or:

```text
browser to CDN: HTTP/2
CDN to origin: HTTP/1.1
```

Operationally, always verify per hop when it matters.

Key questions:

```text
Is HTTP/2 terminated at the load balancer?
Is upstream also HTTP/2?
Is gRPC supported end-to-end?
Are trailers preserved?
Are idle timeouts compatible with long-lived streams?
Does the proxy enforce max stream duration?
Does it buffer request/response bodies?
Does it downgrade or normalize headers?
```

---

## 32. HTTP/2 and TLS Termination

HTTP/2 with TLS requires correct TLS and ALPN behavior.

Common deployment models:

### 32.1 TLS terminates at application

```text
client --TLS/h2--> Java application
```

Application owns certificates and ALPN.

### 32.2 TLS terminates at load balancer

```text
client --TLS/h2--> load balancer --HTTP/1.1 or h2c--> app
```

Application may not see TLS or HTTP/2 directly.

### 32.3 TLS terminates at sidecar

```text
client -> sidecar --mTLS/h2--> sidecar -> app
```

Service mesh controls transport behavior.

### 32.4 End-to-end mTLS

```text
client --mTLS/h2--> server
```

Application or platform controls mTLS.

Mature engineers document:

```text
protocol per hop
encryption per hop
identity per hop
timeout per hop
retry per hop
observability per hop
```

---

## 33. h2 vs h2c

HTTP/2 over TLS is commonly identified as `h2`.

HTTP/2 without TLS is often called `h2c`.

In browser/public internet contexts, HTTP/2 is usually TLS-based.

In internal service-to-service systems, h2c may appear behind trusted networks, inside service mesh, or between gateway and application.

Be careful:

```text
Some clients/servers support h2 but not h2c.
Some proxies support h2 downstream but not upstream.
Some gRPC deployments require HTTP/2 end-to-end.
```

For Java systems, never assume h2c support unless tested with your exact server/client/proxy stack.

---

## 34. HTTP/2 and gRPC Behind Gateways

gRPC needs HTTP/2 semantics, including trailers.

A gateway that treats traffic like ordinary HTTP/1.1 JSON API may break gRPC.

Failure modes:

```text
trailers stripped
gRPC status lost
stream reset by gateway
timeout enforced too aggressively
long-lived streaming RPC killed
large metadata rejected
flow-control behavior altered
HTTP/2 downgraded to HTTP/1.1 without gRPC-Web translation
```

gRPC-Web exists because browser and proxy realities differ from raw gRPC.

For backend Java-to-Java gRPC, prefer verifying:

```text
HTTP/2 end-to-end support
trailer preservation
max stream duration
max message size
keepalive policy
idle timeout
mTLS identity propagation
load balancing behavior
```

---

## 35. Timeout Engineering Changes with HTTP/2

In HTTP/1.1, a request may wait for a connection from the pool.

In HTTP/2, a request may wait for:

```text
connection establishment
TLS/ALPN
stream slot
flow-control window
client executor scheduling
server queue
response frames
body consumption
```

A single “request timeout” hides many phases.

Mature metrics separate:

```text
name resolution time
connect time
TLS handshake time
ALPN result
stream acquisition/queue wait
request header write time
request body write time
time to first response header
response body duration
total deadline consumed
```

If you only measure total duration, you may blame the server when the request never got a stream slot.

---

## 36. Retry Engineering Changes with HTTP/2

HTTP/2 introduces more precise failure signals, but retry remains dangerous.

Potentially retryable:

```text
REFUSED_STREAM
GOAWAY for streams above last-stream-id
connection reset before request was sent
transient connection failure before stream creation
```

Potentially unsafe:

```text
stream reset after request body sent
response headers received
partial response body received
non-idempotent operation
streaming upload
expired deadline
unknown server processing state
```

Good retry decision uses:

```text
protocol signal
request method
operation semantic idempotency
idempotency key
body replayability
deadline remaining
retry budget
attempt count
server guidance
```

---

## 37. Observability: What to Measure

HTTP/2 observability needs more than HTTP status codes.

### 37.1 Metrics

Capture:

```text
actual protocol version
connection count per route
active streams
pending stream acquisitions
max concurrent streams observed
stream reset count by reason
GOAWAY count
PING failures
flow-control stalls, if library exposes
request duration histogram
queue wait histogram
time to first byte/header
body download duration
header size
request/response body size
retry count by cause
```

### 37.2 Logs

Log per request:

```text
correlation id / trace id
route / host / authority
method / path template, not raw sensitive URL
actual protocol version
attempt number
failure classification
HTTP status
exception class
stream/connection error if available
deadline remaining at attempt start
response size class
```

### 37.3 Traces

Tracing should show:

```text
client span
server span
retry attempts
gateway hop
queueing if measurable
remote dependency spans
```

But be careful with cardinality:

```text
Do not put raw URL with IDs as metric label.
Do not put huge headers in spans.
Do not record sensitive metadata.
```

---

## 38. Java Client Wrapper Pattern for HTTP/2

A production Java HTTP/2 client should not expose raw `HttpClient` everywhere.

Design a wrapper:

```java
public final class CaseApiClient {
    private final HttpClient httpClient;
    private final URI baseUri;
    private final Semaphore concurrency;

    public CaseApiClient(HttpClient httpClient, URI baseUri, int maxConcurrentLogicalRequests) {
        this.httpClient = Objects.requireNonNull(httpClient);
        this.baseUri = Objects.requireNonNull(baseUri);
        this.concurrency = new Semaphore(maxConcurrentLogicalRequests);
    }

    public CaseDto getCase(String caseId, Duration deadline) throws IOException, InterruptedException {
        if (!concurrency.tryAcquire(deadline.toMillis(), TimeUnit.MILLISECONDS)) {
            throw new TimeoutExceptionLike("Timed out waiting for client bulkhead");
        }

        try {
            HttpRequest request = HttpRequest.newBuilder()
                .uri(baseUri.resolve("/cases/" + URLEncoder.encode(caseId, StandardCharsets.UTF_8)))
                .version(HttpClient.Version.HTTP_2)
                .timeout(deadline)
                .header("Accept", "application/json")
                .GET()
                .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.version() != HttpClient.Version.HTTP_2) {
                // log/metric: fallback happened
            }

            return mapResponse(response);
        } finally {
            concurrency.release();
        }
    }
}
```

This is simplified. In production, add:

```text
structured error mapping
retry budget
idempotency support
trace propagation
metrics
response size limits
safe logging
circuit breaker
rate limiter
configuration per route
```

Important point:

> Even if the library has HTTP/2 stream limits internally, application-level bulkheads are still needed to prevent unbounded memory, queueing, and deadline waste.

---

## 39. HTTP/2 Server-Side Considerations in Java

If your Java service accepts HTTP/2 traffic, think about:

```text
max concurrent streams
initial window size
max header size
max request body size
idle timeout
keepalive policy
TLS/ALPN configuration
request body consumption
slow client defense
response streaming behavior
executor/thread model
backpressure from application to transport
error mapping
GOAWAY during shutdown
```

For Spring Boot/Tomcat/Jetty/Undertow/Netty-based servers, exact configuration differs. The mental model stays the same:

```text
HTTP/2 concurrency is not just server thread count.
It includes stream count, transport window, app worker capacity,
request body size, response body strategy, and downstream dependency capacity.
```

Graceful shutdown matters more with multiplexing because one connection can hold many active streams.

Shutdown sequence should aim for:

```text
stop accepting new requests/streams
drain existing work within deadline
send/allow GOAWAY where supported
cancel over-deadline work
close resources
emit metrics/logs
```

---

## 40. Common Production Failure Patterns

### 40.1 HTTP/2 silently falls back to HTTP/1.1

Symptoms:

```text
expected multiplexing not happening
connection count higher than expected
latency resembles HTTP/1.1 pool behavior
```

Possible causes:

```text
ALPN not negotiated
proxy does not support h2
server not configured for HTTP/2
TLS termination changes upstream protocol
client configured only as preference, not guarantee
```

Fix:

```text
log actual protocol version
verify with curl/nghttp/openssl where allowed
check LB/gateway protocol settings
validate Java runtime and TLS support
```

### 40.2 MAX_CONCURRENT_STREAMS causes hidden queueing

Symptoms:

```text
p99 spikes
server looks healthy
client has many pending futures
requests timeout before server logs them
```

Fix:

```text
measure stream acquisition/pending time
bound app concurrency
open separate channels/routes if appropriate
avoid long-lived streams sharing with short calls
```

### 40.3 Flow-control stall

Symptoms:

```text
connection open
no errors
responses stuck
low CPU
low throughput
some bodies not consumed
```

Fix:

```text
always consume/close response bodies
separate large downloads
inspect client/server flow-control metrics if available
avoid blocking event loops
```

### 40.4 GOAWAY storm during deployment

Symptoms:

```text
many transient failures during rollout
retries spike
latency increases
some calls fail despite healthy new pods
```

Fix:

```text
proper drain period
client retry only safe requests
respect last-stream-id
align LB deregistration delay and server graceful shutdown
avoid all clients reconnecting simultaneously
```

### 40.5 Gateway kills long-lived streams

Symptoms:

```text
gRPC streaming fails after fixed duration
SSE/streaming API closes periodically
RST_STREAM or connection close near timeout boundary
```

Fix:

```text
align gateway idle/max stream timeout
send heartbeat when appropriate
configure keepalive within policy
use streaming-aware route
```

### 40.6 Header too large

Symptoms:

```text
works in local env
fails behind gateway
431/400/protocol error
large JWT/cookie/metadata present
```

Fix:

```text
shrink tokens
avoid forwarding irrelevant cookies
use server-side session/reference IDs
limit trace baggage
configure header size consistently
```

---

## 41. HTTP/2 Decision Matrix

Use HTTP/2 when:

```text
many concurrent small requests to same authority
TLS handshake/connection overhead matters
service-to-service RPC uses gRPC
header compression helps
connection reuse is beneficial
streaming RPC is needed
```

Be careful when:

```text
large downloads share connection with small requests
long-lived streams consume stream slots
middleboxes have uncertain HTTP/2 support
observability cannot distinguish stream vs connection failures
server max concurrent streams is low
flow-control tuning is unknown
```

HTTP/2 does not replace:

```text
timeout engineering
retry safety
bulkheads
rate limiting
message size limits
idempotency
graceful shutdown
observability
capacity planning
```

---

## 42. HTTP/1.1 vs HTTP/2 Comparison

| Dimension | HTTP/1.1 | HTTP/2 |
|---|---|---|
| Wire format | Text | Binary frames |
| Concurrency per connection | Mostly one active response in practice | Many streams |
| Header compression | None by default | HPACK |
| HOL blocking | Application-layer per connection | Reduced at HTTP layer, still TCP HOL |
| Connection pool pressure | Higher | Lower, but stream budget matters |
| Flow control | TCP only | TCP + HTTP/2 stream/connection flow control |
| Failure domain | Usually one request per busy connection | Many streams share one connection |
| Retry signals | Coarser | More protocol-level signals |
| gRPC support | Not native | Required foundation |
| Debuggability | Easier with text tools | Requires protocol-aware tools/logging |

---

## 43. Case Study: Case Search API Under Load

Scenario:

```text
Java service A calls case-search service B.
Both are internal services.
Client uses JDK HttpClient with HTTP_2 preference.
Service B sits behind an ingress.
```

Traffic:

```text
normal: 100 RPS
batch job: 2000 concurrent lookups
payload: small JSON responses
```

Observed:

```text
p50 = 80 ms
p95 = 2.5 s
p99 = 7 s
timeouts = 5 s
service B CPU = 40%
DB CPU = 35%
ingress healthy
client logs many timeout exceptions
server logs fewer requests than client attempts
```

Naive interpretation:

```text
Service B is slow.
```

Better investigation:

```text
Does client actually negotiate HTTP/2?
How many HTTP/2 connections exist?
What is max concurrent streams from ingress/server?
Are requests queued client-side waiting for stream slots?
Is batch traffic sharing client/channel with online traffic?
Are response bodies fully consumed?
Does retry multiply load?
Is deadline spent before server receives request?
```

Possible finding:

```text
Ingress advertises MAX_CONCURRENT_STREAMS = 100.
Client effectively uses one connection per authority.
Batch submits 2000 requests.
Most wait for stream slots.
5s timeout starts at request creation, not at server receipt.
Many requests timeout while queued client-side.
```

Better design:

```text
separate online and batch clients
batch concurrency cap = 100 or tuned value
online bulkhead protected
measure queue wait separately
use deadline-aware retry budget
avoid submitting 2000 unbounded futures
```

Mature conclusion:

> HTTP/2 multiplexing reduced connection overhead, but it did not remove the need for concurrency control.

---

## 44. Case Study: gRPC Streaming Freezes

Scenario:

```text
Java gRPC client opens many bidirectional streaming RPCs.
Each stream transfers chunks.
After some time, streams appear frozen.
No immediate error.
```

Possible causes:

```text
MAX_CONCURRENT_STREAMS reached
manual flow control not requesting more messages
receiver not consuming fast enough
connection-level flow-control exhausted
Netty event loop blocked by application code
gateway idle timeout kills stream
keepalive not configured or too aggressive
large message exceeds limit
```

Diagnostic steps:

```text
count active streams per channel
inspect channel connectivity state
check server max concurrent streams
separate long-lived streams from unary calls
verify event loop is not blocked
check gRPC deadlines and keepalive policy
check proxy/gateway HTTP/2 support
```

Design fix:

```text
use bounded stream count
use multiple channels only when justified
apply manual flow control carefully
chunk large payloads
set deadlines/keepalive within server policy
monitor per-stream progress
```

---

## 45. Practical Debugging Commands and Clues

Depending on environment access, useful tools include:

```bash
curl -v --http2 https://api.example.com/health
```

Look for:

```text
ALPN: server accepted h2
using HTTP/2
```

Check TLS ALPN with OpenSSL:

```bash
openssl s_client -alpn h2 -connect api.example.com:443 </dev/null
```

Check Java actual protocol:

```java
System.out.println(response.version());
```

Check ingress/LB logs for:

```text
protocol version
upstream protocol
request duration
response duration
reset reason
connection termination reason
```

Check application metrics for:

```text
active requests
pending requests
client-side timeout before server log
connection count
retry attempts
body size
```

For gRPC, use runtime/library-specific debugging carefully. Avoid enabling verbose frame logs in high-volume production unless scoped, because it can expose metadata and generate huge logs.

---

## 46. Anti-Patterns

### Anti-pattern 1: “HTTP/2 means no connection tuning”

Wrong. You still tune:

```text
connection count
stream count
flow control
idle timeout
keepalive
traffic isolation
```

### Anti-pattern 2: “One shared client for all traffic”

A single shared client is good for reuse, but not all traffic has the same shape.

Separate when needed:

```text
small online requests
large downloads
long-lived streams
batch workloads
admin/reporting traffic
```

### Anti-pattern 3: “Unbounded async requests because multiplexing”

HTTP/2 multiplexing is not a license for unbounded futures.

### Anti-pattern 4: “Ignore actual negotiated protocol”

Your configuration may prefer HTTP/2 but actual traffic may be HTTP/1.1.

### Anti-pattern 5: “Retry all stream resets”

Some resets are safe to retry; others can duplicate side effects.

### Anti-pattern 6: “Large JWT/cookie/metadata everywhere”

HTTP/2 compresses headers, but huge metadata still causes memory, security, and compatibility problems.

### Anti-pattern 7: “Block Netty event loop”

For Netty-based HTTP/2/gRPC stacks, blocking event loop threads can freeze many streams.

---

## 47. Design Checklist

Before adopting HTTP/2 for a Java service-to-service path, answer:

```text
1. Is HTTP/2 negotiated end-to-end or only on one hop?
2. What is max concurrent streams per connection?
3. Does the client open one or multiple connections per authority?
4. How are long-lived streams isolated from short requests?
5. What are idle timeout and max connection age at every hop?
6. Are response bodies always consumed/closed/cancelled?
7. What is max header size and metadata policy?
8. What is max request/response body size?
9. Are retries protocol-aware and idempotency-aware?
10. Are deadlines propagated?
11. Are flow-control stalls observable?
12. Are GOAWAY and RST_STREAM logged/classified?
13. Does graceful shutdown drain streams?
14. Are keepalive intervals accepted by server/gateway policy?
15. Are metrics tagged by actual protocol version?
```

---

## 48. Exercises

### Exercise 1 — Protocol Verification

Write a small Java program using JDK `HttpClient` that:

1. requests HTTP/2,
2. sends a GET request,
3. prints actual response protocol version,
4. prints status code,
5. measures total duration.

Then test against:

```text
one HTTP/2-capable endpoint
one HTTP/1.1-only endpoint
one endpoint behind your corporate/proxy path, if available
```

Observe whether preference equals reality.

### Exercise 2 — Bounded Concurrency

Create a batch client that fetches 1000 URLs.

Implement three versions:

```text
unbounded CompletableFuture
bounded semaphore + CompletableFuture
virtual threads + semaphore
```

Measure:

```text
total duration
p95 request duration
timeout count
memory usage
actual protocol version
```

Explain why bounded concurrency may outperform unbounded concurrency under load.

### Exercise 3 — Body Consumption

Create an endpoint that returns a large response.

Test client behavior:

```text
fully consume body
partially read body and close
partially read body and leak
```

Observe connection reuse and memory behavior.

### Exercise 4 — Header Size

Create requests with increasingly large headers.

Observe where failure occurs:

```text
client
proxy
gateway
server
```

Document the actual limit per hop.

### Exercise 5 — gRPC Mapping

For a unary gRPC call, map:

```text
metadata -> HTTP/2 headers
request message -> DATA frames
response message -> DATA frames
status -> trailers
cancellation -> stream reset behavior
```

Explain how this differs from a JSON REST response.

---

## 49. Key Takeaways

1. HTTP/2 is a binary framed protocol that preserves HTTP semantics while changing transport behavior.
2. A single HTTP/2 connection can carry many logical streams.
3. Multiplexing reduces HTTP/1.1 connection pressure but creates shared-fate connection behavior.
4. HTTP/2 removes HTTP-layer head-of-line blocking but not TCP-level head-of-line blocking.
5. `MAX_CONCURRENT_STREAMS` is a hidden concurrency limit and can cause client-side queueing.
6. Flow control exists at both stream and connection level.
7. Not consuming response bodies can stall streams, reduce reuse, or exhaust resources.
8. HPACK compresses headers but makes header handling stateful and does not remove header-size discipline.
9. ALPN determines whether HTTPS uses HTTP/2 in practice.
10. Java `HttpClient` can prefer HTTP/2, but you must inspect actual response version.
11. gRPC is deeply tied to HTTP/2 streams, metadata, DATA frames, trailers, PING, and flow control.
12. HTTP/2 requires observability at stream, connection, and hop level.
13. Production HTTP/2 design still needs timeout, retry, bulkhead, rate limit, graceful shutdown, and security controls.

---

## 50. How This Prepares the Next Part

Part 8 showed why HTTP/1.1 connection management dominates many production problems.

Part 9 showed how HTTP/2 changes the model:

```text
from connection-per-concurrent-work
  to stream multiplexing over fewer connections
```

But HTTP/2 also leaves one major issue unresolved:

```text
TCP-level head-of-line blocking
```

That leads naturally to the next part:

```text
Part 10 — HTTP/3 and QUIC for Java Engineers: What Changes, What Does Not
```

There we will examine why QUIC exists, what changes when HTTP runs over UDP + QUIC instead of TCP + TLS, what Java engineers should care about, and what remains the same: deadlines, retries, flow control, observability, and operational discipline.

---

## 51. References

- RFC 9113 — HTTP/2.
- RFC 9110 — HTTP Semantics.
- RFC 7541 — HPACK: Header Compression for HTTP/2.
- Oracle Java SE 25 documentation — `java.net.http.HttpClient`.
- gRPC Java documentation and repository notes on Netty-based HTTP/2 transport.
- gRPC keepalive and performance guidance.
- OpenTelemetry documentation for distributed tracing concepts and Java instrumentation.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 8 — HTTP/1.1 Deep Dive: Connections, Pipelining, Chunking, Keep-Alive, and Head-of-Line Blocking](./008-http11-deep-dive-connections-pipelining-chunking-keepalive-head-of-line-blocking.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 10 — HTTP/3 and QUIC for Java Engineers: What Changes, What Does Not](./010-http3-quic-for-java-engineers-what-changes-what-does-not.md)
