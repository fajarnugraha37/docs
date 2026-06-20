# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-026.md

# Part 026 — Search, Atlas Search, Text Search, Geospatial, and Vector Search

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 026 dari 035  
> Fokus: search modelling, MongoDB text search, Atlas Search, analyzers, autocomplete, facets, relevance, authorization-aware search, geospatial, vector search, hybrid search, RAG retrieval, consistency, pagination, dan trade-off dengan Elasticsearch/OpenSearch  
> Target pembaca: Java software engineer / tech lead yang ingin mendesain search experience di atas MongoDB tanpa mengira B-tree index, text index, full-text search, geospatial, dan vector search adalah hal yang sama

---

## 0. Posisi Part Ini Dalam Seri

Part 025 membahas time series, logs, audit, retention, dan data berbasis waktu. Part 026 membahas search.

Search adalah topik yang sering tampak sederhana:

```text
User mengetik keyword -> tampil hasil.
```

Tetapi secara sistem, search bisa berarti banyak hal berbeda:

```text
exact lookup
prefix lookup
contains search
full-text search
relevance ranking
faceted search
autocomplete
geospatial search
semantic/vector search
hybrid keyword + vector search
authorization-aware search
tenant-scoped search
archive search
```

MongoDB punya beberapa kemampuan search:

- B-tree indexes untuk equality/range/sort.
- Text index built-in MongoDB untuk basic text search.
- Atlas Search untuk Lucene-based full-text search pada Atlas.
- Geospatial index/query.
- Atlas Vector Search untuk semantic/vector retrieval.
- Hybrid search yang menggabungkan full-text dan vector search.

Namun kemampuan ini bukan pengganti desain search yang benar.

Kalimat inti:

> Search bukan satu fitur; search adalah kumpulan access pattern dengan semantics, relevance, consistency, security, and operational trade-offs yang berbeda.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu harus mampu:

1. Membedakan exact lookup, text search, full-text search, autocomplete, geospatial, dan vector search.
2. Menjelaskan kapan B-tree index cukup dan kapan search engine diperlukan.
3. Memahami keterbatasan built-in MongoDB text index.
4. Memahami konsep Atlas Search: `$search`, search index, analyzer, tokenization, scoring, autocomplete, facets.
5. Mendesain search projection document.
6. Mendesain authorization-aware and tenant-aware search.
7. Memahami geospatial model dengan GeoJSON dan `2dsphere` index.
8. Memahami vector embeddings, vector index, semantic similarity, and hybrid search.
9. Mendesain RAG retrieval secara aman dan scoped.
10. Menjelaskan consistency gap antara source document dan search index.
11. Mendesain pagination untuk search.
12. Memilih antara MongoDB Search, Elasticsearch/OpenSearch, dedicated vector DB, atau relational search.
13. Membuat Java/Spring integration pattern untuk search query.
14. Membuat checklist production search.

---

## 2. Search Taxonomy

Sebelum memilih teknologi, klasifikasikan search.

### 2.1 Exact lookup

```text
caseNumber = "CASE-2026-001"
nationalIdHash = "..."
tenantId + caseId
```

Gunakan normal index.

### 2.2 Prefix lookup

```text
caseNumber starts with "CASE-2026"
partyNameNormalized starts with "jo"
```

Bisa memakai B-tree dengan normalized prefix strategy atau autocomplete search index.

### 2.3 Contains search

```text
partyName contains "ohn"
```

B-tree biasa tidak ideal.

### 2.4 Full-text search

```text
allegation text contains terms, stems, synonyms, relevance scoring
```

Butuh search engine/search index.

### 2.5 Faceted search

```text
search keyword and show counts by status, region, product, year
```

Butuh search aggregation strategy.

### 2.6 Autocomplete

```text
user types "finan" -> "financial misconduct"
```

Butuh autocomplete index/analyzer.

### 2.7 Geospatial search

```text
cases within 10km
nearest branch
within polygon jurisdiction
```

Butuh geospatial index.

### 2.8 Vector/semantic search

```text
find documents semantically similar to query
```

Butuh embeddings + vector index.

### 2.9 Hybrid search

```text
keyword exact relevance + semantic similarity + metadata filters
```

Gabungan full-text + vector + filters.

---

## 3. B-Tree Index Is Not Search Engine

B-tree index sangat bagus untuk:

```text
equality
range
sort
prefix-like access under constraints
compound access path
```

Contoh:

```javascript
db.cases.find({
  tenantId: "t1",
  status: "OPEN",
  assigneeId: "u1"
}).sort({ dueAt: 1 })
```

Index:

```javascript
{ tenantId: 1, status: 1, assigneeId: 1, dueAt: 1 }
```

Namun B-tree tidak ideal untuk:

```text
stemming
tokenization
language-specific search
relevance scoring
typo tolerance
synonyms
contains search
semantic similarity
facets over search result set
```

