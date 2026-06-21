# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-023.md

# Part 023 — Community Detection, Clustering, Similarity, and Link Prediction

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: memahami struktur tersembunyi dalam graph menggunakan community detection, similarity, clustering, dan link prediction secara engineering-oriented, bukan sekadar menjalankan algoritma.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 022, kita sudah membangun fondasi berikut:

1. apa itu graph database dan kapan ia berguna;
2. bagaimana berpikir dalam node, relationship, dan path;
3. bagaimana mendesain property graph;
4. bagaimana query Cypher bekerja;
5. bagaimana menghindari path explosion;
6. bagaimana mengoperasikan Neo4j;
7. bagaimana Graph Data Science memproyeksikan graph ke memory;
8. bagaimana centrality menilai “pentingnya” node dalam network.

Part 023 melanjutkan dari centrality.

Centrality menjawab:

> “Node mana yang penting?”

Community detection, similarity, dan link prediction menjawab pertanyaan yang berbeda:

> “Node mana yang membentuk kelompok?”  
> “Node mana yang mirip?”  
> “Relationship mana yang mungkin belum terlihat, akan muncul, atau layak direkomendasikan?”

Ini bukan pertanyaan CRUD. Ini pertanyaan struktur.

Dalam banyak sistem graph production, terutama fraud, risk, recommendation, access analysis, dependency analysis, dan case management, nilai terbesar graph sering bukan hanya menemukan path eksplisit, tetapi menemukan **struktur tersembunyi**:

- cluster transaksi mencurigakan,
- kelompok akun yang dikendalikan aktor sama,
- entitas yang tampaknya berbeda tetapi berperilaku mirip,
- kasus yang tidak langsung berhubungan tetapi berbagi pola bukti,
- permission yang tampak aman secara lokal tetapi berbahaya secara kombinasi,
- supplier atau service dependency yang membentuk blast radius tersembunyi.

Bagian ini akan membangun mental model itu.

---

## 1. Big Picture: Empat Keluarga Masalah

Untuk menghindari kebingungan, pisahkan empat kategori berikut.

| Kategori | Pertanyaan utama | Output umum | Contoh |
|---|---|---|---|
| Community detection | “Siapa berada dalam kelompok yang sama?” | `communityId`, component ID, cluster label | fraud ring, user cohort, case group |
| Clustering | “Bagaimana node dipartisi berdasarkan feature/topology?” | cluster assignment | customer segment, behavior cluster |
| Similarity | “Node mana yang mirip dengan node ini?” | pairwise score, top-K neighbors | similar account, similar case, similar product |
| Link prediction | “Relationship mana yang mungkin ada/terjadi?” | candidate edge + score | friend recommendation, entity resolution candidate, fraud relation candidate |

Perhatikan perbedaan halusnya:

- Community detection melihat **struktur konektivitas**.
- Clustering bisa melihat **feature vector**, topology, atau embedding.
- Similarity melihat **kedekatan antar-pasangan node**.
- Link prediction mencoba menyimpulkan **kemungkinan relationship**.

Dalam implementasi nyata, keempatnya sering dipakai bersama.

Contoh pipeline:

```text
Raw graph
  -> entity resolution
  -> connected components
  -> community detection
  -> similarity scoring
  -> link prediction candidates
  -> human review
  -> write derived relationships
  -> operational query / alerting
```

---

## 2. Operational Graph vs Analytical Graph

Sebelum memakai GDS, ulangi prinsip dari Part 021:

> Neo4j database graph bukan selalu graph yang sama dengan graph analitik.

Operational graph menyimpan fakta domain:

```cypher
(:Person)-[:OWNS]->(:Account)
(:Account)-[:MADE]->(:Transaction)
(:Transaction)-[:TO]->(:Merchant)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
```

Analytical graph mungkin hanya memproyeksikan bagian tertentu:

```text
Person -> Person
Account -> Account
Case -> Case
Merchant -> Merchant
```

Relationship analytical bisa berasal dari fakta eksplisit maupun hasil derivasi:

```text
Person --shared_device--> Person
Account --transacted_with_same_merchant--> Account
Case --shares_evidence_source--> Case
User --co_accessed_resource--> User
```

GDS bekerja pada graph projection di memory. Karena itu, desain projection menentukan hasil algoritma.

Kesalahan umum:

> Menjalankan algoritma pada graph apa adanya, lalu menganggap hasilnya bermakna.

Padahal algoritma menjawab pertanyaan terhadap **graph yang Anda proyeksikan**, bukan terhadap domain secara absolut.

---

## 3. Connected Components: Fondasi Sebelum Community Detection

Connected components sering menjadi langkah pertama.

### 3.1 Weakly Connected Components

Weakly Connected Components, atau WCC, mengelompokkan node yang terhubung jika arah relationship diabaikan.

Mental model:

```text
A -> B <- C

Jika arah diabaikan:
A, B, C berada dalam component yang sama.
```

WCC cocok untuk pertanyaan:

- “Entitas mana yang berada dalam jaringan terkait?”
- “Apakah akun ini berada dalam connected fraud cluster?”
- “Berapa banyak isolated cluster?”
- “Seberapa besar connected component terbesar?”
- “Apakah ada giant component yang mengindikasikan model terlalu longgar?”

Contoh domain fraud:

```text
(:Account)-[:USED_DEVICE]->(:Device)
(:Account)-[:USED_EMAIL]->(:Email)
(:Account)-[:USED_PHONE]->(:Phone)
```

Jika banyak akun berbagi device/email/phone, WCC bisa menemukan grup yang saling terhubung.

