# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-003.md

# Part 003 — Neo4j Architecture: Storage, Query Engine, and Runtime Mental Model

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami graph database dan Neo4j pada level arsitektur, modelling, query execution, dan production reasoning.  
> Fokus part ini: membangun mental model internal Neo4j agar setiap keputusan modelling dan query tuning punya dasar yang kuat.

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 000 sampai Part 002, kita membangun fondasi konseptual:

- mengapa graph database ada,
- apa bedanya berpikir dengan relationship dibanding record,
- bagaimana property graph terdiri dari node, relationship, label, relationship type, dan property,
- kapan sesuatu sebaiknya menjadi node, relationship, property, atau relationship yang direifikasi menjadi node.

Part ini masuk ke lapisan berikutnya: **apa yang kira-kira terjadi di dalam Neo4j ketika graph model itu disimpan dan di-query**.

Tujuannya bukan menjadikan kamu implementor storage engine Neo4j, tetapi membuat kamu bisa menjawab pertanyaan engineering seperti:

- Mengapa query graph tertentu cepat, sedangkan query lain meledak?
- Mengapa traversal tidak sama dengan relational join?
- Mengapa page cache sangat penting?
- Mengapa query dengan `MATCH (n)` bisa menjadi bencana?
- Mengapa arah relationship memengaruhi cara berpikir meskipun Cypher bisa query dua arah?
- Mengapa supernode berbahaya?
- Mengapa `PROFILE` lebih penting daripada intuisi?
- Mengapa Java application harus menggunakan transaction boundary dan driver lifecycle dengan benar?
- Mengapa clustering Neo4j bukan sekadar “tambahkan node supaya write lebih cepat”?

Mental model utama part ini:

```text
Neo4j query performance = controlled graph expansion + good starting point + bounded traversal + hot data in page cache + sane cardinality.
```

Atau lebih pendek:

```text
Graph query is not magic.
Graph query is controlled expansion.
```

---

## 1. Neo4j Sebagai Native Graph Database

Neo4j sering disebut native graph database karena data disimpan dan dieksekusi dengan graph sebagai model utama, bukan sebagai lapisan abstraksi tipis di atas tabel relasional biasa.

Dalam property graph Neo4j:

- node menyimpan entity atau konsep,
- relationship menyimpan koneksi terarah antar node,
- node dapat memiliki label,
- relationship memiliki type,
- node dan relationship dapat memiliki property,
- path adalah urutan node dan relationship yang terbentuk saat traversal.

Yang penting bukan hanya bentuk data di level API, tetapi juga konsekuensi arsitekturalnya.

Pada relational database, relationship antar entity biasanya muncul sebagai foreign key dan join. Saat query butuh menavigasi beberapa hop, engine perlu melakukan kombinasi lookup, join, filtering, dan join planning.

Pada graph database, relationship adalah warga kelas satu. Query seperti:

```cypher
MATCH (a:Account {id: $accountId})-[:TRANSFERRED_TO*1..4]->(b:Account)
RETURN b
```

secara mental bukan “join Account ke Transfer lalu join lagi empat kali”, tetapi:

```text
Mulai dari account tertentu.
Ikuti relationship TRANSFERRED_TO keluar.
Ulangi sampai depth 4.
Kembalikan node yang tercapai.
```

Perbedaannya bukan sekadar sintaks. Perbedaannya adalah bentuk kerja mesin.

Namun ini sering disalahpahami.

Neo4j tidak otomatis membuat semua query relationship menjadi cepat. Neo4j menjadi kuat ketika:

1. starting point query spesifik,
2. relationship yang diikuti jelas,
3. depth traversal dibatasi,
4. filter ditempatkan pada titik yang tepat,
5. graph tidak memiliki fan-out tak terkendali,
6. data yang sering diakses cukup banyak berada di page cache,
7. query planner mendapat statistik/index/constraint yang cukup.

Jika salah satu syarat ini hilang, graph query bisa lebih buruk daripada query SQL biasa.

---

## 2. Mental Model Arsitektur Neo4j

Secara sederhana, bayangkan Neo4j sebagai beberapa lapisan:

```text
┌──────────────────────────────────────────────────────┐
│ Application Layer                                     │
│ Java service, Spring Boot, batch job, API, worker      │
└──────────────────────────────────────────────────────┘
                         │
                         │ Bolt / JDBC / embedded API
                         ▼
┌──────────────────────────────────────────────────────┐
│ Connection + Transaction Layer                        │
│ sessions, transaction functions, routing, retries      │
└──────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│ Cypher Layer                                          │
│ parse → semantic check → plan → execute               │
└──────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│ Execution Runtime                                     │
│ operators, rows, expansions, joins, aggregation        │
└──────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│ Storage + Index Layer                                 │
│ nodes, relationships, properties, indexes              │
└──────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│ Memory + Disk Layer                                   │
│ heap, page cache, transaction memory, tx logs, files   │
└──────────────────────────────────────────────────────┘
```

Setiap query melewati beberapa keputusan:

1. Bagaimana aplikasi mengirim query?
2. Apakah query read atau write?
3. Transaction boundary-nya apa?
4. Database mana yang ditargetkan?
5. Apakah query bisa memakai index?
6. Dari node mana traversal dimulai?
7. Relationship type dan direction mana yang diekspansi?
8. Berapa banyak row intermediate yang muncul?
9. Apakah operator tertentu memaksa materialisasi memori?
10. Apakah data berada di page cache atau harus dibaca dari disk?

Masalah performa biasanya bukan berasal dari satu hal. Ia muncul dari kombinasi:

```text
bad model + broad starting point + unbounded traversal + poor cardinality + cold page cache + too much result materialization
```

---

## 3. DBMS, Database, dan Graph di Neo4j

Dalam Neo4j modern, penting membedakan:

| Istilah | Arti Praktis |
|---|---|
| DBMS | Instance/sistem Neo4j yang menjalankan database, security, config, transaction, cluster role, dan proses server. |
| Database | Unit penyimpanan dan query logical di dalam DBMS. |
| Graph | Data model yang terdiri dari node dan relationship dalam database. |
| System database | Database internal untuk metadata DBMS, user, role, dan konfigurasi tertentu. |
| Default database | Database yang dipakai jika client tidak menyebut nama database. |

Sebagai Java engineer, ini penting karena driver modern biasanya meminta kamu memilih database secara eksplisit atau implisit. Kesalahan umum:

```text
Aplikasi tidak menyebut database name.
Di local jalan karena default database benar.
Di staging/production salah database atau routing tidak optimal.
```

Prinsip production:

```text
Always make database selection explicit in application configuration.
```

---

## 4. Storage Mental Model: Node, Relationship, Property

Neo4j menyimpan graph dalam struktur storage internal yang dioptimalkan untuk graph operations. Kamu tidak perlu menghafal layout byte-level, tetapi perlu memahami bentuk konseptualnya.

Bayangkan setiap node record memiliki informasi seperti:

```text
NodeRecord
- internal id
- label metadata
- pointer/reference ke properties
- pointer/reference ke relationship chain
```

Relationship record secara konseptual mengandung:

```text
RelationshipRecord
- internal id
- start node id
- end node id
- relationship type
- pointer/reference ke properties
- link ke relationship berikut/sebelumnya pada node terkait
```

Property record mengandung key-value data:

```text
PropertyRecord
- property key id
- value atau reference ke value
- link ke property berikutnya
```

Lagi-lagi, detail fisiknya bisa berubah antar versi/engine. Yang perlu kamu bawa adalah mental model:

```text
Node menemukan relationship-nya melalui adjacency.
Relationship tahu node awal dan node akhir.
Traversal mengikuti link graph, bukan membangun ulang relationship dari join key setiap saat.
```

Ini menjelaskan mengapa query seperti berikut bisa sangat natural:

```cypher
MATCH (p:Person {id: $id})-[:OWNS]->(:Company)-[:OWNS]->(asset:Asset)
RETURN asset
```

Jika `Person(id)` bisa ditemukan cepat lewat index/constraint, langkah berikutnya adalah mengikuti relationship keluar dari node tersebut.

