# Strict Coding Standards: Java OkHttp

> Purpose: enforce safe, deterministic, observable, and maintainable usage of OkHttp in Java services and libraries.
>
> Scope: OkHttp 4.x/5.x, Java 11/17/21/25 projects, synchronous and asynchronous HTTP calls, interceptors, TLS, retries, streaming bodies, MockWebServer tests.
>
> This file is an overlay over:
> - `strict-coding-standards__java_http.md`
> - `strict-coding-standards__java_network.md`
> - `strict-coding-standards__java_security.md`
> - `strict-coding-standards__java_logging.md`
> - `strict-coding-standards__java_telemetry.md`

---

## 1. Non-Negotiable Rules

### MUST

1. Use one lifecycle-managed `OkHttpClient` per distinct outbound dependency profile.
2. Configure explicit connect, read, write, and full call timeouts.
3. Close every `Response` / `ResponseBody` using `try-with-resources`.
4. Treat request and response bodies as one-shot streams unless explicitly buffered.
5. Use `HttpUrl` / `Request.Builder` instead of manual URL string concatenation.
6. Use centralized client creation; do not construct clients inside business methods.
7. Enforce TLS validation and hostname verification; never install trust-all SSL.
8. Redact sensitive headers and payload fields in logging/interceptors.
9. Make retry behavior explicit and tied to idempotency.
10. Use MockWebServer or contract tests for client behavior.

### MUST NOT

1. Do not create a new `OkHttpClient` per request.
2. Do not ignore or swallow `IOException`.
3. Do not use `response.body().string()` on unbounded/large responses.
4. Do not log `Authorization`, `Cookie`, `Set-Cookie`, API keys, session IDs, access tokens, refresh tokens, or PII.
5. Do not retry unsafe `POST`/mutation calls unless an explicit idempotency key and server contract exist.
6. Do not mutate a shared `OkHttpClient` at runtime; build derived clients through `newBuilder()`.
7. Do not use an interceptor to hide business logic or persistence side effects.
8. Do not disable certificate validation, hostname verification, or TLS verification for production code.
9. Do not follow redirects for user-controlled URLs without SSRF validation.
10. Do not consume response body in an interceptor unless it is safely replaced before returning.

### RESTRICTED

Allowed only with explicit justification:

1. Custom `Dispatcher` or executor.
2. Custom `ConnectionPool`.
3. Custom `Dns` implementation.
4. Custom `Authenticator` or proxy authenticator.
5. Certificate pinning.
6. Custom TLS configuration.
7. Cache layer.
8. Application/network interceptors that rewrite requests/responses.
9. WebSocket usage.
10. HTTP/2 tuning.

---

## 2. Version and Dependency Policy

### Default Baseline

Use OkHttp 5.x for new modules unless project compatibility requires 4.x.

```kotlin
// Gradle Kotlin DSL
implementation(platform("com.squareup.okhttp3:okhttp-bom:<approved-version>"))
implementation("com.squareup.okhttp3:okhttp")
testImplementation("com.squareup.okhttp3:mockwebserver3-junit5")
```

```xml
<!-- Maven -->
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.squareup.okhttp3</groupId>
      <artifactId>okhttp-bom</artifactId>
      <version>${okhttp.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

### Rules

1. Use the OkHttp BOM when multiple OkHttp artifacts are used.
2. Pin the version through build governance, not inline ad hoc dependency declarations.
3. Do not mix incompatible OkHttp major versions in one runtime classpath.
4. Keep `mockwebserver` dependency test-scoped.
5. Do not expose OkHttp classes in public domain/application APIs unless this module is explicitly an HTTP-client infrastructure module.

---

## 3. Client Ownership

### Correct

```java
public final class PaymentGatewayHttpClient {
    private final OkHttpClient client;
    private final HttpUrl baseUrl;
    private final ObjectMapper objectMapper;

