# Strict Coding Standards: Java OpenFeign

> **Purpose**: make OpenFeign usage by LLM/code agents explicit, safe, observable, and failure-aware.
>
> This document is an overlay for:
>
> - `strict-coding-standards__java_http.md`
> - `strict-coding-standards__java_json.md`
> - `strict-coding-standards__java_security.md`
> - `strict-coding-standards__java_logging.md`
> - `strict-coding-standards__java_telemetry.md`
> - `strict-coding-standards__java_testing.md`
>
> OpenFeign binds Java interfaces to HTTP APIs using configurable contracts, clients, encoders, decoders, error decoders, interceptors, retryers, and optional Spring Cloud integration. This standard prevents LLM agents from hiding transport failure behind clean-looking declarative interfaces.

---

## 1. Scope

This standard applies to Java applications using:

- OpenFeign core
- Spring Cloud OpenFeign
- Feign with OkHttp, Apache HttpClient, Java HTTP client, or default client
- Feign encoders/decoders for JSON/XML/protobuf/text
- Feign `ErrorDecoder`, `Retryer`, `RequestInterceptor`, logger, capabilities
- Feign with load balancing, service discovery, circuit breaker, fallback, metrics, tracing

This standard does **not** allow treating Feign as magic RPC. All HTTP semantics, timeout, retry, idempotency, serialization, and security rules still apply.

---

## 2. Version And Dependency Policy

### 2.1 Baseline

For new standalone OpenFeign code:

```text
Use current stable OpenFeign artifacts under io.github.openfeign.
Pin all Feign modules explicitly or use approved dependency management.
```

For Spring applications:

```text
Use Spring Cloud OpenFeign version managed by the Spring Cloud BOM matching the Spring Boot line.
Do not override transitive Feign versions unless compatibility is verified.
```

Rules:

1. Do not mix incompatible Spring Boot, Spring Cloud, and OpenFeign versions.
2. Do not manually add random Feign modules without checking BOM alignment.
3. Do not use legacy Netflix Hystrix as a new baseline.
4. Choose one HTTP transport per project/module unless justified.
5. Prefer Apache HC5/OkHttp/approved client over JDK default client when connection pooling/TLS/proxy behavior must be controlled.

Forbidden by default:

- unpinned Feign versions
- snapshot Feign versions in production
- custom patched Feign without security review
- module-local Feign dependency override that bypasses platform BOM

---

## 3. OpenFeign Is An Outbound Adapter Boundary

A Feign interface is a remote HTTP contract.

It must not contain:

- business decisions
- fallback business logic
- persistence logic
- domain state mutation
- raw security decision
- broad generic request methods

Required layering:

```text
Application Service
  -> Application-owned port
    -> Feign adapter implementation
      -> Feign API interface
        -> Remote HTTP API
```

Allowed direct injection only when the project standard explicitly treats Feign interface as the port.

Forbidden:

```java
@Service
class CaseApprovalService {
    private final PartnerFeignClient partnerClient; // transport leaked into application logic
}
```

Preferred:

```java
interface PartnerScreeningPort {
    ScreeningResult screen(ScreeningCommand command);
}

final class FeignPartnerScreeningAdapter implements PartnerScreeningPort {
    private final PartnerScreeningFeignApi api;
}
```

---

## 4. Client Interface Design

### 4.1 Naming

Allowed:

```java
interface PaymentProviderFeignApi
interface CaseRegistryFeignApi
interface NotificationGatewayFeignApi
```

Forbidden:

```java
interface FeignClient
interface ApiClient
interface ServiceClient
```

Spring Cloud naming:

```java
@FeignClient(
    name = "case-registry",
    contextId = "caseRegistryClient",
    url = "${clients.case-registry.base-url}",
    configuration = CaseRegistryFeignConfiguration.class
)
interface CaseRegistryFeignApi { }
```

Rules:

1. `name` must be stable and meaningful.
2. `contextId` is required when multiple clients use the same service name or custom config.
3. `url` must come from configuration, not hardcoded in interface unless test/demo.
4. Interface must not be shared as both server controller contract and client contract unless explicitly approved.

### 4.2 Method Design

Each method must declare:

- HTTP method
- path template
- typed path variables
- typed query parameters
- typed request body
- typed response body
- expected status handling outside or via decoder

Forbidden:

```java
@RequestLine("{method} {path}")
Response call(@Param("method") String method, @Param("path") String path);
```

