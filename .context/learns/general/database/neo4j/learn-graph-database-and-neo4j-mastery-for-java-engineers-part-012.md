# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-012.md

# Part 012 — Supernodes, Dense Graphs, and Traversal Explosion

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Audience: Java software engineer / tech lead  
> Fokus: graph database, Neo4j, modelling, traversal safety, performance failure modes

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 011, kita sudah membangun fondasi:

- mengapa graph database ada,
- cara berpikir node/relationship/path,
- property graph model,
- arsitektur Neo4j,
- Cypher fundamentals,
- path semantics,
- modelling methodology,
- advanced modelling patterns,
- anti-patterns,
- constraints/indexes,
- write correctness,
- query performance dengan `EXPLAIN` dan `PROFILE`.

Part ini fokus pada salah satu masalah paling penting dan paling sering membuat graph database terlihat “lambat” di production:

> query traversal melewati node dengan konektivitas sangat besar, lalu query meledak secara kombinatorial.

Masalah ini biasanya disebut:

- **supernode problem**,
- **dense node problem**,
- **high-degree node problem**,
- **traversal explosion**,
- **fan-out explosion**,
- **unbounded expansion**.

Ini bukan hanya isu Neo4j. Ini isu fundamental pada sistem yang memproses graph. Namun Neo4j membuat relationship traversal sangat ekspresif, sehingga engineer bisa dengan mudah menulis query yang tampak sederhana tetapi efek runtime-nya sangat besar.

Contoh query yang terlihat jinak:

```cypher
MATCH p = (:Person {id: $personId})-[:CONNECTED_TO*1..5]-(:Person)
RETURN p
```

Secara bisnis mungkin terdengar seperti:

> cari koneksi sampai 5 tingkat.

Secara runtime bisa berarti:

> mulai dari 1 node, buka semua relationship level 1, dari setiap hasil buka semua relationship level 2, ulangi sampai depth 5, termasuk kemungkinan cycle, duplicate, dan path alternatif.

Jika rata-rata fan-out 50, depth 5 dapat menghasilkan orde:

```text
50^5 = 312,500,000 kemungkinan ekspansi kasar
```

Angka riil tergantung filter, arah, uniqueness, relationship type, cycle, index anchor, dan operator plan. Tetapi mental modelnya harus jelas:

> graph traversal murah hanya ketika ekspansi dikendalikan.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, Anda harus mampu:

1. Menjelaskan apa itu supernode dan dense node.
2. Membedakan high-degree node yang sehat vs high-degree node yang merusak performa.
3. Menghitung risiko fan-out sebelum query dijalankan.
4. Mendesain traversal boundary yang aman.
5. Mengenali query Cypher yang berpotensi meledak.
6. Membaca tanda-tanda traversal explosion di `PROFILE`.
7. Memilih strategi modelling untuk menghindari supernode.
8. Menggunakan relationship direction, type, property, dan intermediate node secara sadar.
9. Mendesain graph untuk domain regulatory, fraud, IAM, dependency, recommendation, dan case management tanpa membuat “semua node dekat dengan semua node”.
10. Membuat checklist review query dan schema untuk graph production.

---

## 2. Core Mental Model: Graph Performance Is Controlled Expansion

Pada relational database, performa sering dibahas dengan mental model:

```text
selectivity → index access → join order → row count → sort/hash/aggregate cost
```

Pada graph database, mental model performa traversal adalah:

```text
anchor node → expansion → filter → next expansion → path count → memory/result cost
```

Graph query biasanya buruk ketika:

1. anchor terlalu luas,
2. relationship expansion terlalu besar,
3. filter dilakukan setelah ekspansi,
4. depth terlalu dalam,
5. direction tidak spesifik,
6. relationship type terlalu umum,
7. node yang dilewati memiliki degree ekstrem,
8. query meminta semua path, bukan node unik atau path terbaik,
9. model membuat node global yang menjadi hub semua hal.

Dengan kata lain:

> masalah graph performance jarang hanya “kurang index”; sering kali masalahnya adalah “kita membiarkan query berjalan ke terlalu banyak relationship”.

Index membantu menemukan titik awal. Setelah traversal dimulai, index bukan alat utama lagi. Alat utama adalah desain graph dan batas traversal.

---

## 3. Degree: Ukuran Dasar Risiko Traversal

Dalam graph, **degree** adalah jumlah relationship yang terhubung ke sebuah node.

Jika relationship directional, kita bisa membedakan:

```text
in-degree  = jumlah relationship masuk
out-degree = jumlah relationship keluar
total degree = in-degree + out-degree
```

Contoh:

```text
(:Person {id: 'P1'})-[:OWNS]->(:Company)
(:Person {id: 'P1'})-[:DIRECTOR_OF]->(:Company)
(:Person {id: 'P1'})<-[:REPORTS_TO]-(:Person)
```

Node `P1` punya:

```text
out-degree: 2
in-degree: 1
total degree: 3
```

Degree bukan masalah dengan sendirinya. Node dengan 10.000 relationship bisa sehat bila:

- query jarang melewatinya,
- relationship type sangat terseleksi,
- arah query jelas,
- property relationship membatasi ekspansi,
- node hanya dipakai untuk lookup administratif,
- traversal berhenti sebelum masuk ke hub tersebut.

Sebaliknya node dengan 2.000 relationship bisa menjadi masalah jika berada di tengah path query penting.

---

## 4. Apa Itu Supernode?

**Supernode** adalah node yang memiliki jumlah relationship jauh lebih besar daripada node lain dalam graph dan sering menyebabkan traversal menjadi mahal.

Definisi angka absolutnya tidak universal.

Node dengan 1 juta relationship hampir pasti perlu perhatian. Tetapi node dengan 20.000 relationship juga bisa menjadi supernode jika query umum melewatinya berkali-kali. Bahkan node dengan 5.000 relationship bisa berbahaya jika berada di path variable-length dengan depth 4.

Lebih tepatnya:

> supernode adalah node yang degree-nya membuat query path atau write operation menjadi tidak proporsional terhadap nilai bisnis yang dihasilkan.

Contoh supernode umum:

| Domain | Supernode Kandidat | Mengapa Berbahaya |
|---|---:|---|
| Social graph | Celebrity user | Jutaan follower, traversal mutual/friend-of-friend meledak |
| Fraud | IP address publik/NAT | Ribuan akun berbagi IP yang sama |
| Banking | Merchant besar | Jutaan transaksi ke merchant populer |
| Case management | Status “OPEN” | Semua case open terhubung ke satu node status |
| IAM | Role “Employee” | Hampir semua user punya role yang sama |
| Product graph | Category “Electronics” | Terlalu banyak product masuk satu category |
| Geography | Country “Indonesia” | Semua address/user/case terhubung ke negara yang sama |
| Time graph | Date node “2026-01-01” | Semua event hari itu menumpuk pada satu node |
| Knowledge graph | Concept “Entity” | Terlalu generik, semua hal terhubung |
| Dependency graph | Root service/platform | Semua service bergantung ke root abstraction |

Supernode sering lahir dari niat baik:

- ingin menghindari duplikasi property,
- ingin membuat lookup mudah,
- ingin memodelkan taxonomy,
- ingin membuat relationship explicit,
- ingin semua entity connected,
- ingin query “natural language” mudah divisualisasi.

Namun graph yang terlalu connected dapat menghilangkan keunggulan traversal.

---

## 5. Dense Node vs Supernode

Istilah **dense node** dan **supernode** sering dipakai bergantian, tetapi berguna dibedakan:

```text
Dense node:
  node dengan banyak relationship secara struktur internal.

Supernode:
  dense node yang menjadi masalah modelling/query/operational.
```

Tidak semua dense node buruk.

Contoh dense node yang dapat diterima:

```text
(:Country {code:'ID'})
```

Jika hanya dipakai untuk referensi display atau validasi, mungkin aman.

Contoh dense node yang buruk:

```cypher
MATCH p = (:Person {id:$id})-[:LIVES_IN|REGISTERED_IN|VISITED*1..4]-(:Person)
RETURN p
```

Jika query ini bisa melewati `(:Country {code:'ID'})`, maka graph menjadi terlalu kecil secara topologis: hampir semua orang dapat terhubung melalui country. Hasilnya tidak bermakna dan sangat mahal.

Prinsipnya:

> dense node boleh ada, tetapi jangan biarkan ia menjadi jembatan traversal umum kecuali memang itu maksud analisisnya.

---

## 6. Fan-Out: Matematika Sederhana di Balik Ledakan Traversal

Jika setiap node pada rata-rata punya `b` relationship relevan dan traversal depth `d`, jumlah ekspansi kasar dapat mendekati:

```text
b^d
```

