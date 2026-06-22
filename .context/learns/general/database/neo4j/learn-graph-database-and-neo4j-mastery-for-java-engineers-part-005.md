# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-005.md

# Part 005 — Cypher Path Semantics: Variable-Length Traversal, Shortest Path, and Expansion Control

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami graph database dan Neo4j sampai level desain, implementasi, performa, dan failure modelling.  
> Fokus bagian ini: memahami **path** sebagai konsep inti graph query, memakai Cypher untuk traversal dengan benar, mengendalikan path explosion, dan tahu kapan harus pindah dari Cypher traversal ke Graph Data Science path algorithms.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya, kita sudah membahas:

- apa itu graph thinking,
- property graph model,
- Neo4j runtime mental model,
- dasar Cypher sebagai pattern matching query language.

Part ini masuk ke inti yang lebih tajam: **path semantics**.

Graph database sering dipilih bukan karena ingin menyimpan node. Node bisa disimpan di relational table, document database, atau key-value store. Graph database dipilih karena kita ingin bertanya:

- “Siapa terhubung ke siapa?”
- “Lewat jalur apa entity A bisa mempengaruhi entity B?”
- “Apa rute hubungan terpendek dari X ke Y?”
- “Ada tidak chain ownership dari company A ke beneficial owner B?”
- “Kasus ini berkaitan dengan kasus lain lewat entity apa?”
- “Kalau resource ini berubah, apa dependency downstream yang terdampak?”
- “Apakah actor ini terhubung ke fraud ring melalui maksimal 3 hop?”

Semua pertanyaan tersebut bukan sekadar query terhadap entity. Pertanyaan itu adalah query terhadap **path**.

Cypher memiliki dukungan pattern matching, quantified path patterns, variable-length path, shortest path, dan path expressions. Tetapi kemampuan ini harus dipakai dengan hati-hati. Path query yang terlalu bebas bisa berubah dari elegan menjadi bencana performa.

Tujuan part ini bukan hanya membuat Anda bisa menulis:

```cypher
MATCH p = (a)-[:REL*1..5]->(b)
RETURN p
```

Tujuan sebenarnya adalah membuat Anda bisa menjawab:

- apakah path query ini bounded?
- apakah traversal ini akan meledak secara kombinatorial?
- apakah filter diterapkan sebelum ekspansi atau sesudah ekspansi?
- apakah path ini mengizinkan cycle?
- apakah uniqueness semantics-nya sesuai kebutuhan domain?
- apakah Cypher cukup, atau harus memakai Graph Data Science?
- apakah query ini defensible untuk sistem production?

---

## 1. Mental Model Utama: Path adalah Evidence, bukan Hanya Rute

Di SQL, chain join sering dilihat sebagai cara menggabungkan record dari banyak table. Di graph database, path bukan hanya mekanisme teknis. Path sering menjadi **jawaban domain**.

Contoh:

```text
Person A --OWNS--> Company X --CONTROLS--> Company Y --OWNS--> Account Z
```

Path ini bukan hanya “hasil join”. Path ini adalah bukti struktur kontrol.

Dalam domain enforcement, compliance, fraud, investigation, IAM, dependency analysis, atau regulatory case management, path bisa bermakna:

- jalur kontrol,
- jalur pengaruh,
- jalur kepemilikan,
- jalur eskalasi,
- jalur tanggung jawab,
- jalur akses,
- jalur risiko,
- jalur evidence,
- jalur dependency,
- jalur rekomendasi,
- jalur konflik kepentingan.

Karena itu, path query bukan sekadar “ambil data”. Path query sering menjawab:

> “Mengapa sistem menyimpulkan dua entity ini berkaitan?”

Ini penting untuk explainability dan defensibility.

---

## 2. Istilah Dasar: Node, Relationship, Path, Walk, Trail, Cycle

Sebelum menulis Cypher path query, kita perlu membedakan beberapa konsep graph theory yang sering tercampur.

### 2.1 Node

Node adalah entity atau concept.

Contoh:

```text
(:Person {id: 'P-001'})
(:Company {id: 'C-123'})
(:Case {id: 'CASE-2026-0001'})
(:Account {id: 'ACC-88'})
```

### 2.2 Relationship

Relationship adalah edge yang menghubungkan dua node dan memiliki type.

Contoh:

```text
(:Person)-[:OWNS]->(:Company)
(:Company)-[:CONTROLS]->(:Company)
(:Case)-[:INVOLVES]->(:Person)
(:User)-[:MEMBER_OF]->(:Group)
```

### 2.3 Path

Path adalah sequence node dan relationship yang saling tersambung.

Contoh:

```text
(a)-[r1]->(b)-[r2]->(c)-[r3]->(d)
```

Di Cypher, path bisa di-bind ke variable:

```cypher
MATCH p = (a:Person)-[:OWNS]->(:Company)-[:CONTROLS]->(:Company)
RETURN p
```

`p` bukan node. `p` adalah keseluruhan rangkaian node dan relationship.

### 2.4 Walk

Walk adalah traversal yang dapat mengunjungi node/relationship berulang.

Contoh:

```text
A -> B -> C -> B -> D
```

Node `B` dikunjungi dua kali.

### 2.5 Trail

Trail mengizinkan node berulang, tetapi relationship tidak berulang.

### 2.6 Simple Path

Simple path biasanya berarti node tidak berulang. Ini berguna untuk mencegah cycle.

### 2.7 Cycle

Cycle terjadi ketika traversal kembali ke node sebelumnya.

Contoh:

```text
A -> B -> C -> A
```

Cycle tidak selalu buruk. Banyak domain natural memiliki cycle:

- circular ownership,
- mutual friendship,
- dependency loop,
- approval loop,
- case reassignment loop,
- fund transfer loop,
- group nesting loop.

Yang berbahaya bukan cycle itu sendiri, tetapi query yang tidak mengendalikannya.

---

## 3. Fixed-Length Traversal

Fixed-length traversal adalah pattern dengan jumlah hop pasti.

Contoh: cari person yang memiliki company secara langsung.

```cypher
MATCH (p:Person)-[:OWNS]->(c:Company)
RETURN p, c
```

Ini 1 hop.

Contoh 2 hop:

```cypher
MATCH (p:Person)-[:OWNS]->(c1:Company)-[:CONTROLS]->(c2:Company)
RETURN p, c1, c2
```

Contoh 3 hop:

```cypher
MATCH (p:Person)-[:OWNS]->(:Company)-[:CONTROLS]->(:Company)-[:OWNS]->(a:Account)
RETURN p, a
```

Fixed-length traversal relatif mudah dikendalikan karena jumlah ekspansi diketahui.

### 3.1 Kapan Fixed-Length Lebih Baik?

Gunakan fixed-length pattern ketika domain question memang spesifik.

Contoh:

```text
Cari case yang melibatkan person yang bekerja di organization yang sedang diselidiki.
```

Query:

```cypher
MATCH (case:Case)-[:INVOLVES]->(person:Person)-[:WORKS_FOR]->(org:Organization)
WHERE org.status = 'UNDER_INVESTIGATION'
RETURN case, person, org
```

Ini bukan “semua jalur”. Ini jalur domain yang jelas.

### 3.2 Kesalahan Umum

Banyak engineer terlalu cepat memakai variable-length traversal padahal fixed-length sudah cukup.

Buruk:

```cypher
MATCH p = (case:Case)-[*1..5]-(org:Organization)
WHERE org.status = 'UNDER_INVESTIGATION'
RETURN p
```

Masalah:

- terlalu banyak relationship type yang diizinkan,
- terlalu banyak kemungkinan path,
- semantics kabur,
- hasil sulit dipertanggungjawabkan,
- performa berisiko.

Lebih baik:

```cypher
MATCH p = (case:Case)-[:INVOLVES]->(:Person)-[:WORKS_FOR]->(org:Organization)
WHERE org.status = 'UNDER_INVESTIGATION'
RETURN p
```

Prinsip:

> Jangan memakai variable-length traversal untuk menutupi ketidakjelasan modelling.

---

## 4. Variable-Length Traversal

Variable-length traversal digunakan ketika jumlah hop tidak pasti atau berbeda antar data.

Contoh domain:

- organization hierarchy dengan kedalaman berbeda,
- group membership nested,
- chain ownership,
- dependency graph,
- regulatory escalation chain,
- product component tree,
- account transfer path,
- case relation chain.

Dalam Cypher modern, Neo4j mendorong pemahaman melalui **quantified path patterns** untuk path dengan panjang bervariasi. Secara konseptual, kita mencari path dengan panjang dalam rentang tertentu.

Contoh klasik:

```cypher
MATCH p = (parent:Organization)-[:PARENT_OF*1..5]->(child:Organization)
WHERE parent.id = $rootOrgId
RETURN p
```

Artinya:

```text
Mulai dari parent organization tertentu,
ikuti relationship PARENT_OF dari minimal 1 hop sampai maksimal 5 hop,
kembalikan semua path yang cocok.
```

### 4.1 Bentuk Dasar

