# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-008.md

# Part 008 — Query DSL Foundations

## Status Seri

Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
Bagian: `008 / 034`  
Topik: **Query DSL Foundations**  
Status: **Belum selesai**

> Part ini adalah fondasi query Elasticsearch. Setelah memahami document modeling, mapping, dan text analysis, sekarang kita belajar bagaimana “menyatakan niat retrieval” ke Elasticsearch dengan Query DSL secara benar, aman, composable, dan maintainable.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 007, kita sudah membangun fondasi berikut:

1. Search bukan sekadar lookup.
2. Elasticsearch bekerja dengan inverted index dan scoring.
3. Lucene menyimpan index dalam segment immutable.
4. Elasticsearch mendistribusikan data melalui shard dan replica.
5. Search document berbeda dari domain entity.
6. Mapping adalah schema retrieval.
7. Analyzer menentukan bagaimana teks berubah menjadi token.

Part ini menjawab pertanyaan berikut:

> Setelah document masuk ke index, bagaimana cara kita membangun query yang benar?

Banyak engineer memulai Elasticsearch dengan mencoba query acak dari internet. Biasanya berhasil untuk demo, tetapi rusak di production karena:

- query terlalu mahal,
- filter ikut mempengaruhi score,
- exact query dipakai pada analyzed field,
- full-text query dipakai pada `keyword` field,
- permission filter salah tempat,
- `should` disalahpahami sebagai OR sederhana,
- query builder Java menjadi string JSON yang tidak aman,
- search API tidak punya contract yang stabil,
- query sulit di-debug karena terlalu nested tanpa struktur.

Tujuan part ini bukan menghafal semua Query DSL. Tujuannya adalah membangun **mental model query composition**.

---

## 1. Core Mental Model: Query DSL adalah Bahasa untuk Retrieval Intent

Elasticsearch Query DSL adalah representasi JSON untuk mengatakan:

1. Dokumen apa yang boleh masuk kandidat?
2. Dokumen apa yang harus dibuang?
3. Dokumen mana yang lebih relevan?
4. Field mana yang harus dicocokkan?
5. Apakah matching harus exact atau analyzed?
6. Apakah clause ini mempengaruhi score atau hanya eligibility?
7. Bagaimana beberapa kondisi digabungkan?

Query DSL bukan sekadar “where clause versi JSON”. Ini lebih dekat ke:

```text
candidate generation + filtering + scoring + ranking control
```

Dalam SQL, `WHERE status = 'ACTIVE'` biasanya hanya menentukan row yang lolos.

Dalam Elasticsearch, sebuah clause bisa punya dua peran berbeda:

```text
eligibility: dokumen boleh/tidak boleh masuk hasil
scoring: dokumen ini seberapa relevan dibanding dokumen lain
```

Kesalahan besar banyak engineer adalah tidak memisahkan dua peran ini.

---

## 2. Query Context vs Filter Context

Ini salah satu konsep paling penting di Elasticsearch.

## 2.1 Query Context

Clause dalam **query context** menjawab:

> “Seberapa cocok dokumen ini dengan query?”

Hasilnya mempengaruhi `_score`.

Contoh:

```json
{
  "query": {
    "match": {
      "title": "regulatory enforcement breach"
    }
  }
}
```

Query ini bukan hanya mencari dokumen yang mengandung kata terkait. Query ini juga menghitung score berdasarkan kecocokan term, field statistics, dan model ranking.

Gunakan query context untuk:

- keyword user,
- full-text search,
- phrase search,
- relevance ranking,
- boosting,
- semantic candidate scoring,
- intent-driven retrieval.

## 2.2 Filter Context

Clause dalam **filter context** menjawab:

> “Apakah dokumen ini lolos atau tidak?”

Tidak ada score relevance.

Contoh:

```json
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "status": "ACTIVE" } },
        { "term": { "tenant_id": "tenant-001" } }
      ]
    }
  }
}
```

Gunakan filter context untuk:

- tenant,
- authorization,
- status lifecycle,
- visibility,
- date range eligibility,
- category/facet,
- hard business constraint,
- data partition filter,
- non-relevance condition.

## 2.3 Rule of Thumb

```text
Kalau clause menentukan boleh/tidak boleh muncul -> filter.
Kalau clause menentukan urutan relevansi -> query.
```

Contoh salah:

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "fraud investigation" } },
        { "term": { "tenant_id": "tenant-001" } },
        { "term": { "status": "ACTIVE" } }
      ]
    }
  }
}
```

Masalah:

- `tenant_id` dan `status` ikut berada dalam query context.
- Mereka tidak seharusnya menjadi sinyal relevance.
- Query intent menjadi tercampur antara “cocok secara semantik” dan “boleh terlihat”.

Lebih baik:

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "fraud investigation" } }
      ],
      "filter": [
        { "term": { "tenant_id": "tenant-001" } },
        { "term": { "status": "ACTIVE" } }
      ]
    }
  }
}
```

Makna query menjadi jelas:

```text
Cari dokumen yang relevan terhadap "fraud investigation",
tetapi hanya dalam tenant ini dan hanya status ACTIVE.
```

---

## 3. Anatomi Search Request Minimal

Request pencarian biasanya punya beberapa bagian:

```json
{
  "query": {},
  "from": 0,
  "size": 10,
  "sort": [],
  "aggs": {},
  "highlight": {},
  "_source": {}
}
```

Untuk part ini kita fokus pada `query`.

Contoh:

```json
GET cases/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "summary": "late reporting breach" } }
      ],
      "filter": [
        { "term": { "tenant_id": "regulator-a" } },
        { "term": { "visibility": "INTERNAL" } }
      ]
    }
  },
  "size": 10
}
```

Baca query tersebut seperti kalimat:

```text
Dari index cases,
ambil 10 dokumen teratas
yang summary-nya relevan terhadap "late reporting breach",
dan dokumen tersebut harus tenant regulator-a,
dan visibility-nya INTERNAL.
```

Search query yang baik harus bisa diterjemahkan menjadi kalimat seperti itu.

Kalau query tidak bisa dibaca sebagai intent, biasanya query itu akan sulit dirawat.

---

## 4. Query DSL Bukan SQL WHERE

Bagi Java engineer yang kuat di SQL, jebakan umum adalah menganggap Query DSL seperti `WHERE`.

SQL:

```sql
SELECT *
FROM cases
WHERE tenant_id = 'regulator-a'
  AND status = 'ACTIVE'
  AND summary LIKE '%breach%'
ORDER BY created_at DESC
LIMIT 10;
```

