# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-022.md

# Part 022 — Centrality, Influence, and Importance Algorithms

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami graph database dan Neo4j sampai level arsitektural, modelling, operasional, dan analytical.  
> Fokus bagian ini: memahami centrality sebagai keluarga algoritma untuk mengukur “posisi penting” node dalam network, bukan sebagai angka sakti yang otomatis berarti “paling benar”, “paling berbahaya”, atau “paling bernilai”.

---

## 0. Posisi Part Ini dalam Seri

Sebelumnya kita sudah membahas:

- operational graph vs analytical graph,
- GDS projection,
- execution modes: `stream`, `stats`, `mutate`, `write`,
- memory estimation,
- lifecycle algorithm,
- risiko memakai graph algorithm tanpa interpretasi domain.

Bagian ini masuk ke kelas algoritma pertama: **centrality**.

Centrality menjawab pertanyaan seperti:

- node mana yang paling terhubung?
- node mana yang paling sering menjadi jembatan antar bagian graph?
- node mana yang paling cepat menjangkau node lain?
- node mana yang “penting” karena terhubung ke node lain yang juga penting?
- node mana yang jika terganggu dapat memengaruhi aliran, akses, dependency, atau risiko?

Tetapi pertanyaan yang lebih penting adalah:

> “Penting menurut definisi apa?”

Centrality bukan satu metrik tunggal. Centrality adalah keluarga metrik. Masing-masing metrik punya asumsi tentang apa arti “penting”.

---

## 1. Mental Model: Centrality Bukan Popularity Saja

Dalam sistem biasa, engineer sering mengukur entity dengan atribut:

```text
customer.revenue
case.severity
account.balance
service.cpu_usage
transaction.amount
user.login_count
```

Di graph, nilai node sering tidak hanya berasal dari atribut node itu sendiri, tetapi dari **posisinya dalam jaringan**.

Contoh:

```text
Akun A mungkin tidak punya saldo besar,
tetapi menjadi penghubung banyak akun berisiko tinggi.
```

```text
Case B mungkin bukan case dengan severity tertinggi,
tetapi menjadi titik koneksi antara banyak case lain, entitas legal, bukti, dan pola pelanggaran.
```

```text
Microservice C mungkin tidak menerima traffic terbesar,
tetapi semua proses settlement melewatinya.
```

```text
Pegawai D mungkin bukan manager tertinggi,
tetapi punya akses ke banyak sistem sensitif dan menjadi approver lintas unit.
```

Centrality mencoba mengukur aspek-aspek seperti ini.

Namun, centrality selalu punya konteks:

```text
High centrality in social graph       != high centrality in payment graph
High centrality in communication flow != high centrality in legal responsibility
High centrality in dependency graph   != high centrality in business value
High centrality in evidence graph     != proof of wrongdoing
```

Maka aturan pertama:

> Centrality score harus dibaca sebagai sinyal posisi graph, bukan keputusan final.

---

## 2. Centrality sebagai Pertanyaan Engineering

Jangan mulai dari algoritma. Mulai dari pertanyaan.

Pertanyaan yang salah:

```text
“Kita pakai PageRank supaya terlihat advanced.”
```

Pertanyaan yang lebih baik:

```text
“Dalam network ini, node seperti apa yang ingin kita anggap penting?”
```

Contoh framing:

| Domain | Pertanyaan | Kemungkinan centrality |
|---|---|---|
| Fraud | Entity mana yang menghubungkan banyak cluster mencurigakan? | Betweenness |
| Recommendation | Item mana yang mendapat sinyal dari user penting? | PageRank / Personalized PageRank |
| Dependency graph | Service mana yang paling banyak dipakai langsung? | Degree / weighted degree |
| IAM | User/group mana yang menjembatani akses lintas domain? | Betweenness / articulation points |
| Case management | Case mana yang menjadi hub dari banyak evidence/entity? | Degree / PageRank |
| Supply chain | Supplier mana yang paling kritikal untuk jalur produksi? | Betweenness / closeness |
| Investigation | Person/entity mana yang paling dekat ke banyak target? | Closeness / harmonic centrality |

Pertanyaan domain menentukan metrik.

---

## 3. Graph Projection untuk Centrality

Sebelum menjalankan centrality, kita harus bertanya:

```text
Graph apa yang sedang dianalisis?
```

Operational database mungkin punya model kaya:

```text
(:Person)-[:OWNS]->(:Company)
(:Person)-[:DIRECTOR_OF]->(:Company)
(:Company)-[:TRANSACTS_WITH]->(:Company)
(:Person)-[:SUBJECT_OF]->(:Case)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Evidence)-[:MENTIONS]->(:Person)
(:Case)-[:VIOLATES]->(:Regulation)
```

Tetapi centrality tidak selalu dijalankan atas semua relationship.

Projection yang berbeda menghasilkan makna skor yang berbeda.

### 3.1 Projection: ownership influence

```cypher
MATCH (p:Person)-[:OWNS|CONTROLS]->(c:Company)
RETURN p, c
```

Skor centrality di sini bicara tentang pengaruh kepemilikan/kontrol.

### 3.2 Projection: transaction network

```cypher
MATCH (a:Account)-[:SENT_TO]->(b:Account)
RETURN a, b
```

Skor centrality di sini bicara tentang posisi dalam arus transaksi.

### 3.3 Projection: case-evidence network

```cypher
MATCH (c:Case)-[:SUPPORTED_BY]->(e:Evidence)-[:MENTIONS]->(x)
RETURN c, e, x
```

Skor centrality di sini bicara tentang keterhubungan investigatif, bukan financial flow.

### 3.4 Kesalahan umum

Kesalahan besar adalah menjalankan centrality atas graph campuran tanpa semantik jelas:

```text
Person --owns--> Company
Company --transacts--> Company
Case --mentions--> Person
Officer --reviews--> Case
Document --attached_to--> Case
User --assigned_to--> Role
```

Lalu mengambil hasil:

```text
Top 10 important nodes
```

Masalahnya: important in what sense?

Jika relationship heterogen dicampur tanpa normalisasi semantik, skor bisa tidak punya arti domain yang stabil.

---

## 4. Weighted vs Unweighted Centrality

Banyak network punya bobot.

Contoh bobot:

```text
transaction_amount
transaction_count
ownership_percentage
confidence_score
risk_score
access_frequency
dependency_call_count
shipment_volume
case_link_strength
```

Ada dua interpretasi bobot yang sering tertukar:

### 4.1 Weight sebagai strength

Semakin besar bobot, semakin kuat hubungan.

```text
(:Account)-[:SENT_TO {amount: 9000000}]->(:Account)
```

Jika amount besar berarti relationship lebih kuat, maka algoritma harus memperlakukan weight sebagai strength.

### 4.2 Weight sebagai cost/distance

Semakin besar bobot, semakin mahal/jauh hubungan.

```text
(:Location)-[:ROUTE_TO {travelTimeMinutes: 480}]->(:Location)
```

Jika travel time besar berarti jarak lebih besar, maka bobot berarti cost.

Centrality tertentu memakai weight dengan interpretasi tertentu. Jangan asal memasukkan property numeric ke `relationshipWeightProperty` tanpa memahami apakah algoritma menganggap bobot sebagai strength, probability, cost, atau distance.

### 4.3 Normalisasi bobot

Raw business values sering buruk untuk algoritma.

Contoh:

```text
transaction amount: 10 sampai 10,000,000,000
ownership percentage: 0.01 sampai 1.0
confidence score: 0 sampai 1
call count: 0 sampai 50,000,000
```

Jika digabung atau dibandingkan langsung, skala besar mendominasi.

Gunakan normalisasi:

```text
log(amount + 1)
min-max normalization
z-score normalization
bucketed weight
capped weight
business calibrated score
```

Contoh derived weight:

```cypher
MATCH (a:Account)-[r:SENT_TO]->(b:Account)
SET r.centralityWeight = log10(r.totalAmount + 1)
```

Atau:

```cypher
MATCH (p:Person)-[r:OWNS]->(c:Company)
SET r.centralityWeight = r.ownershipPercentage
```

Tetapi jangan lupa:

> Bobot bukan fakta netral. Bobot adalah modelling decision.

---

## 5. Direction Matters

Graph relationship di Neo4j punya arah. Banyak algoritma bisa dikonfigurasi untuk orientation tertentu pada projection.

Arah mengubah makna.

Contoh transaction graph:

```text
A -> B berarti A mengirim ke B
```

Centrality inbound bisa berarti:

```text
banyak pihak mengirim ke node ini
```

Centrality outbound bisa berarti:

```text
node ini mengirim ke banyak pihak
```

Undirected bisa berarti:

```text
terhubung secara finansial tanpa peduli arah aliran
```

Dalam fraud analysis, ketiganya berbeda:

- inbound hub: collector account,
- outbound hub: distributor account,
- undirected hub: highly connected account,
- bridge account: account yang menghubungkan cluster.

Dalam IAM:

```text
(:User)-[:MEMBER_OF]->(:Group)-[:GRANTS]->(:Permission)
```

Arah traversal menentukan apakah kita sedang mencari:

- permission yang dimiliki user,
- user yang terkena permission,
- group yang menjadi jembatan,
- resource yang paling banyak terekspos.

Aturan:

> Selalu tulis interpretasi direction sebelum menjalankan centrality.

---

## 6. Degree Centrality

Degree centrality adalah metrik paling sederhana: seberapa banyak hubungan langsung yang dimiliki node.

Dalam graph tak berarah:

```text
degree(node) = jumlah relationship yang incident ke node
```

Dalam graph berarah:

```text
in-degree  = jumlah relationship masuk
out-degree = jumlah relationship keluar
```

### 6.1 Mental model

Degree menjawab:

```text
Node mana yang punya koneksi langsung terbanyak?
```

Ini bagus untuk mendeteksi:

- hub,
- supernode,
- popular entity,
- high-touch account,
- high-exposure resource,
- high-fanout dependency,
- highly linked case.

### 6.2 Contoh domain

#### Fraud transaction

```text
High in-degree account:
- banyak account mengirim ke account ini
- bisa berarti merchant populer
- bisa berarti collector account
- bisa berarti payroll account
- bisa berarti fraud mule account
```

Skor tidak cukup. Butuh context.

#### Case management

```text
High degree case:
- banyak evidence
- banyak subject
- banyak regulation
- banyak related case
```

Bisa berarti case kompleks, tetapi bisa juga case dummy yang dipakai untuk aggregate data secara salah.

#### Microservice dependency

```text
High in-degree service:
- banyak service bergantung ke service ini
```

Bisa berarti critical shared service.

```text
High out-degree service:
- service ini memanggil banyak service lain
```

Bisa berarti orchestration service atau bad coupling.

### 6.3 Cypher sederhana tanpa GDS

Untuk degree sederhana, Cypher biasa sering cukup.

```cypher
MATCH (a:Account)<-[r:SENT_TO]-(:Account)
RETURN a.accountId AS accountId, count(r) AS inDegree
ORDER BY inDegree DESC
LIMIT 20;
```

Outbound:

```cypher
MATCH (a:Account)-[r:SENT_TO]->(:Account)
RETURN a.accountId AS accountId, count(r) AS outDegree
ORDER BY outDegree DESC
LIMIT 20;
```

Undirected:

```cypher
MATCH (a:Account)-[r:SENT_TO]-(:Account)
RETURN a.accountId AS accountId, count(r) AS degree
ORDER BY degree DESC
LIMIT 20;
```

### 6.4 Weighted degree

```cypher
MATCH (a:Account)-[r:SENT_TO]->(:Account)
RETURN a.accountId AS accountId,
       count(r) AS outDegree,
       sum(r.totalAmount) AS totalSent,
       sum(log10(r.totalAmount + 1)) AS weightedOutDegree
ORDER BY weightedOutDegree DESC
LIMIT 20;
```

