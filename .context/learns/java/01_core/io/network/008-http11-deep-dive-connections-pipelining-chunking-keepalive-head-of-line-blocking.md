# Part 8 — HTTP/1.1 Deep Dive: Connections, Pipelining, Chunking, Keep-Alive, and Head-of-Line Blocking

Series: `learn-java-io-network-http-grpc-protocol-engineering`  
File: `008-http11-deep-dive-connections-pipelining-chunking-keepalive-head-of-line-blocking.md`  
Target Java: 8–25  
Level: Advanced / Production Engineering

---

## 0. Why This Part Exists

Most Java engineers use HTTP every day, but many production incidents happen because engineers treat HTTP/1.1 as if it were only this:

```text
request -> response
```

That is too simple.

A real HTTP/1.1 call is closer to this:

```text
application code
  -> HTTP client abstraction
  -> request serialization
  -> connection pool acquisition
  -> DNS, TCP connect, optional TLS handshake
  -> HTTP/1.1 request bytes
  -> proxy / gateway / load balancer / service mesh
  -> origin server parser
  -> response framing
  -> connection reuse decision
  -> body consumption / discard / close
  -> pool return or socket close
```

HTTP/1.1 is old, simple-looking, and extremely durable. That durability is also why it appears in many hidden places: browser to gateway, service to gateway, gateway to backend, load balancer to application server, proxy to upstream, internal Java clients, legacy services, health checks, file downloads, callbacks, and external API integrations.

The goal of this part is not to memorize protocol trivia. The goal is to understand why production symptoms such as these happen:

```text
java.net.SocketTimeoutException: Read timed out
java.net.ConnectException: Connection refused
java.io.EOFException
Connection reset by peer
Premature EOF
Broken pipe
PoolTimeoutException / pending acquire timeout
HTTP 400 from gateway but backend logs nothing
HTTP 502/503/504 from reverse proxy
Slow p99 despite low backend CPU
Requests stuck although thread dump looks normal
One user receives another user's response-like behavior after proxy chain bug
```

Many of those are not “business bugs”. They are consequences of HTTP/1.1 message framing, connection reuse, connection lifecycle, proxy behavior, timeout mismatch, or client pool pressure.

---

## 1. What You Should Already Know

This part assumes you already understand:

- TCP is a byte stream, not a message protocol.
- HTTP semantics: methods, status codes, headers, representation, idempotency.
- Java socket basics.
- Java HTTP client usage at API level.
- Basic TLS concept.
- Basic timeout and retry concept.

We will not repeat how to create a simple Java REST endpoint or how to call an HTTP URL with a basic client. The focus is the runtime behavior underneath.

---

## 2. HTTP/1.1 Mental Model

HTTP/1.1 is a textual application protocol layered on top of a reliable byte stream, usually TCP.

The core unit is not just a request. The core runtime unit is:

```text
connection carrying a sequence of request/response exchanges
```

A single TCP connection may carry one request/response pair:

```text
TCP connection
  request A
  response A
close
```

Or many sequential pairs:

```text
TCP connection
  request A
  response A
  request B
  response B
  request C
  response C
close later
```

That second model is persistent connection / keep-alive.

This matters because HTTP/1.1 correctness depends on both peers agreeing where each message starts and ends. If either side miscalculates the body length, leaves unread bytes on the connection, sends illegal body data, or interprets `Content-Length` and `Transfer-Encoding` differently, the next request on that reused connection can be corrupted.

A top-tier Java engineer thinks:

```text
HTTP/1.1 is not just stateless requests.
It is stateless semantics carried over stateful connections.
```

That sentence explains a large number of real-world bugs.

---

## 3. HTTP/1.1 Message Shape

An HTTP/1.1 request has this broad structure:

```http
POST /cases/123/comments HTTP/1.1

Host: api.internal.example

Content-Type: application/json

Content-Length: 27



{"message":"Need review"}
```

At the byte level, HTTP/1.1 is stricter than it looks:

```text
start line
header field lines
empty line
optional body
```

The empty line separates metadata from body.

The most important framing question is:

```text
How does the receiver know where this HTTP message body ends?
```

There are several possibilities:

1. There is no body by method/status semantics.
2. `Content-Length` declares the exact byte length.
3. `Transfer-Encoding: chunked` frames the body into chunks.
4. The connection close marks the end of the response body in some cases.

For production systems, the dangerous part is not the happy path. The dangerous part is when front proxy, backend server, gateway, WAF, and Java client disagree on framing.

---

## 4. Request Line and Status Line

Request line:

```http
GET /applications?status=PENDING HTTP/1.1
```

It contains:

```text
method SP request-target SP HTTP-version
```

Response status line:

```http
HTTP/1.1 200 OK
```

It contains:

```text
HTTP-version SP status-code SP reason-phrase
```

The reason phrase is not where machines should derive meaning. Machines should use the numeric status code and structured body/error code.

Advanced point: in HTTP/1.1, proxies often parse, normalize, rewrite, or reject request targets differently. This matters for:

- absolute-form request target through proxies
- origin-form request target to origin servers
- encoded path segments
- duplicate slashes
- dot segments
- percent encoding
- semicolon path parameters
- ambiguous authority/Host handling

Security-sensitive systems should treat URL parsing as a boundary concern, not only a routing concern.

---

## 5. Headers Are Not Just Metadata

Headers can affect:

- routing
- authentication
- authorization
- caching
- compression
- connection lifecycle
- body framing
- observability
- retry behavior
- rate limiting
- proxy behavior
- security decisions

Examples:

```http
Host: api.example.com
Content-Type: application/json
Accept: application/json
Content-Length: 1234
Transfer-Encoding: chunked
Connection: close
Authorization: Bearer ...
X-Request-Id: ...
Traceparent: ...
Forwarded: proto=https;host=api.example.com
X-Forwarded-For: ...
Retry-After: 30
```