Contoh:

| Fan-out per level | Depth | Ekspansi Kasar |
|---:|---:|---:|
| 5 | 3 | 125 |
| 10 | 3 | 1.000 |
| 20 | 3 | 8.000 |
| 50 | 3 | 125.000 |
| 50 | 4 | 6.250.000 |
| 100 | 4 | 100.000.000 |
| 100 | 5 | 10.000.000.000 |

Dalam graph nyata, angka ini bisa lebih kecil karena:

- ada duplicate node,
- ada cycle prevention,
- ada filter,
- ada relationship direction,
- ada label/type restriction,
- ada query planner optimization,
- ada limit.

Tetapi bisa juga lebih buruk secara memory/result karena query mengembalikan path, bukan hanya node.

Contoh: dua node bisa punya banyak path alternatif di antara mereka. Jika query meminta semua path, bukan sekadar reachable nodes, jumlah path bisa jauh lebih besar dari jumlah node.

---

## 7. Node Count Kecil Tidak Berarti Query Murah

Kesalahan umum:

> “Graph kami hanya 2 juta node, seharusnya cepat.”

Graph size bukan hanya node count.

Yang lebih relevan untuk traversal:

- relationship count,
- degree distribution,
- average degree,
- max degree,
- relationship type distribution,
- direction distribution,
- clustering coefficient,
- path depth,
- number of alternative paths,
- result cardinality,
- query anchor selectivity.

Graph dengan 2 juta node dan 500 juta relationship bisa jauh lebih berat daripada graph dengan 50 juta node dan 70 juta relationship, tergantung query.

Yang penting bukan hanya:

```text
berapa banyak data?
```

Tapi:

```text
berapa banyak relationship yang harus disentuh untuk menjawab satu pertanyaan?
```

---

## 8. Degree Distribution: Average Degree Menipu

Average degree bisa terlihat aman tetapi menyembunyikan long tail.

Misal:

```text
Total nodes: 1.000.000
Total relationships: 5.000.000
Average degree kira-kira: 10
```

Kedengarannya aman.

Tetapi distribusinya bisa seperti:

```text
900.000 node punya degree 2-5
99.900 node punya degree 10-100
100 node punya degree 500.000+
```

Query yang kebetulan melewati 100 node ekstrem itu bisa runtuh.

Karena itu, untuk graph production Anda harus memonitor:

- max degree per label,
- max degree per relationship type,
- percentile degree: p50, p90, p95, p99, p99.9,
- top high-degree nodes,
- high-degree node yang sering muncul di query path.

Contoh query inspeksi sederhana:

```cypher
MATCH (n:Person)-[r]-()
WITH n, count(r) AS degree
RETURN n.id AS personId, degree
ORDER BY degree DESC
LIMIT 20;
```

Per relationship type:

```cypher
MATCH (n:Person)-[r:USES_IP]-()
WITH n, count(r) AS ipDegree
RETURN n.id AS personId, ipDegree
ORDER BY ipDegree DESC
LIMIT 20;
```

Untuk incoming degree:

```cypher
MATCH (ip:IPAddress)<-[r:USES_IP]-(:Account)
WITH ip, count(r) AS accounts
RETURN ip.value AS ip, accounts
ORDER BY accounts DESC
LIMIT 20;
```

---

## 9. Supernode Terbentuk dari Model yang Terlalu Literal

Graph modelling yang terlalu literal sering membuat node global.

Contoh buruk:

```text
(:Case)-[:HAS_STATUS]->(:Status {name:'OPEN'})
(:Case)-[:HAS_STATUS]->(:Status {name:'CLOSED'})
(:Case)-[:HAS_STATUS]->(:Status {name:'ESCALATED'})
```

Jika ada 5 juta case open, maka `(:Status {name:'OPEN'})` menjadi hub 5 juta relationship.

Apakah status harus menjadi node? Mungkin tidak.

Alternatif:

```text
(:Case {status:'OPEN'})
```

Lalu index:

```cypher
CREATE INDEX case_status IF NOT EXISTS
FOR (c:Case)
ON (c.status);
```

Kapan status sebagai node masuk akal?

Jika status punya lifecycle, policy, allowed transitions, ownership, SLA, audit rule, atau metadata yang sering ditraverse.

Contoh lebih kuat:

```text
(:Case)-[:CURRENT_STATE]->(:WorkflowState {code:'OPEN'})
(:WorkflowState)-[:ALLOWS_TRANSITION_TO]->(:WorkflowState {code:'ESCALATED'})
(:WorkflowState)-[:HAS_SLA]->(:SlaPolicy)
```

Namun jangan memakai node status sebagai jembatan untuk menemukan related case kecuali memang semua case open ingin dianggap related. Biasanya itu salah.

---

## 10. Supernode Terbentuk dari Category yang Terlalu Umum

Contoh product graph:

```text
(:Product)-[:IN_CATEGORY]->(:Category {name:'Electronics'})
```

Jika query recommendation:

```cypher
MATCH (:User {id:$userId})-[:BOUGHT]->(:Product)-[:IN_CATEGORY]->(:Category)<-[:IN_CATEGORY]-(p:Product)
RETURN p
```

Jika category `Electronics` punya 2 juta product, query membuka terlalu banyak kandidat.

Solusi modelling bisa berupa:

1. Gunakan category lebih spesifik:

```text
Product → Smartphone → Android Phone → Midrange Android Phone
```

2. Tambahkan taxonomy depth dan hindari traversal ke root category.
3. Gunakan property untuk category luas, node untuk category yang traversal-worthy.
4. Gunakan materialized similarity edge:

```text
(:Product)-[:SIMILAR_TO {score:0.83, method:'co_purchase'}]->(:Product)
```

5. Gunakan GDS/offline pipeline untuk menghitung kandidat, bukan traversal online melalui category supernode.

---

## 11. Supernode Terbentuk dari Time Node yang Terlalu Kasar

Contoh buruk:

```text
(:Transaction)-[:OCCURRED_ON]->(:Date {value:'2026-06-21'})
```

Jika sistem punya 50 juta transaksi per hari, node tanggal menjadi supernode.

Apakah date harus node? Tergantung.

Untuk filter waktu, property lebih baik:

```text
(:Transaction {occurredAt: datetime('2026-06-21T10:15:00Z')})
```

Dengan index:

```cypher
CREATE INDEX transaction_occurred_at IF NOT EXISTS
FOR (t:Transaction)
ON (t.occurredAt);
```

Time node bisa berguna jika:

- Anda memodelkan calendar semantics,
- holiday/business day relation,
- period hierarchy,
- reporting bucket sebagai entity,
- schedule dependency.

Namun untuk transaksi/event high-volume, hati-hati.

Alternatif jika butuh bucket:

```text
(:Transaction)-[:OCCURRED_IN]->(:TimeBucket {granularity:'hour', value:'2026-06-21T10'})
```

Atau bucket per tenant/domain:

```text
(:Transaction)-[:OCCURRED_IN]->(:MerchantDayBucket {merchantId:'M1', date:'2026-06-21'})
```

Ini mengurangi satu global date node menjadi banyak node bucket yang lebih kecil.

---

## 12. Supernode dari IP Address, Device, Phone, Email, dan Identifier Bersama

Dalam fraud graph, identifier bersama sering menjadi sinyal penting:

```text
(:Account)-[:USES_IP]->(:IPAddress)
(:Account)-[:USES_DEVICE]->(:Device)
(:Account)-[:USES_EMAIL]->(:Email)
(:Account)-[:USES_PHONE]->(:Phone)
```

Masalahnya, tidak semua identifier punya nilai sinyal yang sama.

Contoh:

- private residential IP dipakai 3 akun → sinyal kuat,
- public NAT IP kampus dipakai 30.000 akun → sinyal lemah,
- corporate proxy dipakai 100.000 akun → supernode,
- disposable email domain dipakai jutaan akun → bukan node kandidat traversal langsung.

Jika query:

```cypher
MATCH p = (:Account {id:$accountId})-[:USES_IP|USES_DEVICE|USES_PHONE*1..4]-(:Account)
RETURN p
```

Query ini bisa menganggap semua sharing sama penting. Akun yang berbagi NAT publik tampak “related”, padahal mungkin noise.

Model yang lebih baik harus membedakan signal quality:

```text
(:Account)-[:USES_IP {firstSeen, lastSeen, confidence}]->(:IPAddress {type:'RESIDENTIAL', risk:'LOW'})
(:IPAddress {isSharedInfrastructure:true})
```

Traversal harus menghindari identifier terlalu umum:

```cypher
MATCH p = (:Account {id:$id})-[:USES_IP|USES_DEVICE*1..3]-(other:Account)
WHERE all(n IN nodes(p)
  WHERE NOT (n:IPAddress AND coalesce(n.isSharedInfrastructure, false) = true)
)
RETURN p
LIMIT 100;
```

Lebih baik lagi: filter saat expansion bila syntax memungkinkan, bukan setelah semua path terbentuk.

---

## 13. Regulatory Case Management: Supernode yang Sering Tidak Disadari

Dalam sistem enforcement/regulatory, supernode sering muncul dari konsep administratif.

Contoh node yang rawan:

```text
(:Regulation {code:'AML'})
(:Agency {name:'Financial Authority'})
(:CaseStatus {code:'OPEN'})
(:RiskLevel {code:'HIGH'})
(:OfficerRole {code:'Investigator'})
(:Jurisdiction {code:'National'})
(:ViolationType {code:'Late Filing'})
(:WorkflowState {code:'Under Review'})
```

Pertanyaan penting:

> Apakah node ini dipakai sebagai dimension/reference, atau sebagai jembatan untuk traversal investigasi?

Jika semua case `OPEN` terhubung ke satu status node, query berikut berbahaya:

```cypher
MATCH (c:Case {id:$caseId})-[:HAS_STATUS]->(:CaseStatus)<-[:HAS_STATUS]-(related:Case)
RETURN related;
```

Secara formal benar:

> case terkait karena punya status yang sama.

Secara domain sering tidak berguna:

> jutaan case open bukan berarti related.

Lebih meaningful:

```cypher
MATCH (c:Case {id:$caseId})-[:SUBJECT_OF]->(entity:RegulatedEntity)<-[:SUBJECT_OF]-(related:Case)
WHERE related.status = 'OPEN'
RETURN related;
```

Status menjadi filter, bukan path connector.

Prinsip regulatory graph:

> relationship investigatif harus menghubungkan entity berdasarkan alasan substantif, bukan atribut administratif generik.

---

## 14. IAM/Entitlement Graph: Role dan Group sebagai Supernode

IAM graph sering memakai pola:

```text
(:User)-[:MEMBER_OF]->(:Group)
(:Group)-[:HAS_ROLE]->(:Role)
(:Role)-[:GRANTS]->(:Permission)
(:Permission)-[:APPLIES_TO]->(:Resource)
```

Ini graph-shaped dan berguna.

Tetapi role umum seperti `Employee`, `AuthenticatedUser`, `ReadOnly`, atau `AllStaff` bisa menjadi supernode.

Query blast radius:

```cypher
MATCH p = (:User {id:$userId})-[:MEMBER_OF|HAS_ROLE|GRANTS*1..5]->(:Resource)
RETURN p
```

Jika path melewati `AllEmployees`, hasilnya bisa sangat besar.

Solusi:

1. Bedakan role administratif vs role akses nyata.
2. Jangan traverse role global untuk rekomendasi akses spesifik.
3. Gunakan scope:

```text
(:Role {code:'Reviewer', scope:'Department:Enforcement'})
```

4. Representasikan inherited global permission sebagai policy rule, bukan relationship eksplisit ke semua resource.
5. Gunakan derived entitlement cache untuk query online:

```text
(:User)-[:EFFECTIVE_ACCESS {source:'computed', validAt}]->(:Resource)
```

6. Jalankan toxic-combination analysis secara batch/GDS, bukan selalu online traversal bebas.

---

## 15. Dependency Graph: Root Platform dan Common Library sebagai Hub

Dependency graph juga rawan supernode.

Contoh:

```text
(:Service)-[:DEPENDS_ON]->(:Library {name:'spring-core'})
(:Service)-[:RUNS_ON]->(:Platform {name:'Kubernetes'})
(:Service)-[:USES]->(:Database {name:'PostgreSQL'})
```

Node seperti `Kubernetes`, `spring-core`, `PostgreSQL`, `Java`, atau `Linux` bisa menghubungkan hampir semua service.

Jika query impact analysis tidak membatasi relationship type dan semantic relevance:

```cypher
MATCH p = (:Service {name:$service})-[:DEPENDS_ON|USES|RUNS_ON*1..5]-(:Service)
RETURN p
```

Maka hampir semua service bisa terlihat related karena sama-sama memakai platform umum.

Solusi:

- pisahkan dependency operational dengan dependency semantic,
- jangan gunakan common platform sebagai connector untuk impact path antar service,
- gunakan relationship type spesifik:

```text
CALLS
PUBLISHES_TO
CONSUMES_FROM
OWNS_TABLE
READS_FROM
WRITES_TO
```

- jadikan common technology sebagai property/tag untuk filtering,
- gunakan weighted relationship jika common dependency punya bobot rendah,
- path impact harus melewati edge yang menunjukkan propagation risk nyata.

---

## 16. Supernode Tidak Selalu Harus Dihapus

Strategi yang buruk:

> semua supernode harus dipecah.

Tidak selalu.

Pertama, tanyakan:

1. Apakah node ini sering dilewati query traversal?
2. Apakah relationship type di node ini spesifik?
3. Apakah query hanya melakukan lookup direct neighbor?
4. Apakah query dibatasi limit, property, direction, atau depth?
5. Apakah node ini berada pada jalur variable-length?
6. Apakah node ini menghasilkan result yang meaningful?
7. Apakah masalahnya read, write, lock contention, atau visualisasi?

Dense node yang hanya dipakai seperti ini mungkin aman:

```cypher
MATCH (country:Country {code:'ID'})
RETURN country.name;
```

Atau:

```cypher
MATCH (case:Case {id:$id})-[:IN_JURISDICTION]->(j:Jurisdiction)
RETURN j.code;
```

Yang berbahaya:

```cypher
MATCH (case:Case {id:$id})-[:IN_JURISDICTION*1..3]-(other)
RETURN other;
```

Rule:

> dense node aman sebagai endpoint lookup; berbahaya sebagai transit hub.

---

## 17. Tanda-Tanda Traversal Explosion di `PROFILE`

Dalam `PROFILE`, perhatikan:

1. Operator expansion menghasilkan rows sangat besar.
2. `DB Hits` melonjak pada operator expand.
3. Estimated rows jauh lebih kecil dari actual rows.
4. Banyak operator `Filter` muncul setelah expansion besar.
5. Ada `CartesianProduct`.
6. Ada `Eager` yang menahan banyak rows.
7. Memory tinggi pada aggregation/sort/distinct.
8. Query cepat jika depth 1, sangat lambat jika depth 2 atau 3.
9. `LIMIT` di akhir tidak membantu banyak.
10. Hasil bisnis kecil, tetapi work internal besar.

Contoh masalah:

```cypher
PROFILE
MATCH p = (:Account {id:$id})-[:USES_IP|USES_DEVICE|TRANSFERRED_TO*1..4]-(other:Account)
WHERE other.status = 'ACTIVE'
RETURN DISTINCT other
LIMIT 100;
```

Masalah:

- `LIMIT 100` baru berlaku setelah path diekspansi dan `DISTINCT` dihitung.
- `WHERE other.status = 'ACTIVE'` mungkin terlalu akhir.
- Relationship types tercampur antara identity signal dan transaction signal.
- Undirected traversal `-[]-` membuka dua arah.
- Depth 4 bisa melewati IP publik/device umum.

Rewrite pertama:

```cypher
PROFILE
MATCH (start:Account {id:$id})
MATCH (start)-[:USES_DEVICE]->(d:Device)<-[:USES_DEVICE]-(other:Account)
WHERE other.status = 'ACTIVE'
RETURN DISTINCT other
LIMIT 100;
```

Rewrite ini:

- anchor jelas,
- path hanya 2 hop,
- relationship type spesifik,
- tidak mencampur semantics,
- lebih mudah diprofile.

Rewrite kedua dengan guard:

```cypher
PROFILE
MATCH (start:Account {id:$id})-[:USES_DEVICE]->(d:Device)
WHERE d.accountCount <= 20
MATCH (d)<-[:USES_DEVICE]-(other:Account)
WHERE other.status = 'ACTIVE'
RETURN DISTINCT other
LIMIT 100;
```

`accountCount` adalah property precomputed untuk mencegah traversal melalui shared device/identifier besar.

---

## 18. `LIMIT` Bukan Obat Traversal Explosion

Kesalahan umum:

```cypher
MATCH p = (:A {id:$id})-[*1..5]-(:B)
RETURN p
LIMIT 10;
```

Engineer berharap database berhenti setelah menemukan 10 path.

Tergantung plan dan semantics, database sering tetap harus mengeksplorasi banyak kandidat, terutama jika:

- ada `DISTINCT`,
- ada `ORDER BY`,
- ada aggregation,
- ada filter setelah expansion,
- path harus dipastikan memenuhi predicate,
- result tidak bisa stream secara langsung.

