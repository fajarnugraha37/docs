# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-004.md

# Part 004 — Elasticsearch Architecture Deep Dive

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Bagian: `004 / 034`  
> Target pembaca: Java software engineer yang ingin memahami Elasticsearch sebagai distributed search engine, bukan hanya sebagai REST API untuk query JSON.  
> Fokus: cluster, node, index, shard, replica, routing, distributed write path, distributed search path, cluster state, dan konsekuensi desain arsitektur.

---

## 0. Posisi Part Ini Dalam Seri

Di Part 000 kita membangun orientasi: Elasticsearch adalah **retrieval system**, bukan sekadar database JSON.

Di Part 001 kita membedakan lookup, search, discovery, relevance, recall, precision, dan ranking.

Di Part 002 kita membongkar fondasi information retrieval: corpus, document, field, term, posting list, inverted index, dan cost model query.

Di Part 003 kita masuk ke Lucene: segment, refresh, commit, flush, merge, update-as-delete-plus-add, dan near-real-time search.

Part 004 sekarang naik satu level:

> Kalau Lucene adalah mesin index dan query pada satu shard, maka Elasticsearch adalah sistem terdistribusi yang mengatur banyak Lucene index agar terlihat seperti satu search platform.

Elasticsearch tidak hanya menjalankan Lucene. Ia juga mengurus:

- pembagian data ke shard,
- replikasi shard,
- node discovery,
- cluster membership,
- cluster state,
- routing document,
- distributed search,
- shard allocation,
- failover,
- recovery,
- coordination,
- index metadata,
- security boundary,
- lifecycle dan operational control.

Part ini penting karena banyak masalah production Elasticsearch bukan karena query DSL salah, tetapi karena mental model arsitektur salah.

Contoh gejalanya:

- cluster sering yellow/red,
- indexing lambat saat load tinggi,
- query latency tidak stabil,
- heap sering tinggi,
- shard terlalu banyak,
- shard terlalu besar,
- node tertentu menjadi hotspot,
- rebalancing mengganggu traffic,
- satu search request fan-out ke terlalu banyak shard,
- mapping update terasa lambat karena cluster state besar,
- master node overload,
- replica tidak memberi manfaat karena routing/search pattern buruk,
- capacity planning hanya berdasarkan total disk, bukan berdasarkan shard, CPU, heap, merge, dan query concurrency.

Part ini bertujuan membangun fondasi agar Anda bisa membaca gejala tersebut sebagai konsekuensi desain, bukan sekadar “Elasticsearch lambat”.

---

## 1. Mental Model Besar: Elasticsearch = Cluster of Lucene Shards

Kalimat paling penting:

> Sebuah Elasticsearch shard pada dasarnya adalah satu Lucene index.

Sebuah Elasticsearch index bukan satu file besar. Ia adalah logical namespace yang dibagi menjadi beberapa shard. Setiap shard menyimpan sebagian document. Setiap shard dapat memiliki replica. Setiap shard dijalankan di satu node pada satu waktu.

Secara sederhana:

```text
Elasticsearch Cluster
└── Index: cases-v1
    ├── Primary Shard 0  -> Lucene index
    ├── Primary Shard 1  -> Lucene index
    ├── Primary Shard 2  -> Lucene index
    ├── Replica Shard 0  -> copy dari Primary Shard 0
    ├── Replica Shard 1  -> copy dari Primary Shard 1
    └── Replica Shard 2  -> copy dari Primary Shard 2
```

Jika index memiliki 3 primary shard dan 1 replica, maka total shard copy adalah:

```text
3 primary + 3 replica = 6 shard copies
```

Yang sering membingungkan:

- `index` di Elasticsearch adalah logical object.
- `shard` adalah unit fisik distribusi dan execution.
- `segment` adalah unit internal Lucene di dalam shard.
- `replica` adalah salinan shard, bukan salinan seluruh cluster.

Lapisan mental model:

```text
Cluster
  Node
    Shard
      Lucene Index
        Segment
          Posting Lists / Doc Values / Stored Fields
```

Ketika Anda menjalankan search terhadap satu index, Elasticsearch sebenarnya menjalankan search ke shard-shard yang relevan, lalu menggabungkan hasilnya.

Ketika Anda menulis satu document, Elasticsearch menentukan document itu masuk ke primary shard mana, menulis ke primary shard tersebut, lalu mereplikasi operasi ke replica shard.

Jadi Elasticsearch architecture selalu punya dua sisi:

1. **Logical API model**: index, document, search request, query DSL.
2. **Physical execution model**: node, shard, replica, segment, routing, queue, thread pool, disk, heap.

Engineer pemula sering berhenti di logical model.

Engineer kuat selalu bertanya:

- request ini fan-out ke shard mana saja?
- shard tersebut tinggal di node mana?
- node itu sedang melakukan merge atau GC?
- data dan query tersebar merata atau ada hotspot?
- replica benar-benar membantu atau hanya menambah write amplification?
- cluster state cukup kecil atau sudah menjadi beban?
- shard count masuk akal untuk workload?

---

## 2. Komponen Utama Elasticsearch

Ada beberapa istilah dasar yang harus sangat jelas.

### 2.1 Cluster

Cluster adalah kumpulan satu atau lebih node Elasticsearch yang bekerja sebagai satu sistem.

Satu laptop dev dengan satu Elasticsearch process pun adalah cluster satu node.

Production cluster biasanya terdiri dari beberapa node, misalnya:

```text
3 master-eligible nodes
6 hot data nodes
3 warm data nodes
2 coordinating nodes
2 ingest nodes
```

Cluster memiliki:

- cluster name,
- cluster UUID,
- node membership,
- cluster state,
- shard allocation,
- index metadata,
- security metadata,
- templates,
- ingest pipelines,
- ilm policies,
- data stream metadata,
- persistent/transient settings.

Cluster bukan hanya “sekumpulan server”. Cluster adalah **control plane + data plane**.

Control plane mengatur metadata dan koordinasi.

Data plane menjalankan indexing, search, aggregation, merge, fetch, dan storage.

### 2.2 Node

Node adalah satu instance Elasticsearch yang berjalan sebagai process JVM.

Satu node memiliki:

- node name,
- node ID,
- roles,
- JVM heap,
- filesystem path,
- network address,
- thread pools,
- circuit breakers,
- local shard copies,
- local caches,
- local segments,
- local translog,
- local logs.

Node berkomunikasi dengan node lain lewat transport layer. Client biasanya berkomunikasi lewat HTTP layer.

Mental model:

```text
Client -> HTTP -> Node menerima request
Node -> transport -> node lain jika perlu koordinasi distributed operation
```

Node yang menerima request dari client akan menjadi **coordinating node** untuk request itu, walaupun node tersebut juga punya role lain.

### 2.3 Index

Index adalah logical collection of documents dengan mapping, settings, dan shard configuration.

Contoh:

```text
cases-v1
case-events-2026.06
regulatory-documents-v3
search-audit-log-000123
```

Index memiliki:

- mappings,
- settings,
- number of primary shards,
- number of replicas,
- analyzers,
- aliases,
- lifecycle policy,
- hidden/system flags,
- data stream backing relation jika relevan.

Perhatian penting:

> Jumlah primary shard untuk index biasa ditentukan saat index dibuat dan tidak bisa diubah langsung setelah index ada. Untuk mengubahnya, biasanya perlu reindex, split, shrink, atau strategi index baru.

Replica count bisa diubah dinamis.

### 2.4 Shard

Shard adalah unit distribusi data dan execution.

Ada dua tipe shard:

- primary shard,
- replica shard.

Setiap document dalam index dimiliki oleh tepat satu primary shard.

Replica shard adalah copy dari primary shard tertentu.

Contoh:

```text
Index cases-v1
number_of_shards: 3
number_of_replicas: 1

Shard copies:
P0, P1, P2
R0, R1, R2
```