    public PaymentGatewayHttpClient(
            OkHttpClient client,
            HttpUrl baseUrl,
            ObjectMapper objectMapper
    ) {
        this.client = Objects.requireNonNull(client, "client");
        this.baseUrl = Objects.requireNonNull(baseUrl, "baseUrl");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
    }
}
```

### Incorrect

```java
public PaymentResponse pay(PaymentRequest request) {
    OkHttpClient client = new OkHttpClient(); // forbidden: per-call client
    // ...
}
```

### Rules

1. Client should be created at application startup or infrastructure composition root.
2. One client may be shared across the application if timeout, proxy, TLS, and interceptor policies are compatible.
3. If one downstream dependency needs special configuration, create a named client for that dependency.
4. Per-call variants must use `client.newBuilder()` so connection pool and dispatcher can be shared.

---

## 4. Timeout Policy

Every client must define:

1. `connectTimeout`
2. `readTimeout`
3. `writeTimeout`
4. `callTimeout`

Example:

```java
OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(Duration.ofSeconds(2))
        .writeTimeout(Duration.ofSeconds(5))
        .readTimeout(Duration.ofSeconds(10))
        .callTimeout(Duration.ofSeconds(15))
        .retryOnConnectionFailure(true)
        .build();
```

Rules:

1. `callTimeout` must be less than or equal to the caller's SLA budget.
2. Timeout values must not be copied blindly from examples.
3. For long downloads/uploads, document why read/write timeout is longer.
4. For internal service-to-service calls, default timeout must be short and explicit.
5. For async calls, timeout still applies; async does not mean infinite.

Forbidden:

```java
new OkHttpClient(); // forbidden unless a test explicitly validates defaults
```

---

## 5. Request Construction

### URL Construction

Use `HttpUrl`:

```java
HttpUrl url = baseUrl.newBuilder()
        .addPathSegment("v1")
        .addPathSegment("payments")
        .addQueryParameter("status", status.name())
        .build();
