# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-031.md

# Part 031 — Comparative Architecture: Neo4j vs Relational, Document, Search, OLAP, Cache, and Stream Systems

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Audiens: Java software engineer / tech lead  
> Fokus: decision framework, system boundaries, polyglot persistence, ownership of truth, workload routing, and failure modelling  
> Status seri: Part 031 dari 032  
> Prasyarat: Part 000–030 dan seri database/messaging/search yang sudah pernah dipelajari.

---

## 0. Tujuan Bagian Ini

Bagian ini menjawab pertanyaan arsitektural yang sangat penting:

```text
Kapan Neo4j memang pilihan yang tepat?
Kapan relational database lebih tepat?
Kapan document database lebih tepat?
Kapan search engine lebih tepat?
Kapan OLAP columnar database lebih tepat?
Kapan cache/key-value store lebih tepat?
Kapan stream/message broker lebih tepat?
Kapan graph sebaiknya hanya menjadi projection, bukan source of truth?
Kapan memakai kombinasi polyglot?
```

Graph database bukan “database yang lebih canggih dari semua database lain”. Graph database adalah alat yang sangat kuat untuk kelas problem tertentu: problem yang nilai utamanya berada pada **hubungan, jalur, konektivitas, dan struktur network**.

Kesalahan besar dalam adopsi Neo4j biasanya terjadi karena dua ekstrem:

```text
Ekstrem 1:
"Semua bisa diselesaikan dengan graph."

Ekstrem 2:
"Semua graph query bisa diselesaikan dengan join SQL saja."
```

Keduanya salah.

Relational database bisa merepresentasikan graph. Document database bisa menyimpan adjacency list. Search engine bisa mencari connected text. OLAP bisa menghitung network aggregation. Cache bisa menyimpan traversal result. Kafka bisa mengalirkan graph updates.

Tetapi pertanyaan arsitektur bukan “bisa atau tidak bisa”.

Pertanyaannya:

```text
Apa workload dominan?
Apa query yang harus murah?
Apa invariant yang harus benar?
Apa data ownership-nya?
Apa latency requirement?
Apa update pattern?
Apa failure mode?
Apa operational cost?
Apa explainability requirement?
Apa evolusi domain yang mungkin terjadi?
```

Part ini membangun decision framework.

---

## 1. Mental Model: Setiap Database Mengoptimalkan Bentuk Pertanyaan Berbeda

Jangan mulai dari teknologi. Mulai dari pertanyaan.

### 1.1 Relational database

Relational database mengoptimalkan:

```text
structured records
set operations
transactional integrity
relational constraints
ad-hoc SQL
join over bounded relationships
OLTP consistency
```

Pertanyaan natural:

```sql
SELECT orders.*
FROM orders
WHERE customer_id = ?
ORDER BY created_at DESC;
```

Atau:

```sql
SELECT customer_id, SUM(amount)
FROM invoices
WHERE status = 'PAID'
GROUP BY customer_id;
```

### 1.2 Document database

Document database mengoptimalkan:

```text
aggregate-oriented storage
flexible document structure
nested object retrieval
single-document locality
schema evolution at document boundary
```

Pertanyaan natural:

```text
Get this customer profile document with addresses, preferences, and embedded settings.
```

### 1.3 Search engine

Search engine mengoptimalkan:

```text
text search
relevance ranking
inverted index
fuzzy matching
facets
autocomplete
linguistic analysis
hybrid lexical/vector search
```

Pertanyaan natural:

```text
Find documents similar to this phrase, ranked by relevance, filtered by status and category.
```

### 1.4 OLAP columnar store

OLAP columnar database mengoptimalkan:

```text
large-scale analytical scans
columnar compression
aggregations
time-window analytics
dashboard workloads
group by over billions of rows
```

Pertanyaan natural:

```sql
SELECT region, product_category, SUM(revenue)
FROM events
WHERE event_date >= today() - 30
GROUP BY region, product_category;
```

### 1.5 Cache/key-value store

Cache/key-value store mengoptimalkan:

```text
low-latency key lookup
ephemeral derived state
rate limiting
session state
precomputed result
hot data access
```

Pertanyaan natural:

```text
Get value by key in sub-millisecond/low-millisecond latency.
```

### 1.6 Stream/message broker

Stream/message broker mengoptimalkan:

```text
event transport
decoupling
ordered logs
asynchronous processing
fan-out
event replay
integration pipelines
```

Pertanyaan natural:

```text
Publish this domain event and let downstream systems react.
```

### 1.7 Graph database

Graph database mengoptimalkan:

```text
connected data
relationship traversal
path queries
multi-hop discovery
relationship-centric modelling
network structure
explanation paths
graph algorithms
```

Pertanyaan natural:

```cypher
MATCH path =
  (:Person {id: $personId})
  -[:OWNS|CONTROLS|DIRECTOR_OF*1..5]->
  (:Company)
RETURN path;
```

