# learn-sql-mastery-for-java-engineers-part-032.md

# Part 32 — Vendor-Specific Deep Comparison: PostgreSQL, MySQL, SQL Server, Oracle

> Seri: SQL Mastery for Java Engineers  
> Bagian: 032 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-031.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-033.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas analytical SQL, OLAP, warehouse, reporting, star schema, facts/dimensions, dan metric correctness.

Sekarang kita membahas topik yang sering membuat engineer salah asumsi:

```text
SQL itu standar, tapi database engine tidak sama.
```

Empat database relational besar yang sering ditemui Java engineer:

```text
PostgreSQL
MySQL / MariaDB family
Microsoft SQL Server
Oracle Database
```

Semua mendukung SQL, transactions, indexes, constraints, joins, dan query optimizer. Tetapi perbedaannya nyata:

- dialect syntax
- data types
- isolation semantics
- locking behavior
- indexing features
- JSON support
- full-text search
- generated columns
- upsert syntax
- limit/pagination syntax
- execution plan tooling
- stored procedure language
- partitioning
- online DDL
- replication/HA
- backup/PITR
- JDBC driver behavior
- migration safety
- licensing/cost/ops culture

Sebagai Java engineer, kamu tidak harus menjadi DBA expert untuk semua engine. Tetapi kamu harus tahu:

```text
mana yang portable,
mana yang vendor-specific,
mana yang memengaruhi correctness,
mana yang memengaruhi performance,
dan mana yang memengaruhi operasional.
```

Kalimat inti:

> SQL skill yang matang bukan hanya menghafal syntax standar, tetapi memahami bagaimana tiap engine mengeksekusi, mengunci, mengoptimalkan, dan mengoperasikan data dengan trade-off yang berbeda.

---

## 1. Jangan Menganggap SQL Sepenuhnya Portable

SQL standard ada, tetapi implementasi berbeda.

Query portable:

```sql
SELECT id, name
FROM users
WHERE email = ?
ORDER BY created_at DESC;
```

Query vendor-specific:

```sql
-- PostgreSQL
SELECT *
FROM events
WHERE payload @> '{"type": "CASE_CLOSED"}'::jsonb;

-- SQL Server
SELECT TOP (10) *
FROM cases
ORDER BY opened_at DESC;

-- MySQL
INSERT INTO users (...) VALUES (...)
ON DUPLICATE KEY UPDATE ...;

-- Oracle
SELECT *
FROM cases
FETCH FIRST 10 ROWS ONLY;
```

Portability punya biaya.

Jika aplikasi butuh advanced features, sering lebih baik memilih engine dan memakainya dengan sadar daripada memaksa lowest-common-denominator SQL.

---

## 2. Portability vs Leverage

Dua pendekatan:

### 2.1 Portable SQL

Gunakan subset SQL umum.

Pros:

- lebih mudah ganti database
- vendor lock-in lebih rendah
- query sederhana

Cons:

- tidak memanfaatkan fitur kuat engine
- performance bisa kurang optimal
- workaround di app lebih banyak
- advanced constraints/indexes sulit

### 2.2 Vendor-Leveraged SQL

Gunakan fitur engine.

Pros:

- correctness lebih kuat
- performance lebih baik
- schema lebih ekspresif
- operations lebih optimal

Cons:

- vendor lock-in
- migrasi database lebih sulit
- butuh expertise engine
- testing harus pakai engine asli

Prinsip senior:

> Jangan vendor-specific untuk hal trivial; jangan menghindari fitur vendor yang memberi correctness/performance besar hanya karena takut lock-in abstrak.

---

## 3. PostgreSQL: Karakter Umum

PostgreSQL sering disukai untuk:

- standards-oriented SQL
- strong extensibility
- rich data types
- advanced indexing
- MVCC behavior
- JSONB
- arrays/ranges
- full-text search
- geospatial with PostGIS
- strong constraint features
- transactional DDL
- robust open-source ecosystem
- excellent developer ergonomics

Karakter:

```text
feature-rich, correctness-oriented, extensible, excellent for complex relational modelling.
```

Common use cases:

- SaaS OLTP
- transactional systems
- data-heavy apps
- geospatial
- JSON+relational hybrid
- strong consistency apps
- event/outbox/audit systems
- internal tools and analytics moderate scale

---

## 4. MySQL: Karakter Umum

MySQL sering disukai untuk:

- simplicity
- ubiquity
- web application ecosystem
- operational familiarity
- high read throughput setups
- replication ecosystem
- managed cloud availability
- broad tooling

Modern MySQL with InnoDB supports transactions, row-level locking, MVCC-like consistent reads, foreign keys, indexes, JSON, generated columns, partitioning, and window functions.

Karakter:

```text
widely deployed, operationally familiar, pragmatic, but has dialect/semantic surprises.
```

Important:

- storage engine matters; InnoDB is the standard for transactional correctness
- default settings and SQL modes matter
- historical MySQL tolerated loose behavior that can surprise engineers

Use strict SQL modes.

---

## 5. SQL Server: Karakter Umum

SQL Server sering disukai di enterprise Microsoft ecosystem.

Strengths:

- mature optimizer
- excellent tooling
- T-SQL ecosystem
- stored procedures
- integrated security
- SQL Server Agent/jobs
- columnstore indexes
- indexed views
- temporal tables
- Always On Availability Groups
- enterprise monitoring
- BI ecosystem integration

Karakter:

```text
enterprise-grade, tooling-rich, strong operational/BI integration, powerful T-SQL features.
```

Common in:

- enterprise internal systems
- finance
- government
- Microsoft stack
- reporting-heavy environments
- stored procedure-centric systems

---

## 6. Oracle: Karakter Umum

Oracle Database sering digunakan di enterprise besar dan regulated environments.

Strengths:

- extremely mature optimizer
- PL/SQL ecosystem
- partitioning features
- advanced security
- RAC/HA features
- flashback
- materialized views
- large-scale enterprise workloads
- robust backup/recovery tooling
- sophisticated indexing/storage features

Karakter:

```text
enterprise-heavy, feature-rich, operationally deep, often expensive/licensed, very mature at scale.
```

Common in:

- banking
- telecom
- government
- ERP
- large enterprise
- mission-critical legacy systems

---

## 7. Data Type Differences

### 7.1 Boolean

PostgreSQL:

```sql
BOOLEAN
```

MySQL:

```sql
BOOLEAN is alias for TINYINT(1)
```

SQL Server:

```sql
BIT
```

Oracle historically did not have SQL-level BOOLEAN in older versions for table columns; modern versions improve support, but legacy systems often use `NUMBER(1)` or `CHAR(1)`.

Java implication:

- do not assume boolean column maps identically
- check JDBC driver mapping
- use explicit converters if needed

---

## 8. UUID / GUID

PostgreSQL:

```sql
UUID
```

SQL Server:

```sql
UNIQUEIDENTIFIER
```

MySQL:

```sql
CHAR(36), BINARY(16), or UUID functions depending version/pattern
```

Oracle:

```sql
RAW(16) often used
```

Trade-offs:

- random UUID hurts index locality
- binary storage smaller than string
- time-ordered UUID/ULID can improve locality
- database-generated vs app-generated affects batching
- textual representation differs

Java:

```java
UUID
```

Mapping depends driver/dialect.

---

## 9. Text and String Types

Common:

```text
VARCHAR
CHAR
TEXT/CLOB
NVARCHAR/NCHAR
```

Differences:

- max length semantics
- Unicode handling
- collation
- case sensitivity
- index length limits
- large object storage
- empty string behavior

Oracle historically treats empty string as NULL in many contexts. This is a huge portability issue.

Example:

```sql
'' IS NULL
```

behavior differs across engines.

Be very careful if migrating from/to Oracle.

---

## 10. Date and Time Types

PostgreSQL:

```text
TIMESTAMP
TIMESTAMPTZ
DATE
TIME
INTERVAL
```

MySQL:

```text
DATETIME
TIMESTAMP
DATE
TIME
```

SQL Server:

```text
datetime2
datetimeoffset
date
time
```

Oracle:

```text
DATE
TIMESTAMP
TIMESTAMP WITH TIME ZONE
TIMESTAMP WITH LOCAL TIME ZONE
INTERVAL
```

Important differences:

- timezone semantics
- precision
- default timezone conversion
- `DATE` in Oracle includes time component historically
- MySQL `TIMESTAMP` timezone conversion behavior differs from `DATETIME`
- SQL Server `datetime2` preferred over older `datetime`

Java implication:

- use `Instant`, `OffsetDateTime`, `LocalDate`, `LocalDateTime` intentionally
- test with real driver
- avoid server default timezone surprises

---

## 11. Numeric and Money

PostgreSQL:

```text
NUMERIC
BIGINT
MONEY exists but often avoided
```

MySQL:

```text
DECIMAL
BIGINT
```

SQL Server:

```text
DECIMAL/NUMERIC
MONEY/SMALLMONEY exist, but be careful
```

Oracle:

```text
NUMBER
```

Use exact decimal/integer minor units for money.

Avoid floating types for money in all engines.

Java:

```java
BigDecimal
long amountCents
```

---

## 12. JSON Support

### PostgreSQL

Strong JSON support:

```text
json
jsonb
GIN indexes
operators
jsonpath
expression indexes
```

JSONB is widely used for semi-structured payloads.

### MySQL

