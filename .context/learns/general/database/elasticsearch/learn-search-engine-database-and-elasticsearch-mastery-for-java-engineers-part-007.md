# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-007.md

# Part 007 — Text Analysis Pipeline

> Series: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Audience: Java software engineer / backend engineer / technical lead  
> Focus: analyzer, tokenizer, token filter, char filter, index-time analysis, search-time analysis, custom analyzer design, debugging, language/domain search behavior

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- **Part 000**: orientasi, scope, dan mental model Elasticsearch.
- **Part 001**: problem search dari lookup sampai relevance.
- **Part 002**: information retrieval core model.
- **Part 003**: Lucene internals: segment, refresh, commit, merge.
- **Part 004**: arsitektur Elasticsearch: cluster, node, shard, replica, routing.
- **Part 005**: document modeling untuk search.
- **Part 006**: mapping sebagai schema search.

Part ini masuk ke salah satu area paling penting dalam search engine: **text analysis**.

Elasticsearch tidak menyimpan teks untuk full-text search sebagai string mentah lalu mencari substring. Elasticsearch memproses teks menjadi token-token yang masuk ke inverted index. Proses inilah yang disebut **analysis**.

Kalau mapping adalah keputusan tentang **field ini diperlakukan sebagai apa**, maka analysis adalah keputusan tentang:

> “Teks ini harus dipecah, dinormalisasi, dibuang, ditambah, atau diubah menjadi term seperti apa agar query user bisa bertemu dengan document yang tepat?”

Kesalahan analyzer sering menghasilkan bug search yang terlihat seperti ini:

- user mencari `case management`, tetapi hasil `case-management` tidak muncul;
- user mencari `KTP`, tetapi document berisi `kartu tanda penduduk` tidak muncul;
- user mencari `pengawasan`, tetapi `mengawasi` atau `diawasi` tidak muncul;
- user mencari nomor perkara `ABC-2024-001`, tetapi hasilnya kacau;
- autocomplete lambat karena n-gram terlalu agresif;
- exact match identifier rusak karena field dianalisis seperti natural language;
- synonym membuat hasil tidak relevan karena dipasang di tempat yang salah;
- stemming membuat kata domain-specific kehilangan makna penting.

Top-tier engineer tidak hanya tahu `standard analyzer`. Mereka tahu bahwa analyzer adalah bagian dari **product semantics**, **domain language**, **cost model**, dan **operational governance**.

---

## 1. Core Mental Model: Search Tidak Mencari Teks, Search Mencari Term

Misalkan sebuah document memiliki field:

```json
{
  "title": "Regulatory Enforcement Case Management"
}
```

Jika field `title` bertipe `text`, Elasticsearch tidak sekadar menyimpan string tersebut lalu melakukan pencarian substring.

Dengan analyzer default, teks itu bisa diproses menjadi term seperti:

```text
regulatory
enforcement
case
management
```

Ketika user mencari:

```text
Enforcement cases
```

query text juga dianalisis. Hasilnya mungkin:

```text
enforcement
cases
```

Lalu search engine membandingkan term query dengan term dalam inverted index.

Inilah titik penting:

> Full-text search terjadi pada level term, bukan level string mentah.

Implikasinya besar:

- Kalau document text dan query text dianalisis berbeda, mereka mungkin tidak bertemu.
- Kalau tokenisasi salah, field bisa tidak searchable sesuai harapan.
- Kalau normalisasi salah, variasi penulisan bisa dianggap berbeda.
- Kalau stemming terlalu agresif, kata yang berbeda bisa dianggap sama secara keliru.
- Kalau synonym tidak dirancang, vocabulary mismatch tidak terselesaikan.
- Kalau identifier dianalisis seperti kalimat, exact lookup bisa rusak.

Search problem sering bukan karena query DSL salah, melainkan karena **term yang dihasilkan oleh analyzer tidak sesuai dengan intent user**.

---

## 2. Apa Itu Text Analysis?

Text analysis adalah proses mengubah teks mentah menjadi token-token yang dapat diindeks dan dicari.

Secara konseptual, pipeline-nya:

```text
raw text
  -> character filtering
  -> tokenization
  -> token filtering
  -> token stream
  -> inverted index
```

Dalam Elasticsearch, analyzer biasanya terdiri dari tiga komponen:

1. **Character filter**  
   Memodifikasi karakter sebelum tokenisasi.

2. **Tokenizer**  
   Memecah karakter menjadi token.

3. **Token filter**  
   Memodifikasi, menghapus, atau menambahkan token setelah tokenisasi.

Contoh sederhana:

Input:

```text
"The QUICK brown-foxes!"
```

Pipeline hipotetis:

```text
raw text:
The QUICK brown-foxes!

char filter:
The QUICK brown foxes!

tokenizer:
[The, QUICK, brown, foxes]

token filter lowercase:
[the, quick, brown, foxes]

token filter stopword:
[quick, brown, foxes]

token filter stemming:
[quick, brown, fox]
```

Final tokens:

```text
quick
brown
fox
```

Inilah yang akan dipakai dalam inverted index.

---

## 3. Analyzer Bukan Formatter Teks

Kesalahan umum adalah menganggap analyzer sebagai “text cleanup”. Itu terlalu dangkal.

Analyzer menentukan **bahasa pencocokan** antara query dan document.

Contoh:

```text
Document: "investigasi kasus pelanggaran pasar modal"
Query:    "penyelidikan pelanggaran bursa"
```

Secara substring, query dan document tidak terlalu mirip.

Namun secara domain intent, mungkin sangat terkait.

Analyzer dapat membantu sebagian masalah:

- lowercasing: `KASUS` = `kasus`
- asciifolding: `café` = `cafe`
- stemming: `pelanggaran`, `melanggar`, `dilanggar` mungkin didekatkan
- synonym: `bursa` ≈ `pasar modal`, `investigasi` ≈ `penyelidikan`

Tetapi analyzer juga bisa merusak:

- `PT` sebagai singkatan perseroan terbatas jangan disamakan dengan kata lain sembarangan;
- `OJK`, `KPK`, `IDX`, `AML`, `KYC` harus diperlakukan hati-hati;
- nomor kasus `CASE-2024-001/A` tidak boleh dipecah secara naif kalau user sering mencari exact identifier;
- nama orang dan badan hukum bisa kehilangan presisi jika terlalu banyak normalisasi.

Jadi analyzer adalah desain semantics, bukan kosmetik.

---

## 4. Index-Time Analysis vs Search-Time Analysis

Ada dua momen penting:

1. **Index-time analysis**  
   Saat document dimasukkan ke index.

2. **Search-time analysis**  
   Saat query user diproses.

Contoh:

```json
PUT cases
{
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "analyzer": "standard"
      }
    }
  }
}
```

Ketika document di-index:

```json
{
  "title": "Market Abuse Investigation"
}
```

Elasticsearch menganalisis `title` menggunakan analyzer field tersebut.

Ketika query dilakukan:

```json
GET cases/_search
{
  "query": {
    "match": {
      "title": "market investigation"
    }
  }
}
```

Query text juga dianalisis.

Biasanya analyzer index-time dan search-time sebaiknya sama, karena term query harus berada dalam format yang sama dengan term di inverted index. Namun ada kasus valid untuk berbeda, misalnya autocomplete: index-time memakai edge n-gram, search-time memakai standard analyzer agar query user tidak ikut dipecah terlalu agresif.

Mental model penting:

> Index-time analyzer menentukan term apa yang tersedia. Search-time analyzer menentukan term apa yang dicari.

Kalau term yang dicari tidak pernah tersedia, query tidak akan match.

---

