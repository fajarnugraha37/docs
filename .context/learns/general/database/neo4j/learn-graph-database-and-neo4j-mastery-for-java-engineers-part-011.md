# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-011.md

# Part 011 — Query Performance: `PROFILE`, `EXPLAIN`, Cardinality, and Plan Tuning

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Bagian: `011`  
> Topik: Query performance, execution plan, cardinality, row pipeline, operator, index usage, traversal tuning  
> Target pembaca: Java software engineer / tech lead yang ingin mampu membaca, memperbaiki, dan mendesain Cypher query production-grade

---

## 0. Posisi Bagian Ini dalam Seri

Sampai bagian sebelumnya, kita sudah membangun fondasi:

- mengapa graph database ada;
- bagaimana berpikir dalam node, relationship, dan path;
- bagaimana property graph dimodelkan;
- bagaimana Neo4j kira-kira bekerja di storage/runtime level;
- dasar Cypher;
- path semantics;
- modelling methodology;
- advanced modelling patterns;
- anti-pattern modelling;
- schema, constraints, index;
- write correctness dengan `CREATE`, `MERGE`, idempotency, dan concurrency.

Bagian ini menjawab pertanyaan berikut:

> “Saya sudah punya model dan query Cypher. Bagaimana saya tahu query itu benar-benar efisien, apa bottleneck-nya, dan bagaimana memperbaikinya secara sistematis?”

Ini bukan bagian tentang “hafalan operator”. Tujuan utamanya adalah membuat kamu punya **mental model performa Cypher**.

Di SQL, sering kali bottleneck utama terlihat sebagai:

- full table scan;
- bad join order;
- missing index;
- sort/hash aggregate besar;
- nested loop di cardinality tinggi.

Di Neo4j, pola serupa tetap ada, tetapi bentuknya graph-native:

- start point terlalu luas;
- expansion terlalu dini;
- fan-out tidak dibatasi;
- path variable-length terlalu longgar;
- filter dilakukan setelah graph meledak;
- cartesian product tidak sengaja;
- `Eager` operator muncul karena boundary write/read;
- index ada tetapi tidak dipakai;
- query terlihat pendek tetapi cardinality intermediate sangat besar;
- result kecil tetapi kerja internal sangat besar.

Kalimat penting:

> Query graph yang cepat bukan query yang “sedikit baris Cypher”. Query graph yang cepat adalah query yang mengontrol ekspansi.

---

## 1. Core Mental Model: Cypher Performance adalah Masalah Pipeline + Expansion

Cypher dieksekusi sebagai pipeline baris.

Secara konseptual:

```cypher
MATCH (c:Customer {customerId: $customerId})
MATCH (c)-[:OWNS]->(a:Account)
MATCH (a)-[:TRANSFERRED_TO]->(b:Account)
RETURN b.accountNo
```

Bukan berarti Neo4j “langsung mengambil graph final”. Ia menjalankan tahap demi tahap:

1. cari `Customer` dengan `customerId`;
2. untuk setiap customer yang ditemukan, expand `OWNS`;
3. untuk setiap account yang ditemukan, expand `TRANSFERRED_TO`;
4. project `b.accountNo`.

Setiap tahap menghasilkan rows yang diteruskan ke tahap berikutnya.

Mental model:

```text
input rows
  -> operator 1
  -> intermediate rows
  -> operator 2
  -> intermediate rows
  -> operator 3
  -> output rows
```

Dalam graph query, intermediate rows bisa jauh lebih besar daripada final result.

Contoh:

```cypher
MATCH (p:Person)-[:KNOWS*1..5]->(x)
WHERE p.personId = $id
RETURN count(DISTINCT x)
```

Final result cuma satu angka.

Tapi internal work bisa jutaan path jika:

- `p` punya degree tinggi;
- `KNOWS` sangat dense;
- depth 5 terlalu besar;
- tidak ada filter selama ekspansi;
- cycle memungkinkan revisit;
- graph punya komunitas dense.

Jadi performa Cypher harus dibaca dengan tiga pertanyaan:

1. **Dari mana query mulai?**
2. **Berapa banyak rows/path yang dibuat di tengah?**
3. **Apakah query membatasi ekspansi sebelum ledakan terjadi?**

---

## 2. `EXPLAIN` vs `PROFILE`

Neo4j menyediakan dua alat utama untuk membaca query plan:

```cypher
EXPLAIN
MATCH ...
RETURN ...
```

dan:

```cypher
PROFILE
MATCH ...
RETURN ...
```

Perbedaannya:

| Tool | Query dijalankan? | Cocok untuk | Risiko |
|---|---:|---|---|
| `EXPLAIN` | Tidak | melihat rencana eksekusi tanpa menjalankan query | tidak memberi angka aktual |
| `PROFILE` | Ya | melihat operator aktual, rows aktual, db hits, memory | query benar-benar berjalan; write query juga bisa menulis |

Gunakan `EXPLAIN` ketika:

- query baru dan belum yakin aman;
- query mungkin mahal;
- query write;
- kamu ingin melihat apakah index kemungkinan dipakai;
- kamu sedang review query di PR.

Gunakan `PROFILE` ketika:

- query sudah aman dijalankan di dataset kecil/staging;
- kamu butuh angka aktual;
- kamu ingin tahu operator mana yang paling mahal;
- kamu sedang tuning.

Rule:

> Jangan `PROFILE` write query di production kecuali kamu benar-benar tahu efeknya.

Contoh berbahaya:

```cypher
PROFILE
MATCH (c:Customer {status: 'INACTIVE'})
DETACH DELETE c
```

Ini bukan “dry run”. Query akan dieksekusi.

Untuk write query, lakukan:

```cypher
EXPLAIN
MATCH ...
SET ...
```

atau uji di database staging/snapshot.

---

## 3. Apa Itu Execution Plan?

Execution plan adalah rencana operator yang dipakai Neo4j untuk menjawab query.

Contoh query:

```cypher
MATCH (c:Customer {customerId: $customerId})-[:OWNS]->(a:Account)
RETURN c.name, a.accountNo
```

Plan secara konseptual bisa seperti:

```text
ProduceResults
  Projection
    Expand(All)
      NodeIndexSeek(c:Customer(customerId))
```

Artinya:

1. `NodeIndexSeek` menemukan customer via index.
2. `Expand(All)` menelusuri relationship `OWNS`.
3. `Projection` mengambil field yang perlu dikembalikan.
4. `ProduceResults` mengirim result ke client.

Hal penting:

> Execution plan dibaca dari bawah ke atas secara konseptual, walau tampilan browser bisa berbeda.

Operator bawah biasanya leaf/start operator:

- `NodeIndexSeek`
- `NodeByLabelScan`
- `AllNodesScan`
- `RelationshipTypeScan`
- `NodeUniqueIndexSeek`

Operator tengah biasanya operasi graph/pipeline:

- `Expand(All)`
- `Expand(Into)`
- `Filter`
- `Projection`
- `Aggregation`
- `Sort`
- `Limit`
- `Optional`
- `Apply`
- `CartesianProduct`
- `Eager`

Operator atas biasanya result:

- `ProduceResults`

---

## 4. Kolom Penting dalam Plan

Saat `PROFILE`, Neo4j menampilkan metrik operator. Detail bisa berbeda antar versi, tetapi konsep yang perlu kamu baca:

| Kolom | Makna | Pertanyaan yang harus diajukan |
|---|---|---|
| Operator | langkah eksekusi | operator apa yang melakukan kerja besar? |
| Estimated Rows | perkiraan rows dari planner | apakah estimasi jauh dari aktual? |
| Rows | rows aktual melewati operator | apakah ada ledakan intermediate? |
| DB Hits | interaksi ke storage engine | operator mana yang paling banyak akses data? |
| Memory | memori yang dipakai operator | apakah sort/aggregate/eager besar? |
| Page Cache Hits/Misses | interaksi dengan page cache | apakah data sering miss ke disk? |
| Variables | variabel yang hidup di tahap itu | apakah query membawa data terlalu banyak? |

Jangan hanya melihat total runtime. Runtime bisa berubah karena cache hangat/dingin, network, ukuran result, dan load sistem.

Baca plan dengan urutan ini:

1. Cari start operator.
2. Lihat apakah memakai index.
3. Lihat Rows awal.
4. Ikuti pertumbuhan Rows di setiap expansion.
5. Cari operator dengan DB Hits besar.
6. Cari operator blocking seperti `Sort`, `Eager`, `Aggregation`.
7. Cari `CartesianProduct`.
8. Cek apakah `LIMIT` datang terlalu terlambat.
9. Cek apakah filter bisa dipindah lebih awal.
10. Cek apakah query membawa variable tidak perlu terlalu lama.

---

## 5. Cardinality: Konsep Terpenting dalam Query Tuning

Cardinality adalah jumlah rows yang diperkirakan atau dihasilkan oleh operator.

Contoh:

```cypher
MATCH (c:Customer {customerId: $customerId})
RETURN c
```

Jika `customerId` unique, cardinality awal seharusnya 1.

Tapi:

```cypher
MATCH (c:Customer {status: 'ACTIVE'})
RETURN c
```

Cardinality awal bisa jutaan.

Dalam graph query, cardinality berkembang lewat expansion.

Misal:

```text
1 customer
  -> owns 4 accounts
  -> each account has 500 transfers
  -> each transfer destination has 20 owners
```

Maka intermediate:

```text
1
4
2,000
40,000
```

Query:

```cypher
MATCH (c:Customer {customerId: $id})
MATCH (c)-[:OWNS]->(a:Account)
MATCH (a)-[:TRANSFERRED_TO]->(b:Account)
MATCH (b)<-[:OWNS]-(other:Customer)
RETURN DISTINCT other
```

Bisa menghasilkan result akhir hanya 200 customers, tetapi intermediate rows 40,000 atau lebih.

Prinsip:

> Performa graph query terutama ditentukan oleh cardinality intermediate, bukan ukuran final result.

---

## 6. Estimated Rows vs Actual Rows

Planner Neo4j membuat perkiraan cardinality berdasarkan statistik, schema, label, relationship type, index, constraint, dan pola query.

Jika `EXPLAIN` menunjukkan:

```text
Estimated Rows: 10
```

lalu `PROFILE` menunjukkan:

```text
Rows: 2,000,000
```

maka planner salah memahami data distribution atau query shape.

Penyebab umum:

1. Data sangat skewed.
2. Ada supernode.
3. Property tidak selective.
4. Label terlalu luas.
5. Relationship type terlalu generic.
6. Statistik belum fresh.
7. Query punya variable-length traversal.
8. Predicate sulit dipushdown.
9. Planner tidak tahu korelasi antar property.
10. Model graph menyembunyikan cardinality sebenarnya.

Contoh skew:

```cypher
MATCH (c:Customer {country: 'ID'})-[:MADE]->(t:Transaction)
RETURN count(t)
```

Jika 80% customer ada di `ID`, predicate `country = 'ID'` tidak selective.

Index pada `country` mungkin dipakai, tetapi tetap menghasilkan rows besar.

Index tidak otomatis membuat query cepat. Index hanya mempercepat menemukan start set. Jika start set besar, traversal berikutnya tetap mahal.

---

## 7. Start Point: Keputusan Paling Mahal atau Paling Menghemat

Dalam graph query, start point menentukan seberapa cepat query menyempit.

Query buruk:

```cypher
MATCH (c:Customer)-[:OWNS]->(a:Account)
WHERE c.customerId = $customerId
RETURN a
```

Secara deklaratif, ini benar. Planner mungkin tetap bisa mendorong filter. Tapi jangan bergantung pada keberuntungan jika query makin kompleks.

Lebih jelas:

```cypher
MATCH (c:Customer {customerId: $customerId})
MATCH (c)-[:OWNS]->(a:Account)
RETURN a
```

Start point ideal:

- label jelas;
- property selective;
- ada index/constraint;
- cardinality kecil;
- dekat dengan traversal yang dibutuhkan.

Contoh start point buruk:

```cypher
MATCH (t:Transaction)
WHERE t.amount > 100000
MATCH (t)-[:FROM]->(a:Account)
RETURN a
```

Jika `amount > 100000` menghasilkan jutaan transaksi, start point masih besar.

Alternatif:

```cypher
MATCH (c:Customer {customerId: $customerId})-[:OWNS]->(:Account)<-[:FROM]-(t:Transaction)
WHERE t.amount > 100000
RETURN t
```

Jika use case memang per-customer, mulai dari customer lebih selective.

Prinsip:

> Mulai dari node yang paling selective dan paling dekat dengan path yang dibutuhkan.

---

## 8. Index Seek vs Label Scan vs All Nodes Scan

Operator start yang umum:

| Operator | Makna | Biasanya baik/buruk |
|---|---|---|
| `NodeIndexSeek` | lookup node via index | biasanya baik |
| `NodeUniqueIndexSeek` | lookup via unique constraint/index | sangat baik untuk identity lookup |
| `NodeByLabelScan` | scan semua node dengan label tertentu | bisa OK jika label kecil, buruk jika besar |
| `AllNodesScan` | scan semua node | biasanya red flag |
| `RelationshipTypeScan` | scan relationship type tertentu | bisa OK untuk analytical query, buruk untuk OLTP path query |
| `DirectedRelationshipTypeScan` | scan relationship type directional | tergantung cardinality |
| `NodeIndexScan` | scan index, bukan seek exact | bisa OK untuk prefix/range, tetap perlu dilihat cardinality |

Contoh baik:

```cypher
MATCH (c:Customer {customerId: $customerId})
RETURN c
```

Dengan constraint:

```cypher
CREATE CONSTRAINT customer_id_unique
FOR (c:Customer)
REQUIRE c.customerId IS UNIQUE;
```

Plan ideal:

```text
NodeUniqueIndexSeek
```

Contoh red flag:

```cypher
MATCH (n)
WHERE n.externalId = $externalId
RETURN n
```

Tanpa label, planner tidak tahu index label mana yang dipakai.

Lebih baik:

```cypher
MATCH (c:Customer {externalId: $externalId})
RETURN c
```

Graph performance sering gagal karena query tidak memberi planner informasi cukup:

- tidak ada label;
- tidak ada relationship type;
- tidak ada direction;
- property tidak di-index;
- query terlalu generic.

---

## 9. Relationship Direction Matters

Relationship di Neo4j selalu punya arah secara storage/model, walau query bisa mengabaikannya.

Query:

```cypher
MATCH (a)-[:TRANSFERRED_TO]-(b)
RETURN a, b
```

Mencari dua arah.

Jika domain jelas arah transfer dari account sumber ke account tujuan, lebih baik:

```cypher
MATCH (a)-[:TRANSFERRED_TO]->(b)
RETURN a, b
```

Manfaat:

1. Query lebih semantik.
2. Search space lebih kecil.
3. Plan lebih mudah diprediksi.
4. Mengurangi duplicate path.
5. Mengurangi ambiguity untuk pembaca.

Undirected pattern tidak selalu salah. Ia berguna ketika domain memang symmetric:

```cypher
MATCH (p1:Person)-[:MARRIED_TO]-(p2:Person)
RETURN p1, p2
```

Tapi banyak domain terlihat symmetric secara bisnis padahal tidak secara query.

Contoh:

```text
Person associated with Company
```

Bisa dimodelkan:

```text
(person)-[:DIRECTOR_OF]->(company)
(person)-[:SHAREHOLDER_OF]->(company)
(person)-[:EMPLOYEE_OF]->(company)
```

Daripada:

```text
(person)-[:ASSOCIATED_WITH]-(company)
```

Semakin generic relationship type, semakin mahal dan kabur query-nya.

---

## 10. `Expand(All)` vs `Expand(Into)`

Dua operator expansion penting:

```text
Expand(All)
Expand(Into)
```

Secara mental:

- `Expand(All)` menemukan node baru dari node yang sudah bound.
- `Expand(Into)` memeriksa apakah relationship ada antara dua node yang sudah bound.

Contoh `Expand(All)`:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a:Account)
RETURN a
```

`a` belum diketahui, jadi Neo4j expand dari `c` ke `a`.

Contoh `Expand(Into)`:

```cypher
MATCH (c:Customer {customerId: $id})
MATCH (a:Account {accountNo: $accountNo})
MATCH (c)-[:OWNS]->(a)
RETURN c, a
```

`c` dan `a` sudah diketahui. Pattern ketiga hanya memeriksa relationship antara keduanya.

`Expand(Into)` sering lebih murah jika kedua node sudah selective.

Tapi jangan memaksa dua index lookup jika salah satu sisi sebenarnya tidak selective.

Bandingkan:

```cypher
MATCH (c:Customer {customerId: $id})
MATCH (a:Account {status: 'ACTIVE'})
MATCH (c)-[:OWNS]->(a)
RETURN a
```

Jika `status='ACTIVE'` menghasilkan jutaan account, ini buruk.

Lebih baik:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a:Account)
WHERE a.status = 'ACTIVE'
RETURN a
```

Start dari `c`, expand owned accounts, baru filter status.

Rule:

> `Expand(Into)` bagus saat kedua endpoint selective. Buruk jika salah satu endpoint adalah himpunan besar.

---

## 11. Cartesian Product: Silent Killer

Cartesian product terjadi saat query punya dua atau lebih pattern independent tanpa hubungan.

Contoh:

```cypher
MATCH (c:Customer {country: 'ID'})
MATCH (p:Product {category: 'LOAN'})
RETURN c, p
```

Jika ada:

```text
1,000,000 customers
100 loan products
```

Maka rows intermediate:

```text
100,000,000
```

Kadang memang sengaja, misalnya ingin membuat kombinasi. Tapi di OLTP graph query, sering tidak sengaja.

