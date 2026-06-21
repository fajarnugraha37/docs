# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-011.md

# Part 011 — Relevance Engineering II: Domain-Aware Ranking

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: membangun ranking search yang sadar konteks domain, bisa dijelaskan, bisa diuji, bisa diubah, dan tidak berubah menjadi kumpulan hack yang rapuh.

---

## 0. Posisi Part Ini Dalam Seri

Di Part 010, kita membahas dasar scoring: bagaimana Elasticsearch/Lucene memberi skor pada dokumen berdasarkan sinyal lexical seperti term frequency, inverse document frequency, dan field length normalization. Itu adalah fondasi retrieval klasik.

Namun di sistem nyata, ranking yang hanya mengandalkan lexical relevance sering tidak cukup.

Contoh:

- User mencari `payment fraud`.
- Ada 3 dokumen yang sama-sama cocok secara kata:
  - kasus lama 5 tahun lalu, sudah ditutup;
  - kasus aktif dengan severity tinggi;
  - draft case internal yang belum boleh muncul;
- Secara BM25, dokumen lama bisa saja menang karena field text-nya lebih cocok.
- Secara produk dan operasional, hasil yang lebih benar mungkin adalah kasus aktif, high-severity, recent, visible, dan actionable.

Di sinilah **domain-aware ranking** masuk.

Tujuan part ini bukan membuat Anda hafal semua fitur scoring Elasticsearch, tetapi membangun kemampuan untuk menjawab pertanyaan seperti:

- Sinyal domain apa yang layak memengaruhi ranking?
- Sinyal mana yang harus menjadi filter, bukan boost?
- Bagaimana menggabungkan lexical score dengan business score?
- Bagaimana ranking tetap bisa dijelaskan kepada engineer, product owner, auditor, atau regulator?
- Bagaimana menghindari ranking yang “kelihatan bagus” tapi diam-diam merusak fairness, recall, atau defensibility?

---

## 1. Core Mental Model: Ranking Bukan Satu Skor, Tapi Komposisi Sinyal

Search ranking di sistem produksi biasanya bukan hanya:

```text
_score = BM25(query, document)
```

Tetapi lebih mirip:

```text
final_score = combine(
  lexical_relevance,
  semantic_relevance,
  business_priority,
  freshness,
  authority,
  quality,
  popularity,
  lifecycle_state,
  user_context,
  permission_constraints,
  operational_constraints
)
```

Untuk Part 011, kita fokus pada sinyal non-lexical yang masih bisa diterapkan di Elasticsearch search query.

Namun ada prinsip penting:

> Tidak semua sinyal domain boleh menjadi boost. Sebagian harus menjadi filter. Sebagian harus menjadi sort. Sebagian harus menjadi post-processing. Sebagian bahkan tidak boleh dipakai sama sekali.

Misalnya:

| Sinyal | Biasanya Dipakai Sebagai | Alasan |
|---|---|---|
| Tenant ID | filter | Batas isolasi data, bukan ranking |
| Permission | filter | Dokumen tidak boleh muncul jika user tidak berhak |
| Lifecycle status `deleted` | filter | Bukan kandidat hasil |
| Lifecycle status `active` | boost/filter tergantung domain | Kadang active lebih relevan, kadang historical juga penting |
| Recency | boost/sort | Dokumen baru sering lebih berguna, tapi tidak selalu |
| Severity | boost | Dalam case management, high severity mungkin perlu naik |
| Popularity | boost | Berguna di product/content search, berisiko di regulatory search |
| Exact identifier match | hard boost / separate path | Identifier match biasanya intent kuat |
| SLA breach | boost/filter/sort | Bisa menjadi urgency signal |
| Confidentiality level | filter | Tidak boleh ranking-based leakage |

Ranking yang matang dimulai dari klasifikasi sinyal.

---

## 2. Tiga Lapisan Relevance: Lexical, Domain, dan Operational

Agar tidak kacau, pisahkan ranking menjadi tiga lapisan.

### 2.1 Lexical Relevance

Ini adalah seberapa cocok teks dokumen terhadap query.

Contoh sinyal:

- term match;
- phrase match;
- field boost;
- exact keyword match;
- fuzzy match;
- synonym match;
- BM25 score.

Pertanyaan yang dijawab:

> “Apakah dokumen ini membahas hal yang dicari user?”

### 2.2 Domain Relevance

Ini adalah seberapa penting dokumen itu dalam konteks domain.

Contoh sinyal:

- case severity;
- enforcement priority;
- recency;
- trust level;
- authoritative source;
- number of confirmed allegations;
- active investigation flag;
- document quality;
- compliance status;
- decision finality;
- assigned unit priority.

Pertanyaan yang dijawab:

> “Dari dokumen yang membahas hal ini, mana yang lebih berguna/bernilai secara domain?”

### 2.3 Operational Relevance

Ini adalah constraint atau preferensi yang muncul dari operasi sistem.

Contoh:

- permission;
- tenant isolation;
- visibility window;
- legal hold;
- retention state;
- index freshness;
- deleted/superseded state;
- environment boundary;
- data quality confidence;
- rollout flag.

Pertanyaan yang dijawab:

> “Apakah dokumen ini boleh dan layak ditampilkan sekarang?”

Kesalahan umum adalah mencampur ketiganya menjadi satu query besar tanpa struktur. Akibatnya debugging ranking menjadi sangat sulit.

---

## 3. Ranking Pipeline: Dari Candidate Generation ke Final Ordering

Jangan bayangkan ranking sebagai satu query monolitik. Bayangkan sebagai pipeline.

```text
User query
  ↓
Parse intent
  ↓
Apply hard constraints
  ↓
Generate candidates with lexical/semantic retrieval
  ↓
Apply domain-aware scoring
  ↓
Optional rescore/rerank
  ↓
Sort/tie-break
  ↓
Return explainable results
```

### 3.1 Hard Constraints

Hard constraints menentukan kandidat yang boleh dipertimbangkan.

Contoh:

```json
{
  "filter": [
    { "term": { "tenant_id": "tenant-a" }},
    { "terms": { "visibility": ["public", "internal"] }},
    { "term": { "is_deleted": false }}
  ]
}
```