A weak HTTP implementation treats headers as a `Map<String, String>`.

A robust HTTP implementation knows that headers have different categories:

```text
end-to-end headers
hop-by-hop headers
representation headers
routing headers
security headers
observability headers
framing headers
```

The most dangerous category is framing headers, especially:

```text
Content-Length
Transfer-Encoding
Connection
```

These determine how bytes are interpreted on a persistent connection.

---

## 6. Hop-by-Hop vs End-to-End Headers

A key HTTP/1.1 concept: not all headers are meant to travel all the way from client to final server.

End-to-end headers describe the message or representation and are forwarded unless specifically removed or transformed.

Hop-by-hop headers apply only to a single transport-level connection between two adjacent nodes.

Common hop-by-hop examples:

```text
Connection
Keep-Alive
Proxy-Authenticate
Proxy-Authorization
TE
Trailer
Transfer-Encoding
Upgrade
```

Why this matters:

```text
client -> proxy -> gateway -> backend
```

Each arrow is a separate HTTP hop. The `Connection` header from client to proxy must not blindly control proxy-to-backend behavior. A proxy must understand and remove hop-by-hop headers appropriately.

Bad proxy behavior can cause:

- connection reuse corruption
- request smuggling
- ignored authentication expectations
- broken upgrade behavior
- unexpected close/reuse decisions

For Java engineers building gateway adapters, reverse proxies, custom filters, or API aggregators, this distinction is critical.

---

## 7. Persistent Connections: The Default That Changes Everything

HTTP/1.0 commonly required explicit keep-alive. HTTP/1.1 made persistent connections the default unless closed.

Conceptually:

```text
without persistence:
  request -> TCP connect -> TLS handshake -> response -> close

with persistence:
  TCP connect -> TLS handshake
  request -> response
  request -> response
  request -> response
  close later
```

Benefits:

- fewer TCP handshakes
- fewer TLS handshakes
- lower latency
- less CPU
- less ephemeral port churn
- better throughput

Costs:

- connections become stateful resources
- stale connection risk
- idle timeout mismatch
- pool saturation
- connection leak risk
- cross-request contamination if framing is broken
- head-of-line blocking per connection

Persistent connection is why connection pools matter.

---

## 8. Java HTTP Clients and Connection Reuse

### 8.1 JDK `HttpClient`

Modern `java.net.http.HttpClient` instances are immutable after construction and can be reused for multiple requests. The JDK documentation notes that an `HttpClient` provides configuration and resource sharing for requests, and client instances typically manage their own connection pools. This means creating a new client per request usually prevents effective reuse.

Good pattern:

```java
public final class CaseApiClient {
    private final HttpClient httpClient;
    private final URI baseUri;

    public CaseApiClient(URI baseUri) {
        this.baseUri = baseUri;
        this.httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(2))
                .build();
    }

    public HttpResponse<String> getCase(String caseId) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(baseUri.resolve("/cases/" + URLEncoder.encode(caseId, StandardCharsets.UTF_8)))
                .timeout(Duration.ofSeconds(5))
                .GET()
                .header("Accept", "application/json")
                .build();

        return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
```

Weak pattern:

```java
public String call(String url) throws Exception {
    HttpClient client = HttpClient.newHttpClient(); // repeated per call
    HttpRequest request = HttpRequest.newBuilder(URI.create(url)).build();
    return client.send(request, HttpResponse.BodyHandlers.ofString()).body();
}
```

Why weak?

- no stable pool
- more handshakes
- more latency
- more socket churn
- harder configuration consistency
- harder observability

### 8.2 Apache HttpClient / OkHttp / Netty

Different Java HTTP clients expose pooling differently, but the same invariant applies:

```text
reuse the client / connection manager / event loop resource intentionally
```

Avoid hiding client creation in low-level methods.

Good ownership model:

```text
application startup creates client resources
application runtime uses them
application shutdown closes them
```

Bad ownership model:

```text
every business method creates a new network runtime
```

---

## 9. Connection Pool Is Not Just an Optimization

Connection pool is a control surface.

It determines:

- maximum concurrent connections
- maximum concurrent requests for HTTP/1.1, usually roughly bounded by connections per route
- queueing when all connections are busy
- idle connection lifetime
- stale connection behavior
- retry interaction
- failure amplification during dependency slowness

A connection pool protects both sides if configured correctly.

But if configured incorrectly, it creates hidden failure modes.

### 9.1 Pool Exhaustion

Scenario:

```text
max connections to dependency = 50
request timeout = 30s
dependency latency spikes to 20s
incoming application calls = 500 concurrent
```

What happens?

```text
50 requests occupy sockets
450 wait for pool acquisition or application thread
latency explodes before backend CPU looks high
retries may create even more waiting
caller sees timeout, not always connection error
```

Symptoms:

```text
pending connection acquisition rising
p99 latency rising
outbound active connections at max
thread pool busy but CPU low
many requests waiting on client internals
```

Better thinking:

```text
pool size is a concurrency budget, not just a performance knob
```

### 9.2 Pool Too Large

Too large is not automatically better.

Consequences:

- overloads downstream
- more file descriptors
- more memory
- more TLS sessions
- more queueing downstream
- more context switching
- more retry storm capacity
- can hide missing backpressure

A top-tier engineer does not ask only:

```text
How big should the pool be?
```

They ask:

```text
How many concurrent in-flight calls can this dependency safely handle?
What latency target do we protect?
Where should excess demand wait, degrade, or fail fast?
```

---

## 10. HTTP/1.1 Head-of-Line Blocking

HTTP/1.1 persistent connection is sequential by default.

On one connection:

```text
request A -> response A -> request B -> response B -> request C -> response C
```

If response A is slow, B and C behind it cannot complete on that same connection.

This is head-of-line blocking at the HTTP/1.1 connection level.

Example:

```text
connection 1:
  request A: report export, 8 seconds
  request B: small lookup, 20 ms
  request C: small lookup, 25 ms
```

