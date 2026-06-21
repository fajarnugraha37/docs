# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-031.md

# Part 031 — Operations II: Security, Governance, Privacy, Access Control, and Compliance

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **031 / 034**  
> Fokus: mengamankan ClickHouse di produksi: users, roles, grants, settings profiles, quotas, row policies, tenant isolation, secrets, TLS, PII, audit logging, retention, governance, compliance, and Java service defense-in-depth.

---

## 0. Posisi Part Ini Dalam Seri

Part 030 membahas operasi umum:

- deployment;
- configuration;
- monitoring;
- alerting;
- runbooks;
- maintenance;
- upgrade;
- capacity review.

Part ini membahas operasi dari sisi security dan governance.

ClickHouse sering menyimpan data sensitif:

- product events;
- user behavior;
- API logs;
- audit trails;
- case lifecycle;
- regulatory reports;
- financial aggregates;
- PII fields;
- operational telemetry;
- security events;
- exports.

Karena ClickHouse sangat cepat membaca data besar, kesalahan akses bisa berdampak besar:

```text
satu query salah → jutaan rows terekspor
satu BI credential bocor → semua tenant terbaca
satu export tanpa audit → compliance incident
satu raw logs table → PII tersebar
satu cache key salah → tenant leak
```

Security ClickHouse bukan hanya database permission. Ia mencakup:

- network boundary;
- authentication;
- authorization;
- users/roles/grants;
- row-level policy;
- settings profiles and quotas;
- tenant enforcement;
- secrets management;
- encryption;
- audit logging;
- query log governance;
- PII minimization;
- retention/deletion;
- export control;
- Java service validation;
- incident response.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. mendesain security model ClickHouse untuk production analytics;
2. membedakan database-level security dan application-level security;
3. membuat user/role/profile/quotas berdasarkan workload;
4. menerapkan least privilege untuk dashboard, ingestion, export, BI, admin, report jobs;
5. memahami row policies untuk multi-tenant isolation;
6. memahami risiko raw logs/JSON/payload/exports terhadap PII;
7. mendesain data classification, retention, and deletion strategy;
8. menerapkan audit logging dan query traceability;
9. mengamankan Java analytics service dengan tenant scope, whitelist query, and export audit;
10. memahami encryption in transit/at rest and secrets management;
11. membuat compliance-oriented design untuk regulatory/case analytics;
12. membuat runbook security incident: credential leak, wrong grants, tenant leak, bad export, and deletion request.

---

## 2. Mental Model Utama: Defense in Depth

Jangan mengandalkan satu lapisan.

Bad model:

```text
Frontend only hides tenant selector
```

or:

```text
Java service adds WHERE tenant_id = ?
```

or:

```text
ClickHouse row policy only
```

Good model:

```text
network boundary
+ service authentication
+ application tenant authorization
+ query builder validation
+ mandatory tenant filter
+ database user least privilege
+ optional row policies
+ quotas/profiles
+ audit logs
+ export approval
+ retention/deletion governance
```

Jika satu lapisan gagal, lapisan lain masih membatasi dampak.

Security analytics bukan hanya mencegah attacker. Ia juga mencegah:

- bug aplikasi;
- BI misuse;
- operator mistake;
- wrong deployment;
- accidental export;
- cache leak;
- overbroad internal access.

---

## 3. Security Surface Area

### 3.1 Network

- ClickHouse TCP/HTTP ports.
- Inter-node ports.
- Keeper/ZooKeeper ports.
- Object storage endpoints.
- Monitoring endpoints.
- Admin interfaces.
- Load balancer.

### 3.2 Authentication

- username/password;
- certificates;
- external auth/integration if used;
- cloud IAM integration if available;
- secrets in app config.

### 3.3 Authorization

- databases;
- tables;
- columns;
- views;
- row policies;
- dictionaries;
- functions;
- clusters;
- DDL rights;
- system tables;
- file/table functions.

### 3.4 Query Resource Control

- profiles;
- quotas;
- memory limits;
- execution time;
- result size;
- concurrency.

