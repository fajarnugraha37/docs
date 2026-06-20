# OpenAPI Mastery for Java Engineers — Part 022
# SDK and Client Generation: Power, Limits, and Architecture Decisions

> Filename: `learn-openapi-mastery-for-java-engineers-part-022.md`
>
> Seri: `learn-openapi-mastery-for-java-engineers`
>
> Part: `022 / 030`
>
> Status seri: **In progress**
>
> Prasyarat langsung: Part 003, 009, 012, 013, 014, 015, 021

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya, kita sudah melihat OpenAPI sebagai kontrak, artifact pipeline, sumber testing, dan dasar governance. Sekarang kita masuk ke salah satu pemakaian paling praktis dan paling berbahaya dari OpenAPI: **client/SDK generation**.

Client generation terlihat sederhana:

```text
openapi.yaml -> generator -> Java client / TypeScript client / Python client / mobile client
```

Tetapi di sistem nyata, efeknya jauh lebih besar. Generated client bisa menjadi:

- akselerator integrasi,
- dokumentasi executable,
- boundary typing untuk consumer,
- alat standardisasi error/auth/retry,
- cara mengurangi boilerplate,
- sekaligus sumber coupling, brittle dependency, dan versioning pain.

Tujuan part ini adalah membuat Anda mampu menjawab pertanyaan-pertanyaan berikut secara arsitektural:

1. Kapan client generation layak dipakai?
2. Kapan generated SDK justru berbahaya?
3. Bagaimana generated code sebaiknya ditempatkan di aplikasi Java?
4. Apakah model hasil generate boleh dipakai sebagai domain model?
5. Bagaimana mengelola versioning SDK?
6. Bagaimana menangani enum evolution, nullable, date/time, error, retry, timeout, auth, dan observability?
7. Bagaimana membuat generated client tetap berguna tanpa menyerahkan arsitektur aplikasi kepada generator?

---

## 1. Mental Model: Generated Client Bukan Sekadar HTTP Wrapper

Banyak engineer melihat generated client seperti ini:

```text
Daripada tulis RestClient manual, generate saja dari OpenAPI.
```

Itu benar, tetapi dangkal.

Generated client sebenarnya adalah **compiled interpretation of an API contract**.

Artinya:

```text
OpenAPI contract
    ↓
Generator rules + language mapping
    ↓
Generated client API
    ↓
Consumer application code
    ↓
Runtime integration behavior
```

Setiap keputusan kecil di OpenAPI akan memengaruhi generated client:

- `operationId` menjadi nama method.
- `schema` menjadi class/interface/type.
- `required` menjadi constructor requirement, validation, atau nullability behavior.
- `nullable` menjadi boxed type, optional field, union type, atau runtime ambiguity.
- `enum` menjadi enum language-native, string union, atau class wrapper.
- `format: date-time` menjadi `OffsetDateTime`, `Instant`, `String`, atau library-specific date type.
- response code modelling memengaruhi error handling.
- security scheme memengaruhi auth injection.
- tags bisa memengaruhi grouping API classes.

Jadi generated client bukan cuma “kode hasil generate”. Ia adalah **bentuk material dari desain OpenAPI Anda**.

Jika OpenAPI buruk, generated client biasanya buruk.

Jika generated client buruk, consumer akan menyalahkan SDK, padahal akar masalah sering ada di contract.

---

## 2. Kenapa SDK Generation Menarik

SDK generation menarik karena manual HTTP client punya banyak boilerplate:

- membuat URL,
- serialize request,
- deserialize response,
- handle status code,
- inject authentication,
- manage headers,
- handle timeout,
- map error,
- retry,
- logging,
- tracing,
- pagination helper,
- upload/download,
- versioning.

Tanpa SDK, consumer biasanya menulis ini sendiri.

Dampaknya:

```text
Provider contract says one thing.
Consumer hand-written client assumes another thing.
```

Generated client mengurangi jarak itu.

### 2.1 Benefit utama

#### 1. Faster integration

Consumer tidak perlu membaca seluruh dokumentasi untuk mulai menggunakan API.

Mereka bisa langsung melihat method seperti:

```java
CaseResponse response = caseApi.getCaseById("case-123");
```

Lebih baik daripada:

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create(baseUrl + "/cases/case-123"))
    .GET()
    .header("Authorization", "Bearer " + token)
    .build();
```

#### 2. Type safety

Request dan response punya tipe eksplisit:

```java
CreateCaseRequest request = new CreateCaseRequest()
    .title("Suspected breach")
    .priority(Priority.HIGH);
```

Ini mengurangi typo field, salah format, dan salah struktur.

#### 3. Contract alignment

Jika SDK dibangun dari OpenAPI release yang sama, consumer punya artifact yang konsisten dengan contract.

```text
openapi-v1.8.0.yaml
    -> java-sdk-v1.8.0.jar
    -> typescript-sdk-v1.8.0
    -> docs-v1.8.0
```

#### 4. Better onboarding

SDK bisa menjadi dokumentasi hidup. Developer bisa explore API via IDE autocomplete.

#### 5. Standardized behavior

SDK bisa mengonsolidasikan:

- auth,
- correlation ID,
- retry,
- timeout,
- base URL,
- error mapping,
- metrics,
- tracing,
- user agent.

#### 6. Reduced duplicated integration code

Alih-alih setiap consumer menulis wrapper sendiri, provider/platform team bisa menyediakan SDK resmi.

---

## 3. Kenapa SDK Generation Berbahaya

Generated SDK juga punya sisi gelap.

### 3.1 Generated code can become architecture gravity

Begitu consumer mulai memakai generated model langsung di domain core, generated code menjadi bagian dari arsitektur internal aplikasi.

Contoh buruk:

```java
// Domain service bergantung langsung pada generated API model
public class EnforcementDecisionService {
    public DecisionResult decide(CaseResponse generatedCaseResponse) {
        // business logic here
    }
}
```

Masalah:

- perubahan API eksternal memengaruhi domain internal,
- generated field naming masuk ke business logic,
- nullable/generated quirks menyebar,
- testing domain jadi tergantung SDK,
- upgrade SDK menjadi perubahan arsitektural.

Top 1% rule:

```text
Generated SDK belongs at integration boundary, not domain core.
```

### 3.2 Generator output is not necessarily good API design

Banyak orang menganggap:

```text
Generated SDK exists -> API design is good.
```

Salah.

Generator hanya menerjemahkan contract. Ia tidak memperbaiki desain buruk.

Jika OpenAPI punya:

- operationId buruk,
- schema ambiguous,
- enum volatile,
- nullable tidak jelas,
- missing error models,
- inconsistent pagination,
- polymorphism ambigu,

maka generated SDK akan mewarisi semua masalah itu.

### 3.3 Generated SDK can hide HTTP reality

SDK yang terlalu “nyaman” kadang menyembunyikan hal penting:

- status code,
- retryability,
- rate limit,
- partial failure,
- idempotency,
- pagination continuation,
- ETag/versioning,
- correlation ID,
- response headers.

Contoh buruk:

```java
CaseResponse response = client.createCase(request);
```

Tapi caller tidak tahu:

- apakah response 201 atau 202,
- apakah operation asynchronous,
- apakah ada `Location` header,
- apakah ada idempotency key,
- apakah rate-limit header penting.

Generated SDK yang baik tidak menghapus semantic signal penting.

### 3.4 SDK versioning becomes product versioning

Begitu SDK dipakai consumer, SDK menjadi public artifact.

Perubahan kecil bisa berdampak besar:

- rename operationId -> method rename,
- schema rename -> class rename,
- enum value change -> compile/runtime issue,
- required field change -> constructor/build failure,
- nullable change -> runtime NPE,
- date type mapping change -> binary/source incompatibility.

SDK bukan artifact sampingan. SDK adalah bagian dari API product.

---

## 4. OpenAPI Generator: What It Actually Does

OpenAPI Generator pada dasarnya membaca OpenAPI document dan menghasilkan artifact berdasarkan generator target.

Contoh target:

- Java client,
- Spring server,
- TypeScript client,
- Python client,
- Go client,
- C# client,
- documentation,
- server stubs,
- mock/server scaffolding.

Mental model pipeline:

```text
OpenAPI Description
    ↓ parse
