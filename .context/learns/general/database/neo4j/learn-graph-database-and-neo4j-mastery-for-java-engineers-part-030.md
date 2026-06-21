# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-030.md

# Part 030 — Testing, Migration, Refactoring, and Evolution of Graph Systems

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Audiens: Java software engineer / tech lead  
> Fokus: testing graph model, Cypher contract tests, migration, refactoring, backward-compatible graph evolution, rebuildable projections, and production-safe change management  
> Status seri: Part 030 dari 032  
> Prasyarat: Part 000–029, terutama modelling methodology, Cypher, constraints/indexes, query performance, Java integration, operations, and domain case studies.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas lifecycle engineering untuk sistem graph.

Setelah graph system masuk production, tantangan utamanya bukan hanya:

```text
"Apakah query bisa jalan?"
```

Tetapi:

```text
Apakah model graph tetap benar saat domain berubah?
Apakah query tetap cepat saat data tumbuh?
Apakah path explanation tetap valid setelah refactor?
Apakah schema migration aman?
Apakah data migration bisa diulang?
Apakah projection bisa dibangun ulang?
Apakah invariant domain bisa dites?
Apakah graph bisa berevolusi tanpa menghancurkan consumer lama?
```

Graph system sering gagal bukan karena Neo4j tidak mampu, tetapi karena engineering lifecycle-nya diperlakukan seperti database CRUD biasa.

Dalam relational system, perubahan schema sering terlihat jelas:

```text
ALTER TABLE
ADD COLUMN
DROP COLUMN
CREATE INDEX
```

Dalam graph system, perubahan bisa lebih subtil:

```text
relationship type berubah
direction berubah
label taxonomy berubah
property dipindah dari relationship ke node
node reification ditambahkan
derived edge dibuat
path semantics berubah
query expansion depth berubah
temporal validity ditambahkan
tenant boundary diperketat
```

Perubahan seperti ini bisa menghancurkan makna query tanpa error compile.

Karena itu, graph system butuh testing dan migration strategy yang lebih semantik.

---

## 1. Core Principle: Test the Graph Semantics, Not Only the Code

Aplikasi Java biasanya sudah familiar dengan:

- unit tests,
- integration tests,
- repository tests,
- contract tests,
- load tests.

Untuk graph system, kita perlu menambahkan layer:

```text
graph model tests
query semantic tests
path explanation tests
invariant tests
migration tests
refactoring regression tests
projection rebuild tests
performance-plan tests
data quality tests
```

Karena graph database menyimpan **structure**, maka correctness tidak hanya berada di value, tetapi juga:

- node labels,
- relationship types,
- relationship direction,
- path existence,
- path non-existence,
- traversal boundary,
- duplicate semantics,
- lifecycle validity,
- source provenance,
- tenant isolation.

Contoh bug graph yang tidak terlihat oleh unit test biasa:

```text
A relationship direction accidentally reversed.
A new label added but query still starts from old label only.
A refactor creates both old and new relationship types, causing duplicated access.
A variable-length traversal now crosses tenant boundary.
A derived EFFECTIVE_ACCESS edge is stale.
A path explanation includes revoked grant because validTo filter was forgotten.
A supernode expansion introduced by a new group ruins performance.
A permission is reachable through two paths and counted twice.
```

Graph testing harus memverifikasi:

```text
What paths should exist?
What paths must never exist?
What paths should be explainable?
What relationship types are allowed?
What cardinality is expected?
What duplicates are acceptable?
What historical point-in-time semantics apply?
```

---

## 2. Taxonomy of Graph Tests

Gunakan taxonomy ini untuk membangun test suite.

```text
1. Model shape tests
2. Constraint/index tests
3. Invariant tests
4. Query contract tests
5. Path explanation tests
6. Data quality tests
7. Migration tests
8. Refactoring tests
9. Projection rebuild tests
10. Performance regression tests
11. Security/tenant isolation tests
12. Operational recovery tests
```

Masing-masing punya tujuan berbeda.

---

## 3. Model Shape Tests

Model shape test memastikan graph memiliki struktur yang diharapkan.

Contoh invariant shape:

```text
Every active User must belong to exactly one Tenant.
Every active ServiceAccount must be owned by a Team.
Every Grant must point to exactly one subject.
Every privileged Grant must have approval evidence.
Every Permission must be attached to at least one Resource or ResourceType.
Every Resource must have classification.
Every relationship representing lifecycle must have sourceSystem and validFrom.
```

### 3.1 Example: user must belong to tenant

```cypher
MATCH (u:User {status: "ACTIVE"})
WHERE NOT (u)-[:BELONGS_TO_TENANT]->(:Tenant)
RETURN count(u) AS violations;
```

Expected:

```text
violations = 0
```

### 3.2 Example: service account must have owner

```cypher
MATCH (sa:ServiceAccount {status: "ACTIVE"})
WHERE NOT (sa)<-[:OWNS]-(:Team)
RETURN sa.id AS serviceAccountId
LIMIT 100;
```

Expected:

```text
no rows
```

### 3.3 Example: no relationship without source metadata

```cypher
MATCH ()-[r:MEMBER_OF|ASSIGNED_TO|GRANTS]->()
WHERE r.sourceSystem IS NULL
RETURN type(r) AS relationshipType, count(r) AS missingSourceCount;
```

Expected:

```text
no rows
```

Model shape tests are cheap, and they catch many production data quality failures.

---

## 4. Constraint and Index Tests

Neo4j supports constraints and indexes. The test suite should verify they exist, not only assume migration ran.

### 4.1 Constraint examples

```cypher
CREATE CONSTRAINT user_id_unique IF NOT EXISTS
FOR (u:User)
REQUIRE u.id IS UNIQUE;

CREATE CONSTRAINT resource_id_unique IF NOT EXISTS
FOR (r:Resource)
REQUIRE r.id IS UNIQUE;

CREATE CONSTRAINT grant_id_unique IF NOT EXISTS
FOR (g:Grant)
REQUIRE g.id IS UNIQUE;
```

### 4.2 Index examples

```cypher
CREATE INDEX user_status_idx IF NOT EXISTS
FOR (u:User)
ON (u.status);

CREATE INDEX resource_classification_idx IF NOT EXISTS
FOR (r:Resource)
ON (r.classification);

CREATE INDEX grant_status_expiry_idx IF NOT EXISTS
FOR (g:Grant)
ON (g.status, g.expiresAt);
```