Constraint seperti permission, tenant, deleted flag, dan visibility tidak boleh hanya menjadi boost. Jika dokumen tidak boleh muncul, dokumen harus dikeluarkan dari candidate set.

### 3.2 Candidate Generation

Candidate generation mencari dokumen yang mungkin relevan.

Contoh:

```json
{
  "multi_match": {
    "query": "payment fraud",
    "fields": [
      "title^4",
      "summary^2",
      "body"
    ]
  }
}
```

Tujuan candidate generation bukan final ranking sempurna. Tujuannya mengumpulkan kandidat yang masuk akal.

### 3.3 Domain Scoring

Domain scoring menaikkan/menurunkan kandidat berdasarkan sinyal domain.

Contoh:

- kasus aktif naik;
- high severity naik;
- dokumen recent naik;
- source official naik;
- dokumen superseded turun;
- dokumen dengan low confidence turun.

### 3.4 Tie-Breaking

Jika skor sama atau sangat dekat, gunakan tie-breaker yang stabil.

Contoh:

```text
_score desc, updated_at desc, id asc
```

Tanpa tie-breaker stabil, pagination bisa menghasilkan hasil berulang atau hilang ketika memakai `from/size` atau `search_after`.

---

## 4. Filter vs Boost vs Sort: Keputusan Fundamental

Sebelum menulis query, tanyakan: sinyal ini harus dipakai sebagai apa?

### 4.1 Gunakan Filter Jika Sinyal Menentukan Eligibility

Contoh:

- tenant;
- permission;
- deleted flag;
- legal visibility;
- data partition;
- allowed status;
- access scope.

Filter menjawab:

> “Apakah dokumen ini boleh menjadi kandidat?”

Filter tidak menjawab:

> “Seberapa tinggi dokumen ini harus diranking?”

### 4.2 Gunakan Boost Jika Sinyal Menentukan Preferensi

Contoh:

- fresh document sedikit lebih baik;
- active case lebih penting;
- high severity lebih urgent;
- official source lebih authoritative;
- title match lebih kuat dari body match.

Boost menjawab:

> “Di antara kandidat yang valid, mana yang lebih baik?”

### 4.3 Gunakan Sort Jika Sinyal Menggantikan Relevance

Sort cocok ketika user memilih eksplisit:

- newest first;
- highest amount;
- due date soonest;
- severity descending;
- case number ascending.

Sort menjawab:

> “User tidak meminta ranking relevance utama; user meminta urutan deterministik berdasarkan field.”

Jika sort by field digunakan, `_score` bisa menjadi sekunder atau bahkan tidak relevan.

### 4.4 Gunakan Post-Processing Jika Butuh Aturan Aplikasi Kompleks

Beberapa aturan terlalu domain-specific atau terlalu mahal untuk query.

Contoh:

- explainability custom;
- deduplication lintas entity;
- grouping hasil lintas tipe;
- business rule yang berubah sangat sering;
- policy engine external;
- conflict resolution antar permission model.

Namun hati-hati: post-processing setelah Elasticsearch hanya bekerja pada top-N yang sudah dikembalikan. Jika candidate generation buruk, post-processing tidak bisa menyelamatkan dokumen yang tidak pernah masuk hasil.

---

## 5. Domain Signals: Apa yang Umumnya Dipakai?

### 5.1 Freshness

Freshness menaikkan dokumen yang lebih baru.

Berguna untuk:

- news;
- logs;
- incidents;
- active cases;
- recent policies;
- updated guidance;
- tickets;
- investigations.

Risiko:

- dokumen baru belum tentu lebih benar;
- dokumen lama bisa authoritative;
- freshness berlebihan membuat hasil historis tenggelam;
- sistem menjadi bias ke aktivitas terbaru.

Mental model:

```text
Freshness should usually decay, not hard-sort.
```

Artinya dokumen baru mendapat keuntungan, tetapi lexical relevance tetap penting.

### 5.2 Popularity

Popularity bisa berupa:

- click count;
- view count;
- download count;
- purchase count;
- reference count;
- number of linked cases;
- number of citations.

Berguna untuk:

- ecommerce;
- documentation search;
- knowledge base;
- public content;
- product search.

Risiko:

- rich-get-richer feedback loop;
- dokumen lama makin dominan;
- hasil baru sulit naik;
- click tidak selalu berarti relevan;
- di regulatory search, popularity bisa misleading.

### 5.3 Authority

Authority menunjukkan sumber lebih terpercaya.

Contoh:

- official regulation;
- final decision;
- signed document;
- verified source;
- primary record;
- canonical case;
- approved guidance.

Authority sering lebih defensible dibanding popularity.

### 5.4 Quality

Quality bisa berupa:

- completeness score;
- confidence score;
- validation status;
- document quality flag;
- OCR quality;
- structured metadata completeness;
- manual curation score.

Di sistem enterprise, quality signal sangat penting karena data sering tidak bersih.

### 5.5 Lifecycle State

Lifecycle state menentukan posisi dokumen dalam proses.

Contoh:

- draft;
- active;
- pending review;
- approved;
- superseded;
- closed;
- archived;
- deleted.

Lifecycle bisa menjadi:

- filter: draft tidak boleh muncul bagi user tertentu;
- boost: active lebih tinggi dari closed;
- demotion: superseded turun tapi tetap ditemukan;
- sort: overdue/active first.

### 5.6 Urgency / SLA / Severity

Di case management dan regulatory systems, sinyal ini sering penting.

Contoh:

- severity level;
- breach probability;
- days until due date;
- overdue flag;
- enforcement priority;
- public harm risk;
- escalation level.

Risiko:

- severity bisa mendominasi lexical relevance;
- semua query menjadi “urgent-first” walau user mencari informasi spesifik;
- auditor bisa mempertanyakan mengapa hasil tertentu selalu naik.

Gunakan dengan transparan dan terukur.

---

## 6. Elasticsearch Building Blocks untuk Domain-Aware Ranking

Elasticsearch menyediakan beberapa mekanisme untuk memengaruhi scoring.

