# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-024.md

# Part 024 — Path Finding, Routing, and Impact Analysis

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Audiens: Java software engineer / tech lead  
> Fokus: graph path finding, routing, blast radius, dependency impact, weighted paths, GDS path algorithms, dan production reasoning  
> Prasyarat: Part 000–023, terutama Cypher path semantics, query performance, supernodes, Java integration, dan GDS fundamentals

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas:

- graph thinking,
- property graph model,
- Cypher pattern matching,
- variable-length traversal,
- modelling patterns,
- query performance,
- supernode/fan-out,
- Java integration,
- operations,
- Graph Data Science,
- centrality,
- community detection,
- similarity,
- link prediction.

Sekarang kita masuk ke salah satu kemampuan paling natural dari graph database:

> menemukan, membandingkan, membatasi, dan menjelaskan **path**.

Namun “path” bukan satu hal tunggal.

Ada banyak pertanyaan berbeda yang terlihat mirip tetapi membutuhkan strategi berbeda:

```text
Apakah A terhubung ke B?
Apa jalur terpendek dari A ke B?
Apa jalur termurah dari A ke B jika setiap edge punya biaya?
Apa semua node yang terdampak jika X gagal?
Apa semua dependent service sampai depth 3?
Apa route alternatif terbaik jika satu node/edge dihindari?
Apa top 5 path paling murah?
Apa path yang paling defensible untuk menjelaskan keputusan?
Apa semua entity yang reachable dari kasus ini melalui hubungan ownership/control?
```

Bagian ini akan membangun mental model agar Anda bisa memilih:

- kapan cukup memakai Cypher traversal,
- kapan harus memakai GDS path finding,
- kapan path query harus dibatasi,
- kapan hasil path tidak boleh dipercaya secara naif,
- bagaimana memodelkan cost/weight,
- bagaimana menerjemahkan path finding menjadi impact analysis,
- bagaimana mengintegrasikannya ke service Java production.

Target akhirnya:

> Anda tidak hanya bisa “menulis shortest path query”, tetapi bisa mendesain path-based capability yang aman, performan, dapat dijelaskan, dan tahan audit.

---

## 1. Mental Model: Path Query Bukan Sekadar “Join Berantai”

Di relational database, ketika kita mencari hubungan beberapa tabel, kita biasanya menulis join:

```sql
SELECT ...
FROM account a
JOIN ownership o ON o.account_id = a.id
JOIN person p ON p.id = o.person_id
JOIN case_subject cs ON cs.person_id = p.id
JOIN case c ON c.id = cs.case_id;
```

Join seperti ini biasanya punya struktur relatif tetap.

Di graph, path query bisa punya struktur variabel:

```cypher
MATCH path = (a:Account {id: $accountId})-[:OWNED_BY|CONTROLLED_BY*1..5]->(x)
RETURN path;
```

Perbedaan pentingnya:

| Aspek | Join biasa | Path traversal |
|---|---|---|
| Panjang hubungan | Biasanya fixed | Bisa variable-length |
| Struktur query | Relatif deterministik | Bisa bercabang besar |
| Risiko utama | Join besar, scan, sort | Fan-out, cycle, path explosion |
| Optimasi utama | Index, join order | Start node, relationship type, depth bound, uniqueness, projection |
| Hasil | Rows | Paths, reachable nodes, costs, route |
| Kesalahan umum | Missing index | Unbounded traversal |

Graph path query bukan hanya “join yang lebih enak ditulis”.

Graph path query adalah operasi eksplorasi ruang kemungkinan.

Karena itu pertanyaan pertama selalu:

> Seberapa besar ruang path yang sedang saya izinkan query jelajahi?

Jika jawabannya tidak jelas, query Anda belum aman.

---

## 2. Vocabulary Path Finding

Sebelum masuk Neo4j, kita perlu menyamakan istilah.

### 2.1 Node

Entity dalam graph.

Contoh:

- `Person`,
- `Organization`,
- `Account`,
- `Transaction`,
- `Case`,
- `Service`,
- `Package`,
- `Policy`,
- `Resource`.

### 2.2 Relationship / Edge

Koneksi antar-node.

Contoh:

```text
(:Person)-[:OWNS]->(:Organization)
(:Service)-[:DEPENDS_ON]->(:Service)
(:Account)-[:TRANSFERRED_TO]->(:Account)
(:Case)-[:RELATED_TO]->(:Case)
(:User)-[:MEMBER_OF]->(:Group)
(:Role)-[:GRANTS]->(:Permission)
```

### 2.3 Directed edge

Relationship punya arah storage/logical.

```text
A -[:DEPENDS_ON]-> B
```

Interpretasinya:

```text
A membutuhkan B.
Jika B gagal, A mungkin terdampak.
```

Untuk impact analysis, arah traversal bisa berlawanan dengan arah dependency.

Jika modelnya:

```text
ServiceA -[:DEPENDS_ON]-> ServiceB
```

Maka:

- “Apa dependency ServiceA?” traversal keluar dari A.
- “Siapa terdampak jika ServiceB gagal?” traversal masuk ke B.

Ini sering menjadi sumber bug domain.

### 2.4 Path

Urutan node dan relationship.

```text
A -[r1]-> B -[r2]-> C -[r3]-> D
```

Path bukan hanya target node. Path menyimpan jejak koneksi.

Dalam investigasi, path sering lebih penting daripada node akhirnya karena path menjelaskan “mengapa entity ini relevan”.

### 2.5 Walk, trail, simple path

Istilah teori graph:

| Istilah | Arti |
|---|---|
| Walk | Boleh mengulang node dan edge |
| Trail | Tidak mengulang edge |
| Simple path | Tidak mengulang node |

Dalam sistem nyata, Anda perlu bertanya:

> Apakah query boleh melewati entity yang sama lebih dari sekali?

Jika iya, cycle bisa membuat hasil membengkak.

### 2.6 Reachability

Pertanyaan apakah node B dapat dicapai dari node A melalui relationship tertentu.

```text
Can A reach B?
```

Ini berbeda dari “apa path terbaiknya”.

### 2.7 Distance

Jarak bisa berarti:

- jumlah hop,
- total cost,
- total risk,
- waktu tempuh,
- latency,
- confidence decay,
- monetary exposure,
- regulatory severity.

Jangan menganggap distance selalu jumlah relationship.

### 2.8 Weight / cost

Angka pada relationship atau node yang dipakai algorithm untuk menentukan “lebih murah” atau “lebih pendek”.

Contoh:

```cypher
(:Warehouse)-[:ROUTE {distanceKm: 120, tollCost: 15.0, riskScore: 0.3}]->(:Warehouse)
```

Weight harus punya semantic yang jelas.

Buruk:

```text
cost = score campuran dari risk + distance + preference + penalty tanpa definisi stabil
```

Lebih baik:

```text
cost = normalized travel time in minutes
riskCost = calibrated risk score from 0.0 to 1.0
exposureCost = estimated financial exposure in IDR
```

---

## 3. Empat Keluarga Pertanyaan Path

Sebagian besar path problem dapat dikelompokkan menjadi empat keluarga.

### 3.1 Reachability

Pertanyaan:

```text
Apakah A terhubung ke B?
Node apa saja yang reachable dari A?
```

Contoh:

```text
Apakah suspect ini terhubung ke beneficial owner?
Apa semua downstream services dari Payment API?
Apa semua resources yang bisa diakses user ini melalui group nesting?
```

Strategi umum:

- Cypher variable-length traversal untuk query kecil/operasional,
- BFS/GDS untuk traversal analytical,
- connected components untuk precomputed reachability cluster.

### 3.2 Shortest path by hop count

Pertanyaan:

```text
Apa jalur dengan jumlah hop paling sedikit?
```

Contoh:

```text
Apa koneksi terdekat antara dua fraud accounts?
Apa dependency chain terpendek dari frontend ke database?
```

