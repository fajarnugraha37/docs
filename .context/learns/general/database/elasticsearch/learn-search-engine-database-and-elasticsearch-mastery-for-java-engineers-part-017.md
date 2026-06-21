# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-017.md

# Part 017 — Search API Design for Backend Engineers

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Audience: Java software engineer / backend engineer / tech lead  
> Fokus: mendesain API search yang stabil, aman, evolvable, dan production-grade di atas Elasticsearch  
> Status seri: **belum selesai** — ini Part 017 dari 034

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 016, kita sudah membangun fondasi berikut:

1. search bukan sekadar lookup;
2. inverted index dan scoring punya cost model sendiri;
3. Lucene bekerja dengan segment immutable;
4. Elasticsearch mendistribusikan search lewat shard, replica, dan coordinating node;
5. document model harus didesain dari query behavior;
6. mapping adalah schema untuk retrieval;
7. analyzer menentukan bagaimana teks berubah menjadi token;
8. Query DSL harus dibedakan antara scoring query dan filter;
9. full-text pattern memiliki trade-off relevance dan performance;
10. ranking harus bisa dijelaskan;
11. business/domain signal dapat dimasukkan ke ranking;
12. filter/facet/aggs harus konsisten dengan UX;
13. pagination dan sorting harus stabil;
14. indexing pipeline harus idempotent;
15. Elasticsearch biasanya bukan source of truth;
16. Java integration perlu typed client, lifecycle, retry, observability, dan testing.

Part ini naik satu level: **bagaimana semua capability tersebut diekspos sebagai backend API yang layak dipakai product, UI, internal service, dan sistem enterprise.**

Di banyak tim, Elasticsearch tidak gagal karena Query DSL-nya salah. Ia gagal karena API di atasnya buruk:

- parameter search terlalu bebas;
- query DSL bocor ke frontend;
- permission hanya ditempel belakangan;
- pagination tidak stabil;
- sorting berubah-ubah;
- filter semantics tidak jelas;
- facet count tidak sesuai result;
- API sulit di-versioning;
- query mahal bisa dikirim user;
- perubahan mapping mematahkan kontrak API;
- relevance tuning merusak backward compatibility;
- export memakai endpoint yang sama dengan interactive search;
- authorization logic tersebar di beberapa layer;
- search result tidak bisa dijelaskan ke user/auditor.

Part ini adalah tentang **API contract** dan **boundary design**.

---

## 1. Core Thesis

Search API yang baik bukan wrapper tipis di atas Elasticsearch.

Search API yang baik adalah **policy boundary** antara:

- user intent;
- domain permission;
- product semantics;
- query DSL;
- index schema;
- relevance strategy;
- pagination model;
- operational guardrail;
- compatibility contract.

Dengan kata lain:

```text
Frontend/user request
    ↓
Search API contract
    ↓
Validation + normalization + authorization + query planning
    ↓
Elasticsearch Query DSL
    ↓
Result shaping + permission safety + observability
    ↓
Stable response contract
```

API search tidak boleh hanya meneruskan input user menjadi Query DSL mentah.

API search harus menjawab:

1. Apa yang boleh dicari?
2. Field mana yang bisa difilter?
3. Field mana yang bisa disort?
4. Bagaimana query teks diinterpretasikan?
5. Bagaimana permission diterapkan?
6. Apakah pagination stabil?
7. Apakah result count exact atau approximate?
8. Apakah facet count mengikuti filter saat ini?
9. Bagaimana relevance berubah tanpa mematahkan consumer?
10. Bagaimana mencegah request mahal?
11. Bagaimana API tetap kompatibel saat index berubah?
12. Bagaimana debugging dan audit dilakukan?

---

## 2. Search API Bukan CRUD API

Banyak backend engineer membawa mental model CRUD ke search:

```http
GET /cases?status=open&keyword=fraud&page=1&size=20
```

Itu tidak salah untuk awal, tetapi search API biasanya jauh lebih kaya daripada list endpoint biasa.

CRUD/list endpoint biasanya berpikir:

```text
filter exact rows → sort → paginate
```

Search endpoint berpikir:

```text
interpret intent → search text → filter visibility → score/rank → facet → highlight → paginate stably → explain/debug
```

Perbedaannya penting.

Pada CRUD API, user biasanya tahu struktur data.

Pada search API, user sering hanya punya intent kabur:

- “kasus korupsi dana hibah”
- “perusahaan yang pernah kena enforcement”
- “dokumen keputusan terbaru tentang izin lingkungan”
- “case yang kemungkinan berkaitan dengan party X”
- “laporan yang menyebut kode internal ABC-2024”

Search API harus menangani ambiguity tersebut.

---

## 3. Jangan Mengekspos Elasticsearch Query DSL Mentah ke Consumer

Kesalahan besar:

```json
POST /search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "fraud" } }
      ]
    }
  }
}
```

Ini menggoda karena cepat. Tetapi berbahaya.

### 3.1 Kenapa Query DSL Mentah Tidak Boleh Jadi Public Contract

#### Problem 1 — Coupling ke index schema

Jika consumer tahu field Elasticsearch:

```json
{
  "match": {
    "case_title.en_stemmed": "fraud"
  }
}
```

maka mapping internal menjadi public API.

Setiap perubahan mapping akan menjadi breaking change.

#### Problem 2 — Consumer bisa membuat query mahal

User bisa mengirim:

```json
{
  "wildcard": {
    "description": "*fraud*"
  }
}
```

atau query lain yang sangat mahal.

#### Problem 3 — Security sulit dijamin

Kalau consumer mengontrol seluruh DSL, backend harus memastikan semua query selalu dibungkus permission filter dengan benar.

Satu endpoint yang lupa wrapping bisa bocor data.

#### Problem 4 — Relevance menjadi tidak terkendali

Ranking menjadi tanggung jawab consumer, bukan platform.

Akibatnya:

- UI A ranking-nya beda;
- UI B ranking-nya beda;
- API internal ranking-nya beda;
- regression sulit diuji;
- explainability lemah.

#### Problem 5 — Versioning menjadi buruk

Elasticsearch Query DSL berevolusi. Index schema berevolusi. Analyzer berubah. Field berubah.

Kalau DSL adalah kontrak publik, setiap evolusi internal menjadi masalah eksternal.

### 3.2 Bentuk Yang Lebih Baik

Gunakan **domain search request**:

```json
POST /api/v1/case-search
{
  "query": "fraud procurement",
  "filters": {
    "status": ["OPEN", "UNDER_REVIEW"],
    "severity": ["HIGH", "CRITICAL"],
    "receivedDate": {
      "from": "2025-01-01",
      "to": "2025-12-31"
    }
  },
  "sort": [
    { "field": "relevance", "direction": "desc" },
    { "field": "receivedDate", "direction": "desc" }
  ],
  "page": {
    "size": 20
  },
  "includeFacets": true,
  "highlight": true
}
```

Backend lalu menerjemahkan ke DSL internal.

Consumer tidak tahu:

- field mana `text`, `keyword`, `date`, `rank_feature`;
- analyzer mana yang dipakai;
- boost mana yang diterapkan;
- shard/index mana yang dituju;
- permission filter internal;
- nested query internal;
- function score detail;
- PIT/search_after internal.

Itu benar. Search API adalah boundary.

---

## 4. Layering Arsitektur Search API

