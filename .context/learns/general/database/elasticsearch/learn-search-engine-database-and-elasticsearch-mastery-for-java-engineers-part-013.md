# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-013.md

# Part 013 — Pagination, Sorting, and Result Window Design

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Audiens: Java Software Engineer / Tech Lead  
> Fokus: Search Engine Database, Elasticsearch, Lucene mental model, relevance, production design  
> Posisi dalam seri: setelah filtering/faceting/aggregations, sebelum indexing pipeline dan ingestion

---

## 0. Tujuan Part Ini

Di banyak sistem, pagination dianggap fitur UI sederhana:

```http
GET /cases/search?page=3&size=20
```

Lalu backend menerjemahkannya menjadi:

```json
{
  "from": 40,
  "size": 20
}
```

Untuk dataset kecil, ini terlihat wajar.

Untuk search engine production, pola itu bisa menjadi sumber:

- latency naik tidak linear,
- memory pressure di coordinating node,
- result duplikat antar halaman,
- result hilang antar halaman,
- ranking tidak stabil,
- user melihat count yang tampak tidak konsisten,
- export besar membebani cluster,
- API search UI dipakai sebagai API reporting/export,
- incident karena user membuka page 5000,
- bug authorization karena pagination cursor membawa state yang tidak valid,
- audit problem karena hasil search berubah saat reviewer pindah halaman.

Part ini akan membangun mental model bahwa pagination di Elasticsearch bukan sekadar “offset + limit”, tetapi bagian dari **result window design**.

Kita akan membahas:

1. Apa yang terjadi saat Elasticsearch melakukan pagination.
2. Kenapa `from + size` punya batas natural.
3. Apa itu deep pagination problem.
4. Cara kerja `search_after`.
5. Kenapa stable sort wajib.
6. Apa fungsi Point in Time / PIT.
7. Kapan memakai scroll, kapan tidak.
8. Bagaimana merancang pagination contract di Java backend.
9. Perbedaan search UI, infinite scroll, cursor pagination, dan export.
10. Failure mode yang sering muncul di production.

---

## 1. Core Mental Model

Search pagination berbeda dari SQL pagination.

Di SQL OLTP, Anda mungkin membayangkan:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN'
ORDER BY created_at DESC
OFFSET 1000
LIMIT 20;
```

Di search engine terdistribusi, query dieksekusi ke beberapa shard. Setiap shard menghasilkan kandidat hasil, lalu coordinating node menggabungkan top results dari semua shard.

Secara konseptual:

```text
Client
  |
  v
Coordinating node
  |
  +--> Shard 0: cari top N lokal
  +--> Shard 1: cari top N lokal
  +--> Shard 2: cari top N lokal
  +--> Shard 3: cari top N lokal
  |
  v
Merge global top N
  |
  v
Fetch document details
  |
  v
Return page
```

Untuk page pertama dengan `size = 20`, setiap shard tidak perlu mengirim seluruh match. Ia cukup mengirim kandidat top.

Untuk page jauh, misalnya:

```json
{
  "from": 10000,
  "size": 20
}
```

Elasticsearch secara konseptual perlu mengetahui top `10020` result agar bisa membuang 10000 result pertama dan mengembalikan 20 berikutnya.

Ini bukan free.

```text
from = 0, size = 20
Need top 20

from = 1000, size = 20
Need top 1020

from = 100000, size = 20
Need top 100020
```

Search engine bukan membaca “baris ke-100000” langsung. Ia harus mengumpulkan, membandingkan, dan mengurutkan kandidat sampai window tersebut.

---

## 2. Vocabulary Penting

Sebelum masuk teknik, kita samakan istilah.

### 2.1 Page

Page adalah subset result berdasarkan posisi.

```text
page 1: result 1-20
page 2: result 21-40
page 3: result 41-60
```

### 2.2 Offset Pagination

Pagination berdasarkan offset numerik.

```http
?page=3&size=20
```

Backend menghitung:

```text
from = (page - 1) * size
```

### 2.3 Cursor Pagination

Pagination berdasarkan marker posisi terakhir.

```http
GET /search?cursor=eyJsYXN0U29ydCI6WyIyMDI2LTA2LTIxVDEwOjAwOjAwWiIsIjEyMzQ1Il19
```

Cursor biasanya menyimpan:

- sort values dari item terakhir,
- query hash,
- PIT id,
- page size,
- direction,
- expiry timestamp,
- optional security/user context hash.

### 2.4 Result Window

Window adalah rentang result yang diminta.

```text
from + size
```

Contoh:

```json
{
  "from": 980,
  "size": 20
}
```

Window = 1000.

### 2.5 Deep Pagination

Deep pagination adalah pagination yang meminta result jauh di dalam result set.

Contoh:

```text
page 1000, size 20
from = 19980
```

Deep pagination mahal karena search engine harus mengeksekusi top-K besar.

### 2.6 Stable Sort

Stable sort berarti urutan result konsisten untuk query yang sama selama sesi pagination.

Jika dua document punya nilai sort sama, harus ada tie-breaker unik.

Contoh buruk:

```json
"sort": [
  { "created_at": "desc" }
]
```

Jika banyak document punya `created_at` sama, urutan antar document bisa tidak stabil.

Contoh lebih baik:

```json
"sort": [
  { "created_at": "desc" },
  { "case_id.keyword": "asc" }
]
```

### 2.7 Point in Time / PIT

PIT adalah snapshot ringan dari state index untuk menjaga konsistensi view selama beberapa request search.

Tanpa PIT, page 1 dan page 2 bisa melihat state index berbeda, terutama jika ada indexing, update, delete, refresh, atau segment merge di tengah pagination.

---

## 3. Kenapa Search Pagination Lebih Sulit dari Kelihatannya

Search pagination tampak sederhana jika Anda berpikir dalam model list statis:

```text
[doc1, doc2, doc3, doc4, doc5, ...]
```

Tetapi search engine production memiliki karakteristik:

1. Index terus berubah.
2. Document bisa masuk, update, atau delete saat user sedang membuka halaman.
3. Search berjalan di banyak shard.
4. Replica dapat melayani query.
5. Score dapat berubah karena segment-level stats.
6. Banyak document bisa punya score sama.
7. Sorting by `_score` tidak selalu cukup stabil.
8. Result set bisa sangat besar.
9. User jarang butuh page 1000, tetapi sistem sering tidak membatasi.
10. Export dan UI sering dicampur padahal workload-nya berbeda.

Masalah utama bukan hanya “bagaimana mengambil halaman berikutnya”, tetapi:

> Bagaimana memastikan pagination cepat, stabil, aman, tidak membebani cluster, dan sesuai use case?

---

## 4. `from + size`: Cara Paling Sederhana

Elasticsearch menyediakan pagination dasar menggunakan `from` dan `size`.

Contoh:

```json
GET /cases/_search
{
  "from": 0,
  "size": 20,
  "query": {
    "match": {
      "summary": "late filing"
    }
  }
}
```

Page 2:

```json
GET /cases/_search
{
  "from": 20,
  "size": 20,
  "query": {
    "match": {
      "summary": "late filing"
    }
  }
}
```

Page 3:

```json
GET /cases/_search
{
  "from": 40,
  "size": 20,
  "query": {
    "match": {
      "summary": "late filing"
    }
  }
}
```

Ini cocok untuk:

- page awal,
- result window kecil,
- admin UI sederhana,
- small dataset,
- search yang tidak perlu deep navigation.

Tetapi tidak cocok untuk:

- page sangat dalam,
- export seluruh hasil,
- infinite scroll panjang,
- audit-sensitive review flow,
- batch processing,
- result set yang sering berubah.

---

## 5. Cost Model `from + size`

Misalkan index punya 5 shard.

Request:

```json
{
  "from": 1000,
  "size": 20
}
```

Setiap shard perlu mengumpulkan kandidat cukup banyak agar global top result benar. Secara sederhana, setiap shard bisa perlu menyimpan top `from + size`.

```text
Shard 0 -> top 1020 lokal
Shard 1 -> top 1020 lokal
Shard 2 -> top 1020 lokal
Shard 3 -> top 1020 lokal
Shard 4 -> top 1020 lokal

