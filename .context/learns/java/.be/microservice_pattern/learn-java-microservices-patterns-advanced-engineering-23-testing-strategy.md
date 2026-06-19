# learn-java-microservices-patterns-advanced-engineering-23-testing-strategy

> Part 23 of 35 — Testing Strategy for Microservices  
> Series: `learn-java-microservices-patterns-advanced-engineering`  
> Scope: Java 8–25, advanced microservices architecture, production readiness, reliability, correctness, and evolution

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

1. distributed systems reality,
2. service boundary,
3. domain modeling,
4. architecture styles,
5. synchronous API,
6. asynchronous messaging,
7. event-driven architecture,
8. saga dan compensation,
9. outbox/inbox/CDC,
10. consistency dan distributed invariant,
11. data ownership,
12. query pattern,
13. API Gateway/BFF,
14. service discovery/configuration,
15. resilience,
16. backpressure,
17. idempotency,
18. workflow/process manager,
19. state machine,
20. service-to-service security,
21. multi-tenancy,
22. observability.

Part ini menjawab pertanyaan praktis:

> Kalau microservices penuh dengan network failure, schema drift, duplicate message, eventual consistency, independent deployment, tenant isolation, security boundary, dan runtime topology dinamis, bagaimana strategi testing yang benar?

Testing microservices bukan sekadar menambah jumlah test. Testing microservices adalah proses membangun **confidence** bahwa sistem tetap benar ketika komponen berubah secara independen, dependency lambat/gagal, message datang dua kali, schema berubah, service berbeda versi, dan runtime tidak selalu stabil.

---

## 1. Core Thesis

Testing microservices tidak boleh dilihat sebagai:

```text
unit test + integration test + E2E test
```

Itu terlalu dangkal.

Testing microservices harus dilihat sebagai:

```text
confidence architecture
```

Artinya, testing adalah sistem untuk menjawab:

1. Apakah logic lokal service benar?
2. Apakah contract antar service masih kompatibel?
3. Apakah service bisa berjalan dengan dependency nyata?
4. Apakah data ownership tidak dilanggar?
5. Apakah event schema masih kompatibel?
6. Apakah duplicate/retry/replay aman?
7. Apakah saga/workflow tetap converge saat partial failure?
8. Apakah deployment versi baru aman dengan versi lama?
9. Apakah sistem bisa diamati saat gagal?
10. Apakah reliability target masih masuk akal?

Engineer biasa menulis test untuk membuktikan kode bekerja.

Engineer senior menulis test untuk mencegah regresi.

Engineer top-tier mendesain testing strategy untuk mengurangi **unknown unknowns** dalam sistem yang berubah terus.

---

## 2. Mengapa Testing Microservices Lebih Sulit

Dalam monolith, banyak dependency masih berada dalam satu process:

```text
Controller -> Service -> Repository -> Database
```

Call bisa bersifat local, transaction bisa lokal, type model bisa langsung dikompilasi, refactor lebih mudah terdeteksi compile-time.

Dalam microservices:

```text
Service A -> HTTP -> Service B -> DB B
Service A -> Kafka -> Service C -> DB C
Service D -> Projection -> Search Index
Service E -> Workflow Engine -> External System
```

Masalah baru muncul:

1. service bisa deploy beda versi,
2. API schema bisa berubah,
3. event consumer bisa tertinggal,
4. network bisa timeout,
5. request bisa retry,
6. message bisa duplicate,
7. ordering tidak selalu dijamin,
8. read model bisa stale,
9. E2E environment sulit stabil,
10. ownership lintas tim memperlambat feedback.

Karena itu, testing microservices bukan hanya testing logic. Ia mencakup testing **interaction**, **compatibility**, **failure behavior**, dan **evolution safety**.

---

## 3. Testing Pyramid Masih Berguna, Tapi Tidak Cukup

Testing pyramid klasik berguna sebagai prinsip umum:

```text
      E2E tests
    Integration tests
  Unit tests
```

Maksudnya:

- unit test banyak dan cepat,
- integration test lebih sedikit,
- E2E test paling sedikit karena mahal, lambat, dan fragile.

Tetapi microservices menambah dimensi lain:

1. contract compatibility,
2. consumer/provider compatibility,
3. event schema compatibility,
4. deployment compatibility,
5. replay safety,
6. resilience behavior,
7. data migration safety,
8. observability readiness.

Jadi untuk microservices, model yang lebih tepat adalah **testing portfolio**.

---

## 4. Testing Portfolio untuk Microservices

Bayangkan testing microservices sebagai beberapa lapisan confidence:

```text
┌──────────────────────────────────────────────┐
│ Production verification / synthetic / canary  │
├──────────────────────────────────────────────┤
│ Chaos / resilience / fault injection          │
├──────────────────────────────────────────────┤
│ End-to-end journey tests                      │
├──────────────────────────────────────────────┤
│ Cross-service integration tests               │
├──────────────────────────────────────────────┤
│ Contract tests: API + event + schema          │
├──────────────────────────────────────────────┤
│ Component tests with real dependencies        │
├──────────────────────────────────────────────┤
│ Slice tests                                   │
├──────────────────────────────────────────────┤
│ Unit tests: domain/application logic          │
└──────────────────────────────────────────────┘
```

Masing-masing lapisan punya tujuan berbeda.

Salah besar kalau semua masalah dipaksa diselesaikan oleh E2E test.

---

## 5. Golden Rule: Test at the Lowest Layer That Can Prove the Risk

Prinsip utama:

> Jangan mengetes sesuatu di layer mahal jika bisa dibuktikan di layer lebih murah.

Contoh:

| Risiko | Layer test yang tepat |
|---|---|
| business rule salah | unit/domain test |
| mapping JSON salah | slice/component test |
| SQL query salah | repository integration test |
| API provider menghapus field | contract test |
| event schema breaking | schema compatibility test |
| duplicate message membuat double approval | idempotency/component test |
| saga gagal converge saat payment timeout | workflow/saga fault test |
| semua service bisa jalan bersama | smoke/E2E test |
| dependency lambat menyebabkan cascading failure | resilience/chaos test |

E2E test hanya boleh menjadi bukti untuk risiko yang memang membutuhkan keseluruhan journey.

---

## 6. Unit Test dalam Microservices

Unit test tetap penting.

Tetapi unit test yang berguna untuk microservices bukan unit test yang hanya menguji getter/setter, mapper trivial, atau controller forwarding.

