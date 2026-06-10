# strict-general-standards\_\_elasticsearch.md

# Strict General Standards: Elasticsearch

## 1. Purpose

This document defines mandatory standards for any LLM, code agent, engineer, or automation that designs, implements, modifies, reviews, or operates Elasticsearch-backed functionality.

The goal is to prevent Elasticsearch from being used as a generic database, accidental primary source of truth, uncontrolled search index, or expensive query sink. Elasticsearch must be treated as a distributed search and analytics engine with explicit index design, mapping strategy, query semantics, lifecycle management, security, and operational limits.

These standards apply to:

- Search features.
- Full-text search.
- Faceted search.
- Filtering and sorting.
- Autocomplete/search suggestions.
- Log and time-series analytics.
- Read models and projections.
- Denormalized search documents.
- Vector/semantic search when used with Elasticsearch.
- Any application, service, job, connector, or pipeline that reads from or writes to Elasticsearch.

## 2. Core Position

Elasticsearch is a distributed search and analytics engine. It is not the default transactional database, not the system of record, not a replacement for domain invariants, and not a dumping ground for arbitrary JSON.

An LLM MUST NOT introduce Elasticsearch unless the use case requires at least one of:

- Full-text search.
- Relevance scoring.
- Faceted search.
- Large-scale filtering/sorting over denormalized read models.
- Time-series/log analytics.
- Aggregations over search-oriented data.
- Near-real-time search projection from a primary system of record.
- Vector or semantic retrieval where Elasticsearch is explicitly selected as the retrieval engine.

If the use case is simple lookup by ID, transactional update, uniqueness enforcement, relational query, or business invariant enforcement, the LLM MUST prefer the OLTP database.

## 3. Non-Negotiable Rules

1. Elasticsearch MUST NOT be the source of truth for transactional business state unless the architecture explicitly accepts eventual consistency, loss/rebuild strategy, and lack of relational constraints.
2. Every index MUST have an owner, purpose, document model, lifecycle, access policy, and rebuild strategy.
3. Every field used in filtering, sorting, aggregation, or exact matching MUST have an explicit mapping.
4. Dynamic mapping MUST NOT be blindly relied upon in production indexes.
5. Text search fields and exact-match fields MUST be modeled separately using proper `text`, `keyword`, numeric, date, boolean, or structured field types.
6. Query behavior MUST be intentional: full-text scoring, exact filters, aggregations, sorting, and pagination MUST be designed separately.
7. Deep pagination MUST NOT use unbounded `from` + `size`.
8. Large result export MUST NOT use application loops over ordinary search pages without a clear pagination/export strategy.
9. Any write path into Elasticsearch MUST define idempotency, document ID strategy, retry behavior, and conflict behavior.
10. Every index used for time-series/log/event data MUST have rollover and retention policy.
11. Elasticsearch MUST NOT contain secrets or sensitive fields unless there is a documented access-control, redaction, retention, and encryption model.
12. Any LLM-generated Elasticsearch query MUST be bounded by timeouts, maximum result size, controlled filters, and safe user input handling.
13. Security MUST be enabled for production deployments: TLS, authentication, authorization, least privilege roles, and auditable access.
14. Operational readiness MUST include shard sizing, replica strategy, disk watermarks, heap pressure monitoring, indexing latency, search latency, rejected tasks, and cluster health alerts.
15. Any feature depending on near-real-time indexing MUST explicitly handle refresh delay and read-after-write expectations.

## 4. Mandatory LLM Design Gate

Before generating Elasticsearch code/configuration, the LLM MUST answer:

```text
1. Why is Elasticsearch required instead of the OLTP database?
2. What is the source of truth?
3. What entity or event is represented as a search document?
4. What are the query patterns?
5. Which fields are full-text searched?
6. Which fields are filtered exactly?
7. Which fields are sorted?
8. Which fields are aggregated?
9. What is the expected data volume and growth rate?
10. What is the freshness requirement?
11. What is the rebuild/reindex strategy?
12. What is the retention strategy?
13. What access control applies to this data?
14. What failure behavior is acceptable if Elasticsearch is unavailable?
15. What operational metrics and alerts are required?
```

If these questions cannot be answered, the LLM MUST NOT generate production Elasticsearch implementation.

## 5. Source of Truth and Projection Model

### 5.1 Source of Truth Rule

Elasticsearch SHOULD normally be a derived read model.

Valid sources of truth include:

- PostgreSQL/MySQL/Oracle OLTP database.
- Event store.
- Domain service API.
- CDC stream.
- Canonical data lake/warehouse for analytics workloads.

Invalid source-of-truth patterns:

- Updating Elasticsearch first and later trying to sync the database.
- Treating Elasticsearch as the only copy of critical business records.
- Using search documents to enforce uniqueness or workflow state transitions.
- Depending on Elasticsearch refresh timing for transactional correctness.

