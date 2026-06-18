# Part 32 — Case Studies: Realistic Production Scenarios

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `32-case-studies-production-scenarios.md`  
**Target:** Java 8–25 engineers building production-grade systems with Flyway, Liquibase, Spring Boot, Jakarta EE, plain Java, CI/CD pipelines, and relational databases.

---

## 0. Posisi Bagian Ini Dalam Seri

Sampai titik ini kita sudah membahas migration dari banyak sudut:

- mental model database change;
- taxonomy perubahan database;
- invariants dan failure model;
- versioning;
- Flyway;
- Liquibase;
- seeding;
- backfill;
- expand/contract;
- locking;
- vendor-specific behavior;
- testing;
- Spring Boot/Jakarta/plain Java integration;
- CI/CD;
- multi-service;
- multi-tenant;
- security/compliance;
- observability;
- advanced patterns dan anti-patterns.

Bagian ini menyatukan semuanya dalam **case studies produksi**.

Tujuannya bukan menghafal contoh SQL, tetapi membangun kemampuan untuk melihat sebuah request perubahan database sebagai **sistem risiko**:

> Apa kontrak aplikasi yang berubah?  
> Data apa yang sudah ada?  
> Apakah perubahan bisa hidup berdampingan dengan versi aplikasi lama?  
> Lock apa yang mungkin terjadi?  
> Bagaimana validasi correctness?  
> Bagaimana recovery jika deployment gagal di tengah?  
> Apakah rollback benar-benar mungkin, atau harus roll-forward?

Engineer biasa bertanya:

> “SQL migration-nya apa?”

Engineer production-grade bertanya:

> “Apa strategi perubahan state yang aman dari old world ke new world?”

---

## 1. Cara Membaca Case Study Ini

Setiap case study akan memakai struktur yang sama:

1. **Problem**  
   Perubahan bisnis/teknis yang diminta.

2. **Naive solution**  
   Solusi cepat yang sering terpikir pertama kali.

3. **Why naive solution is dangerous**  
   Risiko tersembunyi: downtime, data loss, lock, incompatibility, rollback failure, seed drift, audit gap.

4. **Production-grade strategy**  
   Urutan aman: migration, deployment, backfill, validation, cleanup.

5. **Flyway/Liquibase implementation sketch**  
   Contoh struktur migration, bukan hanya SQL final.

6. **Java application impact**  
   Apa yang perlu berubah di entity, repository, service, DTO, validation, feature flag, batch job, dan observability.

7. **Validation queries**  
   Query atau mekanisme untuk membuktikan migration benar.

8. **Rollback / roll-forward model**  
   Apa yang bisa dibalik, apa yang tidak, dan apa langkah recovery realistis.

9. **Operational checklist**  
   Hal-hal yang harus dicek sebelum, saat, dan setelah production release.

---

## 2. Case Study 1 — Adding a Non-Null Column to a Large Table

### 2.1 Problem

Ada tabel `orders` berisi 80 juta row.

Requirement baru:

> Setiap order harus punya `source_channel` dengan nilai seperti `WEB`, `MOBILE`, `AGENT`, atau `API`.

Target akhirnya:

```sql
source_channel varchar(30) not null
```

### 2.2 Naive Solution

```sql
ALTER TABLE orders ADD source_channel varchar(30) NOT NULL DEFAULT 'WEB';
```

Atau:

```sql
ALTER TABLE orders ADD source_channel varchar(30);
UPDATE orders SET source_channel = 'WEB' WHERE source_channel IS NULL;
ALTER TABLE orders MODIFY source_channel varchar(30) NOT NULL;
```

### 2.3 Why Naive Solution Is Dangerous

Risikonya bergantung DBMS, versi DB, ukuran tabel, index, replication, dan traffic.

Potensi masalah:

- `ALTER TABLE` bisa mengambil lock berat.
- `UPDATE` 80 juta row dalam satu transaksi bisa menghasilkan:
  - undo/redo/WAL besar;
  - replication lag;
  - lock contention;
  - long transaction;
  - vacuum/cleanup pressure;
  - rollback cost sangat mahal.
- Aplikasi versi lama tidak mengisi column baru.
- Jika langsung `NOT NULL`, old app bisa gagal insert.
- Jika release aplikasi gagal setelah DB berubah, rollback aplikasi bisa rusak.

### 2.4 Production-Grade Strategy

Gunakan expand/contract.

#### Phase A — Expand Schema

Tambahkan column nullable terlebih dahulu.

```sql
ALTER TABLE orders ADD source_channel varchar(30);
```

Jangan langsung `NOT NULL`.

#### Phase B — Deploy App That Writes New Column

Update Java application agar semua write path mengisi `source_channel`.

Contoh mental model service layer:

```java
public Order createOrder(CreateOrderCommand command) {
    Order order = new Order();
    order.setCustomerId(command.customerId());
    order.setAmount(command.amount());
    order.setSourceChannel(resolveSourceChannel(command));
    return orderRepository.save(order);
}
```

Jangan hanya update endpoint utama. Cari semua write path:

- public API create order;
- admin create order;
- batch import;
- integration consumer;
- test fixture;
- data correction tool;
- retry/replay mechanism;
- legacy job.

#### Phase C — Backfill Existing Rows in Chunks

Jalankan backfill secara chunked.

Contoh PostgreSQL-style pseudo approach:

```sql
UPDATE orders
SET source_channel = 'WEB'
WHERE id >= :from_id
  AND id < :to_id
  AND source_channel IS NULL;
```

Untuk Oracle:

```sql
UPDATE orders
SET source_channel = 'WEB'
WHERE id BETWEEN :from_id AND :to_id
  AND source_channel IS NULL;
```

Commit per chunk.

#### Phase D — Validate

```sql
SELECT COUNT(*) AS missing_source_channel
FROM orders
WHERE source_channel IS NULL;
```

Pastikan result `0`.

#### Phase E — Contract Schema

Setelah old app tidak mungkin running dan data sudah bersih:

```sql
ALTER TABLE orders MODIFY source_channel varchar(30) NOT NULL;
```

PostgreSQL:

```sql
ALTER TABLE orders ALTER COLUMN source_channel SET NOT NULL;
```

### 2.5 Flyway Implementation Sketch

```text
db/migration/
  V2026_02_01_001__orders_add_source_channel_nullable.sql
  V2026_02_05_001__orders_source_channel_not_null.sql
```

Backfill besar sebaiknya tidak selalu dimasukkan sebagai satu Flyway SQL migration. Pilihan lebih aman:

```text
db/migration/
  V2026_02_01_001__orders_add_source_channel_nullable.sql

jobs/
  OrdersSourceChannelBackfillJob.java

ops/
  validation/orders_source_channel_validation.sql

db/migration/
  V2026_02_05_001__orders_source_channel_not_null.sql
```

Kenapa backfill bisa dipisah?

Karena backfill besar membutuhkan:

- progress tracking;
- retry;
- throttling;
- observability;
- pause/resume;
- commit per chunk;
- production monitoring.

Flyway migration seharusnya deterministik dan relatif bounded. Backfill besar sering lebih cocok menjadi controlled operational job.

### 2.6 Liquibase Implementation Sketch

```yaml
databaseChangeLog:
  - changeSet:
      id: 2026-02-01-001-orders-add-source-channel
      author: platform-team
      changes:
        - addColumn:
            tableName: orders
            columns:
              - column:
                  name: source_channel
                  type: varchar(30)
```

Kemudian contract:

```yaml
databaseChangeLog:
  - changeSet:
      id: 2026-02-05-001-orders-source-channel-not-null
      author: platform-team
      preConditions:
        onFail: HALT
        sqlCheck:
          expectedResult: 0
          sql: SELECT COUNT(*) FROM orders WHERE source_channel IS NULL
      changes:
        - addNotNullConstraint:
            tableName: orders
            columnName: source_channel
            columnDataType: varchar(30)
```

### 2.7 Java Application Impact

Entity:

```java
@Column(name = "source_channel")
private String sourceChannel;
```

But do not rely only on ORM validation. Enforce in domain/application layer:

```java
private SourceChannel resolveSourceChannel(CreateOrderCommand command) {
    if (command.sourceChannel() != null) {
        return command.sourceChannel();
    }
    return SourceChannel.WEB;
}
```

For Java 8, use enum + ordinary class.  
For Java 17–25, records/sealed types can make command modelling cleaner, but database migration strategy remains the same.

### 2.8 Rollback / Roll-Forward

Before NOT NULL:

- App rollback is safe if column is nullable.
- New column can remain unused.

After NOT NULL:

- Old app rollback may fail if it does not write `source_channel`.
- Safer rollback is usually app fix/roll-forward, not schema rollback.

### 2.9 Operational Checklist

Before production:

- Estimate row count.
- Test backfill duration on production-like volume.
- Confirm write paths updated.
- Confirm old app compatibility.
- Confirm replication/standby lag monitoring.
- Confirm lock timeout.
- Confirm backfill pause/resume.

After production:

- Count nulls.
- Check insert/update error rate.
- Check DB locks.
- Check latency.
- Check slow query log/AWR/pg_stat_activity/performance schema equivalent.

---

## 3. Case Study 2 — Renaming a Column Without Downtime

### 3.1 Problem

Column `customer_name` harus diubah menjadi `legal_name`.

Existing table:

```sql
customers(id, customer_name, email, created_at)
```

Target:

```sql
customers(id, legal_name, email, created_at)
```

### 3.2 Naive Solution

```sql
ALTER TABLE customers RENAME COLUMN customer_name TO legal_name;
```

### 3.3 Why Naive Solution Is Dangerous

Rename adalah breaking change.

Jika old app masih query `customer_name`, aplikasi langsung gagal:

```text
column customer_name does not exist
```

Masalah muncul pada:

- rolling deployment;
- blue/green deployment;
- canary deployment;
- multiple services reading same table;
- reporting jobs;
- stored procedures;
- views;
- ETL;
- manual operational SQL;
- delayed consumers.

### 3.4 Production-Grade Strategy

Gunakan compatibility column pattern.

#### Phase A — Add New Column

```sql
ALTER TABLE customers ADD legal_name varchar(255);
```

#### Phase B — Dual Write

Aplikasi baru menulis dua column:

```java
customer.setCustomerName(command.name());
customer.setLegalName(command.name());
```

#### Phase C — Backfill

```sql
UPDATE customers
SET legal_name = customer_name
WHERE legal_name IS NULL
  AND customer_name IS NOT NULL;
```

Untuk tabel besar, chunked.

#### Phase D — Read Switch

Aplikasi baru membaca `legal_name`, dengan fallback sementara:

```java
String displayName = customer.getLegalName() != null
        ? customer.getLegalName()
        : customer.getCustomerName();
```

#### Phase E — Stop Reading Old Column

Setelah semua app versi lama hilang:

- read only `legal_name`;
- continue dual write for one release window;
- validate no dependency on old column.

#### Phase F — Contract

Drop old column:

```sql
ALTER TABLE customers DROP COLUMN customer_name;
```

### 3.5 Flyway Migration Layout

```text
V2026_03_01_001__customers_add_legal_name.sql
V2026_03_02_001__customers_backfill_legal_name_small_table.sql
V2026_04_01_001__customers_drop_customer_name.sql
```

If table is large:

```text
V2026_03_01_001__customers_add_legal_name.sql
# backfill external job
V2026_04_01_001__customers_drop_customer_name.sql
```

### 3.6 Liquibase With Preconditions

```yaml
databaseChangeLog:
  - changeSet:
      id: 2026-03-01-001-customers-add-legal-name
      author: customer-team
      preConditions:
        onFail: MARK_RAN
        not:
          columnExists:
            tableName: customers
            columnName: legal_name
      changes:
        - addColumn:
            tableName: customers
            columns:
              - column:
                  name: legal_name
                  type: varchar(255)
```

Contract migration:

```yaml
  - changeSet:
      id: 2026-04-01-001-customers-drop-customer-name
      author: customer-team
      preConditions:
        onFail: HALT
        sqlCheck:
          expectedResult: 0
          sql: SELECT COUNT(*) FROM customers WHERE legal_name IS NULL AND customer_name IS NOT NULL
      changes:
        - dropColumn:
            tableName: customers
            columnName: customer_name
```

### 3.7 Validation Queries

```sql
SELECT COUNT(*)
FROM customers
WHERE legal_name IS NULL
  AND customer_name IS NOT NULL;
```

```sql
SELECT COUNT(*)
FROM customers
WHERE legal_name <> customer_name;
```

Second query must be interpreted carefully if business rules allow divergence.

### 3.8 Key Lesson

A rename is not a rename in production.

A rename is usually:

1. add new;
2. dual write;
3. backfill;
4. switch read;
5. stop dependency;
6. drop old.

---

## 4. Case Study 3 — Splitting `full_name` Into `first_name` and `last_name`

### 4.1 Problem

Existing table:

```sql
users(id, full_name, email)
```

New requirement:

```sql
users(id, first_name, last_name, email)
```

### 4.2 Naive Solution

```sql
ALTER TABLE users ADD first_name varchar(100);
ALTER TABLE users ADD last_name varchar(100);

UPDATE users
SET first_name = split_part(full_name, ' ', 1),
    last_name = split_part(full_name, ' ', 2);
```

### 4.3 Why Naive Solution Is Dangerous

Names are not universally split by space.

Examples:

- `Fajar Abdi Nugraha`
- `Siti Nurhaliza`
- `Jean-Claude Van Damme`
- `Madonna`
- `Tan Sri Dato' ...`
- names with prefixes/suffixes;
- names in scripts without spaces;
- legal names vs display names.

This is not just technical migration. It changes domain semantics.

### 4.4 Better Domain Model Question

Before schema migration, ask:

> Does the business truly need first/last name, or do they need structured legal identity fields for a specific jurisdiction?

Possible better model:

```sql
users(
  id,
  display_name,
  legal_name,
  given_name,
  family_name,
  email
)
```

Even `given_name` / `family_name` may not be universal.

### 4.5 Production Strategy

#### Phase A — Add Nullable Fields

```sql
ALTER TABLE users ADD first_name varchar(100);
ALTER TABLE users ADD last_name varchar(100);
```

#### Phase B — Application Supports Both

New registration captures structured names if available.

Existing users still display `full_name`.

```java
public String displayName(User user) {
    if (user.getFullName() != null && !user.getFullName().isBlank()) {
        return user.getFullName();
    }
    return joinName(user.getFirstName(), user.getLastName());
}
```

For Java 8, replace `isBlank()` with trim-check.

#### Phase C — Conservative Backfill

Use heuristic only if acceptable, and mark confidence.

Better schema:

```sql
ALTER TABLE users ADD name_migration_confidence varchar(30);
```

Example values:

- `EXACT_USER_PROVIDED`
- `HEURISTIC_SINGLE_TOKEN`
- `HEURISTIC_MULTI_TOKEN`
- `MANUAL_REVIEW_REQUIRED`

#### Phase D — Manual Review for Sensitive Context

