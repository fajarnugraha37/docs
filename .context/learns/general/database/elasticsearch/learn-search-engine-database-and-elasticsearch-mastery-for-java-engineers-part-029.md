
# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-029.md

# Part 029 — Advanced Search Features

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Part: `029`  
> Fokus: fitur Elasticsearch lanjutan, kapan dipakai, cost model, traps, dan desain production-grade  
> Target pembaca: Java software engineer / tech lead yang sudah paham mapping, query DSL, relevance, indexing, operations, dan ingin memakai fitur lanjutan secara sengaja, bukan accidental complexity.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 028 kita sudah membahas:

- mental model search;
- Lucene dan Elasticsearch internals;
- modeling, mapping, analyzer;
- Query DSL, relevance, filtering, faceting, pagination;
- ingestion, consistency, Java integration;
- security dan permission-aware search;
- performance, capacity, lifecycle;
- migration, observability, failure response, backup/restore/repair.

Part 029 membahas **advanced search features**.

Fitur yang dibahas:

- percolator query;
- more-like-this;
- runtime fields;
- script query / script fields;
- field collapsing;
- inner hits;
- rescore;
- rank feature;
- join field / parent-child;
- geo search;
- shape search;
- search templates;
- async search;
- cross-cluster search;
- terms lookup;
- routing/preference;
- practical feature-selection matrix;
- traps dan anti-patterns.

Tujuan utama bukan menghafal API. Tujuan utama adalah menjawab:

```text
Kapan fitur ini menyelesaikan problem yang benar?
Kapan fitur ini sebaiknya dihindari?
Apa cost model-nya?
Apa risiko production-nya?
Bagaimana cara membungkusnya di Java service agar aman?
```

---

## 1. Core Thesis

Advanced Elasticsearch features adalah **specialized tools**, bukan default architecture.

Banyak fitur terlihat menarik:

```text
percolator
runtime fields
script score
join field
collapse
inner hits
rescore
async search
cross-cluster search
```

Tetapi setiap fitur membawa trade-off:

- latency;
- memory;
- query complexity;
- mapping complexity;
- operational risk;
- security risk;
- migration complexity;
- test complexity;
- debugging complexity.

Top-tier engineer tidak bertanya:

```text
Bisa pakai fitur X?
```

Ia bertanya:

```text
Apakah problem ini memang membutuhkan fitur X,
atau bisa diselesaikan lebih sederhana dengan modeling/index design/query design?
```

Fitur lanjutan yang dipakai tanpa governance akan membuat search system sulit dipahami, sulit dioperasikan, dan sulit diaudit.

---

## 2. Advanced Feature Decision Framework

Sebelum memilih fitur lanjutan, gunakan pertanyaan ini:

```text
1. Apakah problem ini query-time atau index-time?
2. Apakah computation bisa dipindah ke indexing pipeline?
3. Apakah user membutuhkan real-time behavior?
4. Apakah hasil harus explainable?
5. Apakah fitur ini memengaruhi permission/security?
6. Apakah fitur ini mengubah ranking?
7. Apakah workload interactive atau async?
8. Apakah data volume kecil, sedang, atau besar?
9. Apakah cost feature tumbuh linear, superlinear, atau per-shard?
10. Apakah bisa diuji dengan golden query?
11. Apakah bisa dimonitor?
12. Apakah ada fallback/feature flag?
```

Rule of thumb:

> Jika computation bisa dilakukan saat indexing dengan biaya wajar, jangan buru-buru melakukan computation mahal saat query.

---

## 3. Feature Map

| Feature | Solves | Main Risk |
|---|---|---|
| Percolator | Find stored queries matching new document | query registry complexity, scoring cost |
| More-like-this | Find similar docs/text lexically | noisy similarity, explainability |
| Runtime fields | Compute field at query time | latency, hidden cost |
| Script query/fields | Custom query/fetch computation | slow search, sandbox/caching complexity |
| Collapse | Group results by field | total groups unknown, top-hit semantics |
| Inner hits | Show matching nested/child docs | fetch cost, response size |
| Rescore | Improve top-K precision | window tuning, added latency |
| Rank feature | Efficient numeric ranking signal | sparse/bias risk |
| Join field | Parent-child relation in same index | query overhead, routing constraint |
| Geo search | distance/shape/location query | mapping precision, spatial cost |
| Search template | Reusable parameterized queries | template governance |
| Async search | Long-running query UX | task/resource management |
| Cross-cluster search | Search remote clusters | latency, security, partial failure |
| Terms lookup | Query terms from document | _source dependency, hidden lookup cost |
| Routing/preference | Control shard targeting/cache locality | hot shard, routing mistakes |

---

## 4. Percolator Query

### 4.1 Mental Model

Normal search:

```text
query → matches documents
```

Percolator search:

```text
document → matches stored queries
```

This is reverse search.

Use case:

```text
Users save alerts:
- notify me if a new case mentions "market manipulation"
- notify me if a filing mentions company X
- notify me if a new enforcement action matches sector Y
```

Then a new document arrives:

```text
new case document → find which stored alert queries match it
```

This is the opposite direction of normal search.

---

## 4.2 Percolator Mapping

You need a `percolator` field type.

Example:

```json
PUT /case-alert-queries
{
  "mappings": {
    "properties": {
      "alertId": {
        "type": "keyword"
      },
      "ownerUserId": {
        "type": "keyword"
      },
      "tenantId": {
        "type": "keyword"
      },
      "enabled": {
        "type": "boolean"
      },
      "query": {
        "type": "percolator"
      },
      "createdAt": {
        "type": "date"
      }
    }
  }
}
```

Store query:

```json
PUT /case-alert-queries/_doc/alert-001
{
  "alertId": "alert-001",
  "ownerUserId": "user-123",
  "tenantId": "tenant-a",
  "enabled": true,
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "market manipulation" }}
      ],
      "filter": [
        { "term": { "tenantId": "tenant-a" }}
      ]
    }
  },
  "createdAt": "2026-06-22T00:00:00Z"
}
```

Percolate incoming document:

```json
GET /case-alert-queries/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "enabled": true }},
        { "term": { "tenantId": "tenant-a" }},
        {
          "percolate": {
            "field": "query",
            "document": {
              "tenantId": "tenant-a",
              "title": "Investigation into suspected market manipulation",
              "body": "The authority opened a new investigation..."
            }
          }
        }
      ]
    }
  }
}
```

---

## 4.3 When Percolator Is Right

Use percolator when:

- users/admins define saved search alerts;
- new documents must trigger matching rules;
- rule/query count is meaningful but controlled;
- matching is lexical/search-like, not arbitrary business logic;
- latency can tolerate percolation cost;
- queries can be validated and governed.

Good examples:

```text
case alert subscriptions
compliance watchlists
news/document alerting
regulatory keyword alerts
new evidence matches saved investigation criteria
```

---

## 4.4 When Percolator Is Wrong

Avoid percolator if:

- rules are simple exact filters better handled in DB/event processor;
- rules are complex imperative business logic;
- query count is huge and unbounded;
- rules require external service calls;
- permission model differs per target user and is hard to embed;
- you need deterministic rule engine semantics;
- you cannot validate stored queries.

Alternative:

```text
event processor + rule engine
database trigger-like matching
stream processing
dedicated alerting service
```

---

## 4.5 Percolator Cost Model

Percolator stores queries and matches incoming documents against them. Elasticsearch can optimize by extracting terms from stored queries, but scoring can be more expensive because matching/scoring may require evaluating candidate queries.

Guidelines:

- wrap percolate in filter/constant_score if scoring stored queries is unnecessary;
- separate query index from document index for heavier usage;
- validate stored queries at creation time;
- restrict supported query DSL subset;
- filter by tenant/enabled/type before percolation;
- monitor percolation latency;
- avoid allowing arbitrary query_string from users.

---

## 4.6 Java Design for Percolator Alerts

Do not let frontend submit arbitrary Elasticsearch query DSL.

Better:

```java
public record AlertRuleCommand(
    String tenantId,
    String ownerUserId,
    String phrase,
    Set<String> sectors,
    Set<String> severities
) {}
```

Backend builds safe DSL:

```java
Query buildAlertQuery(AlertRuleCommand command) {
    return bool()
        .must(match("title", command.phrase()))
        .filter(term("tenantId", command.tenantId()))
        .filter(terms("sector", command.sectors()))
        .filter(terms("severity", command.severities()));
}
```

Store only generated/validated DSL.

---

## 5. More-Like-This Query

### 5.1 Mental Model

`more_like_this` finds documents similar to provided text or existing documents by selecting representative terms and forming a query.

Normal search:

```text
user query → documents
```

More-like-this:

```text
example document/text → similar documents
```

---

## 5.2 Example

```json
GET /cases-search-read/_search
{
  "query": {
    "more_like_this": {
      "fields": ["title", "summary", "allegationText"],
      "like": [
        {
          "_index": "cases-search-read",
          "_id": "case-123"
        }
      ],
      "min_term_freq": 1,
      "max_query_terms": 25,
      "min_doc_freq": 2
    }
  }
}
```

---

## 5.3 Use Cases

Good for:

- “similar cases”;
- “related documents”;
- investigator discovery;
- case deduplication candidate generation;
- similar complaint reports;
- similar enforcement actions.

---

## 5.4 Risks

More-like-this is lexical similarity, not semantic understanding.

It can be noisy if:

- documents have boilerplate text;
- common legal/regulatory terms dominate;
- field length varies wildly;
- representative terms are not domain-important;
- analyzer is poor;
- stopwords/synonyms not tuned.

Example:

```text
All regulatory cases contain:
"pursuant to article..."
"investigation..."
"authority..."
```

