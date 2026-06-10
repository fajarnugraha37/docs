# Strict Coding Standards: Java + MongoDB

> **Purpose**: This document defines strict, enforceable standards for LLM code agents implementing Java code that interacts with MongoDB.
>
> It is an overlay standard. It must be used together with the relevant baseline standards:
>
> - `strict-coding-standards__java11.md` / `java17.md` / `java21.md` / `java25.md`
> - `strict-coding-standards__java_security.md`
> - `strict-coding-standards__java_json.md`
> - `strict-coding-standards__java_validation.md`
> - `strict-coding-standards__java_testing.md`
> - `strict-coding-standards__java_benchmarking.md`
> - `strict-coding-standards__java_telemetry.md`
> - framework-specific standards, for example Spring Boot, Quarkus, Micronaut, or Jakarta EE.

---

## 1. Scope

This standard applies to Java code that uses MongoDB for:

- document storage
- aggregate persistence
- event snapshots
- read models
- search-like document lookup
- semi-structured metadata
- audit/event documents where append-only discipline is enforced
- change stream consumers
- GridFS file/object storage
- TTL-based transient data
- sharded/replicated MongoDB deployments
- MongoDB Atlas or self-managed MongoDB clusters

This standard covers:

- official MongoDB Java Sync Driver
- official MongoDB Reactive Streams Driver
- MongoDB BSON API
- POJO Codec
- driver-level sessions and transactions
- read/write concern
- retryable writes
- indexes
- schema validation
- change streams
- aggregation pipelines
- bulk writes
- connection pools
- Spring Data MongoDB integration at the boundary level

This standard does **not** replace:

- application-layer validation
- authorization rules
- domain modeling rules
- API DTO rules
- schema migration governance
- operational DBA/cluster sizing policy

---

## 2. Core Principle

MongoDB is not “JSON with SQL missing.”

MongoDB code must be designed around:

1. **query-first document modeling**
2. **bounded document size and shape**
3. **explicit index strategy**
4. **explicit consistency model**
5. **explicit read/write concern**
6. **idempotent retry behavior**
7. **clear ownership of schema evolution**
8. **no accidental relational modeling inside document storage**

An LLM must not generate MongoDB access code until it knows:

- collection name
- document ownership
- document schema/version
- primary query patterns
- indexes required
- expected read/write volume
- consistency requirement
- sharding expectation, if any
- transaction requirement, if any
- retry/idempotency behavior
- error handling semantics

---

## 3. Version and Driver Policy

### 3.1 Required Baseline

For new Java code:

```text
MUST use MongoDB Java Driver 5.x or newer stable line approved by the project.
MUST pin exact dependency versions or use a controlled BOM.
MUST verify driver/server compatibility using the official MongoDB compatibility matrix.
```

The current official Java Sync Driver documentation is for the current 5.x line. Driver 5.5 removed support for MongoDB Server 4.0, and Java Driver 5.7.0 was released on April 30, 2026 according to the upstream release page. The exact version must still be chosen by project BOM/release governance.

### 3.2 Dependency Policy

Allowed dependencies:

```xml
<dependency>
  <groupId>org.mongodb</groupId>
  <artifactId>mongodb-driver-sync</artifactId>
  <version>${mongodb.driver.version}</version>
</dependency>
```

For reactive code:

```xml
<dependency>
  <groupId>org.mongodb</groupId>
  <artifactId>mongodb-driver-reactivestreams</artifactId>
  <version>${mongodb.driver.version}</version>
</dependency>
```

For low-level BSON-only code:

```xml
<dependency>
  <groupId>org.mongodb</groupId>
  <artifactId>bson</artifactId>
  <version>${mongodb.driver.version}</version>
</dependency>
```

### 3.3 Forbidden Dependency Practices

Forbidden:

```text
- dynamic versions such as latest.release, +, RELEASE, SNAPSHOT
- mixing multiple incompatible MongoDB driver major versions
- using deprecated legacy 3.x driver for new code
- using old async/callback driver for new code
- hiding MongoDB driver dependency in random utility modules
- adding an ODM framework without explicit architecture approval
```

### 3.4 Sync vs Reactive Driver Decision

Default:

```text
Use the Sync Driver for normal blocking applications.
Use Reactive Streams Driver only when the application stack is truly reactive end-to-end.
```

Do not use reactive driver just because it looks modern.

Reactive driver is allowed only if:

- framework is reactive, for example WebFlux, Vert.x, Mutiny bridge, or Reactor-based pipeline
- downstream chain preserves backpressure
- blocking code is not inserted into reactive callbacks
- subscription/cancellation/error handling is tested

Forbidden:

```text
- wrapping sync driver in reactive type and calling it on event loop
- using reactive driver then blocking with .block() / await() in hot path
- mixing sync and reactive access to same collection without documented reason
```

---

## 4. Client Lifecycle

### 4.1 MongoClient Ownership