Coordinating node -> merge global top 1020 -> buang 1000 -> return 20
```

Semakin besar `from`, semakin besar:

- heap untuk priority queue,
- CPU sorting/merging,
- network payload dari shard ke coordinator,
- latency,
- risiko timeout,
- risiko rejected execution,
- pressure pada coordinating node.

Offset pagination punya sifat buruk:

```text
User only wants 20 results.
System must process many more than 20.
```

Untuk page 1:

```text
process ~20
return 20
```

Untuk page 1000:

```text
process ~20000
return 20
```

Ini sangat tidak proporsional.

---

## 6. Default Limit: `index.max_result_window`

Elasticsearch membatasi `from + size` melalui setting `index.max_result_window`.

Default umumnya 10,000.

Artinya request seperti ini bisa ditolak:

```json
{
  "from": 10000,
  "size": 20
}
```

Karena:

```text
from + size = 10020
```

Lebih besar dari window 10,000.

Engineer kadang merespons dengan:

```json
PUT /cases/_settings
{
  "index.max_result_window": 1000000
}
```

Ini biasanya solusi buruk.

Menaikkan `max_result_window` tidak menghilangkan cost model. Ia hanya mengizinkan request mahal berjalan lebih jauh.

Mental model:

```text
index.max_result_window bukan "fitur pagination besar".
index.max_result_window adalah guardrail.
```

Jika guardrail dinaikkan tanpa desain, Anda memindahkan masalah dari “request ditolak” menjadi “cluster lambat atau jatuh”.

---

## 7. Kenapa User Hampir Tidak Pernah Butuh Page Sangat Dalam

Dalam search UX, page dalam sering bukan kebutuhan nyata.

Jika user membuka page 400, biasanya salah satu dari ini terjadi:

1. Query terlalu luas.
2. Filter kurang spesifik.
3. Sorting tidak membantu.
4. Ranking buruk.
5. User sebenarnya butuh export/report.
6. User sedang mencari known item tetapi search tidak punya exact identifier path.
7. Sistem tidak menyediakan facet/filter yang benar.
8. Product requirement meniru database table browsing, bukan search experience.

Search system yang bagus mengarahkan user mempersempit intent.

Contoh:

```text
Buruk:
User search "permit" -> 580,000 result -> page 700

