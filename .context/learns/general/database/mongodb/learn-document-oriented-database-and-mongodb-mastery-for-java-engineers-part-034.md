# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-034.md

# Part 034 — Capstone II: Production-Grade Java Implementation Blueprint

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 034 dari 035  
> Fokus: blueprint implementasi Java/Spring Boot untuk regulatory case management platform berbasis MongoDB: module/package structure, configuration, repository, transaction, idempotency, outbox, projection worker, migration runner, tests, observability, deployment, and runbooks  
> Target pembaca: Java software engineer / tech lead yang ingin melihat bagaimana desain MongoDB production-grade diterjemahkan menjadi kode dan workflow engineering yang konkret

---

## 0. Posisi Part Ini Dalam Seri

Part 033 mendesain arsitektur platform regulatory case management. Part 034 menerjemahkannya ke blueprint implementasi Java/Spring Boot.

Kita tidak akan membuat satu aplikasi lengkap ribuan file. Yang kita buat adalah blueprint:

```text
struktur modul
kontrak repository
document model
domain model
transaction boundary
idempotency service
outbox publisher
projection worker
migration runner
test strategy
observability hooks
deployment/runbook skeleton
```

Tujuannya agar kamu bisa mengembangkan sendiri implementasi production-grade tanpa jatuh ke pola:

```text
Controller -> MongoRepository.save(entity) -> selesai
```

Kalimat inti:

> Production-grade implementation is where architecture either becomes enforceable or becomes documentation only.

---

## 1. Implementation Principles

Blueprint ini mengikuti prinsip:

1. Domain model tidak bergantung pada MongoDB driver.
2. Persistence document terpisah dari API DTO.
3. Semua tenant-owned repository method membutuhkan `TenantId`.
4. Command write memakai idempotency key.
5. State transition memakai guarded update.
6. Audit dan outbox ditulis atomik dengan state change.
7. External side effects tidak dilakukan di transaction.
8. Derived projections punya source version dan rebuild path.
9. Migrations idempotent dan checkpointed.
10. Observability memakai operation names, bukan generic `find`.
11. Tests memakai real MongoDB untuk query/update/transaction semantics.
12. Security/authorization filter tidak boleh optional.

---

## 2. Suggested Project Structure

Untuk modular monolith Spring Boot:

```text
src/main/java/com/acme/caseplatform
  CasePlatformApplication.java

  common/
    tenant/
    security/
    time/
    observability/
    mongo/
    idempotency/
    outbox/
    errors/

  casecommand/
    api/
    application/
    domain/
    infrastructure/mongo/
    infrastructure/outbox/

  casequery/
    api/
    application/
    infrastructure/mongo/

  casedocument/
    api/
    application/
    domain/
    infrastructure/mongo/
    infrastructure/storage/

  casesearch/
    api/
    application/
    infrastructure/mongo/
    infrastructure/search/

  retention/
    application/
    infrastructure/mongo/

  supportaccess/
    application/
    infrastructure/mongo/

  migration/
    application/
    infrastructure/mongo/
```

Jika menjadi microservices, modul-modul ini bisa dipisah menjadi deployables. Tetapi boundary tetap sama.

---

## 3. Common Value Objects

Gunakan value object agar tidak semua hal menjadi `String`.

```java
public record TenantId(String value) {
    public TenantId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("tenantId is required");
        }
    }
}

public record CaseId(String value) {
    public CaseId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("caseId is required");
        }
    }
}

public record CommandId(String value) {
    public CommandId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("commandId is required");
        }
    }
}

public record UserId(String value) {}
public record TeamId(String value) {}
```

Benefit:

- method signature lebih jelas,
- tenantId tidak tertukar dengan caseId,
- repository contract explicit.

---

## 4. Request Context

Context dari authentication/authorization.

```java
public record RequestContext(
    TenantId tenantId,
    UserId userId,
    Set<TeamId> teamIds,
    Set<String> roleCodes,
    SensitivityClearance clearance,
    String correlationId,
    Instant requestTime
) {
    public boolean hasRole(String role) {
        return roleCodes.contains(role);
    }
}
```

Context harus masuk ke application service, bukan dicari global sembarangan di repository.

---

## 5. Domain Model: Case

Domain model tidak harus sama persis dengan document.

```java
public final class CaseAggregate {
    private final TenantId tenantId;
    private final CaseId caseId;
    private final CaseStatus status;
    private final long version;
    private final UserId ownerUserId;
    private final TeamId ownerTeamId;
    private final CaseAccess access;

    public CaseTransitionResult escalate(EscalateCaseCommand command, RequestContext ctx) {
        if (status != CaseStatus.UNDER_REVIEW) {
            throw new InvalidCaseStateException("Case must be UNDER_REVIEW to escalate");
        }

        if (!access.canEscalate(ctx)) {
            throw new ForbiddenOperationException("User cannot escalate this case");
        }

        if (command.reason().isBlank()) {
            throw new ValidationException("Escalation reason is required");
        }

        return new CaseTransitionResult(
            CaseStatus.ESCALATED,
            version + 1,
            CaseAuditEvent.escalated(this, command, ctx),
            DomainEvent.caseEscalated(this, command, ctx)
        );
    }
}
```