Elasticsearch:

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "summary": "breach" } }
      ],
      "filter": [
        { "term": { "tenant_id": "regulator-a" } },
        { "term": { "status": "ACTIVE" } }
      ]
    }
  },
  "sort": [
    { "created_at": "desc" }
  ],
  "size": 10
}
```

Perbedaan penting:

| Aspek | SQL | Elasticsearch |
|---|---|---|
| Data unit | Row | Document |
| Matching teks | Usually exact/LIKE/full-text extension | Native analyzed full-text |
| Ranking | Biasanya eksplisit via `ORDER BY` | Default by `_score` |
| Query role | Predicate + ordering | Candidate + filter + scoring |
| Schema concern | Relational type | Mapping + analyzer + doc values |
| Join | Normal | Hindari; denormalisasi/nested/parent-child terbatas |
| Result correctness | Deterministic row set | Retrieval quality + score |

Dalam SQL, `WHERE summary LIKE '%breach%'` adalah predicate.

Dalam Elasticsearch, `match summary breach` adalah retrieval dan scoring operation.

---

## 5. Term-Level Query vs Full-Text Query

Ini konsep wajib.

## 5.1 Term-Level Query

Term-level query mencari nilai exact seperti yang ada di index.

Contoh:

```json
{
  "term": {
    "status": "ACTIVE"
  }
}
```

Cocok untuk field:

- `keyword`,
- numeric,
- date,
- boolean,
- enum,
- identifier,
- tenant id,
- permission token,
- lifecycle status,
- normalized code.

Term-level query biasanya tidak menganalisis input teks seperti `match` query.

Gunakan untuk:

```text
status harus ACTIVE
case_type harus ENFORCEMENT
tenant_id harus X
case_id harus CASE-2026-0001
assigned_team_id harus TEAM-17
created_at di range tertentu
```

## 5.2 Full-Text Query

Full-text query melewati analyzer dan cocok untuk field `text`.

Contoh:

```json
{
  "match": {
    "summary": "market abuse investigation"
  }
}
```

Cocok untuk:

- judul,
- ringkasan,
- isi dokumen,
- catatan investigator,
- description,
- narrative text,
- complaint body,
- evidence text.

## 5.3 Kesalahan Umum

### Salah 1: `term` pada field `text`

Mapping:

```json
{
  "summary": {
    "type": "text"
  }
}
```

Query:

```json
{
  "term": {
    "summary": "Market Abuse"
  }
}
```

Masalah:

- Field `summary` dianalisis saat index-time.
- “Market Abuse” mungkin disimpan sebagai token `market` dan `abuse`.
- Query `term` mencari term exact `Market Abuse`.
- Hasil bisa kosong.

Lebih tepat:

```json
{
  "match": {
    "summary": "Market Abuse"
  }
}
```

### Salah 2: `match` pada field identifier

Mapping:

```json
{
  "case_id": {
    "type": "keyword"
  }
}
```

Query:

```json
{
  "match": {
    "case_id": "CASE-2026-0001"
  }
}
```

Secara teknis bisa berjalan dalam banyak kasus, tetapi intent-nya tidak presisi. Untuk identifier, gunakan exact query:

```json
{
  "term": {
    "case_id": "CASE-2026-0001"
  }
}
```

Mental model:

```text
Human language -> match / full-text query.
Machine identifier -> term / exact query.
```

---

## 6. Query Dasar yang Harus Dikuasai

## 6.1 `match`

Query paling umum untuk full-text.

```json
{
  "match": {
    "summary": "late filing breach"
  }
}
```

Makna:

```text
Analisis teks input menggunakan analyzer yang sesuai,
lalu cari dokumen yang relevan pada field summary.
```

Cocok untuk:

- search box utama,
- user-entered text,
- natural language query,
- dokumen naratif.

## 6.2 `term`

Exact term.

```json
{
  "term": {
    "status": "OPEN"
  }
}
```

Cocok untuk enum/status/keyword.

## 6.3 `terms`

Exact match terhadap salah satu dari beberapa nilai.

```json
{
  "terms": {
    "status": ["OPEN", "UNDER_REVIEW", "ESCALATED"]
  }
}
```

Makna:

```text
status IN (...)
```

Gunakan untuk filter multi-select.

## 6.4 `range`

Range numeric/date.

```json
{
  "range": {
    "created_at": {
      "gte": "2026-01-01T00:00:00Z",
      "lt": "2027-01-01T00:00:00Z"
    }
  }
}
```

Cocok untuk:

- created date,
- updated date,
- SLA due date,
- amount,
- risk score,
- severity level.

Gunakan boundary eksplisit. Untuk production API, jangan biarkan user mengirim date expression liar tanpa validasi.

## 6.5 `exists`

Mencari dokumen yang punya field tertentu.

```json
{
  "exists": {
    "field": "assigned_officer_id"
  }
}
```

Cocok untuk:

- assigned/unassigned,
- missing workflow step,
- data completeness,
- document enrichment status.

Contoh mencari yang belum assigned:

```json
{
  "bool": {
    "must_not": [
      { "exists": { "field": "assigned_officer_id" } }
    ]
  }
}
```

---

## 7. `bool` Query: Pusat Komposisi Query DSL

`bool` adalah query paling penting untuk backend engineer.

Strukturnya:

```json
{
  "bool": {
    "must": [],
    "should": [],
    "filter": [],
    "must_not": []
  }
}
```

## 7.1 `must`

Clause harus match dan mempengaruhi score.

```json
{
  "bool": {
    "must": [
      { "match": { "summary": "fraud" } },
      { "match": { "description": "misconduct" } }
    ]
  }
}
```

Makna:

```text
Dokumen harus match summary fraud dan description misconduct.
Keduanya bisa mempengaruhi score.
```

Gunakan `must` untuk relevance condition yang wajib.

## 7.2 `filter`

Clause harus match tetapi tidak mempengaruhi score.

```json
{
  "bool": {
    "filter": [
      { "term": { "tenant_id": "regulator-a" } },
      { "term": { "status": "ACTIVE" } }
    ]
  }
}
```

Gunakan `filter` untuk hard constraints.

## 7.3 `must_not`

Clause tidak boleh match.

```json
{
  "bool": {
    "must_not": [
      { "term": { "status": "DELETED" } }
    ]
  }
}
```

Biasanya digunakan untuk:

- soft delete,
- exclude archived,
- exclude hidden,
- exclude suppressed document,
- exclude workflow state tertentu.

Catatan: `must_not` berjalan dalam filter context. Ia tidak memberikan negative score. Ia membuang kandidat.

## 7.4 `should`

`should` sering disalahpahami.

Dalam banyak pikiran SQL engineer:

```text
should = OR
```

Itu terlalu sederhana.

`should` berarti:

```text
Clause opsional yang bisa meningkatkan score,
atau bisa menjadi wajib tergantung minimum_should_match dan struktur bool.
```

Contoh boosting:

```json
{
  "bool": {
    "must": [
      { "match": { "body": "market manipulation" } }
    ],
    "should": [
      { "match": { "title": "market manipulation" } },
      { "term": { "case_priority": "HIGH" } }
    ],
    "filter": [
      { "term": { "tenant_id": "regulator-a" } }
    ]
  }
}
```

Makna:

```text
Dokumen harus cocok di body.
Kalau juga cocok di title, naikkan score.
Kalau priority HIGH, naikkan score.
Tenant tetap wajib.
```

Jika `bool` hanya punya `should`, default minimal match biasanya menjadi 1.

```json
{
  "bool": {
    "should": [
      { "term": { "status": "OPEN" } },
      { "term": { "status": "ESCALATED" } }
    ]
  }
}
```

Makna praktis:

```text
status OPEN OR ESCALATED
```

Namun untuk exact multi-value filter, lebih baik gunakan `terms` jika field sama:

```json
{
  "terms": {
    "status": ["OPEN", "ESCALATED"]
  }
}
```

---

## 8. `minimum_should_match`

`minimum_should_match` menentukan berapa banyak clause `should` yang wajib cocok.

Contoh:

```json
{
  "bool": {
    "should": [
      { "match": { "summary": "fraud" } },
      { "match": { "summary": "misconduct" } },
      { "match": { "summary": "market abuse" } }
    ],
    "minimum_should_match": 2
  }
}
```

Makna:

```text
Dari tiga sinyal ini, minimal dua harus match.
```

Elasticsearch mendukung bentuk fixed integer, percentage, negative integer, dan kombinasi bersyarat.

Contoh:

```json
{
  "minimum_should_match": "75%"
}
```

Mental model:

```text
minimum_should_match mengubah should dari pure booster menjadi partial requirement.
```

Gunakan untuk:

- query user dengan banyak token,
- menghindari hasil terlalu longgar,
- domain search yang butuh beberapa konsep cocok,
- multi-field query dengan partial constraint.

Hati-hati:

- Terlalu tinggi -> recall turun drastis.
- Terlalu rendah -> hasil noisy.
- Tidak eksplisit -> behavior bergantung struktur bool.

Rule praktis:

```text
Untuk query kompleks production, lebih baik eksplisitkan minimum_should_match ketika should menentukan eligibility.
```

---

## 9. Filter OR Tanpa Merusak Score

Masalah umum:

> Saya ingin filter: user boleh lihat dokumen kalau `owner_id = user` OR `team_id IN userTeams`. Tapi saya tidak ingin kondisi permission ini menaikkan score.

Jangan taruh permission OR di top-level `should` query context.

Kurang tepat:

```json
{
  "bool": {
    "must": [
      { "match": { "summary": "breach" } }
    ],
    "should": [
      { "term": { "owner_id": "user-1" } },
      { "terms": { "team_id": ["team-a", "team-b"] } }
    ],
    "minimum_should_match": 1
  }
}
```

Masalah:

- Permission clause berada di query context.
- Dokumen yang match owner dan team bisa mendapat score berbeda.
- Authorization mempengaruhi ranking.

Lebih benar:

```json
{
  "bool": {
    "must": [
      { "match": { "summary": "breach" } }
    ],
    "filter": [
      {
        "bool": {
          "should": [
            { "term": { "owner_id": "user-1" } },
            { "terms": { "team_id": ["team-a", "team-b"] } }
          ],
          "minimum_should_match": 1
        }
      }
    ]
  }
}
```

Makna:

```text
Summary harus relevan terhadap breach.
Dokumen juga harus lolos salah satu permission rule.
Permission tidak mempengaruhi score.
```

Ini pola penting untuk:

- multi-tenant search,
- ACL,
- role-based search,
- team visibility,
- regulatory access control,
- hierarchical permission.

---

## 10. Struktur Query Production yang Umum

Untuk search backend nyata, struktur query sering seperti ini:

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "late reporting breach",
            "fields": ["title^3", "summary^2", "body"]
          }
        }
      ],
      "filter": [
        { "term": { "tenant_id": "regulator-a" } },
        { "terms": { "case_status": ["OPEN", "UNDER_REVIEW"] } },
        {
          "range": {
            "created_at": {
              "gte": "2026-01-01T00:00:00Z",
              "lt": "2027-01-01T00:00:00Z"
            }
          }
        },
        {
          "bool": {
            "should": [
              { "term": { "owner_user_id": "user-123" } },
              { "terms": { "viewer_group_ids": ["group-1", "group-2"] } }
            ],
            "minimum_should_match": 1
          }
        }
      ],
      "must_not": [
        { "term": { "deleted": true } },
        { "term": { "suppressed": true } }
      ],
      "should": [
        { "term": { "priority": "HIGH" } },
        { "term": { "escalated": true } }
      ]
    }
  },
  "size": 20
}
```

