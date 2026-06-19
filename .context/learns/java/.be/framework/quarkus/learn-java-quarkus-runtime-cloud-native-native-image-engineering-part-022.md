# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-022
# HTTP Client Engineering: REST Client Reactive, Fault Tolerance, Timeout, Retry, Circuit Breaker

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Part: `022`  
> Topik: HTTP Client Engineering: REST Client Reactive, Fault Tolerance, Timeout, Retry, Circuit Breaker  
> Status: Materi lanjutan advance — tidak mengulang dasar HTTP/REST client  
> Target: Software engineer yang mampu membangun outbound integration Quarkus yang aman, resilient, observable, dan production-grade

---

## 0. Ringkasan Besar

Banyak aplikasi enterprise gagal bukan karena endpoint inbound-nya buruk, tetapi karena outbound call-nya tidak dikontrol.

Contoh sederhana:

```java
externalApi.getCustomer(id);
```

Di production, satu baris seperti ini membawa banyak risiko:

1. External API lambat.
2. External API down.
3. DNS bermasalah.
4. TLS certificate expired.
5. Token expired.
6. 401 perlu refresh token.
7. 403 bukan retryable.
8. 429 perlu backoff.
9. 5xx perlu retry terbatas.
10. Connection pool habis.
11. Thread worker tertahan.
12. Event loop terblokir.
13. Circuit breaker terbuka.
14. Fallback perlu data stale.
15. Request duplicate karena retry.
16. Idempotency key hilang.
17. Correlation ID tidak diteruskan.
18. Response error tidak dimap dengan benar.
19. Timeout tidak konsisten.
20. Observability tidak cukup untuk incident.

Part ini membahas HTTP client engineering di Quarkus sebagai **outbound integration boundary**, bukan sekadar “cara call REST API”.

---

## 1. Mental Model: External Call Adalah Distributed Failure Boundary

Setiap HTTP call keluar service adalah batas distribusi:

```text
Your service
    |
    | network, DNS, TLS, auth, routing, timeout, remote process
    v
External service
```

Dalam satu process, function call biasanya punya failure mode yang terbatas.

Dalam distributed call, failure mode bertambah:

```text
Success
Business failure
Validation failure
Authentication failure
Authorization failure
Timeout
Connection refused
Connection reset
DNS failure
TLS handshake failure
Remote 5xx
Remote 429
Malformed response
Slow response
Partial response
Retry duplicate
```

Maka external call tidak boleh dianggap sebagai method call biasa.

Prinsip:

```text
Outbound HTTP client adalah boundary adapter.
Boundary adapter harus punya contract, timeout, retry, security, observability, dan fallback policy.
```

---

## 2. Quarkus REST Client Landscape

Quarkus modern memiliki dukungan REST Client yang terintegrasi dengan Quarkus REST.

Secara konseptual ada beberapa komponen:

1. **REST Client interface**
   - definisi typed HTTP client berbasis interface.
2. **`@RegisterRestClient`**
   - mendaftarkan interface sebagai REST client.
3. **`@RestClient` injection**
   - inject client ke service.
4. **REST Client Reactive / Quarkus REST Client**
   - non-blocking/reactive-friendly client.
5. **Client filters**
   - header, auth, correlation, logging, error handling.
6. **Response exception mapper**
   - mengubah response error menjadi exception domain/client.
7. **OIDC client filters/token propagation**
   - acquire, refresh, propagate token.
8. **SmallRye Fault Tolerance**
   - timeout, retry, circuit breaker, bulkhead, fallback, rate limit.

Quarkus documentation menyediakan guide untuk REST Client, SmallRye Fault Tolerance, dan OIDC client/token propagation. REST Client Quarkus mendukung interface-based typed clients; SmallRye Fault Tolerance menyediakan annotation seperti `@Timeout`, `@Retry`, `@CircuitBreaker`, `@Fallback`, dan `@RateLimit`; OIDC client/filter extension digunakan untuk acquire, refresh, dan propagate access token.

---

## 3. Why Typed Client Matters

Anti-pattern:

```java
HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(baseUrl + "/customers/" + id))
        .GET()
        .build();
```

Masalah:

- endpoint path tersebar,
- header tersebar,
- error handling tersebar,
- retry policy tersebar,
- response parsing tersebar,
- tidak jelas contract dengan external service,
- sulit mock/test,
- sulit observability per dependency.

Typed client:

```java
@RegisterRestClient(configKey = "customer-api")
@Path("/customers")
public interface CustomerApiClient {

    @GET
    @Path("/{id}")
    CustomerResponse getCustomer(@PathParam("id") String id);
}
```

Kelebihan:

- contract eksplisit,
- dependency jelas,
- config per client,
- filter per client,
- exception mapping per client,
- testing lebih mudah,
- observability lebih terstruktur.

Typed REST Client adalah boundary contract.

---

## 4. Menambahkan REST Client Extension

Maven:

```bash
./mvnw quarkus:add-extension -Dextensions="rest-client"
```

Untuk Jackson:

```bash
./mvnw quarkus:add-extension -Dextensions="rest-client-jackson"
```

Konseptual dependency:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-rest-client-jackson</artifactId>
</dependency>
```

Catatan:

- pilih JSON provider sesuai standar project,
- jangan campur Jackson/JSON-B tanpa alasan,
- pastikan DTO outbound/inbound tidak bergantung entity JPA.

---

## 5. Basic REST Client Interface

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

@RegisterRestClient(configKey = "customer-api")
@Path("/customers")
public interface CustomerApiClient {

    @GET
    @Path("/{id}")
    CustomerResponse getCustomer(@PathParam("id") String id);
}
```

Injection:

```java
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.rest.client.inject.RestClient;

@ApplicationScoped
public class CustomerGateway {

    private final CustomerApiClient client;

    public CustomerGateway(@RestClient CustomerApiClient client) {
        this.client = client;
    }

    public CustomerSnapshot getCustomer(String id) {
        CustomerResponse response = client.getCustomer(id);
        return CustomerSnapshot.from(response);
    }
}
```

Config:

```properties
quarkus.rest-client.customer-api.url=https://customer.example.com
```

Important invariant:

```text
Resource/service layer should not depend on external client directly.
Use gateway/adapter layer.
```

Why?

Because external API is not your domain model.

---

## 6. Gateway Pattern: Jangan Biarkan External Contract Bocor ke Domain

Anti-pattern:

```java
@ApplicationScoped
public class ApplicationService {

    @RestClient CustomerApiClient customerApi;

    public void submit(String applicantId) {
        CustomerResponse response = customerApi.getCustomer(applicantId);
        // business logic mixed with external contract
    }
}
```

Better:

```java
@ApplicationScoped
public class ApplicantIdentityGateway {

    private final CustomerApiClient client;

    public ApplicantIdentityGateway(@RestClient CustomerApiClient client) {
        this.client = client;
    }

    public ApplicantIdentity loadIdentity(ApplicantId applicantId) {
        CustomerResponse response = client.getCustomer(applicantId.value());
        return map(response);
    }

    private ApplicantIdentity map(CustomerResponse response) {
        return new ApplicantIdentity(
                response.id(),
                response.fullName(),
                response.identityStatus()
        );
    }
}
```

Domain service:

```java
@ApplicationScoped
public class ApplicationSubmissionService {

    private final ApplicantIdentityGateway identityGateway;

    public ApplicationSubmissionService(ApplicantIdentityGateway identityGateway) {
        this.identityGateway = identityGateway;
    }

    public void submit(ApplicationDraft draft) {
        ApplicantIdentity identity = identityGateway.loadIdentity(draft.applicantId());
        // domain logic uses domain model, not external DTO
    }
}
```

Invariant:

```text
External DTO stops at gateway boundary.
Domain model should not know external API response shape.
```

---

## 7. Blocking vs Reactive REST Client

Quarkus supports both synchronous/blocking and reactive-style clients.

### 7.1 Blocking Style

```java
CustomerResponse response = client.getCustomer(id);
```

Simple and readable.

Cocok untuk:

- ordinary REST services,
- JDBC/blocking stack,
- worker thread execution,
- virtual thread model,
- simpler business logic.

Risiko:

- thread blocked during network call,
- must have timeout,
- worker pool can be exhausted,
- not safe on event loop unless properly dispatched.

### 7.2 Reactive Style

```java
import io.smallrye.mutiny.Uni;

@GET
@Path("/{id}")
Uni<CustomerResponse> getCustomer(@PathParam("id") String id);
```

Service:

```java
public Uni<CustomerSnapshot> getCustomer(String id) {
    return client.getCustomer(id)
            .map(CustomerSnapshot::from);
}
```

Cocok untuk:

- reactive pipeline,
- high concurrency IO,
- non-blocking database/client stack,
- streaming,
- event-loop-friendly architecture.

Risiko:

- harder control flow,
- hidden blocking inside reactive pipeline,
- transaction semantics different,
- debugging more complex,
- retry/idempotency must be modeled carefully.

Rule:

```text
Do not return Uni just because Quarkus supports it.
Use reactive client when the surrounding architecture is reactive.
```

---

## 8. Timeout Hierarchy

Timeout adalah mekanisme resilience paling penting.

Tanpa timeout:

```text
External call bisa menggantung,
thread bisa habis,
request inbound ikut timeout,
pool penuh,
circuit breaker terlambat bekerja.
```

### 8.1 Timeout Levels

Outbound integration harus punya beberapa level timeout:

1. **Inbound request deadline**
   - berapa lama user/API caller mau menunggu.

2. **Service operation timeout**
   - batas total business use case.

3. **External client timeout**
   - batas call ke dependency.

4. **Connect timeout**
   - batas membuka koneksi.

5. **Read/socket timeout**
   - batas menunggu response.

6. **Retry budget**
   - total semua attempt tidak boleh melewati deadline.

7. **Circuit breaker timeout**
   - menentukan call dianggap gagal/lambat.

### 8.2 Timeout Budget Example

Inbound SLA:

```text
POST /submit-application must respond within 3 seconds.
```

Budget:

```text
Validation: 100ms
DB read: 300ms
External identity API: 700ms
DB write: 400ms
Outbox insert: 100ms
Buffer: 400ms
Total target: < 2s, hard timeout 3s
```

Client timeout:

```text
Identity API timeout: 700ms
Retry: maybe 1 retry only if timeout budget remains
```

Bad design:

```text
Inbound timeout = 3s
External API timeout = 10s
```

This guarantees caller times out before dependency call returns.

Invariant:

```text
Downstream timeout must be smaller than upstream deadline.
```

### 8.3 Config Example

```properties
quarkus.rest-client.customer-api.url=https://customer.example.com
quarkus.rest-client.customer-api.connect-timeout=2S
quarkus.rest-client.customer-api.read-timeout=3S
```

Use exact supported property names according to Quarkus version in implementation. The design invariant remains:

```text
Each client has explicit connect/read timeout.
No external API client should use hidden default timeout.
```

---

## 9. Retry Engineering

Retry is not a reliability feature by itself.

Retry can fix transient failure, but can also amplify incident.

### 9.1 Retryable vs Non-Retryable

| Failure | Retry? |
|---|---|
| DNS transient failure | maybe |
| Connection timeout | yes, bounded |
| Read timeout | maybe, if operation idempotent |
| HTTP 500 | yes, bounded |
| HTTP 502/503/504 | yes, bounded |
| HTTP 429 | yes, with rate-limit aware backoff |
| HTTP 401 | refresh token once, not generic retry |
| HTTP 403 | no |
| HTTP 404 | usually no |
| HTTP 409 | depends on idempotency/business |
| HTTP 422 | no |
| Bad response schema | no |
| TLS certificate error | no |
| Validation error | no |

### 9.2 Retry Must Respect Idempotency

Safe retry:

```text
GET reference data
GET by ID
PUT idempotent update
DELETE idempotent delete
POST with Idempotency-Key
```

Dangerous retry:

```text
POST create payment
POST send email
POST create application
POST submit irreversible action
```