Primary dan replica untuk shard yang sama tidak boleh ditempatkan pada node yang sama dalam kondisi normal, karena jika node itu mati maka primary dan replica ikut hilang.

### 2.5 Segment

Segment adalah unit internal Lucene di dalam shard. Ini sudah dibahas di Part 003, tetapi penting untuk menghubungkan layer:

```text
Elasticsearch Index
  Primary Shard 0
    Lucene Segment A
    Lucene Segment B
    Lucene Segment C
  Primary Shard 1
    Lucene Segment D
    Lucene Segment E
```

Elasticsearch mengatur shard. Lucene mengatur segment.

Performance query dipengaruhi oleh keduanya:

- terlalu banyak shard: overhead distributed coordination,
- terlalu banyak segment: overhead per-shard Lucene search,
- segment terlalu besar: merge dan recovery cost,
- shard terlalu besar: relocation/recovery lama,
- shard terlalu kecil: metadata/heap overhead tinggi.

### 2.6 Document

Document adalah JSON-like object yang di-index.

Contoh:

```json
{
  "case_id": "CASE-2026-000123",
  "title": "Unauthorized fund transfer investigation",
  "status": "UNDER_REVIEW",
  "priority": "HIGH",
  "created_at": "2026-06-21T09:30:00Z",
  "assigned_unit": "ENFORCEMENT_A",
  "summary": "Investigation into suspicious transfer pattern..."
}
```

Tetapi begitu document masuk ke Elasticsearch, ia tidak hanya disimpan sebagai JSON. Field-fieldnya dianalisis, di-tokenisasi, dimasukkan ke inverted index, doc values, stored fields, points index, vector index, dan struktur internal lain tergantung mapping.

---

## 3. Node Roles: Siapa Melakukan Apa?

Elasticsearch node bisa memiliki satu atau lebih role.

Role menentukan tanggung jawab node. Dalam cluster kecil, satu node bisa memegang banyak role. Dalam cluster production besar, role sering dipisah agar beban lebih terkendali.

### 3.1 Master-Eligible Node

Master-eligible node bisa dipilih menjadi elected master.

Elected master bertanggung jawab mengelola cluster state, misalnya:

- node join/leave,
- index creation/deletion,
- mapping updates,
- shard allocation decisions,
- cluster settings updates,
- index template updates,
- metadata changes.

Elected master tidak berarti semua query/search lewat master.

Kesalahan umum:

> “Master node adalah node pusat untuk semua traffic.”

Salah. Master adalah control-plane leader, bukan query gateway utama.

Untuk production high availability, praktik umum adalah menggunakan tiga master-eligible nodes agar cluster tetap bisa memilih master saat satu node gagal.

Mental model:

```text
Master-eligible nodes: menjaga otak cluster tetap konsisten.
Data nodes: menjalankan kerja berat indexing/search/storage.
```

### 3.2 Data Node

Data node menyimpan shard dan menjalankan operasi data-plane:

- indexing,
- searching,
- aggregations,
- merging segments,
- fetching stored fields/source,
- maintaining shard-local cache,
- translog operations,
- recovery.

Data node adalah tempat resource besar dipakai:

- disk,
- CPU,
- IO,
- heap,
- page cache,
- network.

Data node dapat dibagi lagi berdasarkan tier, seperti hot, warm, cold, frozen, content. Detailnya akan dibahas di part lifecycle dan capacity planning.

### 3.3 Ingest Node

Ingest node menjalankan ingest pipeline sebelum document di-index.

Pipeline bisa melakukan:

- set field,
- rename field,
- remove field,
- enrich,
- grok parsing,
- date parsing,
- geoip,
- script transform,
- attachment extraction jika plugin relevan.

Ingest node berguna jika transformasi document ingin dilakukan di Elasticsearch layer.

Namun untuk sistem backend enterprise, terutama Java microservices, sering lebih baik transformasi domain dilakukan di indexing service agar:

- logic lebih testable,
- versioning lebih jelas,
- error handling lebih terkendali,
- schema contract lebih eksplisit,
- tidak semua business logic tersembunyi di ingest pipeline.

Ingest pipeline tetap berguna untuk logs, telemetry, enrichment ringan, atau normalization teknis.

### 3.4 Coordinating Node

Setiap node dapat bertindak sebagai coordinating node untuk request yang diterimanya.

Coordinating node bertugas:

- menerima request dari client,
- menentukan shard target,
- mengirim sub-request ke shard copy yang relevan,
- mengumpulkan response,
- melakukan reduce/merge,
- mengembalikan response final.

Dalam cluster besar, kadang dibuat dedicated coordinating-only nodes. Node seperti ini tidak menyimpan data dan tidak master-eligible. Tugasnya menjadi query gateway.

Namun dedicated coordinating node bukan solusi ajaib. Ia bisa menjadi bottleneck jika:

- query fan-out besar,
- aggregation reduce berat,
- response besar,
- banyak concurrent requests,
- network bandwidth tinggi,
- client selalu mengarah ke sedikit coordinating node.

### 3.5 Machine Learning, Transform, Remote Cluster Client, dan Role Lain

Elasticsearch modern memiliki role tambahan seperti machine learning, transform, remote cluster client, dan sebagainya.

Dalam seri ini, fokus utama adalah search-engine database. Role tambahan akan disebut ketika relevan, tetapi Part 004 fokus pada core architecture:

- master,
- data,
- ingest,
- coordinating.

---

## 4. Cluster State: Otak Metadata Cluster

Cluster state adalah metadata global yang menggambarkan keadaan cluster.

Isinya meliputi:

- daftar node,
- index metadata,
- mapping,
- settings,
- shard routing table,
- index templates,
- component templates,
- ingest pipelines,
- aliases,
- lifecycle metadata,
- security metadata,
- cluster blocks,
- custom metadata lain.

Elected master adalah satu-satunya node yang membuat perubahan cluster state. Setelah perubahan dibuat, cluster state dipublikasikan ke node lain.

Poin penting:

> Cluster state harus cukup kecil dan stabil agar cluster bisa beroperasi sehat.

Masalah cluster state sering muncul ketika:

- index terlalu banyak,
- shard terlalu banyak,
- field mapping terlalu banyak,
- dynamic mapping menyebabkan field explosion,
- template terlalu kompleks,
- alias terlalu banyak,
- cluster sering membuat/menghapus index,
- mapping sering berubah,
- master node resource terlalu kecil,
- network antar node tidak stabil.

Contoh buruk:

```text
Satu tenant = satu index
Satu hari = banyak index
Satu field user-generated = dynamic field baru
Total: puluhan ribu index + ratusan ribu shard + jutaan field mapping
```

Akibat:

- master sibuk publish cluster state,
- node join lama,
- mapping update lambat,
- Kibana/management API lambat,
- heap tinggi,
- recovery rumit,
- cluster tidak responsif terhadap metadata operation.

Cluster state adalah alasan mengapa desain index bukan hanya soal query. Ia juga soal control-plane scalability.

---

## 5. Index, Shard, Replica: Logical dan Physical Design

### 5.1 Index Adalah Boundary Logical

Index biasanya digunakan sebagai boundary untuk:

- mapping,
- analyzer,
- lifecycle,
- retention,
- permission/security,
- query scope,
- alias,
- migration/versioning.

Contoh:

```text
cases-v1
cases-v2
case-events-2026.06.21
regulatory-documents-v1
```

Index bukan selalu sama dengan domain entity.

Dalam search, satu index bisa berisi denormalized search documents yang berasal dari banyak domain entity.

Contoh:

```text
Index: regulatory-search-v1
Documents:
- case document
- party document
- enforcement action document
- evidence document
```

Atau Anda bisa memilih index terpisah:

```text
cases-search-v1
parties-search-v1
evidence-search-v1
```

Pilihan ini tergantung:

- query pattern,
- permission model,
- mapping compatibility,
- lifecycle,
- update frequency,
- relevance model,
- result type UX,
- operational isolation.

### 5.2 Primary Shard Adalah Partition Data

Primary shard membagi document ke beberapa partition.

