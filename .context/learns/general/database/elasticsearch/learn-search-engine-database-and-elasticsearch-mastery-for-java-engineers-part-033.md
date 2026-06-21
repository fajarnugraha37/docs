# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-033.md

# Part 033 — Elasticsearch in Enterprise / Regulatory Case Management Systems

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Part: `033`  
> Fokus: enterprise/regulatory case management search architecture, case lifecycle, evidence/document search, permission-aware search, auditability, legal hold, investigator UX, regulatory metadata, and safe RAG  
> Target pembaca: Java software engineer / tech lead yang ingin menerapkan Elasticsearch dalam sistem enterprise/regulatory yang kompleks, sensitif, dan harus bisa diaudit.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 032, kita telah membangun seluruh fondasi teknis:

- search fundamentals;
- Lucene/Elasticsearch internals;
- modeling/mapping/analyzer;
- query DSL, relevance, aggregation, pagination;
- ingestion, consistency, Java integration;
- security, performance, capacity, lifecycle;
- schema evolution, operations, incident response, DR;
- advanced features, vector search, hybrid/RAG;
- relevance evaluation dan continuous improvement.

Part 033 mengikat semuanya ke domain nyata:

```text
enterprise / regulatory case management system
```

Contoh domain:

- enforcement case management;
- regulatory supervision;
- financial misconduct investigation;
- compliance case review;
- legal/audit document repository;
- complaint investigation;
- licensing/sanction workflow;
- government/public-sector case handling;
- internal risk/corporate investigation.

Dalam domain ini, search bukan fitur kecil. Search adalah:

```text
investigation tool
workflow navigation tool
evidence discovery tool
audit tool
compliance control
knowledge retrieval layer
decision-support layer
```

Kesalahan search bisa berdampak serius:

- investigator tidak menemukan kasus penting;
- dokumen sensitif bocor;
- legal-hold evidence hilang dari search;
- audit trail tidak lengkap;
- status case stale;
- precedent salah digunakan;
- RAG menjawab berdasarkan dokumen yang tidak boleh dilihat;
- regulatory decision didukung konteks yang salah.

Part ini membahas bagaimana mendesain search architecture untuk kondisi tersebut.

---

## 1. Core Thesis

Dalam enterprise/regulatory systems, Elasticsearch harus diperlakukan sebagai **secure derived retrieval platform**, bukan sekadar search database.

Artinya:

```text
Elasticsearch is not the source of legal truth.
Elasticsearch is a projection optimized for retrieval.
```

Source-of-truth tetap berada pada:

- transactional database;
- case management system;
- document management system;
- evidence store;
- authorization service;
- audit log system;
- legal hold system;
- records management system.

Elasticsearch menyimpan projection:

```text
source state → search documents → retrieval UX
```

Projection ini harus:

- searchable;
- fresh enough;
- permission-aware;
- auditable;
- repairable;
- explainable;
- evolvable;
- safe for RAG;
- aligned with domain lifecycle.

---

## 2. Domain Complexity

Regulatory case search berbeda dari ecommerce/blog search.

Mengapa?

### 2.1 Data Is Multi-Entity

Satu case bisa punya:

```text
case metadata
parties
allegations
evidence documents
notes
decisions
sanctions
appeals
workflow tasks
correspondence
audit events
legal hold records
related cases
attachments
OCR text
```

### 2.2 Access Is Contextual

Akses bisa bergantung pada:

```text
tenant
department
role
case assignment
investigation team
legal privilege
document classification
legal hold
external auditor scope
time-bound delegation
case phase
conflict-of-interest restriction
```

### 2.3 Lifecycle Matters

Case berubah fase:

```text
intake
triage
investigation
review
decision
sanction
appeal
closure
archive
legal hold
deletion/retention
```

Search must understand current state and sometimes historical state.

### 2.4 Auditability Matters

Anda harus bisa menjawab:

```text
Siapa mencari apa?
Kapan?
Hasil apa yang muncul?
Apakah user boleh melihat hasil itu?
Query versi apa?
Index versi apa?
```

### 2.5 Exactness and Semantics Both Matter

Users search:

```text
CASE-2026-000123
PT Contoh Abadi
Article 7 Disclosure Regulation
market manipulation pattern
similar precedent cases
why sanction was increased
```

This requires exact, lexical, semantic, and hybrid search together.

---

## 3. Core Architecture

High-level architecture:

```text
Source Systems
  - Case DB
  - Document store
  - Evidence repository
  - Authorization service
  - Workflow engine
  - Audit log
  - Legal hold / records retention
        |
        v
Event / Outbox / CDC
        |
        v
Search Projection Builder
        |
        v
Elasticsearch Indices
  - case metadata index
  - case document/passages index
  - party/entity index
  - policy/legal knowledge index
  - audit/search-event index
        |
        v
Search API / Retrieval API
        |
        v
User UX / Investigator tools / RAG assistant
```

Key design:

```text
Search API owns security, query planning, and response shaping.
Elasticsearch owns retrieval execution.
Source systems own truth.
```

---

## 4. Index Portfolio

Do not put everything into one index blindly.

Recommended index portfolio:

### 4.1 Case Metadata Index

Purpose:

```text
find cases
filter/facet cases
sort cases
workflow navigation
```

Document unit:

```text
one case = one document
```

Fields:

```text
caseId
caseNumber
tenantId
title
summary
status
phase
severity
priority
createdAt
updatedAt
assignedTeam
primaryPartyIds
primaryPartyNames
allegationTypes
jurisdiction
legalHold
visibilityScopes
```

### 4.2 Case Passage / Document Index

Purpose:

```text
search evidence text, decisions, notes, policies, OCR, attachments
RAG passage retrieval
highlighting
semantic search
```

Document unit:

```text
one passage/chunk = one document
```

Fields:

```text
chunkId
caseId
documentId
tenantId
sourceType
section
pageNumber
text
embedding/semantic_text
classification
legalHold
visibilityScopes
sourceUpdatedAt
```

### 4.3 Party / Entity Index

Purpose:

```text
search parties, organizations, people, aliases, identifiers
```

Document unit:

```text
one party/entity = one document
```

Fields:

```text
partyId
tenantId
name
aliases
registrationNumber
type
riskCategory
relatedCaseIds
visibilityScopes
```

### 4.4 Policy / Legal Knowledge Index

Purpose:

```text
retrieve official procedures, laws, regulations, guidance
RAG over authoritative sources
```

Document unit:

```text
section/chapter/passage
```

Fields:

```text
sourceId
version
effectiveDate
status
sectionTitle
text
authorityLevel
jurisdiction
visibilityScopes
supersededBy
```

### 4.5 Search/Audit Analytics Index

Purpose:

```text
query analytics
search audit
quality improvement
security review
```

Do not mix this with operational case search.

---

## 5. Case Metadata Document Design

Example:

```json
{
  "caseId": "case-123",
  "caseNumber": "CASE-2026-000123",
  "tenantId": "tenant-a",
  "title": "Suspected Market Manipulation by PT Contoh Abadi",
  "summary": "Investigation into coordinated trading activity...",
  "status": "ACTIVE",
  "phase": "INVESTIGATION",
  "severity": "HIGH",
  "priority": "P1",
  "createdAt": "2026-01-10T10:00:00Z",
  "updatedAt": "2026-06-20T12:00:00Z",
  "lastActivityAt": "2026-06-21T09:00:00Z",
  "primaryPartyIds": ["party-001"],
  "primaryPartyNames": ["PT Contoh Abadi"],
  "allegationTypes": ["MARKET_MANIPULATION"],
  "jurisdiction": "ID",
  "legalHold": true,
  "visibilityScopes": [
    "tenant:tenant-a",
    "department:enforcement",
    "case-team:case-123"
  ],
  "schemaVersion": "case-search-v033"
}
```

Mapping principles:

- identifiers as `keyword`;
- names as `text` + `keyword`/normalizer/subfields;
- statuses as `keyword`;
- dates as `date`;
- permission scopes as `keyword`;
- summary/title as `text` with domain analyzer;
- ranking signals as numeric/rank_feature where appropriate.

---

## 6. Passage Document Design

Example:

```json
{
  "chunkId": "case-123:decision-77:section-4:chunk-002",
  "caseId": "case-123",
  "documentId": "decision-77",
  "tenantId": "tenant-a",
  "sourceType": "DECISION",
  "sectionTitle": "Sanction reasoning",
  "pageNumber": 12,
  "text": "The panel imposed an administrative sanction because...",
  "language": "en",
  "classification": "RESTRICTED",
  "legalHold": true,
  "documentStatus": "PUBLISHED",
  "visibilityScopes": [
    "tenant:tenant-a",
    "department:enforcement",
    "case-team:case-123"
  ],
  "sourceUpdatedAt": "2026-06-20T08:00:00Z",
  "embeddingModel": "model-v2",
  "embeddingGeneratedAt": "2026-06-20T08:10:00Z"
}
```

Important:

```text
Every passage has its own permission metadata.
```

