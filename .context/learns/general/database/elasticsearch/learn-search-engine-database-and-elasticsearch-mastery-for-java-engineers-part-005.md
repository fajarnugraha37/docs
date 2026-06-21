# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-005

# Part 005 — Document Modeling for Search

> Series: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Audience: Java software engineer / tech lead  
> Focus: search-oriented document modeling, retrieval units, denormalization, nested/object/flattened, lifecycle, authorization, and schema evolution  
> Status: Part 005 of 034

---

## 0. Why this part matters

Di seri SQL, PostgreSQL, MySQL, MongoDB, ClickHouse, Redis, Kafka, RabbitMQ, dan ScyllaDB, Anda sudah mempelajari berbagai bentuk penyimpanan data, transaksi, analytical storage, cache, event streaming, dan wide-column access pattern.

Di Elasticsearch, pertanyaan modeling-nya berbeda.

Di OLTP database, kita sering bertanya:

> Bagaimana menyimpan fakta domain secara benar, konsisten, dan dapat dimutasi dengan aman?

Di Elasticsearch, pertanyaan modeling-nya lebih dekat ke:

> Dokumen seperti apa yang harus ada di index agar query user bisa dijawab cepat, relevan, aman, dan dapat dijelaskan?

Itu pergeseran besar.

Elasticsearch bukan hanya “MongoDB dengan search”. Ia adalah **retrieval engine**. Dokumen yang Anda index bukan selalu sama dengan entity canonical di database utama. Sering kali dokumen Elasticsearch adalah **search projection**: representasi khusus yang sengaja dibentuk untuk kebutuhan pencarian, ranking, filtering, faceting, highlighting, security trimming, dan pagination.

Part ini adalah fondasi desain search document. Tanpa modeling yang benar, query DSL, analyzer, scoring, performance tuning, dan scaling tidak akan menyelamatkan sistem. Banyak masalah Elasticsearch di production bukan berasal dari cluster yang kurang besar, tetapi dari dokumen yang salah bentuk.

---

## 1. Core mental model

### 1.1 Entity model vs retrieval model

Dalam domain application, entity model biasanya merepresentasikan realitas bisnis.

Contoh regulatory case management:

- `Case`
- `Party`
- `Allegation`
- `EvidenceDocument`
- `InvestigationAction`
- `Decision`
- `EnforcementOrder`
- `Officer`
- `Organization`
- `Appeal`

Di database OLTP, model seperti ini masuk akal karena kita ingin:

- menjaga integritas referensial,
- menghindari duplikasi yang tidak perlu,
- memudahkan update granular,
- mengekspresikan relationship,
- menjaga transaksi,
- mempertahankan audit trail canonical.

Tetapi search user biasanya tidak berpikir dalam normalized entity graph.

User mungkin berpikir:

- “Cari semua case aktif tentang fraud di wilayah Jakarta yang melibatkan perusahaan X.”
- “Cari evidence document yang menyebut nomor izin tertentu.”
- “Cari enforcement action yang mirip dengan kasus ini.”
- “Cari case yang sudah melewati SLA dan punya allegation severity tinggi.”
- “Cari pihak yang pernah muncul di beberapa case dengan pattern pelanggaran serupa.”

Search document harus dibentuk dari sudut pandang pertanyaan-pertanyaan itu.

Prinsip utamanya:

> Elasticsearch document adalah unit yang ingin Anda temukan, tampilkan, filter, rank, dan otorisasi dalam satu operasi search.

Kalau unit itu salah, seluruh search experience akan terasa salah.

---

## 2. Retrieval unit: keputusan modeling paling penting

### 2.1 Apa itu retrieval unit?

Retrieval unit adalah “benda” yang dikembalikan sebagai search result.

Contoh:

- Jika user mencari **case**, retrieval unit adalah `CaseSearchDocument`.
- Jika user mencari **evidence document**, retrieval unit adalah `EvidenceSearchDocument`.
- Jika user mencari **person/entity**, retrieval unit adalah `PartySearchDocument`.
- Jika user mencari **paragraph hukum**, retrieval unit bisa berupa `LegalPassageSearchDocument`.
- Jika user mencari **chat/email/message**, retrieval unit bisa berupa `MessageSearchDocument`.
- Jika user mencari **case timeline event**, retrieval unit bisa berupa `CaseEventSearchDocument`.

Kesalahan umum: menjadikan satu index sebagai dumping ground seluruh entity domain lalu berharap query bisa menyelesaikan semuanya.

Search modeling harus dimulai dari pertanyaan:

1. Result yang muncul di UI berupa apa?
2. User akan klik apa?
3. Snippet/highlight berasal dari field apa?
4. Filter/facet apa yang perlu tersedia?
5. Sorting apa yang legal dan masuk akal?
6. Permission dicek di level apa?
7. Apakah result harus merepresentasikan current state atau historical state?
8. Apakah satu domain entity bisa menghasilkan beberapa search document?
9. Apakah beberapa domain entity perlu digabung menjadi satu search document?

### 2.2 Satu entity bisa menjadi banyak search document

Canonical entity tidak harus 1:1 dengan search document.

Contoh: satu `Case` bisa menghasilkan beberapa index projection:

```text
Case canonical entity
    -> case_search_v1             untuk search case utama
    -> case_timeline_search_v1    untuk search event/timeline
    -> case_party_search_v1       untuk search pihak terkait
    -> case_evidence_search_v1    untuk search dokumen bukti
    -> case_audit_search_v1       untuk audit/internal search
```

Ini bukan overengineering jika user journey-nya memang berbeda.

Yang buruk adalah memaksa satu dokumen super besar untuk semua kebutuhan.

### 2.3 Banyak entity bisa menjadi satu search document

Sebaliknya, satu search document sering berisi data dari banyak entity.

Contoh `CaseSearchDocument`:

```json
{
  "case_id": "CASE-2026-000123",
  "case_title": "Alleged licensing fraud by PT Example",
  "case_status": "UNDER_INVESTIGATION",
  "severity": "HIGH",
  "opened_at": "2026-04-12T10:15:00Z",
  "assigned_team": "Financial Enforcement",
  "primary_party_name": "PT Example Indonesia",
  "party_names": ["PT Example Indonesia", "John Doe", "Jane Smith"],
  "allegation_types": ["LICENSING_FRAUD", "FALSE_REPORTING"],
  "evidence_titles": ["Initial report", "License application", "Bank statement"],
  "jurisdiction_codes": ["ID-JK", "ID-BT"],
  "visible_to_roles": ["INVESTIGATOR", "SUPERVISOR"],
  "tenant_id": "regulator-a"
}
```

Ini bukan canonical truth. Ini adalah search projection.

---

## 3. Search projection, not canonical model

### 3.1 Apa itu search projection?

Search projection adalah read model yang dibangun khusus untuk Elasticsearch.

Ia boleh:

- menduplikasi data,
- mengubah struktur,
- menormalisasi string,
- menambahkan field turunan,
- menambahkan signal ranking,
- menyimpan field permission,
- menyimpan label status yang mudah difilter,
- menyimpan summary/highlight source,
- menyimpan metadata untuk UI,
- menggabungkan data dari beberapa table/entity.

Ia tidak boleh diperlakukan sebagai:

- sumber kebenaran utama,
- tempat mutasi workflow utama,
- pengganti transaksi domain,
- tempat enforcing invariant domain utama,
- authoritative audit ledger.

### 3.2 Canonical write model vs search read model

Mental model yang lebih aman:

```text
User command
    -> Application service
        -> OLTP database / canonical store
            -> outbox/event/change stream
                -> indexing worker
                    -> Elasticsearch search projection
                        -> Search API
                            -> UI result
```

Search projection boleh lag. Karena itu sistem harus punya kontrak freshness.

Contoh kontrak yang realistis:

- “Search results are usually updated within a few seconds.”
- “Case detail page always reads from canonical store.”
- “Search page may show stale status briefly, but clicking result loads authoritative state.”
- “Permission filtering is enforced in search and rechecked on detail access.”