If legal/regulatory/customer-facing correctness matters, do not pretend string split is truth.

### 4.6 Backfill Example

```sql
UPDATE users
SET first_name = full_name,
    last_name = NULL,
    name_migration_confidence = 'HEURISTIC_SINGLE_TOKEN'
WHERE full_name IS NOT NULL
  AND full_name NOT LIKE '% %';
```

For multi-token names, maybe:

```sql
UPDATE users
SET first_name = SUBSTR(full_name, 1, INSTR(full_name, ' ') - 1),
    last_name = SUBSTR(full_name, INSTR(full_name, ' ') + 1),
    name_migration_confidence = 'HEURISTIC_MULTI_TOKEN'
WHERE full_name IS NOT NULL
  AND full_name LIKE '% %';
```

But this is a business decision, not just SQL.

### 4.7 Key Lesson

Some migrations are **semantic migrations**.

The hardest part is not moving bytes.  
The hardest part is preserving truth.

---

## 5. Case Study 4 — Migrating Status String to Status Table

### 5.1 Problem

Existing table:

```sql
applications(
  id,
  status varchar(50)
)
```

Values include:

```text
DRAFT
SUBMITTED
APPROVED
REJECTED
PENDING_REVIEW
Pending Review
pending-review
```

Requirement:

```sql
application_statuses(
  id,
  code,
  label,
  sort_order,
  active
)

applications.status_id references application_statuses(id)
```

### 5.2 Naive Solution

Create status table, insert statuses, update by exact match, drop string column.

### 5.3 Why Naive Solution Is Dangerous

Real production data often contains dirty values.

Risks:

- unknown status;
- inconsistent casing;
- trailing spaces;
- deprecated statuses;
- values used by reports;
- application code still switches on string;
- external integrations depend on old field;
- audit trail contains old string;
- rollback loses mapping clarity.

### 5.4 Production Strategy

#### Phase A — Create Status Table

```sql
CREATE TABLE application_statuses (
    id bigint PRIMARY KEY,
    code varchar(50) NOT NULL UNIQUE,
    label varchar(100) NOT NULL,
    sort_order int NOT NULL,
    active boolean NOT NULL
);
```

Vendor note:

- Oracle may use `number(1)` or `char(1)` instead of boolean.
- PostgreSQL supports native boolean.
- MySQL boolean is often alias for tinyint.
- SQL Server uses bit.

#### Phase B — Seed Canonical Statuses

```sql
INSERT INTO application_statuses(id, code, label, sort_order, active)
VALUES
  (1, 'DRAFT', 'Draft', 10, true),
  (2, 'SUBMITTED', 'Submitted', 20, true),
  (3, 'PENDING_REVIEW', 'Pending Review', 30, true),
  (4, 'APPROVED', 'Approved', 40, true),
  (5, 'REJECTED', 'Rejected', 50, true);
```

Use deterministic IDs for seed reference data if many migrations or integrations depend on them.

#### Phase C — Add Nullable FK Column

```sql
ALTER TABLE applications ADD status_id bigint;
```

#### Phase D — Build Mapping Table

```sql
CREATE TABLE application_status_migration_map (
    raw_status varchar(100) PRIMARY KEY,
    normalized_code varchar(50) NOT NULL
);
```

Seed known mappings:

```sql
INSERT INTO application_status_migration_map(raw_status, normalized_code)
VALUES
  ('DRAFT', 'DRAFT'),
  ('SUBMITTED', 'SUBMITTED'),
  ('APPROVED', 'APPROVED'),
  ('REJECTED', 'REJECTED'),
  ('PENDING_REVIEW', 'PENDING_REVIEW'),
  ('Pending Review', 'PENDING_REVIEW'),
  ('pending-review', 'PENDING_REVIEW');
```

#### Phase E — Backfill

```sql
UPDATE applications a
SET status_id = s.id
FROM application_status_migration_map m
JOIN application_statuses s ON s.code = m.normalized_code
WHERE a.status = m.raw_status
  AND a.status_id IS NULL;
```

Oracle-style correlated update may differ:

```sql
UPDATE applications a
SET status_id = (
    SELECT s.id
    FROM application_status_migration_map m
    JOIN application_statuses s ON s.code = m.normalized_code
    WHERE m.raw_status = a.status
)
WHERE a.status_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM application_status_migration_map m
    WHERE m.raw_status = a.status
  );
```

#### Phase F — Detect Unknowns

```sql
SELECT status, COUNT(*)
FROM applications
WHERE status_id IS NULL
GROUP BY status
ORDER BY COUNT(*) DESC;
```

Do not contract until this is resolved.

#### Phase G — Application Dual Read/Write

New app writes both:

```java
application.setStatus(StatusCode.SUBMITTED.name());
application.setStatusId(statusCatalog.requireId(StatusCode.SUBMITTED));
```

Then later read from `status_id`.

#### Phase H — Add FK and NOT NULL

Only after all rows mapped:

```sql
ALTER TABLE applications
ADD CONSTRAINT fk_applications_status
FOREIGN KEY (status_id) REFERENCES application_statuses(id);
```

```sql
ALTER TABLE applications ALTER COLUMN status_id SET NOT NULL;
```

#### Phase I — Drop Old Column

After all consumers updated:

```sql
ALTER TABLE applications DROP COLUMN status;
```

### 5.5 Validation Queries

```sql
SELECT COUNT(*) FROM applications WHERE status_id IS NULL;
```

```sql
SELECT a.status, COUNT(*)
FROM applications a
LEFT JOIN application_status_migration_map m ON m.raw_status = a.status
WHERE m.raw_status IS NULL
GROUP BY a.status;
```

```sql
SELECT s.code, COUNT(a.id)
FROM application_statuses s
LEFT JOIN applications a ON a.status_id = s.id
GROUP BY s.code
ORDER BY s.code;
```

### 5.6 Key Lesson

String-to-reference-table migration is not just normalization.

It is:

- data cleansing;
- compatibility management;
- seed governance;
- enum/domain model migration;
- reporting/integration migration.

---

## 6. Case Study 5 — Adding Role/Permission Seed Data Safely

### 6.1 Problem

A new feature needs permission:

```text
CASE_REOPEN
```

Roles:

- `ADMIN` gets `CASE_REOPEN`.
- `SUPERVISOR` gets `CASE_REOPEN`.
- `OFFICER` does not.

Tables:

```sql
roles(id, code, name)
permissions(id, code, name)
role_permissions(role_id, permission_id)
```

### 6.2 Naive Solution

```sql
INSERT INTO permissions(code, name) VALUES ('CASE_REOPEN', 'Case Reopen');

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.code IN ('ADMIN', 'SUPERVISOR')
  AND p.code = 'CASE_REOPEN';
```

### 6.3 Why Naive Solution Is Dangerous

Potential failures:

- permission already exists in one environment;
- role code differs due to drift;
- duplicate role-permission rows;
- generated ID differs across environment;
- migration rerun fails;
- permission assignment accidentally overwrites local UAT testing config;
- production security change has no approval evidence.

### 6.4 Production-Grade Seed Strategy

Reference security seed must be:

- deterministic;
- idempotent;
- auditable;
- reviewable;
- least-surprise;
- backed by approval.

### 6.5 SQL Pattern: Insert If Missing

PostgreSQL:

```sql
INSERT INTO permissions(code, name)
VALUES ('CASE_REOPEN', 'Case Reopen')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name;
```

Oracle MERGE:

```sql
MERGE INTO permissions p
USING (
  SELECT 'CASE_REOPEN' AS code, 'Case Reopen' AS name FROM dual
) src
ON (p.code = src.code)
WHEN MATCHED THEN
  UPDATE SET p.name = src.name
WHEN NOT MATCHED THEN
  INSERT (id, code, name)
  VALUES (permissions_seq.NEXTVAL, src.code, src.name);
```

MySQL:

```sql
INSERT INTO permissions(code, name)
VALUES ('CASE_REOPEN', 'Case Reopen')
ON DUPLICATE KEY UPDATE name = VALUES(name);
```

SQL Server:

Prefer cautious `IF NOT EXISTS` or carefully written `MERGE` depending organizational standard.

### 6.6 Role Mapping Idempotency

```sql
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'CASE_REOPEN'
WHERE r.code IN ('ADMIN', 'SUPERVISOR')
  AND NOT EXISTS (
      SELECT 1
      FROM role_permissions rp
      WHERE rp.role_id = r.id
        AND rp.permission_id = p.id
  );
```

### 6.7 Validation Queries

```sql
SELECT code
FROM permissions
WHERE code = 'CASE_REOPEN';
```

```sql
SELECT r.code, p.code
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code = 'CASE_REOPEN'
ORDER BY r.code;
```

Expected:

```text
ADMIN       CASE_REOPEN
SUPERVISOR  CASE_REOPEN
```

### 6.8 Application Impact

Avoid hardcoding permission IDs.

Bad:

```java
if (user.hasPermissionId(9371L)) { ... }
```

Better:

```java
if (authorizationService.hasPermission(user, PermissionCode.CASE_REOPEN)) {
    // allow
}
```

### 6.9 Rollback

Security seed rollback is sensitive.

Removing permission assignment can break users or incident response flows. Prefer:

- feature flag off;
- permission disabled via `active = false` if model supports it;
- role mapping removal only with approval;
- audit all changes.

### 6.10 Key Lesson

Permission seed is production behavior.

Treat it like code + access control change, not harmless lookup data.

---

## 7. Case Study 6 — Rebuilding Broken Lookup Seed

### 7.1 Problem

`countries` lookup table drifted across environments.

DEV:

```text
ID  CODE  NAME
1   SG    Singapore
2   ID    Indonesia
3   MY    Malaysia
```

UAT:

```text
ID  CODE  NAME
10  SG    Singapore
11  ID    Indonesia
12  MY    Malaysia
```

PROD:

```text
ID  CODE  NAME
1   SG    Singapore
5   ID    Republic of Indonesia
9   MY    Malaysia
```

Foreign keys reference `countries.id`.

### 7.2 Naive Solution

Delete all countries and reinsert deterministic IDs.

```sql
DELETE FROM countries;
INSERT INTO countries(id, code, name) VALUES ...;
```

### 7.3 Why Naive Solution Is Dangerous

- FK violations.
- Existing transactional rows break.
- Historical data loses meaning.
- Deleting lookup records can cascade if constraints are misconfigured.
- Reusing IDs can corrupt references.

### 7.4 Production Strategy

Do not force ID alignment if IDs are already referenced.

Use stable natural key `code` as business identity.

Steps:

1. Add unique constraint on `countries.code` if not exists.
2. Update names by `code`.
3. Insert missing codes.
4. Do not update IDs.
5. Update application to resolve by code, not ID.
6. Create mapping only if external IDs require deterministic mapping.

### 7.5 Safe Seed by Natural Key

PostgreSQL:

```sql
INSERT INTO countries(code, name)
VALUES
  ('SG', 'Singapore'),
  ('ID', 'Indonesia'),
  ('MY', 'Malaysia')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name;
```

Oracle:

```sql
MERGE INTO countries c
USING (
  SELECT 'SG' code, 'Singapore' name FROM dual UNION ALL
  SELECT 'ID' code, 'Indonesia' name FROM dual UNION ALL
  SELECT 'MY' code, 'Malaysia' name FROM dual
) src
ON (c.code = src.code)
WHEN MATCHED THEN
  UPDATE SET c.name = src.name
WHEN NOT MATCHED THEN
  INSERT (id, code, name)
  VALUES (countries_seq.NEXTVAL, src.code, src.name);
```

### 7.6 Validation

```sql
SELECT code, COUNT(*)
FROM countries
GROUP BY code
HAVING COUNT(*) > 1;
```

```sql
SELECT code
FROM countries
WHERE code IN ('SG', 'ID', 'MY');
```

```sql
SELECT COUNT(*)
FROM orders o
LEFT JOIN countries c ON c.id = o.country_id
WHERE o.country_id IS NOT NULL
  AND c.id IS NULL;
```

### 7.7 Application Impact

Bad:

```java
private static final long INDONESIA_ID = 2L;
```

Better:

```java
Country indonesia = countryRepository.findByCode("ID")
        .orElseThrow(() -> new IllegalStateException("Country ID seed missing"));
```

Cache by code if needed.

### 7.8 Key Lesson

For mutable environments, stable business keys are safer than forcing surrogate key identity alignment after the fact.

---

## 8. Case Study 7 — Backfilling Millions of Rows

### 8.1 Problem

Need calculate `risk_score` for 120 million `cases` rows.

```sql
ALTER TABLE cases ADD risk_score number(5,2);
```

Risk score depends on:

- case type;
- amount;
- number of previous violations;
- age of case;
- jurisdiction;
- flags from other tables.

### 8.2 Naive Solution

Flyway Java migration:

```java
while (resultSet.next()) {
    calculateRiskScore(...);
    updateRow(...);
}
```

One transaction.

### 8.3 Why Naive Solution Is Dangerous

- Too long for deployment window.
- Large transaction.
- Memory pressure.
- No resume marker.
- Difficult observability.
- Failure means ambiguous state.
- Deployment blocked by data job.
- May overload DB.

### 8.4 Production Strategy

Treat it as data migration job, not schema migration file.

#### Phase A — Add Nullable Column

```sql
ALTER TABLE cases ADD risk_score number(5,2);
```

#### Phase B — New App Computes Risk for New Writes

New or updated cases get `risk_score` immediately.

#### Phase C — Backfill Job With Checkpoint

Create checkpoint table:

```sql
CREATE TABLE migration_job_checkpoint (
    job_name varchar(100) PRIMARY KEY,
    last_processed_id bigint NOT NULL,
    status varchar(30) NOT NULL,
    updated_at timestamp NOT NULL
);
```

Job logic:

```java
public final class CaseRiskScoreBackfillJob {
    private final CaseRiskScoreRepository repository;
    private final RiskScoreCalculator calculator;
    private final int batchSize;

    public void run() {
        long lastId = repository.loadCheckpoint("case-risk-score-backfill");

        while (true) {
            List<CaseProjection> batch = repository.findBatchAfterId(lastId, batchSize);
            if (batch.isEmpty()) {
                repository.markCompleted("case-risk-score-backfill", lastId);
                return;
            }

            List<RiskScoreUpdate> updates = new ArrayList<>();
            for (CaseProjection item : batch) {
                updates.add(new RiskScoreUpdate(
                        item.id(),
                        calculator.calculate(item)
                ));
                lastId = item.id();
            }

            repository.updateRiskScores(updates);
            repository.saveCheckpoint("case-risk-score-backfill", lastId);
            sleepForThrottle();
        }
    }
}
```

For Java 8, use ordinary DTO classes instead of records.

#### Phase D — Validation

```sql
SELECT COUNT(*) FROM cases WHERE risk_score IS NULL;
```

```sql
SELECT MIN(risk_score), MAX(risk_score), AVG(risk_score)
FROM cases;
```

Sample recomputation query/job for correctness.

#### Phase E — Add Constraint If Required