For dangerous retry, use:

```text
Idempotency-Key
request hash
deduplication key
external provider idempotency support
outbox
```

### 9.3 SmallRye Fault Tolerance Retry

Example:

```java
import org.eclipse.microprofile.faulttolerance.Retry;
import org.eclipse.microprofile.faulttolerance.Timeout;

@ApplicationScoped
public class CustomerGateway {

    private final CustomerApiClient client;

    public CustomerGateway(@RestClient CustomerApiClient client) {
        this.client = client;
    }

    @Timeout(800)
    @Retry(maxRetries = 2, delay = 100)
    public CustomerSnapshot getCustomer(String id) {
        return CustomerSnapshot.from(client.getCustomer(id));
    }
}
```

Be careful:

```text
@Retry on a method that performs non-idempotent side effects can duplicate action.
```

### 9.4 Backoff and Jitter

Bad:

```text
retry immediately 3 times
```

If dependency is overloaded, immediate retry worsens overload.

Better:

```text
retry with exponential backoff and jitter
```

Concept:

```text
attempt 1: immediate
attempt 2: 100ms + jitter
attempt 3: 300ms + jitter
attempt 4: 900ms + jitter
```

### 9.5 Retry Budget

Do not think only in max retries.

Think total budget:

```text
connect timeout 200ms
read timeout 700ms
max retries 2
backoff total 300ms
worst case > 2s
```

If inbound SLA is 1s, this is too much.

Invariant:

```text
Retry policy must fit within end-to-end deadline.
```

---

## 10. Circuit Breaker

Circuit breaker prevents repeated calls to a dependency that is already failing.

States:

```text
CLOSED      -> normal calls allowed
OPEN        -> calls fail fast
HALF_OPEN   -> limited trial calls
```

Why useful?

If external service is down, without circuit breaker:

```text
Every request waits for timeout.
Threads/pool fill up.
User-facing latency increases.
```

With circuit breaker:

```text
After failure threshold, fail fast.
System protects itself.
Dependency gets recovery time.
```

Example:

```java
import org.eclipse.microprofile.faulttolerance.CircuitBreaker;
import org.eclipse.microprofile.faulttolerance.Timeout;

@Timeout(800)
@CircuitBreaker(
        requestVolumeThreshold = 20,
        failureRatio = 0.5,
        delay = 5000
)
public CustomerSnapshot getCustomer(String id) {
    return CustomerSnapshot.from(client.getCustomer(id));
}
```

Design questions:

1. What is failure?
2. Are 4xx counted as failure?
3. Is timeout counted?
4. How long open?
5. What fallback is returned?
6. Does circuit breaker isolate by dependency or operation?
7. Is circuit breaker state observable?
8. Does fallback risk serving unsafe stale data?

Circuit breaker is not a magic fix.

It is useful only if fail-fast behavior is safer than waiting.

---

## 11. Bulkhead

Bulkhead limits concurrency to a dependency.

Without bulkhead:

```text
All worker threads can block on slow external API.
```

With bulkhead:

```text
Only N concurrent calls allowed.
Other requests fail fast or queue bounded.
```

Example:

```java
import org.eclipse.microprofile.faulttolerance.Bulkhead;

@Bulkhead(value = 10, waitingTaskQueue = 20)
public CustomerSnapshot getCustomer(String id) {
    return CustomerSnapshot.from(client.getCustomer(id));
}
```

Interpretation:

```text
Max 10 concurrent executions.
Max 20 waiting.
Beyond that, reject/fail.
```

Bulkhead protects:

- your worker pool,
- your DB pool indirectly,
- your external dependency,
- user-facing latency.

Rule:

```text
Every slow/unreliable external dependency should have a concurrency budget.
```

---

## 12. Rate Limit

Rate limit controls how often calls happen.

It can protect:

- external API quota,
- internal service,
- expensive endpoint,
- regulatory API limit,
- paid API cost.

SmallRye Fault Tolerance includes `@RateLimit`.

Conceptual:

```java
import io.smallrye.faulttolerance.api.RateLimit;

@RateLimit(value = 100, window = 1, windowUnit = ChronoUnit.MINUTES)
public ExternalResult callExternal(...) {
    return client.call(...);
}
```

Implementation details depend on SmallRye/Quarkus version and API imports.

Important:

```text
Local rate limit is per app instance.
Distributed rate limit requires shared state such as Redis.
```

If external API says:

```text
300 requests per minute per client credential
```

And you have 6 pods, local limit 300/min per pod is wrong.

You need:

```text
global distributed rate limit <= 300/min
```

---

## 13. Fallback

Fallback gives alternative response when dependency fails.

Examples:

1. Return stale cached data.
2. Return degraded response.
3. Queue request for later.
4. Return “temporarily unavailable”.
5. Skip optional enrichment.
6. Use secondary provider.

### 13.1 Safe Fallback

Example:

```text
Address autocomplete unavailable.
Return response without suggestion.
```

### 13.2 Dangerous Fallback

Example:

```text
Permission service unavailable.
Assume user is allowed.
```

Never do this.

Security fallback:

```text
Fail closed.
```

### 13.3 Fallback with Cache

```java
@Fallback(fallbackMethod = "fallbackCustomer")
public CustomerSnapshot getCustomer(String id) {
    return CustomerSnapshot.from(client.getCustomer(id));
}

CustomerSnapshot fallbackCustomer(String id) {
    return customerCache.getStaleIfAllowed(id)
            .orElseThrow(() -> new DependencyUnavailableException("customer-api"));
}
```

Fallback must be explicit about stale tolerance.

---

## 14. HTTP Status Mapping

External API response should be translated into meaningful client/domain exceptions.

Do not leak raw HTTP status everywhere.

### 14.1 Exception Taxonomy

Create a taxonomy:

```text
ExternalAuthenticationException
ExternalAuthorizationException
ExternalNotFoundException
ExternalValidationException
ExternalRateLimitedException
ExternalTimeoutException
ExternalUnavailableException
ExternalBadResponseException
ExternalConflictException
```

### 14.2 ResponseExceptionMapper

