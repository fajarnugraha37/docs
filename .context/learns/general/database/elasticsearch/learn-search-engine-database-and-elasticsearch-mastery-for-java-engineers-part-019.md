# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-019.md

# Part 019 — Multilingual and Domain-Specific Search

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: desain search untuk bahasa manusia, istilah domain, acronym, identifier, sinonim, dan vocabulary governance  
> Prasyarat: Part 000–018

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 018, kita sudah membangun fondasi besar:

1. search sebagai retrieval problem, bukan sekadar query database;
2. inverted index, term, posting list, scoring;
3. Lucene segment model;
4. Elasticsearch cluster, shard, replica;
5. document modeling;
6. mapping;
7. text analysis pipeline;
8. Query DSL;
9. full-text query pattern;
10. relevance engineering;
11. filtering/faceting;
12. pagination/sorting;
13. indexing pipeline;
14. consistency/freshness;
15. Java integration;
16. backend search API design;
17. highlighting, suggestions, autocomplete, dan spell correction.

Part ini membahas sesuatu yang sering terlihat kecil, tetapi menentukan kualitas search secara drastis: **bahasa dan istilah domain**.

Search engine tidak mencari “makna” secara ajaib. Untuk lexical search, Elasticsearch mencari token yang ada di index. Jadi pertanyaan pentingnya bukan hanya:

> “Query apa yang harus saya pakai?”

Tetapi:

> “Bagaimana teks domain saya dipecah, dinormalisasi, diperkaya, dan dicocokkan agar vocabulary user bertemu dengan vocabulary dokumen?”

Di sistem nyata, vocabulary mismatch adalah sumber utama search failure.

Contoh:

| User mengetik | Dokumen memakai istilah | Masalah |
|---|---|---|
| `KTP` | `Kartu Tanda Penduduk` | acronym mismatch |
| `izin usaha` | `perizinan berusaha` | morphological/domain variation |
| `fraud` | `penipuan` | multilingual mismatch |
| `NPWP 01.234.567.8-999.000` | `012345678999000` | identifier normalization |
| `pemilik manfaat` | `beneficial owner` | legal bilingual terminology |
| `case overdue` | `kasus melewati SLA` | mixed-language business term |
| `PT ABC` | `PT. A.B.C. Indonesia Tbk` | punctuation/legal entity variation |

Kalau analyzer, mapping, synonym, dan normalizer tidak dirancang, search akan terlihat “bodoh” walaupun cluster sehat, query cepat, dan API rapi.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, Anda diharapkan mampu:

1. memahami mengapa multilingual/domain-specific search adalah problem desain, bukan hanya konfigurasi analyzer;
2. membedakan language analysis, normalization, synonym, acronym expansion, identifier search, dan semantic fallback;
3. mendesain field strategy untuk exact, full-text, autocomplete, acronym, dan identifier search;
4. menangani Bahasa Indonesia, English, dan mixed-language search secara realistis;
5. mendesain sinonim secara aman tanpa merusak precision;
6. membedakan synonym expansion di index-time dan search-time;
7. membuat governance vocabulary domain untuk sistem enterprise/regulatory;
8. menghindari anti-pattern seperti synonym global liar, stemming agresif, wildcard sebagai solusi utama, dan analyzer campur-aduk;
9. mengimplementasikan contoh mapping/analyzer/query dari Java service;
10. membuat checklist review untuk multilingual/domain-specific search sebelum production.

---

## 2. Mental Model Utama: Search Gagal Saat Vocabulary Tidak Bertemu

Search lexical bekerja dengan mencocokkan token query terhadap token dokumen.

Secara sederhana:

```text
Document text  -> analyzer -> tokens -> inverted index
User query     -> analyzer -> tokens -> lookup/scoring
```

Search berhasil jika ada overlap token yang cukup bermakna.

Masalahnya, manusia jarang memakai vocabulary yang identik dengan dokumen.

### 2.1 Empat jenis vocabulary mismatch

#### 1. Surface-form mismatch

Bentuk teks berbeda, makna sama atau dekat.

Contoh:

```text
Dokumen:   Kartu Tanda Penduduk
Query:     ktp
```

```text
Dokumen:   non-compliance
Query:     non compliance
```

```text
Dokumen:   PT. Maju Jaya, Tbk.
Query:     maju jaya tbk
```

Solusi biasanya:

- lowercasing;
- punctuation normalization;
- acronym expansion;
- synonym;
- dedicated exact/normalized field.

#### 2. Morphological mismatch

Akar kata sama, bentuk kata berbeda.

Contoh Bahasa Indonesia:

```text
melaporkan
pelaporan
laporan
terlapor
pelapor
```

Contoh English:

```text
investigate
investigation
investigated
investigator
```

Solusi:

- stemming;
- lemmatization-like analyzer;
- synonym/domain dictionary;
- field berbeda untuk stemmed dan unstemmed search.

#### 3. Conceptual/domain mismatch

Kata berbeda, konsep domain sama atau berhubungan.

Contoh:

```text
pemilik manfaat <-> beneficial owner
APU PPT         <-> anti money laundering and counter terrorism financing
pengawasan      <-> supervision
penegakan       <-> enforcement
```

Solusi:

- synonym curated;
- ontology ringan;
- controlled vocabulary;
- semantic/vector search untuk candidate expansion;
- query reformulation.

#### 4. Intent mismatch

User mengetik sesuatu yang bukan istilah literal dokumen, tetapi intent-nya jelas.

Contoh:

```text
Query: kasus belum ditindaklanjuti lebih dari 30 hari
Document fields: status=OPEN, lastActionAt, slaDueAt, assignedUnit
```

Ini bukan analyzer problem. Ini search API/domain query problem.

Solusi:

- structured filters;
- natural language to filter translation jika perlu;
- saved search;
- business query templates;
- UI-guided filters.

---

## 3. Jangan Menyamakan Semua Masalah Dengan Synonym

Banyak tim melihat search gagal lalu langsung menambah synonym.

Ini sering salah.

Sebelum menambah synonym, klasifikasikan masalahnya:

| Masalah | Contoh | Solusi lebih tepat |
|---|---|---|
| Case difference | `KTP` vs `ktp` | lowercase normalizer/analyzer |
| Punctuation | `NPWP-123` vs `NPWP 123` | char filter / normalizer / identifier field |
| Accent | `José` vs `Jose` | asciifolding / ICU folding |
| Morphology | `investigation` vs `investigate` | language analyzer/stemmer |
| Acronym | `KTP` vs `Kartu Tanda Penduduk` | acronym synonym / dedicated acronym field |
| Domain equivalence | `AML` vs `APU PPT` | curated synonym/domain dictionary |
| Identifier exact | `CASE-2024-001` | keyword normalized field |
| User wants filter | `overdue case` | structured query/filter, not synonym |
| Concept similarity | `fraudulent reporting` vs `laporan palsu` | hybrid/semantic retrieval |

Synonym adalah alat kuat, tetapi mudah membuat precision rusak.

Contoh berbahaya:

```text
bank, financial institution
```

Di domain tertentu ini mungkin benar. Tetapi `bank` juga bisa berarti tepi sungai dalam English. Bahkan di domain finansial, tidak semua financial institution adalah bank.

Contoh lain:

```text
case, perkara, kasus
```

Dalam regulatory system, `case` bisa berarti entitas formal; `kasus` bisa bahasa umum; `perkara` bisa konteks legal. Menyatukan semua secara global bisa membuat hasil terlalu luas.

Aturan top-tier:

> Jangan menambahkan synonym sebelum Anda tahu apakah masalahnya normalization, morphology, acronym, domain vocabulary, filter intent, atau semantic mismatch.

---

## 4. Komponen Elasticsearch Yang Relevan

Part ini akan banyak memakai beberapa komponen text analysis Elasticsearch:

1. **char filter**  
   Mengubah karakter sebelum tokenization.

2. **tokenizer**  
   Memecah teks menjadi token.

3. **token filter**  
   Mengubah, menghapus, atau menambah token.

4. **analyzer**  
   Kombinasi char filter + tokenizer + token filter untuk `text` field.

5. **normalizer**  
   Versi lebih terbatas untuk `keyword` field agar exact value bisa dinormalisasi.

6. **multi-fields**  
   Field yang sama di-index dengan beberapa cara.

7. **search_analyzer**  
   Analyzer khusus saat query, berbeda dari analyzer saat indexing.

8. **synonym/synonym_graph token filter**  
   Untuk menambahkan token sinonim, terutama multi-word synonyms.

9. **language analyzer**  
   Analyzer built-in untuk bahasa tertentu.

