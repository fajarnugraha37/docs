# Learn Search Engine Database and Elasticsearch Mastery for Java Engineers

## Part 014 — Indexing Pipeline and Data Ingestion

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Part: `014`  
> Fokus: bagaimana data masuk ke Elasticsearch secara benar, cepat, idempotent, observable, dan aman untuk production.  
> Target pembaca: Java software engineer yang sudah memahami dasar search, Lucene, Elasticsearch architecture, document modeling, mapping, analysis, query DSL, relevance, filtering, dan pagination dari part sebelumnya.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 013, kita sudah membangun fondasi dari sisi **read/search path**:

- apa itu search problem,
- bagaimana inverted index bekerja,
- bagaimana Lucene segment menjadi basis storage/search,
- bagaimana Elasticsearch mendistribusikan shard dan replica,
- bagaimana document search dimodelkan,
- bagaimana mapping dan analyzer menentukan index behavior,
- bagaimana Query DSL, full-text query, relevance, filter, aggregation, pagination, sorting, dan PIT bekerja.

Part 014 berpindah ke sisi lain yang sama pentingnya: **write/indexing path**.

Di production, banyak kegagalan Elasticsearch bukan karena engineer tidak tahu cara menulis query, tetapi karena pipeline indexing-nya buruk:

- data tidak idempotent,
- dokumen stale,
- delete tidak terpropagasi,
- update partial merusak document shape,
- bulk terlalu besar atau terlalu kecil,
- refresh dipaksa terlalu sering,
- mapping berubah diam-diam,
- backfill mengganggu traffic search,
- error bulk tidak diproses per item,
- alias swap tidak aman,
- index baru tidak compatible dengan query lama,
- pipeline tidak bisa replay,
- user melihat hasil yang tidak konsisten tanpa kontrak freshness yang jelas.

Part ini membangun mental model untuk **ingestion system**, bukan hanya “cara memanggil Index API”.

---

## 1. Core Thesis

Elasticsearch indexing bukan sekadar menyimpan JSON.

Indexing adalah proses mengubah state domain menjadi **retrieval artifact**.

Artinya:

```text
Canonical domain state
        |
        |  extract / transform / enrich / authorize / normalize
        v
Search document
        |
        |  analyze / map / route / write / refresh / merge
        v
Searchable index representation
```

Top-tier engineer tidak melihat Elasticsearch sebagai tempat “menaruh data cadangan”. Mereka melihatnya sebagai sistem turunan yang harus punya:

1. sumber kebenaran yang jelas,
2. identitas dokumen yang stabil,
3. transformasi yang deterministic,
4. mekanisme replay,
5. error handling per event/per document,
6. freshness contract,
7. observability,
8. migration strategy,
9. repair strategy,
10. ownership boundary.

---

## 2. Apa Itu Indexing Pipeline?

Indexing pipeline adalah jalur dari perubahan data di sistem sumber sampai data tersebut dapat ditemukan lewat Elasticsearch.

Contoh sederhana:

```text
PostgreSQL / MySQL / MongoDB / service state
        |
        | domain event / CDC / scheduled export / API call
        v
Indexing worker
        |
        | build search document
        v
Bulk request to Elasticsearch
        |
        | index refresh eventually
        v
Search API can find updated document
```

Pipeline ini bisa sangat sederhana atau sangat kompleks tergantung domain.

Untuk sistem regulatory/case-management, pipeline mungkin mencakup:

- case created,
- party added,
- allegation updated,
- evidence uploaded,
- decision issued,
- enforcement action escalated,
- confidentiality status changed,
- assignment changed,
- permission changed,
- legal hold applied,
- case closed,
- record retention expired.

Setiap perubahan tersebut dapat memengaruhi search document.

---

## 3. Search Document Bukan Domain Entity

Ini sudah disentuh di Part 005, tetapi sangat penting untuk indexing.

Domain entity biasanya dipecah berdasarkan consistency boundary:

```text
Case
Party
Officer
Evidence
Decision
Escalation
SLA
Permission
```

Search document biasanya dibentuk berdasarkan retrieval need:

```json
{
  "case_id": "CASE-2026-00129",
  "title": "Unlicensed financial promotion investigation",
  "summary": "...",
  "parties": ["ABC Capital Ltd", "John Doe"],
  "allegation_types": ["misleading_advertising", "unauthorized_activity"],
  "status": "under_investigation",
  "severity": "high",
  "assigned_team": "Market Conduct",
  "visibility_groups": ["team-market-conduct", "role-supervisor"],
  "opened_at": "2026-01-08T09:30:00Z",
  "last_activity_at": "2026-06-20T11:14:00Z",
  "search_text": "...denormalized text..."
}
```

Pipeline bertugas membangun dokumen seperti ini dari banyak sumber.

Konsekuensinya:

- event kecil bisa memerlukan rebuild dokumen besar,
- permission update bisa memengaruhi banyak dokumen,
- delete domain entity belum tentu delete search document,
- lifecycle status bisa mengubah visibility dan ranking,
- stale derived field bisa menyesatkan investigator/user.

---

## 4. Empat Model Ingestion Utama

Secara umum, ada empat model ingestion.

### 4.1 Synchronous Indexing dari Request Path

Saat application command berhasil, service langsung menulis ke Elasticsearch.

```text
HTTP request
   -> update DB transaction
   -> index Elasticsearch
   -> return response
```

#### Kelebihan

- sederhana,
- freshness lebih cepat,
- cocok untuk prototype atau data kecil,
- mudah dipahami developer baru.

#### Kekurangan

- dual-write problem,
- latency request meningkat,
- failure Elasticsearch bisa memengaruhi command path,
- retry bisa menghasilkan race condition,
- sulit replay,
- sulit scale untuk write burst.

#### Kapan masuk akal?

- fitur internal kecil,
- data tidak kritikal,
- consistency requirement sederhana,
- traffic rendah,
- failure dapat diterima.

#### Kapan berbahaya?

- regulatory system,
- audit-sensitive system,
- high-write workload,
- multi-entity document,
- permission-sensitive search,
- sistem yang butuh replay/backfill.

### 4.2 Asynchronous Event-Driven Indexing

Domain service menulis canonical state dan menerbitkan event. Worker indexing membaca event dan menulis Elasticsearch.

```text
Command service
   -> DB transaction
   -> outbox event

Indexer worker
   -> read event
   -> load current canonical state
   -> build search document
   -> bulk index/delete Elasticsearch
```

#### Kelebihan

- request path tidak bergantung langsung pada Elasticsearch,
- event dapat di-retry,
- pipeline dapat di-scale,
- bisa replay,
- failure lebih terisolasi,
- cocok untuk complex search document.

#### Kekurangan

- eventual consistency,
- perlu lag monitoring,
- perlu idempotency,
- perlu ordering strategy,
- perlu reconciliation.

Ini biasanya pilihan yang lebih sehat untuk production.

### 4.3 Change Data Capture / CDC

Perubahan DB ditangkap dari log database, lalu diproses menjadi document update.

```text
Database WAL/binlog/oplog
        -> CDC connector
        -> stream/topic
        -> indexing worker
        -> Elasticsearch
```

