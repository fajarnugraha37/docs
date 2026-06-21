# learn-graph-database-and-neo4j-mastery-for-java-engineers — Part 000
# Orientation: Why Graph Database Exists and What Problem It Actually Solves

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Part: `000`  
> File: `learn-graph-database-and-neo4j-mastery-for-java-engineers-part-000.md`  
> Target pembaca: Java software engineer / tech lead yang sudah memahami database umum, backend systems, distributed systems dasar, dan ingin menguasai graph database + Neo4j secara arsitektural, praktis, dan production-aware.

---

## 0. Tujuan Part Ini

Part ini bukan tutorial `MATCH (n) RETURN n`.

Part ini adalah fondasi mental model. Sebelum menulis Cypher, sebelum install Neo4j, sebelum bicara index, GDS, Spring Data Neo4j, atau GraphRAG, kita perlu menjawab pertanyaan yang lebih penting:

> **Problem seperti apa yang benar-benar membutuhkan graph database?**

Banyak engineer salah mulai belajar graph database dengan asumsi:

> “Graph database adalah database untuk menyimpan data yang punya relasi.”

Itu benar secara permukaan, tapi terlalu lemah. Hampir semua data bisnis punya relasi. Relational database juga sangat baik untuk relasi. Document database juga bisa menyimpan referensi. Search engine bisa menyimpan adjacency list. Bahkan Redis bisa menyimpan set relasi.

Definisi yang lebih berguna:

> **Graph database berguna ketika nilai utama sistem bukan hanya entity-nya, tetapi pola koneksi antar-entity, path antar-entity, struktur jaringan, dan perubahan hubungan tersebut.**

Dengan kata lain, graph database bukan sekadar tempat menyimpan “data yang connected”. Graph database adalah database untuk domain ketika **connection itself is the product**.

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan kenapa graph database ada.
2. Membedakan graph-shaped problem dari relational/document/search/OLAP problem.
3. Mengenali kapan Neo4j cocok dan kapan tidak.
4. Memahami posisi Neo4j dalam arsitektur modern.
5. Membaca sisa seri ini dengan orientasi yang benar: bukan “belajar syntax”, tetapi “belajar berpikir graph-native”.

---

## 1. Premis Utama: Tidak Semua Relationship Sama

Sebagai Java engineer, kamu sudah sering melihat model seperti ini:

```text
Customer -- places --> Order
Order    -- has    --> OrderItem
Product  -- appears_in --> OrderItem
```

Di relational database, ini sangat natural:

```sql
customers
orders
order_items
products
```

Lalu query:

```sql
SELECT c.*, o.*, oi.*, p.*
FROM customers c
JOIN orders o ON o.customer_id = c.id
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
WHERE c.id = ?;
```

Ini belum otomatis graph problem. Ini masih domain transaksi normal. Relationship di sini terutama digunakan untuk:

- referential integrity,
- normalization,
- aggregation,
- reporting,
- transaction processing.

Graph database mulai menarik ketika requirement berubah menjadi:

```text
Cari customer yang punya pola pembelian mirip,
yang terhubung lewat device yang sama,
yang pernah memakai alamat pengiriman yang sama,
yang punya koneksi tidak langsung ke akun yang pernah ditandai fraud,
dengan maksimal 4 hop,
dan jelaskan path koneksinya.
```

Atau:

```text
Dari satu organization, cari beneficial owner tidak langsung
melalui chain ownership lintas perusahaan,
termasuk nominee/director/intermediary,
dan tentukan apakah ada circular ownership atau hidden control path.
```

Atau:

```text
Jika policy ini berubah, user, role, group, system, service account,
dan downstream approval apa saja yang terdampak?
Tunjukkan jalur dampaknya.
```

Di sini relationship bukan lagi “foreign key untuk join”. Relationship menjadi objek analisis utama.

---

## 2. Relationship sebagai First-Class Citizen

Dalam relational database, relationship biasanya direpresentasikan oleh:

1. foreign key,
2. join table,
3. associative entity,
4. nullable reference,
5. materialized view,
6. denormalized column.

Itu powerful, tapi relationship tidak selalu diperlakukan sebagai objek utama. Relational model berpusat pada relation/table secara matematis. Join adalah operasi query untuk menggabungkan relation berdasarkan predicate.

Dalam property graph seperti Neo4j, struktur dasarnya adalah:

```text
(node)-[relationship]->(node)
```

Node mewakili entity/domain object.
Relationship mewakili koneksi semantic antar-entity.
Node dan relationship dapat memiliki properties.
Node dapat memiliki label.
Relationship memiliki type dan direction.

Contoh:

```cypher
(:Person {id: 'P1', name: 'Ayu'})
  -[:OWNS {since: date('2021-05-01'), percentage: 70}]->
(:Company {id: 'C1', name: 'Nusantara Holdings'})
```

Perhatikan: `OWNS` bukan sekadar foreign key. Ia punya makna domain:

- siapa mengontrol siapa,
- sejak kapan,
- berapa persentase,
- apakah bisa membentuk chain control,
- apakah dapat dipakai untuk inferensi beneficial ownership,
- apakah menjadi evidence dalam investigasi.

Di graph database, relationship bisa menjadi pusat pertanyaan:

```text
Siapa terhubung dengan siapa?
Lewat hubungan apa?
Seberapa jauh?
Apakah ada path alternatif?
Apakah path ini valid secara temporal?
Apakah path ini melewati entity berisiko?
Apakah node ini menjadi penghubung utama komunitas?
Apakah graph ini punya cluster mencurigakan?
```

Inilah alasan graph database ada.

---

## 3. Query by Attribute vs Query by Connection

Salah satu mental model paling penting:

> Banyak database sangat baik untuk menemukan data berdasarkan **attribute**. Graph database kuat ketika pertanyaan utamanya adalah **connection**.

### 3.1 Query by Attribute

Contoh query by attribute:

```text
Cari semua customer dari Jakarta dengan status active.
Cari semua transaction di atas 10 juta rupiah.
Cari semua document yang mengandung kata “sanction”.
Cari semua log error dalam 15 menit terakhir.
```

Database yang sering cocok:

- PostgreSQL/MySQL untuk structured transactional query.
- Elasticsearch untuk text search dan relevance.
- ClickHouse untuk analytical aggregation.
- Redis untuk low-latency lookup/cache.
- QuestDB untuk time-series ingestion/query.

Graph database belum tentu unggul di sini.

### 3.2 Query by Connection

Contoh query by connection:

```text
Cari semua account yang terhubung ke fraud account melalui device, phone number, IP, atau address dalam maksimal 3 hop.
```

```text
Cari semua service yang terdampak jika library X punya vulnerability.
```

```text
Cari semua case yang tampak berbeda tetapi berbagi beneficial owner, intermediary, document, atau officer yang sama.
```

