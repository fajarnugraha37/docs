# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-004

# Part 004 — Cypher Fundamentals: Pattern Matching as a Query Language

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Part: `004`  
> Topik: Cypher fundamentals, pattern matching, row pipeline, query composition, dan kesalahan dasar yang sering merusak correctness/performance  
> Target pembaca: Java software engineer yang sudah memahami SQL/database umum, tetapi ingin berpikir graph-native ketika menulis query Neo4j.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membangun tiga fondasi:

1. **Part 000** menjelaskan mengapa graph database ada dan kapan graph layak dipakai.
2. **Part 001** membentuk cara berpikir dari entity menuju relationship dan path.
3. **Part 002** membahas property graph model: node, relationship, label, type, property, reification, temporal validity, dan provenance.
4. **Part 003** membangun mental model runtime Neo4j: storage, page cache, query planner, execution plan, traversal, dan bottleneck.

Part ini masuk ke bahasa query utama Neo4j: **Cypher**.

Namun target part ini bukan “hafal sintaks”. Targetnya adalah memahami bagaimana Cypher bekerja sebagai **declarative graph pattern matching language**.

Kalau SQL sering terasa seperti:

```sql
SELECT columns
FROM table
JOIN table
WHERE predicates
GROUP BY ...
```

Cypher terasa seperti:

```cypher
MATCH graph_pattern
WHERE graph_predicate
RETURN projected_result
```

Tetapi perbedaan terdalam bukan bentuk sintaksnya. Perbedaan terdalamnya adalah:

```text
SQL bertanya:
  record mana dari tabel mana yang cocok setelah join?

Cypher bertanya:
  subgraph/path pattern mana yang ada di graph?
```

Cypher membuat relationship dan path menjadi bagian natural dari query, bukan sekadar hasil join antar tabel.

---

## 1. Core Mental Model: Cypher Mencari Pattern, Bukan Mengambil Row

Di Neo4j, data tersimpan sebagai graph:

```text
(:Person {id, name})-[:OWNS]->(:Account {id})
(:Account)-[:TRANSFERRED_TO {amount, at}]->(:Account)
(:Person)-[:SUBJECT_OF]->(:Case {id, status})
```

Cypher mengekspresikan pertanyaan sebagai pattern:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
RETURN p.name, a.id;
```

Artinya:

```text
Cari semua subgraph yang bentuknya:
Person node --OWNS relationship--> Account node
lalu kembalikan nama person dan id account.
```

Hal penting:

```text
MATCH tidak “mengambil Person lalu join Account”.
MATCH mendeskripsikan bentuk subgraph yang harus ada.
Planner kemudian memilih cara menemukan pattern itu.
```

Kadang planner mulai dari `Person`, kadang dari `Account`, kadang dari index, tergantung statistik, index, constraint, dan predicate.

Sebagai Java engineer, analogi yang berguna:

```text
Cypher query = deklarasi bentuk data yang diinginkan.
Neo4j planner = optimizer yang menyusun strategi pencarian.
Execution plan = pipeline operator yang menghasilkan row bindings.
```

---

## 2. Cypher Menghasilkan Row Binding

Ini bagian yang sering terlewat.

Walaupun Neo4j adalah graph database, hasil eksekusi Cypher secara internal dapat dipahami sebagai **pipeline of rows**.

Contoh:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
RETURN p, a;
```

Setiap match menghasilkan row binding:

```text
row 1: p = Person(P001), a = Account(A001)
row 2: p = Person(P001), a = Account(A002)
row 3: p = Person(P002), a = Account(A003)
```

Jadi, walaupun pattern-nya graph-shaped, hasil antara query tetap row-shaped.

Mental model ini sangat penting untuk memahami:

1. mengapa `WITH` penting,
2. mengapa cartesian product bisa terjadi,
3. mengapa aggregation mengubah jumlah row,
4. mengapa `OPTIONAL MATCH` menyisipkan `null`,
5. mengapa `UNWIND` memperbanyak row,
6. mengapa filter terlambat bisa mahal,
7. mengapa variable-length path bisa meledakkan cardinality.

Singkatnya:

```text
Cypher is graph pattern matching expressed as row pipeline.
```

---

## 3. Minimal Dataset Untuk Seluruh Part Ini

Kita gunakan domain kecil yang relevan untuk sistem enforcement, fraud, dan case management.

Bayangkan graph berikut:

```text
(:Person {id:'P1', name:'Ari', riskLevel:'HIGH'})
(:Person {id:'P2', name:'Bima', riskLevel:'MEDIUM'})
(:Person {id:'P3', name:'Citra', riskLevel:'LOW'})

(:Account {id:'A1', status:'ACTIVE'})
(:Account {id:'A2', status:'ACTIVE'})
(:Account {id:'A3', status:'SUSPENDED'})

(:Case {id:'C1', status:'OPEN', severity:'HIGH'})
(:Case {id:'C2', status:'CLOSED', severity:'LOW'})

(P1)-[:OWNS {since: date('2022-01-10')}]->(A1)
(P1)-[:OWNS {since: date('2023-03-01')}]->(A2)
(P2)-[:OWNS {since: date('2021-08-15')}]->(A3)

(A1)-[:TRANSFERRED_TO {amount: 7000000, at: datetime('2025-01-01T10:00:00')}]->(A3)
(A2)-[:TRANSFERRED_TO {amount: 250000, at: datetime('2025-01-02T09:00:00')}]->(A3)

(P1)-[:SUBJECT_OF]->(C1)
(P3)-[:SUBJECT_OF]->(C2)
```

DDL/data sample Cypher:

```cypher
CREATE
  (ari:Person {id:'P1', name:'Ari', riskLevel:'HIGH'}),
  (bima:Person {id:'P2', name:'Bima', riskLevel:'MEDIUM'}),
  (citra:Person {id:'P3', name:'Citra', riskLevel:'LOW'}),

  (a1:Account {id:'A1', status:'ACTIVE'}),
  (a2:Account {id:'A2', status:'ACTIVE'}),
  (a3:Account {id:'A3', status:'SUSPENDED'}),

  (c1:Case {id:'C1', status:'OPEN', severity:'HIGH'}),
  (c2:Case {id:'C2', status:'CLOSED', severity:'LOW'}),

  (ari)-[:OWNS {since: date('2022-01-10')}]->(a1),
  (ari)-[:OWNS {since: date('2023-03-01')}]->(a2),
  (bima)-[:OWNS {since: date('2021-08-15')}]->(a3),

  (a1)-[:TRANSFERRED_TO {amount: 7000000, at: datetime('2025-01-01T10:00:00')}]->(a3),
  (a2)-[:TRANSFERRED_TO {amount: 250000, at: datetime('2025-01-02T09:00:00')}]->(a3),

  (ari)-[:SUBJECT_OF]->(c1),
  (citra)-[:SUBJECT_OF]->(c2);
```

Untuk production, jangan asal `CREATE` seperti ini tanpa constraint. Constraint/index akan dibahas mendalam di Part 009. Di part ini kita fokus sintaks dan mental model query.

---

## 4. Node Pattern

Node pattern ditulis dengan parentheses:

```cypher
(n)
```

Artinya: node apa pun, label apa pun.

Contoh:

```cypher
MATCH (n)
RETURN n;
```

Ini mencari semua node. Untuk database non-trivial, query seperti ini biasanya buruk karena tidak selektif.

Node dengan label:

```cypher
MATCH (p:Person)
RETURN p;
```

Artinya: cari node dengan label `Person`.

Node dengan banyak label:

```cypher
MATCH (p:Person:Customer)
RETURN p;
```

Artinya: node yang punya label `Person` dan `Customer` sekaligus.

Node dengan property literal:

```cypher
MATCH (p:Person {id: 'P1'})
RETURN p;
```

Artinya: cari `Person` dengan property `id = 'P1'`.

Namun untuk aplikasi Java, jangan embed literal dari input user. Pakai parameter:

```cypher
MATCH (p:Person {id: $personId})
RETURN p;
```

Dengan parameter:

```json
{
  "personId": "P1"
}
```

Kenapa parameter penting?

1. Mencegah injection-style query construction bug.
2. Membantu plan cache.
3. Memisahkan query shape dari nilai runtime.
4. Membuat query lebih testable.

---

## 5. Relationship Pattern

Relationship pattern ditulis dengan brackets:

```cypher
-[r]->
```

Contoh:

```cypher
MATCH (p:Person)-[r:OWNS]->(a:Account)
RETURN p.name, r.since, a.id;
```

Komponen pattern:

```text
(p:Person)       node pattern, bind ke variable p
-[r:OWNS]->      relationship pattern, type OWNS, arah dari p ke a, bind ke variable r
(a:Account)      node pattern, bind ke variable a
```