Only after all rows complete:

```sql
ALTER TABLE cases MODIFY risk_score number(5,2) NOT NULL;
```

### 8.5 Batch Update Pattern

Avoid row-by-row update if possible.

JDBC batch:

```java
try (PreparedStatement ps = connection.prepareStatement(
        "UPDATE cases SET risk_score = ? WHERE id = ? AND risk_score IS NULL")) {

    for (RiskScoreUpdate update : updates) {
        ps.setBigDecimal(1, update.riskScore());
        ps.setLong(2, update.caseId());
        ps.addBatch();
    }

    ps.executeBatch();
}
```

The `AND risk_score IS NULL` guard makes rerun safer.

### 8.6 Operational Controls

Backfill must support:

- dry run count;
- max rows per minute;
- stop flag;
- checkpoint;
- metrics;
- error table;
- retry;
- alerting;
- validation report.

### 8.7 Key Lesson

Large data migration is closer to batch processing than schema migration.

Flyway/Liquibase can create the structure.  
A controlled job should often move the data.

---

## 9. Case Study 8 — Introducing a Unique Constraint Safely

### 9.1 Problem

Need enforce unique email:

```sql
users.email unique
```

But production might contain duplicates.

### 9.2 Naive Solution

```sql
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE(email);
```

### 9.3 Why Naive Solution Is Dangerous

- Migration fails if duplicates exist.
- Adding unique index may lock writes depending DBMS.
- Existing app may create duplicates during deployment.
- Case-sensitivity unclear.
- Null semantics differ by database.
- Email normalization may not exist.

### 9.4 Production Strategy

#### Phase A — Define Semantic Uniqueness

Is uniqueness based on:

- raw email?
- lower-case email?
- trimmed email?
- verified email only?
- tenant + email?
- active users only?

Example decision:

```text
Unique key = lower(trim(email)) among active users within same tenant.
```

#### Phase B — Add Normalized Column

```sql
ALTER TABLE users ADD normalized_email varchar(320);
```

#### Phase C — New App Writes Normalized Email

```java
public String normalizeEmail(String email) {
    if (email == null) return null;
    return email.trim().toLowerCase(Locale.ROOT);
}
```

#### Phase D — Backfill

```sql
UPDATE users
SET normalized_email = lower(trim(email))
WHERE normalized_email IS NULL
  AND email IS NOT NULL;
```

Vendor-specific syntax may vary.

#### Phase E — Detect Duplicates

```sql
SELECT tenant_id, normalized_email, COUNT(*)
FROM users
WHERE active = true
  AND normalized_email IS NOT NULL
GROUP BY tenant_id, normalized_email
HAVING COUNT(*) > 1;
```

Resolve duplicates manually or by business rule.

#### Phase F — Prevent New Duplicates in App

Application-level check is not enough, but useful for user-friendly error.

```java
if (userRepository.existsByTenantIdAndNormalizedEmail(tenantId, normalizedEmail)) {
    throw new DuplicateEmailException(normalizedEmail);
}
```

Still need database constraint to avoid race condition.

#### Phase G — Add Unique Constraint/Index

PostgreSQL partial unique index:

```sql
CREATE UNIQUE INDEX CONCURRENTLY uq_users_active_email
ON users(tenant_id, normalized_email)
WHERE active = true AND normalized_email IS NOT NULL;
```

Note: PostgreSQL `CREATE INDEX CONCURRENTLY` reduces write blocking but does more work and has caveats such as waiting for relevant transactions and not running inside a normal transaction block.

Oracle function-based/conditional uniqueness may require different design, often using function-based indexes or virtual columns depending version and standards.

SQL Server filtered unique index:

```sql
CREATE UNIQUE INDEX uq_users_active_email
ON users(tenant_id, normalized_email)
WHERE active = 1 AND normalized_email IS NOT NULL;
```

MySQL may require generated column or application-specific modelling depending requirement.

### 9.5 Validation

```sql
SELECT COUNT(*)
FROM users
WHERE email IS NOT NULL
  AND normalized_email IS NULL;
```

```sql
SELECT tenant_id, normalized_email, COUNT(*)
FROM users
WHERE active = true
GROUP BY tenant_id, normalized_email
HAVING COUNT(*) > 1;
```

### 9.6 Rollback/Roll-Forward

If constraint creation fails due to duplicate:

- do not repair by deleting data blindly;
- generate duplicate report;
- resolve through business process;
- rerun constraint migration.

If new app fails after unique index:

- rolling back app is usually safe if old app does not intentionally create duplicates;
- if old app can create duplicates and cannot handle DB constraint error, rollback is unsafe.

### 9.7 Key Lesson

A unique constraint is not just a DB object.  
It is a domain rule being enforced at storage level.

---

## 10. Case Study 9 — Changing Primary Key Strategy

### 10.1 Problem

Existing table uses numeric sequence:

```sql
orders(id bigint primary key)
```

New requirement wants UUID primary keys for distributed ID generation.

### 10.2 Naive Solution

```sql
ALTER TABLE orders DROP COLUMN id;
ALTER TABLE orders ADD id uuid PRIMARY KEY;
```

Impossible in real systems.

### 10.3 Why This Is Hard

Primary key is referenced everywhere:

- foreign keys;
- audit tables;
- outbox events;
- logs;
- external integrations;
- URLs;
- caches;
- reports;
- data warehouse;
- support tools;
- message payloads.

Changing PK is not a column migration. It is identity migration.

### 10.4 Safer Strategy — Add Public UUID, Keep Internal PK

Often the best solution is not to replace primary key.

Add a public identifier:

```sql
ALTER TABLE orders ADD public_id uuid;
```

Backfill UUID:

```sql
UPDATE orders
SET public_id = gen_random_uuid()
WHERE public_id IS NULL;
```

PostgreSQL example requires appropriate extension/function availability. Other DBs differ.

Add unique constraint:

```sql
CREATE UNIQUE INDEX uq_orders_public_id ON orders(public_id);
```

New APIs expose `public_id`, internal joins keep numeric `id`.

### 10.5 Java Model

```java
public final class Order {
    private Long id;          // internal persistence identity
    private UUID publicId;    // external stable identifier
}
```

DTO exposes:

```java
public final class OrderResponse {
    private UUID orderId;
}
```

Do not leak DB surrogate key to public clients.

### 10.6 If True PK Migration Is Required

Then use multi-phase plan:

1. Add UUID column to parent.
2. Backfill UUID parent.
3. Add UUID FK columns to children.
4. Backfill child UUID FKs by joining parent.
5. Dual write both old and new references.
6. Add constraints on new UUID references.
7. Switch reads/joins.
8. Update integrations.
9. Drop old FKs.
10. Change PK only after long compatibility window.

This is usually a multi-release program, not one migration.

### 10.7 Key Lesson

Primary key migration is a graph migration.

You are not changing one table.  
You are changing identity relationships across the system.

---

## 11. Case Study 10 — Moving From Single-Tenant to Multi-Tenant

### 11.1 Problem

Existing tables are single-tenant:

```sql
cases(id, case_no, status)
users(id, email, name)
documents(id, case_id, filename)
```

Requirement:

```sql
tenant_id must be included
```

### 11.2 Naive Solution

```sql
ALTER TABLE cases ADD tenant_id bigint NOT NULL;
ALTER TABLE users ADD tenant_id bigint NOT NULL;
ALTER TABLE documents ADD tenant_id bigint NOT NULL;
```

### 11.3 Why Naive Solution Is Dangerous