Conceptual:

```java
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.rest.client.ext.ResponseExceptionMapper;

public class CustomerApiExceptionMapper
        implements ResponseExceptionMapper<RuntimeException> {

    @Override
    public RuntimeException toThrowable(Response response) {
        int status = response.getStatus();

        if (status == 401) {
            return new ExternalAuthenticationException("customer-api");
        }

        if (status == 403) {
            return new ExternalAuthorizationException("customer-api");
        }

        if (status == 404) {
            return new ExternalNotFoundException("customer-api");
        }

        if (status == 429) {
            return new ExternalRateLimitedException("customer-api");
        }

        if (status >= 500) {
            return new ExternalUnavailableException("customer-api", status);
        }

        return new ExternalBadResponseException("customer-api", status);
    }
}
```

Register mapper:

```java
@RegisterRestClient(configKey = "customer-api")
@RegisterProvider(CustomerApiExceptionMapper.class)
@Path("/customers")
public interface CustomerApiClient {
    ...
}
```

Important:

```text
Retry policy should retry only exceptions classified retryable.
```

---

## 15. 401 Refresh Token Strategy

401 is not the same as generic failure.

Possible causes:

- access token expired,
- wrong audience,
- wrong issuer,
- revoked token,
- clock skew,
- misconfigured client,
- downstream changed auth policy.

Naive retry:

```text
401 -> retry -> 401 -> retry -> 401
```

Bad.

Correct pattern:

```text
401 -> refresh token once -> retry once -> if still 401 fail
```

Quarkus OIDC client/filter support can acquire, refresh, and propagate tokens.

### 15.1 TokenProvider Boundary

Design:

```java
@ApplicationScoped
public class ExternalTokenProvider {

    public String getAccessToken() {
        // use quarkus-oidc-client or configured auth flow
        throw new UnsupportedOperationException();
    }

    public String refreshAccessToken() {
        // refresh or force reload token
        throw new UnsupportedOperationException();
    }
}
```

### 15.2 Retry Once on 401

Pseudo-flow:

```text
1. Send request with token.
2. If 401:
   a. refresh token once
   b. retry same request once
3. If still 401:
   fail as authentication/configuration issue
```

Do not refresh token on every request if token is still valid.

Do not share token to browser.

Do not log token.

---

## 16. 429 Rate Limit Strategy

429 means dependency says:

```text
You are calling too much.
```

Retrying immediately is disrespecting the contract.

Correct behavior:

1. Read `Retry-After` header if present.
2. Apply bounded backoff.
3. Reduce concurrency/rate.
4. Record metric.
5. Fail controlled if budget exhausted.
6. Consider queueing for async processing.
7. Avoid synchronized retries from all pods.

### 16.1 429 Policy

Example:

```text
429 retry:
- max 2 attempts
- minimum delay 250ms
- use Retry-After if <= allowed max
- add jitter
- respect total deadline
```

If external API quota is strict, use rate limiter before request, not only after 429.

### 16.2 Global Rate Limit

For multi-pod:

```text
Redis counter / token bucket
```

Key:

```text
ratelimit:{provider}:{credential}:{yyyyMMddHHmm}
```

Use atomic increment and TTL.

---

## 17. Connection Pooling and Resource Budget

HTTP client uses connections.

Without controlling connection pool:

- too many connections,
- dependency overloaded,
- local ephemeral port exhaustion,
- TLS handshakes expensive,
- pool wait time hidden,
- backpressure missing.

Client budget should consider:

```text
max concurrent calls per dependency
connection pool size
pending queue
timeout
bulkhead
rate limit
worker pool
```

Example policy:

```text
customer-api:
- connect timeout 500ms
- read timeout 1s
- max concurrent requests 20
- retry max 1
- circuit breaker after 50% failure over 20 calls
```

Rule:

```text
Outbound concurrency must be explicitly budgeted per dependency.
```

---

## 18. TLS and Trust Configuration

External HTTP client often needs TLS.

Do not disable TLS verification in production.

Bad:

```properties
trust-all=true
hostname-verification=NONE
```

This is acceptable only for local/dev troubleshooting, not production.

Production requires:

- truststore,
- hostname verification,
- certificate rotation,
- mTLS if required,
- TLS config per client,
- observability of TLS failures,
- expiry monitoring.

Quarkus TLS Registry allows named TLS configurations that components such as REST client can reference.

Conceptual:

```properties
quarkus.tls.partner-api.trust-store.p12.path=partner-truststore.p12
quarkus.tls.partner-api.trust-store.p12.password=${TRUSTSTORE_PASSWORD}

quarkus.rest-client.partner-api.tls-configuration-name=partner-api
```

Design:

```text
Each external system can have a named TLS configuration.
Do not put all trust behavior into global hacks.
```

---

## 19. Header Propagation

Outbound calls often need headers:

- Authorization,
- Correlation ID,
- Request ID,
- Tenant ID,
- User ID,
- Locale,
- Traceparent,
- Baggage,
- Idempotency-Key.

But not all inbound headers should be propagated.

Anti-pattern:

```text
Forward all headers.
```

Risks:

- leaking cookies,
- leaking internal headers,
- leaking user token to wrong dependency,
- confusing downstream,
- security issue.

Better:

```text
Explicit allowlist propagation.
```

### 19.1 Client Filter

Conceptual:

```java
import jakarta.ws.rs.client.ClientRequestContext;
import jakarta.ws.rs.client.ClientRequestFilter;
import jakarta.ws.rs.ext.Provider;

@Provider
public class CorrelationIdClientFilter implements ClientRequestFilter {

    @Override
    public void filter(ClientRequestContext requestContext) {
        String correlationId = CorrelationContext.currentId();
        requestContext.getHeaders().putSingle("X-Correlation-ID", correlationId);
    }
}
```

Register per client:

```java
@RegisterProvider(CorrelationIdClientFilter.class)
@RegisterRestClient(configKey = "customer-api")
public interface CustomerApiClient {
}
```

### 19.2 Token Propagation

Token propagation is not always correct.

Use propagation if downstream should act on behalf of same user.

