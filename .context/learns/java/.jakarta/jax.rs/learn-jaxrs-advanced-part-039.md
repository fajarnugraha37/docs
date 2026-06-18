# learn-jaxrs-advanced-part-039.md

# Bagian 039 — Legacy JAX-RS 2.1 Features: Async, SSE, Reactive Client, Java EE 8 Maintenance, `javax.ws.rs`, Compatibility Behavior, and Modernization to Jakarta REST 4.0

> Target pembaca: Java/Jakarta engineer yang harus **maintain, debug, migrate, atau modernize aplikasi JAX-RS 2.1 legacy**. Fokus bagian ini bukan mengulang async/SSE/client dari part sebelumnya, tetapi memahami fitur JAX-RS 2.1 dalam konteks legacy: `javax.ws.rs`, Java EE 8, `AsyncResponse`, `CompletionStage`, SSE API, Reactive Client API, JSON-B integration, implementation-specific behavior, compatibility traps, migration ke `jakarta.ws.rs`, dan cara modernisasi tanpa mematahkan client lama.
>
> Namespace legacy: `javax.ws.rs.*`  
> Namespace modern: `jakarta.ws.rs.*`
>
> Prinsip utama:
>
> ```text
> JAX-RS 2.1 features are not obsolete concepts.
> The concepts remain important; the ecosystem and namespace changed.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: JAX-RS 2.1 adalah Jembatan ke Jakarta REST Modern](#2-mental-model-jax-rs-21-adalah-jembatan-ke-jakarta-rest-modern)
3. [JAX-RS 2.1 in Java EE 8](#3-jax-rs-21-in-java-ee-8)
4. [Fitur Utama JAX-RS 2.1](#4-fitur-utama-jax-rs-21)
5. [`javax.ws.rs` Legacy Namespace](#5-javaxwsrs-legacy-namespace)
6. [Server-Side Async Before 2.1: `AsyncResponse`](#6-server-side-async-before-21-asyncresponse)
7. [`@Suspended` and `AsyncResponse`](#7-suspended-and-asyncresponse)
8. [`AsyncResponse` Lifecycle](#8-asyncresponse-lifecycle)
9. [Timeout and Cancellation](#9-timeout-and-cancellation)
10. [Callbacks: Completion and Connection](#10-callbacks-completion-and-connection)
11. [CompletionStage Server Methods](#11-completionstage-server-methods)
12. [`AsyncResponse` vs `CompletionStage`](#12-asyncresponse-vs-completionstage)
13. [Legacy Threading Mistakes](#13-legacy-threading-mistakes)
14. [Request Scope and Async Caveat](#14-request-scope-and-async-caveat)
15. [SSE in JAX-RS 2.1](#15-sse-in-jax-rs-21)
16. [`javax.ws.rs.sse` Package](#16-javaxxwrs-sse-package)
17. [SSE Server: `Sse` and `SseEventSink`](#17-sse-server-sse-and-sseeventsink)
18. [SSE Broadcaster](#18-sse-broadcaster)
19. [SSE Client: `SseEventSource`](#19-sse-client-sseeventsource)
20. [SSE Legacy Operational Problems](#20-sse-legacy-operational-problems)
21. [Reactive Client API](#21-reactive-client-api)
22. [`rx()` and `CompletionStageRxInvoker`](#22-rx-and-completionstagerxinvoker)
23. [Async Client vs Reactive Client](#23-async-client-vs-reactive-client)
24. [Composing Calls with CompletionStage](#24-composing-calls-with-completionstage)
25. [Reactive Client Pitfalls](#25-reactive-client-pitfalls)
26. [JSON-B Integration in JAX-RS 2.1](#26-json-b-integration-in-jax-rs-21)
27. [JSON-P, JSON-B, Jackson in Legacy Apps](#27-json-p-json-b-jackson-in-legacy-apps)
28. [Implementation Behavior: Jersey 2.x](#28-implementation-behavior-jersey-2x)
29. [Implementation Behavior: RESTEasy 3.x/4.x](#29-implementation-behavior-resteasy-3x4x)
30. [Implementation Behavior: WebLogic/Liberty/WildFly](#30-implementation-behavior-weblogiclibertywildfly)
31. [Behavior Changes and Compatibility](#31-behavior-changes-and-compatibility)
32. [Legacy API Contract Preservation](#32-legacy-api-contract-preservation)
33. [Modernization Strategy](#33-modernization-strategy)
34. [Modernizing Async Endpoints](#34-modernizing-async-endpoints)
35. [Modernizing SSE Endpoints](#35-modernizing-sse-endpoints)
36. [Modernizing Reactive Client Code](#36-modernizing-reactive-client-code)
37. [Migration to `jakarta.ws.rs`](#37-migration-to-jakartawsrs)
38. [Dual Runtime / Compatibility Strategy](#38-dual-runtime--compatibility-strategy)
39. [Testing Legacy JAX-RS 2.1 Features](#39-testing-legacy-jax-rs-21-features)
40. [Observability for Legacy Async/SSE/Reactive](#40-observability-for-legacy-asyncssereactive)
41. [Performance and Resource Management](#41-performance-and-resource-management)
42. [Security Considerations](#42-security-considerations)
43. [Common Failure Modes](#43-common-failure-modes)
44. [Best Practices](#44-best-practices)
45. [Anti-Patterns](#45-anti-patterns)
46. [Production Checklist](#46-production-checklist)
47. [Latihan](#47-latihan)
48. [Referensi Resmi](#48-referensi-resmi)
49. [Penutup](#49-penutup)

---

# 1. Tujuan Part Ini

Banyak enterprise system masih memiliki aplikasi yang dibangun dengan:

```text
Java EE 8
JAX-RS 2.1
javax.ws.rs.*
Jersey 2.x / RESTEasy 3.x / CXF 3.x
WildFly / WebLogic / WebSphere Liberty / Payara / Tomcat + Jersey
```

Mungkin aplikasi itu sudah stabil bertahun-tahun, tetapi sekarang perlu:

- maintenance;
- security patch;
- Java upgrade;
- Spring Boot 3 / Jakarta upgrade;
- migration ke Jakarta EE 10/11;
- migration ke Quarkus/Open Liberty modern;
- refactor async logic;
- improve SSE reliability;
- replace deprecated vendor APIs;
- align JSON provider.

JAX-RS 2.1 penting karena memperkenalkan atau mematangkan beberapa fitur yang masih relevan:

```text
CompletionStage server response
Reactive Client API
Server-Sent Events
JSON-B integration
```

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- memahami fitur JAX-RS 2.1 dalam konteks legacy;
- membaca dan memperbaiki kode `javax.ws.rs`;
- membedakan `AsyncResponse`, `CompletionStage`, async client, reactive client;
- memahami SSE API lama dan modern;
- mengenali pitfalls thread/context/resource leak;
- menyusun migration plan dari JAX-RS 2.1 ke Jakarta REST 4.0;
- menjaga backward compatibility HTTP contract;
- menulis test untuk legacy async/SSE/reactive behavior.

## 1.2 Prinsip utama

```text
Legacy does not mean wrong.
Legacy means the assumptions are older.
Your job is to make those assumptions explicit before changing them.
```

---

# 2. Mental Model: JAX-RS 2.1 adalah Jembatan ke Jakarta REST Modern

JAX-RS 2.1 adalah milestone penting karena ia membawa API dari model REST sinkron klasik menuju fitur modern:

```text
server-side async
CompletionStage
reactive client
SSE server/client
JSON-B support
```

Konsep-konsep ini masih ada dalam Jakarta REST modern, hanya namespace dan ekosistemnya berubah.

## 2.1 Legacy shape

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.container.AsyncResponse;
import javax.ws.rs.container.Suspended;
```

