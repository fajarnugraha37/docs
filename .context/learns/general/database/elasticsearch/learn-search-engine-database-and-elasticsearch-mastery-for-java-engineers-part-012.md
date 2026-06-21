# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-012.md

# Part 012 — Filtering, Faceting, and Aggregations for Search UX

## Status Seri

Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
Part: `012` dari `034`  
Status: **belum selesai**

## Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, Anda diharapkan mampu:

1. Membedakan **query**, **filter**, **facet**, dan **aggregation** secara konseptual maupun teknis.
2. Mendesain search API yang menghasilkan **hits + facet counts** secara konsisten.
3. Memahami kapan memakai `filter`, `post_filter`, `global aggregation`, `filter aggregation`, `filters aggregation`, `terms aggregation`, `range aggregation`, dan `date_histogram`.
4. Menghindari kesalahan umum pada faceted search: count tidak sesuai, filter saling mematikan, aggregation terlalu mahal, cardinality tinggi, dan UX ambigu.
5. Membaca search requirement dari sudut pandang product/user journey, bukan hanya query DSL.
6. Mendesain filtering/faceting untuk sistem enterprise/regulatory/case management dengan permission, lifecycle, tenant, dan auditability.

---

# 1. Mengapa Part Ini Penting

Banyak engineer menganggap Elasticsearch search page hanya terdiri dari:

```text
keyword masuk -> query jalan -> hasil keluar
```

Padahal search experience production biasanya berbentuk:

```text
keyword + filters + facets + sorting + pagination + permission + aggregation counts + highlighting
```

Contoh halaman search enterprise:

```text
Search: "late filing"

Filters:
- Status: Open, Under Review, Closed
- Severity: Low, Medium, High, Critical
- Region: Jakarta, Bandung, Surabaya
- Assigned Unit: Enforcement, Legal, Compliance
- Date Range: Last 7 days, Last 30 days, This Year
- Entity Type: Case, Party, Document, Decision

Results:
- 10 documents/cases displayed

Facets:
Status
  Open (142)
  Under Review (89)
  Closed (421)

Severity
  Critical (17)
  High (66)
  Medium (290)
  Low (279)

Region
  Jakarta (388)
  Bandung (102)
  Surabaya (74)
```

Di titik ini, search tidak lagi sekadar ranking. Search menjadi **interactive narrowing system**.

User tidak selalu tahu query yang tepat. Ia sering melakukan:

1. Mengetik keyword kasar.
2. Melihat kategori hasil.
3. Memilih filter.
4. Memperbaiki query.
5. Mengganti sort.
6. Melihat facet count.
7. Menyimpulkan apakah corpus relevan.

Facet dan aggregation memberi user **peta navigasi** atas result set.

Tanpa facet yang benar:

- User sulit memahami distribusi hasil.
- Filter terasa acak.
- Count membingungkan.
- Query dianggap salah padahal data ada.
- Tim support menerima komplain “search tidak akurat”.
- Auditor bertanya “mengapa hasil ini muncul/tidak muncul?” dan sistem tidak punya jawaban defensible.

---

# 2. Mental Model: Query, Filter, Facet, Aggregation

## 2.1 Query

Query menjawab:

```text
Dokumen mana yang cocok secara semantik/leksikal dengan intent user?
```

Contoh:

```json
{
  "match": {
    "description": "late filing"
  }
}
```

Query biasanya berkontribusi pada `_score`.

Contoh query cocok untuk:

- full-text search
- relevance ranking
- typo tolerance
- phrase match
- semantic intent
- boosted fields

## 2.2 Filter

Filter menjawab:

```text
Dari dokumen yang mungkin cocok, dokumen mana yang memenuhi constraint eksplisit?
```

Contoh:

```json
{
  "term": {
    "status": "OPEN"
  }
}
```

Filter biasanya tidak berkontribusi pada score.

Contoh filter:

- `tenant_id = abc`
- `status IN (OPEN, UNDER_REVIEW)`
- `created_at >= 2026-01-01`
- `severity = HIGH`
- `visible_to_user_ids contains current_user`
- `deleted = false`

Filter adalah constraint. Query adalah intent.

## 2.3 Facet

Facet adalah pilihan navigasi yang ditampilkan ke user berdasarkan result set.

Contoh:

```text
Status
- Open (142)
- Under Review (89)
- Closed (421)
```

Facet biasanya dihasilkan dari aggregation.

Facet menjawab:

```text
Dalam result set saat ini, distribusi nilai field ini seperti apa?
```

## 2.4 Aggregation

Aggregation adalah mekanisme Elasticsearch untuk menghitung bucket atau metric.

Contoh bucket aggregation:

- terms aggregation
- range aggregation
- date histogram aggregation
- filter aggregation
- filters aggregation

Contoh metric aggregation:

- count implicitly via `doc_count`
- min
- max
- avg
- sum
- cardinality

Search UX paling sering memakai bucket aggregation untuk facet.

---

# 3. Search Result vs Search Navigation

Search result adalah daftar item yang ditampilkan.

Search navigation adalah struktur untuk membantu user mempersempit/menjelajahi hasil.

Keduanya tidak selalu memiliki scope yang sama.

Contoh:

User mencari:

```text
keyword = "fraud"
filter status = OPEN
```

Pertanyaan untuk result:

```text
Tampilkan hanya case fraud yang OPEN.
```

Pertanyaan untuk facet status bisa berbeda:

```text
Untuk keyword "fraud", berapa jumlah per status, termasuk CLOSED dan UNDER_REVIEW?
```

Atau bisa juga:

```text
Untuk keyword "fraud" dan semua filter lain kecuali filter status, berapa jumlah per status?
```

Ini adalah inti kompleksitas faceted search.

Facet bukan sekadar aggregation. Facet adalah keputusan UX.

---

# 4. Query Context vs Filter Context Revisited

Dalam Elasticsearch, query dalam `filter` clause pada `bool` query berjalan dalam **filter context**. Artinya scoring diabaikan dan clause tersebut diperlakukan sebagai constraint, bukan contributor relevance.

Contoh:

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "match": {
            "description": "late filing"
          }
        }
      ],
      "filter": [
        {
          "term": {
            "status": "OPEN"
          }
        },
        {
          "range": {
            "created_at": {
              "gte": "2026-01-01"
            }
          }
        }
      ]
    }
  }
}
```

Mental model:

```text
must   -> matching + scoring
filter -> matching only, no scoring
```

Gunakan `filter` untuk constraint yang tidak perlu memengaruhi ranking.

Contoh bagus untuk filter:

- tenant
- permission
- lifecycle visibility
- status
- date range
- region
- category
- exact type
- archival flag

Contoh yang biasanya bukan filter:

- keyword relevance
- phrase relevance
- title/body boost
- semantic similarity
- query intent

---

# 5. Mengapa Filter Penting untuk Search UX

Filter memberi user kontrol eksplisit.

Misalnya user mengetik:

```text
"late filing"
```

User mungkin ingin:

- semua kasus late filing
- hanya kasus aktif
- hanya kasus critical
- hanya dokumen evidence
- hanya case di wilayah tertentu
- hanya case yang assigned ke unit tertentu

Tanpa filter, search terlalu luas.

Dengan filter buruk, search terasa rusak.

Contoh filter buruk:

```text
Status dropdown berisi value yang tidak ada di result set.
Count tidak berubah ketika filter dipilih.
Facet region menunjukkan angka yang tidak sesuai.
Date range menampilkan hasil di luar range karena timezone tidak konsisten.
Permission filter diterapkan ke hits tapi tidak ke aggregations.
```

Kasus terakhir sangat berbahaya.

Jika hits sudah difilter berdasarkan permission tetapi aggregation belum, user bisa melihat bocoran data melalui count.

Contoh:

```text
User tidak boleh melihat case confidential.
Hits: tidak menampilkan confidential cases.
Facet:
  Confidential (3)
