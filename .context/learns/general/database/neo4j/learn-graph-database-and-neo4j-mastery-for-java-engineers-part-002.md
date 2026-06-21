# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-002.md

# Part 002 — Property Graph Model Deep Dive

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami graph database dan Neo4j sampai level desain, implementasi, troubleshooting, dan pengambilan keputusan arsitektural.  
> Fokus bagian ini: membedah model property graph secara mendalam: node, relationship, label, type, property, identity, temporalitas, provenance, relationship-as-fact, reification, hyperedge, dan schema thinking.

---

## 0. Posisi Part Ini dalam Seri

Di Part 000, kita membangun alasan mengapa graph database ada: bukan karena SQL buruk, bukan karena document database kurang fleksibel, tetapi karena ada kelas masalah yang nilai utamanya berada pada **koneksi** dan **path**.

Di Part 001, kita mulai berpikir dengan elemen graph: entity, relationship, path, neighborhood, fan-out, cycle, component, dan traversal boundary.

Part 002 ini masuk ke fondasi desain Neo4j: **property graph model**.

Kalau Part 001 menjawab:

> “Bagaimana cara melihat domain sebagai graph?”

Part 002 menjawab:

> “Setelah domain terlihat seperti graph, bagaimana kita memutuskan sesuatu menjadi node, relationship, property, label, relationship type, atau model yang lebih kompleks?”

Ini bagian yang sangat penting karena banyak kegagalan graph system bukan terjadi karena Neo4j lambat, Cypher buruk, atau hardware kurang, tetapi karena modelnya gagal menangkap semantik domain.

Graph database sangat sensitif terhadap bentuk model. Di relational database, model yang kurang ideal masih sering bisa diselamatkan dengan join, index, view, materialized view, atau query tuning. Di graph database, model yang salah dapat membuat traversal menjadi mahal, hasil query ambigu, audit tidak defensible, dan evolusi sistem sulit.

---

## 1. Mental Model Utama: Property Graph Bukan “JSON dengan Relationship”

Neo4j memakai model yang biasa disebut **property graph**.

Secara sederhana, property graph terdiri dari:

1. **Node**  
   Merepresentasikan entity, object, concept, state, event, actor, resource, atau thing dalam domain.

2. **Relationship**  
   Merepresentasikan koneksi berarah antara dua node.

3. **Label**  
   Klasifikasi atau tipe konseptual pada node.

4. **Relationship type**  
   Klasifikasi semantik pada relationship.

5. **Property**  
   Key-value attributes yang dapat ditempelkan ke node atau relationship.

Secara visual:

```cypher
(:Person {personId: 'P-001', name: 'Ayu'})
  -[:OWNS {since: date('2022-01-10'), source: 'KYC'}]->
(:Company {companyId: 'C-778', name: 'PT Sagara Data'})
```

Namun definisi sederhana ini mudah menipu. Banyak engineer melihat property graph lalu berpikir:

> “Node mirip table row, relationship mirip foreign key, property mirip column.”

Analogi itu boleh dipakai untuk orientasi awal, tetapi berbahaya jika dipakai terlalu lama.

Relational model menjadikan **tuple dan constraint** sebagai pusat. Property graph menjadikan **connected facts** sebagai pusat.

Perbedaan pentingnya:

| Relational intuition | Property graph intuition |
|---|---|
| Record adalah unit utama | Relationship-aware fact adalah unit utama |
| FK menghubungkan row | Relationship adalah data domain, bukan hanya pointer |
| Join adalah operasi query | Traversal adalah konsekuensi dari shape data |
| Table schema dominan | Graph shape dan query path dominan |
| Relationship sering implisit | Relationship eksplisit dan bernama |
| Many-to-many butuh join table | Many-to-many adalah relationship langsung atau node reifikasi |
| Attribute biasanya column | Attribute bisa menjadi property, node, relationship property, atau derived edge |

Property graph bukan sekadar format penyimpanan. Ia adalah cara mengatakan:

> “Hubungan antar fakta adalah bagian dari fakta itu sendiri.”

---

## 2. Node: Bukan Selalu “Entity”, Tetapi Unit Identitas yang Bisa Dihubungkan

### 2.1 Definisi praktis node

Node adalah elemen graph yang memiliki:

- identity internal,
- zero atau lebih label,
- zero atau lebih property,
- zero atau lebih relationship masuk/keluar.

Dalam modelling, node biasanya dipakai untuk sesuatu yang:

1. punya identitas yang layak dilacak,
2. dapat berpartisipasi dalam lebih dari satu relationship,
3. mungkin menjadi titik awal/akhir traversal,
4. mungkin perlu dicari secara langsung,
5. mungkin berubah secara independen,
6. mungkin perlu audit/provenance,
7. mungkin muncul berulang dalam banyak konteks.

Contoh yang jelas sebagai node:

```text
Person
Company
Account
Case
Investigation
Transaction
Device
Address
Regulation
Permit
Asset
Policy
Role
Permission
Evidence
Decision
```

Namun tidak semua noun harus menjadi node.

Contoh yang belum tentu node:

```text
status
amount
name
birthDate
createdAt
description
riskScore
countryCode
email
phoneNumber
```

Beberapa bisa menjadi property. Beberapa bisa menjadi node tergantung kebutuhan traversal.

### 2.2 Pertanyaan desain: “Apakah ini perlu di-traverse?”

Pertanyaan paling berguna saat menentukan node:

> “Apakah benda ini akan menjadi titik koneksi penting?”

Misalnya `Address`.

Dalam sistem sederhana, address bisa property:

```cypher
(:Person {name: 'Ayu', address: 'Jl. Merdeka 10, Bandung'})
```

Tapi dalam fraud/investigation graph, address sering menjadi node:

```cypher
(:Person {personId: 'P-001'})-[:RESIDES_AT]->(:Address {normalized: 'JL MERDEKA 10 BANDUNG'})
(:Company {companyId: 'C-778'})-[:REGISTERED_AT]->(:Address {normalized: 'JL MERDEKA 10 BANDUNG'})
```

Kenapa?

Karena kita ingin bertanya:

```text
Siapa saja person/company yang berbagi address yang sama?
Apakah address ini dipakai oleh banyak shell company?
Apakah ada case lain yang terhubung ke address ini?
```

Kalau address hanya property string, query tersebut berubah menjadi string matching. Kalau address node, ia menjadi hub koneksi.

### 2.3 Node sebagai entity vs concept vs event vs state

Node tidak selalu domain entity tradisional.

Node bisa berupa **concept**:

```cypher
(:Regulation {code: 'AML-12'})
(:RiskCategory {name: 'Beneficial Ownership Obfuscation'})
(:ViolationType {code: 'LATE_REPORTING'})
```

Node bisa berupa **event**:

```cypher
(:Transaction {txId: 'TX-991', amount: 5000000})
(:LoginEvent {eventId: 'LE-123', timestamp: datetime(...)})
(:CaseEscalation {eventId: 'ESC-2024-88'})
```

Node bisa berupa **state/snapshot**:

```cypher
(:CompanySnapshot {companyId: 'C-778', validFrom: date('2024-01-01'), validTo: date('2024-12-31')})
```

Node bisa berupa **decision point**:

```cypher
(:Decision {decisionId: 'D-551', outcome: 'ESCALATE', decidedAt: datetime(...)})
```

Node bisa berupa **evidence artifact**:

```cypher
(:Evidence {evidenceId: 'E-1001', type: 'BANK_STATEMENT', hash: '...'})
```

Untuk sistem regulasi, enforcement, audit, investigation, dan case management, sering kali node yang paling penting bukan hanya `Person` dan `Company`, tetapi juga:

- `Evidence`,
- `Allegation`,
- `Review`,
- `Decision`,
- `Action`,
- `Rule`,
- `Finding`,
- `Control`,
- `Obligation`,
- `RiskSignal`,
- `LegalBasis`.

Itu karena sistem tersebut tidak hanya ingin mengetahui “siapa terhubung ke siapa”, tetapi juga:

> “Berdasarkan fakta apa, dari sumber mana, pada waktu kapan, oleh siapa, dan dengan reasoning apa koneksi itu dianggap benar?”

---

## 3. Relationship: Bukan Foreign Key, Melainkan Fakta Berarah

### 3.1 Relationship adalah domain statement

Relationship di property graph bukan sekadar pointer teknis. Relationship adalah kalimat domain.

Contoh:

```cypher
(:Person)-[:OWNS]->(:Company)
```

Bisa dibaca:

```text
Person owns Company.
```

Atau:

```cypher
(:Officer)-[:REVIEWED]->(:Case)
```

Bisa dibaca:

```text
Officer reviewed Case.
```

Atau:

```cypher
(:Evidence)-[:SUPPORTS]->(:Allegation)
```

Bisa dibaca:

```text
Evidence supports Allegation.
```

Relationship yang baik biasanya membentuk kalimat yang jelas.

Buruk:

```cypher
(:Person)-[:RELATED_TO]->(:Company)
```

Lebih baik:

```cypher
(:Person)-[:OWNS]->(:Company)
(:Person)-[:DIRECTOR_OF]->(:Company)
(:Person)-[:AUTHORIZED_SIGNATORY_OF]->(:Company)
(:Person)-[:EMPLOYED_BY]->(:Company)
(:Person)-[:BENEFICIAL_OWNER_OF]->(:Company)
```

`RELATED_TO` terlalu kabur. Dalam graph database, relationship type adalah bagian dari semantics. Jika relationship type terlalu generik, query menjadi banyak `WHERE` tambahan, interpretasi ambigu, dan audit melemah.

### 3.2 Relationship selalu berarah, tetapi query bisa memperlakukannya tidak berarah

Di Neo4j, relationship memiliki arah secara storage/model:

```cypher
(:Person)-[:OWNS]->(:Company)
```

Namun query bisa mengabaikan arah:

```cypher
MATCH (a)-[:OWNS]-(b)
RETURN a, b
```

Arah bukan selalu berarti “arah fisik real-world”. Arah adalah keputusan modelling untuk membuat semantics konsisten.

Contoh arah yang natural:

```text
Person OWNS Company
Company HAS_ACCOUNT Account
Case HAS_EVIDENCE Evidence
Decision BASED_ON Finding
Officer REVIEWED Case
```

Untuk relationship simetris, tetap pilih satu arah konsisten:

```cypher
(:Person)-[:SPOUSE_OF]->(:Person)
```

Tetapi query mungkin sering memakai undirected pattern.

Namun berhati-hati: relationship simetris dapat dimodelkan dengan:

1. satu relationship dengan arah canonical,
2. dua relationship berlawanan arah,
3. relationship node reifikasi.

Pilihan ini berdampak pada uniqueness, query, dan update.

Biasanya, jangan membuat dua relationship berlawanan arah hanya agar query terasa mudah, kecuali ada alasan kuat. Lebih baik query dengan pola tidak berarah jika semantics memang simetris.

### 3.3 Relationship type harus menggambarkan makna, bukan tabel asal

Buruk:

```cypher
(:Person)-[:PERSON_COMPANY]->(:Company)
(:Case)-[:CASE_EVIDENCE]->(:Evidence)
(:Account)-[:ACCOUNT_TRANSACTION]->(:Transaction)
```

Ini relationship type yang berasal dari nama table/join table, bukan domain semantics.

Lebih baik:

```cypher
(:Person)-[:OWNS]->(:Company)
(:Person)-[:DIRECTOR_OF]->(:Company)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Account)-[:SENT]->(:Transaction)
(:Transaction)-[:RECEIVED_BY]->(:Account)
```

Rule praktis:

> Jika relationship type tidak bisa dibaca sebagai predicate domain, kemungkinan modelnya masih terlalu database-centric.

### 3.4 Relationship property

Relationship dapat memiliki property:

```cypher
(:Person)-[:OWNS {
  percentage: 35.0,
  since: date('2021-03-01'),
  source: 'company_registry',
  confidence: 0.92
}]->(:Company)
```

Relationship property cocok jika property tersebut menjelaskan **koneksi**, bukan node.

Contoh property relationship yang baik:

```text
ownership percentage
validFrom / validTo
relationship source
confidence
role in relationship
transaction amount, if transaction is relationship
distance/cost/weight
rank/order
status of association
observedAt
```

Contoh property yang biasanya tidak cocok di relationship:

```text
person.name
company.registrationNumber
case.status
account.balance
```

Karena property tersebut menjelaskan node, bukan hubungan.

---

## 4. Label: Klasifikasi Node, Bukan Sekadar Nama Table

### 4.1 Label sebagai tipe konseptual

Label dipakai untuk mengklasifikasikan node:

```cypher
(:Person)
(:Company)
(:Case)
(:Evidence)
(:Account)
```

Node bisa memiliki lebih dari satu label:

```cypher
(:Person:Officer)
(:Person:Subject)
(:Company:RegulatedEntity)
(:Case:EnforcementCase)
```

Multi-label berguna jika satu node memang berada dalam beberapa kategori query.

Contoh:

```cypher
(:Person:Officer {personId: 'P-777', employeeNo: 'EMP-45'})
```

Artinya node tersebut adalah `Person` dan juga `Officer`.

Namun multi-label harus dipakai hati-hati. Jangan menjadikan label sebagai pengganti property status yang sering berubah.

### 4.2 Label vs property

Kapan memakai label?

Gunakan label ketika:

1. kategori dipakai sangat sering sebagai anchor query,
2. kategori mewakili tipe struktural yang mempengaruhi relationship valid,
3. kategori perlu constraint/index spesifik,
4. kategori relatif stabil,
5. kategori membantu query planner memilih subset node.

Contoh baik:

```cypher
(:Person)
(:Company)
(:Case)
(:Evidence)
(:Regulation)
```

Kapan memakai property?

Gunakan property ketika:

1. nilainya banyak variasi,
2. sering berubah,
3. bukan tipe struktural,
4. tidak ingin label explosion,
5. dipakai sebagai filter biasa.

Contoh:

```cypher
(:Case {status: 'OPEN'})
(:Case {priority: 'HIGH'})
(:Person {nationality: 'ID'})
```

Tidak ideal:

```cypher
(:Case:OpenCase:HighPriorityCase:AssignedCase:OverdueCase)
```

Label seperti `OpenCase`, `HighPriorityCase`, `OverdueCase` mungkin menggoda karena query mudah, tetapi jika status berubah terus, label mutation menjadi noise. Lebih baik pakai property, atau derived label hanya jika benar-benar perlu untuk performa dan dikelola disiplin.

### 4.3 Label taxonomy

Label taxonomy adalah struktur konseptual label.

Contoh sederhana:

```text
:Party
  :Person
  :Organization
    :Company
    :GovernmentAgency

:Case
  :EnforcementCase
  :ComplianceCase

:Artifact
  :Evidence
  :Document
  :Image
  :Statement
```

Dalam Neo4j, label tidak otomatis memiliki inheritance formal seperti class hierarchy. Jika node memiliki label `:Company`, ia tidak otomatis dianggap `:Organization` kecuali kita juga menempelkan label `:Organization`.

Contoh:

```cypher
(:Company:Organization:Party)
```

Ini membuat query berikut mungkin:

```cypher
MATCH (p:Party)
RETURN p
```

Namun perlu governance. Multi-label taxonomy yang tidak disiplin dapat menyebabkan inkonsistensi:

```text
Some Company nodes have :Party, some do not.
Some Officer nodes have :Person, some do not.
Some Evidence nodes have :Artifact, some do not.
```

Jika memakai hierarchical labels, buat aturan eksplisit:

```text
Every :Company must also be :Organization and :Party.
Every :Officer must also be :Person and :Actor.
Every :Evidence must also be :Artifact.
```

Lalu enforce lewat ingestion/application checks atau migration tests.

### 4.4 Label explosion

Label explosion terjadi saat label dipakai untuk terlalu banyak klasifikasi granular.

Contoh buruk:

```cypher
(:Person:Indonesian:Male:Adult:HighRisk:VIP:KYCVerified:HasOpenCase:LoggedInThisMonth)
```

Masalahnya:

1. label menjadi status dinamis,
2. update sulit,
3. query semantics tidak jelas,
4. index/constraint planning membingungkan,
5. model tidak scalable secara mental.

Lebih baik:

```cypher
(:Person {
  nationality: 'ID',
  gender: 'M',
  riskTier: 'HIGH',
  kycStatus: 'VERIFIED'
})
```

Atau untuk beberapa aspek yang memang relational/semantic:

```cypher
(:Person)-[:HAS_RISK_CLASSIFICATION]->(:RiskTier {code: 'HIGH'})
(:Person)-[:HAS_KYC_STATUS]->(:KycStatus {code: 'VERIFIED'})
```

Jika risk tier perlu provenance, history, atau relationship ke rule/evidence, node lebih baik daripada property.

---

## 5. Relationship Type: Predicate Domain yang Harus Stabil

Relationship type adalah label untuk edge.

Contoh:

```cypher
[:OWNS]
[:DIRECTOR_OF]
[:TRANSACTED_WITH]
[:ASSIGNED_TO]
[:ESCALATED_TO]
[:SUPPORTED_BY]
[:VIOLATES]
[:REVIEWED_BY]
```

### 5.1 Relationship type vs relationship property

Misalnya seseorang punya role di perusahaan:

Option A:

```cypher
(:Person)-[:DIRECTOR_OF]->(:Company)
(:Person)-[:SHAREHOLDER_OF]->(:Company)
(:Person)-[:AUDITOR_OF]->(:Company)
```

Option B:

```cypher
(:Person)-[:HAS_ROLE {role: 'DIRECTOR'}]->(:Company)
(:Person)-[:HAS_ROLE {role: 'SHAREHOLDER'}]->(:Company)
```

Mana yang benar?

Jawabannya tergantung query dan semantics.

Gunakan relationship type berbeda jika:

1. role punya semantics berbeda,
2. traversal sering spesifik ke role tertentu,
3. relationship punya property berbeda per role,
4. cardinality berbeda,
5. constraint bisnis berbeda,
6. query planner diuntungkan oleh relationship type spesifik.

Gunakan property jika:

1. role banyak dan dinamis,
2. role tidak terlalu mempengaruhi traversal,
3. role lebih mirip metadata,
4. satu relationship abstraction memang sama.

Untuk regulatory/investigation graph, biasanya role yang punya makna hukum sebaiknya relationship type eksplisit:

```cypher
(:Person)-[:BENEFICIAL_OWNER_OF]->(:Company)
(:Person)-[:NOMINEE_DIRECTOR_OF]->(:Company)
(:Person)-[:AUTHORIZED_SIGNATORY_OF]->(:Account)
```

Karena perbedaan tersebut bukan sekadar label teknis; ia mempengaruhi liability, audit, dan reasoning.

### 5.2 Relationship type explosion

Kebalikan dari `RELATED_TO` yang terlalu generik adalah type explosion.

Buruk:

```cypher
[:OWNS_10_PERCENT]
[:OWNS_20_PERCENT]
[:OWNS_30_PERCENT]
[:OWNS_SINCE_2020]
[:OWNS_ACTIVE]
[:OWNS_VERIFIED]
```

Ini mencampur predicate dengan property.

Lebih baik:

```cypher
[:OWNS {percentage: 30, since: date('2020-01-01'), status: 'ACTIVE', verificationStatus: 'VERIFIED'}]
```

Rule praktis:

> Relationship type menjawab “jenis hubungan apa ini?”  
> Relationship property menjawab “apa atribut, keadaan, bobot, periode, atau kualitas hubungan ini?”

---

## 6. Property: Data yang Menjelaskan Node atau Relationship

### 6.1 Property sebagai key-value attribute

Property adalah data yang ditempel ke node atau relationship.

Contoh node property:

```cypher
(:Person {
  personId: 'P-001',
  fullName: 'Ayu Lestari',
  birthDate: date('1987-05-12'),
  riskTier: 'MEDIUM'
})
```

Contoh relationship property:

```cypher
(:Person)-[:OWNS {
  percentage: 35.5,
  validFrom: date('2021-01-01'),
  source: 'COMPANY_REGISTRY'
}]->(:Company)
```

### 6.2 Property should not hide graph structure

Kesalahan umum:

```cypher
(:Person {
  personId: 'P-001',
  companyIds: ['C-1', 'C-2', 'C-3']
})
```

Ini menyembunyikan relationship di dalam array property.

Lebih graph-native:

```cypher
(:Person {personId: 'P-001'})-[:OWNS]->(:Company {companyId: 'C-1'})
(:Person {personId: 'P-001'})-[:OWNS]->(:Company {companyId: 'C-2'})
(:Person {personId: 'P-001'})-[:OWNS]->(:Company {companyId: 'C-3'})
```

Jika data akan di-traverse, jangan kubur sebagai property.

Contoh buruk lain:

```cypher
(:Case {
  evidenceIds: ['E-1', 'E-2'],
  assignedOfficerIds: ['O-1', 'O-2'],
  relatedCaseIds: ['C-91', 'C-92']
})
```

Ini document-style modelling. Di graph database, lebih baik:

```cypher
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Case)-[:ASSIGNED_TO]->(:Officer)
(:Case)-[:RELATED_TO]->(:Case)
```

### 6.3 Property vs node decision matrix

Gunakan property jika:

| Kondisi | Contoh |
|---|---|
| Tidak perlu traversal | `birthDate`, `createdAt` |
| Nilai scalar sederhana | `amount`, `status`, `name` |
| Tidak punya identity independen | `riskScore` |
| Tidak punya relationship sendiri | `description` |
| Tidak perlu provenance detail | `displayName` |
| Tidak perlu historisasi granular | `currentStatus` |

Gunakan node jika:

| Kondisi | Contoh |
|---|---|
| Perlu menjadi titik traversal | `Address`, `Device`, `BankAccount` |
| Dipakai oleh banyak entity | `Regulation`, `RiskCategory` |
| Punya identity independen | `Evidence`, `Document` |
| Punya relationship sendiri | `Officer`, `Decision` |
| Perlu provenance/audit | `Finding`, `Allegation` |
| Perlu history kompleks | `StatusChangeEvent` |
| Perlu dedup/entity resolution | `PhoneNumber`, `Email`, `Address` dalam fraud graph |

### 6.4 Email, phone, address: property atau node?

Untuk aplikasi user profile biasa:

```cypher
(:Person {email: 'ayu@example.com', phone: '+628123...'})
```

Untuk fraud/investigation:

```cypher
(:Person)-[:USES_EMAIL]->(:Email {normalized: 'ayu@example.com'})
(:Person)-[:USES_PHONE]->(:Phone {e164: '+628123...'})
(:Person)-[:RESIDES_AT]->(:Address {normalized: '...'})
```

Kenapa?

Karena email/phone/address bisa menjadi shared identifiers:

```text
Find persons sharing the same phone.
Find companies registered to the same address.
Find accounts controlled by devices used by subjects of previous cases.
```

Di sistem graph, “attribute yang menghubungkan banyak entity” sering sebaiknya naik kelas menjadi node.

---

## 7. Identity: Internal ID, External ID, Natural Key, Surrogate Key

### 7.1 Jangan bergantung pada internal ID untuk domain identity

Neo4j punya internal identity untuk node/relationship. Tetapi untuk aplikasi domain, jangan menjadikan internal ID sebagai identifier bisnis.

Gunakan property domain ID:

```cypher
(:Person {personId: 'P-001'})
(:Company {companyId: 'C-778'})
(:Case {caseId: 'CASE-2026-0001'})
```

Alasannya:

1. internal ID bukan kontrak domain,
2. sulit untuk integrasi eksternal,
3. backup/restore/migration dapat membuat asumsi internal ID bermasalah,
4. audit dan traceability butuh stable identifier,
5. application logs butuh ID yang bermakna.

### 7.2 Natural key vs surrogate key

Natural key:

```text
nationalId
companyRegistrationNumber
email
bankAccountNumber
permitNumber
```

Surrogate key:

```text
personId = UUID
companyId = UUID
caseId = generated case number
```

Natural key berguna tetapi sering bermasalah:

1. bisa berubah,
2. bisa salah input,
3. bisa duplicate,
4. bisa tidak tersedia,
5. bisa sensitif,
6. bisa berbeda format antar source,
7. bisa perlu normalization.

Untuk sistem serius, biasanya gunakan surrogate stable ID sebagai identity utama node, lalu natural identifiers dimodelkan sebagai property atau node terpisah.

Contoh:

```cypher
(:Person {personId: 'P-001'})-[:HAS_IDENTIFIER]->(:NationalId {country: 'ID', valueHash: '...'})
(:Person {personId: 'P-001'})-[:USES_EMAIL]->(:Email {normalized: 'ayu@example.com'})
```

Atau jika cukup sederhana:

```cypher
(:Person {
  personId: 'P-001',
  nationalIdHash: '...',
  email: 'ayu@example.com'
})
```

### 7.3 Identity dalam entity resolution

Dalam graph domain, kita sering tidak yakin apakah dua record mewakili entity yang sama.

Contoh:

```text
Ayu Lestari, born 1987, phone X
A. Lestari, born 1987, phone X
Ayu L., address Y, phone X
```

Model sederhana:

```cypher
(:PersonRecord {recordId: 'R1'})
(:PersonRecord {recordId: 'R2'})
(:ResolvedPerson {personId: 'P-001'})

(:PersonRecord {recordId: 'R1'})-[:RESOLVED_TO {confidence: 0.94}]->(:ResolvedPerson {personId: 'P-001'})
(:PersonRecord {recordId: 'R2'})-[:RESOLVED_TO {confidence: 0.88}]->(:ResolvedPerson {personId: 'P-001'})
```

Jangan memaksa semua data menjadi satu `Person` jika proses resolution belum pasti. Untuk investigation/regulatory systems, distinction antara raw record dan resolved entity sangat penting.

### 7.4 Constraint-backed identity

Jika node punya domain ID unik, enforce dengan uniqueness constraint.

Contoh konseptual:

```cypher
CREATE CONSTRAINT person_id_unique IF NOT EXISTS
FOR (p:Person)
REQUIRE p.personId IS UNIQUE;
```

Constraint bukan hanya untuk performa. Constraint adalah bagian dari correctness model.

Jika command handler Java melakukan upsert person, uniqueness constraint melindungi sistem dari duplicate saat concurrency.

---

## 8. Relationship Identity: Kapan Relationship Butuh ID?

Relationship di Neo4j juga memiliki identity internal dan bisa punya property. Namun pertanyaan modelling-nya:

> “Apakah relationship ini cukup sebagai edge, atau ia perlu menjadi entity sendiri?”

Misalnya:

```cypher
(:Person)-[:OWNS {percentage: 30, since: date('2020-01-01')}]->(:Company)
```

Cukup sebagai relationship jika:

1. relationship hanya menghubungkan dua node,
2. properties sederhana,
3. tidak perlu relationship ke banyak evidence/source/decision,
4. tidak perlu lifecycle kompleks,
5. tidak perlu banyak actor mengomentari relationship tersebut.

Namun ownership bisa menjadi node jika:

```text
Ownership claim has multiple evidence documents.
Ownership changed over time.
Ownership is disputed.
Ownership was asserted by different sources with different confidence.
Ownership participates in case findings.
Ownership has review/approval workflow.
```

Model reifikasi:

```cypher
(:Person)-[:PARTY_IN]->(:Ownership {ownershipId: 'OWN-1', percentage: 30})
(:Ownership)-[:OF_COMPANY]->(:Company)
(:Ownership)-[:SUPPORTED_BY]->(:Evidence)
(:Ownership)-[:ASSERTED_BY]->(:Source)
(:Ownership)-[:REVIEWED_IN]->(:Case)
```

Atau:

```cypher
(:Person)-[:OWNER_IN]->(:OwnershipFact)-[:OWNED_COMPANY]->(:Company)
```

Relationship yang berubah menjadi node disebut sering disebut **reification**: menjadikan hubungan sebagai benda/entity agar bisa punya hubungan lain.

---

## 9. Reification: Saat Relationship Harus Menjadi Node

### 9.1 Definisi praktis

Reification adalah proses mengubah relationship menjadi node agar relationship tersebut bisa:

1. punya identity domain,
2. punya banyak relationship lain,
3. punya lifecycle,
4. punya audit/provenance kompleks,
5. menghubungkan lebih dari dua entity,
6. merepresentasikan event/fact/claim yang berdiri sendiri.

### 9.2 Contoh: transaction

Model transaksi sebagai relationship:

```cypher
(:Account)-[:TRANSFERRED {amount: 1000000, at: datetime(...)}]->(:Account)
```

Ini cocok jika transaksi sederhana dan hanya menghubungkan source-target.

Namun untuk financial investigation, transaksi sering perlu menjadi node:

```cypher
(:Account)-[:SENT]->(:Transaction {txId: 'TX-001', amount: 1000000, at: datetime(...)})
(:Transaction)-[:RECEIVED_BY]->(:Account)
(:Transaction)-[:INITIATED_FROM]->(:Device)
(:Transaction)-[:FLAGGED_BY]->(:Rule)
(:Transaction)-[:PART_OF]->(:Case)
```

Kenapa?

Karena transaksi memiliki identity, metadata, evidence, device, channel, status, reversal, rule hits, batch, source file, dan bisa menjadi subject of investigation.

### 9.3 Contoh: assignment

Sederhana:

```cypher
(:Case)-[:ASSIGNED_TO {assignedAt: datetime(...)}]->(:Officer)
```

Jika hanya current assignment, cukup.

Lebih kompleks:

```cypher
(:Assignment {assignmentId: 'A-001', assignedAt: datetime(...), reason: 'WORKLOAD_BALANCE'})
(:Case)-[:HAS_ASSIGNMENT]->(:Assignment)
(:Assignment)-[:ASSIGNED_TO]->(:Officer)
(:Assignment)-[:ASSIGNED_BY]->(:Supervisor)
(:Assignment)-[:REPLACED]->(:Assignment)
```

Jika assignment punya approval, reason, replacement, dispute, SLA impact, atau audit trail, node lebih defensible.

### 9.4 Contoh: allegation supported by evidence

Sederhana:

```cypher
(:Evidence)-[:SUPPORTS]->(:Allegation)
```

Lebih kompleks:

```cypher
(:EvidenceAssessment {assessmentId: 'EA-001', confidence: 0.82, rationale: '...'})
(:Evidence)-[:ASSESSED_AS]->(:EvidenceAssessment)
(:EvidenceAssessment)-[:SUPPORTS]->(:Allegation)
(:EvidenceAssessment)-[:MADE_BY]->(:Officer)
(:EvidenceAssessment)-[:IN_CASE]->(:Case)
```

Ini penting jika “support” bukan fakta objektif, tetapi hasil interpretasi manusia/algoritma.

### 9.5 Rule of thumb reification

Gunakan relationship langsung jika:

```text
A --predicate--> B
```

sudah cukup untuk menjawab kebutuhan domain.

Gunakan node reifikasi jika hubungan itu perlu menjadi subject kalimat lain:

```text
A owns B.
That ownership was asserted by Source X.
That assertion was reviewed by Officer Y.
That review was challenged by Party Z.
That challenge was resolved by Decision D.
```

Kalau relationship perlu “diomongkan” sebagai benda, jadikan node.

---

## 10. Hyperedge Problem: Saat Satu Relationship Tidak Cukup

Property graph relationship menghubungkan dua node: start dan end.

Namun domain sering punya fakta n-ary, bukan binary.

Contoh:

```text
Person P holds Role R in Company C during Period T under Appointment A.
```

Ini tidak cukup diwakili oleh satu relationship `(:Person)-[:DIRECTOR_OF]->(:Company)` jika role, period, appointment source, legal basis, dan approval adalah bagian penting dari fakta.

### 10.1 Solusi: intermediate fact node

```cypher
(:Person)-[:HOLDS]->(:Appointment {appointmentId: 'APP-001'})
(:Appointment)-[:ROLE]->(:Role {code: 'DIRECTOR'})
(:Appointment)-[:IN_ORGANIZATION]->(:Company {companyId: 'C-778'})
(:Appointment)-[:BASED_ON]->(:Document {docId: 'DOC-9'})
(:Appointment)-[:VALID_DURING]->(:TimeInterval {from: date('2023-01-01'), to: date('2024-01-01')})
```

Atau lebih sederhana:

```cypher
(:Person)-[:APPOINTED_AS]->(:Appointment {role: 'DIRECTOR', validFrom: ..., validTo: ...})
(:Appointment)-[:IN]->(:Company)
```

### 10.2 Hyperedge dalam enforcement domain

Fakta:

```text
Officer O concluded that Person P controls Company C through Person Q based on Evidence E in Case K with confidence 0.78.
```

Jangan paksa menjadi:

```cypher
(:Person)-[:CONTROLS {confidence: 0.78}]->(:Company)
```

Itu kehilangan:

- who concluded,
- through whom,
- based on what,
- in which case,
- whether contested,
- when valid,
- confidence source,
- review status.

Lebih baik:

```cypher
(:ControlFinding {findingId: 'F-001', confidence: 0.78, createdAt: datetime(...)})
(:Officer)-[:MADE]->(:ControlFinding)
(:ControlFinding)-[:SUBJECT]->(:Person)
(:ControlFinding)-[:CONTROLLED_ENTITY]->(:Company)
(:ControlFinding)-[:VIA]->(:Person)
(:ControlFinding)-[:SUPPORTED_BY]->(:Evidence)
(:ControlFinding)-[:IN_CASE]->(:Case)
```

Ini membuat graph lebih verbose, tetapi jauh lebih defensible.

### 10.3 Trade-off

Intermediate fact node menambah hop:

```text
Person -> ControlFinding -> Company
```

bukan:

```text
Person -> Company
```

Hop tambahan bisa menambah query cost. Namun jika semantics membutuhkan fact node, jangan mengorbankan correctness demi traversal pendek.

Solusi umum:

1. Simpan fact node untuk audit/correctness.
2. Tambahkan derived/materialized relationship untuk query cepat.

Contoh:

```cypher
(:Person)-[:CONTROL_FINDING]->(:ControlFinding)-[:CONTROLLED_ENTITY]->(:Company)
(:Person)-[:CONTROLS {derivedFrom: 'F-001', confidence: 0.78}]->(:Company)
```

Tapi derived relationship harus dikelola dengan jelas:

- bagaimana dibuat,
- kapan diperbarui,
- bagaimana invalidated,
- apa source-of-truth-nya,
- bagaimana audit menjelaskan derivation.

---

## 11. Temporal Modelling: Current Facts, Historical Facts, and Time-Aware Graph

Graph tanpa waktu sering menyesatkan.

Contoh:

```cypher
(:Person)-[:DIRECTOR_OF]->(:Company)
```

Pertanyaan penting:

```text
Apakah direktur saat ini?
Pernah menjadi direktur?
Valid dari kapan sampai kapan?
Diketahui pada kapan?
Dicatat pada kapan?
Berlaku menurut sumber mana?
```

Temporalitas punya beberapa dimensi.

### 11.1 Valid time vs transaction time

**Valid time**: kapan fakta benar di dunia domain.

```text
Ayu was director of Company C from 2021-01-01 to 2023-05-10.
```

**Transaction time**: kapan sistem mengetahui/menyimpan fakta.

```text
System recorded this fact on 2024-02-01 from registry import.
```

Keduanya berbeda.

Relationship property:

```cypher
(:Person)-[:DIRECTOR_OF {
  validFrom: date('2021-01-01'),
  validTo: date('2023-05-10'),
  recordedAt: datetime('2024-02-01T10:00:00Z')
}]->(:Company)
```

Untuk audit-heavy system, bedakan minimal:

```text
validFrom / validTo
observedAt
recordedAt
sourceTimestamp
supersededAt
```

### 11.2 Current-state edge

Kadang aplikasi sering butuh current view:

```cypher
(:Person)-[:CURRENT_DIRECTOR_OF]->(:Company)
```

Dan historical view:

```cypher
(:Person)-[:DIRECTOR_OF {validFrom, validTo}]->(:Company)
```

