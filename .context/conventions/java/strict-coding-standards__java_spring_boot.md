# Strict Coding Standards: Java Spring Boot

> Scope: Spring Boot application development and production runtime conventions: starters, dependency management, auto-configuration, configuration properties, profiles, application lifecycle, web/data/messaging integration, testing slices, actuator, packaging, Docker/Kubernetes readiness, native images, and operational hardening.
>
> This standard extends `strict-coding-standards__java_spring.md` and must be used together with the relevant standards for HTTP, JSON, validation, security, logging, telemetry, Docker, Kubernetes, JDBC/JPA/Hibernate/MyBatis, Kafka/RabbitMQ, AWS, and testing.

---

## 1. Purpose

Spring Boot must be used to make Spring applications predictable and production-ready, not to let auto-configuration make uncontrolled architectural decisions.

LLM-generated Spring Boot code must satisfy these goals:

1. dependencies are managed by the Spring Boot release train;
2. auto-configuration is understood and bounded;
3. configuration is typed, validated, environment-aware, and secret-safe;
4. startup, shutdown, health, metrics, logging, and deployment behavior are explicit;
5. tests are scoped to the smallest required Spring context;
6. production behavior does not differ unexpectedly from local/dev behavior.

---

## 2. Version Policy

### 2.1 Baseline families

| Boot line  | Framework line |                                Java baseline |     Namespace | Status                                          |
| ---------- | -------------: | -------------------------------------------: | ------------: | ----------------------------------------------- |
| Boot 2.7.x |   Spring 5.3.x |                         Java 8+ historically |     `javax.*` | Legacy only                                     |
| Boot 3.x   |     Spring 6.x |                                     Java 17+ |   `jakarta.*` | Supported modern legacy                         |
| Boot 4.0.x |   Spring 7.0.x | Java 17+; Java 25 recommended for latest LTS | Jakarta EE 11 | Preferred new greenfield when ecosystem permits |

Rules:

- **MUST** choose the Boot major version before adding dependencies.
- **MUST** follow Boot-managed dependency versions unless a documented compatibility exception exists.
- **MUST NOT** override Spring Framework, Spring Security, Spring Data, Jackson, Hibernate, Netty, Micrometer, or logging versions casually.
- **MUST NOT** mix Boot 3.x and Boot 4.x modules.
- **MUST** keep Java toolchain aligned with Boot system requirements.

### 2.2 Starters

Rules:

- **MUST** prefer starters for standard integration because they bring compatible dependencies and auto-configuration.
- **MUST** avoid adding both starter and raw dependency variants without understanding duplicate auto-config.
- **MUST** remove unused starters.
- **MUST** review transitive dependencies after adding a starter.

Examples:

- `spring-boot-starter-web` for Servlet MVC apps.
- `spring-boot-starter-webflux` for reactive apps.
- `spring-boot-starter-validation` for Bean/Jakarta Validation.
- `spring-boot-starter-actuator` for production observability.
- `spring-boot-starter-test` for test support.

Forbidden:

- adding `spring-boot-starter-web` and `spring-boot-starter-webflux` together without explicit design;
- using random logging implementations alongside Boot logging starter;
- mixing servlet and reactive stack accidentally.

---

## 3. Application Structure

Recommended package layout:

```text
com.example.enforcement/
  EnforcementApplication.java
  config/
  api/
  application/
  domain/
  infrastructure/
  persistence/
  messaging/
  security/
```

Rules:

- **MUST** put `@SpringBootApplication` at the package root of application-owned code.
- **MUST NOT** place application main class above unrelated packages.
- **MUST** avoid broad scanning of vendor/shared packages.
- **MUST** keep shared libraries free from `@SpringBootApplication`.

---

## 4. Auto-Configuration Discipline

Spring Boot auto-configuration is a tool, not a guarantee.

Rules:

- **MUST** understand which auto-configurations are activated by dependencies.
- **MUST** prefer configuration properties over hardcoded bean config where Boot provides supported properties.
- **MUST** define explicit beans only when default behavior is insufficient.
- **MUST** document any auto-configuration exclusion.
- **MUST NOT** exclude auto-configuration to hide dependency conflicts.

When adding a starter, document:

1. why the starter is needed;
2. which auto-configurations it activates;
3. which properties must be set;
4. which health/metric endpoints it affects;
5. which tests cover it.

---

## 5. Configuration Properties

### 5.1 Typed configuration

Rules:

- **MUST** use `@ConfigurationProperties` for structured configuration.
- **MUST** validate configuration with Jakarta Validation where possible.
- **MUST** keep property names stable and documented.
- **MUST NOT** scatter `@Value` across business classes for structured config.
- **MUST NOT** read environment variables directly in business code.

