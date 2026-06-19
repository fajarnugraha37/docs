# learn-sql-mastery-for-java-engineers-part-021.md

# Part 21 — Stored Procedures, Functions, Triggers, and Database-Side Logic

> Seri: SQL Mastery for Java Engineers  
> Bagian: 021 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-020.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-022.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas locking, MVCC, deadlocks, dan concurrency control.

Sekarang kita membahas pertanyaan desain yang sering memecah opini engineer:

```text
Logic sebaiknya ditaruh di aplikasi Java atau di database?
```

Database modern tidak hanya menyimpan data. Ia bisa menjalankan:

- stored procedures
- stored functions
- triggers
- generated columns
- views
- materialized views
- constraints
- row-level security policies
- scheduled jobs, pada beberapa platform
- extensions
- custom types
- domain types

Sebagai Java engineer, kamu harus bisa menilai kapan database-side logic membantu dan kapan ia menjadi technical debt.

Contoh logic yang mungkin berada di database:

```text
audit row setiap update
normalize email/case number
generate derived column
validate complex invariant
maintain summary table
prevent invalid state transition
auto-update updated_at
outbox insert
enforce row-level access policy
```

Namun database-side logic juga punya risiko:

- hidden side effects
- sulit dites dengan tooling Java biasa
- sulit versioning/deployment
- vendor lock-in
- debugging lebih sulit
- performance overhead tidak terlihat
- ORM tidak sadar trigger mengubah data
- migration rollback lebih kompleks
- business logic tersebar

Bagian ini bertujuan memberi mental model yang seimbang.

Kalimat inti:

> Database-side logic adalah alat kuat untuk menjaga data dekat dengan invariant-nya, tetapi harus dipakai secara eksplisit, teruji, terobservasi, dan tidak menjadi tempat persembunyian business logic yang tidak terkelola.

---

## 1. Database-Side Logic: Spektrum

Tidak semua database logic sama.

Spektrum dari paling deklaratif ke paling imperatif:

```text
NOT NULL / CHECK / UNIQUE / FK
generated columns
views
materialized views
functions
stored procedures
triggers
custom extensions / procedural code
```

Secara umum:

- semakin deklaratif, semakin mudah dianalisis
- semakin imperatif, semakin fleksibel tetapi semakin tersembunyi
- semakin dekat ke data, semakin kuat untuk invariant
- semakin jauh dari app, semakin perlu governance/deployment/testing yang serius

Rule praktis:

> Gunakan constraint deklaratif jika cukup. Gunakan trigger/procedure hanya jika constraint/query biasa tidak cukup atau ada alasan operasional kuat.

---

## 2. Stored Function vs Stored Procedure

Terminologi berbeda antar database, tetapi konsep umumnya:

### 2.1 Function

Function biasanya:

- menerima input
- mengembalikan value/table
- dapat dipakai dalam SQL expression
- kadang harus deterministic/immutable/stable untuk index
- bisa read-only atau melakukan side effect tergantung vendor

Example PostgreSQL-style:

```sql
CREATE FUNCTION normalize_case_number(input TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT upper(regexp_replace(trim(input), '\s+', '', 'g'));
$$;
```

Use:

```sql
SELECT normalize_case_number(' case-001 ');
```

### 2.2 Procedure

Procedure biasanya:

- dipanggil dengan `CALL`
- lebih oriented ke imperative workflow
- bisa melakukan multiple statements
- bisa manage transaction di beberapa database
- cocok untuk batch/administrative operation

Example conceptual:

```sql
CALL close_case(:tenant_id, :case_id, :user_id, :reason);
```

Vendor semantics vary. PostgreSQL has procedures and functions; SQL Server uses stored procedures extensively; Oracle PL/SQL packages; MySQL stored routines.

---

## 3. Trigger

Trigger adalah logic yang otomatis berjalan ketika event terjadi pada table.

Events:

```text
BEFORE INSERT
AFTER INSERT
BEFORE UPDATE
AFTER UPDATE
BEFORE DELETE
AFTER DELETE
INSTEAD OF
```

Granularity:

```text
FOR EACH ROW
FOR EACH STATEMENT
```

Example use cases:

- set `updated_at`
- audit old/new values
- maintain derived column
- maintain summary table
- enforce complex invariant
- prevent deletion
- insert outbox/audit event
- sync shadow table

Trigger sangat powerful karena semua writer terkena, tidak hanya aplikasi Java.

