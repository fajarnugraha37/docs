# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-006.md

# Part 006 — Mapping Mastery

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Bagian: `006 / 034`  
> Topik: Mapping sebagai schema search, field type, dynamic mapping, multi-fields, `_source`, `doc_values`, template, dan governance  
> Audiens: Java software engineer yang ingin mampu mendesain Elasticsearch index secara production-grade

---

## 0. Posisi Bagian Ini dalam Seri

Di Part 005 kita membahas **document modeling for search**: bagaimana mengubah entity/domain model menjadi retrieval document yang cocok untuk query behavior, ranking, filtering, permission, dan lifecycle.

Part 006 sekarang membahas sesuatu yang tampak seperti detail konfigurasi, tetapi sebenarnya merupakan salah satu pusat desain Elasticsearch:

> **Mapping adalah kontrak antara data, query, storage, scoring, sorting, aggregation, dan evolusi schema.**

Banyak engineer memperlakukan mapping sebagai “schema JSON untuk index”. Itu benar, tetapi terlalu dangkal. Mapping bukan hanya daftar field. Mapping menentukan:

- apakah field bisa dicari full-text atau exact match;
- apakah field bisa dipakai sorting;
- apakah field bisa dipakai aggregation/facet;
- apakah field dianalisis oleh analyzer;
- apakah nilai field disimpan di columnar structure untuk sorting/aggregation;
- apakah field masuk inverted index;
- apakah field bisa berubah tanpa reindex;
- apakah ingestion akan gagal saat data berubah;
- apakah index akan membengkak karena field explosion;
- apakah query akan cepat, lambat, atau mustahil;
- apakah sistem search bisa berevolusi dengan aman.

Untuk Java/backend engineer, mapping harus diperlakukan seperti **API contract + storage contract + query contract** sekaligus.

---

## 1. Apa Itu Mapping?

Dalam Elasticsearch, mapping mendefinisikan struktur field dalam index. Setiap field punya type dan parameter. Elastic sendiri menjelaskan bahwa setiap field memiliki data type yang menunjukkan jenis data dan intended use-nya; string bisa diindex sebagai `text` untuk full-text search atau `keyword` untuk filtering/sorting/exact matching. Sumber: Elastic field data types documentation: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/field-data-types

Contoh sederhana:

```json
PUT cases-v1
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "case_id": {
        "type": "keyword"
      },
      "title": {
        "type": "text",
        "fields": {
          "keyword": {
            "type": "keyword",
            "ignore_above": 256
          }
        }
      },
      "status": {
        "type": "keyword"
      },
      "opened_at": {
        "type": "date"
      },
      "priority_score": {
        "type": "integer"
      }
    }
  }
}
```

Sekilas ini mirip schema table atau document schema. Tetapi maknanya lebih luas.

`case_id` sebagai `keyword` berarti:

- tidak dianalisis menjadi token;
- cocok untuk exact lookup;
- cocok untuk filter;
- cocok untuk aggregation;
- cocok untuk sorting;
- tidak cocok untuk full-text query seperti natural language.

`title` sebagai `text` berarti:

- diproses lewat analyzer;
- dipecah menjadi token;
- cocok untuk full-text search;
- ikut scoring;
- tidak ideal untuk sorting/aggregation.

`title.keyword` sebagai multi-field berarti nilai title yang sama juga disimpan dalam bentuk exact value untuk use case lain.

Inilah alasan mapping harus didesain dari query behavior, bukan dari struktur DTO Java semata.

---

## 2. Mapping Bukan Sekadar Schema

Dalam database relasional, schema terutama menjawab:

- kolom apa yang ada;
- tipe datanya apa;
- constraint-nya apa;
- relasinya apa.

Dalam Elasticsearch, mapping menjawab pertanyaan berbeda:

| Pertanyaan | Dijawab oleh mapping? |
|---|---:|
| Apakah field bisa dicari sebagai teks? | Ya |
| Apakah field bisa dicari exact? | Ya |
| Apakah field bisa difilter? | Ya |
| Apakah field bisa diagregasi? | Ya |
| Apakah field bisa disortir? | Ya |
| Apakah field masuk scoring? | Ya, tergantung query dan type |
| Apakah field disimpan di `_source`? | Dipengaruhi mapping/index setting |
| Apakah field disimpan dalam `doc_values`? | Ya |
| Apakah field boleh muncul dinamis? | Ya |
| Apakah field nested punya korelasi antar object? | Ya |
| Apakah schema bisa berkembang tanpa reindex? | Sebagian besar ditentukan mapping |

Mapping adalah **execution contract**.

Query tidak berjalan di atas JSON mentah. Query berjalan di atas struktur index yang dibentuk oleh mapping.

---

## 3. Mental Model: Satu Field, Banyak Representasi

Misalnya ada field:

```json
{
  "title": "Unauthorized cross-border fund transfer investigation"
}
```

Di Elasticsearch, field ini bisa punya beberapa representasi:

```json
"title": {
  "type": "text",
  "analyzer": "english",
  "fields": {
    "keyword": {
      "type": "keyword",
      "ignore_above": 512
    },
    "autocomplete": {
      "type": "text",
      "analyzer": "title_autocomplete"
    }
  }
}
```

Satu nilai logical `title` dapat menjadi:

- `title` untuk full-text relevance;
- `title.keyword` untuk exact sorting/filtering;
- `title.autocomplete` untuk prefix/autocomplete behavior.

Jadi field bukan hanya “kolom”. Field adalah **beberapa index view atas nilai yang sama**.

Ini sangat penting untuk engineer Java karena model class Anda mungkin hanya punya satu property:

```java
public record CaseSearchDocument(
    String caseId,
    String title,
    String status,
    Instant openedAt
) {}
```

Tetapi Elasticsearch mapping bisa mengindex `title` ke banyak sub-field. Java model tidak harus mencerminkan seluruh physical index representation.

---

## 4. Prinsip Pertama: Mapping Harus Dimulai dari Access Pattern

Kesalahan umum:

> “Saya punya field `name`, jadi type-nya apa?”

Pertanyaan yang benar:

> “Field `name` akan digunakan untuk apa?”

Contoh:

| Field | Use Case | Mapping Yang Mungkin |
|---|---|---|
| `case_id` | exact lookup | `keyword` |
| `title` | full-text search | `text` |
| `title` | sorting alphabetical | `title.keyword` as `keyword` |
| `status` | filter/facet | `keyword` |
| `opened_at` | range filter/sort | `date` |
| `amount` | range query/statistics | numeric |
| `external_reference_number` | exact lookup, even if numeric-looking | `keyword` |
| `description` | long full-text | `text` |
| `tags` | exact filter/facet | `keyword` |
| `assignees.name` | display only | maybe only `_source`, not indexed |
| `permissions.user_ids` | authorization filter | `keyword` |
| `geo_location` | geo-distance query | `geo_point` |

Elastic notes that numeric identifiers are often better mapped as `keyword` when they are used for term-level queries rather than range queries. Sumber: Elastic numeric field types documentation: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/number

Jadi mapping bukan “tipe data natural”, tetapi “tipe data berdasarkan operasi”.

---

## 5. Field Type Paling Penting

Bagian ini tidak akan mengulang seluruh dokumentasi Elastic. Fokusnya adalah field type yang paling sering menentukan benar/salahnya desain search platform.

---

## 5.1 `keyword`

`keyword` adalah field untuk exact value.

Cocok untuk:

- ID;
- enum/status;
- code;
- tag;
- tenant ID;
- permission principal;
- category;
- normalized name;
- exact filter;
- facet/aggregation;
- sorting;
- join-like lookup di application layer.

Contoh:

```json
"status": {
  "type": "keyword"
}
```

Query:

```json
GET cases-v1/_search
{
  "query": {
    "term": {
      "status": "OPEN"
    }
  }
}
```

`keyword` tidak dianalisis. Nilai `OPEN` tetap `OPEN`. Nilai `Open Case` tetap `Open Case` kecuali diberi normalizer.

### Kapan `keyword` salah?