Do not assume if user can see case, user can see every evidence chunk.

---

## 7. Retrieval Unit Design

Choose retrieval unit based on UX.

### Case Search UX

User wants cases:

```text
one case result card
facets by status/severity/team
sort by activity/priority
```

Use case metadata index.

### Evidence Search UX

User wants evidence passages:

```text
matching document excerpts
highlighted pages
filter by evidence type
```

Use passage/document index.

### RAG Q&A

LLM needs grounded context:

```text
small authoritative passages with citation metadata
```

Use passage index + policy index.

### Similar Case Discovery

User wants related cases:

```text
case-level summary vectors
or passage-level retrieval grouped by case
```

Use semantic/hybrid + collapse/group.

Do not force all use cases into one index.

---

## 8. Permission Model

There are two broad strategies:

### 8.1 Application-Level Permission Filtering

Java Search API builds permission filter:

```json
{
  "bool": {
    "filter": [
      { "term": { "tenantId": "tenant-a" }},
      { "terms": { "visibilityScopes": ["department:enforcement", "case-team:case-123"] }}
    ]
  }
}
```

Pros:

- full control;
- domain-specific;
- easier to integrate with existing authorization service;
- explicit in query tests.

Cons:

- every query must include filter;
- bug can leak data;
- must test thoroughly;
- direct ES access must be restricted.

### 8.2 Elasticsearch Document/Field-Level Security

Elastic supports controlling access at document and field level by adding document/field-level security permissions to roles. Field-level security restricts fields users can read, and document-level security restricts documents users can read from read APIs. Elastic notes DLS/FLS is meant for read-only privileged accounts and users with DLS/FLS enabled should not perform write operations. citeturn978051search0

Pros:

- enforcement inside Elasticsearch;
- useful for direct Kibana/search access;
- role-based boundary;
- defense-in-depth.

Cons:

- role/query complexity;
- license/subscription considerations;
- read-only limitation considerations;
- dynamic domain permissions can be hard;
- application still needs UX-level shaping.

### 8.3 Recommended Practical Approach

For many enterprise apps:

```text
1. Restrict direct ES access.
2. Use Java Search API as main access boundary.
3. Enforce tenant/security filters in all query builders.
4. Use ES DLS/FLS where appropriate for defense-in-depth/admin/search apps.
5. Add query contract tests to ensure security filters cannot be omitted.
```

Do not rely on filtered aliases as security boundary. Elastic security limitations documentation states filtered index aliases are not secure for restricting access to individual documents and recommends Elastic Stack security features such as document-level security for that purpose. citeturn978051search13

---

## 9. Permission Filter Invariants

Every user-facing query must include:

```text
tenant filter
+ visibility/permission filter
+ lifecycle/status constraints where applicable
```

Invariant:

```text
No permission filter → no query execution.
```

Java pattern:

```java
public SearchRequest build(SearchCommand command, UserContext user) {
    PermissionContext permission = permissionService.build(user);

    if (permission.scopes().isEmpty()) {
        return noResultsRequest();
    }

    return boolQuery()
        .filter(term("tenantId", user.tenantId()))
        .filter(terms("visibilityScopes", permission.scopes()))
        .must(buildUserQuery(command));
}
```

Do not allow optional security filters.

---

## 10. Field-Level Exposure

Even if document is visible, not every field should be returned.

Sensitive fields:

```text
internalNotes
legalStrategy
confidentialEvidenceText
whistleblowerIdentity
privilegedCommunication
securityLabels
visibilityScopes
rawEmbedding
```

Use:

- `_source` filtering;
- DTO response mapping;
- FLS if appropriate;
- separate indices for restricted content;
- source-level permission metadata.

Bad:

```text
return full _source to frontend
```

Better:

```text
Search API maps ES hit to safe response DTO.
```

---

## 11. Facets Can Leak Data

Facet counts can reveal restricted information.

Example:

```text
User cannot see restricted cases,
but facet shows:
"Market Manipulation: 3"
```

That leaks existence.

Rule:

```text
Permission filter must be inside main query/filter used for aggregations.
```

Avoid computing aggs on broader set then post-filtering hits.

---

## 12. Highlight Can Leak Data

Highlight snippets can expose restricted text from a document/field.

Guardrails:

- highlight only allowed fields;
- filter `_source`;
- enforce field-level permission before highlight;
- for passages, ensure chunk itself is visible;
- test restricted highlight scenarios.

---

## 13. Autocomplete Can Leak Data

Autocomplete suggestions can reveal:

- restricted case numbers;
- party names;
- investigation topics;
- confidential organizations.

