# Strict Coding Standards: Java + Elasticsearch

> **Document status:** mandatory standard for LLM-assisted Java implementation that interacts with Elasticsearch.
>
> **Applies to:** Java 11/17/21/25 services using Elasticsearch for application search, read-model indexing, analytics search, log/event search, vector/hybrid search, background indexing jobs, or operational search adapters.
>
> **Depends on:**
>
> - `strict-coding-standards__java_http.md`
> - `strict-coding-standards__java_json.md`
> - `strict-coding-standards__java_security.md`
> - `strict-coding-standards__java_testing.md`
> - `strict-coding-standards__java_benchmarking.md`
> - `strict-coding-standards__java_telemetry.md`
> - `strict-coding-standards__java_jackson.md`
>
> **Core principle:** Elasticsearch is a distributed search/indexing system, not a transactional relational database. Java code must make indexing consistency, mapping, query semantics, pagination, retry, and operational behavior explicit.

---

## 1. Scope

This standard governs Java code that talks to Elasticsearch directly or through framework abstractions.

It covers:

- official Elasticsearch Java API Client
- client lifecycle and dependency governance
- version compatibility
- authentication and TLS
- index, data stream, alias, and template usage
- mappings and analyzers
- document schema/versioning
- indexing and bulk indexing
- refresh/search visibility semantics
- query design
- pagination
- aggregations
- update/delete/reindex behavior
- retry/idempotency
- error handling
- observability
- testing
- performance evidence

This file does **not** replace HTTP, JSON, security, telemetry, or testing standards. It adds Elasticsearch-specific rules.

---

## 2. Non-negotiable rules for LLM code agents

LLM agents **MUST NOT** write Java/Elasticsearch code until they can answer these questions:

1. Which Elasticsearch major/minor version is targeted?
2. Is this truly Elasticsearch, Elastic Cloud, Elastic Cloud Serverless, or OpenSearch?
3. Which Java client is used: official Java API Client, low-level REST client, Spring Data Elasticsearch, or legacy HLRC?
4. Who owns the index/data stream/template/alias lifecycle?
5. Is Elasticsearch the source of truth or a derived/search projection?
6. What is the document identity strategy?
7. What is the mapping contract?
8. What fields are `text`, `keyword`, numeric, date, geo, nested, object, vector, or runtime fields?
9. What analyzers/normalizers are required?
10. What query shape and expected cardinality are required?
11. What pagination strategy is required?
12. What is the consistency expectation after indexing?
13. What retry/idempotency guarantees are required?
14. What security boundary protects query input and index access?
15. What evidence proves the query/indexing path is performant?

If any answer is unknown, the agent must inspect the codebase/configuration or state the assumption explicitly in the implementation notes.

---

## 3. Version and compatibility policy

### 3.1 Elasticsearch version must be explicit

Every project must declare the supported Elasticsearch version line.

Example:

```text
Elasticsearch compatibility: 8.19.x / 9.4.x
Client: co.elastic.clients:elasticsearch-java:<pinned-version>
Runtime: Elastic Cloud / self-managed / Kubernetes / serverless
```

The agent must not infer version from old examples found online.

### 3.2 Use the official Java API Client for new code

New Java code **MUST** prefer:

```text
co.elastic.clients:elasticsearch-java
```

The official Java API Client provides strongly typed requests and responses for Elasticsearch APIs.

### 3.3 Legacy High Level REST Client is forbidden for new code

The Java High Level REST Client, also called HLRC, is **FORBIDDEN** for new code.

It is only allowed in legacy modules when all of these are true:

- the module already uses HLRC;
- migration risk is documented;
- there is a planned migration path to the Java API Client;
- compatibility mode requirements are documented;
- no new feature is implemented using HLRC unless explicitly approved.

### 3.4 OpenSearch is not Elasticsearch

OpenSearch and Elasticsearch must be treated as separate platforms.

LLM agents **MUST NOT**:

- use Elasticsearch Java client for OpenSearch unless the project has explicitly standardized it;
- use OpenSearch docs to justify Elasticsearch behavior;
- assume feature, query, security, and client compatibility across forks.

---

## 4. Dependency governance