Bacaan intent:

```text
Cari case yang relevan terhadap "late reporting breach".
Batasi ke tenant regulator-a.
Hanya status OPEN atau UNDER_REVIEW.
Hanya created_at tahun 2026.
User harus punya akses via owner atau group.
Jangan tampilkan deleted/suppressed.
Naikkan ranking jika priority HIGH atau escalated.
Ambil 20 hasil.
```

Ini contoh struktur sehat:

- search text ada di `must`,
- hard constraints ada di `filter`,
- exclusion ada di `must_not`,
- optional ranking signals ada di `should`,
- permission OR berada di nested bool dalam `filter`.

---

## 11. Score: Jangan Anggap `_score` sebagai Kebenaran Absolut

`_score` adalah nilai relatif untuk query tertentu.

Jangan memperlakukan `_score` sebagai:

- probabilitas benar,
- nilai global antar query,
- ranking business final,
- score yang bisa dibandingkan antar request berbeda secara absolut.

Score bergantung pada:

- query,
- analyzer,
- field statistics,
- term rarity,
- field length,
- boost,
- query structure,
- shard/index statistics,
- ranking function.

Contoh:

```text
_score 12.3 pada query A tidak berarti lebih relevan dari _score 5.1 pada query B.
```

Score hanya bermakna dalam konteks query dan result set tertentu.

---

## 12. Query Naming untuk Debugging

Elasticsearch mendukung named query dengan `_name` pada clause.

Contoh:

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "match": {
            "summary": {
              "query": "market abuse",
              "_name": "summary_full_text"
            }
          }
        }
      ],
      "filter": [
        {
          "term": {
            "tenant_id": {
              "value": "regulator-a",
              "_name": "tenant_filter"
            }
          }
        }
      ]
    }
  }
}
```

Manfaat:

- debugging result,
- observability,
- explainability,
- test assertion,
- query evolution.

Untuk sistem regulatory/case management, named queries bisa membantu menjelaskan:

```text
Dokumen ini muncul karena match pada summary_full_text dan lolos tenant_filter.
```

Namun jangan overuse. Gunakan pada clause penting.

---

## 13. Query DSL sebagai AST, Bukan String

Dalam Java backend, jangan membangun query seperti ini:

```java
String query = "{ \"query\": { \"match\": { \"summary\": \"" + userInput + "\" } } }";
```

Masalah:

- escaping rentan,
- injection-like malformed query,
- sulit test,
- sulit refactor,
- tidak typed,
- tidak composable,
- tidak aman untuk optional filter.

Lebih baik pikirkan query sebagai AST:

```text
SearchRequest
  query
    bool
      must
      filter
      should
      must_not