Use client credentials if downstream call is service-to-service operation.

Decision:

| Scenario | Token Strategy |
|---|---|
| User requests their own data from downstream | propagate user token |
| Service sync job calls provider | client credentials |
| Backend calls internal admin API | service token with least privilege |
| API gateway to resource server | propagate token |
| Batch process | service account token |

---

## 20. Idempotency in HTTP Client

If your service calls external API with side effect, add idempotency.

Example:

```text
POST /notifications/send
Idempotency-Key: application-expired:APP123
```

Key design:

```text
{operation}:{business-id}:{attempt-scope}
```

Do not use random UUID for retry idempotency unless it is persisted and reused.

Bad:

```java
headers.put("Idempotency-Key", UUID.randomUUID().toString());
```

Each retry becomes a new operation.

Better:

```java
String key = "application-expired:" + applicationId.value();
```

Or:

```text
job-run-id + item-id + operation
```

If external API requires request hash matching, store hash.

---

## 21. Request/Response DTO Engineering

External DTO should be:

- explicit,
- versioned where useful,
- tolerant to unknown fields,
- not reused as internal domain,
- no JPA entity,
- no framework proxy,
- null behavior explicit,
- date/time format explicit,
- enum evolution handled.

### 21.1 Enum Evolution

External API may add enum:

```json
{
  "status": "PENDING_REVIEW_V2"
}
```

If your Java enum cannot parse it, call fails.

For external API, consider:

```java
public enum ExternalStatus {
    ACTIVE,
    INACTIVE,
    UNKNOWN
}
```

Or parse as string and map safely.

### 21.2 Unknown Fields

Configure JSON mapping to tolerate unknown fields if API may evolve.

But do not silently ignore fields that affect security/business.

---

## 22. Error Body Handling

External APIs often return structured error.

Example:

```json
{
  "code": "RATE_LIMITED",
  "message": "Too many requests",
  "traceId": "abc-123"
}
```

Mapper should extract:

- external code,
- external trace ID,
- retry-after,
- safe message,
- internal classification.

Do not expose raw external error to user if it contains sensitive info.

---

## 23. Observability for HTTP Client

Every external dependency should be observable.

Metrics:

```text
http_client_requests_total{client,method,path_template,status}
http_client_duration_seconds{client,method,path_template}
http_client_timeout_total{client}
http_client_retry_total{client,reason}
http_client_circuit_open_total{client}
http_client_bulkhead_rejected_total{client}
http_client_rate_limited_total{client}
http_client_auth_refresh_total{client}
http_client_connection_failure_total{client}
```

Logs:

```json
{
  "event": "external_call_failed",
  "client": "customer-api",
  "operation": "getCustomer",
  "status": 503,
  "classification": "EXTERNAL_UNAVAILABLE",
  "retryable": true,
  "attempt": 2,
  "durationMs": 742,
  "correlationId": "..."
}
```

Tracing:

```text
inbound request span
  -> domain operation span
      -> external customer-api span
```

Trace should include:

- client name,
- operation name,
- HTTP method,
- route/path template,
- status classification,
- retry attempt if modeled.

Do not tag high-cardinality raw URL IDs blindly.

Bad:

```text
path=/customers/123456789
```

Better:

```text
path_template=/customers/{id}
```

---

## 24. Logging and Sensitive Data

Never log:

- access token,
- refresh token,
- Authorization header,
- client secret,
- full PII payload,
- password,
- private key,
- session cookie.

When logging external call failure:

Good:

```json
{
  "client": "identity-api",
  "operation": "getIdentity",
  "status": 401,
  "classification": "AUTHENTICATION_FAILED",
  "correlationId": "c-123"
}
```

Bad:

```json
{
  "Authorization": "Bearer eyJ...",
  "requestBody": "{ \"nric\": \"...\" }"
}
```

Use redaction.

---

## 25. Client-Side Caching

Outbound integration often benefits from caching:

- JWKS,
- provider metadata,
- external reference data,
- lookup results,
- token response,
- expensive GET response.

But cache must respect:

- security,
- TTL,
- provider headers,
- stale tolerance,
- invalidation,
- rate limit,
- tenant/user context.

Example:

```text
GET postal lookup cached 7 days.
Token cached until expires_at - safety_margin.
JWKS cached according to provider/config.
Permission check cached 30 seconds or invalidated.
```

Do not cache external error response too long unless negative cache intentionally designed.

---

## 26. Token Management

External API auth can use:

1. Static API key.
2. OAuth2 client credentials.
3. OIDC token propagation.
4. mTLS client cert.
5. HMAC signature.
6. Custom token exchange.

### 26.1 API Key

Rules:

- store in secret manager,
- never in repo,
- never log,
- rotate,
- scope per environment,
- avoid frontend exposure.

### 26.2 Client Credentials

Use when service acts as itself.

Flow:

```text
service -> token endpoint -> access token -> external API
```

Need:

- token cache,
- refresh before expiry,
- single-flight refresh,
- 401 refresh once,
- clock skew margin.

### 26.3 Token Propagation

Use when downstream needs user context.

Risks:

- wrong audience,
- token not accepted by downstream,
- privilege propagation too broad,
- PII claims exposed,
- user token used for system operation incorrectly.

### 26.4 Token Exchange

Use when incoming token must be exchanged for downstream audience.

Better than forwarding token to dependency that should not receive original token.

---

## 27. Async Offloading: When Not to Call External API Inline

Some external calls should not happen inside user request.

Inline call is okay if:

- dependency reliable,
- latency small,
- result required immediately,
- failure can be shown to user,
- timeout fits SLA.

Async/offline is better if:

- side effect can happen later,
- dependency slow/unreliable,
- retry required,
- call is non-idempotent,
- high volume,
- user does not need immediate result,
- operation must be audited.

Example:

```text
Submit application:
- update DB synchronously
- insert notification outbox
- return success
- notification worker sends email asynchronously
```

Do not block user request on email API unless email delivery is part of transaction contract.

---

## 28. REST Client and Transactions

Avoid long transaction across external call.