MLT may retrieve documents similar only because they share boilerplate.

---

## 5.5 Production Pattern

Use MLT as candidate generator, not final truth.

```text
MLT candidates
→ filter by tenant/permission/status
→ boost domain signals
→ maybe rescore
→ explain as "similar by text", not "same case"
```

For deduplication, combine with:

- exact identifiers;
- entity matching;
- party matching;
- date proximity;
- vector similarity;
- human review.

---

## 6. Runtime Fields

### 6.1 Mental Model

Runtime fields are computed at query time. They let you expose fields that are not indexed as normal indexed fields.

Example:

```json
GET /cases-search-read/_search
{
  "runtime_mappings": {
    "caseAgeDays": {
      "type": "long",
      "script": {
        "source": "emit((new Date().getTime() - doc['createdAt'].value.toInstant().toEpochMilli()) / 86400000L)"
      }
    }
  },
  "query": {
    "range": {
      "caseAgeDays": {
        "gte": 30
      }
    }
  },
  "fields": ["caseAgeDays"]
}
```

---

## 6.2 When Runtime Fields Are Useful

Good for:

- transitional migration;
- exploratory analysis;
- low-volume admin query;
- computed display field;
- temporary bridge during schema evolution;
- testing derived field before indexing it.

---

## 6.3 When Runtime Fields Are Dangerous

Avoid as core search path when:

- field is used in high-QPS filter;
- field is used in sort;
- field is used in heavy aggregation;
- field requires expensive parsing;
- field reads large `_source`;
- field is central to permission;
- field is needed for autocomplete/relevance.

Runtime fields shift work from indexing time to query time. That can be acceptable for rare queries but dangerous for hot user search.

Rule:

```text
If a field is part of common filter/sort/facet/ranking, index it normally.
```

---

## 7. Script Query and Script Fields

### 7.1 Mental Model

Scripts allow custom computation in query or fetch. They are powerful but can slow search.

Script query:

```json
GET /cases-search-read/_search
{
  "query": {
    "bool": {
      "filter": [
        {
          "script": {
            "script": {
              "source": "doc['riskScore'].value * doc['severityRank'].value > params.threshold",
              "params": {
                "threshold": 100
              }
            }
          }
        }
      ]
    }
  }
}
```

Script field:

```json
GET /cases-search-read/_search
{
  "query": {
    "match": {
      "title": "market manipulation"
    }
  },
  "script_fields": {
    "weightedRisk": {
      "script": {
        "source": "doc['riskScore'].value * params.weight",
        "params": {
          "weight": 1.5
        }
      }
    }
  }
}
```

---

## 7.2 Use Cases

Good for:

- admin/debug computation;
- transitional logic;
- rare calculated fields;
- feature experiments;
- custom scoring in limited top-K via rescore;
- prototyping before indexing field.

---

## 7.3 Risks

- slower search;
- memory pressure;
- hard to cache if parameters vary;
- script complexity grows;
- difficult to test;
- security/sandbox governance;
- hidden coupling to field presence/type;
- runtime failures if fields missing.

Guideline:

```text
Use scripts sparingly.
Move stable computation to indexing pipeline.
```

---

## 8. Field Collapsing

### 8.1 Mental Model

Collapse groups search hits by a single-valued keyword or numeric field and returns top document per group.

Example:

```json
GET /case-documents/_search
{
  "query": {
    "match": {
      "body": "market manipulation"
    }
  },
  "collapse": {
    "field": "caseId"
  },
  "sort": [
    { "_score": "desc" },
    { "lastUpdatedAt": "desc" }
  ]
}
```

Use case:

```text
Search evidence documents but show one result per case.
```

---

## 8.2 Important Semantics

Field collapsing:

- selects top sorted document per collapse key;
- total hits still indicates matching documents before collapse;
- total distinct groups is not directly known from hits total;
- collapse does not affect aggregations;
- collapse field must be single-valued keyword or numeric with doc_values.

This matters for UI.

Bad UI wording:

```text
10,000 cases found
```

when total hits is actually 10,000 matching documents before collapse.

Better:

```text
Showing best matching document per case.
```

If you need exact group count, use cardinality aggregation with approximation or separate strategy.

---

## 8.3 Collapse vs Aggregation Top Hits

Collapse is for search hits grouping.

Aggregation + top_hits/top_metrics is for grouped aggregation-style result.

Use collapse when:

- interactive search results need de-dup/grouping;
- top document per entity is enough;
- pagination requirements are controlled.

Use aggregation when:

- you are building grouped summary;
- you need buckets;
- you need metrics per group;
- result set is analytics-like.

---

## 9. Inner Hits

### 9.1 Mental Model

Inner hits explain which nested object or parent/child document caused a hit.

Example nested parties:

```json
PUT /cases-search-v1
{
  "mappings": {
    "properties": {
      "caseId": { "type": "keyword" },
      "parties": {
        "type": "nested",
        "properties": {
          "name": { "type": "text" },
          "role": { "type": "keyword" }
        }
      }
    }
  }
}
```