Desain yang sehat biasanya memisahkan layer berikut:

```text
Controller / HTTP Adapter
    ↓
Request DTO parsing
    ↓
Validation & normalization
    ↓
User/security context enrichment
    ↓
Search intent model
    ↓
Query planning
    ↓
Elasticsearch query builder
    ↓
Elasticsearch client execution
    ↓
Response mapping
    ↓
Observability/event logging
```

### 4.1 Controller

Controller sebaiknya tipis:

- menerima request;
- memvalidasi bentuk dasar;
- meneruskan user context;
- mengembalikan response.

Controller tidak boleh berisi:

- DSL construction kompleks;
- authorization detail;
- relevance tuning;
- mapping field internal;
- pagination state assembly rumit.

### 4.2 Request DTO

Request DTO adalah kontrak eksternal.

DTO harus stabil dan domain-oriented.

Contoh:

```java
public record CaseSearchRequest(
    String query,
    CaseSearchFilters filters,
    List<SearchSort> sort,
    SearchPageRequest page,
    Boolean includeFacets,
    Boolean highlight,
    SearchDebugOptions debug
) {}
```

### 4.3 Search Intent Model

Setelah DTO divalidasi, ubah menjadi internal model:

```java
public record CaseSearchIntent(
    NormalizedTextQuery textQuery,
    PermissionScope permissionScope,
    CaseFilterSet filters,
    SortPlan sortPlan,
    PagePlan pagePlan,
    FacetPlan facetPlan,
    HighlightPlan highlightPlan,
    SearchProfile profile
) {}
```

Kenapa tidak langsung DTO → Query DSL?

Karena kita butuh intermediate representation yang:

- sudah tervalidasi;
- sudah dinormalisasi;
- sudah memiliki security context;
- tidak tergantung HTTP;
- bisa dites tanpa Elasticsearch;
- bisa dikonversi ke DSL versi berbeda;
- bisa digunakan untuk audit/debug.

### 4.4 Query Planner

Query planner memilih strategi:

- query teks mana yang dipakai;
- filter mana yang masuk `filter` context;
- scoring signal mana yang aktif;
- sort mana yang valid;
- apakah pakai PIT/search_after;
- apakah perlu aggregations;
- apakah highlight dinyalakan;
- apakah request terlalu mahal.

Query planner adalah otak search API.

---

## 5. Request Contract Design

### 5.1 Minimal Search Request

Untuk interactive search:

```json
{
  "query": "procurement fraud",
  "filters": {},
  "sort": [
    { "field": "relevance", "direction": "desc" }
  ],
  "page": {
    "size": 20
  }
}
```

Minimal bukan berarti kurang serius. Minimal harus tetap:

- permission-aware;
- bounded;
- observable;
- stable;
- validatable.

### 5.2 Query Field

`query` sebaiknya dianggap sebagai **user text intent**, bukan DSL.

Aturan umum:

```text
query: nullable / optional
max length: bounded
trim whitespace
normalize repeated spaces
reject control characters
support exact identifier detection
support empty query only for browse mode
```

Contoh semantics:

| Input | Interpretasi |
|---|---|
| `fraud` | full-text search |
| `"fraud procurement"` | optional phrase intent, jika didukung |
| `CASE-2025-00123` | identifier lookup boost/exact |
| empty query | browse/filter-only search |
| `*fraud*` | jangan interpret sebagai wildcard publik |

### 5.3 Filter Field

Filter harus explicit schema.

Jangan menerima map bebas tanpa whitelist.

Buruk:

```json
{
  "filters": {
    "anyFieldUserWants": "anyValue"
  }
}
```

Lebih baik:

```json
{
  "filters": {
    "status": ["OPEN", "UNDER_REVIEW"],
    "severity": ["HIGH"],
    "assignedUnit": ["ENFORCEMENT"],
    "receivedDate": {
      "from": "2025-01-01",
      "to": "2025-12-31"
    }
  }
}
```

Filter contract harus menjawab:

- Apakah filter ini single-value atau multi-value?
- Apakah multi-value berarti OR atau AND?
- Apakah antar filter berarti AND?
- Apakah range inclusive atau exclusive?
- Apa timezone date filter?
- Apakah unknown enum ditolak?
- Apakah empty array invalid atau no-op?
- Apakah null berarti no filter atau filter null?

### 5.4 Sort Field

Sort harus whitelist.

Contoh:

```json
"sort": [
  { "field": "relevance", "direction": "desc" },
  { "field": "receivedDate", "direction": "desc" },
  { "field": "caseId", "direction": "asc" }
]
```

Sort API tidak boleh mengekspos internal field seperti:

```text
received_at_epoch_millis_sortable
case_title.keyword
party_names.normalized.keyword
```

Gunakan domain sort field:

```text
receivedDate
lastUpdated
severity
caseNumber
relevance
```

Mapping internal bisa berubah tanpa mengubah contract.

### 5.5 Page Field

Untuk interactive search, hindari page number dalam sistem besar.

Bentuk aman:

```json
"page": {
  "size": 20,
  "cursor": null
}
```

Response mengembalikan:

```json
"page": {
  "size": 20,
  "nextCursor": "opaque-token"
}
```

Cursor harus opaque.

Jangan expose langsung:

```json
"search_after": [1.234, "CASE-001"]
```

Lebih baik encode menjadi token yang backend bisa validasi.

---

## 6. Response Contract Design

### 6.1 Basic Response

```json
{
  "requestId": "srch_01HX...",
  "tookMs": 37,
  "total": {
    "value": 1243,
    "relation": "eq"
  },
  "results": [
    {
      "id": "case-123",
      "type": "CASE",
      "title": "Procurement fraud investigation",
      "summary": "...",
      "status": "OPEN",
      "severity": "HIGH",
      "receivedDate": "2025-04-12",
      "score": 12.31,
      "highlights": {
        "title": ["Procurement <em>fraud</em> investigation"]
      }
    }
  ],
  "facets": {},
  "page": {
    "nextCursor": "opaque-token"
  }
}
```

### 6.2 Jangan Mengembalikan `_source` Mentah

Buruk:

```json
{
  "_source": {
    "internal_acl_ids": [...],
    "ranking_boost_v7": 1.25,
    "case_title_en_stemmed": "..."
  }
}
```

Search response harus projection yang aman:

- hanya field yang diizinkan;
- nama domain-oriented;
- tidak membocorkan internal scoring fields;
- tidak membocorkan permission metadata;
- tidak membocorkan field internal untuk analyzer/mapping;
- stabil walau index berubah.

### 6.3 Score Field: Expose atau Tidak?

Untuk consumer umum, score sering tidak perlu diekspos.

Score Elasticsearch bukan nilai absolut lintas query. Score hanya bermakna relatif dalam query yang sama.

Pilihan:

| Audience | Expose score? |
|---|---|
| End-user UI biasa | biasanya tidak |
| Internal relevance debugging | ya |
| Audit/debug endpoint | ya, dengan context |
| API publik | hati-hati |

Jika expose:

```json
"debug": {
  "score": 12.31,
  "rankingProfile": "case-search-v4"
}
```

Jangan membuat product logic bergantung pada angka `_score` mentah.

---

## 7. Query DTO vs Domain Query vs Elasticsearch Query

Pisahkan tiga hal:

```text
External Search DTO
    = bentuk request/response HTTP

Domain Search Intent
    = makna yang sudah dinormalisasi dan divalidasi

Elasticsearch Query DSL
    = implementasi teknis terhadap index saat ini
```

### 7.1 Contoh Mapping

External request:

```json
{
  "query": "fraud",
  "filters": {
    "status": ["OPEN"]
  },
  "sort": [
    { "field": "relevance", "direction": "desc" }
  ]
}
```

Domain intent:

```java
CaseSearchIntent(
    textQuery = FullTextQuery("fraud"),
    filters = status in OPEN,
    permissionScope = visibleCaseIds/user/org constraints,
    sortPlan = relevanceThenStableTieBreaker,
    pagePlan = firstPage(size=20),
    rankingProfile = CASE_SEARCH_V4
)
```

Elasticsearch query:

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "fraud",
            "fields": [
              "title^4",
              "summary^2",
              "body"
            ]
          }
        }
      ],
      "filter": [
        { "term": { "status": "OPEN" } },
        { "terms": { "visible_to_user_ids": ["u123"] } }
      ]
    }
  },
  "sort": [
    "_score",
    { "received_date": "desc" },
    { "case_id.keyword": "asc" }
  ]
}
```

Consumer hanya melihat DTO.

---

## 8. Filter Schema Design

Filter adalah bagian search API yang paling sering diremehkan.

### 8.1 Filter Harus Punya Semantics Jelas

Misal:

```json
"status": ["OPEN", "UNDER_REVIEW"]
```

Apakah berarti:

```text
status = OPEN OR status = UNDER_REVIEW
```

Biasanya ya.

Tapi untuk tag:

```json
"tags": ["fraud", "procurement"]
```

Apakah berarti:

```text
tags contains fraud OR procurement
```

atau:

```text
tags contains fraud AND procurement
```

Keduanya valid tergantung produk. Harus explicit.

### 8.2 Filter Contract Table

Untuk setiap filter, definisikan:

| Filter | Type | Operator | Multi-value Semantics | Field Internal | Notes |
|---|---|---|---|---|---|
| status | enum | terms | OR | `status.keyword` | visible statuses only |
| severity | enum | terms | OR | `severity.keyword` | sorted severity optional |
| receivedDate | date range | range | from/to | `received_date` | timezone UTC or user TZ |
| assignedUnit | enum/string | terms | OR | `assigned_unit.keyword` | permission constrained |
| partyName | text | match/filter hybrid | depends | `party_names.*` | may be expensive |
| hasAttachment | boolean | term | exact | `has_attachment` | cheap |

Ini bukan dokumentasi tambahan. Ini desain inti.

### 8.3 Date Range Semantics

Date filter sering menyebabkan bug.

Misal user memilih tanggal:

```json
{
  "from": "2025-01-01",
  "to": "2025-01-31"
}
```

Pertanyaan:

- Apakah `to` inclusive?
- Apakah tanggal tanpa waktu berarti local date?
- Timezone user atau UTC?
- Apakah `to` menjadi `2025-01-31T23:59:59.999`?
- Bagaimana DST?

Kontrak yang lebih aman:

```text
For date-only filters, `from` is inclusive at start of local day.
`to` is inclusive as a local date and internally converted to exclusive next-day boundary.
```

Internal:

```json
{
  "range": {
    "received_date": {
      "gte": "2025-01-01T00:00:00+07:00",
      "lt": "2025-02-01T00:00:00+07:00"
    }
  }
}
```

Gunakan exclusive upper bound untuk menghindari presisi waktu yang rapuh.

---

## 9. Sort Contract Design

Sort di Elasticsearch tidak sama dengan sort di database biasa.

Search result harus stabil.

### 9.1 Always Add Tie-Breaker

Jika sort:

```json
[
  { "received_date": "desc" }
]
```

banyak dokumen bisa memiliki tanggal sama. Tanpa tie-breaker stabil, pagination bisa duplicate/missing.

Tambahkan tie-breaker:

```json
[
  { "received_date": "desc" },
  { "case_id.keyword": "asc" }
]
```

Untuk relevance:

```json
[
  { "_score": "desc" },
  { "received_date": "desc" },
  { "case_id.keyword": "asc" }
]
```

### 9.2 Sort Field Harus Punya Mapping Sesuai

Sort pada `text` field tidak cocok.

Biasanya butuh:

- `keyword` field;
- numeric field;
- date field;
- normalized keyword;
- index sorting jika workload cocok.

Public sort field:

```text
caseNumber
receivedDate
lastUpdated
severity
```

Internal sort mapping:

```text
case_number.keyword
received_date
last_updated_at
severity_rank
```

### 9.3 Sorting by Relevance + Business Signal

Jangan selalu berpikir sort = field sort.

Untuk search teks, default sort biasanya relevance.

Tetapi relevance bisa dikombinasikan:

```text
text relevance
+ severity boost
+ freshness boost
+ authority boost
+ permission/lifecycle constraints
```

Public API cukup mengatakan:

```json
{ "field": "bestMatch", "direction": "desc" }
```

Internal bisa menjalankan `function_score`, `rank_feature`, atau rescore.

---

## 10. Pagination Contract

Elasticsearch mendukung `from`/`size`, tetapi deep pagination mahal. Dokumentasi Elastic merekomendasikan `search_after` dengan PIT untuk menjaga state index ketika paging lebih dari 10.000 hits, dan scroll tidak lagi direkomendasikan untuk deep pagination user search. [Elastic pagination docs](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results)

### 10.1 Offset Pagination

Bentuk:

```json
"page": {
  "number": 3,
  "size": 20
}
```

Internal:

```json
{
  "from": 40,
  "size": 20
}
```

Kelebihan:

- familiar;
- mudah untuk UI klasik;
- user bisa loncat halaman.

Kekurangan:

- deep pagination mahal;
- hasil bisa berubah saat index refresh;
- duplicate/missing jika sort tidak stabil;
- tidak cocok untuk infinite scroll besar.

### 10.2 Cursor Pagination

Bentuk:

```json
"page": {
  "size": 20,
  "cursor": "opaque-token"
}
```

Internal biasanya:

- PIT id;
- `search_after` values;
- sort spec hash;
- filter hash;
- expiry;
- tenant/user scope hash.

Cursor token harus divalidasi.

Jangan izinkan cursor dari query A dipakai untuk query B.

### 10.3 Cursor Token Content

Secara konseptual:

```json
{
  "pitId": "...",
  "searchAfter": [12.31, "2025-04-12T10:00:00Z", "case-123"],
  "sortHash": "abc",
  "queryHash": "def",
  "userScopeHash": "ghi",
  "expiresAt": "2026-06-21T14:00:00Z"
}
```

Tetapi public token harus opaque, misalnya signed/base64 encrypted/encoded.

### 10.4 Jangan Gunakan Endpoint Search UI Untuk Export Besar

Interactive search:

```text
low latency
small page
highlight
facets
relevance
user-facing
```

Export:

```text
large result set
stable snapshot
possibly async
no highlight
no expensive aggs
streaming/batch
strict audit
```

Pisahkan endpoint:

```http
POST /api/v1/case-search
POST /api/v1/case-search/export-jobs
GET  /api/v1/case-search/export-jobs/{id}
```

---

## 11. Facet Contract

Facet adalah bagian UX yang kelihatannya sederhana tetapi sarat semantics.

### 11.1 Response Facet

```json
"facets": {
  "status": {
    "buckets": [
      { "value": "OPEN", "label": "Open", "count": 893, "selected": true },
      { "value": "CLOSED", "label": "Closed", "count": 120, "selected": false }
    ]
  },
  "severity": {
    "buckets": [
      { "value": "CRITICAL", "label": "Critical", "count": 20 },
      { "value": "HIGH", "label": "High", "count": 91 }
    ]
  }
}
```

### 11.2 Facet Count Semantics

Pertanyaan penting:

Jika user memilih `status=OPEN`, apakah facet `status` harus menunjukkan:

1. count setelah status filter diterapkan; atau
2. count seolah-olah status filter dihapus tetapi filter lain tetap aktif?

Untuk faceted navigation, sering yang diinginkan adalah opsi ke-2 untuk facet yang sama.

Contoh user filter:

```text
query = fraud
severity = HIGH
status = OPEN
```

Facet status ingin menghitung:

```text
query = fraud
severity = HIGH
status filter excluded from its own aggregation
```

Tetapi facet severity ingin menghitung:

```text
query = fraud
status = OPEN
severity filter excluded from its own aggregation
```

Ini memengaruhi query/aggregation plan.

### 11.3 Facet Authorization

Facet count bisa membocorkan data.

Misal user tidak boleh melihat case rahasia. Kalau facet count menghitung semua dokumen sebelum permission filter, user dapat infer:

```text
Ada 3 case CRITICAL tersembunyi.
```

Karena itu permission filter harus diterapkan sebelum result dan facets.

---

## 12. Highlight Contract

Highlight sangat berguna, tetapi juga riskan.

### 12.1 Highlight Response

```json
"highlights": {
  "title": ["Procurement <em>fraud</em> investigation"],
  "summary": ["... suspected <em>fraud</em> in vendor selection ..."]
}
```

### 12.2 Highlight Safety

Perhatikan:

- sanitize HTML;
- jangan highlight field yang user tidak boleh lihat;
- batasi jumlah fragment;
- batasi fragment size;
- jangan highlight field sangat besar secara default;
- pastikan tag output sesuai frontend escaping policy.

### 12.3 Highlight Bukan Source of Truth

Highlight adalah snippet retrieval.

Jangan membuat business decision dari highlight.

---

## 13. Permission-Aware Search

Search API enterprise hampir selalu butuh permission-aware retrieval.

Elastic mendukung document-level security dan field-level security pada role tertentu, di mana document-level security membatasi dokumen yang dapat diakses dan field-level security membatasi field yang dapat dibaca dari document-based read APIs. Dokumentasi Elastic juga mencatat bahwa DLS/FLS ditujukan untuk akun read-only privilege. [Elastic DLS/FLS docs](https://www.elastic.co/docs/deploy-manage/users-roles/cluster-or-deployment-auth/controlling-access-at-document-field-level)

Namun dalam aplikasi enterprise, permission sering juga diterapkan di application layer karena:

- permission logic kompleks;
- permission berubah cepat;
- user context berasal dari domain service;
- ada workflow/lifecycle condition;
- ada tenant/org/unit boundary;
- ada exception/handover/delegation;
- audit perlu domain-level explanation.

### 13.1 Permission Model Options

#### Option A — Application-Side Filter in Query

Document menyimpan permission terms:

```json
{
  "visible_to_user_ids": ["u1", "u2"],
  "visible_to_unit_ids": ["unit-a"],
  "tenant_id": "tenant-1"
}
```

Query menambahkan:

```json
{
  "bool": {
    "filter": [
      { "term": { "tenant_id": "tenant-1" } },
      {
        "bool": {
          "should": [
            { "terms": { "visible_to_user_ids": ["u123"] } },
            { "terms": { "visible_to_unit_ids": ["unit-a", "unit-b"] } }
          ],
          "minimum_should_match": 1
        }
      }
    ]
  }
}
```

Kelebihan:

- fleksibel;
- domain-aware;
- bisa dijelaskan di aplikasi;
- bisa dites di backend.

Kekurangan:

- ACL field bisa besar;
- permission update butuh reindex/update;
- query bisa makin berat;
- risiko bocor jika filter lupa ditambahkan.

#### Option B — Index per Tenant / Scope

```text
tenant-a-cases-v1
tenant-b-cases-v1
```

Kelebihan:

- isolasi kuat;
- query lebih sederhana;
- lifecycle per tenant.

Kekurangan:

- banyak index;
- operational overhead;
- cross-tenant admin search lebih kompleks;
- shard planning sulit.

#### Option C — Elasticsearch DLS/FLS

Kelebihan:

- enforcement dekat data layer;
- bisa mengurangi risiko application bug;
- cocok untuk read-only role tertentu.

Kekurangan:

- perlu memahami lisensi/fitur;
- logic kompleks mungkin sulit;
- write operation limitation untuk user dengan DLS/FLS;
- observability domain mungkin kurang langsung.

#### Option D — Hybrid

Sering paling realistis:

- tenant isolation di index/routing;
- coarse permission di ES query;
- fine permission di app;
- response projection ketat;
- audit logging di app.

### 13.2 Permission Filter Harus Non-Optional

Buat API internal agar permission tidak bisa lupa.

Buruk:

```java
Query buildQuery(SearchRequest request) {
    return boolQuery()
        .must(textQuery(request.query()))
        .filter(statusFilter(request.status()));
}
```

Lebih baik:

```java
Query buildQuery(SearchIntent intent) {
    return boolQuery()
        .must(textQuery(intent.textQuery()))
        .filter(domainFilters(intent.filters()))
        .filter(permissionFilter(intent.permissionScope()))
        .filter(tenantFilter(intent.tenantId()));
}
```

Lebih baik lagi, buat permission scope mandatory di constructor:

```java
public record CaseSearchIntent(
    TenantId tenantId,
    PermissionScope permissionScope,
    NormalizedTextQuery textQuery,
    CaseFilterSet filters,
    SortPlan sort,
    PagePlan page
) {
    public CaseSearchIntent {
        Objects.requireNonNull(tenantId);
        Objects.requireNonNull(permissionScope);
    }
}
```

---

## 14. Multi-Tenant Search API Design

Multi-tenant search harus jelas dari awal.

### 14.1 Tenant as Mandatory Context

Tenant jangan dikirim bebas oleh user biasa.

Buruk:

```json
{
  "tenantId": "tenant-xyz",
  "query": "fraud"
}
```

Jika user bisa mengubah tenant ID, risiko data leakage besar.

Lebih baik:

```text
Tenant berasal dari authenticated principal / request context.
```

Admin cross-tenant search harus endpoint berbeda dan permission berbeda.

### 14.2 Tenant Isolation Patterns

| Pattern | Kelebihan | Kekurangan |
|---|---|---|
| shared index + tenant filter | sederhana, hemat shard | harus sangat disiplin filter |
| index per tenant | isolasi lebih kuat | shard/index explosion |
| routing by tenant | locality lebih baik | hot tenant risk |
| cluster per tenant | isolasi maksimum | mahal dan operasional berat |

### 14.3 Tenant Filter Must Apply to Aggregations

Jangan hanya filter hits. Facets juga harus tenant-aware.

```text
hits tenant-filtered
facets tenant-filtered
counts tenant-filtered
highlights tenant-filtered
suggestions tenant-filtered jika sensitif
```

---

## 15. Preventing Expensive User-Generated Queries

Search API harus defensif.

### 15.1 Batas Input

Contoh guardrail:

```text
query max length: 256 or 512 chars
max filters per request: bounded
max terms per filter: bounded
page size max: 100 for UI
sort fields max: 3
facets max: whitelist
highlight disabled by default for large fields
wildcard not exposed publicly
regexp not exposed publicly
script query not exposed publicly
```

### 15.2 Query Budget

Setiap search profile punya budget:

| Profile | Max Size | Facets | Highlight | Deep Page | Use Case |
|---|---:|---|---|---|---|
| `caseSearchInteractive` | 50 | yes | yes | no | UI search |
| `casePicker` | 20 | no | no | no | dropdown/picker |
| `auditSearch` | 100 | limited | no | cursor | auditor UI |
| `export` | async | no | no | yes | export job |

### 15.3 Reject, Do Not Degrade Silently

Jika request terlalu mahal, jangan diam-diam menjalankan query buruk.

Response:

```json
{
  "error": {
    "code": "SEARCH_REQUEST_TOO_EXPENSIVE",
    "message": "The request contains too many facet fields. Maximum allowed is 5.",
    "details": {
      "maxFacets": 5
    }
  }
}
```

### 15.4 Disable Dangerous Public Operations

Jangan expose:

- arbitrary wildcard;
- arbitrary regexp;
- arbitrary script;
- arbitrary field name;
- arbitrary aggregation;
- arbitrary sort field;
- arbitrary index name;
- arbitrary `_source` include/exclude;
- arbitrary highlight fields.

---

## 16. Search Request Validation

Validation search bukan hanya bean validation.

### 16.1 Structural Validation

```text
page.size between 1 and 100
sort field exists in whitelist
filter field exists in whitelist
filter value enum valid
date range valid
cursor syntactically valid
query length valid
```

### 16.2 Semantic Validation

```text
cannot sort by relevance when query is empty? maybe allowed with fallback
cannot request highlight when query is empty
cannot use cursor with changed filter/sort
cannot combine incompatible filters
cannot request unavailable facet for current search type
cannot access admin-only filter
```

### 16.3 Security Validation

```text
tenant context must exist
permission scope must exist
requested fields must be allowed
admin filters require admin role
cross-unit search requires privilege
debug/explain requires elevated permission
```

---

## 17. Designing Error Responses

Search errors should be actionable.

### 17.1 Bad Error

```json
{
  "message": "Elasticsearch exception"
}
```

### 17.2 Better Error

```json
{
  "error": {
    "code": "INVALID_SORT_FIELD",
    "message": "Sort field 'partyName' is not supported for case search.",
    "details": {
      "allowedFields": ["relevance", "receivedDate", "lastUpdated", "severity"]
    },
    "requestId": "srch_01HX..."
  }
}
```

### 17.3 Error Taxonomy

Useful search API error codes:

```text
INVALID_QUERY
QUERY_TOO_LONG
INVALID_FILTER_FIELD
INVALID_FILTER_VALUE
INVALID_DATE_RANGE
INVALID_SORT_FIELD
INVALID_PAGE_SIZE
INVALID_CURSOR
CURSOR_EXPIRED
SEARCH_REQUEST_TOO_EXPENSIVE
FORBIDDEN_SEARCH_SCOPE
INDEX_UNAVAILABLE
SEARCH_TIMEOUT
PARTIAL_RESULTS_NOT_ALLOWED
```

---

## 18. Timeout, Partial Results, and Degraded Behavior

Search can timeout.

Your API must define behavior.

### 18.1 Timeout Budget

Separate:

```text
HTTP timeout
application search timeout
Elasticsearch request timeout
client socket timeout
frontend timeout expectation
```

Example:

```text
Frontend budget: 3s
Backend API budget: 2.5s
Elasticsearch timeout: 2s
Fallback/response shaping: 0.5s
```

### 18.2 Partial Results

For regulatory/enterprise systems, partial result can be dangerous.

If a search timeout returns partial result and user assumes complete result, that can be misleading.

Contract options:

#### Strict

```text
If search is incomplete, return error.
```

#### Explicit Partial

```json
{
  "results": [...],
  "complete": false,
  "warning": {
    "code": "PARTIAL_RESULTS",
    "message": "Search timed out before all shards responded. Results may be incomplete."
  }
}
```

For high-stakes search, prefer strict or very explicit partial labeling.

---

## 19. Total Hits Contract

Elasticsearch total hits can be exact or bounded depending on `track_total_hits` configuration. API response should expose relation semantics, not pretend every count is exact.

Example:

```json
"total": {
  "value": 10000,
  "relation": "gte"
}
```

Means:

```text
At least 10,000 results.
```

For UI:

```text
10,000+ results
```

For export/audit:

- may require exact count;
- may require async job;
- may require different endpoint.

---

## 20. Debug and Explain Endpoint Design

Do not expose `_explain` casually to all users.

### 20.1 Debug Search Request

For internal engineers:

```json
{
  "query": "fraud",
  "filters": { "status": ["OPEN"] },
  "debug": {
    "includeDsl": true,
    "includeScoreExplanation": false,
    "includeTiming": true
  }
}
```

Only allow for privileged users/environments.

### 20.2 Separate Debug Endpoint

```http
POST /internal/search/cases/debug
```

Response:

```json
{
  "rankingProfile": "case-search-v4",
  "indexAlias": "cases-search-read",
  "queryPlan": {
    "textStrategy": "multi_match_best_fields",
    "permissionStrategy": "tenant_and_acl_terms",
    "paginationStrategy": "pit_search_after"
  },
  "dsl": { }
}
```

Benefits:

- production API stays clean;
- debugging is controlled;
- DSL exposure is limited;
- audit possible.

---

## 21. API Versioning

Search API changes are tricky because relevance changes can alter behavior without schema changes.

### 21.1 Version Types

#### Contract Version

```http
/api/v1/case-search
/api/v2/case-search
```

Changes request/response shape.

#### Ranking Profile Version

```text
case-search-v3
case-search-v4
```

Changes ranking/scoring behavior.

#### Index Schema Version

```text
cases-search-v12
cases-search-v13
```

Changes mapping/internal fields.

These are different.

Do not conflate them.

### 21.2 Compatibility Matrix

| API Version | Ranking Profile | Index Alias | Notes |
|---|---|---|---|
| v1 | case-search-v3 | cases-read-v12 | legacy UI |
| v1 | case-search-v4 | cases-read-v13 | same contract, improved ranking |
| v2 | case-search-v5 | cases-read-v14 | new filters/response |

### 21.3 Relevance Changes Need Release Discipline

Changing boosts can be a breaking product behavior even if API schema unchanged.

Track:

- ranking profile version;
- release notes;
- golden query evaluation;
- rollback path;
- before/after examples;
- stakeholder approval for sensitive domains.

---

## 22. Backward Compatibility

### 22.1 Additive Changes Are Safer

Usually safe:

- add optional request field;
- add response field if clients tolerate unknown fields;
- add new facet if requested explicitly;
- add new sort field;
- add new filter field.

Risky/breaking:

- remove field;
- rename field;
- change filter semantics;
- change default sort;
- change date boundary semantics;
- change total count relation;
- change cursor format without fallback;
- change result visibility;
- change highlight HTML contract.

### 22.2 Default Behavior Is Contract

If default sort is relevance, that is part of contract.

If empty query sorts by latest, that is part of contract.

If status filter multi-value means OR, that is part of contract.

Document it.

---

## 23. Java Implementation Pattern

### 23.1 Package Structure

Example:

```text
com.company.search.caseapi
  CaseSearchController
  CaseSearchRequest
  CaseSearchResponse
  CaseSearchError