Jika product requirement adalah “Google-like search”, B-tree index bukan jawaban.

---

## 4. Built-In MongoDB Text Index

MongoDB server has built-in text indexes and `$text` queries.

Basic pattern:

```javascript
db.articles.createIndex({
  title: "text",
  body: "text"
})

db.articles.find({
  $text: { $search: "regulatory enforcement" }
})
```

Built-in text search can be useful for simple cases.

But for serious search UX, Atlas Search is usually more capable because it is Lucene-based and supports richer operators, analyzers, autocomplete, highlighting, faceting, and more advanced relevance features.

Use built-in text search for:

- simple self-managed MongoDB search,
- basic keyword search,
- low complexity workloads,
- no Atlas Search availability.

Use Atlas Search/dedicated search for:

- production search UX,
- autocomplete,
- scoring tuning,
- facets,
- fuzzy matching,
- synonyms,
- analyzers,
- multilingual search,
- vector/hybrid search.

---

## 5. Atlas Search Mental Model

Atlas Search provides full-text search integrated with MongoDB Atlas.

It uses a separate search index and is queried through aggregation pipeline stage such as `$search`.

Conceptual flow:

```text
source collection document
  -> search index built/updated asynchronously
  -> query uses $search
  -> result documents returned with scores/metadata
```

Atlas Search is not the same as normal MongoDB B-tree index.

Normal database index:

```text
optimizes exact/range/sort query execution in MongoDB storage engine
```

Search index:

```text
tokenizes/analyzes text and supports relevance-based retrieval
```

MongoDB Atlas Search documentation describes operators such as `autocomplete` for incomplete input search and full-text `text` search; the autocomplete operator requires fields indexed with the autocomplete data type. citeturn594181search2turn594181search6

---

## 6. Search Index vs Database Index

Database index:

```javascript
db.cases.createIndex({ tenantId: 1, status: 1, dueAt: 1 })
```

Search index:

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "title": {
        "type": "string"
      },
      "description": {
        "type": "string"
      },
      "caseNumber": {
        "type": "autocomplete"
      }
    }
  }
}
```

They solve different problems.

A search index may contain tokenized analyzed fields, autocomplete fields, faceting fields, and vector fields.

A database index supports normal MongoDB query planner access.

In real systems, you often need both:

```text
database index for command/query exact access
search index for user-facing search UX
```

---

## 7. Analyzer

Analyzer transforms text into searchable tokens.

It can perform:

```text
tokenization
lowercasing
stemming
stop-word removal
diacritic folding
language-specific processing
edge n-gram for autocomplete
normalization
```

Example:

```text
"Financial misconduct investigations"
```

Tokens may become:

```text
financial
misconduct
investig
```

depending analyzer.

Analyzer choice affects:

- match quality,
- recall,
- precision,
- relevance,
- language support,
- autocomplete behavior,
- storage/index size.

Wrong analyzer can make search feel broken.

---

## 8. Tokenization

Tokenization splits text into tokens.

Example:

```text
"case-2026/001 regulatory-enforcement"
```

Could tokenize as:

```text
case
2026
001
regulatory
enforcement
```

But for identifiers, tokenization may be wrong.

Case number search may need exact/prefix behavior, not language analyzer.

Therefore, model fields differently:

```text
title:
  analyzed string

caseNumber:
  keyword/exact + autocomplete

partyName:
  normalized + autocomplete + maybe fuzzy

description:
  full-text analyzed