### 3.3 Why not use Elasticsearch as source of truth?

Bisa saja Elasticsearch menyimpan document dan melakukan update, tetapi untuk sistem bisnis kritikal, terutama yang punya enforcement lifecycle, audit, SLA, approval, evidence, dan permission kompleks, Elasticsearch biasanya buruk sebagai canonical source karena:

- update document adalah replace/reindex secara internal,
- relational invariant tidak natural,
- transaction boundary terbatas,
- schema evolution mapping lebih kaku,
- relevance-oriented denormalization akan mencemari domain model,
- recovery sering lebih baik dari canonical store + replay,
- search freshness bukan transactional visibility.

Aturan praktis:

> Canonical store menyimpan kebenaran. Elasticsearch menyimpan bentuk yang paling mudah ditemukan.

---

## 4. Designing from queries backward

Document modeling di Elasticsearch harus dimulai dari query behavior, bukan dari table/entity diagram.

### 4.1 Template pertanyaan desain

Untuk setiap search feature, jawab pertanyaan ini:

```text
1. Siapa user-nya?
2. Apa yang mereka cari?
3. Result unit-nya apa?
4. Field apa yang dicari full-text?
5. Field apa yang difilter exact?
6. Field apa yang dipakai sorting?
7. Field apa yang dipakai facet/aggregation?
8. Field apa yang dipakai ranking?
9. Field apa yang harus di-highlight?
10. Field apa yang harus disembunyikan?
11. Permission berlaku di level apa?
12. Seberapa fresh data harus terlihat?
13. Seberapa besar volume dan growth-nya?
14. Bagaimana document berubah ketika domain entity berubah?
15. Bagaimana migration dilakukan saat mapping berubah?
```

### 4.2 Example: case search

Search behavior:

- User mencari case berdasarkan title, summary, allegation, party name, evidence title.
- User filter berdasarkan status, severity, jurisdiction, assigned team, date range, SLA state.
- User sort berdasarkan relevance, opened date, due date, severity.
- User hanya boleh melihat case sesuai role, team, tenant, confidentiality level.
- Result card menampilkan case number, title, primary party, status, severity, SLA, snippet.

Search document bisa:

```json
{
  "case_id": "CASE-2026-000123",
  "case_number": "CASE-2026-000123",
  "title": "Alleged licensing fraud by PT Example",
  "summary": "Investigation into suspected false licensing declarations...",
  "search_text": "CASE-2026-000123 Alleged licensing fraud PT Example false licensing declarations...",
  "status": "UNDER_INVESTIGATION",
  "status_group": "ACTIVE",
  "severity": "HIGH",
  "severity_rank": 80,
  "opened_at": "2026-04-12T10:15:00Z",
  "due_at": "2026-07-12T00:00:00Z",
  "sla_state": "AT_RISK",
  "jurisdiction_codes": ["ID-JK"],
  "assigned_team_id": "TEAM-FIN-ENF",
  "assigned_team_name": "Financial Enforcement",
  "primary_party_name": "PT Example Indonesia",
  "party_names": ["PT Example Indonesia", "John Doe"],
  "party_identifiers": ["TAX-123", "LICENSE-456"],
  "allegation_types": ["LICENSING_FRAUD", "FALSE_REPORTING"],
  "evidence_titles": ["Initial report", "License application"],
  "visibility": {
    "tenant_id": "regulator-a",
    "role_codes": ["INVESTIGATOR", "SUPERVISOR"],
    "team_ids": ["TEAM-FIN-ENF"],
    "confidentiality_level": 2
  },
  "ranking": {
    "priority_score": 0.91,
    "freshness_score": 0.72,
    "case_quality_score": 0.84
  },
  "updated_at": "2026-05-20T08:00:00Z"
}
```

Perhatikan: `search_text`, `status_group`, `severity_rank`, `sla_state`, dan `ranking.*` mungkin bukan field canonical. Mereka adalah field search-oriented.

---

## 5. Denormalization is normal in Elasticsearch

### 5.1 Mengapa denormalisasi penting

Search engine bekerja sangat baik ketika informasi yang dibutuhkan query tersedia di dokumen yang sama atau di index yang dapat dicari langsung.

SQL join bagus untuk transactional/relational queries. Elasticsearch tidak dirancang sebagai relational join engine. Ada fitur nested dan parent-child, tetapi keduanya bukan pengganti arbitrary joins.

Dalam banyak kasus, denormalisasi adalah pilihan yang benar.

Contoh: daripada menyimpan `case_id` lalu join ke parties saat search, masukkan nama party yang searchable ke `CaseSearchDocument`.

```json
{
  "case_id": "CASE-1",
  "title": "Unauthorized activity investigation",
  "party_names": ["PT Alpha", "John Doe", "Jane Smith"]
}
```

Dengan ini query `John Doe unauthorized` bisa langsung menemukan case.

### 5.2 Trade-off denormalisasi

Denormalisasi memberi:

- query lebih cepat,
- model query lebih sederhana,
- fewer distributed relationship operations,
- relevance lebih mudah dikontrol,
- UI result card bisa dirender tanpa banyak call tambahan.

Tetapi biayanya:

- data duplicate,
- update fan-out,
- indexing pipeline lebih kompleks,
- stale projection mungkin terjadi,
- conflict/versioning perlu dikelola,
- migration lebih berat.

Top-tier engineer tidak bertanya “denormalisasi buruk atau tidak?”

Pertanyaan yang lebih tepat:

> Apakah biaya duplikasi dan update fan-out lebih kecil daripada biaya query-time relationship resolution?

Dalam search system, jawabannya sering “ya”.

### 5.3 Denormalization strategy

Ada beberapa level denormalisasi.

#### Level 1 — Copy display fields

Contoh:

```json
{
  "case_id": "CASE-1",
  "primary_party_id": "PARTY-1",
  "primary_party_name": "PT Alpha"
}
```

Tujuan: result card bisa tampil tanpa lookup tambahan.

#### Level 2 — Copy searchable fields

```json
{
  "case_id": "CASE-1",
  "party_names": ["PT Alpha", "John Doe"],
  "party_identifiers": ["TAX-123", "LICENSE-999"]
}
```

Tujuan: case bisa ditemukan via related entity.

#### Level 3 — Copy filter/ranking fields

```json
{
  "case_id": "CASE-1",
  "party_risk_tiers": ["HIGH", "MEDIUM"],
  "max_party_risk_score": 0.87
}
```

Tujuan: filtering/ranking by related entity.

#### Level 4 — Precompute search-specific summary

```json
{
  "case_id": "CASE-1",
  "search_summary": "High-risk licensing case involving PT Alpha and repeated false reporting pattern."
}
```

Tujuan: relevance dan snippet lebih baik.

#### Level 5 — Multiple projection documents

```text
case_search_v1
party_search_v1
case_evidence_search_v1
```

Tujuan: user journey berbeda punya retrieval unit berbeda.

---

## 6. Object vs nested vs flattened vs join

Elasticsearch punya beberapa cara merepresentasikan structured data. Pilihan ini sangat menentukan correctness dan performance.

Elastic mendokumentasikan bahwa `nested` adalah versi khusus dari `object` yang membuat array of objects dapat di-query secara independen; `join` field membuat relasi parent/child di index yang sama; dan field type seperti `text`/`keyword`/lainnya menentukan penggunaan field untuk full-text, filtering, sorting, dan sebagainya. Lihat referensi resmi Elastic untuk `nested`, `join`, dan field data types.

### 6.1 Plain object

Contoh:

```json
{
  "case_id": "CASE-1",
  "primary_party": {
    "name": "PT Alpha",
    "identifier": "TAX-123",
    "risk_tier": "HIGH"
  }
}
```

Plain object cocok ketika:

- object tunggal,
- tidak perlu mempertahankan pasangan antar field dalam array,
- query terhadap subfield sederhana,
- struktur relatif stabil.

Object tunggal seperti `primary_party` biasanya aman.

Masalah muncul pada array of objects.

### 6.2 Array of objects with plain object: hidden trap

Misal:

```json
{
  "case_id": "CASE-1",
  "parties": [
    { "name": "John Doe", "role": "Director" },
    { "name": "Jane Smith", "role": "Witness" }
  ]
}
```

Jika `parties` dipetakan sebagai plain object, Elasticsearch secara konseptual men-flatten field menjadi kira-kira:

```json
{
  "parties.name": ["John Doe", "Jane Smith"],
  "parties.role": ["Director", "Witness"]
}
```

Query untuk:

```text
parties.name = Jane Smith AND parties.role = Director
```

bisa match dokumen tersebut walaupun Jane Smith bukan Director.

Ini disebut cross-object match.

Jika relasi antar field dalam setiap element array penting, plain object salah.

### 6.3 Nested

Nested menyelesaikan masalah cross-object match dengan mengindex nested object sehingga dapat di-query sebagai unit terpisah namun tetap mengembalikan root document.

Contoh mapping konseptual:

```json
{
  "mappings": {
    "properties": {
      "parties": {
        "type": "nested",
        "properties": {
          "name": { "type": "text" },
          "role": { "type": "keyword" },
          "risk_tier": { "type": "keyword" }
        }
      }
    }
  }
}
```

Query konseptual:

```json
{
  "query": {
    "nested": {
      "path": "parties",
      "query": {
        "bool": {
          "must": [
            { "match": { "parties.name": "Jane Smith" } },
            { "term": { "parties.role": "Director" } }
          ]
        }
      }
    }
  }
}
```

Nested cocok ketika:

- Anda punya array of objects,
- field correlation di dalam setiap object harus benar,
- jumlah nested object per root relatif terkendali,
- update nested tidak terlalu sering,
- query correctness lebih penting daripada model sederhana.

Nested tidak gratis.

Biayanya:

- nested object secara internal menambah dokumen Lucene,
- query lebih mahal daripada field biasa,
- update satu nested child berarti root document perlu direindex,
- terlalu banyak nested object bisa memperbesar index dan query cost,
- aggregations nested lebih kompleks.

Aturan praktis:

> Gunakan nested hanya ketika korelasi antar field dalam array memang dibutuhkan oleh query.

Jangan gunakan nested hanya karena JSON Anda punya array.

### 6.4 Flattened

`flattened` cocok untuk object dengan key-value dinamis atau tidak terprediksi.

Contoh:

```json
{
  "case_id": "CASE-1",
  "attributes": {
    "legacy_system_code": "ABC",
    "external_flag_913": "true",
    "migration_batch": "2026-05",
    "source_department": "Licensing"
  }
}
```

Jika semua key dinamis dibuat mapping field biasa, bisa terjadi field explosion.

Dengan `flattened`, satu object dapat diindex sebagai satu field flattened sehingga mapping tidak membesar tak terkendali.

Cocok untuk:

- arbitrary metadata,
- labels/tags dari external source,
- low-governance key-value bag,
- filter sederhana berbasis exact-ish value,
- menghindari mapping explosion.

Tidak cocok untuk:

- numeric range yang perlu benar,
- date range query yang perlu typed semantics,
- full-text relevance advanced,
- nested object correlation,
- field-specific analyzer,
- strict schema governance.

Aturan praktis:

> Gunakan flattened untuk metadata dinamis yang tidak layak menjadi first-class searchable field.

Jika field penting untuk filter, sort, range, ranking, atau relevance, jadikan field typed eksplisit.

### 6.5 Join / parent-child

Elasticsearch memiliki `join` field untuk relasi parent-child dalam index yang sama. Namun ini harus dipakai sangat selektif.

Cocok ketika:

- child sangat banyak dibanding parent,
- child sering berubah,
- Anda tidak ingin reindex parent besar setiap child berubah,
- query relasi benar-benar diperlukan,
- data tetap dalam index yang sama,
- Anda siap membayar query complexity dan routing constraint.

Contoh domain:

```text
Product parent -> Offer child
Question parent -> Answer child
Case parent -> very large number of mutable activity events child
```

Tetapi untuk search application umum, parent-child sering menjadi sinyal bahwa Anda mencoba membawa relational modeling ke search engine.

Biaya join:

- query lebih mahal,
- routing harus benar,
- operational complexity naik,
- relevance dan aggregation lebih rumit,
- tidak cocok untuk arbitrary graph traversal.

Aturan praktis:

> Jangan mulai dari join. Mulai dari denormalized document. Gunakan join hanya ketika update fan-out atau child cardinality membuat denormalisasi tidak realistis.

---

## 7. Modeling relationship patterns

### 7.1 One-to-one

Contoh:

```text
Case -> CurrentSlaState
```

Biasanya embed langsung.

```json
{
  "case_id": "CASE-1",
  "sla_state": "AT_RISK",
  "sla_due_at": "2026-07-01T00:00:00Z"
}
```

Ini mudah difilter dan dirank.

### 7.2 One-to-few

Contoh:

```text
Case -> Allegations
Case -> Parties
Case -> Jurisdictions
```

Pilihan:

- array field sederhana jika hanya butuh membership,
- nested jika butuh korelasi antar property,
- duplicate summary fields untuk search/ranking.

Jika hanya cari case dengan allegation type tertentu:

```json
{
  "allegation_types": ["FRAUD", "FALSE_REPORTING"]
}
```

Jika perlu cari allegation dengan `type=FRAUD` dan `severity=HIGH` pada allegation yang sama:

```json
{
  "allegations": [
    { "type": "FRAUD", "severity": "HIGH" },
    { "type": "REPORTING", "severity": "LOW" }
  ]
}
```

Gunakan nested.

### 7.3 One-to-many

Contoh:

```text
Case -> EvidenceDocuments
Case -> TimelineEvents
Case -> Comments
```

Jangan otomatis embed semua.

Pertimbangkan:

- apakah user mencari case atau evidence?
- apakah evidence text panjang?
- apakah event sering berubah?
- apakah setiap child harus bisa muncul sebagai result sendiri?
- apakah permission child berbeda dari parent?
- apakah highlighting perlu tepat di child?

Jika evidence document harus searchable sebagai result, buat `evidence_search` index sendiri.

```json
{
  "evidence_id": "EVD-1",
  "case_id": "CASE-1",
  "case_number": "CASE-2026-000123",
  "title": "Bank statement March 2026",
  "content": "...",
  "evidence_type": "BANK_STATEMENT",
  "uploaded_at": "2026-04-15T00:00:00Z",
  "visibility": {
    "tenant_id": "regulator-a",
    "case_acl_hash": "..."
  }
}
```

Case result bisa tetap menyimpan `evidence_titles` atau `evidence_summary` untuk recall ringan.

### 7.4 Many-to-many

Contoh:

```text
Party <-> Case
Regulatory theme <-> Case
Organization <-> Enforcement action
```

Search engine biasanya tidak menjadi graph traversal engine.

Pilihan umum:

1. buat projection per retrieval unit,
2. duplikasi identifier/nama penting,
3. precompute derived fields,
4. untuk graph analytics gunakan sistem lain atau query pipeline multi-step.

Contoh:

```text
party_search_v1:
  party_id
  party_name
  case_ids
  case_count
  latest_case_statuses
  max_case_severity
  allegation_types_seen

case_search_v1:
  case_id
  party_ids
  party_names
  party_risk_tiers
```

Ini membuat search cepat tanpa join runtime.

---

## 8. Search document granularity

### 8.1 Coarse-grained document

Contoh: satu case besar memuat semua summary, parties, allegations, dan evidence titles.

Kelebihan:

- satu result = satu business object,
- query sederhana,
- permission di root lebih mudah,
- result card mudah,
- ranking by case mudah.

Kekurangan:

- dokumen bisa terlalu besar,
- update kecil menyebabkan reindex besar,
- highlighting tidak spesifik,
- nested arrays bisa membengkak,
- relevance bisa noisy,
- sulit kalau child perlu muncul sebagai result.

### 8.2 Fine-grained document

Contoh: setiap evidence paragraph jadi search document.

Kelebihan:

- recall lebih baik untuk long text,
- highlight lebih tepat,
- semantic/vector search lebih cocok,
- update granular,
- ranking passage-level.

Kekurangan:

- result grouping lebih kompleks,
- duplicate parent metadata,
- permission harus disalin ke setiap child,
- pagination bisa membingungkan,
- aggregation bisa double-count parent,
- more documents = more index overhead.

### 8.3 Practical heuristic

Pilih coarse-grained ketika:

- user ingin menemukan entity utama,
- text tidak terlalu panjang,
- child tidak perlu result sendiri,
- update child tidak terlalu sering,
- permission sama dengan parent.

Pilih fine-grained ketika:

- text panjang,
- user perlu menemukan bagian spesifik,
- semantic search/RAG butuh chunk,
- child punya lifecycle sendiri,
- child punya permission sendiri,
- highlight/snippet harus akurat.

Sering kali sistem mature punya keduanya.

```text
case_search_v1              coarse-grained case discovery
case_evidence_chunk_v1      fine-grained content retrieval
party_search_v1             entity discovery
```

---

## 9. Field design by purpose

Field di Elasticsearch tidak hanya “atribut”. Setiap field harus punya purpose.

### 9.1 Searchable text fields

Untuk full-text search.

Contoh:

```json
{
  "title": "Alleged licensing fraud by PT Example",
  "summary": "Investigation into suspected false declaration...",
  "evidence_text": "..."
}
```

Pertanyaan:

- analyzer apa?
- bahasa apa?
- perlu stemming?
- perlu synonym?
- perlu phrase search?
- perlu highlighting?
- field ini panjang atau pendek?
- noise-nya tinggi atau rendah?

### 9.2 Exact filter fields

Untuk `term`, `terms`, faceting, authorization, grouping.

Contoh:

```json
{
  "status": "UNDER_INVESTIGATION",
  "severity": "HIGH",
  "tenant_id": "regulator-a",
  "jurisdiction_codes": ["ID-JK", "ID-BT"]
}
```

Biasanya `keyword`, numeric, date, boolean.

### 9.3 Sort fields

Sorting butuh field yang stabil dan typed.

Contoh:

```json
{
  "opened_at": "2026-04-12T10:15:00Z",
  "due_at": "2026-07-12T00:00:00Z",
  "severity_rank": 80
}
```

Jangan sort pada analyzed text. Gunakan `keyword` subfield atau normalized field.

### 9.4 Ranking signal fields

Field yang membantu scoring.

```json
{
  "priority_score": 0.91,
  "freshness_score": 0.72,
  "authority_score": 0.64,
  "severity_rank": 80,
  "open_action_count": 5
}
```

Ranking signal harus:

- dapat dijelaskan,
- stabil,
- tidak mudah dimanipulasi,
- punya range yang diketahui,
- dievaluasi dampaknya.

### 9.5 Display fields

Field untuk render result card.

```json
{
  "case_number": "CASE-2026-000123",
  "display_title": "Licensing fraud investigation — PT Example",
  "primary_party_display": "PT Example Indonesia",
  "status_display": "Under Investigation"
}
```

Display field tidak selalu harus sama dengan searchable field.

### 9.6 Permission fields

Field untuk security trimming.

```json
{
  "tenant_id": "regulator-a",
  "visible_role_codes": ["INVESTIGATOR", "SUPERVISOR"],
  "visible_team_ids": ["TEAM-FIN-ENF"],
  "confidentiality_level": 2,
  "restricted": true
}
```

Permission fields harus dirancang sangat hati-hati karena search bisa bocor melalui:

- result list,
- count,
- facets,
- suggestions,
- autocomplete,
- highlighting,
- timing behavior,
- error message.

### 9.7 Operational fields

Field untuk debugging dan maintenance.

```json
{
  "schema_version": "case_search_v3",
  "indexed_at": "2026-05-20T08:00:00Z",
  "source_updated_at": "2026-05-20T07:59:55Z",
  "source_version": 12345,
  "indexing_trace_id": "abc-123"
}
```

Operational fields menyelamatkan Anda saat production incident.

---

## 10. Modeling text intentionally

### 10.1 Avoid the one giant blob trap

Kesalahan umum:

```json
{
  "search_text": "case title party names evidence text comments all concatenated together"
}
```

Satu field gabungan bisa berguna untuk broad recall, tetapi buruk jika menjadi satu-satunya search field.

Masalah:

- ranking tidak bisa membedakan title match vs comment match,
- highlighting tidak jelas,
- analyzer mungkin tidak cocok untuk semua content,
- field length normalization bisa merugikan dokumen panjang,
- boosting granular sulit,
- query explainability turun.

Lebih baik:

```json
{
  "title": "...",
  "summary": "...",
  "party_names": ["..."],
  "allegation_text": "...",
  "evidence_titles": ["..."],
  "search_text": "optional combined recall field"
}
```

Gunakan `search_text` sebagai fallback atau low-boost field, bukan satu-satunya model.

### 10.2 Field priority

Tidak semua match sama nilainya.

Contoh ranking intuition:

```text
case_number exact match          sangat tinggi
case title match                 tinggi
primary party name match         tinggi
allegation type match            sedang-tinggi
evidence title match             sedang
summary body match               sedang
comment text match               rendah
old audit note match             sangat rendah
```

Document model harus memungkinkan boost seperti ini.

Jika semua digabung ke satu blob, ranking menjadi tumpul.

### 10.3 Identifier vs natural language

Identifier seperti:

- case number,
- license number,
- tax ID,
- document ID,
- user ID,
- organization code,
- regulation article number,

harus dimodelkan berbeda dari natural language.

Natural language:

```json
{
  "title": "Alleged false reporting by licensed institution"
}
```

Identifier:

```json
{
  "case_number": "CASE-2026-000123",
  "case_number_normalized": "case2026000123",
  "license_numbers": ["LIC-2025-9981"]
}
```

Identifier search sering butuh:

- exact match,
- normalized match,
- prefix match,
- punctuation-insensitive match,
- sometimes partial match.

Jangan hanya mengandalkan analyzer standard.

---

## 11. Modeling lifecycle and state

Elasticsearch search result sering harus mengikuti lifecycle domain.

Contoh regulatory lifecycle:

```text
DRAFT -> SUBMITTED -> TRIAGE -> UNDER_INVESTIGATION -> REVIEW -> DECISION -> ENFORCEMENT -> CLOSED -> APPEALED -> ARCHIVED
```

Search perlu field yang membantu:

- filter by exact status,
- group by broader lifecycle,
- rank active cases higher,
- exclude draft/private state,
- support historical queries,
- distinguish current vs superseded.

### 11.1 Store exact and derived status

```json
{
  "status": "UNDER_INVESTIGATION",
  "status_group": "ACTIVE",
  "is_active": true,
  "is_closed": false,
  "is_archived": false,
  "requires_attention": true
}
```

Mengapa derived fields berguna?

Karena UI dan query sering tidak ingin tahu semua state detail.

Contoh:

```text
Active = TRIAGE, UNDER_INVESTIGATION, REVIEW, ENFORCEMENT
Closed = CLOSED, ARCHIVED
Needs action = status in (...) and due_at < now+7d and assigned_to_current_team
```

Precompute sebagian logic jika:

- sering dipakai filter/sort,
- logic stabil,
- mahal dihitung query-time,
- harus konsisten di banyak API.

### 11.2 Avoid hiding business logic randomly in query DSL

Buruk:

```text
Search API punya banyak bool should/filter yang diam-diam mendefinisikan active case.
Beberapa endpoint punya definisi active yang berbeda.
UI count tidak cocok dengan backend export.
```

Lebih baik:

```json
{
  "status": "UNDER_INVESTIGATION",
  "status_group": "ACTIVE",
  "search_visibility_state": "VISIBLE_ACTIVE"
}
```

Business classification dibuat di indexing pipeline/domain projection layer, lalu query memakai field eksplisit.

---

## 12. Modeling permissions and visibility

Permission-aware search adalah salah satu bagian paling sulit dalam enterprise/regulatory search.

