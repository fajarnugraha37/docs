# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-026
# Testing I: Unit, Component, QuarkusTest, Profiles, Mocking, Continuous Testing

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Part: `026`  
> Topik: Testing I: Unit, Component, QuarkusTest, Profiles, Mocking, Continuous Testing  
> Status: Materi lanjutan advance — tidak mengulang dasar JUnit/Mockito/testing umum  
> Target: Software engineer yang mampu membangun test suite Quarkus yang cepat, deterministik, meaningful, CI-friendly, dan mampu menangkap regression penting tanpa menjadi beban delivery

---

## 0. Ringkasan Besar

Testing di Quarkus sering disalahpahami sebagai:

```text
Semua test pakai @QuarkusTest.
Semua dependency pakai Dev Services.
Semua endpoint dites lewat HTTP.
Semua repository dites dengan database sungguhan.
Semua external API dimock secara global.
```

Hasilnya:

- test suite lambat,
- flaky,
- sulit dipahami,
- sulit dijalankan lokal,
- CI mahal,
- developer malas menjalankan test,
- regression tetap lolos,
- test terlalu dekat implementation detail,
- production failure mode tidak tercakup.

Testing yang baik bukan jumlah test sebanyak mungkin.

Testing yang baik adalah **risk-driven feedback system**.

Quarkus menyediakan banyak mode testing:

1. **Plain unit test**
   - tanpa Quarkus runtime,
   - tercepat,
   - cocok untuk pure domain logic.

2. **Component/CDI test**
   - memakai CDI container ringan,
   - tidak start full Quarkus application,
   - cocok untuk bean/service dengan injection/config/interceptor ringan.

3. **`@QuarkusTest`**
   - start Quarkus application untuk test,
   - cocok untuk integration-style test dalam JVM,
   - bisa inject beans,
   - bisa test REST endpoint.

4. **Test profiles**
   - config/beans/resources berbeda per test scenario.

5. **Mocking CDI beans**
   - override dependency dalam test.

6. **Dev Services**
   - auto-provision database, Kafka, Redis, RabbitMQ, Keycloak, dan dependency lain di dev/test bila extension mendukung dan config belum diberikan.

7. **Continuous testing**
   - test berjalan otomatis saat code berubah,
   - Quarkus memilih test relevan berdasarkan perubahan.

Part ini membahas bagaimana menyusun testing architecture Quarkus yang efisien.

---

## 1. Mental Model: Test Suite Adalah Feedback Architecture

Test suite bukan ritual CI.

Test suite adalah sistem feedback.

Pertanyaan utama:

```text
Bug apa yang ingin kita tangkap?
Seberapa cepat feedback harus muncul?
Seberapa mahal setup yang dibutuhkan?
Seberapa dekat test ke production behavior?
Seberapa stabil test tersebut?
Apa risiko jika test ini tidak ada?
```

Setiap test harus punya alasan.

Contoh:

```text
Pure state transition rule -> plain unit test.
CDI wiring/config boundary -> component test.
REST contract + validation + mapper -> @QuarkusTest.
DB query shape + migration -> integration test with DB.
Native image compatibility -> @QuarkusIntegrationTest/native test.
External provider contract -> contract test/mock server.
```

Jangan pakai test paling berat untuk semua hal.

Invariant:

```text
Use the lightest test that can catch the risk.
```

---

## 2. Testing Pyramid untuk Quarkus

Testing pyramid Quarkus yang sehat:

```text
                 /\
                /  \        Native / black-box / E2E
               /----\
              /      \      @QuarkusTest integration
             /--------\
            /          \    Component/CDI tests
           /------------\
          /              \  Plain unit/domain tests
         /----------------\
```

### 2.1 Plain Unit Tests

- paling cepat,
- tidak start Quarkus,
- tidak butuh CDI,
- cocok untuk domain logic,
- cocok untuk state machine,
- cocok untuk mapper pure,
- cocok untuk validation business rules,
- harus banyak.

### 2.2 Component Tests

- lebih berat dari unit,
- lebih ringan dari full Quarkus,
- menguji CDI bean + config + injection,
- cocok untuk application service/gateway dengan mocks.

### 2.3 `@QuarkusTest`

- start Quarkus app,
- cocok untuk REST/resource/config/security/persistence integration,
- lebih lambat,
- harus selektif.

### 2.4 Integration/Native/E2E Tests

- paling berat,
- validasi artifact nyata,
- test packaging/runtime/native/container,
- jumlah sedikit tetapi critical.

Rule:

```text
Semakin tinggi level test, semakin sedikit jumlahnya dan semakin besar nilai risikonya.
```

---

