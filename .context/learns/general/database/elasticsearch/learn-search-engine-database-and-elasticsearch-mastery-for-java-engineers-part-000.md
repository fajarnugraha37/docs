# Learn Search Engine Database and Elasticsearch Mastery for Java Engineers — Part 000

**Filename:** `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-000.md`  
**Part:** 000  
**Judul:** Orientation, Scope, and Mental Model  
**Audience:** Java Software Engineer / Tech Lead  
**Status Seri:** Belum selesai — ini adalah Part 000 dari rencana 35 part.

---

## 0. Ringkasan Eksekutif

Part ini adalah fondasi konseptual untuk seluruh seri **Search Engine Database and Elasticsearch**.

Tujuan utama bagian ini bukan membuat Anda langsung menulis query Elasticsearch, tetapi membentuk cara berpikir yang benar:

> Elasticsearch bukan sekadar database JSON yang bisa dicari. Elasticsearch adalah **distributed retrieval engine** yang mengubah data menjadi struktur pencarian, lalu mengembalikan kandidat dokumen berdasarkan kombinasi matching, scoring, filtering, ranking, dan operational constraints.

Kalau SQL database biasanya dimulai dari pertanyaan:

> “Bagaimana menyimpan state yang benar dan mengubahnya secara transaksional?”

Maka search engine database dimulai dari pertanyaan:

> “Bagaimana membuat informasi yang sudah ada dapat ditemukan, disaring, diurutkan, dipahami, dan dievaluasi sebagai hasil yang relevan?”

Perbedaan mental model ini sangat penting.

Banyak kegagalan Elasticsearch di production bukan karena engineer tidak tahu endpoint API-nya, tetapi karena salah memahami perannya:

- Elasticsearch dipakai sebagai source of truth utama.
- Index didesain seperti tabel OLTP.
- Query didesain seperti SQL `WHERE`.
- Mapping dibiarkan dynamic tanpa governance.
- Analyzer tidak dipahami.
- Scoring dianggap magic.
- Shard count dipilih tanpa workload model.
- Reindexing tidak dipikirkan sejak awal.
- Search quality tidak pernah diuji.
- Permission filtering dianggap detail backend biasa.
- Search freshness dijanjikan seperti transaksi synchronous.
- Facet count membocorkan informasi sensitif.
- Vector search ditambahkan tanpa evaluasi retrieval.

Part 000 ini akan membangun peta berpikir agar seluruh part berikutnya masuk ke kerangka yang benar.

---

## 1. Apa Yang Sedang Kita Pelajari?

Kita sedang mempelajari tiga lapisan yang saling berhubungan:

1. **Search Engine Database**
2. **Elasticsearch sebagai implementasi distributed search engine**
3. **Search platform engineering untuk Java backend systems**

Ketiganya tidak sama.

### 1.1 Search Engine Database

Search engine database adalah sistem yang dioptimalkan untuk:

- mencari dokumen berdasarkan kata, frasa, atribut, atau makna,
- melakukan ranking hasil,
- mendukung filter dan facet,
- menangani typo, synonym, stemming, autocomplete,
- mencari pada corpus besar,
- mengembalikan top-K result secara cepat,
- sering kali mendukung near-real-time indexing.

Search engine database bukan hanya penyimpanan data. Ia adalah mesin **retrieval**.

Dalam konteks retrieval, pertanyaan utamanya bukan hanya:

```text
Apakah data ini ada?
```

Tetapi:

```text
Dari jutaan dokumen, mana 10 dokumen paling relevan untuk intent user ini,
dengan filter, permission, freshness, dan ranking signal tertentu?
```

### 1.2 Elasticsearch