Unit test paling berharga adalah untuk:

1. domain invariant,
2. state transition,
3. policy decision,
4. idempotency decision,
5. compensation decision,
6. retry classification,
7. permission decision,
8. tenant isolation rule,
9. validation rule,
10. error classification.

Contoh domain test:

```java
class ApplicationStateMachineTest {

    @Test
    void submittedApplicationCanBeAssignedForReview() {
        Application application = Application.submitted("APP-001");

        TransitionResult result = application.apply(
            new AssignReviewer("officer-123"),
            Actor.system("case-router")
        );

        assertEquals(ApplicationState.UNDER_REVIEW, application.state());
        assertTrue(result.events().contains(new ReviewerAssigned("APP-001", "officer-123")));
    }

    @Test
    void approvedApplicationCannotBeResubmitted() {
        Application application = Application.approved("APP-001");

        assertThrows(InvalidTransitionException.class, () ->
            application.apply(new SubmitApplication(), Actor.user("applicant-1"))
        );
    }
}
```

Yang diuji bukan framework.

Yang diuji adalah business correctness.

---

## 7. Unit Test Smell

Unit test smell:

1. semua test mock repository, broker, security, clock, dan mapper sampai test tidak membuktikan apa pun,
2. test hanya mengejar coverage,
3. test terlalu tergantung implementation detail,
4. test gagal setiap refactor sehat,
5. test tidak punya domain vocabulary,
6. test tidak menguji edge case failure,
7. test hanya happy path,
8. test tidak menguji concurrency/idempotency.

Contoh test lemah:

```java
verify(repository).save(any());
```

Itu hanya membuktikan method dipanggil, bukan bahwa state bisnis benar.

Lebih baik:

```java
assertEquals(ApplicationState.APPROVED, saved.state());
assertEquals("APPROVED_BY_SUPERVISOR", saved.lastTransitionCode());
assertEquals(policyVersion, saved.policyVersion());
```

---

## 8. Slice Test

Slice test menguji satu potongan framework/runtime tanpa menjalankan seluruh application.

Contoh:

1. controller/API serialization test,
2. repository/JPA/JDBC test,
3. JSON mapping test,
4. security filter test,
5. message listener deserialization test,
6. validation test.

Tujuannya:

```text
Membuktikan integrasi kecil antara code dan framework benar.
```

Contoh risiko yang cocok untuk slice test:

1. request JSON field salah map,
2. enum value tidak diterima,
3. validation annotation tidak aktif,
4. repository query salah,
5. custom converter salah,
6. security annotation tidak bekerja,
7. message payload gagal deserialize.

---

## 9. Component Test

Component test menjalankan satu service sebagai black-box/gray-box dengan dependency eksternal diganti test double atau container nyata.

Bentuknya:

```text
Service under test + DB container + broker container + fake external service
```

Component test lebih kuat dari unit test karena service dijalankan mendekati real runtime.

Contoh:

```text
Application Service
  -> PostgreSQL/Testcontainers
  -> Kafka/Testcontainers
  -> WireMock external profile service
```

Tujuan component test:

1. membuktikan service bootstraps dengan config benar,
2. endpoint menerima/menolak payload sesuai contract,
3. database migration valid,
4. transaction bekerja,
5. outbox record ditulis,
6. message listener idempotent,
7. error handling benar,
8. security filter aktif,
9. observability metadata muncul.

---

## 10. Testcontainers dan Real Dependency Testing

Untuk Java, Testcontainers sangat berguna karena memungkinkan test memakai dependency nyata dalam container:

1. PostgreSQL,
2. MySQL,
3. Oracle-compatible alternatives jika tersedia,
4. Kafka,
5. RabbitMQ,
6. Redis,
7. LocalStack,
8. Elasticsearch/OpenSearch,
9. WireMock,
10. browser/Selenium.

Contoh konsep:

```java
@Testcontainers
class ApplicationRepositoryIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
        .withDatabaseName("app_test")
        .withUsername("test")
        .withPassword("test");

    @Test
    void savesApplicationWithOptimisticVersion() {
        // run migration
        // create repository
        // save aggregate
        // assert actual DB state
    }
}
```

Nilai utamanya:

```text
Test memakai behavior dependency nyata, bukan fake yang terlalu optimistis.
```

Tetapi jangan semua test memakai container. Container test lebih lambat. Gunakan untuk risiko integrasi yang nyata.

---

## 11. Contract Test

Contract test adalah pilar microservices testing.

Kenapa?

Karena microservices berubah secara independen.

Provider mungkin berpikir perubahan API aman, tetapi consumer tertentu bisa rusak.

Contract test membuktikan:

```text
Provider masih memenuhi ekspektasi consumer.
```

Ada dua pendekatan besar:

1. provider contract test,
2. consumer-driven contract test.

---

## 12. Provider Contract Test

Provider contract test berasal dari sisi provider.

Contoh:

```text
Application Service menyediakan OpenAPI spec.
Test memastikan implementation cocok dengan OpenAPI spec.
```

Kelebihan:

1. menjaga provider konsisten dengan spec,
2. cocok untuk public API,
3. cocok untuk governance,
4. mudah dipahami.

Kelemahan:

1. belum tentu mencerminkan field/behavior yang benar-benar dipakai consumer,
2. spec bisa terlalu luas,
3. consumer-specific assumption bisa tidak tertangkap.

---

## 13. Consumer-Driven Contract Test

Consumer-driven contract test berasal dari ekspektasi consumer.

Alurnya:

```text
Consumer test -> menghasilkan contract -> provider verify contract
```

Contoh:

```text
Worklist BFF expects Application Service:
GET /applications/APP-001
returns:
{
  "id": "APP-001",
  "status": "UNDER_REVIEW",
  "assignedOfficerId": "OFF-123"
}
```

Provider verify bahwa endpoint masih bisa memenuhi contract ini.

Kelebihan:

1. test hanya behavior yang dipakai consumer,
2. breaking change terdeteksi lebih awal,
3. mendukung independent deployment,
4. mengurangi E2E dependency.

Kelemahan:

1. butuh disiplin publishing contract,
2. contract sprawl jika governance buruk,
3. tidak menggantikan semantic/domain testing,
4. tidak otomatis membuktikan workflow end-to-end.

---

## 14. API Contract Scope

Contract API tidak boleh hanya mengecek status code.

Contract minimal harus mencakup:

1. method,
2. path,
3. query parameter,
4. request headers penting,
5. request body shape,
6. response status,
7. response body shape,
8. content type,
9. required/optional fields,
10. enum values,
11. error response,
12. auth context expectation,
13. idempotency header jika ada,
14. correlation header jika required.

Contoh contract concern:

```yaml
GET /cases/{caseId}
Required headers:
  Authorization: Bearer <token>
  X-Correlation-Id: <uuid>
Responses:
  200:
    id: string
    status: string
    assignedOfficerId: string | null
  404:
    error.code: CASE_NOT_FOUND
  403:
    error.code: ACCESS_DENIED
```

---

## 15. Event Contract Test

Event contract lebih sulit daripada API contract karena event biasanya long-lived.

Consumer bisa membaca event lama saat replay.

Event contract harus mencakup:

1. event name,
2. event version,
3. envelope fields,
4. payload schema,
5. required/optional field,
6. enum compatibility,
7. semantic meaning,
8. ordering assumption,
9. partition key,
10. idempotency key,
11. causation/correlation metadata,
12. retention/replay expectation.

Contoh event:

```json
{
  "eventId": "evt-001",
  "eventType": "ApplicationApproved",
  "eventVersion": 2,
  "occurredAt": "2026-06-19T10:15:30Z",
  "publishedAt": "2026-06-19T10:15:31Z",
  "aggregateId": "APP-001",
  "aggregateType": "Application",
  "tenantId": "CEA",
  "correlationId": "corr-123",
  "causationId": "cmd-456",
  "payload": {
    "applicationId": "APP-001",
    "approvedBy": "OFF-123",
    "approvalLevel": "SUPERVISOR"
  }
}
```

Event contract test harus memastikan consumer tidak rusak jika field baru ditambah, tetapi akan mendeteksi jika required field dihapus atau meaning berubah.

---

## 16. Schema Compatibility Test

Schema compatibility test menjawab:

> Apakah schema versi baru kompatibel dengan consumer/prod data versi lama?

Untuk JSON event/API:

1. field baru optional aman,
2. field required baru tidak aman untuk old producer,
3. field removal biasanya breaking,
4. enum value baru bisa breaking untuk strict consumer,
5. type change breaking,
6. semantic change lebih bahaya daripada structural change.

Untuk Avro/Protobuf/JSON Schema, compatibility bisa lebih formal.

Tetapi untuk JSON biasa pun, rules harus eksplisit.

Contoh compatibility rule:

```text
Backward compatible:
- add optional field
- add nullable field with default
- widen string description without changing semantic

Breaking:
- remove field consumed by known consumer
- rename field
- change type
- change enum meaning
- make optional field required
- change timestamp unit/zone
```

---

## 17. Integration Test

Integration test menguji integrasi beberapa komponen nyata.

Contoh:

```text
Application Service + PostgreSQL + Kafka + Outbox Publisher
```

Atau:

```text
Case Service + Redis + external fake identity provider
```

Integration test harus dipakai untuk membuktikan:

1. transaction boundary benar,
2. SQL/migration benar,
3. broker publish/consume benar,
4. serialization/deserialization benar,
5. auth/security integration benar,
6. cache behavior benar,
7. retry/backoff integration benar,
8. outbox relay bekerja,
9. inbox dedup bekerja.

Integration test tidak perlu menjalankan seluruh estate microservices.

---

## 18. Cross-Service Integration Test

Cross-service integration test menjalankan dua atau beberapa service nyata bersama.

Contoh:

```text
Application Service -> Profile Service
```

Atau:

```text
Application Service -> Kafka -> Notification Service
```

Gunakan hanya untuk interaction penting yang tidak cukup dibuktikan dengan contract test.

Contoh risiko:

1. auth token relay antar service,
2. actual TLS/mTLS config,
3. actual queue/topic routing,
4. actual projection update,
5. actual BFF composition,
6. actual fallback behavior.

Jangan jadikan cross-service test sebagai mini-E2E untuk semua skenario.

---

## 19. End-to-End Test

E2E test menguji journey penuh dari perspektif user/system.

Contoh:

```text
Applicant submits application
Officer reviews application
Supervisor approves application
Notification sent
Worklist updated
Audit trail visible
```

E2E test berguna untuk:

1. critical user journey,
2. smoke test release,
3. integration of deployment environment,
4. security/session flow,
5. cross-service journey validation,
6. synthetic monitoring.

Tetapi E2E test mahal:

1. lambat,
2. flaky,
3. sulit debug,
4. butuh environment stabil,
5. membutuhkan data setup kompleks,
6. sering menjadi bottleneck release,
7. sering membuat tim saling tunggu.

Top-tier strategy:

```text
Sedikit E2E test, tetapi sangat meaningful.
```

---

## 20. E2E Test Smell

E2E test smell:

1. jumlahnya ratusan/ribuan,
2. setiap PR harus menunggu full E2E lama,
3. gagal random karena environment shared,
4. test data saling tabrak,
5. debug membutuhkan banyak tim,
6. E2E dipakai untuk validasi field kecil,
7. E2E menggantikan contract test,
8. E2E menggantikan domain test,
9. E2E menjadi satu-satunya gate release,
10. tim takut deploy karena test suite tidak dipercaya.

E2E test yang tidak dipercaya adalah noise.

---

## 21. Smoke Test

Smoke test adalah test cepat untuk membuktikan deployment tidak rusak total.

Contoh smoke test:

1. service health endpoint up,
2. DB connection valid,
3. migration applied,
4. auth flow basic works,
5. critical endpoint returns expected status,
6. message consumer connected,
7. outbox publisher alive,
8. BFF can call backend,
9. basic user journey works.

Smoke test bukan comprehensive correctness test.

Tujuannya:

```text
Apakah release ini layak masuk observasi lebih lanjut?
```

---

## 22. Synthetic Test

Synthetic test berjalan berkala di environment tertentu, bahkan production, untuk mensimulasikan journey penting.

Contoh:

```text
Every 5 minutes:
- login synthetic user
- open dashboard
- call read-only endpoint
- verify response time under SLO
```

Atau untuk non-prod:

```text
Every 15 minutes:
- create synthetic application
- submit
- verify worklist projection updated
- verify notification mock received
```

Synthetic test berguna untuk:

1. mendeteksi outage lebih cepat,
2. memvalidasi dependency chain,
3. mengukur real latency,
4. menguji environment drift,
5. mendukung SLO monitoring.