```

Ini data leakage.

Dalam sistem regulated, count bisa menjadi sensitive information.

---

# 6. Anatomy Search Request dengan Hits dan Facets

Search request production biasanya memiliki struktur konseptual seperti ini:

```text
SearchRequest
- keyword
- filters
  - tenant
  - permission
  - lifecycle visibility
  - business filters
- sort
- pagination
- aggregations
- highlight
```

Dalam Elasticsearch:

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "late filing",
            "fields": ["title^3", "summary^2", "description"]
          }
        }
      ],
      "filter": [
        { "term": { "tenant_id": "tenant-a" } },
        { "term": { "deleted": false } },
        { "terms": { "status": ["OPEN", "UNDER_REVIEW"] } }
      ]
    }
  },
  "aggs": {
    "status_facet": {
      "terms": {
        "field": "status",
        "size": 20
      }
    },
    "severity_facet": {
      "terms": {
        "field": "severity",
        "size": 10
      }
    }
  },
  "from": 0,
  "size": 10
}
```

Dalam request ini:

- hits mengikuti query + filter
- aggregations juga dihitung atas query + filter

Ini adalah default yang sering tepat.

Tetapi untuk beberapa UX facet, behavior ini belum cukup.

---

# 7. The Facet Count Problem

Masalah klasik:

```text
Ketika user memilih filter Status = OPEN,
facet Status hanya menampilkan OPEN.
Padahal UX ingin tetap menampilkan status lain dengan count.
```

Contoh:

Sebelum filter:

```text
Status
- Open (142)
- Under Review (89)
- Closed (421)
```

Setelah user pilih `Open`:

Pilihan A — constrained facet:

```text
Status
- Open (142)
```

Pilihan B — self-excluding facet:

```text
Status
- Open (142) [selected]
- Under Review (89)
- Closed (421)
```

Pilihan C — selected-aware multi-select facet:

```text
Status
- Open (142) [selected]
- Under Review (231 if added)
- Closed (563 if added)
```

Pilihan mana yang benar?

Jawabannya tergantung UX semantics.

Search engineer top-tier tidak langsung menulis aggregation. Ia bertanya:

```text
Count ini berarti apa?
```

---

# 8. Facet Semantics

## 8.1 Constrained Facet

Facet dihitung setelah semua filter diterapkan.

Jika user memilih `status=OPEN`, maka status facet hanya melihat dokumen OPEN.

Cocok untuk:

- filter final
- dashboard sederhana
- user tidak perlu melihat alternatif
- count harus sama persis dengan current result set

Contoh:

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "description": "fraud" } }
      ],
      "filter": [
        { "term": { "status": "OPEN" } }
      ]
    }
  },
  "aggs": {
    "status": {
      "terms": {
        "field": "status"
      }
    }
  }
}
```

## 8.2 Global Facet

Facet dihitung atas seluruh index/corpus, tidak mengikuti query/filter tertentu.

Cocok untuk:

- navigation global
- corpus overview
- admin dashboard
- statistik umum

Tetapi untuk search UX, global facet sering misleading.

Contoh:

User cari `fraud`, tetapi facet status menampilkan count semua dokumen, bukan hanya hasil `fraud`.

```text
Search: fraud
Status
- Open (10,000)     <- global count, not fraud count
- Closed (90,000)
```

User bisa salah mengira ada 10,000 open fraud cases.

## 8.3 Self-Excluding Facet

Facet dihitung dengan semua filter kecuali filter facet itu sendiri.

Contoh:

Current filters:

```text
keyword = fraud
status = OPEN
severity = HIGH
region = JAKARTA
```

Untuk `status_facet`, aggregation dihitung dengan:

```text
keyword = fraud
severity = HIGH
region = JAKARTA
```

Tetapi tanpa:

```text
status = OPEN
```

Ini membuat user tetap melihat alternatif status dalam konteks filter lain.

Cocok untuk:

- e-commerce search
- case search
- multi-filter exploration
- user ingin mengganti filter tanpa reset manual

## 8.4 Multi-Select OR Facet

Dalam satu facet, beberapa value bisa dipilih sebagai OR.

Contoh:

```text
Status = OPEN OR UNDER_REVIEW
Severity = HIGH OR CRITICAL
Region = JAKARTA
```

Semantics:

```text
(status in [OPEN, UNDER_REVIEW])
AND (severity in [HIGH, CRITICAL])
AND region = JAKARTA
```

Ini umum pada faceted search.

Kesalahan umum adalah memperlakukan semua selected values sebagai AND.

Untuk field single-valued, `status=OPEN AND status=CLOSED` mustahil.

---

# 9. `post_filter`: Kapan Dipakai

`post_filter` memfilter hits setelah aggregations dihitung.

Mental model:

```text
query -> aggregations dihitung
      -> post_filter diterapkan ke hits
      -> hits dikembalikan
```

Contoh use case:

User mencari `fraud`, ingin aggregation status atas semua fraud cases, tapi hits hanya `OPEN`.

```json
{
  "query": {
    "match": {
      "description": "fraud"
    }
  },
  "aggs": {
    "status": {
      "terms": {
        "field": "status"
      }
    }
  },
  "post_filter": {
    "term": {
      "status": "OPEN"
    }
  }
}
```

Hasil:

```text
Aggregations:
Status counts among all fraud documents