Contoh lebih buruk:

```cypher
MATCH p = (:A {id:$id})-[*1..5]-(:B)
WITH p, length(p) AS hops
ORDER BY hops ASC
RETURN p
LIMIT 10;
```

`ORDER BY` bisa memaksa kumpulkan kandidat lebih banyak sebelum limit.

Lebih baik:

- batasi relationship type,
- batasi direction,
- batasi depth,
- filter selama expansion,
- gunakan shortest path jika benar-benar butuh shortest,
- gunakan GDS untuk path algorithm tertentu,
- gunakan precomputed relationship untuk query online.

---

## 19. Direction Matters

Undirected pattern:

```cypher
(a)-[:REL]-(b)
```

lebih luas daripada directed pattern:

```cypher
(a)-[:REL]->(b)
```

atau:

```cypher
(a)<-[:REL]-(b)
```

Pada graph kecil, perbedaannya mungkin tidak terasa.

Pada dense graph, undirected traversal bisa menggandakan search space dan membuka path yang secara domain tidak valid.

Contoh ownership:

```text
(:Person)-[:OWNS]->(:Company)
(:Company)-[:OWNS]->(:Subsidiary)
```

Jika Anda mencari controlled entities downstream:

```cypher
MATCH p = (:Person {id:$id})-[:OWNS*1..5]->(:Company)
RETURN p;
```

Jangan pakai:

```cypher
MATCH p = (:Person {id:$id})-[:OWNS*1..5]-(:Company)
RETURN p;
```

Karena undirected bisa naik turun ownership chain dan menghasilkan path yang tidak sesuai meaning.

Prinsip:

> relationship direction bukan dekorasi; ia adalah constraint traversal.

---

## 20. Relationship Type Specificity

Relationship type terlalu umum sering menjadi sumber supernode traversal.

Buruk:

```text
(:Entity)-[:RELATED_TO]->(:Entity)
```

Lebih baik:

```text
(:Person)-[:OWNS]->(:Company)
(:Person)-[:DIRECTOR_OF]->(:Company)
(:Person)-[:BENEFICIAL_OWNER_OF]->(:Company)
(:Company)-[:SUBSIDIARY_OF]->(:Company)
(:Company)-[:REGISTERED_AT]->(:Address)
(:Person)-[:RESIDES_AT]->(:Address)
```

`RELATED_TO` memang fleksibel, tetapi query harus memeriksa property relationship untuk meaning:

```cypher
MATCH (a)-[r:RELATED_TO]->(b)
WHERE r.kind IN ['OWNS','DIRECTOR_OF']
RETURN b;
```

Dalam banyak workload, relationship type spesifik lebih baik karena expansion dapat langsung terbatas pada type yang relevan:

```cypher
MATCH (a)-[:OWNS|DIRECTOR_OF]->(b)
RETURN b;
```

Namun type explosion juga buruk. Jangan membuat type terlalu granular seperti:

```text
OWNS_2024
OWNS_2025
OWNS_ACTIVE
OWNS_INACTIVE
OWNS_HIGH_CONFIDENCE
OWNS_LOW_CONFIDENCE
```

Gunakan relationship type untuk semantic verb stabil, property untuk qualifier.

Rule:

```text
Relationship type = apa hubungan itu.
Relationship property = detail tentang hubungan itu.
```

---

## 21. Boundary Conditions: Pertanyaan Wajib Sebelum Variable-Length Query

Sebelum menulis:

```cypher
[*1..N]
```

jawab pertanyaan ini:

1. Apa anchor node-nya dan apakah unique?
2. Berapa max degree anchor?
3. Relationship type apa yang dilewati?
4. Apakah direction jelas?
5. Berapa max degree node intermediate?
6. Apakah ada node type yang harus dilarang sebagai transit?
7. Apakah ada cycle?
8. Apakah butuh semua path atau hanya reachable nodes?
9. Apakah path harus simple path?
10. Apakah depth N punya justifikasi bisnis?
11. Apakah filter bisa diterapkan selama expansion?
12. Berapa expected result size p50/p95/p99?
13. Apakah query online user-facing atau batch/admin?
14. Apa timeout yang acceptable?
15. Apa fallback jika hasil terlalu besar?

Jika Anda tidak bisa menjawab, query belum siap production.

---

## 22. Pattern: Degree Guard Property

Salah satu teknik praktis adalah menyimpan jumlah koneksi pada node yang berpotensi menjadi hub.

Contoh:

```text
(:IPAddress {value:'1.2.3.4', accountCount: 38291, classification:'PUBLIC_NAT'})
(:Device {id:'D1', accountCount: 3})
(:Phone {value:'+62...', accountCount: 2})
```

Query:

```cypher
MATCH (a:Account {id:$id})-[:USES_IP]->(ip:IPAddress)
WHERE ip.accountCount <= 20
MATCH (ip)<-[:USES_IP]-(other:Account)
RETURN other;
```

Manfaat:

- query bisa menghindari supernode sebelum ekspansi balik,
- semantics lebih baik karena shared infrastructure tidak dianggap sinyal kuat,
- threshold bisa disesuaikan per domain.

Trade-off:

- property harus dipelihara,
- write lebih kompleks,
- count bisa stale,
- concurrent update perlu strategi.

Untuk high-volume ingestion, sering lebih baik update count via batch/reconciliation daripada setiap write synchronous.

---

## 23. Pattern: Time-Bucketed Relationship

Masalah:

```text
(:Account)-[:TRANSFERRED_TO]->(:Account)
```

Jika dua akun bertransaksi ribuan kali, relationship tunggal dengan aggregate property mungkin kehilangan detail. Tetapi event-node per transaction bisa membuat graph sangat besar.

Alternatif:

```text
(:Account)-[:TRANSFERRED_TO {day:'2026-06-21', count:42, amount:1000000}]->(:Account)
```

Atau bucket node:

```text
(:Account)-[:SENT_IN]->(:TransferBucket {from:'A', to:'B', day:'2026-06-21'})-[:TO]->(:Account)
```

Namun bucket node juga bisa menjadi supernode jika terlalu kasar.

Baik:

```text
Merchant + day
Account pair + day
Device + hour
Case queue + team + day
```

Buruk:

```text
All transactions + global day
All users + global month
All events + one category
```

Prinsip:

> bucket harus membagi beban berdasarkan dimensi yang memang membatasi query.

---

## 24. Pattern: Intermediate Grouping Nodes

Misal node `Merchant` terlalu besar:

```text
(:Account)-[:PAID]->(:Merchant {id:'M_BIG'})
```

Jika merchant besar punya 100 juta paying accounts, traversal dari merchant ke account sangat mahal.

Bisa dibuat intermediate grouping:

```text
(:Account)-[:PAID_IN]->(:MerchantDay {merchantId:'M_BIG', date:'2026-06-21'})-[:OF_MERCHANT]->(:Merchant)
```

Query fraud yang mencari akun yang membayar merchant sama dalam hari yang sama:

```cypher
MATCH (:Account {id:$id})-[:PAID_IN]->(bucket:MerchantDay)<-[:PAID_IN]-(other:Account)
RETURN other;
```

Sekarang query tidak membuka semua account merchant sepanjang sejarah, hanya bucket yang relevan.

Namun ini hanya benar jika domain memang peduli pada co-occurrence dalam waktu tertentu.

Jangan menambahkan bucket hanya untuk performa tanpa mempertahankan meaning.

---

## 25. Pattern: Materialized Shortcut Relationship

Jika query path mahal sering dipakai, Anda bisa membuat relationship derived.

Contoh asli:

```text
(:Person)-[:OWNS]->(:Company)-[:OWNS]->(:Company)-[:OWNS]->(:Company)
```

Query beneficial ownership sampai 5 level bisa mahal.

Derived edge:

```text
(:Person)-[:ULTIMATELY_CONTROLS {depth:3, confidence:0.91, computedAt}]->(:Company)
```

Query online:

```cypher
MATCH (:Person {id:$id})-[:ULTIMATELY_CONTROLS]->(c:Company)
RETURN c;
```

Manfaat:

- cepat,
- explainable jika menyimpan metadata/path reference,
- cocok untuk user-facing system.

Risiko:

- derived edge bisa stale,
- perlu recomputation,
- perlu provenance,
- perlu invalidation logic,
- graph berisi fact asli dan fact turunan; jangan dicampur tanpa label jelas.

Pattern ini sangat berguna untuk regulatory/AML/beneficial ownership graph.

---

## 26. Pattern: Excluding Generic Transit Nodes

Dalam banyak graph, beberapa node boleh muncul sebagai endpoint tapi tidak boleh menjadi transit.