Relationship tanpa variable:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
RETURN p.name, a.id;
```

Pakai ini ketika relationship tidak perlu dikembalikan atau difilter berdasarkan property.

Relationship tanpa type:

```cypher
MATCH (p:Person)-[r]->(x)
RETURN p, type(r), x;
```

Ini berarti relationship apa pun dari `p` ke node apa pun. Gunakan hati-hati. Tanpa type, ekspansi bisa terlalu luas.

Relationship tanpa direction:

```cypher
MATCH (p:Person)-[:ASSOCIATED_WITH]-(other:Person)
RETURN p, other;
```

Ini mencari relationship dua arah secara logical. Direction di storage tetap ada, tapi query memperlakukan kedua arah sebagai cocok.

Prinsip production:

```text
Lebih baik eksplisit tentang relationship type dan direction jika domain memang punya arah.
```

Arah relationship bukan sekadar optimisasi. Arah adalah bagian dari semantic model.

Contoh:

```text
(:Person)-[:OWNS]->(:Account)
```

lebih jelas daripada:

```text
(:Account)-[:OWNED_BY]->(:Person)
```

Keduanya bisa valid, tetapi seluruh model harus konsisten.

---

## 6. Direction Matters

Graph sering punya relationship yang secara bisnis directional:

```text
Person OWNS Account
Account TRANSFERRED_TO Account
Case ESCALATED_TO Unit
Officer REVIEWED Case
Company CONTROLS Company
```

Cypher memungkinkan query directional:

```cypher
MATCH (a1:Account)-[:TRANSFERRED_TO]->(a2:Account)
RETURN a1.id AS fromAccount, a2.id AS toAccount;
```

atau reverse:

```cypher
MATCH (a1:Account)<-[:TRANSFERRED_TO]-(a0:Account)
RETURN a1.id AS receivingAccount, a0.id AS senderAccount;
```

atau undirected:

```cypher
MATCH (a1:Account)-[:TRANSFERRED_TO]-(a2:Account)
RETURN a1.id, a2.id;
```

Jangan otomatis memakai undirected pattern karena “lebih gampang”. Itu bisa menggandakan interpretasi dan memperlemah semantic correctness.

Contoh buruk:

```cypher
MATCH (a:Account)-[:TRANSFERRED_TO]-(b:Account)
RETURN a, b;
```

Untuk pertanyaan “siapa penerima dana?”, ini salah secara semantik karena sender dan receiver dicampur.

Contoh lebih benar:

```cypher
MATCH (sender:Account)-[:TRANSFERRED_TO]->(receiver:Account)
RETURN sender.id AS sender, receiver.id AS receiver;
```

---

## 7. Variable Binding: Nama Variable Adalah Handle Terhadap Match

Ketika menulis:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
RETURN p.name, a.id;
```

`p` dan `a` adalah variable binding. Mereka menunjuk ke node yang cocok pada setiap row.

Variable bisa dipakai lagi dalam pattern berikut:

```cypher
MATCH (p:Person {id: $personId})-[:OWNS]->(a:Account)
MATCH (a)-[:TRANSFERRED_TO]->(target:Account)
RETURN p.name, a.id, target.id;
```

Artinya:

1. cari person tertentu dan account yang ia miliki,
2. dari account tersebut, cari transfer keluar,
3. return jalurnya.

Karena `a` sudah bound dari clause pertama, clause kedua tidak mencari semua account dari nol. Ia melanjutkan dari account yang sudah ditemukan.

Mental model:

```text
Bound variable mempersempit pencarian berikutnya.
Unbound variable memperluas pencarian baru.
```

---

## 8. `MATCH`: Mandatory Pattern

`MATCH` mencari pattern yang harus ada.

Contoh:

```cypher
MATCH (p:Person)-[:SUBJECT_OF]->(c:Case)
RETURN p.name, c.id, c.status;
```

Hanya person yang punya relationship `SUBJECT_OF` ke case yang akan muncul.

Jika seseorang tidak punya case, ia tidak muncul.

Contoh:

```cypher
MATCH (p:Person)
MATCH (p)-[:SUBJECT_OF]->(c:Case)
RETURN p.name, c.id;
```

Ini equivalent secara konsep dengan:

```cypher
MATCH (p:Person)-[:SUBJECT_OF]->(c:Case)
RETURN p.name, c.id;
```

Tetapi bentuk multi-`MATCH` berguna ketika ingin menyisipkan `WITH`, filter, limit, atau aggregation di antara pattern.

---

## 9. `WHERE`: Predicate Untuk Membatasi Match

`WHERE` menambahkan predicate.

Contoh:

```cypher
MATCH (p:Person)
WHERE p.riskLevel = 'HIGH'
RETURN p.name;
```

Bisa juga ditempel ke pattern:

```cypher
MATCH (p:Person {riskLevel: 'HIGH'})
RETURN p.name;
```

Keduanya sering equivalent, tetapi `WHERE` lebih fleksibel untuk predicate kompleks:

```cypher
MATCH (p:Person)-[o:OWNS]->(a:Account)
WHERE p.riskLevel IN ['HIGH', 'MEDIUM']
  AND o.since < date('2023-01-01')
  AND a.status = 'ACTIVE'
RETURN p.name, a.id, o.since;
```

Predicate pada relationship property:

```cypher
MATCH (from:Account)-[t:TRANSFERRED_TO]->(to:Account)
WHERE t.amount >= $minimumAmount
RETURN from.id, to.id, t.amount;
```

Predicate pada path existence:

```cypher
MATCH (p:Person)
WHERE EXISTS {
  MATCH (p)-[:SUBJECT_OF]->(:Case {status:'OPEN'})
}
RETURN p.name;
```

Ini berguna untuk filter berbasis pattern tanpa harus memperbanyak row hasil utama.

---

## 10. `RETURN`: Projection, Bukan Sekadar Output

`RETURN` menentukan bentuk hasil akhir.

Return node penuh:

```cypher
MATCH (p:Person {id:$id})
RETURN p;
```

Return property:

```cypher
MATCH (p:Person {id:$id})
RETURN p.id, p.name, p.riskLevel;
```

Return alias:

```cypher
MATCH (p:Person {id:$id})
RETURN p.id AS id, p.name AS name, p.riskLevel AS riskLevel;
```

Return map projection:

```cypher
MATCH (p:Person {id:$id})
RETURN p { .id, .name, .riskLevel } AS person;
```

Map projection sering lebih nyaman untuk aplikasi Java karena result shape lebih eksplisit.

Contoh nested-ish projection:

```cypher
MATCH (p:Person {id:$id})-[:OWNS]->(a:Account)
RETURN p { .id, .name, accounts: collect(a { .id, .status }) } AS person;
```

Hasilnya satu row per person jika aggregation benar.

Prinsip penting:

```text
Jangan RETURN seluruh subgraph hanya karena bisa.
Return shape harus mengikuti kebutuhan API/application contract.
```

Kalau service endpoint hanya butuh `personId`, `name`, dan `accountIds`, jangan return node penuh plus relationship penuh.

---

## 11. `WITH`: Boundary, Pipe, Scope, dan Cardinality Control

`WITH` adalah salah satu clause paling penting di Cypher.

Ia melakukan beberapa hal:

1. meneruskan variable ke query part berikutnya,
2. mengubah scope variable,
3. melakukan projection antara,
4. melakukan aggregation,
5. membatasi row dengan `ORDER BY`, `LIMIT`, `SKIP`,
6. mencegah query menjadi satu pattern besar yang sulit dikendalikan.

Contoh:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
WITH p, count(a) AS accountCount
WHERE accountCount > 1
RETURN p.name, accountCount;
```

Flow:

```text
MATCH menghasilkan row person-account.
WITH mengelompokkan per p dan menghitung account.
WHERE setelah WITH memfilter hasil aggregation.
RETURN mengembalikan hasil akhir.
```

Scope penting:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
WITH p
RETURN a;
```

Query ini salah karena `a` tidak diteruskan oleh `WITH`. Setelah `WITH p`, hanya `p` yang tersedia.

Ini disengaja. `WITH` adalah scope boundary.

Gunakan `WITH` untuk membatasi fan-out:

```cypher
MATCH (p:Person {riskLevel:'HIGH'})-[:OWNS]->(a:Account)
WITH a
LIMIT 100
MATCH (a)-[t:TRANSFERRED_TO]->(target:Account)
RETURN a.id, target.id, t.amount;
```

Namun hati-hati: `LIMIT` tanpa `ORDER BY` tidak deterministic secara bisnis. Kalau hasil harus stabil, pakai order eksplisit.

---

## 12. Clause Composition: Query Dibaca Sebagai Pipeline

Cypher clause tidak berdiri sendiri. Clause berikutnya menerima row dari clause sebelumnya.

Contoh:

```cypher
MATCH (p:Person)
WHERE p.riskLevel = 'HIGH'
MATCH (p)-[:OWNS]->(a:Account)
MATCH (a)-[t:TRANSFERRED_TO]->(target:Account)
RETURN p.name, a.id, target.id, t.amount;
```