Strategi umum:

- Cypher shortest path untuk simple use case,
- GDS BFS/shortest path untuk graph projection dan analytics,
- batasi relationship type dan node scope.

### 3.3 Weighted shortest path

Pertanyaan:

```text
Apa jalur dengan total biaya paling rendah?
```

Contoh:

```text
Route pengiriman termurah.
Path risiko terendah.
Path latency terendah.
Path supply chain dengan disruption cost paling kecil.
```

Strategi umum:

- GDS Dijkstra untuk positive weight,
- GDS A* jika ada heuristic spatial/geographic,
- Bellman-Ford-like approach jika negative weights relevan, dengan kehati-hatian tinggi,
- jangan memaksa weighted path dengan Cypher manual aggregation untuk graph besar.

### 3.4 k-shortest / alternatives

Pertanyaan:

```text
Apa beberapa jalur terbaik, bukan hanya satu?
```

Contoh:

```text
Apa 5 route alternatif jika route utama gagal?
Apa beberapa jalur keterkaitan kasus yang paling masuk akal?
Apa alternatif dependency path saat service tertentu dihindari?
```

Strategi umum:

- Yen’s k-shortest paths,
- filtering forbidden nodes/edges,
- ranking by domain cost,
- post-processing explanation.

---

## 4. Cypher Traversal vs GDS Path Finding

Ini keputusan arsitektural penting.

### 4.1 Cypher traversal cocok untuk apa?

Cypher cocok ketika:

- query operasional,
- traversal depth kecil,
- start node sangat selektif,
- relationship type jelas,
- hasil perlu langsung dikaitkan dengan property graph database,
- path explanation sederhana,
- volume tidak terlalu besar,
- tidak perlu algorithm kompleks.

Contoh:

```cypher
MATCH path = (:Case {caseId: $caseId})-[:INVOLVES|SUPPORTED_BY|RELATED_TO*1..3]->(x)
RETURN path
LIMIT 100;
```

Cocok untuk eksplorasi bounded.

### 4.2 Cypher traversal tidak cocok ketika apa?

Cypher mulai bermasalah ketika:

- depth besar,
- graph padat,
- semua path ingin dikembalikan,
- weighted shortest path besar,
- k-shortest alternatives,
- source-target banyak,
- all-pairs analysis,
- repeated computation di graph besar,
- perlu memory estimation/algorithm lifecycle.

Contoh berbahaya:

```cypher
MATCH path = (:Account {id: $id})-[:TRANSFERRED_TO*]->(:Account)
RETURN path;
```

Masalah:

- depth tidak dibatasi,
- cycle mungkin ada,
- path count bisa meledak,
- hasil bisa tidak pernah praktis digunakan.

### 4.3 GDS cocok untuk apa?

GDS cocok ketika:

- Anda menjalankan graph algorithm eksplisit,
- graph analysis lebih berat daripada request CRUD biasa,
- perlu projected graph,
- perlu execution modes `stream`, `stats`, `mutate`, atau `write`,
- perlu memory estimation,
- perlu weighted path algorithm,
- perlu path analytics berulang,
- perlu precompute result.

Contoh:

```text
- shortest route analytics,
- supply-chain impact,
- fraud network distance,
- dependency blast radius,
- alternative route planning,
- all reachable downstream exposure.
```

### 4.4 Rule of thumb

Gunakan rule sederhana ini:

```text
Cypher = query graph operasional yang bounded.
GDS = algorithmic graph computation yang eksplisit dan biasanya lebih berat.
```

Atau:

```text
Jika Anda mencari pattern, pakai Cypher.
Jika Anda menghitung property global/algorithmic dari graph, pakai GDS.
```

---

## 5. Directionality: Sumber Banyak Kesalahan

Graph relationship punya arah.

Namun pertanyaan bisnis sering punya arah berbeda dari arah relationship.

### 5.1 Dependency graph

Model:

```text
(:Service {name:'Checkout'})-[:DEPENDS_ON]->(:Service {name:'Payment'})
(:Service {name:'Payment'})-[:DEPENDS_ON]->(:Service {name:'FraudCheck'})
```

Pertanyaan 1:

```text
Checkout bergantung pada apa?
```

Traversal:

```cypher
MATCH path = (:Service {name:'Checkout'})-[:DEPENDS_ON*1..5]->(dependency)
RETURN path;
```

Pertanyaan 2:

```text
Jika FraudCheck gagal, siapa terdampak?
```

Traversal:

```cypher
MATCH path = (impacted)-[:DEPENDS_ON*1..5]->(:Service {name:'FraudCheck'})
RETURN path;
```

Arah traversal berbalik.

### 5.2 Ownership graph

Model:

```text
(:Person)-[:OWNS]->(:Company)
(:Company)-[:OWNS]->(:Company)
```

Pertanyaan:

```text
Apa yang dikontrol Person A?
```

Traversal keluar.

```cypher
MATCH path = (:Person {id:$personId})-[:OWNS|CONTROLS*1..5]->(asset)
RETURN path;
```

Pertanyaan:

```text
Siapa ultimate beneficial owner dari Company X?
```

Traversal masuk.

```cypher
MATCH path = (owner)-[:OWNS|CONTROLS*1..5]->(:Company {id:$companyId})
RETURN path;
```

### 5.3 IAM graph

Model:

```text
(:User)-[:MEMBER_OF]->(:Group)
(:Group)-[:HAS_ROLE]->(:Role)
(:Role)-[:GRANTS]->(:Permission)
(:Permission)-[:APPLIES_TO]->(:Resource)
```

Pertanyaan:

```text
Resource apa yang bisa diakses user?
```

Traversal mengikuti arah.

Pertanyaan:

```text
Siapa saja yang bisa mengakses resource ini?
```

Traversal berlawanan.

Kesalahan arah di IAM bisa menjadi security incident.

---

## 6. Unweighted Shortest Path

Unweighted shortest path mencari path dengan jumlah hop paling kecil.

Contoh:

```text
A -> B -> C
A -> D -> E -> C
```

Path pertama lebih pendek karena 2 hop, bukan karena “lebih benar”.

### 6.1 Kapan hop count meaningful?

Hop count meaningful ketika setiap relationship dianggap memiliki biaya setara.

Contoh cukup cocok:

- social distance,
- case relation distance,
- graph exploration radius,
- nearest known fraud ring,
- dependency depth.

Namun hop count buruk jika relationship punya bobot nyata.

Contoh buruk:

```text
Route A-B-C punya 2 hop tapi jarak 1000 km.
Route A-D-E-F-C punya 4 hop tapi jarak 50 km.
```

Jika memakai hop count, hasilnya salah untuk route planning.

### 6.2 Cypher example: bounded shortest connection

```cypher
MATCH (a:Account {accountId: $from}), (b:Account {accountId: $to})
MATCH path = shortestPath((a)-[:TRANSFERRED_TO|ASSOCIATED_WITH*1..6]-(b))
RETURN path;
```

Catatan:

- relationship dibuat undirected dengan `-[]-`,
- depth dibatasi `1..6`,
- cocok untuk exploration terbatas,
- tidak cocok untuk graph besar yang sangat padat.

### 6.3 Defensible use

Dalam investigasi:

```text
A terhubung ke B dalam 3 hop melalui:
A --owns--> Company X --shares_address_with--> Company Y --controlled_by--> B
```

Yang defensible bukan hanya “3 hop”.

Yang penting:

- relationship type apa,
- source/evidence apa,
- valid dari kapan sampai kapan,
- confidence berapa,
- apakah path melewati relationship lemah,
- apakah ada policy yang mengizinkan relationship tersebut dipakai dalam kesimpulan.

---

## 7. Weighted Shortest Path

Weighted shortest path memakai cost.

Contoh:

```text
A -[:ROUTE {cost: 10}]-> B
B -[:ROUTE {cost: 20}]-> C
A -[:ROUTE {cost: 100}]-> C
```

Shortest by hop:

```text
A -> C = 1 hop
```

Shortest by cost:

```text
A -> B -> C = cost 30
```

### 7.1 Weight harus punya arti domain

Jangan asal membuat weight.

Contoh weight valid:

```text
travelTimeMinutes
latencyMs
riskScore
transactionAmount
ownershipPercentageInverse
confidencePenalty
manualReviewCost
```

Namun weight campuran harus hati-hati.

Buruk:

```text
score = distance + risk + popularity + severity
```

Masalah:

- skala beda,
- satuan beda,
- sulit dijelaskan,
- rawan bias,
- sulit diaudit.

Lebih baik:

```text
cost =
  0.50 * normalizedTravelTime
+ 0.30 * normalizedDisruptionRisk
+ 0.20 * normalizedOperationalCost
```

Dengan dokumentasi:

- definisi normalisasi,
- alasan weight coefficient,
- versi formula,
- tanggal berlaku,
- owner policy,
- evaluasi historis.

### 7.2 Positive weight requirement

Banyak shortest path algorithm seperti Dijkstra dan A* mengasumsikan non-negative/positive weight.

Jika Anda punya negative cost, pertanyaannya harus dikaji ulang.

Negative weight sering berarti model belum tepat.

Contoh:

```text
bonus = -10
```

Daripada memasukkan negative edge, mungkin lebih aman:

```text
adjustedCost = baseCost - bonus, lalu clamp minimum 0
```

Atau jadikan multi-objective ranking terpisah.

### 7.3 Dijkstra mental model

Dijkstra mencari path termurah dari source ke target atau source ke semua reachable node dengan asumsi weight positif.

Cocok untuk:

- route planning,
- least-cost path,
- latency path,
- dependency cost,
- supply chain alternative.

Contoh GDS shape konseptual:

```cypher
MATCH (source:Location {id: $sourceId}), (target:Location {id: $targetId})
CALL gds.shortestPath.dijkstra.stream('routeGraph', {
  sourceNode: source,
  targetNode: target,
  relationshipWeightProperty: 'travelTimeMinutes'
})
YIELD index, sourceNode, targetNode, totalCost, nodeIds, costs, path
RETURN
  totalCost,
  [nodeId IN nodeIds | gds.util.asNode(nodeId).name] AS route,
  costs,
  path;
```

Catatan:

- `routeGraph` adalah named graph projection,
- weight berasal dari relationship property,
- hasil bisa berupa total cost, node ids, cost sequence, path.

### 7.4 A* mental model

A* memakai heuristic untuk mengarahkan pencarian.

Cocok ketika:

- graph punya informasi spatial/geographic,
- Anda punya koordinat,
- heuristic membantu mempercepat pencarian,
- cost kira-kira berkorelasi dengan jarak fisik.

Contoh domain:

- maps,
- logistics,
- transport routing,
- network route dengan geographic hints.

A* buruk ketika heuristic tidak valid atau misleading.

Jika heuristic terlalu optimistis/pesimistis secara salah, hasil/performa bisa bermasalah.

### 7.5 Yen’s k-shortest paths

Yen mencari beberapa path terbaik.

Cocok ketika:

- butuh alternatif,
- single path tidak cukup,
- ingin fallback route,
- ingin investigasi beberapa possible connection,
- ingin compare route cost.

Contoh:

```text
Top 5 route termurah dari Warehouse A ke Store B.
Top 3 explanation path antara suspect dan organization.
Top 10 dependency paths dari API ke database.
```

Peringatan:

- k terlalu besar bisa mahal,
- graph padat menghasilkan banyak path mirip,
- perlu dedup/penjelasan,
- perlu constraint forbidden nodes/edges untuk skenario failure.

---

## 8. BFS and DFS Mental Model

### 8.1 BFS

Breadth-first search menjelajah per level jarak.

```text
Depth 0: A
Depth 1: neighbor A
Depth 2: neighbor dari neighbor
Depth 3: ...
```

Cocok untuk:

- nearest match,
- reachable within N hops,
- shortest by hop,
- neighborhood expansion.

Contoh:

```text
Cari entity terdekat yang sudah flagged high risk.
```

### 8.2 DFS

Depth-first search menjelajah sedalam mungkin sebelum backtrack.

Cocok untuk:

- path existence,
- hierarchical traversal,
- graph exploration tertentu,
- cycle detection style reasoning.

Namun di production graph query, DFS tanpa boundary bisa berbahaya.

### 8.3 BFS vs Cypher variable-length traversal

Cypher variable-length traversal bukan berarti Anda bebas menganggapnya sebagai BFS yang aman.

Query seperti:

```cypher
MATCH path = (a)-[:REL*1..10]->(b)
RETURN path;
```

bisa menghasilkan semua path dalam rentang tersebut.

Yang mahal bukan hanya menemukan node reachable, tetapi mengembalikan kombinasi path.

Sering kali Anda tidak butuh semua path.

Anda butuh:

```text
- node reachable unik,
- path pertama,
- shortest path,
- aggregated count,
- existence boolean,
- top-k ranked path.
```

Jangan return semua path jika business question tidak membutuhkan semua path.

---

## 9. Impact Analysis: Dari Path Finding ke Keputusan Engineering

Impact analysis adalah salah satu penggunaan paling kuat dari graph.

Pertanyaan dasarnya:

```text
Jika X berubah/gagal/diblokir/dihapus/dinyatakan berisiko, apa yang terdampak?
```

### 9.1 Dependency impact

Model:

```cypher
(:Service)-[:DEPENDS_ON]->(:Service)
(:Service)-[:USES]->(:Database)
(:Service)-[:PUBLISHES_TO]->(:Topic)
(:Service)-[:CONSUMES_FROM]->(:Topic)
```

Pertanyaan:

```text
Jika database D maintenance, service apa saja terdampak?
```

Query:

```cypher
MATCH path = (impacted)-[:DEPENDS_ON|USES|CONSUMES_FROM|PUBLISHES_TO*1..5]->(:Database {name:$db})
RETURN impacted, path
LIMIT 500;
```

Namun query ini harus dimodelkan hati-hati.

Apakah `PUBLISHES_TO` harus dianggap impact upstream/downstream?

Jika service A publishes to topic T dan service B consumes from T:

```text
A -> T -> B
```

Apakah A failure berdampak ke B?

Kemungkinan ya, tetapi tergantung semantic:

- Jika event wajib, ya.
- Jika optional analytics event, mungkin tidak.
- Jika retained/replayable, dampaknya delayed.

Maka relationship perlu property:

```text
criticality: REQUIRED | OPTIONAL | DEGRADED
syncMode: SYNC | ASYNC
replayable: true/false
```

### 9.2 Regulatory/case impact

Pertanyaan:

```text
Jika sebuah evidence dibatalkan, case decision apa saja terdampak?
```

Graph:

```text
Evidence -> supports -> Finding -> justifies -> Decision -> triggers -> EnforcementAction
```

Query:

```cypher
MATCH path = (:Evidence {id:$evidenceId})-[:SUPPORTS|JUSTIFIES|TRIGGERS*1..5]->(x)
WHERE x:Decision OR x:EnforcementAction OR x:Case
RETURN path;
```

Domain impact lebih dari path.

Anda perlu menentukan:

- apakah evidence critical atau supplementary,
- apakah finding punya evidence lain,
- apakah decision bisa tetap valid tanpa evidence tersebut,
- apakah action sudah executed,
- apakah ada legal hold,
- apakah audit trail harus mencatat recalculation.

Graph memberi candidate impact. Domain service menentukan consequence.

### 9.3 Supply chain impact

Graph:

```text
Supplier -> supplies -> Component -> used_in -> Product -> sold_in -> Market
```

Pertanyaan:

```text
Jika Supplier S terkena embargo, produk dan market apa saja terdampak?
```

Path query menemukan exposure.

Namun decision butuh:

- volume,
- substitutability,
- inventory buffer,
- contract validity,
- regional regulation,
- time-to-impact.

Graph path adalah skeleton. Domain attributes memberi decision context.

---

## 10. Blast Radius Analysis

Blast radius adalah bentuk khusus impact analysis.

Pertanyaan:

```text
Seberapa luas dampak jika node/edge tertentu bermasalah?
```

### 10.1 Output blast radius yang baik

Jangan hanya mengembalikan daftar node.

Output yang berguna:

```text
- impacted node count by type,
- impacted critical nodes,
- max depth reached,
- representative paths,
- shortest path per impacted node,
- total exposure/cost,
- confidence/severity,
- top impact clusters,
- recommended containment actions.
```

### 10.2 Example: service failure blast radius

```cypher
MATCH path = (impacted:Service)-[:DEPENDS_ON*1..4]->(:Service {name:$failedService})
WITH impacted, min(length(path)) AS minDepth, collect(path)[0..3] AS samplePaths
RETURN
  impacted.name AS service,
  impacted.tier AS tier,
  impacted.owner AS owner,
  minDepth,
  samplePaths
ORDER BY minDepth ASC, impacted.tier ASC;
```

Kelemahan:

- `collect(path)` bisa mahal,
- path count bisa besar,
- sorting bisa mahal,
- perlu batas depth dan result.

Alternatif production:

```text
1. compute impacted nodes only,
2. select critical impacted nodes,
3. compute shortest explanation path per selected node,
4. return compact result.
```

### 10.3 Graph boundary for blast radius

Boundary yang harus ditentukan:

```text
maxDepth
allowedRelationshipTypes
allowedNodeLabels
excludedNodeLabels
excludedRelationshipTypes
criticalityFilter
timeValidityFilter
tenantFilter
confidenceThreshold
resultLimit
```

Tanpa boundary, blast radius berubah menjadi graph dump.

---

## 11. Path Explanation: Hasil yang Bisa Dipahami Manusia

Path finding untuk manusia bukan hanya computational output.

Dalam domain audit/compliance/investigation, path harus bisa dijelaskan.

Buruk:

```json
{
  "nodeIds": [1, 912, 44, 8123],
  "totalCost": 2.81
}
```

Lebih baik:

```text
Account A is connected to Organization Z through 3 relationships:
1. Account A transferred IDR 50M to Account B on 2026-01-10.
2. Account B is controlled by Person C based on KYC record source X.
3. Person C is director of Organization Z since 2024-08-01.
```

### 11.1 Explanation path fields

Untuk path explanation, setiap relationship sebaiknya punya:

```text
type
sourceNode
targetNode
businessMeaning
validFrom
validTo
sourceSystem
evidenceId
confidence
strength
createdAt
lastVerifiedAt
```

Tidak semua field harus ada di relationship langsung. Bisa lewat evidence node.

Namun explanation layer harus bisa mengambilnya.

### 11.2 Path scoring vs path explanation

Path terbaik secara score belum tentu path terbaik untuk explanation.

Contoh:

```text
Path 1: cost 0.21 tapi melewati inferred weak relationship.
Path 2: cost 0.34 tapi semua relationship punya primary evidence.
```

Untuk regulatory decision, Path 2 mungkin lebih defensible.

Maka ranking perlu mempertimbangkan:

- cost,
- evidence quality,
- relationship strength,
- recency,
- legal admissibility,
- semantic relevance.

### 11.3 Avoid misleading path explanations

Bahaya path explanation:

```text
A connected to B
```

Manusia bisa menafsirkan sebagai causality atau guilt by association.

Lebih aman:

```text
A has an observed graph connection to B through ownership/address/transaction relationships. This indicates association evidence, not proof of wrongdoing.
```

Path menunjukkan koneksi, bukan otomatis sebab-akibat.

---

## 12. Modelling Relationship Weight

Path finding bagus hanya jika weight-nya bagus.

### 12.1 Edge-level cost

Contoh route:

```cypher
(:Location)-[:ROAD {distanceKm: 12.4, travelTimeMinutes: 18, tollCost: 2.5}]->(:Location)
```

Cost bisa:

```text
distanceKm
travelTimeMinutes
tollCost
```

Tergantung use case.

### 12.2 Risk path cost

Contoh investigation graph:

```cypher
(:Person)-[:ASSOCIATED_WITH {strength: 0.7, confidence: 0.8}]->(:Person)
```

Jika mencari path “strongest association”, shortest path tidak langsung cocok.

Karena shortest path meminimalkan cost, sedangkan strength ingin dimaksimalkan.

Transformasi umum:

```text
cost = 1.0 / strength
```

atau:

```text
cost = -log(probability)
```

Namun transformasi harus dipahami.

Jika probability dikalikan sepanjang path:

```text
P(path) = P(edge1) * P(edge2) * P(edge3)
```

Maka:

```text
-log(P(path)) = -log(P(edge1)) + -log(P(edge2)) + -log(P(edge3))
```

Ini membuat path probability bisa dihitung sebagai additive cost.

### 12.3 Time decay

Relationship lama mungkin kurang relevan.

```text
effectiveWeight = baseWeight * decay(age)
```

Contoh:

```text
decay = exp(-lambda * ageInDays)
```

Namun untuk audit, jangan sembunyikan terlalu banyak logika di formula.

Simpan:

```text
baseWeight
computedWeight
weightVersion
computedAt
```

### 12.4 Node cost vs edge cost

Beberapa domain punya cost pada node.

Contoh:

```text
Transit through Country X has regulatory risk.
Using Supplier Y has compliance risk.
Passing through Service Z has latency penalty.
```

GDS shortest path umumnya memakai relationship weight. Node cost bisa dimodelkan dengan:

1. Memindahkan node cost ke outgoing relationship.
2. Split node menjadi entry/exit node.
3. Post-process path score.
4. Membuat derived edge cost.

Contoh split node:

```text
CountryX_IN -[:ENTER {cost: nodeRisk}]-> CountryX_OUT
```

Ini lebih advanced dan harus justified.

---

## 13. Temporal Path Finding

Banyak path hanya valid pada waktu tertentu.

Contoh:

```text
Person A owned Company X from 2020 to 2022.
Company X transferred funds to Company Y in 2024.
```

Jika query tidak memperhatikan waktu, path bisa misleading.

### 13.1 Valid-at query

Relationship:

```cypher
(:Person)-[:OWNS {validFrom: date('2020-01-01'), validTo: date('2022-12-31')}]->(:Company)
```

Query:

```cypher
MATCH path = (:Person {id:$personId})-[rels:OWNS|CONTROLS*1..5]->(x)
WHERE all(r IN relationships(path)
  WHERE r.validFrom <= date($asOf)
    AND (r.validTo IS NULL OR r.validTo >= date($asOf))
)
RETURN path;
```

### 13.2 Event-time path

Untuk transaction graph, urutan waktu mungkin penting.

Buruk:

```text
A transferred to B after B transferred to C, tapi path dibaca sebagai A -> B -> C flow.
```

Query perlu memastikan monotonic time:

```cypher
MATCH path = (:Account {id:$source})-[:TRANSFERRED_TO*1..5]->(:Account {id:$target})
WHERE all(i IN range(0, size(relationships(path))-2)
  WHERE relationships(path)[i].timestamp <= relationships(path)[i+1].timestamp
)
RETURN path;
```

Peringatan:

- path expansion terjadi sebelum filter temporal penuh,
- bisa mahal,
- lebih baik batasi depth/time window/amount threshold sejak awal bila bisa.

### 13.3 Time-respecting paths

