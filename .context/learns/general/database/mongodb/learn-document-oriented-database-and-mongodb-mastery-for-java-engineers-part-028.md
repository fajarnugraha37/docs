# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-028.md

# Part 028 — Testing Strategy: Unit, Integration, Contract, Migration, and Failure Testing

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 028 dari 035  
> Fokus: test pyramid untuk MongoDB, unit test, repository integration test, aggregation test, schema compatibility test, migration/backfill test, transaction test, concurrency test, Testcontainers, replica set testing, failure injection, performance regression, fixture strategy, dan CI/CD quality gate  
> Target pembaca: Java software engineer / tech lead yang ingin menguji MongoDB-backed application secara serius, bukan hanya mock repository dan berharap production aman

---

## 0. Posisi Part Ini Dalam Seri

Part 027 membahas schema evolution dan migration. Bagian ini membahas bagaimana memastikan semua desain yang sudah kita bahas benar-benar bertahan di production.

MongoDB testing sering salah arah.

Anti-pattern umum:

```text
mock MongoRepository
assert service calls repository.save()
```

Test seperti itu hampir tidak membuktikan hal penting:

- query benar?
- index cocok?
- aggregation pipeline valid?
- BSON type sesuai?
- update atomic?
- transaction berjalan?
- optimistic locking conflict terdeteksi?
- migration idempotent?
- old document bisa dibaca new code?
- tenant filter tidak lupa?
- projection/redaction aman?
- failover/retry behavior benar?
- performance tidak berubah drastis?

MongoDB adalah database dokumen dengan query, update operators, indexes, transactions, projections, aggregations, and distributed behavior. Testing harus mencakup hal-hal tersebut.

Kalimat inti:

> Jangan mock away the thing you are trying to trust.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu harus mampu:

1. Menentukan apa yang perlu unit test dan apa yang perlu integration test.
2. Mendesain testing pyramid untuk MongoDB-backed Java service.
3. Menguji query builder tanpa mengandalkan production.
4. Menguji repository dengan MongoDB nyata.
5. Menguji aggregation pipeline dengan fixture dan golden output.
6. Menguji schema compatibility untuk old/new documents.
7. Menguji migration/backfill idempotency dan rollback.
8. Menguji transaction dan concurrency conflict.
9. Menguji tenant isolation dan authorization guardrails.
10. Menguji index expectation dan query performance regression.
11. Menggunakan Testcontainers untuk MongoDB integration tests.
12. Memahami kapan butuh replica set test environment.
13. Mendesain failure tests untuk timeout, duplicate key, transient errors, and retry.
14. Membuat CI quality gate yang realistis.
15. Membuat fixture strategy yang tidak rapuh.

---

## 2. Testing Philosophy

MongoDB testing harus menjawab beberapa jenis pertanyaan.

### 2.1 Logic correctness

```text
Apakah domain rule benar?
Apakah state machine valid?
Apakah authorization decision benar?
```

Ini bisa unit test murni.

### 2.2 Persistence correctness

```text
Apakah document shape benar?
Apakah field type benar?
Apakah query mengembalikan data benar?
Apakah update operator benar?
```

Butuh MongoDB nyata atau minimal integration test.

### 2.3 Compatibility correctness

```text
Apakah new code bisa membaca old documents?
Apakah old code toleran terhadap new documents?
```

Butuh fixture dokumen versi lama/baru.

### 2.4 Operational correctness

```text
Apakah transaction retry aman?
Apakah migration bisa pause/resume?
Apakah duplicate key ditangani?
Apakah timeout tidak jadi retry storm?
```

Butuh integration/failure tests.

### 2.5 Performance correctness

```text
Apakah query tetap index-friendly?
Apakah result size dibatasi?
Apakah docs examined tidak meledak?
```

Butuh explain/performance regression tests.

---

## 3. Test Pyramid Untuk MongoDB

Struktur:

```text
Fast unit tests
  domain logic
  query builder shape
  mapper/adapter compatibility
  authorization criteria builder

Integration tests with real MongoDB
  repository CRUD/update
  aggregation
  transaction
  index/unique constraint
  schema validation
  migration scripts

Contract tests
  document schema fixtures
  API contract
  outbox/search projection event schema
  old/new compatibility

Failure/concurrency tests
  duplicate key
  optimistic lock
  concurrent updates
  retryable transient behavior
  transaction conflict

Performance/regression tests
  explain plans
  query cardinality
  max result guardrails
  migration batch cost

Staging/chaos tests
  replica set failover
  replication lag
  backup/restore
  load with production-like data
```

Unit tests are necessary but insufficient.

---

## 4. What To Unit Test

Good unit tests:

```text
domain state transition
validation rule
command idempotency decision
authorization criteria construction
query mode selection
projection DTO mapping
schema reader adapter old/new docs
migration transformation pure function
retention policy date calculation
redaction policy
search request validation
```

Example:

```java
@Test
void escalateOnlyAllowedFromUnderReview() {
    CaseState state = CaseState.underReview(version(7));

    CaseState next = state.escalate(reason("SLA breach"), actor("u1"));

    assertThat(next.status()).isEqualTo(ESCALATED);
    assertThat(next.version()).isEqualTo(version(8));
}
```

This does not need MongoDB.

---

## 5. What Not To Mock Too Much

Avoid relying only on mocks for:

```text
Mongo query semantics
update operators
aggregation pipeline
index uniqueness
transaction behavior
BSON type mapping
ObjectId/date/Decimal128 behavior
write result matched/modified count
duplicate key exception shape
```

Mocking repository can verify service orchestration, but not database behavior.

