# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-032.md

# Part 032 — Relevance Testing, Evaluation, and Continuous Improvement

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Part: `032`  
> Fokus: search relevance evaluation, golden query set, judgment list, offline metrics, online signals, A/B testing, query analytics, relevance regression, dan continuous improvement loop  
> Target pembaca: Java software engineer / tech lead yang ingin mengelola kualitas search secara sistematis, bukan berdasarkan feeling atau demo query.

---

## 0. Posisi Part Ini Dalam Seri

Part 031 membahas hybrid search dan RAG-oriented retrieval. Kita sudah memahami:

```text
BM25 + vector/semantic retrieval + metadata filters + fusion + reranking + context assembly
```

Sekarang pertanyaan besar berikutnya:

```text
Bagaimana kita tahu search kita bagus?
Bagaimana kita tahu perubahan ranking tidak merusak query penting?
Bagaimana kita tahu hybrid search lebih baik daripada BM25?
Bagaimana kita tahu RAG retrieval cukup mendukung jawaban?
Bagaimana kita mengukur improvement dari waktu ke waktu?
```

Search quality tidak boleh diukur dari:

```text
"Menurut saya hasilnya kelihatan bagus."
```

Itu terlalu subjektif dan tidak scalable.

Search quality harus menjadi disiplin engineering:

```text
query logs
→ query classification
→ judgment data
→ offline metrics
→ online metrics
→ regression gates
→ relevance review
→ controlled rollout
→ continuous feedback
```

Part ini adalah fondasi untuk menjadikan search bukan fitur sekali jadi, tetapi sistem yang terus diperbaiki dengan bukti.

---

## 1. Core Thesis

Relevance engineering adalah proses ilmiah berulang:

```text
define intent
collect representative queries
judge expected results
measure current quality
change ranking/retrieval
compare objectively
deploy safely
monitor real behavior
learn from feedback
repeat
```

Tanpa evaluasi, semua perubahan search adalah tebakan.

Tebakan bisa terlihat berhasil pada demo, tetapi gagal pada production query distribution.

Contoh:

```text
Demo query:
"market manipulation"
→ bagus

Production query:
"CASE-2026-00123"
"pt abc"
"late filing article 7"
"why was sanction increased"
"manipulasi pasar"
"MM"
→ banyak edge cases
```

Relevance evaluation memastikan sistem tetap kuat terhadap query nyata.

---

## 2. Mengapa Search Quality Sulit

Search quality sulit karena:

1. User intent ambigu.
2. Banyak query pendek.
3. Banyak query mengandung typo.
4. Exact match dan semantic match berbeda.
5. Domain punya istilah khusus.
6. Data berubah.
7. Mapping/analyzer berubah.
8. Ranking signal berubah.
9. Permission memengaruhi hasil.
10. User feedback bias.
11. Satu metric tidak cukup.
12. “Relevant” sering bertingkat, bukan binary.
13. RAG butuh answer support, bukan hanya relevant document.

Karena itu, evaluasi harus multi-layer.

---

## 3. Search Quality Dimensions

Search quality bukan hanya ranking.

Dimensi penting:

| Dimension | Question |
|---|---|
| Recall | Apakah dokumen relevan ditemukan? |
| Precision | Apakah top results benar-benar relevan? |
| Ranking | Apakah hasil paling penting muncul di atas? |
| Exactness | Apakah identifier/legal reference match tepat? |
| Freshness | Apakah update terbaru muncul? |
| Coverage | Apakah semua entity/document type tercakup? |
| Security | Apakah hanya hasil yang boleh dilihat muncul? |
| Diversity | Apakah hasil tidak duplikatif? |
| Facet correctness | Apakah count/filter benar? |
| Highlight quality | Apakah snippet membantu? |
| Latency | Apakah kualitas didapat dalam SLA? |
| Explainability | Apakah alasan hasil bisa dipahami? |
| RAG support | Apakah retrieved context cukup untuk jawaban? |

