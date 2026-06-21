# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-018

# Part 018 — Highlighting, Suggestions, Autocomplete, and Spell Correction

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami Elasticsearch sebagai search/retrieval platform production-grade  
> Fokus part ini: bagaimana membangun fitur bantu pencarian seperti highlight, autocomplete, suggest, typo tolerance, dan spell correction tanpa merusak relevance, latency, atau konsistensi search utama.

---

## 0. Posisi Part Ini Dalam Seri

Sampai part sebelumnya, kita sudah membangun fondasi besar:

- Part 000–002: mental model search dan information retrieval.
- Part 003–004: Lucene dan arsitektur Elasticsearch.
- Part 005–007: document modeling, mapping, dan text analysis.
- Part 008–009: Query DSL dan full-text query pattern.
- Part 010–011: relevance engineering.
- Part 012–013: filtering, faceting, pagination, sorting.
- Part 014–015: ingestion, freshness, consistency.
- Part 016–017: Java integration dan search API design.

Part ini membahas fitur-fitur yang biasanya terlihat sebagai “polish UX”, tetapi dalam production sering menjadi sumber bug, performa buruk, dan relevance drift:

- Highlighting.
- Suggestions.
- Autocomplete.
- Search-as-you-type.
- Fuzzy/typo tolerance.
- Spell correction.
- Did-you-mean.
- Query assistance.

Mental model penting:

> Search utama menjawab: “dokumen apa yang paling relevan?”  
> Suggestion/autocomplete menjawab: “query atau pilihan apa yang mungkin user maksud?”  
> Highlight menjawab: “bagian mana dari dokumen yang menjelaskan kenapa hasil ini muncul?”

Ketiganya berhubungan, tetapi tidak boleh dicampur secara sembarangan.

---

## 1. Problem Yang Sedang Kita Pecahkan

Ketika user memakai search UI, mereka jarang datang dengan query ideal.

Mereka bisa:

- Mengetik sebagian kata.
- Salah eja.
- Menggunakan istilah internal yang berbeda.
- Mengetik kode kasus sebagian.
- Mengetik nama orang tidak lengkap.
- Mengetik frasa panjang.
- Tidak tahu field mana yang dicari.
- Mengharapkan hasil muncul bahkan sebelum query lengkap.
- Ingin tahu kenapa dokumen muncul.

Backend search API perlu membantu user melalui beberapa mekanisme:

```text
User intent
   |
   |-- type partial input ---------------> autocomplete/search-as-you-type
   |-- submit malformed input -----------> typo tolerance/fuzzy/spell correction
   |-- receive result -------------------> highlighting/snippet
   |-- get no result --------------------> did-you-mean, relaxed query, related filters
   |-- choose suggestion ----------------> normal search endpoint
```

Kalau fitur ini dirancang buruk:

- Autocomplete menampilkan opsi yang tidak bisa ditemukan saat search final.
- Highlight menyorot kata yang membingungkan atau tidak sesuai ranking.
- Fuzzy query membuat hasil terlalu longgar dan tidak relevan.
- Spell correction mengganti istilah legal/regulatory yang sebenarnya valid.
- N-gram membuat index membengkak.
- Completion suggester cepat tetapi tidak mengikuti permission/facet/search behavior.
- Query suggestion menjadi kebocoran data lintas tenant.

Untuk engineer senior, fitur ini bukan sekadar “aktifkan suggest”. Ini adalah desain retrieval assistance.

---

## 2. Tiga Kategori Fitur Bantu Search

Kita mulai dengan klasifikasi agar tidak mencampur konsep.

### 2.1 Result Explanation Aid

Fitur ini membantu user memahami hasil.

Contoh:

- Highlight.
- Snippet.
- Matched field label.
- “Matched in: title, party name, allegation summary”.

Tujuannya bukan mencari hasil baru, tetapi menjelaskan hasil yang sudah dipilih oleh query utama.

### 2.2 Query Formation Aid

Fitur ini membantu user membentuk query sebelum submit.

Contoh:

- Autocomplete.
- Search-as-you-type.
- Completion suggestion.
- Recent searches.
- Popular queries.
- Entity suggestion.

Tujuannya mempercepat input dan mengarahkan user.

### 2.3 Query Repair Aid

Fitur ini membantu ketika query user salah, terlalu sempit, atau menghasilkan no/low result.

Contoh:

- Spell correction.
- Did-you-mean.
- Fuzzy matching.
- Relaxed query fallback.
- Synonym expansion.
- Alternative query.

Tujuannya memperbaiki query, bukan sekadar memperbanyak result.

---

## 3. Highlighting: Snippet Sebagai Bukti Relevance

Highlighting adalah mekanisme untuk menampilkan potongan teks yang cocok dengan query.

Contoh UI:

```text
Case: Enforcement Notice Against PT Example Finance
Snippet: ... repeated failure to submit <em>AML report</em> within the statutory deadline ...
Matched fields: title, allegation_summary
```

Highlight penting karena user bertanya secara implisit:

> “Kenapa hasil ini muncul?”

Tanpa highlight, search result bisa terasa opaque.

---

## 4. Highlight Bukan Ranking

Kesalahan umum:

> “Kalau highlight cocok, berarti ranking benar.”

Tidak selalu.

Highlight hanya menunjukkan token/frasa yang match. Ranking ditentukan oleh kombinasi:

- Query type.
- Field scoring.
- BM25.
- Boost.
- Filter.
- Function score.
- Business signal.
- Rescore.
- Tie-breaker.

Highlight bisa cocok tetapi dokumen tetap tidak paling relevan.

Contoh:

```text
Query: "late filing"

Document A:
  title: "Late Filing Penalty"
  summary: "Guidance on repeated late filing by regulated entities"

Document B:
  body: "The report was not late. The filing was completed early."
```

Keduanya bisa meng-highlight `late` dan `filing`, tetapi Document A jelas lebih relevan.

Highlight adalah evidence layer, bukan scoring layer.

---

## 5. Jenis Highlighter di Elasticsearch

Elasticsearch menyediakan beberapa highlighter. Yang penting dipahami secara konseptual:

### 5.1 Unified Highlighter

Biasanya default modern dan cocok untuk banyak use case full-text.

Cocok untuk:

- Field text biasa.
- Snippet natural.
- Highlight berbasis query yang cukup kompleks.

### 5.2 Plain Highlighter

Lebih sederhana. Bisa berguna untuk case tertentu, tetapi biasanya bukan pilihan utama production modern.

### 5.3 Fast Vector Highlighter

Membutuhkan konfigurasi mapping tertentu seperti `term_vector`.

Cocok ketika:

- Field besar.
- Highlight sangat sering.
- Performa highlight menjadi bottleneck.
- Anda siap membayar overhead index size.

Trade-off:

- Lebih cepat untuk skenario tertentu.
- Index lebih besar.
- Mapping harus dirancang dari awal.

---

## 6. Basic Highlight Request

Contoh sederhana:

```json
GET cases/_search
{
  "query": {
    "match": {
      "summary": "late filing"
    }
  },
  "highlight": {
    "fields": {
      "summary": {}
    }
  }
}
```

Respons biasanya punya bagian `highlight`:

```json
{
  "hits": {
    "hits": [
      {
        "_source": {
          "case_id": "CASE-2026-001",
          "summary": "The entity failed to submit late filing disclosures."
        },
        "highlight": {
          "summary": [
            "The entity failed to submit <em>late</em> <em>filing</em> disclosures."
          ]
        }
      }
    ]
  }
}
```

---

## 7. Highlight Tags

Default tag biasanya `<em>...</em>`. Dalam API backend, Anda bisa mengubah tag.

```json
GET cases/_search
{
  "query": {
    "match": {
      "summary": "late filing"
    }
  },
  "highlight": {
    "pre_tags": ["<mark>"],
    "post_tags": ["</mark>"],
    "fields": {
      "summary": {}
    }
  }
}
```

Namun backend engineer perlu berhati-hati:

- Jangan langsung render highlight HTML tanpa sanitization policy.
- Pastikan frontend memahami bahwa highlight fragment mengandung markup.
- Jangan masukkan user-generated HTML mentah ke snippet.
- Pertimbangkan format aman seperti structured highlight spans jika security requirement tinggi.

Alternatif structured response:

```json
{
  "field": "summary",
  "fragments": [
    {
      "text": "The entity failed to submit late filing disclosures.",
      "matches": [
        { "start": 28, "end": 32 },
        { "start": 33, "end": 39 }
      ]
    }
  ]
}
```

Elasticsearch tidak otomatis memberikan format seperti ini untuk semua case; ini bisa menjadi transformasi application layer bila diperlukan untuk sistem sensitif.

---

## 8. Fragment Size dan Number of Fragments

Untuk field panjang, Anda tidak ingin mengirim seluruh isi dokumen.

```json
GET cases/_search
{
  "query": {
    "match": {
      "body": "sanction deadline"
    }
  },
  "highlight": {
    "fields": {
      "body": {
        "fragment_size": 160,
        "number_of_fragments": 3
      }
    }
  }
}
```

Design consideration:

| Parameter | Dampak |
|---|---|
| `fragment_size` kecil | snippet pendek, cepat dibaca, bisa kehilangan konteks |
| `fragment_size` besar | lebih banyak konteks, payload lebih besar |
| `number_of_fragments` kecil | ringkas |
| `number_of_fragments` besar | membantu dokumen panjang, tetapi payload dan noise naik |

Untuk case management search, biasanya:

- Title: tidak perlu fragment.
- Summary: 1–2 fragment.
- Body/evidence text: 2–5 fragment.
- Attachment OCR: hati-hati, bisa sangat besar.

---

## 9. Highlight Multi-Field Result

Search sering dilakukan di banyak field.

Contoh:

```json
GET cases/_search
{
  "query": {
    "multi_match": {
      "query": "aml suspicious transaction",
      "fields": [
        "title^4",
        "party_names^3",
        "allegation_summary^2",
        "body"
      ]
    }
  },
  "highlight": {
    "fields": {
      "title": {},
      "party_names": {},
      "allegation_summary": {},
      "body": {
        "fragment_size": 180,
        "number_of_fragments": 2
      }
    }
  }
}
```

Application response sebaiknya tidak hanya mengembalikan raw highlight. Tambahkan metadata:

```json
{
  "caseId": "CASE-2026-001",
  "title": "AML Investigation Against PT Example",
  "matchedFields": ["title", "allegation_summary"],
  "highlights": [
    {
      "field": "title",
      "label": "Case title",
      "fragments": ["<em>AML</em> Investigation Against PT Example"]
    },
    {
      "field": "allegation_summary",
      "label": "Allegation summary",
      "fragments": ["... suspicious transaction reporting failure ..."]
    }
  ]
}
```

Kenapa label penting?

Karena user business tidak selalu tahu nama field internal seperti `allegation_summary` atau `party_names.normalized`.

---

## 10. Highlight dan `_source`

Highlight biasanya membutuhkan teks asli atau akses ke field content.

Beberapa implikasi:

- Kalau `_source` besar, search response bisa berat.
- Anda bisa menggunakan source filtering.
- Anda bisa hanya mengambil field penting untuk result card.
- Jangan selalu return body besar hanya karena butuh highlight.

Contoh source filtering:

```json
GET cases/_search
{
  "_source": [
    "case_id",
    "title",
    "status",
    "opened_at",
    "party_names"
  ],
  "query": {
    "match": {
      "body": "late filing"
    }
  },
  "highlight": {
    "fields": {
      "body": {
        "fragment_size": 160,
        "number_of_fragments": 2
      }
    }
  }
}
```

Pattern:

```text
Result card source fields != all searchable fields
```

Search document boleh menyimpan field besar untuk retrieval, tetapi API result card harus dikendalikan.

---

## 11. Highlight Failure Modes

### 11.1 Highlight Tidak Muncul Padahal Dokumen Match

Kemungkinan:

- Query match di field lain.
- Highlight tidak dikonfigurasi untuk field tersebut.
- Analyzer membuat token berbeda.
- Query terlalu kompleks.
- Field tidak tersedia untuk highlighter tertentu.
- Matched term berasal dari synonym atau expansion yang tidak jelas terlihat di teks asli.

### 11.2 Highlight Terlalu Banyak

Penyebab:

- Query terlalu broad.
- Banyak token umum.
- Stopword tidak dikelola.
- Fragment terlalu banyak.
- Multi-field highlight semua field.

### 11.3 Highlight Membingungkan

Contoh query:

```text
not late filing
```

Dokumen:

```text
The entity was not late in filing.
```

Highlight mungkin menyorot `late` dan `filing`, tetapi semantic meaning berbeda.

Highlight tidak menggantikan semantic understanding.

### 11.4 Highlight Bocor Field Sensitif

Jika field searchable tetapi tidak boleh ditampilkan, highlight bisa membocorkan data.

Contoh:

- Internal investigation note.
- Whistleblower identity.
- Confidential evidence summary.
- Privileged legal memo.

Aturan:

> Field yang boleh dicari belum tentu boleh ditampilkan sebagai highlight.

Dalam sistem regulatory/case management, ini sangat penting.

---

## 12. Highlight Design Checklist

Untuk setiap field searchable, tentukan:

```text
Field: allegation_summary
- Searchable? yes
- Return in _source? yes
- Highlightable? yes
- Max fragments? 2
- Max fragment size? 180
- Requires redaction? maybe
- Requires permission? yes
- UI label: Allegation summary
```

Contoh matrix:

| Field | Searchable | Displayed | Highlighted | Notes |
|---|---:|---:|---:|---|
| `title` | yes | yes | yes | full value ok |
| `case_number` | yes | yes | yes | exact identifier |
| `party_names` | yes | yes | yes | consider privacy |
| `allegation_summary` | yes | yes | yes | fragment only |
| `internal_notes` | yes | no/maybe | no/maybe | sensitive |
| `evidence_ocr` | yes | no | controlled snippet | heavy + sensitive |
| `permission_tokens` | yes/filter | no | no | never expose |

---

## 13. Suggestion and Autocomplete: Do Not Confuse The Concepts

Autocomplete and suggestion are often used interchangeably, but production design needs sharper separation.

### 13.1 Autocomplete

User types partial input, system predicts completion.

Example:

```text
User: "anti mon"
Suggestion: "anti money laundering"
```

### 13.2 Entity Suggestion

User types partial input, system suggests entities.

Example:

```text
User: "PT Exa"
Suggestion: "PT Example Finance"
Type: Regulated entity
```

### 13.3 Query Suggestion

System suggests common/past query.

Example:

```text
"late filing penalty"
"aml reporting failure"
"fit and proper test"
```

### 13.4 Spell Suggestion

System suggests correction.

Example:

```text
User: "mony laundring"
Did you mean: "money laundering"
```

### 13.5 Related Search Suggestion

System suggests adjacent query.

Example:

```text
Related: "suspicious transaction report", "customer due diligence", "beneficial owner"
```

Each category needs different data source, latency budget, ranking logic, and permission model.

---

## 14. Autocomplete Strategy Landscape

Common Elasticsearch strategies:

1. Completion suggester.
2. `search_as_you_type` field.
3. Edge n-gram indexed field.
4. Prefix query on keyword/text subfield.
5. Dedicated suggestion index.
6. Application-level popular query store.

There is no universally best option.

---

## 15. Completion Suggester

The completion suggester is designed for fast navigational autocomplete.

Conceptually:

```text
Input prefixes -> finite-state suggestion structure -> ranked suggestions
```

It is suitable when you want to suggest known terms/entities quickly.

Example use cases:

- Product names.
- Case numbers.
- Entity names.
- Known legal/regulatory terms.
- Navigation search.

Mapping example:

```json
PUT case_suggestions
{
  "mappings": {
    "properties": {
      "suggest": {
        "type": "completion"
      },
      "suggestion_type": {
        "type": "keyword"
      },
      "entity_id": {
        "type": "keyword"
      },
      "tenant_id": {
        "type": "keyword"
      }
    }
  }
}
```

Index example:

```json
POST case_suggestions/_doc/CASE-2026-001
{
  "suggest": {
    "input": [
      "CASE-2026-001",
      "PT Example Finance",
      "AML Investigation PT Example Finance"
    ],
    "weight": 50
  },
  "suggestion_type": "case",
  "entity_id": "CASE-2026-001",
  "tenant_id": "tenant-a"
}
```

Query:

```json
GET case_suggestions/_search
{
  "suggest": {
    "case-suggest": {
      "prefix": "pt ex",
      "completion": {
        "field": "suggest",
        "size": 5
      }
    }
  }
}
```

---

## 16. Completion Suggester Strengths

Strengths:

- Fast for prefix-style suggestion.
- Supports weighted suggestions.
- Good for known labels/entities.
- Good for “navigate to known thing” UX.
- Can support fuzzy suggestion.

Example:

```json
GET case_suggestions/_search
{
  "suggest": {
    "case-suggest": {
      "prefix": "exampel",
      "completion": {
        "field": "suggest",
        "fuzzy": {
          "fuzziness": 1
        },
        "size": 5
      }
    }
  }
}
```

---

## 17. Completion Suggester Limitations

Completion suggester is not the same as general search.

Limitations/traps:

- It is for suggestion, not final search result ranking.
- Permission filtering can be non-trivial depending on design.
- It can drift from main search index if maintained separately.
- It may not support all query semantics expected by final search.
- It can leak existence of restricted entities if not isolated/filtered.
- It is not ideal for arbitrary infix matching unless modeled accordingly.

Bad UX:

```text
Autocomplete shows: "Confidential Investigation X"
User clicks it.
Final search says: no access / no result.
```

This is not just annoying; in regulated systems it can be a data leakage incident.

---

## 18. Context-Aware Completion

For multi-tenant or categorized suggestion, context-aware completion can be useful.

Conceptually:

```text
suggestion = input + context filters
```

Possible contexts:

- Tenant.
- Region.
- Case type.
- User group.
- Language.
- Visibility class.

Example mental model:

```text
User A in tenant-x types "PT Ex"
  -> only suggestions visible to tenant-x and user's access domain
```

In application design, you may also choose stronger isolation:

- Separate suggestion index per tenant.
- Separate routing by tenant.
- Include permission tokens in suggestion docs.
- Build suggestions from already-authorized result set.

The right choice depends on sensitivity and scale.

---

## 19. `search_as_you_type` Field

Elasticsearch has a `search_as_you_type` field type optimized for as-you-type completion use cases. It creates subfields that support matching partial input more efficiently than naïve wildcard patterns.

Mapping:

```json
PUT cases
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

Query pattern:

```json
GET cases/_search
{
  "query": {
    "multi_match": {
      "query": "late fil",
      "type": "bool_prefix",
      "fields": [
        "title",
        "title._2gram",
        "title._3gram"
      ]
    }
  }
}
```

Use it when:

- You want as-you-type over document fields.
- You want suggestions/results that resemble main search docs.
- You want prefix/infix-ish behavior without building a separate suggestion system.

Trade-off:

- More index fields.
- Larger index than plain text.
- Not always as fast/specialized as completion suggester.
- Needs thoughtful query design.

---

## 20. Edge N-Gram Autocomplete

Edge n-gram indexes token prefixes.

Example token:

```text
"filing" -> "f", "fi", "fil", "fili", "filin", "filing"
```

Usually you do not want one-character tokens in production because they are too broad. A more realistic setup might use min 2 or 3.

Example mapping:

```json
PUT cases
{
  "settings": {
    "analysis": {
      "filter": {
        "autocomplete_filter": {
          "type": "edge_ngram",
          "min_gram": 2,
          "max_gram": 20
        }
      },
      "analyzer": {
        "autocomplete_index": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": [
            "lowercase",
            "autocomplete_filter"
          ]
        },
        "autocomplete_search": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": [
            "lowercase"
          ]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "fields": {
          "autocomplete": {
            "type": "text",
            "analyzer": "autocomplete_index",
            "search_analyzer": "autocomplete_search"
          }
        }
      }
    }
  }
}
```

Query:

```json
GET cases/_search
{
  "query": {
    "match": {
      "title.autocomplete": "late fil"
    }
  }
}
```

Important:

> Index-time analyzer expands tokens. Search-time analyzer should usually not expand the query the same way, otherwise scoring/noise can become poor.

---

## 21. Edge N-Gram Strengths and Weaknesses

Strengths:

- Flexible.
- Works with normal search queries.
- Can support multi-word prefix matching.
- Easy to combine with filters and permissions.
- Good for field-specific autocomplete.

Weaknesses:

- Index size increases.
- Too-small `min_gram` creates huge noise.
- Too-large `max_gram` wastes storage.
- Scoring can be unintuitive.
- Can match too broadly.
- Not always ideal for high-QPS global suggestion.

Bad configuration:

```json
{
  "min_gram": 1,
  "max_gram": 50
}
```

Why bad?

- One-character terms are extremely common.
- Posting lists become large.
- Many irrelevant matches.
- Index bloats.
- Query latency increases.

Better starting point:

```json
{
  "min_gram": 2,
  "max_gram": 20
}
```

But actual values must be validated using domain data.

---

## 22. N-Gram vs Edge N-Gram

N-gram can match substrings anywhere.

Example:

```text
"filing" -> "fi", "il", "li", "in", "ng", "fil", "ili", ...
```

Edge n-gram matches token prefixes.

```text
"filing" -> "fi", "fil", "fili", ...
```

Comparison:

| Technique | Matches | Index cost | Noise risk | Use case |
|---|---|---:|---:|---|
| edge n-gram | beginning of token | medium | medium | autocomplete |
| n-gram | anywhere in token | high | high | partial identifier, special substring search |
| wildcard | pattern runtime | can be high | high | limited admin/debug use |
| search_as_you_type | optimized as-you-type | medium | medium | document field typeahead |
| completion suggester | prefix suggestion | specialized | lower if modeled well | navigational suggestions |

Use n-gram carefully. It is tempting but often expensive.

---

## 23. Prefix Query, Wildcard Query, and Regexp Query

These can be useful, but they are commonly abused.

### 23.1 Prefix Query

```json
GET cases/_search
{
  "query": {
    "prefix": {
      "case_number.keyword": "CASE-2026"
    }
  }
}
```

Good for:

- Structured identifiers.
- Keyword fields.
- Controlled prefix search.

Risk:

- Very broad prefixes can be expensive.

### 23.2 Wildcard Query

```json
GET cases/_search
{
  "query": {
    "wildcard": {
      "party_name.keyword": "*finance*"
    }
  }
}
```

Dangerous when:

- Leading wildcard: `*finance`.
- High-cardinality field.
- Large index.
- User can submit arbitrary wildcard.

### 23.3 Regexp Query

Usually should be restricted to admin/internal use cases.

Bad public API idea:

```json
{
  "regexp": {
    "body": ".*aml.*report.*"
  }
}
```

This is not a normal user search feature. It is an expensive pattern matching feature.

---

## 24. Autocomplete Architecture Options

### Option A — Same Search Index, Extra Autocomplete Fields

```text
cases index
  title
  title.autocomplete
  party_names
  party_names.autocomplete
```

Pros:

- Easier permission filtering.
- Same documents as search result.
- Less synchronization overhead.

Cons:

- Main index gets larger.
- Suggestion traffic hits same index.
- Different latency profile mixed together.

Good for:

- Moderate traffic.
- Document-oriented typeahead.
- Permission-sensitive search.

### Option B — Dedicated Suggestion Index

```text
cases index
case_suggestions index
```

Pros:

- Small documents.
- Faster suggestion retrieval.
- Different lifecycle and ranking.
- Can include popular queries/entities.

Cons:

- Synchronization drift.
- Permission model harder.
- More operational moving parts.

Good for:

- High-QPS autocomplete.
- Navigational suggestions.
- Popular query suggestions.

### Option C — Hybrid

```text
case_suggestions index -> entity/query suggestion
cases index            -> final search-as-you-type result preview
```

This is often best for enterprise systems.

UI behavior:

```text
User types "aml"
  -> show query suggestions: "aml reporting failure", "aml inspection"
  -> show entity suggestions: "AML Division", "PT Example Finance"
  -> on submit: call normal /search endpoint
```

---

## 25. Designing Autocomplete Response Contract

Do not return raw Elasticsearch suggest response to frontend.

Better:

```json
{
  "query": "pt ex",
  "suggestions": [
    {
      "type": "case",
      "label": "CASE-2026-001 — PT Example Finance AML Investigation",
      "value": "PT Example Finance",
      "entityId": "CASE-2026-001",
      "action": "OPEN_ENTITY",
      "score": 50
    },
    {
      "type": "query",
      "label": "Search for: pt example finance",
      "value": "pt example finance",
      "action": "SEARCH_QUERY"
    }
  ]
}
```

Why?

Because frontend needs semantic actions:

- Open entity.
- Run query.
- Apply filter.
- Navigate to case.
- Show recent query.

Autocomplete is not just text completion; it is an interaction contract.

---

## 26. Suggestion Ranking

Suggestion ranking should not blindly reuse BM25.

Useful signals:

- Prefix closeness.
- Exact prefix match.
- Entity importance.
- User’s recent activity.
- Popularity.
- Recency.
- Permission/access relevance.
- Domain priority.
- Case status.
- Frequency of successful selection.

Example ranking tiers:

```text
Tier 1: exact identifier match
Tier 2: entity name prefix match
Tier 3: recent user-accessed entity
Tier 4: popular query suggestion
Tier 5: fuzzy fallback
```

For case management:

```text
User input: "CASE-2026-12"
  -> exact case number prefix should outrank body text matches.

User input: "PT Example"
  -> regulated entity suggestion may outrank generic text query suggestion.