com.company.search.caseapi.validation
  CaseSearchRequestValidator
  FilterSchemaRegistry
  SortSchemaRegistry

com.company.search.casecore
  CaseSearchIntent
  CaseSearchService
  CaseSearchPlanner
  CaseSearchResultMapper

com.company.search.caseelastic
  CaseElasticQueryBuilder
  CaseElasticSortBuilder
  CaseElasticAggregationBuilder
  CaseElasticClientGateway

com.company.search.security
  PermissionScopeResolver
  TenantContext

com.company.search.observability
  SearchTelemetry
  SearchAuditLogger
```

### 23.2 Request DTO

```java
public record CaseSearchRequest(
        String query,
        CaseSearchFilters filters,
        List<SearchSortRequest> sort,
        SearchPageRequest page,
        Boolean includeFacets,
        Boolean highlight
) {}

public record CaseSearchFilters(
        List<String> status,
        List<String> severity,
        DateRange receivedDate,
        List<String> assignedUnit,
        Boolean hasAttachment
) {}

public record DateRange(
        LocalDate from,
        LocalDate to
) {}

public record SearchSortRequest(
        String field,
        SortDirection direction
) {}

public enum SortDirection {
    ASC, DESC
}

public record SearchPageRequest(
        Integer size,
        String cursor
) {}
```

### 23.3 Validator

```java
public final class CaseSearchRequestValidator {

