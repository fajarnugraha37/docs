# Strict Coding Standards — Go + Elasticsearch

> **Scope**: Mandatory implementation standards for Go code that indexes, searches, updates, deletes, reindexes, or administers Elasticsearch resources.
>
> **Primary client baseline**: Official Elastic Go client `github.com/elastic/go-elasticsearch/v8` unless an architecture decision record chooses another client.
>
> **Core model**: Elasticsearch is a distributed search and analytics engine. Treat it as a search/read model, not as the primary transactional source of truth unless explicitly approved.

---

## 1. Source Authority

The agent MUST prefer these authorities, in order:

1. Existing project conventions and architecture decisions.
2. Official Elasticsearch documentation.
3. Official Go client documentation and `pkg.go.dev` package docs.
4. Project-specific API/search/indexing conventions.
5. Go standard library docs for `context`, `net/http`, `encoding/json`, testing, and telemetry.

The agent MUST NOT invent Elasticsearch consistency, refresh, mapping, analyzer, shard, ILM, or versioning behavior.

---

## 2. Non-Negotiable Rules

1. All Elasticsearch calls MUST be context-aware.
2. Client construction MUST happen in composition/bootstrap code, not inside handlers/repositories.
3. Index names, aliases, pipeline names, routing keys, and field names MUST be constants or allowlisted values.
4. User input MUST NOT become raw query DSL, script, field name, index name, routing value, or sort expression without validation.
5. Bulk indexing MUST be used for multi-document ingestion.
6. Search endpoints MUST be bounded by size, timeouts, filters, and pagination policy.
7. Mapping changes MUST be handled through schema/index lifecycle process, not ad hoc application writes.
8. The code MUST define refresh semantics explicitly; it MUST NOT rely on immediate read-after-write unless requested and justified.
9. Optimistic concurrency control MUST be used when overwriting documents whose version/order matters.
10. Logs/traces MUST NOT include credentials, raw user queries containing PII, full documents, or high-cardinality labels.

---

## 3. Client Selection and Initialization

Use the official client:

```go
import elasticsearch "github.com/elastic/go-elasticsearch/v8"
```

Typed API SHOULD be preferred for supported endpoints because it gives strongly typed request/response structures. Low-level API MAY be used when:

- the typed API does not support the required endpoint,
- raw NDJSON is required,
- the project has existing low-level wrappers,
- performance testing justifies the lower-level path.

Client setup MUST inject:

- addresses/cloud ID,
- credentials/API key,
- TLS config,
- retry policy,
- transport timeout,
- logger/metrics/tracing transport if used,
- product/environment metadata if supported.

Forbidden:

```go
func Search(q string) (*Response, error) {
    es, _ := elasticsearch.NewDefaultClient()
    return es.Search(es.Search.WithQuery(q))
}
```

---

## 4. Configuration Contract

Use explicit config structures.

```go
type ElasticsearchConfig struct {
    Addresses          []string
    CloudID            string
    APIKey             string
    Username           string
    Password           string
    CACertPEM          []byte
    RequestTimeout     time.Duration
    RetryOnStatus      []int
    MaxRetries         int
    CompressRequestBody bool
    DiscoverNodes      bool
}
```

Secrets MUST be supplied by secure config/secret management. They MUST NOT be logged or embedded in source code.

---

## 5. Context and Timeout Rules

Every public repository/client method MUST accept `context.Context` first.

```go
func (s *CaseSearchIndex) SearchCases(ctx context.Context, q CaseSearchQuery) (CaseSearchResult, error)
```

The application layer owns request budget. Infrastructure wrappers MAY narrow the deadline but MUST NOT detach cancellation.

Forbidden:

```go
ctx := context.Background()
res, err := es.Search(es.Search.WithContext(ctx))
```

Required:

```go
res, err := es.Search(es.Search.WithContext(ctx), ...)
```

---

## 6. Index, Alias, and Lifecycle Rules

Application code MUST write to aliases, not versioned physical indices, unless doing administrative migration code.

Recommended naming:

```go
const (
    CaseWriteAlias = "case-search-write"
    CaseReadAlias  = "case-search-read"
)
```

The agent MUST NOT hardcode date/version suffixes in business code.

Index lifecycle artifacts SHOULD be managed by deployment/migration tooling:

- index template,
- component template,
- mappings,
- settings,
- analyzers,
- ingest pipelines,
- ILM/data stream policy,
- read/write alias rollover.

Application code MUST fail fast if expected index/alias assumptions are violated, unless the project explicitly allows auto-create.

---

## 7. Document Contract

Separate domain model from index document.

```go
type CaseDocument struct {
    CaseID       string    `json:"case_id"`
    TenantID     string    `json:"tenant_id"`
    Status       string    `json:"status"`
    Title        string    `json:"title"`
    UpdatedAt    time.Time `json:"updated_at"`
    SearchText   string    `json:"search_text,omitempty"`
}
```

