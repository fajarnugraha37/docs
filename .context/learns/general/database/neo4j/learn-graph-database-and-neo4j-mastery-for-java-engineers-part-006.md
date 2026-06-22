# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-006.md

# Part 006 — Graph Modelling Methodology: From Requirements to Graph Shape

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Bagian: `006 / 032`  
> Fokus: metodologi desain graph dari kebutuhan sistem ke model Neo4j yang bisa di-query, dioperasikan, dan dipertahankan secara arsitektural.

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membangun fondasi:

- Part 000: mengapa graph database ada.
- Part 001: cara berpikir dalam entity, relationship, dan path.
- Part 002: property graph model.
- Part 003: mental model storage, runtime, page cache, planner, traversal.
- Part 004: dasar Cypher sebagai pattern matching language.
- Part 005: path semantics, variable-length traversal, shortest path, dan expansion control.

Bagian ini menjawab pertanyaan yang jauh lebih praktis:

> “Saya punya domain nyata. Bagaimana cara mengubah requirement menjadi graph model yang benar?”

Ini berbeda dari desain tabel SQL, desain document MongoDB, atau desain index Elasticsearch. Dalam graph database, desain model tidak dimulai dari daftar entity, melainkan dari pertanyaan:

> “Koneksi apa yang harus murah untuk dijawab?”

Neo4j sendiri menekankan bahwa data modelling adalah praktik untuk mendefinisikan logika query dan struktur data; model yang baik membantu query performance, fleksibilitas query, dan optimasi storage. Proses modelling juga dimulai dari memahami domain dan use case/questions aplikasi.

---

## 1. Core Principle: Start From Questions, Not Entities

Kesalahan paling umum engineer yang datang dari relational modelling adalah langsung bertanya:

```text
Apa tabelnya?
Apa kolomnya?
Apa primary key-nya?
Apa foreign key-nya?
```

Dalam graph modelling, pertanyaan awal yang lebih tepat adalah:

```text
Pertanyaan bisnis apa yang harus dijawab dengan murah?
Path apa yang harus ditemukan dengan cepat?
Relationship apa yang punya makna domain?
Koneksi apa yang berubah menjadi mahal jika dimodelkan sebagai join chain?
```

Graph model yang baik biasanya lahir dari query, bukan dari class diagram.

### 1.1 Entity-first vs Question-first

Entity-first modelling:

```text
Person
Company
Account
Transaction
Case
Evidence
Officer
Regulation
```

Question-first modelling:

```text
1. Apakah dua account dikendalikan oleh pihak yang sama?
2. Siapa beneficial owner dari organisasi ini sampai 5 level ke atas?
3. Case mana yang berhubungan dengan suspect yang sama melalui address, phone, device, atau transaction?
4. Evidence apa yang mendukung escalation decision tertentu?
5. Jika account ini fraudulent, entity apa saja yang terdampak dalam radius 2 hop?
6. Officer mana yang pernah menangani case yang juga terkait subject ini?
7. Relationship mana yang valid pada tanggal keputusan dibuat?
```

Entity-first memberi daftar benda. Question-first memberi bentuk graph.

### 1.2 Mengapa Query Harus Memandu Model?

Karena dalam Neo4j, biaya query sangat dipengaruhi oleh:

- titik awal traversal,
- jumlah relationship yang diekspansi,
- arah relationship,
- tipe relationship,
- kedalaman traversal,
- cardinality tiap hop,
- jumlah path alternatif,
- filter yang bisa dilakukan sebelum expansion,
- index/constraint untuk menemukan starting node.

Jika model dibuat tanpa query catalogue, Anda bisa berakhir dengan graph yang “terlihat benar” di diagram, tetapi buruk saat dijalankan.

Contoh model yang tampak natural:

```cypher
(:Person)-[:HAS_TRANSACTION]->(:Transaction)-[:TO]->(:Person)
```

Pertanyaan: “temukan semua orang yang pernah bertransaksi langsung dengan Alice”.

Query:

```cypher
MATCH (:Person {id: $aliceId})-[:HAS_TRANSACTION]->(:Transaction)-[:TO]->(other:Person)
RETURN other
```

Ini masuk akal jika transaksi adalah entity penting dan perlu disimpan sebagai node.

Tapi jika requirement dominan adalah network traversal antar orang, model ini bisa membuat traversal selalu melewati `Transaction`, sehingga setiap “relasi bisnis” menjadi dua hop.

Alternatif:

```cypher
(:Person)-[:TRANSFERRED_TO {txId, amount, occurredAt}]->(:Person)
```

Atau hybrid:

```cypher
(:Person)-[:INITIATED]->(:Transaction)-[:CREDITED]->(:Person)
(:Person)-[:TRANSFERRED_TO {count, totalAmount, lastSeenAt}]->(:Person)
```

Model pertama menyimpan fact detail. Model kedua menyimpan shortcut traversal. Keduanya benar jika pertanyaannya berbeda.

---

## 2. The Graph Modelling Loop

Gunakan loop berikut setiap kali mendesain graph:

```text
1. Capture questions
2. Identify entities and facts
3. Identify relationships with business semantics
4. Define traversal paths
5. Estimate cardinality and fan-out
6. Choose node/relationship/property placement
7. Create small sample graph
8. Write real Cypher queries
9. PROFILE mentally or actually
10. Revise model
11. Add constraints/indexes
12. Validate writes and invariants
13. Validate operational consequences
```

Metodologi ini sengaja iterative. Graph modelling jarang selesai dalam satu desain.

---

## 3. Step 1 — Capture Business Questions

Jangan mulai dari ERD. Mulai dari query catalogue.

Buat daftar pertanyaan yang sistem harus jawab. Untuk setiap pertanyaan, tulis:

```text
Question ID
User / actor
Business decision supported
Input parameters
Expected output
Traversal depth
Freshness requirement
Latency expectation
Correctness sensitivity
Explainability requirement
Frequency
Data volume assumptions
```

### 3.1 Template Query Catalogue

Contoh template:

```text
ID: Q-CASE-RELATED-001
Actor: Investigation officer
Question: Given a case, find other cases related by shared person, organization, phone, email, address, account, or device.
Input: caseId
Output: related cases with explanation path
Traversal depth: 2-4 hops
Freshness: near real-time
Latency target: < 1s for interactive use
Correctness: high, false negatives dangerous
Explainability: required
Frequency: high
Volume: millions of cases, tens of millions of entities/relationships
```

Pertanyaan ini langsung menyiratkan model:

```cypher
(:Case)-[:INVOLVES]->(:Person)
(:Case)-[:INVOLVES]->(:Organization)
(:Person)-[:USES]->(:Phone)
(:Person)-[:USES]->(:Email)
(:Person)-[:LIVES_AT]->(:Address)
(:Person)-[:OWNS]->(:Account)
(:Device)<-[:USES]-(:Person)
```

Dan query bentuknya mungkin:

```cypher
MATCH path = (c:Case {caseId: $caseId})-[:INVOLVES|USES|LIVES_AT|OWNS*1..4]-(related:Case)
WHERE c <> related
RETURN related, path
LIMIT 100
```

Namun query ini masih kasar. Di tahap modelling, ia berguna untuk mengungkap bentuk path, bukan final query production.

### 3.2 Pertanyaan yang Bagus vs Buruk

Pertanyaan buruk:

```text
Simpan data customer.
Simpan transaksi.
Simpan produk.
```

Itu storage requirement, bukan graph requirement.

Pertanyaan bagus:

```text
Temukan account yang tampak tidak terkait tetapi memiliki beneficial owner yang sama.
Temukan circular ownership dalam 6 hop.
Temukan case yang harus dieskalasi karena subject muncul dalam fraud ring yang sama.
Temukan policy breach yang muncul dari kombinasi role tidak langsung.
Temukan komponen dependency yang terdampak jika service X gagal.
```

Pertanyaan bagus memiliki koneksi, path, dan keputusan.

---

## 4. Step 2 — Identify Graph-Shaped Requirements

Tidak semua requirement cocok untuk graph. Banyak requirement lebih cocok dengan relational, document, search, stream, OLAP, atau cache.

### 4.1 Graph-Shaped Requirement Signals

Requirement cenderung graph-shaped jika mengandung kata-kata seperti:

```text
related to
connected to
linked to
path between
influence
depends on
owned by
controlled by
belongs to
inherits from
similar to
nearby in network
within N hops
common ancestor
shared attribute
cascade
impact radius
community
cluster
ring
chain
lineage
provenance
```

Dalam bahasa sistem:

```text
- related cases
- beneficial ownership
- fraud network
- entitlement inheritance
- dependency impact analysis
- supply chain risk propagation
- investigation graph
- knowledge graph
- recommendation based on connections
- identity resolution
- entity linkage
```

### 4.2 Non-Graph Signals

Requirement mungkin bukan graph-shaped jika dominan:

```text
- lookup by ID
- filter by many attributes
- full-text ranking
- time-series aggregation
- OLAP group by over billions of rows
- document retrieval
- append-only event log
- simple key-value cache
- transactional ledger with strict tabular reporting
```

Bukan berarti Neo4j tidak bisa menyimpan data itu. Artinya Neo4j mungkin bukan sistem utama yang paling tepat.

### 4.3 Architecture Decision Rule

Gunakan aturan kasar:

```text
Jika nilai utama query berasal dari attribute filtering → SQL/Search/Document mungkin cukup.
Jika nilai utama query berasal dari relationship traversal → Graph mulai masuk akal.
Jika nilai utama query berasal dari aggregate scan besar → OLAP lebih tepat.
Jika nilai utama query berasal dari event ordering → Stream/log lebih tepat.
Jika nilai utama query berasal dari low-latency key access → Cache/KV lebih tepat.
```

Neo4j paling kuat saat jawaban berada di hubungan antar entity, bukan hanya di entity itu sendiri.

---

## 5. Step 3 — Extract Entities, But Do Not Worship Nouns

Setelah punya questions, baru identifikasi entity.

Dalam domain investigation/case management, kandidat entity bisa berupa:

```text
Person
Organization
Account
Case
Allegation
Evidence
Document
Address
Phone
Email
Device
Transaction
Officer
Decision
Action
Regulation
Violation
License
Asset
Location
```

Tapi noun bukan otomatis node.

### 5.1 Node Decision Criteria

Sesuatu layak menjadi node jika:

1. Ia perlu dihubungkan ke banyak entity lain.
2. Ia menjadi titik traversal.
3. Ia punya lifecycle sendiri.
4. Ia perlu di-query secara independen.
5. Ia punya identity yang stabil.
6. Ia menjadi target relationship dari berbagai arah.
7. Ia punya permission/audit/provenance sendiri.
8. Ia bisa muncul dalam path explanation.

Contoh:

```text
Address sebagai string property:
(:Person {address: "Jl. Sudirman 1"})
```

Bagus jika address hanya atribut display.

Address sebagai node:

```cypher
(:Person)-[:LIVES_AT]->(:Address {normalizedAddressId})
(:Organization)-[:REGISTERED_AT]->(:Address {normalizedAddressId})
```

Bagus jika address dipakai untuk menemukan koneksi antar person, organization, case, dan asset.

### 5.2 Property Decision Criteria

Sesuatu lebih cocok sebagai property jika:

1. Tidak perlu ditraversal.
2. Tidak punya relationship sendiri.
3. Tidak punya lifecycle independen.
4. Tidak perlu provenance granular.
5. Nilainya sederhana dan stabil.
6. Digunakan untuk filtering/sorting/display.

Contoh property:

```cypher
(:Person {
  personId: "P-001",
  fullName: "Alice Wijaya",
  birthDate: date("1990-01-10"),
  riskScore: 73,
  status: "ACTIVE"
})
```

### 5.3 Relationship Decision Criteria

Sesuatu layak menjadi relationship jika:

1. Ia menyatakan koneksi langsung antara dua node.
2. Koneksi itu punya makna domain.
3. Koneksi itu sering ditraverse.
4. Arah koneksi membantu query.
5. Relationship type bisa membatasi expansion.
6. Relationship bisa punya property sederhana.

Contoh:

```cypher
(:Person)-[:OWNS {since: date("2020-01-01"), percentage: 0.7}]->(:Company)
```

Relationship `OWNS` punya makna domain yang kuat dan akan sering ditraverse.

---

## 6. Step 4 — Extract Relationships with Business Semantics

Relationship bukan sekadar foreign key. Relationship harus menjawab: “apa arti koneksi ini?”

Buruk:

```cypher
(:Person)-[:RELATED_TO]->(:Company)
(:Case)-[:RELATED_TO]->(:Person)
(:Document)-[:RELATED_TO]->(:Case)
```

Model ini kehilangan semantik. Query menjadi kabur:

```cypher
MATCH p = (:Case {caseId: $id})-[:RELATED_TO*1..3]-(x)
RETURN p
```

Hasilnya mungkin banyak, tetapi sulit dijelaskan.

Lebih baik:

```cypher
(:Person)-[:OWNS]->(:Company)
(:Person)-[:DIRECTOR_OF]->(:Company)
(:Case)-[:HAS_SUBJECT]->(:Person)
(:Document)-[:EVIDENCES]->(:Allegation)
(:Allegation)-[:PART_OF]->(:Case)
(:Decision)-[:SUPPORTED_BY]->(:Evidence)
```

Sekarang path bisa dijelaskan:

```text
Case C-100 has subject Alice.
Alice owns Company X.
Company X is subject of Case C-200.
Therefore C-100 and C-200 are related through ownership.
```

### 6.1 Relationship Naming Rules

Gunakan relationship type yang:

- spesifik,
- berbentuk verb atau verb phrase,
- mudah dibaca dalam arah normal,
- stabil secara domain,
- tidak terlalu granular sampai meledak.

