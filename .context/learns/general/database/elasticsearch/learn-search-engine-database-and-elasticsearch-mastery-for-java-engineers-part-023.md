# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-023

# Part 023 — Shard, Replica, and Capacity Planning

## Status Seri

Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`

Part: `023 / 034`

Status: **belum selesai**.

Part ini membahas desain kapasitas Elasticsearch dari perspektif engineer Java/backend yang harus membuat search platform berjalan stabil di production. Fokusnya bukan sekadar “berapa shard yang benar”, karena jawaban seperti itu hampir selalu salah jika dilepaskan dari workload. Fokus sebenarnya adalah membuat model kapasitas yang bisa dijelaskan, diuji, dimonitor, dan diubah ketika data serta trafik berubah.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, Anda diharapkan mampu:

1. Memahami shard sebagai unit distribusi, eksekusi, recovery, dan biaya operasional.
2. Menentukan jumlah primary shard dan replica shard berdasarkan workload, bukan default template.
3. Mendeteksi oversharding dan undersharding sebelum menjadi incident.
4. Menyusun kapasitas awal cluster berdasarkan data size, indexing rate, search QPS, latency target, retention, dan failure tolerance.
5. Menjelaskan trade-off disk, heap, CPU, IO, network, dan availability secara eksplisit.
6. Mendesain growth plan yang realistis untuk search platform Java.
7. Menghindari keputusan desain shard yang sulit atau mahal diperbaiki setelah data besar.

---

## 2. Posisi Part Ini dalam Seri

Part sebelumnya membahas performance engineering di level query dan indexing:

- Part 021: query performance.
- Part 022: indexing performance.

Part ini naik satu level menjadi **capacity architecture**.

Satu query bisa dioptimalkan.

Satu bulk request bisa dituning.

Tetapi jika shard topology salah, banyak optimasi mikro tidak akan menolong.

Contoh:

- Query sudah memakai filter context, tetapi setiap search harus fan-out ke ratusan shard kecil.
- Bulk size sudah tepat, tetapi shard terlalu besar sehingga recovery setelah node failure memakan waktu lama.
- Replica ditambah untuk read throughput, tetapi disk dan merge pressure naik sampai cluster tidak stabil.
- Index sudah didesain bagus, tetapi growth 12 bulan tidak dihitung sehingga disk watermark menghentikan indexing.

Part ini menjawab pertanyaan yang lebih struktural:

> “Berapa banyak shard, node, replica, disk, heap, dan tier yang dibutuhkan agar workload ini stabil sekarang dan masih masuk akal ketika tumbuh?”

---

## 3. Mental Model Utama: Shard adalah Mini Search Engine

Dalam Elasticsearch, index dibagi menjadi shard. Setiap shard secara praktis adalah satu instance Lucene index yang dapat menyimpan subset dokumen dan mengeksekusi query terhadap subset tersebut.

Model sederhananya:

```text
Elasticsearch Index
  ├── Primary Shard 0 -> Lucene index
  ├── Primary Shard 1 -> Lucene index
  ├── Primary Shard 2 -> Lucene index
  └── ...
```

Replica shard adalah copy dari primary shard. Replica dapat melayani read request dan menjadi primary baru jika primary lama hilang.

```text
Index: cases-v1

Primary shard 0     Replica shard 0
Primary shard 1     Replica shard 1
Primary shard 2     Replica shard 2
```

Shard bukan partisi abstrak tanpa biaya. Shard memiliki:

- Lucene segments.
- File index.
- Metadata.
- Cache footprint.
- Search execution context.
- Merge activity.
- Recovery cost.
- Relocation cost.
- Cluster-state implication.

Karena itu, keputusan jumlah shard adalah keputusan arsitektur.

---

## 4. Primary Shard vs Replica Shard

### 4.1 Primary shard

Primary shard menentukan pembagian data utama dalam index.

Setiap document masuk ke tepat satu primary shard. Default routing biasanya berdasarkan hash dari `_id`, kecuali Anda memakai custom routing.

Primary shard penting karena:

- Menentukan parallelism indexing.
- Menentukan jumlah partisi data.
- Menentukan batas maksimum distribusi data sebuah index.
- Tidak bisa diubah langsung untuk index existing tanpa membuat index baru atau split/shrink dalam kondisi tertentu.

### 4.2 Replica shard

Replica shard adalah salinan primary shard.

Replica berguna untuk:

- Availability.
- Fault tolerance.
- Search throughput.
- Load distribution.

Namun replica juga memiliki biaya:

- Disk bertambah.
- Indexing write harus direplikasi.
- Merge juga terjadi di replica.
- Recovery dan relocation bertambah.
- Cluster membutuhkan lebih banyak resource.

Jangan berpikir replica sebagai “gratis karena hanya copy”. Replica adalah search-capable Lucene index penuh.

---

## 5. Rumus Dasar Shard Copy

Jumlah shard copy total:

```text
Total shard copies = primary_shards × (1 + replica_count)
```

Contoh:

```text
primary_shards = 6
replica_count  = 1

total shard copies = 6 × (1 + 1) = 12
```

Jika `replica_count = 2`:

```text
total shard copies = 6 × (1 + 2) = 18
```

Implikasi:

- Disk kira-kira naik proporsional dengan jumlah copy.
- Recovery unit bertambah.
- Node placement constraint bertambah.
- Cluster coordination bertambah.

Untuk engineer backend, penting membedakan:

```text
logical data size     = ukuran data primary saja
physical storage size = primary + replica + overhead segment/translog/snapshot/cache/temp merge
```

Kapasitas disk tidak boleh dihitung dari logical data size saja.

---

## 6. Shard Size: Kenapa Ukuran Lebih Penting daripada Jumlah Dokumen

Pertanyaan umum:

> “Satu shard sebaiknya berisi berapa juta dokumen?”

Pertanyaan yang lebih tepat:

> “Berapa ukuran shard di disk, bagaimana query-nya, dan seberapa cepat shard itu harus dipindahkan/recover?”

Jumlah dokumen sendiri tidak cukup karena dokumen bisa sangat berbeda ukuran.

Contoh:

```text
100 juta dokumen kecil:
- id
- status
- timestamp
- keyword pendek