10. **ICU analysis plugin**  
    Untuk Unicode normalization, folding, collation, dan language/script handling lebih luas.

Elasticsearch menyediakan language analyzers untuk banyak bahasa, dan `synonym_graph` berguna untuk multi-word synonyms karena membuat graph token stream saat analysis. Token filter secara umum dapat memodifikasi, menghapus, atau menambahkan token seperti lowercasing, stopword removal, dan synonyms. ICU analysis plugin menambahkan dukungan Unicode yang lebih luas seperti Unicode normalization, Unicode-aware case folding, collation, dan transliteration.

---

## 5. Bahasa Manusia Itu Tidak Rapi

Sebelum mendesain analyzer, Anda harus menerima kenyataan: data teks enterprise tidak bersih.

Contoh satu konsep bisa muncul sebagai:

```text
Anti Money Laundering
anti-money laundering
AML
A.M.L.
APU PPT
APU-PPT
anti pencucian uang
pencegahan pencucian uang
program APU dan PPT
```

Nama orang:

```text
Muhammad Rizki Pratama
M. Rizki Pratama
Mohamad Rizky Pratama
M Rizki
Rizki P.
```

Nama perusahaan:

```text
PT Bank Mandiri Tbk
PT. Bank Mandiri (Persero) Tbk.
Bank Mandiri
MANDIRI
PT BMRI
```

Identifier:

```text
CASE-2026-0000123
case 2026 123
2026/123
0000123
```

Alamat:

```text
Jl. Jenderal Sudirman Kav. 52-53
Jalan Jend. Sudirman Kavling 52/53
Sudirman 52
```

Search engine tidak tahu semua ini kecuali Anda memberi struktur melalui analyzer, field, synonym, normalizer, dan query strategy.

---

## 6. Prinsip Desain Multilingual/Domain-Specific Search

### Prinsip 1 — Pisahkan exact, lexical, domain-expanded, dan semantic behavior

Jangan pakai satu field untuk semua.

Contoh field strategy:

```json
{
  "title": {
    "type": "text",
    "analyzer": "id_en_mixed_text",
    "fields": {
      "raw": {
        "type": "keyword",
        "normalizer": "lowercase_ascii_normalizer"
      },
      "stemmed": {
        "type": "text",
        "analyzer": "id_en_stemmed_text"
      },
      "syn": {
        "type": "text",
        "analyzer": "id_en_domain_synonym_search"
      },
      "autocomplete": {
        "type": "search_as_you_type"
      }
    }
  }
}
```

Tujuannya:

- `title`: normal full-text;
- `title.raw`: exact/sort/filter;
- `title.stemmed`: broader recall via stemming;
- `title.syn`: domain-expanded query;
- `title.autocomplete`: typeahead/search-as-you-type.

Kemudian query bisa memberi boost berbeda:

```text
Exact phrase match       -> boost tinggi
Normal full-text match   -> boost normal
Stemmed match            -> boost sedang/rendah
Synonym-expanded match   -> boost hati-hati
Semantic match           -> rerank/hybrid, bukan menggantikan semuanya
```

### Prinsip 2 — Search-time expansion lebih aman daripada index-time expansion untuk synonym yang berubah

Jika synonym berubah sering, search-time synonym lebih fleksibel.

Index-time synonym membuat token synonym masuk ke index. Kalau rule berubah, Anda perlu reindex agar perubahan berlaku penuh.

Search-time synonym membuat query diperluas saat search. Ini lebih mudah diubah, diuji, dan rollback.

Namun search-time synonym juga bisa membuat query lebih kompleks dan ranking lebih sulit jika rule terlalu agresif.

### Prinsip 3 — Jangan mencampur semua bahasa dalam satu analyzer jika kualitas penting

Untuk data multilingual, satu analyzer universal sering menjadi kompromi buruk.

Alternatif desain:

1. **field per language**

```json
{
  "title_id": "Laporan dugaan pelanggaran",
  "title_en": "Report of alleged violation"
}
```

2. **multi-field per language**

```json
{
  "title": {
    "type": "text",
    "fields": {
      "id": { "type": "text", "analyzer": "indonesian" },
      "en": { "type": "text", "analyzer": "english" },
      "raw": { "type": "keyword" }
    }
  }
}
```

3. **language detection at ingestion**

```json
{
  "language": "id",
  "title": "Laporan dugaan pelanggaran"
}
```

Lalu query memilih field/analyzer sesuai bahasa query atau target audience.

### Prinsip 4 — Identifier search harus deterministic

Identifier tidak boleh diperlakukan seperti natural language biasa.

Contoh identifier:

- case number;
- ticket number;
- permit number;
- license number;
- invoice number;
- tax ID;
- national ID;
- legal entity code;
- account number;
- docket number.

Identifier search harus:

- tahan variasi punctuation;
- tahan uppercase/lowercase;
- biasanya exact atau prefix;
- tidak boleh terkena stemming;
- tidak boleh synonym sembarangan;
- harus bisa highlight/display bentuk asli.

### Prinsip 5 — Domain vocabulary adalah aset, bukan config sampingan

Synonym, acronym, stopword domain, legal term, abbreviation, dan preferred term harus dikelola seperti artefak produk.

Minimal governance:

- owner;
- review process;
- test queries;
- rollout strategy;
- rollback strategy;
- versioning;
- change log;
- evaluation before/after;
- auditability.

Untuk regulatory/case-management system, vocabulary bisa menentukan apakah investigator menemukan dokumen penting atau tidak.

---

## 7. Bahasa Indonesia Search: Hal Yang Perlu Dipahami

Bahasa Indonesia punya karakteristik khusus:

1. banyak afiks;
2. reduplikasi;
3. istilah hukum/regulasi yang formal;
4. campuran English dalam dokumen teknis;
5. acronym sangat banyak;
6. istilah lembaga dan peraturan yang panjang;
7. variasi kata baku/tidak baku;
8. nama orang/perusahaan yang tidak selalu mengikuti pola konsisten.

### 7.1 Afiks dan variasi morfologi

Contoh root `lapor`:

```text
lapor
laporan
melapor
melaporkan
pelapor
terlapor
pelaporan
dilaporkan
```

Contoh root `awas` dalam domain pengawasan:

```text
pengawasan
mengawasi
diawasi
pengawas
terawasi
```

Contoh root `langgar`:

```text
pelanggaran
melanggar
dilanggar
terlanggar
```

Stemming bisa membantu recall, tetapi bisa berbahaya jika terlalu agresif.

Contoh risiko:

```text
pengurus
pengurusan
mengurus
```

Dalam konteks perusahaan, `pengurus` bisa berarti orang/role. `pengurusan` bisa berarti proses administrasi. Jika keduanya terlalu disamakan, precision bisa turun.

### 7.2 Reduplikasi

Contoh:

```text
peraturan-peraturan
kasus-kasus
pihak-pihak
bukti-bukti
```

Analyzer sederhana mungkin memecah menjadi token yang tidak ideal. Domain query harus diuji.

### 7.3 Istilah formal vs istilah user

Dokumen regulatory sering memakai istilah formal:

```text
Penyelenggara Jasa Keuangan
Pihak Pelapor
Pemilik Manfaat
Pengendali
Direksi
Dewan Komisaris
Kegiatan Usaha
Perizinan Berusaha
Sanksi Administratif
```

User bisa mencari dengan istilah informal:

```text
bank
pelapor
beneficial owner
owner sebenarnya
izin usaha
hukuman administratif
```

Di sinilah synonym/domain dictionary sangat penting.

### 7.4 Bahasa campuran

Dokumen teknis/regulatory sering mencampur:

```text
risk assessment
fit and proper test
beneficial owner
customer due diligence
enhanced due diligence
suspicious transaction report
regulatory sandbox
```

Jika hanya memakai Indonesian analyzer, English terms mungkin tidak optimal. Jika hanya memakai English analyzer, Bahasa Indonesia tidak optimal.

Praktisnya, untuk sistem enterprise Indonesia-English:

- sediakan field mixed analyzer untuk general search;
- sediakan field `.id` dengan Indonesian analyzer;
- sediakan field `.en` dengan English analyzer;
- sediakan synonym bilingual curated;
- sediakan exact identifier/name fields;
- ukur query nyata sebelum terlalu kompleks.

---

## 8. Analyzer Strategy Untuk Mixed Indonesian-English

Tidak ada satu strategi sempurna. Pilihan tergantung data dan query.

### Strategy A — Simple mixed analyzer

Cocok untuk MVP atau corpus campuran ringan.

