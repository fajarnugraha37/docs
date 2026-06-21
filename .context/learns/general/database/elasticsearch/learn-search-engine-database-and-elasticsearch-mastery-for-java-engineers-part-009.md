# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-009

# Part 009 — Full-Text Query Patterns

> **Series:** Search Engine Database and Elasticsearch Mastery for Java Engineers  
> **Part:** 009 / 034  
> **Topic:** Full-Text Query Patterns  
> **Audience:** Java software engineer yang ingin memahami Elasticsearch bukan sebagai kumpulan API, tetapi sebagai sistem retrieval yang bisa dirancang, di-debug, dan dioptimasi secara serius.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas fondasi Query DSL: `query context`, `filter context`, `bool`, `must`, `should`, `filter`, `must_not`, dan bagaimana query disusun secara aman. Sekarang kita masuk ke kelas query yang paling sering membuat Elasticsearch terasa “magis” sekaligus membingungkan: **full-text query**.

Bagian ini menjawab pertanyaan seperti:

- Kapan memakai `match`?
- Kapan memakai `match_phrase`?
- Apa perbedaan `multi_match` tipe `best_fields`, `most_fields`, `cross_fields`, `phrase`, dan `bool_prefix`?
- Mengapa `term` query pada field `text` sering gagal secara mengejutkan?
- Mengapa wildcard, regexp, dan prefix query bisa mahal?
- Bagaimana mendesain search-as-you-type dan autocomplete tanpa membuat cluster terbakar?
- Bagaimana memilih pola query berdasarkan intent user, bentuk data, analyzer, dan kebutuhan ranking?

Target akhir part ini adalah Anda tidak hanya hafal query syntax, tetapi bisa membuat keputusan desain:

> “Untuk search box ini, query apa yang harus saya gunakan, field apa yang perlu ada, analyzer apa yang cocok, bagaimana scoring-nya, dan apa failure mode-nya?”

---

## 1. Mental Model: Full-Text Query Bukan String Matching

Kesalahan pertama banyak engineer ketika mulai menggunakan Elasticsearch adalah membawa mental model SQL `LIKE` ke search engine.

Di SQL, ketika kita menulis:

```sql
WHERE title LIKE '%fraud investigation%'
```

kita sedang berpikir bahwa field adalah string utuh, lalu database mencari substring.

Di Elasticsearch full-text search, biasanya yang terjadi adalah:

1. input query dianalisis oleh analyzer;
2. teks diubah menjadi token;
3. token dicocokkan ke inverted index;
4. posting list diambil;
5. kandidat document dikumpulkan;
6. score dihitung;
7. top result dikembalikan.

Artinya, full-text search adalah operasi terhadap **term hasil analisis**, bukan terhadap string mentah.

Misalnya field `title` berisi:

```text
Regulatory Enforcement Investigation for Market Abuse
```

Dengan analyzer standar, field bisa menjadi token seperti:

```text
regulatory
enforcement
investigation
for
market
abuse
```

Ketika user mencari:

```text
market abuse investigation
```

Elasticsearch tidak hanya mencari substring literal `market abuse investigation`. Ia menganalisis query menjadi token, lalu mencocokkan token-token tersebut terhadap inverted index.

Implikasinya besar:

- Urutan kata bisa penting atau tidak, tergantung query.
- Semua token harus match atau sebagian cukup, tergantung operator dan `minimum_should_match`.
- Field bisa berbeda-beda bobotnya.
- Analyzer bisa membuat input user berubah sebelum dicari.
- Ranking dipengaruhi frekuensi term, rarity term, panjang field, dan boost.

Full-text query adalah kombinasi dari:

```text
query intent + analyzer behavior + index structure + scoring model + product expectation
```

Bukan sekadar `contains()`.

---

## 2. Klasifikasi Intent Full-Text Search

Sebelum memilih query, klasifikasikan intent user. Ini lebih penting daripada langsung memilih API.

### 2.1 Exact Identifier Search

Contoh:

```text
CASE-2026-000184
INV-44391
NIK-31740...
transactionId: 91f0b9...
```

Intent-nya bukan linguistic search. User ingin identifier spesifik.

Biasanya cocok dengan:

- `keyword` field;
- `term` query;
- normalized keyword;
- possibly prefix search untuk identifier partial;
- bukan `match` terhadap `text` field.

### 2.2 Keyword Search

Contoh:

```text
market abuse
late filing
sanction appeal
```

User ingin dokumen yang mengandung konsep/kata tertentu. Urutan bisa agak longgar.

Biasanya cocok dengan:

- `match`;
- `multi_match`;
- `bool` composition;
- field boosting;
- synonyms bila domain membutuhkan.

### 2.3 Phrase Search

Contoh:

```text
"market manipulation"
"failure to disclose"
"conflict of interest"
```

User ingin frasa relatif utuh. Urutan kata penting.

Biasanya cocok dengan:

- `match_phrase`;
- `multi_match` type `phrase`;
- phrase query dengan `slop` bila perlu toleransi jarak.

### 2.4 Person / Organization Name Search

Contoh:

```text
Budi Santoso
PT Sinar Jaya Abadi
John Smith Holdings
```

Nama sering punya masalah:

- urutan kata bisa berbeda;
- ada alias;
- ada gelar;
- ada singkatan perusahaan;
- nama bisa muncul di banyak field.

Biasanya cocok dengan kombinasi:

- `multi_match`;
- `cross_fields` untuk nama yang tersebar di `first_name`, `last_name`, `middle_name`;
- exact keyword subfield untuk exact boost;
- n-gram/edge n-gram untuk autocomplete;
- synonym/alias index terpisah bila perlu.

### 2.5 Search-As-You-Type

Contoh input bertahap:

```text
mar
mark
market ab
market abuse
```

User belum mengetik query final. Sistem harus cepat, toleran, dan tidak terlalu agresif.

Biasanya cocok dengan:

- `search_as_you_type` field;
- `multi_match` type `bool_prefix`;
- edge n-gram field;
- completion suggester untuk suggestion use case tertentu.

### 2.6 Discovery Search

Contoh:

```text
kasus pelanggaran market conduct yang terkait direktur bank
```

User mengeksplorasi. Query natural language, panjang, dan ambiguous.

Biasanya cocok dengan:

- `match` / `multi_match` dengan analyzer yang tepat;
- boosting domain fields;
- semantic/vector search;
- hybrid search;
- reranking;
- bukan hanya keyword matching sederhana.

Semantic dan hybrid search akan dibahas lebih jauh di Part 030–031. Di bagian ini kita fokus lexical full-text search.

---

## 3. `match` Query: Workhorse Full-Text Search

`match` adalah query paling dasar dan paling sering dipakai untuk full-text search.

