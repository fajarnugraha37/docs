# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-001

# Part 001 — Search Problem Fundamentals: From Lookup to Relevance

> Series: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Audience: Java software engineer / backend engineer / tech lead  
> Goal: membangun mental model fundamental tentang problem search sebelum masuk ke inverted index, Lucene, Elasticsearch architecture, mapping, query DSL, relevance engineering, dan production operations.

---

## 0. Posisi Part Ini di Dalam Series

Part 000 memberi orientasi: Elasticsearch bukan sekadar database lain, melainkan **retrieval engine**. Part 001 ini masuk ke pertanyaan yang lebih dasar:

> “Search itu sebenarnya problem apa?”

Banyak engineer memulai Elasticsearch dari syntax:

```json
{
  "query": {
    "match": {
      "title": "payment dispute"
    }
  }
}
```

Itu terlalu cepat.

Syntax query hanya lapisan luar. Yang lebih penting adalah memahami bahwa search adalah problem tentang:

- menemukan kandidat yang mungkin relevan,
- memahami intent user,
- mengatasi mismatch antara bahasa user dan bahasa data,
- mengurutkan hasil secara masuk akal,
- menjaga freshness dan permission,
- membuat trade-off antara recall, precision, latency, explainability, dan cost.

Di sistem nyata, search jarang gagal karena engineer tidak tahu nama API. Search lebih sering gagal karena:

- data model tidak cocok dengan query behavior,
- analyzer salah,
- relevance tidak dipahami,
- ranking dicampur dengan business rule tanpa desain,
- permission filtering bocor,
- pagination tidak stabil,
- result stale tetapi user menganggap data sudah real-time,
- search endpoint terlalu permisif sehingga query mahal bisa dieksekusi user,
- engineer memperlakukan Elasticsearch seperti OLTP database.

Part ini akan membangun fondasi problem search agar part-part berikutnya punya konteks yang kuat.

---

## 1. Search Bukan Sekadar “Mencari Data”

Dalam backend engineering, kita sering memakai kata “search” untuk banyak hal yang sebenarnya berbeda.

Contoh:

1. User memasukkan nomor perkara: `CASE-2026-001234`.
2. Investigator mencari semua kasus yang menyebut “unlicensed lending”.
3. Supervisor mencari kasus prioritas tinggi yang mendekati SLA breach.
4. Auditor mencari keputusan historis yang mirip dengan kasus saat ini.
5. Customer mengetik “iphon 15 case clear” dan berharap menemukan “iPhone 15 transparent cover”.
6. Compliance officer mencari dokumen yang secara makna terkait “market manipulation” walaupun kata itu tidak muncul literal.

Semua sering disebut search, tetapi karakter problemnya berbeda.

Search bisa berarti:

| Jenis | Pertanyaan Utama | Contoh |
|---|---|---|
| Lookup | “Apakah item spesifik ini ada?” | cari by ID, reference number, exact username |
| Filtering | “Mana item yang memenuhi kondisi ini?” | status = open, priority = high, due date < now |
| Full-text search | “Dokumen mana yang mengandung konsep/kata ini?” | cari “payment fraud” di title/body |
| Discovery | “Tunjukkan item yang mungkin menarik/berguna.” | explore catalog, knowledge base |
| Recommendation | “Apa yang sebaiknya dilihat user berikutnya?” | related cases, similar articles |
| Semantic retrieval | “Dokumen mana yang maknanya dekat dengan query?” | cari konsep tanpa exact keyword overlap |
| Investigative search | “Bantu saya menemukan pola/relasi/evidence.” | search across parties, cases, events, documents |

Kesalahan umum adalah menggunakan satu strategi untuk semua jenis problem.

Contoh buruk:

- Semua field dibuat `text` agar “bisa dicari”.
- Semua query dibuat `multi_match` ke semua field.
- Semua filter dimasukkan ke scoring query.
- Exact identifier dicari dengan analyzer full-text.
- Natural language query dicari dengan exact `term`.
- Ranking diselesaikan dengan menaikkan boost sampai “kelihatannya benar”.

Search yang baik dimulai dari klasifikasi problem.

---

## 2. Lookup vs Search

### 2.1 Lookup

Lookup adalah pencarian ketika user atau sistem sudah tahu target yang spesifik.

Contoh:

```text
CASE-2026-001234
INV-993812
john.doe@example.com
NIK 317xxxxxxxxxxxxx
transactionId = 8f15e...
```

Ciri lookup:

- input biasanya structured,
- target biasanya satu atau sedikit,
- correctness lebih penting daripada ranking,
- exactness penting,
- score biasanya tidak relevan,
- latency diharapkan sangat rendah,
- hasil kosong berarti item tidak ada atau user tidak berhak melihat.

Untuk lookup, pertanyaan utamanya:

> “Apakah key ini punya match yang tepat?”

Bukan:

> “Dokumen mana yang paling relevan secara tekstual?”

Di Elasticsearch, lookup biasanya memakai field `keyword`, bukan `text`.

Mental model:

```text
User input: CASE-2026-001234
Need: exact identity match
Field: case_number.keyword
Query type: term / terms
Ranking: irrelevant
```

### 2.2 Search

Search adalah pencarian ketika target belum diketahui secara spesifik.

Contoh:

```text
unlicensed lending
fraudulent investment scheme
late payment dispute
customer complaint about data breach
```

Ciri search:

- input bisa ambiguous,
- target bisa banyak,
- ranking penting,
- recall dan precision perlu diseimbangkan,
- bahasa user bisa berbeda dari bahasa dokumen,
- query bisa typo, singkatan, sinonim, multi-language,
- hasil terbaik tidak selalu yang mengandung kata paling banyak.

Untuk search, pertanyaan utamanya:

> “Dari sekian banyak dokumen, mana yang paling berguna untuk intent user ini?”

Elasticsearch kuat untuk search karena membangun inverted index, melakukan text analysis, dan menghitung relevance score. Elastic menjelaskan bahwa full-text search menganalisis query text dengan cara serupa seperti indexed text, lalu menggunakan token hasil analisis untuk mencari inverted index. Default similarity modern Elasticsearch berbasis Okapi BM25, yang mempertimbangkan term frequency, document frequency, dan field length.

Referensi resmi:

- Elastic Docs — How full-text search works: https://www.elastic.co/docs/solutions/search/full-text/how-full-text-works
- Lucene BM25Similarity API: https://lucene.apache.org/core/8_1_1/core/org/apache/lucene/search/similarities/BM25Similarity.html

---

## 3. Filtering vs Search

Filtering sering keliru dicampur dengan search.

Filter menjawab:

> “Dokumen mana yang memenuhi syarat?”

Search menjawab:

> “Dokumen mana yang paling relevan?”

Contoh filter:

```text
status = OPEN
priority IN (HIGH, CRITICAL)
created_at >= 2026-01-01
assigned_team = Enforcement
visible_to_user = true
tenant_id = abc
```

Contoh search:

```text
market abuse insider trading suspicious transaction
```

Dalam Elasticsearch, filter biasanya tidak berkontribusi pada score. Filter menentukan candidate set. Search query memberi score di dalam candidate set.

Mental model:

```text
1. Authorization filter: user boleh melihat apa?
2. Domain filter: user membatasi ke status/team/date apa?
3. Text query: dari kandidat itu, mana yang paling relevan?
4. Ranking signals: bagaimana urutan akhir disesuaikan?
```

Contoh desain query konseptual:

```json
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "t-001" }},
        { "terms": { "visibility_group": ["enforcement", "supervisor"] }},
        { "term": { "status": "OPEN" }}
      ],
      "must": [
        { "match": { "case_summary": "unlicensed lending" }}
      ]
    }
  }
}
```

Di atas, `tenant_id`, `visibility_group`, dan `status` bukan relevance signal. Itu constraint. Query text baru berperan dalam relevance.

Kesalahan umum:

```text
Semua kondisi dimasukkan ke must sebagai query scoring.
```

Akibat:

- score menjadi sulit dijelaskan,
- cache/filter optimization tidak optimal,
- ranking dipengaruhi kondisi yang seharusnya hanya membatasi candidate,
- debugging relevance menjadi kacau.

---

## 4. Exact Match, Partial Match, Fuzzy Match, Semantic Match

Search system modern biasanya perlu mendukung beberapa mode matching sekaligus.

### 4.1 Exact Match

Exact match berarti nilai harus sama.

Contoh:

```text
case_number = CASE-2026-001234
status = OPEN
country_code = ID
```

Cocok untuk:

- ID,
- kode,
- enum,
- email,
- username,
- normalized legal entity ID,
- reference number.

Biasanya memakai field `keyword`.

### 4.2 Partial Match

Partial match berarti input user cocok dengan sebagian nilai.

Contoh:

```text
Input: "pay dis"
Target: "payment dispute"
```

Cocok untuk:

- autocomplete,
- search-as-you-type,
- prefix search,
- name search,
- product search.

Tetapi partial match mahal dan rawan noise jika tidak dirancang.

Contoh bahaya:

```text
Wildcard: *pay*
```

Bisa mahal karena search engine harus mengevaluasi banyak term.

Alternatif desain:

- edge n-gram,
- search-as-you-type field,
- completion suggester,
- prefix query dengan batasan,
- separate autocomplete index.

### 4.3 Fuzzy Match

Fuzzy match mengizinkan perbedaan karakter kecil.

Contoh:

```text
iphon -> iphone
fraudulant -> fraudulent
licence -> license
```

Fuzzy berguna untuk typo. Tetapi fuzzy bukan semantic understanding.

Masalah fuzzy:

- bisa memperluas candidate terlalu banyak,
- bisa menaikkan latency,
- bisa menghasilkan match aneh untuk short token,
- bisa berbahaya untuk kode/ID.

Contoh:

```text
CASE-1001 fuzzy match CASE-1007
```

Untuk regulatory atau financial system, fuzzy pada identifier bisa berbahaya jika user menganggap hasilnya exact.

### 4.4 Semantic Match

Semantic match berarti dokumen cocok karena maknanya dekat, walaupun token literal berbeda.

Contoh:

```text
Query: "illegal lending without permission"
Document: "unlicensed consumer credit provider"
```

Secara keyword, overlap sedikit. Secara makna, sangat dekat.

Semantic search biasanya memakai embeddings/vector search. Elasticsearch modern mendukung vector search dan semantic search sebagai bagian dari search solution-nya.

Referensi resmi:

- Elastic Docs — Vector search: https://www.elastic.co/docs/solutions/search/vector
- Elastic Docs — Semantic search: https://www.elastic.co/docs/solutions/search/semantic-search

Tetapi semantic search bukan pengganti full-text search. Banyak domain enterprise tetap membutuhkan lexical search karena:

- ID harus exact,
- istilah hukum/regulasi punya makna spesifik,
- phrase tertentu penting,
- explainability penting,
- permission filtering harus deterministik,
- auditability perlu jelas.

Top-tier search engineer tidak berpikir “BM25 vs vector”. Mereka berpikir:

```text
Intent apa yang perlu exact?
Intent apa yang perlu lexical?
Intent apa yang perlu semantic?
Bagaimana menggabungkannya tanpa merusak trust?
```

---

## 5. Recall dan Precision

Dua konsep paling penting dalam search quality adalah **recall** dan **precision**.

### 5.1 Recall

Recall menjawab:

> “Dari semua dokumen yang seharusnya ditemukan, berapa banyak yang berhasil ditemukan?”

High recall berarti sedikit dokumen relevan yang terlewat.

Contoh:

User mencari:

```text
unlicensed lending
```

Dokumen relevan mungkin memakai istilah:

```text
unauthorized credit provider
illegal consumer finance
lending without permit
unregistered loan platform
```

Jika search hanya exact keyword `unlicensed lending`, recall rendah.

Recall penting untuk:

- investigation,
- legal/regulatory search,
- compliance review,
- fraud detection,
- e-discovery,
- knowledge retrieval,
- root cause analysis.

Dalam domain enforcement, missing a relevant document can be worse than showing extra documents.

### 5.2 Precision

Precision menjawab:

> “Dari dokumen yang ditampilkan, berapa banyak yang benar-benar relevan?”

High precision berarti hasil yang muncul sedikit noise.

Precision penting untuk:

- user-facing search,
- operational dashboard,
- case queue,
- support search,
- top result ranking,
- autocomplete.

Jika precision rendah, user kehilangan trust.

### 5.3 Trade-off

Naikkan recall terlalu agresif:

```text
+ lebih banyak dokumen relevan ditemukan
- lebih banyak noise
- latency bisa naik
- user harus memilah lebih banyak
```

Naikkan precision terlalu agresif:

```text
+ hasil lebih bersih
- dokumen relevan bisa hilang
- zero-result lebih sering
- investigative use case melemah
```

Tidak ada setting universal. Search design harus mengikuti use case.

Contoh regulatory case search:

| Use Case | Preferensi |
|---|---|
| Cari case by ID | precision maksimal |
| Investigator mencari evidence | recall tinggi |
| Supervisor memilih queue hari ini | precision + business ranking |
| Auditor mencari precedent | recall tinggi + explainability |
| Autocomplete party name | precision + low latency |
| Semantic knowledge retrieval | recall@K + reranking |

---

## 6. Ranking: Mengapa “Ditemukan” Tidak Cukup

Misalnya ada 10.000 dokumen yang match query.

Search engine tidak hanya perlu menjawab:

```text
Dokumen mana yang match?
```

Tetapi:

```text
Urutan mana yang paling berguna?
```

Ranking adalah inti search.

Tanpa ranking yang baik, search menjadi filter besar yang melelahkan user.

Contoh query:

```text
payment dispute
```

Dokumen A:

```text
Title: Payment dispute involving merchant settlement
Body: Detailed discussion of chargeback, cardholder complaint, evidence timeline...
```

Dokumen B:

```text
Title: Internal meeting notes
Body: ... unrelated content ... payment ... unrelated ... dispute ...
```

Keduanya mengandung kata `payment` dan `dispute`. Tetapi A lebih relevan.

Ranking mempertimbangkan sinyal seperti:

- term muncul di field mana,
- term frequency,
- rarity term dalam corpus,
- document length,
- phrase proximity,
- freshness,
- authority,
- status,
- popularity,
- user context,
- permission,
- business priority.

Elasticsearch default full-text scoring berbasis BM25. BM25 bukan magic; ia hanya salah satu sinyal lexical relevance. Elastic menjelaskan BM25 mempertimbangkan term frequency, document frequency, dan document length.

Referensi:

- Elastic Docs — How full-text search works: https://www.elastic.co/docs/solutions/search/full-text/how-full-text-works
- Elastic Blog — Practical BM25: https://www.elastic.co/blog/practical-bm25-part-1-how-shards-affect-relevance-scoring-in-elasticsearch

Part 010 dan 011 nanti akan membahas ranking lebih dalam.

Untuk saat ini, cukup pegang mental model:

```text
Search result quality = candidate retrieval + ranking quality + UX interpretation + user trust.
```

---

## 7. Query Intent

Search query pendek sering ambiguous.

Contoh:

```text
apple
```

Bisa berarti:

- fruit,
- Apple Inc.,
- stock ticker,
- vendor name,
- internal project codename,
- complainant surname.

Contoh domain regulatory:

```text
appeal
```

Bisa berarti:

- case status appeal,
- appeal document,
- appeal deadline,
- legal appeal process,
- internal review decision.

Search engine tidak benar-benar “mengerti” intent secara sempurna. Ia hanya mengeksekusi strategi matching dan ranking berdasarkan sinyal yang tersedia.

Tugas engineer adalah menyediakan struktur agar intent bisa diperkirakan.

Sinyal intent bisa berasal dari:

- query text,
- selected filters,
- page context,
- user role,
- recent activity,
- field targeted,
- query pattern,
- exact identifier detection,
- history atau analytics,
- domain-specific synonyms.

Contoh:

```text
Input: CASE-2026-001234
Intent: exact case lookup
```

```text
Input: unlicensed lending
Intent: full-text / concept search
```

