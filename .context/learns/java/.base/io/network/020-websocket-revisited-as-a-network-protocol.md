# Part 20 — WebSocket Revisited as a Network Protocol

Series: `learn-java-io-network-http-grpc-protocol-engineering`  
File: `020-websocket-revisited-as-a-network-protocol.md`  
Scope: Java 8–25, Jakarta WebSocket, JDK WebSocket client, Netty/Spring/Reactor concepts, production-grade bidirectional systems

---

## 1. Why this part exists

You have already studied Servlet, Jakarta WebSocket, server-side UI, HTTP, serialization, timeout, retry, TLS, proxies, and streaming HTTP. So this part will not teach WebSocket as “add `@ServerEndpoint` and send a message.”

This part treats WebSocket as a **long-lived bidirectional network protocol** running over an upgraded HTTP connection. The important engineering question is not:

> How do I open a WebSocket?

The important questions are:

> Who owns the connection?
> What happens when one side is slow?
> How do we detect half-dead clients?
> How do we reconnect safely?
> How do we preserve ordering?
> How do we scale horizontally?
> How do we protect memory?
> How do we close gracefully?
> How do we observe millions of long-lived connections?

A WebSocket system fails differently from request/response HTTP. In HTTP, the call has a natural beginning and end. In WebSocket, the connection itself becomes a long-lived runtime object.

That means every WebSocket connection consumes:

```text
file descriptor
TCP socket state
TLS state if wss://
server session object
application subscription state
send buffer
receive buffer
outbound queue
authentication/authorization context
metrics tags/cardinality risk
possibly sticky load balancer affinity
possibly distributed routing state
```

So the real skill is not “using WebSocket.” The real skill is designing a **bounded, observable, reconnectable, horizontally scalable, protocol-safe bidirectional channel**.

---

## 2. What WebSocket is and is not

### 2.1 WebSocket is not plain HTTP streaming

HTTP streaming is still fundamentally request-response shaped:

```text
client sends HTTP request
server sends long response stream
connection eventually ends
```

WebSocket changes the communication model after the opening handshake:

```text
HTTP request with Upgrade: websocket
server responds 101 Switching Protocols
connection becomes WebSocket frame exchange
both sides can send frames independently
```

After upgrade, you are no longer dealing with normal HTTP request/response semantics. You are dealing with a persistent full-duplex frame protocol.

### 2.2 WebSocket is not a message broker

WebSocket gives you a pipe. It does not give you durable delivery, replay, consumer groups, offset tracking, dead-letter queues, transactional publishing, or exactly-once semantics.

If you need broker semantics, WebSocket is usually only the delivery edge:

```text
Kafka/RabbitMQ/database/outbox
        |
        v
application fan-out service
        |
        v
WebSocket connections to clients
```

A common mistake is to let WebSocket become the architecture’s hidden message broker. That creates painful failures:

```text
client reconnects -> missed events
server restarts -> in-memory subscriptions lost
slow client -> server memory grows
horizontal scale -> message routed to wrong node
load balancer drains node -> sessions vanish
```

### 2.3 WebSocket is not automatically low-latency

WebSocket avoids repeated HTTP request setup and can reduce overhead for frequent small messages. But it still depends on:

```text
TCP congestion control
TLS
kernel socket buffers
application queues
serialization cost
event loop or thread scheduling
proxy/load balancer behavior
mobile network instability
browser tab lifecycle
client CPU/memory pressure
server fan-out design
```

Low latency requires bounded queues, small payloads, efficient serialization, careful batching, and active monitoring. WebSocket alone does not guarantee it.

---

## 3. WebSocket lifecycle mental model

A production WebSocket connection has six major phases:

```text
1. HTTP handshake
2. authentication and authorization binding
3. connection/session registration
4. frame exchange
5. heartbeat/liveness management
6. close/drain/reconnect/recovery
```

### 3.1 Phase 1 — Opening handshake

The client starts with an HTTP request similar to:

```http
GET /ws/cases HTTP/1.1
Host: example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: ...
Sec-WebSocket-Version: 13
Origin: https://app.example.com
Authorization: Bearer ...
```

The server accepts with:

```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: ...
```

After this, the connection is no longer ordinary HTTP. It becomes a WebSocket frame channel.

Important production implications:

```text
handshake is where normal HTTP auth usually happens
proxies/LBs must support Upgrade
Origin validation matters for browser clients
TLS termination may happen before the WebSocket server
session stickiness may be decided at this stage
rate limiting should happen before accepting expensive long-lived sessions
```

### 3.2 Phase 2 — Authentication and authorization binding

For browser WebSocket clients, authentication can be carried through:

```text
cookie session
bearer token in query parameter — risky because logs/history can expose it
bearer token in subprotocol/custom mechanism — browser API limits custom headers
short-lived one-time connection token
same-origin authenticated HTTP session
```

Best practice depends on environment, but the invariant is:

> A WebSocket connection must have a clearly defined authenticated principal and authorization scope at connection time, and you must decide what happens when that scope changes.

Questions to answer:

```text
What if user logs out?
What if token expires?
What if role changes?
What if case assignment is revoked?
What if account is disabled?
What if tenant access changes?
```

For regulatory/case-management systems, authorization drift is serious. A user may open a WebSocket while authorized for a case, then lose access later. If the server keeps pushing sensitive updates, the system leaks data.

A robust design must include one or more of:

```text
short session lifetime
periodic authorization refresh
server-side forced disconnect on logout/role change
per-message authorization check for sensitive topics
subscription invalidation events
central session registry
```

### 3.3 Phase 3 — Session registration

Once accepted, a connection usually becomes a session object:

```java
record WsSession(
    String connectionId,
    String userId,
    String tenantId,
    Set<String> roles,
    Set<String> subscriptions,
    Instant connectedAt,
    AtomicLong lastReadAt,
    AtomicLong lastWriteAt,
    Queue<OutboundMessage> outboundQueue
) {}
```

This object is dangerous if it grows without bounds. For every attribute, ask:

```text
Is it bounded?
Can it be recomputed?
Can it become stale?
Is it safe to replicate?
Can it leak sensitive data?
Will it explode metrics cardinality?
```

### 3.4 Phase 4 — Frame exchange

WebSocket messages are carried in frames. Application developers usually see “text message” or “binary message,” but under the protocol there are:

```text
text frames
binary frames
continuation frames
close control frames
ping control frames
pong control frames
```

RFC 6455 defines Close, Ping, and Pong as control frame opcodes. Control frames have special rules and can appear between fragmented message frames.

The operational lesson:

> Do not assume every read event is one full business message unless your framework guarantees message reassembly and your configured max message size is safe.

### 3.5 Phase 5 — Heartbeat and liveness

A TCP connection can be “not obviously dead” for a long time. Mobile clients disappear. NAT mappings expire. Proxies drop idle connections. Browser tabs sleep. Corporate firewalls interfere.

So a WebSocket system needs liveness strategy:

```text
protocol ping/pong
application heartbeat message
read idle timeout
write idle timeout
absolute max session lifetime
server-side idle disconnect
client-side reconnect with backoff
```

Ping/pong detects protocol-level liveness. Application heartbeat can also validate app-level state, version, or subscription health.

### 3.6 Phase 6 — Close, drain, reconnect, recovery

Closing is not just `socket.close()`.

A graceful WebSocket close should answer:

```text
Do we send a close frame?
Which close code?
Do we stop accepting new outbound messages?
Do we flush existing messages?
How long do we wait?
Do we persist last delivered event id?
Can the client resume?
Should the client reconnect immediately or later?
```

The close phase determines whether the system feels reliable or randomly loses updates.

---

## 4. WebSocket frame model

### 4.1 Message vs frame

A WebSocket application message may be split into multiple frames:

```text
message = frame 1 + frame 2 + frame 3
```

This matters for:

```text
large messages
streaming parsers
memory limits
control frame interleaving
fragmentation attacks
partial delivery
```

Most high-level Java APIs deliver reassembled messages. That is convenient, but it also means the implementation may buffer until the whole message is complete.

Therefore, set message size limits.

Bad:

```text
allow unlimited incoming text message
parse JSON into giant object
keep per-session unbounded queue
```

Better:

```text
max text message size
max binary message size
max outbound queue size
max subscriptions per connection
max connections per user/IP/tenant
```

### 4.2 Text vs binary

Text messages are usually JSON:

```json
{
  "type": "CASE_UPDATED",
  "eventId": "evt-123",
  "caseId": "C-001",
  "version": 42
}
```

Binary messages might use Protobuf, CBOR, or custom framing.

Decision matrix:

| Dimension | Text/JSON | Binary/Protobuf |
|---|---|---|
| Debuggability | High | Medium/low |
| Browser ease | High | Medium |
| Payload size | Larger | Smaller |
| Schema discipline | Often weak unless enforced | Stronger |
| Compatibility | Must be designed manually | Built-in patterns if used correctly |
| Human inspection | Easy | Harder |
| Performance | Usually enough for modest volume | Better for high-volume/low-latency |

For enterprise dashboards, JSON is often fine. For high-volume realtime telemetry, binary may be better.

### 4.3 Control frames

Control frames are protocol-level management frames:

```text
Close
Ping
Pong
```

They are not business messages.

Do not treat ping/pong as domain-level heartbeat unless you explicitly map it. A domain heartbeat may include app state:

```json
{
  "type": "HEARTBEAT",
  "clientVersion": "1.8.2",
  "lastSeenEventId": "evt-8891",
  "activeSubscriptions": 12
}
```

Protocol ping/pong tells you the WebSocket stack is alive. Application heartbeat tells you the application protocol is still coherent.

---

## 5. Java WebSocket implementation landscape

### 5.1 Jakarta WebSocket server API

Jakarta WebSocket is the standard Jakarta EE API for WebSocket endpoints. It allows annotated or programmatic endpoints.

Annotated style:

```java
@ServerEndpoint("/ws/cases")
public class CaseWebSocketEndpoint {

    @OnOpen
    public void onOpen(Session session) {
        // register connection
    }

    @OnMessage
    public void onMessage(String message, Session session) {
        // parse command / subscription / heartbeat
    }

    @OnClose
    public void onClose(Session session, CloseReason reason) {
        // unregister connection
    }

    @OnError
    public void onError(Session session, Throwable error) {
        // observe and close if needed
    }
}
```

This is easy to start with, but top-tier engineering depends on what you put around it:

```text
connection registry
bounded outbound queue
authorization refresh
message validation
error taxonomy
metrics
tracing/correlation
rate limiting
node drain strategy
replay/resume protocol
```

### 5.2 JDK WebSocket client

The JDK `java.net.http` module provides HTTP Client and WebSocket APIs. The JDK WebSocket client is useful for Java services acting as WebSocket clients.

Conceptual skeleton:

```java
HttpClient client = HttpClient.newHttpClient();

WebSocket ws = client.newWebSocketBuilder()
    .buildAsync(URI.create("wss://example.com/ws"), new WebSocket.Listener() {
        @Override
        public CompletionStage<?> onText(WebSocket webSocket,
                                         CharSequence data,
                                         boolean last) {
            try {
                // accumulate or process message fragment
                return CompletableFuture.completedFuture(null);
            } finally {
                webSocket.request(1);
            }
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket,
                                          int statusCode,
                                          String reason) {
            // schedule reconnect if policy allows
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            // observe failure
        }
    })
    .join();

ws.request(1);
```

Important: the JDK WebSocket listener model has an explicit demand mechanism through `request(n)`. This is one reason the client-side API can express a form of backpressure at the listener boundary.

### 5.3 Netty-based WebSocket

Netty gives lower-level control:

```text
event loop
channel pipeline
HTTP codec
HTTP object aggregator
WebSocket protocol handler
text/binary frame handler
idle state handler
backpressure via channel writability
```

Netty is powerful for high-scale servers, but it requires discipline:

```text
never block event loop
release ByteBuf correctly
check channel writability
bound queues
separate CPU-heavy parsing from I/O loop
handle close handshake correctly
```

### 5.4 Spring WebSocket / STOMP

Spring can expose raw WebSocket or messaging-style WebSocket with STOMP.

STOMP gives higher-level concepts:

```text
CONNECT
SUBSCRIBE
SEND
MESSAGE
ACK
DISCONNECT
```

This can simplify app-level routing but also introduces more protocol layers:

```text
WebSocket
  -> STOMP frame
     -> destination routing
        -> application message handling
```

Use it when the messaging abstraction helps. Avoid it if you need very precise, minimal, high-performance protocol behavior.

---

## 6. Backpressure: the hardest WebSocket problem

### 6.1 The core failure

A WebSocket connection is full-duplex, but the consumer can be slower than the producer.

Example:

```text
server produces 10,000 events/sec
client browser tab can process 300 events/sec
network can send 1,000 events/sec
server outbound queue grows forever
heap grows
GC pressure rises
latency rises
node dies
```

This is not theoretical. It is the default failure mode of naive realtime systems.

### 6.2 Browser WebSocket limitation

The browser `WebSocket` API is widely supported, but MDN documents that it does not support backpressure. If messages arrive faster than the application processes them, memory or CPU can become a problem.

This means the server cannot rely on the browser API to automatically slow down production. The server must protect itself.

### 6.3 Server-side backpressure strategies

Use explicit policies:

```text
bounded per-connection outbound queue
max bytes queued per connection
drop oldest non-critical messages
coalesce updates
send snapshot instead of event stream after lag
close slow client with clear close code
per-topic fan-out limit
per-user connection limit
per-tenant event budget
```

Example queue policy:

```java
final class OutboundQueue {
    private final ArrayBlockingQueue<OutboundMessage> queue;
    private final int maxQueuedBytes;
    private final AtomicInteger queuedBytes = new AtomicInteger();

    boolean offer(OutboundMessage msg) {
        int size = msg.estimatedBytes();
        int after = queuedBytes.addAndGet(size);
        if (after > maxQueuedBytes) {
            queuedBytes.addAndGet(-size);
            return false;
        }

        boolean accepted = queue.offer(msg);
        if (!accepted) {
            queuedBytes.addAndGet(-size);
        }
        return accepted;
    }
}
```