Domain method menghasilkan:

- new status/version,
- audit event,
- domain event/outbox payload.

Persistence tetap dilakukan application service.

---

## 6. Command DTO

API request:

```java
public record EscalateCaseRequest(
    String commandId,
    long expectedVersion,
    String reason
) {}
```

Application command:

```java
public record EscalateCaseCommand(
    TenantId tenantId,
    CaseId caseId,
    CommandId commandId,
    long expectedVersion,
    String reason
) {}
```

Controller mengubah API DTO ke command.

---

## 7. Controller

Controller tipis.

```java
@RestController
@RequestMapping("/cases")
final class CaseCommandController {

    private final CaseCommandService service;
    private final RequestContextFactory contextFactory;

    @PostMapping("/{caseId}/escalate")
    ResponseEntity<CaseCommandResponse> escalate(
        @PathVariable String caseId,
        @RequestBody EscalateCaseRequest request,
        Authentication authentication
    ) {
        RequestContext ctx = contextFactory.from(authentication);

        EscalateCaseCommand command = new EscalateCaseCommand(
            ctx.tenantId(),
            new CaseId(caseId),
            new CommandId(request.commandId()),
            request.expectedVersion(),
            request.reason()
        );

        CaseCommandResponse response = service.escalate(command, ctx);
        return ResponseEntity.ok(response);
    }
}
```

Controller tidak tahu MongoDB.

---

## 8. Mongo Document Model

Persistence document:

```java
@Document("cases")
public class CaseDocument {
    @Id
    private String id;

    private String tenantId;
    private String caseId;
    private String caseNumber;
    private int schemaVersion;

    private String status;
    private String priority;
    private String productCode;
    private String jurisdiction;
    private String region;

    private String title;
    private String summary;

    private String ownerUserId;
    private String ownerTeamId;

    private CaseAccessDocument access;
    private CaseLifecycleDocument lifecycle;
    private CaseRetentionDocument retention;

    private long version;
    private Instant createdAt;
    private Instant updatedAt;

    // getters/setters omitted
}
```

Document class boleh mutable untuk mapping. Domain class bisa immutable.

---

## 9. Mapper / Adapter

```java
final class CaseDocumentMapper {

    CaseAggregate toAggregate(CaseDocument doc) {
        if (doc == null) {
            throw new IllegalArgumentException("doc is null");
        }

        return new CaseAggregate(
            new TenantId(doc.getTenantId()),
            new CaseId(doc.getCaseId()),
            CaseStatus.parse(doc.getStatus()),
            doc.getVersion(),
            new UserId(doc.getOwnerUserId()),
            new TeamId(doc.getOwnerTeamId()),
            toAccess(doc.getAccess())
        );
    }

    CaseDocument fromCreateCommand(CreateCaseCommand command, RequestContext ctx, Instant now) {
        CaseDocument doc = new CaseDocument();
        doc.setId(command.tenantId().value() + ":" + command.caseId().value());
        doc.setTenantId(command.tenantId().value());
        doc.setCaseId(command.caseId().value());
        doc.setSchemaVersion(1);
        doc.setStatus(CaseStatus.DRAFT.name());
        doc.setVersion(1);
        doc.setCreatedAt(now);
        doc.setUpdatedAt(now);
        return doc;
    }
}
```

Adapter juga tempat schema compatibility fallback.

---

## 10. Mongo Configuration

```java
@Configuration
class MongoConfig {

    @Bean
    MongoClientSettingsBuilderCustomizer mongoClientSettingsCustomizer(
        MongoObservationCommandListener commandListener
    ) {
        return builder -> builder
            .applicationName("case-platform")
            .addCommandListener(commandListener)
            .applyToSocketSettings(s -> s
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(10, TimeUnit.SECONDS)
            )
            .applyToClusterSettings(c -> c
                .serverSelectionTimeout(5, TimeUnit.SECONDS)
            );
    }
}
```

Production:

- URI from secret manager,
- TLS enabled,
- no invalid certs,
- least-privileged DB user,
- appName set,
- timeouts set,
- command monitoring sanitized.

---

## 11. Index Initialization Strategy

Do not blindly rely on auto-index creation in production.

Recommended:

```text
dev/test:
  auto-create indexes okay

prod:
  migration-managed indexes
  reviewed before deployment
  observed during build
```

Index definitions can live as migration definitions:

```java
final class CaseIndexesMigration implements MongoMigration {
    public void apply(MongoDatabase db) {
        db.getCollection("cases").createIndex(
            Indexes.compoundIndex(
                Indexes.ascending("tenantId"),
                Indexes.ascending("caseId")
            ),
            new IndexOptions().unique(true).name("uniq_tenant_case")
        );
    }
}
```

---

## 12. Repository Contract

```java
public interface CaseRepository {
    Optional<CaseAggregate> findForCommand(TenantId tenantId, CaseId caseId);

    TransitionWriteResult transitionStatus(
        ClientSession session,
        TenantId tenantId,
        CaseId caseId,
        CaseStatus expectedStatus,
        long expectedVersion,
        CaseStatus newStatus,
        Instant now
    );
}
```