Options:

1. permission-aware autocomplete;
2. public/non-sensitive suggestion index;
3. minimum prefix length;
4. role-scoped suggestions;
5. no autocomplete for sensitive fields.

Do not build global autocomplete over restricted case titles without permission filtering.

---

## 14. RAG Can Leak Data

RAG is especially risky.

Wrong pattern:

```text
retrieve all relevant chunks
→ pass to LLM
→ ask LLM not to reveal restricted data
```

Correct pattern:

```text
permission filter before retrieval
→ context contains only authorized chunks
→ answer only from authorized context
```

Elastic describes RAG as grounding model responses with additional, verifiable sources retrieved from an external datastore. citeturn978051search15 In regulated systems, “verifiable sources” must also be authorized sources.

---

## 15. Auditability

Auditability has two layers:

### 15.1 Elasticsearch Security Audit Logging

Elastic audit logging helps monitor and track security-related events such as authentication attempts and authorization decisions, and provides forensic evidence in the event of an attack. Audit logs can be enabled independently for Elasticsearch and Kibana, subject to subscription level. citeturn978051search12

### 15.2 Application Search Audit

You also need application-level search audit:

```json
{
  "event": "case_search_executed",
  "requestId": "req-123",
  "userId": "user-001",
  "tenantId": "tenant-a",
  "roles": ["INVESTIGATOR"],
  "queryClass": "NATURAL_LANGUAGE",
  "indexAlias": "cases-search-read",
  "indexVersion": "cases-search-v033",
  "filtersApplied": ["tenant", "visibilityScopes", "status"],
  "resultCount": 42,
  "topResultIdsHash": "hash",
  "timestamp": "2026-06-22T10:00:00Z"
}
```

Do not necessarily log raw query/result body in broad logs. Queries and results may be sensitive.

---

## 16. Audit Questions To Answer

Your system should be able to answer:

```text
Who searched for case X?
Who accessed restricted document Y?
What query produced result Z?
Was permission filter applied?
Which index version served the result?
Was RAG answer based on which chunks?
Were those chunks authorized?
Was a deleted/redacted document returned?
```

This requires:

- request IDs;
- user context;
- query class;
- safe query fingerprint;
- index alias/version;
- retrieval metadata;
- citation metadata for RAG;
- security decision logs;
- retention policy.

---

## 17. Legal Hold and Records Retention

Legal hold means certain data must be preserved and controlled.

Search implications:

- legal-hold documents must not be accidentally deleted from search;
- legal-hold status should be searchable/filterable for authorized users;
- legal-hold content may be restricted;
- restore/rebuild must preserve legal-hold metadata;
- RAG should not ignore legal-hold boundaries;
- deletion workflows must respect legal hold.

Records retention:

```text
active search index
archive search index
restricted legal-hold index
deleted/anonymized search projection
```

Do not implement ILM deletion without legal/records governance.

---

## 18. Case Lifecycle Search

Case lifecycle states affect search.

Example lifecycle:

```text
INTAKE
TRIAGE
INVESTIGATION
REVIEW
DECISION
SANCTION
APPEAL
CLOSED
ARCHIVED
LEGAL_HOLD
```

Search behavior:

- investigators need active/investigation cases;
- managers need escalation queues;
- auditors need historical closed cases;
- external users may only see published decisions;
- RAG should prefer current/published/authoritative sources.

Mapping:

```json
{
  "status": { "type": "keyword" },
  "phase": { "type": "keyword" },
  "closedAt": { "type": "date" },
  "archivedAt": { "type": "date" },
  "legalHold": { "type": "boolean" }
}
```

---

## 19. Workflow Search

Enterprise users often search tasks, not just documents.

Examples:

```text
my assigned cases
cases pending review
cases approaching SLA breach
cases with missing evidence
cases requiring legal approval
appeal due this week
```

This is structured search + ranking.

Index fields:

```text
assignedUserIds
assignedTeamIds
slaDueAt
pendingAction
workflowState
escalationLevel
lastActivityAt
blockedReason
```

Queries:

```text
filter assignedTeam
filter workflowState
sort by slaDueAt
boost escalationLevel
```

Search should support operational workflows, not just text search.

---

## 20. Investigator Search UX

Investigator UX often needs multiple search modes:

```text
1. Exact case lookup
2. Party/entity lookup
3. Evidence text search
4. Similar case discovery
5. Faceted case exploration
6. Saved alerts/watchlists
7. Timeline search
8. RAG-assisted Q&A
```

Each mode should have different query planning.

Bad UX:

```text
one search box does everything with one query strategy
```