Contoh bug:

```cypher
MATCH (c:Customer {customerId: $customerId})
MATCH (a:Account {status: 'ACTIVE'})
CREATE (c)-[:RECOMMENDED_FOR]->(a)
```

Ini membuat relationship dari satu customer ke semua active accounts.

Mungkin maksudnya:

```cypher
MATCH (c:Customer {customerId: $customerId})
MATCH (a:Account {accountNo: $accountNo})
CREATE (c)-[:RECOMMENDED_FOR]->(a)
```

atau:

```cypher
MATCH (c:Customer {customerId: $customerId})-[:OWNS]->(a:Account)
WHERE a.status = 'ACTIVE'
CREATE (c)-[:RECOMMENDED_FOR]->(a)
```

Checklist:

- Apakah setiap `MATCH` terhubung ke variabel sebelumnya?
- Jika tidak, apakah cartesian product memang diinginkan?
- Apakah jumlah rows hasil perkalian masih kecil?
- Apakah perlu `LIMIT`/filter sebelum kombinasi?
- Apakah query write bisa membuat relationship massal tidak sengaja?

Jika plan menampilkan `CartesianProduct`, jangan otomatis panik, tetapi anggap itu **harus dijustifikasi**.

---

## 12. Filter Placement: Sebelum atau Sesudah Ledakan?

Cypher deklaratif, tetapi cara menulis query mempengaruhi seberapa jelas planner bisa memindahkan filter.

Buruk:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a)-[:TRANSFERRED_TO*1..4]->(b)
WHERE b.riskLevel = 'HIGH'
RETURN b
```

Jika path 1..4 menghasilkan jutaan `b`, filter `riskLevel` datang terlambat secara konseptual.

Lebih baik jika domain memungkinkan filter di titik traversal:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a)
MATCH path = (a)-[:TRANSFERRED_TO*1..4]->(b:Account)
WHERE b.riskLevel = 'HIGH'
RETURN b
```

Masih belum cukup jika high-risk account hanya sedikit tetapi traversal dari `a` luas. Alternatif start dari high-risk account mungkin lebih baik:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a)
MATCH (b:Account {riskLevel: 'HIGH'})
MATCH path = (a)-[:TRANSFERRED_TO*1..4]->(b)
RETURN b, path
```

Tapi ini juga bisa buruk jika high-risk account banyak.

Tidak ada aturan universal. Pilih berdasarkan cardinality:

```text
Option A:
specific customer -> all reachable accounts -> filter high risk

Option B:
all high-risk accounts -> check reachable from customer's accounts
```

Pertanyaan tuning:

- mana start set lebih kecil?
- relationship expansion dari mana lebih kecil?
- apakah path existence check lebih murah daripada enumerate all paths?
- apakah query butuh semua path atau hanya existence?
- apakah GDS shortest path/path finding lebih cocok?

---

## 13. Jangan Mengembalikan Graph Lebih Banyak dari yang Dibutuhkan

Query ini sering dipakai di Neo4j Browser:

```cypher
MATCH p = (c:Customer {customerId: $id})-[*1..3]-(x)
RETURN p
```

Bagus untuk eksplorasi kecil. Buruk untuk API production.

Mengembalikan `path` penuh berarti:

- node dan relationship semua harus dimaterialisasi;
- client menerima payload besar;
- driver harus decode banyak object;
- network cost naik;
- memory aplikasi naik;
- UI/API bisa lambat walau database cepat.

Untuk API, lebih baik project data yang dibutuhkan:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a:Account)
RETURN a.accountNo AS accountNo,
       a.status AS status,
       a.riskScore AS riskScore
```

Atau untuk graph visualization, batasi eksplisit:

```cypher
MATCH p = (c:Customer {customerId: $id})-[:OWNS|HAS_SIGNATORY|LINKED_TO*1..2]-(x)
WHERE x.riskScore >= 70
RETURN p
LIMIT 200
```

Rule:

> `RETURN p` cocok untuk exploration. API production sebaiknya return projection yang kontraknya jelas.

---

## 14. `LIMIT` Tidak Selalu Membatasi Kerja

Query:

```cypher
MATCH (c:Customer)-[:MADE]->(t:Transaction)
RETURN t
LIMIT 10
```

Mungkin cepat karena engine bisa berhenti setelah 10 rows.

Tapi:

```cypher
MATCH (c:Customer)-[:MADE]->(t:Transaction)
RETURN t
ORDER BY t.amount DESC
LIMIT 10
```

Butuh sort semua kandidat sebelum ambil top 10, kecuali index/order optimization bisa membantu.

Contoh lain:

```cypher
MATCH (c:Customer)-[:MADE]->(t:Transaction)
WITH c, count(t) AS txCount
RETURN c, txCount
ORDER BY txCount DESC
LIMIT 10
```

Harus menghitung transaksi per customer dulu. `LIMIT` tidak mengurangi agregasi awal.

Mental model:

| Query form | Apakah `LIMIT` membatasi kerja awal? |
|---|---:|
| simple stream tanpa sort | sering iya |
| setelah `ORDER BY` | sering tidak |
| setelah aggregation | tidak untuk agregasi awal |
| setelah variable-length path | sering terlambat |
| setelah `DISTINCT` | harus deduplicate dulu |
| setelah collecting list besar | terlambat |

Jangan menaruh `LIMIT` sebagai “penyelamat” setelah ledakan.

---

## 15. `DISTINCT` Bukan Obat Gratis

Cypher sering menghasilkan duplicate rows karena ada banyak path menuju node yang sama.

Contoh:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(:Account)-[:TRANSFERRED_TO*1..3]->(b:Account)
RETURN DISTINCT b
```

`DISTINCT` menyembunyikan duplicate di output, tetapi semua duplicate mungkin sudah dibuat di intermediate rows.

Jika ada 1,000 path menuju account yang sama, `DISTINCT` membuat output rapi tetapi tidak membuat traversal murah.

Alternatif:

1. Batasi path.
2. Gunakan relationship type lebih spesifik.
3. Gunakan node uniqueness jika cocok.
4. Ubah model.
5. Gunakan derived edge/materialized relationship.
6. Gunakan existence query daripada enumerate all paths.
7. Gunakan GDS untuk algoritma path tertentu.

`DISTINCT` berguna, tetapi harus dipahami sebagai operator deduplication, bukan traversal control.

---

## 16. `collect()` dan Memory

`collect()` mengubah banyak rows menjadi list.

Contoh:

```cypher
MATCH (c:Customer {customerId: $id})-[:MADE]->(t:Transaction)
RETURN c.customerId, collect(t) AS transactions
```

Jika customer punya jutaan transactions, list besar dibuat di memory.

Lebih aman untuk API:

```cypher
MATCH (c:Customer {customerId: $id})-[:MADE]->(t:Transaction)
RETURN t
ORDER BY t.timestamp DESC
LIMIT 100
```

Atau:

```cypher
MATCH (c:Customer {customerId: $id})-[:MADE]->(t:Transaction)
WITH t
ORDER BY t.timestamp DESC
LIMIT 100
RETURN collect({
  id: t.transactionId,
  amount: t.amount,
  timestamp: t.timestamp
}) AS recentTransactions
```

Tapi tetap pastikan `ORDER BY` tidak sorting jutaan rows tanpa index/strategy.

Rule:

> Jangan `collect()` sesuatu yang kamu tidak punya upper bound-nya.

---

## 17. `Eager` Operator: Boundary yang Sering Mengejutkan

`Eager` adalah operator blocking. Ia mematerialisasi intermediate result sebelum melanjutkan.

Ia bisa muncul untuk menjaga correctness, terutama dalam query yang membaca dan menulis data yang saling bergantung.

Contoh:

```cypher
MATCH (c:Customer)
SET c.normalizedName = toLower(c.name)
RETURN count(c)
```

Neo4j mungkin perlu boundary tertentu tergantung query.

Contoh yang lebih riskan:

```cypher
MATCH (a:Account)-[:TRANSFERRED_TO]->(b:Account)
MERGE (a)-[:CONNECTED_TO]->(b)
RETURN count(*)
```

Write berdasarkan read bisa memicu kebutuhan untuk menghindari efek newly written data mempengaruhi bagian query berikutnya.

`Eager` tidak selalu buruk. Tapi jika muncul di query besar, ia bisa menyebabkan:

- memory besar;
- latency tinggi;
- GC pressure;
- query gagal karena memory.

Cara mengurangi:

1. Pecah query menjadi batch.
2. Gunakan `CALL { ... } IN TRANSACTIONS` untuk batch import/update.
3. Batasi start set.
4. Hindari read/write interleaving rumit.
5. Pisahkan read phase dan write phase.
6. Gunakan staging property/label.
7. Jalankan job offline untuk transformasi besar.

---

## 18. Variable-Length Traversal Performance

Query ini deceptively small:

```cypher
MATCH p = (a:Account {accountNo: $accountNo})-[:TRANSFERRED_TO*1..5]->(b)
RETURN p
```

Bahaya:

- branching factor tinggi;
- cycle;
- duplicate path;
- tidak ada filter per depth;
- output path penuh;
- depth 5 bisa jauh lebih besar dari depth 3.

Fan-out sederhana:

```text
degree 10, depth 1 => 10
degree 10, depth 2 => 100
degree 10, depth 3 => 1,000
degree 10, depth 4 => 10,000
degree 10, depth 5 => 100,000
```

Jika degree rata-rata 50:

```text
50^5 = 312,500,000
```

Itu belum menghitung duplicate/cycle.

Prinsip variable-length traversal:

1. Selalu beri upper bound.
2. Jangan gunakan `*` tanpa batas.
3. Gunakan relationship type spesifik.
4. Gunakan direction jika mungkin.
5. Filter start node dengan index.
6. Filter target atau intermediate jika semantic valid.
7. Jangan return semua path kecuali memang perlu.
8. Jika hanya butuh reachability, jangan enumerate semua path.
9. Pertimbangkan GDS untuk path algorithm.
10. Uji dengan data realistis, bukan toy dataset.

Buruk:

```cypher
MATCH p = (a)-[*]-(b)
RETURN p
```

Lebih defensible:

```cypher
MATCH p = (a:Account {accountNo: $accountNo})
          -[:TRANSFERRED_TO|SUSPICIOUS_TRANSFER_TO*1..3]->
          (b:Account)