Contoh baik:

```text
OWNS
CONTROLS
DIRECTOR_OF
HAS_SUBJECT
SUPPORTED_BY
EVIDENCES
VIOLATES
ESCALATED_TO
ASSIGNED_TO
REVIEWED_BY
USES_DEVICE
REGISTERED_AT
TRANSFERRED_TO
```

Contoh buruk:

```text
RELATES_TO
CONNECTED_TO
HAS
LINKED
TYPE_1
PERSON_COMPANY_RELATION
```

`HAS` kadang boleh, tetapi sering terlalu generik.

### 6.2 Direction Choice

Neo4j bisa traverse dua arah, tetapi arah relationship tetap penting untuk readability dan convention.

Pilih arah berdasarkan kalimat domain natural:

```cypher
(:Person)-[:OWNS]->(:Company)
(:Case)-[:HAS_SUBJECT]->(:Person)
(:Evidence)-[:SUPPORTS]->(:Allegation)
(:Decision)-[:BASED_ON]->(:Evidence)
(:Account)-[:TRANSFERRED_TO]->(:Account)
(:User)-[:MEMBER_OF]->(:Group)
(:Role)-[:GRANTS]->(:Permission)
```

Hindari arah yang membuat query sulit dibaca:

```cypher
(:Company)-[:OWNED_BY]->(:Person)
```

Ini tidak salah, tetapi jika mayoritas pertanyaan adalah “dari person ke asset/company”, arah `(:Person)-[:OWNS]->(:Company)` lebih natural.

### 6.3 Relationship Type Granularity

Terlalu generik:

```cypher
(:Person)-[:RELATED_TO]->(:Person)
```

Terlalu granular:

```cypher
(:Person)-[:OWNS_10_PERCENT]->(:Company)
(:Person)-[:OWNS_20_PERCENT]->(:Company)
(:Person)-[:OWNS_30_PERCENT]->(:Company)
```

Lebih baik:

```cypher
(:Person)-[:OWNS {percentage: 0.3}]->(:Company)
```

Gunakan relationship type untuk kategori traversal, bukan untuk setiap nilai property.

---

## 7. Step 5 — Define Critical Traversal Paths

Setelah entity dan relationship kandidat muncul, tulis path yang harus murah.

Contoh:

```text
Case → Person → Account → Account → Person → Case
Case → Organization → Person → Case
Person → Organization → Organization → Person
User → Group → Role → Permission → Resource
Service → DependsOn → Service → OwnsData → Database
Decision → Evidence → SourceDocument → ExternalSource
```

Path ini adalah “API internal” model graph Anda.

### 7.1 Path Catalogue Template

```text
Path ID: P-CASE-RELATED-BY-SHARED-ACCOUNT
Start: Case
End: Case
Pattern:
  (:Case)-[:HAS_SUBJECT]->(:Person)-[:OWNS]->(:Account)<-[:OWNS]-(:Person)<-[:HAS_SUBJECT]-(:Case)
Max depth: 4
Expected cardinality: low-medium
Business meaning: two cases share account ownership through their subjects
Risk: common corporate account may become supernode
Boundary: exclude accounts tagged as public/shared/system
```

### 7.2 Why Path Catalogue Matters

Path catalogue membantu Anda:

1. Menentukan relationship direction.
2. Menentukan relationship type yang perlu spesifik.
3. Menentukan node mana yang perlu index.
4. Menentukan traversal depth yang aman.
5. Menemukan supernode lebih awal.
6. Menentukan apakah shortcut relationship perlu dibuat.
7. Menjelaskan model ke stakeholder non-teknis.

### 7.3 Example: Impact Analysis Path

Requirement:

```text
Jika service A berubah, data product, API, downstream service, dan business process apa yang terdampak?
```

Graph candidate:

```cypher
(:Service)-[:CALLS]->(:Service)
(:Service)-[:OWNS_TABLE]->(:Table)
(:API)-[:BACKED_BY]->(:Service)
(:BusinessProcess)-[:USES_API]->(:API)
(:Team)-[:OWNS]->(:Service)
```

Critical paths:

```cypher
(:Service)-[:CALLS*1..5]->(:Service)
(:Service)<-[:BACKED_BY]-(:API)<-[:USES_API]-(:BusinessProcess)
(:Service)-[:OWNS_TABLE]->(:Table)
(:Service)<-[:OWNS]-(:Team)
```

Path catalogue langsung menunjukkan mana query interactive dan mana yang mungkin perlu batch/precompute.

---

## 8. Step 6 — Estimate Cardinality and Fan-Out

Graph modelling tanpa cardinality adalah desain buta.

Untuk setiap label dan relationship type, estimasi:

```text
Jumlah node per label.
Jumlah relationship per type.
Average degree.
P95 degree.
P99 degree.
Max degree.
Growth rate.
Hot nodes.
Expected traversal depth.
Expected result size.
```

### 8.1 Fan-Out Math

Jika tiap hop punya rata-rata fan-out 20:

```text
Depth 1: 20
Depth 2: 20 * 20 = 400
Depth 3: 20 * 20 * 20 = 8,000
Depth 4: 160,000
Depth 5: 3,200,000
```

Graph explosion sering bukan karena Neo4j lambat, tetapi karena query meminta terlalu banyak kombinasi path.

### 8.2 Average Degree Can Lie

Average degree sering menipu.

Contoh:

```text
1.000.000 Person nodes
10.000.000 USED_PHONE relationships
Average phone usage per person = 10
```

Terlihat aman.

Tapi distribusi nyata mungkin:

```text
Most persons: 1-3 phones
Call center phone: 500.000 persons
Default unknown phone: 2.000.000 relationships
Placeholder value: "UNKNOWN"
```

Satu supernode dapat menghancurkan query yang seharusnya sederhana.

### 8.3 Cardinality Review Table

Gunakan tabel seperti ini:

| Element | Expected Count | Avg Degree | P99 Degree | Risk | Mitigation |
|---|---:|---:|---:|---|---|
| `(:Person)` | 50M | - | - | high volume | externalId constraint, careful query entry |
| `(:Phone)` | 20M | 2 | 10K | shared phone supernode | normalize, classify shared/public |
| `(:Address)` | 10M | 3 | 1M | apartment/building supernode | unit-level normalization, address type |
| `[:USES_PHONE]` | 80M | - | - | fan-out | date validity, source filtering |
| `[:RELATED_TO]` | avoid | - | - | semantic ambiguity | replace with typed relationships |

### 8.4 Cardinality Before Model Finalization

Sebelum final model, jawab:

```text
Node mana yang bisa menjadi supernode?
Relationship mana yang bisa tumbuh tak terkendali?
Path mana yang akan menghasilkan banyak kombinasi?
Filter apa yang bisa diterapkan sebelum traversal?
Apakah relationship type cukup spesifik untuk membatasi expansion?
Apakah perlu time bucket atau category bucket?
Apakah perlu derived relationship?
```

