# Strict Coding Standards — Java Testing

> **Purpose**: This document defines mandatory rules for LLMs, code agents, and human contributors when creating, modifying, or reviewing Java tests.
>
> **Scope**: Java 11, Java 17, Java 21, and Java 25 codebases using JUnit, Mockito, AssertJ/Hamcrest, Testcontainers, WireMock, Awaitility, JaCoCo, PIT, ArchUnit, Maven, or Gradle.
>
> **Mode**: Strict. Tests are executable specifications. A code agent must not create tests that only satisfy coverage numbers while failing to prove behavior, invariants, failure paths, or integration contracts.

---

## 0. Core Principle

A test must prove an observable contract.

A code agent must not write tests merely to make CI green. Every test must answer:

1. what behavior is specified;
2. what input/state triggers it;
3. what output/state/side-effect is expected;
4. what boundary or invariant is protected;
5. which dependencies are real, fake, mocked, stubbed, or containerized;
6. whether time, randomness, concurrency, I/O, database, network, locale, and timezone are controlled;
7. what failure would look like if the production code regressed.

If the test cannot answer these, the test is not acceptable.

---

## 1. Test Taxonomy

### 1.1 Required categories

| Category               | Purpose                                                              | Dependencies                                        | Speed       | CI expectation              |
| ---------------------- | -------------------------------------------------------------------- | --------------------------------------------------- | ----------- | --------------------------- |
| Unit test              | Validate one class/function/policy in isolation                      | Mostly none or test doubles                         | Fast        | Always run on every commit  |
| Component test         | Validate module behavior with realistic collaborators inside process | Real mappers/validators/repositories where possible | Medium      | Run on PR                   |
| Integration test       | Validate interaction with real external technology                   | Testcontainers, embedded server, real driver        | Medium/Slow | Run on PR or gated CI stage |
| Contract test          | Validate API/message compatibility                                   | Contract artifact/schema/proto/OpenAPI              | Medium      | Run before publish/deploy   |
| End-to-end test        | Validate critical user/business journey                              | Real deployed stack or ephemeral env                | Slow        | Minimal, high-value only    |
| Architecture test      | Validate dependency/layering constraints                             | Bytecode/package scanning                           | Fast/Medium | Always run on PR            |
| Mutation test          | Validate test suite strength                                         | PIT or equivalent                                   | Slow        | Scheduled or targeted gate  |
| Performance smoke test | Detect obvious regressions                                           | Controlled workload                                 | Medium/Slow | Separate from unit tests    |

### 1.2 Forbidden category confusion

A code agent must not:

- call an integration test a unit test;
- hide real network/database calls inside unit tests;
- mock the class under test;
- use an in-memory substitute when production behavior depends on a real database/driver feature;
- use unit tests as microbenchmarks;
- treat line coverage as proof of correctness;
- create brittle E2E tests for behavior that can be tested lower in the pyramid.

---

## 2. Baseline Compatibility

### 2.1 Java baseline

All tests must compile and run under the project Java baseline.

| Project baseline | Rule                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Java 11          | Do not use Java 17/21/25 syntax in test sources unless test module has separate baseline policy.                                          |
| Java 17          | Records/sealed classes/pattern matching may be used in tests only if production baseline allows them.                                     |
| Java 21          | Virtual-thread tests are allowed only for concurrency behavior and must still assert bounded resource usage.                              |
| Java 25          | Scoped values may be tested only when production code uses them; preview APIs remain forbidden unless project explicitly enables preview. |

### 2.2 Test framework baseline

Prefer JUnit Platform/Jupiter for new tests.

Allowed:

- JUnit Jupiter lifecycle and assertions;
- AssertJ or Hamcrest for richer assertions if already approved in the project;
- Mockito for behavioral isolation;
- Testcontainers for real infrastructure integration;
- WireMock for HTTP dependency simulation;
- Awaitility for asynchronous assertions;
- ArchUnit for architecture rules;
- JaCoCo for coverage reporting;
- PIT for mutation testing.

Restricted:

- JUnit 4 legacy tests; keep only when migration is not part of the task;
- PowerMock or deep bytecode manipulation;
- static mocking;
- partial mocks/spies;
- reflection-heavy test access;
- sleep-based asynchronous tests;
- in-memory database substitutes for SQL dialect behavior.

Forbidden by default:

- tests that require external internet access;
- tests that depend on local machine timezone, locale, username, file path, or current wall clock;
- order-dependent tests without explicit order justification;
- non-deterministic random tests without captured seed;
- tests that pass only when run alone;
- disabling tests without documented issue/reference;
- swallowing assertion errors or exceptions;
- asserting only that code “does not throw” for behavior that has observable output.