Jika index punya 5 primary shard:

```text
Document A -> shard 0
Document B -> shard 3
Document C -> shard 1
```

Document tertentu hanya berada di satu primary shard.

Routing default biasanya berdasarkan hash dari document ID atau routing value, lalu modulo jumlah primary shard.

Secara konseptual:

```text
shard_id = hash(_routing) % number_of_primary_shards
```

Ini alasan jumlah primary shard tidak bisa diubah sembarangan setelah index dibuat: hash modulo berubah berarti document harus dipindah/repartition.

### 5.3 Replica Shard Adalah Copy Untuk HA dan Read Scale

Replica shard memberi dua manfaat utama:

1. **High availability**: jika node yang memegang primary mati, replica bisa dipromosikan.
2. **Read capacity**: search/get bisa dilayani oleh primary atau replica.

Namun replica juga punya cost:

- setiap write harus direplikasi,
- disk bertambah,
- network bertambah,
- indexing latency bisa terpengaruh,
- merge juga terjadi di replica,
- recovery butuh resource.

Replica bukan free performance.

Jika workload write-heavy, terlalu banyak replica bisa memperlambat indexing.

Jika workload search-heavy, replica bisa membantu read throughput selama query bisa tersebar ke shard copies yang berbeda dan node memiliki cukup CPU/IO.

### 5.4 Total Shard Copies

Formula:

```text
Total shard copies = primary_shards * (1 + number_of_replicas)
```

Contoh:

```text
number_of_shards = 6
number_of_replicas = 2

Total = 6 * (1 + 2) = 18 shard copies
```

Cluster harus menempatkan 18 shard copies itu di node-node.

Jika node hanya 3, maka rata-rata 6 shard copies per node.

Tetapi placement harus mempertimbangkan agar primary dan replica untuk shard yang sama tidak ada di node yang sama.

---

## 6. Routing: Bagaimana Document Masuk ke Shard

Saat indexing document, Elasticsearch harus menentukan shard target.

Default routing memakai `_id`. Namun Anda bisa memberikan custom routing.

### 6.1 Default Routing

Contoh indexing:

```http
PUT cases-v1/_doc/CASE-2026-000123
{
  "title": "Unauthorized fund transfer investigation"
}
```

Secara konseptual:

```text
routing_value = _id = "CASE-2026-000123"
shard = hash(routing_value) % number_of_primary_shards
```

Client tidak perlu tahu shard mana. Coordinating node menghitung routing dan meneruskan request ke primary shard yang benar.

### 6.2 Custom Routing

Custom routing bisa digunakan untuk memaksa dokumen dengan routing value sama masuk shard yang sama.

Contoh:

```http
PUT cases-v1/_doc/CASE-2026-000123?routing=TENANT-001
{
  "tenant_id": "TENANT-001",
  "title": "Unauthorized fund transfer investigation"
}
```

Kegunaan:

- tenant-aware locality,
- parent-child relation,
- query bisa diarahkan ke shard tertentu,
- mengurangi fan-out jika query selalu punya routing.

Risiko:

- tenant besar bisa membuat hotspot shard,
- distribusi data tidak merata,
- salah routing saat get/update/delete bisa tidak menemukan document,
- query tanpa routing tetap fan-out,
- migrasi routing strategy sulit.

Custom routing adalah alat tajam. Jangan digunakan hanya karena terdengar “lebih scalable”. Gunakan jika query pattern dan tenant distribution benar-benar mendukung.

### 6.3 Routing Untuk Query

Jika query menyertakan routing, Elasticsearch hanya perlu mencari ke shard yang relevan.

Contoh:

```http
GET cases-v1/_search?routing=TENANT-001
{
  "query": {
    "match": {
      "title": "fund transfer"
    }
  }
}
```

Tanpa routing:

```text
Query -> semua primary shard atau replica copy dari index
```

Dengan routing:

```text
Query -> shard yang sesuai routing value
```

Ini bisa sangat mengurangi latency dan CPU, tetapi hanya benar jika semua document relevan memang di-index dengan routing yang sama.

---

## 7. Write Path: Apa Yang Terjadi Saat Indexing Document?

Mari pecah proses indexing satu document.

Request:

```http
PUT cases-v1/_doc/CASE-2026-000123
{
  "case_id": "CASE-2026-000123",
  "title": "Unauthorized fund transfer investigation",
  "status": "UNDER_REVIEW"
}
```

### 7.1 Step-by-Step Write Path

Secara konseptual:

```text
1. Client mengirim HTTP request ke salah satu node.
2. Node penerima menjadi coordinating node.
3. Coordinating node mengecek cluster state untuk index metadata dan routing table.
4. Coordinating node menghitung target primary shard.
5. Request dikirim ke node yang memegang primary shard tersebut.
6. Primary shard menjalankan indexing operation.
7. Document dianalisis sesuai mapping/analyzer.
8. Operation ditulis ke translog.
9. Data masuk indexing buffer dan Lucene structures.
10. Operation direplikasi ke replica shard dalam replication group.
11. Replica menjalankan operation yang sama.
12. Setelah required acknowledgements terpenuhi, response dikembalikan ke client.
13. Document menjadi searchable setelah refresh.
```

Simplified diagram:

```text
Client
  |
  v
Node A (coordinating)
  |
  | route doc id -> shard 2
  v
Node B (primary shard 2)
  |  index locally
  |  replicate operation
  +-------------------> Node C (replica shard 2)
  +-------------------> Node D (replica shard 2, if replica=2)
  |
  v
ack -> Node A -> Client
```

### 7.2 Primary-Replica Replication Group

Untuk setiap primary shard, ada replication group:

```text
Replication group for shard 2:
- Primary shard 2
- Replica shard 2a
- Replica shard 2b
```

Write harus melalui primary terlebih dahulu. Replica mengikuti operasi primary.

Jika primary gagal, replica dapat dipromosikan menjadi primary baru.

### 7.3 Refresh Tidak Sama Dengan Commit

Setelah write acknowledged, document belum tentu langsung muncul dalam search.

Elasticsearch bersifat near-real-time. Document biasanya searchable setelah refresh.

Refresh membuat segment baru terbuka untuk search, tetapi bukan fsync durability penuh seperti commit.

Commit/flush dan translog durability adalah topik berbeda.

Mental model:

```text
acknowledged write != immediately searchable
searchable after refresh != fully committed Lucene commit
```

Ini sering menjadi sumber bug test integration:

```java
indexDocument(caseDoc);
search("fund transfer"); // mungkin belum muncul jika belum refresh
```

Solusi test bisa memakai refresh eksplisit atau refresh policy, tetapi production jangan asal `refresh=true` pada setiap write karena bisa membebani indexing throughput.

### 7.4 Write Acknowledgement dan Failure

Write operation bisa gagal di beberapa titik:

- coordinating node gagal,
- primary unavailable,
- replica unavailable,
- mapping rejection,
- version conflict,
- circuit breaker,
- disk watermark,
- thread pool rejection,
- cluster block,
- network partition,
- authentication/authorization failure.

Top-tier engineer tidak hanya retry semua error secara buta.

Error harus diklasifikasikan:

```text
Retryable:
- timeout sementara
- rejected execution karena backpressure
- temporary unavailable

Non-retryable sampai data diperbaiki:
- mapping parse error
- invalid field type
- document too large
- malformed date

Conflict/business controlled:
- version conflict
- sequence conflict

Operational emergency:
- cluster block read_only_allow_delete
- disk watermark
- red cluster
```

---

## 8. Read Path: GET vs Search

Elasticsearch memiliki dua jenis read yang berbeda secara mental model.

### 8.1 GET by ID

GET by ID adalah lookup:

```http
GET cases-v1/_doc/CASE-2026-000123
```

Elasticsearch bisa menghitung routing dari ID, lalu langsung menuju shard yang memiliki document.

```text
GET by ID -> target one shard copy
```

Jika custom routing digunakan, request GET harus menyertakan routing yang sama.