```json
PUT case_search_v1
{
  "settings": {
    "analysis": {
      "filter": {
        "id_en_stop": {
          "type": "stop",
          "stopwords": [
            "dan",
            "atau",
            "yang",
            "di",
            "ke",
            "dari",
            "the",
            "and",
            "or",
            "of"
          ]
        }
      },
      "analyzer": {
        "id_en_basic": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": [
            "lowercase",
            "asciifolding",
            "id_en_stop"
          ]
        }
      }
    }
  }
}
```

Kelebihan:

- sederhana;
- predictable;
- risiko over-stemming rendah.

Kekurangan:

- morphology tidak banyak dibantu;
- recall untuk variasi kata bisa kurang;
- domain synonym belum ada.

### Strategy B — Multi-field language-specific

Cocok untuk data bilingual serius.

```json
PUT case_search_v1
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
      "title": {
        "type": "text",
        "analyzer": "standard",
        "fields": {
          "id": {
            "type": "text",
            "analyzer": "indonesian"
          },
          "en": {
            "type": "text",
            "analyzer": "english"
          },
          "raw": {
            "type": "keyword",
            "normalizer": "lowercase_ascii_normalizer"
          }
        }
      }
    }
  }
}
```

Query:

```json
GET case_search_v1/_search
{
  "query": {
    "multi_match": {
      "query": "pelanggaran beneficial owner",
      "fields": [
        "title^3",
        "title.id^2",
        "title.en^2",
        "title.raw^5"
      ],
      "type": "best_fields"
    }
  }
}
```

Kelebihan:

- lebih baik untuk Bahasa Indonesia dan English;
- bisa mengatur boost;
- bisa mengevaluasi contribution per field.

Kekurangan:

- index lebih besar;
- query lebih kompleks;
- explanation lebih panjang;
- perlu test relevance.

### Strategy C — Separate fields by language at ingestion

Cocok jika dokumen punya field language jelas.

```json
{
  "title_id": "Laporan dugaan pelanggaran prinsip kehati-hatian",
  "title_en": "Report of alleged prudential principle violation",
  "language": "id"
}
```

Mapping:

```json
{
  "mappings": {
    "properties": {
      "title_id": {
        "type": "text",
        "analyzer": "indonesian"
      },
      "title_en": {
        "type": "text",
        "analyzer": "english"
      },
      "language": {
        "type": "keyword"
      }
    }
  }
}
```

Kelebihan:

- paling bersih;
- language behavior eksplisit;
- bisa query sesuai user locale.

Kekurangan:

- butuh ingestion lebih pintar;
- tidak semua data punya terjemahan;
- lebih banyak field.

---

## 9. Synonym: Salah Satu Senjata Paling Kuat dan Paling Berbahaya

Synonym bisa menaikkan recall secara drastis.

Contoh:

```text
ktp, kartu tanda penduduk
npwp, nomor pokok wajib pajak
beneficial owner, pemilik manfaat
aml, anti money laundering, anti pencucian uang
cdd, customer due diligence
edd, enhanced due diligence
```

Tetapi synonym juga bisa menghancurkan precision.

### 9.1 Equivalent synonym vs explicit mapping

Ada dua bentuk umum.

#### Equivalent synonym

```text
ktp, kartu tanda penduduk
```

Artinya dua arah:

```text
ktp -> kartu tanda penduduk
kartu tanda penduduk -> ktp
```

Cocok jika benar-benar equivalent.

#### Explicit mapping

```text
ktp => kartu tanda penduduk
```

Artinya satu arah.

Cocok jika query shorthand ingin diperluas ke bentuk formal, tetapi bentuk formal tidak selalu ingin dikembalikan ke shorthand.

Contoh domain:

```text
bo => beneficial owner, pemilik manfaat
```

Apakah semua kemunculan `bo` harus dicari sebagai beneficial owner? Belum tentu. `BO` bisa berarti back office. Jadi explicit mapping tetap harus diuji.

### 9.2 Multi-word synonym butuh perhatian khusus

Contoh:

```text
pemilik manfaat, beneficial owner
fit and proper test, penilaian kemampuan dan kepatutan
customer due diligence, uji tuntas nasabah
```

Multi-word synonym lebih aman memakai `synonym_graph` untuk search-time analyzer karena dapat menangani phrase/multi-token synonym secara lebih benar.

### 9.3 Search-time synonym example

```json
PUT case_search_v1
{
  "settings": {
    "analysis": {
      "filter": {
        "domain_synonyms": {
          "type": "synonym_graph",
          "synonyms": [
            "ktp, kartu tanda penduduk",
            "npwp, nomor pokok wajib pajak",
            "beneficial owner, pemilik manfaat",
            "aml, anti money laundering, anti pencucian uang",
            "cdd, customer due diligence, uji tuntas nasabah"
          ]
        }
      },
      "analyzer": {
        "domain_index_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding"]
        },
        "domain_search_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding", "domain_synonyms"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "content": {
        "type": "text",
        "analyzer": "domain_index_analyzer",
        "search_analyzer": "domain_search_analyzer"
      }
    }
  }
}
```

Mental model:

```text
Indexing document:
  "pemilik manfaat" -> pemilik, manfaat

Searching query:
  "beneficial owner" -> beneficial, owner, pemilik, manfaat
```

Jadi reindex tidak selalu diperlukan ketika hanya search analyzer berubah, tetapi analyzer configuration dan synonym management tetap perlu dilakukan dengan benar.

### 9.4 Synonym should not be global by default

Synonym harus punya scope.

Contoh:

```text
BO
```

Bisa berarti:

- beneficial owner;
- back office;
- branch office;
- body odor dalam corpus lain;
- business owner;
- boleto dalam konteks lain.

Jadi synonym `bo => beneficial owner` aman hanya jika:

- field-nya regulatory ownership;
- query berada di modul beneficial ownership;
- user memilih facet/topic tertentu;
- ada evidence query domain.

Strategi:

```text
General search field     -> synonym konservatif
Ownership search field   -> synonym BO -> beneficial owner
Operational field        -> synonym BO -> back office
```

### 9.5 Jangan synonym-kan kata terlalu umum

Berbahaya:

```text
fraud, risk, violation, issue, case, problem
```

Kata-kata ini terlalu luas. Sinonim global akan memperluas hampir semua query dan menurunkan precision.

Lebih aman:

```text
suspicious transaction report, str, laporan transaksi mencurigakan
customer due diligence, cdd, uji tuntas nasabah
beneficial owner, bo, pemilik manfaat
```

Rule of thumb:

> Synonym terbaik biasanya domain-specific, relatif jarang, dan punya equivalence yang jelas.

---

## 10. Acronym and Abbreviation Search

Acronym sangat umum di sistem enterprise.

Contoh Indonesia/regulatory:

```text
KTP  -> Kartu Tanda Penduduk
NPWP -> Nomor Pokok Wajib Pajak
NIB  -> Nomor Induk Berusaha
OSS  -> Online Single Submission
APU  -> Anti Pencucian Uang
PPT  -> Pencegahan Pendanaan Terorisme
CDD  -> Customer Due Diligence
EDD  -> Enhanced Due Diligence
STR  -> Suspicious Transaction Report
PEP  -> Politically Exposed Person
SLA  -> Service Level Agreement
```

### 10.1 Acronym problem bukan hanya synonym

Acronym punya beberapa masalah:

1. acronym bisa ambiguous;
2. acronym bisa muncul dengan punctuation: `A.P.U`, `A/P/U`, `APU-PPT`;
3. acronym bisa punya bahasa campuran;
4. user sering mencari acronym, dokumen memakai full phrase;
5. dokumen sering memakai acronym, user mencari full phrase;
6. acronym bisa overlap dengan nama perusahaan atau kode.

### 10.2 Field strategy untuk acronym

Daripada hanya synonym global, pertimbangkan field khusus:

```json
{
  "title": "Laporan APU PPT untuk Pihak Pelapor",
  "title_expanded": "Laporan anti pencucian uang pencegahan pendanaan terorisme untuk pihak pelapor",
  "acronyms": ["APU", "PPT"],
  "domain_terms": ["anti pencucian uang", "pencegahan pendanaan terorisme"]
}
```

Mapping:

```json
{
  "properties": {
    "title": {
      "type": "text",
      "fields": {
        "raw": { "type": "keyword" }
      }
    },
    "title_expanded": {
      "type": "text",
      "analyzer": "domain_index_analyzer"
    },
    "acronyms": {
      "type": "keyword",
      "normalizer": "lowercase_ascii_normalizer"
    },
    "domain_terms": {
      "type": "keyword",
      "normalizer": "lowercase_ascii_normalizer"
    }
  }
}
```

