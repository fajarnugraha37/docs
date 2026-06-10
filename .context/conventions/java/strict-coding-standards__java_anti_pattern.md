# Strict Coding Standards — Java Anti-Patterns

> Purpose: this document defines Java anti-patterns that LLM code agents and reviewers must detect, reject, or refactor. It is an overlay standard. It applies together with the Java version, framework, persistence, messaging, security, build, testing, and deployment standards.

---

## 0. Anti-Pattern Enforcement Contract

An implementation is rejected if it introduces any anti-pattern marked **FORBIDDEN** unless the task explicitly authorizes a compatibility workaround and the code documents a removal plan.

When an LLM agent detects an existing anti-pattern, it MUST NOT silently expand it. It must either:

1. contain the change without increasing the anti-pattern surface;
2. refactor it if the task scope allows;
3. report it as a risk with a concrete migration path.

---

## 1. Design Anti-Patterns

### 1.1 God Class / God Service — FORBIDDEN

**Smell**

- One class handles validation, orchestration, persistence, mapping, HTTP calls, state transitions, logging, and authorization.
- Class has too many dependencies.
- Methods are long and unrelated.
- Changes in many features require editing the same class.

**Why dangerous**

- Hides business invariants.
- Makes testing hard.
- Creates accidental coupling.
- Encourages broad risky changes.

**Corrective rule**

Split by responsibility:

- controller/resource: transport concerns;
- application service/use case: orchestration and transaction boundary;
- domain model/policy: business rules;
- repository/gateway: infrastructure boundary;
- mapper: structural transformation.

---

### 1.2 Anemic Everything With No Invariants — RESTRICTED

**Smell**

- Domain objects are only getters/setters.
- All rules live in procedural services.
- Invalid state can exist freely.

**Why dangerous**

- Business rules become scattered.
- State transitions are not defensible.
- Tests must know too much orchestration detail.

**Corrective rule**

Put invariants and state transitions close to the state they protect. Use services for orchestration and cross-aggregate workflows, not as dumping ground for every rule.

---

### 1.3 Utility Class Explosion — FORBIDDEN BY DEFAULT

**Smell**

- `StringUtils2`, `DateHelper`, `CommonUtil`, `ValidationUtil`, `MapperUtil` accumulate unrelated static methods.
- Business behavior hides inside static helpers.

**Why dangerous**

- No ownership.
- Hard to mock/test in isolation.
- Encourages procedural design.

**Corrective rule**

Use domain-specific types or services. Static helpers are allowed only for pure, deterministic, general operations with narrow scope.

---

### 1.4 Generic Context Object — FORBIDDEN

**Smell**

- Methods accept `Context`, `Map<String,Object>`, `RequestData`, or `Payload` containing arbitrary values.
- Data is extracted by string keys.

**Why dangerous**

- No compile-time contract.
- Runtime failures replace type safety.
- Hidden coupling across layers.
- Security/authorization context can be spoofed or misread.

**Corrective rule**

Use typed request/command/context objects with explicit fields and validation.

---

### 1.5 Boolean Parameter Trap — RESTRICTED

**Smell**

```java
process(caseId, true, false, true);
```

**Why dangerous**

- Call sites are unreadable.
- New flags multiply behavior paths.
- Tests miss combinations.

**Corrective rule**

Use named command objects, enums, or separate methods.

---

### 1.6 Over-Engineering With Patterns — FORBIDDEN BY DEFAULT

**Smell**

- Factory, strategy, visitor, adapter, builder, observer, and abstraction layers added for simple one-case logic.
- Interface has one implementation and no volatility point.

**Why dangerous**

- Increases cognitive load.
- Makes code harder to trace.
- LLM agents often generate unnecessary abstraction to look “enterprise”.

**Corrective rule**

Use patterns only when they solve demonstrated variation, lifecycle, or dependency inversion needs.

---

## 2. OOP Anti-Patterns

### 2.1 Inheritance for Reuse — FORBIDDEN BY DEFAULT

**Smell**

- Base class contains shared mutable state and partial algorithms.
- Subclasses override random hooks.
- Parent knows too much about children.

**Why dangerous**