```http
GET cases-v1/_doc/CASE-2026-000123?routing=TENANT-001
```

GET by ID biasanya lebih murah daripada search karena tidak perlu query ke semua shard.

### 8.2 Search

Search berbeda:

```http
GET cases-v1/_search
{
  "query": {
    "match": {
      "title": "fund transfer"
    }
  }
}
```

Tanpa routing, search harus dikirim ke satu copy dari setiap shard yang relevan.

Jika index memiliki 12 primary shard:

```text
Search -> 12 shard-level searches
```

Jika search mencakup 10 index masing-masing 12 shard:

```text
Search -> 120 shard-level searches
```

Inilah mengapa shard count dan index selection sangat penting.

---

## 9. Distributed Search Execution: Query Phase dan Fetch Phase

Search di Elasticsearch biasanya terdiri dari dua fase utama:

1. query phase,
2. fetch phase.

### 9.1 Query Phase

Misalnya request:

```http
GET cases-v1/_search
{
  "from": 0,
  "size": 10,
  "query": {
    "match": {
      "title": "fund transfer"
    }
  }
}
```

Jika index punya 5 primary shard, coordinating node akan mengirim query ke satu copy dari masing-masing shard.

```text
Coordinating Node
  -> Shard 0 copy
  -> Shard 1 copy
  -> Shard 2 copy
  -> Shard 3 copy
  -> Shard 4 copy
```

Masing-masing shard menjalankan Lucene search secara lokal dan menghasilkan top candidates lokal.

Untuk `from=0,size=10`, tiap shard umumnya perlu mengembalikan top 10 local hits beserta score dan doc reference.

Coordinating node lalu menggabungkan local top hits menjadi global top 10.

```text
Shard 0: local top 10
Shard 1: local top 10
Shard 2: local top 10
Shard 3: local top 10
Shard 4: local top 10

Coordinating node: merge -> global top 10
```

### 9.2 Fetch Phase

Setelah global top hits diketahui, coordinating node meminta document details dari shard yang memegang doc tersebut.

Fetch phase mengambil:

- `_source`,
- stored fields,
- docvalue fields,
- highlights,
- inner hits,
- script fields,
- explanation jika diminta.

Contoh:

```text
Global top 10:
- doc A from shard 2
- doc B from shard 4
- doc C from shard 2
- doc D from shard 0

Fetch request:
- shard 2: doc A, doc C
- shard 4: doc B
- shard 0: doc D
```

### 9.3 Why Deep Pagination Hurts

Jika request:

```json
{
  "from": 10000,
  "size": 10
}
```

Masing-masing shard tidak cukup mengembalikan 10 local hits. Ia harus mengembalikan top `from + size`, yaitu 10010 candidates.

Jika ada 20 shard:

```text
20 shards * 10010 candidates = 200200 candidate references
```

Coordinating node harus merge semua itu hanya untuk membuang sebagian besar hasil dan mengembalikan 10.

Ini alasan deep pagination mahal dan akan dibahas khusus di Part 013.

### 9.4 Aggregation Reduce

Aggregation juga distributed.

Setiap shard menghitung partial aggregation, lalu coordinating node melakukan reduce.

Contoh terms aggregation:

```json
{
  "aggs": {
    "by_status": {
      "terms": {
        "field": "status.keyword"
      }
    }
  }
}
```

Shard-level:

```text
Shard 0: UNDER_REVIEW=50, CLOSED=20
Shard 1: UNDER_REVIEW=40, ESCALATED=10
Shard 2: CLOSED=30, ESCALATED=7
```

Coordinator reduce:

```text
UNDER_REVIEW=90
CLOSED=50
ESCALATED=17
```

Untuk simple aggregation, ini mudah. Untuk high-cardinality terms aggregation, nested aggregation, large buckets, atau pipeline aggregation, reduce phase bisa berat di coordinating node.

---

## 10. Fan-Out/Fan-In: Sumber Banyak Masalah Latency

Search distributed adalah pola fan-out/fan-in.

```text
            +-> Shard 0
            +-> Shard 1
Client -> Coordinator -> Shard 2
            +-> Shard 3
            +-> Shard 4
                 ...
            <- responses
Coordinator merge/reduce
Response -> Client
```

Latency global dipengaruhi oleh:

- shard paling lambat,
- network latency,
- queueing di data node,
- query cost per shard,
- fetch cost,
- reduce cost,
- coordinating node pressure,
- GC pause,
- disk IO,
- cache hit/miss,
- segment count,
- merge activity,
- concurrent load.

Formula mental:

```text
Search latency ≈ coordination overhead
              + max(shard query latency)
              + reduce/merge cost
              + fetch cost
              + queueing/network overhead
```

Karena menggunakan max dari shard latency, satu shard lambat dapat membuat seluruh request lambat.

Ini dikenal sebagai tail latency problem.

### 10.1 Tail Latency Dalam Search

Jika 20 shard masing-masing biasanya cepat, tetapi satu shard sedang merge berat, maka query global tetap menunggu shard lambat itu.

```text
Shard 0: 12ms
Shard 1: 14ms
Shard 2: 11ms
Shard 3: 180ms  <-- global latency ikut naik
Shard 4: 13ms
```

Inilah alasan search performance tidak cukup dilihat dari rata-rata. Anda perlu p95, p99, dan shard-level slow logs/profile.

### 10.2 Fan-Out Terlalu Besar

Fan-out besar terjadi ketika:

- terlalu banyak shard per index,
- query mencakup terlalu banyak index,
- alias mengarah ke banyak backing index,
- time range tidak membatasi index,
- tenant tidak memakai routing padahal bisa,
- search endpoint default mencari semua domain.

Gejalanya:

- CPU tinggi di banyak node,
- coordinating node tinggi,
- search thread pool queue naik,
- request latency p99 buruk,
- aggregation lambat,
- cluster terlihat sibuk walau result kecil.

Prinsip:

> Search yang mengembalikan 10 result bisa tetap mahal jika harus bertanya ke 500 shard.

---

## 11. Shard Allocation: Bagaimana Shard Ditempatkan ke Node

Shard allocation adalah proses menempatkan shard copy ke node.

Elasticsearch mempertimbangkan banyak hal:

- node availability,
- disk watermark,
- allocation awareness,
- data tiers,
- shard balancing,
- primary/replica separation,
- index allocation filters,
- cluster routing settings,
- recovery state,
- forced awareness,
- node roles.

Contoh cluster 3 node:

```text
Index cases-v1: 3 primary, 1 replica

Node A: P0, R1
Node B: P1, R2
Node C: P2, R0
```

Jika Node A mati:

```text
Node A lost: P0, R1 gone
Node C has R0 -> promoted to P0
Cluster may allocate new replica elsewhere when capacity available
```

### 11.1 Yellow dan Red Cluster

Cluster health:

- green: semua primary dan replica allocated,
- yellow: semua primary allocated, tetapi ada replica unassigned,
- red: ada primary shard unassigned.

Yellow tidak selalu emergency, tetapi berarti redundancy tidak lengkap.

Red lebih serius karena sebagian data index tidak available.

Contoh yellow yang umum:

```text
Single-node cluster
index has 1 replica
replica cannot be allocated to same node as primary
cluster health = yellow
```

Solusi dev cluster:

```json
PUT my-index/_settings
{
  "index": {
    "number_of_replicas": 0
  }
}
```

Namun production tidak boleh sembarangan menurunkan replica tanpa memahami risiko HA.

### 11.2 Disk Watermark

Elasticsearch memiliki disk watermark untuk mencegah node penuh.

Jika disk usage tinggi, cluster bisa:

- menghindari allocation ke node tertentu,
- memindahkan shard keluar,
- memberi block read-only pada index dalam kondisi flood-stage.

Gejala:

```text
cluster_block_exception: index read-only / allow delete
```

Ini bukan masalah aplikasi semata. Ini sinyal kapasitas/storage emergency.

---