## 2.2 Modern shape

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.container.AsyncResponse;
import jakarta.ws.rs.container.Suspended;
```

## 2.3 Same concept, different ecosystem

Perbedaan utamanya:

```text
javax ecosystem:
  Java EE 8 / Jakarta EE 8 era

jakarta ecosystem:
  Jakarta EE 9+ / Jakarta REST modern
```

## 2.4 Top-tier rule

```text
Preserve semantic behavior first; change namespace/runtime second.
```

---

# 3. JAX-RS 2.1 in Java EE 8

JAX-RS 2.1 dikembangkan sebagai JSR 370 dan menjadi bagian dari Java EE 8.

## 3.1 Context

Sebelum JAX-RS 2.1, JAX-RS sudah punya:

- resource classes;
- filters/interceptors;
- client API;
- async response with `AsyncResponse`;
- entity providers;
- exception mappers.

JAX-RS 2.1 menambahkan/mematangkan:

- `CompletionStage` support di server;
- reactive client API;
- Server-Sent Events;
- JSON-B integration.

## 3.2 Why this matters for maintenance

Kalau kamu melihat kode:

```java
target.request().rx().get(...)
```

atau:

```java
@GET
public CompletionStage<Response> get() { ... }
```

atau:

```java
@GET
@Produces(MediaType.SERVER_SENT_EVENTS)
public void stream(@Context SseEventSink sink, @Context Sse sse) { ... }
```

itu kemungkinan lahir dari era JAX-RS 2.1 atau modern Jakarta REST yang melanjutkan API tersebut.

## 3.3 Rule

JAX-RS 2.1 code is often the compatibility layer between old Java EE and modern Jakarta REST.

---

# 4. Fitur Utama JAX-RS 2.1

## 4.1 Server-side CompletionStage

Resource method dapat return `CompletionStage<T>`.

```java
@GET
@Path("/{id}")
public CompletionStage<CustomerDto> get(@PathParam("id") String id) {
    return service.getAsync(id);
}
```

## 4.2 Reactive Client API

```java
CompletionStage<CustomerDto> cs =
    target.request().rx().get(CustomerDto.class);