Tetapi jika query dimulai seperti ini:

```cypher
MATCH (p:Person)-[:OWNS]->(:Company)-[:OWNS]->(asset:Asset)
RETURN asset
```

maka engine harus mempertimbangkan banyak `Person` sebagai starting point. Bahkan traversal yang secara lokal cepat bisa menjadi mahal jika starting point terlalu luas.

---

## 5. Internal ID vs Business ID

Neo4j memiliki internal ID untuk node dan relationship. Sebagai engineer, kamu tidak boleh menjadikan internal ID sebagai identity bisnis jangka panjang.

Kenapa?

Karena internal ID adalah detail database. Ia cocok untuk referensi internal selama query berjalan, tetapi bukan kontrak domain.

Gunakan property domain seperti:

```cypher
(:Person {personId: 'P-1001'})
(:Case {caseId: 'CASE-2026-0001'})
(:Account {accountId: 'ACC-7788'})
```

dan enforce dengan constraint:

```cypher
CREATE CONSTRAINT person_id_unique IF NOT EXISTS
FOR (p:Person)
REQUIRE p.personId IS UNIQUE;
```

Mental model:

```text
Internal ID = locator internal.
Business ID = identity domain.
External ID = identity dari source system.
Constraint = penjaga agar identity tidak rusak.
```

Kesalahan umum:

```text
Menyimpan Neo4j internal node id di service lain.
Kemudian data di-export/import, backup/restore, atau dimigrasi.
Mapping rusak.
```

Prinsip:

```text
Never expose Neo4j internal IDs as durable API identity.
```

---

## 6. Adjacency: Mengapa Traversal Berbeda dari Join

Pada relational database, hubungan antar row biasanya direpresentasikan dengan foreign key:

```text
orders.customer_id → customers.id
```

Untuk mendapatkan customer dari order, engine melakukan lookup/join berdasarkan value.

Pada graph database, relationship adalah object eksplisit:

```text
(order)-[:PLACED_BY]->(customer)
```

Saat traversal dari `order` ke `customer`, engine mengikuti relationship yang sudah ada.

Secara mental:

```text
Relational join:
Find rows whose values match.

Graph traversal:
Start from this node and follow these connected relationship records.
```

Ini membuat graph sangat cocok untuk pertanyaan seperti:

```text
Siapa saja yang terhubung ke subject ini dalam 3 hop melalui ownership, control, dan shared address?
```

atau:

```text
Case mana saja yang punya evidence, party, officer, atau legal basis yang overlap?
```

Tetapi traversal tetap punya biaya.

Jika satu node memiliki 5 relationship keluar, depth 4 kira-kira bisa memunculkan:

```text
5^4 = 625 kemungkinan jalur
```

Jika satu node memiliki 1.000 relationship keluar:

```text
1000^4 = 1.000.000.000.000 kemungkinan jalur teoretis
```

Tentu query engine melakukan pruning/filtering, tetapi fan-out tetap musuh utama traversal.

Mental model:

```text
Traversal is cheap when expansion is selective.
Traversal is dangerous when expansion is uncontrolled.
```

---

## 7. Relationship Direction di Storage dan Query

Neo4j relationship memiliki arah:

```cypher
(a)-[:OWNS]->(b)
```

Arah ini adalah bagian dari semantics dan storage/query model.

Namun Cypher bisa query dengan arah eksplisit atau tidak eksplisit:

```cypher
MATCH (a)-[:OWNS]->(b)   // outgoing
MATCH (a)<-[:OWNS]-(b)   // incoming
MATCH (a)-[:OWNS]-(b)    // either direction
```

Hal penting:

- Arah relationship harus dipilih berdasarkan makna domain.
- Query sebaiknya memakai arah jika arah bisnis diketahui.
- Query dua arah lebih luas dan bisa lebih mahal.
- Relationship direction bukan sekadar estetika diagram.

Contoh domain:

```cypher
(:Person)-[:OWNS]->(:Company)
(:Officer)-[:REVIEWED]->(:Case)
(:Evidence)-[:SUPPORTS]->(:Allegation)
(:Case)-[:ESCALATED_TO]->(:Unit)
```

Pilih arah yang membuat kalimat domain natural.

Buruk:

```cypher
(:Company)-[:OWNED_BY]->(:Person)
```

Tidak selalu salah, tetapi jika sebagian model memakai `OWNS` dan sebagian memakai `OWNED_BY`, query dan reasoning menjadi kacau.

Prinsip:

```text
Relationship direction should encode the dominant domain sentence.
Query direction should encode the intended traversal.
```

---

## 8. Label dan Relationship Type Sebagai Selectivity Signal

Label dan relationship type bukan hanya metadata untuk dibaca manusia. Mereka juga membantu query planner dan execution.

Contoh:

```cypher
MATCH (p:Person {personId: $id})-[:OWNS]->(c:Company)
RETURN c
```

Query ini memberi banyak informasi:

- starting node harus label `Person`,
- property `personId` digunakan untuk lookup,
- relationship type hanya `OWNS`,
- target node diharapkan `Company`.

Bandingkan dengan:

```cypher
MATCH (p {personId: $id})-->(x)
RETURN x
```

Query kedua jauh lebih ambigu:

- node apa pun yang punya `personId`,
- relationship type apa pun,
- target node apa pun.

Kadang query generik diperlukan untuk tooling/exploration, tetapi jangan jadikan default untuk workload production.

Prinsip:

```text
The more precise your pattern, the more control you give the planner and runtime.
```

---

## 9. Page Cache: Memory yang Paling Penting Untuk Graph Data

Neo4j memakai page cache untuk menyimpan data dan index dari disk agar akses berikutnya tidak perlu membaca disk lagi. Dokumentasi Neo4j menekankan bahwa page cache digunakan untuk cache data Neo4j yang tersimpan di disk dan index ke memory agar menghindari disk access yang mahal.

Untuk graph database, page cache sangat penting karena traversal bisa menyentuh banyak node/relationship kecil.

Bayangkan query:

```cypher
MATCH path = (:Person {personId: $id})-[:ASSOCIATED_WITH*1..4]->(:Person)
RETURN path
```

Query ini mungkin menyentuh:

- starting node,
- relationship chain,
- neighbor nodes,
- properties untuk filtering,
- properties untuk return,
- indexes untuk lookup awal.

Jika semuanya ada di memory/page cache, query bisa cepat. Jika banyak page harus dibaca dari disk, latency bisa melonjak.

Mental model:

```text
Heap is for objects and query execution structures.
Page cache is for graph data and indexes.
Disk is the expensive fallback.
```

Kesalahan umum Java engineer yang terbiasa JVM tuning:

```text
Memberi heap sebesar mungkin ke Neo4j.
Akibatnya page cache kekurangan memory.
Query graph jadi sering baca disk.
```

Neo4j bukan aplikasi Java biasa yang semua performanya membaik dengan heap besar. Kamu harus membagi memory untuk:

- OS,
- Neo4j heap,
- page cache,
- transaction memory,
- native/network buffers,
- background processes.

Prinsip:

```text
Do not maximize heap blindly.
For Neo4j, page cache sizing is a first-class capacity decision.
```

---

## 10. Cold Cache vs Warm Cache

Saat Neo4j baru start, page cache kosong. Query awal harus memuat page dari disk. Dokumentasi operasi Neo4j menjelaskan bahwa saat startup, page cache kosong dan graph data dimuat ke memory on demand ketika query membutuhkan data; ini dapat menyebabkan banyak disk reads dan IO wait pada periode awal.

Efeknya:

```text
Query yang sama bisa lambat setelah restart dan cepat setelah cache warm.
```

Ini penting untuk benchmark.

Benchmark buruk:

```text
Restart Neo4j.
Run query once.
Conclude query is slow.
```

Benchmark yang lebih benar:

```text
Run warm-up workload.
Measure repeated runs.
Compare cold and warm behavior separately.
Track page faults/cache misses.
```

Dalam production, cold cache bisa muncul setelah:

- restart,
- failover,
- scaling/moving workload,
- maintenance,
- backup/restore testing,
- OS page pressure,
- dataset lebih besar dari memory efektif.