Atau:

```cypher
MATCH path =
  (:User {id: $userId})
  -[:MEMBER_OF*0..4]->
  (:Group)
  -[:ASSIGNED_TO]->
  (:Role)
  -[:GRANTS]->
  (:Permission)
  -[:ON]->
  (:Resource {id: $resourceId})
RETURN path;
```

---

## 2. The Key Decision: Is the Relationship the Data or Just Metadata?

Pertanyaan paling penting:

```text
Apakah relationship hanya cara menghubungkan record,
atau relationship itu sendiri adalah object domain utama?
```

### 2.1 Relationship as implementation detail

Contoh:

```text
Order belongs to customer.
Invoice belongs to order.
Line item belongs to invoice.
```

Ini cocok untuk relational/document model.

Relationship penting, tetapi biasanya:

- depth kecil,
- join chain stabil,
- query predictable,
- relationship tidak punya network behavior kompleks.

### 2.2 Relationship as domain fact

Contoh:

```text
Person controls company through intermediate ownership chain.
User gets access through nested groups and delegated grants.
Fraudster shares device/address/account with other suspicious users.
Service depends on library that depends on package with CVE.
Investigation case is linked through evidence, parties, locations, accounts, and prior decisions.
```

Di sini relationship:

- multi-hop,
- query depth bervariasi,
- path explanation penting,
- indirect connection bernilai,
- network topology mengandung insight,
- relationship bisa punya lifecycle/provenance/confidence.

Ini graph-shaped.

---

## 3. Neo4j vs Relational Database

Neo4j dan relational database bisa sama-sama menyimpan entity dan relationship. Perbedaannya ada pada **cost model** dan **mental model query**.

Neo4j menyimpan data sebagai nodes, relationships, dan properties, bukan tabel atau dokumen. Property graph membuat relationship menjadi first-class dan natural untuk pattern matching/traversal. Relational database menyimpan data dalam tabel, dengan relationship direpresentasikan melalui foreign keys dan join. 

### 3.1 Relational shines when

Gunakan PostgreSQL/MySQL/SQL Server/Oracle ketika:

```text
Data mostly tabular.
Transactions are record-centric.
Constraints are relational and well-structured.
Query depth is predictable.
Joins are bounded and well-indexed.
Reporting requires SQL ecosystem.
Operational team is optimized for RDBMS.
Strong relational integrity is central.
```

Contoh:

```text
billing
orders
ledger-like OLTP
inventory transaction
customer account master
workflow task table
payment records
case record metadata
```

### 3.2 Neo4j shines when

Gunakan Neo4j ketika:

```text
Relationship depth varies.
Path itself is meaningful.
Indirect relationship discovery matters.
Query asks "how are these connected?"
Many-to-many-to-many relationships dominate.
Relationship has type/properties/lifecycle/provenance.
Schema evolves by adding relationship types.
Impact/blast-radius analysis matters.
```

Contoh:

```text
beneficial ownership
fraud ring
dependency graph
IAM inheritance
case linkage
knowledge graph
network topology
recommendation graph
supply chain risk
```

### 3.3 Relational can do graph, but watch the pain

Relational model for graph:

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  type TEXT,
  properties JSONB
);

CREATE TABLE edges (
  src_id TEXT REFERENCES nodes(id),
  dst_id TEXT REFERENCES nodes(id),
  type TEXT,
  properties JSONB
);
```

Traversal becomes recursive CTE:

```sql
WITH RECURSIVE traversal AS (
  SELECT src_id, dst_id, type, 1 AS depth
  FROM edges
  WHERE src_id = ?

  UNION ALL

  SELECT e.src_id, e.dst_id, e.type, t.depth + 1
  FROM traversal t
  JOIN edges e ON e.src_id = t.dst_id
  WHERE t.depth < 5
)
SELECT *
FROM traversal;
```

This may work. But engineering cost grows when:

- path logic becomes central,
- multiple relationship types matter,
- relationship filters are complex,
- path explanation is user-facing,
- recursive queries become hard to maintain,
- performance depends on repeated self-joins,
- graph algorithms are needed,
- domain users think in networks rather than tables.

### 3.4 Neo4j can do records, but that may be wasteful

Neo4j can store:

```text
Customer
Order
Invoice
Payment
```

But if query pattern is mostly:

```text
find by ID
list by date
aggregate by status
update row
```

then relational DB is simpler, cheaper, and more familiar.

### 3.5 Decision

Use relational as source-of-truth when core business records need strong transactional modelling.

Use Neo4j as:

```text
relationship intelligence layer
graph projection
investigation/query engine
network analytics layer
explanation engine
```

unless the application itself is fundamentally graph-native.

---

## 4. Neo4j vs Document Database

Document databases optimize aggregate retrieval. Graph databases optimize connection traversal.

### 4.1 Document model example

```json
{
  "customerId": "c1",
  "name": "Alice",
  "addresses": [
    {"type": "home", "city": "Jakarta"}
  ],
  "preferences": {
    "language": "id",
    "notifications": true
  }
}
```

This is excellent when:

```text
You usually load the whole aggregate.
Nested data belongs to one owner.
Update boundary is document-shaped.
Relationships outside aggregate are limited.
```

### 4.2 Graph problem example

```text
Alice shares device with Bob.
Bob shares address with Charlie.
Charlie owns company X.
Company X transacts with company Y.
Company Y is under investigation.
```

If stored as documents, the relationship network is scattered:

```text
customer documents
device documents
address documents
company documents
transaction documents
case documents
```

You can denormalize, but then:

- updates are duplicated,
- graph traversal becomes application-side,
- explanation path is hard,
- cycles are awkward,
- multi-hop query becomes custom code.

### 4.3 Document shines when

```text
Aggregate boundary is clear.
Single document retrieval dominates.
Nested fields are mostly owned by parent.
Flexible schema is needed per aggregate.
No complex many-to-many traversal.
```

Examples:

```text
user profile
product catalogue document
content metadata
configuration document
form submission
case detail document
```

### 4.4 Neo4j shines when

```text
Many aggregates are connected.
Connections are queried directly.
Graph traversal replaces application-side stitching.
Relationship has lifecycle/provenance.
Domain asks "what else is connected?"
```

Examples:

```text
customer 360 relationship graph
entity resolution
fraud investigation
knowledge graph
case linkage
recommendation graph
```

### 4.5 Hybrid pattern

Common architecture:

```text
MongoDB/document DB:
  source of rich aggregate documents