Bad:

```java
@Transactional
public void approve(ApplicationId id) {
    Application app = repository.getForUpdate(id);
    externalApi.notifyApproval(app); // network call inside DB transaction
    app.approve();
}
```

Problems:

- DB lock held while waiting network,
- timeout leaves uncertain side effect,
- retry duplicates notify,
- transaction rollback cannot rollback external API.

Better:

```java
@Transactional
public void approve(ApplicationId id) {
    Application app = repository.getForUpdate(id);
    app.approve();
    outbox.insertApprovalNotification(app.id());
}
```

Publisher:

```java
public void publish() {
    ExternalEvent event = outbox.next();
    externalApi.notifyApproval(event.payload(), event.idempotencyKey());
    outbox.markSent(event.id());
}
```

Rule:

```text
External side effect should usually be outside main DB transaction,
coordinated by outbox/idempotency.
```

Exception:

- pure read external validation required before commit,
- call is fast and required,
- transaction locks minimal,
- failure mode accepted.

Even then, timeout must be strict.

---

## 29. Reactive Client and Mutiny Patterns

Reactive client returns `Uni<T>`.

Example:

```java
@GET
@Path("/{id}")
Uni<CustomerResponse> getCustomer(@PathParam("id") String id);
```

Pipeline:

```java
public Uni<CustomerSnapshot> getCustomer(String id) {
    return client.getCustomer(id)
            .onItem().transform(CustomerSnapshot::from)
            .onFailure(ExternalRateLimitedException.class)
            .retry().atMost(1)
            .onFailure()
            .transform(this::mapFailure);
}
```

### 29.1 Avoid Blocking in Reactive Pipeline

Bad:

```java
return client.getCustomer(id)
        .map(response -> repository.saveBlocking(response));
```

If repository is blocking, move to worker or use blocking architecture.

### 29.2 Thread Switching

Use thread switching deliberately.

Conceptual:

```java
return client.getCustomer(id)
        .emitOn(workerExecutor)
        .map(this::blockingTransform);
```

But do not hide slow blocking work casually.

### 29.3 Reactive Timeout

Mutiny can model timeout:

```java
return client.getCustomer(id)
        .ifNoItem().after(Duration.ofMillis(800)).fail();
```

Still coordinate with client read timeout and FT timeout.

---

## 30. Virtual Threads and REST Client

Virtual threads make blocking style cheaper.

They are useful when:

- code is naturally blocking,
- external calls are frequent,
- simplicity matters,
- libraries are blocking,
- thread-per-request model easier.

But virtual threads do not eliminate:

- external timeout need,
- connection pool limit,
- rate limit,
- circuit breaker,
- idempotency,
- downstream overload,
- TLS/DNS failure,
- DB transaction issue.

Rule:

```text
Virtual threads reduce cost of waiting.
They do not make waiting safe.
```

---

## 31. Testing Strategy

### 31.1 Unit Test Gateway Mapping

Test:

- external DTO to domain mapping,
- error classification,
- null/unknown enum,
- retry decision,
- idempotency key generation.

### 31.2 Mock External API

Use mock server/WireMock-like setup or Quarkus test utilities.

Scenarios:

- 200 success,
- 400 validation,
- 401 then success after refresh,
- 401 still failure,
- 403 no retry,
- 404 mapping,
- 409 conflict,
- 429 with Retry-After,
- 500 retry success,
- 500 retry exhausted,
- malformed JSON,
- timeout,
- connection reset.

### 31.3 Contract Test

If external API owned by another team:

- verify request schema,
- verify response schema,
- verify error schema,
- verify auth header,
- verify idempotency key,
- verify correlation header.

### 31.4 Resilience Test

Test:

- circuit breaker opens,
- fallback used,
- bulkhead rejection,
- rate limit behavior,
- timeout budget,
- retry count,
- no retry for non-idempotent call.

### 31.5 Native Image Test

Native mode can expose:

- serialization issue,
- reflection issue,
- TLS issue,
- resource file missing,
- proxy/client generation issue.

Test critical REST clients in native image if production uses native.

---

## 32. Production Configuration Template

Example:

```properties
# Base URL
quarkus.rest-client.customer-api.url=https://customer.example.com

# Timeout
quarkus.rest-client.customer-api.connect-timeout=500
quarkus.rest-client.customer-api.read-timeout=1000

# TLS
quarkus.rest-client.customer-api.tls-configuration-name=customer-api

# OIDC client
quarkus.oidc-client.customer-api.auth-server-url=https://idp.example.com/realms/prod
quarkus.oidc-client.customer-api.client-id=customer-client
quarkus.oidc-client.customer-api.credentials.secret=${CUSTOMER_CLIENT_SECRET}
```

Note:

```text
Exact property formats vary by extension and Quarkus version.
Always verify against the selected Quarkus version reference.
```

Configuration principles:

- per-client config key,
- no global magic timeout,
- secret from secure source,
- TLS config named,
- no trust-all production,
- different profiles for dev/test/prod,
- test fail if URL missing in prod.

---

## 33. Implementation Blueprint: Robust Customer Gateway

### 33.1 External DTO

```java
public record CustomerResponse(
        String id,
        String fullName,
        String status,
        String updatedAt
) {}
```

### 33.2 Domain Snapshot

```java
import java.time.Instant;

public record CustomerSnapshot(
        String customerId,
        String displayName,
        CustomerStatus status,
        Instant updatedAt
) {
    public static CustomerSnapshot from(CustomerResponse response) {
        return new CustomerSnapshot(
                response.id(),
                response.fullName(),
                CustomerStatus.fromExternal(response.status()),
                Instant.parse(response.updatedAt())
        );
    }
}
```

### 33.3 REST Client

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;
import org.eclipse.microprofile.rest.client.annotation.RegisterProvider;

@RegisterRestClient(configKey = "customer-api")
@RegisterProvider(CustomerApiExceptionMapper.class)
@RegisterProvider(CorrelationIdClientFilter.class)
@Path("/customers")
public interface CustomerApiClient {