Normalized internal model
    ↓ language-specific mapping
Templates
    ↓ render
Generated source code
    ↓ compile/package
SDK artifact
```

### 4.1 Generator is template-driven

Generator tidak “memahami domain” Anda. Ia memakai rules dan templates.

Jadi hasilnya dipengaruhi oleh:

- kualitas OpenAPI,
- generator target,
- generator version,
- config options,
- custom templates,
- language ecosystem conventions.

### 4.2 Same OpenAPI, different client behavior

Satu spec bisa menghasilkan SDK yang berbeda secara signifikan.

Misalnya Java:

- `java` generator dengan `okhttp-gson`,
- `java` generator dengan `webclient`,
- `java` generator dengan `resttemplate`,
- `java` generator dengan `jersey2`,
- `spring` server generator,
- Feign-based generator variants.

Setiap library punya konsekuensi:

- blocking vs non-blocking,
- dependency footprint,
- serialization library,
- exception model,
- interceptors,
- testability,
- Spring integration,
- observability hooks.

---

## 5. Generated Java Client Options

Untuk Java engineer, pilihan HTTP stack penting karena berdampak ke runtime behavior.

### 5.1 RestTemplate-based client

`RestTemplate` historically populer di Spring ecosystem.

Kelebihan:

- familiar,
- blocking model sederhana,
- mudah dipahami,
- banyak legacy integration.

Kekurangan:

- lebih legacy dibanding `RestClient`/`WebClient` di Spring modern,
- blocking,
- tidak ideal untuk reactive applications,
- custom error/retry/observability butuh wrapping.

Cocok untuk:

- aplikasi Spring MVC blocking,
- internal enterprise app legacy,
- migration environment.

Tidak ideal untuk:

- high-concurrency reactive stack,
- modern platform standard yang ingin non-blocking.

### 5.2 WebClient-based client

`WebClient` cocok untuk reactive/non-blocking use case.

Kelebihan:

- non-blocking,
- composable dengan Reactor,
- powerful filter chain,
- baik untuk streaming/async flows,
- bisa dipakai juga di blocking app dengan disiplin tertentu.

Kekurangan:

- complexity lebih tinggi,
- error handling reactive butuh kehati-hatian,
- `.block()` sembarangan bisa merusak model concurrency,
- debugging lebih sulit bagi tim yang belum terbiasa.

Cocok untuk:

- Spring WebFlux,
- high concurrency outbound calls,
- reactive orchestration,
- gateway/backend-for-frontend tertentu.

### 5.3 OkHttp-based client

OkHttp populer, mature, dan lightweight.

Kelebihan:

- dependency relatif jelas,
- interceptors kuat,
- baik untuk non-Spring apps,
- portable,
- banyak dipakai mobile/server.

Kekurangan:

- integration ke Spring Boot observability/config tidak otomatis,
- butuh wrapper untuk platform conventions.

Cocok untuk:

- Java service non-Spring,
- SDK publik,
- consumer yang tidak ingin dependency Spring.

### 5.4 Feign-style client

Feign memberi declarative HTTP client style.

Kelebihan:

- ergonomic,
- cocok untuk internal service-to-service,
- Spring Cloud ecosystem historically familiar.

Kekurangan:

- abstraction bisa menyembunyikan HTTP detail,
- customization/performance/observability tergantung setup,
- tidak selalu ideal untuk SDK publik.

Cocok untuk:

- internal microservice ecosystem yang sudah standardisasi Feign,
- service-to-service calls di Spring Cloud.

### 5.5 Java native HTTP client

Sejak Java 11, `java.net.http.HttpClient` tersedia di JDK.

Kelebihan:

- no external dependency,
- blocking/async support,
- cocok untuk SDK minimal.

Kekurangan:

- ecosystem convenience lebih kecil dibanding OkHttp/Spring,
- butuh custom abstraction untuk retry/auth/observability.

Cocok untuk:

- library publik yang ingin dependency minimal,
- controlled SDK.

---

## 6. Generated Client Architecture in a Java Application

Pertanyaan utama:

```text
Di mana generated client ditempatkan dalam arsitektur aplikasi?
```

Jawaban yang sehat:

```text
Application/domain code should depend on a stable port/interface.
Generated SDK should live behind an adapter.
```

### 6.1 Recommended layering

```text
Domain Layer
    ↓ depends on
Application Port
    ↓ implemented by
Integration Adapter
    ↓ uses
Generated SDK
    ↓ calls
Remote API
```

Contoh:

```java
public interface CaseRegistryPort {
    CaseSnapshot getCase(CaseId caseId);
    CreatedCase registerCase(RegisterCaseCommand command);
}
```

Adapter:

```java
public class OpenApiCaseRegistryAdapter implements CaseRegistryPort {
    private final CasesApi casesApi;
    private final CaseMapper mapper;

    public OpenApiCaseRegistryAdapter(CasesApi casesApi, CaseMapper mapper) {
        this.casesApi = casesApi;
        this.mapper = mapper;
    }