Better:

```text
universal search box classifies intent
+ specialized tabs/filters
+ exact match priority
+ safe semantic expansion
```

---

## 21. Universal Search Design

Universal search can query multiple indices:

```text
case metadata
party/entity
document passages
policy/legal knowledge
```

Response grouping:

```json
{
  "cases": [...],
  "parties": [...],
  "documents": [...],
  "policies": [...]
}
```

Important:

- do not merge scores naively across indices;
- show result type;
- enforce permission per index;
- cap results per group;
- prioritize exact matches;
- use query classifier.

---

## 22. Exact Match Priority

For regulatory systems, exact match should dominate.

If query looks like:

```text
CASE-2026-000123
DOC-9981
REG-12/2024
PT ABC
```

Then strategy:

```text
1. exact keyword query
2. normalized exact query
3. prefix/fuzzy only as fallback
4. semantic search optional, not dominant
```

Exact case number should not be outranked by semantically similar cases.

---

## 23. Entity Search

Party/entity search should handle:

- legal names;
- aliases;
- spelling variations;
- abbreviations;
- registration numbers;
- old names;
- person names;
- organizations;
- transliteration.

Mapping pattern:

```text
name.text
name.keyword
name.normalized
aliases.text
aliases.keyword
registrationNumber.keyword
```

Query pattern:

```text
exact registration number boost highest
exact normalized name high
match phrase name
fuzzy name only controlled
alias match
```

Avoid broad fuzzy for short names; it creates noisy results.

---

## 24. Evidence Search

Evidence search needs:

- document type filter;
- source system;
- chain-of-custody metadata;
- OCR confidence;
- page number;
- file version;
- classification;
- legal privilege;
- evidence status;
- highlight/snippet.

Index passages rather than entire huge documents when:

- documents are long;
- RAG needed;
- highlight must be precise;
- page-level citation needed.

---

## 25. OCR and Attachments

OCR text quality can be poor.

Search implications:

- OCR confidence field;
- language detection;
- page-level chunks;
- noisy tokens;
- scanned document artifacts;
- duplicate headers/footers;
- correction pipeline.

Fields:

```text
ocrText
ocrConfidence
pageNumber
documentId
documentVersion
sourceFileHash
```

Ranking:

```text
boost high OCR confidence
do not overtrust low-confidence matches
show page image/link when possible
```

---

## 26. Audit Trail Search

Audit search differs from case search.

It is usually:

- structured;
- time-based;
- user/action/entity oriented;
- append-only;
- high integrity.

Fields:

```text
eventId
actorUserId
tenantId
action
entityType
entityId
timestamp
ipAddress
requestId
outcome
```

Search patterns:

```text
who accessed case X
what did user Y search
changes to case Z last month
failed authorization attempts
```

Audit index should have stricter retention/security.

---

## 27. Domain-Specific Relevance

General BM25 is not enough.

Domain relevance signals:

```text
exact case number
current active status
assigned to user/team
severity
priority
last activity
legal hold
decision authority
case phase
party role
document type authority
source status published/draft
```

Example ranking:

```text
exact identifier > exact party > title match > summary match > body match
active cases boost
assigned cases boost
published official documents boost
draft notes restricted
```

But ranking must not override permission.

---

## 28. Regulatory Metadata

Useful metadata:

```text
caseType
allegationType
sector
jurisdiction
legalBasis
regulationReference
supervisoryUnit
riskCategory
severity
sanctionType
decisionOutcome
appealStatus
publicationStatus
confidentialityLevel
retentionClass
legalHold
```

Metadata supports:

- filters;
- facets;
- ranking;
- reporting;
- RAG source selection;
- audit.

Metadata quality is relevance quality.

---

## 29. Source Authority

Not all documents have equal authority.

Authority levels:

```text
official regulation
published decision
final internal decision
approved investigation report
draft note
OCR attachment
email correspondence
user comment
```

For RAG, source authority matters heavily.

Rule:

```text
Policy questions should retrieve official policy/regulation before case notes.
Case reasoning questions should retrieve decisions/reports before comments.
```

Represent authority:

```json
{
  "sourceAuthority": "PUBLISHED_DECISION",
  "authorityRank": 90
}
```

---

## 30. RAG In Regulated Environment

Use RAG for:

- summarizing authorized case evidence;
- answering policy/procedure questions;
- finding similar precedents;
- explaining search result clusters;
- assisting investigators.

Do not use RAG as:

- final legal decision maker;
- substitute for official source;
- bypass for access control;
- oracle without citations.

RAG answer requirements:

```text
must cite sources
must indicate uncertainty
must not answer beyond retrieved context
must respect current/superseded status
must not use restricted chunks
must preserve distinction between allegation and finding
```

---

## 31. RAG Retrieval Modes

### 31.1 Case-Scoped Q&A

```text
question + caseId
→ retrieve only authorized chunks from that case
```

Use for:

```text
"Why was this case escalated?"
```

### 31.2 Policy Q&A

```text
question
→ retrieve only current approved policy/legal sources
```

Use for:

```text
"What is the escalation procedure?"
```

### 31.3 Similar Case Q&A

```text
question/facts
→ retrieve closed/published/authorized similar cases
```

Use for:

```text
"Find cases similar to this allegation."
```

### 31.4 Audit Q&A

Be careful. Audit answers should be exact/structured, not free semantic speculation.

---

## 32. RAG Context Safety

Context assembly must enforce:

```text
tenant
permission
source status
authority
current version
legal hold
redaction
token budget
citation metadata
```

Example retrieved chunk DTO:

```java
public record RetrievedChunk(
    String chunkId,
    String caseId,
    String documentId,
    String sourceType,
    String title,
    String section,
    Integer page,
    String text,
    Set<String> visibilityScopes,
    String authority,
    Instant sourceUpdatedAt
) {}
```

Before passing to LLM:

```java
if (!permissionService.canRead(user, chunk)) {
    throw new SecurityException("Unauthorized chunk in RAG context");
}
```

Defense-in-depth.

---

## 33. Indexing Pipeline

Projection flow:

```text
case changed
→ event emitted
→ indexer fetches latest source state
→ builds case metadata doc
→ indexes case doc
→ if document changed, builds chunks
→ embeds chunks
→ indexes passage docs
→ deletes stale chunks
```

Important:

- fetch latest from source to avoid event ordering issues;
- deterministic IDs;
- handle deletes/tombstones;
- track schema version;
- track projection version;
- track embedding model version;
- DLQ failures;
- reconciliation.

---

## 34. Consistency and Freshness

Freshness requirements differ:

| Data | Freshness Need |
|---|---|
| case status | high |
| permission changes | very high |
| legal hold | very high |
| evidence OCR | medium |
| semantic embeddings | medium |
| archive docs | low |
| audit events | high/integrity |

Permission freshness is security-critical.

If user loses access, search result must stop showing restricted data quickly.

Design:

```text
permission changes trigger reindex/repair
or query-time permission filters based on current auth service
```

For highly dynamic permissions, query-time permission context is safer than fully materialized static permission fields alone.

---

## 35. Reconciliation

Reconciliation is mandatory.

Checks:

```text
source case count vs ES case count
recent updates searchable
deleted cases absent/restricted
permission field matches auth model
legal hold matches records system
published policy versions current
embedding lag acceptable
```

Sample or full:

```text
nightly sample
weekly full tenant
after migration full critical set
after incident targeted
```

---

## 36. Schema Evolution In Domain

Domain schema changes are common:

```text
new case phase
new allegation taxonomy
new permission model
new legal hold policy
new party type
new document classification
new source authority ranking
new regulation reference model
```

Use Part 025 playbook:

```text
new versioned index
backfill
catch-up
verification
permission tests
alias swap
rollback
```

Domain-specific gates:

```text
case lifecycle counts match
permission matrix pass
legal hold test pass
exact case lookup pass
RAG sources authorized
```

---

## 37. Capacity Planning Domain View

Capacity drivers:

```text
number of cases
number of documents per case
OCR text size
chunks per document
embedding dimensions
retention years
replica count
audit event volume
query QPS
RAG retrieval QPS
export workloads
```

Vector/RAG can multiply index size:

```text
one case → many documents → many chunks → many vectors
```

Plan capacity from domain cardinalities, not only current index size.

---

## 38. Multi-Tenancy

Strategies:

### Shared Index With `tenantId`

Pros:

- simpler operations;
- fewer shards;
- efficient for many small tenants.

Cons:

- strict security filter required;
- noisy neighbor risk;
- tenant-specific restore harder.

### Per-Tenant Index

Pros:

- isolation;
- easier tenant restore/delete;
- per-tenant scaling.

Cons:

- many indices/shards;
- operational overhead;
- cross-tenant analytics harder.

### Hybrid

```text
large tenants get dedicated indices
small tenants share pooled indices
```

Choose based on tenant count, data skew, security, restore needs, and operations.

---

## 39. Regulatory Search API Design

Endpoints:

```http
POST /cases/search
POST /cases/{caseId}/documents/search
POST /cases/{caseId}/ask
POST /cases/similar
POST /parties/search
POST /policies/search
POST /policies/ask
POST /audit/search
```

Avoid exposing raw ES DSL.

Request:

```json
{
  "query": "market manipulation",
  "filters": {
    "status": ["ACTIVE"],
    "severity": ["HIGH"]
  },
  "page": {
    "size": 20,
    "cursor": null
  }
}
```

Response:

```json
{
  "items": [
    {
      "caseId": "case-123",
      "caseNumber": "CASE-2026-000123",
      "title": "Suspected Market Manipulation",
      "status": "ACTIVE",
      "highlights": {
        "summary": ["...<em>market manipulation</em>..."]
      }
    }
  ],
  "facets": {
    "status": [
      { "value": "ACTIVE", "count": 12 }
    ]
  }
}
```

No internal fields:

```text
visibilityScopes
raw embeddings
_score unless intentionally exposed
_index
```

---

## 40. Java Domain Layer

Classes:

```text
CaseSearchCommand
EvidenceSearchCommand
PolicyAskCommand
SearchUserContext
PermissionContext
RetrievalPlan
CaseSearchQueryBuilder
EvidenceQueryBuilder
RagRetrievalService
SearchAuditLogger
SearchResultMapper
```

Invariant:

```text
QueryBuilder cannot build query without PermissionContext.
```

Example:

```java
public final class CaseSearchQueryBuilder {
    public SearchRequest build(CaseSearchCommand command, PermissionContext permission) {
        requireNonNull(permission);

        BoolQuery.Builder bool = new BoolQuery.Builder()
            .filter(term("tenantId", permission.tenantId()))
            .filter(terms("visibilityScopes", permission.visibilityScopes()));

        applyUserQuery(bool, command.query());
        applyFilters(bool, command.filters());

        return new SearchRequest.Builder()
            .index("cases-search-read")
            .query(q -> q.bool(bool.build()))
            .size(command.pageSize())
            .build();
    }
}
```

---

## 41. Testing Matrix

Test categories:

```text
mapping contract
query contract
permission matrix
facet security
highlight security
autocomplete security
RAG context security
exact identifier
entity search
lifecycle filters
legal hold
deleted/redacted docs
freshness
relevance golden queries
migration verification
DR restore verification
```

Permission matrix example:

```text
same team investigator
other team investigator
manager
external auditor
tenant admin
no access user
legal privileged user
```

Each must be tested against hits, facets, highlights, suggestions, exports, and RAG context.

---

## 42. Operational Dashboards

Dashboards:

### Case Search

```text
latency
QPS
zero-result rate
top query classes
exact lookup success
facet usage
tenant breakdown
```

### Ingestion/Freshness

```text
case indexing lag
document chunking lag
embedding lag
permission update lag
DLQ
reconciliation mismatch
```

### Security

```text
permission filter missing count
cross-tenant attempt
denied result count
audit events
RAG blocked context
```

### RAG

```text
retrieval hit rate
context size
citation coverage
unsupported answer feedback
fallback count
embedding provider latency
```

---

## 43. Incident Scenarios

### 43.1 Permission Field Corruption

Impact:

```text
possible data leak
```

Response:

```text
disable affected search/RAG
fix projection
rebuild permission fields
run permission matrix
audit exposure
```

### 43.2 Case Status Stale

Impact:

```text
workflow decisions wrong
```

Response:

```text
trace event
repair affected cases
reconciliation
freshness alert tuning
```

### 43.3 RAG Cites Superseded Policy

Impact:

```text
wrong guidance
```

Response:

```text
filter current approved policies
add sourceAuthority/currentVersion fields
update RAG retrieval tests
```

### 43.4 Autocomplete Leaks Restricted Party

Impact:

```text
sensitive existence leak
```

Response:

```text
disable autocomplete
rebuild suggestion index with permission/allowlist
add security test
```

---

## 44. Production Readiness Checklist

```text
[ ] Source-of-truth boundaries documented
[ ] Index portfolio designed by retrieval unit
[ ] Permission model explicit
[ ] Tenant/security filters mandatory
[ ] Direct ES access restricted
[ ] DLS/FLS considered where appropriate
[ ] Field exposure controlled by DTO/source filtering
[ ] Facets/highlights/autocomplete permission-tested
[ ] RAG context permission-tested
[ ] Legal hold and retention policy integrated
[ ] Case lifecycle fields modeled
[ ] Exact identifier path implemented
[ ] Entity search implemented separately
[ ] Passage index supports citations
[ ] Search audit logging implemented
[ ] Reconciliation jobs implemented
[ ] Freshness metrics implemented
[ ] Golden query set includes domain queries
[ ] DR/restore tests include permission and legal hold
```

