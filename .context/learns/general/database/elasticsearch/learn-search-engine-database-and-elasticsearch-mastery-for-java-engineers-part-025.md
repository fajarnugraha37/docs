# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-025.md

# Part 025 — Schema Evolution and Zero-Downtime Reindexing

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Part: `025`  
> Fokus: schema evolution, mapping change, versioned index, alias swap, reindexing, rollback, verification, dan migration governance  
> Target pembaca: Java software engineer yang ingin membangun search platform production-grade, evolvable, observable, dan aman untuk domain enterprise/regulatory.

---

## 0. Posisi Part Ini Dalam Seri

Sampai titik ini, kita sudah membangun fondasi:

- Part 000–002: mental model search dan information retrieval.
- Part 003: Lucene internals.
- Part 004: Elasticsearch architecture.
- Part 005–006: document modeling dan mapping.
- Part 007–013: analysis, query, relevance, faceting, pagination.
- Part 014–015: indexing pipeline, consistency, freshness, source-of-truth boundary.
- Part 016–017: Java integration dan API design.
- Part 018–019: autocomplete, suggestion, multilingual/domain search.
- Part 020: security dan permission-aware search.
- Part 021–024: performance, shard/capacity, lifecycle, data streams.

Part ini membahas masalah yang hampir pasti muncul setelah search system mulai dipakai di production:

> “Index sudah live, query sudah dipakai user, data sudah besar, tetapi mapping/document shape/analyzer/ranking field harus berubah. Bagaimana mengubahnya tanpa downtime, tanpa data loss, tanpa relevance regression, dan tanpa permission leak?”

Ini bukan sekadar topik administrasi Elasticsearch. Ini adalah topik **evolvability**.

Search platform yang buruk biasanya gagal bukan pada hari pertama, tetapi pada bulan ke-6 ketika field baru perlu ditambahkan, field lama perlu diganti tipe, analyzer ternyata salah, synonym berubah, ranking signal baru diperlukan, nested model tidak cukup, permission model berubah, index terlalu besar, relevance berubah setelah deployment, atau rollback tidak mungkin karena alias sudah dipindah tanpa verifikasi.

Part ini akan membangun mental model dan playbook untuk menghindari itu.

---

## 1. Core Thesis

Elasticsearch schema evolution harus diperlakukan seperti **database migration + search relevance migration + distributed data pipeline migration** sekaligus.

Pada relational database, migration sering dilihat sebagai perubahan table/column/index. Pada Elasticsearch, perubahan schema dapat memengaruhi:

1. Cara data disimpan.
2. Cara data dianalisis.
3. Cara token terbentuk.
4. Cara query matching.
5. Cara score dihitung.
6. Cara filter/facet/sort berjalan.
7. Cara permission diterapkan.
8. Cara highlight muncul.
9. Cara autocomplete bekerja.
10. Cara search API contract dipahami frontend.
11. Cara user mempercayai hasil search.

Karena itu, migration Elasticsearch tidak boleh dianggap sebagai:

```text
PUT mapping baru lalu selesai.
```

Yang benar:

```text
Design target index
→ create new versioned index
→ backfill
→ dual-write or catch-up
→ verify data
→ verify search behavior
→ verify security
→ cut over atomically
→ monitor
→ rollback if needed
→ decommission old index only after safety window
```

---

## 2. Mengapa Mapping Evolution Sulit di Elasticsearch?

Elasticsearch index bukan seperti table schema yang bebas diubah secara penuh.

Saat sebuah field sudah di-index dengan tipe tertentu, Elasticsearch sudah membangun struktur internal sesuai tipe tersebut:

- `text` field menghasilkan token melalui analyzer.
- `keyword` field disimpan untuk exact match/filter/sort/aggregation.
- numeric field punya encoding numeric.
- date field punya parsing dan representation khusus.
- nested field membuat hidden nested documents.
- doc values dibuat dengan layout tertentu.
- inverted index sudah berisi term/posting sesuai analyzer lama.

Karena itu, banyak perubahan tidak bisa dilakukan in-place.

Contoh perubahan bermasalah:

```text
status: text → keyword
createdAt: keyword → date
amount: text → long
name analyzer: standard → custom analyzer
address: object → nested
tags: keyword → text + keyword
caseParties: flattened → nested
```

Secara konseptual, ini bukan hanya “ubah metadata”. Ini berarti index internal harus dibangun ulang.

---

## 3. Perubahan Yang Biasanya Aman vs Butuh Reindex

### 3.1 Perubahan Yang Biasanya Aman

Beberapa perubahan mapping relatif aman:

- menambahkan field baru;
- menambahkan property baru dalam object;
- menambahkan multi-field pada field tertentu dalam batas yang didukung;
- menambahkan field alias untuk rename ringan;
- menambahkan index template untuk index baru;
- menambahkan runtime field untuk transitional query tertentu.

Namun aman secara mapping belum tentu aman secara behavior. Field baru tetap butuh data population, query update, API contract update, security review, test, dan observability.

### 3.2 Perubahan Yang Biasanya Butuh Reindex

Biasanya butuh index baru dan reindex jika:

- mengubah tipe field;
- mengubah analyzer field yang sudah ter-index;
- mengubah normalizer `keyword`;
- mengubah `object` menjadi `nested`;
- mengubah field cardinality/shape;
- mengganti document modeling;
- mengganti `_source` behavior;
- mengubah index sorting;
- mengubah shard count primary;
- memperbaiki mapping yang salah sejak dynamic mapping;
- mengubah search document projection secara besar.

Rule of thumb:

> Kalau perubahan memengaruhi bagaimana nilai field diubah menjadi struktur index internal, anggap butuh reindex.

---

## 4. Vocabulary Penting

### 4.1 Physical Index

Physical index adalah index konkret:

```text
cases-search-v1
cases-search-v2
cases-search-v3
```

Physical index punya mapping, settings, shard count, analyzer, document data, lifecycle, stats, segment, dan alias association. Physical index sebaiknya **tidak langsung dipakai oleh aplikasi**.

### 4.2 Read Alias

Read alias adalah nama stabil yang dipakai query/search:

```text
cases-search-read
```

Alias ini menunjuk ke index aktif:

```text
cases-search-read → cases-search-v1
```

Setelah migration:

```text
cases-search-read → cases-search-v2
```

Aplikasi tidak perlu tahu versi index.

### 4.3 Write Alias

Write alias adalah nama stabil yang dipakai indexing pipeline:

```text
cases-search-write
```

Untuk index biasa, write alias biasanya menunjuk ke satu write index.

```text
cases-search-write → cases-search-v1
```

Saat cutover:

```text
cases-search-write → cases-search-v2
```

Write alias membuat writer tidak perlu tahu physical index.

### 4.4 Versioned Index

Versioned index adalah index dengan versi eksplisit:

```text
cases-search-v001
cases-search-v002
cases-search-v003
```

Versi ini bukan version per document, tetapi version per schema/index generation.

Gunanya:

- migration aman;
- rollback mungkin;
- audit jelas;
- old/new index bisa dibandingkan;
- reindex bisa diulang;
- deployment bisa dipisahkan dari cutover.

### 4.5 Alias Swap

Alias swap adalah operasi memindahkan alias dari old index ke new index.

Contoh konseptual:

```json
POST /_aliases
{
  "actions": [
    { "remove": { "index": "cases-search-v001", "alias": "cases-search-read" }},
    { "add":    { "index": "cases-search-v002", "alias": "cases-search-read" }}
  ]
}
```

Tujuan utamanya adalah cutover cepat, aplikasi tetap memakai nama alias, rollback memungkinkan, dan deployment aplikasi tidak perlu hanya untuk mengganti nama index.

### 4.6 Backfill

Backfill adalah proses mengisi new index dari source-of-truth atau dari old index.

Ada dua pendekatan besar:

1. Reindex dari old Elasticsearch index.
2. Rebuild dari canonical source-of-truth.

Keduanya punya trade-off besar.

### 4.7 Catch-Up

Catch-up adalah proses menyamakan perubahan yang terjadi selama backfill.

Misalnya:

```text
T0 create v2
T1 start backfill from database snapshot
T2 users update cases while backfill running
T3 backfill done
T4 v2 masih tertinggal perubahan T2–T3
```