## 12. Cluster Coordination dan Master Election

Elasticsearch cluster butuh elected master untuk mengelola cluster state.

Master election dan cluster formation memastikan hanya ada satu master sah yang mengubah cluster state.

Prinsip high-level:

- master-eligible nodes berpartisipasi dalam voting,
- elected master memproses cluster state updates,
- node lain menerima published cluster state,
- quorum/majority diperlukan agar cluster aman dari split-brain style inconsistency.

Elasticsearch modern memiliki coordination subsystem yang jauh lebih aman dibanding versi lama.

Untuk engineer aplikasi, yang penting bukan detail algoritma election, tetapi konsekuensi desain:

1. Jangan overload master node.
2. Jangan membuat cluster state terlalu besar.
3. Jangan terlalu sering melakukan metadata operations.
4. Pastikan master-eligible nodes punya network stabil.
5. Gunakan minimal 3 master-eligible nodes untuk production HA.
6. Pisahkan dedicated master pada cluster besar.

### 12.1 Master Node Bukan Tempat Query Berat

Jika master node juga data node dan menerima query berat, ia bisa sibuk oleh:

- search,
- aggregation,
- indexing,
- merge,
- GC,
- disk IO.

Jika elected master terganggu, cluster state updates bisa lambat.

Akibat:

- shard allocation lambat,
- node join/leave lambat,
- mapping update lambat,
- index creation lambat,
- cluster terlihat tidak stabil.

Untuk cluster besar, dedicated master-eligible nodes adalah praktik yang sehat.

---

## 13. Coordinating Node: Gateway dan Bottleneck

Node yang menerima request menjadi coordinator.

Misalnya Java service memakai load balancer ke beberapa Elasticsearch nodes:

```text
Java Service
  -> ES Node A
  -> ES Node B
  -> ES Node C
```

Jika request masuk ke Node B, Node B akan menjadi coordinator untuk request itu.

Coordinator harus:

- parse request,
- resolve index/alias,
- check routing,
- send shard requests,
- collect shard responses,
- merge top hits,
- reduce aggregations,
- fetch final docs,
- serialize response JSON.

Jika response besar atau aggregation berat, coordinator bisa memakai CPU/heap signifikan.

### 13.1 Dedicated Coordinating Nodes

Dedicated coordinating nodes bisa berguna ketika:

- traffic search tinggi,
- banyak client,
- aggregation reduce berat,
- ingin isolasi data node dari HTTP client load,
- ingin centralize client endpoint.

Namun mereka juga menambah hop network:

```text
Client -> Coordinating node -> Data nodes -> Coordinating node -> Client
```

Jika coordinating nodes terlalu sedikit, mereka menjadi bottleneck.

Jika terlalu banyak, operational overhead meningkat.

Prinsip:

> Dedicated coordinating node adalah alat isolasi dan traffic shaping, bukan pengganti desain shard/query yang sehat.

---

## 14. Search Latency Decomposition

Ketika search lambat, jangan langsung menyalahkan Elasticsearch.

Pecah latency:

```text
Client-side latency
  - connection pool wait
  - serialization
  - network to ES

Coordinator latency
  - request parsing
  - index/alias resolution
  - shard target selection
  - queueing
  - fan-out

Shard query latency
  - query rewrite
  - term lookup
  - posting traversal
  - scoring
  - filtering
  - aggregation partial collection
  - segment overhead
  - cache behavior

Reduce latency
  - merge top hits
  - reduce aggregation buckets
  - sort

Fetch latency
  - load _source/stored fields
  - highlight
  - script fields
  - doc values

Response latency
  - JSON serialization
  - network back to client
  - client deserialization
```

Top-tier debugging selalu mencari lapisan mana yang dominan.

Contoh:

```text
Symptom: Query 2s
Profile: Shard query only 80ms
Aggregation reduce: huge
Response size: 40MB
Root cause: massive aggregation/response, not inverted index search
```

Atau:

```text
Symptom: Search p99 high
Slow log: only one shard slow
Node stats: merge time high on node with shard
Root cause: shard/node hotspot or merge pressure
```

---

## 15. Write Latency Decomposition

Indexing latency juga perlu dipecah.

```text
Client-side
  - JSON serialization
  - bulk batch formation
  - connection pool wait

Coordinator
  - request parsing
  - bulk item routing
  - forwarding to primary shards

Primary shard
  - mapping parse
  - analysis
  - indexing buffer
  - translog append
  - version/seq_no handling

Replica replication
  - network
  - replica execution
  - replica translog

Background costs
  - refresh
  - flush
  - merge
  - disk IO
  - GC
```

Bulk indexing can fail partially. One bulk response can contain success for some items and failure for others.

Java indexing service must treat bulk response item-by-item, not only by HTTP status.

Bad pattern:

```java
if (bulkResponse.statusCode() == 200) {
    markAllAsIndexed();
}
```

Better mental pattern:

```text
For each bulk item:
  if success -> acknowledge item
  if retryable failure -> retry with backoff
  if non-retryable mapping/data failure -> dead-letter with reason
  if conflict -> apply version policy
```

---

## 16. Shard Count as Architecture Decision

Shard count is not a cosmetic setting.

It affects:

- parallelism,
- fan-out,
- heap overhead,
- recovery time,
- relocation cost,
- merge behavior,
- disk distribution,
- maximum index growth,
- query latency,
- write throughput,
- operational complexity.

### 16.1 Too Few Shards

Potential issues:

- shard becomes too large,
- recovery/relocation slow,
- limited parallelism,
- one shard/node can become bottleneck,
- cannot distribute data enough across nodes,
- index growth constrained.

### 16.2 Too Many Shards

Potential issues:

- high heap/metadata overhead,
- high cluster state overhead,
- too many file handles,
- query fan-out excessive,
- many small segments,
- slower recovery coordination,
- master pressure,
- management APIs slow,
- wasted resources.

### 16.3 Shard Size Is a Practical Constraint

There is no universal perfect shard size. It depends on:

- workload,
- hardware,
- query type,
- indexing rate,
- retention,
- recovery target,
- data tier,
- SLA.

But the principle is stable:

> A shard should be large enough to avoid overhead waste, but small enough to recover, relocate, and search predictably.

Part 023 akan membahas shard and capacity planning secara mendalam.

Untuk sekarang, cukup pegang invariant:

```text
Shard count is a capacity and failure-domain decision.
Not just an index setting.
```

---

## 17. Primary vs Replica: Common Misunderstandings

### 17.1 “Replica Membuat Write Lebih Cepat”

Tidak. Replica biasanya membuat write lebih mahal karena operation harus direplikasi.

Replica membantu read availability dan read throughput, bukan write throughput.

### 17.2 “Tambah Shard Selalu Membuat Search Lebih Cepat”

Tidak. Shard lebih banyak bisa meningkatkan parallelism sampai titik tertentu, tetapi juga menambah fan-out overhead.

Search kecil terhadap banyak shard sering lebih lambat daripada search terhadap sedikit shard sehat.

### 17.3 “Primary Shard Harus Sama Dengan Jumlah Node”

Tidak selalu.

Jumlah shard harus berdasarkan data volume, growth, query pattern, recovery target, dan node capacity.

Jumlah node bisa berubah. Jumlah primary shard index biasa tidak mudah berubah.

### 17.4 “Replica Harus Sama Dengan Jumlah Node - 1”

Tidak selalu.

Replica count tergantung:

- HA requirement,
- read throughput,
- storage budget,
- write overhead tolerance,
- zone failure tolerance,
- workload criticality.

### 17.5 “Satu Index Per Tenant Selalu Lebih Aman”

Tidak selalu.

Satu index per tenant bisa memudahkan isolation, tetapi bisa menciptakan index/shard explosion.

Alternatif:

- shared index dengan `tenant_id` filter,
- custom routing by tenant,
- tiered strategy: large tenants get dedicated index, small tenants share index,
- index per regulatory boundary, not per tenant.

---

## 18. Architecture Patterns