---

## 9. Step 7 — Decide Node vs Relationship vs Property

Ini keputusan modelling paling sering.

### 9.1 Decision Matrix

| Candidate | Use Node When | Use Relationship When | Use Property When |
|---|---|---|---|
| Address | shared, searchable, connected to many parties | rarely | display-only string |
| Transaction | has lifecycle/evidence/status | simple direct transfer edge | aggregate amount only |
| Role | reusable, hierarchical, audited | direct role assignment relationship | simple enum |
| Evidence | independent audit object | simple support edge | document metadata only |
| Country | traversed/classified | rarely | simple attribute |
| Risk score | score history needed | relation-specific score | current scalar |
| Ownership | if ownership event has parties/evidence | direct ownership edge | not suitable |

### 9.2 Relationship as Fact vs Relationship as Shortcut

Fact relationship:

```cypher
(:Person)-[:OWNS {percentage: 0.7, source: "registry", validFrom: date("2020-01-01")}]->(:Company)
```

Shortcut relationship:

```cypher
(:Person)-[:CONNECTED_TO {reason: "shared-address", confidence: 0.82}]->(:Person)
```

Fact relationship is primary domain fact. Shortcut relationship is derived to accelerate query or simplify explanation.

Shortcut relationships must be governed:

```text
- How created?
- From which source facts?
- How refreshed?
- Can be stale?
- Can user rely on it for decision?
- Does it need provenance?
```

### 9.3 Reification Decision

Sometimes a relationship is not enough.

Simple:

```cypher
(:Person)-[:OWNS {percentage: 0.4}]->(:Company)
```

Reified:

```cypher
(:Person)-[:PARTY_TO]->(:Ownership {ownershipId, percentage, validFrom, validTo})
(:Ownership)-[:TARGETS]->(:Company)
(:Ownership)-[:SUPPORTED_BY]->(:Evidence)
(:Ownership)-[:REPORTED_IN]->(:SourceDocument)
(:Ownership)-[:DECIDED_BY]->(:Decision)
```

Use reification if the relationship itself:

1. Has many relationships.
2. Needs audit/provenance.
3. Has lifecycle/status.
4. Has multiple parties.
5. Needs approval/review.
6. Needs version history.
7. Is central to business decisions.

Do not reify everything. Reification adds hops and complexity.

---

## 10. Step 8 — Choose Labels and Taxonomy

Labels classify nodes. They are not table names exactly, but they often play a similar role in query planning and semantics.

### 10.1 Good Label Design

Good:

```cypher
(:Person)
(:Organization)
(:Account)
(:Case)
(:Evidence)
(:Decision)
(:Phone)
(:Address)
(:Device)
(:Regulation)
```

Multi-label example:

```cypher
(:Person:Subject)
(:Person:Officer)
(:Organization:RegulatedEntity)
(:Case:EnforcementCase)
(:Document:Evidence)
```

Use multi-labels when classification is meaningful and queryable.

### 10.2 Label Explosion

Bad:

```cypher
(:Person_Indonesia_Active_HighRisk_2026)
(:Company_Bank_Active_Jakarta)
```

Use properties instead:

```cypher
(:Person {country: "ID", status: "ACTIVE", riskBand: "HIGH"})
(:Company {industry: "BANKING", status: "ACTIVE", city: "Jakarta"})
```

Labels should represent structural/type category, not every filter dimension.

### 10.3 Label Naming Guidelines

Prefer:

```text
Singular nouns.
Domain language.
Stable classification.
Clear distinction between entity and role.
```

Avoid:

```text
Implementation names.
Temporary states.
Highly volatile categories.
Combinatorial labels.
```

---

## 11. Step 9 — Choose Relationship Types and Taxonomy

Relationship types are among your strongest performance and semantic tools.

### 11.1 Relationship Type as Traversal Filter

Compare:

```cypher
MATCH (p:Person)-[:RELATED_TO]->(x)
RETURN x
```

Versus:

```cypher
MATCH (p:Person)-[:OWNS|DIRECTOR_OF|CONTROLS]->(org:Organization)
RETURN org
```

The second query communicates intent and limits traversal.

### 11.2 Relationship Type Groups

For a regulatory/investigation domain:

```text
Identity / attribute relationships:
USES_PHONE
USES_EMAIL
USES_DEVICE
LIVES_AT
REGISTERED_AT

Ownership/control:
OWNS
CONTROLS
DIRECTOR_OF
BENEFICIAL_OWNER_OF

Case lifecycle:
HAS_SUBJECT
HAS_ALLEGATION
SUPPORTED_BY
ESCALATED_TO
ASSIGNED_TO
REVIEWED_BY
DECIDED_BY

Legal/regulatory:
VIOLATES
GOVERNED_BY
REQUIRES_ACTION

Financial/network:
TRANSFERRED_TO
PAID_TO
GUARANTEED_BY

Knowledge/provenance:
ASSERTED_BY
DERIVED_FROM
EVIDENCED_BY
VALIDATED_BY
```

### 11.3 Relationship Type Avoidance Rules

Avoid relationship type based on:

```text
- dates: TRANSFERRED_TO_2026
- status: OWNS_ACTIVE
- tenant: OWNS_TENANT_A
- percentage: OWNS_50_PERCENT
- source system: OWNS_FROM_SYSTEM_X unless source radically changes semantics
```

Use properties:

```cypher
[:OWNS {validFrom, validTo, status, tenantId, percentage, sourceSystem}]
```

Exception: if it materially changes traversal semantics, type split can be justified.

Example:

```cypher
[:CURRENTLY_OWNS]
[:PREVIOUSLY_OWNED]
```

This can be justified if almost all interactive queries only traverse current ownership and historical edges are huge.

But this creates consistency burden: when ownership status changes, relationship type must be updated or recreated.

---

## 12. Step 10 — Define Identity Strategy

Graph correctness depends heavily on identity. Duplicate nodes are one of the most damaging graph data quality failures.

### 12.1 Identity Types

```text
Internal Neo4j element id:
  Useful internally, not stable business identity.

External source id:
  ID from upstream system.

Natural key:
  e.g. tax identifier, registration number, account number.

Composite identity:
  e.g. sourceSystem + sourceId.

Resolved entity id:
  ID after entity resolution/deduplication.
```

### 12.2 Recommended Pattern

For production graph projections:

```cypher
(:Person {
  personId: "P-123",              // resolved domain identity
  sourceSystem: "CRM",
  sourceId: "crm-991",
  createdAt: datetime(),
  updatedAt: datetime()
})
```

Create uniqueness constraints on stable identifiers where appropriate.

Example:

```cypher
CREATE CONSTRAINT person_id_unique IF NOT EXISTS
FOR (p:Person)
REQUIRE p.personId IS UNIQUE;
```

### 12.3 Source Identity vs Resolved Identity

In many real systems, source identity is not enough.

Example:

```text
CRM Person #123 = Alice Wijaya
KYC Person #887 = A. Wijaya
Case System Subject #C77 = Alice W.
```

Option 1: merge into one `Person` node.

```cypher
(:Person {personId: "resolved-P-001"})
```

Option 2: keep source records and resolved identity separately.

```cypher
(:SourcePerson {sourceSystem: "CRM", sourceId: "123"})-[:RESOLVED_TO]->(:Person {personId: "P-001"})
(:SourcePerson {sourceSystem: "KYC", sourceId: "887"})-[:RESOLVED_TO]->(:Person {personId: "P-001"})
```

Option 2 is often better for regulated/audited systems because it preserves provenance.

---

## 13. Step 11 — Model Time Explicitly

Time is where many graph models become wrong.

### 13.1 Current State vs Historical Fact

Current state:

```cypher
(:Person)-[:OWNS {percentage: 0.7}]->(:Company)
```

Historical validity:

```cypher
(:Person)-[:OWNS {
  percentage: 0.7,
  validFrom: date("2020-01-01"),
  validTo: date("2024-12-31")
}]->(:Company)
```

Current shortcut:

```cypher
(:Person)-[:CURRENTLY_OWNS {percentage: 0.7}]->(:Company)
```

Event model:

```cypher
(:Person)-[:PARTY_TO]->(:OwnershipEvent {eventType: "ACQUIRED", occurredAt})-[:TARGETS]->(:Company)
```

### 13.2 Temporal Query Requirement

Ask early:

```text
Do users ask “what is true now”?
Do users ask “what was true at decision time”?
Do users ask “how did this relationship evolve”?
Do users ask “who knew what when”?
Do audit/legal require reconstructing past graph state?
```

If yes, do not model only current state.

### 13.3 Temporal Validity Pattern

For relationship facts:

```cypher
(:Person)-[:DIRECTOR_OF {
  validFrom: date("2021-03-01"),
  validTo: date("2025-06-30"),
  source: "company-registry"
}]->(:Company)
```

Query at time:

```cypher
MATCH (p:Person)-[r:DIRECTOR_OF]->(c:Company)
WHERE r.validFrom <= $asOfDate
  AND (r.validTo IS NULL OR r.validTo > $asOfDate)
RETURN p, r, c
```

### 13.4 Temporal Modelling Trade-off

Relationship properties are simple but can make temporal path queries verbose.

Reified temporal facts are more explicit but add hops.

Snapshot graphs can speed query but increase storage and refresh complexity.

There is no universal answer. Choose based on query catalogue.

---

## 14. Step 12 — Model Provenance and Evidence

In casual recommendation systems, provenance may be optional. In enforcement, compliance, investigation, risk, or legal workflows, provenance is core.

### 14.1 Provenance Questions

For every important relationship, ask:

```text
Who asserted this?
From which source?
When was it observed?
When was it loaded?
What evidence supports it?
Was it verified?
What confidence does it have?
Can it be contested?
Was it used in a decision?
```

### 14.2 Simple Provenance Property

```cypher
(:Person)-[:OWNS {
  sourceSystem: "company-registry",
  sourceId: "REG-123",
  loadedAt: datetime("2026-06-21T10:00:00Z"),
  confidence: 0.98
}]->(:Company)
```

Good for simple use cases.

### 14.3 Evidence Node Pattern

```cypher
(:Person)-[:OWNS]->(:Company)
(:OwnershipAssertion)-[:ASSERTS]->(:OwnershipFact)
(:OwnershipAssertion)-[:SUPPORTED_BY]->(:Evidence)
(:Evidence)-[:EXTRACTED_FROM]->(:Document)
(:Document)-[:PROVIDED_BY]->(:SourceSystem)
```

A more practical property graph version:

```cypher
(:Person)-[:PARTY_TO]->(:Ownership {ownershipId, percentage, confidence})-[:TARGETS]->(:Company)
(:Ownership)-[:SUPPORTED_BY]->(:Evidence)
(:Evidence)-[:EXTRACTED_FROM]->(:Document)
(:Document)-[:FROM_SOURCE]->(:SourceSystem)
```

### 14.4 Provenance vs Query Cost

Adding evidence/provenance nodes increases traversal cost if every query must pass through them.

Common strategy:

```text
Operational traversal path:
(:Person)-[:OWNS]->(:Company)

Audit/provenance path:
(:Person)-[:PARTY_TO]->(:Ownership)-[:TARGETS]->(:Company)
(:Ownership)-[:SUPPORTED_BY]->(:Evidence)
```

Or:

```cypher
(:Person)-[:OWNS {ownershipId}]->(:Company)
(:Ownership {ownershipId})-[:SUPPORTED_BY]->(:Evidence)
```

This gives fast traversal and detailed audit expansion when needed.

---

## 15. Step 13 — Design for Write Patterns

Many graph models look fine for reads but fail on writes.

### 15.1 Write Questions

For each node/relationship, ask:

```text
Who creates it?
How often is it updated?
Is it append-only or mutable?
Can two writers create the same fact concurrently?
Is identity known at write time?
Does it require MERGE?
Is there a uniqueness constraint?
Can it be deleted?
Can it be corrected?
Does correction preserve history?
```

### 15.2 Example Write Pattern: Idempotent Relationship Creation

Requirement:

```text
Ingest ownership facts from registry daily. Same fact may arrive repeatedly.
```

Model:

```cypher
MERGE (p:Person {personId: $personId})
MERGE (c:Company {companyId: $companyId})
MERGE (p)-[r:OWNS {sourceSystem: $sourceSystem, sourceFactId: $sourceFactId}]->(c)
SET r.percentage = $percentage,
    r.validFrom = date($validFrom),
    r.validTo = CASE WHEN $validTo IS NULL THEN null ELSE date($validTo) END,
    r.updatedAt = datetime()
```

But be careful: relationship uniqueness constraints and MERGE behavior must be designed deliberately. If `sourceFactId` is not unique or missing, duplicates can appear.

### 15.3 Mutation Frequency

Graph relationship updates can be expensive if you continuously rewrite high-degree relationships.

Examples:

```text
- Updating risk score on every transaction.
- Rebuilding all RELATED_TO edges every minute.
- Recomputing community membership synchronously during user request.
```

Better:

```text
- Store raw events elsewhere.
- Project stable graph facts into Neo4j.
- Run batch/stream enrichment separately.
- Use derived relationships with explicit refresh policy.
```

---

## 16. Step 14 — Create a Small Sample Graph

Do not design only in diagrams. Create 20-100 representative nodes and relationships.

### 16.1 Sample Dataset Criteria

Include:

```text
Normal case.
Edge case.
Duplicate identity.
Shared attribute.
Supernode candidate.
Historical relationship.
Missing relationship.
Conflicting source.
Multi-hop path.
Cycle.
High-risk path.
False positive path.
```

### 16.2 Mini Case Graph