Native JSON type with functions, generated columns often used for indexing extracted paths.

### SQL Server

JSON stored in text columns with JSON functions; indexing often via computed columns.

### Oracle

Strong SQL/JSON support in modern versions, JSON data type/features depending version.

Principle:

> JSON in relational database is useful for payloads and flexible attributes, but core queryable business facts should usually be columns.

---

## 13. Generated / Computed Columns

PostgreSQL:

```sql
GENERATED ALWAYS AS (...) STORED
```

MySQL:

```text
generated columns virtual/stored
```

SQL Server:

```text
computed columns, can be persisted
```

Oracle:

```text
virtual columns
```

Use cases:

- normalized keys
- JSON path extraction
- computed search key
- derived sort key
- partial indexing support via expression/computed columns

Differences matter for:

- indexing
- persistence
- determinism
- allowed functions
- migration cost

---

## 14. Upsert Syntax

PostgreSQL:

```sql
INSERT INTO users (email, name)
VALUES (?, ?)
ON CONFLICT (email)
DO UPDATE SET name = EXCLUDED.name;
```

MySQL:

```sql
INSERT INTO users (email, name)
VALUES (?, ?)
ON DUPLICATE KEY UPDATE name = VALUES(name);
```

SQL Server / Oracle:

```sql
MERGE ...
```

But `MERGE` has vendor-specific semantics and caveats.

Important:

- conflict target clarity differs
- affected rows semantics differ
- concurrency behavior differs
- trigger behavior differs
- generated columns/defaults differ
- stale update conditions must be explicit

Do not treat upsert as portable abstraction without testing.

---

## 15. Pagination Syntax

PostgreSQL/MySQL:

```sql
LIMIT ? OFFSET ?
```

SQL Server:

```sql
ORDER BY created_at DESC
OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;
```

or legacy:

```sql
SELECT TOP (10) ...
```

Oracle modern:

```sql
FETCH FIRST 10 ROWS ONLY
```

or older ROWNUM patterns.

Regardless of syntax, deep offset pagination is expensive in all engines.

Keyset pagination remains broadly valuable.

---

## 16. Identity / Auto Increment

PostgreSQL:

```text
serial legacy
identity columns
sequences
```

MySQL:

```text
AUTO_INCREMENT
```

SQL Server:

```text
IDENTITY
SEQUENCE
```

Oracle:

```text
SEQUENCE
IDENTITY in modern versions
```

Implications:

- batching
- generated keys
- sequence caching
- gaps
- failover
- sharding
- ordering assumptions

Do not assume generated IDs are gapless.

Sequences can have gaps due to rollback/cache/failover.

---

## 17. Transactional DDL

PostgreSQL supports transactional DDL for many operations.

MySQL DDL often auto-commits; online DDL behavior depends operation/engine/version.

SQL Server supports transactions for many DDL operations, with caveats.

Oracle DDL generally commits implicitly.

Migration implication:

> Your Flyway/Liquibase rollback/failure behavior differs by database.

Do not assume a failed migration leaves database unchanged.

---

## 18. Isolation Semantics

Standard isolation names do not guarantee identical behavior.

PostgreSQL:

- MVCC
- Read Committed default
- Repeatable Read is snapshot isolation-like
- Serializable uses SSI

MySQL InnoDB:

- Repeatable Read default in many setups
- next-key/gap locks for phantom prevention in some operations
- Read Committed optional

SQL Server:

- Read Committed default with locking behavior unless RCSI enabled
- Read Committed Snapshot Isolation optional
- Snapshot isolation optional
- Serializable locking

Oracle:

- Read Committed default
- Serializable snapshot-like behavior with possible errors
- strong multi-version consistency model

Java implication:

```java
@Transactional(isolation = Isolation.REPEATABLE_READ)
```

does not mean identical behavior across engines.

---

## 19. Locking Differences

PostgreSQL:

- MVCC readers do not block writers in common cases
- row locks for updates
- explicit `FOR UPDATE`
- no gap locks like InnoDB in ordinary Read Committed
- predicate locks in Serializable

MySQL InnoDB:

- row locks
- next-key/gap locks depending isolation/index/range
- missing indexes can lock more than expected
- deadlock detection important

SQL Server:

- locking-based Read Committed unless RCSI
- lock escalation possible
- hints like `UPDLOCK`, `ROWLOCK`, `NOLOCK` exist
- `NOLOCK` can read dirty/inconsistent data

Oracle:

- MVCC read consistency
- row-level locks for writes
- readers generally don't block writers
- writers don't block readers for consistent reads

Know your engine before designing concurrency pattern.

---

## 20. `SELECT FOR UPDATE` Variants

PostgreSQL:

```sql
SELECT ...
FOR UPDATE SKIP LOCKED;
```