### 18.1 Small Development Cluster

```text
1 node
all roles
replica = 0
```

Cocok untuk local development.

Tidak cocok untuk production HA.

### 18.2 Small Production Cluster

```text
3 nodes
all master-eligible + data + ingest
replica = 1
```

Cocok untuk workload kecil-menengah jika resource cukup dan traffic tidak ekstrem.

Trade-off:

- sederhana,
- murah,
- tetapi master bisa terganggu oleh data workload.

### 18.3 Medium Production Cluster

```text
3 dedicated master-eligible nodes
N data nodes
optional ingest nodes
optional coordinating nodes
```

Lebih sehat untuk workload serius.

```text
Master nodes: cluster state only
Data nodes: shard/search/indexing
Ingest nodes: pipeline processing
Coordinating nodes: client entry/search reduce
```

### 18.4 Search-Heavy Cluster

Ciri:

- banyak query,
- aggregation/facet intensif,
- latency SLA ketat,
- indexing moderate.

Design tendency:

- enough replicas for read throughput,
- careful shard count,
- dedicated coordinating nodes if reduce heavy,
- index sorting if relevant,
- cache-aware filters,
- avoid deep pagination,
- precompute fields for ranking/filter.

### 18.5 Write-Heavy Cluster

Ciri:

- ingestion tinggi,
- bulk indexing,
- logs/events,
- refresh latency boleh lebih longgar.

Design tendency:

- tune refresh interval,
- careful replica count,
- larger bulk batches but not too large,
- enough disk IO,
- manage merge pressure,
- time-based indices/data streams,
- ILM rollover.

### 18.6 Multi-Tenant Search Cluster

Ciri:

- tenant boundary,
- permission filtering,
- query isolation concern,
- tenant size skew.

Options:

```text
Option A: shared index + tenant_id filter
Option B: shared index + tenant_id custom routing
Option C: index per tenant
Option D: hybrid, large tenants dedicated, small tenants shared
```

Trade-off:

| Model | Pro | Con |
|---|---|---|
| Shared index | efficient shard usage | permission/filter correctness critical |
| Custom routing | can reduce fan-out | hotspot risk for large tenants |
| Index per tenant | isolation/migration simpler | index/shard explosion |
| Hybrid | practical at scale | operational complexity |

---

## 19. Elasticsearch Architecture in Java Backend Systems

Sebagai Java engineer, Anda jarang berinteraksi dengan Elasticsearch langsung dari frontend. Biasanya ada service boundary.

Architecture umum:

```text
Frontend
  -> Search API Service (Java)
      -> Elasticsearch

Transactional Services
  -> OLTP Database
  -> Outbox/Event
      -> Indexing Worker (Java)
          -> Elasticsearch
```

### 19.1 Search API Service

Tanggung jawab:

- validate request,
- translate API filter/sort/search text ke Query DSL,
- enforce permissions,
- apply tenant/user visibility,
- set pagination limits,
- prevent expensive queries,
- transform Elasticsearch response ke API response,
- hide Elasticsearch internals from clients,
- observability/tracing.

Tidak ideal:

```text
Frontend sends raw Elasticsearch DSL directly
```

Kenapa bahaya:

- query mahal tak terkontrol,
- security bypass,
- index/mapping detail bocor,
- breaking change sulit,
- no API governance,
- cluster mudah diserang oleh wildcard/regexp/deep pagination.

### 19.2 Indexing Worker

Tanggung jawab:

- consume domain events/outbox,
- build search document,
- apply mapping-compatible transformation,
- bulk index,
- retry correctly,
- dead-letter invalid documents,
- track lag,
- reconcile with source of truth,
- support reindex/backfill.

Indexing worker bukan sekadar “sink connector”. Dalam sistem domain kompleks, ia adalah projection builder.

### 19.3 Why Not Let Every Service Write Directly?

Bad architecture:

```text
Case Service -> Elasticsearch
Party Service -> Elasticsearch
Document Service -> Elasticsearch
Workflow Service -> Elasticsearch
```

Masalah:

- mapping ownership kabur,
- document version conflict,
- partial projection inconsistent,
- duplicate transformation logic,
- no central retry/dead-letter,
- reindex sulit,
- relevance regression sulit dilacak,
- permission field bisa drift.

Better architecture:

```text
Domain services emit events/outbox
Indexing projection service owns search index
Search API service owns query contract
```

---

## 20. Example: Regulatory Case Search Architecture

Untuk konteks regulatory/case management, search sering bukan hanya mencari teks. Ia harus mempertahankan:

- visibility,
- auditability,
- lifecycle correctness,
- status semantics,
- escalation rules,
- permission boundary,
- retention/legal hold,
- historical correctness,
- cross-entity relationship.

### 20.1 Domain Source

```text
OLTP DB:
- cases
- parties
- allegations
- evidence
- workflow_tasks
- decisions
- enforcement_actions
- assignments
- permissions
```

### 20.2 Search Projection

Elasticsearch index:

```text
regulatory-cases-search-v3
```

Document example:

```json
{
  "case_id": "CASE-2026-000123",
  "title": "Unauthorized fund transfer investigation",
  "summary": "Investigation into suspicious transfer pattern...",
  "status": "UNDER_REVIEW",
  "severity": "HIGH",
  "assigned_unit": "ENFORCEMENT_A",
  "assigned_user_ids": ["u123", "u456"],
  "visible_to_org_units": ["ENFORCEMENT_A", "LEGAL_REVIEW"],
  "party_names": ["Acme Capital", "John Doe"],
  "allegation_types": ["AML", "MARKET_ABUSE"],
  "sla_due_at": "2026-07-01T00:00:00Z",
  "created_at": "2026-06-21T09:30:00Z",
  "updated_at": "2026-06-21T10:00:00Z"
}
```

### 20.3 Query Example

User wants:

```text
Find high severity AML cases involving Acme that are under review and visible to me.
```

