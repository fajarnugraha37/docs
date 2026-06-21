# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-021.md

# Part 021 — Graph Data Science Fundamentals

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Bagian: `021`  
> Topik: Graph Data Science Fundamentals  
> Target pembaca: Java software engineer / tech lead yang ingin memahami Neo4j Graph Data Science secara arsitektural, operasional, dan praktis.  
> Status seri: **belum selesai**. Ini bukan bagian terakhir. Masih ada Part 022 sampai Part 032.

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas modelling, query, performance, Java integration, operations, clustering, security, dan tooling Neo4j. Bagian ini mulai masuk ke wilayah **Graph Data Science**, disingkat **GDS**.

Tujuan bagian ini bukan membuat kamu hafal semua algoritma. Itu akan dibahas bertahap di bagian berikutnya. Tujuan utama Part 021 adalah membangun mental model yang benar:

1. Apa bedanya **graph database** dan **graph data science**.
2. Mengapa algoritma graph biasanya tidak langsung berjalan di operational graph seperti query Cypher biasa.
3. Apa itu **in-memory graph projection**.
4. Mengapa GDS membutuhkan graph catalog.
5. Apa arti execution mode: `stream`, `stats`, `mutate`, dan `write`.
6. Bagaimana memory estimation memengaruhi desain pipeline.
7. Bagaimana membaca output algoritma tanpa terjebak “angka terlihat ilmiah”.
8. Kapan GDS layak masuk production path, dan kapan sebaiknya offline/batch.
9. Bagaimana Java service sebaiknya berinteraksi dengan GDS.
10. Bagaimana merancang workflow graph analytics yang defensible.

Neo4j Graph Data Science memakai konsep **in-memory graph** yang berisi node dan relationship, dengan property numerik pada node/relationship, disimpan di graph catalog dan dioptimalkan untuk operasi topology/property lookup. Dokumentasi Neo4j juga membagi algoritma GDS ke problem class seperti centrality, community detection, similarity, path finding, DAG algorithms, node embeddings, topological link prediction, dan Pregel API.

---

## 1. Masalah yang Diselesaikan Graph Data Science

Graph database operational biasanya menjawab pertanyaan seperti:

```cypher
MATCH (p:Person {id: $personId})-[:OWNS]->(a:Account)
RETURN a
```

atau:

```cypher
MATCH path = (case:Case {id: $caseId})-[:RELATED_TO*1..3]-(other:Case)
RETURN path
```

Pertanyaan seperti ini bersifat **retrieval**:

- cari node tertentu,
- cari relationship tertentu,
- cari path tertentu,
- filter berdasarkan property,
- tampilkan subgraph yang relevan.

Graph Data Science menjawab jenis pertanyaan yang berbeda:

```text
Node mana yang paling berpengaruh di network ini?
Kelompok fraud ring mana yang muncul dari pola transaksi?
Akun mana yang secara struktur mirip walaupun tidak punya property yang sama?
Hubungan baru apa yang kemungkinan akan muncul?
Case mana yang paling sentral terhadap cluster pelanggaran?
Jika node ini gagal, dependency mana yang terdampak paling besar?
```

Pertanyaan seperti itu bukan hanya retrieval. Itu adalah **analysis over topology**.

Perbedaan penting:

| Pertanyaan | Cocok dengan |
|---|---|
| “Tampilkan akun milik orang ini.” | Cypher traversal |
| “Apakah dua orang ini terhubung sampai 4 hop?” | Cypher traversal atau path finding |
| “Siapa aktor paling sentral dalam network transaksi 6 bulan terakhir?” | GDS centrality |
| “Kelompok mana yang membentuk komunitas aneh?” | GDS community detection |
| “Customer mana yang mirip berdasarkan pola koneksi?” | GDS similarity / embeddings |
| “Relationship mana yang mungkin hilang dari data?” | GDS link prediction |
| “Buat feature graph untuk ML model.” | GDS embeddings / graph features |

### Mental model pertama

Graph database menjawab:

```text
Apa yang terhubung dengan apa?
```

Graph data science menjawab:

```text
Apa arti struktur koneksi ini?
```

---

## 2. Operational Graph vs Analytical Graph

Ini pemisahan paling penting.

### 2.1 Operational graph

Operational graph adalah graph yang dipakai aplikasi sehari-hari.

Contoh:

```text
Person -[:OWNS]-> Account
Account -[:MADE_TRANSACTION]-> Transaction
Transaction -[:TO]-> Account
Case -[:INVOLVES]-> Person
Case -[:SUPPORTED_BY]-> Evidence
Evidence -[:DERIVED_FROM]-> SourceDocument
```

Operational graph biasanya punya karakteristik:

- selalu berubah,
- dipakai transaksi aplikasi,
- constraint penting,
- query latency sensitif,
- berisi banyak property non-analytical,
- mengikuti domain model,
- harus aman secara authorization,
- harus audit-ready.

### 2.2 Analytical graph

Analytical graph adalah representasi graph yang sengaja dibentuk untuk analisis.

Contoh untuk fraud analysis:

```text
Account -[:SENT_MONEY_TO {amount, count, lastSeenAt}]-> Account
Person -[:SHARES_DEVICE_WITH {count}]-> Person
Company -[:SHARES_DIRECTOR_WITH]-> Company
Case -[:SIMILAR_TO {score}]-> Case
```

Analytical graph biasanya:

- tidak selalu identik dengan operational graph,
- sering berupa projection/subgraph,
- sering mengandung derived relationship,
- relationship bisa diberi weight,
- property numerik lebih penting,
- scope waktunya eksplisit,
- bisa dihapus dan dibuat ulang,
- dipakai batch/interactive analytics,
- output-nya harus diinterpretasikan, bukan diterima mentah.

### 2.3 Kesalahan umum

Kesalahan umum engineer baru di GDS adalah menganggap:

```text
Graph di database = graph untuk semua algoritma.
```

Itu sering salah.

Operational graph bisa terlalu kaya, terlalu noisy, terlalu heterogen, atau terlalu besar untuk algoritma tertentu. Analytical graph harus dibangun berdasarkan pertanyaan.

Misalnya, untuk mencari fraud ring, kamu mungkin tidak ingin memasukkan semua relationship:

```text
Person -[:LOGGED_IN]-> Session
Session -[:FROM_IP]-> IpAddress
Person -[:VIEWED_PAGE]-> Page
Person -[:RECEIVED_EMAIL]-> Email
Person -[:OWNS]-> Account
Account -[:TRANSFERRED_TO]-> Account
```

Kalau semua relationship dimasukkan begitu saja, community detection bisa menemukan cluster berdasarkan noise seperti IP publik, email massal, atau halaman populer, bukan pola fraud.

Analytical graph harus menjawab:

```text
Topology mana yang merepresentasikan sinyal yang ingin dianalisis?
```

---

## 3. Apa Itu In-Memory Graph Projection?

GDS tidak sekadar menjalankan algoritma langsung di seluruh database storage graph seperti query Cypher biasa.