MySQL:

```sql
SELECT ...
FOR UPDATE;
```

with `SKIP LOCKED` in modern versions.

SQL Server uses hints:

```sql
WITH (UPDLOCK, READPAST, ROWLOCK)
```

Oracle:

```sql
SELECT ...
FOR UPDATE SKIP LOCKED;
```

Queue claim patterns differ by dialect.

Abstracting job queue SQL across engines is non-trivial.

---

## 21. Index Types

### PostgreSQL

- B-tree
- Hash
- GIN
- GiST
- SP-GiST
- BRIN
- expression indexes
- partial indexes
- covering via INCLUDE

### MySQL/InnoDB

- B-tree indexes
- full-text indexes
- spatial indexes
- prefix indexes
- generated column indexes
- invisible indexes

### SQL Server

- clustered/nonclustered indexes
- included columns
- filtered indexes
- columnstore indexes
- full-text
- spatial
- indexed views

### Oracle

- B-tree
- bitmap indexes
- function-based indexes
- domain indexes
- reverse key indexes
- partitioned indexes
- materialized view indexes

Index design is very vendor-specific beyond basic B-tree.

---

## 22. Clustered Storage

MySQL InnoDB tables are clustered by primary key.

SQL Server can have clustered index chosen explicitly; table data stored by clustered index key.

PostgreSQL heap table is not clustered permanently by index, though `CLUSTER` can rewrite table.

Oracle has heap tables and index-organized tables.

Implications:

- primary key choice affects physical locality
- secondary indexes in InnoDB include primary key
- random UUID primary key can hurt locality
- clustered index design matters in SQL Server
- PostgreSQL may need different tuning for locality

---

## 23. Partial / Filtered Indexes

PostgreSQL:

```sql
CREATE INDEX idx_open_cases
ON cases (tenant_id, priority)
WHERE status = 'OPEN';
```

SQL Server:

```sql
CREATE INDEX idx_open_cases
ON cases (tenant_id, priority)
WHERE status = 'OPEN';
```

called filtered index.

MySQL does not have true partial indexes in same way; use generated columns or alternative designs.

Oracle has function-based tricks and partitioning/indexing strategies.

Partial indexes are excellent for:

- active rows
- soft delete
- open cases
- unpublished outbox
- one active relationship
- sparse predicates

Portability differs.

---

## 24. Expression / Function-Based Indexes

PostgreSQL:

```sql
CREATE INDEX idx_users_email_lower
ON users (lower(email));
```

SQL Server:

- computed persisted column + index
- expression support via computed columns

MySQL:

- functional indexes in modern versions
- generated columns historically common

Oracle:

```sql
CREATE INDEX idx_users_email_lower
ON users (lower(email));
```

Use for normalized search keys, but generated column can be clearer and portable-ish.

---

## 25. Full-Text Search

PostgreSQL:

- `tsvector`
- GIN index
- ranking functions
- dictionaries

MySQL:

- FULLTEXT indexes
- natural language/boolean modes

SQL Server:

- Full-Text Search engine/catalogs

Oracle:

- Oracle Text

Differences are large.

If search is core feature with relevance/fuzzy/multilingual needs, consider dedicated search engine.

If moderate search, database FTS may be enough.

---

## 26. Spatial / Geospatial

PostgreSQL + PostGIS is extremely strong.

MySQL has spatial types/indexes.

SQL Server has geography/geometry types.

Oracle Spatial is mature enterprise feature.

Geospatial SQL is highly vendor-specific.

Java apps should isolate geospatial query code behind repository/service boundary.

---

## 27. Window Functions

All four modern engines support window functions, but syntax/function support differs.

Common:

```sql
ROW_NUMBER() OVER (...)
RANK()
DENSE_RANK()
LAG()
LEAD()
SUM() OVER (...)
```

Differences:

- frame defaults
- percentile functions
- FILTER clause support
- QUALIFY support absent/present depending DB
- ordered-set aggregates

Always test analytical SQL on target engine.

---

## 28. CTE Behavior

PostgreSQL historically materialized CTEs before optimization changes; modern versions can inline unless materialized hints.

SQL Server often treats CTE like query expression.

Oracle has subquery factoring with optimizer behavior/hints.

MySQL supports CTEs in modern versions.

CTE performance is vendor/version-sensitive.

Do not assume CTE is always optimization fence or always inline.

Inspect plan.

---

## 29. Materialized Views / Indexed Views

PostgreSQL:

```text
materialized views with manual refresh
```

SQL Server:

```text
indexed views with strict requirements
```

Oracle:

```text
materialized views with advanced refresh/query rewrite features
```

MySQL:

```text
no built-in materialized view in same mature form; use tables/jobs
```