Neo4j:
  projection of entity references and relationships

Elasticsearch:
  search over textual fields and document content
```

Example:

```text
Document DB stores full case file.
Neo4j stores case, parties, evidence, accounts, organizations, relationships.
Search engine indexes narrative text.
```

User flow:

```text
search text -> find candidate cases -> expand graph relationships -> open full document
```

---

## 5. Neo4j vs Search Engine

Search engine and graph database answer different questions.

### 5.1 Search question

```text
Which documents match this text?
Which products are relevant to this query?
Which cases mention this phrase?
Which names are fuzzy matches?
```

Search engine excels at:

- inverted index,
- text analysis,
- scoring,
- fuzzy match,
- synonym,
- autocomplete,
- faceting,
- highlighting,
- BM25/vector/hybrid retrieval.

### 5.2 Graph question

```text
How is this case connected to this person?
Which companies are indirectly controlled by this entity?
Which accounts are within 3 hops of a suspicious account?
Which user has access through what path?
```

Graph excels at:

- traversal,
- path explanation,
- network structure,
- relationship semantics,
- graph algorithms.

### 5.3 Do not use Neo4j as general search engine

Neo4j has text/full-text/vector indexes, but that does not mean it should replace a dedicated search platform for all search workloads.

Avoid using Neo4j as primary search engine when you need:

```text
large-scale free-text search
complex linguistic analysis
high-volume faceted search
autocomplete at scale
search ranking experimentation
document relevance tuning
```

### 5.4 Do not use Elasticsearch as graph database

Elasticsearch can store arrays of IDs or nested documents, but multi-hop traversal is not its natural workload.

Avoid using search engine as graph when you need:

```text
recursive relationship traversal
path explanation
bounded multi-hop discovery
relationship lifecycle
graph algorithms
network communities
blast-radius analysis
```

### 5.5 Hybrid pattern: search then traverse

```text
User searches "payment fraud shell company"
  -> Elasticsearch returns candidate entities/cases
  -> Neo4j expands related parties/accounts/transactions
  -> App displays connected investigation graph
```

### 5.6 Hybrid pattern: graph then search

```text
Start from suspicious account
  -> Neo4j finds connected companies/persons
  -> Elasticsearch searches documents mentioning those entities
  -> Neo4j links documents back to cases/evidence