No tenantless method.

---

## 13. Repository Implementation With MongoTemplate

```java
@Repository
final class MongoCaseRepository implements CaseRepository {

    private final MongoTemplate mongoTemplate;
    private final CaseDocumentMapper mapper;

    @Override
    public Optional<CaseAggregate> findForCommand(TenantId tenantId, CaseId caseId) {
        Query query = Query.query(Criteria.where("tenantId").is(tenantId.value())
            .and("caseId").is(caseId.value()));

        return Optional.ofNullable(mongoTemplate.findOne(query, CaseDocument.class))
            .map(mapper::toAggregate);
    }

    @Override
    public TransitionWriteResult transitionStatus(
        ClientSession session,
        TenantId tenantId,
        CaseId caseId,
        CaseStatus expectedStatus,
        long expectedVersion,
        CaseStatus newStatus,
        Instant now
    ) {
        MongoCollection<Document> collection =
            mongoTemplate.getCollection("cases").withCodecRegistry(mongoTemplate.getDb().getCodecRegistry());

        Bson filter = Filters.and(
            Filters.eq("tenantId", tenantId.value()),
            Filters.eq("caseId", caseId.value()),
            Filters.eq("status", expectedStatus.name()),
            Filters.eq("version", expectedVersion)
        );

        Bson update = Updates.combine(
            Updates.set("status", newStatus.name()),
            Updates.set("updatedAt", Date.from(now)),
            Updates.inc("version", 1)
        );

        UpdateResult result = collection.updateOne(session, filter, update);

        return new TransitionWriteResult(
            result.getMatchedCount(),
            result.getModifiedCount(),
            expectedVersion + 1
        );
    }
}
```

Using driver collection inside repository is acceptable for precise control.

---

## 14. Transition Result Mapping

```java
public record TransitionWriteResult(
    long matchedCount,
    long modifiedCount,
    long newVersion
) {
    public boolean success() {
        return matchedCount == 1 && modifiedCount == 1;
    }
}
```

Application service interprets:

```text
success -> continue
matched 0 -> conflict/not found/invalid state
modified 0 -> idempotent? no-op? investigate based on command semantics
```

Never ignore update result.

---

## 15. Audit Repository

```java
public interface AuditEventRepository {
    void insert(ClientSession session, CaseAuditEvent event);
}
```

Implementation:

```java
@Repository
final class MongoAuditEventRepository implements AuditEventRepository {

    private final MongoTemplate mongoTemplate;

    @Override
    public void insert(ClientSession session, CaseAuditEvent event) {
        Document doc = new Document()
            .append("_id", event.id())
            .append("tenantId", event.tenantId().value())
            .append("caseId", event.caseId().value())
            .append("eventType", event.eventType())
            .append("versionAfter", event.versionAfter())
            .append("sequence", event.sequence())
            .append("reason", event.reason())
            .append("commandId", event.commandId().value())
            .append("occurredAt", Date.from(event.occurredAt()))
            .append("recordedAt", Date.from(event.recordedAt()));

        mongoTemplate.getCollection("case_audit_events")
            .insertOne(session, doc);
    }
}
```

Use deterministic `_id`:

```text
tenantId + caseId + versionAfter
```

This helps idempotency/retry.

---

## 16. Outbox Repository

```java
public interface OutboxRepository {
    void insert(ClientSession session, OutboxEvent event);
}
```

Document:

```java
public record OutboxEvent(
    String id,
    TenantId tenantId,
    String aggregateType,
    String aggregateId,
    String eventType,
    int schemaVersion,
    Document payload,
    Instant occurredAt
) {}
```

Insert:

```java
db.getCollection("outbox_events").insertOne(session,
    new Document("_id", event.id())
        .append("tenantId", event.tenantId().value())
        .append("aggregateType", event.aggregateType())
        .append("aggregateId", event.aggregateId())
        .append("eventType", event.eventType())
        .append("schemaVersion", event.schemaVersion())
        .append("payload", event.payload())
        .append("occurredAt", Date.from(event.occurredAt()))
        .append("status", "PENDING")
        .append("availableAt", new Date())
        .append("attempts", 0)
);
```

Outbox insert is inside command transaction.

---

## 17. Idempotency Service

API command idempotency.

```java
public interface IdempotencyService {
    IdempotencyStartResult start(ClientSession session, TenantId tenantId, CommandId commandId, String operation, String requestHash);
    void complete(ClientSession session, TenantId tenantId, CommandId commandId, Document responseSnapshot);
}
```

Start semantics:

```text
if no record:
  insert PENDING and continue

if same commandId + same requestHash + COMPLETED:
  return stored response

if same commandId + different requestHash:
  reject as conflict

if PENDING stale:
  decide retry/recover policy
```

Implementation uses unique `_id`.

---

## 18. Command Service Transaction

