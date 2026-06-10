# Strict Coding Standards — Java Best Practices

> Purpose: this document defines mandatory Java best-practice rules for human engineers and LLM code agents. It is an overlay standard. It must be used together with the project-specific standards for Java version, build tool, framework, persistence, messaging, security, testing, and deployment.

---

## 0. Enforcement Contract for LLM Code Agents

When implementing Java code, the agent MUST:

1. Identify the target Java baseline before coding: Java 11, 17, 21, or 25.
2. Refuse to use APIs/features outside the declared baseline unless the task explicitly authorizes migration.
3. Preserve existing architectural boundaries unless the task explicitly asks for refactoring.
4. Prefer small, reviewable changes over broad rewrites.
5. Explain non-obvious design decisions in code comments, tests, or a short implementation note.
6. Add or update tests for changed behavior.
7. Avoid introducing dependencies without a dependency rationale.
8. Avoid changing public API contracts unless the task explicitly asks for it.
9. Treat security, concurrency, persistence, and external integration code as high-risk code.
10. Stop and ask for explicit approval if a change requires schema migration, behavior migration, new infrastructure, or breaking compatibility.

The agent MUST NOT:

- invent framework conventions that do not exist in the current codebase;
- silently replace one architecture style with another;
- use reflection, dynamic proxies, code generation, runtime scanning, or global state as shortcuts;
- suppress warnings/errors without proving they are false positives;
- add broad catch blocks that hide failures;
- add configuration defaults that are unsafe in production;
- optimize without evidence;
- use examples from tutorials as production code without hardening.

---

## 1. Principle Hierarchy

When rules conflict, use this priority order:

1. Correctness
2. Security
3. Data integrity
4. Compatibility
5. Operability
6. Maintainability
7. Performance
8. Convenience

A convenient implementation that weakens correctness, security, or data integrity is rejected.

---

## 2. Baseline Java Rules

### MUST

- Compile with the project's declared `--release` version.
- Use the standard library before adding third-party utility libraries.
- Prefer explicit language constructs over reflection or magic conventions.
- Keep public APIs minimal, stable, and documented.
- Use immutable objects where practical.
- Prefer `java.time` over legacy date/time APIs.
- Prefer `Path`/`Files` over legacy `File` for new code.
- Prefer `Optional` only for return values where absence is a valid result.
- Use `try-with-resources` for all closeable resources.
- Use `Objects.requireNonNull` at construction/boundary points where null is invalid.

### MUST NOT

- Use deprecated APIs for new code without migration justification.
- Use internal JDK APIs such as `sun.*`, `com.sun.*`, or `jdk.internal.*`.
- Use preview/incubator APIs in production baseline unless the project explicitly permits them.
- Depend on default charset, default locale, default timezone, or process-global mutable defaults.
- Use finalization, `Thread.stop`, `System.exit` in library code, or unsafe shutdown hooks without ownership.

---

## 3. Code Organization

### MUST

- Organize packages by domain/module responsibility, not by generic technical buckets only.
- Keep dependency direction explicit: API/controller → application/use case → domain → infrastructure ports/adapters.
- Keep domain code independent from HTTP, JSON, database, messaging, and framework annotations unless the project deliberately uses an anemic model.
- Keep each class responsibility narrow and name it after the responsibility it owns.
- Keep test packages parallel to production packages.

### SHOULD

- Prefer package-private classes for internal implementation details.
- Prefer feature-local helpers over shared global utilities.
- Use `internal` package naming only if the build/module boundary enforces it or the team convention recognizes it.

### MUST NOT

- Add `common`, `util`, `helper`, or `manager` packages/classes without precise ownership.
- Create cyclic dependencies between modules/packages.
- Put business decisions in controllers, repositories, serializers, entity listeners, or mappers.
- Hide behavior in annotations that reviewers cannot easily trace.

---

## 4. Naming Rules

### MUST

- Use names that reveal domain meaning and failure behavior.
- Name commands/actions with verbs: `ApproveCaseCommand`, `SubmitApplicationRequest`.
- Name immutable values by what they represent: `CaseId`, `MoneyAmount`, `SubmissionWindow`.
- Name policies/rules explicitly: `EligibilityPolicy`, `PenaltyEscalationRule`.
- Name adapters by external system or protocol: `S3DocumentStore`, `PostgresCaseRepository`, `JerseyCaseResource`.

### MUST NOT

- Use vague names: `Data`, `Info`, `Helper`, `Processor`, `Manager`, `Handler`, `ServiceImpl` unless the term is project convention and has a precise role.
- Use misleading suffixes: a class named `Validator` must validate, not mutate; a class named `Repository` must not call external HTTP APIs.
- Use abbreviations that are not standard in the codebase.