```cypher
MATCH p = (a)-[:REL*min..max]->(b)
RETURN p
```

Contoh:

```cypher
MATCH p = (u:User {id: $userId})-[:MEMBER_OF*1..4]->(g:Group)
RETURN g, length(p) AS depth
```

Makna:

- mulai dari user,
- ikuti relationship `MEMBER_OF`,
- dari 1 sampai 4 hop,
- temukan group yang bisa dicapai.

### 4.2 Bounded vs Unbounded

Bounded:

```cypher
[:REL*1..5]
```

Unbounded:

```cypher
[:REL*]
[:REL*1..]
```

Secara engineering, unbounded traversal hampir selalu harus dicurigai.

Unbounded traversal bisa aman hanya jika:

- graph sangat kecil,
- domain menjamin tidak ada cycle,
- relationship type sangat terbatas,
- query dilindungi limit/guard lain,
- query bukan bagian critical production path,
- sudah dibuktikan dengan profiling.

Untuk production, default mental model:

> Setiap variable-length traversal harus punya upper bound kecuali ada alasan kuat dan bukti performa.

---

## 5. Fan-Out Math: Mengapa Path Query Mudah Meledak

Path explosion terjadi karena jumlah kemungkinan path tumbuh cepat seiring depth.

Misalkan rata-rata setiap node punya 10 relationship keluar yang relevan.

Jumlah node/path yang mungkin dijelajahi kira-kira:

```text
Depth 1: 10
Depth 2: 10 x 10 = 100
Depth 3: 10 x 10 x 10 = 1,000
Depth 4: 10,000
Depth 5: 100,000
Depth 6: 1,000,000
```

Ini hanya rata-rata fan-out 10. Dalam graph nyata, node degree tidak merata. Satu supernode bisa punya ribuan relationship.

Contoh:

```text
(:Country {code: 'ID'}) <-[:LOCATED_IN]- 50 juta Person
(:Category {name: 'Retail'}) <-[:IN_CATEGORY]- 2 juta Merchant
(:Permission {name: 'READ'}) <-[:GRANTS]- 200 ribu Role
(:CaseStatus {name: 'OPEN'}) <-[:HAS_STATUS]- 1 juta Case
```

Jika traversal melewati node semacam ini, query bisa meledak.

### 5.1 Formula Intuisi

Jika rata-rata fan-out `f` dan depth `d`, maka potensi ekspansi:

```text
O(f^d)
```

Graph database membuat traversal adjacency efisien, tetapi tidak menghapus fakta matematis bahwa jumlah kemungkinan path bisa sangat besar.

Graph database mempercepat **navigasi koneksi**, bukan membuat **kombinatorial explosion** hilang.

---

## 6. Direction Matters

Relationship di Neo4j memiliki arah. Query bisa mengikuti arah atau mengabaikannya.

Arah eksplisit:

```cypher
MATCH (a)-[:OWNS]->(b)
RETURN a, b
```

Arah sebaliknya:

```cypher
MATCH (a)<-[:OWNS]-(b)
RETURN a, b
```

Undirected pattern:

```cypher
MATCH (a)-[:OWNS]-(b)
RETURN a, b
```

Undirected traversal sering menggandakan ruang pencarian karena query engine dapat mempertimbangkan relationship dari dua arah.

### 6.1 Direction sebagai Domain Semantics

Contoh:

```text
(:Person)-[:OWNS]->(:Company)
```

Arah dari owner ke owned entity masuk akal karena query umum:

- “Apa yang dimiliki person ini?”
- “Company apa yang berada di bawah person ini?”
- “Risk dari person ini menyebar ke entity apa?”

Namun kadang query juga butuh arah sebaliknya:

- “Siapa owner company ini?”

Itu tidak berarti relationship direction salah. Anda tetap bisa query arah sebaliknya:

```cypher
MATCH (company:Company {id: $companyId})<-[:OWNS]-(owner:Person)
RETURN owner
```

### 6.2 Kesalahan Umum

Buruk:

```cypher
MATCH p = (a)-[*1..4]-(b)
RETURN p
```

Ini mengizinkan:

- semua relationship type,
- dua arah,
- sampai 4 hop,
- tanpa anchor predicate yang jelas.

Ini query “graph wandering”. Dalam production, ini hampir selalu berbahaya.

Lebih baik:

```cypher
MATCH p = (a:Person {id: $personId})-[:OWNS|CONTROLS*1..4]->(b:Company)
RETURN p
```

Masih perlu hati-hati, tetapi jauh lebih sempit.

---

## 7. Relationship Type Filtering

Relationship type adalah guard pertama traversal.

Contoh:

```cypher
MATCH p = (p1:Person {id: $personId})-[:OWNS|CONTROLS|DIRECTOR_OF*1..3]->(target)
RETURN p
```

Ini lebih baik daripada:

```cypher
MATCH p = (p1:Person {id: $personId})-[*1..3]->(target)
RETURN p
```

Karena relationship type menentukan semantics.

### 7.1 Jangan Campur Relationship yang Berbeda Makna Tanpa Alasan

Misalnya:

```cypher
[:OWNS|LIKES|VIEWED|LOCATED_IN|HAS_STATUS*1..5]
```

Ini biasanya tanda query tidak punya definisi hubungan yang jelas.

Path yang menggabungkan `OWNS`, `LIKES`, `VIEWED`, dan `HAS_STATUS` mungkin tidak punya makna domain yang defensible.

Tanya:

> “Kalau path ini muncul di laporan investigasi, apakah manusia bisa menjelaskan kenapa path ini relevan?”

Jika tidak, query tersebut hanya eksplorasi, bukan production logic.

---

## 8. Label Filtering pada Anchor dan Target

Traversal paling aman biasanya dimulai dari anchor yang spesifik.

Buruk:

```cypher
MATCH p = (a)-[:RELATED_TO*1..5]->(b)
RETURN p
```

Lebih baik:

```cypher
MATCH p = (case:Case {id: $caseId})-[:INVOLVES|REFERENCES|DERIVED_FROM*1..5]->(related:Case)
RETURN p
```

Lebih baik lagi jika traversal dipisah berdasarkan semantics:

```cypher
MATCH p = (case:Case {id: $caseId})-[:RELATED_TO*1..3]->(related:Case)
WHERE related.status IN ['OPEN', 'UNDER_REVIEW']
RETURN p
```

### 8.1 Anchor Harus Selektif

Anchor ideal:

```cypher
(:Case {id: $caseId})
(:Person {externalId: $personId})
(:Account {accountNo: $accountNo})
(:Resource {urn: $resourceUrn})
```

Anchor buruk:

```cypher
(:Case {status: 'OPEN'})
(:Person {country: 'ID'})
(:Transaction {year: 2026})
```

Karena anchor tersebut bisa menghasilkan terlalu banyak starting rows.

Prinsip:

> Variable-length traversal sebaiknya dimulai dari sedikit node, bukan dari populasi besar.

---

## 9. Path Binding dan Fungsi Path

Cypher memungkinkan path disimpan dalam variable.

```cypher
MATCH p = (a:Person {id: $id})-[:OWNS|CONTROLS*1..4]->(c:Company)
RETURN p
```

Setelah path di-bind, kita bisa memakai fungsi path.

### 9.1 `length(p)`

Mengembalikan jumlah relationship dalam path.

```cypher
MATCH p = (a:Person {id: $id})-[:OWNS|CONTROLS*1..4]->(c:Company)
RETURN c, length(p) AS depth
ORDER BY depth
```

Gunakan untuk:

- menampilkan depth,
- sorting path paling dekat,
- membatasi hasil setelah match,
- ranking sederhana.

### 9.2 `nodes(p)`

Mengembalikan list node dalam path.

```cypher
MATCH p = (a:Person {id: $id})-[:OWNS|CONTROLS*1..4]->(c:Company)
RETURN nodes(p) AS pathNodes
```

Berguna untuk:

- audit path,
- visualization,
- checking node properties sepanjang path,
- extracting intermediate entities.

### 9.3 `relationships(p)`

Mengembalikan list relationship dalam path.

```cypher
MATCH p = (a:Person {id: $id})-[:OWNS|CONTROLS*1..4]->(c:Company)
RETURN relationships(p) AS pathRelationships
```

Berguna untuk:

- mengambil relationship properties,
- menghitung total weight,
- membaca source/provenance per edge,
- menampilkan chain evidence.

### 9.4 Contoh: Validasi Relationship Properties Sepanjang Path

Misalnya relationship `OWNS` dan `CONTROLS` punya property `validTo`.

```cypher
MATCH p = (person:Person {id: $personId})-[:OWNS|CONTROLS*1..5]->(company:Company)
WHERE all(r IN relationships(p) WHERE r.validTo IS NULL)
RETURN p
```

Makna:

> Ambil hanya path yang semua relationship-nya masih aktif.

Ini sangat penting untuk domain temporal.

---

## 10. Filtering Path: Sebelum, Saat, atau Sesudah Ekspansi?