## 3. Plain Unit Test: Jangan Selalu Start Quarkus

Quarkus tidak perlu untuk menguji pure Java logic.

Contoh domain state transition:

```java
public final class Application {

    private ApplicationStatus status;

    public StateTransition approve(String reason) {
        if (status != ApplicationStatus.UNDER_REVIEW) {
            throw new InvalidStateTransitionException(status, ApplicationStatus.APPROVED);
        }

        ApplicationStatus from = status;
        status = ApplicationStatus.APPROVED;

        return new StateTransition(from, status, reason);
    }
}
```

Test:

```java
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ApplicationTest {

    @Test
    void approve_fromUnderReview_shouldMoveToApproved() {
        Application application = Application.underReview();

        StateTransition transition = application.approve("documents verified");

        assertEquals(ApplicationStatus.APPROVED, application.status());
        assertEquals(ApplicationStatus.UNDER_REVIEW, transition.from());
        assertEquals(ApplicationStatus.APPROVED, transition.to());
    }

    @Test
    void approve_fromDraft_shouldFail() {
        Application application = Application.draft();

        assertThrows(
                InvalidStateTransitionException.class,
                () -> application.approve("invalid")
        );
    }
}
```

No CDI.

No database.

No Quarkus.

Fast.

This is ideal for:

- state machine,
- policy decisions,
- authorization rule objects,
- mapping pure objects,
- retry classifier,
- error taxonomy,
- cache key generation,
- idempotency key generation,
- time window calculation,
- batch partition algorithm.

---

## 4. What Should Be Unit Tested Heavily

High-value unit test targets:

1. **State transitions**
   - valid/invalid transitions,
   - guard conditions,
   - reason required,
   - actor allowed.

2. **Authorization policy**
   - role,
   - ownership,
   - tenant,
   - status,
   - delegation.

3. **Retry/error classification**
   - 429 retryable,
   - 403 not retryable,
   - validation not retryable,
   - timeout retryable if idempotent.

4. **Cache key generation**
   - tenant included,
   - normalized input,
   - versioned key.

5. **Idempotency**
   - same request same key,
   - different payload same key rejected,
   - retry recognized.

6. **Mapping**
   - external DTO to domain snapshot,
   - unknown enum,
   - null handling.

7. **Time logic**
   - expiry date,
   - business day,
   - timezone,
   - window boundary.

8. **Batch partitioning**
   - cursor,
   - checkpoint,
   - empty page,
   - last item.

These tests should run in milliseconds.

---

## 5. `@QuarkusTest`: Full Application Test

Quarkus official testing guide explains that `@QuarkusTest` starts the Quarkus application for tests and supports injection into tests, including testing native executables in separate integration test style.

Basic example:

```java
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.is;

@QuarkusTest
class GreetingResourceTest {

    @Test
    void helloEndpoint() {
        given()
          .when().get("/hello")
          .then()
             .statusCode(200)
             .body(is("hello"));
    }
}
```

Use `@QuarkusTest` when you need:

- Quarkus runtime,
- CDI wiring,
- REST endpoint,
- filters/interceptors,
- config resolution,
- security integration,
- database integration,
- transaction behavior,
- extension behavior,
- Dev Services,
- OpenAPI/serialization/validation integration.

Do not use `@QuarkusTest` for pure Java logic.

---

## 6. Injecting Beans in `@QuarkusTest`

```java
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

@QuarkusTest
class ApplicationServiceTest {

    @Inject
    ApplicationService applicationService;

    @Test
    void submit_shouldCreateApplication() {
        SubmitResult result = applicationService.submit(validCommand());

        assertEquals(SubmitStatus.SUBMITTED, result.status());
    }
}
```

This tests with real CDI wiring.

Good for:

- service integration,
- transaction boundary,
- repository integration,
- CDI interceptors,
- config mapping.

But beware:

```text
If every service test uses @QuarkusTest, suite becomes slow.
```

---

## 7. REST Assured for Endpoint Tests

Quarkus testing guide commonly uses REST Assured for HTTP endpoint tests.

Example:

```java
@QuarkusTest
class ApplicationResourceTest {

    @Test
    void submit_validRequest_shouldReturn201() {
        given()
            .contentType("application/json")
            .body("""
                {
                  "applicantId": "A-123",
                  "type": "SALESPERSON"
                }
                """)
        .when()
            .post("/applications")
        .then()
            .statusCode(201)
            .body("status", is("SUBMITTED"));
    }
}
```

Endpoint tests should focus on contract:

- URL/path,
- method,
- status code,
- request validation,
- response shape,
- error contract,
- security behavior,
- serialization,
- headers.

Do not assert internal implementation details.