```

Do not use same analyzer for every field.

---

## 9. Relevance Scoring

Search results are ranked by score.

Score depends on:

- term frequency,
- inverse document frequency,
- field boosts,
- phrase match,
- fuzzy match,
- analyzer,
- synonyms,
- vector similarity if semantic,
- filters,
- custom scoring options.

Product must define relevance.

Example case search relevance:

```text
exact caseNumber match should rank above description mention
party exact name should rank high
recent active cases may boost
closed archived cases lower
confidential cases only if authorized
```

Search design is product + security + data modelling, not just infrastructure.

---

## 10. Field Boosting

Query can boost fields.

Example intent:

```text
caseNumber exact match > title match > description match
```

Pseudo search logic:

```text
caseNumber boost 10
partyName boost 5
title boost 3
description boost 1
```

If everything is equal, results may feel noisy.

For regulatory systems:

```text
identifier matches should dominate free-text matches
```

---

## 11. Fuzzy Search

Fuzzy search handles typos.

Example:

```text
"Jon Smth" -> "John Smith"
```

Useful for:

- names,
- addresses,
- user input.

Danger:

- false positives,
- performance cost,
- security/PII issues,
- surprising matches.

For legal/regulatory systems, fuzzy matching should be explainable or clearly labelled.

Do not use fuzzy for exact identifiers like case number unless product intentionally wants typo tolerance.

---

## 12. Synonyms

Synonyms improve recall.

Example:

```text
AML = anti-money laundering
KYC = know your customer
fraud = misrepresentation maybe, depending domain
```

Synonyms can be dangerous if domain meaning differs.

In regulated systems, synonyms should be curated.

Questions:

```text
Who owns synonym dictionary?
How is it versioned?
Can synonym change alter search result defensibility?
Is it tenant-specific?
Is it language-specific?
```

---

## 13. Autocomplete

Autocomplete helps user while typing.

MongoDB Atlas Search `autocomplete` operator searches words/phrases containing an incomplete input sequence, and fields queried with this operator must be indexed as autocomplete data type. citeturn594181search2

Use cases:

```text
case number
party name
product code
jurisdiction name
organization name
document title
```

Autocomplete design:

- minimum input length,
- debounce client requests,
- max suggestions,
- tenant/authorization filter,
- ranking,
- typo/fuzzy tolerance if appropriate,
- do not expose unauthorized names through suggestions.

Security point:

```text
Autocomplete can leak existence of restricted data.
```

If user types "Jane", suggestions must only include records user is authorized to see.

---

## 14. Faceted Search

Facets show counts/groups among search results.

Example:

```text
Status:
  Open (120)
  Under Review (34)
  Escalated (5)

Region:
  APAC (80)
  EU (40)

Year:
  2026 (30)
  2025 (90)
```

Facet questions:

```text
Are counts exact or approximate?
Are facets filtered by authorization?
Are facets over current page or whole result set?
Are facets expensive?
Can user combine filters?
```

For regulated systems, facet counts can leak data.

Example:

```text
User not allowed to see confidential cases,
but facet count includes them.
```

Facets must apply same tenant/authorization filter.

---

## 15. Search Projection Document

Often you should not search source document directly.

Instead create search projection:

```javascript
{
  _id: "tenant-a:case-1",
  tenantId: "tenant-a",
  caseId: "case-1",
  caseNumber: "CASE-2026-001",
  title: "Suspicious transaction investigation",
  status: "OPEN",
  priority: "HIGH",
  region: "APAC",
  assigneeId: "u123",
  partyNames: ["Jane Doe", "ACME Ltd"],
  productCodes: ["LENDING"],
  searchableText: "Suspicious transaction ...",
  permission: {
    owningTeamId: "team-1",
    sensitivity: "CONFIDENTIAL",
    allowedRoleCodes: ["SUPERVISOR", "INVESTIGATOR"]
  },
  updatedAt: ISODate(...),
  sourceVersion: 17
}
```

Why projection?

1. search fields are curated,
2. sensitive fields excluded,
3. authorization snapshot included,
4. denormalized fields available,
5. index schema stable,
6. source document can remain optimized for commands,
7. search rebuild possible.

---

## 16. Source Document vs Search Projection

Searching source `cases` document may be okay when:

- document shape already matches search need,
- sensitive fields controlled,
- search simple,
- no denormalized search fields needed.

Search projection is better when:

- source document is large,
- data comes from multiple collections,
- authorization filtering complex,
- text needs normalization,
- field boosting differs,
- some fields should not be indexed,
- search schema evolves independently,
- search consistency can lag.

For serious systems, projection is usually cleaner.

---

## 17. Projection Update Strategies

Options:

### 17.1 Synchronous update

Command handler updates source + search projection.

Pros:

- fresher.

Cons:

- command latency/coupling.

### 17.2 Change stream projection

Change stream watches source and updates search projection.

Pros:

- decoupled.

Cons:

- lag, rebuild needed.

### 17.3 Outbox event projection

Command writes domain event; projector updates search.

Pros:

- semantic event.

Cons:

- event schema maintenance.

### 17.4 Batch rebuild

Periodic rebuild from source.

Pros:

- simple recovery.

Cons:

- stale.

Often combine:

```text
change/outbox incremental projection + rebuild/reconciliation
```

---

## 18. Search Consistency

Search index/projection is often eventually consistent.

User journey issue:

```text
user closes case
search still shows open case for 10 seconds
```

Backend state transition guard prevents wrong action, but UX can confuse.

Mitigations:

- return command result directly,
- optimistic UI update,
- show index freshness,
- filter by source state on action,
- verify source before command,
- background projection lag alert.

For sensitive authorization changes, stale search can be dangerous. Permission changes should update search projection quickly and may require fallback source authorization check before showing detail.

---

## 19. Authorization-Aware Search

Search must enforce:

```text
tenant filter
user/team permission
sensitivity clearance
role
legal access constraints
record status
jurisdiction
```

Search query must include authorization constraints, not just post-filter page results.

Bad:

```text
search all tenant docs
return top 20
then remove unauthorized
```

Problems:

- user gets fewer results,
- facets/counts leak,
- ranking affected by unauthorized docs,
- possible timing/leak issues.

Better:

```text
search only authorized subset
```

Search projection should include authorization fields:

```javascript
permission: {
  owningTeamId,
  allowedUserIds,
  allowedRoleCodes,
  sensitivity,
  jurisdiction
}
```

But be careful with large arrays like `allowedUserIds`. Use team/role rules where possible.

---

## 20. Tenant-Aware Search

Every search query must include tenant.

```text
tenantId is mandatory
```

Search index should include tenantId as filterable field.

In multi-tenant search, query shape:

```text
tenant filter
authorization filter
search operator
facets
sort/pagination
```

Do not let cross-tenant search exist unless explicitly admin/global with approvals.

Autocomplete must also be tenant-scoped.

---

## 21. Search Pagination

Offset pagination in search can be expensive or inconsistent.

Search results ranked by score can shift when index updates.

Options:

```text
limit first N results
search-after / cursor if supported
stable sort with tie breaker
opaque page token
cap max depth
```

Product guidance:

```text
Search is for finding, not browsing millions of results.
```

If user needs export of all matching records, make async export job with explicit criteria, not interactive search pagination.

---

## 22. Sorting Search Results

Sort options:

```text
relevance score
createdAt
updatedAt
dueAt
caseNumber
priority
```

If sorted by non-score field, relevance may feel odd.

Example:

```text
keyword = "fraud"
sort = oldest first
```

User might see weak matches above better matches due to date.

Approach:

- default by relevance,
- allow filtered operational sort for structured search modes,
- separate "search" from "worklist" UX,
- use tie-breakers,
- avoid arbitrary sort fields.

---

## 23. Search vs Worklist

Worklist query:

```text
show my open cases due soon
```

This is structured query, not search.

Use database/worklist index:

```javascript
{ tenantId: 1, assigneeId: 1, status: 1, dueAt: 1 }
```

Search query:

```text
find cases related to "suspicious remittance Jane"
```

Use search index.

Do not force all list screens through search.

Do not force all search screens through B-tree indexes.

---

## 24. Search Security Leak Patterns

### 24.1 Autocomplete leak

User types "Jane" and sees restricted person's name.

### 24.2 Facet leak

Facet count includes confidential cases.

### 24.3 Snippet leak

Search highlight shows sensitive text.

### 24.4 Timing leak

Unauthorized search takes longer depending hidden results.

### 24.5 Projection leak

Search index includes fields removed from API.

### 24.6 Archive leak

Old retained data searchable beyond policy.

Mitigate with authorization-aware index/query and field minimization.

---

## 25. Built-In Geospatial Search

MongoDB supports geospatial queries and indexes.

Two major concepts:

```text
2dsphere:
  earth-like spherical geometry, GeoJSON

