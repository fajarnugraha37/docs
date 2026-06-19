# learn-sql-mastery-for-java-engineers-part-013.md

# Part 13 — Schema Design and Normalization

> Seri: SQL Mastery for Java Engineers  
> Bagian: 013 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-012.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-014.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas constraints sebagai business invariants.

Sekarang kita membahas pertanyaan yang lebih mendasar:

```text
Bagaimana seharusnya fakta bisnis disusun menjadi tabel, kolom, key, relationship, dan history?
```

Ini adalah inti **schema design**.

Schema design bukan sekadar membuat table agar aplikasi bisa menyimpan data.

Schema adalah:

- model fakta bisnis
- kontrak paling tahan lama dalam sistem
- API internal untuk semua service, job, report, migration, dan manusia
- batas invariant
- fondasi query correctness
- fondasi performance
- fondasi auditability
- fondasi evolusi sistem

Schema yang buruk membuat query sulit, constraint lemah, data redundancy berbahaya, dan bug concurrency tersembunyi.

Schema yang baik membuat query sederhana, invariant natural, data lebih dipercaya, dan sistem lebih mudah berkembang.

Bagian ini membahas:

- entity vs attribute vs relationship
- table sebagai kumpulan fakta
- functional dependency
- normal forms
- 1NF, 2NF, 3NF, BCNF secara praktis
- denormalization yang disengaja
- lookup/reference table
- current state vs history
- audit table
- relationship modelling
- optionality
- multi-tenancy
- temporal modelling
- schema evolution
- Java/ORM implications
- review checklist

Kalimat inti:

> Normalization bukan ritual akademik; normalization adalah cara mengurangi kebohongan, redundancy berbahaya, dan update anomaly dalam data production.

---

## 1. Schema Design Dimulai dari Fakta, Bukan Class

Sebagai Java engineer, refleks alami adalah mulai dari object:

```java
class Case {
    UUID id;
    String caseNumber;
    String status;
    Officer assignedOfficer;
    List<Evidence> evidences;
}
```

Lalu langsung membuat table:

```sql
cases(
    id,
    case_number,
    status,
    assigned_officer_id,
    evidences_json
)
```

Ini bisa terlalu object-centric.

Relational design dimulai dari fakta:

```text
A case exists.
A case has a case number within a tenant.
A case currently has a status.
A case may have many status transitions.
An officer exists.
A case can be assigned to an officer over a time interval.
A case can have many evidence records.
Evidence is received at a point in time.
A party can participate in many cases.
A case can involve many parties.
```

Setiap fakta punya grain, key, dependency, dan lifecycle.

---

## 2. Table sebagai Predicate

Dari part awal:

```text
Table merepresentasikan predicate.
```

Contoh:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_number TEXT NOT NULL,
    status TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL
);
```

Predicate:

```text
Case with id exists in tenant, has case number, current status, and opened timestamp.
```

Table:

```sql
CREATE TABLE case_assignments (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL,
    officer_id UUID NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ
);
```

Predicate:

```text
Officer was assigned to case starting at assigned_at and optionally ending at ended_at.
```

Jika kamu tidak bisa menulis predicate table dengan jelas, desain table mungkin belum matang.

---

## 3. Grain Table

Setiap table harus punya grain.

Contoh:

```sql
cases
```

Grain:

```text
one row per case
```

```sql
case_evidences
```

Grain:

```text
one row per evidence item received for a case
```

```sql
case_assignments
```

Grain:

```text
one row per assignment interval of an officer to a case
```

```sql
case_status_transitions
```

Grain:

```text
one row per status transition event for a case
```

Grain membantu menjawab:

- apa primary key?
- apa foreign key?
- apa unique constraint?
- apakah kolom ini belong di table ini?
- apakah join akan multiply rows?
- apakah aggregate count benar?
- apakah update akan mengubah satu fakta atau banyak fakta?

---

## 4. Entity, Attribute, Relationship, Event

Dalam schema design, bedakan:

### 4.1 Entity

Sesuatu yang punya identity dan lifecycle.

Contoh:

```text
case
officer
party
evidence
enforcement action
document
```

### 4.2 Attribute

Properti dari entity yang bergantung pada entity key.

Contoh:

```text
case.status
case.opened_at
officer.full_name
party.legal_name
```

### 4.3 Relationship

Fakta hubungan antar entity.

Contoh:

```text
case assigned to officer
case involves party
evidence belongs to case
officer belongs to organization unit
```

Relationship bisa punya atribut sendiri:

```text
assigned_at
ended_at
role
```

Jika relationship punya atribut, biasanya butuh table sendiri.

### 4.4 Event

Fakta bahwa sesuatu terjadi pada waktu tertentu.

Contoh:

```text
case opened
case escalated
evidence received
assignment changed
decision issued
note deleted
```

Event biasanya append-only dan temporal.

---

## 5. Functional Dependency

Functional dependency adalah konsep penting normalization.

Secara sederhana:

```text
A -> B
```

berarti jika kamu tahu A, kamu tahu B.

Contoh:

```text
case_id -> case_number
case_id -> opened_at
case_id -> current_status
```

Jika `case_id` menentukan `case_number`, maka `case_number` bergantung pada `case_id`.

Composite example:

```text
(tenant_id, case_number_normalized) -> case_id
```

Artinya dalam tenant tertentu, case number menentukan case.

### 5.1 Dependency yang Salah Tempat

Table:

```sql
case_notes(
    note_id,
    case_id,
    case_number,
    note_text
)
```

Dependency:

```text
note_id -> case_id
case_id -> case_number
```

`case_number` bergantung pada `case_id`, bukan pada `note_id` secara langsung.

Menyimpan `case_number` di `case_notes` membuat redundancy.

Jika case_number dikoreksi, semua notes harus update.

Lebih baik:

```sql
case_notes(note_id, case_id, note_text)
cases(case_id, case_number)
```

Join saat perlu case_number.

---

## 6. Update Anomalies

Normalization menghindari anomalies.

### 6.1 Update Anomaly

Jika case_number disimpan di banyak table:

```text
cases.case_number
case_notes.case_number
case_evidences.case_number
case_assignments.case_number
```

Saat case_number berubah, harus update semua tempat.

Jika satu table lupa, data inconsistent.

### 6.2 Insert Anomaly

Jika officer data hanya bisa disimpan bersama assignment:

```sql
case_assignment_report(
    case_id,
    officer_id,
    officer_name,
    assignment_date
)
```

Kamu tidak bisa menyimpan officer baru yang belum punya assignment.

### 6.3 Delete Anomaly

Jika satu-satunya record officer ada di assignment row, menghapus assignment terakhir dapat menghapus informasi officer.

Normalization memisahkan fakta agar tidak saling menghancurkan.

---

## 7. First Normal Form / 1NF

1NF secara praktis:

```text
Setiap kolom menyimpan value atomic dalam domainnya, bukan repeating group/list tersembunyi.
```

Bad:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    evidence_ids TEXT
);
```

