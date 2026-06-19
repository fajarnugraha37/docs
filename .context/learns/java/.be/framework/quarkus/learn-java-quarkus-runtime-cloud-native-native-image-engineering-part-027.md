# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-027
# Testing II: Integration, Contract, Security, Native Image, Performance, Chaos

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Part: `027`  
> Topik: Testing II: Integration, Contract, Security, Native Image, Performance, Chaos  
> Status: Materi lanjutan advance — melanjutkan Part 026  
> Target: Software engineer yang mampu mendesain validation pipeline Quarkus dari integration test sampai release gate production-readiness

---

## 0. Ringkasan Besar

Part 026 membahas test architecture sehari-hari:

- unit test,
- component test,
- `@QuarkusTest`,
- profiles,
- mocking,
- Dev Services,
- continuous testing.

Part 027 naik level ke testing yang lebih berat dan lebih dekat production:

1. **Integration test**
   - test dengan dependency nyata/semu yang realistis,
   - database,
   - Redis,
   - Kafka/RabbitMQ,
   - REST client,
   - security,
   - migrations.

2. **Contract test**
   - memastikan service tidak melanggar API/event contract,
   - consumer/provider compatibility,
   - backward compatibility.

3. **Security test**
   - authn/authz matrix,
   - tenant isolation,
   - token claims,
   - negative tests,
   - mTLS/secret/header behavior.

4. **Native image test**
   - validasi bahwa artifact native berjalan,
   - reflection/serialization/TLS/resource/class-init issues.

5. **Performance test**
   - latency,
   - throughput,
   - memory,
   - startup,
   - CPU,
   - p95/p99,
   - coordinated omission.

6. **Chaos/failure injection**
   - dependency timeout,
   - broker down,
   - DB pool exhaustion,
   - Redis down,
   - circuit breaker,
   - retry storm.

7. **Release gates**
   - menentukan bukti minimum sebelum service boleh masuk production.

Testing tahap ini bukan dijalankan untuk setiap perubahan kecil. Ini adalah lapisan validasi untuk memastikan artifact, konfigurasi, dan behavior sistem siap production.

---

## 1. Mental Model: Test Bukan Hanya Code Correctness, Tapi Artifact Confidence

Unit test menjawab:

```text
Apakah logic ini benar?
```

Integration/contract/native/performance/chaos test menjawab:

```text
Apakah artifact ini akan bertahan di lingkungan production-like?
```

Perbedaan besar:

```text
Unit/component test memvalidasi code.
Integration/native/performance/chaos test memvalidasi system behavior.
```

Contoh bug yang tidak tertangkap unit test:

- Docker image tidak punya resource file,
- native image gagal karena reflection,
- REST client salah header,
- Kafka serialization tidak compatible,
- DB migration gagal pada data lama,
- `@TestSecurity` happy path lolos tapi token real gagal,
- query benar tapi lambat pada 10 juta row,
- retry policy menyebabkan retry storm,
- readiness probe memicu pod flapping,
- Redis down membuat idempotency fail-open,
- startup native cepat tapi cache warmup menghantam DB.

Part ini membahas bagaimana menangkap risiko-risiko tersebut secara sistematis.

---

## 2. Validation Layers

Validation pipeline mature biasanya punya beberapa layer:

```text
Local fast feedback
  -> unit/component/selected @QuarkusTest

PR validation
  -> unit + component + integration core + security matrix subset

Main branch validation
  -> full integration + contract + migration tests

Nightly validation
  -> performance + native + chaos + long-running tests

Release validation
  -> artifact smoke + production-like config + security + readiness gate

Post-deploy validation
  -> smoke/synthetic checks + telemetry validation
```

Jangan memaksa semua test berat berjalan di setiap commit.

Tapi jangan juga menunda semua validation sampai production.

---

## 3. `@QuarkusIntegrationTest`: Testing Packaged Artifact

`@QuarkusTest` menjalankan aplikasi dalam test JVM dan sangat berguna untuk integration-style testing.

`@QuarkusIntegrationTest` digunakan untuk menguji aplikasi yang sudah dibangun sebagai artifact, termasuk JVM packaged app atau native executable tergantung build. Ini lebih dekat ke cara aplikasi berjalan setelah packaging.

Concept:

```java
import io.quarkus.test.junit.QuarkusIntegrationTest;

@QuarkusIntegrationTest
class ApplicationResourceIT extends ApplicationResourceTest {
}
```

Common pattern:

```text
ApplicationResourceTest      -> @QuarkusTest
ApplicationResourceIT        -> @QuarkusIntegrationTest extends same tests
```

Manfaat:

- test artifact hasil build,
- mendeteksi packaging issue,
- mendeteksi config/runtime difference,
- dapat dipakai untuk native executable test,
- lebih dekat production.

Kekurangan:

- lebih lambat,
- feedback lebih berat,
- tidak semua injection/mocking pattern sama dengan `@QuarkusTest`,
- cocok untuk release/main/nightly, bukan semua local edit.

---

## 4. Black-Box Testing

Black-box test memperlakukan service sebagai proses eksternal.

Test berinteraksi melalui:

- HTTP,
- messaging,
- database output jika perlu,
- metrics/health endpoint,
- logs,
- container status.

Tidak inject bean.

Tidak tahu internal class.

Contoh:

```text
Start packaged app
POST /applications
GET /applications/{id}
Assert HTTP response
Assert DB state
Assert outbox event
Assert audit event
```

Black-box test berguna untuk:

- packaging validation,
- container startup,
- config resolution,
- health/readiness,
- native image,
- externalized secrets,
- actual port/network behavior,
- real REST serialization.

Rule:

```text
The closer the test is to release artifact, the less it should depend on internal implementation.
```

---

## 5. Integration Test Scope

Integration test harus jelas scope-nya.

Jenis integration:

1. **Persistence integration**
   - repository + real DB.

2. **REST integration**
   - endpoint + serialization + validation + security.

3. **External HTTP integration**
   - REST client + mock server.

4. **Messaging integration**
   - producer/consumer + broker.

5. **Cache integration**
   - Redis/Infinispan behavior.

6. **Security integration**
   - OIDC/JWT/role/claim behavior.

7. **Migration integration**
   - schema migration + old data.

8. **Observability integration**
   - health/metrics/tracing/log fields.

9. **Native integration**
   - native executable behavior.

Do not create vague “big integration test” that tests everything and is impossible to debug.

---

## 6. Testcontainers and Dev Services

Quarkus Dev Services can automatically start unconfigured services in dev/test mode, usually using Testcontainers behind the scenes. It is excellent for local and test integration because it reduces manual setup.

Use Dev Services when:

```text
You want Quarkus to manage dependency startup automatically.
```

Use direct Testcontainers when:

```text
You need custom container configuration,
network topology,
seed scripts,
multiple containers,
fault injection,
or reusable test environment.
```

Examples:

- PostgreSQL container,
- Oracle XE/Free container if needed,
- Kafka/Redpanda,
- RabbitMQ,
- Redis,
- Keycloak,
- WireMock/mock HTTP service,
- OpenTelemetry collector,
- MinIO/S3 mock.

### 6.1 Dev Services Governance

Document:

```text
Which tests require Docker?
Which images are pulled?
How data is seeded?
How ports are allocated?
How CI supports containers?
How to disable Dev Services when external test infra is used?
```

Hidden container startup can confuse developers.

---

## 7. Database Integration Testing

Database integration tests should validate:

- schema mapping,
- constraints,
- indexes,
- query correctness,
- transaction behavior,
- optimistic/pessimistic locking,
- migration compatibility,
- pagination/keyset query,
- multi-tenancy,
- performance-sensitive query shape.

### 7.1 Repository Integration Test

```java
@QuarkusTest
class ApplicationRepositoryIT {

    @Inject
    ApplicationRepository repository;

    @Test
    void findNextExpired_shouldUseDeadlineAndStatus() {
        // seed pending, submitted, expired, future-deadline rows
        // execute query
        // assert only expected IDs
    }
}
```

### 7.2 Test Data Isolation

Options:

- transaction rollback,
- truncate before each test,
- schema per test,
- tenant per test,
- Testcontainers fresh DB,
- migration + seed baseline.

For large suites, choose based on speed and isolation.

### 7.3 Query Plan Awareness

For critical queries, correctness test is not enough.

Need performance guard:

```text
Does query use index?
Does pagination degrade with offset?
Does join explode rows?
Does query still work with realistic cardinality?
```

You can include targeted query plan tests or performance smoke tests for critical SQL.

---

## 8. Migration Testing

Migration tests are often missing until production fails.

Test cases:

1. **Fresh schema**
   - empty DB -> all migrations run.

2. **Upgrade schema**
   - previous release schema/data -> new migration.

3. **Rollback compatibility**
   - if rollback is supported.

4. **Large table migration**
   - estimate lock/time/redo/undo.

5. **Data correction migration**
   - verify before/after.

6. **Multi-schema/multi-tenant**
   - all schemas apply.

7. **Native image startup**
   - migration tool and native artifact compatibility if used.

### 8.1 Migration Test Flow

```text
Start DB container
Apply baseline old schema
Load representative old data
Run new migration
Start Quarkus app
Run smoke queries
Assert new schema/data state
```

### 8.2 Migration Anti-Patterns

- only testing fresh DB,
- ignoring existing data,
- destructive migration without backup path,
- long lock migration in business hours,
- assuming ORM auto schema update equals migration,
- no index creation impact test,
- no rollback/forward fix plan.