```

Di Java, gunakan official client builder atau abstraction internal yang typed.

Pseudo-model:

```java
record CaseSearchCriteria(
    String tenantId,
    String queryText,
    List<String> statuses,
    Instant createdFrom,
    Instant createdTo,
    UserAccess access,
    int pageSize
) {}
```

Kemudian builder:

```java
Query buildCaseSearchQuery(CaseSearchCriteria criteria) {
    List<Query> must = new ArrayList<>();
    List<Query> filter = new ArrayList<>();
    List<Query> should = new ArrayList<>();
    List<Query> mustNot = new ArrayList<>();

    if (criteria.queryText() != null && !criteria.queryText().isBlank()) {
        must.add(multiMatchTextQuery(criteria.queryText()));
    } else {
        must.add(matchAllQuery());
    }

    filter.add(termQuery("tenant_id", criteria.tenantId()));
    filter.add(termsQuery("case_status", criteria.statuses()));
    filter.add(dateRangeQuery("created_at", criteria.createdFrom(), criteria.createdTo()));
    filter.add(permissionQuery(criteria.access()));

    mustNot.add(termQuery("deleted", true));

    should.add(termQuery("priority", "HIGH"));
    should.add(termQuery("escalated", true));

    return boolQuery(must, filter, should, mustNot);
}
```

Walaupun kode di atas pseudo-code, prinsipnya penting:

```text
Pisahkan assembly query dari controller.
Pisahkan business criteria dari Elasticsearch representation.
Pisahkan filter dari scoring signal.
Pisahkan authorization dari relevance.
```

---

## 14. Java API Client: Mental Model Pemakaian

Official Java API Client menyediakan strongly typed requests/responses untuk Elasticsearch APIs.

Contoh gaya pemakaian modern biasanya seperti:

```java
SearchResponse<CaseDocument> response = client.search(s -> s
    .index("cases-v1")
    .query(q -> q
        .bool(b -> b
            .must(m -> m
                .match(mm -> mm
                    .field("summary")
                    .query("market abuse")
                )
            )
            .filter(f -> f
                .term(t -> t
                    .field("tenant_id")
                    .value("regulator-a")
                )
            )
        )
    )
    .size(20),
    CaseDocument.class
);
```

Jangan fokus menghafal syntax. Fokus pada struktur:

```text
client.search
  index
  query
    bool
      must
        match
      filter
        term
  size
```

Untuk sistem besar, biasanya jangan langsung membangun query kompleks di controller.

Gunakan layer:

```text
Controller
  -> SearchApplicationService
      -> Criteria Validator
      -> QueryFactory
      -> SortFactory
      -> AggregationFactory
      -> ElasticsearchClient Adapter
      -> Result Mapper
```

Kenapa?

Karena search API akan berubah:

- field boost berubah,
- filter bertambah,
- permission rule berubah,
- index version berubah,
- query fallback berubah,
- observability bertambah,
- A/B relevance test muncul.

Jika query DSL tersebar di controller, perubahan kecil akan menjadi regression besar.

---

## 15. Query Builder Pattern untuk Java Backend

## 15.1 Jangan Buat God Query Builder

Anti-pattern:

```text
CaseSearchQueryBuilder.buildEverything(criteria)
```

Lama-lama class ini menjadi 2000 baris.

Lebih baik pecah berdasarkan concern:

```text
CaseTextQueryFactory
CaseFilterQueryFactory
CasePermissionQueryFactory
CaseBoostQueryFactory
CaseSortFactory
CaseHighlightFactory
CaseAggregationFactory
```

Kemudian compose:

```text
CaseSearchRequestFactory
```

## 15.2 Internal Query Intent Model

Buat model internal:

```java
sealed interface SearchIntent permits KeywordSearch, BrowseSearch, IdentifierLookup {}