```

## 4.3 SSE Server/Client

Server:

```java
@GET
@Produces(MediaType.SERVER_SENT_EVENTS)
public void stream(@Context SseEventSink sink, @Context Sse sse) { ... }
```

Client:

```java
SseEventSource source = SseEventSource.target(target).build();
```

## 4.4 JSON-B

JAX-RS 2.1 integrated with Java EE 8 JSON-B ecosystem.

## 4.5 Rule

JAX-RS 2.1 is where many “modern async REST Java” ideas entered the standard API.

---

# 5. `javax.ws.rs` Legacy Namespace

Legacy JAX-RS 2.1 uses:

```text
javax.ws.rs.*
javax.ws.rs.core.*
javax.ws.rs.ext.*
javax.ws.rs.client.*
javax.ws.rs.container.*
javax.ws.rs.sse.*
```

Modern Jakarta REST uses:

```text
jakarta.ws.rs.*
jakarta.ws.rs.core.*
jakarta.ws.rs.ext.*
jakarta.ws.rs.client.*
jakarta.ws.rs.container.*
jakarta.ws.rs.sse.*
```

## 5.1 Important

These are different Java types.

```text
javax.ws.rs.core.Response != jakarta.ws.rs.core.Response
```

## 5.2 Legacy code can be perfectly valid

Do not rewrite only for aesthetics.

Migrate when:

- runtime requires Jakarta;
- dependencies moved;
- security/support requires upgrade;
- platform standard changed;
- Java version upgrade requires ecosystem upgrade.

## 5.3 Rule

Namespace migration must be justified by platform lifecycle and tested by contract.

---

# 6. Server-Side Async Before 2.1: `AsyncResponse`

`AsyncResponse` existed before the `CompletionStage` resource method style.

It lets resource method suspend the response and resume later.

## 6.1 Example

```java
@GET
@Path("/{id}")
public void get(
    @PathParam("id") String id,
    @Suspended AsyncResponse async
) {
    executor.submit(() -> {
        try {
            CustomerDto dto = service.get(id);
            async.resume(dto);
        } catch (Throwable t) {
            async.resume(t);
        }
    });
}
```

## 6.2 Mental model

```text
request arrives
resource method suspends response
request thread returns to container
work continues elsewhere
async response eventually resumed/cancelled/timed out
```

## 6.3 Good use

- long polling;
- waiting for message/event;
- bridging callback API;
- releasing request thread during long work.

## 6.4 Bad use

- starting raw unbounded thread per request;
- pretending background job is same as request;
- no timeout;
- no cancellation;
- holding request-scoped resources forever.

## 6.5 Rule

`AsyncResponse` is response lifecycle control, not background job architecture by itself.

---

# 7. `@Suspended` and `AsyncResponse`

Legacy import:

```java
import javax.ws.rs.container.AsyncResponse;
import javax.ws.rs.container.Suspended;
```

Modern import:

```java
import jakarta.ws.rs.container.AsyncResponse;
import jakarta.ws.rs.container.Suspended;
```

## 7.1 Signature

```java
public void method(@Suspended AsyncResponse async)
```

Usually resource method returns `void`.

## 7.2 Resume with entity

```java
async.resume(dto);
```

Runtime maps DTO to response.

## 7.3 Resume with response

```java
async.resume(Response.ok(dto).build());
```

## 7.4 Resume with throwable

```java
async.resume(exception);
```

Exception mapper should handle it.

## 7.5 Rule

Always guarantee exactly one terminal path: resume, cancel, or timeout.

---

# 8. `AsyncResponse` Lifecycle

States:

```text
suspended
resumed
cancelled
done
```

## 8.1 Methods

Conceptually:

```java
resume(Object)
resume(Throwable)
cancel()
setTimeout(...)
setTimeoutHandler(...)
isSuspended()
isCancelled()
isDone()
register(...)
```

## 8.2 Race

Multiple threads may try to resume/cancel.

Use return value from `resume` to know if succeeded.

```java
boolean accepted = async.resume(response);
```

## 8.3 Cleanup

Remove from registries on completion/timeout/cancel.

## 8.4 Rule

AsyncResponse lifecycle is stateful and race-prone; code defensively.

---

# 9. Timeout and Cancellation

## 9.1 Timeout

```java
async.setTimeout(5, TimeUnit.SECONDS);
async.setTimeoutHandler(ar ->
    ar.resume(Response.status(503)
        .entity(problem("TIMEOUT"))
        .build())
);
```

## 9.2 Cancel

```java
async.cancel();
```

or with retry-after depending API.

## 9.3 Legacy bug

No timeout means suspended responses can accumulate forever.

## 9.4 Rule

Every suspended response must have timeout and cleanup.

---

# 10. Callbacks: Completion and Connection

`AsyncResponse#register` can register callbacks such as:

- completion callback;
- connection callback depending implementation support.

## 10.1 Completion

Used for cleanup/metrics.

```java
async.register((CompletionCallback) throwable -> {
    registry.remove(id);
});
```

## 10.2 Disconnect

Client disconnect detection can be implementation-dependent.

## 10.3 Rule

Do not rely on client disconnect callback unless verified in runtime.

---

# 11. CompletionStage Server Methods

JAX-RS 2.1 introduced resource methods returning `CompletionStage`.

## 11.1 Example

```java
@GET
@Path("/{id}")
@Produces(MediaType.APPLICATION_JSON)
public CompletionStage<CustomerDto> get(@PathParam("id") String id) {
    return customerService.getAsync(id);
}
```

## 11.2 Exception handling

If stage completes exceptionally, runtime should process exception through normal error mapping path.

## 11.3 Benefit

Less boilerplate than `AsyncResponse`.

## 11.4 Caveat

You still need:

- timeout;
- cancellation strategy;
- executor control;
- context propagation;
- error mapping;
- resource cleanup.

## 11.5 Rule

`CompletionStage` is cleaner syntax, not automatic resilience.

---

# 12. `AsyncResponse` vs `CompletionStage`

