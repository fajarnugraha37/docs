# Strict Coding Standards: Java Retrofit

> **Purpose**: make Retrofit usage by LLM/code agents safe, explicit, testable, and production-grade.
>
> This document is an overlay for:
>
> - `strict-coding-standards__java_http.md`
> - `strict-coding-standards__java_okhttp.md`
> - `strict-coding-standards__java_json.md`
> - `strict-coding-standards__java_security.md`
> - `strict-coding-standards__java_testing.md`
>
> Retrofit is a type-safe HTTP client for Java/Kotlin that turns an HTTP API into an interface. This standard is not about convenience syntax; it is about preserving HTTP semantics, lifecycle correctness, serialization safety, and failure behavior.

---

## 1. Scope

This standard applies to Java applications using Retrofit for outbound HTTP calls, including:

- service-to-service REST/HTTP clients
- third-party API clients
- internal platform clients
- blocking Java clients using `Call<T>`
- async Java clients using `Call.enqueue`
- Retrofit with OkHttp
- Retrofit with Jackson, Gson, Moshi, scalars, protobuf, or custom converters
- Retrofit with retry, auth, metrics, tracing, and interceptors

This standard does **not** replace lower-level HTTP standards. Retrofit interface methods must still obey HTTP method, idempotency, timeout, retry, and security rules.

---

## 2. Version And Dependency Policy

### 2.1 Baseline

For new code:

```text
Preferred: Retrofit 3.x or approved current stable version
Minimum Java: project baseline, but Retrofit itself supports Java 8+
HTTP engine: OkHttp, lifecycle-managed
```

Rules:

1. Retrofit version must be pinned.
2. Converter/call-adapter versions must be aligned with Retrofit.
3. Do not mix old Retrofit 1.x APIs with Retrofit 2.x/3.x APIs.
4. Prefer a BOM if the project uses one and it is officially available/approved.
5. Do not add multiple JSON converters unless selection order is documented.
6. Do not add Retrofit only to wrap one trivial one-off call if `java.net.http.HttpClient` is already project standard.

### 2.2 Allowed Dependencies

Allowed with approval:

```gradle
implementation("com.squareup.retrofit2:retrofit:<version>")
implementation("com.squareup.retrofit2:converter-jackson:<version>")
implementation("com.squareup.okhttp3:okhttp:<version>")
```

Allowed alternatives:

- `converter-gson`
- `converter-moshi`
- `converter-scalars`
- `converter-protobuf`
- `adapter-rxjava3`, only in reactive modules

Forbidden by default:

- unpinned Retrofit/OkHttp versions
- snapshot dependencies in production modules
- adding both Gson and Jackson converters without clear method-level reason
- global custom converter that silently accepts invalid schema
- dependency added directly inside business module without dependency governance review

---

## 3. Core Design Rules

### 3.1 Retrofit Is An Adapter Boundary

A Retrofit interface is an outbound adapter contract.

It must not contain:

- business rules
- domain decisions
- fallback business logic
- security decisions
- persistence logic
- retry loop implementation
- logging of full payloads

Required layering:

```text
Application Service
  -> Port interface owned by the application
    -> Retrofit adapter implementation
      -> Retrofit API interface
        -> Remote HTTP API
```

Do not inject Retrofit API interfaces directly into domain/application services unless the project intentionally treats the remote API as the port.

Preferred:

```java
public interface CustomerRiskClient {
    RiskResult evaluate(CustomerRiskRequest request);
}

final class RetrofitCustomerRiskClient implements CustomerRiskClient {
    private final CustomerRiskApi api;

    @Override
    public RiskResult evaluate(CustomerRiskRequest request) {
        // convert, call, map transport errors, return domain-safe result
    }
}
```

Forbidden:

```java
@Service
class ApprovalService {
    private final ThirdPartyRetrofitApi api; // transport detail leaked into business service
}
```

---

## 4. Retrofit Instance Lifecycle

### 4.1 Reuse Retrofit And OkHttpClient

`Retrofit` and `OkHttpClient` must be created once per remote API/configuration and reused.

Required:

- singleton/application-scoped Retrofit client
- singleton/application-scoped OkHttpClient
- explicit base URL
- explicit timeout policy via OkHttp
- explicit converter
- explicit error mapping layer

