# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-032.md

# Part 032 — Capstone: Designing a Production-Grade Graph Platform for Complex Case Management

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Audiens: Java software engineer / tech lead  
> Fokus: end-to-end architecture, graph modelling, ingestion, query catalogue, Java services, security, auditability, GDS, optional GraphRAG, operations, migration, and production readiness  
> Status seri: Part 032 dari 032  
> Ini adalah bagian terakhir seri.

---

## 0. Tujuan Capstone

Bagian ini adalah puncak dari seluruh seri.

Kita akan mendesain platform graph production-grade untuk domain **complex case management**, terutama tipe sistem seperti:

- regulatory enforcement,
- investigation platform,
- fraud/risk case management,
- compliance review,
- intelligence analysis,
- entity network investigation,
- evidence-driven decision support,
- access-controlled case collaboration.

Capstone ini bukan sekadar contoh Neo4j. Ini adalah latihan arsitektur lengkap:

```text
Bagaimana memutuskan Neo4j layak dipakai?
Bagaimana membagi ownership antara relational/document/search/OLAP/stream/graph?
Bagaimana mendesain graph schema?
Bagaimana mendesain query catalogue?
Bagaimana membuat ingestion pipeline yang idempotent?
Bagaimana menjaga provenance dan auditability?
Bagaimana membuat Java service layer yang tidak bocor menjadi generic graph CRUD?
Bagaimana mengoperasikan Neo4j di production?
Bagaimana menghindari traversal explosion?
Bagaimana memastikan security trimming?
Bagaimana memakai GDS tanpa cargo cult?
Bagaimana menambahkan GraphRAG secara aman?
Bagaimana membuat platform ini survive scale, audit, migration, dan perubahan domain?
```

Target akhir bagian ini adalah memberikan blueprint yang bisa dipakai sebagai bahan architecture review.

---

## 1. Problem Statement

Bayangkan kita membangun platform case management untuk badan regulator atau organisasi compliance besar.

Platform harus mendukung:

```text
1. Case registration
2. Evidence management
3. Party/entity management
4. Investigation workflow
5. Related-party discovery
6. Network risk analysis
7. Case escalation
8. Enforcement decision support
9. Audit trail
10. Regulatory defensibility
11. Access-controlled collaboration
12. Historical reconstruction
13. Reporting
14. Search
15. Graph exploration
16. Optional AI assistant grounded on evidence
```

Contoh pertanyaan user:

```text
Kasus mana yang terkait dengan organisasi ini?
Siapa beneficial owner dari perusahaan ini sampai 5 level?
Apakah subject ini pernah muncul di kasus lain?
Apakah dua kasus ini terhubung melalui account, address, device, director, or transaction?
Evidence apa yang mendukung hubungan ini?
Siapa reviewer yang mengambil keputusan ini?
Apa jalur eskalasi kasus?
Entity mana yang paling sentral dalam jaringan ini?
Apakah ada cluster mencurigakan?
Jika entity ini diberi sanction, pihak mana yang terdampak?
Apa path yang menjelaskan risk score ini?
Apakah analyst ini boleh melihat evidence tertentu?
```

Ini bukan CRUD biasa. Ini relationship-heavy, path-heavy, audit-heavy, dan defensibility-heavy.

Graph database relevan karena:

```text
relationships are domain facts
paths are explanations
network topology contains risk signals
case linkage is multi-hop
evidence provenance matters
human investigation needs exploration
```

Namun graph bukan satu-satunya komponen. Platform production-grade harus polyglot.

---

## 2. Architecture Principles

Blueprint ini mengikuti prinsip berikut.

### 2.1 Source-of-truth harus jelas

Jangan biarkan semua database menjadi source-of-truth.

Contoh:

```text
Relational DB:
  workflow state, case lifecycle, assignment, decision status

Document/object store:
  evidence documents, attachments, large text, files

Search engine:
  full-text and fuzzy search over case/evidence/entity text

Neo4j:
  connected entity/case/evidence/relationship graph

OLAP:
  metrics, dashboards, historical aggregates

Stream/broker:
  event distribution and projection updates

Cache:
  hot authorization and derived query results
```

Neo4j bisa menjadi source-of-truth untuk curated graph facts jika domain memang graph-native, tetapi untuk enterprise case platform, sering lebih aman sebagai **relationship intelligence projection** plus **curated graph layer**.

### 2.2 Graph stores relationships that matter

Neo4j tidak perlu menyimpan semua field.

Simpan di Neo4j:

```text
entity IDs
case IDs
evidence IDs
relationship facts
relationship provenance
risk-relevant properties
classification/sensitivity
temporal validity
review/decision linkage
graph-derived scores
```

Jangan simpan di Neo4j sebagai primary store:

```text
large binary files
full document body
all workflow audit log rows
massive event stream
dashboard fact tables
large raw JSON blobs
```

### 2.3 Every graph relationship must answer “so what?”

Relationship harus punya makna domain.

Buruk:

```text
(:Thing)-[:RELATED_TO]->(:Thing)
```

Lebih baik:

```text
(:Person)-[:DIRECTOR_OF]->(:Organization)
(:Person)-[:OWNS {percentage}]->(:Organization)
(:Organization)-[:TRANSACTED_WITH]->(:Organization)
(:Case)-[:INVOLVES]->(:Person)
(:Evidence)-[:SUPPORTS]->(:Allegation)
(:Decision)-[:BASED_ON]->(:Evidence)
```

### 2.4 Query catalogue drives model

Model graph tidak dimulai dari class diagram.

Model dimulai dari pertanyaan:

```text
What paths must be cheap?
What explanation must be reproducible?
What relationships must be traversed together?
What relationships must never be crossed?
What node types create supernodes?
What fields must be indexed at traversal start?
```

### 2.5 Auditability is not optional

Untuk regulatory/enforcement context, setiap insight harus bisa dijelaskan:

```text
which facts
from which source
loaded when
valid during what period
used by which query/model
reviewed by whom
shown to whom
acted upon when
```

Graph yang tidak bisa diaudit hanya menjadi visualisasi menarik, bukan sistem defensible.

---

## 3. High-Level System Architecture

Arsitektur target:

```text
[Source Systems]
  HR / CRM / Registry / Transaction Systems / Document Systems / External Watchlists
       |
       v
[Event Stream / CDC / Batch Import]
       |
       v
[Ingestion & Normalization Layer]
  - identity resolution
  - entity normalization
  - relationship normalization
  - source provenance
  - data quality gates
       |
       +--------------------+
       |                    |
       v                    v
[Relational Case DB]    [Neo4j Graph DB]
  workflow state          entity/case/evidence graph
  case status             relationship paths
  assignment              graph scores
  decision metadata       curated relationship facts
       |                    |
       v                    v
[Search Index]        [Graph Query Service]
  text/fuzzy/vector       path explanation
  document search         graph exploration
       |                    |
       v                    v
[Application API Layer / Java Services]
       |
       v
[Analyst UI / Review UI / Investigation Workspace / Reporting / Optional AI Assistant]
```

Supporting systems:

```text
[Object Store]
  evidence files, attachments, original documents

[OLAP]
  reporting, metrics, trend analysis

[Cache]
  authorization, hot query results

[Audit Log]
  immutable decision/access/event audit

[Monitoring]
  graph metrics, query logs, ingestion lag, data quality
```

---

## 4. Bounded Contexts

Jangan bangun satu service raksasa bernama `GraphService`.

Pisahkan bounded contexts.

```text
Case Lifecycle Context
Evidence Context
Entity Registry Context
Relationship Intelligence Context
Investigation Context
Risk Scoring Context
Access Control Context
Review & Decision Context
Audit Context
Search Context
Reporting Context
```

Neo4j terutama berada di:

```text
Relationship Intelligence
Investigation
Risk Scoring
Access Explanation
Knowledge Graph / Evidence Linkage
```

Case lifecycle state machine dapat tetap di relational DB.

---

## 5. Core Domain Model

### 5.1 Main node labels

```text
:Case
:Allegation
:Decision
:Action
:Evidence
:Source
:Person
:Organization
:Account
:Address
:Device
:Phone
:Email
:Transaction
:Asset
:Regulation
:Rule
:Officer
:Team
:WorkflowStage
:RiskSignal
:Finding
:Review
:Tenant
```

### 5.2 Entity nodes

Example:

```cypher
(:Person {
  id: "person-123",
  canonicalName: "Alice Tan",
  normalizedName: "ALICE TAN",
  entityStatus: "ACTIVE",
  riskTier: "MEDIUM",
  createdAt: datetime()
})
```

```cypher
(:Organization {
  id: "org-789",
  legalName: "Example Holdings Ltd",
  registrationNumber: "REG-9981",
  jurisdiction: "SG",
  entityStatus: "ACTIVE",
  riskTier: "HIGH"
})
```

### 5.3 Case node

```cypher
(:Case {
  id: "case-2026-0001",
  caseNumber: "ENF-2026-0001",
  type: "MARKET_ABUSE",
  status: "UNDER_INVESTIGATION",
  sensitivity: "CONFIDENTIAL",
  openedAt: datetime("2026-02-01T09:00:00Z"),
  sourceSystem: "CASE_CORE"
})
```

### 5.4 Evidence node

```cypher
(:Evidence {
  id: "ev-9001",
  evidenceType: "BANK_STATEMENT",
  classification: "CONFIDENTIAL",
  hash: "sha256:...",
  capturedAt: datetime("2026-02-10T10:00:00Z"),
  sourceSystem: "EVIDENCE_STORE",
  objectUri: "s3://evidence-bucket/..."
})
```

### 5.5 Relationship vocabulary

```text
(:Case)-[:INVOLVES]->(:Person)
(:Case)-[:INVOLVES]->(:Organization)
(:Case)-[:HAS_ALLEGATION]->(:Allegation)
(:Allegation)-[:SUPPORTED_BY]->(:Evidence)
(:Decision)-[:BASED_ON]->(:Evidence)
(:Decision)-[:RESOLVES]->(:Allegation)
(:Person)-[:DIRECTOR_OF]->(:Organization)
(:Person)-[:OWNS {percentage}]->(:Organization)
(:Organization)-[:OWNS {percentage}]->(:Organization)
(:Person)-[:USES]->(:Account)
(:Organization)-[:OWNS_ACCOUNT]->(:Account)
(:Account)-[:TRANSACTED_WITH]->(:Account)
(:Person)-[:HAS_ADDRESS]->(:Address)
(:Organization)-[:REGISTERED_AT]->(:Address)
(:Person)-[:USES_DEVICE]->(:Device)
(:Evidence)-[:MENTIONS]->(:Entity)
(:Case)-[:RELATED_TO]->(:Case)
(:RiskSignal)-[:OBSERVED_ON]->(:Entity)
(:Finding)-[:SUPPORTED_BY]->(:Evidence)
(:Review)-[:REVIEWED]->(:Finding)
(:Officer)-[:ASSIGNED_TO]->(:Case)
(:Case)-[:BELONGS_TO_TENANT]->(:Tenant)
```

### 5.6 Relationship metadata

Important relationship properties:

```text
sourceSystem
sourceRecordId
confidence
validFrom
validTo
observedAt
loadedAt
createdBy
method
evidenceId
status
reviewStatus
```

Example:

```cypher
(:Person)-[:DIRECTOR_OF {
  sourceSystem: "CORPORATE_REGISTRY",
  sourceRecordId: "filing-123",
  validFrom: date("2022-01-01"),
  validTo: null,
  confidence: 0.98,
  loadedAt: datetime()
}]->(:Organization)
```

---

## 6. Canonical Graph Schema

A production graph schema should document:

```text
labels
relationship types
direction
required properties
optional properties
cardinality expectations
source ownership
validity semantics
sensitivity rules
query usage
```

Example schema entry:

```text
Relationship: DIRECTOR_OF

Pattern:
  (:Person)-[:DIRECTOR_OF]->(:Organization)

Meaning:
  Person is or was director of organization.

Direction:
  Person to Organization because main traversal starts from person to controlled entities.

Required properties:
  sourceSystem
  sourceRecordId
  validFrom
  loadedAt

Optional properties:
  validTo
  confidence
  filingDate

Cardinality:
  Person can be director of many organizations.
  Organization can have many directors.

Security:
  Can be shown to users with entity-read permission.
  Source document may require evidence-read permission.

Performance:
  Commonly traversed in ownership/control expansion.
```

This may feel bureaucratic, but without it graph semantics drift.

---

## 7. Constraints and Indexes

### 7.1 Identity constraints

```cypher
CREATE CONSTRAINT case_id_unique IF NOT EXISTS
FOR (c:Case)
REQUIRE c.id IS UNIQUE;

CREATE CONSTRAINT person_id_unique IF NOT EXISTS
FOR (p:Person)
REQUIRE p.id IS UNIQUE;

CREATE CONSTRAINT organization_id_unique IF NOT EXISTS
FOR (o:Organization)
REQUIRE o.id IS UNIQUE;

CREATE CONSTRAINT evidence_id_unique IF NOT EXISTS
FOR (e:Evidence)
REQUIRE e.id IS UNIQUE;

CREATE CONSTRAINT account_id_unique IF NOT EXISTS
FOR (a:Account)
REQUIRE a.id IS UNIQUE;

CREATE CONSTRAINT decision_id_unique IF NOT EXISTS
FOR (d:Decision)
REQUIRE d.id IS UNIQUE;
```

### 7.2 Search-start indexes

```cypher
CREATE INDEX case_number_idx IF NOT EXISTS
FOR (c:Case)
ON (c.caseNumber);

CREATE INDEX person_normalized_name_idx IF NOT EXISTS
FOR (p:Person)
ON (p.normalizedName);

CREATE INDEX organization_registration_idx IF NOT EXISTS
FOR (o:Organization)
ON (o.registrationNumber);

CREATE INDEX case_status_idx IF NOT EXISTS
FOR (c:Case)
ON (c.status);

CREATE INDEX evidence_classification_idx IF NOT EXISTS
FOR (e:Evidence)
ON (e.classification);
```

### 7.3 Risk and operation indexes

```cypher
CREATE INDEX risk_tier_person_idx IF NOT EXISTS
FOR (p:Person)
ON (p.riskTier);

CREATE INDEX risk_tier_org_idx IF NOT EXISTS
FOR (o:Organization)
ON (o.riskTier);

CREATE INDEX case_sensitivity_idx IF NOT EXISTS
FOR (c:Case)
ON (c.sensitivity);
```

### 7.4 Principle

Indexes are mostly for finding start nodes. Traversal performance after start node depends on graph shape, relationship types, fan-out, and bounded path design.

---

## 8. Query Catalogue

A production graph platform should maintain an approved query catalogue.

### 8.1 Query 1 — Case neighborhood

Purpose:

```text
Show entities and evidence directly linked to a case.
```

```cypher
MATCH (c:Case {id: $caseId})
MATCH path = (c)-[:INVOLVES|HAS_ALLEGATION|SUPPORTED_BY|BASED_ON|ASSIGNED_TO]-(n)
RETURN path
LIMIT 200;
```

Production improvement:

- enforce tenant,
- security trim evidence,
- separate evidence metadata from file access,
- cap degree.

### 8.2 Query 2 — Related cases through shared entity

```cypher
MATCH (c:Case {id: $caseId})-[:INVOLVES]->(entity)
MATCH (other:Case)-[:INVOLVES]->(entity)
WHERE other <> c
RETURN DISTINCT other.id AS relatedCaseId,
       labels(entity) AS sharedEntityType,
       entity.id AS sharedEntityId
LIMIT 100;
```

### 8.3 Query 3 — Multi-hop related cases

```cypher
MATCH (c:Case {id: $caseId})
MATCH path =
  (c)-[:INVOLVES|MENTIONS|OWNS|DIRECTOR_OF|HAS_ADDRESS|USES_DEVICE|TRANSACTED_WITH*1..4]-
  (other:Case)
WHERE other <> c
RETURN path
LIMIT 100;
```

Warning:

```text
This query must be profiled and bounded carefully.
Use relationship-type-specific expansions and avoid broad undirected expansion in production.
```

### 8.4 Query 4 — Ownership/control chain

```cypher
MATCH (o:Organization {id: $organizationId})
MATCH path =
  (o)<-[:OWNS|DIRECTOR_OF|CONTROLS*1..5]-(controller)
RETURN path
LIMIT 100;
```

Better model may separate:

```text
legal ownership
beneficial ownership
director relationship
control relationship
```

### 8.5 Query 5 — Evidence supporting allegation

```cypher
MATCH (a:Allegation {id: $allegationId})
MATCH path = (a)-[:SUPPORTED_BY]->(e:Evidence)
RETURN e.id AS evidenceId,
       e.evidenceType AS evidenceType,
       e.classification AS classification,
       path;
```

### 8.6 Query 6 — Decision defensibility path

```cypher
MATCH (d:Decision {id: $decisionId})
MATCH path =
  (d)-[:BASED_ON]->(:Evidence)
  -[:MENTIONS|SUPPORTS|OBSERVED_ON*0..2]-
  (entity)
RETURN path
LIMIT 200;
```

Question answered:

```text
What facts and evidence supported this decision?
```

### 8.7 Query 7 — Officer conflict of interest