```text
Cari shortest path antara subject investigasi dan politically exposed person.
```

```text
Cari user yang punya permission ke resource sensitif melalui nested group membership.
```

Di sini data tidak hanya diambil. Data **ditelusuri**.

Perbedaannya:

```text
Attribute query:
  “Temukan entity yang punya property X.”

Connection query:
  “Temukan entity yang terhubung lewat pola hubungan tertentu.”

Path query:
  “Temukan jalur koneksi yang menjelaskan kenapa entity A berhubungan dengan entity B.”

Network query:
  “Temukan struktur, komunitas, pusat pengaruh, atau anomali dalam keseluruhan graph.”
```

Graph database paling natural pada tiga kategori terakhir.

---

## 4. Graph Database Bukan Pengganti Universal SQL

Salah satu kesalahan paling mahal adalah memosisikan Neo4j sebagai pengganti semua relational database.

Neo4j bukan “PostgreSQL dengan garis-garis”.

Neo4j cocok untuk workload tertentu. PostgreSQL tetap sangat kuat untuk:

- transactional CRUD umum,
- strict relational integrity,
- complex tabular reporting,
- financial ledger,
- operational system of record,
- SQL ecosystem,
- mature relational tooling,
- normalized business entities,
- mixed OLTP queries yang tidak connection-heavy.

Graph database menjadi menarik ketika relational design mulai menghasilkan banyak gejala seperti:

1. Query utama terdiri dari join chain panjang yang berubah-ubah.
2. User bertanya “bagaimana X terkait dengan Y?”, bukan hanya “apa property X?”
3. Relationship punya properties penting.
4. Relationship bisa punya banyak jenis semantic.
5. Traversal depth tidak tetap.
6. Requirement sering berbentuk “within N hops”.
7. Harus menjelaskan path hasil keputusan.
8. Harus mendeteksi cluster, ring, cycle, centrality, similarity, atau hidden connection.
9. Data model lebih menyerupai network daripada tabel master-detail.
10. Menambah jenis hubungan baru lebih sering daripada menambah kolom baru.

Kalau gejala itu tidak ada, graph database mungkin hanya menambah kompleksitas.

---

## 5. Problem yang Biasanya Graph-Shaped

Berikut kategori problem yang sering secara natural cocok untuk graph database.

### 5.1 Fraud and Risk Network

Fraud jarang berdiri sendiri sebagai satu transaksi buruk. Sering kali pola fraud tersebar di banyak entity:

```text
Person -> Account -> Device -> IP -> Account -> Transaction -> Merchant
```

Atau:

```text
Company -> Director -> Company -> Address -> Company -> BankAccount
```

Pertanyaan yang muncul:

- Apakah account ini connected ke known fraud ring?
- Apakah banyak account memakai device yang sama?
- Apakah alamat ini menjadi hub untuk shell companies?
- Apakah subject investigasi punya indirect relationship ke sanctioned entity?
- Apakah ada circular ownership?

Graph database membantu karena fraud sering berupa **network behavior**, bukan single-row anomaly.

### 5.2 Recommendation and Personalization

Recommendation sering punya struktur:

```text
User -> purchased -> Product
User -> viewed -> Product
Product -> belongs_to -> Category
User -> similar_to -> User
Product -> similar_to -> Product
```

Pertanyaan:

- Product apa yang relevan karena user mirip membeli product itu?
- Item apa yang dekat secara graph, bukan hanya text/attribute?
- Kenapa recommendation ini muncul?

Graph dapat memberikan explainable recommendation:

```text
Recommended because:
You follow A -> A bought B -> B belongs to category C -> this item also belongs to C.
```

### 5.3 Identity and Access Management

IAM sering punya relasi nested:

```text
User -> Group -> Group -> Role -> Permission -> Resource
```

Pertanyaan:

- Apakah user X punya akses ke resource Y?
- Lewat path apa akses itu diwariskan?
- Permission apa yang terdampak jika group ini dihapus?
- Apakah ada toxic combination of duties?
- Siapa punya path akses tidak langsung ke production secret?

Graph cocok karena akses sering bukan direct mapping, melainkan inheritance path.

### 5.4 Dependency and Impact Analysis

Dalam software architecture:

```text
Service -> API -> Service -> Database -> Table -> Column
Service -> Library -> CVE
Job -> Topic -> Consumer -> Service
```

Pertanyaan:

- Jika library ini vulnerable, service apa saja terdampak?
- Jika schema field ini berubah, downstream consumer mana yang rusak?
- Jika topic Kafka ini berubah, proses bisnis apa yang terdampak?
- Service mana yang menjadi critical hub?

Graph membantu melakukan blast-radius analysis.

### 5.5 Knowledge Graph

Knowledge graph menghubungkan fakta, entity, konsep, definisi, evidence, dan provenance.

Contoh:

```text
Regulation -> defines -> Obligation
Obligation -> applies_to -> EntityType
Case -> alleges -> Violation
Violation -> violates -> Regulation
Evidence -> supports -> Allegation
Decision -> based_on -> Evidence
```

Pertanyaan:

- Evidence mana mendukung keputusan ini?
- Regulation apa yang relevan untuk case ini?
- Case lama apa yang mirip secara struktur argumentasi?
- Bagaimana perubahan aturan berdampak pada obligation dan workflow?

Graph cocok karena pengetahuan sering tersusun sebagai network of meaning.

### 5.6 Complex Case Management

Untuk enforcement lifecycle dan case management, graph bisa memodelkan:

- subject,
- allegation,
- evidence,
- event,
- case,
- officer,
- decision,
- action,
- regulation,
- risk indicator,
- related party,
- escalation,
- appeal,
- remediation.

Nilai graph bukan hanya menyimpan case. Nilainya adalah menemukan hubungan antar-case, subject, evidence, risk, dan decision.

---

## 6. Empat Mode Pemakaian Graph

Sebelum memilih Neo4j, pisahkan dulu mode pemakaiannya. Banyak kegagalan terjadi karena semua mode dicampur tanpa sadar.

### 6.1 Graph as Operational Database

Graph menjadi database utama untuk aplikasi operasional.

Contoh:

- IAM entitlement graph.
- Network inventory.
- Case relationship graph.
- Dependency graph.

Karakteristik:

- read/write transactional,
- low-latency query,
- correctness penting,
- index dan constraints penting,
- query critical path aplikasi,
- harus punya operational runbook.

Risiko:

- model salah menyebabkan query lambat,
- supernode,
- write contention,
- path query tidak bounded,
- security trimming sulit.

### 6.2 Graph as Projection / Read Model

Graph bukan source of truth, melainkan projection dari database/event lain.

Contoh:

```text
PostgreSQL sebagai source of truth.
Kafka events mengalir ke Neo4j.
Neo4j dipakai untuk connected query dan investigation UI.
```

Karakteristik:

- rebuildable,
- eventually consistent,
- lebih aman untuk eksperimen modelling,
- cocok untuk query yang sulit di source system.

Risiko:

- lag,
- duplicate ingestion,
- out-of-order events,
- reconciliation,
- siapa source of truth harus jelas.

### 6.3 Graph as Analytical Layer

Graph dipakai untuk graph algorithms:

- centrality,
- community detection,
- similarity,
- path finding,
- embeddings,
- link prediction.

Karakteristik:

- sering batch/offline,
- membutuhkan graph projection,
- hasil berupa score/cluster/embedding/recommendation,
- perlu evaluasi dan interpretasi.

Risiko:

- score dianggap fakta,
- bias data,
- community dianggap causality,
- hasil tidak explainable,
- stale analytics.

### 6.4 Graph as Knowledge / Semantic Layer

Graph dipakai untuk menghubungkan concept, entity, evidence, rules, metadata, dan meaning.

Karakteristik:

- semantic richness,
- provenance penting,
- human curation sering dibutuhkan,
- cocok untuk explainable decision support.

Risiko:

- ontology terlalu rumit,
- modelling menjadi academic exercise,
- inference tidak jelas batasnya,
- contradictory facts tidak ditangani.

---

## 7. Neo4j dalam Satu Peta Mental

Neo4j adalah platform graph yang berpusat pada property graph database.

Dokumentasi Neo4j menjelaskan bahwa Neo4j menggunakan **property graph database model**, dengan nodes sebagai discrete objects dan relationships yang menghubungkan nodes. Cypher adalah declarative query language Neo4j untuk property graph. Neo4j juga menyediakan Java Driver resmi untuk interaksi dari aplikasi Java, serta Graph Data Science Library untuk algoritma graph seperti centrality, community detection, similarity, path finding, embeddings, link prediction, dan Pregel API.

Peta sederhana:

```text
+--------------------------------------------------------------+
|                       Application Layer                      |
| Java / Spring Boot / Micronaut / Quarkus / Backend Services  |
+----------------------------+---------------------------------+
                             |
                             | Bolt / Java Driver / JDBC / HTTP
                             v
+--------------------------------------------------------------+
|                            Neo4j                             |
|                                                              |
|  Cypher Query Engine                                         |
|  - MATCH / WHERE / RETURN                                    |
|  - path pattern matching                                     |
|  - query planning / runtime                                  |
|                                                              |
|  Graph Storage                                               |
|  - nodes                                                     |
|  - relationships                                             |
|  - properties                                                |
|  - labels / relationship types                               |
|                                                              |
|  Schema & Indexes                                            |
|  - constraints                                               |
|  - range/text/full-text/point/vector indexes                 |
|                                                              |
|  Operations                                                  |
|  - transactions                                              |
|  - page cache / heap                                         |
|  - logs / backup / clustering                                |
|                                                              |
+----------------------------+---------------------------------+
                             |
                             v
+--------------------------------------------------------------+
|                     Graph Ecosystem                          |
| Browser / Bloom / APOC / GDS / Aura / Import Tools / GraphRAG|
+--------------------------------------------------------------+
```

Neo4j bukan hanya query engine. Dalam praktik, kamu akan memikirkan beberapa layer:

1. **Graph model**: bagaimana domain direpresentasikan.
2. **Cypher**: bagaimana pattern ditanyakan.
3. **Storage/runtime**: bagaimana traversal dieksekusi.
4. **Schema/index/constraint**: bagaimana lookup dan integrity dijaga.
5. **Driver/application**: bagaimana Java service berinteraksi.
6. **Operations**: bagaimana database berjalan di production.
7. **GDS/analytics**: bagaimana graph dipakai untuk scoring dan insight.
8. **Governance**: bagaimana data, evidence, security, dan audit dikontrol.

---

## 8. Property Graph: Model yang Dipakai Neo4j

Neo4j menggunakan property graph model. Elemen dasar:

```text
Node
Relationship
Label
Relationship Type
Property
Path
```

### 8.1 Node

Node adalah entity atau object dalam domain.

Contoh:

```text
(:Person)
(:Company)
(:Account)
(:Case)
(:Evidence)
(:Transaction)
(:Device)
(:Regulation)
```

Node dapat punya label lebih dari satu:

```text
(:Person:Officer)
(:Organization:RegulatedEntity)
(:Document:Evidence)
```

Label bukan inheritance penuh seperti OOP. Label lebih seperti classification/indexing/schema hint.

### 8.2 Relationship

Relationship adalah semantic connection antar-node.

Contoh:

```text
(:Person)-[:OWNS]->(:Company)
(:Account)-[:USED_DEVICE]->(:Device)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:User)-[:MEMBER_OF]->(:Group)
(:Service)-[:DEPENDS_ON]->(:Service)
```

Relationship di Neo4j memiliki direction. Direction tidak selalu berarti hubungan dunia nyata satu arah; sering kali direction dipilih untuk membuat query konsisten.

Contoh:

```text
(:Person)-[:OWNS]->(:Company)
```

Kamu tetap bisa query sebaliknya:

```cypher
MATCH (c:Company)<-[:OWNS]-(p:Person)
RETURN p, c
```

### 8.3 Property

Node dan relationship dapat punya property.

Contoh node property:

```text
(:Person {id: 'P-001', name: 'Ayu', riskLevel: 'HIGH'})
```

Contoh relationship property:

```text
(:Person)-[:OWNS {percentage: 70, since: date('2021-01-01')}]->(:Company)
```

Relationship property sangat penting ketika koneksi punya metadata sendiri:

- since,
- until,
- weight,
- confidence,
- source,
- role,
- percentage,
- amount,
- status.

### 8.4 Path

Path adalah sequence node dan relationship.

```text
A -[:R1]-> B -[:R2]-> C -[:R3]-> D
```

Di graph database, path sering menjadi hasil utama.

Contoh pertanyaan:

```text
Bagaimana A terhubung ke D?
```

Bukan hanya:

```text
Apakah A dan D terhubung?
```

Path penting untuk explainability.

---

## 9. Graph Database vs Relational Database: Bukan Sekadar Join vs Traversal

Perbandingan dangkal biasanya mengatakan:

```text
Relational database = join.
Graph database = traversal.
```

Itu tidak salah, tetapi kurang lengkap.

Perbedaan yang lebih penting:

| Dimensi | Relational | Graph |
|---|---|---|
| Unit utama | Table/relation | Node + relationship |
| Relationship | Biasanya foreign key/join table | First-class edge dengan type, direction, properties |
| Query utama | Predicate over rows + joins | Pattern matching + path traversal |
| Model kuat untuk | Structured records, transactions, reporting | Connected data, variable-depth relationships, network analysis |
| Schema | Strong tabular schema | Flexible graph schema + constraints/indexes |
| Explainability | Join result harus diinterpretasi | Path dapat menjadi explanation object |
| Evolusi relationship | Perlu schema/join table baru | Tambah relationship type/pattern |
| Risiko utama | Join complexity, migration rigidity | Supernode, traversal explosion, weak modelling discipline |

