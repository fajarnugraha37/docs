# Strict Coding Standards — Java Network

> **File:** `strict-coding-standards__java_network.md`  
> **Scope:** Java networking code generated or modified by LLM/code agents.  
> **Baselines:** Java 11, 17, 21, and 25.  
> **Status:** Mandatory standard. Any violation requires explicit reviewer approval.

---

## 1. Purpose

This document defines strict conventions for Java networking code. It is designed for LLM implementation agents, reviewers, and maintainers who need predictable, secure, testable, production-grade network behavior.

This is not a tutorial. It is a set of enforceable rules.

Network code is risky because failures are often partial, delayed, non-deterministic, and environment-dependent. Therefore every network implementation must make the following properties explicit:

1. connection lifecycle;
2. timeout policy;
3. retry and idempotency policy;
4. request/response size policy;
5. TLS and certificate policy;
6. DNS and address validation policy;
7. redirect and proxy policy;
8. backpressure and streaming policy;
9. observability and failure classification;
10. test coverage for success, timeout, cancellation, bad response, and network failure.

---

## 2. Applicability

This standard applies to Java code using:

- `java.net.URI`, `URL`, `InetAddress`, `Socket`, `ServerSocket`, `DatagramSocket`, `ProxySelector`, `Authenticator`;
- `java.net.http.HttpClient`, `HttpRequest`, `HttpResponse`, `WebSocket`;
- `java.nio.channels.SocketChannel`, `ServerSocketChannel`, `DatagramChannel`, `Selector`, asynchronous channels;
- JSSE/TLS APIs: `SSLContext`, `SSLSocket`, `SSLEngine`, `SSLParameters`, `TrustManager`, `KeyManager`;
- framework wrappers around Java networking, including but not limited to REST clients, generated clients, RPC clients, messaging connectors, and service-to-service clients.

This standard does **not** replace protocol-specific standards such as JAX-RS, gRPC, Kafka, JMS, SMTP, SFTP, or WebSocket application protocol standards. It is the baseline underneath them.

---

## 3. Version Contract

### 3.1 Java 11+

Java 11 introduced the standard HTTP Client API under `java.net.http`.

For Java 11 and later, new outbound HTTP integrations must prefer `java.net.http.HttpClient` or an approved framework client that exposes equivalent controls for:

- connection timeout;
- request timeout;
- redirect policy;
- TLS configuration;
- proxy configuration;
- streaming request/response body;
- cancellation;
- metrics/tracing hooks.

### 3.2 Java 17+

Java 17 code must still follow the Java 11 HTTP client rules. Do not assume Java 17 changes basic network failure semantics.

### 3.3 Java 21+

Java 21 virtual threads are allowed for blocking network I/O only when the code has bounded external resources and clear concurrency limits.

Virtual threads do not remove the need for:

- timeouts;
- connection pools;
- semaphores/rate limits;
- backpressure;
- circuit breakers;
- retry budgets.

### 3.4 Java 25+

Java 25 code must keep the same safety model. Newer platform behavior does not justify preview/incubator APIs unless explicitly approved by the project baseline standard.

---

## 4. Rule Language

The words below are normative:

- **MUST**: mandatory.
- **MUST NOT**: forbidden.
- **SHOULD**: default expectation; exceptions require justification.
- **MAY**: allowed when useful.
- **RESTRICTED**: allowed only with explicit justification, tests, and reviewer approval.

---

## 5. High-Level Network Design Rules

### 5.1 Network calls are boundary operations

Network calls MUST be treated as boundary operations, not ordinary function calls.

Every outbound network call MUST define:

```text
operation name
remote system
protocol
host allow-list or service discovery source
timeout
retry policy
idempotency policy
expected status/result mapping
max request size
max response size
observability fields
fallback behavior, if any
```

### 5.2 No hidden network calls

LLM-generated code MUST NOT introduce hidden network calls in:

- constructors;
- static initializers;
- `equals`, `hashCode`, or `toString`;
- entity getters;
- logging formatters;
- JSON serializers;
- validators, unless explicitly named as remote validators;
- test setup without local mock server or fixture.

### 5.3 Network code must be injectable

Network clients MUST be injected or created by infrastructure factories. Business services MUST NOT instantiate raw clients inline unless it is a trivial command-line tool or test fixture.

Bad:

```java
public CustomerStatus fetch(String id) {
    HttpClient client = HttpClient.newHttpClient();
    // ...
}
```

Good:

```java
public final class CustomerGateway {
    private final HttpClient httpClient;
    private final URI baseUri;

    public CustomerGateway(HttpClient httpClient, URI baseUri) {
        this.httpClient = Objects.requireNonNull(httpClient, "httpClient");
        this.baseUri = Objects.requireNonNull(baseUri, "baseUri");
    }
}
```

### 5.4 Separate protocol code from business code

Protocol mapping MUST live in gateway/client/adapter classes. Business services must consume domain-level results, not raw `HttpResponse`, `Socket`, `ByteBuffer`, or protocol-specific payloads.

---

## 6. Allowed, Restricted, and Forbidden APIs