Dalam temporal network, path valid bukan hanya connected, tapi time-respecting.

Contoh:

```text
A contacts B at t1
B contacts C at t2
Path A -> B -> C valid jika t1 <= t2
```

Ini penting untuk:

- money flow,
- infection/contact tracing,
- escalation chain,
- evidence chronology,
- incident propagation.

---

## 14. Multi-Criteria Path Finding

Real-world path rarely has one cost.

Contoh route:

```text
minimize travel time
minimize toll cost
minimize risk
avoid restricted countries
prefer trusted vendors
```

Ini bukan single shortest path sederhana.

### 14.1 Weighted sum approach

```text
totalCost =
  w1 * normalizedTime
+ w2 * normalizedMoney
+ w3 * normalizedRisk
```

Kelebihan:

- mudah dijalankan,
- cocok untuk Dijkstra jika cost positive,
- mudah ranking.

Kekurangan:

- coefficient subjektif,
- trade-off tersembunyi,
- sulit audit jika tidak didokumentasikan.

### 14.2 Constraint-first approach

Daripada mencampur semua ke cost, pisahkan:

```text
Hard constraints:
- avoid sanctioned entities
- only active relationships
- max risk <= threshold
- tenant = current tenant

Optimization:
- minimize travel time
```

Ini biasanya lebih defensible.

### 14.3 Pareto frontier

Kadang tidak ada satu “best path”.

Path A:

```text
fast but expensive
```

Path B:

```text
slow but cheap
```

Path C:

```text
medium but safer
```

Untuk decision support, tampilkan alternatif dengan trade-off, bukan satu angka final.

---

## 15. Path Finding untuk Dependency Graph

Dependency graph adalah use case teknis yang sangat relevan untuk Java engineer.

### 15.1 Model dasar

```cypher
(:Service {name:'checkout-api'})-[:DEPENDS_ON {criticality:'REQUIRED'}]->(:Service {name:'payment-api'})
(:Service {name:'payment-api'})-[:USES {criticality:'REQUIRED'}]->(:Database {name:'payment-db'})
(:Service {name:'checkout-api'})-[:PUBLISHES_TO {criticality:'OPTIONAL'}]->(:Topic {name:'checkout-events'})
(:Service {name:'analytics-worker'})-[:CONSUMES_FROM {criticality:'OPTIONAL'}]->(:Topic {name:'checkout-events'})
```

### 15.2 Downstream dependencies

```cypher
MATCH path = (:Service {name:$service})-[:DEPENDS_ON|USES|PUBLISHES_TO|CONSUMES_FROM*1..4]->(x)
RETURN path;
```

Pertanyaan:

```text
Apa yang dibutuhkan service ini?
```

### 15.3 Upstream impact

```cypher
MATCH path = (x)-[:DEPENDS_ON|USES|PUBLISHES_TO|CONSUMES_FROM*1..4]->(:Database {name:$database})
RETURN path;
```

Pertanyaan:

```text
Siapa terdampak jika database ini gagal?
```

### 15.4 Criticality-aware impact

```cypher
MATCH path = (x)-[:DEPENDS_ON|USES*1..4]->(:Database {name:$database})
WHERE all(r IN relationships(path) WHERE r.criticality = 'REQUIRED')
RETURN path;
```

Ini lebih akurat untuk severe impact.

### 15.5 Avoid false impact

Jika semua relationship dianggap sama, hasil blast radius terlalu luas.

Bedakan:

```text
REQUIRED
OPTIONAL
DEGRADED
OBSERVABILITY_ONLY
BATCH_ONLY
ASYNC_REPLAYABLE
```

Dengan begitu impact analysis bisa menjawab:

```text
- outage impact,
- degraded impact,
- reporting-only impact,
- delayed batch impact.
```

---

## 16. Path Finding untuk Enforcement / Investigation Graph

### 16.1 Model contoh

```text
(:Person)-[:OWNS]->(:Organization)
(:Person)-[:DIRECTOR_OF]->(:Organization)
(:Organization)-[:SHARES_ADDRESS_WITH]->(:Organization)
(:Account)-[:HELD_BY]->(:Person)
(:Account)-[:TRANSFERRED_TO]->(:Account)
(:Case)-[:INVOLVES]->(:Person)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Evidence)-[:INDICATES]->(:RelationshipFact)
```

### 16.2 Related-party discovery

```cypher
MATCH path = (:Person {id:$personId})-[:OWNS|DIRECTOR_OF|ASSOCIATED_WITH|SHARES_ADDRESS_WITH*1..4]-(x)
WHERE x:Person OR x:Organization
RETURN path
LIMIT 200;
```

Peringatan:

- relationship type harus dipilih hati-hati,
- alamat bersama bisa noisy,
- association bukan guilt,
- perlu confidence/evidence filter.

### 16.3 Evidence-constrained path

```cypher
MATCH path = (:Person {id:$a})-[:ASSOCIATED_WITH|OWNS|DIRECTOR_OF*1..4]-(:Person {id:$b})
WHERE all(r IN relationships(path)
  WHERE r.confidence >= 0.75
    AND r.sourceSystem IN ['KYC', 'REGISTRY', 'COURT_RECORD']
)
RETURN path
ORDER BY length(path) ASC
LIMIT 10;
```

### 16.4 Defensible path output

Untuk investigator, jangan hanya return graph visual.

Return:

```text
- summary,
- path length,
- relationship sequence,
- evidence source per edge,
- confidence per edge,
- valid time range,
- excluded weak links,
- caveats,
- alternative paths.
```

### 16.5 Case impact of invalidated evidence

```cypher
MATCH path = (:Evidence {id:$evidenceId})-[:SUPPORTS|JUSTIFIES|TRIGGERS*1..5]->(x)
WHERE x:Finding OR x:Decision OR x:EnforcementAction
RETURN path;
```

Then domain service must evaluate:

```text
Is this evidence necessary or supplementary?
Does the finding have independent evidence?
Is the decision already final?
Is there legal hold?
Should case be reopened?
```

Graph finds candidates. Governance decides action.

---

## 17. Path Finding untuk IAM / Entitlement

IAM graph path finding is high-stakes.

### 17.1 Model

```text
User -> MEMBER_OF -> Group
Group -> MEMBER_OF -> Group
Group -> HAS_ROLE -> Role
Role -> GRANTS -> Permission
Permission -> APPLIES_TO -> Resource
```

### 17.2 User effective access

```cypher
MATCH path = (:User {id:$userId})-[:MEMBER_OF*0..5]->(:Group)-[:HAS_ROLE]->(:Role)-[:GRANTS]->(:Permission)-[:APPLIES_TO]->(r:Resource)
RETURN r, path;
```

### 17.3 Who can access resource?

```cypher
MATCH path = (u:User)-[:MEMBER_OF*0..5]->(:Group)-[:HAS_ROLE]->(:Role)-[:GRANTS]->(:Permission)-[:APPLIES_TO]->(:Resource {id:$resourceId})
RETURN u, path;
```

### 17.4 Toxic combination detection

```text
User has Permission A and Permission B where A+B violates segregation of duties.
```

Graph query can find candidate toxic combinations.

But production enforcement needs:

- policy version,
- exception approval,
- temporary grant expiry,
- emergency access mode,
- audit trail,
- denial explanation.

### 17.5 Path explanation for access

A good entitlement explanation:

```text
User U can access Resource R because:
U is member of Group G1,
G1 inherits Group G2,
G2 has Role Approver,
Role Approver grants Permission approve_case,
Permission approve_case applies to Resource R.
```

This is exactly where graph shines.

---

## 18. Path Finding untuk Supply Chain and Routing

### 18.1 Model

```text
Supplier -> supplies -> Component
Component -> used_in -> Product
Product -> distributed_to -> Region
Location -> route_to -> Location
```

### 18.2 Impact query