- Existing data has no tenant_id.
- Old app inserts without tenant_id.
- Unique constraints must change.
- Foreign keys may require tenant consistency.
- Security filtering must be enforced everywhere.
- Reporting and admin tools may leak cross-tenant data.
- Backfill must assign existing rows to default tenant.

### 11.4 Production Strategy

#### Phase A — Create Tenant Table

```sql
CREATE TABLE tenants (
    id bigint PRIMARY KEY,
    code varchar(50) NOT NULL UNIQUE,
    name varchar(255) NOT NULL,
    active boolean NOT NULL
);
```

Seed default tenant:

```sql
INSERT INTO tenants(id, code, name, active)
VALUES (1, 'DEFAULT', 'Default Tenant', true);
```

#### Phase B — Add Nullable `tenant_id`

```sql
ALTER TABLE cases ADD tenant_id bigint;
ALTER TABLE users ADD tenant_id bigint;
ALTER TABLE documents ADD tenant_id bigint;
```

#### Phase C — App Writes Tenant ID

All write paths must require tenant context.

```java
public Case createCase(TenantContext tenant, CreateCaseCommand command) {
    Case c = new Case();
    c.setTenantId(tenant.tenantId());
    c.setCaseNo(command.caseNo());
    return caseRepository.save(c);
}
```

Tenant context must not be accepted blindly from request body. It should come from authentication/session/route boundary depending architecture.

#### Phase D — Backfill Existing Rows

```sql
UPDATE cases SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE users SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE documents SET tenant_id = 1 WHERE tenant_id IS NULL;
```

Large tables: chunked.

#### Phase E — Add FKs

```sql
ALTER TABLE cases
ADD CONSTRAINT fk_cases_tenant
FOREIGN KEY (tenant_id) REFERENCES tenants(id);
```

#### Phase F — Update Unique Constraints

Before:

```sql
UNIQUE(case_no)
UNIQUE(email)
```

After:

```sql
UNIQUE(tenant_id, case_no)
UNIQUE(tenant_id, normalized_email)
```

This must be tested carefully because existing unique constraints may block legitimate same values across tenants.

#### Phase G — Enforce NOT NULL

```sql
ALTER TABLE cases ALTER COLUMN tenant_id SET NOT NULL;
```

Syntax differs by DBMS.

### 11.5 Security Validation

Technical migration is incomplete without data access migration.

Check repository methods:

Bad:

```java
Optional<Case> findById(Long id);
```

Better:

```java
Optional<Case> findByTenantIdAndId(Long tenantId, Long id);
```

Bad query:

```sql
SELECT * FROM cases WHERE id = ?;
```

Better:

```sql
SELECT * FROM cases WHERE tenant_id = ? AND id = ?;
```

### 11.6 Validation Queries

```sql
SELECT COUNT(*) FROM cases WHERE tenant_id IS NULL;
SELECT COUNT(*) FROM users WHERE tenant_id IS NULL;
SELECT COUNT(*) FROM documents WHERE tenant_id IS NULL;
```

```sql
SELECT tenant_id, case_no, COUNT(*)
FROM cases
GROUP BY tenant_id, case_no
HAVING COUNT(*) > 1;
```

### 11.7 Key Lesson

Multi-tenancy migration is not just adding `tenant_id`.

It changes:

- identity;
- uniqueness;
- security boundary;
- query contract;
- indexes;
- support tooling;
- audit model;
- operational access.

---

## 12. Case Study 11 — Repairing Flyway Checksum Mismatch

### 12.1 Problem

Production deployment fails:

```text
Validate failed: Migration checksum mismatch for V2026_01_10_001__create_orders.sql
```

### 12.2 Common Cause

A migration file already applied in production was edited afterward.

Maybe someone:

- fixed typo;
- reformatted SQL;
- changed column size;
- added missing index;
- regenerated migration;
- merged branch conflict incorrectly.

### 12.3 Naive Solution

Run:

```bash
flyway repair
```

### 12.4 Why Naive Solution Is Dangerous

`repair` updates Flyway schema history metadata. It does not magically make the database match the edited file.

If file changed semantically, repair can hide drift.

### 12.5 Production-Grade Response

#### Step 1 — Stop Deployment

Do not continue blindly.

#### Step 2 — Compare Applied DB State vs Edited Migration

Find:

- what was originally applied;
- what file now contains;
- whether difference is comment/format only or semantic.

#### Step 3 — Classify Difference

| Difference Type | Example | Action |
|---|---|---|
| Non-semantic | comment, whitespace if checksum affected | repair may be acceptable with approval |
| Semantic additive | added index, added column | create new migration instead |
| Semantic destructive | changed type, dropped constraint | create corrective migration and review |
| Unknown | cannot prove | do not repair; investigate |

#### Step 4 — Restore Old Migration File If Possible

The best fix:

- revert old migration file to original;
- create a new migration for new change.

```text
V2026_01_10_001__create_orders.sql       # original restored
V2026_01_20_001__orders_add_missing_idx.sql
```

#### Step 5 — Use Repair Only With Evidence

Repair is acceptable when:

- DB state is proven correct;
- file difference is intentional and non-semantic or metadata correction;
- approval recorded;
- deployment notes explain why.

### 12.6 Validation

```sql
SELECT *
FROM flyway_schema_history
WHERE version = '2026.01.10.001';
```

Check object definition manually.

PostgreSQL:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'orders';
```

Oracle:

```sql
SELECT column_name, data_type, nullable
FROM user_tab_columns
WHERE table_name = 'ORDERS';
```

### 12.7 Key Lesson

Checksum mismatch is a governance signal.

Do not silence the alarm before understanding what it is protecting.

---

## 13. Case Study 12 — Recovering From Half-Applied Migration

### 13.1 Problem

Migration failed halfway.

Example:

```sql
CREATE TABLE invoice_batches (...);
ALTER TABLE invoices ADD batch_id bigint;
CREATE INDEX idx_invoices_batch_id ON invoices(batch_id);
ALTER TABLE invoices ADD CONSTRAINT fk_invoices_batch ...;
```

Failure occurred during index creation.

### 13.2 Why State Is Ambiguous

Depending DBMS transactional DDL behavior:

- table may exist;
- column may exist;
- index may not exist;
- Flyway/Liquibase history may mark migration failed;
- some DDL may auto-commit;
- app may be partially compatible.

### 13.3 Naive Solution

Edit the failed migration and rerun.

Dangerous because the history table may already record failure, and old statements may fail due to existing objects.

### 13.4 Production-Grade Recovery

#### Step 1 — Freeze Changes

No more app deploys, no manual random fixes.

#### Step 2 — Inventory Actual DB State

Check every expected object.

```sql
-- tables
SELECT table_name FROM information_schema.tables WHERE table_name = 'invoice_batches';

-- columns
SELECT column_name FROM information_schema.columns WHERE table_name = 'invoices';

-- indexes
-- vendor specific

-- constraints
-- vendor specific
```

#### Step 3 — Check Migration History

Flyway:

```sql
SELECT installed_rank, version, description, type, script, success
FROM flyway_schema_history
ORDER BY installed_rank;
```

Liquibase:

```sql
SELECT id, author, filename, dateexecuted, exectype, md5sum
FROM databasechangelog
ORDER BY dateexecuted;
```

#### Step 4 — Choose Recovery Path

Path A — clean manual completion then repair/changelog sync:

- if all intended DB changes can be completed manually or with corrective script;
- history metadata then repaired carefully.

Path B — manual rollback partial objects then rerun:

- if no data has been written using partial objects;
- safe to drop partial objects;
- rerun original migration.

Path C — create forward fix migration:

- if partial state exists and should be completed forward;
- often best in production.

#### Step 5 — Document

Record:

- failure point;
- actual DB state;
- recovery SQL;
- approver;
- validation result;
- final history state.

### 13.5 Corrective Migration Example

```sql
-- V2026_05_02_001__complete_invoice_batch_migration.sql