Actual completion on same connection:

```text
A completes at 8s
B completes after A
C completes after B
```

This is one reason HTTP/1.1 clients use multiple connections per route.

```text
pool with 10 connections can run ~10 concurrent request/response exchanges to same route
```

But note: increasing connections is a workaround with cost, not magic.

HTTP/2 addresses this differently by multiplexing multiple streams over one connection, but HTTP/2 introduces its own flow control and connection-level failure modes. That comes in Part 9.

---

## 11. HTTP/1.1 Pipelining

HTTP/1.1 pipelining allows a client to send multiple requests on the same connection without waiting for each response:

```text
client sends:
  request A
  request B
  request C

server must respond in order:
  response A
  response B
  response C
```

In theory, pipelining reduces latency.

In practice, it is rarely used in general-purpose clients because:

- responses must be returned in order
- head-of-line blocking remains
- many intermediaries historically handled it poorly
- error recovery is tricky
- idempotency matters if connection closes mid-pipeline
- response boundary corruption affects multiple requests

Mental model:

```text
HTTP/1.1 pipelining improves request send latency but not response ordering constraints.
```

Most production Java systems should not depend on HTTP/1.1 pipelining. Use normal pooled connections, HTTP/2 multiplexing, or gRPC depending on the use case.

---

## 12. `Content-Length`: Exact Byte Count Contract

`Content-Length` declares the size of the message body in bytes.

Example:

```http
POST /comments HTTP/1.1
Host: api.example.com
Content-Type: application/json
Content-Length: 17

{"hello":"world"}
```

Important: it is bytes, not Java `String.length()` characters.

This matters with Unicode:

```java
String body = "{\"name\":\"Fajar 🚀\"}";
int chars = body.length();
int bytes = body.getBytes(StandardCharsets.UTF_8).length;
```

`chars` and `bytes` can differ.

Most Java HTTP libraries handle `Content-Length` automatically if you use their body abstractions correctly. Problems happen when engineers manually build raw HTTP, custom proxies, low-level Netty handlers, test harnesses, or gateway filters.

### 12.1 If `Content-Length` Is Too Small

Receiver reads only declared bytes. Extra bytes remain in the connection and may be interpreted as the beginning of the next HTTP message.

```text
body actual: 100 bytes
Content-Length: 80

20 bytes remain unread
next request on reused connection starts corrupted
```

### 12.2 If `Content-Length` Is Too Large

Receiver waits for more bytes that never arrive.

```text
body actual: 80 bytes
Content-Length: 100

receiver waits for 20 more bytes
read timeout
connection close
```

### 12.3 Production Symptoms

```text
random 400 from backend
request timeout during upload
proxy 502/504
backend parser error
connection not reusable
client sees EOFException
```

---

## 13. `Transfer-Encoding: chunked`

Chunked transfer coding lets a sender stream a body whose final size is not known upfront.

Conceptually:

```http
HTTP/1.1 200 OK
Transfer-Encoding: chunked
Content-Type: application/json

4

Wiki

5

pedia

0



```

Each chunk has:

```text
chunk-size CRLF
chunk-data CRLF
```

The zero-size chunk marks the end.

Why chunked matters:

- streaming response without precomputing length
- large downloads
- server-generated streaming
- proxying unknown-size upstream body
- preserving persistent connection even when content size is unknown

Without `Content-Length` or chunked framing, a response may need connection close to indicate end-of-body, which prevents connection reuse.

### 13.1 Chunked Is Transfer Framing, Not Application Framing

Chunk boundaries are not application message boundaries.

Do not assume:

```text
one chunk == one JSON object
one chunk == one event
one chunk == one domain message
```

Chunking is a transport-level HTTP/1.1 framing mechanism. Application-level streaming needs its own framing, such as:

```text
newline-delimited JSON
SSE event format
multipart boundary
length-prefixed application frames
```

### 13.2 Chunked and Proxies

Intermediaries may:

- dechunk and forward with `Content-Length`
- rechunk
- buffer chunks
- reject trailers
- transform transfer encoding
- close connection on protocol violation

Therefore chunking is not a reliable signal of delivery granularity to application clients.

---

## 14. `Content-Length` vs `Transfer-Encoding`

This is one of the most security-sensitive areas of HTTP/1.1.

A message should not create ambiguity about where the body ends.

Dangerous request:

```http
POST / HTTP/1.1
Host: example.com
Content-Length: 4
Transfer-Encoding: chunked

0

GARBAGE
```

If a front proxy prioritizes `Content-Length` while the backend prioritizes `Transfer-Encoding`, they may disagree about which bytes belong to which request.

That class of disagreement is the foundation of request smuggling.

Mental model:

```text
HTTP request smuggling is often a parser disagreement across hops.
```

Proxy chain:

```text
attacker/client
  -> front proxy parser
  -> backend parser
```

If parser A and parser B disagree on message boundaries, an attacker may cause hidden bytes to be interpreted as a separate backend request.

For Java engineers, this matters when building:

- reverse proxies
- API gateways
- request filters
- custom Netty HTTP handlers
- servlet filters that inspect body
- service mesh adjacent components
- security middleware
- file upload endpoints
- webhook receivers

Defensive principle:

```text
Never allow ambiguous framing through a trust boundary.
```

---

## 15. Request Smuggling: Engineering-Level Understanding

Request smuggling is not merely a penetration testing trick. It is a consequence of inconsistent HTTP parsing.

Classic variants:

```text
CL.TE: front uses Content-Length, backend uses Transfer-Encoding
TE.CL: front uses Transfer-Encoding, backend uses Content-Length
TE.TE: both support Transfer-Encoding but parse it differently
```

Simplified picture:

```text
client sends one byte stream
front proxy sees request A only
backend sees request A + hidden request B
```

Potential impact:

- bypassing access control
- cache poisoning
- request queue poisoning
- credential/session confusion
- response desynchronization
- WAF bypass