Search yang relevan tetapi lambat tidak cukup. Search yang cepat tetapi leak data gagal total.

---

## 4. Offline vs Online Evaluation

### 4.1 Offline Evaluation

Offline evaluation memakai dataset tetap:

```text
query → expected relevant docs/passages → metric
```

Kelebihan:

- repeatable;
- cocok untuk regression test;
- bisa dijalankan sebelum deploy;
- membandingkan ranking model;
- aman.

Kekurangan:

- dataset bisa stale;
- judgment mahal;
- belum tentu mewakili semua query nyata;
- tidak menangkap UX penuh.

### 4.2 Online Evaluation

Online evaluation memakai perilaku user nyata:

```text
clicks
dwell time
query reformulation
zero result
conversion/task completion
feedback
```

Kelebihan:

- mencerminkan production;
- menangkap behavior nyata;
- useful untuk continuous improvement.

Kekurangan:

- biased;
- noisy;
- butuh traffic;
- bisa dipengaruhi UI;
- tidak selalu berarti relevance;
- perlu privacy/security governance.

Mature search system memakai keduanya.

---

## 5. Golden Query Set

Golden query set adalah kumpulan query penting dengan expected behavior.

Contoh:

```json
{
  "queryId": "Q-001",
  "query": "CASE-2026-000123",
  "intent": "EXACT_IDENTIFIER",
  "expectedTop1": "case-123",
  "critical": true
}
```

Golden query set dipakai untuk:

- regression testing;
- relevance tuning;
- analyzer changes;
- hybrid/vector evaluation;
- release gate;
- migration validation;
- RAG retrieval test.

---

## 6. Query Categories

Golden set harus mencakup query classes.

Untuk search engine Elasticsearch enterprise:

```text
exact_identifier
entity_name
legal_reference
full_text_keyword
semantic_paraphrase
multilingual
typo
acronym
short_query
long_natural_language
faceted_filter_query
permission_sensitive
negative_no_result
freshness_sensitive
RAG_answerable
RAG_unanswerable
```

Untuk regulatory/case management:

```text
case_number
party_name
investigator_name
allegation_type
regulation_article
sanction_type
decision_reference
legal_hold
closed_case
active_case
sensitive_case
cross_tenant_case
appeal_status
escalation_status
audit_query
```

Jika golden set hanya berisi natural language happy path, ia tidak melindungi production.

---

## 7. Query Intent Metadata

Setiap query sebaiknya punya metadata:

```json
{
  "queryId": "Q-042",
  "query": "issuer concealed liquidity deterioration",
  "intent": "SEMANTIC_PARAPHRASE",
  "language": "en",
  "domain": "enforcement",
  "criticality": "high",
  "userRole": "investigator",
  "tenant": "tenant-a",
  "filters": {
    "status": "PUBLISHED"
  },
  "notes": "Should retrieve cases about late disclosure of financial deterioration."
}
```

Metadata memungkinkan evaluasi per segment:

```text
nDCG@10 for semantic_paraphrase
MRR for exact_identifier
permission pass rate for sensitive queries
recall@20 for RAG retrieval
```

Jangan hanya lihat aggregate score.

---

## 8. Judgment Lists

Judgment list adalah daftar dokumen/passages yang dinilai relevansinya untuk sebuah query.

Format:

```json
{
  "queryId": "Q-042",
  "judgments": [
    {
      "docId": "case-123",
      "grade": 3,
      "reason": "Directly about concealed liquidity deterioration."
    },
    {
      "docId": "case-456",
      "grade": 2,
      "reason": "Related late disclosure but different risk category."
    },
    {
      "docId": "case-789",
      "grade": 0,
      "reason": "Late payment, not late disclosure."
    }
  ]
}
```

Grades:

```text
0 = irrelevant
1 = marginally relevant
2 = relevant
3 = highly relevant / ideal
```