CREATE INDEX idx_invoices_batch_id
ON invoices(batch_id);

ALTER TABLE invoices
ADD CONSTRAINT fk_invoices_batch
FOREIGN KEY (batch_id) REFERENCES invoice_batches(id);
```

This assumes table/column already exist and migration history has been reconciled. If not, add preconditions or manual checks.

### 13.6 Key Lesson

Failed migration recovery is not “run repair”.

It is state reconciliation between:

- intended migration;
- actual database;
- migration history;
- application compatibility.

---

## 14. Case Study 13 — Handling Production-Only Drift

### 14.1 Problem

Production has an index that UAT does not:

```sql
idx_cases_created_by_prod_hotfix
```

It was added manually during an incident.

Now a migration wants to create an index with similar columns but different name.

### 14.2 Naive Solution

Ignore it because migration passed in UAT.

### 14.3 Why This Is Dangerous

Production-only drift means environment is no longer reproducible.

Risks:

- duplicate indexes;
- different query plans;
- migration failure due to existing object;
- performance difference;
- audit gap;
- future cleanup uncertainty.

### 14.4 Production-Grade Strategy

#### Step 1 — Identify Drift

Compare schema via:

- schema diff tool;
- DB metadata query;
- Flyway/Liquibase history;
- DBA incident notes.

#### Step 2 — Classify Drift

| Drift Type | Example | Response |
|---|---|---|
| Emergency additive | index added manually | codify into migration or reconcile |
| Emergency destructive | column changed manually | incident-level review |
| Benign physical | storage parameter | decide ownership |
| Unauthorized | unknown DDL | audit/security review |

#### Step 3 — Codify the Drift

Create migration that makes lower environments converge or records production state.

Option A: Create same index in non-prod if it should exist everywhere.

```sql
CREATE INDEX idx_cases_created_by
ON cases(created_by, created_at);
```

Option B: Rename production object to standard name if DB supports and safe.

Option C: Drop duplicate after validating query plan.

#### Step 4 — Prevent Recurrence

- emergency change runbook;
- manual DDL ticket template;
- post-incident migration codification;
- drift detection in CI/CD;
- least privilege.

### 14.5 Key Lesson

Manual production DDL must not remain tribal memory.

It must either become versioned migration or be deliberately retired.

---

## 15. Case Study 14 — Migrating Oracle CLOB-Heavy Audit Table

### 15.1 Problem

Oracle table:

```sql
AUDIT_TRAIL(
  ID number primary key,
  MODULE varchar2(100),
  ACTIVITY varchar2(100),
  META_DATA clob,
  SERIALIZED_CHANGES clob,
  FULL_TEXT clob,
  CREATED_DATE_TIME timestamp
)
```

Need add searchable normalized fields and improve listing performance.

### 15.2 Naive Solution

```sql
ALTER TABLE AUDIT_TRAIL ADD CASE_ID number;
UPDATE AUDIT_TRAIL SET CASE_ID = extract_case_id_from_clob(META_DATA);
CREATE INDEX IDX_AUDIT_CASE_ID ON AUDIT_TRAIL(CASE_ID);
```

### 15.3 Why Naive Solution Is Dangerous

- CLOB extraction is expensive.
- Updating huge table creates undo/redo pressure.
- LOB segment behavior can affect storage differently than normal columns.
- Long-running update may block maintenance windows.
- Function over CLOB may be slow and non-deterministic if parsing is messy.
- Audit table is often write-heavy and compliance-sensitive.

### 15.4 Production Strategy

#### Phase A — Add Nullable Extracted Columns

```sql
ALTER TABLE AUDIT_TRAIL ADD CASE_ID number;
ALTER TABLE AUDIT_TRAIL ADD ENTITY_TYPE varchar2(100);
ALTER TABLE AUDIT_TRAIL ADD ENTITY_ID varchar2(100);
```

#### Phase B — New Writes Populate Extracted Fields

Java audit writer should store structured fields at write time.

```java
public AuditEvent createAuditEvent(AuditCommand command) {
    AuditEvent event = new AuditEvent();
    event.setModule(command.module());
    event.setActivity(command.activity());
    event.setMetaData(command.metaDataJson());
    event.setEntityType(command.entityType());
    event.setEntityId(command.entityId());
    event.setCaseId(command.caseId());
    return event;
}
```

For Java 8, use POJO command; for Java 17+, records can help but are not required.

#### Phase C — Backfill Recent Window First

Instead of backfilling all history immediately:

- last 30 days;
- then last 90 days;
- then older archive if needed.

```sql
UPDATE AUDIT_TRAIL
SET CASE_ID = extract_case_id_from_metadata(META_DATA)
WHERE CASE_ID IS NULL
  AND CREATED_DATE_TIME >= SYSTIMESTAMP - INTERVAL '30' DAY;
```

For large data, chunk by ID/date range.

#### Phase D — Function-Based or Normal Index Carefully

```sql
CREATE INDEX IDX_AUDIT_TRAIL_CASE_ID
ON AUDIT_TRAIL(CASE_ID);
```

Consider composite index based on actual listing query:

```sql
CREATE INDEX IDX_AUDIT_CASE_DATE
ON AUDIT_TRAIL(CASE_ID, CREATED_DATE_TIME DESC);
```

#### Phase E — Validate Extracted Data

Sample compare:

```sql
SELECT ID, CASE_ID, META_DATA
FROM AUDIT_TRAIL
WHERE CASE_ID IS NULL
  AND META_DATA LIKE '%caseId%'