| Aspect | AsyncResponse | CompletionStage |
|---|---|---|
| Style | imperative/suspend/resume | compositional/future-like |
| Good for | callbacks, manual lifecycle, long-poll registry | async service composition |
| Timeout | explicit on AsyncResponse | external/stage/client/runtime policy |
| Cancellation | explicit cancel | stage cancellation may not stop underlying work |
| Complexity | lifecycle manual | composition/error propagation |
| Legacy prevalence | high | JAX-RS 2.1+ |

## 12.1 Use `AsyncResponse` when

- you need register suspended clients;
- long-poll/event callback;
- manual timeout/cancel;
- bridging non-CompletionStage callback API.

## 12.2 Use `CompletionStage` when

- service already returns stage;
- composing multiple async calls;
- code can express result pipeline naturally.

## 12.3 Rule

Choose based on lifecycle control needs.

---

# 13. Legacy Threading Mistakes

## 13.1 Raw thread per request

Bad:

```java
new Thread(() -> async.resume(service.work())).start();
```

Problems:

- unbounded;
- no monitoring;
- no lifecycle;
- no backpressure;
- no context.

## 13.2 Common pool misuse

```java
CompletableFuture.supplyAsync(() -> blockingDbCall());
```

Uses common ForkJoinPool by default.

Bad for blocking IO.

## 13.3 Blocking event loop

In reactive runtimes, blocking in wrong thread causes latency collapse.

## 13.4 Rule

Async needs managed executor and bounded concurrency.

---

# 14. Request Scope and Async Caveat

Request-scoped objects may not be valid after resource method returns.

Legacy bug:

```java
@RequestScoped
public class CurrentRequest {
    @Context SecurityContext securityContext;
}
```

Then:

```java
executor.submit(() -> currentRequest.actor());
```

This can fail or read wrong/inactive context.

## 14.1 Better

Capture immutable snapshot before async boundary:

```java
CurrentActor actor = actorProvider.current();
TenantId tenant = tenantProvider.current();
String correlationId = correlation.current();

executor.submit(() -> service.work(actor, tenant, correlationId));
```

## 14.2 Rule

Do not pass request-scoped proxies into arbitrary async threads.

---

# 15. SSE in JAX-RS 2.1

Server-Sent Events support was a major JAX-RS 2.1 feature.

SSE is:

```text
server → client
one-way event stream
HTTP-based
text/event-stream
automatic browser reconnect
```

## 15.1 Good use

- notifications;
- status updates;
- dashboards;
- progress events;
- event stream to browser.

## 15.2 Not good for

- bidirectional chat;
- high-frequency binary stream;
- guaranteed delivery;
- transactional event log by itself.

## 15.3 Rule

SSE is notification stream, not message broker.

---

# 16. `javax.ws.rs.sse` Package

Legacy package:

```java
javax.ws.rs.sse.Sse
javax.ws.rs.sse.SseEventSink
javax.ws.rs.sse.SseBroadcaster
javax.ws.rs.sse.OutboundSseEvent
javax.ws.rs.sse.InboundSseEvent
javax.ws.rs.sse.SseEventSource
```

Modern package:

```java
jakarta.ws.rs.sse.*
```

## 16.1 Same mental model

Package changed, concept mostly same.

## 16.2 Migration

Change imports and ensure runtime supports SSE module/feature.

## 16.3 Rule

SSE migration must include runtime/proxy behavior tests, not just imports.

---

# 17. SSE Server: `Sse` and `SseEventSink`

## 17.1 Example legacy

```java
@GET
@Path("/events")
@Produces(MediaType.SERVER_SENT_EVENTS)
public void events(
    @Context Sse sse,
    @Context SseEventSink sink
) {
    OutboundSseEvent event = sse.newEventBuilder()
        .name("connected")
        .id("1")
        .data(String.class, "ok")
        .build();

    sink.send(event);
}
```

## 17.2 Event fields

- `id`;
- `event` name;
- `data`;
- `retry`;
- comments/heartbeat.

## 17.3 Close

Always close sink when done.

## 17.4 Rule

SSE endpoints need explicit lifecycle management.

---

# 18. SSE Broadcaster

`SseBroadcaster` sends events to multiple sinks.

## 18.1 Example

```java
SseBroadcaster broadcaster = sse.newBroadcaster();
broadcaster.register(sink);
broadcaster.broadcast(event);
```

## 18.2 Use cases

- broadcast status updates;
- topic subscribers;
- admin dashboard.

## 18.3 Caveat

Broadcast to many clients can backpressure/fail.

Need:

- sink cleanup;
- error handling;
- heartbeat;
- per-user authorization;
- bounded queues.

## 18.4 Rule

SSE broadcaster is not production pub/sub by itself.

---

# 19. SSE Client: `SseEventSource`

## 19.1 Example

```java
WebTarget target = client.target("https://api.example.com/events");

SseEventSource source = SseEventSource.target(target).build();

source.register(
    event -> System.out.println(event.readData(String.class)),
    error -> error.printStackTrace(),
    () -> System.out.println("closed")
);

source.open();
```

## 19.2 Lifecycle

`SseEventSource` must be closed.

```java
source.close();
```

## 19.3 Reconnect

SSE clients may auto-reconnect, but replay depends on server support for event IDs and `Last-Event-ID`.