    @Override
    public CaseSnapshot getCase(CaseId caseId) {
        CaseResponse response = casesApi.getCaseById(caseId.value());
        return mapper.toDomain(response);
    }

    @Override
    public CreatedCase registerCase(RegisterCaseCommand command) {
        CreateCaseRequest request = mapper.toApiRequest(command);
        CaseResponse response = casesApi.createCase(request);
        return mapper.toCreatedCase(response);
    }
}
```

Domain tidak tahu:

- OpenAPI Generator,
- generated model names,
- HTTP status plumbing,
- serialization library,
- remote API quirks.

### 6.2 Why this boundary matters

Tanpa adapter, perubahan SDK bisa menyebar ke seluruh aplikasi.

Dengan adapter:

```text
SDK upgrade impact is localized.
```

Ini sangat penting saat:

- API provider upgrade,
- generator version berubah,
- operationId berubah,
- schema class rename,
- enum mapping berubah,
- date/time mapping berubah,
- generated exception model berubah.

---

## 7. Generated Models vs Domain Models

Rule yang sangat penting:

```text
Generated models are transport models, not domain models.
```

### 7.1 Generated model purpose

Generated model merepresentasikan payload contract.

Ia cocok untuk:

- serialize request,
- deserialize response,
- boundary validation,
- SDK API surface,
- integration tests,
- mapping layer.

Ia tidak ideal untuk:

- domain invariants,
- business rules,
- persistence entities,
- workflow state machines,
- aggregate roots,
- long-lived internal model.

### 7.2 Example: bad usage

```java
public class InvestigationService {
    public void assignInvestigator(CaseResponse caseResponse, String investigatorId) {
        if (caseResponse.getStatus().equals("OPEN")) {
            // business decision
        }
    }
}
```

Masalah:

- business logic bergantung pada remote representation,
- status string/enum mungkin berubah,
- generated nullability bisa tidak cocok,
- external API semantics masuk ke internal domain.

### 7.3 Better usage

```java
public record CaseSnapshot(
    CaseId id,
    CaseStatus status,
    CaseVersion version,
    Instant openedAt
) {
    public boolean canBeAssigned() {
        return status == CaseStatus.OPEN || status == CaseStatus.REOPENED;
    }
}
```

Mapper:

```java
public class CaseMapper {
    public CaseSnapshot toDomain(CaseResponse response) {
        return new CaseSnapshot(
            new CaseId(response.getId()),
            mapStatus(response.getStatus()),
            new CaseVersion(response.getVersion()),
            response.getOpenedAt().toInstant()
        );
    }
}
```

### 7.4 Mapping is not waste

Banyak engineer menganggap mapping layer sebagai boilerplate.

Untuk simple CRUD internal apps, mungkin memang terasa berlebihan.

Tapi untuk high-value systems, mapping adalah:

- anti-corruption layer,
- compatibility shield,
- validation boundary,
- semantic translation,
- blast-radius limiter.

---

## 8. OperationId: Small Field, Huge SDK Impact

`operationId` adalah salah satu field paling penting untuk SDK generation.

Contoh OpenAPI:

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCaseById
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Case found
```

Generated client mungkin menghasilkan:

```java
CaseResponse getCaseById(String caseId)
```

Jika `operationId` berubah menjadi `fetchCase`, consumer code bisa break.

### 8.1 OperationId compatibility rule

Treat `operationId` as public API.

```text
Changing operationId is a breaking change for generated SDK users.
```

### 8.2 Good operationId naming

Good:

```yaml
operationId: getCaseById
operationId: createCase
operationId: submitEvidence
operationId: assignInvestigator
operationId: closeCase
operationId: searchCases
```

Bad:

```yaml
operationId: caseControllerGet
operationId: getUsingGET_1
operationId: createCaseV2New
operationId: handle
operationId: doAction
operationId: postCases
```

### 8.3 Naming principles

Use names that are:

- stable,
- consumer-oriented,
- semantically meaningful,
- not tied to controller class names,
- not tied to internal implementation,
- not tied to temporary version names,
- unique across the document.

---

## 9. Tags and Generated API Grouping

Generators often use tags to group operations into API classes.

Example:

```yaml
paths:
  /cases:
    post:
      tags: [Cases]
      operationId: createCase
  /cases/{caseId}/evidence:
    post:
      tags: [Evidence]
      operationId: uploadEvidence
```

Generated Java classes may become:

```text
CasesApi
EvidenceApi
```

Tags therefore influence SDK ergonomics.

### 9.1 Good tag strategy

Use tags as consumer-facing capability groups:

```text
Cases
Evidence
Decisions
Appeals
Audit
Users
```

Avoid implementation groups:

```text
CaseController
InternalCaseService
AdminControllerV2
Misc
Common
```

### 9.2 Tag stability

Changing tags may move operations between generated API classes.

That can be source-breaking for consumers.

Treat tags as SDK-facing structure if you generate SDKs.

---

## 10. Date and Time Mapping

Date/time is one of the most common generated-client traps.

OpenAPI often uses:

```yaml
schema:
  type: string
  format: date-time
```

But generated Java could map it to:

- `OffsetDateTime`,
- `Instant`,
- `ZonedDateTime`,
- `LocalDateTime`,
- `Date`,
- `String`,
- custom type.

### 10.1 Recommended semantic distinctions

Use `date` for calendar date without time:

```yaml
birthDate:
  type: string
  format: date
  example: "1985-04-12"
```

Use `date-time` for timestamp with timezone/offset semantics:

```yaml
submittedAt:
  type: string
  format: date-time
  example: "2026-06-20T13:45:30Z"
```

Avoid using `LocalDateTime` semantics for distributed API timestamps unless you have a very explicit reason.

### 10.2 Common Java mistake

Bad:

```java
LocalDateTime submittedAt;
```

`LocalDateTime` has no timezone/offset. For cross-service APIs, this can cause ambiguity.

Better:

```java
OffsetDateTime submittedAt;
```

or domain mapping:

```java
Instant submittedAt;
```

### 10.3 SDK decision

For public SDK, prefer preserving offset-aware semantics.

For internal domain, map to your chosen canonical type.

---

## 11. Nullable, Optional, Required, and Java Type Pain

OpenAPI nullability interacts badly with Java because Java's type system historically does not encode nullability strongly.

### 11.1 Required does not mean non-null in every version/context

In schema terms, `required` means property must be present.

Nullability controls whether the value may be `null`.

Conceptually:

```text
optional absent       -> property missing
required present      -> property must exist
nullable              -> value may be null
non-null              -> value must not be null
```

These are different states.

### 11.2 Four possible field states

For a field `decisionReason`:

```text
1. absent
2. present with string
3. present with null
4. present with invalid type
```

Generated Java may collapse some of these states.

Example:

```java
private String decisionReason;
```

This cannot distinguish:

```text
absent vs present null
```

unless generator/runtime tracks field presence separately.

### 11.3 Avoid casual nullable

Bad schema:

```yaml
decisionReason:
  type:
    - string
    - 'null'
```

If business meaning is unclear, nullable spreads ambiguity.

Better:

```yaml
decisionReason:
  type: string
  description: Required when status is REJECTED. Omitted otherwise.
```

Or model state-specific schemas where appropriate.

### 11.4 Do not use `Optional` everywhere

In Java DTOs, `Optional<T>` fields are often awkward for serialization frameworks.

Use domain-level Optional deliberately, but do not assume generated SDK should expose everything as Optional.

### 11.5 Boundary strategy

At adapter boundary:

```java
String maybeReason = response.getDecisionReason();
DecisionReason reason = DecisionReason.fromNullable(maybeReason);
```

Then enforce stronger domain semantics internally.

---

## 12. Enum Evolution and SDK Fragility

Enums are deceptively dangerous.

OpenAPI:

```yaml
CaseStatus:
  type: string
  enum:
    - OPEN
    - UNDER_REVIEW
    - CLOSED
```

Generated Java:

```java
public enum CaseStatus {
    OPEN,
    UNDER_REVIEW,
    CLOSED
}
```

Looks great.

But what happens when provider adds:

```text
ESCALATED
```

### 12.1 Adding enum value may break consumers

For server response enums, adding a value can break clients that generated closed enums.

Failure modes:

- deserialization error,
- unknown enum mapped to null,
- switch statement missing case,
- business logic default branch mishandles,
- UI cannot render,
- generated SDK cannot parse.

### 12.2 Enum direction matters

For request enum:

```text
Consumer sends value to provider.
```

Adding new allowed request enum value is usually not breaking for old consumers.

For response enum:

```text
Provider sends value to consumer.
```

Adding new response enum value can be breaking if clients are strict.

### 12.3 Strategies

#### Strategy A: Closed enum for stable vocabulary

Use when values are truly stable:

```yaml
Priority:
  type: string
  enum: [LOW, MEDIUM, HIGH]
```

#### Strategy B: Open enum pattern

Some teams document expected values but allow unknown strings.

```yaml
CaseStatus:
  type: string
  description: >
    Known values include OPEN, UNDER_REVIEW, CLOSED. Clients must tolerate unknown values.
```

Downside: generated clients may not provide enum type safety.

#### Strategy C: Unknown enum handling in SDK

Generated/custom SDK can map unknown values to:

```java
UNKNOWN_DEFAULT_OPEN_API
```

or similar.

This improves forward compatibility, but consumers must still handle unknown.

#### Strategy D: State object instead of volatile enum

If status is complex and evolving, model richer state:

```yaml
CaseLifecycleState:
  type: object
  required: [code, label, category]
  properties:
    code:
      type: string
      example: ESCALATED_TO_LEGAL
    label:
      type: string
      example: Escalated to Legal Review
    category:
      type: string
      enum: [ACTIVE, TERMINAL, SUSPENDED]
```

This allows display and behavior to evolve better.

### 12.4 Top 1% rule

```text
Never treat response enum expansion as automatically safe.
```

Assess clients, generated SDK behavior, and switch handling.

---

## 13. Error Handling in Generated Clients

OpenAPI can document errors, but generated clients often expose errors poorly unless contract is designed well.

### 13.1 Bad API contract

```yaml
responses:
  '400':
    description: Bad request
  '500':
    description: Internal server error
```

Generated client may only throw generic exception:

```java
ApiException: Bad Request
```

Consumer cannot know:

- validation error,
- duplicate key,
- missing permission,
- state conflict,
- rate limit,
- retryability.

### 13.2 Better contract

```yaml
responses:
  '400':
    description: Invalid request
    content:
      application/problem+json:
        schema:
          $ref: '#/components/schemas/Problem'
  '409':
    description: Case state conflict
    content:
      application/problem+json:
        schema:
          $ref: '#/components/schemas/Problem'
  '429':
    description: Rate limit exceeded
    headers:
      Retry-After:
        schema:
          type: string
    content:
      application/problem+json:
        schema:
          $ref: '#/components/schemas/Problem'
```

### 13.3 SDK wrapper pattern

Generated clients often throw generated exceptions. Wrap them.

```java
public class CaseRegistryAdapter implements CaseRegistryPort {
    @Override
    public CaseSnapshot getCase(CaseId id) {
        try {
            return mapper.toDomain(casesApi.getCaseById(id.value()));
        } catch (ApiException ex) {
            throw mapApiException(ex);
        }
    }

    private RuntimeException mapApiException(ApiException ex) {
        return switch (ex.getCode()) {
            case 404 -> new RemoteCaseNotFoundException();
            case 409 -> new RemoteCaseConflictException(ex.getResponseBody());
            case 429 -> new RemoteRateLimitedException(ex);
            default -> new RemoteCaseRegistryException(ex);
        };
    }
}
```

Domain/application should not depend directly on generated `ApiException`.

### 13.4 Preserve response metadata

For robust systems, preserve:

- status code,
- response headers,
- correlation ID,
- retry-after,
- problem type,
- problem code,
- raw response body if safe,
- request ID.

---

## 14. Retry, Timeout, Circuit Breaker, and Idempotency

Generated clients often provide basic HTTP calls, but reliability policy is application/platform concern.

### 14.1 Timeout

Every generated client usage needs timeouts.

Bad:

```java
CasesApi api = new CasesApi();
```

No explicit timeout policy.

Better:

```java
ApiClient client = new ApiClient();
client.setConnectTimeout(2_000);
client.setReadTimeout(5_000);
```

Exact API depends on generator/library.

### 14.2 Retry

Do not blindly retry all failed calls.

Retry candidates:

- connection reset,
- transient 502/503/504,
- 429 with `Retry-After`,
- idempotent GET,
- idempotent PUT if semantics are safe,
- POST only with idempotency key or explicit safe semantics.

Do not casually retry:

- non-idempotent POST,
- payment/decision/action submission,
- state transition commands,
- evidence upload completion,
- operations with side effects unless idempotency is designed.

### 14.3 Idempotency key support

OpenAPI should document idempotency headers where relevant:

```yaml
parameters:
  - name: Idempotency-Key
    in: header
    required: true
    schema:
      type: string
      minLength: 8
      maxLength: 128
    description: Unique key used to safely retry this command.
```

SDK can expose it explicitly:

```java
api.createCase(idempotencyKey, request);
```