Production-grade mitigations:

- strict RFC-compliant parsing
- reject ambiguous `Content-Length` / `Transfer-Encoding`
- normalize at the edge
- do not forward hop-by-hop headers blindly
- avoid custom HTTP parsing unless absolutely necessary
- keep proxies and HTTP libraries patched
- test proxy/backend combinations, not just backend alone
- terminate and re-emit sanitized HTTP when crossing trust boundaries

Important: do not treat internal HTTP as safe by default. Internal proxies can still have parser discrepancies.

---

## 16. Message Body Consumption and Connection Reuse

A connection can be safely reused only if the client and server agree that the current response has been fully consumed or safely discarded.

Example problem:

```java
HttpResponse<InputStream> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofInputStream()
);

if (response.statusCode() == 404) {
    return Optional.empty(); // body stream not consumed or closed
}
```

Depending on client implementation, failing to consume/close the body can prevent connection reuse or leak a connection until garbage collection or timeout.

Better:

```java
HttpResponse<InputStream> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofInputStream()
);

try (InputStream body = response.body()) {
    if (response.statusCode() == 404) {
        body.transferTo(OutputStream.nullOutputStream()); // or close/discard according to client rules
        return Optional.empty();
    }
    // parse body
}
```

For large bodies, do not blindly buffer just to reuse a connection. You need a policy:

```text
small error body -> consume/discard
large unexpected body -> close connection
streaming body -> explicit close/cancel handling
```

The invariant:

```text
Response body lifecycle controls connection lifecycle.
```

---

## 17. Connection Close as a Framing Signal

Some HTTP/1.1 responses use connection close to delimit the body.

Example:

```http
HTTP/1.1 200 OK
Content-Type: text/plain

body continues until server closes TCP connection
```

This is valid in some cases but poor for reusable connections.

Problems:

- client cannot know body end until close
- connection cannot be reused
- premature close is hard to distinguish from normal end if no length/checksum
- proxy buffering behavior can change
- large responses become harder to reason about

Prefer explicit framing:

```text
Content-Length for known-size body
Transfer-Encoding: chunked for unknown-size streaming body
```

---

## 18. Keep-Alive: Three Different Meanings

Engineers often confuse three different things:

### 18.1 HTTP Persistent Connection

This means reuse the HTTP/TCP connection for multiple request/response exchanges.

```text
HTTP/1.1 default unless Connection: close
```

### 18.2 TCP Keepalive

This is OS-level probing of idle TCP connections to detect dead peers.

```text
SO_KEEPALIVE
```

Often too slow by default for application-level failure detection.

### 18.3 Application Keepalive / Heartbeat

This is an application or protocol-level ping/heartbeat.

Examples:

```text
WebSocket ping/pong
gRPC HTTP/2 keepalive ping
custom heartbeat message
```

Do not mix them.

Production rule:

```text
HTTP keep-alive optimizes reuse.
TCP keepalive detects dead idle connections slowly.
Application keepalive checks protocol/session liveness.
```

---

## 19. Idle Timeout Mismatch

One of the most common HTTP/1.1 production bugs:

```text
client pool idle timeout: 5 minutes
load balancer idle timeout: 60 seconds
server idle timeout: 75 seconds
```

Timeline:

```text
T+0s: client completes request, returns connection to pool
T+60s: load balancer silently closes idle connection
T+90s: client reuses pooled connection
T+90s: write/read fails: reset, EOF, broken pipe, no response
```

Symptoms:

```text
first request after idle fails
random low-frequency failures
retries hide the issue but add latency
backend logs may show nothing
```

Mitigations:

- set client idle TTL lower than LB/server idle timeout
- validate connection before reuse if supported
- retry safe/idempotent requests once on stale connection failure
- monitor connection reuse failures
- align timeouts across client, proxy, LB, server

Good relationship:

```text
client idle eviction < load balancer idle timeout < server hard close, when possible
```

But exact values depend on platform.

---

## 20. Timeout Taxonomy for HTTP/1.1

HTTP/1.1 call timeout is not one thing.

Path:

```text
pool acquire
DNS lookup
TCP connect
TLS handshake
request write
server processing / first byte wait
response body read
connection return / close
```

Timeout types:

```text
pool acquisition timeout
DNS timeout / resolver behavior
connect timeout
TLS handshake timeout
write timeout
response header timeout
read timeout / socket timeout
request timeout
overall deadline
idle timeout
```

A high-level request timeout can hide which phase failed.

Production-quality client wrapper should record phase-level information when possible.

Example metrics:

```text
http.client.pool.pending
http.client.pool.active
http.client.pool.idle
http.client.connect.duration
http.client.tls.handshake.duration
http.client.request.write.duration
http.client.response.headers.duration
http.client.response.body.duration
http.client.failures{phase="connect"}
http.client.failures{phase="read"}
http.client.failures{phase="pool_acquire"}
```

---

## 21. Slowloris and Slow Body Attacks

HTTP/1.1 servers are vulnerable to slow clients if not protected.

Slow request header attack:

```text
client sends headers extremely slowly
server keeps connection/thread/buffer open
```

Slow body attack:

```text
client declares Content-Length: 1GB
then sends bytes very slowly
```

Slow response consumer:

```text
server produces response
client reads extremely slowly
server buffers or blocks writes
```

Mitigations:

- header read timeout
- request body read timeout
- max header size
- max body size
- min data rate / upload timeout
- connection limit per source
- bounded request queue
- streaming with backpressure
- reverse proxy protection

Java application servers and gateways often expose these as connector settings, not business code settings.

Top-tier engineers know to ask infra/runtime teams:

```text
What are our max header size, max body size, request header timeout, idle timeout, and upload timeout?
```

---

## 22. HTTP/1.1 Server Threading Models

Common server models:

```text
thread-per-connection
thread-per-request
selector/event-loop acceptor + worker pool
virtual-thread-per-request
reactive/event-loop
```

The HTTP/1.1 protocol itself does not dictate the server threading model.

But the model affects failure behavior.

### 22.1 Blocking Thread-Per-Request

Simple mental model:

```text
one request occupies one worker thread while processing
```

Good:

- simple stack traces
- easier debugging
- fits blocking Java code

Risks:

- thread pool exhaustion
- slow downstream calls tie up workers
- slow request body upload can tie resources

### 22.2 Event Loop

Good:

- high connection scalability
- efficient for many idle connections

Risks:

- blocking in event loop damages many connections
- harder debugging
- backpressure must be explicit

### 22.3 Virtual Threads

Java virtual threads make blocking-style code scalable in terms of Java thread count.

But they do not remove:

```text
socket limits
connection pool limits
remote service capacity
payload memory pressure
kernel buffers
rate limits
LB idle timeout
protocol HOL blocking
```

Good virtual-thread design still needs bounded concurrency and deadlines.

---

## 23. HTTP/1.1 and TLS

HTTPS is HTTP over TLS over TCP.

```text
HTTP/1.1 message
  inside TLS record stream
    over TCP byte stream
```

TLS affects:

- connection establishment latency
- certificate validation failure modes
- SNI routing
- ALPN negotiation, especially when HTTP/2 is possible
- session resumption
- mTLS client certificate lifecycle
- observability, because payload is encrypted on the wire

For HTTP/1.1 keep-alive, TLS handshake cost is a strong reason to reuse connections.

Without reuse:

```text
for every request:
  TCP handshake
  TLS handshake
  HTTP request
  HTTP response
  close
```

With reuse:

```text
one TCP/TLS setup
many HTTP request/response exchanges
```

This is why poor connection reuse can show up as both latency and CPU cost.

---

## 24. Proxies and Load Balancers in HTTP/1.1

Real path:

```text
Java client
  -> corporate proxy / sidecar / egress gateway
  -> API gateway
  -> load balancer
  -> ingress
  -> application server
```

Each hop may have its own:

- connection pool
- idle timeout
- max header size
- max body size
- buffering policy
- retry policy
- protocol version
- TLS termination
- request parser
- compression behavior
- access log

This means one logical request can be many physical HTTP exchanges.

Example:

```text
client uses HTTPS HTTP/1.1 to API gateway
gateway uses HTTP/1.1 plaintext to backend
gateway has its own upstream pool
backend sees gateway IP, not original client
```

Failure interpretation changes:

```text
502: proxy/gateway received invalid response from upstream or upstream closed unexpectedly
503: upstream unavailable / no healthy target / overloaded
504: gateway timeout waiting for upstream
```

Do not debug only the Java application. Debug the hop chain.

---

## 25. `Expect: 100-continue`

For large request bodies, a client may send headers first and wait for server approval before sending the body.

Example:

```http
POST /upload HTTP/1.1
Host: api.example.com
Content-Length: 500000000
Expect: 100-continue

```

Server can respond:

```http
HTTP/1.1 100 Continue
```

Then client sends the body.

Why it exists:

- avoid uploading huge body if server will reject due to auth, quota, method, content type, etc.

Failure/trade-off:

- adds round trip
- proxy support can be inconsistent
- some servers mishandle it
- client may wait and then send anyway after timeout

Use it intentionally for large uploads, not blindly for every request.

---

## 26. Compression in HTTP/1.1

Two categories are commonly confused:

### 26.1 Representation Compression

```http
Content-Encoding: gzip
```

Means the representation body is compressed.

### 26.2 Transfer Coding

```http
Transfer-Encoding: chunked
```

Means the message transfer is framed/encoded for transport.

Do not confuse:

```text
Content-Encoding describes representation coding.
Transfer-Encoding describes transfer/message framing coding.
```

Compression trade-offs:

- reduces bandwidth
- increases CPU
- may increase latency for small payloads
- can create decompression bomb risk
- can interact with streaming and buffering
- can leak information in certain compression side-channel scenarios

Production policy:

```text
compress large textual responses
avoid compression for tiny payloads
set decompressed size limits
measure CPU and latency
be careful with secrets in compressed responses exposed to attacker-controlled input
```

---

## 27. Large Upload/Download over HTTP/1.1

Large payloads stress the entire stack.

Problems:

- heap pressure if buffered
- direct buffer pressure
- slow client/server
- proxy buffering
- timeout during long body transfer
- partial upload ambiguity
- retry duplicates
- checksum mismatch
- antivirus/scanning delay
- object storage handoff

A robust large transfer design includes:

```text
streaming body
explicit content length when known
max upload size
checksum/hash
idempotency key
resume/range strategy where needed
temp file policy
cleanup job
deadline policy
progress metrics
body read/write timeout
connection close/cancel behavior
```

Bad pattern:

```java
byte[] data = inputStream.readAllBytes();
send(data);
```

Better pattern:

```text
stream from source to HTTP body with bounded buffers
record byte count
verify checksum
close/cancel explicitly on failure
```

---

## 28. HTTP/1.1 Observability

A serious Java HTTP client/server should expose more than status code counts.

### 28.1 Client Metrics

```text
request count by method/host/status
latency histogram by route/dependency
pool active/idle/pending/max
connect duration
TLS handshake duration
request body bytes sent
response body bytes received
failure count by exception class and phase
retry count
timeout count by timeout type
connection reuse ratio
stale connection failure count
```

### 28.2 Server Metrics

```text
active connections
active requests
request queue length
worker pool active/queued/rejected
request header read time
request body read time
response write time
status count
response size
request size
client abort count
slow request count
max header/body rejection count
```

### 28.3 Logs

Good HTTP log fields:

```text
correlation_id
trace_id
method
scheme
host
path_template, not raw full path when sensitive
status
duration_ms
request_bytes
response_bytes
upstream_host
upstream_status
upstream_duration_ms
retry_attempt
error_phase
exception_class
connection_reused if available
user/tenant/case id only if safe and compliant
```