### 4.3 Test schema presence

```cypher
SHOW CONSTRAINTS
YIELD name, type, labelsOrTypes, properties
RETURN name, type, labelsOrTypes, properties;
```

```cypher
SHOW INDEXES
YIELD name, type, labelsOrTypes, properties, state
RETURN name, type, labelsOrTypes, properties, state;
```

Expected:

```text
all required constraints exist
all required indexes exist
all indexes are ONLINE
```

### 4.4 Why this matters

A graph query can silently degrade if a required index is missing.

Example:

```cypher
MATCH (u:User {id: $userId})
...
```

Without index/constraint on `User.id`, the query may label-scan all users.

This is not a small issue. It changes the starting cost of every traversal.

---

## 5. Invariant Tests

Invariant tests verify business rules that must always hold.

Graph invariants often involve paths.

### 5.1 No active access via revoked grant

```cypher
MATCH path =
  (:User)-[:HAS_GRANT]->(g:Grant {status: "REVOKED"})
  -[:GRANTS_ROLE|GRANTS_PERMISSION]->()
RETURN path
LIMIT 100;
```

Expected:

```text
no active access calculation should use this path
```

A stricter invariant:

```cypher
MATCH (u:User)-[:EFFECTIVE_ACCESS]->(res:Resource)
MATCH (u)-[:HAS_GRANT]->(g:Grant {status: "REVOKED"})
WHERE EXISTS {
  MATCH (g)-[:APPLIES_TO]->(res)
}
RETURN u.id, res.id, g.id
LIMIT 100;
```

Expected:

```text
no rows
```

### 5.2 No cross-tenant access without explicit exception

```cypher
MATCH (u:User)-[:BELONGS_TO_TENANT]->(tu:Tenant)
MATCH (res:Resource)-[:BELONGS_TO_TENANT]->(tr:Tenant)
MATCH (u)-[:EFFECTIVE_ACCESS]->(res)
WHERE tu <> tr
  AND NOT EXISTS {
    MATCH (u)-[:HAS_CROSS_TENANT_EXCEPTION]->(tr)
  }
RETURN u.id AS userId,
       tu.id AS userTenant,
       res.id AS resourceId,
       tr.id AS resourceTenant
LIMIT 100;
```

Expected:

```text
no rows
```

### 5.3 No privileged role without owner and review

```cypher
MATCH (r:Role {privileged: true})
WHERE NOT (r)<-[:OWNS]-(:Team)
   OR NOT (r)-[:REVIEWED_IN]->(:ReviewCampaign)
RETURN r.id, r.name
LIMIT 100;
```

Expected:

```text
no rows
```

### 5.4 Every derived edge must be explainable

If we materialize:

```text
(:User)-[:EFFECTIVE_ACCESS]->(:Resource)
```

then every derived edge should have a path back to raw facts.

```cypher
MATCH (u:User)-[ea:EFFECTIVE_ACCESS]->(res:Resource)
WHERE NOT EXISTS {
  MATCH (u)-[:MEMBER_OF*0..4]->(principal)
  MATCH (principal)-[:ASSIGNED_TO]->(:Role)-[:GRANTS]->(:Permission)-[:ON]->(res)
}
RETURN u.id, res.id, ea.action
LIMIT 100;
```

Expected:

```text
no rows
```

This catches stale materialized access.

---

## 6. Query Contract Tests

Cypher is application logic. Treat it like code.

A query contract test specifies:

```text
Given this graph fixture,
when this query runs,
then it returns these rows,
with these path shapes,
without duplicates,
within this result bound.
```

### 6.1 Example fixture

```cypher
CREATE
  (alice:User {id: "u-alice", status: "ACTIVE"}),
  (finance:Group {id: "g-finance"}),
  (approver:Role {id: "r-approver", privileged: true}),
  (perm:Permission {id: "p-approve", action: "APPROVE"}),
  (payment:Resource {id: "res-payment", classification: "HIGH"}),
  (alice)-[:MEMBER_OF {status: "ACTIVE"}]->(finance),
  (finance)-[:ASSIGNED_TO {status: "ACTIVE"}]->(approver),
  (approver)-[:GRANTS]->(perm),
  (perm)-[:ON]->(payment);
```

### 6.2 Query under test

```cypher
MATCH (u:User {id: $userId})
MATCH path =
  (u)-[:MEMBER_OF*0..4]->(principal)
  -[:ASSIGNED_TO]->(role:Role)
  -[:GRANTS]->(perm:Permission {action: $action})
  -[:ON]->(res:Resource {id: $resourceId})
RETURN role.id AS roleId,
       perm.id AS permissionId,
       res.id AS resourceId,
       length(path) AS pathLength;
```

Expected:

```json
{
  "roleId": "r-approver",
  "permissionId": "p-approve",
  "resourceId": "res-payment",
  "pathLength": 4
}
```

### 6.3 Contract dimensions

Test not only rows, but semantics:

```text
[ ] Does it return one result or many?
[ ] Does it include revoked relationships?
[ ] Does it include expired grants?
[ ] Does it cross tenant boundaries?
[ ] Does it duplicate via multiple equivalent paths?
[ ] Does it return stable ordering if order matters?
[ ] Does it expose hidden path segments?
[ ] Does it work with zero-hop case?
[ ] Does it work with nested group depth max?
[ ] Does it fail safely when input not found?
```

---

## 7. Path Explanation Tests

Graph systems often produce explanations:

```text
Alice can approve payment because Alice -> FinanceGroup -> ApproverRole -> Permission -> Resource.
```

This output must be tested.

### 7.1 Why path explanation tests matter

A query may still return `allowed = true`, but explanation may be wrong.

Examples:

```text
It explains access via expired grant.
It chooses arbitrary path out of multiple paths.
It omits approval evidence.
It reveals sensitive intermediate group.
It includes relationship that should have been filtered by validTo.
```

### 7.2 Path shape assertion

Expected path pattern:

```text
User -MEMBER_OF*0..4-> Principal -ASSIGNED_TO-> Role -GRANTS-> Permission -ON-> Resource
```

Test query:

```cypher
MATCH path =
  (:User {id: $userId})
  -[:MEMBER_OF*0..4]->()
  -[:ASSIGNED_TO]->(:Role)
  -[:GRANTS]->(:Permission {action: $action})
  -[:ON]->(:Resource {id: $resourceId})
RETURN [n IN nodes(path) | labels(n)] AS nodeLabels,
       [r IN relationships(path) | type(r)] AS relTypes;
```

Expected relationship sequence examples:

```text
["MEMBER_OF", "ASSIGNED_TO", "GRANTS", "ON"]
["MEMBER_OF", "MEMBER_OF", "ASSIGNED_TO", "GRANTS", "ON"]
```

### 7.3 Sensitive path redaction test

If hidden group exists:

```cypher
(:Group {id: "g-breakglass", sensitive: true})
```

Then user-facing explanation should not expose raw internal name unless viewer is authorized.

Test:

```text
viewer without privilege sees "Privileged internal group"
viewer with privilege sees "BreakGlassProdAdmins"
```

This test may be implemented in Java service layer, not only Cypher.

---

## 8. Integration Testing with Testcontainers

For Java engineers, integration tests should run against real Neo4j, not an in-memory mock.

Graph query correctness depends on:

- Cypher parser,
- planner,
- constraints,
- indexes,
- transaction semantics,
- path matching,
- data type semantics.

A mock cannot safely reproduce that.

### 8.1 Conceptual Java setup

```java
@Testcontainers
class AccessGraphRepositoryIT {

    @Container
    static Neo4jContainer<?> neo4j = new Neo4jContainer<>("neo4j:5")
            .withAdminPassword("secret");

    Driver driver;

    @BeforeEach
    void setUp() {
        driver = GraphDatabase.driver(
            neo4j.getBoltUrl(),
            AuthTokens.basic("neo4j", "secret")
        );

        try (Session session = driver.session()) {
            session.executeWrite(tx -> {
                tx.run("""
                    CREATE CONSTRAINT user_id_unique IF NOT EXISTS
                    FOR (u:User)
                    REQUIRE u.id IS UNIQUE
                """);
                return null;
            });
        }
    }

    @AfterEach
    void tearDown() {
        driver.close();
    }
}
```

### 8.2 Test fixture loading

```java
void loadFixture(String cypher) {
    try (Session session = driver.session()) {
        session.executeWrite(tx -> {
            tx.run(cypher).consume();
            return null;
        });
    }
}
```

### 8.3 Query test

```java
@Test
void shouldExplainInheritedPaymentApproval() {
    loadFixture("""
        CREATE
          (alice:User {id: 'u-alice', status: 'ACTIVE'}),
          (finance:Group {id: 'g-finance'}),
          (role:Role {id: 'r-payment-approver', privileged: true}),
          (perm:Permission {id: 'p-approve-payment', action: 'APPROVE_PAYMENT'}),
          (res:Resource {id: 'res-payment-prod', classification: 'HIGH'}),
          (alice)-[:MEMBER_OF {status: 'ACTIVE'}]->(finance),
          (finance)-[:ASSIGNED_TO {status: 'ACTIVE'}]->(role),
          (role)-[:GRANTS]->(perm),
          (perm)-[:ON]->(res)
    """);

    var result = repository.explainAccess(
        new UserId("u-alice"),
        "APPROVE_PAYMENT",
        new ResourceId("res-payment-prod")
    );

    assertThat(result.allowed()).isTrue();
    assertThat(result.path()).extracting(AccessPathSegment::relationshipType)
        .containsExactly("MEMBER_OF", "ASSIGNED_TO", "GRANTS", "ON");
}
```

### 8.4 Why Testcontainers is better than mocking driver

Mocking driver usually tests mapping code, not graph behavior.

Use mocks for:

```text
service orchestration
error handling
controller boundary
DTO mapping
```

Use real Neo4j for:

```text
Cypher correctness
constraint behavior
transaction behavior
path semantics
query performance
migration scripts
```

---

## 9. Golden Dataset Strategy

A golden dataset is a small, curated graph that encodes expected behavior.

### 9.1 Why golden datasets matter

Graph bugs are often structural. Golden graph fixtures capture:

- direct access,
- inherited access,
- nested groups,
- expired grant,
- revoked grant,
- cross-tenant boundary,
- toxic combination,
- duplicate path,
- supernode boundary,
- orphan service account,
- resource hierarchy,
- escalation path.

### 9.2 Example golden scenarios

```text
G001_direct_role_access
G002_group_inherited_access
G003_nested_group_max_depth
G004_expired_grant_denied
G005_revoked_grant_denied
G006_cross_tenant_denied
G007_cross_tenant_exception_allowed
G008_toxic_combination_detected
G009_duplicate_paths_deduplicated
G010_sensitive_path_redacted
G011_service_account_blast_radius
G012_privilege_escalation_detected
```

### 9.3 Fixture organization

```text
src/test/resources/graph-fixtures/
  iam/
    G001_direct_role_access.cypher
    G002_group_inherited_access.cypher
    G003_nested_group_max_depth.cypher
  fraud/
    F001_shared_device_ring.cypher
  recommendation/
    R001_user_item_similarity.cypher
```

### 9.4 Expected results

```text
src/test/resources/expected/
  iam/
    G001_explain_access.json
    G002_effective_access.json
    G008_toxic_combinations.json
```

This gives deterministic regression testing.

---

## 10. Property-Based Testing for Graph Invariants

Graph systems benefit from randomized graph generation.

Instead of hand-writing every scenario, generate random graph shapes and assert invariants.

### 10.1 Example properties

```text
No active user should access a resource in another tenant unless exception exists.
Expired grants should never produce effective access.
Revoked group membership should not contribute to access.
Effective access should be subset of explainable raw paths.
No role conflict should be ignored.
No path longer than configured max depth should be used.
```

### 10.2 Generated graph dimensions

Generate:

- number of users,
- number of groups,
- nesting depth,
- tenant assignment,
- grant validity,
- revoked relationships,
- role conflicts,
- resource classification,
- service account ownership.

### 10.3 Caution

Randomized graph tests can be hard to debug. Always persist failing seed and export failing fixture.

Output:

```text
Failed seed: 1938472
Fixture written to: build/failing-fixtures/cross_tenant_violation_1938472.cypher
```

---

## 11. Migration Types in Graph Systems

Graph migration is not one thing.

There are multiple types:

```text
1. Schema migration
2. Data shape migration
3. Relationship type migration
4. Relationship direction migration
5. Node label migration
6. Property migration
7. Reification migration
8. Derived edge migration
9. Projection rebuild
10. Query migration
11. Consumer contract migration
12. Historical data migration
```

Each type has different risk.

---

## 12. Schema Migration

Schema migration includes:

- constraints,
- indexes,
- full-text indexes,
- vector indexes,
- property existence constraints,
- type constraints,
- dropping obsolete constraints/indexes.

### 12.1 Additive first

Prefer additive changes:

```cypher
CREATE CONSTRAINT user_external_id_unique IF NOT EXISTS
FOR (u:User)
REQUIRE u.externalId IS UNIQUE;
```

Add before relying on it.

### 12.2 Migration checklist

```text
[ ] Is migration idempotent?
[ ] Can it run safely if partially applied?
[ ] Does it require exclusive lock?
[ ] Does index population affect production?
[ ] Does query start using index only after it is online?
[ ] Is rollback possible?
[ ] Is old query still compatible?
```

### 12.3 Wait for index online

After creating index, do not immediately assume it is available.

Check:

```cypher
SHOW INDEXES
YIELD name, state
WHERE name = "user_external_id_idx"
RETURN state;
```

Expected:

```text
ONLINE
```

---

## 13. Migration Tooling

Migration can be managed by:

```text
Neo4j-Migrations
Liquibase Neo4j plugin
custom migration runner
application startup migration
CI/CD database migration stage
```

For serious production, avoid ad hoc manual Cypher.

### 13.1 Migration file naming

```text
V001__create_identity_constraints.cypher
V002__create_resource_indexes.cypher
V003__add_grant_node_model.cypher
V004__backfill_grants_from_relationships.cypher
V005__dual_write_grant_node_and_assigned_to.cypher
V006__switch_queries_to_grant_node.cypher
V007__remove_legacy_assigned_to_after_validation.cypher
```

### 13.2 Migration metadata

Track:

- version,
- checksum,
- appliedAt,
- appliedBy,
- duration,
- success/failure,
- database name,
- environment.

Never trust memory or wiki pages as migration source of truth.

---

## 14. Data Shape Migration

Example:

Old model:

```text
(:User)-[:ASSIGNED_TO {ticketId, approvedBy, expiresAt}]->(:Role)
```

New model:

```text
(:User)-[:HAS_GRANT]->(:Grant)-[:GRANTS_ROLE]->(:Role)
(:Grant)-[:REQUESTED_IN]->(:Ticket)
(:Grant)-[:APPROVED_BY]->(:User)
```

Why migrate?

Because assignment has lifecycle, evidence, approval, expiry, review status.

### 14.1 Step 1: Add new structure

```cypher
CREATE CONSTRAINT grant_id_unique IF NOT EXISTS
FOR (g:Grant)
REQUIRE g.id IS UNIQUE;
```

### 14.2 Step 2: Backfill

```cypher
MATCH (u:User)-[a:ASSIGNED_TO]->(r:Role)
WITH u, a, r,
     coalesce(a.ticketId, "legacy") AS ticketId
MERGE (g:Grant {id: u.id + ":" + r.id + ":" + ticketId})
SET g.status = coalesce(a.status, "ACTIVE"),
    g.expiresAt = a.expiresAt,
    g.sourceSystem = coalesce(a.sourceSystem, "legacy"),
    g.createdAt = coalesce(a.createdAt, datetime())
MERGE (u)-[:HAS_GRANT]->(g)
MERGE (g)-[:GRANTS_ROLE]->(r);
```

### 14.3 Step 3: Attach evidence

```cypher
MATCH (u:User)-[a:ASSIGNED_TO]->(r:Role)
WHERE a.ticketId IS NOT NULL
MATCH (g:Grant {id: u.id + ":" + r.id + ":" + a.ticketId})
MERGE (t:Ticket {id: a.ticketId})
MERGE (g)-[:REQUESTED_IN]->(t);
```

### 14.4 Step 4: Dual read

Application query accepts both old and new model temporarily.

```cypher
MATCH (u:User {id: $userId})
OPTIONAL MATCH oldPath = (u)-[:ASSIGNED_TO]->(:Role)-[:GRANTS]->(:Permission)-[:ON]->(:Resource {id: $resourceId})
OPTIONAL MATCH newPath = (u)-[:HAS_GRANT]->(:Grant)-[:GRANTS_ROLE]->(:Role)-[:GRANTS]->(:Permission)-[:ON]->(:Resource {id: $resourceId})
RETURN oldPath, newPath;
```

### 14.5 Step 5: Validate equivalence

```cypher
MATCH (u:User)
OPTIONAL MATCH (u)-[:ASSIGNED_TO]->(oldRole:Role)
WITH u, collect(DISTINCT oldRole.id) AS oldRoles
OPTIONAL MATCH (u)-[:HAS_GRANT]->(:Grant)-[:GRANTS_ROLE]->(newRole:Role)
WITH u, oldRoles, collect(DISTINCT newRole.id) AS newRoles
WHERE oldRoles <> newRoles
RETURN u.id, oldRoles, newRoles
LIMIT 100;
```

### 14.6 Step 6: Switch writes

New writes create only new model. Old edge may still be maintained as derived compatibility edge.

### 14.7 Step 7: Remove old model

Only after:

- read queries switched,
- downstream consumers migrated,
- equivalence tested,
- rollback window passed.

---

## 15. Relationship Type Migration

Example:

Old:

```text
(:User)-[:BELONGS_TO]->(:Group)
```

New:

```text
(:User)-[:MEMBER_OF]->(:Group)
```

### 15.1 Backfill new relationship

```cypher
MATCH (u:User)-[old:BELONGS_TO]->(g:Group)
MERGE (u)-[new:MEMBER_OF]->(g)
SET new += properties(old);
```

### 15.2 Validate count

```cypher
MATCH (:User)-[old:BELONGS_TO]->(:Group)
WITH count(old) AS oldCount
MATCH (:User)-[new:MEMBER_OF]->(:Group)
RETURN oldCount, count(new) AS newCount;
```

### 15.3 Detect mismatches

```cypher
MATCH (u:User)-[:BELONGS_TO]->(g:Group)
WHERE NOT (u)-[:MEMBER_OF]->(g)
RETURN u.id, g.id
LIMIT 100;
```