Allowed:

```java
@RequestLine("GET /customers/{customerId}")
CustomerResponse getCustomer(@Param("customerId") String customerId);
```

For Spring Cloud OpenFeign:

```java
@GetMapping("/customers/{customerId}")
CustomerResponse getCustomer(@PathVariable("customerId") String customerId);
```

---

## 5. Contract Policy

OpenFeign can use different contracts:

- default Feign annotations (`@RequestLine`, `@Param`, `@Headers`)
- Spring MVC annotations via Spring Cloud OpenFeign
- JAX-RS contract if configured

Rules:

1. A module must use one contract style consistently.
2. Do not mix Feign default annotations and Spring MVC annotations in the same interface unless explicitly supported and tested.
3. Do not infer parameter names from bytecode unless compiler `-parameters` is guaranteed.
4. Always specify annotation names explicitly.

Forbidden:

```java
@GetMapping("/customers/{id}")
CustomerResponse getCustomer(@PathVariable String id); // name inferred, fragile
```

Allowed:

```java
@GetMapping("/customers/{id}")
CustomerResponse getCustomer(@PathVariable("id") String id);
```

---

## 6. HTTP Semantics

### 6.1 Safe Methods

`GET` must not mutate remote state.

Forbidden:

```java
@GetMapping("/cases/{id}/approve")
void approve(@PathVariable("id") String id);
```

Allowed:

```java
@PostMapping("/cases/{id}/approval")
ApprovalResponse approve(@PathVariable("id") String id, @RequestBody ApprovalRequest request);
```

### 6.2 Idempotency And Retry

Retry policy must be based on idempotency.

| Operation            |                         Retry Default | Requirement               |
| -------------------- | ------------------------------------: | ------------------------- |
| GET lookup           |                               allowed | transient errors only     |
| PUT replace          |                 allowed if idempotent | request identity clear    |
| DELETE               | allowed if remote contract idempotent | 404 policy explicit       |
| POST create/action   |                  forbidden by default | idempotency key required  |
| PATCH partial update |                  forbidden by default | explicit duplicate safety |

Do not configure global retryer that retries every method.

---

## 7. Encoder And Decoder Policy

### 7.1 Explicit Encoder/Decoder

Every Feign client must have explicit encoder/decoder configuration, either provided by framework defaults or client-specific configuration.

Rules:

1. JSON encoder/decoder must use centralized object mapper/config.
2. Error decoder must not rely on normal decoder by accident.
3. Empty/no-body responses must be handled explicitly.
4. Large streaming responses must not be decoded into memory.
5. DTOs must be separate from domain/entity classes.

Standalone OpenFeign:

```java
GitHub api = Feign.builder()
    .encoder(new JacksonEncoder(objectMapper))
    .decoder(new JacksonDecoder(objectMapper))
    .errorDecoder(new PartnerErrorDecoder(objectMapper))
    .target(GitHub.class, baseUrl);
```

Spring Cloud OpenFeign:

```java
class PartnerFeignConfiguration {
    @Bean
    ErrorDecoder partnerErrorDecoder(ObjectMapper mapper) {
        return new PartnerErrorDecoder(mapper);
    }
}
```

### 7.2 DTO Boundary

Forbidden:

```java
@PostMapping("/customers")
Customer create(@RequestBody Customer domainEntity);
```

Allowed:

```java
@PostMapping("/customers")
CreateCustomerResponse create(@RequestBody CreateCustomerRequest request);
```

Rules:

- DTOs live in adapter/client package.
- DTOs must model wire contract, not domain behavior.
- DTOs must have explicit null/unknown/enum/date/number policy.
- DTOs must redact sensitive fields in logs.

### 7.3 `Response` Return Type

Returning raw `feign.Response` is restricted.

Allowed only when:

- streaming/download is required
- status/header handling is custom
- adapter owns closing body
- tests prove body closure and error paths

Forbidden:

```java
Response download(String id); // no ownership documented
```

Allowed with wrapper:

```java
DownloadedFile download(String id); // adapter streams and closes response
```

---

## 8. ErrorDecoder Policy

Every production Feign client must have a deliberate error mapping strategy.

Required mapping:

| Status | Mapping                                    |
| -----: | ------------------------------------------ |
|    400 | validation/client request error            |
|    401 | authentication failure, no blind retry     |
|    403 | authorization failure                      |
|    404 | explicit missing-resource policy           |
|    409 | conflict/state mismatch                    |
|    422 | domain/validation rejection                |
|    429 | rate-limited, respect retry budget/headers |
|    5xx | remote service failure                     |