    @GET
    @Path("/{id}")
    CustomerResponse getCustomer(@PathParam("id") String id);
}
```

### 33.4 Exception Mapper

```java
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.rest.client.ext.ResponseExceptionMapper;

public class CustomerApiExceptionMapper
        implements ResponseExceptionMapper<RuntimeException> {

    @Override
    public RuntimeException toThrowable(Response response) {
        int status = response.getStatus();

        return switch (status) {
            case 401 -> new ExternalAuthenticationException("customer-api");
            case 403 -> new ExternalAuthorizationException("customer-api");
            case 404 -> new ExternalNotFoundException("customer-api");
            case 409 -> new ExternalConflictException("customer-api");
            case 429 -> new ExternalRateLimitedException("customer-api");
            default -> {
                if (status >= 500) {
                    yield new ExternalUnavailableException("customer-api", status);
                }
                yield new ExternalBadResponseException("customer-api", status);
            }
        };
    }
}
```

### 33.5 Gateway with Fault Tolerance

```java
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.faulttolerance.Bulkhead;
import org.eclipse.microprofile.faulttolerance.CircuitBreaker;
import org.eclipse.microprofile.faulttolerance.Retry;
import org.eclipse.microprofile.faulttolerance.Timeout;
import org.eclipse.microprofile.rest.client.inject.RestClient;

@ApplicationScoped
public class CustomerGateway {

    private final CustomerApiClient client;
    private final CustomerFallbackCache fallbackCache;

    public CustomerGateway(
            @RestClient CustomerApiClient client,
            CustomerFallbackCache fallbackCache
    ) {
        this.client = client;
        this.fallbackCache = fallbackCache;
    }

    @Timeout(1000)
    @Retry(
            maxRetries = 1,
            delay = 100,
            retryOn = {
                    ExternalUnavailableException.class,
                    ExternalTimeoutException.class
            },
            abortOn = {
                    ExternalAuthenticationException.class,
                    ExternalAuthorizationException.class,
                    ExternalValidationException.class
            }
    )
    @CircuitBreaker(
            requestVolumeThreshold = 20,
            failureRatio = 0.5,
            delay = 5000
    )
    @Bulkhead(value = 10, waitingTaskQueue = 20)
    public CustomerSnapshot getCustomer(String id) {
        try {
            CustomerSnapshot snapshot = CustomerSnapshot.from(client.getCustomer(id));
            fallbackCache.put(id, snapshot);
            return snapshot;
        } catch (ExternalUnavailableException e) {
            return fallbackCache.getIfStaleAllowed(id)
                    .orElseThrow(() -> e);
        }
    }
}
```

Important:

```text
The exact FT annotation attributes and behavior should be verified
against the selected Quarkus/SmallRye version.
```

---

## 34. Case Study: OneMap External API Integration

Use case:

```text
Frontend needs postal lookup.
Token must not be exposed to browser.
External API has auth token and rate limit.
Postal code lookup can be cached.
```

### 34.1 Architecture

```text
Browser
  |
  v
Quarkus endpoint
  |
  v
PostalLookupGateway
  |
  +--> Redis cache
  |
  +--> TokenProvider
  |
  +--> OneMap REST client
```

### 34.2 Flow

```text
1. Validate postal code exactly 6 digits.
2. Normalize postal code.
3. Check Redis positive/negative cache.
4. If hit, return.
5. If miss, acquire in-flight single-flight guard.
6. Check global rate limit.
7. Get access token from token provider.
8. Call OneMap with timeout.
9. If 401, refresh token once and retry once.
10. If 429, apply Retry-After/backoff within budget.
11. If success, cache result.
12. If not found, negative cache short TTL.
13. Return internal DTO.
```

### 34.3 Resilience Policy

```text
connect timeout: 300ms
read timeout: 1000ms
retry:
  401: refresh token once
  429: bounded backoff
  5xx: max 1 retry
circuit breaker:
  open on high 5xx/timeout ratio
bulkhead:
  max concurrent external calls
rate limit:
  global Redis token bucket
fallback:
  stale cache if allowed