bisa lebih kecil daripada:

2 juta dokumen besar:
- body text panjang
- nested evidences
- attachments metadata
- banyak analyzed fields
```

Faktor yang memengaruhi shard size:

- Ukuran `_source`.
- Jumlah field.
- Banyaknya analyzed text field.
- Jumlah token per field.
- Doc values.
- Stored fields.
- Nested documents.
- Vector fields.
- Replica count.
- Segment merge behavior.

Prinsip praktis:

- Shard terlalu kecil: overhead tinggi.
- Shard terlalu besar: recovery lambat, relocation berat, query bisa lambat, maintenance mahal.

Elastic sering memberikan guideline praktis agar shard berada dalam range puluhan GB, dengan perhatian khusus terhadap rollover sekitar 50GB primary shard dan batas jumlah dokumen per shard untuk use case tertentu. Ini bukan hukum fisika, tetapi starting point yang baik untuk capacity planning.

---

## 7. Oversharding

Oversharding terjadi ketika cluster memiliki terlalu banyak shard relatif terhadap data dan workload.

### 7.1 Gejala oversharding

Gejala umum:

- Cluster state besar.
- Master node sibuk.
- Banyak shard sangat kecil.
- Query sederhana tetap lambat karena fan-out ke terlalu banyak shard.
- Banyak tiny segments.
- Heap pressure meningkat.
- Recovery/relocation banyak walaupun data kecil.
- Dashboard menunjukkan shard count tinggi tetapi disk utilization rendah.
- Banyak index harian kecil dengan beberapa primary shard dan replica.

### 7.2 Contoh oversharding

Misal tim membuat index per tenant per hari:

```text
cases-tenant-a-2026-06-01
cases-tenant-b-2026-06-01
cases-tenant-c-2026-06-01
...
```

Setiap index punya:

```text
primary_shards = 3
replica_count = 1
```

Jika ada 200 tenant per hari:

```text
200 index/day × 3 primary × 2 copies = 1,200 shard copies/day
```

Dalam 30 hari:

```text
36,000 shard copies
```

Mungkin data per tenant hanya beberapa MB, tetapi cluster dipaksa mengelola puluhan ribu shard. Ini bukan scaling; ini accidental operational debt.

### 7.3 Penyebab oversharding

Penyebab umum:

- Mengikuti default shard count tanpa menghitung data size.
- Membuat index terlalu granular.
- Index per customer kecil.
- Index per day padahal volume harian kecil.
- Replica terlalu banyak untuk data kecil.
- Tidak memakai rollover berdasarkan ukuran.
- Tidak punya retention policy.
- Membuat multi-field/analyzer terlalu banyak sehingga metadata dan segment overhead membesar.

### 7.4 Cara menghindari oversharding

Strategi:

1. Gunakan index yang lebih besar dan routing/filter tenant di field.
2. Gunakan rollover berdasarkan ukuran atau dokumen, bukan selalu kalender.
3. Kurangi primary shard untuk index kecil.
4. Gunakan data stream untuk append-only time-series/log/event use case.
5. Hapus atau close index lama jika tidak lagi dicari.
6. Gabungkan index kecil melalui reindex jika perlu.
7. Monitor shard size distribution, bukan hanya total disk.

---

## 8. Undersharding

Undersharding terjadi ketika shard terlalu sedikit atau terlalu besar sehingga workload tidak dapat didistribusikan dengan baik.

### 8.1 Gejala undersharding

Gejala umum:

- Satu shard sangat besar.
- Search latency tinggi karena satu shard menjadi bottleneck.
- Indexing throughput mentok di sedikit primary shard.
- Relocation/recovery sangat lama.
- Hot shard.
- Node tertentu jauh lebih berat daripada node lain.
- Tidak bisa memanfaatkan node tambahan secara efektif.

### 8.2 Contoh undersharding

Misal index `cases-v1` memiliki:

```text
primary_shards = 1
replica_count = 1
logical primary size = 1 TB
```

Walaupun cluster punya 10 data nodes, primary data satu index hanya punya satu primary shard. Anda bisa menambah replica untuk read, tetapi primary data tetap satu partisi besar.

Masalah:

- Recovery satu shard 1TB berat.
- Relocation lambat.
- Merge besar.
- Query terhadap primary/replica shard besar tetap mahal.
- Write parallelism terbatas.

### 8.3 Cara menghindari undersharding

Strategi:

1. Estimasikan growth sebelum membuat index.
2. Gunakan rollover untuk membatasi ukuran backing index.
3. Gunakan lebih dari satu primary shard jika data akan besar dan harus tersebar.
4. Gunakan split index hanya jika kondisi cocok, tetapi jangan menjadikannya strategi utama.
5. Rancang ulang index dengan alias dan reindex jika desain awal salah.

---

## 9. Shard Count adalah Kontrak Masa Depan

Primary shard count bukan sekadar setting awal. Ia adalah kontrak terhadap masa depan index.

Ketika index sudah berisi data besar, mengubah primary shard count tidak sesederhana mengubah angka.

Pilihan yang tersedia biasanya:

- Membuat index baru dengan shard count baru lalu reindex.
- Split index jika konfigurasi mendukung.
- Shrink index jika ingin mengurangi primary shard dan kondisi terpenuhi.
- Rollover ke index baru dengan konfigurasi baru.

Karena itu, jangan membuat shard count hanya berdasarkan kondisi hari ini. Tetapi juga jangan overprovision ekstrem berdasarkan mimpi growth yang belum jelas.

Gunakan pendekatan:

```text
current workload + expected 6-12 month growth + safe migration path
```

Bukan:

```text
maximum possible future fantasy
```

---

## 10. Read Throughput dan Replica

Replica dapat meningkatkan kapasitas search karena search request dapat dilayani oleh primary atau replica shard copy.

Namun efeknya tidak selalu linear.

### 10.1 Kapan replica membantu

Replica membantu ketika:

- Workload search-heavy.
- CPU menjadi bottleneck query.
- Ada cukup node untuk menyebar replica.
- Query fan-out tidak terlalu berlebihan.
- Disk dan IO masih cukup.
- Coordinating node tidak menjadi bottleneck.

### 10.2 Kapan replica tidak banyak membantu

Replica tidak menyelesaikan:

- Query terlalu mahal.
- Analyzer/mapping buruk.
- Aggregation cardinality terlalu tinggi.
- Deep pagination.
- Hot shard karena routing tidak merata.
- Coordinating node bottleneck.
- Disk watermark.
- Heap pressure akibat fielddata/mapping explosion.

Menambah replica pada query yang buruk sering hanya menggandakan biaya storage dan merge.

### 10.3 Replica untuk availability

Minimal untuk production multi-node, `replica_count = 1` sering menjadi baseline agar data tetap tersedia jika satu node gagal.

Tetapi availability perlu dihitung terhadap topology:

```text
3 data nodes, 1 replica:
- setiap primary punya 1 copy lain
- masih bisa survive satu node loss jika allocation sehat

