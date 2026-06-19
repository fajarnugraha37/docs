# OpenAPI Mastery for Java Engineers — Part 023
# Server Stub Generation and Implementation Alignment in Java

> Filename: `learn-openapi-mastery-for-java-engineers-part-023.md`  
> Series: `learn-openapi-mastery-for-java-engineers`  
> Part: `023 / 030`  
> Status: In progress  
> Previous: Part 022 — SDK and Client Generation: Power, Limits, and Architecture Decisions  
> Next: Part 024 — OpenAPI for Microservices and Platform Engineering

---

## 0. Why This Part Exists

Client generation answers this question:

> “How can a consumer call the API safely and consistently from code?”

Server stub generation answers a different question:

> “How can the provider implement an API while staying aligned with a pre-defined contract?”

For Java engineers, server generation is tempting because it looks like a shortcut:

- write OpenAPI,
- generate Spring controllers,
- fill in business logic,
- ship.

That is the shallow version.

The deeper architectural question is:

> Where should generated code sit in a serious Java application so that it strengthens the API boundary without taking over the architecture?

This part is about that boundary.

OpenAPI Generator’s Spring generator is officially a **server** generator for Java/Spring Boot applications and is marked stable in its generator metadata. It generates a Spring Boot server application using SpringDoc integration. The OpenAPI Generator project also supports generation of API client libraries, server stubs, documentation, and configuration from an OpenAPI document. The OpenAPI Specification itself remains language-agnostic and defines a formal interface description for HTTP APIs. That means generated Java code is a derivative artifact, not the contract itself.

References:

- OpenAPI Specification v3.2.0: https://spec.openapis.org/oas/v3.2.0.html
- OpenAPI Initiative: https://www.openapis.org/
- OpenAPI Generator Spring generator: https://openapi-generator.tech/docs/generators/spring/
- OpenAPI Generator Java generator: https://openapi-generator.tech/docs/generators/java/
- OpenAPI Generator Maven Plugin: https://github.com/OpenAPITools/openapi-generator/blob/master/modules/openapi-generator-maven-plugin/README.md
- OpenAPI Generator JAX-RS Jersey generator: https://openapi-generator.tech/docs/generators/jaxrs-jersey/

---

## 1. The Core Mental Model

Server stub generation is not “generate the backend”.

It is:

> Generate the HTTP boundary scaffolding implied by an OpenAPI contract, then connect that boundary to your application architecture deliberately.

A production Java service usually has several layers:

```text
HTTP / API Boundary
    ↓
Generated API interface / controller adapter
    ↓
Manual adapter implementation
    ↓
Application service / use case layer
    ↓
Domain model / domain service / state machine
    ↓
Repository / integration / persistence gateway
    ↓
Database / external system / queue / storage
```

Generated code belongs near the top.

It should not leak downward into domain logic.

The safe invariant is:

> Generated OpenAPI code may define the external transport contract, but it must not become the domain model, persistence model, or application core.

If generated classes spread everywhere, your contract tool has become your architecture.

That is usually a mistake.

---

## 2. What Server Stub Generation Actually Produces

Depending on generator, options, library, and target framework, server generation may produce some combination of:

1. API interfaces.
2. Controller classes.
3. Delegate interfaces.
4. DTO/model classes.
5. Validation annotations.
6. Serialization annotations.
7. Exception placeholders.
8. Configuration classes.
9. OpenAPI documentation wiring.
10. Test skeletons.
11. Build files.
12. Application bootstrap files.

For Spring, common generated shapes include:

```text
UsersApi.java                 // generated API interface
UsersApiController.java       // generated controller or adapter
UsersApiDelegate.java         // generated delegate interface
UserResponse.java             // generated model
CreateUserRequest.java        // generated model
ApiUtil.java                  // generated helper
OpenApiGeneratorApplication.java // optional bootstrap if generating full app
```

The exact output depends on configuration.

That means the architectural question is not “can OpenAPI generate server code?”

It can.

The real question is:

> Which generated pieces do you allow into your codebase, and which pieces do you isolate?

---

## 3. Four Server Generation Strategies

There are four broad strategies.

### 3.1 Full Server Application Generation

You generate a complete server skeleton:

```text
OpenAPI spec → generated Spring Boot project → implement inside generated project
```

This is useful for:

- prototypes,
- hackathons,
- proof of concept services,
- contract exploration,
- throwaway mocks,
- small internal tools.

It is risky for serious systems because generated project structure may dominate your architecture.

Failure mode:

```text
Contract tool decides your package structure,
framework structure,
DTO structure,
error style,
and implementation layout.
```

For a production Java engineer, full generation is usually too blunt.

### 3.2 Generated Controller Classes with Manual Logic

You generate controllers and then fill them in.

This is attractive but dangerous.

The problem is regeneration.

If generated files are modified manually, the next generation may overwrite or conflict with your work.

Failure mode:

```text
Generated file contains manual business logic.
Regeneration changes generated file.
Manual edits are lost or merge-conflicted.
Team stops regenerating.
Contract drifts.
```

This is one of the most common OpenAPI server-generation failures.

### 3.3 Generated API Interface + Manual Implementation

You generate only an interface or a narrow boundary contract, then implement it manually.

Example shape:

```java
public interface CasesApi {
    ResponseEntity<CaseResponse> getCase(UUID caseId);
    ResponseEntity<CaseResponse> createCase(CreateCaseRequest request);
}
```

