# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-007.md

# Part 007 — Advanced Graph Modelling Patterns

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Audience: Java software engineer / tech lead  
> Fokus: pola modelling graph tingkat lanjut untuk sistem produksi  
> Status: Part 007 dari 032

---

## 0. Posisi Part Ini Dalam Seri

Pada bagian sebelumnya kita sudah membahas metodologi modelling:

1. mulai dari pertanyaan bisnis,
2. identifikasi path yang harus murah,
3. tentukan anchor node,
4. pilih node/relationship/property,
5. validasi cardinality dan fan-out,
6. uji dengan query nyata,
7. refactor berdasarkan profil query.

Part ini masuk ke tahap berikutnya: **pola desain graph yang sering muncul di sistem nyata**.

Tujuannya bukan menghafal template, tetapi membentuk kemampuan untuk melihat struktur berulang di berbagai domain:

- membership,
- role assignment,
- entitlement,
- hierarchy,
- dependency,
- temporal validity,
- evidence/provenance,
- derived relationship,
- similarity,
- scoring,
- multi-tenancy,
- versioning,
- materialized traversal.

Dalam Neo4j, node merepresentasikan entity/discrete object, relationship merepresentasikan koneksi antar-node, relationship punya direction, type, dan properties, serta node bisa punya label dan properties. Neo4j juga menekankan bahwa relationship type yang baik sebaiknya spesifik agar traversal bisa memilih hubungan yang relevan saja, bukan melebar ke edge yang tidak perlu.

---

## 1. Mental Model: Pattern Bukan Template, Tapi Trade-off

Advanced modelling pattern bukan jawaban final. Pattern adalah bentuk awal untuk menjawab pertanyaan seperti:

```text
Apa fakta domain yang harus mudah dijelajahi?
Apa invariant yang harus dijaga?
Apa query yang harus cepat?
Apa perubahan yang sering terjadi?
Apa informasi historis yang harus tetap bisa diaudit?
Apa path yang tidak boleh meledak?
```

Pattern yang sama bisa benar atau salah tergantung workload.

Contoh:

```cypher
(:User)-[:MEMBER_OF]->(:Group)
```

Model ini terlihat sederhana. Namun untuk sistem enterprise access control, pertanyaan berikut menentukan apakah model ini cukup:

1. Apakah membership punya periode berlaku?
2. Apakah membership butuh approval?
3. Apakah membership diwariskan dari organisasi?
4. Apakah membership punya source system?
5. Apakah membership punya confidence score?
6. Apakah membership bisa dicabut tapi historinya harus tetap ada?
7. Apakah query paling penting adalah “user punya akses apa?” atau “resource bisa diakses siapa?”
8. Apakah group bisa nested?
9. Apakah ada segregation-of-duty rule?
10. Apakah tenant harus benar-benar terisolasi?

Jika jawabannya kompleks, relationship sederhana mungkin perlu diganti atau ditambah dengan node reifikasi.

---

## 2. Pattern 1 — Direct Relationship Pattern

### 2.1 Bentuk

```cypher
(:Person)-[:OWNS]->(:Account)
(:Customer)-[:PLACED]->(:Order)
(:Case)-[:ASSIGNED_TO]->(:Officer)
(:Service)-[:DEPENDS_ON]->(:Service)
```

Ini pattern paling natural di property graph.

### 2.2 Kapan Cocok

Gunakan direct relationship ketika:

1. hubungan bersifat binary,
2. relationship punya semantic jelas,
3. relationship tidak punya lifecycle kompleks,
4. tidak perlu identity sendiri,
5. tidak perlu banyak participant,
6. query utama adalah traversal cepat dari satu entity ke entity lain.

Contoh:

```cypher
MATCH (p:Person {id: $personId})-[:OWNS]->(a:Account)
RETURN a
```

### 2.3 Keunggulan

1. Query sederhana.
2. Traversal murah.
3. Model mudah dibaca.
4. Cocok untuk graph exploration.
5. Relationship type bisa membatasi traversal.

### 2.4 Kelemahan

Direct relationship mulai lemah ketika hubungan itu sendiri punya identitas atau proses.

Contoh buruk:

```cypher
(:Person)-[:OWNS {
  ownershipId: 'OWN-001',
  validFrom: date('2024-01-01'),
  validTo: null,
  approvalStatus: 'APPROVED',
  approvedBy: 'OFFICER-9',
  sourceSystem: 'REGISTRY',
  evidenceId: 'EVD-100'
}]->(:Company)
```

Ini masih mungkin, tetapi mulai mencampur terlalu banyak fakta ke relationship.

Masalahnya:

1. `approvedBy` sebenarnya entity officer.
2. `evidenceId` sebenarnya node evidence.
3. approval punya lifecycle.
4. ownership bisa punya beberapa dokumen pendukung.
5. ownership bisa disengketakan.
6. ownership bisa punya beberapa source dengan confidence berbeda.

Dalam kasus seperti ini, pertimbangkan reification.

---

## 3. Pattern 2 — Relationship With Properties

### 3.1 Bentuk

```cypher
(:Person)-[:OWNS {
  percentage: 35.5,
  validFrom: date('2023-01-01'),
  validTo: date('2025-12-31'),
  source: 'corporate-registry'
}]->(:Company)
```

Relationship properties cocok ketika properti tersebut menjelaskan **edge**, bukan node.

### 3.2 Contoh Properti yang Cocok di Relationship

| Relationship | Property | Alasan |
|---|---:|---|
| `OWNS` | `percentage` | persentase adalah atribut ownership, bukan atribut person/company |
| `TRANSFERRED_TO` | `amount` | amount adalah atribut transaksi/transfer edge jika transaksi sederhana |
| `RATED` | `score` | score menjelaskan rating dari user ke item |
| `WORKED_AT` | `from`, `to` | periode kerja menjelaskan hubungan person-company |
| `SIMILAR_TO` | `score` | similarity score menjelaskan hubungan antar-node |
| `DEPENDS_ON` | `criticality` | criticality menjelaskan dependency |

### 3.3 Properti yang Tidak Cocok di Relationship

| Property | Kenapa Bermasalah |
|---|---|
| `approvedByName` | officer seharusnya node |
| `evidenceDocumentIds` | evidence seharusnya node jika perlu traversal/audit |
| `statusHistory` | lifecycle kompleks lebih cocok jadi node/event |
| `comments` dalam array besar | graph bukan storage blob/log panjang |
| `tenantName` saja | tenant isolation butuh desain eksplisit |

### 3.4 Rule of Thumb

Gunakan relationship property jika:

```text
Properti itu tidak perlu menjadi anchor query utama,
tidak perlu punya relationship sendiri,
tidak perlu lifecycle/audit kompleks,
dan secara konseptual melekat pada hubungan dua node.
```

Gunakan node jika:

```text
Fakta itu perlu dihubungkan ke banyak hal,
punya identitas,
punya status,
punya lifecycle,
punya provenance,
atau perlu diaudit sebagai objek keputusan.
```

---

## 4. Pattern 3 — Reified Relationship / Relationship as Node

### 4.1 Masalah

Graph property model native mendukung relationship antara dua node. Namun domain nyata sering punya hubungan yang:

1. punya banyak participant,
2. punya lifecycle,
3. punya evidence,
4. punya approval,
5. punya dispute,
6. punya version,
7. punya source berbeda,
8. harus bisa diaudit.

Dalam kasus tersebut, relationship perlu dijadikan node.

### 4.2 Bentuk

Dari:

```cypher
(:Person)-[:OWNS {percentage: 35.5}]->(:Company)
```

Menjadi:

```cypher
(:Person)-[:PARTY_IN]->(:Ownership)-[:OWNED_ENTITY]->(:Company)
(:Ownership)-[:SUPPORTED_BY]->(:Evidence)
(:Ownership)-[:APPROVED_BY]->(:Officer)
(:Ownership)-[:REPORTED_BY]->(:SourceSystem)
```

### 4.3 Contoh Query

```cypher
MATCH (p:Person {id: $personId})-[:PARTY_IN]->(o:Ownership)-[:OWNED_ENTITY]->(c:Company)
WHERE o.validFrom <= date() AND (o.validTo IS NULL OR o.validTo > date())
RETURN c.name, o.percentage, o.status
```

### 4.4 Keunggulan

1. Relationship kompleks punya identity.
2. Bisa punya relationship ke evidence, source, officer, decision.
3. Bisa punya lifecycle.
4. Lebih audit-friendly.
5. Bisa mewakili hyperedge/multi-party relation.

### 4.5 Kekurangan

1. Traversal lebih panjang.
2. Query lebih verbose.
3. Bisa over-modeling.
4. Butuh naming yang disiplin.

### 4.6 Kapan Wajib Dipertimbangkan

Reify relationship jika ada kalimat domain seperti:

```text
Hubungan ini disetujui oleh...
Hubungan ini didukung oleh evidence...
Hubungan ini berlaku dari... sampai...
Hubungan ini diperselisihkan...
Hubungan ini punya beberapa pihak...
Hubungan ini berasal dari source...
Hubungan ini menjadi objek review...
```

Kalau hubungan bisa menjadi “subjek kalimat”, besar kemungkinan ia layak menjadi node.

---

