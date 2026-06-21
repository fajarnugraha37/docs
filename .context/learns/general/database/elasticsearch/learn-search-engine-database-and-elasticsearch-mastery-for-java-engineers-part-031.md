
# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-031.md

# Part 031 — Hybrid Search and RAG-Oriented Retrieval

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Part: `031`  
> Fokus: hybrid lexical-semantic search, RRF, linear retriever, candidate generation, reranking, chunking, metadata filtering, permission-aware RAG retrieval, grounding quality, dan evaluation  
> Target pembaca: Java software engineer / tech lead yang ingin membangun search dan retrieval layer untuk aplikasi enterprise, regulatory search, dan RAG secara production-grade.

---

## 0. Posisi Part Ini Dalam Seri

Part 030 membahas vector search dan semantic search:

```text
text → embedding → vector → nearest neighbor search
```

Part 031 membahas bagaimana semantic search dipakai bersama lexical search/BM25 untuk membangun retrieval system yang lebih kuat.

Kita akan membahas:

- why BM25 still matters;
- hybrid lexical + vector search;
- sparse vs dense semantic retrieval;
- RRF / Reciprocal Rank Fusion;
- linear score fusion;
- score normalization problem;
- retriever framework;
- `semantic_text` workflow;
- candidate generation vs reranking;
- semantic reranking;
- passage retrieval vs document retrieval;
- chunking untuk RAG;
- metadata filtering;
- permission-aware RAG;
- freshness;
- grounding/citation quality;
- retrieval evaluation;
- failure modes production.

Part ini penting karena banyak tim melakukan kesalahan besar:

```text
Mereka menambahkan vector search,
lalu menganggap RAG/search otomatis bagus.
```

Padahal retrieval quality biasanya menjadi bottleneck utama.

---

## 1. Core Thesis

Hybrid search bukan sekadar menjalankan BM25 dan vector search bersamaan.

Hybrid search adalah desain retrieval pipeline yang menggabungkan beberapa sinyal:

```text
lexical precision
+ semantic recall
+ metadata filters
+ domain ranking signals
+ permission constraints
+ freshness
+ reranking
+ evaluation
```

RAG-oriented retrieval lebih ketat lagi, karena hasil retrieval akan menjadi konteks untuk model generatif.

Jika retrieval salah:

```text
LLM menjawab dengan lancar tetapi salah konteks.
```

Jadi retrieval layer harus diperlakukan sebagai **safety-critical information selection layer**, terutama untuk regulatory/case management systems.

---

## 2. Why BM25 Still Matters

Semantic search powerful, tetapi BM25 tetap penting.

BM25 unggul untuk:

```text
case numbers
legal article references
regulation codes
organization names
person names
exact phrases
rare technical terms
acronyms
structured identifiers
known-item search
```

Contoh:

```text
Query: CASE-2026-000123
```

Vector search bisa gagal total karena identifier bukan “makna natural language”.

Contoh lain:

```text
Query: Article 27 paragraph 3
```

Semantic search bisa mengembalikan dokumen yang mirip secara topik tetapi bukan artikel yang tepat.

Rule:

```text
If exactness matters, lexical/structured retrieval must dominate.
```

Semantic search membantu ketika query adalah:

```text
"company hid worsening liquidity"
```

dan dokumen memakai wording:

```text
"issuer failed to disclose material financial deterioration"
```

Hybrid search menggabungkan keduanya.

---

## 3. Retrieval Modes

### 3.1 Lexical Retrieval

```text
query text
→ analyzer
→ inverted index
→ BM25
→ ranked docs
```

Strength:

- exactness;
- explainability;
- keyword precision.

Weakness:

- vocabulary mismatch.

### 3.2 Dense Vector Retrieval

```text
query text
→ embedding
→ dense vector
→ kNN
→ semantically similar docs
```

Strength:

- paraphrase;
- concept similarity.

Weakness:

- less explainable;
- can be plausibly wrong.

### 3.3 Sparse Semantic Retrieval

```text
query text
→ learned sparse representation
→ weighted term-like expansion
→ ranked docs
```

Strength:

- semantic expansion;
- sometimes more interpretable;
- strong out-of-box workflows such as ELSER.

Weakness:

- model-dependent;
- can still retrieve broad matches.

### 3.4 Hybrid Retrieval

```text
lexical retriever
+ vector/sparse semantic retriever
→ fusion
→ final ranked list
```

Strength:

- balances precision and recall;
- robust across query classes.

Weakness:

- more complex evaluation;
- score/rank fusion choices matter.

---

## 4. Query Class First, Technique Second

Do not use one retrieval strategy for all queries.

Classify query intent:

| Query Type | Example | Preferred Strategy |
|---|---|---|
| Exact identifier | `CASE-2026-000123` | keyword exact |
| Legal reference | `Regulation 12/2024 Article 5` | lexical + structured fields |
| Person/org name | `PT Contoh Abadi` | lexical + entity fields + maybe fuzzy |
| Natural language concept | `company concealed losses` | hybrid / semantic |
| Similar document | “find cases like this” | vector/semantic + metadata |
| Broad research | `market abuse patterns` | hybrid + facets |
| RAG question | “what sanctions were imposed for late disclosure?” | passage hybrid retrieval + rerank |
| Autocomplete | `market manip...` | search-as-you-type / completion / controlled lexical |
| Audit search | exact facts/date/status | lexical + strict filters |

Query classifier can be rule-based at first:

```text
if looksLikeCaseNumber(query) → exact_identifier
if contains legal reference pattern → legal_reference
if short prefix → autocomplete
if natural language sentence → hybrid
```

Later, use analytics or ML if needed.

---

## 5. Hybrid Search Patterns

### Pattern A — Parallel Retrieval + Fusion

```text
BM25 retriever → top N lexical
Vector retriever → top M semantic
Fusion → final top K
```

Best general hybrid pattern.

### Pattern B — Lexical First, Semantic Rerank

```text
BM25 → candidate set → semantic reranker → final ranking
```

Good when lexical recall is strong enough.

Risk: if BM25 misses relevant paraphrase, reranker never sees it.

### Pattern C — Semantic First, Lexical/Metadata Rerank

```text
Vector → candidate set → lexical/domain rerank → final ranking
```

Good when vocabulary mismatch is high.

Risk: exact term matches may be missed if vector recall poor.

### Pattern D — Multi-Stage Retrieval

```text
structured filters
→ lexical + semantic candidate generation
→ fusion
→ rerank
→ group/collapse
→ permission-safe response
```

Best for serious enterprise/RAG use.

---

## 6. Score Normalization Problem

BM25 score and vector similarity score are not directly comparable.

BM25:

```text
unbounded-ish
depends on corpus, term frequency, field length
```

Vector similarity:

```text
bounded or differently distributed depending metric/model
```

If you simply add scores:

```text
final_score = bm25_score + vector_score
```

you can get unstable results.

Example:

```text
BM25 score: 17.8
cosine score: 0.73
```

BM25 dominates.

For another query:

```text
BM25 score: 1.2
cosine score: 0.82
```

vector dominates.

This is why fusion strategies matter.

---

## 7. Reciprocal Rank Fusion / RRF

### 7.1 Mental Model

RRF combines result sets by rank position, not raw score.

If a document appears high in multiple result lists, it gets a stronger fused rank.

Formula conceptually:

```text
score(d) = Σ 1 / (rank_constant + rank_i(d))
```

Where:

- `rank_i(d)` is document rank in result list i;
- missing documents contribute nothing;
- `rank_constant` controls how strongly top positions dominate.

Why useful:

```text
BM25 and vector scores are not comparable,
but ranks are easier to combine.
```

Elastic describes RRF as a method for combining multiple result sets with different relevance indicators into a single result set, and Elastic's RRF retriever supports combining a standard retriever with kNN retriever for hybrid search.

---

## 8. RRF Example in Elasticsearch

Conceptual hybrid:

```json
GET /cases-search-read/_search
{
  "retriever": {
    "rrf": {
      "retrievers": [
        {
          "standard": {
            "query": {
              "multi_match": {
                "query": "company concealed losses",
                "fields": ["title^3", "summary", "body"]
              }
            }
          }
        },
        {
          "knn": {
            "field": "bodyEmbedding",
            "query_vector": [0.12, -0.04, 0.88],
            "k": 50,
            "num_candidates": 200,
            "filter": {
              "bool": {
                "filter": [
                  { "term": { "tenantId": "tenant-a" }},
                  { "terms": { "visibilityScopes": ["scope:investigator"] }}
                ]
              }
            }
          }
        }
      ],
      "rank_constant": 60,
      "rank_window_size": 100
    }
  },
  "size": 10
}
```

Notes:

- syntax evolves across Elasticsearch versions;
- always verify against your target version;
- permission filters must apply to every retriever path;
- `rank_window_size` controls candidate pool used for fusion.

---

## 9. RRF Strengths

