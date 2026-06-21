# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-008.md

# Part 008 — Anti-Patterns in Graph Modelling

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: mengenali, mendiagnosis, dan memperbaiki model graph yang buruk sebelum menjadi production failure  
> Status: Part 008 dari 032

---

## 0. Tujuan Bagian Ini

Sampai bagian sebelumnya, kita sudah membangun fondasi:

- graph thinking,
- property graph model,
- mental model storage/query runtime Neo4j,
- Cypher fundamentals,
- path semantics,
- modelling methodology,
- advanced modelling patterns.

Bagian ini sengaja mengambil sudut sebaliknya: **bagaimana graph model gagal**.

Graph database sering terlihat sangat fleksibel. Kamu bisa membuat node dengan label apa pun, relationship type apa pun, dan property apa pun. Fleksibilitas ini berguna, tetapi juga berbahaya. Tanpa disiplin modelling, graph bisa berubah menjadi:

- relational schema yang dipindahkan mentah-mentah,
- document store yang dicacah menjadi node kecil-kecil,
- event log yang ditaruh dalam graph tanpa traversal value,
- knowledge graph palsu tanpa semantics,
- graph raksasa yang query-nya selalu meledak,
- sistem yang sulit diaudit karena meaning relationship tidak jelas.

Tujuan bagian ini adalah membuatmu mampu menjawab:

1. Apakah model ini benar-benar graph-shaped?
2. Apakah relationship punya makna bisnis atau hanya join teknis?
3. Apakah traversal penting sudah murah dan aman?
4. Apakah query utama punya batas fan-out yang realistis?
5. Apakah graph ini bisa bertahan terhadap data growth, audit, security, dan perubahan domain?
6. Apakah desain ini akan menjadi production incident enam bulan lagi?

Part ini tidak akan membahas syntax dasar Cypher lagi kecuali untuk menunjukkan contoh failure.

---

## 1. Mental Model Utama: Graph Model Buruk Biasanya Gagal Karena Semantics, Bukan Syntax

Kesalahan beginner sering terlihat seperti syntax query yang salah.

Kesalahan senior sering lebih halus:

- modelnya terlihat valid,
- query bisa jalan,
- data bisa di-load,
- demo terlihat bagus,
- tetapi saat data real masuk, traversal menjadi tidak terkendali,
- hasil query sulit dijelaskan,
- security trimming sulit,
- perubahan requirement memaksa refactor besar.

Graph database tidak otomatis membuat relationship menjadi meaningful. Relationship hanya menjadi kuat ketika:

```text
relationship type + direction + endpoints + properties + lifecycle
```

memiliki makna domain yang jelas.

Contoh relationship yang kuat:

```cypher
(:Person)-[:CONTROLS {since, source, confidence}]->(:Company)
```

Ini menjawab:

- siapa mengontrol apa,
- arah kontrol dari mana ke mana,
- sejak kapan,
- berdasarkan sumber apa,
- seberapa yakin.

Contoh relationship yang lemah:

```cypher
(:Record)-[:RELATED_TO]->(:Record)
```

Masalahnya bukan karena `RELATED_TO` tidak boleh dipakai sama sekali. Masalahnya adalah relationship ini terlalu generik. Ia tidak menjelaskan apakah relasi tersebut berarti:

- owns,
- controls,
- transacts with,
- employs,
- authorizes,
- escalated from,
- references,
- duplicates,
- suspiciously similar to,
- same real-world entity,
- appears in same document.

Graph yang relationship-nya tidak jelas akan cepat menjadi semantic swamp.

---

## 2. Anti-Pattern #1 — Table-to-Node Translation Tanpa Graph Intent

### 2.1 Bentuk Anti-Pattern

Ini terjadi ketika relational model dipindahkan ke Neo4j secara mekanis:

```text
Customer table      -> (:Customer)
Account table       -> (:Account)
Transaction table   -> (:Transaction)
Case table          -> (:Case)
User table          -> (:User)
```

Lalu foreign key dijadikan relationship:

```cypher
(:Customer)-[:FK_CUSTOMER_ACCOUNT]->(:Account)
(:Account)-[:FK_ACCOUNT_TRANSACTION]->(:Transaction)
(:Case)-[:FK_CASE_CUSTOMER]->(:Customer)
```

Secara teknis ini graph. Secara konseptual ini belum tentu graph database design.

### 2.2 Mengapa Buruk

Masalahnya bukan bahwa tabel tidak boleh menjadi node. Banyak node memang berasal dari entity table. Masalahnya adalah ketika desain berhenti di situ.

Graph model yang baik tidak bertanya:

```text
Tabel apa saja yang ada?
```

Ia bertanya:

```text
Pertanyaan konektivitas apa yang harus murah?
Path apa yang harus bisa dijelaskan?
Relationship apa yang punya makna bisnis?
Traversal apa yang sering terjadi?
```

Relational-to-graph translation mekanis sering menghasilkan relationship teknis, bukan relationship domain.

Buruk:

```cypher
(:Case)-[:FK_CASE_CUSTOMER]->(:Customer)
```

Lebih baik:

```cypher
(:Case)-[:INVESTIGATES]->(:Customer)
(:Case)-[:OPENED_FOR]->(:Account)
(:Customer)-[:OWNS]->(:Account)
(:Account)-[:SENT_FUNDS_TO]->(:Account)
```

Versi kedua menjelaskan domain.

### 2.3 Gejala di Production

Gejala umum:

- query Cypher terasa seperti join SQL yang lebih panjang,
- relationship type memakai nama foreign key,
- domain expert tidak bisa membaca graph tanpa engineer,
- tidak ada traversal yang benar-benar lebih natural daripada SQL,
- model tidak membantu explainability,
- query utama tetap berorientasi attribute lookup, bukan connection discovery.

### 2.4 Cara Memperbaiki

Ambil setiap relationship teknis dan tanyakan:

```text
Apa kata kerja domain-nya?
```

Contoh transformasi:

| Relationship teknis | Pertanyaan domain | Relationship domain |
|---|---|---|
| `FK_CASE_CUSTOMER` | Case ini melakukan apa terhadap customer? | `(:Case)-[:INVESTIGATES]->(:Customer)` |
| `FK_TX_FROM_ACCOUNT` | Transaction mengalir dari mana? | `(:Transaction)-[:FROM]->(:Account)` |
| `FK_TX_TO_ACCOUNT` | Transaction mengalir ke mana? | `(:Transaction)-[:TO]->(:Account)` |
| `FK_EMPLOYEE_DEPT` | Employee berada di unit apa? | `(:Employee)-[:ASSIGNED_TO]->(:Department)` |
| `FK_APPROVAL_USER` | User bertindak sebagai apa? | `(:User)-[:APPROVED]->(:Decision)` |

Checklist refactor:

1. Rename relationship berdasarkan verb domain.
2. Tentukan direction berdasarkan natural question.
3. Pastikan relationship type tidak hanya merepresentasikan join.
4. Tambahkan property hanya jika property tersebut menjelaskan relationship.
5. Uji dengan domain question, bukan ERD.

---

## 3. Anti-Pattern #2 — Node sebagai Table Row Tanpa Relationship Meaning

### 3.1 Bentuk Anti-Pattern

Semua record dijadikan node, bahkan record yang tidak pernah ditraverse sebagai node.

```cypher
(:CustomerName {value: 'Alice'})
(:CustomerEmail {value: 'alice@example.com'})
(:CustomerPhone {value: '+62...'})
(:CustomerStatus {value: 'ACTIVE'})
```

Lalu:

```cypher
(:Customer)-[:HAS_NAME]->(:CustomerName)
(:Customer)-[:HAS_EMAIL]->(:CustomerEmail)
(:Customer)-[:HAS_PHONE]->(:CustomerPhone)
(:Customer)-[:HAS_STATUS]->(:CustomerStatus)
```

Ini sering muncul ketika engineer menganggap “semakin graph semakin baik”.

### 3.2 Mengapa Buruk

Tidak semua data layak menjadi node.

Sebuah value layak menjadi node jika minimal salah satu benar:

1. Value itu menjadi titik traversal penting.
2. Value itu menghubungkan banyak entity.
3. Value itu punya lifecycle sendiri.
4. Value itu punya properties sendiri.
5. Value itu perlu provenance/audit sendiri.
6. Value itu menjadi subject dari relationship lain.
7. Value itu dipakai untuk entity resolution atau network discovery.

Email sebagai property:

```cypher
(:Person {email: 'alice@example.com'})
```

Email sebagai node:

```cypher
(:Person)-[:USES_EMAIL]->(:EmailAddress {value: 'alice@example.com'})
```

Keduanya bisa benar.

Email sebagai node masuk akal jika kamu perlu mencari:

- banyak person memakai email yang sama,
- email dipakai oleh account berbeda,
- email muncul dalam evidence berbeda,
- email punya risk score,
- email diverifikasi oleh source tertentu,
- email punya lifecycle dan validity period.

Jika email hanya atribut login biasa, node tambahan hanya membuat graph lebih mahal.

### 3.3 Gejala di Production

- Query sederhana butuh banyak hop.
- Jumlah node meledak tanpa traversal value.
- Visualisasi graph penuh node value kecil.
- Query menjadi noisy.
- Constraint lebih banyak tapi invariant tidak lebih kuat.
- Developer bingung: “ini property atau node?” karena tidak ada aturan.

### 3.4 Cara Memperbaiki

