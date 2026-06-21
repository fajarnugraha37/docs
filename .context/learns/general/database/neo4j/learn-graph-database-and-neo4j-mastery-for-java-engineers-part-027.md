# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-027

# Part 027 — Domain Case Study: Fraud, Risk, Enforcement, and Investigation Graph

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin mampu mendesain graph database system secara production-grade, defensible, dan bukan hanya bisa menulis Cypher.  
> Fokus part ini: menerapkan seluruh konsep sebelumnya ke satu domain kompleks: fraud, risk, enforcement, dan investigation graph.

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya sudah membahas:

1. mental model graph database,
2. property graph model,
3. Neo4j architecture,
4. Cypher fundamentals,
5. path semantics,
6. graph modelling methodology,
7. advanced modelling patterns,
8. anti-pattern modelling,
9. schema, constraints, indexes,
10. write correctness,
11. query performance,
12. supernodes,
13. Java integration,
14. Spring Data Neo4j,
15. import/CDC/projection pipeline,
16. transaction/correctness,
17. operations,
18. clustering,
19. security/regulatory defensibility,
20. APOC/tooling,
21. GDS fundamentals,
22. centrality,
23. community/similarity/link prediction,
24. path finding,
25. graph embeddings/vector/GraphRAG,
26. knowledge graph/ontology/semantics.

Part ini menggabungkan semua itu ke dalam satu case study nyata:

> Bagaimana mendesain Neo4j untuk fraud, risk, enforcement, dan investigation system yang harus bisa menjawab pertanyaan network-level, mendukung investigator, memberi skor risiko, menjaga auditability, dan tetap aman secara operasional.

Ini bukan contoh “toy graph”. Kita akan memperlakukan domain ini seperti sistem enterprise yang punya:

- source-of-truth eksternal,
- multi-entity relationships,
- temporal facts,
- evidence/provenance,
- case workflow,
- access control,
- audit trail,
- risk scoring,
- graph analytics,
- false positive management,
- human-in-the-loop review,
- regulatory defensibility.

---

## 1. Mengapa Fraud, Risk, dan Enforcement Cocok Untuk Graph

Fraud/risk/enforcement biasanya gagal jika dilihat sebagai record terisolasi.

Satu transaksi mencurigakan belum tentu fraud.

Satu alamat dipakai banyak akun belum tentu fraud.

Satu perusahaan punya banyak director belum tentu fraud.

Satu nomor telepon dipakai beberapa account belum tentu fraud.

Tetapi kombinasi hubungan bisa mengubah interpretasi:

```text
Person A
  owns Account X
  shares Device D with Person B
  transacts repeatedly with Merchant M
  where Merchant M is controlled by Organization O
  where Organization O is linked to previously sanctioned Person C
  where Person C appears in closed enforcement case E
```

Di relational system, pertanyaan seperti ini berubah menjadi join chain, recursive CTE, materialized view, atau custom graph logic di application layer.

Di graph database, pertanyaan tersebut menjadi traversal dan pattern matching.

### 1.1 Inti Masalahnya Bukan “Banyak Data”

Fraud/risk system sering punya data besar, tetapi alasan memilih graph bukan hanya volume.

Alasan memilih graph adalah:

1. hubungan antar-entity adalah sinyal utama,
2. path antar-entity punya makna investigatif,
3. indirect relationship sering lebih penting daripada direct attribute,
4. network pattern lebih penting daripada row-level filter,
5. investigator butuh explanation path,
6. hidden collusion sering muncul sebagai community/cluster,
7. ownership/control sering multi-hop,
8. evidence chain harus bisa ditelusuri.

Graph bukan dipilih karena “data besar”. Graph dipilih karena “relasi membawa arti”.

---

## 2. Problem Statement

Kita akan mendesain sistem bernama:

```text
Regulatory Investigation Graph Platform
```

Tujuannya:

1. menghubungkan person, organization, account, transaction, case, allegation, evidence, regulation, action, dan officer;
2. membantu investigator menemukan related parties, shared identifiers, ownership/control chain, dan suspicious communities;
3. mendukung risk scoring berbasis graph features;
4. membuat decision support yang explainable;
5. menjaga provenance setiap fakta;
6. mendukung audit dan regulatory defensibility;
7. menjaga query tetap aman dari traversal explosion;
8. menjaga isolation antar tenant/jurisdiction bila diperlukan.

### 2.1 Yang Bukan Tujuan

Platform ini bukan:

- source-of-truth utama untuk semua transaksi mentah,
- data warehouse OLAP,
- event streaming platform,
- full-text search engine utama,
- workflow engine penuh,
- machine learning platform tunggal,
- document management system,
- authorization engine universal.

Graph ini adalah **connected intelligence layer**.

Ia mengambil data dari source-of-truth lain, membentuk network representation, lalu menyediakan query, analytics, dan explanation yang relationship-heavy.

---

## 3. Domain Mental Model

Dalam domain enforcement/investigation, ada beberapa lapisan berbeda:

```text
Observed world
  └─ raw facts: transactions, filings, reports, logs, documents

Resolved entity world
  └─ person, organization, account, asset, address, device

Relationship world
  └─ owns, controls, shares, transacts, associated_with, located_at

Case world
  └─ case, allegation, investigation step, enforcement action

Evidence world
  └─ evidence, source, document, observation, confidence, provenance

Decision world
  └─ risk score, recommendation, escalation, final decision, rationale
```

Kesalahan modelling umum adalah mencampur semua lapisan ini menjadi satu bentuk graph datar.

Contoh buruk:

```text
(:Person)-[:HAS]->(:Transaction)-[:HAS]->(:Case)-[:HAS]->(:Document)
```

Model seperti ini tidak menjelaskan semantics.

Model yang lebih baik membedakan:

- siapa entity-nya,
- apa faktanya,
- dari mana faktanya berasal,
- kapan valid,
- siapa yang menilai,
- bagaimana fakta dipakai dalam case.

---

## 4. Core Entity Types

Kita mulai dari entity utama.

### 4.1 Person

```cypher
(:Person {
  personId: 'P-1001',
  fullName: 'Jane Doe',
  dateOfBirth: date('1985-04-10'),
  nationality: 'ID',
  riskTier: 'MEDIUM',
  createdAt: datetime(),
  updatedAt: datetime()
})
```

Person merepresentasikan individu hasil resolusi entity, bukan setiap raw occurrence nama.

Jika ada variasi nama dari banyak sumber, jangan langsung simpan sebagai banyak `Person` final. Gunakan pattern entity resolution:

```text
(:PersonIdentityObservation)-[:RESOLVED_TO]->(:Person)
```

atau:

```text
(:SourceRecord)-[:MENTIONS]->(:Person)
```

tergantung kebutuhan provenance.

### 4.2 Organization

```cypher
(:Organization {
  organizationId: 'ORG-2001',
  legalName: 'Example Holdings Ltd',
  registrationNumber: 'REG-998877',
  jurisdiction: 'SG',
  status: 'ACTIVE'
})
```

Organization bisa perusahaan, NGO, trust, partnership, atau legal vehicle lain.

Dalam risk/enforcement graph, organization sering menjadi hub ownership/control.

### 4.3 Account

```cypher
(:Account {
  accountId: 'ACC-3001',
  accountType: 'BANK_ACCOUNT',
  maskedNumber: '****8899',
  status: 'ACTIVE'
})
```

