# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-009.md

# Part 009 — Schema, Constraints, Indexes, and Data Integrity in Neo4j

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Bagian: `009`  
> Topik: Schema, Constraints, Indexes, and Data Integrity in Neo4j  
> Target pembaca: Java software engineer / tech lead yang ingin mendesain Neo4j secara production-grade  
> Fokus: integrity contract, query access path, idempotent ingestion, constraint-backed correctness, dan index-aware graph design

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 008, kita sudah membangun fondasi:

1. kenapa graph database ada,
2. bagaimana berpikir dengan node, relationship, dan path,
3. bagaimana property graph bekerja,
4. bagaimana Cypher melakukan pattern matching,
5. bagaimana path traversal bisa menjadi kekuatan sekaligus sumber ledakan performa,
6. bagaimana modelling graph dilakukan dari requirement,
7. pola modelling lanjutan,
8. anti-pattern yang harus dihindari.

Part 009 masuk ke tema yang sering disalahpahami:

> “Graph database itu flexible, berarti tidak butuh schema.”

Ini salah.

Neo4j memang tidak memaksa schema seperti relational database tradisional. Anda bisa membuat node dengan label berbeda, relationship type berbeda, dan properties yang tidak seragam. Tetapi sistem production tetap membutuhkan **data contract**. Bedanya, schema di graph database tidak hanya berbicara tentang bentuk row atau document; schema juga berbicara tentang:

- entity identity,
- relationship semantics,
- query entry point,
- uniqueness,
- property existence,
- type safety,
- traversal boundary,
- integrity invariant,
- ingestion idempotency,
- access control boundary,
- auditability,
- dan operability.

Dalam Neo4j, sebagian kontrak itu ditegakkan oleh **constraints**, sebagian dibantu oleh **indexes**, dan sebagian harus ditegakkan oleh desain aplikasi Java dan proses data governance.

Part ini adalah jembatan antara modelling dan production correctness.

---

## 1. Mental Model Utama: Graph Schema Bukan Tabel, Tapi Kontrak Navigasi

Di SQL, schema biasanya dibayangkan sebagai:

```sql
CREATE TABLE customer (
  id BIGINT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP NOT NULL
);
```

Kontrak utamanya:

- tabel apa yang ada,
- kolom apa yang ada,
- tipe data apa,
- primary key apa,
- foreign key apa,
- nullable atau tidak,
- index apa.

Di Neo4j, kontrak tidak cukup hanya mengatakan:

```cypher
(:Customer {id, email, createdAt})
```

Karena graph workload bergantung pada **cara traversal dimulai dan dilanjutkan**.

Contoh model:

```text
(:Customer {customerId})-[:OWNS]->(:Account {accountId})
(:Account)-[:TRANSFERRED_TO {amount, at}]->(:Account)
(:Customer)-[:SUBJECT_OF]->(:Case {caseId})
(:Case)-[:SUPPORTED_BY]->(:Evidence {evidenceId})
```

Schema graph production harus menjawab:

1. Apakah `Customer.customerId` unik?
2. Apakah `Account.accountId` unik?
3. Apakah setiap `TRANSFERRED_TO` harus punya `amount` dan `at`?
4. Apakah `amount` harus numeric?
5. Apakah setiap `Case` harus punya `caseId`, `status`, dan `openedAt`?
6. Apakah `customerId` external identity atau internal surrogate?
7. Query biasanya mulai dari `Customer`, `Account`, `Case`, atau `Evidence`?
8. Relationship mana yang boleh high-degree?
9. Relationship mana yang harus historis dan tidak boleh di-update destructive?
10. Apakah relationship tertentu boleh duplicate?
11. Apakah node boleh multi-label?
12. Apakah tenant isolation ada di label, property, database, atau cluster?

Jadi schema graph bukan hanya “shape of data”. Ia adalah:

> **kontrak tentang entity identity, relationship meaning, query entry points, dan invariant yang harus tetap benar ketika graph berubah.**

---

## 2. Flexible Does Not Mean Undisciplined

Neo4j sering dipakai karena schema-nya fleksibel. Fleksibilitas ini sangat berguna ketika:

- domain masih berkembang,
- relationship baru sering muncul,
- entity type belum stabil,
- exploratory investigation dibutuhkan,
- knowledge graph tumbuh bertahap,
- data datang dari banyak source,
- sistem perlu menyimpan fakta dengan provenance berbeda.

Tetapi fleksibilitas tanpa discipline menghasilkan graph yang sulit dipercaya:

```text
(:Person {id: "P1", name: "Ari"})
(:Person {person_id: "P1", fullName: "Ari"})
(:User {id: "P1", name: "Ari"})
(:Customer {externalId: "P1"})
```

Semua mungkin merepresentasikan orang yang sama, tapi karena kontrak tidak jelas, query menjadi rapuh.

Contoh query yang terlihat benar:

```cypher
MATCH (p:Person {id: $personId})-[:OWNS]->(a:Account)
RETURN a
```

Masalahnya:

- sebagian data memakai `person_id`, bukan `id`,
- sebagian orang dimodelkan sebagai `Customer`, bukan `Person`,
- sebagian relationship memakai `:HAS_ACCOUNT`, bukan `:OWNS`,
- sebagian account tidak punya `accountId`,
- sebagian account duplicate karena ingestion tidak idempotent.

Hasilnya bukan hanya lambat. Lebih buruk: **salah secara diam-diam**.

Di sistem compliance, enforcement, fraud, IAM, atau case management, silent incorrectness lebih berbahaya daripada error eksplisit.

Schema discipline membuat data graph:

- bisa dipercaya,
- bisa di-query konsisten,
- bisa dioptimalkan,
- bisa di-debug,
- bisa diaudit,
- bisa dievolusi.

---

## 3. Tiga Jenis Kontrak dalam Neo4j

Dalam praktik, ada tiga level kontrak.

### 3.1 Engine-Enforced Contract

Ini ditegakkan langsung oleh Neo4j melalui constraints dan indexes.

Contoh:

```cypher
CREATE CONSTRAINT customer_id_unique IF NOT EXISTS
FOR (c:Customer)
REQUIRE c.customerId IS UNIQUE;
```

Jika dua `Customer` memiliki `customerId` sama, write gagal.

Ini adalah kontrak paling kuat karena tidak tergantung pada kedisiplinan developer.

### 3.2 Query-Enforced Contract

Ini ditegakkan oleh Cypher write query.

Contoh:

```cypher
MATCH (c:Customer {customerId: $customerId})
MATCH (a:Account {accountId: $accountId})
MERGE (c)-[r:OWNS]->(a)
ON CREATE SET r.createdAt = datetime()
RETURN r
```

Query ini mengatakan bahwa ownership hanya dibuat antara Customer dan Account yang sudah ada.

Tetapi query-enforced contract bisa bocor jika ada query lain yang menulis data dengan cara berbeda.

### 3.3 Application-Enforced Contract

Ini ditegakkan di aplikasi Java.

Contoh:

- validasi command,
- domain invariant,
- idempotency key,
- transactional service boundary,
- authorization,
- audit logging,
- schema migration discipline,
- integration tests,
- data reconciliation.

Contoh Java-level invariant:

> A case cannot be escalated to enforcement if it has no active allegation and no supporting evidence.

Sebagian invariant seperti ini terlalu domain-specific untuk constraint Neo4j. Maka aplikasi harus menegakkannya.

### 3.4 Kombinasi yang Benar

Production graph yang sehat memakai ketiganya:

```text
Neo4j constraints:
  protect identity and basic integrity

Cypher write queries:
  encode graph mutation semantics

Java application layer:
  enforce workflow/domain invariant
```

Kesalahan umum adalah memilih hanya salah satu.

- Hanya constraint: domain logic terlalu tipis.
- Hanya aplikasi: data bisa rusak oleh script, import, job, atau service lain.
- Hanya query convention: tidak cukup kuat untuk sistem multi-team.

---

## 4. Neo4j Constraints: Integrity Guardrails

Constraint adalah guardrail untuk menjaga kualitas dan integrity data.

Jenis constraint penting di Neo4j modern meliputi:

1. property uniqueness constraint,
2. property existence constraint,
3. node key constraint,
4. relationship key constraint,
5. property type constraint.

Beberapa fitur constraint bergantung pada edition/version tertentu. Dalam production, selalu validasi terhadap versi Neo4j yang dipakai, terutama jika memakai Community vs Enterprise atau Cypher versi baru.

---

## 5. Property Uniqueness Constraint

### 5.1 Fungsi

Uniqueness constraint memastikan property atau kombinasi property unik untuk label node atau relationship type tertentu.

Contoh:

```cypher
CREATE CONSTRAINT customer_id_unique IF NOT EXISTS
FOR (c:Customer)
REQUIRE c.customerId IS UNIQUE;
```

Artinya:

```text
Tidak boleh ada dua node :Customer dengan customerId yang sama.
```

Untuk account:

```cypher
CREATE CONSTRAINT account_id_unique IF NOT EXISTS
FOR (a:Account)
REQUIRE a.accountId IS UNIQUE;
```

Untuk case:

```cypher
CREATE CONSTRAINT case_id_unique IF NOT EXISTS
FOR (c:Case)
REQUIRE c.caseId IS UNIQUE;
```

### 5.2 Mengapa Ini Penting untuk Graph

Tanpa uniqueness, `MERGE` tidak aman.

Contoh ingestion buruk:

```cypher
MERGE (c:Customer {customerId: $customerId})
SET c.name = $name
RETURN c
```

Jika tidak ada uniqueness constraint, dua transaksi concurrent bisa menciptakan duplicate node pada situasi race tertentu atau ketika query lain tidak konsisten.

Di graph, duplicate entity lebih merusak daripada duplicate row biasa karena relationship akan tersebar.

Contoh:

```text
(:Customer {customerId: "C-1"})-[:OWNS]->(:Account {accountId: "A-1"})
(:Customer {customerId: "C-1"})-[:SUBJECT_OF]->(:Case {caseId: "CASE-9"})
```

