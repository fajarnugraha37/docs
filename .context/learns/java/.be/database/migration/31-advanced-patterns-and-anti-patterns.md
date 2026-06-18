# Part 31 — Advanced Patterns and Anti-Patterns

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `31-advanced-patterns-and-anti-patterns.md`  
**Scope:** Java 8–25, Flyway, Liquibase, relational database migration, production-grade schema/data evolution  
**Status:** Part 31 of 34

---

## 1. Why This Part Exists

By this point, we have already covered the fundamentals:

- migration taxonomy,
- invariants and failure models,
- Flyway mental model,
- Liquibase mental model,
- seeding,
- deterministic data migration,
- expand/contract,
- locking,
- vendor-specific concerns,
- testing,
- Spring Boot/Jakarta/non-Spring integration,
- CI/CD,
- multi-service ownership,
- multi-tenancy,
- security,
- compliance,
- observability,
- runbooks.

This part is different.

This part is about the patterns that appear when systems are already large, already live, already integrated, already politically complicated, and already hard to stop.

In small systems, database migration often means:

```text
Write ALTER TABLE.
Run migration.
Done.
```

In serious systems, migration means:

```text
Change the shape of persistent state
while old code may still run,
new code may be partially rolled out,
batch jobs may still read old columns,
reports may depend on legacy views,
integration partners may lag,
tenants may be migrated in waves,
and operations must remain auditable.
```

The deeper skill is not knowing one more Flyway or Liquibase command.

The deeper skill is knowing **which migration shape** fits the risk profile.

---

## 2. Advanced Migration Thinking

Advanced migration engineering starts from one uncomfortable fact:

> A production database is not just storage. It is an evolving compatibility boundary.

That boundary is shared by:

- application services,
- admin portals,
- public APIs,
- scheduled jobs,
- reporting queries,
- ETL jobs,
- audit systems,
- downstream consumers,
- support tools,
- data analysts,
- security tools,
- third-party integrations,
- old application versions during rolling deployment,
- new application versions during partial rollout.

Therefore, many “simple” changes are not simple.

Example:

```sql
ALTER TABLE users RENAME COLUMN name TO full_name;
```

This looks simple in development.

But in production, it may break:

- old application pods,
- report queries,
- stored procedures,
- Kafka outbox serializers,
- manual support SQL,
- BI dashboards,
- batch exports,
- audit reconstruction logic,
- rollback compatibility.

A top-tier engineer does not ask only:

```text
Can this SQL run?
```

They ask:

```text
Can this state transition survive partial deployment, retry, rollback, drift, concurrency, and human recovery?
```

---

## 3. Migration Pattern Selection Model

Before using any advanced pattern, classify the change along these axes.

### 3.1 Is the Change Breaking or Compatible?

Compatible change examples:

- add nullable column,
- add unused table,
- add index,
- add optional foreign key later,
- add new lookup row,
- add new view while old view remains.

Breaking change examples:

- drop column,
- rename column directly,
- change type incompatibly,
- tighten nullability before backfill,
- remove enum/status value still used,
- remove table consumed by reporting,
- change primary key meaning,
- change unique constraint without cleanup.

Advanced patterns are mostly needed when a change is breaking but downtime is not acceptable.

### 3.2 Is Data Transformation Required?

Schema-only changes are often easier.

Data-transforming changes introduce more failure modes:

- partial update,
- performance degradation,
- inconsistent derived values,
- wrong business rule,
- old and new columns disagree,
- backfill cannot finish in deployment window,
- retry causes duplicate side effects,
- rollback cannot restore original semantic state.

### 3.3 Is the Old Application Still Running During Migration?

In rolling deployment, blue/green, canary, or Kubernetes environments, old and new application versions may overlap.

That means the database must support more than one application contract at the same time.

```text
Old app version expects old schema.
New app version expects new schema.
Database must temporarily support both.
```

This is the core reason expand/contract exists.

### 3.4 Is the Change Local or Cross-Boundary?

Local change:

```text
Only one service owns and uses the table.
```

Cross-boundary change:

```text
Multiple services, reports, jobs, or external systems depend on it.
```

Cross-boundary changes usually require compatibility patterns, deprecation windows, and explicit contract management.

### 3.5 Is the Migration Online or Offline?

Offline migration means:

```text
Stop writes, migrate, verify, restart.
```

Online migration means:

```text
System keeps serving traffic while state shape changes.
```

Most advanced patterns exist to make online migration possible.

---

## 4. Pattern 1 — Shadow Column Migration

A shadow column migration introduces a new column beside the old one, migrates data gradually, switches reads/writes, then removes the old column later.

### 4.1 Problem It Solves

Direct column changes are dangerous:

```sql
ALTER TABLE customer ALTER COLUMN phone_number TYPE VARCHAR(32);
```

or:

```sql
ALTER TABLE customer RENAME COLUMN phone TO phone_number;
```

These can break old code immediately.

A shadow column avoids the break.

### 4.2 Shape

```text
Phase 1 — Expand
Add new column.

Phase 2 — Dual-write or derive
Write both old and new column.

Phase 3 — Backfill
Populate new column from old data.

Phase 4 — Read switch
Application reads new column.

Phase 5 — Contract
Stop using old column and drop it later.
```

### 4.3 Example

Suppose old schema:

```sql
CREATE TABLE customer (
    id BIGINT PRIMARY KEY,
    phone VARCHAR(20)
);
```

We want to move to normalized phone format:

```text
country_code + national_number
```

Bad migration:

```sql
ALTER TABLE customer DROP COLUMN phone;
ALTER TABLE customer ADD country_code VARCHAR(4) NOT NULL;
ALTER TABLE customer ADD national_number VARCHAR(32) NOT NULL;
```

This breaks old code and risks data loss.

Safer sequence:

```sql
ALTER TABLE customer ADD country_code VARCHAR(4);
ALTER TABLE customer ADD national_number VARCHAR(32);
```

Then application version N+1 writes:

```java
public void updatePhone(Customer customer, PhoneNumber phoneNumber) {
    customer.setPhone(phoneNumber.toLegacyString());
    customer.setCountryCode(phoneNumber.countryCode());
    customer.setNationalNumber(phoneNumber.nationalNumber());
}
```

Backfill:

```sql
UPDATE customer
SET country_code = '+65',
    national_number = phone
WHERE country_code IS NULL
  AND national_number IS NULL
  AND phone IS NOT NULL;
```

Later application reads new columns first:

```java
public PhoneNumber readPhone(Customer customer) {
    if (customer.getCountryCode() != null && customer.getNationalNumber() != null) {
        return new PhoneNumber(customer.getCountryCode(), customer.getNationalNumber());
    }
    return PhoneNumber.fromLegacy(customer.getPhone());
}
```

Eventually:

```sql
ALTER TABLE customer ALTER COLUMN country_code SET NOT NULL;
ALTER TABLE customer ALTER COLUMN national_number SET NOT NULL;
ALTER TABLE customer DROP COLUMN phone;
```

### 4.4 Invariant

During the compatibility window:

```text
Either old data can derive new data,
or new data can derive old data,
or both are written consistently.
```

### 4.5 Failure Modes

| Failure | Cause | Mitigation |
|---|---|---|
| New column partially populated | Backfill interrupted | Idempotent backfill with resume |
| Old and new values diverge | Dual-write bug | Consistency checker |
| New read path fails | Bad transformation logic | Fallback to old column during transition |
| Contract too early | Old code still uses old column | Drop only after telemetry proves no usage |

### 4.6 When to Use

Use shadow columns when:

- changing column meaning,
- changing type,
- splitting one column into many,
- merging data shape,
- preserving old app compatibility,
- avoiding long blocking DDL.

Avoid when:

- column is unused,
- migration is purely additive,
- downtime is acceptable,
- backfill cannot be deterministic.

---

## 5. Pattern 2 — Shadow Table Migration

A shadow table migration creates a new table beside the old table, moves/copies data gradually, switches readers/writers, and later retires the old table.

### 5.1 Problem It Solves

Some changes are too large for column-level migration:

- table split,
- table merge,
- normalization,
- denormalization,
- primary key strategy change,
- partitioning restructure,
- tenant isolation change,
- audit model redesign.

Direct table replacement is usually unsafe.

### 5.2 Shape

```text
Old table remains live.
New table is introduced.
Application writes old and new or synchronizes them.
Historical data is backfilled.
Read path is switched.
Old table is frozen.
Old table is removed only after verification.
```

### 5.3 Example — Splitting `account` into `account` and `account_profile`

Old table:

```sql
CREATE TABLE account (
    id BIGINT PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    display_name VARCHAR(200),
    bio CLOB,
    avatar_url VARCHAR(500),
    created_at TIMESTAMP NOT NULL
);
```

New target:

```sql
CREATE TABLE account_profile (
    account_id BIGINT PRIMARY KEY,
    display_name VARCHAR(200),
    bio CLOB,
    avatar_url VARCHAR(500),
    CONSTRAINT fk_account_profile_account
        FOREIGN KEY (account_id) REFERENCES account(id)
);
```

Phase 1 migration:

```sql
CREATE TABLE account_profile (
    account_id BIGINT PRIMARY KEY,
    display_name VARCHAR(200),
    bio CLOB,
    avatar_url VARCHAR(500),
    CONSTRAINT fk_account_profile_account
        FOREIGN KEY (account_id) REFERENCES account(id)
);
```

Phase 2 application dual-write:

```java
@Transactional
public void updateProfile(long accountId, ProfileUpdate command) {
    accountRepository.updateLegacyProfileColumns(accountId, command);
    accountProfileRepository.upsertProfile(accountId, command);
}
```

Phase 3 backfill:

```sql
INSERT INTO account_profile (account_id, display_name, bio, avatar_url)
SELECT id, display_name, bio, avatar_url
FROM account a
WHERE NOT EXISTS (
    SELECT 1
    FROM account_profile p
    WHERE p.account_id = a.id
);
```

Phase 4 read switch:

```java
public AccountView getAccount(long accountId) {
    Account account = accountRepository.findById(accountId);
    AccountProfile profile = accountProfileRepository.findByAccountId(accountId)
        .orElseGet(() -> AccountProfile.fromLegacyAccount(account));

    return AccountView.from(account, profile);
}
```

Phase 5 contract:

```sql
ALTER TABLE account DROP COLUMN display_name;
ALTER TABLE account DROP COLUMN bio;
ALTER TABLE account DROP COLUMN avatar_url;
```

### 5.4 Key Design Question

For a shadow table, the most important question is:

```text
What is the synchronization model between old table and new table?
```

Common models:

| Model | Description | Risk |
|---|---|---|
| Application dual-write | App writes both tables | App bug can cause divergence |
| Trigger synchronization | DB trigger writes shadow table | Hidden DB logic; vendor-specific |
| Batch synchronization | Periodic job syncs old to new | Temporary lag |
| CDC synchronization | Change data capture syncs new table | Operational complexity |
| Write freeze then copy | Stop writes briefly and copy | Requires maintenance window |

### 5.5 Invariant

```text
At cutover, every required row in the new table must be derivable, present, and consistent with the old table according to the chosen source of truth.
```

### 5.6 Verification Queries

Count parity:

```sql
SELECT COUNT(*) FROM account WHERE display_name IS NOT NULL;
SELECT COUNT(*) FROM account_profile WHERE display_name IS NOT NULL;
```

Missing rows:

```sql
SELECT a.id
FROM account a
LEFT JOIN account_profile p ON p.account_id = a.id
WHERE p.account_id IS NULL;
```

Divergence:

```sql
SELECT a.id
FROM account a
JOIN account_profile p ON p.account_id = a.id
WHERE COALESCE(a.display_name, '<<NULL>>') <> COALESCE(p.display_name, '<<NULL>>')
   OR COALESCE(a.avatar_url, '<<NULL>>') <> COALESCE(p.avatar_url, '<<NULL>>');
```

### 5.7 When to Use

Use shadow table migration when:

- table structure changes deeply,
- old and new representations must coexist,
- data volume is large,
- migration must be online,
- read path can be switched gradually.

Avoid when:

- simple additive change is enough,
- no one can own synchronization logic,
- verification is unclear,
- table is too write-heavy and dual-write is risky without strong guarantees.

---

## 6. Pattern 3 — Dual-Write Migration

Dual-write means the application writes to both old and new representations during a transition.

It is powerful but dangerous.

### 6.1 Why Dual-Write Exists

Dual-write solves compatibility overlap:

```text
Old readers still need old data.
New readers need new data.
Writes must keep both valid.
```

### 6.2 Example

Old:

```sql
order.status VARCHAR(32)
```

New:

```sql
order_status_history(order_id, status, changed_at)
```

Application:

```java
@Transactional
public void changeStatus(long orderId, OrderStatus newStatus) {
    orderRepository.updateCurrentStatus(orderId, newStatus.name());
    orderStatusHistoryRepository.append(orderId, newStatus, clock.instant());
}
```

### 6.3 The Trap

Many engineers treat dual-write as simple:

```text
Just write twice.
```

But dual-write has consistency risks.

Potential failures:

- first write succeeds, second fails,
- second write succeeds, first fails,
- retry duplicates second write,
- old representation and new representation diverge,
- event consumer sees one side but not the other,
- transaction boundary does not include both writes,
- cross-database dual-write is not atomic.

### 6.4 Safe Dual-Write Within One Database Transaction