```

Forbidden:

```java
String url = baseUrl + "/v1/payments?status=" + status; // unsafe and fragile
```

Rules:

1. Path segments must use `addPathSegment`, not manual slash concatenation.
2. Query parameters must use `addQueryParameter`.
3. User-controlled URLs require SSRF allow-list validation.
4. Do not embed credentials in URLs.
5. Prefer immutable request DTO -> request mapper.

### Headers

Rules:

1. Authentication header creation must be centralized.
2. Use `header(name, value)` when replacing a singleton header.
3. Use `addHeader(name, value)` only when repeated header semantics are valid.
4. Do not forward inbound headers blindly to outbound calls.
5. Correlation headers must be allow-listed.

---

## 6. Response Handling

### Required Pattern

```java
try (Response response = client.newCall(request).execute()) {
    int status = response.code();
    ResponseBody body = response.body();

    if (status == 404) {
        return Optional.empty();
    }

    if (!response.isSuccessful()) {
        String safeBody = readBoundedBody(body, 8192);
        throw new DownstreamHttpException(status, safeBody);
    }

    if (body == null) {
        throw new DownstreamProtocolException("Missing response body");
    }

    return objectMapper.readValue(body.byteStream(), PaymentResponse.class);
}
```

Rules:

1. Always close `Response`.
2. Treat status code explicitly.
3. Do not assume successful HTTP status means valid business response.
4. Read error bodies with bounded limits.
5. Preserve enough downstream error information for troubleshooting, but redact secrets.
6. Map downstream errors into domain/application exceptions at the adapter boundary.

Forbidden:

```java
Response response = client.newCall(request).execute();
return response.body().string(); // leak + unbounded read + no status handling
```

---

## 7. Body Handling

### Request Body

Rules:

1. Set explicit content type.
2. Use streaming request bodies for large payloads.
3. Do not materialize large files into byte arrays.
4. For JSON, serialize with centralized mapper configuration.
5. For form/multipart, validate field names, filenames, content type, and size.

### Response Body

Rules:

1. For small JSON payloads, streaming parse via `byteStream()` is preferred.
2. For large downloads, stream to file using bounded buffers.
3. Do not call `.string()` more than once; body is one-shot.
4. Do not log raw body unless bounded and redacted.
5. Compression behavior must be understood before signing/checksum validation.

---

## 8. Retry and Idempotency

Rules:

1. Retry only transient failures.
2. Retry only idempotent methods by default: `GET`, `HEAD`, `PUT`, `DELETE`, `OPTIONS`, `TRACE` according to HTTP semantics.
3. `POST` retry requires explicit idempotency key and downstream contract.
4. Use bounded retry count.
5. Use jittered backoff.
6. Respect caller cancellation/deadline.
7. Never retry after a partial non-repeatable request body upload unless the body is known repeatable and server idempotency exists.

Retry must not be hidden in generic interceptors unless all call sites have the same idempotency contract.

---

## 9. Interceptor Policy

### Application Interceptors

Allowed for:

1. Correlation headers.
2. Authentication headers.
3. Metrics/tracing.
4. Safe logging/redaction.
5. Retry if policy is explicit and narrow.

Forbidden for:

1. Business workflow decisions.
2. Database writes.
3. Secret retrieval per call without cache.
4. Reading body without replacing it.
5. Retrying all requests indiscriminately.

### Network Interceptors

Allowed only when network-level behavior is required:

1. Observing redirects.
2. Observing connection-level details.
3. Low-level protocol diagnostics.

Rules:

1. `chain.proceed(request)` must normally be called exactly once.
2. If called more than once, previous response bodies must be closed.
3. Interceptor order must be intentional and documented.
4. Logging interceptor must redact sensitive values.

---

## 10. TLS and Certificate Policy

### MUST

1. Use JVM/default trust store or approved trust material.
2. Validate hostname.
3. Use modern TLS defaults unless policy requires stricter configuration.
4. Treat certificate pinning as restricted.
5. Keep TLS changes in infrastructure code only.

### MUST NOT

1. Trust all certificates.
2. Disable hostname verification.
3. Accept self-signed certificates in production without approved trust store.
4. Log TLS private keys, client cert passwords, or keystore passwords.

Forbidden:

```java
.hostnameVerifier((hostname, session) -> true) // forbidden
```

---

## 11. Authentication and Secrets

Rules:

1. Credentials must come from approved secret/config provider.
2. Token refresh must be concurrency-safe.
3. Do not refresh token independently in every failed request.
4. Do not log credentials.
5. Do not store bearer tokens in static mutable variables.
6. Authentication failures must be distinguishable from transport failures.
7. Token expiry/retry loops must be bounded.

---

## 12. Redirect and SSRF Policy

Rules:

1. Disable redirects by default for user-controlled URLs.
2. If redirects are enabled, validate every redirect target.
3. Block private, loopback, link-local, metadata-service, and internal-only address ranges unless explicitly allowed.
4. Do not let user input directly control scheme, host, port, or path to privileged internal services.
5. Resolve DNS and connection target policy must be reviewed if custom DNS is used.

---

## 13. Async Calls

Rules:

1. Async call callback must not run heavy blocking work on OkHttp dispatcher threads.
2. Convert callback result into application future/promise abstraction at adapter boundary.
3. Cancellation must cancel the underlying `Call`.
4. Errors in callback must be captured and propagated.
5. Avoid unbounded async fan-out.

Example:

```java
Call call = client.newCall(request);
CompletableFuture<ResponseDto> result = new CompletableFuture<>();

call.enqueue(new Callback() {
    @Override
    public void onFailure(Call call, IOException e) {
        result.completeExceptionally(e);
    }

    @Override
    public void onResponse(Call call, Response response) {
        try (response) {
            result.complete(parse(response));
        } catch (Exception e) {
            result.completeExceptionally(e);
        }
    }
});