### 5.2 Projection Requirements

Each projection MUST define:

```yaml
projection:
  name: "case-search-index"
  source_of_truth: "case-service.postgresql.case"
  index_alias: "case_search_read"
  document_id: "caseId"
  freshness_slo: "p95 <= 10s after committed database change"
  rebuild_strategy: "full reindex from OLTP snapshot + event catch-up"
  failure_behavior: "search degraded; case details still available from OLTP"
```

### 5.3 Denormalization Rule

Elasticsearch documents SHOULD be denormalized for query efficiency.

However, denormalization MUST be controlled:

- Duplicate only data required by search/read use cases.
- Record source version or updated timestamp.
- Define update propagation rules.
- Define stale-data tolerance.
- Avoid embedding large unbounded child collections unless justified.

## 6. Index Naming and Ownership

### 6.1 Naming Convention

Index names MUST be lowercase and environment-safe.

Recommended format:

```text
<domain>_<purpose>_<version>_<yyyyMMdd-or-generation>
```

Examples:

```text
case_search_v1_20260610
audit_log_v2_202606
product_catalog_v3_000001
```

Aliases SHOULD be stable and application-facing:

```text
case_search_read
case_search_write
product_catalog_read
```

Applications SHOULD read/write through aliases, not physical index names.

### 6.2 Ownership Metadata

Every index MUST have metadata documented in code/IaC:

```yaml
index_contract:
  logical_name: "case_search"
  owner_service: "case-service"
  owning_team: "enforcement-platform"
  purpose: "case search read model"
  source_of_truth: "case database"
  read_alias: "case_search_read"
  write_alias: "case_search_write"
  lifecycle_policy: "case-search-ilm"
  retention: "active cases + 7 years archived search"
  pii: true
  rebuild_supported: true
```

## 7. Mapping Standards

### 7.1 Explicit Mapping Required

Production indexes MUST use explicit mappings. Dynamic mapping MAY be used only in controlled development/prototyping.

Bad:

```json
{
  "mappings": {
    "dynamic": true
  }
}
```

Good:

```json
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "caseId": { "type": "keyword" },
      "caseReferenceNo": { "type": "keyword" },
      "subjectName": {
        "type": "text",
        "analyzer": "standard",
        "fields": {
          "keyword": { "type": "keyword", "ignore_above": 256 }
        }
      },
      "status": { "type": "keyword" },
      "createdAt": { "type": "date" },
      "updatedAt": { "type": "date" },
      "amount": { "type": "scaled_float", "scaling_factor": 100 }
    }
  }
}
```

### 7.2 Field Type Rules

| Need                                         | Required Field Type                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| Full-text search                             | `text`                                                                    |
| Exact match                                  | `keyword`                                                                 |
| Status/code/enum                             | `keyword`                                                                 |
| ID/reference number                          | `keyword`                                                                 |
| Sort string                                  | `keyword` subfield or normalizer-backed keyword                           |
| Aggregation bucket                           | `keyword`, numeric, date, boolean, IP, geo                                |
| Date range                                   | `date`                                                                    |
| Monetary value                               | `scaled_float` or integer minor unit                                      |
| Count/quantity                               | `integer`, `long`, or appropriate numeric type                            |
| Boolean flag                                 | `boolean`                                                                 |
| Nested object requiring independent matching | `nested`                                                                  |
| Large machine-generated text exact search    | `wildcard` only with explicit justification                               |
| Vector search                                | dense/vector field type with documented similarity and dimension strategy |

### 7.3 Text vs Keyword Rule

LLMs MUST NOT use `text` fields for exact filtering, sorting, or aggregations unless a proper keyword subfield exists.

Example:

```json
"title": {
  "type": "text",
  "fields": {
    "raw": { "type": "keyword", "ignore_above": 512 }
  }
}
```

Use:

- `title` for full-text search.
- `title.raw` for exact match/sort/aggregation.

### 7.4 Analyzer Rule

Any custom analyzer MUST be justified by search behavior.

The LLM MUST document:

```yaml
analyzer_contract:
  field: "subjectName"
  index_analyzer: "standard"
  search_analyzer: "standard"
  language: "en"
  expected_behavior:
    - "case-insensitive token matching"
    - "phrase query support"
  test_examples:
    - input: "Real Estate Agent"
      expected_tokens: ["real", "estate", "agent"]
```

Analyzer changes are breaking changes because existing indexed tokens do not automatically change. Analyzer changes usually require reindexing.

### 7.5 Normalizer Rule

Use keyword normalizers for case-insensitive exact matching where appropriate.

Example:

```json
{
  "settings": {
    "analysis": {
      "normalizer": {
        "lowercase_keyword": {
          "type": "custom",
          "filter": ["lowercase", "asciifolding"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "email": {
        "type": "keyword",
        "normalizer": "lowercase_keyword"
      }
    }
  }
}
```