Avoid logging:

```text
Authorization
Cookie
Set-Cookie
PII payload
full query strings containing secrets
raw uploaded documents
```

---

## 29. Java API Patterns for Safer HTTP/1.1 Clients

### 29.1 Centralized Client Wrapper

Do not scatter raw HTTP calls across codebase.

Better:

```text
Domain service
  -> typed client interface
  -> resilience wrapper
  -> HTTP transport adapter
  -> underlying HTTP client
```

Example interface:

```java
public interface CaseRegistryClient {
    CaseSnapshot getCase(String caseId, Deadline deadline);
    SubmissionReceipt submitEvidence(String caseId, EvidenceUpload upload, Deadline deadline);
}
```

Transport adapter handles:

- URI construction
- headers
- auth
- idempotency key
- deadline to timeout mapping
- error mapping
- metrics
- tracing
- body lifecycle
- retry policy

### 29.2 Explicit Deadline

Instead of only:

```java
client.getCase(caseId);
```

Prefer:

```java
client.getCase(caseId, Deadline.after(Duration.ofSeconds(3)));
```

Then internal phases consume the budget.

```text
pool acquire: max 100 ms
connect: max 500 ms
request/response: remaining budget
retry: only if budget remains
```

### 29.3 Typed Error Mapping

Do not leak raw HTTP status everywhere.

```java
sealed interface CaseRegistryError permits NotFound, Conflict, RateLimited, Unavailable, InvalidResponse {}
```

Mapping example:

```text
404 -> domain not found if endpoint contract says so
409 -> conflict requiring caller decision
412 -> precondition failed / stale version
429 -> rate limited; maybe retry after
502/503/504 -> dependency unavailable
malformed JSON with 200 -> invalid dependency response
EOF before complete body -> transport/protocol failure
```

---

## 30. Retry Rules Specific to HTTP/1.1

Retrying HTTP/1.1 requests requires understanding method semantics and body replayability.

Safer to retry automatically:

```text
GET
HEAD
OPTIONS
idempotent PUT/DELETE if contract supports it
POST with idempotency key and server duplicate suppression
```

Dangerous to retry blindly:

```text
POST payment/submit/create without idempotency key
large streaming upload after unknown partial acceptance
non-repeatable request body
requests with external side effects
```

HTTP/1.1 transport failures are ambiguous:

```text
client wrote request
connection reset before response
```

Question:

```text
Did server receive and process it?
```

Sometimes unknown.

Therefore retry policy needs:

- method semantics
- idempotency key
- request body replayability
- deadline budget
- retry budget
- jitter/backoff
- response status rules
- transport exception rules

---

## 31. Body Replayability

Some request bodies can be sent again:

```text
small byte array
string body
file with seekable source
object storage reference
```

Some cannot easily be sent again:

```text
live input stream
one-time encrypted stream
stream from user upload still in progress
generator with side effects
```

Retry logic must know this.

Bad abstraction:

```java
void post(InputStream body);
```

Better abstraction:

```java
interface RepeatableBody {
    long contentLength();
    InputStream openStream() throws IOException;
}
```

Or explicitly:

```java
sealed interface RequestBodyKind permits RepeatableRequestBody, OneShotRequestBody {}
```

This is how protocol design meets Java API design.

---

## 32. HTTP/1.1 Server-Side Response Correctness

Server must be careful with:

- `Content-Length`
- body actually written
- exception after headers committed
- compression filter changing length
- response buffering
- chunked streaming
- client disconnect
- HEAD response behavior
- 204/304 no-body semantics

Common bugs:

```text
sets Content-Length manually then writes different byte count
writes body for 204 No Content
throws exception after partial response
returns JSON error after already streaming binary content
compression enabled but stale Content-Length remains
```

Safer server pattern:

```text
let framework set Content-Length when fully buffered
use chunked streaming for unknown length
avoid manual Content-Length unless exact bytes are controlled
do not write body for statuses that must not have body
handle client abort separately from server error
```

---

## 33. HEAD, 204, 304, and Body Semantics

Some responses do not carry message content even if headers may describe representation metadata.

Important cases:

```text
HEAD response: no response body
204 No Content: no response body
304 Not Modified: no response body
1xx informational: no final body
```

Bug class:

```text
server sends body bytes after HEAD/204/304
client keeps connection alive
extra bytes corrupt next response parsing
```

This is rare but painful when it happens.

The invariant:

```text
HTTP semantics and HTTP framing must agree.
```

---

## 34. HTTP/1.1 with Application Servers

Typical Java stacks:

```text
Tomcat
Jetty
Undertow
Netty/Reactor Netty
Grizzly
```

Key runtime settings to know:

```text
max connections
accept count / backlog
worker threads
selector/event-loop threads
connection timeout
keep-alive timeout
max keep-alive requests
max header size
max request body size
max swallow size
compression threshold
access log pattern
proxy header trust config
```

Top-tier engineers do not only tune business thread pools. They know the HTTP connector is part of the application capacity model.

---

## 35. Capacity Model for HTTP/1.1 Services

A simple capacity model:

```text
inbound concurrency
= active HTTP requests
+ active uploads
+ active downloads
+ queued accepted connections
+ idle keep-alive connections
```

Outbound concurrency:

```text
outbound concurrency per dependency
= active leased connections
+ pending pool waiters
+ in-flight retries
```

Dangerous imbalance:

```text
inbound worker threads = 200
outbound dependency pool = 20
dependency latency spike = 10s
```

Then many inbound requests may block waiting for only 20 outbound slots.

Better design:

```text
inbound route concurrency limit
outbound dependency bulkhead
short pool acquisition timeout
bounded retry
fast fail / degrade when dependency overloaded
```

---

## 36. Production Failure Catalogue

### 36.1 First Request After Idle Fails