Yang paling relevan untuk part ini:

1. `function_score`
2. `field_value_factor`
3. decay functions
4. `script_score`
5. `rank_feature`
6. `rank_features`
7. boosting via `bool.should`
8. rescore
9. sort + tie-breaker

Kita bahas satu per satu.

---

## 7. `function_score`: Kerangka Umum Untuk Mengubah Score

`function_score` memungkinkan kita mengambil query dasar lalu mengubah score dokumen yang match.

Pola umum:

```json
GET cases/_search
{
  "query": {
    "function_score": {
      "query": {
        "bool": {
          "must": [
            {
              "multi_match": {
                "query": "payment fraud",
                "fields": ["title^4", "summary^2", "body"]
              }
            }
          ],
          "filter": [
            { "term": { "tenant_id": "tenant-a" }},
            { "term": { "is_deleted": false }}
          ]
        }
      },
      "functions": [
        {
          "filter": { "term": { "status": "active" }},
          "weight": 1.5
        },
        {
          "filter": { "term": { "severity": "high" }},
          "weight": 1.3
        }
      ],
      "score_mode": "multiply",
      "boost_mode": "multiply"
    }
  }
}
```

Interpretasi:

- Cari dokumen yang cocok dengan query lexical.
- Batasi ke tenant dan dokumen yang belum dihapus.
- Jika status active, beri weight tambahan.
- Jika severity high, beri weight tambahan.
- Gabungkan score dengan mode tertentu.

### 7.1 `score_mode`

`score_mode` menentukan cara beberapa function digabung.

Umumnya:

| Mode | Makna |
|---|---|
| `multiply` | sinyal saling mengalikan |
| `sum` | sinyal dijumlahkan |
| `avg` | rata-rata |
| `max` | ambil sinyal terbesar |
| `min` | ambil sinyal terkecil |
| `first` | ambil function pertama yang match |

`multiply` sering dipakai karena menjaga lexical relevance tetap penting. Tapi hati-hati: terlalu banyak multiplier bisa membuat skor meledak atau terlalu kecil.

### 7.2 `boost_mode`

`boost_mode` menentukan cara function score digabung dengan query score asli.

Contoh:

| Mode | Efek |
|---|---|
| `multiply` | final = lexical score × function score |
| `sum` | final = lexical score + function score |
| `replace` | function score menggantikan lexical score |
| `max` | ambil yang lebih tinggi |
| `min` | ambil yang lebih rendah |

Untuk search berbasis relevance, biasanya hindari `replace` kecuali Anda benar-benar ingin lexical score hanya menjadi candidate generator.

---

## 8. `field_value_factor`: Boost Berdasarkan Nilai Field Numerik

`field_value_factor` memungkinkan field numerik memengaruhi score tanpa script. Ini lebih ringan daripada scripting untuk banyak kasus.

Contoh popularity boost:

```json
GET documents/_search
{
  "query": {
    "function_score": {
      "query": {
        "match": {
          "body": "retention policy"
        }
      },
      "field_value_factor": {
        "field": "view_count",
        "factor": 0.1,
        "modifier": "log1p",
        "missing": 1
      },
      "boost_mode": "multiply"
    }
  }
}
```

Makna:

- Gunakan `view_count` sebagai sinyal tambahan.
- `log1p` membuat efek popularity tidak linear.
- Dokumen dengan 1.000 view tidak otomatis 1.000x lebih baik dari dokumen dengan 1 view.

### 8.1 Mengapa Modifier Penting?

Sinyal domain sering memiliki distribusi skewed.

Contoh:

```text
view_count:
- doc A: 10
- doc B: 100
- doc C: 100000
```

Jika nilai mentah dipakai, doc C akan mendominasi ranking.

Karena itu gunakan transformasi seperti:

- log;
- log1p;
- sqrt;
- saturation;
- custom normalization.

Prinsip:

> Hampir semua sinyal numeric mentah perlu dinormalisasi sebelum memengaruhi ranking.

---

## 9. Decay Functions: Boost Berdasarkan Jarak dari Origin

Decay function cocok untuk sinyal yang efeknya berkurang seiring jarak.

Contoh paling umum: recency.

```json
GET cases/_search
{
  "query": {
    "function_score": {
      "query": {
        "match": {
          "summary": "payment fraud"
        }
      },
      "functions": [
        {
          "gauss": {
            "updated_at": {
              "origin": "now",
              "scale": "30d",
              "offset": "7d",
              "decay": 0.5
            }
          }
        }
      ],
      "boost_mode": "multiply"
    }
  }
}
```

Makna konseptual:

- Dokumen yang sangat dekat dengan `now` mendapat boost tinggi.
- Sampai `offset` 7 hari, penurunan bisa kecil/tidak terasa.
- Pada sekitar `scale` 30 hari, score decay turun sesuai parameter.
- Dokumen lama tetap bisa muncul jika lexical relevance kuat.

### 9.1 Decay Cocok Untuk Apa?

| Sinyal | Contoh Origin | Jarak |
|---|---|---|
| Recency | `now` | waktu sejak update |
| Due date urgency | `now` atau target date | jarak ke deadline |
| Geo proximity | lokasi user | jarak geografis |
| Price preference | target price | jarak harga |
| Numeric ideal | target amount | selisih numerik |

### 9.2 Jangan Gunakan Freshness Sebagai Sort Default Tanpa Alasan

Jika Anda sort semua hasil by `updated_at desc`, maka search berubah menjadi:

> “tampilkan dokumen terbaru yang cocok sedikit”

bukan:

> “tampilkan dokumen paling relevan dengan sedikit preferensi ke yang baru”

Untuk banyak domain, decay lebih masuk akal daripada hard sort.

---

## 10. `script_score`: Fleksibel Tapi Mahal dan Berisiko

`script_score` memungkinkan scoring custom dengan script.

Contoh sederhana:

```json
GET cases/_search
{
  "query": {
    "script_score": {
      "query": {
        "match": {
          "summary": "payment fraud"
        }
      },
      "script": {
        "source": "_score * (1 + Math.log(1 + doc['priority_score'].value))"
      }
    }
  }
}
```

