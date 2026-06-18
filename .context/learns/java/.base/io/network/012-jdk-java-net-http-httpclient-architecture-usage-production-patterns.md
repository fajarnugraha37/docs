# Part 12 — JDK `java.net.http.HttpClient`: Architecture, Usage, and Production Patterns

Series: `learn-java-io-network-http-grpc-protocol-engineering`  
File: `012-jdk-java-net-http-httpclient-architecture-usage-production-patterns.md`  
Target Java: Java 8–25, with primary focus on JDK `HttpClient` introduced in Java 11 and still relevant in Java 25.

---

## 0. Why This Part Exists

By this point in the series, we have already built the lower-level foundations:

- TCP is a byte stream with connection lifecycle, kernel buffers, FIN/RST, TIME_WAIT, and real resource limits.
- DNS is a runtime dependency, not a static name-to-IP dictionary.
- HTTP/1.1 is stateful over connections even if the semantics look stateless.
- HTTP/2 introduces streams, frames, multiplexing, flow control, HPACK, and GOAWAY/RST_STREAM behavior.
- Serialization is a boundary contract, not just object mapping.
- HTTP semantics are protocol-level invariants, not framework decorations.

This part focuses on the JDK built-in HTTP client:

```java
java.net.http.HttpClient
java.net.http.HttpRequest
java.net.http.HttpResponse
```

The goal is not merely to know how to write:

```java
client.send(request, BodyHandlers.ofString());
```

The goal is to understand how to use the JDK HTTP client as a production network subsystem: configured once, bounded, observable, deadline-aware, cancellation-aware, streaming-safe, TLS-aware, and wrapped behind a domain-specific client boundary.

The JDK `HttpClient` is useful because it is built into the platform, supports HTTP/1.1 and HTTP/2, provides synchronous and asynchronous APIs, integrates with Java's `Flow` reactive-stream interfaces for request/response bodies, and avoids dragging an additional HTTP library into every runtime. But it is not magic. It still sits on top of DNS, TCP, TLS, HTTP semantics, remote systems, kernel resources, and your own operational decisions.

---

## 1. Learning Outcomes

After this part, you should be able to:

1. Explain when JDK `HttpClient` is a good production choice and when another client may be better.
2. Design a reusable `HttpClient` lifecycle instead of creating a new client per call.
3. Distinguish client-level configuration from request-level configuration.
4. Understand the practical meaning of HTTP version preference.
5. Use `BodyPublisher`, `BodyHandler`, and `BodySubscriber` as streaming abstractions, not just convenience methods.
6. Avoid memory hazards caused by `ofString()` and `ofByteArray()` on unbounded responses.
7. Build timeout and deadline behavior around JDK `HttpClient` correctly.
8. Use async requests without creating invisible unbounded concurrency.
9. Understand cancellation behavior and why cancelling a `CompletableFuture` is part of resource control.
10. Configure TLS, proxy, redirect, authenticator, cookie, and executor behavior intentionally.
11. Wrap `HttpClient` into a production-grade SDK/client layer with metrics, logs, tracing hooks, retries, idempotency, and error taxonomy.
12. Know the limitations of the built-in client, especially around explicit connection-pool tuning and advanced transport knobs.

---

## 2. The Correct Mental Model

A JDK `HttpClient` instance is not just a helper class. It represents shared client-side HTTP runtime configuration and resource sharing for outbound requests.

A single outbound call roughly becomes:

```text
Domain method
  -> request builder
  -> URI construction
  -> headers
  -> body publisher
  -> HttpClient send/sendAsync
  -> DNS resolution
  -> connection lookup/acquisition
  -> TCP connect if needed
  -> TLS handshake if HTTPS
  -> ALPN negotiation if HTTP/2 possible
  -> HTTP/1.1 message or HTTP/2 frames
  -> remote processing
  -> response headers
  -> body handler decides body subscriber
  -> body bytes consumed or streamed
  -> response mapped to domain result/error
```

The top 1% mental model is:

> `HttpClient` is not a remote method invocation abstraction. It is a transport boundary. Every call must have explicit expectations about time, size, status, retryability, cancellation, security, and observability.

That one sentence is the foundation of production-safe HTTP usage.

---

## 3. Where `HttpClient` Fits in Java 8–25

### 3.1 Java 8

Java 8 does not have `java.net.http.HttpClient` as a standard API. Common choices are:

- `HttpURLConnection`
- Apache HttpClient 4.x
- OkHttp
- Spring `RestTemplate`
- Netty/Reactor Netty for high-concurrency async use cases

For Java 8 systems, this part is still useful conceptually, but code using `java.net.http` requires Java 11+.

### 3.2 Java 9–10

The HTTP client existed as an incubating API, but production systems generally should not treat the Java 9/10 incubator package as the long-term API surface.

### 3.3 Java 11+

The standard API is available under:

```java
java.net.http
```

This is the real baseline for modern JDK `HttpClient` usage.

### 3.4 Java 17 / 21 / 25

On Java 17+ and especially Java 21+, the bigger design change is not that `HttpClient` suddenly changes its public shape dramatically, but that the surrounding concurrency model evolves:

- `CompletableFuture` remains available for async calls.
- Platform threads remain valid for blocking `send()`.
- Virtual threads make blocking-style code far more scalable for many I/O-bound workloads.
- Structured concurrency provides a better mental model for groups of related subtasks, cancellation, and failure propagation.

This does not remove network limits. Virtual threads do not create infinite connections, infinite remote capacity, infinite rate limit, infinite CPU, or infinite file descriptors.

---

## 4. The Three Core Types

### 4.1 `HttpClient`

`HttpClient` represents the configured client runtime.

Common configuration dimensions:

- preferred HTTP protocol version
- redirect policy
- proxy selector
- authenticator
- cookie handler
- TLS/SSL context
- SSL parameters
- executor
- connect timeout

