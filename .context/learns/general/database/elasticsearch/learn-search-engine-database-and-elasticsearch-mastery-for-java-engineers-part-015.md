# Learn Search Engine Database and Elasticsearch Mastery for Java Engineers

## Part 015 — Consistency, Freshness, and Source-of-Truth Boundaries

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Part: `015`  
> Fokus: memahami batas konsistensi Elasticsearch, freshness search, read-after-write expectation, dual-write problem, outbox/event-driven indexing, replay, lag monitoring, stale result handling, reconciliation, dan data repair.  
> Target pembaca: Java software engineer yang sudah memahami indexing pipeline dari Part 014 dan ingin mendesain search platform yang benar secara sistem, bukan hanya query/index yang terlihat jalan.

---

## 0. Posisi Part Ini Dalam Seri

Part 014 membahas **bagaimana data masuk ke Elasticsearch**: single indexing, bulk indexing, refresh, update, upsert, delete, ingest pipeline, backfill, dan zero-downtime ingestion.

Part 015 membahas pertanyaan yang lebih fundamental:

> Setelah data dikirim ke Elasticsearch, kapan data itu dianggap benar?

Pertanyaan ini terlihat sederhana, tetapi di production ia memecah menjadi banyak pertanyaan konkret:

- Apakah document sudah berhasil ditulis?
- Apakah document sudah direplikasi?
- Apakah document sudah bisa ditemukan oleh search?
- Apakah document yang ditemukan adalah versi terbaru?
- Apakah user boleh melihat document tersebut?
- Apakah delete sudah hilang dari result set?
- Apakah search result boleh stale beberapa detik?
- Jika event indexing gagal, siapa yang memperbaiki?
- Jika canonical database berubah tetapi Elasticsearch belum berubah, apa kontrak ke user?
- Jika Elasticsearch berhasil diupdate tetapi canonical DB gagal commit, apakah search index korup?
- Jika user menekan save lalu langsung search, apa yang harus terjadi?

Bagian ini adalah salah satu part terpenting untuk engineer backend karena Elasticsearch sering gagal bukan akibat query yang salah, tetapi akibat **boundary antara system of record dan search index tidak didefinisikan**.

---

## 1. Core Thesis

Elasticsearch sebaiknya dipahami sebagai:

> **materialized retrieval view** atas data canonical, bukan canonical source-of-truth utama.

Dengan kata lain, Elasticsearch biasanya adalah proyeksi data yang dioptimalkan untuk retrieval:

```text
Canonical domain state
        |
        |  change event / outbox / CDC / scheduled sync
        v
Search document projection
        |
        |  index / update / delete
        v
Elasticsearch index
        |
        |  query / ranking / filtering / facets
        v
Search experience
```

Dalam desain seperti ini:

- canonical database menentukan kebenaran domain,
- Elasticsearch menentukan ketercarian dan ranking,
- indexing pipeline menjaga sinkronisasi,
- monitoring mendeteksi lag dan drift,
- reconciliation memperbaiki perbedaan,
- API contract menjelaskan freshness ke user.

Elasticsearch bukan tidak bisa menyimpan data. Ia jelas menyimpan document. Tetapi **kemampuan menyimpan data tidak otomatis berarti ia cocok menjadi system of record untuk lifecycle bisnis yang transaksional**.

---

## 2. Istilah Penting

Sebelum masuk ke desain, kita perlu membedakan beberapa istilah yang sering tertukar.

### 2.1 Durability

Durability menjawab:

> Apakah write yang sudah acknowledged akan tetap ada meskipun terjadi failure tertentu?

Dalam Elasticsearch, write path melibatkan primary shard dan replica shard. Namun durability bukan sama dengan search visibility.

Sebuah document bisa sudah diterima write API, tetapi belum muncul di search result karena refresh belum terjadi.

### 2.2 Search Visibility

Search visibility menjawab:

> Apakah perubahan document sudah bisa ditemukan oleh search query?

Elasticsearch disebut near-real-time search engine karena document changes tidak langsung terlihat oleh search. Elastic mendokumentasikan bahwa secara default Elasticsearch melakukan periodic refresh setiap 1 detik pada index yang menerima search request dalam 30 detik terakhir; Elastic Cloud Serverless memiliki default refresh interval 5 detik. Refresh membuat perubahan yang sudah di-index menjadi visible untuk search.

### 2.3 Freshness

Freshness menjawab:

> Seberapa baru data yang dilihat user dibanding canonical state?

Freshness bukan hanya masalah refresh interval. Freshness mencakup:

- waktu commit canonical DB,
- waktu event diterbitkan,
- waktu event dikonsumsi,
- waktu document dibangun,
- waktu bulk indexing dikirim,
- waktu indexing selesai,
- waktu refresh terjadi,
- waktu query dieksekusi.

Search freshness adalah end-to-end property, bukan Elasticsearch-only property.

### 2.4 Consistency

Consistency menjawab:

> Apakah beberapa bagian sistem melihat state yang sama?

Dalam search platform, consistency memiliki beberapa level:

- canonical DB consistent terhadap transaksi domain,
- event stream consistent terhadap perubahan domain,
- Elasticsearch consistent terhadap projection terakhir yang berhasil di-index,
- search API consistent terhadap permission dan filter saat query,
- UI consistent terhadap user expectation.

### 2.5 Read-after-write

Read-after-write menjawab:

> Jika user menulis data, apakah user langsung bisa membaca atau mencarinya?

Untuk Elasticsearch, read-after-write via direct GET dan read-after-write via search tidak sama. Search butuh refresh agar perubahan visible ke query. Elastic merekomendasikan memakai `refresh=wait_for` bila workflow aplikasi menulis document lalu langsung menjalankan search yang harus melihat document tersebut, karena opsi ini menunggu periodic refresh alih-alih memaksa refresh eksplisit.

### 2.6 Staleness

Staleness adalah jarak antara canonical truth dan search view.

Contoh:

```text
T0: case status berubah dari OPEN ke CLOSED di PostgreSQL
T1: event CaseClosed dibuat
T2: indexing worker memproses event
T3: Elasticsearch menerima update
T4: refresh membuat update visible
T5: user search dan melihat CLOSED
```

Jika user search di antara T0 dan T5, hasil search bisa stale.

---

## 3. Mental Model: Elasticsearch as Search Projection

Bayangkan Elasticsearch sebagai tabel materialized view, tetapi bukan materialized view SQL yang selalu berada dalam transaksi yang sama dengan source table. Elasticsearch adalah **external materialized view**.

```text
+---------------------+
| Canonical Database  |
| domain truth        |
+----------+----------+
           |
           | committed change
           v
+---------------------+
| Change Capture      |
| outbox / CDC/event  |
+----------+----------+
           |
           | durable event
           v
+---------------------+
| Indexing Worker     |
| build projection    |
+----------+----------+
           |
           | idempotent bulk request
           v
+---------------------+
| Elasticsearch       |
| retrieval view      |
+----------+----------+
           |
           | search query
           v
+---------------------+
| Search API / UI     |
| user experience     |
+---------------------+
```

Setiap panah bisa gagal.

Search engineer yang matang tidak hanya bertanya:

> Query DSL apa yang harus dipakai?

Tetapi juga:

> Kalau panah ketiga gagal selama 3 menit, apa yang dilihat user, bagaimana sistem mendeteksi, dan bagaimana sistem memperbaiki?

---

## 4. Mengapa Elasticsearch Biasanya Bukan Source of Truth