Prinsip:

```text
Always distinguish query design problem from cache temperature problem.
```

---

## 11. Heap, Transaction Memory, dan Result Materialization

Heap digunakan oleh JVM untuk object, query execution structures, transaction state, dan runtime-level allocations. Tetapi tidak semua data graph ada di heap karena storage data utama di-cache lewat page cache.

Masalah heap sering muncul bukan hanya karena database besar, tetapi karena query menghasilkan intermediate result terlalu besar.

Contoh query berbahaya:

```cypher
MATCH (a:Person), (b:Company)
RETURN a, b
```

Ini menciptakan cartesian product.

Jika ada:

```text
1.000.000 Person
100.000 Company
```

maka pasangan teoretis:

```text
100.000.000.000 rows
```

Bukan graph yang gagal. Query yang salah.

Contoh lain:

```cypher
MATCH path = (p:Person {personId: $id})-[*1..6]-(x)
RETURN collect(path)
```

Masalah:

- traversal terlalu luas,
- relationship type tidak dibatasi,
- direction tidak dibatasi,
- depth cukup tinggi,
- semua path dikumpulkan ke satu list,
- memory pressure tinggi.

Prinsip:

```text
Memory failures often come from result shape, not only data size.
```

---

## 12. Transaction Log dan Durability Mental Model

Saat Neo4j menulis data, perubahan perlu direkam agar durable dan recoverable. Transaction log menyimpan informasi transaksi untuk recovery, replication, dan operational consistency.

Sebagai application engineer, kamu tidak perlu mengelola format transaction log. Tetapi kamu harus paham konsekuensinya:

1. Write bukan hanya update file data; write juga berdampak pada transaction log.
2. Write throughput dipengaruhi disk latency dan fsync behavior.
3. Batch terlalu besar bisa membuat transaction state dan log pressure tinggi.
4. Long-running transaction bisa menghambat resource cleanup.
5. Backup dan recovery bergantung pada state data + log.

Contoh buruk:

```cypher
MATCH (n)
SET n.processed = true
```

pada database besar dalam satu transaksi.

Risiko:

- transaksi terlalu besar,
- heap/transaction memory tinggi,
- transaction log besar,
- lock ditahan terlalu lama,
- recovery cost naik,
- aplikasi lain terdampak.

Lebih baik batch:

```cypher
MATCH (n:Entity)
WHERE n.processed IS NULL
WITH n LIMIT 10000
SET n.processed = true
RETURN count(n)
```

lalu ulangi secara terkendali dari job.

Prinsip:

```text
Large graph mutations must be chunked, idempotent, observable, and retry-safe.
```

---

## 13. Checkpoint Mental Model

Checkpoint adalah mekanisme database untuk memastikan state tertentu sudah tersinkronisasi dari memory/cache ke persistent storage sehingga recovery tidak perlu replay log terlalu jauh.

Sebagai engineer aplikasi, yang perlu kamu tahu:

- checkpoint berhubungan dengan recovery time,
- checkpoint bisa menambah IO pressure,
- workload write-heavy perlu perhatian pada disk throughput,
- transaction log retention dan backup strategy harus sinkron dengan kebutuhan recovery.

Jangan membuat aplikasi yang mengandalkan “semua perubahan langsung terlihat sebagai file data final”. Database punya mekanisme internal untuk durability dan recovery.

Prinsip:

```text
Think in transactions and recovery guarantees, not in immediate file mutation.
```

---

## 14. Query Lifecycle: Dari Cypher String ke Result

Saat aplikasi Java menjalankan query:

```java
session.executeRead(tx ->
    tx.run("""
        MATCH (p:Person {personId: $personId})-[:OWNS]->(c:Company)
        RETURN c.companyId AS companyId, c.name AS name
    """, Map.of("personId", personId))
      .list(record -> new CompanyDto(
          record.get("companyId").asString(),
          record.get("name").asString()
      ))
);
```

Secara mental Neo4j melakukan:

```text
1. Terima query via Bolt.
2. Parse Cypher.
3. Semantic check: label/type/property/variable valid secara sintaks/semantic.
4. Normalize query.
5. Cek plan cache.
6. Jika perlu, compile/plan query.
7. Pilih starting point dan operator.
8. Execute operator tree.
9. Baca index/data dari page cache/disk.
10. Kirim result stream ke driver.
11. Transaction commit/close.
```

Hal yang sering dilupakan:

```text
Query string adalah program kecil.
Planner harus memutuskan cara menjalankannya.
Data distribution memengaruhi rencana.
Parameterization memengaruhi plan reuse.
Result consumption di client memengaruhi resource lifetime.
```

---

## 15. Query Planning: Declarative Does Not Mean Directionless

Cypher adalah declarative query language. Kamu menyatakan pattern yang diinginkan, bukan langkah imperative detail.

Namun declarative bukan berarti kamu bebas menulis pattern sembarangan.

Contoh:

```cypher
MATCH (p:Person)-[:OWNS]->(c:Company)
WHERE p.personId = $personId
RETURN c
```

Secara logis sama dengan:

```cypher
MATCH (p:Person {personId: $personId})-[:OWNS]->(c:Company)
RETURN c
```

Planner bisa mengoptimalkan. Tetapi untuk readability dan modelling intent, query kedua lebih jelas.

Query planner menggunakan informasi seperti:

- label,
- relationship type,
- property predicates,
- indexes,
- constraints,
- statistics,
- cardinality estimates,
- query shape,
- parameterization,
- runtime capabilities.

Dokumentasi Cypher menjelaskan bahwa query dieksekusi berdasarkan execution plan yang terdiri dari operator, dan `EXPLAIN`/`PROFILE` digunakan untuk memahami rencana tersebut.

Mental model:

```text
Cypher planner chooses a route.
Your model and query shape determine whether good routes exist.
```

---

## 16. Execution Plan: Operator Tree

Execution plan bukan hanya log debugging. Ia adalah cara database menjawab:

```text
Bagaimana query ini akan dijalankan?
```

Dengan:

```cypher
EXPLAIN
MATCH (p:Person {personId: $id})-[:OWNS]->(c:Company)
RETURN c
```

Neo4j menampilkan rencana tanpa menjalankan query.

Dengan:

```cypher
PROFILE
MATCH (p:Person {personId: $id})-[:OWNS]->(c:Company)
RETURN c
```

Neo4j menjalankan query dan menampilkan statistik aktual.

Operator yang sering muncul:

| Operator | Makna Praktis |
|---|---|
| NodeIndexSeek | Mencari node melalui index. Biasanya bagus untuk starting point selektif. |
| NodeByLabelScan | Scan semua node dengan label tertentu. Bisa oke jika label kecil, buruk jika besar. |
| AllNodesScan | Scan semua node. Biasanya red flag di production query. |
| Expand(All) | Ekspansi relationship dari node ke neighbor. |
| Expand(Into) | Mengecek relationship antara node yang sudah diketahui. |
| Filter | Menerapkan predicate. |
| Projection | Membentuk hasil/proyeksi. |
| Sort | Mengurutkan; bisa mahal jika row besar. |
| Aggregation | Mengelompokkan/menghitung; bisa mahal. |
| Eager | Materialisasi intermediate result; sering perlu diperhatikan. |
| CartesianProduct | Kombinasi dua stream independen; sering red flag. |

Tidak semua operator buruk. Yang buruk adalah operator yang muncul dalam konteks cardinality besar tanpa alasan.

Prinsip:

```text
Do not tune Cypher by feeling.
Tune from PROFILE.
```

---

## 17. Rows, DB Hits, Memory: Cara Membaca PROFILE Secara Praktis

Saat melihat `PROFILE`, fokus pada beberapa sinyal:

### 17.1 Rows

Rows adalah jumlah record yang mengalir antar operator.

Masalah umum:

```text
Rows kecil di awal, lalu tiba-tiba meledak setelah Expand.
```

Artinya traversal terlalu luas.

### 17.2 Estimated Rows vs Actual Rows

Jika estimated jauh dari actual, planner mungkin membuat keputusan buruk.