Gunakan decision rule:

```text
Jika sesuatu hanya mendeskripsikan entity dan tidak pernah menjadi pusat hubungan, jadikan property.
Jika sesuatu punya identity, lifecycle, sharing, provenance, atau traversal value, jadikan node.
```

Contoh:

| Data | Biasanya property | Biasanya node |
|---|---:|---:|
| `fullName` | Ya | Tidak, kecuali entity resolution khusus |
| `email` | Ya | Ya, untuk fraud / identity graph |
| `phoneNumber` | Ya | Ya, untuk risk / shared contact detection |
| `country` | Ya | Bisa node jika ada hierarchy / policy / jurisdiction graph |
| `status` | Ya | Tidak, kecuali status lifecycle sebagai state machine graph |
| `regulation` | Tidak | Ya, jika case/decision/evidence mengacu ke pasal/regulasi |
| `address` | Ya | Ya, jika address dipakai untuk linkage/network analysis |

---

## 4. Anti-Pattern #3 — Property Bag Tanpa Semantic Structure

### 4.1 Bentuk Anti-Pattern

Node dipakai seperti document store longgar:

```cypher
(:Entity {
  id: 'E-123',
  type: 'PERSON',
  name: 'Alice',
  companyId: 'C-777',
  caseId: 'CASE-9',
  relatedEntityIds: ['E-55', 'E-56'],
  metadata: '{...json...}'
})
```

Atau satu label generik:

```cypher
(:Thing {kind: 'Person', ...})
(:Thing {kind: 'Company', ...})
(:Thing {kind: 'Case', ...})
```

### 4.2 Mengapa Buruk

Property graph bukan berarti semua domain semantics boleh disembunyikan dalam property.

Jika relationship penting disimpan sebagai ID property, Neo4j tidak bisa men-traverse relationship itu sebagai graph.

Buruk:

```cypher
(:Case {subjectCustomerId: 'C-123'})
```

Lebih baik:

```cypher
(:Case {caseNo: 'CASE-1'})-[:SUBJECT_OF]->(:Customer {customerId: 'C-123'})
```

Buruk:

```cypher
(:Entity {relatedEntityIds: ['E1', 'E2', 'E3']})
```

Lebih baik:

```cypher
(:Entity {id:'E0'})-[:RELATED_BY_SHARED_ADDRESS]->(:Entity {id:'E1'})
(:Entity {id:'E0'})-[:RELATED_BY_SHARED_PHONE]->(:Entity {id:'E2'})
```

### 4.3 Gejala di Production

- Query memakai string matching dan array scanning, bukan traversal.
- Banyak property bernama `type`, `kind`, `category`, `relatedIds`, `metadata`.
- Relationship count rendah meskipun domain highly connected.
- Developer membuat logic join di Java service.
- Neo4j menjadi key-value/document store mahal.

### 4.4 Cara Memperbaiki

Gunakan rule:

```text
Jika property berisi ID entity lain, besar kemungkinan itu relationship tersembunyi.
Jika property berisi list ID, hampir pasti itu graph yang belum dimodelkan.
Jika property JSON berisi domain event/relationship/evidence, mungkin perlu diangkat menjadi node/relationship.
```

Namun jangan ekstrem. Tidak semua JSON metadata harus dipecah. Pecah hanya jika:

- dipakai untuk traversal,
- dipakai untuk filter kritis,
- perlu constraint,
- perlu audit/provenance,
- perlu explainability.

---

## 5. Anti-Pattern #4 — Relationship Type Explosion

### 5.1 Bentuk Anti-Pattern

Relationship type dibuat terlalu spesifik, sering berdasarkan value data.

```cypher
(:Person)-[:PURCHASED_PRODUCT_123]->(:Product)
(:Person)-[:PURCHASED_PRODUCT_456]->(:Product)
(:Person)-[:TRANSFERRED_ON_2026_01_01]->(:Account)
(:Person)-[:WORKS_AT_GOOGLE]->(:Company)
(:Person)-[:OWNS_30_PERCENT]->(:Company)
```

Atau setiap status menjadi relationship type:

```cypher
(:Case)-[:ESCALATED_PENDING_REVIEW]->(:Team)
(:Case)-[:ESCALATED_APPROVED]->(:Team)
(:Case)-[:ESCALATED_REJECTED]->(:Team)
```

### 5.2 Mengapa Buruk

Relationship type seharusnya merepresentasikan **jenis hubungan**, bukan instance data.

Buruk:

```cypher
(:Person)-[:OWNS_30_PERCENT]->(:Company)
```

Lebih baik:

```cypher
(:Person)-[:OWNS {percentage: 30.0}]->(:Company)
```

Buruk:

```cypher
(:Case)-[:ESCALATED_PENDING_REVIEW]->(:Team)
```

Lebih baik:

```cypher
(:Case)-[:ESCALATED_TO {status: 'PENDING_REVIEW'}]->(:Team)
```

Atau jika escalation adalah event/lifecycle entity:

```cypher
(:Case)-[:HAS_ESCALATION]->(:Escalation {status:'PENDING_REVIEW'})-[:TARGET_TEAM]->(:Team)
```

### 5.3 Gejala di Production

- Ribuan relationship type.
- Query harus membangun dynamic relationship type.
- Model sulit dibaca.
- Tidak ada taxonomy relation yang stabil.
- Migration sulit karena semantic tersebar di type name.
- Developer bingung apakah value baru perlu relationship type baru.

### 5.4 Cara Memperbaiki

Pisahkan:

```text
relationship type = predicate / verb / semantic category
relationship property = measurement / status / timestamp / confidence / source / quantity
node = entity yang punya identity dan relationship sendiri
```

Contoh:

| Jangan | Gunakan |
|---|---|
| `TRANSFERRED_100_USD_TO` | `TRANSFERRED_TO {amount:100, currency:'USD'}` |
| `OWNS_30_PERCENT` | `OWNS {percentage:30}` |
| `WORKS_AT_GOOGLE` | `WORKS_AT` ke node `Company` |
| `ESCALATED_APPROVED` | `ESCALATED_TO {status:'APPROVED'}` atau node `Escalation` |
| `PURCHASED_PRODUCT_123` | `PURCHASED` ke node `Product` |

Relationship type harus relatif stabil. Jika jumlahnya bertambah terus mengikuti data instance, itu alarm.

---

## 6. Anti-Pattern #5 — Label Explosion

### 6.1 Bentuk Anti-Pattern

Label dipakai seperti tag bebas atau value kategori granular:

```cypher
(:Person:Customer:VIP:Jakarta:HighRisk:Reviewed2026:SegmentA:CampaignX)
```

Atau label dibuat dari source/system/value:

```cypher
(:CustomerFromCRM)
(:CustomerFromCoreBanking)
(:CustomerFromExcelUpload)
(:CustomerFromPartnerApi)
```

### 6.2 Mengapa Buruk

Label berguna untuk classification dan index planning. Namun label bukan pengganti property, relationship, provenance, atau taxonomy.

Buruk:

```cypher
(:Person:HighRisk)
```

Bisa benar jika `HighRisk` adalah classification penting yang stabil dan sering dipakai sebagai anchor query.

Tetapi jika risk score berubah setiap hari, lebih baik:

```cypher
(:Person {riskScore: 87, riskBand: 'HIGH'})
```

Atau jika risk assessment punya lifecycle:

```cypher
(:Person)-[:HAS_RISK_ASSESSMENT]->(:RiskAssessment {
  score: 87,
  band: 'HIGH',
  assessedAt: datetime(),
  modelVersion: 'risk-v4'
})
```

### 6.3 Gejala di Production

- Banyak label yang sebenarnya status sementara.
- Query memakai label dinamis.
- Sulit menentukan constraint/index per label.
- Label menjadi campuran entity type, data source, state, segment, flag.
- Schema discovery berisik.

### 6.4 Cara Memperbaiki

Gunakan aturan:

```text
Label = stable classification yang membantu semantic dan query anchoring.
Property = attribute/value yang berubah atau memfilter.
Relationship = koneksi ke konsep lain.
Node = konsep yang punya lifecycle/identity/relationship.
```

Contoh:

| Konsep | Label? | Alternatif |
|---|---:|---|
| `Person` | Ya | Entity label |
| `Company` | Ya | Entity label |
| `HighRisk` | Kadang | Property atau RiskAssessment node |
| `Jakarta` | Jarang | Property `city` atau `(:Location)` |
| `ImportedFromCRM` | Jarang | Property `sourceSystem` atau provenance relationship |
| `Reviewed2026` | Tidak | Review node/event |
| `VIP` | Kadang | Label jika stable segment; property jika mutable |

---

## 7. Anti-Pattern #6 — Generic Relationship: `RELATED_TO`, `HAS`, `LINKED_TO`, `ASSOCIATED_WITH`

### 7.1 Bentuk Anti-Pattern

Graph dipenuhi relationship generik:

```cypher
(:Person)-[:RELATED_TO]->(:Company)
(:Company)-[:RELATED_TO]->(:Address)
(:Case)-[:RELATED_TO]->(:Evidence)
(:Evidence)-[:RELATED_TO]->(:Document)
```

Atau:

```cypher
(:A)-[:HAS]->(:B)
(:A)-[:LINKED_TO]->(:C)
```

### 7.2 Mengapa Buruk

Relationship generik menghilangkan semantic discrimination.