### 6.5 Kapan degree misleading

Degree bisa menipu ketika:

- graph punya supernode natural seperti `Country`, `Category`, `Unknown`, `Cash`, `Internet`, `DefaultRole`,
- high degree disebabkan data ingestion bug,
- relationship heterogen dicampur,
- node populer tapi tidak risk-relevant,
- duplicate relationship belum didedup,
- degree tinggi karena data lama menumpuk tanpa time window.

Contoh:

```text
(:Person {name: "Unknown"})
```

Jika semua data tidak lengkap diarahkan ke node `Unknown`, node itu akan sangat central tapi tidak berarti.

### 6.6 Checklist degree centrality

Sebelum memakai degree:

```text
[ ] Relationship type jelas?
[ ] Direction jelas?
[ ] Duplicate edge sudah ditangani?
[ ] Ada time window?
[ ] Supernode natural dikecualikan atau diperlakukan khusus?
[ ] Degree tinggi punya makna domain?
[ ] High degree adalah sinyal, bukan label final?
```

---

## 7. PageRank

PageRank mengukur importance berdasarkan struktur link: node dianggap penting jika ia menerima hubungan dari node yang juga penting.

Mental model:

```text
Tidak semua koneksi bernilai sama.
Koneksi dari node penting memberi sinyal lebih kuat daripada koneksi dari node tidak penting.
```

### 7.1 Perbedaan PageRank dan degree

Degree:

```text
Berapa banyak koneksi langsung?
```

PageRank:

```text
Seberapa penting node berdasarkan koneksi dari node lain yang juga penting?
```

Contoh:

```text
Node A punya 100 koneksi dari node kecil.
Node B punya 5 koneksi dari node sangat penting.
```

Degree mungkin memilih A. PageRank bisa memilih B.

### 7.2 Damping factor

PageRank biasanya memakai konsep damping factor.

Mental model:

```text
Seorang random walker mengikuti relationship dengan probabilitas tertentu,
dan kadang “teleport” ke node lain.
```

Damping factor tinggi berarti lebih mengikuti struktur graph. Damping factor rendah berarti lebih banyak random reset.

Default umum sering sekitar 0.85, tetapi jangan perlakukan angka default sebagai hukum universal.

### 7.3 PageRank untuk fraud/risk

Dalam transaction network, PageRank bisa membantu menemukan akun yang menerima “importance” dari akun lain.

Namun interpretasinya tergantung arah projection.

Jika projection:

```text
Account A -> Account B berarti A mengirim uang ke B
```

PageRank tinggi pada B bisa berarti:

```text
B menerima aliran dari akun-akun yang juga penting dalam network.
```

Tetapi bukan otomatis fraud.

B bisa berupa:

- merchant besar,
- payment processor,
- tax authority,
- payroll account,
- charity campaign,
- fraud collector,
- exchange account.

Butuh feature tambahan:

```text
account age
KYC quality
jurisdiction
counterparty risk
velocity
round amount behavior
burst pattern
device overlap
case history
known suspicious association
```

### 7.4 PageRank untuk case graph

Dalam case graph:

```text
(:Case)-[:MENTIONS]->(:Person)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Evidence)-[:REFERENCES]->(:Organization)
(:Organization)-[:RELATED_TO]->(:Person)
```

PageRank bisa mengangkat entity yang muncul dalam konteks banyak case/evidence penting.

Tetapi jangan menyimpulkan:

```text
High PageRank = guilty
```

Interpretasi yang defensible:

```text
High PageRank = entity structurally prominent in the investigation graph.
```

### 7.5 PageRank execution dengan GDS

Contoh konseptual:

```cypher
CALL gds.graph.project(
  'accountFlowGraph',
  'Account',
  {
    SENT_TO: {
      type: 'SENT_TO',
      orientation: 'NATURAL',
      properties: 'centralityWeight'
    }
  }
);
```

Stream result:

```cypher
CALL gds.pageRank.stream('accountFlowGraph', {
  relationshipWeightProperty: 'centralityWeight',
  maxIterations: 20,
  dampingFactor: 0.85
})
YIELD nodeId, score
RETURN gds.util.asNode(nodeId).accountId AS accountId, score
ORDER BY score DESC
LIMIT 20;
```

Mutate result ke in-memory graph:

```cypher
CALL gds.pageRank.mutate('accountFlowGraph', {
  relationshipWeightProperty: 'centralityWeight',
  mutateProperty: 'pageRankScore'
})
YIELD nodePropertiesWritten, ranIterations;
```

Write result ke Neo4j database:

```cypher
CALL gds.pageRank.write('accountFlowGraph', {
  relationshipWeightProperty: 'centralityWeight',
  writeProperty: 'pageRankScore'
})
YIELD nodePropertiesWritten, ranIterations;
```

### 7.6 Personalized PageRank

Personalized PageRank mengubah pertanyaan dari:

```text
Node mana yang penting secara global?
```

menjadi:

```text
Node mana yang penting relatif terhadap seed node tertentu?
```

Ini berguna untuk:

- recommendation,
- related entity discovery,
- investigation expansion,
- “find entities near this suspicious account but weighted by graph structure”.

Mental model:

```text
Importance from the perspective of this starting context.
```

Contoh investigasi:

```text
Seed = known suspicious account
Personalized PageRank = entities structurally relevant around that account
```

Tetapi harus dijaga agar tidak menjadi guilt-by-association tanpa evidence.

### 7.7 PageRank failure modes

PageRank bisa misleading ketika:

- graph direction salah,
- relationship type terlalu heterogen,
- high-volume legitimate hubs mendominasi,
- weight tidak dinormalisasi,
- stale historical data membuat node lama selalu menang,
- graph disconnected dan interpretasi global dipaksakan,
- score dipakai sebagai keputusan tanpa explanation.

### 7.8 Checklist PageRank