GDS membuat **in-memory graph projection**: graph khusus yang dimuat ke memory, berisi node/relationship/property yang dipilih, lalu algoritma berjalan di atas struktur tersebut.

### 3.1 Analogi sederhana

Bayangkan database Neo4j sebagai arsip lengkap:

```text
Database Neo4j
├── semua Person
├── semua Account
├── semua Case
├── semua Evidence
├── semua Transaction
├── semua relationship operasional
├── semua audit metadata
└── semua property domain
```

GDS projection adalah working set khusus:

```text
GDS in-memory graph: fraud_tx_90d
├── Account nodes only
├── TRANSFERRED_TO relationships only
├── relationship weight = totalAmount90d
└── node property = riskScore, accountAgeDays
```

Projection ini sengaja sempit karena algoritma graph sangat sensitif terhadap:

- jumlah node,
- jumlah relationship,
- relationship direction,
- relationship weight,
- property yang dipakai,
- graph density,
- connected component structure.

### 3.2 Mengapa in-memory?

Graph algorithms sering membutuhkan banyak operasi berulang atas topology.

Contoh PageRank:

```text
ulang beberapa iterasi:
  untuk setiap node:
    kumpulkan kontribusi dari neighbor
    update score
```

Kalau setiap operasi neighbor harus menyentuh storage engine transactional biasa, overhead-nya tinggi. Dengan in-memory graph, struktur data dioptimalkan untuk traversal/lookup topology dan property numerik.

### 3.3 Graph projection bukan data copy biasa

Projection bukan sekadar “copy table ke memory”. Projection adalah interpretasi analytical atas operational graph.

Dalam projection, kamu bisa memilih:

- node label mana yang masuk,
- relationship type mana yang masuk,
- property mana yang dibawa,
- apakah relationship dianggap directed atau undirected,
- apakah multiple relationship diagregasi,
- apakah weight dihitung dari property tertentu,
- apakah graph dibuat dari label/type langsung atau dari query Cypher.

### 3.4 Projection harus diberi nama

GDS menyimpan projection di **graph catalog**.

Contoh nama:

```text
fraud_account_transfer_90d
case_similarity_review_scope_2026q2
ownership_control_graph_active
service_dependency_prod
```

Nama graph sebaiknya tidak asal. Nama harus menyatakan:

1. domain,
2. node utama,
3. relationship utama,
4. time window,
5. tujuan analisis.

Nama buruk:

```text
graph1
testGraph
allData
prodGraph
```

Nama baik:

```text
account_transfer_weighted_90d
case_subject_shared_entity_active
company_control_active_snapshot_2026_06
```

---

## 4. Projection Design: Pertanyaan Dulu, Graph Belakangan

Sama seperti graph modelling operational, GDS projection juga harus dimulai dari pertanyaan.

### 4.1 Contoh pertanyaan yang buruk

```text
Kita ingin menjalankan graph algorithm di Neo4j.
```

Ini terlalu kabur. Tidak ada domain, scope, graph shape, atau evaluasi.

### 4.2 Contoh pertanyaan yang baik

```text
Dalam transaksi 90 hari terakhir, akun mana yang paling berperan sebagai bridge antar-cluster transfer berisiko tinggi?
```

Dari pertanyaan ini, kita bisa turunkan:

| Aspek | Keputusan |
|---|---|
| Node | Account |
| Relationship | TRANSFERRED_TO |
| Time scope | last 90 days |
| Weight | total amount, count, atau risk-adjusted amount |
| Direction | directed untuk flow, undirected untuk association |
| Algorithm candidate | betweenness centrality, PageRank, community detection |
| Output | accountId, score, explanation neighborhood |

### 4.3 Projection bukan satu-size-fits-all

Satu operational graph bisa menghasilkan banyak analytical projection.

Contoh operational domain:

```text
Person
Account
Company
Device
IpAddress
Transaction
Case
Evidence
```

Projection 1: account transfer network

```text
(:Account)-[:TRANSFERRED_TO {amount, count}]->(:Account)
```

Projection 2: shared device person network

```text
(:Person)-[:SHARES_DEVICE_WITH {deviceCount}]-(:Person)
```

Projection 3: company control network

```text
(:Company)-[:CONTROLS {percentage}]->(:Company)
```

Projection 4: case similarity graph

```text
(:Case)-[:SIMILAR_TO {score}]-(:Case)
```

Projection 5: evidence provenance DAG

```text
(:Evidence)-[:DERIVED_FROM]->(:EvidenceSource)
```

Masing-masing projection punya algoritma, memory profile, risiko bias, dan interpretasi berbeda.

---

## 5. Native Projection vs Cypher Projection

Secara konseptual, ada dua gaya besar projection:

1. Projection dari label/type graph secara langsung.
2. Projection dari query Cypher yang membentuk graph analytical.

Nama API dan detail versi bisa berubah, tetapi mental model-nya stabil.

### 5.1 Native-style projection

Native-style projection cocok saat analytical graph mirip dengan label dan relationship type yang sudah ada di database.

Contoh konseptual:

```cypher
CALL gds.graph.project(
  'accountTransfers',
  'Account',
  'TRANSFERRED_TO',
  {
    relationshipProperties: 'amount'
  }
)
```

Kelebihan:

- sederhana,
- cepat dipahami,
- cocok untuk graph yang sudah rapi,
- lebih minim transformasi.

Kelemahan:

- kurang fleksibel jika perlu filter kompleks,
- kurang cocok jika perlu derived relationship,
- bisa membawa terlalu banyak node/relationship jika model operational terlalu luas.

### 5.2 Cypher-style projection

Cypher projection cocok saat graph analytical perlu dibentuk dari query.

Contoh konseptual:

```cypher
MATCH (source:Account)-[t:TRANSFERRED_TO]->(target:Account)
WHERE t.createdAt >= date() - duration('P90D')
RETURN gds.graph.project(
  'accountTransfers90d',
  source,
  target,
  {
    relationshipProperties: t.amount
  }
)
```

Atau secara konseptual:

```cypher
MATCH (p1:Person)-[:USED_DEVICE]->(d:Device)<-[:USED_DEVICE]-(p2:Person)
WHERE p1 <> p2
RETURN p1 AS source, p2 AS target, count(d) AS sharedDeviceCount
```

Kelebihan:

- fleksibel,
- bisa filter time window,
- bisa membuat derived edges,
- bisa aggregate multiple relationship,
- bisa mengubah bipartite graph menjadi projected monopartite graph.

Kelemahan:

- query projection bisa mahal,
- transformasi bisa sulit diaudit jika terlalu kompleks,
- raw Cypher projection perlu ditest seperti query production,
- hasil bisa bias jika filtering/agregasi salah.

### 5.3 Projection dari bipartite graph

Banyak domain graph awalnya bipartite.

Contoh:

```text
Person -[:USED]-> Device
Person -[:OWNS]-> Account
Case -[:INVOLVES]-> Entity
User -[:PURCHASED]-> Product
```