Contoh:

```text
Estimated: 10 rows
Actual: 1,000,000 rows
```

Ini bisa menyebabkan operator/order yang tidak ideal.

### 17.3 DB Hits

DB hits memberi gambaran berapa banyak akses storage/logical data dilakukan.

Banyak DB hits tidak selalu buruk jika query memang besar, tetapi untuk query online request-response, DB hits tinggi adalah sinyal bahaya.

### 17.4 Memory

Memory tinggi sering muncul dari:

- sort,
- aggregation,
- collect,
- eager,
- large path materialization,
- cartesian product,
- huge intermediate rows.

### 17.5 Page Cache Hit/Miss

Jika tersedia di profiling/metrics, cache miss tinggi menunjukkan data harus dibaca dari disk.

Prinsip pembacaan:

```text
Find where cardinality explodes.
Find where index is missing.
Find where materialization happens.
Find whether traversal is bounded.
```

---

## 18. Cardinality: Angka yang Menghancurkan Query Graph

Cardinality adalah jumlah row/kemungkinan match pada setiap tahap query.

Graph query sering gagal bukan karena satu operasi mahal, tetapi karena kombinasi fan-out.

Misal:

```text
1 Person
→ rata-rata 20 accounts
→ tiap account 500 transactions
→ tiap transaction 2 counterparty accounts
→ tiap counterparty account 10 owners
```

Perkiraan kasar:

```text
1 × 20 × 500 × 2 × 10 = 200,000 result branches
```

Jika query return path penuh, bukan hanya node unik, jumlah result bisa lebih besar.

Cypher:

```cypher
MATCH path = (p:Person {personId: $id})
  -[:OWNS]->(:Account)
  -[:SENT]->(:Transaction)
  -[:TO]->(:Account)
  <-[:OWNS]-(other:Person)
RETURN path
```

Mungkin valid untuk investigation, tetapi berbahaya untuk API online tanpa limit/boundary.

Cara mengendalikan cardinality:

- mulai dari node sangat spesifik,
- gunakan label/type spesifik,
- tambahkan time window,
- tambahkan amount threshold,
- batasi depth,
- batasi relationship type,
- gunakan aggregation lebih awal jika benar,
- deduplicate node sebelum ekspansi berikutnya,
- gunakan `WITH DISTINCT`,
- materialize derived edge untuk query kritikal,
- pindahkan analytical traversal ke GDS/batch.

Prinsip:

```text
Every graph query must have a cardinality story.
```

---

## 19. Starting Point: Keputusan Paling Penting Dalam Query Graph

Query graph yang baik biasanya punya starting point jelas.

Contoh bagus:

```cypher
MATCH (c:Case {caseId: $caseId})-[:HAS_SUBJECT]->(p:Person)
RETURN p
```

Starting point:

```text
Case by unique caseId.
```

Contoh berbahaya:

```cypher
MATCH (c:Case)-[:HAS_SUBJECT]->(p:Person)
WHERE p.riskScore > 80
RETURN c, p
```

Pertanyaan:

```text
Apakah lebih baik mulai dari Case atau Person?
Apakah riskScore punya index?
Berapa banyak Person riskScore > 80?
Berapa banyak Case per Person?
```

Contoh lebih eksplisit:

```cypher
MATCH (p:Person)
WHERE p.riskScore > 80
MATCH (c:Case)-[:HAS_SUBJECT]->(p)
RETURN c, p
```

Jika ada index untuk `Person(riskScore)`, query bisa mulai dari subset person berisiko.

Namun jika 70% person punya riskScore > 80, index tidak terlalu membantu.

Prinsip:

```text
A graph query needs an anchor.
The anchor should be selective.
```

---

## 20. Index Lookup vs Traversal

Salah satu miskonsepsi besar:

```text
Karena Neo4j graph database, index tidak penting.
```

Salah.

Index sangat penting untuk menemukan starting point.

Setelah starting point ditemukan, traversal mengikuti relationship.

Pola umum:

```text
Index lookup → local traversal → filter/project/aggregate
```

Contoh:

```cypher
MATCH (p:Person {personId: $personId})
MATCH (p)-[:OWNS]->(a:Account)-[:SENT]->(t:Transaction)
WHERE t.date >= date($from)
RETURN t
```

Index bisa membantu:

- `Person(personId)` untuk starting point,
- mungkin `Transaction(date)` jika query dimulai dari date.

Tetapi setelah kamu sudah di `Account`, menemukan transaction dari relationship `SENT` biasanya traversal.

Pertanyaan desain:

```text
Apakah query harus mulai dari Person lalu traverse ke transaction?
Atau mulai dari Transaction(date) lalu cari owner?
```

Jawaban bergantung cardinality:

- Jika person spesifik punya sedikit account dan transaction, mulai dari person.
- Jika date window sangat kecil tetapi person luas, mulai dari transaction.
- Jika keduanya besar, perlu model/materialized edge/aggregation/analytics.

Prinsip:

```text
Index finds the door.
Traversal walks the room.
```

---

## 21. Query Runtime: Row Pipeline Mental Model

Cypher execution dapat dipahami sebagai pipeline row.

Query:

```cypher
MATCH (p:Person {personId: $id})-[:OWNS]->(c:Company)
MATCH (c)-[:REGISTERED_AT]->(addr:Address)
RETURN p.name, c.name, addr.text
```

Secara mental:

```text
Row 1: p ditemukan.
Expand p-[:OWNS]->c menghasilkan N row.
Untuk tiap c, expand c-[:REGISTERED_AT]->addr.
Return projection.
```

Jika satu person punya 3 companies dan tiap company punya 1 address:

```text
1 → 3 → 3 rows
```

Jika tiap company punya 1.000 address historical records:

```text
1 → 3 → 3,000 rows
```

Jika kemudian tiap address dihubungkan ke 10.000 cases:

```text
1 → 3 → 3,000 → 30,000,000 rows
```

Inilah mengapa graph query harus dipikirkan sebagai pipeline cardinality, bukan hanya diagram cantik.

Prinsip:

```text
Cypher patterns compose multiplicatively unless you constrain them.
```

---

## 22. Eager Operator dan Materialization

Beberapa query membutuhkan boundary yang mematerialisasi hasil intermediate sebelum melanjutkan. Ini bisa muncul sebagai `Eager` atau operator yang melakukan aggregation/sort/collect.

Contoh:

```cypher
MATCH (p:Person)
WITH collect(p) AS people
UNWIND people AS p
RETURN p
```

Ini memaksa semua person dikumpulkan ke list.

Atau:

```cypher
MATCH (p:Person)-[:OWNS]->(c:Company)
WITH p, collect(c) AS companies
RETURN p, companies
```

Ini valid jika kamu memang butuh list company per person. Tetapi jika jumlah company besar, memory naik.

Dalam Java service, jangan return graph besar sebagai nested object tanpa batas. Ini menggabungkan dua bahaya:

- database materialization,
- client-side object materialization.

Prinsip:

```text
Streaming rows is usually safer than collecting huge graph structures.
```

---

## 23. Variable-Length Traversal dan Path Explosion

Variable-length traversal adalah fitur kuat sekaligus berbahaya.

Contoh:

```cypher
MATCH path = (p:Person {personId: $id})-[:ASSOCIATED_WITH*1..4]-(x)
RETURN path
```

Pertanyaan wajib:

1. Relationship type apa saja?
2. Direction perlu dua arah?
3. Depth maksimal berapa?
4. Boleh revisit node?
5. Apakah path atau node unik yang dibutuhkan?
6. Apakah relationship memiliki time validity?
7. Apakah hasil perlu semua path atau cukup reachable nodes?
8. Apakah supernode bisa muncul?
9. Apakah query ini untuk API online atau investigation batch?

Contoh lebih terkontrol:

```cypher
MATCH path = (p:Person {personId: $id})
  -[:SHARES_ADDRESS|SHARES_PHONE|OWNS*1..3]-(x)
WHERE all(r IN relationships(path) WHERE r.validTo IS NULL)
RETURN x, length(path) AS distance
LIMIT 500
```