```text
[ ] Apa arti link sebagai “vote” atau transfer importance?
[ ] Direction sudah benar?
[ ] Relationship weight bermakna strength?
[ ] High-volume legitimate hubs ditangani?
[ ] Ada time window atau decay?
[ ] Score dibandingkan antar graph projection yang sama?
[ ] Ada explanation path/entity supporting context?
```

---

## 8. Betweenness Centrality

Betweenness centrality mengukur seberapa sering sebuah node berada pada shortest paths antara node-node lain.

Mental model:

```text
Node ini menjadi jembatan atau broker antar bagian network.
```

Jika node dihapus, aliran antar cluster mungkin terganggu.

### 8.1 Pertanyaan yang dijawab

Betweenness menjawab:

```text
Node mana yang menjadi perantara penting antara kelompok berbeda?
```

Bagus untuk:

- bridge account,
- broker entity,
- intermediary company,
- shared service,
- cross-domain group in IAM,
- chokepoint dependency,
- supply chain bottleneck,
- case connector.

### 8.2 Contoh fraud

Bayangkan dua fraud ring yang tampak terpisah:

```text
Cluster A: A1, A2, A3, A4
Cluster B: B1, B2, B3, B4
```

Ada satu account X yang bertransaksi dengan keduanya.

Degree X mungkin tidak tertinggi. Tetapi X bisa punya betweenness tinggi karena ia menghubungkan dua cluster.

Interpretasi:

```text
X adalah bridge candidate, bukan otomatis fraudster.
```

### 8.3 Contoh IAM

```text
User -> Group -> Role -> Permission -> Resource
```

Group tertentu mungkin menjadi jembatan antara banyak user dan permission sensitif.

Betweenness tinggi pada group bisa menandakan:

- group terlalu umum,
- access aggregation terlalu luas,
- toxic entitlement hub,
- privilege escalation path.

### 8.4 Contoh dependency graph

Service X mungkin bukan service dengan traffic terbesar, tetapi semua path dari frontend ke settlement melewati X.

Jika X gagal, blast radius besar.

Betweenness bisa membantu menemukan chokepoint.

### 8.5 Computational cost

Betweenness biasanya lebih mahal dibanding degree dan PageRank. Karena ia terkait shortest paths antar banyak pasangan node.

Implication:

```text
Jangan jalankan betweenness besar-besaran di graph production tanpa projection, sampling, memory estimation, dan workload planning.
```

Gunakan:

- subgraph projection,
- time window,
- component filtering,
- approximation jika tersedia/cocok,
- offline/batch mode,
- resource-isolated analytics environment.

### 8.6 GDS example

```cypher
CALL gds.graph.project(
  'caseEntityGraph',
  ['Case', 'Person', 'Organization'],
  {
    MENTIONS: { orientation: 'UNDIRECTED' },
    RELATED_TO: { orientation: 'UNDIRECTED' },
    CONTROLS: { orientation: 'UNDIRECTED' }
  }
);
```

```cypher
CALL gds.betweenness.stream('caseEntityGraph')
YIELD nodeId, score
RETURN labels(gds.util.asNode(nodeId)) AS labels,
       gds.util.asNode(nodeId).id AS id,
       score
ORDER BY score DESC
LIMIT 20;
```

### 8.7 Betweenness failure modes

Betweenness bisa menipu ketika:

- graph punya artificial connector nodes,
- semua entity incomplete diarahkan ke `Unknown`,
- node aggregate seperti `AllCases2025` ada di traversal,
- shortest path tidak merepresentasikan aliran nyata,
- graph terlalu sparse sehingga bridge muncul karena data belum lengkap,
- relationship direction diabaikan padahal flow directional,
- time dimension dicampur sehingga node menjadi bridge historis tapi tidak sekarang.

### 8.8 Defensible interpretation

Buruk:

```text
“Node ini berbahaya karena betweenness tinggi.”
```

Lebih baik:

```text
“Node ini menempati posisi perantara dalam projected transaction network periode 2026-Q1. Ia muncul pada banyak shortest paths antara account cluster yang berbeda. Ini membuatnya kandidat prioritas untuk review, bukan bukti pelanggaran.”
```

---

## 9. Closeness Centrality

Closeness centrality mengukur seberapa dekat sebuah node ke node-node lain dalam graph berdasarkan jarak shortest path.

Mental model:

```text
Node ini bisa menjangkau banyak node lain dengan sedikit langkah.
```

### 9.1 Pertanyaan yang dijawab

Closeness menjawab:

```text
Node mana yang secara struktural paling dekat ke seluruh network?
```

Bagus untuk:

- penyebaran informasi,
- network reachability,
- incident propagation,
- influence diffusion,
- proximity to many suspicious entities,
- service dependency reachability.

### 9.2 Contoh regulatory investigation

Misalnya kita punya graph:

```text
(:Entity)-[:ASSOCIATED_WITH]-(:Entity)
(:Entity)-[:SUBJECT_OF]-(:Case)
(:Case)-[:RELATED_TO]-(:Case)
```

Node dengan closeness tinggi mungkin dapat menjangkau banyak entity/case dengan path pendek.

Interpretasi:

```text
Entity ini berada di posisi yang dekat terhadap banyak entity/case dalam network investigasi.
```

Bukan:

```text
Entity ini paling bersalah.
```

### 9.3 Disconnected graph problem

Closeness punya masalah besar pada graph yang disconnected.

Jika node tidak dapat menjangkau banyak node lain, bagaimana menghitung jarak?

Dalam graph real-world, disconnected components sangat umum.

Contoh:

```text
Component 1: 10 juta transaction nodes
Component 2: 200 ribu case nodes
Component 3: 5 ribu isolated entities
```

Closeness global bisa sulit dibaca.

Solusi:

- hitung per connected component,
- gunakan harmonic centrality,
- filter component relevan,
- gunakan seed-based distance,
- batasi domain projection.

### 9.4 Harmonic centrality