Salah satu perbedaan besar antara query yang cepat dan lambat adalah kapan filter diterapkan.

### 10.1 Filter Setelah Ekspansi

Contoh:

```cypher
MATCH p = (person:Person {id: $id})-[:OWNS|CONTROLS*1..5]->(company:Company)
WHERE company.riskLevel = 'HIGH'
RETURN p
```

Ini memfilter target company setelah path ditemukan.

Jika ada banyak path ke banyak company, query mungkin sudah melakukan ekspansi besar sebelum membuang sebagian hasil.

### 10.2 Filter Sepanjang Path

Contoh:

```cypher
MATCH p = (person:Person {id: $id})-[:OWNS|CONTROLS*1..5]->(company:Company)
WHERE all(n IN nodes(p) WHERE coalesce(n.deleted, false) = false)
RETURN p
```

Ini memfilter path yang melewati node deleted. Namun tergantung bentuk query dan planner, filter seperti ini sering tetap dievaluasi setelah path terbentuk.

### 10.3 Desain Model agar Filter Bisa Lebih Selektif

Kadang perbaikan performa bukan di query, tetapi di model.

Misalnya relationship inactive sering muncul:

```text
[:OWNS {active: true}]
```

Query:

```cypher
MATCH p = (person:Person {id: $id})-[:OWNS|CONTROLS*1..5]->(company:Company)
WHERE all(r IN relationships(p) WHERE r.active = true)
RETURN p
```

Alternatif model:

```text
[:CURRENTLY_OWNS]
[:PREVIOUSLY_OWNS]
```

Query:

```cypher
MATCH p = (person:Person {id: $id})-[:CURRENTLY_OWNS|CURRENTLY_CONTROLS*1..5]->(company:Company)
RETURN p
```

Trade-off:

- relationship type lebih banyak,
- mutation lebih eksplisit,
- traversal lebih selektif,
- semantics lebih jelas.

Tidak selalu lebih baik, tetapi untuk hot traversal, relationship type yang lebih spesifik sering membantu.

---

## 11. Quantified Path Pattern: Cara Berpikir Modern

Dalam Cypher modern, quantified path pattern membantu mengekspresikan path yang memiliki bagian berulang.

Konsep dasarnya:

```cypher
((a)-[:REL]->(b)){1,5}
```

Artinya pattern di dalam tanda kurung dapat diulang 1 sampai 5 kali.

Secara mental, ini lebih kaya daripada hanya `[:REL*1..5]` karena bagian yang diulang bisa berupa subpattern.

Contoh konseptual:

```cypher
MATCH p = (:Station {name: $from})
          ((a)-[:LINK]->(b)){1,5}
          (:Station {name: $to})
RETURN p
```

Dalam praktik, syntax detail perlu mengikuti versi Cypher/Neo4j yang digunakan. Yang penting untuk mental model:

> Variable-length traversal bukan hanya “relationship berulang”, tetapi bisa berupa pattern berulang.

Ini berguna ketika satu step domain terdiri dari lebih dari satu relationship.

Contoh domain regulatory workflow:

```text
(:Case)-[:HAS_ACTION]->(:Action)-[:RESULTED_IN]->(:Case)
```

Satu “step” eskalasi case mungkin bukan direct relationship `CASE_ESCALATED_TO_CASE`, tetapi subgraph kecil:

```text
Case -> Action -> NextCase
```

Quantified path pattern memungkinkan pemikiran seperti:

```text
Ulangi pola Case -> Action -> Case sebanyak 1..N kali.
```

Ini lebih semantik daripada sekadar:

```cypher
[:HAS_ACTION|RESULTED_IN*1..10]
```

Karena path random yang mencampur relationship bisa menghasilkan urutan yang tidak valid secara domain.

---

## 12. Shortest Path: Apa yang Dicari?

Shortest path adalah path dengan jumlah hop terkecil antara dua node, kecuali kita memakai weighted algorithm di luar Cypher basic.

Contoh:

```cypher
MATCH p = shortestPath(
  (a:Person {id: $from})-[:ASSOCIATED_WITH*1..6]-(b:Person {id: $to})
)
RETURN p
```

Makna:

> Cari salah satu path terpendek dari person A ke person B melalui relationship ASSOCIATED_WITH sampai maksimal 6 hop.

### 12.1 Single Shortest Path vs All Shortest Paths

Kadang ada lebih dari satu path dengan panjang sama.

Contoh:

```text
A -> B -> D
A -> C -> D
```

Ada dua shortest path dari A ke D dengan panjang 2.

Untuk investigasi, kadang satu path cukup untuk membuktikan keterhubungan. Kadang semua shortest paths penting untuk melihat semua hubungan setara.

Pertanyaan desain:

- Apakah saya hanya butuh tahu “ada koneksi cepat”? 
- Apakah saya perlu semua jalur untuk explainability?
- Apakah path alternatif mengubah keputusan?
- Apakah path alternatif harus ditampilkan ke investigator?

### 12.2 Shortest Tidak Selalu Best

Path terpendek tidak selalu path paling bermakna.

Contoh:

```text
Person A --LOCATED_IN--> Country X <--LOCATED_IN-- Person B
```

Ini path 2 hop, tetapi lemah secara evidence karena sama-sama berada di negara yang sama.

Sementara:

```text
Person A --DIRECTOR_OF--> Company C <--OWNS-- Person B
```

Ini juga 2 hop, tetapi jauh lebih kuat sebagai hubungan bisnis.

Atau path 4 hop:

```text
Person A -> Company X -> Account Y -> Transaction Z -> Person B
```

Mungkin lebih bermakna daripada path 2 hop via generic category.

Prinsip:

> Shortest path adalah konsep struktural, bukan konsep domain trust.

Jika domain membutuhkan “best path”, Anda perlu mendefinisikan scoring/weight, bukan hanya jumlah hop.

---

## 13. Weighted Path: Batas Cypher dan Peran GDS

Cypher shortest path umumnya cocok untuk path berdasarkan jumlah hop dan pattern navigation. Untuk weighted shortest path, misalnya:

- biaya rute,
- jarak geografis,
- risiko edge,
- confidence score,
- transaction amount,
- latency,
- dependency severity,

Anda biasanya membutuhkan algoritma pathfinding di Graph Data Science seperti Dijkstra atau A*.

Contoh weighted graph:

```text
(:Warehouse)-[:ROUTE {cost: 10, distanceKm: 100}]->(:Warehouse)
(:Warehouse)-[:ROUTE {cost: 5, distanceKm: 300}]->(:Warehouse)
```

Shortest by hop mungkin memilih 1 edge, tetapi cheapest path mungkin memilih 3 edge.

### 13.1 Cypher Cocok Jika

Gunakan Cypher path query jika:

- butuh pattern navigation kompleks,
- depth relatif kecil,
- path semantics lebih penting daripada global optimality,
- data tidak perlu diproyeksikan ke in-memory analytical graph,
- query adalah bagian operational transaction path,
- path filtering bergantung pada rich property/pattern semantics.

### 13.2 GDS Cocok Jika

Gunakan GDS path algorithm jika:

- butuh weighted shortest path,
- butuh all-pairs/single-source computation,
- butuh algoritma graph standar,
- butuh performa analytical di graph projection,
- graph relatif stabil untuk window analitik,
- hasil bisa dihitung batch atau semi-real-time.

Neo4j GDS menyediakan path finding algorithms seperti Dijkstra dan A*. Dijkstra mendukung weighted graph dengan positive relationship weights, sedangkan A* memakai heuristic untuk mengarahkan pencarian dan juga mendukung weighted graph positif.

---

## 14. Path Query dalam Domain Enforcement dan Case Management

Mari gunakan domain yang lebih kompleks.

Kita punya model sederhana:

```text
(:Person)-[:OWNS]->(:Company)
(:Company)-[:OWNS]->(:Company)
(:Company)-[:HAS_ACCOUNT]->(:Account)
(:Account)-[:SENT_TO]->(:Account)
(:Case)-[:INVOLVES]->(:Person)
(:Case)-[:INVOLVES]->(:Company)
(:Evidence)-[:SUPPORTS]->(:Case)
```

### 14.1 Pertanyaan: Beneficial Ownership Chain

> “Tampilkan chain ownership dari person ke company target maksimal 5 hop.”

```cypher
MATCH p = (person:Person {id: $personId})-[:OWNS|CONTROLS*1..5]->(company:Company {id: $companyId})
RETURN p, length(p) AS ownershipDepth
ORDER BY ownershipDepth
```

Hal yang perlu diperhatikan:

- relationship type dibatasi,
- anchor person spesifik,
- target company spesifik,
- max depth 5,
- path dikembalikan untuk explainability.

### 14.2 Pertanyaan: Semua Company yang Bisa Dikontrol

```cypher
MATCH p = (person:Person {id: $personId})-[:OWNS|CONTROLS*1..5]->(company:Company)
RETURN company.id, company.name, min(length(p)) AS minDepth, count(p) AS pathCount
ORDER BY minDepth, pathCount DESC
```