Security includes resource abuse prevention.

### 3.5 Data Lifecycle

- retention;
- deletion;
- masking;
- anonymization;
- backups;
- exports;
- raw payloads;
- caches.

### 3.6 Operational Access

- SSH;
- Kubernetes access;
- cloud console;
- object storage access;
- backup storage;
- logs/metrics systems.

---

## 4. Workload-Based User Model

Do not use one user for everything.

### 4.1 Recommended Users

```text
analytics_dashboard_user
analytics_ingestion_user
analytics_export_user
analytics_report_user
analytics_bi_user
analytics_admin_user
analytics_monitoring_user
analytics_migration_user
```

### 4.2 Dashboard User

Use for Java dashboard APIs.

Permissions:

- SELECT on serving tables/rollups;
- maybe SELECT on limited drilldown tables;
- no raw PII tables unless needed;
- no INSERT;
- no ALTER;
- no DROP;
- no system table except minimal if needed.

Resource profile:

- short timeout;
- limited result rows;
- limited memory;
- readonly.

### 4.3 Ingestion User

Permissions:

- INSERT into raw/refined tables;
- maybe SELECT on ingestion metadata/watermark;
- no SELECT on sensitive full tables unless needed;
- no DROP/ALTER;
- no export.

Resource profile:

- insert-focused;
- controlled concurrency;
- large insert allowed;
- limited query execution.

### 4.4 Export User

Permissions:

- SELECT on export-approved tables/views;
- maybe write export audit table;
- no DDL.

Profile:

- longer execution;
- lower concurrency;
- audited;
- result streaming.

### 4.5 BI User

Permissions:

- SELECT on curated views/rollups;
- no raw tables by default;
- no sensitive columns;
- strict quota;
- readonly.

### 4.6 Report User

Permissions:

- SELECT on validated source rollups/snapshots;
- INSERT into report snapshot tables;
- no arbitrary raw access unless necessary.

### 4.7 Admin User

Highly restricted operational access.

Use:

- MFA/SSO if available;
- audited;
- not embedded in applications;
- break-glass policy.

### 4.8 Monitoring User

Permissions:

- SELECT on `system.*` needed for monitoring;
- no business tables unless needed.

---

## 5. Roles and Grants

### 5.1 Prefer Roles Over Direct Grants

Model:

```text
role_dashboard_reader
role_ingestion_writer
role_export_reader
role_report_writer
role_monitoring
role_admin
```

Assign users to roles.

### 5.2 Example Conceptual Grants

```sql
CREATE ROLE role_dashboard_reader;
GRANT SELECT ON analytics.daily_case_lifecycle_rollup TO role_dashboard_reader;
GRANT SELECT ON analytics.case_current_state_serving TO role_dashboard_reader;
```

```sql
CREATE USER analytics_dashboard_user IDENTIFIED WITH sha256_password BY '...';
GRANT role_dashboard_reader TO analytics_dashboard_user;
```

Exact syntax may vary by version/config, but concept remains.

### 5.3 Avoid Overbroad Grants

Avoid:

```sql
GRANT SELECT ON *.* TO app_user;
```

unless it is a controlled admin-like account.

### 5.4 DDL Permissions

Only migration/admin user should have:

- CREATE;
- ALTER;
- DROP;
- TRUNCATE;
- KILL QUERY maybe;
- SYSTEM commands.

### 5.5 System Tables

System tables can expose:

- query text;
- user names;
- table names;
- error messages;
- maybe sensitive literals.

Grant carefully.

---

## 6. Settings Profiles as Security Control

Profiles are not just performance. They are safety.

### 6.1 Dashboard Profile

Policy:

```text
short max_execution_time
limited memory
limited result rows/bytes
readonly
low max_threads if needed
```

Goal:

```text
dashboard cannot accidentally scan/export huge data
```

### 6.2 BI Profile

Policy:

```text
readonly
memory/read limits
max execution time
quota
lower priority
```

### 6.3 Export Profile

Policy:

```text
longer timeout
bounded concurrency
audit required
possibly lower priority
```