Manual implementation:

```java
@RestController
public class CasesController implements CasesApi {

    private final CreateCaseUseCase createCaseUseCase;
    private final GetCaseUseCase getCaseUseCase;
    private final CaseApiMapper mapper;

    public CasesController(
            CreateCaseUseCase createCaseUseCase,
            GetCaseUseCase getCaseUseCase,
            CaseApiMapper mapper
    ) {
        this.createCaseUseCase = createCaseUseCase;
        this.getCaseUseCase = getCaseUseCase;
        this.mapper = mapper;
    }

    @Override
    public ResponseEntity<CaseResponse> getCase(UUID caseId) {
        CaseView view = getCaseUseCase.getCase(new CaseId(caseId));
        return ResponseEntity.ok(mapper.toResponse(view));
    }

    @Override
    public ResponseEntity<CaseResponse> createCase(CreateCaseRequest request) {
        CreateCaseCommand command = mapper.toCommand(request);
        CaseView created = createCaseUseCase.create(command);
        return ResponseEntity.status(HttpStatus.CREATED).body(mapper.toResponse(created));
    }
}
```

This is often the best production pattern.

The generated interface acts as a compile-time boundary.

Your manual controller remains simple and intentionally mapped.

### 3.4 Generated Delegate Pattern

Some generator configurations create a controller that delegates to a manually implemented delegate.

Generated controller:

```text
HTTP request → generated controller → generated delegate interface
```

Manual delegate:

```java
@Component
public class CasesApiDelegateImpl implements CasesApiDelegate {

    private final CreateCaseUseCase createCaseUseCase;
    private final CaseApiMapper mapper;

    @Override
    public ResponseEntity<CaseResponse> createCase(CreateCaseRequest request) {
        CreateCaseCommand command = mapper.toCommand(request);
        CaseView result = createCaseUseCase.create(command);
        return ResponseEntity.status(HttpStatus.CREATED).body(mapper.toResponse(result));
    }
}
```

This can work well if the generated controller remains untouched.

The invariant is:

> Manual code implements generated extension points; manual code does not edit generated files.

---

## 4. Recommended Architecture for Serious Java Services

For production systems, especially long-lived or regulated systems, use this structure:

```text
src/main/openapi/
  case-api.yaml

build/generated/openapi/
  src/main/java/... generated API interfaces and models

src/main/java/com/acme/caseapi/api/
  CaseController.java              // manual boundary adapter
  CaseExceptionHandler.java         // manual error mapping
  CaseApiMapper.java                // manual/generated mapper boundary

src/main/java/com/acme/caseapi/application/
  CreateCaseUseCase.java
  GetCaseUseCase.java
  EscalateCaseUseCase.java

src/main/java/com/acme/caseapi/domain/
  Case.java
  CaseId.java
  CaseState.java
  CaseStateMachine.java
  EnforcementDecision.java

src/main/java/com/acme/caseapi/infrastructure/
  JpaCaseRepository.java
  S3EvidenceStore.java
  NotificationPublisher.java
```

Generated OpenAPI code should sit in a generated source directory.

Manual code should depend on generated API boundary types only at the edge.

Domain code should not import generated classes.

Bad dependency direction:

```text
Domain → generated OpenAPI DTO
```

Good dependency direction:

```text
API adapter → generated OpenAPI DTO
API adapter → application command/query
Application → domain
Infrastructure → domain/application ports
```

The API adapter is allowed to know both external DTOs and internal use cases.

The domain should not know HTTP, OpenAPI, Jackson, Spring MVC, `ResponseEntity`, generated enums, or generated DTO classes.

---

## 5. The Golden Rule: Generated Code Is Boundary Code

A useful rule:

> Treat generated server code like a foreign interface package.

It is not “your model”.

It is a representation of another party’s expectations.

This is similar to consuming an external SDK:

- You do not want your domain polluted by third-party SDK classes.
- You do not want persistence entities polluted by API DTOs.
- You do not want your application services accepting raw HTTP boundary types.

Instead, create translation boundaries.

Example:

```java
public final class CaseApiMapper {

    public CreateCaseCommand toCommand(CreateCaseRequest request) {
        return new CreateCaseCommand(
                new SubjectId(request.getSubjectId()),
                request.getAllegationCodes().stream()
                        .map(AllegationCode::new)
                        .toList(),
                request.getNarrative(),
                request.getReceivedAt()
        );
    }

    public CaseResponse toResponse(CaseView view) {
        CaseResponse response = new CaseResponse();
        response.setId(view.id().value());
        response.setStatus(toApiStatus(view.status()));
        response.setCreatedAt(view.createdAt());
        response.setUpdatedAt(view.updatedAt());
        return response;
    }

    private CaseResponse.StatusEnum toApiStatus(CaseStatus status) {
        return switch (status) {
            case DRAFT -> CaseResponse.StatusEnum.DRAFT;
            case SUBMITTED -> CaseResponse.StatusEnum.SUBMITTED;
            case UNDER_REVIEW -> CaseResponse.StatusEnum.UNDER_REVIEW;
            case CLOSED -> CaseResponse.StatusEnum.CLOSED;
        };
    }
}
```

The mapping may look repetitive.

That repetition is often architectural protection.

