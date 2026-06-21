# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-030.md

# Part 030 — Vector Search and Semantic Search

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Part: `030`  
> Fokus: vector search, semantic search, embeddings, dense vector, sparse vector, kNN, approximate nearest neighbor, semantic_text, inference pipeline, embedding lifecycle, dan evaluasi semantic retrieval  
> Target pembaca: Java software engineer / tech lead yang sudah memahami lexical search/BM25 dan ingin memakai Elasticsearch untuk semantic retrieval secara production-grade.

---

## 0. Posisi Part Ini Dalam Seri

Part 029 membahas advanced search features. Part 030 masuk ke salah satu perubahan paling besar dalam dunia search modern:

```text
lexical search → semantic/vector search
```

Sampai sekarang kita banyak membahas:

- inverted index;
- analyzer/tokenizer;
- BM25;
- field boosting;
- phrase search;
- filtering/faceting;
- relevance engineering berbasis lexical match.

Sekarang kita bahas search yang mencoba menemukan dokumen berdasarkan **makna**, bukan hanya kata yang sama.

Contoh lexical limitation:

```text
Query:
"company hiding losses"

Document:
"issuer failed to disclose material financial deterioration"
```

Lexical search mungkin tidak match kuat karena kata berbeda.

Semantic search dapat menangkap bahwa keduanya dekat secara makna.

Namun ini bukan magic. Semantic search membawa risiko baru:

- false semantic match;
- embedding drift;
- model mismatch;
- stale embeddings;
- high storage/memory cost;
- difficult explainability;
- evaluation complexity;
- permission-aware retrieval complexity;
- RAG hallucination risk jika retrieval buruk.

Part ini membangun mental model agar Anda bisa mendesain semantic search dengan sadar.

---

## 1. Core Thesis

Vector search bukan pengganti universal BM25.

Semantic/vector search adalah **tambahan retrieval strategy** yang kuat untuk problem tertentu, tetapi lexical search tetap sangat penting.

Lexical search unggul untuk:

- exact identifiers;
- names;
- codes;
- legal references;
- product numbers;
- case numbers;
- filters/facets;
- precise phrase matching;
- explainability;
- deterministic keyword behavior.

Semantic search unggul untuk:

- vocabulary mismatch;
- conceptual similarity;
- natural language questions;
- multilingual/mixed-language search;
- related content discovery;
- RAG/passages;
- similarity search across paraphrases.

Hybrid search sering lebih baik daripada hanya lexical atau hanya vector.

Mental model:

```text
Lexical search answers:
"Does the document contain terms related to this query?"

Semantic search answers:
"Is the document meaningfully close to this query in embedding space?"

Hybrid search asks:
"Can we combine exact lexical precision with semantic recall?"
```

---

## 2. Lexical Search vs Semantic Search

### 2.1 Lexical Search

Lexical search works with text terms.

Pipeline:

```text
text
→ analyzer
→ tokens
→ inverted index
→ BM25 scoring
```

Strengths:

- transparent;
- fast;
- great for exact terms;
- easy filters/facets;
- mature debugging;
- strong for domain-specific codes.

Weaknesses:

- vocabulary mismatch;
- synonyms require maintenance;
- typo/phrase handling manual;
- conceptual similarity limited;
- multilingual mismatch difficult.

---

### 2.2 Semantic Search

Semantic search works with learned representations.

Pipeline:

```text
text
→ embedding model
→ vector
→ vector index
→ nearest neighbor search
```

Strengths:

- captures meaning;
- works across paraphrase;
- useful for natural language;
- can support multilingual if model supports it;
- good for related-content discovery.

Weaknesses:

- less explainable;
- model-dependent;
- can retrieve plausible but wrong documents;
- storage and memory heavier;
- embedding lifecycle needed;
- evaluation harder.

---

### 2.3 Example

Query:

```text
"late disclosure of financial risk"
```

Document A:

```text
"The issuer failed to disclose material risk exposure in a timely manner."
```

Document B:

```text
"Financial risk disclosure late late late."
```

Lexical BM25 may favor B due to term overlap.

Semantic search may favor A because meaning is better.

But query:

```text
"CASE-2026-000123"
```

Semantic search is wrong tool. Use exact keyword search.

---

## 3. What Is An Embedding?

An embedding is a numeric representation of content.

Example conceptual vector:

```text
"market manipulation" → [0.12, -0.04, 0.88, ...]
```

Each number is a coordinate in high-dimensional space.

Documents with similar meaning should be close in that vector space.