---

## 3. Test Naming and Structure

### 3.1 Class naming

Use names that reveal level and target:

```text
MoneyCalculatorTest                 // unit
OrderServiceComponentTest           // component
OrderRepositoryIntegrationTest      // database integration
PaymentGatewayContractTest          // contract
CaseLifecycleArchitectureTest       // architecture
```

Do not use vague names:

```text
UtilsTest
ServiceTest
Test1
MainTest
```

### 3.2 Method naming

A test method name must describe scenario and expected behavior.

Recommended styles:

```java
void approve_shouldMoveCaseToApproved_whenAllMandatoryChecksPassed()
void calculateFee_shouldRejectNegativeAmount()
void findById_shouldReturnEmpty_whenRecordDoesNotExist()
```

Allowed alternative when team standard permits:

```java
void givenPendingCase_whenApprove_thenCaseBecomesApproved()
```

Forbidden:

```java
void testApprove()
void shouldWork()
void happyPath()
```

### 3.3 Arrange/Act/Assert

Tests should follow one visible flow:

```java
@Test
void approve_shouldPublishAuditEvent_whenApprovalSucceeds() {
    CaseId caseId = caseFixture.pendingCase();
    ApprovalCommand command = new ApprovalCommand(caseId, officerId, "valid reason");

    ApprovalResult result = service.approve(command);

    assertThat(result.status()).isEqualTo(CaseStatus.APPROVED);
    assertThat(auditEvents).containsExactly(
        AuditEvent.caseApproved(caseId, officerId)
    );
}
```

Rules:

- one primary behavior per test;
- multiple assertions are allowed when they describe one behavior;
- helper methods must improve readability, not hide the scenario;
- avoid “mystery fixtures” that make the test impossible to reason about.

---

## 4. Assertions

### 4.1 Assertions must be semantic

Prefer domain assertions over raw implementation assertions.

Good:

```java
assertThat(response.status()).isEqualTo(CaseStatus.REJECTED);
assertThat(response.reasons()).containsExactly("MISSING_REQUIRED_DOCUMENT");
```

Weak:

```java
assertNotNull(response);
assertEquals(1, response.getReasons().size());
```

### 4.2 Assertion rules

A code agent must:

- assert observable result, state, emitted event, persisted row, response body, error type, or external interaction;
- include meaningful failure messages only when assertion library output is insufficient;
- assert exact values for business rules;
- assert collection content and order only if order is part of the contract;
- assert error code/message only when it is stable API behavior.

A code agent must not:

- assert implementation details unrelated to contract;
- assert only that an object is non-null;
- assert private fields by reflection;
- rely on object `toString()` unless `toString()` itself is the contract;
- snapshot huge JSON/text without targeted semantic checks.

---

## 5. Unit Test Rules

### 5.1 Unit scope

A unit test should exercise one class, function, or policy with controlled collaborators.

Good unit-test targets:

- pure business rules;
- validators;
- mappers;
- state transition policies;
- amount/date calculation;
- retry decision policy;
- error mapping policy;
- authorization decision logic.

Bad unit-test targets:

- real database behavior;
- ORM lazy loading;
- SQL dialect behavior;
- HTTP client/server wiring;
- container startup;
- full application context when not needed.

### 5.2 Mocking rules

Mocks are allowed only for true boundaries:

- repository interface;
- gateway/client interface;
- clock/random/id generator;
- event publisher;
- mail/SMS/storage adapter;
- external authorization/identity provider.

Mocks are restricted for:

- domain objects;
- value objects;
- collections;
- DTOs;
- simple mappers;
- the class under test;
- framework classes.

Forbidden:

```java
Order order = mock(Order.class);        // domain object mock
List<String> names = mock(List.class);  // collection mock
when(service.method()).thenReturn(...); // class under test mocked
```

### 5.3 Interaction verification

Interaction verification is allowed only when interaction is the behavior.

Allowed:

```java
verify(eventPublisher).publish(new CaseApprovedEvent(caseId));
verifyNoMoreInteractions(eventPublisher);
```

Restricted:

```java
verify(repository).save(any());
```

This is acceptable only if persistence is the observable boundary being specified. Otherwise assert final state/result.

### 5.4 Strict stubbing

Tests must not accumulate unused stubs. Unused stubs indicate dead test setup or wrong scenario.

A code agent must remove unused stubs instead of marking them lenient, except when documenting a framework limitation.

---

## 6. Fixture and Test Data Rules