```cypher
MATCH (officer:Officer {id: $officerId})
MATCH (case:Case {id: $caseId})-[:INVOLVES]->(entity)
MATCH path =
  (officer)-[:PREVIOUSLY_WORKED_FOR|RELATED_TO|OWNS|DIRECTOR_OF*1..3]-(entity)
RETURN path
LIMIT 50;
```

### 8.8 Query 8 — Blast radius of action

If we take enforcement action against organization:

```cypher
MATCH (o:Organization {id: $organizationId})
MATCH path =
  (o)-[:OWNS|CONTROLS|DIRECTOR_OF|TRANSACTED_WITH|SUPPLIES_TO*1..4]-(affected)
RETURN labels(affected) AS affectedType,
       affected.id AS affectedId,
       path
LIMIT 300;
```

### 8.9 Query 9 — High-risk network around entity

```cypher
MATCH (start {id: $entityId})
WHERE start:Person OR start:Organization OR start:Account
MATCH path =
  (start)-[:OWNS|DIRECTOR_OF|USES|OWNS_ACCOUNT|TRANSACTED_WITH|HAS_ADDRESS|USES_DEVICE*1..3]-(n)
WHERE any(node IN nodes(path)
  WHERE coalesce(node.riskTier, "LOW") IN ["HIGH", "CRITICAL"])
RETURN path
LIMIT 200;
```

### 8.10 Query 10 — Why was this entity scored high risk?

```cypher
MATCH (entity {id: $entityId})<-[:OBSERVED_ON]-(signal:RiskSignal)
OPTIONAL MATCH (signal)-[:SUPPORTED_BY]->(e:Evidence)
RETURN signal.id AS signalId,
       signal.type AS signalType,
       signal.score AS score,
       collect(e.id) AS evidenceIds;
```

---

## 9. Ingestion Pipeline

### 9.1 Source types

```text
case management events
corporate registry data
transaction events
KYC/customer records
watchlists
document extraction
manual analyst assertions
external intelligence feeds
workflow decisions
```

### 9.2 Ingestion stages

```text
1. Extract
2. Normalize
3. Validate
4. Resolve entity identity
5. Build canonical facts
6. Attach provenance
7. Write graph idempotently
8. Run data quality gates
9. Update projections/scores
10. Emit ingestion result
```

### 9.3 Idempotent write pattern

```cypher
MERGE (p:Person {id: $personId})
SET p.canonicalName = $canonicalName,
    p.normalizedName = $normalizedName,
    p.lastSeenAt = datetime(),
    p.sourceSystem = $sourceSystem;
```

Relationship:

```cypher
MATCH (p:Person {id: $personId})
MATCH (o:Organization {id: $organizationId})
MERGE (p)-[r:DIRECTOR_OF {sourceSystem: $sourceSystem, sourceRecordId: $sourceRecordId}]->(o)
SET r.validFrom = date($validFrom),
    r.validTo = CASE WHEN $validTo IS NULL THEN null ELSE date($validTo) END,
    r.confidence = $confidence,
    r.loadedAt = datetime();
```

### 9.4 Source fact node pattern

For high-audit environments:

```text
(:SourceFact)-[:ASSERTS]->(:RelationshipFact)
(:SourceFact)-[:FROM_SOURCE]->(:Source)
(:SourceFact)-[:EVIDENCED_BY]->(:Evidence)
```

Neo4j cannot directly attach a node to a relationship as a first-class node. If the relationship fact itself needs lifecycle/evidence/dispute, reify it:

```text
(:Person)-[:HAS_DIRECTORSHIP]->(:Directorship)-[:OF_ORGANIZATION]->(:Organization)
(:Directorship)-[:EVIDENCED_BY]->(:Evidence)
(:Directorship)-[:FROM_SOURCE]->(:Source)
```

### 9.5 Data quality gates

Examples:

```cypher
MATCH (c:Case)
WHERE NOT (c)-[:BELONGS_TO_TENANT]->(:Tenant)
RETURN count(c) AS casesWithoutTenant;
```

```cypher
MATCH (e:Evidence)
WHERE e.classification IS NULL
RETURN count(e) AS evidenceWithoutClassification;
```

```cypher
MATCH ()-[r:DIRECTOR_OF|OWNS|INVOLVES]->()
WHERE r.sourceSystem IS NULL
RETURN type(r), count(r);
```

Gate policy:

```text
BLOCK
WARN
QUARANTINE
CREATE_REVIEW_TASK
AUTO_FIX
```

---

## 10. Entity Resolution Strategy

Complex case systems often need entity resolution.

Same entity may appear as:

```text
Alice Tan
A. Tan
Tan Alice
ALICE TAN
passport number
tax ID
email
phone
registry ID
customer ID
```

### 10.1 Identity model

```text
(:Person)-[:HAS_IDENTIFIER]->(:Identifier)
(:Identifier)-[:FROM_SOURCE]->(:Source)
```

Example:

```cypher
(:Person {id: "person-123"})
  -[:HAS_IDENTIFIER]->
(:Identifier {type: "PASSPORT", valueHash: "..."})
```

### 10.2 Candidate matching

Graph helps after candidate generation:

```text
same identifier
same address
same phone
same device
same account
same director relationship
same transaction counterparty
```

### 10.3 Do not auto-merge blindly

Use:

```text
confidence score
review workflow
merge decision
audit trail
undo/rollback
source provenance
```

Model merge:

```text
(:EntityResolutionCandidate)
(:MergeDecision)
(:Person)-[:SAME_AS]->(:Person)
```

Or canonicalize:

```text
(:PersonAlias)-[:RESOLVES_TO]->(:Person)
```

### 10.4 False merge is worse than missed merge

In enforcement/regulatory systems, merging two different people can create severe harm.

Use human-in-the-loop for high-impact resolution.

---

## 11. Java Service Architecture

### 11.1 Services

```text
case-service
evidence-service
entity-service
graph-ingestion-service
graph-query-service
risk-analysis-service
review-service
audit-service
search-service
authorization-service
```

### 11.2 Graph query service ports

