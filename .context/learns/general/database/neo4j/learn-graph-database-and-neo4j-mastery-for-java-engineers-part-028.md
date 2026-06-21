# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-028.md

# Part 028 — Domain Case Study: Recommendation, Personalization, and Similarity Graph

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami graph database dan Neo4j sampai level arsitektur, modelling, operasional, dan production decision.  
> Fokus part ini: membangun recommendation system berbasis graph dengan Neo4j, bukan sebagai daftar algoritma, tetapi sebagai cara berpikir domain: signal, path, similarity, explanation, evaluasi, abuse, dan production trade-off.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 027, kita sudah membahas:

- graph thinking,
- property graph model,
- Cypher,
- modelling methodology,
- anti-pattern,
- constraints/indexes,
- write correctness,
- performance,
- supernodes,
- Java integration,
- import/CDC,
- transactions,
- operations,
- clustering,
- security,
- APOC/tooling,
- Graph Data Science,
- centrality,
- community detection,
- similarity,
- path finding,
- embeddings,
- vector indexes,
- knowledge graph,
- dan case study fraud/enforcement/investigation graph.

Part ini memakai semua fondasi tersebut untuk satu domain yang sangat graph-shaped: **recommendation, personalization, dan similarity**.

Rekomendasi bukan sekadar:

```text
SELECT top_items FROM popularity_table
```

atau:

```text
cosine_similarity(user_vector, item_vector)
```

Rekomendasi yang baik sering harus menjawab:

```text
Mengapa item X relevan untuk user Y sekarang?
```

Dan pertanyaan itu hampir selalu relational:

```text
User ini mirip dengan siapa?
User ini pernah melakukan apa?
Item ini berhubungan dengan item apa?
Kategori apa yang muncul berulang?
Brand apa yang sering dipilih?
Apa yang sedang trending di komunitas yang sama?
Apakah rekomendasi ini terlalu populer, terlalu repetitif, terlalu bias, atau mudah dimanipulasi?
Apakah rekomendasi ini bisa dijelaskan?
```

Graph database cocok ketika nilai rekomendasi muncul dari **hubungan antar user, item, event, context, dan similarity**.

---

## 1. Mental Model: Recommendation as Graph Problem

Recommendation system adalah sistem yang memilih kandidat terbaik dari ruang kemungkinan yang besar.

Secara abstrak:

```text
recommend(user, context) -> ranked list of items
```

Tetapi graph-native view-nya lebih kaya:

```text
recommend(node, context) -> ranked frontier of reachable/relevant nodes
```

Artinya, rekomendasi bisa dilihat sebagai proses:

1. mulai dari anchor node,
2. traverse graph berdasarkan relationship bermakna,
3. kumpulkan candidate,
4. hitung evidence path,
5. scoring,
6. filter constraint,
7. diversify,
8. explain,
9. observe feedback,
10. update graph.

Contoh:

```text
(:User {id: 'U1'})
  -[:VIEWED]->(:Product {id: 'P1'})
  -[:IN_CATEGORY]->(:Category {name: 'Graph Databases'})
  <-[:IN_CATEGORY]-(:Product {id: 'P2'})
```

Rekomendasi `P2` untuk `U1` bisa dijelaskan:

```text
Karena kamu melihat P1, dan P2 berada di kategori yang sama.
```

Contoh lain:

```text
(:User {id: 'U1'})
  -[:BOUGHT]->(:Product {id: 'P1'})
  <-[:BOUGHT]-(:User {id: 'U2'})
  -[:BOUGHT]->(:Product {id: 'P3'})
```

Rekomendasi `P3` bisa dijelaskan:

```text
User lain yang membeli P1 juga membeli P3.
```

Ini adalah collaborative filtering dalam bentuk graph.

---

## 2. Recommendation Bukan Satu Masalah

Banyak tim gagal karena menganggap recommendation adalah satu problem tunggal. Padahal ada beberapa sub-problem yang berbeda.

### 2.1 Similar Item Recommendation

Pertanyaan:

```text
Untuk item X, item apa yang mirip atau sering berhubungan?
```

Contoh:

```text
Produk serupa
Artikel terkait
Course lanjutan
Film mirip
Case serupa
Komponen alternatif
```

Graph view:

```text
(:Item)-[:SIMILAR_TO]->(:Item)
(:Item)-[:SAME_CATEGORY]->(:Item)
(:Item)<-[:INTERACTED_WITH]-(:User)-[:INTERACTED_WITH]->(:Item)
```

### 2.2 Personalized User Recommendation

Pertanyaan:

```text
Untuk user U, item apa yang paling relevan sekarang?
```

Graph view:

```text
(:User)-[:VIEWED|BOUGHT|LIKED|SAVED]->(:Item)
(:User)-[:BELONGS_TO]->(:Segment)
(:User)-[:SIMILAR_TO]->(:User)
(:Item)-[:IN_CATEGORY]->(:Category)
```

### 2.3 Next Best Action

Pertanyaan:

```text
Apa aksi terbaik berikutnya untuk entity ini?
```

Bukan hanya item recommendation, tetapi decision recommendation.

Contoh:

```text
next best offer
next escalation step
next investigation action
next support response
next learning module
```

Graph view:

```text
(:Case)-[:HAS_STATUS]->(:Status)
(:Case)-[:MATCHES_PATTERN]->(:Pattern)
(:Pattern)-[:SUGGESTS_ACTION]->(:Action)
```

### 2.4 Similar User / Customer 360

Pertanyaan:

```text
User/customer/entity mana yang mirip dengan entity ini?
```

Graph view:

```text
(:User)-[:HAS_BEHAVIOR]->(:Behavior)
(:User)-[:OWNS]->(:Asset)
(:User)-[:BELONGS_TO]->(:Segment)
(:User)-[:SIMILAR_TO {score}]->(:User)
```

### 2.5 Discovery / Serendipity

Pertanyaan:

```text
Apa item yang belum jelas terlihat, tapi masuk akal untuk ditemukan?
```

Ini berbeda dari “lebih banyak hal yang sama”.

Graph view:

```text
User -> known interests -> neighboring communities -> bridge items
```

### 2.6 Risk-Aware Recommendation

Pertanyaan:

```text
Apa rekomendasi yang relevan, tetapi tetap aman secara policy, compliance, inventory, atau fairness?
```

Graph view:

```text
(:User)-[:ELIGIBLE_FOR]->(:Offer)
(:Offer)-[:REQUIRES]->(:Condition)
(:User)-[:HAS_RISK_FLAG]->(:RiskFlag)
(:Offer)-[:PROHIBITED_FOR]->(:RiskFlag)
```

---

## 3. Core Graph Model untuk Recommendation

Model awal yang umum:

```cypher
(:User)
(:Item)
(:Event)
(:Category)
(:Brand)
(:Tag)
(:Session)
(:Context)
(:Segment)
```

Relationship umum:

```cypher
(:User)-[:VIEWED]->(:Item)
(:User)-[:CLICKED]->(:Item)
(:User)-[:SAVED]->(:Item)
(:User)-[:BOUGHT]->(:Item)
(:User)-[:RATED {score}]->(:Item)
(:User)-[:BELONGS_TO]->(:Segment)
(:Item)-[:IN_CATEGORY]->(:Category)
(:Item)-[:HAS_TAG]->(:Tag)
(:Item)-[:MADE_BY]->(:Brand)
(:Item)-[:SIMILAR_TO {score, method, computedAt}]->(:Item)
(:User)-[:SIMILAR_TO {score, method, computedAt}]->(:User)
(:Session)-[:CONTAINS_EVENT]->(:Event)
(:Event)-[:TARGETS]->(:Item)
(:Event)-[:BY_USER]->(:User)
```

Tetapi model production biasanya harus lebih hati-hati.

---

## 4. Jangan Langsung Menjadikan Semua Event sebagai Relationship Permanen

Event seperti:

```text
view
click
impression
scroll
hover
add_to_cart
purchase
like
share
```

bisa terjadi dalam volume sangat besar.

Jika setiap event langsung dimodelkan sebagai relationship permanen:

```cypher
(:User)-[:VIEWED {timestamp, sessionId, device, position}]->(:Item)
```

maka graph bisa cepat menjadi:

```text
terlalu padat,
terlalu noisy,
mahal untuk traversal,
sulit di-retain,
dan raw event history berubah menjadi beban OLTP graph.
```

### 4.1 Model Raw Event sebagai Event Node

Untuk event yang butuh audit/detail:

```cypher
(:User)-[:PERFORMED]->(:Event)-[:TARGETED]->(:Item)
```

Event node bisa punya:

```cypher
{
  eventType: 'VIEW',
  timestamp: datetime('2026-06-22T10:15:00Z'),
  sessionId: 'S1',
  source: 'web',
  position: 4,
  campaignId: 'C9'
}
```

Kelebihan:

- event bisa punya banyak atribut,
- bisa dihubungkan ke session, campaign, context,
- cocok untuk audit,
- lebih fleksibel untuk event kompleks.

Kekurangan:

- traversal lebih panjang,
- jumlah node besar,
- perlu retention/archival.

### 4.2 Model Aggregated Signal sebagai Relationship

Untuk rekomendasi cepat:

```cypher
(:User)-[:INTERESTED_IN {
  strength: 0.82,
  lastSeenAt: datetime(...),
  viewCount: 17,
  purchaseCount: 2,
  decayScore: 0.64
}]->(:Category)
```

atau:

```cypher
(:User)-[:AFFINITY {
  score: 0.71,
  source: 'behavior_aggregation_v3',
  computedAt: datetime(...)
}]->(:Tag)
```

Kelebihan:

- traversal murah,
- noise berkurang,
- cocok untuk online serving.

Kekurangan:

- kehilangan detail raw event,
- perlu pipeline update,
- perlu governance formula scoring.

### 4.3 Pattern yang Sering Paling Sehat

Gunakan dua lapisan:

```text
Raw event store: Kafka / log / warehouse / lake / OLAP
Graph serving projection: Neo4j
```

Graph tidak perlu menjadi gudang semua event mentah. Graph sebaiknya menyimpan:

```text
current preference,
derived affinity,
similarity edge,
semantic item relationship,
explainable path,
eligibility/policy relationship,
recent meaningful interactions.
```

---

## 5. User-Item Graph

Model paling dasar recommendation:

```cypher
(:User)-[:INTERACTED_WITH]->(:Item)
```

Tetapi relationship terlalu generic biasanya buruk.

Lebih baik:

```cypher
(:User)-[:VIEWED]->(:Item)
(:User)-[:CLICKED]->(:Item)
(:User)-[:SAVED]->(:Item)
(:User)-[:BOUGHT]->(:Item)
(:User)-[:RATED]->(:Item)
```

Karena setiap signal punya kekuatan berbeda:

| Signal | Meaning | Strength |
|---|---:|---:|
| Impression | item ditampilkan | sangat lemah |
| View | user membuka detail | lemah-menengah |
| Click | ada intention | menengah |
| Save/Wishlist | intention kuat | kuat |
| Add to cart | purchase intent | kuat |
| Purchase | conversion | sangat kuat |
| Repeat purchase | loyalty | sangat kuat |
| Rating high | explicit positive | kuat |
| Rating low | explicit negative | kuat negatif |
| Return/refund | negative after purchase | negatif |

Mental model:

```text
Tidak semua edge berarti preferensi.
```

Contoh:

```text
User melihat produk karena tidak sengaja.
User membeli produk sebagai hadiah.
User klik karena iklan misleading.
User rating buruk karena delivery, bukan produk.
```

Graph harus memisahkan **observed behavior** dari **inferred preference**.

---

## 6. Explicit Signal vs Implicit Signal

### 6.1 Explicit Signal

Contoh:

```text
rating
like
dislike
follow
subscribe
wishlist
survey preference
```

Kelebihan:

- mudah diinterpretasikan,
- kuat untuk explanation,
- lebih jelas sebagai evidence.

Kekurangan:

- sparse,
- bias ke user aktif,
- bisa tidak representatif.

### 6.2 Implicit Signal

Contoh:

```text
view
click
watch time
scroll depth
purchase
repeat visit
search query
session path
```

Kelebihan:

- volume tinggi,
- tersedia untuk banyak user,
- cocok untuk real-time personalization.

Kekurangan:

- ambiguous,
- noisy,
- rentan bias UI/position,
- bisa merefleksikan exposure, bukan interest.

### 6.3 Graph Pattern

Jangan gabungkan semua menjadi satu relationship tanpa provenance.

Buruk:

```cypher
(:User)-[:LIKES {score: 0.7}]->(:Item)
```

Lebih baik:

```cypher
(:User)-[:VIEWED {count, lastAt}]->(:Item)
(:User)-[:BOUGHT {count, lastAt}]->(:Item)
(:User)-[:RATED {score, at}]->(:Item)
(:User)-[:HAS_AFFINITY {score, source, computedAt}]->(:Item)
```

`HAS_AFFINITY` adalah inference/derived relationship. `VIEWED`, `BOUGHT`, `RATED` adalah evidence.

---

## 7. Item Knowledge Graph

Recommendation tidak hanya user-item. Item juga punya struktur.

Contoh product graph:

```cypher
(:Product)-[:IN_CATEGORY]->(:Category)
(:Product)-[:HAS_TAG]->(:Tag)
(:Product)-[:MADE_BY]->(:Brand)
(:Product)-[:COMPATIBLE_WITH]->(:Product)
(:Product)-[:BUNDLE_WITH]->(:Product)
(:Product)-[:REPLACES]->(:Product)
(:Product)-[:ALTERNATIVE_TO]->(:Product)
(:Product)-[:REQUIRES]->(:Accessory)
```

Contoh content graph:

```cypher
(:Article)-[:ABOUT]->(:Topic)
(:Article)-[:MENTIONS]->(:Entity)
(:Article)-[:WRITTEN_BY]->(:Author)
(:Article)-[:PART_OF]->(:Series)
(:Article)-[:PREREQUISITE]->(:Article)
(:Article)-[:NEXT_IN_SEQUENCE]->(:Article)
```

Contoh learning graph:

```cypher
(:Course)-[:TEACHES]->(:Skill)
(:Skill)-[:PREREQUISITE_OF]->(:Skill)
(:Course)-[:REQUIRES]->(:Skill)
(:User)-[:MASTERED]->(:Skill)
(:User)-[:LEARNING]->(:Skill)
```

Dalam graph recommendation, item metadata bukan hanya filter. Ia menjadi jalur inferensi:

```text
User -> Item -> Topic -> Item
User -> Skill -> Prerequisite -> Course
Product -> Compatible accessory -> Product
Article -> Entity -> Related article
```

---

## 8. Path-Based Recommendation

Path-based recommendation memakai traversal untuk menemukan kandidat.

### 8.1 Item-to-Item via Shared Users

```cypher
MATCH (:Product {id: $productId})<-[:BOUGHT]-(u:User)-[:BOUGHT]->(candidate:Product)
WHERE candidate.id <> $productId
RETURN candidate, count(DISTINCT u) AS commonBuyers
ORDER BY commonBuyers DESC
LIMIT 20;
```

Interpretasi:

```text
Produk yang dibeli oleh user yang juga membeli produk ini.
```

Risiko:

- produk populer mendominasi,
- seasonal effect,
- purchase intent berbeda,
- tidak mempertimbangkan kategori/price/availability.

### 8.2 User-to-Item via Similar Users

```cypher
MATCH (me:User {id: $userId})-[:BOUGHT]->(p:Product)<-[:BOUGHT]-(other:User)
MATCH (other)-[:BOUGHT]->(candidate:Product)
WHERE NOT (me)-[:BOUGHT]->(candidate)
RETURN candidate, count(DISTINCT other) AS evidence
ORDER BY evidence DESC
LIMIT 20;
```

Interpretasi:

```text
User yang punya riwayat pembelian mirip membeli candidate.
```

Masalah:

```text
User populer / heavy buyer bisa mencemari hasil.
Produk populer bisa selalu menang.
Query bisa mahal jika fan-out besar.
```

### 8.3 User-to-Item via Interest Category

```cypher
MATCH (me:User {id: $userId})-[a:HAS_AFFINITY]->(c:Category)<-[:IN_CATEGORY]-(candidate:Product)
WHERE candidate.status = 'ACTIVE'
RETURN candidate, a.score AS affinityScore
ORDER BY affinityScore DESC
LIMIT 20;
```

Interpretasi:

```text
Candidate berasal dari category yang user punya affinity tinggi.
```

Kelebihan:

- murah,
- explainable,
- cocok untuk cold-ish users.

Kekurangan:

- kurang personal jika category terlalu luas,
- risiko repetitif.

### 8.4 Multi-Hop Recommendation

```cypher
MATCH path = (me:User {id: $userId})-[:HAS_AFFINITY]->(:Topic)<-[:ABOUT]-(candidate:Article)
WHERE NOT (me)-[:READ]->(candidate)
RETURN candidate, length(path) AS pathLen
LIMIT 20;
```

Multi-hop harus dibatasi. Jangan menulis:

```cypher
MATCH path = (me:User {id: $userId})-[*]->(candidate)
RETURN candidate;
```

Itu bukan recommendation. Itu graph explosion.

---

## 9. Candidate Generation vs Ranking

Recommendation biasanya terdiri dari dua tahap besar:

```text
Candidate generation -> Ranking
```

### 9.1 Candidate Generation

Tujuan:

```text
Cari ratusan/ribuan kandidat yang masuk akal.
```

Graph sangat kuat untuk tahap ini karena bisa mencari kandidat dari:

```text
similar users,
similar items,
shared topics,
shared communities,
path evidence,
semantic compatibility,
eligibility graph,
policy constraints.
```

### 9.2 Ranking

Tujuan:

```text
Urutkan kandidat berdasarkan relevance, business objective, diversity, freshness, safety, dan constraints.
```

Ranking bisa dilakukan dengan:

```text
Cypher score sederhana,
precomputed score,
GDS similarity score,
ML model,
learning-to-rank,
real-time feature service,
hybrid graph + vector + business rules.
```

### 9.3 Jangan Memaksa Graph Menjadi Semua Lapisan

Neo4j bisa sangat bagus untuk:

```text
connected candidate generation,
relationship-aware filtering,
explanation path,
serving derived similarity edges,
eligibility and policy graph.
```

Tetapi ranking ML berat bisa lebih cocok di:

```text
feature store,
ML service,
batch pipeline,
OLAP system,
vector service,
atau dedicated ranker.
```

Arsitektur sehat:

```text
Neo4j: graph candidate + explainable relationship evidence
Ranker service: score final
Policy service/graph: eligibility filtering
Event stream: feedback loop
Warehouse/lake: training/evaluation
```

---

## 10. Similarity Edges

Daripada menghitung similarity on-demand terus-menerus, production system sering menyimpan hasil similarity sebagai relationship.

```cypher
(:Product)-[:SIMILAR_TO {
  score: 0.83,
  method: 'node_similarity_jaccard_v2',
  computedAt: datetime('2026-06-22T00:00:00Z'),
  evidence: 'shared_buyers'
}]->(:Product)
```