For exact identifier queries, use stricter:

```text
expectedTop1 must match.
```

---

## 9. Judgment Quality

Judgment quality menentukan kualitas evaluasi.

Problems:

- inconsistent judges;
- ambiguous query intent;
- outdated judgments;
- missing relevant docs;
- bias toward current ranking;
- insufficient negative examples;
- no domain expert review.

Mitigation:

- judgment guidelines;
- multiple judges for critical queries;
- adjudication process;
- refresh judgments periodically;
- blind evaluation when possible;
- include negative examples.

---

## 10. Pooling Strategy

Untuk membuat judgment set, gunakan pooling:

```text
Run multiple retrieval systems:
- current BM25
- new analyzer
- vector search
- hybrid RRF
- synonym-expanded query
- domain expert suggestions

Take union of top N results.
Judge pooled candidates.
```

Kenapa?

Jika Anda hanya judge hasil sistem saat ini, Anda tidak tahu apakah sistem baru menemukan dokumen relevan yang belum pernah muncul.

Pooling membantu membuat evaluation set lebih fair.

---

## 11. Offline Metrics

### 11.1 Precision@K

```text
Precision@K = relevant results in top K / K
```

Useful for:

- top results quality;
- search UI;
- RAG context precision.

Example:

```text
Top 5 results: relevant, relevant, irrelevant, relevant, irrelevant
Precision@5 = 3/5 = 0.6
```

### 11.2 Recall@K

```text
Recall@K = relevant results in top K / total known relevant results
```

Useful for:

- candidate generation;
- RAG retrieval;
- semantic search.

### 11.3 MRR

Mean Reciprocal Rank:

```text
1 / rank of first relevant result
```

Useful for:

- exact lookup;
- known-item search.

If first relevant result rank 1:

```text
MRR contribution = 1.0
```

If rank 5:

```text
MRR contribution = 0.2
```

### 11.4 nDCG@K

Normalized Discounted Cumulative Gain supports graded relevance.

It rewards:

- highly relevant docs;
- appearing higher in ranking.

Useful for general search ranking.

### 11.5 Hit Rate@K

```text
Did at least one relevant item appear in top K?
```

Useful for RAG:

```text
Did retrieval get at least one supporting passage?
```

---

## 12. Metric Choice By Query Type

| Query Type | Primary Metric |
|---|---|
| Exact identifier | Top-1 accuracy, MRR |
| Entity name | MRR, Precision@10 |
| Natural language | nDCG@10, Recall@20 |
| Similar cases | Recall@20, nDCG@10 |
| RAG answerable | HitRate@K, Answer Support Rate |
| RAG unanswerable | False Support Rate |
| Permission-sensitive | Leak rate = 0 required |
| Facet/filter query | Count correctness, Precision@K |
| Autocomplete | suggestion MRR, prefix success rate |

Do not use one metric for all query classes.

---

## 13. Exact Query Metrics

For exact identifiers:

```text
case number
document number
legal article
party registration number
```

Use hard gates:

```text
Top-1 accuracy must be 100% for critical exact identifiers.
```

If not, search is broken.

Example gate:

```text
exact_case_number_top1_accuracy >= 0.999
critical_case_number_failures = 0
```

Semantic/vector scoring should never push exact case match below fuzzy/semantic match.

---

## 14. RAG Retrieval Metrics

RAG retrieval needs additional metrics:

### 14.1 Answer Support Rate

```text
% of questions where retrieved passages contain enough information to answer
```

### 14.2 Citation Accuracy

```text
% of generated citations that actually support the answer claim
```

### 14.3 Context Precision

```text
How much retrieved context is actually useful?
```

### 14.4 Context Recall

```text
Were all necessary evidence pieces retrieved?
```

### 14.5 False Support Rate

For unanswerable questions:

```text
% where retrieval/LLM incorrectly produces answer
```