Untuk similarity/community, kadang kita proyeksikan menjadi graph antar-entity sejenis:

```text
Person -[:SHARES_DEVICE_WITH]-> Person
Case -[:SHARES_ENTITY_WITH]-> Case
Product -[:CO_PURCHASED_WITH]-> Product
```

Ini powerful, tapi berbahaya jika tidak dikontrol.

Jika satu device dipakai 1.000 orang, proyeksi `SHARES_DEVICE_WITH` bisa menghasilkan kombinasi sangat besar.

Secara kasar:

```text
N pengguna pada satu shared object dapat menghasilkan O(N^2) hubungan antar pengguna.
```

Untuk N = 1.000:

```text
~499.500 pasangan
```

Satu node populer bisa menghancurkan projection.

Karena itu, projection harus punya guard:

```cypher
WHERE device.userCount <= 20
```

atau relationship harus diberi weighting yang menurunkan kontribusi shared object populer.

---

## 6. Graph Catalog Mental Model

Graph catalog adalah registry untuk named in-memory graphs.

Kamu bisa membayangkannya seperti:

```text
GDS Graph Catalog
├── account_transfer_90d
├── case_similarity_active
├── company_control_snapshot
└── service_dependency_prod
```

Setiap graph punya metadata seperti:

- graph name,
- node count,
- relationship count,
- schema,
- memory footprint,
- creation configuration,
- loaded properties,
- orientation,
- degree distribution indicators.

### 6.1 Lifecycle graph catalog

Lifecycle umum:

```text
1. Estimate projection memory
2. Project graph
3. List/inspect graph
4. Run algorithm estimate
5. Run algorithm
6. Interpret result
7. Stream/mutate/write result
8. Drop graph when no longer needed
```

Contoh konseptual:

```cypher
CALL gds.graph.list()
YIELD graphName, nodeCount, relationshipCount
RETURN graphName, nodeCount, relationshipCount;
```

Drop jika tidak dipakai:

```cypher
CALL gds.graph.drop('account_transfer_90d');
```

### 6.2 Kenapa drop penting?

In-memory graph memakai memory. Jika graph catalog dibiarkan penuh, sistem bisa mengalami:

- memory pressure,
- algorithm failure,
- unpredictable latency,
- resource starvation untuk workload lain.

Production GDS harus punya policy:

```text
Setiap projection punya owner, TTL, purpose, dan cleanup rule.
```

---

## 7. Execution Modes: stream, stats, mutate, write

GDS algorithm biasanya punya beberapa execution mode.

Ini sangat penting karena mode menentukan efek samping.

## 7.1 `stream`

`stream` mengembalikan hasil sebagai rows.

Contoh konseptual:

```cypher
CALL gds.pageRank.stream('account_transfer_90d')
YIELD nodeId, score
RETURN gds.util.asNode(nodeId).accountId AS accountId, score
ORDER BY score DESC
LIMIT 20;
```

Cocok untuk:

- eksplorasi,
- preview hasil,
- debugging,
- top-N analysis,
- aplikasi yang ingin membaca hasil tanpa menulis ke database.

Risiko:

- streaming terlalu banyak row bisa membebani client,
- hasil tidak persisted,
- jika query consumer lambat, memory/connection bisa tertekan.

Rule:

```text
Gunakan stream untuk melihat, bukan menyimpan.
```

## 7.2 `stats`

`stats` mengembalikan statistik ringkas tanpa menulis hasil individual.

Cocok untuk:

- memahami apakah algorithm berjalan,
- melihat waktu eksekusi,
- melihat jumlah iterasi,
- melihat konvergensi,
- sanity check.

Contoh konseptual:

```cypher
CALL gds.pageRank.stats('account_transfer_90d')
YIELD ranIterations, didConverge, computeMillis
RETURN ranIterations, didConverge, computeMillis;
```

Rule:

```text
Gunakan stats untuk mengevaluasi run, bukan untuk mengambil hasil per node.
```

## 7.3 `mutate`

`mutate` menulis hasil ke **in-memory projected graph**, bukan ke database Neo4j utama.

Contoh:

```cypher
CALL gds.pageRank.mutate('account_transfer_90d', {
  mutateProperty: 'pageRankScore'
})
YIELD nodePropertiesWritten, computeMillis
RETURN nodePropertiesWritten, computeMillis;
```

Setelah itu, graph projection punya property baru:

```text
Account node dalam projection punya pageRankScore
```

Cocok untuk:

- chaining algorithms,
- memakai output algorithm A sebagai input algorithm B,
- membuat analytical pipeline di memory.

Contoh:

```text
PageRank score -> dipakai sebagai feature untuk node embedding
Community id -> dipakai sebagai feature untuk risk scoring
Similarity score -> dipakai untuk filtering link prediction
```

Rule:

```text
Gunakan mutate untuk analytical pipeline sementara.
```

## 7.4 `write`

`write` menulis hasil ke database Neo4j.

Contoh konseptual:

```cypher
CALL gds.pageRank.write('account_transfer_90d', {
  writeProperty: 'pageRankScore90d'
})
YIELD nodePropertiesWritten, writeMillis
RETURN nodePropertiesWritten, writeMillis;
```

Cocok untuk:

- menyimpan score yang akan dipakai aplikasi,
- membuat derived property,
- memberi label/score untuk investigasi,
- menyimpan hasil batch harian/mingguan.

Risiko:

- hasil algorithm bisa dianggap fakta padahal hanya score,
- write besar bisa membebani database transactional,
- hasil lama bisa stale,
- perlu versioning/time window,
- perlu audit metadata.

Rule:

```text
Gunakan write hanya jika output algoritma sudah punya lifecycle, owner, freshness policy, dan interpretasi bisnis.
```

---

## 8. Mutate vs Write: Perbedaan yang Sering Disalahpahami

Perbedaan inti:

| Mode | Menulis ke mana? | Persisted? | Cocok untuk |
|---|---|---|---|
| `stream` | client result | tidak | preview / read result |
| `stats` | summary result | tidak | inspect run |
| `mutate` | in-memory projection | tidak permanen | chain algorithms |
| `write` | Neo4j database | ya | operationalize result |

Kesalahan umum:

```text
Menjalankan write terlalu cepat karena ingin “menyimpan hasil”.
```

Sebelum `write`, tanyakan:

1. Apakah score ini stabil?
2. Apakah score ini punya time window?
3. Apakah nama property menyatakan versi/window?
4. Siapa owner score?
5. Kapan score expire?
6. Apakah score boleh dipakai untuk keputusan otomatis?
7. Apakah score perlu explanation?
8. Apakah ada bias/fairness concern?
9. Apakah hasil write perlu audit metadata?
10. Bagaimana rollback jika algorithm/model salah?

Nama property buruk:

```text
riskScore
pageRank
community
```

Nama lebih baik:

```text
riskScore_tx90d_v2026_06_21
pageRank_transfer90d_v3
community_sharedDevice30d_louvain_v2
```