It prevents external contract changes from silently mutating internal domain meaning.

---

## 6. Generated DTOs vs Domain Objects

Generated DTOs are transport objects.

They answer:

> What shape does the API expose or accept over HTTP?

Domain objects answer:

> What concepts and invariants does the business system enforce?

Persistence entities answer:

> How do we store and retrieve state efficiently and consistently?

These three should not be collapsed casually.

### 6.1 Generated DTO Example

```java
public class CaseResponse {
    private UUID id;
    private StatusEnum status;
    private String title;
    private OffsetDateTime createdAt;
    private OffsetDateTime updatedAt;
}
```

### 6.2 Domain Model Example

```java
public class EnforcementCase {

    private final CaseId id;
    private CaseState state;
    private final SubjectId subjectId;
    private final List<Allegation> allegations;
    private final AuditTrail auditTrail;

    public void submit(UserId actor, Clock clock) {
        if (!state.canSubmit()) {
            throw new InvalidCaseTransition(id, state, CaseAction.SUBMIT);
        }
        state = state.submit();
        auditTrail.record(actor, CaseAction.SUBMIT, clock.instant());
    }
}
```

### 6.3 Persistence Entity Example

```java
@Entity
@Table(name = "enforcement_case")
public class CaseJpaEntity {

    @Id
    private UUID id;

    @Column(name = "state_code")
    private String stateCode;

    @Column(name = "subject_id")
    private UUID subjectId;

    @Version
    private long version;
}
```

They overlap.

They are not the same.

If you make them the same, every API evolution becomes a domain/persistence evolution whether you intended it or not.

---

## 7. Boundary Mapping Patterns

There are several ways to map generated DTOs to internal models.

### 7.1 Manual Mapping

Manual mapping is explicit and safe.

```java
CreateCaseCommand command = new CreateCaseCommand(
        new SubjectId(request.getSubjectId()),
        request.getNarrative(),
        request.getReceivedAt()
);
```

Pros:

- very readable,
- easy to debug,
- explicit semantic decisions,
- no hidden reflection,
- good for critical systems.

Cons:

- repetitive,
- needs discipline,
- can drift if not tested.

### 7.2 MapStruct

MapStruct can reduce boilerplate while staying compile-time safe.

```java
@Mapper(componentModel = "spring")
public interface CaseApiMapper {

    @Mapping(target = "subjectId", expression = "java(new SubjectId(request.getSubjectId()))")
    CreateCaseCommand toCommand(CreateCaseRequest request);

    CaseResponse toResponse(CaseView view);
}
```

Pros:

- compile-time generation,
- less boilerplate,
- good IDE support,
- avoids runtime reflection.

Cons:

- complex mappings can become annotation-heavy,
- semantic transformations can be hidden,
- generated mapper logic must still be tested.

### 7.3 Generic Object Mapping

Example: reflection-based object mappers.

Pros:

- very little code.

Cons:

- weak semantic visibility,
- runtime surprises,
- accidental field mapping,
- dangerous for high-risk systems.

For contract boundaries, generic mapping is often too implicit.

### 7.4 Recommended Rule

Use manual or MapStruct mapping for API boundary translation.

Avoid magical mapping for:

- security-sensitive fields,
- regulatory data,
- financial amounts,
- permissions,
- state transitions,
- audit records,
- error models,
- enums with business meaning.

---

## 8. Request Validation at the Boundary

Server stubs often generate validation annotations from schema constraints.

For example, OpenAPI schema:

```yaml
CreateCaseRequest:
  type: object
  required:
    - subjectId
    - narrative
  properties:
    subjectId:
      type: string
      format: uuid
    narrative:
      type: string
      minLength: 20
      maxLength: 10000
```

May become Java Bean Validation style annotations:

```java
public class CreateCaseRequest {

    @NotNull
    private UUID subjectId;

    @NotNull
    @Size(min = 20, max = 10000)
    private String narrative;
}
```

This is useful.

But it only covers structural validation.

It does not prove business validity.

Examples of structural validation:

- field required,
- field length,
- UUID shape,
- numeric range,
- enum membership,
- array length.

Examples of semantic validation:

- subject exists,
- user can create case for subject,
- allegation code is valid for jurisdiction,
- case can be escalated from current state,
- evidence belongs to the case,
- decision is allowed by role,
- appeal window is still open.

The correct layering:

```text
Generated/Bean validation:
  Is the HTTP payload structurally valid?

Application validation:
  Is the requested use case allowed and meaningful?

Domain validation:
  Are invariants preserved?
```

Do not overload OpenAPI schema with all business rules.

OpenAPI can document some expectations, but many business rules are contextual and runtime-dependent.

---

## 9. Response Validation

Most teams validate requests.

Fewer validate responses.

This is a gap.

If your service claims a response shape in OpenAPI, your implementation should not accidentally return invalid data.

Common response drift examples:

- returning `null` for a required response field,
- returning an undocumented enum value,
- returning string date instead of date-time,
- omitting error fields,
- returning internal status values,
- returning extra sensitive fields,
- returning different error shape from different exception handlers.

Response validation can happen in:

1. Integration tests.
2. Contract tests.
3. Runtime middleware for non-production environments.
4. Consumer-driven compatibility tests.
5. CI examples validation.

For production performance, runtime response validation may be too expensive or too noisy. But test-time response validation is extremely valuable.