- Fragile base-class problem.
- Hidden coupling.
- Substitution violations.

**Corrective rule**

Prefer composition. Use inheritance only for true substitutable type hierarchies with stable contracts.

---

### 2.2 Interface for Everything — RESTRICTED

**Smell**

- Every class has `Foo` and `FooImpl`.
- Interface exists only for testing or habit.

**Why dangerous**

- Doubles file count.
- Hides concrete behavior.
- Creates fake abstraction.

**Corrective rule**

Use interfaces at module boundaries, external ports, multiple implementations, or test seams where meaningful.

---

### 2.3 Public Setters Everywhere — FORBIDDEN BY DEFAULT

**Smell**

- Domain state can be mutated to invalid combinations.
- No method expresses business intent.

**Why dangerous**

- Invariants are unenforced.
- Audit/state transitions become untraceable.

**Corrective rule**

Use intention-revealing methods such as `approve`, `reject`, `assign`, `expire`, `markPaid`, with validation inside.

---

### 2.4 Broken equals/hashCode — FORBIDDEN

**Smell**

- Override `equals` but not `hashCode`.
- Use mutable fields in hash code.
- Entity equality changes after persistence.

**Why dangerous**

- Breaks `HashSet`, `HashMap`, caching, dirty tracking, and deduplication.

**Corrective rule**

Define identity semantics before implementing equality. Test equality contracts.

---

## 3. Error Handling Anti-Patterns

### 3.1 Catch-All and Continue — FORBIDDEN

**Smell**

```java
try {
    doWork();
} catch (Exception e) {
    log.warn("ignored", e);
}
```

**Why dangerous**

- Hides data loss.
- Makes partial failure invisible.
- Causes downstream corruption.

**Corrective rule**

Catch only expected exceptions. Decide retry, reject, compensate, fail transaction, or propagate.

---

### 3.2 Log and Rethrow Everywhere — FORBIDDEN

**Smell**

- Same exception logged at repository, service, controller, and global handler.

**Why dangerous**

- Log noise.
- Duplicate alerts.
- Leaks sensitive details.

**Corrective rule**

Log at ownership boundary where action is taken. Preserve cause when wrapping.

---

### 3.3 Generic RuntimeException — RESTRICTED

**Smell**

```java
throw new RuntimeException("failed");
```

**Why dangerous**

- No failure taxonomy.
- Cannot map to retry/status/audit behavior.

**Corrective rule**

Use domain/application/infrastructure exception types or explicit result types.

---

### 3.4 Exception as Control Flow — RESTRICTED

**Smell**

- Parsing or lookup failure uses exception in hot normal path.

**Why dangerous**

- Performance cost.
- Obscures expected absence.

**Corrective rule**

Use `Optional`, result type, or explicit branch where absence is normal.

---

## 4. Null and Data Anti-Patterns

### 4.1 Null as Business State — FORBIDDEN

**Smell**

- `null` means unknown, disabled, not applicable, failed, not loaded, or default depending on caller.

**Why dangerous**

- Ambiguous semantics.
- Leads to hidden behavior and NPE.

**Corrective rule**

Use explicit enum/state/value object or separate fields.

---

### 4.2 Optional Misuse — RESTRICTED

**Smell**

- `Optional` fields in DTO/entities.
- `Optional` parameters.
- `Optional.get()` without check.

**Why dangerous**

- Poor serialization/persistence semantics.
- Does not remove absence handling.

**Corrective rule**

Use `Optional` mainly for return values.

---

### 4.3 Primitive Obsession — RESTRICTED

**Smell**

- IDs, money, country, status, timezone, permissions, and units represented as raw `String`, `int`, or `BigDecimal` everywhere.

**Why dangerous**

- Validation scattered.
- Wrong value can be passed to wrong parameter.

**Corrective rule**

Use domain value objects for important values.

---

## 5. Collection and Stream Anti-Patterns

### 5.1 HashMap Order Dependency — FORBIDDEN

**Smell**

- Tests or logic pass because `HashMap` happens to iterate in a specific order.

**Corrective rule**

Use `LinkedHashMap`, `TreeMap`, or explicit sorting when order matters.

---

