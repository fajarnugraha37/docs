# learn-jaxrs-advanced-part-048.md

# Bagian 048 — Advanced HTTP Client and Service-to-Service Communication: Client Lifecycle, Connection Pools, DNS, TLS/mTLS, Auth Token Propagation, Timeout Budget, Retry, Circuit Breaker, Request Signing, Idempotency, Schema Compatibility, and Safe Downstream Consumption

> Target pembaca: Java/Jakarta engineer yang ingin membangun **service-to-service HTTP communication** yang aman, stabil, observable, dan scalable dengan Jakarta REST/JAX-RS Client API atau MicroProfile Rest Client. Fokus bagian ini bukan hanya “panggil API pakai `ClientBuilder`”, tetapi seluruh outbound communication contract: client lifecycle, pool, DNS, TLS/mTLS, auth propagation, timeout budget, retry, circuit breaker, bulkhead, rate limit, idempotency, request signing, schema compatibility, error mapping, streaming, observability, dan safe downstream consumption.
>
> Prinsip utama:
>
> ```text
> Outbound HTTP is a production dependency boundary.
> Treat every downstream call as unreliable, slow, versioned, security-sensitive, and observable.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Service-to-Service Call adalah Distributed System Boundary](#2-mental-model-service-to-service-call-adalah-distributed-system-boundary)
3. [JAX-RS Client API vs MicroProfile Rest Client](#3-jax-rs-client-api-vs-microprofile-rest-client)
4. [Client Lifecycle](#4-client-lifecycle)
5. [ClientBuilder Configuration](#5-clientbuilder-configuration)
6. [WebTarget and Invocation Design](#6-webtarget-and-invocation-design)
7. [Connection Pooling](#7-connection-pooling)
8. [DNS and Service Discovery](#8-dns-and-service-discovery)
9. [Load Balancing Client-Side vs Platform-Side](#9-load-balancing-client-side-vs-platform-side)
10. [TLS and Trust](#10-tls-and-trust)
11. [mTLS for Service Identity](#11-mtls-for-service-identity)
12. [Authentication Propagation](#12-authentication-propagation)
13. [Token Relay vs Token Exchange vs Service Token](#13-token-relay-vs-token-exchange-vs-service-token)
14. [Authorization Across Services](#14-authorization-across-services)
15. [Tenant and Actor Propagation](#15-tenant-and-actor-propagation)
16. [Request Signing](#16-request-signing)
17. [Correlation ID and Trace Propagation](#17-correlation-id-and-trace-propagation)
18. [Timeout Budget](#18-timeout-budget)
19. [Connect Timeout, Read Timeout, Request Deadline](#19-connect-timeout-read-timeout-request-deadline)
20. [Retry Policy](#20-retry-policy)
21. [Retry and HTTP Method Semantics](#21-retry-and-http-method-semantics)
22. [Idempotency Keys](#22-idempotency-keys)
23. [Retry-After and Backoff](#23-retry-after-and-backoff)
24. [Circuit Breaker](#24-circuit-breaker)
25. [Bulkhead](#25-bulkhead)
26. [Rate Limiting and Client-Side Throttling](#26-rate-limiting-and-client-side-throttling)
27. [Fallback](#27-fallback)
28. [Hedging and Request Racing](#28-hedging-and-request-racing)
29. [Safe Error Mapping](#29-safe-error-mapping)
30. [Problem Details Decoder](#30-problem-details-decoder)
31. [Response Resource Management](#31-response-resource-management)
32. [Streaming Download](#32-streaming-download)
33. [Upload and Multipart Client](#33-upload-and-multipart-client)
34. [SSE and Long-Lived Client Connections](#34-sse-and-long-lived-client-connections)
35. [Schema Compatibility](#35-schema-compatibility)
36. [DTO Boundary and Anti-Corruption Layer](#36-dto-boundary-and-anti-corruption-layer)
37. [Versioning Downstream APIs](#37-versioning-downstream-apis)
38. [MicroProfile Rest Client Typed Interfaces](#38-microprofile-rest-client-typed-interfaces)
39. [MicroProfile Fault Tolerance Integration](#39-microprofile-fault-tolerance-integration)
40. [Filters and Interceptors](#40-filters-and-interceptors)
41. [Observability](#41-observability)
42. [Testing Strategy](#42-testing-strategy)
43. [Mock Server and Fault Injection](#43-mock-server-and-fault-injection)
44. [Service-to-Service Security Checklist](#44-service-to-service-security-checklist)
45. [Common Failure Modes](#45-common-failure-modes)
46. [Best Practices](#46-best-practices)
47. [Anti-Patterns](#47-anti-patterns)
48. [Production Checklist](#48-production-checklist)
49. [Latihan](#49-latihan)
50. [Referensi Resmi](#50-referensi-resmi)
51. [Penutup](#51-penutup)

---

# 1. Tujuan Part Ini

Service-to-service HTTP terlihat sederhana:

```java
CustomerResponse response = client.target(customerApi)
    .path("/customers/{id}")
    .resolveTemplate("id", customerId)
    .request(MediaType.APPLICATION_JSON_TYPE)
    .get(CustomerResponse.class);