Elasticsearch adalah distributed search and analytics engine yang dibangun di atas Apache Lucene. Elastic mendeskripsikannya sebagai search and analytics engine, scalable data store, dan vector database untuk workload production-scale. Elasticsearch juga mendukung near-real-time search, vector search, dan integrasi generative AI/retrieval use case modern. [Source: Elastic GitHub repository](https://github.com/elastic/elasticsearch)

Elasticsearch memberikan layer distributed system di atas Lucene:

- cluster,
- node,
- index,
- shard,
- replica,
- routing,
- distributed query execution,
- cluster state,
- security,
- index lifecycle,
- snapshot/restore,
- Java client,
- ingest pipeline,
- vector/semantic search features.

Lucene adalah library pencarian lokal. Elasticsearch membuatnya menjadi cluster search engine.

### 1.3 Search Platform Engineering

Untuk Java software engineer, Elasticsearch jarang berdiri sendiri.

Biasanya ia adalah bagian dari platform:

```text
Source-of-truth database
        ↓
Domain event / outbox / CDC / indexing job
        ↓
Indexing pipeline
        ↓
Elasticsearch index
        ↓
Search API service
        ↓
Frontend / internal tool / case management UI / RAG pipeline
```

Maka skill yang dibutuhkan bukan cuma:

```text
Bisa bikin query match.
```

Tetapi:

```text
Bisa mendesain lifecycle data → index → query → ranking → observability → migration → failure recovery.
```

Itu target seri ini.

---

## 2. Elasticsearch Bukan Apa?

Sebelum belajar detail, kita harus menghapus beberapa asumsi yang sering merusak desain.

### 2.1 Elasticsearch Bukan Pengganti OLTP Database

Elasticsearch bisa menyimpan dokumen, tetapi tidak dirancang sebagai primary transactional database.

OLTP database seperti PostgreSQL/MySQL kuat untuk:

- transaksi,
- constraint,
- referential integrity,
- update state yang konsisten,
- locking/concurrency semantics,
- normalized relational model,
- canonical state,
- audit transaksi.

Elasticsearch kuat untuk:

- inverted index,
- full-text search,
- ranking,
- faceting,
- filtering,
- distributed retrieval,
- high-volume search,
- near-real-time indexing,
- vector/semantic retrieval,
- log/event search,
- denormalized document retrieval.

Jangan memindahkan tanggung jawab OLTP ke Elasticsearch hanya karena query search terasa mudah.

Rule praktis:

> Kalau data tersebut adalah kebenaran bisnis yang harus benar secara transaksional, simpan di OLTP/source-of-truth. Kalau data tersebut perlu ditemukan dengan cepat dan relevan, proyeksikan ke Elasticsearch.

### 2.2 Elasticsearch Bukan MongoDB Dengan Search Lebih Cepat

Karena dokumennya JSON-like, banyak engineer menyangka Elasticsearch mirip document database.

Ini berbahaya.

MongoDB/document database biasanya dipakai sebagai operational store dengan document-oriented persistence. Elasticsearch adalah index/retrieval engine.

Di Elasticsearch, bentuk dokumen harus dirancang dari:

- query behavior,
- ranking behavior,
- filter behavior,
- aggregation/facet behavior,
- update frequency,
- permission model,
- reindex strategy.

Bukan sekadar dari domain entity.

Contoh salah:

```json
{
  "case": {
    "id": "C-123",
    "parties": [...],
    "documents": [...],
    "events": [...],
    "tasks": [...],
    "decisions": [...]
  }
}
```

Lalu berharap semua jenis search bekerja bagus.

Contoh yang lebih benar bergantung use case:

- index `cases` untuk case-level search,
- index `case_documents` untuk evidence/document search,
- index `parties` untuk party search,
- index `case_events` untuk timeline search,
- index `case_tasks` untuk operational queue search,
- semua punya projection field yang cukup untuk result rendering dan authorization filtering.

Search document bukan domain aggregate. Search document adalah **retrieval projection**.

### 2.3 Elasticsearch Bukan Cache

Redis/cache menjawab:

```text
Saya sudah tahu key-nya, ambil value-nya cepat.
```

Search engine menjawab:

```text
Saya belum tahu dokumen mana yang cocok, carikan kandidat terbaik.
```

Cache biasanya key-value exact lookup.

Search engine biasanya:

- token lookup,
- posting list traversal,
- scoring,
- filter intersection,
- top-K selection,
- facet aggregation.

Menggunakan Elasticsearch sebagai cache biasanya menghasilkan sistem mahal, lambat, dan sulit dioperasikan.

### 2.4 Elasticsearch Bukan Message Broker

Kafka/RabbitMQ mengatur movement event/message. Elasticsearch mengindeks state/projection agar bisa dicari.

Elasticsearch tidak menggantikan:

- durable event log,
- consumer group,
- message acknowledgement,
- replay semantics,
- stream processing topology.

Namun Elasticsearch sering menjadi **sink** dari event-driven indexing pipeline.

### 2.5 Elasticsearch Bukan OLAP Engine Murni

Elasticsearch punya aggregations dan sering dipakai untuk analytics ringan/interaktif. Tetapi untuk workload OLAP columnar berat, sistem seperti ClickHouse biasanya lebih tepat.

Elasticsearch unggul saat analytics melekat pada search/filter result:

```text
Cari enforcement cases terkait "market manipulation",
filter by jurisdiction,
tampilkan top cases,
dan hitung facet status/severity/year.
```

ClickHouse lebih unggul untuk large-scale analytical scans:

```text
Hitung 3 tahun trend metric granular lintas miliaran event,
group by banyak dimensi,
dengan compression dan columnar execution optimal.
```

Jadi, Elasticsearch boleh mengerjakan search-driven aggregation, tetapi jangan otomatis menjadikannya data warehouse.

---

## 3. Definisi Praktis: Search Engine Database

Search engine database adalah database yang mengindeks data agar dapat dicari berdasarkan struktur retrieval, bukan hanya struktur storage.

Perbedaan storage dan retrieval:

| Perspektif | Storage Database | Search Engine Database |
|---|---|---|
| Fokus | Menyimpan dan mengubah state | Menemukan informasi relevan |
| Unit utama | Row/document/entity | Search document |
| Query utama | Exact predicate, join, transaction | Match, filter, score, rank |
| Struktur utama | B-tree/LSM/heap/table | Inverted index, columnar doc values, vectors |
| Hasil | Set data yang memenuhi kondisi | Ranked top-K result |
| Kebenaran | Transactional correctness | Retrieval quality + consistency contract |
| Model data | Canonical model | Denormalized retrieval projection |
| Failure utama | Lost update, constraint violation | Wrong ranking, missing result, stale result, leakage |
| Evaluasi | Correct/incorrect | Precision, recall, nDCG, latency, freshness |

Search engine database harus dinilai dengan kriteria berbeda dari OLTP.

SQL query:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN'
  AND jurisdiction = 'ID'
ORDER BY created_at DESC
LIMIT 20;
```

Search query conceptually:

```text
User mencari "insider trading broker failure"

Sistem harus:
- memahami terms user,
- mencari field yang relevan,
- mempertimbangkan synonym/domain vocabulary,
- filter permission,
- filter status/jurisdiction,
- rank berdasarkan lexical relevance,
- boost severity/freshness/authority,
- highlight bagian yang cocok,
- menyediakan facet,
- menjaga latency,
- tidak membocorkan forbidden counts.
```

Keduanya bisa terlihat seperti “query”, tetapi problem-nya sangat berbeda.

---

## 4. Mental Model Besar: Dari Data Menjadi Search Result

Search engine pipeline dapat dipahami sebagai delapan tahap:

```text
1. Source data
2. Retrieval document design
3. Analysis and normalization
4. Indexing
5. Refresh / visibility
6. Query interpretation
7. Matching + scoring + ranking
8. Result rendering + feedback
```

Mari bahas satu per satu.

---

### 4.1 Source Data

Source data adalah data canonical yang berasal dari:

- relational database,
- document database,
- event stream,
- object storage,
- file extraction pipeline,
- external API,
- logs,
- regulatory case system,
- knowledge base.

Source data belum tentu cocok untuk search.

Contoh canonical relational model:

```text
cases
case_parties
case_events
case_documents
case_assignments
case_status_history
case_permissions
```

User search tidak peduli tabel mana yang menyimpan data. User ingin menemukan:

```text
Kasus enforcement yang terkait entitas X, isu Y, periode Z,
yang boleh saya lihat,
dan paling relevan dengan intent saya.
```

Maka source data perlu diubah menjadi search projection.

---

### 4.2 Retrieval Document Design

Search document adalah bentuk data yang sengaja dirancang agar query efektif.

Contoh `case_search_document`:

```json
{
  "case_id": "CASE-2026-00123",
  "title": "Investigation into suspicious market manipulation pattern",
  "summary": "Case involving coordinated trading activity...",
  "status": "UNDER_INVESTIGATION",
  "severity": "HIGH",
  "jurisdiction": "ID",
  "opened_at": "2026-02-10T09:15:00Z",
  "updated_at": "2026-06-20T13:21:00Z",
  "parties": [
    {
      "party_id": "P-001",
      "name": "Example Securities Ltd",
      "role": "BROKER"
    }
  ],
  "topics": ["market manipulation", "coordinated trading", "broker supervision"],
  "permission_groups": ["ENFORCEMENT_INVESTIGATOR", "MARKET_ABUSE_TEAM"],
  "search_text": "Investigation suspicious market manipulation coordinated trading broker supervision..."
}
```

Field ini tidak harus sama dengan domain entity.

Field yang penting untuk search:

- field untuk full-text match,
- field untuk exact filter,
- field untuk sorting,
- field untuk facet,
- field untuk authorization,
- field untuk ranking signal,
- field untuk highlighting,
- field untuk result display,
- field untuk versioning/debugging.

Search document harus menjawab:

```text
Query apa yang perlu cepat?
Ranking apa yang perlu masuk akal?
Filter apa yang wajib?
Result card butuh data apa?
Apa yang tidak boleh bocor?
Data mana yang berubah sering?
Bagaimana reindex nanti?
```

---

### 4.3 Analysis and Normalization

Sebelum text masuk inverted index, text dianalisis.

Misal:

```text
"Market Manipulation Cases"
```

Bisa menjadi token:

```text
market
manipulation
cases
```

Dengan lowercase:

```text
market
manipulation
cases
```

Dengan stemming:

```text
market
manipul
case
```

Dengan synonym:

```text
market manipulation
market abuse
price manipulation
```

Dengan domain normalization:

```text
case_no: "CASE-2026-00123"
normalized_case_no: "case202600123"
```

Analyzer menentukan cara text dipotong, dinormalisasi, dan dicari.

Kesalahan analyzer dapat menyebabkan:

- dokumen tidak ditemukan,
- terlalu banyak dokumen ditemukan,
- ranking kacau,
- autocomplete berat,
- identifier search rusak,
- synonym melebar tak terkendali.

Analyzer adalah salah satu bagian paling penting di Elasticsearch.

---

### 4.4 Indexing

Indexing adalah proses memasukkan dokumen ke Elasticsearch agar dapat dicari.

Tetapi “masuk ke Elasticsearch” tidak sama dengan “langsung searchable”.

Elastic mendokumentasikan Elasticsearch sebagai near-real-time search: dokumen yang disimpan biasanya menjadi searchable dalam sekitar satu detik; ini terkait cara Lucene membuat segment baru yang bisa dicari setelah refresh. [Source: Elastic Docs — Near real-time search](https://www.elastic.co/docs/manage-data/data-store/near-real-time-search)

Mental model sederhana:

```text
Document masuk
  ↓
Dianalisis
  ↓
Masuk buffer/indexing structures
  ↓
Refresh membuat segment baru terlihat untuk search
  ↓
Search request dapat menemukan document
```

Ini berbeda dari OLTP read-after-write expectation.

Kalau UI menjanjikan:

```text
Setelah user klik save, hasil search langsung harus muncul.
```

Maka engineering-nya harus jelas:

- pakai refresh manual?
- tunggu refresh?
- baca dari source-of-truth untuk immediate confirmation?
- tampilkan optimistic UI?
- dokumentasikan eventual search visibility?
- bedakan detail page lookup vs search listing?

---

### 4.5 Refresh / Visibility

Refresh membuat perubahan index terlihat untuk search.

Poin penting:

- refresh terlalu sering meningkatkan search freshness tetapi bisa menambah overhead,
- refresh terlalu jarang meningkatkan indexing throughput tetapi membuat search stale lebih lama,
- default near-real-time tidak sama dengan immediate consistency,
- test integration sering gagal karena dokumen belum searchable saat query langsung dijalankan.

Untuk engineer Java, ini berarti test dan API contract harus sadar refresh.

Contoh buruk:

```java
indexCase(caseDoc);
SearchResponse response = search("market manipulation");
assertThat(response.hits()).contains(caseDoc);
```

Test ini bisa flaky jika tidak mengontrol refresh.

Contoh lebih sadar:

```java
indexCase(caseDoc, RefreshPolicy.WAIT_UNTIL);
SearchResponse response = search("market manipulation");
assertThat(response.hits()).contains(caseDoc);
```

Tentu dalam production, refresh policy harus dipakai hati-hati karena berdampak ke throughput.

---

### 4.6 Query Interpretation

User query:

```text
broker manipulation late report
```

Bukan sekadar string.

Sistem perlu menentukan:

- apakah ini keyword search?
- apakah ada phrase?
- apakah ada identifier?
- apakah ada typo?
- apakah perlu synonym?
- field mana yang harus dicari?
- apakah user mencari case, party, document, atau all?
- filter apa yang tersirat?
- permission user apa?
- apakah query kosong berarti browse/filter mode?

Query interpretation sering terjadi di application layer sebelum query DSL dikirim ke Elasticsearch.

Search API yang matang biasanya punya lapisan:

```text
Raw user input
  ↓
Search request DTO
  ↓
Validated search command
  ↓
Domain-aware query plan
  ↓
Elasticsearch Query DSL
```

Jangan biarkan frontend langsung mengirim Query DSL mentah kecuali untuk internal/admin/debug tooling yang sangat dikontrol.

---

### 4.7 Matching + Scoring + Ranking

Search result tidak hanya matching. Ia juga ranking.

Dokumen A dan B sama-sama mengandung kata `market manipulation`, tetapi mana yang lebih relevan?

Faktor yang mungkin:

- term muncul di title atau body?
- exact phrase atau hanya scattered terms?
- term langka atau umum?
- field title lebih penting daripada summary?
- case masih aktif?
- severity high?
- document terbaru?
- entity authoritative?
- user team terkait?
- ada boosting domain?
- ada semantic similarity?

Lucene/Elasticsearch menggunakan scoring seperti BM25 untuk full-text relevance. Lucene memiliki `BM25Similarity` sebagai model scoring BM25 di API similarity-nya. [Source: Lucene BM25Similarity API](https://lucene.apache.org/core/9_12_0/core/org/apache/lucene/search/similarities/BM25Similarity.html)

Tetapi BM25 bukan akhir dari relevance. Dalam sistem nyata, relevance sering gabungan:

```text
lexical relevance
+ domain signal
+ recency
+ authority
+ personalization/role context
+ permission
+ business priority
+ semantic similarity
```

Top-tier engineer tidak berhenti di “query-nya jalan”. Ia bertanya:

```text
Apakah ranking-nya benar untuk tugas user?
Bagaimana kita tahu?
Bagaimana regression-nya diuji?
```

---

### 4.8 Result Rendering + Feedback

Search backend tidak selesai saat mengembalikan JSON hits.

Search result perlu dapat dipahami:

- title,
- summary/snippet,
- highlight,
- metadata,
- status,
- severity,
- owner,
- last updated,
- why matched,
- actions,
- facet counts,
- pagination,
- sort,
- empty state,
- spelling suggestion.

Search platform juga butuh feedback loop:

- query apa yang sering zero-result?
- query apa yang sering diklik?
- query apa yang lambat?
- filter apa yang sering dipakai?
- ranking deployment mana yang memperburuk conversion/task completion?
- apakah ada query yang membocorkan forbidden counts?
- apakah semantic search mengembalikan dokumen yang terdengar mirip tapi salah konteks?

Search adalah sistem yang harus terus dievaluasi.

---

## 5. Elasticsearch Dalam Arsitektur Java Backend

Untuk Java engineer, Elasticsearch paling sering hadir sebagai komponen sekunder.

Arsitektur umum:

```text
[Java Command Service]
        |
        | writes canonical state
        v
[PostgreSQL / MySQL / Domain DB]
        |
        | outbox event / CDC / domain event
        v
[Indexing Worker]
        |
        | transforms canonical model into search document
        v
[Elasticsearch]
        |
        | query via Search API
        v
[Java Search Service]
        |
        v
[Frontend / Internal Tool / API Consumer]
```

### 5.1 Mengapa Tidak Dual Write Langsung?

Contoh dual write buruk:

```java
caseRepository.save(caseEntity);
elasticsearchClient.index(caseDocument);
```

Masalah:

- database write berhasil, Elasticsearch gagal,
- Elasticsearch berhasil, database rollback,
- retry membuat duplicate/out-of-order update,
- partial update tidak sinkron,
- tidak ada replay,
- sulit audit,
- sulit recovery.

Lebih aman:

```text
DB transaction:
  - update canonical data
  - insert outbox event

Async:
  - outbox publisher/indexer membaca event
  - transform
  - index idempotently
  - retry on failure
  - monitor lag
  - reconcile periodically
```

Karena Anda sudah punya seri Kafka/RabbitMQ, part ini tidak akan mengulang detail messaging. Dalam seri Elasticsearch, yang penting adalah boundary-nya:

> Indexing pipeline harus idempotent, replayable, observable, dan tidak mengubah source-of-truth semantics.

### 5.2 Search Service Tidak Sama Dengan Repository

Repository biasanya:

```text
getById
save
delete
findByStatus
```

Search service biasanya:

```text
searchCases(query, filters, sort, page, userContext)
suggestCases(prefix, userContext)
facetCases(query, filters, userContext)
explainCaseSearch(query, caseId, userContext)
reindexCase(caseId)
```

Search service harus memahami:

- user intent,
- query DSL generation,
- permission filtering,
- mapping assumptions,
- search quality,
- pagination,
- highlighting,
- sort,
- fallback behavior,
- observability.

Jangan desain Elasticsearch integration sebagai repository CRUD biasa.

---

## 6. Core Vocabulary

Bagian ini memberi glosarium awal. Detailnya akan dibahas di part berikutnya.

### 6.1 Document

Unit data yang diindeks dan dikembalikan oleh Elasticsearch.

Contoh:

```json
{
  "case_id": "CASE-001",
  "title": "Broker supervision failure",
  "status": "OPEN"
}
```

Document bukan selalu domain entity. Ia adalah retrieval unit.

### 6.2 Field

Properti dalam document.

Contoh:

```text
title
status
opened_at
party_names
permission_groups
```

Field punya tipe dan mapping.

### 6.3 Index

Logical collection of documents dengan mapping/settings tertentu.

Contoh:

```text
cases-v3
case-documents-v5
parties-v2
```

Elastic menjelaskan index memiliki documents, mappings, settings, dan secara fisik disimpan menggunakan shards. [Source: Elastic Docs — Index basics](https://www.elastic.co/docs/manage-data/data-store/index-basics)

### 6.4 Mapping

Schema untuk field dalam index:

```json
{
  "properties": {
    "title": { "type": "text" },
    "status": { "type": "keyword" },
    "opened_at": { "type": "date" }
  }
}
```

Mapping menentukan bagaimana field diindeks dan dicari.

### 6.5 Analyzer

Pipeline untuk memproses text menjadi token.

Contoh:

```text
"Market Manipulation" → ["market", "manipulation"]
```

Analyzer sangat menentukan search behavior.

### 6.6 Inverted Index

Struktur yang memetakan term ke dokumen yang mengandung term tersebut.

Contoh sederhana:

```text
market       → doc1, doc5, doc9
manipulation → doc1, doc9
broker       → doc2, doc9
```

Ini alasan search engine bisa cepat mencari text.

### 6.7 Shard

Partisi fisik/logical dari index. Setiap shard adalah Lucene index.

Kalau index punya 3 primary shards, dokumen tersebar ke 3 Lucene index berbeda.

### 6.8 Replica

Salinan shard untuk availability dan read scaling.

### 6.9 Segment

Lucene menyimpan index dalam segment. Elastic menjelaskan bahwa Lucene index adalah collection of segments plus commit point, dan segment berperan penting dalam near-real-time search. [Source: Elastic Docs — Near real-time search](https://www.elastic.co/docs/manage-data/data-store/near-real-time-search)

Segment immutable; update document biasanya direpresentasikan sebagai delete old + add new.

### 6.10 Refresh

Operasi yang membuat perubahan index terlihat oleh search.

### 6.11 Flush

Operasi durability lebih berat yang terkait translog dan commit. Jangan samakan refresh dan flush.

### 6.12 Query Context

Bagian query yang memengaruhi score.

Contoh:

```json
{
  "match": {
    "title": "market manipulation"
  }
}
```

### 6.13 Filter Context

Bagian query yang hanya include/exclude, tidak menghitung score.

Contoh:

```json
{
  "term": {
    "status": "OPEN"
  }
}
```

### 6.14 Score

Nilai relevance yang diberikan kepada document untuk query tertentu.

### 6.15 Facet / Aggregation

Ringkasan hasil berdasarkan field.

Contoh:

```text
Status:
- Open: 120
- Closed: 80
- Under Review: 45
```

### 6.16 Alias

Nama logical yang menunjuk ke index tertentu.

Contoh:

```text
cases-read → cases-v3
cases-write → cases-v3
```

Alias penting untuk zero-downtime reindex.

### 6.17 Data Stream

Data stream adalah abstraksi untuk append-only/time-series style data dengan backing indices. Elastic mendokumentasikan bahwa indexing/search request dapat dikirim langsung ke data stream, dan data stream akan merutekan request ke backing indices; lifecycle dapat diotomasi dengan ILM atau data stream lifecycle. [Source: Elastic Docs — Data streams](https://www.elastic.co/docs/manage-data/data-store/data-streams)

### 6.18 ILM

Index Lifecycle Management mengotomasi pengelolaan index time-based seperti logs/metrics, misalnya rollover, pindah tier, dan delete. [Source: Elastic Docs — Index lifecycle management](https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management)

### 6.19 Vector Search

Search berdasarkan embedding/vector similarity, bukan hanya lexical terms.

Elastic mendokumentasikan semantic search sebagai kemampuan menggunakan NLP dan vector search untuk menemukan hasil berdasarkan meaning, bukan hanya keyword. [Source: Elastic Docs — Semantic search](https://www.elastic.co/docs/solutions/search/semantic-search)

---

## 7. Kapan Elasticsearch Tepat Digunakan?

Gunakan Elasticsearch ketika problem utama adalah retrieval/search.

### 7.1 Full-Text Search

Contoh:

```text
Cari policy document yang menyebut "beneficial ownership disclosure".
```

SQL `LIKE` tidak cukup karena butuh:

- tokenization,
- stemming,
- phrase search,
- field boosting,
- typo tolerance,
- highlighting,
- ranking.

### 7.2 Faceted Search

Contoh:

```text
Cari enforcement cases terkait "late reporting",
lalu filter by status, jurisdiction, severity, year, assignee.
```

Search engine cocok karena result list dan facet count berasal dari query context yang sama.

### 7.3 Search Across Heterogeneous Documents

Contoh:

```text
Cari "market abuse" di cases, evidence, decisions, notices, internal memo.
```

Bisa dibuat unified search dengan beberapa index atau document type projection.

### 7.4 Autocomplete / Suggestion

Contoh:

```text
User mengetik "brok..."
Sistem menyarankan "broker supervision", "broker misconduct", "broker-dealer".
```

Elasticsearch menyediakan pola untuk prefix/autocomplete/suggester, tetapi desainnya harus hati-hati.

### 7.5 Log/Event Search

Contoh:

```text
Cari error event dengan trace_id, service, message, timestamp.
```

Elasticsearch historically populer untuk observability/log search, meski storage lifecycle harus dirancang baik.

### 7.6 Regulatory / Case Management Search

Contoh:

```text
Investigator mencari semua kasus terkait entitas, isu, dokumen bukti,
dan timeline escalation tertentu.
```

Elasticsearch cocok untuk:

- multi-field search,
- cross-entity projection,
- permission-aware retrieval,
- highlight,
- relevance ranking,
- facet,
- result explanation.

### 7.7 Semantic / Vector Retrieval

Contoh:

```text
Cari dokumen yang secara makna mirip dengan:
"failure to adequately supervise suspicious trading activity"
```

Meskipun dokumen tidak mengandung kata yang persis sama, semantic search dapat menemukan kemiripan makna.

### 7.8 RAG Retrieval Layer

Dalam sistem RAG, Elasticsearch dapat menjadi retriever:

```text
User question
  ↓
lexical/vector/hybrid retrieval
  ↓
top passages
  ↓
LLM answer grounded in retrieved content
```

Namun ini perlu evaluation ketat. Semantic similarity tidak sama dengan legal/regulatory correctness.

---

## 8. Kapan Elasticsearch Tidak Tepat?

### 8.1 Primary Transactional Store

Jangan gunakan Elasticsearch sebagai canonical case database.

Masalah:

- update semantics tidak cocok,
- transaction boundary lemah dibanding OLTP,
- referential integrity tidak natural,
- concurrent state mutation tidak ideal,
- reindex/mapping evolution bisa mengubah storage shape.

### 8.2 Complex Relational Joins

Elasticsearch bukan relational join engine.

Kalau query sangat bergantung pada normalized join kompleks, biasanya:

- redesign search projection,
- precompute,
- denormalize,
- atau query dari OLTP/OLAP yang lebih tepat.

### 8.3 Strong Read-After-Write User Contract

Kalau user harus langsung membaca state terbaru setelah write, gunakan source-of-truth path.

Search can catch up.

### 8.4 Large Analytical Scans

Untuk heavy OLAP, gunakan columnar analytics engine.

Elasticsearch aggregation cocok untuk search-driven analysis, bukan semua analytics.

### 8.5 Queue / Workflow State Machine

Untuk regulatory lifecycle, jangan jadikan Elasticsearch state machine engine.

State machine canonical harus di application/domain DB. Elasticsearch bisa mengindeks state untuk discovery, monitoring, search, dan queue visibility.

### 8.6 Authorization Source

Jangan jadikan Elasticsearch sebagai satu-satunya tempat kebenaran permission.

Index permission fields boleh untuk filtering cepat, tetapi permission canonical tetap harus dikelola di IAM/domain authorization model.

---

## 9. Search Engine Thinking untuk Java Engineer

Sebagai Java engineer, Anda mungkin terbiasa memikirkan sistem melalui:

- entity,
- repository,
- transaction,
- service,
- DTO,
- endpoint,
- concurrency,
- performance,
- consistency,
- tests.

Untuk Elasticsearch, tambahkan dimensi berikut:

### 9.1 Retrieval Unit

Pertanyaan:

```text
Apa unit hasil search?
```

Bukan:

```text
Apa aggregate root saya?
```

Contoh:

- user mencari case → result unit = case,
- user mencari evidence → result unit = document/evidence,
- user mencari party → result unit = party,
- user mencari timeline → result unit = event,
- user mencari semua → result unit bisa polymorphic.

Salah unit retrieval menyebabkan query rumit dan result tidak natural.

### 9.2 Query Intent

Pertanyaan:

```text
User sedang mencoba menemukan apa?
```

Bisa berbeda:

- known-item search,
- exploratory search,
- troubleshooting search,
- investigative search,
- monitoring queue,
- compliance evidence search,
- semantic knowledge lookup.

Setiap intent butuh query design berbeda.

### 9.3 Ranking Contract

Pertanyaan:

```text
Apa arti "lebih relevan"?
```

Untuk e-commerce, relevan mungkin:

```text
text match + popularity + availability + margin
```

Untuk regulatory case management:

```text
text match + active status + severity + jurisdiction + legal relevance + recency
```

Ranking harus selaras dengan task.

### 9.4 Freshness Contract

Pertanyaan:

```text
Seberapa cepat perubahan harus terlihat di search?
```

Pilihan:

- immediate via source-of-truth detail page,
- near-real-time search dalam beberapa detik,
- async eventual search dalam menit,
- batch index harian,
- manual reindex untuk archive.

Jangan menjanjikan freshness tanpa desain indexing pipeline.

### 9.5 Permission Contract

Pertanyaan:

```text
Apakah user boleh tahu dokumen ini ada?
Apakah user boleh melihat count facet-nya?
Apakah highlight bisa membocorkan field sensitif?
```

Search leakage sering subtle.

Contoh:

User tidak boleh melihat case confidential. Jika result list difilter tetapi facet count masih menghitung confidential case, sistem tetap bocor.

### 9.6 Evolution Contract

Pertanyaan:

```text
Bagaimana mapping berubah nanti?
Bagaimana analyzer berubah nanti?
Bagaimana index versi baru dibuat?
Bagaimana rollback?
```

Elasticsearch schema evolution harus dirancang sejak awal.

---

## 10. The Search Platform Loop

Search platform yang matang memiliki loop:

```text
Design
  ↓
Index
  ↓
Query
  ↓
Measure
  ↓
Tune
  ↓
Reindex/Migrate
  ↓
Observe
  ↓
Improve
```

### 10.1 Design

- tentukan use case,
- tentukan retrieval unit,
- tentukan document shape,
- tentukan mapping,
- tentukan analyzer,
- tentukan permission model,
- tentukan ranking signal.

### 10.2 Index

- transform source data,
- index idempotently,
- handle retry,
- monitor lag,
- support replay,
- validate count and checksum.

### 10.3 Query

- parse request,
- validate filters,
- build Query DSL,
- apply permission,
- execute,
- return results.

### 10.4 Measure

- latency,
- hit count,
- zero-result rate,
- click/action rate,
- relevance judgments,
- slow query logs,
- indexing lag,
- failed bulk items.

### 10.5 Tune

- adjust analyzer,
- adjust boosts,
- add synonyms,
- revise document shape,
- add filter fields,
- fix mappings,
- tune shard/index settings.

### 10.6 Reindex/Migrate

- create new index version,
- backfill,
- verify,
- alias swap,
- rollback if needed.

### 10.7 Observe

- cluster health,
- heap,
- disk watermark,
- thread pools,
- rejected executions,
- shard relocation,
- segment count,
- merge pressure.

### 10.8 Improve

- add golden queries,
- run relevance regression,
- improve autocomplete,
- fix no-result cases,
- optimize expensive filters,
- refine ranking.

---

## 11. Search Quality: Correctness Yang Berbeda

Dalam OLTP, correctness sering binary:

```text
Balance account harus 100000.
Status case harus CLOSED.
Foreign key harus valid.
```

Dalam search, correctness sering graded:

```text
Apakah result terbaik ada di top 3?
Apakah dokumen relevan tidak hilang?
Apakah dokumen irrelevant tidak mendominasi?
Apakah ranking sesuai task?
Apakah user menemukan yang dicari?
```

### 11.1 Precision

Dari hasil yang dikembalikan, berapa yang relevan?

```text
precision@10 = relevant results in top 10 / 10
```

### 11.2 Recall

Dari semua dokumen relevan, berapa yang berhasil ditemukan?

```text
recall = found relevant / all relevant
```

### 11.3 Ranking Quality

Search tidak hanya “found or not”.

Kalau dokumen paling penting ada di posisi 47, secara praktis sistem gagal.

Metric:

- MRR,
- nDCG,
- precision@K,
- recall@K.

Detailnya akan dibahas di Part 032.

### 11.4 Zero-Result Rate

Jika banyak query menghasilkan kosong, mungkin:

- analyzer salah,
- synonym kurang,
- user vocabulary beda,
- typo tidak ditangani,
- filter terlalu agresif,
- permission terlalu restrictive,
- data belum terindex.

### 11.5 False Confidence

Search yang mengembalikan banyak result belum tentu baik.

Sistem buruk bisa selalu mengembalikan banyak dokumen tapi tidak relevan.

Top-tier search engineer peduli pada:

```text
Can the user complete their task?
```

Bukan hanya:

```text
Did Elasticsearch return hits?
```

---

## 12. Relevance Engineering: Dari Syntax ke Product Behavior

Banyak engineer belajar Elasticsearch dari Query DSL:

```json
{
  "query": {
    "match": {
      "title": "market manipulation"
    }
  }
}
```

Itu perlu, tapi belum cukup.

Search yang baik dimulai dari relevance model.

### 12.1 Contoh Relevance Model

Use case:

```text
Investigator mencari kasus aktif terkait market manipulation.
```

Mungkin relevance ranking:

1. Title exact phrase match.
2. Case topic match.
3. Summary match.
4. Party name match.
5. Active cases boosted.
6. High severity boosted.
7. Recent updates boosted.
8. User team-owned cases boosted.
9. Closed archived cases demoted.
10. Confidential cases excluded unless authorized.

Query DSL hanyalah implementasi dari relevance model itu.

### 12.2 Jangan Ranking Dengan Magic Number Tanpa Governance

Contoh buruk:

```text
title boost = 10
summary boost = 3
party boost = 7
severity boost = 12
```

Tanpa alasan, test, atau evaluasi.

Lebih baik:

- dokumentasikan asumsi,
- uji dengan golden queries,
- bandingkan before/after,
- catat ranking changes,
- rollback jika quality turun.

### 12.3 Relevance Berubah Seiring Domain

Search untuk legal/regulatory domain tidak sama dengan search untuk produk, tiket support, log, atau knowledge base.

Karena itu seri ini akan sering menekankan:

> Design relevance from user task, not from Elasticsearch feature list.

---

## 13. Elasticsearch Operational Reality

Elasticsearch adalah distributed system. Maka production issue-nya nyata.

### 13.1 Index Tidak Gratis

Setiap field punya biaya:

- disk,
- memory,
- heap metadata,
- query cost,
- indexing cost,
- merge cost.

Mapping terlalu luas bisa menyebabkan field explosion.

### 13.2 Shard Tidak Gratis

Shard adalah unit distribusi dan Lucene index.

Terlalu banyak shard:

- cluster state membesar,
- heap overhead naik,
- query fan-out membesar,
- recovery berat.

Terlalu sedikit shard:

- scaling terbatas,
- hot shard,
- rebalancing kurang fleksibel.

Shard count adalah capacity planning decision.

### 13.3 Update Tidak Gratis

Lucene segment immutable. Update document pada dasarnya delete old + add new.

Workload dengan update sangat sering perlu dirancang hati-hati.

### 13.4 Aggregation Tidak Gratis

Facet/aggregation bisa mahal, terutama:

- high-cardinality field,
- large result set,
- many buckets,
- nested aggregation,
- runtime/script fields.

### 13.5 Wildcard Tidak Gratis

Query seperti:

```text
*manip*
```

bisa mahal.

Solusinya bukan melarang semua wildcard, tetapi mendesain field dan analyzer untuk pattern yang dibutuhkan.

### 13.6 Vector Search Tidak Gratis

Vector search butuh:

- embedding generation,
- vector storage,
- approximate nearest neighbor indexing,
- memory/disk planning,
- recall/latency tuning,
- evaluation.

Semantic search bukan fitur yang tinggal “nyalakan”.

---

## 14. Taxonomy Use Case Elasticsearch

Agar seri ini rapi, kita bedakan beberapa use case.

### 14.1 User-Facing Search

Contoh:

- search case,
- search product,
- search article,
- search policy,
- search employee directory.

Karakteristik:

- relevance sangat penting,
- latency ketat,
- query unpredictable,
- UX expectation tinggi.

### 14.2 Internal Operational Search

Contoh:

- investigator case search,
- admin search,
- support ticket search,
- compliance review queue.

Karakteristik:

- permission penting,
- filters/facets penting,
- explainability penting,
- freshness penting,
- ranking domain-specific.

### 14.3 Observability Search

Contoh:

- logs,
- traces,
- metrics-related events.

Karakteristik:

- time-based indices,
- data stream,
- lifecycle management,
- high ingest volume,
- retention policy.

### 14.4 Knowledge Retrieval / RAG

Contoh:

- retrieve policy sections for LLM answer,
- semantic document search,
- hybrid retrieval.

Karakteristik:

- chunking,
- embedding,
- lexical+semantic hybrid,
- permission-aware retrieval,
- hallucination risk,
- grounding quality.

### 14.5 Analytical Search

Contoh:

- search result + facet,
- investigation counts,
- compliance dashboard based on filtered search.

Karakteristik:

- aggregation,
- performance trade-off,
- consistency of counts,
- not always replacement for OLAP.

---

## 15. Scope Seri Ini

Seri ini akan membahas Elasticsearch dari fondasi sampai produksi.

### 15.1 Yang Akan Dibahas Mendalam

- search engine fundamentals,
- information retrieval,
- Lucene mental model,
- Elasticsearch cluster architecture,
- document modeling,
- mapping,
- analyzer,
- Query DSL,
- full-text search,
- relevance engineering,
- filtering/faceting,
- pagination,
- indexing pipeline,
- consistency/freshness,
- Java API Client,
- backend Search API design,
- autocomplete/suggestion,
- multilingual/domain-specific search,
- security/authorization,
- performance engineering,
- shard/capacity planning,
- lifecycle management,
- schema evolution,
- observability,
- failure modes,
- backup/restore,
- advanced search features,
- vector search,
- semantic search,
- hybrid search/RAG,
- relevance evaluation,
- regulatory/case management use case,
- end-to-end capstone.

### 15.2 Yang Tidak Akan Diulang Mendalam

Karena sudah pernah dibahas di seri lain:

- dasar SQL,
- normalization relational,
- transaction isolation,
- PostgreSQL internals,
- MySQL internals,
- MongoDB document database basics,
- Redis caching patterns,
- Kafka/RabbitMQ messaging fundamentals,
- ClickHouse OLAP fundamentals,
- ScyllaDB/wide-column modeling,
- HTTP basics,
- Nginx reverse proxy basics,
- general Docker/Kubernetes operations kecuali relevan untuk Elasticsearch.

Namun, jika Elasticsearch perlu terhubung dengan hal-hal itu, kita bahas boundary-nya.

Contoh:

- outbox pattern disebut untuk indexing consistency, tetapi detail messaging tidak diulang,
- source-of-truth DB disebut untuk canonical state, tetapi SQL modeling tidak diulang,
- ClickHouse disebut sebagai pembanding analytics, tetapi OLAP internals tidak diulang.

---

## 16. Version Awareness

Elasticsearch berkembang cepat.

Seri ini akan memakai prinsip yang tahan versi:

- inverted index,
- analysis,
- mapping,
- shard,
- segment,
- refresh,
- Query DSL,
- relevance,
- lifecycle,
- indexing pipeline,
- alias-based migration,
- observability,
- capacity planning.

Namun untuk API/client/fitur spesifik, selalu cek versi yang digunakan.

Elastic mendokumentasikan Java API Client resmi sebagai client dengan strongly typed requests dan responses untuk semua Elasticsearch APIs. [Source: Elastic Docs — Java API Client](https://www.elastic.co/docs/reference/elasticsearch/clients/java)

Saat mengerjakan production system, selalu pastikan:

```text
Elasticsearch server version
Java client version
JDK version
Elastic Cloud/self-managed constraints
License/security feature availability
Plugin/model availability
Breaking changes
```

Jangan copy-paste tutorial lama tanpa cek versi.

---

## 17. Minimal Architecture Vocabulary

Sebelum masuk part berikutnya, pahami diagram berikut.

### 17.1 Indexing Side

```text
Domain DB
  ↓
Outbox / CDC / event
  ↓
Indexer
  ↓
Transform canonical data to search document
  ↓
Bulk index to Elasticsearch
  ↓
Monitor indexing lag and failures
```

Failure yang harus dipikirkan:

- event hilang,
- event out-of-order,
- document transform gagal,
- bulk partial failure,
- mapping rejected,
- Elasticsearch unavailable,
- stale document,
- duplicate event,
- delete tidak terpropagasi,
- permission field outdated.

### 17.2 Query Side

```text
User request
  ↓
Search API
  ↓
Validate query/filter/sort/page
  ↓
Apply user context and permission
  ↓
Build Elasticsearch Query DSL
  ↓
Execute search
  ↓
Map hits to response
  ↓
Return result + facet + highlight + pagination
```

Failure yang harus dipikirkan:

- query terlalu mahal,
- timeout,
- partial result,
- wrong ranking,
- forbidden result,
- facet leakage,
- deep pagination,
- bad sort,
- stale result,
- analyzer mismatch,
- highlight exposes sensitive data.

### 17.3 Migration Side

```text
cases-v1
  ↓ create new mapping
cases-v2
  ↓ backfill/reindex
verify counts + samples + relevance
  ↓ alias swap
cases-read → cases-v2
cases-write → cases-v2
  ↓ rollback if needed
```

Failure yang harus dipikirkan:

- mapping incompatible,
- backfill incomplete,
- ranking regression,
- alias swap wrong,
- writer still writes old index,
- old index deleted too early,
- permissions changed incorrectly.

---

## 18. Common Anti-Patterns

### 18.1 “Just Make Everything Text”

Buruk:

```json
{
  "status": { "type": "text" },
  "severity": { "type": "text" },
  "case_id": { "type": "text" }
}
```

Akibat:

- exact filter salah,
- aggregation buruk,
- sorting tidak bekerja sesuai harapan,
- identifier tokenized,
- query result membingungkan.

Gunakan `keyword` untuk exact value, `text` untuk full-text, atau multi-field jika butuh keduanya.

### 18.2 Dynamic Mapping Tanpa Kontrol

Dynamic mapping nyaman di awal, berbahaya di production.

Masalah:

- field explosion,
- type salah,
- inconsistent mapping antar index,
- breaking query,
- sulit reindex.

### 18.3 Index = Table

Menyamakan index dengan table sering menghasilkan desain tidak optimal.

Index adalah retrieval collection. Kadang satu table menjadi banyak index. Kadang banyak table menjadi satu search document.

### 18.4 Query DSL Bocor ke Frontend

Frontend mengirim raw Query DSL:

```json
{
  "bool": {
    "must": [...],
    "should": [...]
  }
}
```

Ini berbahaya:

- security risk,
- expensive query,
- compatibility sulit,
- business semantics bocor,
- abuse mudah.

Lebih baik expose search API contract yang dikendalikan.

### 18.5 Permission Setelah Search

Buruk:

```text
Search 100 hits
Filter unauthorized in application
Return remaining 12
```

Masalah:

- top-K ranking rusak,
- pagination salah,
- facet bocor,
- total count salah,
- unauthorized docs memengaruhi score/aggregation.

Permission harus masuk query/filter atau didukung model security yang sesuai.

### 18.6 Relevance Tidak Diuji

Jika tidak punya golden query set, setiap perubahan analyzer/mapping/boost bisa merusak search tanpa terdeteksi.

### 18.7 Menggunakan Elasticsearch Untuk Semua

Elasticsearch kuat, tetapi bukan palu untuk semua paku.

Top-tier engineer tahu kapan tidak memakai Elasticsearch.

---

## 19. Elasticsearch Dalam Regulatory / Case Management Context

Karena konteks Anda dekat dengan regulatory systems dan complex case management, kita akan memakai banyak contoh dari domain ini.

### 19.1 Entitas Umum

- case,
- investigation,
- allegation,
- party,
- regulated entity,
- evidence,
- document,
- decision,
- enforcement action,
- obligation,
- breach,
- risk signal,
- escalation,
- task,
- reviewer,
- audit trail.

### 19.2 Search Use Case

Investigator mungkin ingin:

```text
Cari semua case yang terkait "late disclosure" pada issuer tertentu,
dengan status aktif,
severity high,
dalam 18 bulan terakhir,
termasuk dokumen evidence yang menyebut "beneficial ownership".
```

Manager mungkin ingin:

```text
Cari queue case high severity yang melewati SLA,
group by team dan jurisdiction.
```

Auditor mungkin ingin:

```text
Cari keputusan enforcement yang menyebut pasal tertentu,
lihat case history, document evidence, dan approval chain.
```

### 19.3 Tantangan Khusus

Regulatory search punya masalah khusus:

- strict permission,
- sensitive/confidential data,
- auditability,
- explainability,
- defensibility,
- temporal state,
- lifecycle status,
- legal hold,
- retention,
- cross-entity search,
- stale result risk,
- synonym domain,
- acronyms,
- case number exact search,
- evidence-level search,
- result ranking yang tidak boleh menyesatkan.

Karena itu Elasticsearch di domain ini harus lebih disiplin daripada sekadar search website.

---

## 20. Mindset Top 1% Untuk Elasticsearch

Skill top-tier bukan hafal semua endpoint.

Skill top-tier adalah kemampuan menghubungkan:

```text
User task
→ information retrieval model
→ document projection
→ mapping/analyzer
→ indexing pipeline
→ query DSL
→ relevance ranking
→ performance
→ security
→ operations
→ migration
→ evaluation
```

### 20.1 Mereka Mendesain Dari Query

Engineer biasa:

```text
Saya punya data ini, saya index saja.
```

Engineer kuat:

```text
User butuh query apa, filter apa, ranking apa, result apa?
Dari situ saya desain document dan mapping.
```

### 20.2 Mereka Memisahkan Canonical Model dan Search Projection

Engineer biasa:

```text
Index domain entity apa adanya.
```

Engineer kuat:

```text
Search document adalah read model/projection yang boleh berbeda dari canonical model.
```

### 20.3 Mereka Menganggap Reindex Sebagai Normal

Engineer biasa:

```text
Nanti kalau mapping berubah dipikirkan.
```

Engineer kuat:

```text
Setiap index punya versi, alias, backfill, verification, rollback.
```

### 20.4 Mereka Mengukur Relevance

Engineer biasa:

```text
Hasilnya ada, berarti selesai.
```

Engineer kuat:

```text
Apakah top result benar?
Apakah no-result turun?
Apakah ranking regression terjadi?
Apa golden query kita?
```

### 20.5 Mereka Melindungi Search Dari Abuse

Engineer biasa:

```text
User bisa filter apa saja.
```

Engineer kuat:

```text
Search API harus validasi query, limit expensive operations, enforce permission, cap pagination, observe slow query.
```

### 20.6 Mereka Paham Operational Cost

Engineer biasa:

```text
Tambah field saja.
```

Engineer kuat:

```text
Apa dampaknya ke mapping, disk, heap, doc_values, query, aggregation, reindex?
```

### 20.7 Mereka Skeptis Terhadap Semantic Search

Engineer biasa:

```text
Pakai vector search, jadi lebih pintar.
```

Engineer kuat:

```text
Apa corpus-nya? Apa embedding model-nya? Apa metric evaluasinya? Bagaimana permission? Bagaimana hybrid ranking? Apa failure mode semantic false positive?
```

---

## 21. Roadmap Belajar Setelah Part 000

Setelah part ini, urutan belajar akan seperti ini:

```text
Part 001–002:
  memahami search problem dan information retrieval.

Part 003–004:
  memahami Lucene dan Elasticsearch architecture.

Part 005–007:
  memahami document modeling, mapping, dan analysis.

Part 008–013:
  memahami query, full-text search, relevance, filtering, faceting, pagination.

Part 014–017:
  memahami indexing, consistency, Java integration, dan API design.

Part 018–020:
  memahami autocomplete, multilingual/domain search, dan security.

Part 021–028:
  memahami performance, capacity, lifecycle, migration, observability, failure, backup.

Part 029–032:
  memahami advanced features, vector/semantic/hybrid search, dan evaluation.

Part 033–034:
  menerapkan semua ke regulatory/case management dan capstone production architecture.
```

---

## 22. Latihan Mental Model

Sebelum lanjut ke Part 001, coba jawab pertanyaan berikut untuk sistem yang Anda bangun.

### 22.1 Retrieval Unit

```text
Apa unit utama hasil search?
Case?
Document?
Party?
Task?
Event?
All?
```

### 22.2 Query Intent

```text
User mencari sesuatu yang sudah mereka tahu?
Atau eksplorasi?
Atau investigasi?
Atau monitoring queue?
```

### 22.3 Ranking

```text
Apa arti relevan?
Exact text match?
Severity?
Freshness?
Authority?
Status aktif?
Team ownership?
```

### 22.4 Permission

```text
Apakah user boleh tahu bahwa dokumen tertentu ada?
Apakah facet count bisa bocor?
Apakah highlight bisa bocor?
```

### 22.5 Freshness

```text
Berapa lama delay search yang dapat diterima?
1 detik?
5 detik?
1 menit?
Batch harian?
```

### 22.6 Source of Truth

```text
Data canonical ada di mana?
Bagaimana Elasticsearch diperbarui?
Bagaimana replay jika index rusak?
```

### 22.7 Evolution

```text
Kalau mapping salah, bagaimana reindex?
Kalau analyzer berubah, bagaimana validasi ranking?
Kalau permission model berubah, bagaimana repair index?
```

Jika Anda tidak bisa menjawab ini, belum waktunya menulis query kompleks.

---

## 23. Decision Checklist: Apakah Use Case Ini Cocok Untuk Elasticsearch?

Gunakan checklist berikut.

### 23.1 Strong Fit

Elasticsearch cocok jika mayoritas jawaban “ya”:

```text
[ ] User perlu full-text search.
[ ] User perlu ranking/relevance.
[ ] User perlu filter/facet.
[ ] User perlu search lintas banyak field/entity.
[ ] Query tidak selalu exact lookup.
[ ] Result top-K lebih penting daripada scan semua data.
[ ] Data boleh berupa projection dari source-of-truth.
[ ] Eventual search freshness dapat diterima.
[ ] Reindexing dapat dirancang.
[ ] Permission filtering dapat dimodelkan.
```

### 23.2 Weak Fit

Hati-hati jika banyak jawaban “ya”:

```text
[ ] Butuh transaksi kuat.
[ ] Butuh relational join kompleks.
[ ] Butuh canonical state mutation.
[ ] Butuh immediate read-after-write di search.
[ ] Butuh analytics scan besar.
[ ] Butuh queue semantics.
[ ] Butuh strict constraint enforcement.
[ ] Tidak ada rencana reindex.
[ ] Tidak ada rencana permission filtering.
[ ] Tidak ada ownership operasional.
```

### 23.3 Red Flag

Jangan gunakan Elasticsearch jika alasan utamanya:

```text
"Karena SQL query lambat."
```

Itu belum cukup. Bisa jadi solusinya:

- index SQL yang benar,
- query rewrite,
- denormalized read model,
- cache,
- OLAP engine,
- materialized view,
- partitioning,
- data model redesign.

Gunakan Elasticsearch ketika problem-nya memang search/retrieval.

---

## 24. Foundation Di Part Ini Dalam Satu Diagram

```text
                    ┌──────────────────────────────┐
                    │        User Search Task       │
                    │ known-item / exploratory /    │
                    │ investigative / RAG / ops     │
                    └───────────────┬──────────────┘
                                    │
                                    v
                    ┌──────────────────────────────┐
                    │      Retrieval Contract       │
                    │ unit, filters, sort, ranking, │
                    │ permission, freshness         │
                    └───────────────┬──────────────┘
                                    │
                                    v
                    ┌──────────────────────────────┐
                    │      Search Document Model    │
                    │ denormalized projection       │
                    └───────────────┬──────────────┘
                                    │
                                    v
                    ┌──────────────────────────────┐
                    │ Mapping + Analyzer + Signals  │
                    │ text/keyword/date/vector/etc  │
                    └───────────────┬──────────────┘
                                    │
                                    v
┌───────────────────┐       ┌──────────────────────────────┐
│ Source of Truth   │──────▶│       Indexing Pipeline       │
│ DB/Event/File/API │       │ idempotent, replayable,       │
└───────────────────┘       │ observable                    │
                            └───────────────┬──────────────┘
                                            │
                                            v
                            ┌──────────────────────────────┐
                            │        Elasticsearch          │
                            │ shard, segment, inverted idx, │
                            │ scoring, vectors, facets      │
                            └───────────────┬──────────────┘
                                            │
                                            v
                            ┌──────────────────────────────┐
                            │        Search API             │
                            │ validation, permission, DSL,  │
                            │ timeout, response mapping     │
                            └───────────────┬──────────────┘
                                            │
                                            v
                            ┌──────────────────────────────┐
                            │ Result + Feedback + Metrics   │
                            │ relevance, latency, no result │
                            └──────────────────────────────┘
```

---

## 25. What You Should Remember

Jika hanya mengingat 15 hal dari Part 000, ingat ini:

1. Elasticsearch adalah retrieval engine, bukan OLTP source-of-truth.
2. Search document adalah projection, bukan domain entity.
3. Desain index dimulai dari query behavior dan ranking behavior.
4. Full-text search berbeda dari exact filter.
5. Analyzer menentukan bagaimana text “dipahami” oleh index.
6. Inverted index adalah struktur inti lexical search.
7. Lucene segment immutable; update bukan update-in-place biasa.
8. Elasticsearch near-real-time, bukan always immediate search consistency.
9. Query context menghitung score; filter context tidak.
10. Ranking adalah produk engineering, bukan magic.
11. Permission harus masuk desain search, bukan afterthought.
12. Facet/count juga bisa membocorkan data.
13. Reindex adalah aktivitas normal, bukan exceptional disaster.
14. Shard, mapping, analyzer, aggregation, dan vector punya biaya operasional.
15. Search quality harus diukur dengan golden queries dan relevance metrics.

---

## 26. Penutup Part 000

Part ini membentuk orientasi:

- apa itu search engine database,
- bagaimana Elasticsearch sebaiknya diposisikan,
- apa bedanya dengan database lain,
- bagaimana data menjadi search result,
- apa vocabulary awal yang perlu dikuasai,
- bagaimana berpikir sebagai Java backend engineer,
- apa anti-pattern yang harus dihindari,
- bagaimana konteks regulatory/case management akan dipakai di seri ini.

Part berikutnya akan masuk ke problem fundamental search:

```text
Part 001 — Search Problem Fundamentals: From Lookup to Relevance
```

Di sana kita akan membedah perbedaan lookup, search, discovery, recommendation, dan retrieval; lalu membangun mental model precision, recall, ranking, intent, dan failure mode search.

---

## 27. Referensi Awal

Referensi berikut digunakan untuk memastikan istilah teknis dan positioning modern tetap akurat:

1. Elastic Docs — Near real-time search  
   <https://www.elastic.co/docs/manage-data/data-store/near-real-time-search>

2. Elastic Docs — Index basics  
   <https://www.elastic.co/docs/manage-data/data-store/index-basics>

3. Elastic Docs — Data streams  
   <https://www.elastic.co/docs/manage-data/data-store/data-streams>

4. Elastic Docs — Index lifecycle management  
   <https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management>

5. Elastic Docs — Semantic search  
   <https://www.elastic.co/docs/solutions/search/semantic-search>

6. Elastic Docs — Java API Client  
   <https://www.elastic.co/docs/reference/elasticsearch/clients/java>

7. Elastic GitHub Repository — Elasticsearch  
   <https://github.com/elastic/elasticsearch>

8. Apache Lucene API — BM25Similarity  
   <https://lucene.apache.org/core/9_12_0/core/org/apache/lucene/search/similarities/BM25Similarity.html>

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-001.md">Part 001 — Search Problem Fundamentals: From Lookup to Relevance ➡️</a>
</div>