```text
Input: John Smith
Intent: person/party search, possibly exact-ish name search
```

```text
Input: market manipulation report filetype:pdf
Intent: document search with filter
```

Backend search API yang matang tidak langsung melempar semua query ke satu `multi_match`. Ia bisa melakukan query planning sederhana:

```text
1. Apakah query terlihat seperti exact identifier?
2. Apakah query terlihat seperti email/phone/reference number?
3. Apakah user memilih scope tertentu?
4. Apakah query pendek sehingga fuzzy harus dibatasi?
5. Apakah phrase penting?
6. Apakah semantic fallback perlu?
7. Apakah permission filter sudah diterapkan lebih awal?
```

---

## 8. Vocabulary Mismatch

Salah satu problem search paling sering adalah **vocabulary mismatch**.

User memakai kata berbeda dari data.

Contoh umum:

| User Query | Document Term |
|---|---|
| car | automobile |
| lawyer | attorney |
| bug | defect |
| payment issue | settlement dispute |
| license | permit |
| illegal lending | unlicensed credit provision |

Dalam domain regulatory:

| User Query | Domain Term |
|---|---|
| fake investment | fraudulent investment scheme |
| illegal loan app | unlicensed digital lending platform |
| insider trading | market abuse / misuse of inside information |
| customer data leak | personal data breach |
| misleading ad | false or misleading representation |

Search berbasis keyword literal akan gagal jika tidak ada overlap token.

Solusi bisa berupa:

- synonym map,
- domain dictionary,
- field boosting,
- query expansion,
- semantic search,
- manual taxonomy,
- controlled vocabulary,
- tagging/enrichment pipeline,
- knowledge graph / entity extraction,
- UI assisted filtering.

Namun tiap solusi punya trade-off.

Synonym berlebihan bisa menaikkan recall tetapi menurunkan precision.

Contoh buruk:

```text
bank synonym dengan river bank dan financial institution tanpa context
```

Dalam regulatory system, synonym harus governed. Sinonim bukan sekadar daftar kata. Ia adalah bagian dari search semantics yang memengaruhi hasil investigasi.

---

## 9. Search Quality Tidak Sama untuk Semua User

Search yang “baik” bergantung pada persona dan workflow.

### 9.1 Investigator

Butuh:

- recall tinggi,
- ability to explore,
- filter fleksibel,
- highlight evidence,
- cross-entity search,
- historical data,
- explainable matching.

Toleran terhadap noise selama relevant evidence tidak hilang.

### 9.2 Case Officer

Butuh:

- search operasional,
- queue berdasarkan status/prioritas,
- exact lookup cepat,
- filter status/team/SLA,
- hasil stabil.

Butuh precision dan workflow efficiency.

### 9.3 Supervisor

Butuh:

- search by risk/severity,
- aggregated facets,
- SLA escalation,
- ownership visibility,
- trend-ish navigation.

Butuh ranking yang memasukkan business priority.

### 9.4 Auditor

Butuh:

- reproducibility,
- historical visibility,
- evidence trail,
- query/result explainability,
- no silent permission leaks,
- ability to reconstruct result context.

Butuh defensibility.

### 9.5 Public/User-Facing Search

Butuh:

- low latency,
- typo tolerance,
- intuitive ranking,
- strong precision top results,
- no internal leakage,
- graceful zero-result handling.

Kesimpulan:

```text
Search design must be workflow-aware.
```

Satu index bisa melayani banyak persona, tetapi query strategy dan ranking strategy sering perlu berbeda.

---

## 10. Search as Candidate Generation + Ranking

Mental model yang sangat berguna:

```text
Search = candidate generation + ranking + presentation
```

### 10.1 Candidate Generation

Candidate generation bertugas mengambil dokumen yang mungkin relevan.

Sumber candidate bisa:

- exact match,
- full-text match,
- synonym-expanded match,
- fuzzy match,
- vector kNN,
- recency/popularity pool,
- related entity expansion.

Candidate generation terlalu sempit:

```text
Relevant docs hilang.
```

Candidate generation terlalu luas:

```text
Ranking susah, latency naik, noise tinggi.
```

### 10.2 Ranking

Ranking mengurutkan kandidat.

Ranking bisa berbasis:

- BM25 score,
- field boosts,
- phrase match,
- recency,
- severity,
- authority,
- popularity,
- vector similarity,
- reranker model,
- manual business rule.

Ranking harus hati-hati. Business boost bisa memperbaiki UX, tetapi juga bisa merusak relevance.

Contoh:

```text
Boost semua case CRITICAL terlalu tinggi.
```

Akibat:

- critical cases selalu muncul walaupun text match lemah,
- user menganggap search broken,
- top result tidak menjawab query.

Better:

```text
Lexical relevance menentukan candidate dan base score.
Business severity menjadi tie-breaker atau bounded boost.
```

### 10.3 Presentation

Presentation menentukan bagaimana hasil dipahami user.

Elemen presentation:

- title,
- snippet,
- highlight,
- metadata,
- status badge,
- score tidak selalu ditampilkan,
- reason/explain label,
- facets,
- sorting controls,
- zero-result suggestions,
- permission-aware messaging.

Search yang relevan tetapi tidak bisa dipahami tetap terasa buruk.

---

## 11. The Search Relevance Loop

Search bukan fitur yang selesai setelah deploy.

Search system matang punya feedback loop:

```text
User queries
  -> search results
  -> clicks / selections / reformulations / no-result events
  -> analysis
  -> relevance improvements
  -> regression tests
  -> deployment
  -> monitoring
```

Sinyal yang perlu dikumpulkan:

- query populer,
- query zero-result,
- query dengan banyak reformulation,
- query yang sering menghasilkan no-click,
- clicked result position,
- manual user feedback,
- slow queries,
- permission denied after search,
- facet usage,
- exact lookup failures,
- typo patterns,
- synonym candidates.

Namun click data harus hati-hati.

Click bukan selalu relevance.

User bisa click karena:

- result paling atas,
- title misleading,
- mereka tidak punya pilihan lain,
- mereka sedang mengecek banyak item,
- UI memaksa click untuk melihat detail,
- hasil benar tapi action terjadi offline.

Untuk enterprise/regulatory search, judgment list dan domain expert review sering lebih penting daripada raw click-through rate.

---

## 12. Search Failure Modes

Search system punya failure mode khas. Top-tier engineer harus bisa mengenali pola kegagalannya.

### 12.1 Zero Result

User mencari sesuatu tetapi tidak ada hasil.

Penyebab:

- query terlalu strict,
- analyzer mismatch,
- field salah,
- data belum terindex,
- permission filter terlalu membatasi,
- synonym tidak ada,
- typo tidak ditangani,
- user memakai istilah berbeda,
- index stale,
- mapping salah.

Mitigasi:

- query relaxation,
- suggest spelling,
- synonym,
- semantic fallback,
- better no-result UX,
- indexing lag monitoring,
- analyzer debugging.

### 12.2 Too Many Results

User mendapat terlalu banyak hasil.

Penyebab:

- query terlalu broad,
- analyzer terlalu agresif,
- synonym berlebihan,
- fuzzy terlalu longgar,
- filter tidak dipakai,
- ranking lemah.

Mitigasi:

- facets,
- stronger ranking,
- phrase boost,
- better field targeting,
- query intent classification,
- controlled synonym.

### 12.3 Wrong Top Result

Hasil relevan ada, tetapi tidak di atas.

Penyebab:

- field boost salah,
- BM25 length normalization effect,
- term frequency misleading,
- business boost terlalu dominan,
- missing quality signal,
- duplicate content,
- stale document lebih tinggi.

Mitigasi:

- `_explain`,
- profile query,
- relevance judgment set,
- adjust boosts,
- add rank features,
- rescore,
- improve document modeling.

### 12.4 Stale Result

Dokumen muncul padahal status sudah berubah.

Penyebab:

- indexing lag,
- failed event processing,
- dual-write failure,
- delete not propagated,
- refresh expectation salah,
- reindex incomplete.

Elasticsearch bersifat near-real-time untuk search. Elastic menjelaskan bahwa document changes tidak langsung visible ke search dan default refresh terjadi periodik sekitar satu detik pada index yang menerima search request dalam 30 detik terakhir.

Referensi:

- Elastic Docs — Near real-time search: https://www.elastic.co/docs/manage-data/data-store/near-real-time-search

Mitigasi:

- user-facing freshness contract,
- outbox pattern,
- idempotent indexing,
- reconciliation job,
- lag metrics,
- retry/dead-letter handling,
- critical reads from source-of-truth when needed.

### 12.5 Permission Leakage

User melihat hasil atau facet count yang mengindikasikan data yang tidak boleh diketahui.

Penyebab:

- authorization filter diterapkan setelah search,
- facet dihitung sebelum permission filter,
- snippet/highlight dari field sensitif,
- index multi-tenant tanpa filter wajib,
- role change tidak propagate,
- cached response tidak scoped by user/tenant.

Mitigasi:

- permission filter di query layer,
- index-time visibility model,
- field-level masking,
- tenant-aware cache key,
- security regression tests,
- audit log.

### 12.6 Search Feels Random

User merasa hasil tidak konsisten.

Penyebab:

- no stable sort tie-breaker,
- shard-level scoring variance,
- refresh changes result order,
- deep pagination using `from/size`,
- replica differences during changes,
- business boost non-deterministic.

Mitigasi:

- deterministic tie-breaker,
- point-in-time pagination,
- search_after,
- controlled scoring,
- consistent routing where relevant.

---

## 13. Search Is Not Always the Right Interface

Tidak semua problem harus diselesaikan dengan search box.

Kadang user tidak butuh search, tetapi:

- navigation,
- saved filters,
- queue,
- workflow inbox,
- dashboard,
- report,
- recommendation,
- guided investigation,
- graph exploration,
- alert.

Contoh:

```text
“Cari kasus yang harus saya kerjakan hari ini”
```

Ini mungkin bukan full-text search. Ini queue query:

```text
assigned_to = me
status in active states
SLA due soon
priority high
blocked = false
```

Contoh lain:

```text
“Cari pihak yang terkait dengan kasus ini”
```

Ini mungkin graph/entity traversal, bukan full-text search.

Search box sering menjadi dumping ground karena UI belum punya workflow yang jelas.

Sebagai tech lead, Anda perlu membedakan:

```text
Apakah user ingin menemukan dokumen berdasarkan kata?
Apakah user ingin memilih item dari queue?
Apakah user ingin menjelajah relasi?
Apakah user ingin insight agregat?
Apakah user ingin rekomendasi tindakan?
```

Elasticsearch bisa membantu banyak hal, tetapi memaksakan semua workflow menjadi search akan membuat sistem sulit digunakan dan sulit dijaga.