```

### 5.7 GraphRAG pattern

For GenAI/RAG:

```text
Vector search retrieves semantically similar chunks.
Graph traversal expands to related entities, facts, sources, and context.
LLM answer is grounded by connected facts and evidence paths.
```

This is often stronger than vector-only retrieval for:

- entity-centric investigations,
- multi-hop questions,
- temporal/legal/regulatory context,
- ownership structures,
- evidence traceability.

---

## 6. Neo4j vs OLAP Columnar Database

OLAP systems and graph databases are frequently confused because both can be used for “analytics”. But they optimize different analytical shapes.

### 6.1 OLAP question

```text
How many transactions per region per day?
What is revenue by category?
What is p95 latency by service?
How many cases were closed per month?
What is total exposure by risk class?
```

These are:

- scans,
- filters,
- group-bys,
- aggregations,
- window functions,
- time-series summaries.

Columnar OLAP is excellent.

### 6.2 Graph analytical question

```text
Which nodes are central?
Which communities exist?
What is the shortest path?
Which fraud rings are connected?
Which dependency path reaches vulnerable package?
Which entities bridge otherwise separate networks?
```

These are:

- topology,
- paths,
- centrality,
- community,
- similarity,
- network structure.

Graph analytics is excellent.

### 6.3 Do not use Neo4j as your warehouse

Neo4j is not ideal as primary warehouse for:

```text
billions of append-only fact rows
dashboard aggregations over wide event tables
high-cardinality group by
long historical scans
cheap columnar compression analytics
```

Use ClickHouse/BigQuery/Snowflake/Redshift/Druid/DuckDB-type systems for that.

### 6.4 Do not use OLAP as your graph traversal engine

OLAP can compute relationships if flattened, but path queries become awkward and expensive.

### 6.5 Hybrid pattern

```text
Kafka/events -> OLAP warehouse for metrics and trends
Kafka/events -> Neo4j projection for relationships and paths
Neo4j GDS outputs scores -> OLAP for dashboards
OLAP aggregates -> Neo4j as node properties for query filtering
```

Example:

```text
ClickHouse stores all transactions.
Neo4j stores account/person/company/network relationships.
ClickHouse computes transaction volume metrics.
Neo4j uses volume metrics as relationship weights for fraud path scoring.
```

---

## 7. Neo4j vs Cache / Key-Value Store

Redis/key-value cache optimizes key lookup. Neo4j optimizes connected traversal.

### 7.1 Cache question

```text
What is session for token X?
What is precomputed entitlement set for user U?
What is rate limit counter for API key K?
What is cached recommendation list for user U?
```

### 7.2 Graph question

```text
Why does user U have entitlement E?
What access path produced this entitlement?
Which entitlements should be recomputed after group G changes?
```

### 7.3 Use cache for derived graph results

Common pattern:

```text
Neo4j computes/explains access graph.
Redis caches effective entitlement set.
Application authorization checks Redis.
Neo4j remains explanation/recomputation engine.
```

### 7.4 Do not make cache the source of truth

If cache contains derived graph result:

```text
User U -> allowed resources [R1, R2, R3]
```

It must have:

- TTL,
- invalidation,
- version,
- source graph snapshot,
- rebuild path.

### 7.5 Cache invalidation from graph changes

If relationship changes:

```text
User -> Group
Group -> Role
Role -> Permission
Permission -> Resource
```

Which cache keys are stale?

Graph helps answer invalidation impact:

```cypher
MATCH (g:Group {id: $groupId})
MATCH (u:User)-[:MEMBER_OF*0..4]->(g)
RETURN u.id AS userId;
```

Then invalidate:

```text
entitlements:userId
```

---

## 8. Neo4j vs Stream / Message Broker

Kafka/RabbitMQ/Pulsar/NATS and Neo4j solve different problems.

### 8.1 Stream question

```text
How do events flow between services?
How can downstream consumers react asynchronously?
How do we replay changes?
How do we decouple producers and consumers?
```

### 8.2 Graph question

```text
What is the current connected state?
How are entities related?
What path explains this decision?
What impact does this change have?
```

### 8.3 Stream feeds graph

Common pattern:

```text
Domain events -> Kafka -> graph projector -> Neo4j
```

Events:

```text
UserCreated
GroupMembershipAdded
RoleAssigned
TransactionPosted
CaseLinked
EvidenceAttached
CompanyOwnershipChanged
```

Neo4j projection:

```text
current connected graph
```

### 8.4 Graph emits events

Neo4j-derived events:

```text
SuspiciousRingDetected
ToxicCombinationFound
AccessReviewItemCreated
DependencyBlastRadiusChanged
EntityResolved
```

### 8.5 Do not use Neo4j as event broker

Neo4j transaction log is not an event streaming platform for application integration.

Use proper messaging/streaming when you need:

- fan-out,
- backpressure,
- replay,
- consumer groups,
- async decoupling,
- ordered event processing.

### 8.6 Do not use Kafka as graph query engine

Kafka stores ordered events, not queryable connected state.

You can build KTables/materialized views, but arbitrary multi-hop graph traversal belongs elsewhere.

---

## 9. Neo4j vs Vector Database

Modern applications often compare graph with vector databases due to RAG.

### 9.1 Vector question

```text
Which items are semantically similar to this embedding?
Which chunk is close to this query vector?
Which product/image/text has nearest-neighbor similarity?
```

### 9.2 Graph question

```text
Which facts are connected to this entity?
Which evidence supports this claim?
Which path explains ownership?
Which related nodes should be included in context?
```

### 9.3 Vector search limitation

Vector similarity can retrieve semantically close content but may struggle with:

- exact entity identity,
- multi-hop relationships,
- temporal validity,
- source provenance,
- structural constraints,
- authorization filtering,
- deterministic explanation.

### 9.4 Graph limitation

Graph traversal requires structured entities/relationships. It may miss semantically related text if no relation exists.

### 9.5 Hybrid GraphRAG

Architecture:

```text
Text/documents -> chunking -> embeddings -> vector index
Text/documents -> entity/relation extraction -> knowledge graph
Query -> vector retrieval -> entity grounding -> graph expansion -> context assembly -> LLM
```

Use graph to enforce:

```text
same entity
same tenant
same time period
related evidence
known source
allowed viewer scope
```

Use vector to handle:

```text
semantic recall
paraphrases
unstructured text
fuzzy conceptual similarity
```

---

## 10. Neo4j vs Specialized Authorization Systems

IAM/access graph often raises comparison with:

- OPA/Rego,
- Cedar,
- Zanzibar-style systems,
- relationship tuple stores,
- cloud IAM engines,
- policy decision points.

### 10.1 Specialized auth systems shine when

```text
Authorization check is inline.
Latency is strict.
Decision semantics must be deterministic.
Policy evaluation is central.
Access tuple format is stable.
High QPS authorization is required.
```

### 10.2 Neo4j shines when

```text
Need investigation and explanation.
Need cross-system entitlement analysis.
Need access review campaign.
Need toxic combination detection.
Need blast-radius analysis.
Need path exploration.
Need graph analytics.
```

### 10.3 Hybrid

```text
Policy engine decides allow/deny at runtime.
Neo4j explains, audits, reviews, analyzes, and detects risk.
```

Or:

```text
Neo4j computes effective relationship tuples.
Authorization engine serves low-latency decisions.
```

---

## 11. Neo4j vs GraphQL

GraphQL is an API query language. Neo4j is a graph database. They are not substitutes.

GraphQL can expose nested object queries:

```graphql
query {
  user(id: "u1") {
    groups {
      roles {
        permissions {
          resources { id }
        }
      }
    }
  }
}
```

But GraphQL alone does not provide:

- graph storage,
- traversal engine,
- graph algorithms,
- path semantics,
- relationship persistence,
- database constraints,
- query planning over graph topology.

Neo4j can sit behind GraphQL API.

Caution:

```text
GraphQL nested query can accidentally create unbounded graph traversal and N+1 problems.
```

Use:

- depth limits,
- complexity limits,
- query allowlist,
- explicit resolver design,
- bounded Cypher queries.

---

## 12. Polyglot Persistence Patterns

Most mature systems use Neo4j with other databases.

### 12.1 Pattern A — Relational source-of-truth + Neo4j graph projection

```text
PostgreSQL:
  canonical case/customer/order records

