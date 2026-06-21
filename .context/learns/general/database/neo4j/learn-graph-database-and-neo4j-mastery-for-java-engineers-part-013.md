# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-013.md

# Part 013 — Java Application Integration with Neo4j

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Bagian: `013 / 032`  
> Topik: Java integration, Neo4j Java Driver, Bolt, sessions, transactions, retries, mapping, repository design, reactive access, Spring Boot boundary, testing, observability  
> Target pembaca: Java software engineer yang sudah memahami backend service, transaction boundary, repository pattern, distributed service integration, dan ingin memakai Neo4j secara production-grade tanpa jatuh ke anti-pattern ORM/object-graph loading.

---

## 0. Posisi Bagian Ini Dalam Seri

Sampai Part 012, kita sudah membangun fondasi:

- mengapa graph database ada,
- bagaimana berpikir dalam node, relationship, dan path,
- bagaimana property graph dimodelkan,
- bagaimana Neo4j menyimpan dan mengeksekusi query,
- bagaimana Cypher bekerja,
- bagaimana path query bisa meledak,
- bagaimana graph modelling dilakukan,
- bagaimana constraint/index membantu integrity dan performance,
- bagaimana write harus idempotent,
- bagaimana membaca `EXPLAIN`/`PROFILE`,
- dan bagaimana menghindari supernode serta traversal explosion.

Bagian ini masuk ke lapisan aplikasi Java.

Pertanyaan utamanya bukan:

> “Bagaimana cara connect Java ke Neo4j?”

Itu terlalu dangkal.

Pertanyaan yang benar adalah:

> “Bagaimana merancang boundary antara service Java, Cypher, Neo4j Driver, transaction, retry, mapping, dan domain invariant supaya graph workload tetap benar, cepat, observable, dan mudah berevolusi?”

Di banyak sistem, integrasi database gagal bukan karena database tidak mampu, tetapi karena boundary aplikasinya salah.

Graph database memperbesar risiko itu karena ada godaan untuk memetakan database graph menjadi object graph besar di memory. Itu sering berakhir seperti ORM problem versi lebih mahal: object loading tidak terkendali, query tidak eksplisit, traversal tersembunyi, memory membengkak, dan performance sulit dijelaskan.

Part ini akan membentuk cara berpikir Java integration yang sehat.

---

## 1. Prinsip Utama: Integrasi Neo4j Bukan ORM Problem

Sebagai Java engineer, mungkin refleks awal kita adalah:

```text
Database entity  -> Java entity
Relationship     -> Java field / collection
Repository       -> CRUD abstraction
```

Untuk relational database, pendekatan ORM saja sudah punya banyak jebakan. Untuk graph database, jebakannya bisa lebih tajam.

Mengapa?

Karena graph database bukan hanya menyimpan object dengan foreign key. Graph database menyimpan **network of relationships**. Kalau mapping Java terlalu natural menjadi nested object graph, setiap node bisa membuka relationship baru, lalu relationship itu membuka node lain, lalu node itu membuka relationship lain lagi.

Akibatnya:

```text
1 object loaded
  -> 20 related objects
      -> 400 second-hop objects
          -> 8,000 third-hop objects
              -> application memory spike
              -> slow response
              -> impossible-to-predict query cost
```

Graph application yang baik tidak bertanya:

> “Object apa yang perlu saya load?”

Tetapi:

> “Pertanyaan graph apa yang perlu dijawab, dengan traversal boundary apa, dan projection result apa yang dibutuhkan use case?”

Maka integrasi Java harus query-centric, use-case-centric, dan projection-centric.

Bukan object-graph-centric.

---

## 2. Official Java Driver Mental Model

Neo4j Java Driver adalah library resmi untuk berinteraksi dengan Neo4j dari aplikasi Java. Driver berkomunikasi dengan Neo4j melalui Bolt protocol.

Secara mental, lapisannya seperti ini:

```text
Java Application
  |
  | domain service / application service
  v
Repository / Query Gateway
  |
  | Cypher + parameters
  v
Neo4j Java Driver
  |
  | session + transaction + routing + connection pool
  v
Bolt Protocol
  |
  v
Neo4j DBMS
  |
  | planner + runtime + page cache + storage
  v
Graph Data
```

Komponen penting:

```text
Driver
  Long-lived object.
  Holds connection pool and configuration.
  Created once per application lifecycle.

Session
  Lightweight logical context for executing work.
  Not a business session.
  Created per unit of work/request/use-case.

Transaction
  Atomic unit of database work.
  Can be managed by driver transaction functions.

Result
  Stream/result cursor of records returned by query.
  Should be consumed carefully.

Record
  One row returned by Cypher.

Value
  Driver representation of node, relationship, path, scalar, list, map, etc.
```

A good mental model:

```text
Driver is infrastructure.
Session is execution context.
Transaction is correctness boundary.
Cypher is the real data access contract.
Projection is the application-facing shape.
```

---

## 3. Dependency Setup

A minimal Maven dependency usually looks conceptually like this:

```xml
<dependency>
    <groupId>org.neo4j.driver</groupId>
    <artifactId>neo4j-java-driver</artifactId>
    <version>${neo4j-java-driver.version}</version>
</dependency>
```

In a Spring Boot application, you may use Spring Boot dependency management or Spring Data Neo4j. But for this part, we focus first on the raw Java Driver because it exposes the execution model more clearly.

Why start with raw driver?

Because top-tier graph engineering requires understanding:

- exactly what query is sent,
- exactly where transaction starts/ends,
- exactly what is projected,
- exactly how retries behave,
- exactly what is loaded into memory,
- and exactly what should be measured.

Framework abstraction can be useful later, but it should not hide the graph access pattern.

---

## 4. Basic Driver Lifecycle

A typical application creates one `Driver` instance and reuses it.

```java
import org.neo4j.driver.AuthTokens;
import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;

public final class Neo4jDriverFactory {

    public static Driver create(String uri, String username, String password) {
        return GraphDatabase.driver(uri, AuthTokens.basic(username, password));
    }
}
```

Application lifecycle:

```text
startup:
  create Driver
  verify connectivity if desired

request/use-case:
  open Session
  execute read/write transaction
  map result
  close Session

shutdown:
  close Driver
```

Do not create a new `Driver` per request.

Bad:

```java
public UserGraph loadUserGraph(String userId) {
    Driver driver = GraphDatabase.driver(uri, AuthTokens.basic(user, pass)); // bad
    try (Session session = driver.session()) {
        // query
    }
}
```

Why bad?

Because `Driver` owns connection pool and related resources. Recreating it per request destroys pooling, increases latency, causes resource churn, and can overload both application and database.

Better:

```java
public final class UserGraphRepository {

    private final Driver driver;

    public UserGraphRepository(Driver driver) {
        this.driver = driver;
    }

    public UserNeighborhood loadNeighborhood(String userId) {
        try (var session = driver.session()) {
            return session.executeRead(tx -> {
                var result = tx.run("""
                    MATCH (u:User {id: $userId})-[:FOLLOWS]->(v:User)
                    RETURN u.id AS userId, collect(v.id) AS follows
                    """, Map.of("userId", userId));

                var record = result.single();
                return new UserNeighborhood(
                    record.get("userId").asString(),
                    record.get("follows").asList(Value::asString)
                );
            });
        }
    }
}
```

The important point is not the syntax. The important point is ownership:

```text
Driver belongs to application infrastructure.
Session belongs to one unit of work.
Transaction belongs to one consistency boundary.
Result projection belongs to one use case.
```

---

## 5. Session Is Not a Domain Session

The word `Session` can mislead Java developers.

A Neo4j driver session is not:

- HTTP session,
- user login session,
- Hibernate persistence context,
- long-lived domain conversation,
- cache of loaded objects.

It is a lightweight context used to execute queries with specific configuration, such as:

- database name,
- access mode,
- bookmarks/causal consistency,
- fetch size,
- impersonated user in some setups,
- routing behavior in cluster.

A reasonable pattern:

```java
try (var session = driver.session(SessionConfig.forDatabase("neo4j"))) {
    return session.executeRead(tx -> {
        // one query or multiple related queries
    });
}
```

Avoid long-lived sessions.

A session should not leak into domain model.

Bad design:

```java
public class InvestigationCase {
    private Session neo4jSession; // very bad
}
```

Domain objects should not know how to talk to Neo4j.

---

## 6. Transaction Functions: The Default Production Pattern

Neo4j Java Driver supports managed transaction functions such as `executeRead` and `executeWrite`.

Conceptually:

```java
session.executeRead(tx -> {
    var result = tx.run("MATCH ... RETURN ...", params);
    return map(result);
});

session.executeWrite(tx -> {
    tx.run("MERGE ... SET ...", params).consume();
    return someResult;
});
```

Why prefer managed transaction functions?

Because they give the driver the opportunity to handle retryable transient failures according to driver semantics.

Production systems face transient database conditions:

- leader switch,
- cluster routing changes,
- deadlock,
- temporary lock contention,
- network blip,
- retriable transaction error.

Your application should not treat every database error as final.

But retry is only safe if the transaction function is idempotent from the application perspective.

This is critical.

---

## 7. Transaction Function Must Be Idempotent

A managed transaction function may be retried. Therefore, the function must not contain non-idempotent side effects outside Neo4j.

Bad:

```java
session.executeWrite(tx -> {
    paymentGateway.charge(card, amount); // external side effect inside retryable function

    tx.run("""
        MATCH (c:Customer {id: $customerId})
        CREATE (p:Payment {id: randomUUID(), amount: $amount})
        CREATE (c)-[:MADE_PAYMENT]->(p)
        """, params).consume();

    return null;
});
```

Why bad?

If the transaction is retried, the payment gateway charge may happen twice.

Better:

```text
1. Create/receive command with idempotency key.
2. Execute Neo4j write with deterministic external ID.
3. Commit graph state.
4. Emit outbox event or perform external side effect outside transaction using exactly-once-ish workflow.
5. Make external side effect idempotent too.
```

Better Cypher shape:

```cypher
MERGE (p:Payment {id: $paymentId})
ON CREATE SET
  p.amount = $amount,
  p.createdAt = datetime()
WITH p
MATCH (c:Customer {id: $customerId})
MERGE (c)-[:MADE_PAYMENT]->(p)
RETURN p.id AS paymentId
```

The deterministic `paymentId` is the idempotency key.

Java:

```java
public PaymentCreated recordPayment(RecordPaymentCommand command) {
    try (var session = driver.session(SessionConfig.forDatabase("neo4j"))) {
        return session.executeWrite(tx -> {
            var result = tx.run("""
                MERGE (p:Payment {id: $paymentId})
                ON CREATE SET
                  p.amount = $amount,
                  p.createdAt = datetime()
                WITH p
                MATCH (c:Customer {id: $customerId})
                MERGE (c)-[:MADE_PAYMENT]->(p)
                RETURN p.id AS paymentId
                """, Map.of(
                    "paymentId", command.paymentId(),
                    "amount", command.amount(),
                    "customerId", command.customerId()
                ));

            return new PaymentCreated(result.single().get("paymentId").asString());
        });
    }
}
```

Rule:

```text
Inside managed transaction function:
  OK: deterministic database work
  OK: pure computation
  OK: mapping query result
  BAD: send email
  BAD: charge card
  BAD: publish Kafka message directly
  BAD: call remote service with side effect
  BAD: generate different UUID on each retry unless it is created before entering the transaction function
```