Pipeline:

```text
1. cari Person high risk
2. untuk setiap person high risk, cari owned account
3. untuk setiap account, cari outgoing transfer
4. return kombinasi match
```

Inilah mengapa cardinality penting.

Kalau langkah 1 menghasilkan 10.000 person, langkah 2 rata-rata 20 account, langkah 3 rata-rata 1.000 transfer, hasil antara bisa:

```text
10.000 × 20 × 1.000 = 200.000.000 row
```

Sebelum query terlihat “kompleks”, ia sudah bisa mahal.

Graph query bukan sihir. Ia tetap tunduk pada cardinality.

---

## 13. `OPTIONAL MATCH`: Pattern Optional, Null Jika Tidak Ada

`OPTIONAL MATCH` mirip outer join dalam SQL: jika pattern tidak ditemukan, row sebelumnya tetap diteruskan dengan nilai `null` untuk bagian yang hilang.

Contoh:

```cypher
MATCH (p:Person)
OPTIONAL MATCH (p)-[:SUBJECT_OF]->(c:Case)
RETURN p.name, c.id AS caseId, c.status AS caseStatus;
```

Person tanpa case tetap muncul, dengan `caseId = null`.

Penting: `OPTIONAL MATCH` bukan “MATCH tapi tidak error”. Ia mengubah semantics row pipeline.

Contoh jebakan:

```cypher
MATCH (p:Person)
OPTIONAL MATCH (p)-[:SUBJECT_OF]->(c:Case)
WHERE c.status = 'OPEN'
RETURN p.name, c.id;
```

Predicate `WHERE` yang melekat pada `OPTIONAL MATCH` memengaruhi pattern optional. Ini sering membingungkan.

Kalau tujuan Anda:

```text
tampilkan semua person, dan tampilkan open case jika ada
```

pakai:

```cypher
MATCH (p:Person)
OPTIONAL MATCH (p)-[:SUBJECT_OF]->(c:Case {status:'OPEN'})
RETURN p.name, c.id AS openCaseId;
```

Kalau tujuan Anda:

```text
hanya tampilkan person yang punya open case
```

pakai mandatory match:

```cypher
MATCH (p:Person)-[:SUBJECT_OF]->(c:Case {status:'OPEN'})
RETURN p.name, c.id;
```

Kalau tujuan Anda:

```text
tampilkan semua person, hitung jumlah open case
```

pakai aggregation:

```cypher
MATCH (p:Person)
OPTIONAL MATCH (p)-[:SUBJECT_OF]->(c:Case {status:'OPEN'})
RETURN p.name, count(c) AS openCaseCount;
```

Mental model:

```text
OPTIONAL MATCH mempertahankan row yang sudah ada.
MATCH membuang row yang tidak punya pattern lanjutan.
```

---

## 14. `UNWIND`: Mengubah List Menjadi Row

`UNWIND` mengambil list dan mengubahnya menjadi row.

Contoh:

```cypher
UNWIND ['P1', 'P2', 'P3'] AS personId
MATCH (p:Person {id: personId})
RETURN p.id, p.name;
```

Pipeline:

```text
UNWIND menghasilkan:
row 1: personId = 'P1'
row 2: personId = 'P2'
row 3: personId = 'P3'

MATCH berjalan untuk setiap row.
```

Dalam aplikasi Java, pattern ini sering dipakai untuk batch lookup:

```cypher
UNWIND $personIds AS personId
MATCH (p:Person {id: personId})
RETURN p { .id, .name, .riskLevel } AS person;
```

Parameter:

```json
{
  "personIds": ["P1", "P2", "P3"]
}
```

`UNWIND` juga sering dipakai untuk batch write, tetapi write semantics akan dibahas lebih dalam di Part 010.

Contoh write preview:

```cypher
UNWIND $people AS row
MERGE (p:Person {id: row.id})
SET p.name = row.name,
    p.riskLevel = row.riskLevel;
```

Hati-hati:

```text
UNWIND memperbanyak row.
Kalau setiap row melakukan traversal besar, biaya query menjadi list_size × traversal_cost.
```

---

## 15. Aggregation: Mengubah Banyak Row Menjadi Ringkasan

Cypher aggregation mirip SQL secara mental, tetapi grouping key ditentukan oleh ekspresi non-aggregate yang dikembalikan.

Contoh:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
RETURN p.name AS personName, count(a) AS accountCount;
```

Karena `p.name` non-aggregate, grouping dilakukan per `p.name`.

Lebih aman grouping dengan identity node:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
RETURN p.id AS personId, p.name AS personName, count(a) AS accountCount;
```

`collect` mengumpulkan nilai ke list:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
RETURN p.id AS personId, collect(a.id) AS accountIds;
```

Distinct:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)-[:TRANSFERRED_TO]->(target:Account)
RETURN p.id AS personId, count(DISTINCT target) AS distinctTargets;
```

Tanpa `DISTINCT`, target yang sama bisa dihitung berkali-kali jika ada banyak path atau banyak relationship.

Prinsip:

```text
Aggregation bukan kosmetik output. Aggregation mengubah cardinality pipeline.
```

Contoh:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
WITH p, collect(a) AS accounts
RETURN p.name, size(accounts) AS accountCount;
```

Setelah `WITH`, row menjadi satu per person.

---

## 16. Ordering, Pagination, dan Determinism

Sorting:

```cypher
MATCH (p:Person)
RETURN p.id, p.name
ORDER BY p.name ASC;
```

Limit:

```cypher
MATCH (p:Person)
RETURN p.id, p.name
ORDER BY p.name ASC
LIMIT 10;
```

Skip:

```cypher
MATCH (p:Person)
RETURN p.id, p.name
ORDER BY p.name ASC
SKIP 20
LIMIT 10;
```

Hati-hati dengan offset pagination pada dataset besar dan data yang berubah. Sama seperti sistem lain, offset pagination bisa tidak stabil jika data berubah di antara request.

Untuk API produksi, sering lebih baik memakai cursor/keyset pagination:

```cypher
MATCH (p:Person)
WHERE p.name > $lastSeenName
RETURN p.id, p.name
ORDER BY p.name ASC
LIMIT $limit;
```

Namun cursor yang benar biasanya perlu composite ordering:

```cypher
MATCH (p:Person)
WHERE p.name > $lastName
   OR (p.name = $lastName AND p.id > $lastId)
RETURN p.id, p.name
ORDER BY p.name ASC, p.id ASC
LIMIT $limit;
```

Graph-specific warning:

```text
Jangan melakukan pagination setelah traversal besar kalau sebenarnya bisa membatasi starting set lebih awal.
```

Buruk:

```cypher
MATCH (p:Person)-[:OWNS]->(:Account)-[:TRANSFERRED_TO]->(target:Account)
RETURN p.id, target.id
ORDER BY p.id
LIMIT 100;
```

Lebih baik batasi person lebih awal jika requirement memungkinkan:

```cypher
MATCH (p:Person)
WHERE p.riskLevel = 'HIGH'
WITH p
ORDER BY p.id
LIMIT 100
MATCH (p)-[:OWNS]->(:Account)-[:TRANSFERRED_TO]->(target:Account)
RETURN p.id, target.id;
```

---

## 17. Null Semantics

Cypher punya `null`. Ini penting terutama dengan `OPTIONAL MATCH`.

Contoh:

```cypher
MATCH (p:Person)
OPTIONAL MATCH (p)-[:SUBJECT_OF]->(c:Case)
RETURN p.name, c.status;
```

Jika tidak ada case, `c` adalah `null`, maka `c.status` juga `null`.

Filter:

```cypher
MATCH (p:Person)
OPTIONAL MATCH (p)-[:SUBJECT_OF]->(c:Case)
WHERE c.status = 'OPEN'
RETURN p, c;
```

Jika `c` null, predicate `c.status = 'OPEN'` tidak true, sehingga hasil bisa tidak seperti yang diharapkan.

Untuk eksplisit:

```cypher
MATCH (p:Person)
OPTIONAL MATCH (p)-[:SUBJECT_OF]->(c:Case)
WITH p, c
WHERE c IS NULL OR c.status = 'OPEN'
RETURN p.name, c.id;
```

Namun tanya dulu: apakah ini benar secara bisnis?

```text
Person tanpa case dan person dengan open case sering bukan kategori yang sama.
```

Jangan memakai `OPTIONAL MATCH` untuk menyamarkan ambiguity requirement.

---

## 18. Cartesian Product: Kesalahan Dasar yang Mahal

Cartesian product terjadi ketika query mencocokkan dua pattern independen tanpa hubungan atau binding bersama.

Contoh buruk:

```cypher
MATCH (p:Person)
MATCH (a:Account)
RETURN p, a;
```

Jika ada 1.000 person dan 10.000 account:

```text
1.000 × 10.000 = 10.000.000 rows
```

Mungkin Anda bermaksud:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
RETURN p, a;
```

