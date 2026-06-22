# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-026

# Part 026 — Knowledge Graphs, Ontologies, Semantics, and Inference Boundaries

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami Graph Database dan Neo4j sampai level arsitektur, modelling, correctness, dan production decision-making.  
> Fokus part ini: memahami knowledge graph secara engineering-oriented: bagaimana graph merepresentasikan pengetahuan, apa bedanya schema/ontology/taxonomy, bagaimana menangani semantics/provenance/confidence/temporal facts, dan batas inference agar sistem tetap defensible.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 025, kita sudah membahas:

1. kenapa graph database ada,
2. property graph model,
3. Cypher dan path semantics,
4. modelling methodology,
5. constraint/index/performance,
6. Java integration,
7. operations/clustering/security,
8. Graph Data Science,
9. embeddings, vector index, dan GraphRAG.

Part ini menjawab pertanyaan yang sering muncul setelah seseorang mulai memakai Neo4j untuk domain kompleks:

> “Kalau data saya sudah berupa node dan relationship, apakah itu otomatis knowledge graph?”

Jawaban singkatnya:

> Tidak otomatis.

Graph database adalah storage/query model. Knowledge graph adalah cara mengorganisasi pengetahuan domain sehingga entity, relationship, meaning, evidence, provenance, temporal validity, dan governance dapat dipahami dan dipakai secara konsisten.

Neo4j menyimpan data sebagai nodes, relationships, dan properties. Node merepresentasikan entity/discrete object, relationship merepresentasikan koneksi antara source node dan target node, dan properties menyimpan data pada node/relationship. Ini adalah fondasi property graph, tetapi knowledge graph membutuhkan lapisan makna di atas fondasi tersebut.

---

## 1. Core Mental Model

### 1.1 Graph database menjawab “apa yang terhubung dengan apa?”

Contoh:

```cypher
MATCH (p:Person)-[:OWNS]->(c:Company)
RETURN p.name, c.name
```

Query ini menjawab koneksi eksplisit antara `Person` dan `Company`.

### 1.2 Knowledge graph menjawab “apa arti koneksi itu dalam domain?”

Pertanyaan yang lebih knowledge-oriented:

1. Apakah `OWNS` berarti legal ownership, beneficial ownership, operational control, atau reported ownership?
2. Apakah ownership itu masih berlaku?
3. Siapa sumber informasinya?
4. Apakah confidence-nya tinggi?
5. Apakah ada bukti yang mendukung?
6. Apakah ada fakta kontradiktif?
7. Apakah relationship ini langsung, turunan, inferred, atau hasil scoring?
8. Apakah boleh dipakai untuk keputusan enforcement?
9. Jika auditor bertanya, bisakah kita jelaskan kenapa graph mengatakan entity A terkait entity B?

Di sinilah graph database berubah menjadi knowledge graph.

### 1.3 Knowledge graph bukan hanya “banyak relationship”

Graph yang besar belum tentu knowledge graph.

Graph besar:

```text
Person --USES_EMAIL--> Email
Person --USES_PHONE--> Phone
Person --HAS_ADDRESS--> Address
Account --TRANSFERRED_TO--> Account
```

Knowledge graph:

```text
Person --BENEFICIALLY_OWNS {source, validFrom, validTo, confidence, evidenceRef}--> Company
Company --REGISTERED_AT {jurisdiction, registryId, source}--> Address
Case --SUPPORTED_BY--> Evidence
Decision --BASED_ON--> Finding
Finding --DERIVED_FROM--> Evidence
Regulation --PROHIBITS--> ConductType
```

Perbedaannya ada pada semantic precision, provenance, temporal validity, traceability, dan governance.

---

## 2. Property Graph vs Knowledge Graph

### 2.1 Property graph

Property graph biasanya memiliki:

1. nodes,
2. relationships,
3. node labels,
4. relationship types,
5. properties pada node/relationship.

Contoh:

```cypher
CREATE (p:Person {id: 'P-001', name: 'Ari'})
CREATE (c:Company {id: 'C-001', name: 'Nusantara Trading'})
CREATE (p)-[:OWNS {percentage: 35.0, source: 'Registry'}]->(c)
```

Property graph cocok untuk traversal cepat dan expressive query:

```cypher
MATCH path = (p:Person {id: 'P-001'})-[:OWNS|CONTROLS*1..3]->(x)
RETURN path
```

### 2.2 Knowledge graph

Knowledge graph adalah design pattern untuk menyimpan, mengorganisasi, dan mengakses entity yang saling berhubungan beserta semantic relationships-nya.

Dalam sistem nyata, knowledge graph biasanya memiliki tambahan:

1. ontology atau schema semantic,
2. controlled vocabulary,
3. entity resolution,
4. provenance,
5. confidence,
6. temporal validity,
7. source traceability,
8. evidence graph,
9. inferred/derived facts,
10. governance workflow.

Property graph menjelaskan **bentuk data**. Knowledge graph menjelaskan **makna data**.

---

## 3. Ontology, Schema, Taxonomy, Vocabulary: Jangan Dicampur

Istilah ini sering dipakai sembarangan. Untuk engineering, bedakan seperti ini.

### 3.1 Schema

Schema menjawab:

> “Struktur apa yang boleh ada?”

Dalam Neo4j, schema biasanya berarti constraints dan indexes:

```cypher
CREATE CONSTRAINT person_id_unique IF NOT EXISTS
FOR (p:Person)
REQUIRE p.id IS UNIQUE;

CREATE CONSTRAINT company_id_unique IF NOT EXISTS
FOR (c:Company)
REQUIRE c.id IS UNIQUE;
```

Schema juga dapat berupa application-level contract:

```text
(:Person)-[:OWNS]->(:Company)
(:Company)-[:REGISTERED_IN]->(:Jurisdiction)
(:Evidence)-[:SUPPORTS]->(:Finding)
(:Finding)-[:RELATES_TO]->(:Case)
```

Schema menjaga consistency bentuk.

### 3.2 Taxonomy

Taxonomy menjawab:

> “Kategori apa yang ada, dan bagaimana hierarkinya?”

Contoh:

```text
Conduct
├── FinancialMisconduct
│   ├── MoneyLaundering
│   ├── MarketManipulation
│   └── InsiderTrading
├── LicensingViolation
└── ReportingViolation
```

Dalam graph:

```cypher
CREATE (:ConductType {code: 'CONDUCT'})
CREATE (:ConductType {code: 'FINANCIAL_MISCONDUCT'})-[:SUBTYPE_OF]->(:ConductType {code: 'CONDUCT'})
```

Taxonomy membantu classification dan roll-up.

### 3.3 Controlled vocabulary

Controlled vocabulary menjawab:

> “Nilai istilah apa yang resmi?”

Contoh:

```text
RiskLevel = LOW | MEDIUM | HIGH | CRITICAL
EvidenceType = REGISTRY_RECORD | BANK_STATEMENT | EMAIL | INTERVIEW | OBSERVATION
RelationshipConfidence = ASSERTED | INFERRED | DISPUTED | VERIFIED
```