Better than hiding it in generic header map.

### 14.4 Circuit breaker

Circuit breaker should usually live outside generated code:

```text
Application service
    -> resilience wrapper
    -> adapter
    -> generated client
```

Or:

```text
Adapter method annotated/configured with resilience policy
```

Do not manually edit generated client to add circuit breakers.

---

## 15. Authentication Injection

OpenAPI security schemes can help generator create auth hooks.

Example:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
security:
  - bearerAuth: []
```

Generated clients may expose auth configuration:

```java
ApiClient client = new ApiClient();
client.setBearerToken(token);
```

But real systems need more than static token.

### 15.1 Token provider pattern

Better:

```java
public interface AccessTokenProvider {
    String currentToken();
}
```

Adapter/client config injects token per request.

Pseudo-code:

```java
class BearerAuthInterceptor implements ClientInterceptor {
    private final AccessTokenProvider tokenProvider;

    @Override
    public void apply(Request request) {
        request.header("Authorization", "Bearer " + tokenProvider.currentToken());
    }
}
```

### 15.2 Avoid secrets in generated config

Do not commit:

```java
client.setApiKey("prod-secret");
```

Do not put real secrets in OpenAPI examples.

### 15.3 Multi-tenant auth

For multi-tenant systems, token selection may depend on:

- tenant,
- actor,
- delegated authority,
- service account,
- request context.

Do not configure generated client as singleton with one static token unless that matches the security model.

---

## 16. Observability for Generated Clients

Generated clients need observability like any outbound dependency.

Track:

- remote service name,
- operationId,
- HTTP method,
- path template,
- status code,
- latency,
- retry count,
- timeout count,
- error category,
- correlation/request ID,
- SDK version,
- API contract version.

### 16.1 Use operationId as telemetry dimension

Good metrics label:

```text
remote_operation=getCaseById
```

Bad:

```text
url=/cases/123456
```

Path with IDs creates high cardinality.

Use path template:

```text
path_template=/cases/{caseId}
```

### 16.2 Generated SDK version in user agent

SDK should send useful User-Agent if allowed:

```text
User-Agent: case-registry-java-sdk/1.8.0 my-service/2.4.1
```

This helps provider diagnose consumer usage.

### 16.3 Correlation ID

Generated clients should allow injecting:

```text
X-Correlation-ID
X-Request-ID
traceparent
```

depending on organization standard.

Do not hard-code random correlation logic deep inside generated code if platform already has tracing.

---

## 17. Generated SDK Packaging and Versioning

SDK release management is often underestimated.

### 17.1 Version alignment options

#### Option A: SDK version equals API contract version

```text
openapi: 1.8.0
java-sdk: 1.8.0
typescript-sdk: 1.8.0
```

Pros:

- simple mental model,
- easy traceability,
- consumer knows exact contract.

Cons:

- SDK-only fixes need versioning decision,
- language-specific fixes may not match API release.

#### Option B: SDK has independent version with contract metadata

```text
openapi: 1.8.0
java-sdk: 2.3.1
```

SDK metadata includes:

```text
Built from API contract: 1.8.0
Generator version: 7.x
Generated at commit: abc123
```

Pros:

- flexible SDK maintenance,
- language-specific patch releases possible.

Cons:

- more complex traceability.

### 17.2 Recommended enterprise approach

For internal platforms:

```text
SDK version may be independent,
but must declare contract version it was generated from.
```

For public APIs:

```text
Use clear semantic versioning and changelog.
Do not force SDK version to hide API breaking changes.
```

### 17.3 Artifact publishing

Java SDK:

- Maven repository,
- internal artifact registry,
- versioned JAR,
- source JAR if useful,
- changelog,
- generated metadata.

TypeScript SDK:

- npm registry,
- package lock policy,
- ESM/CJS decision,
- browser/node compatibility.

---

## 18. Regeneration Strategy

Never manually edit generated code unless the generator workflow explicitly supports it.

### 18.1 Bad workflow

```text
Generate SDK once.
Commit generated code.
Engineers manually patch generated classes.
Regenerate later.
Patches disappear.
```

### 18.2 Better workflow

```text
OpenAPI spec
    + generator config
    + templates if needed
    + post-processing scripts if needed
    -> reproducible SDK build
```

### 18.3 What should be committed?

Depends on repo strategy.

#### SDK repository

Usually commit generated source if it is the deliverable, but ensure regeneration is reproducible.

#### Application consuming SDK

Usually depend on published SDK artifact, not generated source.

#### Contract repository

Usually commit OpenAPI source, generator config, templates, and CI pipeline.

### 18.4 Generated metadata

Include generated metadata:

```text
contractVersion=1.8.0
generator=openapi-generator
generatorVersion=...
specCommit=...
generatedAt=...
```

But avoid timestamps if they break reproducible builds unless needed.

---

## 19. Custom Templates: Powerful but Costly

Generators often allow custom templates.

This is powerful because you can enforce organization conventions:

- error wrapper,
- auth integration,
- observability hooks,
- package naming,
- annotations,
- builder style,
- nullability annotations,
- reactive types,
- custom date handling.

But templates create maintenance cost.

### 19.1 Template ownership questions

Before custom templates, ask:

1. Who owns them?
2. How are they tested?
3. How are they upgraded with generator versions?
4. Are they shared across APIs?
5. Are generated SDKs backward-compatible after template changes?
6. Can consumers debug generated code?

### 19.2 Prefer wrapper before template customization

If you need application-specific behavior, prefer wrapper/adapters.

Use template customization for cross-cutting SDK-wide standards, not domain-specific hacks.

Bad customization:

```text
Template knows about CaseRegistry business semantics.
```

Good customization:

```text
Template adds standard correlation ID interceptor hook.
```

---

## 20. TypeScript and Frontend Client Generation

Although this series is for Java engineers, many OpenAPI contracts also generate frontend clients.

You should understand the implications because backend contract decisions affect frontend SDK ergonomics.

### 20.1 TypeScript strengths

Generated TypeScript clients can provide:

- typed request/response,
- fetch/axios wrappers,
- schema-derived types,
- API grouping,
- frontend autocomplete.

### 20.2 Frontend-specific concerns

- browser CORS,
- credentials/cookies,
- token handling,
- upload progress,
- abort/cancellation,
- pagination helpers,
- bundle size,
- tree-shaking,
- ESM/CJS packaging,
- error UX mapping.

### 20.3 Avoid leaking backend naming

If OpenAPI operationId is backend-oriented, frontend SDK feels bad.

Bad:

```text
caseControllerSearchUsingPOST
```

Good:

```text
searchCases
```

### 20.4 Frontend enum issue

TypeScript string union can be more tolerant than generated closed enums depending on generator.

Still, adding new response enum values can break UI logic.

---

## 21. Public SDK vs Internal Generated Client

Not all generated clients are the same.

### 21.1 Internal generated client

Audience:

- internal teams,
- controlled environment,
- shared platform standards.

Characteristics:

- can assume internal auth patterns,
- can use internal observability libraries,
- can rely on internal artifact registry,
- can move faster,
- can have stricter upgrade policy.

### 21.2 Public SDK

Audience:

- external developers,
- partners,
- unknown environments.

Characteristics:

- must minimize dependency pain,
- must have stable API surface,
- must include docs/examples,
- must handle versioning carefully,
- must avoid internal assumptions,
- must be secure by default,
- must provide clear migration guide.

### 21.3 Partner SDK

Partner SDK sits between internal and public.

Needs:

- strong compatibility,
- clear auth configuration,
- sandbox support,
- changelog,
- supportability,
- traceability.

For regulated systems, partner SDK may also need:

- audit-friendly logging hooks,
- correlation IDs,
- data minimization,
- error code stability.

---

## 22. SDK API Surface Design

Generated SDK has its own API surface.

It includes:

- API classes,
- method names,
- parameter order,
- request builders,
- response wrappers,
- exception types,
- auth configuration,
- pagination helpers,
- model classes,
- enum classes.

### 22.1 Method signatures matter

Generated method from this:

```yaml
operationId: searchCases
parameters:
  - name: status
    in: query
    schema:
      type: string
  - name: priority
    in: query
    schema:
      type: string
  - name: assignedTo
    in: query
    schema:
      type: string
  - name: pageSize
    in: query
    schema:
      type: integer
  - name: cursor
    in: query
    schema:
      type: string