Secara manusia ini customer yang sama. Secara graph, ini dua node berbeda. Query relationship akan gagal menyatukan konteks.

### 5.3 Composite Uniqueness

Kadang uniqueness membutuhkan kombinasi property.

Contoh multi-tenant:

```cypher
CREATE CONSTRAINT tenant_customer_unique IF NOT EXISTS
FOR (c:Customer)
REQUIRE (c.tenantId, c.customerId) IS UNIQUE;
```

Artinya:

```text
customerId unik dalam tenant, bukan global.
```

Ini penting jika external ID berasal dari sistem tenant-specific.

### 5.4 Design Rule

Gunakan uniqueness constraint untuk semua entity yang memiliki identity stabil:

```text
Customer.customerId
Account.accountId
Case.caseId
Evidence.evidenceId
Organization.organizationId
User.userId
Role.roleId
Policy.policyId
Product.productId
Transaction.transactionId
```

Tetapi hati-hati dengan entity yang memang tidak punya identity bersih:

- alamat,
- nama orang,
- nomor telepon yang bisa berpindah,
- device fingerprint,
- alias,
- email historis,
- external profile tidak terverifikasi.

Untuk entity seperti itu, uniqueness terlalu agresif bisa menggabungkan hal yang tidak seharusnya sama.

---

## 6. Property Existence Constraint

### 6.1 Fungsi

Property existence constraint memastikan node dengan label tertentu atau relationship dengan type tertentu selalu memiliki property tertentu.

Contoh:

```cypher
CREATE CONSTRAINT customer_id_exists IF NOT EXISTS
FOR (c:Customer)
REQUIRE c.customerId IS NOT NULL;
```

Untuk relationship:

```cypher
CREATE CONSTRAINT transfer_amount_exists IF NOT EXISTS
FOR ()-[t:TRANSFERRED_TO]-()
REQUIRE t.amount IS NOT NULL;
```

### 6.2 Mengapa Penting

Graph query sering mengasumsikan property tertentu selalu ada.

Contoh:

```cypher
MATCH (a1:Account)-[t:TRANSFERRED_TO]->(a2:Account)
WHERE t.amount > 1000000
RETURN a1, t, a2
```

Jika sebagian `TRANSFERRED_TO` tidak punya `amount`, query masih jalan, tapi semantic-nya kacau:

- apakah amount tidak diketahui?
- apakah amount nol?
- apakah relationship dibuat dari source yang tidak lengkap?
- apakah data korup?

Existence constraint memaksa ingestion untuk memilih:

1. jangan buat relationship sebelum amount tersedia,
2. buat relationship type berbeda seperti `:TRANSFERRED_TO_UNVERIFIED`,
3. gunakan node evidence terpisah,
4. atau simpan status kualitas data secara eksplisit.

### 6.3 Jangan Terlalu Banyak Existence Constraint

Jika semua property diwajibkan, graph kehilangan fleksibilitas.

Buruk:

```text
Setiap :Person wajib punya passportNumber, taxId, phone, email, dateOfBirth, address.
```

Di domain nyata, data person sering partial.

Lebih baik:

```text
:Person wajib punya personId
:VerifiedPerson wajib punya verifiedAt dan verificationSource
:RegulatedEntity wajib punya regulatoryId
```

Gunakan label tambahan untuk merepresentasikan status kontrak yang lebih kuat.

Contoh:

```cypher
CREATE CONSTRAINT verified_person_verified_at_exists IF NOT EXISTS
FOR (p:VerifiedPerson)
REQUIRE p.verifiedAt IS NOT NULL;
```

---

## 7. Node Key Constraint

### 7.1 Fungsi

Node key constraint menggabungkan dua ide:

1. property harus ada,
2. kombinasi property harus unik.

Contoh:

```cypher
CREATE CONSTRAINT customer_node_key IF NOT EXISTS
FOR (c:Customer)
REQUIRE (c.tenantId, c.customerId) IS NODE KEY;
```

Artinya:

```text
Untuk setiap :Customer:
- tenantId harus ada,
- customerId harus ada,
- kombinasi tenantId + customerId harus unik.
```

### 7.2 Kapan Lebih Baik dari Uniqueness Biasa

Uniqueness constraint sering memperbolehkan property tidak ada, tergantung semantic constraint yang dipakai. Node key lebih tegas untuk entity identity.

Gunakan node key saat property adalah identitas wajib.

Contoh bagus:

```text
(:Customer {tenantId, customerId})
(:Account {tenantId, accountId})
(:Case {tenantId, caseId})
```

### 7.3 Design Rule

Untuk sistem multi-tenant production:

```text
Prefer node key untuk identity utama.
Gunakan uniqueness untuk alternate key.
Gunakan existence untuk property wajib non-key.
```

Contoh:

```cypher
CREATE CONSTRAINT case_node_key IF NOT EXISTS
FOR (c:Case)
REQUIRE (c.tenantId, c.caseId) IS NODE KEY;

CREATE CONSTRAINT case_reference_unique IF NOT EXISTS
FOR (c:Case)
REQUIRE (c.tenantId, c.externalReference) IS UNIQUE;

CREATE CONSTRAINT case_status_exists IF NOT EXISTS
FOR (c:Case)
REQUIRE c.status IS NOT NULL;
```

---

## 8. Relationship Key Constraint

### 8.1 Problem: Duplicate Relationship

Neo4j memperbolehkan multiple relationships antara dua node yang sama.

Ini bukan bug. Ini fitur.

Contoh valid:

```text
(:Account A)-[:TRANSFERRED_TO {transactionId: "T1"}]->(:Account B)
(:Account A)-[:TRANSFERRED_TO {transactionId: "T2"}]->(:Account B)
(:Account A)-[:TRANSFERRED_TO {transactionId: "T3"}]->(:Account B)
```

Karena transfer berbeda memang boleh terjadi antara account yang sama.

Tetapi untuk relationship seperti `:OWNS`, duplicate biasanya salah:

```text
(:Customer)-[:OWNS]->(:Account)
(:Customer)-[:OWNS]->(:Account)
(:Customer)-[:OWNS]->(:Account)
```

Secara semantic, ownership aktif yang sama tidak perlu muncul tiga kali kecuali model memang menyimpan history/validity.

### 8.2 Relationship Identity

Untuk relationship yang merepresentasikan event atau fact dengan identity, berikan key.

Contoh:

```cypher
CREATE CONSTRAINT transfer_rel_key IF NOT EXISTS
FOR ()-[t:TRANSFERRED_TO]-()
REQUIRE t.transactionId IS RELATIONSHIP KEY;
```

Untuk assignment:

```cypher
CREATE CONSTRAINT assignment_rel_key IF NOT EXISTS
FOR ()-[a:ASSIGNED_TO]-()
REQUIRE a.assignmentId IS RELATIONSHIP KEY;
```

### 8.3 Relationship Key vs Reification

Jika relationship punya terlalu banyak identity, lifecycle, state, approval, evidence, dan audit trail, mungkin relationship itu harus menjadi node.

Relationship masih baik untuk:

```text
(:Account)-[:TRANSFERRED_TO {transactionId, amount, at}]->(:Account)
```

Tetapi jika transaction punya banyak detail:

- source channel,
- merchant,
- fraud score,
- authorization,
- reversal,
- dispute,
- settlement,
- evidence,
- status transitions,
- related alerts,

maka lebih baik:

```text
(:Account)-[:SENT]->(:Transaction)-[:RECEIVED_BY]->(:Account)
(:Transaction)-[:FLAGGED_BY]->(:Alert)
(:Transaction)-[:SUPPORTED_BY]->(:Evidence)
```

Relationship key bukan pengganti modelling decision.

---

## 9. Property Type Constraint

### 9.1 Fungsi

Property type constraint memastikan property memiliki tipe tertentu.

Contoh konseptual:

```cypher
CREATE CONSTRAINT transfer_amount_type IF NOT EXISTS
FOR ()-[t:TRANSFERRED_TO]-()
REQUIRE t.amount IS :: FLOAT;
```

Atau untuk status:

```cypher
CREATE CONSTRAINT case_status_type IF NOT EXISTS
FOR (c:Case)
REQUIRE c.status IS :: STRING;
```

Syntax detail dapat berubah antar versi Cypher/Neo4j, jadi selalu cek manual versi yang dipakai sebelum menjalankan DDL.

### 9.2 Mengapa Penting

Tanpa type discipline, ingestion dari banyak source bisa mencampur tipe:

```text
amount: 1000000
amount: "1000000"
amount: "1,000,000"
amount: null
amount: "unknown"
```

Query ini menjadi rapuh:

```cypher
MATCH ()-[t:TRANSFERRED_TO]->()
WHERE t.amount > 1000000
RETURN t
```

Jika amount kadang string, query bisa gagal atau memberikan hasil yang tidak konsisten.

### 9.3 Type Constraint Tidak Menggantikan Domain Validation

Type constraint hanya menjawab “tipe property benar atau tidak”. Ia tidak menjawab:

- amount harus positif,
- status harus salah satu dari `OPEN`, `ESCALATED`, `CLOSED`,
- score harus 0 sampai 100,
- date tidak boleh di masa depan,
- closedAt harus ada jika status `CLOSED`.

Invariant seperti ini perlu aplikasi Java, trigger/procedure custom, atau data quality job.

---

## 10. Constraints as Write-Time Failure, Not Read-Time Suggestion

Constraint bukan dokumentasi pasif. Constraint membuat write gagal jika melanggar kontrak.

Contoh:

```cypher
CREATE CONSTRAINT customer_id_unique IF NOT EXISTS
FOR (c:Customer)
REQUIRE c.customerId IS UNIQUE;
```

Jika aplikasi menjalankan:

```cypher
CREATE (:Customer {customerId: "C-001", name: "A"});
CREATE (:Customer {customerId: "C-001", name: "B"});
```

Write kedua gagal.

Ini baik.