Hati-hati:

1. jangan mencemari production data,
2. gunakan synthetic tenant/user,
3. tandai data sebagai synthetic,
4. pastikan cleanup,
5. pastikan authorization aman.

---

## 23. Canary Verification

Canary bukan hanya deployment strategy. Canary butuh verification.

Canary test menjawab:

```text
Apakah versi baru lebih buruk dari versi lama pada traffic nyata/sebagian?
```

Signal canary:

1. error rate,
2. latency p95/p99,
3. saturation,
4. dependency timeout,
5. business metric,
6. fallback rate,
7. circuit open rate,
8. dead-letter rate,
9. unexpected exception,
10. audit failure.

Canary tanpa observability adalah gambling.

---

## 24. Replay Test

Replay test penting untuk event-driven systems.

Replay test menjawab:

> Kalau event lama diputar ulang, apakah consumer tetap aman?

Replay test harus menguji:

1. duplicate event,
2. out-of-order event,
3. old schema version,
4. missing optional field,
5. unknown enum value,
6. projection rebuild,
7. idempotent update,
8. side effect suppression saat replay,
9. poison event behavior.

Rule penting:

```text
Handler yang menghasilkan external side effect harus membedakan live processing dan replay processing.
```

Contoh:

```java
void handle(ApplicationApproved event, ProcessingMode mode) {
    projection.apply(event);

    if (mode == ProcessingMode.LIVE) {
        notificationOutbox.enqueue(...);
    }
}
```

---

## 25. Migration Test

Microservices sering gagal bukan karena business code, tetapi karena migration.

Migration test harus mencakup:

1. schema migration forward,
2. schema migration backward compatibility,
3. expand-contract migration,
4. data backfill,
5. partial migration,
6. old app version with new schema,
7. new app version with old-compatible data,
8. rollback/roll-forward,
9. large table performance,
10. lock impact,
11. index creation impact.

Contoh expand-contract:

```text
Step 1: add nullable new column
Step 2: deploy app writing both old and new
Step 3: backfill old rows
Step 4: deploy app reading new column
Step 5: stop writing old column
Step 6: drop old column later
```

Test harus membuktikan setiap step aman.

---

## 26. Backward Compatibility Test

Dalam microservices, versi tidak berubah serentak.

Compatibility matrix:

```text
Consumer v1 + Provider v1
Consumer v1 + Provider v2
Consumer v2 + Provider v1
Consumer v2 + Provider v2
```

Tidak semua kombinasi harus diuji full E2E, tetapi compatibility rule harus jelas.

Contoh:

| Kombinasi | Harus aman? | Kenapa |
|---|---:|---|
| old consumer + new provider | Ya | rolling deploy provider |
| new consumer + old provider | Kadang | rolling deploy consumer lebih dulu |
| old producer + new consumer | Ya | event lama masih diproses |
| new producer + old consumer | Ya jika additive | consumer lama harus tolerant |

---

## 27. Performance Regression Test

Performance test bukan hanya load test sebelum go-live.

Untuk microservices, performance regression harus mendeteksi:

1. latency p95/p99 naik,
2. database query melambat,
3. connection pool saturation,
4. thread pool saturation,
5. virtual thread pinning/blocking issue,
6. GC regression,
7. serialization overhead,
8. fan-out latency,
9. consumer lag,
10. cache hit ratio drop,
11. projection rebuild terlalu lambat.

Performance regression test bisa dibagi:

1. microbenchmark untuk algorithm hot path,
2. component performance test,
3. service load test,
4. workflow load test,
5. soak test,
6. capacity test.

Jangan mencampur semuanya menjadi satu test besar.

---

## 28. Resilience Test

Resilience test membuktikan service tetap terkendali saat dependency bermasalah.

Fault yang perlu diuji:

1. dependency timeout,
2. dependency returns 500,
3. dependency returns 429,
4. dependency slow response,
5. network connection refused,
6. broker unavailable,
7. DB connection exhausted,
8. Redis down,
9. message duplicate,
10. message out-of-order,
11. DLQ spike,
12. partial deployment failure.

Expected behavior:

1. timeout bounded,
2. retry limited,
3. circuit breaker opens,
4. fallback correct,
5. queue bounded,
6. no thread exhaustion,
7. useful logs/traces emitted,
8. error response meaningful,
9. metric/alert triggered,
10. no duplicate side effect.

---

## 29. Chaos Test

Chaos testing bukan “merusak random production”.

Chaos test adalah controlled experiment:

```text
Hypothesis:
If Profile Service is slow for 30 seconds,
Application Submission should still accept draft save,
but should degrade profile enrichment and emit warning metric.
```

Struktur chaos experiment:

1. define steady state,
2. define hypothesis,
3. inject controlled fault,
4. observe behavior,
5. limit blast radius,
6. stop experiment if safety threshold breached,
7. record learning,
8. improve architecture/test/runbook.

Contoh fault:

1. latency injection,
2. error injection,
3. pod kill,
4. network partition,
5. CPU throttling,
6. memory pressure,
7. broker disconnect,
8. DB failover,
9. DNS failure,
10. clock skew.

Chaos testing harus dimulai di dev/staging, lalu production hanya jika organisasi sudah matang.

---

## 30. Security Test

Microservices security testing harus mencakup:

1. authentication required,
2. authorization per resource,
3. object-level authorization,
4. tenant isolation,
5. token audience validation,
6. token expiry,
7. token replay,
8. scope/permission mapping,
9. service-to-service authentication,
10. mTLS/certificate validation,
11. secret leakage,
12. header spoofing,
13. confused deputy,
14. audit identity correctness,
15. support/admin access control.

Contoh security test penting:

```text
User from tenant A cannot access case from tenant B even if case ID is guessed.
```

Ini jauh lebih penting daripada sekadar mengecek endpoint butuh login.

---

## 31. Multi-Tenant Test

Multi-tenancy butuh testing khusus.

Test harus membuktikan:

1. tenant context wajib ada,
2. tenant context tidak bisa dipalsukan dari header publik,
3. query selalu tenant-scoped,
4. cache key mengandung tenant,
5. event mengandung tenant,
6. projection tenant-aware,
7. audit tenant-aware,
8. metrics tenant-cardinality terkendali,
9. admin cross-tenant action tercatat,
10. tenant offboarding menghapus/retensi data sesuai policy.