Account bisa bank account, platform account, wallet, trading account, atau payment account.

Jangan simpan nomor sensitif penuh tanpa kontrol. Untuk graph traversal, sering cukup external ID/tokenized ID/masked ID.

### 4.4 Transaction

```cypher
(:Transaction {
  transactionId: 'TX-9001',
  amount: 15000000,
  currency: 'IDR',
  transactionTime: datetime('2026-06-21T10:15:00+07:00'),
  channel: 'ONLINE_TRANSFER',
  status: 'SETTLED'
})
```

Transaction bisa menjadi node jika:

- perlu dihubungkan ke banyak entity,
- punya evidence/provenance sendiri,
- perlu dianalisis sebagai bagian dari path,
- perlu disambungkan ke case/allegation,
- perlu dipakai untuk temporal pattern.

Jika hanya agregasi edge kecil, relationship property bisa cukup:

```text
(:Account)-[:TRANSFERRED_TO {amount, time, txId}]->(:Account)
```

Namun untuk investigation-grade graph, transaction sebagai node sering lebih aman karena auditability dan extensibility lebih tinggi.

### 4.5 Case

```cypher
(:Case {
  caseId: 'CASE-2026-00001',
  caseType: 'MARKET_ABUSE',
  status: 'OPEN',
  severity: 'HIGH',
  openedAt: datetime(),
  jurisdiction: 'ID'
})
```

Case bukan hanya container. Case adalah operational object yang menghubungkan:

- subjects,
- allegations,
- evidence,
- investigator,
- decision,
- enforcement action,
- related case,
- risk signal.

### 4.6 Allegation

```cypher
(:Allegation {
  allegationId: 'ALG-001',
  allegationType: 'BENEFICIAL_OWNERSHIP_CONCEALMENT',
  status: 'UNDER_REVIEW',
  confidence: 0.72
})
```

Allegation penting untuk membedakan:

- fakta objektif,
- dugaan,
- hasil analisis,
- keputusan final.

Jangan model semua hal sebagai fakta final.

### 4.7 Evidence

```cypher
(:Evidence {
  evidenceId: 'EV-001',
  evidenceType: 'DOCUMENT',
  sourceSystem: 'KYC_SYSTEM',
  sourceRef: 'DOC-12345',
  collectedAt: datetime(),
  hash: 'sha256:...',
  confidence: 0.95
})
```

Evidence adalah dasar defensibility.

Jika graph menghasilkan rekomendasi tanpa evidence chain, sistem akan sulit dipertanggungjawabkan.

### 4.8 Regulation / Rule

```cypher
(:Regulation {
  regulationId: 'REG-AML-001',
  name: 'Beneficial Ownership Disclosure Requirement',
  effectiveFrom: date('2024-01-01'),
  jurisdiction: 'ID'
})
```

Regulation/rule bisa dihubungkan ke allegation, case, decision, dan enforcement action.

### 4.9 Officer / Investigator

```cypher
(:Officer {
  officerId: 'OFF-007',
  name: 'Investigator A',
  unit: 'Financial Crime Unit'
})
```

Officer penting untuk workflow, accountability, conflict-of-interest, workload, dan audit.

### 4.10 Enforcement Action

```cypher
(:EnforcementAction {
  actionId: 'ACT-001',
  actionType: 'WARNING_LETTER',
  status: 'ISSUED',
  issuedAt: datetime()
})
```

Action adalah outcome atau step formal.

---

## 5. Core Relationship Types

Graph system hidup dari relationship semantics.

### 5.1 Identity and Association

```text
(:Person)-[:USES]->(:Account)
(:Person)-[:USES]->(:Device)
(:Person)-[:HAS_ADDRESS]->(:Address)
(:Organization)-[:REGISTERED_AT]->(:Address)
(:Person)-[:ASSOCIATED_WITH]->(:Person)
```

Relationship harus menjawab: “apa arti koneksi ini?”

`ASSOCIATED_WITH` terlalu umum jika dipakai berlebihan. Lebih baik gunakan type yang lebih spesifik bila semantics jelas:

```text
(:Person)-[:SPOUSE_OF]->(:Person)
(:Person)-[:DIRECTOR_OF]->(:Organization)
(:Person)-[:SHARES_DEVICE_WITH]->(:Person)
(:Person)-[:AUTHORIZED_SIGNATORY_OF]->(:Account)
```

### 5.2 Ownership and Control

```text
(:Person)-[:OWNS {percentage: 0.35, validFrom, validTo}]->(:Organization)
(:Organization)-[:OWNS {percentage: 0.60}]->(:Organization)
(:Person)-[:CONTROLS {controlType: 'VOTING_RIGHT'}]->(:Organization)
(:Organization)-[:CONTROLS]->(:Account)
```

Ownership dan control tidak sama.

Seseorang bisa tidak punya saham mayoritas tetapi punya control melalui:

- voting agreement,
- nominee arrangement,
- board influence,
- family network,
- contractual rights,
- shared device/account access,
- operational control.

### 5.3 Transaction Flow

Node transaction pattern:

```text
(:Account)-[:SENT]->(:Transaction)-[:RECEIVED_BY]->(:Account)
```

atau:

```text
(:Person)-[:INITIATED]->(:Transaction)
(:Transaction)-[:BENEFITS]->(:Organization)
```

Jika transaction sangat besar volumenya, jangan otomatis masukkan semua transaksi mentah ke Neo4j operational graph. Bisa gunakan:

- transaction subset yang relevant,
- aggregated flow edge,
- time-bucketed summary,
- suspicious transaction only,
- projection dari warehouse.

### 5.4 Case Relationships

```text
(:Case)-[:HAS_SUBJECT]->(:Person)
(:Case)-[:HAS_SUBJECT]->(:Organization)
(:Case)-[:INVESTIGATES]->(:Transaction)
(:Case)-[:HAS_ALLEGATION]->(:Allegation)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Case)-[:ASSIGNED_TO]->(:Officer)
(:Case)-[:RELATED_TO]->(:Case)
```

Case graph harus bisa menjawab:

- siapa subject utama,
- siapa related party,
- evidence apa yang mendukung allegation,
- regulation apa yang relevan,
- officer mana yang bertanggung jawab,
- case mana yang mirip atau terkait,
- action apa yang diambil.

### 5.5 Evidence and Provenance

```text
(:Evidence)-[:SUPPORTS]->(:Allegation)
(:Evidence)-[:OBSERVED]->(:Transaction)
(:Evidence)-[:MENTIONS]->(:Person)
(:Evidence)-[:DERIVED_FROM]->(:SourceRecord)
(:SourceRecord)-[:FROM_SYSTEM]->(:SourceSystem)
```

Jika suatu relationship penting secara hukum/regulasi, relationship itu juga perlu provenance.

Contoh:

```text
(:Person)-[:OWNS]->(:Organization)
```

Pertanyaan audit:

- dari mana kita tahu?
- dokumen mana yang mendukung?
- siapa yang memasukkan?
- kapan valid?
- apakah sudah diverifikasi?
- confidence berapa?

Untuk itu, bisa gunakan relationship property:

```cypher
(:Person)-[:OWNS {
  percentage: 0.35,
  sourceSystem: 'CORPORATE_REGISTRY',
  sourceRef: 'FILING-8899',
  confidence: 0.98,
  validFrom: date('2025-01-01'),
  validTo: null
}]->(:Organization)
```

Atau reified fact pattern:

```text
(:Person)-[:PARTY_IN]->(:OwnershipFact)<-[:PARTY_IN]-(:Organization)
(:OwnershipFact)-[:SUPPORTED_BY]->(:Evidence)
```

Gunakan reification jika fact perlu:

- banyak evidence,
- multiple claims,
- dispute handling,
- approval workflow,
- temporal versions,
- confidence evolution,
- legal defensibility.

---

## 6. Proposed Graph Schema

### 6.1 Labels

```text
:Person
:Organization
:Account
:Transaction
:Address
:Device
:PhoneNumber
:Email
:Case
:Allegation
:Evidence
:SourceRecord
:SourceSystem
:Regulation
:Rule
:RiskSignal
:RiskScore
:Officer
:Unit
:Decision
:EnforcementAction
:Review
:WatchlistEntry
:SanctionListEntry
```

### 6.2 Relationship Types

```text
USES
HAS_ADDRESS
HAS_PHONE
HAS_EMAIL
REGISTERED_AT
DIRECTOR_OF
OFFICER_OF
OWNS
CONTROLS
AUTHORIZED_SIGNATORY_OF
SENT
RECEIVED_BY
INITIATED
BENEFITS
MENTIONS
RESOLVED_TO
SUPPORTED_BY
DERIVED_FROM
HAS_SUBJECT
HAS_RELATED_PARTY
HAS_ALLEGATION
VIOLATES
ASSIGNED_TO
REVIEWED_BY
DECIDED_BY
RESULTED_IN
RELATED_TO
SIMILAR_TO
MEMBER_OF
PART_OF_COMMUNITY
HAS_RISK_SIGNAL
HAS_RISK_SCORE
ON_WATCHLIST
SANCTIONED_BY
```

### 6.3 Naming Rules

Gunakan relationship type sebagai verb phrase yang domain-specific.

Lebih baik:

```text
(:Person)-[:DIRECTOR_OF]->(:Organization)
```

Daripada:

```text
(:Person)-[:RELATED_TO {kind:'director'}]->(:Organization)
```

Namun jangan sampai relationship type explosion.

Jika type terlalu granular dan jarang dipakai, gunakan property.

Contoh balance:

```text
(:Person)-[:OFFICER_OF {role:'DIRECTOR'}]->(:Organization)
(:Person)-[:OFFICER_OF {role:'SECRETARY'}]->(:Organization)
```

lebih baik daripada:

```text
DIRECTOR_OF
SECRETARY_OF
TREASURER_OF
BOARD_OBSERVER_OF
ALTERNATE_DIRECTOR_OF
...
```

jika query biasanya memperlakukan semuanya sebagai officer relationship.

---

## 7. Constraints and Indexes

Production graph perlu constraints.

```cypher
CREATE CONSTRAINT person_id_unique IF NOT EXISTS
FOR (p:Person)
REQUIRE p.personId IS UNIQUE;

CREATE CONSTRAINT organization_id_unique IF NOT EXISTS
FOR (o:Organization)
REQUIRE o.organizationId IS UNIQUE;

CREATE CONSTRAINT account_id_unique IF NOT EXISTS
FOR (a:Account)
REQUIRE a.accountId IS UNIQUE;

CREATE CONSTRAINT transaction_id_unique IF NOT EXISTS
FOR (t:Transaction)
REQUIRE t.transactionId IS UNIQUE;

CREATE CONSTRAINT case_id_unique IF NOT EXISTS
FOR (c:Case)
REQUIRE c.caseId IS UNIQUE;

CREATE CONSTRAINT evidence_id_unique IF NOT EXISTS
FOR (e:Evidence)
REQUIRE e.evidenceId IS UNIQUE;
```

Indexes untuk access path:

```cypher
CREATE INDEX person_name_index IF NOT EXISTS
FOR (p:Person)
ON (p.fullName);

CREATE INDEX org_registration_index IF NOT EXISTS
FOR (o:Organization)
ON (o.registrationNumber);

CREATE INDEX case_status_index IF NOT EXISTS
FOR (c:Case)
ON (c.status);

CREATE INDEX case_jurisdiction_status_index IF NOT EXISTS
FOR (c:Case)
ON (c.jurisdiction, c.status);

CREATE INDEX tx_time_index IF NOT EXISTS
FOR (t:Transaction)
ON (t.transactionTime);

CREATE INDEX evidence_source_index IF NOT EXISTS
FOR (e:Evidence)
ON (e.sourceSystem, e.sourceRef);
```

### 7.1 Integrity Rules

Contoh invariant:

```text
Every Case must have at least one subject.
Every Allegation must be attached to exactly one Case.
Every enforcement decision must be linked to a Case.
Every derived risk signal must be linked to source evidence or algorithm run.
Every officer assignment must have validFrom.
```

Tidak semua invariant bisa ditegakkan oleh Neo4j constraint langsung. Sebagian perlu ditegakkan di:

- application service,
- ingestion pipeline,
- scheduled data quality job,
- Cypher validation query,
- CI test dataset,
- audit report.

---

## 8. Sample Data Model

Contoh small graph:

```cypher
MERGE (p1:Person {personId:'P-001'})
SET p1.fullName = 'Ari Santoso', p1.riskTier = 'HIGH'

MERGE (p2:Person {personId:'P-002'})
SET p2.fullName = 'Bima Hartono', p2.riskTier = 'MEDIUM'

MERGE (org1:Organization {organizationId:'ORG-001'})
SET org1.legalName = 'Nusantara Holdings Ltd', org1.jurisdiction = 'SG'

MERGE (org2:Organization {organizationId:'ORG-002'})
SET org2.legalName = 'Garuda Trading Pte Ltd', org2.jurisdiction = 'SG'

MERGE (acc1:Account {accountId:'ACC-001'})
SET acc1.accountType = 'BANK_ACCOUNT'

MERGE (acc2:Account {accountId:'ACC-002'})
SET acc2.accountType = 'BANK_ACCOUNT'

MERGE (dev1:Device {deviceId:'DEV-001'})
SET dev1.deviceType = 'MOBILE'

MERGE (case1:Case {caseId:'CASE-2026-001'})
SET case1.caseType = 'BENEFICIAL_OWNERSHIP',
    case1.status = 'OPEN',
    case1.severity = 'HIGH'

MERGE (ev1:Evidence {evidenceId:'EV-001'})
SET ev1.evidenceType = 'REGISTRY_FILING',
    ev1.sourceSystem = 'CORPORATE_REGISTRY',
    ev1.sourceRef = 'FILING-7788',
    ev1.confidence = 0.98

MERGE (p1)-[:OWNS {percentage:0.45, validFrom:date('2025-01-01')}]->(org1)
MERGE (org1)-[:OWNS {percentage:0.70, validFrom:date('2025-03-01')}]->(org2)
MERGE (p2)-[:DIRECTOR_OF {validFrom:date('2025-02-01')}]->(org2)
MERGE (p1)-[:USES]->(dev1)
MERGE (p2)-[:USES]->(dev1)
MERGE (p1)-[:USES]->(acc1)
MERGE (org2)-[:CONTROLS]->(acc2)
MERGE (case1)-[:HAS_SUBJECT]->(p1)
MERGE (case1)-[:HAS_RELATED_PARTY]->(p2)
MERGE (case1)-[:SUPPORTED_BY]->(ev1)
MERGE (ev1)-[:SUPPORTS]->(case1);
```