Reporting/read model design differs by engine.

---

## 30. Stored Procedure Languages

PostgreSQL:

```text
PL/pgSQL, SQL functions, extensions
```

MySQL:

```text
stored routines/triggers
```

SQL Server:

```text
T-SQL stored procedures/functions/triggers
```

Oracle:

```text
PL/SQL packages/procedures/functions/triggers
```

Oracle and SQL Server ecosystems often use stored procedures heavily.

PostgreSQL supports strong database-side logic but app-centric style is common.

MySQL stored routine language is more limited relative to enterprise procedure ecosystems.

Team culture matters.

---

## 31. Error Codes and Exception Mapping

Constraint violation codes differ.

PostgreSQL has SQLSTATE like:

```text
23505 unique_violation
23503 foreign_key_violation
40001 serialization_failure
40P01 deadlock_detected
```

SQL Server error numbers differ.

MySQL error codes/SQLSTATE differ.

Oracle ORA error codes differ.

Java exception mapping should use:

- Spring exception translation if available
- vendor SQLState/code
- constraint name
- dialect-specific adapter

Do not hardcode PostgreSQL-only codes in supposedly portable library.

---

## 32. Execution Plan Tools

PostgreSQL:

```sql
EXPLAIN (ANALYZE, BUFFERS)
```

MySQL:

```sql
EXPLAIN
EXPLAIN ANALYZE in modern versions
optimizer trace
```

SQL Server:

```text
actual execution plan
estimated execution plan
SET STATISTICS IO/TIME
Query Store
```

Oracle:

```text
EXPLAIN PLAN
DBMS_XPLAN
AWR/ASH in licensed environments
```

Plan literacy is engine-specific.

---

## 33. Query Store / Historical Plans

SQL Server Query Store is strong built-in feature.

PostgreSQL commonly uses pg_stat_statements and external tooling; plan history requires additional tooling/extensions/platform.

Oracle has AWR/ASH/SQL Monitor in enterprise contexts.

MySQL has performance schema and digest summaries.

Operational observability differs strongly by ecosystem.

---

## 34. Replication and HA

PostgreSQL:

- streaming replication
- logical replication
- managed cloud HA
- Patroni/other ecosystem

MySQL:

- asynchronous/semi-sync replication
- group replication/InnoDB Cluster
- mature replication ecosystem

SQL Server:

- Always On Availability Groups
- failover clusters
- log shipping
- replication options

Oracle:

- Data Guard
- RAC
- GoldenGate
- advanced enterprise HA

HA choice affects app failover, read routing, consistency, licensing, operations.

---

## 35. Backup and PITR

PostgreSQL:

- base backups + WAL archiving
- pg_dump logical backup

MySQL:

- physical backup tools, binary logs for PITR
- mysqldump logical backup

SQL Server:

- full/differential/log backups
- mature restore tooling

Oracle:

- RMAN
- flashback
- Data Guard integration

Backup is deeply engine-specific.

But universal rule:

```text
backup must be restore-tested.
```

---

## 36. Online DDL

PostgreSQL:

- transactional DDL mostly
- `CREATE INDEX CONCURRENTLY`
- some operations still lock/rewrite

MySQL:

- online DDL features depend operation/engine
- `ALGORITHM=INPLACE/INSTANT`, `LOCK=NONE` concepts
- behavior version-specific

SQL Server:

- online index operations in certain editions/features
- schema changes can lock
- resumable index operations in modern versions

Oracle:

- strong online redefinition/DDL features in enterprise contexts

Migration strategy must be engine-specific.

---

## 37. Case Sensitivity and Collation

Differences:

- identifier case folding
- quoted identifiers
- string comparison collation
- case sensitivity default
- accent sensitivity
- Unicode normalization
- index behavior with collation

PostgreSQL folds unquoted identifiers to lower-case.

Oracle traditionally folds to upper-case.

SQL Server collation often determines case sensitivity.

MySQL collation determines case sensitivity and comparison behavior.

Avoid quoted mixed-case identifiers if portability/team sanity matters.

---

## 38. Identifier Quoting

PostgreSQL/Oracle:

```sql
"Case"
```

MySQL:

```sql
`case`
```

SQL Server:

```sql
[case]
```

Portable applications should avoid reserved words and weird identifier casing.

Use simple snake_case names.

---

## 39. NULL and Empty String

Oracle empty string behavior is a major difference:

```text
'' may be treated as NULL
```

In PostgreSQL/MySQL/SQL Server, empty string and NULL are distinct.

This affects:

- validation
- unique constraints
- imports
- Java empty string mapping
- NOT NULL
- CHECK constraints
- query predicates

If supporting Oracle, design empty string semantics carefully.

---

## 40. Boolean Predicate Semantics

PostgreSQL supports:

```sql
WHERE active
WHERE active IS TRUE
```

MySQL boolean often integer-ish.

SQL Server BIT cannot always be used exactly like boolean expression.

Oracle legacy uses number/char.

Portable code should be explicit:

```sql
WHERE active = TRUE
```

or engine-specific mapped value.

---

## 41. Auto-Commit and Driver Behavior

JDBC autocommit default is usually true.

But driver behavior differs for:

- generated keys
- server-side prepared statements
- fetch size/cursors
- batch rewrite
- time zone conversion
- large object streaming
- statement timeout mapping
- cancel behavior
- connection validation
- SSL settings

Test with target JDBC driver.

Do not assume JDBC abstraction removes driver differences.

---

## 42. Java Type Mapping

Common pain points:

- UUID
- JSON
- arrays
- timestamp with timezone
- interval
- boolean
- enum
- numeric precision
- CLOB/BLOB
- XML
- spatial types

ORM dialects help, but advanced types often need custom mapping.

jOOQ often provides strong dialect support.

Native queries require explicit mapping.

---

## 43. SQL Dialect in jOOQ/Hibernate

Hibernate dialect controls generated SQL.

jOOQ dialect controls SQL rendering.

If dialect wrong:

- pagination syntax wrong
- boolean mapping wrong
- limit/offset wrong
- generated key retrieval wrong
- lock syntax wrong
- type mapping wrong

Always configure correct dialect and test generated SQL.

---

## 44. Testing Across Engines

If application supports multiple DBs, test all supported DBs.

Do not rely on H2 compatibility mode.

Need matrix:

```text
PostgreSQL integration tests
MySQL integration tests
SQL Server integration tests
Oracle integration tests
```

At least for:

- migrations
- repository queries
- transaction semantics
- constraint errors
- generated IDs
- date/time mapping
- locking tests
- pagination
- JSON/search features

Multi-database support is expensive.

---

## 45. Choosing a Database

Criteria:

```text
team expertise
managed service availability
workload shape
transaction correctness needs
JSON/search/geospatial needs
analytics needs
licensing/cost
HA/DR requirements
operational tooling
ecosystem
cloud provider support
existing company standard
vendor lock-in tolerance
compliance
```

There is no universal best.

For many Java/SaaS teams, PostgreSQL is an excellent default.

For Microsoft enterprise, SQL Server may be natural.

For existing Oracle-heavy enterprise, Oracle is often already strategic.

For web-scale simple operational familiarity, MySQL may fit.

The best database is the one your team can operate correctly for your workload.

---

## 46. Vendor-Specific Strength Cheat Sheet

### PostgreSQL

Strong for:

- advanced relational modelling
- constraints
- JSONB
- extensions
- PostGIS
- partial/expression indexes
- developer-friendly SQL
- transactional DDL
- open-source ecosystem

### MySQL

Strong for:

- ubiquity
- simple web OLTP
- operational familiarity
- replication ecosystem
- broad hosting/managed support
- read-heavy app patterns

### SQL Server

Strong for:

- enterprise tooling
- Microsoft ecosystem
- T-SQL/stored procedures
- Query Store
- BI integration
- columnstore/indexed views
- HA features

### Oracle

Strong for:

- very large enterprise workloads
- PL/SQL packages
- partitioning
- materialized views
- flashback/RMAN
- advanced security
- mature optimizer/HA ecosystem

---

## 47. Common Portability Traps

```text
[ ] LIMIT/OFFSET syntax
[ ] boolean type
[ ] UUID type
[ ] empty string vs NULL
[ ] date/time timezone semantics
[ ] upsert syntax
[ ] MERGE semantics
[ ] string concatenation operator
[ ] identifier quoting/case
[ ] auto-increment/sequence behavior
[ ] JSON operators/functions
[ ] CTE optimizer behavior
[ ] isolation level behavior
[ ] lock hints/FOR UPDATE syntax
[ ] partial indexes availability
[ ] generated column syntax
[ ] regular expression syntax
[ ] full-text search syntax
[ ] DDL transaction behavior
```

---

## 48. Abstraction Strategy

Recommended:

```text
Keep domain/service logic database-agnostic where practical.
Keep repository/data-access layer dialect-aware.
Use migration scripts per database if supporting multiple engines.
Avoid pretending advanced SQL is portable.
Encapsulate vendor-specific queries behind interfaces.
Test dialect-specific behavior.
```

Do not scatter dialect checks across business logic.

---

## 49. Example: Portable Repository Interface

```java
interface CaseQueueRepository {
    List<CaseQueueItem> findOpenQueue(TenantId tenantId, QueueCursor cursor, int limit);
}
```

Implementations:

```text
PostgresCaseQueueRepository
SqlServerCaseQueueRepository
```

