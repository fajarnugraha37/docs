# Strict Coding Standards: Java Spring Framework

> Scope: Spring Framework core usage in Java applications: IoC/DI, bean lifecycle, configuration, events, validation, data binding, AOP, transaction management, scheduling, caching, web abstractions, test support, and framework integration.
>
> This standard is an overlay on top of the baseline Java standard (`strict-coding-standards__java11.md`, `java17.md`, `java21.md`, or `java25.md`) and adjacent standards such as `java_security.md`, `java_validation.md`, `java_concurrency.md`, `java_http.md`, `jpa.md`, `jdbc.md`, and `java_testing.md`.

---

## 1. Purpose

Spring must be used as an application composition framework, not as a place to hide architecture decisions.

LLM-generated Spring code must satisfy these goals:

1. dependency wiring is explicit and testable;
2. business logic is not hidden in annotations, aspects, listeners, or lifecycle callbacks;
3. transaction, security, retry, caching, and async behavior are visible at service boundaries;
4. Spring abstractions do not leak into the domain model unless explicitly justified;
5. auto-magic is treated as a dependency, not as a correctness proof.

---

## 2. Version and Namespace Policy

### 2.1 Baseline families

| Spring line                  | Typical companion |                                    Java baseline |                  Jakarta baseline | Default status                                      |
| ---------------------------- | ----------------: | -----------------------------------------------: | --------------------------------: | --------------------------------------------------- |
| Spring Framework 5.3.x       | Spring Boot 2.7.x |                             Java 8+ historically |                         `javax.*` | Legacy only                                         |
| Spring Framework 6.0/6.1/6.2 |   Spring Boot 3.x |                                         Java 17+ | Jakarta EE 9/10 style `jakarta.*` | Supported legacy-modern                             |
| Spring Framework 7.0.x       | Spring Boot 4.0.x | Java 17+; Java 25 recommended for latest LTS use |                     Jakarta EE 11 | Preferred for new greenfield when ecosystem permits |

Rules:

- **MUST** verify the Spring Framework, Spring Boot, Spring Data, Spring Security, Spring Cloud, Jakarta EE, Hibernate, Jackson, and build plugin compatibility matrix before upgrading.
- **MUST NOT** mix `javax.*` and `jakarta.*` framework APIs in the same runtime module.
- **MUST NOT** upgrade Spring Framework independently inside a Spring Boot application unless the Boot release train explicitly supports it.
- **MUST** document the target Spring generation in `README.md` or architecture notes.

### 2.2 Dependency governance

Allowed:

- Spring dependencies managed by Spring Boot BOM or a centrally owned platform BOM.
- Direct Spring Framework dependencies only in libraries that intentionally do not use Spring Boot.

Forbidden:

- hardcoding random Spring artifact versions in leaf modules;
- using milestone, RC, snapshot, or nightly Spring artifacts in production code;
- mixing incompatible Spring module versions;
- using abandoned Spring extensions without owner approval;
- importing both `javax.validation.*` and `jakarta.validation.*` in new code.

---

## 3. Spring as Composition Layer

Spring code must have a clear boundary.

| Layer                       | Spring annotations allowed? | Rule                                                                                     |
| --------------------------- | --------------------------: | ---------------------------------------------------------------------------------------- |
| Domain model                |                  Usually no | Keep framework-agnostic unless there is a deliberate persistence/security reason.        |
| Application service         |                         Yes | Transaction, orchestration, authorization, idempotency, and use-case boundary live here. |
| Adapter/controller/listener |                         Yes | Convert external protocol to application command/query.                                  |
| Infrastructure              |                         Yes | Data sources, clients, messaging, repositories, schedulers, metrics.                     |
| Test fixtures               |                         Yes | Use Spring only where plain unit tests are insufficient.                                 |

Forbidden:

- annotating every class with `@Component` because it compiles;
- injecting Spring beans into entities/value objects;
- using `ApplicationContext.getBean(...)` as a service locator in business code;
- hiding control flow in listeners/aspects when direct orchestration is clearer.

---

## 4. Dependency Injection Rules

### 4.1 Constructor injection is mandatory by default

Use constructor injection for required dependencies.