Tapi WCC tidak mengatakan semua anggota melakukan fraud. WCC hanya mengatakan:

> “Mereka terhubung melalui minimal satu chain.”

### 3.2 Strongly Connected Components

Strongly Connected Components, atau SCC, mengelompokkan node yang saling reachable dengan memperhatikan arah.

Mental model:

```text
A -> B -> C -> A
```

A, B, C berada dalam SCC karena masing-masing dapat mencapai yang lain mengikuti arah edge.

SCC lebih cocok untuk graph directed yang arah relationship punya makna kuat:

- dependency cycle,
- workflow loop,
- ownership control loop,
- circular transaction,
- recursive approval chain,
- cyclic delegation.

Dalam case management, SCC bisa mendeteksi struktur berbahaya seperti:

```text
Officer A delegates to Officer B
Officer B delegates to Officer C
Officer C delegates to Officer A
```

Atau ownership loop:

```text
Company A controls Company B
Company B controls Company C
Company C controls Company A
```

### 3.3 Connected Component ≠ Community

Component adalah syarat keterhubungan minimal.

Community adalah pola konektivitas yang lebih padat di dalam kelompok dibandingkan antar-kelompok.

Contoh:

```text
A--B--C--D--E--F
```

Semua node berada dalam satu connected component. Tapi belum tentu ada community. Itu hanya chain.

Bandingkan:

```text
A--B--C
|\ | /|
D--E--F

G--H--I
|\ | /|
J--K--L
```

Di sini ada dua area padat yang mungkin menjadi community.

---

## 4. Community Detection: Apa yang Sebenarnya Dicari?

Community detection mencari struktur kelompok dalam network.

Secara informal:

> Community adalah subset node yang lebih saling terhubung satu sama lain dibandingkan dengan node di luar subset.

Namun definisi ini tidak tunggal. Setiap algoritma punya definisi operasional sendiri.

Itulah alasan Anda tidak boleh mengatakan:

> “Algoritma menemukan community yang benar.”

Yang lebih akurat:

> “Dengan projection, weight, orientation, dan parameter ini, algoritma mengusulkan partition yang mengoptimalkan objective tertentu.”

Ini penting untuk regulatory dan audit-heavy system.

Community result adalah **analytical hypothesis**, bukan fakta final.

---

## 5. Label Propagation

Label Propagation adalah salah satu algoritma community detection yang intuitif.

Mental model:

1. setiap node mulai dengan label sendiri;
2. node melihat label tetangganya;
3. node mengadopsi label yang paling dominan di neighborhood;
4. proses berulang sampai stabil atau mencapai batas iterasi.

Contoh:

```text
A--B--C--D
|  |  |
E--F--G
```

Jika A, B, C, E, F, G saling padat, label mereka akan cenderung konvergen ke label yang sama.

Kelebihan:

- cepat,
- mudah dipahami,
- cocok untuk graph besar,
- bagus sebagai baseline.

Kelemahan:

- hasil bisa tidak stabil,
- sensitif terhadap struktur dan urutan,
- tidak selalu cocok untuk community dengan batas halus,
- bisa menghasilkan community terlalu besar jika graph terlalu connected.

Gunakan untuk:

- eksplorasi awal,
- grouping cepat,
- baseline fraud cluster,
- data discovery.

Jangan gunakan sendirian untuk keputusan high-stakes tanpa validasi.

---

## 6. Louvain dan Leiden: Modularity-Oriented Community Detection

Louvain dan Leiden sering dipakai untuk mendeteksi community berdasarkan modularity.

### 6.1 Apa Itu Modularity?

Secara intuitif, modularity mengukur:

> “Seberapa banyak koneksi berada di dalam community dibandingkan ekspektasi random?”

Community yang baik biasanya punya:

- banyak relationship internal,
- sedikit relationship eksternal.

Contoh community kuat:

```text
Community A:
A--B
A--C
B--C
B--D
C--D

External:
D--X
```

Internal edge banyak, external edge sedikit.

### 6.2 Louvain

Louvain bekerja secara hierarchical:

1. mulai dengan setiap node sebagai community sendiri;
2. pindahkan node ke community tetangga jika meningkatkan modularity;
3. kompres community menjadi supernode;
4. ulangi pada graph yang lebih kecil.

Kelebihan:

- scalable,
- menemukan hierarchical community,
- populer untuk network besar.

Kelemahan:

- bisa menghasilkan community yang disconnected pada kasus tertentu,
- hasil perlu interpretasi,
- modularity punya resolution limit.

### 6.3 Leiden

Leiden memperbaiki beberapa kelemahan Louvain, terutama terkait kualitas dan konektivitas community. Untuk graph besar yang butuh community quality lebih baik, Leiden sering lebih disukai.

Namun, “lebih baik” tetap relatif terhadap objective dan data.

### 6.4 Resolution Problem

Community detection tidak punya satu skala benar.

Pada skala kecil, Anda mungkin melihat banyak sub-community. Pada skala besar, sub-community itu digabung.

Contoh:

```text
Company group
  -> business unit
     -> department
        -> team
```

Mana community yang benar?

Tergantung pertanyaan:

- untuk fraud ring, Anda mungkin ingin cluster kecil yang tight;
- untuk market structure, Anda mungkin ingin cluster besar;
- untuk access review, Anda mungkin ingin group sesuai role boundary;
- untuk case triage, Anda mungkin ingin cluster yang actionable.

---

## 7. Triangle Count, Local Clustering, dan Transitivity

Triangle terjadi ketika tiga node saling terhubung membentuk siklus tiga sisi.