```

---

## 27. Spell Correction: Term and Phrase Suggesters

Spell correction is query repair.

Elasticsearch has term and phrase suggesters.

### 27.1 Term Suggester

Suggests corrections per term.

Example:

```json
GET cases/_search
{
  "suggest": {
    "term-suggestion": {
      "text": "mony laundring",
      "term": {
        "field": "body"
      }
    }
  }
}
```

Conceptually:

```text
mony     -> money
laundring -> laundering
```

### 27.2 Phrase Suggester

Suggests phrase-level corrections.

Example:

```json
GET cases/_search
{
  "suggest": {
    "did-you-mean": {
      "text": "mony laundring report",
      "phrase": {
        "field": "body.trigram"
      }
    }
  }
}
```

Phrase-level correction is more useful when word sequence matters.

---

## 28. Spell Correction Is Dangerous In Domain Search

In domain-heavy systems, many “misspellings” are valid terms.

Examples:

```text
AML
KYC
CDD
STR
SAR
OJK
MiFID
Basel
prudential
fit-and-proper
beneficial owner
```

A generic spell correction model may “correct” domain terminology incorrectly.

Bad behavior:

```text
User query: "SAR filing"
Did you mean: "car filing"?
```

Or:

```text
User query: "OJK sanction"
Did you mean: "oak sanction"?
```

Therefore spell correction needs:

- Domain vocabulary.
- Stoplist of protected terms.
- Acronym dictionary.
- Case number pattern recognition.
- Language awareness.
- Confidence threshold.

Rule:

> In expert systems, prefer “suggest correction” over “silently rewrite query”.

---

## 29. Fuzzy Search

Fuzzy query matches terms similar to the search term using edit distance.

Example:

```json
GET cases/_search
{
  "query": {
    "fuzzy": {
      "party_name.keyword": {
        "value": "exampel",
        "fuzziness": 1
      }
    }
  }
}
```

But fuzzy query on analyzed text often needs careful handling.

A more common pattern:

```json
GET cases/_search
{
  "query": {
    "match": {
      "party_names": {
        "query": "exampel finance",
        "fuzziness": "AUTO"
      }
    }
  }
}
```

Fuzzy can help for:

- Typo tolerance.
- Names.
- Product/entity labels.
- Low-stakes query expansion.

Fuzzy can hurt for:

- Short tokens.
- Codes/identifiers.
- Acronyms.
- Legal terms.
- High-volume broad fields.
- Security-sensitive search.

---

## 30. Fuzziness and Edit Distance

Fuzzy matching often uses edit distance.

Example:

```text
exampel -> example
```

One transposition or edit can be tolerated.

But short terms are risky.

```text
AML with fuzziness 1
```

Can match many unrelated short terms depending on corpus.

Guideline:

```text
Do not apply fuzziness uniformly to every field and every token.
```

Better:

| Field | Fuzzy? | Reason |
|---|---:|---|
| `party_names` | yes, controlled | names often typoed |
| `title` | maybe | useful with threshold |
| `body` | cautious | can broaden too much |
| `case_number.keyword` | no | exact/prefix better |
| `status` | no | controlled enum |
| `regulation_code` | no | exact domain code |
| `acronym` | no | short term risk |

---

## 31. Fuzzy Query As Fallback, Not Default

Bad design:

```text
Every search query uses fuzziness=AUTO on all fields.
```

Problems:

- More expensive.
- Lower precision.
- Surprising matches.
- Harder explainability.
- Harder regulatory defensibility.

Better design:

```text
Step 1: exact/high precision query
Step 2: if low/no result, try controlled fuzzy fallback
Step 3: show user that fallback was applied
```

Example response:

```json
{
  "query": "exampel finance",
  "appliedQueryMode": "FUZZY_FALLBACK",
  "message": "Showing results for similar terms. Search exactly for 'exampel finance'.",
  "results": []
}
```

This is transparent and safer.

---

## 32. Did-You-Mean Flow

A robust did-you-mean flow:

```text
1. User submits query.
2. Run primary search.
3. If result quality is low:
     - generate correction candidates
     - score candidate confidence
     - validate candidate has results
4. Return original results plus suggestion.
5. User explicitly chooses corrected query.
```

Example:

```json
{
  "query": "mony laundring",
  "totalHits": 0,
  "didYouMean": {
    "query": "money laundering",
    "confidence": 0.92,
    "estimatedHits": 128
  },
  "results": []
}
```

Avoid silently changing the query:

```text
User searches "mony laundring"
System silently searches "money laundering"
```

Why bad?

- User may not know what happened.
- Audit trail becomes misleading.
- In legal/regulatory systems, query intent matters.

---

## 33. No-Result Recovery

No-result search is not just an error state. It is a UX recovery opportunity.

Possible recovery layers:

1. Show did-you-mean.
2. Show relaxed query suggestion.
3. Show matching filters that may be too restrictive.
4. Show search tips.
5. Suggest broader terms.
6. Offer exact identifier lookup if pattern detected.

Example:

```json
{
  "query": "aml report 2027",
  "totalHits": 0,
  "recovery": {
    "didYouMean": null,
    "relaxedQueries": [
      {
        "label": "Search without year filter",
        "query": "aml report"
      }
    ],
    "filterWarnings": [
      {
        "filter": "year",
        "value": "2027",
        "message": "No documents found for this year."
      }
    ]
  }
}
```

---

## 34. Autocomplete vs Final Search Consistency

A common production bug:

```text
Autocomplete suggests X.
Final search for X returns nothing.
```

Causes:

- Separate index not synchronized.
- Suggestion ignores permissions.
- Suggestion uses different normalization.
- Final search uses stricter filters.
- Suggestion built from stale data.
- Suggestion uses deleted/inactive entities.

Mitigation:

- Use same canonical event pipeline for search and suggestion index.
- Include status/visibility in suggestion docs.
- Use permission-aware suggestion filtering.
- Validate suggestion candidate before returning.
- Attach suggestion action semantics.

Example suggestion payload:

```json
{
  "type": "case",
  "label": "CASE-2026-001 — PT Example Finance",
  "entityId": "CASE-2026-001",
  "action": "OPEN_CASE",
  "visibilityChecked": true
}
```

---

## 35. Search Assistance For Identifiers

Identifier search deserves special design.

Examples:

- Case number.
- Registration number.
- License number.
- Filing number.
- Document ID.
- External reference ID.

Do not treat identifiers as normal language.

Bad:

```text
Analyze CASE-2026-001 as generic text.
Apply stemming/fuzziness.
```

Better:

- Store normalized keyword field.
- Store original display value.
- Store prefix/search-as-you-type subfield if needed.
- Apply exact and prefix boost.
- Do not apply language stemming.

Mapping sketch:

```json
{
  "case_number": {
    "type": "keyword",
    "normalizer": "lowercase_normalizer",
    "fields": {
      "prefix": {
        "type": "text",
        "analyzer": "identifier_prefix_index",
        "search_analyzer": "identifier_prefix_search"
      }
    }
  }
}
```

Query pattern:

```json
{
  "bool": {
    "should": [
      {
        "term": {
          "case_number": {
            "value": "case-2026-001",
            "boost": 20
          }
        }
      },
      {
        "match": {
          "case_number.prefix": {
            "query": "case-2026",
            "boost": 10
          }
        }
      },
      {
        "multi_match": {
          "query": "case-2026",
          "fields": ["title^3", "summary"]
        }
      }
    ],
    "minimum_should_match": 1
  }
}
```

---

## 36. Search Assistance For Names

Names are messy:

- Different casing.
- Abbreviations.
- Corporate suffixes.
- Typos.
- Transliteration.
- Word order differences.
- Middle names.
- Alias names.

Example:

```text
PT Example Finance Tbk
Example Finance
PT. Example Finance
Example Finance, PT
```

Design fields:

```json
{
  "party_name_display": "PT Example Finance Tbk",
  "party_name_text": "PT Example Finance Tbk",
  "party_name_keyword": "pt example finance tbk",
  "party_name_autocomplete": "PT Example Finance Tbk",
  "party_name_aliases": [
    "Example Finance",
    "PT Example"
  ]
}
```

Search behavior:

- Exact normalized match gets high boost.
- Prefix/autocomplete match gets medium boost.
- Fuzzy name match gets fallback boost.
- Alias match gets explicit signal.

---

## 37. Search Assistance For Regulatory Terms

Regulatory search often includes domain phrases:

```text
anti money laundering
customer due diligence
beneficial ownership
fit and proper test
suspicious transaction report
late filing
administrative sanction
```

You may need:

- Synonym lists.
- Acronym expansion.
- Protected terms.
- Phrase suggestions.
- Domain dictionary.

Example:

```text
AML -> anti money laundering
CDD -> customer due diligence
STR -> suspicious transaction report
BO -> beneficial owner / beneficial ownership
```

But be careful:

```text
BO
```

Could mean many things depending on domain. Blind expansion can harm precision.

Better:

- Use field/domain context.
- Show explicit suggestions.
- Log query behavior.
- Evaluate relevance before adding synonyms.

---

## 38. Java Backend Design: Separate Endpoints or One Endpoint?

Common API options:

```text
GET /search
GET /search/suggest
GET /search/spellcheck
```

or:

```text
POST /search
POST /search-assist
```

Recommended pattern:

```text
/search
  - final committed query
  - pagination, filters, facets, results

