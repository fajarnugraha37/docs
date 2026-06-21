# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-001.md

# Part 001 — Graph Thinking: From Entities to Relationships to Paths

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus bagian ini: mengubah cara berpikir dari entity-centric menjadi relationship-centric dan path-centric.

---

## 0. Posisi Part Ini dalam Seri

Pada Part 000, kita membangun orientasi: graph database bukan “database yang lebih keren”, tetapi model penyimpanan dan query yang masuk akal ketika **nilai utama data berada pada hubungan**.

Part 001 adalah fondasi mental. Sebelum belajar Cypher, indexing, Neo4j Java Driver, Graph Data Science, atau cluster, kita harus memahami satu hal:

> Graph database bukan sekadar menyimpan entity. Graph database membuat **hubungan antar entity** menjadi objek utama yang bisa ditelusuri, diberi makna, diberi property, dianalisis, dan dijadikan dasar keputusan.

Kalau di relational model kita sering bertanya:

```text
Data apa yang cocok dengan filter ini?
```

Di graph model kita lebih sering bertanya:

```text
Bagaimana entity ini terhubung ke entity lain?
Lewat jalur apa?
Seberapa jauh?
Dengan tipe hubungan apa?
Apakah jalurnya masuk akal secara domain?
Apa dampaknya jika satu node berubah?
```

Neo4j sendiri mendefinisikan graph database sebagai penyimpanan data dalam bentuk **nodes, relationships, dan properties**, bukan tabel atau dokumen. Dalam Cypher, core entity yang dipakai untuk query adalah **nodes, relationships, dan paths**.

Referensi resmi:

- Neo4j Getting Started — graph database concepts.
- Neo4j Cypher Manual — core concepts: nodes, relationships, paths.
- Neo4j Cypher Manual — patterns and graph pattern matching.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, Anda harus mampu:

1. Membedakan cara berpikir **entity-centric**, **relationship-centric**, dan **path-centric**.
2. Menjelaskan node, relationship, path, walk, trail, cycle, degree, density, dan connected component dengan bahasa engineering.
3. Mengenali requirement yang sebenarnya graph-shaped.
4. Menganalisis risiko graph explosion sebelum query ditulis.
5. Menentukan kapan relasi cukup menjadi foreign key, kapan harus menjadi relationship graph.
6. Menghindari kesalahan awal: menganggap graph database hanya “join yang lebih cepat”.
7. Membaca domain seperti fraud, access control, dependency, regulatory case, social, recommendation, dan supply chain sebagai jaringan hubungan.
8. Membentuk intuisi traversal: mulai dari node, memilih edge, membatasi expansion, dan membaca path.

---

## 2. Masalah Utama: Banyak Engineer Terlalu Lama Berpikir dalam Bentuk Record

Sebagai Java engineer, kemungkinan besar Anda sudah sangat terbiasa dengan pola seperti ini:

```java
class Customer {
    UUID id;
    String name;
    String email;
}

class Account {
    UUID id;
    UUID customerId;
    String status;
}

class Transaction {
    UUID id;
    UUID sourceAccountId;
    UUID targetAccountId;
    BigDecimal amount;
}
```

Lalu di SQL:

```sql
SELECT *
FROM transactions t
JOIN accounts a1 ON t.source_account_id = a1.id
JOIN accounts a2 ON t.target_account_id = a2.id
JOIN customers c1 ON a1.customer_id = c1.id
JOIN customers c2 ON a2.customer_id = c2.id
WHERE c1.id = ?;
```

Ini tidak salah. Untuk banyak sistem, ini tepat.

Tetapi masalah mulai muncul ketika pertanyaan bisnis berubah dari:

```text
Tampilkan transaksi customer X.
```

menjadi:

```text
Apakah customer X terhubung, langsung atau tidak langsung, dengan jaringan akun yang pernah terlibat fraud?

Lewat jalur apa?

Apakah hubungan itu melalui alamat, device, pemilik manfaat, rekening perantara, nomor telepon, merchant, atau case investigasi sebelumnya?

Seberapa jauh hubungan itu?

Apakah ada pola hubungan yang mirip dengan fraud ring sebelumnya?
```

Pada titik ini, persoalannya bukan lagi “ambil record”. Persoalannya adalah **navigasi jaringan hubungan**.

Relational database bisa melakukannya, terutama dengan recursive CTE, join, closure table, materialized path, atau precomputed relation. Tetapi graph database membuat model tersebut menjadi bentuk alami.

Yang berubah bukan hanya syntax query. Yang berubah adalah **unit of reasoning**.

---

## 3. Tiga Cara Berpikir: Entity, Relationship, Path

### 3.1 Entity-Centric Thinking

Entity-centric thinking bertanya:

```text
Objek apa yang saya punya?
Atribut apa yang melekat pada objek itu?
Bagaimana saya menyimpan dan mengambil objek itu?
```

Contoh:

```text
Customer
- id
- name
- dateOfBirth
- riskLevel

Account
- id
- type
- status
- openedAt
```

Ini cocok untuk:

- CRUD aplikasi bisnis.
- Master data management sederhana.
- Transaction processing.
- Validasi berdasarkan atribut.
- Reporting berbasis filter.

Pertanyaan tipikal:

```text
Customer mana yang riskLevel = HIGH?
Account mana yang status = BLOCKED?
Transaction mana yang amount > 10_000_000?
```

Mental model ini record-oriented.

---

### 3.2 Relationship-Centric Thinking

Relationship-centric thinking bertanya:

```text
Siapa terhubung dengan siapa?
Apa makna hubungannya?
Kapan hubungan itu berlaku?
Seberapa kuat hubungan itu?
Apa bukti hubungan itu?
```

Contoh:

```text
(:Person)-[:OWNS]->(:Account)
(:Person)-[:USES_DEVICE]->(:Device)
(:Account)-[:TRANSFERRED_TO]->(:Account)
(:Person)-[:BENEFICIAL_OWNER_OF]->(:Company)
(:Case)-[:HAS_SUBJECT]->(:Person)
(:Evidence)-[:SUPPORTS]->(:Allegation)
```

Di sini hubungan bukan hanya foreign key. Hubungan punya tipe, arah, dan kadang property.

Contoh relationship dengan property:

```cypher
(:Account)-[:TRANSFERRED_TO {
  amount: 25000000,
  currency: 'IDR',
  occurredAt: datetime('2026-01-15T10:31:00+07:00'),
  channel: 'MOBILE_BANKING'
}]->(:Account)
```

Relationship-centric thinking cocok ketika hubungan punya nilai bisnis langsung.

Contoh pertanyaan:

```text
Akun mana saja yang pernah menerima dana dari akun yang sudah ditandai fraud?

Orang mana saja yang berbagi device dengan subject investigasi?

Perusahaan mana yang dikontrol oleh orang yang juga menjadi beneficiary di case lain?
```

---

### 3.3 Path-Centric Thinking

Path-centric thinking bertanya:

```text
Lewat jalur apa dua entity terhubung?
Berapa panjang jalurnya?
Relationship apa saja yang dilalui?
Apakah jalur itu valid secara domain?
Apa arti jalur itu?
```

Contoh path:

```text
(Person A)
  -[:OWNS]->
(Account X)
  -[:TRANSFERRED_TO]->
(Account Y)
  <-[:OWNS]-
(Person B)
  -[:SUBJECT_OF]->
(Case C)
```

Interpretasi domain:

```text
Person A terhubung ke Case C melalui rekening yang mengirim dana ke rekening milik Person B, dan Person B adalah subject dari Case C.
```

Di graph database, path bukan sekadar hasil join. Path adalah struktur yang membawa narasi:

```text
A terhubung ke B karena C, melalui D, pada waktu E, dengan hubungan F.
```

Inilah alasan graph sangat kuat untuk:

- investigasi,
- explainability,
- access reasoning,
- dependency impact,
- fraud discovery,
- network risk,
- recommendation explanation,
- knowledge graph traversal.

---

## 4. Graph Bukan Hanya Diagram: Graph Adalah Model Komputasi

Banyak orang pertama kali melihat graph sebagai gambar:

```text
A ---- B ---- C
      |
      D
```

Itu berguna untuk visualisasi, tetapi tidak cukup untuk engineering.

Dalam engineering, graph adalah struktur matematis dan komputasional:

```text
G = (V, E)
```

Dengan:

```text
V = vertices / nodes
E = edges / relationships
```

Dalam property graph:

```text
Node:
- labels
- properties

Relationship:
- type
- direction
- start node
- end node
- properties
```

Neo4j memakai property graph model, sehingga relationship bukan hanya pointer. Relationship bisa punya tipe dan property.

Contoh:

```cypher
(:Person {id: 'P1', name: 'Ayu'})
  -[:DIRECTOR_OF {since: date('2021-04-01')}]->
(:Company {id: 'C1', name: 'Nusantara Trading'})
```

Secara storage/query, ini berarti kita bisa bertanya:

```cypher
MATCH (p:Person)-[r:DIRECTOR_OF]->(c:Company)
WHERE r.since < date('2022-01-01')
RETURN p, r, c
```

Bukan hanya:

```sql
SELECT * FROM directors WHERE since < '2022-01-01';
```

Perbedaannya bukan pada kemampuan filter. Perbedaannya adalah bahwa hasil query masih bisa menjadi titik awal traversal berikutnya:

```text
Person -> Company -> Account -> Transaction -> Account -> Person -> Case
```

---

## 5. Vocabulary Dasar Graph

Bagian ini penting karena istilah graph sering dipakai secara longgar. Kita perlu definisi yang cukup presisi untuk reasoning.

---

### 5.1 Node

Node merepresentasikan entity/domain object.

Contoh:

```text
Person
Company
Account
Device
Case
Evidence
Regulation
Product
Service
Application
Server
```

Dalam Neo4j:

```cypher
(:Person {id: 'P-001', name: 'Ayu'})
(:Company {id: 'C-001', name: 'PT Garuda Data'})
```

Node bisa punya satu atau lebih label:

```cypher
(:Person:Customer {id: 'P-001'})
(:Person:Officer {id: 'P-002'})
(:Company:Vendor {id: 'C-001'})
```

Label bukan class Java secara persis. Label lebih seperti kategori yang membantu:

- query matching,
- indexing,
- constraint,
- domain classification.

---

### 5.2 Relationship

Relationship merepresentasikan koneksi bermakna antara dua node.

Contoh:

```cypher
(:Person)-[:OWNS]->(:Account)
(:Person)-[:WORKS_FOR]->(:Company)
(:Case)-[:HAS_EVIDENCE]->(:Evidence)
(:Service)-[:DEPENDS_ON]->(:Service)
(:User)-[:HAS_ROLE]->(:Role)
```

Relationship di Neo4j selalu memiliki arah secara fisik/logis:

```cypher
(:Person)-[:OWNS]->(:Account)
```

Namun saat query, kita bisa memilih apakah arah penting atau tidak.

Directional:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
RETURN p, a
```

Undirected-style matching:

```cypher
MATCH (p:Person)-[:OWNS]-(a:Account)
RETURN p, a
```

Arah relationship sebaiknya dipilih berdasarkan bahasa domain yang paling alami.

Contoh:

```text
Person OWNS Account
Account OWNED_BY Person
```

Keduanya bisa merepresentasikan hal yang sama, tetapi pilih satu arah yang paling jelas untuk query dominan.

---

### 5.3 Relationship Type

Relationship type adalah nama semantic edge.

Contoh baik:

```text
OWNS
CONTROLS
TRANSFERRED_TO
USES_DEVICE
SUBJECT_OF
ESCALATED_TO
DEPENDS_ON
HAS_PERMISSION
MEMBER_OF
```

Contoh buruk:

```text
RELATED_TO
HAS
LINKED_TO
CONNECTS
REFERS_TO
```

Bukan berarti nama generik selalu salah, tetapi terlalu banyak relationship generik membuat graph kehilangan makna.

Kalau hampir semua edge bernama `RELATED_TO`, maka query harus membaca property untuk memahami semantics:

```cypher
(:A)-[:RELATED_TO {kind: 'OWNS'}]->(:B)
```

Ini biasanya lebih lemah daripada:

```cypher
(:A)-[:OWNS]->(:B)
```

Karena relationship type adalah bagian dari pattern matching.

---

### 5.4 Property

Property adalah key-value pada node atau relationship.

Node property:

```cypher
(:Person {
  id: 'P-001',
  fullName: 'Ayu Lestari',
  riskLevel: 'HIGH'
})
```

Relationship property:

```cypher
(:Person)-[:OWNS {
  ownershipPercentage: 40.0,
  validFrom: date('2022-01-01'),
  source: 'company-registry'
}]->(:Company)
```

Rule of thumb:

```text
Jika sesuatu hanya menjelaskan node, taruh di node.
Jika sesuatu menjelaskan hubungan antara dua node, taruh di relationship.
Jika sesuatu perlu dihubungkan ke banyak entity lain, pertimbangkan menjadi node.
```

Contoh:

```text
ownershipPercentage
```

Lebih tepat sebagai relationship property, karena percentage bukan milik Person saja atau Company saja. Ia milik hubungan Person -> Company.

---

### 5.5 Path

Path adalah urutan node dan relationship.

Contoh:

```text
A -[r1]-> B -[r2]-> C -[r3]-> D
```

Dalam Cypher:

```cypher
MATCH p = (:Person {id: 'P-001'})-[:OWNS]->(:Account)-[:TRANSFERRED_TO]->(:Account)<-[:OWNS]-(:Person)
RETURN p
```

Path punya panjang. Panjang path biasanya dihitung dari jumlah relationship.

```text
(A)                    length 0
(A)-[r]->(B)           length 1
(A)-[r]->(B)-[s]->(C)  length 2
```

Path adalah objek penting karena banyak keputusan bisnis tidak cukup dijawab dengan “ada koneksi”, tetapi perlu “koneksi seperti apa”.

---

### 5.6 Walk, Trail, Path, Cycle

Dalam teori graph, istilah ini bisa sangat presisi. Dalam engineering sehari-hari, kita perlu cukup memahami risikonya.

#### Walk

Walk adalah urutan node dan edge di mana node atau edge boleh dikunjungi ulang.

```text
A -> B -> C -> B -> D
```

Node B dikunjungi dua kali.

#### Trail

Trail adalah walk di mana edge tidak diulang, tetapi node bisa diulang.

```text
A -> B -> C -> B -> D
```

Jika edge yang dilalui berbeda, ini bisa trail meskipun node B muncul dua kali.

#### Simple path

Simple path biasanya berarti node tidak diulang.

```text
A -> B -> C -> D
```

#### Cycle

Cycle adalah path yang kembali ke node awal.

```text
A -> B -> C -> A
```

Kenapa ini penting?

Karena traversal yang tidak membatasi revisit dapat meledak secara kombinatorial. Dalam graph nyata, terutama fraud, social, transaction, dan dependency graph, cycle hampir pasti ada.

---

## 6. Degree, Fan-Out, dan Risiko Ledakan Traversal

### 6.1 Degree

Degree adalah jumlah relationship yang terhubung ke node.

Dalam directed graph:

```text
in-degree  = jumlah relationship masuk
out-degree = jumlah relationship keluar
```

Contoh:

```text
(:Account)<-[:OWNS]-(:Person)
```

Untuk `Account`, relationship `OWNS` adalah incoming. Untuk `Person`, relationship `OWNS` adalah outgoing.

Degree penting karena menentukan potensi fan-out.

---

### 6.2 Fan-Out

Fan-out adalah jumlah cabang traversal dari satu titik.

Misal:

```text
Satu Person menggunakan 3 Device.
Setiap Device digunakan oleh 20 Person.
Setiap Person memiliki 5 Account.
Setiap Account melakukan transfer ke 50 Account.
```

Jika kita traversal:

```text
Person -> Device -> Person -> Account -> Account
```

Potensi hasil kasar:

```text
1 * 3 * 20 * 5 * 50 = 15,000 paths
```

Itu baru beberapa hop.

Kalau traversal tidak dibatasi, graph query bisa menjadi sangat mahal walaupun setiap langkah secara lokal terlihat murah.

---

### 6.3 Graph Explosion

Graph explosion terjadi ketika jumlah path yang mungkin tumbuh sangat cepat karena branching factor tinggi.

Jika rata-rata fan-out adalah `b` dan depth traversal adalah `d`, jumlah kandidat bisa mendekati:

```text
O(b^d)
```

Contoh:

```text
b = 20