Forbidden:

```java
throw new RuntimeException(response.reason());
```

Allowed:

```java
final class PartnerErrorDecoder implements ErrorDecoder {
    @Override
    public Exception decode(String methodKey, Response response) {
        ErrorPayload payload = boundedParse(response.body());
        return switch (response.status()) {
            case 404 -> new RemoteNotFoundException(methodKey, payload.code());
            case 409 -> new RemoteConflictException(methodKey, payload.code());
            case 429 -> new RemoteRateLimitedException(methodKey, retryAfter(response));
            default -> new RemoteCallException(methodKey, response.status(), payload.code());
        };
    }
}
```

Rules:

1. Error body must be bounded before parsing.
2. Error body must not be logged raw.
3. Error body can usually be read once.
4. Unknown error schema maps to generic remote error.
5. `methodKey` must be used for observability, not business decisions.

---

## 9. Timeout Policy

Every Feign client must define:

- connect timeout
- read timeout
- optional write timeout if transport supports it
- optional TLS handshake timeout if transport supports it
- overall time budget at resilience layer where needed

Spring Cloud OpenFeign example:

```yaml
spring:
  cloud:
    openfeign:
      client:
        config:
          partnerClient:
            connectTimeout: 2000
            readTimeout: 5000
```

Rules:

1. Do not rely on framework defaults.
2. Timeout must fit caller SLO.
3. Timeout must be shorter than upstream gateway/request timeout where applicable.
4. Timeout must be coordinated with retry and circuit breaker budget.
5. Infinite timeout is forbidden.

---

## 10. Retry Policy

### 10.1 Retryer

Feign `Retryer` is restricted.

Allowed only when:

- retryable exceptions/statuses are defined
- idempotency is proven
- max attempts are bounded
- backoff and jitter are configured
- retry budget does not exceed caller timeout/SLO
- metrics count attempts

Forbidden:

```java
Retryer retryer = Retryer.Default(); // without operation-level policy
```

Forbidden:

```java
Retryer.NEVER_RETRY // blindly set globally when remote transient failures are expected and documented
```

Either extreme requires justification. Prefer explicit per-client policy.

### 10.2 Retry-After

When remote returns `429` or `503` with `Retry-After`, the client must either:

- honor it within max retry budget, or
- surface rate-limit exception to caller.

Do not sleep unboundedly inside request thread.

---

## 11. Circuit Breaker And Fallback

### 11.1 Circuit Breaker

Circuit breaker is allowed only with:

- failure classification
- timeout integration
- metrics
- alerting
- documented fallback/no-fallback decision

Spring Cloud OpenFeign may wrap methods with Spring Cloud CircuitBreaker when enabled. This must not be accidental.

### 11.2 Fallback

Fallback is restricted.

Allowed fallback cases:

- cache-only read where stale data is acceptable
- optional non-critical enrichment
- default empty feature flag result when explicitly safe

Forbidden fallback cases:

- payment confirmation
- authorization check
- identity verification
- regulatory/enforcement state transition
- data mutation acknowledgement
- any operation where silent success corrupts state

Forbidden:

```java
class Fallback implements PaymentClient {
    public PaymentResult pay(...) {
        return PaymentResult.success(); // catastrophic
    }
}
```

Allowed:

```java
class OptionalProfileFallback implements ProfileClient {
    public Optional<Profile> getProfile(String id) {
        return Optional.empty();
    }
}
```

Only when caller behavior treats missing enrichment as non-authoritative.

---

## 12. RequestInterceptor Policy

Interceptors are allowed for cross-cutting transport concerns only:

- authentication
- correlation/trace headers
- tenant header if verified
- idempotency key injection when operation supports it
- user-agent/client version

Forbidden in interceptors:

- business decisions
- database access
- remote calls
- blocking token refresh without synchronization/timeout
- logging full payload
- mutating request target from user input

Auth interceptor rules:

1. Must not log secrets.
2. Token refresh must be concurrency-safe.
3. Token refresh failure must fail closed.
4. Credentials must come from approved secret source.

---

## 13. Headers, Query, Path, And URI

### 13.1 Path Variables

Rules:

- names must be explicit
- validate/normalize path values before call
- do not pass path fragments
- do not disable encoding without review