## 5. Pattern 4 — Membership Pattern

### 5.1 Bentuk Dasar

```cypher
(:User)-[:MEMBER_OF]->(:Group)
```

Query:

```cypher
MATCH (u:User {id: $userId})-[:MEMBER_OF]->(g:Group)
RETURN g
```

### 5.2 Membership Dengan Temporal Validity

```cypher
(:User)-[:MEMBER_OF {
  validFrom: date('2025-01-01'),
  validTo: null
}]->(:Group)
```

Query current membership:

```cypher
MATCH (u:User {id: $userId})-[m:MEMBER_OF]->(g:Group)
WHERE m.validFrom <= date()
  AND (m.validTo IS NULL OR m.validTo > date())
RETURN g
```

### 5.3 Membership Sebagai Node

Jika membership perlu approval/evidence/source:

```cypher
(:User)-[:HAS_MEMBERSHIP]->(:Membership)-[:IN_GROUP]->(:Group)
(:Membership)-[:APPROVED_BY]->(:Officer)
(:Membership)-[:REQUESTED_BY]->(:User)
(:Membership)-[:SUPPORTED_BY]->(:Evidence)
```

### 5.4 Kapan Direct, Kapan Reified

| Requirement | Direct Relationship | Reified Membership Node |
|---|---:|---:|
| hanya cek user anggota group | bagus | terlalu berat |
| ada validFrom/validTo sederhana | masih cukup | opsional |
| ada approval workflow | lemah | kuat |
| ada evidence/audit | lemah | kuat |
| ada revocation reason | bisa tapi makin berat | kuat |
| membership adalah objek UI | lemah | kuat |
| membership punya status lifecycle | lemah | kuat |

### 5.5 Failure Mode

Kesalahan umum:

```cypher
(:User)-[:MEMBER_OF]->(:Group)-[:MEMBER_OF]->(:Group)
```

Nested group bisa menyebabkan traversal tak terkendali jika tidak dibatasi:

```cypher
MATCH (u:User {id: $userId})-[:MEMBER_OF*]->(g:Group)
RETURN g
```

Lebih aman:

```cypher
MATCH path = (u:User {id: $userId})-[:MEMBER_OF*1..5]->(g:Group)
RETURN g, length(path) AS depth
```

Selalu desain batas depth dan cycle policy untuk nested membership.

---

## 6. Pattern 5 — Role Assignment Pattern

### 6.1 Bentuk Sederhana

```cypher
(:User)-[:HAS_ROLE]->(:Role)
(:Role)-[:GRANTS]->(:Permission)
```

Query:

```cypher
MATCH (u:User {id: $userId})-[:HAS_ROLE]->(:Role)-[:GRANTS]->(p:Permission)
RETURN DISTINCT p
```

### 6.2 Role Dalam Scope

Role sering tidak global. Seseorang bisa menjadi `CaseReviewer` untuk case A, tetapi bukan case B.

Model direct property:

```cypher
(:User)-[:HAS_ROLE {scopeType: 'CASE', scopeId: 'CASE-123'}]->(:Role)
```

Ini cepat untuk kasus sederhana, tetapi scope tidak bisa ditraverse sebagai node.

Model graph-native:

```cypher
(:User)-[:HAS_ASSIGNMENT]->(:RoleAssignment)-[:ROLE]->(:Role)
(:RoleAssignment)-[:SCOPE]->(:Case)
```

Query:

```cypher
MATCH (u:User {id: $userId})-[:HAS_ASSIGNMENT]->(ra:RoleAssignment)-[:ROLE]->(r:Role),
      (ra)-[:SCOPE]->(c:Case {id: $caseId})
RETURN r
```

### 6.3 Role Assignment Dengan Lifecycle

```cypher
(:RoleAssignment {
  id: 'RA-001',
  status: 'ACTIVE',
  validFrom: date('2025-01-01'),
  validTo: null,
  reason: 'case escalation'
})
```

Connected to:

```cypher
(:RoleAssignment)-[:ASSIGNED_BY]->(:Officer)
(:RoleAssignment)-[:APPROVED_BY]->(:Manager)
(:RoleAssignment)-[:BASED_ON]->(:Decision)
```

### 6.4 Design Note

Untuk access control sederhana, relational ACL mungkin cukup. Graph menjadi kuat saat permission berasal dari path:

```text
user → role assignment → role → permission → action → resource
user → group → role → permission
user → org unit → delegated authority → case type → permission
```

Jika access explanation penting, graph memberi jawaban seperti:

```text
User U dapat melihat Case C karena:
U MEMBER_OF Group G,
G HAS_ROLE RegionalReviewer,
RegionalReviewer GRANTS VIEW_CASE,
VIEW_CASE APPLIES_TO CaseType EnforcementCase,
C INSTANCE_OF EnforcementCase.
```

---

## 7. Pattern 6 — Entitlement and Permission Graph

### 7.1 Bentuk

```cypher
(:Principal)-[:MEMBER_OF]->(:Group)
(:Principal)-[:HAS_ROLE]->(:Role)
(:Group)-[:HAS_ROLE]->(:Role)
(:Role)-[:GRANTS]->(:Permission)
(:Permission)-[:ALLOWS]->(:Action)
(:Permission)-[:ON]->(:ResourceType)
(:Resource)-[:INSTANCE_OF]->(:ResourceType)
```

### 7.2 Query: Permission Effective

```cypher
MATCH (u:User {id: $userId})
MATCH path = (u)-[:MEMBER_OF*0..3]->(:Group)-[:HAS_ROLE]->(:Role)-[:GRANTS]->(p:Permission)
RETURN DISTINCT p, path
```

### 7.3 Query: Why User Can Access Resource

```cypher
MATCH path = (u:User {id: $userId})-[:MEMBER_OF*0..3]->(:Group)-[:HAS_ROLE]->(:Role)-[:GRANTS]->(:Permission)-[:ALLOWS]->(:Action {name: $action})
MATCH (res:Resource {id: $resourceId})-[:INSTANCE_OF]->(:ResourceType)<-[:ON]-(:Permission)
RETURN path
LIMIT 10
```

Catatan: query di atas perlu dirapikan untuk sistem nyata agar permission node yang sama terikat di kedua pattern. Bentuk yang lebih aman:

```cypher
MATCH path = (u:User {id: $userId})-[:MEMBER_OF*0..3]->(:Group)-[:HAS_ROLE]->(:Role)-[:GRANTS]->(p:Permission)-[:ALLOWS]->(:Action {name: $action})
MATCH (p)-[:ON]->(rt:ResourceType)<-[:INSTANCE_OF]-(res:Resource {id: $resourceId})
RETURN path, res
```

### 7.4 Failure Mode

Permission graph sering gagal karena:

1. nested group tidak dibatasi,
2. deny rule tidak dimodelkan dengan jelas,
3. scope dicampur sebagai string property,
4. tenant boundary tidak dipaksa di setiap traversal,
5. query authorization terlalu mahal untuk request path latency,
6. security trimming dilakukan setelah data keburu diambil.

### 7.5 Production Pattern

Untuk request latency rendah:

1. graph dipakai untuk explanation dan periodic entitlement computation,
2. hasil effective permission bisa diproyeksikan ke cache/index,
3. runtime authorization menggunakan materialized entitlement,
4. graph tetap menjadi sumber explainability dan audit path.

---

## 8. Pattern 7 — Hierarchy Pattern

### 8.1 Bentuk Dasar

```cypher
(:OrgUnit)-[:PARENT_OF]->(:OrgUnit)
(:Category)-[:PARENT_OF]->(:Category)
(:Regulation)-[:HAS_SECTION]->(:Section)
(:Folder)-[:CONTAINS]->(:Folder)
```

### 8.2 Query Ancestors

```cypher
MATCH path = (leaf:OrgUnit {id: $unitId})<-[:PARENT_OF*1..10]-(ancestor:OrgUnit)
RETURN ancestor, length(path) AS distance
ORDER BY distance
```

### 8.3 Query Descendants

```cypher
MATCH path = (root:OrgUnit {id: $rootId})-[:PARENT_OF*1..10]->(descendant:OrgUnit)
RETURN descendant, length(path) AS depth
```

### 8.4 Direction Choice

Pilih direction berdasarkan query paling umum.

Jika query umum: dari parent ke children:

```cypher
(:Parent)-[:PARENT_OF]->(:Child)
```

Jika query umum: dari child ke parent:

```cypher
(:Child)-[:BELONGS_TO]->(:Parent)
```

Neo4j bisa traverse dua arah, tetapi direction tetap penting untuk semantic readability dan query discipline.

### 8.5 Tree vs DAG

Hierarchy tidak selalu tree.

Tree:

```text
Setiap child punya satu parent.
```

DAG:

```text
Satu node bisa punya banyak parent, tetapi tidak boleh cycle.
```

Contoh DAG:

```text
regulatory obligation masuk ke beberapa thematic category
software component dipakai oleh beberapa services
person punya beberapa reporting lines
```

### 8.6 Invariant

Untuk tree:

```text
Setiap node selain root punya tepat satu parent.
Tidak boleh cycle.
```

Untuk DAG:

```text
Multiple parent boleh.
Cycle tidak boleh.
```