Masih perlu `PROFILE`, tetapi setidaknya traversal punya batas.

Prinsip:

```text
Variable-length traversal without semantic boundaries is a production incident waiting to happen.
```

---

## 24. Supernode: Ketika Adjacency Menjadi Musuh

Supernode adalah node dengan degree sangat tinggi.

Contoh:

```text
(:Country {code: 'ID'})
(:Category {name: 'Retail'})
(:Address {text: 'Unknown'})
(:Company {name: 'Google'})
(:Tag {name: 'active'})
(:CaseStatus {name: 'OPEN'})
```

Jika jutaan node terhubung ke satu node, traversal melalui node itu bisa meledak.

Contoh buruk:

```cypher
MATCH (p:Person {personId: $id})-[:LIVES_IN]->(:Country {code: 'ID'})<-[:LIVES_IN]-(other:Person)
RETURN other
```

Jika country `ID` punya 200 juta person, query ini tidak berguna.

Masalahnya bukan karena relationship `LIVES_IN` salah secara semantik, tetapi query menjadikan country sebagai jembatan similarity yang terlalu umum.

Solusi modelling mungkin:

- pakai address lebih spesifik,
- gunakan region/city/district sesuai kebutuhan,
- tambahkan time validity,
- tambahkan relationship yang lebih meaningful,
- hindari traversal balik dari kategori global,
- materialize derived relation hanya untuk match yang cukup kuat,
- gunakan GDS/offline untuk similarity besar.

Prinsip:

```text
A relationship is useful for traversal only if it carries selective meaning.
```

---

## 25. Read Path vs Write Path

Neo4j workload harus dipahami dari dua sisi:

```text
Read path: bagaimana query menemukan dan traverse graph.
Write path: bagaimana aplikasi membuat/mengubah node dan relationship dengan benar.
```

Read path failure:

- label scan besar,
- traversal explosion,
- missing index,
- poor cardinality,
- large result,
- cold cache.

Write path failure:

- duplicate node,
- duplicate relationship,
- missing constraint,
- incorrect `MERGE`,
- concurrent creation race,
- long transaction,
- deadlock,
- batch terlalu besar,
- non-idempotent ingestion.

Contoh write trap:

```cypher
MERGE (p:Person {name: $name})
```

Jika `name` bukan unique identity, kamu akan menggabungkan orang berbeda dengan nama sama.

Lebih benar:

```cypher
MERGE (p:Person {personId: $personId})
ON CREATE SET p.name = $name, p.createdAt = datetime()
ON MATCH SET p.name = $name, p.updatedAt = datetime()
```

Prinsip:

```text
Read performance comes from graph shape.
Write correctness comes from identity discipline.
```

---

## 26. Locks dan Concurrent Mutation Mental Model

Saat menulis graph, Neo4j harus menjaga consistency. Itu berarti ada locking dan transaction isolation behavior.

Kamu tidak perlu menghafal semua detail lock internal untuk part ini, tetapi perlu memahami konsekuensi:

- membuat/mengubah node tertentu dapat bersaing dengan transaction lain,
- membuat relationship antara node populer dapat menimbulkan contention,
- `MERGE` tanpa constraint dapat menyebabkan race dan duplicate,
- transaction retry adalah bagian normal dari aplikasi robust,
- deadlock/transient error harus dianggap possible.

Contoh skenario:

```text
Banyak worker ingest event yang semuanya menulis ke node Merchant yang sama.
Masing-masing membuat relationship baru ke Transaction.
Merchant menjadi write hotspot.
```

Dampak:

- lock contention,
- latency naik,
- transient failures,
- throughput turun.

Solusi bisa berupa:

- partition ingestion,
- batch by key,
- constraint-backed merge,
- retry with backoff,
- avoid unnecessary writes to central node,
- redesign relationship direction/type/grouping,
- precreate stable nodes,
- use event projection pipeline.

Prinsip:

```text
High-degree nodes are not only read problems. They can be write hotspots too.
```

---

## 27. Bolt Protocol dan Driver Mental Model

Aplikasi Java biasanya berkomunikasi dengan Neo4j melalui Neo4j Java Driver menggunakan Bolt protocol. Bolt adalah protocol untuk eksekusi query database seperti Cypher, biasanya di atas TCP atau WebSocket.

Mental model:

```text
Java application
  → Driver
    → Connection pool
      → Bolt connection
        → Neo4j server
          → transaction
            → query execution
```

Hal yang penting:

- Driver dibuat sekali dan di-reuse sepanjang lifecycle aplikasi.
- Session adalah lightweight logical context, bukan singleton global.
- Transaction boundary harus eksplisit.
- Read/write transaction function membantu routing dan retry.
- Result harus dikonsumsi dengan benar agar resource dilepas.
- Connection pool harus disizing sesuai concurrency dan workload.
- Database name harus eksplisit.

Pola baik:

```java
try (var session = driver.session(SessionConfig.builder()
        .withDatabase("neo4j")
        .build())) {

    return session.executeRead(tx ->
        tx.run("""
            MATCH (p:Person {personId: $personId})-[:OWNS]->(c:Company)
            RETURN c.companyId AS companyId, c.name AS name
            """, Map.of("personId", personId))
          .list(r -> new CompanyDto(
              r.get("companyId").asString(),
              r.get("name").asString()
          ))
    );
}
```

Pola buruk:

```text
Membuat driver baru per request.
Tidak menutup session.
Tidak membedakan read/write transaction.
Mengirim string query hasil concatenation user input.
Return graph besar tanpa pagination.
```

Prinsip:

```text
The driver is infrastructure. Sessions and transactions are units of work.
```

---

## 28. Routing: Direct vs Cluster-Aware

Dalam deployment single instance, aplikasi bisa connect langsung ke server.

Dalam cluster, driver perlu routing agar:

- write diarahkan ke server yang menerima write,
- read dapat diarahkan ke server yang sesuai,
- failover dapat ditangani,
- routing table diperbarui.

Neo4j documentation membedakan URI scheme seperti `bolt://` dan `neo4j://`/routing-related behavior. Pada cluster, routing driver sangat penting karena aplikasi tidak boleh berasumsi satu endpoint selalu leader/write target.

Mental model:

```text
bolt://  = direct connection mindset.
neo4j:// = routing-aware mindset.
```

Kamu tidak perlu masuk detail clustering sekarang; itu akan dibahas di Part 018. Namun sejak awal, desain aplikasi harus siap:

- read transaction pakai executeRead,
- write transaction pakai executeWrite,
- database explicit,
- retry transient error,
- jangan hardcode leader,
- jangan menganggap semua node cluster setara untuk write.

Prinsip:

```text
In Neo4j cluster, the driver is part of the architecture, not just a library.
```

---

## 29. Why Graph Query Can Be Fast

Graph query bisa cepat jika pattern-nya seperti ini:

```cypher
MATCH (c:Case {caseId: $caseId})
MATCH (c)-[:HAS_SUBJECT]->(subject)
MATCH (subject)-[:OWNS|CONTROLS*1..2]->(entity)
RETURN entity
```

Karena:

1. `Case(caseId)` adalah starting point selektif.
2. Traversal dimulai dari satu case.
3. Relationship type dibatasi.
4. Depth dibatasi.
5. Hasil relevan secara domain.
6. Jika graph sekitar case tidak terlalu dense, traversal kecil.

Secara mental:

```text
Find one anchor → expand local neighborhood → return bounded result.
```

Ini sweet spot graph database.

---

## 30. Why Graph Query Can Be Slow

Graph query bisa lambat jika pattern-nya seperti ini:

```cypher
MATCH path = (a)-[*1..6]-(b)
RETURN path
```

Masalah:

- tidak ada label,
- tidak ada starting point,
- relationship type semua,
- direction dua arah,
- depth tinggi,
- return semua path,
- tidak ada limit semantic,
- seluruh graph dapat dieksplorasi.

Ini bukan “Neo4j lambat”. Ini query yang secara definisi meminta ledakan kemungkinan.

Versi lebih masuk akal:

```cypher
MATCH (start:Person {personId: $personId})
MATCH path = (start)-[:SHARES_PHONE|SHARES_ADDRESS|OWNS|CONTROLS*1..3]-(x)
WHERE all(r IN relationships(path) WHERE r.validTo IS NULL)
RETURN x, length(path) AS distance
LIMIT 500
```

Masih perlu profiling, tetapi jauh lebih bounded.

Prinsip:

```text
Graph databases do not remove combinatorics.
They make relationship navigation natural, but combinatorics still exists.
```

---

## 31. Storage Locality vs Domain Locality

Neo4j traversal terasa natural karena graph punya adjacency. Tetapi jangan menyamakan domain locality dengan storage locality secara naif.

Domain locality:

```text
Case A terhubung ke Person B, Account C, Evidence D.
```

Storage locality:

```text
Apakah record-record itu berada di page yang sedang hot di memory?
```

Graph yang domain-nya lokal belum tentu semua datanya selalu hot. Jika working set lebih besar dari memory, traversal tetap bisa menyentuh banyak page disk.

Contoh:

```text
Investigator membuka case lama yang jarang diakses.
Traversal case network menyentuh data historis besar.
Cache miss tinggi.
Latency naik.
```

Solusi bukan selalu ubah model. Bisa berupa:

- capacity page cache lebih besar,
- pre-warm workload,
- result caching di layer aplikasi untuk read-only view tertentu,
- archival strategy,
- split hot/cold database,
- materialized summary,
- offline analytics.

Prinsip:

```text
Good graph shape reduces logical work.
Good memory sizing reduces physical work.
```

---

## 32. Query Result Shape: Node, Relationship, Path, DTO

Dalam Neo4j, query bisa return node, relationship, path, scalar, map, list, atau projection.

Untuk aplikasi Java, jangan otomatis return node/path mentah ke API.

Contoh eksplorasi cocok:

```cypher
MATCH path = (c:Case {caseId: $caseId})-[*1..2]-(x)
RETURN path
```

Untuk UI investigation graph, path mungkin cocok.

Untuk API backend biasa, lebih baik projection:

```cypher
MATCH (c:Case {caseId: $caseId})-[:HAS_SUBJECT]->(p:Person)
RETURN {
  personId: p.personId,
  name: p.name,
  riskScore: p.riskScore
} AS subject
```

Kenapa?

- DTO lebih stabil,
- payload lebih kecil,
- internal labels/properties tidak bocor,
- API contract jelas,
- security trimming lebih mudah,
- client tidak tergantung bentuk graph internal.

Prinsip:

```text
Return graph when the user needs graph.
Return projection when the application needs data.
```

---

## 33. Native Graph vs Graph Projection

Neo4j database menyimpan operational graph. Namun untuk analytics, terutama Graph Data Science, sering dibuat graph projection di memory.

Perbedaannya:

```text
Stored graph:
- source operational data
- persisted
- transactional
- updated continuously

Projected graph:
- analytical view
- selected nodes/relationships/properties
- in-memory
- optimized for algorithm execution
```

Contoh:

Operational graph:

```text
Person, Account, Transaction, Case, Evidence, Officer, Regulation
```

Analytical projection untuk fraud ring:

```text
Person --SHARES_DEVICE--> Person
Person --SHARES_BANK_ACCOUNT--> Person
Person --HAS_COMMON_DIRECTOR--> Person
```

Artinya, tidak semua relationship operational perlu masuk GDS projection.

Prinsip:

```text
Operational graph answers business queries.
Analytical graph answers structural questions.
```

---

## 34. Neo4j Bukan Hanya Storage: Ini Query + Runtime + Tooling Platform

Saat memilih Neo4j, kamu memilih lebih dari format data.

Kamu memilih ekosistem:

- Cypher untuk query declarative graph,
- indexes dan constraints,
- Bolt protocol,
- Java driver,
- Spring Data Neo4j,
- Browser/Bloom untuk eksplorasi,
- APOC untuk utilities,
- Graph Data Science untuk algorithms,
- Aura/self-managed deployment,
- backup/monitoring/security operations,
- vector indexes dan graph-enhanced retrieval use cases.

Karena itu evaluasi Neo4j tidak boleh hanya:

```text
Apakah graph query X cepat?
```

Tetapi juga:

```text
Apakah tim bisa memodelkan graph dengan benar?
Apakah query kritikal bisa diprofiling?
Apakah Java integration robust?
Apakah data source-of-truth jelas?
Apakah operation team bisa backup/restore/monitor?
Apakah security model memenuhi audit?
Apakah graph analytics benar-benar dibutuhkan?
```

---

## 35. Common Bottleneck Map

Berikut peta bottleneck umum dan cara berpikirnya.

| Bottleneck | Gejala | Penyebab Umum | Cara Pikir Solusi |
|---|---|---|---|
| Label scan besar | Query lambat sejak awal | Starting point tidak selektif | Tambah index/constraint, ubah anchor query |
| Traversal explosion | Rows meledak setelah Expand | Fan-out tinggi, depth besar | Batasi type/depth/filter, redesign model |
| Supernode | Query tertentu sangat lambat | Node degree sangat tinggi | Partition, grouping, derived edges, avoid reverse traversal |
| Cold page cache | Query lambat setelah restart | Data belum hot di memory | Warm-up, size page cache, benchmark benar |
| Heap pressure | OOM/GC tinggi | collect/sort/aggregation/result besar | Stream result, limit, paginate, reduce materialization |
| Write contention | Transient error/latency write | Banyak write ke node sama | Retry, partition, redesign hotspot |
| Duplicate entity | Data integrity rusak | MERGE tanpa key/constraint | Natural key, uniqueness constraint |
| Bad plan | Query tiba-tiba lambat | Statistik/data distribution berubah | PROFILE, indexes, query rewrite |
| Driver misuse | Connection leak/latency | Driver/session lifecycle salah | Singleton driver, scoped session, transaction functions |
| Cluster routing issue | Read/write gagal/aneh | Direct URI, wrong mode | Routing URI, executeRead/executeWrite |

---

## 36. Architecture Smells Dalam Neo4j System

Waspadai tanda-tanda berikut.

### 36.1 Semua query dimulai dengan `MATCH (n)`

Ini biasanya tanda tidak ada access pattern jelas.

### 36.2 Semua relationship type bernama generik

Contoh:

```cypher
(:A)-[:RELATED_TO]->(:B)
```

Jika semuanya `RELATED_TO`, graph kehilangan semantic selectivity.

### 36.3 Terlalu banyak relationship type dinamis

Contoh:

```text
BOUGHT_PRODUCT_123
BOUGHT_PRODUCT_456
BOUGHT_PRODUCT_789
```

Ini relationship type explosion. Product seharusnya node/property, bukan type dinamis.

### 36.4 Query production return path tanpa batas

```cypher
MATCH path = (n)-[*]-(m)
RETURN path
```

Ini red flag besar.

### 36.5 Graph dipakai sebagai source-of-truth tanpa ownership jelas

Jika data berasal dari banyak sistem tetapi tidak ada provenance, reconciliation, dan conflict policy, graph akan menjadi data swamp.

### 36.6 Java object graph dianggap sama dengan database graph

ORM thinking bisa merusak graph query. Object aggregate boundary tidak selalu sama dengan traversal boundary.

### 36.7 Tidak ada `PROFILE` dalam proses review query

Graph query tanpa profile seperti SQL query tanpa explain plan.

---

## 37. Mental Model Untuk Java Engineer

Karena kamu Java engineer, berikut mapping dari konsep Neo4j ke engineering intuition yang mungkin familiar.

| Java/System Concept | Neo4j Equivalent/Mental Model |
|---|---|
| Object reference | Relationship, tetapi persisted dan queryable |
| Collection traversal | Graph expansion, tetapi bisa sangat besar |
| Repository method | Cypher query + transaction boundary |
| DTO projection | `RETURN` map/scalar projection |
| Unique business key | Constraint-backed identity property |
| Connection pool | Driver-managed Bolt connection pool |
| Retryable exception | Transient database error/deadlock/failover handling |
| Heap tuning | Only part of memory tuning; page cache is critical |
| Batch job | Chunked idempotent transaction loop |
| Integration event | Potential source for graph projection mutation |
| Read model | Neo4j graph can be projection from source systems |
| Profiling | `PROFILE`/query log/metrics |