Tapi trigger juga hidden side effect.

---

## 4. Mengapa Database-Side Logic Bisa Berguna

### 4.1 Semua Writer Tercakup

Jika invariant hanya di Java service, batch/manual/migration bisa bypass.

Trigger/constraint berlaku untuk:

- Java app
- admin SQL
- migration
- batch job
- ETL
- another service
- future app version

### 4.2 Atomic dengan Data

Trigger berjalan dalam transaction yang sama.

Jika trigger insert audit row:

```text
main update commit -> audit commit
main update rollback -> audit rollback
```

### 4.3 Dekat dengan Data

Logic seperti normalization, audit, and invariant checks sering lebih natural dekat dengan table.

### 4.4 Mengurangi Duplikasi

Beberapa services bisa share same database rule.

### 4.5 Performance

Stored procedure/function dapat mengurangi round trips untuk data-heavy operation.

Namun performance benefit tidak otomatis; procedural row-by-row database code juga bisa lambat.

---

## 5. Mengapa Database-Side Logic Bisa Berbahaya

### 5.1 Hidden Side Effects

App menjalankan:

```sql
UPDATE cases SET status = 'CLOSED' WHERE id = :id;
```

Ternyata trigger:

- insert audit row
- update read model
- send notification via extension
- modify updated_at
- change status
- write outbox event

Jika tidak diketahui, debugging sulit.

### 5.2 Deployment Complexity

Database code perlu migration/versioning.

Rollback tidak selalu mudah.

### 5.3 Vendor Lock-In

PL/pgSQL, T-SQL, PL/SQL, MySQL routines berbeda.

### 5.4 Testing Gap

Java unit tests tidak mengetes trigger jika tidak pakai real DB integration test.

### 5.5 ORM Surprise

Trigger mengubah column, tetapi entity di persistence context tidak tahu sampai refresh.

### 5.6 Performance Surprise

Trigger berjalan per row bisa membuat bulk update sangat lambat.

### 5.7 Business Logic Split

Sebagian logic di Java, sebagian di DB, sebagian di Kafka consumer. Mudah drift.

---

## 6. Decision Principle

Taruh logic di database jika:

```text
logic adalah data invariant, audit integrity, derivation dekat data, atau harus berlaku untuk semua writer.
```

Taruh logic di Java jika:

```text
logic adalah workflow orchestration, authorization kompleks, external API, UX decision, cross-service policy, atau sering berubah dan butuh rich domain model.
```

Gunakan hybrid jika:

```text
Java memutuskan command dan workflow, database menjaga invariant dan audit dasar.
```

---

## 7. Good Database-Side Logic Candidates

### 7.1 Constraints

Always prefer declarative constraints:

```sql
CHECK (amount >= 0)
UNIQUE (tenant_id, case_number_normalized)
FOREIGN KEY (...)
```

### 7.2 Generated Columns

Good for deterministic derived values:

```text
normalized key
search vector
computed bucket
```

### 7.3 Audit Triggers

Useful if audit must cover all writers.

### 7.4 Updated Timestamp

Can be trigger, but beware semantics.

### 7.5 Conditional Invariant Not Expressible by Constraint

Trigger may enforce if no declarative option exists.

### 7.6 Outbox Insert

Sometimes trigger inserts outbox for table changes, but design carefully.

### 7.7 Security/RLS Policies

Database-level access rules can prevent bypass.

---

## 8. Bad Database-Side Logic Candidates

Avoid putting these blindly in DB:

```text
calling external HTTP API
sending email
publishing Kafka directly
complex user authorization with many app concepts
large workflow orchestration
business rules that change weekly
logic requiring app feature flags
logic requiring rich object graph
logic needing external service data
UI-specific validation
long-running batch loops in trigger
```

Triggers/procedures should not make database transaction wait on external systems.

Use outbox/event-driven integration.

---

## 9. Functions for Normalization

Case number normalization:

```sql
CREATE FUNCTION normalize_case_number(input TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT upper(regexp_replace(trim(input), '\s+', '', 'g'));
$$;
```