Test negatif wajib:

```text
Given data tenant A and B
When user A requests entity B
Then response is 404 or 403 according to policy
And no data from B appears in logs/metrics/cache
```

---

## 32. Observability Test

Observability juga harus dites.

Karena saat incident, observability yang salah sama bahayanya dengan tidak ada observability.

Test observability:

1. correlation ID propagated,
2. traceparent propagated,
3. message metadata propagated,
4. error logs structured,
5. sensitive data tidak masuk log,
6. business metric emitted,
7. circuit breaker metric emitted,
8. DLQ metric emitted,
9. audit event created,
10. dashboard query bisa menemukan transaction.

Contoh:

```text
When ApplicationApproved event is processed
Then logs contain applicationId, eventId, correlationId, tenantId
And do not contain applicant NRIC/passport/email if policy prohibits
```

---

## 33. Test Data Strategy

Test data adalah salah satu sumber utama flakiness.

Strategi buruk:

1. semua test pakai shared static user,
2. environment shared dan saling overwrite,
3. cleanup tidak konsisten,
4. test bergantung order,
5. data manual dibuat QA,
6. production-like data tidak anonymized,
7. ID hardcoded bertabrakan.

Strategi baik:

1. setiap test membuat data sendiri,
2. ID unik per test,
3. tenant synthetic,
4. deterministic clock,
5. isolated schema/container untuk test tertentu,
6. cleanup otomatis,
7. fixture minimal,
8. builder pattern untuk domain data,
9. anonymized realistic data untuk performance/security testing,
10. test data ownership jelas.

Contoh builder:

```java
ApplicationFixture.submitted()
    .tenant("CEA")
    .applicant("applicant-001")
    .withQualification("RES")
    .build();
```

---

## 34. Test Environment Strategy

Microservices butuh environment strategy.

Jenis environment:

1. local developer environment,
2. ephemeral PR environment,
3. integration environment,
4. staging/pre-prod,
5. performance environment,
6. security testing environment,
7. production synthetic/canary.

Tidak semua test harus jalan di semua environment.

Contoh mapping:

| Test type | Local | CI | PR env | Staging | Prod |
|---|---:|---:|---:|---:|---:|
| unit | yes | yes | no | no | no |
| slice | yes | yes | no | no | no |
| component | yes | yes | optional | no | no |
| contract | yes | yes | optional | no | no |
| integration | optional | yes | yes | yes | no |
| E2E smoke | no | optional | yes | yes | yes synthetic |
| chaos | no | optional | optional | yes | limited mature only |
| performance | no | scheduled | no | yes | observe only |

---

## 35. Ephemeral Environment

Ephemeral environment adalah environment sementara untuk branch/PR tertentu.

Kelebihan:

1. isolasi lebih baik,
2. mengurangi tabrakan test data,
3. QA bisa test perubahan tertentu,
4. compatibility bisa diuji lebih awal,
5. environment bisa dihancurkan setelah selesai.

Kelemahan:

1. mahal,
2. provisioning kompleks,
3. butuh data seeding,
4. butuh routing/preview URL,
5. dependency eksternal mungkin sulit disimulasikan.

Prinsip:

```text
Ephemeral environment bagus untuk confidence, tetapi jangan menjadikannya alasan mengabaikan unit/contract/component test.
```

---

## 36. Mock, Stub, Fake, Simulator, and Emulator

Istilah sering dicampur.

| Jenis | Makna |
|---|---|
| Dummy | objek pengisi, tidak dipakai |
| Stub | memberi response predefined |
| Mock | memverifikasi interaction |
| Fake | implementasi sederhana tapi bekerja |
| Simulator | meniru behavior dependency tertentu |
| Emulator | meniru platform/protocol lebih lengkap |

Dalam microservices, mock berlebihan berbahaya.

Mock dependency remote boleh untuk unit test application service, tetapi contract/component test harus memakai stub/simulator yang lebih realistis.

Contoh:

```text
External government API unavailable -> simulator returns 503 and slow response.
```

Bukan hanya:

```java
when(client.call()).thenReturn(success);
```

---

## 37. Testing Asynchronous Systems

Async system sulit dites karena tidak langsung selesai.

Masalah:

1. timing tidak deterministik,
2. message delivery delay,
3. duplicate,
4. ordering,
5. retry,
6. DLQ,
7. eventual consistency.

Hindari `Thread.sleep(5000)` sebagai strategy utama.

Lebih baik:

1. polling with timeout,
2. awaitility-style assertion,
3. deterministic clock,
4. controlled executor,
5. test broker/container,
6. inspect DB/projection state,
7. assert outbox/inbox records,
8. assert emitted events.

Contoh:

```java
await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
    WorklistItem item = worklistRepository.findByApplicationId("APP-001");
    assertEquals("UNDER_REVIEW", item.status());
});
```

Test async harus membuktikan convergence, bukan timing exact.

---

## 38. Testing Idempotency

Idempotency test wajib untuk API command dan message consumer.

Skenario:

1. same request sent twice,
2. same idempotency key different payload,
3. retry after timeout,
4. duplicate event,
5. duplicate message after consumer crash,
6. concurrent duplicate request,
7. replay event,
8. idempotency record expired.

Contoh:

```text
Given SubmitApplication command with idempotency key K
When command is sent twice concurrently
Then only one Application is created
And both responses reference same application id
And only one ApplicationSubmitted event is published
```

Ini correctness test, bukan performance test.

---

## 39. Testing Saga and Workflow

Saga/workflow test harus menguji path sukses dan failure path.

Skenario wajib:

1. all steps succeed,
2. step 1 succeeds, step 2 fails retryably,
3. step 2 timeout unknown outcome,
4. compensation succeeds,
5. compensation fails,
6. duplicate event after compensation,
7. orchestrator crash and recovery,
8. old workflow version still completes,
9. human task overdue,
10. escalation triggered,
11. external system unavailable,
12. partial completion reconciled.

Test harus melihat state machine workflow:

```text
STARTED -> PROFILE_VERIFIED -> PAYMENT_RESERVED -> FAILED_COMPENSATING -> COMPENSATED
```

Bukan hanya endpoint response.

---

## 40. Testing State Machine

State machine test harus exhaustive secara transisi penting.

Test matrix:

| Current State | Command/Event | Actor | Expected |
|---|---|---|---|
| DRAFT | Submit | Applicant | SUBMITTED |
| SUBMITTED | Assign | Officer | UNDER_REVIEW |
| APPROVED | Submit | Applicant | rejected |
| REJECTED | Appeal | Applicant | APPEALED |
| CLOSED | Appeal | Applicant | rejected |

Tambahkan dimensi:

1. actor,
2. tenant,
3. time/deadline,
4. policy version,
5. optimistic version,
6. idempotency key,
7. previous side effect.

State machine test adalah salah satu investasi test paling berharga untuk domain complex.

---

## 41. Testing Eventual Consistency

Eventual consistency test tidak boleh mengasumsikan instant update.

Contoh salah:

```java
submitApplication();
assertEquals("SUBMITTED", worklist.getStatus()); // immediately
```

Lebih benar:

```java
submitApplication();
await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
    assertEquals("SUBMITTED", worklist.getStatus())
);
```

Tetapi jangan hanya menunggu. Test harus membuktikan:

1. command model updated,
2. event published,
3. projection consumed,
4. projection state benar,
5. convergence terjadi dalam SLA,
6. duplicate event tidak merusak projection.

---

## 42. Testing External Dependency

External dependency biasanya tidak reliable dan tidak selalu tersedia di test.

Strategi:

1. contract/spec from external provider,
2. simulator/fake server,
3. sandbox environment,
4. recorded response snapshots,
5. resilience test for failure,
6. canary/synthetic in staging/prod,
7. fallback test,
8. timeout/retry test,
9. schema drift detection.

Risiko:

1. sandbox tidak sama dengan production,
2. recorded response kadaluarsa,
3. simulator terlalu optimistis,
4. external error code tidak lengkap,
5. rate limit tidak diuji.

External integration test harus memisahkan:

```text
Functional correctness vs availability/resilience vs contract drift
```

---

## 43. Testing Deployment Compatibility

Microservices deployment sering rolling.

Artinya untuk beberapa menit/jam:

```text
v1 dan v2 berjalan bersama
```

Test harus memastikan:

1. old pod bisa baca data yang ditulis new pod,
2. new pod bisa baca data lama,
3. old consumer bisa abaikan field event baru,
4. new consumer bisa handle event lama,
5. old API client tidak rusak,
6. migration tidak mengunci table terlalu lama,
7. config baru punya default aman,
8. feature flag default aman.

Ini sering lebih penting daripada E2E happy path.

---

## 44. Test Pipeline Strategy

Tidak semua test jalan di setiap commit.

Contoh pipeline:

```text
On every commit:
- compile
- static analysis
- unit tests
- slice tests
- fast contract tests

On pull request:
- component tests
- contract verification
- DB migration tests
- security checks

Before merge/release:
- integration tests
- smoke E2E
- compatibility tests

Nightly/scheduled:
- performance regression
- chaos/resilience tests
- replay tests
- dependency upgrade tests

After deploy:
- smoke
- synthetic
- canary verification
- SLO monitoring
```

Tujuannya:

```text
Fast feedback untuk developer, deeper confidence sebelum release, continuous verification setelah deploy.
```

---

## 45. Flaky Test Management

Flaky test adalah test yang kadang lulus kadang gagal tanpa perubahan code relevan.

Sumber flakiness:

1. timing assumption,
2. shared data,
3. shared environment,
4. network dependency,
5. ordering assumption,
6. sleep-based async test,
7. time zone,
8. clock real-time,
9. random data tidak deterministic,
10. cleanup gagal,
11. resource contention.

Prinsip:

```text
Flaky test adalah production risk signal, bukan sekadar annoyance.
```

Tetapi flaky test tidak boleh dibiarkan menjadi noise.

Process:

1. detect flaky test,
2. quarantine sementara dengan owner,
3. root cause,
4. fix determinism/isolation,
5. re-enable,
6. track flaky rate.

Jangan sekadar retry test tanpa memahami akar masalah.

---

## 46. Mutation Testing

Mutation testing mengubah code kecil-kecil untuk melihat apakah test gagal.

Contoh mutasi:

1. `>` menjadi `>=`,
2. return true menjadi false,
3. condition dihapus,
4. exception tidak dilempar.

Jika test tetap lulus, berarti test tidak benar-benar membuktikan behavior.

Mutation testing berguna untuk:

1. domain rule,
2. validation,
3. state machine,
4. policy decision,
5. security decision,
6. idempotency logic.

Tidak harus dipakai untuk seluruh codebase setiap PR karena mahal.

Gunakan untuk modul critical.

---

## 47. Property-Based Testing

Property-based testing menguji properti umum dengan banyak input random/dihasilkan.

Contoh property:

```text
For any valid application,
applying Approve twice with same command id
must not produce two approval events.
```

Atau:

```text
For any state,
invalid transition must not change persisted state.
```

Cocok untuk:

1. state machine,
2. validation,
3. parser,
4. pricing/calculation,
5. idempotency,
6. authorization matrix,
7. data transformation.

Property-based testing membantu menemukan edge case yang tidak terpikir manual.

---

## 48. Approval / Snapshot Testing

Snapshot testing menyimpan expected output lalu membandingkan perubahan.

Berguna untuk:

1. generated JSON,
2. generated email/template,
3. report output,
4. API response shape,
5. audit record shape,
6. OpenAPI/AsyncAPI output.

Bahaya:

1. snapshot besar sulit direview,
2. developer asal update snapshot,
3. semantic regression tidak terlihat.

Gunakan snapshot untuk struktur output, bukan menggantikan domain assertion.

---

## 49. Testing Error Contract

Error handling sering kurang dites.

Microservices error contract harus diuji:

1. validation error,
2. authentication error,
3. authorization error,
4. not found,
5. conflict,
6. idempotency conflict,
7. dependency timeout,
8. rate limited,
9. internal error,
10. retryable vs non-retryable classification.

Contoh response:

```json
{
  "error": {
    "code": "APPLICATION_ALREADY_APPROVED",
    "message": "Application has already been approved.",
    "retryable": false,
    "correlationId": "corr-123"
  }
}
```

Test harus memastikan sensitive details tidak bocor.

---

## 50. Testing Authorization Matrix

Authorization test tidak boleh hanya happy path role.

Matrix:

| Actor | Resource | State | Action | Expected |
|---|---|---|---|---|
| Applicant owner | Draft app | DRAFT | Submit | allow |
| Applicant other | Draft app | DRAFT | Submit | deny |
| Officer assigned | Case | UNDER_REVIEW | Recommend | allow |
| Officer unassigned | Case | UNDER_REVIEW | Recommend | deny |
| Supervisor | Case | RECOMMENDED | Approve | allow |
| Supervisor | Case | DRAFT | Approve | deny |