Contoh:

```json
GET cases/_search
{
  "query": {
    "match": {
      "summary": "market abuse investigation"
    }
  }
}
```

Secara mental, `match` melakukan:

```text
analyze(query text) -> token list -> build query over analyzed terms -> score documents
```

Jika analyzer menghasilkan token:

```text
market
abuse
investigation
```

maka Elasticsearch mencari document yang match token-token tersebut, kemudian memberi score.

Dokumentasi Elastic menjelaskan `match` sebagai standar query untuk full-text search; text input dianalisis sebelum matching.

### 3.1 Kapan `match` Cocok?

Gunakan `match` ketika:

- field adalah `text`;
- input user berupa kata/frasa natural;
- urutan kata tidak harus persis;
- scoring relevansi diperlukan;
- Anda ingin analyzer bekerja;
- query masuk dari search box umum.

Contoh use case:

```text
search case summary by keywords
search article body
search allegation description
search notes
search document title
```

### 3.2 `match` vs `term`

Ini jebakan klasik.

Misalnya mapping:

```json
{
  "mappings": {
    "properties": {
      "status": { "type": "keyword" },
      "summary": { "type": "text" }
    }
  }
}
```

Untuk `status`, gunakan:

```json
{
  "term": {
    "status": "OPEN"
  }
}
```

Untuk `summary`, gunakan:

```json
{
  "match": {
    "summary": "open investigation"
  }
}
```

`term` query mencari exact term di index. Pada `text` field, nilai original sudah dianalisis. Jika Anda menjalankan `term` query terhadap `summary` dengan input mentah yang tidak sama dengan term hasil analyzer, hasilnya bisa kosong.

Rule praktis:

```text
keyword field -> term/terms/range/sort/aggregation
text field    -> match/match_phrase/multi_match
```

### 3.3 Operator: `OR` vs `AND`

Secara default, `match` sering bersifat lebih longgar: beberapa token bisa cukup untuk match, tergantung query yang dibentuk.

Contoh:

```json
{
  "match": {
    "summary": {
      "query": "market abuse investigation",
      "operator": "and"
    }
  }
}
```

Dengan `operator: and`, semua token harus match.

Tetapi hati-hati: terlalu ketat bisa menurunkan recall.

Misalnya document:

```text
Investigation into suspected abuse in securities market
```

Mungkin relevan, tetapi tidak semua token exact muncul sesuai harapan setelah analysis/synonym/stemming.

`operator: and` cocok ketika:

- query pendek;
- user mencari hal spesifik;
- false positive mahal;
- domain vocabulary relatif stabil.

`operator: or` atau default lebih cocok ketika:

- query panjang;
- user melakukan discovery;
- recall lebih penting;
- ranking dapat memilah hasil.

### 3.4 `minimum_should_match`

`minimum_should_match` memberi kontrol lebih halus daripada sekadar `and`/`or`.

Contoh:

```json
{
  "match": {
    "summary": {
      "query": "market abuse insider trading disclosure violation",
      "minimum_should_match": "70%"
    }
  }
}
```

Artinya tidak semua term harus match, tetapi cukup banyak harus match.

Pola ini berguna untuk query panjang. Tanpa ini, query panjang bisa terlalu longgar karena satu atau dua token umum bisa membawa document tidak relevan.

Mental model:

```text
operator=and              -> strict recall, lower false positives, risk zero result
operator=or               -> broad recall, higher false positives, depends on ranking
minimum_should_match      -> controlled recall
```

---

## 4. `match_phrase`: Saat Urutan Kata Penting

`match_phrase` digunakan ketika urutan term harus berdekatan sesuai phrase.

Contoh:

```json
GET cases/_search
{
  "query": {
    "match_phrase": {
      "summary": "market abuse"
    }
  }
}
```

Elastic mendokumentasikan `match_phrase` sebagai query yang menganalisis text lalu membuat phrase query dari hasil analisis.

### 4.1 Apa Bedanya dengan `match`?

Misalnya query:

```text
market abuse
```

Document A:

```text
The case concerns market abuse by a licensed broker.
```

Document B:

```text
The abuse report was submitted to the market conduct department.
```

`match` bisa match keduanya karena dua token `market` dan `abuse` ada.

`match_phrase` cenderung hanya match Document A karena term muncul berurutan sebagai frasa.

### 4.2 `slop`: Toleransi Jarak Phrase

Contoh:

```json
{
  "match_phrase": {
    "summary": {
      "query": "market abuse",
      "slop": 2
    }
  }
}
```

`slop` memungkinkan jarak antar term tidak harus persis nol.

Bisa match:

```text
market related abuse
market conduct abuse
```

Tetapi semakin besar `slop`, semakin phrase query kehilangan sifat presisi dan bisa lebih mahal.

### 4.3 Kapan `match_phrase` Cocok?

Gunakan untuk:

- legal/regulatory term yang fixed;
- product name;
- organization name;
- phrase domain seperti `conflict of interest`, `market manipulation`, `failure to disclose`;
- exact-ish title search;
- boosting phrase match di atas normal match.

Pola umum yang kuat:

```json
{
  "bool": {
    "should": [
      {
        "match": {
          "summary": {
            "query": "market abuse",
            "boost": 1
          }
        }
      },
      {
        "match_phrase": {
          "summary": {
            "query": "market abuse",
            "boost": 3
          }
        }
      }
    ],
    "minimum_should_match": 1
  }
}
```

Artinya:

- document yang mengandung token tetap bisa muncul;
- document yang mengandung frasa persis mendapat ranking lebih tinggi.

Ini sering lebih baik daripada hanya `match_phrase`, karena phrase-only terlalu ketat.

---

## 5. `match_phrase_prefix`: Untuk Prefix Phrase, Tapi Jangan Berlebihan

`match_phrase_prefix` mencari phrase berurutan, tetapi term terakhir dianggap prefix.

Contoh:

```json
GET cases/_search
{
  "query": {
    "match_phrase_prefix": {
      "summary": "market ab"
    }
  }
}
```

Ini bisa match:

```text
market abuse
market abnormality
market abrupt...
```

Elastic menjelaskan bahwa query ini mengembalikan dokumen yang mengandung kata-kata dalam urutan yang sama, dengan term terakhir diperlakukan sebagai prefix.

### 5.1 Kapan Cocok?

Cocok untuk search-as-you-type sederhana pada corpus kecil sampai sedang, terutama jika:

- query pendek;
- field target terbatas;
- traffic tidak ekstrem;
- UX tidak membutuhkan suggestion super cepat;
- Anda belum mendesain dedicated autocomplete field.

### 5.2 Failure Mode

`match_phrase_prefix` bisa bermasalah jika:

- dipakai pada field besar;
- dipakai across banyak field;
- prefix terlalu pendek;
- traffic tinggi;
- user mengetik tiap karakter dan setiap karakter memicu request;
- tidak ada debounce di frontend;
- tidak ada limit result yang ketat.

Untuk autocomplete serius, biasanya pertimbangkan:

- `search_as_you_type`;
- edge n-gram;
- completion suggester;
- dedicated suggestion index.

---

## 6. `multi_match`: Search Di Banyak Field

Aplikasi nyata jarang search hanya satu field.

Untuk case management, user mungkin ingin mencari di:

- case title;
- case summary;
- allegation description;
- party name;
- document title;
- tags;
- reference number.

`multi_match` adalah perluasan `match` untuk banyak field.

Contoh:

```json
GET cases/_search
{
  "query": {
    "multi_match": {
      "query": "market abuse",
      "fields": [
        "case_title^4",
        "summary^2",
        "allegations.description",
        "parties.name^3"
      ]
    }
  }
}
```

Elastic mendokumentasikan `multi_match` sebagai query yang membangun di atas `match` untuk melakukan query multi-field, termasuk field boost.

### 6.1 Field Boosting

Field boost adalah cara menyatakan bahwa match di field tertentu lebih penting.

```json
"fields": [
  "case_title^5",
  "parties.name^4",
  "summary^2",
  "body"
]
```

Mental model:

```text
match in title      -> strong signal
match in party name -> strong signal
match in summary    -> medium signal
match in body       -> weak but useful signal
```

Field boosting harus berdasarkan user expectation, bukan ego schema.

Pertanyaan desain:

- Ketika user mengetik nama orang, apakah case dengan party name match harus naik?
- Ketika user mengetik case title phrase, apakah title match harus menang dari body match?
- Apakah long body field terlalu sering mengalahkan exact short field?
- Apakah keyword exact match perlu boost terpisah?

### 6.2 Tipe `multi_match`

`multi_match` punya beberapa tipe penting. Memahami tipe ini krusial.

---

## 7. `multi_match` Type: `best_fields`

`best_fields` adalah default. Ia mencari field terbaik yang match query.

Contoh:

```json
{
  "multi_match": {
    "query": "market abuse",
    "type": "best_fields",
    "fields": ["title^4", "summary", "body"]
  }
}
```

Mental model:

```text
Cari field mana yang paling baik menjawab query.
```

Cocok ketika:

- field mewakili alternatif tempat informasi muncul;
- match kuat di satu field lebih penting daripada match lemah di banyak field;
- title match harus menang dari body match;
- user biasanya mencari konsep yang bisa muncul jelas di satu field.

Contoh:

Document A:

```text
title: Market Abuse Investigation
body: short body
```

Document B:

```text
title: Investigation Note
body: long text mentioning market and abuse separately
```

Dengan boost yang baik, Document A harus menang.

### 7.1 Problem `best_fields`

Jika query term tersebar di beberapa field, `best_fields` bisa kurang ideal.

Contoh:

```text
query: Budi Santoso
```

Document:

```text
first_name: Budi
last_name: Santoso
```

Jika field diperlakukan sebagai alternatif terpisah, match bisa tidak sebaik ekspektasi. Untuk kasus seperti ini, `cross_fields` bisa lebih cocok.

---

## 8. `multi_match` Type: `most_fields`

`most_fields` menggabungkan sinyal dari banyak field. Cocok ketika field adalah variasi representasi dari konten yang sama.

Contoh mapping multi-field:

```json
"title": {
  "type": "text",
  "fields": {
    "stemmed": { "type": "text", "analyzer": "english" },
    "shingles": { "type": "text", "analyzer": "title_shingle_analyzer" }
  }
}
```

Query:

```json
{
  "multi_match": {
    "query": "market manipulation",
    "type": "most_fields",
    "fields": [
      "title",
      "title.stemmed",
      "title.shingles"
    ]
  }
}
```

Mental model:

```text
Semakin banyak representasi field yang mendukung document, semakin kuat sinyalnya.
```

Cocok untuk:

- field dengan analyzer berbeda;
- exact-ish + stemmed + shingle representation;
- meningkatkan score ketika dokumen match di beberapa bentuk analisis.

Tidak cocok jika field-field tersebut adalah semantic field yang berbeda dan tidak seharusnya semua dijumlahkan begitu saja.

Misalnya menjumlahkan match dari:

```text
party_name + summary + internal_notes + attachment_text
```

bisa membuat long noisy document naik karena kebetulan match di banyak tempat.

---

## 9. `multi_match` Type: `cross_fields`

`cross_fields` memperlakukan beberapa field seolah-olah satu field gabungan, terutama untuk structured text seperti nama.

Contoh:

```json
{
  "multi_match": {
    "query": "Budi Santoso",
    "type": "cross_fields",
    "fields": [
      "person.first_name",
      "person.middle_name",
      "person.last_name"
    ],
    "operator": "and"
  }
}
```

Mental model:

```text
Term query boleh tersebar di field berbeda, tetapi secara keseluruhan harus membentuk match.
```

Cocok untuk:

- first name / last name;
- address parts;
- organization name parts;
- structured text yang secara logical membentuk satu search surface.

### 9.1 Kapan `cross_fields` Berbahaya?

Jangan asal memakai `cross_fields` untuk semua field.

Buruk:

```json
"fields": [
  "case_title",
  "summary",
  "parties.name",
  "attachments.body",
  "internal_notes"
]
```

Kenapa?

Karena field-field ini bukan bagian dari satu logical text. Mereka punya makna dan bobot berbeda. Menggabungkannya bisa menghasilkan ranking sulit dijelaskan.

Gunakan `cross_fields` untuk field yang memang merupakan pecahan dari satu logical value.

---

## 10. `multi_match` Type: `phrase`

`phrase` menjalankan phrase matching di banyak field.

Contoh:

```json
{
  "multi_match": {
    "query": "market abuse",
    "type": "phrase",
    "fields": ["title^4", "summary^2", "body"]
  }
}
```

Cocok ketika:

- frasa penting;
- ingin phrase boost across fields;
- user memasukkan quoted phrase atau query pendek domain-specific;
- Anda ingin exact phrase match menang.

Pola umum:

```json
{
  "bool": {
    "should": [
      {
        "multi_match": {
          "query": "market abuse",
          "type": "best_fields",
          "fields": ["title^4", "summary^2", "body"]
        }
      },
      {
        "multi_match": {
          "query": "market abuse",
          "type": "phrase",
          "fields": ["title^8", "summary^4", "body^2"]
        }
      }
    ],
    "minimum_should_match": 1
  }
}
```

Ini sering bagus karena:

- broad match menjaga recall;
- phrase match memberi precision boost.

---