Dalam sistem production, error cepat lebih baik daripada graph rusak diam-diam.

### 10.1 Java Implication

Aplikasi Java harus memperlakukan constraint violation sebagai sinyal domain/integration penting.

Contoh kategori:

```text
Constraint violation karena duplicate natural key:
  mungkin command duplicate, retry, atau upstream mengirim data ulang.

Constraint violation karena missing required property:
  mungkin bug mapper, schema drift, atau data source tidak lengkap.

Constraint violation karena wrong type:
  mungkin parser bug atau upstream contract berubah.
```

Jangan hanya log dan ignore.

---

## 11. Indexes: Access Path, Not Integrity

Index adalah struktur yang mempercepat pencarian data berdasarkan property, label, type, atau semantic similarity.

Penting:

> Constraint menjaga kebenaran. Index mempercepat akses.

Memang beberapa constraint otomatis membuat index pendukung. Tetapi secara mental tetap pisahkan:

```text
Constraint:
  “data ini tidak boleh rusak”

Index:
  “query ini harus punya entry point murah”
```

Contoh:

```cypher
CREATE INDEX customer_email_index IF NOT EXISTS
FOR (c:Customer)
ON (c.email);
```

Ini membantu query:

```cypher
MATCH (c:Customer)
WHERE c.email = $email
RETURN c
```

Tetapi tidak mencegah duplicate email.

Jika email harus unik:

```cypher
CREATE CONSTRAINT customer_email_unique IF NOT EXISTS
FOR (c:Customer)
REQUIRE c.email IS UNIQUE;
```

---

## 12. Query Entry Point: Index Dimulai Sebelum Traversal

Graph traversal biasanya cepat jika Anda sudah berada di node awal yang tepat.

Masalahnya adalah menemukan node awal.

Contoh query:

```cypher
MATCH (c:Customer {customerId: $customerId})-[:OWNS]->(a:Account)
RETURN a
```

Jika `Customer.customerId` di-index/constraint, Neo4j bisa menemukan customer secara murah lalu melakukan traversal `:OWNS`.

Tanpa index:

```text
Scan semua :Customer → filter customerId → traverse OWNS
```

Dengan index:

```text
Index seek :Customer(customerId) → traverse OWNS
```

Untuk graph workload, index biasanya dipakai untuk:

1. menemukan starting node,
2. menemukan anchor nodes,
3. membatasi subgraph,
4. mempercepat lookup sebelum traversal,
5. mendukung idempotent writes,
6. mendukung lookup dari external systems.

Index bukan untuk menggantikan traversal.

Query buruk:

```cypher
MATCH (a:Account)-[:TRANSFERRED_TO*1..5]->(b:Account)
WHERE a.accountId = $accountId
RETURN b
```

Lebih baik:

```cypher
MATCH (a:Account {accountId: $accountId})
MATCH (a)-[:TRANSFERRED_TO*1..5]->(b:Account)
RETURN b
```

Tujuannya membuat anchor jelas sebelum expansion.

---

## 13. Index Categories in Neo4j

Secara praktis, index Neo4j dapat dipahami dalam beberapa kategori:

1. search-performance indexes,
2. semantic indexes.

Search-performance indexes membantu lookup/filter biasa.

Semantic indexes membantu approximate matching atau similarity-style retrieval.

Jenis yang relevan:

1. range index,
2. text index,
3. point index,
4. token lookup index,
5. full-text index,
6. vector index.

---

## 14. Range Index

### 14.1 Fungsi

Range index dipakai untuk equality dan range filtering pada property.

Contoh:

```cypher
CREATE RANGE INDEX account_opened_at_index IF NOT EXISTS
FOR (a:Account)
ON (a.openedAt);
```

Query:

```cypher
MATCH (a:Account)
WHERE a.openedAt >= date($from)
  AND a.openedAt < date($to)
RETURN a
```

### 14.2 Use Cases

Range index cocok untuk:

- ID lookup,
- date range,
- numeric range,
- status equality,
- timestamp filtering,
- score threshold,
- tenant filtering,
- composite lookup.

Contoh composite:

```cypher
CREATE RANGE INDEX case_tenant_status_index IF NOT EXISTS
FOR (c:Case)
ON (c.tenantId, c.status);
```

Query:

```cypher
MATCH (c:Case)
WHERE c.tenantId = $tenantId
  AND c.status = "OPEN"
RETURN c
ORDER BY c.openedAt DESC
LIMIT 100
```

### 14.3 Design Warning

Index pada property low-selectivity tidak selalu membantu.

Contoh:

```cypher
CREATE RANGE INDEX person_gender_index IF NOT EXISTS
FOR (p:Person)
ON (p.gender);
```

Jika graph punya 100 juta person dan gender hanya beberapa nilai, index mungkin tidak cukup selektif. Query tetap akan mengembalikan terlalu banyak row.

Pertanyaan index bukan hanya:

```text
Apakah property dipakai di WHERE?
```

Tetapi:

```text
Apakah property cukup selektif untuk menjadi entry point murah?
```

---

## 15. Text Index

### 15.1 Fungsi

Text index membantu operasi string tertentu, misalnya matching berbasis prefix/suffix/contains sesuai kemampuan planner dan versi.

Contoh:

```cypher
CREATE TEXT INDEX customer_name_text_index IF NOT EXISTS
FOR (c:Customer)
ON (c.name);
```

Query:

```cypher
MATCH (c:Customer)
WHERE c.name STARTS WITH $prefix
RETURN c
LIMIT 20
```

### 15.2 Text Index Bukan Search Engine

Text index bukan pengganti Elasticsearch/OpenSearch.

Gunakan Neo4j text/full-text index untuk:

- lookup sederhana,
- search ringan dalam graph UI,
- filtering sebelum traversal,
- admin tools,
- low-to-medium complexity text matching.

Jangan jadikan Neo4j sebagai full search platform jika requirement mencakup:

- complex relevance ranking,
- analyzer custom berat,
- stemming multilingual kompleks,
- typo tolerance advanced,
- faceting besar,
- log/search workload masif.

Dalam arsitektur polyglot, pola sehat adalah:

```text
Elasticsearch/OpenSearch:
  menemukan candidate berdasarkan text relevance

Neo4j:
  menjelaskan hubungan, path, ownership, dependency, risk network
```

---

## 16. Point Index

Point index digunakan untuk data spasial/geografis.

Contoh:

```cypher
CREATE POINT INDEX merchant_location_index IF NOT EXISTS
FOR (m:Merchant)
ON (m.location);
```

Query konseptual:

```cypher
MATCH (m:Merchant)
WHERE point.distance(m.location, point({latitude: $lat, longitude: $lng})) < 1000
RETURN m
```

Use case:

- merchant near customer,
- branch location,
- event location,
- asset tracking,
- geospatial risk.

Design note:

Graph relationship dan geospatial filtering sering bergabung.

Contoh:

```text
Find accounts connected to suspicious merchants within 2km of a known fraud hotspot.
```

Di sini point index membantu menemukan merchant/hotspot candidate, lalu traversal menjelaskan network.

---

## 17. Token Lookup Index

Token lookup index membantu lookup berdasarkan label node atau relationship type.

Secara sederhana:

```text
Label token:
  :Customer, :Account, :Case

Relationship type token:
  :OWNS, :TRANSFERRED_TO, :SUBJECT_OF
```

Token lookup index biasanya hadir secara default.

Ia membantu query seperti:

```cypher
MATCH (c:Customer)
RETURN count(c)
```

Tetapi jangan salah paham:

```cypher
MATCH (c:Customer)
RETURN c
```

Jika ada 100 juta customer, token lookup index tidak membuat hasilnya kecil. Ia hanya membantu menemukan semua node dengan label tersebut. Query tetap besar.

Index tidak menghapus kebutuhan untuk selective predicate.

---

## 18. Full-Text Index

### 18.1 Fungsi

Full-text index dipakai untuk indexing string properties dengan kemampuan search yang lebih kaya daripada range/text index biasa.

Contoh:

```cypher
CREATE FULLTEXT INDEX customer_fulltext_index IF NOT EXISTS
FOR (c:Customer)
ON EACH [c.name, c.email, c.phone];
```

Query biasanya memakai procedure:

```cypher
CALL db.index.fulltext.queryNodes("customer_fulltext_index", $query)
YIELD node, score
RETURN node, score
ORDER BY score DESC
LIMIT 20
```

### 18.2 Use Cases

Full-text index cocok untuk:

- search entity by name,
- investigation UI lookup,
- fuzzy-ish candidate discovery,
- search evidence title/summary,
- search organization aliases,
- search case references.

### 18.3 Full-Text + Graph Traversal Pattern

Pattern umum:

```cypher
CALL db.index.fulltext.queryNodes("entity_search", $query)
YIELD node AS entity, score
WITH entity, score
WHERE score > $minScore
MATCH path = (entity)-[:ASSOCIATED_WITH|OWNS|CONTROLS*1..3]-(related)
RETURN entity, score, related, path
LIMIT 100
```

Ini powerful, tetapi harus dibatasi.

Risiko:

- full-text menghasilkan terlalu banyak candidate,
- traversal dari candidate meledak,
- score search dicampur dengan risk score domain secara tidak jelas,
- hasil terlihat authoritative padahal hanya approximate.

### 18.4 Jangan Campur Meaning

Full-text score adalah relevance text. Bukan risk score, fraud score, atau confidence score domain.

Pisahkan:

```text
searchScore:
  seberapa cocok query text dengan property string

riskScore:
  skor domain dari risk model

confidenceScore:
  keyakinan entity resolution/provenance
```

---

## 19. Vector Index

### 19.1 Fungsi

Vector index mendukung similarity search atas vector embeddings.

Contoh konseptual:

```cypher
CREATE VECTOR INDEX evidence_embedding_index IF NOT EXISTS
FOR (e:Evidence)
ON (e.embedding)
OPTIONS {
  indexConfig: {
    `vector.dimensions`: 1536,
    `vector.similarity_function`: 'cosine'
  }
};
```