Tetapi property versioned juga bisa meledak. Alternatifnya simpan hasil sebagai node/relationship snapshot:

```text
(:GraphAnalysisRun {id, type, algorithm, version, windowStart, windowEnd, executedAt})
(:Account)-[:HAS_SCORE {score, rank}]->(:GraphAnalysisRun)
```

Atau:

```text
(:Account)-[:RANKED_IN {score, rank}]->(:AnalysisRun)
```

Ini lebih audit-friendly untuk domain regulatory/enforcement.

---

## 9. Memory Estimation: Jangan Jalankan Algoritma Buta

Graph algorithm bisa mahal. Jumlah node/relationship besar, property banyak, dan algorithm tertentu punya memory footprint yang tidak intuitif.

Karena itu GDS menyediakan memory estimation untuk projection dan algorithm.

### 9.1 Mengapa estimation wajib?

Tanpa estimation, kamu bisa menjalankan algorithm yang:

- gagal karena memory tidak cukup,
- mengganggu workload database,
- membuat proses analytics lama,
- menimbulkan timeout,
- menyebabkan pipeline batch tidak predictable.

Production rule:

```text
Tidak ada algorithm run besar tanpa estimate.
```

### 9.2 Hal yang memengaruhi memory

Memory dipengaruhi oleh:

- node count,
- relationship count,
- relationship orientation,
- loaded node properties,
- loaded relationship properties,
- algorithm data structure,
- concurrency,
- intermediate output,
- mutate property,
- write buffering.

### 9.3 Estimation sebagai architecture signal

Jika estimate terlalu besar, jangan langsung menambah memory. Itu mungkin tanda model/projection salah.

Pertanyaan koreksi:

```text
Apakah semua node perlu masuk?
Apakah semua relationship perlu masuk?
Apakah time window terlalu besar?
Apakah relationship populer menyebabkan density tinggi?
Apakah graph perlu dipartisi per tenant/region/domain?
Apakah property yang dibawa terlalu banyak?
Apakah algorithm yang dipilih memang tepat?
```

### 9.4 Contoh reasoning

Requirement:

```text
Cari komunitas transaksi mencurigakan seluruh account selama 5 tahun.
```

Projection awal:

```text
Account nodes: 100 juta
TRANSFERRED_TO relationships: 4 miliar
```

Ini mungkin terlalu besar untuk satu run.

Projection yang lebih defensible:

```text
Account nodes: accounts with risk signal in last 90 days
Relationships: transfer relationship above threshold or connected to flagged entity
Time window: 90 days
Partition: per region or tenant
Algorithm: WCC/Louvain on candidate subgraph
```

GDS bukan alasan untuk menganalisis semua data sekaligus. GDS harus dipakai dengan scope yang dirancang.

---

## 10. Graph Orientation: Directed vs Undirected

Graph algorithms sangat sensitif terhadap direction.

Operational graph:

```text
(:Account)-[:TRANSFERRED_TO]->(:Account)
```

Pertanyaan 1:

```text
Akun mana yang menjadi sumber aliran dana?
```

Direction penting.

Pertanyaan 2:

```text
Akun mana yang berada dalam cluster transaksi saling terkait?
```

Direction mungkin tidak terlalu penting; undirected graph bisa lebih tepat.

### 10.1 Directed interpretation

Directed graph cocok untuk:

- money flow,
- dependency direction,
- authority/control,
- citation/reference,
- parent-child lineage,
- escalation path.

Contoh:

```text
Company A CONTROLS Company B
Service A CALLS Service B
Account A TRANSFERRED_TO Account B
Evidence DERIVED_FROM Source
```

### 10.2 Undirected interpretation

Undirected graph cocok untuk:

- association,
- co-occurrence,
- similarity,
- shared attribute,
- membership in same cluster.

Contoh:

```text
Person SHARES_DEVICE_WITH Person
Case SIMILAR_TO Case
Company SHARES_DIRECTOR_WITH Company
User SIMILAR_TO User
```

### 10.3 Salah direction = salah hasil

Jika graph transfer uang dibuat undirected, PageRank atau centrality bisa memberi interpretasi keliru.

Jika graph shared device dibuat directed tanpa makna arah, hasil bisa arbitrer.

Checklist:

```text
Apakah arah relationship punya makna kausal/aliran?
Apakah algorithm menghormati direction?
Apakah pertanyaan bisnis butuh incoming, outgoing, atau both?
Apakah direction hanya artefak modelling?
```

---

## 11. Weighted vs Unweighted Graph

Banyak algorithm bisa berjalan di graph unweighted atau weighted.

Unweighted graph:

```text
Account A terhubung ke Account B
```

Weighted graph:

```text
Account A terhubung ke Account B dengan total amount 500 juta
```

atau:

```text
Person A berbagi 3 device dengan Person B
```

### 11.1 Kapan weight penting?

Weight penting jika intensitas hubungan bermakna.

Contoh:

| Domain | Relationship | Weight candidate |
|---|---|---|
| Fraud | Account transfer | amount, count, risk-adjusted amount |
| IAM | User has permission | privilege risk score |
| Case management | Case similar to case | similarity score |
| Supply chain | Supplier depends on supplier | volume, criticality |
| Recommendation | User interacted with item | frequency, recency-weighted score |
| Network | Service calls service | request count, latency impact |

### 11.2 Weight bukan selalu “lebih baik”

Weight buruk bisa memperburuk analisis.

Contoh:

```text
amount
```

Mungkin raw amount terlalu bias ke corporate account besar. Mungkin perlu log transform:

```text
log(1 + amount)
```

Atau risk-adjusted:

```text
amount * counterpartyRiskFactor
```

Atau recency-weighted:

```text
amount * decay(daysSinceTransaction)
```

### 11.3 Weight harus punya makna monotonic

Banyak algorithm mengasumsikan bahwa weight lebih besar berarti hubungan lebih kuat, atau cost lebih besar tergantung algorithm.

Jangan asal pakai property.

Pertanyaan:

```text
Dalam algorithm ini, weight dianggap strength atau distance/cost?
Kalau weight naik, apakah hubungan makin kuat atau makin mahal?
Apakah skala weight stabil?
Apakah outlier mendominasi?
Apakah perlu normalization?
```

---

## 12. Algorithm Families: Peta Besar

Part berikutnya akan membahas family algorithm secara detail. Di sini kita buat peta mental dulu.

## 12.1 Centrality

Menjawab:

```text
Node mana yang penting?
```

Contoh:

- degree centrality,
- PageRank,
- betweenness centrality,
- closeness centrality.

Use case:

- aktor penting dalam fraud network,
- service paling kritikal,
- case paling sentral,
- account yang menjadi hub.

Bahaya:

- “penting” bukan selalu “bersalah”,
- high degree bisa berarti populer, bukan mencurigakan,
- centrality bias terhadap data coverage.

## 12.2 Community detection

Menjawab:

```text
Node mana yang membentuk kelompok?
```

Contoh:

- weakly connected components,
- strongly connected components,
- Louvain,
- Leiden,
- label propagation.