Use in generated column:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_number TEXT NOT NULL,
    case_number_normalized TEXT GENERATED ALWAYS AS (
        normalize_case_number(case_number)
    ) STORED,

    UNIQUE (tenant_id, case_number_normalized)
);
```

Benefits:

- app cannot forget normalization
- uniqueness uses normalized value
- one source of normalization truth

Caveat:

- function immutability must be true
- regex behavior/collation must be understood
- changing function may require recomputation/reindexing
- portability reduced

---

## 10. Function Volatility

PostgreSQL-style volatility categories:

```text
IMMUTABLE
STABLE
VOLATILE
```

Concept:

### 10.1 IMMUTABLE

Same input always same output forever.

Example:

```text
lowercase pure ASCII normalization
```

### 10.2 STABLE

Same result within a statement but can change across statements.

Example:

```text
current setting lookup
```

### 10.3 VOLATILE

Can change anytime or has side effects.

Example:

```text
random()
now() depending semantics
sequence nextval
modifying table
```

Why it matters:

- optimizer assumptions
- expression indexes
- generated columns
- query planning
- correctness

Do not mark function immutable if it depends on table data, current time, locale changing rules, or external state.

---

## 11. Functions in WHERE Clause

Function can hurt performance if applied to column.

Bad without expression index:

```sql
WHERE normalize_case_number(case_number) = :normalized
```

Better:

```sql
WHERE case_number_normalized = :normalized
```

or expression index:

```sql
CREATE INDEX idx_cases_normalized_expr
ON cases (normalize_case_number(case_number));
```

Rule:

> If function is used in predicate frequently, plan index/derived column intentionally.

---

## 12. Stored Procedures for Transactional Workflows

Procedure example concept:

```sql
CALL close_case(
    p_tenant_id,
    p_case_id,
    p_user_id,
    p_reason
);
```

Inside procedure:

- lock case
- validate status
- update case
- insert transition
- insert audit
- insert outbox

Pros:

- one DB call
- atomic server-side
- all apps can use same command
- reduced round trips
- can enforce workflow close to data

Cons:

- business workflow moves out of Java
- testing/deployment harder
- error mapping harder
- vendor-specific
- app domain model may become thin
- versioning procedure contracts needed

Use for carefully chosen operations, not as default.

---

## 13. Procedure Contract Design

If exposing procedure to app, treat it like API.

Define:

```text
name
parameters
types
return values
errors
idempotency
transaction semantics
locking behavior
authorization assumption
versioning
side effects
```

Bad:

```sql
CALL do_case_stuff(...);
```

Good:

```sql
CALL close_case(
    p_tenant_id,
    p_case_id,
    p_actor_id,
    p_expected_version,
    p_reason,
    p_command_id
);
```

Return structured result if supported:

```text
closed
already_closed
not_found
invalid_state
version_conflict
```

Do not force app to parse vague error strings.

---

## 14. Trigger Timing: BEFORE vs AFTER

### 14.1 BEFORE Trigger

Runs before row is inserted/updated/deleted.

Use for:

- setting derived values
- normalizing input
- validating and raising error
- modifying NEW row

Example:

```text
before insert/update set updated_at
```

### 14.2 AFTER Trigger

Runs after row change.

Use for:

- audit insert
- outbox insert
- summary maintenance
- side effect table updates

### 14.3 INSTEAD OF Trigger

Used on views in some databases.

Use for:

- updatable views
- controlled write API

Be explicit why chosen timing.

---

## 15. Row-Level vs Statement-Level Triggers

### 15.1 Row-Level

Runs once per affected row.

```text
UPDATE 10,000 rows -> trigger runs 10,000 times
```

Good for per-row audit.

Can be expensive.

### 15.2 Statement-Level

Runs once per statement.

```text
UPDATE 10,000 rows -> trigger runs once
```

Good for batch-level metadata, but less access to row details unless transition tables are supported.

Bulk DML performance depends heavily on trigger granularity.

---

## 16. Trigger Example: updated_at

Common requirement:

```text
updated_at always changes when row changes
```

PostgreSQL-style function:

```sql
CREATE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
```

Trigger:

```sql
CREATE TRIGGER trg_cases_set_updated_at
BEFORE UPDATE ON cases
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
```

Pros:

- all writers covered
- app cannot forget

Cons:

- ORM may not know updated value until refresh
- every update changes updated_at, including no-op updates
- can cause index churn if updated_at indexed
- may complicate optimistic locking if semantics unclear

---

## 17. Avoid No-Op Update Churn

If trigger always sets updated_at, even no-op update changes row.

Better:

```sql
CREATE FUNCTION set_updated_at_if_changed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW IS DISTINCT FROM OLD THEN
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END;
$$;
```

But note:

- `updated_at` itself differs after setting
- compare relevant columns carefully if needed
- generated/no-op semantics can get tricky
- vendor syntax differs

Often better: avoid issuing no-op updates from app.

---

## 18. Trigger Example: Audit Log

Audit table:

```sql
CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    old_values JSONB,
    new_values JSONB,
    changed_at TIMESTAMPTZ NOT NULL,
    changed_by UUID
);
```

Trigger function concept:

```sql
CREATE FUNCTION audit_cases_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_events (...)
        VALUES (..., 'INSERT', NULL, to_jsonb(NEW), now(), current_setting('app.user_id', true)::uuid);
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_events (...)
        VALUES (..., 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), now(), current_setting('app.user_id', true)::uuid);
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_events (...)
        VALUES (..., 'DELETE', to_jsonb(OLD), NULL, now(), current_setting('app.user_id', true)::uuid);
        RETURN OLD;
    END IF;