```java
@Service
final class CaseCommandService {

    private final MongoClient mongoClient;
    private final MongoTransactionManager txManager;
    private final CaseRepository caseRepository;
    private final AuditEventRepository auditRepository;
    private final OutboxRepository outboxRepository;
    private final IdempotencyService idempotencyService;
    private final Clock clock;

    public CaseCommandResponse escalate(EscalateCaseCommand command, RequestContext ctx) {
        return executeInTransaction(session -> {
            String requestHash = hash(command);

            IdempotencyStartResult idem = idempotencyService.start(
                session, command.tenantId(), command.commandId(), "ESCALATE_CASE", requestHash
            );

            if (idem.completed()) {
                return CaseCommandResponse.fromSnapshot(idem.responseSnapshot());
            }

            CaseAggregate aggregate = caseRepository.findForCommand(command.tenantId(), command.caseId())
                .orElseThrow(() -> new NotFoundException("case not found"));

            CaseTransitionResult transition = aggregate.escalate(command, ctx);

            TransitionWriteResult write = caseRepository.transitionStatus(
                session,
                command.tenantId(),
                command.caseId(),
                CaseStatus.UNDER_REVIEW,
                command.expectedVersion(),
                transition.newStatus(),
                clock.instant()
            );

            if (!write.success()) {
                throw new ConflictException("case state/version changed");
            }

            auditRepository.insert(session, transition.auditEvent());
            outboxRepository.insert(session, transition.outboxEvent());

            CaseCommandResponse response = new CaseCommandResponse(
                command.caseId().value(),
                transition.newStatus().name(),
                transition.newVersion()
            );

            idempotencyService.complete(session, command.tenantId(), command.commandId(), response.toDocument());

            return response;
        });
    }
}
```

Implementation detail: use Spring transaction abstraction or driver `ClientSession.withTransaction`. Ensure all repositories participate in same session.

---

## 19. Transaction Helper

```java
@Component
final class MongoTransactionalExecutor {

    private final MongoClient mongoClient;

    <T> T execute(Function<ClientSession, T> callback) {
        try (ClientSession session = mongoClient.startSession()) {
            return session.withTransaction(() -> callback.apply(session));
        }
    }
}
```

Production helper should handle:

- transient transaction retry,
- unknown commit result,
- deadline,
- metrics,
- error mapping,
- idempotency reconciliation.

Do not retry non-idempotent command without idempotency.

---

## 20. Error Mapping

Map persistence errors to domain/API errors.

```java
@ControllerAdvice
final class ApiExceptionHandler {

    @ExceptionHandler(DuplicateKeyException.class)
    ResponseEntity<ErrorResponse> duplicate(DuplicateKeyException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(new ErrorResponse("CONFLICT", "Duplicate resource"));
    }

    @ExceptionHandler(ConflictException.class)
    ResponseEntity<ErrorResponse> conflict(ConflictException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(new ErrorResponse("CONFLICT", ex.getMessage()));
    }

    @ExceptionHandler(ForbiddenOperationException.class)
    ResponseEntity<ErrorResponse> forbidden(ForbiddenOperationException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
            .body(new ErrorResponse("FORBIDDEN", "Not allowed"));
    }
}
```

Do not return raw MongoDB exception details to clients.

---

## 21. Query Service

Worklist query.

```java
public record WorklistQuery(
    TenantId tenantId,
    UserId userId,
    Set<TeamId> teamIds,
    Set<CaseStatus> statuses,
    Instant dueBefore,
    Cursor cursor,
    int limit
) {}
```

Repository:

```java
public interface WorklistRepository {
    Page<WorklistItemDto> findWorklist(RequestContext ctx, WorklistQuery query);
}
```

Implementation:

```java
Criteria criteria = Criteria.where("tenantId").is(ctx.tenantId().value())
    .and("status").in(statuses)
    .and("dueAt").lte(query.dueBefore());

criteria.orOperator(
    Criteria.where("assigneeId").is(ctx.userId().value()),
    Criteria.where("teamId").in(ctx.teamIds().stream().map(TeamId::value).toList())
);

Query mongoQuery = Query.query(criteria)
    .with(Sort.by(Sort.Direction.ASC, "dueAt").and(Sort.by("_id")))
    .limit(Math.min(query.limit(), 50));

mongoQuery.fields()
    .include("caseId")
    .include("caseNumber")
    .include("title")
    .include("status")
    .include("priority")
    .include("dueAt")
    .include("sourceVersion");
```

Limit enforced server side.

---

## 22. Authorization Criteria Builder

Centralize query authorization.

```java
@Component
final class CaseAuthorizationCriteriaBuilder {

    Criteria visibleCases(RequestContext ctx) {
        List<String> teamIds = ctx.teamIds().stream().map(TeamId::value).toList();

        Criteria teamAccess = Criteria.where("access.owningTeamId").in(teamIds);
        Criteria roleAccess = Criteria.where("access.allowedRoleCodes").in(ctx.roleCodes());

        Criteria sensitivity = Criteria.where("access.sensitivity")
            .in(ctx.clearance().allowedSensitivityCodes());

        return new Criteria().andOperator(
            Criteria.where("tenantId").is(ctx.tenantId().value()),
            new Criteria().orOperator(teamAccess, roleAccess),
            sensitivity
        );
    }
}
```

Every query/search uses this builder or equivalent.

---

## 23. Search Service

Search request:

```java
public record CaseSearchRequest(
    String query,
    SearchMode mode,
    Set<CaseStatus> statuses,
    Set<String> jurisdictions,
    int limit,
    String cursor
) {}
```