Relational database tetap bisa melakukan recursive CTE, graph-like query, closure table, adjacency list, nested set, materialized path, dan sebagainya. Tetapi ketika path query menjadi pusat sistem, bukan edge case, graph database bisa lebih natural.

### 9.1 Contoh Relational Thinking

```text
Aku punya customer, account, transaction, address.
Aku butuh tabel dan foreign key.
```

### 9.2 Contoh Graph Thinking

```text
Aku perlu memahami jaringan hubungan antar-person, account, device, address, company, transaction, case, dan evidence.
Pertanyaan utamanya adalah path, cluster, shared connection, dan indirect influence.
```

Perubahan cara pikir inilah inti seri ini.

---

## 10. Graph Database vs Document Database

Document database seperti MongoDB sangat baik untuk aggregate-shaped data:

```json
{
  "customerId": "C1",
  "name": "Ayu",
  "addresses": [...],
  "preferences": {...}
}
```

Document model cocok ketika:

- data sering dibaca sebagai satu aggregate,
- struktur nested natural,
- relationship luar aggregate tidak terlalu kompleks,
- query terutama berdasarkan property/document content,
- ownership data jelas.

Graph lebih cocok ketika:

- entity saling terhubung lintas aggregate,
- relationship berubah menjadi objek penting,
- perlu multi-hop traversal,
- perlu path explanation,
- query tidak berhenti di satu document boundary.

Contoh yang buruk untuk document-only:

```text
Satu Person punya banyak Address.
Address dipakai banyak Person.
Person punya Account.
Account pernah memakai Device.
Device dipakai Person lain.
Person lain terkait Company.
Company terkait Case.
```

Jika semuanya embedded document, kamu akan menghadapi:

- duplikasi,
- stale embedded data,
- sulit traversal,
- hard-to-explain connection,
- update propagation.

Graph tidak otomatis menggantikan document DB, tetapi dapat menjadi layer untuk relationship lintas aggregate.

---

## 11. Graph Database vs Search Engine

Search engine seperti Elasticsearch unggul untuk:

- full-text search,
- relevance scoring,
- inverted index,
- faceting,
- log/event search,
- text-heavy discovery,
- filtering document besar.

Graph database unggul untuk:

- connected search,
- relationship-aware filtering,
- path-based explanation,
- network neighborhood exploration,
- entity relationship discovery.

Contoh:

```text
Search engine:
Cari document yang mengandung “beneficial ownership”.

Graph database:
Cari company yang beneficial owner-nya terhubung ke sanctioned entity melalui chain ownership <= 4 hop.
```

Keduanya sering digabung:

```text
Elasticsearch menemukan candidate document/entity berdasarkan text.
Neo4j menelusuri hubungan candidate tersebut.
```

Atau:

```text
Neo4j menemukan connected entities.
Elasticsearch mencari evidence/document terkait entity tersebut.
```

---

## 12. Graph Database vs OLAP Columnar Store

OLAP database seperti ClickHouse sangat kuat untuk:

- aggregation skala besar,
- scan banyak row,
- time-window analytics,
- metric computation,
- group by / rollup,
- dashboard.

Graph database bukan pengganti OLAP.

Contoh OLAP:

```text
Hitung total transaksi per merchant per hari selama 2 tahun.
```

Contoh graph:

```text
Cari merchant yang berada dalam komunitas account-device-address mencurigakan,
lalu jelaskan path antar-account dalam komunitas tersebut.
```

OLAP bertanya:

```text
Berapa banyak?
Distribusinya bagaimana?
Trend-nya apa?
```

Graph bertanya:

```text
Terhubung lewat apa?
Seberapa dekat?
Siapa hub-nya?
Ada cluster apa?
Path mana yang menjelaskan?
```

Dalam arsitektur matang, graph dan OLAP bisa berdampingan:

```text
Neo4j menghasilkan cluster/risk relationship.
ClickHouse menghitung agregat transaksi dan statistik time-series.
Aplikasi menggabungkan insight keduanya.
```

---

## 13. Graph Database vs Cache / Key-Value Store

Redis atau key-value store sangat baik untuk:

- low-latency lookup,
- session,
- cache,
- counters,
- queues sederhana,
- ephemeral state.

Graph database bukan cache.

Jika kamu hanya butuh:

```text
get user permissions by userId
```

dan permission sudah diprecompute, Redis mungkin lebih cocok.

Tetapi jika kamu butuh:

```text
Jelaskan kenapa user ini punya permission itu,
lewat group/role/policy path apa,
dan apakah path itu melanggar segregation of duties.
```

Graph menjadi lebih relevan.

Pola umum:

```text
Neo4j = source/query engine untuk relationship reasoning.
Redis = cache hasil entitlement yang sering dibaca.
```

---

## 14. Graph Database vs Event Streaming

Kafka/RabbitMQ menyelesaikan problem movement of data/events.
Neo4j menyelesaikan problem connected state/query.

Event streaming:

```text
OrderCreated
PaymentAuthorized
AccountLinked
DeviceObserved
CaseEscalated
```

Graph projection:

```text
(:Account)-[:USED_DEVICE]->(:Device)
(:Case)-[:ESCALATED_TO]->(:Team)
(:Person)-[:CONTROLS]->(:Company)
```

Sering kali graph dibangun dari event stream:

```text
Events -> projector -> Neo4j graph -> investigation/search/recommendation UI
```

Tetapi Neo4j bukan event broker.

Kesalahan desain:

```text
Memakai Neo4j untuk menyimpan semua event mentah sebagai graph event log.
```

Bisa dilakukan untuk kebutuhan tertentu, tetapi sering buruk jika:

- event volume sangat besar,
- query utama adalah time-series scan,
- event tidak perlu relationship traversal,
- retention tinggi,
- graph dipenuhi node event granular tanpa query value.

Lebih baik:

```text
Kafka/object storage/OLAP menyimpan event log.
Neo4j menyimpan projected relationship state yang berguna untuk traversal.
```

---

## 15. Graph Database sebagai Decision Support, Bukan Magic AI

Graph sering dipasarkan untuk fraud detection, recommendation, knowledge graph, GraphRAG, dan AI. Ini benar, tapi harus hati-hati.

Graph tidak otomatis memberi jawaban benar. Graph hanya membuat hubungan eksplisit dan dapat ditelusuri.

Misalnya:

```text
A connected to B through device D.
```

Itu bukan bukti fraud. Itu signal.

```text
Company X indirectly owns Company Y through 3 intermediaries.
```

Itu bukan otomatis violation. Itu fact/path yang perlu rule/context.