Use case:

- fraud ring,
- related case group,
- customer segment,
- dependency cluster.

Bahaya:

- community bukan bukti kausal,
- cluster besar bisa akibat node populer,
- hasil bisa berubah saat graph berubah.

## 12.3 Similarity

Menjawab:

```text
Node mana yang mirip berdasarkan koneksi/properti?
```

Contoh:

- node similarity,
- KNN,
- overlap metrics.

Use case:

- similar cases,
- similar customers,
- related entities,
- recommendation candidates.

Bahaya:

- similarity bisa superficial,
- shared popular node bisa menciptakan false similarity,
- perlu threshold dan explanation.

## 12.4 Path finding

Menjawab:

```text
Jalur terbaik/terpendek/termurah antara node apa?
```

Contoh:

- shortest path,
- Dijkstra,
- A*,
- Yen’s k-shortest paths,
- minimum spanning tree.

Use case:

- dependency impact,
- routing,
- ownership chain,
- escalation path,
- supply chain risk.

Bahaya:

- shortest path bukan selalu meaningful path,
- weight semantics sering salah,
- banyak path alternatif bisa membingungkan.

## 12.5 Embeddings

Menjawab:

```text
Bagaimana merepresentasikan node sebagai vector berdasarkan struktur graph?
```

Contoh:

- FastRP,
- GraphSAGE,
- node embeddings.

Use case:

- ML features,
- similarity search,
- recommendation,
- anomaly detection,
- GraphRAG/hybrid retrieval.

Bahaya:

- interpretability rendah,
- embeddings bisa stale,
- evaluation sulit,
- tidak otomatis lebih baik dari graph features sederhana.

## 12.6 Link prediction

Menjawab:

```text
Relationship apa yang mungkin ada atau muncul?
```

Use case:

- missing relationship detection,
- fraud association suggestion,
- recommendation,
- knowledge graph completion.

Bahaya:

- prediksi bukan fakta,
- false positive bisa mahal,
- harus human-in-the-loop untuk domain high-stakes.

---

## 13. GDS Workflow End-to-End

Workflow matang:

```text
1. Define business question
2. Define analytical graph shape
3. Define time window / scope
4. Validate data quality
5. Estimate projection memory
6. Project graph
7. Inspect graph catalog metadata
8. Estimate algorithm memory
9. Run algorithm in stats/stream mode
10. Validate result distribution
11. Interpret sample results manually
12. Mutate if chaining algorithms
13. Write only if output has lifecycle
14. Attach metadata/provenance
15. Monitor drift and freshness
16. Drop graph projection if temporary
```

### 13.1 Bad workflow

```text
CALL gds.pageRank.write('graph', {writeProperty: 'riskScore'})
```

Lalu aplikasi memakai `riskScore` untuk memprioritaskan enforcement tanpa explanation.

Masalah:

- algorithm dipilih tanpa hypothesis,
- projection tidak jelas,
- window tidak jelas,
- property name misleading,
- score dianggap risk padahal PageRank bukan risk,
- tidak ada validation,
- tidak ada audit metadata.

### 13.2 Good workflow

```text
Hypothesis:
Accounts that bridge high-risk transfer clusters may indicate mule/account broker behavior.

Projection:
Account nodes with transfer activity in last 90 days,
TRANSFERRED_TO relationships aggregated by source-target,
relationship weight = log(1 + totalAmount) * riskFactor.

Algorithm:
Betweenness centrality for bridge detection.

Validation:
Top 100 inspected by analyst,
compare against known cases,
measure precision@K,
exclude treasury/platform settlement accounts.

Output:
BridgeScore linked to AnalysisRun with algorithm config, window, data source snapshot, and execution timestamp.
```

---

## 14. Interpreting Algorithm Output

Graph algorithm output bukan kebenaran domain. Output adalah sinyal matematis dari graph yang kamu pilih.

Jika graph projection salah, hasil benar secara matematis tapi salah secara domain.

### 14.1 Score adalah function dari projection

Secara mental:

```text
score = algorithm(projection(data, filters, weights, orientation, window))
```

Jadi score berubah jika:

- data berubah,
- filter berubah,
- relationship direction berubah,
- weight berubah,
- window berubah,
- algorithm config berubah,
- graph cleaning berubah.

Jangan pernah menyimpan score tanpa metadata.

### 14.2 Distribution matters

Jangan hanya lihat top 10. Lihat distribusi:

```text
min
max
mean
median
p90
p95
p99
outliers
zero-count
null-count
```

Pertanyaan:

```text
Apakah score sangat skewed?
Apakah top result didominasi supernode?
Apakah banyak node score 0?
Apakah score stabil antar-run?
Apakah perubahan kecil data membuat ranking berubah drastis?
```

### 14.3 Explanation neighborhood

Untuk domain investigasi, score harus bisa dijelaskan dengan subgraph lokal.

Contoh:

```cypher
MATCH path = (a:Account {id: $accountId})-[:TRANSFERRED_TO*1..2]-(b:Account)
RETURN path
LIMIT 50;
```

Tetapi explanation tidak harus seluruh graph. Explanation harus cukup untuk membantu analyst memahami:

- kenapa node tinggi,
- koneksi mana yang berkontribusi,
- apakah ada node populer/noisy,
- apakah hasil masuk akal.

### 14.4 Score bukan keputusan

Dalam sistem high-stakes:

```text
GDS score should support decision, not silently become decision.
```

Terutama untuk:

- enforcement,
- credit/risk,
- law enforcement,
- employment,
- healthcare,
- regulatory sanction.

Output harus diperlakukan sebagai:

```text
candidate signal
priority hint
investigation lead
feature for model
```

bukan sebagai:

```text
automatic guilt
final risk truth
regulatory finding
```

---

## 15. Data Quality untuk GDS

Graph analytics sangat rentan terhadap data quality.

### 15.1 Duplicate node

Jika satu orang muncul sebagai 3 node:

```text
Person{id: P1}
Person{id: P1_DUP}
Person{name: "same person"}
```

Centrality, community, similarity bisa pecah.

### 15.2 Missing relationship

Jika data transfer sebagian hilang, path dan community detection bisa salah.

### 15.3 Noisy relationship

Relationship yang terlalu umum bisa mendominasi.

Contoh:

```text
Person -[:USED_IP]-> PublicWifiIp
```

Jika IP publik menghubungkan ribuan orang, community detection akan menemukan “komunitas WiFi publik”, bukan fraud ring.

### 15.4 Temporal inconsistency

Jika relationship lama dicampur dengan relationship baru tanpa window, graph bisa mencerminkan sejarah yang tidak lagi relevan.

Contoh:

```text
Person worked_for Company 10 years ago
```

Mungkin tidak relevan untuk current ownership risk.

### 15.5 Property scale mismatch

Jika weight menggabungkan amount kecil dan besar tanpa normalization, outlier bisa mendominasi.

Checklist data quality:

```text
- Apakah node identity sudah dedup?
- Apakah relationship punya source/provenance?
- Apakah time window eksplisit?
- Apakah noisy hub dikeluarkan/didownweight?
- Apakah edge weight dinormalisasi?
- Apakah missing data diketahui?
- Apakah graph merepresentasikan current state atau historical state?
```

---

## 16. GDS dalam Arsitektur Java

Sebagai Java engineer, jangan mulai dari library call. Mulai dari boundary.

Ada beberapa pola integrasi.

---

## 16.1 Pattern A — Analyst-run GDS, Application Reads Persisted Results

```text
Analyst / batch job
    ↓
Run GDS algorithm
    ↓
Write result to Neo4j
    ↓
Java application reads score/result
```

Cocok untuk:

- dashboard,
- investigation prioritization,
- periodic risk scoring,
- offline analytics.

Kelebihan:

- aplikasi sederhana,
- latency predictable,
- GDS tidak berada di request path,
- hasil bisa direview sebelum dipakai.

Kekurangan:

- hasil bisa stale,
- butuh pipeline refresh,
- perlu metadata run.

Java service hanya membaca:

```cypher
MATCH (a:Account {id: $accountId})
RETURN a.riskScore_tx90d_v3 AS score
```

Atau lebih audit-friendly:

```cypher
MATCH (a:Account {id: $accountId})-[r:RANKED_IN]->(run:GraphAnalysisRun {id: $runId})
RETURN r.score, r.rank, run.algorithm, run.windowStart, run.windowEnd
```

---

## 16.2 Pattern B — Java Orchestrates GDS Batch Job

```text
Scheduler / Java worker
    ↓
estimate projection
    ↓
project graph
    ↓
run algorithm
    ↓
validate output
    ↓
write result
    ↓
drop projection
```

Cocok untuk:

- nightly scoring,
- tenant-level batch,
- controlled pipeline,
- repeatable analytics run.

Java responsibilities:

- parameterize time window,
- enforce estimate threshold,
- create analysis run record,
- run projection,
- run algorithm,
- capture metrics,
- write result,
- mark run success/failure,
- cleanup graph catalog.

Pseudo-code:

```java
public final class GraphAnalysisJob {

    public void run(AccountTransferWindow window) {
        AnalysisRun run = analysisRunRepository.start("BETWEENNESS_ACCOUNT_TRANSFER", window);

        try (Session session = driver.session(SessionConfig.forDatabase("neo4j"))) {
            session.executeWrite(tx -> {
                estimateProjection(tx, window);
                projectGraph(tx, run.graphName(), window);
                estimateAlgorithm(tx, run.graphName());
                runAlgorithmAndWrite(tx, run.graphName(), run.id());
                dropGraph(tx, run.graphName());
                markSuccess(tx, run.id());
                return null;
            });
        } catch (Exception ex) {
            analysisRunRepository.markFailed(run.id(), ex);
            safeDropGraph(run.graphName());
            throw ex;
        }
    }
}
```

Caution:

Jangan semua langkah besar dipaksa dalam satu transaction jika write/algorithm panjang. Banyak GDS procedure punya transaction behavior sendiri. Desain orchestration harus mengikuti dokumentasi procedure dan operational safety.

---

## 16.3 Pattern C — Request-time GDS

```text
HTTP request
    ↓
Run GDS algorithm
    ↓
Return result
```

Ini jarang cocok.

Cocok hanya untuk:

- graph kecil,
- interactive analysis internal,
- bounded single-source path algorithm,
- low-frequency request,
- non-critical UI exploration.

Tidak cocok untuk:

- high-QPS API,
- algorithm mahal,
- projection besar,
- centrality/community over big graph,
- workflow yang butuh consistent low latency.

Rule:

```text
Jangan taruh global graph algorithm di synchronous request path kecuali kamu bisa membuktikan latency, memory, dan failure behavior-nya bounded.
```

---

## 16.4 Pattern D — GDS as Feature Engineering Pipeline

```text
Neo4j graph
    ↓
GDS embeddings / centrality / community
    ↓
features
    ↓
ML model / ranking model / retrieval model
```

Cocok untuk:

- recommendation,
- fraud model,
- entity resolution,
- GraphRAG,
- anomaly detection.

Key concern:

- feature freshness,
- training-serving skew,
- feature versioning,
- explainability,
- evaluation.

---

## 17. Designing a Defensible GDS Output Model

Untuk domain regulasi/enforcement, hindari menyimpan output GDS sebagai property mentah tanpa provenance.

### 17.1 Minimal but weak

```text
(:Account {id, riskScore})
```

Masalah:

- score dari run mana?
- algorithm apa?
- window apa?
- data source kapan?
- config apa?
- siapa yang menjalankan?
- apakah sudah tervalidasi?

### 17.2 Better: analysis run as first-class node

```text
(:GraphAnalysisRun {
  id,
  purpose,
  algorithm,
  algorithmVersion,
  projectionName,
  projectionConfigHash,
  windowStart,
  windowEnd,
  executedAt,
  executedBy,
  status,
  dataSnapshotId,
  notes
})

(:Account)-[:SCORED_IN {
  score,
  rank,
  percentile,
  explanationAvailable
}]->(:GraphAnalysisRun)
```

Kelebihan:

- audit-friendly,
- bisa bandingkan antar-run,
- bisa rollback logical,
- bisa explain freshness,
- bisa trace config.

### 17.3 Add review workflow

Untuk high-stakes:

```text
(:Account)-[:SCORED_IN]->(:GraphAnalysisRun)
(:InvestigationLead)-[:GENERATED_FROM]->(:GraphAnalysisRun)
(:Analyst)-[:REVIEWED]->(:InvestigationLead)
(:Decision)-[:SUPPORTED_BY]->(:InvestigationLead)
```

Dengan begitu GDS output tidak langsung menjadi enforcement decision. Ia menjadi lead/signal yang direview.

---

## 18. GDS Production Readiness Checklist

Sebelum GDS masuk production, jawab checklist ini.

### 18.1 Problem definition

```text
- Apa pertanyaan bisnis yang dijawab?
- Apa hypothesis-nya?
- Apa action yang akan diambil dari output?
- Apakah output hanya ranking, signal, recommendation, atau decision support?
```

### 18.2 Projection

```text
- Node apa yang masuk?
- Relationship apa yang masuk?
- Time window apa?
- Direction apa?
- Weight apa?
- Filter apa?
- Apakah projection bisa direproduksi?
- Apakah projection punya nama dan metadata jelas?
```

### 18.3 Data quality

```text
- Apakah duplicate node terkendali?
- Apakah missing data diketahui?
- Apakah noisy hub dikontrol?
- Apakah temporal validity jelas?
- Apakah property weight tervalidasi?
```

### 18.4 Resource

```text
- Apakah projection memory sudah di-estimate?
- Apakah algorithm memory sudah di-estimate?
- Apakah concurrency sesuai kapasitas?
- Apakah ada timeout / cancellation plan?
- Apakah graph catalog dibersihkan?
```

### 18.5 Output