Neo4j constraint tidak otomatis mencegah cycle hierarchy. Anda perlu menjaga dengan application logic atau pre-write check.

Contoh pre-write cycle check:

```cypher
MATCH (parent:OrgUnit {id: $parentId}), (child:OrgUnit {id: $childId})
MATCH path = (child)-[:PARENT_OF*1..]->(parent)
RETURN path
LIMIT 1
```

Jika query mengembalikan path, menambahkan `parent-[:PARENT_OF]->child` akan membuat cycle.

---

## 9. Pattern 8 — Bill of Materials / Composition Pattern

### 9.1 Bentuk

```cypher
(:Product)-[:CONTAINS {quantity: 4}]->(:Component)
(:Component)-[:CONTAINS {quantity: 2}]->(:SubComponent)
```

### 9.2 Query Explosion

```cypher
MATCH path = (p:Product {sku: $sku})-[:CONTAINS*1..10]->(part:Component)
RETURN part, path
```

BOM mirip hierarchy, tetapi relationship punya properti kuantitatif seperti `quantity`, `unit`, `required`, `optional`, `version`.

### 9.3 Dependency Quantity Calculation

Cypher bisa menghitung path quantities, tetapi hati-hati dengan path explosion.

Contoh sederhana:

```cypher
MATCH path = (p:Product {sku: $sku})-[rels:CONTAINS*1..5]->(part:Component)
RETURN part.sku AS component,
       reduce(total = 1, r IN rels | total * r.quantity) AS requiredQuantity
```

### 9.4 Kapan BOM Menjadi Graph Problem

BOM cocok untuk graph ketika perlu:

1. impact analysis,
2. affected product discovery,
3. shared component risk,
4. recursive dependency,
5. variant/version traversal,
6. supply chain traceability.

Jika hanya butuh aggregate quantity per product dalam batch, OLAP atau relational recursive query bisa cukup.

---

## 10. Pattern 9 — Dependency Graph Pattern

### 10.1 Bentuk

```cypher
(:Service)-[:DEPENDS_ON]->(:Service)
(:Service)-[:USES]->(:Database)
(:Service)-[:PUBLISHES]->(:Topic)
(:Service)-[:CONSUMES]->(:Topic)
(:Job)-[:READS_FROM]->(:Table)
(:Job)-[:WRITES_TO]->(:Table)
```

### 10.2 Use Case

1. Blast radius.
2. Change impact.
3. Runtime dependency discovery.
4. Ownership mapping.
5. Incident analysis.
6. Data lineage.
7. Deployment sequencing.

### 10.3 Query: Downstream Impact

```cypher
MATCH path = (s:Service {name: $service})<-[:DEPENDS_ON*1..5]-(downstream:Service)
RETURN downstream.name, length(path) AS distance
ORDER BY distance
```

### 10.4 Query: What Breaks If Database Changes?

```cypher
MATCH path = (db:Database {name: $database})<-[:USES*1..3]-(svc:Service)
RETURN svc, path
```

### 10.5 Direction Discipline

Dependency direction harus konsisten.

Rekomendasi:

```cypher
(:Consumer)-[:DEPENDS_ON]->(:Provider)
```

Artinya:

```text
A DEPENDS_ON B = A membutuhkan B.
```

Untuk blast radius downstream, traverse reverse:

```cypher
(provider)<-[:DEPENDS_ON*]-(consumer)
```

Untuk prerequisites upstream, traverse forward:

```cypher
(consumer)-[:DEPENDS_ON*]->(provider)
```

### 10.6 Failure Mode

1. Direction dibalik-balik antar-team.
2. Semua dependency memakai type `RELATED_TO`.
3. Tidak ada confidence/source.
4. Runtime dependency dan declared dependency dicampur.
5. Dependency stale tidak dibersihkan.
6. Service supernode muncul karena “shared platform” tanpa partition.

### 10.7 Better Model

```cypher
(:Service)-[:CALLS {source: 'trace', confidence: 0.92, lastSeenAt: datetime()}]->(:Service)
(:Service)-[:DECLARES_DEPENDENCY {source: 'catalog'}]->(:Service)
(:Service)-[:OWNS]->(:Topic)
(:Service)-[:CONSUMES]->(:Topic)
(:Service)-[:RUNS_ON]->(:Cluster)
(:Team)-[:OWNS]->(:Service)
```

Bedakan fakta observasi dan fakta deklaratif.

---

## 11. Pattern 10 — Temporal Relationship Pattern

### 11.1 Masalah

Banyak domain tidak hanya bertanya:

```text
Apa hubungan A dan B?
```

Tetapi:

```text
Apa hubungan A dan B pada tanggal tertentu?
Kapan hubungan itu mulai?
Kapan selesai?
Siapa yang mengubah?
Apa status historisnya?
```

### 11.2 Simple Temporal Edge

```cypher
(:Person)-[:WORKED_AT {
  from: date('2020-01-01'),
  to: date('2024-05-31')
}]->(:Company)
```

Query as-of:

```cypher
MATCH (p:Person {id: $personId})-[r:WORKED_AT]->(c:Company)
WHERE r.from <= $asOf
  AND (r.to IS NULL OR r.to > $asOf)
RETURN c
```

### 11.3 Temporal Node

Jika relationship punya lifecycle kompleks:

```cypher
(:Person)-[:HELD_POSITION]->(:Employment)-[:AT_COMPANY]->(:Company)
(:Employment)-[:HAS_ROLE]->(:JobTitle)
(:Employment)-[:SUPPORTED_BY]->(:Evidence)
```

### 11.4 Valid Time vs Transaction Time

Pisahkan:

```text
valid time      = kapan fakta berlaku di dunia nyata
transaction time = kapan sistem mengetahui/merekam fakta itu
```

Contoh:

```cypher
(:Ownership {
  validFrom: date('2024-01-01'),
  validTo: null,
  recordedAt: datetime('2025-03-10T09:15:00Z'),
  sourceReceivedAt: datetime('2025-03-09T22:30:00Z')
})
```

### 11.5 Audit Concern

Jangan overwrite fakta historis jika sistem harus audit-ready.

Model buruk:

```cypher
MATCH (p:Person)-[r:OWNS]->(c:Company)
SET r.percentage = 40
```

Model lebih defensible:

```cypher
MATCH (p:Person {id: $personId})-[old:OWNS]->(c:Company {id: $companyId})
WHERE old.validTo IS NULL
SET old.validTo = date()
CREATE (p)-[:OWNS {
  percentage: $newPercentage,
  validFrom: date(),
  validTo: null,
  recordedAt: datetime(),
  changeReason: $reason
}]->(c)
```

---

## 12. Pattern 11 — Event-to-State Graph Projection

### 12.1 Konsep

Event source menyimpan perubahan sebagai event. Graph menyimpan proyeksi current/analytical state.

Contoh event:

```json
{
  "type": "CASE_ESCALATED",
  "caseId": "CASE-123",
  "fromUnit": "UNIT-A",
  "toUnit": "UNIT-B",
  "occurredAt": "2026-06-01T10:00:00Z"
}
```

Graph projection:

```cypher
(:Case)-[:CURRENTLY_ASSIGNED_TO]->(:OrgUnit)
(:Case)-[:ESCALATED_TO {at: datetime(...)}]->(:OrgUnit)
```

### 12.2 Current State + History

```cypher
(:Case)-[:CURRENT_OWNER]->(:Officer)
(:Case)-[:OWNERSHIP_EVENT]->(:CaseOwnershipEvent)-[:FROM]->(:Officer)
(:CaseOwnershipEvent)-[:TO]->(:Officer)
```

### 12.3 Keunggulan

1. Query operational cepat.
2. History tetap ada.
3. Bisa rebuild projection.
4. Bisa reconcile dari event log.
5. Cocok untuk event-driven architecture.

### 12.4 Risiko

1. Dual source of truth.
2. Projection lag.
3. Event ordering issue.
4. Idempotency problem.
5. Partial update graph.
6. Rebuild mahal jika graph besar.

### 12.5 Rule

Jangan menyebut graph sebagai source of truth jika ia hanya projection.

Gunakan istilah eksplisit:

```text
System of record: relational/event store
Graph projection: Neo4j
Graph usage: investigation/query/explanation/impact analysis
```

---

## 13. Pattern 12 — Versioned Entity Pattern

### 13.1 Masalah

Entity berubah seiring waktu, tetapi sistem perlu melihat versi lama.

Contoh:

```text
Policy berubah.
Regulation berubah.
Product berubah.
Organization structure berubah.
Case classification berubah.
```

### 13.2 Current Node + Version Nodes

```cypher
(:Policy {id: 'POL-1'})-[:CURRENT_VERSION]->(:PolicyVersion {version: 3})
(:Policy)-[:HAS_VERSION]->(:PolicyVersion {version: 1})
(:Policy)-[:HAS_VERSION]->(:PolicyVersion {version: 2})
(:Policy)-[:HAS_VERSION]->(:PolicyVersion {version: 3})
```

### 13.3 Relationships to Version

Jika decision harus merujuk versi policy yang berlaku saat keputusan dibuat:

```cypher
(:Decision)-[:BASED_ON]->(:PolicyVersion)
```

Bukan:

```cypher
(:Decision)-[:BASED_ON]->(:Policy)
```