Neo4j:
  entity relationships, investigation paths, ownership, access graph
```

Use when:

```text
records need strong OLTP,
relationships need graph traversal.
```

Data flow:

```text
Postgres changes -> CDC/Kafka -> graph projector -> Neo4j
```

Risk:

```text
projection staleness
dual write inconsistency
identity mismatch
```

Mitigation:

```text
CDC
idempotent projector
reconciliation
source version
lastSeenAt
```

### 12.2 Pattern B — Document source + graph relationship index

```text
MongoDB:
  full case/customer/evidence documents

Neo4j:
  extracted entities and relationships
```

Use when:

```text
documents are rich aggregates but investigation needs cross-document links.
```

### 12.3 Pattern C — Search + graph investigation

```text
Elasticsearch:
  full-text search over documents/entities

Neo4j:
  relationship expansion and path explanation
```

Use when:

```text
users start with keyword/semantic search, then need connected exploration.
```

### 12.4 Pattern D — OLAP + graph scores

```text
ClickHouse:
  event/fact analytics

Neo4j:
  network analytics and connected features
```

Flow:

```text
OLAP computes transaction metrics.
Neo4j stores metrics as node/relationship properties.
Neo4j GDS computes risk/community scores.
OLAP dashboards consume scores.
```

### 12.5 Pattern E — Graph + cache for serving

```text
Neo4j:
  computes relationships/explanations

Redis:
  serves hot effective results
```

### 12.6 Pattern F — Stream-fed graph

```text
Kafka:
  event transport and replay

Neo4j:
  current graph projection