```

Tetapi di production, call ini punya banyak risiko:

```text
DNS lambat/salah
TLS trust salah
connection pool habis
timeout terlalu panjang
retry menggandakan side effect
POST tidak idempotent
token relay berlebihan
tenant header spoofing
downstream schema berubah
Problem Details tidak diparse
Response tidak ditutup
trace context tidak dipropagate
circuit breaker tidak ada
fallback salah secara domain
downstream p99 merusak p99 service kita
```

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- mendesain outbound gateway/client wrapper yang aman;
- mengatur lifecycle `Client`;
- memahami pool, DNS, TLS, auth, timeout, retry;
- memilih JAX-RS Client API atau MicroProfile Rest Client;
- menerapkan resilience policy tanpa merusak semantics;
- menjaga idempotency untuk write calls;
- mengamankan token/tenant propagation;
- memetakan error downstream ke domain;
- menguji dengan mock server/fault injection;
- mengobservasi dependency latency dan failure.

---

# 2. Mental Model: Service-to-Service Call adalah Distributed System Boundary

Setiap outbound HTTP call melintasi boundary:

```text
your service
  ↓ network
downstream service
  ↓ downstream DB/dependencies
```

Boundary ini tidak reliable.

Kemungkinan failure:

- connection refused;
- DNS failure;
- TLS failure;
- timeout;
- 429 rate limit;
- 5xx;
- malformed JSON;
- incompatible schema;
- partial response;
- slow p99;
- duplicate request after retry;
- stale data;
- security rejection.

## 2.1 Rule

Design every downstream call as if it can fail, hang, lie, change, or duplicate.

---

# 3. JAX-RS Client API vs MicroProfile Rest Client

## 3.1 JAX-RS Client API

Programmatic, flexible:

```java
Client client = ClientBuilder.newBuilder()
    .connectTimeout(1, TimeUnit.SECONDS)
    .readTimeout(2, TimeUnit.SECONDS)
    .build();

Response response = client.target(baseUri)
    .path("customers/{id}")
    .resolveTemplate("id", id)
    .request(MediaType.APPLICATION_JSON_TYPE)
    .get();
```

Good for:

- dynamic endpoints;
- streaming;
- custom request building;
- generic integration layer;
- low-level response control.

## 3.2 MicroProfile Rest Client

Typed interface:

```java
@Path("/customers")
@RegisterRestClient(configKey = "customer-api")
public interface CustomerClient {
    @GET
    @Path("/{id}")
    CustomerResponse get(@PathParam("id") String id);
}
```

Good for:

- declarative clients;
- CDI integration;
- config-driven base URL;
- typed service-to-service calls;
- integration with MicroProfile Fault Tolerance.

## 3.3 Rule

Use typed client for stable service contracts; use JAX-RS Client for dynamic/low-level/streaming needs.

---

# 4. Client Lifecycle

`Client` is expensive and should be reused.

## 4.1 Bad

```java
public Customer get(String id) {
    Client client = ClientBuilder.newClient();
    return client.target(baseUrl).path(id).request().get(Customer.class);
}
```

Creates connection resources repeatedly.

## 4.2 Good

```java
@ApplicationScoped
public class CustomerGateway implements AutoCloseable {