2d:
  legacy/flat coordinate plane use cases
```

MongoDB docs describe `2dsphere` indexes as supporting geospatial queries on an earth-like sphere and geospatial queries can interpret geometry on a flat surface or sphere. citeturn594181search3turn594181search8

Use `2dsphere` for real-world lat/long.

---

## 26. GeoJSON Model

Example point:

```javascript
{
  tenantId: "tenant-a",
  branchId: "branch-1",
  name: "Central Office",
  location: {
    type: "Point",
    coordinates: [106.8456, -6.2088]
  }
}
```

Important:

```text
GeoJSON coordinates are [longitude, latitude]
```

Not `[lat, lon]`.

Index:

```javascript
db.branches.createIndex({ location: "2dsphere" })
```

Tenant-aware:

```javascript
db.branches.createIndex({ tenantId: 1, location: "2dsphere" })
```

---

## 27. Geospatial Queries

Near query:

```javascript
db.branches.find({
  tenantId: "tenant-a",
  location: {
    $near: {
      $geometry: {
        type: "Point",
        coordinates: [106.8456, -6.2088]
      },
      $maxDistance: 5000
    }
  }
})
```

Within polygon:

```javascript
db.cases.find({
  tenantId: "tenant-a",
  jurisdictionArea: {
    $geoWithin: {
      $geometry: {
        type: "Polygon",
        coordinates: [...]
      }
    }
  }
})
```

Use cases:

- branch/store locator,
- jurisdiction boundary,
- field inspection location,
- incident location,
- nearest office,
- case geo clustering.

---

## 28. Geospatial Design Concerns

Questions:

```text
Is location precise or approximate?
Is location sensitive?
Can user search globally?
Do jurisdictions overlap?
Are polygons large/complex?
Do we need historical location?
Is tenant/authorization included?
Do we need distance sorting?
```

Sensitive locations:

- witness address,
- protected person,
- evidence location,
- facility under investigation.

Do not expose exact coordinates if not authorized.

---

## 29. Vector Search Mental Model

Vector search uses numeric embeddings.

Flow:

```text
text/image/document chunk
  -> embedding model
  -> vector array
  -> vector index
  -> query embedding
  -> nearest neighbor search
  -> semantically similar results