## 19.4 Rule

SSE client code must manage lifecycle, error, and reconnect semantics.

---

# 20. SSE Legacy Operational Problems

## 20.1 Proxy buffering

Reverse proxies may buffer and break streaming.

## 20.2 Idle timeout

Connections closed if no heartbeat.

## 20.3 Auth expiry

Long-lived connection with expiring token.

## 20.4 Memory leak

Dead sinks not removed.

## 20.5 Backpressure

Slow clients accumulate pending events.

## 20.6 Rule

Most SSE bugs are operational lifecycle bugs, not compile-time API bugs.

---

# 21. Reactive Client API

JAX-RS 2.1 added reactive client style.

Traditional sync:

```java
CustomerDto dto = target.request().get(CustomerDto.class);
```

Async invoker:

```java
Future<CustomerDto> future = target.request().async().get(CustomerDto.class);
```

Reactive client:

```java
CompletionStage<CustomerDto> stage =
    target.request().rx().get(CustomerDto.class);
```

## 21.1 Why useful

`CompletionStage` composes better:

```java
stage.thenApply(...)
     .thenCompose(...)
     .exceptionally(...);
```

## 21.2 Rule

Reactive client is about composition, not automatically non-blocking everything.

---

# 22. `rx()` and `CompletionStageRxInvoker`

## 22.1 Example

```java
CompletionStage<Response> stage =
    target.request().rx().get();
```

## 22.2 Typed

```java
CompletionStage<CustomerDto> stage =
    target.request().rx().get(CustomerDto.class);
```

## 22.3 Custom reactive invokers

Spec provides default `CompletionStage`-based invoker; implementations may support more reactive types.

## 22.4 Rule

Keep code on standard `CompletionStage` if portability matters.

---

# 23. Async Client vs Reactive Client

| Feature | `async()` | `rx()` |
|---|---|---|
| Return | `Future<T>` | `CompletionStage<T>` |
| Style | callback/future | composition |
| Cancellation | `Future.cancel` style | stage cancellation semantics |
| Composition | manual | built-in stage chaining |
| JAX-RS 2.1 focus | older async style still present | new reactive style |

## 23.1 Recommendation

For legacy maintenance, understand both.

For modernization, prefer `CompletionStage` or a higher-level typed client if suitable.

## 23.2 Rule

Do not mix async styles randomly in one client wrapper.

---

# 24. Composing Calls with CompletionStage

## 24.1 Sequential

```java
CompletionStage<CustomerDto> customer =
    customerTarget.request().rx().get(CustomerDto.class);

CompletionStage<OrderDto> order =
    customer.thenCompose(c ->
        orderTarget.resolveTemplate("customerId", c.id())
            .request()
            .rx()
            .get(OrderDto.class)
    );
```

## 24.2 Parallel

```java
CompletionStage<CustomerDto> c1 = target1.request().rx().get(CustomerDto.class);
CompletionStage<AccountDto> c2 = target2.request().rx().get(AccountDto.class);

CompletionStage<Combined> combined =
    c1.thenCombine(c2, Combined::new);
```

## 24.3 Timeout

`CompletionStage` alone does not mean proper timeout budget.

Use client timeout and/or stage timeout policy.

## 24.4 Rule

Composition must still obey deadline, retry, and failure policy.

---

# 25. Reactive Client Pitfalls

## 25.1 Missing timeout

Stage never completes quickly.

## 25.2 Blocking in callbacks

Callback thread may be implementation-managed.

## 25.3 Exception swallowed

`exceptionally` returns fallback incorrectly.

## 25.4 Response not closed

If using `CompletionStage<Response>`, you still must close response.

## 25.5 Common pool blocking

Bad executor choice.

## 25.6 Rule

Reactive code needs explicit resource and error semantics.

---

# 26. JSON-B Integration in JAX-RS 2.1

JAX-RS 2.1 integrated with Java EE 8 JSON-B.

## 26.1 Why important

Legacy apps may rely on JSON-B defaults.

Migration to modern runtime/Jackson/default provider can change JSON.

## 26.2 Test

Before migration, snapshot:

- field names;
- nulls;
- date/time;
- enum;
- unknown fields;
- BigDecimal.

## 26.3 Rule

JSON provider behavior is part of API contract.

---

# 27. JSON-P, JSON-B, Jackson in Legacy Apps

Legacy apps may mix:

- JSON-P (`javax.json`);
- JSON-B (`javax.json.bind`);
- Jackson JAX-RS provider;
- MOXy in Jersey;
- vendor-specific default.

## 27.1 Migration risk

Switching provider changes serialization.

## 27.2 Strategy

Explicitly configure provider and test contract.

## 27.3 Rule

Do not let runtime upgrade silently change JSON provider.

---

# 28. Implementation Behavior: Jersey 2.x

Jersey 2.x was common for JAX-RS 2.1.

## 28.1 Notes

- SSE often required `jersey-media-sse` module;
- JSON provider selected via modules;
- JerseyTest common for testing;
- ResourceConfig often used;
- HK2/CDI integration details matter.

## 28.2 Migration to Jakarta

Jersey 3.x+ moved to Jakarta namespace.

## 28.3 Rule

Jersey legacy migration must check modules, not only core API.

---

# 29. Implementation Behavior: RESTEasy 3.x/4.x