WHERE b.riskLevel IN ['HIGH', 'CRITICAL']
RETURN b.accountNo, length(p) AS distance
LIMIT 100
```

Masih perlu `PROFILE`, tapi setidaknya bounded dan semantic.

---

## 19. Shortest Path Performance

Shortest path sering dipakai untuk:

- related party distance;
- dependency chain;
- case linkage;
- fraud ring proximity;
- access inheritance path;
- supply chain exposure.

Contoh:

```cypher
MATCH (source:Account {accountNo: $source})
MATCH (target:Account {accountNo: $target})
MATCH p = shortestPath((source)-[:TRANSFERRED_TO*1..6]->(target))
RETURN p
```

Best condition:

- source cardinality 1;
- target cardinality 1;
- relationship type spesifik;
- depth bounded;
- graph tidak terlalu dense;
- path semantics cocok dengan shortest unweighted path.

Bad condition:

```cypher
MATCH (source:Account {riskLevel: 'HIGH'})
MATCH (target:Account {country: 'ID'})
MATCH p = shortestPath((source)-[:TRANSFERRED_TO*1..6]->(target))
RETURN p
```

Source dan target banyak. Planner/engine harus mengerjakan banyak pasangan.

Lebih baik:

- tentukan source dan target specific;
- atau gunakan GDS path algorithm;
- atau ubah pertanyaan menjadi reachability per source;
- atau lakukan batch offline;
- atau precompute component/community.

Shortest path bukan magic. Ia tetap harus menjelajahi graph.

---

## 20. Aggregation Cost

Aggregation mengelompokkan rows.

Contoh:

```cypher
MATCH (c:Customer)-[:MADE]->(t:Transaction)
RETURN c.customerId, count(t) AS txCount
```

Jika ada 1 miliar relationship `MADE`, query ini analytical, bukan OLTP.

Untuk OLTP:

```cypher
MATCH (c:Customer {customerId: $id})-[:MADE]->(t:Transaction)
RETURN count(t) AS txCount
```

Jika sering dibutuhkan, pertimbangkan materialized count:

```cypher
MATCH (c:Customer {customerId: $id})
RETURN c.transactionCount AS txCount
```

Tapi materialized count punya trade-off:

- write complexity naik;
- consistency risk;
- retry/idempotency harus kuat;
- backfill/reconciliation perlu;
- concurrent update harus benar.

Rule:

> Aggregation besar adalah sinyal bahwa workload mungkin analytical atau butuh precomputation.

---

## 21. Sort Cost dan Top-K

Sorting mahal jika kandidat besar.

Query:

```cypher
MATCH (t:Transaction)
WHERE t.amount > $minAmount
RETURN t
ORDER BY t.amount DESC
LIMIT 100
```

Jika ada index yang mendukung range/order, bisa lebih baik. Tapi tetap lihat plan.

Untuk graph-local query:

```cypher
MATCH (c:Customer {customerId: $id})-[:MADE]->(t:Transaction)
RETURN t
ORDER BY t.timestamp DESC
LIMIT 20
```

Jika customer punya ribuan transaksi, OK. Jika jutaan, perlu strategi:

- relationship time bucket;
- recent transaction relationship;
- materialized latest list;
- separate time-series/OLTP table;
- query dari transaction index dengan customerId denormalized;
- model ulang.

Graph traversal tidak otomatis menggantikan access pattern time-ordered.

Jika use case utama adalah:

```text
get latest 20 transactions by account
```

maka graph bukan selalu tempat terbaik untuk query tersebut, kecuali transaksi memang perlu traversal relationship lebih lanjut.

---

## 22. Parameterization dan Query Cache

Buruk:

```java
String cypher = "MATCH (c:Customer {customerId: '" + id + "'}) RETURN c";
```

Selain injection risk, query string berubah terus. Planner/cache sulit reuse.

Baik:

```cypher
MATCH (c:Customer {customerId: $customerId})
RETURN c
```

Java:

```java
var result = session.executeRead(tx ->
    tx.run("""
        MATCH (c:Customer {customerId: $customerId})
        RETURN c.customerId AS customerId, c.name AS name
        """, Map.of("customerId", customerId)
    ).single()
);
```

Manfaat parameter:

- lebih aman;
- query plan reusable;
- observability lebih bersih;
- log query tidak penuh literal sensitif;
- driver API lebih idiomatik.

Tapi parameter bukan obat semua. Parameterized query dengan start set besar tetap lambat.

---

## 23. Query Shape Stability

Production system butuh query shape yang stabil.

Contoh buruk:

```java
String relType = request.getRelType();
String cypher = "MATCH (a)-[r:" + relType + "]->(b) RETURN b";
```

Masalah:

- injection risk untuk identifier;
- plan berbeda-beda;
- observability sulit;
- authorization sulit;
- relationship type arbitrary;
- API mendorong query generic.

Lebih baik expose use case:

```java
findOwnedAccounts(customerId)
findRecentCounterparties(accountNo)
findRelatedCases(caseId)
findAccessPath(userId, resourceId)
```

Lalu masing-masing punya Cypher eksplisit.

Graph API yang terlalu generic sering menjadi query engine publik yang sulit diamankan dan dituning.

Rule:

> Jangan expose Cypher-shaped freedom ke API kecuali memang membangun query product dengan guardrail kuat.

---

## 24. Membawa Variable Terlalu Lama

Contoh:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a:Account)
MATCH (a)-[:TRANSFERRED_TO]->(b:Account)
MATCH (b)<-[:OWNS]-(other:Customer)
RETURN c, a, b, other
```

Jika hanya butuh `other`, jangan bawa semua object penuh:

```cypher
MATCH (:Customer {customerId: $id})-[:OWNS]->(:Account)-[:TRANSFERRED_TO]->(b:Account)
MATCH (b)<-[:OWNS]-(other:Customer)
RETURN DISTINCT other.customerId AS customerId, other.name AS name
```

Atau gunakan `WITH` untuk boundary:

```cypher
MATCH (:Customer {customerId: $id})-[:OWNS]->(:Account)-[:TRANSFERRED_TO]->(b:Account)
WITH DISTINCT b
MATCH (b)<-[:OWNS]-(other:Customer)
RETURN DISTINCT other.customerId AS customerId
```

`WITH DISTINCT b` bisa mengurangi duplicate `b` sebelum expansion berikutnya.

Tapi hati-hati: `DISTINCT` juga punya cost. Gunakan jika duplicate memang besar dan mengurangi expansion downstream.

---

## 25. `WITH` sebagai Performance Boundary

`WITH` bukan hanya syntax chaining. Ia adalah alat untuk:

- membatasi variable yang dibawa;
- melakukan aggregation;
- deduplicate;
- sorting/limit per stage;
- memecah query menjadi tahap;
- membuat query lebih terbaca;
- mengontrol cardinality downstream.

Contoh:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a:Account)
WITH collect(a) AS accounts
UNWIND accounts AS a
MATCH (a)-[:TRANSFERRED_TO]->(b:Account)
RETURN DISTINCT b
```

Tidak selalu lebih baik. `collect` bisa boros memory.

Contoh lebih baik:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a:Account)
WITH DISTINCT a
MATCH (a)-[:TRANSFERRED_TO]->(b:Account)
WITH DISTINCT b
RETURN b.accountNo AS accountNo
LIMIT 100
```

`WITH` harus dipakai dengan niat:

| Tujuan | Bentuk |
|---|---|
| buang variable tidak perlu | `WITH b` |
| deduplicate sebelum expansion | `WITH DISTINCT b` |
| aggregate per group | `WITH c, count(t) AS txCount` |
| limit candidate sebelum lanjut | `WITH x ORDER BY score DESC LIMIT 100` |
| isolate subquery | `CALL { ... }` |

---

## 26. Subquery untuk Membatasi Scope

`CALL { ... }` berguna untuk mengisolasi query part.

Contoh: cari top counterparties per account.

Naif:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a:Account)
MATCH (a)-[:TRANSFERRED_TO]->(b:Account)
RETURN a.accountNo, b.accountNo, count(*) AS txCount
ORDER BY txCount DESC
LIMIT 10
```

Ini memberi top 10 global, bukan top 10 per account.

Gunakan subquery:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a:Account)
CALL {
  WITH a
  MATCH (a)-[:TRANSFERRED_TO]->(b:Account)
  RETURN b.accountNo AS counterparty, count(*) AS txCount
  ORDER BY txCount DESC
  LIMIT 10
}
RETURN a.accountNo AS accountNo, counterparty, txCount
```

Manfaat:

- scope per `a`;
- `LIMIT` berlaku per account;
- query lebih semantik;
- cardinality lebih terkendali.

Tapi subquery juga bisa mahal jika dipanggil untuk terlalu banyak rows.

Rule:

> Subquery bagus untuk local computation per candidate, bukan untuk menyembunyikan fan-out besar.

---

## 27. Index Tidak Selalu Dipakai

Kamu sudah membuat index:

```cypher
CREATE INDEX account_status_idx
FOR (a:Account)
ON (a.status);
```

Tapi query:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a:Account)
WHERE a.status = 'ACTIVE'
RETURN a
```

Planner mungkin tidak memakai `account_status_idx`, dan itu bisa benar.

Jika customer punya 3 account, lebih murah:

```text
find customer by unique index -> expand 3 accounts -> filter status
```

daripada:

```text
find all ACTIVE accounts, maybe millions -> check which are owned by customer
```

Index dipakai kalau ia membantu access path.

Jangan menilai “index tidak dipakai” sebagai bug otomatis.

Pertanyaannya:

- predicate index menghasilkan berapa kandidat?
- traversal dari node lain menghasilkan berapa kandidat?
- mana yang lebih selective?
- apakah index mendukung query shape?
- apakah composite index lebih tepat?
- apakah query butuh full-text/vector index, bukan range index?
- apakah ada label di predicate?

---

## 28. Planner Hints: Last Resort

Neo4j mendukung planner/index hints dengan `USING`, misalnya:

```cypher
MATCH (a:Account {status: $status})
USING INDEX a:Account(status)
RETURN a
```

Hints bisa membantu ketika planner memilih buruk karena statistik/skew.

Tapi hints berbahaya:

- data distribution berubah;
- index berubah;
- query shape berubah;
- hint menjadi technical debt;
- future Neo4j version mungkin punya planner lebih baik;
- hint bisa memaksa plan buruk.

Gunakan hint hanya jika:

1. `PROFILE` membuktikan plan default buruk.
2. Data distribution dipahami.
3. Alternatif rewrite tidak cukup.
4. Ada test performance.
5. Ada komentar alasan.
6. Ada monitoring setelah deploy.

Dalam kode production, beri komentar:

```cypher
// USING INDEX intentionally used because default planner starts from Transaction,
// which is worse for tenant-scoped queries where tenantId is highly selective.
MATCH (a:Account {tenantId: $tenantId, accountNo: $accountNo})
USING INDEX a:Account(tenantId, accountNo)
RETURN a
```

---

## 29. Query Tuning Workflow

Jangan tuning dengan intuisi liar. Pakai workflow.

### Step 1 — Definisikan query contract

Tulis:

```text
Use case:
Find high-risk counterparties reachable from customer's accounts within 2 transfer hops.

Expected cardinality:
- 1 customer
- 1..10 accounts
- each account may have 0..500 transfers
- high-risk counterparties expected < 100

Latency target:
p95 < 200 ms

Result:
counterparty accountNo, riskLevel, shortest distance
```

Tanpa cardinality expectation, kamu tidak bisa tahu query lambat karena query buruk atau requirement memang mahal.

### Step 2 — Tulis Cypher paling jelas

```cypher
MATCH (c:Customer {customerId: $customerId})-[:OWNS]->(a:Account)
MATCH p = (a)-[:TRANSFERRED_TO*1..2]->(b:Account)
WHERE b.riskLevel IN ['HIGH', 'CRITICAL']
RETURN DISTINCT b.accountNo AS accountNo,
       b.riskLevel AS riskLevel,
       min(length(p)) AS distance
ORDER BY distance, accountNo
LIMIT 100
```

### Step 3 — `EXPLAIN`

Lihat:

- start dari `Customer(customerId)`?
- index seek?
- variable-length operator?
- estimated rows reasonable?
- cartesian product?
- eager?

### Step 4 — `PROFILE` di dataset realistis

Lihat:

- actual rows per operator;
- db hits;
- memory;
- page cache behavior;
- operator paling mahal.

### Step 5 — Identifikasi failure pattern

Misalnya:

```text
NodeUniqueIndexSeek(c) => 1 row
Expand OWNS => 8 rows
VarLengthExpand TRANSFERRED_TO*1..2 => 2,500,000 rows
Filter riskLevel => 40 rows
```

Masalah: risk filter terlambat dan transfer graph dense.

### Step 6 — Rewrite

Option A: target-driven:

```cypher
MATCH (c:Customer {customerId: $customerId})-[:OWNS]->(a:Account)
MATCH (b:Account)
WHERE b.riskLevel IN ['HIGH', 'CRITICAL']
MATCH p = (a)-[:TRANSFERRED_TO*1..2]->(b)
RETURN DISTINCT b.accountNo AS accountNo,
       b.riskLevel AS riskLevel,
       min(length(p)) AS distance