When both representations are in the same database, use one transaction.

```java
@Transactional
public void updateCustomer(CustomerUpdate command) {
    legacyCustomerRepository.update(command);
    normalizedCustomerRepository.upsert(command);
}
```

This is usually acceptable if:

- same database,
- same transaction manager,
- same failure boundary,
- no external side effect,
- retry is idempotent.

### 6.5 Dangerous Dual-Write Across Systems

Dangerous:

```java
@Transactional
public void updateCustomer(CustomerUpdate command) {
    database.updateCustomer(command);
    externalCrmClient.updateCustomer(command);
}
```

The database transaction does not rollback the external system.

For cross-system migration, prefer:

- outbox pattern,
- CDC,
- asynchronous reconciliation,
- idempotent external update,
- compensating action,
- explicit consistency window.

### 6.6 Dual-Write Invariants

```text
For every accepted business write, both old and new representation must eventually describe the same business fact.
```

Notice the word **eventually**.

If both writes are in one local DB transaction, consistency can be immediate.

If writes cross systems, consistency is usually eventual.

### 6.7 Consistency Checker

Dual-write must be paired with a checker.

Example:

```sql
SELECT o.id, o.status, latest.status AS latest_status
FROM orders o
JOIN (
    SELECT h.order_id, h.status
    FROM order_status_history h
    JOIN (
        SELECT order_id, MAX(changed_at) AS max_changed_at
        FROM order_status_history
        GROUP BY order_id
    ) x ON x.order_id = h.order_id
       AND x.max_changed_at = h.changed_at
) latest ON latest.order_id = o.id
WHERE o.status <> latest.status;
```

### 6.8 When to Use

Use dual-write when:

- old and new representations must coexist,
- writes continue during migration,
- both representations can be kept consistent,
- you can test and observe divergence.

Avoid when:

- cross-system atomicity is assumed but not real,
- no reconciliation exists,
- business transformation is non-deterministic,
- old and new models cannot express the same fact.

---

## 7. Pattern 4 — Compatibility View

A compatibility view preserves an old read contract while the underlying table structure changes.

### 7.1 Problem It Solves

Reports, legacy jobs, or old app code may still query old shape.

Instead of keeping old table shape forever, create a view that exposes the old contract.

### 7.2 Example

New normalized tables:

```sql
CREATE TABLE customer (
    id BIGINT PRIMARY KEY,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE customer_profile (
    customer_id BIGINT PRIMARY KEY,
    display_name VARCHAR(200),
    email VARCHAR(320)
);
```

Old consumers expect:

```sql
customer_legacy(id, display_name, email, created_at)
```

Compatibility view:

```sql
CREATE VIEW customer_legacy AS
SELECT c.id,
       p.display_name,
       p.email,
       c.created_at
FROM customer c
LEFT JOIN customer_profile p ON p.customer_id = c.id;
```

### 7.3 Where It Helps

- reporting compatibility,
- gradual consumer migration,
- avoiding direct table exposure,
- DB API boundary,
- legacy read-only integrations.

### 7.4 Risks

| Risk | Explanation |
|---|---|
| Performance | View may hide expensive joins |
| Semantic mismatch | Old shape may not perfectly represent new model |
| Updatability | Not all views are safely writable |
| Dependency sprawl | Consumers may keep using compatibility view forever |
| Security | View may expose data accidentally |

### 7.5 Governance Rule

Every compatibility view should have:

```text
owner,
reason,
consumer list,
created release,
planned removal release,
performance expectation,
access policy.
```

Without this, compatibility views become permanent technical debt.

### 7.6 Flyway Repeatable View Example

```sql
-- R__view_customer_legacy.sql
CREATE OR REPLACE VIEW customer_legacy AS
SELECT c.id,
       p.display_name,
       p.email,
       c.created_at
FROM customer c
LEFT JOIN customer_profile p ON p.customer_id = c.id;
```

Repeatable migration fits views well because the view definition is an object definition, not historical state transition.

### 7.7 Liquibase SQL Changeset Example

```sql
--liquibase formatted sql

--changeset platform:view-customer-legacy-001 runOnChange:true
CREATE OR REPLACE VIEW customer_legacy AS
SELECT c.id,
       p.display_name,
       p.email,
       c.created_at
FROM customer c
LEFT JOIN customer_profile p ON p.customer_id = c.id;
```

Use `runOnChange` carefully. It is suitable for replaceable object definitions, not arbitrary data changes.

---

## 8. Pattern 5 — Compatibility Column

A compatibility column keeps an old column available temporarily while new logic uses a new representation.

This is similar to shadow column, but the emphasis is on preserving old consumers.

### 8.1 Example

New model stores status as foreign key:

```sql
CREATE TABLE case_status (
    id BIGINT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE
);

ALTER TABLE case_file ADD status_id BIGINT;
```

Old consumers still read:

```sql
case_file.status_code
```

Keep `status_code` as compatibility column until consumers migrate.

Application writes both:

```java
caseFile.setStatusId(status.id());
caseFile.setStatusCode(status.code());
```

### 8.2 Invariant

```text
status_code must be equivalent to status_id -> case_status.code.
```

Verification:

```sql
SELECT cf.id, cf.status_code, cs.code
FROM case_file cf
JOIN case_status cs ON cs.id = cf.status_id
WHERE cf.status_code <> cs.code;
```

### 8.3 Removal Criteria

Do not drop compatibility column just because new code works.

Drop only after:

- old app versions no longer deployed,
- reports updated,
- batch jobs updated,
- manual scripts updated,
- query logs show no usage,
- agreed deprecation window passed,
- rollback plan no longer needs it.

---

## 9. Pattern 6 — Dark Migration

Dark migration means migrating data or schema in production before exposing the new behavior to users.

### 9.1 Mental Model

```text
Prepare state silently.
Verify silently.
Only then switch behavior.
```

This reduces release risk because the expensive or risky database work happens before feature activation.

### 9.2 Example

A new search feature requires normalized searchable terms.

Instead of enabling feature and backfilling during release:

1. Add table `search_document`.
2. Backfill existing records in background.
3. Keep table updated with new writes.
4. Compare search results against old logic internally.
5. Enable feature flag for small user group.
6. Roll out gradually.

### 9.3 Benefits

- lower release pressure,
- earlier discovery of data issues,
- safer performance testing,
- can pause before user impact,
- enables progressive rollout.

### 9.4 Risks

- hidden cost in production,
- unused new structure if feature is abandoned,
- silent divergence,
- insufficient cleanup,
- migration work mistaken as harmless because feature is disabled.

### 9.5 Required Controls

Dark migration still needs:

- migration ticket,
- owner,
- metrics,
- logs,
- verification queries,
- kill switch,
- cleanup plan,
- security review if data is duplicated.