### 6.1 Fixture design

Use test data builders for complex domain objects.

```java
CaseFixture.pendingCase()
    .withApplicant(applicant)
    .withSubmittedDocument(requiredDocument)
    .build();
```

Rules:

- default fixture values must be valid and realistic;
- scenario-specific values must be visible in the test;
- random values must be deterministic or seed-captured;
- avoid global mutable fixture state;
- avoid sharing mutable objects across tests.

### 6.2 Test data minimality

Each test should contain the minimum data required to prove behavior.

Forbidden:

- loading a production-scale dump for unit tests;
- using opaque JSON fixtures without asserting relevant fields;
- using one “mega fixture” for unrelated tests;
- copying production secrets or PII into test resources.

### 6.3 Golden files

Golden files are allowed for stable serialized contracts.

Rules:

- file name must reveal scenario;
- file must be small enough to review;
- test must explain why snapshot comparison is appropriate;
- volatile fields must be normalized;
- intentional update must be reviewed like code.

---

## 7. Time, Date, Locale, and Randomness

### 7.1 Time

Production code that uses current time must accept `Clock` or equivalent time provider.

Tests must not call `Instant.now()`, `LocalDate.now()`, or `System.currentTimeMillis()` as uncontrolled inputs.

Good:

```java
Clock fixedClock = Clock.fixed(Instant.parse("2026-01-10T00:00:00Z"), ZoneOffset.UTC);
```

### 7.2 Timezone and DST

Tests involving date/time must explicitly set zone.

Required scenarios for time-sensitive logic:

- UTC timestamp;
- local date boundary;
- DST gap/overlap if business uses regional timezone;
- leap year if date arithmetic is involved;
- inclusive/exclusive interval edges.

### 7.3 Locale

Tests involving text case, number formatting, currency, or date formatting must set locale explicitly.

Forbidden:

```java
String value = amount.toString();
DateFormat.getDateInstance();
```

### 7.4 Randomness

Randomized tests must:

- use deterministic seed;
- print/capture failing seed;
- limit input size/time;
- preserve shrinking/reproduction if using property-based testing.

---

## 8. Exception and Failure Path Testing

### 8.1 Exception tests

Use exact exception type and semantic assertion.

```java
InvalidTransitionException ex = assertThrows(
    InvalidTransitionException.class,
    () -> workflow.approve(cancelledCase)
);
assertThat(ex.code()).isEqualTo("CASE_ALREADY_CANCELLED");
```

Forbidden:

```java
assertThrows(Exception.class, () -> workflow.approve(case));
```

### 8.2 Negative scenarios required

For each public behavior, tests should cover:

- valid request;
- invalid request;
- missing required input;
- boundary minimum/maximum;
- forbidden state transition;
- unauthorized/forbidden actor if applicable;
- downstream failure if behavior crosses boundary;
- idempotency/retry behavior if applicable.

### 8.3 Error mapping

API error tests must assert:

- HTTP/gRPC status;
- stable error code;
- message visibility policy;
- correlation/trace ID presence if part of contract;
- no sensitive data leakage.

---

## 9. Integration Test Rules

### 9.1 Real dependency policy

Use real dependencies when behavior depends on implementation-specific behavior.

Examples:

| Concern                                       | Preferred test dependency                          |
| --------------------------------------------- | -------------------------------------------------- |
| SQL dialect, transactions, isolation, indexes | Real database via Testcontainers                   |
| Kafka consumer/producer behavior              | Real broker or approved test container             |
| Redis TTL/atomic commands                     | Real Redis container                               |
| Object storage compatibility                  | LocalStack/MinIO if contract matches production    |
| HTTP dependency edge cases                    | WireMock or real sandbox                           |
| gRPC service                                  | In-process server/channel or containerized service |

### 9.2 In-memory database restriction

H2/HSQL/Derby are forbidden as substitutes for production database behavior unless:

- production database is the same engine; or
- the test only checks repository wiring independent of dialect; and
- the test name states the limitation.

### 9.3 Testcontainers rules

A Testcontainers test must:

- pin image name and tag/digest according to project policy;
- configure readiness/wait strategy;
- use dynamic ports;
- avoid fixed host ports;
- initialize schema/migrations through the same migration tool as production;
- isolate database/schema per test class or cleanup deterministically;
- avoid relying on container startup order without explicit dependency.

Forbidden:

- sleeping to wait for container readiness;
- connecting to developer-local service;
- depending on external internet during test execution;
- sharing mutable container state across unrelated test classes without cleanup.

---

## 10. Database Test Rules