`MongoClient` must be lifecycle-managed and reused.

Allowed:

```java
public final class MongoClientProvider implements AutoCloseable {
    private final MongoClient client;

    public MongoClientProvider(String connectionString) {
        MongoClientSettings settings = MongoClientSettings.builder()
                .applyConnectionString(new ConnectionString(connectionString))
                .applyToConnectionPoolSettings(pool -> pool
                        .maxSize(50)
                        .minSize(5)
                        .maxWaitTime(2, TimeUnit.SECONDS))
                .applyToSocketSettings(socket -> socket
                        .connectTimeout(2, TimeUnit.SECONDS)
                        .readTimeout(5, TimeUnit.SECONDS))
                .retryWrites(true)
                .retryReads(true)
                .build();

        this.client = MongoClients.create(settings);
    }

    public MongoDatabase database(String name) {
        return client.getDatabase(name);
    }

    @Override
    public void close() {
        client.close();
    }
}
```

Forbidden:

```java
// FORBIDDEN: client per operation.
try (MongoClient client = MongoClients.create(uri)) {
    client.getDatabase("app").getCollection("users").find().first();
}
```

### 4.2 Database and Collection Handles

`MongoDatabase` and `MongoCollection` handles may be reused as lightweight access objects.

Rules:

```text
MUST centralize database/collection names.
MUST not concatenate tenant/user input into database or collection names.
MUST define collection type: Document, BsonDocument, or POJO class.
MUST document codec strategy.
```

Allowed:

```java
public final class UserCollections {
    public static final String DATABASE = "identity";
    public static final String USERS = "users";

    private UserCollections() {}
}
```

Forbidden:

```java
String collection = request.getParameter("collection");
database.getCollection(collection); // FORBIDDEN
```

---

## 5. Configuration Standard

### 5.1 Required Configuration Fields

Every MongoDB client configuration must explicitly define:

```text
- connection string source
- server selection timeout
- connect timeout
- socket/read timeout
- connection pool max size
- connection pool min size, if required
- max wait time for pool checkout
- retryReads setting
- retryWrites setting
- read preference
- read concern, if not default
- write concern, if not default
- app name
- TLS setting
- authentication mechanism/source, if relevant
- monitoring/command listener policy
```

### 5.2 Connection String Policy

Allowed:

```text
mongodb+srv://cluster.example.com/app
mongodb://host1,host2,host3/app?replicaSet=rs0
```

Forbidden:

```text
- hardcoded username/password in source code
- logging full connection string with credentials
- building URI from unvalidated user input
- relying on driver defaults for production timeout/pool behavior
```

### 5.3 Secret Handling

MongoDB credentials must come from approved secret source:

- AWS Secrets Manager
- Azure Key Vault
- GCP Secret Manager
- Kubernetes Secret mounted safely
- Vault
- project-approved secret manager

Forbidden:

```java
String uri = "mongodb://admin:password123@host/db"; // FORBIDDEN
```

---

## 6. Document Modeling Rules

### 6.1 Query-First Modeling

Before generating a collection schema, the LLM must identify:

```text
- owner aggregate
- primary lookup query
- secondary query patterns
- update pattern
- document growth behavior
- retention policy
- expected cardinality
- index requirements
- shard key candidate, if sharded
```

MongoDB schema must be designed around application access patterns, not normalized relational habits.

### 6.2 Embed vs Reference Decision

Embed when:

```text
- child object is owned by parent
- child lifecycle is tied to parent
- common query reads parent + child together
- child cardinality is bounded
- document will not exceed size/growth limits
```

Reference when:

```text
- child is shared across owners
- child cardinality is unbounded
- child changes independently at high frequency
- parent document would grow without bound
- separate authorization boundary exists
```

Forbidden:

```text
- embedding unbounded event history into one document
- modeling many-to-many by duplicating full documents everywhere
- using MongoDB as if every relationship must be normalized
- using $lookup as default replacement for relational joins
```

### 6.3 Document Size and Growth

Every collection must define:

```text
- maximum expected document size
- maximum array sizes for embedded arrays
- growth behavior over time
- archival/TTL policy when applicable
```

Forbidden:

```text
- unbounded arrays
- append-only child arrays without cap/rotation
- storing huge binary payload in normal document field
```

Use GridFS or external object storage for large binary content.

### 6.4 Document Versioning

Persistent document shape must include versioning when schema evolves.

Allowed:

```java
public record UserDocument(
        ObjectId id,
        int schemaVersion,
        String username,
        String email,
        Instant createdAt,
        Instant updatedAt
) {}
```

Rules:

```text
MUST preserve backward read compatibility during rolling deployments.
MUST handle missing fields explicitly.
MUST not assume all existing documents have newly added fields.
MUST not use null as silent migration strategy without review.
```

---

## 7. BSON and POJO Mapping

### 7.1 Preferred Mapping Approach