---

## 10. Pattern 7 — Trigger-Assisted Migration

Database triggers can keep old and new representations synchronized.

### 10.1 Why Use Triggers?

Triggers help when not all writers are controlled by the application.

Examples:

- multiple applications write same table,
- legacy batch jobs write directly,
- vendor integration writes to database,
- manual admin operations exist,
- transition period requires database-level consistency.

### 10.2 Example

Old table:

```sql
customer(id, email)
```

New table:

```sql
customer_email(customer_id, email, is_primary)
```

Trigger idea:

```text
When customer.email changes,
upsert customer_email primary row.
```

Pseudo-SQL:

```sql
CREATE TRIGGER trg_customer_email_sync
AFTER INSERT OR UPDATE OF email ON customer
FOR EACH ROW
BEGIN
    -- vendor-specific implementation
    -- upsert into customer_email
END;
```

### 10.3 Benefits

- protects against non-application writers,
- centralizes synchronization at database boundary,
- useful for gradual migrations,
- can reduce application dual-write complexity.

### 10.4 Risks

| Risk | Explanation |
|---|---|
| Hidden behavior | Application developers may not know trigger exists |
| Performance | Every write pays trigger cost |
| Debuggability | Side effects occur inside DB |
| Vendor lock-in | Trigger syntax differs heavily |
| Recursive bugs | Trigger writes may trigger other triggers |
| Deployment ordering | Trigger depends on tables/columns existing |
| Rollback complexity | Old and new behavior may interact unexpectedly |

### 10.5 Rule of Thumb

Use triggers only when:

```text
You need database-level enforcement because application-only synchronization is insufficient.
```

Do not use triggers merely because they feel clever.

### 10.6 Required Documentation

Every migration-created trigger should include:

- purpose,
- expected lifetime,
- affected writes,
- performance risk,
- removal migration,
- verification query,
- owner.

---

## 11. Pattern 8 — CDC-Assisted Migration

CDC means Change Data Capture. Instead of application dual-write or trigger sync, database changes are captured from logs and applied to a new representation.

### 11.1 Use Cases

- large table migration,
- database split,
- service extraction,
- read model construction,
- cross-database replication,
- online migration with minimal app changes,
- migration from monolith DB to service-owned DB.

### 11.2 Shape

```text
Initial snapshot old data.
Capture ongoing changes.
Apply changes to new target.
Monitor lag.
Verify parity.
Cut over reads/writes.
Stop CDC after stable period.
```

### 11.3 Benefits

- decouples migration from application release,
- handles large data volume,
- supports online migration,
- can support cross-database movement,
- useful for service decomposition.

### 11.4 Risks

- operational complexity,
- replication lag,
- ordering issues,
- schema evolution during CDC,
- delete semantics,
- exactly-once illusion,
- target write idempotency,
- monitoring burden,
- cutover complexity.

### 11.5 Invariant

```text
Target state must converge to source state before cutover, and every source change after snapshot must be applied exactly according to business semantics.
```

Not necessarily exactly once physically, but exactly once semantically.

### 11.6 Java System Consideration

For Java systems, CDC-assisted migration often interacts with:

- Debezium,
- Kafka,
- outbox tables,
- connector workers,
- idempotent consumers,
- schema registry,
- transaction log permissions,
- database retention settings.

Do not hide CDC migration inside Flyway or Liquibase migration scripts.

Flyway/Liquibase can create the supporting schema objects, but CDC orchestration should be treated as an operational/data platform workflow.

---

## 12. Pattern 9 — Outbox-Assisted Migration

Outbox pattern is commonly used for reliable event publishing, but it can also support migration.

### 12.1 Use Case

Suppose a monolith is extracting customer data into a new customer service.

Instead of dual-writing directly to another service/database:

1. Monolith writes business change and outbox event in same transaction.
2. Outbox publisher emits event.
3. New service consumes event idempotently.
4. New service builds its own database.
5. Cutover happens after backfill and stream catch-up.

### 12.2 Outbox Table

```sql
CREATE TABLE outbox_event (
    id UUID PRIMARY KEY,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload CLOB NOT NULL,
    created_at TIMESTAMP NOT NULL,
    published_at TIMESTAMP NULL
);
```

### 12.3 Java Write Example

```java
@Transactional
public void updateCustomer(UpdateCustomerCommand command) {
    Customer customer = customerRepository.getForUpdate(command.customerId());
    customer.apply(command);

    outboxRepository.insert(new OutboxEvent(
        UUID.randomUUID(),
        "Customer",
        String.valueOf(customer.id()),
        "CustomerUpdated",
        json.serialize(CustomerUpdated.from(customer)),
        clock.instant()
    ));
}
```

### 12.4 Migration Role

Outbox-assisted migration is useful when:

- target state belongs to another service,
- cross-database transaction is unavailable,
- event stream can drive convergence,
- target consumer is idempotent,
- eventual consistency is acceptable.

### 12.5 Anti-Illusion

Outbox does not magically solve all migration consistency.

You still need:

- initial snapshot,
- event ordering strategy,
- replay strategy,
- idempotency keys,
- poison message handling,
- lag monitoring,
- parity validation,
- cutover plan.

---

## 13. Pattern 10 — Read Switch / Write Switch

Many migrations fail because teams switch everything at once.

A safer approach is to separate write switch and read switch.

### 13.1 Write Switch

Write switch changes where new writes go.

Examples:

- write old only,
- write old + new,
- write new + old compatibility,
- write new only.

### 13.2 Read Switch

Read switch changes where reads come from.

Examples:

- read old only,
- read new with fallback old,
- read old and compare new silently,
- read new only.

### 13.3 Recommended Sequence

Usually safer:

```text
1. Add new structure.
2. Write both.
3. Backfill new structure.
4. Read new with fallback.
5. Read new only.
6. Stop writing old.
7. Drop old later.
```

### 13.4 Feature Flag Example

```java
public CustomerProfile getProfile(long customerId) {
    if (flags.isEnabled("profile.read.new-table")) {
        return profileRepository.findByCustomerId(customerId)
            .orElseGet(() -> legacyProfileRepository.findByCustomerId(customerId));
    }
    return legacyProfileRepository.findByCustomerId(customerId);
}
```

### 13.5 Shadow Read

Shadow read means reading the new representation without using it for user-visible output.

```java
CustomerProfile oldProfile = legacyRepository.find(customerId);
CustomerProfile newProfile = newRepository.find(customerId).orElse(null);

comparisonLogger.compare("customer-profile", customerId, oldProfile, newProfile);

return oldProfile;
```

Use this to detect divergence before cutover.

### 13.6 Risk

Shadow reads increase load. Use sampling for high-traffic paths.

```java
if (sampler.shouldSample(customerId)) {
    compareAsync(customerId);
}
```