    private static final int MAX_QUERY_LENGTH = 512;
    private static final int MAX_PAGE_SIZE = 100;

    private final Set<String> allowedSortFields = Set.of(
            "relevance",
            "receivedDate",
            "lastUpdated",
            "severity"
    );

    private final Set<String> allowedStatuses = Set.of(
            "OPEN",
            "UNDER_REVIEW",
            "CLOSED",
            "ESCALATED"
    );

    public void validate(CaseSearchRequest request) {
        validateQuery(request.query());
        validatePage(request.page());
        validateSort(request.sort());
        validateFilters(request.filters());
    }

    private void validateQuery(String query) {
        if (query == null) return;
        if (query.length() > MAX_QUERY_LENGTH) {
            throw SearchValidationException.queryTooLong(MAX_QUERY_LENGTH);
        }
        if (containsControlCharacters(query)) {
            throw SearchValidationException.invalidQuery("Query contains unsupported control characters.");
        }
    }

    private void validatePage(SearchPageRequest page) {
        int size = page == null || page.size() == null ? 20 : page.size();
        if (size < 1 || size > MAX_PAGE_SIZE) {
            throw SearchValidationException.invalidPageSize(MAX_PAGE_SIZE);
        }
    }

    private void validateSort(List<SearchSortRequest> sort) {
        if (sort == null) return;
        for (SearchSortRequest s : sort) {
            if (!allowedSortFields.contains(s.field())) {
                throw SearchValidationException.invalidSortField(s.field(), allowedSortFields);
            }
        }
    }