---

## 8. Read Transaction vs Write Transaction

Use `executeRead` for reads and `executeWrite` for writes.

This matters more in clustered deployments, where read and write routing may differ.

Bad:

```java
session.executeWrite(tx -> {
    return tx.run("MATCH (n:User {id: $id}) RETURN n", params).single();
});
```

Why bad?

The query is read-only but routed as write work. In cluster deployment, it may hit the leader unnecessarily, reducing read scalability.

Better:

```java
session.executeRead(tx -> {
    return tx.run("MATCH (n:User {id: $id}) RETURN n", params).single();
});
```

For service design:

```text
Command use case -> executeWrite
Query use case   -> executeRead
```

This aligns naturally with CQRS-style separation without requiring a full CQRS architecture.

---

## 9. Explicit Database Selection

In Neo4j multi-database setups, specify the database name.

```java
try (var session = driver.session(SessionConfig.forDatabase("neo4j"))) {
    // work
}
```

Why?

Because relying on defaults creates deployment ambiguity.

In production, defaults may differ across:

- local developer environment,
- CI environment,
- staging,
- production,
- Aura instance,
- self-managed cluster,
- multi-tenant platform.

Explicit database selection improves auditability.

For a serious platform, treat database name as configuration, not as incidental default.

---

## 10. Parameter Binding: Never String-Concatenate Cypher Values

Bad:

```java
String cypher = "MATCH (u:User {id: '" + userId + "'}) RETURN u";
```

Problems:

- injection risk,
- escaping bugs,
- query plan cache pollution,
- messy logs,
- hard-to-test query shape.

Better:

```java
String cypher = "MATCH (u:User {id: $userId}) RETURN u";
Map<String, Object> params = Map.of("userId", userId);
```

For dynamic query generation, separate:

```text
dynamic structure     -> carefully whitelisted
dynamic values        -> parameters
```

Example: relationship type cannot always be parameterized like a normal property value in every Cypher position. If the relationship type must be dynamic, do not accept arbitrary user input.

Bad:

```java
String cypher = "MATCH (a)-[:" + userProvidedType + "]->(b) RETURN b";
```

Better:

```java
enum AllowedRelationshipType {
    OWNS,
    CONTROLS,
    SUBJECT_OF,
    REVIEWED_BY
}

String relationshipType = switch (type) {
    case OWNS -> "OWNS";
    case CONTROLS -> "CONTROLS";
    case SUBJECT_OF -> "SUBJECT_OF";
    case REVIEWED_BY -> "REVIEWED_BY";
};

String cypher = """
    MATCH (a:Entity {id: $id})-[:%s]->(b)
    RETURN b.id AS id
    """.formatted(relationshipType);
```

The structure is dynamic, but only from a controlled enum.

---

## 11. Result Mapping: Return Projections, Not Raw Graphs

A common mistake is returning raw nodes/relationships directly into the application and letting upper layers inspect them.

Bad:

```java
Node node = result.single().get("u").asNode();
return node;
```

This leaks database representation into domain/application layers.

Better:

```java
public record UserSummary(
    String id,
    String displayName,
    long openCaseCount
) {}
```

Cypher:

```cypher
MATCH (u:User {id: $userId})
OPTIONAL MATCH (u)-[:SUBJECT_OF]->(c:Case {status: 'OPEN'})
RETURN
  u.id AS id,
  u.displayName AS displayName,
  count(c) AS openCaseCount
```

Java mapping:

```java
private static UserSummary mapUserSummary(org.neo4j.driver.Record record) {
    return new UserSummary(
        record.get("id").asString(),
        record.get("displayName").asString(),
        record.get("openCaseCount").asLong()
    );
}
```

Why is this better?

Because the use case needs a summary, not the whole graph.

Projection benefits:

- smaller network payload,
- less memory usage,
- clearer contract,
- easier testing,
- less accidental coupling,
- easier evolution,
- better API stability.

Rule:

```text
Cypher should shape the result as close as possible to the use case response.
Java should map, validate, and enforce application semantics.
```

---

## 12. DTO vs Domain Object vs Read Model

For graph applications, distinguish these shapes:

```text
Domain object:
  Represents business behavior/invariant.
  Should not mirror database graph blindly.

Command DTO:
  Input to write use case.
  Should carry idempotency key and validated intent.

Read model:
  Projection optimized for a query/API/use case.
  Can be flat, nested, aggregated, or path-based.

Graph projection:
  Cypher-shaped result, maybe intermediate.
  Should not automatically become domain object.
```

Example:

```java
public record LinkCaseToEntityCommand(
    String caseId,
    String entityId,
    String relationId,
    String evidenceId,
    String actorId
) {}

public record RelatedEntityView(
    String entityId,
    String entityName,
    String relationshipType,
    int distance,
    List<String> pathEvidenceIds
) {}
```

These are not the same object.

A domain aggregate might enforce:

```text
A closed case cannot accept new evidence relationship.
A confidential case cannot be linked by unauthorized actor.
A relationship must have at least one evidence source.
```

A read model might answer:

```text
Show all entities connected to this case within 2 hops, grouped by risk level.
```

Do not force both into a single Java class.

---

## 13. Repository Design: Query Gateway, Not Generic CRUD

Generic CRUD repositories are often weak for graph systems.

Bad:

```java
interface GenericGraphRepository<T> {
    T save(T entity);
    Optional<T> findById(String id);
    void delete(String id);
    List<T> findAll();
}
```

This hides the most important part: the graph access pattern.

Better:

```java
public interface CaseGraphRepository {

    CaseNetworkView loadCaseNetwork(String caseId, int maxDepth);

    List<RelatedPartyView> findRelatedParties(
        String entityId,
        int maxDepth,
        Set<RelationshipKind> allowedRelationships
    );

    void linkEvidenceToCase(LinkEvidenceCommand command);

    boolean hasConflictOfInterest(String caseId, String officerId);
}
```

This repository is use-case oriented.

The method names communicate graph questions:

- load network,
- find related parties,
- link evidence,
- detect conflict.

Not generic persistence operations.

A strong graph repository design has these properties:

```text
1. Method names reflect graph questions or graph mutations.
2. Traversal depth is explicit.
3. Relationship scope is explicit.
4. Returned projection is explicit.
5. Write methods accept command objects with idempotency keys.
6. Query text is visible and testable.
7. No hidden lazy traversal.
8. No automatic load-the-world behavior.
```

---

## 14. Query Object Pattern

For complex graph queries, inline strings inside repository methods become hard to maintain.

A query object pattern can help.

```java
public final class CaseNetworkQuery {

    public String cypher() {
        return """
            MATCH path = (c:Case {id: $caseId})-[rels:SUBJECT_OF|SUPPORTED_BY|ESCALATED_TO*1..$maxDepth]-(n)
            RETURN path
            LIMIT $limit
            """;
    }

    public Map<String, Object> parameters(String caseId, int maxDepth, int limit) {
        return Map.of(
            "caseId", caseId,
            "maxDepth", maxDepth,
            "limit", limit
        );
    }
}
```

However, be careful: not every Cypher syntactic position accepts parameters in the same way. Some dynamic structures may require query construction from whitelisted components.

An even safer pattern:

```java
public record CaseNetworkRequest(
    String caseId,
    int maxDepth,
    int limit,
    Set<CaseNetworkRelationship> relationships
) {
    public CaseNetworkRequest {
        if (maxDepth < 1 || maxDepth > 4) {
            throw new IllegalArgumentException("maxDepth must be between 1 and 4");
        }
        if (limit < 1 || limit > 1000) {
            throw new IllegalArgumentException("limit must be between 1 and 1000");
        }
    }
}
```

The request object enforces traversal guardrails before query execution.

---

## 15. One Query vs Multiple Queries

A common design question:

> Should one use case run one big Cypher query or several smaller queries?

There is no universal answer.

One query is often better when:

```text
- the result is one coherent graph projection,
- the database can optimize the pattern well,
- you need atomic read consistency,
- you want fewer network round trips,
- intermediate data should stay inside database execution.
```

Multiple queries are often better when:

```text
- each query has different access pattern,
- one query would create complex accidental cartesian products,
- you need staged decision logic,
- you want to fail fast after first lookup,
- the second query depends on a small result from the first,
- result mapping would be clearer.
```

Bad reason for multiple queries:

```text
Because I am manually traversing the graph in Java.
```

Example of bad Java-side traversal:

```java
var accounts = findAccounts(customerId);
for (var account : accounts) {
    var txs = findTransactions(account.id());
    for (var tx : txs) {
        var counterparties = findCounterparties(tx.id());
        // N+1 traversal pattern
    }
}
```

Better:

```cypher
MATCH (c:Customer {id: $customerId})-[:OWNS]->(a:Account)
MATCH (a)-[:SENT|RECEIVED]->(t:Transaction)
MATCH (t)-[:COUNTERPARTY]->(p:Party)
RETURN
  a.id AS accountId,
  t.id AS transactionId,
  p.id AS counterpartyId
LIMIT $limit
```

But also avoid one monstrous query that tries to do every possible screen/use case.

Rule:

```text
Let Neo4j traverse.
Let Java orchestrate use cases.
Do not let Java simulate graph traversal with loops of tiny queries.
```

---

## 16. The N+1 Graph Query Problem

N+1 query problem is not only an ORM issue. It appears in graph services too.

Pattern:

```text
Query 1: find N nodes
For each node:
  Query relationship details
```

Example:

```java
List<String> caseIds = findOpenCaseIds();
for (String caseId : caseIds) {
    List<String> subjects = findSubjectsForCase(caseId);
}
```

This may produce:

```text
1 + N database round trips
```

Better:

```cypher
MATCH (c:Case {status: 'OPEN'})
OPTIONAL MATCH (c)-[:SUBJECT_OF]->(e:Entity)
RETURN c.id AS caseId, collect(e.id) AS subjectIds
```

Or, if the number of starting IDs is controlled:

```cypher
MATCH (c:Case)
WHERE c.id IN $caseIds
OPTIONAL MATCH (c)-[:SUBJECT_OF]->(e:Entity)
RETURN c.id AS caseId, collect(e.id) AS subjectIds
```

Java:

```java
var result = tx.run("""
    MATCH (c:Case)
    WHERE c.id IN $caseIds
    OPTIONAL MATCH (c)-[:SUBJECT_OF]->(e:Entity)
    RETURN c.id AS caseId, collect(e.id) AS subjectIds
    """, Map.of("caseIds", caseIds));
```

Guardrail:

```text
If Java code contains a loop that runs Cypher inside each iteration, stop and challenge the design.
```

Sometimes it is acceptable for small admin tasks. It is rarely acceptable for hot-path APIs.

---

## 17. Fetch Size and Streaming Result Consumption

Graph query results can be large.

Do not assume `collect()` is always safe.

Risky:

```cypher
MATCH (c:Customer)-[:OWNS]->(a:Account)-[:SENT]->(t:Transaction)
RETURN collect(t) AS allTransactions
```

This may build a huge list in the database and then a huge object in Java.

Better for large exports:

```cypher
MATCH (c:Customer {id: $customerId})-[:OWNS]->(a:Account)-[:SENT]->(t:Transaction)
RETURN a.id AS accountId, t.id AS transactionId, t.amount AS amount
ORDER BY t.timestamp
```

Then stream/process rows.

Java driver result consumption should be deliberate:

```java
try (var session = driver.session()) {
    session.executeRead(tx -> {
        var result = tx.run("""
            MATCH (c:Customer {id: $customerId})-[:OWNS]->(a:Account)-[:SENT]->(t:Transaction)
            RETURN a.id AS accountId, t.id AS transactionId, t.amount AS amount
            ORDER BY t.timestamp
            """, Map.of("customerId", customerId));

        while (result.hasNext()) {
            var record = result.next();
            // process one row
        }
        return null;
    });
}
```

However, remember transaction scope. If processing is slow and external, you may hold transaction resources too long.

For export jobs:

```text
- page by stable cursor,
- use bounded batches,
- avoid holding one transaction for too long,
- avoid building massive lists,
- checkpoint progress,
- retry idempotently.
```

---

## 18. Pagination: Offset Is Often Not Enough

Cypher supports `SKIP`/`LIMIT`, but offset pagination can be problematic for large datasets.

Example:

```cypher
MATCH (c:Case)
RETURN c.id AS id
ORDER BY c.createdAt DESC
SKIP $skip
LIMIT $limit
```

Problems:

- deep pages get expensive,
- concurrent writes can shift rows,
- user may see duplicates/misses,
- ordering must be stable.

Cursor pagination is often better:

```cypher
MATCH (c:Case)
WHERE c.createdAt < datetime($beforeCreatedAt)
RETURN c.id AS id, c.createdAt AS createdAt
ORDER BY c.createdAt DESC
LIMIT $limit
```

If timestamps can collide:

```cypher
MATCH (c:Case)
WHERE
  c.createdAt < datetime($beforeCreatedAt)
  OR (c.createdAt = datetime($beforeCreatedAt) AND c.id < $beforeId)
RETURN c.id AS id, c.createdAt AS createdAt
ORDER BY c.createdAt DESC, c.id DESC
LIMIT $limit
```

For graph neighborhood pagination, be extra careful. Paginating a graph is not the same as paginating a table.

Questions to answer:

```text
Are we paginating nodes?
Are we paginating relationships?
Are we paginating paths?
Are we preserving graph context?
Are we returning partial neighborhoods?
Can the UI explain partialness?
```

For graph visualization APIs, it is often better to design explicit expansion operations:

```text
Initial load:
  return center node + top N important adjacent nodes

Expand node:
  return selected node + next N neighbors under selected relationship filters

Search within graph:
  return matching nodes + connecting paths if bounded
```

---

## 19. Path Mapping in Java

Neo4j can return paths.

Cypher:

```cypher
MATCH path = (c:Case {id: $caseId})-[:SUBJECT_OF|SUPPORTED_BY|LINKED_TO*1..3]-(n)
RETURN path
LIMIT 100
```

Java can read path values:

```java
var path = record.get("path").asPath();
```

But mapping raw path to business response requires discipline.

A useful API shape:

```java
public record GraphPathView(
    List<GraphNodeView> nodes,
    List<GraphRelationshipView> relationships
) {}

public record GraphNodeView(
    String id,
    Set<String> labels,
    Map<String, Object> properties
) {}

public record GraphRelationshipView(
    String id,
    String type,
    String startNodeId,
    String endNodeId,
    Map<String, Object> properties
) {}
```

But for sensitive domains, do not blindly expose all properties.

Better:

```java
public record CasePathStep(
    String fromId,
    String relationshipType,
    String toId,
    String evidenceSummary,
    int hop
) {}
```

Principle:

```text
Raw graph path is a database result.
Business path is an interpreted result.
Audit path is an explained result.
UI path is a curated result.
```

Do not confuse them.

---

## 20. Graph API Design: Avoid Returning “The Graph”

A common frontend/backend request:

> “Give me the graph for this case.”

This is underspecified and dangerous.

A production API should force boundaries:

```http
GET /cases/{caseId}/network?depth=2&relationshipTypes=SUBJECT_OF,SUPPORTED_BY&limit=200
```

Better request semantics:

```text
Center: caseId
Depth: max 2
Relationship types: allowlist
Node labels: optional allowlist
Limit: max result size
Sort/rank: most relevant first
Security context: current actor
```

Response should include metadata:

```json
{
  "centerNodeId": "case-123",
  "depth": 2,
  "truncated": true,
  "truncationReason": "LIMIT_REACHED",
  "nodes": [],
  "relationships": []
}
```

This matters because graph APIs often return partial graphs.

A partial graph without metadata is misleading.

For investigation/regulatory systems, misleading partialness can create audit risk.

---

## 21. Timeouts and Guardrails

Application should not rely only on database configuration to prevent bad queries.

Guardrails should exist at multiple layers:

```text
API layer:
  validate depth, limit, filters

Application service:
  choose use-case-specific query

Repository:
  parameterize query and enforce max bounds

Driver/session:
  configure timeout/fetch behavior as appropriate

Database:
  query timeout, memory config, indexes, constraints

Observability:
  slow query logs and metrics
```

Example validation:

```java
public record NetworkRequest(
    String centerId,
    int depth,
    int limit,
    Set<String> relationshipTypes
) {
    public NetworkRequest {
        if (depth < 1 || depth > 3) {
            throw new IllegalArgumentException("depth must be between 1 and 3");
        }
        if (limit < 1 || limit > 500) {
            throw new IllegalArgumentException("limit must be between 1 and 500");
        }
        if (relationshipTypes == null || relationshipTypes.isEmpty()) {
            throw new IllegalArgumentException("relationshipTypes must not be empty");
        }
    }
}
```

Do not expose unbounded traversal to API consumers.

Bad:

```cypher
MATCH path = (n {id: $id})-[*]-(m)
RETURN path
```

Production-safe graph APIs are intentionally constrained.

---

## 22. Error Handling: Classify, Do Not Catch Everything as 500

Database errors have different meanings.

At application level, classify errors into categories:

```text
Validation error:
  bad input, invalid traversal depth, unsupported filter

Not found:
  expected node does not exist

Conflict:
  invariant violation, duplicate, illegal state transition

Transient infrastructure error:
  retry may succeed

Permanent database/query error:
  syntax, missing schema assumption, bad deployment

Security error:
  unauthorized, forbidden, tenant boundary violation
```

Do not do this:

```java
catch (Exception e) {
    throw new RuntimeException("Neo4j failed", e);
}
```

Better:

```java
try {
    return repository.loadCaseNetwork(request);
} catch (IllegalArgumentException e) {
    throw new BadRequestException(e.getMessage(), e);
} catch (CaseNotFoundException e) {
    throw new NotFoundException(e.getMessage(), e);
} catch (org.neo4j.driver.exceptions.TransientException e) {
    throw new TemporaryDependencyException("Neo4j transient failure", e);
} catch (org.neo4j.driver.exceptions.Neo4jException e) {
    throw new DatabaseAccessException("Neo4j query failed", e);
}
```

Error handling should preserve enough detail for logs while not leaking internals to clients.

---

## 23. Not Found Semantics

Cypher `MATCH` returns no rows if pattern does not exist.

Example:

```cypher
MATCH (c:Case {id: $caseId})
RETURN c.id AS id
```

Java:

```java
var result = tx.run(cypher, params);
if (!result.hasNext()) {
    throw new CaseNotFoundException(caseId);
}
```

But be careful with `OPTIONAL MATCH`.

```cypher
MATCH (c:Case {id: $caseId})
OPTIONAL MATCH (c)-[:SUBJECT_OF]->(e:Entity)
RETURN c.id AS caseId, collect(e.id) AS entityIds
```

This returns a row even if no entities are attached, as long as the case exists.

Whereas:

```cypher
MATCH (c:Case {id: $caseId})-[:SUBJECT_OF]->(e:Entity)
RETURN c.id AS caseId, collect(e.id) AS entityIds
```

This returns no rows if the case exists but has no subjects.

That distinction matters.

Application semantics:

```text
No case found       -> 404 / not found
Case with no links  -> 200 with empty list
```

Your Cypher must reflect that distinction.

---

## 24. Constraint Violations and Application Conflicts

Suppose you have uniqueness constraint:

```cypher
CREATE CONSTRAINT case_id_unique IF NOT EXISTS
FOR (c:Case)
REQUIRE c.id IS UNIQUE
```

If Java tries to create duplicate `Case`, Neo4j can reject it.

But application should usually design idempotent create:

```cypher
MERGE (c:Case {id: $caseId})
ON CREATE SET
  c.createdAt = datetime(),
  c.status = 'OPEN',
  c.title = $title
ON MATCH SET
  c.lastSeenAt = datetime()
RETURN c.id AS id
```

However, `MERGE` is not always the correct semantic.

If create must fail when entity exists, use `CREATE` and map constraint violation to conflict.

```text
Command: Create new case
Duplicate caseId: conflict
```

If create is an idempotent projection from upstream event, use `MERGE`.

```text
Event: CaseObservedFromSource
Duplicate event replay: no-op/update
```

The Java repository should encode this intent clearly.

---

## 25. Domain Invariants in Java vs Cypher

Where should invariant live?

Answer: often both, but at different levels.

Cypher/Neo4j is good for:

```text
- uniqueness,
- property existence,
- type constraints,
- relationship existence checks,
- atomic graph mutation,
- local graph invariant checks inside transaction.
```

Java domain/application layer is good for:

```text
- use-case authorization,
- complex business state transition,
- external policy evaluation,
- command validation,
- orchestration,
- idempotency workflow,
- error classification,
- API contract.
```

Example invariant:

> A closed case cannot be linked to new evidence.

Cypher can enforce in transaction:

```cypher
MATCH (c:Case {id: $caseId})
WHERE c.status <> 'CLOSED'
MATCH (e:Evidence {id: $evidenceId})
MERGE (c)-[:SUPPORTED_BY {source: $source}]->(e)
RETURN c.id AS caseId
```

Java must interpret no row correctly:

```java
var result = tx.run(cypher, params);
if (!result.hasNext()) {
    throw new IllegalCaseStateException("Case not found or already closed");
}
```

But better distinguish not found vs closed:

```cypher
MATCH (c:Case {id: $caseId})
RETURN c.status AS status
```

Then:

```text
not found -> 404
closed    -> 409 conflict
open      -> proceed with write
```

Or perform an atomic conditional write and return status metadata.

For high-concurrency correctness, prefer atomic conditional write when race matters.

---

## 26. Atomic Conditional Write Pattern

A common dangerous pattern:

```text
1. Read status.
2. If open, write relationship.
```

Between step 1 and step 2, another transaction may close the case.

Better:

```cypher
MATCH (c:Case {id: $caseId})
MATCH (e:Evidence {id: $evidenceId})
WITH c, e
WHERE c.status = 'OPEN'
MERGE (c)-[r:SUPPORTED_BY]->(e)
ON CREATE SET
  r.createdAt = datetime(),
  r.createdBy = $actorId
RETURN c.id AS caseId, e.id AS evidenceId
```

This makes the state check part of the write transaction.

If no row returned, application can run a diagnostic read to distinguish:

```text
- case missing,
- evidence missing,
- case not open.
```

In hot command paths, this pattern is often better than pre-read then write.

---

## 27. Causal Consistency and Bookmarks

In clustered or distributed environments, an application may write data then immediately read from a read replica/secondary. Without causal consistency, the read may not see the write yet.

Neo4j driver supports bookmark/causal chaining concepts. The practical application-level question is:

> Does this use case require read-your-write semantics across transactions/sessions?