Bad test:

```java
verify(caseRepository).save(case);
```

Better:

```java
call service
read MongoDB
assert document state changed
assert audit inserted
assert duplicate command idempotent
```

---

## 6. Repository Integration Tests

Repository tests should use real MongoDB.

Test:

- insert/find,
- update with guards,
- projection,
- pagination,
- sort,
- unique index,
- partial index behavior if important,
- aggregation pipeline,
- bulk write,
- transaction if used.

Example test intent:

```text
findOpenWorklist returns only tenant's open cases,
sorted by dueAt,
limited to 50,
excluding unauthorized cases,
mapping to summary DTO only.
```

This is hard to prove with mocks.

---

## 7. Testcontainers

Testcontainers is a practical way to run MongoDB in integration tests.

Conceptual Java setup:

```java
static MongoDBContainer mongo =
    new MongoDBContainer("mongo:7.0");

@BeforeAll
static void start() {
    mongo.start();
}
```

Then configure Spring:

```java
@DynamicPropertySource
static void mongoProperties(DynamicPropertyRegistry registry) {
    registry.add("spring.data.mongodb.uri", mongo::getReplicaSetUrl);
}
```

Important:

- choose version close to production,
- pin image version,
- use replica set URL if transactions/change streams tested,
- initialize indexes before tests,
- clean data between tests.

---

## 8. Why Replica Set Matters In Tests

Certain MongoDB features require replica set/change stream support:

```text
transactions
change streams
retryable writes in realistic mode
causal sessions
failover behavior
```

If tests use standalone MongoDB but production uses replica set, some behavior is untested.

For transaction tests, configure MongoDB container as replica set or use Testcontainers MongoDB support that exposes replica set URL.

Testing with standalone is okay for simple CRUD, but insufficient for production semantics involving sessions/transactions/change streams.

---

## 9. Spring Boot Integration Test Pattern

Example:

```java
@DataMongoTest
@Testcontainers
class CaseRepositoryIntegrationTest {

    @Container
    static MongoDBContainer mongo = new MongoDBContainer("mongo:7.0");

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("spring.data.mongodb.uri", mongo::getReplicaSetUrl);
    }

    @Autowired MongoTemplate mongoTemplate;
    @Autowired CaseRepository repository;

    @BeforeEach
    void clean() {
        mongoTemplate.dropCollection(CaseDocument.class);
        ensureIndexes();
    }
}
```

Use `@DataMongoTest` for data-layer focused test.

Use full `@SpringBootTest` when testing service + transaction + outbox + repositories.

---

## 10. Cleaning Database Between Tests

Options:

```text
drop database
drop collections
deleteMany per collection
unique database name per test class
transaction rollback if supported, but not always ideal
```

For integration tests:

```java
mongoTemplate.getDb().drop();
ensureIndexes();
```

But index creation can be costly.

Alternative:

```text
unique database per test class
drop after class
```

Avoid tests leaking data into each other.

---

## 11. Fixture Strategy

Good fixture has:

- meaningful tenant,
- overlapping IDs across tenants,
- old/new schema versions,
- boundary dates,
- large arrays where relevant,
- missing optional fields,
- unknown enum values,
- authorization variations,
- deleted/archived/legal hold cases.

Bad fixture:

```text
one happy path document with all fields perfect
```

Use builders:

```java
CaseDocFixture.openCase()
    .tenant("tenant-a")
    .caseId("CASE-001")
    .assignee("u1")
    .dueAt(...)
    .build();
```

Also store golden JSON documents for compatibility.

---

## 12. Golden Document Fixtures

Keep sample BSON/JSON documents representing historical schema versions.

Example files:

```text
fixtures/cases/v1-open-case.json
fixtures/cases/v2-owner-field.json
fixtures/cases/v3-access-object.json
fixtures/cases/v4-retention.json
```

Tests:

```java
@Test
void canReadV1CaseDocument() {
    Document doc = loadJson("fixtures/cases/v1-open-case.json");
    CasePersistenceModel model = reader.read(doc);
    assertThat(model.ownerUserId()).isEqualTo("u1");
}
```

This prevents breaking old persisted data.

---

## 13. Schema Compatibility Tests

Test matrix:

```text
new reader reads old document
new reader reads current document
reader handles missing optional field
reader fails safely on unknown critical enum
writer produces current schema
old-compatible mode produces dual fields if required
```

Example:

```java
@Test
void readerFallsBackFromOwnerUserIdToAssigneeId() {
    Document oldDoc = new Document()
        .append("tenantId", "t1")
        .append("caseId", "c1")
        .append("assigneeId", "u1");

    CasePersistenceModel model = reader.read(oldDoc);

    assertThat(model.ownerUserId()).isEqualTo("u1");
}
```

---

## 14. BSON Type Tests

BSON types matter.

Test:

- `ObjectId`,
- `Decimal128`,
- `Date` / `Instant`,
- arrays,
- nested documents,
- null vs missing,
- integer vs long,
- enum string,
- UUID representation if used.

Example issue:

```text
riskScore stored as string in old docs, int in new docs
```

Test compatibility.

---

## 15. Query Builder Tests

If query builder is complex, test generated query shape.

Example:

```java
Query query = builder.worklistQuery(tenantId, assigneeId, cursor, limit);

assertThat(query.getQueryObject()).isEqualTo(Document.parse(

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-027.md">⬅️ Part 027 — Schema Evolution, Migration, Backfill, and Zero-Downtime Changes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-029.md">Part 029 — Observability and Operations: Metrics, Logs, Profiling, Slow Queries, Runbooks ➡️</a>
</div>