### 7.6 Nested Object Rule

If object arrays require matching multiple fields within the same array element, use `nested`.

Bad:

```json
{
  "officers": [
    { "name": "Alice", "role": "Manager" },
    { "name": "Bob", "role": "Director" }
  ]
}
```

Querying `officers.name = Alice AND officers.role = Director` without `nested` may match across different array elements.

Good:

```json
"officers": {
  "type": "nested",
  "properties": {
    "name": { "type": "text", "fields": { "raw": { "type": "keyword" } } },
    "role": { "type": "keyword" }
  }
}
```

### 7.7 Field Explosion Rule

LLMs MUST NOT index arbitrary user-provided object keys as fields.

Forbidden:

```json
{
  "customAttributes": {
    "anyUserControlledKey": "value"
  }
}
```

Safer alternatives:

- Store user-defined attributes as flattened field only if query semantics allow it.
- Store as nested key-value pairs with explicit limits.
- Keep raw JSON in source database and index only approved searchable fields.
- Apply `dynamic: strict` and reject unknown fields.

## 8. Index Settings Standards

### 8.1 Shard Count Rule

Primary shard count MUST be decided at index creation time based on expected data volume, retention, query concurrency, and growth.

LLMs MUST NOT blindly set high shard counts.

Default guidance:

- Start with 1 primary shard for small/medium indexes.
- Increase only when size, ingestion, or query parallelism justifies it.
- Avoid many tiny shards.
- Avoid shards so large that relocation/recovery becomes unsafe.
- For time-series data, prefer rollover/data streams rather than a single ever-growing index.

### 8.2 Replica Rule

Production indexes SHOULD have at least 1 replica unless the deployment is explicitly single-node/non-production.

The LLM MUST document:

```yaml
replicas:
  production: 1
  reason: "search availability during node failure"
  non_production: 0
```

### 8.3 Refresh Interval Rule

The default near-real-time refresh behavior MUST be understood by the feature.

Rules:

- Do not rely on immediate visibility after write unless explicit refresh is used and justified.
- Avoid `refresh=true` on every write path unless correctness and volume allow it.
- For bulk indexing, temporarily increasing `refresh_interval` MAY be appropriate.
- UI must communicate eventual search freshness when relevant.

### 8.4 Source Field Rule

`_source` SHOULD normally remain enabled because it supports debugging, reindexing, partial update, and document retrieval.

Disabling `_source` is allowed only with explicit justification and operational acceptance.

## 9. Document ID and Versioning

### 9.1 Document ID Rule

Document IDs MUST be deterministic when indexing projections from a source of truth.

Good:

```text
_id = caseId
_id = tenantId + ':' + caseId
_id = aggregateType + ':' + aggregateId
```

Bad:

```text
_id = random UUID for every update of the same logical record
```

Random IDs are acceptable only for append-only event/log documents.

### 9.2 Multi-Tenant ID Rule

For multi-tenant systems, document IDs and routing MUST prevent collisions.

Recommended:

```text
_id = <tenantId>:<entityId>
routing = <tenantId> or stable partitioning key
```

### 9.3 Optimistic Concurrency Rule

If concurrent updates are possible, write code MUST handle version conflicts.

Required behavior:

- Use deterministic IDs.
- Use external versioning or compare source updated timestamp/sequence where appropriate.
- Ignore stale updates safely.
- Retry only when safe.
- Never blindly overwrite newer documents with older projection events.

## 10. Ingestion and Indexing Standards

### 10.1 Bulk Indexing Rule

High-volume indexing MUST use bulk API or equivalent client bulk processor.

Bulk operations MUST define:

```yaml
bulk_indexing:
  max_batch_actions: 1000
  max_batch_bytes: "5-15MB depending on document size"
  flush_interval: "1s-5s"
  retry_policy: "exponential backoff for 429/503"
  partial_failure_handling: true
  dead_letter_strategy: "write failed item with reason"
```

LLMs MUST NOT ignore per-item bulk failures.

### 10.2 Idempotent Indexing Rule

Indexing MUST be idempotent.

Recommended pattern:

```text
source event/document -> deterministic document ID -> upsert/index -> safe retry
```

### 10.3 Delete Semantics Rule

Delete behavior MUST be explicit:

- Hard delete in source should delete search document.
- Soft delete in source may update `deleted=true` or remove from searchable alias.
- Legal retention may require keeping audit index but excluding from user search.

### 10.4 Reindexing Rule

Mapping changes that require reindexing MUST use versioned physical indexes and aliases.

Required flow:

```text
1. Create new physical index: case_search_v2_20260610
2. Backfill/reindex data.
3. Validate counts and sample queries.
4. Switch read alias atomically.
5. Switch write alias or dual-write/catch-up safely.
6. Keep old index for rollback window.
7. Delete old index after retention/rollback period.
```