RESTEasy docs for JAX-RS 2.1 additions highlight:

- `CompletionStage` support;
- Reactive Client API;
- SSE server/client;
- JSON-B.

## 29.1 RESTEasy extensions

RESTEasy may support reactive types beyond standard spec.

## 29.2 Portability risk

If legacy code returns RxJava/Reactor types supported by RESTEasy extension, migration to another runtime may fail.

## 29.3 Rule

Identify RESTEasy-specific reactive extensions before modernization.

---

# 30. Implementation Behavior: WebLogic/Liberty/WildFly

## 30.1 WebLogic

SSE support through JAX-RS/Jersey integration depending version.

## 30.2 Liberty

JAX-RS 2.1 feature requires Java EE 8 dependent features in older Liberty generation; Jakarta REST newer features require Jakarta runtime features.

## 30.3 WildFly

RESTEasy based; version tied to server.

## 30.4 Rule

In app servers, feature/runtime version controls behavior more than your Maven dependency.

---

# 31. Behavior Changes and Compatibility

During migration/upgrade, behavior can change:

- default error body;
- exception mapper priority;
- JSON provider;
- validation status code;
- SSE reconnect;
- async timeout;
- client connector;
- 404/405 behavior;
- provider discovery;
- CDI injection.

## 31.1 Rule

Treat runtime upgrade as behavior change risk even if API contract intended unchanged.

---

# 32. Legacy API Contract Preservation

Before modernization, capture baseline.

## 32.1 Baseline tests

- OpenAPI snapshot;
- golden response JSON;
- status codes;
- error bodies;
- headers;
- content negotiation;
- SSE event shape;
- async timeout behavior.

## 32.2 Rule

You cannot preserve behavior you have not documented/tested.

---

# 33. Modernization Strategy

## 33.1 First stabilize

Add tests around legacy behavior.

## 33.2 Then refactor internals

Improve async executor, cleanup, observability.

## 33.3 Then migrate namespace/runtime

Move to `jakarta.ws.rs`.

## 33.4 Then improve API contract intentionally

Use versioning if breaking.

## 33.5 Rule

Do not combine behavior redesign with namespace migration unless unavoidable.

---

# 34. Modernizing Async Endpoints

## 34.1 From raw thread to managed executor

Replace:

```java
new Thread(...)
```

with bounded managed executor.

## 34.2 Add timeout

Every suspended response.

## 34.3 Add cleanup

Completion callback removes registry entries.

## 34.4 Add metrics

Track:

- active suspended responses;
- timeout;
- cancellation;
- completion latency.

## 34.5 Consider CompletionStage

If logic naturally returns future.

## 34.6 Rule

Modernization target is controlled lifecycle, not just newer syntax.

---

# 35. Modernizing SSE Endpoints

## 35.1 Add heartbeat

Prevent idle timeout.

## 35.2 Add replay if needed

Use event ID and bounded replay buffer.

## 35.3 Add authorization per stream

Do not broadcast unauthorized data.

## 35.4 Add backpressure policy

Drop/coalesce/disconnect slow clients.

## 35.5 Test through proxy

Production route matters.

## 35.6 Rule

SSE modernization is mostly operational hardening.

---

# 36. Modernizing Reactive Client Code

## 36.1 Centralize client wrapper

Do not scatter `target.request().rx()`.

## 36.2 Add timeout/retry policy

Per operation.

## 36.3 Close Response

If using `CompletionStage<Response>`, close in completion path.

## 36.4 Use standard CompletionStage

Avoid vendor reactive types unless intentionally tied to runtime.

## 36.5 Rule

Reactive client modernization should improve contract and resilience, not just syntax.

---

# 37. Migration to `jakarta.ws.rs`

## 37.1 Direct mapping

```text
javax.ws.rs → jakarta.ws.rs
javax.ws.rs.client → jakarta.ws.rs.client
javax.ws.rs.container → jakarta.ws.rs.container
javax.ws.rs.core → jakarta.ws.rs.core
javax.ws.rs.ext → jakarta.ws.rs.ext
javax.ws.rs.sse → jakarta.ws.rs.sse
```

## 37.2 Ecosystem mapping

Also:

```text
javax.json → jakarta.json
javax.json.bind → jakarta.json.bind
javax.validation → jakarta.validation
javax.inject → jakarta.inject
javax.enterprise → jakarta.enterprise
javax.servlet → jakarta.servlet
```

## 37.3 Rule

Migrate all relevant Jakarta EE specs together.

---

# 38. Dual Runtime / Compatibility Strategy

Sometimes you need support old and new temporarily.

## 38.1 Option 1: two branches

`javax` branch for old runtime, `jakarta` branch for new runtime.

## 38.2 Option 2: transform artifacts

Use Eclipse Transformer for binary transformation.

## 38.3 Option 3: separate services

Run old service separately and migrate consumers gradually.

## 38.4 Avoid

Trying to compile one module against both `javax.ws.rs` and `jakarta.ws.rs` directly.

## 38.5 Rule

Dual namespace support is costly; keep it temporary.

---

# 39. Testing Legacy JAX-RS 2.1 Features

Test matrix:

## 39.1 AsyncResponse

- success resume;
- exception resume;
- timeout;
- cancel;
- double resume race;
- cleanup callback;
- client disconnect if supported.

## 39.2 CompletionStage