2 data nodes, 1 replica:
- bisa survive satu node loss secara data
- tetapi kapasitas tinggal setengah

1 data node, 1 replica:
- replica tidak bisa dialokasikan di node yang sama
- cluster bisa yellow
```

Jadi replica count harus konsisten dengan jumlah node dan failure domain.

---

## 11. Write Throughput dan Primary Shard

Indexing operation masuk ke primary shard, lalu diteruskan ke replica.

Primary shard count memengaruhi write parallelism, tetapi tidak berarti “lebih banyak primary selalu lebih cepat”.

### 11.1 Primary shard terlalu sedikit

Efek:

- Write parallelism terbatas.
- Satu shard menerima banyak indexing load.
- Merge pressure terkonsentrasi.
- Hot shard lebih mudah terjadi.

### 11.2 Primary shard terlalu banyak

Efek:

- Banyak shard kecil.
- Bulk request tersebar ke banyak shard.
- Overhead koordinasi meningkat.
- Segment overhead meningkat.
- Cluster recovery lebih kompleks.

### 11.3 Prinsip

Primary shard count harus cukup untuk:

- Membagi data secara sehat.
- Membagi write load.
- Membagi search load.
- Memungkinkan growth.

Tetapi tidak boleh menjadi kompensasi untuk:

- Bulk pipeline buruk.
- Refresh interval terlalu agresif.
- Mapping/analyzer terlalu mahal.
- Document model terlalu besar.
- Hardware tidak cukup.

---

## 12. Search Fan-Out Cost

Distributed search berjalan dengan pola fan-out/fan-in.

```text
Client
  ↓
Coordinating node
  ↓ fan-out
Shard copies
  ↓ local search
Coordinating node
  ↓ merge top-K + fetch