Ada beberapa alasan praktis.

### 4.1 Update Elasticsearch Bukan Domain Transaction

Domain transaction biasanya melibatkan invariants:

- account tidak boleh negatif,
- status transition harus legal,
- assignee harus aktif,
- case tidak boleh closed tanpa final decision,
- approval harus mengikuti delegation rule,
- SLA escalation harus tercatat auditably.

Elasticsearch tidak didesain sebagai mesin utama untuk enforcement invariants semacam ini.

Elasticsearch bagus untuk:

- menemukan document,
- ranking,
- filtering,
- faceting,
- full-text retrieval,
- vector/semantic retrieval,
- log/search analytics.

Canonical domain state sebaiknya tetap berada di storage yang mendukung transactional domain model.

### 4.2 Search Document Biasanya Denormalized

Search document sering menggabungkan banyak entity:

```json
{
  "caseId": "CASE-2026-001",
  "caseTitle": "Potential licensing violation",
  "status": "UNDER_REVIEW",
  "assignee": {
    "id": "u123",
    "name": "Aisha Rahman"
  },
  "parties": [
    { "partyId": "p1", "name": "Acme Finance Ltd" }
  ],
  "allegations": [
    { "type": "MISREPRESENTATION", "severity": 4 }
  ],
  "latestDecisionDate": "2026-06-20",
  "permissionPrincipals": ["role:investigator", "team:licensing"]
}
```

Document ini bukan entity canonical. Ia adalah projection untuk retrieval.

Jika `party.name` berubah, banyak search document mungkin perlu diupdate. Jika `permissionPrincipals` berubah, search result visibility berubah. Jika `status` berubah, ranking dan filtering berubah.

Projection seperti ini harus bisa rebuild.

### 4.3 Search Index Harus Bisa Dibuang dan Dibangun Ulang

Prinsip yang sehat:

> Jika Elasticsearch index hilang, sistem harus bisa membangunnya ulang dari canonical source.

Ini bukan berarti rebuild selalu murah. Rebuild bisa mahal dan butuh strategi. Tetapi secara arsitektur, Elasticsearch index sebaiknya bukan satu-satunya tempat kebenaran domain berada.

### 4.4 Mapping dan Analyzer Bisa Berubah

Begitu mapping/analyzer berubah, sering kali kita perlu reindex. Jika Elasticsearch adalah source of truth, migrasi menjadi jauh lebih berisiko.

Jika Elasticsearch adalah projection, reindex menjadi operasi normal:

```text
source of truth -> build index_v2 -> verify -> alias swap -> retire index_v1
```

### 4.5 Search Ranking Tidak Sama dengan Domain Truth

Ranking bisa berubah karena:

- boost,
- freshness,
- business priority,
- popularity,
- severity,
- field weight,
- analyzer,
- synonym,
- vector model,
- reranker.

Domain truth harus stabil dan auditable. Ranking adalah presentation/retrieval behavior.

---

## 5. Write Acknowledgement vs Search Visibility

Salah satu kebingungan paling umum:

> “Index API sudah 200 OK, kenapa search belum menemukan document?”

Jawabannya: karena write acknowledgment dan search visibility adalah dua hal berbeda.

### 5.1 Simplified Write Path

```text
Client
  |
  | index request
  v
Coordinating node
  |
  | route by _id/routing
  v
Primary shard
  |
  | apply operation
  v
Replica shards
  |
  | replicate operation
  v
Acknowledgement to client
```

Setelah acknowledged, document sudah diproses oleh write path sesuai durability/replication behavior. Namun searcher yang melayani query baru melihat perubahan setelah refresh membuka segment baru untuk search.

### 5.2 Refresh Makes Changes Searchable

Secara sederhana:

```text
Index operation accepted
        |
        v
In-memory indexing buffer / translog path
        |
        v
Refresh
        |
        v
New segment visible to searcher
        |
        v
Search can find document
```

Refresh bukan commit penuh seperti database transaction commit. Refresh adalah operasi yang membuat perubahan terbaru visible ke search.

### 5.3 Practical Consequence

Jika aplikasi melakukan ini:

```text
POST /cases/123/update
immediately call /search?q=case-123
```

Maka search mungkin belum melihat update.

Pilihan desain:

1. Jangan janji immediate search visibility.
2. Gunakan direct read dari canonical DB untuk confirmation page.
3. Gunakan `refresh=wait_for` untuk write yang harus segera searchable.
4. Gunakan explicit refresh hanya untuk test/admin/special workflow karena mahal.
5. Desain UI dengan pending/sync indicator.

---

## 6. Refresh Strategy

Refresh strategy adalah trade-off antara freshness dan throughput.

### 6.1 Default Refresh

Elasticsearch melakukan refresh periodik berdasarkan `index.refresh_interval`. Default self-managed umum adalah 1 detik pada index yang baru saja dicari, sedangkan Elastic Cloud Serverless mendokumentasikan default 5 detik.

Implikasinya:

- search biasanya near-real-time,
- bukan strictly real-time,
- write-heavy workload bisa terbebani jika refresh terlalu sering,
- increasing refresh interval bisa meningkatkan indexing throughput,
- decreasing refresh interval bisa meningkatkan freshness tetapi menambah overhead.

### 6.2 `refresh=true`

`refresh=true` memaksa refresh setelah operation.

Kelebihan:

- perubahan cepat visible.

Kekurangan:

- resource-intensive,
- bisa membuat banyak small segments,
- menambah merge pressure,
- buruk untuk high-throughput indexing,
- sering menjadi sumber latency spike.

Gunakan sangat selektif.

### 6.3 `refresh=wait_for`

`refresh=wait_for` tidak memaksa refresh langsung. Ia menunggu refresh berikutnya yang membuat perubahan visible, lalu request selesai.

Ini biasanya lebih sehat dibanding `refresh=true` untuk workflow read-after-search tertentu.

Contoh use case:

- user membuat case lalu search harus bisa menemukan case tersebut sebelum response final,
- integration test yang harus deterministik,
- admin tool kecil dengan volume rendah,
- workflow manual yang lebih penting correctness daripada throughput.

Jangan pakai sembarangan untuk semua write high-throughput.

### 6.4 Manual Refresh API

Manual refresh bisa berguna untuk:

- test setup,
- controlled batch job,
- admin repair operation,
- low-frequency operational workflow.

Tetapi manual refresh sebagai bagian dari setiap request user adalah red flag.

### 6.5 Refresh Interval Tuning

Strategi umum:

```text
Interactive search index:
  refresh_interval: 1s-5s, tergantung freshness requirement

Bulk backfill index:
  refresh_interval: -1 atau sangat tinggi selama load
  replicas: mungkin 0 sementara, jika acceptable
  setelah selesai: restore setting, refresh, replica, verify

Compliance/regulatory critical search:
  jangan hanya turunkan refresh interval
  definisikan explicit freshness contract dan repair mechanism
```

Catatan: setting agresif harus diputuskan berdasarkan workload dan versi/deployment. Jangan cargo cult.

---

## 7. User-Facing Freshness Contract

Production search perlu freshness contract. Tanpa contract, setiap user akan membawa asumsi sendiri.

Contoh kontrak buruk:

> “Search real-time.”

Ini terlalu kabur dan sering salah.

Contoh kontrak lebih baik:

> “Search results are usually updated within a few seconds after a case change. For newly saved changes, the detail page is authoritative. Search may briefly show the previous version while indexing catches up.”