Key mindset shift:

```text
Do not map Java object graph naively into Neo4j.
Model the graph around questions and traversals.
```

---

## 38. Example: Regulatory Case Graph Runtime Walkthrough

Misal kita punya model:

```cypher
(:Case {caseId})-[:HAS_SUBJECT]->(:Person {personId})
(:Person)-[:OWNS]->(:Company)
(:Company)-[:REGISTERED_AT]->(:Address)
(:Person)-[:SHARES_PHONE]->(:Person)
(:Evidence)-[:SUPPORTS]->(:Allegation)
(:Allegation)-[:PART_OF]->(:Case)
```

Pertanyaan:

```text
Untuk satu case, temukan subject, company yang dimiliki subject, alamat company, dan orang lain yang share phone dengan subject.
```

Query:

```cypher
MATCH (c:Case {caseId: $caseId})-[:HAS_SUBJECT]->(subject:Person)
OPTIONAL MATCH (subject)-[:OWNS]->(company:Company)-[:REGISTERED_AT]->(address:Address)
OPTIONAL MATCH (subject)-[:SHARES_PHONE]-(related:Person)
RETURN
  subject.personId AS subjectId,
  collect(DISTINCT company.companyId) AS companyIds,
  collect(DISTINCT address.addressId) AS addressIds,
  collect(DISTINCT related.personId) AS relatedPersonIds
```

Runtime mental model:

1. Gunakan index/constraint `Case(caseId)` untuk menemukan case.
2. Expand `HAS_SUBJECT` ke subject.
3. Dari subject, expand `OWNS` ke company.
4. Dari company, expand `REGISTERED_AT` ke address.
5. Dari subject, expand `SHARES_PHONE` dua arah ke related person.
6. Aggregation mengumpulkan hasil.

Risiko:

- Jika subject punya ribuan company, expansion besar.
- Jika `SHARES_PHONE` menghubungkan banyak orang karena phone `UNKNOWN`, supernode/similarity noise.
- Jika address `UNKNOWN` dipakai massal, reverse traversal dari address berbahaya.
- `OPTIONAL MATCH` dapat memperbesar row jika ada banyak combination company × related.

Versi lebih aman bisa memisah subquery:

```cypher
MATCH (c:Case {caseId: $caseId})-[:HAS_SUBJECT]->(subject:Person)

CALL {
  WITH subject
  MATCH (subject)-[:OWNS]->(company:Company)
  RETURN collect(DISTINCT company.companyId) AS companyIds
}

CALL {
  WITH subject
  MATCH (subject)-[:OWNS]->(:Company)-[:REGISTERED_AT]->(address:Address)
  RETURN collect(DISTINCT address.addressId) AS addressIds
}

CALL {
  WITH subject
  MATCH (subject)-[:SHARES_PHONE]-(related:Person)
  RETURN collect(DISTINCT related.personId)[0..100] AS relatedPersonIds
}

RETURN subject.personId AS subjectId, companyIds, addressIds, relatedPersonIds
```

Kenapa subquery membantu?

Karena setiap cabang traversal dihitung terpisah, mengurangi risiko kombinasi kartesian antar optional branch.

Prinsip:

```text
When multiple independent expansions start from the same node, beware of row multiplication.
```

---

## 39. Example: Dependency Impact Query

Model:

```cypher
(:Service)-[:DEPENDS_ON]->(:Service)
(:Service)-[:OWNS_TABLE]->(:Table)
(:Service)-[:CALLS]->(:Endpoint)
```

Pertanyaan:

```text
Jika Service A gagal, service mana yang terdampak hingga depth 3?
```

Query:

```cypher
MATCH path = (:Service {name: $serviceName})<-[:DEPENDS_ON*1..3]-(impacted:Service)
RETURN impacted.name AS service, min(length(path)) AS distance
ORDER BY distance, service
```

Runtime mental model:

- Mulai dari service spesifik.
- Traverse incoming `DEPENDS_ON` karena kita mencari service yang bergantung pada A.
- Depth dibatasi 3.
- Aggregation memilih jarak minimum.

Risiko:

- Jika dependency graph sangat dense, path count bisa besar.
- Jika cycles ada, path traversal bisa menghasilkan banyak alternatif.
- Jika hanya butuh node terdampak, jangan return semua path.

Lebih aman:

```cypher
MATCH (:Service {name: $serviceName})<-[:DEPENDS_ON*1..3]-(impacted:Service)
RETURN DISTINCT impacted.name AS service
LIMIT 1000
```

Jika butuh shortest/weighted/large-scale analysis, pertimbangkan GDS path algorithms, bukan Cypher online query.

---

## 40. Example: Fraud Ring Exploration

Model:

```cypher
(:Person)-[:USES_DEVICE]->(:Device)
(:Person)-[:USES_PHONE]->(:Phone)
(:Person)-[:OWNS]->(:Account)
(:Account)-[:SENT]->(:Transaction)-[:TO]->(:Account)
```

Pertanyaan investigator:

```text
Temukan orang lain yang terkait dengan subject melalui shared device/phone/account dalam 2 hop.
```

Naive query:

```cypher
MATCH path = (:Person {personId: $id})-[*1..4]-(:Person)
RETURN path
```

Masalah:

- relationship type semua,
- bisa lewat transaction massal,
- bisa lewat phone/device umum/null,
- path terlalu banyak,
- return path penuh.

Lebih domain-aware:

```cypher
MATCH path = (subject:Person {personId: $id})
  -[:USES_DEVICE|USES_PHONE|OWNS*1..2]-(related:Person)
WHERE subject <> related
RETURN DISTINCT related.personId AS relatedPersonId, min(length(path)) AS distance
ORDER BY distance
LIMIT 200
```

Masih perlu guards:

- exclude phone/device yang marked `sharedPublic = true`,
- exclude placeholder values,
- filter active relationships,
- cap degree,
- maybe precompute suspicious shared relations.

Contoh:

```cypher
MATCH (subject:Person {personId: $id})
MATCH (subject)-[:USES_DEVICE]->(d:Device)<-[:USES_DEVICE]-(related:Person)
WHERE coalesce(d.isPublic, false) = false
  AND coalesce(d.userCount, 0) <= 20
RETURN DISTINCT related.personId AS relatedPersonId
LIMIT 200
```

Prinsip:

```text
Fraud graph value comes from meaningful shared signals, not from connecting everything to everything.
```

---

## 41. Practical Architecture Checklist

Saat mendesain Neo4j workload, jawab pertanyaan ini.

### 41.1 Storage and Model

- Apa node utama?
- Apa relationship utama?
- Relationship mana yang akan sering di-traverse?
- Relationship mana yang hanya metadata?
- Ada supernode potensial?
- Ada node placeholder seperti `UNKNOWN`, `N/A`, `DEFAULT`, `GLOBAL`?
- Apakah relationship punya time validity?
- Apakah source/provenance perlu disimpan?

### 41.2 Query

- Apa query paling kritikal?
- Apa starting point tiap query?
- Apakah starting point indexed/unique?
- Berapa expected fan-out tiap hop?
- Apakah depth traversal dibatasi?
- Apakah return path, node, atau projection?
- Apakah query online atau offline?
- Apakah sudah `PROFILE` dengan data realistis?

### 41.3 Java Integration

- Apakah driver singleton?
- Apakah session scoped per unit of work?
- Apakah database name explicit?
- Apakah read/write transaction dipisah?
- Apakah transient error di-retry?
- Apakah result besar di-stream/paginate?
- Apakah DTO projection dipakai?

### 41.4 Operation

- Apakah page cache sizing cukup?
- Apakah heap tidak terlalu besar/kecil?
- Apakah query log aktif untuk slow query?
- Apakah backup/restore diuji?
- Apakah monitoring page cache, heap, GC, disk IO, tx log tersedia?
- Apakah ada runbook untuk restart/failover/cold cache?