Kapan berguna:

- formula scoring tidak bisa diekspresikan dengan function_score biasa;
- perlu kombinasi beberapa numeric field;
- perlu conditional scoring;
- eksperimen ranking terbatas;
- candidate set sudah kecil.

Risiko:

- lebih mahal daripada primitive query/function;
- bisa membuat query lambat;
- sulit di-maintain;
- raw field missing bisa menyebabkan error jika tidak hati-hati;
- formula bisa menjadi tidak transparan;
- logic ranking tersebar di string script.

Prinsip:

> Gunakan script_score hanya setelah candidate set cukup sempit dan formula benar-benar tidak bisa direpresentasikan dengan fitur yang lebih sederhana.

---

## 11. `rank_feature` dan `rank_features`: Sinyal Ranking yang Lebih Terstruktur

Elasticsearch menyediakan field type `rank_feature` dan `rank_features` untuk sinyal numerik yang memang dirancang sebagai ranking feature.

Contoh mapping:

```json
PUT cases
{
  "mappings": {
    "properties": {
      "authority_score": {
        "type": "rank_feature"
      },
      "quality_score": {
        "type": "rank_feature"
      }
    }
  }
}
```

Contoh query:

```json
GET cases/_search
{
  "query": {
    "bool": {
      "must": [
        {
          "match": {
            "summary": "payment fraud"
          }
        }
      ],
      "should": [
        {
          "rank_feature": {
            "field": "authority_score",
            "saturation": {
              "pivot": 10
            }
          }
        },
        {
          "rank_feature": {
            "field": "quality_score",
            "boost": 0.5
          }
        }
      ]
    }
  }
}
```

Kelebihan:

- lebih eksplisit sebagai ranking signal;
- dapat memakai fungsi seperti saturation/log/sigmoid/linear;
- mengurangi kebutuhan script;
- cocok untuk sinyal seperti authority, quality, popularity, confidence.

Kekurangan:

- harus didesain sejak mapping;
- tidak cocok untuk semua field;
- butuh governance atas makna score;
- nilai perlu dinormalisasi dan dipantau.

---

## 12. Saturation: Teman Terbaik Untuk Business Signal

Banyak sinyal domain harus saturating, bukan linear.

Contoh:

- view count dari 0 ke 100 penting;
- dari 100 ke 1.000 masih penting tapi tidak sebesar itu;
- dari 1.000 ke 1.000.000 tidak boleh membuat dokumen tak terkalahkan.

Saturation memberi efek diminishing returns.

Secara mental:

```text
awal naik cepat → lalu melandai
```

Ini cocok untuk:

- popularity;
- authority;
- confidence;
- quality;
- reference count;
- endorsement count;
- evidence count.

Dalam sistem matang, banyak sinyal domain harus diperlakukan seperti ini.

---

## 13. Status dan Lifecycle Boosting

Lifecycle state sering menjadi sinyal domain penting.

Misalnya index `cases` punya field:

```json
{
  "case_id": "CASE-2026-001",
  "title": "Payment fraud investigation",
  "status": "active",
  "severity": "high",
  "updated_at": "2026-06-20T10:00:00Z"
}
```

Query:

```json
GET cases/_search
{
  "query": {
    "function_score": {
      "query": {
        "bool": {
          "must": [
            {
              "multi_match": {
                "query": "payment fraud",
                "fields": ["title^4", "summary^2", "body"]
              }
            }
          ],
          "filter": [
            { "term": { "tenant_id": "tenant-a" }},
            { "term": { "is_deleted": false }}
          ]
        }
      },
      "functions": [
        {
          "filter": { "term": { "status": "active" }},
          "weight": 1.4
        },
        {
          "filter": { "term": { "status": "pending_review" }},
          "weight": 1.2
        },
        {
          "filter": { "term": { "status": "superseded" }},
          "weight": 0.6
        }
      ],
      "score_mode": "multiply",
      "boost_mode": "multiply"
    }
  }
}
```

Interpretasi:

- active naik;
- pending review sedikit naik;
- superseded turun tetapi tidak hilang;
- deleted tetap difilter.

Ini lebih defensible daripada menghapus semua dokumen non-active, karena historical atau superseded document mungkin tetap relevan untuk audit.

---

## 14. Severity dan Priority Boosting

Dalam regulatory/case management, severity sering penting.

Contoh mapping sederhana:

```json
{
  "severity_rank": 4,
  "priority_score": 0.82
}
```

Daripada boost berdasarkan string `high`, lebih stabil memakai numeric field.

Contoh:

```json
GET cases/_search
{
  "query": {
    "function_score": {
      "query": {
        "match": {
          "summary": "consumer harm"
        }
      },
      "field_value_factor": {
        "field": "severity_rank",
        "factor": 0.2,
        "modifier": "sqrt",
        "missing": 1
      },
      "boost_mode": "multiply"
    }
  }
}
```

Namun hati-hati.

Jika severity terlalu dominan, maka query `consumer harm` bisa selalu didominasi kasus high severity walaupun textual match lemah.

Prinsip:

```text
Severity should reorder close candidates, not rescue irrelevant candidates.
```

Artinya severity idealnya menaikkan dokumen yang sudah cukup relevan, bukan membuat dokumen irrelevant muncul hanya karena severity tinggi.

---

## 15. Freshness + Severity + Authority: Contoh Komposisi Sinyal

Contoh query realistis:

```json
GET cases/_search
{
  "query": {
    "function_score": {
      "query": {
        "bool": {
          "must": [
            {
              "multi_match": {
                "query": "payment fraud",
                "fields": [
                  "case_number.keyword^10",
                  "title^5",
                  "summary^3",
                  "allegations.text^2",
                  "body"
                ],
                "type": "best_fields"
              }
            }
          ],
          "filter": [
            { "term": { "tenant_id": "tenant-a" }},
            { "term": { "visible_to_search": true }},
            { "term": { "is_deleted": false }}
          ]
        }
      },
      "functions": [
        {
          "filter": { "term": { "status": "active" }},
          "weight": 1.3
        },
        {
          "filter": { "range": { "severity_rank": { "gte": 4 }}},
          "weight": 1.2
        },
        {
          "field_value_factor": {
            "field": "authority_score",
            "factor": 0.1,
            "modifier": "log1p",
            "missing": 1
          }
        },
        {
          "gauss": {
            "updated_at": {
              "origin": "now",
              "scale": "60d",
              "offset": "7d",
              "decay": 0.5
            }
          }
        }
      ],
      "score_mode": "multiply",
      "boost_mode": "multiply",
      "max_boost": 5
    }
  },
  "sort": [
    { "_score": "desc" },
    { "updated_at": "desc" },
    { "case_id.keyword": "asc" }
  ]
}
```