END;
$$;
```

Trigger:

```sql
CREATE TRIGGER trg_cases_audit
AFTER INSERT OR UPDATE OR DELETE ON cases
FOR EACH ROW
EXECUTE FUNCTION audit_cases_changes();
```

This is powerful, but must be designed carefully.

---

## 19. Passing Actor Context to Trigger

Trigger needs actor/user.

Options:

### 19.1 App Sets Session Variable

PostgreSQL-style:

```sql
SELECT set_config('app.user_id', :user_id, true);
```

Trigger reads:

```sql
current_setting('app.user_id', true)
```

Caveats:

- connection pooling
- reset after transaction
- missing context
- security
- testing

### 19.2 Audit in Application

Application inserts audit row explicitly.

Pros:

- actor context natural
- business action better represented

Cons:

- can be forgotten/bypassed
- all writers must comply

### 19.3 Hybrid

Trigger captures technical audit; app writes business audit/event.

This is often best.

---

## 20. Technical Audit vs Business Event

Trigger audit:

```text
row changed from old JSON to new JSON
```

Business event:

```text
CASE_ESCALATED by officer for reason X
```

They are not the same.

Technical audit answers:

```text
What row changed?
```

Business event answers:

```text
What domain action happened?
```

Do not rely only on generic audit trigger for business history.

Use:

```text
case_status_transitions
approval_actions
decision_versions
business events
```

for domain audit.

---

## 21. Trigger Example: Outbox

A trigger can insert outbox event after table change.

Example:

```sql
CREATE FUNCTION enqueue_case_closed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.status = 'CLOSED' THEN
        INSERT INTO outbox_events (
            id,
            aggregate_type,
            aggregate_id,
            event_type,
            payload,
            created_at
        )
        VALUES (
            gen_random_uuid(),
            'CASE',
            NEW.id,
            'CASE_CLOSED',
            jsonb_build_object(
                'caseId', NEW.id,
                'tenantId', NEW.tenant_id,
                'closedAt', NEW.closed_at
            ),
            now()
        );
    END IF;

    RETURN NEW;