Hits:
Only fraud documents with status OPEN
```

Ini berguna, tetapi harus hati-hati.

`post_filter` bukan pengganti filter biasa.

Gunakan `query.bool.filter` jika filter harus memengaruhi hits dan aggregation.

Gunakan `post_filter` jika filter hanya ingin memengaruhi hits, tetapi aggregation harus tetap dihitung sebelum filter itu.

Rule praktis:

```text
Default: gunakan bool.filter.
Gunakan post_filter hanya ketika ada alasan UX facet yang jelas.
```

---

# 10. `filter` Aggregation

`filter` aggregation membuat satu bucket berdasarkan query/filter tertentu.

Contoh:

```json
{
  "size": 0,
  "aggs": {
    "open_cases": {
      "filter": {
        "term": {
          "status": "OPEN"
        }
      }
    }
  }
}
```

Output:

```json
{
  "aggregations": {
    "open_cases": {
      "doc_count": 142
    }
  }
}
```

Ini berguna saat Anda ingin menghitung subset tertentu.

Contoh regulatory dashboard:

```text
- open critical cases
- overdue cases
- cases pending legal review
- cases due within 7 days
```

```json
{
  "size": 0,
  "aggs": {
    "overdue_cases": {
      "filter": {
        "range": {
          "sla_due_at": {
            "lt": "now"
          }
        }
      }
    }
  }
}
```

---

# 11. `filters` Aggregation

`filters` aggregation membuat banyak bucket berbasis beberapa filter.

Contoh:

```json
{
  "size": 0,
  "aggs": {
    "sla_buckets": {
      "filters": {
        "filters": {
          "overdue": {
            "range": {
              "sla_due_at": { "lt": "now" }
            }
          },
          "due_soon": {
            "range": {
              "sla_due_at": { "gte": "now", "lte": "now+7d" }
            }
          },
          "not_due_soon": {
            "range": {
              "sla_due_at": { "gt": "now+7d" }
            }
          }
        }
      }
    }
  }
}
```

Output konseptual:

```text
overdue: 17
due_soon: 43
not_due_soon: 801
```

Cocok untuk bucket yang tidak sekadar value field, melainkan business predicate.

Contoh:

```text
Risk
- Critical regulatory risk
- Potential breach
- Missing evidence
- Awaiting respondent
```

Setiap bucket bisa berupa query kompleks.

---

# 12. Terms Aggregation untuk Facets

`terms` aggregation adalah aggregation paling umum untuk facet kategori.

Contoh:

```json
{
  "aggs": {
    "status_facet": {
      "terms": {
        "field": "status",
        "size": 20
      }
    }
  }
}
```

Field yang umum untuk terms facet:

- status
- severity
- region
- category
- entity_type
- assigned_unit
- source_system
- lifecycle_stage

Biasanya field harus bertipe `keyword`, numeric, boolean, ip, atau field lain yang punya doc values. Jangan pakai `text` analyzed field untuk facet umum.

Salah:

```json
{
  "terms": {
    "field": "description"
  }
}
```

Kenapa salah?

Karena `description` adalah full-text field yang dianalisis menjadi token. Facet akan berisi token seperti:

```text
case
filing
late
fraud
review
```

Bukan kategori bisnis.

Benar:

```json
{
  "terms": {
    "field": "status"
  }
}
```

Atau untuk field multi-field:

```json
{
  "terms": {
    "field": "category.keyword"
  }
}
```

---

# 13. Terms Aggregation Accuracy and Top-N Semantics

Terms aggregation default-nya mengembalikan top terms berdasarkan `doc_count`.

Ini berarti:

```text
terms aggregation bukan selalu daftar semua value.
Ia adalah top-N bucket menurut order tertentu.
```

Jika field punya cardinality tinggi, misalnya:

```text
case_id
user_id
email
document_id
unique reference number
```

maka terms aggregation bisa mahal dan kurang cocok untuk facet.

Facet ideal biasanya low-to-medium cardinality:

```text
status: 5 values
severity: 4 values
region: 34 values
entity_type: 8 values
assigned_unit: 20 values
```

Bukan:

```text
case_id: 50 million values
customer_name: 5 million values
```

Jika product meminta facet atas high-cardinality field, tanya ulang semantics-nya:

```text
Apakah user benar-benar butuh facet?
Atau butuh autocomplete/filter lookup terpisah?
Atau butuh search within facet values?
Atau butuh top entities?
```

High-cardinality terms aggregation bisa menjadi performance trap.

---

# 14. Range Aggregation

Range aggregation membagi dokumen ke bucket numeric.

Contoh untuk amount:

```json
{
  "aggs": {
    "penalty_amount_ranges": {
      "range": {
        "field": "penalty_amount",
        "ranges": [
          { "to": 1000000 },
          { "from": 1000000, "to": 10000000 },
          { "from": 10000000, "to": 100000000 },
          { "from": 100000000 }
        ]
      }
    }
  }
}
```

Output konseptual:

```text
< 1M: 210
1M - 10M: 84
10M - 100M: 19
>= 100M: 3
```

Range facet cocok untuk:

- amount
- risk score
- age of case
- response time
- penalty amount
- transaction count
- number of violations

Range bucket harus didesain berdasarkan domain, bukan hanya interval matematis.

Buruk:

```text
0-10, 10-20, 20-30, 30-40
```

Jika user domain tidak berpikir seperti itu.

Lebih baik:

```text
No penalty
Below administrative threshold
Requires supervisor review
Requires executive approval
```

Dalam regulatory system, bucket range sering merepresentasikan policy threshold.

---

# 15. Date Range Aggregation

Date range aggregation membagi dokumen berdasarkan rentang tanggal.

Contoh:

```json
{
  "aggs": {
    "created_date_ranges": {
      "date_range": {
        "field": "created_at",
        "ranges": [
          { "key": "last_7_days", "from": "now-7d/d" },
          { "key": "last_30_days", "from": "now-30d/d" },
          { "key": "this_year", "from": "now/y" }
        ]
      }
    }
  }
}
```

Date range facet cocok untuk:

- created date
- updated date
- filing date
- breach date
- decision date
- due date
- closed date

Hal yang harus diperhatikan:

1. Timezone.
2. Inclusive/exclusive boundary.
3. Apakah field boleh null.
4. Apakah user melihat date dalam local timezone.
5. Apakah date range bucket saling overlap.

Contoh bucket overlap:

```text
last_7_days adalah subset dari last_30_days
```

Itu boleh jika UX menginginkan shortcut filter. Tetapi jangan dipresentasikan seperti histogram mutually exclusive.

---

# 16. Date Histogram Aggregation

Date histogram membuat bucket berdasarkan interval waktu.

Contoh:

```json
{
  "aggs": {
    "cases_over_time": {
      "date_histogram": {
        "field": "created_at",
        "calendar_interval": "month"
      }
    }
  }
}
```

Output konseptual:

```text
2026-01: 120
2026-02: 144
2026-03: 98
2026-04: 201
```

Cocok untuk:

- trend search results over time
- filing volume
- case creation trend
- incident trend
- document ingestion trend
- SLA breach trend

Ada dua jenis interval penting:

## 16.1 Calendar Interval

Calendar interval mengikuti kalender.

Contoh:

```json
"calendar_interval": "month"
```

Bulan tidak selalu memiliki jumlah hari yang sama.

Cocok untuk laporan manusia:

```text
per day, per week, per month, per quarter, per year
```

## 16.2 Fixed Interval

Fixed interval memakai durasi tetap.

Contoh:

```json
"fixed_interval": "1h"
```

Cocok untuk observability/time-series teknis:

```text
per 5 minutes
per hour
per 12 hours
```

Untuk search UX bisnis, calendar interval sering lebih intuitif.

---

# 17. Aggregation Scope: Pertanyaan Paling Penting

Sebelum membuat aggregation, selalu tanyakan:

```text
Aggregation ini dihitung atas dokumen yang mana?
```

Kemungkinan scope:

1. Seluruh index.
2. Seluruh tenant.
3. Seluruh dokumen yang user boleh lihat.
4. Hasil keyword query saja.
5. Hasil keyword + semua filter.
6. Hasil keyword + semua filter kecuali filter facet itu sendiri.
7. Hasil sebelum pagination.
8. Hasil setelah permission filter.
9. Hasil setelah lifecycle visibility.

Untuk search result page, aggregation biasanya dihitung sebelum pagination.

Pagination hanya memengaruhi hits yang ditampilkan, bukan total matched set.

Contoh:

```text
Query matches 10,000 docs.
Page size 10.
Facet count harus dihitung atas 10,000 docs, bukan 10 docs page pertama.
```

Jika facet dihitung atas page pertama, UX akan sangat salah.

---

# 18. Permission-Aware Aggregation

Dalam sistem enterprise, permission filter harus diterapkan secara konsisten pada hits dan aggregations.

Contoh base filters:

```json
[
  { "term": { "tenant_id": "tenant-a" } },
  { "term": { "deleted": false } },
  { "terms": { "visibility_group_ids": ["group-1", "group-9"] } }
]
```

Jika hits memakai filter permission tetapi aggregation tidak, user bisa melihat count dari dokumen yang tidak boleh diakses.

Contoh kebocoran:

```text
Facet: Assigned Unit
- Internal Investigation (2)
```

Walaupun user tidak bisa membuka dokumennya, keberadaan 2 case bisa sensitive.

Rule:

```text
Security filters are not UX filters.
Security filters are mandatory scope constraints.
```

Mereka harus selalu diterapkan pada:

- hits
- aggregations
- suggestions jika sensitive
- autocomplete jika sensitive
- count endpoint
- export endpoint
- saved search

---

# 19. Tenant Filter Is Not Optional

Dalam multi-tenant system, tenant filter harus menjadi base scope.

Contoh:

```json
{
  "term": {
    "tenant_id": "tenant-a"
  }
}
```

Jangan mengandalkan index-per-tenant saja tanpa disiplin query jika sistem masih memungkinkan cross-tenant index.

Model tenant:

1. Index per tenant.
2. Shared index with tenant field.
3. Hybrid: large tenant dedicated index, small tenants shared index.

Apapun modelnya, search API harus punya invariant:

```text
Tidak ada request user biasa yang bisa membaca atau menghitung data tenant lain.
```

Facet count termasuk membaca.

---

# 20. Lifecycle Filter

Banyak domain punya lifecycle state:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
ESCALATED
DECIDED
CLOSED
ARCHIVED
DELETED
SUPERSEDED
```