Query konseptual:

```cypher
CALL db.index.vector.queryNodes("evidence_embedding_index", 10, $queryEmbedding)
YIELD node, score
RETURN node, score
ORDER BY score DESC
```

Syntax dan opsi index dapat berbeda antar versi Neo4j, jadi validasi dengan manual versi runtime.

### 19.2 Use Cases

Vector index cocok untuk:

- semantic search evidence,
- similar case retrieval,
- GraphRAG context retrieval,
- recommendation candidate generation,
- entity matching candidate,
- document-to-entity grounding.

### 19.3 Vector Index Bukan Graph Algorithm

Vector similarity menjawab:

```text
Mana node yang embedding-nya mirip dengan query embedding?
```

Graph traversal menjawab:

```text
Bagaimana node ini terhubung dengan node lain?
```

Graph algorithm menjawab:

```text
Apa struktur global/local network dan score yang muncul dari graph topology?
```

Jangan campur ketiganya.

Pattern sehat:

```text
Vector search:
  find semantically similar evidence/case candidates

Graph traversal:
  expand to entities, cases, officers, regulations, decisions

Graph constraints/provenance:
  ensure retrieved context is auditable and grounded
```

### 19.4 Failure Modes

Vector index membawa failure mode baru:

- stale embedding,
- model version mismatch,
- dimensional mismatch,
- multilingual drift,
- semantic false positive,
- retrieval without authorization trimming,
- mixing confidential and public embeddings,
- no provenance on generated answer.

Ini akan dibahas lebih dalam di Part 025.

---

## 20. Composite Index Design

Composite index mencakup lebih dari satu property.

Contoh:

```cypher
CREATE RANGE INDEX case_tenant_status_opened_index IF NOT EXISTS
FOR (c:Case)
ON (c.tenantId, c.status, c.openedAt);
```

Query target:

```cypher
MATCH (c:Case)
WHERE c.tenantId = $tenantId
  AND c.status = $status
  AND c.openedAt >= datetime($from)
RETURN c
ORDER BY c.openedAt DESC
LIMIT 100
```

### 20.1 Order Matters Conceptually

Composite index harus mengikuti access pattern.

Pertanyaan desain:

1. property mana selalu ada di predicate?
2. property mana paling selektif?
3. property mana equality?
4. property mana range?
5. apakah query butuh ordering?
6. apakah tenantId selalu menjadi boundary?

Untuk multi-tenant system, `tenantId` sering menjadi property pertama.

Contoh:

```cypher
CREATE RANGE INDEX account_tenant_account_id_index IF NOT EXISTS
FOR (a:Account)
ON (a.tenantId, a.accountId);
```

Tetapi jika `accountId` sudah global unique, `tenantId` mungkin tidak perlu di index tersebut.

### 20.2 Jangan Buat Composite Index Spekulatif

Buruk:

```text
Index semua kombinasi:
(customerId, status)
(customerId, createdAt)
(status, createdAt)
(tenantId, status)
(tenantId, createdAt)
(tenantId, status, createdAt)
(tenantId, customerId, status)
```

Index punya biaya:

- storage,
- write amplification,
- population time,
- operational complexity,
- planner ambiguity,
- migration overhead.

Buat index berdasarkan query catalog nyata.

---

## 21. Index-Backed Lookup vs Traversal

Graph database memberi dua cara menemukan data:

1. index-backed lookup,
2. relationship traversal.

Contoh index lookup:

```cypher
MATCH (a:Account {accountId: $accountId})
RETURN a
```

Contoh traversal:

```cypher
MATCH (:Customer {customerId: $customerId})-[:OWNS]->(a:Account)
RETURN a
```

Keduanya valid, tapi semantic berbeda.

Jika requirement:

> Find account by account ID.

Gunakan index lookup.

Jika requirement:

> Find accounts owned by this customer.

Gunakan traversal.

Jika requirement:

> Verify this customer owns this account.

Gunakan kombinasi:

```cypher
MATCH (c:Customer {customerId: $customerId})
MATCH (a:Account {accountId: $accountId})
RETURN EXISTS {
  MATCH (c)-[:OWNS]->(a)
} AS ownsAccount
```

Atau:

```cypher
MATCH (c:Customer {customerId: $customerId})-[:OWNS]->(a:Account {accountId: $accountId})
RETURN a
```

Tergantung planner dan selectivity.

### 21.1 Anti-Pattern: Index Everything, Ignore Relationships

Jika semua query dilakukan seperti ini:

```cypher
MATCH (a:Account {customerId: $customerId})
RETURN a
```

maka graph relationship `(:Customer)-[:OWNS]->(:Account)` tidak digunakan.

Ini tanda bahwa model masih document/table-shaped.

### 21.2 Anti-Pattern: Traverse Everything, Ignore Indexes

Jika semua query dimulai dari graph global:

```cypher
MATCH (c:Customer)-[:OWNS]->(a:Account)-[:TRANSFERRED_TO*1..5]->(b)
WHERE c.customerId = $customerId
RETURN b
```

maka traversal bisa dimulai terlalu luas sebelum filter efektif.

Graph query sehat biasanya:

```text
index anchor → bounded traversal → filter/projection → aggregation/result
```

---

## 22. Constraints and Indexes for Idempotent Ingestion

Dalam production, data sering masuk berulang:

- retry message,
- CDC replay,
- batch re-run,
- upstream resend,
- migration script,
- backfill,
- operator repair job.

Graph ingestion harus idempotent.

### 22.1 Node Idempotency

Constraint:

```cypher
CREATE CONSTRAINT customer_id_unique IF NOT EXISTS
FOR (c:Customer)
REQUIRE c.customerId IS UNIQUE;
```

Write:

```cypher
MERGE (c:Customer {customerId: $customerId})
ON CREATE SET
  c.createdAt = datetime(),
  c.source = $source
SET
  c.name = $name,
  c.updatedAt = datetime()
RETURN c
```

Tanpa constraint, `MERGE` tidak cukup sebagai correctness guarantee di high concurrency / multi-writer scenarios.

### 22.2 Relationship Idempotency

Untuk relationship event:

```cypher
CREATE CONSTRAINT transfer_id_unique IF NOT EXISTS
FOR ()-[t:TRANSFERRED_TO]-()
REQUIRE t.transactionId IS UNIQUE;
```

Write:

```cypher
MATCH (from:Account {accountId: $fromAccountId})
MATCH (to:Account {accountId: $toAccountId})
MERGE (from)-[t:TRANSFERRED_TO {transactionId: $transactionId}]->(to)
ON CREATE SET
  t.amount = $amount,
  t.currency = $currency,
  t.at = datetime($at),
  t.ingestedAt = datetime()
RETURN t
```

### 22.3 Relationship Without Natural ID

Jika relationship tidak punya natural ID, idempotency lebih sulit.

Contoh:

```text
(:Customer)-[:OWNS]->(:Account)
```

Untuk active ownership, biasanya cukup:

```cypher
MATCH (c:Customer {customerId: $customerId})
MATCH (a:Account {accountId: $accountId})
MERGE (c)-[r:OWNS]->(a)
ON CREATE SET r.createdAt = datetime()
SET r.updatedAt = datetime()
RETURN r
```

Tetapi jika ownership punya periode:

```text
Customer owns account from 2020 to 2022
Customer owns account from 2024 to now
```

maka relationship identity perlu mencakup validity interval atau relationship perlu direifikasi.

Contoh:

```text
(:Customer)-[:HAS_OWNERSHIP]->(:Ownership {ownershipId, validFrom, validTo})-[:OF_ACCOUNT]->(:Account)
```

---

## 23. Relationship Uniqueness: The Missing Mental Model

Relational engineer sering mencari foreign key uniqueness. Di graph, duplicate relationship semantics harus diputuskan per relationship type.

Tabel desain:

| Relationship Type | Duplicate Allowed? | Reason |
|---|---:|---|
| `(:Customer)-[:OWNS]->(:Account)` | Usually no | Active fact; duplicate meaningless |
| `(:Account)-[:TRANSFERRED_TO]->(:Account)` | Yes | Multiple transfers between same accounts |
| `(:User)-[:HAS_ROLE]->(:Role)` | Usually no | Assignment active once unless temporal |
| `(:Officer)-[:REVIEWED]->(:Case)` | Maybe yes | Multiple review events may exist |
| `(:Case)-[:SUPPORTED_BY]->(:Evidence)` | Usually no | Same evidence linked once unless with role/context |
| `(:Person)-[:LIVED_AT]->(:Address)` | Yes, if historical | Need validFrom/validTo |
| `(:Entity)-[:ALIAS_OF]->(:Entity)` | Usually no | Relationship itself is identity claim |

Design question:

> Is the relationship a current state fact, an event, an assertion, or a temporal interval?

Jawaban menentukan constraint strategy.

---

## 24. Data Integrity Beyond Constraints

Neo4j constraints tidak bisa mengekspresikan semua invariant.

Contoh invariant yang sering perlu aplikasi:

```text
A CLOSED case must have closedAt.
A CLOSED case must not have active escalation.
A Case cannot be escalated unless it has at least one Allegation.
A Person cannot approve their own investigation.
A User cannot have two mutually exclusive roles.
A Transaction amount must be positive.
A validTo must be greater than validFrom.
A relationship valid interval must not overlap with another active interval.
A tenant cannot connect to another tenant's nodes.
```

Beberapa invariant bisa didekati dengan query transaction check.

Contoh escalation:

```cypher
MATCH (c:Case {caseId: $caseId})
WHERE EXISTS {
  MATCH (c)-[:HAS_ALLEGATION]->(:Allegation {status: "ACTIVE"})
}
AND EXISTS {
  MATCH (c)-[:SUPPORTED_BY]->(:Evidence)
}
SET c.status = "ESCALATED",
    c.escalatedAt = datetime()
RETURN c
```

Jika tidak ada row returned, aplikasi menganggap command gagal secara domain.