#### Kelebihan

- tidak terlalu mengubah application code,
- menangkap perubahan aktual di DB,
- cocok untuk integrasi legacy,
- bisa dipakai untuk near-real-time replication.

#### Kekurangan

- perubahan row belum tentu sama dengan perubahan search document,
- semantics domain bisa hilang,
- perlu join/enrichment,
- delete/tombstone harus ditangani benar,
- schema evolution lebih kompleks.

CDC bagus untuk data movement, tetapi search document sering tetap butuh domain-aware builder.

### 4.4 Batch / Scheduled Rebuild

Pipeline periodik membaca seluruh atau sebagian data lalu meng-index ulang.

```text
Nightly job
   -> read source DB pages
   -> build documents
   -> bulk index into new index
   -> alias swap
```

#### Kelebihan

- deterministic,
- mudah audit,
- cocok untuk rebuild total,
- cocok untuk migration,
- bisa verifikasi sebelum publish.

#### Kekurangan

- freshness rendah,
- mahal untuk dataset besar,
- perlu capacity planning,
- perlu alias strategy.

Batch rebuild bukan anti-pattern. Untuk banyak sistem, kombinasi terbaik adalah:

```text
event-driven incremental indexing + periodic reconciliation/backfill
```

---

## 5. Indexing Operation Types

Elasticsearch Bulk API dan document APIs mendukung beberapa jenis operasi utama:

- `index`,
- `create`,
- `update`,
- `delete`.

Memilih operation type yang salah dapat menyebabkan bug subtle.

---

## 6. `index`: Replace or Create Document

`index` berarti:

- kalau document id belum ada, buat document baru,
- kalau document id sudah ada, ganti document dengan isi baru.

Mental model:

```text
PUT /cases/_doc/CASE-123
{
  "status": "open",
  "title": "..."
}
```

Operasi ini cocok untuk **full document replacement**.

Untuk search pipeline, ini sering lebih aman daripada partial update karena search document adalah projection turunan.

Jika canonical source berubah, pipeline membangun ulang seluruh search document, lalu melakukan `index` dengan id yang sama.

```text
current canonical state -> build full search document -> index by stable id
```

Kelebihan:

- idempotent jika input state sama,
- tidak bergantung pada state lama di Elasticsearch,
- mudah replay,
- mudah repair,
- menghindari field stale akibat partial update.

Kekurangan:

- perlu membangun full document,
- payload bisa lebih besar,
- update kecil tetap menulis ulang dokumen.

Untuk banyak use case enterprise search, **full replacement is the safest default**.

---

## 7. `create`: Insert Only If Absent

`create` hanya berhasil jika document belum ada.

Cocok untuk:

- append-only event index,
- audit/event log index,
- immutable records,
- preventing accidental overwrite.

Tidak cocok untuk entity search document yang bisa berubah.

Contoh penggunaan tepat:

```text
case_activity_event-2026.06.21/_create/event-982371
```

Contoh penggunaan kurang tepat:

```text
cases/_create/CASE-123
```

Jika case bisa update, operasi ini akan gagal setelah create pertama.

---

## 8. `update`: Partial Update and Scripted Mutation

`update` mengambil document yang ada, menerapkan partial doc atau script, lalu meng-index hasilnya kembali.

Penting: di bawah hood, update tetap menghasilkan versi dokumen baru. Lucene tidak mengubah segment immutable in-place.

`update` cocok untuk:

- counter kecil,
- status patch sederhana,
- field yang jelas tidak bergantung pada banyak entity,
- scripted update yang memang perlu current value di Elasticsearch.

Tetapi untuk search projection kompleks, partial update berisiko:

- field lama bisa tertinggal,
- nested array bisa menjadi tidak konsisten,
- update order bisa merusak state,
- event replay tidak deterministic,
- domain canonical state tidak lagi menjadi satu-satunya sumber.

Contoh anti-pattern:

```text
PartyNameChanged event
   -> update cases document, replace parties.name only
```

Masalah:

- party mungkin muncul di banyak dokumen,
- party mungkin punya aliases,
- permission mungkin berubah,
- search_text denormalized mungkin tidak ikut diperbarui,
- autocomplete field mungkin stale,
- highlighting field mungkin stale.

Lebih aman:

```text
PartyNameChanged event
   -> find affected case ids
   -> load canonical case projection
   -> rebuild full case search document
   -> index full document
```

---

## 9. `upsert` dan `doc_as_upsert`

`upsert` berarti update jika ada, insert jika tidak ada.

Ini menggoda karena terlihat praktis.

Tetapi tanyakan:

```text
Apakah partial update cukup untuk membangun dokumen valid jika dokumen sebelumnya belum ada?
```

Jika jawabannya tidak, jangan memakai upsert sembarangan.

`doc_as_upsert` cocok untuk dokumen sederhana seperti:

```json
{
  "product_id": "P-1",
  "view_count": 20
}
```

Kurang cocok untuk search document kompleks yang memerlukan banyak field derived.

Rule of thumb:

```text
If the document is a projection, prefer full rebuild + index.
If the document is truly partial-state-owned, update/upsert may be acceptable.
```

---

## 10. `delete`: Delete Search Document

Delete perlu diperlakukan sebagai first-class event.

Banyak sistem gagal karena create/update dipikirkan dengan baik, tetapi delete dilupakan.

Delete cases:

1. canonical entity hard-deleted,
2. entity archived dan tidak boleh searchable,
3. permission changed sehingga user tertentu tidak boleh melihat,
4. tenant removed,
5. retention expired,
6. legal directive menghapus data,
7. source record merged into another record,
8. duplicate record suppressed.

Delete di Elasticsearch juga bukan langsung menghapus bytes dari disk. Lucene menandai document sebagai deleted; disk reclaim terjadi saat segment merge.

Karena itu, delete storm dapat menyebabkan merge pressure.

Untuk business semantics, bedakan:

```text
Search invisibility != physical deletion
```

Ada tiga model:

### 10.1 Physical Delete

Document dihapus dari index.

Cocok untuk:

- record tidak boleh muncul sama sekali,
- retention expired,
- rebuild dari source-of-truth mudah.

### 10.2 Soft Delete Field

Document tetap ada tetapi diberi field:

```json
{
  "is_deleted": true,
  "deleted_at": "2026-06-21T10:00:00Z"
}
```

Search query selalu filter:

```json
{
  "term": {
    "is_deleted": false
  }
}
```

Cocok untuk:

- audit,
- internal recovery,
- temporary suppression,
- lifecycle-driven visibility.

Risiko:

- query lupa filter,
- facet leakage,
- result count salah,
- sensitive data masih ada di index.

### 10.3 Move to Historical Index

Active index hanya berisi data aktif. Data historis dipindahkan atau direbuild ke index lain.

Cocok untuk:

- regulatory case history,
- closed cases,
- long retention,
- different search UX for active vs archive.

---

## 11. Stable Document ID

Document ID adalah anchor idempotency.

Tanpa stable ID, indexing pipeline mudah menghasilkan duplicate.