## 5. Kenapa Analyzer Mismatch Berbahaya

Misalkan field `name` menggunakan analyzer yang menghasilkan n-gram:

```text
Document: "andrew"
Index tokens: a, an, and, andr, andre, andrew
```

Lalu search-time analyzer juga n-gram:

```text
Query: "an"
Search tokens: a, an
```

Query pendek seperti `an` bisa match terlalu banyak document karena token `a` sangat umum.

Contoh lain:

Index-time:

```text
"case-management" -> [case, management]
```

Search-time:

```text
"case-management" -> [case-management]
```

Jika analyzer berbeda secara tidak sengaja, document dan query bisa tidak bertemu.

Gejala analyzer mismatch:

- exact-looking query tidak match;
- autocomplete terlalu noisy;
- phrase query gagal;
- highlight tidak sesuai;
- score terasa aneh;
- synonym bekerja di sebagian query tapi tidak di query lain;
- query di environment dev berbeda hasil dari prod karena analyzer setting berbeda.

Rule praktis:

> Jangan ubah analyzer tanpa golden query test dan reindex plan.

Analyzer bukan setting ringan. Analyzer adalah bagian dari schema dan relevance behavior.

---

## 6. Character Filter

Character filter berjalan sebelum tokenizer.

Tugasnya mengubah karakter mentah sebelum proses pemecahan token.

Contoh kegunaan:

- mengganti simbol tertentu;
- menghapus HTML tag;
- normalisasi tanda baca;
- mapping karakter khusus;
- mengubah `&` menjadi `and`;
- mengubah variasi dash menjadi `-` atau spasi;
- menormalkan format tertentu sebelum tokenisasi.

Contoh custom char filter:

```json
PUT analysis_demo
{
  "settings": {
    "analysis": {
      "char_filter": {
        "ampersand_to_and": {
          "type": "mapping",
          "mappings": [
            "& => and"
          ]
        }
      },
      "analyzer": {
        "company_name_analyzer": {
          "type": "custom",
          "char_filter": ["ampersand_to_and"],
          "tokenizer": "standard",
          "filter": ["lowercase"]
        }
      }
    }
  }
}
```

Input:

```text
Smith & Partners
```

Menjadi kira-kira:

```text
smith
and
partners
```

### 6.1 Kapan Character Filter Berguna?

Gunakan character filter ketika masalahnya terjadi **sebelum tokenisasi**.

Contoh:

```text
BCA/BANK-CENTRAL-ASIA
```

Anda mungkin ingin `/` dan `-` diperlakukan sebagai pemisah tertentu.

Atau:

```text
PT. Maju Jaya, Tbk.
```

Anda mungkin ingin tanda titik pada abbreviation tertentu tidak mengacaukan tokenisasi.

Tetapi hati-hati: character filter terlalu agresif dapat menghapus informasi penting.

Contoh buruk:

```text
CASE-2024-001
```

Jika semua dash diubah menjadi spasi, maka identifier bisa pecah menjadi:

```text
case
2024
001
```

Itu mungkin bagus untuk partial search, tetapi buruk untuk exact identifier search. Solusinya biasanya bukan memilih salah satu, tetapi memakai **multi-field**:

```text
case_number.keyword       -> exact search
case_number.search_text   -> partial/flexible search
case_number.edge          -> autocomplete/prefix search
```

---

## 7. Tokenizer

Tokenizer adalah komponen yang memecah stream karakter menjadi token.

Contoh:

```text
Input: "Quick brown fox!"
Whitespace tokenizer: [Quick, brown, fox!]
Standard tokenizer:   [Quick, brown, fox]
```

Tokenizer menentukan unit dasar pencarian.

Beberapa tokenizer umum:

| Tokenizer | Kegunaan |
|---|---|
| `standard` | default umum untuk banyak teks natural language |
| `whitespace` | split berdasarkan whitespace saja |
| `keyword` | seluruh input menjadi satu token |
| `pattern` | split berdasarkan regex |
| `ngram` | membuat substring gram dari teks |
| `edge_ngram` | membuat prefix gram dari teks/token |
| language-specific tokenizer | berguna untuk bahasa tertentu, terutama bahasa tanpa spasi eksplisit seperti CJK |

### 7.1 Standard Tokenizer

`standard` tokenizer cocok untuk banyak kasus umum karena memecah teks berdasarkan aturan Unicode text segmentation.

Contoh:

```text
"Regulatory Enforcement Case"
-> regulatory, enforcement, case
```

Untuk field seperti `title`, `description`, `summary`, `notes`, `body`, standard analyzer sering menjadi baseline.

Tetapi standard tokenizer tidak selalu cocok untuk:

- SKU;
- nomor perkara;
- kode dokumen;
- email address;
- URL;
- nama organisasi dengan simbol penting;
- domain terminology dengan hyphen signifikan;
- autocomplete;
- search dalam bahasa tertentu.

### 7.2 Keyword Tokenizer

`keyword` tokenizer tidak memecah teks. Seluruh input menjadi satu token.

Contoh:

```text
"CASE-2024-001/A"
-> CASE-2024-001/A
```

Ini berguna untuk:

- exact identifier;
- normalized keyword field;
- case-insensitive exact match dengan lowercase normalizer/analyzer;
- path-like field;
- code-like field.

Tetapi untuk natural language, keyword tokenizer buruk karena query harus match satu token penuh.

### 7.3 Whitespace Tokenizer

`whitespace` tokenizer hanya split berdasarkan whitespace.

Contoh:

```text
"case-management system"
-> case-management, system
```

Ini mempertahankan punctuation di token.

Kadang berguna untuk field yang ingin memisahkan berdasarkan spasi saja, tetapi hati-hati karena punctuation ikut terbawa.

### 7.4 Pattern Tokenizer

`pattern` tokenizer menggunakan regex.

Berguna ketika format domain cukup stabil.

Contoh:

- split berdasarkan `-`, `/`, `_`;
- split berdasarkan punctuation tertentu;
- memproses kode internal.

Tetapi regex tokenizer bisa mahal dan rawan edge case. Jangan jadikan pattern tokenizer sebagai tempat menaruh semua logika domain yang sebenarnya lebih cocok di ingestion layer.

### 7.5 N-Gram Tokenizer

N-gram membuat potongan substring.

Contoh token `fox` dengan min_gram 1 dan max_gram 2:

```text
f
fo
o
ox
x
```

N-gram bisa membantu partial matching, tetapi sangat mahal karena memperbanyak token.

Gunakan dengan sangat sadar.

### 7.6 Edge N-Gram Tokenizer

Edge n-gram membuat prefix token.

Contoh `management` dengan min_gram 2 dan max_gram 5:

```text
ma
man
mana
manag
```

Ini cocok untuk autocomplete prefix-based.

Tetapi edge n-gram juga memperbesar index dan dapat membuat token umum seperti `m`, `ma`, `a`, `an` sangat noisy jika min_gram terlalu kecil.

Rule praktis:

```text
min_gram 1 hampir selalu terlalu noisy untuk production search umum.
min_gram 2 masih berisiko noisy.
min_gram 3 sering menjadi baseline lebih sehat, tergantung bahasa dan domain.
```

---

## 8. Token Filter

Token filter menerima token stream dari tokenizer, lalu dapat:

- mengubah token;
- menghapus token;
- menambahkan token.

Contoh token filters:

| Token Filter | Efek |
|---|---|
| `lowercase` | mengubah token menjadi huruf kecil |
| `stop` | menghapus stopwords |
| `stemmer` | mengubah kata ke bentuk dasar/stem |
| `asciifolding` | mengubah karakter aksen ke bentuk ASCII |
| `synonym` | menambahkan/mengganti synonym |
| `edge_ngram` | membuat prefix gram dari token |
| `ngram` | membuat substring gram dari token |
| `shingle` | membuat token gabungan seperti bigram |
| `unique` | menghapus token duplikat tertentu |

