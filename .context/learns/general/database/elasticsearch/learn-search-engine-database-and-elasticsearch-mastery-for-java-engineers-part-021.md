# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-021.md

# Part 021 — Performance Engineering I: Query Performance

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Bagian: `021 / 034`  
> Topik: Query Performance Engineering  
> Target pembaca: Java software engineer yang ingin mampu mendiagnosis, mendesain, dan mengoptimalkan search query Elasticsearch secara production-grade.  

---

## 0. Posisi Part Ini Dalam Seri

Di part sebelumnya, kita sudah membangun fondasi:

- Part 000–002: search sebagai retrieval problem.
- Part 003: Lucene segment, refresh, delete, merge.
- Part 004: Elasticsearch distributed architecture.
- Part 005–007: document modeling, mapping, dan text analysis.
- Part 008–009: Query DSL dan full-text query pattern.
- Part 010–011: relevance engineering.
- Part 012–013: filtering, faceting, pagination, sorting.
- Part 014–015: indexing, freshness, consistency, source-of-truth boundary.
- Part 016–017: Java integration dan backend search API design.
- Part 018–020: highlighting, multilingual/domain search, security, permission-aware search.

Part ini masuk ke tema baru: **performance engineering**.

Tujuan utamanya bukan menghafal setting, tetapi membangun kemampuan untuk menjawab pertanyaan seperti:

- Kenapa query ini lambat?
- Lambatnya di analyzer, query rewrite, posting list traversal, scoring, aggregation, fetch phase, network, atau coordination?
- Apakah query lambat karena data model salah?
- Apakah mapping salah?
- Apakah shard topology salah?
- Apakah API contract terlalu bebas sehingga user bisa menciptakan query mahal?
- Apakah masalahnya Elasticsearch atau service Java yang memanggilnya?
- Bagaimana membuktikan improvement secara objektif?

Top-tier Elasticsearch engineer tidak hanya mengatakan:

> “Tambah node saja.”

Mereka bertanya:

> “Apa exact workload-nya, query shape-nya, index shape-nya, selectivity-nya, shard fan-out-nya, cache behavior-nya, dan bottleneck phase-nya?”

---

## 1. Mental Model Utama: Search Latency Bukan Satu Angka

Ketika user mengatakan:

> “Search lambat.”

Itu bukan diagnosis. Itu gejala.

Search latency di Elasticsearch biasanya hasil kombinasi banyak tahap:

```text
Client request
  -> Java HTTP client serialization
  -> network to coordinating node
  -> coordinating node parses request
  -> query rewrite
  -> shard fan-out
  -> each shard executes query phase
       -> segment iteration
       -> term/posting lookup
       -> filter bitset evaluation
       -> scoring
       -> top-K collection
       -> aggregation collection
  -> shard returns partial result
  -> coordinating node merges top-K / aggregation partials
  -> fetch phase retrieves _source / stored fields / docvalue fields
  -> highlight / script field / inner hit processing
  -> response serialization
  -> network back to Java service
  -> Java deserialization
  -> service mapping / enrichment
  -> API response to frontend
```

Jika hanya melihat total latency, Anda tidak tahu bagian mana yang bermasalah.

Performance engineering berarti memecah latency menjadi komponen yang bisa diuji.

---

## 2. Tiga Jenis “Lambat” Yang Berbeda

### 2.1 Single Query Lambat

Contoh:

```text
Satu request search memakan 3 detik.
```

Kemungkinan penyebab:

- wildcard/regexp query mahal;
- query ke terlalu banyak shard;
- aggregation berat;
- sort pada field mahal;
- script score;
- nested query berat;
- highlighter membaca field besar;
- fetch `_source` terlalu besar;
- cold filesystem cache;
- shard tertentu lambat;
- thread pool penuh;
- heap pressure;
- disk IO lambat.

### 2.2 Throughput Rendah

Contoh:

```text
Query normal 80 ms saat traffic kecil, tapi 1.5 detik saat traffic tinggi.
```

Kemungkinan penyebab:

- CPU saturated;
- search thread pool queue meningkat;
- coordinating node bottleneck;
- terlalu banyak concurrent expensive queries;
- GC pressure;
- aggregation memory pressure;
- cache churn;
- shard count terlalu banyak;
- replica count tidak cukup untuk read concurrency;
- hot node / hot shard.

### 2.3 Tail Latency Buruk

Contoh:

```text
p50 = 60 ms
p95 = 700 ms
p99 = 5 detik
```

Kemungkinan penyebab:

- satu shard sering lambat;
- merge activity;
- GC pause;
- uneven shard allocation;
- cold segments;
- cache miss spike;
- occasional expensive query pattern;
- large result fetch;
- node-level resource contention;
- concurrent indexing pressure.

Top-tier engineer peduli tail latency karena user dan upstream service sering terkena p95/p99, bukan p50.

---

## 3. Prinsip Dasar: Query Performance Dimulai Dari Query Shape

Query shape adalah struktur logis dan fisik dari query.

Contoh query shape:

```json
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "t-001" }},
        { "term": { "visibility": "PUBLIC" }},
        { "range": { "created_at": { "gte": "now-90d" }}}
      ],
      "must": [
        { "multi_match": { "query": "late payment penalty", "fields": ["title^3", "body"] }}
      ]
    }
  },
  "sort": ["_score", { "created_at": "desc" }],
  "size": 20,
  "aggs": {
    "status": { "terms": { "field": "status.keyword" }}
  }
}
```

Yang memengaruhi cost:

- jumlah shard yang disentuh;
- jumlah segment per shard;
- selectivity filter;
- jenis query full-text;
- jumlah field yang dicari;
- scoring complexity;
- sort strategy;
- aggregation cardinality;
- size dan pagination depth;
- fetch payload;
- highlighting/script/nested/inner hits;
- cache eligibility.

Dua query yang terlihat mirip di API bisa punya cost sangat berbeda.

---

## 4. Query Context vs Filter Context Dari Perspektif Performance

Di part 008 kita sudah membahas query context dan filter context. Di sini kita fokus performance.

### 4.1 Query Context

Query context menjawab:

```text
Apakah document match, dan seberapa relevan document ini?
```

Karakteristik:

- menghitung `_score`;
- lebih CPU-intensive;
- dipakai untuk full-text relevance;
- tidak selalu cache-friendly;
- cocok untuk `match`, `multi_match`, `match_phrase`, ranking logic.

### 4.2 Filter Context

Filter context menjawab:

```text
Apakah document match, ya atau tidak?
```

Karakteristik:

- tidak menghitung score;
- lebih efisien untuk exact constraints;
- sering cacheable jika digunakan berulang;
- cocok untuk tenant, permission, status, date range, category, lifecycle state.

Dokumentasi Elastic menekankan bahwa filter context tidak menghitung relevance score dan frequently used filters dapat di-cache otomatis, sehingga filter sering lebih efisien daripada query scoring untuk constraint boolean.  
Reference: <https://www.elastic.co/docs/reference/query-languages/query-dsl/query-filter-context>

### 4.3 Rule of Thumb

Gunakan `filter` untuk:

- tenant boundary;
- authorization boundary;
- status;
- lifecycle;
- category;
- type;
- exact date range constraint;
- flags;
- numeric range yang tidak perlu score;
- permission filters.

Gunakan `must`/query context untuk:

- text relevance;
- semantic match;
- scoring-sensitive condition;
- clause yang memang harus memengaruhi ranking.

Buruk:

```json
{
  "bool": {
    "must": [
      { "term": { "tenant_id": "t-001" }},
      { "term": { "status": "ACTIVE" }},
      { "match": { "body": "fraud investigation" }}
    ]
  }
}
```

Lebih baik:

```json
{
  "bool": {
    "filter": [
      { "term": { "tenant_id": "t-001" }},
      { "term": { "status": "ACTIVE" }}
    ],
    "must": [
      { "match": { "body": "fraud investigation" }}
    ]
  }
}
```

Bukan karena hasilnya selalu berbeda, tetapi karena maksud dan cost model-nya lebih jelas.

---

## 5. Latency Decomposition: Query Phase vs Fetch Phase

Distributed search Elasticsearch secara konseptual punya dua fase besar:

1. Query phase.
2. Fetch phase.

### 5.1 Query Phase

Shard menjalankan query lokal:

- evaluate query;
- score candidate documents;
- collect top-K hits;
- collect aggregation partials;
- return document IDs dan scores ke coordinating node.

Query phase mahal jika:

- query harus scan banyak posting list;
- filter tidak selektif;
- scoring kompleks;
- aggregation high cardinality;
- sort mahal;
- nested query banyak;
- script query/script score;
- shard/segment banyak.

### 5.2 Fetch Phase

Setelah coordinating node tahu global top-K, ia meminta data document sebenarnya:

- `_source`;
- stored fields;
- docvalue fields;
- highlight;
- inner hits;
- script fields.

Fetch phase mahal jika:

- `_source` besar;
- banyak field dikembalikan;
- banyak nested inner hits;
- highlighter membaca field besar;
- compression/decompression mahal;
- response payload besar;
- Java service memapping response terlalu berat.

### 5.3 Diagnosis Sederhana

Jika query tanpa `_source` jauh lebih cepat:

```json
{
  "_source": false,
  "query": { ... },
  "size": 20
}
```

maka bottleneck mungkin di fetch/payload/highlight, bukan matching/scoring.

Jika `size: 0` dengan aggregation tetap lambat, bottleneck mungkin aggregation/query phase.

Jika `size: 0` tanpa aggregation cepat, tapi dengan aggregation lambat, aggregation adalah tersangka utama.

---

## 6. Profiling Query Dengan Search Profile API

Elasticsearch menyediakan Profile API untuk melihat timing komponen query secara detail.

Elastic menjelaskan Profile API sebagai debugging tool yang memberikan timing detail dari eksekusi komponen search, tetapi juga memberi peringatan bahwa profiling menambah overhead signifikan dan tidak boleh dianggap sebagai latency normal production.  
Reference: <https://www.elastic.co/docs/reference/elasticsearch/rest-apis/search-profile>

### 6.1 Contoh Profile API

```json
GET cases-v1/_search
{
  "profile": true,
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "t-001" }},
        { "term": { "status": "OPEN" }}
      ],
      "must": [
        { "multi_match": {
          "query": "late payment penalty",
          "fields": ["title^3", "description", "notes"]
        }}
      ]
    }
  },
  "size": 20
}
```

### 6.2 Apa Yang Dicari Dari Profile Output

Cari:

- shard mana paling lambat;
- query component mana paling mahal;
- apakah rewrite mahal;
- apakah scorer banyak waktu;
- apakah collector mahal;
- apakah aggregation collector mahal;
- apakah query berbeda cost antar shard.

### 6.3 Cara Membaca Secara Praktis

Jangan langsung tenggelam dalam semua angka.

Mulai dari pertanyaan:

1. Shard mana paling lambat?
2. Apakah semua shard lambat atau hanya satu?
3. Query clause mana paling mahal?
4. Apakah filter mahal atau scoring mahal?
5. Apakah cost lebih banyak di query atau aggregation?
6. Apakah rewrite time tinggi?
7. Apakah ada suspicious query seperti wildcard, regexp, phrase, nested, script?

### 6.4 Kesalahan Umum Menggunakan Profile API

Kesalahan:

```text
Profile query sekali, lalu menyimpulkan semua performance problem.
```

Masalah:

- hasil profiling punya overhead;
- cache state berubah;
- cold/warm filesystem cache memengaruhi angka;
- satu query belum tentu representatif;
- p99 problem mungkin tidak muncul di sample kecil.

Gunakan profile untuk diagnosis mikro, bukan satu-satunya observability.

---

## 7. Slow Logs: Bukti Historis Query Mahal

Search slow log mencatat search operation yang melewati threshold tertentu. Elastic mendeskripsikan slow log sebagai alat untuk investigasi, analisis, audit heavy operations, dan troubleshooting historical search/indexing performance.  
Reference: <https://www.elastic.co/docs/deploy-manage/monitor/logging-configuration/slow-logs>

### 7.1 Mengapa Slow Log Penting

Profile API baik untuk query yang Anda pilih.

Slow log baik untuk menemukan query yang benar-benar terjadi di production.

Tanpa slow log, Anda sering hanya mengoptimalkan query yang mudah direproduksi, bukan query yang paling menyakiti cluster.

### 7.2 Threshold Bertingkat

Contoh konsep threshold:

```text
WARN  > 5s
INFO  > 2s
DEBUG > 500ms
TRACE > 100ms
```

Jangan asal menyalakan TRACE untuk semua index di production tanpa pertimbangan volume log.

### 7.3 Informasi Yang Harus Dicari

Dari slow log, kumpulkan:

- index target;
- shard;
- took;
- query body;
- size;
- sort;
- aggregation;
- user/API endpoint jika ada opaque id/correlation id;
- tenant jika bisa dikaitkan;
- time-of-day pattern.

### 7.4 Praktik Java: Pakai Opaque ID

Untuk correlation, Java service sebaiknya mengirim header request identifier ke Elasticsearch.

Konsepnya:

```text
HTTP request id / trace id
  -> Java service logs
  -> Elasticsearch request metadata / logs
  -> APM trace
  -> slow log correlation
```

Dengan begitu, saat slow log muncul, Anda bisa tahu endpoint mana yang mengirim query tersebut.

---

## 8. Cache Dalam Elasticsearch: Jangan Disederhanakan Menjadi “Query Di-cache”

Cache di Elasticsearch ada beberapa jenis. Masing-masing berbeda.

### 8.1 Filesystem Cache

Elasticsearch sangat bergantung pada filesystem cache agar search cepat. Elastic merekomendasikan agar sebagian besar memory tersedia untuk filesystem cache; dokumentasi performance search menyatakan Elasticsearch heavily relies on filesystem cache dan umumnya setidaknya separuh memory tersedia untuk cache filesystem.  
Reference: <https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/search-speed>

Implikasi:

- jangan memberikan seluruh RAM ke JVM heap;
- hot index segments perlu tinggal di OS page cache;
- cold query setelah restart bisa lebih lambat;
- disk IO tetap penting;
- memory sizing tidak hanya heap sizing.

### 8.2 Node Query Cache

Node query cache menyimpan hasil filter query tertentu secara segment-level.

Elastic mendokumentasikan bahwa query cache dilakukan per segment dan hanya pada segment yang memenuhi ukuran tertentu; merge segment dapat menginvalidasi cached queries. Dokumentasi juga menyebut cache default menampung maksimum 10.000 query hingga 10% heap.  
Reference: <https://www.elastic.co/docs/reference/elasticsearch/configuration-reference/node-query-cache-settings>

Implikasi:

- filter yang sering dipakai bisa sangat menguntungkan;
- query unik terus-menerus tidak cache-friendly;
- segment merge bisa membuat cache invalid;
- cache bukan pengganti data model yang baik;
- query scoring biasanya bukan kandidat utama cache.