Query:

```json
GET case_search_v1/_search
{
  "query": {
    "bool": {
      "should": [
        {
          "multi_match": {
            "query": "APU PPT",
            "fields": ["title^3", "title_expanded^2"]
          }
        },
        {
          "terms": {
            "acronyms": ["apu", "ppt"],
            "boost": 5
          }
        }
      ],
      "minimum_should_match": 1
    }
  }
}
```

Ini memberi kontrol lebih baik daripada membiarkan synonym global meledak.

---

## 11. Identifier Search: Desain Terpisah Dari Full-Text

Identifier adalah kelas search khusus.

Contoh:

```text
CASE-2026-0000123
REG/2025/IX/0042
NPWP 01.234.567.8-999.000
NIK 3173010101900001
LIC-ABC-2024-09
DOC_99881_REV_2
```

Identifier user bisa mengetik:

```text
CASE20260000123
case 2026 123
2026-123
0000123
01.234.567.8-999.000
012345678999000
```

Kalau identifier masuk `text` biasa, tokenization bisa tidak sesuai.

### 11.1 Simpan original dan normalized form

```json
{
  "case_number": "CASE-2026-0000123",
  "case_number_normalized": "case20260000123",
  "case_number_parts": ["case", "2026", "0000123", "123"]
}
```

Mapping:

```json
{
  "properties": {
    "case_number": {
      "type": "keyword",
      "normalizer": "lowercase_ascii_normalizer"
    },
    "case_number_normalized": {
      "type": "keyword"
    },
    "case_number_parts": {
      "type": "keyword",
      "normalizer": "lowercase_ascii_normalizer"
    }
  }
}
```

Application-side normalization:

```java
public final class IdentifierNormalizer {
    private IdentifierNormalizer() {}

    public static String normalizeIdentifier(String value) {
        if (value == null) return null;
        return value
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]", "");
    }
}
```

Search pattern:

```json
GET case_search_v1/_search
{
  "query": {
    "bool": {
      "should": [
        {
          "term": {
            "case_number_normalized": {
              "value": "case20260000123",
              "boost": 20
            }
          }
        },
        {
          "prefix": {
            "case_number_normalized": {
              "value": "case2026",
              "boost": 8
            }
          }
        },
        {
          "terms": {
            "case_number_parts": ["2026", "123"],
            "boost": 3
          }
        }
      ],
      "minimum_should_match": 1
    }
  }
}
```

### 11.2 Why not wildcard everything?

Anti-pattern:

```json
{
  "wildcard": {
    "case_number": "*123*"
  }
}
```

Masalah:

- mahal untuk cardinality besar;
- precision buruk;
- mudah menjadi default malas;
- sulit diskalakan;
- bisa dieksploitasi user.

Lebih baik:

- normalized keyword;
- prefix search;
- n-gram field khusus jika memang substring search wajib;
- enforce minimum length;
- rate limit;
- monitor expensive query.

### 11.3 Identifier ranking rule

Untuk search campuran, identifier exact match harus mengalahkan full-text match.

Contoh query user:

```text
2026-123
```

Jika ada case number exact, hasil itu harus top. Jangan biarkan BM25 terhadap konten panjang mengalahkan identifier exact.

Ranking strategy:

```text
Exact identifier normalized match     -> boost 100
Exact raw keyword match               -> boost 80
Prefix identifier match               -> boost 30
Identifier parts match                -> boost 10
Full-text content match               -> boost normal
```

---

## 12. Names: Person, Organization, and Legal Entity Search

Nama bukan hanya teks biasa.

### 12.1 Person name challenges

```text
Muhammad / Mohammad / Mohamad / Muhamad
Rizki / Rizky / Riski
Abdul Rahman / A. Rahman
Siti Nurhaliza / Siti N.
```

Masalah:

- variasi spelling;
- initials;
- order berbeda;
- honorific/title;
- common names;
- transliteration;
- typo;
- incomplete query.

Strategi:

- `person_name.full` text field;
- `person_name.raw` keyword normalized;
- `person_name.parts` keyword array;
- optional phonetic plugin jika benar-benar dibutuhkan;
- fuzzy search hati-hati;
- exact/phrase boost tinggi;
- disambiguasi dengan metadata seperti DOB, organization, role, location.

Contoh document:

```json
{
  "person_name": "Muhammad Rizki Pratama",
  "person_name_parts": ["muhammad", "rizki", "pratama"],
  "person_name_initials": "mrp"
}
```

### 12.2 Organization/legal entity challenges

```text
PT Maju Jaya Abadi Tbk
PT. Maju Jaya Abadi, Tbk.
Maju Jaya
MJA
Maju Jaya Group
Maju Jaya Abadi Perseroan Terbatas
```

Legal suffix bisa mengganggu search:

```text
PT
CV
Tbk
Persero
Ltd
Limited
LLC
Inc
Corp
```

Tapi suffix tidak selalu boleh dibuang karena bisa membantu disambiguasi.

Strategi field:

```json
{
  "organization_name": "PT. Maju Jaya Abadi Tbk.",
  "organization_name_normalized": "maju jaya abadi",
  "organization_legal_suffixes": ["pt", "tbk"],
  "organization_aliases": ["MJA", "Maju Jaya"]
}
```

Query:

- exact raw match high boost;
- normalized name match high boost;
- alias match high boost;
- full-text match medium;
- fuzzy only for longer query;
- legal suffix filter if user explicitly includes it.

---

## 13. Domain Dictionary: Dari Daftar Sinonim Menjadi Controlled Vocabulary

Untuk sistem besar, jangan biarkan sinonim tersebar di file config tanpa struktur.

Buat domain dictionary.

Contoh struktur:

```yaml
terms:
  - canonical: "beneficial owner"
    language: "en"
    category: "ownership"
    aliases:
      - "pemilik manfaat"
      - "BO"
    risk_level: "medium"
    notes: "BO ambiguous with back office; apply only in ownership/regulatory context."
    enabled_in:
      - "ownership_search"
      - "case_search_regulatory"
    disabled_in:
      - "operations_search"

  - canonical: "customer due diligence"
    language: "en"
    category: "aml"
    aliases:
      - "CDD"
      - "uji tuntas nasabah"
      - "due diligence nasabah"
    enabled_in:
      - "aml_search"
      - "case_search_regulatory"
```

Dari dictionary ini Anda bisa generate:

- synonym rules;
- autocomplete suggestions;
- glossary UI;
- query expansion rules;
- test cases;
- documentation;
- validation report.

### 13.1 Metadata penting untuk dictionary

| Metadata | Tujuan |
|---|---|
| canonical term | istilah utama |
| aliases | variasi/synonym/acronym |
| language | id/en/other |
| category | ownership, AML, licensing, enforcement |
| scope | field/modul tempat berlaku |
| ambiguity level | low/medium/high |
| owner | siapa yang menyetujui |
| effective date | kapan rule berlaku |
| retired date | kapan tidak berlaku |
| test queries | query untuk validasi |
| expected documents | hasil yang harus muncul |
| precision risk | potensi false positive |

### 13.2 Workflow governance

```text
New search failure found
        |
        v
Classify failure:
normalization / stemming / synonym / acronym / filter / semantic
        |
        v
Propose dictionary change
        |
        v
Run offline relevance test
        |
        v
Review by domain owner + search owner
        |
        v
Deploy to staging
        |
        v
A/B or sampled production validation
        |
        v
Deploy gradually
        |
        v
Monitor zero-result, CTR, false positives, complaints
```

Top-tier team memperlakukan search vocabulary seperti product behavior, bukan config teknis belaka.

---

## 14. Stopwords: Hati-Hati Dengan Kata Yang Terlihat Tidak Penting

Stopwords menghapus kata umum.

Contoh English:

```text
the, and, of, to
```

Contoh Indonesia:

```text
dan, yang, di, ke, dari, untuk
```

Tetapi di domain tertentu, kata yang umum bisa penting.

Contoh:

```text
Fit and Proper Test
```

Jika `and` dihapus, mungkin masih oke. Tapi phrase matching bisa berubah.

Contoh:

```text
Surat Keputusan
```

Jika `ke` dianggap stopword dan dihapus secara buta, kadang tidak masalah; tetapi untuk kode/nama tertentu bisa memengaruhi exact phrase.

Contoh:

```text
Bank of America
```

Menghapus `of` bisa membuat phrase behavior berubah.

Rule:

> Jangan memakai stopword removal agresif sebelum Anda punya query logs dan relevance tests.