---

## 14. Pattern 11 — Reconciliation Job

A reconciliation job checks and repairs divergence between old and new representations.

### 14.1 Why It Exists

Any migration involving dual-write, CDC, triggers, or asynchronous sync can drift.

Reconciliation is the safety net.

### 14.2 Types

| Type | Purpose |
|---|---|
| Detection-only | Find mismatches |
| Repairing | Fix mismatches automatically |
| Sampling | Check subset for low overhead |
| Full scan | Complete verification |
| Continuous | Runs periodically during transition |
| Cutover gate | Must pass before read/write switch |

### 14.3 Java Reconciliation Skeleton

```java
public final class CustomerProfileReconciliationJob {

    private final LegacyCustomerRepository legacy;
    private final NewCustomerProfileRepository modern;
    private final ReconciliationMarkerRepository markers;

    public void runBatch(long lastSeenId, int limit) {
        List<LegacyCustomer> rows = legacy.findAfterId(lastSeenId, limit);

        for (LegacyCustomer row : rows) {
            CustomerProfile expected = CustomerProfile.fromLegacy(row);
            CustomerProfile actual = modern.find(row.id()).orElse(null);

            if (!expected.equalsSemantically(actual)) {
                // Depending on mode: log, metric, or repair
                modern.upsert(row.id(), expected);
            }

            markers.saveLastSeenId(row.id());
        }
    }
}
```

### 14.4 Repair Guard

Automatic repair must be conservative.

Ask:

```text
Which side is the source of truth?
Can repair overwrite legitimate new data?
Is the transformation reversible?
Can repair run multiple times safely?
```

### 14.5 Metrics

Track:

- rows scanned,
- mismatches found,
- mismatches repaired,
- failed repairs,
- scan lag,
- duration,
- last processed key,
- mismatch rate by type.

---

## 15. Pattern 12 — Migration Fence

A migration fence prevents unsafe concurrent activity while migration proceeds.

### 15.1 Problem

Some migrations cannot tolerate certain writes during the transition.

Example:

- changing uniqueness semantics,
- merging duplicate identities,
- rebuilding derived ledger state,
- moving tenant data,
- converting workflow states.

### 15.2 Fence Types

| Fence | Description |
|---|---|
| Application fence | App rejects or delays certain operations |
| Feature flag fence | Disable feature temporarily |
| Tenant fence | Freeze one tenant during migration |
| Row-level fence | Lock or mark records being migrated |
| Queue fence | Pause consumers/producers |
| Operational fence | Maintenance window or deployment freeze |

### 15.3 Example — Tenant Migration Fence

```sql
ALTER TABLE tenant ADD migration_status VARCHAR(32) DEFAULT 'ACTIVE' NOT NULL;
```

Application guard:

```java
public void assertTenantWritable(String tenantId) {
    Tenant tenant = tenantRepository.get(tenantId);
    if (tenant.migrationStatus() == MigrationStatus.MIGRATING) {
        throw new TenantTemporarilyUnavailableException(tenantId);
    }
}
```

### 15.4 Warning

A migration fence is a user impact decision.

It needs:

- business approval,
- UX behavior,
- support communication,
- timeout/escape hatch,
- audit record.

---

## 16. Pattern 13 — Contract Registry for Shared Database Changes

In multi-service or multi-module systems, table/column usage is often not obvious.

A contract registry records who depends on which database objects.

### 16.1 Example Registry

```yaml
databaseContracts:
  - object: case_file.status_code
    owner: case-management
    consumers:
      - compliance-reporting
      - notification-batch
      - appeal-module
    deprecation:
      plannedReplacement: case_file.status_id
      replacementAvailableSince: 2026.04
      removalNotBefore: 2026.08
```

### 16.2 Why It Matters

Without usage visibility, teams drop or rename objects based only on application code search.

But consumers may exist in:

- SQL reports,
- stored procedures,
- external ETL,
- cron jobs,
- manual scripts,
- other repositories,
- BI tools.

### 16.3 Integration with Migration Review

Before destructive migration:

```text
Check contract registry.
Identify consumers.
Notify owners.
Provide compatibility path.
Get removal approval.
```

This is not bureaucracy when the blast radius is real.

It is engineering control.

---

## 17. Pattern 14 — Deprecation Window

A deprecation window is the time between making a replacement available and removing the old database contract.

### 17.1 Example

```text
Release 2026.04:
- Add status_id.
- Keep status_code.
- New code writes both.

Release 2026.05:
- Consumers migrate to status_id.
- Monitor status_code usage.

Release 2026.06:
- Stop writing status_code.
- Keep compatibility view.

Release 2026.07:
- Drop status_code after approval.
```

### 17.2 Why It Matters

Destructive changes should rarely happen in the same release that introduces replacements.

A deprecation window gives:

- rollback safety,
- consumer migration time,
- usage monitoring,
- human coordination,
- staged risk reduction.

### 17.3 Rule

```text
Replacement first, removal later.
```

---

## 18. Pattern 15 — Progressive Constraint Introduction

Constraints are good, but adding them abruptly can break production if existing data violates them or if validation locks too much.

### 18.1 Common Constraints

- NOT NULL,
- UNIQUE,
- FOREIGN KEY,
- CHECK,
- exclusion constraints,
- status-domain constraints.

### 18.2 Safe Sequence

```text
1. Add nullable/new column.
2. Backfill valid data.
3. Add application validation.
4. Detect violations.
5. Clean violations.
6. Add constraint in non-blocking or low-risk mode if DB supports it.
7. Validate constraint.
8. Monitor errors.
```

### 18.3 Example — NOT NULL

Bad:

```sql
ALTER TABLE invoice ADD due_date DATE NOT NULL;
```

Safer:

```sql
ALTER TABLE invoice ADD due_date DATE;
```

Backfill:

```sql
UPDATE invoice
SET due_date = created_at + INTERVAL '30' DAY
WHERE due_date IS NULL;
```

Verify:

```sql
SELECT COUNT(*) FROM invoice WHERE due_date IS NULL;
```

Then:

```sql
ALTER TABLE invoice ALTER COLUMN due_date SET NOT NULL;
```

Syntax varies by database.

### 18.4 Example — Unique Constraint

Before adding unique constraint:

```sql
SELECT email, COUNT(*)
FROM account
GROUP BY email
HAVING COUNT(*) > 1;
```

Clean duplicates first.

Then add unique index/constraint.

### 18.5 Production Principle

A constraint should be the final enforcement of an already-true invariant, not the first time you discover production data is invalid.

---

## 19. Pattern 16 — Online Data Correction

Not every data correction belongs in versioned migration.

### 19.1 Problem

A one-time correction may be:

- too large,
- business-sensitive,
- environment-specific,
- based on production-only data,
- requiring approval per case,
- requiring audit evidence,
- requiring partial execution.