```text
User U has high centrality.
```

Itu bukan otomatis risk. Itu ranking berdasarkan struktur graph.

Mental model yang defensible:

```text
Graph gives connection evidence.
Rules interpret connection.
Humans or systems decide action.
Audit explains why.
```

Untuk sistem regulatory/enforcement, ini sangat penting. Graph harus memperkuat explainability, bukan membuat black box baru.

---

## 16. Kapan Neo4j Cocok

Neo4j sangat layak dipertimbangkan jika banyak pertanyaan seperti ini:

### 16.1 Multi-hop Relationship Query

```text
Cari semua entity yang terhubung ke X dalam 1-4 hop melalui relationship tertentu.
```

### 16.2 Path Explanation

```text
Kenapa A dianggap related dengan B? Tunjukkan jalurnya.
```

### 16.3 Network Discovery

```text
Temukan cluster/ring/community di antara entity ini.
```

### 16.4 Relationship-Rich Domain

```text
Relationship punya type, direction, timestamp, status, confidence, evidence.
```

### 16.5 Evolving Relationship Semantics

```text
Jenis hubungan baru sering bertambah.
```

### 16.6 Variable Depth

```text
Kita tidak tahu berapa join yang dibutuhkan; bisa 2 hop, bisa 5 hop.
```

### 16.7 Graph Algorithms

```text
Butuh centrality, community detection, similarity, link prediction, embeddings, path finding.
```

### 16.8 Explainable Investigation UI

```text
User perlu melihat graph dan menelusuri koneksi secara interaktif.
```

---

## 17. Kapan Neo4j Tidak Cocok

Neo4j belum tentu cocok jika:

### 17.1 Workload Utama CRUD Sederhana

```text
Create order, update order status, list orders by customer.
```

Relational/document database biasanya lebih sederhana.

### 17.2 Workload Utama Aggregation Besar

```text
Hitung revenue per minute untuk 5 miliar transaksi.
```

OLAP/time-series database lebih cocok.

### 17.3 Workload Utama Text Search

```text
Cari document berdasarkan keyword/relevance/ranking.
```

Search engine lebih cocok.

### 17.4 Relationship Tidak Punya Makna Query

Kalau relationship hanya referential, tidak sering ditelusuri, dan tidak punya semantic penting, graph mungkin overkill.

### 17.5 Semua Query Sudah Fixed dan Dangkal

Jika semua access pattern sudah jelas, fixed-depth, dan mudah dioptimalkan di SQL, Neo4j mungkin tidak memberi banyak nilai.

### 17.6 Tim Tidak Siap Berpikir Graph

Graph database gagal bukan hanya karena teknologi, tetapi karena model mental tim masih table/document-centric.

Gejala:

- semua node diberi label seperti nama tabel,
- semua relationship generic `RELATED_TO`,
- semua property ditaruh di node tanpa semantic edge,
- query memakai graph seperti join biasa,
- tidak ada boundary traversal,
- tidak ada constraint/index discipline.

---

## 18. Pertanyaan Paling Penting Sebelum Memilih Graph

Sebelum memilih Neo4j, jawab pertanyaan ini:

### 18.1 Apa query yang harus murah?

Jangan mulai dari entity. Mulai dari pertanyaan.

Buruk:

```text
Kita punya Person, Company, Account. Mari simpan di graph.
```

Baik:

```text
Kita harus sering menjawab:
- Apakah Person ini indirectly controls Company itu?
- Lewat path apa?
- Apakah path itu melewati sanctioned entity?
- Apakah ada circular ownership?
- Siapa entity paling sentral di network ini?
```

### 18.2 Apakah path adalah hasil bisnis?

Jika path hanya detail implementasi, graph belum tentu penting.
Jika path adalah evidence/explanation, graph sangat relevan.

### 18.3 Seberapa dalam traversal?

Depth 1-2 mungkin bisa di SQL dengan join biasa.
Depth variable 1-6 dengan relationship filters mulai graph-shaped.

### 18.4 Apakah relationship punya property dan lifecycle?

Jika relationship punya:

- `since`,
- `until`,
- `confidence`,
- `source`,
- `status`,
- `weight`,
- `role`,
- `percentage`,

maka relationship kemungkinan first-class.

### 18.5 Apakah graph bisa menjadi projection?

Tidak semua sistem harus menjadikan Neo4j source of truth. Banyak desain matang memakai Neo4j sebagai read model/projection.

### 18.6 Apa failure mode-nya?

Graph query bisa meledak secara combinatorial. Kamu harus tahu batas:

- max depth,
- allowed relationship types,
- fan-out limit,
- pagination strategy,
- timeout,
- supernode handling.

---

## 19. Mental Model “Controlled Expansion”

Graph query pada dasarnya adalah expansion.

Contoh:

```cypher
MATCH (a:Account {id: $id})-[:USED_DEVICE]->(d:Device)<-[:USED_DEVICE]-(other:Account)
RETURN other
```

Query ini:

1. menemukan account awal,
2. expand ke device,
3. expand balik ke account lain.

Masalah muncul jika expansion tidak dikontrol.

Contoh berbahaya:

```cypher
MATCH path = (a:Account {id: $id})-[*]-(x)
RETURN path
```

Ini bertanya:

```text
Dari account ini, jelajahi semua relationship type, semua direction, semua depth tidak terbatas.
```

Dalam graph besar, ini bisa menjadi bencana.

Prinsip:

```text
Graph query performance is controlled expansion.
```

Kontrol dilakukan melalui:

- anchor node yang selektif,
- index/constraint,
- relationship type spesifik,
- direction spesifik,
- bounded depth,
- predicate sedini mungkin,
- limiting fan-out,
- menghindari supernode,
- query profiling,
- precomputed/materialized relationship bila perlu.

---

## 20. Cypher dalam Perspektif Awal

Cypher adalah declarative query language Neo4j untuk property graph.

Contoh sederhana:

```cypher
MATCH (p:Person)-[:OWNS]->(c:Company)
WHERE p.id = $personId
RETURN p, c
```

Baca bukan sebagai join, tetapi sebagai pattern:

```text
Temukan pola Person yang OWNS Company,
dengan person id tertentu,
lalu return person dan company.
```

Contoh path:

```cypher
MATCH path = (p:Person {id: $personId})-[:OWNS|CONTROLS*1..4]->(c:Company)
RETURN path
```

Artinya:

```text
Temukan path dari Person ke Company
melalui relationship OWNS atau CONTROLS
dengan panjang 1 sampai 4.
```

Cypher terlihat mudah, tetapi bahaya utamanya adalah query yang terlalu ekspansif.

Part berikutnya akan membahas graph thinking sebelum masuk Cypher detail.

---

## 21. GQL dan Kenapa Ini Penting