`keyword` salah ketika user ingin mencari bagian kata natural language.

Jika field:

```json
"description": {
  "type": "keyword"
}
```

lalu user mencari `fraud transfer`, maka field itu tidak akan bekerja seperti full-text search. Elasticsearch akan memperlakukan seluruh description sebagai exact term besar, bukan token kata.

### Normalizer untuk `keyword`

Untuk exact field yang perlu case-insensitive:

```json
PUT cases-v1
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
      "external_ref": {
        "type": "keyword",
        "normalizer": "lowercase_normalizer"
      }
    }
  }
}
```

Perbedaan analyzer dan normalizer:

- analyzer bisa menghasilkan banyak token;
- normalizer untuk keyword menghasilkan satu token yang dinormalisasi.

---

## 5.2 `text`

`text` adalah field untuk full-text search.

Cocok untuk:

- judul;
- deskripsi;
- body dokumen;
- catatan investigator;
- ringkasan kasus;
- statement;
- komentar;
- narrative field.

Elastic mendeskripsikan `text` sebagai field untuk full-text values yang dianalisis menjadi token sebelum diindex. Text fields tidak digunakan untuk sorting dan jarang untuk aggregation. Sumber: Elastic text field documentation: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/text

Contoh:

```json
"summary": {
  "type": "text",
  "analyzer": "english"
}
```

Query:

```json
GET cases-v1/_search
{
  "query": {
    "match": {
      "summary": "suspicious cross border transfer"
    }
  }
}
```

Elasticsearch tidak mencari string literal. Ia menganalisis query dan field, lalu mencocokkan token.

### Kapan `text` salah?

`text` salah untuk:

- ID;
- status;
- exact code;
- tenant id;
- permission id;
- low-cardinality enum;
- field yang sering dipakai aggregation/sorting.

Contoh salah:

```json
"status": {
  "type": "text"
}
```

Masalah:

- `OPEN_CASE` bisa dianalisis dengan cara tidak diinginkan;
- exact filter menjadi tidak tepat;
- aggregation/sorting tidak ideal.

---

## 5.3 `text` + `keyword` Multi-Field

Banyak field butuh dua perilaku sekaligus:

- searchable sebagai full-text;
- filter/sort/exact sebagai keyword.

Gunakan multi-fields:

```json
"title": {
  "type": "text",
  "analyzer": "english",
  "fields": {
    "keyword": {
      "type": "keyword",
      "ignore_above": 512
    }
  }
}
```

Query full-text:

```json
{
  "match": {
    "title": "market abuse investigation"
  }
}
```

Sort exact:

```json
{
  "sort": [
    { "title.keyword": "asc" }
  ]
}
```

Facet:

```json
{
  "aggs": {
    "titles": {
      "terms": {
        "field": "title.keyword"
      }
    }
  }
}
```

Elastic documentation explains multi-fields as indexing the same field in different ways, such as text for full-text search and keyword for sorting/aggregation. Sumber: Elastic multi-field example in ES|QL tutorial: https://www.elastic.co/guide/en/elasticsearch/reference/current/esql-search-tutorial.html

### Namun multi-field bukan default yang selalu baik

Elastic production guidance notes that default dynamic string mappings can index strings both as `text` and `keyword`, which can be wasteful if only one is needed. Sumber: Elastic disk usage tuning documentation: https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/disk-usage

Contoh:

- `body` dokumen panjang tidak perlu `body.keyword`;
- `id` tidak perlu `id` sebagai `text`;
- `status` tidak perlu full-text;
- `description` panjang tidak perlu exact aggregation.

Aturan praktis:

> Multi-field hanya diberikan ketika ada dua access pattern yang nyata.

---

## 5.4 `date`

`date` dipakai untuk waktu:

- created_at;
- updated_at;
- opened_at;
- closed_at;
- escalation_due_at;
- event_time;
- publication_date;
- effective_from/effective_to.

Contoh:

```json
"opened_at": {
  "type": "date"
}
```

Range query:

```json
{
  "range": {
    "opened_at": {
      "gte": "2026-01-01T00:00:00Z",
      "lt": "2026-02-01T00:00:00Z"
    }
  }
}
```

### Format date

Jika format data Anda tidak standar:

```json
"decision_date": {
  "type": "date",
  "format": "yyyy-MM-dd||strict_date_optional_time||epoch_millis"
}
```

Aturan desain:

- simpan timestamp dalam UTC;
- gunakan ISO-8601 untuk interchange;
- jangan mencampur timezone semantics di field yang sama;
- pisahkan business date dari event timestamp jika maknanya berbeda.

Contoh:

```json
"incident_occurred_at": { "type": "date" },
"regulatory_reporting_date": { "type": "date", "format": "yyyy-MM-dd" }
```

Yang pertama adalah timestamp faktual. Yang kedua adalah business date.

---

## 5.5 Numeric Types

Numeric type dipakai untuk angka yang benar-benar butuh operasi numeric:

- range query;
- sorting numeric;
- aggregation numeric;
- scoring signal;
- statistik.

Contoh:

```json
"amount": {
  "type": "scaled_float",
  "scaling_factor": 100
}
```

Atau:

```json
"priority_score": {
  "type": "integer"
}
```

### Numeric-looking tidak selalu numeric

Field seperti ini sebaiknya `keyword`:

```json
"case_number": "00001234"
"product_code": "1234567890"
"external_party_id": "987654321"
"regulation_section": "10.4.2"
```

Kenapa?

- leading zero penting;
- tidak perlu range query;
- exact lookup lebih penting;
- format bisa berubah;
- angka bisa mengandung separator;
- nilai adalah identifier, bukan quantity.

---

## 5.6 Boolean

Cocok untuk flag:

```json
"is_active": {
  "type": "boolean"
}
```

Namun hati-hati dengan terlalu banyak boolean yang sebenarnya state machine.

Contoh buruk:

```json
{
  "is_open": true,
  "is_assigned": true,
  "is_escalated": false,
  "is_closed": false,
  "is_pending_review": true
}
```

Lebih baik:

```json
{
  "lifecycle_status": "PENDING_REVIEW",
  "assignment_status": "ASSIGNED",
  "escalation_status": "NOT_ESCALATED"
}
```

Dengan mapping:

```json
"lifecycle_status": { "type": "keyword" },
"assignment_status": { "type": "keyword" },
"escalation_status": { "type": "keyword" }
```

Untuk regulatory/case-management search, explicit state biasanya lebih defensible daripada banyak boolean yang bisa bertentangan.

---

## 5.7 `object`

Default object menyimpan struktur nested JSON, tetapi secara internal field turunannya di-flatten menjadi path field.

Contoh mapping:

```json
"owner": {
  "properties": {
    "id": { "type": "keyword" },
    "name": { "type": "text" }
  }
}
```

Document:

```json
{
  "owner": {
    "id": "u-123",
    "name": "Jane Doe"
  }
}
```

Field internal:

```text
owner.id
owner.name
```

Untuk single object, ini baik.

Masalah muncul pada array of object.

---

## 5.8 `nested`

`nested` dipakai ketika array of objects harus mempertahankan korelasi antar property dalam object yang sama.

Contoh problem:

```json
{
  "parties": [
    {
      "name": "Alice",
      "role": "COMPLAINANT"
    },
    {
      "name": "Bob",
      "role": "RESPONDENT"
    }
  ]
}
```

Jika `parties` hanya object biasa, query:

```text
parties.name = Alice AND parties.role = RESPONDENT
```

bisa match document di atas walaupun Alice bukan RESPONDENT. Ini karena object array di-flatten dan korelasi antar element hilang.

Mapping nested:

```json
"parties": {
  "type": "nested",
  "properties": {
    "name": { "type": "text" },
    "role": { "type": "keyword" }
  }
}
```

Query nested:

```json
{
  "query": {
    "nested": {
      "path": "parties",
      "query": {
        "bool": {
          "must": [
            { "match": { "parties.name": "Alice" } },
            { "term": { "parties.role": "RESPONDENT" } }
          ]
        }
      }
    }
  }
}
```