Atau jika memang perlu semua kombinasi, tuliskan dengan sadar dan batasi datanya:

```cypher
MATCH (p:Person)
WHERE p.riskLevel = 'HIGH'
WITH p
LIMIT 10
MATCH (a:Account)
WHERE a.status = 'SUSPENDED'
WITH p, a
LIMIT 100
RETURN p.id, a.id;
```

Tetapi pada domain graph, cartesian product sering tanda bahwa:

1. relationship hilang dari model,
2. query kehilangan binding variable,
3. requirement sebenarnya bukan graph traversal,
4. filter terlalu terlambat,
5. developer masih berpikir seperti nested loop manual.

Rule of thumb:

```text
Setiap MATCH tambahan harus menjawab:
"Pattern ini terikat ke variable mana dari pipeline sebelumnya?"
```

Jika jawabannya “tidak ada”, curigai cartesian product.

---

## 19. Pattern Granularity: Satu MATCH Panjang vs Banyak MATCH Pendek

Dua bentuk berikut bisa tampak mirip.

Satu pattern panjang:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)-[t:TRANSFERRED_TO]->(target:Account)
RETURN p.id, a.id, target.id, t.amount;
```

Banyak clause:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
MATCH (a)-[t:TRANSFERRED_TO]->(target:Account)
RETURN p.id, a.id, target.id, t.amount;
```

Keduanya bisa equivalent. Tetapi banyak clause memberi ruang untuk boundary:

```cypher
MATCH (p:Person {riskLevel:'HIGH'})-[:OWNS]->(a:Account)
WITH p, a
WHERE a.status = 'ACTIVE'
MATCH (a)-[t:TRANSFERRED_TO]->(target:Account)
WHERE t.amount >= 1000000
RETURN p.id, a.id, target.id, t.amount;
```

Gunakan satu pattern panjang ketika hubungan jelas dan tidak perlu boundary.

Gunakan beberapa clause + `WITH` ketika perlu:

1. filter bertahap,
2. aggregation,
3. limit/order sebelum ekspansi,
4. memecah query agar readable,
5. menghindari accidental row multiplication,
6. memisahkan concern.

---

## 20. Pattern Matching vs Join: Persamaan dan Perbedaan

Sebagai Java engineer yang sudah paham SQL, Anda boleh memulai dari analogi join, tetapi jangan berhenti di sana.

Persamaan:

```text
Keduanya menghasilkan kombinasi data yang memenuhi kondisi.
Keduanya punya cardinality.
Keduanya bisa meledak jika pattern/join terlalu luas.
Keduanya butuh index/constraint untuk starting point selektif.
```

Perbedaan:

```text
SQL join biasanya menggabungkan row melalui value equality.
Graph traversal mengikuti relationship fisik/logis yang sudah menjadi bagian data model.
```

SQL style:

```sql
SELECT p.id, a.id
FROM person p
JOIN account_owner ao ON ao.person_id = p.id
JOIN account a ON a.id = ao.account_id;
```

Cypher style:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
RETURN p.id, a.id;
```

Dalam Cypher, relationship bukan tabel tengah yang harus selalu diekspos sebagai artifact teknis. Ia adalah semantic edge.

Tetapi jangan salah paham:

```text
Neo4j bukan otomatis lebih cepat dari SQL untuk semua relationship query.
Neo4j unggul ketika query path/traversal dan perubahan relationship shape lebih natural sebagai graph.
```

Jika query selalu lookup by id dan update attribute sederhana, relational atau key-value bisa lebih tepat.

---

## 21. Query Shape Harus Dimulai Dari Anchor yang Selektif

Graph query sebaiknya punya starting point yang jelas.

Buruk:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)-[:TRANSFERRED_TO]->(target:Account)
WHERE p.id = $personId
RETURN target;
```

Secara deklaratif planner bisa saja tetap memakai predicate, tetapi sebagai habit, lebih jelas:

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(a:Account)-[:TRANSFERRED_TO]->(target:Account)
RETURN target;
```

Atau:

```cypher
MATCH (p:Person {id:$personId})
MATCH (p)-[:OWNS]->(a:Account)
MATCH (a)-[:TRANSFERRED_TO]->(target:Account)
RETURN target;
```

Mental model:

```text
Anchor awal harus kecil.
Traversal berikutnya boleh luas hanya jika business question memang membutuhkan.
```

Contoh anchor baik:

```text
Person by id
Case by id
Account by id
Organization by registration number
Transaction by id
Policy by code
Officer by id
```

Contoh anchor buruk:

```text
all Person
all Account
all Case
all transaction relationships
all nodes with any relationship
```

---

## 22. Returning Graph vs Returning DTO

Neo4j Browser enak untuk melihat graph:

```cypher
MATCH path = (p:Person {id:$id})-[:OWNS]->(:Account)-[:TRANSFERRED_TO]->(:Account)
RETURN path;
```

Tetapi API Java sering butuh DTO:

```cypher
MATCH (p:Person {id:$id})-[:OWNS]->(a:Account)-[t:TRANSFERRED_TO]->(target:Account)
RETURN {
  personId: p.id,
  accountId: a.id,
  targetAccountId: target.id,
  amount: t.amount,
  at: t.at
} AS transferPath;
```

Atau grouped:

```cypher
MATCH (p:Person {id:$id})-[:OWNS]->(a:Account)
OPTIONAL MATCH (a)-[t:TRANSFERRED_TO]->(target:Account)
RETURN p {
  .id,
  .name,
  accounts: collect(DISTINCT a { .id, .status }),
  outgoingTransfers: collect(DISTINCT {
    from: a.id,
    to: target.id,
    amount: t.amount,
    at: t.at
  })
} AS result;
```

Tapi hati-hati: optional match dapat menghasilkan map berisi null jika tidak dikontrol.

Lebih defensive:

```cypher
MATCH (p:Person {id:$id})-[:OWNS]->(a:Account)
OPTIONAL MATCH (a)-[t:TRANSFERRED_TO]->(target:Account)
WITH p, collect(DISTINCT a { .id, .status }) AS accounts,
     collect(DISTINCT CASE
       WHEN t IS NULL THEN null
       ELSE { from: a.id, to: target.id, amount: t.amount, at: t.at }
     END) AS rawTransfers
RETURN p {
  .id,
  .name,
  accounts: accounts,
  outgoingTransfers: [x IN rawTransfers WHERE x IS NOT NULL]
} AS result;
```

DTO-style return lebih stabil untuk service contract daripada mengembalikan node/relationship mentah.

---

## 23. Parameters: Wajib Untuk Aplikasi Java

Jangan membangun Cypher seperti ini:

```java
String query = "MATCH (p:Person {id:'" + personId + "'}) RETURN p";
```

Gunakan parameter:

```java
String query = "MATCH (p:Person {id:$personId}) RETURN p";
Map<String, Object> params = Map.of("personId", personId);
```

Cypher:

```cypher
MATCH (p:Person {id:$personId})
RETURN p { .id, .name, .riskLevel } AS person;
```

Parameter bisa untuk:

```text
string, number, boolean, date/time, list, map, nested map/list
```

Batch example:

```cypher
UNWIND $rows AS row
MATCH (p:Person {id: row.personId})
RETURN p.id AS id, p.name AS name;
```

Jangan parameterize label/type secara langsung seperti property value. Label/type adalah bagian query structure. Jika harus dinamis, whitelist di application layer.

Buruk:

```java
String query = "MATCH (n:" + userProvidedLabel + ") RETURN n";
```

Lebih aman:

```java
String label = switch (requestedType) {
  case PERSON -> "Person";
  case ACCOUNT -> "Account";
  case CASE -> "Case";
};
String query = "MATCH (n:" + label + ") RETURN n LIMIT $limit";
```

Tetap hati-hati dan validasi ketat.

---

## 24. Read Query Design Untuk Java Service

Dalam service Java, jangan hanya bertanya “query Cypher-nya apa?”. Tanya:

```text
1. Apa input command/query object?
2. Apa anchor paling selektif?
3. Apa relationship traversal minimum?
4. Apa result shape DTO?
5. Berapa cardinality maksimum yang acceptable?
6. Apa timeout/limit/pagination?
7. Apa invariant yang harus dijaga?
8. Apa index/constraint yang diasumsikan?
9. Apa fallback kalau result kosong?
10. Apa behavior kalau graph data tidak lengkap?
```

Contoh use case:

```text
Given personId,
return accounts owned by person and outgoing transfer summary for each account.
```

Query naive:

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(a:Account)-[t:TRANSFERRED_TO]->(target:Account)
RETURN p, a, t, target;
```

Masalah:

1. Person tanpa transfer tidak muncul.
2. Result row per transfer, bukan per account.
3. API harus grouping sendiri.
4. Tidak ada limit transfer.
5. Tidak jelas field mana yang dibutuhkan.