Contoh:

- `Country`,
- `Status`,
- `CommonRole`,
- `PublicIPAddress`,
- `PopularMerchant`,
- `RootCategory`,
- `CommonLibrary`.

Tambahkan property:

```text
(:IPAddress {value:'x', allowTransit:false})
(:Category {name:'Electronics', allowTransit:false})
(:Role {code:'Employee', allowTransit:false})
```

Query dapat menolak path yang melewati transit terlarang.

```cypher
MATCH p = (:Account {id:$id})-[:USES_IP|USES_DEVICE|ASSOCIATED_WITH*1..3]-(other:Account)
WHERE all(n IN nodes(p)[1..-1]
  WHERE coalesce(n.allowTransit, true) = true
)
RETURN p
LIMIT 100;
```

Namun filtering setelah path terbentuk bisa tetap mahal. Jika memungkinkan, desain relationship dan query agar tidak membuka transit node sejak awal.

Lebih kuat:

- pisahkan relationship type untuk signal kuat dan lemah,
- jangan masukkan generic nodes dalam relationship set query utama,
- precompute safe candidate edges.

---

## 27. Pattern: Split Relationship Semantics by Signal Strength

Buruk:

```text
(:Account)-[:ASSOCIATED_WITH]->(:Identifier)
```

Semua association dianggap sama.

Lebih baik:

```text
(:Account)-[:STRONG_IDENTIFIER]->(:Device)
(:Account)-[:MEDIUM_IDENTIFIER]->(:Phone)
(:Account)-[:WEAK_IDENTIFIER]->(:IPAddress)
(:Account)-[:ADMIN_ATTRIBUTE]->(:Country)
```

Atau tetap pakai type domain tetapi query grouping jelas:

```text
USES_DEVICE
USES_PHONE
USES_EMAIL
USES_IP
IN_COUNTRY
HAS_STATUS
```

Lalu query investigatif memilih edge yang benar:

```cypher
MATCH p = (:Account {id:$id})-[:USES_DEVICE|USES_PHONE|USES_EMAIL*1..3]-(other:Account)
RETURN p;
```

Jangan campur `IN_COUNTRY` dan `HAS_STATUS` dalam path investigatif kecuali memang ada alasan kuat.

---

## 28. Pattern: Relationship Property Filter

Relationship property bisa membatasi traversal.

Contoh ownership:

```text
(:Person)-[:OWNS {percentage: 75, active:true, validFrom, validTo}]->(:Company)
```

Query:

```cypher
MATCH p = (:Person {id:$id})-[:OWNS*1..5]->(:Company)
WHERE all(r IN relationships(p)
  WHERE r.active = true AND r.percentage >= 25
)
RETURN p;
```

Lebih baik jika filter bisa ditempatkan pada relationship pattern/quantified pattern sesuai syntax Cypher yang digunakan.

Intinya:

> jangan traverse semua ownership lalu buang yang tidak qualified; usahakan hanya expand relationship yang qualified.

Jika relationship property filter sangat sering dipakai dan critical, pertimbangkan modelling:

```text
OWNS_SIGNIFICANT
OWNS_MINOR
OWNS_HISTORICAL
```

Tetapi hati-hati type explosion. Gunakan type split hanya jika qualifier adalah semantic boundary stabil dan sering dipakai untuk traversal.

---

## 29. Pattern: Precomputed Candidate Set

Untuk recommendation/fraud/risk, query online sebaiknya tidak selalu melakukan traversal mentah dari awal.

Pipeline:

```text
raw facts graph
  → batch/stream computation
  → candidate relationship
  → online query
```

Contoh:

```text
(:Account)-[:USES_DEVICE]->(:Device)<-[:USES_DEVICE]-(:Account)
```

Batch menghitung:

```text
(:Account)-[:POSSIBLY_RELATED_TO {score, reasons, computedAt}]->(:Account)
```

Online query:

```cypher
MATCH (:Account {id:$id})-[r:POSSIBLY_RELATED_TO]->(other:Account)
WHERE r.score >= 0.7
RETURN other, r.score, r.reasons
ORDER BY r.score DESC
LIMIT 50;
```

Ini menghindari repeated expensive traversal per request.

Trade-off:

- hasil tidak real-time penuh,
- perlu explainability,
- perlu recompute/incremental update,
- perlu threshold governance.

Untuk sistem regulatory, pendekatan ini sering lebih defensible daripada query ad-hoc yang hasilnya tidak stabil.

---

## 30. Pattern: Two-Phase Query

Daripada satu query variable-length besar, gunakan dua fase:

1. cari kandidat kecil,
2. expand detail hanya untuk kandidat.

Buruk:

```cypher
MATCH p = (:Case {id:$id})-[:INVOLVES|OWNS|CONTROLS|SHARES_ADDRESS|USES_PHONE*1..5]-(related:Case)
RETURN p;
```

Lebih baik:

```cypher
MATCH (:Case {id:$id})-[:INVOLVES]->(subject:Entity)
MATCH (subject)<-[:INVOLVES]-(related:Case)
WHERE related.status IN ['OPEN','ESCALATED']
WITH related
LIMIT 100
MATCH p = (related)-[:INVOLVES|SUPPORTED_BY|ESCALATED_TO*1..2]-()
RETURN p;
```

Fase pertama membatasi kandidat case.

Fase kedua mengambil konteks detail.

Ini mirip prinsip:

```text
candidate generation → enrichment
```

Dalam sistem Java, Anda bisa memisahkan menjadi dua repository query dengan timeout dan metrics berbeda.

---

## 31. Pattern: Explicit Traversal Policy

Untuk production graph, traversal policy sebaiknya tidak tersebar sebagai string Cypher random.

Buat katalog traversal:

```yaml
relatedCaseDiscovery:
  anchor: Case.id
  maxDepth: 3
  allowedRelationshipTypes:
    - INVOLVES
    - CONTROLS
    - BENEFICIAL_OWNER_OF
    - SHARES_SIGNIFICANT_IDENTIFIER
  forbiddenTransitLabels:
    - Country
    - CaseStatus
    - CommonRole
  maxDegreePerTransitNode: 1000
  maxResult: 200
  timeoutMs: 2000
```

Lalu query dibangun/ditinjau berdasarkan policy.

Keuntungannya:

- review arsitektur lebih mudah,
- security/audit lebih jelas,
- perubahan threshold terdokumentasi,
- query production tidak liar,
- reasoning domain explicit.

Untuk Java engineer, ini bisa diwujudkan sebagai:

- enum relationship type per use case,
- query builder terbatas,
- stored query catalog,
- ADR per traversal policy,
- integration test dengan golden graph.

---

## 32. Supernode dan Write Contention

Supernode bukan hanya masalah read.

Write juga bisa terkena:

- banyak transaction membuat relationship ke node yang sama,
- `MERGE` relationship harus memeriksa relationship chain besar,
- lock contention pada high-degree node,
- update property count/stat pada node hub,
- concurrent import ke bucket yang sama.

Contoh:

```cypher
MATCH (c:Case {id:$caseId})
MATCH (s:Status {code:'OPEN'})
MERGE (c)-[:HAS_STATUS]->(s);
```

Jika jutaan case membuat relationship ke status `OPEN`, node status menjadi write hotspot.

Jika status cukup sebagai property, gunakan property.

Jika harus sebagai node, pertimbangkan:

- relationship dibuat hanya saat transisi penting,
- current status property + state history nodes,
- bucketed state node per tenant/team/time,
- avoid global mutable aggregate property.

Contoh state history:

```text
(:Case {currentStatus:'OPEN'})
(:Case)-[:HAD_STATE]->(:CaseStateEvent {status:'OPEN', at, actor})
```

State current untuk lookup cepat. State event untuk audit.

---

## 33. Supernode dan Visualization Failure

Neo4j Bloom/Browser atau graph visualization bisa gagal bukan karena database tidak bisa menyimpan graph, tetapi karena visualisasi tidak bisa menampilkan ribuan/millions edge secara meaningful.

Supernode visual symptom:

- layar penuh hairball,
- semua node tampak related,
- layout lambat,
- browser freeze,
- investigator tidak mendapat insight.

Solusinya bukan hanya query optimization, tapi information design:

- show top-N most relevant relationships,
- filter by relationship type,
- collapse hub nodes,
- hide administrative edges,
- rank paths by score,
- show explanation instead of raw full graph,
- separate investigation graph from full data graph.

Untuk regulatory/investigation workflow, graph UI harus membantu reasoning, bukan hanya “menampilkan graph”.

---

## 34. Case Study 1: Public IP Fraud Graph

### 34.1 Model Awal