d = 1 -> 20
 d = 2 -> 400
 d = 3 -> 8,000
 d = 4 -> 160,000
 d = 5 -> 3,200,000
```

Inilah alasan query graph harus selalu punya boundary.

Boundary bisa berupa:

```text
- max depth,
- relationship type,
- node label,
- time window,
- risk threshold,
- status filter,
- tenant boundary,
- confidence score,
- direction,
- path uniqueness,
- limit pada candidate,
- precomputed relationship,
- GDS projection terpisah.
```

Top 1% engineer tidak hanya bisa menulis traversal. Mereka tahu kapan traversal akan meledak.

---

## 7. Local Graph vs Global Graph

### 7.1 Local Graph

Local graph adalah neighborhood di sekitar node tertentu.

Contoh:

```text
Semua entity dalam 2 hop dari Person P-001.
```

Cypher-style:

```cypher
MATCH p = (:Person {id: 'P-001'})-[*1..2]-()
RETURN p
```

Ini berguna untuk:

- investigation view,
- customer 360,
- related cases,
- immediate dependency impact,
- local recommendation explanation.

Risiko:

```text
Jika P-001 terhubung ke supernode, local graph bisa tiba-tiba menjadi sangat besar.
```

---

### 7.2 Global Graph

Global graph adalah keseluruhan jaringan.

Contoh:

```text
Semua account dan transaction dalam 2 tahun terakhir.
Semua user-role-permission-resource di enterprise.
Semua dependency antar service.
```

Global graph lebih sering dianalisis dengan graph algorithms:

- connected components,
- centrality,
- community detection,
- similarity,
- path finding,
- embeddings.

Operational query biasanya lokal; analytical query bisa global.

Kesalahan umum adalah memakai query operational untuk persoalan global.

Contoh buruk:

```cypher
MATCH p = (a:Account)-[:TRANSFERRED_TO*1..10]->(b:Account)
RETURN p
```

Pada graph transaction besar, ini hampir pasti berbahaya.

---

## 8. Query by Attribute vs Query by Connection

### 8.1 Query by Attribute

Pertanyaan:

```text
Cari semua customer dengan riskLevel HIGH.
```

Model:

```cypher
MATCH (p:Person {riskLevel: 'HIGH'})
RETURN p
```

Ini attribute lookup. Graph database bisa melakukannya, tetapi ini bukan alasan utama memakai graph.

Relational DB, document DB, search engine, atau columnar DB juga bisa melakukan ini dengan baik tergantung workload.

---

### 8.2 Query by Connection

Pertanyaan:

```text
Cari semua customer yang terhubung dalam maksimal 3 hop ke case fraud aktif melalui account, device, phone, atau company ownership.
```

Model:

```cypher
MATCH p = (person:Person)-[:OWNS|USES_DEVICE|USES_PHONE|CONTROLS|SUBJECT_OF*1..3]-(case:Case {type: 'FRAUD', status: 'ACTIVE'})
RETURN person, p
```

Ini graph-shaped.

Nilai utama bukan hanya menemukan `person`, tetapi juga memahami `p`, yaitu jalur koneksinya.

---

### 8.3 Query by Structural Pattern

Pertanyaan:

```text
Temukan pola di mana dua person berbeda berbagi device yang sama, masing-masing memiliki account berbeda, dan account-account tersebut saling mentransfer dana dalam 7 hari.
```

Graph pattern:

```cypher
MATCH
  (p1:Person)-[:USES_DEVICE]->(d:Device)<-[:USES_DEVICE]-(p2:Person),
  (p1)-[:OWNS]->(a1:Account)-[t:TRANSFERRED_TO]->(a2:Account)<-[:OWNS]-(p2)
WHERE p1 <> p2
  AND t.occurredAt >= datetime() - duration('P7D')