END;
$$;
```

Trigger:

```sql
CREATE TRIGGER trg_cases_case_closed_outbox
AFTER UPDATE OF status ON cases
FOR EACH ROW
EXECUTE FUNCTION enqueue_case_closed();
```

Pros:

- event cannot be forgotten
- all status changes covered
- atomic with update

Cons:

- event semantics tied to column change, not command intent
- may fire during migration/backfill
- may emit event for admin repair
- duplicate/ordering semantics must be managed
- app may not expect side effect
- payload versioning needed

For domain events, application-explicit outbox is often clearer.

---

## 22. Trigger and Bulk Operations

Suppose:

```sql
UPDATE cases
SET status = 'CLOSED'
WHERE opened_at < :cutoff;
```

If trigger writes outbox per row, bulk update creates many events.

Maybe desired.

Maybe catastrophic.

Before trigger deployment, ask:

```text
What happens on backfill?
What happens on data repair?
Should trigger be disabled?
Should events be suppressed?
How is actor/reason recorded?
Can outbox handle volume?
```

Triggers affect all DML, including operations you did not imagine.

---

## 23. Trigger Recursion

Trigger updates table that fires trigger again.

Example:

```sql
AFTER UPDATE ON cases
UPDATE cases SET updated_at = now() WHERE id = NEW.id;
```

This can recurse or cause extra updates.

Prefer BEFORE trigger modifying `NEW` for same-row derived values.

If trigger updates related tables, ensure no cycle.

Trigger graphs can become hard to reason about:

```text
table A trigger updates B
B trigger updates C
C trigger updates A
```

Avoid complex trigger chains.

---

## 24. Trigger Ordering

If multiple triggers on same table/event, order matters.

Vendor rules vary.

Relying on trigger order can be fragile.

If order matters, consider:

- one trigger function orchestrating steps
- explicit naming/order if vendor supports
- simpler design
- move orchestration to app/procedure

Document trigger interactions.

---

## 25. Error Handling in Triggers

Trigger can raise error, causing statement/transaction failure.

Example:

```sql
RAISE EXCEPTION 'Invalid transition';
```

This is powerful for enforcement.

But app sees database exception.

Need:

- stable error codes/constraint names
- mapping to domain errors
- clear messages for logs
- tests
- avoid leaking internal details to user

Prefer constraints for simple validation because their errors are standard.

---

## 26. Generated Columns

Generated column is a column computed by database.

Example concept:

```sql
case_number_normalized TEXT GENERATED ALWAYS AS (
    upper(regexp_replace(trim(case_number), '\s+', '', 'g'))
) STORED
```

Use cases:

- normalized keys
- computed date bucket
- extracted JSON key
- lowercased identifier
- derived numeric amount
- search vector

Benefits:

- deterministic
- not hidden trigger
- queryable
- indexable
- app cannot write wrong value

Caveats:

- vendor-specific
- expression restrictions
- migration/backfill cost
- changing expression may rewrite table/recompute
- may be stored or virtual depending vendor

Generated columns are often better than triggers for pure derivation.

---

## 27. Domain Types and Custom Types

Some databases support domain types.

PostgreSQL example:

```sql
CREATE DOMAIN positive_amount AS NUMERIC(19,2)
CHECK (VALUE >= 0);
```

Use:

```sql
amount positive_amount NOT NULL
```

Pros:

- reusable constraint
- semantic type
- central rule

Cons:

- vendor-specific
- migration complexity
- app mapping may be less obvious
- changing domain affects many columns

Use for stable, repeated domain constraints.

---

## 28. Views as Database Logic

View:

```sql
CREATE VIEW active_cases AS
SELECT *
FROM cases
WHERE deleted_at IS NULL;
```

Benefits:

- reusable query
- access control abstraction
- hides complexity
- stable read API

Risks:

- performance hidden
- nested views become complex
- predicate pushdown limitations
- view column changes affect consumers
- not all views updatable
- app may not understand underlying joins

Views are logic. Treat them as versioned database API.

---

## 29. Updatable Views and INSTEAD OF Triggers

Some systems expose views for writes:

```sql
CREATE VIEW public_cases AS
SELECT ...
FROM cases
WHERE confidential = false;
```

`INSTEAD OF` trigger controls insert/update/delete through view.

Use cases:

- security abstraction
- compatibility layer
- legacy schema API
- controlled mutation

Risks:

- very hidden write behavior
- hard debugging
- ORM mapping complexity
- vendor-specific
- performance surprises

Use sparingly.

---

## 30. Materialized Views

Materialized view stores query result physically.

Use for:

- expensive aggregation
- reporting
- read model
- dashboard
- search projection

Example:

```sql
CREATE MATERIALIZED VIEW case_status_counts AS
SELECT
    tenant_id,
    status,
    COUNT(*) AS case_count
FROM cases
GROUP BY tenant_id, status;
```

Need refresh:

```sql
REFRESH MATERIALIZED VIEW case_status_counts;
```

Caveats:

- stale data
- refresh locks depending vendor/options
- refresh cost
- indexes on materialized view
- incremental refresh not always available
- ownership/rebuild strategy

Materialized view is database-side read model.

---

## 31. Row-Level Security Policies

Some databases support row-level security.

Concept:

```sql
CREATE POLICY tenant_isolation ON cases
USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

Benefits:

- defense-in-depth for multi-tenancy
- prevents accidental cross-tenant reads
- all SQL writers subject to policy
- useful for shared-schema SaaS

Risks:

- session context with connection pool
- performance/predicate pushdown
- debugging hidden filters
- migration/admin bypass rules
- app must set context correctly
- ORMs may not expect filtered rows

RLS can be powerful, but operationally serious.

---

## 32. Security Definer Functions