```text
(:Account)-[:USES_IP]->(:IPAddress)
(:Account)-[:USES_DEVICE]->(:Device)
(:Account)-[:TRANSFERRED_TO]->(:Account)
```

Query investigator:

```cypher
MATCH p = (:Account {id:$id})-[:USES_IP|USES_DEVICE|TRANSFERRED_TO*1..4]-(other:Account)
RETURN p;
```

### 34.2 Problem

Akun target pernah login dari public NAT IP kampus. IP tersebut punya 60.000 account.

Depth 1:

```text
Account → IP
```

Depth 2:

```text
IP → 60.000 Account
```

Depth 3:

```text
Setiap account → device/IP/transfer lain
```

Graph meledak.

### 34.3 Diagnosis

Masalahnya bukan hanya “IP node besar”. Masalahnya:

- query menyamakan IP dan device sebagai sinyal setara,
- tidak ada degree guard,
- tidak ada classification shared infrastructure,
- traversal undirected,
- path depth terlalu besar,
- query meminta path, bukan ranked candidates.

### 34.4 Perbaikan Model

Tambahkan metadata:

```text
(:IPAddress {value, accountCount, ipType, allowTransit})
(:Device {id, accountCount, allowTransit})
```

Buat derived edge:

```text
(:Account)-[:SHARES_STRONG_IDENTIFIER {reason:'DEVICE', score}]->(:Account)
```

### 34.5 Query Online

```cypher
MATCH (:Account {id:$id})-[r:SHARES_STRONG_IDENTIFIER]->(other:Account)
WHERE r.score >= 0.8
RETURN other, r
ORDER BY r.score DESC
LIMIT 50;
```

### 34.6 Query Investigasi Detail

```cypher
MATCH (:Account {id:$id})-[:USES_DEVICE]->(d:Device)<-[:USES_DEVICE]-(other:Account)
WHERE d.accountCount <= 10
RETURN d, collect(other)[0..50] AS relatedAccounts;
```

### 34.7 Lesson

> shared identifier adalah sinyal hanya jika identifier itu cukup spesifik.

---

## 35. Case Study 2: Regulatory Case Status Supernode

### 35.1 Model Awal

```text
(:Case)-[:HAS_STATUS]->(:Status {code:'OPEN'})
(:Case)-[:INVOLVES]->(:Entity)
(:Case)-[:ASSIGNED_TO]->(:Officer)
```

Query:

```cypher
MATCH (c:Case {id:$id})-[:HAS_STATUS]->(s:Status)<-[:HAS_STATUS]-(other:Case)
RETURN other;
```

### 35.2 Problem

Semua case open dianggap related. Result jutaan. Secara domain tidak berguna.

### 35.3 Perbaikan

Status current sebagai property:

```text
(:Case {id, status:'OPEN'})
```

Audit status sebagai event:

```text
(:Case)-[:HAS_STATE_EVENT]->(:CaseStateEvent {status, at, actor, reason})
```

Workflow state sebagai reference boleh ada:

```text
(:WorkflowState {code:'OPEN'})-[:ALLOWS_TRANSITION_TO]->(:WorkflowState {code:'ESCALATED'})
```

Tetapi jangan dipakai untuk related-case traversal.

Related case query:

```cypher
MATCH (:Case {id:$id})-[:INVOLVES]->(e:Entity)<-[:INVOLVES]-(other:Case)
WHERE other.status IN ['OPEN','ESCALATED']
RETURN other
ORDER BY other.updatedAt DESC
LIMIT 100;
```

### 35.4 Lesson

> administrative sameness is not investigative relatedness.

---

## 36. Case Study 3: Product Category Recommendation Supernode

### 36.1 Model Awal

```text
(:User)-[:BOUGHT]->(:Product)-[:IN_CATEGORY]->(:Category)
```

Query:

```cypher
MATCH (:User {id:$id})-[:BOUGHT]->(:Product)-[:IN_CATEGORY]->(cat:Category)<-[:IN_CATEGORY]-(rec:Product)
RETURN rec
LIMIT 20;
```

### 36.2 Problem

User membeli laptop. Laptop masuk `Electronics`. Category berisi jutaan product.

### 36.3 Perbaikan

Gunakan category spesifik:

```text
(:Product)-[:IN_CATEGORY]->(:Category {code:'LAPTOP_GAMING_MIDRANGE'})
(:Category)-[:PARENT]->(:Category {code:'LAPTOP'})
(:Category)-[:PARENT]->(:Category {code:'ELECTRONICS'})
```

Query hanya memakai leaf/subcategory:

```cypher
MATCH (:User {id:$id})-[:BOUGHT]->(:Product)-[:IN_CATEGORY]->(cat:Category)
WHERE cat.level >= 3
MATCH (cat)<-[:IN_CATEGORY]-(rec:Product)
RETURN rec
LIMIT 20;
```

Atau gunakan precomputed similarity:

```cypher
MATCH (:User {id:$id})-[:BOUGHT]->(:Product)-[r:SIMILAR_TO]->(rec:Product)
RETURN rec, r.score
ORDER BY r.score DESC
LIMIT 20;
```

### 36.4 Lesson

> top-level taxonomy node is usually a filter or label, not a recommendation bridge.

---

## 37. Case Study 4: IAM AllEmployees Group

### 37.1 Model Awal

```text
(:User)-[:MEMBER_OF]->(:Group {name:'AllEmployees'})
(:Group)-[:HAS_ROLE]->(:Role)
(:Role)-[:GRANTS]->(:Permission)
(:Permission)-[:APPLIES_TO]->(:Resource)
```

### 37.2 Problem

Entitlement query melewati `AllEmployees` dan menghasilkan permission/resource sangat luas.

### 37.3 Perbaikan

Pisahkan:

```text
baseline policy
specific entitlement
exception
approval
```

Contoh:

```text
(:Policy {code:'BASELINE_EMPLOYEE_ACCESS'})
(:User)-[:HAS_BASELINE_POLICY]->(:Policy)
(:User)-[:MEMBER_OF]->(:Team)
(:Team)-[:HAS_ROLE]->(:Role {scope:'CaseReview'})
```

Atau baseline access dihitung di policy engine, bukan graph traversal online.

### 37.4 Lesson

> global membership is policy context, not always useful path connector.

---

## 38. Designing for Traversal Selectivity

Traversal selectivity adalah kemampuan relationship expansion untuk mengurangi search space.

High selectivity:

```text
(:Person)-[:BENEFICIAL_OWNER_OF]->(:Company)
```

Low selectivity:

```text
(:Person)-[:LOCATED_IN]->(:Country)
```

High selectivity edge baik untuk traversal discovery.

Low selectivity edge baik untuk filtering/dimension, tetapi berbahaya untuk path expansion.

Checklist relationship type:

| Pertanyaan | Jika Jawaban “Tidak” |
|---|---|
| Apakah relationship ini menunjukkan hubungan domain substantif? | Mungkin property/dimension saja |
| Apakah traversal melewatinya menghasilkan kandidat meaningful? | Jangan jadikan transit edge |
| Apakah relationship ini cukup spesifik? | Split type atau tambahkan guard |
| Apakah degree target terkendali? | Bucket/filter/precompute |
| Apakah direction punya meaning? | Definisikan direction |
| Apakah dipakai dalam variable-length query? | Wajib review fan-out |

---

## 39. Relationship Direction as Domain Constraint

Direction harus dipilih berdasarkan semantics, bukan asal.

Contoh:

```text
(:Person)-[:OWNS]->(:Company)
```

Direction menunjukkan flow control/ownership.

```text
(:Transaction)-[:SENT_TO]->(:Account)
(:Transaction)-[:SENT_FROM]->(:Account)
```

Atau:

```text
(:Account)-[:TRANSFERRED_TO]->(:Account)
```

Direction menunjukkan flow money.

Untuk dependency:

```text
(:Service)-[:CALLS]->(:Service)
(:Service)-[:DEPENDS_ON]->(:Database)
```

Impact upstream vs downstream query berbeda:

```cypher
// downstream: apa yang dipengaruhi service ini?
MATCH p = (:Service {name:$name})<-[:CALLS*1..3]-(:Service)
RETURN p;
```

```cypher
// upstream: service ini bergantung ke apa?
MATCH p = (:Service {name:$name})-[:CALLS|DEPENDS_ON*1..3]->()
RETURN p;
```

Tanpa direction, impact analysis mudah salah.

---

## 40. Use Labels to Bound Traversal, But Don’t Overtrust Labels

Labels membantu membatasi node type:

```cypher
MATCH (:Account {id:$id})-[:USES_DEVICE]->(:Device)<-[:USES_DEVICE]-(other:Account)
RETURN other;
```

Lebih baik daripada:

```cypher
MATCH (:Account {id:$id})-->()<--(other)
RETURN other;
```

Namun label filter setelah expansion mungkin tetap membuka relationship luas jika pattern tidak spesifik.

Lebih baik gunakan kombinasi:

- label anchor,
- label endpoint,
- relationship type,
- direction,
- property guard,
- depth limit.

Labels bukan pengganti relationship semantics.

---

## 41. Avoid “Everything Connected to Everything” Graphs

Graph yang terlalu connected sering tidak punya nilai.

Contoh:

```text
Person → Country
Company → Country
Case → Country
Officer → Country
Regulation → Country
Document → Country
```

Jika query relatedness memperbolehkan `Country`, hampir semua entity dalam satu negara related.

Masalah ini disebut secara informal:

```text
small-world collapse
```

Graph menjadi terlalu mudah menghubungkan dua entity lewat hub generik.

Sinyal relatedness melemah.

Solusi:

- bedakan attribute/dimension dari relation signal,
- larang generic node sebagai transit,
- gunakan scoring/weight,
- gunakan path ranking,
- gunakan relation-specific query,
- jangan query “all related” tanpa definisi relatedness.

---

## 42. Path Count vs Node Count

Dua node bisa memiliki banyak path.

Contoh:

```text
A --x1-- B
A --x2-- B
A --x3-- B
```

Node unik hanya `A`, `B`, `x1`, `x2`, `x3`, tetapi path A ke B ada beberapa.

Dalam graph yang padat, path alternatif bisa meledak.

Query:

```cypher
MATCH p = (a {id:$a})-[*1..5]-(b {id:$b})
RETURN p;
```

meminta semua path yang match, bukan hanya apakah `a` reachable ke `b`.

Jika pertanyaan bisnis adalah:

```text
Apakah A terhubung ke B?
```

Jangan return semua path.

Gunakan pendekatan existence atau shortest path sesuai kebutuhan:

```cypher
MATCH (a {id:$a}), (b {id:$b})
MATCH p = shortestPath((a)-[*1..5]-(b))
RETURN p;
```

Jika butuh weighted path atau path algorithm khusus, pertimbangkan GDS.

---

## 43. Weighted Thinking: Tidak Semua Edge Sama

Traversal tanpa bobot menganggap semua relationship setara.

Dalam fraud/regulatory graph, ini jarang benar.

Contoh relatedness:

| Signal | Strength |
|---|---:|
| Same verified phone | High |
| Same device fingerprint | High |
| Same residential address | Medium-high |
| Same public IP | Low |
| Same country | Very low |
| Same status | Almost none |

Jika graph query mencampur semua edge tanpa bobot:

```cypher
[:USES_PHONE|USES_DEVICE|USES_IP|IN_COUNTRY|HAS_STATUS*1..4]
```

hasilnya buruk.

Alternatif:

- batasi edge kuat untuk traversal online,
- gunakan property `weight`/`score`,
- precompute `RELATED_TO` dengan score,
- gunakan GDS weighted algorithms untuk analytical scoring,
- tampilkan reason path untuk explainability.

---

## 44. Query Smell Catalogue

Waspadai query seperti ini:

### 44.1 Unbounded Variable-Length

```cypher
MATCH p = (a)-[*]-(b)
RETURN p;
```

Hampir selalu tidak layak production.

### 44.2 Too Broad Relationship Set

```cypher
MATCH p = (a)-[:RELATED_TO|HAS|USES|IN|BELONGS_TO*1..5]-(b)
RETURN p;
```

Relationship semantics terlalu campur.

### 44.3 Undirected Multi-Hop Without Reason

```cypher
MATCH p = (a)-[*1..4]-(b)
RETURN p;
```

Arah diabaikan.

### 44.4 Filter After Expansion

```cypher
MATCH p = (a)-[*1..5]-(b)
WHERE b.status = 'ACTIVE'
RETURN p;
```

Terlalu banyak path bisa terbentuk sebelum filter.

### 44.5 Returning Full Path for Large Discovery

```cypher
MATCH p = (a)-[*1..5]-(b)
RETURN p;
```

Mungkin cukup return candidate nodes/count/score.

### 44.6 LIMIT at the End

```cypher
MATCH p = (a)-[*1..5]-(b)
RETURN p
LIMIT 10;
```

`LIMIT` tidak otomatis membatasi work internal.

### 44.7 Generic Hub in Path

```cypher
MATCH p = (:Case)-[:HAS_STATUS|IN_COUNTRY|INVOLVES*1..4]-(:Case)
RETURN p;
```

Administrative edges dicampur dengan investigative edges.

---

## 45. Refactoring Strategies

Jika graph sudah punya supernode, opsi refactoring:

### 45.1 Convert Node to Property

Dari:

```text
(:Case)-[:HAS_STATUS]->(:Status {code:'OPEN'})
```

Menjadi:

```text
(:Case {status:'OPEN'})
```

Cocok untuk attribute sederhana.

### 45.2 Split Generic Node into Specific Nodes

Dari:

```text
(:Product)-[:IN_CATEGORY]->(:Category {name:'Electronics'})
```

Menjadi taxonomy lebih dalam.

### 45.3 Add Bucket Nodes

Dari:

```text
(:Transaction)-[:OCCURRED_ON]->(:Date)
```

Menjadi:

```text
(:Transaction)-[:OCCURRED_IN]->(:MerchantDayBucket)
```

### 45.4 Add Degree Guard

Tambahkan:

```text
accountCount
allowTransit
classification
```

### 45.5 Materialize Derived Edge

Dari repeated traversal:

```text
Account → Device/IP/Phone → Account
```

Menjadi:

```text
Account → RELATED_TO(score, reasons) → Account
```

### 45.6 Split Relationship Type

Dari:

```text
RELATED_TO
```

Menjadi:

```text
OWNS
CONTROLS
USES_DEVICE
SHARES_ADDRESS
```

### 45.7 Move to Analytical Pipeline

Jika query memang besar, jangan jadikan request/response online query. Jalankan batch/GDS dan simpan hasil.

---

## 46. Production Guardrails

Untuk graph service Java, guardrail bisa diterapkan di beberapa layer.

### 46.1 Query Catalog

Jangan biarkan arbitrary Cypher untuk critical path.

Gunakan named query:

```text
RelatedCaseQuery.v1
FraudRingCandidateQuery.v2
OwnershipPathQuery.v1
EntitlementExpansionQuery.v3
```

### 46.2 Max Depth by Use Case

```text
related cases: max depth 2-3
ownership chain: max depth 5-10 depending regulation
IAM entitlement: max depth controlled by group nesting policy
recommendation online: no raw multi-hop; use candidate edges
```

### 46.3 Timeout

Set transaction/query timeout.

### 46.4 Result Cap

Cap returned paths/nodes.

### 46.5 Degree Threshold

Reject or switch strategy when intermediate node degree exceeds threshold.

### 46.6 Metrics

Capture:

- latency p50/p95/p99,
- result count,
- rows consumed,
- query type,
- timeout count,
- transient error count,
- top slow queries,
- high-degree node hits.

### 46.7 Fallback

If traversal too broad:

- return partial result with warning,
- suggest narrower filter,
- use precomputed candidates,
- defer to batch analysis,
- ask user to choose relationship types.

---

## 47. Java Service Design for Safe Traversal

Avoid service methods like:

```java
List<Path> findRelated(String nodeId, int depth);
```

Too generic.

Better:

```java
RelatedCaseResult findRelatedCases(RelatedCaseQuery query);
OwnershipResult findBeneficialOwnership(OwnershipQuery query);
FraudCandidateResult findFraudCandidates(FraudCandidateQuery query);
EntitlementResult expandEffectiveAccess(EntitlementQuery query);
```

Each query object should include domain-specific limits:

```java
public record RelatedCaseQuery(
    String caseId,
    Set<RelationshipKind> allowedRelationshipKinds,
    int maxDepth,
    int maxResults,
    boolean excludeAdministrativeEdges,
    boolean excludeHighDegreeTransitNodes
) {}
```

But do not allow caller to set arbitrary high depth.

Use policy constants:

```java
public final class GraphTraversalPolicies {
    public static final int RELATED_CASE_MAX_DEPTH = 3;
    public static final int RELATED_CASE_MAX_RESULTS = 200;
    public static final int MAX_TRANSIT_DEGREE = 1000;
}
```

Repository query should be explicit:

```java
String cypher = """
MATCH (c:Case {id: $caseId})-[:INVOLVES]->(e:Entity)<-[:INVOLVES]-(other:Case)
WHERE other.status IN $statuses
RETURN other.id AS caseId, other.status AS status
ORDER BY other.updatedAt DESC
LIMIT $limit
""";
```