Query:

```json
GET /cases-search-read/_search
{
  "query": {
    "nested": {
      "path": "parties",
      "query": {
        "match": {
          "parties.name": "PT Contoh Abadi"
        }
      },
      "inner_hits": {
        "size": 3,
        "_source": ["parties.name", "parties.role"]
      }
    }
  }
}
```

Response includes which nested parties matched.

---

## 9.2 Use Cases

Good for:

- show matched party inside case;
- show matched allegation;
- show matched evidence snippet;
- explain why parent case appeared;
- regulatory review workflows.

---

## 9.3 Risks

- fetch phase cost;
- large response;
- nested source extraction overhead;
- inner hit pagination complexity;
- permission leak if inner objects contain restricted sub-data;
- UI complexity.

Guardrails:

- cap `inner_hits.size`;
- source-filter inner hit fields;
- avoid inner hits for every query unless needed;
- test security at nested-object level.

---

## 10. Rescore

### 10.1 Mental Model

Rescore reranks only top documents from initial retrieval using a more expensive secondary query/algorithm.

Why?

```text
Initial query gets candidate set quickly.
Rescore improves precision on top-K.
```

Example:

```json
GET /cases-search-read/_search
{
  "query": {
    "multi_match": {
      "query": "market manipulation",
      "fields": ["title^3", "summary", "body"]
    }
  },
  "rescore": {
    "window_size": 100,
    "query": {
      "rescore_query": {
        "match_phrase": {
          "body": {
            "query": "market manipulation",
            "slop": 2
          }
        }
      },
      "query_weight": 0.8,
      "rescore_query_weight": 2.0
    }
  }
}
```

---

## 10.2 When Rescore Is Right

Use when:

- initial retrieval is broad;
- you need better top-K precision;
- phrase/proximity/exactness should matter at top;
- expensive ranking should not run on all matches;
- query latency budget can handle second pass.

Good pattern:

```text
BM25 candidate generation
→ phrase/proximity rescore top 100
→ function score or domain boost
```

---

## 10.3 Risks

- bad `window_size`;
- latency increases;
- per-shard behavior matters;
- relevance changes can surprise;
- pagination stability issues if query changes;
- expensive rescore query still hurts under high QPS.

Rule:

```text
Use rescore for top-K precision, not for filtering.
```

Authorization/filtering must happen before rescore.

---

## 11. Rank Feature and Rank Features

### 11.1 Mental Model

`rank_feature` and `rank_features` fields are optimized for numeric signals used in ranking.

Example mapping:

```json
PUT /cases-search-v1
{
  "mappings": {
    "properties": {
      "severityRank": {
        "type": "rank_feature"
      },
      "signals": {
        "type": "rank_features"
      }
    }
  }
}
```

Query:

```json
GET /cases-search-read/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "summary": "market manipulation" }}
      ],
      "should": [
        {
          "rank_feature": {
            "field": "severityRank",
            "boost": 2.0
          }
        },
        {
          "rank_feature": {
            "field": "signals.authorityScore",
            "boost": 1.5
          }
        }
      ]
    }
  }
}
```

---

## 11.2 Use Cases

Good for:

- popularity;
- authority;
- severity;
- quality;
- trust;
- freshness-like derived signal;
- domain priority.

For regulatory systems:

```text
severityRank
casePriority
supervisionImportance
legalHoldImportance
recentActivityScore
```

---

## 11.3 Risks

- sparse signal bias;
- stale signal;
- overboosting business priority;
- signal not explainable;
- users lose trust if text relevance is dominated by hidden score;
- signal drift after migration.

Guidelines:

- cap effect;
- document signal meaning;
- monitor ranking impact;
- test with golden queries;
- avoid using rank feature as permission substitute.

---

## 12. Join Field / Parent-Child

### 12.1 Mental Model

The `join` field creates parent/child relations within documents of the same index.

Example:

```json
PUT /qa-index
{
  "mappings": {
    "properties": {
      "my_join_field": {
        "type": "join",
        "relations": {
          "question": "answer"
        }
      }
    }
  }
}
```

Child documents must be routed to the same shard as parent.

---

## 12.2 Use Cases

Parent-child can be useful when:

- child documents change much more frequently than parent;
- duplicating parent data into all children is too costly;
- you need query parent by child or child by parent;
- relation is one-to-many and large.

Example:

```text
product parent → offer children
case parent → many update/event children
```

But for many search applications, denormalization is better.

---

## 12.3 Why It Is Dangerous

Elastic explicitly warns against using multiple relation levels to replicate relational models because each relation level adds query-time memory and computation overhead. Parent-child also requires routing lineage to same shard.

Risks:

- query overhead;
- routing mistakes;
- shard hot spots;
- complex indexing;
- complex deletes;
- migration complexity;
- hard-to-debug relevance;
- temptation to rebuild relational model inside Elasticsearch.