Dalam Java:

```java
if (updatedCount == 0) {
    throw new DomainRuleViolation("Case cannot be escalated without active allegation and evidence");
}
```

---

## 25. Graph Schema Documentation

Neo4j flexible schema membuat dokumentasi lebih penting, bukan kurang penting.

Minimal dokumentasi schema graph harus mencakup:

1. label catalog,
2. relationship type catalog,
3. property catalog,
4. identity rules,
5. required properties,
6. uniqueness constraints,
7. index catalog,
8. relationship cardinality expectations,
9. allowed direction semantics,
10. temporal semantics,
11. provenance semantics,
12. tenant isolation rules,
13. query catalog,
14. mutation catalog,
15. invariant catalog,
16. migration history.

Contoh relationship catalog:

```markdown
## Relationship: OWNS

Pattern:
(:Customer)-[:OWNS]->(:Account)

Meaning:
Customer is the active owner of the account.

Direction:
Customer -> Account.

Duplicate allowed:
No, for active ownership.

Temporal:
If historical ownership is needed, use Ownership node or validFrom/validTo model.

Required properties:
- createdAt
- source

Common queries:
- find accounts owned by customer
- verify account ownership
- discover shared ownership risk

Integrity:
- source and createdAt required
- tenantId of Customer and Account must match
```

Ini membantu engineer baru, reviewer, auditor, dan data steward.

---

## 26. Constraint Naming Convention

Jangan biarkan constraint/index bernama auto-generated jika sistem production dikelola serius.

Gunakan nama eksplisit.

Pattern:

```text
<constraint_or_index_type>_<label_or_reltype>_<properties>
```

Contoh:

```cypher
CREATE CONSTRAINT uniq_customer_customer_id IF NOT EXISTS
FOR (c:Customer)
REQUIRE c.customerId IS UNIQUE;

CREATE CONSTRAINT key_case_tenant_id_case_id IF NOT EXISTS
FOR (c:Case)
REQUIRE (c.tenantId, c.caseId) IS NODE KEY;

CREATE INDEX idx_case_tenant_status IF NOT EXISTS
FOR (c:Case)
ON (c.tenantId, c.status);

CREATE FULLTEXT INDEX ftx_entity_name_alias IF NOT EXISTS
FOR (e:Entity)
ON EACH [e.name, e.aliases];
```

Keuntungan:

- migration jelas,
- error log bisa dipahami,
- drop/alter lebih aman,
- observability lebih mudah,
- reviewer tahu maksudnya.

---

## 27. Listing Constraints and Indexes

Untuk inspeksi:

```cypher
SHOW CONSTRAINTS;
```

Atau detail:

```cypher
SHOW CONSTRAINTS YIELD *;
```

Untuk indexes:

```cypher
SHOW INDEXES;
```

Filter contoh:

```cypher
SHOW RANGE INDEXES;
SHOW FULLTEXT INDEXES;
SHOW VECTOR INDEXES;
```

Gunakan ini dalam:

- deployment validation,
- smoke test,
- migration verification,
- production audit,
- drift detection.

---

## 28. Schema Migration Strategy

Neo4j schema migration harus diperlakukan seperti database migration lain.

### 28.1 Jangan Manual di Production

Buruk:

```text
Engineer menjalankan CREATE INDEX manual di browser production.
```

Lebih baik:

```text
Migration file versioned di repo
CI/CD apply migration
Post-migration validation
Rollback/drop plan eksplisit
```

Tools yang bisa dipertimbangkan:

- Liquibase extension/support for Neo4j,
- Neo4j Migrations library,
- custom migration runner,
- Flyway-like internal process dengan Cypher scripts.

Yang penting bukan tool-nya, tapi discipline:

```text
schema changes are reviewed, versioned, tested, observed
```

### 28.2 Safe Migration Pattern

Contoh perubahan: menambahkan `tenantId` ke `Case` dan menjadikannya node key.

Tahap aman:

1. Tambah property `tenantId` melalui backfill.
2. Validasi semua `Case` punya tenantId.
3. Validasi tidak ada duplicate `(tenantId, caseId)`.
4. Tambah constraint.
5. Update application query agar selalu memakai tenantId.
6. Deploy.
7. Monitor error.

Cypher validation:

```cypher
MATCH (c:Case)
WHERE c.tenantId IS NULL
RETURN count(c) AS missingTenantId;
```

Duplicate check:

```cypher
MATCH (c:Case)
WITH c.tenantId AS tenantId, c.caseId AS caseId, count(*) AS n
WHERE n > 1
RETURN tenantId, caseId, n
LIMIT 20;
```

Constraint:

```cypher
CREATE CONSTRAINT key_case_tenant_case IF NOT EXISTS
FOR (c:Case)
REQUIRE (c.tenantId, c.caseId) IS NODE KEY;
```

### 28.3 Index Population Risk

Creating index on large graph can take time and resources.

Operational concerns:

- run during low traffic,
- monitor population progress,
- avoid multiple large indexes at once,
- ensure disk capacity,
- test on production-like dataset,
- coordinate with write-heavy ingestion.

---

## 29. Index Lifecycle

Index bukan “buat sekali, lupakan”.

Lifecycle:

1. identify query need,
2. create index in staging,
3. test query plan with `EXPLAIN`,
4. profile with realistic data,
5. deploy index,
6. wait until online/populated,
7. deploy query relying on it,
8. monitor usage/performance,
9. remove unused indexes.

### 29.1 Why Deploy Index Before Query Change

Jika query baru membutuhkan index, jangan deploy query dan index bersamaan tanpa memastikan index siap.

Urutan lebih aman:

```text
Release 1:
  create index
  validate online

Release 2:
  deploy query relying on index
```

Untuk sistem kecil bisa bersamaan, tapi untuk production besar separation lebih defensible.

### 29.2 Unused Indexes

Unused indexes tetap punya biaya write.

Gejala terlalu banyak index:

- write latency naik,
- import lambat,
- disk membesar,
- checkpoint pressure,
- operational migration berat.

Review berkala query/index usage.

---

## 30. Query Planning and Index Selection

Cypher planner memilih execution plan berdasarkan statistics, indexes, predicates, dan query shape.

Query yang secara manusia “sama” bisa berbeda plan.

Contoh:

```cypher
MATCH (c:Customer)-[:OWNS]->(a:Account)
WHERE c.customerId = $customerId
RETURN a
```

Versus:

```cypher
MATCH (c:Customer {customerId: $customerId})-[:OWNS]->(a:Account)
RETURN a
```

Planner biasanya bisa memahami keduanya, tapi bentuk kedua lebih jelas sebagai anchor lookup.

### 30.1 Use EXPLAIN and PROFILE

Gunakan:

```cypher
EXPLAIN
MATCH (c:Customer {customerId: $customerId})-[:OWNS]->(a:Account)
RETURN a;
```

Untuk eksekusi nyata:

```cypher
PROFILE
MATCH (c:Customer {customerId: $customerId})-[:OWNS]->(a:Account)
RETURN a;
```

Yang dicari:

- index seek dipakai atau tidak,
- label scan terjadi atau tidak,
- row count meledak di operator mana,
- db hits tinggi di mana,
- eager operator muncul atau tidak,
- expansion terlalu luas atau tidak.

Part 011 akan membahas ini lebih dalam.

---

## 31. Index Does Not Fix Bad Cardinality

Contoh query:

```cypher
MATCH (c:Customer {country: "ID"})-[:OWNS]->(a:Account)
RETURN a
```

Walaupun `country` di-index, jika 80% customer berada di Indonesia, index tidak banyak membantu.

Masalahnya bukan lookup. Masalahnya cardinality.

Query perlu boundary lebih kuat:

```cypher
MATCH (c:Customer {tenantId: $tenantId, customerId: $customerId})-[:OWNS]->(a:Account)
RETURN a
```

Atau requirement-nya memang batch/analytics, bukan transactional query.

Design principle:

> Index membantu menemukan subset. Jika subset tetap besar, masalahnya bukan index, melainkan access pattern.

---

## 32. Constraint and Index Strategy by Label

Berikut contoh strategi untuk domain enforcement/case graph.

### 32.1 Customer

```cypher
CREATE CONSTRAINT key_customer_tenant_customer IF NOT EXISTS
FOR (c:Customer)
REQUIRE (c.tenantId, c.customerId) IS NODE KEY;

CREATE INDEX idx_customer_tenant_status IF NOT EXISTS
FOR (c:Customer)
ON (c.tenantId, c.status);

CREATE FULLTEXT INDEX ftx_customer_identity IF NOT EXISTS
FOR (c:Customer)
ON EACH [c.name, c.email, c.phone];
```

Rationale:

- node key untuk identity,
- status index untuk operational list,
- full-text untuk investigation lookup.

### 32.2 Account

```cypher
CREATE CONSTRAINT key_account_tenant_account IF NOT EXISTS
FOR (a:Account)
REQUIRE (a.tenantId, a.accountId) IS NODE KEY;

CREATE INDEX idx_account_tenant_type IF NOT EXISTS
FOR (a:Account)
ON (a.tenantId, a.accountType);
```

Rationale:

- account lookup harus murah,
- account type sering dipakai sebagai filter.

### 32.3 Case

```cypher
CREATE CONSTRAINT key_case_tenant_case IF NOT EXISTS
FOR (c:Case)
REQUIRE (c.tenantId, c.caseId) IS NODE KEY;

CREATE INDEX idx_case_tenant_status_opened IF NOT EXISTS
FOR (c:Case)
ON (c.tenantId, c.status, c.openedAt);

CREATE INDEX idx_case_tenant_priority IF NOT EXISTS
FOR (c:Case)
ON (c.tenantId, c.priority);
```

Rationale:

- case list by status sering dipakai UI,
- priority queue perlu query cepat,
- tenant boundary eksplisit.

### 32.4 Evidence