### 6.4 Ingestion Profile

Policy:

```text
insert allowed
query restricted
batch insert friendly
```

### 6.5 Admin Profile

Powerful but audited and not used by apps.

### 6.6 Principle

Resource limits reduce blast radius of compromised or buggy credentials.

---

## 7. Quotas

### 7.1 What Quotas Protect Against

- runaway dashboard loop;
- BI full scans;
- export abuse;
- compromised credential;
- accidental high-frequency query;
- tenant abuse.

### 7.2 Quota Dimensions

Depending ClickHouse version/config, quotas can limit over time windows:

- queries;
- errors;
- result rows/bytes;
- read rows/bytes;
- execution time.

### 7.3 Quota Strategy

Per workload:

```text
dashboard_user:
  many small queries allowed
  strict bytes/result limit

bi_user:
  fewer heavier queries
  strict daily read quota

export_user:
  limited concurrent/daily exports

monitoring_user:
  frequent small system queries
```

### 7.4 Alert on Quota Hits

Quota hits may indicate:

- legitimate growth;
- bad query;
- abuse;
- credential leak;
- product issue.

---

## 8. Multi-Tenant Isolation

### 8.1 Application-Level Tenant Enforcement

Every request must resolve tenant scope:

```text
authenticated user → allowed tenant IDs
```

Then query must include:

```sql
WHERE tenant_id = ?
```

or allowed tenant list.

### 8.2 Database-Level Row Policies

Row policy can enforce:

```text
user can only see tenant_id in allowed set
```

This is defense-in-depth.

### 8.3 Why Both?

If Java bug omits tenant filter, DB row policy can still restrict.

If DB policy misconfigured, Java still restricts.

### 8.4 Tenant-Specific Users

For high-security multi-tenant systems, consider:

- per-tenant DB users;
- per-tenant row policies;
- per-tenant views;
- separate databases/clusters for high-value tenants.

Trade-off: operational complexity.

### 8.5 Tenant Filter in Cache

Cache key must include:

- tenant_id;
- permission scope;
- query parameters;
- data watermark.

No shared cache without scope.

### 8.6 Tenant in Export

Export job must store tenant_id and verify requester scope before download.

---

## 9. Views as Security Boundary

### 9.1 Curated Views

Instead of granting raw table:

```sql
CREATE VIEW analytics.v_case_dashboard AS
SELECT
    tenant_id,
    day,
    jurisdiction,
    severity,
    opened_count,
    closed_count
FROM analytics.daily_case_lifecycle_rollup;
```

Grant dashboard user only view access.

### 9.2 Benefits

- hide columns;
- enforce derived fields;
- reduce PII exposure;
- stable interface;
- easier BI access.

### 9.3 Caveat

Views are not always performance boundary. Underlying query still matters.

### 9.4 Materialized Serving Tables

For stronger performance and security boundary, use physical serving tables with only allowed columns.

---

## 10. Column-Level Sensitivity

### 10.1 Data Classification

Classify columns:

| Class | Examples |
|---|---|
| Public/internal | service, route, status |
| Sensitive business | revenue, risk score |
| PII | name, email, phone, IP |
| Highly sensitive | government ID, health/legal data |
| Secret | tokens, passwords, keys |
| Audit sensitive | actor/action/access records |

### 10.2 Column Strategy

For PII:

- avoid storing if not needed;
- hash/tokenize where possible;
- store in separate table;
- restrict access;
- mask in views;
- shorter retention;
- exclude from exports by default.

### 10.3 Raw Payload Risk

Raw JSON/log payload often accidentally contains:

- emails;
- tokens;
- IP addresses;
- user agents;
- request bodies;
- authorization headers;
- personal messages.

Do not assume raw payload is safe.

### 10.4 PII in Logs

Logging request body into ClickHouse can create compliance and deletion problems.

Apply:

- redaction before ingestion;
- field allowlist;
- payload size limits;
- denylist for secrets;
- sampling.

---

## 11. Secrets Management

### 11.1 Do Not Hardcode Credentials

Avoid:

```yaml
clickhouse.password: admin123
```

in repository.

Use:

- secret manager;
- Kubernetes secrets with proper controls;
- cloud secret manager;
- environment injection;
- rotation policy.

### 11.2 Separate Credentials

Different app components get different credentials:

```text
dashboard service cannot insert
ingestion service cannot export
export worker cannot alter tables
```

### 11.3 Rotation

Credential rotation plan:

1. create new credential;
2. deploy app supporting new credential;
3. revoke old credential;
4. verify no failures.

### 11.4 Break-Glass

Admin credentials:

- stored securely;
- audited;
- temporary if possible;
- not used by services.

---

## 12. Network Security

### 12.1 Expose Minimal Ports

ClickHouse ports should not be public unless intentionally managed.

Restrict:

- HTTP port;
- native port;
- interserver ports;
- Keeper ports;
- metrics endpoints.

### 12.2 Network Zones

Common pattern:

```text
private subnet:
  ClickHouse nodes

application subnet:
  Java services

admin access:
  VPN/bastion/SSO

public:
  no direct ClickHouse
```

### 12.3 TLS

Use TLS for:

- client-to-server;
- inter-node if required;
- object storage;
- external connections.

### 12.4 Firewall Rules

Allow only:

- app → ClickHouse;
- ClickHouse nodes ↔ ClickHouse nodes;
- ClickHouse ↔ Keeper;
- monitoring → ClickHouse metrics/system access;
- admin via controlled path.

---

## 13. Encryption At Rest

### 13.1 Disk Encryption

Use disk/cloud volume encryption.

### 13.2 Object Storage Encryption

If using S3/GCS/Azure Blob:

- server-side encryption;
- KMS keys;
- bucket policies;
- access logs;
- lifecycle policies.

### 13.3 Backups

Backups contain sensitive data too.

Encrypt backups and restrict access.

### 13.4 Local Temp Data

Queries/spills/temp files may contain sensitive data. Ensure underlying disk encryption and access controls.

---

## 14. Audit Logging

### 14.1 What To Audit

- login/auth events if available;
- query execution;
- DDL;
- grants/role changes;
- exports;
- report generation;
- admin actions;
- failed access;
- data deletion/mutation;
- backup/restore actions.

### 14.2 Query Log

`system.query_log` helps audit:

- user;
- query_id;
- query text;
- time;
- duration;
- error.

Caution: query text can contain sensitive literals.

### 14.3 Application Audit

Java service should audit:

- who requested export;
- tenant;
- fields;
- filters;
- row count;
- output URI;
- approval;
- download events.

### 14.4 Admin Audit

Track:

- who changed grants;
- who ran DDL;
- who killed query;
- who dropped partition;
- who changed retention.

### 14.5 Retention of Audit Logs

Audit logs often need longer retention than operational logs.

---

## 15. Export Governance

### 15.1 Why Exports Are High Risk

Export turns query access into portable data.

Risks:

- broad tenant export;
- PII leakage;
- stale permission after file generated;
- download link shared;
- no audit trail;
- object storage misconfigured.

### 15.2 Export Policy

Every export should define:

- allowed users/roles;
- allowed tables/fields;
- max date range;
- max rows/bytes;
- approval if sensitive;
- audit log;
- retention/expiry;
- object storage ACL;
- encryption;
- download tracking.

### 15.3 Export Field Whitelist

Do not allow `SELECT *`.

Define export schema:

```text
case_id
event_time
event_type
jurisdiction
severity
status
```

Exclude:

- raw_payload;
- PII;
- internal notes;
- tokens;
- secret attributes.

### 15.4 Export Manifest

Store:

- export_id;
- requester;
- tenant;
- filters;
- fields;
- row count;
- checksum;
- generated_at;
- expiry;
- file URI.

---

## 16. Data Retention

### 16.1 Retention by Data Class

| Data | Retention Example |
|---|---|
| raw logs | 7-30 days |
| parsed logs | 30-90 days |
| metrics raw | days/weeks |
| metrics rollup | months/years |
| product events | 90 days-years |
| audit events | years |
| case lifecycle events | regulatory requirement |
| report snapshots | legal/business requirement |
| raw payload with PII | shortest possible |