    private void validateFilters(CaseSearchFilters filters) {
        if (filters == null) return;
        if (filters.status() != null) {
            for (String status : filters.status()) {
                if (!allowedStatuses.contains(status)) {
                    throw SearchValidationException.invalidFilterValue("status", status);
                }
            }
        }
        if (filters.receivedDate() != null) {
            LocalDate from = filters.receivedDate().from();
            LocalDate to = filters.receivedDate().to();
            if (from != null && to != null && from.isAfter(to)) {
                throw SearchValidationException.invalidDateRange("receivedDate");
            }
        }
    }

    private boolean containsControlCharacters(String value) {
        return value.chars().anyMatch(ch -> Character.isISOControl(ch) && !Character.isWhitespace(ch));
    }
}
```

### 23.4 Intent Builder

```java
public final class CaseSearchIntentFactory {

    private final PermissionScopeResolver permissionScopeResolver;
    private final CursorService cursorService;
    private final Clock clock;

    public CaseSearchIntent create(
            CaseSearchRequest request,
            AuthenticatedUser user,
            TenantContext tenant
    ) {
        PermissionScope scope = permissionScopeResolver.resolve(user, tenant);

        NormalizedTextQuery textQuery = NormalizedTextQuery.from(request.query());
        CaseFilterSet filters = CaseFilterSet.from(request.filters(), tenant.timeZone());
        SortPlan sortPlan = SortPlan.from(request.sort(), textQuery);
        PagePlan pagePlan = PagePlan.from(request.page(), cursorService, clock);

        return new CaseSearchIntent(
                tenant.tenantId(),
                scope,
                textQuery,
                filters,
                sortPlan,
                pagePlan,
                FacetPlan.from(request.includeFacets()),
                HighlightPlan.from(request.highlight(), textQuery),
                RankingProfile.CASE_SEARCH_V4
        );
    }
}
```

### 23.5 Query Builder Skeleton

```java
public final class CaseElasticQueryBuilder {

    public Query build(CaseSearchIntent intent) {
        List<Query> filters = new ArrayList<>();
        filters.add(tenantFilter(intent.tenantId()));
        filters.add(permissionFilter(intent.permissionScope()));
        filters.addAll(domainFilters(intent.filters()));

        List<Query> must = new ArrayList<>();
        if (!intent.textQuery().isEmpty()) {
            must.add(textQuery(intent.textQuery()));
        }

        return Query.of(q -> q.bool(b -> b
                .must(must)
                .filter(filters)
        ));
    }

    private Query tenantFilter(TenantId tenantId) {
        return Query.of(q -> q.term(t -> t
                .field("tenant_id")
                .value(tenantId.value())
        ));
    }

    private Query permissionFilter(PermissionScope scope) {
        return Query.of(q -> q.bool(b -> b
                .should(scope.userIds().stream()
                        .map(userId -> Query.of(sq -> sq.term(t -> t
                                .field("visible_to_user_ids")
                                .value(userId.value()))))
                        .toList())
                .should(scope.unitIds().stream()
                        .map(unitId -> Query.of(sq -> sq.term(t -> t
                                .field("visible_to_unit_ids")
                                .value(unitId.value()))))
                        .toList())
                .minimumShouldMatch("1")
        ));
    }

    private Query textQuery(NormalizedTextQuery textQuery) {
        return Query.of(q -> q.multiMatch(mm -> mm
                .query(textQuery.value())
                .fields("case_title^4", "summary^2", "body")
        ));
    }