### 10.5 CDC and Event Projection Rule

If indexing from CDC/events:

- Preserve source commit order where required.
- Use source sequence/version to reject stale updates.
- Handle create/update/delete events.
- Handle tombstones if using Kafka compacted topics.
- Define replay behavior.
- Ensure consumer is idempotent.

## 11. Query Design Standards

### 11.1 Query Classification Rule

Every query MUST be classified:

```yaml
query_contract:
  name: "case_search"
  type: "user-facing search"
  full_text_fields: ["caseReferenceNo", "subjectName", "description"]
  filter_fields: ["tenantId", "status", "caseType", "createdAt"]
  sort_fields: ["createdAt", "updatedAt", "caseReferenceNo.raw"]
  aggregation_fields: ["status", "caseType"]
  max_page_size: 100
  timeout: "2s"
```

### 11.2 Filter vs Query Context Rule

Use filter context for exact filters that do not need relevance scoring.

Example:

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "housing complaint",
            "fields": ["title", "description"]
          }
        }
      ],
      "filter": [
        { "term": { "tenantId": "tenant-123" } },
        { "terms": { "status": ["OPEN", "IN_REVIEW"] } },
        { "range": { "createdAt": { "gte": "now-90d/d" } } }
      ]
    }
  }
}
```

### 11.3 User Input Rule

User input MUST be treated as data, not raw query syntax, unless explicitly building an advanced search language.

Forbidden by default:

- Passing raw user string into query string syntax without escaping/validation.
- Allowing arbitrary field names from user input.
- Allowing arbitrary script queries.
- Allowing unbounded regex/wildcard queries.

### 11.4 Wildcard and Regex Rule

Wildcard, regex, prefix, and fuzzy queries MUST be bounded and justified.

Rules:

- Avoid leading wildcard queries on large fields.
- Avoid user-controlled unbounded regex.
- Prefer n-grams/search-as-you-type fields for autocomplete.
- Apply minimum query length.
- Apply timeout and result size limits.

### 11.5 Sorting Rule

Sorting MUST use mapped fields designed for sorting.

Rules:

- Do not sort on analyzed `text` fields.
- Use `keyword` subfields, numeric fields, or date fields.
- Define stable tie-breaker sort for pagination.

Example:

```json
"sort": [
  { "createdAt": "desc" },
  { "caseId": "asc" }
]
```

### 11.6 Aggregation Rule

Aggregations MUST be designed for bounded cardinality and cost.

Rules:

- Avoid high-cardinality aggregations on user IDs, raw URLs, request IDs, trace IDs, or free text.
- Use keyword/numeric/date fields.
- Limit bucket size.
- Use filters/time windows.
- Test with production-like data.

### 11.7 Script Rule

Scripted queries, scripted fields, runtime fields, and update scripts MUST be avoided unless necessary.

If used, the LLM MUST document:

```yaml
script_usage:
  reason: "cannot precompute field due to dynamic user-specific formula"
  language: "painless"
  expected_cost: "bounded by filtered result set <= 5000 docs"
  fallback: "precomputed field in next index version"
  security_review_required: true
```

## 12. Pagination Standards

### 12.1 Page Size Rule

All user-facing search endpoints MUST enforce maximum page size.

Recommended:

```yaml
pagination:
  default_size: 20
  max_size: 100
```

### 12.2 Deep Pagination Rule

LLMs MUST NOT implement deep pagination with unbounded `from` + `size`.

Allowed patterns:

- `from` + `size` only for shallow pagination.
- `search_after` with stable sort for deep sequential pagination.
- `search_after` + Point-In-Time (PIT) for consistent deep pagination snapshots.
- Scroll only for specific legacy/export/reindex-like internal workloads when justified.

### 12.3 Search After Rule

`search_after` requires stable sort and the last sort values from the previous page.

Example:

```json
{
  "size": 50,
  "query": { "match_all": {} },
  "sort": [{ "createdAt": "desc" }, { "caseId": "asc" }],
  "search_after": ["2026-06-10T10:30:00Z", "CASE-123"]
}
```

### 12.4 Total Count Rule

Do not compute exact total hits for every query unless required.

Rules:

- Use approximate/limited total hit tracking where acceptable.
- Document UX behavior if totals are approximate.
- Avoid expensive exact counts for high-volume queries.

## 13. Application API Standards

### 13.1 Search Endpoint Contract

Search endpoints MUST define:

```yaml
endpoint: "GET /cases/search"
inputs:
  q: "free-text query"
  status: "allowed enum list"
  createdFrom: "ISO date"
  createdTo: "ISO date"
  pageToken: "opaque cursor"
  size: "bounded integer"
outputs:
  items: "redacted search results"
  nextPageToken: "opaque cursor"
  total: "optional or approximate"
failure_modes:
  400: "invalid filter/sort/query"
  403: "not authorized"
  429: "rate limited"
  503: "search temporarily unavailable"