### 16.2 TTL

ClickHouse TTL can remove/move data.

Example:

```sql
TTL event_time + INTERVAL 90 DAY DELETE
```

or move to cold storage.

### 16.3 Partition Drop

For large deletion by time:

```sql
ALTER TABLE logs DROP PARTITION 202606;
```

Often cheaper than row-level delete.

### 16.4 Retention Must Be Documented

Every table:

- owner;
- retention;
- deletion method;
- legal hold policy;
- backup retention;
- downstream derived tables.

---

## 17. Privacy and Deletion Requests

### 17.1 The Challenge

ClickHouse is append-heavy and derived-data-heavy.

A user deletion request may require data removal from:

- raw events;
- refined events;
- current snapshots;
- rollups;
- reports;
- logs;
- backups;
- exports;
- caches;
- object storage archive.

### 17.2 Minimize PII First

Best deletion is data you never stored.

Strategies:

- avoid PII in ClickHouse;
- tokenize/hash user ID;
- store mapping outside ClickHouse;
- keep PII in separate restricted table;
- use pseudonymous IDs;
- strip raw payload.

### 17.3 Deletion Pattern

If deletion required:

1. locate affected tables;
2. delete/anonymize raw rows;
3. rebuild derived tables if needed;
4. invalidate caches;
5. handle exports/backups policy;
6. record deletion audit;
7. verify.

### 17.4 Mutation Cost

`ALTER DELETE` over large table can be expensive.

Design for deletion:

- partition by retention time;
- isolate PII;
- use tokenization;
- avoid embedding PII in raw JSON.

### 17.5 Aggregate Data

Aggregates may not identify user. Legal treatment depends on policy/regulation. Coordinate with legal/compliance.

---

## 18. Governance Metadata

Track table metadata:

```text
database
table
owner
description
data classification
PII columns
retention
source pipeline
downstream tables
query families
access roles
backup policy
deletion procedure
```

### 18.1 Metadata Table Example

```sql
CREATE TABLE governance_table_registry
(
    database_name String,
    table_name String,
    owner_team String,
    data_classification LowCardinality(String),
    contains_pii UInt8,
    retention_days UInt32,
    source_pipeline String,
    documentation_url String,
    updated_at DateTime64(3)
)
ENGINE = MergeTree
ORDER BY (database_name, table_name);
```

This registry can also live outside ClickHouse in catalog/governance tool.

### 18.2 Why Useful

During incident/deletion/compliance audit, you need to know:

- what data exists;
- who owns it;
- how long it is retained;
- who can access it.

---

## 19. Java Service Security Patterns

### 19.1 Tenant Scope Enforcement

```java
TenantScope scope = authz.resolveScope(user);
if (!scope.allows(request.tenantId())) {
    throw new ForbiddenException();
}
```

### 19.2 Query Family Whitelist

No arbitrary SQL.

### 19.3 Field Whitelist

Only allowed dimensions/metrics/export fields.

### 19.4 Sensitive Field Masking

If user lacks permission:

```text
email_hash only
no raw email
```

### 19.5 Export Approval

For sensitive exports:

```text
request → approval → job → audit → expiring download
```

### 19.6 Query ID

Include user/request context without exposing secrets:

```text
analytics/CASE_EXPORT/tenant-10/export-uuid
```

### 19.7 Do Not Log Secrets

Avoid logging:

- passwords;
- tokens;
- raw SQL with sensitive literals;
- raw payload;
- export links.

### 19.8 Cache Security

Cache key includes:

- tenant;
- user role/scope;
- field set;
- query params;
- watermark.

---

## 20. System Tables and Sensitive Data

### 20.1 Query Text

`system.query_log` may contain literals:

```sql
WHERE email = 'person@example.com'
```

This means query logs can contain PII.

### 20.2 Mitigation

- parameterize queries if possible;
- avoid PII literal filters;
- restrict query_log access;
- redact app logs;
- consider query normalization in app logs;
- set retention for query logs.