Rule:

```text
Default to denormalization.
Use join only when update/write amplification makes denormalization clearly worse and relation query is essential.
```

---

## 13. Geo Search

### 13.1 Geo Point

`geo_point` supports:

- distance search;
- bounding box;
- geo shape query;
- distance aggregations;
- grid aggregations;
- distance sorting;
- distance as ranking signal.

Example mapping:

```json
PUT /offices
{
  "mappings": {
    "properties": {
      "officeId": { "type": "keyword" },
      "location": { "type": "geo_point" }
    }
  }
}
```

Distance query:

```json
GET /offices/_search
{
  "query": {
    "bool": {
      "filter": {
        "geo_distance": {
          "distance": "10km",
          "location": {
            "lat": -6.2000,
            "lon": 106.8167
          }
        }
      }
    }
  },
  "sort": [
    {
      "_geo_distance": {
        "location": {
          "lat": -6.2000,
          "lon": 106.8167
        },
        "order": "asc",
        "unit": "km"
      }
    }
  ]
}
```

---

## 13.2 Geo Shape

`geo_shape` is for shapes/polygons/lines and spatial relations such as intersects, contains, within, disjoint.

Use cases:

```text
jurisdiction boundary
regulated area
inspection zone
regional enforcement office coverage
geofenced event search
```

Example:

```json
GET /jurisdictions/_search
{
  "query": {
    "geo_shape": {
      "area": {
        "shape": {
          "type": "envelope",
          "coordinates": [[106.0, -5.8], [107.2, -6.6]]
        },
        "relation": "intersects"
      }
    }
  }
}
```

---

## 13.3 Geo Risks

- coordinate order confusion: longitude/latitude vs latitude/longitude depending format;
- precision assumptions;
- shape complexity;
- large polygon cost;
- dateline/poles edge cases;
- sorting by distance cost;
- mixing relevance and distance incorrectly;
- permission/tenant filtering forgotten.

For case systems, geo is useful but must be legally/domain accurate if tied to jurisdiction.

---

## 14. Search Templates

### 14.1 Mental Model

Search templates let you store parameterized search requests.

Why useful?

- centralized query DSL;
- reduce duplicated query string building;
- safer parameterization;
- easier versioning;
- support controlled query patterns.

Example:

```json
PUT _scripts/case-search-template
{
  "script": {
    "lang": "mustache",
    "source": {
      "query": {
        "bool": {
          "must": [
            {
              "multi_match": {
                "query": "{{query_text}}",
                "fields": ["title^3", "summary", "body"]
              }
            }
          ],
          "filter": [
            { "term": { "tenantId": "{{tenant_id}}" }}
          ]
        }
      },
      "size": "{{size}}"
    }
  }
}
```

Execute:

```json
GET /cases-search-read/_search/template
{
  "id": "case-search-template",
  "params": {
    "query_text": "market manipulation",
    "tenant_id": "tenant-a",
    "size": 20
  }
}
```

---

## 14.2 When Templates Help

Good for:

- stable query patterns;
- multiple services using same query;
- governance;
- limiting DSL variability;
- A/B query versioning;
- avoiding string concatenation.

---

## 14.3 Risks

- hidden logic outside Java code;
- versioning confusion;
- template changes without app deploy;
- insufficient tests;
- complex Mustache logic becomes unreadable;
- security filters accidentally removed.

Guideline:

```text
Treat search templates as code.
Version, review, test, and deploy them intentionally.
```

---

## 15. Async Search

### 15.1 Mental Model

Async search is for long-running searches where user/client should not block a normal request until completion.

Use cases:

- heavy audit query;
- large historical search;
- admin investigation;
- expensive aggregation;
- export-like search;
- cross-cluster query.

Flow:

```text
submit async search
→ receive id
→ poll result
→ retrieve partial/final response
→ delete/expire async search
```

---

## 15.2 When Async Search Is Right

Use when:

- query can take seconds/minutes;
- user expects progress;
- result can be partial;
- workload is admin/analytical;
- you want to avoid gateway/client timeout;
- you can manage task lifecycle.

---

## 15.3 When Async Search Is Wrong

Avoid for normal interactive search.

Bad:

```text
Every /cases/search becomes async because query is too slow.
```

That hides performance problem and worsens UX.

Fix query/model/capacity first.

---

## 15.4 Operational Risks

- task buildup;
- forgotten async result retention;
- heavy cluster load;
- security around result retrieval;
- user polling storm;
- cancellation not handled;
- resource quota per tenant/user missing.

Guardrails:

- limit concurrent async searches;
- enforce timeout/keep_alive;
- authorize result access;
- cancel on user request;
- monitor async search count/duration.

---

## 16. Cross-Cluster Search

### 16.1 Mental Model

Cross-cluster search lets one cluster search remote clusters.

Use cases:

```text
search across regions
search historical archive cluster
search per-business-unit clusters
migration period old+new clusters
central audit search
```