Catch-up memastikan v2 tidak stale saat cutover.

### 4.8 Dual-Write

Dual-write dalam konteks migration berarti indexing pipeline menulis ke old dan new index selama periode tertentu.

```text
case updated → index to v1 and v2
```

Dual-write bisa membantu cutover, tetapi juga menambah risiko partial failure, divergence, duplicate operational complexity, dan rollback ambiguity.

### 4.9 Dual-Read dan Shadow Query

Dual-read berarti backend membaca dari old dan new index untuk membandingkan hasil. Shadow query adalah query ke new index yang tidak memengaruhi response user.

```text
user search → response from v1
            → async compare v2 result
```

Tujuannya:

- mengukur divergence;
- mendeteksi error query;
- melihat latency new index;
- membandingkan top-K result;
- memvalidasi permission filter.

### 4.10 Relevance Regression

Relevance regression terjadi ketika hasil search menjadi lebih buruk setelah migration walaupun migration “secara data sukses”.

Contoh:

- exact case number turun ranking;
- closed case muncul di atas active case;
- synonym tidak bekerja;
- phrase match hilang;
- autocomplete menjadi noisy;
- typo tolerance terlalu agresif;
- facet count berubah tanpa alasan;
- permission filter membuat result hilang.

Dalam search platform, migration belum sukses sebelum relevance regression diuji.

---

## 5. Prinsip Utama Schema Evolution

### 5.1 Jangan Biarkan Aplikasi Mengakses Physical Index

Buruk:

```text
Search API queries cases-search-v001
Indexer writes cases-search-v001
```

Lebih baik:

```text
Search API queries cases-search-read
Indexer writes cases-search-write
```

Physical index adalah implementation detail. Jika aplikasi mengikat diri ke physical index, migration butuh deploy aplikasi, rollback butuh deploy aplikasi, debugging lebih sulit, dan banyak service bisa memakai versi index berbeda.

### 5.2 Treat Mapping As Code

Mapping harus versioned bersama kode.

```text
/search-indexes
  /cases
    v001
      settings.json
      mappings.json
      aliases.json
    v002
      settings.json
      mappings.json
      migration-notes.md
      relevance-tests.json
```

Yang penting:

- reviewable;
- diffable;
- testable;
- reproducible;
- auditable.

Jangan rely pada manual Kibana Console sebagai satu-satunya source.

### 5.3 Dynamic Mapping Boleh Untuk Eksplorasi, Bukan Governance

Dynamic mapping bisa membantu fase awal, tetapi berbahaya untuk sistem serius.

Risiko:

- field typo menjadi field permanen;
- tipe salah karena sample data pertama tidak representatif;
- mapping explosion;
- `text` dan `keyword` muncul tanpa desain;
- date detection salah;
- object shape liar;
- permission-sensitive field ikut ter-index;
- query team bergantung pada field accidental.

Untuk production search platform, gunakan explicit mapping dan strict governance.

### 5.4 Migration Harus Bisa Diulang

Migration yang baik adalah migration yang bisa diulang dari awal.

Artinya:

- create new index idempotent atau fail-fast;
- backfill resumable;
- document ID deterministik;
- transformation deterministic;
- bulk indexing idempotent;
- verification bisa diulang;
- alias swap scripted;
- rollback scripted.

Jika migration hanya bisa dilakukan sekali secara manual, risiko production terlalu besar.

### 5.5 Cutover Bukan Akhir Migration

Setelah alias swap, masih ada fase penting:

- monitor latency;
- monitor error rate;
- monitor zero-result rate;
- monitor top query regression;
- monitor indexing lag;
- compare document counts;
- compare permission filtering behavior;
- keep old index during safety window;
- prepare rollback.

Banyak incident terjadi karena tim menghapus old index terlalu cepat.

---

## 6. Tipe-Tipe Schema Evolution

### 6.1 Additive Field Evolution

Contoh:

```json
{
  "properties": {
    "casePriority": { "type": "keyword" }
  }
}
```

Karakteristik:

- field baru ditambahkan;
- field lama tetap ada;
- query lama tetap jalan;
- old document mungkin belum punya field.

Strategi:

1. Update mapping.
2. Update writer agar mengisi field baru.
3. Backfill field baru jika diperlukan.
4. Query baru bisa mulai memakai field setelah coverage cukup.
5. Monitor missing field ratio.

Risiko:

- query/filter pada field baru mengecualikan document lama;
- sort field baru menghasilkan ordering aneh untuk missing value;
- facet count misleading;
- ranking signal baru bias ke document baru.

### 6.2 Field Type Correction

Contoh:

```text
amount: text → double
createdAt: keyword → date
status: text → keyword
```

Karakteristik:

- field lama sudah salah tipe;
- tidak bisa diperbaiki penuh in-place;
- butuh new index.

Strategi:

1. Buat v2 dengan mapping benar.
2. Rebuild data.
3. Update query agar menggunakan tipe benar.
4. Validasi sort/filter/aggregation.
5. Alias swap.

### 6.3 Analyzer Evolution

Contoh:

```text
caseTitle analyzer: standard → custom_indonesian_legal
```

Karakteristik:

- token lama sudah terbentuk;
- query baru mungkin tidak match segment lama sesuai harapan;
- butuh reindex untuk konsistensi.

Strategi:

1. Desain analyzer baru.
2. Uji `_analyze` dengan corpus contoh.
3. Buat v2.
4. Reindex/rebuild.
5. Jalankan relevance regression.
6. Shadow query.
7. Alias swap.

Risiko:

- stemming terlalu agresif;
- synonym memperluas query terlalu jauh;
- stopword menghapus term penting;
- exact phrase match berubah;
- highlight berubah.

### 6.4 Document Shape Evolution

Contoh:

```text
case.parties: object[] → nested
case documents embedded → separate index
case + allegations flattened → denormalized summary projection
```

Karakteristik:

- memengaruhi retrieval unit;
- query DSL berubah;
- API response mungkin berubah;
- permission model bisa terdampak.

Strategi:

1. Desain document projection baru.
2. Buat transformation pipeline.
3. Build v2 dari canonical source.
4. Dual-read compare.
5. Update API mapper.
6. Cutover API + alias secara terkoordinasi.

### 6.5 Ranking Signal Evolution

Contoh:

```text
Tambah field:
- severityRank
- priorityScore
- lastActivityAt
- caseAuthorityScore
```

Karakteristik:

- mapping bisa additive;
- tetapi ranking behavior berubah;
- migration data mungkin sukses tapi quality turun.

Strategi:

1. Add field.
2. Populate field.
3. Backfill historical docs.
4. Run offline relevance evaluation.
5. Canary search users or shadow query.
6. Enable ranking weight gradually if possible.

### 6.6 Permission Model Evolution

Contoh:

```text
allowedUserIds → allowedPrincipals
departmentId → visibilityScopes
caseAccessLevel → securityLabels
```

Karakteristik:

- sangat berisiko;
- data leak lebih buruk daripada no result;
- facet/highlight/count juga harus aman.

Strategi:

1. Tambahkan field permission baru.
2. Populate dan verify.
3. Dual-filter compare old vs new.
4. Shadow query permission matrix.
5. Cutover only after zero leak confidence.
6. Keep old permission field during safety window.

---

## 7. Migration Strategy Matrix

| Change Type | In-place Possible? | Reindex Needed? | Main Risk | Recommended Strategy |
|---|---:|---:|---|---|
| Add new field | Usually yes | Sometimes for backfill | Missing coverage | Add + backfill + delayed query usage |
| Add multi-field | Sometimes | Existing docs may need reindex to populate | Incomplete subfield | Reindex if used for full corpus |
| Change field type | No for practical full change | Yes | Query/filter/sort wrong | New index + reindex |
| Change analyzer | No for existing tokens | Yes | Relevance regression | New index + relevance test |
| Object to nested | No | Yes | Semantic mismatch | New index + query rewrite |
| Add ranking signal | Mapping yes, behavior no | Usually backfill | Ranking bias | Add + backfill + staged ranking |
| Rename field | Field alias sometimes | Maybe | API/query drift | Compatibility layer + reindex later |
| Change shard count | Primary count not in-place | Yes/split/shrink depending case | Capacity/perf | New index or lifecycle action |
| Change index sorting | No for existing index | Yes | Sort/perf behavior | New index |
| Change permission field | Additive possible | Usually backfill | Data leak | Dual-filter verification |