```

May produce:

```java
searchCases(status, priority, assignedTo, pageSize, cursor)
```

This is brittle and unclear.

Better SDK ergonomics may require a request object:

```java
SearchCasesRequest request = new SearchCasesRequest()
    .status("OPEN")
    .priority("HIGH")
    .pageSize(50);

SearchCasesResponse response = casesApi.searchCases(request);
```

But whether generator does that depends on generator target/config.

### 22.2 OpenAPI design influences this

Sometimes you should model complex search as request body on a search endpoint:

```yaml
POST /case-searches
```

or:

```yaml
POST /cases/search
```

This is not always “pure REST”, but it can improve clarity for complex query DSLs.

The correct choice depends on caching, safety, length limits, auditability, and consumer ergonomics.

---

## 23. Pagination Helpers in SDKs

OpenAPI can describe pagination shape, but generated SDK may not provide iteration helpers automatically.

Raw SDK:

```java
SearchCasesResponse page = casesApi.searchCases(null, 100, null);
while (page.getNextCursor() != null) {
    page = casesApi.searchCases(null, 100, page.getNextCursor());
}
```

Wrapper helper:

```java
Stream<CaseSummary> cases = caseClient.streamCases(SearchCasesCriteria.openCases());
```

But be careful.

### 23.1 Hidden pagination danger

A helper that auto-fetches all pages can:

- create huge memory usage,
- trigger rate limits,
- hide latency,
- make cancellation difficult,
- hide partial failure.

Better helper designs:

```java
Page<CaseSummary> firstPage = client.searchCases(criteria);
```

or:

```java
Iterable<Page<CaseSummary>> pages = client.searchCasePages(criteria);
```

or reactive:

```java
Flux<CaseSummary> caseStream = client.streamCases(criteria);
```

with explicit limits and backpressure where relevant.

---

## 24. File Upload and Download SDK Concerns

Generated clients for file APIs need extra care.

OpenAPI may model upload:

```yaml
requestBody:
  content:
    multipart/form-data:
      schema:
        type: object
        required: [file, metadata]
        properties:
          file:
            type: string
            format: binary
          metadata:
            $ref: '#/components/schemas/EvidenceMetadata'
```

Generated Java may represent file as:

- `File`,
- `InputStream`,
- `byte[]`,
- library-specific resource.

### 24.1 Avoid loading large files into memory

Bad SDK behavior:

```java
byte[] evidence = Files.readAllBytes(path);
api.uploadEvidence(caseId, evidence);
```

For large files, prefer streaming where generator/library supports it.

### 24.2 Download concerns

For downloads, preserve:

- content type,
- filename/content disposition,
- content length,
- checksum,
- ETag,
- streaming body,
- retry semantics,
- range requests if supported.

SDK should not always convert downloads to `String` or `byte[]` without control.

---

## 25. Generated SDKs and Backward Compatibility

Compatibility has multiple layers:

```text
API wire compatibility
SDK source compatibility
SDK binary compatibility
SDK behavioral compatibility
Domain/application compatibility
```

A change can be wire-compatible but SDK-breaking.

### 25.1 Example: operationId rename

Wire API unchanged:

```text
GET /cases/{caseId}
```

But `operationId` changes:

```text
getCaseById -> fetchCase
```

Generated Java method changes:

```java
getCaseById(...) -> fetchCase(...)
```

This is SDK source-breaking.

### 25.2 Example: schema rename

Wire payload unchanged:

```json
{
  "id": "case-123"
}
```

But schema name changes:

```text
CaseResponse -> CaseDetails
```

Generated class changes.

Source-breaking.

### 25.3 Example: optional response field added

Wire-compatible.

But generated model class changes. Usually source-compatible for consumers, but can affect:

- equality,
- serialization snapshots,
- strict tests,
- generated constructors,
- builder methods,
- binary compatibility.

### 25.4 Compatibility gate should include SDK generation

CI should check:

```text
old OpenAPI + generator config -> old SDK
new OpenAPI + same generator config -> new SDK
compare generated API surface
```

At least for public/partner SDKs.

---

## 26. Testing Generated SDKs

Do not assume generated SDK is correct just because it compiles.

### 26.1 Test levels

#### 1. Compilation test

Generated code compiles.

#### 2. Serialization test

Request object serializes as expected.

#### 3. Deserialization test

Response examples deserialize correctly.

#### 4. Error test

Problem/error responses map correctly.

#### 5. Auth injection test

Authorization header is applied correctly.

#### 6. Timeout/retry test

Timeout and retry behavior is as expected.

#### 7. Wiremock/mock server test

SDK calls expected method/path/headers/body.

#### 8. Contract example test

OpenAPI examples round-trip through SDK.

### 26.2 Example test idea

```java
@Test
void createCaseSerializesExpectedJson() {
    CreateCaseRequest request = new CreateCaseRequest()
        .title("Suspected breach")
        .priority(Priority.HIGH);

    String json = objectMapper.writeValueAsString(request);

    assertThat(json).contains("Suspected breach");
    assertThat(json).contains("HIGH");
}
```

### 26.3 SDK tests should be generated/reusable too

For platform teams, create a standard SDK test harness.

```text
For every generated SDK:
- compile
- run example serialization tests
- run mock endpoint tests
- validate error parsing
- publish only if pass
```

---

## 27. SDK Changelog and Consumer Communication

SDK release without changelog creates upgrade fear.

A good SDK changelog separates:

```text
API contract changes
Generated SDK changes
Dependency changes
Behavior changes
Breaking changes
Deprecations
Migration instructions
```

Example:

```md
## 1.9.0