RETURN p1, p2, d, a1, a2, t
```

Ini bukan sekadar filter. Ini pattern detection.

Graph database unggul ketika query bisnis berbentuk pola hubungan.

---

## 9. Foreign Key vs Relationship: Apa Bedanya Secara Mental?

Relational foreign key menyatakan referential integrity:

```text
account.customer_id references customer.id
```

Graph relationship menyatakan domain connection yang bisa dilalui:

```text
(:Customer)-[:OWNS]->(:Account)
```

Secara konseptual keduanya bisa merepresentasikan hubungan. Perbedaannya muncul pada cara sistem digunakan.

### 9.1 Foreign Key Cocok Jika

```text
- Hubungan hanya dipakai untuk lookup langsung.
- Query depth biasanya 1.
- Struktur hubungan stabil dan sederhana.
- Tidak perlu mengeksplorasi jaringan.
- Tidak perlu return path sebagai explanation.
- Tidak ada kebutuhan graph algorithm.
```

Contoh:

```text
Order belongs to Customer.
Invoice belongs to Order.
```

Relational model sangat cocok.

---

### 9.2 Graph Relationship Cocok Jika

```text
- Hubungan adalah bagian utama domain.
- Query sering multi-hop.
- Path perlu dijelaskan.
- Relationship punya property penting.
- Relationship type banyak dan bermakna.
- Struktur berubah atau semi-terbuka.
- Dibutuhkan impact analysis.
- Dibutuhkan network detection.
- Dibutuhkan graph algorithms.
```

Contoh:

```text
Person controls Company.
Company owns Company.
Company owns Account.
Account transferred to Account.
Account used by Device.
Device shared by Person.
Person subject of Case.
Case related to Regulation.
```

Di sini hubungan bukan sekadar FK. Hubungan adalah domain.

---

## 10. Direction: Arah Relationship Bukan Sekadar Estetika

Dalam Neo4j, relationship punya arah. Pilihan arah memengaruhi readability query dan mental model.

Contoh:

```cypher
(:Person)-[:OWNS]->(:Account)
```

lebih natural daripada:

```cypher
(:Account)-[:OWNED_BY]->(:Person)
```

Keduanya bisa digunakan, tetapi query dominan harus menentukan pilihan.

### 10.1 Prinsip Memilih Arah

Gunakan arah yang:

1. Membaca seperti kalimat domain.
2. Cocok dengan pertanyaan paling umum.
3. Mengurangi kebingungan saat path panjang.
4. Stabil terhadap perubahan model.
5. Tidak memaksa relationship duplikat dua arah.

Contoh bagus:

```text
Person OWNS Account
Service DEPENDS_ON Service
Case HAS_EVIDENCE Evidence
User HAS_ROLE Role
Role GRANTS Permission
Permission APPLIES_TO Resource
```

### 10.2 Jangan Membuat Dua Relationship Simetris Tanpa Alasan

Anti-pattern:

```cypher
(:Person)-[:OWNS]->(:Account)
(:Account)-[:OWNED_BY]->(:Person)
```

Ini sering membuat data tidak konsisten.

Jika perlu query dari dua arah, Cypher bisa match arah sebaliknya:

```cypher
MATCH (a:Account)<-[:OWNS]-(p:Person)
RETURN a, p
```

Atau ignore direction:

```cypher
MATCH (a:Account)-[:OWNS]-(p:Person)
RETURN a, p
```

Relationship dua arah hanya masuk akal jika benar-benar ada dua fakta domain berbeda.

---

## 11. Relationship Semantics: Nama Edge Harus Membawa Makna

Graph yang baik membuat hubungan dapat dibaca tanpa dokumentasi panjang.

Bandingkan:

```cypher
(:Person)-[:RELATED_TO]->(:Company)
```

Dengan:

```cypher
(:Person)-[:FOUNDED]->(:Company)
(:Person)-[:DIRECTOR_OF]->(:Company)
(:Person)-[:BENEFICIAL_OWNER_OF]->(:Company)
(:Person)-[:EMPLOYED_BY]->(:Company)
(:Person)-[:AUTHORIZED_SIGNATORY_OF]->(:Company)
```

Keduanya sama-sama menghubungkan Person dan Company. Tetapi hanya yang kedua membawa semantics yang cukup untuk reasoning.

Pertanyaan:

```text
Apakah seseorang terkait dengan perusahaan?
```

terlalu lemah.

Pertanyaan yang lebih baik:

```text
Apakah seseorang memiliki kontrol formal, kontrol beneficial, posisi operasional, atau otorisasi transaksi terhadap perusahaan?
```

Graph modelling memaksa kita memperjelas relasi domain.

---

## 12. Node vs Relationship vs Property: Keputusan Awal yang Sangat Penting

Salah satu skill utama graph engineer adalah menentukan apakah sesuatu harus menjadi:

```text
- node,
- relationship,
- relationship property,
- node property,
- label,
- relationship type.
```

Part 002 dan Part 006 akan membahas ini lebih detail. Di sini kita bangun intuisi awal.

---

### 12.1 Jadikan Node Jika

Sesuatu perlu:

```text
- memiliki identity sendiri,
- dihubungkan ke banyak entity,
- dicari secara independen,
- punya lifecycle sendiri,
- punya provenance sendiri,
- menjadi titik traversal,
- punya banyak atribut,
- muncul di banyak konteks.
```

Contoh:

```text
Device sebagai node:
(:Person)-[:USES_DEVICE]->(:Device)<-[:USES_DEVICE]-(:Person)
```

Jika device hanya property:

```cypher
(:Person {deviceId: 'D-001'})
```

maka sulit menemukan semua person yang berbagi device tanpa scan/index lookup terpisah, dan device tidak bisa punya hubungan lain seperti:

```text
Device observed in Location
Device used in Transaction
Device flagged by RiskSignal
```

---

### 12.2 Jadikan Relationship Jika

Sesuatu adalah koneksi bermakna antara dua node.

Contoh:

```text
Person owns Account.
Account transferred to Account.
Service depends on Service.
Case has Evidence.
```

Relationship cocok jika fokusnya adalah hubungan itu sendiri.

---

### 12.3 Jadikan Relationship Property Jika

Atribut tersebut menjelaskan hubungan, bukan salah satu node.

Contoh:

```cypher
(:Person)-[:OWNS {
  percentage: 35.0,
  validFrom: date('2023-01-01'),
  validTo: null,
  source: 'registry'
}]->(:Company)
```

`percentage` bukan property Person atau Company. Itu property dari ownership relationship.

---

### 12.4 Jadikan Node Property Jika

Atribut hanya menjelaskan node dan tidak perlu ditelusuri sebagai entity.

Contoh:

```cypher
(:Person {
  id: 'P-001',
  fullName: 'Ayu Lestari',
  birthYear: 1988
})
```

`birthYear` biasanya property.

Tetapi `Address` mungkin node jika:

```text
- banyak person berbagi alamat,
- alamat punya geolocation,
- alamat menjadi evidence,
- alamat berubah seiring waktu,
- alamat dipakai untuk risk network.
```

---

## 13. Pattern: Domain Requirement yang Graph-Shaped

Bagaimana mengenali bahwa requirement cocok untuk graph?

Cari kata-kata seperti:

```text
connected to
related to
linked through
within N degrees
indirectly associated
shares
depends on
inherited from
controlled by
influenced by
reachable from
path between
impact of
network of
cluster of
ring of
community of
similar to
recommended because
explained by relationship
```

Dalam Bahasa Indonesia:

```text
terhubung dengan
berkaitan dengan
melalui jalur apa
relasi tidak langsung
berbagi
bergantung pada
diwarisi dari
dikendalikan oleh
terjangkau dari
dampak terhadap
jaringan
kelompok
komunitas
kemiripan
rekomendasi karena
penjelasan hubungan
```

Jika requirement memakai bahasa seperti ini, besar kemungkinan graph relevan.

---

## 14. Contoh Domain 1: Fraud Ring

### 14.1 Requirement Naif

```text
Cari transaksi fraud.
```

Ini belum tentu graph. Bisa SQL/search/ML biasa.

### 14.2 Requirement Graph-Shaped

```text
Cari kelompok account yang tampak berbeda tetapi sebenarnya terhubung melalui device, nomor telepon, alamat, beneficiary, rekening perantara, atau merchant yang sama.
```

Ini graph-shaped.

Model awal:

```cypher
(:Person)-[:OWNS]->(:Account)
(:Person)-[:USES_DEVICE]->(:Device)
(:Person)-[:USES_PHONE]->(:Phone)
(:Person)-[:LIVES_AT]->(:Address)
(:Account)-[:TRANSFERRED_TO]->(:Account)
(:Account)-[:PAID_MERCHANT]->(:Merchant)
(:Case)-[:HAS_SUBJECT]->(:Person)
```

Pertanyaan:

```text
Apakah Person P-001 terhubung dalam 3 hop ke Case fraud aktif?
```

Query conceptual:

```cypher
MATCH p = (:Person {id: 'P-001'})-[*1..3]-(:Case {type: 'FRAUD', status: 'ACTIVE'})
RETURN p
```

Namun query ini masih terlalu umum. Engineer yang matang akan membatasi relationship type:

```cypher
MATCH p = (:Person {id: 'P-001'})
  -[:OWNS|USES_DEVICE|USES_PHONE|LIVES_AT|TRANSFERRED_TO|HAS_SUBJECT*1..3]-
  (:Case {type: 'FRAUD', status: 'ACTIVE'})