    private final Client client;
    private final WebTarget target;

    public CustomerGateway(CustomerApiConfig config) {
        this.client = ClientBuilder.newBuilder()
            .connectTimeout(config.connectTimeout())
            .readTimeout(config.readTimeout())
            .build();

        this.target = client.target(config.baseUri()).path("customers");
    }

    @Override
    public void close() {
        client.close();
    }
}
```

## 4.3 Rule

Create one configured client per downstream/policy, reuse it, close it at application shutdown.

---

# 5. ClientBuilder Configuration

Standard Jakarta REST `ClientBuilder` includes timeout methods:

```java
connectTimeout(long timeout, TimeUnit unit)
readTimeout(long timeout, TimeUnit unit)
```

It also supports:

- SSL context;
- hostname verifier;
- executor service;
- scheduled executor service;
- provider registration;
- properties.

## 5.1 Provider registration

Register:

- JSON provider;
- auth filter;
- correlation filter;
- logging filter;
- Problem Details decoder if filter/mapper style;
- metrics/tracing features.

## 5.2 Rule

Centralize client builder configuration; never scatter ad hoc client creation.

---

# 6. WebTarget and Invocation Design

`WebTarget` is immutable-ish builder style.

## 6.1 Base target per downstream

```java
WebTarget customers = client.target(baseUri).path("customers");
```

## 6.2 Per call

```java
customers.path("{id}")
    .resolveTemplate("id", id)
    .queryParam("include", "profile")
    .request(MediaType.APPLICATION_JSON_TYPE)
    .get(CustomerResponse.class);