The official Java 25 documentation describes `HttpClient` as immutable once built and usable for multiple requests. That implies the correct default pattern is reuse, not per-request construction.

Bad:

```java
public String call(String url) throws Exception {
    HttpClient client = HttpClient.newHttpClient(); // repeated construction
    HttpRequest request = HttpRequest.newBuilder(URI.create(url)).GET().build();
    return client.send(request, HttpResponse.BodyHandlers.ofString()).body();
}
```

Better:

```java
public final class ExternalServiceHttpClient {
    private final HttpClient httpClient;

    public ExternalServiceHttpClient(HttpClient httpClient) {
        this.httpClient = Objects.requireNonNull(httpClient);
    }
}
```

Construct the `HttpClient` once per logical client configuration.

### 4.2 `HttpRequest`

`HttpRequest` is an immutable request once built.

It contains:

- URI
- method
- headers
- optional body publisher
- request timeout
- optional HTTP version preference

Key point:

> The request is the protocol message specification. It should not contain hidden domain ambiguity.

For example, this is ambiguous:

```java
POST /cases/update
```

Better contract thinking asks:

- Is this command idempotent?
- Does it need an idempotency key?
- Is the request body bounded?
- What content type is sent?
- What response status codes are allowed?
- What happens if the client times out but the server completes the operation?

### 4.3 `HttpResponse<T>`

`HttpResponse<T>` contains:

- status code
- headers
- body of type `T`
- original request
- URI after redirect if applicable
- HTTP version used

The type `T` depends entirely on your `BodyHandler` and `BodySubscriber` choice.

This is important:

```java
HttpResponse<String>
HttpResponse<byte[]>
HttpResponse<Path>
HttpResponse<InputStream>
HttpResponse<Void>
```

These are not cosmetic differences. They imply completely different memory, streaming, cancellation, and connection reuse behavior.

---

## 5. Building the Client Correctly

Basic builder:

```java
HttpClient client = HttpClient.newBuilder()
    .version(HttpClient.Version.HTTP_2)
    .followRedirects(HttpClient.Redirect.NORMAL)
    .connectTimeout(Duration.ofSeconds(3))
    .build();
```

### 5.1 Preferred HTTP Version

```java
.version(HttpClient.Version.HTTP_2)
```

This is a preference, not a guarantee. The actual version depends on server support, TLS ALPN negotiation, proxy behavior, and sometimes fallback behavior.

Never write code that assumes:

```text
I configured HTTP_2, therefore every response is HTTP/2.
```

Check when needed:

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
System.out.println(response.version());
```

Production implication:

- HTTP/2 can reduce connection count through multiplexing.
- HTTP/2 can create hidden stream-level contention.
- HTTP/2 may behave differently through gateways and service mesh.
- Some servers or proxies claim support but behave poorly.

### 5.2 Redirect Policy

Options include:

```java
HttpClient.Redirect.NEVER
HttpClient.Redirect.NORMAL
HttpClient.Redirect.ALWAYS
```

Production rule:

> Redirects are not harmless for service-to-service calls.

Why?

- A redirect may change host.
- A redirect may change scheme.
- A redirect may leak headers if mishandled.
- A redirect may convert intended topology into unexpected topology.
- A redirect can hide infrastructure misconfiguration.

For internal service clients, default to `NEVER` unless redirects are a deliberate part of the contract.

Example safer default:

```java
HttpClient client = HttpClient.newBuilder()
    .followRedirects(HttpClient.Redirect.NEVER)
    .connectTimeout(Duration.ofSeconds(2))
    .build();
```

### 5.3 Connect Timeout

```java
.connectTimeout(Duration.ofSeconds(2))
```

This controls connection establishment timeout, not total request timeout.

Connect timeout covers the phase of making a new connection. It does not cover:

- DNS in every implementation/detail the way you might expect
- waiting in your own queue before calling `send()`
- TLS handshake as a separate conceptual budget
- request body upload
- remote processing
- response body download

Therefore, connect timeout is necessary but insufficient.

### 5.4 Executor

```java
ExecutorService executor = Executors.newFixedThreadPool(64);

HttpClient client = HttpClient.newBuilder()
    .executor(executor)
    .build();
```

The executor is used for asynchronous and dependent tasks internal to the client. You must treat it as a resource boundary.

Anti-pattern:

```java
HttpClient.newBuilder()
    .executor(Executors.newCachedThreadPool())
    .build();
```

This can turn remote slowness into local thread explosion.

Better:

```java
ThreadFactory factory = Thread.ofPlatform()
    .name("outbound-http-", 0)
    .factory();

ExecutorService executor = Executors.newFixedThreadPool(64, factory);

HttpClient client = HttpClient.newBuilder()
    .executor(executor)
    .connectTimeout(Duration.ofSeconds(2))
    .build();
```

If you use virtual threads, be careful:

```java
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
```

This can be reasonable for some blocking-style wrappers or async continuations, but it still needs external concurrency limits. Virtual threads make waiting cheaper. They do not limit outbound fan-out.

---

## 6. Building Requests Correctly

Example:

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com/v1/cases/123"))
    .timeout(Duration.ofSeconds(5))
    .header("Accept", "application/json")
    .GET()
    .build();
```

### 6.1 Request Timeout

```java
.timeout(Duration.ofSeconds(5))
```

This is request-level timeout.

Production rule:

> Every outbound request should have a timeout or be governed by a stronger parent deadline.

No timeout means the call may hang much longer than the user journey or batch job can tolerate.

### 6.2 URI Construction

Bad:

```java
URI.create(baseUrl + "/cases/" + caseId + "?q=" + query)
```

Problems:

- encoding bug
- path injection
- query injection
- double slash behavior
- SSRF risk if base URL is not controlled