Allowed approaches:

1. explicit `Document` for dynamic/administrative code
2. `BsonDocument` for low-level exact BSON operations
3. POJO codec for stable document schemas
4. framework mapping only if approved, for example Spring Data MongoDB

Default for business code:

```text
Use typed document classes or records where framework/codec supports them safely.
Avoid raw Document leaking across domain boundaries.
```

### 7.2 Boundary Rule

MongoDB document classes are persistence models, not API DTOs and not domain entities by default.

Forbidden:

```text
- returning MongoDB Document directly from REST API
- exposing ObjectId as public API unless API contract explicitly uses it
- binding request body directly into persistence document
- using persistence annotations as domain model design
```

### 7.3 Codec Registry

If using POJO codec, codec registry must be centralized.

Allowed:

```java
CodecRegistry pojoCodecRegistry = fromRegistries(
        MongoClientSettings.getDefaultCodecRegistry(),
        fromProviders(PojoCodecProvider.builder()
                .automatic(false)
                .register(UserDocument.class)
                .build())
);

MongoCollection<UserDocument> users = database
        .withCodecRegistry(pojoCodecRegistry)
        .getCollection("users", UserDocument.class);
```

Rules:

```text
MUST prefer explicit class registration over broad automatic mapping.
MUST test serialization/deserialization for every persisted document type.
MUST define unknown/missing/null field behavior.
MUST not rely on reflection magic without tests.
```

### 7.4 ObjectId Policy

Rules:

```text
MUST define whether _id is ObjectId, UUID, natural key, or application-generated ID.
MUST not expose ObjectId timestamp semantics as business time.
MUST not parse arbitrary user strings as ObjectId without validation.
```

Allowed:

```java
ObjectId id = new ObjectId(hexString);
```

Only after validation:

```java
if (!ObjectId.isValid(hexString)) {
    throw new InvalidIdentifierException("Invalid user id");
}
```

---

## 8. Collection Naming and Ownership

### 8.1 Naming Rules

Collection names must be:

```text
- lowercase
- plural noun or domain-owned name
- stable
- centralized as constants
- not generated from user input
```

Examples:

```text
users
case_events
audit_records
invoice_snapshots
```

Avoid:

```text
UserCollection
userCollection_v2_temp_final
tenant_${tenantId}_users
```

### 8.2 Ownership

Each collection must have one owning bounded context/module.

Rules:

```text
MUST not let unrelated services write directly into another service's owned collection.
MUST define read-only access separately from write ownership.
MUST document whether collection is source-of-truth or read model.
```

---

## 9. Indexing Standard

### 9.1 Index Requirement

Every production query must have an index decision.

For every query, document:

```text
- filter fields
- sort fields
- projection
- expected cardinality
- index used
- whether query is covered
- pagination strategy
```

### 9.2 Index Creation

Index creation must be owned by migration/deployment process, not random application startup code, unless explicitly approved.

Allowed for controlled bootstrapping/test:

```java
collection.createIndex(
        Indexes.ascending("tenantId", "status", "createdAt"),
        new IndexOptions().name("idx_tenant_status_created_at")
);
```

Forbidden in normal application startup:

```java
// FORBIDDEN unless explicitly approved migration bootstrap.
collection.createIndex(Indexes.ascending("field"));
```

### 9.3 Compound Index Rule

Compound indexes must match query shape.

Rules:

```text
MUST place equality predicates before range/sort fields where appropriate.
MUST include tenantId/accountId in multi-tenant access indexes.
MUST avoid unused indexes.
MUST consider write amplification from too many indexes.
```

### 9.4 Unique Index

Unique constraints must be enforced with unique index where data integrity requires it.

Allowed:

```java
collection.createIndex(
        Indexes.ascending("tenantId", "emailNormalized"),
        new IndexOptions()
                .unique(true)
                .name("uk_tenant_email_normalized")
);
```

Rules:

```text
MUST handle duplicate key error explicitly.
MUST normalize case/locale before unique index when required.
MUST not rely only on application-level uniqueness check.
```

### 9.5 TTL Index

TTL indexes are allowed for transient data only.

Allowed:

```java
collection.createIndex(
        Indexes.ascending("expiresAt"),
        new IndexOptions()
                .expireAfter(0L, TimeUnit.SECONDS)
                .name("ttl_expires_at")
);
```

Rules:

```text
MUST not use TTL for regulatory/audit data unless approved.
MUST document deletion delay tolerance.
MUST not assume TTL deletion is immediate.
```

---

## 10. Query Standard

### 10.1 Query Construction

Use typed builders where possible.

Allowed:

```java
Bson filter = Filters.and(
        Filters.eq("tenantId", tenantId),
        Filters.eq("status", status.name())
);

List<UserDocument> result = users.find(filter)
        .projection(Projections.include("_id", "username", "email"))
        .limit(50)
        .into(new ArrayList<>());
```

Forbidden:

```java
String json = "{ tenantId: '" + tenantId + "' }"; // FORBIDDEN
collection.find(BsonDocument.parse(json));
```

### 10.2 Projection Rule

Queries must use projection when returning a subset or when document size is non-trivial.

Rules:

```text
MUST not fetch entire large document when only small subset is needed.
MUST avoid returning secret/internal fields accidentally.
MUST not use projection that breaks required decoder fields without tests.
```

### 10.3 Sort Rule

Sort must be deterministic.

Rules:

```text
MUST include tie-breaker field such as _id when sorting by non-unique field.
MUST align sort with index where required.
MUST not sort large unindexed result sets.
```

Allowed:

```java
collection.find(filter)
        .sort(Sorts.orderBy(Sorts.descending("createdAt"), Sorts.descending("_id")))
        .limit(100);
```

### 10.4 Pagination Rule

Offset-style pagination with `skip` is restricted.

Allowed for small/admin screens only:

```java
collection.find(filter)
        .sort(Sorts.descending("createdAt"))
        .skip(page * size)
        .limit(size);
```

Preferred for large data:

```text
keyset/cursor pagination using stable sort key
```

Example:

```java
Bson filter = Filters.and(
        Filters.eq("tenantId", tenantId),
        Filters.lt("createdAt", cursorCreatedAt)
);
```

Forbidden:

```text
- unbounded find()
- deep skip pagination on large collection
- returning all documents into memory
```

### 10.5 Count Rule

Counting must be intentional.

Rules:

```text
MUST distinguish exact count vs estimated count.
MUST not count large filtered dataset on hot path without index/evidence.
MUST document UX requirement if total count is expensive.
```

---

## 11. Write Standard

### 11.1 Insert

Rules:

```text
MUST set createdAt and updatedAt consistently.
MUST validate document shape before insert.
MUST handle duplicate key errors explicitly.
MUST not silently replace caller-provided _id unless policy says so.
```

Allowed:

```java
try {
    users.insertOne(document);
} catch (MongoWriteException ex) {
    if (ex.getError().getCategory() == ErrorCategory.DUPLICATE_KEY) {
        throw new DuplicateUserException(document.email());
    }
    throw ex;
}
```

### 11.2 Update

Updates must be explicit operator updates, not blind full replacement, unless full replacement is intended.

Allowed:

```java
Bson filter = Filters.and(
        Filters.eq("_id", userId),
        Filters.eq("tenantId", tenantId),
        Filters.eq("version", expectedVersion)
);

Bson update = Updates.combine(
        Updates.set("displayName", newDisplayName),
        Updates.set("updatedAt", now),
        Updates.inc("version", 1)
);

UpdateResult result = users.updateOne(filter, update);
if (result.getMatchedCount() == 0) {
    throw new ConcurrentModificationException("User was modified or not found");
}
```

Forbidden:

```java
// FORBIDDEN: blind replacement from request body.
collection.replaceOne(eq("_id", id), requestBody);
```

### 11.3 Upsert

Upsert is restricted.

Allowed only if:

```text
- idempotency key or natural key is defined
- created vs updated path is observable
- duplicate key race is handled
- default fields are explicit
```

Allowed:

```java
UpdateOptions options = new UpdateOptions().upsert(true);

collection.updateOne(
        Filters.eq("idempotencyKey", key),
        Updates.combine(
                Updates.setOnInsert("createdAt", now),
                Updates.set("lastSeenAt", now)),
        options
);
```

Forbidden:

```text
- upsert as shortcut for missing existence checks
- upsert without unique index on natural/idempotency key
```

### 11.4 Delete

Rules:

```text
MUST include tenant/owner constraint.
MUST distinguish hard delete vs soft delete.
MUST document audit/regulatory impact.
MUST not delete many without explicit bounded filter and approval.
```

Forbidden:

```java
collection.deleteMany(new Document()); // FORBIDDEN
```

---

## 12. Optimistic Concurrency

Use version field when concurrent updates matter.

Required for:

```text
- user-editable documents
- case/workflow state
- balance/counter-like logical state
- approval lifecycle
- aggregate state machine
```

Allowed:

```java
Bson filter = Filters.and(
        Filters.eq("_id", id),
        Filters.eq("version", expectedVersion)
);

Bson update = Updates.combine(
        Updates.set("state", newState.name()),
        Updates.inc("version", 1),
        Updates.set("updatedAt", now)
);

UpdateResult result = collection.updateOne(filter, update);
if (result.getModifiedCount() != 1) {
    throw new OptimisticLockException("Document version conflict");
}
```

Forbidden:

```text
- read-modify-write without version or atomic operator
- assuming MongoDB single-document atomicity protects multi-document workflow invariants
```

---

## 13. Transactions

### 13.1 Transaction Policy

MongoDB multi-document transactions are **restricted**, not default.

Use transaction only when:

```text
- data truly spans multiple documents/collections
- denormalization cannot solve the invariant safely
- performance impact is acceptable
- read/write concern is explicit
- retry behavior is implemented
- transaction lifetime is bounded
```

Prefer single-document atomic updates when possible.

### 13.2 Transaction Rules

Transactions must define:

```text
- session ownership
- transaction options
- read concern
- write concern
- read preference
- retry handling for transient errors
- max operation count/time
- failure semantics
```

Allowed:

```java
TransactionOptions txnOptions = TransactionOptions.builder()
        .readConcern(ReadConcern.SNAPSHOT)
        .writeConcern(WriteConcern.MAJORITY)
        .readPreference(ReadPreference.primary())
        .build();

try (ClientSession session = client.startSession()) {
    session.withTransaction(() -> {
        accounts.updateOne(session, debitFilter, debitUpdate);
        accounts.updateOne(session, creditFilter, creditUpdate);
        ledger.insertOne(session, ledgerEntry);
        return null;
    }, txnOptions);
}
```

Forbidden:

```text
- unbounded work inside transaction
- network calls inside transaction
- waiting for user input inside transaction
- using transaction to compensate poor document modeling by default
```

---

## 14. Read Concern, Write Concern, Read Preference

### 14.1 Required Decision

Every service must define default consistency posture:

```text
- read concern
- write concern
- read preference
- transaction read/write concern, if applicable
```

### 14.2 Write Concern

For durable business writes, prefer acknowledged majority semantics unless project-specific policy says otherwise.

Rules:

```text
MUST not weaken write concern silently.
MUST document trade-off if using lower durability.
MUST not use unacknowledged writes for critical data.
```

Forbidden:

```java
collection.withWriteConcern(WriteConcern.UNACKNOWLEDGED); // FORBIDDEN for business data
```

### 14.3 Read Preference

Rules:

```text
MUST use primary for read-after-write consistency unless stale reads are acceptable.
MUST document staleness tolerance for secondary reads.
MUST not use secondaryPreferred as performance shortcut without correctness analysis.
```

---

## 15. Retry and Idempotency

### 15.1 Driver Retry

`retryReads` and `retryWrites` must be explicitly configured.

Rules:

```text
MUST understand whether operation is idempotent.
MUST not duplicate external side effects on retry.
MUST use idempotency keys for command-style writes.
MUST handle duplicate key as possible successful prior attempt when appropriate.
```

### 15.2 Application Retry

Application-level retry is allowed only when:

```text
- error class is transient
- operation is idempotent or protected by idempotency key
- retry count is bounded
- backoff/jitter is configured
- metrics/logging capture retry result
```

Forbidden:

```text
- retrying non-idempotent insert without unique idempotency key
- retrying transaction blindly without following driver transaction retry guidance
- infinite retry loop
```

---

## 16. Bulk Operations

Bulk writes must inspect item-level results and errors.

Allowed:

```java
List<WriteModel<UserDocument>> writes = List.of(
        new InsertOneModel<>(user1),
        new UpdateOneModel<>(filter, update, new UpdateOptions().upsert(true))
);

try {
    BulkWriteResult result = users.bulkWrite(writes, new BulkWriteOptions().ordered(false));
} catch (MongoBulkWriteException ex) {
    for (BulkWriteError error : ex.getWriteErrors()) {
        // map error index to original input item
    }
    throw ex;
}
```

Rules:

```text
MUST define ordered vs unordered.
MUST map errors back to input items.
MUST define batch size.
MUST not put unbounded writes into memory.
MUST define idempotency for retry.
```

---

## 17. Aggregation Pipeline

### 17.1 Allowed Use

Aggregation is allowed for:

```text
- reporting/read model query
- controlled projection/transformation
- grouping/aggregation with proper indexes
- change stream filtering
```

### 17.2 Restricted Use

Aggregation is restricted when:

```text
- pipeline is dynamically built from user input
- pipeline includes $lookup
- pipeline sorts large unindexed result set
- pipeline writes via $merge / $out
- pipeline is on hot path without explain/evidence
```

### 17.3 Pipeline Rules

Rules:

```text
MUST validate every user-controlled filter/sort/project field via allow-list.
MUST place selective $match as early as possible.
MUST project only needed fields.
MUST test explain plan for critical pipelines.
MUST set maxTimeMS for expensive/admin queries.
```

Forbidden:

```java
List<Bson> pipeline = List.of(BsonDocument.parse(userProvidedJson)); // FORBIDDEN
```

---

## 18. Schema Validation

MongoDB schema validation is recommended for important collections.

Rules:

```text
MUST define whether validation exists at collection level.
MUST use JSON Schema validation for critical document shape.
MUST align application validator and database validator.
MUST version schema changes.
MUST not rely only on database validation for API error quality.
```

Allowed:

```java
ValidationOptions validationOptions = new ValidationOptions()
        .validator(Filters.jsonSchema(schema));

database.createCollection("users", new CreateCollectionOptions()
        .validationOptions(validationOptions));
```

---

## 19. Change Streams

Change streams are allowed for event-like integration only with strict resume handling.

Rules:

```text
MUST persist resume token for reliable processing.
MUST make downstream consumer idempotent.
MUST handle invalidate events.
MUST handle resume errors.
MUST define fullDocument strategy.
MUST not assume change stream is a complete replacement for domain event/outbox without architecture approval.
```

Allowed:

```java
MongoCursor<ChangeStreamDocument<Document>> cursor = collection.watch()
        .fullDocument(FullDocument.UPDATE_LOOKUP)
        .iterator();

while (cursor.hasNext()) {
    ChangeStreamDocument<Document> change = cursor.next();
    BsonDocument resumeToken = change.getResumeToken();
    processIdempotently(change);
    saveResumeToken(resumeToken);
}
```

Forbidden:

```text
- processing change stream without durable resume token
- assuming exactly-once downstream side effects
- using change stream for authorization-sensitive data fan-out without filtering/redaction
```

---

## 20. GridFS

GridFS is allowed only when MongoDB is intentionally chosen for file storage.

Rules:

```text
MUST define max file size and metadata schema.
MUST scan/validate uploaded content before persistence.
MUST not serve GridFS content without authorization check.
MUST stream data; do not load whole file into memory.
MUST define retention/deletion policy.
```

Prefer object storage such as S3 for large file systems unless MongoDB/GridFS is specifically required.

---

## 21. Sharding and Multi-Tenancy

### 21.1 Sharding Awareness

If collection is or may become sharded, the document model must define shard key strategy.

Rules:

```text
MUST include shard key in hot queries.
MUST avoid monotonic shard keys unless intentionally handled.
MUST avoid jumbo/unbounded partitions.
MUST understand tenant distribution.
```

### 21.2 Multi-Tenant Rule

For multi-tenant collections:

```text
MUST include tenantId in every document.
MUST include tenantId in every user-facing query filter.
MUST include tenantId in unique indexes where uniqueness is tenant-scoped.
MUST include tenantId in update/delete filters.
MUST test cross-tenant access denial.
```

Forbidden:

```java
collection.find(eq("_id", id)); // FORBIDDEN in tenant-scoped app
```

Allowed:

```java
collection.find(and(eq("tenantId", tenantId), eq("_id", id)));
```

---

## 22. Security Rules

### 22.1 Injection Prevention

Forbidden:

```text
- parsing user-provided JSON into Bson directly
- accepting arbitrary operator names from user input
- accepting arbitrary field names for sort/filter/project without allow-list
- exposing aggregation pipeline API directly to untrusted clients
```

Allowed:

```java
private static final Map<String, Bson> SORTS = Map.of(
        "createdAt_desc", Sorts.descending("createdAt", "_id"),
        "createdAt_asc", Sorts.ascending("createdAt", "_id")
);

Bson sort = Optional.ofNullable(SORTS.get(request.sort()))
        .orElseThrow(() -> new InvalidSortException(request.sort()));
```

### 22.2 Secret and PII Handling

Rules:

```text
MUST not log full documents containing PII/secrets.
MUST not log connection strings with credentials.
MUST redact sensitive fields in command logging.
MUST classify collections by sensitivity.
MUST encrypt sensitive fields where required by policy.
```

### 22.3 TLS and Auth

Production connections must use:

```text
- TLS where required by environment/security policy
- proper server certificate validation
- least-privilege database user
- no admin/root credentials in app
- auth mechanism approved by platform/security team
```

Forbidden:

```text
- disabling TLS verification
- using admin database superuser in application
- embedding credentials in image/JAR/source
```

---

## 23. Time, Date, and Number Mapping

### 23.1 Time

Rules:

```text
MUST use Instant for machine timestamps.
MUST use LocalDate only for date-only business values.
MUST preserve timezone semantics at API boundary.
MUST not store local date-time without timezone meaning for audit/event time.
MUST inject Clock for testable now().
```

### 23.2 Decimal and Money

Rules:

```text
MUST use Decimal128 or string/minor-unit integer for exact decimal/money according to project policy.
MUST not use double for money.
MUST define rounding mode.
MUST test BSON/Java conversion precision.
```

### 23.3 Enum

Rules:

```text
MUST store enums as stable string/code values.
MUST not store ordinal.
MUST handle unknown future enum value in readers where forward compatibility matters.
```

---

## 24. Error Handling

### 24.1 Required Mapping

MongoDB exceptions must be mapped to domain/application errors.

Examples:

```text
MongoTimeoutException           -> downstream unavailable / timeout
MongoSocketException            -> downstream connectivity failure
MongoWriteException duplicate   -> duplicate/conflict
MongoCommandException           -> command/index/schema/permission error
MongoBulkWriteException         -> partial batch failure
MongoException transient label  -> retryable if idempotent
```