Buruk:

```text
_doc id = random UUID generated by indexer
```

Lebih baik:

```text
_doc id = canonical business id
_doc id = tenant_id + ':' + entity_type + ':' + entity_id
```

Contoh:

```text
tenant-a:case:CASE-2026-00129
tenant-a:party:PARTY-992
tenant-a:case-note:NOTE-881
```

Stable ID memberi manfaat:

- replay aman,
- full replacement aman,
- delete mudah,
- duplicate rendah,
- repair deterministic,
- reconciliation mudah.

Tetapi jangan sembarang memakai business id jika:

- id mengandung sensitive information,
- id bisa berubah,
- id tidak globally unique,
- id berbeda antar tenant,
- id perlu disembunyikan dari URL/log.

Jika perlu, gunakan deterministic opaque id:

```text
sha256(tenant_id + ':' + entity_type + ':' + canonical_id)
```

---

## 12. Idempotency: Requirement, Bukan Nice-to-Have

Indexing pipeline harus idempotent karena production system pasti mengalami:

- retry,
- duplicate event,
- worker restart,
- network timeout,
- unknown write status,
- replay,
- redelivery,
- batch partial failure.

Operasi idempotent berarti menjalankan operasi yang sama berkali-kali menghasilkan state akhir yang sama.

### 12.1 Idempotent Full Index

```text
event CASE_UPDATED
   -> load current case state
   -> build document D
   -> PUT /cases/_doc/CASE-123 D
```

Jika dijalankan 10 kali, hasil akhir tetap sama.

### 12.2 Non-Idempotent Increment

```text
event CASE_VIEWED
   -> update script: ctx._source.view_count += 1
```

Jika event duplicate, count salah.

Untuk counter, perlu event id dedupe, external aggregation, atau acceptance bahwa count approximate.

### 12.3 Idempotency Checklist

Untuk setiap pipeline, tanyakan:

- Apakah event bisa diterima dua kali?
- Apakah worker bisa crash setelah write tetapi sebelum commit offset?
- Apakah bulk response bisa timeout tetapi sebagian sukses?
- Apakah replay menghasilkan duplicate?
- Apakah delete event aman jika document sudah tidak ada?
- Apakah update lama bisa menimpa update baru?

---

## 13. Ordering and Versioning

Event-driven indexing menghadapi masalah ordering.

Contoh:

```text
T1: Case status = OPEN
T2: Case status = CLOSED
```

Jika event T2 diproses dulu, lalu T1 diproses belakangan, index bisa mundur ke state lama.

Ada beberapa strategi.

### 13.1 Load Current State on Every Event

Event hanya dipakai sebagai trigger.

```text
on CaseChanged(caseId):
    current = loadCaseFromDB(caseId)
    doc = buildSearchDocument(current)
    index(doc)
```

Kelebihan:

- event ordering kurang penting,
- state akhir mengikuti DB,
- replay lebih aman.

Kekurangan:

- DB load bertambah,
- jika event banyak, bisa redundant,
- perlu coalescing/debounce.

Ini strategi yang sangat baik untuk search projection kompleks.

### 13.2 Use Monotonic Version

Setiap canonical entity punya versi meningkat:

```json
{
  "case_id": "CASE-123",
  "version": 42,
  "updated_at": "2026-06-21T10:00:00Z"
}
```

Indexer menolak update yang lebih tua.

Elasticsearch mendukung mekanisme versioning/concurrency tertentu, tetapi desain aplikasinya harus jelas:

- version harus monotonic,
- version berasal dari source-of-truth,
- event lama tidak boleh overwrite state baru,
- conflict harus masuk retry/dead-letter/ignored-with-metric.

### 13.3 Partition by Entity ID

Jika memakai stream, partition by entity id agar event untuk entity yang sama relatif ordered.

```text
partition key = case_id
```

Kelebihan:

- ordering per entity lebih mudah,
- update sequential per key.

Kekurangan:

- hot entity bisa menyebabkan skew,
- cross-entity ordering tetap tidak dijamin,
- multi-document rebuild tetap perlu hati-hati.

### 13.4 Last-Write-Wins by Timestamp

Terkadang dipakai, tetapi hati-hati.

Timestamp bisa bermasalah karena:

- clock skew,
- timezone bug,
- delayed events,
- semantic ordering tidak selalu sama dengan waktu terima.

Lebih baik gunakan canonical version jika ada.

---

## 14. Refresh Semantics

Salah satu miskonsepsi terbesar:

```text
Index response success != document immediately searchable
```

Elasticsearch bersifat near-real-time. Write berhasil masuk ke shard, tetapi hasilnya baru terlihat search setelah refresh.

Refresh membuat perubahan terbaru terlihat oleh search dengan membuka searcher baru terhadap segment terbaru.

Default refresh behavior di self-managed/traditional Elasticsearch umumnya sekitar 1 detik untuk index yang aktif dicari; Elastic Cloud Serverless punya default yang berbeda. Detail ini penting karena jangan mengasumsikan angka refresh universal untuk semua deployment.

---

## 15. Refresh Parameter

Index, Update, Delete, dan Bulk API mendukung parameter `refresh`.

Nilai umum:

### 15.1 `refresh=false`

Default behavior: tidak memaksa refresh segera.

Cocok untuk production write throughput.

```text
Write accepted now, searchable after normal refresh cycle.
```

### 15.2 `refresh=true`

Memaksa refresh setelah operasi.

Jangan digunakan sembarangan.

Biaya:

- membuat segment kecil lebih sering,
- menambah overhead searcher reopening,
- menurunkan indexing throughput,
- memperbesar merge pressure.

Cocok hanya untuk:

- test,
- admin operation kecil,
- UX yang benar-benar memerlukan immediate search visibility untuk sedikit dokumen.

### 15.3 `refresh=wait_for`

Request menunggu sampai refresh berikutnya membuat perubahan terlihat.

Ini lebih baik daripada memaksa refresh dalam banyak kasus, tetapi tetap meningkatkan latency caller.

Cocok untuk:

- integration test,
- command kecil yang harus bisa search setelah return,
- workflow user yang butuh read-after-write search consistency.

Namun jangan digunakan untuk bulk besar atau high-throughput ingestion tanpa alasan kuat.

---

## 16. Freshness Contract

Daripada memaksa semua write langsung searchable, desain kontrak freshness.

Contoh kontrak:

```text
Search results are usually updated within 1-5 seconds.
For critical status changes, direct case detail page reads from canonical DB.
Search is eventually consistent and may lag during reindex/backfill.
```

Untuk regulatory system:

- command confirmation harus berasal dari canonical DB,
- search boleh eventual,
- detail page harus canonical,
- stale search harus dimitigasi dengan banner/status,
- permission changes mungkin memerlukan jalur lebih cepat daripada content updates.

Freshness bukan hanya setting Elasticsearch. Freshness adalah product and system contract.

---

## 17. Bulk Indexing

Bulk API adalah cara utama indexing production.

Bulk memungkinkan banyak operasi `index`, `create`, `update`, dan `delete` dikirim dalam satu request sehingga overhead network dan request handling lebih rendah.