Tidak semua state boleh muncul di semua search experience.

Contoh:

- Investigator melihat `UNDER_REVIEW`, `ESCALATED`.
- Public portal hanya melihat `DECIDED`, `PUBLISHED`.
- Auditor melihat `ARCHIVED`.
- Normal user tidak melihat `DELETED`, tapi admin bisa.

Lifecycle filter harus eksplisit.

Buruk:

```text
Search default mengambil semua status kecuali deleted.
```

Lebih baik:

```text
Search context menentukan visible lifecycle states.
```

Contoh:

```json
{
  "terms": {
    "lifecycle_state": ["SUBMITTED", "UNDER_REVIEW", "ESCALATED"]
  }
}
```

Ini penting untuk defensibility:

```text
Mengapa case closed tidak muncul dalam work queue search?
Karena work queue search scope hanya active actionable states.
```

---

# 21. Facet Contract untuk API Backend

Search API sebaiknya punya contract eksplisit.

Contoh request:

```json
{
  "keyword": "late filing",
  "filters": {
    "status": ["OPEN", "UNDER_REVIEW"],
    "severity": ["HIGH"],
    "region": ["JAKARTA"]
  },
  "facets": ["status", "severity", "region", "created_month"],
  "sort": [
    { "field": "relevance", "direction": "desc" },
    { "field": "created_at", "direction": "desc" }
  ],
  "page": {
    "size": 10,
    "cursor": null
  }
}
```

Contoh response:

```json
{
  "total": 142,
  "items": [
    {
      "id": "case-123",
      "title": "Late filing investigation",
      "status": "OPEN",
      "severity": "HIGH",
      "score": 12.41
    }
  ],
  "facets": {
    "status": {
      "type": "terms",
      "selection_mode": "multi",
      "count_scope": "self_excluding",
      "buckets": [
        { "value": "OPEN", "label": "Open", "count": 142, "selected": true },
        { "value": "UNDER_REVIEW", "label": "Under Review", "count": 89, "selected": true },
        { "value": "CLOSED", "label": "Closed", "count": 421, "selected": false }
      ]
    }
  }
}
```

Perhatikan field:

```json
"count_scope": "self_excluding"
```

Ini bukan detail Elasticsearch. Ini contract UX.

Backend yang bagus tidak membiarkan frontend menebak arti count.

---

# 22. Designing Facet Definitions

Untuk sistem besar, facet sebaiknya didefinisikan secara declarative.

Contoh pseudo-code Java:

```java
public record FacetDefinition(
    String name,
    String field,
    FacetType type,
    SelectionMode selectionMode,
    CountScope countScope,
    int size,
    boolean securitySensitive
) {}
```

Contoh:

```java
FacetDefinition statusFacet = new FacetDefinition(
    "status",
    "status",
    FacetType.TERMS,
    SelectionMode.MULTI_OR,
    CountScope.SELF_EXCLUDING,
    20,
    false
);
```

Mengapa ini penting?

Karena tanpa registry facet, query builder akan menjadi penuh `if-else`.

Registry membantu:

- validasi request
- mapping field whitelist
- mencegah arbitrary aggregation dari user
- mengontrol size
- mengontrol count semantics
- membuat response konsisten
- dokumentasi internal
- testing

Jangan memberi user kemampuan bebas mengirim field aggregation langsung ke Elasticsearch.

Bahaya:

```json
{
  "facet": "some_high_cardinality_field"
}
```

Atau lebih buruk:

```json
{
  "script": "..."
}
```

Search API harus expose capability, bukan expose Elasticsearch mentah.

---

# 23. Filter Schema Design

Filter schema harus jelas:

```text
filter name -> field -> operator -> allowed values -> selection mode
```

Contoh:

| Filter | Field | Operator | Mode |
|---|---|---|---|
| status | `status` | terms | OR within same filter |
| severity | `severity` | terms | OR within same filter |
| region | `region_code` | terms | OR within same filter |
| createdDate | `created_at` | range | single range |
| overdue | `sla_due_at` | derived predicate | boolean |

Internal boolean logic biasanya:

```text
AND between filter groups
OR within selected values of same filter
```

Contoh:

```text
(status = OPEN OR UNDER_REVIEW)
AND (severity = HIGH OR CRITICAL)
AND (region = JAKARTA)
```

Elasticsearch DSL:

```json
{
  "bool": {
    "filter": [
      { "terms": { "status": ["OPEN", "UNDER_REVIEW"] } },
      { "terms": { "severity": ["HIGH", "CRITICAL"] } },
      { "term": { "region_code": "JAKARTA" } }
    ]
  }
}
```

---

# 24. Common Mistake: AND dalam Same Facet

Kesalahan umum:

User memilih:

```text
Status: OPEN, CLOSED
```

Backend membangun:

```json
{
  "bool": {
    "filter": [
      { "term": { "status": "OPEN" } },
      { "term": { "status": "CLOSED" } }
    ]
  }
}
```

Untuk single-valued field, ini mustahil.

Benar:

```json
{
  "terms": {
    "status": ["OPEN", "CLOSED"]
  }
}
```

Atau:

```json
{
  "bool": {
    "should": [
      { "term": { "status": "OPEN" } },
      { "term": { "status": "CLOSED" } }
    ],
    "minimum_should_match": 1
  }
}
```

Jika berada di filter context, bool should tetap bisa dipakai sebagai OR constraint.

Namun untuk simple exact values, `terms` lebih ringkas.

---

# 25. Common Mistake: Faceting on Analyzed Text

Mapping:

```json
{
  "properties": {
    "category": {
      "type": "text"
    }
  }
}
```

Aggregation:

```json
{
  "terms": {
    "field": "category"
  }
}
```

Ini biasanya gagal atau menghasilkan behavior buruk karena `text` field tidak cocok untuk terms aggregation secara default.

Desain yang benar:

```json
{
  "properties": {
    "category": {
      "type": "text",
      "fields": {
        "keyword": {
          "type": "keyword"
        }
      }
    }
  }
}
```

Lalu aggregation:

```json
{
  "terms": {
    "field": "category.keyword"
  }
}
```

Namun untuk kategori bisnis, sering lebih baik langsung:

```json
{
  "category_code": { "type": "keyword" },
  "category_label": { "type": "keyword" }
}
```

Jangan bergantung pada label sebagai source-of-truth filter jika label bisa berubah karena localization.

Lebih aman:

```text
value: REGULATORY_BREACH
label: Regulatory Breach
```

Search index menyimpan code, UI melakukan label mapping.

---

# 26. Common Mistake: `size: 0` Dilupakan

Jika request hanya butuh aggregation, gunakan:

```json
{
  "size": 0,
  "aggs": {
    "status": {
      "terms": {
        "field": "status"
      }
    }
  }
}
```

Tanpa `size: 0`, Elasticsearch tetap mengembalikan hits default.

Untuk dashboard/count endpoint, hits mungkin tidak diperlukan.

Mengurangi response size membantu latency dan network cost.

---