Value:

```text
"E1,E2,E3"
```

Problems:

- tidak bisa FK ke evidence
- query sulit
- index sulit
- delete/update item sulit
- duplicate sulit dicegah
- integrity tidak ada
- parsing di aplikasi

Better:

```sql
CREATE TABLE case_evidences (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id),
    evidence_type TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL
);
```

### 7.1 JSON dan 1NF

JSON column:

```sql
payload JSONB
```

tidak otomatis buruk.

JSON cocok untuk:

- raw external payload
- metadata fleksibel
- rarely queried optional attributes
- audit snapshot

JSON buruk jika menyimpan core relational facts:

```json
{
  "assignments": [
    {"officerId": "...", "role": "PRIMARY"}
  ]
}
```

Jika kamu perlu query, join, constrain, update independently, atau enforce uniqueness, itu mungkin harus table.

---

## 8. Second Normal Form / 2NF

2NF relevan untuk composite key.

Praktis:

```text
Setiap non-key column harus bergantung pada seluruh composite key, bukan sebagian.
```

Bad:

```sql
CREATE TABLE case_party_roles (
    case_id UUID,
    party_id UUID,
    party_name TEXT,
    role TEXT,
    PRIMARY KEY (case_id, party_id)
);
```

Dependency:

```text
party_id -> party_name
(case_id, party_id) -> role
```

`party_name` hanya bergantung pada `party_id`, bukan seluruh key.

Better:

```sql
CREATE TABLE parties (
    id UUID PRIMARY KEY,
    party_name TEXT NOT NULL
);

CREATE TABLE case_parties (
    case_id UUID NOT NULL REFERENCES cases(id),
    party_id UUID NOT NULL REFERENCES parties(id),
    role TEXT NOT NULL,
    PRIMARY KEY (case_id, party_id)
);
```

---

## 9. Third Normal Form / 3NF

3NF secara praktis:

```text
Non-key column tidak boleh bergantung pada non-key column lain.
```