---

## 9. Query Catalogue: Investigator Questions

A production graph platform should not begin with random queries. It should define a query catalogue.

### 9.1 Find Direct Relationships Around a Subject

Question:

> “Show me everything directly connected to this person.”

```cypher
MATCH (p:Person {personId:$personId})-[r]-(n)
RETURN p, r, n
LIMIT 200;
```

Risk:

- high-degree subject can return too much,
- sensitive relationship leakage,
- `LIMIT` without ordering may hide important facts,
- visualization can mislead if incomplete.

Better:

```cypher
MATCH (p:Person {personId:$personId})-[r]-(n)
WHERE type(r) IN $allowedRelationshipTypes
RETURN labels(n) AS labels,
       type(r) AS relationshipType,
       count(*) AS count
ORDER BY count DESC;
```

First return summary, then let investigator expand selectively.

### 9.2 Find Shared Device / Address / Phone

Question:

> “Who shares identifiers with this subject?”

```cypher
MATCH (p:Person {personId:$personId})-[:USES|HAS_ADDRESS|HAS_PHONE|HAS_EMAIL]->(id)<-[:USES|HAS_ADDRESS|HAS_PHONE|HAS_EMAIL]-(other:Person)
WHERE other <> p
RETURN other.personId AS personId,
       other.fullName AS fullName,
       labels(id) AS sharedIdentifierType,
       id AS sharedIdentifier
LIMIT 100;
```

This detects weak association.

But not all shared identifiers are suspicious.

A shared corporate address may connect thousands of companies.

Add degree guard:

```cypher
MATCH (p:Person {personId:$personId})-[:USES|HAS_ADDRESS|HAS_PHONE|HAS_EMAIL]->(id)
WITH p, id, size((id)<-[:USES|HAS_ADDRESS|HAS_PHONE|HAS_EMAIL]-(:Person)) AS degree
WHERE degree <= $maxIdentifierDegree
MATCH (id)<-[:USES|HAS_ADDRESS|HAS_PHONE|HAS_EMAIL]-(other:Person)
WHERE other <> p
RETURN other, id, degree
ORDER BY degree ASC
LIMIT 100;
```

Low-degree shared identifiers are often more meaningful than high-degree shared identifiers.

### 9.3 Beneficial Ownership Chain

Question:

> “What organizations does this person ultimately control?”

```cypher
MATCH path = (p:Person {personId:$personId})-[:OWNS|CONTROLS*1..5]->(o:Organization)
RETURN path
LIMIT 100;
```

This is useful but dangerous.

Add constraints:

```cypher
MATCH path = (p:Person {personId:$personId})-[rels:OWNS|CONTROLS*1..5]->(o:Organization)
WHERE all(r IN rels WHERE coalesce(r.validTo, date('9999-12-31')) >= date())
RETURN o.organizationId AS organizationId,
       o.legalName AS legalName,
       length(path) AS depth,
       [r IN rels | type(r)] AS relationshipTypes,
       path
ORDER BY depth ASC
LIMIT 100;
```

For production, consider computing effective control separately if legal rules are complex.

### 9.4 Related Cases

Question:

> “Find other cases connected through shared subjects, organizations, addresses, devices, or transactions.”

```cypher
MATCH (c:Case {caseId:$caseId})-[:HAS_SUBJECT|HAS_RELATED_PARTY]->(entity)
MATCH path = (entity)-[*1..3]-(otherEntity)<-[:HAS_SUBJECT|HAS_RELATED_PARTY]-(otherCase:Case)
WHERE otherCase <> c
RETURN otherCase.caseId AS relatedCaseId,
       otherCase.status AS status,
       otherCase.severity AS severity,
       length(path) AS distance,
       path
ORDER BY distance ASC
LIMIT 50;
```

This query is too broad for production as-is.

Better define allowed relationship set:

```cypher
MATCH (c:Case {caseId:$caseId})-[:HAS_SUBJECT|HAS_RELATED_PARTY]->(entity)
MATCH path = (entity)-[:USES|HAS_ADDRESS|HAS_PHONE|HAS_EMAIL|OWNS|CONTROLS|DIRECTOR_OF*1..3]-(otherEntity)
MATCH (otherCase:Case)-[:HAS_SUBJECT|HAS_RELATED_PARTY]->(otherEntity)
WHERE otherCase <> c
RETURN DISTINCT otherCase.caseId AS relatedCaseId,
       otherCase.status AS status,
       otherCase.severity AS severity,
       min(length(path)) AS minDistance
ORDER BY minDistance ASC
LIMIT 50;
```

### 9.5 Evidence Chain for an Allegation

Question:

> “Why do we believe this allegation?”

```cypher
MATCH (a:Allegation {allegationId:$allegationId})<-[:HAS_ALLEGATION]-(c:Case)
OPTIONAL MATCH path = (a)<-[:SUPPORTS]-(e:Evidence)-[:DERIVED_FROM*0..2]->(src)
RETURN c.caseId AS caseId,
       a.allegationType AS allegationType,
       a.confidence AS confidence,
       collect(path) AS evidencePaths;
```

This query is critical for defensibility.

Any risk recommendation or allegation should be able to produce:

- source evidence,
- time collected,
- confidence,
- transformation lineage,
- decision reviewer.

### 9.6 Conflict of Interest

Question:

> “Is the assigned officer connected to the case subject?”

```cypher
MATCH (c:Case {caseId:$caseId})-[:ASSIGNED_TO]->(officer:Officer)
MATCH (c)-[:HAS_SUBJECT|HAS_RELATED_PARTY]->(subject)
MATCH path = (officer)-[:WORKED_WITH|RELATED_TO|HAS_ADDRESS|HAS_EMAIL|HAS_PHONE|MEMBER_OF*1..4]-(subject)
RETURN officer.officerId AS officerId,
       subject AS subject,
       path
LIMIT 20;
```

This requires careful relationship taxonomy.

You do not want false allegations of conflict from weak signals.

Use tiered severity:

```text
Critical: spouse, family, direct business ownership
High: same organization, shared address, prior representation
Medium: same unit, common contact
Low: broad community/shared institution
```

### 9.7 Repeat Offender Detection

Question:

> “Has this subject or related network appeared in previous cases?”

```cypher
MATCH (p:Person {personId:$personId})
MATCH path = (p)-[:USES|OWNS|CONTROLS|DIRECTOR_OF|HAS_ADDRESS*0..3]-(entity)<-[:HAS_SUBJECT|HAS_RELATED_PARTY]-(c:Case)
WHERE c.status IN ['CLOSED', 'ENFORCEMENT_ACTION_TAKEN']
RETURN c.caseId AS caseId,
       c.caseType AS caseType,
       c.severity AS severity,
       length(path) AS distance,
       path
ORDER BY distance ASC
LIMIT 50;
```

Use explainable distance. Investigator must understand why a case is considered related.

---

## 10. Risk Scoring: From Graph Signals to Decision Support

Graph should not directly “decide guilt”.

Graph can produce signals.