### Kapan nested tepat?

Gunakan nested ketika:

- array of objects;
- query perlu korelasi antar property di object yang sama;
- false-positive karena flattening tidak dapat diterima;
- jumlah nested object terkendali.

### Kapan nested berbahaya?

Nested berbahaya ketika:

- array sangat besar;
- nested object sering berubah;
- query nested kompleks dan banyak;
- pagination/inner hits berat;
- setiap document punya ratusan/ribuan child object.

Nested bukan “relasi normal”. Nested menambah hidden Lucene documents dan memengaruhi cost.

---

## 5.9 `flattened`

`flattened` cocok untuk object dengan key dinamis yang tidak ingin menyebabkan field explosion.

Contoh:

```json
"custom_attributes": {
  "type": "flattened"
}
```

Document:

```json
{
  "custom_attributes": {
    "source_system": "legacy-a",
    "risk_band": "high",
    "custom_flag_17": "true"
  }
}
```

Gunakan `flattened` untuk:

- metadata fleksibel;
- arbitrary key-value attributes;
- integrasi banyak source system;
- field tambahan yang tidak semua perlu explicit mapping.

Jangan gunakan `flattened` jika:

- perlu full-text relevance kompleks per subfield;
- perlu numeric range terhadap subfield tertentu;
- perlu strict type per key;
- field penting untuk core query/facet.

`flattened` adalah containment strategy untuk schema variability, bukan pengganti desain schema.

---

## 5.10 `wildcard`

`wildcard` adalah specialized keyword untuk unstructured machine-generated content yang sering dicari dengan wildcard/regexp. Elastic menjelaskan bahwa `wildcard` dioptimalkan untuk nilai besar atau high-cardinality machine-generated content dengan grep-like wildcard/regexp query. Sumber: Elastic keyword type family documentation: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/keyword

Cocok untuk:

- log message tertentu;
- trace id patterns;
- machine-generated string;
- path;
- URL-like field;
- stack trace fingerprint tertentu.

Namun jangan buru-buru pakai `wildcard` untuk semua. Untuk kebanyakan exact field, `keyword` cukup. Untuk full-text natural language, `text` lebih cocok.

---

## 5.11 `match_only_text`

`match_only_text` berguna untuk field teks besar ketika Anda butuh match tetapi tidak butuh scoring detail seperti `text` biasa.

Cocok untuk:

- log message;
- archived body;
- large text where scoring less important;
- cost-sensitive indexing.

Tidak cocok ketika:

- relevance ranking penting;
- phrase query/highlighting canggih dibutuhkan;
- field menjadi pusat search experience.

---

## 5.12 `dense_vector`, `semantic_text`, dan Field Search Modern

Vector/semantic field akan dibahas detail di Part 030 dan Part 031. Di sini cukup pahami posisinya dalam mapping.

Mapping modern Elasticsearch dapat mencakup:

- `dense_vector` untuk vector similarity search;
- semantic-oriented field types/features tergantung versi dan stack capability;
- lexical field tetap diperlukan untuk hybrid retrieval.

Prinsip desain:

> Jangan mengganti semua `text` dengan vector. Lexical field tetap penting untuk exact terms, names, codes, legal references, filters, dan explainability.

Contoh future-oriented:

```json
"summary": {
  "type": "text",
  "analyzer": "english",
  "fields": {
    "keyword": { "type": "keyword", "ignore_above": 512 }
  }
},
"summary_embedding": {
  "type": "dense_vector",
  "dims": 768
}
```

Tetapi detailnya jangan dipaksakan sekarang. Mapping semantic retrieval harus mengikuti embedding model, dimension, update lifecycle, dan evaluation.

---

## 6. `doc_values`, Inverted Index, `_source`, dan Stored Fields

Untuk memahami mapping secara matang, Anda harus membedakan beberapa representasi data.

---

## 6.1 Inverted Index

Inverted index dipakai untuk search.

Untuk field `text`, inverted index menyimpan term → document list.

Untuk field `keyword`, inverted index menyimpan exact value → document list.

Parameter penting:

```json
"index": true
```

Jika `index: false`, field tidak bisa dicari/filter melalui query normal.

Contoh:

```json
"raw_payload": {
  "type": "object",
  "enabled": false
}
```

Atau:

```json
"display_only_note": {
  "type": "keyword",
  "index": false
}
```

Gunakan ini ketika field hanya perlu muncul di `_source`, bukan untuk query.

---

## 6.2 `doc_values`

`doc_values` adalah columnar on-disk data structure untuk sorting, aggregation, dan scripts. Default-nya aktif untuk banyak field non-text seperti `keyword`, numeric, date, boolean.

Mental model:

- inverted index: cepat untuk cari dokumen berdasarkan term;
- doc values: cepat untuk ambil nilai field per dokumen untuk sort/aggs/script.

Contoh:

```json
"status": {
  "type": "keyword",
  "doc_values": true
}
```

Untuk field yang tidak pernah dipakai sort/aggregation/script, Anda bisa menonaktifkan `doc_values` untuk hemat storage:

```json
"permission_debug_label": {
  "type": "keyword",
  "doc_values": false
}
```

Tetapi jangan agresif di awal. Salah menonaktifkan `doc_values` bisa membuat future use case sulit.

### Kapan `doc_values` penting?

- sorting by date/status/amount;
- terms aggregation untuk facet;
- cardinality aggregation;
- script scoring;
- field collapsing;
- exporting sorted result.

---

## 6.3 `_source`

`_source` adalah JSON asli document yang Anda index, disimpan agar bisa dikembalikan saat search result.

Contoh document:

```json
{
  "case_id": "CASE-001",
  "title": "Suspicious transfer investigation",
  "status": "OPEN"
}
```

Saat search, hit biasanya mengembalikan `_source`.

Mapping field type tidak sama dengan `_source`.

- Mapping menentukan bagaimana field diindex.
- `_source` menyimpan JSON original.

Anda bisa memilih hanya field tertentu saat response:

```json
GET cases-v1/_search
{
  "_source": ["case_id", "title", "status"],
  "query": {
    "match": {
      "title": "transfer"
    }
  }
}
```

### Jangan sembarangan disable `_source`

Disable `_source` dapat menghemat storage tetapi berdampak besar:

- sulit reindex;
- sulit debug;
- sulit partial update;
- sulit migration;
- sulit recovery dari index;
- beberapa feature bisa terbatas.

Untuk production search platform, default rule:

> Biarkan `_source` aktif kecuali Anda benar-benar memahami konsekuensinya.

Jika payload terlalu besar, gunakan `_source` filtering, pisahkan display projection, atau jangan index field besar yang tidak perlu.

---

## 6.4 Stored Fields

Stored fields adalah mekanisme menyimpan field tertentu secara terpisah dari `_source`. Ini jarang perlu untuk aplikasi biasa.

Aturan praktis:

- gunakan `_source` untuk response payload;
- gunakan `doc_values` untuk sorting/aggs;
- gunakan inverted index untuk search/filter;
- stored fields hanya untuk kasus spesifik.

---

## 7. Dynamic Mapping

Dynamic mapping berarti Elasticsearch otomatis menambahkan field baru berdasarkan document yang masuk.

Elastic menjelaskan bahwa dengan dynamic mapping, Elasticsearch otomatis mendeteksi data type field dan membuat mapping. Sumber: Elastic mapping documentation: https://www.elastic.co/docs/manage-data/data-store/mapping

Contoh:

```json
POST dynamic-cases/_doc
{
  "case_id": "CASE-001",
  "status": "OPEN",
  "opened_at": "2026-01-01T10:00:00Z"
}
```

Elasticsearch bisa otomatis membuat mapping untuk `case_id`, `status`, `opened_at`.

Ini nyaman untuk eksplorasi, tetapi berbahaya untuk production search.

---

## 7.1 Masalah Dynamic Mapping

### 1. Tipe salah karena dokumen pertama

Jika dokumen pertama berisi:

```json
{
  "external_ref": 12345
}
```