Search service builds:

```text
tenant filter
authorization filter
search operator
facets
projection
limit
```

If using Atlas Search via aggregation:

```java
List<Document> pipeline = List.of(
    new Document("$search", searchStage),
    new Document("$match", authorizationMatch),
    new Document("$limit", safeLimit),
    new Document("$project", projection)
);
```

Keep raw document pipeline inside infrastructure class and cover with tests.

Detail endpoint must re-read source `cases` and recheck authorization.

---

## 24. Projection Worker

Projection worker consumes outbox event or change stream.

```java
@Component
final class WorklistProjectionWorker {

    public void handle(CaseEscalatedEvent event) {
        CaseDocument source = caseRepository.findDocument(event.tenantId(), event.caseId())
            .orElseThrow();

        WorklistItemDocument projection = WorklistItemDocument.from(source);

        worklistProjectionRepository.upsertIfNewer(
            projection,
            source.getVersion()
        );
    }
}
```

Upsert with version guard:

```javascript
db.case_worklist_items.updateOne(
  {
    _id: projectionId,
    $or: [
      { sourceVersion: { $lt: eventVersion } },
      { sourceVersion: { $exists: false } }
    ]
  },
  { $set: projection },
  { upsert: true }
)
```

Duplicate/stale event safe.

---

## 25. Projection Rebuild

Rebuild command:

```text
rebuild worklist for tenant-a
```

Flow:

```text
scan cases for tenant
compute projection
bulk upsert
mark missing old projections removed
record rebuild state
```

State:

```javascript
{
  _id: "rebuild:worklist:tenant-a:20260621",
  tenantId: "tenant-a",
  projection: "case_worklist_items",
  status: "RUNNING",
  scanned: 100000,
  upserted: 99000,
  removed: 1000,
  checkpoint: {...},
  startedAt: ISODate(...),
  updatedAt: ISODate(...)
}
```

Projection must not be impossible to rebuild.

---

## 26. Outbox Publisher

Claim event:

```java
Optional<OutboxRecord> claim(String workerId, Instant now) {
    Query query = Query.query(new Criteria().andOperator(
        Criteria.where("status").is("PENDING"),
        Criteria.where("availableAt").lte(now),
        new Criteria().orOperator(
            Criteria.where("leaseUntil").exists(false),
            Criteria.where("leaseUntil").lt(now)
        )
    ));

    Update update = new Update()
        .set("status", "PROCESSING")
        .set("leaseOwner", workerId)
        .set("leaseUntil", now.plusSeconds(30))
        .inc("attempts", 1)
        .set("updatedAt", now);

    return Optional.ofNullable(mongoTemplate.findAndModify(
        query.with(Sort.by("availableAt").ascending()),
        update,
        FindAndModifyOptions.options().returnNew(true),
        OutboxRecord.class
    ));
}
```

After publish success:

```text
mark DISPATCHED with dispatchedAt
```

On failure:

```text
status PENDING
availableAt = now + backoff
lastError sanitized
```

After max attempts:

```text
DEAD_LETTER
alert
```

---

## 27. Inbox Consumer

```java
public void consume(EventMessage message) {
    transactional.execute(session -> {
        boolean firstTime = inboxRepository.tryInsert(session, message.eventId(), message.source());

        if (!firstTime) {
            return;
        }

        handleBusinessUpdate(session, message);
        inboxRepository.markProcessed(session, message.eventId());
    });
}
```

Inbox collection:

```javascript
{
  _id: "case-service:event-123",
  eventId: "event-123",
  source: "case-service",
  status: "PROCESSED",
  receivedAt: ISODate(...),
  processedAt: ISODate(...)
}
```

---

## 28. Migration Runner

Migration interface:

```java
public interface MongoMigration {
    String id();
    void dryRun(MigrationContext ctx);
    MigrationBatchResult processBatch(MigrationContext ctx, MigrationCheckpoint checkpoint);
    boolean isComplete(MigrationContext ctx);
}
```

Runner:

```java
while (!migration.isComplete(ctx)) {
    MigrationState state = stateRepository.load(migration.id(), tenantId);

    MigrationBatchResult result = migration.processBatch(ctx, state.checkpoint());

    stateRepository.updateProgress(
        migration.id(),
        tenantId,
        result.nextCheckpoint(),
        result.scanned(),
        result.modified(),
        result.failed()
    );

    rateLimiter.sleepIfNeeded();
}
```

Requirements:

- idempotent,
- checkpointed,
- tenant-scoped,
- pauseable,
- observable,
- dry-run capable.

---

## 29. Example Migration: `assigneeId` to `ownerUserId`

Batch query:

```javascript
{
  tenantId: "tenant-a",
  _id: { $gt: checkpoint.lastId },
  ownerUserId: { $exists: false },
  assigneeId: { $exists: true }
}
```

Update:

```javascript
[
  {
    $set: {
      ownerUserId: "$assigneeId",
      schemaVersion: 2,
      updatedAt: "$$NOW"
    }
  }
]
```

Validation:

```javascript
db.cases.countDocuments({
  tenantId: "tenant-a",
  assigneeId: { $exists: true },
  ownerUserId: { $exists: false }
})
```

Reader fallback remains until contract phase.

---

## 30. Observability Instrumentation

Wrap repository operations.

```java
<T> T observeMongoOperation(String operationName, Supplier<T> supplier) {
    Timer.Sample sample = Timer.start(meterRegistry);
    try {
        T result = supplier.get();
        sample.stop(timer(operationName, "success"));
        return result;
    } catch (RuntimeException e) {
        sample.stop(timer(operationName, "error"));
        counter(operationName, e.getClass().getSimpleName()).increment();
        throw e;
    }
}
```

Operation names:

```text
case.command.transition
case.query.detail
case.query.worklist
case.audit.insert
outbox.claim
outbox.markDispatched
projection.worklist.upsert
migration.caseOwnerV2.batch
```

Do not only rely on Mongo command name.

---

## 31. Command Monitoring Sanitization

Command listener should not log raw commands.

```java
class MongoObservationCommandListener implements CommandListener {

    @Override
    public void commandSucceeded(CommandSucceededEvent event) {
        metrics.timer("mongodb.command.duration",
            "command", event.getCommandName(),
            "database", event.getDatabaseName()
        ).record(event.getElapsedTime(TimeUnit.MILLISECONDS), TimeUnit.MILLISECONDS);
    }

    @Override
    public void commandFailed(CommandFailedEvent event) {
        metrics.counter("mongodb.command.failure",
            "command", event.getCommandName(),
            "error", event.getThrowable().getClass().getSimpleName()
        ).increment();
    }
}
```

Avoid logging `event.getCommand()` in production.

---

## 32. Health Checks

Health endpoints:

```text
liveness:
  app process alive

readiness:
  can connect to MongoDB
  can perform lightweight ping
  required dependencies reachable
```

Do not make readiness run heavy query.

Separate deep health check:

```text
check indexes
check outbox lag
check projection lag
check migration status
```

Deep health may be dashboard, not Kubernetes readiness.

---

## 33. Testing Blueprint

Test packages:

```text
src/test/java
  unit/
  integration/
  contract/
  migration/
  performance/
```

Integration uses Testcontainers MongoDB.

Unit:

- state machine,
- authorization criteria,
- mapper old/new docs,
- retention policy.

Integration:

- repository query/update,
- unique index,
- transaction rollback,
- audit/outbox atomicity,
- tenant isolation.

Contract:

- outbox event JSON,
- API response,
- golden document fixtures.

Migration:

- idempotency,
- checkpoint,
- mixed schema.

Failure:

- duplicate commandId,
- optimistic conflict,
- transient retry.

---

## 34. Example Integration Test

```java
@Testcontainers
@SpringBootTest
class EscalateCaseIntegrationTest {

    @Container
    static MongoDBContainer mongo = new MongoDBContainer("mongo:7.0");

    @DynamicPropertySource
    static void mongoProps(DynamicPropertyRegistry registry) {
        registry.add("spring.data.mongodb.uri", mongo::getReplicaSetUrl);
    }

    @Autowired CaseCommandService service;
    @Autowired MongoTemplate mongoTemplate;

    @Test
    void escalate_updatesCase_insertsAudit_andOutbox_atomically() {
        seedUnderReviewCase("tenant-a", "case-1", 17);

        CaseCommandResponse response = service.escalate(
            new EscalateCaseCommand(
                new TenantId("tenant-a"),
                new CaseId("case-1"),
                new CommandId("cmd-1"),
                17,
                "SLA breach"
            ),
            investigatorContext("tenant-a")
        );

        assertThat(response.status()).isEqualTo("ESCALATED");

        assertCaseStatus("tenant-a", "case-1", "ESCALATED", 18);
        assertAuditEventExists("tenant-a", "case-1", 18);
        assertOutboxEventExists("tenant-a:case-1:CaseEscalated:v18");
    }
}
```

Use real MongoDB for transaction semantics.

---

## 35. Example Idempotency Test

```java
@Test
void sameCommandId_returnsSameResult_andDoesNotDuplicateAuditOutbox() {
    seedUnderReviewCase("tenant-a", "case-1", 17);

    EscalateCaseCommand command = new EscalateCaseCommand(
        new TenantId("tenant-a"),
        new CaseId("case-1"),
        new CommandId("cmd-1"),
        17,
        "SLA breach"
    );

    CaseCommandResponse first = service.escalate(command, ctx);
    CaseCommandResponse second = service.escalate(command, ctx);

    assertThat(second).isEqualTo(first);
    assertAuditCount("tenant-a", "case-1", "CASE_ESCALATED").isEqualTo(1);
    assertOutboxCount("tenant-a", "case-1", "CaseEscalated").isEqualTo(1);
}
```

---

## 36. Deployment Blueprint

Deployment steps for app release:

```text
1. Deploy backward-compatible code if schema changes.
2. Apply new indexes/migrations expand phase.
3. Canary tenant/app instances.
4. Monitor operation metrics.
5. Run backfill if needed.
6. Validate data quality.
7. Switch feature flag/read path.
8. Continue fallback window.
9. Contract old fields/indexes/code later.
```