Lebih baik:
User search "permit" + jurisdiction + status + date range + party type + severity
```

Untuk sistem case management/regulatory, deep pagination sering sinyal bahwa UX search salah.

Reviewer tidak seharusnya “menyisir 80,000 hasil” lewat page UI. Mereka butuh:

- filter workflow,
- saved search,
- triage queue,
- assignment queue,
- export job,
- review batch,
- prioritization ranking,
- exact lookup,
- temporal slicing,
- facet-driven narrowing.

---

## 8. Sorting sebagai Bagian dari Correctness

Pagination tanpa sorting yang jelas itu rapuh.

Jika query tidak punya sort eksplisit, Elasticsearch biasanya mengurutkan berdasarkan relevance score (`_score`) untuk query scoring.

Tetapi `_score` saja sering tidak cukup untuk pagination stabil.

Mengapa?

Karena banyak document bisa punya score sama.

Contoh:

```text
docA score = 1.0
docB score = 1.0
docC score = 1.0
docD score = 1.0
```

Tanpa tie-breaker, urutan relatif bisa berubah antar request.

Hal ini bisa menyebabkan:

- document muncul di dua page,
- document tidak pernah muncul,
- page terasa “acak”,
- audit trail sulit dijelaskan.

Solusi:

```json
"sort": [
  { "_score": "desc" },
  { "case_id.keyword": "asc" }
]
```

Atau untuk timeline search:

```json
"sort": [
  { "created_at": "desc" },
  { "case_id.keyword": "asc" }
]
```

Tie-breaker harus:

- unik,
- stabil,
- tidak berubah selama pagination,
- tersedia sebagai doc values,
- bukan field analyzed text.

Biasanya:

- `case_id.keyword`,
- `document_id.keyword`,
- `sortable_id`,
- ULID,
- UUID keyword,
- monotonically increasing ID jika sesuai,
- synthetic stable sequence.

---

## 9. Sort Field Design

Tidak semua field cocok untuk sorting.

Field untuk sort sebaiknya:

1. Bertipe `keyword`, numeric, date, boolean, atau field lain yang punya `doc_values`.
2. Tidak analyzed.
3. Nilainya tidak sering berubah selama user paging.
4. Tidak memiliki cardinality/struktur yang membuat sort ambigu.
5. Memiliki missing value strategy jika nullable.
6. Dipikirkan sejak mapping design.

Contoh mapping:

```json
PUT /cases_v1
{
  "mappings": {
    "properties": {
      "case_id": {
        "type": "keyword"
      },
      "created_at": {
        "type": "date"
      },
      "priority_score": {
        "type": "double"
      },
      "title": {
        "type": "text",
        "fields": {
          "keyword": {
            "type": "keyword",
            "ignore_above": 256
          }
        }
      }
    }
  }
}
```

Sorting by `title.keyword` mungkin cocok untuk alphabetical browse, tetapi tidak cocok untuk full-text relevance flow.

---

## 10. Sorting by `_score`

Sorting by `_score` adalah default untuk relevance search.

Contoh:

```json
GET /cases/_search
{
  "query": {
    "multi_match": {
      "query": "late filing",
      "fields": ["title^3", "summary", "parties.name"]
    }
  },
  "sort": [
    { "_score": "desc" },
    { "case_id": "asc" }
  ]
}
```

Masalahnya:

- score bisa sama,
- score bisa berubah jika query berubah,
- score bisa berubah setelah index refresh karena document stats/segment state berubah,
- score tidak intuitif untuk user sebagai posisi absolut,
- page sangat dalam by score jarang berguna.

Gunakan score sorting untuk search UX page awal.

Jangan gunakan score sorting untuk:

- export all,
- audit snapshot besar,
- deterministic batch job,
- “download semua hasil sesuai ranking” tanpa PIT/cursor,
- long-running review queue tanpa frozen query state.

---

## 11. Sorting by Date

Sorting by date umum untuk case management:

```json
"sort": [
  { "created_at": "desc" },
  { "case_id": "asc" }
]
```

Gunanya:

- newest first,
- recently updated,
- due soon,
- oldest unprocessed,
- SLA deadline.

Tetapi hati-hati:

1. Banyak document bisa punya timestamp sama.
2. Timestamp bisa berubah jika field adalah `updated_at`.
3. Timezone harus sudah dinormalisasi.
4. Nullable date harus diberi missing behavior.
5. Sorting by mutable date bisa membuat document pindah posisi saat user paging.

Contoh dengan missing:

```json
"sort": [
  {
    "due_at": {
      "order": "asc",
      "missing": "_last"
    }
  },
  { "case_id": "asc" }
]
```

Untuk regulatory queue:

```text
Sort:
1. due_at asc
2. severity desc
3. created_at asc
4. case_id asc
```

Tetapi jika field `severity` sering berubah karena escalation logic, Anda harus mempertimbangkan stabilitas pagination.

---

## 12. Sorting by Keyword

Sorting by keyword cocok untuk:

- alphabetical browse,
- exact code,
- party name normalized,
- jurisdiction,
- category.

Contoh:

```json
"sort": [
  { "respondent_name.sort": "asc" },
  { "case_id": "asc" }
]
```

Biasanya Anda perlu normalized keyword field.

Contoh mapping:

```json
PUT /cases_v1
{
  "settings": {
    "analysis": {
      "normalizer": {
        "lowercase_ascii_normalizer": {
          "type": "custom",
          "filter": ["lowercase", "asciifolding"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "respondent_name": {
        "type": "text",
        "fields": {
          "sort": {
            "type": "keyword",
            "normalizer": "lowercase_ascii_normalizer"
          }
        }
      }
    }
  }
}
```

Jangan sort pada field `text` analyzed.

---

## 13. Sorting by Business Priority

Contoh:

```json
"sort": [
  { "risk_score": "desc" },
  { "due_at": "asc" },
  { "case_id": "asc" }
]
```

Ini cocok untuk queue:

- investigation queue,
- escalation queue,
- reviewer workload,
- SLA queue,
- enforcement priority list.

Namun business priority sering berubah. Jika queue harus stabil selama sesi reviewer, gunakan salah satu:

1. PIT + `search_after`.
2. Snapshot assignment table di canonical DB.
3. Search hanya untuk discovery, bukan work allocation.
4. Precomputed queue version.

Untuk regulatory systems, jangan campur:

```text
Search result ranking
```

dengan:

```text
Official assignment order
```

tanpa kontrak yang jelas.

Search ranking boleh membantu menemukan prioritas. Assignment order biasanya butuh stronger auditability.

---

## 14. `search_after`: Cursor-Based Pagination

`search_after` memungkinkan pagination berdasarkan sort value dari result terakhir.

Page pertama:

```json
GET /cases/_search
{
  "size": 20,
  "query": {
    "match": {
      "summary": "late filing"
    }
  },
  "sort": [
    { "created_at": "desc" },
    { "case_id": "asc" }
  ]
}
```

Response hit terakhir:

```json
{
  "_id": "CASE-2026-000991",
  "_source": {
    "case_id": "CASE-2026-000991",
    "created_at": "2026-06-21T09:15:30Z"
  },
  "sort": [
    "2026-06-21T09:15:30.000Z",
    "CASE-2026-000991"
  ]
}
```

Page berikutnya:

```json
GET /cases/_search
{
  "size": 20,
  "query": {
    "match": {
      "summary": "late filing"
    }
  },
  "sort": [
    { "created_at": "desc" },
    { "case_id": "asc" }
  ],
  "search_after": [
    "2026-06-21T09:15:30.000Z",
    "CASE-2026-000991"
  ]
}
```

Prinsip penting:

```text
search_after harus memakai sort values dari hit terakhir.
Query dan sort harus tetap sama.
```

Kalau query berubah, cursor tidak valid.

Kalau sort berubah, cursor tidak valid.

Kalau filter berubah, cursor tidak valid.

Kalau authorization context berubah, cursor harus dianggap tidak valid.

---

## 15. Kenapa `search_after` Lebih Baik untuk Deep Pagination

Dengan offset:

```json
{
  "from": 100000,
  "size": 20
}
```

Elasticsearch harus mengumpulkan top 100020.

Dengan `search_after`, ia mencari result setelah sort marker tertentu.

Konsepnya:

```text
Berikan 20 result setelah posisi:
(created_at = X, case_id = Y)
```

Bukan:

```text
Berikan result nomor 100001 sampai 100020
```

Ini menghindari cost membuang puluhan ribu result pada setiap request.

Namun `search_after` bukan magic.

Ia tetap butuh:

- sort stabil,
- cursor state,
- query konsisten,
- handling perubahan index,
- PIT jika ingin konsistensi snapshot.

---

## 16. Keterbatasan `search_after`

`search_after` bukan pengganti langsung page number.

Dengan offset pagination, user bisa lompat:

```text
page 1 -> page 200
```

Dengan `search_after`, user bergerak berdasarkan cursor:

```text
page 1 -> next -> next -> next
```

Jadi cocok untuk:

- infinite scroll,
- next/previous flow terbatas,
- cursor API,
- export streaming,
- long list forward traversal.

Kurang cocok untuk:

- UI dengan random page jump,
- “go to page 57”,
- arbitrary page number.

Tetapi dalam search UX modern, random page jump biasanya tidak penting. Jika product menuntut “go to page 500”, pertanyakan use case-nya.

---

## 17. Point in Time / PIT

Tanpa PIT, request page 1 dan page 2 bisa melihat index state berbeda.

Contoh timeline:

```text
T1: User request page 1
T2: New document indexed and refreshed
T3: User request page 2
```

Jika new document masuk ke posisi sebelum cursor, result bisa bergeser.

PIT membantu dengan memberi snapshot konsisten selama sesi pagination.

Flow:

```text
1. Open PIT
2. Search page 1 with PIT
3. Take last sort values
4. Search page 2 with same/latest PIT
5. Continue
6. Close PIT
```

Contoh open PIT:

```json
POST /cases/_pit?keep_alive=1m
```

Response:

```json
{
  "id": "PIT_ID"
}
```

Search dengan PIT:

```json
GET /_search
{
  "size": 20,
  "pit": {
    "id": "PIT_ID",
    "keep_alive": "1m"
  },
  "query": {
    "match": {
      "summary": "late filing"
    }
  },
  "sort": [
    { "created_at": "desc" },
    { "case_id": "asc" }
  ]
}
```

Page berikutnya:

```json
GET /_search
{
  "size": 20,
  "pit": {
    "id": "PIT_ID",
    "keep_alive": "1m"
  },
  "query": {
    "match": {
      "summary": "late filing"
    }
  },
  "sort": [
    { "created_at": "desc" },
    { "case_id": "asc" }
  ],
  "search_after": [
    "2026-06-21T09:15:30.000Z",
    "CASE-2026-000991"
  ]
}
```

Close PIT:

```json
DELETE /_pit
{
  "id": "PIT_ID"
}
```

Mental model:

```text
PIT menjaga "view" index agar pagination konsisten.
search_after menjaga posisi traversal.
Stable sort menjaga urutan deterministik.
```

Ketiganya saling melengkapi.

---

## 18. PIT Bukan Snapshot Database Penuh

PIT bukan berarti semua document disalin.

PIT menjaga reader context agar search melihat state tertentu. Ini punya biaya resource.

Karena itu:

- gunakan `keep_alive` pendek,
- jangan biarkan PIT idle lama,
- close jika selesai,
- jangan membuat PIT untuk setiap request tanpa kontrol,
- jangan pakai PIT sebagai session state permanen.

Contoh keep alive buruk:

```json
"keep_alive": "2h"
```

Untuk UI search, biasanya pendek:

```json
"keep_alive": "1m"
```

atau beberapa menit tergantung UX.

Backend bisa memperpanjang PIT setiap page request.

---

## 19. Cursor Contract di Backend API

Jangan expose raw Elasticsearch internals sembarangan.

Buruk:

```json
{
  "pitId": "raw-pit-id",
  "searchAfter": ["2026-06-21T09:15:30Z", "CASE-123"]
}
```

Lebih baik:

```json
{
  "items": [...],
  "nextCursor": "eyJ2IjoxLCJwaXQiOiIuLi4iLCJzb3J0IjpbIi4uLiJdLCJxaCI6Ii4uLiJ9",
  "hasMore": true
}
```

Cursor internal bisa berisi:

```json
{
  "version": 1,
  "pit_id": "...",
  "sort_values": ["2026-06-21T09:15:30.000Z", "CASE-2026-000991"],
  "query_hash": "sha256-of-canonical-query",
  "sort_hash": "sha256-of-sort-contract",
  "page_size": 20,
  "issued_at": "2026-06-21T10:00:00Z",
  "expires_at": "2026-06-21T10:05:00Z",
  "principal_hash": "sha256-user-or-tenant-permission-context"
}
```

Kemudian backend encode:

- JSON,
- Base64URL,
- optionally signed HMAC,
- optionally encrypted jika mengandung sensitive state.

Untuk regulatory systems, cursor sebaiknya ditandatangani.

Kenapa?

Agar user tidak bisa mengubah:

- page size,
- sort values,
- tenant ID,
- permission hash,
- PIT ID,
- query state.

---

## 20. Jangan Percaya Cursor dari Client

Cursor adalah state dari server yang kebetulan dibawa client.

Backend harus validasi:

1. Signature valid.
2. Cursor belum expired.
3. Query hash sama dengan request saat ini.
4. Sort hash sama.
5. Page size tidak melebihi limit.
6. Principal/tenant context sama.
7. Cursor version didukung.
8. PIT masih valid.
9. Direction valid.
10. Feature flag/query mode masih sesuai.

Jika tidak valid:

```http
400 Bad Request
```

atau:

```http
410 Gone
```

Dengan response:

```json
{
  "error": "CURSOR_EXPIRED",
  "message": "Search cursor has expired. Please restart the search."
}
```

---

## 21. Java API Design: Request/Response Model

Contoh request DTO:

```java
public record CaseSearchRequest(
    String query,
    List<FilterCriterion> filters,
    List<SortCriterion> sort,
    Integer size,
    String cursor
) {}
```

Response DTO:

```java
public record SearchPage<T>(
    List<T> items,
    String nextCursor,
    boolean hasMore,
    Long totalHits,
    TotalHitsRelation totalHitsRelation
) {}
```

Jangan jadikan public API terlalu Elasticsearch-specific.

Buruk:

```java
public record SearchRequestDto(
    Map<String, Object> elasticQuery,
    Object[] searchAfter,
    String pitId
) {}
```

Lebih baik:

```java
public record CaseSearchRequest(
    String keyword,
    CaseSearchFilters filters,
    CaseSearchSort sort,
    int size,
    String cursor
) {}
```

Backend menerjemahkan domain search contract ke Elasticsearch DSL.

---

## 22. Java Cursor Object

Contoh cursor internal:

```java
public record SearchCursor(
    int version,
    String pitId,
    List<Object> searchAfter,
    String queryHash,
    String sortHash,
    int pageSize,
    Instant issuedAt,
    Instant expiresAt,
    String principalHash
) {}
```

Encoder:

```java
public interface SearchCursorCodec {
    String encode(SearchCursor cursor);
    SearchCursor decode(String encodedCursor);
}
```

Implementasi minimal:

```java
public final class HmacSearchCursorCodec implements SearchCursorCodec {
    private final ObjectMapper objectMapper;
    private final MacSigner signer;

    public HmacSearchCursorCodec(ObjectMapper objectMapper, MacSigner signer) {
        this.objectMapper = objectMapper;
        this.signer = signer;
    }

    @Override
    public String encode(SearchCursor cursor) {
        try {
            byte[] payload = objectMapper.writeValueAsBytes(cursor);
            byte[] signature = signer.sign(payload);

            CursorEnvelope envelope = new CursorEnvelope(
                Base64.getUrlEncoder().withoutPadding().encodeToString(payload),
                Base64.getUrlEncoder().withoutPadding().encodeToString(signature)
            );

            byte[] envelopeBytes = objectMapper.writeValueAsBytes(envelope);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(envelopeBytes);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to encode search cursor", e);
        }
    }

    @Override
    public SearchCursor decode(String encodedCursor) {
        try {
            byte[] envelopeBytes = Base64.getUrlDecoder().decode(encodedCursor);
            CursorEnvelope envelope = objectMapper.readValue(envelopeBytes, CursorEnvelope.class);

            byte[] payload = Base64.getUrlDecoder().decode(envelope.payload());
            byte[] signature = Base64.getUrlDecoder().decode(envelope.signature());

            if (!signer.verify(payload, signature)) {
                throw new InvalidSearchCursorException("Invalid cursor signature");
            }

            return objectMapper.readValue(payload, SearchCursor.class);
        } catch (IllegalArgumentException | IOException e) {
            throw new InvalidSearchCursorException("Invalid cursor encoding", e);
        }
    }

    private record CursorEnvelope(String payload, String signature) {}
}
```

Ini contoh konseptual. Di production, perhatikan:

- key rotation,
- clock skew,
- payload compatibility,
- sensitive data,
- observability,
- exception mapping.

---

## 23. Query Hash untuk Cursor Safety

Query hash mencegah cursor lama dipakai pada query baru.

Contoh:

```java
public final class SearchRequestCanonicalizer {
    public String canonicalHash(CaseSearchRequest request, PrincipalContext principal) {
        CanonicalSearchState state = new CanonicalSearchState(
            normalizeKeyword(request.query()),
            normalizeFilters(request.filters()),
            normalizeSort(request.sort()),
            principal.tenantId(),
            principal.permissionVersion()
        );

        byte[] json = stableJson(state);
        return sha256Hex(json);
    }
}
```

Jika user mengubah filter:

```text
status=OPEN
```

menjadi:

```text
status=CLOSED
```

cursor sebelumnya tidak boleh dipakai.

Jika permission context berubah, cursor juga harus invalid.

Dalam regulatory/case-management systems, permission bisa berubah karena:

- user role berubah,
- assignment berubah,
- case confidentiality berubah,
- legal hold state berubah,
- organizational unit berubah,
- document sensitivity changed,
- delegation expired.

Cursor yang tidak membawa permission/version hash bisa menyebabkan user melihat hasil dengan context lama.

---

## 24. Pagination dengan PIT dan Java API Client: Konseptual

Pseudocode:

```java
public SearchPage<CaseSearchResult> searchCases(CaseSearchRequest request, PrincipalContext principal) {
    int size = validateAndNormalizeSize(request.size());

    SearchCursor cursor = null;
    String pitId;

    if (request.cursor() == null) {
        pitId = openPit("cases_current", Duration.ofMinutes(1));
    } else {
        cursor = cursorCodec.decode(request.cursor());
        validateCursor(cursor, request, principal);
        pitId = cursor.pitId();
    }

    Query elasticQuery = caseQueryBuilder.build(request, principal);
    List<SortOptions> sort = caseSortBuilder.build(request.sort());

    SearchRequest.Builder builder = new SearchRequest.Builder()
        .size(size)
        .pit(p -> p.id(pitId).keepAlive(t -> t.time("1m")))
        .query(elasticQuery)
        .sort(sort);

    if (cursor != null) {
        builder.searchAfter(cursor.searchAfter().stream()
            .map(this::toFieldValue)
            .toList());
    }

    SearchResponse<CaseSearchDocument> response =
        elasticsearchClient.search(builder.build(), CaseSearchDocument.class);

    List<Hit<CaseSearchDocument>> hits = response.hits().hits();

    String nextCursor = null;
    if (hits.size() == size) {
        Hit<CaseSearchDocument> last = hits.get(hits.size() - 1);
        nextCursor = cursorCodec.encode(new SearchCursor(
            1,
            response.pitId() != null ? response.pitId() : pitId,
            extractSortValues(last),
            canonicalizer.canonicalHash(request, principal),
            sortHasher.hash(sort),
            size,
            Instant.now(clock),
            Instant.now(clock).plus(Duration.ofMinutes(5)),
            principalHasher.hash(principal)
        ));
    }

    return new SearchPage<>(
        hits.stream().map(mapper::toResult).toList(),
        nextCursor,
        nextCursor != null,
        extractTotalHits(response),
        extractTotalHitsRelation(response)
    );
}
```

Catatan:

- API detail Java client bisa berubah antar versi.
- Prinsip desain lebih penting daripada signature persis.
- Selalu gunakan dokumentasi versi Elasticsearch yang Anda pakai.
- Jangan mengikat public API pada class Elasticsearch.

---

## 25. `track_total_hits` dan Total Count

User sering ingin:

```text
Showing 1-20 of 823,912 results
```

Total count bisa mahal untuk query besar.

Elasticsearch dapat memberi total hits dengan relation:

```json
"hits": {
  "total": {
    "value": 10000,
    "relation": "gte"
  }
}
```

Maknanya:

```text
Ada setidaknya 10,000 hasil.
```

Bukan persis 10,000.

Untuk banyak search UX, ini cukup:

```text
10,000+ results
```

Daripada memaksa exact count setiap query.

Pilihan desain:

### 25.1 Exact Count

```json
"track_total_hits": true
```

Cocok jika:

- result set tidak besar,
- count adalah requirement legal/operasional,
- query sudah sangat terfilter,
- workload bisa menerima cost.

### 25.2 Threshold Count

```json
"track_total_hits": 10000
```

Cocok untuk search UI umum.

### 25.3 No Count

```json
"track_total_hits": false
```

Cocok untuk infinite scroll atau autocomplete.

UX:

```text
Show more results
```

bukan:

```text
Page 1 of 24500
```

Dalam regulatory system, exact count kadang penting untuk report/audit. Tetapi jangan otomatis hitung exact count pada setiap interactive search. Pisahkan:

- interactive search endpoint,
- count endpoint,
- report/export job.

---

## 26. Page Number vs Cursor: API Contract

### 26.1 Page Number API

```http
GET /cases/search?q=late+filing&page=3&size=20
```

Kelebihan:

- familiar,
- mudah untuk UI pagination klasik,
- mudah share URL.

Kekurangan:

- deep pagination mahal,
- kurang stabil saat data berubah,
- page jump mendorong desain buruk.

Cocok:

- result window kecil,
- internal admin kecil,
- browse sederhana,
- page max dibatasi.

### 26.2 Cursor API

```http
GET /cases/search?q=late+filing&size=20&cursor=...
```

Kelebihan:

- lebih baik untuk traversal panjang,
- cocok dengan `search_after`,
- lebih stabil dengan PIT,
- tidak expose offset dalam.

Kekurangan:

- tidak bisa lompat arbitrary page,
- cursor lifecycle harus dikelola,
- URL lebih kompleks,
- state validation lebih rumit.

Cocok:

- infinite scroll,
- queue traversal,
- large search result navigation,
- export-like streaming,
- mobile UX,
- review flow.

### 26.3 Hybrid

Banyak sistem memakai hybrid:

- `page/size` hanya sampai batas kecil.
- `cursor` untuk next pages.
- Export menggunakan job terpisah.

Contoh:

```text
Interactive search:
- max size = 100
- max page = 50
- max result window = 5000

Cursor search:
- max size = 100
- cursor expiry = 5 minutes
- PIT enabled

Export:
- async job
- no UI endpoint reuse
- rate limited
- audited
```

---

## 27. UI Design: Jangan Menipu User dengan Page Number Besar

Pagination klasik:

```text
1 2 3 4 5 ... 23140 Next
```

Untuk search, ini sering buruk.

Alternatif:

```text
Showing top results
[Refine filters] [Load more]
```

atau:

```text
Showing 1-20 of 10,000+ results
[Next]
```

atau untuk case review:

```text
20 highest priority matching cases
[Assign batch] [Refine] [Export as job]
```

Jangan membuat UI seolah semua page sama mudah dan sama valid.

Search ranking berarti page awal lebih penting. Jika user harus ke page 1000, ranking/filtering gagal.

---

## 28. Infinite Scroll

Infinite scroll cocok untuk:

- discovery,
- search result browsing,
- feed-like experience,
- low audit requirement,
- mobile experience.

Tetapi risiko:

- user kehilangan posisi,
- sulit share exact result,
- sulit audit,
- scroll panjang membebani backend,
- browser memory naik,
- accessibility issue,
- permission/search context bisa berubah.

Untuk infinite scroll Elasticsearch:

- gunakan `search_after`,
- gunakan PIT jika perlu konsistensi,
- batasi max traversal,
- gunakan cursor expiry,
- jangan load otomatis tanpa user action terlalu agresif,
- tambahkan filter refinement,
- record query analytics.

---

## 29. Search UI vs Export

Ini salah satu kesalahan production paling mahal.

Search UI endpoint:

```http
GET /cases/search?query=...
```

Sering dipakai user untuk melihat 20-100 result.

Export requirement:

```text
Download all 480,000 matching cases as CSV.
```

Jangan implement export dengan loop:

```text
for page = 1 to 24000:
    call /cases/search?page=page&size=20
```

Ini buruk karena:

- memakai `from + size`,
- membebani coordinator,
- banyak duplicate/missing risk,
- tidak punya retry semantics baik,
- tidak ada checkpoint,
- tidak ada audit job,
- tidak ada rate control,
- tidak ada backpressure,
- tidak jelas snapshot consistency,
- timeout sangat mungkin.

Export harus menjadi workload berbeda.

---

## 30. Export Design yang Lebih Benar

Untuk export:

1. Buat export job.
2. Simpan request canonical.
3. Validasi permission.
4. Buka PIT atau gunakan snapshot/time boundary.
5. Traverse dengan `search_after`.
6. Tulis ke object storage/file.
7. Checkpoint per batch.
8. Rate limit.
9. Audit.
10. Notify user saat selesai.
11. Expire file sesuai policy.

Konsep API:

```http
POST /case-search-exports
```

Request:

```json
{
  "query": "late filing",
  "filters": {
    "status": ["OPEN"],
    "jurisdiction": ["ID-JK"],
    "createdFrom": "2025-01-01",
    "createdTo": "2026-06-21"
  },
  "fields": ["caseId", "title", "status", "createdAt", "assignedUnit"],
  "format": "CSV"
}
```

Response:

```json
{
  "exportJobId": "EXP-2026-000012",
  "status": "QUEUED"
}
```

Worker:

```text
open PIT
while has more:
    search_after batch size 1000
    write rows
    checkpoint last sort values
close PIT
mark complete
```

Untuk export besar, pertimbangkan:

- apakah source-of-truth DB lebih tepat,
- apakah search index mengandung semua field yang legal untuk diekspor,
- apakah result harus merefleksikan snapshot waktu tertentu,
- apakah permission harus dievaluasi per row saat export,
- apakah data sensitive perlu masking,
- apakah export harus reproducible.

---

## 31. Scroll API

Scroll API historically digunakan untuk mengambil banyak result.

Namun untuk deep pagination user-facing, pendekatan modern Elasticsearch lebih menyarankan `search_after` dengan PIT.

Scroll masih bisa relevan pada beberapa skenario batch lama atau compatibility, tetapi jangan jadikan default untuk interactive search.

Mental model:

```text
Scroll = batch traversal context.
search_after + PIT = modern pagination/traversal pattern.
from + size = shallow interactive pagination.
```

Gunakan scroll dengan hati-hati karena scroll context juga memegang resource.

Dalam sistem baru, mulai dari pertanyaan:

```text
Apakah ini interactive search, infinite scroll, export, atau reindex/batch traversal?
```

Bukan:

```text
Pakai scroll atau from-size?
```

---

## 32. Backward Pagination

`search_after` natural untuk forward pagination.

Backward pagination lebih rumit.

Opsi:

1. Simpan cursor stack di client/backend untuk previous pages.
2. Reverse sort direction dan query sebelum current first item.
3. Gunakan page cache pendek di backend.
4. Pakai offset pagination untuk shallow previous/next.
5. UX hanya menyediakan “Back” berdasarkan browser/client state.

Untuk banyak search UI:

```text
Next / Load more
```

lebih realistis daripada arbitrary previous/backward cursor.

Jika regulatory reviewer butuh stable review queue dengan previous/next, pertimbangkan menyimpan worklist snapshot terpisah.

---

## 33. Stable Sort untuk Cursor: Pattern

### 33.1 Relevance Search

```json
"sort": [
  { "_score": "desc" },
  { "case_id": "asc" }
]
```

### 33.2 Newest First

```json
"sort": [
  { "created_at": "desc" },
  { "case_id": "asc" }
]
```

### 33.3 Oldest SLA First

```json
"sort": [
  { "sla_due_at": { "order": "asc", "missing": "_last" } },
  { "severity_rank": "desc" },
  { "case_id": "asc" }
]
```

### 33.4 Business Priority

```json
"sort": [
  { "priority_score": "desc" },
  { "last_activity_at": "desc" },
  { "case_id": "asc" }
]
```

### 33.5 Export Deterministic

```json
"sort": [
  { "case_id": "asc" }
]
```

Untuk export, sort by stable unique ID sering lebih baik daripada `_score`.

---

## 34. `_doc` and `_shard_doc`

Ada sort khusus yang kadang muncul dalam dokumentasi atau diskusi:

- `_doc`
- `_shard_doc`

`_doc` historically digunakan untuk efficient scan order, bukan business ordering.

`_shard_doc` terkait pagination dengan PIT sebagai tie-breaker internal yang unik dalam PIT context.

Jangan expose ini sebagai domain sort ke user.

Untuk application design, pikirkan domain sort:

```text
created_at desc, case_id asc
```

atau:

```text
priority_score desc, case_id asc
```

Bukan:

```text
_shard_doc asc
```

Kecuali Anda membangun traversal internal yang tidak peduli order, misalnya export scan, dan benar-benar memahami konsekuensinya.

---

## 35. Index Sorting

Elasticsearch mendukung index sorting: document disimpan dalam segment dengan sort tertentu.

Ini bisa membantu query yang sering menggunakan sort yang sama.

Contoh conceptual use case:

```text
Semua query utama selalu filter tenant_id dan sort created_at desc.
```

Namun index sorting punya trade-off:

- indexing bisa lebih mahal,
- sort harus dipilih saat index creation,
- tidak semua sort pattern bisa dioptimalkan,
- salah pilih sort bisa tidak membantu,
- migration butuh reindex.

Jangan aktifkan index sorting hanya karena “sorting lambat”.

Gunakan setelah:

1. Query pattern stabil.
2. Profiling menunjukkan sort bottleneck.
3. Mapping dan shard strategy sudah benar.
4. Anda mengerti ingestion cost.
5. Anda punya benchmark.

---

## 36. Pagination dan Authorization

Permission-aware search memperumit pagination.

Misalnya query:

```text
late filing
```

User A boleh lihat 10,000 case.

User B boleh lihat 300 case.

Jika cursor User A dipakai User B, harus gagal.

Cursor harus terkait dengan:

- user/principal,
- tenant,
- role,
- permission version,
- visibility policy version,
- organization unit,
- delegated access state.

Selain itu, permission filtering harus konsisten antar page.

Buruk:

```text
Page 1: Elasticsearch returns 20, app filters unauthorized down to 12.
Page 2: Elasticsearch returns next 20, app filters down to 9.
```

Ini membuat pagination rusak karena `search_after` berjalan berdasarkan raw result, bukan visible result.

Lebih baik:

1. Push permission filter ke Elasticsearch query jika possible.
2. Atau precompute visibility fields.
3. Atau use dedicated access index.
4. Atau accept application-side filtering dengan over-fetch dan complex cursor, tetapi ini sulit.

Untuk regulatory search, data leakage bisa terjadi melalui:

- result hits,
- facet counts,
- total count,
- suggestions,
- highlights,
- timing,
- “no result” behavior.

Pagination tidak bisa dipisah dari authorization.

---

## 37. Application-Side Filtering dan Over-Fetch Problem

Kadang app harus memfilter result setelah Elasticsearch.

Contoh:

```text
Elasticsearch returns 100 hits.
Application removes 80 unauthorized hits.
User sees 20.
```

Jika page size 20, mungkin Anda over-fetch 100 untuk mendapat 20 visible items.

Masalah:

- cost naik,
- cursor harus berdasarkan last raw hit atau last visible hit?
- bisa infinite loop jika banyak unauthorized hits,
- total count tidak akurat,
- hasMore sulit dihitung,
- latency unpredictable.

Pattern minimal:

```text
while visible.size < requestedSize and attempts < maxAttempts:
    query ES with search_after raw cursor
    filter visible
    update raw cursor
```

Tetapi ini lebih kompleks dan tetap punya batas.

Lebih baik desain index agar permission filter bisa dieksekusi di Elasticsearch:

```json
"filter": [
  { "term": { "tenant_id": "TENANT-1" } },
  { "terms": { "visible_to_units": ["UNIT-A", "UNIT-B"] } },
  { "terms": { "visibility_labels": ["PUBLIC", "REVIEWER_ACCESS"] } }
]
```

Jangan menunda permission design sampai akhir.

---

## 38. Pagination dan Facet Consistency

Di Part 012, kita bahas faceting.

Pagination harus sinkron dengan facet semantics.

Jika user memakai filter:

```text
status = OPEN
jurisdiction = Jakarta
```

Maka:

- result hits harus match filter,
- facet counts harus jelas apakah sebelum/after selected filter,
- total hits harus sesuai relation yang dijanjikan,
- next cursor harus mewakili query/filter/sort yang sama.

Jika filter berubah, cursor invalid.

UX harus tahu:

```text
Changing filters restarts pagination.
```

Jangan diam-diam memakai cursor lama setelah filter berubah.

---

## 39. Pagination dan Highlighting

Highlighting bisa mahal.

Jika page size besar dan highlighting aktif pada banyak field, latency naik.

Pattern:

```text
Search page:
- size 20
- highlight title/summary only

Detail page:
- fetch full document
- highlight larger body only when needed
```

Jangan export memakai highlighted fields.

Jangan infinite scroll dengan heavy highlighting pada 100 fields.

Pagination bukan hanya mengambil IDs. Fetch phase dan highlight phase juga memengaruhi cost.

---

## 40. Pagination dan `_source` Filtering

Result page sebaiknya hanya fetch fields yang dibutuhkan.

Buruk:

```json
"_source": true
```

Jika document besar.

Lebih baik:

```json
"_source": [
  "case_id",
  "title",
  "summary",
  "status",
  "severity",
  "created_at",
  "assigned_unit"
]
```

Untuk search result list, jangan fetch:

- full evidence text,
- large attachment content,
- full audit history,
- nested payload besar,
- raw OCR body jika tidak ditampilkan.

Source filtering dapat mengurangi:

- network payload,
- deserialization cost di Java,
- memory pressure,
- response time.

---

## 41. Pagination dan `collapse`

Field collapsing dipakai untuk group result.

Contoh:

```text
Tampilkan satu result per case, meskipun index punya banyak case_documents.
```

Query:

```json
{
  "query": {
    "match": {
      "content": "late filing"
    }
  },
  "collapse": {
    "field": "case_id"
  },
  "sort": [
    { "_score": "desc" },
    { "case_id": "asc" }
  ]
}
```

Pagination dengan collapse lebih tricky.

Hal yang harus diperhatikan:

- total hits bisa mengacu raw hits, bukan collapsed groups,
- inner hits menambah cost,
- stable sorting tetap penting,
- deep paging collapsed result bisa mahal,
- export collapsed groups butuh desain khusus.

Untuk case management, collapse sering berguna saat index unit adalah `case_document`, tetapi UI result unit adalah `case`.

Namun lebih baik sejak document modeling tentukan:

```text
Apakah retrieval unit = case?
Apakah retrieval unit = document/evidence?
Apakah result grouping dilakukan search-time atau index-time?
```

---

## 42. Pagination dan Nested Documents

Nested query bisa memengaruhi sort dan pagination.

Jika sort berdasarkan nested field:

```json
"sort": [
  {
    "parties.risk_score": {
      "order": "desc",
      "mode": "max",
      "nested": {
        "path": "parties"
      }
    }
  },
  { "case_id": "asc" }
]
```

Anda harus menentukan:

- nested path,
- sort mode: min/max/avg/sum,
- nested filter jika perlu,
- tie-breaker.

Nested sorting bisa lebih mahal daripada flat field.

Jika sort field penting untuk queue/ranking, sering lebih baik precompute ke root document:

```json
{
  "max_party_risk_score": 91.2,
  "highest_risk_party_name": "..."
}
```

Search document harus didesain dari query/sort behavior.

---

## 43. Pagination dan Multi-Tenant Index

Multi-tenant search punya beberapa model:

1. Index per tenant.
2. Shared index dengan `tenant_id` filter.
3. Hybrid: large tenant dedicated index, small tenants shared.
4. Alias per tenant.

Pagination implication:

- cursor harus encode tenant context,
- PIT dibuat pada index/alias yang benar,
- sorting tie-breaker unik dalam scope yang benar,
- total hits/facets tidak boleh bocor antar tenant,
- index alias changes bisa membuat cursor invalid.

Jika memakai alias:

```text
cases_tenant_a_current -> cases_tenant_a_v7
```

Cursor dengan PIT lebih aman selama PIT valid, tetapi setelah PIT expired user harus restart search.

---

## 44. Result Window Design by Use Case

### 44.1 Public Search Page

Requirement:

- fast first page,
- good relevance,
- no exact count required,
- load more optional.

Design:

```text
from/size for first few pages or search_after
max size 20-50
track_total_hits threshold
highlight limited
cursor optional
```

### 44.2 Internal Case Search

Requirement:

- filters,
- facets,
- permissions,
- sort by relevance/date/status,
- reliable navigation.

Design:

```text
cursor pagination with PIT for non-trivial result sets
stable sort
permission filter in query
page size 20-100
cursor signed
```

### 44.3 Review Queue

Requirement:

- deterministic work order,
- auditability,
- assignment,
- no duplicate work.

Design:

```text
Search can generate candidate set.
Official queue may need materialized worklist.
Do not rely only on volatile search pagination.
```

### 44.4 Export

Requirement:

- all matching results,
- reproducible,
- audited,
- async,
- large volume.

Design:

```text
separate export job
search_after + PIT or source-of-truth query
batching
checkpoint
object storage
audit
```

### 44.5 Reporting

Requirement:

- aggregates/counts,
- often exact,
- time windows,
- repeatable.

Design:

```text
Maybe Elasticsearch aggregation if search-oriented.
Maybe OLAP system if analytical.
Do not misuse search pagination as reporting engine.
```

---

## 45. Guardrails

Backend harus punya hard limits.

Contoh:

```yaml
search:
  maxPageSize: 100
  defaultPageSize: 20
  maxOffsetWindow: 1000
  cursorTtlSeconds: 300
  pitKeepAlive: 60s
  maxCursorTraversalPages: 500
  maxHighlightFields: 3
  maxSortFields: 5
  allowExactTotalHits: false
```

Request validation:

```java
public int normalizeSize(Integer requestedSize) {
    if (requestedSize == null) {
        return 20;
    }
    if (requestedSize < 1) {
        throw new BadRequestException("size must be positive");
    }
    if (requestedSize > 100) {
        throw new BadRequestException("size exceeds maximum allowed value");
    }
    return requestedSize;
}
```

Sort validation:

```java
private static final Set<String> ALLOWED_SORTS = Set.of(
    "relevance",
    "createdAt",
    "updatedAt",
    "dueAt",
    "priority"
);
```

Jangan izinkan user mengirim arbitrary sort field:

```json
{
  "sort": "_script"
}
```

Kecuali Anda memang membangun admin-only query console yang dibatasi.

---

## 46. Error Handling

### 46.1 Cursor Expired

```http
410 Gone
```

```json
{
  "code": "SEARCH_CURSOR_EXPIRED",
  "message": "The search cursor has expired. Please restart the search."
}
```

### 46.2 Cursor Query Mismatch

```http
400 Bad Request
```

```json
{
  "code": "SEARCH_CURSOR_QUERY_MISMATCH",
  "message": "The cursor cannot be used because the search query or filters changed."
}
```

### 46.3 Size Too Large

```http
400 Bad Request
```

```json
{
  "code": "SEARCH_PAGE_SIZE_TOO_LARGE",
  "message": "Maximum page size is 100."
}
```

### 46.4 Offset Too Deep

```http
400 Bad Request
```

```json
{
  "code": "SEARCH_OFFSET_TOO_DEEP",
  "message": "Deep pagination is not supported. Use cursor pagination or refine filters."
}
```

### 46.5 PIT Missing/Invalid

```http
410 Gone
```

```json
{
  "code": "SEARCH_CONTEXT_EXPIRED",
  "message": "The search context has expired. Please restart the search."
}
```

---

## 47. Observability

Pagination behavior harus diukur.

Metrics:

- search latency by page type,
- page size distribution,
- offset distribution,
- cursor vs offset usage,
- number of pages traversed per session,
- PIT open count,
- PIT errors/expired,
- search_after errors,
- deep pagination rejection count,
- exact total hits usage,
- sort field distribution,
- slow query by sort type,
- response payload size,
- highlight cost,
- user abandonment by page.

Logs structured:

```json
{
  "event": "case_search",
  "requestId": "REQ-123",
  "tenantId": "TENANT-1",
  "principalId": "USER-9",
  "queryHash": "abc",
  "sort": "createdAt_desc_caseId_asc",
  "paginationMode": "cursor",
  "pageSize": 50,
  "hasCursor": true,
  "pitUsed": true,
  "tookMs": 82,
  "hitsReturned": 50,
  "totalHitsRelation": "gte",
  "totalHitsValue": 10000
}
```

Untuk privacy/security, jangan log raw query jika query bisa mengandung personal/sensitive data tanpa policy.

---

## 48. Testing Strategy

### 48.1 Unit Test Cursor Codec

Test:

- encode/decode roundtrip,
- invalid signature rejected,
- expired cursor rejected,
- wrong query hash rejected,
- wrong principal hash rejected,
- version mismatch handled.

### 48.2 Integration Test Stable Pagination

Index data:

```text
100 docs with same created_at
```

Sort:

```text
created_at desc, case_id asc
```

Test:

- no duplicate across pages,
- no missing document,
- all expected documents returned,
- page boundary stable.

### 48.3 Mutation During Pagination

Scenario:

1. Open PIT.
2. Fetch page 1.
3. Index new document that would sort before page 1.
4. Fetch page 2.
5. Verify pagination with PIT remains consistent.

### 48.4 Without PIT Test

Demonstrate possible instability.

This test is valuable educationally, even if not deterministic in every run.

### 48.5 Permission Test

Scenario:

- User A and User B have different visible sets.
- Cursor from User A cannot be used by User B.
- Permission version change invalidates cursor.

### 48.6 Deep Offset Rejection

Ensure:

```http
?page=100000
```

fails fast at API layer before hitting Elasticsearch.

---

## 49. Common Anti-Patterns

### Anti-Pattern 1: Raising `max_result_window` Blindly

Symptom:

```text
User needs page 2000.
```

Bad fix:

```text
Set max_result_window = 1000000.
```

Better:

```text
Understand use case.
Use cursor/search_after/PIT/export job/filter refinement.
```

### Anti-Pattern 2: Sorting Only by Date

Bad:

```json
"sort": [
  { "created_at": "desc" }
]
```

Better:

```json
"sort": [
  { "created_at": "desc" },
  { "case_id": "asc" }
]
```

### Anti-Pattern 3: Exposing Raw Query DSL and Sort

Bad:

```json
{
  "query": { "script_score": { ... } },
  "sort": [{ "_script": { ... } }]
}
```

Better:

```json
{
  "query": "late filing",
  "sort": "NEWEST"
}
```

with server-side controlled translation.

### Anti-Pattern 4: UI Endpoint Used for Export

Bad:

```text
Loop page=1..N with from/size.
```

Better:

```text
Async export job with search_after/PIT/checkpoint.
```

### Anti-Pattern 5: App-Side Permission Filtering After Pagination

Bad:

```text
Fetch 20 from ES, remove unauthorized, return 7.
```

Better:

```text
Push permission filtering into ES query or design visibility fields.
```

### Anti-Pattern 6: Cursor Without Query Hash

Bad:

```text
Cursor only contains search_after.
```

Better:

```text
Cursor includes query hash, sort hash, principal hash, expiry.
```

### Anti-Pattern 7: Exact Total Hits Everywhere

Bad:

```json
"track_total_hits": true
```

on every query.

Better:

```text
Threshold count for UI, exact count only when necessary.
```

---

## 50. Regulatory Case Management Example

Misalkan Anda punya system untuk enforcement lifecycle.

User search:

```text
"late filing"
```

Filters:

```text
status = OPEN
jurisdiction = ID-JK
severity in HIGH, CRITICAL
visible to current unit
```

Sort:

```text
SLA due soon first, then severity, then case_id.
```

Backend request:

```json
POST /cases/search
{
  "query": "late filing",
  "filters": {
    "status": ["OPEN"],
    "jurisdiction": ["ID-JK"],
    "severity": ["HIGH", "CRITICAL"]
  },
  "sort": "SLA_PRIORITY",
  "size": 25
}
```

Elasticsearch DSL conceptual:

```json
GET /_search
{
  "size": 25,
  "pit": {
    "id": "PIT_ID",
    "keep_alive": "1m"
  },
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "late filing",
            "fields": [
              "title^3",
              "summary^2",
              "allegations.text",
              "parties.name"
            ]
          }
        }
      ],
      "filter": [
        { "term": { "tenant_id": "TENANT-1" } },
        { "terms": { "status": ["OPEN"] } },
        { "terms": { "jurisdiction": ["ID-JK"] } },
        { "terms": { "severity": ["HIGH", "CRITICAL"] } },
        { "terms": { "visible_to_units": ["ENFORCEMENT-JK", "SUPERVISOR-ID"] } }
      ]
    }
  },
  "sort": [
    { "sla_due_at": { "order": "asc", "missing": "_last" } },
    { "severity_rank": "desc" },
    { "case_id": "asc" }
  ],
  "_source": [
    "case_id",
    "title",
    "status",
    "severity",
    "sla_due_at",
    "jurisdiction",
    "assigned_unit",
    "summary"
  ],
  "track_total_hits": 10000
}
```

Response API:

```json
{
  "items": [
    {
      "caseId": "CASE-2026-000123",
      "title": "Late filing by regulated entity",
      "status": "OPEN",
      "severity": "CRITICAL",
      "slaDueAt": "2026-06-22T00:00:00Z",
      "jurisdiction": "ID-JK",
      "assignedUnit": "ENFORCEMENT-JK",
      "summary": "..."
    }
  ],
  "nextCursor": "eyJ2IjoxLCJwaXQiOiIuLi4ifQ",
  "total": {
    "value": 10000,
    "relation": "gte"
  }
}
```

Important design choices:

- Permission filter pushed into query.
- Sort is stable with `case_id`.
- Cursor hides PIT/search_after internals.
- Exact total not forced.
- `_source` limited.
- Sort reflects regulatory workflow.
- Cursor can include permission version.

---

## 51. Decision Matrix

| Use Case | Recommended Pagination | Count | Sort | Notes |
|---|---|---|---|---|
| Basic small admin table | `from + size` | optional exact | stable field sort | Limit max page |
| Public search page | shallow `from + size` or cursor | threshold | `_score` + tie-breaker | Optimize first page |
| Infinite scroll | `search_after` | often false/threshold | stable sort | Cursor required |
| Audit-sensitive search review | `search_after` + PIT | threshold/exact as needed | deterministic sort | Signed cursor |
| Export | async job + `search_after` + PIT or source DB | job metadata | stable ID sort | Checkpoint required |
| Work assignment queue | materialized queue or controlled search snapshot | exact within queue | priority order | Audit required |
| Reporting | aggregation/reporting pipeline | exact if required | not page-based | May belong in OLAP |

---

## 52. Checklist for Production Pagination

Before approving a search pagination design, ask:

1. Is this interactive search, infinite scroll, export, or queue?
2. What is max page size?
3. Is deep pagination allowed?
4. If allowed, why?
5. Are sort fields stable?
6. Is there a unique tie-breaker?
7. Is PIT needed?
8. Is cursor signed?
9. Does cursor include query/sort/principal hash?
10. What happens when cursor expires?
11. Are permission filters applied before pagination?
12. Are facet counts consistent with filters?
13. Is exact total hits really needed?
14. Are large fields excluded from `_source`?
15. Are highlights limited?
16. Is export separate from UI endpoint?
17. Are metrics available by pagination mode?
18. Are rejected deep pagination attempts logged?
19. Is there a load test for page traversal?
20. Is the behavior explainable to product/audit stakeholders?

---

## 53. Mental Model Summary

Pagination in Elasticsearch is not simply:

```text
page number + page size
```

It is a design decision involving:

```text
query semantics
+ sort stability
+ distributed execution
+ result window cost
+ index freshness
+ user intent
+ authorization
+ cursor lifecycle
+ operational guardrails
```

Use `from + size` for shallow pages.

Use `search_after` for cursor traversal.

Use PIT when page-to-page consistency matters.

Use export jobs for large downloads.

Use stable tie-breakers always.

Do not raise `max_result_window` as a substitute for design.

Search pagination should express the product reality:

```text
Search is about finding the best useful results,
not browsing an infinite database table.
```

---

## 54. What You Should Be Able to Do After This Part

After this part, you should be able to:

- Explain why deep pagination is expensive.
- Decide when `from + size` is acceptable.
- Design cursor pagination using `search_after`.
- Explain why stable sort and tie-breaker are required.
- Use PIT conceptually for consistent pagination.
- Design Java backend cursor contracts.
- Separate interactive search from export workloads.
- Prevent unsafe deep pagination at API layer.
- Identify pagination bugs caused by permission filtering.
- Build a production review checklist for search result navigation.

---

## 55. Preparation for Part 014

Part 014 moves from reading/searching to writing/indexing.

We will cover:

- single document indexing,
- bulk indexing,
- refresh semantics,
- idempotent writes,
- external versioning concepts,
- partial update vs full reindex,
- upsert,
- delete propagation,
- ingest pipeline,
- enrichment,
- backfill,
- reindex,
- zero-downtime ingestion strategy,
- designing indexing pipeline from Java services.

Pagination is about retrieving result windows safely.

Indexing is about making sure the right searchable state exists in the first place.

---

## References

- Elastic Documentation — Paginate search results: `https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results`
- Elastic Documentation — Point in time API and pagination behavior: `https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results`
- Elastic Documentation — Scroll API guidance and deep pagination notes: `https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results`
- Elastic Documentation — Search API and sort behavior: `https://www.elastic.co/docs/reference/elasticsearch/rest-apis/search`
- Elastic Documentation — `track_total_hits`: `https://www.elastic.co/docs/reference/elasticsearch/rest-apis/search`
- Elastic Documentation — Sort search results: `https://www.elastic.co/docs/reference/elasticsearch/rest-apis/sort-search-results`
- Elastic Documentation — Index sorting: `https://www.elastic.co/docs/reference/elasticsearch/index-settings/sorting`


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-012.md">⬅️ Part 012 — Filtering, Faceting, and Aggregations for Search UX</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-014.md">Learn Search Engine Database and Elasticsearch Mastery for Java Engineers ➡️</a>
</div>