Database functions can run with definer privileges.

Use cases:

- controlled privileged operation
- hide table access behind function
- enforce validation in one place

Risks:

- privilege escalation if unsafe
- SQL injection inside function dynamic SQL
- search path vulnerabilities
- auditing complexity
- vendor-specific security model

Security definer code must be reviewed like security-critical code.

---

## 33. Dynamic SQL in Stored Code

Stored procedures can build SQL strings.

Danger:

```sql
EXECUTE 'SELECT * FROM ' || table_name;
```

Risks:

- SQL injection
- permission bypass
- plan cache issues
- quoting bugs
- hard to analyze

Use safe identifier quoting, bind variables, and restrict inputs.

Dynamic SQL in DB is advanced; avoid unless needed.

---

## 34. Testing Database-Side Logic

Test database logic with real database.

Tests should cover:

- trigger fires on insert/update/delete
- bulk update behavior
- audit row content
- actor context
- rollback behavior
- constraint/function errors
- generated column values
- trigger not firing when not expected
- performance on batch
- migration from old data
- ORM refresh behavior

Do not rely only on Java mocks.

Use integration tests with migration tool applying real schema.

---

## 35. Versioning Database Code

Database code must be versioned through migrations.

Examples:

```text
V021__create_normalize_case_number.sql
V022__add_cases_audit_trigger.sql
V023__replace_close_case_procedure.sql
```

Rules:

- no manual production-only procedure changes
- migration creates/replaces function
- deployment order coordinated with app
- rollback/fix-forward strategy
- compatibility during rolling deploy
- function signature versioning if needed
- test migration from previous version

Database code is code.

---

## 36. Rolling Deployment Compatibility

App v1 and v2 may run simultaneously during deploy.

If changing function/procedure:

- keep backward-compatible signature
- add new function name/version
- deploy DB first if app depends on new object
- avoid dropping old function until old app gone
- handle nullable/new columns expand-contract
- ensure triggers compatible with both write formats

Example:

```sql
close_case_v1(...)
close_case_v2(...)
```

or additive parameters with defaults if supported.

---

## 37. Observability for Database-Side Logic

Need observe:

- trigger execution time
- function/procedure errors
- audit/outbox volume
- rows affected
- deadlocks involving triggers
- slow statements caused by trigger
- invalid context missing
- outbox size growth
- materialized view refresh duration
- RLS policy effects
- procedure call latency

Database-side logic can be invisible in application logs unless instrumented.

---

## 38. Error Mapping to Java

Database-side logic can raise:

- constraint violation
- custom exception
- lock timeout
- deadlock
- serialization failure
- permission denied
- trigger exception
- function not found
- invalid cast
- null violation

Java layer should map:

```text
database technical error -> domain/application error
```

Constraint/function errors should have stable identifiers.

Avoid parsing localized error text.

Prefer SQL state / vendor code / constraint name / structured result.

---

## 39. Stored Procedure Return Strategies

Procedure/function can communicate result via:

- result set
- output parameters
- status code
- raised exception
- inserted row
- affected row count
- JSON payload

For business command, avoid only generic exception.

Example result table:

```text
status: CLOSED | ALREADY_CLOSED | NOT_FOUND | INVALID_STATE | VERSION_CONFLICT
case_id
new_version
message
```

This makes Java handling explicit.

---

## 40. Business Logic Placement Matrix

| Logic Type | Prefer DB | Prefer Java |
|---|---|---|
| Simple invariant | Constraint | Also validate for UX |
| Normalized key | Generated column/function | Java may compute input too |
| State transition orchestration | Maybe procedure for core DB-owned domain | Often Java service |
| Technical audit | Trigger | App can enrich business audit |
| Business event | Usually explicit app/outbox | DB trigger only if table-change semantics enough |
| External API call | No | Yes, outside transaction/outbox |
| Authorization | RLS for defense-in-depth | Java for workflow/user context |
| Summary counts | Materialized view/trigger/projection | Java job/projection service |
| Complex frequently changing policy | Rarely | Usually Java/rule service |
| Cross-row invariant | Constraint/lock/serializable/trigger | Java coordinates but DB enforces |

---

## 41. Mini Case Study: Normalize Case Number

Requirement:

```text
case_number unique per tenant ignoring spaces/case
```

Option:

```sql
CREATE FUNCTION normalize_case_number(input TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT upper(regexp_replace(trim(input), '\s+', '', 'g'));
$$;

CREATE TABLE cases (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_number TEXT NOT NULL,
    case_number_normalized TEXT GENERATED ALWAYS AS (
        normalize_case_number(case_number)
    ) STORED,
    UNIQUE (tenant_id, case_number_normalized)
);
```

This is excellent DB-side logic because:

- pure deterministic derivation
- enforces invariant
- all writers covered
- app can still show friendly validation

---

## 42. Mini Case Study: Audit Trigger

Requirement:

```text
Every change to cases must be technically auditable, including manual SQL.
```

Trigger is good candidate.

But design:

- audit table partitioned by time?
- old/new JSON size?
- actor context?
- PII redaction?
- bulk migration suppression?
- retention?
- performance?
- app logs correlation?
- business event separate?

Audit trigger is not just code snippet; it is operational feature.

---

## 43. Mini Case Study: State Transition Procedure

Requirement:

```text
All clients must close case through same rule.
```

Stored procedure can enforce:

- lock case
- validate status
- update case
- insert transition
- insert outbox
- return result

Useful if multiple clients write same DB and DB is domain boundary.

But if only one Java service owns database, Java service with constraints/guarded updates may be more maintainable.

Decision depends architecture.

---

## 44. Mini Case Study: Trigger-Maintained Summary Count

Requirement:

```text
Dashboard count by status must be instant.
```

Trigger approach:

```text
on cases insert/update status/delete -> update case_status_counts
```

Pros:

- strongly consistent
- fast reads

Cons:

- writes slower
- hot counter rows
- deadlocks possible
- trigger complexity
- bulk update expensive
- repair/rebuild needed

Alternative:

- async projection
- materialized view
- periodic refresh
- cache

If exact real-time not required, async may be better.

---

## 45. Mini Case Study: Outbox via Trigger vs Application

### Trigger Outbox

Pros:

- cannot forget event for table change
- all writers covered

Cons:

- table change may not equal domain event
- migration/backfill emits unwanted events
- payload lacks command context
- hard versioning

### Application Explicit Outbox

Pros:

- event represents command intent
- payload can include domain context
- easier versioning
- clearer tests

Cons:

- app can forget insert
- other writers bypass
- repeated across services unless abstracted

Hybrid:

- app explicit business outbox
- trigger technical audit

Usually clearer.

---

## 46. Anti-Patterns

```text
[ ] Trigger sends HTTP request
[ ] Trigger publishes Kafka directly
[ ] Trigger chain across many tables
[ ] Business workflow hidden in many triggers
[ ] Procedure named do_everything
[ ] No tests for stored code
[ ] Manual prod function edits
[ ] Trigger audit without actor context
[ ] Trigger outbox emits during backfill unexpectedly
[ ] Function marked IMMUTABLE but reads table/current setting
[ ] Generated column used for changing business rule without migration plan
[ ] ORM entity stale because trigger changed columns
[ ] Materialized view with unknown freshness
[ ] RLS enabled without connection-pool context discipline
[ ] Dynamic SQL in function with unsanitized identifiers
```

---

## 47. Database-Side Logic Review Checklist

```text
[ ] Why must this logic be in DB?
[ ] Could a constraint/generated column solve it declaratively?
[ ] What writers must be covered?
[ ] What side effects occur?
[ ] Does it run per row or per statement?
[ ] What happens on bulk update/backfill?
[ ] What happens on rollback?
[ ] How is actor/request context passed?
[ ] How is it tested?
[ ] How is it versioned?
[ ] How is it monitored?
[ ] What is vendor lock-in impact?
[ ] Does ORM need refresh/returning?
[ ] What errors are raised and how mapped?
[ ] Is performance measured?
[ ] Is there a safe migration/rollback?
```

---

## 48. Practical Exercises

### Exercise 1 — Choose Constraint or Trigger

Rule:

```text
amount must be >= 0
```

Answer:

```sql
CHECK (amount >= 0)
```

Not trigger.

### Exercise 2 — Choose Generated Column

Rule:

```text
case_number_normalized = normalized case_number
```

Use generated column/function if DB supports.

### Exercise 3 — Audit All Writers

Requirement:

```text
manual SQL changes must be audited
```

Trigger is valid candidate.

Design actor context.

### Exercise 4 — Business Event

Requirement:

```text
CASE_CLOSED event must include reason and command_id
```