### 15.4 Dual-read period

Query supports both:

```cypher
MATCH (u:User {id: $userId})-[:BELONGS_TO|MEMBER_OF]->(g:Group)
RETURN DISTINCT g;
```

### 15.5 Remove old

```cypher
MATCH (:User)-[old:BELONGS_TO]->(:Group)
DELETE old;
```

Caution: do this only after consumers are migrated. Relationship type migration can silently break query semantics.

---

## 16. Relationship Direction Migration

Direction change is riskier.

Old:

```text
(:Group)-[:HAS_MEMBER]->(:User)
```

New:

```text
(:User)-[:MEMBER_OF]->(:Group)
```

Backfill:

```cypher
MATCH (g:Group)-[old:HAS_MEMBER]->(u:User)
MERGE (u)-[new:MEMBER_OF]->(g)
SET new += properties(old);
```

Validation:

```cypher
MATCH (g:Group)-[:HAS_MEMBER]->(u:User)
WHERE NOT (u)-[:MEMBER_OF]->(g)
RETURN g.id, u.id
LIMIT 100;
```

Direction migration affects:

- all Cypher patterns,
- path query direction,
- query planner,
- explanation output,
- mental model.

Require query contract tests.

---

## 17. Label Migration

Example:

Old:

```text
:Account
```

New:

```text
:BankAccount
```

Add label:

```cypher
MATCH (a:Account)
SET a:BankAccount;
```

Dual-label period:

```text
Node has both :Account and :BankAccount
```

Switch queries:

```cypher
MATCH (a:BankAccount {id: $accountId})
```

Remove old label later:

```cypher
MATCH (a:BankAccount:Account)
REMOVE a:Account;
```

Validation:

```cypher
MATCH (a:Account)
WHERE NOT a:BankAccount
RETURN count(a) AS remainingOldOnly;
```

Caution: labels often drive indexes/constraints. Create new indexes/constraints before switching queries.

---

## 18. Property Migration

Example:

Old:

```text
u.username
```

New:

```text
u.loginName
```

Backfill:

```cypher
MATCH (u:User)
WHERE u.loginName IS NULL AND u.username IS NOT NULL
SET u.loginName = u.username;
```

Dual write:

```text
new writes populate both username and loginName
```

Validation:

```cypher
MATCH (u:User)
WHERE u.username IS NOT NULL
  AND u.loginName <> u.username
RETURN u.id, u.username, u.loginName
LIMIT 100;
```

Remove old property:

```cypher
MATCH (u:User)
REMOVE u.username;
```

Caution: property migration may affect constraints, indexes, and external consumers.

---

## 19. Reification Migration

Reification turns relationship into node.

Old:

```text
(:Person)-[:OWNS {percentage, validFrom, validTo, source}]->(:Company)
```

New:

```text
(:Person)-[:HAS_OWNERSHIP]->(:Ownership)-[:OF_COMPANY]->(:Company)
```

Why?

Ownership may need:

- evidence,
- source documents,
- confidence,
- temporal versions,
- beneficial ownership chain,
- dispute status,
- regulator filings.

### 19.1 Backfill

```cypher
MATCH (p:Person)-[o:OWNS]->(c:Company)
MERGE (own:Ownership {
  id: p.id + ":" + c.id + ":" + coalesce(toString(o.validFrom), "unknown")
})
SET own.percentage = o.percentage,
    own.validFrom = o.validFrom,
    own.validTo = o.validTo,
    own.source = o.source
MERGE (p)-[:HAS_OWNERSHIP]->(own)
MERGE (own)-[:OF_COMPANY]->(c);
```

### 19.2 Compatibility edge

Keep derived edge for traversal:

```text
(:Person)-[:OWNS]->(:Company)
```

But mark it as derived:

```cypher
MATCH (p:Person)-[:HAS_OWNERSHIP]->(own:Ownership)-[:OF_COMPANY]->(c:Company)
MERGE (p)-[d:OWNS]->(c)
SET d.derived = true,
    d.updatedAt = datetime();
```

### 19.3 Risk

If both old and new are treated as raw facts, duplicates appear.

Use clear semantics:

```text
OWNS = derived traversal shortcut
Ownership node = canonical lifecycle fact
```

---

## 20. Derived Edge Migration

Derived edges improve performance but complicate correctness.

Example:

```text
Raw:
User -> Group -> Role -> Permission -> Resource

Derived:
User -> EFFECTIVE_ACCESS -> Resource
```

### 20.1 Add derived edge

```cypher
MATCH (u:User {status: "ACTIVE"})
MATCH (u)-[:MEMBER_OF*0..4]->(p)
MATCH (p)-[:ASSIGNED_TO]->(:Role)-[:GRANTS]->(perm:Permission)-[:ON]->(res:Resource)
MERGE (u)-[ea:EFFECTIVE_ACCESS {
  action: perm.action,
  permissionId: perm.id
}]->(res)
SET ea.computedAt = datetime(),
    ea.source = "access-projection-v1";
```

### 20.2 Validate derived edge

Every derived edge explainable:

```cypher
MATCH (u:User)-[ea:EFFECTIVE_ACCESS]->(res:Resource)
WHERE NOT EXISTS {
  MATCH (u)-[:MEMBER_OF*0..4]->(p)
  MATCH (p)-[:ASSIGNED_TO]->(:Role)-[:GRANTS]->(:Permission {id: ea.permissionId})-[:ON]->(res)
}
RETURN u.id, res.id, ea.permissionId
LIMIT 100;
```

### 20.3 Delete stale edge

```cypher
MATCH (u:User)-[ea:EFFECTIVE_ACCESS]->(res:Resource)
WHERE ea.source = "access-projection-v1"
  AND ea.computedAt < datetime() - duration("P1D")
DELETE ea;
```

Better:

- rebuild per partition,
- write projection version,
- switch active version atomically.

---

## 21. Rebuildable Projection Strategy

A projection is safe if it can be rebuilt.

### 21.1 Principle

```text
If derived graph cannot be rebuilt from source facts, it is no longer merely derived.
It has become source-of-truth, whether intended or not.
```

### 21.2 Projection versioning

```cypher
CREATE (:ProjectionRun {
  id: "effective-access-2026-06-22T01",
  name: "effective-access",
  version: "v2",
  status: "RUNNING",
  startedAt: datetime()
});
```