record KeywordSearch(String text) implements SearchIntent {}
record BrowseSearch() implements SearchIntent {}
record IdentifierLookup(String caseId) implements SearchIntent {}
```

Kenapa ini penting?

Karena query untuk identifier lookup berbeda dari natural language search.

Identifier lookup:

```json
{
  "term": {
    "case_id": "CASE-2026-0001"
  }
}
```

Keyword search:

```json
{
  "multi_match": {
    "query": "late reporting breach",
    "fields": ["title^3", "summary^2", "body"]
  }
}
```

Browse search:

```json
{
  "match_all": {}
}
```

Menyatukan semuanya sebagai `String q` sering membuat query menjadi ambigu.

---

## 16. Handling Empty Query

User membuka search page tanpa keyword, hanya filter status.

Apa query-nya?

Jangan gunakan `match` dengan string kosong.

Gunakan `match_all` + filter:

```json
{
  "query": {
    "bool": {
      "must": [
        { "match_all": {} }
      ],
      "filter": [
        { "term": { "tenant_id": "regulator-a" } },
        { "terms": { "case_status": ["OPEN", "UNDER_REVIEW"] } }
      ]
    }
  }
}
```

Atau cukup:

```json
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "regulator-a" } },
        { "terms": { "case_status": ["OPEN", "UNDER_REVIEW"] } }
      ]
    }
  }
}
```

Namun eksplisit `match_all` sering lebih jelas di query builder.

Business decision:

- Apakah empty query boleh?
- Apakah harus ada minimal keyword?
- Apakah browse mode berbeda dari search mode?
- Apakah sorting default by date, score, priority, atau SLA?

Jangan biarkan empty query menjadi accidental full-index scan dengan sorting mahal.

---

## 17. Exact Identifier Fast Path

Search box sering menerima dua jenis input:

1. Natural language: `late reporting breach`
2. Identifier: `CASE-2026-0001`

Kalau identifier bisa dideteksi dengan regex, buat fast path.

```text
CASE-2026-0001 -> term query case_id.keyword / case_id
late reporting breach -> full-text query
```

Contoh bool gabungan:

```json
{
  "bool": {
    "should": [
      {
        "term": {
          "case_id": {
            "value": "CASE-2026-0001",
            "boost": 10
          }
        }
      },
      {
        "multi_match": {
          "query": "CASE-2026-0001",
          "fields": ["title^3", "summary^2", "body"]
        }
      }
    ],
    "minimum_should_match": 1,
    "filter": [
      { "term": { "tenant_id": "regulator-a" } }
    ]
  }
}
```

Namun untuk true identifier lookup, biasanya endpoint terpisah lebih baik:

```text
GET /cases/{caseId}
```

Search box hybrid boleh membantu UX, tetapi jangan jadikan search sebagai satu-satunya mekanisme entity retrieval.

---

## 18. Avoiding Expensive Queries from User Input

Elasticsearch powerful, tetapi query power harus dibatasi.

Hindari membiarkan user langsung mengirim arbitrary Query DSL kecuali untuk internal admin tool yang sangat dikontrol.

Risiko:

- wildcard leading `*foo`,
- regexp berat,
- script query,
- deep pagination,
- large terms list,
- unbounded range,
- high-cardinality sort,
- query_string syntax abuse,
- aggregation explosion,
- accidental cluster load spike.

Application API sebaiknya menerima bentuk seperti:

```json
{
  "q": "late reporting breach",
  "status": ["OPEN", "UNDER_REVIEW"],
  "createdFrom": "2026-01-01T00:00:00Z",
  "createdTo": "2026-12-31T23:59:59Z",
  "sort": "RELEVANCE",
  "pageSize": 20
}
```

Bukan:

```json
{
  "query": {
    "script_score": {
      "script": "..."
    }
  }
}
```

Rule:

```text
External API should expose search intent, not raw Elasticsearch power.
```

---

## 19. Query Validation Checklist

Sebelum query dikirim ke Elasticsearch, validate:

1. `q` length masuk akal.
2. `pageSize` punya max.
3. Sort field whitelist.
4. Filter field whitelist.
5. Date range bounded.
6. Terms list punya max cardinality.
7. Tenant filter selalu ada.
8. Permission filter selalu ada.
9. Deleted/suppressed exclusion selalu ada.
10. Empty query behavior eksplisit.
11. Wildcard/regexp tidak diekspos ke public user.
12. Highlight hanya untuk field yang diizinkan.
13. Aggregation hanya untuk facet yang diizinkan.
14. Timeout diset.
15. Track total hits behavior dipilih dengan sadar.

Contoh API-level validation:

```text
q length <= 200 chars
pageSize <= 100
status values must be known enum
createdTo - createdFrom <= 3 years unless privileged export
sort in [RELEVANCE, CREATED_DESC, UPDATED_DESC, SLA_ASC]
tenant_id derived from auth context, not request body
```

---

## 20. Permission Filter: Non-Negotiable Constraint

Dalam sistem enterprise/regulatory, permission bukan fitur tambahan. Permission adalah invariant.

Invariant:

```text
No search result may be returned unless the caller is authorized to see it.
```

Jangan taruh permission sebagai post-processing setelah Elasticsearch.

Anti-pattern:

```text
Search 100 docs -> filter unauthorized in application -> return remaining
```

Masalah:

- result count bocor,
- facet count bocor,
- pagination rusak,
- unauthorized docs mempengaruhi scoring/top-K,
- performance buruk,
- audit defensibility lemah.

Lebih baik:

```text
authorization constraints included in Elasticsearch filter context
```

Contoh:

```json
{
  "bool": {
    "must": [
      { "match": { "summary": "insider trading" } }
    ],
    "filter": [
      { "term": { "tenant_id": "regulator-a" } },
      {
        "bool": {
          "should": [
            { "term": { "owner_user_id": "user-1" } },
            { "terms": { "viewer_group_ids": ["group-a", "group-b"] } },
            { "terms": { "security_tags": ["market-abuse-unit"] } }
          ],
          "minimum_should_match": 1
        }
      }
    ]
  }
}
```

Untuk regulatory search, query correctness bukan hanya technical correctness. Ia juga menyangkut:

- confidentiality,
- audit trail,
- legal defensibility,
- proportional access,
- least privilege,
- data minimization.

---

## 21. Multi-Tenancy Query Pattern

Ada beberapa model tenant isolation:

1. Index per tenant.
2. Shared index dengan `tenant_id` filter.
3. Hybrid: large tenant dedicated index, small tenants shared index.

Part ini tidak masuk capacity detail, tetapi dari sisi query:

```text
tenant constraint harus selalu hadir.
```

Shared index pattern:

```json
{
  "bool": {
    "filter": [
      { "term": { "tenant_id": "tenant-001" } }
    ]
  }
}
```

Jangan ambil `tenant_id` dari request body user secara mentah.

Lebih baik:

```text
auth token/session -> tenant context -> query builder injects tenant filter
```

Kalau tenant filter optional, Anda sedang mendesain data leak.

---

## 22. Soft Delete, Suppression, dan Lifecycle Visibility

Search system sering punya data lifecycle:

- active,
- draft,
- archived,
- deleted,
- suppressed,
- sealed,
- expunged,
- confidential,
- legal hold,
- superseded.

Jangan samakan semua lifecycle dengan satu boolean `deleted`.

Namun untuk query dasar, minimal pattern:

```json
{
  "bool": {
    "must_not": [
      { "term": { "deleted": true } },
      { "term": { "suppressed": true } }
    ]
  }
}
```

Lebih matang:

```json
{
  "bool": {
    "filter": [
      { "terms": { "search_visibility": ["VISIBLE", "RESTRICTED_VISIBLE"] } }
    ],
    "must_not": [
      { "term": { "lifecycle_state": "EXPUNGED" } }
    ]
  }
}
```

Jadikan visibility sebagai first-class indexed field, bukan logika tersembunyi di application.

---

## 23. Query Composition Example: Case Search

Input API:

```json
{
  "q": "late reporting breach",
  "status": ["OPEN", "ESCALATED"],
  "severity": ["HIGH", "CRITICAL"],
  "createdFrom": "2026-01-01T00:00:00Z",
  "createdTo": "2026-06-30T23:59:59Z",
  "assignedOnly": true,
  "sort": "RELEVANCE",
  "pageSize": 20
}
```

Domain criteria:

```text
Tenant: regulator-a
User: user-123
Groups: enforcement-team, market-conduct-unit
Search text: late reporting breach
Status: OPEN, ESCALATED
Severity: HIGH, CRITICAL
Created date range: H1 2026
Assigned only: true
```

Query:

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "late reporting breach",
            "fields": [
              "case_title^4",
              "case_summary^2",
              "allegation_text^2",
              "evidence_text"
            ],
            "operator": "and"
          }
        }
      ],
      "filter": [
        { "term": { "tenant_id": "regulator-a" } },
        { "terms": { "case_status": ["OPEN", "ESCALATED"] } },
        { "terms": { "severity": ["HIGH", "CRITICAL"] } },
        {
          "range": {
            "created_at": {
              "gte": "2026-01-01T00:00:00Z",
              "lte": "2026-06-30T23:59:59Z"
            }
          }
        },
        { "exists": { "field": "assigned_officer_id" } },
        {
          "bool": {
            "should": [
              { "term": { "owner_user_id": "user-123" } },
              { "terms": { "viewer_group_ids": ["enforcement-team", "market-conduct-unit"] } }
            ],
            "minimum_should_match": 1
          }
        }
      ],
      "must_not": [
        { "term": { "deleted": true } },
        { "term": { "suppressed": true } }
      ],
      "should": [
        { "term": { "priority": "HIGH" } },
        { "term": { "sla_breached": true } }
      ]
    }
  },
  "size": 20
}
```

Analisis:

- `multi_match` adalah relevance core.
- `tenant_id`, `status`, `severity`, date range, assigned filter adalah eligibility.
- permission OR berada di filter context.
- `deleted` dan `suppressed` dibuang.
- priority dan SLA breach menjadi ranking signal opsional.

Ini query yang jauh lebih sehat daripada mencampur semua di `must`.

---

## 24. Browse Query vs Search Query

Search page sering punya dua mode:

## 24.1 Browse Mode

User belum memasukkan keyword.

```json
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "regulator-a" } },
        { "terms": { "case_status": ["OPEN", "ESCALATED"] } }
      ],
      "must_not": [
        { "term": { "deleted": true } }
      ]
    }
  },
  "sort": [
    { "updated_at": "desc" }
  ],
  "size": 20
}
```

Ranking by score tidak bermakna karena tidak ada text relevance.

Sort by:

- updated_at,
- created_at,
- priority,
- SLA due date,
- severity,
- workflow queue order.

## 24.2 Search Mode

