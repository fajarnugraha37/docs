# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-010.md

# Part 010 — Relevance Engineering I: Scoring, Ranking, and BM25

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Bagian: `010 / 034`  
> Topik: Relevance engineering dasar, scoring, ranking, BM25, explainability  
> Target pembaca: Java software engineer yang ingin memahami Elasticsearch sebagai retrieval engine, bukan hanya query store

---

## 0. Posisi Part Ini Dalam Seri

Sampai titik ini kita sudah membangun fondasi berikut:

- Part 000: orientasi search engine database dan Elasticsearch.
- Part 001: search sebagai problem relevance, bukan lookup biasa.
- Part 002: information retrieval core model.
- Part 003: Lucene internals.
- Part 004: Elasticsearch distributed architecture.
- Part 005: document modeling for search.
- Part 006: mapping mastery.
- Part 007: text analysis pipeline.
- Part 008: Query DSL foundations.
- Part 009: full-text query patterns.

Sekarang kita masuk ke topik yang memisahkan engineer yang “bisa memakai Elasticsearch” dari engineer yang benar-benar “bisa membangun search system”: **relevance engineering**.

Banyak tim memperlakukan Elasticsearch seperti ini:

```text
user input -> match query -> result list
```

Lalu ketika user berkata:

```text
"Kenapa hasil yang paling relevan tidak muncul di atas?"
```

respons engineering sering menjadi:

```text
"Tambahkan boost saja."
"Pakai fuzzy saja."
"Naikkan weight field title."
"Ganti analyzer."
"Pakai semantic search."
```

Masalahnya: semua tindakan itu mungkin benar, mungkin juga salah. Tanpa mental model scoring, Anda hanya melakukan ranking by superstition.

Part ini membangun fondasi agar Anda bisa menjawab:

- Mengapa dokumen A ranking lebih tinggi daripada dokumen B?
- Mengapa keyword yang jarang muncul bisa sangat memengaruhi score?
- Mengapa dokumen pendek sering menang dari dokumen panjang?
- Mengapa field yang sama dengan analyzer berbeda menghasilkan ranking berbeda?
- Mengapa boosting kadang memperbaiki relevance, kadang merusak?
- Bagaimana membaca `_score` secara realistis?
- Bagaimana memakai `_explain` tanpa tersesat dalam detail internal?
- Bagaimana membedakan scoring issue, analysis issue, modeling issue, dan query issue?

---

## 1. Core Thesis

Search result bukan sekadar “dokumen yang match”. Search result adalah **dokumen yang match, lalu diurutkan berdasarkan model relevance tertentu**.

Elasticsearch secara default menggunakan BM25 similarity untuk text relevance. BM25 adalah model ranking statistik yang memperhitungkan beberapa sinyal utama:

1. query term apa yang muncul di dokumen,
2. seberapa sering term itu muncul,
3. seberapa langka term itu di seluruh index,
4. seberapa panjang field dokumen dibanding rata-rata,
5. boost dari field/query,
6. koordinasi query dan struktur query.

Lucene menyediakan implementasi BM25Similarity, dengan parameter seperti `k1` untuk mengontrol saturasi term frequency dan `b` untuk mengontrol normalisasi panjang dokumen. Elasticsearch memakai BM25 sebagai default similarity untuk banyak kebutuhan full-text search. Referensi resmi Lucene menjelaskan `k1` sebagai kontrol non-linear term-frequency saturation dan `b` sebagai kontrol degree of document-length normalization.

Mental model paling ringkas:

```text
_score = seberapa kuat dokumen ini menjawab query ini,
         berdasarkan statistik index, struktur query, field, analyzer,
         dan konfigurasi similarity.
```

Tetapi ada batas penting:

```text
_score bukan probabilitas benar.
_score bukan confidence absolut.
_score bukan nilai yang stabil lintas query.
_score bukan metrik bisnis.
_score hanya comparable secara bermakna di dalam konteks query yang sama.
```

---

## 2. Why Ranking Is The Heart Of Search

Search tanpa ranking hanya filtering.

Misalnya user mencari:

```text
"late payment enforcement notice"
```

Ada 100.000 dokumen yang mungkin mengandung salah satu kata tersebut. Search engine harus memilih dokumen mana yang ditampilkan di halaman pertama.

Secara produk, ranking menjawab:

```text
Dari semua dokumen yang match, mana yang paling layak dilihat user lebih dulu?
```

Secara engineering, ranking adalah hasil dari:

```text
analysis + indexing + query construction + scoring model + business signals + result shaping
```

Jadi masalah relevance tidak selalu bisa diselesaikan di query layer.

Contoh:

| Symptom | Kemungkinan akar masalah |
|---|---|
| Dokumen yang jelas relevan tidak muncul | Analyzer salah, field tidak indexed, filter terlalu ketat, document model salah |
| Dokumen muncul tapi ranking rendah | Field boost kurang tepat, BM25 field-length effect, term langka di dokumen lain, query terlalu longgar |
| Dokumen tidak relevan muncul tinggi | Analyzer terlalu agresif, synonym buruk, field terlalu umum, boost salah |
| Exact identifier kalah dari natural-language text | Identifier tidak dimodelkan sebagai keyword/exact field |
| Dokumen lama selalu menang | Tidak ada freshness signal |
| Dokumen populer tapi kurang match menang | Business score terlalu dominan |

Top-tier engineer tidak langsung “menaikkan boost”. Mereka bertanya:

```text
Apakah ini problem matching, scoring, modeling, analysis, filtering, atau business ranking?
```

---

## 3. Scoring Starts Before Query Time