Bad:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    jurisdiction_code TEXT NOT NULL,
    jurisdiction_name TEXT NOT NULL
);
```

Dependency:

```text
jurisdiction_code -> jurisdiction_name
```

`jurisdiction_name` tidak bergantung langsung pada case, tetapi pada jurisdiction_code.

Better:

```sql
CREATE TABLE jurisdictions (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE cases (
    id UUID PRIMARY KEY,
    jurisdiction_code TEXT NOT NULL REFERENCES jurisdictions(code)
);
```

### 9.1 Kapan Denormalize Jurisdiction Name?

Mungkin untuk snapshot historis:

```sql
case_filing_snapshot(
    case_id,
    jurisdiction_code,
    jurisdiction_name_at_filing
)
```

Jika jurisdiction name dapat berubah dan report harus menampilkan nama saat filing, snapshot value bisa valid.

Denormalization harus punya alasan temporal/performance/contract, bukan kebetulan.

---

## 10. BCNF secara Praktis

Boyce-Codd Normal Form lebih ketat dari 3NF.

Praktisnya:

```text
Setiap determinant harus candidate key.
```

Jika sebuah kolom atau kombinasi kolom menentukan kolom lain, determinant itu harus key.

Contoh simplified scheduling:

```sql
office_room_schedule(
    room_id,
    time_slot,
    officer_id,
    officer_name
)
```

Dependencies:

```text
(room_id, time_slot) -> officer_id
officer_id -> officer_name
```

`officer_name` harus pindah ke officers.

BCNF membantu menemukan hidden dependency.

Sebagai Java engineer, tidak perlu menghafal teori formal untuk daily work, tapi harus bisa mencium:

```text
Kolom ini sebenarnya bergantung pada apa?
```

---

## 11. Normalization Bukan Tujuan Akhir

Normalization membantu:

- mengurangi redundancy
- mencegah anomalies
- memperjelas domain
- memperkuat constraints
- meningkatkan data integrity
- membuat update lebih aman

Tapi terlalu normalized tanpa konteks bisa:

- membuat query terlalu banyak join
- menyulitkan reporting
- menambah overhead write/read
- membuat model terlalu abstrak
- menambah kompleksitas mental
- menyebabkan premature generalization

Tujuan bukan “mencapai normal form tertinggi”.

Tujuan:

```text
representasi fakta yang benar, dapat dijaga, dan cocok untuk workload.
```

---

## 12. Denormalization yang Disengaja

Denormalization adalah menyimpan data redundant untuk alasan tertentu.

Valid reasons:

- performance read
- historical snapshot
- external contract
- audit evidence
- reporting simplification
- materialized read model
- avoiding expensive repeated computation
- preserving value at time of event
- decoupling service boundary

Invalid reasons:

- malas join
- belum paham normalization
- semua dimasukkan JSON
- mengikuti DTO frontend mentah
- meniru object graph
- takut database relational

### 12.1 Denormalization Requires Maintenance Strategy

Jika menyimpan redundant data, jawab:

```text
Siapa yang update?
Kapan update?
Dalam transaksi yang sama?
Apakah eventual consistency diterima?
Bagaimana rebuild?
Bagaimana detect drift?
Apa source of truth?
```

Denormalization tanpa maintenance adalah future incident.

---

## 13. Current State vs History

Common design:

```text
current state table + history table
```

Example:

```sql
cases(status, priority, assigned_officer_id, ...)
case_status_transitions(...)
case_assignment_history(...)
```

### 13.1 Current State Table

Optimized for current query:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN';
```

### 13.2 History Table

Optimized for audit/time analysis:

```sql
SELECT *
FROM case_status_transitions
WHERE case_id = :case_id
ORDER BY transitioned_at;
```

Both are useful.

Current state without history loses audit.

History without current state may make common reads expensive.

Hybrid is common.

---

## 14. Event Table vs State Table

### 14.1 State Table

```sql
cases(id, status, closed_at)
```

Tells current state.

Good for:

- list current cases
- update workflow
- simple APIs
- operational screens

### 14.2 Event Table

```sql
case_status_transitions(case_id, from_status, to_status, transitioned_at)
```

Tells what happened.

Good for:

- audit
- analytics
- replay
- temporal queries
- investigations

### 14.3 Combined

Use both when:

- current queries frequent
- audit important
- state transitions matter
- regulatory traceability needed

But ensure transaction keeps them consistent.

---

## 15. Reference Tables

Instead of check constraint:

```sql
CHECK (status IN ('OPEN', 'CLOSED'))
```

you can use reference table:

```sql
CREATE TABLE case_statuses (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL UNIQUE,
    terminal BOOLEAN NOT NULL
);
```

Then:

```sql
status TEXT NOT NULL REFERENCES case_statuses(code)
```

### 15.1 When Reference Table is Better

Use reference table when values have:

- labels
- sort order
- metadata
- effective dates
- localization
- permissions
- grouping
- terminal flag
- lifecycle rules
- admin management
- reporting dimensions

Use check constraint when values are simple and stable.

---

## 16. Lookup Table vs Enum Type vs CHECK

### 16.1 CHECK

```sql
status TEXT CHECK (status IN (...))
```

Pros:

- simple
- readable
- portable
- easy for small stable sets

Cons:

- metadata unavailable
- altering requires migration
- repeated constraints across tables

### 16.2 Database Enum

```sql
CREATE TYPE case_status AS ENUM (...)
```

Pros:

- compact
- expressive
- type-level domain

Cons:

- vendor-specific
- migration caveats
- less flexible metadata

### 16.3 Reference Table

Pros:

- metadata
- FK
- extensible
- report-friendly
- can be managed as data

Cons:

- extra join
- seed data
- governance needed

Decision depends on domain stability and metadata needs.

---

## 17. Modelling One-to-One

One-to-one relationship can be:

1. same table
2. separate table with shared primary key
3. optional extension table

Example:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    case_number TEXT NOT NULL
);