Better: centralize URI construction.

```java
public final class CaseApiUris {
    private final URI baseUri;

    public CaseApiUris(URI baseUri) {
        this.baseUri = baseUri;
    }

    public URI caseById(String caseId) {
        String encoded = URLEncoder.encode(caseId, StandardCharsets.UTF_8);
        return baseUri.resolve("/v1/cases/" + encoded);
    }
}
```

For real production code, use a URI builder from a trusted library if available, especially for complex query parameters.

### 6.3 Headers

Headers are contract, not decorations.

Common outbound headers:

```text
Accept: application/json
Content-Type: application/json
Authorization: Bearer <token>
Idempotency-Key: <key>
X-Correlation-Id: <id>
Traceparent: <w3c trace context>
If-Match: <etag>
If-None-Match: <etag>
```

Rules:

1. Never log sensitive headers.
2. Do not forward inbound headers blindly to outbound dependencies.
3. Separate end-user identity propagation from service identity.
4. Treat `Content-Type` as a parsing contract.
5. Treat `Accept` as a response contract.

### 6.4 Method and Body

Examples:

```java
HttpRequest.BodyPublisher body = HttpRequest.BodyPublishers.ofString(json);

HttpRequest request = HttpRequest.newBuilder(uri)
    .header("Content-Type", "application/json")
    .header("Accept", "application/json")
    .POST(body)
    .timeout(Duration.ofSeconds(5))
    .build();
```

For methods not directly represented:

```java
HttpRequest request = HttpRequest.newBuilder(uri)
    .method("PATCH", HttpRequest.BodyPublishers.ofString(patchJson))
    .header("Content-Type", "application/json-patch+json")
    .build();
```

---

## 7. BodyPublisher: Sending Data Safely

A `BodyPublisher` converts your request body into a stream of byte buffers suitable for HTTP transmission.

Common options:

```java
BodyPublishers.noBody()
BodyPublishers.ofString(String)
BodyPublishers.ofByteArray(byte[])
BodyPublishers.ofFile(Path)
BodyPublishers.ofInputStream(Supplier<InputStream>)
```

### 7.1 `ofString`

Good for small JSON payloads.

```java
BodyPublisher publisher = BodyPublishers.ofString(json, StandardCharsets.UTF_8);
```

Risk:

- payload already exists fully in memory
- accidental huge payloads can cause memory pressure
- string encoding must be explicit for clarity

### 7.2 `ofByteArray`

Good when you already have a bounded binary payload.

Bad for large payloads if you read the whole file into a byte array first.

### 7.3 `ofFile`

Better for large uploads:

```java
HttpRequest request = HttpRequest.newBuilder(uri)
    .header("Content-Type", "application/octet-stream")
    .PUT(BodyPublishers.ofFile(path))
    .build();
```

This avoids materializing the full file into heap memory.

### 7.4 `ofInputStream`

```java
BodyPublisher publisher = BodyPublishers.ofInputStream(() -> openStreamSafely());
```

Important detail: the supplier matters because the request may need to obtain the stream at send time.

Retry warning:

> A streaming request body may not be replayable.

If a request body cannot be replayed, automatic retry can duplicate partial writes or fail on retry attempt. For POST/PUT with large streaming bodies, you need a deliberate retry policy.

---

## 8. BodyHandler and BodySubscriber: Receiving Data Safely

The response body is controlled by `HttpResponse.BodyHandler<T>`.

Common handlers:

```java
BodyHandlers.ofString()
BodyHandlers.ofByteArray()
BodyHandlers.ofFile(Path)
BodyHandlers.ofInputStream()
BodyHandlers.discarding()
BodyHandlers.ofLines()
```

### 8.1 `ofString()`

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

Good for small bounded text responses.

Dangerous for:

- unknown-size responses
- file downloads
- large error payloads
- malicious responses
- endpoints that accidentally return HTML pages, stack traces, or dumps

Production rule:

> Never use `ofString()` for a response whose maximum size is not known and enforced elsewhere.

### 8.2 `ofByteArray()`

Same risk, but often worse. Byte arrays are contiguous heap allocations.

### 8.3 `ofFile()`

```java
HttpResponse<Path> response = client.send(
    request,
    BodyHandlers.ofFile(downloadPath)
);
```

Useful for large downloads. But still think about:

- partial file on failure
- temp file naming
- atomic move after success
- checksum verification
- maximum allowed size
- disk space
- permission
- antivirus/scanning pipeline

### 8.4 `ofInputStream()`

```java
HttpResponse<InputStream> response = client.send(
    request,
    BodyHandlers.ofInputStream()
);

try (InputStream in = response.body()) {
    // stream manually
}
```

This gives you streaming control. It also gives you responsibility.

Rules:

1. Always close the stream.
2. Always bound the number of bytes read if the source is untrusted.
3. Always handle early termination.
4. Always understand whether connection reuse depends on consuming/closing the stream.

### 8.5 `discarding()`

Use when body is irrelevant:

```java
HttpResponse<Void> response = client.send(request, BodyHandlers.discarding());
```

Useful for endpoints where status/header is enough.

### 8.6 `ofLines()`

Potentially useful for line-delimited streaming, but be cautious:

- long-lived streams need cancellation
- line length should be bounded
- downstream processing must keep up
- partial lines and encoding issues matter

---

## 9. Sync API: `send()`

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

`send()` blocks the calling thread until the response is available according to the selected body handler.

### 9.1 With Platform Threads

Classic model:

```text
one request occupies one platform thread while waiting
```

This is fine for small controlled concurrency, but can be expensive at high fan-out.

### 9.2 With Virtual Threads