- completed success;
- exceptional completion;
- timeout policy;
- executor usage;
- context snapshot.

## 39.3 SSE

- first event;
- heartbeat;
- event ID;
- client reconnect;
- sink cleanup;
- broadcaster error;
- slow client.

## 39.4 Reactive client

- success stage;
- exceptional stage;
- response processing error;
- timeout;
- retry;
- Response close.

## 39.5 Rule

Legacy async features require lifecycle tests, not only result tests.

---

# 40. Observability for Legacy Async/SSE/Reactive

## 40.1 Async metrics

```text
jaxrs_async_suspended_current
jaxrs_async_timeout_total
jaxrs_async_cancelled_total
jaxrs_async_completed_total
jaxrs_async_duration_seconds
```

## 40.2 SSE metrics

```text
sse_connections_current
sse_events_sent_total
sse_send_failures_total
sse_reconnect_total
sse_slow_client_disconnect_total
```

## 40.3 Reactive client metrics

```text
http_client_reactive_calls_total
http_client_stage_failures_total
http_client_timeouts_total
```

## 40.4 Rule

Async/streaming systems must expose lifecycle metrics.

---

# 41. Performance and Resource Management

## 41.1 Async server

Watch:

- executor queue;
- active suspended responses;
- timeout;
- memory;
- request context retention.

## 41.2 SSE

Watch:

- open connections;
- buffer per client;
- heartbeat interval;
- proxy timeout;
- event fan-out latency.

## 41.3 Reactive client

Watch:

- executor usage;
- connection pool;
- stage chain blocking;
- retry amplification.

## 41.4 Rule

Async APIs can reduce request-thread usage but increase lifecycle/resource complexity.

---

# 42. Security Considerations

## 42.1 Async

Capture actor/tenant before async boundary.

Do not use stale request context.

## 42.2 SSE

Authorize subscription and event delivery.

Avoid cross-tenant broadcast.

Handle token expiry.

## 42.3 Reactive client

Propagate auth/correlation safely.

Do not log tokens in stage errors.

## 42.4 Rule

Async does not weaken security requirements; it makes context handling harder.

---

# 43. Common Failure Modes

## 43.1 Suspended response never resumed

Memory/request leak.

## 43.2 No timeout

Infinite wait.

## 43.3 Raw unbounded thread

Thread explosion.

## 43.4 Request-scoped bean used after request

Context inactive.

## 43.5 SSE sink not removed

Memory leak.

## 43.6 SSE no heartbeat

Proxy closes connection.

## 43.7 Slow SSE client buffers forever

Memory blow-up.

## 43.8 Reactive stage returns Response but never closes it

Connection leak.

## 43.9 Vendor reactive type not portable

Migration failure.

## 43.10 JSON provider changes during upgrade

API contract break.

## 43.11 Mixed `javax`/`jakarta`

Runtime class mismatch.

## 43.12 Async exception not mapped

500/default error body.

---

# 44. Best Practices

## 44.1 Add tests before modernization

Golden behavior first.

## 44.2 Use bounded executors

No raw threads.

## 44.3 Always timeout async responses

And cleanup.

## 44.4 Snapshot context

Actor/tenant/correlation before async.

## 44.5 Keep SSE lifecycle explicit

Heartbeat, cleanup, backpressure.

## 44.6 Use standard CompletionStage for portability

Avoid vendor types unless isolated.

## 44.7 Explicit JSON provider

Prevent migration drift.

## 44.8 Use OpenAPI/contract diff

Guard API compatibility.

## 44.9 Migrate namespace as ecosystem

Not single import.

## 44.10 Observe lifecycle

Metrics/traces/logs.

---

# 45. Anti-Patterns

## 45.1 “Async means faster”

Not if work is blocking and executor is overloaded.

## 45.2 `CompletableFuture.supplyAsync` with blocking DB on common pool

Bad.

## 45.3 SSE broadcaster as message broker

No durability/backpressure by default.

## 45.4 Return `CompletionStage<Response>` and forget close paths

Leak risk when manually handling response.

## 45.5 Change JSON provider during migration without tests

Contract break.

## 45.6 Search-replace `javax` without dependency alignment

Mixed classpath.

## 45.7 Modernize behavior and namespace in one giant PR

Hard to review.

## 45.8 Trust app server defaults

Runtime behavior differs.

## 45.9 No proxy test for SSE

Production failure.

## 45.10 No canary for migration

High risk.

---

# 46. Production Checklist

## 46.1 Legacy inventory

- [ ] JAX-RS version known.
- [ ] Runtime/app server known.
- [ ] Implementation known.
- [ ] JSON provider known.
- [ ] Async endpoints listed.
- [ ] SSE endpoints listed.
- [ ] Reactive client usage listed.
- [ ] Vendor-specific APIs listed.
- [ ] `javax` dependencies inventoried.

## 46.2 Async hardening

- [ ] Bounded executor.
- [ ] Timeout configured.
- [ ] Timeout handler returns stable Problem Details.
- [ ] Completion cleanup.
- [ ] Double resume safe.
- [ ] Context snapshot.
- [ ] Metrics/logs.

## 46.3 SSE hardening

- [ ] Heartbeat.
- [ ] Sink cleanup.
- [ ] Backpressure policy.
- [ ] Authorization per stream.
- [ ] Event ID/replay policy.
- [ ] Proxy/gateway tested.
- [ ] Client reconnect tested.