### 10.1 Transaction correctness

Repository/service tests must verify behavior across transaction boundaries when relevant.

Required when modifying persistence behavior:

- insert/update/delete success path;
- not-found path;
- unique constraint violation;
- optimistic/pessimistic locking if used;
- rollback behavior;
- pagination/sorting contract;
- null/empty result behavior;
- timezone/numeric precision mapping;
- migration compatibility if schema changed.

### 10.2 Persistence assertions

Do not assert only returned DTO if behavior is persistence-sensitive.

Good:

```java
service.approve(caseId);

CaseRow row = jdbc.findCase(caseId);
assertThat(row.status()).isEqualTo("APPROVED");
assertThat(row.approvedAt()).isEqualTo(expectedInstant);
```

### 10.3 Cleanup

Allowed cleanup strategies:

- transaction rollback per test;
- truncate tables in safe order;
- recreate schema/container per suite;
- unique test tenant/schema/database.

Forbidden:

- tests depending on leftover rows;
- cleanup by broad production-like delete without test namespace;
- cleanup that ignores FK/order constraints and randomly flakes.

---

## 11. HTTP/API Test Rules

### 11.1 Server-side API tests

API tests must assert:

- status code;
- content type;
- response body contract;
- error contract;
- authentication/authorization outcome;
- idempotency when applicable;
- validation errors;
- no sensitive fields.

### 11.2 Client-side HTTP tests

Client tests must cover:

- success response;
- non-2xx response;
- timeout;
- connection failure;
- malformed response;
- retry policy for idempotent calls;
- no retry for unsafe calls unless idempotency key/contract exists;
- redaction of logged request/response.

### 11.3 WireMock/stub rules

Stubs must match meaningful request fields:

- method;
- path;
- query;
- headers where contract-relevant;
- body fields where contract-relevant.

Forbidden:

- stubs that match any request accidentally;
- tests that pass even if the client sends the wrong payload;
- sleeping for asynchronous callback verification.

---

## 12. Asynchronous and Concurrency Test Rules

### 12.1 No sleep-based assertions

Forbidden:

```java
Thread.sleep(1000);
assertThat(processor.result()).isEqualTo(expected);
```

Use Awaitility, latches, test schedulers, fake clocks, or deterministic synchronization.

### 12.2 Async assertions

Async tests must:

- have bounded timeout;
- fail with diagnostic output;
- avoid race-prone shared state;
- assert eventual state and failure state;
- verify cancellation/interrupt behavior if relevant.

### 12.3 Concurrency tests

Concurrency tests must not rely on “it probably races on my machine”.

Required when testing concurrent code:

- deterministic coordination barrier;
- multiple iterations only as supplementary stress;
- timeout to avoid hung CI;
- assertion of safety property and liveness property;
- no unbounded executor/thread creation;
- executor shutdown in teardown.

---

## 13. Security Test Rules

Security-relevant code must include tests for:

- authorization bypass;
- tenant isolation;
- invalid/missing token;
- invalid role/scope;
- input validation failure;
- SQL/JPQL injection attempt;
- path traversal attempt;
- SSRF blocked destination if URL input is accepted;
- XML external entity disabled if XML parser is used;
- unsafe JSON polymorphic payload rejection;
- secret redaction in logs/errors;
- crypto parameter validation if crypto helper is touched.

Do not include real secrets, production tokens, production PII, private keys, or certificates with real trust value in test resources.

---

## 14. Coverage Rules

### 14.1 Coverage is a signal, not proof

Coverage is mandatory as telemetry, but coverage alone is not correctness.

A code agent must not add tests that only execute lines without assertions.

### 14.2 Coverage thresholds

Project-specific thresholds should be configured per module. Default guidance:

| Scope                       |                        Suggested minimum | Notes                                           |
| --------------------------- | ---------------------------------------: | ----------------------------------------------- |
| Business rule modules       |            High line and branch coverage | Branch coverage matters more than line coverage |
| DTO/config classes          |                  Lower threshold allowed | Do not test generated boilerplate blindly       |
| Integration adapter modules | Coverage plus contract/integration tests | Mock-only coverage is insufficient              |
| Legacy modules              |                        Ratchet threshold | Avoid unrealistic immediate threshold jumps     |

### 14.3 Coverage exclusions

Exclusions must be explicit and justified.

Allowed exclusions:

- generated code;
- framework bootstrap;
- DTOs with no behavior, if project policy allows;
- migration scripts checked separately;
- impossible defensive branches with documented reason.

Forbidden exclusions:

- excluding complex business logic to pass quality gate;
- broad package exclusions;
- excluding new code without review.

---

## 15. Mutation Testing Rules

Mutation testing is recommended for critical business logic, validators, state machines, money/date calculations, and authorization decisions.

A surviving mutant requires one of:

1. add/strengthen test;
2. simplify/remove dead code;
3. mark equivalent mutant with documented justification.

A code agent must not suppress mutation failures blindly.

Mutation testing should be:

- targeted at stable critical modules first;
- run scheduled or in a dedicated CI stage;
- used to improve test oracle quality, not as a vanity metric.

---

## 16. Architecture Tests

Use architecture tests for rules that should never be re-litigated manually.

Examples:

- controllers must not depend on repositories directly;
- domain layer must not depend on infrastructure layer;
- no cyclic package dependency;
- DTO classes must not be used as domain entities;
- adapters must not be called from domain model;
- forbidden packages/classes are not imported;
- `java.util.Date` not used in new code;
- `System.currentTimeMillis()` not used outside infrastructure clock.

Architecture tests must be deterministic and documented as architectural contracts.

---

## 17. CI and Build Integration

### 17.1 Test segregation

Tests must be separable by build lifecycle.

Maven naming convention:

```text
*Test.java                 -> unit test / Surefire
*ComponentTest.java        -> optional component test suite
*IntegrationTest.java      -> integration test / Failsafe
*IT.java                   -> integration test / Failsafe if project uses this convention
```

Gradle convention:

```text
src/test/java              -> unit tests
src/componentTest/java     -> component tests if configured
src/integrationTest/java   -> integration tests if configured
src/contractTest/java      -> contract tests if configured
```

### 17.2 CI requirements

Every PR must run:

- compilation;
- unit tests;
- static analysis/lint if configured;
- architecture tests;
- coverage report/check for affected modules.

Integration/contract/security tests may run in a separate stage but must be required before deploy.

### 17.3 Flaky test policy

A flaky test is a production risk.

A code agent must not mark flaky tests as ignored without:

- capturing failure evidence;
- identifying suspected nondeterminism;
- creating issue/reference;
- reducing blast radius;
- adding deterministic fix if possible.

---

## 18. Test Smells Forbidden by Default

Forbidden:

- assertion-free test;
- excessive mocking of internal details;
- static/global mutable test state;
- order-dependent tests;
- `Thread.sleep` for async behavior;
- tests depending on current date/time;
- tests depending on default locale/timezone;
- tests that use production config/secrets;
- broad `catch (Exception ignored)`;
- printing instead of asserting;
- snapshot-only tests for complex behavior;
- huge fixture files with no semantic explanation;
- tests that verify implementation rather than contract;
- changing production code only to make tests easier without design justification.

---

## 19. LLM Code Agent Protocol

Before adding or changing tests, the agent must state:

```text
Test Target:
Test Level:
Behavior/Contract:
Dependencies Real/Mocked/Stubbed:
Time/Locale/Randomness Control:
Failure Paths Covered:
Boundary Cases Covered:
Data Setup/Cleanup:
CI Impact:
```

The agent must not:

- create tests after implementation as superficial coverage filler;
- modify production behavior to match a weak test;
- remove failing assertions without explaining contract change;
- replace integration tests with mocks when real technology behavior matters;
- use generated test names that hide business meaning.

---

## 20. Reviewer Checklist

A reviewer must reject the change if any answer is “no”:

- Does each test prove a visible behavior?
- Is the test level correct?
- Are dependencies intentionally real/mocked/stubbed?
- Are time, locale, randomness, and concurrency deterministic?
- Are negative/failure paths covered?
- Are boundary cases covered?
- Is test data minimal and readable?
- Are assertions semantic and strong?
- Are resources cleaned up?
- Are integration dependencies realistic?
- Are coverage changes meaningful rather than cosmetic?
- Are flaky-test risks reduced?
- Does CI run the right suites at the right stage?

---

## 21. References

- JUnit User Guide: https://docs.junit.org/
- Mockito: https://site.mockito.org/
- AssertJ: https://assertj.github.io/doc/
- Testcontainers for Java: https://java.testcontainers.org/
- WireMock: https://wiremock.org/
- Awaitility: https://www.awaitility.org/
- JaCoCo: https://www.jacoco.org/jacoco/
- PIT Mutation Testing: https://pitest.org/
- ArchUnit: https://www.archunit.org/
- Maven Surefire/Failsafe: https://maven.apache.org/surefire/
- Gradle Testing: https://docs.gradle.org/current/userguide/java_testing.html