Modern model:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<HttpResponse<String>> future = executor.submit(() ->
        client.send(request, BodyHandlers.ofString())
    );
}
```

This makes blocking code more scalable and readable. But the outbound system still needs:

- concurrency limits
- deadline
- connection limits
- retry budget
- rate limit
- memory limit

Bad virtual-thread design:

```java
for (Case c : oneMillionCases) {
    Thread.startVirtualThread(() -> callRemote(c));
}
```

This can overload:

- your client process
- DNS
- remote service
- load balancer
- connection pool
- file descriptors
- rate limit

Better:

```java
Semaphore permits = new Semaphore(100);

try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Case c : cases) {
        executor.submit(() -> {
            permits.acquire();
            try {
                callRemote(c);
            } finally {
                permits.release();
            }
        });
    }
}
```

Virtual threads reduce the cost of waiting. They do not remove the need for bulkheads.

---

## 10. Async API: `sendAsync()`

```java
CompletableFuture<HttpResponse<String>> future = client.sendAsync(
    request,
    BodyHandlers.ofString()
);
```

The async API returns immediately.

### 10.1 Async Does Not Mean Unlimited

Bad:

```java
List<CompletableFuture<HttpResponse<String>>> futures = ids.stream()
    .map(id -> client.sendAsync(buildRequest(id), BodyHandlers.ofString()))
    .toList();
```

If `ids` has 100,000 entries, you may create 100,000 in-flight requests or queued tasks. That is not backpressure. That is an outage generator.

Better: bound concurrency.

A simple pattern:

```java
public final class AsyncLimiter {
    private final Semaphore semaphore;

    public AsyncLimiter(int maxInFlight) {
        this.semaphore = new Semaphore(maxInFlight);
    }

    public <T> CompletableFuture<T> submit(Supplier<CompletableFuture<T>> operation) {
        try {
            semaphore.acquire();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return CompletableFuture.failedFuture(e);
        }

        CompletableFuture<T> future;
        try {
            future = operation.get();
        } catch (Throwable t) {
            semaphore.release();
            return CompletableFuture.failedFuture(t);
        }

        return future.whenComplete((result, error) -> semaphore.release());
    }
}
```

Usage:

```java
AsyncLimiter limiter = new AsyncLimiter(100);

CompletableFuture<HttpResponse<String>> future = limiter.submit(() ->
    client.sendAsync(request, BodyHandlers.ofString())
);
```

### 10.2 Completion Stage Error Handling

```java
client.sendAsync(request, BodyHandlers.ofString())
    .thenApply(response -> {
        if (response.statusCode() >= 400) {
            throw new RemoteHttpException(response.statusCode(), response.body());
        }
        return response.body();
    })
    .exceptionally(error -> {
        // map timeout, cancellation, network errors, decoding errors
        throw new CompletionException(mapError(error));
    });
```

Be careful with `exceptionally`: it can swallow failure and return fallback values accidentally.

### 10.3 Cancellation

```java
CompletableFuture<HttpResponse<String>> future = client.sendAsync(
    request,
    BodyHandlers.ofString()
);

future.cancel(true);
```

Cancellation matters because if the caller no longer needs the result, continuing to consume network/body resources is wasteful and sometimes harmful.

But cancellation is not a business undo. If the server already received and processed the request, cancelling the client future does not roll back remote side effects.

Therefore:

- cancellation controls local waiting/resource consumption
- deadline controls caller patience
- idempotency controls retry/duplicate side effects
- remote operation design controls actual business consistency

---

## 11. Timeout Engineering with JDK `HttpClient`

There are at least three timeout concepts in a normal JDK HTTP call:

```text
client connect timeout
request timeout
your higher-level deadline / SLA budget
```

### 11.1 Connect Timeout

Configured on client:

```java
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(2))
    .build();
```

### 11.2 Request Timeout

Configured on request:

```java
HttpRequest request = HttpRequest.newBuilder(uri)
    .timeout(Duration.ofSeconds(5))
    .GET()
    .build();
```

### 11.3 Higher-Level Deadline

Your user journey or batch unit may have a total budget:

```text
incoming request SLA: 2 seconds
business logic budget: 300 ms
DB budget: 500 ms
remote service budget: 700 ms
response rendering budget: 200 ms
buffer: 300 ms
```

A request timeout larger than the parent SLA is a bug.

### 11.4 Timeout Exception Handling

You may see exceptions such as:

```java
java.net.http.HttpTimeoutException
java.net.http.HttpConnectTimeoutException
java.net.ConnectException
java.net.UnknownHostException
java.io.IOException
java.lang.InterruptedException
```

The top-tier habit is to map them to a stable internal taxonomy:

```text
REMOTE_DNS_FAILURE
REMOTE_CONNECT_TIMEOUT
REMOTE_CONNECT_REFUSED
REMOTE_TLS_FAILURE
REMOTE_REQUEST_TIMEOUT
REMOTE_RESPONSE_TOO_LARGE
REMOTE_PROTOCOL_ERROR
REMOTE_CANCELLED
REMOTE_4XX_CONTRACT_FAILURE
REMOTE_5XX_DEPENDENCY_FAILURE
```

Do not leak raw low-level exception classes into domain service code.

---

## 12. Status Code Handling

Bad:

```java
String body = client.send(request, BodyHandlers.ofString()).body();
```

This ignores whether the response is 200, 400, 409, 429, 500, or 503.

Better:

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());

return switch (response.statusCode()) {
    case 200 -> parseSuccess(response.body());
    case 404 -> throw new RemoteNotFoundException();
    case 409 -> throw new RemoteConflictException(response.body());
    case 429 -> throw new RemoteRateLimitedException(retryAfter(response.headers()));
    case 503 -> throw new RemoteUnavailableException();
    default -> {
        if (response.statusCode() >= 500) {
            throw new RemoteServerException(response.statusCode(), safeSnippet(response.body()));
        }
        if (response.statusCode() >= 400) {
            throw new RemoteClientException(response.statusCode(), safeSnippet(response.body()));
        }
        throw new RemoteProtocolException("Unexpected status: " + response.statusCode());
    }
};
```