Perhatikan beberapa hal:

- permission/visibility ada di filter;
- textual match tetap menjadi candidate generator utama;
- status/severity/freshness/authority adalah ranking preference;
- `max_boost` membatasi ledakan boost;
- sort memiliki tie-breaker stabil.

---

## 16. Exact Identifier Search: Jangan Disamakan Dengan Natural Language Search

Dalam enterprise system, user sering mencari identifier:

- case number;
- document number;
- party ID;
- license number;
- transaction ID;
- reference number;
- email;
- phone;
- account number.

Query `CASE-2026-001` bukan natural language intent. Itu biasanya direct lookup intent.

Pola buruk:

```json
{
  "multi_match": {
    "query": "CASE-2026-001",
    "fields": ["title", "body", "case_number"]
  }
}
```

Pola lebih baik:

```json
{
  "bool": {
    "should": [
      {
        "term": {
          "case_number.keyword": {
            "value": "CASE-2026-001",
            "boost": 50
          }
        }
      },
      {
        "multi_match": {
          "query": "CASE-2026-001",
          "fields": ["title^3", "summary", "body"]
        }
      }
    ],
    "minimum_should_match": 1
  }
}
```

Lebih matang lagi: lakukan query intent parsing di application layer.

```text
If query matches case number pattern:
  run identifier-first query
else:
  run natural language query
```

Identifier match sering harus sangat tinggi karena intent-nya kuat.

---

## 17. Demotion: Menurunkan, Bukan Menghapus

Tidak semua dokumen buruk harus difilter.

Contoh dokumen yang mungkin tetap perlu ditemukan:

- archived;
- superseded;
- low-confidence;
- old version;
- closed case;
- external source;
- OCR poor quality.

Gunakan demotion.

Contoh:

```json
{
  "filter": { "term": { "status": "superseded" }},
  "weight": 0.5
}
```

Demotion berguna ketika:

- dokumen masih valid untuk audit;
- user mungkin memang mencari historical record;
- menghapus dari hasil akan menciptakan blind spot;
- domain butuh traceability.

Dalam regulatory system, demotion sering lebih defensible daripada exclusion.

---

## 18. Negative Signals: Hati-Hati Dengan Penalti

Sinyal negatif bisa berupa:

- low trust;
- stale;
- superseded;
- incomplete;
- duplicate;
- low OCR confidence;
- unofficial source;
- deprecated policy.

Masalahnya: penalti dapat menyembunyikan dokumen penting.

Prinsip:

```text
Penalize weakly unless the signal is a hard disqualifier.
```

Contoh:

- `deleted = true` → filter out;
- `superseded = true` → demote;
- `low_ocr_quality = true` → demote, not remove;
- `confidential = true` and user unauthorized → filter out;
- `old = true` → decay, not remove.

---

## 19. Business Boosting yang Berbahaya

### 19.1 Boost Karena “Product Owner Mau Ini Naik”

Ini sering terjadi.

Contoh:

> “Kalau dokumen dari department X, boost 10x.”

Masalah:

- ranking menjadi politis;
- relevance turun;
- debugging sulit;
- tim lain minta boost sendiri;
- akhirnya semua boost saling meniadakan.

Solusi:

- minta alasan domain yang eksplisit;
- ubah menjadi named signal;
- ukur dampaknya;
- batasi magnitude;
- dokumentasikan.

### 19.2 Boost Dengan Angka Arbitrer

Contoh:

```text
active = 12.7x
high severity = 8.3x
recent = 3.1x
official = 22x
```

Jika angka tidak punya justifikasi, ranking menjadi fragile.

Lebih baik mulai konservatif:

```text
active = 1.2x to 1.5x
high severity = 1.1x to 1.4x
recent = decay moderate
authority = saturating/log scale
```

Lalu evaluasi dengan query set.

### 19.3 Boost yang Mengalahkan Textual Match

Jika dokumen yang tidak membahas query bisa naik karena popularity/severity, scoring Anda rusak.

Rule of thumb:

> Domain signal should mostly break ties among textually plausible candidates.

---

## 20. Designing a Ranking Formula: Step-by-Step

### Step 1 — Definisikan Search Intent Utama

Contoh:

- investigator mencari case aktif;
- public user mencari guidance;
- reviewer mencari document pending approval;
- auditor mencari historical decision;
- operator mencari incident terbaru;
- analyst mencari pattern.

Search intent menentukan sinyal.

### Step 2 — Pisahkan Hard Constraint

Contoh:

```text
tenant_id
permission_scope
visibility
is_deleted
legal_hold_allowed
```

Jangan boost hal yang seharusnya filter.

### Step 3 — Tentukan Candidate Query

Contoh:

```text
title, summary, body, exact id, aliases, parties, allegations
```

Candidate query harus mengutamakan recall yang cukup baik.

### Step 4 — Pilih Domain Signals

Contoh:

```text
active status
severity
freshness
authority
quality
```

Jangan mulai dengan 20 sinyal. Mulai dari 2–4 sinyal yang jelas.

### Step 5 — Normalisasi Sinyal

Contoh:

```text
raw_view_count -> log1p(view_count)
raw_severity string -> severity_rank 1..5
authority enum -> authority_score 0..1
updated_at -> decay function
```

### Step 6 — Tentukan Magnitude

Gunakan boost kecil dulu.

Contoh:

```text
active: 1.3x
high severity: 1.2x
official: 1.1x
freshness: decay up to moderate boost
```

### Step 7 — Tambahkan Explainability