---

## 9. Contract Testing: REST APIs

Contract testing protects service boundaries.

For REST:

- path,
- method,
- headers,
- request schema,
- response schema,
- error schema,
- status codes,
- enum values,
- pagination,
- versioning,
- auth requirements.

### 9.1 Provider Contract

Provider verifies it still satisfies published API contract.

Example questions:

```text
Does POST /applications still accept required fields?
Does error response still include correlationId?
Does enum still include existing values?
Are old clients still supported?
```

### 9.2 Consumer Contract

Consumer verifies its assumptions about provider.

Example:

```text
Identity API returns status ACTIVE/INACTIVE.
If provider adds PENDING_REVIEW, consumer maps safely.
```

### 9.3 OpenAPI Is Not Enough

OpenAPI is useful, but it may not capture:

- semantic rules,
- business state transitions,
- auth matrix,
- idempotency behavior,
- retry semantics,
- error code taxonomy,
- eventual consistency.

Add examples and contract tests for behavior.

---

## 10. Contract Testing: Events and Messaging

Events are contracts too.

Event contract includes:

- event name/type,
- version,
- key,
- headers,
- payload schema,
- ordering expectations,
- partitioning key,
- idempotency key,
- required fields,
- enum evolution,
- compatibility rules.

Example event:

```json
{
  "eventType": "ApplicationSubmitted",
  "eventVersion": 1,
  "eventId": "evt-123",
  "correlationId": "corr-123",
  "aggregateType": "APPLICATION",
  "aggregateId": "APP-123",
  "occurredAt": "2026-06-20T10:00:00Z",
  "payload": {
    "applicationId": "APP-123",
    "applicationType": "SALESPERSON",
    "submittedBy": "U123"
  }
}
```

Test:

- producer emits required fields,
- consumer accepts old event version,
- consumer ignores unknown fields,
- consumer rejects invalid event,
- duplicate event is idempotent,
- missing required field goes DLQ/invalid handling.

---

## 11. Backward Compatibility Matrix

For APIs/events:

Compatibility questions:

```text
Can old client call new server?
Can new client call old server?
Can old consumer process new event?
Can new consumer process old event?
Can rolling deployment run old/new versions together?
```

Safe changes:

- add optional field,
- add enum only if consumers tolerate unknown,
- add endpoint,
- add response field,
- add event optional field.

Dangerous changes:

- remove field,
- rename field,
- change type,
- change enum without unknown handling,
- change semantics,
- make optional field required,
- change error shape,
- change idempotency behavior.

---

## 12. Security Test Matrix

Security testing should be matrix-based.

Dimensions:

```text
authentication state
role
permission
tenant
resource ownership
resource state
operation
HTTP method
token claims
service-to-service token
```

Example matrix for approving case:

| Scenario | Expected |
|---|---|
| unauthenticated | 401 |
| authenticated no role | 403 |
| officer wrong tenant | 403/404 depending policy |
| officer not assigned | 403 |
| officer assigned but case wrong state | 409/422 |
| supervisor same tenant | 200 |
| admin global | 200 or restricted by policy |
| service token without scope | 403 |
| expired token | 401 |
| malformed token | 401 |

Quarkus security testing supports `@TestSecurity` to control test identity and roles in tests. It can also disable authorization for specific tests, but do not abuse it.

---

## 13. `@TestSecurity` Example

Conceptual:

```java
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

@QuarkusTest
class CaseSecurityTest {

    @Test
    @TestSecurity(user = "officer-1", roles = {"OFFICER"})
    void approve_whenOfficerAssigned_shouldSucceed() {
        // call endpoint
    }

    @Test
    @TestSecurity(user = "officer-2", roles = {"OFFICER"})
    void approve_whenOfficerNotAssigned_shouldReturn403() {
        // call endpoint
    }
}
```

Important:

```text
@TestSecurity is useful for application-level authorization tests.
Still have integration tests with real JWT/OIDC mapping for critical auth flows.
```

Because mocked identity can hide:

- claim name mismatch,
- role mapping mismatch,
- issuer/audience issue,
- token propagation issue,
- Keycloak/client policy issue.

---

## 14. Real Token/OIDC Integration Testing

For critical OIDC/JWT flows, test with realistic tokens.

Use:

- Keycloak Dev Services,
- test realm,
- generated JWT signed by test key,
- mock OIDC server,
- real JWKS endpoint.

Test:

- issuer mismatch,
- audience mismatch,
- expired token,
- wrong role claim,
- tenant claim missing,
- group mapping,
- service token scope,
- token propagation,
- JWKS rotation/caching if relevant.

Do not rely only on `@TestSecurity` if production uses OIDC claims heavily.

---

## 15. Tenant Isolation Testing

Multi-tenant systems require explicit tests.