Decision remains governed by process, evidence, policy, and human review.

### 10.1 Risk Signal Node

```cypher
(:RiskSignal {
  signalId: 'SIG-001',
  signalType: 'SHARED_DEVICE_WITH_SANCTIONED_PERSON',
  severity: 'HIGH',
  score: 0.82,
  generatedAt: datetime(),
  algorithmVersion: 'rules-v3.2'
})
```

Relationships:

```text
(:RiskSignal)-[:ABOUT]->(:Person)
(:RiskSignal)-[:SUPPORTED_BY]->(:Evidence)
(:RiskSignal)-[:DERIVED_FROM_PATH]->(:PathEvidence)    // optional reified path
(:Case)-[:HAS_RISK_SIGNAL]->(:RiskSignal)
```

### 10.2 Rule-Based Signals

Examples:

```text
S1: Person shares low-degree device with sanctioned person.
S2: Organization is controlled within 3 hops by person in previous enforcement case.
S3: Account receives funds from multiple suspicious accounts within short time window.
S4: Case subject appears in same community as known fraud cluster.
S5: Officer assignment conflicts with subject network.
S6: Beneficial owner hidden behind nominee chain.
```

Example Cypher for S1:

```cypher
MATCH (p:Person {personId:$personId})-[:USES]->(d:Device)<-[:USES]-(other:Person)-[:ON_WATCHLIST|SANCTIONED_BY]->(w)
WITH p, d, other, w, size((d)<-[:USES]-(:Person)) AS deviceDegree
WHERE deviceDegree <= 5
CREATE (sig:RiskSignal {
  signalId: randomUUID(),
  signalType: 'SHARED_LOW_DEGREE_DEVICE_WITH_WATCHLIST_PERSON',
  severity: 'HIGH',
  score: 0.85,
  generatedAt: datetime(),
  algorithmVersion: $algorithmVersion
})
MERGE (sig)-[:ABOUT]->(p)
MERGE (sig)-[:INVOLVES]->(d)
MERGE (sig)-[:INVOLVES]->(other)
MERGE (sig)-[:SUPPORTED_BY]->(w);
```

### 10.3 Feature-Based Scoring

Graph features:

```text
- number of related high-risk persons within 2 hops
- shortest path distance to sanctioned entity
- count of shared identifiers with known bad actors
- weighted degree of transaction neighborhood
- PageRank in suspicious transaction subgraph
- community membership risk score
- betweenness in suspicious flow network
- count of prior cases in connected component
- beneficial ownership chain complexity
- ratio of nominee-like directors
```

These features can feed:

- rules engine,
- ML model,
- analyst dashboard,
- case prioritization,
- alert triage.

### 10.4 Risk Score Node

Avoid overwriting risk score without history.

```cypher
(:RiskScore {
  scoreId: 'RS-001',
  subjectType: 'PERSON',
  score: 0.78,
  scoreBand: 'HIGH',
  modelName: 'graph-risk-model',
  modelVersion: '2026.06.1',
  generatedAt: datetime()
})
```

Relationships:

```text
(:RiskScore)-[:SCORES]->(:Person)
(:RiskScore)-[:USES_SIGNAL]->(:RiskSignal)
(:RiskScore)-[:GENERATED_BY]->(:AlgorithmRun)
(:Case)-[:HAS_RISK_SCORE]->(:RiskScore)
```

This allows audit:

- what score existed at decision time,
- which model version produced it,
- what signals contributed,
- whether model changed later.

---

## 11. Graph Data Science Use

Fraud/risk domain benefits from GDS when used carefully.

### 11.1 Community Detection

Use cases:

- detect fraud rings,
- group related accounts,
- cluster shell companies,
- identify hidden networks around known bad actors.

Example projection idea:

```text
Nodes:
  Person, Organization, Account

Relationships:
  USES, OWNS, CONTROLS, DIRECTOR_OF, AUTHORIZED_SIGNATORY_OF, TRANSFERRED_TO
```

Community score should not be interpreted as guilt.

It means:

> “This entity belongs to a connected structure that may deserve investigation.”

### 11.2 Centrality

Use cases:

- find key facilitator,
- find hub account,
- find broker organization,
- find bridge between clusters.

Possible algorithms:

- degree centrality,
- weighted degree,
- PageRank,
- betweenness,
- harmonic/closeness depending on graph shape.

Centrality can lie if graph is biased by data availability.

A person with many links may be:

- fraud orchestrator,
- legitimate corporate service provider,
- address provider,
- bank branch,
- data artifact,
- common placeholder.

Always interpret with entity type, relationship type, and degree distribution.

### 11.3 Similarity

Use cases:

- find accounts behaving similarly,
- find organizations with similar officer/address structure,
- find cases similar to current case,
- find person profiles similar to known fraudster pattern.

Similarity is not causality.

It is a retrieval/ranking signal.

### 11.4 Link Prediction

Use cases:

- suggest undiscovered relationship,
- recommend likely related parties,
- prioritize manual review.

Do not write predicted links as facts.

Use separate relationship or node:

```text
(:PredictedRelationship)-[:PREDICTS]->(:Person)
(:PredictedRelationship)-[:PREDICTS]->(:Organization)
```

or:

```text
(:Person)-[:PREDICTED_ASSOCIATION {confidence, modelVersion}]->(:Person)
```

Never confuse predicted association with verified association.

### 11.5 Path Finding

Use cases:

- path from subject to sanctioned entity,
- shortest beneficial ownership chain,
- money flow route,
- dependency/impact path,
- escalation path.

Use weighted path when different relationship types have different evidentiary strength.

Example weights:

```text
SAME_DEVICE: 0.2
SAME_ADDRESS: 0.5
OWNS: 0.1
DIRECTOR_OF: 0.2
TRANSACTED_WITH: 0.7
MENTIONED_IN_SAME_DOCUMENT: 0.8
```

Lower cost may mean stronger relationship. Be explicit.

---

## 12. Case Workflow Graph

Graph can assist workflow, but it should not become an uncontrolled workflow engine.

### 12.1 Workflow Nodes

```text
(:Case)
(:Review)
(:Decision)
(:EnforcementAction)
(:Officer)
(:Unit)
```

Relationships:

```text
(:Case)-[:ASSIGNED_TO]->(:Officer)
(:Case)-[:REVIEWED_BY]->(:Review)
(:Review)-[:PERFORMED_BY]->(:Officer)
(:Review)-[:RESULTED_IN]->(:Decision)
(:Decision)-[:RESULTED_IN]->(:EnforcementAction)
(:Decision)-[:CITES]->(:Regulation)
(:Decision)-[:SUPPORTED_BY]->(:Evidence)
```

### 12.2 Escalation Query

```cypher
MATCH (c:Case {caseId:$caseId})-[:HAS_RISK_SIGNAL]->(sig:RiskSignal)
WITH c, max(sig.score) AS maxSignalScore, collect(sig.signalType) AS signalTypes
WHERE maxSignalScore >= 0.8
MATCH (unit:Unit {unitCode:'HIGH_RISK_REVIEW'})
RETURN c.caseId AS caseId,
       maxSignalScore,
       signalTypes,
       unit.unitCode AS recommendedUnit;
```

### 12.3 Defensible Escalation

Escalation should store rationale:

```cypher
CREATE (d:Decision {
  decisionId: randomUUID(),
  decisionType: 'ESCALATE_CASE',
  rationale: $rationale,
  decidedAt: datetime(),
  policyVersion: $policyVersion
})
WITH d
MATCH (c:Case {caseId:$caseId})
MERGE (c)-[:HAS_DECISION]->(d);
```

A later auditor should see:

- why escalation happened,
- which signals existed,
- who approved,
- which policy version applied,
- what evidence supported it.

---

## 13. Evidence, Provenance, and Defensibility

Regulatory graph must separate:

```text
Fact
Claim
Evidence
Inference
Prediction
Decision
Action
```

### 13.1 Fact vs Claim

Fact:

```text
Corporate registry filing states Person P owns 45% of Organization O.
```

Claim:

```text
Person P is beneficial owner of Organization O.
```

Inference:

```text
P may control O through a chain of nominee relationships.
```

Decision:

```text
Case is escalated to high-risk review.
```

Action:

```text
Warning letter issued.
```

Do not collapse them into one relationship.

Bad:

```text
(:Person)-[:IS_FRAUDSTER]->(:Case)
```

Better:

```text
(:Case)-[:HAS_ALLEGATION]->(:Allegation {type:'SUSPECTED_FRAUD'})
(:Allegation)<-[:SUPPORTS]-(:Evidence)
(:Allegation)-[:REVIEWED_BY]->(:Review)
(:Review)-[:RESULTED_IN]->(:Decision)
```

### 13.2 Provenance Pattern

```text
(:SourceSystem)
(:SourceRecord)
(:Evidence)
(:ObservedFact)
(:ResolvedEntity)
```

```text
(:SourceRecord)-[:FROM_SYSTEM]->(:SourceSystem)
(:Evidence)-[:DERIVED_FROM]->(:SourceRecord)
(:ObservedFact)-[:SUPPORTED_BY]->(:Evidence)
(:ObservedFact)-[:ASSERTS_RELATIONSHIP]->(:RelationshipFact)
```

This pattern is heavier, but valuable when legal defensibility matters.

### 13.3 Temporal Provenance

For temporal facts:

```cypher
(:Person)-[:OWNS {
  percentage: 0.45,
  validFrom: date('2025-01-01'),
  validTo: date('2025-12-31'),
  observedAt: datetime('2026-01-10T09:00:00+07:00'),
  sourceRef: 'FILING-7788'
}]->(:Organization)
```

Distinguish:

```text
validFrom/validTo      = when fact is true in domain
observedAt             = when system observed it
recordedAt             = when graph recorded it
reviewedAt             = when human reviewed it
```

These are not interchangeable.

---

## 14. Handling False Positives

Fraud graph systems create false positives if not carefully designed.

### 14.1 Common False Positive Sources

```text
- common address shared by many legal entities
- family members sharing phone/device legitimately
- corporate service providers serving many clients
- bank branch address
- reused test/default data
- poor entity resolution
- stale ownership data
- sanctioned name match without identity confirmation
- common names
- transliteration variants
- incomplete source data
```

### 14.2 Degree-Aware Interpretation

A shared identifier with degree 2 is different from degree 20,000.

```cypher
MATCH (id)<-[r]-()
RETURN labels(id) AS idType,
       id.id AS id,
       count(r) AS degree
ORDER BY degree DESC
LIMIT 100;
```

High-degree identifiers may be:

- legitimate hubs,
- noisy data,
- fraud hubs,
- modelling errors.

They need classification.

### 14.3 Suppression / Explanation

Create suppression nodes or classification:

```text
(:Address)-[:CLASSIFIED_AS]->(:IdentifierClassification {type:'CORPORATE_SERVICE_PROVIDER_ADDRESS'})
```

or property:

```cypher
(:Address {classification:'COMMON_SERVICE_ADDRESS'})
```

Then queries can down-weight or exclude.

---

## 15. Entity Resolution in Investigation Graph

Fraud actors exploit identity fragmentation.

You may see:

```text
Jon Doe
John Doe
J. Doe
JOHN DOE
John D.
```

or:

```text
Company Ltd
Company Limited
Company L.T.D.
PT Company Indonesia
```

Graph helps entity resolution through shared relationships:

- same phone,
- same device,
- same address,
- same beneficial owner,
- same email domain,
- same document,
- same transaction network.

### 15.1 Entity Resolution Pattern

```text
(:IdentityObservation)-[:POSSIBLY_SAME_AS]->(:IdentityObservation)
(:IdentityObservation)-[:RESOLVED_TO]->(:Person)
(:ResolutionDecision)-[:MERGED]->(:IdentityObservation)
(:ResolutionDecision)-[:CREATED]->(:Person)
(:ResolutionDecision)-[:SUPPORTED_BY]->(:Evidence)
```

Do not blindly merge.

Keep merge decisions auditable.

### 15.2 Duplicate Risk

Wrong merge is dangerous.

False merge may make innocent person look connected to fraud.

False split may hide fraud ring.

Therefore entity resolution needs:

- confidence,
- evidence,
- reversible merge strategy,
- human review threshold,
- model versioning,
- source traceability.

---

## 16. Java Service Architecture

### 16.1 Recommended Boundary

```text
API Layer
  └─ CaseInvestigationController

Application Service
  └─ InvestigationService
  └─ RiskSignalService
  └─ EvidenceService
  └─ GraphQueryService

Graph Repository / Query Objects
  └─ SubjectNetworkQuery
  └─ OwnershipChainQuery
  └─ RelatedCaseQuery
  └─ EvidencePathQuery
  └─ RiskSignalCommand

Neo4j Driver
  └─ session.executeRead / executeWrite

Neo4j
```

Do not scatter Cypher strings everywhere.

Use query objects or repository methods with clear contracts.

### 16.2 Query Object Example

```java
public record RelatedCaseResult(
    String caseId,
    String status,
    String severity,
    int minDistance,
    List<String> explanation
) {}
```

```java
public final class RelatedCaseQuery {
    public static final String CYPHER = """
        MATCH (c:Case {caseId:$caseId})-[:HAS_SUBJECT|HAS_RELATED_PARTY]->(entity)
        MATCH path = (entity)-[:USES|HAS_ADDRESS|HAS_PHONE|HAS_EMAIL|OWNS|CONTROLS|DIRECTOR_OF*1..3]-(otherEntity)
        MATCH (otherCase:Case)-[:HAS_SUBJECT|HAS_RELATED_PARTY]->(otherEntity)
        WHERE otherCase <> c
        RETURN DISTINCT otherCase.caseId AS caseId,
               otherCase.status AS status,
               otherCase.severity AS severity,
               min(length(path)) AS minDistance
        ORDER BY minDistance ASC
        LIMIT $limit
        """;
}
```

### 16.3 Transaction Pattern

Use managed transactions.

Pseudo-code:

```java
try (Session session = driver.session(SessionConfig.builder()
        .withDatabase("investigation")
        .build())) {

    return session.executeRead(tx -> {
        Result result = tx.run(RelatedCaseQuery.CYPHER, Map.of(
            "caseId", caseId,
            "limit", limit
        ));

        return result.list(record -> new RelatedCaseResult(
            record.get("caseId").asString(),
            record.get("status").asString(null),
            record.get("severity").asString(null),
            record.get("minDistance").asInt(),
            List.of()
        ));
    });
}
```