Catatan:

- `min(length(p))` memberi depth terdekat,
- `count(p)` bisa menunjukkan banyaknya jalur kontrol,
- banyak path ke company yang sama bisa bermakna: kontrol melalui banyak kendaraan.

Namun `count(p)` juga bisa mahal jika path sangat banyak.

### 14.3 Pertanyaan: Case Terkait Lewat Shared Entity

```cypher
MATCH p = (case1:Case {id: $caseId})-[:INVOLVES]->(entity)<-[:INVOLVES]-(case2:Case)
WHERE case1 <> case2
RETURN case2, entity, p
```

Ini fixed 2 hop dan defensible.

Jangan langsung:

```cypher
MATCH p = (case1:Case {id: $caseId})-[*1..6]-(case2:Case)
RETURN p
```

Karena path bisa melewati relationship yang tidak relevan.

### 14.4 Pertanyaan: Related Cases dengan Chain Terbatas

Misalnya ada relationship eksplisit antar case:

```text
(:Case)-[:RELATED_TO]->(:Case)
(:Case)-[:DERIVED_FROM]->(:Case)
(:Case)-[:ESCALATED_TO]->(:Case)
```

Query:

```cypher
MATCH p = (case:Case {id: $caseId})-[:RELATED_TO|DERIVED_FROM|ESCALATED_TO*1..4]-(related:Case)
WHERE related.status IN ['OPEN', 'UNDER_REVIEW']
RETURN related, p, length(p) AS distance
ORDER BY distance
```

Lebih baik karena relationship type memang case-to-case semantics.

---

## 15. Dependency Impact Path

Graph sangat kuat untuk impact analysis.

Model:

```text
(:Service)-[:DEPENDS_ON]->(:Service)
(:Service)-[:USES]->(:Database)
(:Service)-[:PUBLISHES]->(:Topic)
(:Service)-[:CONSUMES]->(:Topic)
```

### 15.1 Downstream Impact

Jika service A berubah, service apa yang terdampak?

Jika direction `DEPENDS_ON` berarti:

```text
A -[:DEPENDS_ON]-> B
```

Artinya A bergantung pada B. Kalau B rusak, A terdampak. Untuk mencari downstream dari B, kita traverse arah masuk:

```cypher
MATCH p = (changed:Service {name: $serviceName})<-[:DEPENDS_ON*1..5]-(affected:Service)
RETURN affected.name, length(p) AS distance, p
ORDER BY distance
```

Ini contoh penting: arah relationship harus sesuai semantics. Query downstream kadang berlawanan arah dari relationship.

### 15.2 Upstream Dependencies

Apa dependency service A?

```cypher
MATCH p = (svc:Service {name: $serviceName})-[:DEPENDS_ON*1..5]->(dependency:Service)
RETURN dependency.name, length(p) AS distance, p
ORDER BY distance
```

### 15.3 Cycle Detection Sederhana

Cari dependency cycle dari service tertentu:

```cypher
MATCH p = (svc:Service {name: $serviceName})-[:DEPENDS_ON*1..10]->(svc)
RETURN p
LIMIT 20
```

Catatan:

- depth harus dibatasi,
- cycle bisa sangat banyak,
- untuk analisis cycle besar, GDS atau offline analysis bisa lebih tepat.

---

## 16. IAM dan Entitlement Path

Model:

```text
(:User)-[:MEMBER_OF]->(:Group)
(:Group)-[:MEMBER_OF]->(:Group)
(:Group)-[:HAS_ROLE]->(:Role)
(:Role)-[:GRANTS]->(:Permission)
(:Permission)-[:APPLIES_TO]->(:Resource)
```

### 16.1 Effective Permissions

```cypher
MATCH p = (u:User {id: $userId})-[:MEMBER_OF*0..5]->(g:Group)-[:HAS_ROLE]->(r:Role)-[:GRANTS]->(perm:Permission)-[:APPLIES_TO]->(res:Resource)
RETURN res, perm, r, g, p
```

Perhatikan `*0..5`.

Artinya user bisa memiliki role melalui group chain, atau mungkin langsung jika model mengizinkan user sebagai group-like principal. Namun `0` hop harus digunakan hati-hati karena dapat membuat start node juga dianggap match.

Alternatif model lebih eksplisit:

```text
(:Principal)<- label untuk User dan Group
(:Principal)-[:MEMBER_OF]->(:Group)
(:Principal)-[:HAS_ROLE]->(:Role)
```

Lalu:

```cypher
MATCH p = (u:User {id: $userId})-[:MEMBER_OF*0..5]->(principal)-[:HAS_ROLE]->(role:Role)-[:GRANTS]->(perm:Permission)-[:APPLIES_TO]->(res:Resource)
RETURN res, perm, role, p
```

### 16.2 Why Path Matters for Authorization

Authorization system tidak cukup menjawab:

```text
User X has READ on Resource Y.
```

Dalam enterprise/regulatory environment, sering harus menjawab:

```text
Mengapa User X punya READ?
Lewat group apa?
Lewat role apa?
Siapa yang approve membership itu?
Apakah akses itu inherited atau direct?
Apakah ada toxic combination?
```

Path adalah explanation.

---

## 17. Fraud Connection Path

Model:

```text
(:Person)-[:OWNS]->(:Account)
(:Account)-[:SENT_TO]->(:Account)
(:Account)<-[:OWNS]-(:Person)
(:Person)-[:USES_DEVICE]->(:Device)
(:Person)-[:USES_ADDRESS]->(:Address)
(:Case)-[:INVOLVES]->(:Person)
```

### 17.1 Cari Koneksi Person ke Fraud Case

```cypher
MATCH p = (person:Person {id: $personId})-[:OWNS|SENT_TO|USES_DEVICE|USES_ADDRESS|INVOLVES*1..4]-(case:Case)
WHERE case.type = 'FRAUD'
RETURN p, length(p) AS distance
ORDER BY distance
LIMIT 20
```

Ini mungkin berguna untuk eksplorasi, tetapi untuk production terlalu longgar karena relationship types campur node types berbeda.

Lebih defensible:

```cypher
MATCH p = (person:Person {id: $personId})-[:USES_DEVICE]->(device:Device)<-[:USES_DEVICE]-(other:Person)<-[:INVOLVES]-(case:Case)
WHERE case.type = 'FRAUD'
RETURN case, other, device, p
```

Atau untuk account transfer:

```cypher
MATCH p = (person:Person {id: $personId})-[:OWNS]->(:Account)-[:SENT_TO*1..3]->(:Account)<-[:OWNS]-(suspect:Person)<-[:INVOLVES]-(case:Case)
WHERE case.type = 'FRAUD'
RETURN case, suspect, p
```

Ini lebih jelas:

> person terkait fraud case melalui transfer chain maksimal 3 hop antar account.

### 17.2 Fraud Path Scoring

Tidak semua path sama kuat.

Contoh evidence strength:

```text
Shared device: strong
Shared address: medium
Same city: weak
Transferred funds: strong, depending amount and time
Same merchant category: weak
```

Jika ingin scoring path, jangan hanya pakai `length(p)`. Gunakan relationship properties atau GDS weighted path / custom scoring pipeline.

---

## 18. All Paths: Kapan Berbahaya?

Query berikut tampak sederhana:

```cypher
MATCH p = (a:Person {id: $a})-[:ASSOCIATED_WITH*1..6]-(b:Person {id: $b})
RETURN p
```

Tetapi ini mencari semua path antara A dan B sampai 6 hop.

Dalam graph padat, jumlah path bisa sangat besar. Bahkan jika hanya ada 2 node target, jumlah path alternatif bisa ribuan atau jutaan.

### 18.1 Pertanyaan yang Harus Ditanyakan

Sebelum menulis `RETURN p`, tanya:

1. Apakah saya butuh semua path?
2. Apakah satu path cukup?
3. Apakah shortest path cukup?
4. Apakah saya hanya butuh existence?
5. Apakah saya butuh count?
6. Apakah path harus unik berdasarkan node?
7. Apakah path via generic node harus dikecualikan?
8. Apakah relationship type sudah dibatasi?
9. Apakah depth sudah masuk akal?
10. Apakah query ini akan dipakai online atau offline?

### 18.2 Existence Query

Jika hanya butuh tahu apakah koneksi ada:

```cypher
MATCH (a:Person {id: $a}), (b:Person {id: $b})
RETURN EXISTS {
  MATCH (a)-[:ASSOCIATED_WITH*1..4]-(b)
} AS connected
```

Ini lebih jelas daripada mengembalikan semua path.

### 18.3 Count Query

Jika hanya butuh jumlah path:

```cypher
MATCH p = (a:Person {id: $a})-[:ASSOCIATED_WITH*1..4]-(b:Person {id: $b})
RETURN count(p) AS pathCount
```

Namun count tetap bisa mahal karena path tetap harus ditemukan.

### 18.4 Limit Tidak Selalu Menyelamatkan

```cypher
MATCH p = (a)-[:REL*1..8]-(b)
RETURN p
LIMIT 10
```