or jOOQ dialect-specific rendering.

Business service does not care about pagination syntax, lock hints, or JSON operators.

---

## 50. Example: Queue Claim by Dialect

PostgreSQL/Oracle style:

```sql
SELECT id
FROM jobs
WHERE status = 'READY'
ORDER BY created_at
FOR UPDATE SKIP LOCKED
FETCH FIRST 100 ROWS ONLY;
```

SQL Server style:

```sql
SELECT TOP (100) id
FROM jobs WITH (UPDLOCK, READPAST, ROWLOCK)
WHERE status = 'READY'
ORDER BY created_at;
```

MySQL syntax differs by version.

This is not trivial portability.

Use dialect-aware code.

---

## 51. Example: JSON Indexed Search

PostgreSQL:

```sql
CREATE INDEX idx_events_payload_gin
ON events USING GIN (payload);

SELECT *
FROM events
WHERE payload @> '{"type":"CASE_CLOSED"}'::jsonb;
```

MySQL style often:

```sql
ALTER TABLE events
ADD COLUMN event_type VARCHAR(50)
GENERATED ALWAYS AS (json_unquote(json_extract(payload, '$.type'))) STORED,
ADD INDEX idx_events_event_type (event_type);
```

SQL Server:

```sql
ALTER TABLE events
ADD event_type AS JSON_VALUE(payload, '$.type') PERSISTED;

CREATE INDEX idx_events_event_type
ON events(event_type);
```

Same requirement, different design.

---

## 52. Example: Soft Delete Unique Constraint

PostgreSQL/SQL Server filtered index:

```sql
CREATE UNIQUE INDEX uq_users_email_active
ON users (tenant_id, email_normalized)
WHERE deleted_at IS NULL;
```

MySQL alternative:

- generated active flag
- composite unique with deleted marker
- redesign using active table/history table

Oracle alternative:

- function-based unique index using CASE expression

Portability affects schema design.

---

## 53. Vendor Comparison Table

| Area | PostgreSQL | MySQL/InnoDB | SQL Server | Oracle |
|---|---|---|---|---|
| Open source core | Yes | Yes | No | No |
| Default enterprise ecosystem | Broad OSS/cloud | Web/cloud | Microsoft enterprise | Large enterprise |
| JSON | Strong JSONB | Native JSON funcs | JSON funcs over text | Strong modern SQL/JSON |
| Partial indexes | Yes | No direct equivalent | Filtered indexes | Function-based strategies |
| Transactional DDL | Strong for many DDL | Limited/varies | Many supported | DDL often commits |
| Stored language | PL/pgSQL | Stored routines | T-SQL | PL/SQL |
| Materialized views | Manual refresh | Emulate with table | Indexed views | Advanced MVs |
| Geospatial | Excellent with PostGIS | Available | Available | Strong |
| Query tooling | EXPLAIN, pg_stat | EXPLAIN, perf schema | Query Store | AWR/ASH/DBMS_XPLAN |
| HA ecosystem | Strong | Strong | Strong | Very strong enterprise |
| Java ecosystem | Excellent | Excellent | Excellent | Excellent |

This table is simplified. Always verify specific version/edition.

---

## 54. Practical Decision Guide

Choose PostgreSQL if:

```text
You want strong relational features, JSONB, partial indexes, extensibility, open-source default, great general-purpose OLTP.
```

Choose MySQL if:

```text
Your team/company has strong MySQL ops, workload is web OLTP, and you accept dialect semantics with strict modes and InnoDB.
```

Choose SQL Server if:

```text
You are in Microsoft enterprise ecosystem, need strong tooling/BI/T-SQL/Query Store/Windows/Azure integration.
```

Choose Oracle if:

```text
You are in large enterprise with Oracle expertise, PL/SQL ecosystem, advanced partitioning/HA/security/licensing already justified.
```

Do not choose only based on benchmark blog posts.

Choose based on workload + team + operations.

---

## 55. Java Engineer Checklist per Database

```text
[ ] Correct JDBC driver version?
[ ] Correct Hibernate/jOOQ dialect?
[ ] Timezone mapping tested?
[ ] UUID/boolean/JSON mapping tested?
[ ] Generated keys tested?
[ ] Pagination syntax generated correctly?
[ ] Locking syntax tested?
[ ] Isolation semantics understood?
[ ] Constraint error mapping implemented?
[ ] Migration DDL transaction behavior known?
[ ] Online index/DDL strategy known?
[ ] Execution plan tooling known?
[ ] Backup/restore operational model known?
[ ] SQL mode/collation configured?
[ ] Integration tests run on real engine?
```

---

## 56. Koneksi ke Part Berikutnya

Part ini membahas vendor-specific comparison.