---

## 42. Failure Modelling

Top 1% engineer tidak hanya tahu happy path. Ia bisa memodelkan kegagalan.

### 42.1 Failure: Query lambat setelah deployment

Kemungkinan:

- data distribution berubah,
- index belum dibuat/populated,
- plan berubah,
- query baru unbounded,
- page cache cold,
- driver routing salah,
- result payload lebih besar.

Response:

```text
Check query log → PROFILE query → compare plan → check index/constraints → check page cache metrics → inspect cardinality → rollback/rewrite if needed.
```

### 42.2 Failure: Duplicate nodes muncul

Kemungkinan:

- `MERGE` memakai property non-unique,
- constraint tidak ada,
- concurrent ingestion,
- source ID tidak konsisten,
- multi-source identity resolution tidak matang.

Response:

```text
Stop ingestion → identify duplicate key rules → add constraints → deduplicate with audited migration → fix writer idempotency.
```

### 42.3 Failure: Investigator membuka satu case dan UI freeze

Kemungkinan:

- API return path besar,
- case subject connected ke supernode,
- tidak ada limit,
- frontend merender ribuan node,
- query mengumpulkan semua path.

Response:

```text
Limit neighborhood → progressive expansion → degree cap → server-side pagination → hide low-signal relationships → async exploration.
```

### 42.4 Failure: Write latency naik saat traffic tinggi

Kemungkinan:

- write hotspot pada node populer,
- large transaction,
- lock contention,
- disk fsync bottleneck,
- transaction log pressure,
- connection pool saturation.

Response:

```text
Inspect write query → identify hot nodes → reduce transaction size → retry transient errors → partition workload → tune disk/resources.
```

### 42.5 Failure: Cluster failover membuat aplikasi error

Kemungkinan:

- direct `bolt://` digunakan untuk cluster,
- app tidak memakai transaction function,
- retry tidak ada,
- hardcoded server,
- stale routing table.

Response:

```text
Use routing URI → executeRead/executeWrite → configure retry → explicit database → validate cluster routing.
```

---

## 43. The Most Important Invariants

Bawa invariant ini sepanjang seri.

### Invariant 1

```text
Every production graph query must have a selective starting point or a deliberate scan justification.
```

### Invariant 2

```text
Every traversal must have semantic boundaries.
```

### Invariant 3

```text
Every entity identity used by writes must be backed by a stable business key and ideally a constraint.
```

### Invariant 4

```text
Every variable-length traversal must have an explicit depth bound unless it is offline and controlled.
```

### Invariant 5

```text
Every graph result should be shaped for its consumer: path for exploration, projection for application API, aggregate for summary.
```

### Invariant 6

```text
Every performance claim must be verified with PROFILE or production metrics.
```

### Invariant 7

```text
Every Neo4j production deployment must treat page cache as a core capacity resource.
```

### Invariant 8

```text
Every Java integration must treat driver/session/transaction lifecycle as architecture, not boilerplate.
```

---

## 44. Apa yang Tidak Perlu Kamu Hafal

Jangan buang energi menghafal:

- detail byte-level semua record,
- semua config Neo4j sekaligus,
- semua operator Cypher,
- semua internal lock mode,
- semua metric sejak awal,
- semua varian deployment.

Yang perlu kamu kuasai:

```text
graph shape → query shape → execution plan → memory/disk behavior → application behavior → operational risk
```

Jika kamu bisa mengikuti rantai itu, kamu bisa berkembang jauh lebih cepat daripada engineer yang hanya menghafal syntax Cypher.

---

## 45. Ringkasan Mental Model

Neo4j kuat ketika kamu punya pertanyaan seperti:

```text
Dari entity ini, koneksi relevan apa yang bisa dicapai melalui relationship bermakna dalam batas tertentu?
```

Neo4j lemah ketika kamu memakainya untuk:

```text
Scan semua data, gabungkan semua kemungkinan, return semua path, tanpa batas, tanpa starting point, tanpa semantic filtering.
```

Architecture mental model:

```text
Java service
  → driver/session/transaction
  → Bolt
  → Cypher parser/planner
  → execution plan operators
  → index lookup / label scan
  → relationship expansion
  → page cache / disk
  → result stream
  → DTO/API/UI
```

Performance mental model:

```text
Good anchor + selective expansion + bounded depth + warm page cache + controlled result shape = fast graph query.
```

Correctness mental model:

```text
Stable identity + constraints + idempotent writes + transaction retry + explicit invariants = safe graph mutation.
```

Operational mental model:

```text
Heap keeps execution healthy.
Page cache keeps graph access fast.
Transaction log keeps writes recoverable.
Metrics and PROFILE keep assumptions honest.
```

---

## 46. Latihan Praktis

Gunakan latihan ini untuk menguji pemahaman.

### Latihan 1 — Starting Point

Untuk query berikut, tentukan starting point dan risikonya:

```cypher
MATCH (p:Person)-[:OWNS]->(c:Company)
WHERE c.country = 'ID'
RETURN p, c
```

Pertanyaan:

- Apakah mulai dari `Person` atau `Company` lebih baik?
- Apakah `Company(country)` selektif?
- Berapa banyak company di country tersebut?
- Apakah query ini online atau report?

### Latihan 2 — Traversal Explosion

Analisis query:

```cypher
MATCH path = (p:Person {personId: $id})-[*1..5]-(x)
RETURN path
```

Perbaiki dengan:

- relationship type,
- direction,
- depth,
- filtering,
- result shape,
- limit.

### Latihan 3 — Supernode

Model:

```cypher
(:Person)-[:HAS_STATUS]->(:Status {name: 'ACTIVE'})
```

Pertanyaan:

- Apakah `Status` berguna sebagai traversal node?
- Kapan status cukup menjadi property?
- Kapan status menjadi node masuk akal?

### Latihan 4 — Java Lifecycle

Review pseudo-code:

```java
public List<Record> find(String id) {
    Driver driver = GraphDatabase.driver(uri, auth);
    Session session = driver.session();
    return session.run("MATCH (n {id: '" + id + "'}) RETURN n").list();
}
```

Temukan minimal 7 masalah.

### Latihan 5 — PROFILE Reasoning

Jika `PROFILE` menunjukkan:

```text
NodeByLabelScan(Person) → 20,000,000 rows
Filter p.email = $email → 1 row
Expand(All) → 12 rows
```

Apa perbaikannya?

Jawaban yang diharapkan:

```text
Tambahkan index/constraint pada :Person(email), lalu pastikan query memakai property lookup sebagai starting point.
```

---

## 47. Referensi Resmi yang Relevan

Referensi ini berguna untuk memperdalam bagian yang dibahas:

- Neo4j Operations Manual — memory configuration dan page cache.
- Neo4j Operations Manual — disks, RAM, dan page cache warm-up.
- Neo4j Cypher Manual — query plans, `EXPLAIN`, `PROFILE`, operators, query tuning.
- Neo4j Bolt Protocol documentation.
- Neo4j Java Driver Manual — connection/session/transaction usage.
- Neo4j Operations Manual — clustering routing dan driver routing behavior.

---

## 48. Penutup Part 003

Part ini seharusnya memberi kamu peta internal Neo4j:

```text
Storage bukan hanya file.
Query bukan hanya syntax.
Traversal bukan magic.
Page cache bukan detail ops kecil.
Driver bukan boilerplate.
PROFILE bukan optional.
```

Jika Part 001 dan Part 002 membentuk cara berpikir graph, Part 003 membentuk cara berpikir runtime.

Setelah ini, kita akan masuk ke Cypher fundamentals dengan lebih sistematis.

Part berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-004.md
```

Topik:

```text
Cypher Fundamentals: Pattern Matching as a Query Language
```

Status seri:

```text
Part 000 selesai.
Part 001 selesai.
Part 002 selesai.
Part 003 selesai.
Seri belum selesai.
Masih ada Part 004 sampai Part 032.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — Property Graph Model Deep Dive</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-004.md">Part 004 — Cypher Fundamentals: Pattern Matching as a Query Language ➡️</a>
</div>