Putting it into Flyway/Liquibase may be wrong.

### 19.2 Better Model

Use a controlled correction job:

- ticket-bound,
- parameterized,
- dry-run capable,
- audited,
- idempotent,
- resumable,
- reviewed,
- verified.

### 19.3 Example Correction Table

```sql
CREATE TABLE data_correction_request (
    id BIGINT PRIMARY KEY,
    correction_type VARCHAR(100) NOT NULL,
    requested_by VARCHAR(100) NOT NULL,
    approved_by VARCHAR(100),
    status VARCHAR(32) NOT NULL,
    payload CLOB NOT NULL,
    created_at TIMESTAMP NOT NULL,
    executed_at TIMESTAMP NULL
);
```

### 19.4 Java Execution Model

```java
@Transactional
public CorrectionResult execute(long requestId) {
    DataCorrectionRequest request = requestRepository.lockById(requestId);

    if (!request.isApproved()) {
        throw new IllegalStateException("Correction not approved");
    }

    CorrectionResult result = correctionHandlers
        .get(request.type())
        .execute(request.payload());

    request.markExecuted(clock.instant(), result.summary());
    return result;
}
```

### 19.5 When to Use Flyway/Liquibase Instead

Use migration tool when correction is:

- part of product schema evolution,
- deterministic across environments,
- required for app compatibility,
- safe to run in every environment,
- not dependent on production-only case facts.

---

## 20. Pattern 17 — Generated Migration with Human Review

Generated migrations can accelerate work but must not be blindly trusted.

### 20.1 Sources of Generated Migration

- ORM schema diff,
- Liquibase diff,
- IDE tools,
- database modeling tools,
- AI-generated SQL,
- vendor schema compare tools.

### 20.2 Risks

Generated migration may:

- drop columns unexpectedly,
- rename as drop+add,
- lose data,
- create bad constraint names,
- ignore indexes,
- choose wrong data type,
- create environment-specific SQL,
- ignore production volume,
- assume empty database,
- miss online DDL concerns.

### 20.3 Safe Workflow

```text
Generate draft.
Review semantically.
Rewrite for production safety.
Test against real DB engine.
Run from previous release snapshot.
Measure lock/performance risk.
Only then commit.
```

### 20.4 Review Questions

- Does this preserve data?
- Does this break old app version?
- Does this run safely with production volume?
- Does this create long locks?
- Does this assume empty table?
- Does this require backfill?
- Does this need expand/contract instead?
- Does this need seed/versioning?
- Does this work on the actual database vendor?

---

## 21. Anti-Pattern 1 — Editing Old Migrations

### 21.1 The Temptation

A developer notices an old migration has a typo or missing column and edits it.

This works locally if the database is recreated from scratch.

It fails in shared environments where migration already ran.

### 21.2 Why It Is Dangerous

Migration tools use migration history and checksums.

Editing already-applied migration creates history mismatch.

More importantly, it destroys historical truth.

The database already experienced the old migration. You cannot pretend it did not.

### 21.3 Correct Approach

Create a new migration:

```text
V2026_06_17_1200__fix_missing_customer_index.sql
```

Do not mutate history.

### 21.4 Exception

Editing old migration may be acceptable only when:

- migration has never been committed to main branch,
- never applied to any shared environment,
- no one else has pulled it,
- no artifact has been released.

Otherwise, create a new migration.

---

## 22. Anti-Pattern 2 — ORM Auto-DDL in Serious Environments

### 22.1 The Temptation

```properties
spring.jpa.hibernate.ddl-auto=update
```

It feels convenient.

The app starts and schema changes automatically.

### 22.2 Why It Is Dangerous

ORM auto-DDL:

- is not a controlled migration plan,
- may not produce optimal SQL,
- does not encode data migration,
- may behave differently by dialect,
- lacks proper review,
- can create drift,
- can surprise production,
- does not handle expand/contract choreography,
- can mask missing migrations.

### 22.3 Correct Use

Acceptable for:

- throwaway prototypes,
- local experiments,
- tests with disposable DB,
- learning.

Not acceptable for:

- shared dev,
- SIT/UAT,
- production,
- regulated systems,
- multi-service systems.

### 22.4 Better Model

Use Hibernate/JPA metadata to inform migration creation, but apply schema changes through Flyway/Liquibase.

---

## 23. Anti-Pattern 3 — Big Bang Migration

### 23.1 Shape

```text
One huge release:
- rename columns,
- drop old table,
- backfill millions of rows,
- change app code,
- add constraints,
- update reports,
- migrate integrations,
- enable new feature.
```

### 23.2 Why It Fails

Big bang migration maximizes simultaneous uncertainty.

If failure happens, you do not know whether the cause is:

- schema,
- data,
- code,
- performance,
- lock,
- integration,
- seed,
- report,
- deployment order,
- environment drift.

### 23.3 Better Model

Break into phases:

```text
Expand.
Backfill.
Verify.
Dual-run.
Switch.
Observe.
Contract.
```

Each phase should have independent verification.

---

## 24. Anti-Pattern 4 — Rollback Fantasy

### 24.1 The Fantasy

```text
If anything goes wrong, we just rollback.
```

This is often false for database changes.

### 24.2 Why Database Rollback Is Hard

Rollback can be impossible if:

- column was dropped,
- data was overwritten,
- data was transformed lossy,
- new app wrote data old app cannot understand,
- external systems observed new state,
- constraints rejected old behavior,
- sequence values advanced,
- rows were merged,
- audit meaning changed.

### 24.3 Better Question

Do not ask only:

```text
Can we rollback?
```

Ask:

```text
Can old app run safely against new database state?
```

This is rollback compatibility.

### 24.4 Preferred Strategy

For many production database changes, prefer:

```text
roll-forward fix
```

over:

```text
rollback database state
```

But this requires:

- backward-compatible migration,
- no destructive change too early,
- feature flags,
- compatibility columns/views,
- backups,
- clear runbook.

---

## 25. Anti-Pattern 5 — Manual Hotfix Without History

### 25.1 Shape

Production issue occurs.

Someone runs SQL manually:

```sql
ALTER TABLE payment ADD retry_count INT;
```

The issue is fixed.

But migration history does not know.

### 25.2 Consequences

- production differs from UAT,
- future migration fails,
- local dev cannot reproduce,
- audit evidence weak,
- schema drift accumulates,
- disaster recovery restore misses manual steps,
- team loses trust in migration history.

### 25.3 Correct Emergency Workflow

If manual hotfix is unavoidable:

```text
1. Record exact SQL.
2. Record who approved.
3. Record execution time.
4. Verify result.
5. Immediately create equivalent migration.
6. Apply/mark consistently across environments.
7. Document drift reconciliation.
```