FETCH FIRST 100 ROWS ONLY;
```

### 15.5 Operational Considerations

- Monitor tablespace.
- Monitor undo usage.
- Monitor redo generation.
- Monitor long ops.
- Avoid full table update in business hours.
- Consider archival strategy separately.
- Avoid rewriting CLOB unnecessarily.

### 15.6 Key Lesson

CLOB-heavy migration is often storage + performance + compliance work, not normal DML.

---

## 16. Case Study 15 — Failed Application Release After Successful DB Migration

### 16.1 Problem

DB migration succeeded:

```sql
ALTER TABLE payments ADD payment_provider varchar(30);
```

New application deployment fails due to unrelated startup bug.

Old application is rolled back.

### 16.2 Is This Safe?

It depends.

If column is nullable and old app ignores it, safe.

If migration changed constraints or dropped columns used by old app, rollback fails.

### 16.3 Compatibility Matrix

| Schema | App | Safe? | Notes |
|---|---|---:|---|
| Old schema | Old app | Yes | pre-release state |
| Expanded schema | Old app | Usually yes | if additive nullable only |
| Expanded schema | New app | Yes | target during transition |
| Contracted schema | Old app | Usually no | old app may reference removed objects |

### 16.4 Production-Grade Rule

Database migration before app deploy must be backward compatible with old app.

That means pre-app migration should usually be:

- add nullable column;
- add table not used by old app;
- add index;
- add view;
- add permissive constraint only if old app compatible;
- seed data that does not break old logic.

Avoid before app deployment:

- drop column;
- rename column;
- make column NOT NULL if old app does not write it;
- tighten constraint old app may violate;
- change type incompatibly;
- delete reference data old app uses.

### 16.5 Roll-Forward Model

If app fails after safe expand migration:

1. Roll back app.
2. Leave DB expanded.
3. Fix app bug.
4. Redeploy app.
5. Continue backfill/contract later.

Do not rush to revert DB unless expanded schema itself causes issue.

### 16.6 Key Lesson

The first migration in a release should assume the application deployment may fail.

Backward compatibility is not optional; it is deployment insurance.

---

## 17. Cross-Case Pattern Catalogue

Across all case studies, recurring safe patterns appear.

### 17.1 Additive First

Prefer:

```text
add new object -> use it -> validate -> remove old object
```

Instead of:

```text
mutate existing object destructively
```

### 17.2 Data Before Constraint

Do not add strict constraints before data conforms.

Correct order:

```text
add nullable column
write new values
backfill old rows
validate
add NOT NULL/FK/UNIQUE
```

### 17.3 Code and Schema Compatibility

Always ask:

```text
Can old app run on new schema?
Can new app run on old-ish expanded schema?
Can both versions coexist during rolling deploy?
```

### 17.4 Deterministic Seeds

Seed by stable business key, not random runtime behavior.

### 17.5 Chunk Large Data Changes

Large data changes need:

- batching;
- checkpoint;
- throttling;
- retry;
- monitoring;
- validation.

### 17.6 Do Not Edit Applied Migrations

Create new migrations for new changes.

### 17.7 Rollback Is Often Roll-Forward

Many DB changes cannot be truly rolled back without data loss.

Safer model:

- expand safely;
- roll back app if needed;
- roll forward DB/app with corrective migration.

---

## 18. Production Migration Decision Tree

When receiving any DB change request, walk this tree.

### 18.1 Step 1 — Is It Additive or Breaking?

Additive examples:

- add nullable column;
- add table;
- add index;
- add view;
- insert new reference data.

Breaking examples:

- drop column;
- rename column;
- make nullable column not null;
- change type;
- delete reference data;
- tighten unique constraint;
- change primary key.

If breaking, design expand/contract.

### 18.2 Step 2 — Is Existing Data Affected?

If yes:

- estimate row count;
- classify dirty data;
- create validation query;
- design backfill;
- decide in-migration vs external job.

### 18.3 Step 3 — Can It Run Online?

Check:

- table size;
- lock behavior;
- transaction behavior;
- index creation mode;
- DBMS-specific caveats;
- traffic window;
- replication impact.

### 18.4 Step 4 — Can Old and New App Coexist?

If no, release is not safe for rolling/blue-green/canary.

### 18.5 Step 5 — What Is Recovery Path?

Choose one:

- retry same migration;
- repair metadata;
- revert partial objects;
- corrective forward migration;
- restore backup;
- disable feature flag;
- pause backfill;
- quarantine tenant;
- manual remediation.

### 18.6 Step 6 — How Do We Prove Success?

Every serious migration needs:

- pre-check;
- post-check;
- count query;
- constraint validation;
- app smoke test;
- performance check;
- monitoring window.

---

## 19. Review Checklist for Case-Style Migration Design

Use this checklist in PR review.

### 19.1 Schema Contract

- Is the change additive, destructive, or mixed?
- Can old app still run?
- Can rolling deployment happen safely?
- Are names clear and stable?
- Are constraints introduced only after data conforms?

### 19.2 Data Impact

- How many rows are affected?
- Is data clean?
- Are unknown values handled?
- Is backfill idempotent?
- Is there a validation query?
- Is there a sample correctness check?

### 19.3 Operational Risk

- Could it lock a hot table?
- Could it create huge undo/WAL/redo?
- Could it cause replication lag?
- Is there a timeout setting?
- Is there a pause/resume strategy?
- Is there observability?

### 19.4 Tooling

- Is this suitable for Flyway/Liquibase migration?
- Should data movement be external job?
- Are migrations named correctly?
- Are applied migrations immutable?
- Are preconditions needed?
- Are callbacks/session settings needed?

### 19.5 Rollback/Roll-Forward

- What happens if DB migration succeeds but app deploy fails?
- What happens if migration fails halfway?
- What happens if backfill fails after 40%?
- Can we safely leave expanded schema?
- Is rollback data-lossy?
- Is roll-forward documented?

### 19.6 Security and Compliance

- Does it touch permissions, roles, PII, audit, encryption, retention, or tenant boundary?
- Is approval required?
- Is there audit evidence?
- Are secrets excluded?
- Is least privilege respected?

---

## 20. Common Interview-Level and Staff-Level Discussion Prompts

Use these to test your understanding.

### Prompt 1

You need to add a `NOT NULL` column to a 200M-row table with 24/7 traffic. What is your deployment plan?

Expected answer should include:

- add nullable;
- deploy writer;
- backfill chunked;
- validate;
- add not null;
- monitor locks/replication;
- rollback compatibility.

### Prompt 2

A Flyway checksum mismatch appears in production. What do you do?

Expected answer:

- stop;
- inspect history;
- compare original vs current migration;
- classify semantic/non-semantic;
- restore old migration or create corrective migration;
- use repair only with evidence.

### Prompt 3

You need to rename a column in a blue/green deployment system. What is safe?

Expected answer:

- add new column;
- dual write;
- backfill;
- switch reads;
- wait for old version removal;
- drop old column later.

### Prompt 4

A permission seed migration accidentally grants access to the wrong role in production. How do you recover?

Expected answer:

- assess security impact;
- disable feature or remove mapping with approved hotfix;
- audit affected access;
- create corrective migration;
- do not silently mutate history;
- add validation test for role-permission matrix.

### Prompt 5

A large backfill job is 60% complete and causing DB latency. What should the system have supported?

Expected answer:

- throttling;
- stop flag;
- checkpoint;
- chunking;
- resume;
- metrics;
- query plan review;
- smaller batch;
- maintenance window.

---

## 21. Summary Mental Model

Every migration case can be reduced to four dimensions:

```text
Contract:    What do applications expect from schema/data?
State:       What data already exists and how dirty/large is it?
Operation:   How will change run under production traffic?
Recovery:    What happens when any step fails?
```

A top-tier engineer does not ask only:

```text
What SQL should I write?
```

They ask:

```text
What sequence of safe states moves the system from old truth to new truth?
```

That is the core of production-grade database migration engineering.

---

## 22. References and Further Reading

These references are not required to memorize, but they are useful anchors for production work:

- Flyway documentation — schema history table and audit trail concept: `https://documentation.red-gate.com/fd/flyway-schema-history-table-273973417.html`
- Flyway project overview: `https://github.com/flyway/flyway`
- Liquibase documentation — changeset concept: `https://docs.liquibase.com/secure/user-guide-5-1-1/what-is-a-changeset`
- Liquibase documentation — changeset checksum: `https://docs.liquibase.com/secure/user-guide-5-2/what-is-a-changeset-checksum`
- PostgreSQL documentation — `CREATE INDEX`, including `CONCURRENTLY`: `https://www.postgresql.org/docs/current/sql-createindex.html`
- Oracle documentation — `DBMS_REDEFINITION`: `https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_REDEFINITION.html`

---

## 23. What Comes Next

Part berikutnya adalah capstone:

```text
33-capstone-production-grade-migration-platform.md
```

Di sana kita akan menyatukan seluruh seri menjadi satu **production-grade migration platform design**:

- repository structure;
- naming convention;
- review checklist;
- local workflow;
- CI/CD workflow;
- production runbook;
- seed policy;
- data migration policy;
- security model;
- audit model;
- multi-team governance;
- maturity model.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./31-advanced-patterns-and-anti-patterns.md">⬅️ Part 31 — Advanced Patterns and Anti-Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./33-capstone-production-grade-migration-platform.md">Part 33 — Capstone: Designing a Production-Grade Migration Platform ➡️</a>
</div>