### 12.1 Status Code as Contract

A production client should define allowed statuses per operation.

Example:

```text
GET /cases/{id}
Allowed:
- 200: found
- 304: not modified if conditional GET used
- 404: not found
- 429: rate limited
- 503: service unavailable
Unexpected:
- 201
- 204 if body required
- 302 unless redirect explicitly allowed
- 500 with HTML body instead of problem+json
```

Unexpected status should be observable.

---

## 13. Error Body Handling

Many systems accidentally parse success and error bodies the same way.

Bad:

```java
CaseDto dto = objectMapper.readValue(response.body(), CaseDto.class);
```

If the remote service returns:

```json
{
  "type": "https://example.com/errors/validation",
  "title": "Validation failed",
  "status": 422
}
```

then parsing it as `CaseDto` creates confusing downstream errors.

Better:

```java
if (isSuccess(response.statusCode())) {
    return parseSuccess(response.body());
}

RemoteProblem problem = tryParseProblem(response.body());
throw mapProblem(response.statusCode(), problem);
```

### 13.1 Bound Error Bodies

Error bodies can be huge. Never log or store entire error bodies blindly.

Use bounded snippets:

```java
static String safeSnippet(String body) {
    if (body == null) return "";
    int max = Math.min(body.length(), 2048);
    return body.substring(0, max);
}
```

Also redact known sensitive fields.

---

## 14. TLS and SSL Configuration

Basic custom SSL context:

```java
SSLContext sslContext = SSLContext.getInstance("TLS");
sslContext.init(keyManagers, trustManagers, secureRandom);

HttpClient client = HttpClient.newBuilder()
    .sslContext(sslContext)
    .build();
```

Use cases:

- custom trust store
- mTLS client certificate
- test environment certificates
- private CA

### 14.1 Hostname Verification

Do not disable hostname verification in production.

Bad pattern:

```text
trust all certificates
skip hostname verification
```

This defeats HTTPS identity guarantees.

### 14.2 ALPN

HTTP/2 over TLS normally depends on ALPN negotiation. If ALPN fails, the client may use HTTP/1.1 depending on server/proxy behavior.

Operational implication:

- log negotiated protocol when debugging
- check `response.version()`
- verify gateway supports desired version
- beware mTLS termination at proxies

### 14.3 Certificate Rotation

A production client must tolerate certificate rotation when the new chain is trusted. Problems usually happen when:

- truststore is stale
- intermediate certificate is missing
- hostname/SAN mismatch
- wrong SNI behavior
- mTLS client cert expires

The HTTP client code should not hardcode certificate assumptions. Certificate management belongs in deployment/runtime configuration.

---

## 15. Proxy Configuration

```java
ProxySelector proxySelector = ProxySelector.of(
    new InetSocketAddress("proxy.internal", 8080)
);

HttpClient client = HttpClient.newBuilder()
    .proxy(proxySelector)
    .build();
```

Production considerations:

- Does the proxy support HTTPS CONNECT?
- Does it support HTTP/2 or downgrade to HTTP/1.1?
- Does it rewrite headers?
- Does it enforce idle timeout?
- Does it require authentication?
- Does proxy failure look like remote service failure?

A top-tier client wrapper distinguishes:

```text
PROXY_CONNECT_FAILURE
PROXY_AUTH_FAILURE
REMOTE_CONNECT_FAILURE
REMOTE_5XX
```

Because remediation differs.

---

## 16. Authentication

### 16.1 Static Header

```java
HttpRequest request = HttpRequest.newBuilder(uri)
    .header("Authorization", "Bearer " + token)
    .GET()
    .build();
```

### 16.2 JDK Authenticator

```java
Authenticator authenticator = new Authenticator() {
    @Override
    protected PasswordAuthentication getPasswordAuthentication() {
        return new PasswordAuthentication(username, password.toCharArray());
    }
};

HttpClient client = HttpClient.newBuilder()
    .authenticator(authenticator)
    .build();
```

Useful for certain proxy/basic auth use cases. For OAuth2/OIDC-style bearer tokens, most systems inject headers in the request builder layer.

### 16.3 Token Refresh

Do not let every request independently refresh token when 401 happens. That can create a refresh storm.

Better pattern:

```text
TokenProvider
  - cached token
  - expiry awareness
  - single-flight refresh
  - forced refresh on selected 401
  - bounded retry once after refresh
```

Pseudo-code:

```java
public final class TokenProvider {
    private final Object lock = new Object();
    private volatile Token current;

    public String getAccessToken() {
        Token token = current;
        if (token != null && !token.isNearExpiry()) {
            return token.value();
        }
        synchronized (lock) {
            token = current;
            if (token != null && !token.isNearExpiry()) {
                return token.value();
            }
            current = fetchNewToken();
            return current.value();
        }
    }
}
```

---

## 17. Cookie Handling

```java
CookieManager cookieManager = new CookieManager();

HttpClient client = HttpClient.newBuilder()
    .cookieHandler(cookieManager)
    .build();
```

For browser-like flows, cookies may matter. For service-to-service clients, be cautious.

Questions:

- Is the remote dependency session-based?
- Is cookie state shared safely across users/tenants?
- Can cookies leak between logical calls?
- Should the service client be stateless instead?

For backend service clients, bearer/mTLS/service credentials are usually easier to reason about than cookie state.

---

## 18. Connection Pooling Reality

The JDK client manages connections internally. Unlike Apache HttpClient, it does not expose the same rich public connection-pool tuning API.

This has architectural implications:

### 18.1 What You Can Control Publicly