| API / Pattern | Status | Rule |
|---|---:|---|
| `java.net.http.HttpClient` | Allowed | Preferred for Java 11+ HTTP clients. |
| `URI` | Allowed | Preferred for parsing/building network identifiers. |
| `URL` constructors | Restricted/Forbidden | Avoid in new code. Use `URI` and `URI.toURL()` when a `URL` is required. |
| `URLConnection` / `HttpURLConnection` | Restricted | Legacy compatibility only. Must define timeout, redirect, streaming, and close behavior. |
| `Socket` / `ServerSocket` | Restricted | Allowed for low-level protocols only. Must define framing, timeout, shutdown, and concurrency model. |
| `SocketChannel` / `Selector` | Restricted | Allowed for high-scale/non-blocking code only. Must handle partial read/write and backpressure. |
| `DatagramSocket` / `DatagramChannel` | Restricted | Allowed only when UDP semantics are acceptable. Must handle loss, duplication, reordering, and size limits. |
| `SSLSocket` / `SSLEngine` | Restricted | Allowed when framework/client cannot satisfy TLS requirements. |
| Custom `TrustManager` | Highly restricted | Must not disable certificate validation. Requires security review. |
| Custom `HostnameVerifier` that returns `true` | Forbidden | Never bypass hostname verification. |
| `ObjectInputStream` over network data | Forbidden by default | Native Java deserialization from untrusted network input is prohibited. |
| Credentials in URI | Forbidden | Never put tokens/passwords in URL user-info/query unless protocol explicitly requires and risk is approved. |
| Unbounded body read | Forbidden | Do not read unknown remote body into memory without max size. |
| Infinite timeout | Forbidden | Every network call must have bounded timeout. |
| Uncontrolled redirects | Forbidden for untrusted URLs | Redirects must be disabled or revalidated. |
| Retry all failures blindly | Forbidden | Retry must be based on idempotency and classified transient failure. |

---

## 7. URI, URL, and Endpoint Construction

### 7.1 Prefer `URI`

New code MUST use `URI` for parsing and constructing identifiers.

Bad:

```java
URL url = new URL(rawUserInput);
```

Good:

```java
URI uri = URI.create(rawInput);
```

For untrusted input, do not use `URI.create` directly because it throws unchecked exceptions and does not perform business validation. Use explicit parsing and validation.

```java
URI uri;
try {
    uri = new URI(rawInput).normalize();
} catch (URISyntaxException ex) {
    throw new InvalidEndpointException("Invalid endpoint URI", ex);
}
```

### 7.2 URL constructors are not allowed in new code

In Java 20+, public `URL` constructors are deprecated. New code MUST NOT use them.

Use:

```java
URL url = uri.toURL();
```

For custom protocol handlers, use approved platform alternatives only when necessary and isolated in infrastructure code.

### 7.3 Never concatenate URLs manually

Bad:

```java
URI uri = URI.create(baseUrl + "/customers/" + customerId + "?q=" + query);
```

Good:

```java
URI uri = UriBuilderLike.build(baseUri, List.of("customers", customerId), Map.of("q", query));
```

If no URI builder library is available, create a small tested helper that handles:

- path segment encoding;
- query parameter encoding;
- no double slash bugs;
- no raw CR/LF injection;
- no accidental user-info section;
- no fragment unless explicitly needed.

### 7.4 Fragments must not be sent as application state

URI fragments are client-side identifiers. Network request logic MUST NOT rely on URI fragments being sent to servers.

### 7.5 User-info is forbidden

URLs like below MUST be rejected:

```text
https://username:password@example.com/resource
```

Credentials must use approved secret management and request headers, mTLS, or signed requests.

---

## 8. Outbound HTTP Client Rules

### 8.1 Use a reusable `HttpClient`

`HttpClient` instances SHOULD be created once per remote configuration and reused.

Bad:

```java
public String call(URI uri) throws IOException, InterruptedException {
    return HttpClient.newHttpClient()
            .send(HttpRequest.newBuilder(uri).GET().build(), BodyHandlers.ofString())
            .body();
}
```

Good:

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(3))
        .followRedirects(HttpClient.Redirect.NEVER)
        .version(HttpClient.Version.HTTP_2)
        .build();
```

Rationale: client instances carry configuration and can manage reusable connections. Creating a new client per operation usually prevents connection reuse.

### 8.2 Connect timeout is mandatory

Every `HttpClient` MUST have an explicit connect timeout.

```java
HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(3))
        .build();
```

### 8.3 Request timeout is mandatory

Every `HttpRequest` MUST have an explicit per-request timeout.

```java
HttpRequest request = HttpRequest.newBuilder(uri)
        .timeout(Duration.ofSeconds(10))
        .GET()
        .build();