GQL adalah standar ISO untuk query property graph. Neo4j Cypher memiliki hubungan erat dengan GQL karena banyak konstruksi GQL mengadopsi semantics dari Cypher, termasuk gaya `MATCH/RETURN`.

Untuk engineer, implikasinya:

1. Graph query language semakin distandarkan.
2. Cypher bukan sekadar DSL vendor kecil.
3. Skill pattern matching graph akan makin transferable.
4. Tetap ada perbedaan implementasi antar-engine.
5. Jangan belajar hanya syntax; pelajari semantics pattern/path.

Dalam seri ini, kita akan memakai Cypher sebagai bahasa kerja karena Neo4j adalah fokus utama, tetapi mental model pattern matching akan berguna lebih luas.

---

## 22. Java Engineer Perspective

Sebagai Java engineer, ada beberapa jebakan khusus.

### 22.1 Jangan Perlakukan Neo4j seperti ORM Object Graph

Object graph di memory berbeda dari database graph.

Di Java:

```java
class Person {
    List<Company> companies;
}
```

Ini object relationship.

Di Neo4j:

```text
(:Person)-[:OWNS]->(:Company)
```

Ini queryable semantic relationship.

Kesalahan umum:

- mapping semua node ke entity class besar,
- load seluruh neighborhood ke memory,
- membuat graph traversal implicit di object mapping,
- kehilangan kontrol query,
- menghasilkan N+1 style graph loading.

Graph database harus diakses dengan query yang sadar access pattern.

### 22.2 Repository Pattern Harus Query-Oriented

Repository graph yang baik bukan hanya:

```java
personRepository.findById(id)
```

Tetapi:

```java
ownershipRepository.findControlPaths(personId, maxDepth)
fraudRepository.findRelatedAccounts(accountId, riskTypes, maxHops)
entitlementRepository.explainAccess(userId, resourceId)
caseGraphRepository.findConnectedCases(caseId, relationshipTypes)
```

Graph repository harus merepresentasikan domain question.

### 22.3 Transaction Retry Penting

Neo4j Java Driver menyediakan mekanisme transaction function dan retry untuk transient errors. Dalam graph write workload, concurrent relationship creation, constraint conflict, dan lock contention perlu dipikirkan sejak awal.

### 22.4 Jangan Return Graph Terlalu Besar ke API

API response harus bounded.

Buruk:

```text
GET /accounts/{id}/graph
return all connected nodes
```

Baik:

```text
GET /accounts/{id}/risk-neighborhood?depth=2&relationshipTypes=USED_DEVICE,SHARES_ADDRESS&limit=200
```

Atau:

```text
POST /graph/query/explain-connection
body: sourceId, targetId, maxDepth, allowedRelationshipTypes
```

Graph API harus eksplisit soal boundary.

---

## 23. Neo4j Ecosystem yang Akan Dibahas di Seri Ini

### 23.1 Neo4j Database

Core graph database: storage, transaction, query, schema, indexes.

### 23.2 Cypher

Declarative graph query language.

### 23.3 Java Driver

Official driver untuk Java apps via Bolt.

### 23.4 Spring Data Neo4j

Abstraction untuk Spring apps. Berguna, tetapi harus dipakai hati-hati.

### 23.5 APOC

Library utility/procedure untuk import, export, refactoring, path expansion, metadata, dan banyak operasi tambahan.

### 23.6 Graph Data Science

Library untuk algoritma graph:

- centrality,
- community detection,
- similarity,
- path finding,
- node embeddings,
- link prediction,
- Pregel API.

### 23.7 Vector Index and GraphRAG

Neo4j modern mendukung vector indexes untuk similarity search. Ini membuka pola hybrid:

```text
semantic search + graph traversal + structured constraints
```

Tetapi GraphRAG bukan magic. Ini akan dibahas sebagai arsitektur yang perlu evaluasi dan governance.

### 23.8 Aura / Deployment / Operations

Neo4j dapat dijalankan self-managed atau managed/cloud. Dalam seri ini kita akan membahas operasi dari sisi engineering, bukan sekadar klik deployment.

---

## 24. Contoh Domain: Regulatory Enforcement Graph

Agar orientasi lebih konkret, bayangkan sistem enforcement lifecycle.

### 24.1 Entity Awal

```text
Person
Organization
Account
Case
Allegation
Evidence
Regulation
Officer
Decision
Action
Transaction
Device
Address
Document
```

### 24.2 Relationship Awal

```text
(:Person)-[:OWNS]->(:Organization)
(:Person)-[:DIRECTOR_OF]->(:Organization)
(:Organization)-[:HAS_ACCOUNT]->(:Account)
(:Account)-[:MADE_TRANSACTION]->(:Transaction)
(:Transaction)-[:TO]->(:Account)
(:Account)-[:USED_DEVICE]->(:Device)
(:Organization)-[:REGISTERED_AT]->(:Address)
(:Case)-[:SUBJECT_OF]->(:Organization)
(:Case)-[:HAS_ALLEGATION]->(:Allegation)
(:Evidence)-[:SUPPORTS]->(:Allegation)
(:Allegation)-[:VIOLATES]->(:Regulation)
(:Decision)-[:BASED_ON]->(:Evidence)
(:Officer)-[:REVIEWED]->(:Case)
(:Case)-[:RELATED_TO]->(:Case)
```

### 24.3 Pertanyaan Graph

```text
Apakah subject dalam case ini terkait dengan subject case lain?
Lewat hubungan apa?
```

```text
Apakah ada beneficial owner tersembunyi?
```

```text
Apakah evidence yang sama muncul di beberapa allegation?
```

```text
Apakah officer pernah menangani case yang punya conflict relationship dengan subject?
```

```text
Jika regulation berubah, case/decision/action apa yang terdampak?
```

```text
Entity mana yang menjadi hub dari banyak suspicious relationships?
```

Ini bukan sekadar CRUD. Ini relationship reasoning.

---

## 25. Contoh Query Thinking Tanpa Masuk Terlalu Dalam

### 25.1 Related Cases

```cypher
MATCH path = (c1:Case {id: $caseId})-[:SUBJECT_OF|HAS_ALLEGATION|SUPPORTED_BY|RELATED_TO*1..3]-(c2:Case)
WHERE c1 <> c2
RETURN path
LIMIT 50
```

Ini masih kasar dan akan dituning di part berikutnya. Tetapi idenya:

```text
Dari satu case, jelajahi relationship tertentu hingga depth 3 untuk menemukan case lain.
```

### 25.2 Shared Device Fraud Signal

```cypher
MATCH (a1:Account {id: $accountId})-[:USED_DEVICE]->(d:Device)<-[:USED_DEVICE]-(a2:Account)
WHERE a1 <> a2
RETURN d, collect(a2) AS relatedAccounts
```

### 25.3 Ownership Path

```cypher
MATCH path = (:Person {id: $personId})-[:OWNS|CONTROLS*1..5]->(:Organization {id: $orgId})
RETURN path
```