Controlled vocabulary mengurangi variasi liar:

```text
"High", "HIGH", "high risk", "H", "urgent", "red"
```

Dalam sistem enterprise, uncontrolled vocabulary sering membuat graph tampak kaya tetapi tidak dapat dipercaya.

### 3.4 Ontology

Ontology menjawab:

> “Konsep domain apa yang ada, apa hubungannya, aturan maknanya apa, dan apa konsekuensi logisnya?”

Contoh aturan ontology:

```text
BeneficialOwner is a subtype of Controller.
If Person beneficially owns Company, Person has control influence over Company.
If Entity is sanctioned, and another Entity is majority-owned by it, derived risk exists.
A Finding must be supported by at least one Evidence before it can support an EnforcementDecision.
```

Ontology bukan hanya daftar label. Ontology adalah semantic contract.

---

## 4. Property Graph vs RDF/OWL: Bedanya Penting

### 4.1 Property graph style

Neo4j property graph:

```text
(:Person {id, name})-[:OWNS {percentage, validFrom, source}]->(:Company {id, name})
```

Kelebihan:

1. natural untuk application graph,
2. relationship bisa punya properties,
3. Cypher expressive untuk traversal,
4. cocok untuk operational graph,
5. mudah diintegrasikan dengan Java service.

### 4.2 RDF triple style

RDF biasanya berbentuk triple:

```text
subject predicate object
```

Contoh:

```text
person:P001 owns company:C001
person:P001 hasName "Ari"
company:C001 hasName "Nusantara Trading"
```

Kelebihan:

1. standar interoperabilitas semantic web,
2. cocok untuk ontology formal,
3. bisa memakai RDF Schema, OWL, SKOS, SHACL,
4. inference lebih formal.

### 4.3 Neo4j dan neosemantics

Neo4j ecosystem memiliki neosemantics/n10s, plugin untuk bekerja dengan RDF dan vocabularies seperti OWL, RDFS, SKOS, serta validasi SHACL dan basic inferencing.

Artinya, Neo4j dapat dipakai di area knowledge graph yang bersinggungan dengan RDF/ontology, tetapi Neo4j property graph dan RDF stack tetap punya mental model berbeda.

### 4.4 Practical rule

Gunakan property graph bila:

1. aplikasi utama memakai traversal/query operational,
2. relationship properties penting,
3. Java service harus query cepat dan eksplisit,
4. ontology formal tidak dominan,
5. user butuh investigasi network/path.

Gunakan RDF/OWL atau integrasi semantic tooling bila:

1. interoperability dengan semantic web penting,
2. ontology formal adalah pusat sistem,
3. inferencing formal dibutuhkan,
4. SHACL validation penting,
5. data harus bertukar dalam RDF/OWL/SKOS.

Gunakan hybrid bila:

1. operational graph ada di Neo4j,
2. ontology/taxonomy diimpor/disinkronkan,
3. sebagian inference dijalankan offline,
4. hasil inference ditulis sebagai explicit derived relationship.

---

## 5. The Three Layers of a Knowledge Graph

Knowledge graph production biasanya punya tiga layer.

```text
┌───────────────────────────────────────────────┐
│  Semantic / Governance Layer                   │
│  ontology, taxonomy, vocabulary, rules, policy │
├───────────────────────────────────────────────┤
│  Knowledge Layer                               │
│  entities, relationships, provenance, evidence │
├───────────────────────────────────────────────┤
│  Data / Source Layer                           │
│  raw records, events, documents, registries    │
└───────────────────────────────────────────────┘
```

### 5.1 Source layer

Ini data mentah:

```text
registry rows
transaction records
case documents
emails
inspection notes
licensing files
sanction lists
court records
external datasets
```

Data source layer sering noisy, duplicated, incomplete, dan inconsistent.

### 5.2 Knowledge layer

Ini data yang sudah dimaknai:

```text
Person
Company
Address
License
Case
Evidence
Finding
Decision
ConductType
Regulation
```

Relationship mulai punya makna:

```text
OWNS
CONTROLS
RELATED_TO
REGISTERED_AT
SUBJECT_OF
SUPPORTED_BY
VIOLATES
ESCALATED_TO
DERIVED_FROM
```

### 5.3 Semantic/governance layer

Ini menjelaskan aturan:

```text
What is a Person?
What is a Company?
What is beneficial ownership?
What is a verified fact?
When can inferred relation be used?
Which relationship types are admissible for enforcement decision?
Which source has authority?
```

Tanpa layer ini, knowledge graph menjadi sekadar connected data lake.

---

## 6. Entity Semantics: Node Bukan Sekadar Record

### 6.1 Entity identity

Knowledge graph harus menjawab:

> “Apakah dua record ini merepresentasikan entity yang sama?”

Contoh:

```text
Ari Wijaya
Ari W.
A. Wijaya
Ari Wijaya, DOB 1989-05-10
Ari Wijaya, passport X123
```

Di graph, jangan langsung membuat semua record menjadi `Person` final tanpa entity resolution.

Pola yang lebih aman:

```text
(:SourceRecord)-[:ASSERTS_IDENTITY]->(:IdentityClaim)-[:MAY_REFER_TO]->(:Person)
```

Atau:

```text
(:RegistryRecord)-[:RESOLVED_TO {confidence, method, reviewedBy}]->(:Person)
```

### 6.2 Entity vs record

Bedakan:

```text
Record = observasi dari source tertentu.
Entity = konsep dunia nyata yang direpresentasikan setelah resolusi.
```

Contoh model:

```cypher
CREATE (r:RegistryRecord {
  recordId: 'REG-2026-001',
  rawName: 'Nusantara Trading Ltd',
  source: 'CompanyRegistry'
})

CREATE (c:Company {
  companyId: 'COMP-001',
  canonicalName: 'Nusantara Trading Limited'
})

CREATE (r)-[:RESOLVED_TO {
  confidence: 0.97,
  method: 'registry_number_exact_match',
  resolvedAt: datetime()
}]->(c)
```

### 6.3 Canonical entity danger

Terlalu cepat menggabungkan entity berbahaya.

Failure mode:

```text
Two different people share name + address.
Entity resolution merges them.
Graph now shows false relationship.
Investigation decision becomes contaminated.
```

Mitigasi:

1. simpan raw records,
2. simpan resolution edge,
3. simpan confidence,
4. simpan method,
5. simpan reviewer bila manual,
6. jangan hapus conflicting evidence,
7. bedakan `SAME_AS_CONFIRMED` dan `POSSIBLY_SAME_AS`.

---

## 7. Relationship Semantics: Type Harus Bermakna

Relationship type adalah bahasa domain.

Buruk:

```text
(:Person)-[:RELATED_TO]->(:Company)
```

Lebih baik:

```text
(:Person)-[:LEGAL_OWNER_OF]->(:Company)
(:Person)-[:BENEFICIAL_OWNER_OF]->(:Company)
(:Person)-[:DIRECTOR_OF]->(:Company)
(:Person)-[:AUTHORIZED_SIGNATORY_OF]->(:Company)
(:Person)-[:EMPLOYED_BY]->(:Company)
(:Person)-[:REPRESENTED_BY]->(:Company)
```

### 7.1 Jangan terlalu generic

`RELATED_TO` biasanya hanya aman sebagai derived/summary relationship, bukan fact utama.

Masalah `RELATED_TO`:

1. tidak menjelaskan nature hubungan,
2. sulit di-audit,
3. sulit difilter,
4. traversal menjadi noisy,
5. downstream scoring bisa salah.

### 7.2 Jangan terlalu granular tanpa alasan

Terlalu granular juga buruk:

```text
OWNS_0_TO_10_PERCENT
OWNS_10_TO_20_PERCENT
OWNS_20_TO_30_PERCENT
```

Lebih baik:

```text
(:Person)-[:OWNS {percentage: 17.5}]->(:Company)
```

Gunakan relationship type untuk semantic category, property untuk value.

### 7.3 Relationship naming heuristic

Relationship type baik jika memenuhi:

1. bisa dibaca sebagai kalimat domain,
2. punya arah natural,
3. punya konsekuensi query,
4. cukup stabil,
5. bukan encoding dari nilai dinamis,
6. dapat dijelaskan kepada domain expert.

Contoh:

```text
Person BENEFICIALLY_OWNS Company
Evidence SUPPORTS Finding
Finding VIOLATES Regulation
Case ESCALATED_TO Unit
Decision BASED_ON Finding
```

---

## 8. Provenance: Knowledge Tanpa Sumber Tidak Defensible

Dalam domain regulasi, enforcement, risk, fraud, compliance, dan legal workflow, graph tanpa provenance sulit dipercaya.

### 8.1 Provenance menjawab

1. Dari mana fakta ini berasal?
2. Kapan diambil?
3. Siapa/apa yang membuat klaim?
4. Apakah fakta ini raw, curated, inferred, atau verified?
5. Apakah ada dokumen pendukung?
6. Apakah masih berlaku?
7. Apakah sudah direview?
8. Apakah boleh dipakai untuk keputusan formal?

### 8.2 Simple provenance as properties

Untuk kasus sederhana:

```cypher
CREATE (p)-[:DIRECTOR_OF {
  source: 'CompanyRegistry',
  sourceRecordId: 'REG-123',
  importedAt: datetime(),
  validFrom: date('2023-01-01'),
  confidence: 0.99
}]->(c)
```

Cocok bila:

1. satu fakta satu source,
2. evidence sederhana,
3. audit requirement ringan,
4. tidak banyak conflicting fact.

### 8.3 Provenance as graph

Untuk domain serius, provenance sebaiknya menjadi subgraph:

```text
(:RegistryRecord)-[:ASSERTS]->(:Claim)-[:ABOUT]->(:Person)
(:Claim)-[:ASSERTS_RELATIONSHIP]->(:RelationshipFact)
(:RelationshipFact)-[:SUBJECT]->(:Person)
(:RelationshipFact)-[:OBJECT]->(:Company)
(:RelationshipFact)-[:PREDICATE]->(:RelationshipType {code:'DIRECTOR_OF'})
(:Evidence)-[:SUPPORTS]->(:Claim)
(:Claim)-[:RESOLVED_AS]->(:Person)-[:DIRECTOR_OF]->(:Company)
```

Namun Neo4j relationship tidak bisa langsung menjadi target relationship lain. Jika relationship itu sendiri perlu provenance kompleks, ada dua pilihan:

1. relationship property sederhana,
2. reify relationship sebagai node/fact.

### 8.4 Reified fact pattern

```text
(:Person)-[:PARTICIPATES_AS_SUBJECT]->(:Fact {type:'BENEFICIAL_OWNERSHIP'})
(:Fact)-[:PARTICIPATES_AS_OBJECT]->(:Company)
(:SourceRecord)-[:ASSERTS]->(:Fact)
(:Evidence)-[:SUPPORTS]->(:Fact)
```

Atau lebih readable:

```text
(:OwnershipFact)
  -[:OWNER]->(:Person)
  -[:OWNED_ENTITY]->(:Company)
  -[:SUPPORTED_BY]->(:Evidence)
  -[:ASSERTED_BY]->(:Source)
```

Kapan dipakai:

1. relationship punya banyak metadata,
2. banyak evidence mendukung satu fact,
3. ada conflicting fact,
4. fact punya lifecycle review,
5. fact punya status,
6. fact dipakai untuk keputusan formal.

Trade-off:

1. traversal lebih panjang,
2. query lebih verbose,
3. model lebih berat,
4. auditability jauh lebih kuat.

---

## 9. Confidence, Certainty, and Status

Knowledge graph sering mencampur fakta pasti dan dugaan. Ini berbahaya.

### 9.1 Jangan campur asserted fact dan inferred fact

Buruk:

```text
(:Person)-[:ASSOCIATED_WITH]->(:Company)
```

Tanpa metadata, user tidak tahu apakah hubungan ini:

1. tercatat di registry,
2. disimpulkan dari transaksi,
3. hasil ML,
4. klaim investigator,
5. hasil matching lemah,
6. informasi lama yang sudah expired.

### 9.2 Gunakan status

Contoh:

```cypher
CREATE (p)-[:ASSOCIATED_WITH {
  status: 'INFERRED',
  confidence: 0.72,
  method: 'shared_address_and_phone',
  validAsOf: date('2026-06-22'),
  usableForDecision: false
}]->(c)
```

Controlled values:

```text
ASSERTED
VERIFIED
INFERRED
DISPUTED
RETRACTED
EXPIRED
SUPERSEDED
```

### 9.3 Confidence bukan kebenaran

Confidence score sering disalahgunakan.

Score 0.92 tidak berarti fakta benar 92% dalam arti legal. Score hanya output dari metode tertentu di data tertentu.

Untuk defensibility, simpan:

1. score,
2. scoring method,
3. model version,
4. input features/source,
5. computedAt,
6. threshold,
7. reviewer outcome.

Contoh:

```cypher
CREATE (p)-[:POSSIBLY_SAME_AS {
  score: 0.91,
  method: 'entity_resolution_v4',
  modelVersion: '2026.05.1',
  computedAt: datetime(),
  reviewed: false
}]->(q)
```

### 9.4 Decision-safe vs analysis-only facts

Tidak semua fakta graph boleh dipakai untuk keputusan formal.

Tambahkan property/policy:

```text
usableForExploration = true
usableForAutomatedDecision = false
usableForEnforcementAction = false
requiresHumanReview = true
```

Atau model sebagai relationship ke policy:

```text
(:Fact)-[:GOVERNED_BY]->(:UsagePolicy {code:'ANALYSIS_ONLY'})
```

---

## 10. Temporal Knowledge: Facts Have Time

Knowledge graph yang tidak punya time semantics akan cepat salah.