```text
- Apakah hasil hanya stream, mutate, atau write?
- Jika write, apakah ada lifecycle/freshness?
- Apakah output punya metadata run?
- Apakah hasil bisa dijelaskan?
- Apakah ada validation sample?
```

### 18.6 Operations

```text
- Apakah job idempotent?
- Apakah partial failure aman?
- Apakah run bisa diulang?
- Apakah old result bisa dibedakan dari new result?
- Apakah monitoring tersedia?
- Apakah alert ada untuk failed/stale run?
```

### 18.7 Governance

```text
- Apakah output dipakai untuk high-stakes decision?
- Apakah perlu human review?
- Apakah bias/fairness risk diperiksa?
- Apakah audit trail cukup?
- Apakah data retention sesuai?
```

---

## 19. Failure Modes dalam GDS

## 19.1 Algorithm cargo culting

Gejala:

```text
“Kita pakai PageRank karena populer.”
```

Masalah:

PageRank menjawab influence/importance dalam graph tertentu, bukan risk/fraud secara otomatis.

Perbaikan:

```text
Mulai dari hypothesis, bukan nama algoritma.
```

## 19.2 Projection too broad

Gejala:

```text
Masukkan semua node dan semua relationship.
```

Masalah:

Graph terlalu noisy dan mahal.

Perbaikan:

```text
Buat projection per pertanyaan.
```

## 19.3 Supernode domination

Gejala:

Top results selalu node populer:

```text
public IP, default bank account, marketplace settlement account, generic category, admin group
```

Perbaikan:

- exclude hub tertentu,
- cap degree,
- downweight popular shared objects,
- segment graph,
- pakai domain-specific filter.

## 19.4 Stale score

Gejala:

Aplikasi memakai score 3 bulan lalu sebagai risk sekarang.

Perbaikan:

- simpan `executedAt`, `windowEnd`, `expiresAt`,
- tampilkan freshness,
- schedule refresh,
- invalidate old score.

## 19.5 Write without provenance

Gejala:

```text
node.riskScore = 0.92
```

Tidak ada yang tahu asalnya.

Perbaikan:

- `GraphAnalysisRun`,
- config hash,
- algorithm version,
- data snapshot,
- relationship hasil.

## 19.6 Human overtrust

Gejala:

Analyst melihat score tinggi dan menganggap pasti bersalah.

Perbaikan:

- label sebagai signal,
- tampilkan explanation neighborhood,
- tampilkan confidence/limitations,
- wajib review workflow.

## 19.7 Training-serving skew

Gejala:

Embeddings/features dibuat dari graph batch, tetapi serving memakai graph yang sudah berubah.

Perbaikan:

- versioned features,
- feature freshness SLA,
- retraining schedule,
- drift monitoring.

## 19.8 Production resource contention

Gejala:

GDS job besar membuat database lambat.

Perbaikan:

- isolate analytics workload,
- run off-peak,
- separate cluster/environment,
- memory estimation,
- concurrency limits,
- Aura Graph Analytics / ephemeral compute pattern jika cocok.

---

## 20. Worked Example: Case Similarity Projection

Misalkan kamu membangun complex case management platform.

Requirement:

```text
Investigator ingin menemukan case lain yang mirip dengan case aktif berdasarkan subject, company, regulation, allegation type, dan evidence source.
```

### 20.1 Operational graph

```text
(:Case)-[:INVOLVES]->(:Person)
(:Case)-[:INVOLVES]->(:Company)
(:Case)-[:ALLEGES]->(:AllegationType)
(:Case)-[:UNDER_REGULATION]->(:Regulation)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Evidence)-[:FROM_SOURCE]->(:SourceSystem)
```

### 20.2 Analytical graph option A: Case-to-feature bipartite

```text
(:Case)-[:HAS_FEATURE]->(:Feature)
```

Feature nodes:

```text
Person:P123
Company:C456
Regulation:R789
AllegationType:LateFiling
SourceSystem:BankReport
```

### 20.3 Analytical graph option B: Case-to-case similarity

Derived relationship:

```text
(:Case)-[:SIMILAR_TO {score, sharedFeatureCount}]-(:Case)
```

Projection:

```text
Case nodes
SIMILAR_TO relationships
weight = score
```

### 20.4 Algorithm candidates

- node similarity,
- KNN,
- community detection on similarity graph,
- centrality if looking for representative cases.

### 20.5 Guardrails

Exclude over-common features:

```text
Regulation used by 90% of cases should not dominate similarity.
```

Downweight common features:

```text
featureWeight = inverseDocumentFrequency(feature)
```

Time-bound relevance:

```text
Only active/recent cases, or compare with historical separately.
```

### 20.6 Output model

```text
(:Case)-[:HAS_SIMILARITY_RESULT {
  score,
  rank,
  sharedFeatures,
  generatedAt
}]->(:CaseSimilarityRun)

(:CaseSimilarityRun {
  id,
  algorithm,
  featureConfigVersion,
  windowStart,
  windowEnd,
  executedAt
})
```

### 20.7 Why this is defensible

Karena hasil similarity bisa dijelaskan:

```text
Case A mirip Case B karena:
- melibatkan company yang sama,
- allegation type sama,
- regulation sama,
- evidence source sama,
- subject memiliki relationship historis.
```

Bukan hanya:

```text
Embedding cosine similarity = 0.83
```

Untuk regulatory system, explanation sering lebih penting daripada skor.

---

## 21. Worked Example: Fraud Bridge Detection

Requirement:

```text
Cari account yang menghubungkan beberapa cluster transfer mencurigakan.
```

### 21.1 Bad approach

```text
Run PageRank on all accounts and call it fraud risk.
```

Masalah:

- PageRank tinggi bisa berarti account populer/legit,
- all-time data terlalu noisy,
- settlement account mendominasi,
- tidak ada explanation.

### 21.2 Better approach

Hypothesis:

```text
Mule/broker account sering menjadi bridge antara beberapa cluster yang seharusnya tidak terkait.
```

Projection:

```text
Nodes: Account with suspicious activity in last 90 days
Relationships: TRANSFERRED_TO aggregated by account pair
Weight: log(1 + totalAmount) * suspiciousCounterpartyFactor
Exclusions: known platform settlement accounts, internal treasury accounts
Direction: directed for flow analysis, undirected for bridge/community analysis depending on algorithm
```

Algorithm:

```text
Weakly connected components -> find candidate components
Louvain/Leiden -> find communities
Betweenness centrality -> bridge score
```

Output:

```text
Account bridge score + component + community + explanation paths
```

Validation:

```text
Known fraud cases overlap?
False positive review?
Top-K precision?
Are top nodes explainable?
```

---

## 22. GDS and Neo4j Operations Boundary

GDS can run inside Neo4j environment, but graph analytics workload has different behavior from OLTP queries.

Operational Cypher query:

```text
small bounded traversal, many requests, low latency
```

GDS workload:

```text
large graph scan/computation, fewer jobs, high memory/CPU
```