---

## 5. API and Boundary Design

### MUST

- Make boundaries explicit: request DTO, command, domain model, persistence model, response DTO.
- Validate input at the boundary before business logic.
- Normalize only after validation rules are clear.
- Convert external errors into stable internal error types.
- Make idempotency explicit for mutation APIs that may be retried.
- Make time, locale, tenant, and actor context explicit where they affect behavior.

### MUST NOT

- Expose persistence entities directly through API responses.
- Accept generic `Map<String, Object>` as a normal application boundary model.
- Return raw external exceptions from internal service boundaries.
- Mix transport semantics with domain semantics.

---

## 6. Immutability and Mutability

### MUST

- Prefer immutable value objects.
- Make collections unmodifiable before exposing them from constructors/getters.
- Use defensive copies for mutable inputs and outputs.
- Document mutable shared state and synchronization rules.
- Keep mutable state local to a transaction, request, or clearly owned lifecycle.

### SHOULD

- Use records for transparent immutable data carriers where the Java baseline supports them.
- Use builders only for objects with many optional fields or complex construction invariants.

### MUST NOT

- Return internal mutable collections directly.
- Store request-scoped mutable state in singleton beans.
- Use public setters as the default domain mutation mechanism.
- Use static mutable fields except for safely initialized constants or deliberate caches with clear lifecycle.

---

## 7. Null and Absence

### MUST

- Define null policy per API boundary.
- Prefer non-null fields by default.
- Use `Optional<T>` for return values where absence is expected and not exceptional.
- Use validation annotations or explicit guards for required external input.
- Distinguish absent, null, empty string, blank string, and empty collection where business rules differ.

### MUST NOT

- Use `Optional` for fields, DTO properties, method parameters, or collection elements by default.
- Return `null` from collection-returning methods; return an empty collection instead.
- Use null as a hidden control signal.
- Catch `NullPointerException` as validation logic.

---

## 8. Exceptions and Failure Handling

### MUST

- Use exceptions for exceptional conditions, not normal branching.
- Preserve root cause when wrapping exceptions.
- Map external/infrastructure exceptions to application-specific exceptions at boundaries.
- Include actionable context in exception messages without leaking secrets or PII.
- Make retryability explicit.
- Fail fast on invalid configuration.

### SHOULD

- Use checked exceptions only when callers can reasonably recover and the API wants to force handling.
- Use sealed result types or explicit result objects where failure is part of normal business flow.

### MUST NOT

- Catch `Exception`, `Throwable`, or `RuntimeException` broadly unless at a controlled boundary.
- Swallow exceptions.
- Log and rethrow the same exception at multiple layers.
- Throw generic `RuntimeException` for domain errors.
- Encode errors as magic strings.

---

## 9. Collections and Data Structures

### MUST

- Choose collection types based on semantic contract, not habit.
- Use `List` for ordered duplicates, `Set` for uniqueness, `Map` for key lookup, `Queue`/`Deque` for queue semantics.
- Use `LinkedHashMap`/`LinkedHashSet` when iteration order is part of the contract.
- Use `EnumMap`/`EnumSet` for enum keys/sets where appropriate.
- Define equality and hash code correctly before objects are used as map keys or set elements.
- Bound collection sizes when accepting external input.

### MUST NOT

- Depend on `HashMap` iteration order.
- Mutate keys after inserting them into a hash-based collection.
- Use synchronized wrappers as a substitute for proper concurrent design.
- Use parallel streams over shared mutable data.

---

## 10. String, Text, and Locale

### MUST

- Use explicit charset for external/durable text.
- Use explicit locale for user-facing formatting/parsing.
- Use `Locale.ROOT` for machine-stable case conversion.
- Treat `String.length()` as UTF-16 code units, not user-perceived characters.
- Normalize Unicode only when the domain requires canonical comparison.
- Escape output according to context: HTML, JavaScript, SQL, JSON, XML, shell, URL, log.

### MUST NOT

- Use string concatenation for SQL, shell commands, HTML, XML, or JSON generation.
- Use regex for complex language parsing where a proper parser exists.
- Log secrets/tokens/passwords/private keys.
- Use case-insensitive comparison without locale/collation decision.

---

## 11. Numbers, Money, and Precision

### MUST

- Use `BigDecimal` for exact decimal/money calculations.
- Use explicit scale and `RoundingMode` for money/financial calculations.
- Use `Math.addExact`, `subtractExact`, `multiplyExact`, or range checks where overflow matters.
- Use domain-specific types for quantities with units.
- Validate numeric bounds at input boundary.

### MUST NOT