---

## 14. Search UX Contract

Search backend harus punya contract dengan frontend dan user.

Pertanyaan contract:

1. Search mencari field apa saja?
2. Apakah search exact, partial, fuzzy, semantic, atau hybrid?
3. Apakah hasil diurutkan by relevance, date, priority, atau user-selected sort?
4. Apakah search mencakup archived/historical records?
5. Apakah search permission-aware?
6. Apakah facets menghitung hanya visible result?
7. Apakah result fresh secara near-real-time atau eventual?
8. Apakah query kosong valid?
9. Apakah typo ditangani?
10. Apakah query dengan simbol khusus diterima?
11. Berapa maksimal result window?
12. Apakah pagination stabil?
13. Apakah hasil bisa direproduksi untuk audit?
14. Apakah highlight boleh menampilkan sensitive text?
15. Apakah search behavior berbeda per role?

Tanpa contract, user membuat asumsi sendiri.

Contoh kontrak buruk:

```text
Search all cases.
```

Tidak jelas:

- all visible atau all system-wide?
- active only atau include closed?
- search title saja atau body juga?
- exact atau fuzzy?
- sorted by apa?
- data langsung update atau delay?

Contoh kontrak lebih baik:

```text
Search returns cases visible to your current role within your tenant. By default it searches case number, party name, case title, allegation summary, and decision summary. Active cases are shown first, then results are ranked by textual relevance and recent activity. Closed and archived cases can be included using filters. Newly updated cases may take a short time to appear in search results.
```

Ini bukan hanya documentation. Ini membantu desain teknis.

---

## 15. Search in Java Backend Architecture

Sebagai Java software engineer, Anda biasanya tidak hanya menulis query Elasticsearch langsung dari controller.

Search backend yang matang punya layering.

Contoh layering:

```text
REST/GraphQL Controller
  -> Search Request DTO
  -> Validation / Query Intent Detection
  -> Authorization Scope Resolver
  -> Search Use Case / Application Service
  -> Query Planner
  -> Elasticsearch Query Builder
  -> Elasticsearch Client
  -> Response Mapper
  -> Observability / Audit
```

### 15.1 Jangan Letakkan Query DSL Mentah di Controller

Buruk:

```java
@GetMapping("/cases/search")
public SearchResponse search(@RequestParam String q) {
    return elasticsearchClient.search(s -> s
        .index("cases")
        .query(query -> query
            .multiMatch(mm -> mm
                .query(q)
                .fields("title", "summary", "description")
            )
        ), CaseDocument.class);
}
```

Masalah:

- tidak ada permission filter,
- tidak ada validation,
- tidak ada query mode,
- tidak ada observability,
- query strategy sulit diubah,
- field hardcoded,
- no relevance control,
- no protection from expensive input.

Lebih baik secara konsep:

```text
CaseSearchController
  -> CaseSearchRequest
  -> CaseSearchService
  -> CaseSearchPolicy
  -> CaseSearchQueryPlan
  -> CaseSearchElasticQueryFactory
```

### 15.2 Query Plan Mental Model

Daripada langsung membangun Query DSL, pikirkan query plan:

```text
Input:
  q = "unlicensed lending"
  filters = { status: OPEN, severity: HIGH }
  user = investigator in tenant T1

Plan:
  scope = tenant T1 + visibility groups
  mode = full_text
  searchable fields = title^3, allegation_summary^2, decision_summary, notes
  filters = status OPEN, severity HIGH
  ranking = BM25 + active status boost + recency bounded boost
  highlight = title, allegation_summary
  pagination = first page, size 20
```

Kemudian query factory menerjemahkan plan ke Elasticsearch DSL.

Keuntungan:

- query behavior bisa diuji tanpa Elasticsearch,
- business semantics eksplisit,
- logging lebih berguna,
- relevance tuning lebih terkontrol,
- perubahan mapping bisa diisolasi.

---

## 16. Search Metrics yang Harus Dibedakan

Search punya beberapa jenis metric.

### 16.1 System Metrics

Mengukur kesehatan teknis:

- p50/p95/p99 latency,
- search error rate,
- timeout rate,
- rejected execution,
- heap pressure,
- CPU,
- disk IO,
- query cache hit,
- indexing lag,
- shard health.

### 16.2 Usage Metrics

Mengukur bagaimana search dipakai:

- query volume,
- top queries,
- filter usage,
- sort usage,
- autocomplete usage,
- pagination depth,
- zero-result rate,
- no-click rate,
- reformulation rate.

### 16.3 Quality Metrics

Mengukur kualitas hasil:

- precision@K,
- recall@K,
- MRR,
- nDCG,
- human relevance judgment,
- task success rate,
- result acceptance,
- user feedback.

### 16.4 Governance Metrics

Untuk enterprise/regulatory:

- permission leakage test pass/fail,
- stale result incidents,
- missing critical case incidents,
- reindex drift,
- synonym change audit,
- mapping change audit,
- query reproducibility for audit.

Top-tier engineer tidak hanya bertanya:

```text
Apakah query cepat?
```

Tetapi:

```text
Apakah search membantu user menyelesaikan task dengan benar, aman, cepat, dan dapat dipertanggungjawabkan?
```

---

## 17. Common Anti-Patterns

### 17.1 “Just Index Everything”

Masalah:

- field explosion,
- mapping tidak terkendali,
- sensitive field bocor,
- index membengkak,
- query menjadi tidak jelas,
- relevance noise.