Then define the policy:

```java
if (!outboundQueue.offer(message)) {
    metrics.slowClientDropped.increment();
    closeSlowClient(session, "Outbound queue exceeded");
}
```

### 6.4 Coalescing beats infinite queueing

For UI updates, not every event must be delivered individually.

Bad:

```text
CASE_UPDATED version 41
CASE_UPDATED version 42
CASE_UPDATED version 43
CASE_UPDATED version 44
```

Better for lagging client:

```text
CASE_SNAPSHOT caseId=C-001 version=44
```

Coalescing works for state updates. It does not work for audit events where every event must be preserved. For audit streams, use replay from durable storage and cursor-based resume.

### 6.5 Channel writability

In Netty, `Channel.isWritable()` indicates whether outbound buffers are below configured watermarks.

Conceptual pattern:

```java
if (!channel.isWritable()) {
    // stop reading from upstream, pause subscription, or drop/coalesce
}
```

This connects network backpressure to application production. Without this bridge, your app just buffers until it dies.

---

## 7. Message protocol over WebSocket

WebSocket is a frame protocol, not your business protocol.

You still need an application protocol.

### 7.1 Minimal envelope

A robust envelope should include:

```json
{
  "type": "CASE_UPDATED",
  "messageId": "msg-01H...",
  "correlationId": "corr-123",
  "sentAt": "2026-06-18T10:15:30Z",
  "version": 1,
  "payload": {}
}
```

For client commands:

```json
{
  "type": "SUBSCRIBE",
  "requestId": "req-123",
  "topic": "case:C-001",
  "resumeFrom": "evt-7788"
}
```

For server acknowledgements:

```json
{
  "type": "SUBSCRIBED",
  "requestId": "req-123",
  "topic": "case:C-001",
  "fromEventId": "evt-7788"
}
```

For errors:

```json
{
  "type": "ERROR",
  "requestId": "req-123",
  "code": "SUBSCRIPTION_FORBIDDEN",
  "message": "Not authorized to subscribe to this case.",
  "retryable": false
}
```

### 7.2 Separate transport errors from domain errors

Transport error:

```text
connection closed
ping timeout
frame too large
invalid UTF-8
protocol violation
```

Domain error:

```text
not authorized for topic
case no longer exists
invalid subscription filter
unsupported client version
rate limit exceeded
```

Keep these separate. Transport errors close the connection or session. Domain errors usually return an application message and keep the connection alive unless severe.

### 7.3 Versioning

WebSocket connections are long-lived, so version drift is common:

```text
user opens app at 09:00
server deployed at 10:00
user tab still connected at 15:00
```

Your protocol needs:

```text
client protocol version in handshake or first HELLO
server protocol version response
unsupported version error
graceful disconnect with upgrade reason
feature flags/capability negotiation
```

Example:

```json
{
  "type": "HELLO",
  "clientProtocol": "2.1",
  "clientBuild": "2026.06.18.1",
  "capabilities": ["resume", "case-snapshot-v2"]
}
```

Server:

```json
{
  "type": "WELCOME",
  "serverProtocol": "2.2",
  "sessionId": "ws-abc",
  "heartbeatIntervalMs": 30000,
  "maxMessageBytes": 65536
}
```

---

## 8. Reconnect and resume

### 8.1 Reconnect is part of the protocol

Every production WebSocket client must reconnect. Networks fail. Browsers sleep. Proxies drain. Deployments restart servers.

A bad client reconnect strategy:

```text
on close -> reconnect immediately
```

This can cause reconnect storms after deploy or outage.

Better:

```text
exponential backoff
jitter
max delay
stop reconnecting after auth failure
resume from last event id
refresh token before reconnect
```

Example client policy:

```text
normal close 1000 -> do not reconnect unless user action requires
server restart/drain -> reconnect with short jitter
policy violation/auth failure -> do not reconnect until login refresh
network error -> reconnect with exponential backoff + jitter
rate limited -> obey retry-after if provided in app close reason/message
```

### 8.2 Resume requires durable event identity

To resume safely, each event must have a durable monotonically comparable identity within its stream:

```text
eventId
streamId
aggregateVersion
createdAt is not enough
```

Client stores:

```text
lastAppliedEventId per stream/topic
```

On reconnect:

```json
{
  "type": "RESUME",
  "topic": "case:C-001",
  "afterEventId": "evt-7788"
}
```

Server responds:

```text
replay events after evt-7788
or send snapshot if replay window expired
or reject if authorization no longer valid
```