### 4.1 Pin client version

The Elasticsearch Java client version must be pinned through Maven/Gradle dependency management.

Allowed:

```xml
<dependency>
  <groupId>co.elastic.clients</groupId>
  <artifactId>elasticsearch-java</artifactId>
  <version>${elasticsearch-java.version}</version>
</dependency>
```

Forbidden:

```xml
<version>LATEST</version>
```

Forbidden:

```gradle
implementation("co.elastic.clients:elasticsearch-java:+")
```

### 4.2 JSON mapper must be intentional

The project must declare whether the Elasticsearch client uses:

- Jackson JSON mapper;
- JSON-B mapper;
- custom mapper.

The mapper must follow `strict-coding-standards__java_json.md` and `strict-coding-standards__java_jackson.md`.

---

## 5. Client lifecycle

### 5.1 Client must be singleton/lifecycle-managed

`ElasticsearchClient`, transport, HTTP client, and credentials provider must be created once per application lifecycle and reused.

Forbidden:

```java
public SearchResponse<ProductDoc> search(String text) {
    ElasticsearchClient client = createClient(); // FORBIDDEN per request
    return client.search(...);
}
```

Required:

```java
public final class ProductSearchAdapter {
    private final ElasticsearchClient client;

    public ProductSearchAdapter(ElasticsearchClient client) {
        this.client = Objects.requireNonNull(client, "client");
    }
}
```

### 5.2 Transport close ownership must be clear

The component that creates the transport must close it during application shutdown.

Rules:

- application-managed client: close transport on shutdown;
- framework-managed client: let framework close it;
- tests: always close client/transport/container.

### 5.3 Timeout must be explicit

Every client must define:

- connect timeout;
- socket/read timeout;
- request timeout;
- max retry timeout/backoff if applicable;
- connection pool limit if using an underlying HTTP client.

Forbidden: relying on undocumented defaults.

---

## 6. Authentication, TLS, and network security

### 6.1 No plain HTTP in production

Production connections **MUST** use HTTPS/TLS unless the connection is a local sidecar/proxy path explicitly documented and protected.

Forbidden:

```text
http://elasticsearch-prod:9200
```

### 6.2 Credentials must not be hardcoded

Forbidden:

```java
String apiKey = "base64-secret";
String password = "elastic";
```

Required:

- environment/secret manager injection;
- least-privilege Elasticsearch credentials;
- no credential logging;
- no credentials in index documents;
- no credentials in query labels/tags.

### 6.3 Index-level authorization must be explicit

Java code must not assume one service credential can access every index.

Service credentials should be scoped to:

- required index/data stream patterns;
- read/write/admin operations separately;
- no wildcard destructive access unless approved.

### 6.4 User-controlled index names are forbidden

User input must not directly choose index/data stream/alias names.

Forbidden:

```java
client.search(s -> s.index(request.getIndex()), ProductDoc.class);
```

Allowed:

```java
enum SearchDomain {
    PRODUCTS("products-read"), ORDERS("orders-read");

    private final String alias;

    SearchDomain(String alias) {
        this.alias = alias;
    }

    String alias() {
        return alias;
    }
}
```

---

## 7. Index, data stream, and alias ownership

### 7.1 Do not write directly to physical index names by default

Application code should write to a stable write alias or data stream, not a physical index like `product-v42-000001`.

Allowed patterns:

```text
products-write      -> write alias
products-read       -> read alias
logs-app-service    -> data stream
```

Forbidden unless migration/admin code:

```text
products-2026-06-10-000001
```

### 7.2 Use aliases for zero-downtime reindexing

Any searchable index with schema evolution must use read/write aliases or data streams so the application does not hardcode physical index names.

### 7.3 Data streams are for append-oriented time series data

Data streams are appropriate for:

- logs;
- metrics;
- traces;
- append-only time-series events;
- immutable event-like search data.

Data streams are not the default for mutable domain documents.

### 7.4 Index lifecycle is infrastructure-owned

The agent must not silently create indices in application code unless the project explicitly allows application-owned index bootstrapping.

Preferred ownership:

- Terraform/CloudFormation/Pulumi;
- Helm/Kubernetes job;
- migration/admin tool;
- dedicated index-management module.

Application code should fail fast if a required alias/index is missing, unless auto-creation is explicitly part of the service contract.

---

## 8. Mapping and analyzer rules

### 8.1 Explicit mappings are mandatory for business indices

Dynamic mapping is allowed only for exploratory/dev workloads.

Business indices must define explicit mappings for:

- `keyword` fields;
- `text` fields;
- `date` fields;
- numeric fields;
- `boolean` fields;
- `object` vs `nested` fields;
- vector fields;
- geo fields;
- `ignore_above` for keyword-like strings;
- analyzers/normalizers.

### 8.2 Do not rely on default text analysis for business search

The search behavior must declare:

- language analyzer;
- stemming requirements;
- case folding;
- accent folding;
- synonyms;
- tokenization behavior;
- exact-match field;
- autocomplete strategy;
- sorting field.

Example field contract:

```json
{
  "name": {
    "type": "text",
    "analyzer": "english",
    "fields": {
      "keyword": {
        "type": "keyword",
        "ignore_above": 256
      }
    }
  }
}
```

### 8.3 Use `keyword` for exact match, sort, aggregation, and IDs

Fields used for exact filtering, joins by ID, terms aggregation, sorting, or authorization filters should be `keyword`, numeric, date, or boolean, not analyzed `text`.

### 8.4 Use `nested` only when object-array independence matters

`nested` fields are restricted.

Use `nested` when each object in an array must preserve field co-occurrence.

Do not use `nested` for simple flattened metadata without query need.

### 8.5 Mapping changes must be migration-aware

Many mapping changes require reindexing. LLM agents must not modify mappings without a migration plan.

Mapping change note must include:

```text
Field:
Old mapping:
New mapping:
Backward compatibility:
Requires reindex: yes/no
Read alias impact:
Write alias impact:
Rollback/roll-forward plan:
```

---

## 9. Document model rules

### 9.1 Elasticsearch document DTO is not domain entity

Documents indexed into Elasticsearch must be explicit projection DTOs.

Forbidden:

```java
@Entity
class Product { ... }

client.index(i -> i.index("products").document(product)); // FORBIDDEN
```

Required:

```java
public record ProductSearchDocument(
        String id,
        String name,
        String status,
        Instant updatedAt,
        long version
) {}
```

### 9.2 Document IDs must be deterministic

Business projections should use deterministic IDs.

Allowed:

```text
product:<productId>
case:<caseId>
tenant:<tenantId>:product:<productId>
```

Forbidden unless truly append-only:

```java
UUID.randomUUID().toString()
```

### 9.3 Schema version field is mandatory for long-lived documents

Long-lived document projections should include:

```json
{
  "schemaVersion": 3,
  "indexedAt": "2026-06-10T10:30:00Z",
  "sourceUpdatedAt": "2026-06-10T10:29:55Z"
}
```

### 9.4 Do not store sensitive source data unless searchable need exists

Elasticsearch documents often become broadly searchable/observable. Only index fields needed for search/filter/display.

Forbidden by default:

- passwords;
- tokens;
- API keys;
- full identity numbers;
- private keys;
- unnecessary PII;
- secrets from configuration;
- raw authorization claims not needed for filtering.

---

## 10. Indexing rules

### 10.1 Indexing must be idempotent

Indexing code must tolerate duplicate events/messages/retries.

Required:

- deterministic document ID;
- source version or update timestamp;
- upsert semantics if needed;
- stale event handling;
- retry-safe operation design.

### 10.2 Elasticsearch write success is not database transaction success

When Elasticsearch is a projection of database state, the database remains source of truth unless architecture explicitly says otherwise.

Preferred patterns:

- transactional outbox;
- CDC-driven indexing;
- background reconciliation;
- replayable indexing events;
- full reindex capability.

### 10.3 Do not index inside a relational DB transaction unless justified

Forbidden by default:

```java
@Transactional
public void updateProduct(UpdateProductCommand command) {
    repository.save(product);
    elasticsearchClient.index(...); // FORBIDDEN by default
}
```

Preferred:

```java
@Transactional
public void updateProduct(UpdateProductCommand command) {
    repository.save(product);
    outbox.append(ProductUpdatedEvent.from(product));
}
```

### 10.4 Use external versioning only when source version is authoritative

If using optimistic concurrency/version constraints, the version source must be clear:

- database row version;
- event sequence;
- aggregate version;
- update timestamp with tie-breaker.

Never invent versioning locally inside the search adapter.

---

## 11. Bulk indexing

### 11.1 Use bulk API for multiple documents

Multiple index/update/delete operations must use Bulk API or a framework equivalent.

Forbidden:

```java
for (ProductSearchDocument doc : docs) {
    client.index(i -> i.index("products-write").id(doc.id()).document(doc));
}
```

Allowed:

```java
BulkRequest.Builder bulk = new BulkRequest.Builder();
for (ProductSearchDocument doc : docs) {
    bulk.operations(op -> op.index(idx -> idx
            .index("products-write")
            .id(doc.id())
            .document(doc)));
}
BulkResponse response = client.bulk(bulk.build());
```

### 11.2 Bulk response must inspect per-item failures

A bulk request can partially fail. Code must inspect item-level results.

Required:

```java
BulkResponse response = client.bulk(request);
if (response.errors()) {
    for (BulkResponseItem item : response.items()) {
        if (item.error() != null) {
            // classify retryable/non-retryable and report item identity
        }
    }
}
```

### 11.3 Bulk size must be bounded

Bulk ingestion must define:

- max documents per batch;
- max estimated payload bytes per batch;
- max in-flight bulk requests;
- backoff policy;
- per-item failure handling;
- DLQ/retry topic/file/table if used.

### 11.4 Do not force refresh after every bulk

`refresh=true` after every write/bulk is forbidden by default.

Allowed options:

- default `refresh=false` for throughput;
- `refresh=wait_for` only when request-response semantics require read-after-write visibility;
- explicit refresh only for tests/admin/reindex phase boundaries.

---

## 12. Refresh and consistency

### 12.1 Search is near real-time, not immediately consistent

Code must not assume indexed documents are immediately visible to search.

Required for tests:

- use `refresh=wait_for` only when necessary;
- or explicitly refresh test index;
- or poll with timeout using Awaitility-like approach.

Forbidden in production hot path:

```java
client.indices().refresh(r -> r.index("products-write"));
```

### 12.2 Read-after-write must be designed

If API requires immediate read-after-write behavior, choose one:

1. return source-of-truth state from database;
2. use direct `get` by ID if acceptable;
3. use `refresh=wait_for` for low-volume operations;
4. accept eventual consistency and expose status/pending state.

Do not hide eventual consistency behind unreliable sleeps.

Forbidden:

```java
Thread.sleep(1000); // wait for Elasticsearch refresh
```

---

## 13. Search query rules

### 13.1 Search must be contract-based

Every production query must define:

- target alias/index/data stream;
- allowed filters;
- scoring behavior;
- sort order;
- pagination method;
- timeout;
- track total hits policy;
- minimum_should_match if using multi-term text queries;
- tenant/authorization filter if applicable.

### 13.2 User input must not become raw query DSL

Forbidden:

```java
client.search(s -> s.withJson(new StringReader(request.getRawElasticQuery())), ProductDoc.class);
```

Allowed:

```java
client.search(s -> s
        .index("products-read")
        .query(q -> q.bool(b -> b
                .filter(f -> f.term(t -> t.field("tenantId").value(tenantId)))
                .must(m -> m.match(mm -> mm.field("name").query(searchText)))
        )), ProductSearchDocument.class);
```

### 13.3 Filter and query context must be intentional

Use filter context for exact constraints that do not affect score:

- tenant ID;
- status;
- type;
- date range;
- authorization scope;
- numeric range.

Use query/scoring context for relevance:

- full-text search;
- boosting;
- phrase matching;
- semantic/vector relevance.

### 13.4 Tenant and authorization filters must be impossible to forget

For multi-tenant systems, tenant filter must be applied in a central adapter/policy layer, not manually repeated in every query.

Required structure:

```text
SearchRequestBuilder
  -> always applies tenant constraint
  -> applies authorization constraint
  -> then applies feature-specific query
```

---

## 14. Pagination rules

### 14.1 Shallow pagination may use `from` + `size`

`from` + `size` is allowed only for shallow UI pagination with bounded result window.

Example:

```text
page <= 50
size <= 100
from + size <= configured index.max_result_window
```

### 14.2 Deep pagination must use `search_after` with stable sort

Deep pagination must use:

- deterministic sort;
- unique tie-breaker field;
- `search_after` values from previous page;
- point-in-time (PIT) when consistent paging across index changes is required.

Required sort example:

```text
updatedAt desc, id asc
```

### 14.3 Scroll is restricted

Scroll API is restricted to specific batch/export/reindex workloads when PIT/search-after is not suitable and the operational cost is documented.

Do not use scroll for normal user-facing pagination.

### 14.4 Random page jump is not a search_after use case

If the UI requires jump-to-page-number deep pagination, challenge the requirement. Elasticsearch deep pagination is not a relational database offset pagination replacement.

---

## 15. Aggregation rules

### 15.1 Aggregations must declare cardinality expectations

Every aggregation must document:

- expected number of buckets;
- field type;
- approximate vs exact requirements;
- timeout;
- memory risk;
- max bucket policy.

### 15.2 Do not aggregate on analyzed text

Terms aggregations must use `keyword`, numeric, boolean, date histogram, or other aggregation-appropriate field.

Forbidden:

```text
terms aggregation on name:text
```

Allowed:

```text
terms aggregation on name.keyword
```

### 15.3 Composite aggregation for paged buckets

For high-cardinality bucket pagination, use composite aggregation rather than trying to retrieve all terms buckets at once.

---

## 16. Update and delete rules

### 16.1 Prefer full document reindex for projection updates

For derived search projections, full document replacement is usually clearer than partial update scripts.

Allowed:

```java
client.index(i -> i
        .index("products-write")
        .id(document.id())
        .document(document));
```

### 16.2 Partial update scripts are restricted

Painless scripts are allowed only when:

- script is static/known;
- parameters are bound separately;
- there is a test proving behavior;
- failure handling is documented;
- script does not implement hidden business logic.

Forbidden:

```java
String script = "ctx._source." + request.getField() + " = '" + request.getValue() + "'";
```

### 16.3 Delete-by-query is restricted

Delete-by-query is operationally risky and must be approved for production use.

Required:

- precise query;
- dry-run/count check;
- rate/throttle plan;
- audit log;
- rollback/reindex plan where possible.

---

## 17. Reindexing and schema migration

### 17.1 Mapping-incompatible change requires new index

When mapping changes are incompatible, create a new index and reindex.

Required flow:

```text
1. create new physical index with new mapping
2. dual-write or backfill/reindex
3. validate document count and sample queries
4. atomically switch read alias
5. switch write alias if applicable
6. monitor errors and latency
7. retain old index for rollback window
8. delete old index only after approval
```

### 17.2 Reindexing must be resumable

Large reindex jobs must define:

- checkpoint strategy;
- batch size;
- throttling;
- retry policy;
- partial failure handling;
- validation query;
- rollback/roll-forward path.

### 17.3 Do not let application startup perform large reindex

Application startup must not run large reindex/index-template migration work.

Allowed:

- fail-fast validation;
- small dev/test bootstrap if profile-scoped;
- dedicated migration job/tool.

---

## 18. Error handling and retry

### 18.1 Classify errors

Elasticsearch errors must be classified into:

- validation/mapping error;
- authentication/authorization error;
- index/alias missing error;
- version conflict;
- timeout;
- rejected execution/backpressure;
- cluster unavailable;
- partial bulk failure;
- serialization/deserialization error.

### 18.2 Retry only retryable failures

Retry allowed:

- transient network failure;
- timeout if operation is idempotent;
- `429`/rejected execution with backoff;
- `503`/temporary cluster unavailability;
- partial bulk item retry when item operation is idempotent.

Retry forbidden:

- mapping parse error;
- illegal argument query error;
- authentication/authorization failure;
- deterministic serialization error;
- non-idempotent update without version/operation guard.