### 10.1 Ada banyak jenis waktu

1. **Event time**: kapan kejadian terjadi.
2. **Valid time**: kapan fakta berlaku di dunia nyata.
3. **Transaction time**: kapan sistem mengetahui/menyimpan fakta.
4. **Publication time**: kapan source menerbitkan informasi.
5. **Review time**: kapan manusia memverifikasi.

Contoh:

```text
Ari became director on 2023-01-01.
Registry published update on 2023-01-05.
Our system imported it on 2023-01-06.
Investigator verified it on 2023-01-10.
Ari resigned on 2024-03-01.
Our system learned resignation on 2024-04-15.
```

Semua waktu ini bisa penting.

### 10.2 Relationship temporal properties

Untuk simple case:

```cypher
CREATE (p)-[:DIRECTOR_OF {
  validFrom: date('2023-01-01'),
  validTo: date('2024-03-01'),
  sourcePublishedAt: date('2023-01-05'),
  importedAt: datetime('2023-01-06T08:00:00Z')
}]->(c)
```

### 10.3 Temporal query

```cypher
MATCH (p:Person)-[r:DIRECTOR_OF]->(c:Company)
WHERE r.validFrom <= date('2023-12-31')
  AND (r.validTo IS NULL OR r.validTo > date('2023-12-31'))
RETURN p, r, c
```

Artinya:

> Siapa direktur aktif pada 31 Desember 2023?

### 10.4 Snapshot vs interval

Dua pendekatan umum:

#### Interval relationship

```text
Person -[:DIRECTOR_OF {validFrom, validTo}]-> Company
```

Kelebihan:

1. compact,
2. query direct,
3. bagus untuk relationship yang berubah pelan.

Kekurangan:

1. update interval butuh disiplin,
2. conflict handling lebih sulit,
3. provenance bisa kompleks.

#### Snapshot graph

```text
(:Snapshot {asOf:'2023-12-31'})-[:CONTAINS]->(:Fact)
```

Kelebihan:

1. audit reproducibility kuat,
2. cocok untuk regulatory reporting,
3. keputusan dapat direkonstruksi.

Kekurangan:

1. storage lebih besar,
2. query lebih verbose,
3. maintenance lebih berat.

### 10.5 Regulatory defensibility principle

Untuk keputusan formal, jangan hanya bisa menjawab:

> “Apa state terbaru?”

Harus bisa menjawab:

> “Apa yang sistem ketahui pada tanggal keputusan, berdasarkan source apa, dengan status validitas apa?”

Itu berbeda.

---

## 11. Contradictory Knowledge

Di sistem nyata, sources bisa saling bertentangan.

Contoh:

```text
Registry says Ari is director until 2024-03-01.
Court filing says Ari remained de facto controller until 2025-02-10.
Investigator note says Ari denies involvement.
Bank record shows Ari was signatory until 2025-01-01.
```

Knowledge graph yang baik tidak langsung “memilih satu” dan membuang lainnya.

### 11.1 Model contradiction explicitly

```text
(:Claim {id:'C1', statement:'Ari resigned as director', status:'ASSERTED'})
(:Claim {id:'C2', statement:'Ari retained control', status:'ASSERTED'})
(:Claim)-[:CONTRADICTS]->(:Claim)
(:Evidence)-[:SUPPORTS]->(:Claim)
```

### 11.2 Fact status lifecycle

```text
ASSERTED -> UNDER_REVIEW -> VERIFIED
ASSERTED -> DISPUTED -> REJECTED
VERIFIED -> SUPERSEDED
VERIFIED -> EXPIRED
```

Dalam graph:

```text
(:Fact)-[:HAS_STATUS]->(:FactStatus)
(:Fact)-[:SUPERSEDED_BY]->(:Fact)
(:Fact)-[:DISPUTED_BY]->(:Claim)
```

### 11.3 Why not just overwrite?

Overwrite menghancurkan auditability.

Dalam domain enforcement:

1. keputusan lama harus bisa direkonstruksi,
2. source lama mungkin tetap relevan,
3. conflict adalah informasi penting,
4. chain-of-custody evidence harus tetap ada,
5. reviewer harus tahu apa yang berubah.

---

## 12. Inference: Explicit, Derived, Inferred, and Predicted

### 12.1 Explicit fact

Fakta langsung dari source:

```text
Registry says Person P is director of Company C.
```

Model:

```text
(:Person)-[:DIRECTOR_OF {source:'Registry'}]->(:Company)
```

### 12.2 Derived fact

Fakta hasil aturan deterministic:

```text
If Person owns > 25% of Company, Person is BeneficialOwner of Company.
```

Model:

```text
(:Person)-[:BENEFICIAL_OWNER_OF {
  derived: true,
  rule: 'ownership_percentage_gt_25',
  derivedAt: datetime()
}]->(:Company)
```

### 12.3 Inferred fact

Fakta hasil reasoning atau model probabilistik:

```text
Person likely controls Company because of shared address, phone, transaction patterns, and director overlap.
```

Model:

```text
(:Person)-[:LIKELY_CONTROLS {
  inferred: true,
  confidence: 0.81,
  method: 'network_risk_model_v3',
  usableForDecision: false
}]->(:Company)
```

### 12.4 Predicted fact

Fakta yang belum diketahui tetapi diprediksi:

```text
Company C may be related to fraud cluster F.
```

Model:

```text
(:Company)-[:PREDICTED_MEMBER_OF {
  score: 0.67,
  model: 'community_link_prediction_v2',
  status: 'NEEDS_REVIEW'
}]->(:RiskCluster)
```

### 12.5 Do not collapse these categories

Jangan jadikan semuanya `RELATED_TO`.

Lebih defensible:

```text
DIRECTOR_OF          explicit
BENEFICIAL_OWNER_OF  derived deterministic
LIKELY_CONTROLS      inferred probabilistic
PREDICTED_MEMBER_OF  model prediction
```

---

## 13. Rule-Based Inference in Property Graph

Neo4j/Cypher bisa menjalankan inference praktis dengan query rules.

### 13.1 Example: beneficial ownership rule

Rule:

```text
If Person owns Company with percentage >= 25, create BeneficialOwnership fact.
```

Cypher:

```cypher
MATCH (p:Person)-[r:OWNS]->(c:Company)
WHERE r.percentage >= 25
MERGE (p)-[bo:BENEFICIAL_OWNER_OF]->(c)
SET bo.derived = true,
    bo.rule = 'ownership_percentage_gte_25',
    bo.derivedAt = datetime(),
    bo.sourceRelationshipId = elementId(r)
```

### 13.2 Example: indirect control

Rule:

```text
If Person owns Company A, and Company A owns Company B, then Person may indirectly control Company B.
```

Cypher:

```cypher
MATCH path = (p:Person)-[:OWNS|CONTROLS*2..3]->(c:Company)
WHERE all(rel IN relationships(path) WHERE coalesce(rel.percentage, 100) >= 25)
MERGE (p)-[ic:INDIRECTLY_CONTROLS]->(c)
SET ic.derived = true,
    ic.rule = 'control_chain_depth_2_3',
    ic.depth = length(path),
    ic.derivedAt = datetime()
```