```

The connect timeout and request timeout are different controls. Both are required.

### 8.4 Redirects are disabled by default

HTTP redirects MUST be disabled by default.

```java
.followRedirects(HttpClient.Redirect.NEVER)
```

Redirects MAY be enabled only when:

1. the remote endpoint is trusted;
2. the redirect target is revalidated;
3. scheme downgrade is forbidden;
4. credential forwarding is controlled;
5. observability records the redirect count and target host.

For user-controlled URLs, redirects MUST be disabled unless a complete SSRF defense exists.

### 8.5 HTTP method semantics must control retries

Retries MUST be based on HTTP method semantics and operation-level idempotency.

Default retry policy:

| Method / Operation | Retry Default |
|---|---:|
| `GET`, `HEAD`, `OPTIONS` | Allowed for transient failures with budget. |
| `PUT`, `DELETE` | Allowed only when operation is idempotent in the target API contract. |
| `POST`, `PATCH` | Forbidden unless idempotency key or operation contract proves safe retry. |

Do not retry because “HTTP failed”. Retry only when all are true:

- failure is classified transient;
- operation is idempotent or idempotency key is used;
- retry budget is not exhausted;
- timeout budget still allows another attempt;
- retry uses jittered backoff;
- result preserves original correlation/idempotency identifiers.

### 8.6 Treat status codes explicitly

HTTP clients MUST map response status codes explicitly.

Bad:

```java
return response.body();
```

Good:

```java
int status = response.statusCode();
if (status >= 200 && status < 300) {
    return decodeSuccess(response.body());
}
if (status == 404) {
    return CustomerLookupResult.notFound();
}
if (status == 429 || status == 503) {
    throw new RemoteServiceUnavailableException(status, response.headers());
}
throw new RemoteProtocolException(status, safeErrorBody(response));
```

### 8.7 Do not use `BodyHandlers.ofString()` for unbounded bodies

`BodyHandlers.ofString()` is allowed only when the response body has a known small maximum size.

For large or unknown bodies, use streaming/file/subscriber-based handlers.

Allowed for small bounded response:

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString(StandardCharsets.UTF_8));
```

Restricted for large response:

```java
HttpResponse<InputStream> response = client.send(request, BodyHandlers.ofInputStream());
```

When using `ofInputStream()`, the stream MUST be consumed and closed using `try-with-resources`.

### 8.8 Charset must be explicit for durable text

For request bodies and response parsing, charset MUST be explicit unless the protocol mandates the charset.

Bad:

```java
BodyPublishers.ofString(json)
```

Good:

```java
BodyPublishers.ofString(json, StandardCharsets.UTF_8)
```

### 8.9 Request body streaming must be intentional

Large request bodies MUST be streamed from `Path`, `InputStream`, or publisher rather than buffered into memory.

```java
HttpRequest request = HttpRequest.newBuilder(uri)
        .timeout(Duration.ofMinutes(2))
        .header("Content-Type", "application/octet-stream")
        .POST(BodyPublishers.ofFile(path))
        .build();
```

### 8.10 Async calls must have explicit executor policy

`sendAsync` MAY be used only when lifecycle, cancellation, timeout, and executor/backpressure are clear.

Bad:

```java
client.sendAsync(request, BodyHandlers.ofString())
      .thenApply(HttpResponse::body);
```

Good:

```java
CompletableFuture<HttpResponse<String>> future = client.sendAsync(request, BodyHandlers.ofString(StandardCharsets.UTF_8));
return future.orTimeout(10, TimeUnit.SECONDS)
        .thenApply(this::mapResponse);
```

Do not create unbounded async fan-out.

### 8.11 Cancellation must be propagated

If a higher-level operation is cancelled, the network request MUST be cancelled where possible.

For asynchronous calls, propagate `CompletableFuture.cancel(true)` or use framework-specific cancellation.

### 8.12 Headers must be controlled

LLM code MUST NOT forward arbitrary inbound headers to outbound calls.

Forward only an explicit allow-list such as:

- correlation ID;
- trace context;
- idempotency key;
- locale, if required;
- authorization token, only when crossing the same trust boundary is approved.

Forbidden to forward blindly:

- `Authorization`;
- `Cookie`;
- `Host`;
- `X-Forwarded-*`;
- `Forwarded`;
- `Proxy-*`;
- user-supplied `Content-Length`;
- user-supplied `Transfer-Encoding`.

### 8.13 Do not log sensitive headers or body

Logs MUST NOT contain:

- access tokens;
- refresh tokens;
- API keys;
- cookies;
- client certificates;
- private keys;
- passwords;
- session identifiers;
- full PII payloads;
- full request/response bodies unless explicitly redacted and approved.

---

## 9. Legacy `URLConnection` / `HttpURLConnection`

### 9.1 Restricted by default

`URLConnection` and `HttpURLConnection` are restricted in new code. Prefer `HttpClient` on Java 11+.

Allowed only for:

- old code maintenance;
- platform/library compatibility;
- environments where `HttpClient` is unavailable;
- very small tools with explicit timeout and close behavior.

### 9.2 Mandatory rules

When used, code MUST set:

```java
connection.setConnectTimeout(connectTimeoutMillis);
connection.setReadTimeout(readTimeoutMillis);
connection.setInstanceFollowRedirects(false);
```

Input/output streams MUST be closed via `try-with-resources`.

Do not rely on global defaults.

---

## 10. TCP Socket Rules

### 10.1 Use sockets only for protocol-level code

Raw `Socket`/`ServerSocket` code is restricted to cases where no higher-level protocol client/server is appropriate.

Every socket protocol MUST define:

- message framing;
- encoding;
- max frame size;
- timeout;
- keepalive/heartbeat policy;
- connection close semantics;
- half-close behavior;
- concurrency model;
- error classification;
- compatibility/versioning.

### 10.2 Socket timeout is mandatory