### 8.1 Lowercase

Lowercase hampir selalu baseline untuk full-text field.

```text
"CASE Management"
-> case, management
```

Tanpa lowercase, `Case`, `CASE`, dan `case` bisa menjadi term berbeda.

Namun untuk field tertentu, case bisa bermakna.

Contoh:

- kode `ABC` vs `abc` mungkin harus sama;
- password/token tidak boleh dianalisis;
- symbol teknis tertentu mungkin case-sensitive.

Search field umum biasanya lowercase; exact technical identifier perlu dirancang eksplisit.

### 8.2 Stopword

Stopword filter menghapus kata umum seperti `the`, `a`, `and`, tergantung bahasa.

Manfaat:

- mengurangi noise;
- mengurangi index size;
- meningkatkan fokus pada term bermakna.

Risiko:

- phrase query bisa berubah perilaku;
- domain term pendek bisa hilang;
- kata yang terlihat umum bisa penting dalam konteks legal/regulatory.

Contoh:

```text
"fit and proper test"
```

Jika `and` dihapus, mungkin tidak masalah. Tetapi pada frasa legal tertentu, stopword bisa menjadi bagian dari istilah tetap.

Rule praktis:

> Jangan memakai stopword list hanya karena “textbook IR bilang begitu”. Validasi terhadap query dan corpus nyata.

### 8.3 Stemming

Stemming mencoba menyederhanakan variasi kata menjadi stem.

Contoh bahasa Inggris:

```text
investigate
investigating
investigation
```

bisa didekatkan menjadi stem serupa.

Manfaat:

- meningkatkan recall;
- query dengan bentuk kata berbeda bisa match.

Risiko:

- over-stemming: kata berbeda menjadi sama;
- under-stemming: variasi penting tidak disatukan;
- stemming bahasa salah;
- domain term rusak.

Contoh risiko:

```text
policy
police
```

Dalam beberapa analyzer/stemmer, istilah yang tampak mirip bisa menghasilkan efek tidak diinginkan jika tidak diuji.

Untuk sistem regulatory, stemming harus diuji sangat hati-hati karena istilah hukum/aturan sering presisi.

### 8.4 Asciifolding

`asciifolding` mengubah karakter aksen menjadi bentuk ASCII.

Contoh:

```text
café -> cafe
résumé -> resume
```

Berguna untuk search yang harus toleran terhadap variasi pengetikan.

Tetapi untuk nama orang atau istilah bahasa tertentu, folding bisa menghilangkan distinction. Biasanya tetap berguna sebagai salah satu multi-field.

### 8.5 Synonym

Synonym adalah salah satu fitur paling powerful dan paling berbahaya.

Contoh:

```text
KTP => kartu tanda penduduk
AML => anti money laundering
OJK => otoritas jasa keuangan
pasar modal, bursa efek
```

Synonym membantu vocabulary mismatch.

Namun synonym salah bisa membuat hasil kacau.

Contoh buruk:

```text
bank => financial institution, river bank
```

Dalam domain Indonesia/regulatory, `bank` hampir selalu lembaga keuangan, tetapi di corpus umum bisa ambigu.

Synonym perlu governance:

- siapa boleh menambah synonym;
- bagaimana diuji;
- apakah synonym berlaku global atau per field;
- apakah synonym index-time atau search-time;
- apakah synonym equivalent atau directional;
- bagaimana rollback jika relevance rusak.

---

## 9. Standard Analyzer

Default analyzer Elasticsearch adalah `standard` analyzer.

Secara praktis, standard analyzer melakukan:

- tokenisasi dengan standard tokenizer;
- lowercasing;
- stopword filter tersedia tetapi default-nya tidak aktif dalam banyak konfigurasi standar.

Contoh:

```json
GET _analyze
{
  "analyzer": "standard",
  "text": "The QUICK brown-foxes jumped over CASE-2024-001"
}
```

Kemungkinan token kira-kira:

```text
the
quick
brown
foxes
jumped
over
case
2024
001
```

Perhatikan bahwa `CASE-2024-001` bisa pecah menjadi beberapa token. Untuk natural language search ini mungkin oke; untuk exact identifier ini bisa bermasalah.

### 9.1 Kapan Standard Analyzer Cukup?

Cukup untuk:

- title umum;
- description umum;
- notes;
- comment;
- content yang tidak terlalu domain-specific;
- baseline awal sebelum relevance tuning.

Tidak cukup untuk:

- autocomplete production-grade;
- synonym-heavy domain;
- legal/regulatory terminology;
- exact identifier;
- multilingual corpus kompleks;
- product catalog dengan SKU/brand/model;
- search yang sangat sensitive terhadap phrase dan naming.

---

## 10. Analyzer untuk `text` vs Normalizer untuk `keyword`

Dari Part 006, kita sudah tahu string sering dimodelkan sebagai:

```json
"title": {
  "type": "text",
  "fields": {
    "keyword": {
      "type": "keyword"
    }
  }
}
```

Field `text` dianalisis dengan analyzer.

Field `keyword` tidak dianalisis seperti full-text. Namun `keyword` bisa memakai **normalizer** untuk normalisasi sederhana yang menghasilkan satu token.

Contoh normalizer untuk case-insensitive exact match:

```json
PUT cases
{
  "settings": {
    "analysis": {
      "normalizer": {
        "lowercase_normalizer": {
          "type": "custom",
          "filter": ["lowercase", "asciifolding"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "case_number": {
        "type": "keyword",
        "normalizer": "lowercase_normalizer"
      }
    }
  }
}
```

Input:

```text
CASE-2024-001
```

Term keyword normalized:

```text
case-2024-001
```

Ini bagus untuk:

- exact filter;
- sorting;
- aggregation;
- case-insensitive exact lookup.

Rule:

```text
Natural language -> text + analyzer.
Exact structured value -> keyword + normalizer.
But many real fields need both via multi-fields.
```

---

## 11. Multi-Field Analyzer Strategy

Satu field konseptual sering perlu beberapa representasi search.

Contoh `case_title`:

```json
"case_title": {
  "type": "text",
  "analyzer": "case_text_analyzer",
  "fields": {
    "keyword": {
      "type": "keyword",
      "ignore_above": 256
    },
    "folded": {
      "type": "text",
      "analyzer": "folded_text_analyzer"
    },
    "autocomplete": {
      "type": "text",
      "analyzer": "autocomplete_index_analyzer",
      "search_analyzer": "autocomplete_search_analyzer"
    }
  }
}
```

Representasi:

| Field | Tujuan |
|---|---|
| `case_title` | full-text normal search |
| `case_title.keyword` | exact sort/filter/aggregation jika aman |
| `case_title.folded` | tolerant search terhadap accent/case |
| `case_title.autocomplete` | prefix autocomplete |

Ini jauh lebih baik daripada mencoba membuat satu analyzer super kompleks untuk semua kebutuhan.

Mental model:

> Satu business field dapat memiliki banyak search surface.

---

## 12. Designing Analyzer from Query Behavior

Analyzer tidak boleh didesain dari asumsi teknis saja. Mulailah dari query behavior.

Tanyakan:

1. User mencari apa?
2. Mereka mengetik bahasa natural atau kode?
3. Query pendek atau panjang?
4. Banyak typo atau tidak?
5. Butuh exact match atau fuzzy match?
6. Butuh synonym/domain vocabulary?
7. Search result harus sangat presisi atau recall tinggi?
8. Field digunakan untuk filter/sort/facet juga?
9. Bahasa apa yang dominan?
10. Apakah ada istilah hukum/regulatory yang tidak boleh dinormalisasi sembarangan?