Ini bisa berguna, tetapi hati-hati dengan duplication.

Rule:

```text
Historical fact adalah source-of-truth.
Current edge adalah projection/derived view.
```

Jika current edge dibuat, harus ada pipeline/invariant yang memastikan consistency.

### 11.3 Temporal node vs relationship property

Jika temporalitas sederhana, relationship property cukup:

```cypher
(:Person)-[:EMPLOYED_BY {from: date('2020-01-01'), to: date('2022-12-31')}]->(:Company)
```

Jika temporalitas kompleks, gunakan fact node:

```cypher
(:Employment {employmentId, from, to, status})
(:Person)-[:HAS_EMPLOYMENT]->(:Employment)
(:Employment)-[:EMPLOYER]->(:Company)
(:Employment)-[:SUPPORTED_BY]->(:Document)
(:Employment)-[:TERMINATED_BY]->(:Decision)
```

### 11.4 Snapshot modelling

Untuk entity yang berubah banyak atributnya:

```cypher
(:Company {companyId: 'C-1'})-[:HAS_SNAPSHOT]->(:CompanySnapshot {
  snapshotId: 'S-2024-01',
  name: 'PT Lama',
  address: '...',
  validFrom: date('2024-01-01'),
  validTo: date('2024-06-01')
})
```

Snapshot berguna ketika:

1. banyak property berubah bersama,
2. perlu reconstruct state as-of date,
3. audit/regulatory reporting butuh historical view,
4. source import periodik.

Namun snapshot memperbesar graph. Jangan pakai snapshot untuk semua hal tanpa kebutuhan as-of query.

### 11.5 Time tree anti-pattern

Dulu graph modelling sering memakai time tree:

```text
(:Year)-[:HAS_MONTH]->(:Month)-[:HAS_DAY]->(:Day)
```

Lalu events dihubungkan ke day.

Ini kadang berguna untuk visualization atau traversal temporal tertentu, tetapi sering tidak perlu jika hanya filter tanggal. Gunakan date/datetime property dan index jika hanya butuh range filtering.

Time node berguna jika tanggal sendiri punya semantics:

```text
business calendar
holiday
regulatory deadline
reporting period
court session date
SLA calendar
```

Contoh:

```cypher
(:Case)-[:DUE_ON]->(:RegulatoryDeadline {date: date('2026-07-31'), type: 'APPEAL_DEADLINE'})
```

---

## 12. Provenance: Dari Mana Fakta Berasal?

Dalam sistem biasa, property graph sering hanya menyimpan fakta final.

Dalam sistem audit/regulatory/investigation, ini tidak cukup.

Pertanyaan penting:

```text
Siapa sumber fakta ini?
Kapan diperoleh?
Apakah diverifikasi?
Siapa yang memverifikasi?
Berdasarkan evidence apa?
Apakah ada sumber lain yang bertentangan?
Apakah fakta ini hasil inferensi atau data primer?
```

### 12.1 Sumber sebagai property

Untuk kebutuhan sederhana:

```cypher
(:Person)-[:OWNS {
  percentage: 35,
  source: 'COMPANY_REGISTRY',
  importedAt: datetime(...)
}]->(:Company)
```

Cukup jika source hanya metadata.

### 12.2 Sumber sebagai node

Jika source punya identity, reliability, version, atau hubungan ke banyak facts:

```cypher
(:Source {sourceId: 'SRC-REGISTRY', name: 'Company Registry'})
(:Document {docId: 'DOC-001', hash: '...'})
(:OwnershipFact {factId: 'F-001', percentage: 35})

(:OwnershipFact)-[:ASSERTED_BY]->(:Source)
(:OwnershipFact)-[:EXTRACTED_FROM]->(:Document)
(:OwnershipFact)-[:SUBJECT]->(:Person)
(:OwnershipFact)-[:OBJECT]->(:Company)
```

### 12.3 Claim vs fact

Dalam high-integrity systems, bedakan:

1. **Claim**: sesuatu dinyatakan oleh source.
2. **Finding**: sesuatu disimpulkan oleh investigator/algorithm.
3. **Accepted fact**: sesuatu diterima sebagai state operasional.

Contoh:

```cypher
(:Claim {claimId: 'CL-1', type: 'OWNERSHIP', value: 35})
(:Source)-[:MADE_CLAIM]->(:Claim)
(:Claim)-[:ABOUT_PERSON]->(:Person)
(:Claim)-[:ABOUT_COMPANY]->(:Company)

(:Finding {findingId: 'F-1', confidence: 0.91})
(:Officer)-[:MADE_FINDING]->(:Finding)
(:Finding)-[:SUPPORTED_BY]->(:Claim)
(:Finding)-[:CONCLUDES]->(:OwnershipFact)
```

Ini terlihat berat, tetapi sangat penting jika graph dipakai untuk enforcement decisions.

### 12.4 Conflicting facts

Jangan overwrite fakta bertentangan secara diam-diam.

Contoh:

Source A mengatakan:

```text
Ayu owns 35% Company C.
```

Source B mengatakan:

```text
Ayu owns 0% Company C after transfer date.
```

Model defensible:

```cypher
(:Claim {claimId: 'CL-A', percentage: 35, validFrom: date('2021-01-01')})
(:Claim {claimId: 'CL-B', percentage: 0, validFrom: date('2024-03-01')})
(:Claim)-[:ASSERTED_BY]->(:Source)
```

Lalu accepted current fact bisa dipilih melalui rule/review:

```cypher
(:Decision)-[:ACCEPTS]->(:Claim)
(:Decision)-[:REJECTS]->(:Claim)
```

Ini jauh lebih kuat daripada mengganti property `percentage`.

---

## 13. Confidence, Uncertainty, and Evidence Strength

Banyak graph nyata tidak berisi fakta pasti, tetapi sinyal.

Contoh:

```text
Phone number likely belongs to Person P.
Device likely controlled by Account A.
Company may be shell entity.
Person may indirectly control Company C.
```

Jika graph dipakai untuk reasoning, jangan sembunyikan uncertainty.

### 13.1 Confidence sebagai relationship property

```cypher
(:Person)-[:USES_PHONE {confidence: 0.87, method: 'KYC_MATCH'}]->(:Phone)
```

Cocok jika sederhana.

### 13.2 Confidence sebagai finding node

```cypher
(:UsageFinding {findingId: 'UF-1', confidence: 0.87, method: 'KYC_MATCH'})
(:UsageFinding)-[:SUBJECT]->(:Person)
(:UsageFinding)-[:OBJECT]->(:Phone)
(:UsageFinding)-[:SUPPORTED_BY]->(:Evidence)
(:UsageFinding)-[:GENERATED_BY]->(:Rule)
```

Lebih baik jika confidence butuh explanation.

### 13.3 Jangan campur fakta dan prediksi tanpa label semantics

Buruk:

```cypher
(:Person)-[:CONTROLS]->(:Company)
```

Padahal hanya hasil model ML dengan confidence 0.61.

Lebih baik:

```cypher
(:Person)-[:PREDICTED_TO_CONTROL {confidence: 0.61, modelVersion: 'v3'}]->(:Company)
```

Atau:

```cypher
(:ControlPrediction {score: 0.61, modelVersion: 'v3'})
```

Perbedaan ini penting secara hukum, operasional, dan etika.

---

## 14. Mutable vs Immutable Graph Facts

### 14.1 Mutable current state

Contoh:

```cypher
(:Case {caseId: 'C-1', status: 'OPEN'})
```

Status bisa berubah:

```text
OPEN -> UNDER_REVIEW -> ESCALATED -> CLOSED
```

Jika hanya butuh state sekarang, property mutable cukup.

### 14.2 Immutable event/fact history

Untuk audit, jangan hanya update status. Simpan event:

```cypher
(:Case)-[:HAS_STATUS_EVENT]->(:CaseStatusChanged {
  from: 'OPEN',
  to: 'UNDER_REVIEW',
  changedAt: datetime(...),
  reason: 'Initial triage complete'
})
```

Atau:

```cypher
(:CaseStatusEvent)-[:CHANGED_BY]->(:Officer)
(:CaseStatusEvent)-[:BASED_ON]->(:Decision)
```

Mutable property bisa menjadi projection:

```cypher
(:Case {status: 'UNDER_REVIEW'})
```

Immutable history menjadi source of audit.

### 14.3 Event graph vs state graph

Event graph:

```text
What happened?
In what sequence?
Who did it?
What caused what?
```

State graph:

```text
What is currently true?
Who is connected now?
What is active?
```

Banyak sistem butuh keduanya.

Pattern:

```text
Event stream/source -> projection builder -> current graph
                         -> audit/history graph
```

Ini mirip konsep event sourcing, tetapi jangan otomatis mengubah Neo4j menjadi event store. Neo4j bisa menyimpan event nodes, tetapi event storage high-volume mungkin lebih cocok di Kafka/object storage/OLAP tergantung workload. Graph-nya menyimpan event yang punya nilai traversal.

---

## 15. Graph Schema: Flexible, Bukan Schema-less

Neo4j sering disebut fleksibel karena kita bisa menambahkan label, relationship type, dan property tanpa migrasi table tradisional. Tetapi “flexible” bukan berarti “tanpa schema”.