### 8.3 Shard Request Cache

Shard request cache menyimpan local result pada shard. Elastic menjelaskan request cache sangat cocok untuk logging use case, terutama ketika index lama tidak aktif di-update dan query berat dapat kembali hampir instan dari cache.  
Reference: <https://www.elastic.co/docs/reference/elasticsearch/rest-apis/shard-request-cache>

Biasanya berguna untuk:

- dashboard aggregation;
- `size: 0` queries;
- time-based historical indices;
- stable filters;
- repeated aggregation queries.

Kurang berguna untuk:

- personalized query;
- every request unique;
- index sangat sering berubah;
- search result hits yang berubah terus;
- query dengan `now` yang membuat cache key berubah.

### 8.4 Fielddata Cache

Fielddata/global ordinals dipakai untuk aggregation/sorting pada field tertentu. Elastic menyatakan field data cache berisi field data dan global ordinals yang mendukung aggregations pada tipe field tertentu dan merupakan on-heap data structures yang perlu dimonitor.  
Reference: <https://www.elastic.co/docs/reference/elasticsearch/configuration-reference/field-data-cache-settings>

Implikasi:

- aggregation pada `text` field dapat menyebabkan masalah besar;
- gunakan `keyword`/doc_values untuk facet/sort;
- monitor heap;
- high-cardinality aggregation bisa memicu memory pressure.

---

## 9. Filter Selectivity: Bukan Semua Filter Sama

Filter dianggap “murah” hanya kalau desainnya masuk akal.

### 9.1 Selective Filter

Contoh:

```json
{ "term": { "tenant_id": "t-001" }}
```

Jika tenant hanya punya 1% data, filter ini sangat membantu.

### 9.2 Non-Selective Filter

Contoh:

```json
{ "term": { "is_deleted": false }}
```

Jika 99.9% document `is_deleted=false`, filter ini hampir tidak mengurangi candidate set.

Bukan berarti filter ini tidak boleh, tetapi jangan berharap ia mempercepat query secara signifikan.

### 9.3 Permission Filter Dengan Banyak Terms

Contoh:

```json
{
  "terms": {
    "allowed_group_ids": ["g1", "g2", "g3", "...", "g5000"]
  }
}
```

Masalah:

- request payload besar;
- query rewrite mahal;
- posting union besar;
- cache key unik per user;
- authorization leakage risk jika salah komposisi.

Alternatif desain:

- coarse-grained access tier;
- role-derived visibility fields;
- tenant/index separation;
- precomputed permission groups;
- search application layer authorization dengan result trimming hanya jika acceptable;
- document-level security jika cocok dengan lisensi/operational model.

Untuk enterprise/regulatory system, permission filter adalah performance dan security problem sekaligus.

---

## 10. Expensive Query Classes

Tidak semua query DSL setara. Beberapa query sangat mudah membuat cluster tersiksa.

### 10.1 Wildcard Query

Contoh berisiko:

```json
{ "wildcard": { "name.keyword": "*john*" }}
```

Masalah:

- leading wildcard mahal;
- sulit memanfaatkan term dictionary secara efisien;
- bisa menyentuh banyak term;
- query user-generated dapat menjadi abuse vector.

Lebih baik jika kebutuhan adalah autocomplete/contains search:

- desain analyzer dengan n-gram/edge n-gram secara sadar;
- gunakan `search_as_you_type` untuk use case tertentu;
- gunakan normalized keyword untuk exact/prefix jika cukup;
- batasi input user.

### 10.2 Regexp Query

Regexp bisa sangat mahal, terutama pola yang luas.

Buruk:

```json
{ "regexp": { "case_number.keyword": ".*2024.*" }}
```

Biasanya indikator bahwa field/modeling belum mendukung access pattern.

### 10.3 Query String Bebas

`query_string` powerful, tetapi berbahaya jika expose langsung ke user biasa:

- syntax error;
- wildcard bebas;
- field expansion;
- operator kompleks;
- query mahal;
- behavior sulit diprediksi.

Untuk public/user-facing search, sering lebih aman memakai:

- `simple_query_string`;
- controlled `multi_match`;
- query parser sendiri;
- whitelist fields;
- limit operator.

### 10.4 Script Query / Script Score

Script memberi fleksibilitas, tetapi mahal.

Risiko:

- CPU heavy;
- sulit cache;
- scale buruk jika diterapkan ke banyak candidates;
- debugging ranking lebih sulit;
- security/config constraints.

Jika perlu script score, batasi candidate set dulu dengan filter/query yang selektif.

### 10.5 Nested Query

Nested query penting untuk correctness, tetapi lebih mahal daripada flat field.

Masalah:

- nested docs adalah Lucene docs terpisah;
- join-like behavior terjadi di dalam shard;
- inner hits bisa sangat mahal;
- banyak nested object memperbesar index dan query cost.

Gunakan nested ketika correlation antar field dalam object harus benar.

Jangan gunakan nested hanya karena JSON Anda punya array object.

### 10.6 Phrase Query

`match_phrase` lebih mahal daripada `match` biasa karena positional constraint.

Wajar dipakai untuk:

- exact phrase importance;
- legal phrase;
- identifier-like phrase;
- title phrase boost.

Berbahaya jika semua query dijalankan sebagai phrase match di banyak field besar.

---

## 11. Sorting Cost

Sorting terlihat sederhana, tetapi bisa mahal.

### 11.1 Sorting By `_score`

Default full-text search biasanya sort by score.

Cost:

- perlu scoring;
- top-K collection berdasarkan score;
- score computation tergantung query.

### 11.2 Sorting By Date/Numeric/Keyword

Sorting by field biasanya mengandalkan doc values.

Pastikan field:

- bukan `text`;
- punya `doc_values`;
- tipe sesuai;
- cardinality dipahami;
- missing value handling jelas.

### 11.3 Sorting Dengan Tie-Breaker

Buruk:

```json
"sort": [
  { "created_at": "desc" }
]
```

Jika banyak docs punya timestamp sama, pagination bisa tidak stabil.

Lebih baik:

```json
"sort": [
  { "created_at": "desc" },
  { "case_id.keyword": "asc" }
]
```

Atau tie-breaker internal yang sesuai dengan desain PIT/search_after.

### 11.4 Index Sorting

Index sorting dapat membantu query yang sering melakukan sort/filter tertentu, tetapi trade-off-nya:

- indexing lebih mahal;
- merge lebih mahal;
- tidak fleksibel untuk semua sort;
- harus dirancang sesuai dominant query pattern.

Jangan memakai index sorting sebagai magic optimization.

---

## 12. Aggregation Cost Model

Aggregation bukan sekadar “GROUP BY Elasticsearch”.

### 12.1 Terms Aggregation

Cost dipengaruhi oleh:

- cardinality field;
- jumlah shard;
- `size`;
- `shard_size`;
- global ordinals;
- field type;
- query filter selectivity;
- memory.

Aggregation pada `status.keyword` biasanya murah.

Aggregation pada `user_id.keyword` dengan jutaan unique values bisa mahal.

### 12.2 Date Histogram

Cost dipengaruhi oleh:

- time range;
- interval;
- number of buckets;
- number of matching docs;
- time zone handling;
- sub-aggregations.

### 12.3 Cardinality Aggregation

Cardinality bersifat approximate.

Gunakan untuk estimasi, bukan selalu untuk angka legal/audit final.