The agent MUST NOT index domain entities directly if they contain internal fields, secrets, large nested state, or unstable structure.

Every document type MUST define:

- stable document ID,
- tenant/ownership field,
- schema version if document shape evolves,
- updated timestamp or event version,
- searchable fields,
- filter/sort fields,
- redaction policy,
- source-of-truth reference.

---

## 8. Indexing Rules

### 8.1 Single document writes

Single document indexing is acceptable for command-side projection updates when low volume and latency sensitive.

The code MUST choose operation intentionally:

- `index`: create or replace document,
- `create`: fail if document already exists,
- `update`: partial update/scripted update,
- `delete`: remove document.

The agent MUST NOT use `index` blindly when stale overwrite matters.

### 8.2 Bulk writes

Bulk API MUST be used for multi-document ingestion.

The agent MUST inspect per-item results; HTTP 200/201 for the bulk request does not mean every item succeeded.

Required handling:

- request-level error,
- response body close,
- bulk-level `errors` flag,
- per-item status,
- retryable vs non-retryable failures,
- DLQ or error output for failed documents,
- metrics for attempted/succeeded/failed/retried documents.

Pseudo-shape:

```go
type BulkIndexResult struct {
    Attempted int
    Indexed   int
    Failed    []BulkItemFailure
}
```

The agent MUST NOT discard partial failures.

---

## 9. Refresh Semantics

The agent MUST define refresh behavior explicitly:

- default refresh for normal ingestion,
- `refresh=false` for throughput-oriented writes,
- `refresh=wait_for` for tests or user flows requiring read-after-write,
- immediate refresh only with explicit approval.

Forbidden:

```go
// Blindly force refresh for every write.
req.Refresh("true")
```

Refresh is not a transactional guarantee. Do not design correctness around search visibility timing unless documented.

---

## 10. Optimistic Concurrency and Versioning

When preventing stale overwrite matters, use Elasticsearch optimistic concurrency controls such as sequence number and primary term, or a documented external versioning strategy where appropriate.

The code MUST NOT overwrite documents from out-of-order events without an ordering guard.

For projection/event-driven indexing, every event MUST carry one of:

- aggregate version,
- monotonic updated timestamp with tie-breaker,
- source log offset/sequence,
- sequence number from source of truth,
- explicit idempotency key.

If ordering cannot be guaranteed, the code MUST route conflicts to retry/DLQ/reconciliation.

---

## 11. Query Construction Rules

User-facing search MUST use a typed query object.

```go
type CaseSearchQuery struct {
    TenantID string
    Text     string
    Statuses []CaseStatus
    From     *time.Time
    To       *time.Time
    Sort     CaseSort
    Page     SearchPage
}
```

Handlers MUST NOT assemble raw JSON query DSL directly from request parameters.

The query builder MUST:

- enforce tenant filter,
- validate text length,
- validate allowed fields,
- validate sort fields,
- cap result size,
- decide exact vs full-text fields,
- avoid expensive wildcard/regexp/prefix queries unless approved,
- avoid script queries from user input.

---

## 12. Pagination Rules

For shallow UI pagination, `from` + `size` MAY be used within a strict maximum window.

For deep pagination, use `search_after` with deterministic sort keys.

The agent MUST NOT generate unbounded deep pagination loops.

Required cursor fields:

- stable sort field,
- tie-breaker document ID or stable unique field,
- original query hash/filters if necessary,
- expiration if exposed to clients.

---

## 13. Sorting and Aggregation Rules

Sort fields MUST be keyword/numeric/date fields designed for sorting. Do not sort on analyzed text fields.

Aggregations MUST be bounded by:

- tenant filter,
- time range,
- size limit,
- allowed field list,
- cardinality expectations,
- timeout policy.

The agent MUST NOT add high-cardinality aggregations to API endpoints without review.

---

## 14. Mapping and Analyzer Rules

Mapping is a contract. The agent MUST NOT rely on dynamic mapping for production index contracts.

Every searchable model SHOULD define:

- `text` fields for full-text search,
- `keyword` fields for exact filtering/sorting,
- date format policy,
- numeric type policy,
- nested vs object semantics,
- analyzer selection,
- normalizer selection,
- field aliases if needed,
- schema version.

Analyzer changes generally require a new index and reindex strategy. The agent MUST NOT assume analyzer changes apply retroactively to existing indexed tokens.

---

## 15. Scripting Rules

Elasticsearch scripts MUST be avoided unless clearly justified.

Scripts MUST NOT include raw user input.

If scripts are used:

- pass user data as parameters,
- bound script scope,
- add tests for malicious input,
- document performance implications,
- ensure script language/policy is allowed by platform.

---

## 16. Delete and Reindex Rules

Delete operations MUST be intentional and authorization-checked.

`delete_by_query` and `update_by_query` are administrative/maintenance operations, not normal request-path primitives.

Reindex code MUST define:

- source index/alias,
- destination index,
- mapping compatibility,
- conflict policy,
- throttling,
- slicing/parallelism if used,
- validation counts,
- alias cutover,
- rollback plan.

The agent MUST NOT write automatic reindex code inside normal application startup unless explicitly approved.

---

## 17. Error Handling

Every Elasticsearch error MUST be classified by operation and status.

The code SHOULD distinguish:

- context canceled/deadline exceeded,
- authentication/authorization failure,
- index/mapping not found,
- version conflict,
- validation/parser error,
- too many requests / backpressure,
- server unavailable,
- partial bulk failure.

Wrap errors with safe context:

```go
return fmt.Errorf("bulk index case documents attempted=%d failed=%d: %w", attempted, failed, err)
```

Do not include raw full document bodies in errors.

---

## 18. Retry and Backpressure

Retry policy MUST be operation-specific.

Retryable candidates:

- 429,
- selected 5xx,
- transient network errors,
- context deadline only if caller permits and operation is idempotent.

Non-retryable candidates:

- mapping errors,
- parse errors,
- bad request due to invalid document,
- authorization errors,
- deterministic version conflicts unless conflict workflow exists.

Bulk retry MUST retry only retryable failed items, not blindly resend everything unless idempotency and duplicate semantics are documented.

---

## 19. Security Rules

1. Use API key or service credentials from secure secret source.
2. TLS verification MUST NOT be disabled outside controlled local tests.
3. User input MUST NOT control raw DSL, script, field, index, alias, routing, or pipeline name.
4. Search result source filtering MUST prevent leaking internal/secret fields.
5. Query logs MUST redact PII and sensitive search text where required.
6. Multi-tenant indexes MUST enforce tenant filter in every query and write path.
7. Administrative APIs MUST require explicit separate privileges.

---

## 20. Observability

Each operation SHOULD emit:

- operation type: search/index/bulk/update/delete/reindex,
- index alias/logical document type,
- duration,
- status code class,
- document count,
- failed item count,
- retry count,
- timeout/cancel status,
- shard failure count where applicable.

Do not label metrics by raw query, user ID, document ID, or search text.

Trace spans MAY include sanitized query class, not full query payload.

---

## 21. Testing Rules

Unit tests MUST cover:

- query object validation,
- tenant filter enforcement,
- field/sort allowlists,
- document mapping/redaction,
- bulk response partial failure parsing,
- error classification,
- pagination cursor encoding/decoding,
- refresh behavior choices.

Integration tests SHOULD cover:

- real Elasticsearch container/test cluster,
- index template/mapping installation,
- indexing + search behavior,
- analyzer behavior,
- refresh/read-after-write expectations,
- bulk partial failure,
- version conflict,
- delete/reindex maintenance code if present.

The agent MUST NOT rely only on mocks for query DSL correctness.

---

## 22. Benchmarking Rules

Search/index benchmarks MUST declare:

- Elasticsearch version,
- shard/replica count,
- mapping/analyzer,
- document shape/size,
- dataset size,
- query mix,
- concurrency,
- refresh policy,
- bulk batch size,
- latency percentiles,
- error/backpressure behavior.

The agent MUST NOT claim search/index performance without measurements.

---

## 23. Anti-Patterns

Forbidden unless explicitly approved:

```go
// Raw user DSL passthrough.
body := strings.NewReader(r.FormValue("query"))
res, _ := es.Search(es.Search.WithBody(body))
```

```go
// No tenant filter in multi-tenant search.
query := matchQuery("title", userText)
```

```go
// Ignoring bulk item failures.
res, _ := es.Bulk(bytes.NewReader(buf.Bytes()))
if res.StatusCode == http.StatusOK { return nil }
```

```go
// Force refresh on every write.
Index(...).Refresh("true")
```

```go
// Dynamic index name from request.
index := r.URL.Query().Get("index")
```

```go
// Indexing domain entity directly.
json.NewEncoder(body).Encode(domainCase)
```

---

## 24. LLM Merge Checklist

Before producing or modifying Go + Elasticsearch code, the agent MUST verify:

- [ ] Client is injected and configured centrally.
- [ ] Context is propagated to every request.
- [ ] Index/alias/field names are constants or allowlisted.
- [ ] User input cannot become raw DSL/script/field/index/routing.
- [ ] Multi-tenant filters are mandatory and tested.
- [ ] Document model is separate from domain model.
- [ ] Bulk responses inspect item-level failures.
- [ ] Refresh semantics are explicit.
- [ ] Stale overwrite/version conflict behavior is defined.
- [ ] Search result size and pagination are bounded.
- [ ] Mapping/analyzer changes are not hidden in app code.
- [ ] Errors are classified and wrapped safely.
- [ ] Logs/metrics/traces avoid PII and high-cardinality payloads.
- [ ] Integration tests validate real mapping/query behavior.
- [ ] Performance claims include benchmark evidence.