---

## 8. Zero-Downtime Reindexing: Big Picture

Zero-downtime reindexing tidak berarti tidak ada risiko. Artinya:

- search API tetap tersedia;
- indexing tetap berjalan atau pause sangat singkat;
- cutover cepat;
- rollback tersedia;
- user tidak diarahkan ke empty/incomplete index;
- data consistency gap dikontrol.

Canonical flow:

```text
1. Current state:
   read alias  → cases-v001
   write alias → cases-v001

2. Create new index:
   cases-v002 with new mapping/settings

3. Backfill:
   source-of-truth or old index → cases-v002

4. Catch-up:
   changes after backfill start → cases-v002

5. Verify:
   counts, samples, checksums, search quality, security, latency

6. Cutover:
   read alias  → cases-v002
   write alias → cases-v002

7. Monitor:
   errors, latency, relevance, indexing lag

8. Rollback if needed:
   aliases → cases-v001

9. Decommission:
   delete v001 after safety window
```

---

## 9. Alias Topology

Untuk production, jangan hanya punya satu alias tanpa berpikir.

Minimal:

```text
cases-search-read
cases-search-write
```

Lebih advanced:

```text
cases-search-read
cases-search-write
cases-search-shadow
cases-search-admin
```

Atau per tenant/domain:

```text
tenant-a-cases-read
tenant-a-cases-write
tenant-b-cases-read
tenant-b-cases-write
```

Namun hati-hati: terlalu banyak alias juga bisa menambah governance complexity.

---

## 10. Initial Setup Example

Misalkan physical index pertama:

```text
cases-search-v001
```

Dengan alias:

```json
POST /_aliases
{
  "actions": [
    {
      "add": {
        "index": "cases-search-v001",
        "alias": "cases-search-read"
      }
    },
    {
      "add": {
        "index": "cases-search-v001",
        "alias": "cases-search-write",
        "is_write_index": true
      }
    }
  ]
}
```

Aplikasi Java:

```text
Search API → cases-search-read
Indexer    → cases-search-write
```

Jangan:

```text
Search API → cases-search-v001
Indexer    → cases-search-v001
```

Karena nanti migration menjadi deployment-coupled.

---

## 11. Membuat v002

Contoh perubahan:

- `status` yang semula `text` menjadi `keyword`.
- `title` memakai analyzer custom.
- tambah `lastActivityAt` untuk ranking freshness.
- tambah `visibilityScopes` untuk permission-aware search.

Create index:

```json
PUT /cases-search-v002
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "case_title_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": [
            "lowercase",
            "asciifolding"
          ]
        }
      }
    }
  },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "caseId": {
        "type": "keyword"
      },
      "caseNumber": {
        "type": "keyword"
      },
      "title": {
        "type": "text",
        "analyzer": "case_title_analyzer",
        "fields": {
          "keyword": {
            "type": "keyword",
            "ignore_above": 512
          }
        }
      },
      "status": {
        "type": "keyword"
      },
      "severity": {
        "type": "keyword"
      },
      "severityRank": {
        "type": "rank_feature"
      },
      "createdAt": {
        "type": "date"
      },
      "lastActivityAt": {
        "type": "date"
      },
      "visibilityScopes": {
        "type": "keyword"
      },
      "tenantId": {
        "type": "keyword"
      }
    }
  }
}
```

Catatan:

- `dynamic: strict` mencegah field liar.
- `caseId` dan `caseNumber` exact searchable.
- `title` full-text.
- `title.keyword` untuk exact/facet/sort jika benar-benar dibutuhkan.
- `visibilityScopes` untuk permission filter.
- `severityRank` untuk relevance signal.

---

## 12. Backfill Option A: Reindex Dari Old Elasticsearch Index

Reindex dari old index terlihat mudah:

```json
POST /_reindex
{
  "source": {
    "index": "cases-search-v001"
  },
  "dest": {
    "index": "cases-search-v002"
  }
}
```

Tetapi ada batasan besar:

1. Old `_source` harus cukup lengkap.
2. Data lama mungkin sudah projection, bukan canonical truth.
3. Field yang salah mungkin tidak bisa ditransform dengan aman.
4. Permission fields mungkin stale.
5. Business rules terbaru mungkin tidak ada.
6. Relevance fields baru mungkin butuh data dari DB lain.
7. `_source` mungkin disabled atau partial.
8. Transformasi kompleks lebih sulit.

### Cocok Untuk

- perubahan mapping kecil;
- data di old index sudah canonical enough;
- transformasi sederhana;
- migration cepat;
- tidak ada perubahan document model besar.

### Tidak Cocok Untuk

- rebuild projection besar;
- permission model baru;
- enrichment dari banyak sumber;
- data quality correction;
- regulatory/audit sensitive migration;
- semantic/vector embedding lifecycle.

---

## 13. Backfill Option B: Rebuild Dari Source-of-Truth

Flow:

```text
Canonical DB / event store / object store
→ projection builder
→ bulk index to cases-search-v002
```

Keunggulan:

- data paling benar;
- transformation logic sama dengan indexing pipeline;
- bisa memperbaiki data lama;
- bisa mengisi field baru dari domain model;
- bisa membangun permission field dengan benar;
- lebih defensible.

Kelemahan:

- lebih lambat;
- lebih mahal;
- perlu pipeline;
- perlu snapshot/cursor;
- perlu catch-up event;
- bisa membebani source DB.

Untuk sistem enterprise/regulatory, rebuild dari source-of-truth sering lebih aman walaupun lebih mahal.

---

## 14. Backfill Option C: Hybrid

Kadang strategi terbaik hybrid:

```text
Old index → base fields cepat
Source DB → enrich/repair sensitive fields
Event log → catch-up changes
```

Namun hybrid meningkatkan complexity. Gunakan hanya jika manfaatnya jelas.

---

## 15. Cutover Dengan Alias Swap

Setelah v002 diverifikasi:

```json
POST /_aliases
{
  "actions": [
    {
      "remove": {
        "index": "cases-search-v001",
        "alias": "cases-search-read"
      }
    },
    {
      "add": {
        "index": "cases-search-v002",
        "alias": "cases-search-read"
      }
    },
    {
      "remove": {
        "index": "cases-search-v001",
        "alias": "cases-search-write"
      }
    },
    {
      "add": {
        "index": "cases-search-v002",
        "alias": "cases-search-write",
        "is_write_index": true
      }
    }
  ]
}
```

Prinsip:

- read dan write alias sebaiknya dipindah secara terkoordinasi;
- jangan arahkan write ke v2 sementara read masih v1 kecuali memang desain dual-state;
- jangan arahkan read ke v2 sebelum catch-up selesai;
- jangan hapus v1 langsung.

---

## 16. Rollback Dengan Alias Swap Balik

Rollback harus sama mudahnya:

```json
POST /_aliases
{
  "actions": [
    {
      "remove": {
        "index": "cases-search-v002",
        "alias": "cases-search-read"
      }
    },
    {
      "add": {
        "index": "cases-search-v001",
        "alias": "cases-search-read"
      }
    },
    {
      "remove": {
        "index": "cases-search-v002",
        "alias": "cases-search-write"
      }
    },
    {
      "add": {
        "index": "cases-search-v001",
        "alias": "cases-search-write",
        "is_write_index": true
      }
    }
  ]
}
```

Tetapi rollback tidak selalu sesederhana alias swap balik.

Pertanyaan penting:

- Apakah v1 masih menerima writes selama migration?
- Apakah setelah cutover ada writes hanya ke v2?
- Jika rollback, apakah data yang sudah masuk v2 akan hilang dari v1?
- Apakah indexing pipeline dual-write selama safety window?
- Apakah source-of-truth bisa replay perubahan ke v1?
- Apakah API response schema backward-compatible?

Rollback strategy harus dirancang sebelum cutover.

---

## 17. Migration Pattern 1 — Pause Writes Briefly