---

## 8. Component Testing with `QuarkusComponentTestExtension`

Quarkus provides `QuarkusComponentTestExtension` for testing CDI components without starting full Quarkus application. The official component testing guide says it starts the CDI container and configuration service, but not the full Quarkus application. This makes it useful for testing beans and mocking dependencies faster than `@QuarkusTest`.

Conceptual example:

```java
import io.quarkus.test.component.QuarkusComponentTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

@QuarkusComponentTest
class ExpiryPolicyServiceTest {

    @Inject
    ExpiryPolicyService service;

    @Test
    void shouldExpireAfterDeadline() {
        ExpiryDecision decision = service.evaluate(applicationPastDeadline());

        assertEquals(ExpiryDecision.EXPIRE, decision);
    }
}
```

Good for:

- CDI bean logic,
- config injection,
- lightweight service tests,
- mocking dependencies,
- avoiding full app startup.

Use component tests when:

```text
Plain unit test is too manual because CDI/config matters,
but @QuarkusTest is too heavy.
```

---

## 9. Choosing Test Type

Decision table:

| Risk / Need | Best Test Type |
|---|---|
| Pure state machine | Plain unit test |
| Cache key generator | Plain unit test |
| Retry classifier | Plain unit test |
| CDI injection/config mapping | Component test |
| Service with mocked gateway/repository | Component test |
| REST validation/error contract | `@QuarkusTest` HTTP test |
| Transaction + database query | `@QuarkusTest` with test DB |
| Security annotations / identity | `@QuarkusTest` security test |
| Dev Services integration | `@QuarkusTest` |
| Native image compatibility | `@QuarkusIntegrationTest` / native test |
| External API contract | mock server / contract test |
| Full business journey | E2E/smoke test |

Rule:

```text
Do not test every business rule through HTTP.
Do not test every CDI bean with full Quarkus.
Do not mock what you are trying to verify.
```

---

## 10. Test Profiles

Quarkus supports test profiles to run tests under different configuration.

Use cases:

- different config values,
- disable scheduler,
- mock external dependencies,
- use specific datasource,
- enable/disable security mode,
- test multiple tenants,
- test feature flag.

Conceptual:

```java
import io.quarkus.test.junit.QuarkusTestProfile;

import java.util.Map;

public class ApplicationTestProfile implements QuarkusTestProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        return Map.of(
                "jobs.expiry.enabled", "false",
                "external.identity.base-url", "http://localhost:9999",
                "feature.new-workflow.enabled", "true"
        );
    }
}
```

Use:

```java
import io.quarkus.test.junit.TestProfile;

@QuarkusTest
@TestProfile(ApplicationTestProfile.class)
class ApplicationResourceTest {
}
```

Benefits:

- scenario-specific config,
- less global test pollution,
- clearer intent.

Caution:

```text
Too many profiles can slow test suite because Quarkus may restart per profile.
```

Group tests by profile where possible.

---

## 11. Config Override Strategy

Testing config should be explicit.

Sources:

- `application.properties`,
- `%test` profile config,
- `QuarkusTestProfile`,
- test resources,
- system properties,
- env vars,
- Dev Services auto config.

Recommended:

```text
Use %test for common test config.
Use TestProfile for scenario-specific config.
Use test resources for dynamic external endpoints.
Avoid relying on developer machine env vars.
```

Example:

```properties
%test.jobs.expiry.enabled=false
%test.quarkus.log.category."com.acme".level=DEBUG
%test.external.identity.timeout=500ms
```

Do not let tests accidentally hit real external services.

---

## 12. Mocking CDI Beans

Quarkus testing supports mocking CDI beans using `@InjectMock` and related approaches depending on extension setup. `QuarkusMock` can also install mock instances for CDI beans in tests.

### 12.1 `@InjectMock` Concept

```java
import io.quarkus.test.InjectMock;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.*;

@QuarkusTest
class ApplicationSubmissionTest {

    @InjectMock
    IdentityGateway identityGateway;

    @Inject
    ApplicationService applicationService;

    @Test
    void submit_whenIdentityValid_shouldSucceed() {
        when(identityGateway.loadIdentity(any()))
                .thenReturn(validIdentity());

        SubmitResult result = applicationService.submit(validCommand());

        verify(identityGateway).loadIdentity(any());
    }
}
```

This is useful when:

- external gateway should not be called,
- dependency behavior is scenario-specific,
- testing service behavior under dependency failure.

### 12.2 Mocking Risks

Mocking can hide integration problems:

- wrong config,
- wrong serialization,
- wrong transaction behavior,
- missing CDI qualifier,
- security interceptor not applied,
- REST client mapper broken.