Harmonic centrality sering lebih robust untuk disconnected graph karena memakai kebalikan jarak dan unreachable node berkontribusi nol.

Mental model:

```text
Node mendapat skor tinggi jika dekat ke banyak node yang reachable,
tanpa rusak total karena ada node unreachable.
```

### 9.5 Closeness failure modes

Closeness bisa misleading ketika:

- graph disconnected,
- relationship tidak merepresentasikan traversability nyata,
- high closeness muncul karena artificial hub,
- semua relationship dianggap cost sama padahal tidak,
- direction diabaikan,
- closeness global dipakai untuk problem lokal.

---

## 10. Eigenvector Centrality dan HITS

Eigenvector centrality mirip dengan gagasan:

```text
Node penting jika terhubung ke node penting.
```

PageRank bisa dianggap varian yang lebih stabil/praktis untuk banyak graph directed dengan damping.

HITS membedakan dua konsep:

```text
Hub      = node yang menunjuk ke banyak authority
Authority = node yang ditunjuk oleh banyak hub
```

### 10.1 Kapan berguna

HITS berguna ketika relasi punya interpretasi seperti:

```text
source recommends target
page links to page
user endorses item
document cites document
account refers to beneficiary
```

Dalam graph access:

```text
Group -> Permission
```

Group bisa dilihat sebagai hub, permission/resource sebagai authority. Tetapi interpretasi ini harus hati-hati.

### 10.2 Failure mode

Eigenvector/HITS bisa bias terhadap cluster padat dan reciprocal reinforcement.

Jika ada community besar yang saling terhubung, skor bisa terkonsentrasi di sana walaupun tidak relevan dengan risk domain.

---

## 11. Articulation Points dan Bridges

Beberapa centrality-related algorithms tidak hanya memberi skor, tetapi mendeteksi struktur kritikal.

### 11.1 Articulation point

Articulation point adalah node yang jika dihapus dapat memecah graph menjadi lebih banyak komponen.

Mental model:

```text
Node ini adalah titik sambung struktural.
```

Use case:

- dependency graph,
- network resilience,
- supply chain dependency,
- IAM group bridging,
- fraud ring connector,
- case graph connector.

### 11.2 Bridge

Bridge adalah relationship/edge yang jika dihapus memecah konektivitas.

Mental model:

```text
Relationship ini adalah koneksi kritikal antar bagian graph.
```

Use case:

- satu supplier relationship yang menghubungkan supply chain,
- satu entitlement edge yang memberi akses sensitif,
- satu control relationship yang menghubungkan entity ke network risiko,
- satu transaction channel antar cluster.

### 11.3 Why this matters

Dalam banyak sistem production, pertanyaan resilience lebih konkret daripada “siapa paling penting?”

Contoh:

```text
Jika node/edge ini dihapus, apa yang terputus?
```

Ini sangat berguna untuk:

- blast radius,
- operational resilience,
- policy review,
- investigation prioritization,
- remediation planning.

---

## 12. Centrality dengan Time Window

Graph tanpa waktu sering menipu.

Contoh:

```text
Account A punya degree tinggi sepanjang 5 tahun.
```

Tetapi yang kita butuhkan:

```text
Account mana yang degree-nya meningkat tajam minggu ini?
```

Atau:

```text
Entity mana yang baru menjadi bridge antara dua cluster dalam 30 hari terakhir?
```

### 12.1 Time-windowed projection

```cypher
MATCH (a:Account)-[r:SENT_TO]->(b:Account)
WHERE r.txDate >= date('2026-01-01')
  AND r.txDate < date('2026-04-01')
RETURN gds.graph.project(
  'txGraph2026Q1',
  a,
  b,
  {
    relationshipType: 'SENT_TO',
    relationshipProperties: r { .centralityWeight }
  }
);
```

Conceptual only; exact projection syntax depends on Neo4j/GDS version and preferred projection style.

### 12.2 Delta centrality

Lebih berharga daripada skor absolut:

```text
score_current_window - score_previous_window
```

Contoh:

```text
PageRank naik 800% dalam 7 hari.
Betweenness muncul dari nol menjadi top 1%.
In-degree naik drastis dari 4 ke 900 counterparties.
```

Delta sering lebih actionable untuk monitoring risiko.

### 12.3 Decay

Historical relationship bisa diberi decay:

```text
recent transaction lebih berat daripada transaksi lama
```

Contoh sederhana:

```text
weight = log(amount + 1) * recencyFactor
```

Recency factor:

```text
1.0 untuk <= 7 hari
0.7 untuk <= 30 hari
0.3 untuk <= 90 hari
0.1 untuk lebih lama
```

Atau exponential decay.

---

## 13. Centrality dalam Regulatory / Enforcement Context

Dalam sistem enforcement, centrality sangat menarik tetapi juga berbahaya jika dipakai tanpa governance.

### 13.1 Use case yang masuk akal

Centrality dapat membantu:

- prioritization,
- triage,
- related-party discovery,
- investigation expansion,
- conflict-of-interest detection,
- repeat-offender network analysis,
- case clustering,
- network risk scoring,
- escalation support.

### 13.2 Use case yang harus hati-hati

Centrality tidak boleh langsung menjadi:

- proof of violation,
- automatic enforcement action,
- sole reason for sanction,
- opaque risk decision,
- unreviewable blacklist.

### 13.3 Defensible language

Gunakan bahasa seperti:

```text
“Structural prominence”
“Network position”
“Bridge candidate”
“Review priority signal”
“Connectivity-based indicator”
“Investigation expansion candidate”
```

Hindari bahasa seperti:

```text
“Guilty score”
“Fraud score” tanpa evidence model
“Bad actor ranking”
“Proof by association”
```

### 13.4 Evidence separation

Centrality adalah signal layer.

Evidence adalah fact layer.

Decision adalah adjudication layer.

Jangan campur:

```text
centrality score != evidence
centrality score != legal conclusion
centrality score != policy violation
```

Arsitektur yang lebih defensible:

```text
Graph facts
  -> analytical signals
  -> explanation package
  -> human review
  -> decision record
  -> audit trail
```

---

## 14. Centrality sebagai Feature Engineering

Centrality sering dipakai sebagai feature untuk ML/risk model.

Contoh features:

```text
accountInDegree7d
accountOutDegree7d
accountWeightedPageRank30d
accountBetweenness90d
entityHarmonicCentrality365d
caseEvidenceDegree
resourceAccessPageRank
serviceDependencyBetweenness
```

### 14.1 Jangan leak label

Feature leakage terjadi jika graph mengandung informasi masa depan.

Contoh buruk:

```text
Model prediksi fraud per 2026-01-01,
tetapi centrality dihitung memakai transaksi sampai 2026-03-01.
```

Ini membuat model terlihat akurat saat training tapi gagal di production.

### 14.2 Snapshot discipline

Untuk feature engineering:

```text
feature_timestamp <= prediction_timestamp
```

Simpan:

```text
graph_version
projection_name
projection_query_hash
algorithm_name
algorithm_version
configuration
input_time_window
score_timestamp
```

### 14.3 Explainability

Jika centrality feature memengaruhi model, siapkan explanation:

```text
Why was this score high?
Which graph projection?
Which relationship types?
Which time window?
Which neighboring entities contribute?
What changed since previous window?
```

---

## 15. Centrality in Java Architecture

Centrality biasanya bukan logic request-response biasa.

Ada beberapa pola.

### 15.1 Offline batch scoring

```text
Scheduler / orchestration
  -> project graph
  -> estimate memory
  -> run algorithm
  -> write scores
  -> validate distribution
  -> publish score version
```

Cocok untuk:

- nightly risk scoring,
- weekly entitlement review,
- monthly supply chain criticality,
- case prioritization batch.

### 15.2 Near-real-time scoring

```text
Event stream
  -> update graph
  -> periodically recompute affected subgraph
  -> update score cache/materialized property
```

Hati-hati: banyak centrality tidak incremental sederhana.

### 15.3 On-demand investigation scoring

```text
Investigator selects seed entity
  -> build local projection
  -> run Personalized PageRank / local centrality
  -> stream results
  -> show explanation
```

Cocok untuk exploratory analysis, bukan high-throughput API.

### 15.4 Java service boundary

Jangan buat controller seperti ini:

```java
@GetMapping("/centrality/run")
public List<Result> runPageRank() { ... }
```

Itu berbahaya karena centrality bisa mahal.

Lebih baik:

```text
POST /graph-analytics/jobs
GET  /graph-analytics/jobs/{jobId}
GET  /graph-analytics/scores/{scoreVersion}/entities/{entityId}
```

Dengan job metadata:

```text
jobId
projectionName
algorithm
configuration
requestedBy
startedAt
finishedAt
status
inputWindow
scoreVersion
memoryEstimate
nodeCount
relationshipCount
warnings
```

### 15.5 Example Java domain objects

```java
public record CentralityScore(
    String entityId,
    String entityType,
    String algorithm,
    String projection,
    String scoreVersion,
    double score,
    Instant calculatedAt
) {}
```

```java
public record GraphAnalyticsJobRequest(
    String projectionName,
    String algorithm,
    Map<String, Object> configuration,
    LocalDate fromDate,
    LocalDate toDate
) {}
```

```java
public enum GraphAnalyticsJobStatus {
    SUBMITTED,
    MEMORY_ESTIMATED,
    RUNNING,
    VALIDATING,
    COMPLETED,
    FAILED,
    CANCELLED
}
```

### 15.6 Error handling

Handle:

```text
projection not found
insufficient memory
algorithm unsupported for graph shape
invalid relationship weight
timeout
cluster routing failure
score write failure
partial validation failure
```

Centrality pipeline should be observable and repeatable.

---

## 16. Score Distribution and Validation

Jangan hanya lihat top 10.

Lihat distribusi.

Pertanyaan validasi:

```text
Apakah skor sangat skewed?
Apakah satu node mendominasi semua?
Apakah top node adalah artificial node?
Apakah skor berubah drastis dari run sebelumnya?
Apakah jumlah node/relationship projection masuk akal?
Apakah top result sesuai domain sanity check?
Apakah ada tenant leakage?
Apakah ada time-window mismatch?
```

### 16.1 Distribution query

Jika skor ditulis ke node:

```cypher
MATCH (a:Account)
WHERE a.pageRankScore IS NOT NULL
RETURN percentileCont(a.pageRankScore, 0.5) AS p50,
       percentileCont(a.pageRankScore, 0.9) AS p90,
       percentileCont(a.pageRankScore, 0.99) AS p99,
       max(a.pageRankScore) AS maxScore;
```

### 16.2 Top nodes sanity check

```cypher
MATCH (a:Account)
WHERE a.pageRankScore IS NOT NULL
RETURN a.accountId,
       a.accountType,
       a.status,
       a.createdAt,
       a.pageRankScore
ORDER BY a.pageRankScore DESC
LIMIT 50;
```

Jika top results adalah:

```text
DEFAULT_ACCOUNT
UNKNOWN
CASH
MISC
SYSTEM
TEST_ACCOUNT
```

Maka projection/model bermasalah.

---

## 17. Combining Centrality Metrics

Kadang satu metrik tidak cukup.

Contoh fraud features:

```text
inDegree30d
outDegree30d
weightedPageRank30d
betweenness90d
componentSize
knownRiskNeighborCount
newCounterpartyVelocity
```

Tetapi jangan asal menjumlahkan.

Buruk:

```text
riskScore = degree + pageRank + betweenness
```

Lebih baik:

```text
riskFeatureVector = {
  inDegreePercentile,
  pageRankPercentile,
  betweennessPercentile,
  componentRiskDensity,
  suspiciousNeighborRatio,
  velocityDelta
}
```

Lalu:

- gunakan model statistik/ML yang divalidasi,
- atau gunakan rule yang eksplisit dan bisa diaudit,
- atau gunakan score sebagai triage signal, bukan decision.

### 17.1 Percentile lebih mudah dibaca

Raw PageRank score tidak intuitif.

Percentile lebih komunikatif:

```text
Entity is in top 0.5% by PageRank in 30-day transaction graph.
```

Bandingkan dengan:

```text
score = 0.0004839201
```

### 17.2 Segment-specific centrality

Jangan bandingkan merchant besar dengan individual account kecil dalam satu ranking tanpa segmentasi.

Gunakan segment:

```text
accountType
industry
jurisdiction
tenant
caseType
serviceTier
businessUnit
```

Contoh:

```text
Top 1% PageRank among newly created retail accounts
```

lebih actionable daripada:

```text
Top PageRank among all accounts
```

---

## 18. Centrality and Supernodes

Centrality sering mengangkat supernode.

Supernode bisa natural atau modelling artifact.

Natural:

```text
large merchant
national tax office
core identity provider
central payment processor
shared platform service
```

Artifact:

```text
Unknown
Default
Other
All
Misc
No Address
System
```

### 18.1 Strategy untuk supernode natural

Jangan selalu exclude. Kadang supernode natural memang penting.

Tetapi interpretasi harus segment-aware.

Pilihan:

- treat separately,
- cap degree contribution,
- use relationship type partition,
- use time window,
- use weighted/normalized edges,
- run centrality per segment,
- exclude from investigative candidate list but keep for path explanation.

### 18.2 Strategy untuk artifact supernode

Biasanya harus diperbaiki di modelling/data quality:

- jangan represent missing value sebagai shared node,
- gunakan property `valueMissing = true`,
- buat node placeholder per source/entity jika perlu,
- exclude test/system nodes,
- deduplicate entities.

---

## 19. Centrality Result Lifecycle

Centrality score bukan static property abadi.

Treat it as derived data.

### 19.1 Metadata wajib

```text
scoreName
algorithm
algorithmVersion
projectionName
projectionDefinitionHash
configuration
inputDataWindow
calculatedAt
calculatedBy
nodeCount
relationshipCount
qualityChecks
```

### 19.2 Versioned score node pattern

Alih-alih menulis property langsung:

```cypher
(:Account {pageRankScore: 0.123})
```

Untuk audit-heavy system, bisa gunakan:

```text
(:Account)-[:HAS_SCORE]->(:CentralityScore {
  algorithm: 'pageRank',
  projection: 'account_tx_30d',
  score: 0.123,
  percentile: 99.4,
  calculatedAt: datetime(...),
  scoreVersion: '2026-06-22-account-tx-30d-v17'
})
```

Trade-off:

- property langsung lebih cepat dan sederhana,
- score node lebih audit-friendly dan historis,
- hybrid bisa dipakai: latest score sebagai property, full history sebagai node/event.

### 19.3 Expiration

Centrality score lama harus diberi status:

```text
current
superseded
expired
invalidated
```

Karena graph berubah.

---

## 20. Worked Example: Account Risk Network

### 20.1 Domain

Kita punya account transaction network:

```text
(:Account)-[:SENT_TO]->(:Account)
```

Relationship properties:

```text
totalAmount
transactionCount
firstSeen
lastSeen
riskWeightedAmount
```

Node properties:

```text
accountId
accountType
jurisdiction
kycStatus
createdAt
knownRiskFlag
```

### 20.2 Questions

Kita ingin menjawab:

```text
Q1. Account mana yang menjadi collector dari banyak account?
Q2. Account mana yang penting karena menerima dari account penting?
Q3. Account mana yang menjembatani cluster transaksi berbeda?
Q4. Account mana yang centrality-nya meningkat tajam minggu ini?
```

### 20.3 Metrics

```text
Q1 -> in-degree / weighted in-degree
Q2 -> PageRank
Q3 -> betweenness
Q4 -> delta centrality over time windows
```

### 20.4 Projection discipline

Projection 30 hari:

```text
Nodes: Account
Relationships: SENT_TO where lastSeen >= now - 30d
Weight: log(totalAmount + 1) * recencyFactor
Direction: NATURAL
Exclude: test/system/known infrastructure accounts
Segment: retail accounts only for candidate ranking
```

### 20.5 Output for investigator

Jangan hanya tampilkan:

```text
Account A score 0.932
```

Tampilkan:

```text
Account A
- Top 0.3% PageRank in 30-day retail transaction graph
- In-degree: 428 counterparties
- Weighted received amount: IDR ...
- Betweenness: top 1.1%
- Score increased 420% compared to previous 30-day window
- Top contributing neighbors: B, C, D
- Known risk neighbors: 17
- Explanation paths available
```

### 20.6 Decision boundary

Centrality result should create:

```text
review recommendation
triage priority
investigation lead
```

Not:

```text
automatic enforcement action
```

---

## 21. Worked Example: Complex Case Management

### 21.1 Graph model

```text
(:Case)-[:HAS_SUBJECT]->(:Entity)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Evidence)-[:MENTIONS]->(:Entity)
(:Entity)-[:ASSOCIATED_WITH]->(:Entity)
(:Case)-[:RELATED_TO]->(:Case)
(:Case)-[:VIOLATES]->(:Regulation)
```

### 21.2 Questions

```text
Q1. Case mana yang paling kompleks?
Q2. Entity mana yang menjadi connector antar case clusters?
Q3. Evidence mana yang paling structurally important?
Q4. Regulation mana yang sering muncul dalam high-risk connected case networks?
```

### 21.3 Metrics

```text
Case complexity -> degree + evidence count + subject count
Entity connector -> betweenness
Evidence importance -> PageRank in evidence-case-entity projection
Regulation prominence -> degree/PageRank in case-regulation projection
```

### 21.4 Defensible output

```text
This entity appears as a bridge in the projected case-entity-evidence graph.
It connects 4 case clusters through 9 evidence mentions and 3 associated organizations.
This is a review prioritization signal, not a finding of violation.
```