Lebih baik:

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(a:Account)
OPTIONAL MATCH (a)-[t:TRANSFERRED_TO]->(target:Account)
WITH p, a, t, target
ORDER BY t.at DESC
WITH p, a, collect(
  CASE WHEN t IS NULL THEN null ELSE {
    toAccountId: target.id,
    amount: t.amount,
    at: t.at
  } END
) AS rawTransfers
RETURN p {
  .id,
  .name,
  accounts: collect(a {
    .id,
    .status,
    recentOutgoingTransfers: [x IN rawTransfers WHERE x IS NOT NULL][0..10]
  })
} AS person;
```

Catatan: query ini masih punya nuance jika banyak account dan ordering per account. Bentuk final production bisa menggunakan subquery per account. Subquery akan dibahas di part lanjutan, tetapi idenya adalah: result shape harus disengaja.

---

## 25. Common Beginner Trap 1: Overmatching

Overmatching terjadi ketika pattern terlalu umum.

Buruk:

```cypher
MATCH (p)-[r]->(x)
RETURN p, r, x;
```

Ini cocok untuk eksplorasi kecil, bukan query aplikasi.

Lebih baik:

```cypher
MATCH (p:Person {id:$personId})-[r:OWNS]->(a:Account)
RETURN p.id, a.id;
```

Overmatching biasanya muncul dari:

1. tidak tahu label/type,
2. terlalu mengandalkan property filtering setelah traversal,
3. menulis query eksploratif lalu dipakai di production,
4. menganggap graph database boleh “scan everything”.

Rule:

```text
Exploration query boleh luas.
Application query harus anchored dan bounded.
```

---

## 26. Common Beginner Trap 2: Filtering Too Late

Buruk:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)-[t:TRANSFERRED_TO]->(target:Account)
WITH p, a, t, target
WHERE p.id = $personId
RETURN target;
```

Filter dilakukan setelah traversal besar.

Lebih baik:

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(a:Account)-[t:TRANSFERRED_TO]->(target:Account)
RETURN target;
```

Atau:

```cypher
MATCH (p:Person {id:$personId})
MATCH (p)-[:OWNS]->(a:Account)
MATCH (a)-[t:TRANSFERRED_TO]->(target:Account)
RETURN target;
```

Principle:

```text
Filter as early as semantically possible.
Especially before high fan-out traversal.
```

---

## 27. Common Beginner Trap 3: Misusing OPTIONAL MATCH

Buruk:

```cypher
MATCH (p:Person)
OPTIONAL MATCH (p)-[:SUBJECT_OF]->(c:Case)
WHERE c.status = 'OPEN'
RETURN p.name, c.id;
```

Developer sering berharap semua person muncul, tapi filter terhadap `c` dapat mengubah hasil.

Lebih eksplisit:

```cypher
MATCH (p:Person)
OPTIONAL MATCH (p)-[:SUBJECT_OF]->(c:Case {status:'OPEN'})
RETURN p.name, c.id AS openCaseId;
```

Atau jika hanya person dengan open case:

```cypher
MATCH (p:Person)-[:SUBJECT_OF]->(c:Case {status:'OPEN'})
RETURN p.name, c.id;
```

Rule:

```text
Jika optional karena data boleh tidak ada, pakai OPTIONAL MATCH.
Jika pattern wajib untuk hasil, pakai MATCH.
Jangan pakai OPTIONAL MATCH untuk menghindari berpikir tentang requirement.
```

---

## 28. Common Beginner Trap 4: Returning Too Much

Buruk:

```cypher
MATCH path = (p:Person {id:$id})-[*1..3]-(x)
RETURN path;
```

Ini bisa mengembalikan graph besar, banyak duplicate visual, dan payload besar.

Lebih baik untuk API:

```cypher
MATCH (p:Person {id:$id})-[:OWNS]->(a:Account)
RETURN p { .id, .name, accounts: collect(a { .id, .status }) } AS person;
```

Lebih baik untuk investigation UI:

```cypher
MATCH path = (p:Person {id:$id})-[:OWNS|SUBJECT_OF*1..2]-(x)
RETURN path
LIMIT 100;
```

Tetap bounded.

---

## 29. Common Beginner Trap 5: Losing Variables With WITH

Salah:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
WITH p
MATCH (a)-[:TRANSFERRED_TO]->(target:Account)
RETURN p, target;
```

`a` hilang setelah `WITH p`.

Benar:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
WITH p, a
MATCH (a)-[:TRANSFERRED_TO]->(target:Account)
RETURN p, target;
```

Gunakan scope ini sebagai fitur, bukan musuh. Ia memaksa Anda menyadari variable mana yang masih relevan.

---

## 30. Common Beginner Trap 6: Duplicate Results Karena Banyak Path

Contoh:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)-[:TRANSFERRED_TO]->(target:Account)
RETURN target.id;
```

Jika dua account milik person transfer ke target sama, target muncul dua kali.

Jika requirement adalah unique target:

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(:Account)-[:TRANSFERRED_TO]->(target:Account)
RETURN DISTINCT target.id AS targetAccountId;
```

Jika requirement adalah jumlah transfer:

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(:Account)-[t:TRANSFERRED_TO]->(target:Account)
RETURN target.id AS targetAccountId, count(t) AS transferCount;
```

Jika requirement adalah total amount:

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(:Account)-[t:TRANSFERRED_TO]->(target:Account)
RETURN target.id AS targetAccountId, sum(t.amount) AS totalAmount;
```

Duplicate bukan selalu bug. Duplicate adalah sinyal bahwa ada banyak match/path. Anda harus memutuskan semantic yang benar.

---

## 31. Path Variables: Mengembalikan Jalur

Path bisa diberi variable:

```cypher
MATCH path = (p:Person {id:$personId})-[:OWNS]->(:Account)-[:TRANSFERRED_TO]->(:Account)
RETURN path;
```

Untuk inspeksi, ini bagus.

Untuk API, kadang lebih baik ekstrak komponen:

```cypher
MATCH path = (p:Person {id:$personId})-[:OWNS]->(:Account)-[:TRANSFERRED_TO]->(:Account)
RETURN nodes(path) AS nodes, relationships(path) AS relationships;
```

Atau projection:

```cypher
MATCH path = (p:Person {id:$personId})-[:OWNS]->(a:Account)-[t:TRANSFERRED_TO]->(target:Account)
RETURN {
  personId: p.id,
  ownedAccountId: a.id,
  targetAccountId: target.id,
  amount: t.amount
} AS pathSummary;
```

Variable-length path akan dibahas khusus di Part 005. Untuk part ini, cukup pahami bahwa path adalah hasil match, bukan sekadar list arbitrary.

---

## 32. Pattern Alternatives: Multiple Relationship Types

Cypher dapat match beberapa relationship type:

```cypher
MATCH (p:Person)-[:OWNS|CONTROLS]->(entity)
RETURN p.id, labels(entity), entity.id;
```

Ini berguna untuk pertanyaan seperti:

```text
entity apa saja yang secara direct dimiliki atau dikontrol oleh person ini?
```

Tetapi hati-hati: menggabungkan type berarti menggabungkan semantics.

Kalau `OWNS` dan `CONTROLS` punya konsekuensi bisnis berbeda, jangan hilangkan perbedaan di result:

```cypher
MATCH (p:Person {id:$personId})-[r:OWNS|CONTROLS]->(entity)
RETURN p.id AS personId,
       type(r) AS relationType,
       labels(entity) AS entityLabels,
       entity.id AS entityId;
```

---

## 33. Property Access and Existence

Property access:

```cypher
MATCH (p:Person)
RETURN p.name;
```

Jika property tidak ada, hasilnya `null`.

Cek existence:

```cypher
MATCH (p:Person)
WHERE p.riskLevel IS NOT NULL
RETURN p;
```

Cek missing:

```cypher
MATCH (p:Person)
WHERE p.riskLevel IS NULL
RETURN p;
```

Jangan menyamakan:

```text
missing property
property null
empty string
unknown
not applicable
not yet assessed
```

Dalam sistem regulatori/case management, perbedaan ini penting.

Contoh lebih defensible:

```cypher
MATCH (p:Person)
WHERE p.riskAssessmentStatus = 'NOT_ASSESSED'
RETURN p.id;
```

Daripada mengandalkan `riskLevel IS NULL` untuk semua makna.

---

## 34. Case Expressions

`CASE` berguna untuk projection dan classification ringan.

```cypher
MATCH (p:Person)
RETURN p.id,
       CASE p.riskLevel
         WHEN 'HIGH' THEN 'requires_review'
         WHEN 'MEDIUM' THEN 'monitor'
         ELSE 'standard'
       END AS handlingCategory;