Important:

```text
Embedding is not the content.
Embedding is a model-generated representation of content.
```

The quality of semantic search depends heavily on:

- model choice;
- text chunking;
- data cleaning;
- field selection;
- language support;
- query embedding;
- similarity metric;
- retrieval pipeline;
- evaluation data.

---

## 4. Dense Vector vs Sparse Vector

### 4.1 Dense Vector

Dense vectors are fixed-length numeric arrays where most dimensions have values.

Example:

```text
[0.018, -0.221, 0.734, ..., -0.009]
```

Dense vectors are usually produced by neural embedding models.

Elastic documentation describes dense vectors as fixed-length numeric vectors that capture semantic meaning; content with similar meaning maps nearby in vector space. Dense vectors commonly have hundreds or thousands of dimensions.

Use cases:

- semantic text search;
- image similarity;
- multilingual retrieval;
- RAG passage retrieval;
- similar document search.

---

### 4.2 Sparse Vector

Sparse vectors represent weighted terms/features where most possible dimensions are zero/absent.

Examples:

```text
{
  "regulatory": 0.42,
  "disclosure": 0.78,
  "issuer": 0.51
}
```

Sparse retrieval can bridge lexical and semantic ideas.

Elastic's ELSER is a learned sparse retrieval model that returns results based on contextual meaning and user intent rather than exact keyword matches, while often retaining more term-like explainability than dense vectors.

Use cases:

- semantic search without dense vectors;
- expansion-style retrieval;
- out-of-domain semantic search;
- better explainability than dense embeddings in some cases.

---

## 5. Vector Similarity

Common similarity metrics:

```text
cosine similarity
dot product
l2/euclidean distance
max inner product
```

Meaning:

- cosine: angle/direction similarity;
- dot product: magnitude and direction;
- l2: geometric distance.

Important:

```text
Embedding model and similarity metric must match.
```

If model was trained/expected for cosine similarity, using the wrong metric can degrade relevance.

---

## 6. kNN: k-Nearest Neighbors

kNN search means:

```text
Given query vector q,
find k document vectors nearest to q.
```

Example:

```text
query embedding = vector("market abuse through coordinated trading")

return nearest 10 case passage vectors
```

Elastic documents kNN search as finding k nearest vectors to a query vector measured by similarity metric.

---

## 7. Exact kNN vs Approximate kNN

### 7.1 Exact kNN

Exact kNN compares query vector to all candidate vectors.

Pros:

- accurate;
- simple mental model.

Cons:

- expensive at large scale.

### 7.2 Approximate kNN / ANN

Approximate nearest neighbor uses vector index structures to find likely nearest vectors efficiently.

Pros:

- scalable;
- fast for large vector corpora.

Cons:

- approximate;
- recall depends on parameters;
- performance tuning different from BM25;
- filtering interaction matters.

Elasticsearch supports approximate kNN for indexed dense vectors, and Elastic documentation notes that approximate kNN works differently from other queries and has special performance considerations.

---

## 8. Elasticsearch Vector Building Blocks

Modern Elasticsearch supports multiple semantic/vector workflows.

Key building blocks:

```text
dense_vector
sparse_vector / text_expansion workflow
semantic_text
kNN search
inference API
ELSER
hybrid search
retrievers / RRF
```

### 8.1 `dense_vector`

The `dense_vector` field type stores dense numeric vectors and is primarily used for kNN search. Elastic documentation notes dense vector fields do not support aggregations or sorting.

Example mapping:

```json
PUT /case-passages-v1
{
  "mappings": {
    "properties": {
      "caseId": {
        "type": "keyword"
      },
      "passageId": {
        "type": "keyword"
      },
      "text": {
        "type": "text"
      },
      "textEmbedding": {
        "type": "dense_vector",
        "dims": 384,
        "similarity": "cosine",
        "index": true
      }
    }
  }
}
```

### 8.2 `semantic_text`

Elastic's `semantic_text` field type simplifies semantic search by automating much of the manual vector workflow such as model/inference-related setup, mapping, ingestion, and chunking behavior. Elastic recommends `semantic_text` as the easiest workflow for semantic search in the Elastic Stack, while lower-level inference workflows give more control.

Conceptual mapping:

```json
PUT /cases-semantic-v1
{
  "mappings": {
    "properties": {
      "title": {
        "type": "text"
      },
      "body_semantic": {
        "type": "semantic_text"
      }
    }
  }
}
```

This managed path can reduce boilerplate but you must still understand:

- chunking behavior;
- model/inference endpoint;
- limitations;
- cost;
- evaluation;
- security;
- migration.

### 8.3 Inference API

Elasticsearch provides an inference API to create/manage inference endpoints integrating with built-in NLP models like ELSER/E5 and third-party services such as OpenAI, Cohere, Hugging Face, Google, Azure, Amazon Bedrock, and others, depending deployment/config.

This enables workflows:

```text
ingest text
→ inference endpoint generates embedding
→ store embedding/semantic field
→ query-time inference generates query embedding
→ search
```

---

## 9. Bring Your Own Vectors

A common Java backend architecture:

```text
Java service
→ call embedding provider/model
→ receive vector
→ index document with vector into Elasticsearch
```

Example document:

```json
PUT /case-passages-v1/_doc/case-123-passage-001
{
  "caseId": "case-123",
  "passageId": "case-123-passage-001",
  "text": "The issuer failed to disclose material financial deterioration.",
  "textEmbedding": [0.012, -0.087, 0.233]
}
```

Real vectors have hundreds/thousands of dimensions; the example is shortened.

Pros:

- full control over model;
- provider flexibility;
- language/domain-specific embedding;
- easier to share embeddings across systems.

Cons:

- you own embedding pipeline;
- retries and cost;
- model versioning;
- batching;
- rate limits;
- vector dimension compatibility;
- re-embedding migrations;
- privacy/data transfer concerns.

---

## 10. kNN Query Example

Top-level kNN style example:

```json
GET /case-passages-v1/_search
{
  "knn": {
    "field": "textEmbedding",
    "query_vector": [0.021, -0.055, 0.441],
    "k": 10,
    "num_candidates": 100,
    "filter": {
      "bool": {
        "filter": [
          { "term": { "tenantId": "tenant-a" }},
          { "terms": { "visibilityScopes": ["scope:investigator:123"] }}
        ]
      }
    }
  },
  "_source": ["caseId", "passageId", "text"]
}
```

Concepts:

- `k`: number of nearest neighbors returned.
- `num_candidates`: candidate pool used by approximate search.
- `filter`: structured constraints.

Do not forget permission filters.

---

## 11. `k` vs `num_candidates`

For approximate kNN:

```text
k = how many final nearest results you want
num_candidates = how many candidate vectors to consider before final top-k selection
```

Higher `num_candidates` often improves recall but costs more.

Trade-off:

```text
low num_candidates:
  faster, lower recall

high num_candidates:
  slower, better recall
```

You must tune with evaluation data, not guess.

---

## 12. Filtering With Vector Search

Filters are essential:

```text
tenant
permission
document type
status
language
date range
jurisdiction
lifecycle
```

Example:

```json
{
  "knn": {
    "field": "textEmbedding",
    "query_vector": [0.1, 0.2, 0.3],
    "k": 20,
    "num_candidates": 200,
    "filter": {
      "bool": {
        "filter": [
          { "term": { "tenantId": "tenant-a" }},
          { "term": { "lifecycleStatus": "ACTIVE" }},
          { "terms": { "visibilityScopes": ["scope:case:read"] }}
        ]
      }
    }
  }
}
```

Important:

```text
Vector similarity must never bypass authorization.
```

---

## 13. Semantic Search Is Not Just Vector Field

A production semantic search system includes:

```text
1. Source text selection
2. Cleaning/normalization
3. Chunking
4. Embedding model selection
5. Embedding generation
6. Vector indexing
7. Query embedding generation
8. kNN retrieval
9. Filtering/security
10. Ranking/fusion
11. Result reconstruction
12. Evaluation
13. Monitoring
14. Re-embedding lifecycle
```

If you only add a vector field, you have not designed semantic search.

---

## 14. Source Text Selection

What text should be embedded?

Options:

```text
title
summary
body
notes
evidence text
decision text
party names
allegation descriptions
combined synthetic text
```

Bad approach:

```text
embed entire raw JSON blindly
```

Better approach:

```text
build intentional semantic representation
```

Example:

```text
Case title: ...
Allegation: ...
Summary: ...
Key facts: ...
Decision: ...
```

For regulatory systems, avoid embedding fields the user should not retrieve or that have different permission boundaries.

---

## 15. Chunking

Long documents often need chunking.

Why?

Embedding models have input token limits, and semantic retrieval usually works better on focused passages.

Chunking strategy:

```text
document → chunks/passages → each chunk gets embedding
```

Example chunk document:

```json
{
  "caseId": "case-123",
  "chunkId": "case-123:summary:0001",
  "chunkType": "summary",
  "text": "The issuer failed to disclose material financial deterioration...",
  "tenantId": "tenant-a",
  "visibilityScopes": ["scope:investigator:123"],
  "embeddingModel": "model-v1",
  "embedding": [...]
}
```

---

## 16. Chunking Trade-Offs

### Small Chunks

Pros:

- focused retrieval;
- better grounding for RAG;
- less irrelevant text.

Cons:

- context may be missing;
- more vectors;
- more storage;
- more duplicate hits;
- result reconstruction needed.

### Large Chunks

Pros:

- more context;
- fewer vectors;
- simpler indexing.

Cons:

- diluted embedding;
- lower precision;
- harder to cite exact evidence;
- model token limit risk.

### Overlapping Chunks

Pros:

- reduce boundary loss.

Cons:

- more vectors;
- duplicate retrieval;
- ranking clutter.

Rule:

```text
Chunk according to retrieval unit and user answer unit.
```

For RAG, chunk should be large enough to answer but small enough to be specific.

---

## 17. Document-Level vs Passage-Level Retrieval

### Document-Level

```text
one case = one vector
```

Good for:

- similar case recommendation;
- high-level discovery;
- small documents;
- browsing related entities.

Bad for:

- precise evidence lookup;
- long documents;
- RAG grounding.

### Passage-Level

```text
one case = many passage vectors
```

Good for:

- answer grounding;
- finding specific evidence;
- long decisions/reports;
- highlighting relevant section.

Bad for:

- duplicate case results;
- more storage;
- need collapse/grouping by case;
- permission per passage.

Often best:

```text
passage retrieval
→ group/collapse by parent case
→ fetch case metadata
→ show matching passages
```

---

## 18. Embedding Model Selection

Model choice determines semantic behavior.

Criteria:

```text
language support
domain support
dimension size
latency
cost
deployment mode
privacy
license
throughput
similarity metric
maximum input length
multilingual quality
embedding stability
provider reliability
```

For Indonesian/regulatory systems:

- test Indonesian and English mixed queries;
- test legal/regulatory terminology;
- test organization names and abbreviations;
- test case identifiers separately with lexical search;
- test domain paraphrases.

Do not choose model only because it is popular. Choose based on evaluation.

---

## 19. Model Versioning

Every embedded document should record:

```json
{
  "embeddingModel": "e5-small-v2",
  "embeddingModelVersion": "2026-06-01",
  "embeddingSourceFieldVersion": "case-semantic-v3",
  "embeddingGeneratedAt": "2026-06-22T10:00:00Z"
}
```

Why?

- re-embedding migration;
- debugging relevance;
- mixed model detection;
- rollback;
- audit;
- cost tracking.

If query embeddings use model B while document embeddings use model A, retrieval quality can collapse.

Rule:

```text
Query vector model must match document vector model unless you explicitly validated compatibility.
```

---

## 20. Embedding Lifecycle

Lifecycle events requiring re-embedding:

```text
source text changed
chunking strategy changed
model changed
language normalization changed
field selection changed
permission boundary changed
document redacted
domain taxonomy changed
```

Re-embedding is like reindexing:

```text
create new vector field/index
→ backfill embeddings
→ compare quality
→ cut over
→ remove old embeddings
```

Do not overwrite vectors blindly without rollback plan.

---

## 21. Stale Embeddings

Stale embedding example:

```text
Case summary updated from "under review" to "closed with sanction".
Vector still represents old summary.
```

Symptoms:

- search retrieves outdated semantic meaning;
- RAG answers stale content;
- related cases wrong.

Monitor:

```text
source_updated_at
embedding_generated_at
embedding_lag_seconds
embedding_model_version
```

Alert if:

```text
embedding_generated_at < source_updated_at
```

beyond SLA.

---

## 22. Permission-Aware Vector Search

Semantic retrieval can leak data if permission is not enforced.

Risks:

- restricted chunk retrieved by vector similarity;
- RAG uses inaccessible passage;
- vector search index lacks tenant/security field;
- semantic suggestions reveal sensitive topic;
- grouped parent case accessible but matched chunk inaccessible;
- old embedding contains redacted text.

Rules:

```text
1. Put tenant/security fields on every retrievable vector document.
2. Filter before result exposure.
3. Store only text user may retrieve, or enforce field-level permission.
4. Re-embed after redaction.
5. Do not use vector search as authorization shortcut.
```