User memasukkan keyword.

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "case_summary": "late reporting breach" } }
      ],
      "filter": [
        { "term": { "tenant_id": "regulator-a" } }
      ]
    }
  },
  "sort": [
    "_score",
    { "updated_at": "desc" }
  ],
  "size": 20
}
```

Ranking by score masuk akal.

Jangan treat browse dan search sebagai hal yang sama. Mereka punya intent berbeda.

---

## 25. Sorting dan Query DSL: Preview

Sorting akan dibahas detail di Part 013, tapi dasar perlu diketahui.

Default Elasticsearch search sort adalah `_score desc` jika query menghasilkan score.

Jika Anda menambahkan sort eksplisit:

```json
{
  "sort": [
    { "created_at": "desc" }
  ]
}
```

Maka hasil tidak lagi terutama berdasarkan relevance. Ini bisa mengejutkan user:

```text
Saya search fraud, kenapa hasil paling relevan tidak di atas?
```

Kombinasi umum:

```json
{
  "sort": [
    "_score",
    { "updated_at": "desc" },
    { "case_id": "asc" }
  ]
}
```

Namun kalau sort by date menjadi primary, `_score` hanya tie-breaker atau bahkan tidak digunakan sebagai ranking utama.

Search API harus eksplisit:

```text
sort=RELEVANCE
sort=NEWEST
sort=SLA_DUE
sort=SEVERITY
```

Jangan expose raw field sort bebas tanpa whitelist.

---

## 26. `match_all` dan `match_none`

## 26.1 `match_all`

Cocok untuk browse mode.

```json
{
  "match_all": {}
}
```

Biasanya dikombinasikan dengan filter.

## 26.2 `match_none`

Mengembalikan nol dokumen.

```json
{
  "match_none": {}
}
```

Berguna saat:

- request invalid tetapi ingin response kosong,
- user tidak punya permission apapun,
- feature flag mematikan search subset,
- filter combination impossible.

Contoh:

```text
Jika user tidak punya allowed group IDs dan bukan admin,
return match_none daripada menghapus permission filter.
```

---

## 27. Constant Score Pattern

Kadang Anda ingin filter query tetapi score konstan.

Contoh:

```json
{
  "constant_score": {
    "filter": {
      "term": {
        "case_status": "OPEN"
      }
    },
    "boost": 1.0
  }
}
```

Gunakan ketika:

- matching condition harus memberikan score tetap,
- Anda ingin mengabaikan term frequency/scoring,
- filter-like query perlu masuk dalam scoring composition secara terkontrol.

Namun sebagian besar hard constraints cukup di `bool.filter`.

---

## 28. `must_not` dengan `exists`: Missing Field Pattern

Cari dokumen tanpa field:

```json
{
  "bool": {
    "must_not": [
      { "exists": { "field": "assigned_officer_id" } }
    ]
  }
}
```

Digunakan untuk:

- unassigned cases,
- missing classification,
- unenriched documents,
- incomplete metadata,
- failed ingestion pipeline.

Namun hati-hati dengan semantic null/missing.

Elasticsearch tidak sama dengan SQL `NULL` dalam banyak aspek. Pastikan mapping dan indexing convention jelas:

```text
Missing field berarti unknown?
Missing field berarti not applicable?
Missing field berarti false?
Missing field berarti ingestion failure?
```

Jangan jadikan missing field sebagai business meaning tanpa kontrak.

---

## 29. Query DSL dan Mapping Harus Selaras

Query benar bergantung pada mapping.

Contoh mapping multi-field:

```json
{
  "case_title": {
    "type": "text",
    "fields": {
      "keyword": {
        "type": "keyword"
      }
    }
  }
}
```

Gunakan full-text:

```json
{
  "match": {
    "case_title": "market abuse"
  }
}
```

Gunakan exact/sort/aggregation:

```json
{
  "term": {
    "case_title.keyword": "Market Abuse Investigation"
  }
}
```

Kalau query dan mapping tidak selaras, masalah muncul sebagai:

- result kosong,
- ranking buruk,
- aggregation aneh,
- sorting gagal,
- query lambat,
- memory pressure.

Rule:

```text
Setiap field di mapping harus punya query use case yang jelas.
Setiap query clause harus tahu field mapping-nya.
```

---

## 30. Query DSL dan Analyzer Harus Selaras

Dari Part 007:

```text
index-time analysis dan search-time analysis harus dirancang bersama.
```

Contoh:

Field `case_summary` memakai analyzer lowercase + stemming.

Query:

```json
{
  "match": {
    "case_summary": "investigations"
  }
}
```

Bisa match document yang punya `investigation` jika stemming sesuai.

Namun:

```json
{
  "term": {
    "case_summary": "investigations"
  }
}
```

Kemungkinan tidak cocok karena token index mungkin bukan `investigations`.

Debug flow:

1. Cek mapping field.
2. Cek analyzer field.
3. Jalankan `_analyze` untuk input.
4. Cek query yang dipakai.
5. Gunakan `_explain` untuk document tertentu.
6. Gunakan `_profile` jika masalah performance.

---

## 31. Query Readability

Query DSL bisa menjadi sangat nested. Buat query tetap readable.

Anti-pattern:

```json
{
  "query": {
    "bool": {
      "should": [
        {
          "bool": {
            "must": [
              {
                "bool": {
                  "should": [
                    {
                      "bool": {
                        "filter": [
                          { "term": { "a": "b" } }
                        ]
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  }
}
```

Masalah:

- sulit dibaca,
- sulit debug,
- sulit explain,
- raw query log tidak membantu,
- perubahan kecil berbahaya.

Prinsip:

```text
Top-level bool harus punya struktur konseptual jelas:
- text relevance
- hard filters
- permission filters
- exclusions
- boost signals
```

Pisahkan query construction secara modular.

---

## 32. Logging Query: Perlu, Tapi Hati-Hati

Search query perlu observable.

Log minimal:

- request id,
- user/tenant hash, bukan data sensitif mentah,
- search mode,
- query template name,
- filter count,
- sort mode,
- took time,
- result count,
- timed out flag,
- shard failure,
- query category.

Jangan sembarang log:

- full user query berisi PII,
- permission token,
- sensitive case id,
- raw evidence text,
- security group detail,
- full DSL untuk semua request high volume.

Untuk debugging, bisa aktifkan sampled structured logging.

Contoh structured event:

```json
{
  "event": "case_search_executed",
  "request_id": "req-123",
  "tenant_hash": "tnt_9f2a",
  "search_mode": "KEYWORD",
  "query_template": "CASE_SEARCH_V3",
  "sort": "RELEVANCE",
  "page_size": 20,
  "filter_count": 7,
  "took_ms": 42,
  "hits_total_relation": "gte",
  "timed_out": false
}
```

---

## 33. Testing Query DSL

Search query code harus dites.

Jenis test:

## 33.1 Unit Test Query Builder

Pastikan criteria menghasilkan query shape benar.

Contoh assertion:

```text
Given tenant context regulator-a
When building query
Then query contains tenant_id filter
```

Test invariant:

- tenant filter selalu ada,
- permission filter selalu ada,
- deleted exclusion selalu ada,
- no raw wildcard from user,
- page size capped,
- empty query becomes browse mode.

## 33.2 Mapping Compatibility Test

Pastikan field yang dipakai query ada di mapping.

```text
case_status queried with terms -> field must be keyword-compatible
case_summary queried with match -> field must be text-compatible
created_at queried with range -> field must be date-compatible
```

## 33.3 Integration Test with Test Index

Seed beberapa document dan test behavior:

- keyword search returns expected docs,
- filter excludes wrong tenant,
- permission works,
- deleted doc not returned,
- score order roughly expected,
- empty query sorted correctly.

## 33.4 Relevance Regression Test

Untuk part relevance nanti, test tidak hanya “doc ada”, tetapi ranking:

```text
For query "market abuse", document A should rank above document B.
```

---

## 34. Query DSL Failure Modes

## 34.1 Wrong Field Type

Symptom:

```text
Query returns zero result or weird result.
```

Cause:

```text
term query on text field, match query on keyword with unsuitable analyzer expectation.
```

## 34.2 Filter in Query Context

Symptom:

```text
Ranking affected by status/tenant/permission.
```

Cause:

```text
Hard constraints placed in must/should incorrectly.
```

## 34.3 Optional Should Not Optional

Symptom:

```text
Documents returned even though none of business alternatives matched.
```

Cause:

```text
should with must/filter and no explicit minimum_should_match.
```

## 34.4 Permission Leak

Symptom:

```text
User sees unauthorized document or count/facet reveals hidden data.
```

Cause:

```text
Permission not in filter context or applied after search.
```

## 34.5 Empty Query Load Spike

Symptom:

```text
Opening search page causes slow cluster.
```

Cause:

```text
match_all over large index with expensive sort/aggs and no bounded filter.
```

## 34.6 Query String Abuse

Symptom:

```text
Users can craft complex syntax that causes unexpected results/load.
```

Cause:

```text
Raw query_string exposed to untrusted users.
```

## 34.7 Deeply Nested Bool Soup

Symptom:

```text
Nobody understands query behavior.
```

Cause:

```text
No query construction architecture.
```

---

## 35. Design Principle: Query DSL Harus Merepresentasikan Product Semantics

Search query bukan hanya technical artifact. Ia adalah encoding dari product semantics.

Contoh regulatory case management:

```text
Investigator searches for "late disclosure breach".
```

Query harus membawa semantics:

- search relevant case text,
- restrict to investigator tenant,
- respect authorization,
- exclude suppressed records,
- include only lifecycle states visible to investigator,
- boost urgent/severe cases,
- preserve auditability,
- avoid exposing hidden facets.

Jadi query bukan sekadar:

```json
{ "match": { "body": "late disclosure breach" } }
```

Tetapi:

```text
retrieval + visibility + lifecycle + security + ranking policy
```

Top-tier engineer tidak hanya bisa menulis Query DSL. Mereka bisa menjelaskan:

```text
Kenapa clause ini ada?
Kenapa clause ini filter, bukan must?
Kenapa should ini punya minimum_should_match?
Kenapa field ini keyword, bukan text?
Kenapa permission masuk sebelum top-K?
Kenapa sort ini tidak merusak relevance?
Apa failure mode query ini?
Bagaimana query ini akan berevolusi?
```

---

## 36. Practical Query DSL Patterns

## 36.1 Keyword Search with Filters

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "summary": "reporting breach" } }
      ],
      "filter": [
        { "term": { "tenant_id": "tenant-001" } },
        { "term": { "status": "OPEN" } }
      ]
    }
  }
}
```

Use case:

```text
General full-text search with hard constraints.
```

## 36.2 Browse with Filters

```json
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "tenant-001" } },
        { "terms": { "status": ["OPEN", "ESCALATED"] } }
      ]
    }
  },
  "sort": [
    { "updated_at": "desc" }
  ]
}
```

Use case:

```text
Queue/worklist page.
```

## 36.3 Permission OR Filter

```json
{
  "bool": {
    "filter": [
      {
        "bool": {
          "should": [
            { "term": { "owner_user_id": "user-1" } },
            { "terms": { "viewer_group_ids": ["group-a", "group-b"] } }
          ],
          "minimum_should_match": 1
        }
      }
    ]
  }
}
```

Use case:

```text
Authorization alternative without score impact.
```

## 36.4 Optional Boost

```json
{
  "bool": {
    "must": [
      { "match": { "summary": "fraud" } }
    ],
    "should": [
      { "term": { "priority": "HIGH" } },
      { "term": { "escalated": true } }
    ]
  }
}
```

Use case:

```text
Relevant documents still required, but high-priority documents rank higher.
```

## 36.5 Missing Metadata

```json
{
  "bool": {
    "filter": [
      { "term": { "tenant_id": "tenant-001" } }
    ],
    "must_not": [
      { "exists": { "field": "classification" } }
    ]
  }
}
```

Use case:

```text
Find documents needing enrichment or classification.
```

---

## 37. How to Read Any Query DSL

Saat melihat query DSL kompleks, baca dengan urutan ini:

1. Apa top-level query-nya?
2. Apa relevance core-nya?
3. Apa hard filters-nya?
4. Apa permission filters-nya?
5. Apa exclusions-nya?
6. Apa optional boosts-nya?
7. Ada `minimum_should_match` atau tidak?
8. Field apa saja yang dipakai?
9. Apakah field mapping sesuai?
10. Apakah analyzer sesuai?
11. Apakah sort merusak score?
12. Apakah query bisa mahal?
13. Apakah user input tervalidasi?
14. Apakah query bisa diuji?

Contoh membaca:

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "body": "market abuse" } }
      ],
      "filter": [
        { "term": { "tenant_id": "regulator-a" } },
        { "range": { "created_at": { "gte": "now-1y" } } }
      ],
      "should": [
        { "match": { "title": "market abuse" } }
      ]
    }
  }
}
```

Interpretasi:

```text
Cari body yang relevan dengan market abuse.
Batasi tenant regulator-a.
Batasi created_at setahun terakhir.
Jika title juga match, naikkan score.
```

Pertanyaan follow-up:

```text
Apakah now-1y acceptable untuk audit reproducibility?
Apakah title boost cukup?
Apakah permission filter hilang?
Apakah deleted/suppressed exclusion hilang?
```

---

## 38. Reproducibility: Date Math dan Audit

Elasticsearch mendukung date math seperti `now-30d`.

Contoh:

```json
{
  "range": {
    "created_at": {
      "gte": "now-30d"
    }
  }
}
```

Bagus untuk operational dashboard.

Namun untuk audit/regulatory query, hati-hati:

```text
"now-30d" pada hari ini berbeda dengan "now-30d" besok.
```

Jika perlu reproducibility, application layer sebaiknya resolve menjadi timestamp konkret:

```json
{
  "range": {
    "created_at": {
      "gte": "2026-05-22T00:00:00Z",
      "lt": "2026-06-21T00:00:00Z"
    }
  }
}
```

Simpan:

- resolved time range,
- user timezone,
- query criteria,
- query template version,
- index alias/version,
- result snapshot jika dibutuhkan.

---

## 39. Query Template Versioning

Dalam sistem matang, query behavior berubah dari waktu ke waktu.

Contoh:

```text
CASE_SEARCH_V1: search title + summary
CASE_SEARCH_V2: add allegation_text
CASE_SEARCH_V3: add priority boost
CASE_SEARCH_V4: change minimum_should_match
```

Simpan query template version di log.

Manfaat:

- debugging regression,
- A/B testing,
- audit,
- rollback,
- relevance comparison,
- incident analysis.

Jangan mengubah relevance behavior tanpa jejak.

---

## 40. Anti-Patterns

## 40.1 Raw Query DSL from Public API

```text
Public user sends arbitrary Elasticsearch JSON.
```

Bahaya:

- security,
- performance,
- compatibility,
- business semantics bypass.

## 40.2 All Conditions in `must`

```json
{
  "bool": {
    "must": [
      { "match": { "summary": "fraud" } },
      { "term": { "tenant_id": "t1" } },
      { "term": { "status": "OPEN" } }
    ]
  }
}
```

Masalah:

- score polluted,
- intent tidak jelas.

## 40.3 `should` Without Understanding Defaults

```json
{
  "bool": {
    "must": [
      { "match": { "summary": "fraud" } }
    ],
    "should": [
      { "term": { "status": "OPEN" } }
    ]
  }
}
```

Jika maksudnya status wajib OPEN, ini salah.

## 40.4 Post-Search Authorization

```text
Search globally, filter unauthorized docs in Java.
```

Ini bisa membocorkan count, facet, ranking, dan pagination.

## 40.5 One Query for All Intents

```text
Identifier lookup, full-text search, browse, export, autocomplete semua memakai query yang sama.
```

Hasil:

- query terlalu kompleks,
- ranking buruk,
- performance tidak stabil,
- behavior sulit dijelaskan.

## 40.6 No Query Tests

```text
Query builder berubah tanpa test.
```

Search regression sering tidak terlihat sampai user mengeluh.

---

## 41. Mini Exercise

Gunakan mapping konseptual berikut:

```json
{
  "case_id": { "type": "keyword" },
  "tenant_id": { "type": "keyword" },
  "title": {
    "type": "text",
    "fields": {
      "keyword": { "type": "keyword" }
    }
  },
  "summary": { "type": "text" },
  "status": { "type": "keyword" },
  "created_at": { "type": "date" },
  "owner_user_id": { "type": "keyword" },
  "viewer_group_ids": { "type": "keyword" },
  "deleted": { "type": "boolean" }
}
```

Requirement:

```text
User user-1 dari tenant regulator-a mencari "late filing".
Dia boleh lihat case jika owner_user_id=user-1 atau viewer_group_ids mengandung group-a/group-b.
Hanya status OPEN atau ESCALATED.
Jangan tampilkan deleted.
Ambil hasil relevan teratas.
```

Query yang diharapkan:

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "late filing",
            "fields": ["title^3", "summary"]
          }
        }
      ],
      "filter": [
        { "term": { "tenant_id": "regulator-a" } },
        { "terms": { "status": ["OPEN", "ESCALATED"] } },
        {
          "bool": {
            "should": [
              { "term": { "owner_user_id": "user-1" } },
              { "terms": { "viewer_group_ids": ["group-a", "group-b"] } }
            ],
            "minimum_should_match": 1
          }
        }
      ],
      "must_not": [
        { "term": { "deleted": true } }
      ]
    }
  },
  "size": 20
}
```

Cek:

- Query text masuk relevance context.
- Tenant/status/permission masuk filter context.
- Deleted masuk exclusion.
- OR permission tidak mempengaruhi score.

---

## 42. Mini Exercise: Identify the Bug

Query:

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "summary": "market abuse" } },
        { "term": { "tenant_id": "regulator-a" } }
      ],
      "should": [
        { "term": { "owner_user_id": "user-1" } },
        { "terms": { "viewer_group_ids": ["group-a"] } }
      ],
      "minimum_should_match": 1
    }
  }
}
```

Bug:

1. `tenant_id` sebaiknya di `filter`, bukan `must`.
2. Permission OR berada di top-level `should` query context, sehingga bisa mempengaruhi score.
3. Karena `minimum_should_match: 1`, permission memang menjadi wajib, tetapi tetap scoring context.
4. Tidak ada deleted/suppressed exclusion jika business membutuhkan.

Perbaikan:

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "summary": "market abuse" } }
      ],
      "filter": [
        { "term": { "tenant_id": "regulator-a" } },
        {
          "bool": {
            "should": [
              { "term": { "owner_user_id": "user-1" } },
              { "terms": { "viewer_group_ids": ["group-a"] } }
            ],
            "minimum_should_match": 1
          }
        }
      ],
      "must_not": [
        { "term": { "deleted": true } }
      ]
    }
  }
}
```