```text
A--B
 \ |
  C
```

Triangle count dan clustering coefficient memberi sinyal bahwa neighborhood node cenderung saling terhubung.

Dalam social graph:

> Jika A mengenal B dan C, dan B mengenal C, maka ada triangle.

Dalam fraud graph, triangle bisa berarti:

```text
Account A shares device with Account B
Account B shares phone with Account C
Account A shares email domain with Account C
```

Tapi hati-hati: triangle tidak selalu suspicious. Dalam corporate graph, banyak triangle bisa normal karena struktur organisasi.

Gunakan triangle-based signal untuk:

- mendeteksi dense local group,
- menemukan closed loop,
- mengukur cohesion,
- fitur untuk fraud/risk model,
- fitur untuk link prediction.

---

## 8. K-Core Decomposition

K-core adalah subgraph di mana setiap node punya minimal degree `k` dalam subgraph tersebut.

Mental model:

- 1-core: node yang punya minimal 1 koneksi.
- 2-core: node yang punya minimal 2 koneksi dalam core.
- 5-core: node yang berada di area sangat terhubung.

K-core membantu membedakan:

- node pinggiran,
- node semi-terlibat,
- node inti jaringan.

Dalam investigasi:

```text
Large fraud network
  -> outer ring: many weak participants
  -> inner core: tightly connected actors
```

K-core bisa membantu menemukan “inti” kelompok.

Namun k-core bukan bukti niat atau kesalahan. Ia hanya struktur konektivitas.

---

## 9. Similarity: Node Mana yang Mirip?

Similarity berbeda dari community.

Community:

> “Siapa berada dalam kelompok yang sama?”

Similarity:

> “Seberapa mirip dua node?”

Dua node bisa mirip walaupun tidak berada dalam community yang sama.

Contoh:

```text
User A bought items: X, Y, Z
User B bought items: X, Y, Z
```

User A dan B mirip walaupun tidak saling terhubung langsung.

Dalam property graph, similarity sering dihitung berdasarkan shared neighbors:

```text
(:User)-[:BOUGHT]->(:Product)
```

Dua user mirip jika membeli produk yang sama.

Atau:

```text
(:Case)-[:HAS_ALLEGATION]->(:AllegationType)
(:Case)-[:USES_EVIDENCE_TYPE]->(:EvidenceType)
(:Case)-[:INVOLVES_ENTITY_TYPE]->(:EntityType)
```

Dua case mirip jika berbagi allegation/evidence/entity pattern.

---

## 10. Jaccard, Overlap, dan Cosine Similarity

### 10.1 Jaccard Similarity

Jaccard:

```text
intersection(A, B) / union(A, B)
```

Contoh:

```text
A = {device1, phone1, email1}
B = {device1, phone1, address1}

intersection = {device1, phone1} = 2
union = {device1, phone1, email1, address1} = 4

Jaccard = 2 / 4 = 0.5
```

Jaccard cocok untuk set-based similarity.

Kelemahan:

- penalizes large sets,
- bisa rendah untuk entitas besar yang tetap punya overlap bermakna.

### 10.2 Overlap Coefficient

Overlap:

```text
intersection(A, B) / min(size(A), size(B))
```

Contoh:

```text
A = {device1, phone1}
B = {device1, phone1, email1, address1, merchant1}

intersection = 2
min size = 2

Overlap = 1.0
```

Overlap cocok jika satu set subset dari set lain.

Dalam fraud detection, ini berguna untuk mendeteksi account kecil yang seluruh sinyalnya muncul pada account besar.

Kelemahan:

- bisa terlalu optimistis,
- subset kecil bisa membuat score tinggi karena kebetulan.

### 10.3 Cosine Similarity

Cosine similarity melihat sudut antar-vector.

Cocok untuk weighted feature:

```text
User A:
Product X: 10 interactions
Product Y: 2 interactions

User B:
Product X: 5 interactions
Product Y: 1 interaction
```

A dan B punya arah preferensi sama walaupun magnitude berbeda.

Cocok untuk:

- recommendation,
- behavior profile,
- weighted interaction,
- textual/vector-derived properties,
- graph embedding.

---

## 11. Node Similarity Algorithm

Node Similarity membandingkan node berdasarkan shared neighbors.

Projection contoh:

```text
(:Account)-[:USED_DEVICE]->(:Device)
(:Account)-[:USED_PHONE]->(:Phone)
(:Account)-[:USED_EMAIL]->(:Email)
```

Analytical interpretation:

```text
Account A similar to Account B if they share many devices/phones/emails.
```

Output umum:

```text
sourceNode
targetNode
similarityScore
```

Biasanya Anda tidak ingin semua pair. Jumlah pair bisa sangat besar.

Gunakan pembatas:

- topK per node,
- similarityCutoff,
- degreeCutoff,
- relationship weight,
- node label filter,
- relationship type filter.

Contoh strategi:

```text
Only compare Account nodes.
Use neighbors Device, Phone, Email.
Ignore generic EmailDomain unless rare.
Exclude shared public IP or public device category.
Use topK = 20.
Use similarityCutoff = 0.6.
```

Kalau tidak dibatasi, similarity bisa menjadi expensive dan noisy.

---

## 12. K-Nearest Neighbors

KNN mencari `k` node paling dekat/mirip berdasarkan vector atau feature.

Dalam GDS, KNN dapat dipakai untuk membangun similarity graph.

Mental model:

```text
For each node:
  find K most similar other nodes
  optionally write SIMILAR_TO relationships
```

KNN berguna jika Anda punya feature vector:

```text
Case feature:
- allegation type distribution
- entity type distribution
- transaction amount buckets
- jurisdiction pattern
- evidence pattern
- timeline length
```

Atau embedding:

```text
nodeEmbedding: [0.12, -0.07, 0.88, ...]
```

Output KNN bisa menjadi operational derived edge:

```cypher
(:Case)-[:SIMILAR_TO {score: 0.82, modelVersion: 'case-knn-v3'}]->(:Case)
```

Namun derived edge harus dikelola:

- kapan dihitung ulang?
- apakah score punya expiry?
- apakah model version disimpan?
- apakah user boleh melihat explanation?
- apakah edge ini fakta atau rekomendasi?

Jangan campur derived relationship dengan factual relationship tanpa penanda jelas.

---

## 13. Link Prediction: Menebak Relationship yang Mungkin Ada

Link prediction bertanya:

> “Dari struktur graph saat ini, pasangan node mana yang kemungkinan punya relationship?”

Ada dua bentuk besar:

1. **Topological link prediction**  
   Menggunakan struktur sekitar node, misalnya common neighbors, Adamic-Adar, preferential attachment.

2. **Machine learning link prediction**  
   Menggunakan features, embeddings, negative sampling, dan training pipeline.

Contoh topological:

```text
A -- X -- B
A -- Y -- B
A -- Z -- B
```

A dan B punya banyak common neighbors. Mungkin ada relationship yang belum tercatat.

Contoh use case:

- recommend user connection,
- suggest related case,
- candidate duplicate entity,
- suspicious hidden association,
- supplier risk relation,
- possible access entitlement relation.

Penting:

> Link prediction tidak membuktikan relationship. Ia menghasilkan candidate untuk verifikasi.

Dalam sistem regulasi, output link prediction harus dipresentasikan sebagai:

```text
candidate relationship
score
features/reasons
model/projection version
review state
```

Bukan sebagai:

```text
confirmed relationship
```

---

## 14. Common Neighbors

Common Neighbors menghitung jumlah tetangga bersama.

Contoh:

```text
A connected to: X, Y, Z
B connected to: X, Y, K

Common neighbors = X, Y = 2
```

Semakin banyak common neighbors, semakin mungkin A dan B berhubungan.

Kelebihan:

- mudah dijelaskan,
- bagus untuk baseline,
- computationally intuitive.

Kelemahan:

- bias terhadap node ber-degree tinggi,
- common neighbor generik bisa menipu.

Contoh fraud:

```text
Account A and B share:
- same public IP range
- same common email domain
```

Ini belum tentu meaningful.

Common neighbor perlu quality weighting.

---

## 15. Adamic-Adar

Adamic-Adar memberi bobot lebih besar pada common neighbor yang jarang.

Intuisi:

```text
Shared rare device -> strong signal
Shared public email domain -> weak signal
```

Jika banyak orang berbagi neighbor X, maka X kurang informatif.

Dalam fraud/risk, ini sering lebih masuk akal daripada common neighbors mentah.

Contoh:

```text
Shared device used by 2 accounts: strong signal
Shared merchant used by 1,000,000 accounts: weak signal
```

Adamic-Adar mendekati intuisi investigative:

> Sinyal langka lebih kuat daripada sinyal umum.

---

## 16. Preferential Attachment

Preferential Attachment memberi score berdasarkan degree node.

Intuisi:

> Node populer cenderung mendapatkan lebih banyak connection.

Cocok untuk:

- social networks,
- citation networks,
- marketplace popularity,
- recommendation baseline.

Tapi berbahaya untuk fairness dan risk system karena memperkuat popularity bias.

Dalam enforcement context, preferential attachment bisa salah arah:

```text
Large bank connected to many suspicious entities
```

Bukan berarti bank itu suspicious. Bisa jadi bank memang common hub.

Gunakan dengan hati-hati.

---

## 17. Resource Allocation

Resource Allocation mirip Adamic-Adar: common neighbor yang punya banyak connection memberikan kontribusi lebih kecil.

Intuisi:

> Attention/resource dari common neighbor dibagi ke seluruh connection-nya.

Berguna untuk link prediction di graph dengan hub besar.

---

## 18. Entity Resolution sebagai Link Prediction Problem

Entity resolution adalah proses menentukan apakah dua record merepresentasikan entity yang sama.

Graph sangat cocok karena kandidat match sering muncul dari shared evidence:

```text
PersonRecord A --HAS_PHONE--> Phone 1
PersonRecord B --HAS_PHONE--> Phone 1

PersonRecord A --HAS_DEVICE--> Device 9
PersonRecord B --HAS_DEVICE--> Device 9
```

Candidate:

```text
(PersonRecord A)-[:POSSIBLE_SAME_AS {score: 0.91}]->(PersonRecord B)
```

Tetapi final decision harus berbeda:

```text
(Person A)-[:SAME_AS]->(Person B)
```

Atau merge canonical entity:

```text
(:Person {canonicalId})
  <-[:REPRESENTS]-(:SourceRecord)
```

Good practice:

- simpan candidate relation,
- simpan score,
- simpan evidence,
- simpan algorithm version,
- simpan reviewer decision,
- jangan auto-merge high-stakes entity tanpa rollback strategy.

---

## 19. Fraud Ring Detection: Combining Components, Community, Similarity

Fraud ring detection jarang selesai dengan satu algoritma.

Pipeline yang lebih defensible:

```text
1. Build factual graph:
   Account, Device, Phone, Email, Address, Transaction, Merchant

2. Project analytical graph:
   Account --shares_signal--> Account
   where signals include rare shared device/phone/address

3. Run WCC:
   detect connected suspicious groups

4. Run community detection:
   partition large components into tighter rings

5. Run similarity:
   identify accounts with similar behavior/signals

6. Run link prediction:
   propose hidden association candidates

7. Score cluster:
   size, density, rare-signal count, transaction pattern, prior decisions

8. Human review:
   investigator accepts/rejects cluster/candidate

9. Write reviewed outcomes:
   RISK_CLUSTER, REVIEWED_AS_RELATED, NOT_RELATED, etc.
```

Key distinction:

- `SHARES_DEVICE` is factual.
- `POSSIBLY_RELATED_TO` is inferred.
- `CONFIRMED_RELATED_TO` is reviewed/adjudicated.
- `BELONGS_TO_FRAUD_RING` is high-stakes and should require policy/process.

---

## 20. Case Similarity in Regulatory Case Management

In complex case management, graph similarity can help answer:

- “Have we seen similar cases?”
- “Which past decisions are relevant?”
- “Which cases share evidence patterns?”
- “Which officer/team has handled similar matter?”
- “Is this escalation path consistent?”

Example model:

```cypher
(:Case)-[:INVOLVES_ENTITY_TYPE]->(:EntityType)
(:Case)-[:HAS_ALLEGATION]->(:Allegation)
(:Case)-[:HAS_EVIDENCE_TYPE]->(:EvidenceType)
(:Case)-[:APPLIES_REGULATION]->(:Regulation)
(:Case)-[:RESULTED_IN]->(:Outcome)
(:Case)-[:OCCURRED_IN]->(:Jurisdiction)
```

Analytical graph:

```text
Case --similar_to--> Case
```

Features can include:

- allegation overlap,
- regulation overlap,
- evidence overlap,
- entity type overlap,
- jurisdiction proximity,
- outcome similarity,
- timeline pattern.

But case similarity must not become blind precedent.

Two cases can be structurally similar but legally different.

Therefore output should include explanation:

```text
Case C-2026-019 similar to C-2024-184 because:
- same allegation type: Market Manipulation
- same evidence type: Trading Pattern Analysis
- same instrument category: Derivative
- same regulation family: Market Conduct
- similarity score: 0.78
```

A graph-native system should support:

- score,
- reason paths,
- source evidence,
- reviewer feedback,
- audit trail.

---

## 21. Recommendation Graph: Similarity and Link Prediction

Recommendation is the classic similarity/link prediction use case.

Graph:

```cypher
(:User)-[:VIEWED]->(:Item)
(:User)-[:BOUGHT]->(:Item)
(:Item)-[:BELONGS_TO]->(:Category)
(:Item)-[:HAS_TAG]->(:Tag)
```

Similarity options:

```text
User-user similarity:
  users who interacted with similar items

Item-item similarity:
  items interacted with by similar users

User-item link prediction:
  user may interact with item
```

Explanation matters:

```text
Recommended because:
- users with similar purchases bought it
- you bought Product A and Product B
- this item shares Category X and Tag Y
```

Graph recommendation can be more explainable than pure embedding recommendation because path-based reasons can be shown.

But graph-based recommendation still has risks:

- popularity bias,
- feedback loop,
- cold start,
- manipulation,
- stale preference,
- filter bubble,
- unfair exposure.

---

## 22. Access Graph: Toxic Combination Detection

In IAM/entitlement graph:

```cypher
(:User)-[:MEMBER_OF]->(:Group)
(:Group)-[:GRANTS]->(:Permission)
(:Permission)-[:ALLOWS]->(:Action)
(:Action)-[:ON]->(:Resource)
```

Community detection can identify role clusters:

```text
Users who share permission patterns form operational groups.
```

Similarity can find outlier access:

```text
User A is similar to users in finance role
but has engineering production permissions.
```

Link prediction can suggest missing entitlements:

```text
Users in same operational cluster usually have Permission P.
User X does not.
Candidate: grant Permission P?
```

But in security, link prediction for access must be treated carefully. Recommending access can normalize privilege creep.

Better framing:

```text
Candidate for access review:
- missing access that peers have
- excessive access that peers do not have
- toxic combination due to path overlap
```

Never blindly auto-grant from similarity.

---

## 23. Dependency Graph: Impact Clusters and Hidden Coupling

In service architecture:

```cypher
(:Service)-[:CALLS]->(:Service)
(:Service)-[:USES]->(:Database)
(:Service)-[:PUBLISHES]->(:Topic)
(:Service)-[:CONSUMES]->(:Topic)
(:Service)-[:OWNED_BY]->(:Team)
```

Community detection can reveal architectural clusters:

- bounded contexts,
- hidden monoliths,
- team coupling,
- dependency islands,
- shared database clusters,
- event-topic coupling.

Similarity can reveal services with similar dependency profile:

```text
Service A and B both use:
- same database
- same topic
- same external vendor
```

Link prediction might suggest missing documentation:

```text
Service A likely depends on Service B because they share runtime signals.
```

Again, inferred edge should be reviewed.

---

## 24. Projection Design: The Most Important Decision

Algorithm result depends more on projection design than algorithm name.

Projection questions:

### 24.1 What is the node set?

Examples:

```text
Account only?
Person only?
Case only?
User only?
Service only?
Mixed node types?
```

Mixed-type projection can be useful but harder to interpret.

### 24.2 What is the relationship set?

Do you include:

- factual relationships only?
- derived relationships?
- weak signals?
- strong signals?
- historical relationships?
- expired relationships?
- denied relationships?
- reviewed relationships?