Query berikut menjadi tidak jelas:

```cypher
MATCH (p:Person)-[:RELATED_TO*1..3]-(x)
RETURN x
```

Apa arti hasilnya?

- ownership?
- employment?
- shared phone?
- same address?
- evidence mention?
- suspicious association?
- legal control?
- operational contact?

Untuk use case investigasi, perbedaan itu sangat penting. Tidak semua association punya bobot, legal meaning, atau risk implication yang sama.

### 7.3 Kapan Relationship Generik Masih Boleh

Tidak semua generic relation salah. Kadang `ASSOCIATED_WITH` bisa dipakai sebagai **derived relationship** dengan properties yang menjelaskan asalnya:

```cypher
(:Person)-[:ASSOCIATED_WITH {
  reasons: ['SHARED_PHONE', 'CO_DIRECTOR'],
  confidence: 0.82,
  derivedAt: datetime(),
  modelVersion: 'assoc-v2'
}]->(:Person)
```

Namun relationship ini harus jelas sebagai derived summary, bukan pengganti semua relation asli.

Lebih baik tetap simpan relation penyebab:

```cypher
(:Person)-[:USES_PHONE]->(:PhoneNumber)<-[:USES_PHONE]-(:Person)
(:Person)-[:DIRECTOR_OF]->(:Company)<-[:DIRECTOR_OF]-(:Person)
```

Lalu derived edge:

```cypher
(:Person)-[:ASSOCIATED_WITH {reasonCount:2, confidence:0.82}]->(:Person)
```

### 7.4 Cara Memperbaiki

Ganti generic type dengan taxonomy relation:

| Generic | Lebih baik |
|---|---|
| `RELATED_TO` | `OWNS`, `CONTROLS`, `EMPLOYED_BY`, `MENTIONED_IN`, `USES_ADDRESS`, `SUBJECT_OF` |
| `HAS` | `HAS_ACCOUNT`, `HAS_EVIDENCE`, `HAS_VERSION`, atau model ulang sesuai domain |
| `LINKED_TO` | `SHARES_PHONE_WITH`, `TRANSFERRED_TO`, `MATCHED_AS_DUPLICATE_OF` |
| `ASSOCIATED_WITH` | Simpan sebagai derived summary dengan `reason`, bukan relation primer |

Pertanyaan kunci:

```text
Jika relationship ini muncul di audit report, apakah maknanya bisa dipertanggungjawabkan?
```

Jika tidak, relation terlalu generik.

---

## 8. Anti-Pattern #7 — Over-Reification: Semua Relationship Dijadikan Node

### 8.1 Bentuk Anti-Pattern

Alih-alih relationship langsung:

```cypher
(:Person)-[:OWNS {percentage: 30}]->(:Company)
```

Semua dibuat node:

```cypher
(:Person)-[:PARTICIPATES_IN]->(:Ownership)-[:TARGETS]->(:Company)
```

Atau:

```cypher
(:Person)-[:HAS_EMPLOYMENT]->(:Employment)-[:AT_COMPANY]->(:Company)
(:Person)-[:HAS_ADDRESS_USAGE]->(:AddressUsage)-[:ADDRESS]->(:Address)
(:Case)-[:HAS_CASE_SUBJECT]->(:CaseSubject)-[:SUBJECT]->(:Person)
```

### 8.2 Mengapa Buruk

Reification berarti mengubah relationship menjadi node. Ini berguna ketika relationship itu punya identity/lifecycle/relasi lain. Tetapi jika dilakukan untuk semua hal, graph menjadi terlalu verbose.

Dampak:

- traversal lebih panjang,
- query lebih sulit dibaca,
- visualisasi noisy,
- performance bisa turun karena setiap relation butuh dua hop,
- business semantics tersebar di node perantara.

### 8.3 Kapan Reification Benar

Relationship perlu menjadi node jika:

1. Relationship punya identity sendiri.
2. Relationship punya lifecycle kompleks.
3. Relationship memiliki banyak participant.
4. Relationship perlu direview/approve/dispute.
5. Relationship punya evidence/provenance banyak.
6. Relationship menjadi target relationship lain.
7. Relationship punya state machine.
8. Relationship punya audit trail detail.

Contoh ownership sederhana:

```cypher
(:Person)-[:OWNS {percentage:30, since:date('2020-01-01')}]->(:Company)
```

Contoh ownership kompleks:

```cypher
(:Person)-[:PARTY_TO]->(:OwnershipInterest {
  id:'OWN-1',
  percentage:30,
  status:'DISPUTED',
  validFrom:date('2020-01-01')
})-[:IN_COMPANY]->(:Company)

(:OwnershipInterest)-[:SUPPORTED_BY]->(:Evidence)
(:OwnershipInterest)-[:REVIEWED_BY]->(:Officer)
(:OwnershipInterest)-[:SUPERSEDED_BY]->(:OwnershipInterest)
```

### 8.4 Cara Memperbaiki

Gunakan rule:

```text
Relationship biasa jika hanya menghubungkan dua endpoint dan membawa sedikit property.
Node reifikasi jika hubungan itu sendiri adalah domain object.
```

Jika kamu tidak bisa memberi nama noun yang natural untuk relationship node, mungkin tidak perlu reification.

- `OwnershipInterest` natural.
- `EmploymentContract` natural.
- `CaseAssignment` natural.
- `RelationshipBetweenPersonAndCompany` tidak natural.

---

## 9. Anti-Pattern #8 — Under-Reification: Relationship Dipaksa Menanggung Terlalu Banyak

### 9.1 Bentuk Anti-Pattern

Kebalikan over-reification: semua dipaksa menjadi relationship property.

```cypher
(:Case)-[:ESCALATED_TO {
  escalationId:'ESC-1',
  requestedBy:'u123',
  approvedBy:'u456',
  rejectedBy:null,
  status:'APPROVED',
  createdAt:..., 
  approvedAt:..., 
  reason:'...',
  appealDeadline:..., 
  evidenceIds:['E1','E2'],
  comments:'...'
}]->(:Team)
```

### 9.2 Mengapa Buruk

Relationship property cocok untuk atribut relationship, tetapi tidak cocok jika relationship sudah menjadi workflow object.

Pada contoh escalation, escalation bukan sekadar edge. Ia punya:

- actor,
- approval,
- evidence,
- status,
- deadline,
- comment,
- audit trail,
- lifecycle,
- mungkin dispute/appeal.

Model lebih baik:

```cypher
(:Case)-[:HAS_ESCALATION]->(:Escalation {id:'ESC-1', status:'APPROVED'})
(:Escalation)-[:REQUESTED_BY]->(:User {id:'u123'})
(:Escalation)-[:APPROVED_BY]->(:User {id:'u456'})
(:Escalation)-[:TARGET_TEAM]->(:Team)
(:Escalation)-[:SUPPORTED_BY]->(:Evidence)
```

### 9.3 Gejala di Production

- Relationship punya banyak property.
- Property berisi foreign ID/list ID.
- Perubahan workflow memaksa rewrite relationship property.
- Sulit audit actor/action.
- Sulit menambahkan evidence/comment/review.
- Banyak null property.

### 9.4 Cara Memperbaiki

Tanyakan:

```text
Apakah relationship ini punya lifecycle?
Apakah relationship ini bisa di-review, dispute, approve, cancel, supersede?
Apakah relationship ini punya participant lebih dari dua?
Apakah relationship ini punya evidence sendiri?
```

Jika ya, buat relationship event/object node.

---

## 10. Anti-Pattern #9 — Supernode yang Tidak Diantisipasi

### 10.1 Bentuk Anti-Pattern

Satu node punya degree sangat besar.

Contoh:

```cypher
(:Country {code:'ID'})<-[:LOCATED_IN]-(:Person) // puluhan juta
(:ProductCategory {name:'Electronics'})<-[:IN_CATEGORY]-(:Product) // jutaan
(:Status {name:'ACTIVE'})<-[:HAS_STATUS]-(:Customer) // jutaan
(:Bank {name:'BigBank'})<-[:USES_BANK]-(:Account) // jutaan
```

Supernode tidak selalu salah. Masalah muncul ketika query harus sering melewati supernode tanpa selective boundary.

### 10.2 Mengapa Buruk

Traversal dari node high-degree bisa menghasilkan fan-out besar.

Misal:

```cypher
MATCH (p:Person)-[:LOCATED_IN]->(:Country {code:'ID'})<-[:LOCATED_IN]-(other:Person)
RETURN other
```

Jika country punya 100 juta person, query ini hampir tidak punya makna.

### 10.3 Gejala di Production

- Query tertentu tiba-tiba lambat saat data tumbuh.
- `PROFILE` menunjukkan expand besar dari node populer.
- Visualisasi membuka satu node membuat browser hang.
- Query rekomendasi menghasilkan hasil terlalu umum.
- “Semua orang terkait karena sama-sama di Indonesia”.

### 10.4 Cara Memperbaiki

Strategi:

1. Jangan traverse melalui konsep terlalu umum tanpa filter.
2. Gunakan property untuk low-value broad attribute.
3. Buat bucket intermediate jika traversal memang diperlukan.
4. Tambahkan semantic specificity.
5. Materialize relation yang lebih meaningful.
6. Pakai degree threshold untuk menghindari common connector.

Buruk:

```cypher
(:Person)-[:LIVES_IN]->(:Country)
```

Jika query butuh local discovery, lebih baik:

```cypher
(:Person)-[:LIVES_IN]->(:City)
(:City)-[:IN_PROVINCE]->(:Province)
(:Province)-[:IN_COUNTRY]->(:Country)
```

Atau untuk address-level linkage:

```cypher
(:Person)-[:USES_ADDRESS]->(:AddressKey {normalizedHash:'...'})
```

Dengan `AddressKey` yang cukup spesifik.

### 10.5 Rule of Thumb

Node populer tidak selalu buruk. Node populer buruk ketika ia dipakai sebagai jembatan similarity/association tanpa menimbang specificity.

Shared phone number lebih meaningful daripada shared country. Shared exact address lebih meaningful daripada shared city. Shared device ID mungkin lebih meaningful daripada shared ISP.

---

## 11. Anti-Pattern #10 — Unbounded Path Query

### 11.1 Bentuk Anti-Pattern

```cypher
MATCH p = (a:Person {id:$id})-[:CONNECTED_TO*]-(b)
RETURN p
```

Atau:

```cypher
MATCH p = (c:Case {id:$id})-[*]-(x)
RETURN p
```

Atau:

```cypher
MATCH p = (a)-[*1..10]-(b)
RETURN p
```

Meski ada batas 10, itu masih bisa meledak jika degree tinggi.

### 11.2 Mengapa Buruk

Path count tumbuh secara eksponensial terhadap branching factor.

Jika rata-rata setiap node punya 20 outgoing relevant relationships:

```text
Depth 1: 20
Depth 2: 400
Depth 3: 8,000
Depth 4: 160,000
Depth 5: 3,200,000
```

Dan ini belum menghitung duplicate paths, cycle, dan relationship type berbeda.

### 11.3 Gejala di Production

- Query development kecil cepat, production lambat.
- Query timeout saat graph makin connected.
- Memory spike.
- Hasil query terlalu banyak untuk user.
- UI graph visualization tidak usable.
- Query memakai `LIMIT` di akhir, tapi tetap mahal karena expansion sudah terjadi.

### 11.4 Cara Memperbaiki

Prinsip:

```text
Batasi traversal sedini mungkin, bukan setelah semua path ditemukan.
```

Gunakan:

- relationship type spesifik,
- direction,
- depth bound,
- node label boundary,
- property filter,
- degree filter,
- path uniqueness logic,
- domain cutoff,
- time window,
- score threshold,
- top-k strategy.

Buruk:

```cypher
MATCH p = (p1:Person {id:$id})-[*1..5]-(x)
RETURN p
LIMIT 100
```

Lebih baik:

```cypher
MATCH p = (p1:Person {id:$id})
  -[:USES_PHONE|USES_EMAIL|DIRECTOR_OF*1..3]-(x)
WHERE x:Person OR x:Company
RETURN p
LIMIT 100
```

Lebih baik lagi jika problem-nya bukan “semua path”, tetapi “apakah reachable” atau “path terpendek”:

```cypher
MATCH p = ANY SHORTEST (a:Person {id:$from})--+(:Person {id:$to})
RETURN p
```

Atau gunakan GDS untuk weighted path algorithms jika cost/weight penting.

---

## 12. Anti-Pattern #11 — Filtering Terlambat Setelah Expansion

### 12.1 Bentuk Anti-Pattern

```cypher
MATCH p = (a:Account {id:$id})-[:TRANSFERRED_TO*1..5]->(b:Account)
WHERE b.riskBand = 'HIGH'
RETURN p
```

Jika filter hanya diterapkan setelah path ditemukan, engine mungkin sudah melakukan expansion besar.

### 12.2 Mengapa Buruk

Graph query performance bergantung pada controlling expansion. Filter yang secara semantik terlihat sederhana belum tentu diterapkan cukup awal untuk mengurangi branching.

### 12.3 Cara Memperbaiki

Jika domain mengizinkan, filter intermediate node/relationship sedini mungkin.

Contoh dengan relationship constraints:

```cypher
MATCH p = (a:Account {id:$id})-[:TRANSFERRED_TO*1..5]->(b:Account {riskBand:'HIGH'})
RETURN p
```

Atau pecah query:

```cypher
MATCH (a:Account {id:$id})
MATCH (target:Account {riskBand:'HIGH'})
MATCH p = ANY SHORTEST (a)-[:TRANSFERRED_TO]+->(target)
RETURN p
LIMIT 20
```

Atau model ulang dengan derived edge:

```cypher
(:Account)-[:HAS_HIGH_RISK_REACHABILITY {maxDepth:3, computedAt:...}]->(:RiskCluster)
```

jika query sering dilakukan dan mahal.

---

## 13. Anti-Pattern #12 — Relationship Tanpa Directional Semantics

### 13.1 Bentuk Anti-Pattern

Engineer membuat semua relationship searah acak atau selalu dua arah:

```cypher
(:Person)-[:KNOWS]->(:Person)
(:Person)<-[:KNOWS]-(:Person)
```

Atau:

```cypher
(:Company)-[:OWNS]->(:Person)
```

padahal domain bertanya person owns company.

### 13.2 Mengapa Buruk

Cypher bisa men-traverse relationship tanpa arah:

```cypher
(a)-[:KNOWS]-(b)
```

Tetapi storage tetap punya direction, dan direction adalah semantic signal penting.

Direction harus menjawab:

```text
Ketika domain expert membaca panah, apakah artinya natural?
```

### 13.3 Cara Memperbaiki

Gunakan convention:

| Domain | Direction yang umum |
|---|---|
| Ownership | Owner -> Owned asset/entity |
| Membership | Member -> Group/Organization |
| Employment | Person -> Company |
| Payment/transfer | Source -> Target |
| Case subject | Case -> Subject atau Subject -> Case, pilih berdasarkan query utama |
| Evidence support | Evidence -> Claim atau Claim -> Evidence, pilih berdasarkan explainability path |
| Hierarchy | Child -> Parent atau Parent -> Child, konsisten dengan traversal utama |

Jika relasi benar-benar symmetric, tetap simpan satu direction konsisten dan query undirected jika perlu.

Contoh:

```cypher
(:Person)-[:SIBLING_OF]->(:Person)
```

Jangan buat dua edge kecuali ada alasan query/performance/semantics yang jelas.

---

## 14. Anti-Pattern #13 — Modelling Every Event as Permanent Traversal Node

### 14.1 Bentuk Anti-Pattern

Setiap event aplikasi menjadi node di graph utama:

```cypher
(:User)-[:DID]->(:LoginEvent)-[:AT]->(:Timestamp)
(:User)-[:DID]->(:ClickEvent)-[:ON]->(:Button)
(:User)-[:DID]->(:PageViewEvent)-[:ON]->(:Page)
(:User)-[:DID]->(:MouseMoveEvent)-[:AT]->(:Coordinate)
```

Event graph bisa valid, tetapi sering menjadi dumping ground.

### 14.2 Mengapa Buruk

Event log besar sering lebih cocok untuk Kafka, object storage, ClickHouse, atau time-series store. Graph utama sebaiknya menyimpan event jika event itu punya graph value:

- mengubah relationship state,
- menjadi evidence,
- menjadi basis link analysis,
- perlu path explainability,
- menjadi domain event penting,
- memiliki participant yang perlu dihubungkan.

### 14.3 Gejala di Production

- Graph dipenuhi event low-value.
- Traversal domain terganggu node event noise.
- Storage tumbuh cepat.
- Query harus selalu filter event type.
- Retention sulit.
- Graph menjadi event warehouse.

### 14.4 Cara Memperbaiki

Pisahkan:

```text
raw event log       -> stream/log/OLAP storage
state graph         -> current/valid relationships
investigation graph -> selected evidence events
analytics graph     -> projected features/relationships
```

Contoh:

Raw transactions sangat banyak. Jangan semua query traversal selalu melewati node transaction jika use case utama adalah account network.

Model bisa hybrid:

```cypher
(:Account)-[:TRANSFERRED_TO {totalAmount, count, firstSeen, lastSeen}]->(:Account)
```

untuk traversal cepat, sementara raw transaction disimpan di OLAP/source system.

Jika transaction menjadi evidence penting:

```cypher
(:Case)-[:USES_AS_EVIDENCE]->(:TransactionEvidence)-[:FROM]->(:Account)
(:TransactionEvidence)-[:TO]->(:Account)
```

---

## 15. Anti-Pattern #14 — Graph sebagai OLAP Warehouse

### 15.1 Bentuk Anti-Pattern

Neo4j dipakai untuk query seperti:

```text
total transaction amount per day per region per product category for last 3 years
```

Atau:

```text
aggregate 5 billion events by hour and segment
```

### 15.2 Mengapa Buruk

Graph database unggul untuk connected data dan traversal. Ia bukan pengganti columnar OLAP untuk aggregation besar-besaran.

Jika query utama adalah scan + aggregate besar, graph bukan storage paling efisien.

### 15.3 Cara Memperbaiki

Gunakan pembagian workload:

```text
Neo4j      -> relationship discovery, path explanation, network context
ClickHouse -> large-scale aggregation, time-window metrics, dashboards
Postgres   -> transactional source-of-truth / relational constraints
Kafka      -> event movement
Elasticsearch -> text search
```

Neo4j tetap bisa menyimpan aggregated relationship summary untuk traversal:

```cypher
(:Account)-[:TRANSFERRED_TO {
  total30d: 1200000,
  count30d: 42,
  lastTransferAt: datetime()
}]->(:Account)
```