Test:

1. Tenant A cannot read Tenant B resource.
2. Search/list only returns own tenant.
3. Update by ID includes tenant guard.
4. Cache key includes tenant.
5. Audit event includes tenant.
6. Metrics/logs do not leak PII.
7. Background job partitions by tenant correctly.
8. Admin global role behavior explicit.
9. Message consumer handles tenant in event.
10. Migration covers all tenants/schemas.

Tenant bugs are high-severity.

Test negative paths heavily.

---

## 16. Native Image Testing

Quarkus supports building native executables and testing them. The native image guide covers compiling, packaging, and debugging native executables; the native reference guide covers diagnosis, reliability, runtime performance, native memory management, and debugging.

Native tests catch issues JVM tests cannot.

Common native issues:

- reflection not registered,
- dynamic proxy unsupported,
- serialization metadata missing,
- resources not included,
- TLS/crypto provider issue,
- locale/timezone resource issue,
- class initialization at build time vs runtime,
- unsupported dynamic classloading,
- REST client proxy behavior,
- Jackson/JSON-B reflection,
- Hibernate proxy/enhancement issue,
- logging/metrics/tracing differences.

### 16.1 Native Test Pattern

Common pattern:

```java
@QuarkusIntegrationTest
class NativeApplicationResourceIT extends ApplicationResourceTest {
}
```

Build native:

```bash
./mvnw verify -Dnative
```

Or container build depending setup:

```bash
./mvnw verify -Dnative -Dquarkus.native.container-build=true
```

Use exact command according to project setup and Quarkus version.

### 16.2 What to Test in Native

Target critical flows:

- app starts,
- health endpoints work,
- REST endpoint serialization,
- validation/error mapper,
- security/OIDC/JWT,
- DB connectivity,
- REST client TLS,
- messaging serialization,
- cache/Redis client,
- reflection-heavy code,
- template rendering if used,
- file/resource loading,
- scheduled job startup if relevant,
- observability endpoints.

Do not run huge full suite native unless necessary.

Native build is expensive.

---

## 17. Native Testing Strategy

Suggested:

```text
PR:
  maybe no native build unless code touches native-sensitive area

Main:
  native smoke test

Nightly:
  broader native integration tests

Release:
  native artifact test with production-like config
```

Native smoke test should answer:

```text
Can this artifact start and serve critical endpoint?
```

Native integration test should answer:

```text
Can critical real integrations work under native constraints?
```

---

## 18. Performance Testing: What to Measure

Quarkus performance should not be judged by marketing numbers only.

Measure for your workload:

1. Startup time.
2. Time to readiness.
3. RSS memory.
4. Heap/non-heap/native memory.
5. CPU under load.
6. Throughput.
7. p50/p95/p99/p99.9 latency.
8. Error rate.
9. GC pause/allocation rate.
10. DB pool usage.
11. HTTP client pool usage.
12. Event loop blocking.
13. Native vs JVM comparison.
14. Cold start vs warm steady-state.
15. Resource requests/limits behavior.

Quarkus performance guide discusses measurement of memory usage, startup time, native-image flags, and coordinated omission. Coordinated omission is especially important because bad load testing can hide tail latency.

---

## 19. Performance Baseline Design

Performance test should have a baseline.

For every service, define:

```text
baseline workload
baseline data size
baseline traffic profile
baseline runtime mode
baseline resource limits
baseline dependency behavior
baseline result
```

Example:

```text
Endpoint: POST /applications
Traffic: 50 RPS for 10 minutes
Data: 1M existing applications, 100k users
DB: production-like index/data distribution
Runtime: JVM Java 21, 2 vCPU, 1Gi memory
SLO: p95 < 500ms, p99 < 1500ms, error < 0.1%
```

Without baseline, performance results are just anecdotes.

---

## 20. Performance Test Types

### 20.1 Smoke Performance Test

Small quick test:

```text
Does endpoint handle basic load without obvious failure?
```

### 20.2 Load Test

Expected normal load.

```text
Can service handle expected peak?
```

### 20.3 Stress Test

Beyond expected load.

```text
Where does system break?
How does it fail?
```

### 20.4 Soak Test

Long-running.

```text
Memory leak?
Connection leak?
Cache growth?
Thread leak?
Latency drift?
```

### 20.5 Spike Test

Sudden load increase.

```text
Autoscaling?
Cold cache?
Circuit breaker?
Queue behavior?
```

### 20.6 Capacity Test

Find maximum safe throughput.

```text
What is saturation point?
```

---

## 21. Coordinated Omission

A flawed load test sends next request only after previous response returns.

If system stalls, load generator sends fewer requests, hiding real latency.

Correct performance testing must maintain request rate independently.

Measure:

- intended arrival rate,
- actual throughput,
- response latency including queuing,
- timeout/error,
- p99/p99.9.