Client
```

Jika query mengenai 4 shard, fan-out kecil.

Jika query mengenai 400 shard, query sederhana pun bisa mahal.

### 12.1 Mengapa shard banyak membuat search mahal

Setiap shard perlu:

- Menerima request.
- Membuat search context.
- Mengeksekusi query lokal.
- Menghitung local top-K.
- Mengirim hasil ke coordinating node.

Coordinating node perlu:

- Menggabungkan hasil dari semua shard.
- Melakukan global ranking merge.
- Menjalankan fetch phase.
- Mengelola timeout dan partial failure.

Karena itu, search latency bukan hanya fungsi ukuran data total.

Ia juga fungsi:

```text
number_of_target_shards × per_shard_overhead + actual_query_cost + merge_cost
```

### 12.2 Target shard reduction

Cara mengurangi fan-out:

- Gunakan index alias yang tepat.
- Batasi index berdasarkan waktu jika query time-range spesifik.
- Gunakan data stream/backing index dengan lifecycle baik.
- Gunakan routing jika access pattern benar-benar cocok.
- Hindari index-per-small-tenant.
- Hindari wildcard index pattern terlalu luas.

---

## 13. Hot Shard

Hot shard adalah shard yang menerima beban jauh lebih besar daripada shard lain.

### 13.1 Penyebab hot shard

Penyebab umum:

- Custom routing berdasarkan tenant besar.
- Satu tenant sangat dominan.
- Query selalu memukul shard tertentu.
- Time-based index dengan semua write masuk ke current write index.
- Skew pada document ID/routing key.
- Uneven shard allocation.

### 13.2 Contoh hot shard karena tenant routing

Misal routing berdasarkan `tenant_id`:

```text
routing = tenant_id
```

Jika tenant A menyumbang 70% trafik, shard yang menampung tenant A akan panas.

Routing memang bisa mengurangi fan-out, tetapi dapat membuat skew.

### 13.3 Mitigasi hot shard

Strategi:

- Jangan memakai custom routing kecuali distribution dipahami.
- Gunakan routing partitioning untuk tenant besar jika tersedia dan cocok.
- Pisahkan tenant sangat besar ke index sendiri jika memang justified.
- Tambah primary shard untuk index baru jika data/write besar.
- Gunakan rollover untuk time-series/write-heavy workloads.
- Monitor per-shard indexing/search rate.

---

## 14. Capacity Planning: Variabel yang Harus Dikumpulkan

Sebelum menentukan node/shard/replica, kumpulkan data berikut.

### 14.1 Data profile

```text
- Number of documents now
- Number of documents growth per day/month
- Average document size in source system
- Average indexed size in Elasticsearch
- Number of fields
- Number of text fields
- Number of keyword fields
- Nested object count
- Vector field dimension and count
- Retention period
```

### 14.2 Query profile

```text
- Search QPS average
- Search QPS peak
- Query type distribution
- Full-text vs filter-only ratio
- Aggregation usage
- Sort usage
- Pagination depth
- Time-range selectivity
- Tenant selectivity
- Latency SLO p50/p95/p99
```

### 14.3 Write profile

```text
- Indexing rate average
- Indexing rate peak
- Bulk size
- Update ratio
- Delete ratio
- Refresh requirement
- Backfill frequency
- Reindex frequency
```

### 14.4 Availability profile

```text
- Can search be degraded?
- Can writes pause?
- Maximum tolerated stale data
- RPO
- RTO
- Zone failure tolerance
- Node failure tolerance
```

### 14.5 Operational profile

```text
- Deployment environment
- Data tier strategy
- Snapshot policy
- Maintenance windows
- Monitoring maturity
- Team skill level
- Cost ceiling
```

Capacity planning tanpa data ini hanyalah tebakan.

---

## 15. Estimating Data Size

Mulailah dari logical source data, lalu ukur actual indexed size.

### 15.1 Naive estimate

```text
source_document_size × document_count = source_data_size
```

Tetapi indexed size bisa berbeda drastis karena:

- Inverted index.
- Doc values.
- Stored `_source`.
- Analyzer output.
- Multi-fields.
- Nested docs.
- Vectors.

### 15.2 Empirical estimate

Lebih baik ambil sample realistis:

```text
1. Ambil 100k-1M dokumen sample.
2. Index dengan mapping final atau mendekati final.
3. Force merge hanya jika mensimulasikan read-only stabilized index.
4. Ukur primary store size.
5. Hitung indexed_size_per_document.
6. Proyeksikan ke full dataset.
```

Rumus:

```text
indexed_size_per_doc = primary_store_size_sample / sample_doc_count
estimated_primary_size = indexed_size_per_doc × total_doc_count
```

Lalu tambahkan replica:

```text
estimated_total_store = estimated_primary_size × (1 + replica_count)
```

Tambahkan headroom:

```text
required_disk = estimated_total_store × headroom_factor
```

Headroom factor harus mencakup:

- Segment merge temporary space.
- Translog.
- Watermark safety.
- Snapshot/restore operations.
- Growth buffer.
- Operational mistakes.

Praktisnya, jangan merencanakan node disk sampai 95% penuh. Elasticsearch memakai disk watermark untuk mencegah node kehabisan disk; ketika melewati threshold tertentu, allocation dan indexing bisa terganggu.

---

## 16. Disk Watermark dan Headroom

Disk bukan hanya tempat menyimpan data. Disk adalah bagian dari control loop cluster.

Ketika disk usage melewati watermark, Elasticsearch dapat:

- Menghindari allocation shard baru ke node tertentu.
- Memindahkan shard keluar dari node.
- Memblokir write pada kondisi flood-stage.
- Membuat cluster yellow/red jika tidak ada tempat allocation sehat.

Capacity planning harus memastikan:

```text
normal_usage < high_watermark_with_buffer
```

Jangan mendesain:

```text
normal_usage = 89% disk
```

Karena traffic spike, merge, replica recovery, atau reindex bisa langsung mendorong cluster ke kondisi tidak sehat.

Prinsip aman:

- Sisakan disk headroom signifikan.
- Jangan menghitung disk hanya dari current primary+replica store.
- Perhatikan temporary disk saat merge/reindex.
- Alert sebelum watermark tercapai.

---

## 17. Heap Planning

Elasticsearch berjalan di JVM. Heap penting, tetapi heap bukan tempat menyimpan semua data index.

Lucene banyak memanfaatkan filesystem cache di luar heap. Karena itu, node Elasticsearch butuh keseimbangan antara:

```text
JVM heap
filesystem cache
OS memory
```

### 17.1 Apa yang memakan heap

Heap dipakai oleh:

- Cluster metadata.
- Field mappings.
- Search contexts.
- Aggregation structures.
- Fielddata jika digunakan.
- Query caches.
- Request handling.
- Segment metadata.
- Circuit breaker accounting.

### 17.2 Oversharding dan heap

Terlalu banyak shard meningkatkan overhead heap karena setiap shard membawa metadata dan struktur runtime.

Walaupun data kecil, shard count besar bisa membuat heap pressure tinggi.

### 17.3 Field explosion dan heap

Mapping dengan field terlalu banyak juga meningkatkan heap/metadata pressure.

Contoh buruk:

```json
{
  "custom_attributes": {
    "random_key_1": "...",
    "random_key_2": "...",
    "random_key_3": "..."
  }
}
```

Jika dynamic mapping aktif, ribuan key bisa menjadi ribuan field.

Shard planning tidak bisa dipisahkan dari mapping governance.

---

## 18. CPU Planning

CPU dipakai untuk:

- Query execution.
- Scoring.
- Aggregation.
- Highlighting.
- Script execution.
- Segment merge.
- Compression/decompression.
- Indexing analysis.
- Vector similarity search.
- Coordination/merge top-K.

### 18.1 Search-heavy cluster

Search-heavy workload butuh CPU untuk:

- Banyak concurrent query.
- Full-text scoring.
- Aggregation.
- Sorting.
- Highlighting.
- Vector search.

Replica bisa membantu jika CPU per shard copy menjadi bottleneck dan node cukup.

### 18.2 Write-heavy cluster

Write-heavy workload butuh CPU untuk:

- Analyzer.
- Tokenization.
- Inverted index construction.
- Merge.
- Replica indexing.

Primary shard count dan bulk pipeline memengaruhi parallelism.

### 18.3 Mixed workload

Mixed workload paling sulit karena search dan indexing berbagi resource.

Gejala:

- Search latency naik saat bulk indexing besar.
- Merge pressure mengganggu query.
- Refresh sering membuat segment kecil.
- CPU tidak stabil.

Mitigasi:

- Atur refresh interval.
- Gunakan bulk throttling.
- Pisahkan tier/node role jika perlu.
- Jadwalkan backfill di low-traffic window.
- Gunakan ILM/data tiers untuk historical data.

---

## 19. IO dan Filesystem Cache

Elasticsearch sangat bergantung pada disk IO dan filesystem cache.

Search yang sering mengakses posting lists, doc values, stored fields, dan `_source` akan lebih cepat jika data panas berada di cache OS.

### 19.1 Disk IO bottleneck

Gejala:

- Query latency tidak stabil.
- Merge lambat.
- Recovery lambat.
- Snapshot/restore lambat.
- High IO wait.
- Search lambat saat cache dingin.

### 19.2 Storage class

Hot data sebaiknya memakai storage cepat.

Warm/cold/frozen data dapat memakai storage lebih murah jika query jarang dan latency expectation lebih longgar.

Jangan mencampur expectation:

```text
“Data 5 tahun harus murah disimpan, tapi query p95 harus sama cepat dengan data minggu ini.”
```

Itu biasanya kontradiktif kecuali budget besar.

---

## 20. Network Planning

Network dipakai untuk:

- Replication.
- Search fan-out/fan-in.
- Shard relocation.
- Snapshot/restore.
- Cross-zone traffic.
- Client traffic.

Replica dan shard relocation dapat menghasilkan network traffic besar.

### 20.1 Cross-zone implication

Jika cluster tersebar di beberapa availability zone:

- Replica placement harus aware terhadap zone.
- Network latency antar-zone memengaruhi replication dan search.
- Failure domain lebih baik.
- Biaya network bisa meningkat.

### 20.2 Recovery storm

Saat node gagal, cluster mungkin perlu relocate/recover banyak shard.

Jika shard terlalu besar:

- Recovery lama.
- Risiko under-replicated lebih lama.

Jika shard terlalu banyak:

- Banyak recovery kecil.
- Cluster coordination ramai.

Keduanya bisa buruk. Ini alasan shard size harus seimbang.

---

## 21. Node Role dan Workload Separation

Elasticsearch node dapat memiliki role berbeda, seperti master-eligible, data, ingest, coordinating, dan specialized data tier roles.

Untuk cluster kecil, role sering digabung.

Untuk cluster besar, separation lebih penting.

### 21.1 Master-eligible nodes

Master-eligible nodes mengelola cluster coordination dan cluster state.

Jangan membebani dedicated master dengan heavy search/indexing workload.

### 21.2 Data nodes

Data nodes menyimpan shards dan menjalankan indexing/search.

Capacity planning data node mencakup:

- Disk.
- CPU.
- Heap.
- Filesystem cache.
- Network.

### 21.3 Coordinating-only nodes

Coordinating-only nodes dapat membantu jika query fan-out/fan-in berat.

Namun ini bukan silver bullet.

Jika query mengenai terlalu banyak shard atau aggregation terlalu mahal, coordinating node hanya memindahkan bottleneck.

### 21.4 Ingest nodes

Ingest node menjalankan ingest pipeline.

Jika pipeline berat:

- Grok parsing.
- Enrichment.
- Script.
- Attachment extraction.

Maka ingest node capacity harus dihitung terpisah.

---

## 22. Data Tiers

Data tiers membantu menempatkan data berdasarkan temperature dan access pattern.

Model umum:

```text
Hot    -> sering ditulis dan sering dicari, storage cepat
Warm   -> jarang ditulis, masih dicari, storage lebih hemat
Cold   -> jarang dicari, latency lebih longgar
Frozen -> sangat jarang dicari, cost optimized
```

### 22.1 Kapan data tiers cocok

Cocok untuk:

- Logs.
- Metrics.
- Audit trails.
- Event history.
- Time-based case activity.
- Historical regulatory records.

### 22.2 Kapan data tiers kurang cocok

Kurang cocok jika semua data, termasuk data lama, harus dicari dengan latency seragam dan tinggi.

Dalam sistem case management, data lama belum tentu cold secara bisnis. Case lama bisa tiba-tiba penting karena appeal, audit, reopened investigation, legal hold, atau cross-case analysis.

Jadi tiering harus mengikuti access pattern nyata, bukan umur data saja.

---

## 23. Time-Based Indices vs Entity-Based Indices

### 23.1 Time-based indices

Cocok ketika:

- Data append-only.
- Query sering dibatasi waktu.
- Retention berbasis waktu.
- Volume stabil/tinggi.
- Rollover natural.

Contoh:

```text
search-audit-events
case-activity-events
application-logs
regulatory-actions-history
```

### 23.2 Entity-based indices

Cocok ketika:

- Document sering di-update.
- Search berdasarkan current state entity.
- Retention tidak sederhana berbasis waktu.
- Query tidak selalu time-bounded.

Contoh:

```text
cases-current
parties-current
documents-current
```

### 23.3 Hybrid model

Regulatory/case systems sering butuh keduanya:

```text
cases-current             -> current searchable case state
case-activity-events-*    -> historical events/audit trail
case-documents-current    -> current searchable documents metadata/body
```

Capacity planning harus berbeda untuk current-state index dan event-history index.

---

## 24. Rollover-Based Capacity Control

Rollover membuat index baru ketika kondisi tertentu terpenuhi, misalnya ukuran primary shard atau usia.

Mental model:

```text
alias: case-activity-write
  -> backing index 000001
  -> backing index 000002
  -> backing index 000003