Examples that require read-your-write:

```text
- create case then load case detail immediately,
- link evidence then show updated graph,
- submit decision then generate audit view,
- user updates access then immediately checks authorization graph.
```

Simpler approach:

```text
For write followed by immediate read in same request, use same session/transaction structure where possible.
```

If separate sessions/services are involved, understand bookmark propagation.

Architecture smell:

```text
Service A writes Neo4j.
Service B immediately reads Neo4j through independent request.
User expects immediate consistency.
No causal token/bookmark/request sequencing exists.
```

This can produce intermittent “missing data” bugs in clusters.

---

## 28. Connection Pooling

The Java Driver manages connections internally. Application should configure pool size according to workload.

Key considerations:

```text
- number of application instances,
- max concurrent requests using Neo4j,
- average query latency,
- database capacity,
- cluster topology,
- read/write ratio,
- blocking vs reactive access,
- timeout behavior.
```

Too small pool:

```text
Application threads wait for connections.
Latency increases.
Requests timeout before database is saturated.
```

Too large pool:

```text
Database overloaded.
More concurrent queries compete for CPU/page cache/memory.
Tail latency worsens.
Lock contention increases for writes.
```

Connection pool sizing is not “bigger is better.”

Use Little’s Law intuition:

```text
concurrency ≈ throughput × latency
```

If your service needs 200 requests/second to Neo4j and average Neo4j time is 50 ms:

```text
200 rps × 0.05 s = 10 concurrent in-flight database operations
```

Then pool size might be somewhat above that, not 500 by default.

Measure and tune.

---

## 29. Synchronous vs Reactive Driver Usage

Neo4j Java Driver has synchronous and reactive APIs.

Use synchronous access when:

```text
- application stack is servlet/blocking,
- request volume is moderate,
- simplicity matters,
- queries are bounded and low latency,
- team is not fully reactive.
```

Use reactive access when:

```text
- application stack is reactive end-to-end,
- backpressure matters,
- result streaming matters,
- service handles many concurrent I/O-bound operations,
- team understands reactive error handling and lifecycle.
```

Do not mix reactive driver into blocking service just for fashion.

Bad:

```text
Reactive Neo4j call
  -> block()
  -> servlet thread waits anyway
  -> harder debugging
  -> no real benefit
```

Reactive only pays off when the whole chain respects non-blocking execution.

---

## 30. Spring Boot Integration Without Spring Data Neo4j

A clean Spring Boot raw-driver setup:

```java
@Configuration
public class Neo4jConfig {

    @Bean(destroyMethod = "close")
    Driver neo4jDriver(Neo4jProperties props) {
        return GraphDatabase.driver(
            props.uri(),
            AuthTokens.basic(props.username(), props.password())
        );
    }
}
```

Repository:

```java
@Repository
public class DefaultCaseGraphRepository implements CaseGraphRepository {

    private final Driver driver;
    private final String databaseName;

    public DefaultCaseGraphRepository(Driver driver, Neo4jProperties props) {
        this.driver = driver;
        this.databaseName = props.database();
    }

    @Override
    public CaseNetworkView loadCaseNetwork(String caseId, int depth) {
        try (var session = driver.session(SessionConfig.forDatabase(databaseName))) {
            return session.executeRead(tx -> {
                var result = tx.run("""
                    MATCH path = (c:Case {id: $caseId})-[:SUBJECT_OF|SUPPORTED_BY|LINKED_TO*1..2]-(n)
                    RETURN path
                    LIMIT 200
                    """, Map.of("caseId", caseId));

                return CaseNetworkMapper.map(result);
            });
        }
    }
}
```

Note: the `depth` above should not be blindly interpolated unless query construction is carefully controlled. Some teams use fixed query variants for depth 1, 2, 3 to avoid unsafe dynamic syntax.

---

## 31. Spring Transaction Annotation: Be Careful

Java engineers often expect `@Transactional` to handle everything.

With Neo4j raw driver, `@Transactional` from Spring does not automatically make driver operations participate in the same way as JDBC/JPA unless configured through the appropriate transaction manager/framework integration.

This is one reason Spring Data Neo4j exists.

Practical rule:

```text
If using raw Neo4j Java Driver:
  Prefer driver-managed transaction functions explicitly.

If using Spring Data Neo4j:
  Understand its transaction manager and mapping behavior.

If combining relational DB + Neo4j in one service:
  Do not assume one @Transactional gives distributed atomicity.
```

Cross-database transaction between PostgreSQL and Neo4j is not something to casually assume.

Better patterns:

```text
- outbox/inbox,
- rebuildable graph projection,
- idempotent synchronization,
- compensating workflows,
- clear source-of-truth ownership,
- reconciliation jobs.
```

This will be explored further in Part 015 and Part 031.

---

## 32. Spring Data Neo4j: Where It Fits

Spring Data Neo4j provides repository support and a familiar Spring programming model for Neo4j access.

It is useful when:

```text
- domain shape is relatively simple,
- CRUD-like operations are common,
- team benefits from Spring repository conventions,
- mapping depth is controlled,
- custom Cypher is used for critical graph queries,
- you understand object graph vs database graph boundary.
```

It becomes risky when:

```text
- team treats graph database like JPA,
- entity relationships are loaded without explicit query thinking,
- traversal depth is implicit,
- hot-path queries are hidden behind generated repository methods,
- performance tuning requires reading generated behavior nobody owns,
- domain object graph becomes huge.
```

A pragmatic approach:

```text
Use Spring Data Neo4j for simple aggregate persistence where it fits.
Use raw driver/custom Cypher for critical graph queries, network exploration, path queries, analytics-facing projections, and performance-sensitive operations.
```

Part 014 will cover Spring Data Neo4j more deeply.

---

## 33. Mapping Strategy: Avoid Bidirectional Infinite Object Graphs

Suppose Java classes:

```java
class Person {
    String id;
    List<Organization> organizations;
}

class Organization {
    String id;
    List<Person> members;
}
```

This looks natural, but it can create infinite conceptual expansion:

```text
Person -> Organization -> Person -> Organization -> ...
```

In graph systems, bidirectional relationships are common at query level even if stored directionally.

But Java object graphs should not automatically mirror that.

Better read models:

```java
public record PersonMembershipView(
    String personId,
    String personName,
    List<Membership> memberships
) {}

public record Membership(
    String organizationId,
    String organizationName,
    String role,
    String validFrom,
    String validTo
) {}
```

For organization view:

```java
public record OrganizationMembersView(
    String organizationId,
    String organizationName,
    List<MemberSummary> members
) {}
```

Separate use-case views avoid recursive object loading.

---

## 34. Domain Service Boundary Example

Consider an enforcement case management platform.

Use case:

> Link an entity to a case as a subject, based on evidence, unless the case is closed, and produce an audit event.

Application service:

```java
public final class LinkSubjectToCaseService {

    private final CaseGraphRepository repository;
    private final AuthorizationService authorizationService;
    private final AuditOutbox auditOutbox;

    public LinkSubjectToCaseService(
        CaseGraphRepository repository,
        AuthorizationService authorizationService,
        AuditOutbox auditOutbox
    ) {
        this.repository = repository;
        this.authorizationService = authorizationService;
        this.auditOutbox = auditOutbox;
    }

    public LinkSubjectResult handle(LinkSubjectCommand command) {
        authorizationService.assertCanModifyCase(command.actorId(), command.caseId());

        LinkSubjectResult result = repository.linkSubject(command);

        auditOutbox.record(AuditEvent.subjectLinked(
            command.commandId(),
            command.actorId(),
            command.caseId(),
            command.entityId(),
            command.evidenceId()
        ));

        return result;
    }
}
```

Repository:

```java
public LinkSubjectResult linkSubject(LinkSubjectCommand command) {
    try (var session = driver.session(SessionConfig.forDatabase(databaseName))) {
        return session.executeWrite(tx -> {
            var result = tx.run("""
                MATCH (c:Case {id: $caseId})
                MATCH (e:Entity {id: $entityId})
                MATCH (ev:Evidence {id: $evidenceId})
                WHERE c.status = 'OPEN'
                MERGE (c)-[r:SUBJECT_OF]->(e)
                ON CREATE SET
                  r.createdAt = datetime(),
                  r.createdBy = $actorId,
                  r.linkId = $linkId
                SET
                  r.updatedAt = datetime()
                MERGE (r)-[:SUPPORTED_BY]->(ev)
                RETURN c.id AS caseId, e.id AS entityId, r.linkId AS linkId
                """, Map.of(
                    "caseId", command.caseId(),
                    "entityId", command.entityId(),
                    "evidenceId", command.evidenceId(),
                    "actorId", command.actorId(),
                    "linkId", command.linkId()
                ));

            if (!result.hasNext()) {
                throw diagnoseLinkSubjectFailure(tx, command);
            }

            var record = result.single();
            return new LinkSubjectResult(
                record.get("caseId").asString(),
                record.get("entityId").asString(),
                record.get("linkId").asString()
            );
        });
    }
}
```

Important caveat: Cypher relationship variables cannot be used as nodes for relationships. The snippet above intentionally exposes a modelling issue. In Neo4j property graph, relationships cannot have relationships. If `SUBJECT_OF` relationship needs evidence links, the relationship must either store evidence IDs as properties or be reified as a node.

Correct reified model:

```text
(:Case)-[:HAS_SUBJECT_LINK]->(:SubjectLink)-[:TO_ENTITY]->(:Entity)
(:SubjectLink)-[:SUPPORTED_BY]->(:Evidence)
```

Correct Cypher:

```cypher
MATCH (c:Case {id: $caseId})
MATCH (e:Entity {id: $entityId})
MATCH (ev:Evidence {id: $evidenceId})
WHERE c.status = 'OPEN'
MERGE (link:SubjectLink {id: $linkId})
ON CREATE SET
  link.createdAt = datetime(),
  link.createdBy = $actorId
SET link.updatedAt = datetime()
MERGE (c)-[:HAS_SUBJECT_LINK]->(link)
MERGE (link)-[:TO_ENTITY]->(e)
MERGE (link)-[:SUPPORTED_BY]->(ev)
RETURN c.id AS caseId, e.id AS entityId, link.id AS linkId
```

This illustrates why Java integration cannot be separated from graph modelling.

A repository is not only a persistence wrapper. It is where modelling semantics meet application correctness.

---

## 35. Relationship Reification in Java APIs

If relationship has identity, lifecycle, evidence, approval, or audit trail, do not hide it as a simple Java collection.

Bad:

```java
case.subjects().add(entity);
```

Better:

```java
linkSubjectToCase(command);
```

Because the business concept is not “case has entity.”

It is:

```text
A subject link was asserted by an actor at a time, supported by evidence, under a source, with validity and review status.
```

That deserves a command and possibly a node.

Java API should expose business operations, not raw graph mutation.

---

## 36. Avoid Business Logic Hidden in Cypher Only

Cypher can encode powerful logic. But if all business logic lives in query strings, the Java application becomes a thin query launcher and business behavior becomes hard to test/review.

Bad:

```text
300-line Cypher query containing:
  authorization,
  state transition,
  scoring,
  audit shaping,
  data correction,
  notification condition,
  projection formatting.
```

Better separation:

```text
Java:
  validate command
  authorize actor
  choose use case
  call repository
  interpret result
  write audit/outbox

Cypher:
  perform graph pattern match
  enforce atomic graph condition
  mutate graph
  return explicit projection
```