Client sockets MUST use bounded connect and read timeouts.

```java
try (Socket socket = new Socket()) {
    socket.connect(remoteAddress, connectTimeoutMillis);
    socket.setSoTimeout(readTimeoutMillis);
    // ...
}
```

### 10.3 Never assume `read` returns a full message

TCP is a byte stream. `InputStream.read(...)` does not correspond to application messages.

Bad:

```java
int n = in.read(buffer);
String message = new String(buffer, 0, n, StandardCharsets.UTF_8);
```

Good:

```java
int length = readLengthPrefix(in);
if (length < 0 || length > maxFrameBytes) {
    throw new ProtocolViolationException("Invalid frame length: " + length);
}
byte[] payload = in.readNBytes(length);
if (payload.length != length) {
    throw new EOFException("Connection closed before full frame was received");
}
```

### 10.4 Define close and shutdown behavior

Code MUST distinguish:

- graceful close;
- remote reset;
- timeout;
- protocol violation;
- partial request/response;
- cancellation.

Do not collapse all socket failures into `RuntimeException`.

### 10.5 Server accept loops must be stoppable

Server loops MUST have controlled shutdown.

Bad:

```java
while (true) {
    Socket client = serverSocket.accept();
    new Thread(() -> handle(client)).start();
}
```

Good:

```java
while (running.get()) {
    Socket client = serverSocket.accept();
    executor.submit(() -> handleClient(client));
}
```

Thread/executor capacity MUST be bounded.

### 10.6 Virtual threads rule

On Java 21+, virtual threads MAY be used for blocking socket handlers.