Avoid constructing unrestricted variable-length Cypher from user input.

---

## 48. Testing Supernode Scenarios

A graph query that passes on small test data can fail on production topology.

Your test dataset must include:

1. normal-degree nodes,
2. high-degree nodes,
3. public/shared identifiers,
4. cycle cases,
5. duplicate path alternatives,
6. generic category/status/country nodes,
7. edge case with no relationship,
8. edge case with huge relationship count,
9. malicious/abusive graph shape.

Example test graph:

```text
Account A1 uses Device D1 shared by 3 accounts.
Account A1 uses IP IP_PUBLIC shared by 50.000 accounts.
Account A1 transfers to A2.
A2 uses Device D2 shared by 2 accounts.
All accounts located in Country ID.
All active accounts have status ACTIVE.
```

Test expectation:

- related account query should not traverse `IP_PUBLIC`,
- should not use `Country` as relatedness connector,
- should cap result,
- should return meaningful reasons,
- should remain under latency budget.

---

## 49. Monitoring Degree Drift

Supernodes can appear over time.

A model that is safe today can become unsafe after growth.

Examples:

- one merchant becomes extremely popular,
- one IP becomes shared infrastructure,
- one role accumulates too many users,
- one case category receives mass filing,
- one address is reused by many shell companies,
- one device fingerprint algorithm collapses many devices into one ID due to bug.

Monitor degree drift:

```cypher
MATCH (n:IPAddress)<-[:USES_IP]-(:Account)
WITH n, count(*) AS degree
WHERE degree > 1000
RETURN n.value, degree
ORDER BY degree DESC
LIMIT 100;
```

For different labels/types, run scheduled checks.

Store snapshots:

```text
label, relationshipType, date, maxDegree, p95Degree, p99Degree, topNodeIds
```

Alert if:

- p99 degree jumps,
- max degree jumps,
- number of high-degree nodes increases,
- slow queries correlate with high-degree nodes.

---

## 50. Security and Abuse Angle

If users can influence graph structure, they can create denial-of-service style graph shapes.

Examples:

- bot creates many accounts sharing one identifier,
- attacker connects entity to many categories,
- bad integration writes duplicate relationships,
- malformed import creates one null/default node for missing values,
- all unknown addresses map to `Address {value:'UNKNOWN'}`.

The last one is very common.

Bad:

```text
(:Person)-[:LIVES_AT]->(:Address {line:'UNKNOWN'})
```

If 10 million records have missing address, `UNKNOWN` becomes supernode.

Better:

- omit relationship if value unknown,
- store `addressKnown:false` as property,
- use separate data quality node only for analysis, not traversal,
- never use default placeholder as shared graph identity.

Rule:

> missing data should not accidentally create relationship evidence.

---

## 51. Graph Modelling Heuristics for Avoiding Supernodes

Use these heuristics during design review.

### 51.1 The “Would This Make Everything Related?” Test

If many unrelated entities share this node, do not use it as traversal connector.

### 51.2 The “Is This Attribute or Relationship?” Test

If the value is mostly used to filter/sort/group, property may be better.

### 51.3 The “Transit Worthiness” Test

A node can be endpoint but not transit.

### 51.4 The “Signal Specificity” Test

Relationship should increase information, not just state generic sameness.

### 51.5 The “Fan-Out Budget” Test

Estimate expansion at every hop.

### 51.6 The “Path Meaning” Test

Every path returned should have defensible domain meaning.

### 51.7 The “Top-N Alternative” Test

If user only needs top candidates, do not compute all paths.

### 51.8 The “Batch vs Online” Test

If query naturally scans huge graph, make it batch/analytical.

---

## 52. Practical Review Template

Use this for every production traversal query.

```text
Query name:
Business question:
Anchor label/property:
Anchor uniqueness constraint:
Allowed relationship types:
Allowed directions:
Allowed node labels:
Forbidden transit labels:
Max depth:
Expected p50 result:
Expected p95 result:
Expected p99 result:
Known supernode risks:
Degree guard:
Timeout:
Limit:
Does LIMIT reduce work or only output?
Does query return paths, nodes, counts, or scores?
Does query need all paths?
Can result be precomputed?
PROFILE reviewed on high-degree dataset?
Fallback behavior:
Owner:
Last reviewed:
```

---

## 53. Exercises

### Exercise 1: Identify Supernodes

Given model:

```text
(:Case)-[:HAS_STATUS]->(:Status)
(:Case)-[:IN_COUNTRY]->(:Country)
(:Case)-[:INVOLVES]->(:Entity)
(:Entity)-[:HAS_ADDRESS]->(:Address)
(:Entity)-[:HAS_PHONE]->(:Phone)
(:Entity)-[:HAS_REGISTRATION_TYPE]->(:RegistrationType)
```

Classify each target node type:

- safe traversal connector,
- endpoint only,
- property candidate,
- bucket candidate,
- derived edge candidate.

### Exercise 2: Rewrite Query

Bad query:

```cypher
MATCH p = (:Case {id:$caseId})-[*1..4]-(:Case)
RETURN p
LIMIT 100;
```

Rewrite it into at least two domain-specific queries:

1. related by shared subject/entity,
2. related by beneficial ownership,
3. related by strong identifier,
4. related by escalation chain.

### Exercise 3: Fan-Out Estimation

A query traverses:

```text
Account → Device → Account → IP → Account
```

Average degrees:

```text
Account uses devices: 3
Device used by accounts: p95 = 8, p99 = 5000
Account uses IPs: 10
IP used by accounts: p95 = 20, p99 = 100000
```

Estimate p95 and p99 explosion. Propose guardrails.

### Exercise 4: Design Degree Guard

For `IPAddress`, define:

- properties,
- update strategy,
- query threshold,
- stale count tolerance,
- reconciliation job,
- UI explanation.

### Exercise 5: Regulatory Defensibility

Explain why two cases sharing `status='OPEN'` should not be considered related, but two cases involving same beneficial owner may be considered related. Define the evidence path.

---

## 54. Key Takeaways

1. Supernode adalah node dengan degree sangat tinggi yang membuat traversal, write, atau visualisasi menjadi tidak proporsional.
2. Dense node tidak selalu buruk; yang buruk adalah dense node sebagai transit hub tanpa kontrol.
3. Graph performance adalah controlled expansion.
4. Index membantu anchor, tetapi traversal safety bergantung pada relationship design dan boundary.
5. Variable-length path harus selalu punya depth limit dan semantic justification.
6. Direction, relationship type, label, property guard, dan degree threshold adalah alat utama membatasi traversal.
7. Administrative sameness bukan domain relatedness.
8. Shared identifier hanya bernilai jika cukup spesifik.
9. `LIMIT` di akhir query bukan solusi traversal explosion.
10. Precomputed candidate edge sering lebih baik untuk query online.
11. Degree distribution lebih penting daripada average graph size.
12. Missing/default data tidak boleh menciptakan shared node palsu.
13. Production graph perlu query catalog, traversal policy, timeout, metrics, dan high-degree tests.
14. Untuk sistem regulatory/enforcement, setiap path harus punya meaning yang defensible.

---

## 55. Checklist Sebelum Lanjut ke Part 013

Pastikan Anda bisa menjawab:

- Apa perbedaan dense node dan supernode?
- Mengapa node `Status(OPEN)` biasanya tidak boleh menjadi related-case connector?
- Mengapa public IP bisa melemahkan fraud signal?
- Mengapa `LIMIT 10` tidak otomatis membuat variable-length traversal aman?
- Bagaimana menghitung fan-out kasar?
- Kapan memakai property daripada node?
- Kapan memakai bucket node?
- Kapan memakai materialized relationship?
- Bagaimana membaca traversal explosion di `PROFILE`?
- Bagaimana mendesain Java service method supaya tidak membuka arbitrary traversal?

Jika jawaban-jawaban ini sudah jelas, Anda siap masuk ke Part 013: integrasi Java dengan Neo4j.

---

## 56. Penutup

Graph database kuat bukan karena semua hal bisa dihubungkan. Graph database kuat ketika hubungan yang dimodelkan benar-benar membawa informasi dan traversal yang dijalankan punya batas yang jelas.

Supernode adalah pengingat bahwa graph modelling bukan hanya membuat node dan relationship. Graph modelling adalah desain search space.

> Model graph yang baik bukan graph yang paling connected, tetapi graph yang membuat path penting murah, path tidak relevan sulit, dan path berbahaya mustahil dijalankan tanpa sadar.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — Query Performance: `PROFILE`, `EXPLAIN`, Cardinality, and Plan Tuning</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-013.md">Part 013 — Java Application Integration with Neo4j ➡️</a>
</div>