Forbidden:

```java
Retrofit retrofit = new Retrofit.Builder().baseUrl(url).build(); // inside each method call
```

Reason:

- loses connection pooling
- duplicates dispatcher/thread resources
- inconsistent config
- hard to observe and test

### 4.2 Base URL Policy

Rules:

1. Base URL must be configuration-driven.
2. Base URL must be validated at startup.
3. Base URL must use `https` unless local/test-only.
4. Base URL must end with `/` as required by Retrofit URL resolution behavior.
5. Runtime user input must not control base URL.

Allowed:

```java
Retrofit retrofit = new Retrofit.Builder()
    .baseUrl(config.customerApiBaseUrl())
    .client(okHttpClient)
    .addConverterFactory(jacksonConverterFactory)
    .build();
```

Forbidden:

```java
@GET
Call<ResponseBody> fetch(@Url String arbitraryUrl); // SSRF risk unless explicitly allow-listed
```

`@Url` is restricted and requires SSRF review.

---

## 5. Retrofit Interface Design

### 5.1 Naming

Interface names must represent remote capability, not library detail.

Allowed:

```java
interface PaymentGatewayApi
interface IdentityProviderApi
interface DocumentArchiveApi
```

Forbidden:

```java
interface RetrofitClient
interface ApiService
interface HttpUtil
```

### 5.2 Method Naming

Method names must describe business intent or remote resource action.

Allowed:

```java
@GET("customers/{id}")
Call<CustomerResponse> getCustomer(@Path("id") String customerId);

@POST("payments")
Call<CreatePaymentResponse> createPayment(@Body CreatePaymentRequest request);
```

Forbidden:

```java
Call<Object> callApi(Object request);
Call<ResponseBody> doPost(Map<String, Object> body);
```

### 5.3 One Method = One Remote Contract

Each method must explicitly define:

- HTTP method
- relative path
- path parameters
- query parameters
- request body type
- response body type
- headers, if part of contract
- expected status family

Do not create generic transport methods that hide API contracts.

---

## 6. HTTP Semantics

Retrofit annotations must obey HTTP semantics.

### 6.1 Safe Methods

`GET` must not intentionally mutate remote state.

Forbidden:

```java
@GET("cases/{id}/approve")
Call<Void> approveCase(@Path("id") String id);
```

Allowed:

```java
@POST("cases/{id}/approval")
Call<ApprovalResponse> approveCase(@Path("id") String id, @Body ApprovalRequest request);
```

### 6.2 Idempotency

Retry policy depends on idempotency:

| Method   |                              Retry Default | Requirement                                               |
| -------- | -----------------------------------------: | --------------------------------------------------------- |
| `GET`    |                                    allowed | only for transient failures                               |
| `HEAD`   |                                    allowed | only for transient failures                               |
| `PUT`    |           allowed if request is idempotent | require idempotency semantics                             |
| `DELETE` | allowed if remote semantics are idempotent | handle 404 policy explicitly                              |
| `POST`   |                       forbidden by default | require idempotency key or proven safe duplicate behavior |
| `PATCH`  |                       forbidden by default | require explicit safe retry design                        |

For non-idempotent operations, use an idempotency key if retry is required.

---

## 7. Parameters And URL Construction

### 7.1 `@Path`

Rules:

1. Path variables must be simple values.
2. Validate path parameters before call.
3. Do not pass raw user-controlled path segments without normalization/allow-list when path has security meaning.
4. Do not disable encoding unless justified.

Forbidden:

```java
@GET("files/{path}")
Call<ResponseBody> getFile(@Path(value = "path", encoded = true) String path);
```

Allowed:

```java
@GET("documents/{documentId}")
Call<DocumentResponse> getDocument(@Path("documentId") DocumentId documentId);
```

### 7.2 `@Query`

Rules:

1. Query values must be typed.
2. Use explicit names.
3. Do not pass raw query string fragments.
4. For pagination, use explicit page/size/cursor parameters.

Forbidden:

```java
@GET("search")
Call<SearchResponse> search(@QueryMap Map<String, Object> query); // unrestricted
```

Restricted:

```java
@QueryMap Map<String, String> filters
```

Only allowed with allow-list validation.