Part berikutnya, `part-033`, akan membahas SQL design patterns and anti-patterns:

- common SQL patterns
- query patterns
- schema patterns
- transaction patterns
- anti-pattern catalog
- decision heuristics
- code review heuristics
- production smells

Setelah memahami perbedaan engine, kita akan menyusun katalog pola desain SQL yang praktis.

---

## 57. Ringkasan Bagian Ini

Hal penting dari part 032:

1. SQL standard tidak berarti semua database sama.
2. PostgreSQL, MySQL, SQL Server, dan Oracle punya dialect, optimizer, locking, indexing, and ops behavior berbeda.
3. Portability has trade-offs; vendor features can provide real correctness/performance value.
4. PostgreSQL kuat dalam extensibility, constraints, JSONB, partial/expression indexes, and OSS ecosystem.
5. MySQL kuat dalam ubiquity, web OLTP, and replication ecosystem, but strict modes/engine semantics matter.
6. SQL Server kuat dalam enterprise tooling, T-SQL, Query Store, BI, and Microsoft ecosystem.
7. Oracle kuat dalam enterprise scale, PL/SQL, partitioning, flashback/RMAN, and mature HA/security.
8. Data type differences affect Java mapping.
9. Date/time and timezone behavior must be tested per engine.
10. Upsert, pagination, generated keys, and locking syntax differ.
11. Isolation level names do not guarantee identical behavior.
12. Index features differ significantly beyond B-tree.
13. Partial/filtered/expression/generated-column strategies are vendor-specific.
14. Materialized/indexed views differ strongly.
15. DDL transaction and online migration behavior differ.
16. Execution plan tooling differs.
17. Replication, backup, HA, and DR are engine-specific.
18. Multi-database support requires real integration tests for every target.
19. Vendor-specific SQL should be isolated in data-access layer.
20. Choose database based on workload, team expertise, operations, ecosystem, and correctness needs.

Kalimat inti:

> Database engine adalah bagian dari arsitektur, bukan detail implementasi; memilih dan memakai engine dengan baik berarti memahami semantik, tooling, dan batasannya.

---

## 58. Referensi

1. PostgreSQL Documentation.  
   https://www.postgresql.org/docs/current/

2. MySQL 8.4 Reference Manual.  
   https://dev.mysql.com/doc/refman/8.4/en/

3. Microsoft SQL Server Documentation.  
   https://learn.microsoft.com/en-us/sql/sql-server/

4. Oracle Database Documentation.  
   https://docs.oracle.com/en/database/oracle/oracle-database/

5. PostgreSQL JDBC Driver Documentation.  
   https://jdbc.postgresql.org/documentation/

6. MySQL Connector/J Documentation.  
   https://dev.mysql.com/doc/connector-j/en/

7. Microsoft JDBC Driver for SQL Server.  
   https://learn.microsoft.com/en-us/sql/connect/jdbc/

8. Oracle JDBC Developer's Guide.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/jjdbc/

9. Hibernate ORM Dialects Documentation.  
   https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html

10. jOOQ SQL Dialect Documentation.  
    https://www.jooq.org/doc/latest/manual/sql-building/dsl-context/sql-dialects/

---

## 59. Status Seri

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
- `learn-sql-mastery-for-java-engineers-part-014.md`
- `learn-sql-mastery-for-java-engineers-part-015.md`
- `learn-sql-mastery-for-java-engineers-part-016.md`
- `learn-sql-mastery-for-java-engineers-part-017.md`
- `learn-sql-mastery-for-java-engineers-part-018.md`
- `learn-sql-mastery-for-java-engineers-part-019.md`
- `learn-sql-mastery-for-java-engineers-part-020.md`
- `learn-sql-mastery-for-java-engineers-part-021.md`
- `learn-sql-mastery-for-java-engineers-part-022.md`
- `learn-sql-mastery-for-java-engineers-part-023.md`
- `learn-sql-mastery-for-java-engineers-part-024.md`
- `learn-sql-mastery-for-java-engineers-part-025.md`
- `learn-sql-mastery-for-java-engineers-part-026.md`
- `learn-sql-mastery-for-java-engineers-part-027.md`
- `learn-sql-mastery-for-java-engineers-part-028.md`
- `learn-sql-mastery-for-java-engineers-part-029.md`
- `learn-sql-mastery-for-java-engineers-part-030.md`
- `learn-sql-mastery-for-java-engineers-part-031.md`
- `learn-sql-mastery-for-java-engineers-part-032.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-033.md` — SQL Design Patterns and Anti-Patterns


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-031.md">⬅️ Part 31 — Analytical SQL, OLAP, Warehousing, and Reporting Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-033.md">Part 33 — SQL Design Patterns and Anti-Patterns ➡️</a>
</div>