## 11. `multi_match` Type: `bool_prefix`

`bool_prefix` sering digunakan untuk search-as-you-type, terutama bersama `search_as_you_type` field.

Contoh:

```json
{
  "multi_match": {
    "query": "market ab",
    "type": "bool_prefix",
    "fields": [
      "title",
      "title._2gram",
      "title._3gram"
    ]
  }
}
```

Dengan `search_as_you_type`, Elasticsearch membuat subfield yang mendukung matching partial phrase. Dokumentasi Elastic menjelaskan `search_as_you_type` sebagai field text-like yang dioptimalkan untuk completion use case, termasuk prefix dan infix completion.

### 11.1 Kapan Cocok?

Cocok untuk:

- search box yang memberi hasil saat user mengetik;
- title/name search;
- query pendek-menengah;
- autocomplete result berupa dokumen, bukan hanya suggestion string.

### 11.2 Bedakan Autocomplete Result vs Suggestion

Ada dua UX yang sering dicampur:

#### A. Search-as-you-type result

User mengetik:

```text
mar
```

UI menampilkan dokumen/case/product aktual:

```text
Market Abuse Investigation
Market Conduct Review
Margin Trading Case
```

Ini search result.

#### B. Query suggestion

User mengetik:

```text
mar
```

UI menampilkan saran query:

```text
market abuse
market conduct
margin trading
```

Ini suggestion, bukan search result.

Elasticsearch bisa mendukung keduanya, tetapi desain field dan query berbeda.

---

## 12. `query_string`: Powerful, Strict, and Dangerous for User Search Box

`query_string` memungkinkan syntax kompleks:

```json
{
  "query_string": {
    "query": "(market abuse OR manipulation) AND status:open"
  }
}
```

Ia bisa mendukung operator, wildcard, field-specific query, grouping, dan sebagainya.

Namun Elastic memperingatkan bahwa `query_string` strict: invalid syntax bisa menyebabkan error, dan tidak direkomendasikan untuk search box biasa.

### 12.1 Kapan `query_string` Cocok?

Cocok untuk:

- advanced search power user;
- internal admin/debug tool;
- query language yang memang diekspos secara sadar;
- user terlatih yang memahami syntax;
- sistem yang memvalidasi dan mengontrol input.

Tidak cocok untuk:

- public search box;
- user umum;
- input mentah tanpa escaping;
- aplikasi yang tidak ingin search error hanya karena user mengetik tanda kurung tidak seimbang.

### 12.2 Failure Mode

Contoh user input:

```text
market abuse (urgent
```

Dengan `query_string`, ini bisa error karena syntax invalid.

Di aplikasi production, error seperti ini merusak UX.

---

## 13. `simple_query_string`: Lebih Aman untuk User Syntax

`simple_query_string` mirip `query_string`, tetapi lebih forgiving terhadap syntax invalid.

Contoh:

```json
{
  "simple_query_string": {
    "query": "market abuse +urgent -closed",
    "fields": ["title^4", "summary^2", "body"]
  }
}
```

Cocok jika ingin memberi user beberapa operator sederhana, tetapi tidak ingin query gagal total karena syntax invalid.

Namun tetap hati-hati:

- jangan expose terlalu banyak field;
- batasi operator bila perlu;
- validasi panjang query;
- monitor expensive patterns;
- jangan jadikan ini default tanpa product reason.

---

## 14. Prefix Query

`prefix` query mencari term yang dimulai dengan prefix tertentu.

Contoh:

```json
{
  "prefix": {
    "case_number.keyword": "CASE-2026-"
  }
}
```

Cocok untuk:

- identifier prefix;
- controlled keyword fields;
- code/reference number;
- prefix dengan panjang cukup;
- low-cardinality or reasonably bounded term space.

Tidak ideal untuk:

- natural language autocomplete pada field besar tanpa desain index khusus;
- prefix terlalu pendek seperti `a`, `m`, `ma` pada corpus besar;
- wildcard-like use case.

### 14.1 Prefix pada `keyword` vs `text`

Pada `keyword`, prefix bekerja pada term utuh.

Pada `text`, prefix bekerja pada token hasil analyzer, bukan string original.

Misalnya:

```text
"Market Abuse Investigation"
```

Token:

```text
market
abuse
investigation
```

Prefix `mar` bisa match token `market`, tetapi tidak berarti substring arbitrary di original string.

---

## 15. Wildcard Query

`wildcard` query mencari term yang cocok dengan pattern wildcard.

Contoh:

```json
{
  "wildcard": {
    "case_number.keyword": {
      "value": "CASE-2026-*"
    }
  }
}
```

Elastic mendefinisikan wildcard query sebagai query yang mengembalikan dokumen dengan term yang cocok terhadap wildcard pattern.

Wildcard operator umum:

```text
* -> zero or more characters
? -> one character
```

### 15.1 Leading Wildcard Problem

Query seperti ini berbahaya:

```json
{
  "wildcard": {
    "title.keyword": "*abuse"
  }
}
```

Leading wildcard membuat search engine sulit memanfaatkan prefix term lookup. Ia bisa harus scan banyak term dalam term dictionary.

Pola berbahaya:

```text
*abc
*a*
*abuse*
```

Jika user meminta “contains search”, jangan langsung memberikan wildcard `*query*` pada field besar. Itu sering menjadi awal masalah performa.

### 15.2 Kapan Wildcard Masih Masuk Akal?

Masuk akal untuk:

- field keyword kecil/terkontrol;
- identifier pattern;
- admin tool dengan limit ketat;
- low traffic;
- query yang jarang;
- prefix wildcard tanpa leading wildcard;
- field khusus yang memang dioptimalkan.

Tidak masuk akal untuk:

- search box utama;
- body text besar;
- high traffic endpoint;
- user-generated unbounded query;
- multi-field wildcard across all fields.

---

## 16. Regexp Query

`regexp` query mencocokkan term dengan regular expression.

Contoh:

```json
{
  "regexp": {
    "case_number.keyword": "CASE-2026-[0-9]{6}"
  }
}
```

Cocok untuk:

- controlled identifier search;
- admin/debug use case;
- narrow field;
- pattern matching terbatas.

Berbahaya untuk:

- general search box;
- high-cardinality large keyword field;
- regex kompleks;
- leading arbitrary pattern;
- query dari user tanpa validasi.

Regexp query adalah tool tajam, bukan default search pattern.

---

## 17. Search-As-You-Type Design Options

Search-as-you-type adalah salah satu fitur paling sering salah desain.

Requirement yang tampak sederhana:

> “Saat user mengetik, tampilkan hasil yang cocok.”

Realitanya menyentuh:

- analyzer;
- field design;
- query type;
- latency budget;
- frontend debounce;
- ranking;
- typo tolerance;
- memory;
- write amplification;
- index size;
- traffic multiplication.

Jika user mengetik 10 karakter dan frontend menembak request per karakter, QPS search bisa naik 10x.

### 17.1 Option A — `match_phrase_prefix`

Simple:

```json
{
  "match_phrase_prefix": {
    "title": "market ab"
  }
}
```

Kelebihan:

- mudah;
- tidak perlu mapping khusus;
- cocok untuk prototype;
- phrase order cukup natural.

Kekurangan:

- bisa mahal;
- kurang fleksibel;
- tidak ideal untuk skala besar;
- behavior bisa mengejutkan pada corpus besar.

Gunakan untuk:

- low traffic;
- limited fields;
- internal tools;
- proof of concept.

### 17.2 Option B — `search_as_you_type`

Mapping:

```json
{
  "mappings": {
    "properties": {
      "title": {
        "type": "search_as_you_type"
      }
    }
  }
}
```

Query:

```json
{
  "multi_match": {
    "query": "market ab",
    "type": "bool_prefix",
    "fields": [
      "title",
      "title._2gram",
      "title._3gram"
    ]
  }
}
```

Kelebihan:

- built-in untuk as-you-type;
- lebih terarah daripada wildcard;
- mendukung prefix/infix use case tertentu;
- cocok untuk search result as user types.

Kekurangan:

- field khusus;
- index size bertambah;
- perlu tuning relevance;
- tidak selalu cukup untuk complex autocomplete.

### 17.3 Option C — Edge N-Gram

Edge n-gram mengindeks prefix token.

Misalnya token:

```text
market
```

Dengan edge n-gram bisa menjadi:

```text
ma
mar
mark
marke
market
```

Mapping konseptual:

```json
{
  "settings": {
    "analysis": {
      "analyzer": {
        "autocomplete_index": {
          "tokenizer": "standard",
          "filter": ["lowercase", "autocomplete_filter"]
        },
        "autocomplete_search": {
          "tokenizer": "standard",
          "filter": ["lowercase"]
        }
      },
      "filter": {
        "autocomplete_filter": {
          "type": "edge_ngram",
          "min_gram": 2,
          "max_gram": 20
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "analyzer": "autocomplete_index",
        "search_analyzer": "autocomplete_search"
      }
    }
  }
}
```

Kelebihan:

- fast query-time;
- prefix matching bagus;
- fleksibel;
- bisa dikustomisasi.

Kekurangan:

- index lebih besar;
- write lebih mahal;
- min/max gram harus dipilih hati-hati;
- bisa menghasilkan banyak false positive untuk prefix pendek;
- analyzer mismatch bisa merusak relevance.

### 17.4 Option D — Completion Suggester

Completion suggester dirancang untuk suggestion cepat.

Cocok untuk:

- query suggestions;
- known labels;
- product names;
- controlled suggestion corpus;
- top N suggestion.

Tidak selalu cocok untuk:

- general document search;
- complex filtering;
- permission-heavy result search;
- search result ranking penuh.

Dokumentasi Elastic menjelaskan completion suggester membutuhkan field mapping bertipe `completion` untuk menghasilkan suggestion cepat.

---

## 18. Autocomplete Architecture Decision Matrix

| Requirement | Candidate Pattern | Reason |
|---|---|---|
| Internal low-traffic title prefix | `match_phrase_prefix` | Simple, low setup |
| Search result as user types | `search_as_you_type` + `bool_prefix` | Built-in for as-you-type |
| Prefix autocomplete with custom analyzer | edge n-gram | Flexible and fast query-time |
| Query suggestions only | completion suggester | Optimized for suggestions |
| Identifier prefix search | `prefix` on `keyword` | Exact prefix semantics |
| Contains substring search | usually avoid wildcard; consider n-gram field | Wildcard `*x*` can be expensive |
| Permission-aware document result | normal search index + filters | Suggesters may bypass complex auth semantics |

---

## 19. “Contains Search” Is Usually a Smell

Product often asks:

> “Can search behave like contains?”

Example:

```text
input: ark
match: Market Abuse
```

This is infix substring search.

Elasticsearch can do it, but the question is: should it?

Options:

1. wildcard `*ark*`;
2. n-gram analyzer;
3. specialized field;
4. semantic search if intent is conceptual;
5. better UX expectation: prefix search instead of contains.

### 19.1 Why `*ark*` Is Dangerous

Because arbitrary contains search can require scanning many terms. It is especially bad on:

- large keyword fields;
- high-cardinality fields;
- many fields;
- high traffic;
- short query strings.

### 19.2 N-Gram Field for Contains

If contains search is truly required, create a dedicated analyzed field.

Example:

```text
market -> mar, ark, rke, ket, mark, arke, rket, ...
```

But this increases:

- index size;
- indexing cost;
- term dictionary size;
- possible false positives.

Use only where product value justifies cost.

---

## 20. Field Strategy for Full-Text Search

A robust search index usually does not rely on one field representation.

Example:

```json
{
  "case_title": {
    "type": "text",
    "fields": {
      "keyword": { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "search_as_you_type": { "type": "search_as_you_type" }
    }
  }
}
```

Conceptually:

```text
case_title             -> full-text search
case_title.keyword     -> exact match, sort, aggregation, exact boost
case_title.autocomplete-> prefix/as-you-type behavior
case_title.shingles    -> phrase-ish relevance support
```

But jangan membuat multi-field tanpa alasan. Setiap field tambahan punya cost:

- storage;
- indexing CPU;
- merge cost;
- memory metadata;
- query complexity;
- mapping governance.

Top-tier engineer tidak menambah field karena “mungkin berguna”. Mereka menambah field karena ada query behavior yang jelas.

---

## 21. Composed Query Pattern: General Search Box

Search box umum biasanya perlu menggabungkan banyak sinyal.

Contoh domain: case search.

User mengetik:

```text
market abuse
```

Desain query bisa seperti:

```json
GET cases/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "tenant-a" } },
        { "terms": { "visibility": ["PUBLIC", "INTERNAL_ALLOWED"] } },
        { "term": { "is_deleted": false } }
      ],
      "should": [
        {
          "term": {
            "case_number.keyword": {
              "value": "market abuse",
              "boost": 20
            }
          }
        },
        {
          "multi_match": {
            "query": "market abuse",
            "type": "phrase",
            "fields": [
              "case_title^10",
              "parties.name^8",
              "summary^4"
            ]
          }
        },
        {
          "multi_match": {
            "query": "market abuse",
            "type": "best_fields",
            "fields": [
              "case_title^5",
              "parties.name^4",
              "summary^2",
              "allegations.description^2",
              "documents.title"
            ],
            "minimum_should_match": "70%"
          }
        }
      ],
      "minimum_should_match": 1
    }
  }
}
```