### 24.3 What is the orientation?

Undirected projection often makes sense for similarity/community:

```text
Account --shares_device-- Account
```

Directed projection matters for flows:

```text
Account -> transfers_to -> Account
Service -> calls -> Service
Company -> controls -> Company
```

### 24.4 What is the weight?

Weights can encode:

- amount,
- count,
- recency,
- confidence,
- rarity,
- risk,
- legal relevance,
- evidence quality.

Example:

```text
shared_device weight = 0.9
shared_public_ip weight = 0.1
shared_phone weight = 0.8
shared_email_domain weight = 0.05
```

### 24.5 What is excluded?

Exclusion is often more important than inclusion.

Exclude:

- generic hubs,
- public/common attributes,
- stale data,
- low-confidence source,
- relationships outside legal retention,
- tenant-crossing data,
- test/synthetic accounts,
- already adjudicated false positives.

---

## 25. The Hub Problem in Community and Similarity

Graph algorithms can be distorted by hubs.

Example:

```text
All accounts transact with same large marketplace.
All employees use same corporate email domain.
All customers connect to same bank.
All services use same logging platform.
```

If included naively, hubs connect everything.

Symptoms:

- one giant connected component,
- meaningless community,
- high similarity due to common generic neighbor,
- link prediction recommending obvious/popular edges,
- high false positive rate.

Mitigation:

1. remove high-degree generic neighbors;
2. down-weight common neighbors;
3. use rarity weighting;
4. partition by domain context;
5. use relationship type filters;
6. use time windows;
7. use business whitelist/blacklist;
8. require multiple independent signal types.

Example rule:

```text
Two accounts are related only if they share at least:
- one strong rare signal, or
- three medium signals from different categories.
```

Graph algorithms are not substitute for domain semantics.

---

## 26. Temporal Dimension

Community and similarity are time-sensitive.

A graph over all historical data can produce misleading communities.

Example:

```text
Account A and B shared address 8 years ago.
```

Is that relevant today?

Maybe yes for some investigations. Maybe no for real-time risk.

Projection should define time window:

```text
last 7 days
last 30 days
last 12 months
active relationship only
validAt decision time
```

For regulatory defensibility, preserve:

- analysis time,
- input data version,
- time window,
- algorithm version,
- projection query,
- parameters,
- result version.

Otherwise you cannot reproduce why a cluster was flagged.

---

## 27. Writing Results Back to Neo4j

GDS can stream, mutate in memory, or write results.

You need architectural discipline.

### 27.1 Stream Mode

Use for exploration:

```text
Return results to client.
Do not persist.
```

Good for notebooks, analysts, experiments.

### 27.2 Mutate Mode

Use when chaining algorithms in the in-memory projection:

```text
Add communityId to in-memory graph.
Use it as input to another algorithm.
```

Good for analytical pipelines.

### 27.3 Write Mode

Use when result should become part of operational graph:

```cypher
(:Account)-[:POSSIBLY_RELATED_TO {
  score: 0.87,
  algorithm: 'nodeSimilarity',
  modelVersion: '2026-06-22',
  reviewed: false
}]->(:Account)
```

Be careful. Once written, analytical outputs become queryable facts. Label them clearly:

- `PREDICTED_*`
- `SUGGESTED_*`
- `CANDIDATE_*`
- `DERIVED_*`
- `REVIEWED_*`

Avoid naming inferred relationships like factual ones.

Bad:

```cypher
(:Account)-[:RELATED_TO]->(:Account)
```

Better:

```cypher
(:Account)-[:CANDIDATE_RELATED_TO {
  score: 0.87,
  evidence: ['shared_device', 'shared_phone'],
  algorithm: 'nodeSimilarity',
  algorithmVersion: 'v3',
  generatedAt: datetime(),
  reviewStatus: 'PENDING'
}]->(:Account)
```

---

## 28. Human-in-the-Loop Review

For high-stakes systems, algorithm output must feed review, not replace review.

Recommended lifecycle:

```text
GENERATED
  -> REVIEW_PENDING
  -> ACCEPTED / REJECTED / NEEDS_MORE_EVIDENCE
  -> SUPERSEDED by newer algorithm run
```

Model:

```cypher
(:CandidateRelation {
  id,
  type,
  score,
  algorithm,
  version,
  generatedAt,
  status
})

(:CandidateRelation)-[:BETWEEN]->(:Entity)
(:CandidateRelation)-[:SUPPORTED_BY]->(:Evidence)
(:CandidateRelation)-[:REVIEWED_BY]->(:Officer)
(:CandidateRelation)-[:RESULTED_IN]->(:ReviewDecision)
```

Why reify candidate relation?

Because you may need:

- multiple candidate types between same two nodes,
- review workflow,
- evidence attachment,
- status transition,
- audit trail,
- appeal,
- expiry,
- model comparison.

This is especially important in regulatory systems.

---

## 29. Evaluation: How Do You Know the Result Is Good?

Graph algorithm output can look impressive visually and still be useless.

Evaluate by task.

### 29.1 Community Detection Evaluation

Metrics:

- modularity,
- conductance,
- internal density,
- external cut,
- community size distribution,
- stability across runs,
- stability across time windows,
- domain review precision.

Questions:

```text
Are communities too large?
Are they too small?
Do they align with known groups?
Are high-risk clusters enriched for confirmed cases?
Do analysts find them actionable?
```

### 29.2 Similarity Evaluation

Metrics:

- precision@K,
- recall@K,
- mean reciprocal rank,
- score distribution,
- false positive review rate,
- explanation quality.