```cypher
CREATE
  (alice:Person {personId: 'P1', name: 'Alice'}),
  (bob:Person {personId: 'P2', name: 'Bob'}),
  (charlie:Person {personId: 'P3', name: 'Charlie'}),
  (acme:Organization {orgId: 'O1', name: 'Acme Ltd'}),
  (shell:Organization {orgId: 'O2', name: 'ShellCo'}),
  (case1:Case {caseId: 'C1', status: 'OPEN'}),
  (case2:Case {caseId: 'C2', status: 'OPEN'}),
  (phone:Phone {phoneId: 'PH1', number: '+62-812-000'}),
  (addr:Address {addressId: 'A1', text: 'Jl. Example 1'}),
  (case1)-[:HAS_SUBJECT]->(alice),
  (case2)-[:HAS_SUBJECT]->(bob),
  (alice)-[:OWNS {percentage: 0.6}]->(acme),
  (bob)-[:DIRECTOR_OF]->(acme),
  (acme)-[:OWNS {percentage: 1.0}]->(shell),
  (charlie)-[:USES_PHONE]->(phone),
  (alice)-[:USES_PHONE]->(phone),
  (bob)-[:LIVES_AT]->(addr),
  (alice)-[:LIVES_AT]->(addr);
```

Now test questions:

```cypher
MATCH path = (:Case {caseId: 'C1'})-[:HAS_SUBJECT|OWNS|DIRECTOR_OF|LIVES_AT|USES_PHONE*1..4]-(related:Case)
RETURN path, related;
```

If sample graph already produces noisy results, full production graph will be worse.

---

## 17. Step 15 — Write Real Cypher Before Finalizing the Model

A graph model is not validated until its key queries are written.

### 17.1 Query-Driven Model Validation

For each critical question, write:

1. Starting point query.
2. Traversal pattern.
3. Boundary/filter conditions.
4. Result projection.
5. Explanation path.
6. Pagination/limit strategy.
7. Expected cardinality.

Example:

```cypher
MATCH (c:Case {caseId: $caseId})-[:HAS_SUBJECT]->(subject:Person)
MATCH path = (subject)-[:OWNS|DIRECTOR_OF|CONTROLS*1..3]->(org:Organization)<-[:OWNS|DIRECTOR_OF|CONTROLS*1..3]-(other:Person)<-[:HAS_SUBJECT]-(related:Case)
WHERE related <> c
RETURN related.caseId AS relatedCase,
       length(path) AS distance,
       path AS explanation
ORDER BY distance ASC
LIMIT 50;
```

Then ask:

```text
Is the query readable?
Does it express business semantics?
Can it start from indexed node?
Can it avoid expanding irrelevant relationship types?
Can it bound traversal depth?
Can it explain result?
Does it risk path explosion?
```

### 17.2 Bad Query Smell

If your query repeatedly needs patterns like this:

```cypher
MATCH (a)-[:RELATED_TO*1..10]-(b)
WHERE ... many property filters ...
RETURN ...
```

The model is probably too generic.

If your query needs too many hops for a common business concept, maybe a derived relationship is needed.

If your query needs too many property filters after expansion, maybe relationship types or intermediate nodes need redesign.

---

## 18. Step 16 — Add Constraints and Indexes After Model Shape Stabilizes

Do not start with index design, but do not ignore it.

Indexes usually help find starting points, not magically make arbitrary deep traversal cheap.

### 18.1 Common Constraints

```cypher
CREATE CONSTRAINT case_id_unique IF NOT EXISTS
FOR (c:Case)
REQUIRE c.caseId IS UNIQUE;

CREATE CONSTRAINT person_id_unique IF NOT EXISTS
FOR (p:Person)
REQUIRE p.personId IS UNIQUE;

CREATE CONSTRAINT org_id_unique IF NOT EXISTS
FOR (o:Organization)
REQUIRE o.orgId IS UNIQUE;
```

### 18.2 Common Index Entry Points

```cypher
CREATE INDEX case_status_index IF NOT EXISTS
FOR (c:Case)
ON (c.status);

CREATE INDEX person_name_index IF NOT EXISTS
FOR (p:Person)
ON (p.name);

CREATE INDEX evidence_loaded_at_index IF NOT EXISTS
FOR (e:Evidence)
ON (e.loadedAt);
```

### 18.3 Index Misconception

Misconception:

```text
If traversal is slow, add index on every property.
```

Reality:

```text
Indexes help locate starting nodes or filter indexed lookups.
After traversal begins, cost is often dominated by relationship expansion and result cardinality.
```

If query starts from one `Case` by unique `caseId`, the next cost is graph expansion, not index lookup.

---

## 19. Step 17 — Validate Operational Consequences

A model is not production-ready just because the query works locally.

### 19.1 Operational Review

Ask:

```text
How big will this graph be in 1 year?
Which nodes become hot?
Which relationships grow fastest?
Can ingestion keep up?
Can backups restore within RTO?
Can critical queries run under production volume?
Can query logs identify bad traversal?
Can access control be enforced?
Can data be deleted/retained per policy?
Can graph be rebuilt from source-of-truth?
Can derived relationships be recomputed?
```

### 19.2 Rebuildability

For many architectures, Neo4j is a graph projection, not the only source of truth.

Good production question:

```text
If graph data is corrupted or model changes, can we rebuild it from authoritative sources?
```

If yes, migrations become safer.

If no, Neo4j becomes source-of-truth and needs stronger governance, backup, audit, and migration discipline.

### 19.3 Query Safety

Interactive graph exploration can easily produce expensive queries.

Guardrails:

```text
Bound traversal depth.
Limit result size.
Restrict relationship types.
Require indexed starting point.
Separate analyst sandbox from production transactional workload.
Monitor slow queries.
Educate users about path explosion.
```

---

## 20. Worked Example — From Requirement to Graph Model

Domain: complex enforcement case management.

### 20.1 Raw Requirement

```text
Investigators need to find whether a newly opened case is related to existing cases through shared subjects, organizations, accounts, devices, addresses, ownership, control, and prior decisions. The result must explain why cases are related and support escalation decisions.
```

### 20.2 Extract Questions

```text
Q1. Given a case, what other cases share the same subject?
Q2. What cases involve organizations owned or controlled by the same person?
Q3. Are there cases connected through shared phone, email, address, device, or account?
Q4. What evidence supports a relationship between two cases?
Q5. Were any related cases escalated or sanctioned before?
Q6. What is the shortest explainable path between case A and case B?
Q7. What connections were valid at the time of a decision?
```

### 20.3 Candidate Entities

```text
Case
Person
Organization
Account
Phone
Email
Address
Device
Evidence
Decision
Sanction
Officer
SourceDocument
```

### 20.4 Candidate Relationships