Untuk regulatory/case management:

> “Search is an indexed view. Case detail is authoritative for final decision state. Search result visibility and status are expected to converge within N seconds under normal operation. Lag beyond threshold triggers operational alert and reconciliation.”

Freshness contract harus menjawab:

- berapa lama staleness normal,
- kapan staleness dianggap incident,
- field mana yang harus paling fresh,
- user flow mana yang butuh read-after-write,
- fallback apa yang dipakai jika index lag,
- apakah UI perlu sync indicator,
- apakah API response perlu menyertakan `indexedAt` / `projectionVersion`.

---

## 8. Consistency Patterns

Ada beberapa pola integrasi canonical DB → Elasticsearch.

---

## 9. Pattern A: Synchronous Dual Write

```text
Request
  |
  v
Write canonical DB
  |
  v
Write Elasticsearch
  |
  v
Return success
```

### 9.1 Kelebihan

- sederhana secara konseptual,
- update search bisa cepat,
- tidak perlu event consumer awalnya.

### 9.2 Masalah Fundamental

Dual write memiliki failure window:

```text
DB commit success
Elasticsearch write fails
```

Hasil:

- canonical DB berubah,
- search index stale.

Atau:

```text
Elasticsearch write success
DB commit fails
```

Hasil:

- search index berisi data yang tidak pernah valid secara domain.

Bahkan jika urutan dibalik, masalah tetap ada.

### 9.3 Kenapa Retry Tidak Cukup

Retry membantu transient failure, tetapi tidak menghilangkan atomicity problem.

Pertanyaan sulit:

- retry berapa lama?
- jika service crash setelah DB commit sebelum ES write?
- jika ES write berhasil tetapi response timeout?
- jika retry mengirim versi lama setelah versi baru?
- jika delete gagal?

### 9.4 Kapan Masih Bisa Dipakai

Synchronous dual write bisa acceptable untuk:

- prototype,
- low criticality search,
- admin tool internal,
- sistem kecil dengan reconciliation periodik,
- write volume rendah dan risiko stale bisa diterima.

Tetapi untuk production serius, gunakan pattern lebih robust.

---

## 10. Pattern B: Transactional Outbox

Transactional outbox adalah pattern umum untuk menghubungkan transaksi domain dengan side effect asynchronous.

```text
Within same DB transaction:
  1. update domain table
  2. insert outbox event

After commit:
  3. outbox publisher/worker reads event
  4. sends to queue/topic or directly processes
  5. indexing worker updates Elasticsearch
```

### 10.1 Mengapa Outbox Kuat

Karena perubahan domain dan pencatatan event berada dalam transaksi yang sama.

```text
BEGIN
  UPDATE cases SET status = 'CLOSED' WHERE id = 'CASE-123';
  INSERT INTO outbox(event_id, aggregate_id, event_type, payload, created_at)
  VALUES (...);
COMMIT
```

Jika commit berhasil, event ada. Jika commit gagal, event tidak ada.

### 10.2 Outbox Table Example

```sql
CREATE TABLE search_outbox (
    event_id          UUID PRIMARY KEY,
    aggregate_type    VARCHAR(100) NOT NULL,
    aggregate_id      VARCHAR(100) NOT NULL,
    event_type        VARCHAR(100) NOT NULL,
    aggregate_version BIGINT NOT NULL,
    payload           JSONB NOT NULL,
    occurred_at       TIMESTAMP NOT NULL,
    available_at      TIMESTAMP NOT NULL,
    processed_at      TIMESTAMP NULL,
    retry_count       INT NOT NULL DEFAULT 0,
    last_error        TEXT NULL
);
```

Walaupun kita tidak mengulang seri SQL/PostgreSQL, penting untuk melihat bentuknya karena pattern ini adalah boundary utama ke Elasticsearch.

### 10.3 Outbox Event Granularity

Ada dua gaya:

#### Domain event

```json
{
  "eventType": "CaseStatusChanged",
  "caseId": "CASE-123",
  "oldStatus": "UNDER_REVIEW",
  "newStatus": "CLOSED",
  "version": 42
}
```

Worker harus mengambil data tambahan untuk membangun search document.

#### Search projection event

```json
{
  "eventType": "CaseSearchDocumentChanged",
  "caseId": "CASE-123",
  "document": {
    "caseId": "CASE-123",
    "status": "CLOSED",
    "title": "..."
  },
  "version": 42
}
```

Event sudah berisi document siap index.

### 10.4 Trade-off Domain Event vs Search Projection Event

| Aspek | Domain Event | Search Projection Event |
|---|---|---|
| Coupling | lebih domain-centric | lebih search-coupled |
| Payload size | kecil | bisa besar |
| Worker complexity | tinggi | rendah |
| Rebuild flexibility | tinggi | tergantung event |
| Schema evolution | butuh projection code | butuh event versioning |
| Debuggability search | indirect | direct |

Untuk sistem kompleks, sering lebih baik event domain tetap domain-centric, lalu indexing worker membangun projection dari read model/canonical DB. Namun untuk high-throughput search update tertentu, projection event bisa efektif.

---

## 11. Pattern C: CDC to Search Index

Change Data Capture atau CDC membaca perubahan dari database log lalu memproyeksikan ke Elasticsearch.

```text
Database commit log
      |
      v
CDC connector
      |
      v
Event stream
      |
      v
Indexing worker
      |
      v
Elasticsearch
```

### 11.1 Kelebihan

- minim perubahan di application code,
- bisa menangkap semua perubahan DB,
- cocok untuk integrasi banyak table,
- bisa replay dari log tertentu,
- bagus untuk legacy system.

### 11.2 Kekurangan

- row-level changes tidak selalu sama dengan domain event,
- sulit memahami intent bisnis,
- join/denormalization bisa kompleks,
- order antar table perlu hati-hati,
- delete/soft delete semantics harus jelas,
- permission update bisa tersebar.

CDC bagus jika Anda tahu cara membangun projection layer di atasnya. CDC langsung ke index tanpa domain semantics sering menghasilkan search index yang rapuh.

---

## 12. Pattern D: Scheduled Sync / Polling

```text
Every N minutes:
  SELECT changed records since last checkpoint
  build search documents
  bulk index to Elasticsearch
```

### 12.1 Kelebihan

- sederhana,
- tidak perlu event infrastructure,
- cocok untuk low freshness requirement,
- mudah dipahami.

### 12.2 Kekurangan

- stale window besar,
- load spike periodik,
- checkpoint harus benar,
- delete handling sering terlewat,
- sulit untuk near-real-time UX.

### 12.3 Kapan Cocok

- internal catalog,
- nightly search index,
- historical archive,
- low criticality search,
- initial implementation sebelum outbox.

---

## 13. Pattern E: Rebuild from Canonical Source

Rebuild bukan hanya recovery tool. Rebuild adalah bagian normal dari lifecycle search.

```text
canonical DB -> projection builder -> new index -> verify -> alias swap
```

Use case:

- mapping berubah,
- analyzer berubah,
- synonym strategy berubah,
- field baru ditambahkan,
- denormalization model berubah,
- ranking feature baru,
- index corrupt/stale terlalu jauh,
- disaster recovery.

Search platform yang matang memiliki kemampuan rebuild yang rutin diuji.

---

## 14. Idempotency

Indexing pipeline harus idempotent.

> Memproses event yang sama lebih dari sekali tidak boleh merusak final state.

### 14.1 Why At-Least-Once Is Normal