### 16.4 API Response Should Not Leak Entire Graph

Bad API response:

```json
{
  "nodes": [...],
  "relationships": [...]
}
```

for every request.

Better:

```json
{
  "subjectId": "P-001",
  "relatedCases": [
    {
      "caseId": "CASE-2024-991",
      "distance": 2,
      "reason": "Shared low-degree device with prior case subject",
      "confidence": 0.82
    }
  ]
}
```

Return graph visualization payload only when UI needs it, and apply access trimming.

---

## 17. Performance and Scale Considerations

### 17.1 Transaction Volume

Do not put every transaction in Neo4j by default.

Ask:

```text
Will investigators traverse individual transactions?
Will graph algorithms use individual transactions?
Do we need evidence chain per transaction?
Is transaction volume manageable?
Can we aggregate safely?
```

Possible strategies:

1. store only suspicious transactions,
2. store rolling window transactions,
3. store aggregated account-to-account flows,
4. keep raw transactions in OLAP store and project subset to Neo4j,
5. store transaction nodes only after alert/case creation.

### 17.2 High-Degree Nodes

Common high-degree nodes:

```text
- popular merchant
- corporate registry agent
- shared service address
- bank branch
- payment gateway
- common device fingerprint bug
- unknown placeholder address
- default email/phone
```

For each high-degree entity, decide:

```text
Is it meaningful hub, noise, or modelling error?
```

### 17.3 Query Guardrails

Every investigation query should have:

- bounded depth,
- allowed relationship types,
- max result limit,
- degree filters,
- time window when relevant,
- authorization filter,
- query timeout at infrastructure level,
- read-only transaction.

### 17.4 Precomputed Relationships

For expensive recurrent patterns, use derived edges:

```text
(:Person)-[:RELATED_VIA_SHARED_LOW_DEGREE_IDENTIFIER {reason, computedAt, score}]->(:Person)
```

But derived edge must be marked as derived, not raw fact.

---

## 18. Access Control and Data Leakage

Investigation graphs are sensitive.

### 18.1 Risk: Path Leakage

Even if user cannot read a sensitive node, path existence can leak information.

Example:

```text
“Subject is connected to sanctioned entity within 2 hops.”
```

If the sanctioned entity is hidden but risk score reveals it, this can still leak.

### 18.2 Security Trimming

Application layer should trim:

- nodes,
- relationships,
- properties,
- path explanation,
- evidence references,
- risk signal details.

### 18.3 Multi-Tenant Model

Options:

1. separate database per tenant/jurisdiction,
2. tenant label/property on every node/relationship,
3. physical separation for high-sensitivity tenants,
4. hybrid: shared reference graph + tenant-specific case graph.

Regulatory systems often need strong isolation.

If tenant leakage is catastrophic, prefer stronger isolation than just property filters.

---

## 19. Audit Trail

Graph mutation should be auditable.

### 19.1 Audit Event

```cypher
(:AuditEvent {
  auditId: randomUUID(),
  action: 'CREATE_RISK_SIGNAL',
  actorId: 'SYSTEM:risk-engine',
  occurredAt: datetime(),
  requestId: $requestId,
  correlationId: $correlationId
})
```

Relationships:

```text
(:AuditEvent)-[:AFFECTED]->(:RiskSignal)
(:AuditEvent)-[:AFFECTED]->(:Case)
(:AuditEvent)-[:PERFORMED_BY]->(:Officer|SystemActor)
```

### 19.2 Audit Questions

The system should answer:

```text
Who created this allegation?
What evidence existed at the time?
Which algorithm generated this signal?
Which model version was used?
Who reviewed the recommendation?
Why was the case escalated?
What changed after the decision?
Was any source record later corrected?
```

---

## 20. Investigation UI Mental Model

A good UI should not dump a hairball graph.

### 20.1 Progressive Disclosure

UI flow:

1. subject summary,
2. risk indicators,
3. top explanation paths,
4. related cases,
5. ownership/control chain,
6. evidence timeline,
7. graph expansion by investigator choice,
8. exportable rationale.

### 20.2 Avoid Hairball Visualization

A graph with 2,000 nodes on screen is not insight.

Better:

- start with top 10 relevant paths,
- group by relationship type,
- collapse high-degree hubs,
- show confidence and evidence count,
- show why node appears,
- allow filtering by time/source/type.

---

## 21. Failure Modes

### 21.1 Model Failure

```text
Relationship semantics too vague.
Evidence and inference mixed.
Predictions stored as facts.
No temporal validity.
No provenance.
Supernodes ignored.
Case and entity models tangled.
```

### 21.2 Query Failure

```text
Unbounded traversal.
Over-broad relationship type.
No degree guard.
Cartesian product.
Returning entire path graph blindly.
No query timeout.
No PROFILE-based tuning.
```

### 21.3 Operational Failure

```text
Raw transactions overloaded Neo4j.
Page cache undersized.
Batch import causes lock contention.
Long-running analytics impacts operational queries.
No backup restore drill.
No slow query alerting.
```

### 21.4 Regulatory Failure

```text
Cannot explain why subject was flagged.
Cannot reproduce score at decision time.
Cannot show evidence chain.
Cannot distinguish allegation from verified fact.
Cannot show who reviewed decision.
Sensitive path leaked across tenant boundary.
```

### 21.5 Human Process Failure

```text
Investigators trust graph score as truth.
False positives not tracked.
Feedback loop not captured.
Model drift ignored.
Policy changes not versioned.
Analyst annotations not audited.
```

---

## 22. Implementation Roadmap

### Phase 1 — Minimal Connected Entity Graph

Scope:

- Person,
- Organization,
- Account,
- Address,
- Device,
- core relationships,
- constraints,
- basic query catalogue.

Goal:

```text
Investigators can see direct/2-hop relationships around a subject.
```

### Phase 2 — Case and Evidence Integration

Add:

- Case,
- Allegation,
- Evidence,
- SourceRecord,
- Officer,
- Regulation,
- audit event.

Goal:

```text
Every case insight has evidence path.
```

### Phase 3 — Risk Signals

Add:

- rule-based risk signals,
- score history,
- algorithm run metadata,
- reviewer feedback.

Goal:

```text
Graph can support triage, not final decision.
```

### Phase 4 — Graph Analytics

Add:

- community detection,
- centrality,
- similarity,
- path finding,
- scheduled projection pipeline.

Goal:

```text
Graph finds hidden structure and suggests investigation leads.
```

### Phase 5 — Production Hardening

Add:

- access trimming,
- multi-tenancy,
- monitoring,
- backup/restore,
- query timeout,
- data quality checks,
- model governance.

Goal:

```text
System survives audit, scale, and operational failure.
```

---

## 23. Architecture Decision Matrix

| Decision | Prefer Option A | Prefer Option B | Notes |
|---|---|---|---|
| Transaction as node vs relationship | Node when evidence/query/audit needed | Relationship when aggregate/simple flow | Investigation-grade systems usually prefer node for important tx |
| Relationship property vs fact node | Property for simple attributes | Fact node for evidence/dispute/history | Legal defensibility pushes toward fact nodes |
| Store all transactions vs subset | All when volume manageable and traversal required | Subset/aggregate when volume huge | Avoid turning Neo4j into OLAP store |
| Prediction as relationship vs node | Relationship for lightweight signal | Node for audit/model metadata | Never confuse predicted with verified |
| Tenant isolation by property vs database | Property for low-risk internal segmentation | Database/physical for high-risk isolation | Regulatory systems often need stronger isolation |
| SDN vs driver | SDN for simple CRUD | Driver for critical graph queries | Use explicit Cypher for investigation logic |
| Real-time GDS vs batch GDS | Real-time for small/critical features | Batch for heavy analytics | Avoid impacting operational graph |