---

## 22. Worked Example: Service Dependency Graph

### 22.1 Graph model

```text
(:Service)-[:CALLS {rpm, p95Latency, errorRate}]->(:Service)
(:Service)-[:DEPENDS_ON]->(:Database)
(:Service)-[:PUBLISHES_TO]->(:Topic)
(:Service)-[:CONSUMES_FROM]->(:Topic)
```

### 22.2 Questions

```text
Q1. Service mana yang paling banyak dipakai langsung?
Q2. Service mana yang menjadi chokepoint?
Q3. Service mana yang paling dekat ke banyak critical services?
Q4. Jika service X gagal, apa blast radius-nya?
```

### 22.3 Metrics

```text
Direct usage -> in-degree
Chokepoint -> betweenness / articulation points
Reachability -> closeness/harmonic
Blast radius -> traversal + path analysis, not centrality alone
```

### 22.4 Engineering action

Centrality result harus mengarah ke tindakan:

```text
increase SLO tier
add redundancy
reduce coupling
split responsibility
add circuit breaker
improve observability
prioritize migration
```

Bukan hanya dashboard ranking.

---

## 23. Choosing the Right Centrality Algorithm

| Need | Good starting point | Caveat |
|---|---|---|
| Banyak koneksi langsung | Degree | Supernode/artifact sensitive |
| Importance dari node penting | PageRank | Direction/weight sensitive |
| Bridge antar cluster | Betweenness | Expensive; shortest path assumption |
| Dekat ke banyak node | Closeness | Problematic on disconnected graph |
| Dekat di disconnected graph | Harmonic | Still needs interpretation |
| Hub vs authority | HITS | Works only if link semantics fit |
| Structural cut node | Articulation points | Mostly undirected/connectivity framing |
| Critical edge | Bridges | Edge semantics must represent connectivity |

Rule of thumb:

```text
Start simple.
Validate with domain experts.
Only then make it more sophisticated.
```

---

## 24. Common Anti-Patterns

### 24.1 “Run all algorithms and see what happens”

This creates metrics without meaning.

Better:

```text
Question -> projection -> metric -> validation -> interpretation -> action
```

### 24.2 “High centrality means high risk”

No. High centrality means structurally prominent under a projection.

Risk requires domain evidence and calibrated interpretation.

### 24.3 “One global graph for all centrality”

Global mixed graph often produces meaningless rankings.

Use purpose-built projections.

### 24.4 “No time window”

Historic accumulation dominates.

Use windows, decay, and deltas.

### 24.5 “No segmentation”

Large legitimate nodes dominate.

Compare like with like.

### 24.6 “No result governance”

If centrality affects decision-making, it needs metadata, versioning, audit, and explanation.

---

## 25. Production Checklist

Before using centrality in production:

```text
[ ] Business question is explicit.
[ ] Projection is documented.
[ ] Node labels included/excluded are documented.
[ ] Relationship types included/excluded are documented.
[ ] Direction/orientation is justified.
[ ] Relationship weights are defined and normalized.
[ ] Time window or decay is defined.
[ ] Supernodes are handled.
[ ] Memory estimate is run.
[ ] Execution mode is chosen intentionally.
[ ] Score distribution is validated.
[ ] Top results are sanity-checked.
[ ] Score metadata is stored.
[ ] Versioning strategy exists.
[ ] Access control is enforced on results.
[ ] Explanation is available.
[ ] Score is not used as sole enforcement decision.
[ ] Monitoring exists for drift and anomalies.
```

---

## 26. Practical Lab Blueprint

A good lab for this part:

1. Build small account transaction graph.
2. Add normal users, merchants, collectors, and bridge accounts.
3. Compute degree with Cypher.
4. Project transaction graph into GDS.
5. Run PageRank.
6. Run betweenness.
7. Compare top results.
8. Add `Unknown` artifact node.
9. Re-run metrics and observe distortion.
10. Add time window.
11. Compute delta centrality.
12. Write interpretation notes for each top node.

Goal:

```text
Not just to run algorithms,
but to understand why scores change when graph semantics change.
```

---

## 27. Key Takeaways

1. Centrality measures node importance, but “importance” depends on the algorithm and projection.
2. Degree is simple and often useful, but supernode-sensitive.
3. PageRank captures recursive importance, but depends heavily on direction and link semantics.
4. Betweenness finds bridges/chokepoints, but can be expensive and shortest-path-biased.
5. Closeness measures reachability distance, but disconnected graphs complicate interpretation.
6. Harmonic centrality can be more robust for disconnected graphs.
7. Centrality scores should be versioned derived data, not timeless truth.
8. For regulatory/enforcement contexts, centrality is a prioritization and investigation signal, not evidence by itself.
9. Time windows, segmentation, and score deltas are often more useful than global raw scores.
10. Production centrality requires governance: projection metadata, validation, explainability, and auditability.

---

## 28. References for Further Study

- Neo4j Graph Data Science Manual — Centrality algorithms.
- Neo4j Graph Data Science Manual — PageRank.
- Neo4j Graph Data Science Manual — Betweenness Centrality.
- Neo4j Graph Data Science Manual — Graph algorithms overview.
- Neo4j Graph Data Science Manual — Named graph projections, execution modes, and memory estimation.

---

## 29. What Comes Next

Part berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-023.md
```

Topik:

```text
Community Detection, Clustering, Similarity, and Link Prediction
```

Centrality melihat “node penting”. Part berikutnya melihat **struktur kelompok dan kemiripan**:

- connected components,
- strongly/weakly connected components,
- Louvain,
- label propagation,
- triangle count,
- node similarity,
- KNN,
- link prediction,
- fraud ring/entity resolution/recommendation use cases.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-021.md">⬅️ Part 021 — Graph Data Science Fundamentals</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-023.md">Part 023 — Community Detection, Clustering, Similarity, and Link Prediction ➡️</a>
</div>