RETURN p
```

Bahkan ini pun perlu boundary tambahan:

```text
- hanya relationship dengan confidence >= threshold,
- hanya transaksi 90 hari terakhir,
- hanya case aktif/confirmed,
- exclude public/shared device,
- exclude generic merchant,
- exclude address yang terlalu umum.
```

Graph thinking bukan “MATCH semua hubungan”. Graph thinking adalah **memilih hubungan yang bermakna dan membatasi traversal secara domain-aware**.

---

## 15. Contoh Domain 2: Dependency Graph

### 15.1 Requirement

```text
Jika service Payment API berubah, service mana yang terdampak?
```

Model:

```cypher
(:Service)-[:DEPENDS_ON]->(:Service)
(:Service)-[:CALLS_ENDPOINT]->(:Endpoint)
(:Service)-[:USES_TOPIC]->(:KafkaTopic)
(:Service)-[:READS_FROM]->(:Database)
(:Service)-[:WRITES_TO]->(:Database)
```

Pertanyaan graph:

```text
Apa upstream dan downstream dependency dari Payment API?
```

Direction matters.

Jika:

```cypher
(:Checkout)-[:DEPENDS_ON]->(:Payment)
```

Maka service yang terdampak oleh perubahan Payment adalah incoming dependents:

```cypher
MATCH p = (:Service {name: 'Payment'})<-[:DEPENDS_ON*1..3]-(:Service)
RETURN p
```

Sedangkan dependency yang dibutuhkan Payment adalah outgoing dependencies:

```cypher
MATCH p = (:Service {name: 'Payment'})-[:DEPENDS_ON*1..3]->(:Service)
RETURN p
```

Arah relationship membuat pertanyaan menjadi jelas.

---

## 16. Contoh Domain 3: Access Control / Entitlement Graph

### 16.1 Requirement

```text
Mengapa user U punya akses ke resource R?
```

Relational answer sering berupa:

```text
Karena ada row permission.
```

Graph answer bisa berupa path:

```text
User U
  MEMBER_OF Group G
  ASSIGNED Role R1
  GRANTS Permission P
  APPLIES_TO Resource X
```

Model:

```cypher
(:User)-[:MEMBER_OF]->(:Group)
(:Group)-[:ASSIGNED_ROLE]->(:Role)
(:Role)-[:GRANTS]->(:Permission)
(:Permission)-[:APPLIES_TO]->(:Resource)
```

Query explanation:

```cypher
MATCH p = (:User {id: 'U-001'})
  -[:MEMBER_OF|ASSIGNED_ROLE|GRANTS|APPLIES_TO*1..5]->
  (:Resource {id: 'R-001'})
RETURN p
```

Nilai graph di sini adalah explainability.

Bukan hanya:

```text
allowed = true
```

Tetapi:

```text
allowed because of this path.
```

Untuk regulatory/security system, kemampuan menjelaskan path bisa lebih penting daripada keputusan boolean.

---

## 17. Contoh Domain 4: Regulatory Case Network

Dalam enforcement lifecycle, data jarang berdiri sendiri.

Case bisa terkait dengan:

```text
- subject,
- complainant,
- organization,
- regulation,
- allegation,
- evidence,
- officer,
- decision,
- action,
- appeal,
- previous case,
- related transaction,
- related license,
- related address,
- related beneficial owner.
```

Graph model awal:

```cypher
(:Case)-[:HAS_SUBJECT]->(:Person)
(:Case)-[:HAS_ALLEGATION]->(:Allegation)
(:Allegation)-[:SUPPORTED_BY]->(:Evidence)
(:Case)-[:INVOLVES_ORG]->(:Organization)
(:Organization)<-[:BENEFICIAL_OWNER_OF]-(:Person)
(:Case)-[:VIOLATES]->(:Regulation)
(:Case)-[:ASSIGNED_TO]->(:Officer)
(:Decision)-[:DECIDES]->(:Case)
(:Action)-[:ENFORCES]->(:Decision)
(:Case)-[:RELATED_TO]->(:Case)
```

Pertanyaan graph:

```text
Apakah subject dalam case baru punya koneksi tidak langsung ke case enforcement sebelumnya?
```

Bukan hanya `same person`. Bisa lewat:

```text
- organization yang sama,
- beneficial owner yang sama,
- alamat yang sama,
- device yang sama,
- officer conflict,
- regulation yang sama,
- evidence source yang sama,
- financial transaction path.
```

Di sistem case management kompleks, graph membantu membentuk **case context**, bukan menggantikan workflow engine.

---

## 18. Contoh Domain 5: Recommendation Graph

Recommendation sering bisa dimodelkan sebagai graph:

```cypher
(:User)-[:VIEWED]->(:Item)
(:User)-[:PURCHASED]->(:Item)
(:User)-[:FOLLOWS]->(:User)
(:Item)-[:BELONGS_TO]->(:Category)
(:Item)-[:SIMILAR_TO]->(:Item)
```

Pertanyaan:

```text
Item apa yang relevan untuk User U karena user serupa membeli item tersebut?
```

Path:

```text
User U -> viewed Item A <- viewed User V -> purchased Item B
```

Penjelasan:

```text
Direkomendasikan karena pengguna dengan pola interaksi serupa membeli item B.
```

Graph membantu menghasilkan recommendation yang explainable.

Tetapi graph bukan selalu recommendation engine terbaik. Untuk skala sangat besar, biasanya graph dikombinasikan dengan:

```text
- batch embedding,
- vector search,
- ranking model,
- feature store,
- stream processing,
- cache.
```

Graph berguna sebagai struktur relationship dan explanation layer.

---

## 19. Contoh Domain 6: Knowledge Graph

Knowledge graph berusaha menangkap fakta dan semantics.

Contoh:

```cypher
(:Regulation)-[:DEFINES]->(:Obligation)
(:Obligation)-[:APPLIES_TO]->(:EntityType)
(:Case)-[:ALLEGES_BREACH_OF]->(:Obligation)
(:Evidence)-[:SUPPORTS]->(:Allegation)
(:Decision)-[:REFERENCES]->(:Regulation)
```

Pertanyaan:

```text
Untuk jenis pelanggaran ini, regulasi mana yang relevan, case precedent mana yang mirip, evidence apa yang biasanya dibutuhkan, dan action apa yang pernah diambil?
```

Ini bukan sekadar full-text search. Ini structural reasoning.

Namun knowledge graph butuh governance:

```text
- siapa menyatakan fakta,
- kapan fakta berlaku,
- sumbernya apa,
- confidence-nya berapa,
- apakah ada fakta yang bertentangan,
- apakah inference boleh otomatis,
- apakah hasilnya audit-ready.
```

---

## 20. Graph Query sebagai Controlled Expansion

Ini mental model paling penting untuk query performance.

Graph query bukan “scan seluruh graph”. Graph query idealnya:

```text
1. Mulai dari anchor node yang selektif.
2. Pilih relationship type yang relevan.
3. Tentukan arah traversal.
4. Batasi depth.
5. Filter node/relationship sedini mungkin.
6. Hindari supernode atau tangani secara khusus.
7. Return path/result yang diperlukan saja.
```

Contoh buruk:

```cypher
MATCH p = (a)-[*1..5]-(b)
RETURN p
```

Masalah:

```text
- tidak ada label anchor,
- tidak ada id anchor,
- tidak ada relationship type,
- tidak ada direction,
- tidak ada domain boundary,
- berpotensi traverse hampir seluruh graph.
```

Contoh lebih baik:

```cypher
MATCH p = (:Person {id: $personId})
  -[:OWNS|USES_DEVICE|USES_PHONE|LIVES_AT*1..3]-
  (:Case {status: 'ACTIVE', type: 'FRAUD'})