### 12.4 Composite Aggregation

Composite aggregation cocok untuk pagination bucket, bukan sekadar facet UI biasa.

Gunakan ketika Anda perlu iterate banyak bucket secara terkontrol.

### 12.5 Aggregation + Hits Dalam Search UI

Search page sering butuh:

- top 20 hits;
- facet counts;
- date histogram;
- maybe permission filtering;
- highlighting.

Semuanya dalam satu request bisa nyaman, tetapi mahal.

Kadang lebih baik memisahkan:

- result request;
- facet request;
- expensive analytics request;
- cached historical aggregation.

Namun pemisahan request punya trade-off consistency dan UX.

---

## 13. Pagination Performance

Part 013 sudah membahas pagination design. Di sini fokus cost.

### 13.1 `from + size`

Contoh:

```json
{
  "from": 10000,
  "size": 20
}
```

Masalah:

- setiap shard perlu mengumpulkan banyak result sebelum coordinating node membuang sebagian;
- memory dan CPU naik seiring depth;
- tail latency memburuk;
- default `index.max_result_window` ada untuk mencegah pola ini menjadi tak terbatas.

### 13.2 `search_after` + PIT

Untuk interactive deep navigation, gunakan `search_after` dengan sort stabil dan PIT.

Cost lebih terkendali karena tidak meminta Elasticsearch melewati semua offset seperti `from` besar.

### 13.3 Export Bukan Search Page

Export ribuan/jutaan data tidak boleh memakai endpoint search UI dengan pagination biasa.

Desain khusus:

- async job;
- PIT/search_after atau scroll sesuai use case;
- batch size terkendali;
- no expensive highlight;
- no UI facet;
- output streaming/storage;
- rate limit;
- audit.

---

## 14. Fetch Phase Optimization

Banyak engineer hanya mengoptimalkan query, padahal fetch phase sering penyebab latency.

### 14.1 Batasi `_source`

Buruk:

```json
{
  "query": { ... },
  "size": 20
}
```

Jika `_source` berisi document besar, response berat.

Lebih baik:

```json
{
  "_source": [
    "case_id",
    "title",
    "status",
    "priority",
    "created_at",
    "summary"
  ],
  "query": { ... },
  "size": 20
}
```

### 14.2 Pisahkan Search Result Summary vs Detail Page

Search result page tidak perlu semua field.

Pola baik:

```text
Search result document
  -> compact fields for result card

Detail endpoint
  -> canonical DB or Elasticsearch detail projection
```

### 14.3 Highlighting Cost

Highlighting bisa mahal karena perlu mengambil dan memproses text.

Batasi:

- field yang di-highlight;
- fragment size;
- number of fragments;
- document count;
- gunakan hanya di result page tertentu;
- jangan highlight semua large fields by default.

### 14.4 Inner Hits Cost

Nested inner hits bisa sangat mahal.

Gunakan hanya jika UI benar-benar perlu menunjukkan nested object yang match.

---

## 15. Shard Fan-Out: Query Kecil Bisa Menjadi Query Besar

Jika index punya 100 shard dan satu search menyentuh semua shard, satu request client menjadi 100 shard-level query.

### 15.1 Fan-Out Cost

```text
1 API request
  -> 100 shard requests
  -> 100 local top-K collections
  -> coordinating merge
```

Cost:

- network;
- CPU;
- queue;
- memory;
- coordination;
- tail latency mengikuti shard paling lambat.

### 15.2 Routing

Jika data punya tenant partition yang kuat, custom routing bisa mengurangi shard fan-out.

Contoh:

```text
Search tenant t-001
  -> only shard(s) containing tenant t-001
```

Tapi custom routing punya trade-off:

- hot tenant bisa membuat hot shard;
- shard balance harus dipikirkan;
- perubahan routing sulit;
- cross-tenant query menjadi berbeda;
- migration complexity.

Elastic memiliki dokumentasi search shard routing yang menjelaskan bagaimana routing/preference dapat memengaruhi shard yang dipakai search.  
Reference: <https://www.elastic.co/docs/reference/elasticsearch/rest-apis/search-shard-routing>

### 15.3 Banyak Index Juga Fan-Out

Query ke alias yang menunjuk banyak index/time-based index juga bisa fan-out besar.

Contoh buruk:

```text
Search all historical cases from 10 years without time filter
```

Lebih baik:

- require date range;
- use lifecycle-aware index aliases;
- route current vs archive search;
- split search mode: recent vs historical.

---

## 16. Hot Shards dan Uneven Workload

Hot shard terjadi ketika satu atau beberapa shard menerima traffic jauh lebih besar daripada yang lain.

Penyebab:

- routing key skew;
- tenant besar;
- time-based index hanya menulis/mencari current shard;
- query pattern selalu menyentuh subset kecil data;
- shard allocation tidak merata;
- node hardware berbeda;
- replica imbalance.

Gejala:

- satu node CPU tinggi;
- search latency p99 tinggi;
- thread pool queue di node tertentu;
- slow log didominasi shard tertentu;
- disk IO node tertentu tinggi;
- cache hit ratio berbeda antar node.

Diagnosis:

- `_cat/shards` untuk inspeksi manual;
- index stats level shard;
- node stats;
- slow logs;
- APM trace;
- dashboard per node/per shard.

Elastic mendokumentasikan cat shards untuk informasi shard dan menyatakan cat APIs ditujukan untuk human consumption, bukan aplikasi.  
Reference: <https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-cat-shards>

---

## 17. Coordinating Node Bottleneck

Setiap node bisa bertindak sebagai coordinating node untuk request search.

Coordinating node melakukan:

- menerima request;
- fan-out ke shard;
- mengumpulkan partial result;
- merge top-K;
- reduce aggregations;
- fetch coordination;
- response serialization.

Bottleneck muncul ketika:

- request aggregation berat;
- query menyentuh banyak shard;
- result size besar;
- response payload besar;
- banyak concurrent search;
- node yang juga data/master melakukan terlalu banyak coordination.

Gejala:

- CPU tinggi di node penerima traffic;
- latency tinggi walau data nodes tidak terlalu tinggi;
- queue/search coordination meningkat;
- large response serialization;
- GC pressure di coordinating nodes.

Solusi potensial:

- load balance request ke lebih banyak nodes;
- dedicated coordinating nodes untuk workload besar;
- kurangi shard fan-out;
- batasi aggregation/result size;
- pisahkan API expensive;
- enforce query guardrails.

---

## 18. Query Cache Hit Tidak Selalu Tujuan

Sering ada pertanyaan:

> “Bagaimana meningkatkan cache hit ratio?”

Pertanyaan yang lebih baik:

> “Apakah workload saya memang cacheable?”

Workload cacheable:

- dashboard filter berulang;
- historical index jarang berubah;
- common tenant/status/date filters;
- aggregation `size: 0` berulang;
- controlled query templates.

Workload tidak cacheable:

- setiap user mengetik keyword berbeda;
- query menggunakan `now` secara dinamis;
- permission terms berbeda per user;
- personalized ranking;
- high-cardinality random filters;
- constantly updated index.

Jika query tidak cacheable, jangan mengejar cache sebagai strategi utama.

Fokus ke:

- data model;
- field type;
- shard sizing;
- query simplification;
- candidate reduction;
- pagination design;
- aggregation reduction;
- hardware/filesystem cache;
- concurrency control.

---

## 19. `now` Dalam Query dan Cache Invalidation

Contoh:

```json
{
  "range": {
    "created_at": {
      "gte": "now-7d"
    }
  }
}
```