This pattern separates:

```text
filters             -> eligibility / permission / lifecycle
exact identifier    -> very high precision signal
phrase match        -> strong relevance signal
broad full-text     -> recall signal
```

### 21.1 Why This Is Better Than One `multi_match`

One giant `multi_match` hides intent.

Composed query makes intent explicit:

- exact case number should dominate;
- phrase title match should be strong;
- normal keyword match should still include relevant results;
- permission filters should not affect score;
- lifecycle filters should be deterministic.

---

## 22. Composed Query Pattern: Person Search

User searches:

```text
Budi Santoso
```

Possible query:

```json
{
  "bool": {
    "filter": [
      { "term": { "tenant_id": "tenant-a" } }
    ],
    "should": [
      {
        "term": {
          "person.full_name.keyword": {
            "value": "budi santoso",
            "boost": 20
          }
        }
      },
      {
        "match_phrase": {
          "person.full_name": {
            "query": "Budi Santoso",
            "boost": 10
          }
        }
      },
      {
        "multi_match": {
          "query": "Budi Santoso",
          "type": "cross_fields",
          "fields": [
            "person.first_name",
            "person.middle_name",
            "person.last_name",
            "person.aliases"
          ],
          "operator": "and",
          "boost": 4
        }
      },
      {
        "multi_match": {
          "query": "Budi Santoso",
          "type": "best_fields",
          "fields": [
            "person.full_name^3",
            "person.aliases^2"
          ]
        }
      }
    ],
    "minimum_should_match": 1
  }
}
```

Mental model:

```text
exact normalized full name     -> strongest
phrase full name               -> strong
terms across name components   -> robust
alias/full text fallback       -> recall
```

---

## 23. Composed Query Pattern: Identifier-Or-Text Search

Banyak enterprise search box menerima input ambigu:

```text
CASE-2026-000123
market abuse
Budi Santoso
```

Satu box, banyak intent.

Approach:

1. classify query lightly;
2. build query based on detected intent;
3. still include fallback full-text.

Java-side pseudo logic:

```java
SearchIntent intent = SearchIntentClassifier.classify(userQuery);

BoolQuery.Builder bool = new BoolQuery.Builder();
bool.filter(permissionFilters(userContext));
bool.filter(lifecycleFilters(request));

if (intent.looksLikeCaseNumber()) {
    bool.should(exactCaseNumber(userQuery, 50.0f));
    bool.should(prefixCaseNumber(userQuery, 20.0f));
}

if (intent.looksLikePersonName()) {
    bool.should(personNameQuery(userQuery));
}

bool.should(generalFullTextQuery(userQuery));
bool.minimumShouldMatch("1");
```

Do not make one query shape do all things equally. Different intent deserves different weighting.

---

## 24. Query Validation and Guardrails

Full-text query endpoints need guardrails.

### 24.1 Minimum Query Length

For autocomplete, maybe allow 2–3 chars.

For expensive wildcard/regexp, require longer input.

Example policy:

```text
normal full-text     -> min 2 chars after trim
autocomplete         -> min 2 chars, debounce required
wildcard admin       -> min 4 chars, no leading wildcard by default
regexp admin         -> min 5 chars, timeout required
```

### 24.2 Field Whitelist

Never let user query arbitrary fields unless building an explicit admin DSL.

Bad:

```json
{
  "query_string": {
    "query": "user supplied raw query over *"
  }
}
```

Better:

```json
{
  "simple_query_string": {
    "query": "user input",
    "fields": ["case_title^4", "summary^2", "parties.name^3"]
  }
}
```

### 24.3 Timeout

Set sensible timeout for risky queries.

```json
GET cases/_search
{
  "timeout": "500ms",
  "query": {
    "match": {
      "summary": "market abuse"
    }
  }
}
```

Timeout does not replace good design, but it limits blast radius.

### 24.4 Result Size Limit

Do not allow arbitrary size.

Bad:

```text
size=10000
```

Better:

```text
size <= 50 for interactive search
use search_after/PIT for deep navigation
use async/export pipeline for export use case
```

Pagination will be covered deeply in Part 013.

---

## 25. Java Backend Query Builder Design

For Java engineers, avoid scattering raw JSON strings everywhere.

Bad pattern:

```java
String query = "{ \"query\": { \"match\": { \"summary\": \"" + userInput + "\" } } }";
```

Problems:

- escaping bugs;
- injection-like query issues;
- brittle refactoring;
- no compile-time structure;
- difficult testing.

Better pattern:

```java
public interface SearchQueryFactory {
    Query build(SearchRequestDto request, UserContext userContext);
}
```

Separate concerns:

```text
Request DTO validation
        ↓
Intent classification
        ↓
Filter construction
        ↓
Full-text query construction
        ↓
Ranking/boost composition
        ↓
Elasticsearch request execution
        ↓
Response mapping
```

### 25.1 Query Object as Domain Artifact

Treat query builder as important domain code, not infrastructure glue.

For regulatory/case-management search, query construction encodes:

- visibility;
- lifecycle semantics;
- user role;
- field priority;
- exact vs fuzzy behavior;
- business relevance.

That is business logic.

### 25.2 Testing Query Builders

Test at several levels:

1. **Unit test generated query shape**  
   Verify fields, boosts, filters, minimum_should_match.

2. **Analyzer test**  
   Verify query text and indexed text tokenize as expected.

3. **Integration test with sample index**  
   Verify expected ordering for golden cases.

4. **Regression relevance test**  
   Ensure change does not degrade important queries.

Example golden test:

```text
query: "market abuse"
expected top 3:
1. Case with title "Market Abuse Investigation"
2. Case with allegation phrase "market abuse"
3. Case with summary containing both terms

must not top-rank:
- case with only "market" in long attachment
- case with only "abuse" in unrelated context
```

---

## 26. Full-Text Query Debugging Workflow

When result is wrong, do not randomly change boosts.

Use a structured workflow.

### Step 1 — Identify the Query Intent

Ask:

```text
Was the user searching for identifier, phrase, person, concept, or autocomplete?
```

### Step 2 — Inspect Mapping

Check:

```text
Is the target field text or keyword?
Does it have multi-fields?
What analyzer is used?
Is search_analyzer different?
```

### Step 3 — Analyze the Text

Use `_analyze`:

```json
GET cases/_analyze
{
  "field": "summary",
  "text": "market abuse investigation"
}
```

Questions:

- Are tokens what you expect?
- Are stopwords removed?
- Is stemming happening?
- Are synonyms expanding?
- Is case normalized?

### Step 4 — Run Minimal Query

Start with one field, one query.

```json
{
  "match": {
    "summary": "market abuse"
  }
}
```