RRF is good because:

- no score normalization needed;
- robust across heterogeneous retrievers;
- simple mental model;
- easy hybrid baseline;
- works when score scales differ;
- rewards docs appearing in multiple lists.

Good first hybrid strategy:

```text
BM25 + kNN → RRF
```

---

## 10. RRF Limitations

RRF has limitations:

- ignores raw score magnitude;
- less tunable for weighting one retriever over another;
- rank positions dominate even if score difference is huge;
- candidate window matters;
- can underuse strong domain scores;
- harder to calibrate business ranking.

Example issue:

```text
Doc A rank 1 in vector but lexically irrelevant.
Doc B rank 5 in BM25 and rank 7 in vector.
RRF may favor combined presence, but domain may require exact lexical phrase.
```

RRF is a great baseline, not always final answer.

---

## 11. Linear Retriever / Weighted Score Fusion

Elastic also provides linear retriever support that normalizes and linearly combines scores of other retrievers. It can combine top results from multiple retrievers using weighted, normalized score sums.

Mental model:

```text
normalized_bm25 = normalize(BM25 score)
normalized_vector = normalize(vector score)

final_score =
  bm25_weight * normalized_bm25
+ vector_weight * normalized_vector
```

Example conceptual:

```json
GET /cases-search-read/_search
{
  "retriever": {
    "linear": {
      "retrievers": [
        {
          "standard": {
            "query": {
              "match": {
                "body": "company concealed losses"
              }
            }
          }
        },
        {
          "knn": {
            "field": "bodyEmbedding",
            "query_vector": [0.12, -0.04, 0.88],
            "k": 100,
            "num_candidates": 300
          }
        }
      ],
      "normalizer": "minmax",
      "weights": [1.5, 1.0]
    }
  }
}
```

Check syntax for your Elasticsearch version.

### When Linear Fusion Helps

- you want explicit weighting;
- lexical match should dominate certain fields;
- vector should supplement recall;
- you have evaluation data to tune weights.

### Risk

- requires score normalization choices;
- more tunable means easier to overfit;
- needs monitoring and relevance tests.

---

## 12. `semantic_text` Hybrid Search

Elastic documents hybrid search with `semantic_text`, combining a semantic field with a normal `text` field. Elastic's hybrid search docs state that the recommended way to use hybrid search in the Elastic Stack is the `semantic_text` workflow.

Conceptual mapping:

```json
PUT /cases-hybrid-v1
{
  "mappings": {
    "properties": {
      "title": {
        "type": "text"
      },
      "body": {
        "type": "text"
      },
      "body_semantic": {
        "type": "semantic_text"
      },
      "tenantId": {
        "type": "keyword"
      },
      "visibilityScopes": {
        "type": "keyword"
      }
    }
  }
}
```

Conceptual retrieval:

```text
standard lexical retriever on body/title
+ semantic retriever on body_semantic
→ RRF/linear fusion
```

Benefits:

- less manual vector plumbing;
- integrated inference workflow;
- works well for getting started;
- useful managed abstraction.

Cautions:

- still evaluate;
- still enforce permission;
- still track model/chunking behavior;
- still design migration/re-embedding;
- still understand limitations.

---

## 13. Candidate Generation vs Reranking

### 13.1 Candidate Generation

First stage retrieves candidates quickly.

Examples:

```text
BM25 top 200
kNN top 200
sparse semantic top 200
```

Goal:

```text
high recall
reasonable latency
```

### 13.2 Fusion

Combine candidates.

Examples:

```text
RRF
linear fusion
custom rank merge
```

Goal:

```text
better robust ranking
```

### 13.3 Reranking

Second stage reranks smaller candidate set using more expensive model/logic.

Examples:

```text
semantic reranker
cross-encoder reranker
business priority reranker
phrase/proximity rescore
domain-specific ranking
```

Goal:

```text
high precision at top-K
```

---

## 14. Why Reranking Matters

Vector search retrieves semantically similar candidates, but top ordering may still be weak.

Reranking can consider:

- query-document interaction more deeply;
- phrase/proximity;
- exactness;
- metadata;
- domain authority;
- recency;
- permission-safe context;
- business priority.

Elastic's ranking docs describe rerankers as improving relevance from earlier-stage retrieval mechanisms, with first-stage retrieval generating candidates that are fed into more expensive reranking tasks.

---

## 15. Semantic Reranking

Semantic reranker differs from vector retrieval.

Vector retrieval:

```text
encode query separately
encode document separately
compare vectors
```