### 5.2 Side-Effect Stream Pipeline — FORBIDDEN BY DEFAULT

**Smell**

```java
items.stream().map(x -> { audit.add(x); return transform(x); }).toList();
```

**Why dangerous**

- Violates stream non-interference/stateless expectations.
- Breaks under parallelization or optimization.

**Corrective rule**

Use loops for side-effectful workflows; use streams for transformations.

---

### 5.3 Parallel Stream in Server Code — FORBIDDEN BY DEFAULT

**Smell**

- `parallelStream()` used to “make it faster”.

**Why dangerous**

- Uses common pool.
- Poor control over blocking, transaction, security context, and resource pressure.

**Corrective rule**

Use explicit executor/concurrency design.

---

### 5.4 Unbounded Collection Growth — FORBIDDEN

**Smell**

- Reads entire file/result set/topic/page into memory.
- Keeps appending to static map/cache.

**Corrective rule**

Use pagination, streaming, bounded queues, eviction, and memory budget.

---

## 6. Security Anti-Patterns

### 6.1 String-Concatenated SQL/JPQL/Commands — FORBIDDEN

**Smell**

```java
"select * from users where name = '" + input + "'"
```

**Why dangerous**

- Injection vulnerability.

**Corrective rule**

Use bind parameters. Use allow-list for identifiers.

---

### 6.2 Trust-All TLS — FORBIDDEN

**Smell**

- Custom `TrustManager` accepts all certificates.
- Hostname verification disabled.

**Why dangerous**

- Enables MITM.

**Corrective rule**

Use platform trust store or explicit pinned/private CA configuration with rotation plan.

---

### 6.3 Weak Crypto — FORBIDDEN

**Smell**

- MD5/SHA-1 for security.
- DES/3DES/RC4/AES-ECB.
- Static IV.
- Predictable random.
- Homegrown encryption/signature.

**Corrective rule**

Use approved JCA/JCE algorithms and project crypto standard.

---

### 6.4 Authentication as Authorization — FORBIDDEN

**Smell**

- Code checks `isAuthenticated()` and then allows access to any object.

**Why dangerous**

- Broken object-level authorization.

**Corrective rule**

Check subject, action, resource, tenant, ownership, assignment, scope, and state.

---

### 6.5 Unsafe Deserialization — FORBIDDEN

**Smell**

- Java native deserialization from untrusted input.
- Jackson default typing without allow-list.
- XML parser with external entities enabled.

**Corrective rule**

Use safe formats, allow-list type resolution, and hardened parser configuration.

---

### 6.6 Secret Logging — FORBIDDEN

**Smell**

- Logs contain passwords, tokens, cookies, authorization headers, private keys, PII, or full request payloads.

**Corrective rule**

Redact at source. Add tests for log redaction where feasible.

---

## 7. Persistence Anti-Patterns

### 7.1 Entity as API DTO — FORBIDDEN

**Smell**

- JPA entity returned from REST controller.
- JSON serialization triggers lazy loading.

**Why dangerous**

- Leaks schema/domain internals.
- N+1 queries.
- Security exposure.

**Corrective rule**

Use response DTOs/projections.

---

### 7.2 Blind Merge/Update From Request — FORBIDDEN

**Smell**

- Request body copied directly into entity.
- `merge()` called on detached user-provided object.

**Why dangerous**

- Mass assignment.
- Lost updates.
- Authorization bypass.

**Corrective rule**

Load aggregate, authorize, validate command, apply intention-revealing mutation.

---

### 7.3 Transaction Around External Calls — FORBIDDEN BY DEFAULT

**Smell**

- Database transaction opened, then HTTP/S3/SMTP/Kafka call made inside it.

**Why dangerous**

- Long locks.
- Deadlocks.
- Partial failure.

**Corrective rule**

Use outbox, after-commit hooks, or explicit saga/process manager.

---

### 7.4 ORM Auto-DDL in Production — FORBIDDEN

**Smell**

- `hibernate.hbm2ddl.auto=update` or equivalent production behavior.

**Corrective rule**

Use Flyway/Liquibase/reviewed migration.

---

### 7.5 N+1 Query Hidden by Mapping — FORBIDDEN

**Smell**