Avoid generic graph repository.

Use explicit use-case interfaces:

```java
public interface RelatedCaseQuery {
    List<RelatedCaseResult> findRelatedCases(CaseId caseId, ViewerContext viewer);
}

public interface OwnershipPathQuery {
    List<OwnershipPath> findOwnershipPaths(EntityId organizationId, int maxDepth, ViewerContext viewer);
}

public interface EvidenceSupportQuery {
    DecisionSupportGraph explainDecision(DecisionId decisionId, ViewerContext viewer);
}

public interface RiskNetworkQuery {
    RiskNetwork findRiskNetwork(EntityId entityId, RiskNetworkCriteria criteria, ViewerContext viewer);
}
```

### 11.3 Command side

Graph writes should be use-case-specific:

```java
public interface GraphIngestionPort {
    IngestionResult ingestCaseInvolvement(CaseInvolvementFact fact);
    IngestionResult ingestOwnershipFact(OwnershipFact fact);
    IngestionResult ingestEvidenceMention(EvidenceMentionFact fact);
}
```

### 11.4 Transaction rules

```text
One source fact or bounded batch per transaction.
Use retryable transaction for transient errors.
Never run unbounded write migration inside request path.
Use deterministic IDs for MERGE.
```

### 11.5 Error categories

```text
validation error
constraint violation
transient error
deadlock
timeout
data quality violation
security trimming violation
stale projection
unknown source reference
```

Expose them intentionally.

---

## 12. Security and Access Control

### 12.1 Security layers

```text
1. Authentication
2. Application authorization
3. Graph query scoping
4. Neo4j database roles/privileges
5. Evidence object-store authorization
6. Audit logging
7. Result redaction
```

Do not rely only on Neo4j role privileges for all domain security.

### 12.2 Viewer context

Every graph query should receive:

```text
viewerId
tenantId
roles
case scopes
evidence clearance
purpose
requestId
```

Example:

```java
public record ViewerContext(
    String userId,
    String tenantId,
    Set<String> roles,
    Set<String> allowedCaseIds,
    Set<String> allowedClassifications,
    String purpose,
    String requestId
) {}
```

### 12.3 Tenant boundary in Cypher

```cypher
MATCH (viewer:Officer {id: $viewerId})-[:CAN_VIEW_CASE]->(c:Case {id: $caseId})
MATCH (c)-[:BELONGS_TO_TENANT]->(:Tenant {id: $tenantId})
...
```

### 12.4 Evidence redaction

Graph can show that evidence exists without allowing file access.

```text
visible:
  evidence ID
  evidence type
  classification
  relationship to allegation

hidden:
  document content
  file URI
  sensitive metadata
```

### 12.5 Audit access

Every graph query for sensitive data should audit:

```text
who
when
purpose
input parameters
result count
classification touched
decision/action taken
query name/version
```

Do not log raw sensitive path contents unnecessarily.

---

## 13. Audit and Provenance

### 13.1 Provenance levels

```text
Node provenance:
  where entity came from

Relationship provenance:
  where relationship came from

Evidence provenance:
  source document, hash, capture time

Decision provenance:
  facts/evidence used

Query provenance:
  query version, parameters, actor

Model provenance:
  risk model/GDS version used
```

### 13.2 Evidence-backed relationship

```text
(:Person)-[:HAS_DIRECTORSHIP]->(:Directorship)-[:OF_ORGANIZATION]->(:Organization)
(:Directorship)-[:EVIDENCED_BY]->(:Evidence)
(:Directorship)-[:FROM_SOURCE]->(:Source)
```

### 13.3 Decision snapshot

A decision should preserve what was known at decision time.

```text
(:Decision)-[:BASED_ON]->(:Evidence)
(:Decision)-[:USED_FINDING]->(:Finding)
(:Finding)-[:SUPPORTED_BY]->(:Evidence)
(:Decision)-[:USED_GRAPH_SNAPSHOT]->(:GraphSnapshot)
```

Graph changes after decision should not invalidate historical explanation.

### 13.4 Immutable audit outside graph

Neo4j can store audit relationships, but high-integrity audit logs are often stored in append-only audit infrastructure.

Use Neo4j to query relationships. Use immutable audit log for non-repudiation.

---

## 14. Risk Scoring and GDS Layer

### 14.1 Risk scoring categories

```text
rule-based graph signals
centrality-based signals
community-based signals
path-based risk
similarity-based signals
known watchlist proximity
case recurrence
evidence strength
temporal pattern
```

### 14.2 Example risk signal

```text
Entity is within 2 hops of sanctioned organization.
Entity shares address with 3 high-risk organizations.
Organization has high betweenness centrality in suspicious transaction network.
Person controls multiple entities involved in prior cases.
```

### 14.3 Store risk signal as explainable node

```cypher
(:RiskSignal {
  id: "risk-123",
  type: "WATCHLIST_PROXIMITY",
  score: 0.82,
  modelVersion: "graph-risk-v2",
  computedAt: datetime()
})
```

Relationship:

```text
(:RiskSignal)-[:OBSERVED_ON]->(:Entity)
(:RiskSignal)-[:SUPPORTED_BY]->(:Evidence)
(:RiskSignal)-[:DERIVED_FROM_PATH]->(:PathSnapshot)
```

### 14.4 GDS workflow

```text
1. Create graph projection.
2. Estimate memory.
3. Run algorithm.
4. Validate results.
5. Write/mutate scores.
6. Create risk signals.
7. Review high-impact findings.
8. Monitor score drift.
```

### 14.5 Human-in-the-loop

Never let graph algorithm alone create enforcement action.

Use GDS for:

```text
prioritization
triage
lead generation
risk signal creation
analyst support
```

Do not use it as final legal/regulatory decision without review, evidence, and policy framework.

---

## 15. Optional GraphRAG / AI Assistant Layer

### 15.1 When useful

An AI assistant can help:

```text
summarize connected evidence
answer questions about a case graph
explain relationship paths in natural language
generate investigation hypotheses
help analysts navigate large networks
```

### 15.2 Safe architecture

```text
User question
  -> authorization check
  -> entity/case grounding
  -> vector/search retrieval
  -> graph traversal expansion
  -> evidence filtering/redaction
  -> context assembly
  -> LLM response
  -> citations/evidence links
  -> audit
```

### 15.3 Rules

```text
LLM cannot see data user cannot access.
LLM response must cite evidence/path.
LLM cannot create final enforcement decision.
LLM-generated hypothesis must be marked as hypothesis.
LLM context must include source provenance.
LLM answer must be reproducible enough for audit.
```

### 15.4 Graph helps reduce hallucination

Graph grounds the assistant in:

```text
known entities
known relationships
valid paths
source evidence
case boundaries
tenant boundaries
temporal constraints
```

But graph does not eliminate hallucination. The system still needs guardrails.

---

## 16. Operations and Capacity

### 16.1 Capacity dimensions

Estimate:

```text
number of cases
entities per case
evidence per case
relationships per entity
transactions/account relationships
historical versions
derived relationships
risk signals
review nodes
tenant count
```

### 16.2 Memory

Neo4j performance depends heavily on:

```text
page cache
heap
query memory
GDS memory
```

Operational planning:

```text
graph store size
index size
active working set
expected traversal locality
GDS projection size
concurrent query load
```

### 16.3 Monitoring

Monitor:

```text
slow queries
query timeouts
db hits
page cache hit ratio
heap usage
GC pauses
transaction logs
checkpoint behavior
connection pool
Bolt failures
deadlocks/transient errors
ingestion lag
projection freshness
GDS memory
supernode growth
```

### 16.4 Query log review

Every critical query should have:

```text
query name
version
owner
SLO
sample parameters
profile baseline
```

### 16.5 Backup/restore

Production readiness requires:

```text
backup schedule
restore drill
point-in-time expectations
cluster backup plan
evidence/object store consistency plan
graph projection rebuild plan
```

If Neo4j is projection, restore may be:

```text
restore last backup + replay events
or rebuild from sources
```

If Neo4j is source-of-truth, restore RPO/RTO is more critical.

---

## 17. Failure Scenarios and Mitigations

### 17.1 Graph projection lag

Problem:

```text
New case/entity relationship exists in source but not yet in graph.
```

Mitigation:

```text
freshness SLA
source offset tracking
UI freshness indicator
fallback to source system
reconciliation job
```

### 17.2 Wrong entity merge

Problem:

```text
Two different people merged into one entity.
```

Mitigation:

```text
human review for high-impact merge
merge decision audit
alias model
undo capability
confidence threshold
```

### 17.3 Cross-tenant traversal leak

Problem:

```text
Query crosses tenant boundary and returns forbidden entity.
```

Mitigation:

```text
tenant-scoped query templates
negative tests
security trimming
result redaction
query review
audit detection
```

### 17.4 Supernode explosion

Problem:

```text
Address/device/group/entity links to millions of nodes.
```

Mitigation:

```text
degree monitoring
do-not-expand labels
relationship partitioning
time bucketing
derived edges
query guardrails
```

### 17.5 Stale derived score

Problem:

```text
Risk signal remains after underlying relationship revoked.
```

Mitigation:

```text
projection versioning
computedAt
source snapshot
explainability invariant
recompute schedule
stale score expiry
```

### 17.6 Audit explanation not reproducible

Problem:

```text
Decision explanation changes because graph changed.
```

Mitigation:

```text
decision snapshot
path snapshot
evidence snapshot
graph snapshot version
immutable audit log
```

### 17.7 Query performance regression

Problem:

```text
New relationship type increases traversal fan-out.
```

Mitigation:

```text
performance regression tests
query budget
PROFILE baseline
canary
slow query alert
relationship vocabulary governance
```

---

## 18. Migration and Evolution Plan

### 18.1 Start minimal

Initial graph:

```text
Case
Person
Organization
Evidence
INVOLVES
SUPPORTED_BY
MENTIONS
DIRECTOR_OF
OWNS
```

Do not start with every possible entity type.

### 18.2 Add capabilities incrementally

Phase 1:

```text
basic case-entity-evidence graph
related cases
ownership path
```

Phase 2:

```text
entity resolution
provenance nodes
risk signals
```

Phase 3:

```text
GDS scoring
community detection
blast radius
```

Phase 4:

```text
GraphRAG assistant
advanced review workflow
```

### 18.3 Expand-contract migration

Use for all major changes:

```text
add new model
backfill
dual read/write
validate
switch
contract old
```

### 18.4 Query versioning

```text
related-cases-v1
related-cases-v2
ownership-path-v1
decision-explanation-v1
risk-network-v1
```

Every query has:

```text
owner
purpose
parameters
expected path semantics
security constraints
performance budget
```

---

## 19. Data Governance

### 19.1 Graph data catalogue

Maintain documentation:

```text
labels
relationship types
property definitions
source systems
classification
retention
owners
allowed consumers
```

### 19.2 Retention

Different data has different retention:

```text
case nodes
evidence metadata
sensitive relationships
derived scores
review decisions
query audit logs
raw source facts
```

### 19.3 Deletion vs historical validity

For regulated systems, prefer:

```text
validTo
status
redaction
restricted access
```

over hard delete, unless legal/privacy requirements demand deletion.

### 19.4 Data classification

Every sensitive node/relationship should carry classification or inherit it.