Ada dua prinsip:

1. Search result tidak boleh menampilkan dokumen yang user tidak berhak lihat.
2. Metadata seperti count, facet, suggestion, dan highlight juga tidak boleh membocorkan informasi.

### 12.1 Security trimming in query

Contoh field:

```json
{
  "tenant_id": "regulator-a",
  "visible_user_ids": ["user-1", "user-2"],
  "visible_team_ids": ["team-a", "team-b"],
  "visible_role_codes": ["INVESTIGATOR", "SUPERVISOR"],
  "confidentiality_level": 2
}
```

Query harus selalu memasukkan filter permission.

Konseptual:

```json
{
  "bool": {
    "must": [
      { "multi_match": { "query": "licensing fraud", "fields": ["title^3", "summary"] } }
    ],
    "filter": [
      { "term": { "tenant_id": "regulator-a" } },
      { "terms": { "visible_team_ids": ["team-a"] } },
      { "range": { "confidentiality_level": { "lte": 2 } } }
    ]
  }
}
```

### 12.2 Document-level vs field-level visibility

Tidak semua data dalam dokumen punya visibility sama.

Contoh:

- case metadata visible untuk supervisor,
- evidence attachment confidential,
- witness identity restricted,
- internal note hanya visible untuk investigator tertentu.

Pilihan modeling:

#### Option A — Separate indices by visibility

```text
case_public_search_v1
case_internal_search_v1
case_confidential_evidence_search_v1
```

Kelebihan:

- batas security lebih jelas,
- mapping bisa berbeda,
- query sederhana untuk tiap audience.

Kekurangan:

- duplikasi index,
- query multi-index lebih kompleks,
- migration lebih banyak.

#### Option B — Same index with field filtering/application projection

```json
{
  "case_id": "CASE-1",
  "public_summary": "...",
  "internal_summary": "...",
  "restricted_witness_names": ["..."]
}
```

Kelebihan:

- satu index,
- broad search lebih mudah.

Kekurangan:

- risiko leakage lebih tinggi,
- highlighting/facets perlu hati-hati,
- source filtering tidak cukup jika field masih memengaruhi score atau match.

#### Option C — Fine-grained documents by visibility boundary

```text
case_search_document
case_internal_note_search_document
case_evidence_search_document
```

Kelebihan:

- retrieval unit selaras dengan permission,
- result explainability lebih baik.

Kekurangan:

- result grouping perlu desain.

Aturan praktis:

> Jika visibility berbeda secara material, pertimbangkan retrieval document terpisah atau index terpisah. Jangan sembunyikan perbedaan besar hanya dengan field masking.

### 12.3 Facet leakage

Misal user tidak boleh tahu bahwa ada case berstatus `SECRET_INVESTIGATION`.

Walau result-nya difilter, facet yang salah bisa membocorkan:

```json
{
  "status": {
    "UNDER_INVESTIGATION": 12,
    "SECRET_INVESTIGATION": 1
  }
}
```

Facet harus dihitung setelah permission filter.

### 12.4 Suggestion/autocomplete leakage

Autocomplete lebih berbahaya daripada kelihatannya.

Jika user mengetik `PT Se...` lalu suggestion menampilkan `PT Secret Target`, itu leakage.

Autocomplete index juga harus permission-aware atau dibatasi ke public-safe terms.

---

## 13. Modeling multi-tenancy

Multi-tenancy bisa dimodelkan beberapa cara.

### 13.1 Tenant field in shared index

```json
{
  "tenant_id": "tenant-a",
  "case_id": "CASE-1"
}
```

Kelebihan:

- operationally simple,
- shard utilization lebih baik,
- query multi-tenant internal bisa dilakukan.

Kekurangan:

- semua query wajib filter tenant,
- risiko leakage jika filter lupa,
- noisy neighbor,
- tenant-specific mapping sulit.

### 13.2 Index per tenant

```text
tenant_a_case_search_v1
tenant_b_case_search_v1
```

Kelebihan:

- isolation lebih kuat,
- lifecycle per tenant,
- deletion/export per tenant lebih mudah,
- tenant-specific tuning.

Kekurangan:

- terlalu banyak index/shard,
- cluster state bisa membesar,
- operational overhead.

### 13.3 Hybrid

Tenant kecil shared, tenant besar dedicated.

```text
case_search_shared_v1     untuk tenant kecil
case_search_tenant_big_v1 untuk tenant besar
```

Ini sering realistis di enterprise SaaS.

### 13.4 Routing by tenant

Jika shared index, routing bisa membantu locality.

Tetapi routing harus dipahami dengan baik. Salah routing bisa menciptakan hot shard.

Tenant besar yang jauh lebih aktif dari lainnya bisa membuat satu shard panas jika routing terlalu sederhana.

---

## 14. Modeling long text and attachments

Search terhadap attachment, PDF, email, OCR, transcript, dan evidence text tidak sama dengan search terhadap metadata pendek.

### 14.1 Problems with huge documents

Dokumen sangat besar menyebabkan:

- index size membesar,
- analyzer work berat,
- merge lebih mahal,
- highlight lambat,
- BM25 length normalization berubah,
- result kurang spesifik,
- update mahal,
- memory pressure untuk fetch/highlight.

### 14.2 Split long content into chunks

Untuk long content, terutama semantic/RAG retrieval, model fine-grained sering lebih baik.

```json
{
  "chunk_id": "EVD-1#chunk-0007",
  "evidence_id": "EVD-1",
  "case_id": "CASE-1",
  "chunk_ordinal": 7,
  "chunk_text": "...",
  "page_start": 12,
  "page_end": 13,
  "section_title": "Financial transaction summary",
  "visibility": { "tenant_id": "regulator-a", "case_acl_hash": "..." }
}
```

Kelebihan:

- highlight lebih tepat,
- vector search lebih baik,
- passage ranking lebih baik,
- result bisa diarahkan ke halaman/section,
- update/reindex bisa lebih granular.

Kekurangan:

- perlu grouping by evidence/case,
- duplicate permission metadata,
- aggregations perlu hati-hati,
- pagination bisa berisi banyak chunk dari dokumen sama.

### 14.3 Parent metadata duplication

Chunk perlu parent metadata supaya bisa difilter tanpa join.

```json
{
  "chunk_text": "...",
  "case_id": "CASE-1",
  "case_status": "UNDER_INVESTIGATION",
  "case_severity": "HIGH",
  "tenant_id": "regulator-a",
  "visible_team_ids": ["team-a"],
  "evidence_type": "BANK_STATEMENT",
  "uploaded_at": "2026-04-15T00:00:00Z"
}
```

Ini duplikasi yang disengaja.

---

## 15. Modeling for highlighting

Highlighting bukan kosmetik. Highlight menentukan apakah user percaya hasil search.

### 15.1 Store fields that can produce meaningful snippets

Jika result card perlu menunjukkan alasan match, field harus disiapkan.

```json
{
  "title": "...",
  "summary": "...",
  "evidence_excerpt": "...",
  "note_text": "..."
}
```

Jangan hanya menyimpan normalized field yang tidak enak dibaca.

### 15.2 Separate display text from search text

Kadang field yang bagus untuk search tidak bagus untuk display.

```json
{
  "party_name": "PT Example Indonesia, Tbk.",
  "party_name_normalized": "pt example indonesia tbk"
}
```

Gunakan field display untuk UI, field normalized untuk matching.

### 15.3 Highlight leakage

Jika restricted text ikut di-query, highlight bisa bocor.

Jangan index restricted content ke field yang dapat dicari oleh user yang tidak berhak.

---

## 16. Modeling for aggregations and facets

Facet membutuhkan field yang bersih, bounded, dan meaningful.

### 16.1 Good facet field

```json
{
  "status": "UNDER_INVESTIGATION",
  "severity": "HIGH",
  "jurisdiction_codes": ["ID-JK", "ID-BT"],
  "assigned_team_id": "TEAM-FIN-ENF"
}
```

Good facet field biasanya:

- `keyword`, numeric, date, boolean,
- cardinality terkendali,
- value vocabulary terkelola,
- permission-safe,
- stabil secara bisnis.

### 16.2 Bad facet field

```json
{
  "free_text_comment": "Need to follow up with John tomorrow..."
}
```

Tidak cocok untuk terms facet.

### 16.3 Derived facet fields

Sering perlu field turunan:

```json
{
  "opened_year": 2026,
  "opened_month": "2026-04",
  "sla_bucket": "DUE_THIS_WEEK",
  "severity_group": "HIGH_OR_CRITICAL"
}
```

Derived fields bisa membuat query dan aggregation lebih murah/seragam.

---

## 17. Modeling for sorting

Sorting bukan detail kecil. Sorting bisa mengubah cost dan UX.

### 17.1 Sort by relevance

Default search biasanya sort by `_score`.

Butuh field text dan ranking signal yang baik.

### 17.2 Sort by business priority

```json
{
  "priority_rank": 930,
  "severity_rank": 80,
  "sla_due_at": "2026-07-12T00:00:00Z"
}
```

Jika UI punya sort “Most urgent”, jangan hitung semua dari script runtime jika bisa diprecompute.

### 17.3 Stable tie-breaker

Pagination dengan `search_after` butuh sort stabil.

Contoh:

```text
sort: [priority_rank desc, updated_at desc, case_id asc]
```

Karena banyak dokumen bisa punya priority dan updated_at sama.

### 17.4 Avoid sorting by analyzed text

Gunakan field `.keyword` atau normalized keyword.

```json
{
  "party_name": {
    "type": "text",
    "fields": {
      "keyword": { "type": "keyword", "normalizer": "lowercase_normalizer" }
    }
  }
}
```

---

## 18. Modeling document identity

### 18.1 Stable document ID

Elasticsearch document `_id` sebaiknya deterministic.

Contoh:

```text
case_search: CASE-2026-000123
evidence_chunk: EVD-987#chunk-0007
party_search: PARTY-456
```

Manfaat:

- idempotent indexing,
- retry aman,
- update replace lebih mudah,
- duplicate prevention,
- delete propagation jelas.

### 18.2 Avoid random IDs for projections

Random `_id` pada projection menyebabkan:

- duplicate document saat retry,
- delete sulit,
- reconciliation sulit,
- versioning kacau.

Gunakan random ID hanya jika document memang event append-only yang tidak diupdate.

### 18.3 Composite ID

Untuk projection dari relationship:

```text
case_party: CASE-1#PARTY-7
case_event: CASE-1#EVENT-99
case_evidence_chunk: CASE-1#EVD-2#CHUNK-15
```

Composite ID membantu traceability.

---

## 19. Modeling versioning and concurrency

Search index biasanya diupdate async. Event bisa datang out-of-order.

### 19.1 Store source version

```json
{
  "case_id": "CASE-1",
  "source_version": 42,
  "source_updated_at": "2026-05-20T08:00:00Z",
  "indexed_at": "2026-05-20T08:00:03Z"
}
```

Indexing worker bisa menolak event lama jika `source_version` lebih rendah.

### 19.2 Full rebuild must be possible

Karena search projection turunan, sistem harus bisa rebuild dari canonical store.

Design implication:

- mapping version jelas,
- transformer deterministic,
- document ID deterministic,
- source query/backfill tersedia,
- indexing job resumable,
- alias swap untuk zero-downtime.

### 19.3 Schema version inside document

```json
{
  "schema_version": "case_search_v3"
}
```

Berguna untuk:

- debugging,
- mixed-version detection,
- migration validation,
- cleanup.

---

## 20. Modeling deletions

Delete bukan hanya menghapus document.

### 20.1 Hard delete

Jika canonical entity dihapus dan tidak boleh ditemukan:

```text
DELETE /case_search_v1/_doc/CASE-1
```

Tantangan:

- event delete harus reliable,
- retry harus aman,
- child projection juga harus dihapus,
- index alias migration harus mempertahankan delete semantics.

### 20.2 Soft delete / hidden state

Dalam regulatory system, data sering tidak benar-benar dihapus.

```json
{
  "is_deleted": true,
  "search_visibility_state": "HIDDEN",
  "deleted_at": "2026-05-20T08:00:00Z"
}
```

Query default filter:

```json
{ "term": { "search_visibility_state": "VISIBLE" } }
```

Soft delete cocok jika:

- audit retention dibutuhkan,
- legal hold,
- restore mungkin,
- historical search untuk auditor berbeda dari normal user.

Tetapi jangan lupa: soft-deleted docs masih memakan index dan bisa bocor jika filter lupa.

### 20.3 Tombstone projection

Kadang perlu tombstone untuk reconciliation.

```json
{
  "entity_id": "CASE-1",
  "entity_type": "CASE",
  "deleted": true,
  "source_version": 55,
  "deleted_at": "2026-05-20T08:00:00Z"
}
```

Biasanya tidak untuk user search, tetapi untuk pipeline correctness.

---

## 21. Modeling updates

### 21.1 Update-as-reindex mental model

Di Lucene/Elasticsearch, update document secara konseptual adalah delete old version + add new version. Karena itu dokumen besar dengan update sering bisa mahal.

Implikasi:

- jangan embed child yang sangat sering berubah ke parent besar,
- jangan menyimpan counter volatile jika update sangat tinggi,
- pertimbangkan separate projection untuk high-churn data,
- batch update jika memungkinkan.

### 21.2 High-churn fields

Contoh high-churn:

- view count,
- last accessed at,
- temporary lock state,
- rapidly changing task count,
- ephemeral assignment indicator.

Jika field berubah sangat sering, tanya:

1. Apakah field harus searchable?
2. Apakah field harus real-time?
3. Apakah field bisa dibaca dari canonical/cache saat detail page?
4. Apakah field bisa diprecompute periodik?
5. Apakah field layak masuk index terpisah?

Jangan otomatis memasukkan semua field ke search document.

---

## 22. Modeling partial result and detail page

Search page dan detail page punya kebutuhan berbeda.

### 22.1 Search result card

Search result card butuh data ringkas.

```json
{
  "case_id": "CASE-1",
  "case_number": "CASE-2026-000123",
  "display_title": "Licensing fraud investigation",
  "primary_party_display": "PT Example Indonesia",
  "status_display": "Under Investigation",
  "severity": "HIGH",
  "snippet_source": "summary"
}
```

### 22.2 Detail page

Detail page sebaiknya baca canonical store atau dedicated read model yang authoritative.

Pattern aman:

```text
Search result -> user clicks -> application checks permission -> load canonical/detail read model
```

Jangan bergantung pada `_source` Elasticsearch untuk detail business-critical jika butuh strict consistency.

### 22.3 Result hydration

Kadang search result hanya menyimpan ID lalu backend hydrate dari DB.

Kelebihan:

- data detail lebih fresh,
- index lebih kecil,
- sensitive fields lebih aman.

Kekurangan:

- N+1 risk,
- latency naik,
- result ordering harus dipertahankan,
- DB load naik,
- partial failures.

Praktisnya, simpan cukup field untuk result card. Hydrate hanya untuk field yang memang butuh authoritative freshness atau sensitive handling.

---

## 23. Anti-patterns in Elasticsearch document modeling

### 23.1 Treating Elasticsearch like relational database

Gejala:

- banyak parent-child join,
- query berusaha meniru SQL joins,
- dokumen sangat normalized,
- result butuh banyak query lanjutan,
- performance buruk walau cluster besar.

Solusi:

- desain retrieval unit,
- denormalize search fields,
- buat projection per use case.

### 23.2 One index for everything

Gejala:

```text
universal_search_index berisi case, party, document, comment, task, audit log, notification
```

Masalah:

- mapping kacau,
- analyzer kompromistis,
- permission kompleks,
- relevance tidak jelas,
- lifecycle berbeda,
- performance sulit diprediksi.

Boleh punya global search, tetapi sering lebih baik memakai beberapa index dengan type-specific fields dan query orchestration.

### 23.3 One giant document

Gejala:

- semua child embed ke parent,
- document size besar,
- update lambat,
- highlight buruk,
- nested count tinggi,
- merge pressure.

Solusi:

- split retrieval unit,
- use chunk index,
- embed hanya summary/searchable metadata.

### 23.4 Dynamic mapping without governance

Gejala:

- external metadata langsung masuk index,
- field count tumbuh liar,
- mapping explosion,
- memory pressure,
- query/facet field tidak konsisten.

Solusi:

- explicit mapping untuk important fields,
- flattened untuk arbitrary metadata,
- whitelist dynamic fields,
- index template governance.

### 23.5 Mixing visibility levels in one field

Gejala:

```json
{
  "search_text": "public summary + confidential note + witness name"
}
```

Masalah:

- restricted content bisa memengaruhi match,
- highlight bisa bocor,
- suggestion bisa bocor,
- explain/debug bisa bocor.

Solusi:

- pisahkan public/internal/restricted fields,
- query sesuai permission,
- atau pisahkan index/document by visibility.

### 23.6 Modeling only for today’s UI

Gejala:

- field names hardcoded untuk satu screen,
- tidak ada versioning,
- migration sulit,
- new filter/ranking butuh full redesign.

Solusi:

- desain berdasarkan query families,
- dokumentasikan field purpose,
- schema version,
- backward-compatible API contract.

---

## 24. A document modeling workflow

Gunakan workflow ini saat mendesain Elasticsearch index baru.

### Step 1 — Define user journeys

Contoh:

```text
Investigator searches active cases.
Supervisor searches overdue high-severity cases.
Auditor searches historical enforcement decisions.
Analyst searches evidence documents by phrase.
Manager filters case volume by jurisdiction and severity.
```

### Step 2 — Define retrieval units

```text
case_search
case_evidence_search
party_search
enforcement_decision_search
```

### Step 3 — Define query matrix

| Query | Retrieval Unit | Full-text Fields | Filters | Sort | Facets | Permission |
|---|---|---|---|---|---|---|
| Search active cases | Case | title, summary, party_names | status_group, severity, jurisdiction | score, due_at | status, severity | tenant/team/role |
| Search evidence | Evidence chunk | chunk_text, title | case_id, evidence_type | score, uploaded_at | evidence_type | case ACL |
| Search party | Party | name, aliases, identifiers | risk_tier, entity_type | score | entity_type | tenant |

### Step 4 — Design fields by purpose

For each field, label it:

```text
searchable
filterable
sortable
facetable
rank_signal
display
permission
operational
```

If a field has no purpose, do not index it.

### Step 5 — Choose relationship representation

For each relationship:

```text
copy scalar fields?
array of keyword?
nested?
separate index?
join?
application-side lookup?
```

### Step 6 — Define freshness contract

```text
How stale can result be?
How fast must deletes propagate?
How fast must permission changes propagate?
Do user actions require refresh=wait_for?
Can user tolerate near-real-time delay?
```

### Step 7 — Define migration strategy

```text
index alias?
versioned index name?
backfill job?
dual write?
verification query?
rollback?
```

### Step 8 — Define observability fields

```text
source_version
source_updated_at
indexed_at
schema_version
indexing_trace_id
projection_source
```

---

## 25. Example: regulatory case search document

### 25.1 Requirements

Users:

- investigator,
- supervisor,
- auditor,
- enforcement officer.

Search behavior:

- search by case number, title, party name, allegation, summary,
- filter by status, severity, jurisdiction, SLA state, team,
- sort by relevance, urgency, opened date,
- show facets,
- enforce tenant/team/role/confidentiality,
- avoid leaking restricted witness data.

### 25.2 Candidate document

```json
{
  "case_id": "CASE-2026-000123",
  "case_number": "CASE-2026-000123",
  "case_number_normalized": "case2026000123",
  "schema_version": "case_search_v1",

  "title": "Alleged licensing fraud by PT Example Indonesia",
  "summary": "Investigation into suspected false declarations in license renewal submissions.",
  "public_summary": "Investigation into suspected licensing irregularities.",

  "status": "UNDER_INVESTIGATION",
  "status_group": "ACTIVE",
  "is_active": true,
  "severity": "HIGH",
  "severity_rank": 80,

  "opened_at": "2026-04-12T10:15:00Z",
  "updated_at": "2026-05-20T08:00:00Z",
  "due_at": "2026-07-12T00:00:00Z",
  "sla_state": "AT_RISK",
  "days_until_due": 21,

  "primary_party_id": "PARTY-100",
  "primary_party_name": "PT Example Indonesia",
  "party_names": ["PT Example Indonesia", "John Doe"],
  "party_identifiers": ["TAX-123456", "LIC-2025-0099"],

  "allegation_types": ["LICENSING_FRAUD", "FALSE_REPORTING"],
  "allegation_keywords": ["license renewal", "false declaration", "beneficial ownership"],

  "jurisdiction_codes": ["ID-JK"],
  "assigned_team_id": "TEAM-FIN-ENF",
  "assigned_team_name": "Financial Enforcement",
  "assigned_officer_ids": ["USER-77", "USER-81"],

  "ranking": {
    "priority_score": 0.91,
    "freshness_score": 0.72,
    "quality_score": 0.84
  },

  "visibility": {
    "tenant_id": "regulator-a",
    "visible_role_codes": ["INVESTIGATOR", "SUPERVISOR"],
    "visible_team_ids": ["TEAM-FIN-ENF"],
    "confidentiality_level": 2,
    "restricted": false
  },

  "display": {
    "title": "Licensing fraud investigation — PT Example Indonesia",
    "subtitle": "CASE-2026-000123 · High severity · Under investigation"
  },

  "source_version": 42,
  "source_updated_at": "2026-05-20T07:59:55Z",
  "indexed_at": "2026-05-20T08:00:03Z",
  "indexing_trace_id": "idx-abc-123"
}
```

### 25.3 Why this shape works

It supports exact identifier search:

```text
case_number, case_number_normalized, party_identifiers
```

It supports full-text search:

```text
title, summary, party_names, allegation_keywords
```

It supports filters:

```text
status, status_group, severity, jurisdiction_codes, assigned_team_id, sla_state
```

It supports sorting/ranking:

```text
severity_rank, due_at, opened_at, ranking.priority_score
```

It supports permission:

```text
visibility.tenant_id, visible_role_codes, visible_team_ids, confidentiality_level
```

It supports operations:

```text
schema_version, source_version, source_updated_at, indexed_at, indexing_trace_id
```

This is a search document, not a normalized domain entity.

---

## 26. Example: evidence chunk search document

### 26.1 Requirements

- Search long evidence text.
- Highlight exact passage.
- Support phrase search.
- Support semantic search later.
- Filter by case, evidence type, date, permission.
- Show parent case context.

### 26.2 Candidate document

```json
{
  "chunk_id": "EVD-900#chunk-0012",
  "evidence_id": "EVD-900",
  "case_id": "CASE-2026-000123",
  "case_number": "CASE-2026-000123",
  "schema_version": "evidence_chunk_search_v1",

  "evidence_title": "License renewal submission package",
  "evidence_type": "REGULATORY_FILING",
  "mime_type": "application/pdf",

  "chunk_ordinal": 12,
  "page_start": 18,
  "page_end": 19,
  "section_title": "Beneficial Ownership Declaration",
  "chunk_text": "The applicant declares that no beneficial ownership changes occurred during the reporting period...",

  "case_status": "UNDER_INVESTIGATION",
  "case_severity": "HIGH",
  "jurisdiction_codes": ["ID-JK"],

  "visibility": {
    "tenant_id": "regulator-a",
    "visible_team_ids": ["TEAM-FIN-ENF"],
    "confidentiality_level": 3,
    "restricted": true
  },

  "uploaded_at": "2026-04-18T09:00:00Z",
  "source_version": 8,
  "indexed_at": "2026-04-18T09:02:00Z"
}
```

### 26.3 Why not embed this in case document?