If tool does not handle coordinated omission, interpret results carefully.

---

## 22. JVM vs Native Performance Test

Compare fairly.

Same:

- hardware,
- container limits,
- traffic,
- data,
- dependency,
- warmup rules,
- readiness criteria,
- JVM flags/native build,
- image base/security,
- measurement window.

Measure:

| Dimension | JVM | Native |
|---|---|---|
| startup time | | |
| readiness time | | |
| RSS idle | | |
| RSS under load | | |
| CPU under load | | |
| throughput | | |
| p95 latency | | |
| p99 latency | | |
| error rate | | |
| build time | | |
| debugging/profiling ease | | |

Decision:

```text
Native is a runtime trade-off, not automatic upgrade.
```

---

## 23. Startup and Readiness Testing

Quarkus/native often focuses on startup speed.

But production cares about:

```text
time to ready
```

Startup phases:

```text
process starts
Quarkus bootstrap
config loaded
connections initialized
migrations maybe run
cache warmup maybe
health ready
first real request succeeds
```

Test:

- cold start time,
- readiness endpoint timing,
- first request latency,
- startup under dependency unavailable,
- startup with slow DB,
- startup with missing secret,
- startup probe behavior.

Do not mark ready before critical initialization is complete.

Do not do huge warmup that overloads DB.

---

## 24. Chaos and Failure Injection

Chaos testing is controlled failure injection.

Goal:

```text
Validate resilience assumptions before production incident.
```

Failure scenarios:

- external API timeout,
- external API 500/503,
- external API 429,
- token endpoint down,
- Redis down,
- DB slow,
- DB connection pool exhausted,
- broker unavailable,
- message poison event,
- Kafka lag spike,
- DNS failure,
- TLS certificate error,
- pod killed during job,
- network latency,
- disk full,
- CPU throttling,
- memory pressure.

Chaos test must have:

- hypothesis,
- blast radius,
- rollback/stop mechanism,
- observability,
- expected behavior,
- pass/fail criteria.

Without this, chaos testing is just breaking things.

---

## 25. Failure Injection for REST Clients

Test:

```text
identity-api timeout -> gateway timeout -> controlled error
identity-api 503 -> retry once -> circuit if repeated
identity-api 429 -> backoff/rate limit
identity-api 401 -> refresh once
identity-api malformed JSON -> bad response error, no retry
```

Assertions:

- retry count,
- total duration bounded,
- fallback safe,
- metric emitted,
- circuit state,
- no thread/pool exhaustion,
- no duplicate side effect.

---

## 26. Failure Injection for Database

Scenarios:

- slow query,
- connection pool maxed,
- deadlock,
- constraint violation,
- transaction timeout,
- DB restart,
- migration failure,
- read-only mode,
- lock wait timeout.

Assertions:

- user-facing error controlled,
- transaction rollback correct,
- audit/outbox consistency,
- retry only safe cases,
- liveness not failed incorrectly,
- readiness behavior correct,
- pool metrics/alerts fire.

---

## 27. Failure Injection for Messaging

Scenarios:

- broker down,
- consumer exception,
- poison message,
- duplicate message,
- out-of-order message,
- delayed message,
- DLQ full,
- serialization failure,
- downstream circuit open,
- consumer lag rising.

Assertions:

- ack/nack behavior correct,
- retry bounded,
- DLQ receives poison message,
- idempotency works,
- consumer can resume,
- lag metrics/alert work,
- no infinite retry loop.

---

## 28. Failure Injection for Jobs

Scenarios:

- pod killed mid-job,
- lock expired,
- duplicate trigger,
- DB timeout during checkpoint,
- external API 429,
- item-level validation failure,
- cancellation requested,
- long-running run exceeds deadline.

Assertions:

- checkpoint safe,
- job_run status correct,
- per-item result correct,
- duplicate run safe,
- idempotency prevents duplicate side effects,
- stale lock takeover safe,
- operator can rerun.

---

## 29. Release Gates

Release gate = minimum evidence before deployment.

Example gates:

1. Unit/component tests pass.
2. Integration tests pass.
3. Security matrix pass.
4. Migration test pass.
5. Contract tests pass.
6. Native smoke pass if native deployment.
7. Performance baseline not regressed beyond threshold.
8. Observability check pass.
9. Health/readiness pass.
10. Vulnerability/SBOM scan pass.
11. Config/secrets validation pass.
12. Smoke test against staging pass.

Gate should be:

- automated where possible,
- explicit,
- owned,
- not arbitrary,
- tied to risk.

---

## 30. Production Readiness Test Matrix

For each service, create matrix:

| Area | Evidence |
|---|---|
| API contract | REST contract tests |
| Security | auth matrix |
| Persistence | migration + repository tests |
| Messaging | producer/consumer integration |
| External dependencies | mock server failure tests |
| Native | native smoke/integration |
| Performance | baseline and SLO |
| Resilience | failure injection |
| Observability | metrics/logs/traces/health |
| Deployment | container startup/probes |
| Rollback | migration/deployment rollback plan |

This becomes service certification.

---

## 31. Smoke Tests

Smoke tests are small critical checks after deploy.

Examples:

```text
GET /q/health/ready
GET /q/health/live
GET /version
POST /internal/smoke/application-validation
GET /metrics contains expected names
critical config loaded
DB reachable
```

For business smoke:

```text
Create test application in isolated tenant
Approve/reject test case
Verify audit/outbox
Clean up
```

Use safe isolated test data.

Do not run destructive smoke tests against production without controls.

---

## 32. Synthetic Monitoring

Synthetic checks run continuously from outside.

Examples:

- login flow,
- submit dummy request,
- check search,
- check dashboard,
- check external dependency path,
- check public endpoint from multiple regions.

Synthetic monitoring catches:

- DNS issues,
- TLS expiry,
- routing,
- auth integration,
- load balancer,
- WAF/proxy,
- real user path.

Different from internal health.

---

## 33. Test Environment Fidelity

Environment fidelity dimensions:

- same Java version,
- same Quarkus version,
- same container base image,
- same DB engine/version,
- similar data volume,
- same migration path,
- same secrets mechanism,
- same network policy,
- same CPU/memory limits,
- same probes,
- same observability agents,
- same timezone/locale,
- same feature flags.

Not all tests need full fidelity.

But release validation should cover critical differences.

---

## 34. Data Privacy in Tests

Never use raw production data casually.

If production-like data needed:

- anonymize,
- tokenize,
- synthesize,
- minimize,
- restrict access,
- document retention,
- avoid sensitive logs,
- clean up.

Test logs can leak data too.

Performance tests often produce large logs/metrics with payload samples. Sanitize.

---

## 35. Testing Observability and Operations

Operational readiness can be tested.

Examples:

- metrics endpoint exposes required metric,
- health readiness fails when critical DB unavailable,
- liveness stays up when DB down,
- correlation ID returned,
- logs contain event name/correlation ID,
- audit event inserted,
- trace export works in staging,
- dashboard panels receive data,
- alert rule fires in controlled test.

Do not wait for incident to learn alert is broken.

---

## 36. Security Scanning vs Security Testing

Security scanning:

- dependency vulnerability scan,
- container image scan,
- SBOM,
- secret scan,
- SAST,
- DAST.

Security testing:

- auth matrix,
- tenant isolation,
- token claims,
- CSRF if relevant,
- CORS,
- header handling,
- permission boundaries,
- business authorization.

Both needed.

A clean dependency scan does not prove authorization is correct.

---

## 37. Performance Regression Gates

Define thresholds:

```text
p95 must not regress > 20%
p99 must stay under SLO
startup time must stay under threshold
RSS must not exceed memory budget
DB query count must not increase unexpectedly
outbox processing lag under threshold
```

Use historical baseline.

Beware noise.

Performance gates should compare controlled runs, not random developer laptop results.

---

## 38. Chaos Test Safety

Chaos test checklist:

- run in non-prod first,
- define blast radius,
- define stop condition,
- notify stakeholders,
- monitor dashboards,
- have rollback,
- record results,
- create follow-up actions.

Do not run chaos tests that can corrupt data unless environment isolated.

---

## 39. Implementation Blueprint: Integration Test Suite Layout

Suggested layout:

```text
src/test/java
  ... unit/component/@QuarkusTest

src/integrationTest/java
  ... @QuarkusIntegrationTest
  ... black-box tests
  ... native smoke tests

src/contractTest/java
  ... provider/consumer contracts

src/performanceTest/java
  ... load test harness or wrappers

src/chaosTest/java
  ... failure injection tests
```

Build profiles:

```text
test
integration-test
contract-test
native-test
performance-test
chaos-test
```

Keep naming clear:

```text
*Test      fast/unit/component
*IT        integration
*NativeIT  native image
*ContractTest
*PerfTest
*ChaosTest
```

---

## 40. Implementation Blueprint: Native Smoke Test

```java
import io.quarkus.test.junit.QuarkusIntegrationTest;

@QuarkusIntegrationTest
class NativeSmokeIT extends ApplicationResourceTest {
}
```

Where `ApplicationResourceTest` tests:

- `/q/health/ready`,
- one critical endpoint,
- JSON serialization,
- error contract.

Do not duplicate huge test logic.

Reuse high-value contract tests.

---

## 41. Implementation Blueprint: Security Matrix Test