### 25.4 Access Explanation

```cypher
MATCH path = (:User {id: $userId})-[:MEMBER_OF|HAS_ROLE|GRANTS*1..6]->(:Resource {id: $resourceId})
RETURN path
```

Perhatikan semua query punya ciri:

- start node jelas,
- relationship type dibatasi,
- depth dibatasi,
- path adalah output penting,
- query menjawab pertanyaan domain.

---

## 26. Graph Modelling: Kesalahan Awal yang Harus Dihindari

### 26.1 Generic Relationship

Buruk:

```text
(:Person)-[:RELATED_TO]->(:Company)
(:Company)-[:RELATED_TO]->(:Address)
(:Case)-[:RELATED_TO]->(:Evidence)
```

Masalah:

- relationship kehilangan makna,
- query harus filter property,
- model tidak self-explanatory,
- sulit governance,
- traversal terlalu luas.

Lebih baik:

```text
(:Person)-[:OWNS]->(:Company)
(:Company)-[:REGISTERED_AT]->(:Address)
(:Evidence)-[:SUPPORTS]->(:Allegation)
```

### 26.2 Menjadikan Semua Hal sebagai Node

Tidak semua attribute harus jadi node.

Contoh:

```text
RiskLevel = HIGH
```

Bisa menjadi property:

```text
(:Person {riskLevel: 'HIGH'})
```

Tidak perlu selalu:

```text
(:Person)-[:HAS_RISK_LEVEL]->(:RiskLevel {value:'HIGH'})
```

Kecuali `RiskLevel` punya lifecycle/metadata/rules/relationship sendiri.

### 26.3 Menaruh Relationship Penting sebagai Property

Buruk:

```text
(:Person {companyIds: ['C1', 'C2']})
```

Lebih baik:

```text
(:Person)-[:OWNS]->(:Company)
```

Jika kamu perlu traverse, relationship harus menjadi relationship.

### 26.4 Tidak Membatasi Traversal

Buruk:

```cypher
MATCH p = (n)-[*]-(m)
RETURN p
```

Lebih baik:

```cypher
MATCH p = (n:Account {id: $id})-[:USED_DEVICE|SHARES_ADDRESS*1..3]-(m)
RETURN p
LIMIT 100
```

### 26.5 Mengabaikan Supernode

Contoh supernode:

```text
(:Country {name:'Indonesia'})
(:Category {name:'General'})
(:Device {id:'unknown'})
(:Address {value:'N/A'})
```

Jika jutaan node terhubung ke satu node seperti `unknown`, traversal bisa kacau.

---

## 27. Apa yang Membuat Engineer Top 1% dalam Graph Database

Bukan hafal semua syntax Cypher.

Engineer yang sangat kuat di graph database biasanya punya kemampuan berikut:

### 27.1 Bisa Mengenali Graph-Shaped Problem

Tidak semua problem dipaksa jadi graph.

### 27.2 Bisa Mendesain Relationship Semantics

Mereka tahu kapan memakai:

- relationship type,
- relationship property,
- intermediate node,
- derived relationship,
- temporal relationship,
- evidence node,
- score property.

### 27.3 Bisa Mengontrol Traversal

Mereka tahu query graph bisa meledak dan mendesain boundary.

### 27.4 Bisa Membaca Query Plan

Mereka tidak hanya menulis Cypher, tapi memakai `EXPLAIN` dan `PROFILE`.

### 27.5 Bisa Mendesain untuk Correctness

Mereka memakai constraints, idempotency, transaction retry, dan invariant checking.

### 27.6 Bisa Memisahkan Operational Graph dan Analytical Graph

Mereka tidak mencampur query critical path dengan eksperimen algoritma berat tanpa batas.

### 27.7 Bisa Mengoperasikan Neo4j

Mereka paham heap, page cache, backup, logs, monitoring, cluster, dan driver routing.

### 27.8 Bisa Menjelaskan Trade-Off

Mereka bisa berkata:

```text
Neo4j cocok untuk bagian relationship reasoning ini,
tetapi source-of-truth tetap PostgreSQL,
search tetap Elasticsearch,
aggregation tetap ClickHouse,
dan event flow tetap Kafka.
```

### 27.9 Bisa Membuat Graph Defensible

Untuk domain audit/regulatory, mereka bisa menjelaskan:

- path evidence,
- provenance,
- timestamp validity,
- decision trace,
- why a relationship exists,
- who asserted it,
- when it changed,
- what rule consumed it.

---

## 28. Architecture Decision Framework

Gunakan framework ini sebelum memilih Neo4j.

### 28.1 Workload Fit

| Pertanyaan | Jika jawabannya ya |
|---|---|
| Apakah query utama multi-hop? | Graph layak dipertimbangkan |
| Apakah path adalah business output? | Graph sangat relevan |
| Apakah relationship punya properties/lifecycle? | Graph makin relevan |
| Apakah butuh community/centrality/similarity/path algorithms? | Neo4j + GDS relevan |
| Apakah hanya CRUD dan reporting? | Graph mungkin overkill |
| Apakah query utama full-text? | Search engine lebih cocok |
| Apakah query utama aggregation besar? | OLAP lebih cocok |

### 28.2 Data Ownership

Pilih salah satu:

```text
Neo4j as source of truth
Neo4j as read model/projection
Neo4j as analytical workspace
Neo4j as knowledge layer
```

Jangan kabur.

### 28.3 Consistency Need

```text
Strong transactional graph?
Eventually consistent projection?
Batch analytical graph?
Human-curated knowledge graph?
```

### 28.4 Latency and Scale

Tentukan:

- query latency target,
- max graph depth,
- expected degree distribution,
- write rate,
- data volume,
- number of concurrent users,
- graph algorithm schedule,
- cache strategy.

### 28.5 Failure Mode

Identifikasi sejak awal:

- supernode,
- duplicate node,
- relationship explosion,
- stale projection,
- path ambiguity,
- access leakage,
- query timeout,
- cluster failover,
- inconsistent source-of-truth sync.

---

## 29. Neo4j Learning Roadmap untuk Seri Ini

Part ini adalah orientasi. Sisa seri akan bergerak seperti ini:

```text
Foundation:
000 Orientation
001 Graph Thinking
002 Property Graph Model
003 Neo4j Architecture

Query:
004 Cypher Fundamentals
005 Path Semantics

Modelling:
006 Methodology
007 Advanced Patterns
008 Anti-Patterns
009 Schema/Constraints/Indexes
010 Writes/Idempotency/Concurrency

Performance:
011 Query Performance
012 Supernodes/Traversal Explosion

Java + Production:
013 Java Integration
014 Spring Data Neo4j
015 Import/ETL/CDC
016 Transactions/Correctness
017 Operations
018 Clustering
019 Security/Multi-tenancy/Audit
020 APOC/Tooling

Graph Analytics:
021 GDS Fundamentals
022 Centrality
023 Community/Similarity/Link Prediction
024 Path Algorithms
025 Embeddings/Vector/GraphRAG
026 Knowledge Graph

Case Studies + Architecture:
027 Fraud/Risk/Enforcement
028 Recommendation
029 IAM/Entitlement
030 Testing/Migration/Evolution
031 Comparative Architecture
032 Capstone
```