Rule:

```text
Mock at boundaries, not everywhere.
Have at least some integration tests with real wiring.
```

---

## 13. QuarkusMock Concept

`QuarkusMock` allows installing mock objects for normal scoped CDI beans.

Conceptual:

```java
import io.quarkus.test.junit.QuarkusMock;
import org.junit.jupiter.api.BeforeEach;

class SomeTest {

    @BeforeEach
    void setup() {
        IdentityGateway mock = mock(IdentityGateway.class);
        when(mock.loadIdentity(any())).thenReturn(validIdentity());

        QuarkusMock.installMockForType(mock, IdentityGateway.class);
    }
}
```

Use carefully.

Important:

```text
Mocking final/native/unremovable/singleton behavior may have constraints.
Always verify against Quarkus testing guide for selected version.
```

---

## 14. Mocking External HTTP APIs

For REST clients, prefer mock HTTP server over mocking client interface when you need to test:

- serialization,
- headers,
- path/query,
- status mapping,
- timeout,
- retry,
- 401 refresh,
- 429 backoff,
- correlation propagation.

Mocking interface:

```text
good for business service test
bad for HTTP contract test
```

Mock HTTP server:

```text
good for gateway/client integration test
```

Test scenarios:

- 200 success,
- 400 validation,
- 401 refresh once,
- 403 no retry,
- 404 mapping,
- 429 retry-after,
- 500 retry,
- malformed JSON,
- timeout.

---

## 15. Dev Services in Tests

Quarkus Dev Services can automatically provision unconfigured services in dev and test mode. Official guide says if an extension is included and not configured, Quarkus can start the relevant service, usually using Testcontainers, and wire the application automatically.

Examples:

- database,
- Kafka,
- RabbitMQ,
- Redis,
- Keycloak,
- Infinispan,
- Elasticsearch/OpenSearch depending extension.

### 15.1 Dev Services Benefits

- less manual setup,
- realistic dependencies,
- good local onboarding,
- consistent test infra,
- fast experimentation.

### 15.2 Dev Services Risks

- needs Docker,
- startup can be slow,
- test suite becomes integration-heavy,
- hidden dependency if not documented,
- container image pull issue,
- CI environment may differ,
- port/resource collision,
- data isolation must be managed.

### 15.3 Rule

Use Dev Services when:

```text
The purpose is to test integration with that dependency.
```

Do not use Dev Services for every test by default.

---

## 16. Database Testing Strategy

Database tests are necessary for:

- SQL correctness,
- ORM mapping,
- migration correctness,
- transaction behavior,
- locking,
- constraints,
- pagination/query shape,
- multi-tenancy,
- performance-sensitive query plan.

But do not test all business rules through DB.

### 16.1 Repository Test

```java
@QuarkusTest
class ApplicationRepositoryTest {

    @Inject
    ApplicationRepository repository;

    @Test
    @Transactional
    void findExpired_shouldReturnOnlyPastDeadline() {
        // seed
        // query
        // assert
    }
}
```

### 16.2 Data Cleanup

Options:

1. transaction rollback,
2. truncate tables,
3. recreate schema,
4. per-test tenant/schema,
5. testcontainers reset,
6. migration baseline.

Avoid order-dependent tests.

### 16.3 Migration Testing

Use Flyway/Liquibase test:

```text
empty DB -> run migrations -> app starts -> schema valid
```

Also test:

```text
migration from previous schema/data snapshot -> new version
```

---

## 17. Transaction Testing Pitfalls

### 17.1 Test Transaction Hides Commit Behavior

If test wraps everything in one transaction and rolls back:

```text
after-commit events do not fire
outbox publishing not tested
DB constraints timing may differ
```

For outbox/audit tests, sometimes you need real commit.

### 17.2 Lazy Loading Hidden by Open Transaction

A test may pass because transaction/session remains open.

Production endpoint may fail after transaction closed.

Be deliberate:

- test service transaction boundary,
- test DTO projection,
- test lazy relation access outside transaction if relevant.

### 17.3 Clock and Time

Do not use real `Instant.now()` uncontrolled.

Inject clock.

Test boundary:

```text
deadline exactly now
deadline before now
timezone change
month end
DST if applicable
```

---

## 18. Security Testing

Quarkus has a security testing guide.

Security tests should cover:

- unauthenticated request,
- authenticated without role,
- authenticated with role,
- resource ownership,
- tenant boundary,
- method security,
- path policy,
- token claim mapping,
- permission denial audit/log.

Example conceptual:

```java
@QuarkusTest
class CaseResourceSecurityTest {

    @Test
    void unauthenticated_shouldReturn401() {
        given()
        .when()
            .get("/cases/CASE-1")
        .then()
            .statusCode(401);
    }
}
```

For authenticated tests, Quarkus supports test security utilities in its security testing extension.

Do not only test happy path admin user.

---

## 19. Testing Validation and Error Contract

Endpoint validation tests are high value.

Test:

- missing required field,
- invalid enum,
- invalid date,
- unknown field policy,
- malformed JSON,
- too long string,
- cross-field validation,
- business validation,
- error response shape.

Example expected error:

```json
{
  "type": "https://example.com/errors/validation",
  "title": "Validation failed",
  "status": 400,
  "errors": [
    {
      "field": "applicantId",
      "code": "REQUIRED"
    }
  ],
  "correlationId": "..."
}
```

Test should assert contract, not raw stack trace.

---

## 20. Continuous Testing

Quarkus continuous testing runs tests after code changes are saved and tries to run only relevant tests. Official continuous testing guide states Quarkus detects which tests cover which code and uses this information to run relevant tests when code changes.

Why useful:

- tight feedback loop,
- less context switching,
- encourages test-first/fix-fast,
- catches regression before CI.

Run in dev mode:

```bash
./mvnw quarkus:dev
```

Continuous testing can be controlled from console/Dev UI depending version/setup.

Config concept:

```properties
quarkus.test.continuous-testing=enabled
```

Use continuous testing for:

- domain logic,
- component tests,
- selected integration tests,
- feedback during refactoring.

Avoid making all tests so heavy that continuous testing becomes unusable.

---

## 21. Test Speed Engineering

A top-tier test suite optimizes feedback speed.

Techniques:

1. Many plain unit tests.
2. Component tests instead of full app where possible.
3. Group `@QuarkusTest` by profile to reduce restarts.
4. Avoid unnecessary Dev Services.
5. Avoid sleeps.
6. Use fake clocks.
7. Use deterministic IDs.
8. Avoid waiting for real timeouts.
9. Use test-specific smaller datasets.
10. Parallelize where safe.
11. Separate fast tests and slow tests.
12. Run smoke/native tests separately.

### 21.1 Test Categories

Example:

```text
unit
component
integration
contract
native
e2e
performance
```

CI can run:

```text
PR: unit + component + selected integration
main: full integration + contract
nightly: native + performance + chaos
release: full suite
```

---

## 22. Flaky Test Causes

Common causes:

- real time sleeps,
- race conditions,
- shared mutable state,
- non-isolated database,
- random ports,
- external network calls,
- order-dependent tests,
- asynchronous processing without deterministic waiting,
- clock/timezone assumptions,
- relying on current date,
- Dev Services container startup variability,
- parallel tests sharing resources,
- eventually consistent messaging assertions too strict.

Rule:

```text
A flaky test is a production risk signal or a bad test. Do not ignore it.
```

---

## 23. Testing Async and Eventually Consistent Flows

For outbox/messaging/job flows, do not use arbitrary sleeps.

Bad:

```java
Thread.sleep(5000);
assertEquals(...);
```

Better:

```text
poll until condition or timeout
```

Conceptual helper:

```java
public static void eventually(Duration timeout, Runnable assertion) {
    Instant deadline = Instant.now().plus(timeout);
    AssertionError last = null;

    while (Instant.now().isBefore(deadline)) {
        try {
            assertion.run();
            return;
        } catch (AssertionError e) {
            last = e;
            try {
                Thread.sleep(100);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new RuntimeException(interrupted);
            }
        }
    }

    throw last == null ? new AssertionError("condition not met") : last;
}
```

Use bounded waiting.

---

## 24. Testing Schedulers and Jobs

Do not wait for cron time in tests.

Expose job service directly:

```java
@Inject
ExpiryJobService expiryJobService;

@Test
void expiryJob_shouldExpireDueApplications() {
    JobRunId runId = expiryJobService.triggerManual("test");

    assertJobCompleted(runId);
}
```

Test:

- idempotency,
- lock not acquired,
- checkpoint,
- partial failure,
- retry item,
- cancellation,
- timeout,
- job_run record,
- per-item result,
- audit events.

Scheduler annotation itself needs fewer tests than job logic.

---

## 25. Testing Cache

Test:

- key normalization,
- tenant included,
- cache hit/miss behavior,
- invalidation after update,
- TTL concept with fake clock where possible,
- stale fallback,
- negative caching,
- Redis outage behavior,
- serialization version.

Avoid relying on long real TTL.

Expose cache invalidation operations.

For Redis, integration tests should verify:

- key format,
- TTL set,
- atomic NX if idempotency,
- fail behavior.