### 18.3 Idempotency key is document ID or operation version

For indexing projections, retry safety must be based on deterministic ID and version semantics.

---

## 19. Performance rules

### 19.1 Query performance must be evidence-based

For important queries, include evidence:

```text
Index/alias:
Query shape:
Expected data volume:
Sort:
Pagination:
Relevant mappings:
Relevant index settings:
Profile/explain result:
Latency target:
Observed p50/p95/p99:
Cluster/test dataset size:
```

### 19.2 Do not optimize without preserving correctness

Forbidden:

- removing tenant filter to make search faster;
- switching `text` to `keyword` without search semantics review;
- disabling refresh without consistency review;
- changing analyzer without relevance tests;
- increasing result window to avoid pagination redesign.

### 19.3 `track_total_hits` must be intentional

If exact total count is not needed, do not force exact tracking for every search.

If UI displays exact total, document the cost and expected cardinality.

### 19.4 Limit returned source fields

Search responses should request only required fields for result views when documents are large.

---

## 20. Observability

### 20.1 Every Elasticsearch call must be observable

Log/metric/trace must include:

- operation type;
- target alias/index logical name;
- duration;
- result count or bulk item count;
- status/error class;
- timeout/retry count;
- correlation ID;
- tenant/domain tag when safe.

Do not log:

- raw full query with PII;
- credentials;
- full document payload containing sensitive fields;
- user-entered secret-like search terms.

### 20.2 Slow query logging must be environment-governed

Application logs should not dump raw queries by default. Use structured low-cardinality metadata and enable detailed query logs only in controlled diagnostic contexts.

### 20.3 Indexing lag must be measurable

Derived search projections should expose indexing lag:

```text
now - sourceUpdatedAt
now - indexedAt
last processed event offset/version
failed indexing event count
DLQ size
```

---

## 21. Testing rules

### 21.1 Unit tests must not mock query semantics as truth

Unit tests can verify builder behavior, but search relevance/mapping behavior requires integration tests against Elasticsearch or a compatible test cluster.

### 21.2 Integration tests must use real Elasticsearch when behavior matters

Use Testcontainers or project-approved Elastic test environment for:

- mappings;
- analyzers;
- nested query behavior;
- pagination;
- aggregation;
- bulk partial failure handling;
- refresh behavior;
- alias switch behavior.

### 21.3 Golden relevance tests are required for business search

Business search must have fixture tests for:

- exact match;
- partial match;
- case/accent behavior;
- language/stemming behavior;
- filters;
- sorting;
- no-result case;
- authorization filter;
- typo/autocomplete behavior if applicable.

### 21.4 Tests must not rely on sleeps

Forbidden:

```java
Thread.sleep(1000);
```

Allowed:

- `refresh=wait_for` in test write path;
- explicit refresh in test setup;
- bounded polling with timeout.

---

## 22. Forbidden patterns

LLM agents must not generate these patterns:

1. New Elasticsearch client per request.
2. Hardcoded credentials.
3. Plain HTTP to production cluster.
4. User-controlled index name.
5. Raw user-controlled Elasticsearch JSON DSL.
6. Entity object directly serialized as search document.
7. Dynamic mapping for business index.
8. `refresh=true` after every write.
9. `Thread.sleep` for refresh consistency.
10. Bulk indexing without item-level failure inspection.
11. Infinite/broad retry around non-idempotent update.
12. Deep pagination using unbounded `from` + `size`.
13. Scroll for normal UI pagination.
14. Aggregating/sorting on analyzed text fields.
15. Application startup performing large reindex.
16. Delete-by-query without approval and audit.
17. Logging raw full queries/documents with PII.
18. Assuming OpenSearch and Elasticsearch are interchangeable.
19. Using HLRC for new code.
20. Treating Elasticsearch as strongly consistent transaction store.

---

## 23. Required implementation note for LLM changes

Any change involving Elasticsearch must include:

```text
Elasticsearch change note
- Target Elasticsearch version:
- Java client/library:
- Target index/data stream/alias:
- Source of truth:
- Operation type: search/index/update/delete/bulk/reindex/admin
- Mapping impact:
- Analyzer impact:
- Query shape:
- Pagination strategy:
- Consistency expectation:
- Retry/idempotency policy:
- Security/tenant filter:
- Observability fields:
- Test coverage:
- Rollback/roll-forward plan:
```

---

## 24. Reviewer checklist

Reviewers must reject the change if any answer is missing:

### Version/client

- [ ] Elasticsearch version is explicit.
- [ ] Java client version is pinned.
- [ ] HLRC is not used for new code.
- [ ] OpenSearch is not accidentally treated as Elasticsearch.

### Security

- [ ] TLS/HTTPS is configured for production.
- [ ] Credentials are not hardcoded or logged.
- [ ] Index access is least-privilege.
- [ ] User input cannot choose raw index name or raw query DSL.
- [ ] Tenant/authorization filter is central and tested.

### Mapping/index lifecycle

- [ ] Mapping is explicit for business index.
- [ ] Analyzer/normalizer behavior is documented.
- [ ] Alias/data stream strategy is clear.
- [ ] Mapping change has migration/reindex plan.

### Indexing

- [ ] Document ID is deterministic where required.
- [ ] Bulk response checks item-level failures.
- [ ] Refresh behavior is intentional.
- [ ] Retry is idempotency-safe.
- [ ] Indexing lag or failure visibility exists.

### Search

- [ ] Query shape is contract-based.
- [ ] Filter vs scoring context is intentional.
- [ ] Pagination strategy is safe.
- [ ] Aggregation cardinality is bounded.
- [ ] Result source fields are bounded for large docs.

### Testing/observability

- [ ] Integration tests cover mapping/analyzer behavior.
- [ ] Business search has relevance fixtures.
- [ ] Tests do not rely on sleeps.
- [ ] Logs/traces/metrics include operation metadata.
- [ ] Sensitive data is not logged.

---

## 25. Prompt contract for LLM code agents

Use this instruction when asking an LLM agent to implement Elasticsearch-related Java code:

```text
You are modifying Java code that interacts with Elasticsearch.
You must follow strict-coding-standards__java_elasticsearch.md.
Before coding, identify Elasticsearch version, Java client/library, target alias/index/data stream, source of truth, mapping contract, consistency expectation, retry/idempotency policy, and tenant/security filter.
Use the official Elasticsearch Java API Client for new code unless the module is explicitly legacy.
Do not use HLRC for new code.
Do not create clients per request.
Do not let user input choose raw index names or raw query DSL.
Do not rely on dynamic mapping for business indices.
Do not use refresh=true or Thread.sleep to hide consistency problems.
Bulk operations must inspect item-level failures.
Search pagination must be bounded; use search_after + stable sort + PIT for deep pagination.
Document every assumption and add/adjust tests for mapping, query behavior, refresh, retry, and authorization.
```

---

## 26. Source anchors

The rules in this document are anchored to these primary references:

- Elastic Docs: Java API Client
  - https://www.elastic.co/docs/reference/elasticsearch/clients/java
- Elastic Docs: Java API Client usage
  - https://www.elastic.co/docs/reference/elasticsearch/clients/java/usage
- Elastic Docs: Java High Level REST Client deprecation
  - https://www.elastic.co/guide/en/elasticsearch/client/java-rest/current/java-rest-high.html
- Elastic Docs: Elasticsearch release notes
  - https://www.elastic.co/docs/release-notes/elasticsearch
- Elastic Docs: Bulk indexing with Java client
  - https://www.elastic.co/docs/reference/elasticsearch/clients/java/usage/indexing-bulk
- Elastic Docs: Paginate search results
  - https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results
- Elastic Docs: Near real-time search
  - https://www.elastic.co/docs/manage-data/data-store/near-real-time-search
- Elastic Docs: refresh parameter
  - https://www.elastic.co/docs/reference/elasticsearch/rest-apis/refresh-parameter
- Elastic Docs: aliases
  - https://www.elastic.co/docs/manage-data/data-store/aliases
- Elastic Docs: data streams and rollover
  - https://www.elastic.co/docs/manage-data/data-store/data-streams
  - https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management/rollover