```java
@QuarkusTest
class ApplicationApprovalSecurityTest {

    @Test
    void approve_whenUnauthenticated_shouldReturn401() {
        given()
        .when()
            .post("/applications/APP-1/approve")
        .then()
            .statusCode(401);
    }

    @Test
    @TestSecurity(user = "officer-1", roles = {"OFFICER"})
    void approve_whenOfficerNotAssigned_shouldReturn403() {
        given()
        .when()
            .post("/applications/APP-1/approve")
        .then()
            .statusCode(403);
    }

    @Test
    @TestSecurity(user = "supervisor-1", roles = {"SUPERVISOR"})
    void approve_whenSupervisorSameTenant_shouldReturn200() {
        given()
        .contentType("application/json")
        .body("{\"reason\":\"verified\"}")
        .when()
            .post("/applications/APP-1/approve")
        .then()
            .statusCode(200);
    }
}
```

This is conceptual. Real test needs deterministic fixtures and tenant setup.

---

## 42. Implementation Blueprint: Failure Injection HTTP Client Test

Concept:

```text
Mock server returns:
- 503 twice,
- then 200,
or
- timeout,
or
- 429 with Retry-After.
```

Assert:

```text
retry count correct,
duration bounded,
exception mapped,
metric emitted,
fallback used if allowed.
```

Pseudo:

```java
@Test
void identityGateway_whenProvider503_shouldRetryOnceThenFailControlled() {
    mockIdentityProvider.stub503();

    assertThrows(
            ExternalUnavailableException.class,
            () -> identityGateway.loadIdentity(new ApplicantId("A-123"))
    );

    mockIdentityProvider.verifyRequestCount(2);
}
```

---

## 43. Implementation Blueprint: Migration Test

Flow:

```java
@Test
void migration_fromPreviousRelease_shouldPreserveApplicationState() {
    startDatabase();

    applySql("schema-v1.sql");
    applySql("data-v1-representative.sql");

    runFlywayMigrations();

    assertColumnExists("application", "risk_score");
    assertDataMigrated("APP-123");
    assertIndexExists("idx_application_status_deadline");

    startQuarkusApp();

    callSmokeEndpoint();
}
```

Use real migration tooling.

Do not rely only on ORM schema generation.

---

## 44. Implementation Blueprint: Performance Baseline Scenario

Example test scenario document:

```yaml
scenario: submit-application-baseline
runtime:
  mode: jvm
  java: 21
  quarkus: 3.x
resources:
  cpu: 2
  memory: 1Gi
traffic:
  duration: 10m
  warmup: 2m
  arrivalRate: 50rps
data:
  applications: 1000000
  users: 100000
slo:
  p95: 500ms
  p99: 1500ms
  errorRate: <0.1%
dependencies:
  identityApi:
    latencyP95: 100ms
    errorRate: 0.1%
measure:
  - http latency
  - CPU
  - RSS
  - DB pool
  - external call latency
  - GC
```

Performance tests should be reproducible.

---

## 45. Common Anti-Patterns

### 45.1 Only Unit Tests, No Artifact Tests

Packaging/native/container issues escape.

### 45.2 Only E2E Tests

Slow, flaky, hard to diagnose.

### 45.3 No Contract Tests

Breaking API/event changes discovered by consumers.

### 45.4 Security Happy Path Only

Authorization bypass bugs escape.

### 45.5 Native Build Without Native Test

Native artifact may start but critical flow fails.

### 45.6 Performance Test Without Baseline

Numbers cannot be interpreted.

### 45.7 Load Test With Coordinated Omission

Tail latency hidden.

### 45.8 Chaos Without Hypothesis

Random breakage, little learning.

### 45.9 Dev Services Used as Production Equivalent

Dev Services are for dev/test convenience, not production architecture.

### 45.10 Migration Only Tested on Empty DB

Production has old data.

### 45.11 No Release Gate Ownership

Gates become bureaucracy or ignored.

### 45.12 Observability Not Tested

Alerts/dashboards fail during incident.

---

## 46. Production Checklist

### 46.1 Integration

- [ ] DB integration tests.
- [ ] REST integration tests.
- [ ] external client mock server tests.
- [ ] messaging integration tests.
- [ ] cache/Redis integration tests.
- [ ] migration tests.
- [ ] observability endpoint tests.

### 46.2 Contract

- [ ] REST provider contract.
- [ ] REST consumer contract.
- [ ] event schema contract.
- [ ] backward compatibility tests.
- [ ] error contract tests.
- [ ] enum evolution tests.

### 46.3 Security

- [ ] unauthenticated tests.
- [ ] unauthorized tests.
- [ ] role matrix.
- [ ] permission matrix.
- [ ] tenant isolation.
- [ ] real token/OIDC test for critical flows.
- [ ] service-to-service scope tests.
- [ ] audit on denied/high-risk action.

### 46.4 Native