For normal release:

```text
run tests
build image
deploy canary
monitor p95/p99/errors/outbox/projection
rollout
post-deploy slow query review
```

---

## 37. Runtime Configuration

Example:

```yaml
case-platform:
  workers:
    outbox:
      enabled: true
      max-concurrency: 4
    retention:
      enabled: false
    search-projection:
      enabled: true

  mongo:
    operation-timeout-ms: 10000
    max-page-size: 50

  idempotency:
    ttl-days: 7
```

DR safe mode overrides:

```text
OUTBOX_WORKER_ENABLED=false
RETENTION_WORKER_ENABLED=false
MIGRATION_RUNNER_ENABLED=false
```

---

## 38. Runbook: Case Transition Latency

Symptoms:

```text
case.command.transition p95 high
```

Check:

```text
Mongo command duration
pool checkout duration
transaction retry count
audit insert latency
outbox insert latency
duplicate key/conflict rate
DB CPU/disk
recent deploy/migration
```

Actions:

```text
pause background jobs
inspect slow query/profiler
check indexes
check tenant spike
scale app only if DB not bottleneck
```

---

## 39. Runbook: Outbox Lag

Symptoms:

```text
oldest pending outbox age > 30s
```

Check:

```text
publisher running
broker reachable
dead-letter count
claim query latency
lease stuck
event type causing failures
```

Actions:

```text
restart publisher if safe
pause failing event type if needed
increase workers if broker/DB healthy
dead-letter poison event
replay after fix
```

---

## 40. Runbook: Projection Lag

Symptoms:

```text
search/worklist/dashboard stale
```

Check:

```text
outbox lag
projection worker errors
dead letters
source event volume
projection write latency
schema change
```

Actions:

```text
scale workers
pause noncritical projection
run tenant-scoped rebuild
disable unsafe search if security issue
```

---

## 41. Runbook: Migration

Before:

```text
dry run
approval
backup check
canary tenant
dashboard ready
rate limits set
rollback plan
```

During:

```text
monitor progress
monitor app p99
monitor replication lag
pause if threshold exceeded
```

After:

```text
validate counts
check fallback metrics
record completion
schedule contract phase
```

---

## 42. Runbook: Restore Safe Startup

After restore:

```text
1. Start app with workers disabled.
2. Verify Mongo connectivity.
3. Run smoke tests.
4. Verify schema/migration state.
5. Reconcile legal hold/retention.
6. Reconcile outbox.
7. Flush caches.
8. Rebuild projections/search if needed.
9. Enable workers gradually.
10. Record restore epoch.
```

---

## 43. Production Readiness Checklist

```text
[ ] tenant-aware repository APIs
[ ] guarded state transitions
[ ] idempotency for commands
[ ] audit/outbox atomicity
[ ] least privilege DB users
[ ] indexes migration-managed
[ ] no raw query/document logs
[ ] operation metrics
[ ] command/pool monitoring
[ ] outbox lag dashboard
[ ] projection rebuild tool
[ ] migration runner idempotent
[ ] integration tests with MongoDB
[ ] transaction tests on replica set
[ ] backup/restore drill
[ ] DR safe mode config
[ ] runbooks
```

---

## 44. Common Implementation Trade-Offs

### MongoRepository vs MongoTemplate vs Driver

```text
MongoRepository:
  simple CRUD, less control

MongoTemplate:
  good Spring integration, query/update control

Driver:
  precise control for session/transaction/bulk/advanced commands
```

Use abstraction appropriate to operation. It is okay to mix.

### Transactions vs Atomic Update

```text
single document only:
  atomic update often enough

case + audit + outbox:
  transaction useful

external side effect:
  outbox, not transaction
```

### Projection Update Source

```text
command handler:
  fresher but coupled

outbox/change stream:
  decoupled but lag

rebuild:
  recovery capability
```

---

## 45. Practical Exercise

Implement `CloseCase` using this blueprint.

Requirements:

```text
- only DECIDED case can be CLOSED
- user must have SUPERVISOR role
- command requires reason
- update case closedAt
- insert audit
- insert CaseClosed outbox
- update/create retention record
- idempotent by commandId
- no duplicate notification on retry
```

Design:

1. command DTO,
2. domain method,
3. repository guarded update,
4. transaction service,
5. audit event,
6. outbox event,
7. retention repository update,
8. idempotency test,
9. integration test,
10. projection update.

Expected guarded filter:

```javascript
{
  tenantId,
  caseId,
  status: "DECIDED",
  version: expectedVersion
}
```

Update:

```javascript
{
  $set: {
    status: "CLOSED",
    "lifecycle.closedAt": now,
    updatedAt: now
  },
  $inc: { version: 1 }
}
```

---

## 46. Senior-Level Heuristics

```text
If domain code imports MongoDB Document everywhere, boundaries are leaking.

If repository method lacks tenantId, it is unsafe by default.

If command has no commandId, retries are dangerous.

If transition update does not check status/version, concurrency is weak.

If audit/outbox can diverge from state, recovery will be painful.

If projection worker cannot rebuild, it is not production-grade.

If migration cannot pause, it is risky.

If logs include raw documents, security posture is weak.

If tests mock all repositories, MongoDB semantics are untested.

If workers cannot be disabled after restore, DR is dangerous.
```