Banyak pipeline reliable bekerja dengan at-least-once delivery.

Artinya event bisa diproses lebih dari sekali.

Jika worker crash setelah Elasticsearch menerima write tetapi sebelum offset/outbox ditandai processed, event akan diproses ulang.

### 14.2 Deterministic Document ID

Gunakan deterministic `_id`.

```text
case search document _id = caseId
party search document _id = partyId
case evidence document _id = caseId + ':' + evidenceId
```

Dengan deterministic ID, repeated indexing mengganti document yang sama, bukan membuat duplikat.

### 14.3 Full Replace Lebih Aman dari Patch

Untuk banyak kasus, indexing full search document lebih aman daripada partial update.

```text
Event arrives
  -> load canonical aggregate/read model
  -> build full search document
  -> index document with deterministic id
```

Kelebihan:

- idempotent,
- mudah replay,
- tidak tergantung state lama di Elasticsearch,
- memperbaiki drift secara natural,
- schema evolution lebih mudah.

Kekurangan:

- lebih mahal,
- perlu fetch canonical data,
- payload lebih besar.

### 14.4 Partial Update Risk

Partial update terlihat efisien:

```json
{
  "doc": {
    "status": "CLOSED"
  }
}
```

Namun risk:

- field lain mungkin sudah stale,
- nested array bisa sulit diubah benar,
- delete field bisa terlewat,
- event out-of-order bisa menimpa versi baru,
- projection logic tersebar.

Partial update cocok untuk field sederhana yang benar-benar independen dan memiliki version guard.

---

## 15. Ordering and Versioning

Problem serius berikutnya:

> Apa yang terjadi jika event lama diproses setelah event baru?

Contoh:

```text
T0: Case status UNDER_REVIEW, version 10
T1: status APPROVED, version 11
T2: status CLOSED, version 12

Worker B memproses version 12 lebih dulu
Worker A terlambat memproses version 11 setelahnya
```

Jika tidak ada guard, Elasticsearch bisa kembali ke `APPROVED` padahal canonical state sudah `CLOSED`.

### 15.1 Aggregate Version

Setiap event search harus membawa versi aggregate.

```json
{
  "caseId": "CASE-123",
  "aggregateVersion": 12,
  "eventType": "CaseClosed"
}
```

Search document juga menyimpan versi:

```json
{
  "caseId": "CASE-123",
  "status": "CLOSED",
  "projectionVersion": 12
}
```

### 15.2 Elasticsearch Optimistic Concurrency

Elasticsearch menyediakan optimistic concurrency control dengan sequence number dan primary term untuk mencegah versi lama menimpa versi baru dalam operasi concurrent. Dokumentasi Elastic menjelaskan bahwa Elasticsearch perlu memastikan versi lama document tidak overwrite versi baru karena operasi replikasi berlangsung asynchronous dan bisa tiba out-of-sequence.

Namun untuk event ordering dari source system, sering kali Anda perlu versioning berbasis domain atau source.

### 15.3 External Versioning Concept

External versioning memungkinkan aplikasi memakai versi dari luar Elasticsearch. Secara konsep, document hanya diupdate jika external version yang dikirim lebih tinggi daripada versi yang tersimpan.

Gunakan dengan hati-hati. Pastikan semua write untuk document tersebut konsisten memakai versioning scheme yang sama.

### 15.4 Safer Common Pattern

Pola yang sering lebih mudah dipahami:

1. Event membawa `aggregateVersion`.
2. Worker load canonical state terbaru.
3. Worker build full document dari canonical state.
4. Worker index document dengan `projectionVersion = canonicalVersion`.
5. Untuk out-of-order event lama, worker bisa skip jika canonical state sudah lebih baru atau event version lebih kecil dari last indexed.

Pseudo-code:

```java
void handleCaseChanged(SearchEvent event) {
    CaseView current = caseRepository.loadCaseView(event.caseId());

    if (current.version() < event.aggregateVersion()) {
        throw new RetryLaterException("Canonical view not caught up yet");
    }

    SearchDocument doc = searchDocumentBuilder.from(current);

    elasticsearch.index(i -> i
        .index("cases-write")
        .id(current.caseId())
        .document(doc)
    );
}
```

Dengan pattern ini, event hanya trigger. Kebenaran document berasal dari canonical read.

---

## 16. Delete Propagation

Delete adalah sumber bug search yang sangat umum.

### 16.1 Hard Delete

Canonical entity benar-benar dihapus.

Search harus menghapus document:

```text
DELETE /cases/_doc/CASE-123
```

Masalah:

- delete event harus durable,
- delete harus idempotent,
- delete yang datang sebelum index mungkin harus safe,
- rebuild harus tahu entity sudah tidak ada.

### 16.2 Soft Delete

Canonical entity diberi flag:

```text
deleted = true
```

Pilihan search:

1. Hapus dari Elasticsearch.
2. Tetap index tetapi filter `deleted:false`.
3. Tetap index untuk audit-only index.

Untuk regulatory systems, soft delete sering lebih tepat secara domain karena data historis/audit harus tetap ada, tetapi search result user biasa tidak boleh menampilkan record yang sudah retired/superseded.

### 16.3 Visibility Delete vs Physical Delete

Kadang entity tidak dihapus, tetapi tidak boleh muncul karena permission/lifecycle berubah.

Contoh:

- case sealed,
- evidence restricted,
- party merged,
- decision superseded,
- document under legal hold,
- user removed from team.

Ini bukan delete fisik. Ini visibility change. Search document harus memperbarui field filter/permission.

### 16.4 Tombstone Pattern

Untuk event-driven pipeline, tombstone membantu mencegah resurrection.

```json
{
  "caseId": "CASE-123",
  "deleted": true,
  "deletedAt": "2026-06-21T10:00:00Z",
  "projectionVersion": 99
}
```

Jika event lama datang setelah delete, version guard mencegah document hidup kembali.

---

## 17. Lag Monitoring

Freshness tanpa monitoring hanyalah harapan.

### 17.1 Lag Types

Ada beberapa jenis lag:

```text
Domain commit -> outbox event available
Outbox event available -> event published
Event published -> worker receives
Worker receives -> ES write acknowledged
ES write acknowledged -> refresh visible
Refresh visible -> user query sees result
```

Masing-masing perlu metrik.

### 17.2 Essential Metrics

Minimal:

- outbox oldest unprocessed age,
- outbox unprocessed count,
- event consumer lag,
- indexing worker throughput,
- indexing worker error rate,
- bulk item failure count by reason,
- retry count distribution,
- dead-letter count,
- average indexing latency,
- p95/p99 indexing latency,
- refresh interval / refresh time,
- search document `indexedAt` age,
- reconciliation drift count.

### 17.3 `indexedAt` Field

Setiap search document sebaiknya menyimpan metadata:

```json
{
  "caseId": "CASE-123",
  "status": "UNDER_REVIEW",
  "projectionVersion": 42,
  "sourceUpdatedAt": "2026-06-21T09:58:21Z",
  "indexedAt": "2026-06-21T09:58:24Z",
  "projectionSchemaVersion": 3
}
```

Ini membantu:

- debugging stale result,
- UI freshness indicator,
- reconciliation,
- incident analysis,
- comparing canonical vs search.

### 17.4 Freshness SLO

Contoh SLO:

```text
99% case updates must be visible in search within 10 seconds.
99.9% case permission updates must be visible within 5 seconds.
No outbox event may remain unprocessed for more than 2 minutes without alert.
No dead-letter event may remain unresolved for more than 30 minutes in business hours.
```