Flow:

```text
1. Build v2.
2. Backfill v2.
3. Pause indexing writes.
4. Apply final catch-up.
5. Alias swap read/write.
6. Resume writes.
```

Kelebihan:

- simple;
- consistency lebih mudah;
- tidak perlu dual-write lama.

Kekurangan:

- tidak benar-benar no write downtime;
- perlu toleransi downtime singkat indexing;
- user mungkin masih bisa update source DB tetapi search lag.

Cocok jika write volume rendah, maintenance window bisa diterima, search freshness tidak harus realtime, dan domain memperbolehkan delay singkat.

---

## 18. Migration Pattern 2 — Dual-Write During Migration

Flow:

```text
1. Build v2.
2. Start dual-write old+new for new changes.
3. Backfill historical data to v2.
4. Verify.
5. Swap read alias.
6. Keep dual-write for safety window.
7. Swap write alias or simplify writer to v2 only.
```

Kelebihan:

- minimal lag;
- v2 tetap catch-up;
- rollback lebih mungkin jika v1 tetap di-update.

Kekurangan:

- dual-write failure handling sulit;
- write latency naik;
- data divergence bisa terjadi;
- retry semantics harus jelas.

Critical design:

```text
Write event must have deterministic document id and version.
```

Jika write ke v1 sukses tapi v2 gagal:

- apakah retry?
- apakah dead-letter?
- apakah block source transaction?
- apakah mark v2 inconsistent?
- apakah reconciliation job memperbaiki?

Jangan menambahkan dual-write tanpa observability.

---

## 19. Migration Pattern 3 — Event Replay / Outbox Catch-Up

Flow:

```text
1. Record high-watermark event offset at migration start.
2. Backfill snapshot data to v2.
3. Replay events from high-watermark to current.
4. Continue consuming live events.
5. Verify.
6. Alias swap.
```

Kelebihan:

- clean untuk event-driven architecture;
- idempotent jika event design bagus;
- no need pause writes lama;
- audit-friendly.

Kekurangan:

- butuh reliable event log;
- event ordering harus dipahami;
- replay bisa lama;
- event schema compatibility harus dijaga.

High-watermark concept:

```text
T0 event offset = 10,000
Backfill reads database snapshot around T0
Replay events offset > 10,000
```

Tantangan:

- snapshot DB dan event offset harus konsisten;
- out-of-order events;
- deleted entities;
- idempotency;
- compaction;
- old event schema.

---

## 20. Migration Pattern 4 — Blue/Green Search API

Kadang bukan hanya index yang berubah, tetapi query behavior/API mapper juga berubah.

Flow:

```text
Search API v1 → cases-search-v001
Search API v2 → cases-search-v002
Router/feature flag decides traffic
```

Kelebihan:

- bisa canary traffic;
- bisa compare API behavior;
- cocok untuk query DSL besar berubah;
- rollback lebih fleksibel.

Kekurangan:

- dua code path;
- lebih kompleks;
- perlu compatibility testing;
- metrics harus dipisah.

Cocok jika document shape berubah, query DSL berubah, response contract berubah, ranking model berubah signifikan, atau semantic/hybrid search mulai diperkenalkan.

---

## 21. Migration Pattern 5 — Compatibility Layer

Untuk rename field atau response evolution:

```text
v1 field: caseTitle
v2 field: title
API response tetap mengirim: caseTitle
```

Atau query layer:

```text
incoming filter "caseStatus" → v1.statusText or v2.status
```

Kelebihan:

- frontend tidak harus berubah bersamaan;
- rollout lebih aman;
- backward compatibility terjaga.

Kekurangan:

- technical debt;
- mapping layer makin kompleks;
- perlu deprecation policy.

Gunakan compatibility layer dengan batas waktu.

---

## 22. Verification: Jangan Cuma Bandingkan Document Count

Document count penting, tetapi tidak cukup.

Contoh:

```text
v1 count = 10,000,000
v2 count = 10,000,000
```

Itu belum membuktikan:

- document sama;
- field sama;
- permission sama;
- analyzer benar;
- ranking benar;
- facet benar;
- deleted docs benar;
- latest updates masuk;
- nested objects benar;
- highlight aman.

Verification harus multi-layer.

---

## 23. Verification Layer 1 — Index-Level Checks

Minimal:

```text
- v1 document count
- v2 document count
- deleted count
- store size
- primary shard count
- replica health
- refresh status
- indexing failure count
- segment count
```

Checklist:

```text
[ ] v2 cluster health green/yellow acceptable
[ ] all primary shards assigned
[ ] replica assigned or intentionally disabled during backfill
[ ] document count within expected tolerance
[ ] no bulk error above threshold
[ ] refresh completed
[ ] force merge decision reviewed, not blindly executed
```

---

## 24. Verification Layer 2 — Entity-Level Checks

Ambil sample deterministic:

```text
- first N by ID hash
- random sample
- recently updated
- recently deleted
- high-priority cases
- sensitive cases
- large cases
- cases with many parties
- cases with no parties
- cross-tenant cases
```

Bandingkan:

```text
caseId
caseNumber
status
title
createdAt
lastActivityAt
tenantId
visibilityScopes
party count
document count
allegation count
```

Untuk field yang berubah, definisikan expected transformation.

Contoh:

```text
v1.statusText = "Open"
v2.status = "OPEN"
```

Jangan bandingkan raw equality jika memang transformasi berubah.

---

## 25. Verification Layer 3 — Query-Level Checks

Jalankan golden query set.

Contoh:

```json
[
  {
    "name": "exact case number",
    "query": "CASE-2026-000123",
    "expectedTop1CaseId": "case-123"
  },
  {
    "name": "party name search",
    "query": "PT Contoh Abadi",
    "expectedContains": ["case-567", "case-891"]
  },
  {
    "name": "regulatory term synonym",
    "query": "market manipulation",
    "expectedContains": ["case-222"]
  }
]
```

Bandingkan:

- top-1;
- top-3;
- top-10;
- result count;
- facet count;
- latency;
- score distribution;
- highlight snippet;
- filtered result.

---

## 26. Verification Layer 4 — Permission Checks

Untuk regulatory/enterprise search, permission verification harus eksplisit.

Matrix:

```text
User A: investigator same department
User B: manager cross department
User C: external auditor
User D: tenant admin
User E: no access
User F: privileged legal role
```

Untuk setiap user:

```text
- search by exact case number
- search by party name
- search by sensitive keyword
- facet by status
- facet by department
- highlight body text
- export results
- autocomplete suggestions
```

Validasi:

```text
[ ] no inaccessible document in hits
[ ] no inaccessible data in highlights
[ ] no sensitive field in _source
[ ] no count leak through facets
[ ] no suggestion leak
[ ] no cache cross-contamination
```

Permission migration tanpa test matrix adalah gambling.

---

## 27. Verification Layer 5 — Relevance Regression

Search migration sering gagal di sini.

Bandingkan v1 vs v2:

```text
- overlap@10
- top1 changed?
- top3 changed?
- important result moved down?
- zero-result query changed?
- noisy result increased?
- exact match still dominates?
- phrase query still works?
- synonyms improved or worsened?
```

Tidak semua perubahan ranking buruk. Migration analyzer/ranking memang bisa membuat hasil berubah.

Yang penting:

- perubahan dipahami;
- perubahan sesuai tujuan;
- perubahan tidak merusak query penting;
- query sensitif diverifikasi manual.

---

## 28. Verification Layer 6 — Latency and Resource

Sebelum cutover, ukur:

```text
- p50/p95/p99 latency
- timeout rate
- slow query log
- CPU
- heap
- GC
- query cache hit ratio
- request cache behavior
- disk IO
- segment count
- aggregation cost
- sorting cost
```

v2 bisa benar secara hasil tetapi terlalu lambat.

Penyebab umum:

- field berubah dari `keyword` ke `text`;
- sort pada field yang tidak sesuai;
- high-cardinality aggregation;
- nested query lebih mahal;
- shard count berubah;
- analyzer menghasilkan terlalu banyak token;
- n-gram field membengkak;
- rank script mahal;
- permission filter menjadi huge terms query.

---