Then add fields/boosts step by step.

### Step 5 — Explain Score

Use `_explain` for a specific document.

Ask:

```text
Why did this document score high?
Which field contributed?
Was phrase boost applied?
Was a long body field dominating?
```

Scoring and `_explain` will be covered deeper in Part 010.

### Step 6 — Profile Performance

If query is slow, use `_profile`.

Ask:

- Which clause is expensive?
- Is wildcard causing term expansion?
- Are aggregations the real problem?
- Is sorting expensive?
- Is one shard slow?

Performance deep dive starts in Part 021.

---

## 27. Common Anti-Patterns

### 27.1 One Giant `query_string` for Everything

Bad:

```json
{
  "query_string": {
    "query": "user input",
    "fields": ["*"]
  }
}
```

Why bad:

- syntax errors;
- unpredictable scoring;
- too many fields;
- expensive wildcard behavior;
- security/visibility mistakes;
- hard to evolve.

### 27.2 Wildcard Contains Search as Main Search

Bad:

```json
{
  "wildcard": {
    "body.keyword": "*market*"
  }
}
```

Why bad:

- keyword field may contain huge values;
- leading wildcard expensive;
- no linguistic analysis;
- poor relevance;
- dangerous at scale.

### 27.3 `term` Query on `text` Field

Bad:

```json
{
  "term": {
    "summary": "Market Abuse"
  }
}
```

Likely wrong because `summary` is analyzed.

### 27.4 Overusing `operator: and`

Bad for discovery queries:

```json
{
  "match": {
    "summary": {
      "query": "market abuse suspicious trading director disclosure violation",
      "operator": "and"
    }
  }
}
```

Can cause zero result despite relevant documents.

### 27.5 No Exact Boost

If user searches exact title/case number/name, exact matches should often rank highest.

Without keyword subfield or exact boost, a long noisy field can outrank an exact concise field.

### 27.6 Autocomplete Without Debounce

Even perfect backend query can be destroyed by frontend firing one request per keystroke without debounce/cancellation.

Search-as-you-type requires frontend/backend contract.

### 27.7 Mixing Permission Logic into Scoring

Bad:

```json
{
  "should": [
    { "term": { "allowed_user_ids": "u123" } },
    { "match": { "summary": "market abuse" } }
  ]
}
```

Permission should usually be filter eligibility, not scoring signal.

Correct:

```json
{
  "bool": {
    "filter": [
      { "term": { "allowed_user_ids": "u123" } }
    ],
    "must": [
      { "match": { "summary": "market abuse" } }
    ]
  }
}
```

---

## 28. Case Management Example: Search Requirements to Query Design

Suppose kita membangun search untuk enforcement case platform.

### Requirement

User harus bisa mencari case berdasarkan:

- case number;
- case title;
- party/person/company;
- allegation;
- summary;
- document title;
- regulatory topic;
- status/lifecycle;
- assigned team;
- permission.

### Query Input Examples

```text
CASE-2026-000194
market abuse
PT Sinar Jaya
failure to disclose
late filing director
```

### Field Design

```text
case_number.keyword          exact identifier
case_number.prefix           optional prefix helper
case_title                   full-text
case_title.keyword           exact title boost/sort if needed
case_title.suggest           as-you-type field
summary                      full-text
allegations.description      full-text
parties.name                 full-text
parties.name.keyword         exact normalized boost
documents.title              full-text
regulatory_topics.keyword    filter/facet
status.keyword               filter
tenant_id.keyword            filter
visibility fields            filter
```

### Query Design

- Always apply tenant and permission filters.
- If input looks like case number, exact/prefix case number gets high boost.
- Phrase match in title/name gets strong boost.
- General `multi_match` catches broad relevance.
- Status/team/topic are filters, not full-text.
- Autocomplete uses separate endpoint/field.

### Why Separate Normal Search and Autocomplete?

Normal search:

```text
optimized for relevance, explainability, filters, pagination
```

Autocomplete:

```text
optimized for low latency, prefix/incremental typing, short result list
```

Trying to make one query serve both often creates mediocre behavior for both.

---

## 29. Practical Heuristics

### 29.1 Choosing Query Type

| User input / behavior | Query pattern |
|---|---|
| Natural keyword search | `match` or `multi_match` |
| Exact phrase important | `match_phrase` / `multi_match` `phrase` |
| Multi-field general search | `multi_match` `best_fields` |
| Analyzer variants of same field | `multi_match` `most_fields` |
| Name split across fields | `multi_match` `cross_fields` |
| Search-as-you-type | `search_as_you_type` + `bool_prefix` |
| Identifier exact | `term` on `keyword` |
| Identifier prefix | `prefix` on `keyword` |
| Power user syntax | `simple_query_string` or controlled `query_string` |
| Contains substring | dedicated n-gram field; avoid wildcard by default |

### 29.2 Boosting Strategy

Start with simple boosts:

```text
exact identifier/name/title  -> very high
phrase title/name            -> high
title/name token match       -> medium-high
summary/allegation           -> medium
body/attachment              -> lower
```

Then evaluate with real queries.

Do not tune boosts by gut feeling only. Use golden query sets.

### 29.3 Query Safety Strategy

For public/general endpoints:

- no raw `query_string` by default;
- no arbitrary field selection;
- no leading wildcard;
- no unrestricted regexp;
- limit size;
- validate query length;
- use filters for permissions;
- set timeout for risky endpoints;
- log slow queries and zero-result queries.

---

## 30. What Top 1% Engineers Do Differently

Average Elasticsearch usage:

```text
Put all fields into multi_match and hope relevance is okay.
```

Top-tier Elasticsearch engineering:

```text
Understand query intent.
Design fields for that intent.
Choose analyzer deliberately.
Compose query clauses with explainable purpose.
Separate eligibility filters from scoring signals.
Boost exact/phrase/domain signals intentionally.
Avoid expensive query classes by design.
Test relevance with golden queries.
Monitor search behavior in production.
Iterate based on evidence.
```

Average engineer asks:

> “Which Elasticsearch query should I use?”

Strong engineer asks:

> “What is the user trying to retrieve, what evidence should count as relevance, what field representation supports that evidence, and what query pattern expresses it with bounded cost?”

---

## 31. Mini Lab: Build Full-Text Query Patterns

### 31.1 Create Example Index