Better:

```text
Index fields based on query behavior, permission needs, ranking needs, and display needs.
```

### 17.2 “Search All Fields”

Masalah:

- field penting dan tidak penting dicampur,
- relevance rusak,
- query mahal,
- match noise dari metadata.

Better:

```text
Search field groups by intent.
```

Contoh:

```text
identifier_fields: case_number, external_ref
party_fields: party_name, aliases, normalized_name
case_text_fields: title, allegation_summary, decision_summary
attachment_fields: extracted_text
```

### 17.3 “Boost Until It Looks Right”

Masalah:

- tuning subjektif,
- regression tidak terdeteksi,
- satu query membaik, query lain memburuk,
- boost menjadi magic number.

Better:

```text
Gunakan judgment set, explain score, dan relevance regression tests.
```

### 17.4 “Use Fuzzy Everywhere”

Masalah:

- short query noise,
- identifier salah match,
- latency naik,
- unexpected results.

Better:

```text
Fuzzy only for selected fields and query lengths, often as fallback or lower boost.
```

### 17.5 “Elasticsearch as Source of Truth”

Masalah:

- update semantics bukan OLTP,
- eventual search visibility,
- reindex/mapping migration,
- data repair lebih sulit,
- transactional boundary kabur.

Better:

```text
Canonical store remains system of record; Elasticsearch serves retrieval/search projection.
```

### 17.6 “Authorization After Search”

Masalah:

- result count bocor,
- facet bocor,
- ranking dipengaruhi invisible docs,
- pagination aneh,
- audit risk.

Better:

```text
Authorization must constrain candidate set before scoring, aggregation, and highlighting.
```

---

## 18. Case Study: Regulatory Case Search

Bayangkan sistem case management enforcement.

Entities:

- Case,
- Party,
- Allegation,
- Evidence Document,
- Decision,
- Action,
- SLA/Escalation,
- Assignment,
- Audit Event.

User ingin mencari:

```text
illegal loan app targeting students
```

Pertanyaan desain:

### 18.1 Apa Retrieval Unit?

Apakah hasil search harus berupa:

- case,
- party,
- evidence document,
- allegation,
- decision,
- action item?

Jika user adalah investigator, mungkin ingin evidence documents. Jika supervisor, mungkin ingin cases. Jika legal reviewer, mungkin ingin decisions.

Satu query text bisa punya retrieval unit berbeda.

### 18.2 Field Apa yang Dicari?

Mungkin:

- case title,
- allegation summary,
- party name,
- product name,
- complaint narrative,
- extracted document text,
- decision summary,
- investigation note.

Tidak semua field harus punya bobot sama.

### 18.3 Filter Apa yang Wajib?

Wajib:

- tenant,
- jurisdiction,
- user visibility,
- confidentiality level,
- legal hold scope,
- active/archived policy.

Optional:

- status,
- severity,
- assigned team,
- date,
- product type,
- violation category.

### 18.4 Ranking Apa yang Masuk Akal?

Text relevance saja mungkin tidak cukup.

Sinyal tambahan:

- open cases before closed cases,
- high severity bounded boost,
- recently active cases boost,
- exact phrase boost,
- title match stronger than notes match,
- party name exact match strong,
- legal category match boost.

Tetapi ranking harus defensible. Jangan sampai case critical tapi text tidak relevan mengalahkan case yang sangat relevan.

### 18.5 Apa Failure Terburuk?

Dalam domain ini, failure terburuk bukan hanya latency lambat.

Lebih berbahaya:

- case relevan tidak ditemukan,
- user melihat case rahasia,
- stale status menyebabkan action salah,
- audit tidak bisa merekonstruksi kenapa hasil muncul,
- synonym change mengubah hasil tanpa governance,
- archived decision tidak muncul saat legal reviewer butuh precedent.

Search design harus memperhitungkan failure ini sejak awal.

---

## 19. Search Design Checklist Awal

Sebelum membuat index atau mapping, jawab pertanyaan berikut.

### 19.1 User and Workflow

- Siapa user utama?
- Mereka mencari apa?
- Mereka ingin result berupa entity apa?
- Mereka lebih butuh recall atau precision?
- Apa tindakan setelah menemukan hasil?
- Apa konsekuensi jika hasil salah?

### 19.2 Query Types

- Apakah ada exact identifier search?
- Apakah ada name search?
- Apakah ada full-text document search?
- Apakah ada autocomplete?
- Apakah ada semantic/concept search?
- Apakah ada investigative broad search?
- Apakah ada saved filter/queue yang sebenarnya bukan search?

### 19.3 Data and Indexing

- Apa source of truth?
- Bagaimana data masuk ke Elasticsearch?
- Bagaimana update/delete dipropagasi?
- Berapa freshness expectation?
- Apa document versioning strategy?
- Apa reconciliation strategy?

### 19.4 Authorization

- Apakah visibility per tenant, role, team, case, field, atau document?
- Apakah facet count boleh mengungkap invisible data?
- Apakah highlight boleh menampilkan sensitive fields?
- Bagaimana role changes dipropagasi?

### 19.5 Relevance

- Field mana paling penting?
- Apa exact match harus menang?
- Apa phrase match penting?
- Apa synonym diperlukan?
- Apa freshness/severity/status memengaruhi ranking?
- Bagaimana ranking diuji?

### 19.6 Operations