### 25.4 Principle

Production hotfix may bypass pipeline temporarily.

It must not bypass history permanently.

---

## 26. Anti-Pattern 6 — Environment Conditional Chaos

### 26.1 Shape

Migration contains too many branches:

```sql
-- if dev do this
-- if uat do that
-- if prod skip this
-- if tenant A do custom thing
-- if tenant B use different value
```

### 26.2 Why It Is Dangerous

The same migration no longer means the same thing.

It becomes hard to answer:

```text
What schema state does version 42 represent?
```

### 26.3 Better Model

Separate:

- schema migration,
- environment configuration,
- tenant customization,
- test data,
- production correction,
- secret provisioning.

Use contexts/labels carefully in Liquibase. Use locations/placeholders carefully in Flyway.

But do not turn migration into an environment-specific programming language.

---

## 27. Anti-Pattern 7 — Seed as Mutable Configuration Store

### 27.1 Shape

Teams put frequently changing operational config into migration seed files.

Example:

```sql
UPDATE system_config SET value = 'true' WHERE key = 'enableNewFlow';
```

Then next week:

```sql
UPDATE system_config SET value = 'false' WHERE key = 'enableNewFlow';
```

### 27.2 Why It Is Dangerous

Migration history becomes polluted with operational toggles.

It becomes unclear whether a value is:

- product default,
- environment override,
- temporary incident setting,
- feature flag,
- tenant-specific config,
- support action.

### 27.3 Better Model

Use migrations for:

- required reference data,
- stable product defaults,
- schema-compatible bootstrap data.

Use config management/admin UI/feature flag system for:

- runtime toggles,
- tenant-specific settings,
- incident switches,
- operational overrides.

---

## 28. Anti-Pattern 8 — Long Transaction Backfill

### 28.1 Shape

```sql
UPDATE huge_table
SET normalized_value = expensive_function(raw_value)
WHERE normalized_value IS NULL;
```

On millions of rows.

Inside one migration transaction.

### 28.2 Risks

- long locks,
- undo/redo/WAL explosion,
- replication lag,
- deadlocks,
- timeout,
- rollback takes long,
- application performance drops,
- migration cannot resume cleanly.

### 28.3 Better Model

Use chunking:

```text
Process by primary key range.
Commit per chunk if outside migration transaction.
Track progress.
Throttle.
Resume.
Verify.
```

Sometimes this should be an application-managed backfill job, not a Flyway/Liquibase migration.

---

## 29. Anti-Pattern 9 — Test Only on Empty Database

### 29.1 Shape

Migration works on fresh local database.

But production has:

- existing data,
- old constraints,
- duplicates,
- null values,
- large volume,
- drift,
- old indexes,
- invalid references,
- long-running transactions.

### 29.2 Correct Test Matrix

Test migration against:

- empty database,
- previous release schema,
- previous release schema with realistic data,
- production-like volume sample,
- known dirty data cases,
- rollback/roll-forward scenario,
- repeated execution where applicable,
- real database engine.

### 29.3 Principle

Fresh install test proves installation.

Upgrade test proves migration.

They are different.

---

## 30. Anti-Pattern 10 — Assuming H2 Equals Production DB

### 30.1 Problem

H2 is convenient for tests, but it does not fully behave like Oracle/PostgreSQL/MySQL/SQL Server.

Migration behavior can differ in:

- DDL syntax,
- transaction behavior,
- locking,
- identifier casing,
- data types,
- sequence behavior,
- date/time behavior,
- constraints,
- JSON support,
- CLOB/BLOB behavior,
- index options.

### 30.2 Better Model

Use Testcontainers or dedicated integration DB for migration tests.

H2 may still be useful for fast unit tests, but not as final proof of migration correctness.

---

## 31. Anti-Pattern 11 — Treating Flyway/Liquibase as Backup

Migration tools are not backups.

They record intended state transitions.

They do not guarantee you can reconstruct all production data.

Before destructive migration:

- take backup/snapshot,
- verify restore procedure,
- know restore time objective,
- know data loss tolerance,
- know whether point-in-time recovery exists,
- coordinate with operations.

Migration history answers:

```text
What scripts ran?
```

Backup answers:

```text
Can we restore data?
```

Different questions.

---

## 32. Anti-Pattern 12 — Migration Hidden Inside Application Business Logic

### 32.1 Shape

Application startup silently checks schema and mutates database:

```java
if (!columnExists("customer", "new_col")) {
    jdbc.execute("ALTER TABLE customer ADD new_col VARCHAR(100)");
}
```

### 32.2 Why It Is Dangerous

- no migration history,
- multiple app instances race,
- insufficient DB privilege clarity,
- hard to audit,
- hard to reproduce,
- failure mixed with app startup,
- deployment ordering unclear.

### 32.3 Correct Model

Use Flyway/Liquibase or explicit operational job.

Application logic may adapt to old/new schema temporarily, but it should not secretly perform schema governance.

---

## 33. Anti-Pattern 13 — Ignoring Read-Only Consumers

### 33.1 Problem

Teams often search only application write code before changing schema.

But read-only consumers can be numerous:

- reports,
- dashboards,
- ETL,
- BI tools,
- exports,
- audit queries,
- stored procedures,
- support SQL,
- downstream database links.

### 33.2 Result

Migration succeeds technically, but business process breaks.

### 33.3 Mitigation

Before destructive change:

- inspect database dependency metadata,
- search repositories,
- review query logs if available,
- ask reporting/data teams,
- maintain contract registry,
- provide compatibility view,
- set deprecation window.

---

## 34. Anti-Pattern 14 — Treating Migration as Developer-Only Concern

Database migration affects:

- developers,
- DBAs,
- SRE/infra,
- QA,
- release managers,
- support,
- security,
- auditors,
- business owners,
- downstream teams.

For high-risk systems, migration is not only code.

It is release engineering, data governance, and operational risk management.

A top-tier engineer can speak across all three layers.

---

## 35. Decision Matrix: Which Advanced Pattern Should I Use?

| Scenario | Candidate Pattern |
|---|---|
| Rename column without downtime | Shadow column + compatibility column |
| Split table | Shadow table + dual-write + backfill |
| Legacy reports need old shape | Compatibility view |
| New feature needs precomputed data | Dark migration |
| Many uncontrolled DB writers | Trigger-assisted migration |
| Move data to another service DB | CDC or outbox-assisted migration |
| Need compare old/new read behavior | Shadow read |
| Need safe cutover | Read switch/write switch |
| Possible divergence | Reconciliation job |
| Tenant-specific high-risk migration | Migration fence + wave rollout |
| Add strict constraint | Progressive constraint introduction |
| Fix production-only bad data | Controlled correction job |
| Shared DB destructive change | Contract registry + deprecation window |