Kesalahan umum: mengira scoring terjadi hanya saat query dieksekusi.

Sebenarnya scoring ditentukan oleh keputusan yang dibuat jauh sebelumnya.

### 3.1 Index-Time Decisions

Saat indexing:

- document dipecah menjadi field,
- field dianalisis oleh analyzer,
- token dihasilkan,
- token dimasukkan ke inverted index,
- statistik term/field dikumpulkan,
- norm/field-length information disimpan untuk text field tertentu,
- segment terbentuk.

Keputusan ini memengaruhi score nanti.

Contoh:

```json
{
  "title": "Payment Enforcement Notice",
  "body": "This notice relates to late payment enforcement..."
}
```

Jika `title` dianalisis sebagai `text`, query `payment enforcement` bisa match secara full-text.

Jika `title` hanya `keyword`, query full-text tidak bekerja seperti yang diharapkan.

Jika `body` memakai stemming agresif, term yang dianggap match bisa berubah.

Jika `synonym` memperluas `notice` menjadi `letter`, dokumen bisa match query yang tidak mengandung `notice`.

### 3.2 Query-Time Decisions

Saat query:

- user input dianalisis,
- query DSL membentuk clause,
- clause menentukan query context/filter context,
- tiap field punya statistics sendiri,
- scoring dihitung per matching document,
- top-K result dikumpulkan.

Contoh query:

```json
{
  "query": {
    "match": {
      "title": "payment enforcement notice"
    }
  }
}
```

Berbeda dengan:

```json
{
  "query": {
    "multi_match": {
      "query": "payment enforcement notice",
      "fields": ["title^3", "body"]
    }
  }
}
```

Query kedua memberi sinyal bahwa match di `title` lebih penting daripada match di `body`.

---

## 4. `_score`: What It Is And What It Is Not

Elasticsearch mengembalikan `_score` untuk hasil query yang berjalan dalam query context.

Contoh respons sederhana:

```json
{
  "hits": {
    "hits": [
      {
        "_index": "cases-v1",
        "_id": "CASE-001",
        "_score": 12.384,
        "_source": {
          "title": "Late Payment Enforcement Notice"
        }
      },
      {
        "_index": "cases-v1",
        "_id": "CASE-002",
        "_score": 8.912,
        "_source": {
          "title": "Payment Review Summary"
        }
      }
    ]
  }
}
```

Interpretasi yang benar:

```text
Untuk query ini, berdasarkan scoring model dan index statistics saat ini,
CASE-001 dipandang lebih relevan daripada CASE-002.
```

Interpretasi yang salah:

```text
CASE-001 memiliki relevance absolut 12.384.
CASE-001 dua kali lebih relevan dari dokumen dengan score 6.192.
Score 12.384 di query ini bisa dibandingkan dengan score 12.384 di query lain.
```

Score dipengaruhi oleh banyak variabel lokal:

- query text,
- analyzer,
- field,
- index statistics,
- shard statistics,
- boost,
- similarity setting,
- query structure,
- matching terms,
- field length,
- filters,
- segment/index changes.

Jadi `_score` adalah ranking signal, bukan business truth.

---

## 5. BM25 Intuition

BM25 bisa dipahami sebagai jawaban terhadap tiga pertanyaan:

```text
1. Apakah query term muncul di dokumen?
2. Apakah term itu penting karena jarang di corpus?
3. Apakah kemunculan term itu signifikan dibanding panjang field dokumen?
```

BM25 bukan sekadar menghitung jumlah kemunculan term. Ia menghindari asumsi sederhana seperti:

```text
Jika kata "payment" muncul 20 kali, dokumen pasti 20x lebih relevan daripada dokumen yang kata itu muncul 1 kali.
```

Mengapa? Karena term frequency mengalami saturasi.

Dokumen yang menyebut `payment` 2 kali mungkin lebih relevan daripada yang menyebut 1 kali. Tetapi dokumen yang menyebut `payment` 200 kali belum tentu 100x lebih relevan daripada yang menyebut 2 kali.

BM25 memperlakukan pengulangan term sebagai sinyal yang meningkat tetapi makin lama makin jenuh.

---

## 6. Three Core Components Of BM25

Untuk practical engineering, pahami tiga komponen ini:

1. **TF**: term frequency.
2. **IDF**: inverse document frequency.
3. **Field length normalization**.

### 6.1 Term Frequency

Term frequency menjawab:

```text
Berapa kali query term muncul dalam field dokumen?
```

Misalnya query:

```text
"payment enforcement"
```

Dokumen A:

```text
Payment enforcement notice for overdue payment.
```

Dokumen B:

```text
This document discusses payment, payment, payment, payment, payment...
```

Term frequency `payment` di B lebih tinggi. Tetapi BM25 tidak menaikkan score secara linear.

Mental model:

```text
1 occurrence  -> sinyal awal
2 occurrence  -> sinyal lebih kuat
5 occurrence  -> masih lebih kuat
50 occurrence -> tambahan sinyal kecil
500 occurrence -> hampir tidak memberi tambahan meaning
```

Ini disebut **term frequency saturation**.

Lucene BM25Similarity memiliki parameter `k1` yang mengontrol saturasi ini. Nilai `k1` lebih tinggi membuat TF terus memberi pengaruh lebih lama; nilai lebih rendah membuat TF lebih cepat jenuh.

### 6.2 Inverse Document Frequency

IDF menjawab:

```text
Seberapa langka term ini di corpus?
```

Term yang muncul di hampir semua dokumen biasanya kurang informatif.

Contoh dalam case-management system:

| Term | Muncul di banyak dokumen? | Informative? |
|---|---:|---:|
| `case` | sangat banyak | rendah |
| `document` | sangat banyak | rendah |
| `payment` | banyak | sedang |
| `enforcement` | sedang | tinggi |
| `injunction` | sedikit | sangat tinggi |
| `AML-CTR-2024-9912` | sangat sedikit | ekstrem tinggi |

Jika query mengandung term langka, dokumen yang mengandung term itu cenderung naik.

Ini masuk akal karena term langka sering lebih membedakan dokumen relevan dari dokumen umum.

Tetapi ada failure mode:

```text
Rare term can dominate ranking even when it is not central to user intent.
```

Contoh query:

```text
"payment compliance jakarta"
```

Jika `jakarta` jarang di corpus, dokumen yang hanya menyebut Jakarta bisa naik, walaupun substansi payment compliance-nya lemah.

Ini bukan bug murni. Ini konsekuensi dari statistical relevance.

### 6.3 Field Length Normalization

Field length normalization menjawab:

```text
Apakah term muncul di field pendek yang fokus, atau field panjang yang berisi banyak hal?
```

Misalnya query:

```text
"late payment"
```

Dokumen A title:

```text
Late Payment Notice
```

Dokumen B body:

```text
... 40 halaman narasi case yang di dalamnya ada phrase late payment satu kali ...
```

Secara intuitif, match di title pendek lebih kuat daripada match satu kali di body panjang.

BM25 memberi normalisasi berdasarkan panjang field. Field yang lebih pendek dan fokus bisa mendapat score lebih tinggi jika mengandung query term.

Lucene BM25Similarity memiliki parameter `b` untuk mengontrol seberapa kuat document length menormalkan TF. Nilai `b` mendekati 0 berarti panjang field kurang berpengaruh; nilai mendekati 1 berarti panjang field lebih berpengaruh.

---

## 7. BM25 Simplified Formula Intuition

Anda tidak perlu menghafal rumus lengkap untuk menjadi efektif, tetapi perlu memahami bentuknya.

Secara sederhana:

```text
score(document, query)
  = sum over query terms (
      IDF(term)
      * saturated_TF(term in document)
      * field_length_normalization
      * boost
    )
```

Untuk query multi-term:

```text
"payment enforcement notice"
```

Score dokumen kira-kira adalah gabungan kontribusi dari:

```text
payment      contribution
+ enforcement contribution
+ notice      contribution
```

Setiap term punya IDF berbeda.

Jika `enforcement` lebih langka daripada `payment`, kontribusinya bisa lebih kuat.

Jika `notice` muncul di banyak dokumen template, kontribusinya bisa lebih lemah.

Jika semua term muncul di title pendek, score bisa tinggi.

Jika hanya satu term muncul di body panjang, score lebih rendah.

---

## 8. Practical Example: Why Document A Beats Document B

Misalnya corpus berisi regulatory case documents.

Query:

```text
"late payment enforcement"
```

Dokumen A:

```json
{
  "title": "Late Payment Enforcement Notice",
  "body": "A formal notice issued after repeated late payment failures."
}
```

Dokumen B:

```json
{
  "title": "Payment Case Summary",
  "body": "The case contains a long procedural history. Enforcement action was considered after multiple correspondence records. Late submission of payment was mentioned in appendix C..."
}
```

Dokumen A mungkin menang karena:

- semua term muncul di `title`,
- `title` pendek,
- phrase/term proximity lebih baik jika query mendukung phrase,
- field boost title mungkin lebih tinggi,
- term distribution lebih fokus.

Dokumen B mungkin memiliki semua term juga, tetapi:

- tersebar di body panjang,
- tidak berdekatan,
- konteksnya kurang fokus,
- title hanya match `payment`,
- field length normalization menurunkan kontribusi body.

Kesimpulan:

```text
Ranking bukan hanya apakah term muncul.
Ranking memperhitungkan di mana term muncul, seberapa langka term itu, seberapa sering muncul, dan seberapa fokus field-nya.
```

---

## 9. Field-Level Scoring

Elasticsearch menghitung score berdasarkan field yang di-query.

Contoh mapping konseptual:

```json
{
  "mappings": {
    "properties": {
      "title": { "type": "text" },
      "summary": { "type": "text" },
      "body": { "type": "text" },
      "caseNumber": { "type": "keyword" }
    }
  }
}
```

Query:

```json
{
  "query": {
    "multi_match": {
      "query": "late payment enforcement",
      "fields": ["title^4", "summary^2", "body"]
    }
  }
}
```

Mental model:

```text
Match di title   -> sangat penting
Match di summary -> penting
Match di body    -> normal
```

Tetapi boosting bukan magic.

Jika `title^20`, Anda mungkin menciptakan masalah:

```text
Dokumen dengan title lemah tapi mengandung satu term bisa mengalahkan dokumen body/summary yang lebih substansial.
```

Boost harus dipakai sebagai ekspresi domain intent, bukan alat panik.

---

## 10. Query Context vs Filter Context In Relevance

Dari Part 008, kita tahu ada dua konteks:

- query context: menghasilkan score,
- filter context: hanya include/exclude, tidak scoring.