Ini nyaman, tetapi `now` berubah terus.

Implikasi:

- cache key bisa berubah;
- repeated query kurang cacheable;
- hasil berubah per waktu;
- sulit menguji deterministik.

Alternatif:

Java service membulatkan waktu:

```text
now = 2026-06-21T12:34:56
rounded_now = 2026-06-21T12:30:00
range = [rounded_now - 7d, rounded_now]
```

Atau gunakan fixed date dari request context.

Trade-off:

- freshness sedikit berkurang;
- cacheability dan reproducibility meningkat.

Untuk regulatory search, deterministic query window sering lebih penting daripada perubahan per detik.

---

## 20. Search Performance Guardrails di API Layer

Query performance tidak cukup diselesaikan di Elasticsearch. Backend API harus mencegah query buruk.

### 20.1 Guardrail Wajib

Batasi:

- maximum `size`;
- maximum pagination depth;
- allowed sort fields;
- allowed facet fields;
- maximum number of facets;
- maximum date range;
- wildcard usage;
- regex usage;
- number of search fields;
- highlight fields;
- phrase query usage;
- nested inner hits;
- terms filter size;
- aggregation bucket size.

### 20.2 Contoh Search Request Contract

```json
{
  "keyword": "late payment",
  "filters": {
    "status": ["OPEN", "UNDER_REVIEW"],
    "createdFrom": "2026-01-01",
    "createdTo": "2026-06-21"
  },
  "sort": "RELEVANCE",
  "page": {
    "mode": "search_after",
    "size": 20,
    "after": null
  },
  "facets": ["status", "priority", "caseType"],
  "highlight": true
}
```

Backend menerjemahkan request ini ke DSL terkontrol.

Jangan expose DSL mentah ke frontend untuk user-facing app kecuali memang admin/internal expert tool dengan guardrail kuat.

---

## 21. Java Service: Timeout, Retry, dan Backpressure

Search performance bukan hanya Elasticsearch.

Java service harus punya:

- connect timeout;
- socket/request timeout;
- max retry yang terbatas;
- retry hanya untuk error yang aman;
- circuit breaker;
- bulkhead per endpoint;
- rate limit;
- queue limit;
- cancellation propagation jika user request batal;
- observability per query type.

### 21.1 Timeout Berlapis

Contoh mental model:

```text
Frontend timeout: 10s
API gateway timeout: 8s
Java service endpoint budget: 6s
Elasticsearch search timeout: 4s
Internal mapping/enrichment budget: 1s
Buffer: 1s
```

Jangan Elasticsearch request timeout lebih panjang daripada upstream timeout. Itu hanya menciptakan zombie work.

### 21.2 Retry Bisa Membuat Insiden Lebih Parah

Jika cluster lambat karena overload, retry agresif akan menambah beban.

Gunakan:

- exponential backoff;
- jitter;
- retry budget;
- no retry for expensive search by default;
- fallback response jika sesuai;
- circuit breaker.

### 21.3 Backpressure

Jika search endpoint mahal, API harus bisa menolak sebagian request sebelum menghancurkan cluster.

Contoh:

- per-tenant concurrency limit;
- per-user expensive query rate limit;
- queue depth limit;
- reject export ketika cluster unhealthy;
- degrade facets/highlights saat load tinggi.

---

## 22. Observability Metric Untuk Query Performance

Minimal dashboard:

### 22.1 Application Metrics

- search endpoint latency p50/p95/p99;
- Elasticsearch client latency;
- request payload size;
- response payload size;
- query type distribution;
- timeout count;
- retry count;
- rejected request count;
- top slow query templates;
- per-tenant latency.

### 22.2 Elasticsearch Metrics

- search query time;
- search fetch time;
- search query current;
- search fetch current;
- thread pool queue/rejection;
- CPU;
- heap;
- GC;
- filesystem cache/disk IO;
- segment count;
- fielddata memory;
- request cache hit/miss;
- query cache memory/eviction;
- hot nodes/shards;
- slow logs.

### 22.3 Relevance-Aware Metrics

Performance optimization tidak boleh merusak quality.

Pantau juga:

- zero-result rate;
- click-through;
- reformulation rate;
- top query latency;
- top query relevance regression;
- user abandonment.

Search yang cepat tapi salah bukan sukses.

---

## 23. Diagnostic Workflow: Dari Gejala Ke Penyebab

Gunakan workflow ini saat search lambat.

### Step 1 — Klasifikasikan Masalah

Pertanyaan:

```text
Apakah semua query lambat atau hanya query tertentu?
Apakah terjadi terus-menerus atau spike?
Apakah p50 juga buruk atau hanya p95/p99?
Apakah terjadi di semua tenant atau tenant tertentu?
Apakah search result, aggregation, autocomplete, atau export?
Apakah bertepatan dengan indexing/backfill/deployment?
```

### Step 2 — Ambil Query Konkret

Jangan debug “search lambat” secara abstrak.

Ambil:

- request body;
- endpoint;
- tenant/user class;
- index/alias target;
- timestamp;
- took;
- trace id;
- ES node;
- shard jika ada slow log.

### Step 3 — Reproduksi Dengan Kontrol

Jalankan variasi:

1. original query;
2. `_source: false`;
3. `size: 0`;
4. tanpa aggregation;
5. tanpa highlight;
6. tanpa sort khusus;
7. filter-only;
8. query-only;
9. single index vs alias banyak index;
10. dengan profile.

Tujuannya memisahkan bottleneck.

### Step 4 — Baca Profile dan Slow Log

Cari:

- clause paling mahal;
- shard paling lambat;
- aggregation paling mahal;
- fetch time besar;
- rewrite time besar;
- query/fetch imbalance.

### Step 5 — Cek Cluster State dan Resource

Cek:

- CPU;
- heap;
- GC;
- search queue;
- rejected execution;
- disk IO;
- segment count;
- shard allocation;
- ongoing merges;
- indexing pressure.

### Step 6 — Tentukan Kelas Solusi

Solusi bisa berada di beberapa level:

| Level | Contoh Solusi |
|---|---|
| Query DSL | ubah wildcard ke match/prefix/analyzer |
| Mapping | gunakan keyword/doc_values untuk sort/facet |
| Analyzer | desain autocomplete index-time |
| API contract | batasi date range/facet/sort |
| Data model | denormalisasi field filter |
| Index topology | kurangi shard fan-out |
| Capacity | tambah replica/node/hardware |
| UX | async export, no deep page |
| Operations | cache warming, slow log, dashboard |

### Step 7 — Validasi Improvement

Jangan puas dengan “terasa lebih cepat”.

Ukur:

- p50/p95/p99 sebelum/sesudah;
- CPU sebelum/sesudah;
- query time/fetch time;
- rejected count;
- relevance regression;
- result correctness;
- memory impact.

---

## 24. Query Rewrite: Cost Yang Sering Terlupakan

Beberapa query perlu di-rewrite sebelum dieksekusi.

Contoh:

- wildcard;
- prefix;
- regexp;
- fuzzy;
- multi-term query;
- query string expansion.

Rewrite bisa menghasilkan banyak term. Jika terlalu banyak, query menjadi mahal sebelum scoring dimulai.

Gejala:

- profile menunjukkan rewrite time signifikan;
- query dengan input pendek seperti `a*` sangat lambat;
- query string user menciptakan expansion besar;
- autocomplete salah desain.

Solusi:

- minimum input length;
- no leading wildcard;
- use edge n-gram/search_as_you_type;
- field whitelist;
- max expansions;
- query parser API layer.

---

## 25. Performance Pattern: Candidate Reduction Before Expensive Scoring

Jika memakai expensive scoring, batasi candidate set dulu.

Buruk:

```json
{
  "query": {
    "script_score": {
      "query": { "match_all": {} },
      "script": { "source": "... expensive ..." }
    }
  }
}
```

Lebih baik:

```json
{
  "query": {
    "script_score": {
      "query": {
        "bool": {
          "filter": [
            { "term": { "tenant_id": "t-001" }},
            { "term": { "status": "OPEN" }}
          ],
          "must": [
            { "match": { "body": "late payment" }}
          ]
        }
      },
      "script": { "source": "... expensive ..." }
    }
  }
}
```

Lebih advanced:

```text
Phase 1: retrieve candidates cheaply
Phase 2: rescore top N
Phase 3: maybe rerank in application/model
```

Jangan menjalankan expensive logic pada seluruh corpus.

---

## 26. Performance Pattern: Split User Search and Analytics

Search UI dan analytics dashboard sering bercampur.

Contoh endpoint buruk:

```text
/search
  -> returns top hits
  -> returns 15 facets
  -> returns 3 histograms
  -> returns cardinality counts
  -> supports arbitrary sort
  -> supports highlight
  -> supports deep pagination
```

Ini menjadi endpoint monster.

Pola lebih baik:

```text
/search/results       -> top hits, minimal facets
/search/facets        -> controlled facets, maybe cached
/search/analytics     -> dashboard-specific, size 0, cache-friendly
/search/export        -> async job
/search/suggest       -> autocomplete/suggest optimized separately
```

Trade-off:

- lebih banyak endpoint;
- perlu consistency design;
- lebih mudah enforce guardrail;
- lebih mudah scale dan observe.

---

## 27. Performance Pattern: Query Templates

Untuk enterprise apps, banyak search use case bisa distandardisasi.

Contoh query template:

- Case keyword search.
- Case identifier search.
- Party search.
- Evidence search.
- Recent active cases.
- Audit search.
- SLA breach search.
- Export search.

Keuntungan:

- query shape terkendali;
- observability per template;
- easier optimization;
- safer than arbitrary DSL;
- relevance regression test bisa per template;
- guardrail bisa berbeda per use case.

Di Java, representasikan sebagai enum/strategy:

```java
public enum SearchTemplateType {
    CASE_KEYWORD,
    CASE_IDENTIFIER,
    PARTY_LOOKUP,
    EVIDENCE_FULL_TEXT,
    SLA_BREACH,
    EXPORT_CASES
}
```

Lalu setiap template punya:

- allowed filters;
- allowed sorts;
- default size;
- max size;
- facet policy;
- highlight policy;
- timeout budget;
- index alias target;
- relevance configuration.

---

## 28. Performance Pattern: Minimum Should Match Untuk Mengurangi Noise

Query full-text multi-term bisa menghasilkan terlalu banyak candidates jika terlalu longgar.

Contoh:

```json
{
  "match": {
    "body": "late payment penalty dispute"
  }
}
```

Jika operator default OR, document yang hanya punya “payment” bisa masuk.

Dengan `minimum_should_match`, kita bisa mengontrol candidate quality.

Contoh:

```json
{
  "match": {
    "body": {
      "query": "late payment penalty dispute",
      "minimum_should_match": "75%"
    }
  }
}
```

Dampak:

- candidate set lebih relevan;
- scoring lebih fokus;
- result noise berkurang;
- tapi recall bisa turun.

Performance dan relevance sering saling terkait.

---

## 29. Performance Pattern: Identifier Search Harus Jalur Khusus

Identifier search seperti:

```text
CASE-2026-000123
INV/2025/09/7781
NIK-like identifier
license number
company registration number
```

jangan diperlakukan sama seperti natural language full-text.

Buruk:

```json
{
  "multi_match": {
    "query": "CASE-2026-000123",
    "fields": ["title", "body", "case_number", "party_name"]
  }
}
```

Lebih baik:

```json
{
  "bool": {
    "filter": [
      { "term": { "tenant_id": "t-001" }}
    ],
    "should": [
      { "term": { "case_number.keyword": { "value": "CASE-2026-000123", "boost": 100 }}},
      { "match": { "case_number.normalized": { "query": "CASE-2026-000123", "boost": 20 }}},
      { "multi_match": { "query": "CASE-2026-000123", "fields": ["title", "summary"] }}
    ],
    "minimum_should_match": 1
  }
}
```

Bahkan lebih baik: backend mendeteksi identifier pattern dan memakai template identifier lookup.

Keuntungan:

- lebih cepat;
- lebih akurat;
- ranking lebih explainable;
- menghindari full-text query mahal yang tidak perlu.

---

## 30. Performance Pattern: Time Range Sebagai Wajib Untuk Historical Search

Untuk data besar historis, query tanpa time range sering mahal.

Contoh regulatory search:

```text
Cari semua case dengan keyword “market manipulation” sejak awal sistem.
```

Jika corpus 10 tahun dan query menyentuh semua index, latency sulit dijaga.

Desain lebih baik:

- default range: last 12 months;
- explicit “search all history” mode;
- warning untuk query luas;
- async untuk all-history export;
- separate archive index/alias;
- historical results sorted by relevance + date;
- cache-friendly older indices.

User experience harus mencerminkan cost.

---

## 31. Performance Anti-Patterns

### 31.1 Expose Raw DSL To Frontend

Risiko:

- user bisa membuat query mahal;
- security boundary kabur;
- sulit audit;
- sulit maintain compatibility;
- tidak ada domain semantics.

### 31.2 Semua Field Dicari Oleh Semua Query

Buruk:

```json
"fields": ["*"]
```

Masalah:

- field expansion;
- unpredictable relevance;
- cost tinggi;
- mapping change bisa mengubah behavior.

### 31.3 Autocomplete Dengan Leading Wildcard

Buruk:

```json
{ "wildcard": { "name.keyword": "*abc*" }}
```

Gunakan analyzer/index design.

### 31.4 Facet Semua Field

Facet harus dirancang sebagai UX contract, bukan hasil loop semua field.

### 31.5 Highlight Semua Field Besar

Highlight adalah fitur mahal. Gunakan secara selektif.

### 31.6 Deep Pagination Untuk Export

Export butuh pipeline/job, bukan UI pagination.

### 31.7 Performance Fix Dengan Menambah Node Tanpa Diagnosis

Kadang benar, sering mahal dan menunda akar masalah.

---

## 32. Worked Example: Query Lambat Pada Search Case Management

### 32.1 Gejala

Endpoint:

```text
GET /api/cases/search?q=payment&status=OPEN&page=250&size=50&sort=created_at_desc&highlight=true
```

Latency:

```text
p50: 300 ms
p95: 4.8 s
p99: 11 s
```

### 32.2 Query DSL Saat Ini

```json
{
  "from": 12500,
  "size": 50,
  "query": {
    "bool": {
      "must": [
        { "term": { "tenant_id": "t-001" }},
        { "term": { "status": "OPEN" }},
        { "query_string": {
          "query": "*payment*",
          "fields": ["title", "description", "notes", "comments", "attachments_text"]
        }}
      ]
    }
  },
  "sort": [
    { "created_at": "desc" }
  ],
  "highlight": {
    "fields": {
      "description": {},
      "notes": {},
      "comments": {},
      "attachments_text": {}
    }
  }
}
```