Forbidden:

```java
catch (Exception e) {
    return null; // FORBIDDEN
}
```

### 24.2 Error Labels

When available, use MongoDB error labels for transaction/retry handling.

Rules:

```text
MUST not retry solely based on error message text.
MUST use exception type/error code/error label.
MUST preserve root cause in logs without leaking sensitive data.
```

---

## 25. Observability

### 25.1 Required Metrics

Track:

```text
- operation latency by collection and operation type
- error count by exception category
- timeout count
- retry count
- pool checkout latency
- pool size/in-use/waiters
- command duration where safe
- bulk item failure count
- change stream lag/resume count
```

### 25.2 Logging

Rules:

```text
MUST log collection name and operation type for failures.
MUST not log full query/filter if it contains PII/secrets.
MUST log correlation ID/request ID.
MUST log duplicate key/conflict as business conflict where appropriate, not always ERROR.
```

### 25.3 Command Listener

Command monitoring is allowed but must be redacted.

Forbidden:

```text
- logging raw command payload in production
- logging credentials or tokens
- high-cardinality metrics from query values
```

---

## 26. Performance Standards

### 26.1 Mandatory Evidence

Performance-sensitive MongoDB change must include evidence:

```text
- query shape
- index used
- explain plan for critical query
- expected result size
- latency target
- volume/cardinality assumptions
- benchmark/load test for hot path
```

### 26.2 Forbidden Performance Patterns

Forbidden:

```text
- unbounded find().into(list)
- loading large collection into memory for filtering
- deep skip pagination on large collection
- sorting without supporting index on hot path
- $lookup as default join strategy
- broad regex query without index strategy
- leading wildcard regex on large collection
- too many indexes on write-heavy collection without review
```

### 26.3 Batch Size

Rules:

```text
MUST set bounded batch size for large iteration.
MUST stream/process cursor instead of materializing huge results.
MUST close cursors when manually owned.
```

Allowed:

```java
try (MongoCursor<Document> cursor = collection.find(filter)
        .batchSize(500)
        .iterator()) {
    while (cursor.hasNext()) {
        process(cursor.next());
    }
}
```

---

## 27. Framework Integration

### 27.1 Spring Data MongoDB

Spring Data MongoDB is allowed only if project already uses Spring and repository abstractions are governed.

Rules:

```text
MUST not expose repository directly from controller.
MUST define collection name explicitly.
MUST avoid derived query explosion for complex queries.
MUST use MongoTemplate for complex query with explicit index reasoning.
MUST test generated/derived queries.
MUST avoid entity-as-API-response.
```

Forbidden:

```text
- blindly adding @Document to domain entity without persistence boundary review
- using repository method names as hidden query language for complex access patterns
- enabling broad auto-index creation in production without migration policy
```

### 27.2 Quarkus / Micronaut / Jakarta

Rules:

```text
MUST use framework-managed lifecycle for MongoClient.
MUST configure health checks carefully; health check must not overload cluster.
MUST define timeout/pool/read/write concern in configuration.
MUST test configuration binding.
```

---

## 28. Testing Standards

### 28.1 Required Tests

MongoDB access code must include:

```text
- mapper/codec serialization test
- repository/DAO integration test
- index-dependent query test when critical
- duplicate key/conflict test
- missing/null/unknown field migration test
- transaction test if transactions are used
- retry/idempotency test if retry is used
- tenant isolation test if multi-tenant
- change stream resume test if change streams are used
```

### 28.2 Testcontainers

Use real MongoDB via Testcontainers for integration tests where possible.

Rules:

```text
MUST not rely only on mocks for query correctness.
MUST not use embedded MongoDB if it does not match production version/features.
MUST pin test MongoDB image version close to production.
```

Example:

```java
@Container
static MongoDBContainer mongo = new MongoDBContainer("mongo:7.0");
```

### 28.3 Mocking Policy

Mocks are allowed for:

```text
- application service tests
- error-path simulation
- timeout/retry orchestration
```

Mocks are not sufficient for:

```text
- BSON mapping correctness
- query/index behavior
- transaction behavior
- change stream behavior
```

---

## 29. Migration and Schema Evolution

### 29.1 Migration Ownership

Schema/data migration must be intentional.

Rules:

```text
MUST define whether migration is lazy-read, background batch, or deployment migration.
MUST be backward-compatible for rolling deploys.
MUST avoid collection-wide updates on hot path.
MUST throttle backfill jobs.
MUST track migration progress.
MUST make migrations idempotent.
```

### 29.2 Rolling Deploy Compatibility

When changing document shape:

```text
Old app version must read old shape.
New app version must read old shape.
New app version should write new shape only when safe.
Old app version must not corrupt new shape during rollback window.
```

### 29.3 Forbidden Migration Practices

Forbidden:

```text
- assuming all documents are same shape
- one-shot unbounded collection update without dry run
- destructive field removal without reader compatibility window
- migration hidden in request path
```

---

## 30. Anti-Patterns

Forbidden or strongly discouraged:

```text
- MongoDB as relational database with excessive cross-collection joins
- one collection per tenant by default
- one database per request/user by default
- storing API request body directly as document
- raw Document passed throughout domain layer
- unbounded embedded arrays
- blind upsert without unique key
- blind replace from DTO
- transaction everywhere
- change stream as fake exactly-once event bus
- no indexes until production is slow
- query by regex as search engine replacement
- storing money as double
- exposing ObjectId as security boundary
- logging raw documents
- parsing user JSON as query
- auto-creating indexes in production app startup without governance
- relying on default timeout/pool settings
- using mocks as proof that Mongo query works
```

---

## 31. LLM Implementation Protocol

Before writing MongoDB code, the LLM must answer:

```text
1. What collection is being accessed?
2. Who owns the collection?
3. Is the collection source-of-truth or read model?
4. What is the document schema/version?
5. What are primary query patterns?
6. What indexes support those queries?
7. What fields are user-controlled?
8. What is the tenant/authorization filter?
9. What read/write concern is required?
10. Is retry safe? What makes it idempotent?
11. Is transaction required? Why is single-document atomicity insufficient?
12. How are errors mapped?
13. How is the code tested against real MongoDB?
```

If these are unknown, the LLM must not invent them silently. It must either ask or choose the safest minimal implementation and mark assumptions.

---

## 32. LLM Prompt Contract

Use this prompt snippet for MongoDB-related implementation:

```text
You are implementing Java + MongoDB code.
Follow strict-coding-standards__java_mongodb.md.
Use official MongoDB Java Driver 5.x unless the project explicitly uses another approved version.
Do not create MongoClient per operation.
Do not parse user-provided JSON into BSON queries.
Do not expose raw Document or persistence model as API DTO.
Every query must have tenant/authorization filter where relevant, bounded result size, deterministic sort, and index rationale.
Every write must define duplicate/conflict handling, retry/idempotency behavior, and error mapping.
Use transactions only when single-document atomicity is insufficient and transaction options are explicit.
Do not use unbounded arrays, unbounded find, deep skip pagination, or blind upsert.
Provide tests using real MongoDB/Testcontainers for mapping and query behavior.
```

---

## 33. Reviewer Checklist

A reviewer must reject MongoDB code if any answer is “no”:

```text
[ ] MongoDB driver version is pinned and compatible with server version.
[ ] MongoClient is reused and lifecycle-managed.
[ ] Timeouts and pool settings are explicit.
[ ] Collection names are centralized and not user-controlled.
[ ] Document model is query-first and has bounded growth.
[ ] Persistent document schema/version is explicit where needed.
[ ] DTO/domain/persistence boundaries are separated.
[ ] User-controlled query fields/operators are allow-listed.
[ ] Every user-facing query includes tenant/authorization constraint where relevant.
[ ] Every production query has an index rationale.
[ ] Pagination is bounded and deterministic.
[ ] Writes are explicit and not blind DTO replacement.
[ ] Upsert has unique/idempotency key where required.
[ ] Duplicate key/conflict errors are handled.
[ ] Retry behavior is idempotency-safe.
[ ] Transactions, if used, are justified and bounded.
[ ] Read/write concern/read preference are intentional.
[ ] Change streams, if used, persist resume token.
[ ] Logs/metrics do not expose sensitive document data.
[ ] Tests run against real MongoDB behavior, not only mocks.
[ ] Migration/rolling deploy compatibility is considered.
```

---

## 34. Source References

Use official references when updating this standard:

- MongoDB Java Sync Driver: https://www.mongodb.com/docs/drivers/java/sync/current/
- MongoDB Reactive Streams Driver: https://www.mongodb.com/docs/languages/java/reactive-streams-driver/current/
- MongoDB Java Driver compatibility: https://www.mongodb.com/docs/drivers/compatibility/
- MongoDB Java Driver release notes: https://www.mongodb.com/docs/drivers/java/sync/current/reference/release-notes/
- MongoDB Java Driver connection pools: https://www.mongodb.com/docs/drivers/java/sync/current/connection/specify-connection-options/connection-pools/
- MongoDB read concern: https://www.mongodb.com/docs/manual/reference/read-concern/
- MongoDB write concern: https://www.mongodb.com/docs/manual/reference/write-concern/
- MongoDB transactions: https://www.mongodb.com/docs/manual/core/transactions/
- MongoDB change streams: https://www.mongodb.com/docs/manual/changestreams/
- MongoDB Java change streams: https://www.mongodb.com/docs/drivers/java/sync/current/logging-monitoring/change-streams/
- MongoDB monitoring with Java driver: https://www.mongodb.com/docs/drivers/java/sync/current/logging-monitoring/monitoring/