RETURN p
LIMIT 100
```

Masih bisa ditingkatkan, tetapi sudah lebih terkendali.

---

## 21. The Anchor Principle

Graph traversal harus punya anchor.

Anchor adalah titik awal yang selektif.

Contoh anchor bagus:

```text
Person by external id
Account by account number hash
Case by case id
Service by name
Resource by id
Device by fingerprint
```

Cypher:

```cypher
MATCH (p:Person {id: $personId})
MATCH path = (p)-[:OWNS|USES_DEVICE*1..2]-(:Person)
RETURN path
```

Tanpa anchor:

```cypher
MATCH path = (:Person)-[:OWNS|USES_DEVICE*1..2]-(:Person)
RETURN path
```

Ini mencari semua pair person yang memenuhi pattern. Bisa sangat mahal.

Top engineer akan bertanya:

```text
Query ini dimulai dari mana?
Seberapa selektif starting point-nya?
Berapa banyak relationship yang mungkin diekspansi dari anchor?
```

---

## 22. Traversal Boundary: Batas yang Membuat Query Masuk Akal

Traversal boundary adalah syarat yang menghentikan atau mengurangi expansion.

Jenis boundary:

### 22.1 Depth Boundary

```cypher
[*1..3]
```

Membatasi path 1 sampai 3 hop.

### 22.2 Relationship Type Boundary

```cypher
[:OWNS|CONTROLS|USES_DEVICE]
```

Hanya relationship tertentu.

### 22.3 Direction Boundary

```cypher
-[:DEPENDS_ON]->
```

Hanya arah tertentu.

### 22.4 Label Boundary

```cypher
(:Person)-[:OWNS]->(:Account)
```

Node harus label tertentu.

### 22.5 Property Boundary

```cypher
WHERE r.validTo IS NULL
```

Hanya relationship aktif.

### 22.6 Time Boundary

```cypher
WHERE t.occurredAt >= datetime() - duration('P90D')
```

Hanya data 90 hari terakhir.

### 22.7 Risk/Confidence Boundary

```cypher
WHERE r.confidence >= 0.8
```

Hanya hubungan dengan confidence cukup tinggi.

### 22.8 Tenant Boundary

```cypher
WHERE n.tenantId = $tenantId
```

Penting untuk multi-tenant.

### 22.9 Semantic Boundary

```text
Jangan traverse melalui Address yang dipakai lebih dari 1000 person.
Jangan traverse melalui public merchant.
Jangan traverse melalui shared corporate device.
```

Semantic boundary sering lebih penting daripada technical boundary.

---

## 23. Supernode: Node yang Membuat Traversal Menyesatkan

Supernode adalah node dengan degree sangat tinggi.

Contoh:

```text
Country: Indonesia
City: Jakarta
Merchant: Tokopedia
Device: shared kiosk
Address: apartment tower
Role: Employee
Permission: READ_ALL
Category: Electronics
```

Jika traversal melewati supernode, hasil bisa menjadi noisy.

Contoh:

```text
Person A lives in Jakarta.
Person B lives in Jakarta.
```

Apakah A dan B “related”? Secara graph iya jika kita traverse melalui city. Secara domain fraud, mungkin tidak bermakna.

Graph thinking membutuhkan pembedaan:

```text
connection exists != connection is meaningful
```

Inilah salah satu kesalahan terbesar dalam graph modelling.

---

## 24. Meaningful Path vs Accidental Path

Dalam graph besar, hampir semua hal bisa terhubung jika traversal cukup panjang.

Contoh:

```text
Person A -> City Jakarta <- Person B
```

Ini path, tetapi mungkin tidak meaningful.

Contoh lebih meaningful:

```text
Person A -> Device D <- Person B
Person A -> Account X -> transferred_to -> Account Y <- Person B
Person A -> Company C <- beneficial_owner_of <- Person B
```

Graph query harus membedakan:

```text
- structural connection,
- business meaningful connection,
- legally defensible connection,
- statistically significant connection,
- explainable connection.
```

Untuk regulatory/enforcement context, ini sangat penting. Jangan sampai sistem menyiratkan hubungan berisiko hanya karena ada path lemah.

---

## 25. Graph Distance: Dekat Secara Hop Belum Tentu Dekat Secara Risiko

Graph distance sering dihitung sebagai jumlah hop.

```text
A -> B -> C
```

Distance A ke C = 2.

Tetapi dalam domain nyata, semua hop tidak sama.

Contoh:

```text
Person -> owns -> Account
```

lebih kuat daripada:

```text
Person -> lives_in -> City
```

Jadi graph distance perlu ditafsirkan dengan semantics.

Kita bisa punya weighted relationship:

```text
OWNS_ACCOUNT weight 0.95
USES_DEVICE weight 0.80
SHARES_ADDRESS weight 0.60
SAME_CITY weight 0.05
```

Lalu risk path tidak hanya berdasarkan hop count, tetapi berdasarkan weighted confidence.

Ini akan menjadi penting di bagian GDS dan risk modelling.

---

## 26. Graph as Explanation, Not Just Retrieval

Salah satu kekuatan graph adalah explanation.

Query biasa:

```text
Customer X high risk.
```

Graph explanation:

```text
Customer X high risk because:
- owns Account A,
- Account A transferred funds to Account B,
- Account B is owned by Person Y,
- Person Y is subject of Case C,
- Case C is confirmed fraud.
```

Dalam sistem audit-heavy, explanation path bisa menjadi output utama.

Untuk Java service, ini berarti response model mungkin bukan hanya DTO entity:

```java
record RiskConnectionResponse(
    String subjectId,
    String relatedCaseId,
    List<PathStep> path,
    double confidence,
    String explanation
) {}