```cypher
MATCH path = (:Supplier {id:$supplier})-[:SUPPLIES|USED_IN|DISTRIBUTED_TO*1..5]->(x)
RETURN path;
```

### 18.3 Weighted route

```text
Location -[:ROUTE {distanceKm, timeMinutes, cost, risk}]-> Location
```

GDS Dijkstra could optimize one weight.

But route decision may need constraints:

```text
avoid sanctioned region
avoid route with risk > threshold
only active route
only route valid for cargo type
```

### 18.4 Alternative routes

Use k-shortest paths to propose alternatives.

Then post-process:

```text
- remove paths containing blocked nodes,
- rank by cost/time/risk,
- show why each path is acceptable,
- include operational constraints.
```

---

## 19. Algorithm Selection Guide

| Problem | Recommended approach | Notes |
|---|---|---|
| Bounded neighborhood exploration | Cypher variable-length | Keep depth/type/filter tight |
| Is A connected to B? | Cypher or BFS | Depends on graph size and recurrence |
| Shortest by hop | Cypher shortest path or BFS | Good if unweighted |
| Shortest by positive cost | Dijkstra | Weight must be positive |
| Shortest with geographic heuristic | A* | Requires meaningful heuristic |
| Top-k alternative paths | Yen’s k-shortest | Keep k small and constraints clear |
| Source to all reachable weighted shortest paths | Dijkstra single-source / Delta-Stepping | Useful for impact/cost map |
| All pairs shortest paths | APSP | Expensive; analytical/offline only |
| Negative weights | Bellman-Ford style | Use only if domain truly needs it |
| Impact count by component | Connected components | Precompute where possible |
| Massive repeated path analytics | GDS projection + batch workflow | Avoid per-request heavy compute |

---

## 20. Production Pattern: Two-Stage Path Query

A common mistake is trying to answer everything in one giant path query.

Better pattern:

```text
Stage 1: find candidate impacted/reachable nodes cheaply.
Stage 2: compute explanation path only for selected candidates.
```

### 20.1 Example

Stage 1:

```cypher
MATCH (target:Database {name:$db})
MATCH (s:Service)-[:DEPENDS_ON|USES*1..4]->(target)
RETURN DISTINCT s
LIMIT 500;
```

Stage 2:

```cypher
MATCH (s:Service {name:$service}), (target:Database {name:$db})
MATCH path = shortestPath((s)-[:DEPENDS_ON|USES*1..4]->(target))
RETURN path;
```

Why better?

- avoids collecting all paths,
- returns distinct impacted nodes,
- explanation computed only where needed,
- easier to paginate/rank,
- easier to cache.

---

## 21. Production Pattern: Precomputed Impact Edges

If impact query is frequent and graph changes less frequently, precompute derived relationships.

Example:

```text
(:Service)-[:CAN_BE_IMPACTED_BY {minDepth, computedAt, graphVersion}]->(:Service)
```

### 21.1 Benefits

- fast operational query,
- stable response time,
- easier dashboard,
- cheaper repeated access.

### 21.2 Costs

- derived data maintenance,
- stale results risk,
- recomputation complexity,
- versioning needed,
- explanation path still may be needed separately.

### 21.3 Safe use

Use derived edge for:

```text
candidate lookup
summary dashboard
fast filtering
```

But keep original path explanation available.

---

## 22. Production Pattern: Path Query Budget

Every production path API should have a budget.

Example config:

```yaml
pathQueryBudget:
  maxDepth: 5
  maxReturnedPaths: 100
  maxReturnedNodes: 500
  maxExecutionMillis: 2000
  allowedRelationshipTypes:
    - DEPENDS_ON
    - USES
  disallowedLabels:
    - DebugEvent
    - RawLog
  requireTenantFilter: true
```

### 22.1 Why budget matters

Path queries are easy to abuse accidentally.

Without budget:

- UI can freeze,
- database can consume too much CPU,
- page cache churns,
- query memory spikes,
- result serialization explodes,
- user receives unusable graph hairball.

### 22.2 API-level guardrails

For Java service:

```text
- validate maxDepth,
- whitelist relationship types,
- enforce tenantId,
- require start node type,
- cap limits,
- reject unbounded queries,
- classify query complexity,
- apply timeout,
- record metrics.
```

---

## 23. Java Service Design for Path Finding

### 23.1 Avoid exposing raw Cypher builder to clients

Bad:

```text
GET /graph/path?cypher=MATCH...
```

This is unsafe.

Better:

```text
POST /impact-analysis
{
  "type": "SERVICE_FAILURE",
  "targetService": "payment-api",
  "maxDepth": 4,
  "includeOptional": false
}
```

Service maps business request to safe query template.

### 23.2 Query object pattern

```java
public record ImpactAnalysisRequest(
    String targetId,
    ImpactSubjectType subjectType,
    int maxDepth,
    boolean includeOptional,
    Set<String> relationshipTypes
) {}
```

Validate:

```java
if (request.maxDepth() < 1 || request.maxDepth() > 5) {
    throw new IllegalArgumentException("maxDepth must be between 1 and 5");
}
```

### 23.3 Repository boundary

```java
public interface GraphImpactRepository {
    List<ImpactedNode> findImpactedNodes(ImpactAnalysisRequest request);
    Optional<PathExplanation> findShortestExplanationPath(String sourceId, String targetId, PathPolicy policy);
}
```

### 23.4 Separate query result from API response

Internal graph result:

```text
node ids
relationship ids
labels
types
properties
```

API response:

```text
business id
name/type
impact category
reason summary
path explanation
severity
confidence
```

Do not leak Neo4j internal IDs into API contracts.

### 23.5 Use transaction semantics deliberately

For pure path reads:

```java
session.executeRead(tx -> ...)
```

For GDS write/mutate operations:

- separate job boundary,
- permission guard,
- idempotency key,
- async orchestration if long-running,
- operational observability.

Do not run heavy GDS algorithm inside latency-sensitive HTTP request unless you have proven budget.

---

## 24. Observability for Path Queries

Track path query metrics separately.

### 24.1 Useful metrics

```text
path.query.count
path.query.duration
path.query.timeout.count
path.query.maxDepth
path.query.returnedPaths
path.query.returnedNodes
path.query.relationshipTypes
path.query.dbHits
path.query.memoryEstimate
path.query.resultBytes
path.query.rejectedByBudget.count
```

### 24.2 Log query shape, not sensitive data

Log:

```text
queryTemplate=SERVICE_IMPACT_V2
maxDepth=4
relationshipTypes=DEPENDS_ON,USES
includeOptional=false
resultCount=87
durationMs=123
```

Avoid logging:

```text
full sensitive node properties
PII
raw evidence details
access tokens
```

### 24.3 Explain/profile in staging

For new path query:

- test with small graph,
- test with worst-case graph,
- test with supernode,
- test with no result,
- test with very broad result,
- inspect `PROFILE`,
- confirm no accidental cartesian product,
- confirm start node uses index,
- confirm expansion is bounded.

---

## 25. Failure Modes

### 25.1 Unbounded traversal

Bad:

```cypher
MATCH path = (a)-[:REL*]->(b)
RETURN path;
```

Failure:

- infinite-like exploration in cyclic graph,
- memory pressure,
- timeout,
- unusable result.

Fix:

```cypher
MATCH path = (a)-[:REL*1..5]->(b)
RETURN path
LIMIT 50;
```

But limit alone is not enough. Bound expansion too.

### 25.2 Path explosion

Even with depth bound, path count can explode.

If average branching factor is 20 and depth 4:

```text
20^4 = 160,000 possible branches
```

If cycles and alternate paths exist, result can be worse.

Fix:

- reduce relationship types,
- filter nodes early,
- reduce depth,
- use shortest path,
- return distinct nodes not all paths,
- precompute,
- use GDS algorithms.