- Use `double`/`float` for money or exact decimal business rules.
- Create `BigDecimal` from `double` unless intentionally preserving binary floating value.
- Ignore overflow risk in counters, file sizes, pagination offsets, TTLs, or monetary amounts.
- Use sentinel numeric values like `-1` unless the API explicitly defines them.

---

## 12. Time and Date

### MUST

- Use `Instant` for audit/event timestamps.
- Use `LocalDate` for date-only business concepts.
- Use `ZonedDateTime` only when named timezone rules matter.
- Inject `Clock` into code that depends on current time.
- Store timezone/offset explicitly when business meaning depends on it.
- Test DST, leap year, month-end, and timezone boundaries.

### MUST NOT

- Use `new Date()`, `Calendar`, or `System.currentTimeMillis()` in business logic when `Clock` should be injectable.
- Store local date-time as if it were a global instant.
- Assume a day is always 24 hours when timezone transitions matter.
- Use server default timezone as business rule.

---

## 13. Concurrency

### MUST

- Define ownership and lifecycle for every thread, executor, scheduler, and asynchronous pipeline.
- Use `ExecutorService` or framework-managed executors instead of raw threads.
- Propagate cancellation and timeouts.
- Treat interruption as a cancellation signal; restore interrupt status when catching `InterruptedException` unless intentionally consumed.
- Use thread-safe collections or synchronization where mutable state is shared.
- Keep blocking I/O off event-loop/non-blocking threads.

### SHOULD

- Use virtual threads for high-concurrency blocking I/O on Java 21+ where the project permits them.
- Use immutable messages across thread boundaries.

### MUST NOT

- Use unbounded executors/queues for production workloads.
- Block inside common fork-join pool accidentally.
- Share mutable non-thread-safe objects across threads.
- Use sleeps as synchronization.
- Ignore `Future`/`CompletableFuture` failures.

---

## 14. Resource Lifecycle

### MUST

- Close files, streams, sockets, database connections, HTTP responses, message consumers/producers, and clients according to ownership rules.
- Use `try-with-resources` when the resource is method-scoped.
- Make application-scoped clients singleton/lifecycle-managed.
- Define shutdown hooks through framework lifecycle where possible.
- Set timeouts on network/database/external calls.

### MUST NOT

- Create HTTP/database/messaging clients per request.
- Leave response bodies unclosed.
- Rely on GC to release external resources.
- Perform long-running cleanup in JVM shutdown hooks without timeout.

---

## 15. Security Best Practices

### MUST

- Treat all external input as untrusted.
- Validate at trust boundaries.
- Enforce authorization near the protected resource/action.
- Use parameterized queries.
- Use allow-lists for dynamic identifiers, file paths, URLs, redirect targets, and commands.
- Use proven cryptographic APIs and approved algorithms.
- Keep secrets outside source code and logs.
- Use secure defaults for TLS, cookies, CORS, CSRF, and deserialization.
- Add negative tests for high-risk boundaries.

### MUST NOT

- Disable TLS verification.
- Use native Java deserialization for untrusted input.
- Build shell commands with user input.
- Use `MD5`, `SHA-1`, `DES`, `3DES`, `RC4`, AES-ECB, static IVs, or predictable randomness for security.
- Trust client-provided role, tenant, owner, or price fields.
- Use authentication as a substitute for authorization.

---

## 16. Persistence and Transactions

### MUST

- Define transaction boundary at application/use-case layer.
- Keep database transaction duration short.
- Use optimistic/pessimistic locking intentionally.
- Define retry policy for transient database failures.
- Use migration tools for schema changes.
- Use bind parameters for SQL/JPQL/native queries.
- Make fetch plans explicit for query-heavy code.

### MUST NOT

- Perform external network calls while holding database transactions unless explicitly required and reviewed.
- Use ORM auto-DDL update in production.
- Blindly merge request bodies into entities.
- Expose lazy-loaded entities to JSON serializers.
- Hide N+1 queries behind mapping code.

---

## 17. External Integration

### MUST

- Define timeout, retry, idempotency, circuit breaker, rate limit, and error mapping policy.
- Make request/response DTOs versioned where external contract can evolve.
- Log correlation identifiers, not secrets or full payloads by default.
- Separate integration adapters from business logic.
- Test timeout, 4xx, 5xx, network failure, malformed response, and partial failure paths.

### MUST NOT

- Retry non-idempotent operations without idempotency key or provider guarantee.
- Treat external `200 OK` as business success without validating payload semantics.
- Depend on undocumented external behavior.
- Use tutorial/example credentials, endpoints, or trust-all TLS.

---

## 18. Logging and Telemetry

### MUST