Allowed:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    while (running.get()) {
        Socket client = serverSocket.accept();
        executor.submit(() -> handleClient(client));
    }
}
```

Still mandatory:

- max accepted connections or external connection limiter;
- read/write timeout;
- max frame size;
- graceful shutdown;
- backpressure.

---

## 11. NIO Channel and Selector Rules

### 11.1 Use NIO only when justified

`SocketChannel`, `ServerSocketChannel`, `Selector`, and non-blocking I/O are restricted.

Use them only when:

- high connection count requires non-blocking multiplexing;
- framework/library is not appropriate;
- protocol is simple enough to implement safely;
- team can maintain partial read/write state machines.

### 11.2 Partial read/write handling is mandatory

NIO code MUST handle:

- partial reads;
- partial writes;
- zero-byte reads/writes;
- buffer flip/compact/clear correctness;
- connection close during pending write;
- read interest vs write interest toggling;
- outbound queue backpressure.

### 11.3 No busy-spin selectors

Selector loops MUST NOT busy-spin.

Bad:

```java
while (true) {
    selector.selectNow();
    // ...
}
```

Good:

```java
while (running.get()) {
    int ready = selector.select(selectTimeoutMillis);
    if (ready == 0) {
        continue;
    }
    // process keys
}
```

### 11.4 ByteBuffer lifecycle must be explicit

Every `ByteBuffer` use MUST make ownership and lifecycle clear.

Rules:

- call `flip()` before reading data written into a buffer;
- call `compact()` when preserving unread data;
- call `clear()` only when old data can be discarded;
- do not expose mutable shared buffers across sessions;
- direct buffers require explicit justification and memory budget.

---

## 12. UDP Rules

### 12.1 UDP semantics must be acknowledged

UDP code MUST explicitly handle that datagrams can be:

- lost;
- duplicated;
- reordered;
- truncated;
- delivered from unexpected sources;
- blocked by network infrastructure.

### 12.2 Datagram size must be bounded

Code MUST define maximum datagram size and reject oversized payloads.

### 12.3 Application-level idempotency is mandatory

For commands over UDP, messages MUST include application-level identifiers to handle duplicate delivery.

### 12.4 Timeout is mandatory

UDP receive operations MUST have a timeout or non-blocking selector policy.

---

## 13. DNS and Name Resolution

### 13.1 DNS is not configuration immutability

Hostnames can resolve to changing addresses. Code MUST NOT assume an address resolved at startup remains valid forever unless the architecture explicitly pins it.

### 13.2 DNS TTL must be configured correctly

`networkaddress.cache.ttl`, `networkaddress.cache.stale.ttl`, and `networkaddress.cache.negative.ttl` are Java security properties, not ordinary application system properties.

Do not write:

```bash
-Dnetworkaddress.cache.ttl=30
```

as if it reliably configures DNS caching. It does not work as a normal system property.

Use approved runtime/security configuration, for example `java.security` or container/JVM security property configuration.

### 13.3 Avoid indefinite DNS caching in dynamic infrastructure

In cloud, Kubernetes, container, blue/green, failover, and service-discovery environments, indefinite DNS caching is risky.

Every service MUST define its DNS/cache behavior or rely on an approved platform/client discovery mechanism.

### 13.4 SSRF validation must consider DNS rebinding

When validating user-supplied hosts, validation MUST consider time-of-check/time-of-use and DNS rebinding. See SSRF section.

---

## 14. TLS / JSSE Rules

### 14.1 TLS is mandatory for external network calls

External service calls carrying credentials, PII, business data, or control operations MUST use TLS unless explicitly approved otherwise.

### 14.2 Never disable certificate validation

Forbidden:

```java
TrustManager[] trustAll = new TrustManager[] { ... };
```

Forbidden:

```java
hostnameVerifier = (host, session) -> true;
```

Forbidden:

```java
-Dcom.sun.net.ssl.checkRevocation=false
```

unless part of an approved platform configuration and security review.

### 14.3 Use default TLS settings unless there is a concrete reason

Default JSSE configuration SHOULD be used unless security/compliance requires explicit configuration.

Custom `SSLContext` is restricted and must justify:

- trust store source;
- key store source;
- certificate rotation;
- hostname verification;
- protocol versions;
- cipher suites;
- mTLS requirement;
- revocation/checking behavior;
- logging redaction.

### 14.4 mTLS must be infrastructure-managed when possible

For mTLS, prefer platform-managed certificates and rotation. Application-level keystore loading MUST avoid hardcoded paths/passwords and MUST support rotation/reload strategy when required.

### 14.5 Pinning is restricted

Certificate/public key pinning is restricted because it can break rotation and incident recovery.

Allowed only with:

- documented rotation plan;
- backup pins;
- alerting before expiry;
- emergency bypass process;
- tests for failure mode.

### 14.6 Do not log TLS secrets

Never log:

- private keys;
- key store passwords;
- trust store passwords;
- full certificates if they expose sensitive metadata;
- session secrets;
- bearer tokens sent over TLS.

---

## 15. SSRF and User-Supplied URLs

### 15.1 User-supplied URL fetching is high risk

Any code that accepts a URL/host from a user, tenant, external system, or database field and then performs a server-side request MUST be treated as SSRF-sensitive.

### 15.2 Default policy: deny by default

User-supplied URLs MUST pass an allow-list policy.

Validation MUST check:

- scheme: only approved schemes, usually `https`;
- host: exact allow-list or approved domain suffix rule;
- port: approved ports only;
- user-info: forbidden;
- fragment: ignored/rejected;
- path/query: validated if they influence target behavior;
- resolved IP addresses: must not be loopback/private/link-local/metadata unless explicitly approved;
- redirects: disabled or revalidated at every hop;
- response size: bounded;
- response content type: allow-listed;
- timeout: bounded;
- outbound method: restricted.

### 15.3 Block internal address ranges by default

Unless the feature is explicitly internal-admin functionality, outbound requests to the following MUST be denied:

- loopback addresses;
- link-local addresses;
- private RFC1918 ranges;
- unique local IPv6 addresses;
- multicast/broadcast;
- cloud metadata endpoints;
- localhost aliases;
- raw IPs when host allow-list expects DNS names.

### 15.4 Redirects must be revalidated

A safe initial URL can redirect to an unsafe internal URL. Therefore, redirects for user-controlled URLs MUST be disabled or each redirect target MUST go through the full validation pipeline.

### 15.5 DNS rebinding must be considered

Validation MUST NOT only validate the hostname string. It must consider resolved addresses and TOCTOU risk.

For sensitive features, prefer network egress controls in addition to application validation.

---

## 16. Proxy, Authentication, and Secrets

### 16.1 Proxy configuration must be explicit

Proxy use MUST be configured through approved infrastructure configuration.

Do not silently rely on environment-specific proxy behavior unless project standard says so.

### 16.2 Do not embed credentials in URLs

Forbidden:

```text
https://token@example.com/api
https://user:pass@example.com/api
```

Use secret management and headers or mTLS.

### 16.3 Authentication failure must be distinct

Network code MUST distinguish:

- connection failure;
- TLS failure;
- proxy authentication failure;
- upstream authentication failure;
- authorization failure;
- rate limit;
- timeout.

Do not map all to `RemoteServiceException` without classification.

---

## 17. Timeouts, Deadlines, and Budgets

### 17.1 Every network operation must have a timeout

Timeouts MUST be explicit. No network operation may rely on infinite/default timeout.

Required timeout types where applicable:

- DNS/resolve budget, if controllable;
- connect timeout;
- TLS handshake timeout, if separately controllable;
- request/write timeout;
- response/read timeout;
- overall deadline;
- idle timeout;
- pool acquisition timeout;
- retry total budget.

### 17.2 Prefer deadline propagation

When a request enters a service with an overall deadline, outbound calls MUST respect remaining time.

Bad:

```java
callA(timeout10s);
callB(timeout10s);
callC(timeout10s);
```

Good:

```java
Deadline deadline = Deadline.after(Duration.ofSeconds(10));
callA(deadline.remaining());
callB(deadline.remaining());
callC(deadline.remaining());
```

### 17.3 Timeout values must be configuration, not magic constants

Timeouts SHOULD be configuration-backed and named by operation.

Bad:

```java
.timeout(Duration.ofSeconds(30))
```

Good:

```java
.timeout(config.customerLookup().requestTimeout())
```

### 17.4 Do not set arbitrary large timeouts

Large timeouts hide system failure and consume resources. Long-running operations must use asynchronous workflows, polling, callbacks, or job IDs where possible.

---

## 18. Retry, Backoff, Circuit Breaking, and Rate Limiting

### 18.1 Retry must be explicit

Retry policy MUST define:

```text
retryable failures
non-retryable failures
max attempts
backoff
jitter
total deadline
idempotency requirement
metrics
logging
```

### 18.2 Jitter is mandatory

Backoff without jitter is forbidden for distributed systems because it can synchronize retry storms.

### 18.3 Retry budget is mandatory

Retries MUST have a maximum attempt count and must respect the operation deadline.

### 18.4 Circuit breaker is required for critical remote dependencies

For high-volume or business-critical remote calls, use a circuit breaker or equivalent protection.

At minimum, define:

- failure rate threshold;
- slow call threshold;
- open duration;
- half-open probe count;
- fallback behavior;
- metrics;
- alert threshold.

### 18.5 Rate limits must be respected

When remote service returns `429` or rate-limit headers, client code SHOULD respect retry-after/backoff semantics, subject to overall deadline and idempotency.

---

## 19. Streaming and Backpressure

### 19.1 Stream large payloads

Large request/response bodies MUST be streamed. Do not load unknown remote data fully into memory.

### 19.2 Max size is mandatory

Every network ingestion path MUST define max size.

Examples:

- max JSON response size;
- max file download size;
- max multipart body size;
- max frame size;
- max WebSocket message size;
- max UDP datagram payload;
- max decompressed size.

### 19.3 Defend against decompression bombs

If compressed responses are accepted, code MUST define decompressed size limits. Do not trust compressed content length.

### 19.4 Apply backpressure

Async, streaming, WebSocket, and NIO code MUST have backpressure. Unbounded queues are forbidden.

Forbidden:

```java
BlockingQueue<Message> queue = new LinkedBlockingQueue<>();
```

Allowed:

```java
BlockingQueue<Message> queue = new ArrayBlockingQueue<>(config.maxPendingMessages());
```

---

## 20. WebSocket Rules

### 20.1 WebSocket is restricted

WebSocket clients/servers are restricted because they are long-lived bidirectional protocols.

Every WebSocket implementation MUST define:

- authentication;
- reconnection policy;
- heartbeat/ping-pong;
- max message size;
- backpressure;
- ordering guarantees;
- duplicate message behavior;
- close code handling;
- session lifecycle;
- observability.

### 20.2 No unbounded reconnect loops

Reconnect loops MUST use capped backoff with jitter and a stop condition.

### 20.3 Message handling must be non-blocking or isolated

Do not block WebSocket listener callbacks with slow business logic. Dispatch to bounded processing infrastructure.

---

## 21. Serialization and Wire Format

### 21.1 Native Java serialization is forbidden for untrusted network input

`ObjectInputStream` MUST NOT be used for data received from a network unless the input is fully trusted and explicitly approved.

Preferred formats:

- JSON with schema/DTO validation;
- Protobuf;
- Avro;
- CBOR;
- custom binary protocol with strict framing and max size.

### 21.2 Schema/versioning is mandatory

Network payloads MUST have versioning strategy when used across services or long-lived clients.

### 21.3 Validate before use

Deserialize into DTOs, validate DTOs, then map to domain objects.

Never let remote payloads instantiate arbitrary classes.

---

## 22. Error Handling and Exception Taxonomy

### 22.1 Preserve cause, classify failure

Network exceptions MUST preserve the original cause and classify failure.

Recommended taxonomy:

```text
RemoteTimeoutException
RemoteConnectionException
RemoteTlsException
RemoteDnsException
RemoteAuthenticationException
RemoteAuthorizationException
RemoteRateLimitedException
RemoteProtocolException
RemoteUnavailableException
RemotePayloadTooLargeException
RemoteInvalidResponseException
RemoteCancelledException
```

### 22.2 Do not leak sensitive remote response details

Client-facing errors MUST not expose raw upstream error bodies unless sanitized.

### 22.3 Log once at boundary

Network failures SHOULD be logged at the boundary with structured fields. Do not log and rethrow repeatedly at every layer.

Required log fields:

```text
operation
remote system
method/protocol
sanitized host
status code, if any
failure class
timeout/retry attempt
duration
correlation id
trace id
```

Forbidden log fields:

```text
token
password
cookie
raw Authorization header
full PII payload
private key
session secret
```

---

## 23. Observability

### 23.1 Metrics are mandatory for production network clients

Production clients SHOULD emit:

- request count;
- success count;
- failure count by class;
- latency histogram;
- timeout count;
- retry count;
- circuit breaker state;
- in-flight requests;
- pool usage, if applicable;
- response status distribution;
- response size distribution, if applicable.

### 23.2 Distributed tracing

Outbound HTTP calls SHOULD propagate approved trace context headers.

Do not generate multiple unrelated trace IDs inside one operation unless starting a new trace is intentional.

### 23.3 Correlation ID

Correlation/request IDs MUST be propagated across service boundaries when project conventions require it.

---

## 24. Configuration Standards

### 24.1 Required client configuration

Every remote client config MUST include:

```yaml
remoteSystemName: customer-service
baseUri: https://customer.example.internal
connectTimeout: PT3S
requestTimeout: PT10S
maxResponseBytes: 1048576
followRedirects: false
retry:
  maxAttempts: 2
  baseDelay: PT100M
  maxDelay: PT1S
  jitter: true