### 25.3 Weak semantic edges pollute result

If `RELATED_TO` means everything, path results become meaningless.

Fix:

- specific relationship types,
- confidence threshold,
- evidence source filter,
- relationship strength,
- exclude weak edge types by default.

### 25.4 Direction bug

Query returns dependencies instead of dependents.

Fix:

- document relationship semantics,
- unit test direction,
- name query by business question,
- include sample graph tests.

### 25.5 Weight misuse

Shortest path returns strange result because weight does not mean cost.

Fix:

- define weight contract,
- normalize units,
- validate examples,
- expose explanation,
- version formula.

### 25.6 Stale projection

GDS named graph projection is stale relative to operational database.

Fix:

- document projection freshness,
- rebuild schedule,
- graph version,
- computedAt,
- prevent stale result for critical decisions.

### 25.7 All-pairs algorithm in request path

Running expensive global algorithm inside API request.

Fix:

- batch/offline job,
- precompute,
- cache result,
- async workflow.

---

## 26. Testing Path Finding

### 26.1 Golden graph dataset

Create small graph with known paths.

Example:

```text
A -> B -> C
A -> D -> C
A -> E -> F -> C
```

Test:

```text
shortest path A-C length = 2
k=2 paths include A-B-C and A-D-C
excluding D removes A-D-C
weighted path chooses expected route
```

### 26.2 Direction tests

For dependency graph:

```text
A DEPENDS_ON B
B DEPENDS_ON C
```

Test:

```text
Dependencies of A = B,C
Impacted by C = A,B
Impacted by A = none or upstream only depending semantic
```

### 26.3 Cycle tests

```text
A -> B -> C -> A
```

Ensure query:

- terminates,
- respects depth,
- does not return infinite repeated paths,
- handles duplicate nodes appropriately.

### 26.4 Supernode tests

Create node with thousands of edges.

Test:

- query does not time out,
- budget rejects too broad query,
- filter reduces result,
- API response remains bounded.

### 26.5 Temporal tests

Test `asOf` behavior:

```text
relationship valid 2020-2022
query asOf 2021 returns path
query asOf 2024 excludes path
```

### 26.6 Explanation tests

Expected explanation should be stable enough:

```text
Path contains relationship types in order.
Path includes evidence IDs.
Path includes confidence.
Path caveat appears for weak evidence.
```

---

## 27. Architecture Pattern: Graph Path Service

A clean production architecture:

```text
Client/UI
  -> Graph Path API
      -> Policy Validator
      -> Query Planner / Template Selector
      -> Neo4j Repository
      -> Explanation Builder
      -> Risk/Impact Enricher
      -> Response Formatter
```

### 27.1 Policy Validator

Checks:

```text
tenant access
allowed use case
max depth
allowed relationship types
sensitivity
user permission
```

### 27.2 Template Selector

Maps business use case to safe query.

```text
SERVICE_IMPACT
CASE_EVIDENCE_IMPACT
IAM_EFFECTIVE_ACCESS
RELATED_PARTY_DISCOVERY
SUPPLY_CHAIN_EXPOSURE
```

### 27.3 Explanation Builder

Converts raw path into human-readable explanation.

### 27.4 Risk/Impact Enricher

Adds:

```text
severity
criticality
confidence
business owner
recommended action
```

### 27.5 Response Formatter

Returns compact response, not raw hairball.

---

## 28. Practical Cypher Examples

### 28.1 Find reachable nodes within policy boundary

```cypher
MATCH (start:Case {caseId: $caseId})
MATCH path = (start)-[:INVOLVES|RELATED_TO|SUPPORTED_BY*1..3]->(x)
WHERE all(r IN relationships(path) WHERE coalesce(r.confidence, 1.0) >= $minConfidence)
RETURN DISTINCT x
LIMIT $limit;
```

### 28.2 Find shortest dependency explanation

```cypher
MATCH (source:Service {name:$source}), (target:Service {name:$target})
MATCH path = shortestPath((source)-[:DEPENDS_ON*1..5]->(target))
RETURN path;
```

### 28.3 Find upstream impact

```cypher
MATCH (failed:Service {name:$failed})
MATCH path = (impacted:Service)-[:DEPENDS_ON*1..5]->(failed)
RETURN impacted.name AS impactedService, min(length(path)) AS minDepth
ORDER BY minDepth ASC;
```

### 28.4 Return representative path per impacted service

```cypher
MATCH (failed:Service {name:$failed})
MATCH path = (impacted:Service)-[:DEPENDS_ON*1..5]->(failed)
WITH impacted, path
ORDER BY length(path) ASC
WITH impacted, collect(path)[0] AS shortestExample
RETURN impacted.name AS service, shortestExample;
```

Caution:

- `collect(path)` can be expensive,
- use only with bounded results,
- consider two-stage approach.

### 28.5 Temporal valid path

```cypher
MATCH path = (:Person {id:$personId})-[:OWNS|CONTROLS*1..5]->(asset)
WHERE all(r IN relationships(path)
  WHERE r.validFrom <= date($asOf)
    AND (r.validTo IS NULL OR r.validTo >= date($asOf))
)
RETURN path
LIMIT 100;
```

---

## 29. Practical GDS Workflow for Path Finding

### 29.1 Projection

Conceptual projection:

```cypher
MATCH (source:Location)-[r:ROUTE]->(target:Location)
WHERE r.active = true
RETURN gds.graph.project(
  'activeRouteGraph',
  source,
  target,
  { relationshipProperties: r { .travelTimeMinutes, .riskCost } }
);
```

### 29.2 Dijkstra stream

```cypher
MATCH (source:Location {id:$sourceId}), (target:Location {id:$targetId})
CALL gds.shortestPath.dijkstra.stream('activeRouteGraph', {
  sourceNode: source,
  targetNode: target,
  relationshipWeightProperty: 'travelTimeMinutes'
})
YIELD totalCost, nodeIds, costs, path
RETURN
  totalCost,
  [nodeId IN nodeIds | gds.util.asNode(nodeId).id] AS route,
  costs,
  path;
```

### 29.3 Yen k-shortest

```cypher
MATCH (source:Location {id:$sourceId}), (target:Location {id:$targetId})
CALL gds.shortestPath.yens.stream('activeRouteGraph', {
  sourceNode: source,
  targetNode: target,
  k: 5,
  relationshipWeightProperty: 'travelTimeMinutes'
})
YIELD index, totalCost, nodeIds, costs, path
RETURN
  index,
  totalCost,
  [nodeId IN nodeIds | gds.util.asNode(nodeId).id] AS route,
  costs,
  path
ORDER BY index;
```

### 29.4 Projection lifecycle

Remember:

```text
Operational graph changes do not automatically mean named GDS projection is fresh.
```

For production:

```text
projectionName
projectionVersion
createdAt
sourceDataWatermark
algorithmVersion
weightProperty
filterPolicy
```

---

## 30. Checklist: Designing a Path-Based Feature

Before implementing, answer:

```text
1. What is the exact business question?
2. Is the question reachability, shortest path, weighted path, alternatives, or impact?
3. What node label is the starting point?
4. Is the start node indexed and selective?
5. What relationship types are allowed?
6. What directions are correct?
7. What max depth is safe?
8. Are cycles possible?
9. Do we need all paths or only target nodes?
10. Do we need shortest path or any path?
11. Is hop count meaningful?
12. If weighted, what does weight mean?
13. Are weights positive?
14. Are relationships time-valid?
15. Are tenant/security filters mandatory?
16. What evidence/confidence threshold applies?
17. What is the max result size?
18. What is the expected worst-case graph shape?
19. Is GDS projection needed?
20. How fresh must results be?
21. Does result need explanation?
22. Is this decision-support or automated decision?
23. What caveats must be shown?
24. How will performance be tested?
25. What observability metrics will be recorded?
```