### 32.3 Masalah

- deep pagination dengan `from=12500`;
- tenant/status ada di `must`, bukan `filter`;
- `query_string` dengan wildcard leading/trailing;
- terlalu banyak large fields;
- sort tidak punya tie-breaker;
- highlight banyak large fields;
- endpoint search UI dipakai untuk halaman 250;
- tidak ada guardrail max page;
- tidak ada query template.

### 32.4 Perbaikan Tahap 1: Guardrail API

- max page untuk `from/size`: misalnya 50 halaman.
- setelah itu wajib `search_after` + PIT.
- wildcard tidak boleh untuk user biasa.
- highlight max 2 fields.
- max size 50.
- default date range.

### 32.5 Perbaikan Tahap 2: Query Shape

```json
{
  "size": 50,
  "pit": {
    "id": "PIT_ID",
    "keep_alive": "1m"
  },
  "search_after": ["2026-06-01T10:00:00Z", "CASE-2026-000111"],
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "t-001" }},
        { "term": { "status": "OPEN" }},
        { "range": { "created_at": { "gte": "2025-06-21T00:00:00Z" }}}
      ],
      "must": [
        { "multi_match": {
          "query": "payment",
          "fields": ["title^4", "summary^2", "description"],
          "minimum_should_match": "1"
        }}
      ]
    }
  },
  "sort": [
    { "created_at": "desc" },
    { "case_id.keyword": "asc" }
  ],
  "highlight": {
    "fields": {
      "title": {},
      "summary": {}
    },
    "number_of_fragments": 2,
    "fragment_size": 150
  },
  "_source": [
    "case_id",
    "title",
    "summary",
    "status",
    "priority",
    "created_at"
  ]
}
```

### 32.6 Perbaikan Tahap 3: Index Design

Tambahkan field khusus:

- `search_text` untuk combined normalized content;
- `title.search_as_you_type` jika perlu autocomplete;
- `case_number.keyword` untuk identifier;
- `summary` sebagai snippet ringan;
- `attachment_text` hanya untuk detail/deep search mode.

### 32.7 Perbaikan Tahap 4: Pisahkan Mode

```text
Normal case search:
  - title, summary, description
  - limited highlight
  - max recent range

Deep evidence search:
  - includes attachment_text/comments
  - stricter rate limit
  - async or slower SLA
  - maybe separate index/alias
```

### 32.8 Expected Outcome

- lower query cost;
- stable pagination;
- safer API;
- less fetch/highlight overhead;
- better relevance;
- easier observability.

---

## 33. Worked Example: Aggregation Dashboard Lambat

### 33.1 Gejala

Dashboard:

```text
Open cases by status, priority, assignee, region, violation type, month.
```

Query:

```json
{
  "size": 0,
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "t-001" }},
        { "range": { "created_at": { "gte": "now-5y" }}}
      ]
    }
  },
  "aggs": {
    "status": { "terms": { "field": "status.keyword", "size": 50 }},
    "priority": { "terms": { "field": "priority.keyword", "size": 50 }},
    "assignee": { "terms": { "field": "assignee_id.keyword", "size": 1000 }},
    "region": { "terms": { "field": "region.keyword", "size": 500 }},
    "violation": { "terms": { "field": "violation_type.keyword", "size": 1000 }},
    "month": { "date_histogram": { "field": "created_at", "calendar_interval": "month" }}
  }
}
```

### 33.2 Masalah

- 5 tahun range;
- banyak aggregation sekaligus;
- high-cardinality `assignee` dan `violation`;
- `now` mengurangi cacheability;
- dashboard mungkin refresh terlalu sering;
- user mungkin hanya perlu top 20, bukan 1000;
- historical data tidak berubah tapi query belum cache-friendly.

### 33.3 Perbaikan

- rounded fixed time window;
- split dashboard widget queries;
- cache request untuk historical indices;
- reduce `size`;
- use composite only for bucket pagination;
- pre-aggregate jika dashboard critical;
- separate operational dashboard dari interactive search;
- limit refresh interval UI;
- use time-based index alias.

---

## 34. Performance Testing Strategy

### 34.1 Jangan Test Dengan Data Kecil Saja

Query yang cepat di 10.000 docs bisa buruk di 100 juta docs.

Test harus mempertimbangkan:

- realistic document count;
- realistic field size;
- realistic term distribution;
- realistic tenant skew;
- realistic permission filters;
- realistic shard count;
- realistic concurrent traffic;
- realistic aggregations;
- realistic highlighting.

### 34.2 Golden Query Performance Set

Buat daftar query representatif:

```text
Q001: exact case number lookup
Q002: common keyword search
Q003: rare keyword search
Q004: multi-word phrase search
Q005: permission-heavy user search
Q006: facet-heavy search
Q007: autocomplete prefix
Q008: historical all-time search
Q009: export batch query
Q010: dashboard aggregation
```

Untuk setiap query, simpan:

- expected result quality;
- expected latency budget;
- expected max shard fan-out;
- expected response size;
- query DSL template;
- allowed regressions.

### 34.3 Load Test Metrics

Ukur:

- p50/p95/p99 latency;
- throughput;
- error rate;
- timeout rate;
- CPU;
- heap/GC;
- search queue;
- rejected count;
- disk IO;
- cache hit/miss;
- slow log distribution.

### 34.4 Performance Budget

Contoh:

| Query Type | p95 Budget | Notes |
|---|---:|---|
| Identifier lookup | 100 ms | exact keyword path |
| Normal keyword search | 500 ms | top 20, limited facets |
| Faceted search | 800 ms | max 5 facets |
| Autocomplete | 100 ms | strict input length |
| Dashboard | 1500 ms | cache-friendly |
| Export batch | async | not user blocking |
| Deep evidence search | 3000 ms | special mode |

Budget membantu desain. Tanpa budget, semua orang akan meminta semua fitur dalam satu endpoint.

---

## 35. Production Checklist: Query Performance

### Query DSL

- [ ] Exact filters memakai filter context.
- [ ] Full-text scoring hanya untuk field yang relevan.
- [ ] Tidak expose raw DSL untuk user-facing search.
- [ ] Wildcard/regexp dibatasi atau dilarang.
- [ ] Query string bebas tidak dipakai tanpa guardrail.
- [ ] Script score hanya dipakai setelah candidate reduction.
- [ ] Nested/inner hits dipakai selektif.

### Mapping

- [ ] Sort/facet fields bertipe `keyword`, numeric, date, atau tipe yang sesuai.
- [ ] Tidak aggregation/sort pada `text` field sembarangan.
- [ ] Multi-fields dirancang sesuai query pattern.
- [ ] Field cardinality dipahami.
- [ ] Large text fields tidak di-highlight default.

### Pagination

- [ ] `from/size` dibatasi.
- [ ] Deep pagination memakai `search_after` + PIT jika interactive.
- [ ] Export memakai pipeline khusus.
- [ ] Sort stabil dengan tie-breaker.

### Aggregation

- [ ] Facet fields di-whitelist.
- [ ] Bucket size dibatasi.
- [ ] High-cardinality aggregation dikontrol.
- [ ] Dashboard query dipisah jika perlu.
- [ ] Historical aggregation cache-friendly.

### Fetch

- [ ] `_source` filtering digunakan.
- [ ] Search result summary compact.
- [ ] Highlight dibatasi.
- [ ] Inner hits dibatasi.
- [ ] Response size dipantau.

### Shard/Cluster