```

### 34.4 Invariants

```text
Token never reaches browser.
Token never appears in logs.
Postal code normalized.
Cache key versioned.
Rate limit global, not per pod only.
401 refresh only once.
429 honors provider contract.
External DTO not leaked to frontend/domain.
```

---

## 35. Case Study: Service-to-Service Internal API

Use case:

```text
Application service calls Case service to create linked case.
```

This is a side-effecting POST.

### 35.1 Dangerous Naive Design

```java
caseClient.createCase(request);
```

With retry:

```text
timeout -> retry -> duplicate case
```

### 35.2 Production Design

Use idempotency:

```text
Idempotency-Key: application:{applicationId}:create-case
```

Request:

```json
{
  "applicationId": "APP-123",
  "caseType": "APPLICATION_REVIEW"
}
```

Case service must enforce unique business key:

```text
unique(applicationId, caseType)
```

Client policy:

```text
retry only if idempotency key is present
timeout strict
409 mapped as existing case if business key matches
outbox if async acceptable
```

Invariant:

```text
Retries are allowed only because server-side idempotency exists.
```

---

## 36. Anti-Pattern Umum

### 36.1 No Timeout

Default hidden timeout is production risk.

### 36.2 Retry Everything

Retrying 400/403/validation errors wastes resources.

### 36.3 Retry Non-Idempotent POST Without Key

Can duplicate business operation.

### 36.4 External Call Inside Long DB Transaction

Holds locks while waiting for network.

### 36.5 Propagate All Headers

Leaks internal/security headers.

### 36.6 Trust-All TLS in Production

Security vulnerability.

### 36.7 Domain Uses External DTO

External schema changes break domain.

### 36.8 No Circuit Breaker for Unstable Dependency

Every request waits for known failing dependency.

### 36.9 No Bulkhead

One dependency consumes all worker capacity.

### 36.10 Local Rate Limit for Global Quota

Multi-pod quota violation.

### 36.11 Token Refresh Storm

Many requests refresh token at once.

### 36.12 Log Authorization Header

Credential leakage.

### 36.13 No Path Template in Metrics

High-cardinality metrics explosion.

### 36.14 Fallback Allows Security Decision

Fail-open vulnerability.

---

## 37. Production Checklist

### 37.1 Client Contract

- [ ] Every external API has typed client.
- [ ] External DTO does not leak into domain.
- [ ] Gateway/adapter layer exists.
- [ ] Error mapper exists.
- [ ] Status classification documented.
- [ ] Request/response schema tested.

### 37.2 Timeout

- [ ] Connect timeout configured.
- [ ] Read timeout configured.
- [ ] Operation timeout configured.
- [ ] Retry budget fits inbound SLA.
- [ ] Deadline propagation considered.

### 37.3 Retry and Idempotency

- [ ] Retryable errors defined.
- [ ] Non-retryable errors defined.
- [ ] Retry max bounded.
- [ ] Backoff/jitter used where appropriate.
- [ ] Non-idempotent call has idempotency key.
- [ ] 401 refresh once.
- [ ] 429 respects Retry-After/rate budget.

### 37.4 Isolation

- [ ] Circuit breaker configured for unstable dependency.
- [ ] Bulkhead/concurrency limit configured.
- [ ] Rate limit configured where needed.
- [ ] Connection pool budget understood.
- [ ] External call not inside long transaction.

### 37.5 Security

- [ ] TLS verification enabled.
- [ ] Truststore configured if needed.
- [ ] mTLS configured if required.
- [ ] Secrets not in repo/log.
- [ ] Token propagation vs client credentials decided.
- [ ] Authorization header redacted.
- [ ] Header propagation allowlisted.

### 37.6 Observability

- [ ] Metrics per client/operation/status.
- [ ] Timeout/retry/circuit metrics.
- [ ] Correlation ID propagated.
- [ ] Trace spans emitted.
- [ ] Logs structured and redacted.
- [ ] Dashboard and alert exist.

### 37.7 Testing

- [ ] Success test.
- [ ] 4xx mapping test.
- [ ] 5xx retry test.
- [ ] 401 refresh test.
- [ ] 429 backoff test.
- [ ] Timeout test.
- [ ] Circuit breaker test.
- [ ] Bulkhead test.
- [ ] Token redaction test.
- [ ] Native image test if needed.

---

## 38. Latihan

### Latihan 1 — Classify External API Calls

Untuk setiap call berikut, tentukan:

- inline atau async,
- retry atau tidak,
- timeout,
- idempotency key,
- fallback,
- circuit breaker,
- bulkhead,
- token strategy.

Daftar:

1. GET country list from reference service.
2. POST send email notification.
3. GET customer identity.
4. POST create payment.
5. GET postal code lookup.
6. POST create linked case.
7. GET user permission snapshot.
8. POST external audit record.
9. GET exchange rate.
10. POST submit application to external regulator.

### Latihan 2 — Build Error Taxonomy

Buat exception taxonomy untuk `PaymentGatewayClient`.

Status:

```text
400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504, timeout, malformed JSON
```

Untuk masing-masing:

- retryable?
- user-visible message?
- alert?
- fallback?
- idempotency required?

### Latihan 3 — Timeout Budget

Inbound endpoint SLA:

```text
2 seconds
```

Endpoint melakukan:

- DB lookup,
- external identity API,
- external risk API,
- DB write,
- event outbox insert.

Buat timeout budget dan retry policy yang realistis.

### Latihan 4 — 401/429 Failure Design

Design policy untuk API:

```text
External API:
- token expires every 30 minutes,
- rate limit 300/minute globally,
- returns 401 for expired token,
- returns 429 with Retry-After.
```

Aplikasi punya 6 pods.

Jawab:

- token cache di mana?
- single-flight refresh bagaimana?
- rate limit global bagaimana?
- 401 retry berapa kali?
- 429 backoff bagaimana?
- metrics apa?
- fallback apa?

---

## 39. Ringkasan Invariants

Ingat invariants berikut:

```text
External HTTP call is distributed failure boundary.
Typed client is boundary contract.
Gateway isolates external schema from domain.
Every client needs explicit timeout.
Retry without idempotency is dangerous.
Retry must fit total deadline.
Circuit breaker protects your service from known failing dependency.
Bulkhead protects capacity from one bad dependency.
429 requires rate-aware backoff, not blind retry.
401 requires token refresh once, not infinite retry.
Do not propagate all headers.
Do not log tokens.
Do not disable TLS verification in production.
External side effect should usually use outbox/idempotency.
Metrics must use path templates, not high-cardinality raw paths.
Fallback must be safe; security decisions fail closed.
```

---

## 40. Referensi Resmi yang Relevan

Referensi yang perlu dibaca saat implementasi nyata:

- Quarkus REST Client guide.
- Quarkus SmallRye Fault Tolerance guide.
- Quarkus OpenID Connect client and token propagation quickstart.
- Quarkus OIDC and OAuth2 client/filter reference.
- Quarkus TLS Registry reference.
- Quarkus REST migration guide if migrating from RESTEasy Classic/Reactive naming.
- Quarkus OpenTelemetry/Micrometer guide for client observability.
- Quarkus Native Image reference for native compatibility.

---

## 41. Kapan Seri Ini Lanjut ke Part Berikutnya

Part ini menyelesaikan HTTP client engineering untuk outbound REST integration di Quarkus.

Bagian berikutnya:

```text
Part 023 — Fault Tolerance and Resilience: SmallRye Fault Tolerance, Time Budget, Isolation
```

Di part berikutnya, fokus akan lebih general ke resilience architecture:

- timeout hierarchy lintas service,
- retry storm,
- circuit breaker tuning,
- bulkhead isolation,
- fallback taxonomy,
- rate limiting,
- load shedding,
- dependency isolation,
- graceful degradation,
- coordinated omission,
- resilience testing,
- SLO-driven failure design.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-021.md">⬅️ Caching and State: Redis, Caffeine, Infinispan, Cache Invalidation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-023.md">Fault Tolerance and Resilience: SmallRye Fault Tolerance, Time Budget, Isolation ➡️</a>
</div>