## 29. Designing a Migration Runbook

Runbook harus menjawab:

```text
1. Apa yang berubah?
2. Mengapa berubah?
3. Index lama apa?
4. Index baru apa?
5. Alias apa?
6. Bagaimana create v2?
7. Bagaimana backfill?
8. Bagaimana catch-up?
9. Bagaimana verify?
10. Siapa approve?
11. Bagaimana cutover?
12. Bagaimana monitor?
13. Apa rollback trigger?
14. Bagaimana rollback?
15. Kapan old index dihapus?
```

Contoh runbook skeleton:

```markdown
# Migration: cases-search-v001 → cases-search-v002

## Change Summary
- status: text → keyword
- title analyzer: standard → case_title_analyzer
- add visibilityScopes
- add severityRank

## Risk Level
High: permission and relevance impact.

## Precondition
- v002 index created
- backfill completed
- catch-up lag < 30s
- permission tests pass
- golden query pass rate >= 98%
- p95 latency <= v1 p95 * 1.2

## Cutover
1. Freeze deployment to search code.
2. Confirm backfill job stopped.
3. Confirm catch-up consumer current.
4. Run final verification.
5. Swap read/write aliases.
6. Smoke test.
7. Monitor 60 minutes.

## Rollback Trigger
- permission leak suspected
- p95 latency > 2x baseline for 10 minutes
- bulk failures > threshold
- top critical queries fail
- search API error > threshold

## Rollback
1. Swap aliases back to v001.
2. Keep dual-write enabled if applicable.
3. Replay missed events.
4. Investigate v002 offline.
```

---

## 30. Java Migration Orchestration

A Java backend team often needs to orchestrate migration safely.

Components:

```text
IndexDefinition
IndexProvisioner
BackfillJob
BulkIndexer
CatchUpConsumer
AliasManager
VerificationService
MigrationStateRepository
MigrationRunner
```

### 30.1 IndexDefinition

Represent mapping/settings as immutable versioned artifact.

```java
public record SearchIndexDefinition(
    String logicalName,
    String physicalIndex,
    String readAlias,
    String writeAlias,
    String settingsJson,
    String mappingsJson,
    int schemaVersion
) {}
```

Avoid building mapping by scattered string concatenation.

Better:

```text
/resources/elasticsearch/cases/v002/settings.json
/resources/elasticsearch/cases/v002/mappings.json
```

Load as resource, validate, apply.

### 30.2 Migration State Machine

Do not run migration as one giant script without state.

Example state machine:

```text
PLANNED
→ INDEX_CREATED
→ BACKFILL_RUNNING
→ BACKFILL_COMPLETED
→ CATCHUP_RUNNING
→ VERIFIED
→ CUTOVER_STARTED
→ CUTOVER_COMPLETED
→ MONITORING
→ COMPLETED
```

Failure states:

```text
FAILED_BACKFILL
FAILED_VERIFICATION
FAILED_CUTOVER
ROLLED_BACK
ABORTED
```

This matters because migration can run for hours/days. Processes crash. Operators restart jobs. You need resumability.

### 30.3 Backfill Job Design

A robust backfill job should support:

- cursor-based scanning from source DB;
- deterministic document ID;
- bulk indexing;
- retry with backoff;
- dead-letter queue;
- progress checkpoint;
- throughput control;
- cancellation;
- resumability;
- metrics;
- dry-run mode;
- validation mode.

Pseudo-code:

```java
while (true) {
    Page<CaseEntity> page = caseRepository.fetchAfterCursor(cursor, batchSize);

    if (page.isEmpty()) {
        break;
    }

    List<SearchDocument> docs = page.items().stream()
        .map(caseProjectionBuilder::toSearchDocument)
        .toList();

    BulkResult result = bulkIndexer.index("cases-search-v002", docs);

    if (result.hasFailures()) {
        failureHandler.handle(result.failures());
    }

    cursor = page.nextCursor();
    migrationState.saveCursor(cursor);
}
```

Important:

```text
Do not use offset pagination for huge backfill if source table is large.
```

Use stable cursor/keyset style where possible.

---

## 31. Deterministic Document ID

Bad:

```text
document id = random UUID generated during indexing
```

Good:

```text
document id = caseId
```

Why?

- idempotent reindex;
- update overwrites same doc;
- retry safe;
- duplicate prevention;
- delete propagation easier;
- verification easier.

For multiple projections:

```text
case document id       = case:{caseId}
case-party document id = case:{caseId}:party:{partyId}
case-note document id  = case:{caseId}:note:{noteId}
```

---

## 32. Bulk Error Classification

Bulk API can partially succeed. Treat each item.

| Failure | Retry? | Action |
|---|---:|---|
| 429 too many requests | Yes | backoff/throttle |
| timeout | Maybe | retry idempotently |
| mapper_parsing_exception | No until data fixed | DLQ |
| illegal_argument_exception | Usually no | inspect mapping/data |
| version_conflict_engine_exception | Depends | check versioning |
| security_exception | No | config/permission fix |
| cluster_block_exception | Maybe | ops intervention |

Never assume bulk request success means all documents succeeded.

---

## 33. Backfill Throttling

Backfill can harm production cluster.

Throttle based on:

```text
- bulk latency
- rejected executions
- indexing queue
- CPU
- heap
- disk IO
- merge pressure
- search latency
```

Simplified adaptive loop:

```java
if (bulkLatencyP95.toMillis() > 2000 || rejectedCount > 0) {
    batchSize = Math.max(minBatchSize, batchSize / 2);
    sleepMillis = Math.min(maxSleep, sleepMillis * 2);
} else {
    batchSize = Math.min(maxBatchSize, batchSize + step);
}
```

This is better than fixed aggressive bulk size.

---

## 34. Catch-Up Consumer

If event-driven:

```java
public void handle(CaseChangedEvent event) {
    SearchDocument doc = projectionBuilder.toSearchDocument(event.caseId());
    indexer.index("cases-search-v002", doc.id(), doc);
}
```

But for migration, event schema may not contain full data. Often better:

```text
event says caseId changed
→ fetch latest case from source-of-truth
→ build full search document
→ index full document
```

This avoids partial update drift.

---

## 35. Delete Handling During Migration

Deletes are frequently forgotten.

Cases:

```text
- hard delete from source
- soft delete
- archived
- hidden by permission
- tenant removed
```

Migration must propagate deletes.

If using event replay:

```text
CaseDeletedEvent → DELETE /cases-search-v002/_doc/{caseId}
```

If using soft delete:

```text
CaseStatusChanged → index doc with lifecycleStatus=DELETED
or remove from active search index
```

Define semantics explicitly.

---

## 36. Versioning and Out-of-Order Events

During backfill + live events, out-of-order update can corrupt v2.

Example:

```text
Event 101: status OPEN
Event 102: status CLOSED
Consumer processes 102 then 101
Final index incorrectly OPEN
```

Mitigation:

- external versioning;
- document `sourceVersion`;
- compare-and-set logic;
- fetch-latest projection instead of trusting event payload;
- idempotent rebuild per entity.

Simplest robust approach:

```text
On event, fetch latest entity state from source-of-truth and re-index full projection.
```

This converts event ordering issue into eventual convergence, assuming source read is correct.

---

## 37. Mapping Contract Tests

Mapping tests should fail CI when accidental changes occur.

Example test ideas:

```java
@Test
void statusMustBeKeyword() {
    Mapping mapping = loadMapping("cases/v002/mappings.json");
    assertThat(mapping.field("status").type()).isEqualTo("keyword");
}

@Test
void titleMustHaveKeywordSubfield() {
    Mapping mapping = loadMapping("cases/v002/mappings.json");
    assertThat(mapping.field("title").type()).isEqualTo("text");
    assertThat(mapping.field("title.keyword").type()).isEqualTo("keyword");
}

@Test
void dynamicMustBeStrict() {
    Mapping mapping = loadMapping("cases/v002/mappings.json");
    assertThat(mapping.dynamic()).isEqualTo("strict");
}
```

Test invariants, not formatting.

---

## 38. Analyzer Contract Tests

Analyzer changes are dangerous.

Test examples:

```text
Input: "Dugaan Manipulasi Pasar"
Expected tokens:
- dugaan
- manipulasi
- pasar
```

For identifiers:

```text
Input: "CASE-2026-000123"
Expected exact keyword remains "CASE-2026-000123"
```

For acronym:

```text
Input: "OJK"
Expected not lost by stopword/stemming
```

Analyzer tests should include:

- Indonesian terms;
- English terms;
- mixed language;
- legal/regulatory terms;
- organization names;
- person names;
- codes;
- punctuation;
- diacritics;
- typos;
- abbreviations.

---

## 39. Query Contract Tests

Query builder tests should verify generated DSL.

Example:

```java
@Test
void activeCaseSearchMustIncludeTenantAndPermissionFilter() {
    SearchRequest request = queryBuilder.build(
        new SearchCommand(
            "market manipulation",
            "tenant-a",
            Set.of("scope:investigator:123")
        )
    );

    String json = requestJson(request);

    assertThat(json).contains(""tenantId"");
    assertThat(json).contains(""visibilityScopes"");
    assertThat(json).contains(""filter"");
}
```

This is not enough for correctness, but catches dangerous omissions.

---

## 40. Relevance Test Harness

A simple relevance test dataset:

```json
{
  "queries": [
    {
      "query": "CASE-2026-000123",
      "expectedTop1": "case-123",
      "critical": true
    },
    {
      "query": "manipulasi pasar",
      "expectedTop10": ["case-200", "case-201"],
      "critical": true
    },
    {
      "query": "late filing",
      "expectedTop10": ["case-300"],
      "critical": false
    }
  ]
}
```

Metrics:

```text
top1 accuracy
top3 recall
top10 recall
nDCG@10
zero result count
critical query pass rate
```

Migration gate:

```text
critical query pass rate must be 100%
overall nDCG@10 must not drop > 3%
zero-result rate must not increase > threshold
```

Threshold depends on domain.

For regulatory search, exact identifiers and permission-sensitive queries should have near-zero tolerance.

---

## 41. Data Verification With Hashes

For deterministic fields, compute hash per document.

Example conceptual canonical string:

```text
caseId|caseNumber|status|tenantId|createdAt|lastActivityAt|visibilityScopesSorted
```

Hash:

```text
SHA-256(canonical string)
```

Store verification report:

```text
caseId, oldHash, newHash, status
```

Caveat:

- only compare fields expected to be equivalent;
- exclude fields intentionally changed;
- normalize arrays sorting;
- normalize date formats;
- normalize null vs missing semantics.

---

## 42. Data Quality Report Before Migration

Before changing mapping, measure source quality:

```text
- how many amount values are non-numeric?
- how many createdAt values cannot parse as date?
- how many status values outside enum?
- how many docs missing tenantId?
- how many docs missing visibilityScopes?
- how many title values empty?
- how many documents exceed expected size?
```

Migration often reveals hidden data quality problems.

Do not let backfill fail at 92% because invalid field appears late.

---

## 43. Handling Bad Data

Options:

1. Reject migration until source fixed.
2. Index document with field omitted.
3. Put invalid value into quarantine field.
4. Send to DLQ.
5. Use fallback default.
6. Skip document.
7. Stop migration.

For regulatory/case systems, skipping document can be unacceptable.

A safer pattern:

```text
Index minimally searchable safe projection
+ emit data quality issue
+ do not expose invalid field-based facet/filter until repaired
```

Example:

```json
{
  "caseId": "case-123",
  "caseNumber": "CASE-2026-000123",
  "status": "UNKNOWN",
  "dataQualityFlags": [
    "INVALID_STATUS_FROM_SOURCE"
  ]
}
```

But this must be product/domain-approved.

---

## 44. API Compatibility During Migration

Search API should not expose Elasticsearch internals.

Bad response:

```json
{
  "_index": "cases-search-v002",
  "_score": 17.23,
  "_source": {
    "visibilityScopes": ["scope:abc"]
  }
}
```

Better response:

```json
{
  "items": [
    {
      "caseId": "case-123",
      "caseNumber": "CASE-2026-000123",
      "title": "Suspected Market Manipulation",
      "status": "OPEN",
      "highlights": {
        "title": ["Suspected <em>Market Manipulation</em>"]
      }
    }
  ],
  "page": {
    "nextCursor": "..."
  },
  "facets": {
    "status": [
      { "value": "OPEN", "count": 10 }
    ]
  }
}
```

API contract should remain stable across index versions where possible.

---

## 45. Deprecating Fields

Do not delete fields abruptly.

Lifecycle:

```text
1. Add new field.
2. Populate both old and new.
3. Update query to use new field.
4. Update response to prefer new field.
5. Monitor old field usage.
6. Deprecate old field.
7. Remove old field in next major index version.
```

In code:

```java
@Deprecated
String oldStatusText;
String status;
```

In docs:

```text
oldStatusText deprecated since search schema v002, removal planned v004.
```

---

## 46. Field Alias Is Not A Magic Rename

Elasticsearch has field aliases, but they are not universal solution.

Field alias can help query old field name point to new field name in some scenarios.

But it does not solve:

- analyzer change;
- type change;
- source field rename;
- response compatibility;
- complex nested path change;
- application semantics;
- data backfill;
- relevance regression.

Use field alias as compatibility aid, not migration strategy replacement.

---

## 47. Runtime Fields During Migration

Runtime fields can help transitional use cases:

- derive field temporarily;
- test new computed field;
- avoid immediate reindex for small/low-volume query;
- bridge old/new schema.

But be careful:

- runtime fields can be slower;
- heavy use hurts query latency;
- not ideal for high-volume filter/sort/facet;
- not substitute for proper indexing when field is core search dimension.

Use runtime fields as bridge, not foundation.

---

## 48. Index Templates and Component Templates

For index families, use templates to avoid drift.

Example:

```text
component template:
- common analyzers
- common security fields
- common lifecycle fields

index template:
- cases-search-*
- mappings/settings
- aliases if appropriate
```

Benefits:

- consistency;
- less copy-paste;
- easier versioning;
- safer creation.

Risks:

- template changes only affect new indices, not old ones;
- hidden template side effect can surprise migration;
- multiple templates priority can confuse teams.

Rule:

```text
Every new physical index creation must record which template version was applied.
```

---

## 49. Data Streams and Schema Evolution

Data streams are common for append-only time-series data such as logs/events/metrics.

Schema evolution with data streams differs from normal entity search:

- backing indices roll over;
- new mappings affect future backing indices;
- existing backing indices retain old mapping;
- reindexing data stream history may require special care;
- data stream alias can help cutover between streams.

For entity search such as cases, plain index + aliases often provides clearer migration control.

For time-series/searchable event history, data streams may be better.

---

## 50. Reindex From Remote / Cluster Migration

Sometimes migration is not just schema, but cluster:

```text
old cluster → new cluster
```

Reasons:

- version upgrade;
- cloud migration;
- region migration;
- hardware change;
- security boundary change;
- architecture split.

Additional concerns:

- network throughput;
- auth/API compatibility;
- snapshot/restore option;
- remote reindex limitations;
- freeze write/cutover moment;
- DNS/client config;
- cross-cluster search transitional strategy.

This is bigger than local schema migration and needs separate DR-style runbook.

---

## 51. Search Migration and Feature Flags

Feature flags can decouple deployment from behavior.

Examples:

```text
search.index.read=v1/v2
search.query.rankingModel=v1/v2
search.query.useNewPermissionFilter=true/false
search.query.useHybridSearch=true/false
search.api.includeNewFacet=true/false
```

But avoid too many flags that create untestable combinations.

Good flags:

- isolate one risky behavior;
- have owner;
- have removal date;
- have metrics;
- default safe.

Bad flags:

- permanent;
- undocumented;
- interact with each other unpredictably;
- change security semantics casually.

---

## 52. Canary Strategy

Canary options:

1. Internal users only.
2. Specific tenant.
3. Specific query type.
4. Percentage traffic.
5. Read-only shadow comparison.
6. Admin endpoint only.
7. Non-critical search surface first.

For regulated systems, start with:

```text
shadow query → internal users → low-risk tenants → broader rollout
```

Do not canary permission changes with real users unless safety is proven.