```

Ketika backing index terlalu besar atau terlalu tua, write pindah ke index baru.

Manfaat:

- Membatasi shard size.
- Menghindari index harian terlalu kecil.
- Menghindari shard terlalu besar.
- Membantu ILM.
- Membuat retention lebih mudah.

Rollover lebih baik daripada “index per day” jika volume harian tidak stabil.

```text
Index per day:
- mudah dipahami
- tetapi bisa menghasilkan shard kecil saat volume rendah
- bisa menghasilkan shard besar saat volume spike

Rollover by size:
- lebih adaptif terhadap volume
- shard size lebih terkendali
```

---

## 25. Capacity Planning Worksheet

Gunakan worksheet ini sebelum membuat cluster production.

### 25.1 Input

```text
Document count now:                    ?
Document growth per month:             ?
Average indexed size per document:     ?
Retention:                             ?
Replica count:                         ?
Target shard size:                     ?
Peak search QPS:                       ?
Peak indexing docs/sec:                ?
Latency SLO:                           ?
Availability target:                   ?
Zone count:                            ?
```

### 25.2 Estimate primary data

```text
primary_data_size = document_count × indexed_size_per_doc
```

For growth:

```text
future_primary_data_size = primary_data_size + monthly_growth × months
```

### 25.3 Estimate shard count

```text
primary_shard_count = ceil(future_primary_data_size / target_shard_size)
```

Example:

```text
future_primary_data_size = 600 GB
target_shard_size = 40 GB