Cross-encoder/semantic reranker:

```text
model sees query + document together
outputs relevance score
```

Usually:

- more accurate;
- more expensive;
- used on top N candidates.

Flow:

```text
BM25/vector/hybrid candidates top 100
→ semantic reranker
→ final top 10
```

Do not rerank 100k docs.

---

## 16. RAG-Oriented Retrieval

RAG retrieval is not the same as search page retrieval.

Search UI retrieval:

```text
return documents user can inspect
```

RAG retrieval:

```text
return evidence/context chunks that an LLM will use to answer
```

RAG retrieval must optimize for:

- factual grounding;
- citation;
- permission;
- freshness;
- coverage;
- low contradiction;
- chunk coherence;
- answerability;
- traceability.

Bad RAG retrieval creates hallucination even with a strong LLM.

---

## 17. RAG Retrieval Pipeline

Typical pipeline:

```text
User question
→ classify intent
→ build permission context
→ lexical retrieval
→ semantic retrieval
→ metadata filters
→ fusion
→ reranking
→ diversity/dedup
→ context assembly
→ citation metadata
→ LLM answer
→ answer verification/logging
```

Important:

```text
The LLM should only see passages the user is allowed to see.
```

---

## 18. Passage Retrieval vs Document Retrieval

### Document Retrieval

```text
return whole case/document
```

Good for search UI.

Bad for RAG if document is long.

### Passage Retrieval

```text
return relevant chunks/passages
```

Good for RAG grounding.

Risks:

- lost context;
- duplicate chunks;
- parent metadata missing;
- chunk-level permission complexity.

Production RAG usually needs passage retrieval plus parent document metadata.

---

## 19. Chunking For RAG

Chunk design must preserve answerability.

Chunking strategies:

### Fixed-size chunks

```text
every 500 tokens, overlap 50
```

Simple but can split semantic units.

### Section-aware chunks

```text
by headings, sections, paragraphs
```

Often better for policies, decisions, reports.

### Semantic chunks

```text
split by topic boundaries
```

More complex but can improve retrieval.

### Entity-aware chunks

```text
case allegations
party summaries
evidence excerpts
decision reasoning
sanction section
```

Best for regulatory systems when domain structure exists.

---

## 20. Chunk Metadata

Each chunk should carry metadata:

```json
{
  "chunkId": "case-123:decision:section-4:chunk-002",
  "caseId": "case-123",
  "documentId": "decision-77",
  "tenantId": "tenant-a",
  "visibilityScopes": ["scope:case:read"],
  "sourceType": "decision",
  "sectionTitle": "Sanction reasoning",
  "pageNumber": 12,
  "createdAt": "2026-01-05T10:00:00Z",
  "sourceUpdatedAt": "2026-06-20T08:00:00Z",
  "embeddingModel": "model-v2",
  "text": "..."
}
```

Metadata supports:

- filtering;
- citation;
- freshness;
- grouping;
- dedup;
- audit;
- repair.

---

## 21. Metadata Filtering

Metadata filters are not optional.

Common filters:

```text
tenantId
visibilityScopes
lifecycleStatus
documentStatus
sourceType
language
jurisdiction
caseStatus
date range
legalHold
classification
```

Example:

```json
{
  "bool": {
    "filter": [
      { "term": { "tenantId": "tenant-a" }},
      { "terms": { "visibilityScopes": ["scope:investigator:123"] }},
      { "term": { "documentStatus": "PUBLISHED" }},
      { "terms": { "sourceType": ["decision", "evidence_summary"] }}
    ]
  }
}
```

In RAG, filters define what the model is allowed to know.

---

## 22. Permission-Aware RAG

Permission-aware RAG is stricter than permission-aware search because retrieved text is fed into model context.

Rules:

```text
1. Filter before context assembly.
2. Do not include restricted chunks in hidden prompt.
3. Do not use restricted chunks for summarization.
4. Do not cite inaccessible sources.
5. Enforce tenant and role at retrieval layer.
6. Log retrieval metadata for audit.
7. Revalidate permissions for long-running sessions if needed.
```

Dangerous pattern:

```text
Retrieve broad internal context
→ ask LLM to not reveal restricted parts
```

Wrong. The LLM should not receive unauthorized context.

---

## 23. RAG Context Assembly

After retrieval, you need context assembly.

Problems:

- too many chunks;
- duplicate chunks;
- conflicting chunks;
- stale chunks;
- chunks without enough surrounding context;
- chunks from inaccessible sources;
- token budget limits.