`LIMIT` bisa membantu output, tetapi tidak selalu mencegah engine melakukan banyak pekerjaan sebelum menemukan 10 hasil, tergantung pola dan rencana eksekusi.

Jangan menganggap `LIMIT` sebagai pengganti boundary traversal.

---

## 19. Cycle Handling

Cycle bisa menyebabkan path query menghasilkan banyak variasi path.

Contoh graph:

```text
A -> B -> C -> A
```

Query:

```cypher
MATCH p = (a:Node {id: 'A'})-[:LINK*1..6]->(x)
RETURN p
```

Path yang mungkin:

```text
A -> B
A -> B -> C
A -> B -> C -> A
A -> B -> C -> A -> B
A -> B -> C -> A -> B -> C
...
```

Dengan upper bound 6, finite. Tanpa upper bound, berbahaya.

### 19.1 Mencegah Node Berulang

Untuk simple path, Anda bisa filter:

```cypher
MATCH p = (a:Node {id: $id})-[:LINK*1..6]->(x)
WHERE size(nodes(p)) = size(apoc.coll.toSet(nodes(p)))
RETURN p
```

Ini memakai APOC. Tanpa APOC, bisa memakai pendekatan lain, tetapi menjadi kurang nyaman.

Catatan penting:

- filtering setelah path terbentuk bisa tetap mahal,
- lebih baik desain traversal sempit sejak awal,
- untuk graph besar, cycle analysis mungkin lebih cocok memakai GDS/offline.

### 19.2 Cycle sebagai Signal

Dalam beberapa domain, cycle justru penting.

Contoh:

- circular ownership bisa menjadi red flag,
- dependency cycle bisa menjadi architecture smell,
- approval cycle bisa menunjukkan workflow bug,
- transaction loop bisa menunjukkan layering/money movement pattern.

Query cycle sederhana:

```cypher
MATCH p = (company:Company {id: $companyId})-[:OWNS|CONTROLS*1..8]->(company)
RETURN p
LIMIT 20
```

Interpretasi harus hati-hati:

- apakah relationship masih aktif?
- apakah ownership percentage cukup signifikan?
- apakah cycle legal/normal dalam domain?
- apakah data duplicate?
- apakah entity resolution salah?

---

## 20. Relationship Uniqueness dan Node Uniqueness

Path matching memiliki semantics tentang apa yang boleh berulang. Dalam praktik, Anda harus berpikir eksplisit:

- bolehkah node yang sama muncul dua kali dalam path?
- bolehkah relationship yang sama dilalui dua kali?
- apakah path A-B-C sama dengan A-C-B untuk domain ini?
- apakah direction penting?
- apakah path dengan relationship berbeda tapi node sama harus dianggap berbeda?

### 20.1 Contoh: Same Nodes, Different Edges

```text
Person A -[:OWNS {source:'registry'}]-> Company X
Person A -[:OWNS {source:'self_report'}]-> Company X
```

Apakah ini dua relationship atau satu relationship dengan multiple sources?

Jika dua relationship, path count bisa bertambah.

Untuk audit, dua evidence source mungkin penting.
Untuk traversal, duplikasi bisa membuat hasil membengkak.

Model alternatif:

```text
(Person)-[:OWNS]->(Company)
(OwnershipEvidence)-[:SUPPORTS]->(OwnershipFact)
```

Atau relationship `OWNS` punya property/list source.

Keputusan ini mempengaruhi path semantics.

### 20.2 Contoh: Relationship Parallel

Neo4j property graph mengizinkan multiple relationships antara dua node.

Contoh:

```text
(A)-[:TRANSFER {date:'2026-01-01', amount:100}]->(B)
(A)-[:TRANSFER {date:'2026-01-02', amount:200}]->(B)
```

Path antara A dan B bisa banyak walaupun node sama.

Ini benar untuk transaction graph, tetapi buruk jika Anda hanya butuh agregasi account-to-account.

Solusi bisa berupa derived edge:

```text
(A)-[:HAS_TRANSFER_SUMMARY {count:2,totalAmount:300}]->(B)
```

Lalu raw transaction tetap sebagai node/event terpisah.

---

## 21. Path Projection: Mengubah Path Menjadi Output yang Bisa Dipakai Aplikasi

Mengembalikan raw path bagus untuk Neo4j Browser, tetapi aplikasi Java sering butuh DTO yang stabil.

### 21.1 Raw Path Output

```cypher
MATCH p = (person:Person {id: $id})-[:OWNS|CONTROLS*1..4]->(company:Company)
RETURN p
```

Bagus untuk eksplorasi.

### 21.2 Structured Path DTO

```cypher
MATCH p = (person:Person {id: $id})-[:OWNS|CONTROLS*1..4]->(company:Company)
RETURN {
  targetCompanyId: company.id,
  targetCompanyName: company.name,
  depth: length(p),
  nodes: [n IN nodes(p) | {
    labels: labels(n),
    id: n.id,
    name: coalesce(n.name, n.id)
  }],
  relationships: [r IN relationships(p) | {
    type: type(r),
    percentage: r.percentage,
    validFrom: r.validFrom,
    validTo: r.validTo,
    source: r.source
  }]
} AS ownershipPath
```

Ini lebih cocok untuk API.

### 21.3 Kenapa Projection Penting?

Tanpa projection:

- API coupling ke Neo4j internal representation,
- client perlu paham labels/type/properties,
- data bocor terlalu banyak,
- security trimming sulit,
- backward compatibility buruk.

Dengan projection:

- contract lebih stabil,
- property sensitif bisa disaring,
- path explanation bisa distandarkan,
- frontend lebih mudah render.

---

## 22. Path Ranking

Saat query menghasilkan banyak path, Anda perlu ranking.

Ranking sederhana:

```cypher
ORDER BY length(p)
```

Tapi sering tidak cukup.

### 22.1 Ranking Berdasarkan Depth

```cypher
MATCH p = (a:Person {id: $id})-[:ASSOCIATED_WITH*1..5]-(b:Person)
RETURN b, p, length(p) AS depth
ORDER BY depth
LIMIT 20
```

Masalah:

- path terpendek bisa melewati generic relationship,
- path panjang bisa lebih kuat.

### 22.2 Ranking Berdasarkan Relationship Strength

Misalnya relationship punya `strength`.

```cypher
MATCH p = (a:Person {id: $id})-[:ASSOCIATED_WITH*1..5]-(b:Person)
WITH b, p,
     reduce(score = 0.0, r IN relationships(p) | score + coalesce(r.strength, 0.0)) AS totalStrength
RETURN b, p, totalStrength, length(p) AS depth
ORDER BY totalStrength DESC, depth ASC
LIMIT 20
```

Ini lebih domain-aware.

### 22.3 Ranking Berdasarkan Weakest Link

Kadang path hanya sekuat relationship terlemahnya.

```cypher
MATCH p = (a:Person {id: $id})-[:ASSOCIATED_WITH*1..5]-(b:Person)
WITH b, p,
     reduce(minStrength = 1.0, r IN relationships(p) |
       CASE WHEN coalesce(r.strength, 0.0) < minStrength THEN coalesce(r.strength, 0.0) ELSE minStrength END
     ) AS weakestLink
RETURN b, p, weakestLink
ORDER BY weakestLink DESC
LIMIT 20
```

### 22.4 Ranking Berdasarkan Domain Rule

Untuk enforcement:

```text
TRANSFER edge > SHARED_DEVICE edge > SHARED_ADDRESS edge > SAME_CITY edge
```

Bisa buat mapping score:

```cypher
MATCH p = (a:Person {id: $id})-[*1..4]-(b:Person)
WITH b, p,
     reduce(score = 0, r IN relationships(p) |
       score + CASE type(r)
         WHEN 'TRANSFERRED_TO' THEN 10
         WHEN 'SHARED_DEVICE_WITH' THEN 8
         WHEN 'SHARED_ADDRESS_WITH' THEN 5
         WHEN 'SAME_CITY_AS' THEN 1
         ELSE 0
       END
     ) AS score
RETURN b, p, score
ORDER BY score DESC, length(p) ASC
LIMIT 20
```

Namun jika scoring makin kompleks, pertimbangkan:

- derived relationship,
- offline scoring pipeline,
- GDS,
- Java service scoring layer,
- feature store / ML pipeline.

---

## 23. Path Deduplication

Variable-length traversal sering menghasilkan banyak path ke target yang sama.

Contoh:

```cypher
MATCH p = (person:Person {id: $id})-[:OWNS|CONTROLS*1..5]->(company:Company)
RETURN company, p
```

Company yang sama bisa muncul dengan banyak path.

### 23.1 Ambil Target Unik

```cypher
MATCH p = (person:Person {id: $id})-[:OWNS|CONTROLS*1..5]->(company:Company)
RETURN DISTINCT company
```

Masalah: Anda kehilangan explanation path.

### 23.2 Ambil Path Terpendek per Target