Contoh query behavior untuk case management:

| Query | Intent | Analyzer implication |
|---|---|---|
| `CASE-2024-001` | exact case lookup | keyword normalized field |
| `market abuse` | full-text topic search | standard/custom text analyzer |
| `pelanggaran pasar modal` | Indonesian phrase/topic | Indonesian/domain analyzer |
| `OJK` | acronym | synonym/acronym handling, keyword subfield |
| `anti money laundering` | phrase/domain term | shingle or synonym may help |
| `John Doe` | party/person search | name analyzer, maybe folded/lowercase |
| `manaj` | autocomplete | edge n-gram/search-as-you-type field |
| `pengawasan bank` | domain concept | stemming/synonym/domain dictionary careful |

Analyzer follows query behavior, not the other way around.

---

## 13. Example: Baseline Analyzer for Case Search

Misalkan kita punya regulatory case index.

Kita butuh:

- title search;
- description search;
- exact case number;
- autocomplete title;
- acronym/synonym support later;
- Indonesian/English mixed corpus.

Baseline mapping:

```json
PUT regulatory_cases_v1
{
  "settings": {
    "analysis": {
      "filter": {
        "case_autocomplete_filter": {
          "type": "edge_ngram",
          "min_gram": 3,
          "max_gram": 20
        }
      },
      "normalizer": {
        "lowercase_keyword_normalizer": {
          "type": "custom",
          "filter": ["lowercase", "asciifolding"]
        }
      },
      "analyzer": {
        "case_text_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding"]
        },
        "case_autocomplete_index_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding", "case_autocomplete_filter"]
        },
        "case_autocomplete_search_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "case_number": {
        "type": "keyword",
        "normalizer": "lowercase_keyword_normalizer",
        "fields": {
          "text": {
            "type": "text",
            "analyzer": "case_text_analyzer"
          }
        }
      },
      "title": {
        "type": "text",
        "analyzer": "case_text_analyzer",
        "fields": {
          "autocomplete": {
            "type": "text",
            "analyzer": "case_autocomplete_index_analyzer",
            "search_analyzer": "case_autocomplete_search_analyzer"
          },
          "keyword": {
            "type": "keyword",
            "ignore_above": 512
          }
        }
      },
      "description": {
        "type": "text",
        "analyzer": "case_text_analyzer"
      }
    }
  }
}
```

### Kenapa desain ini masuk akal?

`case_number` sebagai `keyword` menjaga exact lookup.

`case_number.text` memberi opsi partial text search kalau user hanya mengetik bagian tertentu.

`title` sebagai `text` menangani full-text.

`title.autocomplete` menangani prefix query dengan index-time edge n-gram, tetapi search-time analyzer tetap normal agar query user tidak dipecah menjadi n-gram juga.

`lowercase` dan `asciifolding` memberi toleransi variasi case/accent.

Belum ada stemming atau synonym karena itu butuh evaluasi corpus dan query nyata. Ini baseline yang relatif aman.

---

## 14. Debugging Analyzer dengan `_analyze`

Sebelum menyalahkan query DSL, selalu cek token.

Contoh:

```json
GET regulatory_cases_v1/_analyze
{
  "analyzer": "case_text_analyzer",
  "text": "CASE-2024-001 Market Abuse Investigation"
}
```

Output akan berisi token, position, start offset, end offset, type.

Yang harus diperhatikan:

- token apa yang muncul;
- token apa yang hilang;
- apakah casing normal;
- apakah punctuation pecah sesuai harapan;
- apakah angka tetap ada;
- apakah acronym tetap bisa dicari;
- apakah position masuk akal untuk phrase query;
- apakah offset benar untuk highlighting.

Contoh checklist:

```text
Input: "PT. Bank Maju Jaya Tbk"
Expected tokens:
pt?
bank
maju
jaya
tbk?

Questions:
- Apakah "PT" perlu searchable?
- Apakah "Tbk" perlu searchable?
- Apakah "PT Bank" phrase penting?
- Apakah punctuation mengganggu?
```

### 14.1 Analyze Field Analyzer

Anda juga bisa menganalisis menggunakan analyzer yang melekat pada field:

```json
GET regulatory_cases_v1/_analyze
{
  "field": "title",
  "text": "Market Abuse Investigation"
}
```

Ini bagus untuk memastikan mapping field benar-benar memakai analyzer yang Anda kira.

### 14.2 Debugging Autocomplete Analyzer

```json
GET regulatory_cases_v1/_analyze
{
  "analyzer": "case_autocomplete_index_analyzer",
  "text": "management"
}
```

Expected token kira-kira:

```text
man
mana
manag
manage
managem
manageme
managemen
management
```

Jika min_gram terlalu kecil, Anda akan melihat token seperti:

```text
m
ma
```

Token pendek ini bisa sangat noisy.

---

## 15. Analyzer and Phrase Query

Phrase query bergantung pada token position.

Misalnya:

```text
"anti money laundering"
```

Analyzer menghasilkan:

```text
anti(position 0)
money(position 1)
laundering(position 2)
```

`match_phrase` dapat mencari urutan posisi ini.

Tetapi jika stopword menghapus token:

```text
"fit and proper"
```

Jika `and` dihapus, posisi bisa menjadi:

```text
fit(position 0)
proper(position 2)
```

Phrase query behavior bisa berubah tergantung position increment.

Jika synonym menambahkan multi-token synonym, phrase query juga bisa menjadi kompleks.

Karena itu, phrase-heavy domain seperti legal/regulatory search membutuhkan analyzer testing yang serius.

---

## 16. Shingle: Token Gabungan untuk Phrase-like Matching

Shingle filter membuat token gabungan dari token berurutan.

Input:

```text
anti money laundering compliance
```

Unigram:

```text
anti
money
laundering
compliance
```

Bigram/shingle:

```text
anti money
money laundering
laundering compliance
```

Shingle bisa membantu phrase relevance, tetapi menambah token dan index size.

Gunakan ketika:

- phrase/domain term sangat penting;
- Anda ingin phrase-like signal tanpa selalu memakai expensive phrase query;
- Anda punya controlled fields seperti title atau short description.

Jangan langsung pakai shingle di body besar tanpa evaluasi cost.

---

## 17. Synonym Design: Equivalent vs Directional

Ada dua pola synonym penting.

### 17.1 Equivalent Synonym

```text
ojk, otoritas jasa keuangan
```

Artinya query `ojk` bisa match `otoritas jasa keuangan`, dan sebaliknya.

Cocok jika istilah benar-benar setara.

### 17.2 Directional Synonym

```text
ktp => kartu tanda penduduk
```

Artinya query `ktp` diperluas ke `kartu tanda penduduk`, tetapi tidak selalu sebaliknya tergantung desain.

Directional synonym berguna ketika abbreviation harus expand, tetapi full phrase tidak perlu selalu disamakan ke abbreviation.

### 17.3 Synonym Bisa Menaikkan Recall dan Menurunkan Precision

Synonym hampir selalu meningkatkan recall, tetapi dapat menurunkan precision.

Contoh:

```text
sanksi, penalti, hukuman
```

Di domain tertentu, `sanksi administratif`, `penalti`, dan `hukuman pidana` tidak identik. Jika disamakan sembarangan, search result bisa tidak defensible.

Rule:

> Synonym untuk search production harus diperlakukan seperti business rule, bukan daftar kata bebas.

---

## 18. Index-Time Synonym vs Search-Time Synonym