Contoh:

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "late payment enforcement" } }
      ],
      "filter": [
        { "term": { "tenantId": "tenant-a" } },
        { "term": { "visibility": "public" } }
      ]
    }
  }
}
```

Di sini:

```text
match title        -> memengaruhi score
term tenantId      -> tidak memengaruhi score
term visibility    -> tidak memengaruhi score
```

Ini biasanya benar.

Authorization, tenant, lifecycle visibility, dan status hard-filter biasanya tidak boleh memengaruhi relevance. Mereka menentukan eligibility.

Tetapi ada kasus status bisa menjadi ranking signal.

Misalnya:

```text
active investigation lebih penting daripada closed archived case.
```

Jika status hanya eligibility:

```json
{ "term": { "status": "active" } }
```

Jika status ranking signal:

```json
{
  "bool": {
    "should": [
      { "term": { "status": { "value": "active", "boost": 2.0 } } }
    ]
  }
}
```

Atau di Part 011 nanti, kita gunakan `function_score`/decay/rank feature secara lebih rapi.

---

## 11. Boolean Query Structure Changes Ranking

Query structure memengaruhi siapa yang match dan bagaimana score dihitung.

### 11.1 `must`

```json
{
  "bool": {
    "must": [
      { "match": { "title": "payment" } },
      { "match": { "title": "enforcement" } }
    ]
  }
}
```

Artinya:

```text
Dokumen harus match payment dan enforcement.
Keduanya dapat berkontribusi pada score.
```

### 11.2 `should`

```json
{
  "bool": {
    "should": [
      { "match": { "title": "payment" } },
      { "match": { "title": "enforcement" } }
    ]
  }
}
```

Artinya tergantung konteks dan `minimum_should_match`:

```text
Dokumen yang match lebih banyak should clause biasanya score lebih tinggi.
```

### 11.3 `filter`

```json
{
  "bool": {
    "filter": [
      { "term": { "status": "open" } }
    ]
  }
}
```

Artinya:

```text
Hanya eligibility. Tidak memberi score.
```

### 11.4 Failure Mode

Misalnya user mencari:

```text
"payment enforcement"
```

Jika Anda membuat query terlalu longgar:

```json
{
  "match": {
    "body": {
      "query": "payment enforcement",
      "operator": "or"
    }
  }
}
```

Dokumen yang hanya mengandung `payment` bisa muncul banyak.

Jika terlalu ketat:

```json
{
  "match": {
    "body": {
      "query": "payment enforcement",
      "operator": "and"
    }
  }
}
```

Dokumen relevan yang memakai istilah `collection action` bukan `enforcement` bisa hilang.

Top-tier design sering membutuhkan:

```text
hard intent terms + optional enrichment terms + phrase/proximity boost + field boost + filters
```

---

## 12. `minimum_should_match` As Relevance Control

`minimum_should_match` adalah salah satu alat penting untuk mengontrol recall/precision.

Contoh:

```json
{
  "query": {
    "match": {
      "body": {
        "query": "late payment enforcement notice",
        "minimum_should_match": "75%"
      }
    }
  }
}
```

Artinya kira-kira:

```text
Jangan cukup match satu kata saja. Mayoritas term harus match.
```

Ini berguna untuk query panjang.

Tanpa kontrol ini, query panjang bisa menghasilkan dokumen yang match satu common term saja.

Contoh user query:

```text
"late payment enforcement notice for repeated violation"
```

Jika dokumen hanya mengandung `payment`, apakah layak muncul di top result?

Mungkin tidak.

Tetapi jika `minimum_should_match` terlalu tinggi, dokumen yang relevan tapi memakai vocabulary berbeda akan hilang.

Prinsip:

```text
minimum_should_match mengatur precision gate.
Synonym/semantic expansion mengatur vocabulary bridge.
Boosting mengatur ordering.
```

Jangan mencampur semuanya menjadi boost.

---

## 13. Field Boosting: Useful But Dangerous

Field boost adalah cara memberitahu search engine bahwa field tertentu lebih penting.

Contoh:

```json
{
  "query": {
    "multi_match": {
      "query": "payment enforcement",
      "fields": [
        "title^5",
        "summary^2",
        "body"
      ]
    }
  }
}
```

Makna domain:

```text
Jika query term muncul di title, itu sinyal lebih kuat daripada jika hanya muncul di body.
```

Ini masuk akal karena title biasanya ringkasan niat dokumen.

Namun boost bisa merusak jika:

- nilai boost terlalu ekstrem,
- field berisi data noisy,
- title sering template/generic,
- body mengandung substansi lebih penting,
- boost dipakai untuk menutupi modeling buruk,
- tidak ada relevance evaluation.

Contoh title generic:

```text
"Case Document"
"Payment Document"
"Notice"
"Summary"
```

Jika `title^10`, dokumen dengan title generic bisa menang karena match term umum.

Boost harus diuji dengan query set, bukan feeling.

---

## 14. Score Explainability With `_explain`

Elasticsearch menyediakan Explain API untuk menjelaskan bagaimana score dihitung untuk dokumen tertentu.

Contoh:

```http
GET /cases-v1/_explain/CASE-001
{
  "query": {
    "match": {
      "title": "late payment enforcement"
    }
  }
}
```

Responsnya berisi tree penjelasan scoring.

Anda akan melihat informasi seperti:

- apakah document match,
- weight per term,
- boost,
- IDF,
- TF normalization,
- field length norm,
- detail nested scoring.

Tujuan `_explain` bukan untuk membuat Anda menghafal setiap angka internal.

Tujuan `_explain`:

```text
Membantu menemukan faktor dominan yang membuat dokumen ranking tinggi/rendah.
```

Pertanyaan saat membaca `_explain`:

1. Term apa yang match?
2. Field apa yang memberi kontribusi score terbesar?
3. Apakah boost bekerja seperti yang diharapkan?
4. Apakah term langka mendominasi?
5. Apakah field length normalization terlalu kuat?
6. Apakah analyzer menghasilkan token yang mengejutkan?
7. Apakah clause yang seharusnya filter ternyata scoring?
8. Apakah query terlalu longgar?

---

## 15. `_explain` Debugging Workflow

Misalnya user melaporkan:

```text
"CASE-002 harusnya lebih tinggi dari CASE-001 untuk query 'payment enforcement'."
```

Jangan langsung ubah boost.

Ikuti workflow:

### Step 1 — Ambil dua dokumen

```text
CASE-001: ranking terlalu tinggi
CASE-002: ranking terlalu rendah
```

Bandingkan field penting:

```json
{
  "title": "Payment Enforcement Notice",
  "summary": "Notice for late fee",
  "body": "..."
}
```

vs

```json
{
  "title": "Late Fee Collection Action",
  "summary": "Enforcement action for repeated payment failure",
  "body": "..."
}
```

### Step 2 — Jalankan `_analyze`

Cek token query dan token field.

Pertanyaan:

```text
Apakah 'collection action' dipahami sebagai sinonim enforcement?
Apakah 'late fee' dipahami sebagai payment-related?
```

Jika tidak, problemnya mungkin analyzer/synonym, bukan BM25.

### Step 3 — Jalankan `_explain` untuk dua dokumen

Bandingkan:

- matching terms,
- field contribution,
- IDF,
- boost,
- length norm.

### Step 4 — Klasifikasikan problem

Kemungkinan:

```text
A. Query vocabulary mismatch
B. Field boost issue
C. Document model issue
D. Analyzer issue
E. Synonym gap
F. Business ranking signal missing
G. User expectation mismatch
```

### Step 5 — Pilih intervensi paling kecil

Jangan lakukan lima perubahan sekaligus.

Intervensi yang mungkin:

- tambah synonym,
- ubah query composition,
- adjust field boost,
- tambah phrase boost,
- tambahkan business signal,
- pisahkan exact identifier field,
- revisi document model.

### Step 6 — Uji regression

Pastikan query lain tidak rusak.

---

## 16. `_explain` vs `_profile`

Jangan campur dua alat ini.

| Tool | Untuk menjawab |
|---|---|
| `_explain` | Kenapa dokumen ini mendapat score seperti ini? |
| `_profile` | Bagian query mana yang mahal/lambat? |

Contoh:

```text
Result tidak relevan -> gunakan _explain.
Query lambat -> gunakan _profile.
```

Kadang keduanya dipakai bersama.

Misalnya query lambat dan ranking buruk. Tetapi urutan berpikir tetap harus jelas:

```text
correctness/relevance dulu, performance kemudian.
```

Karena query yang cepat tapi salah tetap buruk.

---

## 17. Common Relevance Failure Modes

### 17.1 Common Term Dominance

Query:

```text
"case payment notice"
```

Jika `case` dan `notice` muncul di hampir semua dokumen, result bisa terasa generik.

Solusi mungkin:

- stopword domain-specific,
- field boost lebih tepat,
- minimum_should_match,
- phrase boost,
- query intent parsing,
- synonym/normalization.

### 17.2 Rare Term Over-Dominance

Query:

```text
"payment compliance jakarta"
```

Jika `jakarta` sangat langka, dokumen dengan Jakarta bisa naik walau payment compliance lemah.

Solusi mungkin:

- treat location as filter/facet when user intent location,
- use structured field for location,
- reduce weight field tertentu,
- query rewrite intent-aware.

### 17.3 Long Body Wins Too Often

Dokumen panjang punya banyak kesempatan match banyak term.

Walau BM25 menormalkan field length, body panjang tetap bisa match banyak clause.

Solusi:

- field boosting title/summary,
- passage/chunk indexing,
- copy_to curated searchable field,
- rescore top result dengan phrase/proximity,
- split document into retrieval units.

### 17.4 Template Text Pollutes Relevance

Banyak dokumen punya boilerplate:

```text
This notice is issued pursuant to applicable regulatory provisions...
```

Jika boilerplate di-index penuh, query legal/regulatory umum bisa match semua dokumen.

Solusi:

- exclude boilerplate from searchable field,
- put boilerplate in non-scoring field,
- use field-specific search,
- detect repeated text,
- content extraction pipeline cleanup.

### 17.5 Identifier Search Treated As Full Text

User mencari:

```text
"CASE-2024-001927"
```

Jika field identifier dianalisis seperti text biasa, token bisa pecah aneh.

Solusi:

```text
identifier harus punya keyword/exact field.
```

Biasanya gunakan multi-field:

```json
{
  "caseNumber": {
    "type": "keyword",
    "fields": {
      "text": { "type": "text" }
    }
  }
}
```

Atau lebih eksplisit:

```json
{
  "caseNumber": { "type": "keyword" },
  "caseNumberSearch": { "type": "text", "analyzer": "identifier_analyzer" }
}
```

### 17.6 Boost Arms Race

Tim mulai dengan:

```text
title^2
```

Lalu bug report datang:

```text
title^5
```

Lalu:

```text
title^20
summary^12
body^0.1
status^100
```

Akhirnya ranking menjadi tidak bisa dijelaskan.

Solusi:

- buat query set,
- ukur relevance,
- dokumentasikan alasan boost,
- batasi rentang boost,
- pisahkan lexical score dan business score,
- gunakan function_score/rank_feature untuk sinyal domain.

---

## 18. Relevance Debugging Taxonomy

Saat relevance buruk, klasifikasikan dulu.

### 18.1 Matching Problem

Dokumen relevan tidak muncul sama sekali.

Cek:

- filter terlalu ketat,
- field tidak di-query,
- analyzer mismatch,
- synonym tidak ada,
- mapping salah,
- document belum terindex,
- permission filter menghapus dokumen,
- `minimum_should_match` terlalu tinggi.

### 18.2 Ranking Problem

Dokumen relevan muncul tapi ranking rendah.

Cek:

- field boost,
- term rarity,
- field length,
- query structure,
- phrase/proximity,
- business signals,
- document too long/noisy,
- title/summary kosong atau generic.

### 18.3 Interpretation Problem

Search engine melakukan hal yang masuk akal, tapi user intent berbeda.

Contoh query:

```text
"appeal"
```

User bisa bermaksud:

- legal appeal,
- appeal status,
- appeal document,
- appeal deadline,
- case with appeal history.

Solusi:

- query intent detection,
- facets,
- UI disambiguation,
- search verticals,
- curated ranking.

### 18.4 Data Quality Problem

Search buruk karena data buruk.

Cek:

- missing title,
- inconsistent status,
- OCR noise,
- duplicated document,
- stale document,
- bad language detection,
- malformed identifiers,
- copied boilerplate.

Elasticsearch tidak bisa membuat data buruk otomatis menjadi search bagus.

---

## 19. Relevance Engineering For Java Engineers

Dari perspektif Java backend, relevance tidak boleh tersebar sebagai JSON string acak di controller.

### 19.1 Bad Pattern

```java
String query = "{\"query\":{\"match\":{\"title\":\"" + userInput + "\"}}}";
```

Masalah:

- raw string fragile,
- injection-like query issues,
- sulit test,
- sulit evolve,
- tidak ada intent abstraction,
- tidak ada query observability.

### 19.2 Better Pattern

Pisahkan:

```text
SearchRequestDto
  -> SearchIntent
  -> QueryPlan
  -> Elasticsearch Query DSL
  -> ResultMapper