Mental model:

```text
source changes -> buffer -> bulk request -> per-item response -> retry failures
```

Bulk bukan transaksi.

Satu bulk request bisa berisi 1000 item; sebagian sukses, sebagian gagal.

Karena itu response harus diperiksa per item.

Anti-pattern:

```java
BulkResponse response = client.bulk(request);
if (!response.errors()) {
    commitOffset();
}
```

Lebih buruk:

```java
client.bulk(request);
commitOffset(); // tanpa cek item failures
```

Yang benar:

```text
for each item response:
    if success:
        mark success
    if retryable failure:
        retry with backoff
    if non-retryable failure:
        send to dead-letter with context
commit only safe progress
```

---

## 18. Bulk Size: Tidak Ada Angka Sakral

Bulk size harus diuji.

Parameter yang perlu diperhatikan:

- jumlah dokumen per batch,
- total bytes per batch,
- document complexity,
- analyzer cost,
- number of shards,
- replica count,
- refresh interval,
- cluster CPU,
- heap pressure,
- disk throughput,
- network latency,
- concurrent workers.

Starting point praktis:

```text
500-2000 documents per bulk
5-15 MB per bulk payload
```

Tetapi ini hanya awal eksperimen, bukan rule universal.

Cari titik optimum berdasarkan:

- indexing throughput docs/sec,
- p95/p99 bulk latency,
- rejection rate,
- CPU saturation,
- merge pressure,
- heap pressure,
- search latency impact.

Bulk terlalu kecil:

- overhead request tinggi,
- throughput rendah.

Bulk terlalu besar:

- latency tinggi,
- memory pressure,
- timeout,
- retry mahal,
- partial failure makin besar.

---

## 19. Bulk Concurrency

Selain ukuran batch, concurrency worker menentukan throughput.

```text
throughput = batch_size * batches_per_second * worker_count
```

Tetapi meningkatkan worker count tanpa batas akan merusak cluster.

Tanda concurrency terlalu tinggi:

- bulk thread pool rejection,
- high CPU,
- high IO wait,
- high merge time,
- indexing latency naik,
- search latency ikut naik,
- JVM pressure,
- circuit breaker.

Indexer harus menerapkan backpressure.

```text
If Elasticsearch rejects or slows down:
    reduce concurrency
    slow consumption
    increase backoff
    expose lag metric
```

Jangan menjadikan Elasticsearch sebagai korban dari upstream burst.

---

## 20. Java Bulk Indexing Pattern

Pola Java yang baik biasanya memisahkan:

- event consumption,
- projection loading,
- document building,
- bulk buffering,
- bulk sending,
- per-item response handling,
- retry/dead-letter,
- metrics.

### 20.1 High-Level Structure

```java
public interface SearchDocumentBuilder<E, D> {
    D build(E canonicalState);
}

public interface SearchIndexer<D> {
    void index(String indexName, String documentId, D document);
    void delete(String indexName, String documentId);
    void flush();
}
```

### 20.2 Bulk Item Model

```java
public sealed interface IndexOperation permits IndexDoc, DeleteDoc {
    String indexName();
    String documentId();
}

public record IndexDoc<T>(
        String indexName,
        String documentId,
        T document,
        String sourceEventId,
        long sourceVersion
) implements IndexOperation {}

public record DeleteDoc(
        String indexName,
        String documentId,
        String sourceEventId,
        long sourceVersion
) implements IndexOperation {}
```

### 20.3 Why Include Source Metadata?

Karena saat gagal, Anda perlu tahu:

- event mana yang menyebabkan write,
- source entity apa,
- version berapa,
- index target mana,
- operation type apa,
- apakah retry aman.

Tanpa metadata, incident response menjadi spekulasi.

---

## 21. Java API Client: Conceptual Example

Official Java API Client menyediakan typed request/response untuk Elasticsearch APIs. Untuk indexing, Anda bisa memakai application object yang otomatis dimapping ke JSON atau raw JSON untuk kasus semi-structured.

Contoh konseptual:

```java
BulkRequest.Builder br = new BulkRequest.Builder();

for (CaseSearchDocument doc : documents) {
    br.operations(op -> op.index(idx -> idx
            .index("cases-v3")
            .id(doc.caseId())
            .document(doc)
    ));
}

BulkResponse response = esClient.bulk(br.build());

if (response.errors()) {
    for (BulkResponseItem item : response.items()) {
        if (item.error() != null) {
            // classify error, retry or dead-letter
        }
    }
}
```

Poin penting bukan syntax. Poin pentingnya:

- bulk response harus dicek per item,
- document id harus stable,
- operasi harus idempotent,
- failures harus diklasifikasi,
- request timeout harus dianggap unknown outcome,
- retry harus aman.

---

## 22. Classifying Bulk Failures

Tidak semua error sama.

### 22.1 Retryable Failures

Biasanya retryable:

- timeout,
- 429 too many requests,
- 503 service unavailable,
- transient network issue,
- temporary shard unavailable,
- cluster relocating.

Retry dengan exponential backoff dan jitter.

```text
retry delay = base * 2^attempt + jitter
max attempts = bounded
then DLQ or pause pipeline
```

### 22.2 Non-Retryable Failures

Biasanya tidak retryable tanpa perubahan data/code:

- mapping conflict,
- document parsing exception,
- illegal argument,
- field type mismatch,
- malformed date,
- invalid analyzer config,
- script error.

Ini harus masuk dead-letter dengan payload cukup untuk debugging.

### 22.3 Conflict Failures

Version conflict bisa retryable atau expected tergantung strategy.

Jika event lama kalah oleh version baru, mungkin cukup ignore dengan metric:

```text
ignored_stale_event_count++
```

Jika conflict tidak expected, masukkan ke investigation.

---

## 23. Dead-Letter Queue / Failed Document Store

Production indexing pipeline butuh tempat untuk failures.

DLQ minimal menyimpan:

- event id,
- entity id,
- operation type,
- target index,
- document id,
- source version,
- payload atau payload reference,
- Elasticsearch error type,
- Elasticsearch error reason,
- timestamp,
- retry count,
- worker id,
- correlation id.

Tanpa DLQ, pilihan Anda hanya:

- drop data diam-diam,
- retry selamanya,
- crash pipeline.

Ketiganya buruk.

DLQ harus punya proses operasional:

- dashboard,
- alert threshold,
- replay tool,
- quarantine reason,
- owner,
- SLA.

---

## 24. Ingest Pipeline di Elasticsearch

Elasticsearch ingest pipeline memungkinkan transformasi sebelum indexing.

Contoh transformasi:

- set field,
- remove field,
- rename field,
- convert type,
- date parsing,
- enrich,
- geoip,
- user agent parsing,
- script processor.

Mental model:

```text
client sends document
    -> ingest pipeline processors
    -> final document indexed
```

### 24.1 Kapan Ingest Pipeline Berguna?

Cocok untuk:

- transformasi teknis sederhana,
- log/event ingestion,
- normalisasi field standar,
- enrichment generic,
- parsing timestamp,
- removing sensitive transient fields.