- reuse client instance
- bound your own concurrency
- configure timeouts
- choose HTTP version preference
- manage request body and response body consumption
- choose executor
- separate clients by base dependency when necessary

### 18.2 What You Cannot Tune as Explicitly

Compared with some libraries, you do not get first-class public builder knobs such as:

```text
max total connections
max connections per route
connection TTL
idle eviction policy
pool acquisition timeout
custom DNS resolver
```

This does not mean the client is bad. It means you must decide whether your use case needs those controls.

### 18.3 When JDK `HttpClient` Fits Well

Good fit:

- moderate service-to-service HTTP calls
- internal tools
- control-plane clients
- simple JSON APIs
- systems wanting fewer dependencies
- Java 11+ baseline
- HTTP/2 support without extra library
- clear application-level concurrency limits

### 18.4 When Another Client May Fit Better

Consider Apache HttpClient, OkHttp, Reactor Netty, Netty, or framework-specific clients when you need:

- explicit pool max per route
- custom DNS resolver
- deep metrics from connection pool
- advanced retry/interceptor ecosystem
- special proxy behavior
- event-loop integration
- reactive backpressure throughout application stack
- fine-grained low-level transport knobs

---

## 19. Observability Design

A production client wrapper should emit:

### 19.1 Metrics

```text
outbound_http_requests_total{dependency,method,status_class,outcome}
outbound_http_request_duration_seconds{dependency,method,status_class}
outbound_http_in_flight{dependency}
outbound_http_timeouts_total{dependency,phase}
outbound_http_retries_total{dependency,reason}
outbound_http_response_size_bytes{dependency}
outbound_http_error_total{dependency,error_type}
```

### 19.2 Logs

Log one structured event per completed outbound call:

```json
{
  "event": "outbound_http_call",
  "dependency": "case-registry",
  "method": "GET",
  "uri_template": "/v1/cases/{caseId}",
  "status": 200,
  "duration_ms": 83,
  "attempt": 1,
  "trace_id": "...",
  "correlation_id": "...",
  "outcome": "success"
}
```

Do not log:

- full bearer token
- cookies
- full PII payload
- full large response body
- raw private keys/cert material

### 19.3 Tracing

Every outbound call should ideally create a client span:

```text
span.kind = CLIENT
http.request.method = GET
url.template = /v1/cases/{caseId}
server.address = case-registry.internal
http.response.status_code = 200
network.protocol.version = 2
```

The exact attribute names depend on your OpenTelemetry semantic convention version. The important concept is stable dependency-level visibility.

---

## 20. A Production-Grade Wrapper Pattern

Never scatter raw `HttpClient` calls throughout business code.

Bad:

```java
class CaseService {
    void approve(String caseId) {
        HttpRequest request = HttpRequest.newBuilder(...).build();
        client.send(request, BodyHandlers.ofString());
    }
}
```

Better:

```text
CaseService
  -> CaseRegistryClient
      -> HttpClient
      -> ObjectMapper
      -> TokenProvider
      -> Metrics
      -> RetryPolicy
      -> ErrorMapper
```

### 20.1 Example Client Boundary

```java
public interface CaseRegistryClient {
    CaseDetails getCase(String caseId, RequestContext context) throws RemoteDependencyException;
    SubmitResult submitCase(SubmitCaseCommand command, RequestContext context) throws RemoteDependencyException;
}
```

### 20.2 Request Context

```java
public record RequestContext(
    String correlationId,
    String traceparent,
    Instant deadline
) {}
```

### 20.3 Implementation Skeleton

```java
public final class JdkCaseRegistryClient implements CaseRegistryClient {
    private final HttpClient httpClient;
    private final URI baseUri;
    private final ObjectMapper objectMapper;
    private final TokenProvider tokenProvider;
    private final Clock clock;

    public JdkCaseRegistryClient(
            HttpClient httpClient,
            URI baseUri,
            ObjectMapper objectMapper,
            TokenProvider tokenProvider,
            Clock clock) {
        this.httpClient = Objects.requireNonNull(httpClient);
        this.baseUri = Objects.requireNonNull(baseUri);
        this.objectMapper = Objects.requireNonNull(objectMapper);
        this.tokenProvider = Objects.requireNonNull(tokenProvider);
        this.clock = Objects.requireNonNull(clock);
    }

    @Override
    public CaseDetails getCase(String caseId, RequestContext context) {
        Duration timeout = remainingBudget(context.deadline(), Duration.ofSeconds(2));
        URI uri = baseUri.resolve("/v1/cases/" + encodePathSegment(caseId));

        HttpRequest request = HttpRequest.newBuilder(uri)
            .timeout(timeout)
            .header("Accept", "application/json")
            .header("Authorization", "Bearer " + tokenProvider.getAccessToken())
            .header("X-Correlation-Id", context.correlationId())
            .GET()
            .build();

        long startNanos = System.nanoTime();
        try {
            HttpResponse<String> response = httpClient.send(request, BodyHandlers.ofString());
            return handleGetCaseResponse(response, startNanos);
        } catch (HttpTimeoutException e) {
            throw new RemoteDependencyException("case-registry", "REQUEST_TIMEOUT", e);
        } catch (IOException e) {
            throw new RemoteDependencyException("case-registry", "IO_FAILURE", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RemoteDependencyException("case-registry", "INTERRUPTED", e);
        }
    }

    private CaseDetails handleGetCaseResponse(HttpResponse<String> response, long startNanos) {
        int status = response.statusCode();
        try {
            if (status == 200) {
                return objectMapper.readValue(response.body(), CaseDetails.class);
            }
            if (status == 404) {
                throw new RemoteDependencyException("case-registry", "CASE_NOT_FOUND");
            }
            if (status == 429) {
                throw new RemoteDependencyException("case-registry", "RATE_LIMITED");
            }
            if (status >= 500) {
                throw new RemoteDependencyException("case-registry", "REMOTE_5XX");
            }
            throw new RemoteDependencyException("case-registry", "UNEXPECTED_STATUS_" + status);
        } catch (IOException e) {
            throw new RemoteDependencyException("case-registry", "DESERIALIZATION_FAILURE", e);
        } finally {
            long elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
            // record metrics/logs here
        }
    }

    private Duration remainingBudget(Instant deadline, Duration fallback) {
        if (deadline == null) return fallback;
        Duration remaining = Duration.between(clock.instant(), deadline);
        if (remaining.isNegative() || remaining.isZero()) {
            throw new RemoteDependencyException("case-registry", "DEADLINE_EXCEEDED_BEFORE_CALL");
        }
        return remaining.compareTo(fallback) < 0 ? remaining : fallback;
    }

    private static String encodePathSegment(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8)
            .replace("+", "%20");
    }
}
```