### API Changes
- Added optional `escalationReason` to `CaseResponse`.
- Added `searchAppeals` operation.

### SDK Changes
- Java SDK now uses `OffsetDateTime` for `date-time` fields.

### Breaking Changes
- None.

### Deprecations
- `getCaseAuditTrail` is deprecated; use `listCaseAuditEvents`.
```

For partner/public SDKs, include migration examples.

---

## 28. Generated SDK and Regulatory/Auditable Systems

For regulated systems, SDKs are not just convenience.

They can enforce or support:

- correlation ID propagation,
- consistent user-agent/client identification,
- audit metadata,
- idempotency keys,
- explicit actor context,
- evidence upload checksums,
- safe error handling,
- retry discipline,
- data minimization.

### 28.1 Example: enforcement lifecycle client

Bad method:

```java
api.submitDecision(caseId, request);
```

Better boundary:

```java
SubmitDecisionCommand command = new SubmitDecisionCommand(
    caseId,
    decision,
    reason,
    actorContext,
    idempotencyKey,
    evidenceVersion
);

decisionClient.submitDecision(command);
```

Generated SDK might still call the raw API, but your domain-facing client should require regulatory-critical metadata.

### 28.2 Audit-sensitive SDK behavior

Do not log:

- full request body with PII,
- evidence contents,
- tokens,
- secrets,
- sensitive error details.

Do log safely:

- operationId,
- request ID,
- correlation ID,
- status code,
- latency,
- sanitized problem code,
- SDK version.

---

## 29. Decision Matrix: Should You Generate a Client?

Use this matrix.

| Context | Generate SDK? | Notes |
|---|---:|---|
| Simple internal API with one consumer | Maybe | Manual client may be enough. |
| Many internal consumers | Yes | Strong value from standardization. |
| Public API | Usually yes | But polish/support/versioning must be serious. |
| Partner API | Yes | SDK reduces integration ambiguity. |
| Highly volatile API | Be careful | SDK churn may frustrate consumers. |
| Poorly designed OpenAPI | Not yet | Fix contract first. |
| API with complex auth/retry/idempotency | Yes, with wrapper | SDK should encode safe patterns. |
| Domain-critical system | Yes, but behind adapter | Never leak generated models into core. |
| Experimental prototype | Maybe | Generation can speed up, but do not over-invest. |

---

## 30. Recommended Architecture Patterns

### Pattern 1: Direct generated client for low-risk integration

```text
Application service -> Generated SDK
```

Use only when:

- low criticality,
- internal app,
- API stable enough,
- no complex domain mapping,
- generated models not spreading widely.

### Pattern 2: Adapter wrapping generated client

```text
Application service -> Port -> Adapter -> Generated SDK
```

Recommended default for serious Java systems.

### Pattern 3: Platform SDK wrapper

```text
Consumer app -> Official SDK facade -> Generated low-level client -> API
```

Good for public/partner/internal platform APIs.

Low-level generated client exists, but official facade provides:

- ergonomic methods,
- auth hooks,
- retry policy,
- pagination helpers,
- error mapping,
- observability,
- domain-safe API.

### Pattern 4: Generated types only

Sometimes generate models/types but write client manually.

Useful when:

- custom HTTP behavior is complex,
- generator client is not ergonomic,
- you want schema-derived types only.

### Pattern 5: No generation, contract validation only

Useful when:

- API usage is tiny,
- language target poor,
- generated code quality bad,
- manual client easier,
- contract still used for validation/testing/docs.

---

## 31. Anti-Patterns

### Anti-pattern 1: Generated models in domain core

```text
Domain services accept generated DTOs directly.
```

Consequence:

- domain polluted by transport concerns,
- SDK upgrade becomes business code refactor,
- invariants weaken.

### Anti-pattern 2: Manual edits to generated code

Consequence:

- regeneration destroys changes,
- ownership unclear,
- bugs become hard to reproduce.

### Anti-pattern 3: No generator config committed

Consequence:

- SDK not reproducible,
- different machines generate different output,
- CI cannot guarantee artifact lineage.

### Anti-pattern 4: SDK without timeouts

Consequence:

- thread exhaustion,
- cascading failure,
- unbounded waiting.

### Anti-pattern 5: SDK without error model

Consequence:

- consumers catch generic exceptions,
- retry behavior unsafe,
- UX poor,
- incident debugging hard.

### Anti-pattern 6: Assuming generated enum is future-proof

Consequence:

- new server enum breaks old clients.

### Anti-pattern 7: OperationId instability

Consequence:

- method names change,
- SDK source breaks,
- consumer upgrade friction.

### Anti-pattern 8: One SDK for every possible need

Trying to make one generated SDK perfect for all consumers can create complexity.

Sometimes provide:

- low-level generated client,
- higher-level domain SDK,
- language-specific ergonomics.

### Anti-pattern 9: SDK published with no changelog

Consequence:

- consumers fear upgrades,
- support burden rises,
- breaking changes missed.

### Anti-pattern 10: Generated SDK as proof API is good

Consequence:

- bad API design is automated and distributed faster.

---

## 32. Practical Java Example: Wrapping Generated SDK

Assume generated API:

```java
public class CasesApi {
    public CaseResponse getCaseById(String caseId) throws ApiException { ... }
    public CaseResponse createCase(CreateCaseRequest request) throws ApiException { ... }
}
```

### 32.1 Define application port

```java
public interface CaseRegistryPort {
    CaseSnapshot findById(CaseId id);
    CreatedCase create(RegisterCaseCommand command);
}
```

### 32.2 Domain/application model

```java
public record CaseId(String value) {
    public CaseId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("case id is required");
        }
    }
}

public record CaseSnapshot(
    CaseId id,
    CaseStatus status,
    Instant openedAt
) {}

public enum CaseStatus {
    OPEN,
    UNDER_REVIEW,
    CLOSED,
    UNKNOWN
}
```

### 32.3 Adapter

```java
public class GeneratedSdkCaseRegistryAdapter implements CaseRegistryPort {
    private final CasesApi casesApi;
    private final CaseApiMapper mapper;