```

### 13.2 Opaque Cursor Rule

External APIs SHOULD expose opaque page tokens, not raw Elasticsearch `search_after` arrays or PIT IDs.

Bad:

```json
{
  "search_after": ["2026-06-10T10:30:00Z", "CASE-123"],
  "pit_id": "raw-elasticsearch-pit"
}
```

Good:

```json
{
  "nextPageToken": "base64url-signed-cursor"
}
```

### 13.3 Sort Allowlist Rule

User-selected sort fields MUST be allowlisted.

Example:

```yaml
allowed_sorts:
  newest: [{ "createdAt": "desc" }, { "caseId": "asc" }]
  oldest: [{ "createdAt": "asc" }, { "caseId": "asc" }]
  reference: [{ "caseReferenceNo.raw": "asc" }, { "caseId": "asc" }]
```

## 14. Security Standards

### 14.1 Authentication and Authorization Rule

Production Elasticsearch access MUST require authentication and authorization.

Rules:

- Use TLS for client-to-cluster communication.
- Use API keys/service credentials with least privilege.
- Do not share admin credentials with applications.
- Separate read-only, write, admin, and maintenance roles.
- Rotate credentials.
- Avoid long-lived unrestricted API keys.

### 14.2 Index-Level Access Rule

Applications MUST only access indexes/aliases they own or are explicitly authorized to use.

Example policy concept:

```yaml
roles:
  case-search-reader:
    indices:
      - names: ["case_search_read"]
        privileges: ["read"]
  case-search-writer:
    indices:
      - names: ["case_search_write"]
        privileges: ["create", "index", "delete"]
```

### 14.3 Field and Document Security Rule

If different users may see different documents/fields, authorization MUST be enforced before or during search.

Allowed patterns:

- Filter by tenant/organization/security scope in every query.
- Use document-level security if license/platform supports it and it is operationally accepted.
- Use field-level security or projection redaction for sensitive fields.
- Split indexes by security boundary if necessary.

Forbidden:

- Search all documents and filter unauthorized results in application memory.
- Returning snippets/highlights from fields the user cannot access.
- Aggregating over documents the user should not know exist.

### 14.4 PII and Sensitive Data Rule

Sensitive data MUST be minimized.

Rules:

- Do not index secrets, tokens, credentials, private keys, or raw session data.
- Do not index sensitive PII unless required and approved.
- Redact/mask fields used only for display.
- Apply retention controls.
- Encrypt in transit and at rest.
- Consider field-level restrictions for sensitive fields.

### 14.5 Query Injection Rule

Search APIs MUST not expose raw Elasticsearch DSL to untrusted users unless building a controlled internal/admin tool.

If raw DSL is allowed:

- Restrict to trusted roles.
- Validate allowed query clauses.
- Block scripts unless explicitly approved.
- Enforce timeout and index allowlist.
- Audit every query.

## 15. Resilience and Failure Behavior

### 15.1 Availability Rule

Application behavior when Elasticsearch is unavailable MUST be defined.

Examples:

```yaml
failure_behavior:
  public_search: "return 503 with retry-after"
  case_details: "fallback to OLTP by ID"
  admin_dashboard: "show stale cached summary with warning"
  indexing_pipeline: "buffer/retry via queue and DLQ"
```

### 15.2 Timeout Rule

Every Elasticsearch client request MUST have timeout settings.

Required:

- Connection timeout.
- Socket/request timeout.
- Search timeout for expensive queries.
- Bulk retry backoff.
- Circuit breaker or bulkhead at application level for high-risk workloads.

### 15.3 Retry Rule

Retries MUST be bounded and error-specific.

Retryable examples:

- 429 too many requests.
- 503 service unavailable.
- temporary network errors.

Non-retryable examples:

- mapping error.
- bad request query syntax.
- authorization failure.
- rejected malformed document.

### 15.4 Circuit Breaker Rule

High-traffic applications SHOULD isolate Elasticsearch dependency failure using:

- Client-side timeout.
- Bounded retry.
- Circuit breaker.
- Bulkhead/thread-pool isolation.
- Degraded UX path.

## 16. Lifecycle and Retention Standards

### 16.1 Time-Series Data Rule

Time-series/log/event data SHOULD use data streams or rollover-managed indices.

Required:

- Index template.
- Lifecycle policy.
- Rollover condition.
- Retention/delete condition.
- Tiering strategy if applicable.

### 16.2 Search Projection Lifecycle Rule

Search read models MUST define:

- Rebuild strategy.
- Versioned index strategy.
- Alias switch strategy.
- Retention of old index.
- Cleanup policy.

### 16.3 Deletion and Compliance Rule

Legal deletion, retention, or privacy deletion MUST be propagated to Elasticsearch.

Rules:

- Document delete propagation SLA.
- Ensure old index versions do not retain deleted data beyond policy.
- Reindex/backup/snapshot retention must be included in privacy deletion analysis.

## 17. Snapshot and Recovery Standards

### 17.1 Snapshot Rule

Production clusters MUST have a snapshot policy unless all data is explicitly rebuildable and downtime/loss is accepted.

The LLM MUST document:

```yaml
snapshot_policy:
  repository: "s3-elasticsearch-snapshots"
  frequency: "hourly/daily depending on RPO"
  retention: "30 days"
  restore_test_frequency: "quarterly"