Graph schema mencakup:

1. label yang valid,
2. relationship type yang valid,
3. property yang diharapkan,
4. cardinality,
5. direction convention,
6. allowed connections,
7. identity rules,
8. temporal rules,
9. provenance rules,
10. derived relationship rules,
11. invariants domain,
12. constraints/indexes,
13. naming conventions.

### 15.1 Schema formal vs schema sosial

Neo4j dapat enforce beberapa hal dengan constraints/indexes. Tetapi banyak aturan graph tidak otomatis enforced.

Contoh rule:

```text
Only :Officer can REVIEW :Case.
Every :Evidence must be connected to at least one :Case or :Allegation.
Every :ControlFinding must be supported by at least one :Evidence.
Every :Company must have exactly one active registration number.
A :Case may have many assigned officers historically, but only one current lead officer.
```

Sebagian bisa enforced dengan constraint, sebagian perlu application logic, batch validation, atau migration tests.

### 15.2 Schema catalogue

Untuk sistem produksi, buat graph schema catalogue.

Contoh format:

```text
Node Label: Person
Purpose: Human actor/subject/officer/customer.
Identity: personId unique.
Required properties: personId, createdAt.
Optional properties: fullName, birthDate, riskTier.
Allowed outgoing relationships:
  - USES_EMAIL -> Email
  - USES_PHONE -> Phone
  - OWNS -> Company
  - DIRECTOR_OF -> Company
  - SUBJECT_OF -> Case
Allowed incoming relationships:
  - ASSIGNED_TO <- Case
  - REVIEWED_BY <- Case
Notes:
  - If person is internal officer, must also have :Officer label.
  - Sensitive identifiers stored hashed.
```

Relationship catalogue:

```text
Relationship Type: OWNS
Start label: Person or Organization
End label: Company
Meaning: legal or beneficial ownership.
Required properties: source, validFrom.
Optional properties: validTo, percentage, confidence.
Direction: owner -> owned company.
Multiplicity: many-to-many.
Temporal: validFrom/validTo represent valid time.
Provenance: source required; if disputed use OwnershipFact node.
```

Schema catalogue adalah alat komunikasi antar engineer, analyst, investigator, data engineer, dan auditor.

---

## 16. Cardinality and Multiplicity in Graph Model

Graph modelling harus memahami cardinality.

### 16.1 One-to-one

```cypher
(:Person)-[:HAS_PROFILE]->(:Profile)
```

Jika benar-benar 1:1 dan profile tidak punya traversal penting, mungkin property lebih sederhana.

### 16.2 One-to-many

```cypher
(:Company)-[:HAS_ACCOUNT]->(:Account)
```

Biasanya natural graph.

### 16.3 Many-to-many

```cypher
(:Person)-[:OWNS]->(:Company)
(:Person)-[:ASSOCIATED_WITH]->(:Case)
(:Officer)-[:REVIEWED]->(:Case)
```

Graph sangat cocok untuk many-to-many yang punya traversal value.

### 16.4 High-cardinality nodes

Misalnya:

```text
Country Indonesia -> millions of persons
Status OPEN -> millions of cases
Category GENERAL -> millions of documents
```

Jangan selalu jadikan kategori low-selectivity sebagai hub node jika akan menyebabkan supernode.

Buruk:

```cypher
(:Person)-[:CITIZEN_OF]->(:Country {code: 'ID'})
```

Tidak selalu buruk, tetapi jika query sering mulai dari `Country` lalu expand ke semua person, ini bisa menjadi supernode.

Alternatif:

```cypher
(:Person {countryCode: 'ID'})
```

Atau gunakan Country node hanya jika negara punya semantics traversal:

```text
regulatory jurisdiction
sanction regime
reporting obligation
cross-border risk
```

### 16.5 Cardinality harus dihitung sebelum model final

Saat modelling, tanya:

```text
Berapa node Person?
Berapa relationship USES_PHONE per Person?
Berapa Person per Phone?
Berapa Case per Person?
Berapa Evidence per Case?
Berapa Transaction per Account?
Berapa Account per Company?
```

Graph yang terlihat bagus di whiteboard bisa gagal saat cardinality nyata muncul.

---

## 17. Direction Design: Arah Harus Konsisten dan Query-Friendly

Relationship direction tidak boleh asal.

### 17.1 Arah berdasarkan kalimat domain

```text
Person OWNS Company
Case SUPPORTED_BY Evidence
Evidence EXTRACTED_FROM Document
Officer REVIEWED Case
Case ESCALATED_TO Unit
Decision BASED_ON Finding
```

Gunakan arah yang membuat kalimat natural.

### 17.2 Arah berdasarkan traversal utama

Jika traversal utama selalu dari Case ke Evidence:

```cypher
(:Case)-[:SUPPORTED_BY]->(:Evidence)
```

Jika traversal utama dari Evidence ke Case juga penting, query bisa tetap reverse:

```cypher
MATCH (e:Evidence)<-[:SUPPORTED_BY]-(c:Case)
```

Neo4j dapat traverse relationship dua arah, tetapi relationship type dan degree tetap mempengaruhi performa/plan.

### 17.3 Jangan membalik arah antar tim

Buruk:

```cypher
(:Person)-[:OWNS]->(:Company)
(:Company)-[:OWNED_BY]->(:Person)
```

Jika keduanya dipakai untuk fakta yang sama, data mudah inconsistent.

Pilih satu canonical direction.

Jika butuh inverse semantics untuk readability, biasanya query-layer abstraction lebih baik daripada duplicate relationship.

---

## 18. Naming Convention

Naming convention bukan kosmetik. Dalam graph, nama adalah semantics.

### 18.1 Label

Umum:

```text
:Person
:Company
:Case
:Evidence
:Regulation
```

Gunakan singular noun, PascalCase.

Hindari:

```text
:people
:tbl_person
:PERSON_TABLE
:Entity1
```

### 18.2 Relationship type

Umum Neo4j style:

```text
:OWNS
:DIRECTOR_OF
:SUPPORTED_BY
:ASSIGNED_TO
:REVIEWED_BY
:BASED_ON
:EXTRACTED_FROM
```

Gunakan uppercase snake case. Pilih predicate yang jelas.

### 18.3 Property

Umum:

```text
personId
caseId
createdAt
validFrom
validTo
riskScore
sourceSystem
```

Gunakan lower camelCase untuk konsistensi Java.

### 18.4 Naming checklist

Nama yang baik:

1. bisa dibaca oleh domain expert,
2. tidak mengandung artefak database lama,
3. stabil terhadap perubahan implementasi,
4. membedakan fakta, claim, prediction, dan projection,
5. tidak terlalu generik,
6. tidak terlalu spesifik ke nilai property.

---

## 19. Modelling Example 1: Case Management Graph

Mari mulai dari model naif:

```cypher
(:Case {
  caseId: 'CASE-001',
  subjectPersonId: 'P-001',
  officerId: 'O-11',
  evidenceIds: ['E-1', 'E-2'],
  status: 'OPEN'
})
```

Ini bukan graph-native. Ini document-style.

Graph-native basic:

```cypher
(:Person {personId: 'P-001'})<-[:SUBJECT]-(c:Case {caseId: 'CASE-001', status: 'OPEN'})
(c)-[:ASSIGNED_TO]->(:Officer {officerId: 'O-11'})
(c)-[:SUPPORTED_BY]->(:Evidence {evidenceId: 'E-1'})
(c)-[:SUPPORTED_BY]->(:Evidence {evidenceId: 'E-2'})
```

Lebih baik untuk audit:

```cypher
(:Case {caseId: 'CASE-001'})
  -[:HAS_SUBJECT]->(:Person {personId: 'P-001'})

(:Assignment {assignmentId: 'A-001', assignedAt: datetime(...)})
(:Case)-[:HAS_ASSIGNMENT]->(:Assignment)
(:Assignment)-[:ASSIGNED_TO]->(:Officer)
(:Assignment)-[:ASSIGNED_BY]->(:Supervisor)

(:EvidenceAssessment {assessmentId: 'EA-001', confidence: 0.82})
(:Evidence)-[:ASSESSED_AS]->(:EvidenceAssessment)
(:EvidenceAssessment)-[:SUPPORTS]->(:Allegation)
(:EvidenceAssessment)-[:MADE_BY]->(:Officer)
```

Pertanyaannya bukan “model mana paling simple”, tetapi:

> “Model mana yang cukup untuk query, audit, lifecycle, dan perubahan domain?”

---

## 20. Modelling Example 2: Ownership and Control

### 20.1 Simple legal ownership

```cypher
(:Person {personId: 'P-1'})-[:OWNS {percentage: 40}]->(:Company {companyId: 'C-1'})
```

Query:

```text
Find companies owned by P.
Find owners of C.
```

Cukup.

### 20.2 Indirect ownership

```cypher
(:Person)-[:OWNS {percentage: 60}]->(:Company)-[:OWNS {percentage: 50}]->(:Company)
```

Query membutuhkan path multiplication.

### 20.3 Beneficial ownership

Beneficial ownership tidak selalu sama dengan legal ownership.