Questions:

```text
When the system says two cases are similar, do experts agree?
Are explanations meaningful?
Are results dominated by generic features?
```

### 29.3 Link Prediction Evaluation

Metrics:

- AUC,
- average precision,
- precision@K,
- recall@K,
- calibration,
- temporal validation.

Important:

> Validate link prediction temporally when possible.

Bad validation:

```text
Train and test on randomly split edges from same time.
```

Better validation:

```text
Train on graph before date T.
Predict relationships after date T.
```

This tests whether model predicts future/hidden relationships rather than memorizing topology.

---

## 30. False Positives, False Negatives, and Cost Model

Every graph algorithm has error.

False positive:

```text
System says A and B are related, but they are not.
```

False negative:

```text
System fails to connect A and B, but they are related.
```

Cost depends on domain.

In recommendation:

- false positive: annoying recommendation.
- false negative: missed recommendation.

In fraud:

- false positive: unnecessary investigation, customer harm.
- false negative: undetected fraud.

In enforcement:

- false positive: reputational/legal risk.
- false negative: public harm or regulatory failure.

In access control:

- false positive auto-grant: security breach.
- false negative: productivity issue.

Therefore algorithm threshold is not just technical. It is policy.

You need:

- threshold per use case,
- review capacity model,
- prioritization queue,
- appeal/reversal mechanism,
- auditability.

---

## 31. Practical Neo4j/GDS Workflow

A practical workflow:

```cypher
// 1. Inspect candidate node/relationship counts
MATCH (a:Account)-[:USED_DEVICE|USED_PHONE|USED_EMAIL]->(s)
RETURN labels(s) AS signalType, count(*) AS relationships;

// 2. Detect hub signals
MATCH (s)<-[:USED_DEVICE|USED_PHONE|USED_EMAIL]-(:Account)
WITH s, count(*) AS degree
RETURN labels(s), degree, count(*) AS signalCount
ORDER BY degree DESC
LIMIT 20;

// 3. Create projected relationship semantically
MATCH (a1:Account)-[:USED_DEVICE]->(d:Device)<-[:USED_DEVICE]-(a2:Account)
WHERE id(a1) < id(a2)
  AND d.isPublic = false
MERGE (a1)-[r:SHARES_DEVICE_WITH]->(a2)
SET r.weight = 0.9,
    r.source = 'projection-job',
    r.generatedAt = datetime();
```

Then project for GDS:

```cypher
CALL gds.graph.project(
  'account-signal-graph',
  'Account',
  {
    SHARES_DEVICE_WITH: {
      orientation: 'UNDIRECTED',
      properties: 'weight'
    },
    SHARES_PHONE_WITH: {
      orientation: 'UNDIRECTED',
      properties: 'weight'
    }
  }
);
```

Then run community detection or similarity.

The exact procedure names and options vary by Neo4j/GDS version, so always verify against your installed GDS version.

---

## 32. Java Service Integration Pattern

Do not let application service casually run heavy algorithms during request-response path.

Bad:

```text
HTTP request
  -> run Louvain on 10M node graph
  -> return result
```

Better:

```text
Scheduled analytics job
  -> build/refresh projection
  -> run algorithm
  -> write candidate results
  -> publish event / update read model
  -> API reads reviewed/current result
```

Java architecture:

```text
graph-analytics-job
  - ProjectionBuilder
  - AlgorithmRunner
  - ResultWriter
  - RunMetadataStore
  - QualityMetricCollector

case-service
  - reads candidate similarities
  - displays explanation
  - records review decision

audit-service
  - stores run metadata
  - stores parameter set
  - stores reviewer actions
```

Avoid hiding algorithm execution inside repository methods like:

```java
caseRepository.findSimilarCases(caseId)
```

unless it only reads precomputed similarity results.

Better:

```java
similarCaseQueryService.findPrecomputedSimilarCases(caseId, threshold, limit)
```

---

## 33. Run Metadata Model

For reproducibility:

```cypher
(:AlgorithmRun {
  id,
  algorithm: 'nodeSimilarity',
  algorithmVersion: 'gds-x.y.z',
  projectionName: 'case-similarity-v4',
  projectionCypherHash: '...',
  parameterHash: '...',
  startedAt,
  completedAt,
  status,
  nodeCount,
  relationshipCount,
  resultCount,
  triggeredBy
})
```

Connect result:

```cypher
(:AlgorithmRun)-[:GENERATED]->(:CandidateRelation)
```

For a result edge:

```cypher
(:Case)-[:CANDIDATE_SIMILAR_TO {
  score: 0.82,
  generatedAt,
  status: 'PENDING_REVIEW'
}]->(:Case)
```

You can also model candidate result as node if lifecycle is complex.

---

## 34. Common Mistakes

### Mistake 1: Treating Community as Ground Truth

Wrong:

```text
Community 12 is a fraud ring.
```

Better:

```text
Community 12 is a dense group of accounts sharing rare signals and should be reviewed.
```

### Mistake 2: Ignoring Hubs

If you include generic hubs, everything becomes connected.

### Mistake 3: No Time Window

All historical data can produce stale or misleading clusters.

### Mistake 4: No Versioning

If you cannot reproduce the result, it is weak evidence.

### Mistake 5: Writing Inferred Edges as Facts

`SIMILAR_TO` or `POSSIBLY_RELATED_TO` must be clearly labelled as derived/inferred.

### Mistake 6: Over-Trusting Score

A score is only meaningful relative to:

- projection,
- algorithm,
- parameters,
- data quality,
- threshold,
- validation set.