```

### 17.2 Rebuild vs Restore Rule

For every index, specify whether recovery is by restore or rebuild.

```yaml
recovery:
  index: "case_search"
  preferred: "rebuild"
  reason: "derived from OLTP and events"
  rpo: "source-of-truth dependent"
  rto: "4 hours"
```

## 18. Operational Standards

### 18.1 Required Metrics

At minimum, production monitoring MUST include:

- Cluster health.
- Node availability.
- JVM heap usage and GC.
- Disk usage and watermarks.
- Search latency and error rate.
- Indexing latency and error rate.
- Bulk rejection count.
- Thread pool queue/rejection metrics.
- Shard count and shard allocation status.
- Segment count/merge pressure.
- Refresh/flush/merge metrics.
- Query timeout count.
- Snapshot success/failure.
- Security authentication/authorization failures.

### 18.2 Required Alerts

Alerts SHOULD include:

- Cluster red/yellow for sustained period.
- Unassigned shards.
- Disk high/flood-stage watermark risk.
- JVM heap pressure sustained.
- Search latency SLO breach.
- Indexing failure or DLQ growth.
- Snapshot failure.
- Rejected search/write tasks.
- Certificate expiration.
- Unauthorized access spike.

### 18.3 Dashboard Requirements

Each Elasticsearch-backed feature SHOULD have dashboard panels for:

- Request rate.
- Latency p50/p95/p99.
- Error rate.
- Search query count by endpoint/use case.
- Indexing lag/freshness.
- Bulk failure count.
- Document count.
- Storage size.
- Top slow queries if available.

## 19. Performance Standards

### 19.1 Query Budget Rule

Every search endpoint MUST define a query budget.

Example:

```yaml
query_budget:
  p95_latency: "500ms"
  timeout: "2s"
  max_page_size: 100
  max_aggregations: 5
  max_buckets_per_aggregation: 100
  max_query_length: 256
```

### 19.2 Hot Key / Hot Shard Rule

Routing and document distribution MUST be analyzed for hot shards.

Avoid:

- Routing all writes to one tenant shard without load analysis.
- Indexing time-series data with a single hot partitioning pattern and no rollover.
- Using low-cardinality routing keys for high-volume writes.

### 19.3 Source Filtering Rule

Search responses SHOULD return only required fields.

Example:

```json
{
  "_source": ["caseId", "caseReferenceNo", "subjectName", "status", "createdAt"]
}
```

Do not return entire large documents to list/search pages.

### 19.4 Highlighting Rule

Highlighting can be expensive and may expose sensitive content.

If used:

- Restrict highlight fields.
- Respect authorization/redaction.
- Bound fragment size/count.
- Test latency with production-like data.

## 20. Vector and Semantic Search Standards

### 20.1 Explicit Use-Case Rule

Vector/semantic search MUST NOT be added because it is trendy.

The LLM MUST document:

```yaml
semantic_search:
  problem: "keyword mismatch in policy documents"
  model: "approved embedding model/version"
  vector_dimension: 768
  similarity: "cosine"
  hybrid_search: true
  fallback: "keyword search"
  evaluation_dataset: "golden relevance set"
```

### 20.2 Evaluation Rule

Semantic search MUST have evaluation data.

Required:

- Query set.
- Expected relevant documents.
- Relevance metrics or human review process.
- Regression tests for ranking behavior.
- Monitoring for drift if embeddings/model change.

### 20.3 Security Rule

Embedding vectors and source text may leak sensitive information.

Rules:

- Do not embed secrets.
- Apply same access control as original content.
- Filter by tenant/security scope before or during vector retrieval.
- Prevent cross-tenant nearest-neighbor leakage.

## 21. Testing Standards

### 21.1 Mapping Tests

Tests MUST verify:

- Expected fields exist.
- Field types are correct.
- Unknown fields are rejected if `dynamic: strict`.
- Analyzer output for representative terms.
- Sorting and aggregation fields are keyword/numeric/date-compatible.

### 21.2 Query Tests

Tests MUST include:

- Exact match filters.
- Full-text query behavior.
- Multi-filter combinations.
- Empty result behavior.
- Unauthorized document exclusion.
- Pagination consistency.
- Sort stability.
- Aggregation correctness.
- Special characters and multilingual text if relevant.

### 21.3 Reindex Tests

Reindex procedure MUST be tested before production.

Required validation:

- Document count comparison.
- Sample document comparison.
- Query result comparison.
- Alias switch rollback.
- Performance under expected data volume.

### 21.4 Failure Tests

Tests SHOULD include:

- Elasticsearch unavailable.
- Timeout.
- Partial bulk failure.
- Mapping conflict.
- Version conflict.
- Stale event replay.
- Unauthorized access.
- Index read-only due to disk watermark scenario, where feasible in staging.

## 22. Migration and Compatibility Standards

### 22.1 Version Policy

The LLM MUST state the minimum Elasticsearch version assumed when using version-specific features.

Example:

```yaml
elasticsearch_version_policy:
  minimum_supported: "8.x"
  managed_service: "Elastic Cloud / self-managed / OpenSearch compatibility not assumed"
  feature_dependencies:
    - "PIT pagination"
    - "data streams"
    - "API keys"