### 13.2 Query Parameters

Rules:

- model query parameters as typed method parameters or request object
- do not pass arbitrary query maps unless allow-listed
- pagination must be explicit and bounded

Restricted:

```java
@QueryMap Map<String, Object> params
```

Allowed only with allow-list and tests.

### 13.3 Dynamic Target URI

Feign supports dynamic host via URI parameter in some contracts. This is forbidden by default.

Allowed only with SSRF controls:

- scheme allow-list
- host allow-list
- port allow-list
- private/link-local/metadata address block
- redirect revalidation
- test coverage

---

## 14. Logging Policy

Feign logging must be safe.

Rules:

1. `Logger.Level.FULL` is forbidden in production unless approved with redaction.
2. Do not log Authorization/Cookie/API key headers.
3. Do not log full request/response body by default.
4. Log path template, not full URL with sensitive query.
5. Log failure class and status code.

Allowed production fields:

```text
remote_service
client_name
method_key
http_method
path_template
status
latency_ms
attempt
failure_class
trace_id
correlation_id
```

Forbidden:

```text
password
access_token
refresh_token
authorization
cookie
set-cookie
api_key
signed_url
raw_payload
```

---

## 15. Observability

Every production Feign client must expose:

- request count by client/method/status/failure class
- latency histogram/timer
- retry attempt count
- circuit breaker state if used
- timeout count
- rate-limit count
- remote dependency name

Spring Cloud OpenFeign supports Micrometer observation/capability when configured. If the project uses OpenTelemetry, trace context propagation must be verified.

Cardinality rules:

- use path template, not raw path
- do not tag by user ID/order ID/request ID
- do not tag by full exception message

---

## 16. Transport Client Policy

Feign transport must be explicit in production.

Allowed:

- Apache HttpClient 5
- OkHttp
- Java HTTP client, if project standard and configured
- Spring Cloud LoadBalancer client for service discovery

Rules:

1. Transport must have connection pooling policy.
2. Transport must have TLS policy.
3. Transport must have proxy policy if relevant.
4. Transport must have timeout policy.
5. Transport must be lifecycle-managed by DI container.

Forbidden:

- hidden default transport in production when timeouts/pooling/TLS are not reviewed
- creating transport per request
- trust-all TLS
- disabled hostname verification

---

## 17. Compression

Request/response compression is restricted.

Allowed only when:

- remote supports it
- content type is safe to compress
- payload size threshold is configured
- CPU overhead is acceptable
- compression does not leak secrets via side-channel in sensitive contexts

Do not enable compression globally without review.

---

## 18. Pagination And Bulk Operations

Rules:

1. No unbounded `findAll()` style remote calls.
2. Pagination parameters must be explicit.
3. Cursor pagination must preserve resume token.
4. Bulk calls must have max batch size.
5. Partial failure must be represented explicitly.

Forbidden:

```java
@GetMapping("/customers")
List<CustomerResponse> getAllCustomers();
```

Allowed:

```java
@GetMapping("/customers")
CustomerPageResponse listCustomers(
    @RequestParam("cursor") String cursor,
    @RequestParam("limit") int limit
);
```

---

## 19. File Upload And Download

### 19.1 Upload

Required:

- explicit content type
- size limit
- streaming design for large files
- filename sanitization if sent
- checksum/signature if contract requires integrity
- timeout/write timeout policy

### 19.2 Download

Required:

- do not load large response into memory
- close response body
- content-length/content-type validation
- max bytes guard
- path traversal defense if saving to disk
- checksum/signature verification where needed

---

## 20. Spring Cloud OpenFeign Rules

### 20.1 Configuration Isolation

Per-client configuration classes must not accidentally become global defaults.

Rules:

1. Put per-client config outside component scan, or avoid `@Configuration` when appropriate.
2. Use `contextId` for multiple clients with same `name`.
3. Explicitly configure encoder/decoder/error decoder/retryer/logger if deviating from defaults.
4. Do not rely on fallback being present unless circuit breaker is enabled and tested.

### 20.2 Load Balancing

When using service discovery/load balancer:

- service name must be stable
- DNS/discovery failure behavior must be tested
- client-side load balancing must not bypass security boundaries
- retries must not amplify traffic during outage

### 20.3 Primary Bean Behavior