---

## 31. Mini Case Study: Regulatory Evidence Impact

### 31.1 Requirement

```text
When an evidence item is invalidated, show which findings, decisions, enforcement actions, and cases may be impacted.
```

### 31.2 Naive query

```cypher
MATCH path = (:Evidence {id:$id})-[*]->(x)
RETURN path;
```

Bad because:

- unbounded,
- all relationship types,
- no semantic filter,
- no result classification,
- no criticality distinction.

### 31.3 Better model

Relationship types:

```text
SUPPORTS
CONTRADICTS
JUSTIFIES
TRIGGERS
BELONGS_TO
```

Relationship properties:

```text
criticality: PRIMARY | SUPPORTING | CONTEXTUAL
validFrom
validTo
confidence
evidenceUsePolicy
```

### 31.4 Better query

```cypher
MATCH (e:Evidence {id:$evidenceId})
MATCH path = (e)-[:SUPPORTS|JUSTIFIES|TRIGGERS*1..4]->(x)
WHERE x:Finding OR x:Decision OR x:EnforcementAction OR x:Case
RETURN
  labels(x) AS impactedType,
  x.id AS impactedId,
  min(length(path)) AS minDepth,
  collect(path)[0..3] AS samplePaths
LIMIT 200;
```

### 31.5 Better response

```json
{
  "evidenceId": "E-123",
  "impactSummary": {
    "findings": 3,
    "decisions": 1,
    "actions": 1,
    "cases": 1
  },
  "impacts": [
    {
      "type": "Decision",
      "id": "D-456",
      "severity": "HIGH",
      "reason": "Decision D-456 is justified by Finding F-222, which is primarily supported by Evidence E-123.",
      "recommendedAction": "Legal review required before enforcement action proceeds."
    }
  ],
  "caveat": "Graph impact indicates dependency candidates. Final legal effect must be reviewed according to evidence policy."
}
```

This is production-oriented, not just graph visualization.

---

## 32. Mini Case Study: Microservice Blast Radius

### 32.1 Requirement

```text
Before deploying a breaking change to service X, show upstream services that may be affected.
```

### 32.2 Model

```text
Service -[:DEPENDS_ON {criticality}]-> Service
Service -[:USES {criticality}]-> Database
Service -[:CALLS {criticality, protocol}]-> Endpoint
```

### 32.3 Query

```cypher
MATCH (changed:Service {name:$service})
MATCH path = (upstream:Service)-[:DEPENDS_ON|CALLS*1..4]->(changed)
WHERE all(r IN relationships(path)
  WHERE r.criticality IN $includedCriticalities
)
WITH upstream, min(length(path)) AS minDepth, count(path) AS pathCount
RETURN upstream.name, upstream.owner, upstream.tier, minDepth, pathCount
ORDER BY minDepth ASC, upstream.tier ASC;
```

### 32.4 Output

```text
Payment API change may affect:
- checkout-api, tier 1, depth 1, owner Commerce Platform
- refund-api, tier 1, depth 1, owner Payments
- settlement-worker, tier 2, depth 2, owner Finance Systems
```

### 32.5 Decision integration

If impacted tier 1 service exists:

```text
Require owner approval.
Require staged rollout.
Require rollback plan.
Require synthetic check.
```

Graph result becomes workflow logic.

---

## 33. What Top Engineers Do Differently

A mid-level graph implementation often stops at:

```text
I can find a path.
```

A strong engineer asks:

```text
Is this path semantically valid?
Is this path time-valid?
Is this path explainable?
Is this traversal bounded?
Is this query safe under worst-case fan-out?
Is hop count meaningful?
Is weight defensible?
Is this result fresh?
Is this result authorized?
Is this result actionable?
Is this graph path evidence or decision?
```

A top-level engineer designs:

```text
- bounded query templates,
- graph-specific tests,
- path budgets,
- semantic relationship taxonomy,
- explanation layer,
- precomputed summaries where needed,
- GDS/offline split,
- audit-friendly scoring,
- result caveats,
- operational metrics,
- failure runbooks.
```

---

## 34. Key Takeaways

1. Path finding is not one problem; separate reachability, shortest path, weighted path, alternatives, and impact analysis.
2. Cypher is excellent for bounded operational graph traversal.
3. GDS is better for explicit algorithmic path computation, especially weighted path and repeated analytical workloads.
4. Directionality is a domain decision, not a syntax detail.
5. Hop count is only meaningful when each relationship has equal semantic cost.
6. Weighted path requires clear, positive, auditable cost semantics.
7. Impact analysis should return actionable summaries, not raw graph hairballs.
8. Path explanation is critical for investigation, enforcement, IAM, and regulatory systems.
9. Temporal validity matters; not every path exists at every time.
10. Production path APIs need budgets, guardrails, observability, tests, and failure handling.
11. Graph path is evidence of connection, not automatic causality or guilt.
12. The best architecture often uses two-stage query: candidate discovery, then explanation path.

---

## 35. Latihan

### Latihan 1 — Dependency Direction

Given:

```text
A DEPENDS_ON B
B DEPENDS_ON C
D DEPENDS_ON B
```

Jawab:

1. Dependencies of A?
2. Services impacted if C fails?
3. Services impacted if B fails?
4. Correct Cypher direction for each question?

### Latihan 2 — Path Budget

Design path query budget for:

```text
related-party discovery in investigation graph
```

Tentukan:

- max depth,
- allowed relationship types,
- confidence threshold,
- evidence sources,
- result limit,
- caveats.

### Latihan 3 — Weight Semantics

Anda punya relationship:

```text
(:Account)-[:TRANSFERRED_TO {amount, timestamp, suspiciousScore}]->(:Account)
```

Design cost untuk menemukan suspicious money-flow path.

Pertanyaan:

- Apakah shortest path cocok?
- Apakah suspiciousScore harus diminimalkan atau dimaksimalkan?
- Bagaimana transformasi ke additive cost?
- Bagaimana menjaga explainability?

### Latihan 4 — Evidence Impact

Design query untuk:

```text
Find all decisions that may be impacted if evidence E is invalidated.
```

Tambahkan:

- criticality filter,
- valid time,
- sample explanation path,
- output summary.

### Latihan 5 — GDS vs Cypher

Untuk setiap use case, pilih Cypher atau GDS:

1. Show first 2-hop related cases in UI.
2. Find cheapest route across 1M route edges.
3. Calculate all shortest dependency distances nightly.
4. Explain why user U can access resource R.
5. Find top 5 alternative supply routes.

---

## 36. Penutup

Path finding adalah inti kekuatan graph database, tetapi juga inti banyak kegagalan graph system.

Jika Anda hanya belajar sintaks shortest path, Anda akan bisa membuat demo.

Jika Anda memahami:

- boundary,
- direction,
- weight,
- semantic validity,
- temporal validity,
- explanation,
- operational budget,
- query/GDS trade-off,
- audit consequence,

maka Anda bisa membangun capability graph yang benar-benar layak production.

Di bagian berikutnya, kita akan masuk ke topik yang semakin penting di Neo4j modern:

```text
Graph Embeddings, Vector Indexes, and GenAI/RAG with Neo4j
```

Kita akan membahas bagaimana graph structure dan semantic vector search bisa digabung, kapan GraphRAG masuk akal, kapan hype, dan bagaimana menjaga grounding agar tidak sekadar menjadi retrieval pipeline yang terlihat canggih tapi tidak defensible.

---

## Status Seri

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
Part 022 selesai.
Part 023 selesai.
Part 024 selesai.
Seri belum selesai.
Masih ada Part 025 sampai Part 032.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Community Detection, Clustering, Similarity, and Link Prediction</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-025.md">Part 025 — Graph Embeddings, Vector Indexes, and GenAI/RAG with Neo4j ➡️</a>
</div>