Likely causes:

- LB closed idle connection before client evicted it
- stale pooled connection
- server keep-alive timeout lower than client idle TTL

Fixes:

- lower client idle TTL
- validate before reuse
- retry safe/idempotent request once
- align timeouts

### 36.2 Random 400 Behind Gateway

Likely causes:

- malformed header
- oversized header
- ambiguous request framing
- invalid chunked encoding
- duplicate Host/Content-Length handling
- proxy parser mismatch

Fixes:

- inspect raw request at gateway
- compare client/gateway/backend logs with correlation id
- reject ambiguous framing
- update proxy/server libraries

### 36.3 Pool Timeout but Backend Is Healthy

Likely causes:

- client pool too small
- response bodies not closed
- slow downstream increased connection occupancy
- retry storm occupying pool
- long downloads sharing pool with small requests

Fixes:

- expose pool metrics
- separate pools by dependency/use case
- close/consume body
- apply route bulkhead
- separate large transfer client from small RPC client

### 36.4 504 Gateway Timeout

Likely causes:

- backend processing exceeded gateway upstream timeout
- backend response started too late
- connection pool wait at gateway
- backend overloaded
- long upload/download through gateway timeout

Fixes:

- align client/gateway/backend timeouts
- distinguish upstream connect vs response timeout
- check gateway logs
- avoid long synchronous operation under short gateway timeout

### 36.5 Broken Pipe During Response

Likely causes:

- client disconnected before server finished writing
- gateway timeout closed downstream
- slow client aborted
- retrying client gave up

Fixes:

- treat client abort separately from server failure
- check response write duration
- reduce response size
- stream carefully
- tune gateway timeout

---

## 37. Case Study: Regulatory Case Export API

Imagine a case management platform exposes:

```http
GET /cases/{caseId}/export
```

It generates a PDF/ZIP report.

Naive design:

```text
request arrives
server queries DB
builds all data in memory
creates zip in memory
returns byte[]
client waits up to default timeout
```

Problems:

- high heap pressure
- long request holds worker thread
- gateway timeout
- client timeout
- no resume
- poor observability
- retry causes repeated heavy export
- large response blocks HTTP/1.1 connection

Better design options:

Option A — synchronous but bounded:

```text
GET export only for small reports
strict max size
stream response
explicit timeout budget
Content-Disposition
Content-Length if precomputed safely
checksum header if available
```

Option B — asynchronous export:

```text
POST /case-exports
-> 202 Accepted + Location
worker generates artifact
GET /case-exports/{id}
GET /case-exports/{id}/download
```

Benefits:

- avoids gateway long request timeout
- separates command from download
- allows retry-safe status polling
- enables resume/range/object storage
- clearer audit trail

This is HTTP protocol knowledge shaping system design.

---

## 38. Case Study: Webhook Receiver

A webhook endpoint receives external HTTP/1.1 calls:

```http
POST /webhooks/provider-x
```

Risks:

- provider retries on timeout
- duplicate delivery
- large/invalid body
- request signature validation requires exact raw body
- slow body attack
- ambiguous content type
- response status controls provider retry behavior

Robust design:

```text
strict max body size
short header/body timeout
read raw body with bounded size
verify signature before parsing business payload
store event id/idempotency key
return 2xx only after durable acceptance
process asynchronously
map validation failures intentionally
observe duplicate/retry count
```

HTTP/1.1 details matter because webhook providers often use persistent clients, proxies, and retry policies you do not control.

---

## 39. Java 8 to Java 25 Perspective

### Java 8 Era

Common choices:

```text
HttpURLConnection
Apache HttpClient
OkHttp
Netty
RestTemplate
JAX-RS clients
```

Pain points:

- inconsistent timeout support
- manual pooling configuration
- async requires library-specific model
- HTTP/2 not standard in JDK
- blocking thread cost higher before virtual threads

### Java 11+

JDK introduced standard `java.net.http.HttpClient`.

Benefits:

- standard API
- sync and async
- HTTP/1.1 and HTTP/2 support
- immutable reusable clients
- `CompletableFuture` async model

### Java 21–25 Era

Virtual threads and structured concurrency change application design options.

But protocol fundamentals remain:

```text
HTTP/1.1 connection is still sequential per connection
pools still matter
timeouts still matter
body lifecycle still matters
backpressure still matters
remote systems still have capacity limits
```

Modern Java makes it easier to write clear blocking-style code, but it does not remove distributed systems constraints.

---

## 40. Checklist: HTTP/1.1 Client Readiness

For each outbound dependency, answer:

```text
What HTTP client library is used?
Is the client singleton/reused?
What is max connection per route?
What is max total connection?
What is pool acquisition timeout?
What is connect timeout?
What is request/response timeout?
What is idle connection eviction timeout?
How does it handle stale pooled connections?
Are response bodies always consumed/closed?
Are retries safe and bounded?
Are POST retries protected by idempotency key?
Are large uploads repeatable or one-shot?
Are pool metrics exported?
Are dependency-specific latency histograms exported?
Are Authorization/Cookie headers protected from logs?
Does client support proxy/mTLS if needed?
```

---

## 41. Checklist: HTTP/1.1 Server Readiness

For each HTTP service, answer:

```text
What is max header size?
What is max request body size?
What is header read timeout?
What is body read timeout?
What is keep-alive timeout?
What is max keep-alive requests?
What is max connection count?
What is worker pool size?
What is queue size / accept count?
What happens on client abort?
What happens on timeout after partial response?
Are 204/304/HEAD responses body-safe?
Are compression and Content-Length compatible?
Are upload endpoints streaming or buffering?
Are access logs correlation-aware?
Are proxy headers trusted only from trusted proxies?
```

---

## 42. Anti-Patterns

### 42.1 Creating New Client Per Request

```text
Symptom: high latency, many handshakes, no pooling benefit.
```

### 42.2 Infinite or Very Long Read Timeout