    private List<Query> domainFilters(CaseFilterSet filters) {
        List<Query> result = new ArrayList<>();

        if (!filters.statuses().isEmpty()) {
            result.add(Query.of(q -> q.terms(t -> t
                    .field("status")
                    .terms(v -> v.value(filters.statuses().stream()
                            .map(FieldValue::of)
                            .toList()))
            )));
        }

        filters.receivedDateRange().ifPresent(range ->
                result.add(Query.of(q -> q.range(r -> r
                        .date(d -> d
                                .field("received_date")
                                .gte(range.fromInclusive().toString())
                                .lt(range.toExclusive().toString())
                        )
                )))
        );

        return result;
    }
}
```

Catatan: kode ini skeleton konseptual. Detail type Java API Client bisa berubah mengikuti versi library, tetapi prinsip layering-nya tetap.

---

## 24. Query Builder Anti-Patterns

### 24.1 String Concatenation DSL

Buruk:

```java
String dsl = "{ \"query\": { \"match\": { \"title\": \"" + userInput + "\" } } }";
```

Masalah:

- escaping;
- injection-like bug;
- invalid JSON;
- tidak type-safe;
- sulit refactor;
- sulit test.

### 24.2 One Giant Method

Buruk:

```java
SearchResponse search(Request request) {
    // 600 lines building query, filters, aggs, sort, highlight, mapping response
}
```

Pecah menjadi:

- request validator;
- intent factory;
- query builder;
- filter builder;
- sort builder;
- aggregation builder;
- response mapper;
- telemetry publisher.

### 24.3 Frontend-Driven Field Names

Buruk:

```json
{
  "sort": [{ "field": "case_title.keyword" }]
}
```

Frontend tidak boleh tahu mapping field.

### 24.4 Permission as Optional Parameter

Buruk:

```java
search(request, includePermissionFilter)
```

Permission bukan pilihan.

---

## 25. Search Result Mapping

### 25.1 Internal Hit to API Result

Elasticsearch hit:

```json
{
  "_index": "cases-search-v13",
  "_id": "case-123",
  "_score": 12.31,
  "_source": {
    "case_id": "case-123",
    "case_title": "Procurement fraud investigation",
    "internal_acl": [...],
    "ranking_signal": 1.2
  },
  "highlight": {
    "case_title": ["Procurement <em>fraud</em> investigation"]
  }
}
```

API result:

```json
{
  "id": "case-123",
  "title": "Procurement fraud investigation",
  "type": "CASE",
  "status": "OPEN",
  "highlights": {
    "title": ["Procurement <em>fraud</em> investigation"]
  }
}
```

### 25.2 Defensive Mapping

Response mapper should:

- tolerate missing optional fields;
- fail on missing required fields if index is corrupt;
- never expose internal ACL/ranking fields;
- normalize enum values;
- sanitize highlight;
- include result type if multi-entity;
- attach navigation/action hints if useful.

---

## 26. Multi-Entity Search API

Search often spans multiple entity types:

- case;
- party;
- document;
- decision;
- evidence;
- task;
- alert.

### 26.1 Option A — Separate Endpoints

```http
POST /case-search
POST /party-search
POST /document-search
```

Kelebihan:

- contract jelas;
- mapping lebih sederhana;
- relevance per entity;
- permission lebih spesifik.

Kekurangan:

- tidak ada unified search;
- UI global search butuh orchestrator.

### 26.2 Option B — Unified Search Endpoint

```http
POST /global-search
```

Response:

```json
{
  "results": [
    { "type": "CASE", "id": "case-1", "title": "..." },
    { "type": "PARTY", "id": "party-9", "title": "..." },
    { "type": "DOCUMENT", "id": "doc-7", "title": "..." }
  ]
}
```

Kelebihan:

- bagus untuk global search box;
- user discovery lebih mudah.

Kekurangan:

- ranking antar entity sulit;
- facets lebih kompleks;
- permission heterogen;
- response contract lebih abstrak;
- relevance evaluation lebih rumit.

### 26.3 Recommended Pattern

Gunakan keduanya jika perlu:

```text
/global-search       → discovery/navigation
/case-search         → detailed case search
/document-search     → detailed document retrieval
/party-search        → party lookup/search
```

Global search tidak harus mendukung semua filter advanced.

---

## 27. Search API Observability

Setiap search request harus meninggalkan jejak operasional.

### 27.1 Metrics

Track:

```text
search.request.count
search.request.latency
search.elasticsearch.took
search.result.count
search.timeout.count
search.error.count
search.zero_result.count
search.page.size
search.facets.enabled.count
search.highlight.enabled.count
search.cursor.usage.count
search.query.length
search.query.profile
search.ranking.profile
```

### 27.2 Logs

Log structured, jangan log data sensitif sembarangan.

Contoh:

```json
{
  "event": "case_search_executed",
  "requestId": "srch_01HX...",
  "tenantId": "tenant-1",
  "userIdHash": "...",
  "queryHash": "...",
  "queryLength": 17,
  "filters": ["status", "severity"],
  "sort": ["relevance", "receivedDate"],
  "pageSize": 20,
  "tookMs": 43,
  "esTookMs": 31,
  "totalRelation": "eq",
  "totalValueBucket": "1000-5000",
  "rankingProfile": "case-search-v4",
  "indexAlias": "cases-search-read"
}
```

Jangan log raw query jika mengandung PII/sensitive text tanpa policy.

### 27.3 Trace

Trace spans:

```text
HTTP request
  validate search request
  resolve permission scope
  build search intent
  build Elasticsearch DSL
  execute Elasticsearch search
  map response