```json
PUT cases_fulltext_lab
{
  "settings": {
    "analysis": {
      "normalizer": {
        "lowercase_normalizer": {
          "type": "custom",
          "filter": ["lowercase"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "tenant_id": { "type": "keyword" },
      "case_number": {
        "type": "keyword",
        "normalizer": "lowercase_normalizer"
      },
      "case_title": {
        "type": "text",
        "fields": {
          "keyword": {
            "type": "keyword",
            "normalizer": "lowercase_normalizer"
          },
          "sayt": {
            "type": "search_as_you_type"
          }
        }
      },
      "summary": { "type": "text" },
      "party_name": {
        "type": "text",
        "fields": {
          "keyword": {
            "type": "keyword",
            "normalizer": "lowercase_normalizer"
          }
        }
      },
      "status": { "type": "keyword" },
      "is_deleted": { "type": "boolean" }
    }
  }
}
```

### 31.2 Index Sample Documents

```json
POST cases_fulltext_lab/_bulk
{ "index": { "_id": "1" } }
{ "tenant_id": "t1", "case_number": "case-2026-000001", "case_title": "Market Abuse Investigation", "summary": "Investigation into suspected market abuse by a licensed broker.", "party_name": "PT Sinar Jaya Abadi", "status": "OPEN", "is_deleted": false }
{ "index": { "_id": "2" } }
{ "tenant_id": "t1", "case_number": "case-2026-000002", "case_title": "Late Filing Review", "summary": "Review of repeated late disclosure filing by a public company.", "party_name": "PT Market Nusantara", "status": "OPEN", "is_deleted": false }
{ "index": { "_id": "3" } }
{ "tenant_id": "t1", "case_number": "case-2026-000003", "case_title": "Broker Conduct Assessment", "summary": "The abuse report was routed to the market conduct supervision unit.", "party_name": "Budi Santoso", "status": "CLOSED", "is_deleted": false }
```

### 31.3 Compare `match` and `match_phrase`

```json
GET cases_fulltext_lab/_search
{
  "query": {
    "match": {
      "summary": "market abuse"
    }
  }
}
```

Then:

```json
GET cases_fulltext_lab/_search
{
  "query": {
    "match_phrase": {
      "summary": "market abuse"
    }
  }
}
```

Observe:

- Which documents match both terms separately?
- Which documents match phrase order?
- How does score change?

### 31.4 Multi-Field Query

```json
GET cases_fulltext_lab/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "t1" } },
        { "term": { "is_deleted": false } }
      ],
      "should": [
        {
          "multi_match": {
            "query": "market abuse",
            "type": "phrase",
            "fields": ["case_title^5", "summary^2"]
          }
        },
        {
          "multi_match": {
            "query": "market abuse",
            "type": "best_fields",
            "fields": ["case_title^3", "summary", "party_name^2"]
          }
        }
      ],
      "minimum_should_match": 1
    }
  }
}
```

Observe:

- Does title phrase win?
- Does party name containing `Market` create noise?
- Does summary phrase boost behave as expected?

### 31.5 Search-As-You-Type

```json
GET cases_fulltext_lab/_search
{
  "query": {
    "multi_match": {
      "query": "market ab",
      "type": "bool_prefix",
      "fields": [
        "case_title.sayt",
        "case_title.sayt._2gram",
        "case_title.sayt._3gram"
      ]
    }
  }
}
```

Observe:

- Does it find `Market Abuse Investigation`?
- What happens for query `mar`?
- What happens for query `ab`?
- Is the result behavior acceptable for your UX?

---

## 32. Checklist for Designing Full-Text Query

Before shipping a full-text query endpoint, answer:

```text
[ ] What are the supported query intents?
[ ] Which fields are searched?
[ ] Which fields are filters only?
[ ] Which fields are text vs keyword?
[ ] What analyzer is used per field?
[ ] Is exact match boosted?
[ ] Is phrase match boosted?
[ ] Is broad match available for recall?
[ ] Are permission filters in filter context?
[ ] Are lifecycle/tenant filters deterministic?
[ ] Is query_string avoided or controlled?
[ ] Are wildcard/regexp queries restricted?
[ ] Is autocomplete separated from normal search if needed?
[ ] Is there query length validation?
[ ] Is result size bounded?
[ ] Is query behavior covered by tests?
[ ] Is there logging for zero-result and slow queries?
```

---

## 33. Key Takeaways

1. Full-text query is not substring matching; it is analyzer-driven term retrieval plus scoring.
2. `match` is the default workhorse for analyzed text fields.
3. `match_phrase` is for ordered phrase evidence, often best used as a boost rather than the only query.
4. `multi_match` is powerful, but its type matters: `best_fields`, `most_fields`, `cross_fields`, `phrase`, and `bool_prefix` express different relevance assumptions.
5. `query_string` is powerful but strict and risky for ordinary user search boxes.
6. Wildcard and regexp are not general search solutions; they are specialized tools with serious cost risks.
7. Search-as-you-type needs dedicated design: frontend debounce, field strategy, query pattern, and result limit.
8. Good query design separates eligibility filters from scoring signals.
9. Relevance should be explainable, testable, and iterated with real query examples.
10. The best Elasticsearch engineers design query patterns from user intent, not from API memorization.

---

## 34. Referensi Resmi dan Bacaan Lanjutan

Referensi utama:

- Elastic Docs — Match query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-match-query
- Elastic Docs — Match phrase query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-match-query-phrase
- Elastic Docs — Match phrase prefix query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-match-query-phrase-prefix
- Elastic Docs — Multi-match query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-multi-match-query
- Elastic Docs — Query string query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-query-string-query
- Elastic Docs — Wildcard query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-wildcard-query
- Elastic Docs — Search-as-you-type field type: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/search-as-you-type
- Elastic Docs — Edge n-gram tokenizer: https://www.elastic.co/docs/reference/text-analysis/analysis-edgengram-tokenizer
- Elastic Docs — Edge n-gram token filter: https://www.elastic.co/docs/reference/text-analysis/analysis-edgengram-tokenfilter
- Elastic Docs — Search suggesters / completion suggester: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/search-suggesters

---

## 35. Apa Berikutnya?

Part berikutnya adalah:

```text
Part 010 — Relevance Engineering I: Scoring, Ranking, and BM25
```

Di Part 010 kita akan membongkar kenapa hasil A muncul di atas hasil B:

- apa itu score;
- bagaimana BM25 bekerja secara intuitif;
- term frequency saturation;
- inverse document frequency;
- field length normalization;
- boosting;
- `_explain`;
- bagaimana men-debug ranking yang salah.

Jika Part 009 adalah tentang memilih query pattern, Part 010 adalah tentang memahami **mengapa query tersebut menghasilkan urutan hasil tertentu**.

---

**Status seri:** belum selesai.  
**Part selesai:** 009 / 034.  
**Next:** Part 010 — Relevance Engineering I: Scoring, Ranking, and BM25.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-008.md">⬅️ Part 008 — Query DSL Foundations</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-010.md">Part 010 — Relevance Engineering I: Scoring, Ranking, and BM25 ➡️</a>
</div>