Conceptual query:

```http
GET /local-index,remote-cluster:remote-index/_search
```

---

## 16.2 Benefits

- federated search;
- reduce data duplication;
- support migration;
- isolate workloads;
- query archive and hot cluster together.

---

## 16.3 Risks

- network latency;
- partial failures;
- remote cluster security;
- version compatibility;
- inconsistent mappings;
- inconsistent analyzers;
- relevance score comparability;
- terms lookup limitations across clusters;
- operational complexity.

For regulatory search, cross-cluster search must ensure:

- tenant/security filters applied to all clusters;
- result source cluster is visible/auditable;
- partial result behavior is clear;
- data residency constraints are respected.

---

## 17. Terms Lookup

### 17.1 Mental Model

Terms lookup fetches terms from an existing document and uses them in a `terms` query.

Example:

```json
GET /cases-search-read/_search
{
  "query": {
    "terms": {
      "partyIds": {
        "index": "case-access-lists",
        "id": "user-123",
        "path": "allowedPartyIds"
      }
    }
  }
}
```

Use cases:

- access lists;
- related entity IDs;
- watchlist terms;
- large but managed term sets.

---

## 17.2 Important Constraints

Terms lookup requires `_source` enabled for the lookup document. Elasticsearch also has a default maximum terms count for `terms` query. Cross-cluster search cannot run terms lookup on a remote index.

---

## 17.3 Risks

- hidden lookup cost;
- large term list;
- source dependency;
- stale lookup document;
- permission complexity;
- query cache behavior;
- can become accidental authorization system.

For permission-heavy systems, be cautious. Permission context often belongs in application/security service with carefully bounded ES filter.

---

## 18. Routing and Preference

### 18.1 Search Shard Routing

Elasticsearch chooses shard copies to execute search. Adaptive replica selection uses factors like prior response time, search execution time, and search thread pool queue to reduce latency.

You can influence search routing with `preference`.

Example:

```http
GET /cases-search-read/_search?preference=user-123
```

This can improve cache locality for repeated searches by same user/session.

---

## 18.2 Custom Routing

Index-time routing can place related documents on same shard.

Example:

```http
PUT /cases-search-v1/_doc/case-123?routing=tenant-a
```

Search:

```http
GET /cases-search-v1/_search?routing=tenant-a
```

Potential benefit:

- reduce shard fan-out;
- isolate tenant queries;
- improve performance for tenant-scoped search.

Risk:

- hot shard if tenant skewed;
- routing key mistakes make document hard to find;
- rebalancing harder;
- tenant growth uneven.

Use routing only when access pattern and data distribution justify it.

---

## 19. Intervals Query

Intervals query gives fine-grained control over ordering/proximity of matching terms.

Use case:

```text
legal phrase proximity
regulatory phrase with words near each other
```

Example concept:

```json
GET /cases-search-read/_search
{
  "query": {
    "intervals": {
      "body": {
        "all_of": {
          "ordered": true,
          "intervals": [
            { "match": { "query": "market" }},
            { "match": { "query": "manipulation" }}
          ],
          "max_gaps": 3
        }
      }
    }
  }
}
```

Use when phrase/proximity semantics matter more than simple `match_phrase`.

Risk:

- query complexity;
- relevance tuning complexity;
- performance under broad corpus.

---

## 20. Field Selection: `fields`, `_source`, `docvalue_fields`

Advanced search often fails in fetch phase, not query phase.

Use field retrieval intentionally.

Options:

- `_source`: original JSON document.
- `_source` filtering: subset of original JSON.
- `fields`: mapping-aware retrieval, can retrieve runtime field values.
- `docvalue_fields`: efficient for doc_values fields.
- `stored_fields`: only if stored separately.

Guideline:

```text
Return only what UI needs.
```

For regulatory systems:

```text
Do not return raw _source by default.
Use DTO mapping and source filtering.
Avoid exposing security/internal fields.
```

---

## 21. Feature Selection Matrix

| Requirement | Prefer | Avoid |
|---|---|---|
| Saved alert matching new docs | Percolator | polling all saved searches manually |
| Similar cases | MLT / vector / hybrid | treating MLT as exact duplicate detection |
| Temporary derived field | Runtime field | permanent hot-path runtime computation |
| Custom debug computation | Script field | business-critical filter at scale |
| One result per case | Collapse | assuming total hits = group count |
| Show matched nested party | Inner hits | returning huge nested payloads |
| Improve top-K precision | Rescore | applying expensive scoring to all docs |
| Numeric ranking signal | Rank feature | hidden arbitrary script everywhere |
| Parent-child dynamic children | Join field | modeling relational DB in ES |
| Nearby offices/jurisdiction | Geo point/shape | manual lat/lon filtering in app |
| Central query pattern | Search template | unversioned hidden template changes |
| Long audit query | Async search | making normal search async |
| Multi-region/archive search | Cross-cluster search | ignoring latency/security/mapping mismatch |
| Large term set from doc | Terms lookup | unbounded app-side query expansion |
| Tenant-local search | Routing | routing by skewed tenant blindly |