    public GeneratedSdkCaseRegistryAdapter(CasesApi casesApi, CaseApiMapper mapper) {
        this.casesApi = casesApi;
        this.mapper = mapper;
    }

    @Override
    public CaseSnapshot findById(CaseId id) {
        try {
            CaseResponse response = casesApi.getCaseById(id.value());
            return mapper.toSnapshot(response);
        } catch (ApiException ex) {
            throw mapper.toApplicationException(ex);
        }
    }

    @Override
    public CreatedCase create(RegisterCaseCommand command) {
        try {
            CreateCaseRequest request = mapper.toCreateRequest(command);
            CaseResponse response = casesApi.createCase(request);
            return mapper.toCreatedCase(response);
        } catch (ApiException ex) {
            throw mapper.toApplicationException(ex);
        }
    }
}
```

### 32.4 Mapper

```java
public class CaseApiMapper {
    public CaseSnapshot toSnapshot(CaseResponse response) {
        return new CaseSnapshot(
            new CaseId(response.getId()),
            toDomainStatus(response.getStatus()),
            response.getOpenedAt().toInstant()
        );
    }

    private CaseStatus toDomainStatus(CaseResponse.StatusEnum status) {
        if (status == null) {
            return CaseStatus.UNKNOWN;
        }
        return switch (status) {
            case OPEN -> CaseStatus.OPEN;
            case UNDER_REVIEW -> CaseStatus.UNDER_REVIEW;
            case CLOSED -> CaseStatus.CLOSED;
            default -> CaseStatus.UNKNOWN;
        };
    }

    public RuntimeException toApplicationException(ApiException ex) {
        return switch (ex.getCode()) {
            case 404 -> new CaseNotFoundException();
            case 409 -> new CaseConflictException(ex.getResponseBody());
            case 429 -> new RemoteRateLimitedException(ex);
            default -> new RemoteCaseRegistryException(ex);
        };
    }
}
```

This is more code than direct SDK use, but it buys:

- domain isolation,
- error control,
- enum tolerance,
- upgrade safety,
- testability,
- clearer application semantics.

---

## 33. CI/CD for SDK Generation

A healthy pipeline:

```text
1. Validate OpenAPI
2. Lint OpenAPI
3. Bundle OpenAPI
4. Diff against previous release
5. Generate SDK
6. Compile SDK
7. Run SDK tests
8. Package SDK
9. Publish SDK
10. Publish changelog/docs
```

### 33.1 Minimum Java SDK pipeline

```text
openapi.yaml
  -> openapi-generator
  -> generated Java sources
  -> mvn test
  -> mvn package
  -> publish to Maven registry
```

### 33.2 Reproducibility checklist

Commit:

- OpenAPI source,
- lock generator version,
- generator config,
- custom templates,
- post-processing scripts,
- SDK tests,
- release notes.

Avoid:

- floating latest generator,
- uncommitted local config,
- manual generated edits,
- unpublished build assumptions.

---

## 34. Review Checklist for SDK-Ready OpenAPI

Before generating SDK, review:

### Operation design

- Are operationIds stable and meaningful?
- Are tags consumer-oriented?
- Are parameter names ergonomic?
- Are complex query params modelled clearly?

### Schema design

- Are request and response schemas separated where needed?
- Are required/nullable semantics clear?
- Are enums stable or forward-compatible?
- Are date/time formats appropriate?
- Are binary/file payloads modelled correctly?

### Error design

- Are non-2xx responses documented?
- Is problem/error schema consistent?
- Are retryable errors distinguishable?
- Are rate limit headers documented?

### SDK behavior

- Does generated code compile?
- Are auth hooks usable?
- Are timeouts configurable?
- Are interceptors available?
- Is observability possible?
- Is pagination ergonomic?
- Are unknown enum values handled?

### Versioning

- Is contract version recorded?
- Is SDK version policy clear?
- Is changelog generated/written?
- Are breaking changes detected?

### Architecture

- Will consumers use SDK behind adapter?
- Are generated models prevented from leaking to domain?
- Is there a migration guide?

---

## 35. Heuristics for Top 1% Engineers

1. Treat SDK as part of API product, not build artifact noise.
2. Treat `operationId` as public interface.
3. Keep generated code at integration boundary.
4. Do not let generated transport models become domain models.
5. Never manually patch generated code without template/config strategy.
6. Design OpenAPI for generated ergonomics, not only documentation readability.
7. Test generated clients against examples and mock servers.
8. Document and version SDK releases seriously.
9. Preserve HTTP semantics where consumers need them.
10. Put timeout, retry, auth, observability, and error mapping under explicit control.
11. Assume enum evolution can break clients.
12. Use adapters to reduce blast radius of SDK upgrades.
13. Prefer reproducible generation over local magic.
14. Separate low-level generated client from high-level domain SDK when needed.
15. Remember: generation accelerates good contracts and amplifies bad ones.

---

## 36. Summary

SDK/client generation is one of the most valuable uses of OpenAPI, but also one of the fastest ways to distribute bad API design.

A mature approach looks like this:

```text
Well-designed OpenAPI contract
    -> reproducible generator config
    -> generated low-level client
    -> tested SDK artifact
    -> adapter/facade in consumer application
    -> domain-safe integration
```

The core principle:

```text
Generated SDK should reduce integration friction,
not transfer provider-side design instability into consumer domain code.
```

For Java engineers, the most important architecture decision is not which generator to use. It is where generated code sits in your application.

Recommended default:

```text
Domain/Application -> Port -> Adapter -> Generated SDK -> Remote API
```

This keeps the benefits of OpenAPI generation while preserving clean boundaries, testability, and long-term evolvability.

---

## 37. What Comes Next

Next part:

```text
Part 023 — Server Stub Generation and Implementation Alignment in Java
```

Part 022 focused on consuming APIs through generated SDKs.

Part 023 flips the perspective: using OpenAPI to generate server-side interfaces/stubs in Java while keeping implementation architecture clean.

We will cover:

- server stub generation mental model,
- generated interfaces vs generated controllers,
- delegate pattern,
- DTO boundaries,
- Spring Boot server generation,
- validation generation,
- regeneration safety,
- mapping OpenAPI DTOs to application commands/domain models,
- avoiding generated-code-dominates-architecture failure mode.

---

# End of Part 022

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-021.md">⬅️ OpenAPI Mastery for Java Engineers — Part 021</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-023.md">OpenAPI Mastery for Java Engineers — Part 023 ➡️</a>
</div>