record PathStep(
    String fromNodeId,
    String relationshipType,
    Map<String, Object> relationshipProperties,
    String toNodeId
) {}
```

Graph mengubah bentuk API.

---

## 27. Graph Thinking untuk Java Engineer

Sebagai Java engineer, Anda mungkin terbiasa dengan:

```text
Entity
Repository
Service
DTO
Controller
Transaction
```

Dalam graph system, Anda perlu menambahkan konsep:

```text
Graph model
Traversal query
Path response
Relationship semantics
Graph invariant
Graph projection
Graph algorithm result
Graph refactoring
```

### 27.1 Repository Tidak Selalu CRUD

Repository graph sering bukan:

```java
findById(id)
save(entity)
delete(entity)
```

Tetapi:

```java
findFraudConnections(personId, maxDepth)
findAccessExplanation(userId, resourceId)
findDependencyImpact(serviceName, depth)
findRelatedCases(caseId, relationshipTypes)
upsertOwnership(personId, companyId, percentage, source)
```

Query menjadi domain operation.

---

### 27.2 DTO Bisa Berisi Path

Dalam REST API biasa:

```json
{
  "id": "P-001",
  "name": "Ayu"
}
```

Dalam graph API:

```json
{
  "subjectId": "P-001",
  "connectedTo": "CASE-991",
  "path": [
    {"from": "P-001", "type": "OWNS", "to": "ACC-10"},
    {"from": "ACC-10", "type": "TRANSFERRED_TO", "to": "ACC-99"},
    {"from": "P-909", "type": "OWNS", "to": "ACC-99"},
    {"from": "P-909", "type": "SUBJECT_OF", "to": "CASE-991"}
  ],
  "confidence": 0.84
}
```

API consumer mungkin butuh path untuk UI visualisation, audit, atau human review.

---

### 27.3 Unit Test Harus Menguji Graph Shape

Bukan hanya:

```text
Given entity, when save, then exists.
```

Tetapi:

```text
Given person owns account and account transfers to fraud-linked account,
when finding fraud connection within 3 hops,
then path is returned with expected relationship sequence.
```

Test graph harus punya golden graph dataset kecil.

---

## 28. Cara Membaca Requirement Menjadi Graph

Gunakan proses berikut.

### Step 1 — Tulis Pertanyaan Bisnis

Contoh:

```text
Apakah applicant baru memiliki hubungan tidak langsung dengan entity yang pernah dikenai enforcement action?
```

### Step 2 — Garis Bawahi Entity

```text
applicant
entity
enforcement action
```

Candidate nodes:

```text
Applicant/Person
Organization
Case
EnforcementAction
```

### Step 3 — Garis Bawahi Hubungan

```text
memiliki hubungan tidak langsung
pernah dikenai
```

Candidate relationships:

```text
(:Person)-[:OWNS]->(:Organization)
(:Person)-[:CONTROLS]->(:Organization)
(:Organization)-[:SUBJECT_OF]->(:Case)
(:Case)-[:RESULTED_IN]->(:EnforcementAction)
```

### Step 4 — Tentukan Path yang Mungkin

```text
Person -> Organization -> Case -> EnforcementAction
Person -> Address <- Organization -> Case -> EnforcementAction
Person -> Account -> Transaction -> Account <- Organization -> Case
```

### Step 5 — Tentukan Boundary

```text
max depth: 4
only confirmed enforcement actions
valid relationship at application date
exclude weak generic relationships
require confidence >= 0.7
```

### Step 6 — Tentukan Output

```text
- boolean match?
- list of related actions?
- explanation path?
- score?
- graph visualization?
- audit report?
```

Jika output butuh explanation path, graph semakin relevan.

---

## 29. Checklist: Apakah Requirement Ini Graph-Shaped?

Gunakan checklist berikut.

```text
[ ] Apakah pertanyaan utama menyangkut hubungan antar entity?
[ ] Apakah relationship type penting secara domain?
[ ] Apakah query membutuhkan multi-hop traversal?
[ ] Apakah path perlu dikembalikan sebagai explanation?
[ ] Apakah hubungan punya property penting?
[ ] Apakah domain punya network effect?
[ ] Apakah ada kebutuhan impact analysis?
[ ] Apakah ada kebutuhan community/ring/cluster detection?
[ ] Apakah relationship berubah seiring waktu?
[ ] Apakah connectedness lebih penting daripada attribute filtering?
[ ] Apakah model relational akan membutuhkan banyak recursive join atau closure table?
[ ] Apakah query perlu fleksibel terhadap relationship baru?
[ ] Apakah user berpikir secara visual/network?
[ ] Apakah graph algorithms mungkin relevan?
```

Semakin banyak jawaban “ya”, semakin kuat kandidat graph.

---

## 30. Checklist: Apakah Requirement Ini Bukan Graph-Shaped?

Graph bukan solusi universal.

```text
[ ] Query utama hanya filter atribut.
[ ] Query utama agregasi besar-besaran.
[ ] Data berbentuk event log append-only dan jarang ditraverse.
[ ] Workload utama full-text search.
[ ] Workload utama time-series rollup.
[ ] Workload utama key-value lookup.
[ ] Relationship tidak punya makna bisnis.
[ ] Depth query hampir selalu 1.
[ ] Path tidak pernah dikembalikan.
[ ] Tidak ada kebutuhan explanation.
[ ] Tidak ada kebutuhan graph algorithms.
[ ] Data volume sangat besar tetapi relationship query tidak selektif.
```

Jika sebagian besar benar, mungkin graph database bukan primary store yang tepat.

---

## 31. Graph Thinking dan Polyglot Persistence

Dalam sistem nyata, Neo4j sering bukan satu-satunya database.

Contoh architecture:

```text
PostgreSQL       -> source of truth for transactional records
Kafka            -> event stream / CDC
Neo4j            -> relationship projection / investigation graph
Elasticsearch    -> full-text search
ClickHouse       -> analytical aggregation
Redis            -> cache/session/fast lookup
Object storage   -> evidence documents/blobs
```

Neo4j bisa menjadi graph projection dari data lain.

Ini penting karena graph model sering lebih cocok untuk pertanyaan:

```text
How are things connected?
```

bukan semua pertanyaan:

```text
Where should all data live?
```

---

## 32. Common Mistakes di Tahap Awal

### Mistake 1 — Mengubah Semua Table Menjadi Node

Buruk:

```text
Setiap table menjadi label.
Setiap foreign key menjadi relationship.
Tidak ada redesign berdasarkan graph questions.
```

Akibat:

```text
Graph menjadi relational schema versi visual.
Query tetap tidak natural.
Relationship tidak membawa semantics.
```

---

### Mistake 2 — Menggunakan Relationship Generik

Buruk:

```cypher
(:A)-[:RELATED_TO]->(:B)
```

Akibat:

```text
Semantics pindah ke property atau application code.
Cypher pattern menjadi lemah.
```

---

### Mistake 3 — Tidak Membatasi Traversal

Buruk:

```cypher
MATCH p = (a)-[*]-(b)
RETURN p
```

Akibat:

```text
Query mahal, hasil noisy, sistem tidak predictable.
```

---

### Mistake 4 — Menganggap Semua Path Bermakna

Buruk:

```text
A dan B sama-sama tinggal di Jakarta, jadi mereka related risk.
```

Akibat:

```text
False positive tinggi.
User kehilangan trust.
Regulatory defensibility lemah.
```

---

### Mistake 5 — Tidak Memisahkan Operational Graph dan Analytical Graph

Operational graph:

```text
Query cepat, selektif, untuk aplikasi user-facing.
```

Analytical graph:

```text
Global algorithms, batch scoring, memory projection, offline/nearline processing.
```

Mencampur keduanya tanpa batas bisa menyebabkan performance dan correctness problem.

---

## 33. Mental Model: Graph Query sebagai Narasi Domain

Query graph yang baik bisa dibaca sebagai cerita.

Contoh:

```cypher
MATCH p = (subject:Person {id: $personId})
  -[:OWNS]->(:Account)
  -[:TRANSFERRED_TO]->(:Account)
  <-[:OWNS]-(counterparty:Person)
  -[:SUBJECT_OF]->(:Case {type: 'FRAUD'})