### 7.3 `@Url`

`@Url` is forbidden by default.

Allowed only when:

- target URL is produced by trusted service, or
- URL is validated against scheme/host/port allow-list, and
- redirects are disabled or revalidated, and
- private/link-local/metadata addresses are blocked, and
- tests cover SSRF cases.

---

## 8. Request And Response DTOs

### 8.1 No Domain Object As Wire DTO

Forbidden:

```java
Call<Customer> createCustomer(@Body Customer customer); // domain leaked into wire contract
```

Allowed:

```java
Call<CreateCustomerResponse> createCustomer(@Body CreateCustomerRequest request);
```

Rules:

1. Request and response classes must be explicit DTOs.
2. DTOs must live in adapter/client package.
3. DTO fields must match remote contract, not internal domain model.
4. DTOs must not contain business methods.
5. Sensitive fields must be marked for redaction in logs.

### 8.2 Unknown And Null Policy

Each converter configuration must define:

- unknown field behavior
- null field behavior
- missing field behavior
- enum unknown value behavior
- date/time format
- number precision policy

Do not rely on converter defaults without documenting them.

---

## 9. Converter Policy

### 9.1 Converter Order Matters

Retrofit selects converters by order. Therefore:

1. Add specific converters before broad converters.
2. Do not include multiple broad JSON converters.
3. Document why each converter is registered.
4. Tests must prove serialization/deserialization behavior for critical DTOs.

Allowed:

```java
Retrofit retrofit = new Retrofit.Builder()
    .baseUrl(baseUrl)
    .client(okHttp)
    .addConverterFactory(JacksonConverterFactory.create(objectMapper))
    .build();
```

Restricted:

```java
.addConverterFactory(ScalarsConverterFactory.create())
.addConverterFactory(JacksonConverterFactory.create(objectMapper))
```

Allowed only if scalar endpoints exist and tests prove selection behavior.

### 9.2 ObjectMapper / Gson / Moshi Governance

If using Jackson:

- use centralized `ObjectMapper`
- do not mutate shared mapper after use
- configure Java Time module if date/time values exist
- define enum behavior
- disable unsafe polymorphic deserialization by default

If using Gson:

- define null policy
- define date/time adapters
- avoid raw `Map<String,Object>` parsing for business data

If using Moshi:

- prefer generated adapters where applicable
- define unknown enum behavior where needed

---

## 10. Call Execution Policy

### 10.1 Synchronous Calls

Synchronous `execute()` is allowed only in blocking execution contexts.

Required:

- timeout configured at OkHttp level
- exception mapping
- response body closed
- no blocking on event-loop/reactive thread
- no blocking inside common ForkJoinPool task without approval

Forbidden:

```java
Response<Foo> response = api.getFoo().execute();
return response.body(); // ignores status, error body, null body, resource behavior
```

Allowed:

```java
try {
    Response<FooResponse> response = api.getFoo(id).execute();
    return responseMapper.map(response);
} catch (IOException ex) {
    throw remoteFailure("customer-api", ex);
}
```

### 10.2 Asynchronous Calls

`enqueue()` is allowed when callback ownership is explicit.

Rules:

1. Callback must map success/failure consistently.
2. Callback must not swallow failure.
3. Callback must not update shared mutable state without synchronization.
4. Callback must propagate correlation/trace context if required.
5. Callback must not run heavy CPU/blocking work inline.

### 10.3 Cloning Calls

A Retrofit `Call` can be executed once. Retrying by reusing the same `Call` instance is forbidden.

Required:

```java
Call<Foo> original = api.getFoo(id);
Call<Foo> retryCall = original.clone();
```

Prefer centralized retry at OkHttp/resilience layer rather than ad-hoc cloning loops.

---

## 11. Response Handling

### 11.1 Status Handling

Every client method must define expected status handling.

Required mapping:

|  Status | Required Behavior                                   |
| ------: | --------------------------------------------------- |
|     2xx | parse body according to contract                    |
|     204 | do not require body                                 |
|     400 | validation/client error mapping                     |
| 401/403 | auth/authz error mapping; no blind retry            |
|     404 | explicit missing-resource policy                    |
|     409 | conflict/state transition policy                    |
|     422 | validation/domain rejection policy                  |
|     429 | rate-limit handling and `Retry-After` if applicable |
|     5xx | transient/permanent remote failure mapping          |