```

Example:

```javascript
{
  tenantId: "tenant-a",
  documentId: "doc-1",
  chunkId: "doc-1:chunk-12",
  text: "The investigation concerns suspicious remittance patterns...",
  embedding: [0.012, -0.22, ...],
  metadata: {
    caseId: "case-1",
    sensitivity: "CONFIDENTIAL",
    jurisdiction: "ID"
  }
}
```

MongoDB Vector Search documentation describes creating vector indexes and performing vector search, including semantic and hybrid search, over vector embeddings. citeturn594181search12

---

## 30. Embeddings

Embedding model maps content to vector.

Important properties:

```text
dimension
model version
language support
domain fit
normalization
cost
latency
privacy
determinism/stability
```

Store:

```javascript
{
  embeddingModel: "text-embedding-model-x",
  embeddingModelVersion: "2026-01",
  embeddingDimension: 768
}
```

If model changes, old vectors may not be comparable.

Need re-embedding plan.

---

## 31. Vector Index

Vector index allows nearest neighbor search.

Design fields:

```text
embedding vector
metadata filters
tenantId
authorization fields
source reference
chunk text
model version
updatedAt
```

Vector index is not enough.

You also need metadata filtering:

```text
tenantId
caseId
jurisdiction
documentType
sensitivity
allowedTeam
status
embeddingModelVersion
```

Without metadata filters, vector search may retrieve semantically similar but unauthorized or irrelevant documents.

---

## 32. Semantic Search Use Cases

Good use cases:

```text
find similar cases
find related evidence
retrieve knowledge base passages
support natural language search
RAG context retrieval
deduplicate documents
recommend related policies
cluster investigation themes
```

Bad use cases:

```text
exact case number lookup
strict legal identity match
authorization decision
financial reconciliation
anything requiring exact deterministic semantics
```

Vector search is approximate/semantic, not exact proof.

---

## 33. Vector Search and Filters

Most serious vector search requires filters.

Example:

```text
tenantId = tenant-a
sensitivity <= user's clearance
jurisdiction in allowed set
documentType in allowed types
status != deleted
embeddingModelVersion = current
```

Filtered vector search is hard because vector similarity and metadata selectivity interact.

Recent research on filtered vector search notes that performance depends on selectivity and system-level execution strategy, not just vector distance computation. citeturn594181academia57turn594181academia60

Practical implication:

```text
Always benchmark vector search with real metadata filters.
```

Do not benchmark only unfiltered top-k over toy data.

---

## 34. Hybrid Search

Hybrid search combines keyword/full-text and vector/semantic search.

MongoDB documentation describes hybrid search as combining full-text exact term matching and semantic search over similar documents so results can include exact and contextually similar matches. citeturn594181search7

Why hybrid?

Keyword search good at:

```text
exact terms
identifiers
rare proper nouns
codes
specific legal terms
```

Vector search good at:

```text
semantic similarity
synonyms
paraphrases
conceptual matches
```

Hybrid improves relevance when both matter.

Example query:

```text
"suspicious remittance layering"
```

Keyword may find documents with exact phrase.

Vector may find documents about money laundering layering without exact words.

---

## 35. Reciprocal Rank Fusion Concept

Hybrid result merging often uses ranking fusion such as Reciprocal Rank Fusion (RRF).

Concept:

```text
keyword rank list
vector rank list
combine ranks so documents high in either/both rank well
```

MongoDB resources describe hybrid search as merging BM25-based keyword relevance with vector similarity using techniques such as reciprocal rank fusion. citeturn594181search13

You do not need to implement RRF manually in all cases, but understand the idea:

```text
hybrid is not just concatenate results
```

---

## 36. RAG Retrieval Design

For Retrieval-Augmented Generation:

```text
user query
-> retrieve relevant chunks
-> pass chunks to LLM
-> generate answer with citations
```

MongoDB can store chunks and embeddings.

Document:

```javascript
{
  tenantId,
  sourceType: "POLICY" | "CASE_DOCUMENT" | "GUIDANCE",
  sourceId,
  chunkId,
  chunkText,
  embedding,
  metadata: {
    jurisdiction,
    effectiveDate,
    classification,
    allowedRoles
  }
}
```

Critical:

- scope by tenant/jurisdiction/security,
- prevent confidential leakage to LLM,
- cite sources,
- track model/version,
- refresh embeddings on document update,
- handle deleted/retired documents.

---

## 37. Vector Search Dilution

As corpus grows heterogeneous, vector search may return semantically plausible but contextually wrong chunks.

Recent 2026 RAG research describes this as vector search dilution and argues that domain scoping with metadata can improve retrieval quality. citeturn594181academia58

Practical lesson:

```text
Scope first, then search.
```

Use metadata:

```text
tenant
jurisdiction
document type
effective date
domain
case status
sensitivity
language
```

Do not run semantic search over “all documents” unless product genuinely needs global search and has robust filters.

---

## 38. Chunking Strategy

For vector/RAG, document chunking matters.

Questions:

```text
chunk size?
overlap?
preserve headings?
preserve section numbers?
include metadata?
handle tables?
handle attachments?
language?
version?
```

Bad chunk:

```text
random 500 tokens without metadata
```

Better:

```javascript
{
  sourceId: "policy-123",
  section: "4.2 Suspicious Transaction Indicators",
  chunkText: "...",
  headingPath: ["AML Policy", "Indicators", "Layering"],
  effectiveDate: ISODate(...),
  jurisdiction: "ID",
  classification: "INTERNAL"
}
```

Metadata is as important as vector.

---

## 39. Embedding Lifecycle

When source changes:

```text
update chunks
recompute embeddings
update vector index
remove old chunks
maintain version
```

If embedding model changes:

```text
create new embedding field/index
backfill
dual query or cutover
delete old vectors
```

Fields:

```javascript
embeddingModel: "model-x"
embeddingVersion: "v3"
sourceVersion: 17
chunkVersion: 2
```

---

## 40. Vector Search Security

Semantic search can leak sensitive information.

Risks:

- unauthorized chunk retrieved,
- LLM sees confidential content,
- logs store prompt/context,
- embeddings may encode sensitive info,
- vector index retained after deletion,
- cross-tenant retrieval,
- support/debug tooling displays chunks.

Controls:

- tenant filter,
- authorization filter before retrieval,
- redact chunks,
- classify documents,
- do not send restricted data to external LLM without approval,
- log only metadata,
- retention/delete embeddings with source,
- per-tenant encryption/key if needed.

---

## 41. Search Result Explanation

For regulated systems, user may ask:

```text
why did this result appear?
```

Keyword search can explain:

```text
matched term in title/party name
```

Vector search is harder.

Provide:

- matched text snippets,
- source metadata,
- score category,
- "semantic match" label,
- citations,
- filters used.

Do not overstate semantic result as proof.

---

## 42. Search Over Audit

Audit search is sensitive.

Use cases:

```text
find all actions by user
find all legal hold changes
find support accesses
find changes to case in date range
```

These are structured queries, not full-text search by default.

Use indexes:

```javascript
{ tenantId: 1, actor.userId: 1, occurredAt: -1 }
{ tenantId: 1, action: 1, occurredAt: -1 }
{ tenantId: 1, caseId: 1, sequence: 1 }
```

Free-text search over audit reason may be useful, but do not expose broad audit text search to all users.

---

## 43. Search Over Archive

Archived data may not be in hot search index.

Options:

1. archive not searchable interactively,
2. searchable archive index with slower SLA,
3. metadata-only hot index,
4. request archive retrieval,
5. separate legal discovery workflow.

Retention and legal hold must apply.

If deleted/anonymized data remains in search index, deletion is incomplete.

---

## 44. Search Index Rebuild

Search index/projection must be rebuildable.

Triggers:

- index schema change,
- analyzer change,
- synonym change,
- source schema change,
- permission model change,
- projection bug,
- embedding model change,
- data correction,
- deletion/anonymization.

Rebuild strategy:

```text
versioned index/projection
backfill from source
dual read/cutover
validate counts/sample
monitor lag
rollback if needed
```

---

## 45. Search Testing

Test dimensions:

```text
exact identifier match
case-insensitive match
diacritics
typos
prefix/autocomplete
synonyms
multi-language
facets
authorization filtering
tenant isolation
confidential cases
deleted/anonymized records
stale projection
large result set
performance under broad query
```

Golden query set:

```text
query -> expected top results
```

This is especially important when changing analyzer/synonyms/embedding model.

---

## 46. Search Quality Metrics

Measure:

```text
precision@k
recall@k
MRR
NDCG
click-through
zero-result rate
reformulation rate
time to result
user feedback
```

For internal tools:

```text
operator found correct case?
false positive burden?
missed critical record?
```

Search quality is not only latency.

---

## 47. Search Performance Metrics

Measure:

```text
query latency p50/p95/p99
index lag
index size
result count
facet latency
autocomplete latency
vector query latency
filter selectivity
embedding generation latency
projection update lag
zero-result rate
timeout rate
```

Slice by:

```text
tenant
query mode
field
user role
corpus size
region
```

---

## 48. Java Query Abstraction

Avoid raw search query construction scattered across services.

Define:

```java
sealed interface CaseSearchMode permits
    CaseKeywordSearch,
    CaseNumberSearch,
    PartySearch,
    SemanticCaseSearch,
    GeoSearch {
}
```

or simpler:

```java
record CaseSearchRequest(
    TenantId tenantId,
    UserContext user,
    String query,
    SearchMode mode,
    Set<CaseStatus> statuses,
    Cursor cursor,
    int limit
) {}
```

Search service builds safe query:

```java
CaseSearchResult search(CaseSearchRequest request);
```

Rules centralized:

- tenant filter,
- authorization filter,
- max limit,
- allowed modes,
- field projection,
- redaction,
- metrics label.

---

## 49. Spring Data and Atlas Search

Spring Data may not abstract all Atlas Search/vector capabilities perfectly.

For advanced `$search` pipelines, use `MongoTemplate` or driver-level aggregation with explicit documents.

Keep pipeline builder tested.

Pseudo:

```java
List<Document> pipeline = List.of(
    new Document("$search", searchStage),
    new Document("$match", authorizationMatch),
    new Document("$limit", limit),
    new Document("$project", projection)
);