atau:

```cypher
(:User)-[:SIMILAR_TO {
  score: 0.77,
  method: 'knn_fastrp_v1',
  computedAt: datetime(...),
  segment: 'enterprise_java_engineers'
}]->(:User)
```

### 10.1 Manfaat Similarity Edge

- query serving lebih murah,
- bisa diberi TTL/recompute schedule,
- explainable jika metadata cukup,
- bisa dipakai sebagai input traversal lain.

### 10.2 Risiko Similarity Edge

- stale,
- self-reinforcing feedback loop,
- terlalu banyak edge,
- method tidak jelas,
- score tidak comparable antar versi,
- membentuk dense graph baru.

### 10.3 Guardrail

Simpan metadata minimal:

```cypher
{
  score,
  method,
  version,
  computedAt,
  expiresAt,
  evidenceType,
  sampleWindow,
  sourceJobId
}
```

Jangan hanya:

```cypher
(:Item)-[:SIMILAR_TO {score: 0.9}]->(:Item)
```

Karena enam bulan kemudian tidak ada yang tahu score itu berasal dari mana.

---

## 11. Node Similarity

Node Similarity membandingkan node berdasarkan tetangga yang sama.

Contoh:

```text
Dua produk mirip jika banyak dibeli oleh user yang sama.
Dua user mirip jika banyak membeli produk yang sama.
Dua artikel mirip jika banyak dibaca oleh user yang sama.
Dua case mirip jika berbagi entity/evidence/pattern yang sama.
```

Graph shape:

```text
Product <- BOUGHT - User - BOUGHT -> Product
```

Jika dua product punya banyak common buyers, maka keduanya mungkin mirip.

### 11.1 Kapan Node Similarity Cocok

Cocok ketika:

```text
shared-neighborhood berarti relevansi,
relasi input cukup bersih,
node degree tidak terlalu ekstrem,
popularity bias bisa dikontrol,
edge weight bermakna.
```

Tidak cocok ketika:

```text
shared-neighborhood hanya mencerminkan popularitas,
user behavior sangat noisy,
data terlalu sparse,
semua node terhubung ke hub yang sama,
relationship tidak homogen.
```

### 11.2 Jaccard Intuition

Jaccard:

```text
intersection(A, B) / union(A, B)
```

Jika produk A dibeli oleh user `{U1, U2, U3}` dan produk B oleh `{U2, U3, U4}`, maka:

```text
intersection = {U2, U3} = 2
union = {U1, U2, U3, U4} = 4
jaccard = 2 / 4 = 0.5
```

Jaccard menurunkan score ketika union besar.

### 11.3 Overlap Intuition

Overlap coefficient:

```text
intersection(A, B) / min(size(A), size(B))
```

Berguna ketika satu set kecil hampir seluruhnya terkandung dalam set besar.

### 11.4 Cosine Intuition

Cosine similarity berguna saat edge punya weight.

Contoh:

```text
purchaseCount,
rating,
watchTime,
engagementScore.
```

---

## 12. KNN Similarity

KNN mencari tetangga terdekat berdasarkan property vector.

Contoh item punya vector:

```cypher
(:Product {
  id: 'P1',
  embedding: [0.12, -0.03, 0.98, ...]
})
```

atau user punya feature vector:

```cypher
(:User {
  id: 'U1',
  preferenceVector: [0.4, 0.1, 0.0, 0.8, ...]
})
```

KNN bisa dipakai untuk:

```text
find similar products,
find similar users,
construct similarity graph,
serve approximate recommendation candidates.
```

### 12.1 KNN vs Node Similarity

| Aspect | Node Similarity | KNN |
|---|---|---|
| Basis | shared graph neighbors | node properties/vector |
| Good for | co-behavior similarity | feature/embedding similarity |
| Needs embeddings? | tidak selalu | sering iya |
| Interpretability | biasanya lebih mudah | tergantung vector source |
| Cold start | sulit jika no edges | bisa jika metadata vector ada |

---

## 13. Embedding-Based Recommendation

Graph embeddings memetakan node ke vector sehingga proximity dalam vector space merefleksikan struktur graph.

Contoh:

```text
Product P1 -> [0.17, -0.42, 0.03, ...]
User U1 -> [0.51, 0.02, -0.19, ...]
```

Embedding bisa dibuat dari:

```text
graph topology,
node properties,
content text,
behavior history,
hybrid model.
```

Di Neo4j GDS, node embeddings sering dipakai sebagai input untuk downstream task seperti kNN similarity graph construction, node classification, dan link prediction.

### 13.1 Kapan Embedding Membantu

Embedding membantu ketika:

```text
relationship eksplisit terlalu sparse,
semantic similarity tidak terlihat dari exact match,
item punya deskripsi/content,
user behavior kompleks,
recommendation butuh generalisasi.
```

### 13.2 Kapan Embedding Berbahaya

Embedding berbahaya ketika:

```text
score sulit dijelaskan,
training data bias,
embedding stale,
semua keputusan tampak ilmiah tapi tidak divalidasi,
vector similarity menggantikan business constraint,
model drift tidak dimonitor.
```

### 13.3 Hybrid Graph + Embedding

Arsitektur yang kuat:

```text
1. vector/embedding menemukan kandidat semantik,
2. graph traversal memvalidasi koneksi/domain eligibility,
3. Cypher mengumpulkan explanation path,
4. ranker menggabungkan score,
5. policy layer menyaring hasil akhir.
```

---

## 14. Link Prediction untuk Recommendation

Link prediction mencoba memprediksi relationship yang seharusnya ada.

Dalam recommendation:

```text
(:User)-[:MIGHT_BUY]->(:Product)
(:User)-[:MIGHT_LIKE]->(:Article)
(:Customer)-[:MIGHT_NEED]->(:Service)
(:Learner)-[:SHOULD_TAKE]->(:Course)
```

Tetapi hati-hati: `MIGHT_BUY` bukan fakta. Itu inference.

### 14.1 Pisahkan Fact dan Prediction

Fact:

```cypher
(:User)-[:BOUGHT]->(:Product)
```

Prediction:

```cypher
(:User)-[:PREDICTED_TO_BUY {
  score: 0.67,
  model: 'lp_pipeline_v4',
  computedAt: datetime(...),
  expiresAt: datetime(...)
}]->(:Product)
```

Jangan pernah mencampur prediction dengan fact.

Buruk:

```cypher
(:User)-[:BOUGHT {predicted: true}]->(:Product)
```

Itu merusak semantic integrity graph.

---

## 15. Cold Start Problem

Cold start terjadi ketika user/item baru tidak punya cukup relationship.

### 15.1 New User Cold Start

User baru belum punya behavior.

Strategi graph:

```text
onboarding preference -> Category/Tag affinity
initial segment -> Segment recommendation
contextual session behavior -> short-term graph
location/device/language -> coarse constraints
popular within segment -> fallback
```

Model:

```cypher
(:User)-[:SELECTED_INTEREST]->(:Topic)
(:User)-[:BELONGS_TO]->(:Segment)
(:Segment)-[:POPULAR_ITEM]->(:Item)
```

### 15.2 New Item Cold Start

Item baru belum punya interaction.

Strategi graph:

```text
metadata similarity,
category/tag relation,
brand relation,
content embedding,
compatibility relationship,
editorial curation.
```

Model:

```cypher
(:Product)-[:IN_CATEGORY]->(:Category)
(:Product)-[:HAS_TAG]->(:Tag)
(:Product)-[:MADE_BY]->(:Brand)
(:Product)-[:SIMILAR_CONTENT_TO]->(:Product)
```

### 15.3 Cold Start Bukan Masalah Algoritma Saja

Cold start adalah masalah product + data modelling.

Pertanyaan penting:

```text
Apa sinyal minimum yang bisa dikumpulkan saat onboarding?
Metadata item apa yang wajib ada?
Bisakah editor/curator memberi seed relationship?
Fallback apa yang masih masuk akal dan tidak misleading?
```

---

## 16. Popularity Bias

Popularity bias terjadi ketika item populer selalu direkomendasikan karena punya banyak edge.

Contoh:

```cypher
MATCH (me:User {id: $userId})-[:BOUGHT]->(:Product)<-[:BOUGHT]-(other:User)-[:BOUGHT]->(candidate:Product)
RETURN candidate, count(*) AS score
ORDER BY score DESC
```

Produk yang paling populer akan menang, bukan yang paling personal.

### 16.1 Teknik Mengurangi Popularity Bias

1. Normalize by degree.
2. Penalize global popularity.
3. Segment-level popularity instead of global popularity.
4. Diversity constraints.
5. Category quotas.
6. Freshness boost.
7. Exclude already obvious items.
8. Use personalized affinity edge.

Contoh score:

```text
personal_score = shared_evidence / log(1 + global_popularity)
```

### 16.2 Degree-Aware Thinking

Dalam graph recommendation, degree adalah sinyal sekaligus bahaya.

```text
High degree bisa berarti important.
High degree juga bisa berarti generic.
```

Contoh node generic:

```text
Category: Electronics
Tag: Popular
Brand: Apple
Topic: Technology
```

Jika traversal melewati node terlalu generic, rekomendasi menjadi dangkal.

---

## 17. Diversity dan Serendipity

Recommendation yang optimal secara skor bisa buruk secara pengalaman.

Contoh:

```text
Top 10 semua dari kategori yang sama.
Top 10 semua produk dari brand yang sama.
Top 10 semua konten lanjutan tanpa eksplorasi.
```

### 17.1 Diversity Constraints

Contoh:

```text
maksimal 3 item per category,
maksimal 2 item per brand,
minimal 2 item dari adjacent interest,
minimal 1 item fresh/new.
```

Graph membantu karena category/brand/topic adalah node eksplisit.

### 17.2 Serendipity via Bridge Nodes

Serendipity bisa dicari melalui node yang menjembatani dua komunitas.

Contoh:

```text
User suka Java concurrency.
Ada course tentang distributed systems.
Bridge topic: backpressure.
```

Graph path:

```text
User -> Topic(Java Concurrency) -> Topic(Backpressure) -> Course(Distributed Systems)
```

Rekomendasi ini tidak identik dengan preferensi user, tetapi masih explainable.

---

## 18. Context-Aware Recommendation

User yang sama bisa butuh rekomendasi berbeda tergantung konteks.

Context:

```text
time,
location,
device,
session intent,
current page,
inventory,
price sensitivity,
recent action,
regulatory eligibility,
business campaign.
```

Graph model:

```cypher
(:Session)-[:BY_USER]->(:User)
(:Session)-[:HAS_CONTEXT]->(:Context)
(:Context)-[:INDICATES_INTENT]->(:Intent)
(:Intent)-[:BOOSTS]->(:Category)
```

Contoh:

```cypher
MATCH (s:Session {id: $sessionId})-[:BY_USER]->(u:User)
MATCH (s)-[:HAS_CONTEXT]->(:Context)-[:INDICATES_INTENT]->(intent:Intent)-[:BOOSTS]->(c:Category)
MATCH (u)-[a:HAS_AFFINITY]->(c)<-[:IN_CATEGORY]-(candidate:Product)
RETURN candidate, a.score AS baseScore
ORDER BY baseScore DESC
LIMIT 20;
```

### 18.1 Long-Term vs Short-Term Interest

Long-term:

```text
user consistently reads graph database material.
```

Short-term:

```text
user currently browsing travel adapters.
```

Graph should separate:

```cypher
(:User)-[:HAS_LONG_TERM_AFFINITY]->(:Topic)
(:Session)-[:HAS_SHORT_TERM_INTENT]->(:Topic)
```

Final recommendation combines both.

---

## 19. Explainability

Salah satu kekuatan graph recommendation adalah explanation path.

### 19.1 Explanation Pattern

Candidate tidak hanya punya score. Candidate punya evidence:

```text
User -> bought P1 -> same category as candidate
User -> similar to U2 -> U2 bought candidate
User -> interested in Topic T -> candidate about Topic T
User -> follows Author A -> candidate written by A
```

### 19.2 Query Explanation Path

```cypher
MATCH path = (u:User {id: $userId})-[:BOUGHT]->(:Product)-[:IN_CATEGORY]->(c:Category)<-[:IN_CATEGORY]-(candidate:Product)
WHERE candidate.id = $candidateId
RETURN path
LIMIT 3;
```

### 19.3 Explanation Must Not Reveal Sensitive Data

Jika explanation path melewati user lain:

```text
User U2 also bought this.
```

Mungkin tidak boleh ditampilkan langsung.

Lebih aman:

```text
People with similar purchase patterns bought this.
```

Security trimming berlaku untuk recommendation explanation.

### 19.4 Explanation vs Justification

Explanation path bukan otomatis justifikasi yang benar.