Karena `Policy` bisa berubah.

### 13.4 Query Current

```cypher
MATCH (p:Policy {id: $policyId})-[:CURRENT_VERSION]->(v:PolicyVersion)
RETURN v
```

### 13.5 Query As-of

```cypher
MATCH (p:Policy {id: $policyId})-[:HAS_VERSION]->(v:PolicyVersion)
WHERE v.validFrom <= $asOf
  AND (v.validTo IS NULL OR v.validTo > $asOf)
RETURN v
```

### 13.6 Design Rule

Jika fakta digunakan sebagai dasar keputusan formal, hubungan harus menunjuk ke versi yang immutable.

---

## 14. Pattern 13 — Evidence and Provenance Pattern

### 14.1 Mengapa Penting

Dalam sistem regulatory, fraud, investigation, dan enforcement, graph tidak boleh hanya menjawab:

```text
Apa yang terhubung?
```

Ia harus menjawab:

```text
Dari mana kita tahu?
Seberapa yakin?
Kapan diketahui?
Siapa yang mengkonfirmasi?
Evidence apa yang mendukung?
Apakah evidence masih valid?
```

### 14.2 Bentuk Dasar

```cypher
(:Claim)-[:SUPPORTED_BY]->(:Evidence)
(:Claim)-[:REPORTED_BY]->(:Source)
(:Claim)-[:ASSERTED_BY]->(:Actor)
(:Claim)-[:ABOUT]->(:Entity)
```

### 14.3 Claim Node

Daripada langsung:

```cypher
(:Person)-[:CONTROLS]->(:Company)
```

Untuk domain investigasi:

```cypher
(:ControlClaim)-[:SUBJECT]->(:Person)
(:ControlClaim)-[:OBJECT]->(:Company)
(:ControlClaim)-[:SUPPORTED_BY]->(:Evidence)
(:ControlClaim)-[:REPORTED_BY]->(:Source)
(:ControlClaim)-[:REVIEWED_BY]->(:Officer)
```

Lalu jika claim sudah accepted, bisa materialize:

```cypher
(:Person)-[:CONTROLS {derivedFrom: 'CLAIM-123'}]->(:Company)
```

### 14.4 Claim vs Fact

Bedakan:

```text
Claim = pernyataan yang punya source/confidence/status.
Fact  = claim yang diterima menurut rule tertentu.
```

Graph bisa menyimpan keduanya.

### 14.5 Query: Explain Fact

```cypher
MATCH (p:Person {id: $personId})-[r:CONTROLS]->(c:Company {id: $companyId})
MATCH (claim:ControlClaim {id: r.derivedFrom})-[:SUPPORTED_BY]->(e:Evidence)
RETURN p, c, claim, collect(e) AS evidence
```

### 14.6 Failure Mode

1. Evidence disimpan sebagai string property.
2. Confidence tidak dimodelkan.
3. Source tidak bisa ditrace.
4. Claim yang belum diverifikasi dicampur dengan fact.
5. Derived relationship tidak punya lineage.
6. Keputusan formal merujuk current node yang bisa berubah.

### 14.7 Defensible Pattern

```cypher
(:Evidence)-[:EXTRACTED_FROM]->(:Document)
(:Claim)-[:SUPPORTED_BY]->(:Evidence)
(:Claim)-[:HAS_CONFIDENCE]->(:ConfidenceAssessment)
(:Decision)-[:CONSIDERED]->(:Claim)
(:Decision)-[:BASED_ON]->(:PolicyVersion)
(:Decision)-[:MADE_BY]->(:Officer)
```

Ini bukan hanya data modelling. Ini adalah model akuntabilitas.

---

## 15. Pattern 14 — Similarity Relationship Pattern

### 15.1 Bentuk

```cypher
(:Entity)-[:SIMILAR_TO {score: 0.87, method: 'jaccard', computedAt: datetime()}]->(:Entity)
```

### 15.2 Use Case

1. Entity resolution.
2. Recommendation.
3. Fraud pattern matching.
4. Similar case discovery.
5. Related document discovery.
6. Customer clustering.

### 15.3 Direction

Similarity biasanya conceptually undirected, tetapi Neo4j relationship tetap punya direction. Pilih konvensi:

```text
A SIMILAR_TO B hanya dibuat satu arah berdasarkan deterministic ordering ID.
```

Contoh:

```cypher
(:Entity {id: 'A'})-[:SIMILAR_TO]->(:Entity {id: 'B'})
```

Jika query butuh dua arah:

```cypher
MATCH (e:Entity {id: $id})-[s:SIMILAR_TO]-(other:Entity)
RETURN other, s.score
```

### 15.4 Jangan Membuat Complete Graph

Jika ada 1 juta entity dan setiap entity dihubungkan ke semua entity lain, graph hancur.

Gunakan top-K similarity:

```text
Setiap entity hanya menyimpan K similar neighbors teratas.
```

Contoh:

```cypher
(:Entity)-[:SIMILAR_TO {rank: 1, score: 0.94}]->(:Entity)
(:Entity)-[:SIMILAR_TO {rank: 2, score: 0.91}]->(:Entity)
```

### 15.5 Similarity Edge Lifecycle

Similarity adalah derived edge. Wajib punya metadata:

```cypher
{
  score: 0.87,
  method: 'jaccard-v2',
  computedAt: datetime(),
  inputSnapshot: 'snapshot-2026-06-01',
  threshold: 0.8
}
```

Tanpa metadata, tim tidak akan tahu apakah edge masih valid.

---

## 16. Pattern 15 — Scoring Relationship Pattern

### 16.1 Bentuk

```cypher
(:Case)-[:HAS_RISK_SCORE]->(:RiskScore)
(:RiskScore)-[:COMPUTED_BY]->(:ModelVersion)
(:RiskScore)-[:BASED_ON]->(:FeatureSet)
```

Atau sederhana:

```cypher
(:Person)-[:RISK_RELATED_TO {score: 0.76, reason: 'shared_address'}]->(:Company)
```

### 16.2 Kapan Score Menjadi Property

Gunakan property jika score hanya atribut edge:

```cypher
(:Case)-[:SIMILAR_TO {score: 0.82}]->(:Case)
```

### 16.3 Kapan Score Menjadi Node

Gunakan node jika score perlu:

1. model version,
2. feature explanation,
3. review status,
4. override,
5. audit,
6. temporal history,
7. approval,
8. threshold evaluation.

Contoh:

```cypher
(:Case)-[:HAS_SCORE]->(:RiskScore {value: 0.91, band: 'HIGH'})
(:RiskScore)-[:COMPUTED_BY]->(:ModelVersion {name: 'risk-v7'})
(:RiskScore)-[:USES_FEATURE]->(:Feature {name: 'shared_beneficial_owner_count'})
(:RiskScore)-[:REVIEWED_BY]->(:Officer)
```

### 16.4 Failure Mode

1. Score dianggap fakta absolut.
2. Model version hilang.
3. Threshold berubah tapi keputusan lama tidak bisa direkonstruksi.
4. Score overwrite tanpa history.
5. Score dipakai untuk enforcement tanpa evidence/explanation.

Untuk sistem regulatori, score harus dianggap decision support, bukan kebenaran final.

---

## 17. Pattern 16 — Derived Edge / Materialized Relationship Pattern

### 17.1 Masalah

Traversal yang sering dipakai bisa mahal.

Contoh:

```cypher
(:Person)-[:OWNS]->(:Company)-[:OWNS]->(:Company)-[:OWNS]->(:Company)
```

Pertanyaan umum:

```text
Company mana yang ultimately controlled by Person P?
```

### 17.2 Materialized Edge

```cypher
(:Person)-[:ULTIMATELY_CONTROLS {
  computedAt: datetime(),
  maxDepth: 5,
  method: 'ownership-rollup-v2'
}]->(:Company)
```

### 17.3 Keunggulan

1. Query runtime cepat.
2. Cocok untuk UI/listing/search.
3. Mengurangi traversal berulang.
4. Bisa jadi cache graph-native.

### 17.4 Risiko

1. Stale edge.
2. Derived edge terlihat seperti fact asli.
3. Update complexity.
4. Reconciliation diperlukan.
5. Debugging lebih sulit.

### 17.5 Rule

Derived edge harus punya lineage.

Minimal:

```cypher
{
  derived: true,
  derivedAt: datetime(),
  method: 'algorithm-name-version',
  sourceSnapshot: 'snapshot-id'
}
```

Lebih baik:

```cypher
(:DerivedRelationship)-[:MATERIALIZES]->(:RelationshipType)
(:DerivedRelationship)-[:BASED_ON_PATH]->(:PathEvidence)
```

Namun di Neo4j, relationship tidak bisa langsung menjadi target relationship lain. Jika butuh lineage detail, gunakan node reifikasi untuk derived fact.

---

## 18. Pattern 17 — Snapshot Pattern

### 18.1 Masalah

Sistem butuh menjawab:

```text
Bagaimana bentuk graph pada waktu T?
```

### 18.2 Validity Properties

```cypher
(:Entity)-[:RELATED_TO {validFrom, validTo}]->(:Entity)
```

Cocok jika query as-of relatif sederhana.

### 18.3 Snapshot Node