Forbidden:

```java
if (response.isSuccessful()) return response.body();
return null;
```

Allowed:

```java
if (response.isSuccessful()) {
    return requireBody(response);
}
throw errorDecoder.decode(response);
```

### 11.2 Error Body

Rules:

1. Error body may be consumed only once.
2. Error body must be bounded before logging/parsing.
3. Error body must not be logged raw.
4. Error body schema must be parsed only with explicit DTO.
5. Unknown error shape must map to generic remote error.

### 11.3 `ResponseBody`

Returning raw `ResponseBody` is restricted.

Allowed only for:

- file download
- streaming endpoint
- binary payload
- proxy-like adapter with explicit size and content-type policy

Required:

- caller owns closing body
- max size or streaming design
- content type validation
- checksum/signature validation if relevant
- no full in-memory read for large payload

---

## 12. Timeout Policy

Retrofit timeout is controlled through OkHttp.

Every Retrofit client must configure:

- connect timeout
- read timeout
- write timeout
- call timeout where supported/needed
- dispatcher limits if concurrency matters

Forbidden:

```java
new OkHttpClient(); // no timeout policy documented
```

Allowed:

```java
OkHttpClient okHttp = new OkHttpClient.Builder()
    .connectTimeout(Duration.ofSeconds(2))
    .readTimeout(Duration.ofSeconds(5))
    .writeTimeout(Duration.ofSeconds(5))
    .callTimeout(Duration.ofSeconds(8))
    .build();
```

Timeouts must be based on SLO and remote service behavior, not arbitrary values.

---

## 13. Retry, Circuit Breaker, And Rate Limit

### 13.1 Retry Rules

Retrofit methods must not implement ad-hoc retry loops.

Retry must be centralized in:

- OkHttp interceptor, or
- resilience library, or
- application adapter wrapper

Required retry metadata:

- retryable status codes/exceptions
- max attempts
- backoff strategy
- jitter
- idempotency requirement
- timeout budget
- metrics

Forbidden:

```java
while (true) {
    try { return api.call().execute().body(); }
    catch (Exception ignored) {}
}
```

### 13.2 Circuit Breaker

Circuit breaker is restricted and must have:

- failure classification
- timeout budget
- fallback policy
- metrics
- alerting
- manual/automatic recovery behavior

Fallback must not hide data integrity failure.

---

## 14. Authentication And Headers

### 14.1 Auth

Auth must be handled via interceptor or explicit request signing component.

Rules:

1. Do not pass secrets as method parameters unless the remote API contract requires it.
2. Do not log `Authorization`, `Cookie`, API key, or signed URLs.
3. Token refresh must be concurrency-safe.
4. Token refresh must avoid thundering herd.
5. Per-client credentials must be scoped to that remote system.

### 14.2 Headers

Static headers may be declared on interface only if they are part of API contract.

Allowed:

```java
@Headers("Accept: application/json")
@GET("customers/{id}")
Call<CustomerResponse> getCustomer(@Path("id") String id);
```

Dynamic headers are restricted:

```java
@Header("Authorization") String authorization
```

Prefer auth interceptor instead.

### 14.3 Correlation Headers

Propagation of correlation/trace/request IDs must be centralized and must not override inbound trusted values without policy.

---

## 15. Logging And Observability

Required telemetry for production clients:

- remote system name
- method/path template, not raw full URL with secrets
- status code
- duration
- timeout/failure classification
- retry count
- circuit breaker state if applicable
- request ID/correlation ID

Forbidden logs:

- full request body by default
- full response body by default
- Authorization/Cookie/API key
- signed URL
- PII/secret payload

OkHttp logging interceptor is forbidden at `BODY` level in production unless approved with redaction.

---

## 16. Streaming, Upload, And Download

### 16.1 Upload

For file upload:

- use streaming request body where possible
- set content type explicitly
- set content length when known
- enforce size limit
- validate filename separately from content
- do not trust client-provided MIME type alone

### 16.2 Download

For file download:

- do not read whole body into memory unless bounded and small
- stream to controlled destination
- validate content type/length
- enforce maximum bytes
- close response body
- prevent path traversal when writing file