For chunk-level security, permission may differ by chunk. Do not assume parent case permission always equals all evidence permission.

---

## 23. Semantic Search and Explainability

BM25 can be explained via terms, IDF, field length, boosts.

Dense vector search is harder:

```text
Document is near query vector.
```

This is less satisfying for auditors/users.

Improve explainability:

- show matched passage text;
- combine with lexical highlights;
- show reason labels from metadata;
- use hybrid search;
- log retrieval strategy;
- keep model/version metadata;
- evaluate with human judgments;
- avoid overclaiming.

Bad UI:

```text
This is the best result.
```

Better UI:

```text
Semantically similar passages found in active enforcement cases.
```

---

## 24. Semantic Search Failure Modes

### 24.1 Plausible But Wrong Match

Semantic model retrieves text that sounds related but is legally different.

Example:

```text
"late disclosure" vs "late payment"
```

Mitigation:

- hybrid retrieval;
- metadata filters;
- domain evaluation;
- reranking;
- exact term boosts for legal concepts.

### 24.2 Missing Exact Identifier

Vector search fails for:

```text
CASE-2026-000123
```

Mitigation:

- detect identifier query;
- exact keyword search;
- hybrid fallback.

### 24.3 Semantic Drift

Model update changes neighborhood.

Mitigation:

- version embeddings;
- golden query evaluation;
- canary;
- keep old vector index.

### 24.4 Stale Embeddings

Text changed but vector not regenerated.

Mitigation:

- embedding lag metric;
- event-driven re-embedding;
- reconciliation.

### 24.5 Permission Leak

Restricted chunk retrieved.

Mitigation:

- mandatory filters;
- permission tests;
- chunk-level metadata.

### 24.6 Poor Chunking

Relevant answer split across chunks or buried in large chunk.

Mitigation:

- chunk strategy evaluation;
- overlap;
- section-aware chunking.

---

## 25. Dense Vector Storage and Cost

Dense vectors can be large.

Storage estimate:

```text
documents × dimensions × bytes per dimension
```

Example conceptual:

```text
10,000,000 chunks × 768 dims × 4 bytes
≈ 30.7 GB raw floats
```

But actual storage/index memory overhead may differ due to indexing structures, metadata, quantization, replicas, and segment overhead.

Cost drivers:

- number of chunks;
- vector dimensions;
- replicas;
- indexing structure;
- quantization;
- `_source` storing vectors or not;
- model precision;
- refresh/merge behavior;
- hardware memory.

Elastic documents vector storage optimization and quantization options for semantic search, especially for `semantic_text` fields.

Design question:

```text
Do you need vectors for every field and every document?
```

Often no.

---

## 26. Approximate kNN Performance Tuning

Factors:

```text
num_candidates
k
filter selectivity
vector dimensions
number of vectors
shard count
segment count
quantization
hardware CPU/memory
concurrent queries
indexing rate
```

General patterns:

- increase `num_candidates` to improve recall, at cost of latency;
- reduce vectors by better chunking/filtering;
- prefilter by tenant/status/type when possible;
- avoid too many tiny shards;
- benchmark with realistic queries;
- monitor p95/p99 separately for vector search.

Do not tune vector search using only one query.

---

## 27. Semantic Search Query Patterns

### 27.1 Pure Semantic

```text
query → embedding → vector kNN → results
```

Good for discovery.

Risk: misses exact lexical constraints.

### 27.2 Lexical First

```text
BM25 query → candidates → optional semantic rescore
```

Good when exact terms matter.

### 27.3 Semantic First

```text
vector search → candidates → lexical/domain filter/rerank
```

Good when vocabulary mismatch is high.

### 27.4 Hybrid

```text
BM25 + vector → fusion → results
```

Often best for production search.

Part 031 will cover hybrid/RAG in depth.

---

## 28. Semantic Search With `semantic_text`

Elastic's `semantic_text` workflow is the easiest managed path for semantic search. Documentation says it simplifies inference by providing inference at ingestion time with sensible defaults and avoids manually defining model settings, ingest pipelines, or chunking in many cases.

High-level workflow:

```text
create mapping with semantic_text
ingest text
Elasticsearch handles inference/chunking behavior
query semantic field
```

Benefits:

- less plumbing;
- integrated inference workflow;
- useful quick start;
- easier hybrid with text fields.

Trade-offs:

- less control than bring-your-own-vector;
- must understand limitations;
- migration/re-embedding still matters;
- model/inference endpoint dependency still exists.

---