Seri selesai di Part 032.

Part 000 ini **belum bagian terakhir**.

---

## 30. Checklist: Apakah Problem Kamu Graph-Shaped?

Gunakan checklist ini:

```text
[ ] Query utama bertanya tentang koneksi, bukan hanya attribute.
[ ] Relationship punya meaning bisnis yang eksplisit.
[ ] Relationship punya properties/lifecycle/evidence.
[ ] Path perlu ditampilkan sebagai explanation.
[ ] Traversal depth bisa variable.
[ ] Ada kebutuhan multi-hop discovery.
[ ] Ada kebutuhan cluster/community/ring detection.
[ ] Ada kebutuhan centrality/influence/importance scoring.
[ ] Ada kebutuhan impact analysis/blast radius.
[ ] Ada kebutuhan entity resolution/related-party detection.
[ ] Model relational menghasilkan join chain kompleks yang sering berubah.
[ ] Menambah jenis relationship lebih natural daripada menambah tabel/kolom.
[ ] Query harus mengeksplor neighborhood dari node tertentu.
[ ] Ada kebutuhan graph visualization/investigation workflow.
[ ] Ada batas traversal yang bisa didefinisikan secara aman.
```

Jika banyak yang tercentang, graph database layak dipertimbangkan.

Jika hanya 1-2 yang tercentang, hati-hati. Bisa jadi relational/document/search sudah cukup.

---

## 31. Ringkasan Mental Model

Simpan ringkasan ini:

```text
Graph database is not about storing data with relationships.
It is about making relationships, paths, and network structure queryable, explainable, and evolvable.
```

```text
Neo4j is useful when the business question is connection-first:
- how is A related to B?
- through what path?
- within how many hops?
- via what relationship types?
- with what evidence?
- what cluster does this belong to?
- what is the impact if this node changes?
```

```text
The core performance discipline is controlled expansion.
The core modelling discipline is semantic relationship design.
The core architecture discipline is deciding whether Neo4j is source-of-truth, projection, analytical layer, or knowledge layer.
```

```text
Do not graph everything.
Graph the parts where connection is the product.
```

---

## 32. Latihan Pemahaman

Jawab tanpa coding dulu.

### Latihan 1 — Klasifikasi Problem

Untuk setiap requirement berikut, tentukan apakah lebih cocok relational, document, search, OLAP, cache, stream, graph, atau kombinasi.

1. Menampilkan order detail customer.
2. Mencari semua dokumen yang mengandung phrase “beneficial ownership”.
3. Menghitung total transaksi per merchant per jam.
4. Menemukan account yang terhubung ke fraud account melalui device/address/IP maksimal 3 hop.
5. Menjelaskan kenapa user memiliki akses ke production database.
6. Menyimpan session login user.
7. Mengirim event `CaseEscalated` ke downstream systems.
8. Menemukan case lain yang berbagi subject, evidence, officer, atau related party.
9. Mendeteksi community dari account yang saling bertransaksi.
10. Menampilkan profile customer berdasarkan customer ID.

### Latihan 2 — Relationship Meaning

Ambil domain regulatory case management.

Ubah relationship generic ini:

```text
(:Case)-[:RELATED_TO]->(:Person)
(:Case)-[:RELATED_TO]->(:Document)
(:Person)-[:RELATED_TO]->(:Company)
```

Menjadi relationship yang lebih semantic.

Contoh arah:

```text
(:Case)-[:HAS_SUBJECT]->(:Person)
(:Evidence)-[:SUPPORTS]->(:Allegation)
(:Person)-[:DIRECTOR_OF]->(:Company)
```

### Latihan 3 — Boundary Traversal

Requirement:

```text
Cari semua account yang related dengan account A.
```

Pertanyaan:

1. Relationship type apa saja yang diizinkan?
2. Max depth berapa?
3. Apakah direction penting?
4. Apakah account dormant dihitung?
5. Apakah node `unknown device` harus dikecualikan?
6. Berapa limit hasil?
7. Apakah path harus dikembalikan?
8. Apakah hasil harus diberi risk score?

Tujuan latihan ini: memahami bahwa graph query harus dibatasi oleh semantics, bukan hanya syntax.

---

## 33. Referensi Resmi dan Bacaan Lanjut

Referensi yang digunakan untuk orientasi part ini:

1. Neo4j Documentation — Get Started with Neo4j  
   https://neo4j.com/docs/getting-started/

2. Neo4j Documentation — Graph Database Concepts  
   https://neo4j.com/docs/getting-started/appendix/graphdb-concepts/

3. Neo4j Cypher Manual — Introduction  
   https://neo4j.com/docs/cypher-manual/current/introduction/

4. Neo4j Cypher Manual — GQL Conformance  
   https://neo4j.com/docs/cypher-manual/current/appendix/gql-conformance/

5. Neo4j Java Driver Manual  
   https://neo4j.com/docs/java-manual/current/

6. Neo4j Graph Data Science Manual  
   https://neo4j.com/docs/graph-data-science/current/

7. Neo4j Graph Data Science Algorithms  
   https://neo4j.com/docs/graph-data-science/current/algorithms/

8. Neo4j Cypher Manual — Vector Indexes  
   https://neo4j.com/docs/cypher-manual/current/indexes/semantic-indexes/vector-indexes/

9. Spring Data Neo4j Project  
   https://spring.io/projects/spring-data-neo4j

---

## 34. Penutup Part 000

Part ini sengaja tidak langsung masuk terlalu dalam ke syntax karena syntax tanpa mental model akan membuat graph database tampak seperti variasi lain dari SQL join.

Inti Part 000:

```text
Neo4j dipilih bukan karena data punya relasi.
Neo4j dipilih ketika relasi, path, dan struktur jaringan adalah pusat pertanyaan bisnis.
```

Part berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-001.md
```

Topik:

```text
Graph Thinking: From Entities to Relationships to Paths
```

Kita akan membangun cara berpikir graph-native secara lebih formal: node, relationship, path, walk, trail, cycle, degree, density, neighborhood, connected component, fan-out, traversal boundary, dan bagaimana membaca user requirement sebagai graph question.

---

## Status Seri

```text
Part 000 selesai.
Seri belum selesai.
Masih ada Part 001 sampai Part 032.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-001.md">Part 001 — Graph Thinking: From Entities to Relationships to Paths ➡️</a>
</div>