The invariant:

> Provider tests should prove that actual responses conform to the published OpenAPI contract.

---

## 10. Error Mapping in Generated Server Architecture

Generated stubs rarely solve error modelling fully.

They can expose response declarations, but they do not know how your domain exceptions map to HTTP responses.

You need a manual error mapping layer.

Example domain exceptions:

```java
public sealed class CaseException extends RuntimeException
        permits CaseNotFound, InvalidCaseTransition, DuplicateCaseSubmission {
}

public final class CaseNotFound extends CaseException {
    private final CaseId caseId;
}

public final class InvalidCaseTransition extends CaseException {
    private final CaseId caseId;
    private final CaseState currentState;
    private final CaseAction attemptedAction;
}
```

Manual API exception handler:

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(CaseNotFound.class)
    ResponseEntity<Problem> handle(CaseNotFound ex) {
        Problem problem = new Problem()
                .type("https://api.acme.test/problems/case-not-found")
                .title("Case not found")
                .status(404)
                .detail("The requested case does not exist or is not visible to the caller.");

        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(problem);
    }

    @ExceptionHandler(InvalidCaseTransition.class)
    ResponseEntity<Problem> handle(InvalidCaseTransition ex) {
        Problem problem = new Problem()
                .type("https://api.acme.test/problems/invalid-case-transition")
                .title("Invalid case transition")
                .status(409)
                .detail("The requested transition is not allowed from the current case state.");

        return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
    }
}
```

The error schema should be in OpenAPI.

The mapping logic should be manual and tested.

Do not let random exceptions leak into generated default error responses.

---

## 11. `ResponseEntity` vs Domain Return Types

Generated Spring interfaces often use `ResponseEntity<T>`.

At the API boundary, this is fine.

Inside the application layer, it is bad.

Bad:

```java
public interface CreateCaseUseCase {
    ResponseEntity<CaseResponse> create(CreateCaseRequest request);
}
```

This couples application logic to:

- Spring Web,
- generated DTOs,
- HTTP status codes,
- external contract structure.

Good:

```java
public interface CreateCaseUseCase {
    CaseView create(CreateCaseCommand command);
}
```

Controller boundary:

```java
@Override
public ResponseEntity<CaseResponse> createCase(CreateCaseRequest request) {
    CreateCaseCommand command = mapper.toCommand(request);
    CaseView result = createCaseUseCase.create(command);
    return ResponseEntity.status(HttpStatus.CREATED).body(mapper.toResponse(result));
}
```

The HTTP adapter decides status codes.

The use case returns application result.

Domain remains clean.

---

## 12. Interface Generation Pattern

One robust pattern is:

```text
OpenAPI spec
  ↓ generate
Generated API interface + generated DTOs
  ↓ implement manually
Controller implements generated interface
  ↓ calls
Application use cases
```

Example package structure:

```text
com.acme.generated.api.CasesApi
com.acme.generated.model.CreateCaseRequest
com.acme.generated.model.CaseResponse

com.acme.caseapi.adapter.http.CasesController
com.acme.caseapi.adapter.http.CaseApiMapper
com.acme.caseapi.application.CreateCaseUseCase
com.acme.caseapi.domain.EnforcementCase
```

The generated package is clearly named `generated`.

That naming is not cosmetic.

It tells engineers:

> Do not hand-edit this. Do not treat it as domain code. Do not import it outside adapter boundaries without thought.

---

## 13. Delegate Pattern

The delegate pattern is useful when the generator owns the controller shell.

Conceptually:

```text
Generated controller:
  - route mapping
  - parameter binding
  - request body binding
  - validation hook
  - delegates to interface

Manual delegate:
  - maps request
  - calls use case
  - maps response
```

Good delegate implementation:

```java
@Component
public class CasesApiDelegateImpl implements CasesApiDelegate {

    private final SubmitCaseUseCase submitCaseUseCase;
    private final CaseApiMapper mapper;

    @Override
    public ResponseEntity<CaseResponse> submitCase(UUID caseId, SubmitCaseRequest request) {
        SubmitCaseCommand command = mapper.toCommand(caseId, request);
        CaseView view = submitCaseUseCase.submit(command);
        return ResponseEntity.ok(mapper.toResponse(view));
    }
}
```

Bad delegate implementation:

```java
@Override
public ResponseEntity<CaseResponse> submitCase(UUID caseId, SubmitCaseRequest request) {
    CaseJpaEntity entity = repository.findById(caseId).orElseThrow();
    entity.setStatus("SUBMITTED");
    repository.save(entity);
    CaseResponse response = new CaseResponse();
    response.setId(entity.getId());
    response.setStatus(CaseResponse.StatusEnum.SUBMITTED);
    return ResponseEntity.ok(response);
}
```

Why bad?

Because the delegate becomes application service, domain logic, and persistence logic all at once.

Generated server boundary did not cause that problem.

But it made it easy to hide.

---

## 14. Avoiding Generated Architecture Domination

Generated code dominates architecture when:

- generated models are used everywhere,
- generated controllers contain business logic,
- generated package names become main package names,
- regeneration is avoided because manual edits exist,
- generator options decide domain types,
- OpenAPI schema naming dictates database naming,
- service methods are shaped around HTTP instead of use cases.

A top-tier Java architecture treats generated server stubs as adapters.

Think hexagonal architecture:

```text
External HTTP world
    ↓