```cypher
(:Snapshot {id: 'SNAP-2026-06-01', asOf: date('2026-06-01')})
(:Snapshot)-[:INCLUDES]->(:SnapshotFact)
(:SnapshotFact)-[:SUBJECT]->(:Entity)
(:SnapshotFact)-[:OBJECT]->(:Entity)
```

Ini berat, tetapi defensible untuk audit formal.

### 18.4 Snapshot by Projection

Untuk analytical workloads:

```text
Export/projection graph per snapshot
Run algorithm
Store result linked to snapshot
```

Model:

```cypher
(:AnalysisRun)-[:ON_SNAPSHOT]->(:GraphSnapshot)
(:AnalysisRun)-[:PRODUCED]->(:RiskScore)
```

### 18.5 Decision Rule

| Need | Pattern |
|---|---|
| simple as-of query | validFrom/validTo properties |
| formal audit reconstruction | snapshot node / immutable version graph |
| algorithm reproducibility | analysis run + snapshot metadata |
| high volume event history | event store + graph projection |

---

## 19. Pattern 18 — Multi-Tenant Graph Pattern

### 19.1 Masalah

Multi-tenancy di graph lebih sensitif daripada CRUD biasa karena traversal bisa bocor antar-tenant jika boundary salah.

### 19.2 Option A — Tenant Property

```cypher
(:Case {id: 'C1', tenantId: 'T1'})
(:Person {id: 'P1', tenantId: 'T1'})
```

Query harus selalu filter:

```cypher
MATCH (c:Case {tenantId: $tenantId, id: $caseId})-[:INVOLVES]->(p:Person {tenantId: $tenantId})
RETURN p
```

Kelemahan: mudah lupa filter downstream.

### 19.3 Option B — Tenant Label

```cypher
(:Case:Tenant_T1)
(:Person:Tenant_T1)
```

Kelemahan:

1. label explosion,
2. schema/index complexity,
3. tenant dinamis sulit,
4. tidak elegan untuk banyak tenant.

### 19.4 Option C — Tenant Root Node

```cypher
(:Tenant {id: 'T1'})-[:OWNS]->(:Case)
(:Tenant)-[:OWNS]->(:Person)
```

Query:

```cypher
MATCH (:Tenant {id: $tenantId})-[:OWNS]->(c:Case {id: $caseId})
MATCH (c)-[:INVOLVES]->(p:Person)<-[:OWNS]-(:Tenant {id: $tenantId})
RETURN p
```

Kelemahan: tenant root bisa menjadi supernode.

### 19.5 Option D — Database-per-Tenant

Neo4j mendukung konsep multi-database dalam DBMS. Database-per-tenant bisa memberi isolasi kuat, tetapi operasional lebih kompleks.

Cocok jika:

1. tenant sedikit tapi besar,
2. compliance butuh isolation kuat,
3. backup/restore per tenant penting,
4. noisy neighbor harus dikurangi.

### 19.6 Option E — Cluster/Instance-per-Tenant

Paling kuat, paling mahal.

Cocok untuk:

1. regulated tenant besar,
2. data sovereignty,
3. contractual isolation,
4. tenant-specific operations.

### 19.7 Tenant Boundary Rule

Jangan hanya memastikan anchor node tenant-safe. Pastikan semua expansion tidak melewati tenant boundary.

Buruk:

```cypher
MATCH (c:Case {tenantId: $tenantId, id: $caseId})-[:RELATED_TO*1..3]-(x)
RETURN x
```

Lebih aman:

```cypher
MATCH path = (c:Case {tenantId: $tenantId, id: $caseId})-[:RELATED_TO*1..3]-(x)
WHERE all(n IN nodes(path) WHERE n.tenantId = $tenantId)
RETURN x
```

Namun filter setelah path expansion bisa tetap mahal. Lebih baik model relationship dan anchor agar traversal tenant-aware sejak awal.

---

## 20. Pattern 19 — Soft Delete, Retention, and Legal Hold

### 20.1 Soft Delete Sederhana

```cypher
(:Case {deletedAt: datetime(), deletedBy: 'user-1'})
```

Query harus filter:

```cypher
MATCH (c:Case)
WHERE c.deletedAt IS NULL
RETURN c
```

### 20.2 Relationship Soft Delete

```cypher
(:Person)-[:ASSOCIATED_WITH {deletedAt: datetime()}]->(:Case)
```

### 20.3 Delete as Event

Untuk audit:

```cypher
(:DeletionEvent)-[:DELETED]->(:Case)
(:DeletionEvent)-[:PERFORMED_BY]->(:User)
(:DeletionEvent)-[:REASON]->(:RetentionPolicy)
```

### 20.4 Legal Hold

```cypher
(:Entity)-[:UNDER_LEGAL_HOLD]->(:LegalHold)
(:LegalHold)-[:ISSUED_BY]->(:Authority)
```

Jangan hapus node/relationship yang masih berada dalam legal hold.

### 20.5 Failure Mode

1. Soft-deleted node masih muncul lewat traversal.
2. Relationship ke deleted node tetap aktif.
3. Retention policy tidak bisa diaudit.
4. Physical delete merusak decision reconstruction.
5. Legal hold tidak diterapkan pada connected evidence.

### 20.6 Safer Traversal

```cypher
MATCH path = (c:Case {id: $caseId})-[:RELATED_TO*1..3]-(x)
WHERE all(n IN nodes(path) WHERE n.deletedAt IS NULL)
RETURN x
```

Sekali lagi, filter setelah expansion bisa mahal. Untuk dataset besar, pertimbangkan active relationship types atau projection aktif.

---

## 21. Pattern 20 — Active vs Historical Relationship Split

### 21.1 Masalah

Jika semua relationship aktif dan historis memakai type sama:

```cypher
(:Person)-[:OWNS {validTo: ...}]->(:Company)
```

Setiap query current harus filter `validTo IS NULL`.

### 21.2 Split Type

```cypher
(:Person)-[:CURRENTLY_OWNS]->(:Company)
(:Person)-[:PREVIOUSLY_OWNED]->(:Company)
```

Atau:

```cypher
(:Person)-[:OWNS]->(:Company)
(:Person)-[:OWNED_IN_PAST]->(:Company)
```

### 21.3 Keunggulan

1. Query current lebih cepat dan sederhana.
2. Traversal bisa pilih relationship type spesifik.
3. Mengurangi filter berulang.

### 21.4 Kelemahan

1. Semantic duplication.
2. Update lebih kompleks.
3. Butuh lifecycle discipline.
4. Query historical harus tahu type lain.

### 21.5 Hybrid

```cypher
(:Person)-[:OWNS {status: 'ACTIVE', validFrom, validTo}]->(:Company)
```

plus materialized current edge:

```cypher
(:Person)-[:CURRENTLY_OWNS]->(:Company)
```

Use case:

1. `OWNS` untuk audit/historical.
2. `CURRENTLY_OWNS` untuk operational query cepat.

Derived/current edge harus bisa direkonsiliasi.

---

## 22. Pattern 21 — Relationship Type Partitioning

### 22.1 Masalah

Relationship type terlalu umum:

```cypher
(:Entity)-[:RELATED_TO]->(:Entity)
```

Query:

```cypher
MATCH (e:Entity {id: $id})-[:RELATED_TO*1..3]-(x)
RETURN x
```

Ini hampir pasti melebar terlalu luas.

### 22.2 Type Lebih Spesifik

```cypher
(:Person)-[:OWNS]->(:Company)
(:Person)-[:DIRECTOR_OF]->(:Company)
(:Person)-[:EMPLOYED_BY]->(:Company)
(:Person)-[:FAMILY_MEMBER_OF]->(:Person)
(:Company)-[:SUBSIDIARY_OF]->(:Company)
(:Case)-[:INVOLVES]->(:Person)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
```

### 22.3 Query Lebih Terkontrol

```cypher
MATCH path = (p:Person {id: $id})-[:OWNS|DIRECTOR_OF|SUBSIDIARY_OF*1..3]-(x)
RETURN x
```

### 22.4 Jangan Berlebihan

Relationship type explosion juga buruk.

Buruk:

```cypher
[:OWNS_10_PERCENT]
[:OWNS_20_PERCENT]
[:OWNS_30_PERCENT]
```

Lebih baik:

```cypher
[:OWNS {percentage: 30}]
```

### 22.5 Rule

Relationship type merepresentasikan **jenis hubungan**, bukan nilai atribut.

---

## 23. Pattern 22 — Intermediate Grouping Node

### 23.1 Masalah: Supernode

Contoh:

```cypher
(:Category {name: 'Retail'})<-[:IN_CATEGORY]-(:Merchant)
```

Jika jutaan merchant masuk kategori `Retail`, `Retail` menjadi high-degree node.

### 23.2 Grouping by Bucket

```cypher
(:Category {name: 'Retail'})-[:HAS_BUCKET]->(:CategoryBucket {region: 'ID-JK', year: 2026})
(:Merchant)-[:IN_BUCKET]->(:CategoryBucket)
```

### 23.3 Use Case

1. time bucket,
2. region bucket,
3. tenant bucket,
4. segment bucket,
5. risk band bucket,
6. source system bucket.

### 23.4 Query