---

## 22. Advanced Feature Governance

For production, create feature governance:

```text
Allowed:
- match
- multi_match
- term/range/filter
- controlled facets
- controlled highlight
- search_after/PIT
- collapse by allowlisted fields
- inner_hits with limits

Restricted:
- wildcard
- regexp
- fuzzy high expansion
- script query
- runtime field query
- join query
- nested with large inner_hits
- async search
- cross-cluster search

Admin-only:
- query_string
- arbitrary aggregations
- percolator query registration
- search templates update
- reindex/restore/admin APIs
```

Expose domain-level API, not raw Elasticsearch DSL.

---

## 23. Java Abstraction Pattern

Do not model advanced features as raw JSON strings scattered across services.

Better:

```java
sealed interface SearchFeature permits
    CollapseFeature,
    InnerHitsFeature,
    RescoreFeature,
    HighlightFeature,
    FacetFeature,
    GeoFeature,
    SimilarCasesFeature {}

public record CollapseFeature(String field, int innerSize) implements SearchFeature {}
public record RescoreFeature(int windowSize, String phrase) implements SearchFeature {}
public record GeoFeature(double lat, double lon, String distance) implements SearchFeature {}
```

Then validate:

```java
public void validate(SearchCommand command) {
    for (SearchFeature feature : command.features()) {
        if (!policy.isAllowed(command.user(), feature)) {
            throw new ForbiddenException("Search feature not allowed");
        }

        limits.validate(feature);
    }
}
```

Then build DSL centrally.

---

## 24. Feature Flags for Advanced Search

Advanced features should often be behind feature flags:

```text
enableRescore
enableCollapse
enableInnerHits
enableRuntimeFields
enableGeoSearch
enableMlt
enablePercolatorAlerts
enableAsyncAuditSearch
enableCrossClusterArchiveSearch
```

Feature flags allow:

- canary;
- rollback;
- tenant-specific rollout;
- incident mitigation;
- A/B relevance tests.

But each flag needs:

- owner;
- metrics;
- removal plan;
- safe default.

---

## 25. Observability for Advanced Features

Track feature usage:

```text
search.feature.collapse.count
search.feature.inner_hits.count
search.feature.rescore.count
search.feature.runtime_fields.count
search.feature.script.count
search.feature.mlt.count
search.feature.percolator.count
search.feature.geo.count
search.feature.async.count
search.feature.ccs.count
```

Track latency by feature combination:

```text
p95 latency: base search
p95 latency: search + facets
p95 latency: search + facets + highlight
p95 latency: search + collapse
p95 latency: search + inner_hits
p95 latency: search + rescore
```

Without this, advanced features become invisible latency sources.

---

## 26. Security Considerations

Advanced features can leak data.

Examples:

- inner hits expose restricted nested objects;
- facets computed outside permission filter;
- autocomplete suggests restricted entities;
- percolator alert owned by unauthorized user matches restricted doc;
- async search result retrieved by wrong user;
- cross-cluster search bypasses tenant policy;
- script field returns sensitive derived value;
- `_source` returns internal security fields;
- terms lookup uses stale permission doc.

Security rule:

```text
Permission/tenant filters must be mandatory and applied before optional advanced features.
```

---

## 27. Regulatory Case Management Examples

### 27.1 Percolator Alert

```text
Notify investigator when new complaint mentions a watched entity.
```

Must ensure:

- alert owner has access;
- tenant filter embedded;
- saved query validated;
- new document permission checked before notification.

### 27.2 Collapse by Case

```text
Search evidence documents, show one card per case.
```

Use collapse on `caseId`.

Caveat:

- total hits are documents, not cases;
- need careful UI language;
- permission filter must apply to evidence docs.

### 27.3 Inner Hits for Parties

```text
Case result appears because party "PT Contoh Abadi" matched.
```

Use nested parties + inner_hits.

Caveat:

- party details may be sensitive;
- cap returned inner hits.

### 27.4 Rescore for Exact Regulatory Phrase

```text
Initial broad search finds cases.
Rescore top 100 for phrase proximity "market manipulation".
```

Caveat:

- do not use rescore for authorization;
- test exact phrase golden queries.

### 27.5 Geo Jurisdiction

```text
Find cases inside jurisdiction polygon.
```

Use geo_shape.

Caveat:

- legal boundaries must be authoritative;
- shape versioning matters.

---

## 28. Anti-Patterns

### 28.1 Using Join Field To Recreate Relational Model

If you want many joins, Elasticsearch is the wrong layer. Denormalize or redesign retrieval unit.

### 28.2 Runtime Fields As Permanent Hot Path

Runtime fields are useful bridges. Permanent high-QPS runtime fields are hidden latency debt.

### 28.3 Script Query For Business Logic