Generated OpenAPI adapter surface
    ↓
Manual HTTP adapter
    ↓
Application port/use case
    ↓
Domain
```

The adapter may be regenerated.

The application core should not care.

---

## 15. Regeneration Safety

Server generation is only useful if you can regenerate safely.

Safe regeneration requires:

1. Generated files are not manually edited.
2. Generated output directory is clear.
3. Manual code depends on stable generated interfaces.
4. Generator version is pinned.
5. Generator options are committed.
6. Generated output is either reproducible in build or committed with strict policy.
7. CI detects accidental drift.
8. Contract changes are reviewed before regeneration.

### 15.1 Bad Workflow

```text
Developer edits generated controller.
Spec changes.
Generator overwrites controller.
Manual logic lost.
Team stops regenerating.
Spec and implementation diverge.
```

### 15.2 Better Workflow

```text
Spec changes in PR.
CI validates/lints/diffs spec.
Generator runs.
Generated interface changes.
Manual implementation no longer compiles if incompatible.
Developer fixes adapter/mapping.
Provider tests validate behavior.
Contract artifact is published.
```

Compilation failure is useful.

It reveals contract-impacting implementation work.

---

## 16. Should Generated Code Be Committed?

There is no universal answer.

### 16.1 Commit Generated Code

Pros:

- easier IDE onboarding,
- consumers see diff in generated API shape,
- no generator required for basic compile in some environments,
- reproducibility issues are visible.

Cons:

- noisy diffs,
- merge conflicts,
- generated code churn,
- risk of manual edits.

### 16.2 Do Not Commit Generated Code

Pros:

- repository stays cleaner,
- generated output is always build-derived,
- less noise in PR.

Cons:

- build depends on generator availability,
- harder to inspect generated changes,
- IDE setup can be more fragile,
- generator version must be pinned carefully.

### 16.3 Practical Recommendation

For server stubs:

- commit the OpenAPI spec,
- commit generator config,
- pin generator version,
- generate into build directory,
- do not manually edit generated code,
- optionally commit generated code only if your organization requires review of generated artifact diffs.

For regulated systems, you may want generated artifacts stored as release artifacts even if not committed to main source.

---

## 17. Maven Integration Pattern

A typical Maven pattern:

```xml
<plugin>
  <groupId>org.openapitools</groupId>
  <artifactId>openapi-generator-maven-plugin</artifactId>
  <version>${openapi.generator.version}</version>
  <executions>
    <execution>
      <goals>
        <goal>generate</goal>
      </goals>
      <configuration>
        <inputSpec>${project.basedir}/src/main/openapi/case-api.yaml</inputSpec>
        <generatorName>spring</generatorName>
        <apiPackage>com.acme.caseapi.generated.api</apiPackage>
        <modelPackage>com.acme.caseapi.generated.model</modelPackage>
        <invokerPackage>com.acme.caseapi.generated.invoker</invokerPackage>
        <generateApiTests>false</generateApiTests>
        <generateModelTests>false</generateModelTests>
        <configOptions>
          <interfaceOnly>true</interfaceOnly>
          <useSpringBoot3>true</useSpringBoot3>
          <useTags>true</useTags>
          <dateLibrary>java8</dateLibrary>
        </configOptions>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Exact options depend on generator version and organization preferences.

Important principles:

- pin plugin version,
- commit config,
- isolate package names,
- prefer interface/delegate generation for production,
- disable unused generated tests if they are noise,
- align Jakarta/Javax settings with Spring Boot generation target,
- avoid changing generator options casually because generated public type shapes may change.

---

## 18. Gradle Integration Pattern

Conceptual Gradle setup:

```kotlin
plugins {
    id("org.openapi.generator") version "x.y.z"
}

openApiGenerate {
    generatorName.set("spring")
    inputSpec.set("$rootDir/src/main/openapi/case-api.yaml")
    outputDir.set("$buildDir/generated/openapi")
    apiPackage.set("com.acme.caseapi.generated.api")
    modelPackage.set("com.acme.caseapi.generated.model")
    invokerPackage.set("com.acme.caseapi.generated.invoker")
    configOptions.set(
        mapOf(
            "interfaceOnly" to "true",
            "useSpringBoot3" to "true",
            "useTags" to "true",
            "dateLibrary" to "java8"
        )
    )
}

sourceSets {
    main {
        java {
            srcDir("$buildDir/generated/openapi/src/main/java")
        }
    }
}

tasks.compileJava {
    dependsOn(tasks.openApiGenerate)
}
```

Again, do not copy this blindly.

The point is the workflow:

```text
OpenAPI spec → generated source directory → compile against generated boundary
```

---

## 19. Jakarta vs Javax, Spring Boot 2 vs Spring Boot 3

Spring Boot 3 moved to Jakarta EE namespaces.

That means generated code must align with your framework version.

Common mismatch:

```text
Application uses Spring Boot 3 / jakarta.*
Generated code imports javax.validation.* or javax.annotation.*
Compilation fails.
```

This is not merely a dependency problem.

It is a generator configuration problem.

Rule:

> Treat framework namespace selection as part of the contract build configuration.

Pin it.

Review it.

Do not let different developers generate different source shapes.

---

## 20. Date, Time, UUID, and Numeric Types

Generated server models need type mappings.