primary_shard_count = ceil(600 / 40) = 15
```

But this is a starting point, not final answer.

You must then validate:

- Is 15 too many for query fan-out?
- Is data time-partitioned?
- Should it be 3 rollover indices × 5 shards?
- Is write throughput high enough to justify this many primaries?
- Is recovery acceptable?
- Does tenant routing create skew?

### 25.4 Estimate physical store

```text
physical_store = future_primary_data_size × (1 + replica_count)
```

Example:

```text
future_primary_data_size = 600 GB
replica_count = 1

physical_store = 600 × 2 = 1.2 TB
```

Add headroom:

```text
required_disk = physical_store × 1.3 to 1.7
```

The factor depends on workload, merge pressure, retention, snapshots, and operational safety.

### 25.5 Estimate node count by disk

```text
usable_disk_per_node = raw_disk_per_node × safe_utilization
node_count_by_disk = ceil(required_disk / usable_disk_per_node)
```

Example:

```text
raw_disk_per_node = 1 TB
safe_utilization = 0.65
usable_disk_per_node = 650 GB
required_disk = 1.8 TB

node_count_by_disk = ceil(1800 / 650) = 3 nodes
```

Then validate against:

- replica placement.
- zone placement.
- CPU.
- heap.
- IO.
- recovery time.

---

## 26. Capacity Planning Example: Case Search Platform

Suppose we design search for regulatory case management.

### 26.1 Workload

```text
Current cases:              20 million
Growth:                     1 million cases/month
Indexed size per case:      15 KB
Planning horizon:           12 months
Search QPS peak:            300 QPS
Indexing peak:              500 docs/sec
Replica:                    1
Target shard size:          40 GB
Latency SLO:                p95 < 300 ms for common queries
```

### 26.2 Estimate future data

```text
future_docs = 20M + (1M × 12) = 32M
primary_size = 32M × 15 KB = 480,000,000 KB ≈ 458 GB
```

Round up for mapping/index overhead uncertainty:

```text
estimated_primary_size ≈ 550 GB
```

### 26.3 Estimate shard count

```text
target_shard_size = 40 GB
primary_shards = ceil(550 / 40) = 14
```

Candidate designs:

```text
Option A: 1 index × 14 primary shards
Option B: rollover indices, each 4-6 primary shards
Option C: split by major domain: cases-current, parties-current, documents-current
```

For current case search, Option C is often better if query behavior differs by entity.

Potential design:

```text
cases-current:
  primary_shards = 8
  replica = 1

parties-current:
  primary_shards = 4
  replica = 1

case-documents-current:
  primary_shards = 8
  replica = 1