Derived edges include:

```text
projectionRunId
projectionVersion
computedAt
sourceSnapshotId
```

### 21.3 Blue/green projection

Instead of overwriting `EFFECTIVE_ACCESS`, write:

```text
:EFFECTIVE_ACCESS_V2
```

Or property:

```text
projectionVersion = "v2"
active = false
```

Then switch active version:

```cypher
MATCH (p:Projection {name: "effective-access"})
SET p.activeVersion = "v2";
```

Consumer query:

```cypher
MATCH (p:Projection {name: "effective-access"})
WITH p.activeVersion AS version
MATCH (u:User {id: $userId})-[ea:EFFECTIVE_ACCESS]->(res:Resource)
WHERE ea.projectionVersion = version
RETURN res, ea;
```

### 21.4 Projection validation before activation

```text
[ ] edge count within expected range
[ ] no cross-tenant violation
[ ] every derived edge explainable
[ ] no expired grant included
[ ] no revoked membership included
[ ] sample explanation matches old version
[ ] performance acceptable
```

---

## 22. Zero-Downtime Graph Migration Pattern

Most graph migrations should follow expand-contract.

### 22.1 Expand

Add new labels, relationships, properties, indexes, constraints.

```text
old model still works
new model introduced
no consumer switched yet
```

### 22.2 Backfill

Populate new model from old facts.

```text
repeatable
idempotent
partitioned
observable
```

### 22.3 Dual write

Writes populate both old and new model.

```text
short period if possible
must be monitored
```

### 22.4 Dual read / compare

Read both old and new model and compare results.

```text
shadow query
sample comparison
metric diff
```

### 22.5 Switch read

Consumers use new model.

```text
feature flag
canary
rollback path
```

### 22.6 Contract

Remove old model after confidence window.

```text
delete old relationships/properties/labels
remove compatibility query
drop old indexes
```

### 22.7 Why this matters

Graph model changes can break consumers silently. Expand-contract creates safety margin.

---

## 23. Query Migration

Query migration is often harder than data migration.

### 23.1 Before changing query

Capture:

```text
old query text
old query plan
representative parameters
expected result set
row count
path shape
duration
db hits
memory
```

### 23.2 Shadow query

Run old and new query in parallel for sampled traffic.

```java
var oldResult = oldQuery.execute(input);
var newResult = newQuery.execute(input);

comparisonRecorder.record(input, oldResult.summary(), newResult.summary());
```

Do not block request on full comparison if expensive. Use asynchronous sampling.

### 23.3 Equivalence is not always exact

A new graph model may intentionally change semantics.

Then document:

```text
old behavior
new behavior
reason
expected deltas
migration date
approval
rollback strategy
```

### 23.4 Query contract file

```yaml
query: explain-access-v2
inputs:
  userId: u-alice
  action: APPROVE_PAYMENT
  resourceId: res-payment-prod
expected:
  allowed: true
  maxPaths: 3
  requiredRelationships:
    - MEMBER_OF
    - ASSIGNED_TO
    - GRANTS
    - ON
forbiddenRelationships:
  - REVOKED_BY
  - DENIED_BY
```

---

## 24. Performance Regression Testing

Graph performance can degrade due to:

- data growth,
- new supernode,
- changed relationship type,
- missing index,
- query rewrite,
- changed planner behavior,
- broader label,
- deeper traversal,
- more duplicate paths.

### 24.1 Metrics to track

For key queries:

```text
duration
rows
db hits
allocated memory
result count
path count
planner
runtime
starting operator
expand operators
eager operators
cartesian product
index seek vs label scan
```

### 24.2 PROFILE in test

You can run:

```cypher
PROFILE
MATCH (u:User {id: $userId})
MATCH (u)-[:MEMBER_OF*0..4]->(p)
MATCH (p)-[:ASSIGNED_TO]->(:Role)-[:GRANTS]->(:Permission {action: $action})-[:ON]->(res:Resource)
RETURN count(DISTINCT res) AS resourceCount;
```

In automated tests, parsing full PROFILE output can be brittle, but you can still:

- collect summary metrics,
- detect huge row count changes,
- use query log in performance test environment,
- keep benchmark datasets.

### 24.3 Performance budgets

Example:

```text
explain-access:
  p95 < 100ms on golden-large dataset
  rows < 10_000
  no cartesian product
  starts with NodeIndexSeek(User.id)

effective-access-by-resource:
  p95 < 500ms
  result capped at 10_000
  requires Resource.id index
```

### 24.4 Golden-large dataset

Small fixtures catch correctness bugs. You also need a larger fixture:

```text
100k users
10k groups
50k roles
500k grants
resource hierarchy depth 6
some supergroups
some revoked/expired grants
multi-tenant distribution
```

Synthetic but realistic.

---

## 25. Data Quality Gates

Data quality gates run during ingestion and migration.

### 25.1 Gate examples

```text
duplicate external IDs
unknown source system
missing tenant
missing classification
expired but active grants
orphan relationships
conflicting source facts
unowned privileged service accounts
role without permission
permission without resource
```

### 25.2 Gate query

```cypher
MATCH (g:Grant {status: "ACTIVE"})
WHERE g.expiresAt < datetime()
RETURN count(g) AS expiredActiveGrants;
```

### 25.3 Gate action

Each gate should have policy:

```text
WARN
BLOCK_DEPLOY
BLOCK_PROJECTION_ACTIVATION
CREATE_REMEDIATION_CASE
AUTO_FIX
```

Not all violations should block. Some should create review tasks.

---

## 26. Snapshot and Diff

Graph migrations need diff.

### 26.1 Snapshot counts

```cypher
MATCH (n)
RETURN labels(n) AS labels, count(*) AS count
ORDER BY labels;
```

```cypher
MATCH ()-[r]->()
RETURN type(r) AS type, count(*) AS count
ORDER BY type;
```

### 26.2 Snapshot critical query outputs

Example:

```cypher
MATCH (u:User)-[:EFFECTIVE_ACCESS]->(r:Resource)
RETURN u.id AS userId,
       r.id AS resourceId,
       count(*) AS count
ORDER BY userId, resourceId;
```

Store hash:

```text
hash(userId + "|" + resourceId + "|" + action)
```