Synonym dapat diterapkan saat indexing atau saat search.

### 18.1 Index-Time Synonym

Document term diperluas saat index dibuat.

Kelebihan:

- query lebih sederhana;
- mungkin lebih cepat saat search;
- synonym term sudah ada di index.

Kekurangan:

- mengubah synonym butuh reindex;
- index bisa membesar;
- kesalahan synonym sulit diperbaiki cepat;
- explainability bisa lebih sulit karena expansion sudah tertanam.

### 18.2 Search-Time Synonym

Query term diperluas saat user mencari.

Kelebihan:

- bisa update synonym tanpa reindex dalam beberapa setup;
- lebih fleksibel;
- lebih mudah eksperimen;
- kesalahan bisa diperbaiki lebih cepat.

Kekurangan:

- query bisa lebih kompleks;
- expansion besar bisa menurunkan performance;
- phrase/synonym multi-token perlu hati-hati.

Rule umum:

```text
Untuk domain synonym yang sering berubah, search-time synonym biasanya lebih aman.
Untuk expansion stabil dan sangat umum, index-time bisa dipertimbangkan.
```

Namun keputusan akhir bergantung pada Elasticsearch version, fitur synonym set yang digunakan, operational model, dan kebutuhan reindex.

---

## 19. Language-Aware Analysis

Bahasa memengaruhi:

- tokenization;
- stopwords;
- stemming;
- morphology;
- synonym;
- phrase behavior.

Untuk corpus bahasa Inggris, analyzer `english` bisa membantu stemming dan stopword.

Untuk corpus bahasa Indonesia, Anda perlu lebih berhati-hati. Bahasa Indonesia memiliki prefix/suffix seperti:

```text
awas
mengawasi
pengawasan
diawasi
terawasi
```

Stemming bisa membantu, tetapi domain legal/regulatory sangat sensitif. Kata yang tampak satu akar bisa punya konteks hukum berbeda.

### 19.1 Mixed-Language Corpus

Banyak enterprise system punya dokumen campuran:

```text
"Market abuse investigation atas dugaan pelanggaran perdagangan efek"
```

Analyzer satu bahasa mungkin tidak optimal.

Strategi:

1. Gunakan baseline analyzer netral: lowercase + asciifolding.
2. Tambahkan field bahasa khusus jika language detection cukup reliable.
3. Gunakan multi-field:

```json
"content": {
  "type": "text",
  "analyzer": "neutral_text_analyzer",
  "fields": {
    "en": {
      "type": "text",
      "analyzer": "english"
    },
    "id": {
      "type": "text",
      "analyzer": "indonesian_custom_analyzer"
    }
  }
}
```

4. Query beberapa field dengan boost berbeda.

Jangan over-engineer multilingual search sebelum punya data query dan corpus nyata.

---

## 20. Domain-Specific Analyzer untuk Regulatory Search

Untuk regulatory/case management system, jenis field bisa dibagi:

| Field Type | Example | Analyzer Strategy |
|---|---|---|
| Identifier | `CASE-2024-001` | keyword normalizer + optional text subfield |
| Person name | `Budi Santoso` | lowercase, asciifolding, maybe name-specific handling |
| Organization name | `PT Bank Maju Jaya Tbk` | lowercase, asciifolding, abbreviation handling |
| Legal topic | `pelanggaran pasar modal` | text analyzer + controlled synonym |
| Case narrative | long description | standard/custom text, cautious stemming |
| Status | `UNDER_INVESTIGATION` | keyword |
| Regulation reference | `POJK 12/2021` | keyword + special partial field |
| Evidence filename | `laporan-transaksi-final.pdf` | path/filename analyzer |

Kesalahan umum adalah memakai satu analyzer untuk semua field.

Lebih baik:

```text
identifier_analyzer
name_analyzer
organization_analyzer
topic_analyzer
narrative_analyzer
autocomplete_analyzer
filename_analyzer
```

Tetapi jangan terlalu banyak juga. Setiap analyzer adalah schema surface yang harus diuji dan di-maintain.

---

## 21. Identifier Search: Exact, Partial, and Human Typing

Identifier adalah jebakan besar.

Contoh:

```text
CASE-2024-001/A
POJK-12-2021
INV_2025_000923
AML/CTR/2024/0091
```

User mungkin mencari:

```text
CASE-2024-001/A
case 2024 001
2024-001
001/A
AML CTR 0091
```

Satu field tidak cukup.

Strategi multi-field:

```json
"case_number": {
  "type": "keyword",
  "normalizer": "lowercase_keyword_normalizer",
  "fields": {
    "parts": {
      "type": "text",
      "analyzer": "identifier_parts_analyzer"
    },
    "autocomplete": {
      "type": "text",
      "analyzer": "identifier_autocomplete_index_analyzer",
      "search_analyzer": "identifier_autocomplete_search_analyzer"
    }
  }
}
```

Exact query pakai:

```json
{
  "term": {
    "case_number": "case-2024-001/a"
  }
}
```

Partial query pakai:

```json
{
  "match": {
    "case_number.parts": "2024 001"
  }
}
```

Autocomplete pakai:

```json
{
  "match": {
    "case_number.autocomplete": "case-2024"
  }
}
```

Dengan desain ini, exact lookup tetap presisi, tetapi user masih bisa mencari secara manusiawi.

---

## 22. Name Search

Name search terlihat mudah, tetapi sulit.

Masalah:

- variasi ejaan;
- middle name;
- title/honorific;
- initials;
- punctuation;
- accent;
- nama badan hukum vs nama orang;
- urutan nama;
- alias.

Contoh:

```text
Dr. Budi A. Santoso
Budi Santoso
Santoso, Budi
BUDI SANTOSO
Budi Ahmad Santoso
```

Analyzer bisa membantu:

- lowercase;
- asciifolding;
- punctuation normalization;
- stopword untuk title tertentu jika aman;
- edge n-gram untuk autocomplete;
- synonym/alias di field terpisah.

Tetapi name search sering membutuhkan query strategy, bukan analyzer saja.

Contoh:

- exact-ish match boosted;
- token match fallback;
- alias field;
- phonetic plugin jika benar-benar perlu;
- manual curation untuk high-risk identity search.

Untuk regulatory system, jangan terlalu fuzzy untuk identity search tanpa warning karena false positive/false negative bisa berdampak besar.

---

## 23. Autocomplete: Analyzer atau Fitur Terpisah?

Autocomplete bisa dibangun dengan beberapa pendekatan:

1. edge n-gram field;
2. `search_as_you_type` field;
3. completion suggester;
4. dedicated suggestion index;
5. prefix query pada keyword tertentu;
6. external suggestion service.

Part ini fokus analyzer, jadi edge n-gram paling relevan.

### 23.1 Edge N-Gram untuk Autocomplete

Index-time:

```text
management -> man, mana, manag, manage, ..., management
```

Search-time:

```text
mana -> mana
```

Query `mana` match token `mana` yang sudah ada di index.

### 23.2 Risiko Autocomplete dengan N-Gram

- index size membesar;
- memory/IO meningkat;
- token pendek noisy;
- ranking autocomplete bisa buruk;
- update synonym/stemming bisa rumit;
- query sering sangat tinggi volume karena user mengetik tiap karakter.

Autocomplete adalah workload berbeda dari search submit.

Design principle:

```text
Autocomplete should optimize for fast candidate suggestion.
Full search should optimize for relevance and completeness.
```

Jangan memaksakan satu query/analyzer untuk keduanya.

---

## 24. Analyzer for File Names and Paths

Enterprise search sering punya file/document attachment metadata.

Contoh filename:

```text
Laporan_Investigasi-Final_v2.pdf
```