---

## 43. Operational Checklist for Query DSL Foundation

Sebelum query masuk production:

```text
[ ] Query intent jelas: search, browse, lookup, export, autocomplete.
[ ] Text relevance clause dipisah dari filter.
[ ] Tenant filter selalu injected dari auth context.
[ ] Permission filter masuk Elasticsearch, bukan post-filter Java.
[ ] Lifecycle visibility jelas.
[ ] Soft-deleted/suppressed docs excluded.
[ ] should clause punya semantics jelas: boost atau requirement.
[ ] minimum_should_match eksplisit jika should dipakai sebagai requirement.
[ ] Field mapping sesuai query type.
[ ] Analyzer sesuai search behavior.
[ ] User input tervalidasi.
[ ] Page size dibatasi.
[ ] Sort whitelist.
[ ] Expensive query tidak exposed ke public user.
[ ] Query builder modular.
[ ] Query template/version dilog.
[ ] Query punya unit/integration tests.
[ ] Slow query bisa diobservasi.
```

---

## 44. Kesimpulan

Query DSL adalah fondasi operasional Elasticsearch.

Mental model paling penting dari part ini:

```text
Query DSL bukan sekadar WHERE clause JSON.
Query DSL adalah cara menyusun candidate generation, filtering, scoring, ranking, security, dan product semantics.
```