```

## 6.3 Rule

Keep path/query building close to gateway method and test it with mock server.

---

# 7. Connection Pooling

Connection pooling is usually implementation/connector-specific.

## 7.1 Important settings

- max total connections;
- max per route;
- connection acquisition timeout;
- idle timeout;
- max lifetime;
- keep-alive;
- TLS session reuse;
- HTTP/2 multiplexing if supported.

## 7.2 Symptoms of bad pool

- high latency but downstream fast;
- threads waiting for connection;
- connection reset due idle stale connection;
- too many TCP handshakes;
- ephemeral port exhaustion.

## 7.3 Rule

Client pool must be tuned per downstream traffic profile.

---

# 8. DNS and Service Discovery

DNS affects service-to-service reliability.

## 8.1 Risks

- stale DNS cache;
- JVM DNS TTL too long/short;
- service IP rotation;
- Kubernetes service behavior;
- cloud LB DNS changes.

## 8.2 Strategies

- use platform service discovery;
- configure JVM DNS TTL intentionally;
- rely on stable service DNS/LB;
- test failover;
- avoid hardcoding IPs.

## 8.3 Rule

DNS behavior is part of client resilience.

---

# 9. Load Balancing Client-Side vs Platform-Side

## 9.1 Platform-side

Client calls stable DNS/LB/service mesh.

Simpler app.

## 9.2 Client-side

Client chooses instance.

More control but more complexity.

## 9.3 Service mesh

Mesh handles LB, retries, mTLS, telemetry outside app.

App still needs timeouts and domain error handling.

## 9.4 Rule

Do not duplicate LB/retry logic blindly across app and mesh/gateway.

---

# 10. TLS and Trust

Outbound TLS must validate server identity.

## 10.1 Requirements

- trusted CA/truststore;
- hostname verification;
- no `trustAll`;
- no disabled hostname verifier;
- certificate rotation plan.

## 10.2 Internal services

Internal does not mean plaintext by default.

Use TLS/mTLS depending threat model.

## 10.3 Rule

Never disable TLS verification to “fix” integration.

---

# 11. mTLS for Service Identity

mTLS provides mutual certificate authentication.

## 11.1 Useful for

- service-to-service;
- high-trust internal APIs;
- partner connections;
- zero-trust network.

## 11.2 App-level authorization still needed

mTLS says workload/client identity, not domain permission.

## 11.3 Rule

mTLS authenticates the caller/service; application still authorizes the operation.

---

# 12. Authentication Propagation

Outbound call may need identity.

Options:

- service token;
- token relay;
- token exchange;
- mTLS identity;
- API key;
- signed request.

## 12.1 Do not blindly propagate

Forwarding user token everywhere can:

- overexpose privileges;
- leak token to service that should not have it;
- confuse audience claims;
- fail due wrong audience.

## 12.2 Rule

Propagate only identity required by downstream contract.

---

# 13. Token Relay vs Token Exchange vs Service Token

## 13.1 Token relay

Forward incoming user token.

Good when downstream expects same user token and audience allows it.

Risky if token audience not intended.

## 13.2 Token exchange

Exchange user token for downstream-specific token.

Better for least privilege.

## 13.3 Service token

Service calls as itself.

Good for system operations.

Need pass actor context separately if required for audit.

## 13.4 Rule

Choose token strategy based on trust, audience, least privilege, and audit needs.

---

# 14. Authorization Across Services

Downstream must not assume upstream authorization is enough unless contract says so.

## 14.1 Defense-in-depth

Downstream validates:

- caller service;
- user/actor/tenant if needed;
- scopes/permissions;
- object-level authorization if owns object.

## 14.2 Rule

A service owning data owns final authorization for that data.

---

# 15. Tenant and Actor Propagation

Headers may include:

```http
X-Tenant-ID
X-Actor-ID
X-Correlation-ID
```

## 15.1 Requirements

- only between trusted services;
- signed or protected by mTLS/internal auth;
- never accept spoofed external headers;
- document semantics.

## 15.2 Better

Use signed internal token containing tenant/actor context.

## 15.3 Rule

Tenant/actor propagation is security-sensitive.

---

# 16. Request Signing

Request signing protects integrity and authenticity.

## 16.1 Use cases

- partner APIs;
- webhooks;
- high-security internal calls;
- non-repudiation-ish audit;
- replay prevention.

## 16.2 Include

- method;
- path;
- query;
- selected headers;
- body hash;
- timestamp;
- nonce/idempotency key.

## 16.3 Verify

Receiver checks signature, timestamp skew, nonce replay.

## 16.4 Rule

Request signing is not substitute for TLS; it complements it.

---

# 17. Correlation ID and Trace Propagation

Outbound client must propagate:

```http
X-Correlation-ID
traceparent
tracestate
```

## 17.1 JAX-RS ClientRequestFilter

```java
@Provider
public class CorrelationClientFilter implements ClientRequestFilter {
    @Override
    public void filter(ClientRequestContext ctx) {
        ctx.getHeaders().putSingle("X-Correlation-ID", Correlation.currentOrNew());
    }
}
```

## 17.2 Rule

Every outbound call should be joinable to inbound request trace/logs.

---

# 18. Timeout Budget

Timeouts should fit request deadline.

## 18.1 Example

Inbound SLO: 500ms.

Budget:

```text
app work: 100ms
customer API: 150ms
payment API: 150ms
buffer: 100ms
```

## 18.2 Bad

Downstream read timeout 5s inside endpoint with 500ms SLO.

## 18.3 Rule

Timeouts must be derived from operation deadline, not copied from defaults.

---

# 19. Connect Timeout, Read Timeout, Request Deadline

## 19.1 Connect timeout

Time to establish connection.

## 19.2 Read timeout

Time waiting for response data.

## 19.3 Request deadline

Total allowed time for operation.

JAX-RS standard has connect/read timeout, but total deadline often needs wrapper/resilience library.

## 19.4 Rule

Connect/read timeout alone may not enforce total operation budget.

---

# 20. Retry Policy

Retry can improve transient failure.

It can also amplify outage.

## 20.1 Retry when

- connection reset before request processed;
- timeout on idempotent safe operation;
- 503 temporary;
- 429 with Retry-After;
- known transient dependency failure.

## 20.2 Do not retry when

- validation failure;
- authorization failure;
- non-idempotent POST without key;
- permanent domain error;
- downstream says no.

## 20.3 Rule

Retry only if operation is safe to repeat or made safe with idempotency.

---

# 21. Retry and HTTP Method Semantics

RFC 9110 says clients should not automatically retry non-idempotent methods unless they know request semantics are actually idempotent or can detect original request was never applied.

## 21.1 Safe defaults

- GET: usually retryable.
- HEAD: retryable.
- PUT: retryable if semantics properly idempotent.
- DELETE: retryable in effect, but check API behavior.
- POST: not retryable by default.

## 21.2 Rule

Retry policy must understand HTTP method and domain semantics.

---

# 22. Idempotency Keys

For POST/commands with side effects:

```http
Idempotency-Key: 01J...
```

## 22.1 Client responsibility

Use same key for retry of same logical operation.

## 22.2 Server responsibility

Store key, request hash, and result.

## 22.3 Outbound client

If your service calls downstream POST, propagate or generate downstream idempotency key according to contract.

## 22.4 Rule

Idempotency keys turn unsafe retries into controlled retries.

---

# 23. Retry-After and Backoff

## 23.1 Retry-After

Downstream may return:

```http
Retry-After: 60
```

## 23.2 Backoff

Use exponential backoff with jitter.

## 23.3 Deadline

Do not retry if retry delay exceeds remaining deadline.

## 23.4 Rule

Respect downstream overload signals.

---

# 24. Circuit Breaker

Circuit breaker prevents repeated calls to failing downstream.

## 24.1 States

- closed;
- open;
- half-open.

## 24.2 Metrics

- failure rate;
- slow call rate;
- open state;
- rejected calls.

## 24.3 Scope

Usually per downstream operation.

## 24.4 Rule

Circuit breaker protects your service and downstream from cascading failure.

---

# 25. Bulkhead

Bulkhead isolates resource usage.

## 25.1 Types

- thread pool bulkhead;
- semaphore bulkhead;
- connection pool limit;
- queue limit.

## 25.2 Example

Payment API slow should not consume all threads needed for customer API.

## 25.3 Rule

Bulkheads prevent one dependency from starving the whole service.

---

# 26. Rate Limiting and Client-Side Throttling

Client may throttle outbound calls to respect downstream quota.

## 26.1 Use cases

- partner API quota;
- expensive downstream;
- API key limits;
- batch jobs.

## 26.2 Rule

If downstream has quota, enforce it before hitting the quota wall.

---

# 27. Fallback

Fallback must be semantically safe.

## 27.1 Safe fallback

- cached reference data;
- stale read with marker;
- default feature flag off;
- queue for later.

## 27.2 Dangerous fallback

- “assume payment success”;
- “assume authorization allowed”;
- fake identity;
- silently ignore failed write.

## 27.3 Rule

Fallback should preserve correctness and security.

---

# 28. Hedging and Request Racing

Hedging sends duplicate request after delay to reduce tail latency.

## 28.1 Use carefully

Only for safe/idempotent reads.

## 28.2 Cost

Increases load.

## 28.3 Rule

Do not hedge writes or expensive operations casually.

---

# 29. Safe Error Mapping

Downstream errors should be mapped.

## 29.1 Example

Payment provider timeout:

```text
PaymentProviderTimeoutException
```

API response:

```text
503 PAYMENT_PROVIDER_UNAVAILABLE
```

or domain-specific pending state.

## 29.2 Avoid

Exposing raw downstream error body.

## 29.3 Rule

Downstream error mapping is part of anti-corruption layer.

---

# 30. Problem Details Decoder

If downstream uses Problem Details, parse it.

## 30.1 Decoder

```java
public DownstreamException decode(Response response) {
    if (response.getMediaType().isCompatible(PROBLEM_JSON)) {
        ProblemDetails problem = response.readEntity(ProblemDetails.class);
        return map(problem);
    }
    return generic(response.getStatus());
}
```

## 30.2 Must handle malformed body

Downstream may return HTML/text.

## 30.3 Rule

Problem decoder must be robust to non-problem responses.

---

# 31. Response Resource Management

If using `Response`, close it.

## 31.1 Good

```java
try (Response response = target.request().get()) {
    return decode(response);
}
```

## 31.2 Streaming caveat

Keep response open while stream is consumed.

## 31.3 Rule

Unclosed responses leak connections.

---

# 32. Streaming Download

For large downstream responses:

```java
try (Response response = target.request().get();
     InputStream in = response.readEntity(InputStream.class)) {
    // stream to file/output
}
```

## 32.1 Watch

- response close;
- timeout;
- checksum;
- partial failure;
- retry/resume;
- max size.

## 32.2 Rule

Never read huge downstream response into memory casually.

---

# 33. Upload and Multipart Client

Upload concerns:

- streaming file;
- content type;
- retries unsafe unless idempotent;
- timeout;
- backpressure;
- partial upload failure;
- max size.

## 33.1 Rule

Large upload client calls need explicit retry/idempotency and resource policy.

---

# 34. SSE and Long-Lived Client Connections

SSE client:

- long-lived connection;
- reconnect;
- heartbeat;
- auth token expiry;
- backpressure;
- close lifecycle.

## 34.1 Rule

Long-lived client connections need lifecycle management and dedicated pool/bulkhead.

---

# 35. Schema Compatibility

Downstream schema may change.

## 35.1 Client should tolerate

- unknown response fields;
- additional enum values if strategy exists;
- optional fields missing if contract allows.

## 35.2 Client should reject

- required fields missing;
- incompatible type;
- invalid date/time;
- malformed response.

## 35.3 Rule

Outbound DTOs should be versioned contract objects, not domain entities.

---

# 36. DTO Boundary and Anti-Corruption Layer

Do not let downstream DTO pollute domain.

## 36.1 Pattern

```text
Downstream DTO → Gateway Mapper → Domain Value/Object
```

## 36.2 Benefits

- isolates schema changes;
- maps downstream errors;
- enforces invariants;
- improves tests.

## 36.3 Rule

Every downstream integration deserves an anti-corruption layer.

---

# 37. Versioning Downstream APIs

## 37.1 Pin version

Use path/media/header version according to downstream contract.

## 37.2 Monitor deprecation

Track `Deprecation`/`Sunset` headers if provided.

## 37.3 Rule

Downstream API version is operational dependency.

---

# 38. MicroProfile Rest Client Typed Interfaces

MicroProfile Rest Client defines type-safe HTTP client interfaces using Jakarta REST-style annotations.

## 38.1 Example

```java
@Path("/customers")
@RegisterRestClient(configKey = "customer-api")
public interface CustomerApiClient {

    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    CustomerDto get(@PathParam("id") String id);
}
```

## 38.2 Good for

- stable endpoints;
- CDI injection;
- declarative config;
- code readability;
- MP Fault Tolerance annotations.

## 38.3 Rule

Typed clients are excellent when the downstream contract is stable and known.

---

# 39. MicroProfile Fault Tolerance Integration

MicroProfile Fault Tolerance provides annotations for strategies such as:

- retry;
- timeout;
- fallback;
- circuit breaker;
- bulkhead.

## 39.1 Example

```java
@Timeout(500)
@Retry(maxRetries = 2, delay = 100, jitter = 50)
@CircuitBreaker(requestVolumeThreshold = 20, failureRatio = 0.5)
public CustomerDto getCustomer(String id) { ... }
```

## 39.2 Caveat

Annotations are easy to overuse.

Need idempotency and domain safety.

## 39.3 Rule

Fault tolerance policy must match HTTP/domain semantics.

---

# 40. Filters and Interceptors

Client filters/interceptors can implement:

- auth header;
- correlation ID;
- trace propagation;
- request signing;
- idempotency key;
- logging;
- metrics;
- body hash.

## 40.1 Rule

Cross-cutting outbound behavior belongs in client filters/features, but business semantics belong in gateway/service method.

---

# 41. Observability

For every downstream operation, record:

- service;
- operation;
- method;
- status;
- duration;
- timeout;
- retry count;
- circuit state;
- failure classification;
- request size;
- response size if safe;
- correlation/trace.

## 41.1 Metrics

```text
downstream.request.duration{service,operation,status}
downstream.retry.total{service,operation,reason}
downstream.timeout.total{service,operation}
downstream.circuit.open{service,operation}
```

## 41.2 Rule

If a dependency can break you, it must have dashboard and alert.

---

# 42. Testing Strategy

## 42.1 Unit

- error decoder;
- retry classifier;
- idempotency key generator;
- DTO mapper;
- request signing canonicalization.

## 42.2 Mock server integration

- request shape;
- headers;
- body;
- response mapping;
- timeout;
- retry attempts;
- malformed JSON;
- Problem Details.

## 42.3 Contract

- OpenAPI/consumer-driven contract;
- generated client compatibility;
- schema examples.

## 42.4 Rule

Test the HTTP boundary with mock server, not only mocked client interfaces.

---

# 43. Mock Server and Fault Injection

Use WireMock/MockWebServer or equivalent.

Test matrix:

```text
200 valid
200 malformed JSON
204 no content
400 problem
401/403
404
409
429 Retry-After
500
503
read timeout
connection reset
slow body
large body
```

## 43.1 Rule

Outbound client is not production-ready until failure matrix is tested.

---

# 44. Service-to-Service Security Checklist

- TLS validation on;
- mTLS if required;
- correct token audience;
- no blind token relay;
- tenant/actor propagation trusted;
- signed requests if required;
- no secrets in logs;
- outbound URL allowlist for dynamic URLs;
- timeout and size limits;
- Problem Details safe mapping.

## 44.1 Rule

Internal traffic is still security-sensitive.

---

# 45. Common Failure Modes

## 45.1 Per-request Client

Connection leak/performance issue.

## 45.2 No timeout

Thread exhaustion.

## 45.3 Retry POST without idempotency

Duplicate side effect.

## 45.4 Token relay wrong audience

Security failure.

## 45.5 Trust all TLS

MITM risk.

## 45.6 Response not closed

Pool exhaustion.

## 45.7 No Problem decoder

Generic/unhelpful errors.

## 45.8 Downstream DTO used as domain

Tight coupling.

## 45.9 Circuit breaker too broad

One operation failure blocks all operations.

## 45.10 No observability

Dependency incidents hard to debug.

---

# 46. Best Practices

## 46.1 Wrap downstream in gateway

Business code depends on interface.

## 46.2 Reuse Client

One per downstream policy.

## 46.3 Configure timeouts

No infinite wait.

## 46.4 Tune pools

Per downstream.

## 46.5 Use idempotency

For retryable writes.

## 46.6 Decode Problem Details

Map safely.

## 46.7 Propagate trace/correlation

Always.

## 46.8 Avoid blind token relay

Use token exchange/service token.

## 46.9 Test with mock server

Request verification + faults.

## 46.10 Monitor dependency health

Dashboard/alerts.

---

# 47. Anti-Patterns

## 47.1 `ClientBuilder.newClient()` inside every method

Bad.

## 47.2 Timeout copied from another service

No budget thinking.

## 47.3 Retry everything

Danger.

## 47.4 Fallback returns fake success

Correctness bug.

## 47.5 Disabled hostname verification

Security bug.

## 47.6 Raw downstream error returned to caller

Leak/coupling.

## 47.7 Service mesh retry plus app retry plus gateway retry

Retry storm.

## 47.8 Dynamic user URL with no allowlist

SSRF.

## 47.9 No version pinning

Unexpected downstream change.

## 47.10 No contract tests

Compatibility blind spot.

---

# 48. Production Checklist

## 48.1 Client lifecycle

- [ ] Client reused.
- [ ] Client closed at shutdown.
- [ ] Providers registered centrally.
- [ ] JSON provider explicit.
- [ ] Connection pool configured.
- [ ] DNS behavior understood.

## 48.2 Security

- [ ] TLS validation enabled.
- [ ] mTLS if required.
- [ ] Token strategy defined.
- [ ] Tenant/actor propagation safe.
- [ ] No secret logging.
- [ ] Request signing if needed.
- [ ] URL allowlist for dynamic calls.

## 48.3 Resilience

- [ ] Connect/read timeout.
- [ ] Total deadline/budget.
- [ ] Retry policy method-aware.
- [ ] Idempotency key for writes.
- [ ] Circuit breaker scoped.
- [ ] Bulkhead/rate limit.
- [ ] Fallback reviewed for correctness.
- [ ] Retry storm avoided across mesh/gateway/app.

## 48.4 Contract

- [ ] DTO boundary.
- [ ] Problem decoder.
- [ ] Schema compatibility tests.
- [ ] OpenAPI/consumer contract.
- [ ] Version/deprecation tracked.
- [ ] Unknown fields strategy.

## 48.5 Observability/testing

- [ ] Metrics by downstream/operation.
- [ ] Tracing propagated.
- [ ] Logs include correlation ID.
- [ ] Mock server tests.
- [ ] Fault injection matrix.
- [ ] Performance/load impact tested.

---

# 49. Latihan

## Latihan 1 — Client Lifecycle Refactor

Refactor code yang membuat `Client` per request menjadi `@ApplicationScoped` gateway.

Tambahkan shutdown close.

## Latihan 2 — Mock Server Request Verification

Gunakan WireMock/MockWebServer.

Verify:

- method;
- path;
- query;
- Authorization;
- X-Correlation-ID;
- body.

## Latihan 3 — Timeout Budget

Endpoint SLO 800ms.

Downstream A dan B dipanggil.

Buat budget dan set timeout.

## Latihan 4 — Retry Safety

Buat policy:

- GET retry 2x;
- POST retry only with idempotency key;
- 400/403 no retry;
- 503 retry with backoff.

Test attempt count.

## Latihan 5 — Problem Decoder

Mock downstream returns `application/problem+json`.

Map to domain exception.

Mock HTML 500 and malformed JSON.

## Latihan 6 — Token Strategy

Untuk three service calls, tentukan:

- token relay;
- token exchange;
- service token.

Jelaskan alasan.

## Latihan 7 — Circuit Breaker

Simulate 50% failure rate.

Verify breaker opens and prevents calls.

## Latihan 8 — Schema Compatibility

Add unknown field to downstream response.

Ensure client tolerates it.

Remove required field.

Ensure client fails safely.

---

# 50. Referensi Resmi

Referensi utama:

1. Jakarta EE Tutorial — Accessing REST Resources with the Jakarta REST Client API  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest-client/rest-client.html

2. Jakarta RESTful Web Services 4.0 — Client API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/package-summary

3. Jakarta RESTful Web Services 4.0 — `ClientBuilder` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/clientbuilder

4. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

5. MicroProfile Rest Client 4.0  
   https://microprofile.io/specifications/rest-client/4-0/

6. MicroProfile Rest Client 4.0 Specification  
   https://download.eclipse.org/microprofile/microprofile-rest-client-4.0/microprofile-rest-client-spec-4.0.html

7. MicroProfile Fault Tolerance  
   https://microprofile.io/specifications/microprofile-fault-tolerance/

8. MicroProfile Fault Tolerance 4.0 Specification  
   https://download.eclipse.org/microprofile/microprofile-fault-tolerance-4.0/microprofile-fault-tolerance-spec-4.0.html

---

# 51. Penutup

Advanced service-to-service HTTP bukan sekadar “client call”.

Mental model final:

```text
typed/domain gateway
  ↓