```cypher
CREATE CONSTRAINT key_evidence_tenant_evidence IF NOT EXISTS
FOR (e:Evidence)
REQUIRE (e.tenantId, e.evidenceId) IS NODE KEY;

CREATE FULLTEXT INDEX ftx_evidence_text IF NOT EXISTS
FOR (e:Evidence)
ON EACH [e.title, e.summary, e.extractedText];
```

Rationale:

- evidence harus auditable,
- search evidence perlu full-text,
- extractedText mungkin besar; evaluasi ukuran property dan index cost.

### 32.5 Regulation

```cypher
CREATE CONSTRAINT key_regulation_code IF NOT EXISTS
FOR (r:Regulation)
REQUIRE r.code IS UNIQUE;

CREATE FULLTEXT INDEX ftx_regulation_text IF NOT EXISTS
FOR (r:Regulation)
ON EACH [r.title, r.description];
```

Rationale:

- regulation code biasanya global,
- title/description perlu search.

---

## 33. Constraint and Index Strategy by Relationship

### 33.1 TRANSFERRED_TO

Jika transfer direpresentasikan sebagai relationship event:

```cypher
CREATE CONSTRAINT key_transfer_transaction IF NOT EXISTS
FOR ()-[t:TRANSFERRED_TO]-()
REQUIRE t.transactionId IS RELATIONSHIP KEY;

CREATE INDEX idx_transfer_at IF NOT EXISTS
FOR ()-[t:TRANSFERRED_TO]-()
ON (t.at);
```

Pertimbangan:

- jika query sering mulai dari account lalu traverse transfer, index relationship `at` mungkin kurang penting,
- jika query mencari semua transfer dalam periode tertentu, index `at` lebih berguna,
- jika transfer punya banyak lifecycle, jadikan node `:Transaction`.

### 33.2 REVIEWED_BY

```cypher
CREATE CONSTRAINT reviewed_at_exists IF NOT EXISTS
FOR ()-[r:REVIEWED_BY]-()
REQUIRE r.reviewedAt IS NOT NULL;
```

Namun jika review adalah event audit penting, lebih baik:

```text
(:Case)-[:HAS_REVIEW]->(:Review)-[:PERFORMED_BY]->(:Officer)
```

### 33.3 ASSIGNED_TO

Active assignment:

```cypher
MATCH (c:Case {tenantId: $tenantId, caseId: $caseId})
MATCH (o:Officer {tenantId: $tenantId, officerId: $officerId})
MERGE (c)-[a:ASSIGNED_TO]->(o)
ON CREATE SET a.assignedAt = datetime()
RETURN a
```

Historical assignment:

```text
(:Case)-[:HAS_ASSIGNMENT]->(:Assignment {assignmentId, from, to, status})-[:ASSIGNED_TO]->(:Officer)
```

Don't force a relationship constraint to solve lifecycle complexity.

---

## 34. Multi-Tenant Integrity

Multi-tenancy adalah sumber bug integrity besar di graph.

Contoh data bocor:

```text
(:Customer {tenantId: "T1"})-[:OWNS]->(:Account {tenantId: "T2"})
```

Neo4j constraint standar tidak secara otomatis mencegah relationship cross-tenant seperti ini.

### 34.1 Defensive Design Options

#### Option A — Tenant property on every node

```text
(:Customer {tenantId, customerId})
(:Account {tenantId, accountId})
```

Pros:

- sederhana,
- satu database,
- query bisa filter tenant.

Cons:

- harus disiplin di semua query,
- relationship cross-tenant bisa terjadi jika tidak dicek,
- access control trimming kompleks.

#### Option B — Tenant node boundary

```text
(:Tenant {tenantId})-[:HAS_CUSTOMER]->(:Customer)
(:Tenant)-[:HAS_ACCOUNT]->(:Account)
```

Pros:

- tenant sebagai graph boundary eksplisit,
- useful untuk traversal.

Cons:

- tenant bisa menjadi supernode,
- query harus hati-hati.

#### Option C — Database per tenant

Pros:

- isolation kuat,
- query lebih sederhana,
- compliance lebih mudah.

Cons:

- operational overhead,
- tenant count besar bisa sulit,
- cross-tenant analytics sulit.

#### Option D — Cluster/instance per tenant class

Pros:

- isolation paling kuat,
- cocok untuk regulated/high-value tenants.

Cons:

- mahal,
- operationally complex.

### 34.2 Query-Level Tenant Guard

Selalu anchor tenant:

```cypher
MATCH (c:Customer {tenantId: $tenantId, customerId: $customerId})
MATCH (c)-[:OWNS]->(a:Account {tenantId: $tenantId})
RETURN a
```

Untuk mutation:

```cypher
MATCH (c:Customer {tenantId: $tenantId, customerId: $customerId})
MATCH (a:Account {tenantId: $tenantId, accountId: $accountId})
MERGE (c)-[:OWNS]->(a)
```

Jangan:

```cypher
MATCH (c:Customer {customerId: $customerId})
MATCH (a:Account {accountId: $accountId})
MERGE (c)-[:OWNS]->(a)
```

Jika ID tidak global unique, ini bisa menciptakan cross-tenant relationship.

---

## 35. Integrity for Temporal Data

Temporal graph sering butuh invariant yang tidak bisa hanya constraint biasa.

Contoh relationship:

```text
(:Person)-[:EMPLOYED_BY {validFrom, validTo}]->(:Organization)
```

Integrity:

1. `validFrom` wajib ada,
2. `validTo` boleh null untuk current,
3. `validTo > validFrom`,
4. tidak boleh ada dua active employment untuk same person jika domain melarang,
5. interval tidak boleh overlap untuk role tertentu.

Constraint bisa membantu existence/type:

```cypher
CREATE CONSTRAINT employed_valid_from_exists IF NOT EXISTS
FOR ()-[e:EMPLOYED_BY]-()
REQUIRE e.validFrom IS NOT NULL;
```

Tetapi overlap detection butuh query/application logic.

Contoh check sebelum insert:

```cypher
MATCH (p:Person {personId: $personId})
MATCH (o:Organization {organizationId: $organizationId})
WHERE NOT EXISTS {
  MATCH (p)-[e:EMPLOYED_BY]->(:Organization)
  WHERE e.validTo IS NULL
}
CREATE (p)-[:EMPLOYED_BY {
  validFrom: date($validFrom),
  validTo: null,
  source: $source
}]->(o)
RETURN p
```

Aplikasi harus memperlakukan no result sebagai domain conflict.

---

## 36. Integrity for Provenance and Evidence

Dalam graph investigasi/regulatory, setiap fact penting harus punya provenance.

Contoh relationship:

```text
(:Person)-[:CONTROLS {source, confidence, observedAt}]->(:Company)
```

Pertanyaan:

- dari mana fakta ini berasal?
- kapan diamati?
- siapa yang menyatakan?
- confidence berapa?
- apakah fakta diverifikasi?
- apakah fakta masih berlaku?

Constraint minimal:

```cypher
CREATE CONSTRAINT controls_source_exists IF NOT EXISTS
FOR ()-[r:CONTROLS]-()
REQUIRE r.source IS NOT NULL;

CREATE CONSTRAINT controls_observed_at_exists IF NOT EXISTS
FOR ()-[r:CONTROLS]-()
REQUIRE r.observedAt IS NOT NULL;
```

Tetapi untuk provenance kaya, lebih baik model:

```text
(:Person)-[:SUBJECT]->(:ControlAssertion)-[:OBJECT]->(:Company)
(:ControlAssertion)-[:SUPPORTED_BY]->(:Evidence)
(:ControlAssertion)-[:ASSERTED_BY]->(:Source)
```

Relationship property cukup jika provenance sederhana. Assertion node lebih baik jika fact perlu lifecycle, dispute, evidence, confidence, review, dan audit.

---

## 37. Schema Drift Detection

Graph flexible membuat drift mudah terjadi.

Contoh drift:

```text
:Customer has customerId, custId, customer_id
:Account has accountId, id, acctNo
:Case has status OPEN, Open, open, ACTIVE
```

Gunakan query inspeksi.

### 37.1 Inspect Labels

```cypher
CALL db.labels()
YIELD label
RETURN label
ORDER BY label;
```

### 37.2 Inspect Relationship Types

```cypher
CALL db.relationshipTypes()
YIELD relationshipType
RETURN relationshipType
ORDER BY relationshipType;
```

### 37.3 Inspect Property Keys

```cypher
CALL db.propertyKeys()
YIELD propertyKey
RETURN propertyKey
ORDER BY propertyKey;
```

### 37.4 Find Missing Required Property

```cypher
MATCH (c:Customer)
WHERE c.customerId IS NULL
RETURN count(c) AS missingCustomerId;
```

### 37.5 Find Duplicate Identity

```cypher
MATCH (c:Customer)
WITH c.customerId AS customerId, count(*) AS n
WHERE customerId IS NOT NULL AND n > 1
RETURN customerId, n
ORDER BY n DESC
LIMIT 20;
```

### 37.6 Find Unexpected Status

```cypher
MATCH (c:Case)
RETURN c.status AS status, count(*) AS n
ORDER BY n DESC;
```

### 37.7 Find Cross-Tenant Relationship

```cypher
MATCH (c:Customer)-[r:OWNS]->(a:Account)
WHERE c.tenantId <> a.tenantId
RETURN c.customerId, c.tenantId, a.accountId, a.tenantId, type(r)
LIMIT 50;
```

Run these as data quality checks.

---

## 38. Java Application Patterns for Integrity

### 38.1 Centralize Cypher Writes

Jangan biarkan semua service/class membuat graph mutation sendiri-sendiri.

Buruk:

```text
CustomerController writes Customer
AccountController writes OWNS
BatchJob writes Account differently
AdminScript creates Customer without constraint-aware merge
```

Lebih baik:

```text
GraphCommandRepository
  createOrUpdateCustomer
  createOrUpdateAccount
  linkCustomerOwnsAccount
  openCase
  attachEvidence
  escalateCase
```

Setiap method punya:

- parameter typed,
- tenant guard,
- idempotency semantics,
- expected result count,
- exception mapping,
- logging/audit.

### 38.2 Map Constraint Errors Deliberately

Pseudo-code:

```java
try {
    neo4jClient.query(cypher)
        .bindAll(params)
        .run();
} catch (Neo4jException ex) {
    if (isConstraintViolation(ex)) {
        throw new DataIntegrityViolation("Graph identity constraint failed", ex);
    }
    if (isTransient(ex)) {
        throw new RetryableGraphWriteFailure(ex);
    }
    throw ex;
}
```

Jangan semua error dianggap 500 generik.

### 38.3 Validate Result Count

Mutation query harus mengembalikan signal.

Contoh:

```cypher
MATCH (c:Case {tenantId: $tenantId, caseId: $caseId})
WHERE c.status = "OPEN"
SET c.status = "ESCALATED"
RETURN c.caseId AS caseId
```

Jika result kosong:

- case tidak ada,
- tenant salah,
- status bukan OPEN,
- command invalid.

Aplikasi harus membedakan sejauh mungkin.

### 38.4 Use Domain-Specific Commands

Daripada expose generic graph write:

```java
executeCypher(String cypher, Map<String,Object> params)
```

Lebih aman:

```java
escalateCase(EscalateCaseCommand command)
attachEvidence(AttachEvidenceCommand command)
assignOfficer(AssignOfficerCommand command)
```

Graph mutation adalah domain operation, bukan CRUD bebas.

---

## 39. Schema Contract in CI/CD

Untuk tim besar, schema graph harus masuk CI/CD.

### 39.1 Test Constraint Presence

Test startup/staging:

```cypher
SHOW CONSTRAINTS
YIELD name
RETURN collect(name) AS constraints;
```

Assert expected names.

### 39.2 Test Index Presence

```cypher
SHOW INDEXES
YIELD name, state
RETURN name, state;
```

Assert:

```text
required indexes exist and state = ONLINE
```

### 39.3 Test Query Plan Shape

Untuk query kritis, simpan expectation umum:

- must use index seek,
- must not do full label scan,
- must not produce cartesian product,
- max estimated row threshold.

Jangan terlalu brittle terhadap operator detail, tapi cukup untuk menangkap regression besar.

### 39.4 Golden Dataset

Buat small graph dataset yang memuat:

- normal cases,
- duplicates attempted,
- missing property attempted,
- cross-tenant attempted,
- temporal overlap attempted,
- high-degree boundary,
- optional relationship missing,
- invalid status.

Test mutation dan query terhadap dataset ini.

---

## 40. Practical Decision Matrix

### 40.1 Should This Be a Constraint?

Gunakan constraint jika:

```text
- invariant sederhana,
- harus ditegakkan di semua writer,
- violation berarti data rusak,
- bisa diekspresikan oleh Neo4j constraint,
- tidak bergantung pada banyak node/relationship lain.
```

Contoh:

```text
Customer.customerId unique
Case.caseId unique per tenant
Evidence.evidenceId exists
Transfer.transactionId unique
```

### 40.2 Should This Be an Index?

Gunakan index jika:

```text
- property sering dipakai sebagai query entry point,
- predicate cukup selektif,
- query latency penting,
- query catalog membuktikan kebutuhan,
- write overhead masih dapat diterima.
```

Contoh:

```text
Case by tenantId/status/openedAt
Account by accountId
Evidence full-text by title/summary
Document vector embedding search
```

### 40.3 Should This Be Application Logic?

Gunakan application logic jika:

```text
- invariant melibatkan beberapa node/relationship,
- butuh workflow state,
- butuh authorization context,
- butuh temporal overlap logic,
- butuh external service validation,
- butuh audit decision.
```

Contoh:

```text
case escalation rules
segregation of duties
no self-approval
valid interval overlap
access control trimming
```

### 40.4 Should This Be a Data Quality Job?

Gunakan data quality job jika:

```text
- invariant historis perlu dipantau,
- data datang dari banyak source,
- legacy data mungkin kotor,
- violation tidak selalu harus block write,
- perlu reporting/reconciliation.
```

Contoh:

```text
orphan evidence
cross-tenant relationship
unexpected status values
duplicate aliases
stale embeddings
missing provenance on old facts
```

---

## 41. Common Mistakes

### Mistake 1 — No Unique Constraint on External IDs

Gejala:

```text
MERGE terlihat aman, tapi duplicate entity muncul.
```

Fix:

```cypher
CREATE CONSTRAINT uniq_customer_customer_id IF NOT EXISTS
FOR (c:Customer)
REQUIRE c.customerId IS UNIQUE;
```

Atau composite per tenant.

### Mistake 2 — Indexing Every Property

Gejala:

```text
Write lambat, disk besar, index tidak jelas dipakai.
```

Fix:

- mulai dari query catalog,
- index only query entry points,
- hapus unused indexes.

### Mistake 3 — Using Index to Avoid Modelling Relationships

Gejala:

```text
Graph hanya kumpulan node dengan foreign-key-like properties.
```

Fix:

- jadikan relationship semantic first-class,
- query relationship, bukan hanya property filter.

### Mistake 4 — No Tenant Guard

Gejala:

```text
Cross-tenant relationship accidentally created.
```

Fix:

- composite keys with tenantId,
- tenant guard in every query,
- data quality checks,
- possibly database-per-tenant for high isolation.

### Mistake 5 — Relationship Properties Become Hidden Nodes

Gejala:

```text
Relationship punya 20 properties, status, approval, evidence, lifecycle.
```

Fix:

- reify into node.

### Mistake 6 — Constraint Added Before Cleaning Data

Gejala:

```text
CREATE CONSTRAINT gagal karena existing duplicate/missing data.
```

Fix:

- validate,
- clean/backfill,
- create constraint.

### Mistake 7 — Full-Text/Vector Result Treated as Truth

Gejala:

```text
Search result dianggap verified relationship.
```

Fix:

- distinguish candidate retrieval from verified fact,
- add provenance,
- human review where needed.

---

## 42. Worked Example: Case Management Graph Schema

### 42.1 Domain

Kita punya enforcement case management graph:

```text
Customer owns Account
Account sends Transaction to Account
Customer subject of Case
Case has Allegation
Case supported by Evidence
Case reviewed by Officer
Case may violate Regulation
```

### 42.2 Core Constraints

```cypher
CREATE CONSTRAINT key_customer IF NOT EXISTS
FOR (c:Customer)
REQUIRE (c.tenantId, c.customerId) IS NODE KEY;

CREATE CONSTRAINT key_account IF NOT EXISTS
FOR (a:Account)
REQUIRE (a.tenantId, a.accountId) IS NODE KEY;

CREATE CONSTRAINT key_case IF NOT EXISTS
FOR (c:Case)
REQUIRE (c.tenantId, c.caseId) IS NODE KEY;

CREATE CONSTRAINT key_evidence IF NOT EXISTS
FOR (e:Evidence)
REQUIRE (e.tenantId, e.evidenceId) IS NODE KEY;

CREATE CONSTRAINT key_officer IF NOT EXISTS
FOR (o:Officer)
REQUIRE (o.tenantId, o.officerId) IS NODE KEY;

CREATE CONSTRAINT uniq_regulation_code IF NOT EXISTS
FOR (r:Regulation)
REQUIRE r.code IS UNIQUE;
```

### 42.3 Required Properties

```cypher
CREATE CONSTRAINT case_status_exists IF NOT EXISTS
FOR (c:Case)
REQUIRE c.status IS NOT NULL;

CREATE CONSTRAINT case_opened_at_exists IF NOT EXISTS
FOR (c:Case)
REQUIRE c.openedAt IS NOT NULL;

CREATE CONSTRAINT evidence_source_exists IF NOT EXISTS
FOR (e:Evidence)
REQUIRE e.source IS NOT NULL;

CREATE CONSTRAINT allegation_type_exists IF NOT EXISTS
FOR (a:Allegation)
REQUIRE a.type IS NOT NULL;
```

### 42.4 Operational Indexes

```cypher
CREATE INDEX idx_case_tenant_status_opened IF NOT EXISTS
FOR (c:Case)
ON (c.tenantId, c.status, c.openedAt);

CREATE INDEX idx_case_tenant_priority IF NOT EXISTS
FOR (c:Case)
ON (c.tenantId, c.priority);

CREATE INDEX idx_account_tenant_status IF NOT EXISTS
FOR (a:Account)
ON (a.tenantId, a.status);
```

### 42.5 Investigation Search Indexes

```cypher
CREATE FULLTEXT INDEX ftx_customer_search IF NOT EXISTS
FOR (c:Customer)
ON EACH [c.name, c.email, c.phone];

CREATE FULLTEXT INDEX ftx_evidence_search IF NOT EXISTS
FOR (e:Evidence)
ON EACH [e.title, e.summary, e.extractedText];

CREATE FULLTEXT INDEX ftx_regulation_search IF NOT EXISTS
FOR (r:Regulation)
ON EACH [r.title, r.description];
```

### 42.6 Query: Find Open Cases for Tenant

```cypher
MATCH (c:Case)
WHERE c.tenantId = $tenantId
  AND c.status = "OPEN"
RETURN c
ORDER BY c.openedAt DESC
LIMIT 100
```

Expected support:

```text
idx_case_tenant_status_opened
```

### 42.7 Query: Attach Evidence Safely

```cypher
MATCH (c:Case {tenantId: $tenantId, caseId: $caseId})
MATCH (e:Evidence {tenantId: $tenantId, evidenceId: $evidenceId})
MERGE (c)-[r:SUPPORTED_BY]->(e)
ON CREATE SET
  r.attachedAt = datetime(),
  r.attachedBy = $actorId
RETURN c.caseId AS caseId, e.evidenceId AS evidenceId
```

Properties:

- tenant guard exists on both nodes,
- `MERGE` prevents duplicate active link,
- relationship has audit properties.