For regulatory systems, false support is dangerous.

---

## 15. Permission Evaluation

Security evaluation is not normal relevance evaluation.

Requirement:

```text
unauthorized result count = 0
unauthorized facet leak = 0
unauthorized highlight leak = 0
unauthorized suggestion leak = 0
unauthorized RAG context leak = 0
```

Test matrix:

```text
user with access
user without access
cross-tenant user
admin user
external auditor
restricted case
legal hold case
draft document
deleted/redacted document
```

Every relevance test for enterprise search should have permission variants.

---

## 16. Freshness Evaluation

Freshness-sensitive queries test whether updates are searchable within SLA.

Example:

```text
1. Update case status in source.
2. Wait freshness SLA window.
3. Query for new status.
4. Verify old status no longer appears.
```

Metrics:

```text
indexing_to_searchable_lag_p95
stale_result_rate
delete_visibility_lag
permission_update_lag
embedding_lag
```

Freshness matters especially for:

- active cases;
- permission changes;
- status changes;
- legal holds;
- sanctions;
- deleted/redacted docs.

---

## 17. Zero-Result Analytics

Zero-result queries can mean:

1. User searched for nonexistent thing.
2. Search did not understand synonym/paraphrase.
3. Typo handling missing.
4. Data not indexed.
5. Permission filter too strict.
6. Query parser bug.
7. Analyzer issue.
8. User intent outside corpus.

Track:

```text
zero_result_rate
zero_result_by_query_type
zero_result_by_tenant
zero_result_after_deploy
zero_result_top_queries
zero_result_with_reformulation
```

Example improvement workflow:

```text
Top zero-result query: "late disclosure"
But relevant docs use "delayed disclosure"
→ add synonym or semantic/hybrid strategy
→ verify golden query
```

---

## 18. Query Reformulation

User reformulates when first query fails.

Pattern:

```text
query 1: "late filing"
query 2: "late disclosure"
query 3: "failure to disclose"
```

This indicates vocabulary mismatch.

Track:

```text
session query reformulation rate
time-to-success
query chain
zero-result followed by successful query
```

This helps build synonyms, semantic models, or UX suggestions.

---

## 19. Click Metrics

Click-through can indicate relevance, but it is biased.

Bias examples:

- top position gets more clicks;
- attractive titles get clicks;
- user clicks wrong result then back;
- no-click can mean snippet answered query;
- mandatory workflows distort behavior.

Useful signals:

```text
click@position
first_click_rank
dwell_time
short_click
long_click
result_save/bookmark
open_source_document
```

Use click metrics as weak signals, not absolute relevance labels.

---

## 20. Human Feedback

Explicit feedback:

```text
thumbs up/down
"result not relevant"
"missing result"
"answer unsupported"
"wrong citation"
```

For enterprise search, explicit feedback from expert users can be very valuable.

But:

- volume may be low;
- feedback may be subjective;
- need triage process;
- should map feedback to query/doc/judgment.

Workflow:

```text
feedback item
→ review
→ classify
→ update judgment/golden set
→ adjust search
→ validate
```

---

## 21. A/B Testing Search

A/B testing compares search variants on real users.

Variants:

```text
A = current BM25
B = BM25 + synonyms
C = hybrid RRF
D = hybrid + reranker
```

Online metrics:

```text
click-through
first click rank
task success
query reformulation
zero-result rate
latency
user satisfaction
support tickets
```

Cautions:

- do not A/B security filters casually;
- do not expose lower-quality search to critical workflows without guardrails;
- sample size matters;
- latency and relevance both count;
- exact identifier queries should not be randomized if baseline correctness is required.

For regulated systems, canary/internal testing may be safer than broad A/B.

---

## 22. Interleaving

Interleaving merges results from two rankers into one list to infer preference from clicks.

High-level idea:

```text
ranker A results + ranker B results
→ interleaved list
→ user clicks
→ infer which ranker contributed clicked docs
```