CREATE TABLE case_confidential_details (
    case_id UUID PRIMARY KEY REFERENCES cases(id),
    sealed_reason TEXT NOT NULL,
    sealed_at TIMESTAMPTZ NOT NULL
);
```

Grain:

```text
one row per case that has confidential details
```

Use separate table when:

- optional rare fields
- security separation
- different access pattern
- sensitive data
- lifecycle different
- large columns
- regulatory separation

---

## 18. Modelling One-to-Many

Example:

```sql
CREATE TABLE case_evidences (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id),
    evidence_type TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL
);
```

One case can have many evidence rows.

Important constraints:

```sql
case_id NOT NULL FK
```

Potential unique:

```sql
UNIQUE (case_id, external_evidence_id)
```

Query implication:

Join from case to evidences changes grain to one row per evidence.

---

## 19. Modelling Many-to-Many

Example:

```sql
CREATE TABLE parties (
    id UUID PRIMARY KEY,
    legal_name TEXT NOT NULL
);

CREATE TABLE case_parties (
    case_id UUID NOT NULL REFERENCES cases(id),
    party_id UUID NOT NULL REFERENCES parties(id),
    role TEXT NOT NULL,

    PRIMARY KEY (case_id, party_id, role)
);
```

If role has attributes:

```sql
joined_at
left_at
representation_type
```

add columns to relationship table.

If relationship has lifecycle/history, it is a first-class entity.

---

## 20. Relationship with Attributes

Bad:

```sql
cases(
    id,
    assigned_officer_id,
    assigned_at,
    assignment_role
)
```

This only supports one current assignment and poor history.

Better:

```sql
case_assignments(
    id,
    case_id,
    officer_id,
    assignment_role,
    assigned_at,
    ended_at
)
```

Relationship has attributes and lifecycle, so it deserves table.

---

## 21. Optional Relationships

Optional FK:

```sql
assigned_officer_id UUID REFERENCES officers(id)
```

Meaning:

```text
case may or may not have assigned officer
```

But optional relationship needs semantics:

- unassigned?
- not applicable?
- unknown?
- legacy missing?
- assignment managed elsewhere?
- multiple assignment possible?

If relationship can be multiple or historical, nullable FK is too weak.

Use assignment table.

---

## 22. Avoiding Flag Explosion

Bad:

```sql
is_open BOOLEAN
is_under_review BOOLEAN
is_escalated BOOLEAN
is_closed BOOLEAN
```

Invalid combinations possible.

Better:

```sql
status TEXT NOT NULL
CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED'))
```

Boolean flags are good for independent facts:

```sql
is_sensitive BOOLEAN NOT NULL DEFAULT FALSE
requires_manual_review BOOLEAN NOT NULL DEFAULT FALSE
```

But not for mutually exclusive state.

---

## 23. Avoiding EAV Abuse

Entity-Attribute-Value:

```sql
case_attributes(
    case_id,
    attribute_name,
    attribute_value
)
```

EAV seems flexible, but costs:

- weak typing
- weak constraints
- hard queries
- hard indexes
- no FK per attribute
- validation moves to app
- reporting painful
- performance unpredictable
- duplicate/inconsistent attributes

Use EAV only when:

- attributes truly dynamic
- query requirements limited
- metadata-driven system
- strong governance exists
- alternative would be impossible

Often better:

- normal columns for core attributes
- JSON for metadata
- extension tables per category
- typed custom fields with metadata + validation layer

---

## 24. Avoiding “Everything JSON”

Bad:

```sql
cases(
    id UUID PRIMARY KEY,
    data JSONB NOT NULL
)
```

If core data is inside JSON:

```json
{
  "status": "OPEN",
  "caseNumber": "C-001",
  "openedAt": "2026-01-01"
}
```

Problems:

- weak constraints
- harder FK
- harder unique
- harder index
- harder migration
- harder analytics
- app-specific schema hidden
- data quality issues

Good hybrid:

```sql
cases(
    id,
    tenant_id,
    case_number,
    status,
    opened_at,
    metadata JSONB
)
```

Core facts as columns, flexible metadata as JSON.

---

## 25. Modelling Money

Bad:

```sql
amount DOUBLE PRECISION
currency TEXT
```

Better:

```sql
amount NUMERIC(19, 2) NOT NULL,
currency_code CHAR(3) NOT NULL REFERENCES currencies(code)
```

Or minor units:

```sql
amount_minor BIGINT NOT NULL,
currency_code CHAR(3) NOT NULL REFERENCES currencies(code)
```

But minor units require currency exponent awareness.

Money is not one column if multi-currency.

```text
amount without currency is incomplete fact.
```

---

## 26. Modelling Time

Choose based on domain:

```text
DATE -> calendar date
TIMESTAMPTZ -> actual moment
TIMESTAMP WITHOUT TIME ZONE -> local date-time
```

Examples:

```sql
birth_date DATE
opened_at TIMESTAMPTZ
due_local_date DATE
due_timezone TEXT
due_at TIMESTAMPTZ
```

For legal deadlines, store enough information to reconstruct decision:

- local date
- timezone
- calendar/rule version
- computed instant deadline
- source event time

Time modelling is domain design, not type selection only.

---

## 27. Modelling Temporal Validity

For facts valid over time:

```sql
case_assignments(
    case_id,
    officer_id,
    assigned_at,
    ended_at
)
```

Use half-open interval:

```text
[assigned_at, ended_at)
```

Meaning:

- starts at assigned_at inclusive
- ends at ended_at exclusive
- null ended_at means still active

Constraint:

```sql
CHECK (ended_at IS NULL OR ended_at > assigned_at)
```

No-overlap may need exclusion constraint/trigger/current table.

---

## 28. Modelling Audit

Audit can be:

1. business history tables
2. technical audit trail
3. event log
4. change data capture
5. outbox
6. temporal tables/vendor feature

Business history:

```sql
case_status_transitions
```

Technical audit:

```sql
audit_log(
    table_name,
    row_id,
    operation,
    old_values,
    new_values,
    changed_at,
    changed_by
)
```

Do not confuse:

- business event: meaningful in domain
- technical audit: record of data mutation

Both may be needed.

---

## 29. Modelling External IDs

External systems have their own identifiers.

Bad:

```sql
cases(
    external_id TEXT
)
```

if multiple source systems or multiple external refs possible.

Better:

```sql
case_external_refs(
    tenant_id,
    source_system,
    source_case_id,
    case_id,
    first_seen_at,
    last_seen_at,
    PRIMARY KEY (tenant_id, source_system, source_case_id)
)
```

This supports:

- idempotency
- multiple sources
- reconciliation
- traceability
- source-specific metadata
- conflict handling

---

## 30. Modelling Multi-Tenancy

Common patterns:

### 30.1 Shared Schema, Tenant Column

```sql
tenant_id UUID NOT NULL
```

Pros:

- simple operations
- shared schema
- efficient for many tenants

Cons:

- every query must filter tenant
- risk of data leak
- indexes need tenant leading
- constraints must be tenant-scoped

### 30.2 Schema per Tenant

Pros:

- isolation
- easier per-tenant backup

Cons:

- migration complexity
- many schemas
- operational overhead

### 30.3 Database per Tenant

Pros:

- strongest isolation
- independent scaling

Cons:

- high operational complexity
- connection management
- cross-tenant analytics harder

For shared schema, encode tenant in keys/constraints:

```sql
UNIQUE (tenant_id, case_number_normalized)
FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id)
```

---

## 31. Modelling Ownership vs Visibility

A case may belong to a tenant but visible to multiple jurisdictions/teams.

Do not overload one column.

Bad:

```sql
tenant_id
jurisdiction_code
assigned_team_id
```

without clear meaning.

Clarify:

- owner tenant
- regulatory jurisdiction
- processing team
- visibility group
- assigned officer
- data residency region

These may require separate relationships.

Example:

```sql
case_visibility_groups(
    case_id,
    group_id,
    granted_at
)
```

Do not collapse all access concepts into one FK.

---

## 32. Schema for Read vs Write

OLTP normalized schema is optimized for correctness and writes.

Read model can be denormalized for query.

Write model:

```sql
cases
case_assignments
case_evidences
case_status_transitions
```

Read model:

```sql
case_list_read_model(
    case_id,
    case_number,
    status,
    priority,
    primary_officer_name,
    evidence_count,
    latest_transitioned_at,
    sla_due_at
)
```

Read model trade-offs:

- faster list API
- simpler query
- eventual consistency possible
- rebuild needed
- duplicated data
- source of truth must be clear

Denormalization is acceptable when deliberate.

---

## 33. Schema Evolution

Schema will change.

Design for evolution:

- avoid overloaded columns
- use explicit names
- use constraints
- avoid `SELECT *`
- use expand-contract migrations
- separate stable identity from display names
- use reference tables for metadata-heavy values
- version external contracts
- avoid premature EAV
- avoid storing app class names as domain
- document invariants

Example expand-contract:

1. add new column nullable
2. dual-write
3. backfill
4. read new column
5. enforce not null/constraint
6. stop writing old column
7. drop old column later

---

## 34. Naming Conventions

Good names are part of schema design.

### 34.1 Table Names

Use consistent style:

```text
cases
case_evidences
case_assignments
case_status_transitions
```

Avoid ambiguous:

```text
data
info
details
mapping
misc
```

Unless specific.

### 34.2 Column Names

Prefer precise names:

```text
opened_at
closed_at
created_at
updated_at
received_at
issued_at
transitioned_at
```

Not all timestamps are `created_at`.

Use domain verbs.

### 34.3 Boolean Names

```text
is_sensitive
requires_manual_review
allow_public_disclosure
```

Avoid ambiguous:

```text
flag
active
valid
```

unless context precise.

### 34.4 Foreign Key Names

```text
case_id
officer_id
party_id
created_by_user_id
```

Be explicit if multiple references to same table:

```text
created_by
deleted_by
assigned_by
approved_by
```

---

## 35. Java/ORM Implications

Relational schema and Java model differ.

### 35.1 Table is Not Class

A Java aggregate may span multiple tables.

```java
CaseAggregate
- Case root
- assignments
- evidences
- transitions
```

But not every relationship should be loaded eagerly.

### 35.2 ORM Annotations Do Not Replace Schema Design

Bad:

```java
@Column(nullable = false)
```

without database `NOT NULL`.

Depending generation, maybe schema has it, maybe not. Verify actual DB schema.

### 35.3 Lazy/Eager Loading

Normalized schema often uses relationships.

ORM can create:

- N+1 queries
- cartesian explosion from fetch joins
- accidental cascade
- stale persistence context
- missing constraint if schema not generated properly

For critical query/write paths, understand SQL generated.

### 35.4 Value Objects

For domain concepts:

```java
Money
CaseNumber
JurisdictionCode
Status
```

Map to proper columns with constraints.

Do not let `String` everywhere erase domain.

---

## 36. Schema Smells

Common smells:

```text
[ ] table has no primary key
[ ] table has no foreign keys despite references
[ ] everything nullable
[ ] everything TEXT/VARCHAR(255)
[ ] JSON contains core facts
[ ] comma-separated values
[ ] many boolean flags for one lifecycle
[ ] duplicate business data across tables
[ ] no unique constraints for business keys
[ ] status column without valid value constraint
[ ] audit fields but no audit semantics
[ ] created_at used for every time concept
[ ] soft delete without partial unique/index strategy
[ ] EAV for stable attributes
[ ] table named details/info/data
[ ] foreign key column but no FK constraint
[ ] application-only invariant
```

---

## 37. Schema Review Questions

For each table:

```text
What fact does one row represent?
What is the primary key?
What are candidate keys?
What are foreign keys?
What columns are required?
What columns are optional and why?
What dependencies exist?
Are there transitive dependencies?
Are there repeated groups?
What constraints enforce domain?
What indexes support access patterns?
What history is needed?
What happens on delete?
How does this evolve?
Who writes this table?
Who reads this table?
What is source of truth?
```

---

## 38. Mini Case Study: Naive Case Schema

Naive:

```sql
CREATE TABLE cases (
    id TEXT,
    tenant_name TEXT,
    case_number TEXT,
    status TEXT,
    officer_name TEXT,
    evidence_ids TEXT,
    party_names TEXT,
    opened_at TEXT,
    closed_at TEXT,
    risk_score TEXT
);
```

Problems:

- id not typed/PK
- tenant_name duplicated
- status unconstrained
- officer_name not FK
- only one officer
- no assignment history
- evidence_ids violates 1NF
- party_names violates 1NF
- timestamps as text
- risk_score as text
- no unique business key
- no FK
- no constraints
- no audit
- impossible to query reliably

---

## 39. Mini Case Study: Better Case Core Schema

```sql
CREATE TABLE tenants (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE jurisdictions (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE cases (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    jurisdiction_code TEXT NOT NULL REFERENCES jurisdictions(code),
    case_number TEXT NOT NULL,
    case_number_normalized TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,

    CONSTRAINT uq_cases_tenant_case_number
    UNIQUE (tenant_id, case_number_normalized),

    CONSTRAINT ck_cases_status_valid
    CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED')),

    CONSTRAINT ck_cases_priority_valid
    CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),

    CONSTRAINT ck_cases_time_order
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);
```

Better because:

- identity clear
- tenant FK
- jurisdiction FK
- business key unique
- status constrained
- timestamps typed
- no evidence/party list embedded

---

## 40. Mini Case Study: Assignment Schema

```sql
CREATE TABLE officers (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    officer_code TEXT NOT NULL,
    full_name TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,

    UNIQUE (tenant_id, officer_code)
);

CREATE TABLE case_assignments (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    officer_id UUID NOT NULL,
    assignment_role TEXT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    FOREIGN KEY (tenant_id, officer_id)
        REFERENCES officers (tenant_id, id),

    CHECK (assignment_role IN ('PRIMARY', 'SUPPORTING')),
    CHECK (ended_at IS NULL OR ended_at > assigned_at)
);
```

Partial unique for one active primary:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (tenant_id, case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

---

## 41. Mini Case Study: Party Relationship

```sql
CREATE TABLE parties (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    party_type TEXT NOT NULL,
    legal_name TEXT NOT NULL,

    CHECK (party_type IN ('PERSON', 'ORGANIZATION'))
);

CREATE TABLE case_parties (
    case_id UUID NOT NULL,
    party_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    role TEXT NOT NULL,
    added_at TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (tenant_id, case_id, party_id, role),

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    FOREIGN KEY (tenant_id, party_id)
        REFERENCES parties (tenant_id, id),

    CHECK (role IN ('COMPLAINANT', 'RESPONDENT', 'WITNESS', 'REPRESENTATIVE'))
);
```

Question:

- Can one party have multiple roles in same case?
- If no, primary key should exclude role.
- Is role historical?
- If role changes, update row or insert history?

Schema depends on answer.

---

## 42. Mini Case Study: Evidence

```sql
CREATE TABLE case_evidences (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    evidence_type TEXT NOT NULL,
    storage_uri TEXT NOT NULL,
    sha256_hash BYTEA NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    received_by UUID NOT NULL,

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    CHECK (evidence_type IN ('DOCUMENT', 'IMAGE', 'VIDEO', 'AUDIO', 'OTHER')),
    CHECK (length(trim(storage_uri)) > 0)
);
```

Design choices:

- binary file not stored directly
- metadata in database
- hash for integrity
- type constrained
- received_at actual event time
- evidence belongs to case

Potential unique:

```sql
UNIQUE (tenant_id, case_id, sha256_hash)
```

if duplicate evidence content should be prevented per case.

---

## 43. Mini Case Study: Status History

```sql
CREATE TABLE case_status_transitions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL,
    transitioned_by UUID NOT NULL,
    reason TEXT,

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    CHECK (to_status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED')),
    CHECK (from_status IS NULL OR from_status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED')),
    CHECK (from_status IS DISTINCT FROM to_status)
);
```

Questions:

- Should first transition have from_status NULL?
- Should transition sequence be constrained?
- Should duplicate transition at same timestamp be allowed?
- Should status transition table be source of truth or audit of current state update?
- Should `transitioned_at` be app time or DB time?

---

## 44. Practical Exercises

### Exercise 1 — Identify Grain

For each table, write grain:

```text
cases
case_assignments
case_evidences
case_parties
case_status_transitions
```

Expected:

```text
cases: one row per case
case_assignments: one row per assignment interval
case_evidences: one row per evidence item
case_parties: one row per case-party-role relationship
case_status_transitions: one row per status transition event
```

### Exercise 2 — Normalize Bad Table

Bad:

```sql
case_report(
    case_id,
    case_number,
    officer_id,
    officer_name,
    evidence_id,
    evidence_type
)
```

Normalize into:

```text
cases
officers
case_assignments
case_evidences
```

### Exercise 3 — Choose CHECK vs Reference Table

For `priority` values:

```text
LOW, NORMAL, HIGH, CRITICAL
```

If only static values, CHECK may be enough.

If priority has SLA hours, label, sort order, color, escalation policy, use reference table.

### Exercise 4 — Model Current and History

Requirement:

```text
Need fast query for current status and full audit of status changes.
```

Use:

```text
cases.status
case_status_transitions
```

with transaction ensuring both updated together.

### Exercise 5 — Detect Transitive Dependency

Table:

```sql
cases(id, jurisdiction_code, jurisdiction_name)
```

Dependency:

```text
jurisdiction_code -> jurisdiction_name
```

Normalize to `jurisdictions`.

---

## 45. Schema Design Checklist

```text
[ ] What fact does each table represent?
[ ] Is grain explicit?
[ ] Does every table have primary key?
[ ] Are business keys represented with UNIQUE?
[ ] Are references represented with FOREIGN KEY?
[ ] Are required columns NOT NULL?
[ ] Are finite domains constrained?
[ ] Are timestamps semantically named?
[ ] Are current state and history separated correctly?
[ ] Are many-to-many relationships modeled explicitly?
[ ] Are relationship attributes placed on relationship table?
[ ] Are JSON/EAV used only where justified?
[ ] Are denormalized values maintained deliberately?
[ ] Is tenant scope encoded in keys/constraints?
[ ] Are soft-delete implications handled?
[ ] Are audit/regulatory needs represented?
[ ] Can common queries be written without fighting the model?
[ ] Can writes enforce invariants safely?
[ ] Can schema evolve with expand-contract?
```

---

## 46. Pull Request Review Checklist

When reviewing schema migration:

```text
[ ] Does new table have clear grain?
[ ] Does name reflect domain?
[ ] Are column types semantically correct?
[ ] Are NOT NULL constraints appropriate?
[ ] Are CHECK constraints needed?
[ ] Are UNIQUE constraints needed?
[ ] Are FKs present?
[ ] Are indexes planned for FK/query patterns?
[ ] Are delete actions intentional?
[ ] Is history/audit need considered?
[ ] Does migration handle existing data?
[ ] Is rollback/fix-forward strategy realistic?
[ ] Are ORM mappings aligned?
[ ] Are generated SQL and actual schema consistent?
[ ] Are constraint names explicit?
```

---

## 47. Koneksi ke Part Berikutnya

Part ini membahas schema design dan normalization secara umum.

Part berikutnya, `part-014`, akan membahas advanced modelling:

- state machines
- workflows
- regulatory case data
- auditability
- temporal truth
- assignment lifecycle
- SLA modelling
- approvals
- decisions
- event/outbox patterns
- modelling complex business processes without turning schema into chaos

Dengan kata lain, part berikutnya menerapkan prinsip schema design ke domain yang lebih kompleks dan realistis.

---

## 48. Ringkasan Bagian Ini

Hal penting dari part 013:

1. Schema design dimulai dari fakta, bukan class.
2. Setiap table harus punya predicate dan grain yang jelas.
3. Entity, attribute, relationship, dan event harus dibedakan.
4. Functional dependency membantu menentukan kolom belong di mana.
5. Normalization menghindari update, insert, dan delete anomalies.
6. 1NF mencegah repeating groups/list tersembunyi.
7. 2NF memastikan kolom bergantung pada seluruh composite key.
8. 3NF menghindari transitive dependency.
9. BCNF membantu menemukan determinant yang bukan key.
10. Normalization bukan tujuan akhir; correctness dan workload tetap penting.
11. Denormalization harus disengaja dan punya maintenance strategy.
12. Current state dan history sering perlu dipisahkan tapi dijaga konsisten.
13. Reference table cocok untuk domain values dengan metadata.
14. Relationship dengan atribut/lifecycle layak menjadi table sendiri.
15. EAV dan everything-JSON harus dihindari untuk core facts.
16. Multi-tenancy harus dikodekan dalam key, FK, dan unique constraint.
17. Read model boleh denormalized jika source of truth dan rebuild strategy jelas.
18. Schema harus dirancang untuk evolusi.
19. Java/ORM model tidak boleh menggantikan relational design.
20. Schema smell harus dikenali sejak review.

Kalimat inti:

> Schema yang baik membuat fakta bisnis mudah dipercaya, mudah ditanyakan, mudah diubah dengan aman, dan sulit menjadi inconsistent.

---

## 49. Referensi

1. E. F. Codd — A Relational Model of Data for Large Shared Data Banks, Communications of the ACM, 1970.  
   https://dl.acm.org/doi/10.1145/362384.362685

2. PostgreSQL Documentation — Data Definition.  
   https://www.postgresql.org/docs/current/ddl.html

3. PostgreSQL Documentation — Constraints.  
   https://www.postgresql.org/docs/current/ddl-constraints.html

4. PostgreSQL Documentation — Generated Columns.  
   https://www.postgresql.org/docs/current/ddl-generated-columns.html

5. PostgreSQL Documentation — Foreign Keys.  
   https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK

6. MySQL 8.4 Reference Manual — Data Definition Statements.  
   https://dev.mysql.com/doc/refman/8.4/en/sql-data-definition-statements.html

7. SQL Server Documentation — Database Design Basics.  
   https://learn.microsoft.com/en-us/office/troubleshoot/access/database-normalization-description

8. Oracle Database Concepts — Schema Objects.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/cncpt/schema-objects.html

---

## 50. Status Seri

Seri belum selesai.

Bagian selesai:

- `learn-sql-mastery-for-java-engineers-part-000.md`
- `learn-sql-mastery-for-java-engineers-part-001.md`
- `learn-sql-mastery-for-java-engineers-part-002.md`
- `learn-sql-mastery-for-java-engineers-part-003.md`
- `learn-sql-mastery-for-java-engineers-part-004.md`
- `learn-sql-mastery-for-java-engineers-part-005.md`
- `learn-sql-mastery-for-java-engineers-part-006.md`
- `learn-sql-mastery-for-java-engineers-part-007.md`
- `learn-sql-mastery-for-java-engineers-part-008.md`
- `learn-sql-mastery-for-java-engineers-part-009.md`
- `learn-sql-mastery-for-java-engineers-part-010.md`
- `learn-sql-mastery-for-java-engineers-part-011.md`
- `learn-sql-mastery-for-java-engineers-part-012.md`
- `learn-sql-mastery-for-java-engineers-part-013.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-014.md` — Advanced Modelling: State Machines, Workflows, and Regulatory Case Data

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-012.md">⬅️ Part 12 — Constraints as Business Invariants</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-014.md">Part 14 — Advanced Modelling: State Machines, Workflows, and Regulatory Case Data ➡️</a>
</div>