Tetapi jangan memaksa Neo4j menghitung semua metric historis mentah setiap request.

---

## 16. Anti-Pattern #15 — Graph sebagai Full-Text Search Replacement

### 16.1 Bentuk Anti-Pattern

Semua kebutuhan search dokumen dipindahkan ke Neo4j:

```text
Cari semua dokumen yang mengandung frasa tertentu,
ranking berdasarkan relevance,
highlight matching snippet,
faceted search,
fuzzy query,
language analyzer.
```

Neo4j punya text/full-text/vector index capabilities, tetapi bukan berarti ia selalu menggantikan search engine khusus.

### 16.2 Cara Berpikir yang Benar

Gunakan Neo4j untuk:

- entity relationship context,
- document-to-entity graph,
- evidence linkage,
- citation graph,
- semantic expansion,
- post-search graph exploration.

Gunakan search engine untuk:

- full-text ranking,
- analyzer bahasa,
- fuzzy matching,
- high-volume document retrieval,
- search UI facets.

Arsitektur sehat:

```text
Elasticsearch/OpenSearch -> menemukan dokumen kandidat
Neo4j                    -> menjelaskan entity/relationship/context dari dokumen kandidat
```

Atau:

```text
Vector search -> candidate semantic chunks
Neo4j         -> expand ke entity, evidence, case, regulation, decision path
```

---

## 17. Anti-Pattern #16 — Derived Relationship Tanpa Provenance

### 17.1 Bentuk Anti-Pattern

```cypher
(:Person)-[:SUSPICIOUSLY_CONNECTED_TO {score:0.91}]->(:Person)
```

Tidak ada informasi:

- kenapa suspicious,
- dihitung kapan,
- model versi apa,
- berdasarkan data apa,
- apakah masih valid,
- siapa yang menyetujui,
- apakah pernah direview.

### 17.2 Mengapa Buruk

Derived edge sangat berguna untuk performance dan analytics, tetapi berbahaya jika tidak bisa dijelaskan. Di domain risk/enforcement, derived relationship tanpa provenance bisa menjadi regulatory liability.

### 17.3 Cara Memperbaiki

Minimal:

```cypher
(:Person)-[:SUSPICIOUSLY_CONNECTED_TO {
  score: 0.91,
  reasons: ['SHARED_DEVICE', 'COMMON_DIRECTOR', 'HIGH_VALUE_TRANSFER'],
  computedAt: datetime('2026-06-21T10:00:00Z'),
  modelVersion: 'link-risk-v3',
  evidenceCount: 7
}]->(:Person)
```

Lebih defensible:

```cypher
(:Person)-[:HAS_ASSOCIATION_FINDING]->(:AssociationFinding {
  id:'AF-1',
  score:0.91,
  status:'REVIEW_REQUIRED',
  modelVersion:'link-risk-v3',
  computedAt: datetime()
})-[:TARGET]->(:Person)

(:AssociationFinding)-[:SUPPORTED_BY]->(:Evidence)
(:AssociationFinding)-[:BASED_ON]->(:SharedDevice)
(:AssociationFinding)-[:BASED_ON]->(:TransferPattern)
```

Rule:

```text
Jika edge mempengaruhi keputusan manusia, edge harus explainable.
```

---

## 18. Anti-Pattern #17 — Multi-Tenant Graph Dicampur Tanpa Boundary

### 18.1 Bentuk Anti-Pattern

Semua tenant dalam satu graph tanpa tenant boundary kuat:

```cypher
(:Customer {id:'C1'})
(:Case {id:'CASE1'})
(:Officer {id:'U1'})
```

Tenant disimpan sebagai property tidak konsisten:

```cypher
(:Customer {tenant:'A'})
(:Case {tenantId:'A'})
(:Evidence {org:'A'})
```

Query lupa filter tenant:

```cypher
MATCH (c:Customer)-[:SUBJECT_OF]-(case:Case)
RETURN c, case
```

### 18.2 Mengapa Buruk

Graph traversal mudah menyeberangi boundary jika model tidak kuat. Ini lebih berbahaya daripada table query karena path bisa menghubungkan data lintas tenant secara tidak sengaja.

### 18.3 Pilihan Model

#### Option A — Separate database per tenant

Kuat untuk isolation, mahal secara operasi.

#### Option B — Tenant node boundary

```cypher
(:Tenant {id:'T1'})-[:OWNS_CUSTOMER]->(:Customer)
(:Tenant {id:'T1'})-[:OWNS_CASE]->(:Case)
```

Query selalu anchored dari tenant.

#### Option C — Tenant property + constraints + query discipline

Lebih sederhana, tetapi rawan jika query tidak disiplin.

#### Option D — Physical separation per tenant class

Untuk tenant besar/regulasi tinggi.

### 18.4 Cara Memperbaiki

Rule:

```text
Semua query multi-tenant harus tenant-anchored di awal, bukan tenant-filtered di akhir.
```

Buruk:

```cypher
MATCH (c:Customer)-[:SUBJECT_OF]->(case:Case)
WHERE c.tenantId = $tenantId AND case.tenantId = $tenantId
RETURN c, case
```

Lebih baik:

```cypher
MATCH (:Tenant {id:$tenantId})-[:OWNS_CUSTOMER]->(c:Customer)-[:SUBJECT_OF]->(case:Case)
RETURN c, case
```

Atau gunakan database-level isolation jika consequence dari leakage tinggi.

---

## 19. Anti-Pattern #18 — Security Trimming Dipikirkan Terlambat

### 19.1 Bentuk Anti-Pattern

Graph dibuat untuk semua relationship, lalu belakangan ditanya:

```text
Bagaimana memastikan user hanya melihat node/path yang boleh dia lihat?
```

### 19.2 Mengapa Buruk

Dalam graph, access control bukan hanya node-level. Path bisa membocorkan informasi:

- existence of relationship,
- existence of hidden node,
- degree count,
- inferred association,
- shortest path melalui confidential entity.

Contoh:

```cypher
MATCH p = ANY SHORTEST (a:Person {id:$a})--+(:Person {id:$b})
RETURN length(p)
```

Bahkan jika node intermediate disembunyikan, jawaban bahwa path exists bisa membocorkan informasi.

### 19.3 Cara Memperbaiki

Access model harus didesain bersama graph model.

Pertanyaan wajib:

1. Apakah user boleh tahu node ini ada?
2. Apakah user boleh tahu relationship ini ada?
3. Apakah user boleh melihat property relationship?
4. Apakah user boleh tahu path exists?
5. Apakah aggregation count bisa membocorkan data?
6. Apakah derived edge mengandung evidence confidential?
7. Apakah GDS result boleh ditampilkan?

Pattern:

```cypher
(:User)-[:MEMBER_OF]->(:Team)-[:CAN_ACCESS]->(:Case)
(:Case)-[:HAS_EVIDENCE]->(:Evidence)
```

Atau security trimming di service layer dengan query yang tenant/case anchored.

---

## 20. Anti-Pattern #19 — Audit dan Temporal Validity Tidak Dimodelkan

### 20.1 Bentuk Anti-Pattern

```cypher
(:Person)-[:OWNS {percentage: 40}]->(:Company)
```

Lalu saat ownership berubah:

```cypher
SET r.percentage = 20
```

Riwayat hilang.

### 20.2 Mengapa Buruk

Untuk domain compliance, enforcement, finance, governance, dan legal, pertanyaan penting bukan hanya “apa yang benar sekarang”, tetapi:

```text
Apa yang diketahui saat keputusan dibuat?
Berdasarkan evidence apa?
Siapa yang mengubah?
Kapan validity berubah?
Apakah fakta ini masih berlaku?
```

### 20.3 Cara Memperbaiki

Tambahkan temporal validity:

```cypher
(:Person)-[:OWNS {
  percentage: 40,
  validFrom: date('2020-01-01'),
  validTo: date('2024-12-31'),
  source: 'registry-2024'
}]->(:Company)
```

Untuk lifecycle kompleks, gunakan fact node:

```cypher
(:Person)-[:SUBJECT]->(:OwnershipFact {
  percentage:40,
  validFrom:date('2020-01-01'),
  validTo:date('2024-12-31'),
  assertedAt:datetime(),
  status:'SUPERSEDED'
})-[:OBJECT]->(:Company)

(:OwnershipFact)-[:SUPPORTED_BY]->(:Evidence)
(:OwnershipFact)-[:ASSERTED_BY]->(:Source)
```

Rule:

```text
Jika graph mendukung keputusan yang diaudit, jangan hanya simpan current state.
```

---

## 21. Anti-Pattern #20 — Business Logic Tersembunyi dalam Query Cypher Ad Hoc

### 21.1 Bentuk Anti-Pattern

Aplikasi punya banyak query seperti:

```cypher
MATCH (p:Person)-[:USES_PHONE]->(ph)<-[:USES_PHONE]-(other)
WHERE p.riskBand = 'HIGH'
  AND other.status <> 'CLOSED'
  AND ph.verified = true
  AND NOT (p)-[:WHITELISTED_WITH]-(other)
RETURN other
```

Query ini tersebar di banyak service, job, dashboard, dan notebook.

### 21.2 Mengapa Buruk

Cypher bisa menjadi tempat business rule tersembunyi. Ini membuat:

- rule tidak versioned,
- audit sulit,
- hasil antar aplikasi tidak konsisten,
- perubahan rule rawan regression,
- testing sulit.

### 21.3 Cara Memperbaiki

Pisahkan:

```text
query pattern = cara mengambil kandidat
business policy = rule eksplisit, versioned, tested
finding/result = node/edge yang menyimpan hasil evaluasi
```

Contoh:

```cypher
(:AssociationRule {id:'shared-phone-v2', version:'2.0'})
(:AssociationFinding {score:0.78, status:'OPEN'})
(:AssociationFinding)-[:EVALUATED_BY]->(:AssociationRule)
```

Di Java, buat query object / repository method yang diberi nama domain:

```java
findSharedVerifiedPhoneAssociations(personId, tenantId, ruleVersion)
```

Bukan generic:

```java
runCypher(String query)
```

---

## 22. Anti-Pattern #21 — Visualisasi Graph Dianggap Sama dengan Validasi Model

### 22.1 Bentuk Anti-Pattern

Model dianggap bagus karena terlihat menarik di Neo4j Browser/Bloom:

```text
Node warna-warni, banyak relationship, demo stakeholder senang.
```

### 22.2 Mengapa Buruk

Visualisasi bagus tidak membuktikan:

- query penting cepat,
- semantics jelas,
- fan-out terkendali,
- security benar,
- audit lengkap,
- model tahan data growth.

Graph demo sering memakai dataset kecil. Banyak model gagal ketika data real 1000x lebih besar.

### 22.3 Cara Memperbaiki

Validasi model dengan:

1. Query catalogue.
2. Representative data volume.
3. Cardinality estimate.
4. `PROFILE` untuk query penting.
5. Worst-case traversal test.
6. Security leakage test.
7. Data quality test.
8. Audit/explainability walkthrough.
9. Domain expert review.
10. Refactoring exercise.

Visualisasi adalah alat komunikasi, bukan proof of design.

---

## 23. Anti-Pattern #22 — Tidak Ada Query Catalogue

### 23.1 Bentuk Anti-Pattern

Model dibuat dari noun list:

```text
Person, Company, Account, Case, Evidence, Regulation...
```

Tetapi tidak ada daftar pertanyaan utama.

### 23.2 Mengapa Buruk

Graph model seharusnya dioptimalkan untuk pertanyaan konektivitas. Tanpa query catalogue, kamu tidak tahu:

- relationship mana yang penting,
- direction mana yang natural,
- depth berapa yang realistis,
- index apa yang perlu,
- path mana yang harus murah,
- derived edge mana yang layak.

### 23.3 Cara Memperbaiki

Buat query catalogue minimal:

| ID | Pertanyaan | Anchor | Path | Max depth | Expected cardinality | SLA |
|---|---|---|---|---:|---:|---:|
| Q1 | Related parties of a case | Case | Case -> Subject -> Shared identifiers -> Person | 3 | < 500 | 500ms |
| Q2 | Ownership chain | Company | Company <- OWNS <- Person/Company | 5 | < 1000 | 1s |
| Q3 | Evidence supporting decision | Decision | Decision -> Evidence -> Source | 2 | < 200 | 300ms |
| Q4 | Conflict of interest | Officer | Officer -> Organization -> Subject | 4 | < 100 | 1s |

Setiap model change harus diuji terhadap catalogue ini.

---

## 24. Anti-Pattern #23 — No Cardinality Budget

### 24.1 Bentuk Anti-Pattern

Model dibuat tanpa memperkirakan degree dan fan-out:

```text
Person -> Phone
Person -> Address
Person -> Account
Account -> Transaction
Transaction -> Merchant
Merchant -> Category
```

Tapi tidak ada yang menghitung:

- berapa phone per person,
- berapa person per phone,
- berapa account per person,
- berapa transaction per account,
- berapa transaction per merchant,
- berapa merchant per category.

### 24.2 Mengapa Buruk

Graph modelling tanpa cardinality budget seperti membuat distributed system tanpa traffic estimate.

### 24.3 Cara Memperbaiki

Buat degree table:

| Node/Relationship | Avg degree | P95 | P99 | Max | Risk |
|---|---:|---:|---:|---:|---|
| Person-USES_PHONE | 2 | 5 | 12 | 200 | shared call center? |
| Phone-USED_BY_PERSON | 1.2 | 3 | 30 | 50k | disposable/common phone |
| Account-TRANSFERRED_TO | 20 | 500 | 10k | 2M | super account |
| Category-HAS_PRODUCT | 10k | 1M | 5M | 30M | supernode |

Lalu tetapkan guard:

```text
Do not expand from Phone if degree > 100 unless investigator explicitly requests.
Do not use Category as similarity connector.
Do not return all transactions beyond 90-day window.
```

---

## 25. Anti-Pattern #24 — “Graph Can Answer Anything” Mindset

### 25.1 Bentuk Anti-Pattern

Tim memasukkan semua data ke Neo4j dengan asumsi:

```text
Nanti semua pertanyaan bisa dijawab dari graph.
```

### 25.2 Mengapa Buruk

Graph adalah model. Semua model punya bias. Graph yang bagus untuk path discovery mungkin buruk untuk aggregation. Graph yang bagus untuk current state mungkin buruk untuk historical replay. Graph yang bagus untuk investigation mungkin terlalu mahal untuk real-time transactional write path.

### 25.3 Cara Memperbaiki

Tetapkan bounded purpose:

```text
Graph ini dipakai untuk:
- related-party discovery,
- ownership/control path,
- evidence explanation,
- case linkage,
- risk network context.

Graph ini tidak dipakai untuk:
- raw event analytics,
- full-text document search,
- high-frequency transactional ledger,
- source-of-truth customer master,
- dashboard aggregation historis.
```

Bounded purpose membuat model lebih tajam.

---

## 26. Anti-Pattern #25 — Source-of-Truth Ambiguity

### 26.1 Bentuk Anti-Pattern

Neo4j berisi data dari CRM, core system, case management, registry, dan analyst input. Tetapi tidak jelas mana yang authoritative.

```cypher
(:Person {name:'Alice', address:'A'})
```

Apakah name dari CRM? Registry? Manual correction? Latest event? Analyst assertion?

### 26.2 Mengapa Buruk

Graph menggabungkan banyak sumber. Tanpa provenance, konflik data menjadi sulit.

### 26.3 Cara Memperbaiki

Gunakan provenance:

```cypher
(:Person)-[:HAS_ASSERTION]->(:NameAssertion {
  value:'Alice Tan',
  assertedAt:datetime(),
  confidence:0.93,
  status:'ACTIVE'
})-[:ASSERTED_BY]->(:Source {name:'NationalRegistry'})
```

Atau untuk property sederhana:

```cypher
(:Person {
  canonicalName:'Alice Tan',
  canonicalNameSource:'NationalRegistry',
  canonicalNameUpdatedAt:datetime()
})
```

Rule:

```text
Canonical property boleh disimpan untuk query cepat, tetapi source/provenance harus tersedia jika keputusan diaudit.
```

---

## 27. Anti-Pattern #26 — Duplicate Entity Tidak Ditangani sebagai First-Class Problem

### 27.1 Bentuk Anti-Pattern

Graph menganggap setiap external ID unik sebagai real-world entity unik.

```cypher
(:Person {source:'CRM', id:'123', name:'Alice'})
(:Person {source:'Registry', id:'A-999', name:'Alice Tan'})
(:Person {source:'CaseSystem', id:'P-77', name:'A. Tan'})
```

Tidak ada entity resolution.

### 27.2 Mengapa Buruk

Graph value sangat bergantung pada connectivity. Duplicate entity memecah graph.

Akibat:

- related party discovery tidak lengkap,
- risk network terfragmentasi,
- centrality salah,
- investigation melewatkan connection,
- path explanation misleading.

### 27.3 Cara Memperbaiki

Pisahkan source entity dan canonical entity.

```cypher
(:SourcePerson {source:'CRM', sourceId:'123'})-[:RESOLVED_TO]->(:Person {canonicalId:'P1'})
(:SourcePerson {source:'Registry', sourceId:'A-999'})-[:RESOLVED_TO]->(:Person {canonicalId:'P1'})
```

Atau simpan match candidate:

```cypher
(:SourcePerson)-[:POSSIBLY_SAME_AS {
  score:0.86,
  reasons:['NAME_SIMILARITY','SAME_DOB'],
  status:'NEEDS_REVIEW'
}]->(:SourcePerson)
```

Jangan langsung merge irreversible jika confidence belum cukup.

---

## 28. Anti-Pattern #27 — Relationship sebagai Cache Tanpa Invalidation Strategy

### 28.1 Bentuk Anti-Pattern

Materialized relationship dibuat untuk mempercepat query:

```cypher
(:Person)-[:RELATED_TO_CASE]->(:Case)
(:Person)-[:CAN_ACCESS]->(:Resource)
(:Company)-[:HAS_RISK_EXPOSURE_TO]->(:Company)
```

Tetapi tidak ada mekanisme update/invalidation.

### 28.2 Mengapa Buruk

Derived edge bisa menjadi stale. Dalam graph, stale edge berbahaya karena terlihat seperti fakta.

### 28.3 Cara Memperbaiki

Setiap derived edge harus punya:

- `derivedAt`,
- `derivedBy`,
- `modelVersion` atau `ruleVersion`,
- input version/window,
- TTL atau recompute policy,
- status,
- source query/job.

Contoh:

```cypher
(:Person)-[:CAN_ACCESS {
  derivedAt: datetime(),
  ruleVersion:'access-v5',
  validUntil: datetime('2026-06-22T00:00:00Z')
}]->(:Case)
```

Dan pipeline:

```text
source change -> affected subgraph detection -> delete/update derived edges -> verify counts -> publish metrics
```

---

## 29. Anti-Pattern #28 — Graph Model Tidak Punya Evolution Strategy

### 29.1 Bentuk Anti-Pattern

Model dibuat sekali, lalu semua query/application bergantung pada shape itu. Saat requirement berubah, migration menjadi chaos.

### 29.2 Mengapa Buruk

Graph model akan berubah. Relationship yang dulu cukup sederhana bisa berubah menjadi workflow object. Property bisa berubah menjadi node. Derived edge bisa diganti algorithm baru.

Tanpa evolution strategy:

- query lama patah,
- data lama tidak konsisten,
- migration lama,
- dual model tidak jelas,
- application logic bercabang.

### 29.3 Cara Memperbaiki

Gunakan model versioning:

```cypher
(:GraphModelVersion {version:'2026.06', deployedAt:datetime()})
```

Praktisnya:

1. Buat new shape berdampingan.
2. Backfill new shape.
3. Dual-read atau read-fallback sementara.
4. Switch query critical path.
5. Validate count/path equivalence.
6. Stop writing old shape.
7. Remove old shape setelah retention.

Contoh property ke node:

Lama:

```cypher
(:Person {email:'a@example.com'})
```

Baru:

```cypher
(:Person)-[:USES_EMAIL]->(:EmailAddress {value:'a@example.com'})
```

Migration harus mempertimbangkan duplicate email, constraint, null, invalid email, source conflict.

---

## 30. Anti-Pattern #29 — Tidak Ada Testing untuk Graph Invariants

### 30.1 Bentuk Anti-Pattern

Testing hanya memeriksa query mengembalikan data. Tidak ada invariant.

### 30.2 Graph Invariant Examples

Contoh invariant:

```text
Setiap Case harus punya tepat satu primary subject.
Setiap Evidence harus terhubung ke minimal satu Case atau Finding.
Tidak boleh ada path CAN_ACCESS dari User ke Case lintas tenant.
Ownership percentage aktif untuk satu company tidak boleh total > 100 tanpa explicit exception.
Escalation APPROVED harus punya APPROVED_BY dan approvedAt.
Derived edge harus punya derivedAt dan ruleVersion.
Person tidak boleh RESOLVED_TO dua canonical Person aktif.
```

### 30.3 Cara Menulis Invariant Query

Contoh: case tanpa subject.

```cypher
MATCH (c:Case)
WHERE NOT (c)-[:HAS_PRIMARY_SUBJECT]->(:Person)
RETURN c.caseId AS caseId
LIMIT 100
```

Contoh: cross-tenant leak.

```cypher
MATCH (:Tenant {id:$tenantId})-[:OWNS_CASE]->(c:Case)
MATCH (c)-[*1..3]-(x)
WHERE x.tenantId IS NOT NULL AND x.tenantId <> $tenantId
RETURN c.caseId, x
LIMIT 100
```

Invariant query harus menjadi bagian CI/data quality job, bukan manual check.

---

## 31. Anti-Pattern #30 — Neo4j Dipakai untuk Workflow State Machine Mentah

### 31.1 Bentuk Anti-Pattern

Setiap state transition workflow dibuat sebagai graph traversal utama:

```cypher
(:Case)-[:MOVED_TO]->(:State {name:'REVIEW'})-[:MOVED_TO]->(:State {name:'APPROVED'})
```

Atau semua instance case state berbagi node state global:

```cypher
(:Case)-[:IN_STATE]->(:State {name:'OPEN'})
```

Jika semua case yang open terhubung ke satu state node, itu supernode.

### 31.2 Mengapa Buruk

Workflow state machine sering lebih baik sebagai property/event log, kecuali ada reason graph-specific.

Buruk jika:

- `State` global menjadi supernode,
- traversal melalui state menghubungkan semua case open,
- state node tidak punya relationship value,
- graph dipakai sebagai process engine.

### 31.3 Cara Memperbaiki

Current state sebagai property:

```cypher
(:Case {status:'OPEN'})
```

State transition sebagai event jika audit diperlukan:

```cypher
(:Case)-[:HAS_STATE_CHANGE]->(:StateChange {
  from:'OPEN',
  to:'REVIEW',
  changedAt:datetime(),
  reason:'threshold exceeded'
})-[:CHANGED_BY]->(:User)
```

Policy/regulation graph bisa tetap graph:

```cypher
(:Case)-[:EVALUATED_AGAINST]->(:Regulation)
(:Decision)-[:SUPPORTED_BY]->(:Evidence)
```

Jangan membuat `(:State {name:'OPEN'})` sebagai hub semua case kecuali memang ada query semantic yang aman.

---

## 32. Diagnostic Framework: Cara Review Graph Model

Gunakan framework berikut saat design review.

### 32.1 Semantic Review

Tanyakan:

1. Apakah setiap relationship punya verb domain jelas?
2. Apakah direction natural?
3. Apakah relationship type terlalu generik?
4. Apakah label stabil dan meaningful?
5. Apakah property menyembunyikan relationship?
6. Apakah relationship property terlalu berat?
7. Apakah ada fact yang butuh provenance?

### 32.2 Query Review

Tanyakan:

1. Apa top 10 query paling penting?
2. Apa anchor node tiap query?
3. Apa path yang dilalui?
4. Apa maximum depth?
5. Apa expected cardinality?
6. Apa worst-case fan-out?
7. Apakah filter diterapkan sebelum expansion?
8. Apakah query butuh all paths atau cukup reachability/shortest path/top-k?

### 32.3 Performance Review

Tanyakan:

1. Node mana yang berisiko supernode?
2. Relationship mana yang high-cardinality?
3. Index/constraint apa yang menjadi anchor lookup?
4. Apakah ada cartesian product?
5. Apakah ada variable-length query tak terkendali?
6. Apakah derived edge perlu?
7. Apakah workload ini seharusnya OLAP/search, bukan graph?

### 32.4 Correctness Review

Tanyakan:

1. Apa invariant graph?
2. Apa uniqueness constraint?
3. Apa duplicate entity strategy?
4. Apa source-of-truth tiap field/fact?
5. Apa temporal validity strategy?
6. Apa audit/provenance strategy?
7. Apa migration/evolution strategy?

### 32.5 Security Review

Tanyakan:

1. Apakah query tenant-anchored?
2. Apakah path existence bisa bocor?
3. Apakah derived edge mengandung confidential inference?
4. Apakah user boleh melihat relationship property?
5. Apakah GDS score bisa diekspos?
6. Apakah graph visualization bisa membuka node tersembunyi?

---

## 33. Worked Example: Refactoring Graph Buruk untuk Enforcement Case Management

### 33.1 Model Buruk Awal

```cypher
(:Entity {id, type, name, tenantId, relatedIds})
(:Case {id, status, subjectEntityId, assignedUserId, tenantId})
(:Evidence {id, fileName, caseId, metadata})

(:Entity)-[:RELATED_TO]->(:Entity)
(:Case)-[:RELATED_TO]->(:Entity)
(:Case)-[:HAS]->(:Evidence)
(:User)-[:HAS]->(:Case)
```

Masalah:

1. `Entity.type` menyembunyikan label.
2. `relatedIds` menyembunyikan relationship.
3. `RELATED_TO` terlalu generik.
4. `HAS` terlalu generik.
5. `subjectEntityId` adalah relationship tersembunyi.
6. `assignedUserId` adalah relationship tersembunyi.
7. Evidence metadata mungkin menyimpan domain facts tersembunyi.
8. Tenant hanya property, query bisa lupa filter.
9. Tidak ada provenance.
10. Tidak ada query catalogue.

### 33.2 Model Lebih Baik

```cypher
(:Tenant {id})
(:Person {personId, canonicalName})
(:Company {companyId, legalName})
(:Case {caseId, status, openedAt})
(:Evidence {evidenceId, type, collectedAt})
(:User {userId})
(:Finding {findingId, status, score})
(:Source {sourceId, name})
```

Relationships:

```cypher
(:Tenant)-[:OWNS_CASE]->(:Case)
(:Tenant)-[:OWNS_PERSON]->(:Person)
(:Tenant)-[:OWNS_COMPANY]->(:Company)

(:Case)-[:HAS_PRIMARY_SUBJECT]->(:Person)
(:Case)-[:HAS_SUBJECT]->(:Company)
(:Case)-[:ASSIGNED_TO]->(:User)
(:Case)-[:HAS_EVIDENCE]->(:Evidence)

(:Person)-[:DIRECTOR_OF {validFrom, validTo, source}]->(:Company)
(:Person)-[:OWNS {percentage, validFrom, validTo, source}]->(:Company)
(:Person)-[:USES_PHONE {validFrom, source}]->(:PhoneNumber)
(:Company)-[:REGISTERED_AT {source}]->(:Address)

(:Finding)-[:ABOUT]->(:Person)
(:Finding)-[:RELATED_TO_CASE]->(:Case)
(:Finding)-[:SUPPORTED_BY]->(:Evidence)
(:Finding)-[:GENERATED_BY]->(:RuleVersion)
```

### 33.3 Query Menjadi Lebih Defensible