ORDER BY distance, accountNo
LIMIT 100
```

Bisa lebih baik jika high-risk accounts sedikit.

Option B: relationship type split:

```text
TRANSFERRED_TO
SUSPICIOUS_TRANSFERRED_TO
HIGH_VALUE_TRANSFERRED_TO
```

Lalu query:

```cypher
MATCH (c:Customer {customerId: $customerId})-[:OWNS]->(a:Account)
MATCH p = (a)-[:SUSPICIOUS_TRANSFERRED_TO*1..2]->(b:Account)
RETURN DISTINCT b.accountNo AS accountNo
LIMIT 100
```

Option C: materialized derived edge:

```text
(a)-[:REACHES_HIGH_RISK_WITHIN_2_HOPS {distance, computedAt}]->(b)
```

Untuk query frequently used.

### Step 7 — Validate correctness

Pastikan rewrite tidak mengubah meaning:

- Apakah semua path masih dipertimbangkan?
- Apakah shortest distance tetap benar?
- Apakah duplicate handling benar?
- Apakah direction sama?
- Apakah relationship type baru equivalent secara domain?
- Apakah derived edge freshness acceptable?

### Step 8 — Lock in test

Buat:

- query contract test;
- performance smoke test;
- golden dataset;
- max result size assertion;
- regression test untuk accidental cartesian product.

---

## 30. Common Plan Smells

### Smell 1 — `AllNodesScan`

Biasanya query terlalu generic.

Buruk:

```cypher
MATCH (n)
WHERE n.id = $id
RETURN n
```

Baik:

```cypher
MATCH (c:Customer {customerId: $id})
RETURN c
```

### Smell 2 — `NodeByLabelScan` pada label besar

```cypher
MATCH (t:Transaction)
WHERE t.transactionId = $id
RETURN t
```

Butuh index/constraint.

### Smell 3 — `CartesianProduct`

Pattern independent.

```cypher
MATCH (a:Account {status: 'ACTIVE'})
MATCH (c:Customer {country: 'ID'})
RETURN a, c
```

Harus dijustifikasi.

### Smell 4 — Rows meledak setelah expansion

```text
Expand(All) rows: 10 -> 5,000,000
```

Perlu filter, bound, relationship type, model change, atau precompute.

### Smell 5 — `Eager` besar

Mungkin read/write boundary atau aggregation blocking.

### Smell 6 — Sort besar

```text
Sort rows: 10,000,000
```

Butuh index/order strategy, precompute, atau reduce before sort.

### Smell 7 — `DISTINCT` setelah ledakan

Output rapi, kerja internal tetap besar.

### Smell 8 — `Optional Match` memperbesar null rows

`OPTIONAL MATCH` bisa menjaga row tetap hidup dan membuat downstream lebih rumit.

### Smell 9 — `collect()` list besar

Memory risk.

### Smell 10 — `LIMIT` terlalu atas

Jika `LIMIT` setelah sort/aggregation/path enumeration, ia tidak menyelamatkan kerja awal.

---

## 31. `OPTIONAL MATCH` Performance Trap

`OPTIONAL MATCH` seperti outer join dalam mental model: jika pattern tidak ditemukan, row tetap hidup dengan `null`.

Contoh:

```cypher
MATCH (c:Customer {customerId: $id})
OPTIONAL MATCH (c)-[:OWNS]->(a:Account)
OPTIONAL MATCH (a)-[:HAS_CARD]->(card:Card)
RETURN c, collect(a), collect(card)
```

Masalah:

- jika customer punya banyak accounts dan cards, duplicate combinations bisa muncul;
- jika `a` null, downstream perlu handle;
- collect bisa duplicate;
- cardinality sulit dibaca.

Lebih baik pisahkan:

```cypher
MATCH (c:Customer {customerId: $id})
CALL {
  WITH c
  OPTIONAL MATCH (c)-[:OWNS]->(a:Account)
  RETURN collect(DISTINCT {
    accountNo: a.accountNo,
    status: a.status
  }) AS accounts
}
CALL {
  WITH c
  OPTIONAL MATCH (c)-[:OWNS]->(:Account)-[:HAS_CARD]->(card:Card)
  RETURN collect(DISTINCT {
    cardNo: card.cardNo,
    status: card.status
  }) AS cards
}
RETURN c.customerId AS customerId, accounts, cards
```

Ini lebih panjang, tetapi scope lebih jelas.

Rule:

> `OPTIONAL MATCH` bagus untuk enrichment kecil. Untuk banyak optional branches, gunakan subquery agar cardinality tidak saling mengalikan.

---

## 32. Read Query vs Write Query Tuning

Read query tuning fokus:

- start point;
- expansion;
- projection;
- aggregation;
- sort;
- result size.

Write query tuning fokus tambahan:

- lock;
- write amplification;
- `MERGE` correctness;
- constraint;
- batch size;
- deadlock;
- retry;
- `Eager`;
- transaction size;
- transaction log;
- index update cost.

Contoh write query buruk:

```cypher
MATCH (c:Customer)
MATCH (r:RiskCategory {name: 'HIGH'})
WHERE c.riskScore >= 80
MERGE (c)-[:HAS_RISK_CATEGORY]->(r)
```

Jika jutaan customers, satu transaksi besar.

Lebih baik batch:

```cypher
MATCH (c:Customer)
WHERE c.riskScore >= 80
WITH c
LIMIT 10000
MATCH (r:RiskCategory {name: 'HIGH'})
MERGE (c)-[:HAS_RISK_CATEGORY]->(r)
RETURN count(*)
```

Namun perlu loop aplikasi atau `CALL { } IN TRANSACTIONS` untuk batch. Untuk production, harus ada idempotency dan resume strategy.

---

## 33. Performance dari Perspektif Java Service

Cypher query bisa cepat di database tetapi lambat di service karena:

- result terlalu besar;
- mapping object terlalu berat;
- session/driver salah lifecycle;
- connection pool exhausted;
- transaction terlalu lama;
- reactive stream tidak dikonsumsi benar;
- retry menggandakan beban;
- logging query/result berlebihan;
- serialization JSON graph besar;
- API mengembalikan nested graph tanpa limit.

Prinsip Java integration:

1. Driver dibuat singleton per app.
2. Session/transaction scoped pendek.
3. Selalu pakai parameter.
4. Return DTO projection, bukan raw graph besar.
5. Gunakan transaction function untuk retryable read/write.
6. Set timeout untuk query kritikal.
7. Monitor pool.
8. Jangan block reactive pipeline sembarangan.
9. Jangan jalankan query N+1 dari loop Java jika bisa satu query.
10. Jangan satu query “mega graph” jika payload tak terkendali.

Buruk:

```java
for (String id : customerIds) {
    tx.run("MATCH (c:Customer {customerId: $id})-[:OWNS]->(a) RETURN a", Map.of("id", id));
}
```

Lebih baik:

```cypher
UNWIND $customerIds AS customerId
MATCH (c:Customer {customerId: customerId})-[:OWNS]->(a:Account)
RETURN customerId, collect(a.accountNo) AS accounts
```

Tapi jika `customerIds` besar, batch dari Java.

---

## 34. Query Timeout dan Guardrail

Production graph query butuh guardrail.

Guardrail yang sehat:

- query timeout;
- max result size;
- API pagination;
- traversal depth limit;
- allowed relationship types;
- tenant boundary wajib;
- query allowlist;
- query metrics per endpoint;
- rejection untuk unbounded exploration;
- rate limit untuk expensive query;
- staging/profiling before deploy.

Contoh endpoint berbahaya:

```http
GET /graph/explore?startNode=123&depth=10
```

Lebih defensible:

```http
GET /customers/{id}/risk-neighborhood?depth=2&limit=200
```

Dengan server-side constraints:

```text
max depth: 3
max result nodes: 500
allowed relationship types:
- OWNS
- CONTROLS
- SIGNATORY_OF
- TRANSFERRED_TO
- RELATED_TO_CASE
tenant boundary required
```

Graph exploration tanpa guardrail adalah production incident waiting to happen.

---

## 35. Performance Checklist sebelum Query Masuk Production

Gunakan checklist berikut.

### 35.1 Semantics

- [ ] Query menjawab pertanyaan bisnis yang jelas.
- [ ] Direction relationship benar.
- [ ] Relationship type spesifik.
- [ ] Path length bounded.
- [ ] Duplicate handling eksplisit.
- [ ] `OPTIONAL MATCH` tidak mengubah meaning.
- [ ] `DISTINCT` tidak menyembunyikan bug modelling.
- [ ] Result contract jelas.

### 35.2 Cardinality

- [ ] Start node selective.
- [ ] Estimated cardinality masuk akal.
- [ ] Actual cardinality sudah diprofile.
- [ ] Tidak ada fan-out tak terkontrol.
- [ ] Intermediate rows tidak jauh lebih besar dari yang wajar.
- [ ] Supernode scenario dipertimbangkan.
- [ ] Worst-case tenant/customer/account diuji.

### 35.3 Plan

- [ ] Menggunakan index/constraint jika identity lookup.
- [ ] Tidak ada `AllNodesScan` tanpa alasan.
- [ ] Tidak ada `CartesianProduct` tanpa alasan.
- [ ] Tidak ada `Eager` besar tanpa alasan.
- [ ] Sort/aggregation terjadi setelah data direduksi.
- [ ] `LIMIT` berada sedini mungkin secara semantik.
- [ ] Variable tidak perlu tidak dibawa lama.

### 35.4 Java/API

- [ ] Query parameterized.
- [ ] DTO projection, bukan raw graph besar.
- [ ] Session/transaction lifecycle benar.
- [ ] Timeout dikonfigurasi.
- [ ] Retry policy sesuai.
- [ ] Result size bounded.
- [ ] Endpoint punya guardrail.
- [ ] Metrics per query/endpoint tersedia.

### 35.5 Operations

- [ ] Slow query logging aktif.
- [ ] Query bisa diidentifikasi dari logs.
- [ ] Dashboard punya p50/p95/p99 latency.
- [ ] DB hits/page cache/memory dipantau.
- [ ] Dataset realistis dipakai untuk benchmark.
- [ ] Regression test untuk query critical.
- [ ] Ada fallback jika query mahal.

---

## 36. Worked Example: Related Case Discovery

### 36.1 Requirement

> Untuk sebuah enforcement case, cari case lain yang terkait melalui subject, account, organization, address, phone, atau evidence source dalam radius 2 hop. Return top 50 related cases dengan alasan keterkaitan.

### 36.2 Model Ringkas

```text
(:Case {caseId})
(:Person {personId})
(:Organization {orgId})
(:Account {accountNo})
(:Address {normalized})
(:Phone {e164})
(:Evidence {evidenceId})