Warning:

1. path explosion bisa terjadi,
2. threshold harus jelas,
3. cycles harus dikontrol,
4. result harus dapat diaudit,
5. derived relationship harus bisa dihapus/recompute.

### 13.3 Derived edge should be rebuildable

Derived relationship sebaiknya dianggap projection, bukan source of truth.

Prinsip:

```text
Source facts are authoritative.
Derived facts are reproducible.
```

Simpan metadata:

```text
ruleVersion
inputSnapshot
derivedAt
jobId
sourceFactIds
```

---

## 14. Inference Boundary: Hal yang Tidak Boleh Dianggap Otomatis

Knowledge graph sering membuat engineer overconfident.

### 14.1 “Connected” tidak berarti “causally related”

Jika dua entity punya alamat yang sama:

```text
Person A --HAS_ADDRESS--> Address X <--HAS_ADDRESS-- Person B
```

Tidak otomatis berarti mereka bekerja sama.

Possible explanations:

1. family relationship,
2. apartment building,
3. virtual office,
4. old address,
5. typo,
6. fraud ring,
7. coincidence.

Graph menunjukkan candidate connection, bukan causality.

### 14.2 “Shortest path” tidak berarti “strongest explanation”

Path pendek bisa irrelevant.

```text
Company A -> registered at -> Jakarta -> contains -> Company B
```

Path ini pendek tetapi semantically weak.

Path lebih panjang mungkin lebih meaningful:

```text
Company A -> owned by -> Person P -> director of -> Company B -> received funds from -> Company A
```

### 14.3 “Central” tidak berarti “guilty”

Centrality score tinggi bisa berarti:

1. legitimate hub,
2. data artifact,
3. popular address,
4. service provider,
5. investigator-created linkage,
6. actual suspicious actor.

Graph analytics harus dipakai sebagai signal, bukan verdict.

### 14.4 “Inferred” tidak berarti “verified”

Inferred relationship harus punya status berbeda.

Contoh query enforcement-safe:

```cypher
MATCH (p:Person)-[r:BENEFICIAL_OWNER_OF]->(c:Company)
WHERE r.status = 'VERIFIED'
  AND r.usableForEnforcementAction = true
RETURN p, c
```

Exploration query boleh lebih luas:

```cypher
MATCH path = (p:Person)-[*1..3]-(x)
RETURN path
LIMIT 100
```

Namun output exploration tidak boleh langsung menjadi keputusan.

---

## 15. Knowledge Graph Design for Regulatory/Enforcement Systems

Untuk sistem enforcement lifecycle, knowledge graph harus mendukung:

1. investigation,
2. risk discovery,
3. case linkage,
4. evidence traceability,
5. escalation logic,
6. defensible decision,
7. audit reconstruction,
8. access control,
9. data retention,
10. explainability.

### 15.1 Core domain nodes

```text
Person
Organization
Company
Account
Address
Phone
Email
License
Case
Allegation
Evidence
Finding
Decision
Regulation
ConductType
RiskSignal
SourceRecord
Claim
Fact
Reviewer
Unit
Action
```

### 15.2 Core relationships

```text
OWNS
CONTROLS
DIRECTOR_OF
AUTHORIZED_SIGNATORY_OF
HAS_ADDRESS
USES_PHONE
USES_EMAIL
TRANSFERRED_TO
SUBJECT_OF
ALLEGES
SUPPORTED_BY
DERIVED_FROM
VIOLATES
BASED_ON
ESCALATED_TO
REVIEWED_BY
SUPERSEDED_BY
CONTRADICTS
GOVERNED_BY
```

### 15.3 Evidence-to-decision chain

A defensible chain:

```text
SourceRecord -> Evidence -> Claim -> Fact -> Finding -> Decision -> Action
```

Graph shape:

```text
(:SourceRecord)-[:EXTRACTED_AS]->(:Evidence)
(:Evidence)-[:SUPPORTS]->(:Claim)
(:Claim)-[:ASSERTS]->(:Fact)
(:Fact)-[:SUPPORTS]->(:Finding)
(:Finding)-[:BASIS_FOR]->(:Decision)
(:Decision)-[:AUTHORIZES]->(:EnforcementAction)
```

This gives you audit path:

```cypher
MATCH path =
  (a:EnforcementAction)<-[:AUTHORIZES]-(d:Decision)<-[:BASIS_FOR]-
  (f:Finding)<-[:SUPPORTS]-(fact:Fact)<-[:ASSERTS]-
  (claim:Claim)<-[:SUPPORTS]-(e:Evidence)<-[:EXTRACTED_AS]-(sr:SourceRecord)
WHERE a.id = $actionId
RETURN path
```

### 15.4 Why this matters

Without evidence-to-decision graph, you may have:

```text
Case has status ENFORCED.
Person has risk HIGH.
```

But you cannot answer:

1. Why was risk high?
2. Which evidence supported it?
3. Which evidence was available at decision time?
4. Which finding mapped to which regulation?
5. Which officer reviewed it?
6. Which source has been superseded?
7. Was any evidence disputed?

For regulated environments, that is not enough.

---

## 16. Ontology Modelling in Neo4j Property Graph

Neo4j does not force you into a formal ontology model, but you can model ontology concepts explicitly.

### 16.1 Concept nodes

```cypher
CREATE (:Concept {code: 'PERSON', name: 'Person'})
CREATE (:Concept {code: 'LEGAL_ENTITY', name: 'Legal Entity'})
CREATE (:Concept {code: 'COMPANY', name: 'Company'})
CREATE (:Concept {code: 'BENEFICIAL_OWNER', name: 'Beneficial Owner'})
```

Relationships:

```cypher
MATCH (company:Concept {code:'COMPANY'}), (legal:Concept {code:'LEGAL_ENTITY'})
CREATE (company)-[:SUBTYPE_OF]->(legal)
```

### 16.2 Entity-to-concept classification

```cypher
MATCH (c:Company {companyId:'COMP-001'}), (concept:Concept {code:'COMPANY'})
MERGE (c)-[:INSTANCE_OF]->(concept)
```

But in property graph, labels often already encode class:

```text
(:Company)
```

So when should you use concept nodes?

Use concept nodes when:

1. classes are dynamic/configurable,
2. business users manage taxonomy,
3. hierarchy matters at runtime,
4. one entity may be classified in many ways,
5. classifications have validity/provenance,
6. ontology is part of data product.

Use labels when:

1. class is stable and technical,
2. index/constraint/query performance matters,
3. entity type is central to schema,
4. classification is not user-managed.

Often you use both:

```text
(:Company)-[:CLASSIFIED_AS]->(:IndustryCode)
(:Company)-[:INSTANCE_OF]->(:Concept {code:'LEGAL_ENTITY'})
```

### 16.3 Relationship type concepts

You can also model relationship types as concepts:

```text
(:RelationshipConcept {code:'BENEFICIAL_OWNER_OF'})
(:RelationshipConcept {code:'CONTROLS'})
(:RelationshipConcept {code:'BENEFICIAL_OWNER_OF'})-[:SUBTYPE_OF]->(:RelationshipConcept {code:'CONTROLS'})
```

This helps governance:

```text
Which relationship types imply control?
Which relationship types are admissible as evidence?
Which relationship types require review?
```

---

## 17. Classification and Controlled Taxonomies

### 17.1 Industry classification example

```text
(:Company)-[:HAS_INDUSTRY]->(:IndustryCode {code:'6419', scheme:'ISIC'})
(:IndustryCode {code:'6419'})-[:SUBTYPE_OF]->(:IndustryCode {code:'64'})
```

Query roll-up:

```cypher
MATCH (c:Company)-[:HAS_INDUSTRY]->(leaf:IndustryCode)-[:SUBTYPE_OF*0..]->(parent:IndustryCode {code:'64'})
RETURN c
```

### 17.2 Conduct classification example

```text
(:Finding)-[:CLASSIFIED_AS]->(:ConductType {code:'MARKET_MANIPULATION'})
(:ConductType {code:'MARKET_MANIPULATION'})-[:SUBTYPE_OF]->(:ConductType {code:'FINANCIAL_MISCONDUCT'})
```

Query:

```cypher
MATCH (case:Case)-[:HAS_FINDING]->(f:Finding)-[:CLASSIFIED_AS]->(ct:ConductType)
MATCH (ct)-[:SUBTYPE_OF*0..]->(:ConductType {code:'FINANCIAL_MISCONDUCT'})
RETURN case, f
```

### 17.3 Taxonomy governance

Taxonomy changes can affect historical interpretation.

Questions:

1. If a code is renamed, do old cases change?
2. If a category is split, how are old findings mapped?
3. If a regulation changes, do previous decisions remain under old taxonomy?
4. Do taxonomy nodes need `validFrom`/`validTo`?

For audit-heavy systems, taxonomy itself needs versioning.

---

## 18. Knowledge Graph and GraphRAG

Part 025 discussed GraphRAG from vector/embedding angle. Here we look from knowledge semantics angle.

### 18.1 Plain RAG retrieval

Plain vector RAG usually retrieves chunks:

```text
question -> embedding -> similar text chunks -> LLM answer
```

Risk:

1. chunk may mention entity ambiguously,
2. relationship may be implicit,
3. source may conflict,
4. temporal validity may be ignored,
5. answer may lack audit path.

### 18.2 Knowledge graph grounded retrieval

GraphRAG retrieval can do:

```text
question -> identify entities -> retrieve graph neighborhood -> filter by relation type/status/time/source -> include evidence -> generate answer
```

Example:

```cypher
MATCH (p:Person {name:$name})-[r:BENEFICIAL_OWNER_OF|DIRECTOR_OF|CONTROLS]->(c:Company)
WHERE r.status IN ['VERIFIED', 'ASSERTED']
MATCH (rFact:Fact)-[:REPRESENTS_RELATIONSHIP]->(r)
MATCH (e:Evidence)-[:SUPPORTS]->(rFact)
RETURN p, type(r), r, c, e
```

Neo4j GraphRAG tooling includes RAG user guide and knowledge graph builder guidance, including creating a knowledge graph from unstructured data.

### 18.3 GraphRAG requires semantic discipline

Bad graph leads to bad GraphRAG.

If graph has:

```text
RELATED_TO everywhere
no provenance
no status
no temporal validity
no source authority
no entity resolution confidence
```

Then GraphRAG will generate fluent but weak answers.

Good GraphRAG needs:

1. entity grounding,
2. relationship semantics,
3. source traceability,
4. confidence/status handling,
5. temporal filtering,
6. evidence retrieval,
7. answer constraints,
8. audit path output.

### 18.4 Answer should expose graph path

For high-stakes systems, answer format should include:

```text
Conclusion:
Ari is currently treated as a beneficial owner of Company X.

Basis:
- Registry record REG-123 asserts 35% ownership.
- Evidence E-991 supports the ownership claim.
- Ownership was valid from 2023-01-01 and has no validTo date.
- The claim was verified by reviewer R-17 on 2026-05-10.

Graph path:
Ari -[BENEFICIAL_OWNER_OF]-> Company X <-[ABOUT]- Fact <-[SUPPORTS]- Evidence <-[EXTRACTED_AS]- SourceRecord

Limitations:
No contradictory verified claim found as of 2026-06-22.
```

This is much more defensible than:

```text
Ari appears related to Company X.
```

---

## 19. Governance: Knowledge Graph as a Living System

Knowledge graph is not a one-time model. It evolves.

### 19.1 Governance objects

Model governance explicitly:

```text
(:OntologyVersion)
(:TaxonomyVersion)
(:RuleVersion)
(:SourceSystem)
(:DataQualityRule)
(:ReviewWorkflow)
(:UsagePolicy)
(:RetentionPolicy)
(:AccessPolicy)
```

### 19.2 Source authority

Not all sources are equal.

Example:

```text
Company registry > scraped website for legal directors
Court judgment > news article for adjudicated violation
Internal investigation note > external rumor for case finding
Sanction authority list > third-party compiled list
```

Model source authority:

```cypher
CREATE (:SourceSystem {
  code: 'COMPANY_REGISTRY',
  authorityLevel: 'AUTHORITATIVE_FOR_COMPANY_DIRECTORS',
  trustTier: 1
})
```

### 19.3 Policy-driven usage

A fact can be useful for investigation but not for enforcement.

```text
Investigation exploration: may use inferred facts.
Risk prioritization: may use scored facts with threshold.
Formal decision: requires verified facts and supporting evidence.
External disclosure: requires approved facts only.
```

Represent it:

```text
(:Fact)-[:ALLOWED_FOR]->(:UseCase {code:'INVESTIGATION_EXPLORATION'})
(:Fact)-[:NOT_ALLOWED_FOR]->(:UseCase {code:'FORMAL_ENFORCEMENT_DECISION'})
```

Or as properties for simpler systems.

---

## 20. Query Patterns for Knowledge Graphs

### 20.1 Find all evidence supporting a decision

```cypher
MATCH path =
  (d:Decision {id:$decisionId})<-[:BASIS_FOR]-(f:Finding)<-[:SUPPORTS]-
  (fact:Fact)<-[:ASSERTS]-(claim:Claim)<-[:SUPPORTS]-(e:Evidence)
RETURN path
```

### 20.2 Find claims with conflicting evidence

```cypher
MATCH (c1:Claim)-[:CONTRADICTS]-(c2:Claim)
MATCH (e1:Evidence)-[:SUPPORTS]->(c1)
MATCH (e2:Evidence)-[:SUPPORTS]->(c2)
RETURN c1, collect(DISTINCT e1) AS evidenceForC1,
       c2, collect(DISTINCT e2) AS evidenceForC2
```