```

Contoh class konseptual:

```java
public record SearchRequestDto(
    String q,
    List<String> statuses,
    String tenantId,
    int size,
    String after
) {}
```

```java
public sealed interface SearchIntent permits
    IdentifierLookupIntent,
    FullTextSearchIntent,
    FilterOnlyBrowseIntent,
    AdvancedSearchIntent {
}
```

```java
public record QueryPlan(
    boolean exactIdentifierBoost,
    boolean usePhraseBoost,
    boolean useFuzzyFallback,
    float titleBoost,
    float summaryBoost,
    float bodyBoost
) {}
```

Ini membuat relevance decision eksplisit.

### 19.3 Query Builder Should Encode Policy

Misalnya:

```java
public final class CaseSearchQueryFactory {

    public Query build(CaseSearchIntent intent) {
        return switch (intent) {
            case IdentifierLookupIntent id -> buildIdentifierLookup(id);
            case FullTextSearchIntent fullText -> buildFullText(fullText);
            case FilterOnlyBrowseIntent browse -> buildBrowseQuery(browse);
            case AdvancedSearchIntent advanced -> buildAdvanced(advanced);
        };
    }
}
```

Tujuan:

```text
Business/search policy hidup di query factory/service,
bukan tersebar di controller, repository, atau UI.
```

---

## 20. Designing A Baseline Relevance Query

Untuk banyak sistem case/document search, baseline query bisa terdiri dari:

1. hard filters,
2. exact identifier clause,
3. title/summary/body full-text clause,
4. phrase boost,
5. optional fuzzy fallback,
6. stable sort tie-breaker.

Contoh konseptual:

```json
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenantId": "tenant-a" } },
        { "terms": { "visibility": ["PUBLIC", "INTERNAL"] } }
      ],
      "should": [
        {
          "term": {
            "caseNumber": {
              "value": "late payment enforcement",
              "boost": 50
            }
          }
        },
        {
          "multi_match": {
            "query": "late payment enforcement",
            "fields": ["title^5", "summary^2", "body"],
            "type": "best_fields",
            "minimum_should_match": "70%"
          }
        },
        {
          "match_phrase": {
            "title": {
              "query": "late payment enforcement",
              "boost": 4
            }
          }
        }
      ],
      "minimum_should_match": 1
    }
  }
}
```

Catatan:

- Ini bukan template universal.
- Exact identifier clause seharusnya hanya aktif jika input terlihat seperti identifier.
- `term caseNumber` dengan natural language string tidak berguna jika bukan identifier.
- Fuzzy sebaiknya hati-hati dan sering dibatasi pada field tertentu.
- Phrase boost harus diuji.

Baseline bagus bukan query paling kompleks. Baseline bagus adalah query yang:

```text
mudah dijelaskan,
mudah diuji,
mudah dimodifikasi,
dan failure mode-nya jelas.
```

---

## 21. Score Explainability In Product Conversations

Engineer sering harus menjelaskan ranking ke product owner, investigator, auditor, atau reviewer.

Jangan menjelaskan dengan rumus BM25 penuh.

Gunakan bahasa domain:

```text
Dokumen ini naik karena query term muncul di title, bukan hanya body.
Term "enforcement" lebih membedakan daripada "payment" karena lebih jarang.
Dokumen lain memiliki term yang sama tetapi tersebar di body panjang, sehingga sinyalnya lebih lemah.
```

Untuk regulatory/case-management context:

```text
Search ranking tidak menentukan kebenaran legal/faktual.
Ranking hanya menentukan urutan kandidat dokumen berdasarkan sinyal retrieval.
Keputusan final tetap berdasarkan review user dan evidence.
```

Ini penting untuk defensibility.

Search result harus bisa dijelaskan sebagai retrieval behavior, bukan opaque oracle.

---

## 22. Relevance And Regulatory Defensibility

Dalam sistem regulasi, enforcement, audit, compliance, atau case management, ranking punya risiko khusus.

Risiko:

- dokumen penting terkubur,
- dokumen tidak relevan muncul tinggi,
- unauthorized result bocor,
- ranking dianggap bias,
- search tidak reproducible,
- perubahan analyzer/query mengubah hasil tanpa audit,
- user tidak tahu kenapa hasil muncul.

Prinsip desain:

```text
Eligibility must be strict.
Ranking can be probabilistic.
Explanation must be available.
Changes must be tested.
Critical decisions must not depend solely on top-1 search result.
```

Untuk high-stakes workflow:

- simpan query/request metadata,
- simpan versi index/query strategy jika perlu audit,
- gunakan deterministic filters untuk permission/status,
- expose matched fields/highlights,
- hindari ranking opaque tanpa evaluasi,
- jalankan relevance regression untuk query penting.

---

## 23. When To Tune BM25 Parameters

Elasticsearch memungkinkan custom similarity di mapping/index setting. BM25 punya parameter seperti `k1` dan `b`.

Namun dalam praktik, jangan cepat-cepat tuning BM25.

Urutan intervensi yang biasanya lebih aman:

1. perbaiki document modeling,
2. perbaiki field selection,
3. perbaiki analyzer,
4. perbaiki query structure,
5. perbaiki field boost,
6. tambah phrase/proximity signal,
7. tambah domain/business signal,
8. baru pertimbangkan similarity tuning.

Mengapa?

Karena tuning BM25 parameter berdampak luas ke seluruh field/query yang memakai similarity itu.

Jika masalah hanya title vs body, gunakan field boost/modeling.

Jika masalah hanya identifier, gunakan keyword/exact field.

Jika masalah synonym, gunakan synonym/normalization.

Jika masalah freshness, gunakan business ranking signal.

BM25 tuning cocok ketika Anda sudah punya:

- query set,
- relevance judgment,
- offline evaluation,
- clear hypothesis,
- rollback plan.

---

## 24. Practical Relevance Checklist

Saat membangun search baru, cek ini:

### 24.1 Document And Mapping

- Apakah retrieval unit benar?
- Apakah title/summary/body dipisah?
- Apakah identifier punya keyword field?
- Apakah boilerplate ikut scoring?
- Apakah field penting kosong/generic?
- Apakah nested/object digunakan dengan benar?

### 24.2 Analyzer

- Apakah index analyzer dan search analyzer sesuai?
- Apakah token hasil `_analyze` masuk akal?
- Apakah stemming terlalu agresif?
- Apakah synonym terlalu luas?
- Apakah identifier rusak karena tokenizer?

### 24.3 Query

- Apakah filter dan scoring clause dipisah?
- Apakah `minimum_should_match` masuk akal?
- Apakah field boost punya alasan domain?
- Apakah phrase/proximity diperlukan?
- Apakah fuzzy dibatasi?
- Apakah wildcard/prefix dipakai secara aman?

### 24.4 Ranking

- Apakah result top-10 bisa dijelaskan?
- Apakah exact match mengalahkan weak partial match?
- Apakah title match cukup dihargai?
- Apakah body panjang mendominasi?
- Apakah term langka mendominasi secara aneh?

### 24.5 Evaluation

- Apakah punya golden query set?
- Apakah punya expected top results?
- Apakah perubahan query diuji regression?
- Apakah zero-result query dianalisis?
- Apakah user feedback dikumpulkan?

---

## 25. Mini Lab: Understand Score Differences

Gunakan dataset kecil konseptual.

### 25.1 Documents

```json
[
  {
    "id": "1",
    "title": "Late Payment Enforcement Notice",
    "body": "Formal notice for repeated late payment."
  },
  {
    "id": "2",
    "title": "Payment Review",
    "body": "The enforcement unit reviewed a payment issue after several late submissions."
  },
  {
    "id": "3",
    "title": "General Enforcement Procedure",
    "body": "This document explains enforcement procedure for multiple case types."
  },
  {
    "id": "4",
    "title": "Late Fee Collection Action",
    "body": "Collection action triggered by repeated payment failure."
  }
]
```

### 25.2 Query

```text
late payment enforcement
```

Predict ranking before running query.

Expected reasoning:

- Document 1 likely strong: all terms, title match, short focused field.
- Document 2 likely medium: all terms but spread across title/body.
- Document 3 likely partial: enforcement only, maybe procedure context.
- Document 4 semantically relevant but lexical mismatch: no `enforcement`, has `collection action`.

### 25.3 Lesson

Document 4 may be relevant to humans but under-ranked lexically.

This is not necessarily BM25 failure. It is vocabulary mismatch.

Potential solutions:

- synonym: `enforcement action`, `collection action`,
- domain taxonomy,
- semantic search later,
- query expansion,
- curated field.

---

## 26. Mini Lab: Explain Before Changing

When a user reports bad ranking:

```text
Query: "late payment enforcement"
Expected: doc 4 should be high.
Actual: doc 4 is low.
```

Do not immediately add boost.

Ask:

```text
Does doc 4 contain the terms?
Which field contains them?
Does analyzer normalize collection/action to enforcement?
Does summary contain better curated text?
Is doc 4 missing title terms?
Is the user intent actually collection action, not enforcement notice?
```

Correct fix may be:

```text
Add domain synonym or enrich summary, not boost body.
```

---

## 27. Anti-Patterns

### 27.1 Ranking By Random Boost

```text
"This result should be higher, so set boost to 100."
```

This creates local fix and global damage.

### 27.2 Treating `_score` As Business Priority

```text
Highest _score = highest enforcement priority.
```

Wrong. Search score is textual relevance, not regulatory severity.

Business priority should be separate signal.

### 27.3 Mixing Authorization Into Score

```text
User has strong permission, therefore document should score higher.
```

Authorization should normally determine eligibility, not relevance.

### 27.4 Using Fuzzy Everywhere

Fuzzy can improve typo tolerance but also increase noise and cost.

Use carefully, often as fallback or limited to selected fields.

### 27.5 Ignoring Data Quality

No query can fully compensate for:

- empty titles,
- duplicated content,
- OCR garbage,
- inconsistent identifiers,
- missing summaries,
- wrong language analyzer.

---

## 28. Mental Model Summary

Relevance engineering is the discipline of making search ranking:

```text
intent-aware,
explainable,
testable,
maintainable,
and aligned with domain expectations.
```

BM25 gives a strong default lexical ranking model based on:

```text
term frequency,
inverse document frequency,
field length normalization,
and boost/query structure.
```

But BM25 is not enough by itself for every production search system.

You still need:

- good document modeling,
- correct mapping,
- appropriate analyzer,
- deliberate query construction,
- domain ranking signals,
- evaluation process,
- observability,
- regression tests,
- human feedback.

---

## 29. Practical Decision Tree

When relevance is bad:

```text
1. Did the expected document match at all?
   - No  -> matching/analyzer/filter/modeling issue.
   - Yes -> ranking issue.