It can be more sensitive than A/B for ranking comparison, but harder to implement correctly.

Use only when you have enough traffic and strong experimentation infrastructure.

---

## 23. Relevance Regression Testing

Every search change should run regression tests.

Changes requiring regression:

```text
mapping change
analyzer change
synonym update
query DSL change
ranking boost change
hybrid fusion change
vector model change
chunking change
permission filter change
index migration
Elasticsearch version upgrade
```

Regression output:

```text
before score
after score
delta
critical query failures
top-K diff
latency diff
permission failures
```

Gate example:

```text
critical exact queries must pass 100%
permission tests must pass 100%
nDCG@10 must not drop > 2%
p95 latency must not increase > 20%
zero-result rate must not increase > threshold
```

---

## 24. Top-K Diff Review

When ranking changes, inspect top-K diff.

Example:

```text
Query: market manipulation

Before:
1. case-100
2. case-200
3. case-300

After:
1. case-900
2. case-100
3. case-200
```

Questions:

```text
Is case-900 actually better?
Was it previously missing?
Did boost over-prioritize recency?
Did permission/filter change?
Did analyzer/synonym expand too much?
```

Top-K diff helps humans understand score changes.

---

## 25. Relevance Test Harness Architecture

Components:

```text
QuerySetRepository
JudgmentRepository
SearchVariantRunner
MetricCalculator
DiffReporter
RegressionGate
ReportPublisher
```

Flow:

```text
load query set
for each variant:
  run searches
  collect top K
  calculate metrics
compare variants
apply gates
publish report
```

Run modes:

```text
local dev
CI
staging
pre-prod
shadow production
post-deploy monitoring
```

---

## 26. Java Test Harness Sketch

Data structures:

```java
public record EvaluationQuery(
    String queryId,
    String query,
    QueryIntent intent,
    Map<String, Object> filters,
    boolean critical
) {}

public record Judgment(
    String queryId,
    String documentId,
    int grade
) {}

public record SearchVariant(
    String name,
    SearchStrategy strategy
) {}
```

Runner:

```java
public EvaluationReport evaluate(
    List<EvaluationQuery> queries,
    List<SearchVariant> variants
) {
    Map<String, List<SearchResult>> results = new HashMap<>();

    for (SearchVariant variant : variants) {
        for (EvaluationQuery query : queries) {
            List<SearchResult> topK = variant.strategy().search(query, 20);
            results.put(variant.name() + ":" + query.queryId(), topK);
        }
    }

    return metricCalculator.calculate(results, judgments);
}
```

Metrics:

```java
public record QueryMetrics(
    String queryId,
    double precisionAt10,
    double recallAt20,
    double ndcgAt10,
    double mrr,
    boolean criticalPass
) {}
```

---

## 27. Synthetic vs Real Query Sets

### Synthetic Queries

Created by engineers/domain experts.

Pros:

- cover edge cases;
- include critical scenarios;
- can be designed before launch.

Cons:

- may not match user behavior.

### Real Queries

Collected from production logs.

Pros:

- representative;
- reveal unexpected behavior;
- show query distribution.

Cons:

- privacy concerns;
- needs anonymization;
- missing intent labels;
- can contain sensitive data.

Best practice:

```text
golden set = critical synthetic + sampled anonymized real queries + feedback-derived cases
```

---

## 28. Privacy and Query Logs

Search logs can be sensitive.

Queries may contain:

- personal names;
- case numbers;
- confidential allegations;
- company names;
- legal strategy;
- investigative terms.

Controls:

```text
redaction
access control
retention policy
query hashing/fingerprinting
separate restricted analytics store
PII classification
audit access
```

Do not dump raw queries into broad observability tools without governance.

---

## 29. Synonym Evaluation

Synonyms can improve recall and damage precision.

Example:

```text
"late filing" ↔ "late disclosure"
```