This skeleton is not perfect, but it illustrates the desired shape:

- business code does not see raw HTTP mechanics
- request timeout derives from deadline
- headers are centralized
- token provider is centralized
- error mapping is explicit
- response status is checked before parsing
- interruption is preserved
- metrics/logging hooks exist

---

## 21. Retrying with JDK `HttpClient`

JDK `HttpClient` does not give you a complete business retry policy. You build that above it.

### 21.1 Retry Only When Semantically Safe

Safe-ish candidates:

```text
GET
HEAD
PUT if idempotent by contract
DELETE if idempotent by contract
POST only with idempotency key or explicit safe command semantics
```

Retryable technical outcomes may include:

```text
connect timeout
connection reset before response
503 with Retry-After
429 with Retry-After
selected 502/504
HTTP/2 REFUSED_STREAM-like transient condition if exposed/mapped
```

Danger:

```text
client timed out after request body was sent
server may have processed the command
retry may duplicate side effect
```

### 21.2 Retry Loop Skeleton

```java
public <T> T executeWithRetry(Supplier<T> operation, RetryPolicy policy) {
    int attempt = 0;
    while (true) {
        attempt++;
        try {
            return operation.get();
        } catch (RemoteDependencyException e) {
            if (!policy.shouldRetry(e, attempt)) {
                throw e;
            }
            sleep(policy.backoff(attempt));
        }
    }
}
```

The actual retry policy must include:

- max attempts
- total deadline
- retryable error taxonomy
- idempotency check
- jitter
- retry budget metrics

---

## 22. Response Size Limits

JDK convenience body handlers do not automatically know your business maximum payload.

For untrusted or large responses, enforce limits.

Simple defensive check using headers:

```java
OptionalLong contentLength = response.headers()
    .firstValueAsLong("Content-Length");

if (contentLength.isPresent() && contentLength.getAsLong() > maxBytes) {
    throw new RemoteDependencyException("case-registry", "RESPONSE_TOO_LARGE");
}
```

But header-only checks are insufficient because:

- `Content-Length` can be absent
- response can be chunked
- remote can lie
- decompressed body can be much larger than compressed body

For strict limits, use streaming and count bytes while reading.

```java
try (InputStream in = response.body()) {
    long total = 0;
    byte[] buffer = new byte[8192];
    int read;
    while ((read = in.read(buffer)) != -1) {
        total += read;
        if (total > maxBytes) {
            throw new RemoteDependencyException("case-registry", "RESPONSE_TOO_LARGE");
        }
        // process bytes
    }
}
```

---

## 23. HTTP/2 Specific Considerations

When using:

```java
.version(HttpClient.Version.HTTP_2)
```

remember:

- multiple streams may share one TCP connection
- one bad large stream can influence others via flow control and TCP congestion
- server may send GOAWAY
- max concurrent streams can limit effective concurrency
- proxies can terminate or downgrade HTTP/2
- response version should be observed when debugging

For gRPC-like high-volume HTTP/2 needs, gRPC Java/Netty may be more appropriate than manually building HTTP/2 semantics over JDK `HttpClient`.

---

## 24. Testing Strategy

### 24.1 Unit Test the Request Builder

Verify:

- URI path
- query encoding
- headers
- method
- timeout
- body shape

### 24.2 Fake Server Tests

Use a local test server or test HTTP server to simulate:

- 200 success
- 404 not found
- 409 conflict
- 429 rate limit
- 500/503
- slow response
- connection reset
- malformed JSON
- huge body
- redirect
- TLS failure

### 24.3 Timeout Tests

You need tests for:

```text
connect timeout
request timeout
slow headers
slow body
caller cancellation
parent deadline already expired
```

### 24.4 Contract Tests

Client and server must agree on:

- path
- method
- content type
- request schema
- response schema
- error schema
- status code mapping
- idempotency behavior

---

## 25. Common Anti-Patterns

### 25.1 Creating a New Client Per Request

Wastes resources and defeats reuse.

### 25.2 No Request Timeout

Turns remote slowness into local thread/task retention.

### 25.3 `ofString()` Everywhere

Can turn unexpected large response into heap pressure.

### 25.4 Ignoring Status Code

Treats error responses as success payloads.

### 25.5 Logging Full Payloads

Leaks PII/secrets and increases log cost.

### 25.6 Unbounded `sendAsync()` Fan-Out

Async without concurrency limit is not scalable design.

### 25.7 Blind Retry of POST

Can duplicate side effects.

### 25.8 Redirects Enabled by Habit

Can hide topology problems or create security issues.

### 25.9 Shared Cookie Handler Across Tenants

Can accidentally mix sessions.

### 25.10 Interrupt Swallowing

Bad:

```java
catch (InterruptedException e) {
    throw new RuntimeException(e);
}
```