```

---

## 13. Ownership of Truth

One of the most important architecture questions:

```text
Is Neo4j source-of-truth or projection?
```

### 13.1 Neo4j as source-of-truth

Appropriate when:

```text
domain is inherently graph-native
writes are graph-shaped
relationship lifecycle is primary
no other system owns the facts
application semantics depend on graph paths
```

Examples:

```text
knowledge graph curation platform
graph-native investigation workspace
manual entity linkage system
network topology management
graph-native access review product
```

Responsibilities:

- transaction correctness,
- data lifecycle,
- audit,
- backup,
- migration,
- ownership,
- write APIs,
- conflict handling.

### 13.2 Neo4j as projection

Appropriate when:

```text
facts originate elsewhere
graph supports query/analytics
source systems remain authoritative
projection can be rebuilt
```

Examples:

```text
IAM graph from HR/IdP/app entitlements
fraud graph from transactions/accounts/devices
supply chain graph from ERP/vendor systems
dependency graph from SCM/package registry
```

Responsibilities:

- idempotent ingestion,
- freshness,
- reconciliation,
- source provenance,
- rebuildability,
- stale data detection.

### 13.3 Dangerous middle

Worst state:

```text
Some facts updated in source system.
Some facts updated directly in Neo4j.
No clear conflict resolution.
No rebuild possible.
No audit of ownership.
```

Avoid this.

---

## 14. Sync Failure Modes

Polyglot persistence creates failure modes.

### 14.1 Dual write failure

```text
Application writes Postgres.
Application writes Neo4j.
Postgres succeeds.
Neo4j fails.
```

Now systems disagree.

Avoid direct dual writes unless carefully transactional/outboxed.

Better:

```text
write source-of-truth
emit event/outbox
project to Neo4j asynchronously
reconcile
```

### 14.2 Event ordering

Example:

```text
RoleAssigned arrives before UserCreated.
```

Graph projector must handle:

- missing node placeholder,
- retry,
- dead-letter,
- eventual merge.

### 14.3 Deletion ambiguity

If source deletes entity, should graph:

```text
delete node?
soft delete?
end validity?
retain for audit?
```

For regulated systems, prefer valid-time/history rather than hard delete.

### 14.4 Identity resolution drift

Same entity appears from multiple systems:

```text
HR user ID
Okta ID
Application user ID
email
employee number
```

Need identity resolution model:

```text
(:User)-[:HAS_IDENTIFIER]->(:Identifier)
(:Identifier)-[:FROM_SOURCE]->(:SourceSystem)
```

### 14.5 Stale graph decisions

If Neo4j powers decisions, stale projection can cause wrong decision.

Need:

- freshness SLA,
- source offset tracking,
- decision includes graphSnapshotVersion,
- fail-safe behavior.

---

## 15. Query Routing by Workload

A robust architecture routes each question to the best engine.

### 15.1 Example: case management platform

Question:

```text
Show case details.
```

Route:

```text
relational/document store
```

Question:

```text
Search case narrative by keyword.
```

Route:

```text
search engine
```

Question:

```text
Show related parties within 3 hops.
```

Route:

```text
Neo4j
```

Question:

```text
Monthly enforcement statistics.
```

Route:

```text
OLAP
```

Question:

```text
Check current user permissions quickly.
```

Route:

```text
cache/materialized authorization service
```

Question:

```text
Publish case updated event.
```

Route:

```text
message broker/stream
```

### 15.2 Avoid “one database to rule them all”

A database may support many features, but using one system for all workloads often creates:

- performance compromise,
- operational complexity,
- poor cost model,
- awkward query patterns,
- weak team expertise,
- unclear ownership.

---

## 16. Cost Model Thinking

### 16.1 Relational cost

Cost drivers:

```text
join complexity
index maintenance
transaction volume
lock contention
schema migration
warehouse/reporting load
```

### 16.2 Graph cost

Cost drivers:

```text
relationship count
traversal fan-out
path explosion
supernodes
page cache size
query planning
derived edge maintenance
graph algorithm memory
```

### 16.3 Search cost

Cost drivers:

```text
index size
shard count
refresh rate
text analysis
query scoring
replication
high-cardinality facets
```

### 16.4 OLAP cost

Cost drivers:

```text
data volume
scan frequency
partitioning
compression
materialized views
concurrency
retention
```

### 16.5 Cache cost

Cost drivers:

```text
memory
eviction
invalidation complexity
hot key skew
rebuild storm
```

### 16.6 Stream cost

Cost drivers:

```text
retention
partition count
consumer lag
serialization compatibility
replay volume
exactly-once expectations
```

A mature architecture compares costs by workload, not by vendor preference.

---

## 17. Decision Matrix

### 17.1 Use Neo4j when

```text
[ ] You need multi-hop traversal.
[ ] You need path explanation.
[ ] Relationship type/properties/lifecycle matter.
[ ] Many-to-many relationships dominate.
[ ] Indirect connections drive business value.
[ ] You need graph algorithms.
[ ] Domain users think in networks.
[ ] Query asks "how is X connected to Y?"
[ ] You need impact/blast-radius analysis.
[ ] You need relationship-based investigation.
```

### 17.2 Prefer relational when

```text
[ ] Data is tabular and transactional.
[ ] Query depth is small and predictable.
[ ] Strong relational constraints dominate.
[ ] SQL reporting ecosystem is central.
[ ] Most access is by ID/range/status.
[ ] Joins are bounded and well-understood.
[ ] Existing RDBMS solves it cleanly.
```

### 17.3 Prefer document when

```text
[ ] Aggregate boundary is clear.
[ ] You retrieve/write whole documents.
[ ] Nested structure belongs to parent.
[ ] Schema varies by document.
[ ] Cross-document traversal is minimal.
```

### 17.4 Prefer search engine when

```text
[ ] Text relevance is central.
[ ] Fuzzy search/autocomplete/facets matter.
[ ] Ranking and query analysis matter.
[ ] Users start from keyword/semantic search.
[ ] Relationship traversal is secondary.
```

### 17.5 Prefer OLAP when

```text
[ ] Large scans and aggregations dominate.
[ ] Dashboard/reporting workload dominates.
[ ] Columnar compression matters.
[ ] Fact tables/events are primary.
[ ] Network topology is not central.
```

### 17.6 Prefer cache when

```text
[ ] Low-latency key lookup dominates.
[ ] Data is derived or ephemeral.
[ ] Staleness is acceptable/managed.
[ ] Invalidation is tractable.
```

### 17.7 Prefer stream/broker when

```text
[ ] You need asynchronous integration.
[ ] Event replay matters.
[ ] Multiple consumers need same events.
[ ] Backpressure/ordering/fan-out matters.
[ ] You are moving facts, not querying connected state.
```

---

## 18. Architecture Review Questions

Before approving Neo4j in an architecture, ask:

```text
What are the top 10 queries?
Which queries are path queries?
What max traversal depth is expected?
What relationship types are traversed?
What is the expected fan-out?
Are there supernodes?
Is Neo4j source-of-truth or projection?
How is graph built?
Can graph be rebuilt?
What is freshness SLA?
What happens if graph lags?
What are data quality gates?
What constraints/indexes are required?
What query performance budgets exist?
What is the migration strategy?
How are path explanations stored?
How is tenant/security trimming enforced?
What workloads remain outside Neo4j?
```

If these questions cannot be answered, the graph design is not production-ready.

---

## 19. Anti-Decision Smells

### 19.1 “We need Neo4j because graph sounds modern”

Bad reason.

Need concrete graph-shaped queries.

### 19.2 “We need Neo4j because SQL joins are slow”

Maybe. But slow joins may indicate:

- missing indexes,
- bad schema,
- wrong query,
- OLAP workload on OLTP DB,
- poor partitioning,
- overfetching.

Neo4j is justified when relationship traversal and path semantics are central, not merely because a SQL query is slow.

### 19.3 “We will put all enterprise data in graph”

Dangerous.

Graph should contain data needed for connected queries. Do not turn it into unbounded enterprise data lake.

### 19.4 “We can replace search with graph”

Usually wrong.

Use graph for connections; use search for relevance.

### 19.5 “We can replace Kafka with graph”

Wrong abstraction.

Graph stores connected state. Kafka moves events.

### 19.6 “The graph is flexible, so we do not need schema governance”

Wrong.

Flexible without constraints becomes semantic chaos.

---

## 20. Worked Example: Regulatory Case Management Platform

Assume a platform for enforcement lifecycle.

### 20.1 Workloads

```text
case CRUD
document storage
full-text search
entity relationship investigation
case similarity
risk scoring
monthly reporting
access control
audit trail
event integration
```

### 20.2 Recommended architecture

```text
Relational DB:
  case records, workflow state, assignments, decisions