Examples:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
RESTRICTED
LEGAL_HOLD
```

Query layer must enforce it.

---

## 20. Production Readiness Checklist

### 20.1 Graph justification

```text
[ ] Top queries are graph-shaped.
[ ] Path explanation is required.
[ ] Multi-hop relationships create business value.
[ ] Neo4j is not being used as generic CRUD store.
[ ] Non-graph workloads have appropriate systems.
```

### 20.2 Model readiness

```text
[ ] Labels are documented.
[ ] Relationship types are documented.
[ ] Relationship directions are intentional.
[ ] Required properties are known.
[ ] Tenant/sensitivity model exists.
[ ] Provenance model exists.
[ ] Temporal validity model exists.
[ ] Supernode risks are identified.
```

### 20.3 Query readiness

```text
[ ] Query catalogue exists.
[ ] Critical queries are bounded.
[ ] Traversal depths are explicit.
[ ] Query start points are indexed.
[ ] Query contracts are tested.
[ ] PROFILE baselines exist.
[ ] Result caps exist.
[ ] Security trimming is built in.
```

### 20.4 Ingestion readiness

```text
[ ] Source ownership clear.
[ ] Idempotent writes.
[ ] Entity resolution strategy.
[ ] Data quality gates.
[ ] Reconciliation job.
[ ] Ingestion lag monitoring.
[ ] Dead-letter process.
[ ] Source provenance.
```

### 20.5 Java service readiness

```text
[ ] Use-case-specific query ports.
[ ] No generic graph CRUD leakage.
[ ] Driver/session lifecycle managed.
[ ] Retry strategy for transient errors.
[ ] Query parameters bound safely.
[ ] DTOs stable.
[ ] Raw internal node IDs not exposed.
[ ] Integration tests use real Neo4j.
```

### 20.6 Security readiness

```text
[ ] Viewer context required.
[ ] Tenant boundary enforced.
[ ] Evidence redaction.
[ ] Neo4j credentials least privilege.
[ ] Query audit.
[ ] Sensitive path redaction.
[ ] No raw Cypher from UI.
```

### 20.7 Operations readiness

```text
[ ] Backup/restore tested.
[ ] Memory/page cache planned.
[ ] Query logs monitored.
[ ] Slow query SLOs.
[ ] GDS memory planned.
[ ] Cluster plan if required.
[ ] Alerting.
[ ] Capacity model.
[ ] Migration runbook.
```

### 20.8 Audit readiness

```text
[ ] Decision snapshot.
[ ] Evidence provenance.
[ ] Path explanation.
[ ] Graph snapshot/version.
[ ] Query version.
[ ] Immutable audit log.
[ ] Reproducibility procedure.
```

---

## 21. Architecture Decision Records

Essential ADRs for this platform:

```text
ADR-001: Why Neo4j is used and for which workloads.
ADR-002: Source-of-truth vs graph projection boundary.
ADR-003: Entity identity and resolution strategy.
ADR-004: Evidence provenance model.
ADR-005: Tenant and security trimming model.
ADR-006: Query catalogue governance.
ADR-007: Risk scoring/GDS governance.
ADR-008: GraphRAG assistant safety model.
ADR-009: Derived edge/projection rebuild strategy.
ADR-010: Migration and versioning strategy.
```

Each ADR should state:

```text
context
decision
alternatives considered
consequences
failure modes
operational implications
security implications
```

---

## 22. End-to-End Example Flow

### 22.1 A new case is opened

Event:

```json
{
  "eventType": "CaseOpened",
  "caseId": "case-2026-0001",
  "tenantId": "tenant-regulator-a",
  "caseType": "MARKET_ABUSE",
  "openedAt": "2026-06-22T08:00:00Z"
}
```

Relational DB:

```text
stores case lifecycle record
```

Neo4j:

```cypher
MERGE (c:Case {id: $caseId})
SET c.caseNumber = $caseNumber,
    c.type = $caseType,
    c.status = "OPEN",
    c.openedAt = datetime($openedAt)
MERGE (t:Tenant {id: $tenantId})
MERGE (c)-[:BELONGS_TO_TENANT]->(t);
```

### 22.2 Evidence uploaded

Object store:

```text
stores file
```

Search engine:

```text
indexes extracted text
```

Neo4j:

```cypher
MATCH (c:Case {id: $caseId})
MERGE (e:Evidence {id: $evidenceId})
SET e.evidenceType = $type,
    e.classification = $classification,
    e.hash = $hash,
    e.capturedAt = datetime($capturedAt)