```

Generic CASE:

```cypher
MATCH (from:Account)-[t:TRANSFERRED_TO]->(to:Account)
RETURN from.id,
       to.id,
       t.amount,
       CASE
         WHEN t.amount >= 10000000 THEN 'VERY_LARGE'
         WHEN t.amount >= 1000000 THEN 'LARGE'
         ELSE 'NORMAL'
       END AS amountBand;
```

Jangan menaruh business policy kompleks di query tanpa governance. Untuk rule penting, lebih baik jelas apakah rule berada di:

1. domain service Java,
2. rules engine,
3. Cypher query,
4. stored projection,
5. graph data science score,
6. manual review policy.

Cypher boleh menghitung, tetapi jangan membuat policy tersembunyi.

---

## 35. List and Map Basics

List literal:

```cypher
RETURN ['HIGH', 'MEDIUM'] AS riskLevels;
```

Membership:

```cypher
MATCH (p:Person)
WHERE p.riskLevel IN ['HIGH', 'MEDIUM']
RETURN p;
```

Map literal:

```cypher
MATCH (p:Person {id:$id})
RETURN {id: p.id, name: p.name, risk: p.riskLevel} AS person;
```

List comprehension:

```cypher
WITH [1, 2, 3, 4, 5] AS nums
RETURN [n IN nums WHERE n % 2 = 0] AS evenNumbers;
```

Useful with collected maps:

```cypher
MATCH (p:Person {id:$id})-[:OWNS]->(a:Account)
OPTIONAL MATCH (a)-[t:TRANSFERRED_TO]->(target:Account)
WITH collect(
  CASE WHEN t IS NULL THEN null ELSE {to: target.id, amount: t.amount} END
) AS raw
RETURN [x IN raw WHERE x IS NOT NULL] AS transfers;
```

---

## 36. Query Readability Style

Cypher query yang production-grade harus bisa dibaca sebagai business question.

Buruk:

```cypher
MATCH (a)-[b]->(c)<-[d]-(e)
WHERE a.id=$x AND type(b)='OWNS'
RETURN a,b,c,d,e;
```

Lebih baik:

```cypher
MATCH (person:Person {id:$personId})-[ownership:OWNS]->(account:Account)
MATCH (account)<-[incomingTransfer:TRANSFERRED_TO]-(sourceAccount:Account)
RETURN person.id AS personId,
       account.id AS accountId,
       sourceAccount.id AS sourceAccountId,
       incomingTransfer.amount AS amount;
```

Naming convention:

```text
Node variable: noun, lowerCamelCase
Relationship variable: noun describing edge instance, lowerCamelCase
Relationship type: UPPER_SNAKE_CASE verb/semantic phrase
Label: PascalCase
Property: lowerCamelCase
```

Example:

```cypher
MATCH (case:Case {id:$caseId})<-[:SUBJECT_OF]-(subject:Person)
MATCH (subject)-[ownership:OWNS]->(account:Account)
RETURN case.id, subject.id, account.id, ownership.since;
```

Catatan: `case` bisa bentrok secara readability karena `CASE` keyword. Walaupun Cypher context bisa membedakan, untuk readability gunakan `investigationCase`.

```cypher
MATCH (investigationCase:Case {id:$caseId})<-[:SUBJECT_OF]-(subject:Person)
RETURN investigationCase.id, subject.id;
```

---

## 37. Debugging Query Secara Bertahap

Jangan menulis query panjang lalu berharap benar.

Langkah debugging:

### Step 1: Pastikan anchor benar

```cypher
MATCH (p:Person {id:$personId})
RETURN p;
```

### Step 2: Tambah satu relationship

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(a:Account)
RETURN p.id, a.id;
```

### Step 3: Tambah relationship berikutnya

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(a:Account)-[t:TRANSFERRED_TO]->(target:Account)
RETURN p.id, a.id, target.id, t.amount;
```

### Step 4: Tambah filter

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(a:Account)-[t:TRANSFERRED_TO]->(target:Account)
WHERE t.amount >= $minAmount
RETURN p.id, a.id, target.id, t.amount;
```

### Step 5: Tambah projection final

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(a:Account)-[t:TRANSFERRED_TO]->(target:Account)
WHERE t.amount >= $minAmount
RETURN {
  personId: p.id,
  fromAccountId: a.id,
  toAccountId: target.id,
  amount: t.amount
} AS result;
```

Prinsip:

```text
Bangun query dari anchor ke traversal ke filter ke projection.
Jangan mulai dari projection kompleks.
```

---

## 38. Reading Query Results As Evidence

Dalam domain investigasi/regulatori, query result bukan hanya data; ia bisa menjadi evidence atau decision support.

Contoh query:

```cypher
MATCH (subject:Person {id:$personId})-[:OWNS]->(owned:Account)-[transfer:TRANSFERRED_TO]->(suspicious:Account {status:'SUSPENDED'})
RETURN subject.id AS subjectId,
       owned.id AS ownedAccountId,
       suspicious.id AS suspiciousAccountId,
       transfer.amount AS amount,
       transfer.at AS at;
```

Pertanyaan defensibility:

1. Apakah `OWNS` berarti legal ownership, beneficial ownership, atau declared ownership?
2. Apakah `TRANSFERRED_TO` berasal dari source system mana?
3. Apakah `status:'SUSPENDED'` status saat ini atau saat transfer terjadi?
4. Apakah ada temporal validity?
5. Apakah transfer reversed/refunded?
6. Apakah account ownership saat transfer terjadi atau saat query dijalankan?

Cypher bisa menemukan pattern, tetapi correctness domain bergantung pada model.

Graph query yang tampak benar bisa salah jika temporal semantics tidak dimodelkan.

---

## 39. Cypher Untuk Exploration vs Application Query

Ada dua mode penggunaan Cypher.

### Exploration Query

Tujuan:

```text
Memahami data, menemukan pattern, melihat struktur graph.
```

Ciri:

```cypher
MATCH path = (n)-[r]-(m)
RETURN path
LIMIT 100;
```

Boleh agak luas, tetapi tetap dibatasi.

### Application Query

Tujuan:

```text
Melayani endpoint/use case dengan latency dan result contract jelas.
```

Ciri:

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(a:Account)
RETURN p { .id, .name, accounts: collect(a { .id, .status }) } AS person;
```

Harus:

1. anchored,
2. parameterized,
3. bounded,
4. result shape explicit,
5. tested,
6. profiled,
7. punya index/constraint assumption,
8. punya cardinality expectation.

Jangan copy-paste exploration query ke service.

---

## 40. Cypher Dalam Layered Java Architecture

Contoh struktur aplikasi:

```text
CaseGraphController
  -> CaseGraphQueryService
      -> CaseGraphRepository / Neo4jQueryGateway
          -> Neo4j Java Driver
              -> Cypher
```

Prinsip:

```text
Cypher query adalah bagian dari domain/application logic.
Jangan sebar string query acak di controller.
```

Buat query object:

```java
public record FindRelatedAccountsQuery(
    String personId,
    BigDecimal minimumAmount,
    int limit
) {}
```

Repository method:

```java
public List<RelatedAccountDto> findRelatedAccounts(FindRelatedAccountsQuery query) {
    // execute parameterized Cypher
}
```

Cypher:

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(a:Account)-[t:TRANSFERRED_TO]->(target:Account)
WHERE t.amount >= $minimumAmount
RETURN target.id AS accountId,
       sum(t.amount) AS totalAmount,
       count(t) AS transferCount
ORDER BY totalAmount DESC
LIMIT $limit;
```

Test bukan hanya “query jalan”, tetapi:

1. result benar untuk satu match,
2. result benar untuk no match,
3. result benar untuk duplicate path,
4. result benar untuk optional data,
5. result benar untuk high fan-out sample,
6. result shape stabil,
7. query tidak accidentally return node penuh.

---

## 41. Performance Preview: EXPLAIN dan PROFILE

Performance tuning mendalam ada di Part 011. Di sini cukup pahami dua alat utama:

```cypher
EXPLAIN
MATCH (p:Person {id:$personId})-[:OWNS]->(a:Account)
RETURN a;
```

`EXPLAIN` menunjukkan rencana tanpa menjalankan query.

```cypher
PROFILE
MATCH (p:Person {id:$personId})-[:OWNS]->(a:Account)
RETURN a;
```

`PROFILE` menjalankan query dan menunjukkan metrik aktual.

Saat membaca plan, cari tanda bahaya:

1. `AllNodesScan` pada database besar,
2. row count melonjak drastis,
3. db hits tinggi,
4. expand terlalu luas,
5. sort besar,
6. eager operator yang tidak diharapkan,
7. cartesian product,
8. aggregation setelah row explosion.

Rule awal:

```text
Kalau query dimulai dari anchor by id tetapi plan tetap scan besar, cek index/constraint.
Kalau row count melonjak setelah expand, cek relationship type, direction, dan traversal boundary.
```

---

## 42. Cypher Query Checklist Untuk Production

Sebelum query masuk production, cek:

```text
[ ] Apa business question yang dijawab?
[ ] Apa anchor paling selektif?
[ ] Apakah semua input user parameterized?
[ ] Apakah label dan relationship type eksplisit?
[ ] Apakah direction relationship benar secara domain?
[ ] Apakah traversal bounded?
[ ] Apakah OPTIONAL MATCH benar-benar diperlukan?
[ ] Apakah duplicate result sudah dipahami?
[ ] Apakah aggregation grouping key benar?
[ ] Apakah result shape sesuai DTO/API contract?
[ ] Apakah query return terlalu banyak data?
[ ] Apakah ada LIMIT untuk exploration/high fan-out result?
[ ] Apakah ORDER BY diperlukan untuk determinism?
[ ] Apakah index/constraint yang diasumsikan ada?
[ ] Apakah query sudah EXPLAIN/PROFILE di dataset representatif?
[ ] Apakah no-result behavior jelas?
[ ] Apakah null behavior jelas?
[ ] Apakah temporal semantics benar?
[ ] Apakah query bisa dijelaskan ke reviewer domain?
```

---

## 43. Mini Case Study: Related Account Discovery

Requirement:

```text
Untuk person tertentu, temukan account yang menerima transfer dari account milik person tersebut.
Kembalikan account penerima, total amount, jumlah transfer, dan apakah account penerima suspended.
```

Naive query:

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)-[t:TRANSFERRED_TO]->(target:Account)
WHERE p.id = $personId
RETURN target, t;
```