```cypher
MATCH p = (person:Person {id: $id})-[:OWNS|CONTROLS*1..5]->(company:Company)
WITH company, p
ORDER BY length(p)
WITH company, collect(p)[0] AS shortestPath
RETURN company, shortestPath, length(shortestPath) AS depth
ORDER BY depth
```

Catatan:

- `collect(p)` bisa mahal jika path banyak,
- untuk graph besar, hati-hati.

### 23.3 Ambil Ringkasan

```cypher
MATCH p = (person:Person {id: $id})-[:OWNS|CONTROLS*1..5]->(company:Company)
RETURN company.id AS companyId,
       company.name AS companyName,
       min(length(p)) AS minDepth,
       count(p) AS pathCount
ORDER BY minDepth, pathCount DESC
```

Ini sering lebih cocok untuk list page. Detail path bisa diambil on-demand.

---

## 24. Designing Safe Path APIs untuk Java Service

Jangan expose endpoint seperti:

```http
GET /graph/path?from=A&to=B&maxDepth=10&type=any
```

Ini terlalu bebas.

Lebih baik buat API berdasarkan use case:

```http
GET /persons/{id}/controlled-companies?maxDepth=5
GET /cases/{id}/related-cases?maxDepth=3
GET /services/{name}/downstream-impact?maxDepth=5
GET /users/{id}/effective-permissions
GET /accounts/{id}/transfer-reachability?maxHops=3
```

### 24.1 Guardrail API

Setiap path API perlu guardrail:

- max depth hardcoded atau capped,
- allowed relationship types fixed,
- allowed labels fixed,
- anchor harus ID unik,
- pagination/limit,
- timeout,
- result size cap,
- audit logging,
- query metrics,
- fallback response saat traversal terlalu besar,
- feature flag untuk query mahal.

### 24.2 DTO Example

```java
public record GraphPathResponse(
    String queryType,
    String anchorId,
    List<PathResult> paths,
    PageInfo pageInfo,
    QueryDiagnostics diagnostics
) {}

public record PathResult(
    String targetId,
    String targetType,
    int depth,
    double score,
    List<PathNodeDto> nodes,
    List<PathRelationshipDto> relationships
) {}

public record PathNodeDto(
    String id,
    String type,
    String displayName
) {}

public record PathRelationshipDto(
    String type,
    String fromId,
    String toId,
    Map<String, Object> publicProperties
) {}
```

Jangan return semua property node/relationship secara mentah.

### 24.3 Query Parameter Safety

Buruk:

```java
String cypher = "MATCH p = (a)-[:" + type + "*1.." + depth + "]->(b) RETURN p";
```

Risiko:

- injection-like query construction,
- type tidak tervalidasi,
- depth tidak dicap,
- query plan buruk,
- semantics tidak terkendali.

Lebih baik:

```java
int maxDepth = Math.min(requestedDepth, 5);

String cypher = """
MATCH p = (person:Person {id: $personId})-[:OWNS|CONTROLS*1..5]->(company:Company)
RETURN company.id AS companyId, p AS path, length(p) AS depth
ORDER BY depth
LIMIT $limit
""";
```

Catatan: relationship type dan variable-length bound sering tidak bisa sepenuhnya diparameterisasi seperti value biasa; desain query templates yang eksplisit lebih aman.

---

## 25. Query Planning untuk Path Query

Part 011 nanti akan membahas `PROFILE` secara mendalam. Di sini kita fokus pada path-specific intuition.

### 25.1 Anchor Lookup

Query baik biasanya dimulai dengan index seek/unique constraint lookup:

```cypher
MATCH (person:Person {id: $personId})
MATCH p = (person)-[:OWNS|CONTROLS*1..5]->(company:Company)
RETURN p
```

Pastikan ada constraint/index pada `Person.id`.

### 25.2 Expansion

Setelah anchor ditemukan, engine melakukan expansion relationship.

Masalah muncul jika:

- anchor terlalu banyak,
- relationship type terlalu luas,
- direction undirected,
- depth terlalu dalam,
- ada supernode,
- filter target terlambat,
- path dikembalikan terlalu banyak.

### 25.3 Cardinality Explosion

Setiap expansion bisa melipatgandakan rows.

Contoh:

```cypher
MATCH (p:Person {country: 'ID'})
MATCH path = (p)-[:ASSOCIATED_WITH*1..4]-(x)
RETURN path
```

Jika ada jutaan person di country ID, traversal dimulai dari jutaan anchor.

Lebih baik:

- anchor by ID,
- batch offline,
- precompute relationship,
- use GDS/offline analytics,
- split query.

---

## 26. Common Path Query Anti-Patterns

### 26.1 “Any Relationship” Traversal

```cypher
MATCH p = (a)-[*1..5]-(b)
RETURN p
```

Masalah:

- semantics tidak jelas,
- traversal terlalu luas,
- sulit dioptimasi,
- hasil sulit dijelaskan.

### 26.2 Unbounded Traversal

```cypher
MATCH p = (a)-[:REL*]->(b)
RETURN p
```

Masalah:

- cycle risk,
- infinite-like search space,
- memory blow-up,
- timeout.

### 26.3 High-Degree Generic Node

```cypher
MATCH p = (person:Person {id: $id})-[*1..3]-(x)
RETURN p
```

Jika path melewati `(:Country)`, `(:Category)`, `(:Status)`, query bisa meledak.

### 26.4 Path Query untuk Report Global

```cypher
MATCH p = (:Person)-[:OWNS|CONTROLS*1..10]->(:Company)
RETURN p
```

Ini global path enumeration. Biasanya bukan online query.

Gunakan batch job, GDS, precomputation, atau query per anchor.

### 26.5 Returning Path When Only Target Needed

```cypher
MATCH p = (u:User {id: $id})-[:MEMBER_OF*1..5]->(g:Group)
RETURN p
```

Jika API hanya butuh group list:

```cypher
MATCH (u:User {id: $id})-[:MEMBER_OF*1..5]->(g:Group)
RETURN DISTINCT g.id, g.name
```

### 26.6 Shortest Path via Weak Generic Edges

```cypher
MATCH p = shortestPath((a:Person {id:$a})-[*1..4]-(b:Person {id:$b}))
RETURN p
```

Bisa menghasilkan path via `Country`, `City`, `Category`, atau `Status` yang tidak bermakna.

---

## 27. Design Pattern: Derived Shortcut Relationship

Kadang path query yang mahal perlu dijadikan relationship turunan.

Contoh original:

```text
(:Person)-[:OWNS]->(:Company)-[:OWNS]->(:Company)-[:OWNS]->(:Company)
```

Jika query “person controls company indirectly” sangat sering dipakai, Anda bisa membuat:

```text
(:Person)-[:ULTIMATELY_CONTROLS {depth, computedAt, method}]->(:Company)
```

### 27.1 Kapan Derived Edge Masuk Akal?

Gunakan derived edge jika:

- path query sering dipakai,
- latency harus rendah,
- path depth besar,
- graph relatif stabil atau perubahan bisa diproses,
- hasil bisa direcompute,
- explanation path tetap disimpan/diambil saat detail dibutuhkan.

### 27.2 Risiko Derived Edge

Risiko:

- stale data,
- complex invalidation,
- double truth,
- audit challenge,
- hidden business logic,
- update cost.

Untuk regulatory system, derived edge harus punya provenance:

```text
(:Person)-[:ULTIMATELY_CONTROLS {
  computedAt,
  algorithmVersion,
  sourceSnapshotId,
  minDepth,
  evidencePathIds
}]->(:Company)
```

Prinsip:

> Derived relationship boleh, tetapi harus bisa dijelaskan dan direkonstruksi.

---

## 28. Design Pattern: Path Materialization as Evidence

Untuk sistem audit-heavy, kadang path yang ditemukan saat keputusan dibuat harus disimpan sebagai evidence snapshot.

Contoh:

```text
(:Decision)-[:BASED_ON_PATH]->(:PathEvidence)
(:PathEvidence)-[:HAS_STEP]->(:PathStep)
(:PathStep)-[:FROM_NODE]->(:Entity)
(:PathStep)-[:VIA_RELATIONSHIP]->(:RelationshipEvidence)
(:PathStep)-[:TO_NODE]->(:Entity)
```

Mengapa?

Karena graph berubah.

Pada tanggal 2026-06-21, path A -> B -> C mungkin ada. Tiga bulan kemudian relationship B -> C sudah inactive atau dihapus. Jika keputusan enforcement dibuat berdasarkan path lama, Anda perlu menjelaskan kondisi saat itu.

### 28.1 Snapshot vs Live Path

Live path:

```text
Apa path saat ini?
```

Snapshot path:

```text
Apa path yang diketahui saat keputusan dibuat?
```

Jangan campur keduanya.

### 28.2 Regulatory Defensibility

Untuk keputusan penting, simpan:

- query version,
- query parameters,
- timestamp,
- data snapshot/version,
- path nodes,
- path relationships,
- source evidence,
- evaluator/actor,
- decision id,
- confidence/scoring method.

---

## 29. Kapan Memakai Cypher Path Query vs GDS vs Precompute?