```text
Symptom: threads/connections stuck during downstream partial outage.
```

### 42.3 Blind Retry on Every Exception

```text
Symptom: duplicate side effects and retry storm.
```

### 42.4 Not Closing Response Body

```text
Symptom: connection pool exhaustion.
```

### 42.5 Sharing One Pool for Tiny Calls and Huge Downloads

```text
Symptom: small calls wait behind large transfers.
```

### 42.6 Trusting Raw Forwarded Headers

```text
Symptom: spoofed client IP/scheme/host if app is reachable without trusted proxy enforcement.
```

### 42.7 Manual `Content-Length` with String Length

```text
Symptom: corrupted body framing for non-ASCII payload.
```

### 42.8 Treating 502/503/504 as Backend Business Errors

```text
Symptom: wrong domain behavior; transport/gateway issue mapped as application rejection.
```

---

## 43. Exercises

### Exercise 1 — Connection Reuse Failure

You see this pattern:

```text
Every few minutes, the first request to an external API fails with Connection reset.
Immediate retry succeeds.
```

Explain likely causes and propose a fix.

Expected reasoning:

```text
stale pooled connection
idle timeout mismatch between client and LB/server
client reuses socket that remote hop already closed
lower client idle TTL
safe retry once for idempotent requests
export stale reuse metrics
```

### Exercise 2 — Pool Saturation

A Java service has:

```text
inbound worker threads: 200
HTTP client max connections to dependency: 20
dependency p99 latency: normally 100ms, incident 8s
request timeout: 30s
```

What happens during incident?

Expected reasoning:

```text
20 active outbound calls occupy all connections
many inbound requests wait for pool
threads pile up
latency exceeds user SLA before timeout
retries can worsen saturation
need pool acquire timeout, bulkhead, deadline, load shedding, fallback
```

### Exercise 3 — Large Upload Retry

A client uploads a 500MB file using POST. Connection resets before response. Should the client retry?

Expected reasoning:

```text
unknown whether server received partial/full body
POST may have side effect
body may not be replayable
retry only with idempotency key, resumable protocol, content hash, upload session, or server duplicate suppression
```

### Exercise 4 — Request Smuggling Risk

A reverse proxy forwards requests to a Java backend. A request contains both:

```text
Content-Length: 10
Transfer-Encoding: chunked
```

What should happen?

Expected reasoning:

```text
reject ambiguous framing at boundary
avoid proxy/backend parser disagreement
log security event safely
keep backend protected by normalized requests
```

### Exercise 5 — 204 With Body

A server returns:

```http
HTTP/1.1 204 No Content
Content-Type: application/json

{"ok":true}
```

Why is this dangerous?

Expected reasoning:

```text
204 must not include response body
extra bytes can corrupt persistent connection parsing
client/proxy behavior may vary
fix server response mapping
```

---

## 44. Practical Design Heuristics

Use these as defaults unless your measured production context says otherwise:

```text
Reuse HTTP clients.
Make connection pools explicit.
Set bounded connect, pool acquire, request, and read timeouts.
Prefer deadline propagation over isolated timeout constants.
Evict idle client connections before load balancer idle timeout.
Consume or close every response body.
Separate pools for large transfer and small RPC-like calls.
Retry only when method, idempotency, body replayability, and deadline allow it.
Do not manually parse HTTP unless necessary.
Reject ambiguous framing.
Measure pool saturation and tail latency.
Treat proxy/LB/gateway as part of the protocol path.
```

---

## 45. Mental Compression

If you remember only one model from this part, remember this:

```text
HTTP/1.1 is stateless semantics over stateful sequential connections.
```

Then expand:

```text
Because connections are stateful:
  pooling matters
  idle timeout matters
  stale reuse matters
  body consumption matters
  connection close matters

Because messages are framed over byte streams:
  Content-Length matters
  Transfer-Encoding matters
  chunked matters
  ambiguous parsing is dangerous

Because each connection is sequential:
  head-of-line blocking matters
  pool sizing matters
  large transfers can starve small calls

Because production paths have intermediaries:
  hop-by-hop headers matter
  proxy timeout matters
  parser disagreement matters
  502/503/504 must be interpreted by hop
```

---

## 46. What This Part Enables Next

This part prepares you for Part 9: HTTP/2.

HTTP/2 changes the wire format from textual messages to binary frames and introduces multiplexed streams over a single connection. That solves some HTTP/1.1 problems, especially per-connection request/response sequencing, but introduces new ones:

```text
connection-level flow control
stream-level flow control
max concurrent streams
GOAWAY
RST_STREAM
HPACK header compression
HTTP/2 proxy compatibility
one connection becoming a shared failure domain
```

The point is not that HTTP/2 is always better. The point is that each protocol moves complexity to a different place.

---

## 47. References

- RFC 9112 — HTTP/1.1: message syntax, parsing, connection management, and security concerns.
- RFC 9110 — HTTP Semantics.
- Oracle Java SE 25 `java.net.http.HttpClient` documentation.
- Oracle Java SE 21 `HttpClient` documentation notes on connection pool/resource sharing.
- PortSwigger Web Security Academy — HTTP request smuggling overview.
- MDN Web Docs — HTTP content headers and related HTTP reference material.

---

## 48. Part Status

```text
Part 8 of 35 selesai.
Seri belum selesai.
Part berikutnya: Part 9 — HTTP/2 Deep Dive: Streams, Frames, Multiplexing, HPACK, Flow Control, and Prioritization
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./007-http-as-a-protocol-semantics-before-frameworks.md">⬅️ Part 7 — HTTP as a Protocol: Semantics Before Frameworks</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./009-http2-deep-dive-streams-frames-multiplexing-hpack-flow-control-prioritization.md">Part 9 — HTTP/2 Deep Dive: Streams, Frames, Multiplexing, HPACK, Flow Control, and Prioritization ➡️</a>
</div>