## 29. Manual Dense Vector Workflow

Manual workflow:

```text
1. Choose embedding model.
2. Define mapping dense_vector dims/similarity.
3. Generate embeddings externally or via inference.
4. Index text + vector + metadata.
5. Generate query embedding.
6. Execute kNN with filters.
7. Evaluate and tune.
```

Use when:

- custom model;
- external embedding provider;
- cross-system vector reuse;
- custom chunking;
- explicit model version governance;
- special performance/cost tuning.

---

## 30. Java Architecture for Vector Search

Components:

```text
EmbeddingClient
Chunker
EmbeddingJob
VectorDocumentBuilder
VectorIndexer
SemanticSearchService
HybridSearchService
EmbeddingVersionRepository
Repair/ReembeddingJob
EvaluationRunner
```

### 30.1 EmbeddingClient

```java
public interface EmbeddingClient {
    EmbeddingResult embedText(String modelId, String text);
    List<EmbeddingResult> embedBatch(String modelId, List<String> texts);
}
```

### 30.2 Chunker

```java
public interface TextChunker {
    List<TextChunk> chunk(DocumentForEmbedding document);
}
```

### 30.3 Vector Document

```java
public record CasePassageVectorDocument(
    String caseId,
    String chunkId,
    String tenantId,
    Set<String> visibilityScopes,
    String chunkType,
    String text,
    List<Float> embedding,
    String embeddingModel,
    String embeddingVersion,
    Instant sourceUpdatedAt,
    Instant embeddingGeneratedAt
) {}
```

---

## 31. Java Query Flow

```java
public SemanticSearchResult search(SemanticSearchCommand command) {
    UserContext user = command.user();

    PermissionContext permission = permissionService.build(user);

    EmbeddingResult queryEmbedding = embeddingClient.embedText(
        command.embeddingModel(),
        command.query()
    );

    SearchRequest request = semanticQueryBuilder.buildKnnSearch(
        command,
        queryEmbedding.vector(),
        permission
    );

    SearchResponse<CasePassageHit> response =
        elasticsearchClient.search(request, CasePassageHit.class);

    return semanticResultMapper.toResult(response);
}
```

Important:

- enforce permission before/inside query;
- timeout embedding call;
- handle embedding provider errors;
- cache query embeddings carefully if safe;
- log model version;
- measure embedding latency separately from ES latency.

---

## 32. Embedding Provider Failure

Semantic search adds dependency:

```text
embedding model/provider
```

Failure modes:

- provider timeout;
- rate limit;
- wrong model version;
- dimension mismatch;
- malformed vector;
- latency spike;
- quota exhausted;
- privacy/policy issue.

Mitigation:

- fallback to lexical search;
- circuit breaker;
- request timeout;
- bulk embedding queue;
- provider health metrics;
- model/version validation;
- dimensionality check;
- retry with budget.

Do not let embedding provider outage take down all search if lexical fallback is acceptable.

---

## 33. Dimension Mismatch

If mapping expects 384 dimensions and model returns 768 dimensions, indexing/query fails.

Guardrails:

```java
if (embedding.vector().size() != expectedDimensions) {
    throw new IllegalStateException(
        "Embedding dimension mismatch: expected " + expectedDimensions
    );
}
```

Record expected dimensions per model.

---

## 34. Evaluation: Semantic Search Quality

You need evaluation data.

Metrics:

```text
recall@K
precision@K
MRR
nDCG@K
coverage
zero-result rate
human relevance judgments
```

For semantic search, include query classes:

```text
paraphrase
exact identifier
domain term
multilingual
acronym
ambiguous query
sensitive/legal distinction
negative examples
```

Example golden set:

```json
{
  "query": "company hid worsening financial condition",
  "relevantPassages": [
    "case-123:summary:0002",
    "case-991:decision:0004"
  ],
  "mustNotReturn": [
    "case-333:late-payment:0001"
  ],
  "queryType": "semantic_paraphrase"
}
```

Do not evaluate only with “looks good” demos.

---

## 35. Evaluating Model Choice

Compare models on same query set:

```text
model A recall@10 = 0.72, p95 latency 120ms, cost $X
model B recall@10 = 0.81, p95 latency 220ms, cost $Y
model C recall@10 = 0.75, better Indonesian, worse English legal terms
```

Decision is multi-dimensional:

- relevance;
- latency;
- cost;
- privacy;
- deployment complexity;
- language/domain quality;
- long-term support.

---

## 36. Semantic Search For Regulatory Systems

Use cases:

```text
find similar enforcement cases
retrieve relevant evidence passages
search by natural language allegation description
find prior decisions with similar reasoning
assist investigator discovery
support RAG over policies/decisions
cluster complaints by meaning
```

But keep lexical paths for:

```text
case number
party identifier
legal article
regulation code
document number
exact organization name
```

Best architecture:

```text
case metadata search:
  lexical/filter/facet

case passage semantic search:
  vector/hybrid

exact identifiers:
  keyword exact

audit/legal:
  lexical + strict filters + semantic assist

RAG:
  permission-aware passage retrieval + grounding
```

---

## 37. Semantic Search and RAG

RAG depends on retrieval quality.

If semantic retrieval returns wrong passage, LLM answer may be wrong even if the language model is good.

Vector search for RAG must prioritize:

- grounding accuracy;
- citation granularity;
- permission filtering;
- freshness;
- chunk quality;
- deduplication;
- negative examples;
- evaluation.

Do not treat RAG retrieval as generic top-5 semantic search.

Part 031 covers RAG-oriented retrieval in depth.

---

## 38. Observability for Vector Search

Metrics:

```text
semantic_search.request.count
semantic_search.total_latency
semantic_search.embedding_latency
semantic_search.es_knn_latency
semantic_search.result_count
semantic_search.zero_result_count
semantic_search.k
semantic_search.num_candidates
semantic_search.model
semantic_search.embedding_dimension
semantic_search.filter_count
semantic_search.permission_scope_count
semantic_search.timeout_count
semantic_search.fallback_to_lexical_count
```

Indexing metrics:

```text
embedding_job.queue_size
embedding_job.latency
embedding_job.failure_count
embedding_job.rate_limit_count
embedding_job.dimension_mismatch
embedding_lag_seconds
reembedding_progress
```

Quality metrics:

```text
semantic_golden.recall_at_10
semantic_golden.ndcg_at_10
semantic_user_feedback.positive/negative
```

---

## 39. Security and Privacy

Embedding can leak information indirectly.

Consider:

- sensitive text sent to external embedding provider;
- embeddings stored long after text redacted;
- vector similarity revealing existence of restricted docs;
- logs containing text sent for embedding;
- model provider data retention policy;
- cross-border data transfer;
- tenant isolation.

Controls:

- provider/vendor review;
- redact before embedding if needed;
- on-prem/private model for sensitive data;
- encrypt index/snapshots;
- permission filters;
- delete/re-embed after redaction;
- restrict vector index access;
- log carefully.

---

## 40. Common Anti-Patterns

### 40.1 Replacing All Search With Vector Search

Bad for exact identifiers, filters, facets, codes, and legal references.

### 40.2 Embedding Entire Raw Document

Creates noisy vectors and may include sensitive irrelevant fields.

### 40.3 No Model Versioning

You cannot debug or migrate quality.

### 40.4 No Re-Embedding Plan

Model/chunking/source changes will happen.

### 40.5 No Permission Metadata On Vector Docs

This is a security bug waiting to happen.

### 40.6 Evaluating With Demo Queries Only

Semantic demos are easy. Production relevance is hard.

### 40.7 Ignoring Embedding Latency

Query embedding can dominate end-to-end latency.

### 40.8 No Lexical Fallback

Embedding provider outage should not necessarily kill all search.

### 40.9 Mixing Model Versions Silently

Vector spaces may be incompatible.

### 40.10 Using Semantic Search For Legal Truth

Semantic similarity is assistive. Legal/regulatory determinations require exact sources, rules, and human/domain validation.

---

## 41. Production Readiness Checklist

```text
[ ] Use cases classified: exact, lexical, semantic, hybrid
[ ] Embedding model selected through evaluation
[ ] Model version recorded
[ ] Vector dimensions verified
[ ] Similarity metric matches model expectation
[ ] Chunking strategy documented
[ ] Permission fields on every vector document
[ ] Re-embedding strategy exists
[ ] Embedding lag monitored
[ ] k/num_candidates tuned with test set
[ ] Lexical fallback exists if needed
[ ] Semantic search metrics implemented
[ ] Golden query set includes semantic and exact cases
[ ] Sensitive data/privacy review done
[ ] Cost/storage estimate done
[ ] Feature flag/canary plan exists
[ ] RAG usage has grounding/citation evaluation
```

---

## 42. Exercises

### Exercise 1 — Classify Search Mode

For each query, choose lexical, semantic, or hybrid:

1. `CASE-2026-000123`
2. `issuer concealed worsening liquidity`
3. `OJK Regulation 12/2024`
4. `similar cases to this enforcement decision`
5. `late disclosure market risk`
6. `PT Contoh Abadi`
7. `companies hiding losses from investors`

Explain why.

---

### Exercise 2 — Design Vector Index

Design index for case passages:

- fields;
- mapping;
- chunk ID;
- tenant/security fields;
- model version fields;
- date/freshness fields;
- vector field.

---

### Exercise 3 — Embedding Lifecycle

Given:

```text
model v1 → 384 dims
model v2 → 768 dims
```

Explain migration plan without downtime.

---

### Exercise 4 — Permission-Aware RAG

Design retrieval rules for RAG over regulatory cases:

- user has tenant;
- user has role;
- some evidence restricted;
- some cases legal-hold;
- vector search retrieves passages.

Where do you enforce permission?

---

### Exercise 5 — Evaluation

Create 10 query categories for semantic search evaluation in regulatory case search, including negative examples.

---

## 43. Summary

Vector search and semantic search expand Elasticsearch from keyword matching into meaning-based retrieval. But they do not eliminate the need for classical search engineering.

Key lessons:

1. Lexical search and semantic search solve different problems.
2. Dense vectors represent meaning in numeric vector space.
3. kNN finds nearest vectors; approximate kNN trades perfect recall for speed.
4. `dense_vector` gives low-level control; `semantic_text` simplifies managed semantic workflow.
5. Embedding model choice is an architecture decision.
6. Chunking strategy determines retrieval quality.
7. Model versioning and re-embedding lifecycle are mandatory.
8. Permission-aware vector search must filter every retrievable vector document.
9. Semantic search is harder to explain than BM25.
10. Evaluation must include paraphrases, exact identifiers, legal distinctions, multilingual queries, and negative examples.
11. Hybrid search often outperforms pure lexical or pure vector.
12. RAG quality depends on retrieval quality, not just the LLM.

The core mental model:

```text
Semantic search is not a field type.
It is a lifecycle: text selection → chunking → embedding → indexing → retrieval → filtering → ranking → evaluation → re-embedding.
```

---

## 44. What Comes Next

Part 031 will cover:

```text
Hybrid Search and RAG-Oriented Retrieval
```

Topics:

- hybrid lexical + vector search;
- why BM25 still matters;
- reciprocal rank fusion;
- score normalization problem;
- candidate generation vs reranking;
- chunking for RAG;
- metadata filtering;
- passage retrieval vs document retrieval;
- grounding quality;
- freshness and permission-aware RAG;
- evaluation: recall@K, MRR, nDCG;
- production RAG retrieval failure modes.

---

## References

- Elastic Docs — Vector search in Elasticsearch: https://www.elastic.co/docs/solutions/search/vector
- Elastic Docs — Dense vector search: https://www.elastic.co/docs/solutions/search/vector/dense-vector
- Elastic Docs — Dense vector field type: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/dense-vector
- Elastic Docs — kNN search in Elasticsearch: https://www.elastic.co/docs/solutions/search/vector/knn
- Elastic Docs — kNN query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-knn-query
- Elastic Docs — Tune approximate kNN search: https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/approximate-knn-search
- Elastic Docs — Bring your own dense vectors: https://www.elastic.co/docs/solutions/search/vector/bring-own-vectors
- Elastic Docs — Semantic search: https://www.elastic.co/docs/solutions/search/semantic-search
- Elastic Docs — Semantic search with semantic_text: https://www.elastic.co/docs/solutions/search/semantic-search/semantic-search-semantic-text
- Elastic Docs — Semantic text field type: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text
- Elastic Docs — Semantic search with inference API: https://www.elastic.co/docs/solutions/search/semantic-search/semantic-search-inference
- Elastic Docs — Inference API: https://www.elastic.co/docs/explore-analyze/elastic-inference/inference-api
- Elastic Docs — ELSER: https://www.elastic.co/docs/explore-analyze/machine-learning/nlp/ml-nlp-elser
- Elastic Docs — Hybrid search with semantic_text: https://www.elastic.co/docs/solutions/search/hybrid-semantic-text
- Elastic Docs — Optimize dense vector storage for semantic search: https://www.elastic.co/docs/solutions/search/vector/vector-storage-for-semantic-search

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-029.md">⬅️ Part 029 — Advanced Search Features</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-031.md">Part 031 — Hybrid Search and RAG-Oriented Retrieval ➡️</a>
</div>