Typical examples:

| OpenAPI schema | Java candidate | Notes |
|---|---|---|
| `type: string`, `format: uuid` | `UUID` | Good for IDs if all IDs are UUIDs. Domain may still wrap in value object. |
| `type: string`, `format: date` | `LocalDate` | Date without time zone. |
| `type: string`, `format: date-time` | `OffsetDateTime` or `Instant` | Be explicit about offset semantics. |
| `type: integer`, `format: int64` | `Long` | Beware Java primitive nullability. |
| `type: number` | `BigDecimal` or `Double` | Use `BigDecimal` for money/precision. |
| `type: string`, `format: binary` | `MultipartFile`, `Resource`, or stream type | Depends on framework and generator. |

Do not assume generated type is your domain type.

Example:

```java
new CaseId(generatedRequest.getCaseId())
```

is often better than passing `UUID` everywhere.

---

## 21. Enums in Generated Server Code

Generated enums are useful but risky.

OpenAPI:

```yaml
CaseStatus:
  type: string
  enum:
    - DRAFT
    - SUBMITTED
    - UNDER_REVIEW
    - CLOSED
```

Generated Java:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    CLOSED
}
```

Do not reuse generated API enum as domain enum.

Why?

Because API enum and domain enum can evolve differently.

API may keep deprecated external values for compatibility.

Domain may split internal states.

Domain may have internal states not exposed externally.

Example:

```java
private CaseResponse.StatusEnum toApiStatus(CaseState state) {
    return switch (state) {
        case DRAFT -> CaseResponse.StatusEnum.DRAFT;
        case SUBMITTED -> CaseResponse.StatusEnum.SUBMITTED;
        case TRIAGE_PENDING, ASSIGNED, INVESTIGATING -> CaseResponse.StatusEnum.UNDER_REVIEW;
        case CLOSED_NO_ACTION, CLOSED_ENFORCEMENT -> CaseResponse.StatusEnum.CLOSED;
    };
}
```

That mapping is semantic.

Do not erase it by sharing enums.

---

## 22. Nullability and Required Fields

Generated server DTOs often encode required/optional/nullability through:

- Bean Validation annotations,
- nullable annotations,
- Java boxed types,
- generated builders,
- Jackson annotations,
- optional library settings.

Be careful.

OpenAPI concepts:

- property absent,
- property present with null,
- property required,
- property optional,
- default value,
- read-only/write-only.

Java concepts:

- `null`,
- primitive default values,
- boxed types,
- `Optional`,
- validation annotations,
- Jackson inclusion rules.

They do not map perfectly.

Bad pattern:

```java
public void update(UpdateCaseRequest request) {
    if (request.getPriority() == null) {
        // Does null mean omitted, explicitly null, or generated default?
    }
}
```

For PATCH-like semantics, generated DTOs may be insufficient because Java `null` cannot distinguish absent vs explicit null unless special wrappers or JSON node-level parsing are used.

In high-precision APIs, model partial updates deliberately.

---

## 23. Multipart and File Upload Server Stubs

OpenAPI can describe multipart forms.

Example:

```yaml
requestBody:
  required: true
  content:
    multipart/form-data:
      schema:
        type: object
        required:
          - file
          - evidenceType
        properties:
          file:
            type: string
            format: binary
          evidenceType:
            type: string
            enum: [DOCUMENT, IMAGE, VIDEO]
          description:
            type: string
```

Generated Spring code may expose `MultipartFile`, `Resource`, or another framework-specific type depending on generator configuration.

Do not push file upload types into domain.

Boundary handling should convert:

```text
MultipartFile
  → virus scan / content-type check / size check
  → storage command
  → EvidenceUploadCommand
  → application use case
```

Domain should receive metadata and storage references, not raw web framework multipart objects.

---

## 24. Streaming and Large Payloads

Generated stubs are often weakest around:

- streaming downloads,
- large file uploads,
- server-sent events,
- chunked transfer,
- backpressure,
- reactive endpoints,
- long-running response streams.

OpenAPI can describe binary payloads and media types, but the runtime implementation has framework-specific concerns.

For large payloads, avoid letting generated DTO abstractions force buffering.

Architecture should explicitly decide:

- streaming vs buffering,
- max size,
- timeout,
- scan pipeline,
- checksum,
- content disposition,
- retry behavior,
- storage lifecycle.

Generated server code is scaffolding, not the final streaming architecture.

---

## 25. JAX-RS Server Generation

Spring is common, but not the only Java server target.

JAX-RS generators can produce resource interfaces/classes for Jersey or similar ecosystems.

Typical shapes:

```java
@Path("/cases")
public class CasesApi {