RETURN p
```

Narasi:

```text
Subject memiliki account.
Account tersebut mengirim dana ke account lain.
Account lain dimiliki counterparty.
Counterparty adalah subject dari fraud case.
```

Jika query tidak bisa dijelaskan sebagai narasi domain, kemungkinan model atau query terlalu teknis/generik.

---

## 34. Mental Model: Graph Modelling Dimulai dari Pertanyaan

Jangan mulai dari:

```text
Table apa saja yang sudah ada?
```

Mulai dari:

```text
Pertanyaan hubungan apa yang harus dijawab murah, jelas, dan defensible?
```

Contoh:

```text
1. Apa jalur koneksi dari subject ke enforcement action sebelumnya?
2. Apa blast radius jika service X gagal?
3. Mengapa user U punya akses ke resource R?
4. Siapa saja beneficial owner langsung/tidak langsung dari company C?
5. Apakah account ini bagian dari fraud ring?
```

Dari pertanyaan, turunkan:

```text
- node labels,
- relationship types,
- direction,
- properties,
- indexes,
- constraints,
- query boundaries,
- output shape.
```

Ini akan menjadi metodologi utama di Part 006.

---

## 35. Mini Lab Konseptual: Ubah Requirement Menjadi Graph

Requirement:

```text
Compliance officer ingin melihat apakah applicant punya koneksi ke company yang pernah dikenai enforcement action dalam 5 tahun terakhir.
```

### 35.1 Entity

```text
Applicant/Person
Company
EnforcementAction
Case
```

### 35.2 Relationship

```text
(:Person)-[:DIRECTOR_OF]->(:Company)
(:Person)-[:BENEFICIAL_OWNER_OF]->(:Company)
(:Person)-[:AUTHORIZED_SIGNATORY_OF]->(:Company)
(:Company)-[:SUBJECT_OF]->(:Case)
(:Case)-[:RESULTED_IN]->(:EnforcementAction)
```

### 35.3 Time Semantics

Relationship mungkin perlu property:

```text
validFrom
validTo
source
confidence
```

Action perlu property:

```text
actionDate
status
severity
```

### 35.4 Query Concept

```cypher
MATCH p = (:Person {id: $applicantId})
  -[:DIRECTOR_OF|BENEFICIAL_OWNER_OF|AUTHORIZED_SIGNATORY_OF*1..2]->
  (:Company)
  -[:SUBJECT_OF]->
  (:Case)
  -[:RESULTED_IN]->
  (action:EnforcementAction)
WHERE action.actionDate >= date() - duration('P5Y')
RETURN p, action
```

### 35.5 Critical Review

Pertanyaan untuk engineer:

```text
- Apakah depth 2 cukup?
- Apakah beneficial ownership bisa melalui company chain?
- Apakah perlu indirect ownership sampai 5 hop?
- Apakah semua relationship masih valid saat application date?
- Apakah action status harus final/confirmed?
- Apakah hubungan berdasarkan registry resmi atau self-declared?
- Apakah path perlu ditampilkan ke officer?
- Apakah confidence perlu dihitung?
- Apakah common company seperti public company harus diperlakukan khusus?
```

Inilah graph thinking: query bukan hanya syntax, tetapi domain reasoning.

---

## 36. Latihan Mandiri

### Latihan 1 — Identifikasi Graph-Shaped Requirement

Untuk setiap requirement berikut, tentukan apakah graph cocok sebagai primary model, supporting projection, atau tidak cocok.

```text
1. Tampilkan 100 transaksi terakhir milik customer.
2. Cari semua customer yang berbagi device dengan customer fraud.
3. Hitung total revenue per bulan selama 5 tahun.
4. Jelaskan mengapa user punya akses ke folder tertentu.
5. Cari dokumen yang mengandung kata “beneficial ownership”.
6. Temukan service yang terdampak jika database X dimatikan.
7. Tampilkan status invoice berdasarkan nomor invoice.
8. Deteksi cluster account yang saling transfer dalam pola circular.
```

Jawaban ringkas:

```text
1. Bukan primary graph; relational cocok.
2. Graph cocok.
3. OLAP/time-series lebih cocok.
4. Graph cocok.
5. Search engine lebih cocok, graph bisa melengkapi.
6. Graph cocok.
7. Bukan graph; key lookup/relational cocok.
8. Graph/GDS cocok.
```

### Latihan 2 — Tentukan Node/Relationship/Property

Domain:

```text
Person menggunakan nomor telepon untuk mendaftar account. Nomor telepon bisa dipakai beberapa person. Nomor telepon punya status verification dan observedAt.
```

Pertanyaan:

```text
Phone menjadi property Person atau node?
```

Jawaban:

```text
Phone sebaiknya node jika digunakan untuk menemukan shared identity/risk network.
```

Model:

```cypher
(:Person)-[:USES_PHONE {observedAt, verificationStatus}]->(:Phone {numberHash})
```

### Latihan 3 — Tentukan Boundary

Query:

```text
Cari semua entity yang terhubung ke Person P dalam 5 hop.
```

Perbaiki requirement:

```text
Cari semua Person atau Company yang terhubung ke Person P dalam maksimal 3 hop melalui ownership, directorship, account transfer, atau shared device, hanya untuk relationship aktif/teramati dalam 2 tahun terakhir, exclude node dengan degree di atas threshold tertentu, dan return top 100 path paling kuat berdasarkan confidence.
```

Ini jauh lebih engineering-ready.

---

## 37. Ringkasan Mental Model

Simpan poin ini:

```text
Graph database berguna ketika hubungan adalah data utama, bukan detail teknis.
```

```text
Node adalah entity.
Relationship adalah fakta koneksi bermakna.
Path adalah narasi hubungan.
Traversal adalah ekspansi terkendali dari anchor.
Fan-out adalah sumber utama risiko performa.
Supernode membuat path menjadi noisy dan mahal.
Semua path bukan berarti semua insight.
Graph modelling harus dimulai dari pertanyaan hubungan yang harus dijawab.
```

Sebagai Java engineer, ubah pertanyaan dari:

```text
Entity apa yang perlu saya persist?
```

menjadi:

```text
Relationship dan path apa yang harus bisa saya jelaskan, validasi, dan query dengan murah?
```

---

## 38. Apa yang Harus Anda Kuasai Sebelum Lanjut

Sebelum masuk Part 002, pastikan Anda bisa menjawab:

1. Apa bedanya relationship sebagai foreign key dan relationship sebagai graph edge?
2. Mengapa path lebih dari sekadar join chain?
3. Apa risiko variable-depth traversal?
4. Mengapa supernode berbahaya?
5. Bagaimana cara mengenali graph-shaped requirement?
6. Kapan graph database bukan pilihan tepat?
7. Mengapa graph query harus dimulai dari anchor selektif?
8. Apa bedanya local graph dan global graph?
9. Mengapa semua connection tidak selalu meaningful?
10. Bagaimana path bisa menjadi explanation untuk sistem audit-heavy?

---

## 39. Preview Part 002

Part berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-002.md
```

Judul:

```text
Property Graph Model Deep Dive
```

Fokus:

```text
- property graph vs RDF triple model,
- node labels,
- relationship types,
- identity,
- multi-label node,
- relationship properties,
- temporal validity,
- provenance,
- reification,
- hyperedge problem,
- graph schema as technical + social contract.
```

Di Part 001 kita belajar membaca dunia sebagai graph. Di Part 002 kita akan belajar membentuk graph itu secara benar.

---

## 40. Status Seri

```text
Part 001 selesai.
Seri belum selesai.
Masih ada Part 002 sampai Part 032.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-000.md">⬅️ Part 000 — Why Graph Database Exists and What Problem It Actually Solves</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-002.md">Part 002 — Property Graph Model Deep Dive ➡️</a>
</div>