### 42.8 Query: Escalate Case with Invariant

```cypher
MATCH (c:Case {tenantId: $tenantId, caseId: $caseId})
WHERE c.status = "OPEN"
AND EXISTS {
  MATCH (c)-[:HAS_ALLEGATION]->(:Allegation {status: "ACTIVE"})
}
AND EXISTS {
  MATCH (c)-[:SUPPORTED_BY]->(:Evidence)
}
SET c.status = "ESCALATED",
    c.escalatedAt = datetime(),
    c.escalatedBy = $actorId
RETURN c.caseId AS caseId, c.status AS status
```

This invariant is application/query enforced, not pure constraint.

### 42.9 Data Quality Query: Orphan Evidence

```cypher
MATCH (e:Evidence {tenantId: $tenantId})
WHERE NOT EXISTS {
  MATCH (:Case {tenantId: $tenantId})-[:SUPPORTED_BY]->(e)
}
RETURN e.evidenceId AS evidenceId, e.source AS source
LIMIT 100
```

### 42.10 Data Quality Query: Case Without Allegation

```cypher
MATCH (c:Case {tenantId: $tenantId})
WHERE NOT EXISTS {
  MATCH (c)-[:HAS_ALLEGATION]->(:Allegation)
}
RETURN c.caseId AS caseId, c.status AS status
LIMIT 100
```

These checks should run periodically or in audit reports.

---

## 43. Checklist: Designing Neo4j Constraints

Gunakan checklist ini saat review model.

```text
Entity identity:
[ ] Apakah setiap core entity punya stable key?
[ ] Apakah key global atau tenant-scoped?
[ ] Apakah constraint uniqueness/node key sudah dibuat?
[ ] Apakah alternate key perlu unique constraint?

Required properties:
[ ] Property mana yang wajib untuk semantic correctness?
[ ] Apakah property wajib berlaku untuk semua node label itu?
[ ] Apakah perlu label lebih spesifik untuk contract lebih kuat?

Relationship identity:
[ ] Relationship mana event-like?
[ ] Relationship mana current-state-like?
[ ] Relationship mana boleh duplicate?
[ ] Relationship mana butuh relationship key?
[ ] Relationship mana sebaiknya menjadi node?

Tenant integrity:
[ ] Apakah semua node tenant-scoped punya tenantId?
[ ] Apakah semua mutation query guard tenantId?
[ ] Apakah cross-tenant relationship dicek?

Temporal integrity:
[ ] Apakah validFrom/validTo diperlukan?
[ ] Apakah overlap dicegah?
[ ] Apakah current vs historical fact jelas?

Provenance:
[ ] Apakah fact penting punya source?
[ ] Apakah evidence linked?
[ ] Apakah confidence/verification status diperlukan?
```

---

## 44. Checklist: Designing Neo4j Indexes

```text
Query catalog:
[ ] Query apa yang paling sering?
[ ] Query apa yang latency-critical?
[ ] Query apa yang user-facing?
[ ] Query apa yang batch/analytics dan tidak perlu OLTP latency?

Entry points:
[ ] Dari label/property mana query dimulai?
[ ] Apakah property cukup selektif?
[ ] Apakah query anchor jelas sebelum traversal?

Composite index:
[ ] Apakah property order mengikuti query?
[ ] Apakah tenantId harus masuk?
[ ] Apakah status/date/priority sering digabung?

Text/full-text/vector:
[ ] Apakah ini exact lookup, string search, full-text search, atau semantic search?
[ ] Apakah search result hanya candidate atau verified fact?
[ ] Apakah authorization trimming dilakukan setelah retrieval?

Write cost:
[ ] Apakah index memperlambat write-heavy ingestion?
[ ] Apakah index diperlukan saat import?
[ ] Apakah index lama tidak terpakai bisa dihapus?

Operations:
[ ] Apakah index migration diuji di dataset besar?
[ ] Apakah index state ONLINE sebelum query baru dirilis?
[ ] Apakah ada monitoring slow query setelah perubahan?
```

---

## 45. Mini Lab

### 45.1 Setup Sample Data

```cypher
CREATE (:Customer {tenantId: "T1", customerId: "C1", name: "Ari", status: "ACTIVE"});
CREATE (:Customer {tenantId: "T1", customerId: "C2", name: "Bima", status: "ACTIVE"});
CREATE (:Account {tenantId: "T1", accountId: "A1", status: "OPEN"});
CREATE (:Account {tenantId: "T1", accountId: "A2", status: "OPEN"});
CREATE (:Case {tenantId: "T1", caseId: "CASE1", status: "OPEN", openedAt: datetime()});
```

### 45.2 Add Constraints

```cypher
CREATE CONSTRAINT key_customer_lab IF NOT EXISTS
FOR (c:Customer)
REQUIRE (c.tenantId, c.customerId) IS NODE KEY;

CREATE CONSTRAINT key_account_lab IF NOT EXISTS
FOR (a:Account)
REQUIRE (a.tenantId, a.accountId) IS NODE KEY;

CREATE CONSTRAINT key_case_lab IF NOT EXISTS
FOR (c:Case)
REQUIRE (c.tenantId, c.caseId) IS NODE KEY;
```

### 45.3 Try Duplicate

```cypher
CREATE (:Customer {tenantId: "T1", customerId: "C1", name: "Duplicate Ari"});
```

Expected:

```text
Write fails because node key/uniqueness is violated.
```

### 45.4 Add Relationship

```cypher
MATCH (c:Customer {tenantId: "T1", customerId: "C1"})
MATCH (a:Account {tenantId: "T1", accountId: "A1"})
MERGE (c)-[:OWNS]->(a);
```

Run twice. It should not create duplicate `OWNS` relationship because `MERGE` uses the same bound nodes and relationship pattern.

### 45.5 Inspect Plan

```cypher
EXPLAIN
MATCH (c:Customer {tenantId: "T1", customerId: "C1"})-[:OWNS]->(a:Account)
RETURN a;
```

Expected mental model:

```text
Use index-backed lookup/seek for Customer key, then expand OWNS.
```

### 45.6 Add Operational Index

```cypher
CREATE INDEX idx_case_lab_status IF NOT EXISTS
FOR (c:Case)
ON (c.tenantId, c.status, c.openedAt);
```

Test:

```cypher
EXPLAIN
MATCH (c:Case)
WHERE c.tenantId = "T1"
  AND c.status = "OPEN"
RETURN c
ORDER BY c.openedAt DESC;
```

---

## 46. What Top 1% Engineers Internalize

Top engineers do not think:

```text
Graph database is schema-less, so I can model later.
```

They think:

```text
Graph database lets me evolve shape, but production graph needs explicit contracts around identity, traversal, mutation, and integrity.
```

They do not ask only:

```text
Should I add an index?
```

They ask:

```text
What query needs this access path?
What is the starting node?
How selective is it?
What traversal follows?
What write cost does the index add?
Can this index hide a bad graph model?
```

They do not ask only:

```text
Can Neo4j store this relationship?
```

They ask:

```text
Is this relationship a state, event, assertion, interval, or derived edge?
Can it duplicate?
Does it need identity?
Does it need provenance?
Should it be a node?
```

They do not trust application convention alone.

They combine:

```text
constraints + query design + Java domain logic + data quality jobs + operational monitoring
```

That is what turns Neo4j from an exploratory graph into a production-grade graph system.

---

## 47. Key Takeaways

1. Neo4j is flexible, not schema-free in the architectural sense.
2. Constraints protect identity and simple integrity invariants.
3. Indexes provide access paths; they do not guarantee correctness.
4. Unique constraints and node keys are essential for idempotent ingestion.
5. Relationship duplication must be designed intentionally per relationship type.
6. Composite indexes should follow real query access patterns.
7. Full-text and vector indexes produce candidates, not verified truth.
8. Multi-tenant graph requires explicit tenant guards and data quality checks.
9. Temporal/provenance invariants often require application-level logic or reified nodes.
10. Schema migration should be versioned, tested, and monitored.
11. The healthiest Neo4j systems document labels, relationship types, identity rules, constraints, indexes, and invariants.
12. Graph schema is not just data shape; it is the contract that makes traversal meaningful, safe, and fast.

---

## 48. References

- Neo4j Cypher Manual — Constraints: https://neo4j.com/docs/cypher-manual/current/schema/constraints/
- Neo4j Cypher Manual — Indexes: https://neo4j.com/docs/cypher-manual/current/indexes/
- Neo4j Operations Manual — Index configuration: https://neo4j.com/docs/operations-manual/current/performance/index-configuration/
- Neo4j Cypher Manual — Full-text indexes: https://neo4j.com/docs/cypher-manual/current/indexes/semantic-indexes/full-text-indexes/
- Neo4j Cypher Manual — Show indexes: https://neo4j.com/docs/cypher-manual/current/indexes/search-performance-indexes/list-indexes/
- Neo4j Cypher Manual — Show constraints: https://neo4j.com/docs/cypher-manual/current/schema/constraints/list-constraints/

---

## 49. Status Seri

```text
Part 000 selesai — Orientation
Part 001 selesai — Graph Thinking
Part 002 selesai — Property Graph Model Deep Dive
Part 003 selesai — Neo4j Architecture
Part 004 selesai — Cypher Fundamentals
Part 005 selesai — Cypher Path Semantics
Part 006 selesai — Graph Modelling Methodology
Part 007 selesai — Advanced Graph Modelling Patterns
Part 008 selesai — Anti-Patterns in Graph Modelling
Part 009 selesai — Schema, Constraints, Indexes, and Data Integrity

Seri belum selesai.
Masih ada Part 010 sampai Part 032.
```

Part berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-010.md
```

Topik berikutnya:

```text
Write Modelling: MERGE, Idempotency, Upserts, and Concurrency
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-008.md">⬅️ Part 008 — Anti-Patterns in Graph Modelling</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-010.md">Part 010 — Write Modelling: `MERGE`, Idempotency, Upserts, and Concurrency ➡️</a>
</div>