May be good.

But:

```text
"appeal" ↔ "complaint"
```

May be wrong depending legal domain.

Synonym change evaluation:

```text
1. Identify affected queries.
2. Run before/after.
3. Check precision loss.
4. Check recall gain.
5. Review top-K diff.
6. Monitor zero-result rate.
```

Synonyms should be versioned and tested.

---

## 30. Analyzer Evaluation

Analyzer changes can affect everything.

Test:

```text
_tokenization examples
exact identifier preservation
acronyms
names
Indonesian/English terms
legal article references
hyphenated terms
punctuation
case sensitivity
diacritics
stemming side effects
```

Run `_analyze` snapshots and query-level regression.

Analyzer tests should be part of CI.

---

## 31. Vector/Embedding Evaluation

For vector search:

```text
model comparison
dimension comparison
chunking comparison
similarity metric comparison
k/num_candidates tuning
hybrid fusion comparison
reranker comparison
```

Metrics by query type:

```text
semantic_paraphrase_recall@20
exact_identifier_mrr
rag_hit_rate@10
multilingual_ndcg@10
negative_false_positive_rate
```

Important:

```text
A model that improves paraphrase may hurt exact legal distinction.
```

Evaluate both.

---

## 32. RAG Evaluation

RAG evaluation has two layers:

### 32.1 Retrieval Evaluation

```text
Did we retrieve supporting context?
```

Metrics:

- hit rate@K;
- context recall;
- context precision;
- citation candidate quality.

### 32.2 Answer Evaluation

```text
Did the generated answer correctly use the context?
```

Metrics:

- factual correctness;
- citation accuracy;
- answer completeness;
- abstention correctness;
- unsupported claim rate;
- harmful/confidential leakage.

Do not evaluate only final answer. If answer is wrong, you need to know whether retrieval or generation failed.

---

## 33. Answerability Classification

For RAG, classify questions:

```text
answerable_from_index
partially_answerable
not_answerable
requires_external_source
requires_human_judgment
permission_blocked
ambiguous
```

Expected behavior differs.

For `not_answerable`:

```text
system should abstain or say insufficient evidence.
```

Metric:

```text
false_answer_rate for unanswerable queries
```

This is crucial for trust.

---

## 34. Continuous Improvement Loop

A mature search quality loop:

```text
1. Collect query logs and feedback.
2. Identify failing query classes.
3. Add representative queries to golden set.
4. Add or update judgments.
5. Design improvement.
6. Run offline evaluation.
7. Run latency/security tests.
8. Canary or A/B test.
9. Monitor online metrics.
10. Promote or rollback.
11. Document learning.
```

Every production issue should strengthen the test set.

---

## 35. Query Analytics Workflow

Weekly/monthly review:

```text
top queries
top zero-result queries
top reformulated queries
slow queries
queries with low click/success
queries with high support tickets
permission-denied patterns
new vocabulary
new acronyms
multilingual queries
```

Actions:

- add synonym;
- update analyzer;
- improve entity extraction;
- add facet;
- improve ranking;
- add autocomplete suggestion;
- fix data indexing;
- add golden query.

---

## 36. Relevance Governance

Define ownership:

```text
Search owner
Domain expert
Backend/search engineer
Product owner
Security/compliance reviewer
Data/indexing owner
```

For changes:

```text
ranking boost changes need review
synonym changes need review
permission filter changes need security review
RAG source changes need domain review
embedding model change needs evaluation
```

Without governance, relevance becomes accidental.

---

## 37. Release Process For Search Changes

Suggested process:

```text
1. Change proposal
2. Expected impact
3. Offline evaluation
4. Performance benchmark
5. Security test
6. Golden query diff
7. Canary/shadow
8. Rollout
9. Monitoring
10. Retrospective
```

Template:

```markdown
# Search Change Proposal

## Change
Increase title boost from 3 to 5.

## Hypothesis
Known-item and short title queries improve.

## Risk
Long-body conceptual queries may lose recall.

## Evaluation
- exact identifier unchanged
- title query MRR +4%
- semantic paraphrase nDCG -1%

## Rollout
10% internal users for 2 days.

## Rollback
Feature flag ranking.titleBoost=3.
```

---

## 38. Search Quality Dashboard

Dashboard sections:

```text
Offline metrics:
- nDCG@10 by query type
- MRR exact/entity
- recall@20 semantic
- RAG hit rate
- permission pass rate

Online metrics:
- zero-result rate
- click-through / first click rank
- query reformulation
- latency
- feedback negative rate
- top failed queries

Operational:
- slow query fingerprints
- embedding lag
- indexing freshness
- DLQ
```

Quality and operations must be seen together.

---

## 39. Failure Mode: Metric Gaming

A metric can be improved while user experience worsens.

Examples:

```text
Increase recall@20 by returning many marginal docs
but precision@5 drops.

Increase click-through by making snippets vague
but users bounce.

Improve average nDCG
but exact identifier queries fail.

Improve RAG answer rate
but unsupported claim rate rises.
```

Use balanced metrics and critical gates.

---

## 40. Failure Mode: Overfitting Golden Set

If you tune only to golden queries, you may overfit.

Mitigation:

- holdout query set;
- refresh query set;
- include real query samples;
- use query categories;
- human review;
- online validation.

Golden set is a guardrail, not entire truth.

---

## 41. Failure Mode: Ignoring Negative Examples

Semantic/hybrid search often looks great until negative examples appear.

Example:

```text
Query: "late disclosure"
Must not return: "late payment"
```

Include `mustNotReturn` judgments.

Metric:

```text
false_positive_rate@K
```

For legal/regulatory search, subtle distinctions matter.

---

## 42. Failure Mode: Aggregate Metric Hides Critical Regression

Example:

```text
overall nDCG@10 +3%
exact case number top1 -10%
```

This is not acceptable.

Always segment:

- exact identifiers;
- entity names;
- semantic queries;
- RAG;
- permission-sensitive;
- critical workflows.

---

## 43. Production Readiness Checklist

```text
[ ] Query categories defined
[ ] Golden query set exists
[ ] Judgment guidelines written
[ ] Critical exact queries included
[ ] Permission-sensitive queries included
[ ] Negative examples included
[ ] RAG answerable/unanswerable included
[ ] Offline metrics implemented
[ ] Regression gates configured
[ ] Top-K diff report available
[ ] Query logs governed for privacy
[ ] Online metrics dashboard exists
[ ] Feedback triage process exists
[ ] Search changes have rollout/rollback plan
[ ] Domain expert review path exists
```

---

## 44. Example: Evaluating Hybrid Search

Hypothesis:

```text
Hybrid RRF improves natural language queries without hurting exact identifiers.
```

Variants:

```text
A = BM25 current
B = BM25 + vector RRF
C = BM25 + vector linear fusion
```

Metrics:

```text
exact_identifier_top1
entity_name_mrr
semantic_paraphrase_recall@20
semantic_paraphrase_ndcg@10
permission_leak_count
p95_latency
```

Gate:

```text
exact_identifier_top1 must not drop
permission leak must be zero
p95 latency must stay under SLO
semantic recall improves by >= 5%
```

Decision:

- promote B if quality improves and latency acceptable;
- reject if exact regression;
- tune if latency high.

---

## 45. Example: Evaluating RAG Retrieval

Question:

```text
"What sanctions were imposed for late disclosure?"
```

Expected support:

```text
published decision sections mentioning sanction
policy section defining sanction authority
case summary if relevant
```

Metrics:

```text
retrieval hit@10
context precision
citation support
answer correctness
unsupported claim count
```

Failure analysis:

```text
No support retrieved:
  retrieval failure.

Support retrieved but answer wrong:
  generation/prompt failure.

Wrong source retrieved:
  metadata/filter/ranking failure.

Restricted source retrieved:
  security failure.
```

---

## 46. Exercises

### Exercise 1 — Build Golden Query Set

Create 30 golden queries for regulatory case search:

- 5 exact case numbers;
- 5 party names;
- 5 legal references;
- 5 semantic paraphrases;
- 5 permission-sensitive;
- 5 RAG questions.

Define expected metrics for each category.

### Exercise 2 — Choose Metrics

For each query type, choose primary and secondary metrics:

1. exact case number;
2. similar cases;
3. policy question;
4. party name;
5. semantic paraphrase;
6. permission denied query;
7. autocomplete.

### Exercise 3 — Regression Gate

Design release gate for analyzer change affecting Indonesian + English mixed content.

Include:

- analyzer tests;
- exact query tests;
- nDCG tests;
- latency;
- permission.

### Exercise 4 — RAG Failure Classification

Given answer is wrong, classify root cause:

```text
Retrieved passages are irrelevant.
Retrieved passages are relevant but stale.
Retrieved passages are restricted.
Retrieved passages support answer but LLM ignored them.
Retrieved no passages but LLM answered anyway.
```

Define mitigation for each.

---

## 47. Summary

Relevance testing turns search quality from subjective opinion into engineering discipline.

Key lessons:

1. Search quality has many dimensions: precision, recall, ranking, freshness, security, latency, RAG support.
2. Offline evaluation gives repeatable regression control.
3. Online evaluation reveals real user behavior but is biased/noisy.
4. Golden query sets must cover query classes, not just demo queries.
5. Judgment lists need graded relevance and negative examples.
6. Metrics must match query intent.
7. Exact identifiers need hard top-1 gates.
8. Permission-sensitive tests require zero leaks.
9. RAG needs retrieval evaluation and answer evaluation.
10. Query logs, zero-result analytics, feedback, and reformulation drive improvement.
11. Every search change needs offline evaluation, rollout, monitoring, and rollback.
12. Aggregate metrics can hide critical regressions.

Core mental model:

```text
Search relevance is not a one-time tuning task.
It is a continuous measurement and improvement system.
```

---

## 48. What Comes Next

Part 033 will cover:

```text
Elasticsearch in Enterprise / Regulatory Case Management Systems
```

Topics:

- domain architecture;
- case lifecycle search;
- permission-aware search;
- entity/document/evidence indexing;
- auditability;
- legal hold;
- regulatory metadata;
- workflow search;
- investigator search UX;
- enforcement case search;
- RAG in regulated environment;
- end-to-end architecture decisions.

---

## References

- Elastic Docs — Search relevance: https://www.elastic.co/docs/solutions/search/search-relevance
- Elastic Docs — Tuning search relevance: https://www.elastic.co/docs/solutions/search/full-text/tune-relevance
- Elastic Docs — Query rules: https://www.elastic.co/docs/solutions/search/query-rules
- Elastic Docs — Ranking and reranking: https://www.elastic.co/docs/solutions/search/ranking
- Elastic Docs — Semantic reranking: https://www.elastic.co/docs/solutions/search/ranking/semantic-reranking
- Elastic Docs — Search analytics behavior analytics: https://www.elastic.co/docs/solutions/search/behavioral-analytics
- Elastic Docs — Reciprocal Rank Fusion: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion
- Elastic Docs — Hybrid search: https://www.elastic.co/docs/solutions/search/hybrid-search
- Elastic Docs — Search templates: https://www.elastic.co/docs/solutions/search/search-templates
- Elastic Docs — Search profile API: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/search-profile

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-031.md">⬅️ Part 031 — Hybrid Search and RAG-Oriented Retrieval</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-033.md">Part 033 — Elasticsearch in Enterprise / Regulatory Case Management Systems ➡️</a>
</div>