    @POST
    @Consumes({ "application/json" })
    @Produces({ "application/json" })
    public Response createCase(CreateCaseRequest request) {
        // generated placeholder or delegate
    }
}
```

The same architectural rules apply:

- keep generated boundary separate,
- avoid manual edits to generated files,
- map DTOs to application commands,
- do not leak JAX-RS `Response` into domain/application layer,
- centralize error mapping,
- test provider contract conformance.

Framework changes.

Boundary discipline does not.

---

## 26. Generated Server Code and Reactive Stacks

In Spring WebFlux or reactive architectures, generated server stubs may use types such as:

```java
Mono<ResponseEntity<CaseResponse>>
Flux<CaseEvent>
```

Reactive boundary code raises additional concerns:

- backpressure,
- blocking calls inside reactive chain,
- transaction boundaries,
- context propagation,
- security context propagation,
- error mapping in reactive pipelines,
- generated model serialization.

Do not let the generator decide whether your application core is reactive.

You may choose:

```text
Reactive HTTP adapter → imperative use case wrapped safely
```

or:

```text
Reactive HTTP adapter → reactive application port → reactive infrastructure
```

But it must be explicit.

Reactive generated signatures can infect the application if you are careless.

---

## 27. Testing Generated Server Integration

You need several layers of tests.

### 27.1 Compile-Time Contract Alignment

Generated interface changes should break manual implementation compilation when necessary.

This catches:

- renamed operation,
- changed parameters,
- changed request type,
- changed response type,
- deleted endpoint.

### 27.2 Controller Adapter Tests

Test mapping and status code behavior.

Example:

```java
@Test
void createCaseReturns201AndResponseBody() {
    CreateCaseRequest request = new CreateCaseRequest()
            .subjectId(UUID.randomUUID())
            .narrative("A sufficiently detailed complaint narrative...");

    when(createCaseUseCase.create(any()))
            .thenReturn(new CaseView(...));

    ResponseEntity<CaseResponse> response = controller.createCase(request);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    assertThat(response.getBody().getId()).isNotNull();
}
```

### 27.3 Web Layer Tests

Use MockMvc/WebTestClient to test actual routing, binding, validation, and serialization.

### 27.4 Contract Response Validation

Validate actual HTTP responses against OpenAPI schema.

### 27.5 Error Contract Tests

Ensure exceptions produce documented Problem responses.

### 27.6 Regeneration Tests

CI should verify generated sources are up to date if generated output is committed.

---

## 28. How Server Generation Supports Contract-First Development

A contract-first workflow looks like:

```text
1. Design OpenAPI operation.
2. Review contract with consumers.
3. Lint and validate spec.
4. Generate server boundary.
5. Manual implementation fails compile until adapter is implemented.
6. Write provider tests against contract.
7. Publish spec and deploy service.
```

This is powerful because the OpenAPI contract drives implementation shape.

But the implementation remains architecturally clean if you keep generated code at the boundary.

This is the sweet spot.

---

## 29. When Not to Use Server Stub Generation

Do not use server generation blindly.

It may be the wrong tool when:

1. Your API is tiny and stable.
2. Your framework already generates accurate OpenAPI from well-disciplined code.
3. Your team cannot maintain generator configuration.
4. Generator output fights your architecture.
5. You need highly customized streaming behavior.
6. You need unusual framework features not supported by generator.
7. The generated code causes more churn than value.
8. Your organization has no contract-first review culture.

In those cases, code-first plus strict generated-spec diffing may be more practical.

The goal is not “use generation”.

The goal is:

> keep implementation and contract aligned with minimum accidental complexity.

---

## 30. The Most Common Failure Modes

### 30.1 Editing Generated Files

This is the classic failure.

Fix:

- generated files are never manually edited,
- manual code implements interfaces/delegates,
- CI enforces regeneration.

### 30.2 Domain Depends on Generated DTOs

Bad:

```java
public Case createCase(CreateCaseRequest request) { ... }
```

Fix:

```java
public Case createCase(CreateCaseCommand command) { ... }
```

### 30.3 Generated Enums Become Domain Enums

This creates hidden compatibility coupling.

Fix:

- map API enum to domain enum explicitly.

### 30.4 No Error Mapping Layer

Generated stubs do not solve domain errors.

Fix:

- `@RestControllerAdvice` or equivalent,
- documented Problem schemas,
- error contract tests.

### 30.5 No Response Validation

Requests validate; responses drift.

Fix:

- contract tests validate actual provider responses.

### 30.6 Generator Version Not Pinned

Different generated outputs appear across machines/CI.

Fix:

- pin generator version,
- commit config,
- use reproducible build.

### 30.7 Regeneration Is Manual and Rare

Spec and implementation drift.

Fix:

- generate in build,
- CI validates generated output,
- contract changes are normal PR activity.

### 30.8 Tool-Driven Architecture

Generated package structure becomes application architecture.

Fix:

- adapter boundary,
- application layer,
- domain layer,
- infrastructure layer.

---

## 31. Production Checklist

Before adopting server generation, answer these questions.

### Contract

- Is the OpenAPI spec the intended source of truth?
- Is the spec validated and linted?
- Is breaking-change detection in place?
- Are examples valid?
- Are error responses documented?

### Generation

- Is generator version pinned?
- Is generator config committed?
- Is generated package clearly isolated?
- Are generated files never manually edited?
- Is the generated output reproducible?

### Java Architecture

- Are generated DTOs limited to API adapter layer?
- Are application use cases free from HTTP/Spring/OpenAPI classes?
- Are domain models free from generated classes?
- Is mapping explicit and tested?
- Are generated enums mapped to domain enums?

### Validation

- Are request constraints enforced?
- Are semantic validations handled in application/domain layer?
- Are provider responses validated against contract?
- Are error responses validated?

### Operations

- Does CI generate/compile/test consistently?
- Are generated artifact changes reviewable?
- Is the published contract tied to release version?
- Can consumers know which implementation version supports which contract?

---

## 32. Decision Matrix

| Situation | Recommended approach |
|---|---|
| New public/partner API | Contract-first + generated interface/delegate + manual implementation |
| Internal microservice with many consumers | Contract-first or hybrid + generated boundary + contract tests |
| Existing Spring Boot API | Code-first discovery may be okay, but add diff/lint/contract tests |
| Regulated system | Contract-first + generated boundary + traceability + response validation |
| Prototype | Full generated server may be acceptable |
| Highly custom streaming API | Manual boundary with OpenAPI validation may be better |
| Small internal admin endpoint | Avoid overengineering; code-first may suffice |
| Long-lived SDK ecosystem | Contract-first strongly preferred |

---

## 33. Worked Mini Case: Enforcement Case API

OpenAPI operation:

```yaml
paths:
  /cases/{caseId}/submit:
    post:
      operationId: submitCase
      tags:
        - Cases
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SubmitCaseRequest'
      responses:
        '200':
          description: Case submitted
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseResponse'
        '400':
          $ref: '#/components/responses/BadRequest'
        '404':
          $ref: '#/components/responses/NotFound'
        '409':
          $ref: '#/components/responses/Conflict'