```cypher
MATCH (:Category {name: 'Retail'})-[:HAS_BUCKET]->(b:CategoryBucket {region: $region})<-[:IN_BUCKET]-(m:Merchant)
RETURN m
```

### 23.5 Trade-off

| Aspek | Tanpa Bucket | Dengan Bucket |
|---|---:|---:|
| model sederhana | tinggi | lebih rendah |
| traversal kategori global | mudah | perlu aggregate bucket |
| query subset | mahal | lebih murah |
| supernode risk | tinggi | lebih rendah |
| maintenance | rendah | lebih tinggi |

---

## 24. Pattern 23 — Anchor Node Pattern

### 24.1 Konsep

Query graph yang baik biasanya mulai dari anchor spesifik.

Anchor node ideal:

1. punya label jelas,
2. punya property indexed/unique,
3. cardinality rendah,
4. dekat dengan traversal target.

Contoh:

```cypher
MATCH (c:Case {id: $caseId})-[:INVOLVES]->(p:Person)
RETURN p
```

### 24.2 Bad Anchor

```cypher
MATCH (p:Person)-[:INVOLVES]-(c:Case)
WHERE c.id = $caseId
RETURN p
```

Planner mungkin masih bisa optimize, tetapi mental modelnya buruk. Biasakan mulai dari anchor paling selektif.

### 24.3 Anchor Node dalam Domain Modelling

Kadang perlu membuat node khusus agar query punya anchor natural.

Contoh:

```cypher
(:Investigation)-[:HAS_SCOPE]->(:Scope)
(:Scope)-[:INCLUDES_ENTITY]->(:Entity)
```

Jika semua query investigasi dimulai dari investigation, node `Investigation` adalah anchor bagus.

---

## 25. Pattern 24 — Query-Specific Read Model Pattern

### 25.1 Konsep

Graph operational tidak harus satu model untuk semua query. Kadang Anda butuh read model graph-specific.

Contoh source model:

```cypher
(:Person)-[:OWNS]->(:Company)-[:OWNS]->(:Company)
```

Read model:

```cypher
(:Person)-[:RELATED_PARTY_OF {reason: 'ownership-chain'}]->(:Company)
```

### 25.2 Kapan Cocok

1. Query sering dan latency-sensitive.
2. Traversal asli mahal.
3. UI butuh list cepat.
4. Hasil bisa sedikit stale.
5. Bisa rebuild dari source facts.

### 25.3 Jangan Sembunyikan Semantics

Read model harus eksplisit derived.

```cypher
(:Person)-[:RELATED_PARTY_OF {
  derived: true,
  reason: 'ownership-chain',
  derivedAt: datetime(),
  sourceVersion: 'v3'
}]->(:Company)
```

---

## 26. Pattern 25 — State Machine as Graph Pattern

### 26.1 Konsep

Karena user memiliki konteks lifecycle modelling, pattern ini penting.

State machine bisa dimodelkan sebagai graph definisi:

```cypher
(:State {name: 'DRAFT'})-[:CAN_TRANSITION_TO {action: 'submit'}]->(:State {name: 'SUBMITTED'})
(:State {name: 'SUBMITTED'})-[:CAN_TRANSITION_TO {action: 'approve'}]->(:State {name: 'APPROVED'})
(:State {name: 'SUBMITTED'})-[:CAN_TRANSITION_TO {action: 'reject'}]->(:State {name: 'REJECTED'})
```

Case instance:

```cypher
(:Case)-[:CURRENT_STATE]->(:State)
(:Case)-[:HAS_TRANSITION_EVENT]->(:TransitionEvent)
(:TransitionEvent)-[:FROM]->(:State)
(:TransitionEvent)-[:TO]->(:State)
(:TransitionEvent)-[:PERFORMED_BY]->(:User)
```

### 26.2 Query Allowed Actions

```cypher
MATCH (c:Case {id: $caseId})-[:CURRENT_STATE]->(s:State)
MATCH (s)-[t:CAN_TRANSITION_TO]->(next:State)
RETURN t.action, next.name
```

### 26.3 Query Invalid Historical Transition

```cypher
MATCH (c:Case)-[:HAS_TRANSITION_EVENT]->(e:TransitionEvent)
MATCH (e)-[:FROM]->(from:State), (e)-[:TO]->(to:State)
WHERE NOT EXISTS {
  MATCH (from)-[:CAN_TRANSITION_TO]->(to)
}
RETURN c, e, from, to
```

### 26.4 Why Graph Helps

1. Transition rules explainable.
2. Impact of rule change visible.
3. Case history connected to actor/evidence/reason.
4. Possible path to terminal state can be queried.
5. Escalation graph can connect workflow and organization.

### 26.5 Warning

Jangan menjalankan core transaction state machine hanya dengan graph traversal jika latency/correctness lebih cocok di application service atau relational store. Graph bisa menjadi definition/explanation/projection layer.

---

## 27. Pattern 26 — Escalation and Responsibility Graph

### 27.1 Bentuk

```cypher
(:Case)-[:ASSIGNED_TO]->(:Officer)
(:Officer)-[:REPORTS_TO]->(:Manager)
(:Officer)-[:MEMBER_OF]->(:OrgUnit)
(:OrgUnit)-[:ESCALATES_TO]->(:OrgUnit)
(:Case)-[:HAS_ESCALATION_EVENT]->(:EscalationEvent)
```

### 27.2 Query Escalation Candidates

```cypher
MATCH (c:Case {id: $caseId})-[:ASSIGNED_TO]->(o:Officer)-[:MEMBER_OF]->(unit:OrgUnit)
MATCH path = (unit)-[:ESCALATES_TO*1..3]->(target:OrgUnit)
RETURN target, path
ORDER BY length(path)
```

### 27.3 Conflict of Interest

```cypher
MATCH (c:Case {id: $caseId})-[:INVOLVES]->(subject:Person)
MATCH (officer:Officer {id: $officerId})-[:RELATED_TO*1..2]-(subject)
RETURN officer, subject
```

### 27.4 Governance Concern

Escalation graph harus mendukung:

1. who can act,
2. who must review,
3. who is conflicted,
4. what path led to escalation,
5. what policy version applied,
6. what evidence supported the decision.

Ini membuat graph sangat cocok untuk defensible workflow analysis.

---

## 28. Pattern 27 — Policy and Rule Explanation Graph

### 28.1 Bentuk

```cypher
(:PolicyVersion)-[:CONTAINS_RULE]->(:Rule)
(:Rule)-[:APPLIES_TO]->(:CaseType)
(:Rule)-[:REQUIRES_CONDITION]->(:Condition)
(:Decision)-[:EVALUATED_RULE]->(:Rule)
(:Decision)-[:FOUND_CONDITION]->(:ConditionResult)
```

### 28.2 Query Decision Explanation

```cypher
MATCH (d:Decision {id: $decisionId})-[:EVALUATED_RULE]->(r:Rule)<-[:CONTAINS_RULE]-(pv:PolicyVersion)
OPTIONAL MATCH (d)-[:FOUND_CONDITION]->(cr:ConditionResult)-[:FOR_CONDITION]->(cond:Condition)
RETURN d, pv, r, collect({condition: cond.name, result: cr.result}) AS conditions
```

### 28.3 Why Graph

Policy decision is rarely a flat record. It connects:

1. policy version,
2. rule,
3. condition,
4. evidence,
5. actor,
6. subject,
7. case,
8. outcome,
9. appeal/review.

Graph makes explanation path explicit.

---

## 29. Pattern 28 — Entity Resolution Graph

### 29.1 Masalah

Satu real-world entity bisa muncul sebagai banyak records.

```text
John Smith
J. Smith
Jonathan Smith
same tax ID
same address
same phone
similar email
```

### 29.2 Model

```cypher
(:RawRecord)-[:HAS_IDENTIFIER]->(:Identifier)
(:RawRecord)-[:POSSIBLY_SAME_AS {score: 0.82, method: 'rules-v4'}]->(:RawRecord)
(:RawRecord)-[:RESOLVED_TO]->(:ResolvedEntity)
(:ResolutionDecision)-[:MERGED]->(:RawRecord)
(:ResolutionDecision)-[:CREATED]->(:ResolvedEntity)
```

### 29.3 Avoid Direct Merge Too Early

Buruk:

```cypher
MERGE (:Person {name: row.name})
```

Nama bukan identity.

Lebih baik:

```cypher
MERGE (r:RawPersonRecord {source: row.source, sourceId: row.id})
MERGE (id:Identifier {type: 'TAX_ID', value: row.taxId})
MERGE (r)-[:HAS_IDENTIFIER]->(id)
```

Kemudian resolution process menentukan resolved entity.

### 29.4 Human-in-the-Loop

```cypher
(:MatchCandidate)-[:LEFT]->(:RawRecord)
(:MatchCandidate)-[:RIGHT]->(:RawRecord)
(:MatchCandidate)-[:REVIEWED_BY]->(:Officer)
(:MatchCandidate)-[:RESULT]->(:ResolutionDecision)
```

### 29.5 Failure Mode

1. False merge lebih berbahaya daripada duplicate.
2. Tidak ada audit decision.
3. Similarity score tanpa method version.
4. Identifier sensitif tidak dilindungi.
5. Split/unmerge tidak didukung.