Sering kali untuk enterprise search modern, lowercasing + folding + domain synonym lebih aman daripada stopword agresif.

---

## 15. Stemming: Recall Naik, Precision Bisa Turun

Stemming mengurangi kata ke bentuk dasar/stem.

### 15.1 Kapan stemming membantu

User mencari:

```text
investigation
```

Dokumen punya:

```text
investigate
investigated
investigating
```

Stemming bisa membantu.

User mencari:

```text
pelanggaran
```

Dokumen punya:

```text
melanggar
dilanggar
```

Stemming bisa membantu.

### 15.2 Kapan stemming berbahaya

Stemming bisa menyatukan kata yang berbeda secara domain.

Contoh:

```text
pelapor
terlapor
laporan
pelaporan
```

Mereka terkait root `lapor`, tetapi bukan hal yang sama:

- `pelapor`: pihak yang melapor;
- `terlapor`: pihak yang dilaporkan;
- `laporan`: dokumen/peristiwa laporan;
- `pelaporan`: proses.

Jika semua disatukan terlalu kuat, search `terlapor` bisa dipenuhi `pelapor`, yang salah secara legal/proses.

### 15.3 Solusi: multi-field dengan boost berbeda

```json
{
  "description": {
    "type": "text",
    "analyzer": "id_en_basic",
    "fields": {
      "id_stemmed": {
        "type": "text",
        "analyzer": "indonesian"
      }
    }
  }
}
```

Query:

```json
GET case_search_v1/_search
{
  "query": {
    "multi_match": {
      "query": "terlapor",
      "fields": [
        "description^3",
        "description.id_stemmed^1"
      ]
    }
  }
}
```

Artinya exact/non-stemmed match lebih dihargai; stemmed match hanya membantu recall.

---

## 16. Normalization: Banyak Masalah Bisa Diselesaikan Sebelum Synonym

Normalization bertujuan membuat variasi permukaan menjadi bentuk konsisten.

### 16.1 Common normalization

| Input | Normalized |
|---|---|
| `KTP` | `ktp` |
| `PT. ABC, Tbk.` | `pt abc tbk` atau `abc` tergantung use case |
| `José` | `jose` |
| `NPWP 01.234.567.8-999.000` | `npwp012345678999000` atau `012345678999000` |
| `anti-money laundering` | `anti money laundering` |
| `A.P.U.-P.P.T.` | `apu ppt` |

### 16.2 Normalization di Elasticsearch vs application

Elasticsearch analyzer cocok untuk natural language field.

Application-side normalization cocok untuk identifier dan domain-specific canonicalization.

Contoh:

```java
public record SearchableCaseDocument(
        String caseId,
        String caseNumber,
        String caseNumberNormalized,
        String title,
        List<String> acronymTerms,
        List<String> domainTerms
) {}
```

Kenapa application-side?

- mudah dites unit;
- deterministik;
- bisa dipakai juga di database/source-of-truth;
- tidak tersembunyi dalam analyzer;
- cocok untuk audit.

### 16.3 Jangan sembunyikan semua logic di analyzer

Analyzer sulit dipahami oleh product/domain stakeholder.

Untuk domain-critical normalization, simpan field eksplisit.

Contoh:

```json
{
  "original_permit_number": "NIB-8120001234567",
  "permit_number_normalized": "nib8120001234567",
  "permit_number_digits": "8120001234567"
}
```

Ini lebih mudah diaudit daripada berharap analyzer internal selalu benar.

---

## 17. Query Classification: Natural Text atau Identifier?

Search API yang matang biasanya mengklasifikasikan query sebelum membangun Elasticsearch query.

Contoh logic:

```text
Input: "CASE-2026-000123"
Class: identifier-like
Strategy: exact/prefix identifier fields first, content lower priority

Input: "beneficial owner"
Class: domain phrase
Strategy: phrase + synonym + domain field

Input: "pelanggaran prinsip kehati-hatian"
Class: natural language domain query
Strategy: multi_match title/content/domain terms

Input: "3173010101900001"
Class: numeric identifier-like
Strategy: NIK/tax/account fields, with access control
```

Java sketch:

```java
public enum QueryKind {
    EMPTY,
    IDENTIFIER_LIKE,
    ACRONYM_LIKE,
    PERSON_NAME_LIKE,
    NATURAL_LANGUAGE,
    MIXED
}

public final class QueryClassifier {
    private static final Pattern IDENTIFIER_PATTERN = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9_./\\- ]{3,}$");
    private static final Pattern HAS_DIGIT = Pattern.compile(".*\\d.*");
    private static final Pattern ACRONYM_PATTERN = Pattern.compile("^[A-Z]{2,8}([-/ ]?[A-Z]{2,8})*$");

    public QueryKind classify(String raw) {
        if (raw == null || raw.isBlank()) return QueryKind.EMPTY;
        String q = raw.trim();

        if (ACRONYM_PATTERN.matcher(q).matches()) {
            return QueryKind.ACRONYM_LIKE;
        }

        if (HAS_DIGIT.matcher(q).matches() && IDENTIFIER_PATTERN.matcher(q).matches()) {
            return QueryKind.IDENTIFIER_LIKE;
        }

        if (q.split("\\s+").length <= 4 && looksLikeName(q)) {
            return QueryKind.PERSON_NAME_LIKE;
        }

        return QueryKind.NATURAL_LANGUAGE;
    }

    private boolean looksLikeName(String q) {
        // Simplified. In production, combine heuristics with field-specific context.
        return q.chars().anyMatch(Character::isUpperCase);
    }
}
```

Query classification bukan untuk mengganti Elasticsearch. Ia untuk memilih query plan yang masuk akal.

---

## 18. Search Plan: Gabungkan Beberapa Sinyal Dengan Boost Yang Jelas

Contoh user query:

```text
APU PPT beneficial owner 2026
```

Kemungkinan intent:

- domain term: APU PPT;
- domain term: beneficial owner;
- year filter/signal: 2026;
- case/regulation content.

Query plan:

1. exact phrase fields;
2. acronym/domain terms;
3. title/content full-text;
4. synonym-expanded fields;
5. date/year filter or boost jika ada;
6. permission filter;
7. lifecycle/status boost.

Example DSL:

```json
GET case_search_v1/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "tenant-a" } },
        { "terms": { "visibility_group_ids": ["group-1", "group-7"] } }
      ],
      "should": [
        {
          "match_phrase": {
            "title": {
              "query": "beneficial owner",
              "boost": 8
            }
          }
        },
        {
          "terms": {
            "acronyms": ["apu", "ppt"],
            "boost": 7
          }
        },
        {
          "multi_match": {
            "query": "APU PPT beneficial owner 2026",
            "fields": [
              "title^4",
              "summary^3",
              "content^1",
              "title.id^2",
              "title.en^2",
              "domain_terms^5"
            ],
            "type": "best_fields"
          }
        },
        {
          "match": {
            "content.syn": {
              "query": "APU PPT beneficial owner 2026",
              "boost": 1.5
            }
          }
        },
        {
          "term": {
            "year": {
              "value": 2026,
              "boost": 2
            }
          }
        }
      ],
      "minimum_should_match": 1
    }
  }
}
```

Catatan penting:

- permission filter harus di `filter`, bukan `should`;
- exact/domain/acronym signal diberi boost tinggi;
- synonym-expanded field boost lebih rendah;
- jangan membuat synonym-expanded match mengalahkan exact phrase match;
- query harus bisa dijelaskan dengan `_explain` saat hasil ranking dipertanyakan.

---

## 19. Highlighting Dalam Multilingual/Domain-Specific Search

Highlighting bisa membingungkan jika synonym dipakai.

Contoh query:

```text
beneficial owner
```

Dokumen:

```text
Pemilik manfaat wajib diidentifikasi...
```

Jika synonym expansion bekerja, dokumen match. Tetapi highlight mungkin menyorot `Pemilik manfaat`, bukan `beneficial owner`, atau tidak menyorot seperti ekspektasi user tergantung field/analyzer/highlighter.

Desain UX:

1. Jangan anggap highlight selalu literal query string.
2. Tampilkan snippet dari field yang benar-benar match.
3. Untuk domain synonym, bisa tampilkan explanation ringan:

```text
Matched because "beneficial owner" is mapped to "pemilik manfaat".
```

4. Untuk regulated/audited search, simpan reason metadata jika perlu:

```json
{
  "matchedSignals": [
    "domain_synonym: beneficial owner -> pemilik manfaat",
    "phrase_match: pemilik manfaat",
    "visibility_filter: group-7"
  ]
}
```