```java
@Service
public class CaseAssignmentService {
    private final CaseRepository caseRepository;
    private final AssignmentPolicy assignmentPolicy;

    public CaseAssignmentService(CaseRepository caseRepository,
                                 AssignmentPolicy assignmentPolicy) {
        this.caseRepository = caseRepository;
        this.assignmentPolicy = assignmentPolicy;
    }
}
```

Rules:

- **MUST** use constructor injection for mandatory dependencies.
- **MUST** keep injected fields `private final` where possible.
- **MUST NOT** use field injection in production code.
- **MUST NOT** use `@Autowired` on fields.
- **MUST NOT** use optional injection to hide missing configuration.

Allowed exceptions:

- framework extension points that require setter injection;
- circular dependency refactoring in legacy code, with a TODO and design issue;
- optional infrastructure where absence is an explicit supported mode.

### 4.2 Dependency count limit

A class with too many injected dependencies is usually doing too much.

Rules:

- **SHOULD** keep constructor dependencies to 5 or fewer.
- **MUST** justify 6+ dependencies in review.
- **MUST** refactor if dependencies form unrelated clusters.

Smell:

```java
@Service
public class EverythingService {
    public EverythingService(A a, B b, C c, D d, E e, F f, G g, H h) { }
}
```

Better:

- split use cases;
- introduce policy/domain service;
- introduce adapter facade;
- separate command and query concerns.

---

## 5. Bean Design

### 5.1 Singleton bean safety

Spring beans are singleton by default.

Rules:

- **MUST** make singleton beans stateless or thread-safe.
- **MUST NOT** store request-specific mutable state in singleton fields.
- **MUST NOT** store user identity, tenant ID, request body, correlation ID, pagination state, or transaction state in bean fields.

Forbidden:

```java
@Service
public class UnsafeReportService {
    private String currentUserId;

    public Report generate(String userId) {
        this.currentUserId = userId;
        return doGenerate();
    }
}
```

Allowed:

```java
@Service
public class ReportService {
    public Report generate(UserId userId) {
        return doGenerate(userId);
    }
}
```

### 5.2 Bean naming

Rules:

- **MUST** name beans by role, not by framework mechanism.
- **MUST** use qualifiers when multiple beans share the same interface.
- **MUST NOT** rely on bean name side effects unless the framework requires it.

Examples:

- `caseRepository`
- `emailNotificationGateway`
- `primaryObjectMapper`
- `externalApiHttpClient`

Avoid:

- `myBean`
- `service1`
- `helper`
- `impl`

### 5.3 Bean scope

Rules:

- **MUST** use singleton scope by default.
- **MUST** justify `prototype`, `request`, `session`, or custom scopes.
- **MUST NOT** inject request/session-scoped beans into singleton beans without understanding proxy behavior.
- **MUST NOT** use scope as a substitute for explicit method parameters.

---

## 6. Configuration Classes

### 6.1 Configuration ownership

Rules:

- **MUST** put infrastructure wiring in `@Configuration` classes.
- **MUST** keep configuration classes free of business logic.
- **MUST** separate configuration by external system or concern.
- **MUST NOT** put all beans in one `AppConfig`.

Recommended structure:

```text
config/
  DatabaseConfig.java
  JacksonConfig.java
  HttpClientConfig.java
  MessagingConfig.java
  SecurityConfig.java
  SchedulingConfig.java
```

### 6.2 `@Bean` methods

Rules:

- **MUST** return interface/abstraction type where useful, but not at the cost of hiding required behavior.
- **MUST** configure timeouts, lifecycle, pool size, retry, and security properties explicitly for external clients.
- **MUST NOT** allocate expensive clients inside normal service methods.
- **MUST NOT** create new `ObjectMapper`, HTTP client, database pool, scheduler, or executor repeatedly.

### 6.3 Conditional beans

Rules:

- **MUST** document why a conditional bean exists.
- **MUST** test each condition path.
- **MUST NOT** use conditionals to silently change business behavior between environments.

---

## 7. Component Scanning

Rules:

- **MUST** keep the main application class at a package root that intentionally covers only application-owned packages.
- **MUST NOT** scan broad packages such as `com`, `org`, or vendor packages.
- **MUST** avoid accidental bean discovery from test fixtures or generated classes.
- **MUST** prefer explicit `@Import` or configuration modules for shared libraries.

Forbidden:

```java
@ComponentScan("com")
```