---

## 30. Pattern 29 — Graph as Investigation Workspace

### 30.1 Konsep

Investigator sering perlu membuat working graph yang tidak sama dengan source facts.

```cypher
(:Investigation)-[:INCLUDES]->(:Entity)
(:Investigation)-[:HAS_NOTE]->(:Note)
(:Investigation)-[:HAS_HYPOTHESIS]->(:Hypothesis)
(:Hypothesis)-[:SUPPORTED_BY]->(:Evidence)
(:Hypothesis)-[:CONTRADICTED_BY]->(:Evidence)
```

### 30.2 Hypothesis vs Fact

Jangan campur hypothesis dengan accepted fact.

```cypher
(:Hypothesis)-[:ALLEGES]->(:RelationshipClaim)
(:RelationshipClaim)-[:SUBJECT]->(:Person)
(:RelationshipClaim)-[:OBJECT]->(:Company)
```

### 30.3 Collaboration

```cypher
(:Investigation)-[:ASSIGNED_TO]->(:Officer)
(:Officer)-[:ADDED]->(:Note)
(:Note)-[:ABOUT]->(:Entity)
```

### 30.4 Value

Graph bukan hanya database, tetapi investigative canvas:

1. explore,
2. pin entities,
3. annotate,
4. compare evidence,
5. produce decision trail.

---

## 31. Pattern 30 — Graph Refactoring Pattern

### 31.1 Mengapa Refactoring Normal

Graph model jarang benar di awal. Neo4j sendiri mendorong modelling sebagai proses iteratif berdasarkan domain dan use case. Refactoring bukan kegagalan; refactoring adalah bagian dari graph modelling.

### 31.2 Relationship to Node Refactor

Dari:

```cypher
(:Person)-[r:OWNS]->(:Company)
```

Ke:

```cypher
(:Person)-[:PARTY_IN]->(:Ownership)-[:OWNED_ENTITY]->(:Company)
```

Migration sketch:

```cypher
MATCH (p:Person)-[r:OWNS]->(c:Company)
CREATE (o:Ownership {
  id: randomUUID(),
  percentage: r.percentage,
  validFrom: r.validFrom,
  validTo: r.validTo,
  migratedAt: datetime()
})
CREATE (p)-[:PARTY_IN]->(o)
CREATE (o)-[:OWNED_ENTITY]->(c)
```

Setelah validasi:

```cypher
MATCH (:Person)-[r:OWNS]->(:Company)
DELETE r
```

### 31.3 Property to Node Refactor

Dari:

```cypher
(:Person {country: 'ID'})
```

Ke:

```cypher
(:Person)-[:RESIDES_IN]->(:Country {code: 'ID'})
```

Gunakan jika country menjadi traversal target, punya metadata, region, risk score, policy, atau hierarchy.

### 31.4 Node to Property Refactor

Sebaliknya, jika node tidak pernah ditraverse dan hanya atribut kecil, jadikan property.

Dari:

```cypher
(:Person)-[:HAS_GENDER]->(:Gender {code: 'M'})
```

Ke:

```cypher
(:Person {gender: 'M'})
```

### 31.5 Rule

Promote property menjadi node jika butuh relationship. Demote node menjadi property jika tidak pernah menjadi anchor atau traversal target.

---

## 32. Decision Matrix: Pattern Selection

| Problem | Candidate Pattern | Key Risk |
|---|---|---|
| simple relation | direct relationship | under-modeling lifecycle |
| edge has attributes | relationship properties | property bloat |
| edge has identity/lifecycle | reified relationship | traversal longer |
| group membership | membership pattern | nested group explosion |
| access rights | entitlement graph | runtime auth latency |
| hierarchy | parent-child relationship | cycle |
| component dependency | BOM/dependency graph | path explosion |
| changing facts | temporal relationship | overwrite history |
| event-driven graph | event-to-state projection | projection lag |
| immutable decision basis | versioned entity | query complexity |
| audit/provenance | claim/evidence graph | too many nodes |
| similar entities | similarity edge | dense complete graph |
| scoring | score node/edge | model version loss |
| expensive traversal | derived edge | stale materialization |
| tenant isolation | multi-tenant pattern | traversal leakage |
| large category | bucket node | maintenance overhead |
| workflow | state machine graph | overusing graph for core transaction |
| investigation | workspace/hypothesis graph | mixing hypothesis and fact |

---

## 33. Pattern Selection Heuristics

### 33.1 Node vs Property

Use property when:

```text
small scalar value,
no independent identity,
not traversed,
not source of relationships,
not audited separately.
```

Use node when:

```text
needs relationships,
needs lifecycle,
needs identity,
needs provenance,
used as query anchor,
shared by many entities,
part of hierarchy/taxonomy.
```

### 33.2 Relationship vs Node

Use relationship when:

```text
binary relation,
simple lifecycle,
few edge properties,
no independent review/approval/evidence.
```

Use node when:

```text
multi-party relation,
has status,
has approval,
has evidence,
has version,
has source/confidence,
needs to be referenced by decisions.
```

### 33.3 Direct Edge vs Derived Edge

Use direct edge when:

```text
fact is primary/original.
```

Use derived edge when:

```text
fact is computed/materialized from other paths.
```

Derived edge must carry lineage.

### 33.4 Current State vs History

Use current relationship when:

```text
query is operational and only current truth matters.
```

Use historical/versioned pattern when:

```text
past decisions must be reconstructed.
```

In regulated systems, default toward historical defensibility.

---

## 34. Java Engineering Implications

Advanced graph modelling affects Java service design.

### 34.1 Repository Layer

Avoid generic CRUD repositories for complex graph patterns.

Bad abstraction:

```java
interface GenericGraphRepository<T> {
    T save(T entity);
    Optional<T> findById(String id);
}
```

Better:

```java
interface EntitlementGraphRepository {
    List<EffectivePermission> findEffectivePermissions(UserId userId, ResourceId resourceId);
    List<AccessPath> explainAccess(UserId userId, ResourceId resourceId, Action action);
}
```

Expose graph questions, not storage mechanics.

### 34.2 Command Handler

For lifecycle graph:

```java
final class AssignRoleCommandHandler {
    void handle(AssignRoleCommand command) {
        // validate actor
        // validate target user
        // validate scope
        // validate no toxic combination
        // create RoleAssignment node
        // connect approval/evidence/source
        // update materialized entitlement if needed
    }
}
```

### 34.3 Idempotency

Commands that create graph structures must have external IDs.

Example:

```cypher
MERGE (ra:RoleAssignment {id: $assignmentId})
ON CREATE SET
  ra.status = 'ACTIVE',
  ra.createdAt = datetime()
```

Never rely on random graph shape to prevent duplicates.

### 34.4 Query Object Pattern

Use named query objects for important graph traversals.

```java
record FindRelatedPartiesQuery(
    String entityId,
    int maxDepth,
    Set<RelationshipKind> relationshipKinds,
    boolean includeHistorical
) {}
```

This makes traversal boundary explicit in application code.

---

## 35. Operational Implications

Advanced patterns increase operational requirements.

### 35.1 Monitor for

1. high-degree nodes,
2. relationship type cardinality,
3. query plans with unbounded expand,
4. stale derived edges,
5. failed projection jobs,
6. orphan reified nodes,
7. inconsistent current/historical edges,
8. tenant boundary violations,
9. cycle creation in hierarchy,
10. duplicate membership/role assignment.

### 35.2 Data Quality Queries

Find orphan ownership nodes:

```cypher
MATCH (o:Ownership)
WHERE NOT (o)<-[:PARTY_IN]-(:Person)
   OR NOT (o)-[:OWNED_ENTITY]->(:Company)
RETURN o
LIMIT 100
```

Find active duplicate role assignments:

```cypher
MATCH (u:User)-[:HAS_ASSIGNMENT]->(ra:RoleAssignment)-[:ROLE]->(r:Role),
      (ra)-[:SCOPE]->(s)
WHERE ra.status = 'ACTIVE'
WITH u, r, s, collect(ra) AS assignments
WHERE size(assignments) > 1
RETURN u, r, s, assignments
```

Find possible hierarchy cycle:

```cypher
MATCH path = (n:OrgUnit)-[:PARENT_OF*1..20]->(n)
RETURN path
LIMIT 10
```

Find derived edge without metadata:

```cypher
MATCH ()-[r]->()
WHERE r.derived = true AND r.derivedAt IS NULL
RETURN r
LIMIT 100
```

---

## 36. Common Architecture Mistakes

### 36.1 Mistake: Everything Becomes Node

Tidak semua value perlu menjadi node.

Buruk:

```cypher
(:Person)-[:HAS_FIRST_NAME]->(:FirstName {value: 'John'})
```

Kecuali Anda memang sedang membangun name similarity/entity resolution graph, ini over-modeling.

### 36.2 Mistake: Everything Becomes Property

Buruk:

```cypher
(:Case {
  evidenceIds: ['E1', 'E2'],
  assignedOfficerIds: ['O1'],
  relatedCaseIds: ['C2', 'C3']
})
```

Ini membunuh traversal.

### 36.3 Mistake: Generic Relationship Type

```cypher
(:A)-[:RELATED_TO]->(:B)
```