### 20.3 Find active beneficial owners at a date

```cypher
MATCH (p:Person)-[r:BENEFICIAL_OWNER_OF]->(c:Company {companyId:$companyId})
WHERE r.validFrom <= $asOf
  AND (r.validTo IS NULL OR r.validTo > $asOf)
  AND r.status IN ['VERIFIED', 'ASSERTED']
RETURN p, r, c
```

### 20.4 Find inferred facts requiring review

```cypher
MATCH (a)-[r]->(b)
WHERE r.status = 'INFERRED'
  AND coalesce(r.requiresHumanReview, true) = true
  AND coalesce(r.reviewed, false) = false
RETURN a, type(r), r, b
ORDER BY r.confidence DESC
LIMIT 100
```

### 20.5 Find taxonomy roll-up cases

```cypher
MATCH (case:Case)-[:HAS_FINDING]->(f:Finding)-[:CLASSIFIED_AS]->(ct:ConductType)
MATCH (ct)-[:SUBTYPE_OF*0..]->(:ConductType {code:$parentConductCode})
RETURN case, collect(DISTINCT f) AS findings
```

---

## 21. Java Architecture for Knowledge Graph Systems

A Java service should not treat knowledge graph as generic persistence.

### 21.1 Suggested package boundaries

```text
com.example.knowledgegraph
  ├── domain
  │   ├── entity
  │   ├── fact
  │   ├── evidence
  │   ├── claim
  │   └── ontology
  ├── application
  │   ├── command
  │   ├── query
  │   ├── service
  │   └── workflow
  ├── infrastructure
  │   ├── neo4j
  │   ├── repository
  │   ├── projection
  │   └── migration
  └── governance
      ├── policy
      ├── validation
      └── audit
```

### 21.2 Command examples

```java
public record AssertOwnershipCommand(
    String sourceRecordId,
    String personId,
    String companyId,
    double percentage,
    LocalDate validFrom,
    LocalDate validTo,
    String evidenceId
) {}
```

Command handler responsibilities:

1. validate source exists,
2. validate person/company identity,
3. create or update claim/fact,
4. attach evidence,
5. derive relationship if policy allows,
6. record audit event,
7. avoid duplicate facts.

### 21.3 Query object examples

```java
public record DecisionEvidenceQuery(String decisionId) {}
public record ActiveOwnershipQuery(String companyId, LocalDate asOf) {}
public record RelatedEntitiesQuery(String entityId, int maxDepth, Set<String> allowedRelations) {}
```

Do not expose arbitrary graph traversal from API without guardrails.

### 21.4 Output DTO should include explanation

```java
public record OwnershipResult(
    String personId,
    String companyId,
    double percentage,
    String status,
    double confidence,
    LocalDate validFrom,
    LocalDate validTo,
    List<EvidenceSummary> evidence,
    List<String> graphPathDescriptions,
    List<String> limitations
) {}
```

A knowledge graph API should return not only facts, but basis.

---

## 22. Data Quality Rules

Knowledge graph quality is not just “no nulls”.

### 22.1 Structural rules

Examples:

```text
Every Fact must have at least one source.
Every EnforcementDecision must be based on at least one Finding.
Every Finding must be supported by Evidence.
Every verified relationship must have reviewer metadata.
Every derived relationship must have ruleVersion.
Every inferred relationship must have confidence and method.
```

### 22.2 Cypher validation examples

Find facts without source:

```cypher
MATCH (f:Fact)
WHERE NOT (f)<-[:ASSERTS]-(:Claim)
  AND NOT (f)<-[:ASSERTS]-(:SourceRecord)
RETURN f
```

Find verified facts without reviewer:

```cypher
MATCH (f:Fact {status:'VERIFIED'})
WHERE NOT (f)-[:REVIEWED_BY]->(:Reviewer)
RETURN f
```

Find derived facts without rule version:

```cypher
MATCH (f:Fact)
WHERE f.derived = true
  AND f.ruleVersion IS NULL
RETURN f
```

### 22.3 Quality as graph

Model quality findings:

```text
(:DataQualityIssue)-[:AFFECTS]->(:Fact)
(:DataQualityIssue)-[:DETECTED_BY]->(:DataQualityRule)
(:DataQualityIssue)-[:ASSIGNED_TO]->(:Steward)
```

This lets data governance operate on graph itself.

---

## 23. Versioning Ontology and Rules

### 23.1 Why version ontology?

Because meanings change.

Example:

```text
Before 2025, beneficial ownership threshold = 25%.
After 2025, threshold = 10% for high-risk sectors.
```

If you recompute old decisions with new rule silently, audit breaks.

### 23.2 Rule version modelling

```text
(:Rule {code:'BENEFICIAL_OWNERSHIP_THRESHOLD'})
(:RuleVersion {version:'2024.1', threshold:25, validFrom:'2024-01-01', validTo:'2025-01-01'})
(:RuleVersion {version:'2025.1', threshold:10, validFrom:'2025-01-01'})
```

Derived fact:

```text
(:Fact)-[:DERIVED_USING]->(:RuleVersion {version:'2025.1'})
```

### 23.3 Query decision with historical rule

```cypher
MATCH (d:Decision {id:$decisionId})<-[:BASIS_FOR]-(f:Finding)<-[:SUPPORTS]-(fact:Fact)
OPTIONAL MATCH (fact)-[:DERIVED_USING]->(rv:RuleVersion)
RETURN d, f, fact, rv
```

---

## 24. Common Anti-Patterns

### 24.1 Ontology theater

Creating many abstract nodes:

```text
Concept, MetaConcept, SemanticClass, MetaRelationship
```

But no operational query uses them.

Fix:

1. define use cases,
2. define what ontology changes at runtime,
3. keep stable technical types as labels,
4. avoid meta-model unless needed.

### 24.2 Everything is a Fact node

Reifying every relationship makes query painful.

Bad if:

1. simple lookup becomes 5-hop traversal,
2. no relationship is directly traversable,
3. performance suffers,
4. developers avoid the model.

Use direct relationship for hot traversal; use Fact node only where provenance/lifecycle requires.

Hybrid:

```text
(:Person)-[:DIRECTOR_OF]->(:Company)              // hot traversal
(:DirectorFact)-[:SUBJECT]->(:Person)             // audit/provenance
(:DirectorFact)-[:OBJECT]->(:Company)
(:DirectorFact)-[:REPRESENTED_BY]->(:DIRECTOR_OF edge conceptually)
```

Since Neo4j relationships cannot be directly targeted, keep a shared fact ID on relationship and fact node:

```cypher
CREATE (p)-[:DIRECTOR_OF {factId:'FACT-001'}]->(c)
CREATE (:DirectorFact {factId:'FACT-001'})
```

### 24.3 Everything is `RELATED_TO`

This kills semantics.

Fix:

1. define relationship taxonomy,
2. reserve `RELATED_TO` for derived summaries only,
3. require source relation for every summary edge.

### 24.4 Inference without lineage