```

### 22.2 OpenSearch Compatibility Rule

Elasticsearch and OpenSearch MUST NOT be treated as interchangeable without explicit compatibility validation.

If the target is OpenSearch, create a separate standard/configuration path and verify APIs, query behavior, security plugins, and client compatibility.

### 22.3 Rolling Upgrade Rule

Cluster upgrades MUST account for:

- Client compatibility.
- Index compatibility.
- Deprecated settings.
- Plugin compatibility.
- Snapshot availability.
- Rollback constraints.
- Staging validation.

## 23. Client Implementation Standards

### 23.1 Client Configuration

Application clients MUST define:

```yaml
client:
  hosts: "configured externally"
  auth: "api key or service credential"
  tls: true
  connect_timeout: "short and explicit"
  request_timeout: "bounded"
  max_retries: "bounded"
  retry_on_status: [429, 502, 503, 504]
  compression: "enabled if beneficial"
```

### 23.2 No Hardcoded Endpoint Rule

Do not hardcode Elasticsearch URLs, credentials, index names, or aliases in business logic.

Use configuration:

```yaml
ELASTICSEARCH_URL
ELASTICSEARCH_API_KEY_SECRET_REF
CASE_SEARCH_READ_ALIAS
CASE_SEARCH_WRITE_ALIAS
```

### 23.3 Repository Boundary Rule

Application code SHOULD isolate Elasticsearch access behind a search repository/gateway.

Bad:

```text
controller -> raw Elasticsearch DSL construction everywhere
```

Good:

```text
controller -> SearchUseCase -> CaseSearchRepository -> Elasticsearch client
```

### 23.4 DSL Construction Rule

DSL construction MUST be typed, allowlisted, and tested.

Avoid string-concatenating JSON queries.

## 24. Anti-Patterns

LLMs MUST detect and reject these anti-patterns:

### 24.1 Elasticsearch as Primary OLTP Database

Using Elasticsearch to enforce business state, uniqueness, money movement, or workflow invariants.

### 24.2 Mapping by Accident

Letting the first indexed document define production mapping.

### 24.3 Text Field for Everything

Mapping IDs, statuses, enums, dates, and exact fields as `text`.

### 24.4 Keyword Field for Real Full-Text Search

Using `keyword` for names/descriptions and wondering why search quality is bad.

### 24.5 Unbounded Dynamic Fields

Indexing arbitrary JSON and exploding mappings.

### 24.6 Deep Pagination with from/size

Using `from=100000&size=50` for user-facing browse/export.

### 24.7 Search All Then Filter in App

Retrieving unauthorized or irrelevant documents and filtering after Elasticsearch returns them.

### 24.8 No Alias Strategy

Applications directly referencing physical index names, making reindexing risky.

### 24.9 No Rebuild Strategy

Derived indexes that cannot be rebuilt from source of truth.

### 24.10 Ignoring Bulk Item Failures

Checking only HTTP 200 on bulk API and ignoring failed individual items.

### 24.11 Unbounded Aggregations

Aggregating high-cardinality fields without limits.

### 24.12 Raw User DSL Exposure

Letting external users submit arbitrary Elasticsearch DSL.

### 24.13 Refresh Abuse

Using `refresh=true` on every write to hide near-real-time consistency from product design.

### 24.14 Scroll for User Pagination

Using scroll as the default user-facing pagination mechanism.

### 24.15 Search Index as Authorization Layer Only

Assuming that because an index is filtered, downstream detail APIs no longer need authorization.

### 24.16 No Timeouts

Elasticsearch calls without request timeout, search timeout, retry budget, or circuit breaker.

### 24.17 Over-Sharding

Creating many shards for small indexes and harming cluster stability.

### 24.18 Single Giant Index Forever

Keeping all time-series data in one growing index without rollover/retention.

### 24.19 Hidden Sensitive Data in `_source`

Returning or storing sensitive fields that are not needed for search.

### 24.20 OpenSearch/Elasticsearch Confusion

Assuming APIs, clients, licenses, plugins, and security behavior are identical.

## 25. Review Checklist

Before approving Elasticsearch code/configuration, verify:

```text
[ ] Elasticsearch is justified versus OLTP/database query.
[ ] Source of truth is documented.
[ ] Index owner and purpose are documented.
[ ] Mapping is explicit.
[ ] Dynamic mapping is disabled or strictly controlled.
[ ] Text/keyword/date/numeric fields are correctly modeled.
[ ] Analyzer behavior is tested.
[ ] Filtering/sorting/aggregation fields are mapped correctly.
[ ] Query patterns are documented.
[ ] Page size is bounded.
[ ] Deep pagination uses search_after/PIT or justified alternative.
[ ] Bulk indexing handles per-item failures.
[ ] Document IDs are deterministic where required.
[ ] Stale update/conflict behavior is safe.
[ ] Reindex strategy uses aliases.
[ ] Time-series indexes have lifecycle/retention.
[ ] Security uses TLS/auth/least privilege.
[ ] Tenant/security filters are enforced server-side.
[ ] Sensitive fields are minimized/redacted.
[ ] Client calls have timeouts and bounded retries.
[ ] Failure/degraded behavior is defined.
[ ] Metrics, logs, traces, and alerts exist.
[ ] Snapshot or rebuild recovery is defined.
[ ] Tests cover mapping, query, auth, pagination, and failure behavior.
```

## 26. Required Implementation Template

LLMs SHOULD include this contract when introducing Elasticsearch:

```yaml
elasticsearch_contract:
  feature: "case search"
  justification: "full-text and faceted search over case read model"
  source_of_truth: "case-service PostgreSQL"
  index_aliases:
    read: "case_search_read"
    write: "case_search_write"
  physical_index_pattern: "case_search_v{version}_{generation}"
  document_id: "tenantId:caseId"
  mapping_policy: "explicit dynamic strict"
  query_patterns:
    - name: "basic search"
      full_text: ["caseReferenceNo", "subjectName", "description"]
      filters: ["tenantId", "status", "caseType", "createdAt"]
      sorts: ["createdAt", "caseReferenceNo.raw"]
  pagination:
    shallow: "from/size max 1000 offset"
    deep: "search_after + PIT"
  lifecycle:
    retention: "active + archived according to business policy"
    reindex: "versioned index + alias switch"
  security:
    auth: "API key"
    access: "tenant filter + role privileges"
    pii: "redacted fields only"
  operations:
    timeout: "2s search timeout"
    retry: "bounded 429/503 only"
    monitoring: ["latency", "errors", "bulk failures", "cluster health"]