Document/Object Store:
  evidence files, full documents, attachments

Search Engine:
  narrative search, document search, name search, fuzzy matching

Neo4j:
  persons, organizations, accounts, cases, evidence relationships,
  ownership/control paths, related case graph, investigation network

OLAP:
  metrics, SLA, trend, workload analytics, enforcement reporting

Kafka/RabbitMQ:
  case events, evidence events, graph projection events

Redis:
  session, hot authorization cache, short-lived derived results
```

### 20.3 Why this split works

Case record:

```text
needs transactional workflow correctness
```

Document:

```text
large binary/text object lifecycle
```

Search:

```text
needs relevance, fuzzy matching, highlighting
```

Graph:

```text
needs related-party discovery and explanation path
```

OLAP:

```text
needs aggregation over time
```

Stream:

```text
needs decoupled updates
```

Cache:

```text
needs low-latency serving
```

### 20.4 Neo4j graph model

```text
(:Case)-[:INVOLVES]->(:Person)
(:Case)-[:INVOLVES]->(:Organization)
(:Person)-[:OWNS|CONTROLS|DIRECTOR_OF]->(:Organization)
(:Organization)-[:TRANSACTS_WITH]->(:Organization)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Evidence)-[:MENTIONS]->(:Entity)
(:Case)-[:RELATED_TO]->(:Case)
```

### 20.5 Query

```cypher
MATCH path =
  (:Case {id: $caseId})
  -[:INVOLVES|SUPPORTED_BY|MENTIONS|OWNS|CONTROLS|DIRECTOR_OF|TRANSACTS_WITH*1..4]-
  (related)
RETURN path
LIMIT 100;
```

This is exactly graph-shaped.

But case workflow state machine should likely remain relational or application-owned, unless the workflow itself requires graph traversal.

---

## 21. Worked Example: IAM Platform

### 21.1 Good split

```text
IdP/IGA/PAM:
  source-of-truth for identity, group, grants