Allowed:

```java
@ComponentScan(basePackages = "com.example.enforcement")
```

---

## 8. Stereotype Annotation Rules

Use stereotypes to express architectural role.

| Annotation                               | Use for                             | Do not use for                                  |
| ---------------------------------------- | ----------------------------------- | ----------------------------------------------- |
| `@Component`                             | Generic infrastructure/component    | Catch-all for unclear classes                   |
| `@Service`                               | Application/domain service boundary | Utility classes or DTO mappers without behavior |
| `@Repository`                            | Persistence adapter/repository      | Service classes that happen to query DB         |
| `@Controller` / REST-specific controller | Web adapter                         | Business orchestration                          |
| `@Configuration`                         | Bean definitions                    | Runtime logic                                   |

Rules:

- **MUST** choose stereotype based on role.
- **MUST NOT** mark DTO, entity, enum, exception, utility, or value object as Spring component.
- **MUST NOT** mark mapper interfaces as Spring beans unless the mapper framework supports it intentionally.

---

## 9. Transaction Management

### 9.1 Boundary placement

Transactions must live at use-case/application service boundary.

Rules:

- **MUST** put `@Transactional` on public application service methods, not random private helpers.
- **MUST** avoid transaction annotations in controllers.
- **MUST** avoid long transactions around network calls, file I/O, sleeps, queues, or remote APIs.
- **MUST** separate read-only query transactions from write transactions.

Allowed:

```java
@Service
public class ApproveCaseUseCase {
    @Transactional
    public ApprovalResult approve(ApproveCaseCommand command) {
        // load aggregate, validate transition, persist, publish outbox record
    }
}
```

Forbidden:

```java
@RestController
class CaseController {
    @Transactional
    @PostMapping("/cases/{id}/approve")
    public ResponseEntity<?> approve(@PathVariable Long id) { ... }
}
```

### 9.2 Self-invocation

Spring proxy-based annotations do not apply to internal self-invocation.

Rules:

- **MUST NOT** rely on `@Transactional`, `@Async`, `@Cacheable`, `@Retryable`, or security annotations on methods called through `this.method()`.
- **MUST** move annotated behavior to another bean or redesign boundary.

### 9.3 Rollback semantics

Rules:

- **MUST** understand rollback rules before catching exceptions inside transactions.
- **MUST** not swallow exceptions that should trigger rollback.
- **MUST** explicitly configure checked exception rollback if business failure uses checked exceptions.
- **MUST** avoid `REQUIRES_NEW` unless compensating/outbox/audit behavior requires it.

Forbidden:

```java
@Transactional
public void update() {
    try {
        repository.save(entity);
    } catch (Exception ex) {
        log.warn("ignored", ex);
    }
}
```

---

## 10. AOP and Annotation-Driven Behavior

AOP is allowed only for cross-cutting concerns.

Allowed:

- transaction boundaries;
- metrics/tracing;
- security checks;
- auditing;
- idempotency guard;
- retry/resilience policy;
- validation.

Forbidden:

- core business branching hidden in aspects;
- aspects modifying domain state invisibly;
- catch-all pointcuts over broad packages;
- aspects that depend on parameter names without tests;
- aspects that swallow exceptions.

Rules:

- **MUST** document pointcut scope.
- **MUST** test aspect behavior.
- **MUST** include ordering rules if multiple aspects apply.
- **MUST** avoid annotation magic when explicit code is clearer.

---

## 11. Events

Spring application events are in-process signals, not durable messaging.

Rules:

- **MUST** use Spring events only for local in-process decoupling.
- **MUST NOT** use Spring events as a replacement for Kafka/SQS/RabbitMQ/outbox.
- **MUST** define transaction phase intentionally for transactional event listeners.
- **MUST** make listener failure behavior explicit.
- **MUST** avoid business-critical side effects in best-effort async listeners unless durable retry exists.

Allowed local event:

```java
public record CaseApprovedEvent(CaseId caseId, Instant approvedAt) {}
```

Forbidden assumption:

> “The event was published, therefore external notification is guaranteed.”

---

## 12. Validation and Data Binding

Rules:

- **MUST** validate external input at adapter boundary.
- **MUST** enforce domain invariants inside domain/application layer, not only with Bean Validation annotations.
- **MUST** use DTO/request objects for web/API input.
- **MUST NOT** bind request bodies directly to JPA entities.
- **MUST NOT** rely on field names from external clients without versioned API contract.

Spring binding guardrails:

- restrict bindable fields for form-style binding;
- do not expose internal mutable objects to binders;
- reject unknown fields where API strictness requires it;
- centralize conversion/formatter policy.

---

## 13. Web MVC / WebFlux Framework Rules

Spring Framework provides both Servlet-stack Spring MVC and reactive-stack Spring WebFlux. Do not mix models casually.

Rules:

- **MUST** choose MVC or WebFlux based on runtime model and dependencies.
- **MUST NOT** use WebFlux only because it is “newer.”
- **MUST NOT** block event-loop threads in WebFlux.
- **MUST** isolate blocking calls on bounded schedulers when using reactive pipelines.
- **MUST** keep controllers thin.

Controller responsibilities:

1. authenticate/authorize via configured security layer;
2. parse and validate request;
3. call use case;
4. map result to response;
5. never contain persistence logic.

---

## 14. `RestClient`, `WebClient`, and HTTP Interface Clients

Rules:

- **MUST** configure timeout, base URL, serialization, error mapping, retry, and observability.
- **MUST NOT** create clients per request.
- **MUST** map external errors into domain/application errors.
- **MUST** make idempotency and retry policy explicit.
- **MUST NOT** call external services inside a DB transaction unless justified.

Dynamic URL rules:

- user-provided URLs are SSRF-sensitive;
- scheme/host/port must be allow-listed;
- redirects must be disabled or revalidated;
- private/link-local/metadata IPs must be blocked when applicable.

---

## 15. Caching

Spring cache abstraction is not a database.

Rules:

- **MUST** define cache key, value type, TTL, eviction behavior, and consistency model.
- **MUST** avoid caching security-sensitive/user-specific results unless key includes tenant/user/permission context.
- **MUST** never cache mutable entities directly.
- **MUST** define invalidation strategy before adding `@Cacheable`.
- **MUST** not use cache to hide slow queries without fixing query design.

Self-invocation warning applies to caching annotations.

---

## 16. Scheduling and Async

### 16.1 Scheduling

Rules:

- **MUST** explicitly configure scheduler pool/executor.
- **MUST** prevent overlapping jobs if job is not reentrant.
- **MUST** define lock/leader election strategy for multi-instance deployments.
- **MUST** define retry, timeout, idempotency, and failure alerting.

Forbidden:

- assuming `@Scheduled` runs once globally in Kubernetes;
- long-running scheduled jobs without lock/timeout;
- job logic without observability.

### 16.2 `@Async`

Rules:

- **MUST** configure named executor.
- **MUST** return `CompletableFuture`, `Future`, or publish explicit result where caller needs outcome.
- **MUST** handle exceptions intentionally.
- **MUST** not use `@Async` to hide slow code.
- **MUST** not rely on `@Async` for durable work.

---

## 17. Security Integration

Rules:

- **MUST** keep authentication/authorization policy outside controllers where possible.
- **MUST** enforce method-level authorization for sensitive use cases if endpoint-level security is insufficient.
- **MUST** not trust client-provided user ID, role, tenant ID, or permission claims without verification.
- **MUST** avoid putting secrets in Spring properties unless loaded from a secure secret source.
- **MUST** redact sensitive config in logs and actuator endpoints.

---

## 18. Exception Handling

Rules:

- **MUST** define exception taxonomy.
- **MUST** map exceptions at adapter boundary.
- **MUST** avoid leaking stack traces or internal class names to clients.
- **MUST** log unexpected exceptions once, at boundary or infrastructure layer.
- **MUST NOT** catch `Exception` broadly in service code without rethrow/wrap policy.

Recommended categories:

- validation error;
- authorization error;
- not found;
- conflict/state transition violation;
- external dependency failure;
- transient infrastructure failure;
- internal bug.

---

## 19. Testing Rules

Rules:

- **MUST** prefer plain unit tests for domain/application logic.
- **MUST** use Spring Test only when Spring wiring/proxy/config behavior is under test.
- **MUST** use slice tests for MVC/data/client layers where possible.
- **MUST** avoid `@SpringBootTest` for every test.
- **MUST** test `@Transactional`, AOP, cache, event listener, and async behavior with realistic context where needed.