Backend query pattern:

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "Acme",
            "fields": ["title^2", "summary", "party_names^3"]
          }
        }
      ],
      "filter": [
        { "term": { "status": "UNDER_REVIEW" } },
        { "term": { "severity": "HIGH" } },
        { "term": { "allegation_types": "AML" } },
        { "terms": { "visible_to_org_units": ["ENFORCEMENT_A", "LEGAL_REVIEW"] } }
      ]
    }
  },
  "sort": [
    { "_score": "desc" },
    { "sla_due_at": "asc" },
    { "updated_at": "desc" }
  ]
}
```

Important architecture point:

- permission filter must be mandatory,
- status/severity/allegation should be filter context,
- text relevance should be query context,
- business sort/tie-breaker should be explicit,
- API must not allow caller to remove permission filter,
- query must not search across retired/legal-held data unless allowed.

---

## 21. Failure Domains

Elasticsearch cluster design harus mempertimbangkan failure domain.

### 21.1 Node Failure

Jika satu data node mati:

- primary di node tersebut hilang sementara,
- replica bisa dipromosikan,
- cluster reallocates missing replicas,
- recovery consumes disk/network/CPU.

Jika replica tidak ada, primary loss bisa menyebabkan red index sampai node kembali atau data dipulihkan.

### 21.2 Zone Failure

Jika cluster tersebar di availability zones, shard allocation harus memastikan replica tidak berada di zone yang sama dengan primary.

Tanpa awareness, cluster bisa terlihat redundant tetapi semua copy shard tertentu berada di failure domain yang sama.

### 21.3 Master Failure

Jika elected master mati, cluster perlu memilih master baru.

Dengan cukup master-eligible nodes dan quorum, cluster tetap berjalan.

Jika tidak cukup quorum, cluster tidak bisa aman membuat cluster state update.

### 21.4 Coordinating Node Failure

Jika coordinating node mati saat request berjalan, request itu gagal. Data tetap aman.

Client harus punya retry policy untuk request idempotent/search, dengan timeout dan backoff.

### 21.5 Network Partition

Network partition bisa menyebabkan node kehilangan kontak.

Elasticsearch coordination mencegah multiple masters dalam model modern, tetapi partition tetap bisa menyebabkan:

- unavailable cluster state updates,
- shard unavailability,
- request failures,
- recovery after reconnect,
- relocation churn.

---

## 22. Architecture Smells

Berikut smell yang sering menunjukkan desain Elasticsearch kurang sehat.

### 22.1 Terlalu Banyak Shard Kecil

Gejala:

```text
- heap tinggi walau data kecil
- cluster state besar
- search fan-out besar
- cat shards sangat panjang
- management API lambat
```

Penyebab:

- index per tenant kecil,
- daily index untuk data kecil,
- default shard count tidak disesuaikan,
- rollover terlalu agresif,
- terlalu banyak environment/test index.

### 22.2 Satu Shard Terlalu Besar

Gejala:

```text
- recovery lama
- relocation lama
- single node hotspot
- query terhadap shard tersebut lambat
- merge berat
```

Penyebab:

- primary shard terlalu sedikit,
- routing skew,
- tenant besar dalam satu routing key,
- rollover terlambat.

### 22.3 Master Node Overload

Gejala:

```text
- cluster state update lambat
- node join/leave lambat
- mapping update lambat
- index creation lambat
- elected master GC sering
```

Penyebab:

- master juga data/search heavy,
- cluster state besar,
- terlalu banyak shard/index/field,
- metadata churn.

### 22.4 Search API Membuka Raw DSL

Gejala:

```text
- user bisa membuat expensive query
- permission bypass risk
- index detail bocor
- backward compatibility buruk
- cluster rentan overload
```

### 22.5 Query Selalu Mencari Semua Index

Gejala:

```text
- latency naik seiring retention
- search fan-out makin besar
- result kecil tapi CPU besar
```

Solusi biasanya:

- time-range index selection,
- alias yang tepat,
- filtered alias dengan hati-hati,
- data stream strategy,
- lifecycle-aware query routing.

### 22.6 Document Search Model Sama Persis Dengan OLTP Model

Gejala:

```text
- banyak join di aplikasi setelah search
- result butuh banyak round-trip ke DB
- relevance buruk karena field tersebar
- permission sulit dihitung
- indexing update terlalu granular
```

Elasticsearch document harus didesain dari query behavior, bukan sekadar mirror table.

---

## 23. Invariants Untuk Mendesain Elasticsearch Cluster

Pegang invariant ini.

### 23.1 Every Search Is Shard-Level Work

Search request bukan satu operasi abstrak. Ia pecah menjadi operasi per shard.

Jika shard target banyak, biaya naik.

### 23.2 The Slowest Shard Often Determines Latency

Distributed search p99 sangat dipengaruhi tail latency.

### 23.3 Replicas Improve Availability and Read Scale, But Increase Write Cost

Replica bukan magic performance switch.

### 23.4 Primary Shard Count Is Hard To Change

Jangan asal default. Putuskan dengan growth dan recovery target.

### 23.5 Cluster State Must Be Protected

Index, shard, mapping, alias, dan template adalah metadata. Metadata bisa menjadi bottleneck.

### 23.6 Search Documents Are Projections

Indexing adalah proses membuat projection optimized for retrieval.

### 23.7 Elasticsearch Is Usually Not The Source of Truth

Dalam arsitektur enterprise, source-of-truth tetap OLTP/domain system. Elasticsearch adalah search projection.

### 23.8 Search Architecture Is Query-Pattern Driven

Desain index, shard, routing, analyzer, mapping, dan API harus dimulai dari pertanyaan:

```text
Siapa mencari apa, dengan filter apa, sort apa, permission apa, SLA apa, freshness apa, dan volume apa?
```

---

## 24. Practical Design Questions Sebelum Membuat Index

Sebelum membuat index production, jawab pertanyaan ini.

### 24.1 Query Pattern

- Search apa saja yang harus didukung?
- Apakah query selalu tenant-scoped?
- Apakah query selalu time-scoped?
- Apakah user mencari natural language atau identifier exact?
- Filter apa yang wajib?
- Sort apa yang umum?
- Facet apa yang dibutuhkan?
- Apakah autocomplete diperlukan?
- Apakah highlighting diperlukan?

### 24.2 Data Shape

- Apa retrieval unit?
- Apakah result adalah case, document, party, task, atau mixed?
- Apakah field perlu denormalized?
- Apa field permission?
- Apa field lifecycle/status?
- Apakah historical version searchable?
- Apakah document besar?
- Apakah ada nested arrays?

### 24.3 Volume and Growth

- Berapa document awal?
- Berapa document growth per hari?
- Berapa update per hari?
- Berapa delete per hari?
- Berapa retention?
- Berapa average document size?
- Berapa peak indexing rate?
- Berapa peak search QPS?

### 24.4 Availability and Freshness

- Berapa RPO/RTO?
- Apakah search boleh stale 1 detik, 10 detik, 1 menit?
- Apakah read-after-write dibutuhkan?
- Apakah stale result bisa berdampak hukum/regulatory?
- Apakah ada legal hold?

### 24.5 Operations

- Bagaimana reindex?
- Bagaimana rollback mapping change?
- Bagaimana backfill?
- Bagaimana detect indexing lag?
- Bagaimana repair inconsistent document?
- Bagaimana snapshot/restore?
- Bagaimana monitor slow query?

---

## 25. Java Engineer Checklist: Cluster Interaction

Ketika Java service berinteraksi dengan Elasticsearch, desain hal berikut.

### 25.1 Client Configuration

- gunakan official Java API Client,
- configure connection pool,
- configure request timeout,
- configure socket timeout,
- configure retry dengan hati-hati,
- gunakan compression jika response besar dan sesuai,
- instrument latency per endpoint,
- jangan membuat client baru per request.

### 25.2 Search Request Guardrails

- limit `size`,
- block deep pagination,
- whitelist sort fields,
- whitelist filter fields,
- validate date range,
- require tenant/permission filter,
- prevent raw wildcard query uncontrolled,
- prevent arbitrary script query,
- set timeout,
- set track_total_hits appropriately,
- expose stable API, not raw DSL.

### 25.3 Bulk Indexing Guardrails

- choose bulk size based on bytes and item count,
- classify failures item-by-item,
- retry retryable errors,
- dead-letter invalid documents,
- monitor indexing lag,
- avoid unbounded queue,
- apply backpressure,
- support replay/backfill,
- support idempotency.

### 25.4 Observability

For every search endpoint log/trace:

- query name/use case,
- index/alias,
- user/tenant class if safe,
- request size,
- result size,
- took,
- timed_out,
- shard failures,
- total shards,
- successful shards,
- ES status,
- Java client latency,
- correlation ID.

Do not log sensitive query content blindly in regulated environments.

---

## 26. Common Architecture Decisions and Trade-Offs

### 26.1 One Index vs Multiple Indexes

Use one index when:

- documents share mapping,
- search is often cross-type,
- relevance model shared,
- lifecycle shared,
- permission model similar,
- volume manageable.

Use multiple indexes when:

- mapping differs significantly,
- lifecycle differs,
- retention differs,
- query mostly separated,
- permissions differ strongly,
- write/search load needs isolation,
- migration needs independent rollout.

### 26.2 Shared Index vs Tenant Index

Shared index is efficient, but permission correctness is critical.

Tenant index gives isolation, but can explode shard/index count.

Hybrid is often best for real SaaS/enterprise:

```text
small tenants -> shared pooled indices
large tenants -> dedicated index or dedicated cluster
regulated/special tenants -> isolated deployment
```

### 26.3 Application Transform vs Ingest Pipeline

Application transform:

- better domain logic,
- better tests,
- better version control,
- easier debugging.

Ingest pipeline:

- useful for generic parsing/enrichment,
- central inside Elasticsearch,
- good for logs/observability data,
- can reduce client complexity.

For complex regulatory case search, prefer application-owned projection logic, with ingest pipeline only for technical normalization when useful.

### 26.4 Search Projection vs Direct DB Query

Use Elasticsearch when:

- full-text relevance matters,
- multi-field text matching matters,
- facets/search UX matters,
- large text corpus,
- fuzzy/prefix/semantic/hybrid retrieval,
- query shape not ideal for OLTP indexes.

Do not use Elasticsearch just to avoid writing SQL joins.

If the query is exact transactional lookup with strong consistency requirement, OLTP database is usually better.

---

## 27. Deep Example: Request Lifecycle End-to-End

Scenario:

User searches:

```text
"suspicious transfer" in high-priority open cases assigned to my unit
```

### 27.1 API Request

```http
GET /api/cases/search?q=suspicious%20transfer&status=OPEN&priority=HIGH&pageSize=10
Authorization: Bearer ...
```

### 27.2 Java Search Service

Steps:

```text
1. Authenticate user.
2. Resolve user permissions and org units.
3. Validate q length and pageSize.
4. Build filter clauses:
   - status=OPEN
   - priority=HIGH
   - visible_to_org_units in user's units