```cypher
(:Person)-[:BENEFICIAL_OWNER_OF {confidence: 0.76}]->(:Company)
```

Namun jika beneficial ownership adalah finding:

```cypher
(:BeneficialOwnershipFinding {findingId: 'BOF-1', confidence: 0.76})
(:BeneficialOwnershipFinding)-[:SUBJECT]->(:Person)
(:BeneficialOwnershipFinding)-[:TARGET]->(:Company)
(:BeneficialOwnershipFinding)-[:SUPPORTED_BY]->(:Evidence)
(:BeneficialOwnershipFinding)-[:DERIVED_FROM_PATH]->(:OwnershipPath)
(:Officer)-[:APPROVED]->(:BeneficialOwnershipFinding)
```

Lalu bisa materialize edge:

```cypher
(:Person)-[:BENEFICIAL_OWNER_OF {derivedFrom: 'BOF-1', confidence: 0.76}]->(:Company)
```

Ini pattern kuat untuk sistem enforcement: fact/finding node untuk audit, edge ringkas untuk traversal.

---

## 21. Modelling Example 3: Identity and Shared Signals

Naif:

```cypher
(:Person {personId: 'P-1', email: 'x@example.com', phone: '+6281'})
(:Person {personId: 'P-2', email: 'y@example.com', phone: '+6281'})
```

Untuk mencari shared phone:

```cypher
MATCH (p1:Person), (p2:Person)
WHERE p1.phone = p2.phone AND p1.personId <> p2.personId
RETURN p1, p2
```

Ini bukan graph-native.

Graph-native:

```cypher
(:Person {personId: 'P-1'})-[:USES_PHONE]->(:Phone {e164: '+6281'})
(:Person {personId: 'P-2'})-[:USES_PHONE]->(:Phone {e164: '+6281'})
```

Query:

```cypher
MATCH (p1:Person)-[:USES_PHONE]->(ph:Phone)<-[:USES_PHONE]-(p2:Person)
WHERE p1 <> p2
RETURN p1, ph, p2
```

Untuk investigation:

```cypher
(:Person)-[:USED_PHONE {observedAt, source, confidence}]->(:Phone)
```

Jika phone usage punya evidence:

```cypher
(:PhoneUsage {usageId, observedAt, confidence})
(:Person)-[:HAS_PHONE_USAGE]->(:PhoneUsage)
(:PhoneUsage)-[:PHONE]->(:Phone)
(:PhoneUsage)-[:SUPPORTED_BY]->(:Evidence)
```

---

## 22. Model Smells: Tanda Property Graph Salah Desain

### 22.1 Banyak ID list di property

```cypher
(:Case {relatedCaseIds: [...]})
```

Smell: relationship disembunyikan.

### 22.2 Relationship terlalu generik

```cypher
[:RELATED_TO]
[:LINKED_TO]
[:HAS]
```

Tidak selalu salah, tetapi sering menunjukkan semantics belum jelas.

### 22.3 Relationship terlalu spesifik karena nilai

```cypher
[:OWNS_30_PERCENT]
[:OPEN_CASE]
[:HIGH_RISK]
```

Smell: property menjadi type/label.

### 22.4 Semua noun menjadi node

```cypher
(:Name {value: 'Ayu'})
(:BirthDate {value: '1987-05-12'})
(:Status {value: 'OPEN'})
```

Kadang benar, sering berlebihan.

### 22.5 Tidak ada relationship property sama sekali

Jika relationship semua kosong, mungkin semantics kurang kaya atau model terlalu simplistic. Tidak wajib relationship punya property, tetapi di domain real-world sering ada time/source/confidence.

### 22.6 Tidak ada provenance di domain yang butuh audit

Jika graph dipakai untuk keputusan penting, tetapi tidak bisa menjawab “dari mana fakta ini?”, model belum cukup.

### 22.7 Semua fakta current-state, tidak ada history

Jika domain punya lifecycle dan audit, model current-only biasanya gagal.

### 22.8 Graph hanya mirror relational schema

```cypher
(:Person)-[:PERSON_COMPANY_JOIN]->(:PersonCompanyJoin)-[:COMPANY]->(:Company)
```

Kadang import sementara, tapi bukan model final.

---

## 23. Practical Decision Framework

Saat mendesain property graph, gunakan urutan ini.

### Step 1: Tuliskan query bisnis utama

Contoh:

```text
1. Find all cases connected to a subject within 3 hops through shared phone, address, company, or account.
2. Explain why a company is considered high-risk.
3. Find officers who reviewed cases involving entities they are associated with.
4. Discover indirect ownership path from person to regulated company.
5. Show all evidence supporting an allegation and who assessed it.
```

### Step 2: Identifikasi objects yang menjadi anchor traversal

```text
Person, Company, Case, Phone, Address, Account, Evidence, Allegation, Officer
```

### Step 3: Identifikasi relationships sebagai predicate

```text
USES_PHONE
RESIDES_AT
OWNS
HAS_ACCOUNT
SUBJECT_OF
SUPPORTED_BY
REVIEWED_BY
ASSESSED_BY
```

### Step 4: Putuskan property vs node

Gunakan pertanyaan:

```text
Apakah perlu traversal?
Apakah punya identity?
Apakah punya relationship sendiri?
Apakah butuh history/provenance?
Apakah shared across many entities?
```

### Step 5: Tambahkan temporal dan provenance minimal

Untuk setiap relationship/fact penting:

```text
validFrom?
validTo?
source?
confidence?
recordedAt?
```

### Step 6: Cari n-ary facts

Jika fakta melibatkan lebih dari dua entity, pertimbangkan fact node.

### Step 7: Cari supernode risk

Estimasi degree:

```text
How many persons per address?
How many cases per status?
How many transactions per account?
How many entities per country?
```

### Step 8: Tentukan constraints/indexes

Minimal:

```text
Person.personId unique
Company.companyId unique
Case.caseId unique
Evidence.evidenceId unique
Phone.e164 unique
Address.normalized unique, if deduplicated
```

### Step 9: Buat sample graph kecil

Jangan desain hanya di diagram. Tulis sample Cypher dan query.

### Step 10: Uji query path utama

Jika query utama terasa aneh, model kemungkinan salah.

---

## 24. Java Engineer Perspective: Model Graph sebagai Contract, Bukan Object Graph

Sebagai Java engineer, godaan terbesar adalah menyamakan graph database dengan object graph.

Misalnya:

```java
class Person {
    List<Company> companies;
    List<Case> cases;
}
```

Lalu berpikir Neo4j menyimpan object graph seperti ORM.

Ini berbahaya.

Property graph bukan object heap. Ia adalah persistence model dengan query semantics.

### 24.1 Aggregate boundary tidak selalu sama dengan graph boundary

Dalam DDD, aggregate membatasi consistency boundary. Dalam graph, traversal bisa melintasi banyak aggregate.

Contoh:

```text
Case aggregate
Person aggregate
Company aggregate
Evidence aggregate
```

Graph query mungkin melintasi semuanya:

```text
Case -> Subject -> Company -> Account -> Transaction -> OtherAccount -> OtherCompany -> OtherCase
```

Jangan otomatis load semua sebagai object nested. Gunakan Cypher projection sesuai use case.

### 24.2 Repository harus query-oriented

Buruk:

```java
Person person = personRepository.findById(id);
person.getCompanies().get(0).getAccounts().get(0)...
```

Lebih baik:

```java
List<ConnectedCaseView> result = graphInvestigationRepository.findConnectedCases(subjectId, depth, filters);
```

Graph repository sebaiknya berorientasi pada query/path/use-case, bukan CRUD entity saja.

### 24.3 Mapping result ke DTO, bukan selalu domain entity penuh

Cypher menghasilkan rows, paths, nodes, relationships, maps, aggregates. Banyak query lebih cocok return DTO:

```java
record RelatedCaseResult(
    String caseId,
    String reason,
    int distance,
    double confidence,
    List<PathSegment> path
) {}
```

Bukan `Case` entity penuh dengan seluruh graph loaded.

---

## 25. Common Modelling Trade-offs

### 25.1 Simplicity vs auditability

Simple:

```cypher
(:Person)-[:OWNS]->(:Company)
```

Auditable:

```cypher
(:OwnershipFact)-[:OWNER]->(:Person)
(:OwnershipFact)-[:OWNED]->(:Company)
(:OwnershipFact)-[:SUPPORTED_BY]->(:Evidence)
```

Trade-off:

```text
Simple edge: fast and readable.
Fact node: richer and defensible.
```

### 25.2 Traversal speed vs semantic richness

Direct edge:

```text
Person -> Company
```

Rich model:

```text
Person -> OwnershipFact -> Company
```

Sometimes use both:

```text
Fact node as source-of-truth.
Derived edge as query acceleration.
```

### 25.3 Flexibility vs governance

Flexible graph lets teams add new labels/types quickly. But uncontrolled evolution creates semantic mess.

Use:

```text
schema catalogue
naming convention
migration review
query contract tests
data quality checks
```

### 25.4 Normalization vs graph usability

Do not over-normalize simple properties into nodes. Do not under-model shared identifiers as string properties.