### 26.3 Diff after migration

```text
removed access paths
added access paths
changed explanation paths
changed risk scores
changed review item count
changed toxic combination findings
```

### 26.4 Interpret diff

Not all diff is bad.

Classify:

```text
expected semantic change
bug
data quality improvement
source data change
projection stale
query bug
```

---

## 27. Refactoring a Graph Model

Refactoring is a semantic change with preservation intent.

Examples:

```text
rename relationship type
split label
merge labels
introduce intermediate node
materialize shortcut relationship
change direction
separate operational graph from analytical graph
move property from node to relationship
move relationship property into reified node
```

### 27.1 Refactoring workflow

```text
1. State the problem.
2. State current model.
3. State target model.
4. List queries affected.
5. List invariants affected.
6. Write migration.
7. Write validation.
8. Run on fixture.
9. Run on staging snapshot.
10. Compare old/new query outputs.
11. Deploy expand.
12. Backfill.
13. Dual read/write.
14. Switch.
15. Contract old model.
```

### 27.2 ADR template

```markdown
# ADR: Reify User Role Assignment into Grant Node

## Context
Role assignment now needs approval, expiry, review, ticket evidence.

## Current model
(:User)-[:ASSIGNED_TO {ticketId, expiresAt}]->(:Role)

## Decision
Introduce (:Grant) node:
(:User)-[:HAS_GRANT]->(:Grant)-[:GRANTS_ROLE]->(:Role)

## Consequences
More hops in query.
Better auditability.
Need backfill.
Need compatibility query.
Need effective access projection update.

## Migration
V003 add Grant constraint.
V004 backfill Grant nodes.
V005 dual write.
V006 switch read.
V007 remove old assignment edge.
```

---

## 28. Backward-Compatible Graph Evolution

Backward compatibility is hard because Cypher queries encode graph shape.

### 28.1 Compatibility strategies

```text
dual labels
dual relationship types
compatibility derived edges
view-like query layer
service-layer DTO stability
feature flags
consumer versioning
```

### 28.2 Avoid exposing raw graph too broadly

If every consumer writes arbitrary Cypher, migration becomes impossible.

Prefer:

```text
Graph Query API
approved query catalogue
stable DTOs
read models
materialized projections
```

Avoid:

```text
multiple services directly querying internal graph shape
UI-generated arbitrary Cypher
BI users depending on internal labels/relationships without contract
```

### 28.3 Consumer contract

Expose:

```json
{
  "userId": "u-alice",
  "resourceId": "res-payment-prod",
  "action": "APPROVE_PAYMENT",
  "allowed": true,
  "explanation": [
    {"from": "u-alice", "relationship": "MEMBER_OF", "to": "g-finance"},
    {"from": "g-finance", "relationship": "ASSIGNED_TO", "to": "r-approver"}
  ]
}
```

Not:

```text
raw Neo4j internal node IDs
arbitrary internal labels
query-specific path object without version
```

---

## 29. Handling Historical Graphs

Historical correctness requires care.

### 29.1 Current-state graph

Only current facts:

```text
fast
simple
not enough for audit
```

### 29.2 Valid-time graph

Relationships/nodes have validity:

```text
validFrom
validTo
```

Query as-of time:

```cypher
MATCH path = (:User {id: $userId})-[rels:MEMBER_OF|ASSIGNED_TO|GRANTS*1..5]->(:Resource {id: $resourceId})
WHERE all(r IN relationships(path)
  WHERE r.validFrom <= datetime($asOf)
    AND (r.validTo IS NULL OR r.validTo > datetime($asOf)))
RETURN path;
```

### 29.3 Event graph

Store events:

```text
GrantCreated
GrantRevoked
MembershipAdded
MembershipRemoved
RoleChanged
```

Project current state separately.

### 29.4 Recommendation

For audit-heavy systems:

```text
event/source facts are immutable
current graph is projection
historical graph is reconstructed or queried by valid time
review decisions store snapshots
```

---

## 30. Rollback Strategy

Every migration needs rollback, but rollback is not always symmetrical.

### 30.1 Easy rollback

Schema add:

```text
new index added but unused
new constraint added before data write
new property added
new label added
```

Rollback:

```text
stop using it
drop later
```

### 30.2 Hard rollback

Data shape migration:

```text
relationship reified into node
old data deleted
new writes only new model
```

Rollback requires:

- reverse migration,
- backup,
- compatibility layer,
- event replay.

### 30.3 Safer approach

Avoid destructive migration until:

```text
backup verified
old model still derivable
all consumers switched
monitoring stable
comparison clean
rollback window passed
```

### 30.4 Roll-forward often beats rollback

If graph data is large, rolling back can be riskier than patching forward.

Plan both:

```text
rollback plan
roll-forward fix plan
```

---

## 31. Operational Migration Runbook

A production migration runbook should include:

```text
1. Scope
2. Affected databases
3. Affected labels/relationships/properties
4. Affected services
5. Pre-check queries
6. Backup confirmation
7. Migration steps
8. Expected counts
9. Validation queries
10. Performance checks
11. Rollback/roll-forward plan
12. Owner
13. Approval
14. Communication
15. Post-deploy monitoring
```

### 31.1 Pre-check example

```cypher
MATCH (:User)-[r:ASSIGNED_TO]->(:Role)
RETURN count(r) AS oldAssignmentCount;
```

### 31.2 Post-check example

```cypher
MATCH (:User)-[:HAS_GRANT]->(:Grant)-[:GRANTS_ROLE]->(:Role)
RETURN count(*) AS newGrantAssignmentCount;
```

### 31.3 Equivalence check

```cypher
MATCH (u:User)
OPTIONAL MATCH (u)-[:ASSIGNED_TO]->(oldRole:Role)
WITH u, collect(DISTINCT oldRole.id) AS oldRoles
OPTIONAL MATCH (u)-[:HAS_GRANT]->(:Grant)-[:GRANTS_ROLE]->(newRole:Role)
WITH u, oldRoles, collect(DISTINCT newRole.id) AS newRoles
WHERE oldRoles <> newRoles
RETURN count(u) AS mismatchUsers;
```

Expected:

```text
mismatchUsers = 0
```

Unless expected differences are documented.

---

## 32. CI/CD Pipeline for Graph Systems

A mature pipeline:

```text
1. Compile Java
2. Unit tests
3. Start Neo4j Testcontainer
4. Apply migrations
5. Verify constraints/indexes
6. Load golden fixtures
7. Run query contract tests
8. Run invariant tests
9. Run path explanation tests
10. Run migration tests
11. Run performance smoke tests
12. Package service
13. Deploy to staging
14. Run staging snapshot validation
15. Canary production
16. Monitor query/error/freshness metrics
```

### 32.1 Do not skip migration tests

Migration scripts are code.

Test:

```text
empty database -> latest
old version -> latest
partially applied migration -> safe failure/retry
bad data -> migration rejects or reports
rollback/roll-forward path
```

---

## 33. Common Failure Modes

### 33.1 Query works on fixture but fails on production

Cause:

```text
fixture too small
no supernodes
no duplicate paths
no dirty data
no tenant mixing
no expired relationships
```

Fix:

```text
golden-large dataset
production anonymized snapshot
data quality tests
```

### 33.2 Migration creates duplicate relationships

Cause:

```cypher
CREATE instead of MERGE
```

Fix:

```cypher
MERGE with deterministic identity
```

### 33.3 Dual-read hides inconsistency

If query returns old OR new model, bug may be hidden.

Fix:

```text
compare old and new separately
emit mismatch metrics
```

### 33.4 Derived edges become stale

Fix:

```text
projection versioning
rebuild job
explainability invariant
freshness monitoring
```

### 33.5 Test asserts result count only

Result count can be same while paths differ.

Fix:

```text
assert path shape and relationship sequence
```

### 33.6 Graph migration breaks BI/analyst queries

Fix:

```text
query catalogue
consumer registry
deprecation window
compatibility views/projections
```

### 33.7 Dropping old relationship too early

Fix:

```text
expand-contract
consumer readiness check
query logs analysis
```

---

## 34. Practical Checklist

### 34.1 Testing checklist

```text
[ ] Golden fixtures exist.
[ ] Golden-large dataset exists.
[ ] Every critical query has contract tests.
[ ] Every materialized edge has explainability test.
[ ] Tenant isolation has negative tests.
[ ] Expired/revoked facts have negative tests.
[ ] Path explanation format is tested.
[ ] Query performance budget exists.
[ ] Migration scripts are tested from old versions.
[ ] Invariant tests run in CI and staging.
```

### 34.2 Migration checklist

```text
[ ] Migration is idempotent where possible.
[ ] Constraints/indexes are created before queries depend on them.
[ ] Backfill is partitioned.
[ ] Dual-read/write plan exists.
[ ] Validation query exists.
[ ] Snapshot/diff exists.
[ ] Rollback/roll-forward plan exists.
[ ] Old model removal is delayed until safe.
[ ] Consumer contract impact is known.
```

### 34.3 Refactoring checklist

```text
[ ] Current model documented.
[ ] Target model documented.
[ ] Motivation is explicit.
[ ] Query catalogue impact assessed.
[ ] Invariants updated.
[ ] Golden fixtures updated.
[ ] Old/new equivalence tested.
[ ] Performance compared.
[ ] ADR written.
```

### 34.4 Projection checklist

```text
[ ] Projection has version.
[ ] Projection has source snapshot ID.
[ ] Derived edges have computedAt.
[ ] Rebuild path exists.
[ ] Stale edge detection exists.
[ ] Activation is controlled.
[ ] Consumers read active version.
[ ] Validation gates run before activation.
```

---

## 35. What Top Engineers Should Internalize

Graph systems are easy to evolve accidentally and hard to evolve safely.

The most important lesson:

```text
Graph shape is application logic.
```

Changing labels, relationship types, direction, path depth, or derived edges is equivalent to changing business behavior.

Therefore:

```text
Cypher must be tested.
Graph model must be versioned.
Migrations must be rehearsed.
Invariants must be executable.
Derived projections must be rebuildable.
Explanations must be reproducible.
Performance must be tracked across data growth.
```

A senior engineer does not only ask:

```text
Can Neo4j represent this?
```

They ask:

```text
Can we test it?
Can we migrate it?
Can we explain it?
Can we roll it forward?
Can we prove no access leaked?
Can we rebuild derived data?
Can we support old consumers while changing the model?
Can this survive audit and production data growth?
```

---

## 36. Summary

In this part, we covered the lifecycle engineering of graph systems:

- model shape tests,
- invariant tests,
- query contract tests,
- path explanation tests,
- Testcontainers integration,
- golden datasets,
- property-based graph testing,
- schema migration,
- data shape migration,
- relationship type/direction migration,
- label/property migration,
- reification migration,
- derived edge migration,
- rebuildable projection strategy,
- zero-downtime expand-contract migration,
- query migration,
- performance regression testing,
- snapshot/diff,
- rollback/roll-forward planning,
- CI/CD pipeline for graph systems.

The core message:

```text
A production graph system is not safe because the graph is flexible.
It is safe because its flexibility is constrained by tests, migrations, contracts, invariants, and observable projection lifecycle.
```

---

## 37. Status Seri

```text
Part 000 selesai.
Part 001 selesai.
Part 002 selesai.
Part 003 selesai.
Part 004 selesai.
Part 005 selesai.
Part 006 selesai.
Part 007 selesai.
Part 008 selesai.
Part 009 selesai.
Part 010 selesai.
Part 011 selesai.
Part 012 selesai.
Part 013 selesai.
Part 014 selesai.
Part 015 selesai.
Part 016 selesai.
Part 017 selesai.
Part 018 selesai.
Part 019 selesai.
Part 020 selesai.
Part 021 selesai.
Part 022 selesai.
Part 023 selesai.
Part 024 selesai.
Part 025 selesai.
Part 026 selesai.
Part 027 selesai.
Part 028 selesai.
Part 029 selesai.
Part 030 selesai.
Seri belum selesai.
Masih ada Part 031 sampai Part 032.
```

Lanjut berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-031.md
```

Topik:

```text
Comparative Architecture: Neo4j vs Relational, Document, Search, OLAP, Cache, and Stream Systems
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-029.md">⬅️ Part 029 — Domain Case Study: IAM, Entitlements, Policy, and Access Graph</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-031.md">Part 031 — Comparative Architecture: Neo4j vs Relational, Document, Search, OLAP, Cache, and Stream Systems ➡️</a>
</div>