/search/suggest
  - low-latency typeahead
  - small response
  - no heavy aggregations

/search/repair
  - optional spell/did-you-mean query repair
  - can be called after no-result or low-confidence result
```

Why separate?

- Different latency budgets.
- Different payload size.
- Different caching strategy.
- Different abuse risk.
- Different rate limits.
- Different observability metrics.

---

## 39. Java DTO Design For Suggestion

Example DTOs:

```java
public record SearchSuggestRequest(
    String q,
    String tenantId,
    String userId,
    List<String> permissionTokens,
    Integer size,
    SuggestionScope scope
) {}

public enum SuggestionScope {
    ALL,
    CASES,
    PARTIES,
    QUERIES,
    REGULATORY_TERMS
}

public record SearchSuggestResponse(
    String query,
    List<SearchSuggestion> suggestions
) {}

public record SearchSuggestion(
    SuggestionType type,
    String label,
    String value,
    String entityId,
    SuggestionAction action,
    Double score,
    Map<String, Object> metadata
) {}

public enum SuggestionType {
    CASE,
    PARTY,
    QUERY,
    REGULATORY_TERM,
    SPELL_CORRECTION
}

public enum SuggestionAction {
    SEARCH_QUERY,
    OPEN_ENTITY,
    APPLY_FILTER
}
```

Important:

- `label` is UI display.
- `value` is query value.
- `entityId` is for navigation.
- `action` tells frontend what to do.
- `metadata` should not leak sensitive internals.

---

## 40. Java Service Boundary

Example interface:

```java
public interface SearchAssistService {
    SearchSuggestResponse suggest(SearchSuggestRequest request);
    SpellCheckResponse spellCheck(SpellCheckRequest request);
    HighlightPolicy highlightPolicyFor(SearchUseCase useCase);
}
```

Implementation should:

- Validate query length.
- Normalize input.
- Detect identifier patterns.
- Apply tenant/permission filters.
- Choose appropriate suggestion source.
- Set timeout aggressively.
- Limit result size.
- Capture metrics.

Pseudo-code:

```java
public SearchSuggestResponse suggest(SearchSuggestRequest request) {
    String q = normalize(request.q());

    if (q.length() < 2) {
        return SearchSuggestResponse.empty(q);
    }

    if (looksLikeCaseNumber(q)) {
        return suggestCaseNumber(q, request);
    }

    if (request.scope() == SuggestionScope.PARTIES) {
        return suggestParties(q, request);
    }

    return mergeRanked(
        suggestEntities(q, request),
        suggestQueries(q, request),
        suggestRegulatoryTerms(q, request)
    );
}
```

---

## 41. Input Validation For Suggest Endpoint

Suggest endpoints are easy to abuse because they are called frequently per keystroke.

Guardrails:

```text
Minimum query length: 2 or 3 chars
Maximum query length: maybe 100 chars
Maximum suggestions: 5–10
Timeout: low, for example 50–150ms backend budget depending on architecture
No arbitrary wildcard
No arbitrary regex
No heavy aggregation
No highlight by default
Rate limit per user/session/IP
Debounce on frontend
```

Backend should not rely solely on frontend debounce.

---

## 42. Frontend Debounce and Backend Latency Budget

Autocomplete can easily produce high QPS:

```text
User types 15 characters
Without debounce: 15 requests
With debounce: maybe 3–5 requests
```

Backend design:

```text
/search/suggest should be cheap and bounded.
```

Recommended properties:

- Small response.
- No full `_source` large fields.
- No expensive query classes.
- No deep pagination.
- Small `size`.
- Aggressive timeout.
- Circuit breaker fallback.

When suggest is down:

```text
Main search must still work.
```

Autocomplete is assistive, not critical source-of-truth.

---

## 43. Permission-Aware Suggestions

This is one of the most important sections for enterprise/regulatory systems.

A suggestion can leak existence.

Example leakage:

```text
User without access types "CEO bribery"
Suggestion: "Confidential CEO bribery investigation"
```

Even if they cannot open it, the suggestion already leaked sensitive information.

Design choices:

### 43.1 Filter Suggestion Docs By Permission Tokens

Suggestion docs include visibility tokens.

```json
{
  "suggest": { "input": ["Confidential Investigation X"] },
  "permission_tokens": ["tenant-a", "division-enforcement", "case-team-123"]
}
```

Query applies filter.

### 43.2 Separate Suggestion Index Per Tenant/Security Domain

Stronger isolation, more operational overhead.

### 43.3 Build Suggestions Only From User-Accessible Recent Data

Useful for personalized suggestions.

### 43.4 No Sensitive Entity Suggestions

For very sensitive domains, only suggest safe query terms, not confidential entity names.

Rule:

> If a user cannot know an entity exists, they must not receive it as a suggestion.

---

## 44. Highlight Permission and Redaction

Even after search authorization, highlight can leak hidden field content.

Solution patterns:

1. Only highlight display-safe fields.
2. Apply field-level permission before requesting highlight.
3. Redact before indexing display field.
4. Maintain separate searchable and display-safe fields.
5. Disable highlight for sensitive fields.

Example:

```json
{
  "internal_notes_search": "Whistleblower John Smith alleged...",
  "internal_notes_display": "[REDACTED] alleged..."
}
```

But this must be carefully governed. Searchable hidden content can still influence result existence.

---

## 45. Observability For Search Assistance

Track separate metrics for:

### Suggest Endpoint

- QPS.
- p50/p95/p99 latency.
- Timeout rate.
- Empty suggestion rate.
- Selected suggestion rate.
- Suggestion type distribution.
- Permission-filtered candidate count.

### Highlight

- Search latency with highlight enabled vs disabled.
- Highlight payload size.
- Top fields causing highlight cost.
- Fragment counts.
- Error/missing highlight rate.

### Spell Correction

- Correction suggestion rate.
- Correction accepted rate.
- Incorrect correction reports.
- No-result recovery rate.
- Query rewritten/relaxed rate.

These metrics separate search quality from search infrastructure.

---

## 46. Testing Highlight

Unit tests are insufficient. You need query examples.

Test cases:

```text
Query: late filing
Document: "The entity submitted a late filing notice."
Expected highlight contains late + filing.
```

```text
Query: AML
Document: "Anti Money Laundering reporting obligation"
Expected? depends on synonym/highlight policy.
```

```text
Query: CASE-2026-001
Document: case_number field
Expected exact highlight on identifier.
```

```text
User lacks internal_notes permission
Expected no highlight from internal_notes.
```

Regression test data should include:

- Exact terms.
- Phrase queries.
- Synonym queries.
- Fuzzy queries.
- Multi-field queries.
- Sensitive fields.
- Long documents.
- OCR/noisy text.

---

## 47. Testing Autocomplete

Autocomplete should be tested with partial prefixes.

Example table:

| Input | Expected top suggestion | Notes |
|---|---|---|
| `ca` | maybe none / too short | min length policy |
| `case-2026` | case number suggestions | identifier detection |
| `pt ex` | PT Example Finance | entity name |
| `aml` | AML / anti money laundering | acronym handling |
| `mony` | maybe money | fuzzy/correction |
| `zzzz` | no suggestions | low noise |

Also test permissions:

```text
User A can see CASE-1 -> suggestion appears.
User B cannot see CASE-1 -> suggestion does not appear.
```

---

## 48. Testing Spell Correction

Spell correction tests should include “do not correct” cases.

Example:

| Query | Expected |
|---|---|
| `mony laundering` | suggest `money laundering` |
| `AML` | do not correct |
| `OJK` | do not correct |
| `CASE-2026-001` | do not correct |
| `fit proper` | maybe suggest phrase `fit and proper` |
| `SAR filing` | do not correct SAR to car |

A spell system without negative tests will harm expert search.

---

## 49. Security Abuse Cases

Autocomplete and fuzzy endpoints can be abused for enumeration.

Example attack:

```text
for prefix in a..z, aa..zz:
  call /search/suggest?q=prefix
  collect confidential entity names