### 8.3 Snapshot fallback

If replay is too expensive or event history expired:

```json
{
  "type": "SNAPSHOT_REQUIRED",
  "topic": "case:C-001",
  "reason": "Replay window expired"
}
```

Then client fetches REST snapshot or server pushes a snapshot:

```json
{
  "type": "CASE_SNAPSHOT",
  "caseId": "C-001",
  "version": 91,
  "payload": { }
}
```

This is often better than trying to make WebSocket itself durable.

---

## 9. Ordering and delivery semantics

### 9.1 WebSocket preserves order per connection

WebSocket over TCP preserves byte order within a connection. But application-level ordering is more complicated:

```text
multiple server nodes
multiple topics
multiple backend event sources
reconnect/resume
parallel processing on client
out-of-order backend publication
coalescing
snapshot replacement
```

Do not rely only on “TCP is ordered.” Define ordering scope.

Examples:

```text
ordered per case
ordered per user notification stream
unordered across independent topics
ordered per aggregate version
```

### 9.2 At-most-once, at-least-once, effectively-once

Naive WebSocket delivery is often at-most-once:

```text
server sends event
connection drops before client processes
server forgets event
client misses update
```

With replay, it becomes at-least-once:

```text
client may receive same event again after reconnect
client deduplicates by eventId
```

Effectively-once UI state:

```text
apply event only if eventId/version is newer than current state
ignore duplicate or older event
```

For regulatory systems, do not confuse UI delivery with audit durability. The durable audit trail must live in database/event store, not in WebSocket memory.

---

## 10. Horizontal scaling

### 10.1 The routing problem

If user A is connected to node 3, and backend event is processed by node 7, how does node 7 push to user A?

Options:

```text
sticky session only
shared distributed pub/sub
central WebSocket gateway
connection registry + message routing
external managed realtime service
```

### 10.2 Sticky session

Sticky session routes the same client to same node.

Pros:

```text
simple
local session state
low latency
```

Cons:

```text
node failure loses sessions
scale-down disconnects users
uneven load
harder blue/green deployment
backend event may still land elsewhere
```

Sticky sessions help connection affinity but do not solve event fan-out by themselves.

### 10.3 Pub/sub fan-out

A common architecture:

```text
backend service publishes event to Redis/Kafka/RabbitMQ topic
all WebSocket nodes subscribe
node checks local sessions
node pushes to matching connections
```

Problem: broadcasting every event to every node can waste capacity.

Better:

```text
partition by tenant/topic/user
maintain subscription registry
route only relevant events
use local filtering for final safety
```

### 10.4 Dedicated WebSocket gateway

For large systems, isolate long-lived connection management:

```text
browser/mobile client
      |
      v
WebSocket Gateway Cluster
      |
      v
internal services / event bus / REST/gRPC
```

Benefits:

```text
backend services stay stateless request/response
connection lifecycle isolated
centralized heartbeat/reconnect protocol
scaling tuned for sockets
security/authorization concentrated
observability simplified
```

Risks:

```text
gateway becomes critical dependency
event routing complexity
must avoid becoming business logic dumping ground
```

---

## 11. Load balancer, proxy, and service mesh behavior

WebSocket needs HTTP Upgrade support.

Checklist:

```text
Does ingress support Upgrade header?
Does proxy preserve Connection: Upgrade?
What is idle timeout?
What is max connection duration?
Does LB support connection draining?
Does mesh sidecar buffer or inspect traffic?
Is HTTP/2 to client supported for WebSocket? Or only HTTP/1.1 upgrade?
Does TLS terminate at edge or service?
Are close frames propagated?
```

Common failure:

```text
server heartbeat every 60 seconds
load balancer idle timeout 30 seconds
connections die every 30 seconds
client reconnects forever
```

Better:

```text
heartbeat interval < lowest idle timeout
or configure idle timeout > heartbeat interval with margin
observe close reason and source
```

Another failure:

```text
rolling deployment kills pods immediately
WebSocket connections reset
clients reconnect all at once
new pods overloaded
```

Better:

```text
mark pod not ready
stop accepting new WebSockets
send server-draining message
close with retry-after/jitter hint
wait grace period
then terminate
```

---

## 12. Graceful shutdown and draining

A WebSocket server needs explicit draining.

### 12.1 Drain phases

```text
1. mark node draining
2. readiness returns false for new connections
3. reject new handshakes with retryable response or close after accept
4. notify existing clients: SERVER_DRAINING
5. stop accepting new subscriptions
6. flush or snapshot critical messages
7. close connections with appropriate code/reason
8. wait bounded grace period
9. force close remaining connections
```

Application message:

```json
{
  "type": "SERVER_DRAINING",
  "reconnectAfterMs": 1500,
  "reason": "rolling_deploy"
}
```