---

## 26. Testing Fault Tolerance

For Part 023 policies, test:

- timeout,
- retry count,
- abortOn behavior,
- circuit open,
- fallback used,
- bulkhead rejected,
- rate limit,
- 401 refresh once,
- 429 backoff,
- no retry for non-idempotent operation.

Do not assume annotations behave as intended.

Write tests that prove behavior.

---

## 27. Testing Observability

Observability can be tested.

Examples:

- important metrics incremented,
- error code emitted,
- audit event inserted,
- correlation ID returned,
- structured log field exists in integration test if feasible,
- trace attributes in advanced tests.

Do not over-test logs, but do test mandatory audit.

Audit tests are business tests.

---

## 28. Native Testing Preview

Part 027 will go deeper into native/integration testing.

For now:

```text
JVM tests passing does not guarantee native image works.
```

Native can fail due to:

- reflection,
- serialization,
- dynamic proxies,
- resource inclusion,
- TLS/crypto,
- class initialization,
- external client behavior.

Have at least targeted native tests for:

- REST endpoints,
- serialization,
- security,
- REST clients,
- persistence,
- scheduled startup if relevant.

---

## 29. Test Data Design

Bad test data:

```text
random huge JSON copied from production
unclear IDs
shared global fixtures
magic dates
```

Good test data:

- minimal,
- explicit,
- named,
- domain-relevant,
- builder/factory pattern,
- no PII,
- deterministic,
- readable.

Example:

```java
ApplicationFixture.underReview()
        .withApplicant("APPLICANT-1")
        .withSubmittedAt(Instant.parse("2026-06-20T10:00:00Z"))
        .build();
```

Use object mothers/builders carefully; do not hide essential state.

---

## 30. Test Naming

Good test name tells scenario and expected behavior.

Examples:

```text
submit_whenIdentityProviderTimesOut_shouldReturnDependencyUnavailable
approve_whenApplicationAlreadyApproved_shouldRejectTransition
findExpired_whenDeadlineEqualsNow_shouldNotExpire
cacheKey_whenPostalCodeHasSpaces_shouldNormalize
authorize_whenUserNotAssigned_shouldDeny
```

Avoid:

```text
testSubmit
test1
shouldWork
```

---

## 31. CI Strategy

CI should separate feedback layers.

Example:

```text
Stage 1: compile + unit tests
Stage 2: component tests
Stage 3: Quarkus integration tests with Dev Services
Stage 4: contract tests
Stage 5: native build/test optional per branch
Stage 6: performance/smoke nightly
```

PR should be fast.

Release should be thorough.

Do not force every developer to wait 45 minutes for every small change.

---

## 32. Coverage

Quarkus has guide for measuring test coverage. It notes coverage of unit and integration tests and also states code coverage is not supported in native mode.

Coverage is useful but limited.

Good:

```text
Find untested areas.
Enforce baseline.
Track trend.
```

Bad:

```text
Worship 90% number.
Test getters to increase coverage.
Ignore critical untested paths.
```

Better metrics:

- critical path coverage,
- mutation testing if available,
- branch coverage for policy/state machine,
- integration coverage for risky boundary,
- defect escape rate.

---

## 33. Test Suite Smell

Warning signs:

1. All tests are `@QuarkusTest`.
2. Tests need a specific order.
3. Tests fail only in CI.
4. Tests sleep often.
5. Tests hit real external APIs.
6. Test data copied from production.
7. Mocking too deep.
8. No test for error paths.
9. No test for authorization denial.
10. No test for time boundary.
11. No test for transaction rollback.
12. No test for duplicate/retry.
13. No contract test for external integration.
14. Developers avoid running tests locally.

---

## 34. Implementation Blueprint: Layered Test Layout

Suggested structure:

```text
src/test/java
  com/acme/application/domain
    ApplicationStateMachineTest.java
    ExpiryPolicyTest.java

  com/acme/application/component
    ApplicationServiceComponentTest.java
    AuthorizationPolicyComponentTest.java

  com/acme/application/resource
    ApplicationResourceTest.java
    ApplicationResourceValidationTest.java
    ApplicationResourceSecurityTest.java

  com/acme/application/persistence
    ApplicationRepositoryTest.java
    ApplicationMigrationTest.java

  com/acme/application/integration
    IdentityGatewayTest.java
    OutboxPublisherTest.java

  com/acme/application/job
    ExpiryJobServiceTest.java

  com/acme/application/support
    fixtures/
    assertions/
    testprofiles/
```

Naming convention:

```text
*Test.java              fast/unit/component
*IT.java                heavier integration or native depending build config
```

Use build tooling to separate.

---