# 27. Common Mistake: Aggregation Tidak Mengikuti Filter

User request:

```text
Search fraud cases in Jakarta
```

Hits difilter Jakarta, tetapi facet severity dihitung global.

Akibat:

```text
Severity facet menunjukkan count seluruh region.
User memilih severity HIGH dan hasil tiba-tiba jauh lebih sedikit.
```

Ini menciptakan distrust.

Rule:

```text
Facet count harus punya semantics yang konsisten dan terdokumentasi.
```

Kalau count global, label harus jelas:

```text
Global distribution
```

Kalau count current-result-set, pastikan semua filter relevan diterapkan.

---

# 28. Common Mistake: Aggregation Terlalu Banyak dalam Satu Search Request

Search page sering ingin banyak facet:

```text
status
severity
region
assigned_user
assigned_unit
source
category
created_month
closed_month
risk_score_range
sla_bucket
entity_type
```

Semua aggregation dihitung setiap request bisa mahal.

Pertanyaan arsitektural:

1. Facet mana yang benar-benar diperlukan di initial load?
2. Facet mana yang bisa lazy-loaded?
3. Facet mana yang high cardinality?
4. Facet mana yang berubah saat keyword berubah?
5. Facet mana yang bisa precomputed?
6. Facet mana yang sensitive terhadap permission?

Strategi:

- tampilkan 4-6 facet utama
- lazy-load advanced facets
- batasi `size`
- whitelist fields
- hindari high-cardinality aggregations default
- gunakan separate endpoint untuk facet search jika perlu

---

# 29. Common Mistake: Facet Counts Must Be Perfect untuk Semua Kasus

Tidak semua count harus sempurna secara real-time.

Pertimbangkan trade-off:

```text
Interactive search page:
- count cukup mendekati? mungkin tidak, tergantung domain.

Regulatory enforcement dashboard:
- count harus defensible.

Public disclosure portal:
- count harus konsisten dengan visibility.

Internal investigative search:
- count boleh near-real-time tetapi harus permission-safe.
```

Elasticsearch search bersifat near-real-time. Document yang baru di-index mungkin belum langsung muncul sampai refresh terjadi.

Jadi search UX harus punya freshness contract:

```text
Data search diperbarui secara near-real-time, bukan read-after-write transaksional sempurna.
```

Untuk workflow yang membutuhkan kepastian segera setelah submit, bisa gunakan:

- explicit refresh dengan hati-hati
- read dari source-of-truth untuk confirmation page
- asynchronous indexing status
- “may take a few seconds to appear in search”
- outbox lag monitoring

---

# 30. Cardinality Approximation

Cardinality aggregation menghitung estimasi unique count.

Contoh:

```json
{
  "aggs": {
    "unique_parties": {
      "cardinality": {
        "field": "party_id"
      }
    }
  }
}
```

Ini berguna untuk:

- jumlah unique parties
- jumlah unique cases
- jumlah unique respondents
- jumlah unique documents

Tetapi cardinality aggregation biasanya approximate.

Jangan gunakan tanpa memahami tolerance jika domain membutuhkan exact count.

Untuk regulatory reports, approximate unique count bisa berbahaya jika dipresentasikan sebagai angka final.

Label yang lebih jujur:

```text
Approximate unique parties
```

Atau gunakan source-of-truth database/reporting pipeline untuk exact official number.

---

# 31. Facets vs Analytics Dashboard

Elasticsearch aggregations sering menggoda engineer untuk membuat dashboard analytics langsung dari search index.

Pertanyaannya:

```text
Apakah search index ini dirancang sebagai analytical source?
```

Search index biasanya:

- denormalized untuk retrieval
- optimized untuk query search
- bisa punya duplicated representation
- bisa exclude beberapa field
- bisa near-real-time
- bisa berbeda dari canonical truth

Analytics official biasanya butuh:

- exact semantics
- reproducibility
- snapshot period
- audit trail
- historical correction
- dimensional modeling

Jika dashboard hanya exploratory, Elasticsearch boleh.

Jika dashboard adalah official regulatory metric, hati-hati.

Rule:

```text
Search aggregation bagus untuk interactive exploration.
Official reporting butuh stronger data contract.
```

Ini bukan berarti Elasticsearch tidak bisa dipakai untuk analytics. Tetapi index design dan governance-nya harus sesuai.

---

# 32. Example: Case Search Faceted UX

## 32.1 Requirement

User ingin mencari enforcement cases.

Capabilities:

- keyword search di title, summary, allegation, party names
- filter by status
- filter by severity
- filter by region
- filter by assigned unit
- filter by created date
- facet counts untuk status, severity, region, entity type
- hanya menampilkan case yang user boleh lihat

## 32.2 Search Request DTO

```java
public record CaseSearchRequest(
    String keyword,
    List<String> statuses,
    List<String> severities,
    List<String> regions,
    List<String> assignedUnits,
    DateRange createdDate,
    List<String> requestedFacets,
    int pageSize,
    String searchAfterCursor
) {}
```

## 32.3 Base Scope

Base scope bukan pilihan user.

```java
public record SearchScope(
    String tenantId,
    Set<String> visibilityGroupIds,
    Set<String> allowedLifecycleStates,
    boolean includeDeleted
) {}
```

Base filters:

```text
tenant_id = current tenant
visibility_group_ids intersects user groups
lifecycle_state in allowed states
deleted = false
```

## 32.4 Business Filters

Business filters berasal dari UI:

```text
status in selected statuses
severity in selected severities
region in selected regions
assigned_unit in selected units
created_at within selected date range
```

## 32.5 Query

Keyword query:

```json
{
  "multi_match": {
    "query": "late filing",
    "fields": [
      "case_title^4",
      "party_names^3",
      "summary^2",
      "allegation_text"
    ],
    "type": "best_fields"
  }
}
```

## 32.6 Full Elasticsearch Shape

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "late filing",
            "fields": [
              "case_title^4",
              "party_names^3",
              "summary^2",
              "allegation_text"
            ],
            "type": "best_fields"
          }
        }
      ],
      "filter": [
        { "term": { "tenant_id": "tenant-a" } },
        { "term": { "deleted": false } },
        { "terms": { "visibility_group_ids": ["grp-enforcement", "grp-legal"] } },
        { "terms": { "lifecycle_state": ["SUBMITTED", "UNDER_REVIEW", "ESCALATED"] } },
        { "terms": { "status": ["OPEN", "UNDER_REVIEW"] } },
        { "terms": { "severity": ["HIGH", "CRITICAL"] } },
        { "term": { "region_code": "JAKARTA" } }
      ]
    }
  },
  "aggs": {
    "status": {
      "terms": { "field": "status", "size": 20 }
    },
    "severity": {
      "terms": { "field": "severity", "size": 10 }
    },
    "region": {
      "terms": { "field": "region_code", "size": 50 }
    },
    "entity_type": {
      "terms": { "field": "entity_type", "size": 20 }
    }
  },
  "size": 10
}
```

Ini constrained facet. Semua facet dihitung setelah semua filters.

Untuk UX yang ingin self-excluding facets, query perlu lebih kompleks.

---

# 33. Self-Excluding Facets: Design Pattern

Misalnya current filters:

```text
status = OPEN
severity = HIGH
region = JAKARTA
```

Untuk menghitung `status` facet, gunakan semua filter kecuali `status`.

Untuk menghitung `severity` facet, gunakan semua filter kecuali `severity`.

Untuk menghitung `region` facet, gunakan semua filter kecuali `region`.

Konseptual:

```text
base query = keyword + security + tenant + lifecycle
business filters = status + severity + region