---

## 53. Observability During Migration

Minimum metrics:

```text
migration.state
migration.backfill.processed
migration.backfill.failed
migration.backfill.rate
migration.backfill.lag
migration.catchup.lag
migration.bulk.success
migration.bulk.failure
migration.bulk.retry
migration.verification.mismatch
migration.permission.failure
migration.relevance.regression
```

Search metrics split by index version:

```text
search.v1.latency.p95
search.v2.latency.p95
search.v1.error_rate
search.v2.error_rate
search.v1.zero_result_rate
search.v2.zero_result_rate
```

If you cannot observe v2 separately, canary/shadow is weak.

---

## 54. Logging During Migration

Log structured events:

```json
{
  "event": "search_index_migration_alias_swap",
  "logicalIndex": "cases-search",
  "from": "cases-search-v001",
  "to": "cases-search-v002",
  "readAlias": "cases-search-read",
  "writeAlias": "cases-search-write",
  "operator": "migration-service",
  "timestamp": "2026-06-22T10:15:00Z"
}
```

For each bulk failure:

```json
{
  "event": "search_backfill_bulk_item_failed",
  "index": "cases-search-v002",
  "documentId": "case-123",
  "errorType": "mapper_parsing_exception",
  "field": "createdAt",
  "sourceCursor": "..."
}
```

Avoid logging sensitive `_source` fully.

---

## 55. Migration Approval Gates

A serious migration should have gates.

Example:

```text
Gate 1: Design reviewed
Gate 2: Mapping contract tests pass
Gate 3: Backfill dry run pass
Gate 4: Full backfill complete
Gate 5: Data verification pass
Gate 6: Permission verification pass
Gate 7: Relevance verification pass
Gate 8: Performance verification pass
Gate 9: Rollback tested
Gate 10: Cutover approved
```

For small systems this may feel heavy. For regulatory systems it is appropriate.

---

## 56. Common Anti-Patterns

### 56.1 Querying Physical Index

```text
GET cases-search-v001/_search
```

from production service.

Problem:

- migration requires code changes;
- rollback harder;
- inconsistent services.

Use alias.

### 56.2 Changing Mapping Manually in Production

Manual console changes cause drift.

Problem:

- no code review;
- no reproducibility;
- no audit;
- surprises future index versions.

Use mapping-as-code.

### 56.3 Reindex Without Understanding `_source`

If `_source` is incomplete or disabled, reindex from old index may fail or produce incomplete docs.

Always check source completeness.

### 56.4 Cutover Before Catch-Up

Backfill completed does not mean index current.

Need catch-up for changes during migration.

### 56.5 Only Testing Happy Queries

Migration must test exact identifiers, no-result queries, typo queries, permission denied queries, sensitive data queries, high-cardinality filters, aggregations, highlights, and autocomplete.

### 56.6 Deleting Old Index Too Early

Keep old index for safety window.

But define retention to avoid storage leak.

### 56.7 Ignoring Relevance

A migration that preserves document count but ruins ranking is failed.

### 56.8 Forgetting Facets

Facet count can leak permission or confuse users.

Migration verification must include aggregations.

### 56.9 Blind Dual-Write

Dual-write without failure handling creates divergence.

### 56.10 Runtime Fields As Permanent Fix

Runtime fields can become hidden performance debt.

---

## 57. Special Case: Regulatory Case Management Search

In regulatory/enforcement lifecycle systems, schema evolution has extra constraints.

Search documents may represent:

- case;
- party;
- allegation;
- evidence;
- decision;
- enforcement action;
- note;
- correspondence;
- audit record;
- escalation item.

Migration risks:

```text
- investigator cannot find active case
- unauthorized reviewer sees sensitive case
- closed case appears active
- legal-hold document hidden
- stale enforcement status
- appeal status not searchable
- SLA escalation ranking broken
- audit search incomplete
```

For this domain, migration must preserve:

1. **Visibility correctness** — no unauthorized exposure.
2. **Lifecycle correctness** — status and phase must be accurate.
3. **Temporal correctness** — current vs historical state must be clear.
4. **Identifier correctness** — case numbers, party IDs, document IDs exact search must work.
5. **Defensibility** — you should be able to explain why search result was visible and ranked.
6. **Auditability** — migration events should be recorded.

---

## 58. Regulatory Migration Example

Change:

```text
Old:
allowedDepartmentIds: keyword[]

New:
visibilityScopes: keyword[]
securityLabels: keyword[]
legalHold: boolean
```

Why:

- department-only access too coarse;
- cross-team investigations;
- legal hold requires special handling;
- external auditor access separate.

Migration plan:

```text
1. Add v2 mapping with new permission fields.
2. Build permission projection from authorization service.
3. Backfill v2 from source-of-truth.
4. For each case, compare old allowedDepartmentIds with new visibilityScopes expected expansion/restriction.
5. Run permission matrix.
6. Shadow queries for sensitive keywords.
7. Validate facets do not leak restricted departments.
8. Cutover only after security sign-off.
9. Keep v1 for rollback but restrict direct access.
```

Important: if new model is stricter, false negatives may occur. If looser, false positives may leak data. Treat false positives as critical.

---

## 59. Step-by-Step Practical Playbook

### Step 1 — Classify Change

Ask:

```text
Is it additive?
Does it change field type?
Does it change analyzer?
Does it change document shape?
Does it change permission?
Does it change ranking?
Does it change API response?
```

Output:

```text
Migration risk: low / medium / high / critical
Reindex required: yes/no
Security review: yes/no
Relevance review: yes/no
```

### Step 2 — Design Target Schema

Produce:

```text
settings.json
mappings.json
query changes
projection changes
API response impact
migration notes
```

Review:

- mapping correctness;
- analyzer correctness;
- shard/capacity;
- permission fields;
- doc values usage;
- sorting/facet fields;
- expected query patterns.

### Step 3 — Create vNext Index

```text
cases-search-v003
```

Do not attach read alias yet.

Optional temporary alias:

```text
cases-search-shadow → cases-search-v003
```

### Step 4 — Backfill

Choose strategy:

```text
old index reindex
source-of-truth rebuild
hybrid
```

Prefer source-of-truth for high-risk schema/domain changes.

### Step 5 — Catch-Up

Use:

```text
event replay
dual-write
pause writes + final sync
```

Document high-watermark.

### Step 6 — Verify Data

Run:

```text
count checks
sample checks
field checks
hash checks
data quality checks
```

### Step 7 — Verify Search Behavior

Run:

```text
golden queries
facet checks
highlight checks
pagination checks
sort checks
latency checks
```

### Step 8 — Verify Security

Run:

```text
permission matrix
tenant matrix
sensitive query matrix
facet leak checks
source filtering checks
```

### Step 9 — Cutover

Swap aliases.

Prefer scripted repeatable operation.

### Step 10 — Monitor and Rollback

Monitor:

```text
search errors
latency
zero-result rate
query distribution
bulk failures
security alerts
user reports
```

Rollback if needed.

### Step 11 — Decommission

After safety window:

```text
remove old alias references
snapshot old index if needed
delete old index
remove compatibility code
remove feature flags
update documentation
```

---

## 60. Example Migration Timeline

```text
Day 0:
- design v2 schema
- review mapping/query/permission changes

Day 1:
- create v2 in staging
- run mapping/analyzer/query tests

Day 2:
- run staging backfill
- verify relevance and permission

Day 3:
- create v2 in production
- start production backfill with throttling

Day 4:
- complete backfill
- start catch-up
- run verification

Day 5:
- shadow query production traffic
- compare v1/v2

Day 6:
- cutover during low traffic
- monitor
- keep dual-write or replay available

Day 7–14:
- safety window
- rollback available

Day 15:
- snapshot/delete v1
- remove compatibility flags
```

This is illustrative. Actual timeline depends on data volume, risk, and organization.

---

## 61. Checklist: Before Cutover