- Use structured logs where platform supports them.
- Include correlation/request/trace IDs at service boundaries.
- Log business/audit events separately from diagnostic logs.
- Use appropriate levels: `ERROR`, `WARN`, `INFO`, `DEBUG`, `TRACE`.
- Redact secrets, tokens, credentials, PII, and sensitive payloads.
- Emit metrics for critical throughput, latency, error, retry, queue, and resource usage signals.
- Instrument external calls with duration/status/outcome.

### MUST NOT

- Log and rethrow at every layer.
- Use logs as the only evidence for service health.
- Log entire request/response payloads by default.
- Use high-cardinality labels in metrics.
- Treat telemetry as business logic dependency.

---

## 19. Testing Best Practices

### MUST

- Add tests for every behavior change.
- Prefer deterministic tests: fixed time, fixed locale, fixed timezone, controlled randomness.
- Test both success and failure paths.
- Test boundaries: null/empty/invalid, min/max, duplicate, concurrent, timeout, retry, partial failure.
- Use real integrations via Testcontainers or equivalent where repository/message/client behavior matters.
- Keep unit tests fast and isolated.
- Separate unit, integration, contract, end-to-end, benchmark, and load tests.

### MUST NOT

- Mock the class under test.
- Mock value objects or simple data structures.
- Assert implementation details that make refactoring impossible.
- Use sleeps in tests where synchronization/await tools should be used.
- Use production credentials or production endpoints in tests.

---

## 20. Performance Best Practices

### MUST

- Prove performance problems with measurement before optimizing.
- Define the metric being optimized: latency, throughput, memory, allocation, CPU, startup, tail latency, database load, network calls.
- Use JMH for JVM microbenchmarks.
- Use profiling for application-level bottlenecks.
- Keep algorithms appropriate for expected data size.
- Avoid unbounded memory growth.
- Avoid accidental quadratic behavior in loops, mappings, and string construction.

### SHOULD

- Prefer clear code until evidence shows it is too slow.
- Cache only when invalidation, memory, concurrency, and security rules are clear.

### MUST NOT

- Claim performance improvement without baseline/result.
- Use `System.nanoTime()` ad-hoc loops as benchmark evidence.
- Cache user/tenant-specific data without isolation and invalidation policy.
- Trade correctness/security for performance without explicit approval.

---

## 21. Dependency Best Practices

### MUST

- Add dependencies only with explicit rationale.
- Prefer project-approved libraries and BOMs.
- Pin versions through Maven/Gradle governance.
- Avoid dependency duplication across modules.
- Check license, maintenance status, transitive dependencies, and security advisories.
- Keep dependency scope minimal: `test`, `runtime`, `compileOnly`, `implementation`, etc.

### MUST NOT

- Add a library for trivial functionality.
- Add dependencies from abandoned projects without approval.
- Use snapshot/dynamic/changing versions in production builds.
- Expose implementation dependencies in public APIs unless intentional.

---

## 22. Documentation and Comments

### MUST

- Document public API contracts and non-obvious invariants.
- Explain why for unusual choices, not what the code already says.
- Keep README/runbook/config docs updated when behavior changes.
- Add migration notes for breaking changes.

### MUST NOT

- Add noisy comments that repeat code.
- Leave stale TODOs without owner/date/context.
- Hide unresolved design risk in comments instead of surfacing it.

---

## 23. Code Review Checklist

A change is rejected if any answer is unclear:

- What business behavior changed?
- What public/internal contract changed?
- What data/state transition changed?
- What failure modes are introduced or changed?
- What security boundary is touched?
- What transaction/resource lifecycle is touched?
- What concurrency behavior is touched?
- What tests prove correctness?
- What observability helps operate the change?
- What migration/rollback path exists if needed?
- What dependency/configuration/platform assumption changed?

---

## 24. LLM Implementation Prompt Contract

Use this prompt fragment before implementation:

```text
You are modifying a Java codebase under strict coding standards.
Before coding:
1. Identify Java baseline and forbidden features.
2. Identify affected layers and boundaries.
3. Identify invariants, failure modes, security checks, resource lifecycle, and tests.
4. Prefer minimal cohesive change.
5. Do not introduce dependency, reflection, global state, unsafe defaults, or broad rewrites without explicit justification.
After coding:
1. Explain changed behavior.
2. List tests added/updated.
3. List assumptions and remaining risks.
```

---

## 25. References

- Google Java Style Guide: https://google.github.io/styleguide/javaguide.html
- Oracle Secure Coding Guidelines for Java SE: https://www.oracle.com/java/technologies/javase/seccodeguide.html
- OWASP Java Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Java_Security_Cheat_Sheet.html
- OWASP Secure Code Review Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html
- Java Platform Documentation: https://docs.oracle.com/en/java/javase/