Permission freshness sering lebih penting daripada content freshness karena stale permission bisa menjadi data leakage.

---

## 18. Stale Search Result Handling

Stale result bukan hanya backend problem. UI dan API harus tahu cara bersikap.

### 18.1 Search Result Click Revalidation

Pola aman:

```text
User sees result from Elasticsearch
  |
  v
User opens detail page
  |
  v
Backend loads canonical DB and checks permission/status
  |
  v
Detail page shows authoritative state or access denied/not found
```

Search result adalah discovery layer. Detail page adalah authoritative view.

### 18.2 Result-Level Freshness Metadata

API search bisa mengembalikan:

```json
{
  "id": "CASE-123",
  "title": "Potential licensing violation",
  "status": "UNDER_REVIEW",
  "indexedAt": "2026-06-21T09:58:24Z",
  "sourceUpdatedAt": "2026-06-21T09:58:21Z"
}
```

Untuk user biasa, metadata ini mungkin tidak ditampilkan. Untuk admin/investigator/auditor, bisa sangat berguna.

### 18.3 Recently Updated Items

Jika user baru saja mengubah item, UI bisa:

- langsung menampilkan confirmation dari canonical DB,
- menandai “updating search index”,
- memasukkan item ke local optimistic result,
- disable assumption bahwa search langsung authoritative.

### 18.4 Avoid Lying

Jangan menampilkan pesan:

> “No cases found”

jika sistem tahu indexing lag sedang tinggi.

Lebih baik:

> “No cases found. Search index is currently catching up; recently changed cases may take longer to appear.”

Untuk regulatory workflow, transparency lebih baik daripada kesan deterministik palsu.

---

## 19. Reconciliation

Reconciliation adalah proses membandingkan canonical source dan Elasticsearch untuk menemukan drift.

### 19.1 Why Reconciliation Is Necessary

Karena distributed systems gagal dalam cara yang kreatif:

- event hilang karena bug,
- worker crash,
- mapping rejection,
- bulk partial failure,
- poison event,
- manual data fix di DB,
- permission recalculation bug,
- alias menunjuk index salah,
- reindex belum lengkap,
- delete event tidak terkirim,
- source schema berubah.

### 19.2 Reconciliation Types

#### Count reconciliation

```text
DB active cases count = 10,000,000
ES active cases count = 9,999,940
Drift = 60
```

Murah tetapi kasar.

#### Sample reconciliation

Ambil sample canonical IDs, bandingkan document search.

#### Checksum reconciliation

Hitung hash canonical projection dan hash search document.

```text
projection_hash = sha256(normalized_search_document)
```

Search document menyimpan hash:

```json
{
  "caseId": "CASE-123",
  "projectionHash": "abc123..."
}
```

#### Full reconciliation

Scan semua canonical records dan bandingkan ke ES. Mahal, tetapi berguna untuk audit/recovery.

### 19.3 Reconciliation Dimensions

Periksa:

- missing in ES,
- extra in ES,
- stale version,
- wrong status,
- wrong permission principals,
- wrong lifecycle visibility,
- wrong text fields,
- wrong derived ranking signals,
- wrong schema version.

### 19.4 Repair Action

Untuk setiap drift:

```text
Missing in ES        -> index full document
Extra in ES          -> delete or mark hidden
Stale version        -> reindex full document
Wrong permissions    -> reindex permission fields urgently
Wrong schema version -> schedule migration/reindex
```

---

## 20. Dead Letter Queue and Poison Events

Tidak semua indexing failure bisa diselesaikan dengan retry.

### 20.1 Retryable Failures

Contoh:

- temporary network failure,
- Elasticsearch overloaded,
- 429 rejected execution,
- 503 service unavailable,
- timeout ambiguous,
- shard relocation temporary issue.

Gunakan retry dengan exponential backoff dan jitter.

### 20.2 Non-Retryable Failures

Contoh:

- mapping conflict,
- invalid date format,
- field too large karena bug,
- analyzer/mapping tidak mendukung field,
- document violates internal validation,
- index alias missing karena deployment salah.

Retry tanpa perubahan hanya membakar resource.

### 20.3 Poison Event Handling

Pola:

```text
process event
  if success -> mark processed
  if retryable -> retry later
  if non-retryable -> send to DLQ with full context
```

DLQ harus menyimpan:

- event id,
- aggregate id,
- aggregate version,
- event payload,
- error category,
- error message,
- stack trace / root cause,
- first failed at,
- last failed at,
- retry count,
- index name/alias,
- projection schema version.

### 20.4 DLQ Is Not a Trash Bin

DLQ harus punya operational owner dan SLA.

Jika DLQ dibiarkan, search akan diam-diam corrupt.

---

## 21. Ambiguous Write Outcomes

Distributed write bisa menghasilkan ambiguous outcome.

Contoh:

```text
Worker sends index request
Elasticsearch processes request
Network timeout before worker receives response
```

Apakah write berhasil?

Mungkin ya, mungkin tidak.

Solusi:

- use deterministic ID,
- idempotent full document indexing,
- retry safe,
- version guard,
- verify if necessary,
- do not treat timeout as guaranteed failure.

Jika indexing operation idempotent, ambiguous outcome menjadi jauh lebih mudah ditangani.

---

## 22. Permission Freshness Is a Special Case

Permission-related indexing harus diperlakukan lebih ketat daripada content updates.

### 22.1 Content Stale vs Permission Stale

Content stale:

```text
User melihat title lama selama 5 detik.
```

Ini biasanya annoyance.

Permission stale:

```text
User masih bisa menemukan confidential case setelah akses dicabut.
```

Ini bisa menjadi incident keamanan/regulatory.

### 22.2 Strategies

Untuk permission-sensitive systems:

- apply permission filter at query time as much as possible,
- avoid indexing huge static permission snapshots if permission changes often,
- use group/role/team principals instead of user-by-user lists when possible,
- revalidate permission on detail open,
- prioritize permission update events,
- monitor permission projection lag separately,
- consider hard fail/limited result if permission index is stale beyond threshold.

### 22.3 Query-Time Authorization vs Index-Time Authorization

#### Index-time authorization

Search document contains `permissionPrincipals`:

```json
{
  "permissionPrincipals": ["role:investigator", "team:licensing"]
}
```

Query filters by user principals.

Pros:

- fast,
- simple query,
- facet counts respect filter.

Cons:

- permission changes require reindex,
- large principal arrays,
- stale permission risk.

#### Query-time authorization service

Search returns candidates, service checks permissions externally.

Pros:

- fresher permission,
- central policy logic.

Cons:

- can leak counts/facets,
- pagination becomes hard,
- expensive for many candidates,
- ranking can be distorted after filtering.

Often the production answer is hybrid:

- coarse permission filter in Elasticsearch,
- canonical permission revalidation on detail/action,
- urgent reindex for permission topology changes,
- careful handling of facet leakage.

---

## 23. Search API Consistency Contracts

A mature search API does not expose Elasticsearch behavior accidentally. It defines contracts.

### 23.1 Example Search Response Metadata

```json
{
  "queryId": "q-20260621-abc",
  "results": [
    {
      "caseId": "CASE-123",
      "title": "Potential licensing violation",
      "status": "UNDER_REVIEW",
      "sourceUpdatedAt": "2026-06-21T09:58:21Z",
      "indexedAt": "2026-06-21T09:58:24Z"
    }
  ],
  "meta": {
    "searchIndex": "cases-v17",
    "indexFreshnessStatus": "NORMAL",
    "maxObservedLagSeconds": 3,
    "resultConsistency": "NEAR_REAL_TIME"
  }
}
```