---

## 45. Anti-Patterns

### 45.1 One Giant Index For Everything

Creates permission, relevance, lifecycle, and capacity problems.

### 45.2 Full `_source` Returned To UI

Leaks internal/sensitive fields.

### 45.3 Permission As Post-Processing

Filtering after retrieval can leak via facets/highlights/RAG context.

### 45.4 RAG Over All Documents

Unsafe. RAG must retrieve authorized, current, authoritative chunks.

### 45.5 Semantic Search For Exact Legal References

Use exact/lexical for legal references.

### 45.6 Ignoring Legal Hold In ILM

Can delete legally preserved data.

### 45.7 No Reconciliation

You cannot prove search index matches source truth.

### 45.8 No Search Audit

You cannot investigate misuse or exposure.

### 45.9 One Ranking Strategy For All Users

Investigator, auditor, manager, and public user have different intents.

### 45.10 Filtered Alias As Security Boundary

Filtered aliases are not secure document-level access control according to Elastic security limitations. Use proper security controls and application-level enforcement. citeturn978051search13

---

## 46. End-to-End Example Architecture

```text
PostgreSQL Case DB
Document Store
Authorization Service
Workflow Engine
Legal Hold Service
        |
        v
Outbox/Kafka
        |
        v
Search Indexer
  - CaseProjectionBuilder
  - EvidenceChunker
  - EmbeddingGenerator
  - PermissionProjection
        |
        v
Elasticsearch
  - cases-search-v033
  - case-passages-v033
  - parties-search-v033
  - policies-search-v033
        |
        v
Java Search API
  - intent classification
  - permission context
  - query builders
  - hybrid retrieval
  - RAG retrieval
  - safe response DTO
  - audit logging
        |
        v
Investigator UI / Audit UI / RAG Assistant
```

---

## 47. Summary

Enterprise/regulatory search is not just “put documents into Elasticsearch”.

It requires:

1. source-of-truth clarity;
2. retrieval-unit-specific indices;
3. mandatory permission filtering;
4. safe field exposure;
5. facet/highlight/autocomplete security;
6. auditability;
7. legal hold and retention integration;
8. lifecycle-aware search;
9. exact + lexical + semantic retrieval modes;
10. RAG only over authorized, authoritative, current chunks;
11. reconciliation and repair;
12. relevance evaluation by domain query type;
13. operational dashboards and incident playbooks.

Core mental model:

```text
Regulatory Elasticsearch is a secure, auditable, derived retrieval platform.
Its job is not merely to find documents.
Its job is to retrieve the right authorized evidence for the right user at the right lifecycle moment.
```

---

## 48. What Comes Next

Part 034 will be the final capstone:

```text
End-to-End Capstone: Production-Grade Java + Elasticsearch Search Platform
```

It will combine the entire series into a practical reference architecture:

- Java service design;
- index definitions;
- query builders;
- ingestion pipeline;
- permission-aware search;
- hybrid/RAG retrieval;
- migration strategy;
- observability;
- incident/DR readiness;
- testing strategy;
- production checklist.

---

## References

- Elastic Docs — Controlling access at the document and field level: https://www.elastic.co/docs/deploy-manage/users-roles/cluster-or-deployment-auth/controlling-access-at-document-field-level
- Elastic Docs — Security limitations: https://www.elastic.co/docs/deploy-manage/security/limitations
- Elastic Docs — Security event audit logging: https://www.elastic.co/docs/deploy-manage/security/logging-configuration/security-event-audit-logging
- Elastic Docs — Enable audit logging: https://www.elastic.co/docs/deploy-manage/security/logging-configuration/enabling-audit-logs
- Elastic Docs — User roles: https://www.elastic.co/docs/deploy-manage/users-roles/cluster-or-deployment-auth/user-roles
- Elastic Docs — Semantic search: https://www.elastic.co/docs/solutions/search/semantic-search
- Elastic Docs — Hybrid search with semantic_text: https://www.elastic.co/docs/solutions/search/hybrid-semantic-text
- Elastic Docs — RAG: https://www.elastic.co/docs/solutions/search/rag
- Elastic Docs — Field data types: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/field-data-types

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-032.md">⬅️ Part 032 — Relevance Testing, Evaluation, and Continuous Improvement</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-034.md">Part 034 — End-to-End Capstone: Production-Grade Java + Elasticsearch Search Platform ➡️</a>
</div>