Simpan reasoning di dokumentasi.

Contoh:

```text
active cases get moderate boost because default investigator workflow favors open work items.
high severity gets mild boost because urgency matters but should not override textual relevance.
superseded records are demoted but retained for auditability.
```

### Step 8 — Uji Dengan Query Set

Jangan deploy ranking hanya berdasarkan feeling.

Gunakan:

- query umum;
- query identifier;
- query typo;
- query ambiguous;
- query high-frequency;
- query zero-result;
- query sensitive;
- query audit/historical;
- query multi-tenant.

---

## 21. Ranking Dalam Regulatory / Enforcement Case Management

Karena konteks Anda dekat dengan regulatory systems, mari pakai contoh yang lebih domain-specific.

### 21.1 Entity yang Mungkin Dicari

- case;
- party;
- allegation;
- evidence;
- investigation note;
- decision;
- enforcement action;
- license;
- complaint;
- inspection;
- breach;
- correspondence;
- policy/regulation;
- legal document.

### 21.2 Search Intent

| User | Intent | Ranking Preference |
|---|---|---|
| Investigator | mencari active case terkait entity/allegation | active, assigned, severe, recent |
| Reviewer | mencari item pending decision | pending review, due soon, severity |
| Manager | mencari escalated/high-risk case | severity, SLA, status |
| Auditor | mencari historical trace | exactness, completeness, finality |
| Legal | mencari decision/regulation authoritative | final/official/source authority |
| Public user | mencari public-facing decision/guidance | visibility, clarity, recency, authority |

Ranking tidak boleh sama untuk semua persona.

### 21.3 Sinyal Domain Regulatory

Contoh field:

```json
{
  "case_id": "CASE-2026-001",
  "status": "active",
  "stage": "investigation",
  "severity_rank": 4,
  "public_harm_risk": 0.87,
  "sla_due_at": "2026-07-01T00:00:00Z",
  "is_overdue": false,
  "authority_score": 0.9,
  "decision_finality": "interim",
  "is_superseded": false,
  "confidentiality_level": "internal",
  "permission_groups": ["investigator-east", "manager-national"],
  "updated_at": "2026-06-20T10:00:00Z"
}
```

Possible ranking:

- `permission_groups` → filter;
- `confidentiality_level` → filter;
- `status` → boost/demote;
- `severity_rank` → boost;
- `public_harm_risk` → boost with saturation;
- `sla_due_at` → urgency decay;
- `decision_finality` → authority boost for legal search;
- `is_superseded` → demote;
- `updated_at` → freshness decay.

---

## 22. Persona-Specific Ranking

Satu index bisa melayani beberapa persona, tetapi ranking mungkin perlu berbeda.

Contoh:

```text
Investigator search:
  active + assigned + severity + recent

Auditor search:
  exact match + final records + completeness + historical trace

Legal search:
  official + final decision + regulation hierarchy

Manager search:
  escalated + overdue + high severity
```

Jangan memaksakan satu ranking formula untuk semua user jika intent berbeda.

Namun jangan juga membuat formula liar per endpoint tanpa governance.

Gunakan strategi:

```text
base query builder
+ persona ranking profile
+ explicit search mode
+ tested query set per profile
```

Contoh ranking profile:

```java
public enum SearchRankingProfile {
    INVESTIGATOR_DEFAULT,
    AUDITOR_HISTORICAL,
    LEGAL_AUTHORITY,
    MANAGER_RISK_OVERVIEW,
    PUBLIC_DISCOVERY
}
```

---

## 23. Java Design: Ranking Profile Abstraction

Jangan hardcode scoring langsung di controller.

Pola buruk:

```java
@GetMapping("/search")
public SearchResponse search(String q) {
    // 300 lines of query construction here
}
```

Pola lebih baik:

```java
public interface RankingProfile {
    String name();
    void apply(QueryAssemblyContext context);
}
```

Contoh konseptual:

```java
public final class InvestigatorRankingProfile implements RankingProfile {

    @Override
    public String name() {
        return "investigator-default-v1";
    }

    @Override
    public void apply(QueryAssemblyContext context) {
        context.addStatusBoost("active", 1.3);
        context.addSeverityBoost(4, 1.2);
        context.addFreshnessDecay("updated_at", "now", "60d", "7d", 0.5);
        context.addDemotion("is_superseded", true, 0.6);
    }
}
```

Lebih matang:

```java
public record RankingSignal(
    String name,
    RankingSignalType type,
    double weight,
    String explanation
) {}
```

Tujuannya:

- ranking bisa dibaca;
- ranking bisa dites;
- ranking bisa diberi versi;
- ranking bisa diaudit;
- ranking bisa diubah tanpa membongkar controller.

---

## 24. Versioning Ranking Formula

Ranking formula harus dianggap sebagai bagian dari behavior contract.

Contoh versi:

```text
investigator-default-v1
investigator-default-v2
legal-authority-v1
public-search-v3
```

Kenapa perlu versioning?

- ranking berubah bisa memengaruhi keputusan user;
- A/B test butuh pembanding;
- audit butuh tahu formula saat hasil diberikan;
- regression test butuh baseline;
- rollback harus mudah.

Simpan di log:

```json
{
  "query": "payment fraud",
  "ranking_profile": "investigator-default-v2",
  "user_role": "investigator",
  "timestamp": "2026-06-21T12:00:00Z",
  "top_results": ["CASE-1", "CASE-9", "CASE-3"]
}
```

Untuk regulatory defensibility, ini sangat penting.

---

## 25. Explainability Untuk Domain-Aware Ranking

Elasticsearch punya Explain API untuk melihat mengapa dokumen match dan bagaimana score dihitung. Namun raw explanation sering terlalu teknis untuk product/audit audience.

Anda perlu dua lapisan explainability:

### 25.1 Technical Explanation

Untuk engineer:

```text
Matched title field with BM25 score 6.2.
Active status multiplier 1.3.
Severity high multiplier 1.2.
Freshness decay 0.91.
Final score 8.8.
```

### 25.2 Domain Explanation

Untuk user/auditor:

```text
This case appears high because it matches the query in the title and summary, is currently active, has high severity, and was updated recently.
```