---

## 24. End-to-End Example Scenario

### Scenario

A new case is opened for Person P-001.

The system discovers:

1. P-001 owns Organization ORG-001.
2. ORG-001 owns ORG-002.
3. ORG-002 controls Account ACC-002.
4. ACC-002 received funds from Account ACC-999.
5. ACC-999 is linked to a previously sanctioned person.
6. P-001 shares a device with P-002.
7. P-002 was related party in a closed enforcement case.

### Graph Interpretation

This does not prove wrongdoing.

It creates investigation leads:

```text
Lead 1: beneficial ownership chain from P-001 to account receiving suspicious funds.
Lead 2: shared device association to previous enforcement case party.
Lead 3: indirect transaction link to sanctioned network.
```

### Defensible Output

A good system returns:

```json
{
  "caseId": "CASE-2026-001",
  "subjectId": "P-001",
  "riskBand": "HIGH",
  "leads": [
    {
      "leadType": "OWNERSHIP_TO_SUSPICIOUS_ACCOUNT",
      "score": 0.81,
      "explanation": "Subject owns ORG-001, ORG-001 owns ORG-002, ORG-002 controls ACC-002, ACC-002 received funds from account linked to sanctioned person.",
      "evidenceIds": ["EV-001", "EV-002", "EV-003"],
      "requiresHumanReview": true
    }
  ]
}
```

Not:

```json
{
  "fraud": true
}
```

---

## 25. Top 1% Engineering Principles for This Domain

### Principle 1 — Separate Fact, Inference, Prediction, and Decision

This is non-negotiable in enforcement systems.

### Principle 2 — Every Important Edge Needs an Explanation

If an edge affects risk or enforcement, it needs source/provenance.

### Principle 3 — Bounded Traversal Is a Product Requirement

Do not treat traversal limit as a technical afterthought.

### Principle 4 — Graph Score Is Not Truth

Graph score is prioritization/support. Human and policy process still matter.

### Principle 5 — Degree Distribution Must Shape the Model

Supernodes are not rare. They are inevitable.

### Principle 6 — Investigation UI Must Explain, Not Overwhelm

Hairball graph visualization is often anti-insight.

### Principle 7 — Entity Resolution Is a First-Class Risk

Wrong merge can harm people. Wrong split can hide misconduct.

### Principle 8 — Model Versioning Matters

Risk signals and decisions must be reproducible.

### Principle 9 — Access Control Must Consider Paths

A hidden node can still leak through path existence.

### Principle 10 — Neo4j Is the Connected Intelligence Layer, Not the Whole Platform

Use relational/source systems, OLAP, search, streaming, and object storage where appropriate.

---

## 26. Practical Checklist

### 26.1 Before Building

```text
[ ] What exact investigation questions must be answered?
[ ] Which paths must be cheap?
[ ] Which entities are source-of-truth elsewhere?
[ ] Which facts require provenance?
[ ] Which relationships are verified vs inferred?
[ ] Which data is sensitive?
[ ] What are acceptable false positive/false negative trade-offs?
[ ] What must be reproducible for audit?
```

### 26.2 Modelling

```text
[ ] Are relationship types semantically meaningful?
[ ] Are high-degree nodes expected and handled?
[ ] Are temporal facts modelled correctly?
[ ] Are predictions separated from verified facts?
[ ] Are evidence chains present?
[ ] Are case workflow objects separate from entity graph?
```

### 26.3 Query

```text
[ ] Are traversals bounded?
[ ] Are relationship types whitelisted?
[ ] Are high-degree identifiers filtered/down-weighted?
[ ] Are queries profiled with representative data?
[ ] Are results explainable?
[ ] Are sensitive paths trimmed?
```

### 26.4 Operations

```text
[ ] Is page cache sized for working set?
[ ] Are slow queries logged?
[ ] Are GDS workloads isolated or scheduled?
[ ] Are backups tested?
[ ] Are imports idempotent?
[ ] Are reconciliation jobs defined?
```

### 26.5 Governance

```text
[ ] Are model versions stored?
[ ] Are algorithm runs stored?
[ ] Are human reviews captured?
[ ] Are false positives tracked?
[ ] Are policy versions linked to decisions?
[ ] Can a decision be reconstructed later?
```

---

## 27. Summary

Fraud, risk, enforcement, and investigation are natural graph domains because the most important signals are rarely isolated attributes. They emerge from relationships:

- shared identifiers,
- ownership chains,
- control networks,
- transaction flows,
- related cases,
- evidence paths,
- communities,
- central actors,
- indirect exposure to sanctioned or high-risk entities.

But graph power creates graph risk.

A careless graph system can:

- over-connect innocent parties,
- leak sensitive information,
- create unexplained scores,
- overload production with traversal explosion,
- make predictions look like facts,
- fail regulatory audit.

A strong graph system separates facts from claims, inference, prediction, decision, and action. It stores provenance. It bounds traversal. It treats degree distribution seriously. It supports human review. It uses Neo4j as a connected intelligence layer, not as a universal replacement for every data platform component.

The engineering goal is not merely to “detect fraud”.

The goal is to build a system that can say:

```text
Here is why this subject deserves review.
Here are the paths.
Here is the evidence.
Here is the confidence.
Here is what is inferred vs verified.
Here is who reviewed it.
Here is the policy basis.
Here is how to reproduce the decision later.
```

That is the difference between a graph demo and a production-grade enforcement graph platform.

---

## 28. References

- Neo4j Fraud Detection Use Case: https://neo4j.com/use-cases/fraud-detection/
- Neo4j Graph Data Science Algorithms: https://neo4j.com/docs/graph-data-science/current/algorithms/
- Neo4j Degree Centrality documentation: https://neo4j.com/docs/graph-data-science/current/algorithms/degree-centrality/
- Neo4j Path Finding Algorithms: https://neo4j.com/docs/graph-data-science/current/algorithms/pathfinding/
- Neo4j Graph Database Concepts: https://neo4j.com/docs/getting-started/appendix/graphdb-concepts/
- Neo4j Cypher Manual: https://neo4j.com/docs/cypher-manual/current/

---

## 29. Status Seri

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
Part 012 selesai.
Part 013 selesai.
Part 014 selesai.
Part 015 selesai.
Part 016 selesai.
Part 017 selesai.
Part 018 selesai.
Part 019 selesai.
Part 020 selesai.
Part 021 selesai.
Part 022 selesai.
Part 023 selesai.
Part 024 selesai.
Part 025 selesai.
Part 026 selesai.
Part 027 selesai.
Seri belum selesai.
Masih ada Part 028 sampai Part 032.
```



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Knowledge Graphs, Ontologies, Semantics, and Inference Boundaries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-028.md">Part 028 — Domain Case Study: Recommendation, Personalization, and Similarity Graph ➡️</a>
</div>