Elasticsearch bisa menduga numeric.

Kemudian dokumen berikutnya:

```json
{
  "external_ref": "ABC-12345"
}
```

Ingestion gagal atau mapping conflict.

Padahal secara domain, `external_ref` harusnya `keyword`.

---

### 2. Field explosion

Jika source mengirim field dinamis:

```json
{
  "custom_a": "x",
  "custom_b": "y",
  "custom_c": "z"
}
```

atau:

```json
{
  "attributes": {
    "source_field_001": "x",
    "source_field_002": "y",
    "source_field_999999": "z"
  }
}
```

Elasticsearch bisa membuat ribuan field baru. Akibat:

- cluster state membesar;
- heap pressure naik;
- mapping update sering;
- indexing melambat;
- query planning lebih berat;
- limit field terlampaui;
- operational incident.

---

### 3. Default string mapping boros

Dynamic string bisa dibuat sebagai text + keyword. Elastic production guidance menyebut ini wasteful jika hanya satu representasi yang dibutuhkan. Sumber: Elastic disk usage tuning documentation: https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/disk-usage

Contoh ID:

```json
"case_id": "CASE-001"
```

Jika dibuat `text` + `keyword`, representasi `text` tidak berguna.

Contoh body:

```json
"body": "very long investigation narrative ..."
```

Jika dibuat `text` + `keyword`, representasi `keyword` bisa boros dan tidak berguna.

---

## 7.2 Dynamic Mapping Modes

Mapping punya parameter `dynamic`.

### `dynamic: true`

Field baru otomatis ditambahkan.

```json
{
  "mappings": {
    "dynamic": true
  }
}
```

Cocok untuk:

- prototyping;
- exploratory logging;
- development;
- non-critical schema discovery.

Risiko besar untuk production.

---

### `dynamic: false`

Field baru tidak ditambahkan ke mapping, tetapi tetap ada di `_source`.

```json
{
  "mappings": {
    "dynamic": false
  }
}
```

Cocok ketika:

- Anda ingin menerima field tambahan tanpa gagal ingestion;
- field tambahan hanya display/debug;
- mapping tetap controlled.

Risiko:

- engineer bisa salah mengira field searchable padahal tidak;
- data masuk tetapi tidak bisa dicari.

---

### `dynamic: strict`

Field tidak dikenal menyebabkan indexing error.

```json
{
  "mappings": {
    "dynamic": "strict"
  }
}
```

Cocok untuk:

- core search index production;
- regulated system;
- schema governance ketat;
- mencegah silent schema drift.

Risiko:

- ingestion bisa gagal saat producer berubah;
- perlu versioning dan deployment discipline.

Untuk regulatory/case-management system, `dynamic: strict` sering lebih aman untuk core fields, dengan area khusus `flattened` untuk metadata fleksibel.

---

### `dynamic: runtime`

Field baru ditambahkan sebagai runtime fields, dievaluasi saat query time. Elastic menjelaskan runtime fields sebagai field yang dievaluasi saat query time dan bisa menambah field ke dokumen yang sudah ada tanpa reindex. Sumber: Elastic runtime fields documentation: https://www.elastic.co/docs/manage-data/data-store/mapping/runtime-fields

Cocok untuk:

- eksplorasi;
- schema-on-read;
- field jarang dipakai;
- temporary migration;
- ad-hoc investigation.

Tidak cocok untuk:

- high-QPS query;
- core filter;
- core sort;
- heavy aggregation;
- performance-critical search.

Runtime field adalah alat fleksibilitas, bukan pengganti mapping yang matang.

---

## 8. Dynamic Templates

Dynamic templates memberi kontrol lebih atas field yang muncul dinamis. Elastic mendeskripsikan dynamic templates sebagai cara mengontrol bagaimana Elasticsearch memetakan data di luar default dynamic field mapping rules. Sumber: Elastic dynamic templates documentation: https://www.elastic.co/docs/manage-data/data-store/mapping/dynamic-templates

Contoh: semua field yang berakhiran `_id` menjadi keyword.

```json
PUT cases-v1
{
  "mappings": {
    "dynamic_templates": [
      {
        "ids_as_keyword": {
          "match": "*_id",
          "mapping": {
            "type": "keyword"
          }
        }
      }
    ],
    "properties": {
      "title": { "type": "text" }
    }
  }
}
```

Contoh: semua string default menjadi keyword, bukan text + keyword.

```json
"dynamic_templates": [
  {
    "strings_as_keyword": {
      "match_mapping_type": "string",
      "mapping": {
        "type": "keyword",
        "ignore_above": 256
      }
    }
  }
]
```

Namun hati-hati. Dynamic template bisa menyembunyikan schema drift jika terlalu longgar.

Best practice:

- gunakan explicit mapping untuk core fields;
- gunakan dynamic template untuk predictable field families;
- gunakan `flattened` untuk truly arbitrary metadata;
- monitor field count;
- review mapping changes.

---

## 9. Mapping Immutability dan Reindex Reality

Banyak mapping property tidak bisa diubah setelah field dibuat.

Contoh: field sudah dibuat:

```json
"status": {
  "type": "text"
}
```

Anda tidak bisa begitu saja mengubahnya menjadi:

```json
"status": {
  "type": "keyword"
}
```

Biasanya perlu:

1. buat index baru dengan mapping baru;
2. reindex data;
3. switch alias;
4. validasi;
5. hapus index lama setelah aman.

Inilah alasan mapping adalah keputusan mahal.

### Yang biasanya bisa ditambah

- field baru;
- multi-field baru pada beberapa kondisi untuk data berikutnya, tetapi data lama perlu reindex agar sub-field terisi;
- mapping properties baru di object;
- runtime fields.

### Yang biasanya tidak bisa diubah langsung

- field type;
- analyzer field yang sudah ada;
- object menjadi nested;
- nested menjadi object;
- keyword menjadi text;
- numeric menjadi keyword;
- banyak parameter indexing.

Mental model:

> Mapping salah bukan sekadar bug konfigurasi. Mapping salah adalah migration project.

---

## 10. Index Template dan Component Template

Untuk production, Anda jarang membuat mapping langsung per index secara manual. Gunakan template.

Template memungkinkan index baru mendapatkan settings/mappings/aliases otomatis.

Pola modern:

- component template untuk reusable pieces;
- index template untuk pattern index tertentu;
- versioned template untuk migration.

Contoh component template untuk common case fields:

```json
PUT _component_template/case-common-fields-v1
{
  "template": {
    "mappings": {
      "dynamic": "strict",
      "properties": {
        "case_id": { "type": "keyword" },
        "tenant_id": { "type": "keyword" },
        "status": { "type": "keyword" },
        "created_at": { "type": "date" },
        "updated_at": { "type": "date" }
      }
    }
  }
}
```

Index template:

```json
PUT _index_template/cases-template-v1
{
  "index_patterns": ["cases-v1-*"],
  "priority": 100,
  "composed_of": ["case-common-fields-v1"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1
    },
    "mappings": {
      "properties": {
        "title": {
          "type": "text",
          "fields": {
            "keyword": { "type": "keyword", "ignore_above": 512 }
          }
        },
        "summary": {
          "type": "text"
        }
      }
    }
  }
}
```

### Template governance

Untuk tim besar:

- template harus di-version-control;
- perubahan template harus lewat review;
- mapping generated dari app harus dihindari kecuali benar-benar controlled;
- CI harus memvalidasi mapping compatibility;
- perubahan mapping harus punya migration plan.

---

## 11. Designing Mapping dari Query Matrix

Cara paling robust mendesain mapping adalah membuat query matrix.

Contoh untuk case management search:

| Field | Display | Full-text | Exact Filter | Facet | Sort | Range | Highlight | Permission | Type |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `case_id` | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | `keyword` |
| `title` | ✅ | ✅ | optional | ❌ | optional | ❌ | ✅ | ❌ | `text` + `keyword` optional |
| `summary` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | `text` |
| `status` | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | `keyword` |
| `opened_at` | ✅ | ❌ | ✅ | ✅ date histogram | ✅ | ✅ | ❌ | ❌ | `date` |
| `amount` | ✅ | ❌ | ✅ | ✅ range | ✅ | ✅ | ❌ | ❌ | numeric/scaled_float |
| `assignee_ids` | maybe | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | `keyword` |
| `allowed_user_ids` | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | `keyword` |
| `parties` | ✅ | ✅ | ✅ | maybe | ❌ | ❌ | maybe | ❌ | `nested` or denormalized |
| `custom_attributes` | maybe | limited | limited | limited | ❌ | limited | ❌ | ❌ | `flattened` |

Mapping follows from this table.

---

## 12. Example: Regulatory Case Search Mapping

Berikut contoh mapping production-oriented. Ini bukan template universal, tetapi baseline realistis.

```json
PUT regulatory-cases-v1-000001
{
  "settings": {
    "analysis": {
      "normalizer": {
        "lowercase_keyword": {
          "type": "custom",
          "filter": ["lowercase", "asciifolding"]
        }
      },
      "analyzer": {
        "case_text_en": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding"]
        }
      }
    }
  },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "schema_version": {
        "type": "keyword"
      },
      "case_id": {
        "type": "keyword"
      },
      "case_number": {
        "type": "keyword",
        "normalizer": "lowercase_keyword"
      },
      "tenant_id": {
        "type": "keyword"
      },
      "title": {
        "type": "text",
        "analyzer": "case_text_en",
        "fields": {
          "keyword": {
            "type": "keyword",
            "ignore_above": 512,
            "normalizer": "lowercase_keyword"
          }
        }
      },
      "summary": {
        "type": "text",
        "analyzer": "case_text_en"
      },
      "lifecycle_status": {
        "type": "keyword"
      },
      "risk_level": {
        "type": "keyword"
      },
      "priority_score": {
        "type": "integer"
      },
      "opened_at": {
        "type": "date"
      },
      "updated_at": {
        "type": "date"
      },
      "due_at": {
        "type": "date"
      },
      "allegation_codes": {
        "type": "keyword"
      },
      "regulation_refs": {
        "type": "keyword",
        "normalizer": "lowercase_keyword"
      },
      "assigned_team_ids": {
        "type": "keyword"
      },
      "assigned_user_ids": {
        "type": "keyword"
      },
      "allowed_user_ids": {
        "type": "keyword"
      },
      "allowed_role_ids": {
        "type": "keyword"
      },
      "parties": {
        "type": "nested",
        "properties": {
          "party_id": { "type": "keyword" },
          "name": {
            "type": "text",
            "analyzer": "case_text_en",
            "fields": {
              "keyword": {
                "type": "keyword",
                "ignore_above": 512,
                "normalizer": "lowercase_keyword"
              }
            }
          },
          "role": { "type": "keyword" },
          "country": { "type": "keyword" }
        }
      },
      "custom_attributes": {
        "type": "flattened"
      }
    }
  }
}
```

### Kenapa desain ini masuk akal?

- `dynamic: strict` menjaga core schema.
- `schema_version` membantu migration/debugging.
- ID dan enum memakai `keyword`.
- `title` punya text dan keyword karena mungkin dipakai search dan sorting/exact display.
- `summary` hanya text karena tidak perlu sorting/facet.
- Permission fields keyword agar filter cepat.
- `parties` nested karena role/name correlation penting.
- `custom_attributes` flattened agar metadata fleksibel tidak meledakkan mapping.

---

## 13. Mapping untuk Permission-Aware Search

Permission field adalah bagian penting di search system enterprise.

Contoh document:

```json
{
  "case_id": "CASE-001",
  "tenant_id": "tenant-a",
  "allowed_user_ids": ["u-1", "u-2"],
  "allowed_role_ids": ["investigator", "supervisor"],
  "visibility_level": "RESTRICTED"
}
```

Mapping:

```json
"tenant_id": { "type": "keyword" },
"allowed_user_ids": { "type": "keyword" },
"allowed_role_ids": { "type": "keyword" },
"visibility_level": { "type": "keyword" }
```

Query filter:

```json
{
  "bool": {
    "filter": [
      { "term": { "tenant_id": "tenant-a" } },
      {
        "bool": {
          "should": [
            { "term": { "allowed_user_ids": "u-1" } },
            { "terms": { "allowed_role_ids": ["investigator"] } }
          ],
          "minimum_should_match": 1
        }
      }
    ],
    "must": [
      { "match": { "title": "transfer" } }
    ]
  }
}
```

Mapping mistake here can become data leakage. If `allowed_user_ids` is accidentally `text`, filter semantics can become wrong or inefficient.

Security-relevant fields should be:

- explicit;
- keyword;
- tested;
- not dynamic;
- included in query templates;
- covered by authorization regression tests.

---

## 14. Mapping untuk State Machine dan Lifecycle

Karena Anda sering bekerja di enforcement lifecycle / case management, mapping status fields perlu hati-hati.

Contoh buruk:

```json
{
  "status": "open pending review escalated"
}
```

Mapping text:

```json
"status": { "type": "text" }
```

Ini buruk karena lifecycle state bukan natural language.

Contoh lebih baik:

```json
{
  "lifecycle_status": "PENDING_REVIEW",
  "escalation_status": "ESCALATED",
  "assignment_status": "ASSIGNED",
  "sla_status": "BREACHED"
}
```

Mapping:

```json
"lifecycle_status": { "type": "keyword" },
"escalation_status": { "type": "keyword" },
"assignment_status": { "type": "keyword" },
"sla_status": { "type": "keyword" }
```

Keuntungan:

- filter jelas;
- facet jelas;
- audit jelas;
- query defensible;
- tidak ada tokenization ambiguity;
- state transition bisa dites.

---

## 15. Mapping untuk Identifiers, Codes, dan References

Search system sering gagal karena identifiers diperlakukan seperti text/numeric biasa.

Contoh regulatory references:

```json
{
  "regulation_refs": ["AML-10.4", "KYC-2.1.7"],
  "case_number": "000123/FIN/2026",
  "external_ref": "EXT-001-ABC"
}
```

Mapping:

```json
"regulation_refs": {
  "type": "keyword",
  "normalizer": "lowercase_keyword"
},
"case_number": {
  "type": "keyword",
  "normalizer": "lowercase_keyword"
},
"external_ref": {
  "type": "keyword",
  "normalizer": "lowercase_keyword"
}
```

Namun user mungkin ingin partial lookup seperti mengetik `001-ABC`. Ada beberapa opsi:

1. Tambahkan dedicated analyzed subfield.
2. Tambahkan normalized searchable reference tokens saat indexing.
3. Gunakan edge n-gram untuk specific autocomplete field.
4. Gunakan wildcard field untuk machine-generated lookup tertentu.

Jangan mencampur semua behavior ke satu field tanpa desain.

Contoh explicit derived field:

```json
"case_number": {
  "type": "keyword",
  "normalizer": "lowercase_keyword"
},
"case_number_search": {
  "type": "text",
  "analyzer": "reference_code_analyzer"
}
```

Java indexing service bisa menghasilkan `case_number_search` dari normalized variants.

---

## 16. Mapping untuk Sorting

Sorting harus didesain sejak awal.

Sorting field harus:

- `keyword`, numeric, date, boolean, atau field lain yang mendukung sorting;
- punya `doc_values`;
- tidak menggunakan `text` biasa.

Elastic search sort documentation recommends avoiding sorting by text fields and using keyword or numerical fields instead. Sumber: Elastic sort documentation: https://www.elastic.co/guide/en/elasticsearch/reference/8.19/sort-search-results.html

Contoh benar:

```json
"title": {
  "type": "text",
  "fields": {
    "sort": {
      "type": "keyword",
      "normalizer": "lowercase_keyword",
      "ignore_above": 512
    }
  }
}
```

Sort:

```json
{
  "sort": [
    { "title.sort": "asc" },
    { "case_id": "asc" }
  ]
}
```

Tambahkan tie-breaker seperti `case_id` agar pagination stabil.