Jangan overpromise bahwa score adalah “alasan hukum”; score adalah ranking signal. Tetapi untuk operational explainability, matched signals sangat berguna.

---

## 20. Multilingual Search Dengan Semantic/Vector Search

Part 030–031 akan membahas vector/semantic/hybrid search lebih dalam. Di part ini cukup pahami batasannya.

Lexical multilingual search bisa gagal jika token tidak overlap:

```text
Query: beneficial owner
Document: pemilik manfaat
```

Synonym bisa membantu jika domain pair diketahui.

Semantic embedding bisa membantu jika model multilingual memahami kedekatan konsep.

Tetapi semantic search punya risiko:

- hasil mirip secara makna tetapi salah secara legal;
- sulit dijelaskan;
- bisa melewatkan exact identifier;
- bisa bias terhadap embedding model;
- permission/freshness tetap harus ditangani;
- tidak menggantikan curated domain vocabulary untuk istilah penting.

Practical hybrid strategy:

```text
1. Exact identifier/name/domain match first.
2. BM25 lexical match for textual relevance.
3. Synonym/domain expansion for known vocabulary mismatch.
4. Vector search for conceptual recall.
5. Rerank/merge with clear rules.
6. Always apply permission filters.
```

Top-tier search tidak fanatik lexical atau semantic. Ia memilih kombinasi berdasarkan failure mode.

---

## 21. Regulatory / Case Management Example

Bayangkan sistem enforcement lifecycle dengan entity:

- case;
- party;
- allegation;
- evidence;
- decision;
- sanction;
- escalation;
- assignment;
- SLA;
- audit log.

User personas:

- investigator;
- reviewer;
- supervisor;
- legal officer;
- auditor;
- executive;
- external liaison.

Query nyata:

```text
kasus APU PPT overdue
beneficial owner belum diverifikasi
sanksi administratif bank 2025
pelanggaran prinsip kehati-hatian oleh direksi
laporan transaksi mencurigakan PEP
case REG-2026-00042
PT Maju Jaya Tbk beneficial owner
```

### 21.1 Domain fields

```json
{
  "case_number": "REG-2026-00042",
  "case_number_normalized": "reg202600042",
  "title": "Dugaan pelanggaran APU PPT terkait pemilik manfaat",
  "summary": "Investigasi terhadap verifikasi beneficial owner yang belum lengkap.",
  "domain_terms": [
    "anti pencucian uang",
    "pencegahan pendanaan terorisme",
    "pemilik manfaat",
    "beneficial owner"
  ],
  "acronyms": ["APU", "PPT", "BO"],
  "parties": [
    {
      "name": "PT Maju Jaya Abadi Tbk",
      "name_normalized": "maju jaya abadi"
    }
  ],
  "lifecycle_status": "INVESTIGATION",
  "sla_status": "OVERDUE",
  "year": 2026,
  "visibility_group_ids": ["enforcement-investigator", "aml-unit"]
}
```

### 21.2 Query plan untuk `beneficial owner belum diverifikasi`

Interpretasi:

- `beneficial owner` domain synonym `pemilik manfaat`;
- `belum diverifikasi` bisa natural text, tetapi juga mungkin structured status;
- jika ada field `verification_status`, query harus filter/boost field itu.

DSL sketch:

```json
GET regulatory_cases/_search
{
  "query": {
    "bool": {
      "filter": [
        { "terms": { "visibility_group_ids": ["aml-unit"] } }
      ],
      "should": [
        {
          "terms": {
            "domain_terms": ["beneficial owner", "pemilik manfaat"],
            "boost": 10
          }
        },
        {
          "term": {
            "beneficial_owner_verification_status": {
              "value": "UNVERIFIED",
              "boost": 8
            }
          }
        },
        {
          "multi_match": {
            "query": "beneficial owner belum diverifikasi",
            "fields": ["title^4", "summary^3", "content^1", "content.syn^2"]
          }
        }
      ],
      "minimum_should_match": 1
    }
  }
}
```

Insight:

> Jika domain phrase bisa diterjemahkan menjadi structured field, gunakan structured field. Jangan memaksa analyzer menyelesaikan domain-state problem.

---

## 22. Testing Analyzer and Synonym

Setiap analyzer harus diuji.

### 22.1 `_analyze` examples

```json
POST case_search_v1/_analyze
{
  "analyzer": "domain_search_analyzer",
  "text": "beneficial owner APU-PPT"
}
```

Yang ingin dilihat:

- apakah `beneficial owner` menghasilkan token yang expected;
- apakah synonym muncul;
- apakah punctuation hilang sesuai kebutuhan;
- apakah acronym tetap utuh atau pecah;
- apakah token terlalu banyak.

### 22.2 Golden queries

Buat tabel:

| Query | Expected top result | Expected behavior |
|---|---|---|
| `KTP` | dokumen Kartu Tanda Penduduk | acronym expansion |
| `beneficial owner` | dokumen pemilik manfaat | bilingual synonym |
| `NPWP 01.234...` | entity dengan NPWP tersebut | normalized identifier exact |
| `pelapor` | pihak pelapor | jangan didominasi terlapor |
| `terlapor` | pihak terlapor | jangan didominasi pelapor |
| `APU PPT` | AML/CFT docs | acronym/domain term |
| `case 2026 42` | REG-2026-00042 | identifier partial/prefix |

### 22.3 Regression test di Java

Pseudo-test:

```java
class SearchRelevanceRegressionTest {

    @Test
    void beneficialOwnerShouldFindPemilikManfaatCases() {
        SearchResponse<CaseHit> response = searchClient.searchCases(
                new SearchRequestDto("beneficial owner", List.of(), 10)
        );

        List<String> topCaseNumbers = response.hits().stream()
                .map(CaseHit::caseNumber)
                .toList();

        assertThat(topCaseNumbers)
                .contains("REG-2026-00042");

        assertThat(topCaseNumbers.indexOf("REG-2026-00042"))
                .isLessThan(3);
    }

    @Test
    void terlaporShouldNotBeDominatedByPelaporOnlyDocuments() {
        SearchResponse<CaseHit> response = searchClient.searchCases(
                new SearchRequestDto("terlapor", List.of(), 10)
        );

        assertThat(response.hits().getFirst().matchedFields())
                .contains("reported_party_name");
    }
}
```

Search relevance test tidak harus sempurna. Tapi tanpa regression test, setiap synonym/analyzer change adalah risiko tersembunyi.

---

## 23. Operationalizing Synonyms

Elasticsearch versi modern menyediakan workflow synonym set/rules dan analyzer yang dapat memakai synonym token filters. Dalam praktik production, Anda tetap butuh deployment discipline.

### 23.1 Checklist sebelum synonym change

Sebelum menambah rule:

```text
[ ] Apakah ini benar synonym, bukan normalization?
[ ] Apakah ini benar synonym, bukan structured filter?
[ ] Apakah rule dua arah aman?
[ ] Apakah acronym ambiguous?
[ ] Scope field/modul sudah jelas?
[ ] Ada query regression test?
[ ] Ada expected positive examples?
[ ] Ada known negative examples?
[ ] Ada rollback plan?
[ ] Ada monitoring after rollout?
```

### 23.2 Positive and negative examples

Untuk rule:

```text
bo => beneficial owner, pemilik manfaat
```

Positive:

```text
Query: BO perusahaan
Expected: dokumen beneficial owner
```

Negative:

```text
Query: back office BO
Expected: jangan semua beneficial owner naik
```

Jika negative case banyak, jangan buat synonym global. Scope rule.

### 23.3 Synonym versioning

Contoh versioned file:

```text
synonyms-regulatory-v2026-06-21.txt
```

Atau managed dictionary:

```json
{
  "version": "2026.06.21",
  "rules": [
    {
      "id": "ownership-beneficial-owner-001",
      "rule": "beneficial owner, pemilik manfaat",
      "scope": ["case_search", "ownership_search"],
      "owner": "regulatory-domain-team",
      "risk": "low"
    }
  ]
}
```

---

## 24. Anti-Patterns

### Anti-pattern 1 — One analyzer to rule them all

Satu analyzer untuk title, content, name, identifier, acronym, dan legal term.

Masalah:

- identifier rusak;
- name search buruk;
- domain synonym terlalu luas;
- exact search tidak reliable;
- relevance sulit dijelaskan.

Solusi:

- field-specific analyzer;
- multi-fields;
- normalized keyword fields;
- query classifier.

### Anti-pattern 2 — Semua search failure diselesaikan dengan wildcard

```json
{ "wildcard": { "content": "*beneficial*" } }
```

Masalah:

- mahal;
- ranking buruk;
- analyzer diabaikan;
- tidak scalable;
- hasil noisy.

Solusi:

- analyzer benar;
- synonym;
- prefix/search_as_you_type untuk autocomplete;
- n-gram field khusus jika perlu;
- vector/hybrid untuk conceptual recall.

### Anti-pattern 3 — Synonym global untuk acronym ambiguous

```text
bo, beneficial owner, back office, branch office
```

Ini hampir pasti buruk.

Solusi:

- scope synonym per field/modul;
- acronym field;
- query context;
- boost controlled.

### Anti-pattern 4 — Stemming field diberi boost terlalu tinggi

Query `terlapor` lalu hasil `pelapor` naik karena stem sama.

Solusi:

- exact/non-stemmed field boost lebih tinggi;
- stemmed field sebagai recall support;
- role-specific fields.

### Anti-pattern 5 — Tidak punya negative relevance tests

Tim hanya menguji apakah query menemukan dokumen yang diinginkan. Tidak menguji apakah dokumen yang salah ikut naik.

Search quality butuh dua sisi:

```text
positive: harus ketemu
negative: jangan naik terlalu tinggi
```

### Anti-pattern 6 — Domain dictionary tidak punya owner

Synonym bertambah dari request ad hoc. Setelah setahun, tidak ada yang tahu kenapa rule ada.

Solusi:

- owner;
- version;
- notes;
- tests;
- review cadence.

---

## 25. Design Pattern: Layered Search Fields

Pattern yang sering efektif:

```text
field.raw              -> exact keyword
field.normalized       -> normalized exact/prefix
field.text             -> normal full-text
field.stemmed          -> language stemmed recall
field.syn              -> domain synonym expansion
field.autocomplete     -> typeahead
field.semantic_vector  -> semantic retrieval candidate
```

Tidak semua field perlu semua layer. Pilih sesuai use case.

Contoh case title:

```json
{
  "title": {
    "type": "text",
    "analyzer": "id_en_basic",
    "fields": {
      "raw": {
        "type": "keyword",
        "normalizer": "lowercase_ascii_normalizer"
      },
      "id": {
        "type": "text",
        "analyzer": "indonesian"
      },
      "en": {
        "type": "text",
        "analyzer": "english"
      },
      "syn": {
        "type": "text",
        "analyzer": "domain_index_analyzer",
        "search_analyzer": "domain_search_analyzer"
      }
    }
  }
}
```

Query boost:

```text
raw/exact phrase  -> highest
normal text       -> high
language field    -> medium
synonym field     -> medium/low depending risk
semantic          -> hybrid/rerank
```

---

## 26. Design Pattern: Domain-Aware Search Request Pipeline

Backend search endpoint sebaiknya punya pipeline internal:

```text
HTTP request
   |
   v
Validate query and filters
   |
   v
Normalize raw query
   |
   v
Classify query kind
   |
   v
Extract identifiers/acronyms/dates/domain terms
   |
   v
Build permission filters
   |
   v
Build query plan
   |
   v
Execute Elasticsearch query
   |
   v
Post-process hits: highlight, matched signals, display projection
   |
   v
Return response with stable contract
```

Java sketch:

```java
public final class SearchQueryPlanner {

    private final QueryClassifier classifier;
    private final IdentifierNormalizer identifierNormalizer;
    private final DomainDictionary dictionary;

    public ElasticsearchQueryPlan plan(SearchRequestDto request, UserContext user) {
        String raw = request.query();
        QueryKind kind = classifier.classify(raw);

        List<QueryClause> should = new ArrayList<>();
        List<QueryClause> filters = new ArrayList<>();

        filters.add(permissionFilter(user));
        filters.addAll(structuredFilters(request.filters()));

        switch (kind) {
            case IDENTIFIER_LIKE -> {
                String normalized = IdentifierNormalizer.normalizeIdentifier(raw);
                should.add(exactIdentifierClause(normalized, 100));
                should.add(prefixIdentifierClause(normalized, 30));
                should.add(fullTextClause(raw, 1));
            }
            case ACRONYM_LIKE -> {
                List<String> acronyms = extractAcronyms(raw);
                should.add(acronymClause(acronyms, 20));
                should.add(domainSynonymTextClause(raw, 3));
                should.add(fullTextClause(raw, 2));
            }
            case NATURAL_LANGUAGE, MIXED, PERSON_NAME_LIKE -> {
                should.add(phraseTitleClause(raw, 8));
                should.add(fullTextClause(raw, 4));
                should.add(domainSynonymTextClause(raw, 2));
                dictionary.findTerms(raw)
                        .forEach(term -> should.add(domainTermClause(term, 10)));
            }
            case EMPTY -> throw new InvalidSearchQueryException("Query cannot be empty");
        }

        return new ElasticsearchQueryPlan(filters, should, request.sort(), request.page());
    }
}
```

Intinya:

- query planning hidup di application layer;
- analyzer hidup di Elasticsearch;
- domain vocabulary hidup di governed dictionary;
- permission tetap selalu filter;
- ranking signal explicit.

---

## 27. Practical Mapping Example

Contoh mapping ringkas untuk case search multilingual/domain-specific:

```json
PUT regulatory_cases_v1
{
  "settings": {
    "analysis": {
      "normalizer": {
        "lowercase_ascii_normalizer": {
          "type": "custom",
          "filter": ["lowercase", "asciifolding"]
        }
      },
      "filter": {
        "domain_synonyms": {
          "type": "synonym_graph",
          "synonyms": [
            "ktp, kartu tanda penduduk",
            "npwp, nomor pokok wajib pajak",
            "beneficial owner, pemilik manfaat",
            "aml, anti money laundering, anti pencucian uang",
            "apu ppt, anti pencucian uang pencegahan pendanaan terorisme",
            "cdd, customer due diligence, uji tuntas nasabah",
            "edd, enhanced due diligence, uji tuntas lanjut"
          ]
        }
      },
      "analyzer": {
        "id_en_basic": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding"]
        },
        "domain_index_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding"]
        },
        "domain_search_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding", "domain_synonyms"]
        }
      }
    }
  },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "tenant_id": { "type": "keyword" },
      "case_id": { "type": "keyword" },
      "case_number": {
        "type": "keyword",
        "normalizer": "lowercase_ascii_normalizer"
      },
      "case_number_normalized": { "type": "keyword" },
      "case_number_parts": {
        "type": "keyword",
        "normalizer": "lowercase_ascii_normalizer"
      },
      "title": {
        "type": "text",
        "analyzer": "id_en_basic",
        "fields": {
          "raw": {
            "type": "keyword",
            "normalizer": "lowercase_ascii_normalizer"
          },
          "id": {
            "type": "text",
            "analyzer": "indonesian"
          },
          "en": {
            "type": "text",
            "analyzer": "english"
          },
          "syn": {
            "type": "text",
            "analyzer": "domain_index_analyzer",
            "search_analyzer": "domain_search_analyzer"
          }
        }
      },
      "summary": {
        "type": "text",
        "analyzer": "id_en_basic",
        "fields": {
          "id": { "type": "text", "analyzer": "indonesian" },
          "en": { "type": "text", "analyzer": "english" },
          "syn": {
            "type": "text",
            "analyzer": "domain_index_analyzer",
            "search_analyzer": "domain_search_analyzer"
          }
        }
      },
      "content": {
        "type": "text",
        "analyzer": "id_en_basic",
        "fields": {
          "syn": {
            "type": "text",
            "analyzer": "domain_index_analyzer",
            "search_analyzer": "domain_search_analyzer"
          }
        }
      },
      "acronyms": {
        "type": "keyword",
        "normalizer": "lowercase_ascii_normalizer"
      },
      "domain_terms": {
        "type": "keyword",
        "normalizer": "lowercase_ascii_normalizer"
      },
      "party_names": {
        "type": "text",
        "analyzer": "id_en_basic",
        "fields": {
          "raw": {
            "type": "keyword",
            "normalizer": "lowercase_ascii_normalizer"
          }
        }
      },
      "party_name_normalized": {
        "type": "keyword",
        "normalizer": "lowercase_ascii_normalizer"
      },
      "lifecycle_status": { "type": "keyword" },
      "sla_status": { "type": "keyword" },
      "year": { "type": "integer" },
      "created_at": { "type": "date" },
      "updated_at": { "type": "date" },
      "visibility_group_ids": { "type": "keyword" }
    }
  }
}
```

Catatan:

- mapping ini bukan template universal;
- `dynamic: strict` membantu governance;
- field `case_number_normalized` disiapkan application-side;
- synonym hanya di search analyzer untuk field `.syn`;
- exact/domain/acronym fields dipisah;
- language analyzers dipakai via multi-fields;
- permission field eksplisit.