Preferred:

```java
@ConfigurationProperties(prefix = "case.assignment")
public record AssignmentProperties(
        @Min(1) int maxOpenCasesPerOfficer,
        @NotNull Duration escalationDelay
) {}
```

Then enable through configuration scanning or explicit enablement according to project convention.

### 5.2 Secret handling

Rules:

- **MUST NOT** commit secrets in `application.yml`, `application.properties`, or test resources.
- **MUST** load secrets from approved secret sources.
- **MUST** redact secrets in logs, actuator, error responses, and diagnostics.
- **MUST** separate secret config from non-secret config.

Forbidden keys in repository:

- passwords;
- private keys;
- access keys;
- refresh tokens;
- API keys;
- signing keys;
- database production credentials.

---

## 6. Profiles and Environments

Rules:

- **MUST** use profiles for environment-specific wiring only when necessary.
- **MUST NOT** put business behavior differences behind profiles.
- **MUST NOT** use `dev`, `uat`, `prod` branches inside business logic.
- **MUST** keep production defaults safe.
- **MUST** ensure tests do not accidentally use production-like external systems.

Allowed profile usage:

- local mock adapter;
- test container config;
- cloud-specific infrastructure binding;
- optional feature integration.

Forbidden:

```java
if (environment.acceptsProfiles("prod")) {
    approveWithoutValidation();
}
```

---

## 7. Web Application Rules

### 7.1 MVC vs WebFlux

Rules:

- **MUST** choose `spring-boot-starter-web` for Servlet MVC applications.
- **MUST** choose `spring-boot-starter-webflux` for reactive applications.
- **MUST NOT** combine both without an explicit architecture note.
- **MUST NOT** block event loops in WebFlux.
- **MUST** keep controllers thin.

### 7.2 Controller boundary

Rules:

- **MUST** use request/response DTOs.
- **MUST NOT** expose JPA entities directly.
- **MUST** validate request DTOs.
- **MUST** centralize error handling.
- **MUST** return correct HTTP status semantics.

### 7.3 Error handling

Rules:

- **MUST** use centralized exception mapping, typically `@ControllerAdvice` or Boot-compatible error handling.
- **MUST** not leak stack traces in production.
- **MUST** return stable machine-readable error contracts.
- **MUST** include correlation ID where possible.

---

## 8. Data Access Integration

Rules:

- **MUST** choose one primary persistence style per module: JDBC, JPA/Hibernate, MyBatis, R2DBC, etc.
- **MUST** configure datasource/pool explicitly enough for production.
- **MUST** disable ORM auto-DDL in production.
- **MUST** use Flyway/Liquibase or approved migration tool for schema changes.
- **MUST** put transactions at application service boundary.
- **MUST** not call remote services inside long DB transactions.

Spring Boot datasource guardrails:

- pool size must account for replica count and database capacity;
- connection timeout and validation settings must be explicit;
- SQL logging must not leak secrets/PII;
- health checks must not overload DB.

---

## 9. Messaging and Integration

Rules:

- **MUST** define topic/queue/exchange contract outside code comments.
- **MUST** configure retry, DLQ, idempotency, and poison-message behavior.
- **MUST** not process messages in an unbounded transaction.
- **MUST** not acknowledge/delete message before durable processing is complete.
- **MUST** expose consumer lag/error metrics.

Boot auto-config for messaging must not hide:

- listener concurrency;
- consumer group;
- offset/ack mode;
- serializer/deserializer;
- retry and DLQ policy;
- dead-letter schema.

---

## 10. Actuator and Production-Ready Features

Spring Boot Actuator must be treated as a production interface.

Rules:

- **MUST** include actuator for production services unless platform has an equivalent standard.
- **MUST** expose only approved endpoints over HTTP.
- **MUST** secure sensitive endpoints.
- **MUST** separate application port and management port only when platform needs it.
- **MUST** redact secrets from `/env`, `/configprops`, logs, and diagnostics.
- **MUST** define health groups appropriate for Kubernetes readiness/liveness if used.

Endpoint policy:

| Endpoint      | Default posture                                    |
| ------------- | -------------------------------------------------- |
| `health`      | Allowed, detail restricted by environment/security |
| `info`        | Allowed, no secrets                                |
| `metrics`     | Restricted; protect in production                  |
| `prometheus`  | Restricted; expose only to monitoring path/network |
| `env`         | Forbidden over public network                      |
| `configprops` | Forbidden over public network                      |
| `heapdump`    | Forbidden unless tightly controlled                |
| `threaddump`  | Restricted operational endpoint                    |
| `shutdown`    | Forbidden by default                               |

---

## 11. Health Checks and Kubernetes

Rules:

- **MUST** distinguish startup, readiness, and liveness semantics.
- **MUST NOT** make liveness depend on fragile downstream services.
- **MUST** make readiness reflect ability to accept traffic.
- **MUST** ensure health checks are cheap.
- **MUST** account for slow migrations/startup with startup probes or deployment sequencing.

Examples:

- liveness: JVM/process not wedged;
- readiness: app can serve requests and required local resources are ready;
- dependency health: DB/cache/message broker state, usually readiness or observability, not necessarily liveness.

---

## 12. Logging

Rules:

- **MUST** log structured, actionable application events.
- **MUST** use parameterized logging.
- **MUST NOT** log secrets, tokens, credentials, private keys, full request bodies, or PII unless explicitly approved and redacted.
- **MUST** include correlation/request ID.
- **MUST** avoid excessive startup logs in noisy production deployments.

Boot logging config:

- define log level per package;
- do not enable SQL bind value logs in production unless redacted and temporary;
- avoid DEBUG root logging in production;
- ensure container logs go to stdout/stderr unless platform requires otherwise.

---

## 13. Metrics, Tracing, and Observability

Rules:

- **MUST** use Micrometer/OpenTelemetry-compatible instrumentation where platform standard requires it.
- **MUST** avoid high-cardinality tags such as user ID, request ID, raw URL, email, token, or entity ID.
- **MUST** instrument external calls, DB calls, queue processing, scheduled jobs, cache, and key business workflows.
- **MUST** propagate trace/correlation context across async, messaging, and HTTP boundaries.

Metrics must answer:

- Is the service available?
- Is it slow?
- Which dependency is failing?
- Is the error transient or business-level?
- Is queue lag growing?
- Are retries hiding downstream instability?

---

## 14. Startup and Shutdown

Rules:

- **MUST** fail fast on invalid required configuration.
- **MUST** use lifecycle hooks carefully; avoid heavy logic in constructors.
- **MUST** make startup migrations explicit.
- **MUST** support graceful shutdown.
- **MUST** stop accepting traffic before terminating long work.
- **MUST** close clients/pools/executors cleanly.

Forbidden:

- network calls inside bean constructors;
- silent fallback to localhost/prod-like dependency;
- blocking forever at startup;
- starting background threads without lifecycle management.

---

## 15. Testing

### 15.1 Test scope

Rules:

- **MUST** use the smallest test context that proves the behavior.
- **MUST NOT** use `@SpringBootTest` for simple unit tests.
- **MUST** use slice tests where appropriate.
- **MUST** use Testcontainers or equivalent for realistic integration tests where DB/broker behavior matters.
- **MUST** avoid flaky tests based on timing/sleep.

Common test choices:

| Test goal                        | Preferred style                       |
| -------------------------------- | ------------------------------------- |
| Domain logic                     | Plain JUnit, no Spring                |
| Controller JSON contract         | MVC/WebFlux slice test                |
| Repository SQL/JPA behavior      | Data slice + real DB/Testcontainers   |
| Configuration properties binding | Context runner or focused Spring test |
| Full startup smoke               | `@SpringBootTest`                     |
| Actuator/security behavior       | focused integration test              |

### 15.2 Test profiles

Rules:

- **MUST** isolate test configuration from local/prod.
- **MUST NOT** connect to shared dev/staging databases in automated tests.
- **MUST** make random ports explicit where needed.
- **MUST** reset state between tests.

---

## 16. Build and Packaging

Rules:

- **MUST** use Maven/Gradle plugin versions compatible with Boot.
- **MUST** build reproducibly where possible.
- **MUST** produce one deployable artifact per service.
- **MUST** avoid fat jar customization unless required.
- **MUST** not package secrets in image/jar.

Container rules:

- use layered jars or buildpacks where platform supports it;
- run as non-root;
- configure JVM memory for container;
- export only needed ports;
- include SBOM/scanning where pipeline requires it.

---

## 17. Native Image / AOT

Rules:

- **MUST** treat native image as separate runtime target requiring tests.
- **MUST** validate reflection, serialization, proxy, resource, JNI, and dynamic class loading assumptions.
- **MUST** not claim native compatibility just because the JVM app works.
- **MUST** keep native-specific hints minimal and documented.

Use native image only when startup/memory/deployment constraints justify the complexity.

---

## 18. Security

Rules:

- **MUST** use Spring Security or approved security gateway pattern for authentication/authorization.
- **MUST** explicitly define CORS policy.
- **MUST** explicitly define CSRF policy for browser/session-based apps.
- **MUST** not disable security for actuator endpoints in production.
- **MUST** not expose internal exception details.
- **MUST** validate all external input.
- **MUST** use secure secret sources.

Forbidden:

- `permitAll()` on broad paths without review;
- disabled CSRF in browser app without reason;
- permissive `allowedOrigins("*")` with credentials;
- actuator `/env`, `/configprops`, `/heapdump` exposed publicly;
- logging auth headers or tokens.

---

## 19. Performance and Resource Management

Rules:

- **MUST** set connection pools, executor pools, queue sizes, and timeouts explicitly for production.
- **MUST** monitor startup time, heap, thread count, pool usage, and GC.
- **MUST** avoid unbounded in-memory reads/uploads/downloads.
- **MUST** use pagination/streaming for large data.
- **MUST** not use Boot defaults as proof of production capacity.

Performance-sensitive changes require evidence:

- realistic load profile;
- metrics before/after;
- database query plan where relevant;
- JVM/GC/container telemetry;
- rollback plan.

---

## 20. Anti-Patterns

Forbidden by default:

- adding starters until code compiles;
- using `@SpringBootApplication` in library modules;
- overriding managed dependency versions without compatibility proof;
- environment-specific business logic via profiles;
- exposing actuator sensitive endpoints;
- `@SpringBootTest` everywhere;
- direct JPA entity as REST response;
- transaction in controller;
- startup logic that mutates production state unexpectedly;
- logging complete request/response bodies by default;
- disabling security features to make tests pass;
- hiding failed dependency calls with fallback success.

---

## 21. Migration Rules

### 21.1 Boot 2.x to 3.x

Rules:

- migrate from `javax.*` to `jakarta.*`;
- verify Spring Security, Hibernate, Validation, Servlet, JPA, Jackson, and logging changes;
- remove deprecated APIs before upgrade;
- run full integration tests.

### 21.2 Boot 3.x to 4.x

Rules:

- verify Spring Framework 7 compatibility;
- verify Jakarta EE 11/Servlet 6.1 baseline;
- review modularized Boot dependencies and starter changes;
- review removed deprecated APIs;
- verify native image/GraalVM requirements if used;
- verify Spring Cloud/Spring Data/Spring Security compatibility.

---

## 22. Reviewer Checklist

Before approving Spring Boot code, verify:

- [ ] Boot major version and Java baseline are explicit.
- [ ] Dependencies are Boot-managed or justified.
- [ ] Correct starter is used; unused starters removed.
- [ ] Servlet vs reactive stack is intentional.
- [ ] Main application package scanning is bounded.
- [ ] Configuration uses typed `@ConfigurationProperties`.
- [ ] Secrets are not committed or logged.
- [ ] Profiles do not change business semantics.
- [ ] Auto-configuration exclusions are documented.
- [ ] Actuator endpoints are secure and minimal.
- [ ] Health/readiness/liveness semantics are correct.
- [ ] Connection pools/executors/timeouts are explicit.
- [ ] Tests use smallest context necessary.
- [ ] Docker/Kubernetes production behavior is considered.
- [ ] Observability is useful and safe.

---

## 23. LLM Prompt Contract

When implementing Spring Boot code, the LLM must obey:

```text
You are implementing Java Spring Boot code.

Before writing code:
1. Identify the Spring Boot major/minor line.
2. Identify Java baseline and jakarta/javax namespace.
3. Identify whether this is MVC, WebFlux, data, messaging, security, actuator, configuration, or test code.
4. List which starter/auto-configuration is required.
5. State configuration properties, profiles, secrets, and actuator implications.

Implementation rules:
- Use Boot-managed dependencies.
- Do not override managed versions without compatibility reason.
- Do not mix servlet and reactive stacks accidentally.
- Use typed and validated @ConfigurationProperties for structured config.
- Do not commit or log secrets.
- Keep controllers thin and services transactional where appropriate.
- Do not expose JPA entities as API responses.
- Configure timeouts, pools, retry, observability, and health behavior explicitly for external dependencies.
- Use the smallest Spring test context that proves correctness.
- Secure actuator endpoints.
```

---

## 24. References

- Spring Boot project page: https://spring.io/projects/spring-boot
- Spring Boot reference documentation: https://docs.spring.io/spring-boot/reference/
- Spring Boot system requirements: https://docs.spring.io/spring-boot/system-requirements.html
- Spring Boot dependency versions: https://docs.spring.io/spring-boot/appendix/dependency-versions/index.html
- Spring Boot Actuator production-ready features: https://docs.spring.io/spring-boot/reference/actuator/
- Spring Boot Actuator endpoints: https://docs.spring.io/spring-boot/reference/actuator/endpoints.html
- Spring Boot testing: https://docs.spring.io/spring-boot/reference/testing/
- Spring Boot 4.0 migration guide: https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide
- Spring Framework 7.0 GA announcement: https://spring.io/blog/2025/11/13/spring-framework-7-0-general-availability