- [ ] native build.
- [ ] native smoke test.
- [ ] native REST serialization.
- [ ] native security.
- [ ] native persistence/client test.
- [ ] native observability.

### 46.5 Performance

- [ ] baseline scenario.
- [ ] startup/readiness measurement.
- [ ] memory/RSS measurement.
- [ ] p95/p99 latency.
- [ ] throughput.
- [ ] DB pool/resource metrics.
- [ ] coordinated omission avoided.

### 46.6 Resilience

- [ ] dependency timeout test.
- [ ] retry storm test.
- [ ] circuit breaker test.
- [ ] DB failure test.
- [ ] broker failure test.
- [ ] Redis failure test.
- [ ] job interruption test.
- [ ] chaos test hypothesis/results.

### 46.7 Release

- [ ] release gate documented.
- [ ] artifact smoke test.
- [ ] config validation.
- [ ] migration validation.
- [ ] rollback plan.
- [ ] dashboard/alert validation.
- [ ] synthetic check after deploy.

---

## 47. Latihan

### Latihan 1 — Build Release Gate

Untuk service:

```text
Application Management Service
```

Buat release gate yang mencakup:

- unit/component,
- integration,
- contract,
- security,
- migration,
- native,
- performance,
- observability,
- smoke,
- rollback.

Tentukan mana yang wajib PR, mana main branch, mana nightly, mana release.

### Latihan 2 — Security Matrix

Untuk operasi:

```text
POST /cases/{id}/escalate
```

Buat security test matrix berdasarkan:

- unauthenticated,
- officer,
- supervisor,
- admin,
- wrong tenant,
- unassigned officer,
- wrong state,
- service token,
- expired token.

### Latihan 3 — Native Risk Review

Daftar library/fitur di service:

- Jackson polymorphism,
- Hibernate ORM,
- REST client TLS,
- Keycloak/OIDC,
- PDF generation,
- template engine,
- Redis,
- Kafka,
- reflection-based mapper.

Tentukan native risk dan test yang dibutuhkan.

### Latihan 4 — Chaos Hypothesis

Buat chaos test untuk:

```text
Identity API latency naik menjadi 5 detik selama 10 menit.
```

Tentukan:

- hypothesis,
- expected behavior,
- metrics,
- alert,
- pass/fail,
- rollback.

### Latihan 5 — Migration Test

Design migration test untuk:

```text
Add new NOT NULL column application.priority with default and index.
Existing table has 50M rows.
```

Tentukan:

- safe migration steps,
- test data,
- performance risk,
- lock risk,
- rollback/forward fix.

---

## 48. Ringkasan Invariants

Ingat invariants berikut:

```text
Unit tests validate logic.
Integration tests validate wiring and dependency behavior.
Black-box tests validate packaged artifact behavior.
Contract tests protect service boundaries.
Security tests must include negative cases.
Tenant isolation must be tested explicitly.
Native image must be tested as native artifact.
Performance tests need baseline and controlled environment.
Avoid coordinated omission in load testing.
Chaos tests need hypothesis and blast-radius control.
Migrations must be tested against old data, not only empty DB.
Dev Services are test convenience, not production equivalence.
Release gates must produce evidence, not bureaucracy.
Production readiness is a testable property.
```

---

## 49. Referensi Resmi yang Relevan

Referensi yang perlu dibaca saat implementasi nyata:

- Quarkus Testing Your Application guide.
- Quarkus `@QuarkusIntegrationTest` and native executable testing sections.
- Quarkus Building a Native Executable guide.
- Quarkus Native Reference guide.
- Quarkus Security Testing guide.
- Quarkus Dev Services overview.
- Quarkus Continuous Testing guide.
- Quarkus Measuring Performance guide.
- Quarkus Observability, Micrometer, OpenTelemetry, and SmallRye Health guides.
- Testcontainers guide for Quarkus integration testing.

---

## 50. Kapan Seri Ini Lanjut ke Part Berikutnya

Part ini menyelesaikan testing tahap kedua: integration, contract, security, native image, performance, chaos, dan release gates.

Bagian berikutnya:

```text
Part 028 — Native Image I: GraalVM/Mandrel Mental Model, Closed-World Assumption, Static Init
```

Di part berikutnya, fokus bergeser ke native image secara mendalam:

- GraalVM vs Mandrel,
- AOT compilation,
- closed-world assumption,
- reflection constraints,
- resource inclusion,
- serialization,
- dynamic proxy,
- static init vs runtime init,
- class initialization trap,
- Quarkus build-time metadata,
- startup vs throughput trade-off,
- native memory model,
- native failure diagnosis.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-026.md">⬅️ Testing I: Unit, Component, QuarkusTest, Profiles, Mocking, Continuous Testing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-028.md">Native Image I: GraalVM/Mandrel Mental Model, Closed-World Assumption, Static Init ➡️</a>
</div>