mongoTemplate.getCollection("case_search_documents")
    .aggregate(pipeline)
    .into(new ArrayList<>());
```

Use typed wrappers around raw `Document` for maintainability.

---

## 50. Search API Design

Avoid one generic endpoint that exposes raw search DSL.

Bad:

```text
POST /search
{
  "index": "...",
  "query": { raw Atlas Search DSL },
  "projection": { ... }
}
```

Better:

```text
GET /cases/search?q=...&mode=keyword&status=OPEN
GET /cases/autocomplete?q=...
GET /cases/semantic-search?q=...
GET /branches/near?lat=...&lon=...
```

Or typed POST:

```json
{
  "query": "suspicious remittance",
  "mode": "HYBRID",
  "filters": {
    "status": ["OPEN"],
    "jurisdiction": ["ID"]
  },
  "limit": 20
}
```

Server validates fields/operators.

---

## 51. When To Use MongoDB Atlas Search

Good fit:

```text
data already in MongoDB Atlas
operational app needs integrated search
moderate/strong full-text UX
autocomplete/facets
search projection close to source
team wants fewer moving parts
hybrid/vector search integrated with MongoDB documents
```

Consider separate Elasticsearch/OpenSearch when:

```text
search is a major independent product capability
multi-source indexing
complex relevance engineering
large search team/tooling
custom analyzers/plugins
advanced observability/search ops
heavy log analytics
need search outside Atlas environment
```

Consider dedicated vector DB when:

```text
vector retrieval is primary workload
specialized vector performance/features
large-scale ANN tuning
multi-modal embedding workloads
specialized filtering/index algorithms
```

But adding systems adds operational cost.

---

## 52. Operational Ownership

Search needs ownership.

Questions:

```text
Who owns search relevance?
Who owns analyzer configuration?
Who owns synonym dictionary?
Who approves search index changes?
Who monitors index lag?
Who handles rebuild?
Who handles deletion from search?
Who validates authorization filters?
```

Without ownership, search quality decays.

---

## 53. Anti-Patterns

### 53.1 Regex Search Over Large Collection

```javascript
{ text: /term/i }
```

### 53.2 Search Without Tenant Filter

Cross-tenant leak/performance risk.

### 53.3 Post-Filter Authorization

Unauthorized results affect score/facets and may leak.

### 53.4 Full Source Document Indexed

Sensitive fields leak into search.

### 53.5 Search Used As Worklist

Wrong access path.

### 53.6 Vector Search Without Metadata Filters

Semantic but irrelevant/unsafe results.

### 53.7 No Rebuild Plan

Projection/index corruption becomes permanent incident.

### 53.8 No Golden Query Tests

Relevance changes unnoticed.

### 53.9 Autocomplete Leaks Restricted Names

Security incident.

### 53.10 Embedding Model Change Without Versioning

Old/new vectors become inconsistent.

---

## 54. Design Checklist: Text Search

```text
[ ] What fields are searchable?
[ ] What fields are exact vs analyzed?
[ ] What analyzer per field?
[ ] Is autocomplete needed?
[ ] Are synonyms needed?
[ ] Who owns synonyms?
[ ] Are facets needed?
[ ] Are facets authorization-filtered?
[ ] Is tenant filter mandatory?
[ ] Is authorization filter applied before scoring/faceting?
[ ] Are sensitive fields excluded?
[ ] Is search projection rebuildable?
[ ] Is index lag monitored?
[ ] Are golden queries defined?
```

---

## 55. Design Checklist: Vector Search

```text
[ ] What content is embedded?
[ ] What embedding model/version?
[ ] What chunking strategy?
[ ] What metadata filters are mandatory?
[ ] Is tenant filter mandatory?
[ ] Is authorization filter mandatory?
[ ] How are deleted/redacted documents removed?
[ ] How are embeddings refreshed?
[ ] Is hybrid search needed?
[ ] Is retrieval quality evaluated?
[ ] Is vector search benchmarked with real filters?
[ ] Are prompts/logs protected?
[ ] Is RAG answer citation required?
```

---

## 56. Design Checklist: Geospatial

```text
[ ] Are coordinates GeoJSON [lon, lat]?
[ ] Is 2dsphere index used?
[ ] Is tenant/authorization included?
[ ] Is exact location sensitive?
[ ] Are polygons valid and bounded?
[ ] Is distance unit understood?
[ ] Is nearest search capped?
[ ] Is location historical or current?
[ ] Are region/jurisdiction rules modelled?
```

---

## 57. Practical Exercise

Design search for regulatory case management.

Requirements:

```text
- search by exact case number
- search by party name with autocomplete
- full-text search over case summary and allegation text
- filter by status, jurisdiction, product, assignee
- confidential cases visible only to authorized users
- facets by status/product/year
- semantic search over evidence documents
- RAG over policy documents
- geospatial search for inspection location
- archived cases searchable only through legal discovery workflow
```

Answer:

1. collections/projections,
2. database indexes,
3. search index fields,
4. analyzers,
5. autocomplete design,
6. facet design,
7. authorization filter model,
8. vector chunk schema,
9. embedding lifecycle,
10. geospatial schema,
11. consistency/lag handling,
12. rebuild strategy,
13. testing/golden queries,
14. security controls.

Suggested direction:

```text
case_search_documents:
  tenant, caseId, caseNumber, title, summary, partyNames, status, jurisdiction, product, permission snapshot