---

## 36. Pattern Composition Examples

Advanced migrations often combine patterns.

### 36.1 Column Rename Without Downtime

Goal:

```text
customer.name -> customer.full_name
```

Pattern combination:

```text
Shadow column
Dual-write
Backfill
Read switch
Compatibility window
Contract migration
```

Sequence:

```text
1. Add full_name nullable.
2. New app writes name and full_name.
3. Backfill full_name from name.
4. New app reads full_name with fallback name.
5. Verify no null full_name.
6. New app reads full_name only.
7. Stop writing name.
8. Drop name in later release.
```

### 36.2 Service Extraction

Goal:

```text
Move customer ownership from monolith DB to customer service DB.
```

Pattern combination:

```text
Outbox
CDC or snapshot
Shadow read
Reconciliation
Read switch
Write switch
Contract registry
Deprecation window
```

Sequence:

```text
1. Define customer service DB schema.
2. Snapshot existing customer data.
3. Publish ongoing changes via outbox.
4. New service consumes idempotently.
5. Compare monolith and service reads.
6. Switch read path for small percentage.
7. Switch write path.
8. Keep old compatibility path.
9. Remove old ownership after deprecation.
```

### 36.3 Introducing Unique Email Constraint

Goal:

```text
account.email must be unique.
```

Pattern combination:

```text
Data profiling
Online correction
Progressive constraint introduction
Feature/application validation
Constraint migration
```

Sequence:

```text
1. Query duplicates.
2. Decide business resolution for duplicates.
3. Correct data with auditable correction job.
4. Add app-level duplicate prevention.
5. Add unique index/constraint safely.
6. Monitor constraint violations.
```

---

## 37. Advanced Review Checklist

Before approving a high-risk migration, ask:

### 37.1 Compatibility

- Can old app still run after this migration?
- Can new app run before all pods are updated?
- Is rollback code-compatible with migrated schema?
- Are read-only consumers protected?
- Is there a deprecation window?

### 37.2 Data Safety

- Is any data dropped?
- Is any transformation lossy?
- Is backfill deterministic?
- Can migration resume?
- Is there a verification query?
- Is there a reconciliation plan?

### 37.3 Operational Safety

- Does it lock large tables?
- Does it run in one long transaction?
- Does it create heavy redo/WAL/undo?
- Is there a timeout?
- Is there a kill switch?
- Is there a runbook?

### 37.4 Tooling Safety

- Is this a versioned migration or repeatable object definition?
- Is checksum behavior understood?
- Has it been tested from previous release state?
- Is generated SQL manually reviewed?
- Are placeholders safe?
- Are contexts/labels not overused?

### 37.5 Governance

- Who owns the change?
- Who approved it?
- Which systems consume affected objects?
- Is the migration artifact immutable?
- Is there audit evidence?
- Is production manual intervention avoided or documented?

---

## 38. Practical Java/Flyway/Liquibase Guidance

### 38.1 Keep Migration Tool Responsible for Structural History

Use Flyway/Liquibase for:

- schema changes,
- stable reference data,
- repeatable object definitions,
- deterministic small data migrations,
- migration history,
- validation.

Do not force them to own:

- long-running business backfill,
- cross-system synchronization,
- production-only correction workflow,
- CDC orchestration,
- operational feature toggles.

### 38.2 Use Java Jobs for Complex Backfill

If transformation needs:

- chunking,
- checkpointing,
- domain logic,
- metrics,
- retries,
- throttling,
- pause/resume,
- reconciliation,

then a Java migration job may be better than a single migration script.

But still create migration-controlled schema support tables when needed.

### 38.3 Use Feature Flags for Read/Write Switches

Migration-safe feature flags are not just product toggles.

They control state transition:

- read old/new,
- write old/new/both,
- enable fallback,
- enable shadow compare,
- enable tenant wave,
- enable repair mode.

### 38.4 Use Separate Migration and Application Permissions

Advanced patterns often require more privileges than application runtime.

Keep separate:

```text
migration_user: DDL + controlled DML
application_user: runtime DML only
report_user: read-only
admin_user: restricted operational access
```

### 38.5 Prefer Observable Transition States

Each phase should expose state:

```text
expanded
backfilling
dual-writing
shadow-reading
cutover-ready
read-switched
contracted
```

If the team cannot tell what phase the system is in, the migration is not operationally mature.

---

## 39. Mental Model Summary

Advanced database migration is about designing safe state transitions.

The core pattern language:

```text
Expand before use.
Dual-run before cutover.
Verify before switch.
Switch gradually.
Observe after switch.
Contract later.
Never destroy compatibility too early.
```

The core anti-pattern language:

```text
Do not edit history.
Do not trust ORM auto-DDL in production.
Do not big-bang state changes.
Do not assume rollback is real.
Do not hotfix without reconciling history.
Do not bury migration in app startup logic.
Do not test only empty databases.
Do not ignore read-only consumers.
```

Top-tier engineers are not impressive because they know more SQL tricks.

They are impressive because they can move production state safely under uncertainty.

---

## 40. What You Should Be Able to Do After This Part

After this part, you should be able to:

1. Recognize when a migration needs an advanced pattern.
2. Distinguish shadow column, shadow table, compatibility view, trigger sync, CDC, outbox, and dark migration.
3. Explain why dual-write is powerful but dangerous.
4. Design read-switch and write-switch phases separately.
5. Add reconciliation to migrations that can drift.
6. Use migration fences for high-risk tenant or state transitions.
7. Avoid editing old migrations after they are applied.
8. Reject ORM auto-DDL for serious environments.
9. Challenge rollback fantasy.
10. Turn destructive changes into phased compatibility changes.
11. Decide whether a change belongs in Flyway/Liquibase, Java job, CDC pipeline, or operational correction workflow.
12. Review high-risk migrations using compatibility, data safety, operational safety, tooling, and governance criteria.

---

## 41. Connection to Previous and Next Parts

This part builds directly on:

- Part 19 — data migration and backfill engineering,
- Part 20 — expand/contract zero-downtime migration,
- Part 21 — locking, transactions, and online DDL,
- Part 26 — CI/CD pipeline,
- Part 27 — multi-service/shared database ownership,
- Part 28 — multi-tenant migration,
- Part 29 — security/compliance,
- Part 30 — observability and runbooks.

The next part will use these patterns in realistic production scenarios.

Next file:

```text
32-case-studies-production-scenarios.md
```

---

# End of Part 31

Series status:

```text
Part 31 of 34 completed.
Series is not finished yet.
Next: Part 32 — Case Studies: Realistic Production Scenarios.
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 30 — Observability and Operational Runbooks](./30-observability-operational-runbooks.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 32 — Case Studies: Realistic Production Scenarios](./32-case-studies-production-scenarios.md)

</div>