```

Mitigations:

- Authentication required.
- Tenant/permission filtering.
- Rate limiting.
- Minimum prefix length.
- Do not suggest sensitive entities.
- Monitor unusual prefix scans.
- Limit result count.
- Add audit logs for high-risk search endpoints.

Highlight abuse:

```text
User crafts query to extract fragments from restricted body.
```

Mitigation:

- Field-level display permission.
- Highlight allowlist.
- Snippet redaction.
- Query restrictions for sensitive fields.

---

## 50. Performance Failure Modes

### 50.1 Highlight Over Large Fields

Large OCR fields + many fragments + high QPS = latency spike.

Mitigation:

- Limit highlight fields.
- Limit fragment count.
- Separate attachment search result endpoint.
- Consider term vectors for heavy highlight use case.
- Add timeout.

### 50.2 Autocomplete With Wildcard

Bad:

```json
{
  "wildcard": {
    "title.keyword": "*a*"
  }
}
```

At high QPS, this is dangerous.

### 50.3 Edge N-Gram Explosion

Too many autocomplete fields and small grams bloat index.

Mitigation:

- Autocomplete only selected fields.
- Use sensible min/max gram.
- Use separate subfields.
- Measure index size before rollout.

### 50.4 Fuzzy Everywhere

Fuzzy on all fields for every query increases CPU and reduces precision.

Mitigation:

- Use fuzzy as fallback.
- Limit fields.
- Limit max expansions.
- Avoid short terms.

---

## 51. Practical Design Pattern: Search Assist Pipeline

A robust search assistance pipeline:

```text
Input q
  |
  |-- normalize
  |-- validate length / allowed chars
  |-- detect query class
  |      |-- identifier
  |      |-- person/entity name
  |      |-- domain term
  |      |-- free text
  |
  |-- choose strategy
  |      |-- completion suggester
  |      |-- search_as_you_type
  |      |-- edge n-gram field
  |      |-- phrase suggester
  |      |-- popular query store
  |
  |-- apply security filters
  |-- retrieve candidates
  |-- merge/rank/dedupe
  |-- return action-oriented suggestions