---

## 28. Practical Query Example

Query user:

```text
beneficial owner APU PPT 2026
```

DSL:

```json
GET regulatory_cases_v1/_search
{
  "size": 10,
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "tenant-a" } },
        { "terms": { "visibility_group_ids": ["aml-unit", "enforcement-team"] } }
      ],
      "should": [
        {
          "terms": {
            "domain_terms": [
              "beneficial owner",
              "pemilik manfaat",
              "anti pencucian uang",
              "pencegahan pendanaan terorisme"
            ],
            "boost": 10
          }
        },
        {
          "terms": {
            "acronyms": ["apu", "ppt"],
            "boost": 8
          }
        },
        {
          "multi_match": {
            "query": "beneficial owner APU PPT 2026",
            "fields": [
              "title^5",
              "title.id^3",
              "title.en^3",
              "summary^3",
              "summary.id^2",
              "summary.en^2",
              "content^1"
            ],
            "type": "best_fields"
          }
        },
        {
          "multi_match": {
            "query": "beneficial owner APU PPT 2026",
            "fields": [
              "title.syn^2",
              "summary.syn^2",
              "content.syn^1"
            ],
            "type": "best_fields"
          }
        },
        {
          "term": {
            "year": {
              "value": 2026,
              "boost": 2
            }
          }
        }
      ],
      "minimum_should_match": 1
    }
  },
  "highlight": {
    "fields": {
      "title": {},
      "summary": {},
      "content": {}
    }
  }
}
```

Kelebihan desain ini:

- domain terms bisa mengalahkan incidental content match;
- acronym ditangani eksplisit;
- synonym expansion membantu recall tapi tidak dominan;
- permission aman di filter;
- year menjadi ranking signal, bukan mandatory filter kecuali user UI menyatakan demikian.

---

## 29. Evaluation Metrics Untuk Domain-Specific Search

Untuk multilingual/domain-specific search, metrik umum harus ditambah domain checks.

### 29.1 Query-level metrics

- precision@K;
- recall@K;
- MRR;
- nDCG;
- zero-result rate;
- reformulation rate;
- click-through rate;
- successful refinement rate.

### 29.2 Domain-specific checks

| Check | Pertanyaan |
|---|---|
| acronym precision | Apakah acronym ambiguous menaikkan dokumen salah? |
| bilingual recall | Apakah query English menemukan dokumen Indonesia yang relevan? |
| legal role separation | Apakah `pelapor` dan `terlapor` tetap terpisah? |
| identifier dominance | Apakah exact identifier selalu top? |
| permission leakage | Apakah facet/highlight membocorkan dokumen tidak berhak? |
| synonym regression | Apakah rule baru merusak query lama? |
| no-result recovery | Apakah query istilah user informal bisa diarahkan ke istilah formal? |

### 29.3 Search quality dashboard

Minimal monitor:

```text
Top zero-result queries
Top low-click queries
Top reformulated queries
Top synonym-triggered queries
Top acronym queries
Queries with high latency
Queries with no permission-visible hits but internal hits exist
Top clicked result position distribution
```

Untuk regulated system, log search harus tetap memperhatikan privacy dan access policy.

---

## 30. Production Checklist

Sebelum multilingual/domain-specific search masuk production:

```text
Mapping and field design
[ ] Exact keyword fields tersedia untuk identifier/name penting
[ ] Normalized identifier fields tersedia
[ ] Text fields punya analyzer sesuai kebutuhan
[ ] Language-specific fields dipakai jika data bilingual signifikan
[ ] Synonym field dipisah atau boost-nya terkendali
[ ] Dynamic mapping tidak membiarkan field liar masuk

Analyzer
[ ] Analyzer diuji dengan _analyze
[ ] Stopword tidak agresif tanpa bukti
[ ] Stemming tidak mengalahkan exact match
[ ] Acronym tidak pecah secara merusak
[ ] Punctuation identifier ditangani
[ ] Unicode/accent handling jelas

Synonym and dictionary
[ ] Synonym punya owner
[ ] Synonym punya scope
[ ] Acronym ambiguous tidak global
[ ] Ada positive test
[ ] Ada negative test
[ ] Ada versioning/change log
[ ] Ada rollback plan

Query planning
[ ] Query classifier membedakan identifier/acronym/natural text
[ ] Permission filter selalu diterapkan
[ ] Exact/domain/acronym boost lebih tinggi dari broad synonym
[ ] Wildcard dibatasi
[ ] Minimum query length diterapkan untuk expensive pattern
[ ] Highlight diuji untuk synonym match

Evaluation
[ ] Golden query set tersedia
[ ] Regression test otomatis tersedia
[ ] Zero-result queries dimonitor
[ ] Relevance review process ada
[ ] Domain expert bisa memberi judgment

Operations
[ ] Synonym rollout procedure jelas
[ ] Analyzer/mapping migration plan ada
[ ] Reindex impact dipahami
[ ] Search logs aman secara privacy
[ ] Incident playbook untuk relevance regression tersedia
```

---

## 31. Heuristics Untuk Top 1% Engineer

Seorang engineer rata-rata bertanya:

> “Analyzer apa yang harus saya pakai?”

Engineer yang kuat bertanya:

> “Vocabulary mismatch apa yang ingin saya selesaikan, pada field mana, untuk user intent apa, dengan risiko false positive apa?”

Engineer rata-rata menambah synonym saat user komplain.

Engineer yang kuat mengklasifikasikan failure:

```text
normalization?
identifier?
acronym?
morphology?
domain equivalence?
structured filter intent?
semantic mismatch?
permission issue?
freshness issue?
ranking issue?
```

Engineer rata-rata membuat satu search query besar.

Engineer yang kuat membuat query plan dengan layered signals:

```text
exact -> identifier -> phrase -> fielded domain terms -> normal lexical -> synonym -> semantic -> business ranking
```

Engineer rata-rata menganggap search sukses jika “ada hasil”.

Engineer yang kuat mengukur:

```text
apakah hasil yang benar muncul?
apakah hasil yang salah tidak naik?
apakah user bisa menjelaskan kenapa hasil muncul?
apakah permission aman?
apakah perubahan vocabulary bisa di-audit?
```

---

## 32. Ringkasan Mental Model

Multilingual/domain-specific search adalah problem **vocabulary alignment**.

Elasticsearch tidak otomatis memahami:

- acronym;
- istilah legal;
- istilah bilingual;
- identifier;
- nama orang/perusahaan;
- query intent;
- perbedaan role seperti pelapor/terlapor;
- status business seperti overdue/unverified.

Anda harus mendesain alignment melalui:

1. analyzer;
2. normalizer;
3. field-specific mapping;
4. multi-fields;
5. synonym/synonym_graph;
6. acronym/domain fields;
7. identifier normalization;
8. query classifier;
9. structured filters;
10. relevance tests;
11. domain dictionary governance;
12. monitoring query behavior.

Prinsip paling penting:

> Jangan cari analyzer “terbaik”. Cari field/query/vocabulary design yang paling sesuai dengan failure mode search Anda.

---

## 33. Hubungan Ke Part Berikutnya

Part berikutnya adalah:

`learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-020.md`

Topik:

# Security, Authorization, and Permission-Aware Search

Setelah vocabulary dan language handling, kita akan membahas hal yang sangat kritikal untuk enterprise/regulatory system: memastikan search tidak membocorkan data.

Kita akan membahas:

- cluster security basics;
- authentication/authorization;
- API key usage;
- index-level security;
- document-level security concept;
- field-level security concept;
- application-side authorization filtering;
- tenant isolation;
- leakage melalui facets/counts/highlights;
- auditability;
- regulatory defensibility;
- permission drift detection.

---

## 34. Referensi Utama

Referensi yang relevan untuk part ini:

1. Elastic documentation — Language analyzers.
2. Elastic documentation — Synonym token filter.
3. Elastic documentation — Synonym graph token filter.
4. Elastic documentation — Search with synonyms.
5. Elastic documentation — Token filter reference.
6. Elastic documentation — Tokenizer reference.
7. Elastic documentation — ASCII folding token filter.
8. Elastic documentation — `search_analyzer` mapping parameter.
9. Elastic documentation — ICU analysis plugin.
10. Elastic documentation — ICU folding / normalization / transform filters.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — Highlighting, Suggestions, Autocomplete, and Spell Correction</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-020.md">Part 020 — Security, Authorization, and Permission-Aware Search ➡️</a>
</div>