Pertanyaan:

```text
Temukan person lain yang terkait dengan subject case melalui shared phone atau shared company directorship.
```

Query:

```cypher
MATCH (:Tenant {id:$tenantId})-[:OWNS_CASE]->(c:Case {caseId:$caseId})
MATCH (c)-[:HAS_PRIMARY_SUBJECT]->(subject:Person)
CALL {
  WITH subject
  MATCH (subject)-[:USES_PHONE]->(ph:PhoneNumber)<-[:USES_PHONE]-(other:Person)
  RETURN other, 'SHARED_PHONE' AS reason
  UNION
  WITH subject
  MATCH (subject)-[:DIRECTOR_OF]->(co:Company)<-[:DIRECTOR_OF]-(other:Person)
  RETURN other, 'COMMON_DIRECTORSHIP' AS reason
}
RETURN other.personId, collect(DISTINCT reason) AS reasons
LIMIT 100
```

Sekarang hasil bisa dijelaskan:

- karena shared phone,
- karena common directorship,
- bukan sekadar `RELATED_TO`.

---

## 34. Red Flags Checklist

Saat melihat model Neo4j, waspadai tanda berikut:

```text
[ ] Banyak relationship bernama RELATED_TO / HAS / LINKED_TO.
[ ] Banyak property berisi ID entity lain.
[ ] Banyak property JSON besar yang berisi domain facts.
[ ] Label dipakai untuk status sementara.
[ ] Relationship type berisi value instance.
[ ] Semua event low-level masuk graph utama.
[ ] Banyak query variable-length tanpa depth kecil dan relationship type spesifik.
[ ] Query memakai LIMIT di akhir untuk menyembunyikan explosion.
[ ] Tidak ada query catalogue.
[ ] Tidak ada cardinality budget.
[ ] Tidak ada tenant anchoring.
[ ] Tidak ada provenance untuk derived edge.
[ ] Tidak ada temporal validity untuk fact yang diaudit.
[ ] Tidak ada invariant tests.
[ ] Tidak jelas source-of-truth tiap property.
[ ] Neo4j dipakai untuk OLAP scan/aggregate besar.
[ ] Neo4j dipakai menggantikan search engine untuk full-text ranking besar.
[ ] Model terlihat bagus di visualisasi kecil tapi belum dites di data representative.
```

Jika tiga atau lebih checklist ini muncul, model perlu review serius.

---

## 35. Practical Heuristics untuk Java Engineer / Tech Lead

### 35.1 Heuristic: Name Relationship as Domain Verb

Jika relationship tidak bisa dinamai dengan verb domain, jangan buru-buru buat edge.

Buruk:

```text
A related to B
```

Lebih baik:

```text
Person owns Company
Account transferred funds to Account
Evidence supports Finding
Officer approved Decision
Case investigates Person
```

### 35.2 Heuristic: Query First, Schema Second

Untuk setiap model baru, tulis minimal lima query kritis sebelum finalisasi schema.

Jika kamu tidak bisa menulis query yang lebih natural daripada SQL/document search, mungkin graph belum justified.

### 35.3 Heuristic: Every Expansion Needs a Budget

Setiap traversal harus punya budget:

```text
depth <= ?
relationship types = ?
max degree = ?
time window = ?
result cardinality = ?
SLA = ?
```

### 35.4 Heuristic: Derived Edge Is a Cached Claim

Jangan anggap derived edge sebagai fakta mentah. Anggap sebagai klaim hasil komputasi.

Maka ia butuh:

- rule/model version,
- timestamp,
- evidence/reason,
- confidence,
- invalidation/recompute policy.

### 35.5 Heuristic: Audit Changes the Model

Jika sistemmu dipakai untuk compliance, enforcement, risk, finance, legal, atau public-sector decisioning, model harus memuat:

- who knew what,
- when,
- from which source,
- with what confidence,
- under which rule,
- used in which decision.

Graph yang hanya menyimpan current state bisa tidak cukup.

---

## 36. Mini Exercise

Gunakan model berikut:

```cypher
(:Customer {id, name, tenantId, phone, email, status, relatedCustomerIds})
(:Case {id, tenantId, customerId, officerId, status})
(:Officer {id, name, tenantId})
(:Document {id, caseId, text, metadata})

(:Customer)-[:RELATED_TO]->(:Customer)
(:Case)-[:HAS]->(:Document)
```

Tugas:

1. Temukan minimal 10 anti-pattern.
2. Tentukan mana yang harus menjadi node.
3. Tentukan mana yang tetap property.
4. Rename relationship menjadi domain-specific.
5. Tambahkan tenant boundary.
6. Tambahkan provenance untuk document-derived facts.
7. Buat 5 query catalogue.
8. Tentukan cardinality risk.

Contoh jawaban ringkas:

- `phone` mungkin property atau node; untuk fraud/risk, jadikan `(:PhoneNumber)`.
- `email` mungkin `(:EmailAddress)` jika shared identifier penting.
- `relatedCustomerIds` adalah hidden relationship.
- `RELATED_TO` perlu diganti dengan specific relation atau derived association dengan reasons.
- `Case.customerId` adalah hidden relationship `(:Case)-[:HAS_PRIMARY_SUBJECT]->(:Customer)`.
- `Case.officerId` adalah hidden relationship `(:Case)-[:ASSIGNED_TO]->(:Officer)`.
- `HAS` terlalu generik; gunakan `HAS_DOCUMENT` atau `HAS_EVIDENCE`.
- `Document.text` mungkin lebih cocok di search/document store, graph menyimpan metadata/entity mentions.
- Tenant harus menjadi anchor.
- Document-derived facts perlu source/provenance/confidence.

---

## 37. Ringkasan Bagian Ini

Anti-pattern graph modelling biasanya jatuh ke beberapa kelas:

1. **Graph palsu**: relational/document model dipindahkan mentah-mentah.
2. **Semantic lemah**: relationship generik, label kacau, property bag.
3. **Granularity salah**: over-reification atau under-reification.
4. **Traversal tidak terkendali**: supernode, path explosion, filter terlambat.
5. **Wrong workload**: OLAP/search/event log dipaksa ke graph.
6. **Correctness lemah**: source-of-truth, duplicate entity, temporal validity, audit tidak jelas.
7. **Security terlambat**: tenant/access/path leakage tidak dimodelkan sejak awal.
8. **Operational fragility**: derived edge stale, no migration strategy, no invariant tests.

Graph database kuat ketika modelnya membuat relationship penting menjadi explicit, bounded, meaningful, queryable, explainable, dan operable.

Graph database berbahaya ketika fleksibilitasnya dipakai untuk menghindari modelling discipline.

---

## 38. Apa yang Harus Dikuasai Sebelum Lanjut

Sebelum masuk Part 009, pastikan kamu bisa menjawab:

1. Kapan property harus dinaikkan menjadi node?
2. Kapan relationship harus direifikasi menjadi node?
3. Mengapa `RELATED_TO` sering buruk?
4. Mengapa relationship type tidak boleh berisi value instance?
5. Mengapa unbounded traversal berbahaya?
6. Bagaimana supernode terbentuk?
7. Bagaimana tenant leakage bisa terjadi dalam graph?
8. Mengapa derived edge butuh provenance?
9. Apa perbedaan current-state graph dan audit/history graph?
10. Bagaimana membuat query catalogue dan cardinality budget?

Jika jawabanmu masih ragu, ulang bagian 6, 7, 10, 11, 17, 18, 20, dan 23.

---

## 39. Penutup

Part ini adalah rem arsitektural. Tujuannya bukan membuatmu takut memakai Neo4j, tetapi membuatmu lebih tajam.

Graph database bukan magic. Ia sangat powerful ketika dipakai untuk domain yang memang relationally dense dan connection-first. Tetapi ia juga bisa menjadi sistem mahal, lambat, dan sulit diaudit jika modelnya tidak punya semantics, boundary, dan operational discipline.

Bagian berikutnya akan masuk ke mekanisme yang membantu menjaga graph tetap benar dan cepat:

```text
Part 009 — Schema, Constraints, Indexes, and Data Integrity in Neo4j
```

Di sana kita akan membahas bagaimana Neo4j tetap bisa memiliki bentuk schema discipline melalui constraints, indexes, uniqueness, existence, type constraints, dan bagaimana semua itu dipakai untuk menjaga integrity dan query performance.

---

## Status Seri

```text
Part 000 selesai — Orientation: Why Graph Database Exists and What Problem It Actually Solves
Part 001 selesai — Graph Thinking: From Entities to Relationships to Paths
Part 002 selesai — Property Graph Model Deep Dive
Part 003 selesai — Neo4j Architecture: Storage, Query Engine, and Runtime Mental Model
Part 004 selesai — Cypher Fundamentals: Pattern Matching as a Query Language
Part 005 selesai — Cypher Path Semantics: Variable-Length Traversal, Shortest Path, and Expansion Control
Part 006 selesai — Graph Modelling Methodology: From Requirements to Graph Shape
Part 007 selesai — Advanced Graph Modelling Patterns
Part 008 selesai — Anti-Patterns in Graph Modelling

Seri belum selesai.
Masih ada Part 009 sampai Part 032.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-007.md">⬅️ Part 007 — Advanced Graph Modelling Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-009.md">Part 009 — Schema, Constraints, Indexes, and Data Integrity in Neo4j ➡️</a>
</div>