Not every field must be public. But internally, this metadata is gold for debugging.

### 23.2 Detail Endpoint Should Be Authoritative

```text
GET /search/cases?q=abc     -> Elasticsearch projection
GET /cases/{id}             -> canonical DB + permission check
POST /cases/{id}/decision   -> canonical transaction
```

Do not let search endpoint become the only way to know domain truth.

### 23.3 Mutating via Search Result

If user performs action from search result:

```text
Search result -> click "Close case"
```

The command handler must load canonical state and validate transition. Never trust search document status as command precondition.

Bad:

```java
if (searchResult.status().equals("UNDER_REVIEW")) {
    closeCase(caseId);
}
```

Good:

```java
CaseAggregate caseAggregate = caseRepository.load(caseId);
caseAggregate.close(command);
caseRepository.save(caseAggregate);
```

Search result is navigation context, not domain authority.

---

## 24. Consistency for Aggregations and Facets

Facets are also subject to staleness.

If status changes from `OPEN` to `CLOSED`, result list and status facet count may temporarily reflect old projection.

This matters when users interpret counts as official numbers.

### 24.1 Search Facet Count Is Not Official Report

For regulatory dashboards:

- search facets are retrieval aids,
- official metrics may come from OLTP/OLAP depending on correctness requirement,
- search count can be near-real-time approximation of searchable set.

Avoid using Elasticsearch search facets as legal/regulatory official counts unless the consistency contract and reconciliation are designed for it.

### 24.2 Facet Leakage

Even if unauthorized documents are not returned, facets can leak existence.

Example:

```text
User cannot see confidential cases,
but facet shows status CONFIDENTIAL: 3.
```

Permission filter must apply before aggregation if counts are user-visible.

---

## 25. Backfill and Live Updates

Backfill while live updates continue is tricky.

### 25.1 Naive Problem

```text
T0: start backfill from DB snapshot
T1: case changes status to CLOSED and live index writes CLOSED
T2: backfill reaches old snapshot row and writes UNDER_REVIEW
```

Backfill overwrites newer live update.

### 25.2 Strategies

#### Stop-the-world

Pause writes, backfill, resume.

Usually unacceptable for production.

#### Version guard

Backfill writes include source version. Newer live updates win.

#### Build new index from consistent snapshot

Build `cases-v2`, then replay changes since snapshot, verify, alias swap.

#### Dual pipeline

During migration:

```text
live updates -> index_v1 and index_v2
backfill     -> index_v2
```

After catch-up and verification, swap alias.

### 25.3 Checkpointing

Backfill needs checkpoint:

- by primary key range,
- by updated_at,
- by database snapshot LSN/SCN equivalent,
- by event offset.

Avoid relying solely on `updated_at` if clock or update semantics are unreliable.

---

## 26. Alias-Based Source Boundary

A healthy Elasticsearch deployment hides physical index names behind aliases.

```text
cases-read  -> cases-v17
cases-write -> cases-v17
```

During migration:

```text
cases-read  -> cases-v17
cases-write -> cases-v17

build cases-v18
verify cases-v18
pause/sync writes or dual-write
swap aliases

cases-read  -> cases-v18
cases-write -> cases-v18
```

This matters for consistency because application code should not accidentally read from one version and write to another unless deliberately designed.

---

## 27. Multi-Index Consistency

Some search platforms split documents across indices:

```text
cases index
parties index
evidence index
decisions index
```

Cross-index consistency becomes harder.

Example:

- case status updated,
- evidence permission updated,
- party name updated,
- decision issued.

A global search result might combine hits from multiple indices. They may not refresh at same time.

Strategies:

- expose per-result index metadata,
- use consistent projection version where possible,
- revalidate detail view,
- avoid presenting cross-index count as exact official total,
- design per-index freshness SLO.

---

## 28. Event Payload Design for Search

Search event should carry enough metadata to handle idempotency, ordering, tracing, and repair.

Example:

```json
{
  "eventId": "4fd2e1d2-23e1-4c1a-a837-5aa6bb8e24e1",
  "eventType": "CaseChanged",
  "aggregateType": "Case",
  "aggregateId": "CASE-123",
  "aggregateVersion": 42,
  "occurredAt": "2026-06-21T09:58:21Z",
  "traceId": "trace-abc",
  "reason": "STATUS_CHANGED",
  "projectionHint": {
    "priority": "HIGH",
    "fieldsLikelyChanged": ["status", "closedAt", "lifecycleVisibility"]
  }
}
```

Important fields:

- `eventId` for deduplication/tracing,
- `aggregateId` for deterministic document ID,
- `aggregateVersion` for ordering,
- `occurredAt` for lag,
- `traceId` for observability,
- `reason` for debugging,
- `projectionHint` optional optimization.

Do not require the worker to infer everything from ambiguous payload.

---

## 29. Java Implementation: Indexing Worker Skeleton

A simplified worker:

```java
public final class CaseSearchIndexer {

    private final CaseReadRepository caseReadRepository;
    private final SearchDocumentBuilder documentBuilder;
    private final ElasticsearchClient elasticsearch;
    private final Clock clock;

    public void handle(SearchOutboxEvent event) {
        try {
            switch (event.eventType()) {
                case "CaseDeleted" -> deleteCase(event);
                default -> indexCase(event);
            }
        } catch (RetryableIndexingException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new NonRetryableOrClassifiedException(event.eventId(), ex);
        }
    }

    private void indexCase(SearchOutboxEvent event) throws IOException {
        CaseSearchView view = caseReadRepository.loadSearchView(event.aggregateId());

        if (view == null) {
            deleteCase(event);
            return;
        }

        if (view.version() < event.aggregateVersion()) {
            throw new RetryableIndexingException("Canonical read model behind event version");
        }

        CaseSearchDocument doc = documentBuilder.build(view, clock.instant());

        elasticsearch.index(req -> req
            .index("cases-write")
            .id(doc.caseId())
            .document(doc)
        );
    }

    private void deleteCase(SearchOutboxEvent event) throws IOException {
        elasticsearch.delete(req -> req
            .index("cases-write")
            .id(event.aggregateId())
        );
    }
}
```

Production version needs:

- retry classification,
- bulk batching,
- per-item bulk failure handling,
- metrics,
- tracing,
- DLQ,
- version guard,
- alias validation,
- mapping contract validation,
- circuit breaker/backpressure.

---

## 30. Java Bulk Worker: Important Failure Detail

Bulk API can return HTTP success while individual items fail.

Pseudo-code:

```java
BulkResponse response = elasticsearch.bulk(b -> {
    for (CaseSearchDocument doc : docs) {
        b.operations(op -> op.index(idx -> idx
            .index("cases-write")
            .id(doc.caseId())
            .document(doc)
        ));
    }
    return b;
});

if (response.errors()) {
    for (BulkResponseItem item : response.items()) {
        if (item.error() != null) {
            classifyAndHandle(item);
        }
    }
}
```

Do not treat bulk response as all-or-nothing.

Common item-level failures:

- mapping exception,
- version conflict,
- document parsing exception,
- rejected execution,
- unavailable shard,
- illegal argument.

Each has different recovery behavior.

---

## 31. Rebuild Strategy as Consistency Tool