```

But only if queries naturally target those indices separately. Do not split if every search always queries all of them.

### 26.4 Estimate disk

```text
primary = 550 GB
replica = 1
physical = 1.1 TB
headroom factor = 1.5
required = 1.65 TB
```

If nodes have 1TB raw disk and safe utilization 65%:

```text
usable/node = 650 GB
node_count_by_disk = ceil(1650 / 650) = 3
```

But with zone awareness and node failure tolerance, 3 may be minimum, not comfortable.

For p95 search and recovery safety, maybe start with 4-6 data nodes depending on CPU/IO benchmark.

---

## 27. Replica Placement and Failure Domain

A replica cannot protect you if it is placed in the same failure domain as the primary.

Failure domains:

- Process.
- VM/container.
- Host.
- Rack.
- Availability zone.
- Region.

For multi-AZ design:

```text
AZ-A: data nodes
AZ-B: data nodes
AZ-C: data nodes
```

With 1 replica:

- Primary and replica should be in different zones if possible.
- Losing one zone should not lose all copies of a shard.

With 2 replicas across 3 zones:

- Each shard can have one copy per zone.
- Disk cost triples.
- Write replication cost increases.

Do not choose replica count by availability wish alone. Calculate cost and recovery behavior.

---

## 28. Zone Awareness Trade-Off

Zone awareness improves resilience but introduces constraints.

Benefits:

- Better survival of zone failure.
- More predictable replica placement.
- Reduced correlated failure risk.

Costs:

- Allocation becomes more constrained.
- Need enough nodes per zone.
- Temporary imbalance may be harder to fix.
- Cross-zone replication/search traffic may increase.

Bad topology:

```text
AZ-A: 4 nodes
AZ-B: 1 node
AZ-C: 1 node
```

This makes balanced allocation difficult.

Better:

```text
AZ-A: 3 nodes
AZ-B: 3 nodes
AZ-C: 3 nodes
```

Capacity planning must consider symmetrical failure domains where possible.

---

## 29. Shard Allocation and Relocation Cost

Elasticsearch allocates shard copies to nodes and may relocate them due to:

- Node join/leave.
- Disk watermark.
- Tier movement.
- Rebalancing.
- Index creation.
- Recovery after failure.

Relocation cost depends on:

- Shard size.
- Network throughput.
- Disk throughput.
- Concurrent recovery settings.
- Cluster load.
- Segment count.

A 5GB shard is easy to move but too many can create overhead.

A 200GB shard may be manageable in steady state but painful during failure.

This is why capacity design must include recovery time, not only normal query latency.

---

## 30. Recovery-Time Thinking

Ask:

```text
If one data node dies at peak time, what happens?
```

You need to know:

- How many shard copies were on that node?
- How large are they?
- Are replicas available?
- How fast can relocation/recovery happen?
- Is there enough disk on remaining nodes?
- Does recovery saturate network/IO?
- Does search latency degrade?
- Can indexing continue?

If losing one node pushes remaining nodes into disk watermark, your cluster was underprovisioned.

Rule of thumb:

```text
Capacity must survive failure, not just steady state.
```

---

## 31. Search-Heavy vs Write-Heavy Capacity Patterns

### 31.1 Search-heavy

Characteristics:

- High QPS.
- User-facing latency SLO.
- Many filters/facets/sorts.
- Read spikes.

Capacity emphasis:

- CPU.
- Replica count.
- Filesystem cache.
- Coordinating node capacity.
- Query profiling.
- Cache-friendly filters.
- Avoid excessive shard fan-out.

### 31.2 Write-heavy

Characteristics:

- High ingest rate.
- Bulk indexing.
- Frequent updates/deletes.
- Backfills.

Capacity emphasis:

- Primary shard distribution.
- CPU for analysis.
- Disk IO for merges.
- Refresh interval.
- Translog/durability settings.
- Bulk queue/backpressure.
- Replica cost.

### 31.3 Mixed

Characteristics:

- Search and indexing both important.
- Incidents often happen during backfill or reindex.

Capacity emphasis:

- Isolation.
- Throttling.
- Maintenance windows.
- Dedicated ingest pipeline.
- Reindex strategy.
- Load testing with mixed workload, not separate synthetic tests only.

---

## 32. Capacity Planning for Vector Search

Vector search changes capacity assumptions.

Dense vector fields can consume significant disk and memory-related resources depending on index type, dimension, similarity, quantization, and retrieval method.

Important variables:

```text
vector_dimension
number_of_vectors_per_document
number_of_documents
index_options
similarity function
k value
num_candidates
filter selectivity
hybrid search pipeline
```

Vector search capacity usually increases:

- Disk usage.
- CPU cost.
- Memory pressure.
- Query latency variance.

Design implications:

- Do not add embeddings to every document blindly.
- Consider chunk-level index separate from entity-level index.
- Separate vector-heavy workloads if needed.
- Benchmark with realistic `k`, filters, and hybrid reranking.
- Monitor query latency after embedding model changes.

Semantic search is not free search. It is a different retrieval workload.

---

## 33. Capacity Planning for Multi-Tenant Search

Multi-tenant search has special risk: tenant skew.

### 33.1 Bad assumption

```text
We have 1,000 tenants, so load is evenly distributed.
```

Usually false.

Often:

```text
Top 5 tenants produce 60-90% load.
```

### 33.2 Tenant isolation options

Option A: shared index with `tenant_id` filter.

Pros:

- Efficient shard usage.
- Simpler global operations.
- Avoids tiny indices.

Cons:

- Requires strict permission filtering.
- Tenant skew can affect shared resources.

Option B: index per tenant.

Pros:

- Stronger operational isolation.
- Easier per-tenant retention/migration.

Cons:

- High risk of oversharding.
- Harder cluster-state management.
- Many small tenants become expensive.

Option C: hybrid.

```text
large tenants -> dedicated index
small tenants -> shared pooled index
```

This is often more realistic for enterprise SaaS.

---

## 34. Capacity Planning for Regulatory Systems

Regulatory search has different capacity concerns from e-commerce search.

### 34.1 Data is not uniformly accessed

Old cases may suddenly become hot due to:

- Appeal.
- Audit.
- Enforcement escalation.
- Related entity investigation.
- Legal hold.
- Public inquiry.
- Supervisory review.

Do not assume old equals cold without evidence.

### 34.2 Permission filters are always part of workload

Every query may include:

- Tenant/jurisdiction.
- User role.
- Unit/department.
- Case assignment.
- Confidentiality flags.
- Legal restriction.
- Lifecycle status.

These filters affect:

- Query cache behavior.
- Cardinality.
- Result counts.
- Aggregation cost.
- Security correctness.

### 34.3 Auditability and recovery matter

Search cluster can often be rebuilt from source of truth, but:

- Rebuild time matters.
- During rebuild, investigations may be blocked.
- Stale or missing search result can cause operational risk.
- Incorrect visibility can cause regulatory/legal risk.

Capacity planning should include rebuild/reindex capacity, not only normal serving.

---

## 35. Anti-Patterns

### 35.1 “One index per tenant per day”

Usually causes oversharding unless tenant volume is truly large.

### 35.2 “Set primary shards to number of nodes”

Node count changes. Shard count is index-level design. They are related but not identical.

### 35.3 “More shards means more performance”

More shards can increase parallelism, but also increases overhead and fan-out.

### 35.4 “More replicas will fix slow query”

Replica helps read capacity, not bad query design.

### 35.5 “Disk available means capacity available”

Capacity includes CPU, heap, IO, network, recovery, and watermarks.

### 35.6 “Use daily indices by default”

Daily index is not always right. Rollover by size is often better.

### 35.7 “Search cluster can be small because source DB has the real data”

Even if Elasticsearch is rebuildable, downtime or degraded search can still be business-critical.

---

## 36. Practical Decision Framework

When choosing shard/replica/capacity, ask in this order.

### 36.1 What is the retrieval unit?

```text
case?
party?
document?
event?
chunk?
```

Different retrieval units may need different indices.

### 36.2 What is the data growth pattern?

```text
append-only?
update-heavy?
delete-heavy?
time-based?
entity-current-state?
```

### 36.3 What is the query target pattern?

```text
single index?
time range?
tenant?
status?
all historical data?
current only?
```

### 36.4 What shard size range is acceptable?

Choose based on:

- Recovery time.
- Search latency.
- Indexing throughput.
- Operational constraints.

### 36.5 What failure must be tolerated?

```text
one node?
one zone?
rolling restart?
backfill during business hours?
```

### 36.6 What is the migration plan?

If wrong:

- Can we rollover?
- Can we reindex?
- Can we alias swap?
- Can we split/shrink?
- How long will it take?

A design without migration path is fragile.

---

## 37. Java Backend Implications

Shard/capacity design affects Java services directly.

### 37.1 Search API timeout

If query fan-out grows, Java client timeout may start firing.

Do not just increase timeout. Investigate:

- Target shard count.
- Query profile.
- Aggregation cost.
- Coordinating node pressure.
- Hot shards.

### 37.2 Bulk indexing backpressure

If indexing throughput exceeds cluster capacity, Java worker must apply backpressure.

Good worker behavior:

- Bounded queue.
- Bulk size limit.
- Retry only retryable failures.
- Exponential backoff.
- Dead-letter unrecoverable mapping/data errors.
- Lag metrics.

Bad worker behavior:

- Infinite retry loop.
- Unbounded queue.
- Parallelism increase during cluster stress.
- Ignoring partial bulk failures.

### 37.3 Routing decision in application code

If Java service sets routing, that routing becomes part of capacity architecture.

Do not hide routing inside a utility without documentation.

Routing key must be reviewed like a partitioning strategy.

### 37.4 Index alias management

Java services should usually write/search aliases, not hardcoded physical index names.

Example:

```text
cases-write -> cases-v3-000004
cases-read  -> cases-v3-000001, cases-v3-000002, cases-v3-000003, cases-v3-000004
```

This supports rollover and migration.

---

## 38. Monitoring Metrics for Capacity

Monitor these continuously.

### 38.1 Shard metrics

```text
- total shard count
- primary shard count
- shard size distribution
- docs per shard
- segments per shard
- unassigned shards
- relocating shards
- initializing shards
```

### 38.2 Node metrics

```text
- disk used percent
- disk available bytes
- heap used percent
- JVM GC time
- CPU utilization
- IO wait
- filesystem cache pressure
- network throughput
```

### 38.3 Search metrics

```text
- search QPS
- search latency p50/p95/p99
- search thread pool queue/rejections
- query cache hit/miss
- request cache hit/miss
- slow logs
```

### 38.4 Indexing metrics

```text
- indexing rate
- indexing latency
- bulk failure rate
- bulk rejection rate
- merge time
- refresh time
- translog size
```

### 38.5 Allocation/recovery metrics

```text
- relocation rate
- recovery bytes remaining
- recovery time
- disk watermark alerts
- allocation explain output during issue
```

---

## 39. Load Testing Capacity

Capacity planning must be validated with tests.

### 39.1 Test data must be realistic

Bad test:

```text
1 million tiny documents with random strings
```

Good test:

```text
realistic document sizes
realistic field distribution
realistic analyzers
realistic nested objects
realistic permission fields
realistic vectors if used
```

### 39.2 Test queries must be realistic

Include:

- Common searches.
- Rare expensive searches.
- Faceted searches.
- Permission-heavy searches.
- Sort-heavy searches.
- Deep-ish pagination within allowed product behavior.
- Zero-result queries.
- High-result queries.
- Autocomplete/suggest queries.

### 39.3 Test mixed workload

Run search and indexing together.

Production does not pause search while backfill happens unless you design it that way.

### 39.4 Test failure

Simulate:

- Node restart.
- Node loss.
- Disk near watermark.
- Replica recovery.
- Backfill while search load runs.
- Reindex while search load runs.

A capacity plan that only passes sunny-day tests is not production-grade.

---

## 40. Example Capacity Design Review Checklist

Before approving Elasticsearch production design, review:

```text
[ ] Is each index's retrieval unit clear?
[ ] Is primary shard count justified by data size and workload?
[ ] Is target shard size documented?
[ ] Is replica count justified by availability/read throughput?
[ ] Is disk headroom calculated after replica and growth?
[ ] Are disk watermarks considered?
[ ] Is there a rollover/ILM plan where appropriate?
[ ] Is there a reindex/alias migration plan?
[ ] Are query fan-out patterns understood?
[ ] Are large tenants or skew risks identified?
[ ] Are permission filters included in performance testing?
[ ] Are node roles appropriate for cluster size?
[ ] Are hot/warm/cold tiers based on access patterns?
[ ] Is failure-domain placement defined?
[ ] Can the cluster survive one node loss without immediate watermark breach?
[ ] Are search and indexing load tested together?
[ ] Are backfill/reindex operations throttled?
[ ] Are shard metrics monitored?
[ ] Are runbooks prepared for unassigned shards and disk pressure?
```

---

## 41. Key Invariants

Pegang invariant berikut:

1. Shard adalah unit data, query, recovery, relocation, dan overhead.
2. Primary shard count membentuk batas distribusi data sebuah index.
3. Replica meningkatkan availability/read capacity tetapi menambah disk/write/merge cost.
4. Oversharding membuat cluster mahal walaupun data kecil.
5. Undersharding membuat cluster sulit scale walaupun node banyak.
6. Disk capacity harus memperhitungkan watermark, replica, merge, recovery, dan growth.
7. Query latency dipengaruhi jumlah target shard, bukan hanya ukuran data total.
8. Capacity planning tanpa workload profile adalah tebakan.
9. Search capacity harus diuji dengan query dan data realistis.
10. Rollover dan alias adalah alat utama untuk menjaga shard size dan migrasi.

---

## 42. Ringkasan

Shard dan replica planning adalah salah satu keputusan paling berdampak dalam Elasticsearch.

Kesalahan kecil di awal bisa berubah menjadi:

- cluster lambat,
- recovery lama,
- disk watermark incident,
- search fan-out berlebihan,
- reindex besar,
- downtime migrasi,
- biaya infrastruktur membengkak.

Cara berpikir yang benar bukan mencari angka universal, tetapi membangun model:

```text
data size
+ growth
+ query pattern
+ write pattern
+ availability target
+ recovery expectation
+ operational maturity
= shard/replica/capacity plan
```

Engineer top-tier tidak hanya bertanya:

> “Berapa shard yang harus saya pakai?”

Mereka bertanya:

> “Apa konsekuensi shard topology ini terhadap search latency, indexing throughput, recovery time, disk watermark, migration path, dan failure domain selama 12-24 bulan ke depan?”

Itulah perbedaan antara memakai Elasticsearch dan mengoperasikan Elasticsearch sebagai search platform production-grade.

---

## 43. Jembatan ke Part Berikutnya

Part berikutnya adalah:

`Part 024 — Lifecycle Management, Time-Based Indices, and Data Streams`

Di sana kita akan membahas bagaimana menjaga index tetap sehat sepanjang waktu dengan:

- Index Lifecycle Management.
- Rollover.
- Shrink.
- Force merge.
- Delete phase.
- Data streams.
- Retention policy.
- Hot/warm/cold/frozen lifecycle.
- Desain lifecycle berdasarkan query pattern.

Part 023 menjawab:

> “Berapa kapasitas dan shard topology yang masuk akal?”

Part 024 menjawab:

> “Bagaimana topology itu tetap sehat ketika data terus bertambah dan menua?”


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-022.md">⬅️ Part 022 — Performance Engineering II: Indexing Performance</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-024.md">Part 024 — Lifecycle Management, Time-Based Indices, and Data Streams ➡️</a>
</div>