Usually application explicit outbox is clearer than table-change trigger.

### Exercise 5 — Avoid Trigger External Call

Explain why sending email from trigger is bad and propose outbox.

---

## 49. Koneksi ke Part Berikutnya

Part ini membahas database-side logic.

Part berikutnya, `part-022`, akan membahas views, materialized views, dan read models lebih dalam:

- view as saved query
- security views
- updatable views
- materialized view refresh
- read model design
- consistency/freshness
- projection rebuild
- when views help vs hide complexity

Kita sudah menyentuh views/materialized views di sini; berikutnya kita bahas khusus sebagai desain read layer.

---

## 50. Ringkasan Bagian Ini

Hal penting dari part 021:

1. Database-side logic mencakup functions, procedures, triggers, generated columns, views, materialized views, and policies.
2. Prefer declarative constraints before triggers/procedures.
3. Stored functions cocok untuk reusable deterministic computation.
4. Stored procedures cocok untuk selected transactional operations, tetapi harus dianggap API.
5. Triggers kuat karena semua writer tercakup, tetapi side effect tersembunyi.
6. BEFORE trigger cocok untuk memodifikasi NEW row; AFTER trigger cocok untuk audit/outbox/related writes.
7. Row-level triggers bisa mahal pada bulk operations.
8. Generated columns sering lebih baik daripada trigger untuk pure derivation.
9. Technical audit dan business event adalah hal berbeda.
10. Actor context in triggers requires careful session/connection handling.
11. Trigger outbox can work but may confuse table changes with domain events.
12. Database code must be migrated, tested, versioned, and monitored.
13. ORM may not know trigger-generated changes unless refreshed/returned.
14. RLS is powerful defense-in-depth but operationally serious.
15. Security definer and dynamic SQL require security review.
16. Materialized views are database-side read models with freshness/refresh trade-offs.
17. Database-side logic should not call external systems directly.
18. Java remains better for orchestration, external integration, and frequently changing complex policy.
19. Hybrid design is often best: Java orchestrates commands, DB enforces invariants and audit foundations.
20. Every database-side logic must answer: why DB, how tested, how deployed, how observed?

Kalimat inti:

> Logic di database bukan anti-pattern dan bukan silver bullet; ia adalah bagian dari system design yang harus dipakai ketika kedekatan dengan data memberi correctness atau operational value yang lebih besar daripada biaya hidden complexity-nya.

---

## 51. Referensi

1. PostgreSQL Documentation — SQL Functions.  
   https://www.postgresql.org/docs/current/xfunc-sql.html

2. PostgreSQL Documentation — PL/pgSQL.  
   https://www.postgresql.org/docs/current/plpgsql.html

3. PostgreSQL Documentation — Triggers.  
   https://www.postgresql.org/docs/current/triggers.html

4. PostgreSQL Documentation — CREATE TRIGGER.  
   https://www.postgresql.org/docs/current/sql-createtrigger.html

5. PostgreSQL Documentation — Generated Columns.  
   https://www.postgresql.org/docs/current/ddl-generated-columns.html

6. PostgreSQL Documentation — Row Security Policies.  
   https://www.postgresql.org/docs/current/ddl-rowsecurity.html

7. PostgreSQL Documentation — Views.  
   https://www.postgresql.org/docs/current/sql-createview.html

8. PostgreSQL Documentation — Materialized Views.  
   https://www.postgresql.org/docs/current/rules-materializedviews.html

9. MySQL 8.4 Reference Manual — Stored Objects.  
   https://dev.mysql.com/doc/refman/8.4/en/stored-objects.html

10. SQL Server Documentation — Stored Procedures and Triggers.  
    https://learn.microsoft.com/en-us/sql/relational-databases/stored-procedures/stored-procedures-database-engine  
    https://learn.microsoft.com/en-us/sql/relational-databases/triggers/triggers

11. Oracle Database PL/SQL Language Reference.  
    https://docs.oracle.com/en/database/oracle/oracle-database/23/lnpls/

12. Spring Framework Documentation — Transaction Management.  
    https://docs.spring.io/spring-framework/reference/data-access/transaction.html

---

## 52. Status Seri

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

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-022.md` — Views, Materialized Views, and Read Models


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-020.md">⬅️ Part 20 — Locking, MVCC, Deadlocks, and Concurrency Control</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-022.md">Part 22 — Views, Materialized Views, and Read Models ➡️</a>
</div>