---

## 17. Mapping untuk Aggregation dan Facet

Facet biasanya memakai `terms` aggregation. Field harus cocok untuk exact value, biasanya `keyword`.

Contoh:

```json
"risk_level": { "type": "keyword" },
"lifecycle_status": { "type": "keyword" },
"assigned_team_ids": { "type": "keyword" }
```

Aggregation:

```json
{
  "aggs": {
    "by_status": {
      "terms": {
        "field": "lifecycle_status"
      }
    },
    "by_risk": {
      "terms": {
        "field": "risk_level"
      }
    }
  }
}
```

### Facet anti-pattern

Jangan facet di field `text` seperti:

```json
"title": { "type": "text" }
```

Jika butuh facet/exact title, gunakan `title.keyword`.

Namun untuk field high-cardinality seperti title, facet biasanya tidak berguna dan mahal.

Pertanyaan desain:

- Apakah user benar-benar butuh facet field ini?
- Berapa cardinality field?
- Apakah facet count harus akurat?
- Apakah field punya normalisasi value?
- Apakah value berubah sering?

---

## 18. Mapping untuk Highlighting

Highlighting biasanya bekerja di field `text` yang dianalisis.

Contoh:

```json
"summary": {
  "type": "text",
  "analyzer": "case_text_en"
}
```

Query + highlight:

```json
GET cases-v1/_search
{
  "query": {
    "match": {
      "summary": "suspicious transfer"
    }
  },
  "highlight": {
    "fields": {
      "summary": {}
    }
  }
}
```

Jika field tidak dianalisis dengan benar, highlight bisa buruk.

Untuk long text, highlight bisa mahal. Pertimbangkan:

- batas field length;
- indexed offsets/term vectors jika perlu;
- snippet precomputation untuk beberapa use case;
- tidak highlight semua field sekaligus.

Detail highlighting akan dibahas di Part 018.

---

## 19. Field Explosion Problem

Field explosion terjadi ketika mapping punya terlalu banyak field.

Penyebab umum:

- dynamic mapping terbuka;
- arbitrary JSON object dari upstream;
- user-defined custom fields;
- log labels/tags tidak dikontrol;
- per-tenant custom schema dimasukkan ke index yang sama;
- field name mengandung ID dinamis.

Contoh buruk:

```json
{
  "metrics": {
    "latency_user_123": 50,
    "latency_user_456": 70,
    "latency_user_789": 90
  }
}
```

Lebih baik:

```json
{
  "metrics": [
    { "name": "latency", "user_id": "123", "value": 50 }
  ]
}
```

atau untuk arbitrary metadata:

```json
"labels": {
  "type": "flattened"
}
```

Aturan:

> Field name harus merepresentasikan schema, bukan data value.

Buruk:

```json
"permission_user_u123": true
```

Baik:

```json
"allowed_user_ids": ["u123"]
```

---

## 20. Mapping dan Java DTO

Java engineer sering ingin mapping mengikuti DTO.

Contoh DTO:

```java
public record CaseDocument(
    String caseId,
    String title,
    String status,
    List<Party> parties,
    Map<String, Object> customAttributes
) {}
```

Jangan otomatis generate mapping dari DTO tanpa desain.

DTO menjawab:

- data apa yang dikirim;
- bentuk JSON apa;
- type Java apa.

Mapping menjawab:

- bagaimana field dicari;
- bagaimana field difilter;
- bagaimana field disortir;
- bagaimana field diagregasi;
- bagaimana field berkembang.

### Naming convention

Java property:

```java
caseId
openedAt
allowedUserIds
```

JSON field:

```json
case_id
opened_at
allowed_user_ids
```

Mapping harus mengikuti JSON field, bukan nama Java internal.

### Strongly typed mapping contract

Untuk production, simpan mapping sebagai artifact:

```text
src/main/elasticsearch/cases-v1-mapping.json
src/main/elasticsearch/cases-v1-settings.json
src/test/java/.../CaseIndexMappingTest.java
```

Test minimal:

- mapping file valid JSON;
- field wajib ada;
- security field bertipe keyword;
- sortable field punya keyword/date/numeric;
- text field yang butuh exact punya subfield;
- dynamic mode sesuai;
- template bisa dibuat di test container/integration environment.

---

## 21. Mapping Validation Strategy

Mapping perlu diuji seperti contract.

### Test 1: Index creation test

```java
@Test
void canCreateCasesIndexWithMapping() {
    // create test index with mapping JSON
    // assert acknowledged
}
```

### Test 2: Index representative documents

Test document:

- normal case;
- minimal case;
- maximal case;
- field optional null/missing;
- nested parties;
- custom attributes;
- permission fields;
- date formats;
- large summary;
- weird identifiers.

### Test 3: Query compatibility

Run canonical queries:

- search title;
- filter status;
- filter permission;
- sort opened_at;
- aggregate status;
- nested party query;
- exact case number lookup.

### Test 4: Bad document should fail if strict

If `dynamic: strict`, document with unknown core field should fail.

This is good. It catches schema drift early.

### Test 5: Mapping snapshot diff

CI should detect mapping changes. Mapping changes should not slip in accidentally.

---

## 22. Mapping Evolution Patterns

### Pattern 1: Add non-breaking field

Add new field:

```json
"review_outcome": { "type": "keyword" }
```

Works for new documents. Old documents miss field.

Need:

- app handles missing field;
- optional filter semantics defined;
- maybe backfill.

---

### Pattern 2: Add new multi-field

Suppose existing:

```json
"title": { "type": "text" }
```

Want:

```json
"title": {
  "type": "text",
  "fields": {
    "keyword": { "type": "keyword" }
  }
}
```

Even if allowed to update mapping, old docs may need reindex so `title.keyword` is populated.

---

### Pattern 3: Change field type

From:

```json
"external_ref": { "type": "long" }
```

To:

```json
"external_ref": { "type": "keyword" }
```

Requires new index + reindex.

---

### Pattern 4: Object to nested

From:

```json
"parties": { "type": "object" }
```

To:

```json
"parties": { "type": "nested" }
```

Requires new index + reindex + query rewrite.

This is a major migration.

---

### Pattern 5: Analyzer change

Analyzer changes require reindex because tokens are created at index time.

From:

```json
"summary": { "type": "text", "analyzer": "standard" }
```

To:

```json
"summary": { "type": "text", "analyzer": "case_text_en" }
```

Need reindex.

---

## 23. Mapping Governance untuk Tim Besar

Untuk tim kecil, mapping sering dikelola manual. Untuk tim besar, mapping perlu governance.

### Governance rules

1. Semua mapping ada di version control.
2. Tidak ada production index dengan dynamic mapping bebas untuk core domain.
3. Setiap field baru harus menjawab query matrix.
4. Security fields harus explicit.
5. Field high-cardinality harus direview sebelum facet/aggs.
6. Long text tidak otomatis punya `.keyword`.
7. Identifier tidak otomatis numeric.
8. Unknown metadata masuk `flattened` atau rejected, bukan jadi field liar.
9. Mapping change harus punya compatibility note.
10. Breaking change harus pakai versioned index + alias migration.

### Mapping review checklist

Untuk setiap field:

```text
Field name:
Domain meaning:
Source system:
Required/optional:
Data examples:
Cardinality:
Used for full-text search? yes/no
Used for exact filter? yes/no
Used for facet? yes/no
Used for sort? yes/no
Used for range? yes/no
Used for permission? yes/no
Needs highlighting? yes/no
Needs analyzer? which one?
Needs normalizer? which one?
Expected null/missing behavior:
Migration impact:
```

---

## 24. Mapping Anti-Patterns

### Anti-pattern 1: Let dynamic mapping design production schema

```json
"dynamic": true
```

Untuk core search index production, ini undisciplined.

---

### Anti-pattern 2: Everything as text

```json
"status": { "type": "text" },
"tenant_id": { "type": "text" },
"case_id": { "type": "text" }
```

Menyebabkan filter/exact semantics buruk.

---

### Anti-pattern 3: Everything as keyword