Then close.

### 12.2 Client reaction

```text
receive SERVER_DRAINING
store last event ids
wait reconnectAfter + jitter
refresh token if near expiry
reconnect
resume subscriptions
```

This turns deploy from incident into normal lifecycle.

---

## 13. Security model

### 13.1 Origin validation

Browser WebSocket requests include `Origin`. Validate it.

Do not accept every origin unless the channel is intentionally public.

Bad:

```text
allow Origin: * for authenticated WebSocket
```

Risk:

```text
malicious site can make victim browser open WebSocket using victim cookies
```

### 13.2 Authentication token exposure

Avoid long-lived bearer tokens in query parameters:

```text
wss://example.com/ws?token=eyJ...
```

They can leak through logs, browser history, analytics, reverse proxy logs, and support screenshots.

Prefer:

```text
secure cookie with SameSite strategy where appropriate
short-lived one-time WebSocket ticket
first-message authentication over already-TLS channel if server design supports it
```

### 13.3 Authorization per subscription

Connection-level authentication is not enough.

If the client sends:

```json
{
  "type": "SUBSCRIBE",
  "topic": "case:C-001"
}
```

Server must check:

```text
is this user allowed to subscribe to C-001 now?
which fields/events may be seen?
should access be revalidated periodically?
what happens if access changes?
```

### 13.4 Message validation

Every inbound message must be validated:

```text
max size
valid JSON/binary schema
known type
required fields
allowed enum values
rate limit
authorization
idempotency/request id if command-like
```

Never treat WebSocket as trusted because it was authenticated once.

### 13.5 DoS controls

Protect against:

```text
connection flood
handshake flood
large message
fragmentation abuse
slow senders
slow receivers
subscription explosion
heartbeat abuse
invalid message spam
fan-out amplification
```

Controls:

```text
max connections per IP/user/tenant
handshake rate limit
message rate limit
max message size
max subscriptions per connection
max outbound queue
idle timeout
auth timeout
circuit breaker on fan-out dependency
```

---

## 14. Observability

### 14.1 Metrics

Minimum metrics:

```text
active_websocket_connections
connections_opened_total
connections_closed_total by close_code/source
handshake_failures_total by reason
inbound_messages_total by type
outbound_messages_total by type
inbound_bytes_total
outbound_bytes_total
outbound_queue_depth histogram
outbound_queue_bytes histogram
slow_client_closes_total
ping_latency histogram
last_read_age histogram
last_write_age histogram
reconnect_rate estimated by client/session
subscriptions_active by topic class, not raw topic id
message_processing_latency by type
send_latency by type
serialization_errors_total
authorization_failures_total
```

Avoid high-cardinality labels:

Bad:

```text
caseId
userId
connectionId
raw topic
```

Better:

```text
tenant tier
module
topic type
close code
client version bucket
node/pod
```

### 14.2 Logs

Important lifecycle logs:

```text
handshake accepted/rejected
connection opened
subscription accepted/rejected
invalid message
slow client close
server draining close
unexpected close
reconnect resume result
authorization revoked disconnect
```

Log correlation fields:

```text
connectionId
userId hash or internal id if allowed
tenantId
clientVersion
remoteIp after trusted proxy extraction
traceId/correlationId
closeCode
closeReasonCode
lastEventId
```

Never log sensitive payloads by default.

### 14.3 Tracing

WebSocket tracing is harder than request/response because one connection contains many messages.

A useful model:

```text
span for handshake
span/event for subscribe command
span/event for each business command
span/link from backend event to outbound push
connection-level metrics outside traces
```

Do not create one trace span for every heartbeat at high volume unless sampled.

---

## 15. Production failure catalogue

### Failure 1 — Slow browser tab kills server heap

Symptoms:

```text
heap growth
GC pressure
outbound queue depth rising
few clients consume most memory
```

Root cause:

```text
unbounded outbound queue
no slow-client policy
```

Fix:

```text
bound queue
coalesce updates
close slow clients
expose queue metrics
```

### Failure 2 — Every connection drops every N seconds

Symptoms:

```text
regular disconnect interval
client reconnect loops
LB logs idle timeout
```

Root cause:

```text
heartbeat interval > proxy/LB idle timeout
```

Fix:

```text
configure heartbeat below lowest idle timeout
or increase idle timeout
monitor close source
```

### Failure 3 — Deployment causes reconnect storm

Symptoms:

```text
rolling deploy
connections reset
new pods CPU spike
auth service overloaded
```

Root cause:

```text
no drain protocol
clients reconnect immediately
```

Fix:

```text
server draining message
jittered reconnect
readiness false before shutdown
bounded reconnect rate
```

### Failure 4 — User receives updates after access revoked