configured reusable client
  ↓
security context/token strategy
  ↓
timeout budget
  ↓
resilience policy
  ↓
HTTP request
  ↓
downstream contract
  ↓
safe decoding/error mapping
  ↓
observability
```

Prinsip final:

```text
Reuse clients.
Tune pools.
Validate TLS.
Do not blindly relay tokens.
Propagate trace/correlation.
Budget timeouts.
Retry only safe operations.
Use idempotency for writes.
Map downstream errors safely.
Protect against schema drift.
Test with mock server and faults.
```

Top-tier JAX-RS engineer memastikan:

- outbound calls dibungkus dalam gateway/adapter;
- client lifecycle dan pool terkendali;
- security/token/tenant propagation jelas;
- timeout/retry/circuit/bulkhead tidak saling merusak;
- downstream failures tidak bocor mentah ke API consumer;
- schema compatibility diuji;
- dependency health observable;
- service mesh/gateway/app resilience policy tidak menciptakan retry storm.

Part berikutnya:

```text
Bagian 049 — JAX-RS with MicroProfile: Config, Rest Client, Fault Tolerance, Metrics, OpenAPI, JWT
```

Kita akan membahas integrasi Jakarta REST dengan MicroProfile: config-driven apps, typed REST client, fault tolerance annotations, telemetry/metrics, OpenAPI generation, JWT security, health checks, and production runtime patterns.