- Loop over entities calls lazy relationship or repository per item.

**Corrective rule**

Use explicit fetch plan, projection, join, batch fetch, or query redesign.

---

## 8. Concurrency Anti-Patterns

### 8.1 Unbounded Executor/Queue — FORBIDDEN

**Smell**

- `Executors.newCachedThreadPool()` or unbounded queue used for production workload without backpressure.

**Corrective rule**

Use bounded executor/queue with rejection/backpressure policy.

---

### 8.2 Sleep-Based Synchronization — FORBIDDEN

**Smell**

```java
Thread.sleep(1000);
```

used to wait for state.

**Corrective rule**

Use latches, futures, awaitility, events, or proper synchronization.

---

### 8.3 Ignored Interrupt — FORBIDDEN

**Smell**

```java
catch (InterruptedException e) { }
```

**Corrective rule**

Restore interrupt status or propagate cancellation.

---

### 8.4 Shared Mutable Singleton State — FORBIDDEN BY DEFAULT

**Smell**

- Singleton service stores request/user/tenant data in fields.

**Corrective rule**

Keep request state local or use explicit request-scoped/context mechanisms.

---

## 9. Network and Integration Anti-Patterns

### 9.1 Client Per Request — FORBIDDEN

**Smell**

- New HTTP/database/Redis/S3/Kafka client for every operation.

**Why dangerous**

- Connection churn.
- Resource leaks.
- Poor latency.

**Corrective rule**

Use lifecycle-managed reusable clients.

---

### 9.2 Missing Timeout — FORBIDDEN

**Smell**

- External calls have no connect/read/request timeout.

**Corrective rule**

Every external call must have timeout and failure mapping.

---

### 9.3 Blind Retry — FORBIDDEN

**Smell**

- Retry all exceptions/statuses/methods with no idempotency policy.

**Why dangerous**

- Duplicate payments/actions/messages.
- Failure amplification.

**Corrective rule**

Retry only transient failures and idempotent operations or operations protected by idempotency keys.

---

### 9.4 Dynamic URL SSRF — FORBIDDEN BY DEFAULT

**Smell**

- User-controlled URL passed to HTTP client.

**Corrective rule**

Use scheme/host/port allow-list, DNS/IP validation, redirect control, and private address blocking.

---

## 10. Logging and Telemetry Anti-Patterns

### 10.1 printf Debugging Left in Code — FORBIDDEN

**Smell**

- `System.out.println`, `printStackTrace`, or temporary debug logs.

**Corrective rule**

Use structured logger with level and context.

---

### 10.2 High-Cardinality Metrics — FORBIDDEN

**Smell**

- Labels include user ID, request ID, full URL, stack trace, email, token, order ID.

**Why dangerous**

- Metrics backend overload.
- Cost explosion.

**Corrective rule**

Use bounded low-cardinality dimensions.

---

### 10.3 Audit in Normal Logs Only — RESTRICTED

**Smell**

- Security/business audit events only appear as casual logs.

**Corrective rule**

Use explicit audit event model where regulatory traceability matters.

---

## 11. Testing Anti-Patterns

### 11.1 No Test for Changed Behavior — FORBIDDEN

**Smell**

- Production behavior changed but no test added/updated.

**Corrective rule**

Add unit/integration/contract/security test appropriate to risk.

---

### 11.2 Mocking Everything — RESTRICTED

**Smell**

- Tests assert mocks instead of behavior.
- Repository/mapper/query behavior never tested against real DB.

**Corrective rule**

Mock external boundaries for unit tests; use integration tests for persistence/messaging/HTTP contracts.

---

### 11.3 Flaky Time/Locale/Timezone Tests — FORBIDDEN

**Smell**

- Tests depend on current time, default timezone, default locale, random order.

**Corrective rule**

Inject `Clock`, set locale/timezone, use deterministic fixtures.

---

### 11.4 Benchmark as Unit Test — FORBIDDEN

**Smell**

- Unit test asserts runtime duration on shared CI hardware.

**Corrective rule**

Use JMH/performance suite for performance evidence.

---

## 12. Build and Dependency Anti-Patterns

### 12.1 Dynamic Dependency Versions — FORBIDDEN