Contoh:

```text
Karena user serupa membeli ini.
```

Bisa benar secara path, tapi lemah secara causal reasoning.

Graph menunjukkan koneksi. Bukan selalu sebab.

---

## 20. Abuse and Manipulation

Recommendation graph bisa dimanipulasi.

### 20.1 Attack Surface

```text
fake accounts,
coordinated clicks,
review bombing,
fake purchases,
tag manipulation,
SEO-like graph stuffing,
merchant self-promotion,
bot-created similarity,
feedback loop exploitation.
```

### 20.2 Graph-Based Abuse Detection

Gunakan graph untuk mendeteksi pola:

```text
banyak akun baru membeli item sama,
akun-akun berbagi device/payment/address,
review cluster terlalu rapat,
similarity edge muncul dari source mencurigakan,
traffic spike dari komunitas abnormal.
```

Graph model:

```cypher
(:User)-[:USES_DEVICE]->(:Device)
(:User)-[:USES_PAYMENT]->(:PaymentInstrument)
(:User)-[:REVIEWED]->(:Product)
(:User)-[:BELONGS_TO_CLUSTER]->(:BehaviorCluster)
```

### 20.3 Trust-Weighted Recommendation

Tidak semua signal harus punya weight sama.

```text
trusted user purchase > new user click
verified purchase review > anonymous rating
organic session > campaign-driven session
long-term behavior > suspicious burst behavior
```

Relationship property:

```cypher
(:User)-[:BOUGHT {
  count: 1,
  trustWeight: 0.91,
  source: 'verified_order'
}]->(:Product)
```

---

## 21. Feedback Loop

Recommendation mengubah behavior. Behavior mengubah recommendation.

Ini feedback loop.

Contoh:

```text
Sistem merekomendasikan produk populer.
User melihat produk populer.
Produk populer makin banyak edge.
Sistem makin yakin produk itu relevan.
```

### 21.1 Observed Interest vs Exposed Interest

Jika user klik item karena sistem menaruhnya di posisi pertama, apakah itu preferensi user atau bias exposure?

Graph perlu menyimpan exposure/impression:

```cypher
(:RecommendationImpression)-[:SHOWN_TO]->(:User)
(:RecommendationImpression)-[:SHOWED]->(:Product)
(:RecommendationImpression)-[:USED_MODEL]->(:ModelVersion)
(:RecommendationImpression)-[:IN_POSITION]->(:RankPosition)
```

Jika tidak, sistem tidak bisa mengevaluasi bias posisi.

### 21.2 Model Versioning

Simpan versi rekomendasi:

```cypher
(:RecommendationRun {
  id,
  modelVersion,
  strategy,
  generatedAt
})-[:RECOMMENDED]->(:Product)
```

Ini penting untuk:

```text
evaluation,
audit,
rollback,
A/B testing,
explainability,
incident analysis.
```

---

## 22. Evaluation Metrics

Graph recommendation tetap harus dievaluasi.

### 22.1 Offline Metrics

```text
precision@k
recall@k
MAP
NDCG
hit rate
coverage
diversity
novelty
serendipity
calibration
```

### 22.2 Online Metrics

```text
CTR
conversion rate
add-to-cart rate
watch time
retention
revenue per session
complaint rate
hide/dislike rate
refund/return rate
long-term engagement
```

### 22.3 Graph-Specific Metrics

```text
average explanation path length,
percentage recommendations with valid explanation,
category diversity,
community diversity,
hub dependency ratio,
recommendation graph degree distribution,
stale similarity edge ratio,
coverage across item graph,
percentage candidates filtered by policy.
```

### 22.4 Beware Metric Gaming

CTR naik bisa buruk jika:

```text
clickbait naik,
refund naik,
user trust turun,
diversity turun,
small suppliers terkubur,
new item exposure turun.
```

Recommendation architecture harus memilih objective secara sadar.

---

## 23. Production Architecture

### 23.1 High-Level Architecture

```text
Raw Events
  -> Kafka / Event Stream
  -> Stream Processor / Batch Jobs
  -> Feature Store / Warehouse
  -> Neo4j Graph Projection
  -> Similarity/GDS Jobs
  -> Recommendation API
  -> Ranker / Policy Filter
  -> App UI
  -> Feedback Events
```

### 23.2 Neo4j Role

Neo4j cocok untuk:

```text
graph-shaped candidate generation,
derived relationship serving,
similarity graph storage,
user-item-topic traversal,
eligibility graph,
explanation path,
recommendation debugging,
manual exploration by analysts.
```

Neo4j kurang cocok sebagai satu-satunya tempat untuk:

```text
raw clickstream massive volume,
deep learning training store,
feature computation warehouse,
all impression logs forever,
low-latency cache for every request without precomputation.
```

### 23.3 Online Serving Pattern

```text
Request: userId + context
1. Fetch user context.
2. Generate candidates via precomputed graph edges / bounded traversal.
3. Apply eligibility and inventory filter.
4. Compute lightweight graph score.
5. Call ranker if needed.
6. Diversify results.
7. Return recommendations + explanation metadata.
8. Log impression with model/strategy version.
```

### 23.4 Precompute vs Real-Time

| Component | Real-time? | Precompute? |
|---|---:|---:|
| recent session intent | yes | no |
| long-term affinity | maybe | yes |
| item similarity | no | yes |
| user similarity | rarely | yes |
| eligibility | yes | partly |
| inventory availability | yes | no |
| explanation path | yes | maybe |
| graph embeddings | no | yes |

---

## 24. Cypher Serving Example

### 24.1 Precomputed Similar Product Serving

```cypher
MATCH (:Product {id: $productId})-[s:SIMILAR_TO]->(candidate:Product)
WHERE candidate.status = 'ACTIVE'
  AND s.score >= $minScore
RETURN candidate {
  .id,
  .name,
  .price,
  similarityScore: s.score,
  explanation: 'Similar to current product'
} AS recommendation
ORDER BY s.score DESC
LIMIT $limit;
```

### 24.2 Personalized Category Affinity Serving

```cypher
MATCH (u:User {id: $userId})-[a:HAS_AFFINITY]->(c:Category)<-[:IN_CATEGORY]-(candidate:Product)
WHERE candidate.status = 'ACTIVE'
  AND NOT EXISTS {
    MATCH (u)-[:BOUGHT]->(candidate)
  }
RETURN candidate {
  .id,
  .name,
  affinityScore: a.score,
  category: c.name,
  explanation: 'Matches your interest in ' + c.name
} AS recommendation
ORDER BY a.score DESC, candidate.popularityScore DESC
LIMIT $limit;
```