Hal yang harus melekat:

1. Pisahkan query context dan filter context.
2. Gunakan `match` untuk human language, `term/terms` untuk exact values.
3. Jadikan `bool` sebagai pusat composition.
4. Pahami `should` dan `minimum_should_match`.
5. Permission dan tenant adalah filter invariant.
6. Jangan membangun query dengan string concatenation.
7. Expose search intent di API, bukan raw Query DSL.
8. Query harus diuji seperti business logic lain.
9. Mapping, analyzer, dan query harus dirancang bersama.
10. Query production harus explainable, observable, dan evolvable.

Engineer yang mahir Elasticsearch tidak hanya bertanya:

```text
Query apa yang menghasilkan data?
```

Mereka bertanya:

```text
Query apa yang merepresentasikan intent dengan benar,
aman terhadap data leakage,
stabil secara performance,
terukur secara relevance,
dan bisa berevolusi tanpa merusak contract?
```

Itulah perbedaan antara Elasticsearch sebagai tool dan Elasticsearch sebagai search platform.

---

## 45. Referensi Utama

- Elastic Docs — Query DSL
- Elastic Docs — Boolean query
- Elastic Docs — Query and filter context
- Elastic Docs — `minimum_should_match`
- Elastic Docs — Match query
- Elastic Docs — Term-level queries
- Elastic Docs — Java API Client
- Elastic Docs — Searching for documents with Java client

---

## 46. Apa Selanjutnya

Part berikutnya:

```text
Part 009 — Full-Text Query Patterns
```

Kita akan masuk lebih dalam ke:

- `match`,
- `match_phrase`,
- `multi_match`,
- `query_string`,
- `simple_query_string`,
- prefix/wildcard/regexp,
- field boosting,
- cross-field search,
- search-as-you-type,
- autocomplete architecture,
- dan bagaimana membangun search UI behavior yang sesuai dengan backend query reality.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-007.md">⬅️ Part 007 — Text Analysis Pipeline</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-009.md">Part 009 — Full-Text Query Patterns ➡️</a>
</div>