```

Generated interface may look like:

```java
ResponseEntity<CaseResponse> submitCase(UUID caseId, SubmitCaseRequest request);
```

Manual controller/delegate:

```java
@Override
public ResponseEntity<CaseResponse> submitCase(UUID caseId, SubmitCaseRequest request) {
    SubmitCaseCommand command = mapper.toSubmitCommand(caseId, request);
    CaseView view = submitCaseUseCase.submit(command);
    return ResponseEntity.ok(mapper.toResponse(view));
}
```

Application use case:

```java
public final class SubmitCaseUseCase {

    private final CaseRepository caseRepository;
    private final AuthorizationService authorizationService;
    private final Clock clock;

    public CaseView submit(SubmitCaseCommand command) {
        EnforcementCase enforcementCase = caseRepository.get(command.caseId());

        authorizationService.requireCanSubmit(enforcementCase, command.actor());

        enforcementCase.submit(command.actor(), clock);

        caseRepository.save(enforcementCase);

        return CaseView.from(enforcementCase);
    }
}
```

Domain:

```java
public void submit(UserId actor, Clock clock) {
    if (!state.canSubmit()) {
        throw new InvalidCaseTransition(id, state, CaseAction.SUBMIT);
    }

    state = state.submit();
    auditTrail.record(actor, CaseAction.SUBMIT, clock.instant());
}
```

Error handler:

```java
@ExceptionHandler(InvalidCaseTransition.class)
ResponseEntity<Problem> handle(InvalidCaseTransition ex) {
    Problem problem = problemFactory.conflict(
            "invalid-case-transition",
            "Invalid case transition",
            "The case cannot be submitted from its current state."
    );

    return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
}
```

This is the correct shape:

```text
OpenAPI operation
  → generated interface
  → manual adapter
  → application use case
  → domain state machine
  → persistence
  → mapped response
  → documented error model
```

The generated code helps enforce the boundary.

It does not replace the architecture.

---

## 34. Heuristics for Top 1% Usage

1. Generate only what you can regenerate safely.
2. Prefer generated interfaces/delegates over editable generated controllers.
3. Keep generated DTOs at the API adapter boundary.
4. Never let generated OpenAPI models become domain models by default.
5. Map API enums to domain enums explicitly.
6. Treat request validation as structural, not complete business validation.
7. Validate responses in provider tests.
8. Centralize error mapping.
9. Pin generator versions and config.
10. Make generated code boring, isolated, and replaceable.
11. Let compile errors reveal contract changes.
12. Use contract-first for important external/partner/regulatory APIs.
13. Use code-first only when governance and drift controls are strong.
14. Avoid full project generation for serious long-lived services unless you have strong reasons.
15. Review generated output shape before standardizing it organization-wide.

---

## 35. Summary

Server stub generation is valuable when used as an API boundary enforcement tool.

It becomes dangerous when used as an architecture generator.

The best production pattern for Java services is usually:

```text
OpenAPI spec
  → generated API interface/delegate and DTOs
  → manual adapter implementation
  → explicit mapper
  → application use cases
  → domain model
  → infrastructure
```

Generated server stubs should make contract drift harder.

They should not make domain design weaker.

The architectural invariant is simple:

> OpenAPI-generated server code belongs at the boundary. The core system must remain deliberately designed.

---

## 36. Part 023 Completion Checklist

You should now be able to:

- Explain what server stub generation is and is not.
- Compare full server generation, controller generation, interface generation, and delegate pattern.
- Design a safe generated-code package boundary.
- Keep generated DTOs out of domain logic.
- Map generated requests/responses to application commands/views.
- Handle validation in the correct layer.
- Centralize error mapping.
- Recognize regeneration hazards.
- Decide whether generated code should be committed.
- Integrate OpenAPI server generation with Maven/Gradle conceptually.
- Avoid tool-driven architecture.

---

# End of Part 023

Next file:

`learn-openapi-mastery-for-java-engineers-part-024.md`

Next topic:

**OpenAPI for Microservices and Platform Engineering**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-022.md">⬅️ OpenAPI Mastery for Java Engineers — Part 022</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-024.md">OpenAPI Mastery for Java Engineers — Part 024 ➡️</a>
</div>