(:Case)-[:HAS_SUBJECT]->(:Person)
(:Case)-[:HAS_SUBJECT]->(:Organization)
(:Person)-[:OWNS]->(:Account)
(:Organization)-[:OWNS]->(:Account)
(:Person)-[:USES_ADDRESS]->(:Address)
(:Organization)-[:REGISTERED_AT]->(:Address)
(:Person)-[:USES_PHONE]->(:Phone)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Evidence)-[:FROM_SOURCE]->(:Organization)
```

### 36.3 Query Naif

```cypher
MATCH p = (c:Case {caseId: $caseId})-[*1..4]-(other:Case)
WHERE other.caseId <> $caseId
RETURN other.caseId AS caseId, count(p) AS paths
ORDER BY paths DESC
LIMIT 50
```

Masalah:

- relationship type tidak dibatasi;
- direction tidak jelas;
- depth 4 terlalu luas;
- return semua path;
- `count(p)` menghitung semua path, bukan necessarily meaningful;
- bisa melewati node generic seperti Address/Phone supernode;
- tidak ada tenant/status boundary;
- path explosion.

### 36.4 Query Lebih Defensible

```cypher
MATCH (c:Case {caseId: $caseId})
CALL {
  WITH c
  MATCH (c)-[:HAS_SUBJECT]->(s)
  MATCH (other:Case)-[:HAS_SUBJECT]->(s)
  WHERE other <> c
  RETURN other, 'same subject' AS reason, 100 AS score

  UNION ALL

  WITH c
  MATCH (c)-[:HAS_SUBJECT]->(s)-[:OWNS]->(a:Account)<-[:OWNS]-(s2)<-[:HAS_SUBJECT]-(other:Case)
  WHERE other <> c
  RETURN other, 'shared account network' AS reason, 80 AS score

  UNION ALL

  WITH c
  MATCH (c)-[:HAS_SUBJECT]->(s)-[:USES_PHONE]->(p:Phone)<-[:USES_PHONE]-(s2)<-[:HAS_SUBJECT]-(other:Case)
  WHERE other <> c
  RETURN other, 'shared phone' AS reason, 70 AS score

  UNION ALL

  WITH c
  MATCH (c)-[:HAS_SUBJECT]->(s)-[:USES_ADDRESS|REGISTERED_AT]->(addr:Address)<-[:USES_ADDRESS|REGISTERED_AT]-(s2)<-[:HAS_SUBJECT]-(other:Case)
  WHERE other <> c
  RETURN other, 'shared address' AS reason, 60 AS score
}
WITH other, collect(DISTINCT reason) AS reasons, max(score) AS maxScore
RETURN other.caseId AS caseId,
       other.status AS status,
       reasons,
       maxScore
ORDER BY maxScore DESC, caseId
LIMIT 50
```

Kelebihan:

- tiap branch punya semantic reason;
- relationship type eksplisit;
- tidak mencari arbitrary path;
- scoring bisa dijelaskan;
- cardinality per branch lebih mudah diprofile;
- bisa tune branch satu per satu;
- output defensible.

Kelemahan:

- lebih panjang;
- perlu maintain scoring;
- perlu test per branch;
- shared phone/address bisa supernode;
- `UNION ALL` branch bisa tetap mahal.

### 36.5 Tuning Lanjutan

Tambahkan guard untuk supernode phone/address:

```cypher
MATCH (p:Phone)<-[:USES_PHONE]-(s2)
WITH p, count(s2) AS usage
WHERE usage <= 20
```

Atau materialize property:

```text
(:Phone {e164, subjectCount})
```

Lalu:

```cypher
MATCH (c)-[:HAS_SUBJECT]->(s)-[:USES_PHONE]->(p:Phone)
WHERE p.subjectCount <= 20
MATCH (p)<-[:USES_PHONE]-(s2)<-[:HAS_SUBJECT]-(other:Case)
...
```

Ini trade-off: write/update complexity naik, query lebih aman.

---

## 37. Worked Example: Access Path Query

### 37.1 Requirement

> Jelaskan mengapa user U punya akses ke resource R.

### 37.2 Model

```text
(:User)-[:MEMBER_OF]->(:Group)
(:Group)-[:MEMBER_OF]->(:Group)
(:User)-[:ASSIGNED_ROLE]->(:Role)
(:Group)-[:ASSIGNED_ROLE]->(:Role)
(:Role)-[:GRANTS]->(:Permission)
(:Permission)-[:APPLIES_TO]->(:Resource)
```

### 37.3 Query

```cypher
MATCH (u:User {userId: $userId})
MATCH (r:Resource {resourceId: $resourceId})
MATCH p =
  (u)-[:MEMBER_OF|ASSIGNED_ROLE|GRANTS|APPLIES_TO*1..6]->(r)
RETURN p
LIMIT 10
```

Masalah:

- relationship sequence tidak dikontrol;
- path bisa invalid secara policy;
- depth 6 arbitrary;
- role/permission traversal bisa melewati pola yang tidak semestinya.

Lebih baik pisahkan semantic path:

```cypher
MATCH (u:User {userId: $userId})
MATCH (res:Resource {resourceId: $resourceId})

CALL {
  WITH u, res
  MATCH p = (u)-[:ASSIGNED_ROLE]->(:Role)-[:GRANTS]->(:Permission)-[:APPLIES_TO]->(res)
  RETURN p, 'direct role' AS reason

  UNION ALL

  WITH u, res
  MATCH p = (u)-[:MEMBER_OF*1..3]->(:Group)-[:ASSIGNED_ROLE]->(:Role)-[:GRANTS]->(:Permission)-[:APPLIES_TO]->(res)
  RETURN p, 'group inherited role' AS reason
}
RETURN reason, p
LIMIT 10
```

Kelebihan:

- path valid by construction;
- group nesting depth bounded;
- reason defensible;
- easier to tune;
- avoids arbitrary path.

Production improvement:

- group nesting max depth enforced by policy;
- detect group cycle;
- precompute effective entitlements if query frequent;
- return explanation projection instead of raw path for API.

---

## 38. Performance Budgeting

Graph query harus punya budget.

Contoh budget:

```text
Endpoint:
GET /cases/{caseId}/related-cases

p95 latency:
300 ms

Max returned cases:
50

Max traversal:
semantic branches only, no arbitrary path

Worst-case case:
case with 20 subjects, each with 10 accounts, 5 phones, 5 addresses

Allowed DB hits:
baseline from staging profile + 30%

Fallback:
return partial branches with warning if timeout
```

Tanpa budget, query tuning menjadi subjektif.

Budget juga membantu modelling:

- Jika budget tidak bisa dipenuhi dengan live traversal, precompute.
- Jika precompute terlalu sulit, ubah requirement.
- Jika requirement butuh full graph scan, gunakan analytical pipeline.
- Jika query butuh text relevance, pakai search integration.
- Jika query butuh time-series ordering, pakai store yang cocok atau denormalized access path.

---

## 39. Kapan Tuning Query Tidak Cukup?

Kadang query lambat bukan karena Cypher buruk, tapi karena architecture mismatch.

Tanda:

1. Query butuh scan mayoritas graph.
2. Query butuh aggregate global.
3. Query butuh latest events ordered by time across huge dataset.
4. Query butuh full-text ranking kompleks.
5. Query butuh vector similarity besar.
6. Query butuh multi-hop traversal di graph dense tanpa semantic bound.
7. Query butuh ad-hoc analyst exploration dengan arbitrary depth.
8. Query dipanggil high-QPS tetapi hasil berubah jarang.
9. Query harus join Neo4j dengan data eksternal besar secara online.
10. Query harus menjawab “top N globally” real-time di graph besar.

Solusi bukan selalu rewrite. Bisa:

- materialized relationship;
- projection table;
- cache;
- search index;
- OLAP pipeline;
- GDS offline computation;
- graph refactoring;
- denormalized property;
- precomputed score;
- domain constraint;
- API requirement change.

Top 1% engineer tidak hanya menulis query lebih pintar. Ia tahu kapan query tidak seharusnya live.

---

## 40. Performance Decision Matrix

| Problem | First attempt | If still slow | Last resort |
|---|---|---|---|
| identity lookup lambat | constraint/index | fix label/property | model identity ulang |
| traversal fan-out | bound depth/type/direction | filter earlier | derived edge/precompute |
| supernode | relationship partition | grouping/time bucket | model refactor |
| duplicate paths | `WITH DISTINCT` before expansion | uniqueness strategy | graph projection/GDS |
| sort besar | reduce before sort | index/order access | precompute top-N |
| aggregation besar | scope smaller | materialized count | OLAP pipeline |
| optional branches multiply | subqueries | separate endpoint | read model |
| shortest path many pairs | specific endpoints | GDS batch | precompute distances |
| API payload besar | projection DTO | pagination | separate graph exploration product |
| planner chooses wrong index | rewrite | update stats/hint | schema/model change |

---

## 41. Practical Cypher Rewrite Patterns

### 41.1 Add Label to Anonymous Node

Before:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a)
RETURN a
```

After:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a:Account)
RETURN a
```

### 41.2 Add Direction

Before:

```cypher
MATCH (a:Account)-[:TRANSFERRED_TO]-(b:Account)
RETURN b
```

After:

```cypher
MATCH (a:Account)-[:TRANSFERRED_TO]->(b:Account)
RETURN b
```

### 41.3 Split Broad Query into Semantic Branches

Before:

```cypher
MATCH p = (c:Case {caseId: $id})-[*1..4]-(other:Case)
RETURN other
```

After:

```cypher
MATCH (c:Case {caseId: $id})
CALL {
  WITH c
  MATCH (c)-[:HAS_SUBJECT]->(s)<-[:HAS_SUBJECT]-(other:Case)
  RETURN other, 'same subject' AS reason
  UNION ALL
  WITH c
  MATCH (c)-[:SUPPORTED_BY]->(:Evidence)-[:FROM_SOURCE]->(src)<-[:FROM_SOURCE]-(:Evidence)<-[:SUPPORTED_BY]-(other:Case)
  RETURN other, 'same evidence source' AS reason
}
RETURN DISTINCT other.caseId, collect(reason)
```

### 41.4 Deduplicate Before Next Expansion

Before:

```cypher
MATCH (:Customer {customerId: $id})-[:OWNS]->(:Account)-[:TRANSFERRED_TO]->(b:Account)
MATCH (b)<-[:OWNS]-(other:Customer)
RETURN DISTINCT other
```

After:

```cypher
MATCH (:Customer {customerId: $id})-[:OWNS]->(:Account)-[:TRANSFERRED_TO]->(b:Account)
WITH DISTINCT b
MATCH (b)<-[:OWNS]-(other:Customer)
RETURN DISTINCT other
```

### 41.5 Project Only Needed Fields

Before:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a:Account)
RETURN c, a
```