status facet scope = base query + severity + region
severity facet scope = base query + status + region
region facet scope = base query + status + severity
hits scope = base query + status + severity + region
```

Elasticsearch pattern:

- main query untuk hits bisa memakai semua filters
- aggregations bisa menggunakan `global` atau top-level query + nested `filter` aggregations untuk scope tertentu

Sederhana secara konsep, tetapi DSL bisa verbose.

Pseudo aggregation:

```json
{
  "aggs": {
    "status_scope": {
      "filter": {
        "bool": {
          "filter": [
            { "terms": { "severity": ["HIGH"] } },
            { "term": { "region_code": "JAKARTA" } }
          ]
        }
      },
      "aggs": {
        "status": {
          "terms": { "field": "status" }
        }
      }
    }
  }
}
```

Namun jangan lupa base security filters juga harus masuk scope facet.

Pattern robust:

```text
facet_scope(facetName) = baseScope + keywordQuery + allBusinessFiltersExcept(facetName)
```

---

# 34. Java Query Builder Pattern for Facets

Jangan membangun query secara ad-hoc di controller.

Struktur yang lebih baik:

```text
Controller
  -> validates request
  -> SearchApplicationService
       -> builds SearchIntent
       -> SearchQueryPlanner
            -> base scope
            -> keyword query
            -> business filters
            -> facet plans
       -> ElasticsearchAdapter
            -> translates plan to ES DSL
```

Pseudo-code:

```java
public final class SearchQueryPlan {
    private final Query keywordQuery;
    private final List<Query> baseFilters;
    private final Map<String, Query> businessFiltersByFacet;
    private final List<FacetPlan> facets;
}
```

Facet scope:

```java
List<Query> filtersForFacet(String facetName) {
    List<Query> filters = new ArrayList<>();
    filters.addAll(baseFilters);

    businessFiltersByFacet.forEach((name, filter) -> {
        if (!name.equals(facetName)) {
            filters.add(filter);
        }
    });

    return filters;
}
```

Benefit:

- semantics testable
- no copy-paste DSL
- easier to add new facet
- easier to audit permission filters
- easier to profile expensive facets
- easier to snapshot generated query for debugging

---

# 35. Filter and Facet Testing

Search filtering/faceting wajib dites dengan fixture kecil.

Contoh dataset:

| id | keyword | status | severity | region | visible_to |
|---|---|---|---|---|---|
| 1 | fraud | OPEN | HIGH | JKT | A |
| 2 | fraud | CLOSED | HIGH | JKT | A |
| 3 | fraud | OPEN | LOW | BDG | A |
| 4 | fraud | OPEN | HIGH | JKT | B |
| 5 | filing | OPEN | HIGH | JKT | A |

Test cases:

1. Keyword `fraud` returns docs 1,2,3 for user A.
2. Keyword `fraud` + status OPEN returns docs 1,3 for user A.
3. Status facet for constrained mode after status OPEN returns only OPEN count 2.
4. Status facet for self-excluding mode after status OPEN returns OPEN 2, CLOSED 1.
5. User A never sees count from doc 4.
6. Keyword `filing` does not affect `fraud` counts.
7. Region facet excludes region filter if self-excluding region facet.

Test bukan hanya hit IDs. Test facet counts.

---

# 36. Performance Model for Aggregations

Aggregation cost dipengaruhi oleh:

1. Jumlah dokumen yang match query/filter.
2. Cardinality field.
3. Jumlah shard.
4. Jumlah buckets.
5. Nested aggregations.
6. Sorting bucket.
7. Scripted aggregation.
8. Runtime fields.
9. Global ordinal loading.
10. Memory pressure.

Terms aggregation pada low-cardinality field biasanya aman.

Terms aggregation pada high-cardinality field bisa mahal.

Date histogram pada time range besar dengan interval kecil bisa menghasilkan banyak buckets.

Contoh berbahaya:

```text
5 years of data, fixed_interval = 1m
```

Jumlah bucket kira-kira:

```text
5 * 365 * 24 * 60 = 2,628,000 buckets
```

Itu buruk untuk interactive search.

Batasi interval dan date range.

---

# 37. Practical Guardrails

Search API harus punya guardrails:

```text
Max facets per request
Max terms size per facet
Max date histogram buckets
Allowed fields only
Allowed operators only
Max range width if needed
No arbitrary scripts
No user-controlled runtime fields
No aggregation on raw text
No aggregation on high-cardinality fields unless approved
Timeouts
Circuit breaker awareness
```

Contoh config:

```yaml
search:
  facets:
    maxRequestedFacets: 8
    defaultTermsSize: 10
    maxTermsSize: 50
    maxDateHistogramBuckets: 120
  query:
    timeoutMillis: 1500