Symptoms:

```text
security incident
data visible after reassignment/removal
```

Root cause:

```text
authorization checked only at handshake
subscription not invalidated
```

Fix:

```text
central authorization revocation event
per-topic revalidation
forced disconnect or unsubscribe
shorter session lifetime
```

### Failure 5 — Horizontal scale loses messages

Symptoms:

```text
event produced but connected user never receives it
works on single node
fails on cluster
```

Root cause:

```text
session state local
backend event routed to different node
no pub/sub or gateway routing
```

Fix:

```text
shared event bus
connection registry
dedicated WebSocket gateway
replay/resume protocol
```

### Failure 6 — Client duplicate updates after reconnect

Symptoms:

```text
UI counter increments twice
notification duplicated
case version regresses
```

Root cause:

```text
at-least-once replay without idempotent client apply
```

Fix:

```text
eventId dedupe
aggregate version check
snapshot reconciliation
```

---

## 16. Case-management example: live case updates

Suppose you build realtime case updates for a regulatory system.

### 16.1 Requirements

```text
user can subscribe to assigned cases
case updates appear in near real time
access revocation must stop updates
missed updates after reconnect must be recovered
server deploy must not lose important state
large tenants must not starve small tenants
all sensitive events must be auditable outside WebSocket
```

### 16.2 Recommended architecture

```text
Case Service
  -> durable case_event table / outbox
  -> event publisher
  -> message broker / pub-sub
  -> WebSocket Gateway Cluster
  -> browser clients
```

WebSocket gateway owns:

```text
connections
subscriptions
heartbeat
reconnect/resume
fan-out
slow-client protection
metrics
```

Case service owns:

```text
business transaction
authorization source of truth
durable event id
audit trail
case state
```

### 16.3 Event envelope

```json
{
  "type": "CASE_UPDATED",
  "eventId": "case-C001-v42",
  "caseId": "C001",
  "caseVersion": 42,
  "occurredAt": "2026-06-18T10:15:30Z",
  "payload": {
    "status": "PENDING_REVIEW",
    "changedFields": ["status", "assignedOfficer"]
  }
}
```

### 16.4 Subscription

```json
{
  "type": "SUBSCRIBE_CASE",
  "requestId": "req-123",
  "caseId": "C001",
  "afterEventId": "case-C001-v39"
}
```

Server flow:

```text
validate message
check user may access case C001
register subscription
replay events after v39 or send snapshot
ack subscription
```

### 16.5 Revocation

When case assignment changes:

```text
Case Service emits CASE_ACCESS_REVOKED userId/caseId
WebSocket Gateway finds matching connections
Gateway sends UNSUBSCRIBED / ACCESS_REVOKED
Gateway removes subscription
optionally closes connection if severe
```

This is how WebSocket stays defensible in regulated environments.

---

## 17. Design checklist

Before shipping WebSocket to production, answer these:

### Connection lifecycle

```text
How are connections authenticated?
How is Origin validated?
What is max connection lifetime?
What is idle timeout?
What is heartbeat interval?
How are close codes/reasons standardized?
How does client reconnect?
How does server drain?
```

### Resource limits

```text
Max connections per node?
Max connections per user/IP/tenant?
Max inbound message size?
Max outbound queue messages/bytes?
Max subscriptions per connection?
Max message rate?
Max fan-out rate?
```

### Protocol

```text
Is there a HELLO/WELCOME?
Is protocol version negotiated?
Are message types documented?
Are errors machine-readable?
Are events uniquely identified?
Can clients resume?
Can clients deduplicate?
```

### Scaling

```text
Do you need sticky session?
How are backend events routed to the right node?
What happens on node failure?
What happens during deployment?
How do you avoid reconnect storm?
```

### Security

```text
Is authorization checked per subscription?
What happens on logout/access revocation?
Are tokens exposed in URLs?
Are payloads size-limited?
Are invalid messages rate-limited?
```

### Observability

```text
Can you see active connections?
Can you see close reasons?
Can you detect slow clients?
Can you see outbound queue depth?
Can you correlate pushed events to backend events?
Can you distinguish client close, server close, proxy close, and error close?
```

---

## 18. Anti-patterns

### Anti-pattern 1 — WebSocket as database subscription without authorization drift handling

```text
User subscribes once.
Server pushes forever.
Access changes are ignored.
```

This is dangerous for sensitive systems.

### Anti-pattern 2 — Unbounded outbound queues

```text
Queue grows until heap dies.
```

Every queue must have a maximum and a failure policy.

### Anti-pattern 3 — No replay/resume

```text
Connection drops.
Client misses event.
UI is stale.
```

Use durable event IDs and snapshot fallback.

### Anti-pattern 4 — Reconnect immediately