Be aware that Spring Cloud OpenFeign may mark Feign clients as `@Primary` in fallback/circuit breaker scenarios. Do not rely on ambiguous autowiring. Use qualifiers where needed.

---

## 21. Security Rules

Forbidden by default:

- trust-all TLS
- disabled hostname verification
- user-controlled dynamic URI target
- logging request/response body containing secrets/PII
- passing API key in query string
- global `FULL` logging
- unbounded response body decode
- generic `Map<String,Object>` for security-sensitive response
- fallback that grants access or confirms mutation
- retrying non-idempotent operations without idempotency key

Required:

- credentials from approved secret manager/config source
- redaction of sensitive headers and fields
- SSRF controls for dynamic target URL
- explicit timeout/retry/circuit breaker behavior
- explicit authorization failure handling

---

## 22. Testing Standards

### 22.1 Unit Tests

Required:

- method/path/query/header mapping test
- encoder serialization test
- decoder deserialization test
- error decoder status/body tests
- timeout/retry classification test
- fallback behavior test if used
- interceptor redaction/auth header test

### 22.2 Integration Tests

Use WireMock, MockWebServer, or equivalent.

Required scenarios:

- 2xx success
- 204 no content
- 400 validation error
- 401/403 auth errors
- 404 expected missing/not found behavior
- 409 conflict
- 429 rate limit
- 5xx remote failure
- malformed body
- slow response/timeout
- connection reset
- retry idempotency behavior

### 22.3 Spring Context Tests

For Spring Cloud OpenFeign:

- verify client bean creation
- verify per-client config isolation
- verify circuit breaker/fallback if enabled
- verify Micrometer/observation if required
- verify property-based timeout config

---

## 23. Anti-Patterns

Forbidden:

```text
Generic Feign client interface
No timeout configuration
No ErrorDecoder
Returning null for non-2xx
Global retry for all methods
Global fallback returning success/default for critical operation
Logger.Level.FULL in production
Dynamic URI target from user input
@QueryMap without allow-list
Feign interface used directly as domain port without decision
Domain/entity classes used as request/response DTO
Feign config class accidentally component-scanned globally
Trust-all TLS
Blindly retrying POST
Unbounded list endpoint
Raw Response without closing ownership
```

---

## 24. LLM Implementation Protocol

Before creating or modifying a Feign client, an LLM/code agent must answer:

```text
1. Which remote service and operation is this client for?
2. Is this standalone OpenFeign or Spring Cloud OpenFeign?
3. Which contract style is used?
4. What is the HTTP method/path and idempotency classification?
5. What request/response DTOs are used?
6. Which encoder/decoder is used?
7. How are non-2xx responses mapped?
8. What timeout budget applies?
9. What retry/circuit breaker/fallback policy applies?
10. What headers/auth/correlation data are required?
11. What sensitive data must be redacted?
12. What tests prove method mapping, serialization, and failure behavior?
```

If any answer is unknown, implement the safest minimal adapter and document the open question. Do not invent fallback, retry, or DTO semantics.

---

## 25. Reviewer Checklist

A Feign change is acceptable only if:

- [ ] Version/dependency is governed by platform/BOM.
- [ ] Contract style is consistent.
- [ ] Client name/contextId/configuration are explicit.
- [ ] Base URL/service discovery target is config-driven.
- [ ] HTTP method semantics are correct.
- [ ] Idempotency/retry policy is explicit.
- [ ] Timeout is explicit.
- [ ] Encoder/decoder are explicit and tested.
- [ ] ErrorDecoder maps expected statuses.
- [ ] DTOs are not domain/entity classes.
- [ ] No unsafe dynamic URI or unbounded QueryMap exists.
- [ ] Auth/interceptor logic is safe and redacted.
- [ ] Logging avoids sensitive body/header data.
- [ ] Metrics/tracing identify remote dependency without high-cardinality tags.
- [ ] Fallback, if any, cannot corrupt business state.
- [ ] Tests cover success, failure, timeout, retry, and mapping.

---

## 26. Source Anchors

- OpenFeign official repository/readme: Java-to-HTTP client binder, custom decoder/error handling, annotation contract, encoders/decoders.
- Spring Cloud OpenFeign reference: per-client configuration, encoder/decoder/contract defaults, circuit breaker and fallback behavior, Micrometer capability.
- RFC 9110: HTTP method semantics and idempotency.
- OWASP SSRF Prevention Cheat Sheet.
- OWASP Logging Cheat Sheet.