```

## 27. Enforcement Snippet for LLM/Code Agent

```text
When implementing Elasticsearch:
1. Do not use Elasticsearch as default storage.
2. Prove why search/analytics engine behavior is required.
3. Identify the source of truth.
4. Define explicit mapping before indexing data.
5. Use aliases for application-facing index names.
6. Design query patterns before writing queries.
7. Separate full-text, exact filters, sorting, and aggregations.
8. Bound all searches by size, timeout, and allowlisted fields.
9. Use deterministic document IDs for projections.
10. Handle bulk partial failures.
11. Avoid deep pagination with unbounded from/size.
12. Use search_after/PIT for deep sequential pagination.
13. Define reindex, retention, and recovery strategy.
14. Enforce authorization before or within search, never after returning unauthorized documents.
15. Add telemetry, alerts, and operational runbook entries.
```

## 28. Acceptance Criteria

An Elasticsearch implementation is acceptable only when:

1. The reason for using Elasticsearch is explicit and valid.
2. Source of truth and projection strategy are documented.
3. Index mapping is explicit and reviewed.
4. Query patterns are known and tested.
5. Pagination is bounded and safe.
6. Reindexing can be performed without application code changes.
7. Security, tenant isolation, and sensitive data rules are enforced.
8. Write path is idempotent and handles partial failures.
9. Failure/degraded behavior is defined.
10. Metrics, logs, alerts, and operational procedures exist.
11. Lifecycle, retention, snapshot/rebuild, and deletion propagation are defined.
12. Tests validate mapping, queries, authorization, pagination, and failures.

## 29. References

- Elasticsearch documentation: https://www.elastic.co/docs
- Elasticsearch mapping reference: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference
- Elasticsearch text analysis reference: https://www.elastic.co/docs/reference/text-analysis
- Elasticsearch pagination reference: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results
- Elasticsearch index lifecycle management: https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management
- Elasticsearch security and API keys: https://www.elastic.co/docs/deploy-manage/api-keys/elasticsearch-api-keys
- Elasticsearch field/document-level security: https://www.elastic.co/docs/deploy-manage/users-roles/cluster-or-deployment-auth/controlling-access-at-document-field-level