```cypher
(:Case)-[:HAS_SUBJECT]->(:Person)
(:Case)-[:HAS_SUBJECT_ORG]->(:Organization)
(:Person)-[:OWNS]->(:Organization)
(:Person)-[:CONTROLS]->(:Organization)
(:Person)-[:DIRECTOR_OF]->(:Organization)
(:Person)-[:USES_PHONE]->(:Phone)
(:Person)-[:USES_EMAIL]->(:Email)
(:Person)-[:USES_DEVICE]->(:Device)
(:Person)-[:LIVES_AT]->(:Address)
(:Organization)-[:REGISTERED_AT]->(:Address)
(:Person)-[:OWNS_ACCOUNT]->(:Account)
(:Account)-[:TRANSFERRED_TO]->(:Account)
(:Case)-[:HAS_DECISION]->(:Decision)
(:Decision)-[:SUPPORTED_BY]->(:Evidence)
(:Evidence)-[:EXTRACTED_FROM]->(:SourceDocument)
```

### 20.5 Critical Path

```text
Case → Person → Phone → Person → Case
Case → Person → Organization → Person → Case
Case → Person → Account → Account → Person → Case
Case → Decision → Evidence → SourceDocument
Case → Person → Organization → Sanction/Decision/Case
```

### 20.6 First Model

```cypher
(:Case {caseId, status, openedAt})
(:Person {personId, name, birthDate})
(:Organization {orgId, name, registrationNo})
(:Account {accountId, accountNoHash})
(:Phone {phoneId, normalizedNumber})
(:Email {emailId, normalizedEmail})
(:Address {addressId, normalizedAddress})
(:Device {deviceId, fingerprint})
(:Decision {decisionId, decisionType, decidedAt})
(:Evidence {evidenceId, evidenceType, confidence})
```

Relationships:

```cypher
(:Case)-[:HAS_SUBJECT]->(:Person)
(:Case)-[:HAS_SUBJECT]->(:Organization)
(:Person)-[:OWNS {percentage, validFrom, validTo, source}]->(:Organization)
(:Person)-[:CONTROLS {validFrom, validTo, source}]->(:Organization)
(:Person)-[:USES_PHONE {validFrom, validTo, confidence}]->(:Phone)
(:Person)-[:USES_EMAIL {validFrom, validTo, confidence}]->(:Email)
(:Person)-[:USES_DEVICE {firstSeenAt, lastSeenAt, confidence}]->(:Device)
(:Person)-[:LIVES_AT {validFrom, validTo, confidence}]->(:Address)
(:Organization)-[:REGISTERED_AT {validFrom, validTo}]->(:Address)
(:Case)-[:HAS_DECISION]->(:Decision)
(:Decision)-[:SUPPORTED_BY]->(:Evidence)
```

### 20.7 Validate Query

Find related cases via shared identifiers:

```cypher
MATCH (c:Case {caseId: $caseId})-[:HAS_SUBJECT]->(subject)
MATCH path = (subject)-[:USES_PHONE|USES_EMAIL|USES_DEVICE|LIVES_AT]-(shared)<-[:USES_PHONE|USES_EMAIL|USES_DEVICE|LIVES_AT]-(otherSubject)<-[:HAS_SUBJECT]-(related:Case)
WHERE related <> c
RETURN related.caseId AS relatedCase,
       labels(shared) AS sharedType,
       path AS explanation
LIMIT 100;
```

Potential issue:

```text
Address and phone can become supernodes.
```

Mitigation:

```cypher
MATCH (shared)
WHERE coalesce(shared.isCommon, false) = false
```

Or model common/shared identifiers differently.

### 20.8 Validate Ownership Query

```cypher
MATCH (c:Case {caseId: $caseId})-[:HAS_SUBJECT]->(subject:Person)
MATCH path = (subject)-[:OWNS|CONTROLS|DIRECTOR_OF*1..3]-(org:Organization)<-[:OWNS|CONTROLS|DIRECTOR_OF*1..3]-(other:Person)<-[:HAS_SUBJECT]-(related:Case)
WHERE related <> c
RETURN related, path
LIMIT 50;
```

Potential issue:

```text
Variable-length traversal across multiple relationship types can explode if organizations form dense ownership networks.
```

Mitigation:

```text
- Bound depth.
- Directional traversal where possible.
- Filter current valid relationships.
- Use beneficial ownership derived edges if frequent.
- Use GDS/offline analysis for large network detection.
```

### 20.9 Derived Relationship Option

If related-case discovery is frequent and expensive:

```cypher
(:Case)-[:POTENTIALLY_RELATED_TO {
  reason: "shared-phone",
  confidence: 0.86,
  generatedAt: datetime(),
  ruleVersion: "v3"
}]->(:Case)
```

But this is not raw truth. It is a derived assertion.

Govern it like a materialized view:

```text
- source paths recorded,
- refresh strategy,
- invalidation strategy,
- rule version,
- confidence,
- auditability,
- human review status.
```

---

## 21. Modelling Review Checklist

Before accepting a graph model, run this checklist.

### 21.1 Requirement Fit

```text
[ ] Are the main requirements relationship/path oriented?
[ ] Are the critical questions documented?
[ ] Is Neo4j justified compared to SQL/search/document/OLAP/cache?
[ ] Is the graph operational, analytical, knowledge, or hybrid?
[ ] Is source-of-truth ownership clear?
```

### 21.2 Model Shape

```text
[ ] Are nodes chosen because they are traversed/identified/connected?
[ ] Are properties not over-promoted into nodes?
[ ] Are important relationships semantically typed?
[ ] Are relationship directions readable?
[ ] Are labels stable and meaningful?
[ ] Is label/type explosion avoided?
[ ] Are generic RELATED_TO edges avoided or justified?
```

### 21.3 Query Validation

```text
[ ] Are critical Cypher queries written?
[ ] Do queries start from indexed/unique entry points?
[ ] Are traversals bounded?
[ ] Are relationship types specific enough?
[ ] Are filters applied before or during expansion when possible?
[ ] Are result sizes bounded?
[ ] Are explanation paths available where needed?
```

### 21.4 Cardinality and Performance

```text
[ ] Are high-degree nodes identified?
[ ] Are P95/P99 degrees estimated?
[ ] Are supernode mitigations defined?
[ ] Is fan-out across common paths estimated?
[ ] Are derived relationships considered only when justified?
[ ] Are indexes/constraints planned?
```

### 21.5 Correctness and Operations

```text
[ ] Is identity strategy explicit?
[ ] Are uniqueness constraints defined?
[ ] Are write patterns idempotent?
[ ] Is temporal validity modelled if required?
[ ] Is provenance/audit modelled if required?
[ ] Can the graph be rebuilt or migrated?
[ ] Are access control and tenant boundaries considered?
[ ] Are monitoring and slow query guardrails planned?
```

---

## 22. Common Modelling Failure Modes

### 22.1 “We Converted the ERD to Graph”

Symptom:

```text
Every table becomes label.
Every foreign key becomes relationship.
No thought about traversal questions.
```

Result:

```text
Graph has structure but no graph advantage.
Queries are still relational thinking in Cypher syntax.
```