Jangan expose semua detail scoring mentah ke end-user kecuali memang dibutuhkan. Tapi sistem internal harus bisa menjelaskan.

---

## 26. Logging Ranking Signals

Untuk debugging, log minimal:

```json
{
  "query_id": "q-123",
  "query_text": "payment fraud",
  "ranking_profile": "investigator-default-v1",
  "filters": {
    "tenant_id": "tenant-a",
    "visibility": ["internal"]
  },
  "signals_enabled": [
    "status_boost",
    "severity_boost",
    "freshness_decay",
    "authority_factor"
  ],
  "top_k": [
    {
      "id": "CASE-1",
      "score": 9.12,
      "status": "active",
      "severity_rank": 5,
      "updated_at": "2026-06-20T10:00:00Z"
    }
  ]
}
```

Hindari logging sensitive fields. Untuk query text, pertimbangkan masking jika bisa mengandung PII.

---

## 27. Testing Domain-Aware Ranking

Ranking tidak bisa diuji hanya dengan unit test biasa. Tapi unit test tetap berguna untuk query assembly.

### 27.1 Unit Test Query Builder

Pastikan:

- permission selalu masuk filter;
- deleted selalu difilter;
- ranking profile benar;
- field boost benar;
- sort tie-breaker ada;
- query tidak memakai wildcard liar.

### 27.2 Golden Query Test

Buat dataset kecil dan query set.

Contoh:

```text
Query: payment fraud
Expected top result: active high-severity payment fraud case
Should not appear: deleted case, unauthorized case
Should be demoted: superseded case
```

### 27.3 Regression Test

Sebelum mengubah ranking:

- jalankan query set;
- bandingkan top 10;
- tandai perubahan besar;
- review apakah perubahan diinginkan.

### 27.4 Human Judgment

Untuk relevance, judgment manusia tetap penting.

Label sederhana:

```text
0 = irrelevant
1 = somewhat relevant
2 = relevant
3 = highly relevant
```

Part 032 nanti akan membahas evaluasi relevance lebih formal.

---

## 28. Search Ranking Anti-Patterns

### 28.1 “Boost Everything”

Jika semua field dan semua sinyal diberi boost, tidak ada sinyal yang benar-benar berarti.

### 28.2 “One Query to Rule Them All”

Satu query untuk semua persona, semua entity, semua intent, semua UI biasanya menjadi terlalu kompleks.

### 28.3 “Business Sort Masquerading as Search”

Jika ranking sepenuhnya berdasarkan priority/severity, jangan menyebutnya relevance search. Itu task queue atau dashboard sort.

### 28.4 “Script Score First”

Langsung memakai script score untuk semua ranking membuat sistem lambat dan sulit dipelihara.

### 28.5 “Popularity Bias Without Freshness Control”

Dokumen populer lama akan terus menang.

### 28.6 “Freshness Bias Without Authority Control”

Dokumen baru yang tidak authoritative bisa mengalahkan dokumen resmi.

### 28.7 “Permission as Boost”

Fatal. Permission adalah filter, bukan boost.

### 28.8 “No Ranking Version”

Ketika hasil berubah, tidak ada yang tahu kenapa.

---

## 29. Practical Heuristics Untuk Top-Tier Engineer

### 29.1 Default Ranking Formula Awal

Untuk banyak enterprise search:

```text
final ranking = lexical relevance
              × moderate lifecycle boost/demotion
              × moderate freshness decay
              × mild authority/quality boost
```

Jangan mulai dengan formula terlalu kompleks.

### 29.2 Boost Magnitude Awal

Gunakan angka kecil dulu:

```text
1.05x = very mild
1.1x  = mild
1.2x  = noticeable
1.5x  = strong
2.0x+ = very strong, needs justification
```

Untuk demotion:

```text
0.9 = very mild demotion
0.7 = noticeable demotion
0.5 = strong demotion
0.2 = near suppression
```

### 29.3 Jangan Percaya Top 1 Query

Ranking harus dilihat dari banyak query.

Satu query bisa terlihat membaik sementara 50 query lain memburuk.

### 29.4 Pisahkan “Findability” dan “Priority”

Search membantu user menemukan informasi. Priority membantu user menentukan urutan kerja.

Kadang keduanya bercampur, tetapi jangan sampai search menjadi task prioritization tanpa sadar.

### 29.5 Ranking Harus Bisa Diceritakan

Jika Anda tidak bisa menjelaskan ranking formula dalam 5 kalimat, formula mungkin terlalu rumit.

---

## 30. Worked Example: Investigator Search

### 30.1 Requirement

User investigator mencari case dengan query natural language.

Requirement:

- hanya case yang user boleh lihat;
- active case sedikit diprioritaskan;
- high severity sedikit diprioritaskan;
- recent update diprioritaskan;
- superseded case masih boleh muncul tapi turun;
- exact case number harus menang jika query berupa case number;
- ranking harus stabil untuk pagination.

### 30.2 Search Document

```json
{
  "case_id": "CASE-2026-001",
  "case_number": "CASE-2026-001",
  "title": "Payment fraud involving merchant accounts",
  "summary": "Investigation into suspected payment fraud and consumer harm.",
  "body": "...",
  "tenant_id": "tenant-a",
  "permission_groups": ["investigator-east"],
  "status": "active",
  "severity_rank": 5,
  "authority_score": 0.8,
  "is_deleted": false,
  "is_superseded": false,
  "updated_at": "2026-06-20T10:00:00Z"
}
```

### 30.3 Query Strategy

Pseudocode:

```text
if looksLikeCaseNumber(q):
    use identifier-first query
else:
    use natural language query

always:
    apply tenant filter
    apply permission filter
    apply deleted filter
    apply ranking profile
    add stable tie-breaker
```

### 30.4 Example Query