Tambahkan tenant dan data classification.

Authorization bug di microservices sering terjadi karena:

1. BFF sudah filter tapi backend tidak,
2. gateway authorize coarse-grained tapi service lupa object-level check,
3. service percaya header user palsu,
4. async consumer tidak punya actor context,
5. projection menampilkan data lintas tenant.

---

## 51. Testing Auditability

Untuk sistem regulatory, auditability adalah correctness.

Test harus membuktikan:

1. setiap state transition punya audit record,
2. actor benar,
3. timestamp benar,
4. policy version benar,
5. before/after state benar,
6. reason/comment tercatat jika wajib,
7. correlation ID tercatat,
8. tenant tercatat,
9. external reference tercatat,
10. audit tidak bisa diubah oleh flow biasa.

Contoh:

```text
When supervisor approves application
Then application state becomes APPROVED
And audit record exists with:
- actor = supervisor id
- action = APPROVE_APPLICATION
- fromState = RECOMMENDED
- toState = APPROVED
- policyVersion = current policy
- correlationId = request correlation
```

---

## 52. Java 8–25 Testing Considerations

### Java 8

Common baseline untuk legacy enterprise.

Pertimbangan:

1. belum ada records,
2. belum ada var,
3. belum ada sealed classes,
4. CompletableFuture tersedia,
5. testing stack sering JUnit 4/5 campuran,
6. time API sudah ada (`java.time`),
7. concurrency test lebih manual.

### Java 11

Baseline modern awal.

Pertimbangan:

1. HTTP Client standar tersedia,
2. stronger TLS/runtime baseline,
3. lebih cocok untuk modern CI/CD,
4. migration dari Java 8 perlu test compatibility.

### Java 17

LTS modern yang kuat.

Pertimbangan:

1. records stable,
2. sealed classes stable,
3. pattern matching mulai lebih matang,
4. cocok untuk domain event/command modeling,
5. better GC/runtime baseline.

### Java 21

LTS dengan virtual threads.

Pertimbangan:

1. test blocking service lebih murah secara thread,
2. tetap harus test DB pool/concurrency limit,
3. perlu test pinning/blocking behavior untuk synchronized/native calls,
4. structured concurrency masih preview di beberapa versi, hati-hati untuk production.

### Java 25

Latest GA horizon.

Pertimbangan:

1. gunakan fitur final/stable secara hati-hati,
2. jangan membuat library internal sulit dipakai service Java 17/21 jika estate campuran,
3. compatibility matrix antar service/runtime tetap penting,
4. CI perlu multi-JDK jika library dipakai lintas versi.

---

## 53. Framework Positioning

### Spring Boot / Spring Cloud

Cocok untuk:

1. component tests,
2. slice tests,
3. contract tests,
4. Testcontainers integration,
5. MockMvc/WebTestClient,
6. Spring Cloud Contract,
7. Micrometer observability verification,
8. Resilience4j integration.

Risiko:

1. terlalu banyak `@SpringBootTest` lambat,
2. context startup mahal,
3. mock bean berlebihan,
4. test terlalu framework-centric.

### Jakarta / MicroProfile

Cocok untuk:

1. REST Client contract testing,
2. MicroProfile Config behavior,
3. Fault Tolerance testing,
4. JWT/Auth tests,
5. OpenAPI validation,
6. Health/Telemetry verification.

Risiko:

1. container/runtime specific behavior,
2. integration test perlu runtime setup yang jelas.

### Quarkus

Cocok untuk:

1. fast dev/test cycle,
2. Dev Services/Testcontainers-like experience,
3. native image test jika perlu,
4. MicroProfile stack,
5. reactive/blocking integration.

Risiko:

1. native behavior berbeda dari JVM mode,
2. build-time augmentation perlu test coverage khusus.

### Plain Java

Cocok untuk:

1. domain model,
2. state machine,
3. policy engine,
4. idempotency logic,
5. transformation,
6. concurrency primitives.

Prinsip:

```text
Semakin critical domain logic, semakin sebaiknya bisa dites tanpa framework.
```

---

## 54. Example: Testing Strategy for Application Approval Service

Misal service:

```text
Application Service
- handles submission
- validates applicant data
- owns application aggregate
- writes audit trail
- publishes ApplicationSubmitted/ApplicationApproved events
- uses Profile Service
- writes outbox
- consumes PaymentConfirmed
- updates state machine
```

Testing portfolio:

### Unit

1. state transition DRAFT -> SUBMITTED,
2. invalid APPROVED -> SUBMITTED rejected,
3. duplicate submit command idempotent,
4. policy rule for eligibility,
5. compensation decision.

### Slice

1. REST controller JSON mapping,
2. validation error format,
3. repository optimistic lock,
4. message listener payload mapping.

### Component

1. submit API writes application + audit + outbox in one transaction,
2. duplicate submit with same key returns same result,
3. approval emits exactly one event,
4. unauthorized actor denied,
5. tenant isolation enforced.

### Contract

1. BFF consumer contract for application detail,
2. Case Service contract for approval status API,
3. event contract for `ApplicationApproved`,
4. error contract for conflict/forbidden.

### Integration

1. outbox relay publishes to broker,
2. consumer handles `PaymentConfirmed`,
3. profile service simulator timeout triggers fallback,
4. Redis/cache behavior if used.

### E2E

1. applicant submits application,
2. officer reviews,
3. supervisor approves,
4. worklist updates,
5. audit visible.

### Resilience

1. Profile Service slow,
2. broker unavailable,
3. duplicate event,
4. DB deadlock retry classification,
5. projection lag.

### Observability

1. trace includes submit -> outbox -> consumer,
2. audit has actor/correlation,
3. metrics emit transition count and failure count.

---

## 55. CI/CD Quality Gates

Good gates:

1. compile,
2. lint/static analysis,
3. unit tests,
4. domain mutation tests for critical modules,
5. component tests,
6. contract tests,
7. schema compatibility tests,
8. migration tests,
9. security checks,
10. smoke tests,
11. canary verification.

Bad gates:

1. only line coverage,
2. only E2E test,
3. manual QA as primary correctness gate,
4. shared unstable staging as only validation,
5. contract changes reviewed after deploy,
6. performance tested only before annual release.

