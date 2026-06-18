# learn-java-jakarta-part-025.md

# Bagian 25 — Jakarta WebSocket (`jakarta.websocket`): Full-Duplex Communication, Session, Backpressure, dan Real-Time Reliability

> Target pembaca: Java engineer yang ingin memahami Jakarta WebSocket bukan hanya “chat demo”, tetapi sebagai **runtime komunikasi full-duplex** untuk real-time applications: endpoint lifecycle, WebSocket session, message handler, encoder/decoder, async send, flow control, authentication, scaling multi-node, state management, observability, dan production failure modes.
>
> Fokus bagian ini: Jakarta WebSocket 2.2, `@ServerEndpoint`, `@ClientEndpoint`, `Session`, `RemoteEndpoint.Basic`, `RemoteEndpoint.Async`, `@OnOpen`, `@OnMessage`, `@OnClose`, `@OnError`, path params, handshake, configurator, encoders/decoders, subprotocol, ping/pong, close codes, backpressure, broadcasting, clustering, auth, testing, and when to choose WebSocket vs REST/SSE/messaging.

---

## Daftar Isi

1. [Orientasi: WebSocket Bukan Hanya Chat](#1-orientasi-websocket-bukan-hanya-chat)
2. [Mental Model: HTTP Upgrade ke Long-Lived Full-Duplex Connection](#2-mental-model-http-upgrade-ke-long-lived-full-duplex-connection)
3. [Jakarta WebSocket 2.2 dalam Jakarta EE 11](#3-jakarta-websocket-22-dalam-jakarta-ee-11)
4. [WebSocket vs REST vs SSE vs Polling vs Messaging](#4-websocket-vs-rest-vs-sse-vs-polling-vs-messaging)
5. [Dependency, Runtime, dan Deployment](#5-dependency-runtime-dan-deployment)
6. [Peta API `jakarta.websocket`](#6-peta-api-jakartawebsocket)
7. [Server Endpoint dengan `@ServerEndpoint`](#7-server-endpoint-dengan-serverendpoint)
8. [Endpoint Lifecycle: `@OnOpen`, `@OnMessage`, `@OnClose`, `@OnError`](#8-endpoint-lifecycle-onopen-onmessage-onclose-onerror)
9. [`Session`: Conversation antara Dua Endpoint](#9-session-conversation-antara-dua-endpoint)
10. [RemoteEndpoint: Basic vs Async](#10-remoteendpoint-basic-vs-async)
11. [Message Types: Text, Binary, Pong, Partial Message](#11-message-types-text-binary-pong-partial-message)
12. [Path Parameter dan URI Template](#12-path-parameter-dan-uri-template)
13. [Handshake dan HTTP Upgrade](#13-handshake-dan-http-upgrade)
14. [`ServerEndpointConfig.Configurator`](#14-serverendpointconfigconfigurator)
15. [Client Endpoint dengan `@ClientEndpoint`](#15-client-endpoint-dengan-clientendpoint)
16. [Programmatic Endpoint](#16-programmatic-endpoint)
17. [Encoder dan Decoder](#17-encoder-dan-decoder)
18. [Subprotocol dan Extension](#18-subprotocol-dan-extension)
19. [Ping, Pong, Heartbeat, dan Idle Timeout](#19-ping-pong-heartbeat-dan-idle-timeout)
20. [Close Codes dan Graceful Shutdown](#20-close-codes-dan-graceful-shutdown)
21. [State Management: Connection State vs Business State](#21-state-management-connection-state-vs-business-state)
22. [Broadcasting dan Fan-Out](#22-broadcasting-dan-fan-out)
23. [Backpressure dan Slow Consumer](#23-backpressure-dan-slow-consumer)
24. [Threading dan Concurrency](#24-threading-dan-concurrency)
25. [Authentication dan Authorization](#25-authentication-dan-authorization)
26. [CSRF, CORS-Origin, Token, Cookie, dan Browser Security](#26-csrf-cors-origin-token-cookie-dan-browser-security)
27. [Scaling WebSocket di Multi-Node Cluster](#27-scaling-websocket-di-multi-node-cluster)
28. [WebSocket + Messaging Broker](#28-websocket--messaging-broker)
29. [Reliability: Reconnect, Resume, Sequence, Ack](#29-reliability-reconnect-resume-sequence-ack)
30. [Message Contract dan Versioning](#30-message-contract-dan-versioning)
31. [Rate Limiting dan Abuse Protection](#31-rate-limiting-dan-abuse-protection)
32. [Observability: Metrics, Logs, Tracing](#32-observability-metrics-logs-tracing)
33. [Performance Engineering](#33-performance-engineering)
34. [Testing Strategy](#34-testing-strategy)
35. [Production Failure Modes](#35-production-failure-modes)
36. [Best Practices dan Anti-Patterns](#36-best-practices-dan-anti-patterns)
37. [Checklist Review](#37-checklist-review)
38. [Case Study 1: Real-Time Case Status Notification](#38-case-study-1-real-time-case-status-notification)
39. [Case Study 2: Chat Internal dengan Multi-Node Scaling](#39-case-study-2-chat-internal-dengan-multi-node-scaling)
40. [Case Study 3: Slow Consumer Membuat Memory Naik](#40-case-study-3-slow-consumer-membuat-memory-naik)
41. [Case Study 4: Authentication Token Expired saat Connection Masih Terbuka](#41-case-study-4-authentication-token-expired-saat-connection-masih-terbuka)
42. [Latihan Bertahap](#42-latihan-bertahap)
43. [Mini Project: Jakarta WebSocket Production Lab](#43-mini-project-jakarta-websocket-production-lab)
44. [Referensi Resmi](#44-referensi-resmi)

---

# 1. Orientasi: WebSocket Bukan Hanya Chat

WebSocket sering dikenalkan lewat aplikasi chat.

Padahal use case production jauh lebih luas:

- live notification;
- collaborative editing;
- real-time dashboard;
- trading/market data;
- monitoring console;
- multiplayer game;
- IoT telemetry control channel;
- workflow status updates;
- support agent console;
- long-running job progress;
- command/control channel;
- presence/typing indicator;
- internal admin real-time operations.

## 1.1 Problem yang diselesaikan WebSocket

HTTP REST biasa bersifat request-response.

Client harus meminta data:

```text
client → server: any update?
server → client: no
client → server: any update?
server → client: yes
```

Polling boros.

WebSocket membuka connection long-lived:

```text
client ⇄ server
```

Server bisa push data kapan saja.

## 1.2 Full-duplex

WebSocket adalah full-duplex:

```text
client can send anytime
server can send anytime
both share same connection
```

Berbeda dari SSE yang server-to-client saja.

## 1.3 WebSocket bukan message broker

WebSocket adalah protocol komunikasi client-server.

Ia bukan:

- durable queue;
- replay log;
- event store;
- distributed broker;
- offline delivery system.

Jika client offline, message bisa hilang kecuali kamu desain persistence/replay.

## 1.4 WebSocket adalah connection-oriented

Setiap connection adalah stateful runtime object.

Artinya kamu harus memikirkan:

- connection lifecycle;
- memory per connection;
- session registry;
- authentication;
- reconnect;
- scaling;
- idle timeout;
- slow consumer;
- graceful shutdown.

---

# 2. Mental Model: HTTP Upgrade ke Long-Lived Full-Duplex Connection

WebSocket dimulai sebagai HTTP request.

Client mengirim handshake:

```http
GET /ws/cases/123 HTTP/1.1
Host: example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: ...
Sec-WebSocket-Version: 13
```

Server menjawab:

```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: ...
```

Setelah itu, connection berubah menjadi WebSocket frames.

## 2.1 Lifecycle high-level

```text
HTTP handshake
  ↓
upgrade accepted
  ↓
WebSocket session opened
  ↓
messages flow both ways
  ↓
close frame or error
  ↓
session closed
```

## 2.2 WebSocket session is not HttpSession

`jakarta.websocket.Session` mewakili WebSocket conversation.

`jakarta.servlet.http.HttpSession` adalah HTTP session.

Keduanya berbeda.

Kamu bisa mengakses informasi HTTP handshake tertentu, tapi jangan menganggap WebSocket session sama dengan browser session.

## 2.3 Stateful connection

Server menyimpan object session/connection.

Kalau ada 50.000 connections, ada 50.000 live sessions yang perlu memory, heartbeat, timeout, registry, dan cleanup.

## 2.4 Full-duplex implies concurrency

Server bisa menerima message saat sedang mengirim.

Client bisa mengirim cepat.

Server bisa broadcast ke banyak clients.

Concurrency dan backpressure menjadi penting.

## 2.5 Failure model

Connection bisa putus kapan saja:

- jaringan drop;
- browser tab ditutup;
- mobile sleep;
- load balancer idle timeout;
- server restart;
- proxy reset;
- authentication expired;
- client terlalu lambat;
- backpressure limit;
- deployment rolling restart.

Aplikasi harus menganggap disconnect normal.

---

# 3. Jakarta WebSocket 2.2 dalam Jakarta EE 11

Jakarta WebSocket 2.2 adalah release untuk Jakarta EE 11.

Spesifikasi ini mendefinisikan API untuk server dan client endpoints untuk WebSocket protocol RFC 6455.

## 3.1 Package utama

Common API:

```java
jakarta.websocket
```

Server-only API:

```java
jakarta.websocket.server
```

## 3.2 Server endpoint

```java
@ServerEndpoint("/ws/echo")
public class EchoEndpoint {
    ...
}
```

## 3.3 Client endpoint

```java
@ClientEndpoint
public class MyClientEndpoint {
    ...
}
```

## 3.4 Annotation model dan programmatic model

Kamu bisa membuat endpoint dengan:

- annotation-based POJO;
- programmatic endpoint extending `Endpoint`.

## 3.5 What changed in 2.2?

Jakarta WebSocket 2.2 aligns with Jakarta EE 11 and modern platform cleanup such as removing SecurityManager references. There are also minor API improvements/clarifications across implementations.

## 3.6 Current roadmap

Jakarta WebSocket 2.3 is under development for Jakarta EE 12.

For Jakarta EE 11 target, use 2.2.

---

# 4. WebSocket vs REST vs SSE vs Polling vs Messaging

## 4.1 REST

Best for:

- request-response;
- CRUD;
- command submission;
- queries;
- cacheable resources.

## 4.2 Polling

Client periodically asks server.

Good for:

- simple low-frequency updates;
- compatibility;
- when latency requirement relaxed.

Bad for:

- high frequency;
- many clients;
- real-time requirement.

## 4.3 Long polling

Server holds request until update/timeout.

Middle ground, but more complex than normal polling.

## 4.4 SSE / Server-Sent Events

One-way server-to-client event stream over HTTP.

Good for:

- notifications;
- progress updates;
- dashboards;
- simpler than WebSocket.

Limitation:

- client-to-server still uses HTTP request.

## 4.5 WebSocket

Two-way full-duplex.

Good for:

- bidirectional real-time;
- chat;
- collaboration;
- live command/control;
- low-latency push + client actions.

## 4.6 Messaging broker

Server-side durable asynchronous communication.

Good for:

- service-to-service events;
- queue/topic;
- retry/DLQ;
- offline/durable delivery.

## 4.7 Decision table

| Need | Prefer |
|---|---|
| Simple CRUD | REST |
| Infrequent status update | Polling |
| Server pushes updates only | SSE |
| Bidirectional real-time | WebSocket |
| Durable backend event distribution | Messaging broker |
| User offline delivery | DB + notification service |
| Reconnect/resume with missed messages | WebSocket + persisted event stream |
| Large fan-out to many clients | WebSocket gateway + broker/pubsub |

## 4.8 Don't overuse WebSocket

If SSE works, SSE may be simpler.

If message must be durable, WebSocket alone is insufficient.

---

# 5. Dependency, Runtime, dan Deployment

## 5.1 Maven API dependency

Server API commonly:

```xml
<dependency>
  <groupId>jakarta.websocket</groupId>
  <artifactId>jakarta.websocket-api</artifactId>
  <version>2.2.0</version>
  <scope>provided</scope>
</dependency>
```

Client API may be separate in some distributions:

```xml
<dependency>
  <groupId>jakarta.websocket</groupId>
  <artifactId>jakarta.websocket-client-api</artifactId>
  <version>2.2.0</version>
</dependency>
```

Check actual runtime/provider dependency.

## 5.2 Provided scope

If deploying to Jakarta EE runtime or Servlet container with WebSocket support, API is usually provided.

## 5.3 Implementation

API jar is not enough.

Need runtime implementation such as:

- Tyrus;
- Tomcat WebSocket implementation;
- Jetty Jakarta WebSocket;
- Undertow/WildFly;
- GlassFish/Payara;
- Open Liberty;
- compatible Jakarta EE runtime.

## 5.4 Deployment

Annotated `@ServerEndpoint` classes are discovered by container in web application.

Typical packaging:

```text
WAR
  WEB-INF/classes
  WEB-INF/lib
```

## 5.5 Reverse proxy/load balancer

Production WebSocket requires proxy support:

- HTTP/1.1 upgrade;
- connection upgrade headers;
- idle timeout;
- sticky sessions or pub/sub;
- max connection limits;
- TLS termination;
- proper forwarding headers.

## 5.6 Container config

Tune:

- max text/binary message size;
- idle timeout;
- async send timeout;
- buffer size;
- session limit;
- thread pool;
- compression extension;
- origin policy.

---

# 6. Peta API `jakarta.websocket`

Common package:

```java
jakarta.websocket
```

Important types:

- `Session`;
- `Endpoint`;
- `EndpointConfig`;
- `RemoteEndpoint`;
- `MessageHandler`;
- `Encoder`;
- `Decoder`;
- `ClientEndpoint`;
- `OnOpen`;
- `OnMessage`;
- `OnClose`;
- `OnError`;
- `CloseReason`;
- `ContainerProvider`;
- `WebSocketContainer`;
- `SendHandler`;
- `SendResult`;
- `PongMessage`;
- `Extension`.

Server package:

```java
jakarta.websocket.server
```

Important types:

- `ServerEndpoint`;
- `ServerEndpointConfig`;
- `ServerContainer`;
- `PathParam`;
- `HandshakeRequest`;
- `HandshakeResponse`.

## 6.1 Annotation endpoint

Use annotations for lifecycle methods.

## 6.2 Programmatic endpoint

Extend `Endpoint`.

## 6.3 Session

Represents active conversation.

## 6.4 RemoteEndpoint

Used to send messages.

## 6.5 Encoder/Decoder

Convert Java objects to/from WebSocket messages.

## 6.6 Configurator

Customizes handshake and endpoint creation/config.

---

# 7. Server Endpoint dengan `@ServerEndpoint`

## 7.1 Basic echo endpoint

```java
import jakarta.websocket.OnMessage;
import jakarta.websocket.server.ServerEndpoint;

@ServerEndpoint("/ws/echo")
public class EchoEndpoint {

    @OnMessage
    public String onMessage(String message) {
        return message;
    }
}
```

Returning a value from `@OnMessage` can send response to peer.

## 7.2 Endpoint path

```java
@ServerEndpoint("/ws/cases/{caseId}")
```

## 7.3 ServerEndpoint required value

`@ServerEndpoint` declares class as WebSocket endpoint available in URI-space of web application.

Required value is URI/URI-template mapping.

## 7.4 Endpoint instance lifecycle

Container manages endpoint instances.

Do not assume singleton unless spec/runtime model and configurator define it.

Treat endpoint object as container-managed and concurrent-risk-aware.

## 7.5 Dependency injection

Jakarta EE runtime may support injection into endpoint.

Example:

```java
@Inject
CaseNotificationService notificationService;
```

Test on target runtime.

## 7.6 Keep endpoint thin

Endpoint should adapt WebSocket to application service.

Bad:

```text
Endpoint contains business logic, DB queries, auth policy, broadcasting state all mixed.
```

Better:

```text
Endpoint receives message → validates envelope → calls application service/gateway
```

---

# 8. Endpoint Lifecycle: `@OnOpen`, `@OnMessage`, `@OnClose`, `@OnError`

## 8.1 `@OnOpen`

Called when connection opens.

```java
@OnOpen
public void onOpen(Session session) {
    sessions.add(session);
}
```

## 8.2 `@OnMessage`

Called when message arrives.

```java
@OnMessage
public void onMessage(String text, Session session) {
    ...
}
```

## 8.3 `@OnClose`

Called when session closes.

```java
@OnClose
public void onClose(Session session, CloseReason reason) {
    sessions.remove(session);
}
```

## 8.4 `@OnError`

Called when error occurs.

```java
@OnError
public void onError(Session session, Throwable error) {
    log.error("WebSocket error", error);
}
```

## 8.5 Cleanup must happen on close/error

Always remove session from registries.

## 8.6 Error may be followed by close

Avoid double cleanup bugs.

Make cleanup idempotent.

## 8.7 Lifecycle sequence

Typical:

```text
onOpen
  ↓
onMessage*
  ↓
onClose
```

or:

```text
onOpen
  ↓
onError
  ↓
onClose
```

## 8.8 Do not block lifecycle callbacks

Callbacks run on container-managed threads.

Long blocking work can hurt throughput.

---

# 9. `Session`: Conversation antara Dua Endpoint

The WebSocket API models interactions between endpoint and peer using `Session`.

## 9.1 Session represents conversation

A WebSocket session starts after successful handshake.

It remains open until close/error.

## 9.2 Common methods

```java
session.getId()
session.isOpen()
session.close()
session.getBasicRemote()
session.getAsyncRemote()
session.getRequestParameterMap()
session.getPathParameters()
session.getUserPrincipal()
session.getOpenSessions()
session.setMaxIdleTimeout(...)
session.setMaxTextMessageBufferSize(...)
session.setMaxBinaryMessageBufferSize(...)
```

## 9.3 Session ID

Container-generated.

Use for connection tracking, not business identity.

## 9.4 User properties

```java
session.getUserProperties().put("userId", userId);
```

Use carefully.

Avoid huge data.

## 9.5 Open sessions

`getOpenSessions()` can list sessions associated with endpoint.

For production, maintain your own registry with user/tenant/channel mapping.

## 9.6 Session is live resource

Holding session reference prevents cleanup if not removed.

## 9.7 Do not serialize session

WebSocket session is runtime object, not persistent state.

## 9.8 Business state elsewhere

If message should survive disconnect, store it in DB/broker.

---

# 10. RemoteEndpoint: Basic vs Async

`RemoteEndpoint` sends messages to peer.

Two main variants:

```java
RemoteEndpoint.Basic
RemoteEndpoint.Async
```

## 10.1 Basic remote

Synchronous/blocking send.

```java
session.getBasicRemote().sendText("hello");
```

Good for simple low-volume response.

Risk:

- blocks thread if client/network slow;
- can hurt broadcast performance.

## 10.2 Async remote

Asynchronous send.

```java
session.getAsyncRemote().sendText("hello", result -> {
    if (!result.isOK()) {
        Throwable error = result.getException();
    }
});
```

Better for broadcast/high-throughput.

## 10.3 Send timeout

Configure async send timeout if supported:

```java
session.getAsyncRemote().setSendTimeout(5000);
```

## 10.4 SendResult in WebSocket 2.2

Jakarta WebSocket 2.2 includes improvement around send result/session access in implementations/spec updates.

Use callback to observe failures.

## 10.5 One send at a time?

Many implementations require care with concurrent sends per session.

Use per-session send queue or synchronization if needed.

## 10.6 Slow client

Async send does not eliminate slow consumer issue.

It just moves it to buffers/callbacks.

## 10.7 Do not ignore send failure

If send fails, decide:

- close session;
- mark client stale;
- drop message;
- retry;
- queue limited;
- persist for later.

---

# 11. Message Types: Text, Binary, Pong, Partial Message

## 11.1 Text

```java
@OnMessage
public void onText(String message) { ... }
```

Good for JSON.

## 11.2 Binary

```java
@OnMessage
public void onBinary(ByteBuffer data) { ... }
```

Good for protobuf/binary protocol.

## 11.3 Pong

```java
@OnMessage
public void onPong(PongMessage pong) { ... }
```

Useful for heartbeat.

## 11.4 Partial text

```java
@OnMessage
public void onPartial(String part, boolean last) { ... }
```

Useful for large streaming messages.

## 11.5 Partial binary

```java
@OnMessage
public void onPartial(ByteBuffer part, boolean last) { ... }
```

## 11.6 Size limits

Configure max message size.

Never accept unlimited text/binary messages.

## 11.7 Message framing

WebSocket frames are not same as your application message semantics.

If you need application-level chunking/ack, design it.

---

# 12. Path Parameter dan URI Template

## 12.1 Endpoint path

```java
@ServerEndpoint("/ws/cases/{caseId}")
public class CaseSocket {
    @OnOpen
    public void onOpen(Session session, @PathParam("caseId") String caseId) {
        ...
    }
}
```

## 12.2 Use cases

- subscribe to case updates;
- join room/channel;
- user-specific stream;
- tenant-specific endpoint.

## 12.3 Validate path params

Do not trust.

```java
UUID id = UUID.fromString(caseId);
```

Handle invalid.

## 12.4 Authorization

Path param does not imply permission.

User must be authorized to access `caseId`.

## 12.5 Avoid too much routing in path

For dynamic subscriptions, consider message-based subscribe command after connection.

Example:

```json
{"type":"SUBSCRIBE","channel":"case","caseId":"..."}
```

## 12.6 Path design

Keep stable:

```text
/ws/notifications
/ws/cases/{caseId}
```

---

# 13. Handshake dan HTTP Upgrade

## 13.1 Opening handshake

WebSocket begins with HTTP GET upgrade request.

## 13.2 Access handshake data

Via configurator/handshake request.

Use for:

- headers;
- cookies;
- query parameters;
- user principal;
- HTTP session;
- origin.

## 13.3 Authentication at handshake

Common approaches:

- cookie/session auth;
- bearer token query/header;
- reverse proxy auth;
- OIDC session;
- short-lived WebSocket ticket.

## 13.4 Browser limitation

Browser WebSocket API cannot set arbitrary headers easily.

This affects token passing.

Common choices:

- cookie;
- query parameter token;
- subprotocol token workaround;
- pre-auth ticket;
- same-origin session.

Each has security trade-offs.

## 13.5 Origin check

WebSocket is not protected by CORS the same way REST fetch is.

Server should validate `Origin` header for browser clients.

## 13.6 Reject handshake

If unauthorized, fail handshake.

## 13.7 Handshake is not final authorization

Even after connection accepted, each subscription/action may need authorization.

---

# 14. `ServerEndpointConfig.Configurator`

Configurator customizes endpoint configuration/handshake.

## 14.1 Use cases

- check origin;
- inspect headers;
- modify handshake response;
- access HTTP session;
- custom endpoint instance creation;
- select subprotocol;
- configure encoders/decoders programmatically.

## 14.2 Example origin check

```java
public class OriginCheckConfigurator extends ServerEndpointConfig.Configurator {
    @Override
    public boolean checkOrigin(String originHeaderValue) {
        return "https://app.example.com".equals(originHeaderValue);
    }
}
```

Use:

```java
@ServerEndpoint(
    value = "/ws/notifications",
    configurator = OriginCheckConfigurator.class
)
```

## 14.3 Access handshake

```java
@Override
public void modifyHandshake(
        ServerEndpointConfig config,
        HandshakeRequest request,
        HandshakeResponse response) {
    config.getUserProperties().put("headers", request.getHeaders());
}
```

## 14.4 Avoid storing sensitive objects

Do not store full request/response or huge objects unnecessarily.

## 14.5 Custom instance creation

Can override endpoint instantiation, but be careful with CDI integration and lifecycle.

## 14.6 Runtime behavior

Configurator behavior can be implementation-sensitive.

Test on target runtime.

---

# 15. Client Endpoint dengan `@ClientEndpoint`

Jakarta WebSocket also supports client endpoints.

## 15.1 Basic client

```java
@ClientEndpoint
public class EchoClient {

    @OnOpen
    public void onOpen(Session session) {
        session.getAsyncRemote().sendText("hello");
    }

    @OnMessage
    public void onMessage(String message) {
        System.out.println(message);
    }
}
```

## 15.2 Connect

```java
WebSocketContainer container =
    ContainerProvider.getWebSocketContainer();

Session session =
    container.connectToServer(EchoClient.class, URI.create("wss://example.com/ws/echo"));
```

## 15.3 Use cases

- backend connects to WebSocket server;
- integration test;
- gateway client;
- bot/agent.

## 15.4 Client lifecycle

Client must handle reconnect, timeout, TLS, authentication, backoff.

## 15.5 Client in Jakarta EE server

If server app creates WebSocket client connections, use managed resources and be careful with lifecycle/shutdown.

## 15.6 Prefer HTTP client for request-response

Do not use WebSocket client when REST is enough.

---

# 16. Programmatic Endpoint

Instead of annotations, extend `Endpoint`.

## 16.1 Example

```java
public class MyEndpoint extends Endpoint {
    @Override
    public void onOpen(Session session, EndpointConfig config) {
        session.addMessageHandler(String.class, message -> {
            ...
        });
    }

    @Override
    public void onClose(Session session, CloseReason closeReason) {
        ...
    }

    @Override
    public void onError(Session session, Throwable thr) {
        ...
    }
}
```

## 16.2 Use cases

- dynamic endpoint registration;
- framework integration;
- custom configuration;
- programmatic handler composition.

## 16.3 Annotation easier

For most applications, annotations are simpler.

## 16.4 EndpointConfig

Contains configuration info used during handshake.

## 16.5 MessageHandler

Programmatic endpoint registers message handlers explicitly.

## 16.6 Avoid complexity unless needed

Programmatic model is powerful but easier to over-engineer.

---

# 17. Encoder dan Decoder

Encoders/decoders convert between Java objects and WebSocket messages.

## 17.1 Decoder

```java
public class CommandDecoder implements Decoder.Text<ClientCommand> {
    @Override
    public ClientCommand decode(String s) {
        return jsonb.fromJson(s, ClientCommand.class);
    }

    @Override
    public boolean willDecode(String s) {
        return s != null && s.startsWith("{");
    }

    @Override
    public void init(EndpointConfig config) {}

    @Override
    public void destroy() {}
}
```

## 17.2 Encoder

```java
public class EventEncoder implements Encoder.Text<ServerEvent> {
    @Override
    public String encode(ServerEvent event) {
        return jsonb.toJson(event);
    }

    @Override
    public void init(EndpointConfig config) {}

    @Override
    public void destroy() {}
}
```

## 17.3 Register

```java
@ServerEndpoint(
    value = "/ws/events",
    decoders = CommandDecoder.class,
    encoders = EventEncoder.class
)
public class EventEndpoint {
    @OnMessage
    public void onCommand(ClientCommand command, Session session) {
        ...
    }
}
```

## 17.4 Pros

- cleaner endpoint method;
- centralized serialization;
- type safety.

## 17.5 Cons

- less explicit JSON handling;
- decoder errors need robust mapping;
- lifecycle/concurrency considerations.

## 17.6 Versioning

Encoders/decoders should understand message schema version.

## 17.7 Error response

If decode fails, send structured error or close connection depending severity.

---

# 18. Subprotocol dan Extension

## 18.1 Subprotocol

WebSocket supports negotiated subprotocol.

Examples:

```text
chat.v1
graphql-ws
jsonrpc
stomp
```

## 18.2 Declare

```java
@ServerEndpoint(
    value = "/ws",
    subprotocols = {"case-events.v1"}
)
```

## 18.3 Why use subprotocol?

Defines application-level protocol over WebSocket.

## 18.4 Versioning

Subprotocol can include version:

```text
case-events.v2
```

## 18.5 Extensions

WebSocket extensions can add features like compression.

Example:

```text
permessage-deflate
```

## 18.6 Compression caution

Compression can increase CPU and has security considerations with secrets.

## 18.7 Negotiate deliberately

Do not accept arbitrary subprotocol/extensions without understanding.

---

# 19. Ping, Pong, Heartbeat, dan Idle Timeout

## 19.1 Why heartbeat?

Detect dead connections.

Network may silently drop.

## 19.2 Ping/Pong

WebSocket protocol supports ping/pong control frames.

## 19.3 Application heartbeat

Sometimes app-level heartbeat:

```json
{"type":"PING","timestamp":"..."}
```

and:

```json
{"type":"PONG","timestamp":"..."}
```

## 19.4 Idle timeout

```java
session.setMaxIdleTimeout(60_000);
```

or runtime config.

## 19.5 Load balancer timeout

LB/proxy may close idle connection earlier than server.

Configure heartbeat interval below LB idle timeout.

## 19.6 Mobile clients

Mobile networks sleep/disconnect frequently.

Reconnect is normal.

## 19.7 Don't spam heartbeat

Heartbeat has cost across many clients.

Tune.

---

# 20. Close Codes dan Graceful Shutdown

## 20.1 Close session

```java
session.close(new CloseReason(
    CloseReason.CloseCodes.NORMAL_CLOSURE,
    "server shutdown"
));
```

## 20.2 Standard close codes

Examples:

- normal closure;
- going away;
- protocol error;
- unsupported data;
- message too big;
- internal error;
- policy violation.

## 20.3 Use meaningful close reason

But do not leak sensitive detail.

## 20.4 Graceful shutdown

On deployment/server shutdown:

- stop accepting new connections;
- notify clients;
- close sessions with going-away;
- let clients reconnect to another node.

## 20.5 Client reconnect

Client should reconnect with backoff.

## 20.6 Close on policy violation

If client sends unauthorized/invalid command repeatedly, close connection.

---

# 21. State Management: Connection State vs Business State

## 21.1 Connection state

Examples:

- WebSocket session ID;
- subscribed channels;
- last heartbeat;
- send queue;
- remote address;
- user ID associated with session.

Stored in memory/session registry.

## 21.2 Business state

Examples:

- case status;
- notification record;
- chat message history;
- read receipt;
- workflow state.

Stored in database/event store.

## 21.3 Do not store business state only in WebSocket session

If connection drops, state lost.

## 21.4 Registry

```java
@ApplicationScoped
public class WebSocketRegistry {
    private final ConcurrentMap<UserId, Set<Session>> sessionsByUser = ...
}
```

## 21.5 Cleanup

Remove session on close/error.

Also handle stale sessions.

## 21.6 Multiple devices

One user may have multiple sessions.

```text
user → phone + browser + tablet
```

## 21.7 Multi-node

Registry is local to node unless distributed.

Use broker/pubsub for cross-node fan-out.

---

# 22. Broadcasting dan Fan-Out

## 22.1 Simple broadcast

```java
for (Session s : sessions) {
    if (s.isOpen()) {
        s.getAsyncRemote().sendText(message);
    }
}
```

## 22.2 Risks

- slow clients;
- send queue buildup;
- concurrent modification;
- session closed mid-send;
- memory pressure;
- ordering per client;
- partial failures.

## 22.3 Per-user send

Often better:

```text
send to sessions of user X
```

not global broadcast.

## 22.4 Channel subscription

Maintain:

```text
channelId → sessions
```

## 22.5 Authorization per subscription

Before adding session to channel, check permission.

## 22.6 Fan-out at scale

For large scale:

```text
backend event broker
  ↓
websocket gateway nodes
  ↓
local sessions
```

## 22.7 Avoid O(N) on hot path if N huge

Use efficient registry, partitioning, or gateway.

---

# 23. Backpressure dan Slow Consumer

## 23.1 What is slow consumer?

Client cannot receive/process messages as fast as server sends.

## 23.2 Consequences

- server send buffers grow;
- memory increases;
- latency grows;
- old messages become stale;
- connection eventually closes.

## 23.3 Backpressure strategy

Options:

- per-session bounded queue;
- drop old messages;
- coalesce messages;
- close slow connection;
- reduce frequency;
- send snapshot instead of every update;
- require client ack/window.

## 23.4 Async send callback

Use callback to detect failures.

```java
session.getAsyncRemote().sendText(payload, result -> {
    if (!result.isOK()) {
        closeOrMarkFailed(session, result.getException());
    }
});
```

## 23.5 Send timeout

Configure send timeout.

## 23.6 Bounded per-session queue

```text
if queue full:
  drop stale update or close session
```

## 23.7 Coalescing

For dashboard metrics:

```text
keep latest value only
```

Do not queue thousands of obsolete updates.

## 23.8 Business critical messages

If must be delivered, persist and support replay/ack.

Do not rely only on WebSocket buffer.

---

# 24. Threading dan Concurrency

## 24.1 Endpoint methods may be called concurrently

Depending implementation and endpoint instance model, be concurrency-safe.

Use thread-safe structures.

## 24.2 Do not block callback thread

Long operations in `@OnMessage` reduce server capacity.

Offload to managed executor/message queue if needed.

## 24.3 Do not use raw threads

Use Jakarta Concurrency managed executor.

## 24.4 Session send concurrency

Serialize sends per session if provider requires.

## 24.5 Shared collections

Use:

```java
ConcurrentHashMap
CopyOnWriteArraySet
```

or carefully synchronized collections.

## 24.6 Avoid coarse locks

Global lock around broadcast can kill performance.

## 24.7 MDC/ThreadLocal

Clear after use.

Do not assume request MDC persists in WebSocket callbacks.

## 24.8 Transaction

WebSocket message handling is not automatically inside transaction unless you call transactional service/managed component.

---

# 25. Authentication dan Authorization

## 25.1 Authenticate at handshake

Common:

- existing HTTP session cookie;
- token in query parameter;
- short-lived WebSocket ticket;
- reverse proxy auth;
- mTLS/client cert for non-browser.

## 25.2 Browser header limitation

Browser WebSocket constructor cannot set arbitrary Authorization header in standard API.

This affects bearer token design.

## 25.3 Safer token pattern

Use short-lived ticket:

```text
client authenticates via REST
client requests WebSocket ticket
server issues short-lived one-time ticket
client connects ws://.../ws?ticket=...
server validates and consumes ticket
```

## 25.4 Cookie session

Works for same-origin browser app, but must handle CSRF/origin risk.

## 25.5 Authorization per action

Even after connection authenticated, each command/subscription can require authorization.

Example:

```json
{"type":"SUBSCRIBE_CASE","caseId":"..."}
```

Check:

- user authenticated;
- role;
- tenant;
- case visibility;
- subscription limit.

## 25.6 Revocation

If role/token revoked while connection open, decide:

- close connection immediately via revocation event;
- revalidate periodically;
- short session TTL;
- check per action.

## 25.7 Principal

`session.getUserPrincipal()` may be available depending container authentication.

Test.

## 25.8 Do not trust client userId

If message says:

```json
{"userId":"admin"}
```

ignore it for identity.

Use authenticated session identity.

---

# 26. CSRF, CORS-Origin, Token, Cookie, dan Browser Security

## 26.1 CORS vs WebSocket

Browser WebSocket uses Origin header, but CORS preflight rules are not same as fetch/XHR.

Server should validate Origin.

## 26.2 Cross-site WebSocket hijacking

If auth uses cookies and server accepts any Origin, malicious site can open WebSocket using victim cookies.

Mitigation:

- strict Origin check;
- SameSite cookies;
- CSRF token/ticket;
- authentication ticket;
- per-message authorization.

## 26.3 Query token leakage

Tokens in URL may appear in logs.

Use short-lived one-time ticket, not long-lived JWT.

## 26.4 Subprotocol token hack

Some systems pass token via subprotocol. Be careful and document.

## 26.5 TLS

Use `wss://` in production.

## 26.6 Content validation

Every message is untrusted input.

Validate schema, size, enum, command type.

## 26.7 XSS impact

If web app has XSS, attacker can use WebSocket as authenticated user.

Prevent XSS and enforce server-side authorization.

---

# 27. Scaling WebSocket di Multi-Node Cluster

## 27.1 Problem

WebSocket connection is pinned to one server node.

If user A connected to node 1 and backend event arrives on node 2, node 2 cannot directly send to A's session.

## 27.2 Sticky sessions

Load balancer can keep connection on same node.

But sticky only solves connection routing, not cross-node event delivery.

## 27.3 Pub/Sub backplane

Use broker/pubsub:

```text
Business service publishes UserNotification(userId)
  ↓
broker topic
  ↓
all WebSocket nodes receive
  ↓
node with user's local sessions sends
```

## 27.4 Local registry

Each node keeps only local sessions.

## 27.5 Distributed registry

Optional, but be careful with stale entries.

## 27.6 Node shutdown

On rolling deploy:

- stop accepting new ws;
- close existing with going-away;
- clients reconnect;
- broker resumes events.

## 27.7 Connection count

Each node has max connection capacity.

## 27.8 Horizontal scaling

Scale by:

- sharding clients;
- more gateway nodes;
- broker fan-out;
- stateless business services;
- local session registry.

## 27.9 Global broadcast risk

Broadcasting to all clients across cluster can be expensive.

Use targeted messages.

---

# 28. WebSocket + Messaging Broker

## 28.1 Recommended architecture

```text
Domain service
  ↓ publishes event
Broker topic
  ↓
WebSocket gateway node(s)
  ↓
connected clients
```

## 28.2 Why broker?

- decouple domain from WebSocket sessions;
- cross-node fan-out;
- retry/backpressure;
- buffer during temporary gateway issue;
- multiple subscribers.

## 28.3 WebSocket gateway

A service whose main job:

- manage connections;
- authenticate;
- authorize subscriptions;
- receive broker events;
- send to clients.

## 28.4 Client commands

For client-to-server commands:

```text
WebSocket command → application service or command queue
```

Do not put heavy business logic in endpoint.

## 28.5 Durable vs ephemeral

If notification must survive offline client:

- persist notification in DB;
- send over WebSocket if online;
- client fetches missed notifications on reconnect.

## 28.6 Avoid broker per user connection

Do not create one broker subscription per browser session unless provider supports scale.

Aggregate by topic/channel.

---

# 29. Reliability: Reconnect, Resume, Sequence, Ack

## 29.1 WebSocket connection is unreliable

Assume disconnect.

## 29.2 Client reconnect

Use exponential backoff with jitter:

```text
1s, 2s, 5s, 10s, 30s
```

## 29.3 Resume

Client sends last seen event sequence:

```json
{"type":"RESUME","lastSeenSequence":12345}
```

Server sends missed events if persisted.

## 29.4 Sequence number

Per stream/channel:

```text
caseId + sequence
userId + notification sequence
```

## 29.5 Ack

Client acknowledges received important messages.

```json
{"type":"ACK","messageId":"..."}
```

## 29.6 At-most-once vs at-least-once

WebSocket push without persistence is at-most-once-ish.

With persisted events + ack/replay, you can design at-least-once.

Consumers must handle duplicates.

## 29.7 Snapshot strategy

For dashboards, instead of replay every update, send latest snapshot.

## 29.8 Offline strategy

When offline, WebSocket cannot deliver.

Use REST fetch after reconnect.

---

# 30. Message Contract dan Versioning

## 30.1 Envelope

```json
{
  "id": "uuid",
  "type": "CASE_STATUS_CHANGED",
  "version": 1,
  "correlationId": "uuid",
  "timestamp": "2026-06-12T10:00:00Z",
  "payload": {
    "caseId": "...",
    "status": "APPROVED"
  }
}
```

## 30.2 Client command envelope

```json
{
  "id": "uuid",
  "type": "SUBSCRIBE_CASE",
  "version": 1,
  "payload": {
    "caseId": "..."
  }
}
```

## 30.3 Error envelope

```json
{
  "id": "uuid",
  "type": "ERROR",
  "correlationId": "...",
  "error": {
    "code": "UNAUTHORIZED_SUBSCRIPTION",
    "message": "Not allowed"
  }
}
```

## 30.4 Versioning

Include schema version.

Support old clients during rolling deploy.

## 30.5 Unknown command

Return error or close if protocol violation.

## 30.6 Size limit

Reject oversized messages.

## 30.7 Binary protocols

For performance, consider protobuf/binary.

But debugging and browser integration may be simpler with JSON.

---

# 31. Rate Limiting dan Abuse Protection

## 31.1 Attack vectors

- many connections;
- large messages;
- high message rate;
- subscription spam;
- broadcast amplification;
- slow consumer;
- invalid auth attempts;
- ping flood.

## 31.2 Limits

- max connections per user/IP;
- max message size;
- max messages/sec per session;
- max subscriptions/session;
- max pending sends/session;
- idle timeout;
- authentication attempt limit.

## 31.3 Close on abuse

Use close code/policy violation.

## 31.4 Backoff

Tell client to reconnect later if overloaded.

## 31.5 Gateway/WAF/proxy

WebSocket abuse protection may need support at edge.

## 31.6 Observability

Monitor abnormal connection/message rates.

---

# 32. Observability: Metrics, Logs, Tracing

## 32.1 Metrics

Track:

- open connections;
- connection open/close rate;
- messages received;
- messages sent;
- send failures;
- decode errors;
- auth failures;
- subscription count;
- slow consumer count;
- pending send queue size;
- session duration;
- reconnect rate;
- close code distribution.

## 32.2 Logs

Log lifecycle:

```text
ws.open user=... session=... ip=...
ws.subscribe channel=...
ws.close code=... reason=...
ws.error category=...
```

Avoid logging sensitive payload.

## 32.3 Tracing

WebSocket is long-lived, so tracing differs from HTTP.

Create spans for:

- handshake;
- each received command;
- each server event fan-out batch;
- downstream calls.

## 32.4 Correlation ID

Each client command should have ID/correlation.

## 32.5 Debug payload sampling

Only sample non-sensitive payloads.

## 32.6 Dashboard

Dashboard should show:

- active connections by node;
- message throughput;
- failures;
- slow consumers;
- broker lag;
- reconnect spikes.

---

# 33. Performance Engineering

## 33.1 Connection cost

Each connection consumes:

- memory;
- file descriptor/socket;
- session object;
- buffers;
- heartbeat;
- registry entry.

## 33.2 Message size

Small messages scale better.

Avoid sending huge payload.

## 33.3 Serialization

JSON serialization cost can dominate.

Use efficient mapper and avoid repeated expensive conversions.

## 33.4 Broadcast cost

Broadcast to N sessions is O(N).

Optimize targeted delivery.

## 33.5 Compression

Compression reduces bandwidth but costs CPU and can introduce security concerns.

## 33.6 Buffer tuning

Configure max message buffer sizes.

## 33.7 Thread pool

Avoid blocking WebSocket callback threads.

## 33.8 Load balancer

Tune:

- idle timeout;
- max connections;
- HTTP upgrade support;
- keepalive;
- TLS.

## 33.9 Capacity test

Use load test with many persistent connections, not just request QPS.

---

# 34. Testing Strategy

## 34.1 Unit test protocol handling

Extract message handler:

```java
ClientCommand → ServerEvent/Error
```

Test without real WebSocket.

## 34.2 Integration test endpoint

Use Jakarta WebSocket client or browser automation.

Test:

- connect;
- send message;
- receive response;
- close;
- invalid message;
- auth failure.

## 34.3 Security tests

- invalid token;
- wrong origin;
- unauthorized subscription;
- expired token;
- cross-tenant case ID;
- message spoofing.

## 34.4 Backpressure tests

Simulate slow client.

Observe send queue/memory/close behavior.

## 34.5 Reconnect tests

Drop connection and reconnect with last sequence.

## 34.6 Multi-node tests

Run two nodes with broker backplane.

Ensure event reaches session on correct node.

## 34.7 Load tests

Test:

- many idle connections;
- many active connections;
- broadcast fan-out;
- reconnect storm;
- slow consumer;
- broker lag.

## 34.8 Browser compatibility

Test real browsers if client is browser.

## 34.9 Proxy tests

Test through actual ingress/load balancer.

---

# 35. Production Failure Modes

## 35.1 Connection closes behind proxy

Cause:

- LB idle timeout shorter than heartbeat.

Fix:

- tune heartbeat and LB timeout.

## 35.2 Memory leak from session registry

Cause:

- session not removed on close/error.

Fix:

- idempotent cleanup.

## 35.3 Slow consumer OOM

Cause:

- unbounded async send queue.

Fix:

- bounded queue, send timeout, close slow session.

## 35.4 Unauthorized subscription

Cause:

- authenticated connection but no per-channel authorization.

Fix:

- authorize each subscription/action.

## 35.5 Cross-site WebSocket hijacking

Cause:

- cookie auth + no Origin check.

Fix:

- strict Origin/ticket.

## 35.6 Message lost on disconnect

Cause:

- WebSocket-only notification, no persistence.

Fix:

- persist important notifications and replay.

## 35.7 Multi-node missing message

Cause:

- event delivered to wrong node with local-only registry.

Fix:

- pub/sub backplane.

## 35.8 Duplicate messages after reconnect

Cause:

- replay without dedup.

Fix:

- message IDs and client idempotency.

## 35.9 Thread exhaustion

Cause:

- blocking work in `@OnMessage`.

Fix:

- managed executor/queue and timeouts.

## 35.10 Deploy restart drops clients

Cause:

- long-lived connections killed.

Fix:

- graceful close, client reconnect.

## 35.11 Token expires mid-connection

Cause:

- auth only at handshake.

Fix:

- refresh/revalidate/close on expiry.

## 35.12 Oversized message attack

Cause:

- no size limit.

Fix:

- max message size and close.

---

# 36. Best Practices dan Anti-Patterns

## 36.1 Best practices

- Use WebSocket only when bidirectional real-time is needed.
- Validate Origin for browser clients.
- Authenticate handshake and authorize each action.
- Keep endpoint thin.
- Use message envelope with type/version/id.
- Limit message size.
- Use async send with failure callbacks.
- Handle slow consumers.
- Use heartbeat below proxy idle timeout.
- Store business state outside session.
- Persist important notifications.
- Use broker/pubsub for multi-node fan-out.
- Support reconnect/resume if needed.
- Monitor connection/message metrics.
- Test through real proxy/load balancer.

## 36.2 Anti-pattern: WebSocket as database

Do not store durable state only in connection memory.

## 36.3 Anti-pattern: Global static set without cleanup

Memory leak and concurrency bugs.

## 36.4 Anti-pattern: Trust client userId

Identity must come from authentication.

## 36.5 Anti-pattern: No Origin check with cookie auth

Security vulnerability.

## 36.6 Anti-pattern: Blocking DB/API call in `@OnMessage`

Can exhaust server threads.

## 36.7 Anti-pattern: Unbounded broadcast queue

Slow clients kill server.

## 36.8 Anti-pattern: No reconnect strategy

Mobile/browser networks disconnect.

## 36.9 Anti-pattern: One WebSocket endpoint for all without protocol design

Creates messy command handling.

---

# 37. Checklist Review

## 37.1 Endpoint

- [ ] Endpoint path clear?
- [ ] Lifecycle cleanup idempotent?
- [ ] Message size limits configured?
- [ ] Endpoint logic thin?
- [ ] Encoder/decoder tested?
- [ ] Close reasons meaningful?

## 37.2 Security

- [ ] Handshake authenticated?
- [ ] Origin checked?
- [ ] Token/cookie strategy safe?
- [ ] Each subscription authorized?
- [ ] Cross-tenant access tested?
- [ ] Rate limits configured?

## 37.3 Reliability

- [ ] Reconnect strategy?
- [ ] Heartbeat?
- [ ] Important messages persisted?
- [ ] Resume/sequence/ack if needed?
- [ ] Slow consumer policy?
- [ ] Graceful shutdown?

## 37.4 Scaling

- [ ] Multi-node strategy?
- [ ] Broker/pubsub backplane?
- [ ] Sticky session requirement documented?
- [ ] Connection capacity tested?
- [ ] LB/proxy configured?

## 37.5 Observability

- [ ] Open connections metric?
- [ ] Close code distribution?
- [ ] Send failure metric?
- [ ] Slow consumer metric?
- [ ] Auth failure metric?
- [ ] Logs include session/user/correlation safely?

---

# 38. Case Study 1: Real-Time Case Status Notification

## 38.1 Requirement

Applicant sees real-time status when case changes.

## 38.2 Architecture

```text
Case service updates status
  ↓
publishes CaseStatusChanged event
  ↓
broker topic
  ↓
WebSocket gateway
  ↓
connected applicant sessions
```

## 38.3 Connection

```text
/ws/notifications
```

Client sends:

```json
{"type":"SUBSCRIBE_CASE","caseId":"..."}
```

## 38.4 Authorization

Server checks applicant can view case.

## 38.5 Offline

If applicant offline, notification stored in DB.

On reconnect, client calls REST:

```http
GET /notifications?since=...
```

## 38.6 Lesson

WebSocket is live channel; DB is source for missed data.

---

# 39. Case Study 2: Chat Internal dengan Multi-Node Scaling

## 39.1 Requirement

Internal officers chat per case room.

## 39.2 Naive

Each node keeps local rooms only.

Message from node 1 doesn't reach clients on node 2.

## 39.3 Fix

Use broker topic per room or shared topic with roomId property.

```text
message sent
  ↓
persist chat message
  ↓
publish ChatMessageCreated(roomId)
  ↓
all ws nodes receive
  ↓
node sends to local sessions in room
```

## 39.4 Ordering

Use DB sequence per room.

## 39.5 Reconnect

Client fetches missed messages after last sequence.

## 39.6 Lesson

Clustered WebSocket needs backplane and persistent source of truth.

---

# 40. Case Study 3: Slow Consumer Membuat Memory Naik

## 40.1 Problem

Dashboard receives 100 updates/sec.

One browser tab is slow/frozen.

Server queues all updates.

Memory rises.

## 40.2 Fix

For dashboard, only latest value matters.

Use coalescing:

```text
per session + metric key → latest update
```

Send at max 1 update/sec.

## 40.3 If critical messages

Persist and ack.

## 40.4 Close slow session

If pending queue exceeds limit, close with policy reason.

## 40.5 Lesson

Backpressure policy depends message semantics.

---

# 41. Case Study 4: Authentication Token Expired saat Connection Masih Terbuka

## 41.1 Problem

Token valid at handshake for 15 minutes.

Connection stays open for 6 hours.

User role revoked after 1 hour.

## 41.2 Risk

Connection still receives privileged updates.

## 41.3 Options

- close connection when token expires;
- require token refresh command;
- revalidate on each subscription/action;
- listen to revocation event and close sessions;
- use short-lived ticket plus server-side session with revocation.

## 41.4 Recommended

For sensitive systems:

- revalidate authorization per action/subscription;
- close or downgrade on revocation;
- maintain user-session registry for forced disconnect.

## 41.5 Lesson

Authentication at handshake is not enough for long-lived connections.

---

# 42. Latihan Bertahap

## Latihan 1 — Echo endpoint

Create `@ServerEndpoint("/ws/echo")`.

Return same message.

## Latihan 2 — Lifecycle logging

Log open/message/error/close.

## Latihan 3 — Path param

Create `/ws/cases/{caseId}`.

Validate caseId.

## Latihan 4 — JSON envelope

Implement command/event envelope.

Handle unknown command.

## Latihan 5 — Encoder/decoder

Create JSON decoder/encoder.

## Latihan 6 — Origin check

Implement configurator with Origin allowlist.

## Latihan 7 — Async send

Broadcast with `getAsyncRemote()` and callback.

## Latihan 8 — Slow consumer

Simulate slow client.

Implement bounded send queue/drop/close.

## Latihan 9 — Broker backplane

Use JMS/topic to broadcast event to multiple WebSocket nodes or simulated nodes.

## Latihan 10 — Reconnect/resume

Persist events with sequence.

Client reconnects and requests missed events.

---

# 43. Mini Project: Jakarta WebSocket Production Lab

## 43.1 Goal

Create:

```text
jakarta-websocket-production-lab/
```

## 43.2 Modules

```text
echo-endpoint/
json-protocol/
auth-handshake/
origin-check/
subscription-authorization/
async-send/
slow-consumer/
heartbeat/
broker-backplane/
reconnect-resume/
observability/
```

## 43.3 Deliverables

```text
README.md
WEBSOCKET-MENTAL-MODEL.md
PROTOCOL-DESIGN.md
AUTHENTICATION-AUTHORIZATION.md
CONNECTION-REGISTRY.md
BACKPRESSURE.md
SCALING-MULTINODE.md
RECONNECT-RESUME.md
OBSERVABILITY.md
FAILURE-MODES.md
```

## 43.4 Required experiments

1. Echo endpoint works.
2. JSON command/event protocol.
3. Origin rejection.
4. Unauthorized subscription rejected.
5. Async send callback captures failure.
6. Slow consumer closed or coalesced.
7. Heartbeat prevents idle close.
8. Broker event reaches correct local sessions.
9. Client reconnects after server restart.
10. Missed messages replayed from persisted event store.

## 43.5 Evaluation questions

1. What happens during WebSocket handshake?
2. What is `jakarta.websocket.Session`?
3. Why is WebSocket not durable messaging?
4. Why validate Origin?
5. Why authorize per subscription?
6. What is slow consumer?
7. How scale WebSocket across nodes?
8. What is difference between Basic and Async remote?
9. How handle missed messages after reconnect?
10. Why is endpoint not the right place for business logic?

---

# 44. Referensi Resmi

Referensi utama:

1. Jakarta WebSocket 2.2  
   https://jakarta.ee/specifications/websocket/2.2/

2. Jakarta WebSocket 2.2 Specification  
   https://jakarta.ee/specifications/websocket/2.2/jakarta-websocket-spec-2.2

3. Jakarta WebSocket 2.2 API Docs — `@ServerEndpoint`  
   https://jakarta.ee/specifications/websocket/2.2/apidocs/server/jakarta/websocket/server/serverendpoint

4. Jakarta WebSocket Tutorial  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/websocket/websocket.html

5. Jakarta WebSocket API Docs Index  
   https://jakarta.ee/specifications/websocket/2.2/apidocs/server/index-all

6. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

7. RFC 6455 — The WebSocket Protocol  
   https://www.rfc-editor.org/rfc/rfc6455

8. Jakarta Servlet 6.1  
   https://jakarta.ee/specifications/servlet/6.1/

9. Jakarta Security 4.0  
   https://jakarta.ee/specifications/security/4.0/

10. Jakarta Messaging 3.1  
    https://jakarta.ee/specifications/messaging/3.1/

---

# Penutup

Jakarta WebSocket menyediakan standard API untuk server dan client endpoints atas WebSocket protocol.

Mental model ringkas:

```text
Handshake:
  HTTP request upgraded to WebSocket

Endpoint:
  server/client component handling lifecycle events

Session:
  live conversation between two endpoints

RemoteEndpoint.Basic:
  blocking send

RemoteEndpoint.Async:
  async send with callback

Encoder/Decoder:
  Java object ↔ WebSocket message

Configurator:
  customize handshake/configuration
```

Prinsip paling penting:

```text
WebSocket is a live transport, not a durable system of record.
```

Gunakan WebSocket untuk live bidirectional communication. Untuk reliability, gunakan desain tambahan:

```text
authentication at handshake
authorization per subscription/action
message envelope with id/version
heartbeat
backpressure policy
slow consumer handling
broker backplane for multi-node
persisted events for replay
reconnect/resume
observability
```

Engineer top-tier tidak hanya bisa membuat chat endpoint. Ia tahu bagaimana WebSocket melewati proxy, kenapa Origin harus dicek, kenapa session registry bisa memory leak, kenapa slow client bisa membunuh server, kenapa cluster butuh pub/sub backplane, dan kenapa pesan penting harus tetap disimpan di database/event store.

Bagian berikutnya akan membahas **Jakarta Faces (`jakarta.faces`)**: component-based server-side UI, lifecycle phases, managed state, validation/conversion, Ajax, templating, security, performance, and modern relevance.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 24 — Jakarta Connectors (`jakarta.resource`): Resource Adapter, EIS Integration, Connection Management, XA, dan Message Inflow](./learn-java-jakarta-part-024.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Bagian 26 — Jakarta Faces (`jakarta.faces`): Component-Based Server-Side UI, Lifecycle, State, Validation, Ajax, dan Modern Relevance](./learn-java-jakarta-part-026.md)