Business rules often belong in source system or indexing projection, not query-time scripts.

### 28.4 Percolator As Generic Rule Engine

Percolator is search-query matching, not full business workflow/rule engine.

### 28.5 Collapse Without Explaining Total Hits

Collapsed hits do not mean total distinct groups.

### 28.6 Inner Hits Everywhere

Inner hits can explode response size and fetch cost.

### 28.7 Async Search To Hide Bad Query

If normal search is too slow, fix normal search.

### 28.8 Cross-Cluster Search Without Failure Semantics

Decide what partial results mean.

### 28.9 Search Templates Without Version Control

Templates are code. Treat them as code.

### 28.10 Advanced Features Without Observability

If you cannot measure it, do not deploy it broadly.

---

## 29. Testing Strategy

For each advanced feature:

```text
unit test query builder
mapping contract test
integration test with realistic data
permission test
latency benchmark
failure mode test
fallback/feature flag test
golden query relevance test
```

Example collapse test:

```text
Given 5 matching docs across 2 cases
When collapse by caseId
Then response has 2 hits
And UI total label does not claim 5 cases
```

Example inner hits security test:

```text
Given case has restricted nested evidence
When user lacks evidence permission
Then inner_hits do not expose restricted evidence
```

Example rescore relevance test:

```text
Given phrase query
When rescore enabled
Then exact phrase appears above loose matches
```

---

## 30. Performance Review Checklist

Before enabling advanced feature:

```text
[ ] Query profile run
[ ] Slow log threshold checked
[ ] p95/p99 benchmarked
[ ] heap impact reviewed
[ ] response size measured
[ ] shard fan-out understood
[ ] field mapping suitable
[ ] limits configured
[ ] feature flag exists
[ ] dashboard dimension exists
[ ] rollback tested
```

---

## 31. Production Readiness Checklist

```text
[ ] Problem cannot be solved simpler at index-time
[ ] Feature use case documented
[ ] Query DSL generated centrally
[ ] User input validated
[ ] Tenant/security filter mandatory
[ ] Limits enforced
[ ] Tests implemented
[ ] Metrics/logs added
[ ] Feature flag available
[ ] Runbook updated
[ ] Relevance impact measured
[ ] Rollback plan exists
```

---

## 32. Summary

Advanced Elasticsearch features are powerful, but they should be used selectively.

Key lessons:

1. Percolator reverses search direction: document → stored queries.
2. More-like-this gives lexical similarity, not guaranteed semantic sameness.
3. Runtime fields are useful for transition/exploration, risky for hot paths.
4. Scripts are powerful but can slow search and hide complexity.
5. Collapse groups hits but total hits are not distinct group count.
6. Inner hits explain nested/child matches but can increase fetch cost and leak data.
7. Rescore improves top-K precision with controlled extra cost.
8. Rank feature is better than arbitrary scripts for numeric ranking signals.
9. Join field is specialized and should not recreate relational modeling.
10. Geo search is useful but requires precision, mapping, and legal/domain care.
11. Search templates are code and need versioning/testing.
12. Async search is for long-running workflows, not normal search latency problems.
13. Cross-cluster search needs explicit security, latency, and partial failure semantics.
14. Advanced features need guardrails, metrics, feature flags, and runbooks.

The mature mental model:

```text
Advanced feature = controlled capability with explicit cost, limits, tests, observability, and rollback.
```

---

## 33. What Comes Next

Part 030 will cover:

```text
Vector Search and Semantic Search
```

Topics:

- lexical search vs semantic search;
- dense vector mental model;
- embeddings;
- similarity search;
- kNN;
- approximate nearest neighbor;
- vector field mapping;
- embedding lifecycle;
- query embedding generation;
- semantic search workflow;
- model selection implications;
- multilingual semantic search;
- semantic drift;
- hallucinated match;
- grounding;
- evaluation for semantic retrieval.

---

## References

- Elastic Docs — Percolate query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-percolate-query
- Elastic Docs — Percolator field type: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/percolator
- Elastic Docs — More-like-this query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-mlt-query
- Elastic Docs — Runtime fields via dynamic mapping: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/dynamic
- Elastic Docs — Script query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-script-query
- Elastic Docs — Collapse search results: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/collapse-search-results
- Elastic Docs — Retrieve inner hits: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrieve-inner-hits
- Elastic Docs — Rescore search results: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/rescore-search-results
- Elastic Docs — Join field type: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/parent-join
- Elastic Docs — Geo point field type: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/geo-point
- Elastic Docs — Geo shape query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-geo-shape-query
- Elastic Docs — Terms query and terms lookup: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-terms-query
- Elastic Docs — Search shard routing and preference: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/search-shard-routing
- Elastic Docs — Retrieve selected fields: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrieve-selected-fields


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Backup, Restore, Disaster Recovery, and Data Repair</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-030.md">Part 030 — Vector Search and Semantic Search ➡️</a>
</div>