```

### 24.2 Configuration validation

Configuration MUST be validated at startup:

- URI syntax;
- scheme allow-list;
- timeout range;
- retry range;
- max body size;
- required secret references;
- no credentials embedded in URI.

### 24.3 Do not hardcode environment endpoints

Hardcoded production/staging/dev URLs are forbidden in source code.

Allowed:

- test fixtures;
- local examples;
- documentation;
- constants representing path templates, not environment hosts.

---

## 25. Testing Standards

### 25.1 Unit tests

Unit tests MUST cover:

- URI building/encoding;
- status code mapping;
- timeout configuration;
- retry decision;
- header allow-listing;
- body size limit;
- error body sanitization;
- DTO validation.

### 25.2 Integration tests

Network integration tests SHOULD use local controlled servers such as:

- JDK built-in test HTTP server;
- WireMock;
- MockWebServer;
- Testcontainers;
- local TCP/UDP fixture;
- TLS test server with generated certificates.

Do not call real external systems in normal unit tests.

### 25.3 Failure tests are mandatory

For every production remote client, tests MUST cover:

- connection refused;
- connection timeout;
- read timeout;
- invalid TLS certificate, if TLS client is customized;
- HTTP 4xx mapping;
- HTTP 5xx mapping;
- malformed response;
- oversized response;
- cancellation;
- retryable transient failure;
- non-retryable failure.

### 25.4 SSRF tests

Any feature that fetches user-controlled URLs MUST test rejection of:

- `localhost`;
- `127.0.0.1`;
- `[::1]`;
- private IPv4 ranges;
- link-local ranges;
- cloud metadata endpoints;
- URL with user-info;
- unsupported scheme;
- redirect to private address;
- encoded/obfuscated host variants;
- DNS rebinding strategy, if feasible in test environment.

---

## 26. LLM Implementation Rules

When an LLM code agent creates or modifies Java network code, it MUST follow this process:

1. Identify whether the code is HTTP, TCP, UDP, WebSocket, DNS, TLS, or proxy-related.
2. Identify whether the remote endpoint is trusted, internal, external, tenant-controlled, or user-controlled.
3. Define timeout policy before writing the call.
4. Define retry/idempotency policy before writing retry logic.
5. Define max request/response size before reading bodies.
6. Define TLS/certificate behavior before using HTTPS or sockets.
7. Define redirect behavior before enabling redirects.
8. Define observability fields before finalizing the implementation.
9. Add tests for failure cases, not only success.
10. Avoid introducing new dependencies unless the project already uses them or the dependency is justified.

LLM agents MUST NOT:

- generate trust-all TLS code;
- disable hostname verification;
- create `HttpClient` per request;
- omit connect/request/read timeouts;
- use `URL` constructors in new code;
- use unbounded body reads for remote data;
- retry `POST` without idempotency proof;
- blindly follow redirects;
- fetch user-supplied URLs without SSRF allow-listing;
- log credentials/tokens;
- use native Java deserialization over network input;
- implement custom non-blocking protocols without state-machine tests.

---

## 27. Code Templates

### 27.1 Safe HTTP client factory

```java
public final class RemoteHttpClientFactory {
    private RemoteHttpClientFactory() {
    }