Creating derived relationships without source/rule metadata makes them indistinguishable from explicit facts.

Fix:

```text
derived=true
ruleCode
ruleVersion
derivedAt
sourceFactIds
confidence/status
```

### 24.5 Treating LLM extraction as verified knowledge

LLM-extracted triples are claims, not facts.

Correct pipeline:

```text
Document -> ExtractedClaim -> Review/Validation -> Fact -> Derived relationship
```

Not:

```text
Document -> LLM -> Verified graph
```

---

## 25. Practical Design Checklist

Before calling your Neo4j graph a knowledge graph, verify:

### 25.1 Semantic clarity

```text
[ ] Relationship types have clear domain meaning.
[ ] Labels represent stable entity categories.
[ ] Controlled vocabularies exist for statuses/types.
[ ] Taxonomy hierarchy is explicit where needed.
[ ] Domain experts can read core paths.
```

### 25.2 Provenance

```text
[ ] Important facts have source.
[ ] Evidence can be traced to facts/findings/decisions.
[ ] Source authority is represented.
[ ] ImportedAt/sourcePublishedAt/validFrom are distinguished where needed.
```

### 25.3 Confidence and lifecycle

```text
[ ] Asserted, verified, inferred, disputed, expired facts are separated.
[ ] Confidence has method/model/version.
[ ] Human review state is represented.
[ ] Decision-safe facts are distinguishable from exploration-only facts.
```

### 25.4 Temporal correctness

```text
[ ] Facts have valid time where domain requires.
[ ] Decision-time reconstruction is possible.
[ ] Superseded facts are retained where audit requires.
[ ] Taxonomy/rule versioning is handled.
```

### 25.5 Inference boundary

```text
[ ] Derived relationships are marked and reproducible.
[ ] Inferred relationships are not treated as verified facts.
[ ] Graph analytics scores are not treated as legal conclusions.
[ ] Rules have versions.
[ ] Generated/LLM facts require validation.
```

### 25.6 Operational practicality

```text
[ ] Hot traversal paths are not over-reified.
[ ] Indexes/constraints support entity lookup.
[ ] Quality validation queries exist.
[ ] Rebuild process exists for derived graph.
[ ] Query API has traversal guardrails.
```

---

## 26. Mini Case Study: Enforcement Knowledge Graph

### 26.1 Problem

A regulator wants to answer:

> “Which companies are connected to a sanctioned person through ownership, directorship, or control relationships, and which enforcement cases relied on those connections?”

### 26.2 Naive graph

```text
Person --RELATED_TO--> Company
Company --RELATED_TO--> Case
```

This is not defensible.

Problems:

1. relation meaning unclear,
2. source missing,
3. temporal validity missing,
4. evidence missing,
5. decision basis missing,
6. inferred and verified facts mixed.

### 26.3 Better graph

```text
(:Person {sanctioned:true})
  -[:BENEFICIAL_OWNER_OF {validFrom, validTo, status, confidence, factId}]->
(:Company)

(:DirectorFact {factId})
  -[:SUBJECT]->(:Person)
  -[:OBJECT]->(:Company)
  -[:SUPPORTED_BY]->(:Evidence)
  -[:ASSERTED_BY]->(:SourceRecord)
  -[:DERIVED_USING]->(:RuleVersion)

(:Case)-[:HAS_FINDING]->(:Finding)
(:Finding)-[:SUPPORTED_BY]->(:Fact)
(:Decision)-[:BASED_ON]->(:Finding)
```

### 26.4 Query

```cypher
MATCH path = (p:Person {sanctioned:true})-[r:BENEFICIAL_OWNER_OF|DIRECTOR_OF|CONTROLS*1..3]->(c:Company)
WHERE all(rel IN relationships(path)
  WHERE rel.status IN ['VERIFIED', 'ASSERTED']
    AND rel.validFrom <= $asOf
    AND (rel.validTo IS NULL OR rel.validTo > $asOf)
)
OPTIONAL MATCH (case:Case)-[:HAS_FINDING]->(finding:Finding)-[:SUPPORTED_BY]->(fact:Fact)
WHERE fact.factId IN [rel IN relationships(path) | rel.factId]
OPTIONAL MATCH (decision:Decision)-[:BASED_ON]->(finding)
RETURN p, c, path, collect(DISTINCT case) AS cases, collect(DISTINCT decision) AS decisions
```

### 26.5 Interpretation

The query returns candidate connections. A defensible workflow would still:

1. show evidence,
2. show fact status,
3. show source authority,
4. show temporal validity,
5. show whether relationship is direct/derived/inferred,
6. require reviewer confirmation before enforcement action.

---

## 27. What You Should Now Understand

After this part, you should be able to explain:

1. why graph database is not automatically knowledge graph,
2. difference between schema, taxonomy, vocabulary, and ontology,
3. property graph vs RDF/OWL trade-offs,
4. why provenance matters,
5. when to reify relationship as fact node,
6. how confidence/status/temporal validity affect correctness,
7. how to model contradiction,
8. difference between explicit, derived, inferred, and predicted facts,
9. why connectedness is not causality,
10. how to make GraphRAG more grounded,
11. how to design knowledge graph for enforcement/regulatory systems,
12. how to avoid ontology theater and `RELATED_TO` hell.

---

## 28. Key Takeaways

1. **Knowledge graph is semantic discipline, not just graph storage.**
2. **Relationship type is domain language. Treat it seriously.**
3. **Provenance is mandatory for defensibility.**
4. **Temporal validity is not optional in historical/regulatory domains.**
5. **Confidence score is not truth.**
6. **Inferred facts must not be mixed with verified facts.**
7. **Ontology should serve queries, workflows, and governance—not impress architects.**
8. **LLM extraction produces claims, not verified knowledge.**
9. **GraphRAG is only as good as graph semantics.**
10. **For enforcement systems, every decision should have an evidence path.**

---

## 29. References

- Neo4j Documentation — Graph database concepts: nodes, relationships, properties, labels, and relationship types.
- Neo4j Use Case — Knowledge Graphs.
- Neo4j neosemantics/n10s documentation: RDF, OWL, RDFS, SKOS, SHACL, and basic inferencing in Neo4j.
- Neo4j GraphRAG Python documentation: RAG and Knowledge Graph Builder.
- Neo4j Cypher Manual: property graph concepts and query patterns.

---

## 30. Next Part

Part berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-027.md
```

Topik:

```text
Domain Case Study: Fraud, Risk, Enforcement, and Investigation Graph
```

Di Part 027, kita akan memakai seluruh konsep sebelumnya untuk membangun case study end-to-end yang dekat dengan sistem enforcement lifecycle dan complex case management: entity, case, evidence, risk signal, investigation workflow, related party discovery, conflict of interest, repeat offender detection, escalation, dan defensible decision support.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — Graph Embeddings, Vector Indexes, and GenAI/RAG with Neo4j</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-027.md">Part 027 — Domain Case Study: Fraud, Risk, Enforcement, and Investigation Graph ➡️</a>
</div>