```

---

## 52. Example End-to-End Suggest Design For Case Management

### 52.1 Requirements

Users need suggestions for:

- Case number.
- Regulated entity name.
- Party name.
- Known regulatory term.
- Popular query.

Security:

- Must be tenant-aware.
- Must not leak restricted cases.
- Must support user permission tokens.

Latency:

- p95 under low hundreds of milliseconds.
- Response max 10 suggestions.

### 52.2 Index Design

Use dedicated suggestion index:

```json
PUT regulatory_search_suggestions
{
  "mappings": {
    "properties": {
      "suggest": {
        "type": "completion"
      },
      "display_label": {
        "type": "keyword"
      },
      "suggestion_type": {
        "type": "keyword"
      },
      "entity_id": {
        "type": "keyword"
      },
      "tenant_id": {
        "type": "keyword"
      },
      "permission_tokens": {
        "type": "keyword"
      },
      "status": {
        "type": "keyword"
      },
      "updated_at": {
        "type": "date"
      }
    }
  }
}
```

### 52.3 Suggestion Document

```json
POST regulatory_search_suggestions/_doc/CASE-2026-001
{
  "suggest": {
    "input": [
      "CASE-2026-001",
      "PT Example Finance",
      "AML Investigation PT Example Finance"
    ],
    "weight": 90
  },
  "display_label": "CASE-2026-001 — PT Example Finance AML Investigation",
  "suggestion_type": "CASE",
  "entity_id": "CASE-2026-001",
  "tenant_id": "tenant-a",
  "permission_tokens": [
    "tenant-a",
    "division-enforcement",
    "case-team-123"
  ],
  "status": "ACTIVE",
  "updated_at": "2026-06-21T10:15:00Z"
}
```

### 52.4 Query Flow

Pseudo:

```text
q = normalize(input)
if q.length < 2 -> return empty
if looks like case number -> prioritize case suggestions
else -> query completion suggester with permission/security filter
merge with popular query suggestions
return max 10
```

### 52.5 Response

```json
{
  "query": "pt ex",
  "suggestions": [
    {
      "type": "CASE",
      "label": "CASE-2026-001 — PT Example Finance AML Investigation",
      "value": "PT Example Finance",
      "entityId": "CASE-2026-001",
      "action": "OPEN_ENTITY"
    },
    {
      "type": "QUERY",
      "label": "Search for: pt example finance",
      "value": "pt example finance",
      "action": "SEARCH_QUERY"
    }
  ]
}
```

---

## 53. Example End-to-End Highlight Design

### 53.1 Search Request

```json
POST /search/cases
{
  "q": "late filing",
  "filters": {
    "status": ["ACTIVE", "UNDER_REVIEW"]
  },
  "page": {
    "size": 10
  },
  "highlight": true
}
```

### 53.2 Elasticsearch Query Sketch

```json
GET cases/_search
{
  "_source": [
    "case_id",
    "title",
    "status",
    "party_names",
    "opened_at"
  ],
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "late filing",
            "fields": [
              "title^4",
              "party_names^3",
              "allegation_summary^2",
              "body"
            ]
          }
        }
      ],
      "filter": [
        { "terms": { "status": ["ACTIVE", "UNDER_REVIEW"] } },
        { "term": { "tenant_id": "tenant-a" } },
        { "terms": { "permission_tokens": ["division-enforcement"] } }
      ]
    }
  },
  "highlight": {
    "pre_tags": ["<mark>"],
    "post_tags": ["</mark>"],
    "fields": {
      "title": {},
      "party_names": {},
      "allegation_summary": {
        "fragment_size": 180,
        "number_of_fragments": 2
      },
      "body": {
        "fragment_size": 180,
        "number_of_fragments": 2
      }
    }
  }
}
```

### 53.3 API Response

```json
{
  "results": [
    {
      "caseId": "CASE-2026-001",
      "title": "Late Filing Investigation Against PT Example Finance",
      "status": "UNDER_REVIEW",
      "matchedFields": ["title", "allegation_summary"],
      "highlights": [
        {
          "field": "title",
          "label": "Case title",
          "fragments": ["<mark>Late</mark> <mark>Filing</mark> Investigation Against PT Example Finance"]
        },
        {
          "field": "allegation_summary",
          "label": "Allegation summary",
          "fragments": ["... repeated <mark>late</mark> <mark>filing</mark> of mandatory disclosures ..."]
        }
      ]
    }
  ]
}
```

---

## 54. Common Anti-Patterns

### Anti-Pattern 1 — Autocomplete Using Wildcard On Main Text Field

```json
{
  "wildcard": {
    "title": "*abc*"
  }
}
```

Problems:

- Expensive.
- Poor scoring.
- Bad under high QPS.

### Anti-Pattern 2 — Fuzzy Everywhere

```json
{
  "multi_match": {
    "query": "aml report",
    "fields": ["*"],
    "fuzziness": "AUTO"
  }
}
```

Problems:

- Too broad.
- Unpredictable.
- Hard to defend.
- Expensive.

### Anti-Pattern 3 — Suggestion Without Authorization

```text
suggest index contains all case names
/search/suggest has no permission filter
```

This can leak sensitive data.

### Anti-Pattern 4 — Highlight Every Field

```json
"highlight": {
  "fields": {
    "*": {}
  }
}
```

Problems:

- Payload explosion.
- Latency spike.
- Sensitive field leak.

### Anti-Pattern 5 — Suggestion As Final Search

Autocomplete result should not become a replacement for search semantics unless intentionally designed.

---

## 55. Decision Matrix

| Need | Recommended Starting Point |
|---|---|
| Show why result matched | Highlight selected fields |
| Fast entity autocomplete | Completion suggester or dedicated suggestion index |
| Search-as-you-type over title/name | `search_as_you_type` or edge n-gram subfield |
| Identifier prefix search | Keyword prefix / normalized prefix field |
| Typo tolerance for names | Controlled fuzziness on name fields |
| Did-you-mean | Term/phrase suggester + validation |
| Domain acronym handling | Dictionary/synonyms/protected terms |
| High-security suggestion | Permission-filtered or isolated suggestion index |
| OCR field snippets | Limited highlight, maybe special endpoint |
| No-result recovery | Correction + relaxed query suggestions |

---

## 56. Production Checklist

Before shipping highlight/autocomplete/spell correction:

```text
[ ] Suggest endpoint has min query length.
[ ] Suggest endpoint has max size.
[ ] Suggest endpoint has timeout.
[ ] Suggest endpoint has rate limit.
[ ] Suggestion candidates are permission-aware.
[ ] Sensitive entities are not suggested to unauthorized users.
[ ] Autocomplete result can be reconciled with final search behavior.
[ ] Highlight fields are allowlisted.
[ ] Sensitive fields are not highlighted.
[ ] Highlight payload size is bounded.
[ ] Fuzzy search is limited to selected fields.
[ ] Acronyms/domain terms are protected from bad correction.
[ ] Spell correction is not silently applied in high-stakes search.
[ ] No-result recovery is transparent.
[ ] Metrics exist for latency, empty suggestions, selected suggestions, correction acceptance.
[ ] Regression tests include positive and negative cases.
```

---

## 57. Mental Model Summary

Search assistance is not one feature. It is a set of separate mechanisms:

```text
Highlight     -> explain matched result
Autocomplete  -> help form query before submit
Suggestion    -> offer known entity/query choices
Fuzzy         -> tolerate small input errors
Spellcheck    -> propose corrected query
No-result UX  -> help recover from failed search
```

The most important production principle:

> Assistive search features must not become less secure, less explainable, or less consistent than the main search system.

For normal consumer search, a weird suggestion is annoying.  
For enterprise/regulatory search, a weird suggestion can be misleading, unauditable, or a data leak.

---

## 58. What You Should Be Able To Do After This Part

After this part, you should be able to:

- Explain the difference between highlight, autocomplete, suggestion, fuzzy search, and spell correction.
- Design highlight behavior without leaking sensitive fields.
- Choose between completion suggester, `search_as_you_type`, edge n-gram, and dedicated suggestion index.
- Explain why wildcard autocomplete is dangerous.
- Design permission-aware suggestions.
- Use fuzzy matching as a controlled fallback, not a global default.
- Build did-you-mean flows without silently rewriting user intent.
- Define Java API contracts for search assistance.
- Test autocomplete, highlight, and spell correction with domain-specific cases.
- Identify production failure modes in search assistance.

---

## 59. Bridge To Part 019

Part ini membahas fitur bantu search secara umum. Part berikutnya akan fokus pada tantangan yang lebih spesifik:

- multilingual search,
- domain-specific search,
- Indonesian language considerations,
- legal/regulatory terminology,
- synonyms,
- acronyms,
- exact identifier search,
- normalization strategy,
- domain dictionary lifecycle.

Dengan kata lain, Part 019 akan menjawab:

> Bagaimana membuat Elasticsearch memahami bahasa dan istilah domain, bukan hanya token string?

---

## References

- Elastic Documentation — Highlighters: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/highlighting
- Elastic Documentation — Search suggesters: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/search-suggesters
- Elastic Documentation — Search-as-you-type field type: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/search-as-you-type
- Elastic Documentation — Edge n-gram tokenizer: https://www.elastic.co/docs/reference/text-analysis/analysis-edgengram-tokenizer
- Elastic Documentation — Edge n-gram token filter: https://www.elastic.co/docs/reference/text-analysis/analysis-edgengram-tokenfilter
- Elastic Documentation — N-gram token filter: https://www.elastic.co/docs/reference/text-analysis/analysis-ngram-tokenfilter
- Elastic Documentation — Fuzzy query: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-fuzzy-query
- Elastic Documentation — `search_analyzer`: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/search-analyzer

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — Search API Design for Backend Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-019.md">Part 019 — Multilingual and Domain-Specific Search ➡️</a>
</div>