Neo4j:
  entitlement graph, inherited access explanation, toxic combination, blast radius

Policy engine:
  runtime allow/deny

Redis:
  hot effective permission cache

Kafka:
  identity and entitlement change events

OLAP:
  access review metrics and compliance reports
```

### 21.2 Why not Neo4j only?

Runtime authorization may need:

- very low latency,
- strict deterministic policy,
- high QPS,
- simple allow/deny.

Neo4j is excellent for:

- explaining why,
- reviewing who,
- detecting risk,
- analyzing paths.

---

## 22. Worked Example: Recommendation Platform

### 22.1 Good split

```text
OLTP DB:
  users, orders, product inventory

Event stream:
  clicks, views, purchases

OLAP:
  aggregate behavior metrics

Neo4j:
  user-item-category-similarity graph, path explanation, cold-start relatedness

Vector DB / vector index:
  semantic content/product similarity

Cache:
  final recommendation list per user
```

### 22.2 Graph-specific value

```text
Because user follows X.
Because similar users bought Y.
Because item belongs to category linked to previous behavior.
Because there is a short path through shared attributes.
```

Graph makes recommendations explainable.

---

## 23. Worked Example: Software Dependency and Supply Chain Risk

### 23.1 Good split

```text
Package registry/source scanner:
  source facts

Neo4j:
  dependency graph, transitive impact, vulnerable path explanation

Search:
  vulnerability advisory text

OLAP:
  metrics across repos/teams

Stream:
  new CVE/package update events

Cache:
  hot vulnerability summary
```

### 23.2 Graph query

```cypher
MATCH path =
  (:Service {id: $serviceId})
  -[:DEPENDS_ON*1..10]->
  (:Package {cve: $cveId})
RETURN path
LIMIT 50;
```

This is graph-native.

---

## 24. How to Introduce Neo4j Without Overcommitting

### 24.1 Start as projection

Safer initial adoption:

```text
Keep existing source-of-truth.
Build graph projection.
Answer one or two high-value graph queries.
Measure performance and usefulness.
```

### 24.2 Pick a high-value question

Examples:

```text
Show related entities within 3 hops for an investigation.
Explain inherited access path.
Find dependency blast radius.
Find fraud ring around suspicious account.
```

### 24.3 Avoid first project being too broad

Bad first project:

```text
Build enterprise knowledge graph of everything.
```

Better first project:

```text
Build access explanation graph for privileged roles.
```

### 24.4 Define exit criteria

```text
query latency target
analyst task reduction
false positive reduction
audit explanation quality
manual investigation time saved
rebuild time
freshness SLA
```

---

## 25. Final Decision Framework

Use these questions:

### 25.1 Workload

```text
Are top queries relationship/path-heavy?
Do queries require variable-depth traversal?
Do users ask "how is X connected to Y?"
Is path explanation valuable?
```

### 25.2 Data shape

```text
Are there many-to-many-to-many relationships?
Do relationships have type/properties/lifecycle?
Does topology itself contain meaning?
```

### 25.3 Operations

```text
Can team operate Neo4j?
Can graph fit in memory/page cache model?
Can you monitor slow traversals?
Can you handle supernodes?
```

### 25.4 Integration

```text
Is Neo4j source-of-truth or projection?
How will data sync?
Can graph be rebuilt?
What happens when projection lags?
```

### 25.5 Governance

```text
Are constraints/indexes defined?
Are graph invariants tested?
Are path semantics documented?
Are consumers insulated from internal graph shape?
```

If the answer is weak on all graph-specific questions, do not use Neo4j.

If the answer is strong, Neo4j can unlock architectural simplicity that other databases struggle to provide.

---

## 26. Summary

Neo4j is not a replacement for every database. It is a specialized engine for connected data.

Use Neo4j when:

```text
relationships are first-class,
paths are meaningful,
indirect connections matter,
network structure drives decisions,
explanation is important,
graph algorithms provide value.
```

Use relational/document/search/OLAP/cache/stream systems for their natural workloads.

The mature architecture is often polyglot:

```text
source-of-truth records in relational/document systems
events through stream/broker
text in search engine
aggregates in OLAP
hot results in cache
connected intelligence in Neo4j
```

The strongest engineers do not ask:

```text
Can this database store the data?
```

They ask:

```text
Which engine makes the important questions cheap, correct, explainable, operable, and evolvable?
```

That is the essence of comparative architecture.

---

## 27. Status Seri

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
Part 031 selesai.
Seri belum selesai.
Masih ada Part 032.
```

Lanjut berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-032.md
```

Topik:

```text
Capstone: Designing a Production-Grade Graph Platform for Complex Case Management
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Testing, Migration, Refactoring, and Evolution of Graph Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-032.md">Part 032 — Capstone: Designing a Production-Grade Graph Platform for Complex Case Management ➡️</a>
</div>