Because evidence text is long, independently searchable, highlight-sensitive, and may have different confidentiality. A case-level document can store evidence titles/summaries, but full evidence text belongs in a fine-grained index.

---

## 27. Decision table: choose modeling pattern

| Requirement | Recommended Pattern | Avoid |
|---|---|---|
| Search case by related party name | Denormalize `party_names` into case doc | Runtime join |
| Search party as result | Separate `party_search` index | Force party into case-only doc |
| Array of objects with field correlation | `nested` | Plain object array |
| Arbitrary key-value metadata | `flattened` | Dynamic field explosion |
| Very large child collection | Separate child index or rare parent-child | Huge parent doc |
| Child updates frequently | Separate document/index | Reindex huge parent each time |
| Long document/passages | Chunk-level documents | One giant text field |
| Different visibility per content section | Separate document/index by visibility | Single mixed restricted field |
| Need exact identifier lookup | Keyword/normalized identifier fields | Standard full-text only |
| Need business sorting | Precomputed rank/sort fields | Runtime scripts everywhere |
| Need stable pagination | Deterministic tie-breaker field | Sort only by score/date |

---

## 28. Java engineer perspective

### 28.1 Do not expose domain entity directly as Elasticsearch document

Bad pattern:

```java
class CaseEntity {
    UUID id;
    String title;
    List<PartyEntity> parties;
    List<EvidenceEntity> evidence;
    WorkflowState state;
}

// directly serialize CaseEntity to Elasticsearch
```

Why bad:

- domain model changes accidentally change index schema,
- internal fields leak,
- search field purpose unclear,
- permission fields may be incomplete,
- cyclic references or huge object graphs,
- mapping drift.

Better:

```java
record CaseSearchDocument(
    String caseId,
    String caseNumber,
    String title,
    String summary,
    String status,
    String statusGroup,
    String severity,
    int severityRank,
    List<String> partyNames,
    List<String> partyIdentifiers,
    List<String> allegationTypes,
    Visibility visibility,
    long sourceVersion,
    Instant sourceUpdatedAt,
    Instant indexedAt
) {}
```

Use explicit transformer:

```java
class CaseSearchDocumentMapper {
    CaseSearchDocument from(CaseAggregate aggregate) {
        return new CaseSearchDocument(
            aggregate.id().value(),
            aggregate.caseNumber().value(),
            aggregate.title().value(),
            aggregate.summaryForSearch(),
            aggregate.status().name(),
            mapStatusGroup(aggregate.status()),
            aggregate.severity().name(),
            mapSeverityRank(aggregate.severity()),
            aggregate.parties().stream().map(Party::displayName).toList(),
            aggregate.parties().stream().flatMap(p -> p.identifiers().stream()).toList(),
            aggregate.allegations().stream().map(a -> a.type().name()).toList(),
            mapVisibility(aggregate),
            aggregate.version(),
            aggregate.updatedAt(),
            Instant.now()
        );
    }
}
```

### 28.2 Keep search mapping contract close to code

Recommended artifacts:

```text
src/main/resources/elasticsearch/case_search_v1_mapping.json
src/main/resources/elasticsearch/case_search_v1_settings.json
src/test/.../CaseSearchDocumentMappingTest.java
src/test/.../CaseSearchQueryContractTest.java
```

Test things like:

- all filter fields are keyword/date/numeric,
- text fields have expected analyzer,
- required permission fields exist,
- schema version is populated,
- generated document matches mapping,
- query builder always injects permission filter.

### 28.3 Make document purpose visible in code

Instead of one massive DTO, organize fields by concern.

```java
record CaseSearchDocument(
    CaseIdentityFields identity,
    CaseTextFields text,
    CaseFilterFields filters,
    CaseRankingFields ranking,
    CaseVisibilityFields visibility,
    CaseOperationalFields operational
) {}
```

This is more verbose, but for large systems it makes invariants visible.

---

## 29. Regulatory defensibility lens

For enforcement and case management systems, search result correctness is not only UX. It can affect fairness, auditability, and operational accountability.

Questions you should be able to answer:

1. Why did this case appear in the result?
2. Why did this case rank above another?
3. Why did user A see it but user B did not?
4. Was the result based on current or stale state?
5. Did the search include confidential evidence?
6. Were closed/superseded cases included?
7. Were facets computed after permission filtering?
8. Can we reproduce the result later?
9. Did schema migration change relevance unexpectedly?
10. Can we prove deleted/restricted documents are not searchable?

This means document modeling must include:

- explicit lifecycle fields,
- explicit visibility fields,
- source version,
- indexed timestamp,
- schema version,
- ranking signals,
- field purpose documentation,
- permission-safe autocomplete/facet strategy.

A defensible search system is not just fast. It is explainable, observable, and bounded by clear invariants.

---

## 30. Modeling checklist

Before approving an Elasticsearch document model, review this checklist.

### Retrieval unit

- [ ] Is the returned search result unit explicit?
- [ ] Does it match the user journey?
- [ ] Is there a separate index for materially different result units?
- [ ] Are long text/passages modeled separately if needed?

### Field purpose

- [ ] Every field has a purpose: search/filter/sort/facet/rank/display/permission/operation.
- [ ] Full-text fields are separated by importance.
- [ ] Identifier fields are not treated like normal prose.
- [ ] Sort fields are stable and typed.
- [ ] Facet fields have controlled cardinality.

### Relationships

- [ ] Denormalization is intentional.
- [ ] Array-of-object correlation is handled correctly.
- [ ] Nested is used only when needed.
- [ ] Parent-child is avoided unless justified.
- [ ] Huge child collections are not blindly embedded.

### Security

- [ ] Tenant filter field exists.
- [ ] Permission fields are explicit.
- [ ] Restricted content is not mixed with public search text.
- [ ] Facets/counts respect permission filters.
- [ ] Suggestions/autocomplete cannot leak restricted terms.
- [ ] Detail page rechecks permission.

### Lifecycle

- [ ] Exact status and derived status group exist.
- [ ] Soft-deleted/hidden/archived states are explicit.
- [ ] Current vs historical behavior is defined.
- [ ] Retention/legal hold implications are considered.

### Operations

- [ ] Document ID is deterministic.
- [ ] Source version is stored.
- [ ] Source updated timestamp is stored.
- [ ] Indexed timestamp is stored.
- [ ] Schema version is stored.
- [ ] Rebuild from source is possible.
- [ ] Delete propagation is designed.
- [ ] Mapping migration path exists.

---

## 31. Key takeaways

1. Elasticsearch document modeling starts from **retrieval unit**, not domain entity.
2. A search document is usually a **projection**, not canonical truth.
3. Denormalization is normal and often desirable in search systems.
4. `object`, `nested`, `flattened`, and `join` solve different problems; using the wrong one creates correctness or performance bugs.
5. Long text often deserves chunk-level modeling.
6. Permission and lifecycle fields are first-class modeling concerns, not query afterthoughts.
7. Identifier search and natural language search require different fields and analyzers.
8. Search document ID should be deterministic for idempotent indexing.
9. Source version, indexed timestamp, and schema version are essential for production debugging.
10. Top-tier Elasticsearch engineering is less about memorizing query DSL and more about shaping documents so the right queries become simple, safe, and fast.

---

## 32. References

- Elastic Documentation — Nested field type: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/nested
- Elastic Documentation — Nested query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-nested-query
- Elastic Documentation — Join field type: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/parent-join
- Elastic Documentation — Field data types: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/field-data-types
- Elastic Blog — Managing relations inside Elasticsearch: https://www.elastic.co/blog/managing-relations-inside-elasticsearch

---

## 33. Next part

Part berikutnya:

`learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-006.md`

Topik:

# Part 006 — Mapping Mastery

Kita akan membahas mapping sebagai schema search: `text` vs `keyword`, dynamic mapping, multi-fields, doc values, `_source`, field explosion, templates, mapping immutability, dan governance mapping untuk sistem besar.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-004.md">⬅️ Part 004 — Elasticsearch Architecture Deep Dive</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-006.md">Part 006 — Mapping Mastery ➡️</a>
</div>