---

## 47. Summary

Production-grade implementation makes architecture enforceable.

Key lessons:

1. Separate API DTO, domain model, and persistence document.
2. Use value objects for tenant, case, command IDs.
3. Repository APIs must require tenant context.
4. State transitions should use guarded atomic updates.
5. Command idempotency is mandatory for retry-safe APIs.
6. Audit and outbox should be written atomically with critical state changes.
7. External side effects belong in outbox workers.
8. Projection workers must be idempotent and version-aware.
9. Projection rebuilds are production tools, not optional scripts.
10. Migration runner must be idempotent, checkpointed, tenant-scoped, and observable.
11. Operation-level metrics and sanitized command monitoring are required.
12. Integration tests need real MongoDB and replica set semantics for transactions.
13. Deployment must respect expand-contract and canary rollout.
14. DR needs safe worker startup.
15. Production readiness is a checklist across code, data, ops, security, and tests.

The most important sentence:

> A MongoDB Java system becomes production-grade when every critical invariant is enforced in code, verified by tests, observable in production, and recoverable through runbooks.

---

## 48. Bridge to Part 035

Part 035 is the final mastery review:

- decision heuristics,
- checklist library,
- interview/architecture readiness,
- trade-off map,
- smell detector,
- production review template,
- study roadmap after this series,
- final summary of mental models.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-035.md
```

Judul berikutnya:

```text
Part 035 — Mastery Review: Heuristics, Checklists, Trade-Offs, and Interview/Architecture Readiness
```

---

## 49. Status Seri

Selesai sampai bagian ini:

```text
Part 000 — Orientation: Why Document Database Exists, and When It Is the Wrong Tool
Part 001 — Document Database Mental Model: Aggregate, Boundary, Locality, and Shape
Part 002 — BSON, JSON, Document Structure, and Type Semantics
Part 003 — MongoDB Core Architecture: Database, Collection, Document, Replica Set, Shard
Part 004 — CRUD Semantics: Insert, Find, Update, Delete Without SQL Thinking
Part 005 — Query Model: Thinking in Predicates, Shapes, and Access Paths
Part 006 — Indexing Deep Dive I: B-Tree Mental Model, Compound Indexes, and Explain Plans
Part 007 — Indexing Deep Dive II: Multikey, Partial, Sparse, TTL, Unique, Text, Geo, Clustered
Part 008 — Data Modelling I: Embed vs Reference Decision Framework
Part 009 — Data Modelling II: Patterns for Real Systems
Part 010 — Schema Design for Java Applications: Entities, DTOs, POJOs, Records, and Immutability
Part 011 — Aggregation Pipeline I: Mental Model and Core Stages
Part 012 — Aggregation Pipeline II: Advanced Transformations, Joins, Windows, and Reports
Part 013 — Transactions, Atomicity, Consistency, and Retryable Writes
Part 014 — Concurrency Control and State Machines in MongoDB
Part 015 — Java Driver Mastery I: Connection, Client Lifecycle, CRUD, Codecs
Part 016 — Java Driver Mastery II: Transactions, Sessions, Change Streams, Monitoring
Part 017 — Spring Data MongoDB: Power, Abstractions, and Leaky Boundaries
Part 018 — Performance Engineering I: Query, Index, Memory, Working Set
Part 019 — Performance Engineering II: Write Path, Bulk Operations, Hotspots, and Backpressure
Part 020 — Replication, High Availability, Read Scaling, and Failure Modes
Part 021 — Sharding Deep Dive: Horizontal Scale Without Magical Thinking
Part 022 — Multi-Tenancy, Data Isolation, and Regulatory Boundaries
Part 023 — Security: Authentication, Authorization, Encryption, Auditing, and Secrets
Part 024 — Change Streams and Event-Driven Integration Without Confusing MongoDB with Kafka
Part 025 — Time Series, Logs, Audit Trails, and Retention-Oriented Collections
Part 026 — Search, Atlas Search, Text Search, Geospatial, and Vector Search
Part 027 — Schema Evolution, Migration, Backfill, and Zero-Downtime Changes
Part 028 — Testing Strategy: Unit, Integration, Contract, Migration, and Failure Testing
Part 029 — Observability and Operations: Metrics, Logs, Profiling, Slow Queries, Runbooks
Part 030 — Backup, Restore, Disaster Recovery, Retention, and Compliance
Part 031 — Anti-Patterns and Failure Case Catalogue
Part 032 — Architecture Patterns: MongoDB in Distributed Java Systems
Part 033 — Capstone I: Designing a Regulatory Case Management Platform on MongoDB
Part 034 — Capstone II: Production-Grade Java Implementation Blueprint
```

Seri belum selesai. Tinggal Part 035 sebagai bagian terakhir.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-033.md">⬅️ Part 033 — Capstone I: Designing a Regulatory Case Management Platform on MongoDB</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-035.md">Part 035 — Mastery Review: Heuristics, Checklists, Trade-Offs, and Interview/Architecture Readiness ➡️</a>
</div>