User bisa mencari:

```text
laporan investigasi
final
v2
pdf
```

Standard analyzer mungkin cukup, tetapi path hierarchy butuh special handling.

Contoh path:

```text
/regulatory/enforcement/2024/cases/CASE-2024-001/evidence.pdf
```

Anda mungkin ingin searchable by:

- `regulatory`
- `enforcement`
- `2024`
- `CASE-2024-001`
- `evidence.pdf`

Untuk path-like data, pertimbangkan:

- path hierarchy tokenizer;
- keyword exact path;
- filename-only extracted field;
- extension keyword field;
- normalized text field.

Jangan hanya memasukkan full path ke standard text field dan berharap semuanya selesai.

---

## 25. Analyzer and Highlighting

Highlighting menggunakan offset token untuk mengetahui bagian teks yang harus ditandai.

Kalau analyzer mengubah token terlalu agresif, highlight bisa:

- tidak muncul;
- muncul di bagian yang terasa aneh;
- gagal untuk synonym;
- gagal untuk n-gram;
- terlalu banyak highlight noisy.

Contoh:

```text
Query: manag
Field indexed with edge n-gram.
```

Highlight bisa menandai bagian kata `management`, tetapi tergantung query dan highlighter.

Untuk highlight kualitas tinggi:

- gunakan analyzer yang tidak terlalu destruktif;
- hindari n-gram field sebagai source highlight utama;
- query autocomplete field untuk candidate, tetapi highlight field utama;
- simpan original text di `_source`;
- pahami offset behavior.

---

## 26. Analyzer and Scoring

Analyzer memengaruhi scoring karena scoring bergantung pada term.

Jika analyzer menghasilkan terlalu banyak token:

- term frequency berubah;
- document length berubah;
- IDF berubah;
- BM25 score berubah;
- field terlihat lebih panjang;
- common tokens bisa mendominasi.

Contoh n-gram field:

```text
management -> man, mana, manag, manage, managem, ...
```

Document length menjadi lebih besar. Scoring pada n-gram field tidak bisa diperlakukan sama seperti scoring full-text natural field.

Biasanya autocomplete field diberi boost berbeda atau digunakan hanya untuk candidate matching.

Contoh query multi-field:

```json
GET cases/_search
{
  "query": {
    "multi_match": {
      "query": "market abuse",
      "fields": [
        "title^3",
        "description",
        "title.autocomplete^0.5"
      ]
    }
  }
}
```

Boost harus diuji; jangan asal angka.

---

## 27. Analyzer Anti-Patterns

### 27.1 Satu Analyzer untuk Semua Field

Buruk:

```text
default_custom_analyzer_for_everything
```

Karena identifier, title, person name, body, status, dan organization name punya semantics berbeda.

### 27.2 N-Gram Semua Field

Buruk:

```text
Semua field text pakai ngram min_gram 1 max_gram 20
```

Dampak:

- index membesar;
- search noisy;
- scoring buruk;
- ingestion lambat;
- query sulit dituning;
- operational cost naik.

### 27.3 Synonym Tanpa Governance

Buruk:

```text
Tambahkan semua kata mirip ke synonym list.
```

Dampak:

- hasil search tidak presisi;
- relevance regression;
- sulit menjelaskan hasil;
- domain trust turun.

### 27.4 Stemming Bahasa Salah

Buruk:

```text
Corpus Indonesia pakai English analyzer karena terlihat lebih advanced.
```

Analyzer harus sesuai bahasa dan domain.

### 27.5 Mengubah Analyzer Tanpa Reindex

Untuk field yang sudah di-index, mengubah index-time analyzer biasanya tidak mengubah token yang sudah ada. Anda butuh index baru dan reindex.

Analyzer change harus diperlakukan seperti schema migration.

### 27.6 Tidak Pernah Menggunakan `_analyze`

Jika tim membuat analyzer tanpa melihat token output, mereka mendesain dalam gelap.

### 27.7 Analyzer Menjadi Tempat Business Logic Berlebihan

Contoh buruk:

- regex rumit untuk semua kode domain;
- synonym ribuan baris tanpa owner;
- char filter untuk memperbaiki data quality yang seharusnya dibereskan di ingestion.

Analyzer bukan pengganti data normalization pipeline.

---

## 28. Analyzer Design Process: Step-by-Step

Gunakan proses ini untuk desain production analyzer.

### Step 1 — Classify Fields

Kelompokkan field:

```text
identifier
name
organization
short title
long narrative
tag/category
status
filename/path
regulation reference
free-text comment
```

### Step 2 — Collect Real Examples

Ambil contoh nilai field nyata:

```text
CASE-2024-001/A
PT. Bank Maju Jaya Tbk.
Dugaan pelanggaran ketentuan transaksi efek
Anti Money Laundering Review
POJK Nomor 12 Tahun 2021
```

### Step 3 — Collect Real Queries

Ambil atau simulasikan query user:

```text
2024 001
bank maju
pelanggaran efek
AML review
pojk 12
anti pencucian uang
```

### Step 4 — Define Expected Match Behavior

Untuk tiap query:

```text
Query: "AML"
Should match:
- Anti Money Laundering Review
- AML Compliance Case
Should not overmatch:
- unrelated documents containing only "review"
```

### Step 5 — Design Baseline Analyzer

Mulai sederhana:

```text
standard tokenizer + lowercase + asciifolding
```

Tambahkan komponen hanya jika ada alasan.

### Step 6 — Test with `_analyze`

Lihat token index-time dan search-time.

### Step 7 — Build Golden Query Set

Buat test case relevance:

```text
query -> expected top results / expected included results / expected excluded results
```

### Step 8 — Load Test Index Impact

Ukur:

- index size;
- indexing throughput;
- query latency;
- heap impact;
- merge pressure;
- shard size.

### Step 9 — Version Analyzer

Namai analyzer dengan versi jika perlu:

```text
case_text_v1
case_text_v2
```

### Step 10 — Migrate via New Index

Analyzer change pada field existing biasanya butuh:

```text
new index -> reindex -> compare relevance -> alias swap -> rollback plan
```

---

## 29. Java Engineer Perspective

Sebagai Java engineer, analyzer design memengaruhi beberapa layer aplikasi.

### 29.1 Mapping as Code

Jangan membuat analyzer manual di Kibana tanpa source control.

Simpan mapping/settings sebagai artifact:

```text
src/main/resources/elasticsearch/cases-index-v1.json
```

Atau generate via Java infrastructure module, tetapi tetap readable dan reviewable.

### 29.2 Analyzer Regression Test

Buat test yang memanggil `_analyze` pada test container Elasticsearch.

Pseudo-test:

```java
@Test
void caseTextAnalyzerShouldNormalizeBasicText() {
    AnalyzeResponse response = client.indices().analyze(a -> a
        .index("regulatory_cases_test")
        .analyzer("case_text_analyzer")
        .text("Market Abuse Investigation")
    );

    List<String> tokens = response.tokens().stream()
        .map(AnalyzeToken::token)
        .toList();

    assertThat(tokens).containsExactly("market", "abuse", "investigation");
}
```

Test semacam ini mencegah analyzer berubah diam-diam.

### 29.3 Query Builder Harus Sadar Field Semantics

Jangan query semua field dengan pola yang sama.

Contoh buruk:

```java
for (String field : searchableFields) {
    addMatchQuery(field, userQuery);
}
```

Lebih baik:

```text
identifier-like query -> exact/parts/autocomplete identifier fields
name-like query       -> name fields
natural language      -> title/description fields
short prefix          -> autocomplete fields
```

Java search service perlu query planning ringan.

