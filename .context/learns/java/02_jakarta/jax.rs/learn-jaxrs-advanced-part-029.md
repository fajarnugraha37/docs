# learn-jaxrs-advanced-part-029.md

# Bagian 029 — Advanced Client API: Filters, Interceptors, Features, Async, Reactive Invoker, SSE Client, Resilience Hooks, and Production Instrumentation

> Target pembaca: Java/Jakarta engineer yang ingin menguasai **advanced Jakarta REST / JAX-RS Client API** secara production-grade. Fokus bagian ini bukan lagi GET/POST dasar, tetapi extension pipeline client-side: `ClientRequestFilter`, `ClientResponseFilter`, `ReaderInterceptor`, `WriterInterceptor`, `Feature`, provider registration, priorities, request/response context mutation, async invocation, `InvocationCallback`, `CompletionStageRxInvoker`, SSE client `SseEventSource`, instrumentation, resilience hooks, retries, token refresh, response buffering, streaming caveats, and test strategy.
>
> Namespace utama: `jakarta.ws.rs.client.ClientRequestFilter`, `ClientResponseFilter`, `ClientRequestContext`, `ClientResponseContext`, `InvocationCallback`, `AsyncInvoker`, `CompletionStageRxInvoker`, `RxInvoker`, `Feature`, `FeatureContext`, `ReaderInterceptor`, `WriterInterceptor`, `SseEventSource`, `InboundSseEvent`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Client Pipeline adalah Outbound Middleware Chain](#2-mental-model-client-pipeline-adalah-outbound-middleware-chain)
3. [Client Invocation Lifecycle](#3-client-invocation-lifecycle)
4. [Extension Points Overview](#4-extension-points-overview)
5. [`ClientRequestFilter`](#5-clientrequestfilter)
6. [`ClientRequestContext`](#6-clientrequestcontext)
7. [Mutating Request Headers](#7-mutating-request-headers)
8. [Aborting Client Request](#8-aborting-client-request)
9. [`ClientResponseFilter`](#9-clientresponsefilter)
10. [`ClientResponseContext`](#10-clientresponsecontext)
11. [Response Entity Stream Caveat](#11-response-entity-stream-caveat)
12. [ReaderInterceptor on Client Side](#12-readerinterceptor-on-client-side)
13. [WriterInterceptor on Client Side](#13-writerinterceptor-on-client-side)
14. [Filter vs Interceptor](#14-filter-vs-interceptor)
15. [Provider Registration Scope](#15-provider-registration-scope)
16. [`Feature` for Client Modules](#16-feature-for-client-modules)
17. [Priority Ordering](#17-priority-ordering)
18. [Client-Side Correlation ID](#18-client-side-correlation-id)
19. [Authentication Filter](#19-authentication-filter)
20. [Token Refresh and 401 Handling](#20-token-refresh-and-401-handling)
21. [Request Signing Filter](#21-request-signing-filter)
22. [Idempotency-Key Filter](#22-idempotency-key-filter)
23. [Conditional Request Filter](#23-conditional-request-filter)
24. [User-Agent and Service Identity](#24-user-agent-and-service-identity)
25. [Safe Client Logging](#25-safe-client-logging)
26. [Wire Logging vs Semantic Logging](#26-wire-logging-vs-semantic-logging)
27. [Metrics Filter](#27-metrics-filter)
28. [Tracing Filter](#28-tracing-filter)
29. [Retry Hooks](#29-retry-hooks)
30. [Why Retry Inside Filter Is Dangerous](#30-why-retry-inside-filter-is-dangerous)
31. [Circuit Breaker, Bulkhead, Timeout Integration](#31-circuit-breaker-bulkhead-timeout-integration)
32. [Async Invocation with `async()`](#32-async-invocation-with-async)
33. [`Future<Response>` Pattern](#33-futureresponse-pattern)
34. [`InvocationCallback<T>` Pattern](#34-invocationcallbackt-pattern)
35. [Async Error Semantics](#35-async-error-semantics)
36. [Executor Service for Async Client](#36-executor-service-for-async-client)
37. [Cancellation](#37-cancellation)
38. [Reactive Invocation with `rx()`](#38-reactive-invocation-with-rx)
39. [`CompletionStageRxInvoker`](#39-completionstagerxinvoker)
40. [Composition with CompletionStage](#40-composition-with-completionstage)
41. [Avoid Blocking in CompletionStage Chains](#41-avoid-blocking-in-completionstage-chains)
42. [SSE Client with `SseEventSource`](#42-sse-client-with-sseeventsource)
43. [SSE Client Lifecycle](#43-sse-client-lifecycle)
44. [SSE Consumers: onEvent, onError, onComplete](#44-sse-consumers-onevent-onerror-oncomplete)
45. [SSE Reconnect Behavior](#45-sse-reconnect-behavior)
46. [SSE Client Backpressure and Slow Consumer](#46-sse-client-backpressure-and-slow-consumer)
47. [SSE Client Auth and Headers](#47-sse-client-auth-and-headers)
48. [Streaming Download Client with Filters](#48-streaming-download-client-with-filters)
49. [Multipart Upload Client Caveat](#49-multipart-upload-client-caveat)
50. [Response Buffering Strategy](#50-response-buffering-strategy)
51. [Exception Taxonomy](#51-exception-taxonomy)
52. [Advanced Client Wrapper Architecture](#52-advanced-client-wrapper-architecture)
53. [Testing Filters and Interceptors](#53-testing-filters-and-interceptors)
54. [Testing Async Client](#54-testing-async-client)
55. [Testing SSE Client](#55-testing-sse-client)
56. [Runtime Differences](#56-runtime-differences)
57. [Common Failure Modes](#57-common-failure-modes)
58. [Best Practices](#58-best-practices)
59. [Anti-Patterns](#59-anti-patterns)
60. [Production Checklist](#60-production-checklist)
61. [Latihan](#61-latihan)
62. [Referensi Resmi](#62-referensi-resmi)
63. [Penutup](#63-penutup)

---

# 1. Tujuan Part Ini

Part sebelumnya membahas client API dasar:

```text
ClientBuilder
Client
WebTarget
Invocation.Builder
Entity
Response
readEntity
close
GenericType
timeouts
provider registration dasar
```

Sekarang kita masuk ke level advanced: bagaimana membangun outbound HTTP client yang layak dipakai di sistem enterprise.

Contoh kebutuhan nyata:

- semua outbound call harus membawa correlation ID;
- semua request ke downstream A butuh OAuth bearer token;
- semua request ke partner butuh HMAC signature;
- response error harus decode `application/problem+json`;
- metrics dan tracing harus otomatis;
- retry hanya boleh untuk operasi aman/idempotent;
- token refresh harus single-flight, bukan refresh storm;
- streaming download tidak boleh dibuffer oleh logging filter;
- SSE client harus reconnect dan cleanup;
- async call harus punya executor, timeout, cancellation, dan exception taxonomy.

## 1.1 Prinsip utama

```text
JAX-RS Client extension pipeline is outbound middleware.
It is powerful enough to centralize cross-cutting concerns,
but dangerous if used to hide business logic, retries, or resource ownership.
```

---

# 2. Mental Model: Client Pipeline adalah Outbound Middleware Chain

Ketika client melakukan request:

```java
Response response = target.request().get();
```

runtime tidak langsung menulis bytes ke network. Ada pipeline:

```text
Application code
  ↓
Invocation.Builder
  ↓
ClientRequestFilter chain
  ↓
WriterInterceptor chain, if request entity exists
  ↓
MessageBodyWriter
  ↓
transport connector
  ↓
remote HTTP server
  ↓
ClientResponseFilter chain
  ↓
ReaderInterceptor chain, when response entity is read
  ↓
MessageBodyReader
  ↓
Application receives Response/entity
```

## 2.1 Request filters

Mengubah metadata request sebelum network call:

- headers;
- cookies;
- URI;
- method metadata;
- auth;
- correlation;
- abort request.

## 2.2 Writer interceptors

Membungkus penulisan request entity:

- compression;
- encryption;
- signing body;
- hashing;
- metrics byte count.

## 2.3 Response filters

Melihat/mengubah metadata response setelah diterima:

- status;
- headers;
- metrics;
- retry metadata;
- response validation.

## 2.4 Reader interceptors

Membungkus pembacaan response entity:

- decompression;
- decryption;
- checksum verification;
- body metering.

## 2.5 Rule

```text
Filters work on metadata and invocation flow.
Interceptors work around entity body serialization/deserialization.
```

---

# 3. Client Invocation Lifecycle

Lifecycle sync request:

```text
build request
  ↓
run ClientRequestFilter(s)
  ↓
if entity: WriterInterceptor(s) + MessageBodyWriter
  ↓
send via transport
  ↓
receive status/headers/entity stream
  ↓
run ClientResponseFilter(s)
  ↓
application gets Response or typed entity
  ↓
when readEntity: ReaderInterceptor(s) + MessageBodyReader
  ↓
close response
```

## 3.1 Important consequence

Response filters run before application reads entity.

If response filter reads entity stream incorrectly, application may no longer be able to read it.

## 3.2 Error timing

Different failure points produce different exceptions:

```text
before response received → ProcessingException
response received, entity mapping fails → ResponseProcessingException
HTTP non-2xx → normal Response or WebApplicationException depending call style
```

## 3.3 Rule

Know which stage you are in before adding behavior.

---

# 4. Extension Points Overview

| Extension | Client-side use | Main risk |
|---|---|---|
| `ClientRequestFilter` | headers, auth, correlation, signing metadata | hiding business logic, logging secrets |
| `ClientResponseFilter` | metrics, error metadata, response validation | consuming entity stream accidentally |
| `WriterInterceptor` | request body wrapping, compression, hash/signature | breaking streaming and content-length |
| `ReaderInterceptor` | response body wrapping, decompression, verification | buffering large bodies |
| `Feature` | register a group of providers/config | over-global registration |
| `AsyncInvoker` | Future/callback async calls | unmanaged futures, no cancellation |
| `CompletionStageRxInvoker` | CompletionStage composition | blocking stage chains |
| `SseEventSource` | consume SSE streams | lifecycle/reconnect/backpressure leaks |

## 4.1 Rule

Use the narrowest extension point that solves the concern.

---

# 5. `ClientRequestFilter`

`ClientRequestFilter` runs before the request is dispatched to the client transport layer.

## 5.1 Basic filter

```java
@Provider
public class CorrelationIdClientFilter implements ClientRequestFilter {

    @Override
    public void filter(ClientRequestContext ctx) {
        ctx.getHeaders().putSingle("X-Correlation-ID", CorrelationId.currentOrCreate());
    }
}
```

Register:

```java
Client client = ClientBuilder.newBuilder()
    .register(CorrelationIdClientFilter.class)
    .build();
```

## 5.2 Use cases

- correlation ID;
- Authorization header;
- User-Agent;
- Idempotency-Key;
- tenant/service identity header;
- request signing;
- metrics start timestamp;
- tracing injection.

## 5.3 Do not use for

- business decisions;
- calling another downstream synchronously;
- parsing large request bodies;
- retrying complex operations blindly.

## 5.4 Rule

Request filters should be fast, deterministic, and side-effect-light.

---

# 6. `ClientRequestContext`

`ClientRequestContext` exposes outbound request metadata.

Common operations:

```java
URI uri = ctx.getUri();
String method = ctx.getMethod();
MultivaluedMap<String, Object> headers = ctx.getHeaders();
Object entity = ctx.getEntity();
ctx.setProperty("startedAtNanos", System.nanoTime());
```

## 6.1 URI mutation

Some APIs allow URI mutation through context methods.

Use carefully. It can break signature, logging, metrics, and target assumptions.

## 6.2 Header mutation

Common and safe when centralized.

## 6.3 Entity metadata

You can inspect whether request has entity.

Avoid reading/serializing entity in filter.

## 6.4 Properties

Good for passing data from request filter to response filter.

```java
ctx.setProperty("operationName", "CustomerClient.getCustomer");
```

## 6.5 Rule

Use context properties for pipeline metadata, not business state.

---

# 7. Mutating Request Headers

## 7.1 Put single

```java
ctx.getHeaders().putSingle("X-Correlation-ID", correlationId);
```

## 7.2 Add value

```java
ctx.getHeaders().add("Accept", "application/json");
```

## 7.3 Avoid duplication

For singleton headers like Authorization, use `putSingle`.

## 7.4 Redaction policy

Any logging filter must redact:

```text
Authorization
Cookie
Set-Cookie
X-API-Key
Proxy-Authorization
```

## 7.5 Rule

Header mutation should be explicit, idempotent, and security-reviewed.

---

# 8. Aborting Client Request

A request filter can abort the request before it goes to network.

## 8.1 Example

```java
public class LocalCircuitOpenFilter implements ClientRequestFilter {
    @Override
    public void filter(ClientRequestContext ctx) {
        if (circuitBreaker.isOpen()) {
            ctx.abortWith(Response.status(503)
                .header("X-Client-Aborted", "circuit-open")
                .entity("Downstream circuit is open")
                .build());
        }
    }
}
```

## 8.2 What happens?

No network request is sent.

Client response filters still may run depending pipeline semantics, because response was provided by request filter.

## 8.3 Use cases

- local circuit open;
- missing required auth token;
- invalid outbound request config;
- request budget exhausted.

## 8.4 Caution

Abort response is local synthetic response, not downstream response.

Metrics must distinguish:

```text
client_aborted_locally vs downstream_response
```

## 8.5 Rule

Abort only for local policy, and mark it clearly.

---

# 9. `ClientResponseFilter`

`ClientResponseFilter` runs after response is available, either from request filter abort or network invocation.

## 9.1 Basic filter

```java
@Provider
public class MetricsClientResponseFilter implements ClientResponseFilter {

    @Override
    public void filter(ClientRequestContext req, ClientResponseContext res) {
        long started = (long) req.getProperty("startedAtNanos");
        long elapsed = System.nanoTime() - started;
        metrics.record(req.getMethod(), res.getStatus(), elapsed);
    }
}
```

## 9.2 Use cases

- metrics;
- tracing response status;
- response header validation;
- capturing downstream request ID;
- redacted logging;
- local error classification metadata.

## 9.3 Caution

Response filter sees entity stream but should not consume it unless it replaces/buffers stream safely.

## 9.4 Rule

Response filters should usually inspect metadata only.

---

# 10. `ClientResponseContext`

`ClientResponseContext` exposes:

```java
int status = res.getStatus();
MultivaluedMap<String, String> headers = res.getHeaders();
InputStream entityStream = res.getEntityStream();
boolean hasEntity = res.hasEntity();
```

## 10.1 Changing status/headers

Possible but should be rare.

Changing downstream response can confuse error handling.

## 10.2 Entity stream

If you read it, application may not be able to read it later.

## 10.3 Safe body logging pattern

Only for small bounded bodies:

```java
byte[] bytes = readUpToLimit(res.getEntityStream(), maxBytes);
res.setEntityStream(new ByteArrayInputStream(bytes));
```

But this fails for large streaming responses and can hide truncation.

## 10.4 Rule

Entity stream handling in response filters is high-risk.

---

# 11. Response Entity Stream Caveat

The biggest client response filter bug:

```java
String body = new String(res.getEntityStream().readAllBytes(), UTF_8);
log.info(body);
```

Then application later calls:

```java
response.readEntity(CustomerResponse.class)
```

But stream is already consumed.

## 11.1 Correct if bounded

```java
byte[] body = readSmallBody(res.getEntityStream(), maxBytes);
res.setEntityStream(new ByteArrayInputStream(body));
```

## 11.2 Not correct for large downloads

Never buffer unbounded.

## 11.3 Better

Do semantic logging:

```text
status, media type, content length, error code if decoded by wrapper
```

## 11.4 Rule

Do not log response body in filters by default.

---

# 12. ReaderInterceptor on Client Side

`ReaderInterceptor` wraps response entity reading.

## 12.1 Concept

It intercepts before `MessageBodyReader` reads the entity.

```java
@Provider
public class BodyHashReaderInterceptor implements ReaderInterceptor {
    @Override
    public Object aroundReadFrom(ReaderInterceptorContext ctx) throws IOException {
        InputStream original = ctx.getInputStream();
        DigestInputStream digesting = new DigestInputStream(original, sha256());
        ctx.setInputStream(digesting);
        Object result = ctx.proceed();
        // digest now contains hash after full read
        return result;
    }
}
```

## 12.2 Use cases

- decompression;
- decryption;
- body hash verification;
- metering bytes;
- transforming stream.

## 12.3 Must call proceed

Interceptors must call `ctx.proceed()` to continue chain unless intentionally replacing behavior.

## 12.4 Rule

Use ReaderInterceptor for entity stream concerns, not headers-only concerns.

---

# 13. WriterInterceptor on Client Side

`WriterInterceptor` wraps request entity writing.

## 13.1 Concept

It intercepts before `MessageBodyWriter` writes request entity to output stream.

```java
@Provider
public class GzipRequestWriterInterceptor implements WriterInterceptor {
    @Override
    public void aroundWriteTo(WriterInterceptorContext ctx) throws IOException {
        ctx.getHeaders().putSingle("Content-Encoding", "gzip");
        OutputStream original = ctx.getOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(original)) {
            ctx.setOutputStream(gzip);
            ctx.proceed();
        }
    }
}
```

## 13.2 Use cases

- compression;
- encryption;
- request body signing/hashing;
- byte counting.

## 13.3 Content-Length caveat

If you transform body, original content length may become invalid.

Remove or recompute `Content-Length` according to runtime capability.

## 13.4 Rule

WriterInterceptor can alter bytes; therefore it also alters protocol metadata responsibility.

---

# 14. Filter vs Interceptor

## 14.1 Request filter

Best for:

```text
Authorization header
Correlation ID
User-Agent
Idempotency-Key
tracing headers
```

## 14.2 Writer interceptor

Best for:

```text
request body compression/encryption/signature
```

## 14.3 Response filter

Best for:

```text
status metrics
response headers
downstream request id
```

## 14.4 Reader interceptor

Best for:

```text
response body decompression/decryption/verification
```

## 14.5 Rule

Do metadata concerns in filters; byte stream concerns in interceptors.

---

# 15. Provider Registration Scope

You can register providers on:

```text
Client
WebTarget
Invocation.Builder? via request-specific properties/headers, not provider registration normally
```

## 15.1 Client-wide

```java
Client client = ClientBuilder.newBuilder()
    .register(CorrelationIdFilter.class)
    .register(JsonProvider.class)
    .build();
```

Applies to all targets derived from client.

## 15.2 Target-specific

```java
WebTarget partnerTarget = client.target(partnerBase)
    .register(PartnerSignatureFeature.class);
```

Good when only one downstream needs special provider.

## 15.3 Duplicate registration

JAX-RS implementations must reject duplicate registration attempts for a component type that already has class/instance-based registration.

## 15.4 Rule

Register provider at the narrowest scope where it is correct.

---

# 16. `Feature` for Client Modules

`Feature` registers a group of providers/configuration.

## 16.1 Example

```java
public class ObservabilityClientFeature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        context.register(CorrelationIdClientFilter.class);
        context.register(MetricsClientFilter.class);
        context.register(TracingClientFilter.class);
        return true;
    }
}
```

Register:

```java
client.register(new ObservabilityClientFeature());
```

## 16.2 Good for

- observability module;
- partner auth module;
- Problem Details decoder helpers;
- compression module.

## 16.3 Do not overuse

Too many features can hide what providers are active.

## 16.4 Rule

Use Feature to package cohesive client behavior.

---

# 17. Priority Ordering

Filters and interceptors can be ordered with `@Priority`.

## 17.1 Example

```java
@Priority(Priorities.AUTHENTICATION)
public class BearerTokenFilter implements ClientRequestFilter { ... }
```

## 17.2 Why order matters

Request pipeline example:

```text
correlation → auth → signing → logging/metrics
```

If signing happens before auth header added, signature may not cover auth header if required.

If logging happens before redaction, secrets leak.

## 17.3 Same priority

Ordering may be implementation-defined.

## 17.4 Rule

Assign priorities deliberately for security-sensitive providers.

---

# 18. Client-Side Correlation ID

## 18.1 Filter

```java
@Provider
@Priority(Priorities.HEADER_DECORATOR)
public class CorrelationIdFilter implements ClientRequestFilter {
    @Override
    public void filter(ClientRequestContext ctx) {
        String id = Correlation.currentOrCreate();
        ctx.getHeaders().putSingle("X-Correlation-ID", id);
        ctx.setProperty("correlationId", id);
    }
}
```

## 18.2 Response filter

```java
public void filter(ClientRequestContext req, ClientResponseContext res) {
    String downstreamId = res.getHeaderString("X-Correlation-ID");
    // record if different
}
```

## 18.3 Rule

Outbound calls should continue the trace/correlation chain.

---

# 19. Authentication Filter

## 19.1 Bearer token filter

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class BearerTokenClientFilter implements ClientRequestFilter {
    private final TokenProvider tokens;

    public BearerTokenClientFilter(TokenProvider tokens) {
        this.tokens = tokens;
    }

    @Override
    public void filter(ClientRequestContext ctx) {
        ctx.getHeaders().putSingle(
            HttpHeaders.AUTHORIZATION,
            "Bearer " + tokens.currentAccessToken()
        );
    }
}
```

## 19.2 API key filter

```java
ctx.getHeaders().putSingle("X-API-Key", apiKey.value());
```

## 19.3 mTLS

mTLS is configured at TLS/client connector layer, not request filter.

## 19.4 Rule

Authentication filters add credentials; they must be redaction-aware and lifecycle-aware.

---

# 20. Token Refresh and 401 Handling

A common temptation:

```text
ClientResponseFilter sees 401 → refresh token → repeat request
```

This is hard.

## 20.1 Problems

- request entity may not be repeatable;
- streaming upload cannot be replayed;
- multiple concurrent 401 can cause refresh storm;
- non-idempotent POST may duplicate;
- response filter may have no clean access to replay invocation;
- retry hidden in filter confuses metrics.

## 20.2 Better pattern

Token provider refreshes before request if token near expiry.

```java
String token = tokenProvider.validToken();
```

Use single-flight refresh:

```text
only one thread refreshes; others wait or use current valid token
```

## 20.3 If retry on 401 is needed

Implement in explicit client wrapper/resilience layer, not generic response filter, and only for replayable/idempotent operations.

## 20.4 Rule

Token refresh is stateful resilience logic; do not hide it casually inside response filters.

---

# 21. Request Signing Filter

Some partner APIs require HMAC signing.

## 21.1 Signature inputs

May include:

- method;
- path;
- query;
- selected headers;
- timestamp;
- nonce;
- body hash.

## 21.2 Request filter only enough if no body hash

If signature includes body hash, you need:

- precomputed body hash;
- or WriterInterceptor to hash bytes;
- or buffer request body, risky for large payload.

## 21.3 Timestamp/nonce

Prevent replay.

## 21.4 Rule

Signing must align with exact bytes/headers sent on wire.

---

# 22. Idempotency-Key Filter

Some POST calls should include idempotency key.

## 22.1 Bad global filter

Adding random idempotency key to every POST can break semantics.

## 22.2 Better operation-level

```java
request.header("Idempotency-Key", command.idempotencyKey());
```

or property-driven filter:

```java
ctx.getProperty("idempotencyKey")
```

## 22.3 Binding

Idempotency key should bind to operation and body hash on server side.

## 22.4 Rule

Idempotency is operation contract, not universal client decoration.

---

# 23. Conditional Request Filter

For update/delete, client may need `If-Match`.

## 23.1 Operation wrapper

```java
public CustomerResponse patch(CustomerId id, String etag, JsonObject patch) {
    try (Response response = target.path("customers/{id}")
        .resolveTemplate("id", id.value())
        .request(APPLICATION_JSON_TYPE)
        .header(HttpHeaders.IF_MATCH, etag)
        .method("PATCH", Entity.entity(patch, "application/merge-patch+json"))) {
        return decode(response, CustomerResponse.class);
    }
}
```

## 23.2 Filter?

A filter can add conditional headers if operation metadata is set as property, but this can obscure API semantics.

## 23.3 Rule

Put concurrency headers near operation code unless you have a strong abstraction.

---

# 24. User-Agent and Service Identity

Outbound services should identify themselves.

## 24.1 Header

```http
User-Agent: aceas-case-service/2.4.1
```

## 24.2 Custom service header

```http
X-Service-Name: case-service
```

## 24.3 Benefits

- downstream logs;
- rate-limit policy;
- support debugging;
- incident attribution.

## 24.4 Rule

Use stable service identity, not hostnames/random strings.

---

# 25. Safe Client Logging

## 25.1 Log semantic request

```text
client=cea-profile operation=getProfile method=GET route=/profiles/{id} status=200 duration=42ms
```

## 25.2 Avoid raw URL

Raw query may contain PII.

## 25.3 Avoid body

Request/response bodies may contain secrets/PII.

## 25.4 Header redaction

Always redact:

```text
Authorization
Cookie
Set-Cookie
X-API-Key
Proxy-Authorization
```

## 25.5 Rule

Make logs useful for operations but safe under incident disclosure.

---

# 26. Wire Logging vs Semantic Logging

## 26.1 Wire logging

Shows raw HTTP bytes/headers/body.

Useful for local debugging.

Dangerous in production.

## 26.2 Semantic logging

Shows:

- operation;
- method;
- route template;
- status;
- duration;
- error code;
- correlation.

## 26.3 Recommendation

Use semantic logging by default.

Enable redacted bounded wire logging only in controlled environments.

## 26.4 Rule

Production client logs should not be packet capture.

---

# 27. Metrics Filter

## 27.1 Request filter start

```java
ctx.setProperty("metrics.startedNanos", System.nanoTime());
```

## 27.2 Response filter record

```java
long elapsed = System.nanoTime() - (long) req.getProperty("metrics.startedNanos");
metrics.timer("http.client.duration", tags).record(elapsed, TimeUnit.NANOSECONDS);
```

## 27.3 Failure outside response filter

If DNS/connect timeout happens before response, response filter may not run.

Wrapper/resilience layer must record failures too.

## 27.4 Rule

Filters can record responses; wrappers must record transport failures.

---

# 28. Tracing Filter

## 28.1 Inject trace context

```java
ctx.getHeaders().putSingle("traceparent", currentTraceParent);
```

Use OpenTelemetry instrumentation when available.

## 28.2 Span naming

Use logical operation:

```text
GET /customers/{id}
CustomerClient.getCustomer
```

not full URI with IDs.

## 28.3 Response

Set status/error attributes.

## 28.4 Rule

Tracing should be route/operation based and redact sensitive attributes.

---

# 29. Retry Hooks

Retries are usually not part of JAX-RS core filters; implement in wrapper/resilience library.

## 29.1 Retryable conditions

- connection timeout;
- connection reset before response;
- DNS temporary failure;
- 503 with Retry-After;
- 429 with Retry-After;
- maybe 502/504 depending downstream.

## 29.2 Operation semantics

Retry only if:

- safe method;
- idempotent method;
- idempotency key exists;
- business operation supports replay.

## 29.3 Rule

Retry belongs to operation policy.

---

# 30. Why Retry Inside Filter Is Dangerous

## 30.1 Entity may not be repeatable

Streaming upload cannot be resent from consumed stream.

## 30.2 Hidden duplicate side effects

POST may already have succeeded but response lost.

## 30.3 Metrics distortion

One application call produces multiple network calls invisibly.

## 30.4 Trace confusion

Nested calls inside filter can break trace structure.

## 30.5 Rule

Do not implement generic automatic retry in `ClientResponseFilter`.

---

# 31. Circuit Breaker, Bulkhead, Timeout Integration

Use resilience layer around invocation.

## 31.1 Wrapper pattern

```java
public CustomerResponse getCustomer(CustomerId id) {
    return bulkhead.executeSupplier(() ->
        circuitBreaker.executeSupplier(() ->
            timeout.executeSupplier(() -> doGetCustomer(id))
        )
    );
}
```

## 31.2 Why wrapper?

It can handle:

- no response exceptions;
- response status mapping;
- retry policy;
- metrics;
- fallback;
- idempotency.

## 31.3 Filters complement wrappers

Filters add headers/tracing.

Wrappers decide resilience.

## 31.4 Rule

Separate cross-cutting metadata from operation-level resilience decisions.

---

# 32. Async Invocation with `async()`

`Invocation.Builder#async()` returns `AsyncInvoker`.

## 32.1 Example

```java
Future<Response> future = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .async()
    .get();
```

## 32.2 With type

```java
Future<CustomerResponse> future = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .async()
    .get(CustomerResponse.class);
```

## 32.3 With callback

```java
Future<CustomerResponse> future = target
    .request(APPLICATION_JSON_TYPE)
    .async()
    .get(new InvocationCallback<CustomerResponse>() {
        public void completed(CustomerResponse response) { ... }
        public void failed(Throwable throwable) { ... }
    });
```

## 32.4 Rule

Async invocation prevents blocking caller thread, but still needs timeout, cancellation, and executor management.

---

# 33. `Future<Response>` Pattern

## 33.1 Example

```java
Future<Response> future = target.request().async().get();

try (Response response = future.get(2, TimeUnit.SECONDS)) {
    return decode(response, CustomerResponse.class);
}
```

## 33.2 Problem

Calling `future.get()` blocks.

If you immediately block, you may not gain much over sync call except external timeout wrapper.

## 33.3 Cancellation

```java
future.cancel(true);
```

May attempt to cancel invocation; actual transport cancellation behavior is implementation-specific.

## 33.4 Rule

Use Future when you need explicit cancellation/wait composition; otherwise prefer CompletionStage style.

---

# 34. `InvocationCallback<T>` Pattern

## 34.1 Example

```java
request.async().get(new InvocationCallback<CustomerResponse>() {
    @Override
    public void completed(CustomerResponse response) {
        handle(response);
    }

    @Override
    public void failed(Throwable throwable) {
        handleFailure(throwable);
    }
});
```

## 34.2 Failure types

Failure may include:

- `ProcessingException`;
- `ResponseProcessingException`;
- `WebApplicationException` for non-success typed calls depending method semantics;
- provider exceptions.

## 34.3 Callback thread

Callback runs on client/runtime executor.

Do not block it heavily.

## 34.4 Rule

Callbacks should hand off heavy processing or use CompletionStage composition.

---

# 35. Async Error Semantics

For typed async calls:

```java
Future<CustomerResponse> f = request.async().get(CustomerResponse.class);
```

`Future.get()` may throw `ExecutionException` wrapping:

- `ProcessingException` for invocation processing failure;
- `WebApplicationException` or subclass for non-success HTTP status when response type is not `Response`;
- `ResponseProcessingException` when a received response fails during processing.

## 35.1 Safer pattern

Use `Future<Response>` if you want full HTTP status mapping.

```java
Future<Response> f = request.async().get();
```

Then decode yourself.

## 35.2 Rule

Typed async methods are concise but can obscure HTTP status mapping.

---

# 36. Executor Service for Async Client

`ClientBuilder` supports configuring executor services.

## 36.1 Example

```java
ExecutorService executor = Executors.newFixedThreadPool(32, namedFactory("jaxrs-client"));
ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(4);

Client client = ClientBuilder.newBuilder()
    .executorService(executor)
    .scheduledExecutorService(scheduler)
    .build();
```

## 36.2 Lifecycle

If you provide executors, you own shutdown unless runtime says otherwise.

## 36.3 Capacity

Async callbacks and invocations can saturate executors.

## 36.4 Rule

Async client needs explicit executor ownership and metrics.

---

# 37. Cancellation

## 37.1 Future cancel

```java
boolean cancelled = future.cancel(true);
```

## 37.2 CompletionStage cancellation

`CompletionStage` itself has no universal cancellation operation unless backed by `CompletableFuture` and implementation supports it.

## 37.3 Transport reality

Cancellation may not instantly close socket depending implementation.

## 37.4 Rule

Design cancellation as best-effort and verify on target client implementation.

---

# 38. Reactive Invocation with `rx()`

`Invocation.Builder#rx()` accesses reactive invoker.

## 38.1 CompletionStage default

JAX-RS defines a default reactive invoker based on `CompletionStage`.

```java
CompletionStage<CustomerResponse> stage = target
    .request(APPLICATION_JSON_TYPE)
    .rx()
    .get(CustomerResponse.class);
```

## 38.2 Benefits

- composition;
- non-blocking caller style;
- easier integration with async workflows.

## 38.3 Caution

HTTP IO may still use blocking connector internally.

`CompletionStage` API does not guarantee non-blocking network implementation.

## 38.4 Rule

Reactive invoker gives async composition model; runtime connector determines IO model.

---

# 39. `CompletionStageRxInvoker`

`CompletionStageRxInvoker` extends `RxInvoker<CompletionStage>`.

## 39.1 Example

```java
CompletionStage<Response> responseStage = target
    .request()
    .rx()
    .get();
```

## 39.2 Typed

```java
CompletionStage<CustomerResponse> customerStage = target
    .request(APPLICATION_JSON_TYPE)
    .rx()
    .get(CustomerResponse.class);
```

## 39.3 Error handling

```java
return customerStage
    .thenApply(this::validate)
    .exceptionally(ex -> fallbackOrThrow(ex));
```

## 39.4 Rule

Prefer `CompletionStage<Response>` when you need exact HTTP decoding; typed stage for simple success-only APIs.

---

# 40. Composition with CompletionStage

## 40.1 Parallel calls

```java
CompletionStage<CustomerResponse> customer = customerClient.get(id);
CompletionStage<List<OrderResponse>> orders = orderClient.list(id);

return customer.thenCombine(orders, CustomerPage::new);
```

## 40.2 Sequential calls

```java
return tokenStage.thenCompose(token ->
    target.request().header(AUTHORIZATION, "Bearer " + token).rx().get(Profile.class)
);
```

## 40.3 Handle errors

```java
stage.handle((value, error) -> {
    if (error != null) throw map(error);
    return value;
});
```

## 40.4 Rule

Composition is powerful; add deadlines and failure strategy.

---

# 41. Avoid Blocking in CompletionStage Chains

Bad:

```java
stage.thenApply(value -> otherFuture.get());
```

## 41.1 Why bad

It blocks async executor thread.

## 41.2 Better

```java
stage.thenCompose(value -> callOtherAsync(value));
```

## 41.3 CPU-heavy processing

Use dedicated executor:

```java
stage.thenApplyAsync(this::heavyTransform, cpuExecutor);
```

## 41.4 Rule

Do not turn async pipelines into hidden blocking pipelines.

---

# 42. SSE Client with `SseEventSource`

JAX-RS provides `SseEventSource` for reading incoming SSE.

## 42.1 Build

```java
WebTarget streamTarget = client.target(baseUri).path("events");

SseEventSource source = SseEventSource
    .target(streamTarget)
    .build();
```

## 42.2 Register consumers

```java
source.register(
    event -> handle(event),
    error -> log.error("sse error", error),
    () -> log.info("sse complete")
);
```

## 42.3 Open

```java
source.open();
```

## 42.4 Close

```java
source.close();
```

## 42.5 Rule

`SseEventSource` is a client-side long-lived resource; manage lifecycle explicitly.

---

# 43. SSE Client Lifecycle

## 43.1 States

```text
created
  ↓ open()
connected/processing
  ↓ reconnect on connection loss
closed
```

## 43.2 Thread safety

`SseEventSource` instances are thread safe according to API docs.

## 43.3 AutoCloseable

Use close on shutdown.

## 43.4 close with timeout

```java
source.close(5, TimeUnit.SECONDS);
```

## 43.5 Rule

Never create SSE source without a shutdown path.

---

# 44. SSE Consumers: onEvent, onError, onComplete

## 44.1 Register

```java
source.register(
    this::onEvent,
    this::onError,
    this::onComplete
);
```

## 44.2 Event handler

```java
void onEvent(InboundSseEvent event) {
    String name = event.getName();
    String id = event.getId();
    Notification payload = event.readData(Notification.class);
}
```

## 44.3 Handler exceptions

If an event consumer throws, the API docs note it is not considered an event source error condition; users should handle exceptions in their event processing logic.

## 44.4 Rule

Catch and handle exceptions inside event consumers.

---

# 45. SSE Reconnect Behavior

`SseEventSource` automatically reconnects when connection is lost.

## 45.1 Default reconnect delay

The API docs state default reconnect delay is 500 ms.

## 45.2 Server `retry` field

If server sends SSE `retry` field, `SseEventSource` tracks it and adjusts reconnect delay based on the last received retry value.

## 45.3 503 Retry-After

A 503 response with valid `Retry-After` tells client to reconnect later.

## 45.4 Rule

SSE client reconnect is automatic, but resume correctness still depends on event ID/replay semantics.

---

# 46. SSE Client Backpressure and Slow Consumer

If event handler is slow, event processing can lag.

## 46.1 Do not do heavy work inline

Bad:

```java
source.register(event -> expensiveDatabaseWrite(event));
```

## 46.2 Better

Hand off to bounded queue/executor.

```java
source.register(event -> {
    if (!queue.offer(toEnvelope(event))) {
        handleOverflow();
    }
});
```

## 46.3 Overflow policy

- drop;
- coalesce;
- disconnect/restart;
- persist to queue;
- resync.

## 46.4 Rule

SSE client is also a streaming consumer; define slow-consumer policy.

---

# 47. SSE Client Auth and Headers

`SseEventSource` is built from `WebTarget`, so client-level filters can add auth/correlation headers.

## 47.1 Example

```java
Client client = ClientBuilder.newBuilder()
    .register(new BearerTokenClientFilter(tokens))
    .register(CorrelationIdClientFilter.class)
    .build();

SseEventSource source = SseEventSource.target(
    client.target(baseUri).path("events")
).build();
```

## 47.2 Token expiry

Long-lived stream needs policy:

- server closes at expiry;
- client reconnects with fresh token;
- client rotates source;
- token provider refreshes before reconnect.

## 47.3 Rule

Long-lived client streams need auth lifetime strategy.

---

# 48. Streaming Download Client with Filters

Response filters must not buffer streaming download.

## 48.1 Operation code

```java
try (Response response = target.request().get()) {
    if (response.getStatus() != 200) throw decodeError(response);

    try (InputStream in = response.readEntity(InputStream.class)) {
        Files.copy(in, destination);
    }
}
```

## 48.2 Filter danger

A logging filter that reads entity stream breaks download.

## 48.3 Metrics

Measure bytes in operation code or ReaderInterceptor, not by buffering body.

## 48.4 Rule

Streaming operations need filter-safe design.

---

# 49. Multipart Upload Client Caveat

Client-side multipart support depends on Jakarta REST version/runtime.

## 49.1 Standard direction

Jakarta REST 4.0 includes standard multipart support around `EntityPart`, but exact convenience builders/runtime support should be verified.

## 49.2 Large file upload

Avoid building multipart in memory.

Use streaming multipart provider if runtime supports it.

## 49.3 Rule

Test multipart client behavior with large files on exact implementation.

---

# 50. Response Buffering Strategy

## 50.1 Small error bodies

Buffer to decode safely:

```java
response.bufferEntity();
ProblemDetails problem = response.readEntity(ProblemDetails.class);
```

## 50.2 Large success bodies

Do not buffer.

## 50.3 Filter-level buffering

Avoid global buffering.

## 50.4 Rule

Buffer by operation and size policy, not globally.

---

# 51. Exception Taxonomy

Outbound client wrapper should distinguish:

```text
DownstreamHttpException         → HTTP non-success response
DownstreamProblemException      → Problem Details decoded
DownstreamTimeoutException      → timeout
DownstreamConnectionException   → DNS/connect/reset
DownstreamResponseMappingException → response received but invalid schema
DownstreamCircuitOpenException  → local resilience abort
DownstreamCancelledException    → local cancellation
```

## 51.1 Why

Different recovery:

- retry;
- re-auth;
- user error;
- incident;
- fallback;
- alert.

## 51.2 Rule

Exception taxonomy is part of client API design.

---

# 52. Advanced Client Wrapper Architecture

## 52.1 Interface

```java
public interface CustomerDirectoryClient {
    CustomerProfile getProfile(CustomerId id);
    CompletionStage<CustomerProfile> getProfileAsync(CustomerId id);
}
```

## 52.2 Implementation

```java
public final class JaxRsCustomerDirectoryClient implements CustomerDirectoryClient {
    private final WebTarget base;
    private final ResponseDecoder decoder;
    private final ResiliencePolicy resilience;

    public CustomerProfile getProfile(CustomerId id) {
        return resilience.execute("getProfile", () -> {
            try (Response response = base.path("profiles/{id}")
                .resolveTemplate("id", id.value())
                .request(APPLICATION_JSON_TYPE)
                .get()) {
                return decoder.decode(response, CustomerProfile.class);
            }
        });
    }
}
```

## 52.3 Benefits

- business code not coupled to JAX-RS;
- error mapping centralized;
- metrics consistent;
- retry policy per operation;
- tests easier.

## 52.4 Rule

Do not spread raw JAX-RS client calls throughout domain code.

---

# 53. Testing Filters and Interceptors

## 53.1 Unit test filter

Use fake `ClientRequestContext`/`ClientResponseContext` or integration test.

## 53.2 Integration test

Mock server verifies headers:

- Authorization;
- X-Correlation-ID;
- User-Agent;
- Idempotency-Key.

## 53.3 Interceptor test

Verify bytes actually transformed:

- gzip request decompresses correctly server-side;
- checksum header matches body;
- reader interceptor validates digest.

## 53.4 Rule

Provider tests should prove wire behavior, not just method invocation.

---

# 54. Testing Async Client

## 54.1 Future success

Mock delayed response and assert future completes.

## 54.2 Future failure

Simulate timeout/connection reset.

## 54.3 Callback

Use latch:

```java
CountDownLatch latch = new CountDownLatch(1);
```

## 54.4 Cancellation

Cancel future and verify behavior where implementation supports it.

## 54.5 Rule

Async tests must be deterministic and timeout-bounded.

---

# 55. Testing SSE Client

## 55.1 Test server

Create SSE endpoint emitting:

- named event;
- id;
- retry;
- close;
- error status;
- heartbeat.

## 55.2 Client assertions

- onEvent called;
- payload decoded;
- reconnect happens;
- close releases resources;
- handler exception does not kill source unexpectedly;
- queue overflow policy works.

## 55.3 Rule

SSE client tests need lifecycle and reconnect cases, not only one event.

---

# 56. Runtime Differences

## 56.1 Common differences

- async executor behavior;
- connector/transport implementation;
- timeout properties beyond standard;
- retry/redirect behavior;
- SSE reconnect details;
- multipart support;
- JSON provider;
- entity stream buffering;
- cancellation semantics;
- TLS/proxy configuration.

## 56.2 Examples

- Jersey, RESTEasy, CXF, Liberty, Quarkus may expose different connector tuning properties.
- Some runtimes integrate better with CDI/MicroProfile.
- Some have extra reactive invokers.

## 56.3 Rule

Keep standard code portable, isolate implementation-specific tuning.

---

# 57. Common Failure Modes

## 57.1 Response filter consumes entity stream

Application cannot read body.

## 57.2 Global logging buffers large download

OOM.

## 57.3 Token refresh storm

Many threads refresh at once after 401.

## 57.4 Retry hidden inside response filter

Duplicate side effects.

## 57.5 Async future never cancelled

Leaked work.

## 57.6 Callback blocks executor

Async throughput collapse.

## 57.7 SSE source not closed

Thread/connection leak.

## 57.8 SSE event handler throws

Events lost or internal errors hidden.

## 57.9 Provider registered too globally

Wrong auth/signature applied to unrelated target.

## 57.10 Same priority providers with assumed order

Non-deterministic behavior.

## 57.11 Request signing before all headers finalized

Invalid signature.

## 57.12 Secret logged by wire logger

Security incident.

---

# 58. Best Practices

## 58.1 Keep filters small

Headers/metadata/instrumentation only.

## 58.2 Use interceptors for body stream transformations

Not filters.

## 58.3 Register providers at narrow scope

Client-wide only if universally correct.

## 58.4 Package provider sets as Features

For cohesive modules.

## 58.5 Use priorities deliberately

Especially auth/signing/logging.

## 58.6 Decode errors in wrapper

Not generic filters.

## 58.7 Retry outside filters

Operation-level policy.

## 58.8 Prefer CompletionStage for async composition

Avoid callback spaghetti.

## 58.9 Close SSE sources

Treat as long-lived resource.

## 58.10 Test streaming and async failure paths

Not just happy path.

---

# 59. Anti-Patterns

## 59.1 Business logic in client filter

Hard to test and reason.

## 59.2 Global auth filter for every downstream

Credentials sent to wrong service.

## 59.3 Reading response body in logging filter

Breaks body consumption.

## 59.4 `readAllBytes()` in response filter

OOM.

## 59.5 Retrying POST automatically

Duplicate effects.

## 59.6 Blocking inside CompletionStage callback

Thread starvation.

## 59.7 SSE used without reconnect/resync plan

Data loss.

## 59.8 Ignoring `send`/streaming failure semantics

Leaks and false success.

## 59.9 Provider registration order assumed without priority

Fragile.

## 59.10 Disabling TLS hostname verification

Critical vulnerability.

---

# 60. Production Checklist

## 60.1 Filters/interceptors

- [ ] Request filters registered intentionally.
- [ ] Response filters do not consume large entity streams.
- [ ] Interceptors call `proceed()`.
- [ ] Body-transforming interceptors update headers correctly.
- [ ] Priorities defined for auth/signing/logging.
- [ ] Provider scope is correct.
- [ ] Features package cohesive behavior only.

## 60.2 Security

- [ ] Auth filter target-specific.
- [ ] Tokens redacted in logs.
- [ ] Token refresh single-flight.
- [ ] Request signing covers final canonical request.
- [ ] No secret in metrics/traces.
- [ ] TLS hostname verification enabled.

## 60.3 Resilience

- [ ] Retry policy outside generic filters.
- [ ] Retry only safe/idempotent operations.
- [ ] Circuit breaker/bulkhead around wrapper.
- [ ] Timeout/deadline defined.
- [ ] Async executor configured.
- [ ] Cancellation strategy exists.

## 60.4 Async/SSE

- [ ] Async failure taxonomy tested.
- [ ] Callback does not block.
- [ ] `CompletionStage` chains do not block default executor.
- [ ] `SseEventSource` closed on shutdown.
- [ ] SSE event handlers catch exceptions.
- [ ] SSE reconnect/resync policy tested.
- [ ] SSE consumer backpressure defined.

## 60.5 Observability/testing

- [ ] Metrics include transport failures, not only HTTP responses.
- [ ] Tracing propagated.
- [ ] Logs are redacted and bounded.
- [ ] Mock server tests provider behavior.
- [ ] Streaming tests ensure no buffering.
- [ ] Runtime-specific behavior documented.

---

# 61. Latihan

## Latihan 1 — Correlation Feature

Buat `Feature` yang mendaftarkan:

- `CorrelationIdClientFilter`;
- metrics request/response filter;
- tracing filter.

Register ke `Client` dan assert mock server menerima `X-Correlation-ID`.

## Latihan 2 — Safe Logging Filter

Buat response/request logging filter yang hanya log:

- method;
- route operation;
- status;
- duration;
- redacted headers.

Pastikan `Authorization` tidak pernah muncul.

## Latihan 3 — Problem Details Wrapper

Implement wrapper yang:

- memakai `Response`;
- close response;
- decode `application/problem+json`;
- map 409/412/429/5xx ke exception berbeda.

## Latihan 4 — Gzip WriterInterceptor

Buat `WriterInterceptor` yang mengirim request entity gzip.

Test server menerima `Content-Encoding: gzip` dan body bisa didecompress.

## Latihan 5 — ReaderInterceptor Digest Verification

Server mengirim header checksum.

ReaderInterceptor menghitung hash response body dan reject jika mismatch.

## Latihan 6 — Async Future

Pakai `async().get()` terhadap mock endpoint delay.

Test success, timeout, dan cancellation.

## Latihan 7 — CompletionStage Composition

Panggil dua endpoint paralel:

- profile;
- orders.

Gabungkan dengan `thenCombine`.

Pastikan tidak blocking.

## Latihan 8 — SSE Client

Buat test SSE server yang mengirim 3 events.

Client memakai `SseEventSource`, register consumer, dan close setelah menerima semua.

## Latihan 9 — SSE Slow Consumer

Simulasikan event consumer lambat.

Tambahkan bounded queue dan overflow policy.

---

# 62. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `ClientRequestFilter` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/clientrequestfilter

2. Jakarta RESTful Web Services 4.0 — `ClientResponseFilter` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/clientresponsefilter

3. Jakarta RESTful Web Services 4.0 — `AsyncInvoker` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/asyncinvoker

4. Jakarta RESTful Web Services 4.0 — `CompletionStageRxInvoker` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/completionstagerxinvoker

5. Jakarta RESTful Web Services 4.0 — `SseEventSource` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/sse/sseeventsource

6. Jakarta RESTful Web Services 4.0 — `Configurable` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/configurable

7. Jakarta RESTful Web Services 4.0 — `WriterInterceptorContext` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/writerinterceptorcontext

8. Jakarta EE Tutorial — Accessing REST Resources with the Jakarta REST Client API  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest-client/rest-client.html

---

# 63. Penutup

Advanced JAX-RS Client API memberi extension pipeline yang sangat kuat.

Mental model final:

```text
ClientRequestFilter  → outbound request metadata before network
WriterInterceptor    → outbound request entity bytes
ClientResponseFilter → inbound response metadata after network
ReaderInterceptor    → inbound response entity bytes
Feature              → provider module registration
AsyncInvoker         → Future/callback async invocation
CompletionStageRxInvoker → CompletionStage reactive-style invocation
SseEventSource       → long-lived client for incoming SSE events
```

Prinsip final:

```text
Filters are not business logic.
Interceptors are not logging toys.
Retries are not universal.
Async is not free.
SSE clients are resources.
```

Top-tier JAX-RS engineer memastikan:

- provider scope tepat;
- auth/correlation/signing/logging ordering benar;
- response body tidak dikonsumsi filter sembarangan;
- retry/resilience ada di operation wrapper;
- error taxonomy jelas;
- async executor dan cancellation dipikirkan;
- CompletionStage chain tidak blocking;
- SSE client punya lifecycle, reconnect, backpressure, dan close;
- observability menangkap response dan transport failure;
- semua extension diuji dengan mock server/runtime nyata.

Part berikutnya:

```text
Bagian 030 — Client Resilience: Timeout, Retry, Circuit Breaker, Bulkhead, Idempotency
```

Kita akan membahas outbound resilience secara mendalam: timeout budget, deadline propagation, retry policy, exponential backoff, jitter, circuit breaker, bulkhead, rate limit, idempotency key, fallback, and failure taxonomy.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-jaxrs-advanced-part-028.md">⬅️ Bagian 028 — JAX-RS Client API: Mental Model and Core Usage: `Client`, `ClientBuilder`, `WebTarget`, `Invocation.Builder`, `Entity`, `Response`, Headers, Cookies, Timeouts, Providers, and Safe Resource Management</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-jaxrs-advanced-part-030.md">Bagian 030 — Client Resilience: Timeout, Retry, Circuit Breaker, Bulkhead, Rate Limit, Idempotency, Deadline Budget, Fallback, and Production-Grade Outbound HTTP Policy ➡️</a>
</div>