### 20.3 System Tables Access

BI/dashboard users should not broadly access system tables.

Monitoring user gets only what it needs.

---

## 21. Object Storage Governance

If ClickHouse uses object storage or exports to S3-like storage:

### 21.1 Bucket Policy

- least privilege;
- separate buckets/prefixes by environment;
- deny public access;
- encryption;
- lifecycle;
- object lock if needed;
- audit access logs.

### 21.2 Export Files

- expiring URLs;
- private ACL;
- per-tenant prefix;
- checksum;
- delete after retention;
- download audit.

### 21.3 Raw Archive

If raw event archive contains PII:

- restrict access;
- document retention;
- support deletion if required;
- encrypt;
- avoid sharing with broad analytics users.

---

## 22. Compliance-Oriented Case Analytics

For regulatory/case lifecycle analytics:

### 22.1 Requirements

- auditability;
- reproducibility;
- least privilege;
- long retention;
- official reports versioned;
- export controlled;
- PII protected;
- access logged;
- deletion/legal hold policy.

### 22.2 Design

Tables:

```text
case_lifecycle_events
case_current_state
daily_case_rollup
daily_case_backlog_snapshot
official_case_report_snapshots
audit_events
export_audit
governance_table_registry
```

### 22.3 Access

Dashboard:

```text
rollups/current state only
```

Investigators:

```text
case drilldown for authorized cases
```

Report generator:

```text
validated snapshots/rollups
```

Admins:

```text
audited break-glass
```

### 22.4 Official Report

Report snapshot stores:

- report period;
- version;
- generated_at;
- source watermark;
- checksum;
- generated_by;
- amendment reason.

### 22.5 Export

Every export:

- approved if sensitive;
- audited;
- scoped to tenant/cases;
- field-whitelisted;
- expires.

---

## 23. Security Runbook: Credential Leak

### 23.1 Immediate Actions

1. Identify leaked user.
2. Revoke/disable credential.
3. Rotate secret.
4. Check query log for activity.
5. Check export/object storage access.
6. Assess data exposure.
7. Reissue credential to app securely.
8. Document incident.

### 23.2 Query Log Investigation

```sql
SELECT
    event_time,
    user,
    query_id,
    query_duration_ms,
    read_rows,
    formatReadableSize(read_bytes) AS read_bytes,
    result_rows,
    query
FROM system.query_log
WHERE user = 'leaked_user'
  AND event_time >= now() - INTERVAL 7 DAY
ORDER BY event_time DESC;
```

### 23.3 Long-Term Fix

- shorter credential lifetime;
- secret manager;
- network restrictions;
- least privilege;
- anomaly alerting;
- rotation automation.

---

## 24. Security Runbook: Tenant Data Leak

### 24.1 Immediate Actions

1. Stop affected endpoint/export.
2. Identify scope.
3. Preserve logs.
4. Invalidate caches.
5. Revoke download links.
6. Notify incident process.
7. Patch tenant filter/cache key/row policy.
8. Audit query logs and export logs.

### 24.2 Common Causes

- missing `tenant_id` filter;
- cache key missing tenant;
- row policy absent/misconfigured;
- export job uses wrong tenant scope;
- BI view exposes all tenants;
- app authz bug.

### 24.3 Prevention

- mandatory tenant validation;
- SQL tests assert tenant predicate;
- DB row policies;
- cache scope;
- export audit;
- integration tests across tenants.

---

## 25. Security Runbook: Bad Export

### 25.1 Scenario

A user exported too many rows or sensitive columns.

Immediate:

1. Disable download link.
2. Delete object if policy allows.
3. Check access/download logs.
4. Identify requester and approval trail.
5. Assess data classification.
6. Patch export field/range policy.
7. Notify compliance/security if required.

### 25.2 Prevention

- export field whitelist;
- approval workflow;
- max rows/date range;
- PII masking;
- expiring links;
- audit logs;
- object storage access logs.

---

## 26. Security Runbook: Deletion Request

### 26.1 Steps