```text
Outage happens.
All clients reconnect at once.
Auth and gateway collapse.
```

Use backoff and jitter.

### Anti-pattern 5 — Treat WebSocket as simpler than HTTP

WebSocket is operationally harder than ordinary HTTP because it is stateful and long-lived.

### Anti-pattern 6 — Business logic in WebSocket endpoint

Endpoint should handle connection protocol. Business decisions should stay in domain services.

### Anti-pattern 7 — Raw topic names as metrics labels

This destroys metrics systems via cardinality explosion.

---

## 19. Java mental model: blocking vs event loop vs virtual threads

### 19.1 Blocking style

Simple servers may use blocking semantics internally, especially if framework abstracts it.

Pros:

```text
simple code
fits virtual thread mental model for some tasks
```

Cons:

```text
one blocked send can consume thread/resource
harder to manage massive fan-out
need strict queue/resource policy
```

### 19.2 Event loop style

Netty/Reactor style uses few event loop threads.

Pros:

```text
high concurrency
lower thread overhead
explicit channel writability
```

Cons:

```text
must not block
more complex programming model
ByteBuf/resource lifecycle risk
```

### 19.3 Virtual threads

Virtual threads reduce the cost of blocking-style application code, but they do not remove:

```text
socket limits
file descriptor limits
network bandwidth limits
remote processing limits
browser processing limits
outbound queue limits
load balancer idle timeout
authorization drift
```

Virtual threads can simplify parts of the system, but WebSocket remains a stateful resource-management problem.

---

## 20. Exercises

### Exercise 1 — Design a WebSocket protocol

Design message types for:

```text
HELLO
WELCOME
SUBSCRIBE_CASE
SUBSCRIBED
CASE_UPDATED
CASE_SNAPSHOT
ERROR
HEARTBEAT
SERVER_DRAINING
UNSUBSCRIBED
```

For each message, define:

```text
required fields
optional fields
versioning rule
error cases
retry/resume behavior
```

### Exercise 2 — Slow client policy

Given:

```text
max outbound queue = 1,000 messages
max outbound bytes = 10 MB
client is 5 minutes behind
case update events are coalescible
notification events are not coalescible
```

Design a policy:

```text
which messages to drop/coalesce
when to snapshot
when to close
which metrics to emit
what close reason to use
```

### Exercise 3 — Deployment draining

Design a rolling deployment sequence for a WebSocket gateway with:

```text
10,000 active connections per node
30-second heartbeat
load balancer idle timeout 120 seconds
Kubernetes termination grace period 60 seconds
client reconnect backoff 1–30 seconds
```

Explain how to avoid reconnect storm.

### Exercise 4 — Authorization revocation

A user is removed from a case team while connected. Design:

```text
backend event
gateway reaction
client message
subscription state update
logging/audit evidence
```

### Exercise 5 — Observability dashboard

Create a dashboard layout for WebSocket production support:

```text
active connections
open/close rate
close codes
outbound queue p95/p99
slow client count
handshake failures
auth failures
message rate by type
reconnect rate
node imbalance
```

---

## 21. Key takeaways

WebSocket is powerful because it gives a persistent bidirectional channel. That same power makes it operationally dangerous.

A top-tier engineer sees WebSocket as:

```text
stateful connection ownership
bounded queues
message protocol
heartbeat/liveness
reconnect/resume
authorization lifecycle
horizontal fan-out
observability problem
security boundary
production drain problem
```

The most important rule:

> WebSocket should not be the source of truth. It should be a realtime delivery path over durable, auditable, recoverable state.

If the state matters, store it outside WebSocket. If the event matters, give it an ID. If the client can disconnect, design resume. If the client can be slow, bound the queue. If access can change, revalidate authorization. If nodes can restart, design drain.

That is the difference between a demo WebSocket and a production WebSocket platform.

---

## 22. References

- RFC 6455 — The WebSocket Protocol.
- Java SE 25 `java.net.http` package documentation — HTTP Client and WebSocket APIs.
- Java SE 11+ `java.net.http.WebSocket` API documentation.
- Jakarta WebSocket 2.2 specification and API documentation.
- MDN WebSocket API documentation, especially the note that browser `WebSocket` does not support backpressure.
- MDN WebSocketStream documentation for stream/backpressure-oriented browser API discussion.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 19 — Streaming HTTP: Server-Sent Events, Long Polling, Chunked Streaming, and Backpressure](./019-streaming-http-server-sent-events-long-polling-chunked-streaming-backpressure.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 21 — gRPC Fundamentals: RPC Model, Protobuf Contract, Stub, Channel, Server, and Service Definition](./021-grpc-fundamentals-rpc-model-protobuf-contract-stub-channel-server-service-definition.md)

</div>