A rebuild process should be able to produce index from scratch.

### 31.1 Rebuild Pipeline

```text
1. create new index with target mapping/settings
2. scan canonical records
3. build full search documents
4. bulk index into new index
5. run count/sample/checksum verification
6. replay changes since checkpoint
7. compare lag/drift
8. swap read/write aliases
9. monitor errors
10. retire old index after safety window
```

### 31.2 Rebuild Metadata

Store:

- source snapshot time,
- source checkpoint,
- projection schema version,
- mapping version,
- analyzer version,
- build job id,
- document count,
- verification result.

### 31.3 Rebuild Failure Modes

- canonical scan misses records,
- updated_at checkpoint misses update,
- live update overwritten by backfill,
- alias swap partial failure,
- query incompatible with new mapping,
- analyzer changes relevance unexpectedly,
- permission field not populated,
- old index deleted too early.

---

## 32. Consistency Testing

You cannot prove consistency just by happy-path integration test.

### 32.1 Test Cases

Test at least:

- create then search with normal refresh behavior,
- create then search with `refresh=wait_for`,
- update status then verify eventual search result,
- delete then verify eventual disappearance,
- duplicate event,
- out-of-order event,
- stale event after delete,
- Elasticsearch timeout ambiguous outcome,
- bulk partial failure,
- mapping rejection to DLQ,
- permission revoked then search excluded,
- rebuild while live update happens,
- alias swap rollback,
- canonical DB changed but indexing worker down.

### 32.2 Eventual Assertion Pattern

Because search is near-real-time, tests should often use eventual assertions:

```java
await()
    .atMost(Duration.ofSeconds(10))
    .pollInterval(Duration.ofMillis(200))
    .untilAsserted(() -> {
        SearchResult result = searchClient.search("CASE-123");
        assertThat(result).containsCase("CASE-123", "CLOSED");
    });
```

But do not hide real bugs by using overly generous timeouts.

### 32.3 Deterministic Tests

For unit/integration tests where freshness is not the subject, use controlled refresh strategy:

- `refresh=wait_for`,
- explicit refresh in test fixture,
- test-specific index.

Do not infer production freshness from test refresh behavior.

---

## 33. Regulatory / Case Management Specific Lens

Dalam regulatory case management, consistency punya dimensi tambahan.

### 33.1 Search Result Defensibility

Jika investigator bertanya:

> “Kenapa case ini tidak muncul saat saya search kemarin?”

Sistem idealnya bisa menjawab:

- query apa yang dijalankan,
- index version apa yang dipakai,
- document version apa yang ada saat itu,
- permission principal apa yang diterapkan,
- status/lifecycle saat itu apa,
- apakah indexing lag sedang terjadi,
- apakah document belum masuk index,
- apakah analyzer/ranking membuatnya turun.

### 33.2 Lifecycle State Freshness

Case lifecycle field sering memengaruhi:

- queue assignment,
- escalation,
- SLA,
- visibility,
- reporting,
- audit review.

Stale lifecycle state di search bisa menyebabkan work misrouting.

### 33.3 Permission and Legal Hold

Fields seperti:

- `restricted`,
- `sealed`,
- `legalHold`,
- `confidentialityLevel`,
- `allowedTeams`,
- `allowedRoles`,
- `excludedUsers`,

harus diperlakukan sebagai high-priority projection data.

### 33.4 Search Is Not Audit Log

Elasticsearch bisa membantu pencarian audit data, tetapi audit log canonical harus tetap ada di system yang sesuai. Search index dapat di-rebuild dan berubah ranking/analyzer. Audit trail harus immutable/append-only sesuai kebutuhan domain.

---

## 34. Common Anti-Patterns

### 34.1 “Elasticsearch Sudah 200 OK, Jadi Search Pasti Langsung Ada”

Salah. Search visibility butuh refresh.

### 34.2 “Kita Pakai Dual Write Saja, Simpel”

Simpel sampai terjadi partial failure.

### 34.3 “Kalau Gagal, Retry Infinite”

Retry infinite untuk mapping error tidak memperbaiki apa pun.

### 34.4 “Delete Jarang, Nanti Saja”

Delete/visibility drift adalah sumber data leakage dan bad search.

### 34.5 “Search Index Tidak Perlu Reconciliation”

Tanpa reconciliation, drift tidak terlihat sampai user melapor.

### 34.6 “Facet Count Sama Dengan Official Count”

Facet count adalah count atas searchable projection dengan filter tertentu, bukan otomatis official domain statistic.

### 34.7 “Permission Dicek Setelah Search Saja”

Bisa merusak pagination, ranking, dan membocorkan facet/count.

### 34.8 “Backfill Aman Karena Hanya Membaca DB”

Backfill bisa overwrite live update jika tidak ada version/checkpoint strategy.

### 34.9 “Indexing Worker Error Rate Nol, Jadi Aman”

Mungkin worker tidak memproses event, outbox menumpuk, atau error diam-diam tidak diklasifikasi.

### 34.10 “Refresh Interval Diturunkan Supaya Semua Masalah Freshness Selesai”

Refresh interval hanya satu bagian. Event lag, worker lag, bulk failure, permission projection, dan reconciliation tetap perlu.

---

## 35. Practical Design Checklist

Gunakan checklist ini saat mendesain Elasticsearch sebagai search projection.

### 35.1 Source of Truth

- [ ] Apa canonical source untuk setiap field?
- [ ] Apakah Elasticsearch boleh menjadi authoritative untuk field tertentu?
- [ ] Jika index hilang, apakah bisa rebuild?
- [ ] Apakah detail page membaca canonical DB?

### 35.2 Freshness

- [ ] Apa freshness SLO?
- [ ] Apa staleness normal?
- [ ] Apa threshold incident?
- [ ] Apakah user flow butuh read-after-write search?
- [ ] Apakah `refresh=wait_for` dipakai selektif?

### 35.3 Indexing Pipeline

- [ ] Apakah write pipeline idempotent?
- [ ] Apakah document ID deterministic?
- [ ] Apakah event membawa aggregate version?
- [ ] Apakah duplicate event aman?
- [ ] Apakah out-of-order event aman?
- [ ] Apakah delete event aman?

### 35.4 Failure Handling

- [ ] Apakah bulk item failure diproses per item?
- [ ] Apakah retryable vs non-retryable error dibedakan?
- [ ] Apakah DLQ punya owner dan SLA?
- [ ] Apakah ambiguous timeout safe untuk retry?

### 35.5 Monitoring

- [ ] Outbox lag dimonitor?
- [ ] Consumer lag dimonitor?
- [ ] Indexing latency dimonitor?
- [ ] Bulk failure dimonitor?
- [ ] DLQ dimonitor?
- [ ] Drift reconciliation dimonitor?

### 35.6 Permission

- [ ] Permission filter diterapkan sebelum aggregation?
- [ ] Permission update diprioritaskan?
- [ ] Detail endpoint revalidate permission?
- [ ] Facet leakage dicegah?
- [ ] Permission lag punya SLO lebih ketat?

### 35.7 Rebuild

- [ ] Ada versioned index?
- [ ] Ada alias swap strategy?
- [ ] Ada verification sebelum swap?
- [ ] Ada replay changes sejak snapshot?
- [ ] Ada rollback plan?

---

## 36. Worked Example: Case Status Update

### 36.1 Requirement

Saat case berubah status dari `UNDER_REVIEW` ke `CLOSED`:

- detail page harus langsung menampilkan `CLOSED`,
- search result harus converge dalam 10 detik,
- closed case tidak boleh muncul di queue `UNDER_REVIEW`,
- status facet harus eventually benar,
- audit harus mencatat perubahan,
- stale search lebih dari 2 menit adalah incident.

### 36.2 Flow

```text
1. User submits CloseCase command
2. Case service validates transition in canonical DB transaction
3. Case status updated to CLOSED
4. Audit record inserted
5. Outbox event inserted: CaseStatusChanged(version=42)
6. Transaction commits
7. API returns success based on canonical transaction
8. Outbox worker publishes/processes event
9. Search indexer loads CaseSearchView version 42
10. Builds full search document
11. Bulk indexes into cases-write alias
12. Refresh makes update visible
13. Search query no longer returns case in UNDER_REVIEW queue
14. Metrics record end-to-end lag
```

### 36.3 If Indexing Fails

```text
Elasticsearch unavailable
  -> event retry with backoff
  -> outbox lag increases
  -> alert if threshold exceeded
  -> detail page still correct
  -> search may show stale status
  -> UI/search API may expose freshness warning if lag high
```

### 36.4 If Event Duplicates

```text
same event version=42 processed twice
  -> deterministic id CASE-123
  -> full document replace same final state
  -> no duplicate result
```

### 36.5 If Older Event Arrives Late

```text
version=41 arrives after version=42
  -> worker loads canonical version=42
  -> builds CLOSED document
  -> or skips stale event
  -> no regression to UNDER_REVIEW
```

---

## 37. Worked Example: Permission Revocation

### 37.1 Requirement

User removed from investigation team. They must no longer find restricted cases.

This is stricter than content freshness.

### 37.2 Risk

If search document contains `permissionPrincipals` and those are stale, user may still find cases.

### 37.3 Safer Flow

```text
1. Membership changes in canonical identity/authorization store
2. PermissionChanged event emitted with high priority
3. Search permission projection updated urgently
4. Search API also uses current user principal set at query time
5. Detail endpoint revalidates canonical permission
6. Permission indexing lag monitored separately
```

### 37.4 Emergency Mitigation

If permission projection lag exceeds threshold:

- disable restricted search subset temporarily,
- force stricter canonical permission check,
- hide facets that could leak restricted counts,
- alert security/ops owner,
- run targeted reindex for affected team/principals.

---

## 38. Decision Framework

### 38.1 When Search Can Be Eventually Consistent

Usually acceptable when:

- search is discovery/navigation,
- detail page is authoritative,
- stale content is not dangerous,
- freshness is seconds/minutes,
- user expectation is managed,
- reconciliation exists.

### 38.2 When Search Needs Stronger Freshness

Needed when:

- queue assignment depends on search,
- permission revocation affects visibility,
- compliance workflow depends on result inclusion,
- user just created item and must immediately find it,
- operational triage uses search as worklist.

Even then, prefer targeted stronger guarantees over making every write expensive.

### 38.3 What Stronger Guarantee Means

Not necessarily “Elasticsearch as transaction database”. It can mean:

- `refresh=wait_for` for selected writes,
- canonical DB query for just-created item,
- permission revalidation,
- queue read model separate from search,
- stronger event priority,
- shorter SLO and alerting,
- fallback behavior under lag.

---

## 39. Summary Mental Model

In this part, the key mental model is:

```text
Elasticsearch = searchable projection
Canonical DB  = domain truth
Event/outbox  = synchronization contract
Worker        = projection builder
Refresh       = search visibility boundary
Monitoring    = freshness observability
Reconciliation= drift repair
Detail page   = authoritative read
```

Top-tier Elasticsearch engineering is less about memorizing every Query DSL feature and more about defining boundaries:

- What is true?
- Where is it true?
- When does search catch up?
- What happens when it does not?
- How is drift detected?
- How is drift repaired?
- What can user safely infer from search result?
- What must be validated against canonical state?

Jika pertanyaan ini tidak dijawab, Elasticsearch akan terlihat berhasil di demo tetapi rapuh di production.

---

## 40. Key Takeaways

1. Elasticsearch biasanya adalah **materialized retrieval view**, bukan canonical source-of-truth.
2. Write acknowledgement tidak sama dengan search visibility.
3. Refresh membuat perubahan visible untuk search, tetapi refresh terlalu sering menambah biaya.
4. `refresh=wait_for` berguna untuk workflow read-after-search tertentu, lebih sehat daripada memaksa refresh eksplisit dalam banyak kasus.
5. Synchronous dual write sederhana tetapi memiliki failure window fundamental.
6. Transactional outbox adalah pattern kuat untuk menghubungkan domain transaction dan indexing asynchronous.
7. Indexing pipeline harus idempotent, deterministic, version-aware, dan replayable.
8. Delete dan permission change harus diperlakukan serius karena drift dapat menyebabkan data leakage.
9. Freshness harus punya SLO, metric, alert, dan user-facing contract.
10. Reconciliation dan repair bukan fitur tambahan; mereka bagian dari arsitektur search production.
11. Search result sebaiknya dipakai untuk discovery; detail/action harus revalidate canonical state.
12. Backfill dan rebuild harus aman terhadap live updates.

---

## 41. Latihan Praktis

### Latihan 1 — Freshness Contract

Ambil satu search use case di sistem Anda. Definisikan:

- normal freshness expectation,
- maximum acceptable lag,
- incident threshold,
- field yang paling critical,
- UI behavior saat lag tinggi,
- endpoint yang authoritative.

### Latihan 2 — Event Design

Desain event untuk `CaseChanged` yang membawa:

- event id,
- aggregate id,
- aggregate version,
- occurred at,
- reason,
- trace id,
- projection hint.

Jelaskan mana field wajib dan mana opsional.

### Latihan 3 — Out-of-Order Scenario

Buat sequence:

```text
version 10 -> version 11 -> version 12
```

Lalu proses event dalam urutan:

```text
12, 10, 11
```

Tulis strategi agar Elasticsearch tetap berisi version 12.

### Latihan 4 — Delete Propagation

Untuk entity `EvidenceDocument`, tentukan:

- kapan hard delete,
- kapan soft delete,
- kapan visibility-only update,
- bagaimana mencegah resurrection dari stale event.

### Latihan 5 — Reconciliation Design

Desain reconciliation job untuk `cases` index:

- count check,
- sample check,
- checksum check,
- repair action,
- metric/alert.

---

## 42. Referensi Resmi

- Elastic Docs — Near real-time search
- Elastic Docs — Refresh parameter
- Elastic Docs — Refresh API
- Elastic Docs — Optimistic concurrency control
- Elastic Docs — Bulk API
- Elastic Docs — Index basics
- Elastic Docs — Create/index document APIs

---

## 43. Apa Berikutnya

Part berikutnya:

```text
Part 016 — Java Integration Mastery
```

Kita akan masuk ke integrasi Java secara lebih konkret:

- official Elasticsearch Java API Client,
- client lifecycle,
- connection management,
- typed request/response,
- query builder abstraction,
- bulk processor design,
- timeout/retry/backoff,
- error handling,
- observability,
- testing,
- Spring Boot considerations,
- dan cara menghindari query DSL string concatenation yang rapuh.

---

## Status Seri

Seri belum selesai. Ini adalah Part 015 dari total 035 part.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-014.md">⬅️ Learn Search Engine Database and Elasticsearch Mastery for Java Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-016.md">Part 016 — Java Integration Mastery ➡️</a>
</div>