Better:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new RemoteDependencyException("INTERRUPTED", e);
}
```

---

## 26. Decision Matrix

| Requirement | JDK `HttpClient` Fit? | Reasoning |
|---|---:|---|
| Simple Java 11+ JSON service client | Strong | Built-in, clean API, HTTP/2 support |
| Low dependency footprint | Strong | No external HTTP client dependency |
| Fine-grained connection pool tuning | Medium/Weak | Public pool knobs are limited |
| Custom DNS resolver | Weak | Not a primary public extension point |
| High-volume reactive application | Medium | Possible, but Reactor Netty may integrate better |
| gRPC service communication | Weak | Use gRPC Java instead |
| Large file upload/download | Medium/Strong | Use file/input-stream body APIs carefully |
| Complex proxy/auth enterprise environment | Medium | Works for many cases, but test deeply |
| Need interceptors/middleware ecosystem | Medium/Weak | Build wrapper or use library with richer ecosystem |
| Java 8 runtime | Not applicable | Standard API starts Java 11 |

---

## 27. Production Checklist

Before approving a JDK `HttpClient` integration, ask:

```text
Client lifecycle
[ ] Is HttpClient reused?
[ ] Is it configured per dependency or per policy group?
[ ] Is executor bounded or intentionally managed?

Timeout/deadline
[ ] Is connect timeout set?
[ ] Is request timeout set?
[ ] Does request timeout respect parent deadline/SLA?
[ ] Are timeout exceptions mapped clearly?

Concurrency
[ ] Is in-flight concurrency bounded?
[ ] Is async fan-out controlled?
[ ] Are virtual threads paired with bulkheads if used?

HTTP contract
[ ] Are allowed status codes explicit?
[ ] Are success and error bodies parsed separately?
[ ] Are content type and accept headers explicit?
[ ] Is idempotency defined for retryable commands?

Body safety
[ ] Are large uploads streamed?
[ ] Are large downloads streamed to file/input stream?
[ ] Are response size limits enforced?
[ ] Are error body logs bounded/redacted?

Security
[ ] Is TLS validation enabled?
[ ] Are truststore/keystore configured properly?
[ ] Are redirects intentional?
[ ] Are headers sanitized?
[ ] Is SSRF prevented through fixed base URI / allowlist?

Observability
[ ] Are metrics emitted per dependency?
[ ] Are logs structured and redacted?
[ ] Is trace context propagated?
[ ] Is actual HTTP version observable for debugging?

Testing
[ ] Are fake-server tests present?
[ ] Are timeout tests present?
[ ] Are contract tests present?
[ ] Are retry/idempotency tests present?
```

---

## 28. Exercises

### Exercise 1 — Build a Safe GET Client

Implement a JDK `HttpClient` wrapper for:

```text
GET /v1/cases/{caseId}
```

Requirements:

- fixed base URI
- path encoding
- `Accept: application/json`
- request timeout 2 seconds
- correlation id header
- status handling for 200, 404, 429, 503
- bounded error snippet
- no raw `HttpClient` exposure to service layer

### Exercise 2 — Add Deadline Awareness

Modify the wrapper so each call receives:

```java
Instant deadline
```

The request timeout must be:

```text
min(defaultOperationTimeout, remainingDeadline)
```

If deadline is already exceeded, fail before making network call.

### Exercise 3 — Add Bounded Async Fan-Out

Given 10,000 case IDs, fetch details with max 100 in-flight requests.

Rules:

- do not create 10,000 active requests at once
- preserve result mapping by case ID
- collect failures separately
- cancel remaining work if failure rate exceeds threshold

### Exercise 4 — Large Download

Implement a download client that:

- uses `BodyHandlers.ofInputStream()` or `ofFile()`
- writes to temp file
- enforces max bytes
- verifies checksum
- atomically moves file after success
- cleans up partial file on failure

### Exercise 5 — Token Refresh Single-Flight

Implement a token provider that:

- caches token
- refreshes before expiry
- allows only one active refresh
- retries a failed request once after 401 if token was refreshed
- avoids refresh storm under high concurrency

---

## 29. Key Takeaways

1. JDK `HttpClient` is a real production option for Java 11–25, especially when you want a built-in HTTP/1.1 and HTTP/2 client.
2. Reuse `HttpClient`; do not create it per call.
3. `HttpRequest` and `HttpResponse` are immutable protocol objects; design them intentionally.
4. `BodyPublisher` and `BodyHandler` determine memory and streaming behavior.
5. `ofString()` and `ofByteArray()` are convenience tools, not universal production defaults.
6. Async calls still need concurrency limits.
7. Virtual threads make blocking-style code more scalable, but do not remove network/resource budgets.
8. Connect timeout, request timeout, and business deadline are different concepts.
9. Status code handling must be explicit per operation.
10. Production clients need wrappers: metrics, logs, traces, token handling, retries, idempotency, error mapping, and tests.

---

## 30. References

- Oracle Java SE 25 API — `HttpClient`: https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html
- Oracle Java SE 25 API — `HttpRequest.Builder`: https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpRequest.Builder.html
- Oracle Java SE 25 API — `HttpResponse.BodyHandlers`: https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpResponse.BodyHandlers.html
- OpenJDK HTTP Client Introduction: https://openjdk.org/groups/net/httpclient/intro.html
- OpenJDK HTTP Client Recipes: https://openjdk.org/groups/net/httpclient/recipes.html
- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9112 — HTTP/1.1: https://www.rfc-editor.org/rfc/rfc9112.html
- RFC 9113 — HTTP/2: https://www.rfc-editor.org/rfc/rfc9113.html

---

## 31. Series Progress

```text
Part 12 of 35 completed.
Series is not finished.
Next: Part 13 — Timeout Engineering: Connect, DNS, TLS, Request, Read, Write, Pool Acquisition, and Deadline
```