Some logic belongs in Cypher because only the database can check and mutate atomically.

Some logic belongs in Java because it is policy/application orchestration.

The boundary should be intentional.

---

## 37. Query Versioning and Migration

For serious systems, Cypher queries are part of application contract.

Treat them like code:

```text
- named query files or constants,
- tests,
- review,
- performance benchmarks,
- migration notes,
- query plan monitoring,
- schema dependency documentation.
```

Example query metadata:

```java
public final class Queries {
    public static final String CASE_NETWORK_V2 = """
        // name: case-network-v2
        // requires: Case(id), Entity(id), indexes on :Case(id), :Entity(id)
        // max-depth: 2
        MATCH path = (c:Case {id: $caseId})-[:HAS_SUBJECT_LINK|TO_ENTITY|SUPPORTED_BY*1..2]-(n)
        RETURN path
        LIMIT $limit
        """;
}
```

Even though comments inside query may not affect execution, metadata near query text helps maintainers.

A stronger approach:

```text
src/main/resources/cypher/case-network-v2.cypher
src/test/resources/cypher-plans/case-network-v2.expected.md
```

The exact tooling is less important than the discipline.

---

## 38. Testing Neo4j Integration

Unit tests alone are not enough for Cypher-heavy repositories.

You need at least three layers:

```text
1. Pure unit tests
   Validate Java mapping, validation, error classification.

2. Repository integration tests
   Run Cypher against real Neo4j via Testcontainers.

3. Performance/regression tests
   Validate query plans and runtime behavior on representative datasets.
```

Pure mapper test:

```java
@Test
void mapsUserSummary() {
    // use lightweight test helper or mock record carefully
}
```

Repository integration test with Testcontainers conceptually:

```java
@Testcontainers
class CaseGraphRepositoryTest {

    @Container
    static Neo4jContainer<?> neo4j = new Neo4jContainer<>("neo4j:latest")
        .withAdminPassword("password");

    Driver driver;

    @BeforeEach
    void setUp() {
        driver = GraphDatabase.driver(
            neo4j.getBoltUrl(),
            AuthTokens.basic("neo4j", "password")
        );
        seedData();
    }

    @AfterEach
    void tearDown() {
        driver.close();
    }

    @Test
    void loadsCaseNetworkWithinDepth() {
        var repo = new DefaultCaseGraphRepository(driver, "neo4j");
        var view = repo.loadCaseNetwork("case-1", 2);

        assertThat(view.nodes()).isNotEmpty();
        assertThat(view.truncated()).isFalse();
    }
}
```

Use real Neo4j for:

- constraint behavior,
- `MERGE` semantics,
- path query semantics,
- `OPTIONAL MATCH` semantics,
- transaction rollback,
- query plan behavior,
- type conversion behavior.

Mocks are poor substitutes for graph semantics.

---

## 39. Golden Dataset Testing

Graph queries often fail in edge cases.

Create golden datasets with known topology:

```text
Dataset A: simple line
A -> B -> C

Dataset B: cycle
A -> B -> C -> A

Dataset C: diamond
A -> B -> D
A -> C -> D

Dataset D: supernode
A -> 1000 neighbors

Dataset E: disconnected components
A-B-C and X-Y-Z

Dataset F: missing optional relationships
Case exists but no evidence

Dataset G: duplicate-like entities
Two persons share phone/email/address
```

For each query, assert behavior:

```text
- max depth respected,
- cycles do not create unexpected duplicates,
- no rows vs empty lists handled correctly,
- limit/truncation metadata correct,
- unauthorized tenant data excluded,
- performance acceptable.
```

This is far more useful than only testing happy path.

---

## 40. Testing Query Plans

For critical queries, test not only result correctness but plan health.

You can run:

```cypher
EXPLAIN ...
PROFILE ...
```

In automated tests, exact plan assertions can be brittle across Neo4j versions. But you can still maintain manual or semi-automated checks:

```text
- query uses expected index seek,
- no accidental cartesian product,
- no huge db hits on representative dataset,
- no unbounded variable expansion,
- row count remains bounded,
- memory does not spike.
```

Performance test output should be reviewed like code.

A practical checklist per critical query:

```text
Query name:
Use case:
Expected start node/index:
Max traversal depth:
Expected max rows:
Expected max DB hits on baseline dataset:
Known risks:
Last profiled with Neo4j version:
```

---

## 41. Observability From Java Service

Neo4j integration should be observable at service level.

Capture metrics:

```text
- query duration by query name,
- success/failure count,
- transient error count,
- retry count,
- result row count,
- timeout count,
- pool acquisition latency if exposed,
- active in-flight graph operations,
- slow query logs correlation.
```

Do not log full raw Cypher with sensitive values.

Better logging:

```text
queryName=case-network-v2
caseIdHash=...
depth=2
limit=200
durationMs=83
rowCount=127
truncated=false
```

For sensitive regulatory systems, logging raw graph properties may leak protected data.

Use:

```text
- query names,
- hashed IDs,
- metadata,
- durations,
- row counts,
- error classifications.
```

---

## 42. Query Naming

Because Cypher is passed as strings, query naming is important.

Bad log:

```text
Neo4j query failed
```

Better log:

```text
Neo4j query failed: queryName=case-related-party-search-v3 errorClass=TransientException durationMs=1200
```

Create a tiny wrapper:

```java
public record GraphQuery(
    String name,
    String cypher
) {}
```

Repository:

```java
private static final GraphQuery RELATED_PARTIES = new GraphQuery(
    "related-parties-v1",
    """
    MATCH path = (e:Entity {id: $entityId})-[:OWNS|CONTROLS|ASSOCIATED_WITH*1..2]-(other:Entity)
    RETURN other.id AS id, length(path) AS distance
    LIMIT $limit
    """
);
```

Execution wrapper:

```java
public Result run(QueryRunner tx, GraphQuery query, Map<String, Object> params) {
    long start = System.nanoTime();
    try {
        return tx.run(query.cypher(), params);
    } finally {
        long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
        log.debug("neo4j.query name={} durationMs={}", query.name(), durationMs);
    }
}
```

Be careful measuring before result consumption. Some drivers/results are lazy. For accurate timing, measure after consuming or mapping the result.

---

## 43. Security Context and Tenant Filtering

Never rely on frontend to filter graph data.

For multi-tenant or access-controlled graph, the repository query must include security boundary.

Example:

```cypher
MATCH (tenant:Tenant {id: $tenantId})<-[:BELONGS_TO]-(c:Case {id: $caseId})
MATCH path = (c)-[:HAS_SUBJECT_LINK|TO_ENTITY|SUPPORTED_BY*1..2]-(n)
WHERE (n)-[:BELONGS_TO]->(tenant)
RETURN path
LIMIT $limit
```

But this pattern may be too expensive depending on model. Sometimes tenant ID property plus constraint/index is better:

```cypher
MATCH (c:Case {tenantId: $tenantId, id: $caseId})
MATCH path = (c)-[:HAS_SUBJECT_LINK|TO_ENTITY|SUPPORTED_BY*1..2]-(n)
WHERE all(node IN nodes(path) WHERE node.tenantId = $tenantId)
RETURN path
LIMIT $limit
```

Trade-off:

```text
Tenant relationship model:
  more graph-semantic,
  can express membership/history,
  may add traversal cost.

Tenant property model:
  simpler filtering/indexing,
  less semantic richness,
  easier to accidentally forget filter.

Database-per-tenant:
  strongest isolation operationally,
  harder fleet management,
  harder cross-tenant analytics.
```

Application repository must make tenant boundary non-optional.

Bad:

```java
loadCaseNetwork(String caseId)
```

Better:

```java
loadCaseNetwork(TenantId tenantId, ActorId actorId, CaseId caseId, NetworkOptions options)
```

---

## 44. Authorization Is Not Just “Can Read Node”

Graph access control is often path-dependent.

Examples:

```text
User can see case if assigned to team.
User can see entity only if connected to visible case.
User can see evidence metadata but not evidence content.
User can see path existence but not sensitive intermediate node.
User can see aggregate risk score but not protected source relationship.
```

Application integration must support security trimming.

Do not return raw path and let frontend hide sensitive nodes.

Cypher must enforce visibility or return a deliberately redacted projection.

Example redacted projection:

```cypher
MATCH path = (c:Case {id: $caseId})-[:HAS_SUBJECT_LINK|TO_ENTITY|SUPPORTED_BY*1..2]-(n)
WHERE c.tenantId = $tenantId
RETURN [node IN nodes(path) |
  CASE
    WHEN node.sensitivity = 'HIGH' AND NOT $canViewSensitive
    THEN {id: node.id, redacted: true, labels: labels(node)}
    ELSE {id: node.id, redacted: false, labels: labels(node), name: node.name}
  END
] AS nodes
```

This should be reviewed carefully. Security logic in Cypher can get complex. For high-stakes systems, combine:

```text
- model-level security design,
- query-level filtering,
- application-level policy checks,
- audit logging,
- security tests with adversarial datasets.
```

---

## 45. Handling Large Graph Visualizations

Java backend often serves graph visualization UI.

Bad API:

```text
GET /graph/all
```

Better API family:

```text
GET /cases/{id}/network/summary
GET /cases/{id}/network?depth=1&limit=100
GET /network/nodes/{id}/expand?relationshipType=OWNS&limit=50
GET /network/search?q=...&caseId=...
GET /network/path?from=...&to=...&maxDepth=4
```

Graph visualization backend should support:

```text
- initial bounded neighborhood,
- explicit expansion,
- path search,
- node search,
- grouping/collapse,
- ranking,
- truncation metadata,
- redaction,
- stable IDs,
- incremental loading.
```

Java DTO:

```java
public record GraphView(
    List<NodeView> nodes,
    List<RelationshipView> relationships,
    boolean truncated,
    String truncationReason
) {}
```

Include truncation and expansion hints:

```java
public record NodeView(
    String id,
    String label,
    String displayName,
    boolean expandable,
    long hiddenNeighborCount
) {}
```

A graph UI without backend guardrails can become a denial-of-service generator.

---

## 46. Command Handler Pattern for Graph Writes

For writes, prefer command objects.

```java
public record CreateCaseCommand(
    String commandId,
    String caseId,
    String tenantId,
    String title,
    String actorId,
    Instant requestedAt
) {}
```

Benefits:

```text
- idempotency key included,
- audit fields included,
- validation centralized,
- easier testing,
- stable application contract,
- less parameter drift.
```

Repository method:

```java
public CaseCreated createCase(CreateCaseCommand command) {
    try (var session = driver.session(SessionConfig.forDatabase(databaseName))) {
        return session.executeWrite(tx -> {
            var result = tx.run("""
                MERGE (c:Case {id: $caseId})
                ON CREATE SET
                  c.tenantId = $tenantId,
                  c.title = $title,
                  c.status = 'OPEN',
                  c.createdAt = datetime($requestedAt),
                  c.createdBy = $actorId,
                  c.createCommandId = $commandId
                RETURN
                  c.id AS caseId,
                  c.createCommandId AS createCommandId
                """, Map.of(
                    "caseId", command.caseId(),
                    "tenantId", command.tenantId(),
                    "title", command.title(),
                    "actorId", command.actorId(),
                    "requestedAt", command.requestedAt().toString(),
                    "commandId", command.commandId()
                ));

            var record = result.single();
            return new CaseCreated(
                record.get("caseId").asString(),
                record.get("createCommandId").asString()
            );
        });
    }
}
```