Mixing both without planning causes contention.

### 22.1 Options

1. Run GDS on same DB during off-peak.
2. Run GDS on separate analytics replica/environment.
3. Use snapshot/export into analytics environment.
4. Use cloud/ephemeral graph analytics session if appropriate.
5. Precompute results offline and serve from operational DB.

### 22.2 Decision table

| Workload | Recommended pattern |
|---|---|
| small interactive path finding | request-time may be okay |
| nightly centrality on million-node graph | batch/off-peak/separate compute |
| analyst experiment | sandbox/analytics environment |
| regulatory scoring | controlled batch with audit run |
| recommendation feature generation | offline feature pipeline |
| high-QPS API | precomputed result, not live GDS |

---

## 23. What Top 1% Engineers Do Differently with GDS

Mediocre usage:

```text
Run algorithm, store score, show dashboard.
```

Strong usage:

```text
Define hypothesis, design projection, estimate memory, validate result, attach provenance, monitor drift, and keep humans aware of interpretation limits.
```

Top-tier usage:

```text
Treat GDS as a graph-derived signal pipeline with explicit domain semantics, lifecycle, operational isolation, reproducibility, failure modelling, and governance.
```

Top 1% engineer akan selalu bertanya:

1. Graph apa yang dianalisis?
2. Kenapa graph itu merepresentasikan pertanyaan bisnis?
3. Apa yang dikeluarkan dari graph dan kenapa?
4. Bagaimana node populer/noisy ditangani?
5. Weight artinya apa?
6. Direction artinya apa?
7. Algorithm menjawab pertanyaan apa?
8. Apa failure mode matematisnya?
9. Apa failure mode operasionalnya?
10. Bagaimana hasil divalidasi?
11. Bagaimana hasil dijelaskan?
12. Bagaimana hasil diaudit?
13. Bagaimana hasil expire?
14. Apa dampak jika hasil salah?
15. Apakah GDS perlu live, batch, atau offline?

---

## 24. Mini Lab: Thinking Exercise

Gunakan domain regulatory case management.

### 24.1 Requirement

```text
Prioritaskan case yang tampaknya paling terkait dengan jaringan pelanggaran yang sedang berkembang.
```

### 24.2 Jangan langsung pilih algorithm

Jawab dulu:

```text
Apa arti “terkait”?
Apa arti “jaringan”?
Apa arti “sedang berkembang”?
Apa time window?
Apa entity utama?
Apa relationship utama?
Apakah case terhubung lewat subject, company, evidence, transaction, atau regulation?
Apakah hubungan lama tetap relevan?
Apakah semua relationship punya bobot sama?
```

### 24.3 Candidate projection

```text
Nodes:
  Case

Relationships:
  RELATED_BY_SHARED_SUBJECT
  RELATED_BY_SHARED_COMPANY
  RELATED_BY_SHARED_EVIDENCE_SOURCE
  RELATED_BY_SHARED_TRANSACTION_COUNTERPARTY

Relationship properties:
  score
  featureCount
  strongestFeatureType
  lastObservedAt
```

### 24.4 Candidate algorithms

```text
Community detection:
  find case clusters

Centrality:
  find case central to emerging network

Similarity:
  find related historical cases

Path finding:
  explain connection between cases
```

### 24.5 Output interpretation

Jangan katakan:

```text
Case ini paling bersalah.
```

Katakan:

```text
Case ini memiliki centrality tinggi dalam projection case-relatedness 90 hari terakhir, terutama karena berbagi subject dan evidence source dengan beberapa case aktif. Ini layak diprioritaskan untuk review.
```

---

## 25. Ringkasan Mental Model

Graph Data Science bukan “Cypher query yang lebih canggih”. Ia adalah pipeline analitik berbasis topology.

Inti yang harus dibawa:

```text
Operational graph menyimpan fakta dan hubungan domain.
Analytical graph memilih subset/transformasi fakta untuk menjawab pertanyaan tertentu.
GDS algorithm berjalan di atas in-memory projection.
Projection menentukan makna output.
Execution mode menentukan efek samping.
Memory estimation adalah bagian dari desain, bukan opsional.
Score harus ditafsirkan, divalidasi, diberi metadata, dan diaudit.
```

Kalimat paling penting:

```text
In GDS, the projection is the model.
```

Kalau projection salah, algorithm benar pun menghasilkan insight yang salah.

---

## 26. Checklist Cepat Sebelum Menjalankan GDS

Sebelum menjalankan algorithm apa pun:

```text
[ ] Pertanyaan bisnis jelas
[ ] Hypothesis jelas
[ ] Node projection jelas
[ ] Relationship projection jelas
[ ] Direction jelas
[ ] Weight jelas
[ ] Time window jelas
[ ] Noisy hub strategy jelas
[ ] Memory estimate dilakukan
[ ] Algorithm sesuai pertanyaan
[ ] Execution mode dipilih sadar
[ ] Output interpretation jelas
[ ] Validation plan ada
[ ] Provenance/audit plan ada jika write
[ ] Cleanup graph catalog ada
```

---

## 27. Referensi Resmi

Referensi utama untuk bagian ini:

1. Neo4j Graph Data Science Manual — overview, graph management, algorithms, machine learning, production deployment.
2. Neo4j GDS Graph Management — in-memory graph, graph catalog, graph listing, graph projection.
3. Neo4j GDS Memory Estimation — estimating memory requirements for projected graph and algorithms.
4. Neo4j GDS Algorithms — algorithm categories and execution modes.
5. Neo4j GDS Syntax Overview — `stream`, `stats`, `mutate`, and `write` modes.
6. Neo4j GDS Native Projection — node/relationship projection from labels and relationship types.
7. Neo4j GDS Aura Graph Analytics — ephemeral/on-demand graph analytics compute environment.

---

## 28. Penutup

Part 021 membangun fondasi Graph Data Science:

- operational graph vs analytical graph,
- in-memory graph projection,
- graph catalog,
- projection design,
- execution modes,
- memory estimation,
- output interpretation,
- Java integration patterns,
- production governance.

Bagian berikutnya akan mulai membahas family algoritma pertama secara dalam:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-022.md
```

Topik:

```text
Centrality, Influence, and Importance Algorithms
```

Status seri:

```text
Part 000 selesai.
Part 001 selesai.
Part 002 selesai.
Part 003 selesai.
Part 004 selesai.
Part 005 selesai.
Part 006 selesai.
Part 007 selesai.
Part 008 selesai.
Part 009 selesai.
Part 010 selesai.
Part 011 selesai.
Part 012 selesai.
Part 013 selesai.
Part 014 selesai.
Part 015 selesai.
Part 016 selesai.
Part 017 selesai.
Part 018 selesai.
Part 019 selesai.
Part 020 selesai.
Part 021 selesai.
Seri belum selesai.
Masih ada Part 022 sampai Part 032.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — APOC and Neo4j Tooling Ecosystem</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-022.md">Part 022 — Centrality, Influence, and Importance Algorithms ➡️</a>
</div>