After:

```cypher
MATCH (c:Customer {customerId: $id})-[:OWNS]->(a:Account)
RETURN c.customerId AS customerId,
       a.accountNo AS accountNo,
       a.status AS status
```

### 41.6 Replace Arbitrary Path with Valid Policy Path

Before:

```cypher
MATCH p = (:User {userId: $uid})-[*1..6]->(:Resource {resourceId: $rid})
RETURN p
```

After:

```cypher
MATCH (u:User {userId: $uid})
MATCH (r:Resource {resourceId: $rid})
MATCH p = (u)-[:MEMBER_OF*0..3]->(:Group)-[:ASSIGNED_ROLE]->(:Role)-[:GRANTS]->(:Permission)-[:APPLIES_TO]->(r)
RETURN p
LIMIT 5
```

---

## 42. Mini Lab: Cara Melatih Mata Membaca Plan

Gunakan dataset kecil tetapi sengaja buat skew.

### 42.1 Schema

```cypher
CREATE CONSTRAINT customer_id_unique
FOR (c:Customer)
REQUIRE c.customerId IS UNIQUE;

CREATE CONSTRAINT account_no_unique
FOR (a:Account)
REQUIRE a.accountNo IS UNIQUE;

CREATE INDEX account_risk_idx
FOR (a:Account)
ON (a.riskLevel);
```

### 42.2 Query 1

```cypher
EXPLAIN
MATCH (c:Customer {customerId: $customerId})-[:OWNS]->(a:Account)
RETURN a;
```

Cari:

- `NodeUniqueIndexSeek`
- `Expand(All)`
- rows kecil

### 42.3 Query 2

```cypher
EXPLAIN
MATCH (a:Account {riskLevel: 'HIGH'})
RETURN a;
```

Cari:

- apakah memakai index?
- estimated rows berapa?
- apakah riskLevel selective?

### 42.4 Query 3

```cypher
EXPLAIN
MATCH (c:Customer {customerId: $customerId})-[:OWNS]->(a:Account)
MATCH (b:Account {riskLevel: 'HIGH'})
MATCH p = (a)-[:TRANSFERRED_TO*1..3]->(b)
RETURN b, p;
```

Cari:

- apakah ada many target high-risk accounts?
- apakah shortest/path operator mahal?
- apakah better source-driven?

### 42.5 Query 4

```cypher
EXPLAIN
MATCH (c:Customer {country: 'ID'})
MATCH (a:Account {status: 'ACTIVE'})
RETURN c, a
LIMIT 10;
```

Cari:

- `CartesianProduct`
- apakah `LIMIT` menyelamatkan?
- apakah query semantically meaningful?

### 42.6 Query 5

```cypher
PROFILE
MATCH (c:Customer {customerId: $customerId})-[:OWNS]->(:Account)-[:TRANSFERRED_TO*1..3]->(b:Account)
RETURN DISTINCT b
LIMIT 100;
```

Cari:

- rows sebelum distinct;
- db hits di variable-length expansion;
- apakah `LIMIT` terlambat.

---

## 43. Observability untuk Query Performance

Query tuning tidak selesai di laptop.

Production harus menjawab:

- query mana paling lambat?
- endpoint mana memanggil query itu?
- parameter cardinality apa yang membuatnya lambat?
- tenant/customer/case mana worst-case?
- apakah page cache miss naik?
- apakah query plan berubah setelah data tumbuh?
- apakah p99 memburuk walau p50 baik?
- apakah retry meningkat?
- apakah connection pool penuh?
- apakah memory operator naik?
- apakah slow query muncul setelah release?

Praktik baik:

1. Beri nama repository method sesuai use case.
2. Log query hash/nama query, bukan data sensitif.
3. Record latency per query.
4. Record result count.
5. Record input size.
6. Record timeout/error.
7. Correlate dengan endpoint.
8. Simpan `EXPLAIN` plan untuk query critical saat release.
9. Jalankan performance regression di dataset staging.
10. Review slow queries secara berkala.

Di Java, hindari log full parameter jika sensitif:

```text
queryName=FindRelatedCases
caseIdHash=...
depth=2
limit=50
durationMs=184
resultCount=47
```

---

## 44. How to Think Like a Top 1% Graph Query Engineer

Graph query engineer yang kuat tidak bertanya:

> “Bagaimana caranya query ini jalan?”

Ia bertanya:

1. Apa pertanyaan domain sebenarnya?
2. Apakah query ini butuh path, existence, score, atau explanation?
3. Apa start point paling selective?
4. Apa path yang valid secara domain?
5. Apa relationship yang boleh dilewati?
6. Berapa fan-out worst-case?
7. Apakah ada supernode?
8. Apakah result harus real-time?
9. Apakah semua path diperlukan?
10. Apakah query ini harus live atau precomputed?
11. Apakah API memberi guardrail?
12. Apakah query bisa dijelaskan ke auditor/domain expert?
13. Apakah query tetap aman saat data 10x?
14. Apakah query punya regression test?
15. Apakah operasi bisa melihat saat query memburuk?

Top engineer tidak hanya optimize syntax. Ia mengubah requirement, model, index, pipeline, dan API contract sampai performa dan correctness masuk akal.

---

## 45. Ringkasan Bagian Ini

Inti Part 011:

1. Cypher performance adalah kombinasi pipeline rows dan graph expansion.
2. `EXPLAIN` melihat rencana tanpa menjalankan; `PROFILE` menjalankan dan memberi angka aktual.
3. Execution plan harus dibaca dari start operator, cardinality, expansion, blocking operator, dan result.
4. Cardinality intermediate lebih penting daripada final result size.
5. Start point paling selective sering menentukan performa.
6. Index membantu lookup, tetapi tidak otomatis membuat traversal murah.
7. Relationship direction dan type sangat penting.
8. Cartesian product harus selalu dijustifikasi.
9. Filter harus ditempatkan sedini mungkin secara semantik.
10. `LIMIT`, `DISTINCT`, dan `collect()` bukan obat gratis.
11. Variable-length traversal harus bounded dan semantic.
12. `WITH` dan subquery adalah alat untuk mengontrol scope/cardinality.
13. Query tuning harus berbasis `PROFILE`, bukan feeling.
14. Jika query tetap mahal, mungkin perlu model refactor, precompute, GDS, search/OLAP integration, atau requirement change.
15. Production graph API harus punya guardrail.

---

## 46. Checklist Cepat Saat Melihat Query Cypher

Gunakan pertanyaan ini dalam code review:

```text
1. Query mulai dari mana?
2. Apakah start node selective?
3. Apakah label dan relationship type eksplisit?
4. Apakah direction eksplisit?
5. Apakah path length bounded?
6. Apakah query mengembalikan data minimum?
7. Apakah ada cartesian product?
8. Apakah ada optional branch yang mengalikan rows?
9. Apakah DISTINCT dipakai untuk menyembunyikan ledakan?
10. Apakah LIMIT datang terlalu terlambat?
11. Apakah collect punya upper bound?
12. Apakah query sudah EXPLAIN/PROFILE di data realistis?
13. Apakah worst-case entity diuji?
14. Apakah API punya guardrail?
15. Apakah query ini seharusnya live atau precomputed?
```

---

## 47. Bridge ke Part Berikutnya

Part berikutnya membahas salah satu sumber performa buruk paling khas di graph database:

```text
Part 012 — Supernodes, Dense Graphs, and Traversal Explosion
```

Kita akan membahas:

- apa itu supernode;
- mengapa high-degree node menghancurkan traversal;
- fan-out math;
- dense node modelling failure;
- relationship partitioning;
- grouping node;
- time bucket;
- derived edge;
- precomputed view;
- deteksi operasional;
- refactoring model yang sudah terlanjur bermasalah.

Jika Part 011 adalah cara membaca query performance, Part 012 adalah cara mencegah salah satu penyebab utamanya sejak modelling.

---

## 48. Status Seri

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

Seri belum selesai.
Masih ada Part 012 sampai Part 032.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — Write Modelling: `MERGE`, Idempotency, Upserts, and Concurrency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-012.md">Part 012 — Supernodes, Dense Graphs, and Traversal Explosion ➡️</a>
</div>