result.whenComplete((ignored, throwable) -> {
    if (result.isCancelled()) {
        call.cancel();
    }
});
```

---

## 14. WebSocket Policy

WebSocket is restricted.

Allowed only when:

1. Bidirectional streaming is actually required.
2. Reconnect behavior is specified.
3. Heartbeat/ping policy is specified.
4. Backpressure/queue bound is specified.
5. Authentication refresh behavior is specified.
6. Message schema/version is specified.

Forbidden:

1. Unbounded send queue.
2. Silent reconnect loops.
3. Business-critical delivery without acknowledgement/idempotency.
4. Logging full messages containing sensitive data.

---

## 15. Caching Policy

OkHttp cache is restricted.

Rules:

1. Only enable cache for safe cacheable responses.
2. Cache directory and size must be explicit.
3. Do not cache authenticated responses unless response headers and threat model allow it.
4. Do not use client cache as application correctness mechanism.
5. Closing the cache means the client must not use it for further calls.

---

## 16. Observability

Every important outbound call must produce:

1. Downstream service name.
2. HTTP method.
3. Route/template, not raw URL with secrets.
4. Status code.
5. Duration.
6. Timeout vs connection failure vs protocol failure classification.
7. Retry count.
8. Correlation/trace ID.
9. Redacted error detail.

Forbidden:

1. High-cardinality metric labels using full URLs, user IDs, tokens, emails, or raw request IDs.
2. Logging request/response body by default.
3. Logging Authorization header.

---

## 17. Testing Rules

### Required Tests

1. Success response mapping.
2. 4xx mapping.
3. 5xx mapping.
4. Timeout behavior.
5. Retry behavior.
6. Header propagation/redaction.
7. JSON serialization/deserialization.
8. Large body behavior if streaming is supported.
9. TLS behavior if custom TLS is configured.
10. Cancellation if async is used.

### Recommended Tooling

Use MockWebServer for adapter-level tests.

Example test cases:

1. Server delays response beyond read timeout.
2. Server returns malformed JSON.
3. Server closes connection early.
4. Server returns redirect to disallowed host.
5. Server returns large error body.
6. Server returns duplicate headers.

---

## 18. Anti-Patterns

1. `new OkHttpClient()` inside every method.
2. Generic `HttpUtil.post(String url, String body)` shared by all domains.
3. Manual URL concatenation.
4. `response.body().string()` everywhere.
5. Interceptor that logs all headers and body.
6. Catching `Exception` and returning `null`.
7. Retrying all `IOException` with no idempotency model.
8. Trust-all TLS to “fix dev”.
9. Blocking heavy work in async callback.
10. Returning OkHttp `Response` from domain/application layer.

---

## 19. LLM Implementation Contract

When implementing OkHttp code, the LLM must provide:

1. Client ownership and lifecycle.
2. Timeout values and rationale.
3. Retry/idempotency policy.
4. TLS/authentication assumptions.
5. Request/response DTO mapping.
6. Body size/streaming behavior.
7. Error mapping.
8. Logging/telemetry behavior.
9. Tests with MockWebServer or equivalent.
10. Explicit statement that no trust-all TLS, unbounded body read, or per-request client creation was introduced.

---

## 20. Reviewer Checklist

- [ ] Is `OkHttpClient` shared/lifecycle-managed?
- [ ] Are all timeouts explicit?
- [ ] Is every `Response` closed?
- [ ] Is URL construction safe?
- [ ] Are redirects controlled?
- [ ] Is retry bounded and idempotency-aware?
- [ ] Are secrets redacted?
- [ ] Is TLS validation intact?
- [ ] Are interceptors narrow and ordered intentionally?
- [ ] Are large bodies streamed or bounded?
- [ ] Are metrics/logs low-cardinality and useful?
- [ ] Are tests covering failure modes?

---

## 21. Source Anchors

- OkHttp Overview and Requirements: `https://square.github.io/okhttp/`
- OkHttp Client API: `https://square.github.io/okhttp/5.x/okhttp/okhttp3/-ok-http-client/`
- OkHttp Recipes: `https://square.github.io/okhttp/recipes/`
- OkHttp Interceptors: `https://square.github.io/okhttp/features/interceptors/`
- RFC 9110 HTTP Semantics: `https://www.rfc-editor.org/rfc/rfc9110.html`