### 24.2 Kapan Jangan Memaksakan Ingest Pipeline?

Kurang cocok untuk:

- domain logic kompleks,
- permission computation rumit,
- join banyak entity,
- lifecycle rules yang harus diuji di application code,
- regulatory-defensible transformation yang butuh versioned code review,
- transformasi yang perlu akses rich domain model.

Untuk Java business application, sering lebih baik domain projection dibangun di application/indexer code, lalu ingest pipeline hanya untuk transformasi ringan.

---

## 25. Enrichment Strategy

Search document sering butuh enrichment.

Contoh:

```text
case event has case_id only
search document needs:
    case title
    parties
    assigned team
    severity label
    SLA state
    visibility groups
    latest decision date
```

Ada beberapa strategi.

### 25.1 Load on Demand from Canonical DB

Worker menerima event, lalu query DB untuk state lengkap.

Kelebihan:

- state current,
- deterministic,
- domain logic jelas.

Kekurangan:

- DB load,
- possible N+1,
- latency.

### 25.2 Maintain Projection Table

Application menyimpan search projection di DB/table khusus.

```text
case_search_projection table
```

Worker hanya membaca projection.

Kelebihan:

- indexer sederhana,
- projection bisa diuji,
- easier reconciliation.

Kekurangan:

- storage tambahan,
- projection update logic tetap harus dijaga.

### 25.3 Use Stream Aggregation

Event stream membangun state materialized untuk search.

Kelebihan:

- scalable,
- event-native,
- bagus untuk high-volume.

Kekurangan:

- complexity tinggi,
- ordering dan replay lebih sulit,
- debugging lebih berat.

### 25.4 Elasticsearch Enrich Processor

Bisa dipakai untuk lookup enrichment tertentu.

Tetapi untuk core domain logic, hati-hati karena governance dan testability bisa lebih sulit dibanding application code.

---

## 26. Backfill

Backfill adalah proses meng-index data lama atau memperbaiki data existing.

Use cases:

- membuat index pertama kali,
- menambahkan field baru,
- memperbaiki analyzer/mapping,
- migration ke index version baru,
- memperbaiki bug projection,
- rebuild setelah incident,
- reprocessing akibat permission model berubah.

Backfill harus dianggap production workflow, bukan script sekali pakai.

### 26.1 Backfill Design

Pipeline backfill yang baik:

```text
read source data in pages
    -> build full search documents
    -> bulk index to target index
    -> track progress checkpoint
    -> verify count/checksum/sample relevance
    -> alias swap or publish
```

### 26.2 Backfill Paging

Jangan gunakan offset pagination untuk source besar jika mahal.

Gunakan:

- keyset pagination,
- primary key range,
- updated_at windows,
- snapshot isolation jika perlu,
- partitioned workers by id range.

Contoh:

```sql
SELECT *
FROM cases
WHERE id > :last_id
ORDER BY id
LIMIT 1000;
```

### 26.3 Backfill Checkpoint

Simpan progress:

```json
{
  "job_id": "reindex-cases-v3-20260621",
  "last_case_id": "CASE-2026-01999",
  "processed": 200000,
  "succeeded": 199980,
  "failed": 20,
  "started_at": "...",
  "updated_at": "..."
}
```

Checkpoint memungkinkan resume setelah crash.

### 26.4 Backfill Isolation

Jangan backfill besar langsung ke index production aktif jika bisa dihindari.

Lebih aman:

```text
cases-v2   <- active alias points here
cases-v3   <- build in background
verify cases-v3
swap alias cases-read -> cases-v3
```

---

## 27. Reindex API vs Application Rebuild

Elasticsearch memiliki Reindex API untuk menyalin dokumen dari satu index ke index lain.

```text
source index -> reindex API -> target index
```

Ini berguna untuk:

- copy data antar index,
- transformasi sederhana dengan script,
- migration yang tidak memerlukan canonical source,
- operational repair tertentu.

Tetapi untuk search document kompleks, reindex dari old index punya risiko:

- old index mungkin sudah stale,
- field lama mungkin salah,
- bug projection ikut terbawa,
- source-of-truth tidak dipakai,
- permission model lama ikut tersalin.

Rule of thumb:

```text
If the old index is merely a physical representation, rebuild from canonical source.
If the old index is the only available source or transformation is mechanical, Reindex API may be acceptable.
```

Untuk regulatory/case-management, rebuilding from canonical source biasanya lebih defensible.

---

## 28. Zero-Downtime Indexing and Alias Strategy

Elasticsearch mapping tidak selalu bisa diubah in-place. Banyak perubahan butuh index baru.

Gunakan versioned index + alias.

```text
cases-v1
cases-v2
cases-v3

cases-read  -> cases-v2
cases-write -> cases-v2
```

Saat migration:

```text
1. create cases-v3 with new mapping/settings
2. backfill cases-v3 from canonical source
3. dual-write or catch-up incremental changes
4. validate cases-v3
5. atomically swap cases-read alias to cases-v3
6. move cases-write alias if appropriate
7. monitor
8. keep cases-v2 for rollback window
```

### 28.1 Read Alias

Application search API membaca alias:

```text
cases-read
```

Bukan membaca physical index:

```text
cases-v3
```

### 28.2 Write Alias

Indexer menulis ke alias:

```text
cases-write
```

Tetapi untuk blue/green rebuild, kadang indexer perlu menulis ke active dan candidate index sekaligus.

### 28.3 Atomic Alias Swap

Alias swap harus atomic supaya search client tidak melihat state campuran.

Konsep:

```json
POST /_aliases
{
  "actions": [
    { "remove": { "index": "cases-v2", "alias": "cases-read" }},
    { "add":    { "index": "cases-v3", "alias": "cases-read" }}
  ]
}
```

---

## 29. Dual-Write During Migration

Saat build index baru, incremental updates tetap masuk.

Ada beberapa strategi.

### 29.1 Stop-the-World

Hentikan writes, backfill, swap, nyalakan lagi.

Jarang cocok untuk production.

### 29.2 Backfill Then Catch-Up

```text
T0: record migration start timestamp/version
T1: backfill all data as of T0-ish
T2: replay changes since T0
T3: verify lag zero
T4: swap alias
```

Ini umum dan aman jika event log tersedia.

### 29.3 Dual-Write Active and Candidate

Indexer menulis setiap change ke index lama dan baru selama migration.

Kelebihan:

- candidate tetap fresh.

Kekurangan:

- code lebih kompleks,
- error handling ganda,
- jika mapping baru berbeda besar, builder perlu multi-version output.

### 29.4 Read Shadowing

Sebelum swap, jalankan query yang sama ke old dan new index lalu bandingkan.

```text
production query -> old index result returned to user
                 -> new index result logged for comparison
```

Ini sangat berguna untuk relevance regression.

---

## 30. Partial Update vs Full Reindex Decision Matrix