Context assembly should:

```text
deduplicate
group by source
preserve citation IDs
include metadata
respect token budget
prefer fresh/authoritative sources
avoid mixing contradictory versions
```

Example context item:

```json
{
  "citationId": "C1",
  "caseId": "case-123",
  "documentTitle": "Decision on Late Disclosure",
  "section": "Sanction Reasoning",
  "page": 12,
  "text": "The panel imposed an administrative sanction because..."
}
```

---

## 24. Grounding Quality

Grounding means the generated answer is supported by retrieved evidence.

Retrieval affects grounding through:

- correct sources;
- precise passages;
- enough context;
- no restricted content;
- no stale versions;
- citations.

Grounding failure examples:

```text
retrieved related but not applicable case
retrieved old superseded policy
retrieved summary but not decision reasoning
retrieved chunk missing exception clause
retrieved one side of contradictory evidence
```

Mitigation:

- metadata filters;
- authority ranking;
- freshness;
- section-aware chunking;
- reranking;
- citation requirement;
- answer abstention when retrieval insufficient.

---

## 25. Retrieval Diversity

Top vector results can be near-duplicates.

For RAG, you may need diversity:

```text
avoid 5 chunks from same paragraph
include multiple relevant documents
include controlling policy and case-specific evidence
include recent and authoritative sources
```

Strategies:

- collapse/group by document/case;
- max chunks per source;
- MMR-like diversity strategy;
- rerank with source diversity;
- explicit retrieval plan.

Example:

```text
max 2 chunks per document
max 3 chunks per case
must include at least 1 policy source if question asks "what rule applies"
```

---

## 26. Multi-Stage RAG Retrieval Example

For regulatory Q&A:

```text
Question:
"What sanctions were imposed for late disclosure in similar cases?"

Stage 1:
Classify intent = precedent/comparison.

Stage 2:
Retrieve lexical:
"late disclosure", "sanction", "penalty"

Stage 3:
Retrieve semantic:
"issuer failed to disclose material information on time"

Stage 4:
Filter:
tenant, permission, published decisions, not superseded.

Stage 5:
Fuse:
RRF lexical + semantic.

Stage 6:
Rerank:
prefer final decisions with sanction section.

Stage 7:
Diversify:
max 2 chunks per case.

Stage 8:
Assemble:
include citation metadata and case status.

Stage 9:
LLM:
answer with citations and uncertainty.
```

---

## 27. Hybrid Search In Java

Architecture:

```text
SearchCommand
→ QueryIntentClassifier
→ PermissionContextBuilder
→ RetrievalPlanner
→ ElasticsearchHybridQueryBuilder
→ ResultFusion/Rerank if external
→ ResponseMapper
```

Example intent classifier:

```java
public enum QueryIntent {
    EXACT_IDENTIFIER,
    LEGAL_REFERENCE,
    ENTITY_NAME,
    NATURAL_LANGUAGE,
    SIMILAR_CASE,
    RAG_QUESTION
}
```

Planner:

```java
public RetrievalPlan plan(SearchCommand command) {
    QueryIntent intent = classifier.classify(command.query());

    return switch (intent) {
        case EXACT_IDENTIFIER -> RetrievalPlan.lexicalExact();
        case LEGAL_REFERENCE -> RetrievalPlan.lexicalWithStructuredBoost();
        case ENTITY_NAME -> RetrievalPlan.lexicalEntitySearch();
        case NATURAL_LANGUAGE -> RetrievalPlan.hybridRrf();
        case SIMILAR_CASE -> RetrievalPlan.semanticWithMetadata();
        case RAG_QUESTION -> RetrievalPlan.ragHybridRerank();
    };
}
```

Avoid one-size-fits-all.

---

## 28. Hybrid Query Builder Guardrails

Guardrails:

```text
- always include tenant filter
- always include permission filter
- cap lexical candidate size
- cap vector k
- cap num_candidates
- cap rerank window
- cap chunks per source
- enforce allowed source types
- timeout embedding calls
- fallback to lexical
```

Example policy:

```java
public record RetrievalLimits(
    int maxKnnK,
    int maxKnnCandidates,
    int maxRrfWindow,
    int maxRerankWindow,
    int maxChunksPerDocument,
    Duration embeddingTimeout
) {}
```

---

## 29. Lexical Fallback

Semantic systems can fail because:

- embedding provider down;
- model timeout;
- vector index unavailable;
- dimension mismatch;
- rate limit;
- inference endpoint unavailable.

Fallback strategies:

```text
exact identifier → lexical only
natural language → lexical BM25 fallback with user-visible degraded behavior if needed
RAG → refuse/ask to retry if evidence retrieval insufficient
autocomplete → independent lexical path
```

Do not silently generate answer with poor retrieval.

For RAG, fallback must be safe:

```text
If retrieval confidence insufficient, answer "I could not find enough supporting source material."
```

---

## 30. Evaluation Metrics

Common retrieval metrics:

### Recall@K

```text
Of all relevant docs/passages, how many appear in top K?
```

Important for candidate generation.

### Precision@K

```text
Of top K returned items, how many are relevant?
```

Important for user trust/context quality.

### MRR

Mean Reciprocal Rank:

```text
How high is the first relevant result?
```

Useful for known-item search.

### nDCG@K

Rewards relevant documents appearing higher, supports graded relevance.

Useful for search ranking.

### Hit Rate@K

```text
Did at least one relevant document appear in top K?
```

Useful for RAG retrieval.

### Answer Support Rate

For RAG:

```text
Can answer be supported by retrieved passages?
```

### Citation Accuracy

```text
Do cited passages actually support the answer?
```

---

## 31. Golden Query Set For Hybrid/RAG

Golden set should include:

```text
exact identifiers
legal references
entity names
paraphrase concepts
multilingual queries
acronyms
ambiguous queries
negative queries
sensitive permission queries
stale/superseded documents
RAG answerable questions
RAG unanswerable questions
```

Example:

```json
{
  "query": "company hid worsening liquidity before filing",
  "intent": "NATURAL_LANGUAGE",
  "relevantChunks": [
    "case-123:decision:chunk-004",
    "case-880:summary:chunk-002"
  ],
  "mustNotReturn": [
    "case-555:late-payment:chunk-001"
  ],
  "requiredMetadata": {
    "sourceType": ["decision", "summary"],
    "status": "PUBLISHED"
  }
}
```

---

## 32. Evaluation By Query Type

Do not average everything blindly.

Track separately:

```text
exact_identifier_recall@1
entity_name_mrr
natural_language_ndcg@10
semantic_paraphrase_recall@20
rag_hit_rate@10
permission_negative_pass_rate
multilingual_recall@10
legal_reference_precision@5
```

A single average can hide catastrophic failure:

```text
overall nDCG improved
but exact case number top-1 accuracy dropped
```

That is unacceptable.

---

## 33. Human Judgment

Semantic/RAG evaluation often needs human/domain judgment.

Judgment labels:

```text
0 = irrelevant
1 = marginally related
2 = relevant
3 = highly relevant / directly supports answer
```

For regulatory systems, include domain experts for:

- legal equivalence;
- factual similarity;
- precedent relevance;
- current vs superseded;
- permission/security concerns.

---

## 34. Online Signals

Possible online signals:

```text
click-through rate
result dwell time
query reformulation
zero-result rate
copy/citation usage
thumbs up/down
user saves result
user opens cited source
answer accepted/rejected
```

Cautions:

- click data is biased;
- top results get more clicks;
- users may click wrong result;
- no-click may mean answer was enough;
- regulatory users may behave differently.

Use online signals as feedback, not ground truth.

---

## 35. Production Metrics

Hybrid metrics:

```text
hybrid_search.request.count
hybrid_search.latency.p95
hybrid_search.lexical_latency
hybrid_search.vector_latency
hybrid_search.embedding_latency
hybrid_search.fusion_latency
hybrid_search.rerank_latency
hybrid_search.rag_context_tokens
hybrid_search.fallback_count
hybrid_search.k
hybrid_search.num_candidates
hybrid_search.rank_window_size
```

Quality metrics:

```text
hybrid_eval.ndcg@10
rag_eval.hit_rate@10
rag_eval.answer_support_rate
rag_eval.citation_accuracy
zero_result_rate
no_support_answer_rate
```

Security metrics:

```text
permission_filter_applied_count
retrieved_restricted_chunk_count
blocked_context_count
cross_tenant_candidate_count
```

The last two may only be measurable safely in controlled tests/shadow systems.

---

## 36. Failure Modes

### 36.1 Vector Dominates Exact Query

Query:

```text
CASE-2026-000123
```

Hybrid returns semantically similar docs but not exact case.

Fix:

- query classifier;
- exact identifier path;
- lexical boost;
- final rule: exact ID wins.

### 36.2 BM25 Dominates Semantic Query

Query paraphrase misses semantically relevant docs.

Fix:

- semantic retriever candidate size;
- RRF/linear tuning;
- better embeddings;
- query expansion;
- evaluation set.

### 36.3 RAG Uses Stale Source

Fix:

- source freshness metadata;
- filter superseded docs;
- embedding lag monitoring;
- prefer latest authoritative source.

### 36.4 Permission Leak Through Context

Fix:

- mandatory permission filters on chunks;
- context assembly permission check;
- security tests.

### 36.5 Reranker Too Slow

Fix:

- reduce rerank window;
- cache carefully;
- async for admin;
- lower model latency;
- rerank only when needed.

### 36.6 Duplicate Chunks Crowd Context

Fix:

- collapse/group;
- max chunks per source;
- diversity rerank.

### 36.7 Good Search, Bad Answer

Retrieval may be good but answer generation flawed.

Fix:

- require citations;
- answer validation;
- abstention;
- prompt constraints;
- source quote checking.

---

## 37. RAG Safety In Regulatory Systems

For regulatory/case-management contexts:

```text
RAG output should assist, not replace official determination.
```

Retrieval safeguards:

- only authoritative sources;
- filter by current/superseded status;
- include citation metadata;
- preserve source dates;
- enforce permission;
- avoid using draft/unapproved documents unless user is allowed;
- distinguish allegation vs finding;
- distinguish active vs closed case;
- distinguish policy vs case precedent.

Answer safeguards:

- cite sources;
- state uncertainty;
- avoid unsupported legal conclusions;
- avoid inventing facts;
- show retrieved evidence;
- allow user to inspect source.

---

## 38. Retrieval For Complex Case Management

Entities:

```text
case
party
allegation
evidence
decision
correspondence
inspection
sanction
appeal
audit record
```

Recommended strategy:

```text
1. Case metadata index:
   lexical/filter/facet for case lookup.

2. Passage index:
   hybrid retrieval for documents/evidence/decisions.

3. Entity index:
   exact + fuzzy for parties/organizations.

4. Policy/legal index:
   high-authority RAG source.

5. Audit index:
   strict structured search, limited semantic assist.
```

Do not mix all content into one giant vector index without metadata and permission boundaries.

---

## 39. Retrieval Plan Example: Case Q&A

Question:

```text
"Why was the sanction increased in this case?"
```

Plan:

```text
1. Identify current case context.
2. Filter to same caseId.
3. Retrieve decision/sanction/reasoning sections.
4. Retrieve relevant evidence summaries.
5. Exclude draft/unapproved notes unless user has permission.
6. Rerank for sanction reasoning.
7. Assemble top passages with page/section citations.
8. Ask LLM to answer only from provided context.
```

This is not broad global search; it is scoped retrieval.

---

## 40. Retrieval Plan Example: Similar Cases

Question:

```text
"Find similar cases involving late disclosure and investor harm."
```

Plan:

```text
1. Lexical retrieve:
   "late disclosure", "investor harm", known legal terms.

2. Semantic retrieve:
   paraphrases of delayed material information disclosure.

3. Filter:
   published/closed cases, same jurisdiction, user permission.

4. Fuse:
   RRF.

5. Rerank:
   severity, factual similarity, recency if appropriate.

6. Group:
   one result per case.

7. Response:
   case card + matched passages + why similar.
```

---

## 41. Retrieval Plan Example: Policy Q&A

Question:

```text
"What is the procedure for escalating an enforcement case?"
```

Plan:

```text
1. Detect policy/procedure intent.
2. Search policy index, not case evidence first.
3. Filter current approved policy only.
4. Retrieve procedure sections.
5. Include version/effective date.
6. If policy not found, do not answer from cases.
```

This prevents RAG from answering policy questions using anecdotal case data.

---

## 42. Anti-Patterns

### 42.1 Pure Vector Search Everywhere

Exact and legal queries suffer.

### 42.2 Hybrid Without Query Classification

All queries get same pipeline; precision and cost degrade.

### 42.3 RRF Without Candidate Window Tuning

Poor recall or unnecessary latency.

### 42.4 Linear Fusion Without Evaluation

Weights become guesswork.

### 42.5 RAG Without Permission-Aware Chunking

Security risk.

### 42.6 RAG Context Without Citations

No auditability.

### 42.7 Embedding Everything Into One Index

Permission, relevance, and source authority become messy.

### 42.8 No Negative Examples

System looks good on demos but fails on subtle legal distinctions.

### 42.9 LLM Receives More Context Than User Can See

Major security violation.

### 42.10 Treating RAG Answer As Source of Truth