## 46.4 Reactive client hardening

- [ ] Timeout.
- [ ] Retry policy.
- [ ] Response closed.
- [ ] Error mapping.
- [ ] Executor reviewed.
- [ ] Vendor reactive types isolated.
- [ ] Mock server tests.

## 46.5 Migration readiness

- [ ] OpenAPI/golden tests baseline.
- [ ] JSON contract baseline.
- [ ] Namespace migration plan.
- [ ] Dependency/runtime alignment.
- [ ] Contract diff in CI.
- [ ] Canary/rollback plan.

---

# 47. Latihan

## Latihan 1 — AsyncResponse Cleanup

Ambil endpoint `AsyncResponse`.

Tambahkan:

- timeout;
- completion callback;
- registry cleanup;
- double resume guard.

Test semua lifecycle.

## Latihan 2 — CompletionStage Modernization

Refactor endpoint callback-style menjadi `CompletionStage`.

Pastikan exception mapper tetap bekerja.

## Latihan 3 — SSE Hardening

Tambahkan:

- heartbeat tiap 15 detik;
- sink cleanup on error;
- event ID;
- bounded replay 100 event.

Test reconnect.

## Latihan 4 — Reactive Client Close

Cari client method yang return `CompletionStage<Response>`.

Pastikan response ditutup di semua path.

## Latihan 5 — JSON Baseline

Snapshot JSON output legacy runtime.

Upgrade provider/runtime.

Compare output.

## Latihan 6 — Vendor Extension Inventory

Cari imports:

```text
org.glassfish.jersey
org.jboss.resteasy
org.apache.cxf
```

Tandai mana yang harus diisolasi.

## Latihan 7 — javax to jakarta Spike

Migrasikan satu module kecil.

Run:

- unit tests;
- runtime integration tests;
- OpenAPI diff.

## Latihan 8 — SSE Through Proxy

Jalankan SSE endpoint melalui reverse proxy.

Test idle timeout dan buffering.

## Latihan 9 — Reactive Client Fault Matrix

Test:

- 200 valid;
- 200 malformed;
- 503 then success;
- read timeout;
- connection reset;
- 429 Retry-After.

---

# 48. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 3.0 Specification — notes JAX-RS 2.1 was developed as JSR 370  
   https://jakarta.ee/specifications/restful-ws/3.0/jakarta-restful-ws-spec-3.0.html

2. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

3. Jakarta RESTful Web Services 4.0 — `AsyncResponse` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/asyncresponse

4. Jakarta RESTful Web Services 4.0 — Client API `CompletionStageRxInvoker` Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/completionstagerxinvoker

5. Jakarta RESTful Web Services 4.0 — SSE Package Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/sse/package-summary

6. RESTEasy User Guide — JAX-RS 2.1 Additions  
   https://docs.jboss.org/resteasy/docs/4.5.6.Final/userguide/html/JAX-RS_2.1_additions.html

7. Red Hat EAP Docs — AsyncResponse API in Jakarta RESTful Web Services 2.1  
   https://docs.redhat.com/en/documentation/red_hat_jboss_enterprise_application_platform/7.4/html/developing_web_services_applications/developing_jakarta_restful_web_services_web_services

8. Oracle WebLogic — Using Server-Sent Events  
   https://docs.oracle.com/en/middleware/standalone/weblogic-server/15.1.1/restf/using-server-sent-events.html

9. IBM Liberty — JAX-RS 2.1 behavior changes  
   https://www.ibm.com/docs/en/was-liberty/base?topic=liberty-jax-rs-21-behavior-changes

---

# 49. Penutup

JAX-RS 2.1 adalah legacy yang sangat penting, karena banyak fitur modern Jakarta REST hari ini berakar dari sana.

Mental model final:

```text
JAX-RS 2.1:
  javax.ws.rs
  Java EE 8
  AsyncResponse
  CompletionStage
  SSE
  Reactive Client
  JSON-B

Jakarta REST modern:
  jakarta.ws.rs
  Jakarta EE 9/10/11
  same core concepts
  newer runtime ecosystem
```

Prinsip final:

```text
Maintain semantics before changing syntax.
Baseline behavior before migration.
Async requires lifecycle control.
SSE requires operational hardening.
Reactive client requires resource and error discipline.
Namespace migration requires ecosystem alignment.
```

Top-tier JAX-RS engineer memastikan:

- legacy async endpoints punya timeout/cleanup;
- SSE endpoints punya heartbeat/backpressure/reconnect policy;
- reactive client punya timeout/retry/error/resource management;
- vendor-specific extensions diinventarisasi;
- JSON behavior dibaseline;
- migrasi `javax` → `jakarta` dilakukan sebagai ecosystem migration;
- OpenAPI/contract/golden tests melindungi behavior client lama.

Part berikutnya:

```text
Bagian 040 — Production Observability for JAX-RS
```

Kita akan membahas observability production-grade untuk Jakarta REST: logs, metrics, tracing, correlation ID, OpenTelemetry, HTTP semantic conventions, error taxonomy, SLOs, RED/USE metrics, dashboards, and incident debugging.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-038.md](./learn-jaxrs-advanced-part-038.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-040.md](./learn-jaxrs-advanced-part-040.md)

</div>