```text
[ ] vNext index exists with expected settings
[ ] vNext mapping matches reviewed artifact
[ ] dynamic mapping disabled/controlled
[ ] aliases currently point to expected old index
[ ] backfill completed
[ ] catch-up lag acceptable
[ ] delete events handled
[ ] bulk failures resolved or accepted
[ ] document count verified
[ ] sample documents verified
[ ] golden queries passed
[ ] permission matrix passed
[ ] facet counts verified
[ ] highlight verified
[ ] latency acceptable
[ ] rollback command prepared
[ ] old index retained
[ ] monitoring dashboard ready
[ ] on-call/owner assigned
[ ] cutover logged
```

---

## 62. Checklist: After Cutover

```text
[ ] read alias points to vNext
[ ] write alias points to vNext
[ ] smoke tests pass
[ ] indexing still works
[ ] search API latency acceptable
[ ] query error rate normal
[ ] zero-result rate normal
[ ] critical queries pass
[ ] permission checks pass
[ ] no unexpected bulk failures
[ ] old index still available for rollback
[ ] migration state marked CUTOVER_COMPLETED
[ ] stakeholders informed
```

---

## 63. Checklist: Before Deleting Old Index

```text
[ ] safety window elapsed
[ ] no rollback needed
[ ] no service queries old physical index
[ ] no dashboards depend on old index
[ ] no pending verification issue
[ ] snapshot taken if required
[ ] compliance retention reviewed
[ ] compatibility code removed or scheduled
[ ] documentation updated
```

---

## 64. Mental Model: Schema Version Is A Product Contract

Search schema is not internal-only if users depend on behavior.

A field change can alter:

- what users can find;
- what they cannot find;
- what appears first;
- what appears in facets;
- what they are allowed to see;
- what audit trail can explain.

Therefore:

```text
Search schema version = product behavior version + data projection version + relevance version + security filter version.
```

Treat it with the same seriousness as public API versioning.

---

## 65. Practical Design Heuristics

1. Use aliases from day one.
2. Never let services depend on physical index names.
3. Version physical indices.
4. Keep mapping/settings in code.
5. Prefer explicit mapping.
6. Rebuild from source-of-truth for high-risk changes.
7. Use deterministic document IDs.
8. Make backfill resumable.
9. Treat bulk as partial success.
10. Verify permission separately from data count.
11. Verify relevance separately from query correctness.
12. Keep old index during safety window.
13. Make rollback command ready before cutover.
14. Remove migration compatibility debt after completion.
15. Do not confuse “index green” with “migration successful”.

---

## 66. Mini Case Study: `status` Field Mistake

Problem:

```text
status mapped as text.
```

Symptoms:

- filter on status inconsistent;
- aggregation produces unexpected tokens;
- sort impossible or wrong;
- query `status:OPEN` behaves like full-text.

Bad fix:

```text
Try to change status mapping to keyword in-place.
```

Better fix:

```text
1. Create cases-search-v002 with status keyword.
2. Rebuild all case documents.
3. Update query builder to use term query on status.
4. Verify status facets.
5. Verify lifecycle filters.
6. Alias swap.
```

Key lesson:

> If a field is used for filter/facet/sort, it should usually be `keyword`, numeric, date, boolean, or another exact structured type, not free text.

---

## 67. Mini Case Study: Analyzer Change Breaks Exact Search

Problem:

A new analyzer improves natural language search but accidentally affects case number search.

User query:

```text
CASE-2026-000123
```

Expected:

```text
case-123 top result
```

After migration:

```text
Analyzer tokenizes into case, 2026, 000123.
Other documents with 2026 appear.
Exact case is no longer top.
```

Better design:

```text
caseNumber: keyword
title: text with analyzer
body: text with analyzer
```

Query strategy:

```text
if query looks like case number:
  exact term query on caseNumber with high boost
else:
  full-text query on title/body
```

Key lesson:

> Identifier search and natural language search are different search modes.

---

## 68. Mini Case Study: Permission Field Migration Leak

Old:

```text
departmentId: "enforcement"
```

New:

```text
visibilityScopes: ["department:enforcement", "role:senior-investigator"]
```

Bug:

```text
Query filter uses should instead of filter/must.
```

Result:

- documents are not strictly filtered;
- unauthorized users can see some results because permission clause contributes score instead of enforcing access.

Correct:

```json
{
  "bool": {
    "filter": [
      { "term": { "tenantId": "tenant-a" }},
      { "terms": { "visibilityScopes": ["department:enforcement"] }}
    ],
    "must": [
      { "match": { "title": "market manipulation" }}
    ]
  }
}
```

Key lesson:

> Authorization belongs in mandatory filter context, not relevance scoring context.

---

## 69. Exercises

### Exercise 1 — Classify Migration Risk

For each change, classify risk and strategy:

1. Add `lastActivityAt` date field.
2. Change `status` from text to keyword.
3. Change `parties` from object array to nested.
4. Add `visibilityScopes` permission field.
5. Change title analyzer to use synonyms.
6. Add `severityRank` ranking field.
7. Rename `caseTitle` to `title`.
8. Change primary shard count from 1 to 6.

Expected reasoning:

- Which require reindex?
- Which require relevance test?
- Which require permission test?
- Which can be additive?
- Which need API compatibility layer?

### Exercise 2 — Design Alias Plan

Given:

```text
Current index: enforcement-case-v7
New index: enforcement-case-v8
Read alias: enforcement-case-read
Write alias: enforcement-case-write
```

Write:

1. Initial alias state.
2. New index creation step.
3. Backfill step.
4. Alias swap command.
5. Rollback command.

### Exercise 3 — Build Verification Matrix

For a case search system, define verification queries for:

- exact case number;
- party name;
- allegation type;
- sensitive keyword;
- closed case;
- legal hold case;
- unauthorized user;
- cross-tenant user;
- autocomplete;
- facet count.

### Exercise 4 — Relevance Regression

Given top-5 results from v1 and v2:

```text
Query: "market manipulation"

v1:
1. case-100
2. case-200
3. case-300
4. case-400
5. case-500

v2:
1. case-900
2. case-100
3. case-200
4. case-300
5. case-700
```

Questions:

- Is this regression?
- What if case-900 is newer but less textually relevant?
- What if business wants active severe cases first?
- What metrics and human review are needed?

---

## 70. Summary

Schema evolution in Elasticsearch is difficult because index structure is not just metadata. Mapping, analyzer, document shape, ranking fields, and permission fields all affect how search behaves.

A production-grade approach uses:

- versioned physical indices;
- stable read/write aliases;
- mapping-as-code;
- explicit migration state machine;
- backfill and catch-up;
- deterministic document IDs;
- robust bulk error handling;
- data verification;
- relevance verification;
- permission verification;
- latency verification;
- rollback plan;
- safety window before decommission.

The deeper lesson:

> Elasticsearch migration is not complete when documents are copied. It is complete when the new index is current, correct, searchable, secure, relevant, observable, and rollback-safe.

---

## 71. What Comes Next

Part 026 will cover:

```text
Observability and Production Operations
```

Topics:

- cluster health;
- node stats;
- index stats;
- segment stats;
- thread pool stats;
- JVM metrics;
- GC behavior;
- slow logs;
- search latency dashboard;
- indexing latency dashboard;
- error-rate monitoring;
- queue monitoring;
- alerting strategy;
- runbook design;
- incident taxonomy.

---

## References

- Elastic Docs — Aliases: https://www.elastic.co/docs/manage-data/data-store/aliases
- Elastic Docs — Reindex API: https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-reindex
- Elastic Docs — Reindex indices examples: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reindex-indices
- Elastic Docs — Update field mappings: https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-put-mapping
- Elastic Docs — Update mapping API examples: https://www.elastic.co/docs/manage-data/data-store/mapping/update-mappings-examples
- Elastic Docs — Index templates: https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-put-index-template
- Elastic Docs — Index basics: https://www.elastic.co/docs/manage-data/data-store/index-basics
- Elastic Docs — Migrate data with minimal downtime: https://www.elastic.co/docs/manage-data/migrate/migrate-data-between-elasticsearch-clusters-with-minimal-downtime
- Elastic Docs — Modify a data stream: https://www.elastic.co/docs/manage-data/data-store/data-streams/modify-data-stream

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-024.md">⬅️ Part 024 — Lifecycle Management, Time-Based Indices, and Data Streams</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-026.md">Part 026 — Observability and Production Operations ➡️</a>
</div>
