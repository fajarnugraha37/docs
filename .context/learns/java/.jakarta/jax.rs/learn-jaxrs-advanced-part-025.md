# learn-jaxrs-advanced-part-025.md

# Bagian 025 — Server-Sent Events / SSE: `Sse`, `SseEventSink`, `SseBroadcaster`, Event Stream Protocol, Reconnect, `Last-Event-ID`, Heartbeat, Backpressure, Auth, Proxy Buffering, dan Production Streaming

> Target pembaca: Java/Jakarta engineer yang ingin menguasai **Server-Sent Events (SSE)** dalam JAX-RS/Jakarta REST secara production-grade. Fokus bagian ini bukan hanya “kirim event tiap detik”, tetapi memahami SSE sebagai HTTP streaming protocol satu arah: `text/event-stream`, `EventSource`, event format, `id`, `event`, `data`, `retry`, reconnect, `Last-Event-ID`, `SseEventSink`, `Sse`, `SseBroadcaster`, client disconnect, heartbeat, broadcaster lifecycle, fan-out, backpressure, auth, CORS, proxy buffering, scaling, observability, testing, dan kapan SSE lebih cocok daripada WebSocket/long polling.
>
> Namespace utama: `jakarta.ws.rs.sse.Sse`, `jakarta.ws.rs.sse.SseEventSink`, `jakarta.ws.rs.sse.OutboundSseEvent`, `jakarta.ws.rs.sse.SseBroadcaster`, `jakarta.ws.rs.sse.SseEventSource`, `jakarta.ws.rs.core.MediaType.SERVER_SENT_EVENTS`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: SSE adalah One-Way HTTP Event Stream](#2-mental-model-sse-adalah-one-way-http-event-stream)
3. [SSE vs Polling vs Long Polling vs WebSocket](#3-sse-vs-polling-vs-long-polling-vs-websocket)
4. [Kapan SSE Cocok](#4-kapan-sse-cocok)
5. [Kapan SSE Tidak Cocok](#5-kapan-sse-tidak-cocok)
6. [Browser `EventSource`](#6-browser-eventsource)
7. [Wire Protocol: `text/event-stream`](#7-wire-protocol-textevent-stream)
8. [Event Fields: `data`, `event`, `id`, `retry`](#8-event-fields-data-event-id-retry)
9. [Comment/Heartbeat Lines](#9-commentheartbeat-lines)
10. [Reconnect dan `Last-Event-ID`](#10-reconnect-dan-last-event-id)
11. [Jakarta REST SSE API Overview](#11-jakarta-rest-sse-api-overview)
12. [`SseEventSink`: One Client Connection](#12-sseeventsink-one-client-connection)
13. [`Sse`: Event Builder and Broadcaster Factory](#13-sse-event-builder-and-broadcaster-factory)
14. [`OutboundSseEvent`](#14-outboundsseevent)
15. [Basic SSE Endpoint](#15-basic-sse-endpoint)
16. [Event Builder: Name, ID, Data, Media Type, Reconnect Delay](#16-event-builder-name-id-data-media-type-reconnect-delay)
17. [Sending JSON Events](#17-sending-json-events)
18. [CompletionStage dari `send(...)`](#18-completionstage-dari-send)
19. [Closing Sink](#19-closing-sink)
20. [`SseBroadcaster`](#20-ssebroadcaster)
21. [Broadcaster Lifecycle](#21-broadcaster-lifecycle)
22. [onError dan onClose](#22-onerror-dan-onclose)
23. [Fan-Out Architecture](#23-fan-out-architecture)
24. [Topic/Channel-Based SSE](#24-topicchannel-based-sse)
25. [Per-User / Per-Tenant Streams](#25-per-user--per-tenant-streams)
26. [Connection Registry Design](#26-connection-registry-design)
27. [Backpressure: Slow Client Problem](#27-backpressure-slow-client-problem)
28. [Bounded Queues per Sink](#28-bounded-queues-per-sink)
29. [Drop, Coalesce, Disconnect, or Buffer?](#29-drop-coalesce-disconnect-or-buffer)
30. [Heartbeat Strategy](#30-heartbeat-strategy)
31. [Timeouts, Idle Connections, and Keepalive](#31-timeouts-idle-connections-and-keepalive)
32. [Proxy/Gateway/CDN Buffering](#32-proxygatewaycdn-buffering)
33. [HTTP/1.1 vs HTTP/2 Considerations](#33-http11-vs-http2-considerations)
34. [CORS and SSE](#34-cors-and-sse)
35. [Authentication and Authorization](#35-authentication-and-authorization)
36. [Token Expiry and Long-Lived Streams](#36-token-expiry-and-long-lived-streams)
37. [Cookies, CSRF, and SSE](#37-cookies-csrf-and-sse)
38. [Event ID Design](#38-event-id-design)
39. [Replay Buffer and Resume](#39-replay-buffer-and-resume)
40. [At-Most-Once, At-Least-Once, Ordering](#40-at-most-once-at-least-once-ordering)
41. [SSE as Notification, Not Source of Truth](#41-sse-as-notification-not-source-of-truth)
42. [Event Schema Design](#42-event-schema-design)
43. [Event Versioning](#43-event-versioning)
44. [Error Handling in SSE](#44-error-handling-in-sse)
45. [Client-Side Patterns](#45-client-side-patterns)
46. [Server Shutdown and Draining](#46-server-shutdown-and-draining)
47. [Horizontal Scaling](#47-horizontal-scaling)
48. [SSE with Kafka/Redis/Event Bus](#48-sse-with-kafkaredisevent-bus)
49. [SSE and Transaction Boundary](#49-sse-and-transaction-boundary)
50. [Observability](#50-observability)
51. [Metrics](#51-metrics)
52. [Tracing](#52-tracing)
53. [Logging](#53-logging)
54. [Testing SSE Server](#54-testing-sse-server)
55. [Testing SSE Browser Client](#55-testing-sse-browser-client)
56. [Testing Reconnect and Last-Event-ID](#56-testing-reconnect-and-last-event-id)
57. [Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus](#57-runtime-differences-jersey-resteasy-cxf-liberty-quarkus)
58. [SSE vs Reactive Streaming](#58-sse-vs-reactive-streaming)
59. [Common Failure Modes](#59-common-failure-modes)
60. [Best Practices](#60-best-practices)
61. [Anti-Patterns](#61-anti-patterns)
62. [Production Checklist](#62-production-checklist)
63. [Latihan](#63-latihan)
64. [Referensi Resmi](#64-referensi-resmi)
65. [Penutup](#65-penutup)

---

# 1. Tujuan Part Ini

Pada part sebelumnya kita membahas server-side async:

```text
AsyncResponse
CompletionStage
202 Accepted job resource
long polling
```

SSE adalah langkah berikutnya untuk kasus di mana client membutuhkan **stream event satu arah** dari server.

Contoh use case:

- progress export/report;
- notification badge;
- case status update;
- audit/live feed;
- dashboard metrics;
- job status;
- deployment progress;
- chat read-only stream;
- event-driven UI updates.

Browser client:

```js
const source = new EventSource("/api/notifications/stream");

source.addEventListener("case-updated", event => {
  const payload = JSON.parse(event.data);
  console.log(payload);
});
```

Server mengirim:

```text
id: 1001
event: case-updated
data: {"caseId":"C001","status":"APPROVED"}

```

## 1.1 Masalah yang sering diremehkan

SSE terlihat sederhana, tapi production SSE punya jebakan:

- koneksi bisa putus kapan saja;
- browser auto-reconnect;
- event bisa hilang jika tidak ada replay buffer;
- slow client dapat menumpuk buffer;
- proxy/gateway bisa buffering stream;
- load balancer timeout bisa memutus koneksi;
- token bisa expired saat stream masih terbuka;
- horizontal scaling butuh event bus;
- broadcaster bisa leak sink yang sudah mati;
- heartbeat diperlukan;
- CORS/cookie auth punya implikasi security;
- event schema perlu versioning.

## 1.2 Prinsip utama

```text
SSE is an HTTP response that stays open and carries a sequence of text events.
It is simple at protocol level, but operationally it is a streaming system.
```

---

# 2. Mental Model: SSE adalah One-Way HTTP Event Stream

SSE bukan request/response biasa.

SSE flow:

```text
Client opens HTTP GET
  ↓
Server responds Content-Type: text/event-stream
  ↓
Connection remains open
  ↓
Server writes event blocks over time
  ↓
Client receives events
  ↓
If connection drops, client may reconnect
```

## 2.1 One-way

SSE is server → client only.

Client can still send separate HTTP requests, but not through same SSE stream.

## 2.2 Text protocol

SSE event stream is UTF-8 text with line-based fields.

## 2.3 Built-in browser support

Browser has `EventSource`.

## 2.4 Auto-reconnect

Browser EventSource reconnects automatically unless closed.

## 2.5 Top-tier rule

```text
SSE is a persistent HTTP response, not a message queue.
Design replay, backpressure, and lifecycle explicitly.
```

---

# 3. SSE vs Polling vs Long Polling vs WebSocket

## 3.1 Polling

Client repeatedly asks:

```http
GET /notifications?since=...
```

Pros:

- simple;
- works everywhere;
- easy scaling.

Cons:

- latency;
- wasted requests;
- more load.

## 3.2 Long polling

Client sends request, server holds until event or timeout.

Pros:

- near real-time;
- HTTP compatible.

Cons:

- repeated reconnect cycle;
- more request churn than SSE.

## 3.3 SSE

Client opens one stream; server pushes events.

Pros:

- simple browser API;
- automatic reconnect;
- HTTP-friendly;
- good for server-to-client notifications.

Cons:

- one-way;
- connection management;
- proxy buffering/timeout;
- backpressure complexity.

## 3.4 WebSocket

Full-duplex bidirectional connection.

Pros:

- real-time two-way;
- lower overhead for bidirectional messages.

Cons:

- more custom protocol;
- harder with proxies/security;
- no built-in HTTP semantics per message.

## 3.5 Decision

```text
Need occasional updates, simple, one-way → SSE
Need bidirectional low-latency protocol → WebSocket
Need durable long task → 202 job + polling/SSE progress
Need simple compatibility → polling/long polling
```

---

# 4. Kapan SSE Cocok

SSE cocok ketika:

- client mostly receives updates;
- browser client;
- events are text/JSON;
- ordering per stream matters;
- reconnect is useful;
- occasional missed event can be recovered via `Last-Event-ID`;
- HTTP infrastructure can support streaming;
- number of concurrent connections manageable.

## 4.1 Good use cases

```text
GET /me/notifications/stream
GET /operations/{id}/events
GET /dashboards/{id}/metrics-stream
GET /cases/{id}/timeline-stream
```

## 4.2 Best pattern

Use SSE as notification:

```text
"Something changed; fetch canonical state if needed."
```

## 4.3 Rule

SSE is excellent for live updates, not for arbitrary bidirectional workflows.

---

# 5. Kapan SSE Tidak Cocok

Avoid SSE when:

- client must send frequent messages over same connection;
- binary streaming is needed;
- each event must be durably delivered exactly once;
- client count massive but infra not designed;
- proxies cannot stream;
- mobile/network constraints make long connections unreliable;
- event volume high and backpressure not solved;
- auth token refresh cannot be handled.

## 5.1 Use alternatives

- WebSocket for bidirectional;
- message broker for durable delivery;
- polling for simple low-frequency;
- async job resource for durable long work;
- push notification system for offline/mobile.

## 5.2 Rule

SSE is not a replacement for Kafka, WebSocket, or durable notification storage.

---

# 6. Browser `EventSource`

Browser API:

```js
const events = new EventSource("/api/stream");

events.onmessage = event => {
  console.log(event.data);
};

events.addEventListener("case-updated", event => {
  const data = JSON.parse(event.data);
});

events.onerror = error => {
  console.log("stream error", error);
};

events.close();
```

## 6.1 Default method

`EventSource` uses GET.

## 6.2 Headers

Native EventSource cannot set arbitrary headers directly in many browsers.

This affects Bearer token auth.

## 6.3 Cookies

EventSource can use cookies depending same-origin/CORS credentials behavior.

## 6.4 Reconnect

Browser reconnects automatically.

## 6.5 Rule

Browser EventSource is convenient, but auth/header limitations shape API design.

---

# 7. Wire Protocol: `text/event-stream`

SSE response must use:

```http
Content-Type: text/event-stream
```

JAX-RS:

```java
@Produces(MediaType.SERVER_SENT_EVENTS)
```

## 7.1 Event block

```text
data: hello

```

Event ends with blank line.

## 7.2 Multi-line data

```text
data: line 1
data: line 2

```

Client receives data with newline between lines.

## 7.3 Named event

```text
event: case-updated
data: {"caseId":"C001"}

```

## 7.4 Rule

SSE is line-based; each event is terminated by an empty line.

---

# 8. Event Fields: `data`, `event`, `id`, `retry`

## 8.1 `data`

Payload.

```text
data: {"message":"hello"}
```

## 8.2 `event`

Event name/type.

```text
event: notification
```

If absent, browser dispatches default `message` event.

## 8.3 `id`

Event ID.

```text
id: 1001
```

Browser stores last event ID.

## 8.4 `retry`

Reconnect delay in milliseconds.

```text
retry: 5000
```

## 8.5 Rule

Use `id` if you need resume/replay. Use `event` if client needs typed handlers.

---

# 9. Comment/Heartbeat Lines

SSE supports comment lines starting with colon.

```text
: heartbeat

```

## 9.1 Purpose

Heartbeat keeps connection active through proxies/load balancers and detects dead clients.

## 9.2 Frequency

Depends on infrastructure timeout.

Example:

```text
15s–30s
```

if gateway idle timeout is 60s.

## 9.3 Do not spam

Too frequent heartbeat increases traffic.

## 9.4 Rule

Heartbeat interval must be less than the smallest relevant idle timeout.

---

# 10. Reconnect dan `Last-Event-ID`

When connection drops, browser reconnects.

If it has seen event ID, it sends:

```http
Last-Event-ID: 1001
```

## 10.1 Server responsibility

Server can resume from after ID 1001 if it has replay buffer.

## 10.2 If no replay buffer

Server can:

- send current snapshot event;
- send “resync required” event;
- close with instruction;
- let client fetch state.

## 10.3 Important

`Last-Event-ID` is not magic persistence.

It is just a client-provided last seen ID.

## 10.4 Rule

If you promise resume, maintain server-side replay buffer or durable event log.

---

# 11. Jakarta REST SSE API Overview

Jakarta REST SSE APIs live in:

```java
jakarta.ws.rs.sse
```

Core types:

```java
SseEventSink
Sse
OutboundSseEvent
SseBroadcaster
SseEventSource
InboundSseEvent
```

## 11.1 Server side

- `SseEventSink`: a single outbound stream to one client.
- `Sse`: factory for events and broadcasters.
- `SseBroadcaster`: broadcast to multiple sinks.
- `OutboundSseEvent`: event to send.

## 11.2 Client side

- `SseEventSource`: JAX-RS client SSE reader.
- `InboundSseEvent`: received event.

## 11.3 Rule

JAX-RS SSE API gives you stream primitives; production architecture is still yours.

---

# 12. `SseEventSink`: One Client Connection

`SseEventSink` represents outbound SSE stream for one client HTTP connection.

## 12.1 Injection

```java
@GET
@Path("/stream")
@Produces(MediaType.SERVER_SENT_EVENTS)
public void stream(@Context SseEventSink sink, @Context Sse sse) {
    ...
}
```

## 12.2 One sink = one connection

Do not share one sink for multiple clients.

## 12.3 Thread safe

API docs state injected sink is thread safe.

## 12.4 Methods

```java
CompletionStage<?> send(OutboundSseEvent event)
boolean isClosed()
void close()
```

## 12.5 Rule

Treat `SseEventSink` as a network connection resource that must be closed/cleaned.

---

# 13. `Sse`: Event Builder and Broadcaster Factory

`Sse` is server-side entry point.

## 13.1 Injection

```java
@Context
Sse sse;
```

## 13.2 Create event

```java
OutboundSseEvent event = sse.newEvent("hello");
```

## 13.3 Event builder

```java
OutboundSseEvent event = sse.newEventBuilder()
    .name("case-updated")
    .id("1001")
    .mediaType(MediaType.APPLICATION_JSON_TYPE)
    .data(payload)
    .build();
```

## 13.4 Broadcaster

```java
SseBroadcaster broadcaster = sse.newBroadcaster();
```

## 13.5 Thread-safe

API docs state `Sse` can be shared/invoked from different threads.

## 13.6 Rule

Use `Sse` as factory, not as connection state.

---

# 14. `OutboundSseEvent`

Represents one event sent to client.

## 14.1 Common properties

- name;
- id;
- data;
- media type;
- comment;
- reconnect delay.

## 14.2 String event

```java
sse.newEvent("hello")
```

## 14.3 Named event

```java
sse.newEvent("notification", "hello")
```

## 14.4 JSON event

```java
sse.newEventBuilder()
   .name("notification")
   .mediaType(MediaType.APPLICATION_JSON_TYPE)
   .data(NotificationDto.class, dto)
   .build();
```

## 14.5 Rule

Design event fields as part of client contract.

---

# 15. Basic SSE Endpoint

## 15.1 Simple endpoint

```java
@Path("/events")
public class EventResource {

    @GET
    @Path("/time")
    @Produces(MediaType.SERVER_SENT_EVENTS)
    public void streamTime(@Context SseEventSink sink, @Context Sse sse) {
        ScheduledExecutorService executor = ...;

        executor.scheduleAtFixedRate(() -> {
            if (sink.isClosed()) {
                return;
            }

            OutboundSseEvent event = sse.newEventBuilder()
                .name("time")
                .data(Instant.now().toString())
                .build();

            sink.send(event);
        }, 0, 1, TimeUnit.SECONDS);
    }
}
```

## 15.2 Problem with this simple code

It does not:

- cancel scheduled task when client disconnects;
- close sink;
- handle send failure;
- limit connections;
- handle auth;
- handle shutdown.

## 15.3 Production endpoint needs registry/cleanup.

## 15.4 Rule

Hello-world SSE is not production SSE.

---

# 16. Event Builder: Name, ID, Data, Media Type, Reconnect Delay

## 16.1 Example

```java
OutboundSseEvent event = sse.newEventBuilder()
    .id("case-000001")
    .name("case-updated")
    .mediaType(MediaType.APPLICATION_JSON_TYPE)
    .data(CaseUpdatedEvent.class, payload)
    .reconnectDelay(5000)
    .build();
```

## 16.2 `id`

Used for resume/reconnect.

## 16.3 `name`

Used by browser `addEventListener`.

## 16.4 `data`

Serialized data payload.

## 16.5 `reconnectDelay`

Maps to SSE `retry` field.

## 16.6 Rule

Every event type should have documented schema and meaning.

---

# 17. Sending JSON Events

## 17.1 Payload DTO

```java
public record CaseUpdatedEvent(
    String caseId,
    String status,
    Instant occurredAt
) {}
```

## 17.2 Event

```java
OutboundSseEvent event = sse.newEventBuilder()
    .name("case-updated")
    .id(eventId)
    .mediaType(MediaType.APPLICATION_JSON_TYPE)
    .data(CaseUpdatedEvent.class, dto)
    .build();
```

## 17.3 Client

```js
source.addEventListener("case-updated", e => {
  const payload = JSON.parse(e.data);
});
```

## 17.4 Contract

Document event schema separately from REST resource response schema.

## 17.5 Rule

SSE data can be JSON, but the stream protocol remains text/event-stream.

---

# 18. CompletionStage dari `send(...)`

`SseEventSink#send` returns `CompletionStage<?>`.

## 18.1 Use it

```java
sink.send(event).whenComplete((ignored, error) -> {
    if (error != null) {
        cleanupSink(sink, error);
    }
});
```

## 18.2 Why

Send may fail due to:

- client disconnect;
- broken pipe;
- serialization error;
- container issue;
- backpressure.

## 18.3 Do not ignore failures

Ignoring send failures leaks dead connections.

## 18.4 Rule

Every send needs failure handling or broadcaster onError handling.

---

# 19. Closing Sink

## 19.1 Close

```java
sink.close();
```

## 19.2 When

- client unsubscribe;
- server shutdown;
- auth expires;
- stream complete;
- unrecoverable error;
- overload policy.

## 19.3 After close

Subsequent send should not be attempted.

## 19.4 Cleanup

Remove from registry.

## 19.5 Rule

Closing is part of resource lifecycle, not optional.

---

# 20. `SseBroadcaster`

`SseBroadcaster` manages multiple sinks.

## 20.1 Create

```java
SseBroadcaster broadcaster = sse.newBroadcaster();
```

## 20.2 Register sink

```java
broadcaster.register(sink);
```

## 20.3 Broadcast

```java
broadcaster.broadcast(event);
```

## 20.4 Thread safe

API docs state broadcaster is thread safe.

## 20.5 Rule

Use broadcaster for simple fan-out, but understand its lifecycle and scaling limits.

---

# 21. Broadcaster Lifecycle

## 21.1 Application scoped

Create broadcaster after `Sse` is available.

Depending runtime, you may initialize in first resource call or via managed component.

## 21.2 Close

```java
broadcaster.close();
```

or:

```java
broadcaster.close(true);
```

## 21.3 Cascading

Cascading close controls whether registered sinks are closed too.

## 21.4 Shutdown

On application shutdown, close broadcasters and sinks.

## 21.5 Rule

Broadcaster is an application resource with lifecycle.

---

# 22. onError dan onClose

## 22.1 onError

```java
broadcaster.onError((sink, throwable) -> {
    registry.remove(sink);
    closeQuietly(sink);
});
```

Called when exception occurs while writing/closing sink.

## 22.2 onClose

```java
broadcaster.onClose(sink -> {
    registry.remove(sink);
});
```

Called when broadcaster closes a sink or detects closed sink.

## 22.3 Use for cleanup

Do not let stale sinks accumulate.

## 22.4 Rule

Register onError/onClose handlers before accepting many clients.

---

# 23. Fan-Out Architecture

Fan-out means one event goes to many connections.

## 23.1 Simple single-node

```text
event producer → SseBroadcaster → all sinks
```

## 23.2 Multi-topic

```text
event producer → topic router → topic broadcaster
```

## 23.3 Multi-node

```text
event bus → each app node → local connected sinks
```

## 23.4 Rule

SseBroadcaster broadcasts within one application instance; cluster fan-out needs shared event bus.

---

# 24. Topic/Channel-Based SSE

## 24.1 Endpoint

```http
GET /topics/{topic}/stream
```

## 24.2 Registry

```java
Map<TopicId, SseBroadcaster> broadcasters;
```

## 24.3 Authorization

Caller must be allowed to subscribe to topic.

## 24.4 Cleanup

Remove empty/expired topic broadcasters if dynamic.

## 24.5 Rule

Topics are security and resource-management boundaries.

---

# 25. Per-User / Per-Tenant Streams

## 25.1 User stream

```http
GET /me/events
```

## 25.2 Tenant stream

```http
GET /tenants/{tenantId}/events
```

## 25.3 Event filtering

Never broadcast tenant A event to tenant B sink.

## 25.4 Authorization

Check subscription at connection time and possibly per event.

## 25.5 Rule

Per-user/per-tenant SSE must enforce isolation at fan-out layer.

---

# 26. Connection Registry Design

## 26.1 Connection object

```java
public record SseConnection(
    String connectionId,
    UserId userId,
    TenantId tenantId,
    SseEventSink sink,
    Instant connectedAt,
    AtomicLong lastSentEventId
) {}
```

## 26.2 Registry

```java
ConcurrentHashMap<String, SseConnection> connections = new ConcurrentHashMap<>();
```

## 26.3 Indexes

May need:

```text
by connectionId
by userId
by tenantId
by topic
```

## 26.4 Cleanup

On close/error/disconnect/timeout/shutdown.

## 26.5 Rule

A registry is required once you go beyond trivial single broadcaster.

---

# 27. Backpressure: Slow Client Problem

SSE writes to network.

Slow clients can cause:

- send completion delays;
- memory buffering;
- thread blocking;
- broadcaster slowdowns;
- out-of-order cleanup;
- global fan-out delay.

## 27.1 Backpressure question

What happens if client cannot receive fast enough?

Possible policies:

- buffer;
- drop events;
- coalesce;
- disconnect;
- switch to snapshot notification.

## 27.2 Do not assume send is always fast

`send` returns CompletionStage for a reason.

## 27.3 Rule

Every streaming system must define slow-consumer policy.

---

# 28. Bounded Queues per Sink

For high-throughput events, use per-sink queue.

## 28.1 Model

```text
producer → per-sink bounded queue → sender loop → SseEventSink
```

## 28.2 Queue limit

Example:

```text
100 events per connection
```

## 28.3 When full

Policy:

- drop oldest;
- drop newest;
- coalesce;
- disconnect slow client;
- send resync-required event.

## 28.4 Rule

Never use unbounded per-client event buffers.

---

# 29. Drop, Coalesce, Disconnect, or Buffer?

## 29.1 Drop

Good for metrics/dashboard updates.

Bad for audit/critical notifications.

## 29.2 Coalesce

Good for state update notifications.

Example:

```text
many progress events → keep latest progress
```

## 29.3 Disconnect

Good when client is too slow and can reconnect/resync.

## 29.4 Buffer

Good if bounded and events are important.

## 29.5 Rule

Backpressure policy depends on event semantics.

---

# 30. Heartbeat Strategy

## 30.1 Event heartbeat

```text
event: heartbeat
data: {}

```

## 30.2 Comment heartbeat

```text
: heartbeat

```

Comment is ignored by EventSource message handlers but keeps connection active.

## 30.3 JAX-RS event

```java
OutboundSseEvent heartbeat = sse.newEventBuilder()
    .comment("heartbeat")
    .build();
```

if builder supports comment in runtime/API.

## 30.4 Frequency

Less than smallest idle timeout.

## 30.5 Rule

Heartbeat is operational requirement, not feature flourish.

---

# 31. Timeouts, Idle Connections, and Keepalive

SSE connections are long-lived.

Timeout sources:

- browser/network;
- mobile network;
- load balancer idle timeout;
- reverse proxy;
- servlet container;
- gateway;
- CDN;
- app server.

## 31.1 Need alignment

If load balancer idle timeout is 60s, send heartbeat at 25s or 30s.

## 31.2 App timeout

Do not use normal request timeout that kills stream too early.

## 31.3 Rule

SSE timeout design is infrastructure design.

---

# 32. Proxy/Gateway/CDN Buffering

Many proxies buffer responses by default.

## 32.1 Symptom

Server sends events, client receives them only after buffer fills or connection closes.

## 32.2 Need disable buffering

Depending proxy:

- NGINX `proxy_buffering off`;
- header `X-Accel-Buffering: no` in some setups;
- gateway streaming mode;
- CDN streaming support.

## 32.3 Compression

Compression may buffer chunks.

Disable or test.

## 32.4 Rule

SSE must be tested through actual gateway/proxy/CDN path.

---

# 33. HTTP/1.1 vs HTTP/2 Considerations

## 33.1 HTTP/1.1

Each SSE stream uses one connection.

Browser per-origin connection limits can matter.

## 33.2 HTTP/2

Multiplexing helps connection limits, but proxy/runtime support matters.

## 33.3 Head-of-line and buffering

Still need test.

## 33.4 Rule

Transport version affects capacity and behavior but does not remove backpressure concerns.

---

# 34. CORS and SSE

Cross-origin EventSource requires CORS.

## 34.1 Server

```http
Access-Control-Allow-Origin: https://app.example.com
```

## 34.2 Credentials

Native EventSource supports credentials via option in modern browsers:

```js
new EventSource(url, { withCredentials: true });
```

Server needs:

```http
Access-Control-Allow-Credentials: true
```

and exact origin.

## 34.3 Preflight?

EventSource GET with simple headers usually avoids preflight.

But custom headers are not available in native EventSource.

## 34.4 Rule

CORS for SSE is mostly actual response CORS, not custom-header preflight.

---

# 35. Authentication and Authorization

## 35.1 Cookie auth

Works naturally with EventSource, but CSRF/CORS/SameSite matters.

## 35.2 Bearer token

Native EventSource cannot set Authorization header directly.

Options:

- same-origin cookie/session;
- short-lived token in query string (risky);
- polyfill/fetch-based SSE client;
- BFF;
- custom endpoint that upgrades after authenticated session.

## 35.3 Query token risk

URLs are logged in proxies/history/referrers.

Avoid long-lived secrets in query.

## 35.4 Authorization

Check:

- can user subscribe to stream?
- can user receive each event?
- tenant isolation.

## 35.5 Rule

Design SSE authentication based on browser limitations and threat model.

---

# 36. Token Expiry and Long-Lived Streams

If token expires while stream is open, what happens?

## 36.1 Options

- close stream at token expiry;
- send auth-expiring event;
- rely on backend session validation per event;
- use short stream lifetime and reconnect;
- BFF/session.

## 36.2 Avoid infinite authorization

Do not let stream remain authorized forever after one initial token check if policy requires expiry enforcement.

## 36.3 Rule

Long-lived streams need auth lifetime policy.

---

# 37. Cookies, CSRF, and SSE

SSE is usually GET.

GET should be safe.

## 37.1 CSRF risk

SSE GET should not mutate state.

However, if SSE endpoint reveals sensitive data, CORS and same-site/cookie policy matter.

## 37.2 Cookie auth

Use:

- SameSite;
- CORS allowlist;
- credentials policy;
- authorization check.

## 37.3 Do not start side effects on connect

Connecting to stream should not perform state-changing operation except safe audit/logging.

## 37.4 Rule

SSE endpoint must be safe GET but still protected if data is sensitive.

---

# 38. Event ID Design

Event ID should support resume and ordering.

## 38.1 Options

- monotonically increasing sequence;
- Kafka offset;
- database event ID;
- timestamp + sequence;
- ULID/KSUID with ordering.

## 38.2 Scope

Define ID scope:

```text
global
tenant
user
topic
operation
```

## 38.3 Client treats opaque

Client should send `Last-Event-ID`, not parse it.

## 38.4 Rule

Event ID is resume token, not necessarily business ID.

---

# 39. Replay Buffer and Resume

## 39.1 In-memory buffer

Good for small single-node/non-critical streams.

```text
last 1000 events per topic
```

## 39.2 Durable event log

Good for reliable resume.

Examples:

- Kafka topic offset;
- database outbox table;
- Redis stream.

## 39.3 Resume flow

1. Client reconnects with `Last-Event-ID`.
2. Server finds events after that ID.
3. Server sends missed events.
4. Then continues live stream.

## 39.4 If ID too old

Send:

```text
event: resync-required
data: {"reason":"EVENT_ID_EXPIRED"}
```

Client fetches snapshot.

## 39.5 Rule

Resume only works if server can map last ID to missed events.

---

# 40. At-Most-Once, At-Least-Once, Ordering

## 40.1 At-most-once

Event may be lost.

Simplest SSE.

## 40.2 At-least-once

With replay, client may receive duplicates after reconnect.

Client must deduplicate by event ID.

## 40.3 Exactly-once

Not realistic end-to-end over SSE/browser.

## 40.4 Ordering

Define ordering per stream/topic.

## 40.5 Rule

Design client as idempotent event consumer.

---

# 41. SSE as Notification, Not Source of Truth

Best practice:

```text
SSE event says what changed.
REST GET fetches canonical state.
```

## 41.1 Example event

```json
{
  "type": "case-updated",
  "caseId": "C001",
  "version": 12
}
```

Client then:

```http
GET /cases/C001
```

## 41.2 Benefits

- smaller events;
- less sensitive data in stream;
- canonical resource remains REST endpoint;
- easier recovery.

## 41.3 Rule

For important data, use SSE to notify and REST to reconcile.

---

# 42. Event Schema Design

## 42.1 Basic envelope

```json
{
  "id": "evt-1001",
  "type": "case-updated",
  "version": 1,
  "occurredAt": "2026-06-12T10:00:00Z",
  "data": {
    "caseId": "C001",
    "caseVersion": 12
  }
}
```

## 42.2 Include

- event ID;
- event type;
- schema version;
- occurredAt;
- data;
- correlation ID if safe.

## 42.3 Avoid

- secrets;
- excessive PII;
- entire aggregate if not needed;
- internal DB schema.

## 42.4 Rule

SSE event schemas need versioning and data minimization.

---

# 43. Event Versioning

## 43.1 Version field

```json
"version": 1
```

## 43.2 Event type version

```text
case-updated.v1
```

## 43.3 Backward compatible changes

- add optional fields;
- add new event types.

## 43.4 Breaking changes

- rename fields;
- change meaning;
- remove fields.

## 43.5 Rule

Treat event schema as public API contract.

---

# 44. Error Handling in SSE

## 44.1 Before stream starts

Normal HTTP error:

```http
401
403
404
```

## 44.2 After stream starts

Cannot send normal HTTP status for individual event error.

Send event:

```text
event: error
data: {"code":"STREAM_AUTH_EXPIRED"}

```

then optionally close.

## 44.3 Client onerror

Browser `onerror` often means connection problem, not necessarily server error event.

## 44.4 Rule

Distinguish protocol connection error from application error event.

---

# 45. Client-Side Patterns

## 45.1 Reconnect

EventSource auto reconnects.

## 45.2 Close intentionally

```js
source.close();
```

## 45.3 Deduplicate

Track event ID.

```js
if (seen.has(event.lastEventId)) return;
```

## 45.4 Resync

On `resync-required`, fetch snapshot.

## 45.5 Backoff

Server can send retry field.

## 45.6 Rule

Client must handle duplicates, disconnects, and resync.

---

# 46. Server Shutdown and Draining

## 46.1 During shutdown

- stop accepting new SSE connections;
- send shutdown event if possible;
- close sinks;
- unregister broadcasters;
- stop executors.

## 46.2 Event

```text
event: server-draining
data: {"retryAfterMs":5000}

```

## 46.3 Kubernetes

Readiness should fail before closing active connections.

## 46.4 Rule

SSE service needs graceful drain strategy.

---

# 47. Horizontal Scaling

## 47.1 Problem

Client connected to node A.

Event produced on node B.

Need node A to receive event.

## 47.2 Solutions

- sticky sessions plus event routing;
- shared event bus;
- Redis Pub/Sub/Streams;
- Kafka topic;
- database polling/outbox;
- dedicated notification service.

## 47.3 Sticky sessions alone

Not enough if event producers are everywhere.

## 47.4 Rule

Clustered SSE requires distributed event fan-out design.

---

# 48. SSE with Kafka/Redis/Event Bus

## 48.1 Kafka

Good for durable ordered event log.

Pattern:

```text
Kafka topic → SSE node consumer → local sinks
```

Need offset/event ID mapping.

## 48.2 Redis Pub/Sub

Good for low-latency non-durable fan-out.

## 48.3 Redis Streams

Can support replay.

## 48.4 Database outbox

Good when events originate from DB transactions.

Can poll or stream via connector.

## 48.5 Rule

Choose event bus based on durability/replay/ordering needs.

---

# 49. SSE and Transaction Boundary

Do not send event before transaction commits.

## 49.1 Bad

```text
update DB
send SSE
commit fails
```

Client saw false event.

## 49.2 Better

- commit transaction;
- publish domain/outbox event;
- SSE bridge emits after committed event.

## 49.3 Outbox

Persist event with state change atomically.

## 49.4 Rule

SSE should publish committed facts, not speculative changes.

---

# 50. Observability

SSE observability needs connection and event views.

## 50.1 Connection view

- active connections;
- connection duration;
- disconnect reason;
- per-user/tenant/topic counts;
- connection errors.

## 50.2 Event view

- events sent;
- events failed;
- broadcast latency;
- queue depth;
- replay count;
- dropped/coalesced events.

## 50.3 Rule

If you cannot see active connections and slow consumers, SSE will be painful to operate.

---

# 51. Metrics

Suggested metrics:

```text
sse_connections_active{stream}
sse_connections_opened_total{stream}
sse_connections_closed_total{stream,reason}
sse_events_sent_total{stream,event}
sse_events_failed_total{stream,event,reason}
sse_send_duration_seconds{stream}
sse_broadcast_duration_seconds{stream}
sse_queue_depth{stream}
sse_events_dropped_total{stream,reason}
sse_reconnect_total{stream}
sse_resume_success_total{stream}
sse_resume_failed_total{stream,reason}
```

## 51.1 Labels

Keep low cardinality.

Avoid:

- user ID;
- raw tenant ID if too many;
- event ID;
- connection ID.

## 51.2 Rule

Metrics should reveal capacity, reliability, and client health.

---

# 52. Tracing

## 52.1 Event origin trace

If event comes from command/request, propagate correlation ID into event metadata.

## 52.2 Streaming span

Long-running stream span can be problematic.

Better use:

- connection lifecycle metrics;
- event send spans/events sampled;
- producer-to-send latency.

## 52.3 Rule

Do not create unbounded long traces for every open SSE connection without strategy.

---

# 53. Logging

## 53.1 Log

- connection open/close;
- auth failure;
- topic subscription denied;
- send failure;
- buffer overflow;
- resume failure;
- shutdown drain.

## 53.2 Do not log

- full event payload if sensitive;
- tokens;
- cookies;
- raw user PII;
- every heartbeat.

## 53.3 Rule

SSE logs should be lifecycle/error oriented, not event spam.

---

# 54. Testing SSE Server

## 54.1 Integration test

Use JAX-RS client `SseEventSource` or raw HTTP client.

## 54.2 Test

- status 200;
- content type `text/event-stream`;
- receives event;
- named event;
- JSON data;
- event ID;
- close behavior;
- send failure cleanup.

## 54.3 Avoid sleep-heavy tests

Use latches and deterministic event trigger.

## 54.4 Rule

SSE tests must control timing.

---

# 55. Testing SSE Browser Client

## 55.1 Browser E2E

Test with real browser:

- `EventSource` opens;
- event handlers fire;
- reconnect works;
- `withCredentials` works;
- CORS headers accepted;
- client closes connection.

## 55.2 DevTools

Inspect event stream.

## 55.3 Rule

Browser EventSource behavior cannot be fully proven with curl only.

---

# 56. Testing Reconnect and Last-Event-ID

## 56.1 Scenario

1. Client receives event ID 100.
2. Connection drops.
3. Client reconnects with `Last-Event-ID: 100`.
4. Server sends 101+.

## 56.2 Test stale ID

If ID expired:

```text
resync-required
```

## 56.3 Duplicate handling

Client should ignore duplicate ID if server replays inclusive.

## 56.4 Rule

Resume behavior must be contract-tested.

---

# 57. Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus

## 57.1 Standard API

SSE interfaces are standard since JAX-RS 2.1/Jakarta REST.

## 57.2 Differences

- streaming flush behavior;
- proxy/server integration;
- async IO implementation;
- broadcaster behavior under slow clients;
- client disconnect detection;
- CDI injection;
- native image support;
- reactive variants.

## 57.3 Rule

Test SSE on exact runtime/container/gateway stack.

---

# 58. SSE vs Reactive Streaming

SSE is HTTP event stream format.

Reactive streaming is programming/backpressure model.

## 58.1 Can combine

Reactive source → SSE sink.

## 58.2 Need bridge

Reactive backpressure must be mapped to SSE slow-client policy.

## 58.3 Do not assume

`SseBroadcaster` alone gives end-to-end reactive backpressure.

## 58.4 Rule

SSE protocol and reactive streams solve different layers.

---

# 59. Common Failure Modes

## 59.1 Proxy buffering

Client receives events late.

## 59.2 No heartbeat

Idle timeout disconnects clients.

## 59.3 No cleanup

Dead sinks leak memory.

## 59.4 Ignoring send CompletionStage

Failures invisible.

## 59.5 Unbounded buffers

Memory explosion.

## 59.6 No Last-Event-ID handling

Reconnect loses events.

## 59.7 Token in query string

Secret leakage.

## 59.8 Tenant leak in broadcaster

Cross-tenant event exposure.

## 59.9 Events emitted before commit

False notifications.

## 59.10 Event schema unversioned

Client breaks silently.

## 59.11 Too much data in event

PII/performance risk.

## 59.12 SSE used for durable messaging

Wrong reliability expectation.

---

# 60. Best Practices

## 60.1 Use SSE for one-way live updates

Not bidirectional workflows.

## 60.2 Use `text/event-stream`

Declare `@Produces(MediaType.SERVER_SENT_EVENTS)`.

## 60.3 Use event IDs

If reconnect/replay matters.

## 60.4 Maintain replay buffer or send resync-required

Do not fake resume.

## 60.5 Add heartbeat

Less than idle timeout.

## 60.6 Handle send failures

Use CompletionStage/onError/onClose.

## 60.7 Bound connections and buffers

Backpressure policy required.

## 60.8 Enforce tenant/user authorization

At subscribe and event fan-out.

## 60.9 Test through gateway

Proxy buffering/timeout matters.

## 60.10 Publish only committed events

Use outbox/event bus.

---

# 61. Anti-Patterns

## 61.1 SSE endpoint with no close/cleanup

Leak.

## 61.2 Broadcasting all events to all users

Data breach.

## 61.3 Unbounded per-client queue

Memory leak.

## 61.4 Ignoring client disconnect

Waste.

## 61.5 Heartbeat every 100ms

Waste.

## 61.6 No event ID but claiming resume

False guarantee.

## 61.7 Native EventSource with bearer token in query

Secret leak.

## 61.8 SSE for request/response commands

Use POST.

## 61.9 SSE for exactly-once delivery

Wrong tool.

## 61.10 No schema/version docs

Client fragility.

---

# 62. Production Checklist

## 62.1 Protocol

- [ ] Endpoint uses `GET`.
- [ ] Produces `text/event-stream`.
- [ ] Event format documented.
- [ ] Event names documented.
- [ ] Event schemas versioned.
- [ ] Event IDs defined if resume matters.
- [ ] Retry behavior defined.

## 62.2 Connection lifecycle

- [ ] Sink cleanup on close/error.
- [ ] Heartbeat configured.
- [ ] Server/gateway idle timeout aligned.
- [ ] Shutdown drain defined.
- [ ] Max connections enforced.
- [ ] Client disconnect behavior tested.

## 62.3 Backpressure

- [ ] Slow-client policy defined.
- [ ] Buffers bounded.
- [ ] Drop/coalesce/disconnect policy documented.
- [ ] Send failures handled.
- [ ] Broadcaster errors handled.
- [ ] Metrics for queue/drops.

## 62.4 Security

- [ ] Authentication model chosen.
- [ ] No long-lived token in query.
- [ ] CORS configured if browser cross-origin.
- [ ] Credentials policy correct.
- [ ] Tenant/user isolation enforced.
- [ ] Token expiry policy defined.
- [ ] Event payload minimized.

## 62.5 Scaling/reliability

- [ ] Multi-node fan-out design exists.
- [ ] Event bus/replay store chosen if needed.
- [ ] Last-Event-ID resume tested.
- [ ] Outbox/commit ordering handled.
- [ ] Proxy buffering disabled/tested.
- [ ] CDN/gateway streaming supported.

## 62.6 Observability/testing

- [ ] Active connection metrics.
- [ ] Event send metrics.
- [ ] Drop/retry/resume metrics.
- [ ] Browser test.
- [ ] Gateway test.
- [ ] Reconnect test.
- [ ] Shutdown test.

---

# 63. Latihan

## Latihan 1 — Basic SSE

Implement:

```http
GET /events/time
```

Send named event:

```text
event: time
data: ...
```

every second for 5 events, then close.

## Latihan 2 — JSON SSE Event

Send:

```text
event: case-updated
id: ...
data: {"caseId":"C001","status":"APPROVED"}
```

Client parses JSON.

## Latihan 3 — Broadcaster

Create `/notifications/stream`.

Register each sink to broadcaster.

Create `POST /notifications/test` to broadcast event.

## Latihan 4 — onError/onClose Cleanup

Simulate client disconnect.

Ensure registry count decreases.

## Latihan 5 — Heartbeat

Send comment heartbeat every 20s.

Test connection survives proxy idle timeout.

## Latihan 6 — Last-Event-ID Resume

Maintain ring buffer last 100 events.

Reconnect with `Last-Event-ID`.

Replay missed events.

## Latihan 7 — Slow Client Policy

Create bounded queue per connection.

If full, send `resync-required` then close.

## Latihan 8 — Tenant Isolation

Tenant A and Tenant B connect.

Broadcast tenant A event.

Assert tenant B does not receive.

## Latihan 9 — Gateway Buffering Test

Run behind NGINX/API gateway.

Verify events arrive immediately, not buffered.

---

# 64. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `jakarta.ws.rs.sse` Package  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/sse/package-summary

2. Jakarta RESTful Web Services 4.0 — `SseEventSink` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/sse/sseeventsink

3. Jakarta RESTful Web Services 4.0 — `Sse` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/sse/sse

4. Jakarta RESTful Web Services 4.0 — `SseBroadcaster` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/sse/ssebroadcaster

5. Jakarta EE Tutorial — Overview of the SSE API  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest-client/rest-client.html

6. WHATWG HTML Living Standard — Server-sent events  
   https://html.spec.whatwg.org/multipage/server-sent-events.html

7. WHATWG HTML Living Standard — `Last-Event-ID` Header  
   https://html.spec.whatwg.org/dev/server-sent-events.html

8. MDN — Using server-sent events  
   https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events

9. MDN — EventSource  
   https://developer.mozilla.org/en-US/docs/Web/API/EventSource

10. RFC 9110 — HTTP Semantics  
    https://www.rfc-editor.org/rfc/rfc9110.html

---

# 65. Penutup

SSE adalah fitur sederhana di permukaan, tetapi production streaming membutuhkan desain serius.

Mental model final:

```text
SSE = long-lived HTTP GET response
      Content-Type: text/event-stream
      server writes event blocks over time
      browser EventSource reconnects automatically
```

JAX-RS mental model:

```text
SseEventSink = one client stream
Sse = event/broadcaster factory
OutboundSseEvent = one event
SseBroadcaster = fan-out to registered sinks
SseEventSource = JAX-RS client SSE reader
```

Prinsip final:

```text
SSE is not durable messaging.
SSE is not bidirectional protocol.
SSE is a live notification stream over HTTP.
```

Top-tier JAX-RS engineer memastikan:

- event schema/version jelas;
- event ID dan resume semantics didefinisikan;
- heartbeat disesuaikan dengan gateway timeout;
- send failure dan disconnect dibersihkan;
- buffer/backpressure bounded;
- tenant/user authorization aman;
- token/cookie/CORS strategy sesuai browser;
- proxy buffering dites;
- horizontal scaling memakai event bus;
- event dikirim setelah transaction commit;
- observability melihat active connections, sends, drops, reconnects.

Part berikutnya:

```text
Bagian 026 — Streaming Responses: StreamingOutput, Chunking, Large Download
```

Kita akan membahas streaming response untuk large download dan generated content: `StreamingOutput`, chunking, content length, range requests, file streaming, backpressure, error after commit, compression, checksums, and production-safe download APIs.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 024 — Asynchronous JAX-RS Server: `AsyncResponse`, `@Suspended`, `CompletionStage`, Timeouts, Cancellation, Lifecycle Callbacks, Executor Model, Backpressure, and Production-Safe Async APIs](./learn-jaxrs-advanced-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Bagian 026 — Streaming Responses: `StreamingOutput`, Chunking, Large Download, File Streaming, Range Requests, Backpressure, Error After Commit, Compression, Checksums, and Production-Safe Download APIs](./learn-jaxrs-advanced-part-026.md)