### 29.4 Analyzer Contract in API Documentation

Backend API tidak perlu mengekspos analyzer detail, tetapi harus jelas terhadap behavior:

- case-insensitive?
- accent-insensitive?
- typo-tolerant?
- prefix search?
- exact identifier supported?
- synonym supported?
- search language supported?

Ini penting untuk frontend, QA, product, dan audit.

---

## 30. Practical Analyzer Recipes

### 30.1 Basic Full-Text Analyzer

```json
"basic_text": {
  "type": "custom",
  "tokenizer": "standard",
  "filter": ["lowercase", "asciifolding"]
}
```

Cocok untuk baseline title/description.

### 30.2 Case-Insensitive Keyword Normalizer

```json
"lowercase_keyword": {
  "type": "custom",
  "filter": ["lowercase", "asciifolding"]
}
```

Cocok untuk keyword exact match yang toleran case/accent.

### 30.3 Autocomplete Analyzer

```json
"filter": {
  "autocomplete_filter": {
    "type": "edge_ngram",
    "min_gram": 3,
    "max_gram": 20
  }
},
"analyzer": {
  "autocomplete_index": {
    "type": "custom",
    "tokenizer": "standard",
    "filter": ["lowercase", "asciifolding", "autocomplete_filter"]
  },
  "autocomplete_search": {
    "type": "custom",
    "tokenizer": "standard",
    "filter": ["lowercase", "asciifolding"]
  }
}
```

### 30.4 Identifier Parts Analyzer

```json
"identifier_parts": {
  "type": "custom",
  "tokenizer": "pattern",
  "filter": ["lowercase", "asciifolding"],
  "pattern": "[-_/\\s]+"
}
```

Catatan: konfigurasi pattern tokenizer aktual dapat ditempatkan di bagian tokenizer settings, bukan langsung seperti pseudo ringkas di atas. Pastikan validasi dengan API Elasticsearch sesuai versi.

Versi lebih eksplisit:

```json
"tokenizer": {
  "identifier_parts_tokenizer": {
    "type": "pattern",
    "pattern": "[-_/\\s]+"
  }
},
"analyzer": {
  "identifier_parts": {
    "type": "custom",
    "tokenizer": "identifier_parts_tokenizer",
    "filter": ["lowercase", "asciifolding"]
  }
}
```

### 30.5 Domain Synonym Analyzer

```json
"filter": {
  "regulatory_synonyms": {
    "type": "synonym_graph",
    "synonyms": [
      "ojk, otoritas jasa keuangan",
      "aml, anti money laundering, anti pencucian uang",
      "pasar modal, bursa efek"
    ]
  }
},
"analyzer": {
  "regulatory_search": {
    "type": "custom",
    "tokenizer": "standard",
    "filter": ["lowercase", "asciifolding", "regulatory_synonyms"]
  }
}
```

Catatan: synonym configuration harus diuji sesuai versi Elasticsearch dan kebutuhan reload/update synonym. Untuk phrase synonym, `synonym_graph` sering lebih sesuai untuk search-time analyzer.

---

## 31. Example End-to-End: Why Query Does Not Match

### Problem

Document:

```json
{
  "case_number": "CASE-2024-001/A",
  "title": "Dugaan Pelanggaran Transaksi Efek"
}
```

User mencari:

```text
2024 001 efek
```

Tidak muncul.

### Investigation

1. Cek mapping:

```json
GET cases/_mapping
```

Ternyata `case_number` hanya keyword.

2. Query memakai `match` ke `case_number`:

```json
{
  "match": {
    "case_number": "2024 001"
  }
}
```

Pada keyword field, ini tidak bekerja seperti full-text partial search.

3. Cek analyzer title:

```json
GET cases/_analyze
{
  "field": "title",
  "text": "Dugaan Pelanggaran Transaksi Efek"
}
```

Token title ada:

```text
dugaan
pelanggaran
transaksi
efek
```

4. Masalahnya bukan title, tetapi case number partial.

### Fix

Tambahkan multi-field untuk case number parts di index versi berikutnya:

```json
"case_number": {
  "type": "keyword",
  "normalizer": "lowercase_keyword_normalizer",
  "fields": {
    "parts": {
      "type": "text",
      "analyzer": "identifier_parts"
    }
  }
}
```

Query:

```json
{
  "bool": {
    "should": [
      { "term": { "case_number": "case-2024-001/a" }},
      { "match": { "case_number.parts": "2024 001" }},
      { "match": { "title": "efek" }}
    ],
    "minimum_should_match": 1
  }
}
```

### Lesson

Search failure sering bukan karena “Elasticsearch tidak bisa”, tetapi karena field representation tidak sesuai dengan query behavior.

---

## 32. Operational Governance for Analyzer

Analyzer harus dikelola seperti production contract.

### 32.1 Analyzer Ownership

Tentukan owner:

- search platform team;
- domain product owner;
- data governance;
- backend service owner.

### 32.2 Analyzer Change Review

Setiap perubahan analyzer harus menjawab:

```text
Apa problem query yang ingin diperbaiki?
Field mana terdampak?
Apakah butuh reindex?
Apa expected relevance improvement?
Apa risiko precision drop?
Apa golden query test?
Apa rollback plan?
```

### 32.3 Synonym Change Workflow

Synonym change minimal perlu:

- ticket/change request;
- contoh query;
- expected result;
- reviewer domain;
- automated relevance test;
- deployment plan;
- monitoring zero-result/click behavior setelah release.

### 32.4 Analyzer Versioning

Contoh:

```text
regulatory_text_v1
regulatory_text_v2
```

Jangan mengubah analyzer lama secara diam-diam jika masih ada index yang bergantung padanya.

### 32.5 Documentation

Dokumentasikan:

- field -> analyzer;
- analyzer -> components;
- intended query behavior;
- known limitations;
- examples;
- migration notes.

---

## 33. Testing Matrix

Buat matrix seperti ini.

| Field | Input | Analyzer | Expected Tokens | Notes |
|---|---|---|---|---|
| `title` | `Market Abuse Investigation` | `case_text` | `market`, `abuse`, `investigation` | baseline English |
| `title` | `Dugaan Pelanggaran Efek` | `case_text` | `dugaan`, `pelanggaran`, `efek` | baseline Indonesian |
| `case_number` | `CASE-2024-001/A` | keyword normalizer | `case-2024-001/a` | exact lookup |
| `case_number.parts` | `CASE-2024-001/A` | `identifier_parts` | `case`, `2024`, `001`, `a` | partial lookup |
| `org_name` | `PT. Bank Maju Jaya, Tbk.` | `org_name` | depends | must define PT/Tbk behavior |
| `title.autocomplete` | `Management` | autocomplete index | `man`, `mana`, ... | check token explosion |

Testing expected tokens is not enough. Tambahkan golden query tests:

| Query | Expected Included | Expected Top | Expected Excluded |
|---|---|---|---|
| `AML` | Anti Money Laundering cases | exact AML case | unrelated review docs |
| `2024 001` | CASE-2024-001/A | CASE-2024-001/A | CASE-2024-999 |
| `pasar modal` | securities market cases | market abuse case | banking-only cases |
| `bank maju` | PT Bank Maju Jaya | exact org case | unrelated bank cases |

---

## 34. Analyzer Decision Framework

Gunakan framework berikut.

### 34.1 Is the field natural language?

Jika ya:

```text
text analyzer: standard + lowercase + asciifolding baseline
```

Pertimbangkan stemming/synonym jika ada evidence.

### 34.2 Is the field exact structured value?

Jika ya:

```text
keyword + normalizer
```

Tambahkan text subfield jika user butuh partial search.