5. Build full-text query:
   - title boost
   - summary normal
   - party names boost
6. Add stable sort/tie-breaker.
7. Send query to Elasticsearch alias cases-search-current.
8. Receive response.
9. Transform hits into API DTO.
10. Emit metrics and audit-safe logs.
```

### 27.3 Elasticsearch Cluster

```text
1. Request arrives at Node C.
2. Node C becomes coordinating node.
3. Alias cases-search-current resolves to cases-v3.
4. Routing table says cases-v3 has 6 primary shards.
5. Coordinator selects one copy of each shard.
6. Query phase sent to 6 shard copies.
7. Each shard runs Lucene query:
   - filter status/priority/visibility
   - match text fields
   - compute BM25 score
   - return top local hits
8. Coordinator merges hits.
9. Fetch phase retrieves _source for global top 10.
10. Response serialized to Java service.
```

### 27.4 Hidden Architecture Costs

Even though API result is 10 cases, cluster may have done:

```text
6 shard-level searches
N segment-level searches per shard
filter bitset checks
BM25 scoring
top-K collection
coordinator merge
fetch _source
JSON serialization
```

Search is not “one query”. It is distributed retrieval work.

---

## 28. What Top 1% Engineers Notice Early

Average engineer sees:

```text
Elasticsearch has nodes, indexes, shards, replicas.
```

Strong engineer sees:

```text
Every API decision changes fan-out, cacheability, shard pressure, cluster state, recovery behavior, and operational risk.
```

Average engineer asks:

```text
What query DSL should I write?
```

Strong engineer asks:

```text
What is the retrieval unit?
What shard set does this query hit?
What is the permission boundary?
What is the tail-latency failure mode?
What happens during reindex?
What happens if one node dies?
What happens if a tenant grows 100x?
What if mapping must change?
What if indexing lags?
What if the result is legally challenged?
```

Average engineer uses Elasticsearch as a black-box search database.

Strong engineer treats it as:

```text
Lucene shards + distributed coordination + search projection + operational system.
```

---

## 29. Part 004 Summary

Elasticsearch architecture can be compressed into one sentence:

> Elasticsearch distributes Lucene indexes across nodes as shards, replicates them for availability/read scale, coordinates writes and searches through cluster state and routing, then merges shard-level results into a global response.

Key points:

- Elasticsearch index is logical; shard is physical execution/storage unit.
- Each shard is effectively a Lucene index.
- Primary shard owns document writes.
- Replica shard copies primary shard for HA and read throughput.
- Cluster state is metadata brain of the cluster.
- Elected master manages cluster state, not all search traffic.
- Any node receiving a request becomes coordinating node for that request.
- Search is distributed fan-out/fan-in.
- Query phase finds top candidates per shard.
- Fetch phase retrieves document content for global hits.
- Deep pagination and broad index searches create huge coordinator/shard cost.
- Shard count is an architecture decision.
- Replica count trades write cost for availability/read capacity.
- Java applications should hide raw Elasticsearch DSL behind controlled search APIs.
- Search indexes in enterprise systems should be projections from source-of-truth systems.

---

## 30. Readiness Checklist

Anda siap lanjut ke Part 005 jika bisa menjelaskan tanpa menghafal:

- perbedaan cluster, node, index, shard, replica, segment,
- kenapa shard adalah unit execution penting,
- bagaimana document diroute ke primary shard,
- bagaimana write direplikasi ke replica,
- kenapa acknowledged write belum tentu langsung searchable,
- bagaimana distributed search query phase dan fetch phase bekerja,
- kenapa search ke banyak shard bisa mahal walau result sedikit,
- kenapa cluster state bisa menjadi bottleneck,
- kapan replica membantu dan kapan menambah beban,
- kenapa dedicated master/coordinating node bisa berguna tapi bukan silver bullet,
- kenapa search API Java sebaiknya tidak mengekspos raw DSL ke frontend,
- bagaimana Elasticsearch cocok sebagai search projection dalam architecture enterprise.

---

## 31. Latihan Mental Model

### Latihan 1 — Hitung Shard Copies

Index punya:

```text
number_of_shards = 8
number_of_replicas = 1
```

Berapa total shard copies?

Jawaban:

```text
8 * (1 + 1) = 16 shard copies
```

### Latihan 2 — Fan-Out Query

Search dilakukan ke 5 index. Masing-masing punya 6 primary shard.

Berapa shard-level search tanpa routing?

Jawaban:

```text
5 * 6 = 30 shard-level searches
```

Jika setiap index punya replica 1, apakah search menjadi 60 shard-level searches?

Tidak. Search biasanya memilih satu copy dari setiap shard, bisa primary atau replica. Replica memberi alternatif copy untuk load distribution, bukan berarti query harus ke semua primary dan semua replica.

### Latihan 3 — Single-Node Yellow Cluster

Local Elasticsearch satu node. Index punya 1 primary dan 1 replica.

Kenapa cluster yellow?

Karena replica tidak boleh ditempatkan pada node yang sama dengan primary. Primary allocated, replica unassigned. Maka yellow.

### Latihan 4 — Custom Routing

Semua document tenant `T1` di-index dengan routing `T1`. Query tenant `T1` juga memakai routing `T1`.

Apa manfaatnya?

Query hanya perlu mencari ke shard yang sesuai routing, bukan semua shard.

Apa risikonya?

Jika tenant `T1` sangat besar, shard tersebut bisa menjadi hotspot.

### Latihan 5 — Search Lambat Karena One Slow Shard

Ada 10 shard. 9 shard merespons 20ms, 1 shard merespons 900ms.

Berapa kira-kira lower bound latency query global?

Lebih dekat ke 900ms daripada 20ms, karena coordinator harus menunggu shard lambat untuk hasil global yang benar.

---

## 32. Preview Part 005

Part 005 akan membahas:

# Document Modeling for Search

Fokus berikutnya:

- document sebagai retrieval unit,
- perbedaan entity model vs search document model,
- denormalization untuk search,
- nested/object/flattened/parent-child,
- modeling permission, lifecycle, tenant, status,
- versioning search document,
- designing document shape from query behavior.

Kalau Part 004 menjawab:

```text
Bagaimana Elasticsearch mendistribusikan dan mengeksekusi search?
```

Part 005 menjawab:

```text
Bentuk document seperti apa yang membuat search benar, cepat, dan maintainable?
```

---

## 33. References

Referensi utama yang relevan untuk part ini:

- Elastic Docs — Nodes, clusters, and shards.
- Elastic Docs — Node roles.
- Elastic Docs — Cluster state overview.
- Elastic Docs — Reading and writing documents.
- Elastic Docs — Shard allocation and routing settings.
- Elastic Docs — Size your shards.
- Elastic API Docs — Cat shards API.
- Apache Lucene documentation — index package and segment concepts.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — Apache Lucene Under the Hood</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-005.md">Part 005 — Document Modeling for Search ➡️</a>
</div>