### Mistake 7: No Review Workflow

High-stakes graph analytics needs review, appeal, and audit.

### Mistake 8: Running Heavy Analytics in Online Transaction

Graph algorithms often belong in batch/near-real-time pipeline, not per-request path.

---

## 35. Decision Matrix

| Need | Better technique |
|---|---|
| Find all nodes connected by any chain | WCC |
| Find directed cycles/strong reachability | SCC |
| Find dense natural groups | Louvain / Leiden / Label Propagation |
| Find local tightness | Triangle count / clustering coefficient |
| Find core of dense network | K-core |
| Find similar entities based on shared neighbors | Node Similarity |
| Find similar entities based on vectors/features | KNN |
| Suggest missing/likely relationship | Link Prediction |
| Produce human-review candidates | Similarity + Link Prediction + explanations |
| Produce legally defensible decision | Algorithm + evidence + review + audit trail |

---

## 36. Domain Exercise: Investigation Graph

Suppose you have:

```text
Person
Account
Device
Phone
Email
Address
Transaction
Merchant
Case
Evidence
```

Relationships:

```text
(:Person)-[:OWNS]->(:Account)
(:Account)-[:USED_DEVICE]->(:Device)
(:Account)-[:USED_PHONE]->(:Phone)
(:Account)-[:USED_EMAIL]->(:Email)
(:Account)-[:SENT_TO]->(:Account)
(:Case)-[:INVOLVES]->(:Person)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
```

Questions:

1. Which accounts form connected suspicious clusters?
2. Which clusters are tightly connected vs loosely connected?
3. Which cases are similar to this new case?
4. Which accounts may be controlled by the same actor?
5. Which candidate links need investigator review?
6. Which signals are generic and should be down-weighted?
7. Which results can be written back safely?
8. Which algorithm outputs require human approval?

Suggested approach:

```text
1. Build rare-signal account-account projection.
2. Run WCC to find connected components.
3. Run Leiden or Label Propagation inside large components.
4. Run Node Similarity for candidate related accounts.
5. Run case similarity on Case-feature graph.
6. Store candidate relationships with score and evidence.
7. Require review before confirmed relationship.
8. Monitor false positive/false negative feedback.
```

---

## 37. Engineering Checklist

Before running algorithm:

```text
[ ] What business question is being answered?
[ ] What node labels are included?
[ ] What relationship types are included?
[ ] Are directions meaningful?
[ ] Are weights meaningful?
[ ] Are generic hubs excluded/down-weighted?
[ ] Is there a time window?
[ ] Is tenant boundary respected?
[ ] Are low-confidence facts excluded or marked?
[ ] Is projection reproducible?
```

Before writing result:

```text
[ ] Is result factual, inferred, predicted, or reviewed?
[ ] Is algorithm version stored?
[ ] Is projection version stored?
[ ] Is score stored?
[ ] Is evidence/reason stored?
[ ] Is review state stored?
[ ] Is expiry/recompute policy defined?
[ ] Is result visible to users with proper access control?
[ ] Is there rollback/supersede strategy?
```

Before using result in decision:

```text
[ ] Was result validated?
[ ] Is threshold justified?
[ ] Is false positive cost acceptable?
[ ] Is false negative cost acceptable?
[ ] Is human review required?
[ ] Can result be explained?
[ ] Can result be reproduced?
[ ] Can affected decision be audited?
```

---

## 38. Mental Model Summary

Community detection, similarity, and link prediction are not magic insight machines.

They are controlled ways to ask:

```text
Given this graph projection,
with these relationship meanings,
with this time window,
with these weights,
with these algorithm parameters,
what hidden grouping, similarity, or likely edge emerges?
```

The quality of the result depends on:

1. domain modelling;
2. projection design;
3. signal quality;
4. hub filtering;
5. algorithm choice;
6. parameter tuning;
7. validation;
8. review workflow;
9. auditability.

For top-tier engineering, the skill is not merely knowing the algorithm names. The skill is knowing how to turn graph analytics into a safe, explainable, reproducible, and operationally useful system.

---

## 39. What You Should Be Able to Do After This Part

You should now be able to:

1. distinguish connected components, community detection, similarity, clustering, and link prediction;
2. choose WCC/SCC when the problem is about reachability groups;
3. choose community detection when the problem is about dense group structure;
4. choose similarity when the problem is pairwise likeness;
5. choose link prediction when the problem is candidate relationship discovery;
6. design graph projections deliberately;
7. reason about hubs, time windows, weights, and noise;
8. avoid treating algorithm result as truth;
9. model inferred candidate relationships safely;
10. design human-in-the-loop review for high-stakes graph analytics;
11. build a Java-side architecture that reads precomputed results rather than running heavy algorithms per request;
12. make graph analytics defensible in audit-heavy environments.

---

## 40. Bridge to Next Part

Part 024 will go deeper into **Path Finding, Routing, and Impact Analysis**.

Community and similarity ask:

```text
Who belongs together?
Who resembles whom?
What relationship may be missing?
```

Path finding asks:

```text
What is the best route?
What is the cheapest path?
What is the blast radius?
How does impact propagate?
Which chain explains the connection?
```

That is essential for dependency analysis, supply chain risk, case escalation, network routing, fraud investigation, and regulatory impact analysis.

---

# End of Part 023

File name:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-023.md
```

Seri belum selesai. Lanjut ke Part 024.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-022.md">⬅️ Part 022 — Centrality, Influence, and Importance Algorithms</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-024.md">Part 024 — Path Finding, Routing, and Impact Analysis ➡️</a>
</div>