The right model is driven by query and semantics.

---

## 26. Property Graph and RDF: Important Distinction

Graph database discussions often confuse property graph with RDF/triple stores.

### 26.1 Property graph

Property graph:

```text
Nodes have labels and properties.
Relationships have type, direction, and properties.
```

Example:

```cypher
(:Person {name: 'Ayu'})-[:OWNS {percentage: 35}]->(:Company {name: 'PT Sagara'})
```

### 26.2 RDF triple model

RDF stores facts as triples:

```text
subject predicate object
```

Example:

```text
Ayu owns PT_Sagara
Ayu hasName "Ayu"
Ownership hasPercentage "35"
```

RDF ecosystem emphasizes ontologies, semantic web standards, reasoning, SPARQL, and triples.

Property graph ecosystem emphasizes pragmatic graph modelling, traversal, Cypher/GQL-style querying, relationship properties, and application development.

### 26.3 Which one matters for this series?

This series focuses on Neo4j property graph. We will discuss knowledge graph and ontology later, but from an engineering perspective using Neo4j.

Important mental distinction:

```text
Property graph is excellent for connected operational/application graph use cases.
RDF is often chosen when standards-based semantic interoperability and formal ontology reasoning dominate.
```

Neither is universally better. They optimize for different modelling and ecosystem priorities.

---

## 27. Mini Case Study: Regulatory Enforcement Graph Model Evolution

### Stage 1: Basic entity graph

```cypher
(:Person)-[:OWNS]->(:Company)
(:Company)-[:SUBJECT_OF]->(:Case)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Officer)-[:REVIEWED]->(:Case)
```

Good for simple navigation.

### Stage 2: Add role semantics

```cypher
(:Person)-[:DIRECTOR_OF]->(:Company)
(:Person)-[:BENEFICIAL_OWNER_OF]->(:Company)
(:Person)-[:AUTHORIZED_SIGNATORY_OF]->(:Account)
```

Better legal semantics.

### Stage 3: Add temporal validity

```cypher
(:Person)-[:DIRECTOR_OF {validFrom, validTo, source}]->(:Company)
```

Now we can ask as-of questions.

### Stage 4: Add provenance

```cypher
(:AppointmentFact)-[:PERSON]->(:Person)
(:AppointmentFact)-[:COMPANY]->(:Company)
(:AppointmentFact)-[:ROLE]->(:Role)
(:AppointmentFact)-[:EXTRACTED_FROM]->(:Document)
```

Now we can defend facts.

### Stage 5: Add findings and decisions

```cypher
(:Finding)-[:SUPPORTED_BY]->(:Evidence)
(:Finding)-[:CONCLUDES]->(:RiskSignal)
(:Decision)-[:BASED_ON]->(:Finding)
(:Decision)-[:RESULTED_IN]->(:EnforcementAction)
```

Now the graph supports decision traceability.

### Stage 6: Add derived relationships for operations

```cypher
(:Person)-[:INDIRECTLY_CONTROLS {derivedFrom, confidence}]->(:Company)
(:Case)-[:RELATED_TO {reason, computedAt}]->(:Case)
```

Now the graph supports fast investigation workflows, while still preserving source facts.

This evolution is common: start with simple graph, then add precision where domain pressure demands it.

---

## 28. Modelling Checklist for Part 002

Use this checklist when reviewing a graph model.

### Node checklist

```text
[ ] Does this node represent something with identity?
[ ] Will it be used as traversal start/end/intermediate?
[ ] Does it have relationships of its own?
[ ] Is it shared by multiple other nodes?
[ ] Does it require audit/history/provenance?
[ ] Is it truly a node, not just a scalar attribute?
```

### Relationship checklist

```text
[ ] Does the relationship type read as a domain predicate?
[ ] Is direction consistent and natural?
[ ] Are relationship properties describing the relationship, not the endpoints?
[ ] Does this relationship need temporal validity?
[ ] Does it need provenance/source/confidence?
[ ] Should it be reified into a fact node?
[ ] Could it create supernode/fan-out problems?
```

### Label checklist

```text
[ ] Is this label a stable conceptual category?
[ ] Is it used as query anchor or constraint scope?
[ ] Is it better as a property?
[ ] Are multi-label rules consistent?
[ ] Are we avoiding label explosion?
```

### Property checklist

```text
[ ] Is this property scalar and endpoint-specific?
[ ] Is it hiding a relationship?
[ ] Does it need indexing?
[ ] Does it need history?
[ ] Does it need normalization?
[ ] Is it sensitive data requiring hashing/encryption/tokenization?
```

### Audit/provenance checklist

```text
[ ] Can we answer where this fact came from?
[ ] Can we answer when it was valid?
[ ] Can we answer when we learned it?
[ ] Can we answer who asserted/reviewed/accepted it?
[ ] Can we represent conflicting claims?
[ ] Can we distinguish fact, claim, finding, prediction, and projection?
```

---

## 29. Latihan Praktis

### Latihan 1: Property vs node

Untuk setiap item berikut, putuskan apakah menjadi property atau node untuk fraud/investigation graph:

```text
email
phone number
birth date
risk score
risk category
address
country
device fingerprint
case status
regulatory obligation
```

Jawaban tidak tunggal. Jelaskan berdasarkan query.

### Latihan 2: Relationship vs fact node

Modelkan:

```text
A person is appointed as director of a company from 2022 to 2024 based on a registry document, then the appointment is disputed in a case.
```

Buat dua model:

1. simple relationship model,
2. reified fact node model.

Bandingkan trade-off.

### Latihan 3: Temporal ownership

Modelkan ownership yang berubah:

```text
P owns 40% of C from Jan 2020.
P transfers 20% to Q in Mar 2023.
Q transfers 10% to R in Jan 2024.
```

Pertanyaan query:

```text
Who owned C on 2022-12-31?
Who owned C on 2024-02-01?
What evidence supports each ownership period?
```

### Latihan 4: Claim vs accepted fact

Modelkan dua sumber yang bertentangan tentang beneficial ownership.

Harus bisa menjawab:

```text
What did Source A claim?
What did Source B claim?
Which claim was accepted?
Who accepted it?
What evidence was used?
```

---

## 30. Ringkasan Inti

Property graph model terlihat sederhana: node, relationship, label, type, property. Namun kekuatan sebenarnya ada pada keputusan modelling.

Hal paling penting dari Part 002:

1. Node adalah unit identitas yang bisa dihubungkan, bukan semua noun.
2. Relationship adalah fakta berarah, bukan foreign key.
3. Label adalah klasifikasi node yang harus stabil dan berguna untuk query/schema.
4. Relationship type adalah predicate domain; jangan terlalu generik, jangan juga menjadi property-value explosion.
5. Property cocok untuk scalar attribute, tetapi jangan menyembunyikan relationship penting.
6. Jika relationship perlu identity, evidence, lifecycle, atau menghubungkan lebih dari dua entity, gunakan reification/fact node.
7. Temporalitas dan provenance bukan fitur tambahan untuk domain audit-heavy; keduanya adalah bagian dari correctness.
8. Graph schema tetap perlu dirancang, didokumentasikan, diuji, dan dijaga.
9. Sebagai Java engineer, jangan memetakan graph langsung seperti object graph/ORM; desain query dan projection berdasarkan use case.
10. Model graph yang baik bukan yang paling indah di diagram, tetapi yang menjawab query penting dengan semantics yang benar, performa masuk akal, dan auditability cukup.

---

## 31. Referensi Resmi yang Relevan

Referensi ini berguna untuk memperkuat konsep Part 002:

1. Neo4j Graph Database Concepts  
   https://neo4j.com/docs/getting-started/appendix/graphdb-concepts/

2. Neo4j — What is a graph database?  
   https://neo4j.com/docs/getting-started/graph-database/

3. Neo4j — What is graph data modeling?  
   https://neo4j.com/docs/getting-started/data-modeling/

4. Neo4j — Graph modeling tips  
   https://neo4j.com/docs/getting-started/data-modeling/modeling-tips/

5. Neo4j Cypher Manual — Property, structural, and constructed values  
   https://neo4j.com/docs/cypher-manual/current/values-and-types/property-structural-constructed/

6. Neo4j Cypher Manual — Node and relationship operators  
   https://neo4j.com/docs/cypher-manual/current/expressions/node-relationship-operators/

7. Neo4j Cypher Manual — Graph types  
   https://neo4j.com/docs/cypher-manual/current/schema/graph-types/

---

## 32. Penutup Part 002

Part ini adalah fondasi modelling. Setelah ini, kita akan masuk ke arsitektur internal Neo4j.

Part berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-003.md
```

Topik:

```text
Neo4j Architecture: Storage, Query Engine, and Runtime Mental Model
```

Di sana kita akan membahas bagaimana Neo4j menyimpan dan mengeksekusi graph: node store, relationship store, property store, adjacency/traversal locality, page cache, heap, transaction log, query planning, runtime operators, cardinality, dan bottleneck umum.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — Graph Thinking: From Entities to Relationships to Paths</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-003.md">Part 003 — Neo4j Architecture: Storage, Query Engine, and Runtime Mental Model ➡️</a>
</div>