**Smell**

- Maven/Gradle uses `latest.release`, `+`, snapshots, or unpinned plugin versions.

**Corrective rule**

Pin through BOM/version catalog/dependency management.

---

### 12.2 Dependency for One Line — RESTRICTED

**Smell**

- Adds a library for trivial string/date/collection helper.

**Corrective rule**

Use standard library or existing approved library.

---

### 12.3 Scope Leakage — FORBIDDEN

**Smell**

- Test libraries in production runtime.
- Implementation dependencies exposed as API.

**Corrective rule**

Use correct build scopes/configurations.

---

## 13. Configuration Anti-Patterns

### 13.1 Unsafe Production Defaults — FORBIDDEN

**Smell**

- Debug endpoints exposed.
- CORS `*` with credentials.
- Trust-all TLS.
- SQL logging with sensitive data.
- Default admin password.

**Corrective rule**

Use fail-closed production defaults.

---

### 13.2 Magic Environment Coupling — RESTRICTED

**Smell**

- Behavior changes based on hostname, local file path, default timezone, or machine-specific config.

**Corrective rule**

Use explicit configuration with validation.

---

### 13.3 Configuration Without Validation — FORBIDDEN BY DEFAULT

**Smell**

- App starts with missing/invalid timeout, URL, pool size, secret name, topic, or queue.

**Corrective rule**

Validate config at startup and fail fast.

---

## 14. LLM-Specific Anti-Patterns

### 14.1 Hallucinated API — FORBIDDEN

**Smell**

- Code calls methods/classes that do not exist or belong to another version.

**Corrective rule**

Check target dependency and Java baseline before coding.

---

### 14.2 Tutorial Code as Production Code — FORBIDDEN

**Smell**

- Sample credentials, no timeout, no validation, no error handling, no tests.

**Corrective rule**

Harden examples to production standard.

---

### 14.3 Broad Rewrite Without Need — FORBIDDEN

**Smell**

- Agent rewrites working code style/architecture beyond requested change.

**Corrective rule**

Make smallest cohesive change.

---

### 14.4 New Dependency to Avoid Understanding Existing Code — FORBIDDEN

**Smell**

- Agent adds mapper/client/utility library rather than following existing project conventions.

**Corrective rule**

Reuse existing approved abstractions unless there is a reviewed dependency proposal.

---

### 14.5 Suppress Warning as Fix — FORBIDDEN BY DEFAULT

**Smell**

- Adds `@SuppressWarnings`, disables lint, excludes failing tests, relaxes static analysis.

**Corrective rule**

Fix the root cause. Suppression requires narrow scope and written rationale.

---

## 15. Anti-Pattern Review Checklist

Reviewers and LLM agents must ask:

- Did this change add a god class/service?
- Did it hide business logic in mapper, entity listener, serializer, annotation, or utility?
- Did it weaken validation/authentication/authorization?
- Did it introduce broad exception handling?
- Did it introduce unbounded memory/thread/queue/cache behavior?
- Did it create new dependency or global state?
- Did it expose persistence models externally?
- Did it create hidden database queries or external calls?
- Did it add retry without idempotency?
- Did it add configuration without validation?
- Did it remove/skip tests?
- Did it suppress warnings instead of fixing cause?
- Did it rely on current time, default locale, default timezone, default charset, or unspecified order?
- Did it add code that only works because of local/dev environment?

---

## 16. Refactoring Protocol for Existing Anti-Patterns

When refactoring existing anti-patterns:

1. Characterize current behavior with tests before changing structure.
2. Identify invariants and external contracts.
3. Extract boundary models first.
4. Reduce mutation surface.
5. Move decisions to correct layer.
6. Add observability for changed failure paths.
7. Keep migration reversible where data/config/schema is involved.
8. Avoid mixing large cleanup with urgent feature change unless approved.

---

## 17. References

- Google Java Style Guide: https://google.github.io/styleguide/javaguide.html
- Oracle Secure Coding Guidelines for Java SE: https://www.oracle.com/java/technologies/javase/seccodeguide.html
- OWASP Java Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Java_Security_Cheat_Sheet.html
- OWASP Secure Code Review Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html
- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