Coverage number is useful, but weak alone.

Better metrics:

1. critical invariant coverage,
2. contract coverage,
3. failure mode coverage,
4. mutation score for domain logic,
5. flaky test rate,
6. mean test feedback time,
7. escaped defect rate,
8. rollback due to compatibility issue,
9. incident class not covered by test.

---

## 56. Test Ownership

Microservices testing fails when ownership is unclear.

Ownership model:

| Test type | Owner |
|---|---|
| unit/domain | service team |
| component | service team |
| provider contract | provider team |
| consumer contract | consumer team defines, provider verifies |
| event schema | event owner + platform governance |
| E2E critical journey | product/platform/shared QA with service owners |
| performance | service owner + platform/SRE |
| chaos | service owner + SRE/platform |
| synthetic | owning journey team |

Rule:

```text
The team that owns the risk must own the test or the signal.
```

---

## 57. Production Readiness Checklist

Sebuah microservice belum production-ready jika belum punya jawaban untuk:

### Local correctness

- [ ] domain invariant dites
- [ ] state transitions dites
- [ ] validation/error cases dites
- [ ] authorization decision dites
- [ ] idempotency dites

### Integration correctness

- [ ] DB migration dites
- [ ] repository query dites dengan DB nyata/container
- [ ] outbox/inbox dites
- [ ] external dependency simulator tersedia
- [ ] cache behavior dites

### Contract correctness

- [ ] OpenAPI/REST contract tersedia
- [ ] consumer-driven contract untuk consumer penting
- [ ] event schema contract tersedia
- [ ] backward compatibility rule jelas
- [ ] enum evolution strategy dites

### Distributed correctness

- [ ] duplicate request dites
- [ ] duplicate event dites
- [ ] out-of-order event dites jika relevan
- [ ] retry/timeout behavior dites
- [ ] saga/workflow failure path dites
- [ ] reconciliation path dites

### Runtime readiness

- [ ] smoke test tersedia
- [ ] readiness/liveness/startup behavior dites
- [ ] config validation dites
- [ ] feature flag default dites
- [ ] deployment compatibility dites

### Reliability readiness

- [ ] resilience test tersedia
- [ ] fallback correctness dites
- [ ] load shedding/rate limiting dites
- [ ] performance regression baseline tersedia
- [ ] chaos experiment minimal dirancang

### Observability readiness

- [ ] correlation ID dites
- [ ] trace propagation dites
- [ ] business metrics dites
- [ ] audit trail dites
- [ ] sensitive data tidak bocor ke log

### Governance readiness

- [ ] test ownership jelas
- [ ] flaky test policy ada
- [ ] contract publishing pipeline ada
- [ ] test data strategy jelas
- [ ] compatibility matrix jelas

---

## 58. Top 1% Mental Model

Testing microservices bukan mencari ilusi kepastian total.

Tujuannya adalah membangun **confidence yang proporsional terhadap risiko**.

Engineer top-tier tidak bertanya:

```text
Berapa coverage kita?
```

Mereka bertanya:

```text
Risiko produksi apa yang masih belum punya signal?
```

Mereka tidak berkata:

```text
Sudah ada E2E, aman.
```

Mereka bertanya:

```text
Apakah E2E ini membuktikan risk yang tepat, atau hanya membuat pipeline lambat?
```

Mereka tidak berkata:

```text
Kita sudah mock dependency.
```

Mereka bertanya:

```text
Mock ini meniru contract dan failure behavior dependency nyata atau hanya happy path palsu?
```

Mereka tidak berkata:

```text
Event sudah dikirim.
```

Mereka bertanya:

```text
Apa yang terjadi kalau event dikirim dua kali, terlambat, versi lama, atau diputar ulang?
```

---

## 59. Practical Exercises

### Exercise 1 — Build Testing Portfolio

Pilih satu service dari sistem Anda.

Buat tabel:

| Risk | Current test | Missing test | Priority |
|---|---|---|---|
| duplicate approval | none | idempotency component test | high |
| provider API removes field | manual QA | contract test | high |
| projection stale | E2E only | eventual consistency component test | medium |

### Exercise 2 — Contract Design

Ambil satu API internal.

Definisikan:

1. consumer,
2. required fields,
3. optional fields,
4. error contract,
5. backward compatibility rule,
6. test owner.

### Exercise 3 — Event Replay Safety

Ambil satu event consumer.

Uji:

1. same event twice,
2. event version older,
3. unknown optional field,
4. event replay mode,
5. side effect suppression.

### Exercise 4 — Saga Failure Matrix

Ambil satu workflow.

Buat matrix:

| Step | Failure | Retry? | Compensation? | Test? |
|---|---|---:|---:|---:|
| verify profile | timeout | yes | no | missing |
| reserve payment | unknown outcome | yes with status check | maybe | missing |
| approve application | DB conflict | yes | no | exists |

### Exercise 5 — Observability Test

Buat test yang memastikan correlation ID dari API request muncul di:

1. service log,
2. outbox event,
3. consumer log,
4. audit trail.

---

## 60. Summary

Testing microservices adalah strategi menyusun confidence di tengah perubahan independen dan failure distribusi.

Poin penting:

1. testing pyramid berguna tetapi tidak cukup,
2. test portfolio lebih tepat untuk microservices,
3. unit test harus fokus pada domain correctness,
4. component test membuktikan service dengan dependency realistis,
5. contract test adalah pilar independent deployment,
6. event contract dan schema compatibility sangat penting,
7. E2E test harus sedikit tetapi critical,
8. async system perlu convergence testing,
9. idempotency/replay/failure path wajib dites,
10. migration dan deployment compatibility harus jadi first-class test,
11. observability juga harus dites,
12. test ownership harus jelas,
13. top-tier testing dimulai dari risk modeling, bukan coverage chasing.

---

## 61. Seri Status

Kita sudah menyelesaikan:

```text
Part 23 of 35 — Testing Strategy for Microservices
```

Seri belum selesai.

Part berikutnya:

```text
Part 24 — Contract, Schema, and Compatibility Engineering
```

Filename berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-24-contract-schema-compatibility-engineering.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-22-observability-patterns.md">⬅️ Learn Java Microservices Patterns — Advanced Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-24-contract-schema-compatibility-engineering.md">Part 24 — Contract, Schema, and Compatibility Engineering ➡️</a>
</div>