But if a duplicate `caseId` with different command ID should be conflict, add check:

```cypher
MERGE (c:Case {id: $caseId})
ON CREATE SET
  c.createCommandId = $commandId,
  c.title = $title,
  c.createdAt = datetime()
WITH c
WHERE c.createCommandId = $commandId
RETURN c.id AS caseId
```

If no row returned, it means same case ID exists from another command.

---

## 47. Idempotency Pattern for Event Projection

When Neo4j is a projection from events, event replay must be safe.

Pattern:

```cypher
MERGE (event:ProcessedEvent {id: $eventId})
ON CREATE SET event.processedAt = datetime()
WITH event
WHERE event.applied IS NULL
MATCH (c:Case {id: $caseId})
MERGE (e:Entity {id: $entityId})
MERGE (c)-[:SUBJECT_OF]->(e)
SET event.applied = true
RETURN event.id AS eventId
```

But this has subtle issues under concurrency if not constrained properly.

Better ensure:

```text
- unique constraint on ProcessedEvent(id),
- event processing transaction is atomic,
- duplicate event returns deterministic result,
- failed partial event rolls back,
- event payload version is handled.
```

Java event handler:

```java
public void apply(CaseSubjectLinkedEvent event) {
    try (var session = driver.session(SessionConfig.forDatabase(databaseName))) {
        session.executeWrite(tx -> {
            tx.run("""
                MERGE (pe:ProcessedEvent {id: $eventId})
                ON CREATE SET
                  pe.type = $eventType,
                  pe.processedAt = datetime(),
                  pe.applied = false
                WITH pe
                WHERE pe.applied = false
                MERGE (c:Case {id: $caseId})
                MERGE (e:Entity {id: $entityId})
                MERGE (c)-[:SUBJECT_OF]->(e)
                SET pe.applied = true
                RETURN pe.id AS eventId
                """, Map.of(
                    "eventId", event.id(),
                    "eventType", event.type(),
                    "caseId", event.caseId(),
                    "entityId", event.entityId()
                )).consume();
            return null;
        });
    }
}
```

In some cases, if `WHERE pe.applied = false` returns no row for duplicates, that is okay. But your handler must interpret it as already applied, not failure.

---

## 48. Neo4j as Source of Truth vs Projection

Java integration differs depending on Neo4j’s role.

### Neo4j as Source of Truth

Neo4j owns canonical state.

Java must enforce:

```text
- strong write correctness,
- constraints,
- audit,
- backup/restore,
- schema migration,
- transaction semantics,
- domain invariants.
```

### Neo4j as Projection

Another system owns canonical state, Neo4j serves graph queries/analytics.

Java must enforce:

```text
- idempotent event ingestion,
- replayability,
- rebuild strategy,
- consistency lag visibility,
- reconciliation,
- projection versioning.
```

### Neo4j as Analytical Graph

Neo4j or GDS serves analytics/modeling.

Java must enforce:

```text
- job orchestration,
- projection snapshots,
- algorithm result versioning,
- score freshness,
- offline/online separation.
```

Do not use the same repository semantics for all three roles.

---

## 49. Type Conversion and Temporal Values

Neo4j supports temporal and spatial types. Java mapping must be explicit.

Example:

```cypher
RETURN datetime() AS now
```

Java driver value may map to temporal accessor types. Avoid casual string conversions unless your API contract is string-based.

For API DTOs, prefer clear standards:

```text
- Instant for absolute timestamps,
- LocalDate for date-only domain values,
- OffsetDateTime/ZonedDateTime only when timezone semantics matter,
- ISO-8601 string at API boundary if needed.
```

Be consistent.

Graph data becomes hard to govern when half the properties are strings and half are temporal types.

For money/decimal values, be careful with floating point.

For IDs, use strings or UUIDs consistently.

For enum-like statuses, validate in Java and consider Neo4j property type constraints where appropriate.

---

## 50. Handling `null`, Missing Properties, and Optional Data

Neo4j property absence is not always the same as Java `null` conceptually.

Cypher:

```cypher
MATCH (c:Case {id: $caseId})
RETURN c.closedAt AS closedAt
```

If `closedAt` is absent, result value may be null-like.

Java:

```java
Value closedAt = record.get("closedAt");
if (closedAt.isNull()) {
    return Optional.empty();
}
```

Do not blindly call:

```java
record.get("closedAt").asString()
```

If optional field is expected, map explicitly:

```java
private static Optional<String> optionalString(Value value) {
    return value.isNull() ? Optional.empty() : Optional.of(value.asString());
}
```

For lists:

```cypher
OPTIONAL MATCH (c)-[:SUBJECT_OF]->(e:Entity)
RETURN collect(e.id) AS entityIds
```

`collect()` often returns empty list when no optional matches, but query shape matters.

Test optional cases.

---

## 51. Cypher Query Structure for Java Mapping

Java mapping is easier when Cypher returns stable aliases.

Bad:

```cypher
RETURN c, e, r
```

Better:

```cypher
RETURN
  c.id AS caseId,
  c.title AS caseTitle,
  e.id AS entityId,
  e.name AS entityName,
  type(r) AS relationshipType
```

Even better for nested DTO:

```cypher
MATCH (c:Case {id: $caseId})
OPTIONAL MATCH (c)-[:HAS_SUBJECT_LINK]->(link:SubjectLink)-[:TO_ENTITY]->(e:Entity)
RETURN
  c.id AS caseId,
  c.title AS title,
  collect({
    linkId: link.id,
    entityId: e.id,
    entityName: e.name
  }) AS subjects
```

Then Java maps to `List<Map<String,Object>>` or custom mapping.

But be careful: collecting maps with optional null values can produce `{linkId: null, ...}` depending on query shape.

Safer:

```cypher
MATCH (c:Case {id: $caseId})
OPTIONAL MATCH (c)-[:HAS_SUBJECT_LINK]->(link:SubjectLink)-[:TO_ENTITY]->(e:Entity)
WITH c, collect(
  CASE WHEN link IS NULL THEN null ELSE {
    linkId: link.id,
    entityId: e.id,
    entityName: e.name
  } END
) AS rawSubjects
RETURN
  c.id AS caseId,
  c.title AS title,
  [x IN rawSubjects WHERE x IS NOT NULL] AS subjects
```

The extra clarity often saves mapper bugs.

---

## 52. Avoid Returning Huge `collect()` for Hot APIs

Nested projections are convenient, but can hide large aggregation.

```cypher
MATCH (c:Case {id: $caseId})
OPTIONAL MATCH (c)-[:HAS_EVENT]->(ev:Event)
RETURN c.id AS caseId, collect(ev) AS events
```

If a case has 1 million events, this is bad.

Better:

```text
Case detail endpoint:
  returns summary counts and latest N events.

Events endpoint:
  paginates events.

Graph endpoint:
  returns bounded relationship neighborhood.
```

Use separate read models.

---

## 53. Batch Writes From Java

For importing or updating many rows, do not execute one transaction per row unless volume is tiny.

Bad:

```java
for (InputRow row : rows) {
    try (var session = driver.session()) {
        session.executeWrite(tx -> {
            tx.run("MERGE ...", row.toParams()).consume();
            return null;
        });
    }
}
```

Better:

```java
List<Map<String, Object>> batch = rows.stream()
    .map(InputRow::toParams)
    .toList();

session.executeWrite(tx -> {
    tx.run("""
        UNWIND $rows AS row
        MERGE (p:Person {id: row.personId})
        SET p.name = row.name
        MERGE (o:Organization {id: row.organizationId})
        MERGE (p)-[:MEMBER_OF]->(o)
        """, Map.of("rows", batch)).consume();
    return null;
});
```

But batch size matters.

Too small:

```text
too many round trips, slow import
```

Too large:

```text
large transaction memory, locks held too long, rollback expensive
```

Practical approach:

```text
Batch size maybe 1k-10k rows depending on row complexity, relationship count, constraints, hardware, and query cost.
Measure, do not guess.
```

For very large initial imports, use Neo4j bulk import tools instead of application-level writes.

---

## 54. Backpressure in Ingestion Services

If a Java service consumes Kafka events and writes Neo4j, it must not consume faster than Neo4j can commit.

Architecture:

```text
Kafka consumer
  -> validation
  -> batching
  -> Neo4j write
  -> offset commit only after successful transaction
```

Risks:

```text
- committing offset before graph write succeeds,
- parallel consumers creating lock contention,
- duplicate events without idempotency,
- large batches causing transaction timeout,
- out-of-order events violating assumptions,
- dead-letter queue without replay plan.
```

For graph projections, design:

```text
- idempotency key per event,
- deterministic node/relationship IDs,
- schema constraints,
- retry for transient errors,
- DLQ for poison events,
- reconciliation job,
- projection lag metrics.
```

---

## 55. Lock Contention From Java Write Patterns

Graph writes can contend when many transactions touch the same node/relationship area.

Example:

```text
Many events update same Customer node counter.
Many transactions create relationships from same supernode.
Many imports MERGE same Category node.
```

Problematic pattern:

```cypher
MATCH (c:Customer {id: $customerId})
SET c.transactionCount = c.transactionCount + 1
```

This creates hot node writes.

Alternative:

```text
- compute counts asynchronously,
- store event relationships and aggregate later,
- bucket by time,
- avoid write-time counter when not essential,
- partition hot relationships through intermediate nodes.
```

Java service should be aware of contention patterns and not simply increase consumer concurrency.

Increasing concurrency can make lock contention worse.

---

## 56. Retry Policy and Idempotent Commands

Driver-managed transaction functions handle some retry behavior, but application-level retry may still exist around use cases.

Never retry blindly.

Retry safe:

```text
- idempotent command with deterministic IDs,
- transient errors,
- no external side effect inside retry scope,
- bounded retry count,
- jitter/backoff.
```

Retry unsafe:

```text
- generated new IDs on each attempt,
- sends email inside transaction callback,
- publishes message before transaction commit,
- non-idempotent external call,
- unknown partial outcome without idempotency key.
```

Command ID pattern:

```java
public record CommandEnvelope<T>(
    String commandId,
    T payload,
    Instant requestedAt
) {}
```

Cypher stores command ID:

```cypher
MERGE (cmd:ProcessedCommand {id: $commandId})
ON CREATE SET cmd.createdAt = datetime()
WITH cmd
WHERE cmd.applied IS NULL
// perform graph mutation
SET cmd.applied = true
RETURN cmd.id AS commandId
```

Again: test duplicate command behavior.

---

## 57. Clean Architecture Boundary

A robust Neo4j Java application can be layered like this:

```text
Controller/API
  - parse request
  - authenticate actor
  - validate basic shape

Application Service
  - authorize use case
  - enforce workflow
  - call repository
  - emit audit/outbox
  - map errors

Graph Repository / Query Gateway
  - own Cypher
  - own transaction function
  - own mapping from Record to projection
  - enforce query guardrails

Neo4j Driver Infrastructure
  - driver bean
  - configuration
  - connection pool
  - metrics

Neo4j Database
  - constraints/indexes
  - graph data
  - query execution
```

Anti-pattern:

```text
Controller builds Cypher string.
Service passes raw user filters into Cypher structure.
Repository returns raw Node.
Frontend decides traversal depth.
No query name.
No test dataset.
No timeout.
```

---

## 58. Example: Related Party Search Repository

Use case:

> Find entities related to a target entity within depth 2 via ownership/control/association relationships, excluding the entity itself, returning minimum distance and evidence count.

Cypher:

```cypher
MATCH path = (start:Entity {tenantId: $tenantId, id: $entityId})
  -[:OWNS|CONTROLS|ASSOCIATED_WITH*1..2]-(other:Entity {tenantId: $tenantId})
WHERE other.id <> start.id
WITH other, min(length(path)) AS distance, count(path) AS pathCount
RETURN
  other.id AS entityId,
  other.name AS name,
  distance,
  pathCount
ORDER BY distance ASC, pathCount DESC, name ASC
LIMIT $limit
```

Java projection:

```java
public record RelatedParty(
    String entityId,
    String name,
    int distance,
    long pathCount
) {}
```

Repository:

```java
public List<RelatedParty> findRelatedParties(
    String tenantId,
    String entityId,
    int limit
) {
    int safeLimit = Math.min(Math.max(limit, 1), 200);

    try (var session = driver.session(SessionConfig.forDatabase(databaseName))) {
        return session.executeRead(tx -> {
            var result = tx.run("""
                MATCH path = (start:Entity {tenantId: $tenantId, id: $entityId})
                  -[:OWNS|CONTROLS|ASSOCIATED_WITH*1..2]-(other:Entity {tenantId: $tenantId})
                WHERE other.id <> start.id
                WITH other, min(length(path)) AS distance, count(path) AS pathCount
                RETURN
                  other.id AS entityId,
                  other.name AS name,
                  distance,
                  pathCount
                ORDER BY distance ASC, pathCount DESC, name ASC
                LIMIT $limit
                """, Map.of(
                    "tenantId", tenantId,
                    "entityId", entityId,
                    "limit", safeLimit
                ));

            return result.list(record -> new RelatedParty(
                record.get("entityId").asString(),
                record.get("name").asString(""),
                record.get("distance").asInt(),
                record.get("pathCount").asLong()
            ));
        });
    }
}
```

Production considerations:

```text
- Ensure index/constraint on :Entity(tenantId, id) or equivalent.
- Confirm relationship types are correct and bounded.
- Test with high-degree entities.
- Consider path uniqueness/duplicates depending on business meaning.
- Add truncation signal if result count hits limit.
- Add security trimming if entity visibility differs.
```

---

## 59. Example: Conflict of Interest Detection

Use case:

> An officer should not review a case if they are connected to a subject entity within certain relationship types and depth.

Cypher:

```cypher
MATCH (case:Case {tenantId: $tenantId, id: $caseId})
MATCH (officer:Officer {tenantId: $tenantId, id: $officerId})
MATCH (case)-[:HAS_SUBJECT_LINK]->(:SubjectLink)-[:TO_ENTITY]->(subject:Entity)
MATCH path = (officer)-[:EMPLOYED_BY|OWNS|CONTROLS|ASSOCIATED_WITH*1..3]-(subject)
RETURN
  subject.id AS subjectId,
  length(path) AS distance,
  [rel IN relationships(path) | type(rel)] AS relationshipTypes
ORDER BY distance ASC
LIMIT 10
```

Java result:

```java
public record ConflictOfInterestHit(
    String subjectId,
    int distance,
    List<String> relationshipTypes
) {}
```

Application service:

```java
public void assertNoConflict(String tenantId, String caseId, String officerId) {
    List<ConflictOfInterestHit> hits = repository.findConflictHits(tenantId, caseId, officerId);
    if (!hits.isEmpty()) {
        throw new ConflictOfInterestException(caseId, officerId, hits);
    }
}
```

This is where graph shines: not because we store officers and cases, but because conflict is path-shaped.

---

## 60. Example: Dependency Impact Analysis

Use case:

> Given a service/component, find downstream components impacted within 4 hops.

Cypher:

```cypher
MATCH path = (s:Service {id: $serviceId})-[:DEPENDS_ON*1..4]->(downstream:Service)
RETURN
  downstream.id AS serviceId,
  min(length(path)) AS distance,
  count(path) AS pathCount
ORDER BY distance ASC, pathCount DESC
LIMIT $limit
```

But direction depends on semantics.

If `A-[:DEPENDS_ON]->B` means A depends on B, then:

```text
B failure impacts A.
```

So impact query may need reverse direction:

```cypher
MATCH path = (failed:Service {id: $serviceId})<-[:DEPENDS_ON*1..4]-(impacted:Service)
RETURN impacted.id AS serviceId, min(length(path)) AS distance
```

Java repository should encode direction by method name:

```java
findServicesImpactedByFailure(serviceId)
findDependenciesRequiredByService(serviceId)
```

Do not expose ambiguous `findRelatedServices` for dependency graph.

---

## 61. Avoiding Cypher Injection in Graph Filters

Graph APIs often allow filters:

```text
relationshipTypes=OWNS,CONTROLS
labels=Person,Company
maxDepth=3
```

Do not directly inject arbitrary label/type strings.

Use allowlists:

```java
public enum NetworkRelationshipType {
    OWNS,
    CONTROLS,
    ASSOCIATED_WITH,
    HAS_SUBJECT_LINK,
    TO_ENTITY,
    SUPPORTED_BY
}
```

Build relationship type segment:

```java
String typeExpression = relationshipTypes.stream()
    .map(NetworkRelationshipType::name)
    .collect(Collectors.joining("|"));
```

Then:

```java
String cypher = """
    MATCH path = (n:Entity {id: $id})-[:%s*1..2]-(m)
    RETURN path
    LIMIT $limit
    """.formatted(typeExpression);
```

Depth should be validated and possibly represented with fixed variants.

Never allow raw user Cypher unless you are intentionally building an admin query console with strict isolation and permissions.

---

## 62. Configuration Management

Neo4j integration configuration should include:

```text
neo4j.uri
neo4j.username
neo4j.password/secret reference
neo4j.database
neo4j.maxConnectionPoolSize
neo4j.connectionAcquisitionTimeout
neo4j.maxTransactionRetryTime
neo4j.fetchSize
neo4j.queryTimeout if applicable
```

Use secret management, not plain config files.

For local development:

```yaml
neo4j:
  uri: bolt://localhost:7687
  database: neo4j
```

For production:

```text
- secrets from vault/KMS/secret manager,
- TLS as required,
- least privilege user,
- explicit database,
- environment-specific pool settings,
- metrics enabled.
```

---

## 63. Health Checks

Application health check should distinguish:

```text
Liveness:
  Is application process alive?

Readiness:
  Can application serve traffic, including Neo4j dependency?

Deep dependency check:
  Can execute a simple query against configured database?
```

Simple query:

```cypher
RETURN 1 AS ok
```

But be careful: running database query on every liveness probe can overload dependencies or cause cascading restarts.

Recommended:

```text
- liveness: no database dependency,
- readiness: lightweight connectivity check with caching/throttling,
- startup check: verify driver connectivity and schema readiness,
- operational dashboard: deeper checks.
```

---

## 64. Schema Readiness on Startup

Java application may assume constraints/indexes exist.

Options:

```text
1. Migrations create schema before app deploy.
2. App verifies schema on startup and fails fast if missing.
3. App creates schema automatically in controlled environments.
```

For production, prefer migration pipeline.

Example expected constraints:

```cypher
CREATE CONSTRAINT entity_tenant_id_unique IF NOT EXISTS
FOR (e:Entity)
REQUIRE (e.tenantId, e.id) IS UNIQUE
```

Application startup can run:

```cypher
SHOW CONSTRAINTS
```

And verify required constraints exist.

Failing fast is better than silently running label scans in production.

---

## 65. Migration Tooling

Neo4j schema/data migration can be managed with tools or custom migration runners.

Core requirements:

```text
- ordered migrations,
- idempotent where possible,
- applied migration tracking,
- rollback strategy or forward-fix strategy,
- environment promotion,
- query plan review after migration,
- data backfill safety.
```

Migration categories:

```text
Schema migration:
  constraints, indexes

Data migration:
  create new labels/properties/relationships

Model migration:
  reify relationships, split labels, change relationship type

Query migration:
  update application Cypher and DTOs
```

Graph model migrations can be more complex than relational column migrations because relationship topology changes.

Part 030 will go deeper.

---

## 66. Testing With Representative Topology, Not Just Representative Rows

In relational testing, representative rows may be enough.

In graph testing, topology matters.

You need datasets that represent:

```text
- high-degree nodes,
- cycles,
- many short paths,
- long chains,
- disconnected nodes,
- missing optional links,
- duplicate-like entities,
- cross-tenant accidental links,
- sensitive nodes,
- stale temporal relationships.
```

A query that works on 10 simple nodes may fail on one dense customer with 500k relationships.

Performance testing must include topology stress.

---

## 67. Thread Safety

General lifecycle rule:

```text
Driver:
  share safely as application singleton.

Session:
  do not share across threads.

Transaction:
  do not share across threads.

Result:
  consume within transaction/session lifecycle.
```

This rule helps avoid subtle bugs.

Do not store `Session`, `Transaction`, or `Result` in fields.

Bad:

```java
public class Repo {
    private Session session; // bad
}
```

Better:

```java
try (var session = driver.session()) {
    return session.executeRead(tx -> ...);
}
```

---

## 68. Memory Discipline in Java Mapping

Avoid mapping huge result sets into lists unless the use case requires it.

Bad:

```java
List<Record> all = result.list();
```

For bounded API result, okay.

For exports/jobs, stream or batch.

Also avoid storing raw `Node`/`Relationship` driver objects in long-lived caches. They represent database values, not domain cache entries.

If caching is needed, cache explicit read model DTOs with clear invalidation/freshness semantics.

---

## 69. Caching Graph Results

Caching graph query results can help, but invalidation is hard because graph results depend on neighborhoods.

A cached case network can become stale if:

```text
- a subject is added,
- evidence is removed,
- entity name changes,
- relationship type changes,
- access permission changes,
- risk score changes,
- tenant policy changes.
```

Cache only when:

```text
- staleness is acceptable,
- invalidation scope is understood,
- response is expensive and frequently reused,
- security context is included in cache key,
- truncation/filter parameters are included in cache key.
```

Cache key must include:

```text
tenantId
actor/role/security scope
graph center
depth
relationship filters
node filters
limit
query version
```

Do not cache sensitive graph responses globally.

---

## 70. API Contract for Partial Graph Results

Graph result APIs should communicate partialness.

```java
public record NetworkResponse(
    String centerNodeId,
    int requestedDepth,
    int returnedNodeCount,
    int returnedRelationshipCount,
    boolean truncated,
    String truncationReason,
    List<NodeResponse> nodes,
    List<RelationshipResponse> relationships
) {}
```

Truncation reasons:

```text
LIMIT_REACHED
DEPTH_LIMIT_REACHED
SECURITY_REDACTION
TIME_BUDGET_EXCEEDED
HIGH_DEGREE_NODE_COLLAPSED
```

This is not cosmetic. It protects user interpretation.

In investigation workflows, a partial graph presented as complete can mislead decisions.

---

## 71. Designing for Explainability

When graph query drives decision support, return explanation data.

Example related-party result:

```java
public record RelatedPartyExplanation(
    String relatedEntityId,
    int distance,
    List<PathExplanation> paths
) {}

public record PathExplanation(
    List<PathStep> steps,
    String confidence,
    List<String> evidenceIds
) {}
```

Cypher can return path relationship types:

```cypher
RETURN
  other.id AS relatedEntityId,
  length(path) AS distance,
  [rel IN relationships(path) | type(rel)] AS relationshipTypes,
  [node IN nodes(path) | node.id] AS nodeIds
```

But business explanation often needs more than raw path:

```text
- why this path matters,
- whether relationship is current or historical,
- evidence source,
- confidence,
- last updated,
- whether any node is redacted.
```

Java layer can transform raw path into human-meaningful explanation.

---

## 72. Integrating With Graph Data Science Results

Later parts cover GDS, but Java applications often consume GDS-produced scores.

Example:

```text
GDS job computes risk centrality score.
Scores written to Entity.riskCentrality.
Java service reads score in related party search.
```

Repository query:

```cypher
MATCH (e:Entity {tenantId: $tenantId, id: $entityId})
RETURN e.id AS id, e.riskCentrality AS riskCentrality, e.riskScoreVersion AS riskScoreVersion
```

Application contract should include freshness/version:

```java
public record EntityRiskView(
    String entityId,
    double centrality,
    String scoreVersion,
    Instant computedAt
) {}
```

Do not present analytical score as timeless truth.

Graph analytics outputs need versioning and interpretation.

---

## 73. Integrating With Search/OLAP/Relational Systems

Neo4j rarely lives alone.

Typical architecture:

```text
PostgreSQL/MySQL:
  source-of-truth transactional records

Kafka/RabbitMQ:
  event propagation

Neo4j:
  relationship query/projection/connected reasoning

Elasticsearch:
  text search

ClickHouse/OLAP:
  large aggregate analytics

Redis:
  cache/rate/session when needed
```

Java service must avoid pretending Neo4j owns everything unless it truly does.

Example read flow:

```text
1. Search entities by text in Elasticsearch.
2. Take top entity IDs.
3. Query Neo4j for relationship context between them and a case.
4. Return combined result.
```

Example write flow:

```text
1. Command updates relational source-of-truth.
2. Event emitted.
3. Projection consumer updates Neo4j.
4. API exposes graph freshness timestamp.
```

Integration design must make consistency lag explicit.

---

## 74. When Not to Use Java Driver Directly

Raw Java Driver is powerful, but not always the best abstraction.

Use higher-level framework when:

```text
- CRUD dominates,
- graph shape is simple,
- team values convention,
- query performance is not critical,
- Spring Data Neo4j mapping fits naturally.
```

Use raw driver when:

```text
- query is path-heavy,
- performance is critical,
- projection is custom,
- traversal boundaries must be explicit,
- Cypher needs careful tuning,
- security trimming is complex,
- repository is use-case oriented.
```

Use Neo4j GraphQL library only if:

```text
- GraphQL API maps well to graph model,
- authorization is carefully designed,
- query complexity is controlled,
- generated access patterns are reviewed.
```

Do not expose flexible graph query power to clients without strict complexity controls.

---

## 75. Production Readiness Checklist for Java + Neo4j

Before going production, verify:

```text
Driver lifecycle
  [ ] Driver singleton per app instance.
  [ ] Driver closed on shutdown.
  [ ] Sessions are short-lived.
  [ ] Transactions are explicit.

Configuration
  [ ] Explicit URI/database.
  [ ] Secrets managed securely.
  [ ] Pool size configured.
  [ ] Timeouts configured.
  [ ] TLS/security configured as required.

Query design
  [ ] Critical queries named.
  [ ] Query parameters used for values.
  [ ] Dynamic labels/types are allowlisted.
  [ ] Traversal depth bounded.
  [ ] Result limit bounded.
  [ ] No N+1 Cypher loops in hot paths.
  [ ] Critical queries profiled.

Mapping
  [ ] DTO projections explicit.
  [ ] Raw Node/Relationship not leaked broadly.
  [ ] Optional/null handling tested.
  [ ] Large results streamed/batched.

Write correctness
  [ ] Commands have idempotency keys.
  [ ] MERGE semantics reviewed.
  [ ] Constraints support identity.
  [ ] Transaction functions have no unsafe side effects.
  [ ] Transient errors handled.

Security
  [ ] Tenant boundary enforced in query/repository.
  [ ] Security trimming tested.
  [ ] Sensitive properties not logged.
  [ ] Unauthorized path leakage tested.

Testing
  [ ] Integration tests use real Neo4j/Testcontainers.
  [ ] Golden topology datasets exist.
  [ ] Supernode/dense cases tested.
  [ ] Optional relationship cases tested.
  [ ] Query performance regression checked.

Observability
  [ ] Query duration by query name.
  [ ] Error classification metrics.
  [ ] Retry/transient error metrics.
  [ ] Slow query correlation.
  [ ] Truncation metadata tracked.

Operations
  [ ] Schema migration pipeline.
  [ ] Startup schema verification or deploy gate.
  [ ] Backup/restore owned by platform.
  [ ] Cluster routing behavior understood.
```

---

## 76. Common Failure Modes

### Failure Mode 1: Driver Per Request

Symptom:

```text
High latency, connection churn, CPU overhead, unstable throughput.
```

Fix:

```text
Singleton Driver, short-lived sessions.
```

### Failure Mode 2: Java-Side Traversal

Symptom:

```text
N+1 queries, many round trips, slow API.
```

Fix:

```text
Let Cypher express traversal.
```

### Failure Mode 3: Returning Raw Graph Everywhere

Symptom:

```text
API payload huge, security leaks, frontend coupled to database model.
```

Fix:

```text
Use explicit projections.
```

### Failure Mode 4: Unbounded Client-Controlled Depth

Symptom:

```text
Path explosion, timeout, memory pressure.
```

Fix:

```text
Validate depth and relationship filters server-side.
```

### Failure Mode 5: Non-Idempotent Retry

Symptom:

```text
Duplicate side effects, duplicate external calls, inconsistent audit.
```

Fix:

```text
Idempotency keys, no external side effects inside retryable transaction callback.
```

### Failure Mode 6: Missing Tenant Filter

Symptom:

```text
Cross-tenant data leak.
```

Fix:

```text
Tenant-aware repository methods and security tests.
```

### Failure Mode 7: Treating Spring Data Neo4j Like JPA

Symptom:

```text
Unexpected loading, hidden traversal, poor performance.
```

Fix:

```text
Use custom Cypher for graph-heavy use cases; control mapping depth.
```

---

## 77. Mental Model Summary

A mature Java + Neo4j integration is built around these principles:

```text
1. Cypher is the data access contract.
2. Repository methods should represent graph questions and graph mutations.
3. Driver is long-lived; session/transaction are short-lived.
4. Transaction callbacks must be idempotent and side-effect safe.
5. Java should not manually traverse graph through loops of queries.
6. Return projections, not accidental database objects.
7. Traversal depth, relationship scope, limit, and security context must be explicit.
8. Critical queries must be named, profiled, tested, and monitored.
9. Neo4j integration design depends on whether Neo4j is source-of-truth, projection, or analytical graph.
10. Graph correctness is a joint responsibility of model, constraints, Cypher, Java service, and operations.
```

If you internalize only one sentence from this part:

> Java should orchestrate graph use cases; Neo4j should execute graph traversal; Cypher should define the exact graph question; DTOs should expose only the intended projection.

---

## 78. Practical Exercises

### Exercise 1 — Build a Raw Driver Repository

Create a small Java/Spring Boot repository with:

```text
- singleton Driver bean,
- explicit database config,
- read transaction method,
- write transaction method,
- query names,
- DTO projections.
```

Implement:

```text
findRelatedEntities(entityId, depth, limit)
linkEntityToCase(command)
loadCaseNetwork(caseId, depth, limit)
```

### Exercise 2 — Kill N+1 Traversal

Start with Java code that loops over cases and queries subjects one by one.

Refactor into a single Cypher query using:

```text
WHERE c.id IN $caseIds
OPTIONAL MATCH
collect()
```

Compare:

```text
- round trips,
- duration,
- row count,
- code complexity.
```

### Exercise 3 — Add Idempotency Key

Implement command:

```text
LinkSubjectToCase(commandId, caseId, entityId, evidenceId, actorId)
```

Run it twice.

Expected result:

```text
- no duplicate link,
- deterministic result,
- audit/outbox behavior safe.
```

### Exercise 4 — Test Topology Edge Cases

Create test dataset:

```text
- simple chain,
- cycle,
- high-degree node,
- missing evidence,
- cross-tenant relationship.
```

Assert:

```text
- depth boundary,
- no cross-tenant leakage,
- no infinite traversal,
- correct empty result semantics.
```

### Exercise 5 — Add Observability

Wrap query execution with metrics:

```text
queryName
durationMs
rowCount
errorClass
truncated
```

Trigger one slow query and verify logs/metrics.

---

## 79. What This Part Deliberately Did Not Cover Deeply

We did not go deeply into Spring Data Neo4j because it deserves its own treatment in Part 014.

We did not go deeply into ingestion pipelines because Part 015 covers ETL/CDC/event projection.

We did not go deeply into transactions/consistency because Part 016 covers correctness at a broader level.

We did not go deeply into clustering/routing because Part 018 covers high availability and cluster behavior.

We did not go deeply into security/multi-tenancy because Part 019 covers it comprehensively.

This part focused on the Java application boundary.

---

## 80. Closing

Java integration with Neo4j is easy to start but hard to do well at scale.

The beginner version is:

```text
Connect driver.
Run query.
Map result.
```

The production version is:

```text
Own the graph question.
Bound the traversal.
Parameterize safely.
Use transaction functions correctly.
Make writes idempotent.
Return explicit projections.
Test real graph topology.
Observe query behavior.
Respect security and tenant boundaries.
Avoid hiding traversal behind object mapping.
```

A top-tier Java engineer using Neo4j does not merely know the driver API.

They understand how graph modelling, Cypher execution, transaction semantics, application boundaries, and operational guardrails combine into a system that remains correct under scale, concurrency, failure, and change.

---

# Status Seri

```text
Part 000 selesai — Orientation: Why Graph Database Exists and What Problem It Actually Solves
Part 001 selesai — Graph Thinking: From Entities to Relationships to Paths
Part 002 selesai — Property Graph Model Deep Dive
Part 003 selesai — Neo4j Architecture: Storage, Query Engine, and Runtime Mental Model
Part 004 selesai — Cypher Fundamentals: Pattern Matching as a Query Language
Part 005 selesai — Cypher Path Semantics: Variable-Length Traversal, Shortest Path, and Expansion Control
Part 006 selesai — Graph Modelling Methodology: From Requirements to Graph Shape
Part 007 selesai — Advanced Graph Modelling Patterns
Part 008 selesai — Anti-Patterns in Graph Modelling
Part 009 selesai — Schema, Constraints, Indexes, and Data Integrity in Neo4j
Part 010 selesai — Write Modelling: MERGE, Idempotency, Upserts, and Concurrency
Part 011 selesai — Query Performance: PROFILE, EXPLAIN, Cardinality, and Plan Tuning
Part 012 selesai — Supernodes, Dense Graphs, and Traversal Explosion
Part 013 selesai — Java Application Integration with Neo4j
```

Seri belum selesai. Masih ada Part 014 sampai Part 032.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-012.md">⬅️ Part 012 — Supernodes, Dense Graphs, and Traversal Explosion</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-014.md">Part 014 — Spring Data Neo4j: Productivity, Boundaries, and Traps ➡️</a>
</div>