2. Did query tokens match expected field tokens?
   - No  -> analyzer/synonym/normalization issue.
   - Yes -> continue.

3. Is the relevant content in a high-value field?
   - No  -> document modeling/field boost issue.
   - Yes -> continue.

4. Is a rare term dominating?
   - Yes -> query structure/field/intent issue.
   - No  -> continue.

5. Is a long/noisy field dominating?
   - Yes -> field strategy/chunking/boost issue.
   - No  -> continue.

6. Is a business signal missing?
   - Yes -> function_score/rank_feature/domain ranking.
   - No  -> inspect _explain and query set.
```

---

## 30. What Top 1% Engineers Do Differently

Average usage:

```text
Use match query.
Add boosts when users complain.
Hope results improve.
```

Strong usage:

```text
Understand analyzer, field, score, and query behavior.
Use _explain for debugging.
Separate filter from scoring.
Use field boosts intentionally.
```

Top-tier usage:

```text
Model search documents from user intent.
Design ranking as an explicit product/engineering layer.
Maintain query sets and relevance regression tests.
Separate lexical relevance from business priority.
Make search explainable and auditable.
Treat search quality as a lifecycle, not a one-time config.
```

---

## 31. Key Takeaways

1. Search result quality is mostly ranking quality.
2. `_score` is query-local relevance score, not absolute truth.
3. BM25 rewards term match, rare terms, reasonable repetition, and focused fields.
4. Term frequency saturates; repeated terms do not increase score linearly.
5. Rare terms can dominate ranking.
6. Field length normalization makes short focused fields powerful.
7. Field boost should encode domain intent, not panic fixes.
8. `_explain` is the core tool for score debugging.
9. Most relevance issues are not solved by one knob.
10. Relevance engineering requires modeling, analysis, query design, ranking signals, and evaluation.

---

## 32. Preparation For Part 011

Part 010 focused on lexical scoring fundamentals and BM25.

Part 011 will extend this into domain-aware ranking:

- popularity,
- freshness,
- authority,
- quality,
- lifecycle status,
- severity,
- SLA,
- recency decay,
- `function_score`,
- `field_value_factor`,
- decay functions,
- `rank_feature`,
- script scoring,
- ranking governance.

The transition is important:

```text
BM25 answers: “How textually relevant is this document to the query?”
Domain ranking answers: “Given textual relevance, which result should the user see first for this product/workflow?”
```

---

## 33. References

- Elastic documentation: Similarity settings and BM25 similarity.  
  https://www.elastic.co/docs/reference/elasticsearch/index-settings/similarity

- Elastic Search Labs: Understanding Elasticsearch scoring and the Explain API.  
  https://www.elastic.co/search-labs/blog/elasticsearch-scoring-and-explain-api

- Elastic documentation: Ranking and reranking.  
  https://www.elastic.co/docs/solutions/search/ranking

- Apache Lucene API: BM25Similarity.  
  https://lucene.apache.org/core/9_9_1/core/org/apache/lucene/search/similarities/BM25Similarity.html

- Apache Lucene API: Similarity package.  
  https://lucene.apache.org/core/9_0_0/core/org/apache/lucene/search/similarities/package-summary.html

---

## 34. Series Status

Seri belum selesai.

Part yang sudah dibuat:

- Part 000 — Orientation, Scope, and Mental Model
- Part 001 — Search Problem Fundamentals: From Lookup to Relevance
- Part 002 — Information Retrieval Core Model
- Part 003 — Apache Lucene Under the Hood
- Part 004 — Elasticsearch Architecture Deep Dive
- Part 005 — Document Modeling for Search
- Part 006 — Mapping Mastery
- Part 007 — Text Analysis Pipeline
- Part 008 — Query DSL Foundations
- Part 009 — Full-Text Query Patterns
- Part 010 — Relevance Engineering I: Scoring, Ranking, and BM25

Part berikutnya:

- Part 011 — Relevance Engineering II: Domain-Aware Ranking

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — Full-Text Query Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-011.md">Part 011 — Relevance Engineering II: Domain-Aware Ranking ➡️</a>
</div>