    public static HttpClient create(RemoteClientConfig config) {
        Objects.requireNonNull(config, "config");
        config.validate();

        return HttpClient.newBuilder()
                .connectTimeout(config.connectTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                .version(HttpClient.Version.HTTP_2)
                .build();
    }
}
```

### 27.2 Safe GET request

```java
public CustomerDto getCustomer(String customerId) {
    URI uri = uriBuilder.pathSegment("customers", customerId).build();

    HttpRequest request = HttpRequest.newBuilder(uri)
            .timeout(config.requestTimeout())
            .header("Accept", "application/json")
            .GET()
            .build();

    try {
        HttpResponse<String> response = httpClient.send(
                request,
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));

        return mapCustomerResponse(response);
    } catch (HttpTimeoutException ex) {
        throw new RemoteTimeoutException("Customer lookup timed out", ex);
    } catch (SSLException ex) {
        throw new RemoteTlsException("Customer lookup TLS failure", ex);
    } catch (IOException ex) {
        throw new RemoteConnectionException("Customer lookup network failure", ex);
    } catch (InterruptedException ex) {
        Thread.currentThread().interrupt();
        throw new RemoteCancelledException("Customer lookup interrupted", ex);
    }
}
```

### 27.3 Bounded response body handler strategy

For small JSON responses, `ofString` is acceptable only when max response size is enforced by server, proxy, or client wrapper.

For unknown/large responses, use streaming and enforce byte limits:

```java
try (InputStream input = response.body()) {
    byte[] payload = readAtMost(input, config.maxResponseBytes());
    return decode(payload);
}
```

The helper `readAtMost` MUST throw when the response exceeds configured max size.

### 27.4 Safe socket connect

```java
public void sendFrame(InetSocketAddress remote, byte[] payload) throws IOException {
    if (payload.length > maxFrameBytes) {
        throw new IllegalArgumentException("Payload exceeds max frame size");
    }

    try (Socket socket = new Socket()) {
        socket.connect(remote, connectTimeoutMillis);
        socket.setSoTimeout(readTimeoutMillis);

        OutputStream out = socket.getOutputStream();
        writeFrame(out, payload);
        out.flush();
    }
}
```

---

## 28. Anti-Patterns

### 28.1 Trust-all TLS

```java
// FORBIDDEN
TrustManager[] trustAll = new TrustManager[] { new X509TrustManager() { ... } };
```

### 28.2 Hostname verification bypass

```java
// FORBIDDEN
connection.setHostnameVerifier((hostname, session) -> true);
```

### 28.3 New client per request

```java
// FORBIDDEN by default
HttpClient.newHttpClient().send(request, BodyHandlers.ofString());
```

### 28.4 No timeout

```java
// FORBIDDEN
HttpRequest request = HttpRequest.newBuilder(uri).GET().build();
```

### 28.5 Blind redirect following

```java
// FORBIDDEN for untrusted URLs
.followRedirects(HttpClient.Redirect.ALWAYS)
```

### 28.6 Retry everything

```java
// FORBIDDEN
catch (Exception ex) {
    return callAgain();
}
```

### 28.7 Raw body logging

```java
// FORBIDDEN
log.info("Response body: {}", response.body());
```

### 28.8 Native deserialization from socket

```java
// FORBIDDEN by default
ObjectInputStream in = new ObjectInputStream(socket.getInputStream());
Object object = in.readObject();
```

---

## 29. Review Checklist

A Java network change is acceptable only if the reviewer can answer **yes** to all relevant questions:

### Design

- [ ] Is the network boundary isolated in a gateway/client/adapter?
- [ ] Is the remote system identified by name?
- [ ] Is the endpoint configurable and validated?
- [ ] Is there no hidden network call in constructors/static initialization/domain methods?

### HTTP

- [ ] Is `HttpClient` reused instead of created per request?
- [ ] Is connect timeout set?
- [ ] Is request timeout set?
- [ ] Are redirects disabled or revalidated?
- [ ] Are HTTP status codes mapped explicitly?
- [ ] Is response body size bounded?
- [ ] Is charset explicit for text bodies?
- [ ] Are headers allow-listed?

### Retry

- [ ] Is retry policy explicit?
- [ ] Is idempotency proven?
- [ ] Is jittered backoff used?
- [ ] Is total deadline respected?

### TLS/Security

- [ ] Is certificate validation preserved?
- [ ] Is hostname verification preserved?
- [ ] Are secrets excluded from logs?
- [ ] Are user-supplied URLs SSRF-validated?
- [ ] Are redirects safe for user-controlled URLs?

### Sockets/NIO

- [ ] Is framing defined?
- [ ] Are max frame/message sizes defined?
- [ ] Are read/write timeouts defined?
- [ ] Are partial reads/writes handled?
- [ ] Is server shutdown controlled?
- [ ] Is concurrency bounded?

### Observability

- [ ] Are operation name, remote system, status/failure, duration, and correlation IDs observable?
- [ ] Are metrics emitted for production clients?
- [ ] Are sensitive values redacted?

### Tests

- [ ] Are success cases tested?
- [ ] Are timeout cases tested?
- [ ] Are 4xx/5xx cases tested?
- [ ] Are malformed/oversized responses tested?
- [ ] Are retry and non-retry cases tested?
- [ ] Are SSRF rejection cases tested where applicable?

---

## 30. Prompt Contract for LLM Code Agents

Use this instruction when asking an LLM to implement Java network code:

```text
You are modifying Java network code. Follow strict-coding-standards__java_network.md.