The source documents are truth; answer is derived assistance.

---

## 43. Production Readiness Checklist

```text
[ ] Query intent classification exists
[ ] Exact identifier path bypasses vector if needed
[ ] Hybrid strategy selected: RRF/linear/multi-stage
[ ] Candidate windows tuned
[ ] Metadata filters mandatory
[ ] Permission filters mandatory
[ ] Chunking strategy documented
[ ] Chunk metadata supports citation
[ ] Rerank window bounded
[ ] Lexical fallback defined
[ ] RAG abstention behavior defined
[ ] Golden query set exists
[ ] Evaluation split by query type
[ ] Online metrics available
[ ] Retrieval logs are audit-safe
[ ] Feature flags exist
[ ] Security tests cover hits/context/citations
[ ] Freshness and embedding lag monitored
```

---

## 44. Java Service Boundary

Expose domain APIs:

```http
POST /cases/search
POST /cases/similar
POST /cases/ask
POST /policies/ask
POST /evidence/search
```

Do not expose:

```http
POST /_search
```

with arbitrary DSL.

For RAG:

```java
public record AskCaseQuestionCommand(
    String tenantId,
    String userId,
    String caseId,
    String question
) {}
```

Service:

```java
public Answer askCaseQuestion(AskCaseQuestionCommand command) {
    PermissionContext permission = permissionService.build(command.userId());

    RetrievalPlan plan = retrievalPlanner.planForCaseQuestion(command, permission);

    List<RetrievedChunk> chunks = retrievalService.retrieve(plan);

    if (!supportEvaluator.hasSufficientSupport(chunks)) {
        return Answer.insufficientEvidence(chunks);
    }

    return answerGenerator.generate(command.question(), chunks);
}
```

Retrieval is explicit, permission-aware, auditable.

---

## 45. Summary

Hybrid search combines lexical and semantic retrieval to get better robustness than either alone.

Key lessons:

1. BM25 still matters for exactness, identifiers, names, codes, and legal references.
2. Vector search improves semantic recall but can be plausibly wrong.
3. Hybrid search needs fusion strategy.
4. RRF combines ranks and avoids score normalization.
5. Linear fusion gives weighting control but needs normalization and evaluation.
6. `semantic_text` is Elastic's recommended managed workflow for hybrid semantic search.
7. Candidate generation and reranking are separate stages.
8. RAG retrieval must return answer-supporting passages, not just search results.
9. Permission-aware retrieval must happen before context assembly.
10. Chunking, metadata, citation, and freshness determine RAG quality.
11. Evaluation must be split by query type.
12. Regulatory systems need authority, status, auditability, and security controls.

Core mental model:

```text
Hybrid/RAG retrieval is a controlled evidence selection pipeline.
It is not just a search query.
```

---

## 46. What Comes Next

Part 032 will cover:

```text
Relevance Testing, Evaluation, and Continuous Improvement
```

Topics:

- search quality as engineering discipline;
- golden query set;
- judgment list;
- offline relevance evaluation;
- online metrics;
- click-through pitfalls;
- query analytics;
- zero-result analytics;
- A/B testing;
- nDCG, MRR, precision@K, recall@K;
- relevance regression tests;
- search quality review process;
- human-in-the-loop improvement;
- building relevance feedback loop.

---

## References

- Elastic Docs — Hybrid search: https://www.elastic.co/docs/solutions/search/hybrid-search
- Elastic Docs — Hybrid search with semantic_text: https://www.elastic.co/docs/solutions/search/hybrid-semantic-text
- Elastic Docs — Reciprocal rank fusion: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion
- Elastic Docs — RRF retriever: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/rrf-retriever
- Elastic Docs — Linear retriever: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/linear-retriever
- Elastic Docs — Retrievers overview: https://www.elastic.co/docs/solutions/search/retrievers-overview
- Elastic Docs — Ranking and reranking: https://www.elastic.co/docs/solutions/search/ranking
- Elastic Docs — Semantic reranking: https://www.elastic.co/docs/solutions/search/ranking/semantic-reranking
- Elastic Docs — Semantic search: https://www.elastic.co/docs/solutions/search/semantic-search
- Elastic Docs — kNN query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-knn-query
- Elastic Docs — Get started with vector search / RRF example: https://www.elastic.co/docs/solutions/search/get-started/semantic-search


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Vector Search and Semantic Search</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-032.md">Part 032 — Relevance Testing, Evaluation, and Continuous Improvement ➡️</a>
</div>