```json
"summary": { "type": "keyword" }
```

Full-text search gagal.

---

### Anti-pattern 4: Blind text + keyword for every string

Boros dan membuat index besar.

---

### Anti-pattern 5: Nested everywhere

Nested mahal dan tidak perlu untuk semua object.

---

### Anti-pattern 6: Store all upstream payload as searchable fields

Search index bukan dumping ground semua data.

---

### Anti-pattern 7: Ignore mapping until query is slow

Saat query sudah production dan mapping salah, perbaikannya bisa reindex besar.

---

### Anti-pattern 8: Field names as data values

Buruk:

```json
"status_OPEN": true,
"status_CLOSED": false
```

Baik:

```json
"status": "OPEN"
```

---

### Anti-pattern 9: Permission fields not tested

Search result leakage often comes from missing or wrongly mapped authorization filters.

---

### Anti-pattern 10: Confusing display model and search model

Tidak semua field display harus searchable. Tidak semua searchable field harus display.

---

## 25. Practical Mapping Design Workflow

Gunakan workflow ini saat mendesain index baru.

### Step 1: Define search use cases

Contoh:

- search case by free-text query;
- filter by status/risk/team;
- search party name;
- exact lookup by case number;
- permission-aware search;
- sort by opened date;
- facet by lifecycle status;
- highlight summary snippets.

### Step 2: Define retrieval document

Tentukan field yang masuk document.

### Step 3: Build query matrix

Untuk setiap field, tentukan operation.

### Step 4: Choose field types

- full-text → `text`;
- exact/filter/facet/sort → `keyword`;
- time → `date`;
- quantity/range → numeric;
- correlated array object → `nested`;
- arbitrary metadata → `flattened`;
- display only → not indexed or `_source` only.

### Step 5: Decide analyzer/normalizer

- language;
- case-insensitive exact;
- code normalization;
- synonym handling;
- autocomplete field.

### Step 6: Decide dynamic policy

- strict for core;
- false for tolerant unknowns;
- flattened for flexible metadata;
- runtime for temporary/ad-hoc.

### Step 7: Create mapping and template

Store in repository.

### Step 8: Write indexing tests

Index representative docs.

### Step 9: Write query tests

Run canonical queries.

### Step 10: Plan evolution

- versioned index name;
- alias;
- reindex strategy;
- rollback strategy.

---

## 26. Worked Example: From Requirement to Mapping

Requirement:

> Investigator must search enforcement cases by title, summary, party name, case number, regulation reference, status, risk level, opened date, and assigned team. Results must be permission-filtered. UI needs facets for status, risk, team, and date histogram. Users can sort by opened date, updated date, priority score, and title.

### Step 1: Extract fields

```text
case_id
case_number
title
summary
parties.name
parties.role
regulation_refs
lifecycle_status
risk_level
opened_at
updated_at
assigned_team_ids
allowed_user_ids
allowed_role_ids
priority_score
```

### Step 2: Operation matrix

| Field | Operation |
|---|---|
| `case_id` | exact lookup, tie-break sort |
| `case_number` | exact lookup, case-insensitive |
| `title` | full-text, highlight, title sort |
| `summary` | full-text, highlight |
| `parties.name` | full-text, exact maybe |
| `parties.role` | exact filter inside nested |
| `regulation_refs` | exact filter/lookup |
| `lifecycle_status` | filter/facet |
| `risk_level` | filter/facet |
| `opened_at` | range/sort/date histogram |
| `updated_at` | sort/range |
| `assigned_team_ids` | filter/facet |
| `allowed_user_ids` | permission filter |
| `allowed_role_ids` | permission filter |
| `priority_score` | sort/ranking signal |

### Step 3: Mapping selection

```json
{
  "case_id": "keyword",
  "case_number": "keyword with normalizer",
  "title": "text + keyword sort subfield",
  "summary": "text",
  "parties": "nested",
  "regulation_refs": "keyword normalized",
  "lifecycle_status": "keyword",
  "risk_level": "keyword",
  "opened_at": "date",
  "updated_at": "date",
  "assigned_team_ids": "keyword",
  "allowed_user_ids": "keyword",
  "allowed_role_ids": "keyword",
  "priority_score": "integer"
}
```

### Step 4: Consequence

This mapping supports:

- free-text relevance;
- exact lookup;
- permission filtering;
- facet counts;
- stable sorting;
- nested party role/name correlation;
- controlled schema evolution.

It does not try to solve:

- arbitrary BI analytics;
- full relational joins;
- source-of-truth transactionality;
- unlimited custom fields.

That boundary is intentional.

---

## 27. Debugging Mapping Issues

### Symptom: exact filter returns no result

Possible causes:

- field mapped as `text`, query uses `term` with unanalyzed value;
- case mismatch on `keyword`;
- normalizer missing;
- value actually absent from indexed document;
- using wrong subfield.

Debug:

```json
GET cases-v1/_mapping/field/status
```

```json
GET cases-v1/_search
{
  "query": {
    "term": {
      "status": "OPEN"
    }
  }
}
```

---

### Symptom: sorting fails

Possible causes:

- sorting on `text` field;
- missing `.keyword` subfield;
- field has no `doc_values`;
- mixed field types across indices.

Fix:

- use `title.keyword` / `title.sort`;
- add proper subfield and reindex;
- avoid searching across incompatible indices.

---

### Symptom: aggregation error or weird buckets

Possible causes:

- aggregating on analyzed text;
- using wrong field;
- high cardinality;
- inconsistent normalization.

Fix:

- aggregate on keyword;
- normalize values;
- design facet fields explicitly.

---

### Symptom: ingestion fails with mapper parsing exception

Possible causes:

- field type conflict;
- dynamic strict rejects unknown field;
- date format mismatch;
- object vs scalar conflict;
- array contains inconsistent object structure.

Fix:

- inspect failed document;
- compare with mapping;
- add validation before indexing;
- adjust mapping only with migration discipline.

---

### Symptom: mapping exploded

Possible causes:

- dynamic metadata;
- arbitrary object fields;
- field names generated from IDs;
- multi-tenant custom fields.

Fix:

- stop ingestion if necessary;
- introduce `flattened`;
- cap dynamic fields;
- reindex into controlled schema;
- add producer validation.

---

## 28. Mapping and Cost Model

Mapping affects cost.

| Mapping Choice | Cost Consequence |
|---|---|
| `text` with heavy analyzer | More indexing CPU/storage |
| `keyword` with high cardinality | Larger terms dictionary/global ordinals cost for aggs |
| multi-field everywhere | More storage and indexing work |
| nested documents | More Lucene docs and query cost |
| dynamic mapping | cluster state growth risk |
| runtime fields | query-time CPU cost |
| doc_values enabled | storage cost but enables sort/aggs |
| `_source` enabled | storage cost but operational flexibility |
| wildcard field | useful for patterns, but not free |

There is no free mapping.

Top-tier engineers ask:

- What operation does this field support?
- What is its cardinality?
- How often is it queried?
- Is it in hot query path?
- Does it affect security?
- Does it affect ranking?
- Does it need migration safety?

---

## 29. Recommended Default Mapping Policy

Untuk production search index dengan Java backend:

```text
1. Use explicit mappings for all core fields.
2. Use dynamic: strict for core domain indices.
3. Use keyword for identifiers, enums, permissions, tenant IDs, codes.
4. Use text only for natural-language fields.
5. Use multi-fields only when there are real dual access patterns.
6. Use date for timestamps and business dates, with clear format semantics.
7. Use numeric only for real quantities/ranges/scores.
8. Use nested only when object correlation matters.
9. Use flattened for controlled arbitrary metadata.
10. Keep _source enabled unless there is a strong reason.
11. Store mappings/templates in version control.
12. Test mapping against representative documents and canonical queries.
13. Treat mapping changes as API/storage migrations.
```

---

## 30. Mini Lab

### Goal

Create an index mapping for `case-search-v1` that supports:

- full-text search on title and summary;
- exact lookup by case number;
- filter/facet by status and risk;
- sort by opened date and priority score;
- permission filter by user IDs and role IDs;
- nested search by party name and party role;
- arbitrary custom attributes without field explosion.

### Mapping

```json
PUT case-search-v1
{
  "settings": {
    "analysis": {
      "normalizer": {
        "lowercase_keyword": {
          "type": "custom",
          "filter": ["lowercase", "asciifolding"]
        }
      },
      "analyzer": {
        "case_text": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding"]
        }
      }
    }
  },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "case_id": { "type": "keyword" },
      "case_number": {
        "type": "keyword",
        "normalizer": "lowercase_keyword"
      },
      "title": {
        "type": "text",
        "analyzer": "case_text",
        "fields": {
          "sort": {
            "type": "keyword",
            "normalizer": "lowercase_keyword",
            "ignore_above": 512
          }
        }
      },
      "summary": {
        "type": "text",
        "analyzer": "case_text"
      },
      "status": { "type": "keyword" },
      "risk_level": { "type": "keyword" },
      "opened_at": { "type": "date" },
      "priority_score": { "type": "integer" },
      "allowed_user_ids": { "type": "keyword" },
      "allowed_role_ids": { "type": "keyword" },
      "parties": {
        "type": "nested",
        "properties": {
          "name": {
            "type": "text",
            "analyzer": "case_text",
            "fields": {
              "keyword": {
                "type": "keyword",
                "normalizer": "lowercase_keyword",
                "ignore_above": 512
              }
            }
          },
          "role": { "type": "keyword" },
          "party_id": { "type": "keyword" }
        }
      },
      "custom_attributes": { "type": "flattened" }
    }
  }
}
```

### Index document

```json
POST case-search-v1/_doc/CASE-001
{
  "case_id": "CASE-001",
  "case_number": "FIN-000123/2026",
  "title": "Suspicious cross-border transfer investigation",
  "summary": "The case concerns unusual fund transfers involving multiple jurisdictions.",
  "status": "OPEN",
  "risk_level": "HIGH",
  "opened_at": "2026-01-15T10:30:00Z",
  "priority_score": 85,
  "allowed_user_ids": ["u-100", "u-200"],
  "allowed_role_ids": ["investigator", "supervisor"],
  "parties": [
    {
      "party_id": "p-1",
      "name": "Alice Tan",
      "role": "COMPLAINANT"
    },
    {
      "party_id": "p-2",
      "name": "Bob Holdings Ltd",
      "role": "RESPONDENT"
    }
  ],
  "custom_attributes": {
    "source_system": "legacy-case-system",
    "import_batch": "batch-2026-01"
  }
}
```

### Search query

```json
GET case-search-v1/_search
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "cross border transfer",
            "fields": ["title^2", "summary"]
          }
        }
      ],
      "filter": [
        { "term": { "status": "OPEN" } },
        { "term": { "risk_level": "HIGH" } },
        {
          "bool": {
            "should": [
              { "term": { "allowed_user_ids": "u-100" } },
              { "terms": { "allowed_role_ids": ["investigator"] } }
            ],
            "minimum_should_match": 1
          }
        }
      ]
    }
  },
  "sort": [
    { "priority_score": "desc" },
    { "opened_at": "desc" },
    { "case_id": "asc" }
  ],
  "aggs": {
    "by_status": {
      "terms": { "field": "status" }
    },
    "by_risk": {
      "terms": { "field": "risk_level" }
    }
  },
  "highlight": {
    "fields": {
      "title": {},
      "summary": {}
    }
  }
}
```

### Nested query example

```json
GET case-search-v1/_search
{
  "query": {
    "nested": {
      "path": "parties",
      "query": {
        "bool": {
          "must": [
            { "match": { "parties.name": "Bob" } },
            { "term": { "parties.role": "RESPONDENT" } }
          ]
        }
      }
    }
  }
}
```

---

## 31. What Top 1% Engineers Understand About Mapping

Top-tier Elasticsearch engineers do not ask only:

> “What type should this field be?”

They ask:

1. What user behavior does this field support?
2. Is this field search text, exact value, quantity, timestamp, metadata, or security control?
3. Does this field need scoring?
4. Does this field need filter cache behavior?
5. Does this field need sorting/aggregation?
6. What is the cardinality?
7. What is the update frequency?
8. Is this field part of permission enforcement?
9. Does this field need highlighting?
10. Is this field stable or source-system-specific?
11. Can this field appear with inconsistent types?
12. What happens if upstream adds new fields?
13. What happens if this mapping is wrong?
14. Can this evolve without reindex?
15. Is the migration path clear?

Mapping mastery is less about memorizing field types and more about understanding **consequences**.

---

## 32. Ringkasan

Mapping adalah salah satu design surface paling penting dalam Elasticsearch.

Core ideas:

- Mapping adalah schema search, bukan hanya schema JSON.
- Field type dipilih berdasarkan access pattern, bukan hanya data shape.
- `text` untuk full-text; `keyword` untuk exact/filter/facet/sort.
- Multi-field berguna tetapi jangan dipakai membabi buta.
- `date`, numeric, boolean harus dipilih berdasarkan query semantics.
- Object array perlu `nested` jika korelasi antar property penting.
- `flattened` membantu mengontrol metadata dinamis.
- Dynamic mapping berguna untuk eksplorasi tetapi riskan untuk production.
- `dynamic: strict` sering cocok untuk regulated/core search index.
- `doc_values`, inverted index, dan `_source` punya fungsi berbeda.
- Mapping salah sering berarti reindex.
- Template dan version control wajib untuk production governance.
- Permission fields harus explicit dan tested.
- Mapping harus didesain dari query matrix.

---

## 33. Checklist Sebelum Lanjut

Sebelum masuk Part 007, pastikan Anda bisa menjawab:

1. Apa perbedaan `text` dan `keyword`?
2. Kenapa ID numeric-looking sering lebih baik sebagai `keyword`?
3. Apa risiko dynamic mapping?
4. Apa itu multi-field?
5. Kenapa sorting tidak boleh memakai `text` field biasa?
6. Apa fungsi `doc_values`?
7. Apa beda `_source` dan inverted index?
8. Kapan memakai `nested`?
9. Kapan memakai `flattened`?
10. Kenapa mapping salah sering butuh reindex?
11. Bagaimana mendesain mapping dari query matrix?
12. Bagaimana memastikan permission-aware search tidak bocor karena mapping salah?

Jika jawaban Anda sudah jelas, Anda siap lanjut ke Part 007: **Text Analysis Pipeline**.

---

## 34. Sumber Resmi yang Direferensikan

- Elastic Mapping Documentation: https://www.elastic.co/docs/manage-data/data-store/mapping
- Elastic Explicit Mapping Documentation: https://www.elastic.co/docs/manage-data/data-store/mapping/explicit-mapping
- Elastic Field Data Types Documentation: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/field-data-types
- Elastic Text Field Type Documentation: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/text
- Elastic Keyword Type Family Documentation: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/keyword
- Elastic Numeric Field Types Documentation: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/number
- Elastic Dynamic Field Mapping Documentation: https://www.elastic.co/docs/manage-data/data-store/mapping/dynamic-field-mapping
- Elastic Dynamic Templates Documentation: https://www.elastic.co/docs/manage-data/data-store/mapping/dynamic-templates
- Elastic Runtime Fields Documentation: https://www.elastic.co/docs/manage-data/data-store/mapping/runtime-fields
- Elastic Disk Usage Tuning Documentation: https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/disk-usage
- Elastic Sort Search Results Documentation: https://www.elastic.co/guide/en/elasticsearch/reference/8.19/sort-search-results.html

---

## 35. Status Seri

Seri belum selesai. Bagian berikutnya:

`learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-007.md`

Topik berikutnya:

**Text Analysis Pipeline — analyzer, tokenizer, token filter, char filter, index-time analysis, search-time analysis, language-aware analysis, custom analyzer design, dan debugging analyzer.**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Document Modeling for Search</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-007.md">Part 007 — Text Analysis Pipeline ➡️</a>
</div>