caseNumber:
  exact + autocomplete

partyNames:
  autocomplete + text

summary/allegation:
  full-text analyzed

filters:
  tenant, status, jurisdiction, product, permission

evidence_chunks:
  tenant, caseId, documentId, chunkId, text, embedding, sensitivity, allowedTeams, sourceVersion

geospatial:
  separate field with 2dsphere index and tenant filter

archive:
  separate archive/legal discovery index with stricter access
```

---

## 58. Senior-Level Heuristics

```text
If query is exact/range/sort, prefer database index.

If user expects relevance, use search index.

If user expects semantic similarity, use vector/hybrid search.

If search can reveal sensitive existence, authorization must happen inside search.

If autocomplete sees restricted records, it is a leak.

If vector search lacks metadata filters, it will retrieve plausible nonsense.

If embedding model changes, version and rebuild.

If search projection cannot be rebuilt, it is fragile.

If facets are not security-filtered, counts leak.

If search is used for worklist, challenge the design.

If user wants export, don't paginate search forever; create async export.
```

---

## 59. Summary

Search in MongoDB ecosystem spans multiple technologies and semantics.

Key lessons:

1. B-tree index is not a full-text search engine.
2. Built-in text index is useful but limited.
3. Atlas Search provides richer full-text search, autocomplete, faceting, and relevance features.
4. Search index differs from database index.
5. Analyzer choice shapes result quality.
6. Exact identifiers need exact/prefix strategy, not generic language analyzer.
7. Autocomplete and facets can leak sensitive data if not authorization-aware.
8. Search projection documents are often better than searching source documents.
9. Search consistency is often eventual; UX and backend guards must handle lag.
10. Geospatial search uses GeoJSON and `2dsphere` indexes for earth-like queries.
11. Vector search uses embeddings for semantic similarity.
12. Hybrid search combines keyword and vector retrieval.
13. Metadata scoping is essential for vector/RAG quality and security.
14. Search needs rebuild, golden tests, and operational ownership.
15. Choose Atlas Search, external search, or dedicated vector DB based on workload and operational trade-offs.

The most important sentence:

> Search is not just matching text; it is ranking, filtering, scoping, securing, explaining, and operating a separate access model over your domain data.

---

## 60. Bridge to Part 027

Part 027 will focus on:

- flexible schema is not schema absence,
- schema versioning,
- reader/writer compatibility,
- expand-contract migration,
- lazy migration,
- online backfill,
- batch migration,
- dual-write danger,
- shadow fields,
- renaming fields safely,
- splitting/merging collections,
- moving embedded to referenced and back,
- index migration,
- rollback strategy,
- observability during migration,
- Java migration tooling and runbooks.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-027.md
```

Judul berikutnya:

```text
Part 027 — Schema Evolution, Migration, Backfill, and Zero-Downtime Changes
```

---

## 61. Status Seri

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
```

Seri belum selesai. Masih lanjut ke Part 027 sampai Part 035.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — Time Series, Logs, Audit Trails, and Retention-Oriented Collections</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-027.md">Part 027 — Schema Evolution, Migration, Backfill, and Zero-Downtime Changes ➡️</a>
</div>