Masalah:

1. filter person bisa lebih eksplisit di anchor,
2. result row per transfer,
3. tidak aggregate per target,
4. return node/relationship mentah,
5. tidak ada ordering/limit.

Better query:

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(source:Account)-[transfer:TRANSFERRED_TO]->(target:Account)
WITH target,
     count(transfer) AS transferCount,
     sum(transfer.amount) AS totalAmount,
     max(transfer.at) AS latestTransferAt
RETURN target.id AS targetAccountId,
       target.status AS targetStatus,
       transferCount,
       totalAmount,
       latestTransferAt
ORDER BY totalAmount DESC, latestTransferAt DESC
LIMIT $limit;
```

Interpretasi:

```text
Anchor: Person by id.
Traversal: Person -> Account -> transferred target Account.
Aggregation: per target account.
Ranking: by total amount and latest activity.
Bound: limit.
```

Pertanyaan lanjutan yang belum dijawab:

1. Apakah hanya transfer dalam periode tertentu?
2. Apakah reversed transfer dihitung?
3. Apakah ownership harus valid saat transfer terjadi?
4. Apakah target account yang juga dimiliki person harus dikecualikan?
5. Apakah amount currency homogen?
6. Apakah suspicious status saat ini atau saat transfer?

Query yang lebih domain-aware:

```cypher
MATCH (p:Person {id:$personId})-[ownership:OWNS]->(source:Account)-[transfer:TRANSFERRED_TO]->(target:Account)
WHERE transfer.at >= $fromDate
  AND transfer.at < $toDate
  AND ownership.since <= date(transfer.at)
  AND NOT EXISTS {
    MATCH (p)-[:OWNS]->(target)
  }
WITH target,
     count(transfer) AS transferCount,
     sum(transfer.amount) AS totalAmount,
     max(transfer.at) AS latestTransferAt
RETURN {
  targetAccountId: target.id,
  targetStatus: target.status,
  transferCount: transferCount,
  totalAmount: totalAmount,
  latestTransferAt: latestTransferAt
} AS relatedAccount
ORDER BY relatedAccount.totalAmount DESC, relatedAccount.latestTransferAt DESC
LIMIT $limit;
```

Ini jauh lebih defensible karena mulai memasukkan temporal dan exclusion semantics.

---

## 44. Mini Case Study: Open Case Subject Summary

Requirement:

```text
Tampilkan semua high-risk person, jumlah open case, dan account aktif yang mereka miliki.
Person tetap muncul meskipun belum punya open case.
```

Query:

```cypher
MATCH (p:Person {riskLevel:'HIGH'})
OPTIONAL MATCH (p)-[:SUBJECT_OF]->(openCase:Case {status:'OPEN'})
WITH p, count(openCase) AS openCaseCount
OPTIONAL MATCH (p)-[:OWNS]->(activeAccount:Account {status:'ACTIVE'})
RETURN p {
  .id,
  .name,
  .riskLevel,
  openCaseCount: openCaseCount,
  activeAccounts: collect(activeAccount { .id, .status })
} AS personSummary
ORDER BY personSummary.openCaseCount DESC, personSummary.name ASC;
```

Potensi masalah:

Jika `activeAccount` null, `collect(activeAccount { .id, .status })` bisa perlu diuji. Bentuk defensive:

```cypher
MATCH (p:Person {riskLevel:'HIGH'})
OPTIONAL MATCH (p)-[:SUBJECT_OF]->(openCase:Case {status:'OPEN'})
WITH p, count(openCase) AS openCaseCount
OPTIONAL MATCH (p)-[:OWNS]->(activeAccount:Account {status:'ACTIVE'})
WITH p, openCaseCount,
     collect(CASE WHEN activeAccount IS NULL THEN null ELSE activeAccount { .id, .status } END) AS rawAccounts
RETURN p {
  .id,
  .name,
  .riskLevel,
  openCaseCount: openCaseCount,
  activeAccounts: [x IN rawAccounts WHERE x IS NOT NULL]
} AS personSummary
ORDER BY personSummary.openCaseCount DESC, personSummary.name ASC;
```

Pelajaran:

```text
OPTIONAL MATCH + collect perlu diuji pada data kosong.
Jangan asumsikan null handling sesuai intuisi tanpa test.
```

---

## 45. Mini Case Study: Case Link Discovery

Requirement:

```text
Untuk case tertentu, temukan case lain yang berhubungan karena subject-nya memiliki account yang transfer ke account milik subject case lain.
```

Model:

```text
(:Person)-[:SUBJECT_OF]->(:Case)
(:Person)-[:OWNS]->(:Account)
(:Account)-[:TRANSFERRED_TO]->(:Account)
```

Query:

```cypher
MATCH (sourceCase:Case {id:$caseId})<-[:SUBJECT_OF]-(sourcePerson:Person)
MATCH (sourcePerson)-[:OWNS]->(sourceAccount:Account)-[transfer:TRANSFERRED_TO]->(targetAccount:Account)<-[:OWNS]-(targetPerson:Person)-[:SUBJECT_OF]->(relatedCase:Case)
WHERE relatedCase.id <> sourceCase.id
RETURN relatedCase.id AS relatedCaseId,
       targetPerson.id AS relatedPersonId,
       count(transfer) AS transferCount,
       sum(transfer.amount) AS totalAmount,
       max(transfer.at) AS latestTransferAt
ORDER BY totalAmount DESC
LIMIT $limit;
```

Analisis:

```text
Anchor: sourceCase by id.
Path: case -> subject -> owned account -> transfer -> target account -> owner -> related case.
Filter: exclude same case.
Aggregate: per related case/person.
```

Risiko:

1. Banyak account bisa menyebabkan fan-out.
2. Banyak transfer bisa menyebabkan row explosion.
3. Jika account punya banyak owner, result bisa berlipat.
4. Jika target person punya banyak case, result bisa berlipat.
5. Perlu temporal constraint jika ownership berubah.

Versi lebih bounded:

```cypher
MATCH (sourceCase:Case {id:$caseId})<-[:SUBJECT_OF]-(sourcePerson:Person)
MATCH (sourcePerson)-[:OWNS]->(sourceAccount:Account)-[transfer:TRANSFERRED_TO]->(targetAccount:Account)
WHERE transfer.at >= $fromDate
  AND transfer.amount >= $minimumAmount
WITH sourceCase, targetAccount, transfer
ORDER BY transfer.amount DESC
LIMIT $maxTransfersToInspect
MATCH (targetAccount)<-[:OWNS]-(targetPerson:Person)-[:SUBJECT_OF]->(relatedCase:Case)
WHERE relatedCase.id <> sourceCase.id
RETURN relatedCase.id AS relatedCaseId,
       targetPerson.id AS relatedPersonId,
       count(transfer) AS transferCount,
       sum(transfer.amount) AS totalAmount,
       max(transfer.at) AS latestTransferAt