## 35. Implementation Blueprint: Test Profile

```java
import io.quarkus.test.junit.QuarkusTestProfile;

import java.util.Map;
import java.util.Set;

public class NoSchedulerProfile implements QuarkusTestProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        return Map.of(
                "jobs.expiry.enabled", "false",
                "jobs.reconciliation.enabled", "false",
                "external.identity.enabled", "false"
        );
    }

    @Override
    public Set<String> tags() {
        return Set.of("no-scheduler");
    }
}
```

Usage:

```java
@QuarkusTest
@TestProfile(NoSchedulerProfile.class)
class ApplicationResourceTest {
}
```

---

## 36. Implementation Blueprint: Gateway Test with Mock Server

Conceptual:

```java
@QuarkusTest
@TestProfile(IdentityGatewayMockServerProfile.class)
class IdentityGatewayTest {

    @Inject
    IdentityGateway gateway;

    @Test
    void loadIdentity_whenProviderReturns200_shouldMapResponse() {
        // arrange mock server response

        IdentitySnapshot snapshot = gateway.loadIdentity(new ApplicantId("A-123"));

        assertEquals("A-123", snapshot.applicantId());
    }

    @Test
    void loadIdentity_whenProviderReturns503_shouldClassifyUnavailable() {
        // arrange 503

        assertThrows(
                ExternalUnavailableException.class,
                () -> gateway.loadIdentity(new ApplicantId("A-123"))
        );
    }
}
```

Purpose:

```text
Test real REST client serialization/header/error mapping.
```

Not just mock interface.

---

## 37. Implementation Blueprint: Component Test with Mocked Dependency

```java
import io.quarkus.test.component.QuarkusComponentTest;
import io.quarkus.test.InjectMock;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.*;

@QuarkusComponentTest
class ApplicationSubmissionComponentTest {

    @Inject
    ApplicationSubmissionService service;

    @InjectMock
    IdentityGateway identityGateway;

    @Test
    void submit_whenIdentityValid_shouldSubmit() {
        when(identityGateway.loadIdentity(any()))
                .thenReturn(IdentityFixture.valid());

        SubmitResult result = service.submit(SubmitFixture.validCommand());

        assertEquals(SubmitStatus.SUBMITTED, result.status());
    }
}
```

This is faster than full HTTP/DB test if persistence is mocked/fake.

---

## 38. Implementation Blueprint: Resource Contract Test

```java
@QuarkusTest
@TestProfile(NoSchedulerProfile.class)
class ApplicationResourceValidationTest {

    @Test
    void submit_whenApplicantIdMissing_shouldReturnValidationError() {
        given()
            .contentType("application/json")
            .body("""
                {
                  "type": "SALESPERSON"
                }
                """)
        .when()
            .post("/applications")
        .then()
            .statusCode(400)
            .body("title", is("Validation failed"))
            .body("errors[0].field", is("applicantId"))
            .body("errors[0].code", is("REQUIRED"));
    }
}
```

This validates API contract, not internals.

---

## 39. Production Checklist

### 39.1 Test Architecture

- [ ] Test pyramid defined.
- [ ] Unit tests cover domain/state/policy.
- [ ] Component tests cover CDI/config logic.
- [ ] `@QuarkusTest` used selectively.
- [ ] Integration tests cover DB/REST/client boundaries.
- [ ] Native tests planned for native deployment.
- [ ] E2E tests minimal but critical.

### 39.2 Speed and Stability

- [ ] Fast tests run locally.
- [ ] Continuous testing usable.
- [ ] No unnecessary sleeps.
- [ ] Fake clock used for time logic.
- [ ] Test data isolated.
- [ ] Dev Services used intentionally.
- [ ] CI stages separated.

### 39.3 Correctness

- [ ] Error paths tested.
- [ ] Authorization denial tested.
- [ ] Validation contract tested.
- [ ] Retry/idempotency tested.
- [ ] Transaction rollback tested.
- [ ] Audit mandatory events tested.
- [ ] Cache invalidation tested.
- [ ] Job failure/retry tested.

### 39.4 Configuration

- [ ] `%test` config explicit.
- [ ] Test profiles meaningful.
- [ ] Real external services not hit.
- [ ] Schedulers disabled unless under test.
- [ ] Secrets not required from developer machine.
- [ ] Docker/Testcontainers requirement documented.

### 39.5 Maintainability

- [ ] Test names describe behavior.
- [ ] Fixtures readable.
- [ ] Assertions domain-specific.
- [ ] Mocks at boundaries.
- [ ] No over-mocking internals.
- [ ] Test failures easy to diagnose.

---

## 40. Anti-Pattern Umum