- [ ] Query tidak fan-out ke terlalu banyak shard tanpa alasan.
- [ ] Alias/time range dirancang.
- [ ] Hot shard dimonitor.
- [ ] Coordinating node bottleneck dimonitor.
- [ ] Filesystem cache diberi memory cukup.

### Observability

- [ ] Slow logs aktif dengan threshold masuk akal.
- [ ] Query templates punya metrics.
- [ ] p50/p95/p99 dipantau per endpoint.
- [ ] Timeout/retry/rejection dipantau.
- [ ] Profile API dipakai untuk diagnosis terarah.
- [ ] Correlation id tersedia dari Java service ke Elasticsearch.

---

## 36. Common Interview / Design Review Questions

### Q1: Kenapa filter context lebih cepat daripada query context?

Karena filter context hanya menentukan match yes/no tanpa menghitung relevance score. Selain itu, frequently used filters dapat di-cache. Namun filter tidak otomatis cepat jika tidak selektif, unik terus-menerus, atau query shape buruk.

### Q2: Kenapa wildcard leading seperti `*abc` berbahaya?

Karena Elasticsearch/Lucene sulit memanfaatkan term dictionary secara efisien. Query bisa mengekspansi banyak term dan menyentuh banyak posting list. Untuk contains/autocomplete, sebaiknya desain analyzer/index field yang sesuai.

### Q3: Kenapa deep pagination mahal?

Karena Elasticsearch harus mengumpulkan dan mengurutkan banyak kandidat sampai offset yang diminta pada setiap shard, lalu coordinating node membuang sebagian besar. `from=10000&size=20` bukan “ambil 20 data”, tetapi “proses banyak data lalu ambil 20 setelah offset”.

### Q4: Apa bedanya query cache dan request cache?

Query cache menyimpan hasil filter query tertentu per segment. Request cache menyimpan local shard result untuk request tertentu, terutama berguna untuk aggregation/dashboard `size: 0` pada data yang jarang berubah. Keduanya punya eligibility dan invalidation behavior berbeda.

### Q5: Bagaimana debug query lambat?

Ambil query konkret, cek slow log, reproduksi variasi, pisahkan query/fetch/aggregation/highlight, gunakan Profile API, cek shard/node metrics, identifikasi bottleneck, ubah satu variabel, lalu ukur p95/p99 dan correctness.

### Q6: Kapan menambah node adalah solusi?

Ketika workload sudah wajar, query shape sehat, mapping tepat, shard topology masuk akal, dan bottleneck memang resource/capacity. Jika query buruk, tambah node hanya memperbesar biaya dan menunda masalah.

---

## 37. Mini Lab: Diagnose Query Cost

### Lab 1 — Filter vs Must

Buat dua query:

1. tenant/status di `must`.
2. tenant/status di `filter`.

Bandingkan:

- profile output;
- took;
- score behavior;
- query readability.

### Lab 2 — Source Filtering

Jalankan:

1. full `_source`.
2. `_source` only result-card fields.
3. `_source: false`.

Bandingkan fetch time dan response payload.

### Lab 3 — Aggregation Cardinality

Bandingkan terms aggregation pada:

- `status.keyword`;
- `priority.keyword`;
- `user_id.keyword`;
- `case_id.keyword`.

Amati latency dan memory behavior.

### Lab 4 — Pagination

Bandingkan:

- `from=0,size=20`;
- `from=10000,size=20`;
- `search_after` dengan sort stabil.

Amati latency dan resource.

### Lab 5 — Wildcard vs Analyzer

Bandingkan:

- wildcard `*abc*` pada keyword;
- edge n-gram field;
- `search_as_you_type` field.

Ukur latency dan relevance.

---

## 38. Design Heuristics Untuk Top-Tier Engineer

1. **Optimize query shape before hardware.**
2. **Filter early, score selectively.**
3. **Do not let UI freedom become cluster abuse.**
4. **Search result page is not export.**
5. **Facet fields are product/API contract, not arbitrary fields.**
6. **Highlight is expensive; treat it as feature with budget.**
7. **Deep pagination is an architecture smell.**
8. **Identifier search deserves a separate path.**
9. **Permission-aware search must be designed for performance and security together.**
10. **Cache helps repeated stable workloads; it does not fix random expensive queries.**
11. **Tail latency reveals shard/node imbalance.**
12. **Profile API explains a query; slow logs reveal production behavior.**
13. **Every search endpoint needs a performance budget.**
14. **Every search template needs observability.**
15. **Never improve speed by silently damaging relevance.**

---

## 39. Key Takeaways

- Query performance adalah hasil interaksi query DSL, mapping, analyzer, shard topology, cache, fetch payload, aggregation, Java client behavior, dan API contract.
- Latency harus dipecah menjadi query phase, fetch phase, coordination, network, dan application processing.
- Filter context penting untuk exact constraints karena tidak menghitung score dan bisa cache-friendly.
- Profile API berguna untuk debugging detail, tetapi menambah overhead dan bukan pengganti observability production.
- Slow logs penting untuk menemukan query mahal yang benar-benar terjadi.
- Cache bukan magic; workload harus cacheable.
- Wildcard, regexp, script score, nested inner hits, deep pagination, high-cardinality aggregation, dan large highlight adalah kelas risiko performance.
- Search API harus punya guardrail agar user tidak bisa menciptakan query yang menghancurkan cluster.
- Query optimization harus mempertahankan relevance dan correctness.
- Top-tier engineer tidak hanya mempercepat query; mereka mendesain sistem agar query buruk sulit terjadi.

---

## 40. Referensi Resmi dan Bacaan Lanjutan

Referensi utama untuk part ini:

- Elastic Docs — Profile search requests: <https://www.elastic.co/docs/reference/elasticsearch/rest-apis/search-profile>
- Elastic Docs — Query and filter context: <https://www.elastic.co/docs/reference/query-languages/query-dsl/query-filter-context>
- Elastic Docs — Node query cache settings: <https://www.elastic.co/docs/reference/elasticsearch/configuration-reference/node-query-cache-settings>
- Elastic Docs — Shard request cache: <https://www.elastic.co/docs/reference/elasticsearch/rest-apis/shard-request-cache>
- Elastic Docs — Field data cache settings: <https://www.elastic.co/docs/reference/elasticsearch/configuration-reference/field-data-cache-settings>
- Elastic Docs — Slow logs: <https://www.elastic.co/docs/deploy-manage/monitor/logging-configuration/slow-logs>
- Elastic Docs — Tune for search speed: <https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/search-speed>
- Elastic Docs — Search shard routing: <https://www.elastic.co/docs/reference/elasticsearch/rest-apis/search-shard-routing>
- Elastic Docs — Size your shards: <https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards>
- Elastic Docs — CAT shards API: <https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-cat-shards>
- Elastic Docs — Index stats API: <https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-stats>

---

## 41. Penutup

Part ini membahas query performance dari sisi read path. Fondasinya adalah kemampuan mengurai query menjadi komponen biaya, bukan sekadar mencoba setting acak.

Part berikutnya akan melanjutkan performance engineering dari sisi write path:

```text
Part 022 — Performance Engineering II: Indexing Performance
```

Kita akan membahas bulk sizing, refresh interval, replica strategy saat backfill, merge pressure, translog, thread pool, indexing buffer, analyzer impact, large document problem, backpressure, ingestion throttling, dan failure classification pada bulk indexing.

Status seri: belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — Security, Authorization, and Permission-Aware Search</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-022.md">Part 022 — Performance Engineering II: Indexing Performance ➡️</a>
</div>