### 29.1 Gunakan Cypher Jika

- query anchored ke entity spesifik,
- depth kecil sampai sedang,
- relationship type jelas,
- butuh rich pattern semantics,
- butuh hasil real-time dari graph operational,
- path perlu ditampilkan sebagai explanation,
- weighted optimization tidak diperlukan.

Contoh:

```text
Cari chain ownership maksimal 5 hop dari Person P ke Company C.
```

### 29.2 Gunakan GDS Jika

- butuh centrality/community/pathfinding standar,
- butuh weighted shortest path,
- butuh compute banyak source/target,
- graph dipakai untuk analytics,
- bisa membuat in-memory projection,
- hasil bisa stream/mutate/write.

Contoh:

```text
Hitung shortest weighted risk path dari semua high-risk account ke target institution.
```

### 29.3 Gunakan Precompute Jika

- query terlalu mahal untuk online,
- path result sering dipakai,
- graph berubah dengan pola terkendali,
- freshness requirement jelas,
- derived result bisa diaudit.

Contoh:

```text
Effective permissions user dihitung setiap perubahan group/role, lalu disimpan sebagai derived edge.
```

### 29.4 Gunakan Relational/Search/OLAP Jika

- query bukan connectivity problem,
- hanya filtering/sorting attribute,
- butuh aggregation global besar,
- butuh full-text relevance ranking,
- butuh report historis besar.

Graph bukan pengganti semua workload.

---

## 30. Practical Checklist untuk Path Query Production

Sebelum path query masuk production, jawab checklist ini.

### 30.1 Semantics

- Apa arti path ini dalam domain?
- Apakah setiap relationship type dalam path punya alasan?
- Apakah direction benar?
- Apakah path dengan cycle valid?
- Apakah path dengan repeated node valid?
- Apakah path terpendek benar-benar path terbaik?
- Apakah generic nodes harus dikecualikan?

### 30.2 Boundary

- Apakah anchor selektif?
- Apakah max depth dibatasi?
- Apakah relationship type dibatasi?
- Apakah target label dibatasi?
- Apakah result limit ada?
- Apakah timeout ada?
- Apakah API cap mencegah user meminta depth besar?

### 30.3 Performance

- Apakah anchor memakai index/constraint?
- Apakah `PROFILE` sudah dicek?
- Berapa rows dan db hits?
- Apakah ada supernode?
- Apakah query melewati high-degree generic node?
- Apakah `RETURN p` memang diperlukan?
- Apakah dedup dilakukan dengan aman?

### 30.4 Correctness

- Apakah inactive/deleted relationship difilter?
- Apakah temporal validity benar?
- Apakah source/provenance diperlukan?
- Apakah path snapshot perlu disimpan?
- Apakah duplicate relationship mempengaruhi hasil?
- Apakah concurrent updates bisa mengubah hasil selama decision flow?

### 30.5 Operations

- Apakah query dilog?
- Apakah slow query alert ada?
- Apakah result size dimonitor?
- Apakah ada fallback untuk timeout?
- Apakah ada circuit breaker di service?
- Apakah ada dashboard untuk query latency?

---

## 31. Mini Lab: Ownership Path

### 31.1 Sample Data

```cypher
CREATE (p:Person {id: 'P1', name: 'Alice'});
CREATE (c1:Company {id: 'C1', name: 'Alpha Holdings'});
CREATE (c2:Company {id: 'C2', name: 'Beta Trading'});
CREATE (c3:Company {id: 'C3', name: 'Gamma Logistics'});
CREATE (c4:Company {id: 'C4', name: 'Delta Retail'});

MATCH (p:Person {id:'P1'}), (c1:Company {id:'C1'})
CREATE (p)-[:OWNS {percentage: 80, active: true}]->(c1);

MATCH (c1:Company {id:'C1'}), (c2:Company {id:'C2'})
CREATE (c1)-[:CONTROLS {percentage: 60, active: true}]->(c2);

MATCH (c2:Company {id:'C2'}), (c3:Company {id:'C3'})
CREATE (c2)-[:CONTROLS {percentage: 55, active: true}]->(c3);

MATCH (c1:Company {id:'C1'}), (c4:Company {id:'C4'})
CREATE (c1)-[:CONTROLS {percentage: 30, active: false}]->(c4);
```

### 31.2 Query Semua Controlled Companies

```cypher
MATCH p = (:Person {id:'P1'})-[:OWNS|CONTROLS*1..4]->(company:Company)
RETURN company.id, company.name, length(p) AS depth, p
ORDER BY depth
```

Masalah: `C4` ikut muncul walaupun relationship inactive.

### 31.3 Query Hanya Active Chain

```cypher
MATCH p = (:Person {id:'P1'})-[:OWNS|CONTROLS*1..4]->(company:Company)
WHERE all(r IN relationships(p) WHERE r.active = true)
RETURN company.id, company.name, length(p) AS depth, p
ORDER BY depth
```

### 31.4 Query dengan Ownership Strength

```cypher
MATCH p = (:Person {id:'P1'})-[:OWNS|CONTROLS*1..4]->(company:Company)
WHERE all(r IN relationships(p) WHERE r.active = true)
WITH company, p,
     reduce(minPct = 100.0, r IN relationships(p) |
       CASE WHEN r.percentage < minPct THEN r.percentage ELSE minPct END
     ) AS weakestControl
RETURN company.id, company.name, length(p) AS depth, weakestControl, p
ORDER BY weakestControl DESC, depth ASC
```

Interpretasi:

- path ke `C1` depth 1, control 80,
- path ke `C2` weakest control 60,
- path ke `C3` weakest control 55.

This is more meaningful than depth alone.

---

## 32. Mini Lab: Dependency Impact

### 32.1 Sample Data

```cypher
CREATE (api:Service {name:'case-api'});
CREATE (workflow:Service {name:'workflow-service'});
CREATE (notification:Service {name:'notification-service'});
CREATE (audit:Service {name:'audit-service'});
CREATE (db:Service {name:'case-db'});

MATCH (api:Service {name:'case-api'}), (workflow:Service {name:'workflow-service'})
CREATE (api)-[:DEPENDS_ON]->(workflow);

MATCH (workflow:Service {name:'workflow-service'}), (audit:Service {name:'audit-service'})
CREATE (workflow)-[:DEPENDS_ON]->(audit);

MATCH (notification:Service {name:'notification-service'}), (workflow:Service {name:'workflow-service'})
CREATE (notification)-[:DEPENDS_ON]->(workflow);

MATCH (workflow:Service {name:'workflow-service'}), (db:Service {name:'case-db'})
CREATE (workflow)-[:DEPENDS_ON]->(db);
```

### 32.2 Jika `case-db` Bermasalah, Siapa Terdampak?

```cypher
MATCH p = (:Service {name:'case-db'})<-[:DEPENDS_ON*1..5]-(affected:Service)
RETURN affected.name, length(p) AS distance, p
ORDER BY distance
```

### 32.3 Jika `case-api` Deploy, Apa Upstream Dependency-nya?

```cypher
MATCH p = (:Service {name:'case-api'})-[:DEPENDS_ON*1..5]->(dependency:Service)
RETURN dependency.name, length(p) AS distance, p
ORDER BY distance
```

Perhatikan arah traversal.

---

## 33. Mental Model untuk Java Engineer

Sebagai Java engineer, Anda bisa melihat Cypher path query seperti graph-specific repository method.

Buruk:

```java
List<Path> findAnyPath(String from, String to, int maxDepth);
```

Lebih baik:

```java
List<OwnershipPath> findActiveOwnershipPaths(PersonId owner, CompanyId target, int maxDepth);
List<RelatedCasePath> findRelatedOpenCases(CaseId caseId, int maxDepth);
List<DependencyImpactPath> findDownstreamImpact(ServiceName service, int maxDepth);
List<EffectivePermissionPath> findEffectivePermissionPaths(UserId user, ResourceId resource);
```

Nama method harus membawa semantics.

### 33.1 Repository Boundary

Jangan buat generic graph repository seperti:

```java
interface GraphRepository {
    List<Path> traverse(String startLabel, String startId, List<String> relTypes, int depth);
}
```

Ini menggoda, tetapi sering menjadi jalan menuju query liar.

Lebih baik:

```java
interface OwnershipGraphRepository {
    List<OwnershipPathDto> findActiveControlPaths(PersonId personId, int maxDepth);
    Optional<OwnershipPathDto> findShortestActiveControlPath(PersonId personId, CompanyId companyId);
}
```

Graph repository harus use-case aware.

### 33.2 Testing Path Query

Path query harus diuji dengan dataset kecil tetapi sengaja dibuat untuk edge cases:

- direct path,
- indirect path,
- no path,
- cycle,
- inactive relationship,
- duplicate relationship,
- high-degree node,
- multiple shortest paths,
- generic weak relationship,
- max depth boundary,
- self-loop.

Contoh test case:

```text
Given P1 owns C1, C1 controls C2, C2 controls C3
When findActiveControlPaths(P1, maxDepth=2)
Then C1 and C2 are returned, C3 is not returned
```

---

## 34. Failure Modelling: Apa yang Bisa Salah?

### 34.1 Query Timeout

Penyebab:

- depth terlalu besar,
- anchor terlalu luas,
- relationship type terlalu umum,
- supernode,
- missing index pada anchor,
- returning too many paths.

Mitigasi:

- cap depth,
- cap limit,
- validate anchor,
- precompute,
- use GDS/offline,
- add query timeout,
- monitor query plan.

### 34.2 Wrong Path Semantics

Penyebab:

- undirected traversal padahal direction penting,
- relationship type terlalu banyak,
- generic relationship ikut masuk,
- inactive relationship tidak difilter,
- temporal validity diabaikan.

Mitigasi:

- query review dengan domain expert,
- path examples dalam test,
- explainability output,
- relationship taxonomy yang jelas.

### 34.3 Path Explosion via Supernode

Penyebab:

- traversal melewati status/category/country/date node,
- high-degree group,
- popular merchant,
- public resource.

Mitigasi:

- hindari generic nodes dalam traversal,
- exclude certain labels,
- relationship partitioning,
- derived relationship,
- query-specific graph projection.

### 34.4 Inconsistent Decision Explanation

Penyebab:

- live graph berubah setelah decision,
- path tidak disimpan,
- data correction menghapus edge,
- derived edge stale.

Mitigasi:

- snapshot path evidence,
- record query version,
- preserve source facts,
- audit trail,
- temporal graph model.

### 34.5 Application Memory Blow-Up

Penyebab:

- returning raw path besar,
- driver buffering result,
- no streaming discipline,
- JSON response terlalu besar.

Mitigasi:

- projection DTO,
- result cap,
- pagination by target,
- path detail endpoint terpisah,
- streaming with care,
- response size limit.

---

## 35. Heuristics Top 1%: Cara Berpikir Saat Melihat Path Requirement

Ketika ada requirement graph path, jangan langsung tulis Cypher. Jalankan proses ini.

### 35.1 Step 1 — Definisikan Pertanyaan Domain

Buruk:

```text
Find related things.
```

Baik:

```text
Find open cases related to this case through shared subjects, shared evidence, or explicit escalation chain within 3 hops.
```

### 35.2 Step 2 — Definisikan Path yang Valid

Tuliskan relationship types yang boleh:

```text
Case -[:INVOLVES]-> Entity <-[:INVOLVES]- Case
Case -[:ESCALATED_TO]-> Case
Case -[:DERIVED_FROM]-> Case
```

Jangan masukkan relationship karena “mungkin berguna”.

### 35.3 Step 3 — Definisikan Boundary

- max depth,
- max result,
- time window,
- active only,
- tenant boundary,
- access control boundary,
- source reliability boundary.

### 35.4 Step 4 — Definisikan Output

Apakah output:

- target only,
- path explanation,
- path score,
- shortest path,
- all paths,
- grouped result,
- count only,
- existence only?

### 35.5 Step 5 — Definisikan Correctness

- Apakah duplicate path valid?
- Apakah cycle valid?
- Apakah inactive relationship valid?
- Apakah historical path valid?
- Apakah path harus reproducible?

### 35.6 Step 6 — Definisikan Execution Strategy

- Cypher online,
- Cypher batch,
- GDS projection,
- precompute,
- derived edge,
- external analytics.

### 35.7 Step 7 — Definisikan Failure Mode

- timeout,
- partial result,
- stale result,
- too many results,
- ambiguous path,
- unauthorized path leakage,
- audit reconstruction failure.

Top engineer bukan yang bisa menulis path query paling pendek. Top engineer adalah yang bisa membuat path query yang benar, bounded, explainable, testable, dan operable.

---

## 36. Ringkasan Part 005

Path adalah inti dari graph database. Tetapi path juga sumber kompleksitas terbesar.

Yang harus Anda bawa dari part ini:

1. Path bukan sekadar join chain; path sering menjadi evidence domain.
2. Fixed-length traversal lebih aman jika pertanyaan domain memang spesifik.
3. Variable-length traversal harus bounded secara depth, relationship type, direction, dan anchor.
4. Path explosion adalah konsekuensi matematis fan-out, bukan kekurangan Neo4j semata.
5. Direction dan relationship type adalah bagian dari semantics, bukan detail sintaks.
6. `length(p)`, `nodes(p)`, dan `relationships(p)` membantu projection dan explainability.
7. Filtering setelah ekspansi bisa tetap mahal; desain model dan relationship type bisa membantu mempersempit traversal.
8. Shortest path tidak selalu best path.
9. Weighted path dan global graph algorithms sering lebih cocok di GDS.
10. Untuk production Java service, path APIs harus use-case-specific dan diberi guardrail.
11. Untuk regulatory/audit-heavy system, live path dan snapshot path harus dibedakan.
12. Jangan expose traversal liar ke user atau API consumer.

---

## 37. Latihan Mandiri

### Latihan 1 — Ownership Chain

Buat graph ownership 5 level dengan satu inactive edge. Tulis query untuk:

1. semua controlled companies,
2. hanya active chain,
3. shortest active chain ke target company,
4. company dengan weakest control percentage di bawah 50%.

### Latihan 2 — Related Case Discovery

Modelkan:

```text
Case, Person, Company, Evidence
```

Relationship:

```text
Case INVOLVES Person
Case INVOLVES Company
Evidence SUPPORTS Case
Evidence MENTIONS Person
Evidence MENTIONS Company
Case ESCALATED_TO Case
```

Tulis 3 query:

1. case terkait via shared involved entity,
2. case terkait via shared evidence mention,
3. case terkait via escalation chain maksimal 4 hop.

Bandingkan semantics tiap path.

### Latihan 3 — Dependency Impact

Modelkan service dependency dengan cycle. Tulis query untuk:

1. upstream dependency,
2. downstream impact,
3. cycle detection sampai 8 hop,
4. exclude dependency yang `deprecated = true`.

### Latihan 4 — IAM Effective Permission

Modelkan user, group, role, permission, resource. Tulis query untuk:

1. effective permission user,
2. explanation path untuk permission tertentu,
3. group nesting maksimal 5,
4. toxic combination: user punya `APPROVE_PAYMENT` dan `CREATE_PAYMENT`.

### Latihan 5 — Query Review

Ambil query ini:

```cypher
MATCH p = (a)-[*1..6]-(b)
RETURN p
LIMIT 100
```

Tuliskan minimal 15 alasan mengapa query ini buruk untuk production, lalu rewrite menjadi 3 query use-case-specific.

---

## 38. Referensi Resmi yang Relevan

Gunakan referensi resmi ini untuk memperdalam detail sintaks dan perilaku aktual sesuai versi Neo4j yang Anda pakai:

1. Neo4j Cypher Manual — Patterns  
   https://neo4j.com/docs/cypher-manual/current/patterns/

2. Neo4j Cypher Manual — Variable-length paths / quantified path patterns  
   https://neo4j.com/docs/cypher-manual/current/patterns/variable-length-paths/

3. Neo4j Cypher Manual — Shortest paths  
   https://neo4j.com/docs/cypher-manual/current/patterns/shortest-paths/

4. Neo4j Cypher Manual — Syntax and semantics for patterns  
   https://neo4j.com/docs/cypher-manual/current/patterns/reference/

5. Neo4j Cypher Manual — Path pattern expressions  
   https://neo4j.com/docs/cypher-manual/current/expressions/predicates/path-pattern-expressions/

6. Neo4j Graph Data Science — Graph algorithms  
   https://neo4j.com/docs/graph-data-science/current/algorithms/

7. Neo4j Graph Data Science — Dijkstra Source-Target Shortest Path  
   https://neo4j.com/docs/graph-data-science/current/algorithms/dijkstra-source-target/

8. Neo4j Graph Data Science — A* Shortest Path  
   https://neo4j.com/docs/graph-data-science/current/algorithms/astar/

---

## 39. Penutup

Part ini membahas salah satu kemampuan paling kuat sekaligus paling berbahaya di graph database: path traversal.

Jika Anda hanya mengingat satu kalimat, ingat ini:

> Graph query yang baik bukan query yang bisa berjalan di semua arah, tetapi query yang hanya berjalan di jalur yang punya makna domain, boundary jelas, dan output yang bisa dijelaskan.

Pada part berikutnya, kita akan naik satu level dari query syntax ke methodology:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-006.md
```

Topik berikutnya:

```text
Graph Modelling Methodology: From Requirements to Graph Shape
```

Di sana kita akan membahas cara sistematis mengubah requirement menjadi graph model: mulai dari pertanyaan, path yang harus murah, relationship taxonomy, cardinality analysis, mutation pattern, hingga model validation checklist.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-004.md">⬅️ Part 004 — Cypher Fundamentals: Pattern Matching as a Query Language</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-006.md">Part 006 — Graph Modelling Methodology: From Requirements to Graph Shape ➡️</a>
</div>