1. Identify subject/user/entity.
2. Lookup mapping to analytics IDs.
3. Identify affected tables.
4. Determine legal basis/retention exception.
5. Delete/anonymize raw where required.
6. Rebuild derived tables if needed.
7. Invalidate caches/exports.
8. Handle backups by policy.
9. Record deletion audit.
10. Verify.

### 26.2 Avoid

- ad-hoc mutation without table impact analysis;
- forgetting rollups/snapshots;
- ignoring object storage archive;
- deleting official reports without legal guidance.

---

## 27. Security Runbook: Wrong Grant

### 27.1 Symptoms

- user sees table they should not;
- BI can access raw table;
- app can run DDL;
- monitoring user can read business data.

### 27.2 Diagnose

```sql
SHOW GRANTS FOR user_name;
```

Check roles and inherited grants.

### 27.3 Immediate

- revoke excessive grants;
- rotate if credential exposed;
- audit query_log;
- patch IaC/config;
- add test/check.

### 27.4 Long-Term

- role review;
- automated grant diff;
- least privilege;
- periodic access recertification.

---

## 28. Access Review

### 28.1 Periodic Review

Every quarter/month depending sensitivity:

- list users;
- list roles;
- list grants;
- compare to expected;
- disable unused users;
- rotate credentials;
- review export permissions;
- review admin access.

### 28.2 Queries

Depending version:

```sql
SHOW USERS;
SHOW ROLES;
SHOW GRANTS;
```

or inspect access-related system tables if available.

### 28.3 Ownership

Security/platform owns review process, but data owners validate business access.

---

## 29. Governance Tests in CI/CD

### 29.1 SQL Migration Checks

Check:

- new table has owner metadata;
- retention defined;
- PII classification declared;
- grants included;
- no broad grants to app user;
- no raw PII in dashboard view.

### 29.2 Query Builder Tests

Ensure:

- tenant predicate always present;
- export fields whitelisted;
- high-cardinality dimension rejected;
- sensitive metric permission checked;
- cache key includes tenant.

### 29.3 Schema Review

Review new columns:

- data classification;
- retention;
- masking;
- access roles;
- deletion impact.

---

## 30. Common Anti-Patterns

### 30.1 One Admin User for All Apps

Blast radius huge.

### 30.2 Public ClickHouse Endpoint

Dangerous unless intentionally protected by strong auth/network policy.

### 30.3 BI Access to Raw Tables

Often leaks PII and causes heavy queries.

### 30.4 Raw Payload Everywhere

Compliance nightmare.

### 30.5 Export Without Audit

No accountability.

### 30.6 Cache Missing Tenant Scope

Tenant data leak.

### 30.7 Query Log Exposed Broadly

Can reveal sensitive literals.

### 30.8 No Retention Policy

Data accumulates forever.

### 30.9 Deletion Implemented Only on Raw Table

Derived tables/backups/exports forgotten.

### 30.10 Relying Only on App Authorization

Database layer should also limit blast radius.

---

## 31. Production Checklist

### Authentication and Network

- [ ] ClickHouse not publicly exposed unnecessarily.
- [ ] TLS configured where required.
- [ ] Credentials stored in secret manager.
- [ ] Credentials rotated.
- [ ] Separate users per workload.
- [ ] Admin access controlled.

### Authorization

- [ ] Roles defined.
- [ ] Grants least privilege.
- [ ] App users cannot DDL.
- [ ] BI users see curated views only.
- [ ] Monitoring user limited.
- [ ] System table access restricted.

### Tenant Security

- [ ] Tenant scope enforced in app.
- [ ] Tenant predicate mandatory.
- [ ] Row policies considered/implemented.
- [ ] Cache key includes tenant/scope.
- [ ] Export verifies tenant access.

### Resource Safety

- [ ] Profiles per workload.
- [ ] Quotas configured.
- [ ] Result/time/memory limits.
- [ ] Export concurrency limited.
- [ ] BI workload isolated.

### Privacy