```

Elasticsearch dapat menjalankan query yang sangat fleksibel. Production API tidak boleh mengekspos fleksibilitas penuh itu ke semua user.

---

# 38. UI Semantics: Disabled, Hidden, or Zero Count?

Ketika bucket count = 0, apa yang dilakukan UI?

Pilihan:

1. Sembunyikan bucket.
2. Tampilkan disabled.
3. Tampilkan 0.
4. Tetap tampilkan jika selected.

Contoh:

```text
Status
- Open (10)
- Closed (0)
```

Untuk regulated workflow, menampilkan `Closed (0)` bisa membantu user memahami bahwa filter valid tetapi tidak ada hasil.

Untuk e-commerce, menyembunyikan zero bucket bisa lebih bersih.

Untuk selected zero bucket, jangan hilangkan tiba-tiba karena user kehilangan kontrol untuk unselect.

Rule UX:

```text
Selected filters should remain visible even if their current count is zero.
```

---

# 39. Facet Labels and Localization

Search index biasanya menyimpan stable code:

```json
{
  "status": "UNDER_REVIEW",
  "severity": "HIGH",
  "region_code": "JKT"
}
```

Response API bisa menambahkan label:

```json
{
  "value": "UNDER_REVIEW",
  "label": "Under Review",
  "count": 89
}
```

Jangan jadikan localized label sebagai filter value.

Buruk:

```json
{
  "status": "Sedang Ditinjau"
}
```

Masalah:

- bahasa berubah
- label berubah
- audit sulit
- query saved search rusak
- migration sulit

Gunakan code stabil.

---

# 40. Facets and Saved Search

Saved search harus menyimpan filter values, bukan labels.

Contoh:

```json
{
  "keyword": "late filing",
  "filters": {
    "status": ["OPEN", "UNDER_REVIEW"],
    "severity": ["HIGH"]
  }
}
```

Saat ditampilkan ulang, label di-resolve dari dictionary saat ini.

Pertanyaan penting:

```text
Jika status code sudah deprecated, apa yang terjadi pada saved search lama?
```

Jawaban perlu policy:

- tetap support old value
- map ke new value
- tampilkan warning
- migrate saved searches

Dalam enterprise system, saved search bisa menjadi bagian workflow. Jangan anggap remeh.

---

# 41. Facets and Auditability

Dalam sistem regulatory/case management, search bisa menjadi bagian keputusan.

Auditor mungkin bertanya:

```text
Pada tanggal X, user Y mencari apa?
Filter apa yang digunakan?
Hasil apa yang tersedia?
Mengapa case A muncul dan case B tidak?
```

Untuk itu, log search request perlu menyimpan:

- user id
- tenant id
- timestamp
- search context
- keyword
- filters
- sort
- page cursor
- index alias/version
- query template version
- maybe result IDs first page
- maybe total count

Hati-hati dengan privacy. Jangan log sensitive query text tanpa policy.

Facet count audit bisa penting jika count memengaruhi keputusan.

Contoh:

```text
Supervisor melihat 17 overdue critical cases dan mengalokasikan investigator.
```

Jika angka berubah, sistem harus bisa menjelaskan apakah karena:

- data berubah
- permission berubah
- lifecycle berubah
- indexing lag
- mapping migration
- query logic changed

---

# 42. Aggregations with Nested Documents

Jika field berada dalam `nested` document, aggregation biasa bisa salah.

Contoh document:

```json
{
  "case_id": "case-1",
  "parties": [
    { "name": "Alice", "role": "RESPONDENT" },
    { "name": "Bob", "role": "WITNESS" }
  ]
}
```

Jika `parties` mapping adalah `nested`, aggregation terhadap `parties.role` perlu nested aggregation.

Konsep:

```json
{
  "aggs": {
    "parties_nested": {
      "nested": {
        "path": "parties"
      },
      "aggs": {
        "roles": {
          "terms": {
            "field": "parties.role"
          }
        }
      }
    }
  }
}
```

Nested aggregation menghitung nested docs, bukan root docs, kecuali menggunakan reverse nested.

Ini penting.

Jika user bertanya:

```text
Berapa case dengan respondent?
```

Bukan:

```text
Berapa party nested rows dengan role respondent?
```

Maka Anda mungkin perlu `reverse_nested` atau desain field denormalized di root:

```json
{
  "party_roles": ["RESPONDENT", "WITNESS"]
}
```

Untuk facet root-level, sering lebih sederhana menyalin controlled facet values ke root document.

---

# 43. Aggregation and Duplicate Documents

Search document model kadang menduplikasi entity.

Contoh:

```text
Satu case punya banyak searchable document rows:
- case summary row
- evidence document row
- decision row
```

Jika aggregation menghitung rows, bukan case, count bisa misleading.

Contoh:

```text
Status OPEN (100)
```

Apakah artinya:

```text
100 documents?
100 cases?
100 parties?
100 evidence files?
```

Facet count harus sesuai retrieval unit.

Jika result unit adalah `case`, index sebaiknya punya satu document per case untuk case search.

Jika result unit adalah `evidence document`, facet count document-level masuk akal.

Jangan campur tanpa label jelas.

Possible solution:

- separate indices per search experience
- one index for case search
- one index for document/evidence search
- entity_type facet hanya jika counts semantics jelas
- collapse by case_id jika perlu, tetapi aggregation count tetap perlu hati-hati

---

# 44. Aggregation and Result Collapse

Field collapsing bisa menampilkan satu result per group, misalnya satu result per case.

Tetapi aggregation tetap dihitung atas matching documents, bukan collapsed groups.

Contoh:

```text
10,000 matching document rows
collapsed to 1,200 cases
facet status counts document rows, not cases
```

Ini sering mengejutkan.

Jika UX butuh count per case, jangan hanya mengandalkan collapse.

Pertimbangkan:

- index one document per case
- transform into case-level index
- cardinality aggregation on `case_id` dengan caveat approximate
- separate aggregation model

Top-tier design selalu jelas tentang unit count.

---

# 45. Backend Response Normalization

Elasticsearch aggregation response mentah tidak ideal untuk frontend.

Mentah:

```json
{
  "aggregations": {
    "status": {
      "buckets": [
        { "key": "OPEN", "doc_count": 142 },
        { "key": "UNDER_REVIEW", "doc_count": 89 }
      ]
    }
  }
}
```

Backend response lebih baik:

```json
{
  "facets": {
    "status": {
      "displayName": "Status",
      "selectionMode": "multi",
      "buckets": [
        {
          "value": "OPEN",
          "label": "Open",
          "count": 142,
          "selected": true,
          "disabled": false
        }
      ]
    }
  }
}
```

Backend bertanggung jawab atas:

- label mapping
- selected state
- sorting buckets
- hiding sensitive buckets
- count semantics
- compatibility
- deprecation

Frontend tidak perlu tahu detail aggregation DSL.

---

# 46. Sorting Facet Buckets

Terms aggregation default biasanya sort by doc_count desc.

Namun UX mungkin ingin order custom.

Contoh severity:

```text
Critical
High
Medium
Low
```

Bukan:

```text
Low (1000)
Medium (500)
High (40)
Critical (2)
```

Untuk controlled vocabulary, sort di backend setelah response.

Contoh:

```java
List<String> severityOrder = List.of("CRITICAL", "HIGH", "MEDIUM", "LOW");
```

Untuk status lifecycle:

```text
Draft
Submitted
Under Review
Escalated
Decided
Closed
Archived
```

Sort alphabetic sering buruk.

Facet bucket order adalah product semantics.

---

# 47. Missing Values

Beberapa dokumen tidak punya field tertentu.

Pertanyaan:

```text
Apakah missing value harus muncul sebagai bucket?
```

Contoh:

```text
Assigned Unit
- Enforcement (80)
- Legal (20)
- Unassigned (15)
```

Elasticsearch terms aggregation bisa memakai `missing` parameter.

Konseptual:

```json
{
  "terms": {
    "field": "assigned_unit",
    "missing": "__MISSING__"
  }
}
```

Backend mapping:

```text
__MISSING__ -> Unassigned
```

Namun missing value harus domain-aware.

`missing severity` mungkin berarti:

- data incomplete
- not applicable
- not classified yet
- legacy data

Jangan semua missing diberi label generik tanpa pemahaman domain.

---

# 48. Date Timezone Semantics

Date filtering dan date aggregation harus konsisten.

Contoh user di Asia/Jakarta memilih:

```text
Created Date = 2026-06-21
```

Apakah itu berarti:

```text
2026-06-21T00:00:00+07:00 <= created_at < 2026-06-22T00:00:00+07:00
```

Jika backend memakai UTC day boundary tanpa konversi, hasil bisa salah di sekitar midnight.

Untuk regulatory/case systems, tanggal sering legally meaningful.

Gunakan timezone eksplisit dalam date histogram jika user-facing.

Pertanyaan desain:

1. Apakah tanggal disimpan sebagai instant UTC?
2. Apakah user memilih local date?
3. Apakah tenant punya timezone default?
4. Apakah legal deadline memakai timezone jurisdiction?
5. Apakah report date harus immutable setelah dihitung?

Search date facet bukan sekadar `range` query.

---

# 49. Facet Search Within Facet Values

Jika facet punya banyak values, user mungkin perlu mencari nilai facet.

Contoh:

```text
Assigned Investigator: thousands of users
Party Name: millions
Company Name: millions
```

Jangan gunakan terms aggregation size 10,000 untuk semua.

Alternatif:

1. Separate lookup endpoint backed by source-of-truth.
2. Autocomplete index untuk users/parties.
3. Terms aggregation hanya top values.
4. Composite aggregation untuk admin exploration.
5. Dedicated entity search.

Facet value search adalah fitur berbeda dari result search.

---

# 50. Composite Aggregation Briefly

Composite aggregation berguna untuk pagination buckets.

Contoh use case:

```text
Admin ingin menelusuri semua unique categories atau all party IDs secara paginated.
```

Namun composite aggregation bukan default untuk normal search facets.

Normal facet UX butuh top relevant buckets, bukan browse jutaan buckets.

Jika Anda butuh browse jutaan buckets, mungkin requirement-nya bukan facet, tetapi data exploration/reporting.

---

# 51. Search Facets vs Authorization Recheck

Beberapa sistem melakukan permission filtering di application layer setelah search.

Contoh buruk:

```text
Elasticsearch returns 100 hits.
Application removes 70 unauthorized hits.
UI shows 30.
Aggregations still counted 100.
```

Ini buruk untuk:

- count accuracy
- pagination
- facet correctness
- security leakage
- performance

Lebih baik permission filter masuk query.

Jika permission model terlalu kompleks untuk di-index, Anda perlu desain ulang:

- simplify permission projection
- precompute visibility groups
- split index by security domain
- search candidate then secure re-rank only if leakage acceptable and counts hidden

Dalam regulated system, application-layer filtering after search biasanya risk tinggi.

---

# 52. Facet Stability and Index Refresh

Karena Elasticsearch near-real-time, facet count bisa berubah antar request.

User flow:

```text
Request 1: Open (142)
Request 2 one second later: Open (143)
```

Ini normal jika data berubah.

Masalah muncul jika:

- page 1 hits dari refresh state A
- facet dari refresh state B
- user melihat inconsistency besar

Untuk normal search, ini diterima.

Untuk export/reporting, gunakan point-in-time atau snapshot approach pada part pagination/export berikutnya.

Namun facet dalam interactive search biasanya tidak perlu transactional snapshot ketat.

---

# 53. Search UX Anti-Patterns

## 53.1 Facets Without Counts

Facet tanpa count kadang berguna, tetapi user kehilangan sense distribusi.

## 53.2 Counts Without Meaning

Count tampil tetapi tidak jelas apakah:

```text
current result count?
global count?
count if added?
count after current filter?
```

## 53.3 Too Many Facets

Halaman menjadi dashboard penuh noise.

## 53.4 Facets on Unstable Labels

Filter broken saat label berubah.

## 53.5 Security Filter Not Applied to Aggregations

Data leakage.

## 53.6 High-Cardinality Facets by Default

Latency buruk.

## 53.7 Frontend Builds Elasticsearch DSL

Security dan compatibility risk.

## 53.8 No Test for Facet Semantics

Regression mudah terjadi.

---

# 54. Design Checklist

Sebelum implement filtering/faceting, jawab:

1. Apa retrieval unit-nya?
2. Apakah facet count menghitung documents, cases, parties, atau groups?
3. Apa base security scope?
4. Apa tenant scope?
5. Apa lifecycle visibility scope?
6. Apa filter yang user pilih?
7. Apakah filter dalam satu facet OR atau AND?
8. Apakah antar facet AND?
9. Facet count constrained, global, atau self-excluding?
10. Apakah selected zero bucket tetap tampil?
11. Apakah missing bucket perlu tampil?
12. Apakah field low-cardinality?
13. Apakah field keyword/doc_values compatible?
14. Apakah date timezone sudah eksplisit?
15. Apakah count sensitive?
16. Apakah response menjelaskan selected state?
17. Apakah bucket sorting domain-aware?
18. Apakah aggregation dibatasi size-nya?
19. Apakah query generated bisa diprofile?
20. Apakah ada test fixture untuk facet counts?

---

# 55. Practical Example: Facet Semantics Table

| Facet | Field | Type | Selection | Count Scope | Notes |
|---|---|---|---|---|---|
| Status | `status` | terms | multi OR | self-excluding | selected status tetap tampil |
| Severity | `severity` | terms | multi OR | self-excluding | custom order CRITICAL→LOW |
| Region | `region_code` | terms | multi OR | self-excluding | label from region dictionary |
| Created Date | `created_at` | date_range | single | constrained | timezone tenant |
| SLA | `sla_due_at` | filters | single/multi | constrained | derived business buckets |
| Entity Type | `entity_type` | terms | multi OR | constrained | count documents by entity type |
| Assigned Unit | `assigned_unit_id` | terms | multi OR | self-excluding | low/medium cardinality |
| Investigator | `assigned_user_id` | lookup | multi OR | lazy | avoid huge default facet |

---

# 56. How This Connects to Previous Parts

Dari Part 008, Anda sudah memahami:

- `bool`
- `must`
- `filter`
- query vs filter context

Dari Part 009, Anda memahami:

- full-text query patterns
- query selection untuk user intent

Dari Part 010–011, Anda memahami:

- scoring
- domain-aware ranking

Part ini menambahkan dimensi baru:

```text
Search bukan hanya ranking, tetapi interactive narrowing.
```

Ranking menjawab:

```text
Mana yang paling relevan?
```

Filtering menjawab:

```text
Mana yang memenuhi constraint?
```

Faceting menjawab:

```text
Bagaimana result set ini terdistribusi dan bagaimana user bisa mempersempitnya?
```

Aggregation menjawab:

```text
Bagaimana menghitung distribusi itu secara efisien?
```

---

# 57. Key Takeaways

1. Filter adalah constraint, query adalah intent.
2. Facet adalah UX navigation, bukan hanya aggregation.
3. Aggregation count harus punya semantics eksplisit.
4. Permission, tenant, dan lifecycle filters harus diterapkan ke hits dan aggregations.
5. `post_filter` berguna untuk UX tertentu, tetapi bukan default.
6. Terms aggregation cocok untuk low/medium-cardinality controlled fields.
7. Range/date histogram harus domain-aware dan timezone-aware.
8. Facet counts tidak otomatis “benar”; benar berarti sesuai contract.
9. High-cardinality facets adalah performance trap.
10. Backend harus expose search capability, bukan Elasticsearch DSL mentah.
11. Search API response harus menormalisasi aggregation menjadi facet model yang stabil.
12. Untuk regulated systems, count bisa sensitive dan harus defensible.
13. Unit count harus jelas: document, case, party, group, atau nested row.
14. Facet behavior wajib dites dengan fixture kecil.
15. Search UX yang baik lahir dari kombinasi relevance, filters, facets, permission, dan operational guardrails.

---

# 58. Latihan

## Latihan 1 — Define Facet Semantics

Ambil search page yang pernah Anda bangun atau bayangkan.

Tentukan untuk setiap facet:

```text
field
type
selection mode
count scope
bucket order
missing behavior
security sensitivity
```

Jangan tulis query dulu. Tulis semantics dulu.

## Latihan 2 — Build Small Fixture

Buat 10 document dummy dengan field:

```text
id
keyword_text
status
severity
region
tenant_id
visibility_group_ids
created_at
```

Tulis expected hits dan facet counts untuk:

1. keyword only
2. keyword + status
3. keyword + status + severity
4. user with limited visibility
5. self-excluding status facet

## Latihan 3 — Identify High Cardinality Trap

Daftar semua field yang diminta product sebagai filter/facet.

Klasifikasikan:

```text
low cardinality
medium cardinality
high cardinality
sensitive
lookup-backed
```

Tentukan mana yang boleh tampil default.

## Latihan 4 — Permission Leakage Review

Untuk search API Anda, jawab:

```text
Apakah unauthorized data bisa bocor melalui total count?
Apakah bisa bocor melalui facet count?
Apakah bisa bocor melalui autocomplete?
Apakah bisa bocor melalui zero-result message?
```

## Latihan 5 — Design API Response

Desain response facet normalized seperti:

```json
{
  "facets": {
    "status": {
      "displayName": "Status",
      "selectionMode": "multi",
      "countScope": "self_excluding",
      "buckets": []
    }
  }
}
```

Tambahkan selected, disabled, label, value, count.

---

# 59. Preview Part Berikutnya

Part berikutnya:

```text
Part 013 — Pagination, Sorting, and Result Window Design
```

Kita akan membahas:

- `from` + `size`
- deep pagination problem
- `search_after`
- Point in Time / PIT
- scroll API dan mengapa bukan untuk user search biasa
- stable sorting
- tie-breaker field
- sorting by score/date/keyword/numeric
- index sorting
- infinite scroll
- export use case vs interactive search use case

Ini akan melengkapi Part 012 karena search UX production selalu menggabungkan:

```text
query + filter + facet + sort + pagination
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — Relevance Engineering II: Domain-Aware Ranking</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-013.md">Part 013 — Pagination, Sorting, and Result Window Design ➡️</a>
</div>