MERGE (c)-[:HAS_EVIDENCE]->(e);
```

### 22.3 Entity extraction

Document extraction finds organization and person.

```cypher
MATCH (e:Evidence {id: $evidenceId})
MERGE (p:Person {id: $personId})
SET p.canonicalName = $personName
MERGE (e)-[:MENTIONS {confidence: $confidence}]->(p);
```

### 22.4 Analyst confirms relationship

```cypher
MATCH (p:Person {id: $personId})
MATCH (o:Organization {id: $organizationId})
MATCH (e:Evidence {id: $evidenceId})
CREATE (d:Directorship {
  id: randomUUID(),
  status: "CONFIRMED",
  confirmedBy: $analystId,
  confirmedAt: datetime()
})
MERGE (p)-[:HAS_DIRECTORSHIP]->(d)
MERGE (d)-[:OF_ORGANIZATION]->(o)
MERGE (d)-[:EVIDENCED_BY]->(e);
```

### 22.5 Related case discovery

```cypher
MATCH (c:Case {id: $caseId})-[:INVOLVES|HAS_EVIDENCE|MENTIONS*1..2]-(entity)
MATCH (other:Case)-[:INVOLVES|HAS_EVIDENCE|MENTIONS*1..2]-(entity)
WHERE other <> c
RETURN DISTINCT other.id, entity.id
LIMIT 50;
```

### 22.6 Decision

```cypher
MATCH (c:Case {id: $caseId})
MATCH (e:Evidence {id: $evidenceId})
CREATE (d:Decision {
  id: $decisionId,
  type: $decisionType,
  decidedAt: datetime(),
  decidedBy: $officerId,
  graphSnapshotVersion: $graphSnapshotVersion
})
MERGE (d)-[:DECISION_FOR]->(c)
MERGE (d)-[:BASED_ON]->(e);
```

Audit log records immutable decision event.

---

## 23. Final Mental Model

A production graph platform is not just:

```text
Neo4j + Cypher queries
```

It is:

```text
a governed relationship intelligence layer
with explicit source ownership
bounded traversal
auditable path explanations
tested graph invariants
rebuildable projections
secure query scoping
operational observability
and carefully chosen integration with other systems
```

Neo4j provides the graph-native engine, but the architecture provides safety.

---

## 24. What “Top 1% Engineer” Means Here

For graph database and Neo4j, top-tier capability means you can reason across levels:

### 24.1 Modelling level

```text
Can identify graph-shaped requirements.
Can choose node vs relationship vs property vs reified node.
Can avoid supernodes and traversal explosion.
Can design relationship vocabulary with semantic clarity.
```

### 24.2 Query level

```text
Can write Cypher that is bounded, explainable, and performant.
Can read PROFILE.
Can detect cartesian products.
Can control variable-length traversals.
Can design path explanation queries.
```

### 24.3 Application level

```text
Can integrate Neo4j cleanly with Java.
Can design query-specific ports.
Can avoid ORM-shaped graph misuse.
Can handle retryable transactions.
Can test with real Neo4j.
```

### 24.4 Architecture level

```text
Can decide source-of-truth vs projection.
Can combine graph with relational/search/OLAP/cache/stream.
Can model ingestion and reconciliation.
Can design security trimming.
Can plan migration and evolution.
```

### 24.5 Operational level

```text
Can size memory/page cache.
Can monitor query performance.
Can plan backup/restore.
Can detect graph-specific failure modes.
Can manage GDS memory.
```

### 24.6 Governance level

```text
Can make graph decisions defensible.
Can preserve audit provenance.
Can explain algorithmic signals.
Can support regulatory review.
Can prevent semantic drift.
```

That combination is rare and valuable.

---

## 25. Final Checklist: Is Graph Justified?

```text
[ ] Relationship/path questions are core to the product.
[ ] Path explanation matters to users or auditors.
[ ] Indirect connections reveal important facts.
[ ] Many-to-many relationships dominate.
[ ] Queries are not just simple record lookups.
[ ] Graph traversal replaces awkward join/application stitching.
[ ] Graph algorithms or network metrics add value.
[ ] The team can govern graph schema and query catalogue.
```

If most are false, do not force graph.

---

## 26. Final Checklist: Is Neo4j Production-Ready?

```text
[ ] Source ownership is clear.
[ ] Graph schema is documented.
[ ] Constraints and indexes are defined.
[ ] Query catalogue exists.
[ ] Critical queries have PROFILE baselines.
[ ] Traversals are bounded.
[ ] Ingestion is idempotent.
[ ] Reconciliation exists.
[ ] Security trimming exists.
[ ] Audit/provenance exists.
[ ] Backup/restore tested.
[ ] Migration process exists.
[ ] Monitoring exists.
[ ] Failure scenarios have runbooks.
```

If these are missing, the graph may work in demo but fail in production.

---

## 27. Final Checklist: Can It Survive Audit, Scale, and Change?

Audit:

```text
[ ] Can every decision cite evidence?
[ ] Can every relationship cite source/provenance?
[ ] Can historical state be reconstructed?
[ ] Can access to sensitive graph be audited?
```

Scale:

```text
[ ] Supernodes identified?
[ ] Page cache/memory planned?
[ ] GDS memory planned?
[ ] Query caps and timeouts configured?
[ ] Derived projections rebuildable?
```

Change:

```text
[ ] Expand-contract migration process?
[ ] Query versioning?
[ ] Golden fixtures?
[ ] Invariant tests?
[ ] Consumer contracts?
[ ] ADRs?
```

A graph platform is only mature when all three are handled.

---

## 28. Summary

This capstone designed a production-grade graph platform for complex case management.

We covered:

- problem framing,
- architecture principles,
- polyglot system architecture,
- bounded contexts,
- domain model,
- graph schema,
- constraints/indexes,
- query catalogue,
- ingestion pipeline,
- entity resolution,
- Java service architecture,
- security and access control,
- audit and provenance,
- GDS risk scoring,
- optional GraphRAG assistant,
- operations/capacity,
- failure scenarios,
- migration and evolution,
- data governance,
- readiness checklist,
- end-to-end flow.

The core lesson:

```text
Neo4j is most valuable when it becomes a governed relationship intelligence layer,
not when it is treated as a fashionable replacement for every database.
```

A well-designed graph platform makes complex relationships:

```text
visible
queryable
explainable
auditable
testable
operable
evolvable
```

That is the standard to aim for.

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
Part 028 selesai.
Part 029 selesai.
Part 030 selesai.
Part 031 selesai.
Part 032 selesai.
Seri selesai.
Ini adalah bagian terakhir.
```

---

## 30. Rekomendasi Materi Lanjutan Setelah Seri Ini

Jika ingin memperdalam setelah seri ini, jalur lanjutannya:

```text
1. RDF, SPARQL, OWL, SHACL, Semantic Web, and Ontology Engineering
2. Entity Resolution and Master Data Management
3. Graph Algorithms and Network Science
4. Graph Machine Learning
5. GraphRAG and Knowledge-Graph-Grounded AI Systems
6. Policy Engines and Relationship-Based Authorization
7. Investigation Platform Architecture
8. Data Governance, Provenance, and Auditability Engineering
9. Event-Sourced Projection Systems
10. Large-Scale Graph Operations and Performance Engineering
```

Seri yang paling natural setelah ini:

```text
learn-knowledge-graph-rdf-sparql-ontology-engineering-for-java-engineers
```

atau:

```text
learn-entity-resolution-and-master-data-management-for-java-engineers
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-031.md">⬅️ Part 031 — Comparative Architecture: Neo4j vs Relational, Document, Search, OLAP, Cache, and Stream Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./README.md">README ➡️</a>
</div>