### 24.3 Similar User Candidate

```cypher
MATCH (u:User {id: $userId})-[sim:SIMILAR_TO]->(other:User)-[:BOUGHT]->(candidate:Product)
WHERE candidate.status = 'ACTIVE'
  AND sim.score >= 0.6
  AND NOT EXISTS {
    MATCH (u)-[:BOUGHT]->(candidate)
  }
WITH candidate, sum(sim.score) AS score, count(DISTINCT other) AS evidenceUsers
RETURN candidate {
  .id,
  .name,
  score: score,
  evidenceUsers: evidenceUsers,
  explanation: 'Popular among similar users'
} AS recommendation
ORDER BY score DESC
LIMIT $limit;
```

### 24.4 Diversity by Category

Cypher can do some diversity, but complex diversification is often easier in application/ranker layer.

Simple category cap:

```cypher
MATCH (u:User {id: $userId})-[a:HAS_AFFINITY]->(c:Category)<-[:IN_CATEGORY]-(candidate:Product)
WHERE candidate.status = 'ACTIVE'
WITH c, candidate, a.score AS score
ORDER BY c.name, score DESC
WITH c, collect(candidate)[0..3] AS topPerCategory
UNWIND topPerCategory AS candidate
RETURN candidate
LIMIT 20;
```

This is okay for simple use cases. For serious ranking/diversification, use an explicit ranking service.

---

## 25. Java Service Design

### 25.1 Repository Boundary

Do not expose arbitrary Cypher everywhere.

Better:

```java
public interface RecommendationRepository {
    List<RecommendationCandidate> findSimilarProducts(String productId, int limit);
    List<RecommendationCandidate> findPersonalizedCandidates(String userId, RecommendationContext context, int limit);
    List<ExplanationPath> findExplanations(String userId, String itemId, int maxPaths);
}
```

Service:

```java
public final class RecommendationService {
    private final RecommendationRepository graphRepository;
    private final RankerClient rankerClient;
    private final PolicyService policyService;
    private final ImpressionLogger impressionLogger;

    public List<Recommendation> recommend(String userId, RecommendationContext context) {
        var candidates = graphRepository.findPersonalizedCandidates(userId, context, 200);
        var eligible = policyService.filter(userId, candidates, context);
        var ranked = rankerClient.rank(userId, eligible, context);
        var diversified = diversify(ranked);
        impressionLogger.log(userId, diversified, context);
        return diversified;
    }
}
```

### 25.2 Keep Query Contracts Stable

Each recommendation strategy should have:

```text
name,
version,
input parameters,
required indexes,
expected max cardinality,
explanation policy,
owner,
SLO,
fallback strategy.
```

### 25.3 Avoid Returning Huge Graphs

Repository should return projections:

```java
record RecommendationCandidate(
    String itemId,
    String title,
    double graphScore,
    String strategy,
    List<String> evidence
) {}
```

Not raw driver nodes/relationships across service boundaries.

---

## 26. Index and Constraint Design

Minimal constraints:

```cypher
CREATE CONSTRAINT user_id_unique IF NOT EXISTS
FOR (u:User)
REQUIRE u.id IS UNIQUE;

CREATE CONSTRAINT product_id_unique IF NOT EXISTS
FOR (p:Product)
REQUIRE p.id IS UNIQUE;

CREATE CONSTRAINT category_name_unique IF NOT EXISTS
FOR (c:Category)
REQUIRE c.name IS UNIQUE;
```

Useful indexes:

```cypher
CREATE INDEX product_status IF NOT EXISTS
FOR (p:Product)
ON (p.status);

CREATE INDEX product_popularity IF NOT EXISTS
FOR (p:Product)
ON (p.popularityScore);

CREATE INDEX affinity_score IF NOT EXISTS
FOR ()-[r:HAS_AFFINITY]-()
ON (r.score);
```

But remember: index helps entry point lookup. It does not magically fix unbounded traversal.

---

## 27. Failure Modes

### 27.1 Graph Explosion

Symptom:

```text
recommendation query suddenly slow after user/item growth.
```

Cause:

```text
variable traversal too broad,
shared hub nodes,
no candidate cap,
no degree-aware filtering.
```

Mitigation:

```text
precompute similarity,
limit traversal depth,
avoid generic hub categories,
use degree thresholds,
add category/segment boundaries,
profile query regularly.
```

### 27.2 Stale Recommendation

Cause:

```text
similarity edges recomputed too rarely,
affinity not decayed,
old behavior dominates.
```

Mitigation:

```text
computedAt/expiresAt,
time decay,
recent session boost,
recompute schedule,
staleness metrics.
```

### 27.3 Filter After Ranking

If policy/inventory filters run after ranking, top recommendations may disappear, leaving weak results.

Better:

```text
candidate -> eligibility filter -> ranking -> diversity -> final policy check
```

### 27.4 Explanation Leakage

Explanation can leak:

```text
other users' actions,
sensitive categories,
inferred attributes,
private communities.
```

Mitigation:

```text
explanation templates,
path sanitization,
security trimming,
no raw path exposure to UI.
```

### 27.5 Popularity Collapse

System recommends only popular items.

Mitigation:

```text
normalize degree,
diversify,
boost novelty,
segment recommendation,
measure coverage.
```

### 27.6 Feedback Loop Amplification

System amplifies its own previous recommendations.

Mitigation:

```text
log impressions,
separate organic vs recommended interactions,
exploration bucket,
A/B testing,
counterfactual evaluation where possible.
```

### 27.7 Prediction Treated as Fact

`PREDICTED_TO_BUY` is later treated as `BOUGHT`.

Mitigation:

```text
separate relationship types,
strict naming,
constraints/process,
data contract tests,
review pipelines.
```

---

## 28. Recommendation Strategy Catalogue

A production system should maintain a catalogue.

Example:

```text
Strategy: similar_products_v3
Input: productId
Candidate source: Product-[:SIMILAR_TO]->Product
Score: similarity edge score
Filters: active, inStock, notRestricted
Explanation: similar to current product
Refresh: daily
Owner: personalization-platform
SLO: p95 < 80ms
Fallback: category_top_products_v1
Known risks: stale similarity, popularity bias
```

Another:

```text
Strategy: user_affinity_category_v2
Input: userId, context
Candidate source: User-[:HAS_AFFINITY]->Category<-[:IN_CATEGORY]-Product
Score: affinity score + product freshness
Filters: eligibility, inventory, already purchased
Explanation: based on interest in category
Refresh: affinity hourly, product status real-time
Owner: growth-platform
SLO: p95 < 120ms
Fallback: segment_popular_v1
```

Without a catalogue, recommendation becomes hidden magic.

---

## 29. Case Study: Learning Recommendation for Java Engineer

Suppose a platform recommends learning modules.

Graph:

```cypher
(:User)-[:KNOWS]->(:Skill)
(:User)-[:LEARNING]->(:Skill)
(:Course)-[:TEACHES]->(:Skill)
(:Skill)-[:PREREQUISITE_OF]->(:Skill)
(:Course)-[:REQUIRES]->(:Skill)
(:Course)-[:NEXT_AFTER]->(:Course)
(:User)-[:COMPLETED]->(:Course)
```

Question:

```text
What should this Java engineer learn next?
```

Naive recommendation:

```text
Most popular courses.
```

Graph recommendation:

```text
Find target skills adjacent to current skill graph,
exclude skills already mastered,
respect prerequisites,
recommend courses teaching reachable next skills,
prefer courses connected to user's current learning path,
explain why.
```

Cypher sketch:

```cypher
MATCH (u:User {id: $userId})-[:KNOWS]->(known:Skill)-[:PREREQUISITE_OF]->(next:Skill)
WHERE NOT (u)-[:KNOWS]->(next)
MATCH (course:Course)-[:TEACHES]->(next)
WHERE NOT EXISTS {
  MATCH (course)-[:REQUIRES]->(req:Skill)
  WHERE NOT (u)-[:KNOWS]->(req)
}
RETURN course, next.name AS targetSkill
LIMIT 20;
```

Explanation:

```text
Recommended because you already know X, and Y is the next skill after X. This course teaches Y and its prerequisites are satisfied.
```

This is more defensible than pure popularity.

---

## 30. Case Study: B2B Product Recommendation

Graph:

```cypher
(:Company)-[:USES]->(:Product)
(:Company)-[:IN_INDUSTRY]->(:Industry)
(:Product)-[:IN_CATEGORY]->(:Category)
(:Product)-[:INTEGRATES_WITH]->(:Product)
(:Product)-[:REQUIRES]->(:Capability)
(:Company)-[:HAS_CAPABILITY]->(:Capability)
(:Company)-[:SIMILAR_TO]->(:Company)
```

Question:

```text
Which product should we recommend to company C?
```

Graph reasoning:

```text
Companies similar to C use product P.
P integrates with products C already uses.
C has required capabilities.
P is common in C's industry but not over-saturated.
P does not violate contractual restrictions.
```

This is graph-shaped because recommendation depends on multi-entity compatibility.

---

## 31. Regulatory and Ethical Considerations

Personalization can become sensitive.

Risks:

```text
profiling without transparency,
inferred sensitive attributes,
discrimination,
filter bubbles,
exclusion,
manipulative targeting,
audit failure,
explanation mismatch.
```

Graph-specific governance:

```text
classify sensitive nodes/relationships,
prevent traversal through restricted facts for recommendation,
separate operational eligibility from behavioral inference,
store provenance for derived affinity,
allow deletion/retention enforcement,
log model/strategy version,
validate recommendation distribution across protected groups where applicable.
```

Rule:

```text
If a path should not be used to justify a recommendation, it should not silently influence candidate generation.
```

---

## 32. Design Checklist

Before using Neo4j for recommendation, answer:

```text
1. What are the recommendation questions?
2. Are they relationship/path-heavy or mostly attribute filtering?
3. What is the anchor node: user, item, session, case, company?
4. What candidate paths are allowed?
5. What paths are forbidden?
6. Which signals are facts vs inference?
7. Which interactions are raw events vs aggregated graph edges?
8. What must be real-time?
9. What can be precomputed?
10. How are similarity edges versioned?
11. How is staleness detected?
12. How is popularity bias controlled?
13. How is diversity enforced?
14. How are explanations generated and sanitized?
15. How are impressions logged?
16. How is feedback loop bias measured?
17. What is the fallback strategy?
18. What SLO does each query need?
19. What indexes/constraints are required?
20. What production runbook exists for graph explosion?
```

---

## 33. What “Top 1%” Looks Like for Graph Recommendation

A strong engineer does not say:

```text
Let's use Neo4j because recommendation is graphy.
```

A strong engineer says:

```text
The recommendation problem has multiple candidate-generation strategies.
Some are graph-native: similar users, item-topic paths, compatibility edges, eligibility graph, and explanation path.
Raw events should stay outside Neo4j or be summarized.
Neo4j will serve bounded traversal and precomputed similarity edges.
GDS will compute offline similarity/embeddings where appropriate.
Ranking will combine graph evidence with business and context features.
Every derived edge will have provenance, version, computedAt, and expiry.
The system will log impressions to evaluate feedback-loop bias.
Explanations will be sanitized.
Fallbacks and SLOs will be explicit.
```

That is the difference between “using graph database” and designing a production graph recommendation system.

---

## 34. Summary

Recommendation graph is powerful because it can represent:

- user behavior,
- item metadata,
- semantic relationships,
- similarity,
- context,
- eligibility,
- explanation,
- feedback,
- trust,
- and policy constraints.

But recommendation graph fails when:

- raw events are dumped blindly,
- popularity bias is ignored,
- traversal is unbounded,
- predictions are treated as facts,
- explanation leaks sensitive data,
- stale similarity edges are trusted,
- evaluation is shallow,
- graph is forced to replace ranking, warehouse, or event pipeline.

A production-grade graph recommendation system should use Neo4j where graph structure matters most:

```text
candidate generation,
relationship-aware filtering,
similarity edge serving,
contextual traversal,
explainability,
and policy/eligibility reasoning.
```

---

## 35. Status Seri

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
Part 025 selesai.
Part 026 selesai.
Part 027 selesai.
Part 028 selesai.
Seri belum selesai.
Masih ada Part 029 sampai Part 032.
```

Part berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-029.md
```

Topik:

```text
Domain Case Study: IAM, Entitlements, Policy, and Access Graph
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-027.md">⬅️ Part 027 — Domain Case Study: Fraud, Risk, Enforcement, and Investigation Graph</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-029.md">Part 029 — Domain Case Study: IAM, Entitlements, Policy, and Access Graph ➡️</a>
</div>