- [ ] Data classification exists.
- [ ] PII columns identified.
- [ ] Raw payload reviewed.
- [ ] PII minimized/tokenized.
- [ ] Retention defined.
- [ ] Deletion process documented.
- [ ] Backup/export policy included.

### Audit

- [ ] Query logs retained securely.
- [ ] Export audit exists.
- [ ] Admin actions audited.
- [ ] Grant changes reviewed.
- [ ] Report generation audited.
- [ ] Access review scheduled.

### Java Service

- [ ] No raw SQL endpoint.
- [ ] Whitelist dimensions/metrics/fields.
- [ ] Sensitive fields permission-checked.
- [ ] Query_id propagated.
- [ ] No sensitive logs.
- [ ] Export approval/manifest.
- [ ] Integration tests for tenant isolation.

---

## 32. Exercises

### Exercise 1: One User for Everything

A Spring Boot service uses `default` ClickHouse user with SELECT/INSERT/ALTER/DROP.

What are the risks?

Expected:

```text
Credential leak or bug can read/export/drop/alter all data. Use least-privilege workload-specific users.
```

### Exercise 2: Cache Leak

Dashboard cache key is:

```text
queryFamily + params
```

What is missing?

Expected:

```text
tenant_id and permission scope, plus freshness/version where relevant.
```

### Exercise 3: BI Raw Access

BI user can query raw logs table containing request bodies.

What should you do?

Expected:

```text
Restrict raw table, create curated masked view/serving table, limit query resources, review PII retention.
```

### Exercise 4: Deletion Request

User asks deletion. Their email appears in raw events, logs, exports, and backups.

What is needed?

Expected:

```text
data map, deletion/anonymization plan across raw/refined/derived/cache/export/backup policy, audit record, verification.
```

### Exercise 5: Export Audit

What metadata should export audit include?

Expected:

```text
export_id, requester, tenant, fields, filters, time range, row count, checksum, output URI, generated_at, expiry, approval.
```

---

## 33. Summary

Security and governance in ClickHouse require layered control.

Core principles:

1. Use defense-in-depth: app + database + network + audit.
2. Separate users by workload.
3. Grant least privilege through roles.
4. Use profiles and quotas to limit blast radius.
5. Enforce tenant scope in app and consider row policies.
6. Avoid exposing raw tables to BI/dashboard users.
7. Treat raw payload/logs as sensitive until proven otherwise.
8. Audit exports and admin actions.
9. Define retention and deletion procedures per table.
10. Protect query logs because they may contain sensitive literals.
11. Use curated views/serving tables as safer interfaces.
12. Test tenant isolation and security rules in CI/CD.

Practical sentence:

> ClickHouse can scan your entire business history in seconds; security decides who is allowed to do that, under what limits, and with what audit trail.

---

## 34. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi sesuai versi dan deployment:

1. ClickHouse Docs — Access control.
2. ClickHouse Docs — Users and roles.
3. ClickHouse Docs — GRANT statement.
4. ClickHouse Docs — Row policy.
5. ClickHouse Docs — Settings profiles.
6. ClickHouse Docs — Quotas.
7. ClickHouse Docs — SQL security.
8. ClickHouse Docs — Network and TLS configuration.
9. ClickHouse Docs — Server configuration.
10. ClickHouse Docs — system.query_log.
11. ClickHouse Docs — Data skipping and projections for serving restricted views.
12. ClickHouse Docs — TTL and data retention.
13. ClickHouse Docs — Backups.
14. ClickHouse Docs — Cloud security docs if using ClickHouse Cloud.
15. OWASP — Logging, secrets, and access control guidance.
16. Internal legal/compliance requirements for privacy, retention, and deletion.

---

## 35. Status Seri

Part ini adalah:

```text
Part 031 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 032 — Operations III: Backup, Restore, Disaster Recovery, Migration, and Upgrade Playbooks
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Operations I: Deployment, Configuration, Monitoring, Alerting, and Day-2 Runbooks</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-032.md">Part 032 — Operations III: Backup, Restore, Disaster Recovery, Migration, and Upgrade Playbooks ➡️</a>
</div>