Relationship type kehilangan meaning dan traversal melebar.

### 36.4 Mistake: No Lifecycle

```cypher
(:User)-[:HAS_ROLE]->(:Role)
```

Tanpa `validFrom`, `assignedBy`, `source`, `status`, sistem tidak audit-friendly.

### 36.5 Mistake: Derived Edge Without Source

```cypher
(:Person)-[:HIGH_RISK_RELATED_TO]->(:Company)
```

Tanpa reason, method, timestamp, input snapshot, ini tidak defensible.

### 36.6 Mistake: Query-Driven Without Invariant

Graph mudah diubah, tetapi correctness tetap perlu invariant:

```text
one active owner,
no hierarchy cycle,
one current version,
no duplicate assignment,
tenant boundary cannot cross,
decision must reference immutable policy version.
```

---

## 37. Mini Case Study: Enforcement Case Graph

### 37.1 Requirement

Sebuah platform enforcement perlu:

1. menghubungkan case dengan subject,
2. melihat beneficial ownership,
3. mendeteksi related party,
4. melacak evidence,
5. mendukung escalation,
6. menjaga audit trail,
7. menjelaskan alasan decision.

### 37.2 Naive Model

```cypher
(:Case)-[:INVOLVES]->(:Person)
(:Person)-[:OWNS]->(:Company)
(:Case)-[:HAS_EVIDENCE]->(:Evidence)
(:Case)-[:ASSIGNED_TO]->(:Officer)
```

Ini cukup untuk demo, tetapi lemah untuk produksi.

### 37.3 Better Model

```cypher
(:Case)-[:HAS_SUBJECT]->(:SubjectRole)-[:PLAYED_BY]->(:Person)
(:SubjectRole)-[:IN_CASE]->(:Case)

(:Person)-[:PARTY_IN]->(:Ownership)-[:OWNED_ENTITY]->(:Company)
(:Ownership)-[:SUPPORTED_BY]->(:Evidence)
(:Ownership)-[:REPORTED_BY]->(:Source)

(:Case)-[:HAS_ASSIGNMENT]->(:CaseAssignment)-[:ASSIGNED_TO]->(:Officer)
(:CaseAssignment)-[:APPROVED_BY]->(:Manager)

(:Decision)-[:FOR_CASE]->(:Case)
(:Decision)-[:BASED_ON]->(:PolicyVersion)
(:Decision)-[:CONSIDERED]->(:Evidence)
(:Decision)-[:MADE_BY]->(:Officer)
```

### 37.4 Why Better

1. Subject role bisa membedakan suspect, witness, complainant, related party.
2. Ownership punya evidence dan source.
3. Assignment punya lifecycle.
4. Decision menunjuk policy version immutable.
5. Audit path eksplisit.

### 37.5 Query: Related Companies Through Accepted Ownership

```cypher
MATCH path = (p:Person {id: $personId})-[:PARTY_IN]->(o:Ownership)-[:OWNED_ENTITY]->(c:Company)
WHERE o.status = 'ACCEPTED'
  AND o.validFrom <= date()
  AND (o.validTo IS NULL OR o.validTo > date())
RETURN c, o, path
```

### 37.6 Query: Explain Enforcement Decision

```cypher
MATCH (d:Decision {id: $decisionId})-[:FOR_CASE]->(c:Case)
MATCH (d)-[:BASED_ON]->(pv:PolicyVersion)
OPTIONAL MATCH (d)-[:CONSIDERED]->(e:Evidence)
OPTIONAL MATCH (d)-[:MADE_BY]->(o:Officer)
RETURN d, c, pv, collect(DISTINCT e) AS evidence, o
```

---

## 38. Checklist: Advanced Graph Model Review

Gunakan checklist ini saat review desain.

### 38.1 Semantics

- Apakah setiap relationship type punya meaning jelas?
- Apakah relationship type bukan sekadar nilai atribut?
- Apakah node mewakili entity/fact yang layak punya identity?
- Apakah property tidak menyembunyikan relationship penting?

### 38.2 Query

- Apa anchor node untuk tiap query utama?
- Apakah traversal depth dibatasi?
- Apakah relationship type cukup spesifik?
- Apakah query bisa menghindari supernode?
- Apakah current query harus membaca historical edge?

### 38.3 Lifecycle

- Apakah fakta bisa berubah?
- Apakah perlu validFrom/validTo?
- Apakah perlu recordedAt?
- Apakah update boleh overwrite?
- Apakah decision lama bisa direkonstruksi?

### 38.4 Audit

- Dari mana fakta berasal?
- Evidence apa yang mendukung?
- Siapa yang menyetujui?
- Policy versi mana yang berlaku?
- Apakah derived edge punya lineage?

### 38.5 Integrity

- Apa unique key setiap node penting?
- Apa constraint yang dibutuhkan?
- Apa invariant yang tidak bisa dijaga Neo4j otomatis?
- Bagaimana mencegah duplicate relationship?
- Bagaimana mencegah cycle?

### 38.6 Operations

- Node mana berpotensi high-degree?
- Relationship mana berpotensi terlalu banyak?
- Derived edge mana perlu rebuild?
- Apa data quality query harian?
- Apa metric/query log yang harus dimonitor?

---

## 39. Latihan

### Latihan 1 — Membership Model

Anda membangun sistem case assignment. Officer bisa menjadi reviewer case karena:

1. assignment langsung,
2. membership dalam unit,
3. delegation sementara,
4. emergency override.

Desain graph model yang bisa menjawab:

```text
Officer O boleh review Case C karena path apa?
```

Pastikan model bisa menyimpan:

- validFrom,
- validTo,
- assignedBy,
- approval evidence,
- revocation.

### Latihan 2 — Ownership Claim

Desain model untuk beneficial ownership yang membedakan:

1. raw source record,
2. claim,
3. accepted fact,
4. evidence,
5. source,
6. review decision.

Buat query untuk menemukan companies yang controlled by person P dengan evidence.

### Latihan 3 — Derived Edge

Anda punya query yang sering mencari related party hingga depth 4. Query lambat. Desain materialized relationship agar UI cepat, tetapi tetap audit-friendly.

Tentukan metadata minimal pada derived edge.

### Latihan 4 — Multi-Tenant Traversal

Desain model tenant untuk graph investigation dengan 100 tenant kecil dan 3 tenant besar. Mana yang pakai shared database? Mana yang database-per-tenant? Jelaskan trade-off.

### Latihan 5 — State Machine Graph

Modelkan lifecycle enforcement case:

```text
DRAFT → SUBMITTED → TRIAGED → INVESTIGATING → DECISION_PENDING → DECIDED → APPEALED → CLOSED
```

Tambahkan invalid transition detection query.

---

## 40. Ringkasan

Advanced graph modelling adalah tentang memilih bentuk yang menjaga tiga hal sekaligus:

```text
semantic clarity,
query efficiency,
operational correctness.
```

Pattern penting dari bagian ini:

1. direct relationship untuk hubungan sederhana,
2. relationship properties untuk atribut edge,
3. reified relationship untuk hubungan dengan identity/lifecycle/evidence,
4. membership dan role assignment untuk access/workflow,
5. entitlement graph untuk permission explanation,
6. hierarchy/BOM/dependency graph untuk recursive structure,
7. temporal/versioned pattern untuk audit,
8. evidence/provenance pattern untuk defensibility,
9. similarity/scoring/derived edge untuk analytical graph,
10. multi-tenant pattern untuk isolation,
11. state machine/escalation/policy graph untuk lifecycle dan governance,
12. investigation workspace untuk human reasoning.

Prinsip paling penting:

```text
Jangan hanya bertanya “bisa dimodelkan sebagai graph?”
Tanyakan “path apa yang harus murah, fakta apa yang harus defensible,
dan invariant apa yang harus tetap benar saat data berubah?”
```

---

## 41. Referensi Resmi Untuk Pendalaman

- Neo4j Getting Started — Graph database concepts.
- Neo4j Getting Started — What is graph data modeling?
- Neo4j Getting Started — Graph modeling tips.
- Neo4j Getting Started — Modeling designs.
- Neo4j Cypher Manual — Constraints.
- Neo4j GraphAcademy — Graph Data Modeling Core Principles.

---

## 42. Status Seri

```text
Part 000 selesai — Orientation: Why Graph Database Exists and What Problem It Actually Solves
Part 001 selesai — Graph Thinking: From Entities to Relationships to Paths
Part 002 selesai — Property Graph Model Deep Dive
Part 003 selesai — Neo4j Architecture: Storage, Query Engine, and Runtime Mental Model
Part 004 selesai — Cypher Fundamentals: Pattern Matching as a Query Language
Part 005 selesai — Cypher Path Semantics: Variable-Length Traversal, Shortest Path, and Expansion Control
Part 006 selesai — Graph Modelling Methodology: From Requirements to Graph Shape
Part 007 selesai — Advanced Graph Modelling Patterns
```

Seri belum selesai. Masih ada Part 008 sampai Part 032.

Part berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-008.md
```

Topik berikutnya:

```text
Anti-Patterns in Graph Modelling
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — Graph Modelling Methodology: From Requirements to Graph Shape</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-008.md">Part 008 — Anti-Patterns in Graph Modelling ➡️</a>
</div>