```

Tambahkan attributes:

```text
search.profile
search.index_alias
search.ranking_profile
search.facets_enabled
search.highlight_enabled
search.page_size
search.cursor_used
```

---

## 28. Auditability for Enterprise and Regulatory Systems

Untuk regulatory/case management, search dapat memengaruhi keputusan.

Audit minimal:

- siapa mencari;
- kapan;
- tenant/scope apa;
- query/filter/sort apa;
- result count;
- result top IDs;
- permission scope version;
- ranking profile version;
- index alias/version;
- apakah search complete atau timeout;
- apakah export dibuat;
- apakah debug/explain diakses.

### 28.1 Raw Query vs Normalized Query

Simpan keduanya bila policy mengizinkan:

```text
raw query: input user
normalized query: setelah trim/lower/normalization
query hash: untuk analytics privacy
```

### 28.2 Top Result IDs

Untuk defensibility, kadang perlu menyimpan top N result IDs yang dilihat user.

Tetapi hati-hati:

- storage volume;
- PII;
- retention;
- legal hold;
- access control.

---

## 29. Search API Testing Strategy

### 29.1 Unit Tests

Test pure logic:

- request validation;
- filter schema;
- date range conversion;
- sort plan;
- permission scope requirement;
- cursor validation;
- query intent normalization;
- response mapping.

### 29.2 Query Builder Snapshot Tests

Given intent, assert generated DSL structure.

Example:

```text
Given query="fraud" and status=OPEN
Expect bool.must contains multi_match
Expect bool.filter contains tenant filter
Expect bool.filter contains permission filter
Expect bool.filter contains status term/terms
Expect no wildcard query
```

Jangan snapshot seluruh JSON jika terlalu brittle. Test structural properties.

### 29.3 Integration Tests With Elasticsearch

Use test index:

- known mapping;
- known documents;
- known analyzer behavior;
- known permission scopes.

Test:

- query returns expected top results;
- unauthorized docs excluded;
- facets respect permission;
- pagination stable;
- sort stable;
- highlight safe;
- cursor invalid when request changes.

### 29.4 Relevance Tests

Relevance testing lebih dekat Part 032, tetapi API harus mendukungnya.

Minimum:

```text
golden query → expected top documents / expected not returned documents
```

---

## 30. Search API Checklist

Sebelum production, tanyakan:

### Contract

- Apakah request DTO domain-oriented?
- Apakah response projection aman?
- Apakah Query DSL tidak bocor?
- Apakah filter/sort/facet whitelist?
- Apakah default behavior terdokumentasi?

### Security

- Apakah tenant context mandatory?
- Apakah permission scope mandatory?
- Apakah permission filter diterapkan ke hits dan facets?
- Apakah sensitive fields tidak keluar?
- Apakah debug/explain restricted?

### Pagination

- Apakah page size bounded?
- Apakah deep pagination dicegah?
- Apakah cursor opaque?
- Apakah sort punya tie-breaker?

### Performance

- Apakah wildcard/regexp/script dicegah?
- Apakah facets dibatasi?
- Apakah highlight dibatasi?
- Apakah timeout jelas?
- Apakah expensive request ditolak?

### Compatibility

- Apakah API version berbeda dari ranking profile?
- Apakah index alias menyembunyikan schema version?
- Apakah response additive-friendly?
- Apakah cursor versioned?

### Observability

- Apakah latency diukur?
- Apakah zero result diukur?
- Apakah error taxonomy jelas?
- Apakah ranking profile logged?
- Apakah query hash logged?

### Auditability

- Apakah search action tercatat?
- Apakah scope dan result metadata tercatat?
- Apakah retention policy ada?
- Apakah partial result jelas?

---

## 31. Common Design Scenarios

### 31.1 Case Search UI

Requirement:

- search by case title/body/party;
- filter by status/severity/unit/date;
- facet by status/severity;
- sort by relevance/date;
- permission-aware;
- highlight snippets.

Recommended API:

```http
POST /api/v1/case-search
```

Features:

- cursor pagination;
- stable sort;
- permission filter mandatory;
- ranking profile versioned;
- facet count permission-aware;
- highlight limited.

### 31.2 Case Picker Dropdown

Requirement:

- typeahead for selecting case;
- low latency;
- small result;
- no facets;
- no expensive highlight.

Recommended API:

```http
GET /api/v1/case-picker?q=abc
```

Different from full search.

### 31.3 Audit Export

Requirement:

- export all matching cases;
- exact permission;
- stable result set;
- no highlight;
- async;
- audit trail.

Recommended API:

```http
POST /api/v1/case-search/export-jobs
GET /api/v1/case-search/export-jobs/{jobId}
```

Not same endpoint as UI search.

### 31.4 Global Search

Requirement:

- one search box across case, party, document;
- fast navigation;
- heterogeneous results.

Recommended API:

```http
POST /api/v1/global-search
```

Limit advanced filters. Use vertical-specific endpoint for deep search.

---

## 32. A Full Example Contract

### 32.1 Request

```json
POST /api/v1/case-search
{
  "query": "procurement fraud",
  "filters": {
    "status": ["OPEN", "UNDER_REVIEW"],
    "severity": ["HIGH", "CRITICAL"],
    "receivedDate": {
      "from": "2025-01-01",
      "to": "2025-12-31"
    },
    "hasAttachment": true
  },
  "sort": [
    { "field": "relevance", "direction": "desc" },
    { "field": "receivedDate", "direction": "desc" }
  ],
  "page": {
    "size": 20,
    "cursor": null
  },
  "includeFacets": true,
  "highlight": true
}
```

### 32.2 Response

```json
{
  "requestId": "srch_01J1XYZABC",
  "tookMs": 42,
  "rankingProfile": "case-search-v4",
  "total": {
    "value": 231,
    "relation": "eq"
  },
  "results": [
    {
      "id": "case-2025-00123",
      "type": "CASE",
      "title": "Procurement fraud investigation involving vendor ABC",
      "summary": "Investigation into procurement irregularities...",
      "status": "OPEN",
      "severity": "HIGH",
      "receivedDate": "2025-04-12",
      "highlights": {
        "title": ["Procurement <em>fraud</em> investigation involving vendor ABC"],
        "summary": ["Investigation into procurement irregularities..."]
      }
    }
  ],
  "facets": {
    "status": {
      "buckets": [
        { "value": "OPEN", "label": "Open", "count": 120, "selected": true },
        { "value": "UNDER_REVIEW", "label": "Under Review", "count": 111, "selected": true }
      ]
    },
    "severity": {
      "buckets": [
        { "value": "CRITICAL", "label": "Critical", "count": 29, "selected": true },
        { "value": "HIGH", "label": "High", "count": 202, "selected": true }
      ]
    }
  },
  "page": {
    "nextCursor": "eyJ2IjoxLCJwIjoic2lnbmVkLW9wYXF1ZS10b2tlbiJ9"
  }
}
```

---

## 33. What Top-Tier Engineers Do Differently

Average implementation:

```text
Controller receives JSON.
Controller builds Elasticsearch JSON string.
Frontend sends field names.
Permission filter added manually.
Pagination uses from/size forever.
Sort lacks tie-breaker.
Facets sometimes mismatch.
Errors expose ES exception.
No ranking profile.
No query analytics.
No relevance tests.
```

Top-tier implementation:

```text
API contract is domain-oriented.
Query DSL is internal.
Request is validated semantically.
Permission scope is mandatory.
Tenant is derived from auth context.
Filters/sorts/facets are whitelisted.
Pagination uses bounded size and cursor/PIT where appropriate.
Sort is stable with tie-breaker.
Response is safe projection.
Debug/explain is controlled.
Ranking profile is versioned.
Index schema is hidden behind alias/mapping layer.
Search is observable and auditable.
Expensive queries are rejected.
Relevance changes go through evaluation.
```

---

## 34. Mental Model Recap

A production search API is not:

```text
HTTP wrapper around Elasticsearch
```

It is:

```text
A controlled translation layer from user/domain intent to safe, authorized, performant, evolvable retrieval behavior.
```

The most important invariant:

```text
No user input should directly control index name, field name, query type, aggregation type, script, permission scope, or pagination internals.
```

The second invariant:

```text
Every search result, count, facet, highlight, and export must be produced under the same visibility model.
```

The third invariant:

```text
Search behavior must be versionable, observable, and testable because relevance changes are product behavior changes.
```

---

## 35. References

- Elastic documentation — Paginate search results, including guidance around `search_after`, PIT, and scroll for deep pagination: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results
- Elastic documentation — Boolean query and `minimum_should_match`: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-bool-query
- Elastic documentation — Document and field level security: https://www.elastic.co/docs/deploy-manage/users-roles/cluster-or-deployment-auth/controlling-access-at-document-field-level
- Elastic documentation — Collapse search results: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/collapse-search-results
- Elastic documentation — Composite aggregation: https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-composite-aggregation
- Elastic documentation — Multi-match query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-multi-match-query

---

## 36. Bridge to Part 018

Part 017 mendesain API boundary.

Part 018 akan masuk ke fitur search UX yang sering berada di atas API ini:

- highlighting;
- suggestions;
- autocomplete;
- spell correction;
- fuzzy search;
- completion suggester;
- term/phrase suggester;
- search-as-you-type;
- UX/performance trade-off.

Jika Part 017 adalah kontrak search API, Part 018 adalah bagaimana membuat search terasa responsif, membantu, dan ramah user tanpa mengorbankan correctness dan performance.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-016.md">⬅️ Part 016 — Java Integration Mastery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-018.md">Part 018 — Highlighting, Suggestions, Autocomplete, and Spell Correction ➡️</a>
</div>