Fix:

```text
Start from graph questions and refactor around paths.
```

### 22.2 “Everything Is RELATED_TO”

Symptom:

```cypher
(a)-[:RELATED_TO]->(b)
```

Everywhere.

Result:

```text
No semantics, poor explainability, poor traversal filtering.
```

Fix:

```text
Replace generic edge with domain relationship types.
```

### 22.3 “Everything Is a Node”

Symptom:

```text
Status as node.
Small enum as node.
Scalar field as node.
Every event as permanent traversal node.
```

Result:

```text
Too many hops, noisy graph, expensive queries.
```

Fix:

```text
Promote to node only when it needs identity, relationships, lifecycle, or traversal.
```

### 22.4 “Everything Is a Property”

Symptom:

```cypher
(:Person {phone: '+62...', address: '...', company: 'Acme'})
```

Result:

```text
Cannot discover shared phones, addresses, organizations, or ownership paths.
```

Fix:

```text
Promote shared/traversed attributes into nodes.
```

### 22.5 “No Temporal Model”

Symptom:

```text
Only current relationship exists.
Past facts overwritten.
```

Result:

```text
Cannot reconstruct decision context.
Audit failure.
```

Fix:

```text
Use validFrom/validTo, event nodes, snapshots, or historical relationships.
```

### 22.6 “No Cardinality Thinking”

Symptom:

```text
Model works on demo data but fails in production.
```

Result:

```text
Supernodes, path explosion, slow interactive queries.
```

Fix:

```text
Estimate degree distribution and test with realistic skew.
```

---

## 23. Practical Design Artifacts

A serious graph modelling process should produce these artifacts.

### 23.1 Query Catalogue

A list of critical graph questions with inputs, outputs, latency, depth, and explanation requirement.

### 23.2 Graph Model Diagram

Not just boxes and arrows, but annotated with:

```text
relationship direction,
cardinality,
temporal properties,
provenance,
source-of-truth,
critical query paths.
```

### 23.3 Path Catalogue

List of important traversals and their expected depth/fan-out.

### 23.4 Constraint and Index Plan

A concrete Cypher migration file for constraints and indexes.

### 23.5 Sample Dataset

Representative graph fixture containing normal and edge cases.

### 23.6 Query Test Suite

Critical Cypher queries tested against sample data and later against larger benchmark data.

### 23.7 Performance Assumption Sheet

Cardinality, degree distribution, query frequency, expected growth.

### 23.8 Operational Runbook Notes

Known risks, supernode mitigation, rebuild strategy, monitoring metrics.

---

## 24. Mental Models to Keep

### 24.1 Graph Model Is a Query Accelerator for Relationships

A graph model should make important relationship questions natural and cheap.

If the model merely stores data in node form, you have not gained much.

### 24.2 Path Is a Product Feature

In graph systems, the path is often the explanation.

This matters for:

```text
investigation,
risk,
fraud,
recommendation,
IAM,
dependency analysis,
knowledge graph,
regulatory decision support.
```

### 24.3 Relationship Type Is Both Semantics and Performance

A good relationship type communicates meaning and narrows traversal.

### 24.4 Cardinality Beats Aesthetic Diagrams

A beautiful graph diagram can hide catastrophic fan-out.

Always ask:

```text
What happens when this node has 1 million neighbors?
```

### 24.5 Derived Edges Are Materialized Views

Treat derived relationships like materialized views:

```text
useful,
fast,
possibly stale,
needs refresh,
needs provenance,
needs invalidation.
```

### 24.6 Graph Is Not Automatically More Explainable

Graph can make explanation easier if relationship semantics and provenance are modelled well.

A generic noisy graph can be less explainable than a relational model.

---

## 25. Exercises

### Exercise 1 — Identify Graph-Shaped Questions

Given this requirement:

```text
A compliance platform stores companies, licenses, inspections, violations, officers, documents, sanctions, and appeals.
```

Write 10 graph-shaped questions. Avoid generic CRUD questions.

Good examples:

```text
Which companies share beneficial owners with sanctioned companies?
Which officers reviewed cases involving entities they previously inspected?
Which appeals cite documents also used in prior successful appeals?
Which violations are connected through the same facility, operator, or license chain?
```

### Exercise 2 — Node vs Property

For each candidate, decide node/property/relationship and justify:

```text
Phone number
Country
Risk score
Case status
Beneficial ownership
Document source
Business address
Violation type
Regulation article
Officer role
```

### Exercise 3 — Fan-Out Estimation

Assume:

```text
Each Case has 3 subjects.
Each Person uses 2 phones.
Each Phone is used by average 3 persons, but P99 is 10,000.
Each Person appears in 2 cases.
```

Estimate result size for:

```text
Case → Person → Phone → Person → Case
```

Then explain how P99 phone nodes change risk.

### Exercise 4 — Path Catalogue

Create path catalogue for:

```text
IAM entitlement graph:
User, Group, Role, Permission, Resource, Policy, Approval.
```

Include at least:

```text
User → Permission
User → Resource
User → Toxic Combination
Compromised User → Blast Radius
```

### Exercise 5 — Refactor Bad Model

Bad model:

```cypher
(:Entity {type: 'person'})-[:RELATED_TO {type: 'owns'}]->(:Entity {type: 'company'})
(:Entity {type: 'case'})-[:RELATED_TO {type: 'subject'}]->(:Entity {type: 'person'})
```

Refactor into labels and relationship types.

Explain why the refactored model is easier to query and reason about.

---

## 26. Summary

Graph modelling is not “draw nouns and connect them”. It is a disciplined process for making relationship-centric questions cheap, explainable, and maintainable.

The most important modelling rule is:

```text
Start from the questions and paths that must be cheap.
```

A strong Neo4j model has:

```text
- clear graph-shaped use cases,
- semantically meaningful relationship types,
- stable node labels,
- explicit identity strategy,
- bounded traversal patterns,
- cardinality awareness,
- temporal/provenance modelling where needed,
- validated Cypher queries,
- constraints and indexes for entry points,
- operational guardrails,
- a plan for evolution.
```

If you can explain your model through paths, expected fan-out, query catalogue, and correctness invariants, you are no longer merely using a graph database. You are designing a graph system.

---

## 27. What Comes Next

Part 007 will move from methodology into reusable advanced graph modelling patterns:

```text
Membership pattern
Role assignment pattern
Permission and entitlement graph
Hierarchy and org structure
Bill of materials
Dependency graph
Versioned relationship pattern
Temporal snapshot pattern
Event-to-state graph projection
Entity resolution graph
Similarity relationship pattern
Scoring relationship pattern
Evidence and source attribution
Multi-tenant graph modelling
Soft delete vs historical validity
Derived edge/materialized relationship
```

Part 006 selesai. Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Cypher Path Semantics: Variable-Length Traversal, Shortest Path, and Expansion Control</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-007.md">Part 007 — Advanced Graph Modelling Patterns ➡️</a>
</div>