Test pyramid:

| Test type                | Spring context? | Purpose                                 |
| ------------------------ | --------------: | --------------------------------------- |
| Domain unit              |              No | Business invariants                     |
| Application service unit |      Usually no | Use-case orchestration with mocks/fakes |
| Spring wiring test       |             Yes | Bean/proxy/config correctness           |
| Web slice                |    Yes, limited | Controller/request/response contract    |
| Data integration         |        Yes + DB | Persistence behavior                    |
| Full integration         |             Yes | Critical cross-layer behavior           |

---

## 20. Observability

Rules:

- **MUST** propagate correlation/request IDs.
- **MUST** produce structured logs at adapter and dependency boundaries.
- **MUST** record metrics for external calls, DB calls, messaging, scheduled jobs, and cache behavior.
- **MUST** avoid high-cardinality metric tags.
- **MUST** ensure traces do not include secrets or PII.

Spring code must expose evidence for:

- request latency;
- dependency latency;
- transaction failures;
- retry count;
- cache hit/miss;
- scheduled job success/failure;
- async queue depth where applicable.

---

## 21. Anti-Patterns

Forbidden by default:

- field injection;
- `ApplicationContext.getBean()` in business code;
- entity injected with Spring services;
- business logic in `@Configuration`;
- controller with transaction and persistence logic;
- broad `@ComponentScan("com")`;
- random `@Transactional` on private methods;
- `@Async` without executor and exception policy;
- `@Cacheable` without invalidation and TTL policy;
- `@Scheduled` without multi-instance semantics;
- framework exceptions leaking to clients;
- “fixing” circular dependencies by enabling circular references.

---

## 22. Reviewer Checklist

Before approving Spring code, verify:

- [ ] Spring generation and namespace are compatible.
- [ ] Dependency versions are BOM-managed.
- [ ] Constructor injection is used.
- [ ] Singleton beans are stateless/thread-safe.
- [ ] Component scanning is bounded.
- [ ] Stereotypes match architectural role.
- [ ] Transaction boundary is explicit and not in controller.
- [ ] No self-invocation bug for proxied annotations.
- [ ] No hidden business logic in AOP/listeners/config.
- [ ] External clients have timeout/retry/security/observability.
- [ ] Events are not treated as durable messaging.
- [ ] Validation is at boundary and invariants are in domain/application layer.
- [ ] Tests cover proxy/config behavior where annotations matter.
- [ ] Logs/metrics/traces are safe and useful.

---

## 23. LLM Prompt Contract

When implementing Spring code, the LLM must obey:

```text
You are implementing Java Spring Framework code.

Before writing code:
1. Identify the Spring generation: 5.x, 6.x, or 7.x.
2. Identify namespace: javax.* or jakarta.*.
3. Identify whether this is core Spring, Spring Boot, Spring MVC, WebFlux, Data, Security, or Messaging.
4. Decide the layer: controller/adapter, application service, domain, repository, infrastructure config, or test.
5. State whether annotations introduce proxy behavior, transaction, cache, async, retry, validation, or security behavior.

Implementation rules:
- Use constructor injection.
- Keep domain model free from Spring unless explicitly required.
- Keep controllers thin.
- Put transactions at application service boundary.
- Do not use field injection.
- Do not use ApplicationContext as service locator.
- Do not rely on self-invocation for proxied annotations.
- Do not create expensive clients repeatedly.
- Do not add annotations as decoration without explaining runtime effect.
- Do not hide business rules in AOP/listeners/config.
- Add tests for wiring/proxy behavior when annotations affect correctness.
```

---

## 24. References

- Spring Framework Reference Documentation: https://docs.spring.io/spring-framework/reference/
- Spring Framework Overview: https://docs.spring.io/spring-framework/reference/overview.html
- Spring Framework 7.0 GA announcement: https://spring.io/blog/2025/11/13/spring-framework-7-0-general-availability
- Spring Framework versions: https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions
- Spring Web MVC reference: https://docs.spring.io/spring-framework/reference/web/webmvc.html
- Spring WebFlux reference: https://docs.spring.io/spring-framework/reference/web/webflux.html
- Spring Boot system requirements: https://docs.spring.io/spring-boot/system-requirements.html