### 34.3 Is the field used for autocomplete?

Jika ya:

```text
separate autocomplete subfield
edge_ngram or search_as_you_type/completion depending needs
```

Jangan mencampur scoring autocomplete dengan full search tanpa boost yang jelas.

### 34.4 Is the field domain vocabulary heavy?

Jika ya:

```text
controlled synonym/domain dictionary
search-time expansion preferred for flexibility
```

Tambahkan governance.

### 34.5 Is the field multilingual?

Jika ya:

```text
baseline neutral analyzer first
language-specific multi-field if needed
```

Jangan langsung stemming satu bahasa untuk semua.

### 34.6 Is phrase accuracy important?

Jika ya:

```text
analyzer position behavior matters
avoid careless stopword/synonym/stemming
consider shingle or phrase query design
```

---

## 35. What Top 1% Engineers Understand About Analysis

Engineer biasa tahu:

```text
text pakai analyzer, keyword tidak.
```

Engineer bagus tahu:

```text
standard analyzer, custom analyzer, lowercase, ngram, synonym.
```

Engineer top-tier tahu:

```text
Analyzer adalah contract antara corpus, query behavior, relevance, performance, UX, dan governance.
```

Mereka memahami bahwa:

- token adalah unit pencarian;
- analyzer mismatch adalah root cause banyak bug search;
- identifier dan natural language tidak boleh diperlakukan sama;
- n-gram memperbesar index dan mengubah scoring;
- synonym adalah business rule;
- stemming meningkatkan recall tetapi bisa merusak precision;
- phrase query bergantung pada position;
- highlighter bergantung pada offset;
- analyzer change butuh reindex strategy;
- analyzer harus diuji dengan real query/corpus;
- search quality tidak bisa diselesaikan dengan satu analyzer ajaib.

---

## 36. Practical Checklist

Sebelum production, jawab:

```text
[ ] Apakah setiap text field punya analyzer yang disengaja?
[ ] Apakah setiap keyword field yang butuh case-insensitive match punya normalizer?
[ ] Apakah identifier punya exact dan partial strategy?
[ ] Apakah autocomplete memakai field terpisah?
[ ] Apakah min_gram/max_gram diuji terhadap index size dan noise?
[ ] Apakah synonym punya owner dan test?
[ ] Apakah stemming diuji terhadap domain terms?
[ ] Apakah analyzer output diuji dengan _analyze?
[ ] Apakah query-time analyzer sesuai index-time analyzer?
[ ] Apakah analyzer change punya reindex plan?
[ ] Apakah golden query set mencakup analyzer edge cases?
[ ] Apakah field untuk highlight tidak terlalu destruktif?
[ ] Apakah analyzer/mapping tersimpan di source control?
[ ] Apakah Java tests memvalidasi token output dan search behavior?
```

---

## 37. Mini Lab

### Lab 1 — Compare Standard vs Keyword

```json
GET _analyze
{
  "analyzer": "standard",
  "text": "CASE-2024-001/A"
}
```

Bandingkan dengan keyword analyzer:

```json
GET _analyze
{
  "analyzer": "keyword",
  "text": "CASE-2024-001/A"
}
```

Pertanyaan:

```text
Mana yang cocok untuk exact lookup?
Mana yang cocok untuk partial search?
Apakah Anda perlu multi-field?
```

### Lab 2 — Autocomplete Edge N-Gram

Buat analyzer autocomplete dan test:

```json
GET my_index/_analyze
{
  "analyzer": "case_autocomplete_index_analyzer",
  "text": "management"
}
```

Ubah `min_gram` dari 1 ke 3. Bandingkan token.

Pertanyaan:

```text
Berapa banyak token tambahan?
Token mana yang terlalu noisy?
Apa dampaknya ke index size dan score?
```

### Lab 3 — Synonym Impact

Tambahkan synonym:

```text
aml, anti money laundering, anti pencucian uang
```

Test query:

```text
AML
anti pencucian uang
money laundering
```

Pertanyaan:

```text
Apakah semua query match expected docs?
Apakah ada overmatch?
Apakah phrase query masih bekerja?
```

### Lab 4 — Golden Query Test

Buat 10 query nyata untuk domain Anda.

Untuk tiap query, tentukan:

```text
expected top 3
expected included
expected excluded
```

Lalu ubah analyzer dan lihat regression.

---

## 38. Summary

Text analysis adalah salah satu fondasi terpenting Elasticsearch.

Key takeaways:

- Search engine mencari term, bukan string mentah.
- Analyzer mengubah raw text menjadi token stream.
- Analyzer terdiri dari character filter, tokenizer, dan token filter.
- Index-time analyzer menentukan term yang tersedia.
- Search-time analyzer menentukan term yang dicari.
- Analyzer mismatch dapat menyebabkan hasil search hilang atau noisy.
- `text` field memakai analyzer; `keyword` field bisa memakai normalizer.
- Multi-field adalah cara sehat untuk mendukung exact, full-text, autocomplete, dan tolerant search sekaligus.
- N-gram dan edge n-gram powerful tetapi mahal.
- Synonym adalah business rule dan butuh governance.
- Stemming dan stopword harus diuji terhadap bahasa dan domain.
- Analyzer change adalah schema/relevance migration, biasanya membutuhkan reindex.
- Debugging analyzer wajib memakai `_analyze`.
- Analyzer harus didesain dari query behavior dan corpus nyata.

Jika Part 006 menjawab “field ini jenisnya apa?”, maka Part 007 menjawab:

> “Bagaimana teks dalam field ini berubah menjadi bahasa pencarian yang benar?”

Pada part berikutnya, kita akan masuk ke **Query DSL Foundations**: bagaimana menyusun query Elasticsearch secara benar, memahami query context vs filter context, bool query, match/term/range/exists, dan bagaimana query composition memengaruhi scoring serta performance.

---

## References

- Elastic Docs — Text analysis: https://www.elastic.co/docs/manage-data/data-store/text-analysis
- Elastic Docs — Anatomy of an analyzer: https://www.elastic.co/docs/manage-data/data-store/text-analysis/anatomy-of-an-analyzer
- Elastic Docs — Create a custom analyzer: https://www.elastic.co/docs/manage-data/data-store/text-analysis/create-custom-analyzer
- Elastic Docs — Test an analyzer / Analyze API: https://www.elastic.co/docs/manage-data/data-store/text-analysis/test-an-analyzer
- Elastic Docs — Analyze API: https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-analyze
- Elastic Docs — Specify an analyzer: https://www.elastic.co/docs/manage-data/data-store/text-analysis/specify-an-analyzer
- Elastic Docs — Search analyzer mapping parameter: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/search-analyzer
- Elastic Docs — Analyzer reference: https://www.elastic.co/docs/reference/text-analysis/analyzer-reference
- Elastic Docs — Tokenizer reference: https://www.elastic.co/docs/reference/text-analysis/tokenizer-reference
- Elastic Docs — Token filter reference: https://www.elastic.co/docs/reference/text-analysis/token-filter-reference
- Elastic Docs — Standard analyzer: https://www.elastic.co/docs/reference/text-analysis/analysis-standard-analyzer
- Elastic Docs — Edge n-gram tokenizer: https://www.elastic.co/docs/reference/text-analysis/analysis-edgengram-tokenizer
- Elastic Docs — Edge n-gram token filter: https://www.elastic.co/docs/reference/text-analysis/analysis-edgengram-tokenfilter
- Elastic Docs — N-gram token filter: https://www.elastic.co/docs/reference/text-analysis/analysis-ngram-tokenfilter


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — Mapping Mastery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-008.md">Part 008 — Query DSL Foundations ➡️</a>
</div>