ORDER BY totalAmount DESC
LIMIT $limit;
```

Pelajaran:

```text
Graph query powerful karena path mengekspresikan investigasi secara natural.
Graph query berbahaya kalau path tidak dibatasi.
```

---

## 46. Mental Model For Correct Cypher

Saat melihat Cypher, baca dengan empat layer.

### Layer 1: Pattern

```text
Bentuk graph apa yang dicari?
```

### Layer 2: Binding

```text
Variable mana yang sudah bound?
Variable mana yang baru memperluas pencarian?
```

### Layer 3: Cardinality

```text
Berapa row yang mungkin muncul di setiap step?
Apakah ada fan-out?
Apakah ada duplicate path?
```

### Layer 4: Projection

```text
Hasil akhir mewakili semantic apa?
Row per apa?
Node per apa?
Path per apa?
Aggregate per apa?
```

Jika Anda tidak bisa menjawab “satu row hasil mewakili apa”, query belum matang.

Contoh:

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(a:Account)-[t:TRANSFERRED_TO]->(target:Account)
RETURN p.id, a.id, target.id, t.amount;
```

Satu row mewakili:

```text
satu transfer dari satu account milik person ke satu target account.
```

Contoh aggregation:

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(:Account)-[t:TRANSFERRED_TO]->(target:Account)
RETURN target.id, count(t), sum(t.amount);
```

Satu row mewakili:

```text
satu target account yang menerima satu atau lebih transfer dari account milik person.
```

Itu beda semantic.

---

## 47. Latihan Mandiri

Gunakan dataset kecil dari section 3, lalu jawab pertanyaan berikut dengan Cypher.

### Latihan 1

Cari semua person dan account yang mereka miliki.

Expected thinking:

```text
Person -> OWNS -> Account
row per ownership
```

### Latihan 2

Cari person yang memiliki lebih dari satu account.

Expected thinking:

```text
MATCH ownership
GROUP BY person
count account
filter count > 1
```

### Latihan 3

Cari account suspended yang menerima transfer dari account aktif.

Expected thinking:

```text
source Account status ACTIVE
TRANSFERRED_TO
 target Account status SUSPENDED
```

### Latihan 4

Tampilkan semua person dan open case jika ada.

Expected thinking:

```text
MATCH all Person
OPTIONAL MATCH open Case
```

### Latihan 5

Untuk `personId`, kembalikan target account unik yang menerima transfer dari account milik person tersebut.

Expected thinking:

```text
Anchor by person id
traverse ownership then transfer
DISTINCT target
```

### Latihan 6

Untuk `caseId`, temukan account milik subject case tersebut.

Expected thinking:

```text
Case <- SUBJECT_OF - Person - OWNS -> Account
```

### Latihan 7

Untuk semua person, hitung jumlah outgoing transfer dari account yang mereka miliki.

Expected thinking:

```text
Person -> Account -> transfer
aggregation per person
optional or mandatory depending whether zero-transfer person should appear
```

### Latihan 8

Tampilkan person high risk dengan account aktif, tetapi tetap tampilkan person meskipun tidak punya account aktif.

Expected thinking:

```text
MATCH high risk Person
OPTIONAL MATCH active Account
collect with null cleanup
```

---

## 48. Jawaban Latihan

### Jawaban 1

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
RETURN p.id AS personId, p.name AS personName, a.id AS accountId;
```

### Jawaban 2

```cypher
MATCH (p:Person)-[:OWNS]->(a:Account)
WITH p, count(a) AS accountCount
WHERE accountCount > 1
RETURN p.id AS personId, p.name AS personName, accountCount;
```

### Jawaban 3

```cypher
MATCH (source:Account {status:'ACTIVE'})-[t:TRANSFERRED_TO]->(target:Account {status:'SUSPENDED'})
RETURN source.id AS sourceAccountId,
       target.id AS suspendedAccountId,
       t.amount AS amount,
       t.at AS at;
```

### Jawaban 4

```cypher
MATCH (p:Person)
OPTIONAL MATCH (p)-[:SUBJECT_OF]->(c:Case {status:'OPEN'})
RETURN p.id AS personId,
       p.name AS personName,
       c.id AS openCaseId;
```

### Jawaban 5

```cypher
MATCH (p:Person {id:$personId})-[:OWNS]->(:Account)-[:TRANSFERRED_TO]->(target:Account)
RETURN DISTINCT target.id AS targetAccountId, target.status AS targetStatus;
```

### Jawaban 6

```cypher
MATCH (investigationCase:Case {id:$caseId})<-[:SUBJECT_OF]-(subject:Person)-[:OWNS]->(account:Account)
RETURN investigationCase.id AS caseId,
       subject.id AS subjectId,
       account.id AS accountId,
       account.status AS accountStatus;
```

### Jawaban 7

Jika hanya person yang punya outgoing transfer:

```cypher
MATCH (p:Person)-[:OWNS]->(:Account)-[t:TRANSFERRED_TO]->(:Account)
RETURN p.id AS personId,
       p.name AS personName,
       count(t) AS outgoingTransferCount;
```

Jika semua person harus muncul:

```cypher
MATCH (p:Person)
OPTIONAL MATCH (p)-[:OWNS]->(:Account)-[t:TRANSFERRED_TO]->(:Account)
RETURN p.id AS personId,
       p.name AS personName,
       count(t) AS outgoingTransferCount;
```

### Jawaban 8

```cypher
MATCH (p:Person {riskLevel:'HIGH'})
OPTIONAL MATCH (p)-[:OWNS]->(a:Account {status:'ACTIVE'})
WITH p, collect(CASE WHEN a IS NULL THEN null ELSE a { .id, .status } END) AS rawAccounts
RETURN p {
  .id,
  .name,
  .riskLevel,
  activeAccounts: [x IN rawAccounts WHERE x IS NOT NULL]
} AS highRiskPerson;
```

---

## 49. Ringkasan Part 004

Cypher adalah bahasa pattern matching untuk graph. Cara berpikir yang benar bukan “ambil table lalu join”, tetapi “deskripsikan bentuk subgraph/path yang harus ditemukan”.

Konsep utama:

```text
Node pattern       : (p:Person)
Relationship       : -[:OWNS]->
Path pattern       : (p)-[:OWNS]->(a)-[:TRANSFERRED_TO]->(b)
Binding            : variable seperti p, a, b, r
MATCH              : pattern wajib
OPTIONAL MATCH     : pattern optional, null jika tidak ada
WHERE              : predicate/filter
RETURN             : projection hasil
WITH               : boundary, scope, aggregation, pipeline control
UNWIND             : list -> rows
Aggregation        : row cardinality transformation
DISTINCT           : dedup semantic
ORDER BY/LIMIT     : determinism dan bounding
```

Mental model paling penting:

```text
Cypher adalah graph pattern matching yang dieksekusi sebagai row pipeline.
```

Kesalahan umum:

```text
- overmatching,
- filter terlambat,
- accidental cartesian product,
- misuse OPTIONAL MATCH,
- kehilangan variable karena WITH,
- duplicate result karena banyak path,
- return terlalu banyak graph,
- query tidak anchored,
- direction relationship salah,
- tidak memahami satu row hasil mewakili semantic apa.
```

Checklist sederhana:

```text
Start selective.
Bind variables intentionally.
Traverse only what the question needs.
Filter early.
Use WITH to control scope/cardinality.
Return DTO-shaped result for applications.
Profile before production.
```

---

## 50. Apa Yang Belum Dibahas

Part ini sengaja belum membahas secara mendalam:

1. variable-length traversal,
2. shortest path,
3. path uniqueness,
4. Cypher performance tuning detail,
5. index/constraint detail,
6. write semantics `CREATE`/`MERGE`,
7. transaction/concurrency,
8. Java Driver implementation,
9. Spring Data Neo4j,
10. GDS algorithms.

Itu akan dibahas di part berikutnya.

---

## 51. Referensi Resmi Untuk Pendalaman

Dokumentasi resmi yang relevan:

1. Neo4j Cypher Manual — Clauses.
2. Neo4j Cypher Manual — `MATCH`.
3. Neo4j Cypher Manual — `WHERE`.
4. Neo4j Cypher Manual — `RETURN`.
5. Neo4j Cypher Manual — `WITH`.
6. Neo4j Cypher Manual — `OPTIONAL MATCH`.
7. Neo4j Cypher Manual — `UNWIND`.
8. Neo4j Cypher Manual — Execution plans, `EXPLAIN`, `PROFILE`, dan operators.

---

## 52. Status Seri

```text
Part 000 selesai — Orientation: Why Graph Database Exists and What Problem It Actually Solves
Part 001 selesai — Graph Thinking: From Entities to Relationships to Paths
Part 002 selesai — Property Graph Model Deep Dive
Part 003 selesai — Neo4j Architecture: Storage, Query Engine, and Runtime Mental Model
Part 004 selesai — Cypher Fundamentals: Pattern Matching as a Query Language

Seri belum selesai.
Masih ada Part 005 sampai Part 032.
```

Part berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-005.md

Topik:
Cypher Path Semantics: Variable-Length Traversal, Shortest Path, and Expansion Control
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — Neo4j Architecture: Storage, Query Engine, and Runtime Mental Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-005.md">Part 005 — Cypher Path Semantics: Variable-Length Traversal, Shortest Path, and Expansion Control ➡️</a>
</div>