Before coding:
1. Identify protocol: HTTP/TCP/UDP/WebSocket/TLS/DNS/proxy.
2. Identify remote trust level: internal trusted, external trusted, tenant-controlled, or user-controlled.
3. Define timeout, retry, redirect, TLS, max body size, and observability behavior.
4. Do not use trust-all TLS, disabled hostname verification, URL constructors, unbounded body reads, blind redirects, or retry of non-idempotent calls.
5. Use Java baseline features only according to the project Java standard.
6. Add tests for success, timeout, bad response, oversized response, and retry/non-retry behavior.

When uncertain, choose the safer implementation and leave a TODO/question instead of inventing network behavior.
```

---

## 31. Source References

Primary references used to ground this standard:

- Java SE 25 `java.net.http.HttpClient` API documentation: `https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html`
- Java SE 25 networking properties: `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/doc-files/net-properties.html`
- Java SE 25 `InetAddress` API documentation: `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/InetAddress.html`
- Java SE 21 JSSE Reference Guide: `https://docs.oracle.com/en/java/javase/21/security/java-secure-socket-extension-jsse-reference-guide.html`
- OpenJDK Java HTTP Client introduction: `https://openjdk.org/groups/net/httpclient/intro.html`
- RFC 9110 HTTP Semantics: `https://www.rfc-editor.org/rfc/rfc9110.html`
- OWASP SSRF Prevention Cheat Sheet: `https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html`
- OWASP SSRF Top 10 guidance: `https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/`
- Oracle Secure Coding Guidelines for Java SE: `https://www.oracle.com/java/technologies/javase/seccodeguide.html`

---

## 32. Final Enforcement Rule

Network code must be boring, explicit, bounded, observable, and hostile to unsafe defaults.

If an LLM cannot prove timeout, retry, TLS, redirect, DNS/SSRF, body-size, and lifecycle behavior, the implementation is incomplete.