---

## 17. Pagination

Paginated APIs must expose pagination explicitly.

Allowed:

```java
@GET("customers")
Call<CustomerPageResponse> listCustomers(
    @Query("cursor") String cursor,
    @Query("limit") int limit
);
```

Rules:

1. No unbounded list-all method.
2. Limit must have maximum.
3. Loop must have termination guard.
4. Pagination failures must be resumable if operation is long-running.

Forbidden:

```java
List<Customer> getAllCustomers(); // hides pagination and remote cost
```

---

## 18. Security Rules

Forbidden by default:

- user-controlled `@Url`
- trust-all TLS
- disabled hostname verification
- raw body logging
- unbounded response body read
- secret in query string
- token passed through public method without redaction policy
- deserializing remote data into domain entity
- generic `Map<String,Object>` for security-sensitive response
- retrying non-idempotent POST without idempotency key

Required for externally controlled URLs:

- scheme allow-list
- host allow-list
- DNS/private address checks
- redirect revalidation
- timeout
- size limit
- audit log without sensitive data

---

## 19. Testing Standards

### 19.1 Unit Tests

Required:

- interface annotation tests for critical endpoints, or MockWebServer tests
- request path/query/body serialization tests
- header behavior tests
- error mapping tests
- timeout/retry classification tests
- no-body response tests
- malformed response tests
- unknown field/null behavior tests

### 19.2 Integration Tests

Use MockWebServer or equivalent for:

- status code mapping
- error body parsing
- retry behavior
- request body format
- auth header injection
- pagination
- file upload/download
- redirect behavior

### 19.3 Contract Tests

For third-party or cross-team APIs:

- keep sample request/response fixtures
- validate DTO compatibility
- test backward-compatible schema changes
- test enum unknown handling

---

## 20. Anti-Patterns

Forbidden:

```text
Retrofit instance per request
OkHttpClient per request
Generic ApiService interface
Returning domain object directly from Retrofit DTO
Ignoring response.isSuccessful
Returning null on non-2xx
Logging full request/response body
Using @Url with user input
Using @QueryMap without allow-list
Retrying every failure
No timeout policy
No error decoder/mapper
Using ResponseBody without close ownership
Using Map<String,Object> for important payloads
Fallback that silently returns empty data
```

---

## 21. LLM Implementation Protocol

Before creating or changing a Retrofit client, an LLM/code agent must answer:

```text
1. What remote API operation is being called?
2. What is the HTTP method and path template?
3. Is the operation idempotent?
4. What are request and response DTOs?
5. What converter is used and why?
6. What timeout budget applies?
7. What retry policy applies, if any?
8. What statuses are expected and how are errors mapped?
9. What headers/auth are required?
10. What sensitive data must be redacted?
11. What tests prove request serialization and error handling?
```

If any answer is unknown, implement the smallest safe adapter and leave a documented TODO/open question rather than inventing behavior.

---

## 22. Reviewer Checklist

A Retrofit change is acceptable only if:

- [ ] Retrofit and OkHttp are lifecycle-managed and reused.
- [ ] Base URL is config-driven and validated.
- [ ] No user-controlled `@Url` unless SSRF controls exist.
- [ ] Interface methods use correct HTTP semantics.
- [ ] DTOs are explicit and separate from domain/entity classes.
- [ ] Converter is explicit and tested.
- [ ] Timeout policy is explicit.
- [ ] Retry is idempotency-aware.
- [ ] Error mapping handles non-2xx responses.
- [ ] Raw `ResponseBody` has close/size/streaming ownership.
- [ ] Sensitive headers/body fields are not logged.
- [ ] Observability includes remote name, method/path template, status, duration, failure class.
- [ ] MockWebServer/contract tests cover request and response behavior.

---

## 23. Source Anchors

- Retrofit official docs: interface-based HTTP API, annotations, converters, multipart, sync/async calls.
- Retrofit GitHub release/readme: current artifact coordinates and Java compatibility.
- OkHttp official docs: reusable client, connection pooling, timeout, interceptors.
- RFC 9110: HTTP semantics, safe/idempotent methods.
- OWASP SSRF Prevention Cheat Sheet.
- OWASP Logging Cheat Sheet.