```json
GET cases/_search
{
  "size": 20,
  "query": {
    "function_score": {
      "query": {
        "bool": {
          "should": [
            {
              "term": {
                "case_number.keyword": {
                  "value": "payment fraud",
                  "boost": 50
                }
              }
            },
            {
              "multi_match": {
                "query": "payment fraud",
                "fields": [
                  "title^5",
                  "summary^3",
                  "body",
                  "parties.name^2",
                  "allegations.text^2"
                ]
              }
            }
          ],
          "minimum_should_match": 1,
          "filter": [
            { "term": { "tenant_id": "tenant-a" }},
            { "term": { "is_deleted": false }},
            { "terms": { "permission_groups": ["investigator-east", "manager-national"] }}
          ]
        }
      },
      "functions": [
        {
          "filter": { "term": { "status": "active" }},
          "weight": 1.3
        },
        {
          "filter": { "range": { "severity_rank": { "gte": 4 }}},
          "weight": 1.2
        },
        {
          "filter": { "term": { "is_superseded": true }},
          "weight": 0.6
        },
        {
          "field_value_factor": {
            "field": "authority_score",
            "factor": 0.2,
            "modifier": "log1p",
            "missing": 1
          }
        },
        {
          "gauss": {
            "updated_at": {
              "origin": "now",
              "scale": "45d",
              "offset": "5d",
              "decay": 0.5
            }
          }
        }
      ],
      "score_mode": "multiply",
      "boost_mode": "multiply",
      "max_boost": 4
    }
  },
  "sort": [
    { "_score": "desc" },
    { "updated_at": "desc" },
    { "case_id.keyword": "asc" }
  ]
}
```

### 30.5 Review

Yang benar:

- permission difilter;
- deleted difilter;
- active/severity/freshness adalah boost;
- superseded didemote;
- exact ID path ada;
- tie-breaker stabil.

Yang masih perlu diuji:

- apakah severity terlalu kuat;
- apakah freshness mengalahkan authority;
- apakah superseded masih bisa ditemukan saat query sangat spesifik;
- apakah permission filter benar untuk semua role;
- apakah `terms` permission model scalable untuk cardinality besar;
- apakah top result sesuai judgment investigator.

---

## 31. Operational Guardrails

### 31.1 Batasi Expensive Scoring

- Jangan jalankan script_score pada candidate set besar.
- Filter dulu.
- Gunakan primitive function jika cukup.
- Pertimbangkan rescore untuk top-N.

### 31.2 Batasi Boost Explosion

Gunakan:

```json
"max_boost": 4
```

atau desain formula agar multiplier tidak terlalu banyak.

### 31.3 Jangan Membuat Ranking Tergantung Field Tidak Stabil

Contoh field berisiko:

- live view count yang update terus;
- rapidly changing SLA score;
- temporary feature flag;
- incomplete enrichment score.

Jika ranking berubah terlalu sering, user kehilangan kepercayaan.

### 31.4 Monitor Ranking Drift

Pantau:

- top query result changes;
- zero-result rate;
- click-through / selection rate;
- reformulation rate;
- average rank clicked;
- complaint/report relevance;
- top-N churn after deployment.

---

## 32. Checklist Design Domain-Aware Ranking

Sebelum deploy ranking formula, jawab:

```text
[ ] Apa search intent utama?
[ ] Apa hard filter yang tidak boleh menjadi boost?
[ ] Apa candidate query utama?
[ ] Apa 2–4 domain signal paling defensible?
[ ] Apakah sinyal numeric sudah dinormalisasi?
[ ] Apakah boost magnitude masuk akal?
[ ] Apakah ada demotion untuk dokumen yang masih perlu ditemukan?
[ ] Apakah permission/tenant/deleted aman?
[ ] Apakah exact identifier intent ditangani?
[ ] Apakah tie-breaker stabil?
[ ] Apakah ranking profile diberi versi?
[ ] Apakah query bisa dijelaskan?
[ ] Apakah ada golden query test?
[ ] Apakah ada observability/logging?
[ ] Apakah ada rollback strategy?
```

---

## 33. Mental Model Final

Domain-aware ranking bukan tentang “menambahkan boost sampai hasil terlihat bagus”.

Domain-aware ranking adalah proses engineering untuk menggabungkan:

```text
what the user typed
+ what the document says
+ what the domain considers important
+ what the user is allowed to see
+ what the system can explain and operate safely
```

Top-tier engineer tidak hanya bertanya:

> “Query DSL apa yang harus saya pakai?”

Tetapi:

> “Sinyal mana yang harus menjadi candidate constraint, ranking preference, demotion, sort, atau post-processing rule?”

Dan lebih jauh:

> “Bisakah ranking ini dijelaskan, diuji, diaudit, dan diperbaiki tanpa merusak sistem?”

Jika jawabannya ya, Anda bukan hanya menggunakan Elasticsearch. Anda sedang membangun retrieval system yang matang.

---

## 34. Ringkasan

Di part ini kita membahas:

- perbedaan lexical, domain, dan operational relevance;
- filter vs boost vs sort;
- function_score;
- field_value_factor;
- decay function;
- script_score;
- rank_feature/rank_features;
- lifecycle/status boosting;
- severity, freshness, authority, quality;
- exact identifier search;
- demotion;
- persona-specific ranking;
- ranking profile abstraction di Java;
- versioning ranking formula;
- explainability dan logging;
- testing domain-aware ranking;
- anti-pattern ranking;
- regulatory/case-management relevance model.

Part berikutnya akan masuk ke:

> **Part 012 — Filtering, Faceting, and Aggregations for Search UX**

Kita akan membahas bagaimana filter dan facet membentuk search experience, bagaimana aggregation dihitung, kenapa count bisa membingungkan user, dan bagaimana membedakan search page dari analytics dashboard.

---

## 35. Referensi Resmi dan Bacaan Lanjutan

- Elastic Documentation — Function score query
- Elastic Documentation — Field value factor
- Elastic Documentation — Script score query
- Elastic Documentation — Rank feature query
- Elastic Documentation — Rank feature field type
- Elastic Documentation — Rank features field type
- Elastic Documentation — Explain API
- Elastic Documentation — Painless score context
- Elastic Documentation — Search API


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — Relevance Engineering I: Scoring, Ranking, and BM25</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-012.md">Part 012 — Filtering, Faceting, and Aggregations for Search UX ➡️</a>
</div>