- Berapa expected QPS?
- Berapa corpus size?
- Berapa document growth?
- Berapa acceptable latency?
- Apa timeout behavior?
- Apa fallback jika Elasticsearch unavailable?
- Apa monitoring dan alerting?

---

## 20. Mental Model Summary

Search yang baik bukan dimulai dari query DSL. Search yang baik dimulai dari problem framing.

Pegang model berikut:

```text
User intent
  -> query interpretation
  -> authorization scope
  -> candidate generation
  -> relevance scoring
  -> business-aware ranking
  -> result presentation
  -> feedback loop
  -> continuous improvement
```

Dan selalu pisahkan:

```text
Lookup != Search
Filter != Ranking
Exact != Fuzzy
Lexical != Semantic
Candidate generation != Final ranking
Search freshness != OLTP read-after-write
Search result visibility != application detail-page authorization
```

Untuk engineer berpengalaman, Elasticsearch menjadi powerful ketika digunakan sebagai **search projection** yang dirancang dari query behavior, bukan sebagai tempat dumping JSON agar “bisa dicari”.

---

## 21. Apa yang Harus Anda Kuasai Setelah Part Ini

Setelah part ini, Anda seharusnya bisa menjelaskan:

1. Perbedaan lookup, filtering, full-text search, discovery, recommendation, dan semantic retrieval.
2. Mengapa search adalah problem relevance, bukan hanya matching.
3. Apa itu recall dan precision, serta trade-off-nya.
4. Mengapa ranking adalah inti search experience.
5. Mengapa query intent penting.
6. Apa itu vocabulary mismatch.
7. Mengapa search quality bergantung pada persona dan workflow.
8. Mengapa search perlu feedback loop.
9. Failure mode umum search system.
10. Mengapa authorization harus masuk sebelum scoring/aggregation/highlighting.
11. Mengapa Elasticsearch biasanya bukan source of truth.
12. Bagaimana mulai mendesain search untuk enterprise/regulatory case management.

Jika konsep ini belum jelas, jangan buru-buru masuk Query DSL. Query DSL akan terlihat seperti kumpulan syntax acak tanpa mental model ini.

---

## 22. Latihan Berpikir

Gunakan latihan ini sebelum lanjut ke Part 002.

### Latihan 1 — Klasifikasi Query

Klasifikasikan query berikut sebagai lookup, filter, full-text, semantic, autocomplete, atau investigative search:

```text
CASE-2026-000812
open cases assigned to me
illegal loan app
John Smith
market manipulation similar to case ABC
payment dispute evidence PDF
cases due this week
```

Untuk tiap query, jawab:

- retrieval unit-nya apa?
- perlu exact atau fuzzy?
- perlu ranking atau hanya filtering?
- apa failure terburuk?

### Latihan 2 — Recall vs Precision

Untuk query:

```text
unlicensed lending
```

Buat dua strategi:

1. strategi high recall,
2. strategi high precision.

Bandingkan trade-off-nya.

### Latihan 3 — Permission Leakage

Bayangkan user hanya boleh melihat case dari team A. Search UI menampilkan facet:

```text
Team A: 12
Team B: 4
Team C: 8
```

Padahal result list hanya menampilkan Team A.

Pertanyaan:

- Apa yang bocor?
- Di layer mana kesalahannya?
- Bagaimana desain query yang benar?

### Latihan 4 — Vocabulary Mismatch

Cari 10 istilah di domain Anda yang kemungkinan punya sinonim antara bahasa user dan bahasa dokumen.

Contoh:

```text
fake investment -> fraudulent investment scheme
illegal loan -> unlicensed lending
```

Untuk tiap istilah, tentukan apakah sebaiknya diselesaikan dengan:

- synonym,
- analyzer,
- tagging,
- semantic search,
- UI filter,
- atau data normalization.

---

## 23. Bridge ke Part 002

Part ini membahas search problem dari sisi user, workflow, dan relevance.

Part 002 akan masuk ke mesin konseptualnya:

```text
Bagaimana search engine bisa menemukan dokumen cepat dari corpus besar?
```

Kita akan membahas:

- corpus,
- document,
- field,
- term,
- token,
- posting list,
- inverted index,
- Boolean retrieval,
- ranked retrieval,
- mental model biaya query.

Dengan kata lain, Part 002 mulai menjawab:

> “Apa struktur data dan algoritma dasar yang membuat search engine berbeda dari database biasa?”

---

## References

- Elastic Docs — How full-text search works: https://www.elastic.co/docs/solutions/search/full-text/how-full-text-works
- Elastic Docs — Near real-time search: https://www.elastic.co/docs/manage-data/data-store/near-real-time-search
- Elastic Docs — Vector search: https://www.elastic.co/docs/solutions/search/vector
- Elastic Docs — Semantic search: https://www.elastic.co/docs/solutions/search/semantic-search
- Elastic Blog — Practical BM25, Part 1: https://www.elastic.co/blog/practical-bm25-part-1-how-shards-affect-relevance-scoring-in-elasticsearch
- Apache Lucene — BM25Similarity API: https://lucene.apache.org/core/8_1_1/core/org/apache/lucene/search/similarities/BM25Similarity.html

---

## Status Seri

Part 001 selesai.  
Seri belum selesai. Lanjut ke Part 002: `Information Retrieval Core Model`.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-000.md">⬅️ Learn Search Engine Database and Elasticsearch Mastery for Java Engineers — Part 000</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-002.md">Part 002 — Information Retrieval Core Model ➡️</a>
</div>