| Scenario | Recommended Approach | Reason |
|---|---|---|
| Case title changed | Full document rebuild + index | Search text/highlight/sort may depend on title |
| View counter increment | Partial update or separate analytics store | Small independent numeric field |
| Permission group changed | Full rebuild or targeted permission update with strict tests | Leakage risk high |
| Party renamed | Rebuild all affected documents | Denormalized field likely everywhere |
| Status changed | Full rebuild if ranking/filter/lifecycle/search_text depend on status | Avoid stale derived fields |
| Add new searchable field | New index + backfill | Mapping/analyzer likely needed |
| Fix analyzer | New index + rebuild | Analysis is index-time |
| Delete entity | Delete or soft-delete by policy | Must define visibility semantics |
| Relevance signal recomputed | Bulk update if independent, rebuild if derived from complex state | Depends on coupling |

---

## 31. Handling Deletes and Tombstones in Event Pipelines

Delete propagation needs explicit design.

Example events:

```json
{
  "event_type": "CaseDeleted",
  "case_id": "CASE-123",
  "deleted_at": "2026-06-21T10:00:00Z",
  "reason": "retention_expired"
}
```

Pipeline decision:

```text
if retention_expired:
    physical delete
if closed:
    move/mark archived
if permission_removed:
    update visibility fields
if merged:
    delete old doc and index canonical merged doc
```

Tombstone records are useful because without them:

- consumers may not know delete happened,
- replay may resurrect deleted docs,
- backfill may include records that should be hidden,
- audit trail is incomplete.

---

## 32. Search Index as Projection: Reconciliation

Because Elasticsearch is derived state, you need reconciliation.

Reconciliation asks:

```text
Does the index match canonical source?
```

Checks:

- count by status,
- count by tenant,
- max updated_at,
- missing ids,
- extra ids,
- sample hash comparison,
- stale version comparison,
- permission visibility comparison,
- random document rebuild diff.

### 32.1 Version Field in Document

Store source version:

```json
{
  "case_id": "CASE-123",
  "source_version": 42,
  "indexed_at": "2026-06-21T10:03:22Z"
}
```

Then reconciliation can detect:

```text
DB case version = 43
ES source_version = 42
=> stale document
```

### 32.2 Indexed At

`indexed_at` helps distinguish:

- source updated time,
- time document was indexed,
- indexing lag.

```text
lag = indexed_at - source_updated_at
```

---

## 33. Observability for Indexing Pipeline

Minimum metrics:

- events consumed per second,
- documents indexed per second,
- bulk request rate,
- bulk latency p50/p95/p99,
- bulk item success count,
- bulk item failure count by error type,
- retry count,
- DLQ count,
- indexing lag,
- event consumer lag,
- projection build latency,
- source DB load latency,
- Elasticsearch rejection count,
- refresh/merge pressure indicators,
- search latency during bulk.

Minimum logs:

- batch id,
- index name,
- document id,
- event id,
- source version,
- operation type,
- error type,
- error reason,
- retry attempt,
- correlation id.

Minimum alerts:

- DLQ > 0 for critical index,
- indexing lag exceeds SLA,
- bulk failures spike,
- mapping exceptions occur,
- rejected executions occur,
- candidate index backfill stuck,
- alias mismatch,
- document count mismatch after migration.

---

## 34. Backpressure Design

A healthy indexing pipeline protects both source systems and Elasticsearch.

Backpressure sources:

- Elasticsearch slow/rejecting,
- DB load too high,
- worker CPU saturated,
- event backlog too large,
- mapping errors causing DLQ storm.

Backpressure actions:

- reduce worker concurrency,
- reduce bulk size,
- pause partition/topic consumption,
- increase retry delay,
- shed non-critical indexing,
- isolate backfill from real-time indexing,
- stop migration.

Bad behavior:

```text
Elasticsearch returns 429
    -> indexer retries immediately with same concurrency
    -> cluster gets worse
    -> more 429
    -> total collapse
```

Good behavior:

```text
Elasticsearch returns 429
    -> classify retryable
    -> exponential backoff with jitter
    -> reduce concurrency
    -> expose lag
    -> alert if lag exceeds contract
```

---

## 35. Real-Time Indexing vs Backfill Isolation

Real-time indexing and backfill have different goals.

Real-time:

- low latency,
- freshness,
- small batches,
- event-driven,
- priority high.

Backfill:

- throughput,
- completeness,
- large batches,
- resumability,
- priority controllable.

Do not let backfill starve real-time updates.

Strategies:

- separate worker pools,
- separate queues,
- throttle backfill,
- run backfill during off-peak,
- write candidate index only,
- monitor search latency,
- temporarily adjust refresh/replica for candidate index.

---

## 36. Refresh Interval During Bulk Load

For heavy initial load into a new index, common optimizations include:

- temporarily increasing refresh interval,
- sometimes setting replicas to 0 during initial build if availability is not needed yet,
- restoring replicas before alias swap,
- force merge only when appropriate for mostly-read-only indices.

But do this carefully.

Example conceptual flow:

```text
create cases-v3 with refresh_interval = 30s or -1 for build phase
bulk load documents
restore refresh_interval to normal
set replicas to desired count
wait for green health
validate
swap alias
```

Do not blindly copy this into production without testing because trade-offs depend on deployment model, SLA, data size, and cluster capacity.

---

## 37. Indexing Large Documents

Large documents hurt:

- network payload,
- heap pressure,
- indexing latency,
- merge cost,
- search fetch phase,
- highlight cost,
- snapshot/restore size.

Symptoms:

- bulk latency high,
- fetch phase slow,
- `_source` huge,
- highlighting slow,
- GC pressure,
- disk grows quickly.

Strategies:

- index only searchable fields,
- store metadata and summary, not entire attachment,
- extract text offline,
- chunk long content if retrieval needs passage-level matching,
- keep binary content outside Elasticsearch,
- use canonical storage for full content,
- design separate document types for large evidence/documents.

For regulatory systems:

```text
Case metadata search != evidence full-text search != attachment content retrieval
```

They may need separate indices.

---

## 38. Attachment and File Content Ingestion

Elasticsearch can be part of document content search, but file ingestion needs careful architecture.

Pipeline example:

```text
file uploaded
   -> object storage
   -> text extraction service
   -> OCR if needed
   -> content normalization
   -> chunking if large
   -> index metadata + extracted text
```

Do not put raw PDF/docx bytes into Elasticsearch.

Decide:

- index full text or summary,
- chunk size,
- highlight support,
- permission model,
- retention,
- language detection,
- OCR confidence,
- duplicate detection,
- versioning.

---

## 39. Multi-Tenant Ingestion

Multi-tenant indexing choices:

1. index per tenant,
2. shared index with tenant_id filter,
3. hybrid.

Ingestion implications:

### 39.1 Index Per Tenant

Kelebihan:

- isolation kuat,
- delete tenant mudah,
- per-tenant lifecycle.

Kekurangan:

- shard explosion,
- operational overhead,
- mapping governance sulit jika banyak tenant.

### 39.2 Shared Index

Kelebihan:

- resource efficient,
- easier global search,
- simpler index management.

Kekurangan:

- strict tenant filter wajib,
- data leakage risk,
- noisy tenant bisa memengaruhi semua.

Ingestion harus selalu membawa tenant context:

```json
{
  "tenant_id": "t-001",
  "case_id": "CASE-123"
}
```

Document ID juga harus tenant-aware.

---

## 40. Permission-Aware Indexing

Search permission dapat diterapkan:

- application-side filter,
- document-level security,
- index per permission boundary,
- precomputed visibility fields.

Dari sisi ingestion, Anda perlu menentukan field seperti:

```json
{
  "visibility_users": ["user-1", "user-2"],
  "visibility_groups": ["team-a", "role-investigator"],
  "confidentiality_level": "restricted"
}
```

Risiko:

- group membership berubah lebih sering daripada case,
- permission computed field bisa stale,
- facet counts bisa leak existence,
- autocomplete bisa leak terms dari restricted docs.

Untuk permission-sensitive system, permission changes sering harus diproses dengan priority lebih tinggi daripada content changes.

---

## 41. Indexing Pipeline for Regulatory Case Management

Contoh target architecture:

```text
Case Service / Party Service / Evidence Service / Decision Service
        |
        | domain events via outbox
        v
Search Indexing Orchestrator
        |
        | determines affected search documents
        v
Projection Loader
        |
        | loads canonical state
        v
Search Document Builder
        |
        | deterministic transformation
        v
Bulk Indexer
        |
        | index/delete to versioned alias
        v
Elasticsearch
```

### 41.1 Event to Affected Document Resolution

Tidak semua event mengubah satu dokumen.

```text
CaseTitleChanged(caseId)
    -> affected: case document

PartyNameChanged(partyId)
    -> affected: all case documents involving party

OfficerTeamChanged(officerId)
    -> affected: cases assigned to officer if team is searchable/filterable

ConfidentialityRuleChanged(ruleId)
    -> affected: many documents, maybe full permission rebuild
```

This is where search indexing becomes domain architecture.

### 41.2 Projection Builder Invariant

Builder harus deterministic:

```text
same canonical state + same builder version + same config
=> same search document
```

Jika tidak deterministic, reconciliation dan debugging akan sulit.

### 41.3 Builder Version

Store builder version:

```json
{
  "projection_version": "case-search-v3.4.1"
}
```

Manfaat:

- tahu dokumen dibuat oleh logic versi mana,
- bisa detect stale projection,
- bisa trigger rebuild setelah logic berubah.

---

## 42. Data Quality Gates Before Indexing

Sebelum dokumen masuk Elasticsearch, validasi:

- required fields present,
- field type correct,
- date normalized,
- enum valid,
- tenant present,
- document id stable,
- visibility fields present,
- text length reasonable,
- arrays bounded,
- no forbidden sensitive fields,
- source version present,
- schema version present.

Fail fast lebih baik daripada mapping explosion.

Contoh validator:

```java
public final class CaseSearchDocumentValidator {
    public void validate(CaseSearchDocument doc) {
        requireNonBlank(doc.caseId(), "caseId");
        requireNonBlank(doc.tenantId(), "tenantId");
        requireNonNull(doc.sourceVersion(), "sourceVersion");
        requireTrue(doc.title().length() <= 500, "title too long");
        requireTrue(!doc.visibilityGroups().isEmpty(), "visibility missing");
    }
}
```

---

## 43. Avoiding Mapping Explosion During Ingestion

Mapping explosion terjadi saat terlalu banyak field dibuat dinamis.

Penyebab umum:

- JSON arbitrary masuk apa adanya,
- user-defined metadata dijadikan field top-level,
- dynamic mapping aktif untuk payload tidak terkendali,
- object key berasal dari user input,
- log attributes tak terbatas.

Contoh buruk:

```json
{
  "custom_fields": {
    "user_entered_key_1": "x",
    "another_random_key": "y"
  }
}
```

Jika dynamic object, setiap key bisa menjadi field mapping baru.

Solusi:

- disable dynamic mapping di area tertentu,
- gunakan `flattened` untuk arbitrary key-value,
- whitelist fields,
- normalize custom fields menjadi array key/value,
- validate document before indexing,
- monitor field count.

---

## 44. Indexing and Analyzer Changes

Analyzer bekerja saat index-time untuk field text.

Jika analyzer berubah, dokumen lama tidak otomatis dianalisis ulang.

Karena itu perubahan analyzer biasanya memerlukan:

```text
new index -> backfill/reindex -> alias swap
```

Contoh perubahan yang butuh rebuild:

- tambah synonym index-time,
- ubah tokenizer,
- ubah stemmer,
- ubah n-gram,
- ubah normalizer keyword,
- ubah multi-field.

Jangan mengira update analyzer config akan memperbaiki dokumen lama.

---

## 45. Indexing and Synonym Lifecycle

Synonym bisa dikelola index-time atau search-time tergantung konfigurasi.

Dari sisi ingestion, index-time synonym berimplikasi:

- dokumen harus reindexed jika synonym berubah,
- index size bisa bertambah,
- relevance bisa berubah luas.

Search-time synonym lebih fleksibel untuk update, tetapi punya trade-off query behavior.

Untuk domain regulatory:

```text
AML = anti money laundering
KYC = know your customer
PEP = politically exposed person
SAR = suspicious activity report
```

Synonym governance harus punya:

- owner,
- review process,
- test query set,
- rollout strategy,
- rollback strategy.

---

## 46. Indexing Contract Between Teams

Dalam organisasi besar, search index sering dipakai banyak consumer.

Perlu kontrak:

- field name,
- field type,
- nullability,
- enum values,
- analyzer behavior,
- lifecycle status meaning,
- permission field semantics,
- freshness expectation,
- deprecation policy,
- index alias naming,
- migration process.

Tanpa kontrak, index menjadi shared mutable dumping ground.

Prinsip:

```text
Search index is an API, not an implementation detail.
```

---

## 47. Testing Indexing Pipeline

Testing harus mencakup beberapa level.

### 47.1 Unit Test Document Builder

Input canonical state, output search doc.

```java
@Test
void buildsCaseSearchDocumentWithVisibilityAndSearchText() {
    CaseProjection projection = fixtureCase()
            .withStatus(UNDER_INVESTIGATION)
            .withParty("ABC Capital")
            .withVisibilityGroup("team-market-conduct");

    CaseSearchDocument doc = builder.build(projection);

    assertThat(doc.searchText()).contains("ABC Capital");
    assertThat(doc.visibilityGroups()).contains("team-market-conduct");
    assertThat(doc.status()).isEqualTo("under_investigation");
}
```

### 47.2 Mapping Compatibility Test

Ensure document can be indexed into test Elasticsearch with current mapping.

### 47.3 Analyzer Test

Use `_analyze` or integration test to verify token behavior.

### 47.4 End-to-End Index/Search Test

Index test docs, refresh/wait, search, assert result.

### 47.5 Replay Test

Feed duplicate/out-of-order events and verify final index state.

### 47.6 Migration Test

Build old and new index, compare query behavior.

---

## 48. Integration Test Refresh Strategy

Tests often fail because document is indexed but not searchable yet.

Bad test:

```java
index(doc);
search("abc"); // flaky
```

Better options:

- use `refresh=wait_for`,
- explicitly refresh test index,
- poll until visible with timeout,
- test indexing response separately from search visibility.

Do not copy test refresh behavior into production blindly.

---

## 49. Operational Runbook for Indexing Lag

When users report stale search:

1. Confirm canonical state.
2. Check source event emitted.
3. Check event consumer lag.
4. Check indexing worker logs by entity id/event id.
5. Check DLQ.
6. Check bulk failure metrics.
7. Check document in Elasticsearch by id.
8. Compare `source_version` vs DB version.
9. Check refresh/search visibility.
10. Repair by targeted reindex if needed.

Useful fields in document:

```json
{
  "source_version": 42,
  "source_updated_at": "2026-06-21T09:59:00Z",
  "indexed_at": "2026-06-21T10:00:02Z",
  "projection_version": "case-search-v3.4.1"
}
```

Without these fields, debugging becomes guesswork.

---

## 50. Targeted Reindex Tool

Production teams need internal tools:

```text
reindex case CASE-123
reindex party PARTY-999 affected cases
reindex tenant TENANT-1 active cases
reindex cases updated since 2026-06-01
```

Tool properties:

- permission protected,
- audited,
- rate limited,
- dry-run mode,
- progress report,
- DLQ integration,
- safe retry.

This is not optional in serious systems.

---

## 51. Indexing Anti-Patterns

### 51.1 Treating Elasticsearch as Source of Truth

If canonical DB loses data and Elasticsearch is the only copy, you have a serious architecture problem unless intentionally designed that way.

### 51.2 Random Document IDs

Causes duplicates and impossible repair.

### 51.3 Ignoring Bulk Item Failures

Bulk request success does not mean every item succeeded.

### 51.4 Forcing Refresh on Every Write

Destroys throughput and creates segment/merge pressure.

### 51.5 Partial Update Everything

Creates stale derived fields.

### 51.6 Dynamic Mapping in Production Domain Index

Can cause mapping explosion and type conflicts.

### 51.7 Backfill Against Active Index Without Throttle

Can degrade user search.

### 51.8 No Version Field

Impossible to know whether document is stale.

### 51.9 No DLQ

Failures are either hidden or catastrophic.

### 51.10 No Alias Strategy

Schema evolution becomes downtime or risky manual operation.

---

## 52. Practical Reference Architecture

A robust Java + Elasticsearch ingestion architecture:

```text
                +----------------------+
                | Canonical Database   |
                +----------+-----------+
                           |
                           | transactionally recorded outbox
                           v
                +----------------------+
                | Outbox/Event Stream  |
                +----------+-----------+
                           |
                           v
                +----------------------+
                | Indexing Worker      |
                | - consume events     |
                | - coalesce by id     |
                | - load canonical     |
                | - build projection   |
                | - validate document  |
                +----------+-----------+
                           |
                           v
                +----------------------+
                | Bulk Indexer         |
                | - batch              |
                | - retry              |
                | - classify failures  |
                | - DLQ                |
                +----------+-----------+
                           |
                           v
                +----------------------+
                | Elasticsearch        |
                | cases-write alias    |
                | cases-read alias     |
                +----------------------+
```

Supporting systems:

```text
Metrics + logs + tracing + DLQ dashboard + reindex tool + reconciliation job
```

---

## 53. Minimal Production Checklist

Before declaring indexing pipeline production-ready:

- [ ] document ID stable,
- [ ] full document builder deterministic,
- [ ] source version stored,
- [ ] indexed_at stored,
- [ ] projection version stored,
- [ ] bulk response checked per item,
- [ ] retry/backoff implemented,
- [ ] DLQ implemented,
- [ ] mapping validation tested,
- [ ] dynamic mapping controlled,
- [ ] delete propagation tested,
- [ ] duplicate event tested,
- [ ] out-of-order event tested,
- [ ] reindex tool available,
- [ ] reconciliation job available,
- [ ] alias strategy documented,
- [ ] backfill runbook available,
- [ ] freshness SLA defined,
- [ ] lag dashboard available,
- [ ] permission changes handled safely,
- [ ] rollback strategy exists.

---

## 54. Mental Model Summary

Indexing pipeline harus dipahami sebagai **state projection pipeline**.

```text
Elasticsearch index = derived, query-optimized, eventually consistent projection
```

Karena derived:

- bisa stale,
- bisa rusak,
- harus bisa direbuild,
- harus bisa diverifikasi,
- tidak boleh menjadi satu-satunya source-of-truth tanpa desain eksplisit.

Karena query-optimized:

- shape berbeda dari domain model,
- denormalized,
- analyzer-dependent,
- relevance-dependent,
- permission-aware.

Karena eventually consistent:

- user contract perlu jelas,
- lag perlu diukur,
- retry dan replay wajib,
- read-after-write search tidak boleh diasumsikan.

Karena production:

- bulk failures harus diproses,
- backpressure wajib,
- migration harus zero-downtime,
- repair tool wajib,
- observability wajib.

---

## 55. What Top 1% Engineers Internalize

Engineer biasa bertanya:

```text
Bagaimana cara index document ke Elasticsearch?
```

Engineer kuat bertanya:

```text
Apa canonical source-nya?
Apa document identity-nya?
Apakah transformasinya deterministic?
Apakah pipeline idempotent?
Bagaimana delete dipropagasi?
Bagaimana menangani out-of-order event?
Bagaimana tahu dokumen stale?
Bagaimana replay dilakukan?
Bagaimana bulk partial failure ditangani?
Bagaimana mapping berubah tanpa downtime?
Bagaimana search tetap aman saat permission berubah?
Bagaimana membuktikan index sesuai source-of-truth?
```

Itulah perbedaan antara “bisa pakai Elasticsearch” dan “bisa membangun search platform”.

---

## 56. Bridge to Part 015

Part ini membahas bagaimana data masuk ke Elasticsearch.

Part berikutnya akan membahas tema yang lebih konseptual dan sangat penting:

```text
Consistency, Freshness, and Source-of-Truth Boundaries
```

Kita akan membedah:

- consistency model Elasticsearch,
- read-after-write expectations,
- dual-write problem,
- outbox/event-driven indexing,
- retry/replay/idempotency lebih dalam,
- lag monitoring,
- stale search result handling,
- reconciliation,
- repair strategy,
- user-facing consistency contract.

---

## 57. References

Referensi yang relevan untuk part ini:

- Elastic Docs — Bulk API: multiple index/create/delete/update actions in one request.
- Elastic Docs — Java API Client bulk indexing.
- Elastic Docs — Indexing single documents with Java API Client.
- Elastic Docs — Near real-time search and refresh behavior.
- Elastic Docs — Refresh parameter for Index, Update, Delete, and Bulk APIs.
- Elastic Docs — Update API, partial document update, scripted update, upsert.
- Elastic Docs — Ingest pipelines.
- Elastic Docs — Data streams and ILM concepts.
- Elastic Docs — Index settings, especially refresh interval.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — Pagination, Sorting, and Result Window Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-015.md">Learn Search Engine Database and Elasticsearch Mastery for Java Engineers ➡️</a>
</div>