### 40.1 Everything Is `@QuarkusTest`

Slow suite and poor feedback.

### 40.2 Only Happy Path Tests

Production mostly fails on edge/failure paths.

### 40.3 Mocking the Thing You Want to Verify

Test passes without verifying real behavior.

### 40.4 Real External API in Tests

Flaky, slow, unsafe.

### 40.5 Time Sleeps

Flaky and slow.

### 40.6 No Test Isolation

Tests depend on order or shared DB state.

### 40.7 Test Profiles Explosion

Too many app restarts and hidden config.

### 40.8 No Security Negative Tests

Authorization bugs escape.

### 40.9 No Transaction Boundary Tests

Rollback/commit/outbox bugs escape.

### 40.10 Coverage Worship

High coverage but critical path untested.

### 40.11 Ignoring Continuous Testing

Feedback loop becomes CI-only.

### 40.12 Native Deployment Without Native Test

Native image failure discovered too late.

---

## 41. Latihan

### Latihan 1 — Classify Tests

Untuk fitur:

```text
Application approval with authorization, state transition, audit insert, notification outbox, and external risk check.
```

Tentukan test apa saja yang harus dibuat:

- unit,
- component,
- `@QuarkusTest`,
- DB integration,
- external API mock,
- security test,
- native test.

Jelaskan risiko yang ditangkap tiap test.

### Latihan 2 — Refactor Slow Test Suite

Kondisi:

```text
500 tests, semuanya @QuarkusTest.
CI butuh 35 menit.
Banyak flaky karena database shared.
```

Buat strategy untuk mempercepat:

- test classification,
- move domain logic to unit,
- component tests,
- profile grouping,
- DB isolation,
- Dev Services use,
- CI stages.

### Latihan 3 — Test Profile Design

Buat test profiles untuk:

1. no scheduler,
2. mocked identity provider,
3. real database Dev Services,
4. security enabled,
5. multi-tenant scenario,
6. feature flag new workflow.

Tentukan config override masing-masing.

### Latihan 4 — Failure Path Test Matrix

Untuk outbound `IdentityGateway`, buat matrix test:

- 200,
- 400,
- 401,
- 403,
- 404,
- 429,
- 500,
- timeout,
- malformed JSON,
- token refresh success,
- token refresh failure.

Untuk tiap skenario, tentukan expected exception/result dan retry behavior.

---

## 42. Ringkasan Invariants

Ingat invariants berikut:

```text
Test suite is feedback architecture.
Use the lightest test that catches the risk.
Pure domain logic should not need Quarkus startup.
Component tests fill the gap between unit and @QuarkusTest.
@QuarkusTest is powerful but should be selective.
Dev Services are excellent for integration tests, not every test.
Continuous testing is useful only if tests are fast enough.
Mock at boundaries, not everywhere.
Do not test business rules only through HTTP.
Do not hit real external services in automated tests.
Time must be controlled.
Async tests need eventual assertions, not arbitrary sleeps.
Security negative tests are mandatory.
Transaction and outbox behavior need real integration tests.
Native deployment needs native validation.
Coverage number is weaker than risk coverage.
```

---

## 43. Referensi Resmi yang Relevan

Referensi yang perlu dibaca saat implementasi nyata:

- Quarkus Testing Your Application guide.
- Quarkus Testing Components guide.
- Quarkus Continuous Testing guide.
- Quarkus Dev Services overview.
- Quarkus Dev Services for Databases.
- Quarkus Security Testing guide.
- Quarkus Test Coverage guide.
- Quarkus Dev UI guide, especially continuous testing and Dev Services visibility.
- Quarkus Native Image / integration test guide for native executable tests.

---

## 44. Kapan Seri Ini Lanjut ke Part Berikutnya

Part ini menyelesaikan testing tahap pertama: unit, component, `@QuarkusTest`, profiles, mocking, Dev Services, continuous testing, test speed, flakiness, dan test architecture.

Bagian berikutnya:

```text
Part 027 — Testing II: Integration, Contract, Security, Native Image, Performance, Chaos
```

Di part berikutnya, fokus naik ke testing yang lebih berat dan production-readiness:

- `@QuarkusIntegrationTest`,
- native image testing,
- black-box tests,
- contract testing,
- security test matrix,
- migration test,
- messaging integration,
- performance baseline,
- startup/memory tests,
- chaos/failure injection,
- release gates,
- production readiness validation.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-025.md">⬅️ Observability II: Metrics, OpenTelemetry, Tracing, Profiling, Health Checks</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-027.md">Testing II: Integration, Contract, Security, Native Image, Performance, Chaos ➡️</a>
</div>
