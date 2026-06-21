# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-025.md

# Part 025 — Security, Access, and Multi-Tenant Boundaries

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin mendesain QuestDB untuk production, enterprise, dan regulated environments.  
> Fokus part ini: security model, access boundary, network surface, authentication, authorization, multi-tenancy, data exfiltration control, dan operational security untuk QuestDB.

---

## 1. Tujuan Part Ini

Setelah part ini, kamu harus bisa:

1. Membaca QuestDB sebagai **database dengan beberapa permukaan akses**, bukan hanya satu service port.
2. Membedakan security concern untuk:
   - ingestion plane,
   - query plane,
   - admin plane,
   - observability plane,
   - backup/replication/object-storage plane.
3. Mendesain network boundary untuk PGWire, HTTP/Web Console, ILP, dan health/metrics endpoint.
4. Memahami perbedaan capability QuestDB Open Source dan Enterprise dari sisi security.
5. Mendesain tenant isolation secara realistis.
6. Mencegah SQL-based data exfiltration melalui query range luas, unrestricted dashboard, dan overprivileged service account.
7. Membangun production checklist untuk secure QuestDB deployment.

Security untuk time-series database bukan hanya soal “pakai password”. Problem intinya adalah:

```text
Time-series systems often contain dense behavioral, operational, industrial, financial, or observability data.

Even if each row looks harmless,
large-range temporal access can reconstruct sensitive behavior.
```

Contoh:

- telemetry mesin bisa menunjukkan kapasitas produksi,
- trading ticks bisa menunjukkan strategi market participant,
- observability metric bisa menunjukkan traffic bisnis,
- device signal bisa menunjukkan lokasi/aktivitas pengguna,
- compliance event bisa menunjukkan status enforcement/internal investigation.

Karena itu, security QuestDB harus dilihat sebagai **control over temporal visibility**, bukan hanya control over table access.

---

## 2. Problem yang Diselesaikan

Di banyak deployment awal, QuestDB diperlakukan sebagai service internal sederhana:

```text
app -> QuestDB
Grafana -> QuestDB
admin -> Web Console
producer -> ILP endpoint
```

Lalu masalah muncul:

1. Semua client memakai credential yang sama.
2. Web Console terbuka terlalu luas.
3. PGWire bisa query semua table.
4. Producer ingestion punya privilege terlalu besar.
5. Grafana datasource memakai admin credential.
6. Query tanpa time bound bisa membaca data bertahun-tahun.
7. Multi-tenant dipisahkan hanya dengan `tenant_id` column tanpa enforcement kuat.
8. Backup/object storage bucket berisi data historis tanpa policy akses yang benar.
9. Metrics endpoint terbuka dan membocorkan table/throughput/operational posture.
10. Token/credential masuk ke config map, log, atau crash dump.

Part ini menyelesaikan problem tersebut dengan membangun model:

```text
security = identity
         + authentication
         + authorization
         + network boundary
         + query boundary
         + tenant boundary
         + secret handling
         + auditability
         + operational recovery
```

---

## 3. Mental Model Utama

### 3.1 QuestDB Has Multiple Planes

Jangan melihat QuestDB sebagai satu endpoint. Lihat sebagai beberapa plane.

```text
                    +---------------------+
                    |      QuestDB        |
                    +---------------------+

 ingestion plane      ILP/HTTP, ILP/TCP, REST import, PGWire INSERT
 query plane          PGWire SQL, REST SQL, Web Console SQL
 admin plane          Web Console, config, SQL admin ops, table ops
 observability plane  metrics endpoint, logs, internal tables/functions
 lifecycle plane      backup, restore, replication, object storage, cold storage
```

Setiap plane punya:

- pengguna berbeda,
- blast radius berbeda,
- network exposure berbeda,
- credential berbeda,
- audit requirement berbeda,
- failure mode berbeda.

Production mistake paling umum adalah mencampur semuanya:

```text
one host
one credential
one network zone
one database user
all services can query all tables
```

Itu bukan security model. Itu hanya convenience model.

---

### 3.2 Time-Series Access Is Dangerous Because Range Is Power

Dalam OLTP, akses ke satu customer row sudah sensitif.

Dalam TSDB, akses ke rentang waktu panjang bisa jauh lebih sensitif.

```sql
SELECT *
FROM device_metrics
WHERE tenant_id = 'acme'
  AND timestamp >= dateadd('d', -365, now());
```

Query itu mungkin tidak terlihat istimewa, tapi secara praktis dapat mengeksfiltrasi satu tahun aktivitas tenant.

Security boundary TSDB harus mengontrol:

1. table,
2. column,
3. tenant/domain,
4. time range,
5. query shape,
6. aggregation level,
7. freshness level,
8. export volume.

RBAC table-level saja sering belum cukup untuk multi-tenant SaaS.

---

### 3.3 Ingestion Privilege Is Not the Same as Query Privilege

Producer biasanya hanya perlu menulis.

```text
producer should write observations
producer should not read all historical observations
producer should not run arbitrary SQL
producer should not alter schemas freely
producer should not access admin console
```

Query service biasanya hanya perlu membaca subset data.

```text
query service should read authorized tenant/window
query service should not ingest arbitrary rows
query service should not alter table lifecycle
query service should not run admin operations
```

Dashboard user biasanya perlu membaca aggregate atau view.

```text
analyst should read summary/rollup/view
analyst should not read raw sensitive columns by default
```

Admin perlu operasi lebih luas, tetapi admin path harus lebih sempit secara network dan identity.

---

## 4. QuestDB Security Surfaces

### 4.1 PGWire

PGWire adalah interface PostgreSQL-compatible untuk query. Ini biasanya jalur utama dari:

- Java query service via JDBC,
- Grafana PostgreSQL datasource,
- analyst SQL tools,
- batch jobs,
- admin scripts.

Karena PGWire dapat menjalankan SQL, exposure-nya harus sangat hati-hati.

Risk:

```text
PGWire exposed too broadly = arbitrary SQL access surface
```

Pertanyaan review:

1. Siapa yang boleh connect ke PGWire?
2. Apakah datasource dashboard memakai read-only credential?
3. Apakah credential per service berbeda?
4. Apakah query dibatasi di application layer?
5. Apakah PGWire dapat diakses dari internet/VPN luas?
6. Apakah TLS aktif untuk traffic lintas host/zone?
7. Apakah query timeout/concurrency guardrail ada?

Dalam QuestDB, PGWire direkomendasikan untuk querying dan mendukung standard PostgreSQL client libraries. Untuk ingestion throughput tinggi, QuestDB mengarahkan penggunaan first-party clients/ILP, bukan menjadikan PGWire sebagai primary ingest path.

---

### 4.2 HTTP / REST / Web Console

HTTP surface bisa mencakup:

- Web Console,
- REST SQL endpoint,
- CSV import/export,
- health/operational endpoints depending on configuration,
- ILP over HTTP jika digunakan.

Risk:

```text
HTTP is often accidentally exposed because it is convenient for browsers and curl.
```

Web Console sangat berguna untuk developer/admin, tetapi berbahaya jika terlalu luas.

Anti-pattern:

```text
Expose Web Console behind public load balancer
Use default credentials
Allow analysts to run arbitrary raw SQL from console
Share admin login in team password manager
```

Safer pattern:

```text
Web Console only accessible via admin network / bastion / VPN / private endpoint
Separate admin identity
TLS enabled
Audit/process around administrative queries
No shared admin credential
```

---

### 4.3 ILP / Ingestion Endpoint

ILP adalah jalur ingestion utama untuk high-throughput data.

Risk khusus ingestion:

1. producer jahat/buruk membuat table/column baru,
2. producer mengirim cardinality eksplosif,
3. producer mengirim timestamp salah,
4. producer menulis tenant lain,
5. producer mengirim duplicate storm,
6. producer mengisi disk dengan data garbage,
7. producer schema drift membuat query downstream rusak.

Security ingestion bukan hanya “apakah boleh connect”. Security ingestion juga harus menjawab:

```text
what is this producer allowed to write?
which tables?
which columns?
which tenant?
which timestamp range?
which symbol values?
which rate?
```

Kalau database tidak menegakkan semua constraint itu secara native dalam edisi yang dipakai, enforcement harus ditempatkan di ingestion gateway / application layer.

---

### 4.4 Minimal HTTP / Metrics / Health Endpoint

Observability endpoint sering dianggap harmless.

Padahal metrics dapat membocorkan:

- table count,
- ingestion rate,
- WAL lag,
- disk pressure,
- workload pattern,
- service health,
- operational weakness.

Security posture:

```text
metrics endpoint should be accessible to monitoring system,
not to arbitrary internal clients.
```

Untuk regulated system, operational metadata pun bisa menjadi sensitive.

---

### 4.5 Backup, Replication, and Object Storage

Backup/cold storage/replication sering lebih berbahaya dari database live.

Kenapa?

```text
live database may have auth, network ACL, query limits
backup files may be copied wholesale
object store may contain years of raw partitions
```

Risiko:

1. bucket policy terlalu luas,
2. backup tidak terenkripsi,
3. service account object storage shared,
4. lifecycle policy menghapus data yang masih punya legal hold,
5. restore environment kurang aman,
6. test restore membuka data produksi ke dev environment,
7. snapshot volume bisa diattach ke host lain.

Rule:

```text
Backup security must be at least as strict as production database security.
```

---

## 5. Open Source vs Enterprise Security Model

QuestDB Open Source dan QuestDB Enterprise punya security capability berbeda.

### 5.1 Practical View

Secara praktis:

```text
QuestDB OSS:
  suitable for trusted-network deployments,
  simple auth/config patterns,
  external network boundary becomes very important.

QuestDB Enterprise:
  adds stronger enterprise controls such as RBAC, TLS on supported interfaces, SSO/OIDC, service accounts, HA/replication/security-related operational features.
```

Jangan men-design regulated multi-tenant environment hanya dengan asumsi “nanti pakai satu credential dan tenant_id di WHERE”.

Jika butuh strong authorization boundary di database layer, validasi kemampuan edisi yang digunakan.

---

### 5.2 RBAC Mental Model

RBAC bukan sekadar “punya user”. RBAC berguna jika kamu bisa memetakan role ke tugas produksi.

Contoh role konseptual:

```text
admin_role:
  manage users, config, tables, lifecycle

ingest_role:
  write selected raw tables
  no arbitrary read

query_api_role:
  read selected raw/serving tables
  no DDL
  no write

grafana_role:
  read selected materialized views / rollups
  no raw sensitive table by default

analyst_role:
  read curated views
  no unrestricted raw access

backup_role:
  object-storage backup operations
  no interactive SQL
```

Yang penting bukan namanya, tetapi privilege minimum.

---

### 5.3 Views as Security Boundary

View dapat dipakai sebagai boundary kurasi:

```sql
CREATE VIEW tenant_hourly_summary AS (
    SELECT
        ts,
        tenant_id,
        metric_name,
        avg(value) AS avg_value,
        max(value) AS max_value
    FROM raw_metrics
    SAMPLE BY 1h
);
```

Tujuan:

- menyembunyikan raw columns,
- mengurangi data volume,
- memberi aggregate-only access,
- mengontrol query shape,
- memisahkan raw table dari analyst-facing interface.

Tetapi view bukan pengganti tenant authorization di application layer jika semua tenant masih muncul di view yang sama.

Untuk multi-tenant SaaS, lebih aman jika query API tetap melakukan tenant scoping secara eksplisit dan tidak membiarkan user mengirim raw SQL arbitrary.

---

## 6. Network Security Design

### 6.1 Default Mindset

Gunakan prinsip:

```text
No QuestDB port should be public by default.
```

Minimal zoning:

```text
+----------------------+      +-------------------+
| Producer subnet      | ---> | ILP endpoint       |
+----------------------+      +-------------------+

+----------------------+      +-------------------+
| Query API subnet     | ---> | PGWire endpoint    |
+----------------------+      +-------------------+

+----------------------+      +-------------------+
| Admin/bastion/VPN    | ---> | Web Console/HTTP   |
+----------------------+      +-------------------+

+----------------------+      +-------------------+
| Monitoring subnet    | ---> | Metrics endpoint   |
+----------------------+      +-------------------+

+----------------------+      +-------------------+
| Backup/replication   | ---> | Object storage     |
+----------------------+      +-------------------+
```

Jangan jadikan satu load balancer publik untuk semua plane.

---

### 6.2 Port Exposure Review

Buat matrix seperti ini:

| Surface | Typical Use | Exposure | Credential | Notes |
|---|---:|---:|---:|---|
| PGWire | SQL query/JDBC/Grafana | private app/query subnet | per-service | jangan public |
| HTTP/Web Console | admin/query/import | admin network only | admin/OIDC/RBAC | high-risk surface |
| ILP HTTP/TCP | ingestion | producer subnet only | producer/service token where available | rate-limit/gateway |
| Metrics/health | monitoring | monitoring subnet only | internal | jangan expose public |
| Object storage | backup/replication/cold | restricted service account | cloud IAM | encrypt + audit |

---

### 6.3 TLS

TLS penting bila traffic melewati:

- host berbeda,
- subnet berbeda,
- cloud VPC shared,
- Kubernetes node network,
- service mesh boundary,
- VPN/network yang tidak sepenuhnya trusted.

TLS melindungi credential dan data in transit.

Tanpa TLS, credential basic/password dapat bocor pada network path yang salah.

Production rule:

```text
If the traffic leaves localhost, assume TLS is required unless there is a documented compensating control.
```

Untuk internal-only environment pun, TLS tetap bernilai karena insider threat, packet capture, misconfigured network mirror, dan shared infrastructure.

---

## 7. Authentication and Secret Handling

### 7.1 Credential Per Service

Jangan pakai satu credential untuk semua client.

Bad:

```text
admin/quest used by:
  ingestion service
  grafana
  batch job
  support laptop
  migration script
```

Better:

```text
ingest_device_gateway_prod
query_api_prod
grafana_readonly_prod
backfill_runner_prod
admin_named_user
backup_service_account
```

Keuntungan:

- bisa rotate satu credential tanpa menghentikan semua service,
- audit lebih jelas,
- blast radius lebih kecil,
- privilege bisa dibuat minimum,
- incident response lebih cepat.

---

### 7.2 Secret Storage

Secret tidak boleh berada di:

```text
Git repository
Docker image
plain ConfigMap
application logs
exception stack trace
JVM system properties dumped to logs
Grafana dashboard JSON export
notebook file
shared shell history
```

Gunakan:

- Kubernetes Secret dengan external secret manager,
- Vault / AWS Secrets Manager / GCP Secret Manager / Azure Key Vault,
- file-mounted secret dengan permission ketat,
- short-lived token bila tersedia,
- rotation process.

Untuk Java app:

```java
record QuestDbCredentials(
    String host,
    int port,
    String username,
    String password
) {}
```

Jangan log object credential:

```java
log.info("QuestDB config={}", credentials); // bad if password included
```

Gunakan redaction:

```java
log.info("QuestDB host={}, port={}, user={}", host, port, username);
```

---

### 7.3 Rotation Strategy

Credential rotation harus diuji.

Checklist:

1. Apakah app membaca secret saat startup saja atau bisa hot reload?
2. Apakah connection pool reconnect dengan credential baru?
3. Apakah old credential bisa dicabut setelah overlap window?
4. Apakah Grafana datasource bisa diupdate otomatis?
5. Apakah batch/backfill runner punya secret berbeda?
6. Apakah token producer lama masih bisa ingest?
7. Apakah alert dibuat untuk auth failure spike?

Rotation tanpa playbook biasanya menjadi outage.

---

## 8. Authorization Design

### 8.1 Least Privilege by Use Case

Authorization harus berbasis tugas.

#### Ingestion service

Allowed:

- write approved table,
- maybe create rows only,
- maybe not create tables/columns dynamically in production,
- maybe no read.

Not allowed:

- select all historical data,
- drop/alter table,
- manage users,
- run arbitrary admin SQL.

#### Query API

Allowed:

- select approved tables/views,
- maybe read materialized views,
- bounded query only via app-level validation.

Not allowed:

- write,
- DDL,
- admin operations,
- unbounded arbitrary SQL from end user.

#### Grafana / dashboard

Allowed:

- read summary tables/materialized views,
- limited raw tables only where justified.

Not allowed:

- admin,
- ingestion,
- broad raw access for every dashboard editor.

#### Analyst

Allowed:

- curated views,
- maybe sampled/aggregated data.

Not allowed:

- sensitive raw data by default,
- all tenants,
- operational metadata unless needed.

---

### 8.2 Query Boundary Belongs in Application Too

Even with RBAC, many controls are better enforced in Java API:

- tenant scoping,
- max time range,
- max result rows,
- allowed aggregate interval,
- allowed dimensions,
- no arbitrary SQL string from users,
- query timeout,
- pagination/cursor policy,
- export policy.

Example API request:

```json
{
  "tenantId": "acme",
  "metric": "machine.temperature",
  "from": "2026-06-21T00:00:00Z",
  "to": "2026-06-21T01:00:00Z",
  "bucket": "1m",
  "groupBy": ["machine_id"]
}
```

Java service compiles this into safe SQL template:

```sql
SELECT
    ts,
    machine_id,
    avg(value) AS avg_value
FROM machine_metrics
WHERE tenant_id = $1
  AND metric_name = $2
  AND ts >= $3
  AND ts <  $4
SAMPLE BY 1m;
```

Do not expose:

```text
POST /query
{
  "sql": "SELECT * FROM raw_metrics"
}
```

to normal product users.

---

## 9. Multi-Tenant Boundary Design

### 9.1 Three Tenant Models

#### Model A — Shared Table, Tenant Column

```sql
CREATE TABLE metrics (
    tenant_id SYMBOL,
    device_id SYMBOL,
    metric_name SYMBOL,
    value DOUBLE,
    ts TIMESTAMP
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Pros:

- operationally simple,
- efficient shared ingestion,
- easy global operations,
- fewer tables.

Cons:

- tenant isolation mostly depends on query/auth layer,
- one tenant can cause cardinality/storage blast radius,
- retention per tenant harder,
- noisy neighbor risk,
- accidental cross-tenant query risk.

Good for:

- trusted internal tenants,
- small/medium SaaS with strong app-level enforcement,
- tenants with similar retention/SLO.

Risk for:

- strict regulatory isolation,
- very large tenants,
- tenant-specific retention/legal hold,
- untrusted query access.

---

#### Model B — Table Per Tenant

```text
metrics_tenant_acme
metrics_tenant_zenith
metrics_tenant_orion
```

Pros:

- easier table-level access control,
- easier tenant-specific retention,
- easier tenant backup/export/delete,
- reduced accidental cross-tenant query risk.

Cons:

- table explosion,
- operational overhead,
- schema migration across many tables,
- query logic more complex,
- dashboards harder to templatize,
- many small partitions/files if tenants are small.

Good for:

- high-value tenants,
- strict isolation,
- tenant-specific lifecycle,
- enterprise deployment per customer.

Bad for:

- thousands of tiny tenants,
- high schema evolution rate,
- many dynamic tenant onboarding events.

---

#### Model C — Database/Cluster Per Tenant or Tenant Group

Pros:

- strongest isolation,
- independent scaling,
- independent upgrades,
- independent backups,
- lower blast radius.

Cons:

- most expensive,
- operationally heavier,
- fleet management required,
- cross-tenant analytics harder.

Good for:

- regulated/high-value tenants,
- sovereign data boundaries,
- large enterprise customers,
- industrial/financial workloads with strict contractual isolation.

---

### 9.2 Recommended Decision Matrix

| Requirement | Shared Table | Table per Tenant | Cluster per Tenant |
|---|---:|---:|---:|
| Low ops overhead | strong | medium | weak |
| Strong isolation | weak/medium | medium/strong | strongest |
| Tenant-specific retention | weak | strong | strongest |
| Thousands of tenants | strong | weak | weak |
| Huge tenants | medium | strong | strongest |
| Strict compliance | weak unless compensated | medium | strong |
| Global analytics | strong | medium | weak |
| Noisy neighbor control | weak | medium | strong |

There is no universally correct model.

Architecture review question:

```text
What is the maximum blast radius of one compromised tenant identity or one buggy producer?
```

If the answer is “all tenants”, the design may be unacceptable for regulated SaaS.

---

## 10. Data Exfiltration Controls

### 10.1 Time Range Limits

Every product-facing query should have explicit bounds:

```sql
WHERE ts >= $from
  AND ts <  $to
```

Enforce in Java:

```java
Duration range = Duration.between(from, to);
if (range.compareTo(maxAllowedRangeFor(request.metric(), request.bucket())) > 0) {
    throw new BadRequestException("time range too large");
}
```

Different query classes need different limits:

| Query Type | Example Limit |
|---|---:|
| raw samples | 1h–24h |
| 1m rollup | 7d–30d |
| 1h rollup | 1y |
| export job | async approval/job system |
| admin forensic | break-glass path |

---

### 10.2 Row and Export Limits

Do not stream unlimited result sets to users.

Controls:

- max rows,
- max bytes,
- async export approval,
- signed export URL expiry,
- audit log for export,
- rate limit per user/tenant,
- separate raw export role.

Bad:

```text
GET /metrics/export?tenant=acme&from=2020-01-01&to=2026-06-21
```

Better:

```text
POST /exports
  validates scope
  estimates rows/bytes
  checks permission
  creates auditable job
  stores encrypted output
  expires output
```

---

### 10.3 Column-Level Sensitivity

Some columns are more sensitive than others:

- exact location,
- device serial,
- user identifier,
- IP address,
- raw payload,
- error detail,
- investigation/enforcement status,
- financial account reference.

Pattern:

```text
raw table        -> restricted
curated view     -> broader access
materialized agg -> dashboard access
masked/exported  -> external sharing
```

Do not assume all time-series rows have equal sensitivity.

---

## 11. Java Service Security Patterns

### 11.1 Safe Query Builder Pattern

Use templates, not arbitrary SQL.

```java
public final class MetricsQueryService {
    private final DataSource questDb;
    private final AuthorizationService authz;
    private final QueryPolicy policy;

    public List<MetricPoint> querySeries(UserPrincipal user, MetricsRequest request) {
        authz.requireTenantAccess(user, request.tenantId());
        policy.validateMetric(request.metricName());
        policy.validateTimeRange(request.from(), request.to(), request.bucket());
        policy.validateGroupBy(request.groupBy());

        String sql = """
            SELECT ts, device_id, avg(value) AS avg_value
            FROM machine_metrics
            WHERE tenant_id = ?
              AND metric_name = ?
              AND ts >= ?
              AND ts < ?
            SAMPLE BY 1m
            """;

        return execute(sql, request);
    }
}
```

Important:

- validate metric names against registry,
- validate dimensions against allowlist,
- bind values as parameters where supported by client path,
- never concatenate user SQL fragments,
- apply timeout,
- apply result limit,
- log query class, not raw sensitive SQL.

---

### 11.2 Ingestion Gateway Pattern

Instead of letting every producer connect directly to QuestDB:

```text
producer services -> ingestion gateway -> QuestDB ILP
```

Gateway responsibilities:

- authenticate producer,
- map producer to tenant/table,
- validate schema,
- normalize timestamp,
- reject future/too-old events,
- enforce cardinality budget,
- rate limit,
- route to correct table,
- attach source metadata,
- DLQ invalid events,
- emit ingestion metrics.

This is especially important if QuestDB edition/deployment does not provide the fine-grained write controls you need at database layer.

---

### 11.3 Break-Glass Admin Path

Production needs admin access, but it must be controlled.

Break-glass pattern:

```text
normal users: no admin SQL
operators: limited operational views/runbooks
break-glass admin: short-lived approval, audited, time-limited
```

Controls:

- named identity,
- MFA/SSO where available,
- ticket/incident ID,
- limited session time,
- audit log,
- post-incident review,
- no shared admin password.

---

## 12. Threat Model

### 12.1 Threat: Compromised Dashboard Credential

Impact:

- attacker queries all raw data accessible to Grafana role,
- attacker exports long ranges,
- attacker infers business activity.

Mitigation:

- Grafana role reads materialized views only,
- tenant dashboard variable enforced in API/proxy,
- no raw SQL editor for broad users,
- time range limits,
- alert on unusual query volume.

---

### 12.2 Threat: Buggy Producer

Impact:

- creates unexpected columns,
- sends high-cardinality symbols,
- writes wrong tenant,
- floods disk,
- breaks downstream views.

Mitigation:

- ingestion gateway,
- disable/avoid uncontrolled schema auto-creation in production process,
- producer allowlist,
- cardinality budget,
- per-producer rate limit,
- separate credential per producer,
- DLQ.

---

### 12.3 Threat: Insider with PGWire Access

Impact:

- broad historical query,
- raw sensitive data access,
- operational intelligence leakage.

Mitigation:

- RBAC/read-only roles,
- view-based access,
- network restriction,
- named users,
- audited access,
- no shared credentials,
- query log/monitoring where available,
- export controls.

---

### 12.4 Threat: Backup Bucket Exposure

Impact:

- full historical data leakage,
- bypass live DB access controls,
- difficult-to-detect exfiltration.

Mitigation:

- least-privilege cloud IAM,
- bucket encryption,
- object lock/legal hold policy when required,
- access logs,
- private endpoint,
- separate backup account/project,
- restore only into secure environments.

---

### 12.5 Threat: Tenant Escape

Impact:

- one tenant reads another tenant’s time-series.

Mitigation options:

- app-layer tenant enforcement,
- table-per-tenant or cluster-per-tenant for strict isolation,
- views/roles where available,
- no arbitrary SQL endpoint to tenant users,
- test cross-tenant access as security test,
- include tenant predicate in every query template.

---

## 13. Security Testing

### 13.1 Access Tests

Create tests that assert:

1. producer credential cannot read data,
2. read-only credential cannot insert,
3. dashboard credential cannot access raw sensitive table,
4. analyst cannot query admin/system data,
5. tenant A cannot query tenant B through API,
6. query without time range is rejected,
7. too-large export requires async/export permission,
8. revoked credential fails,
9. rotated credential works,
10. metrics endpoint is inaccessible from app subnet unless intended.

---

### 13.2 Query Policy Tests

Example test cases:

```text
reject raw query > 24h
allow 1m rollup query <= 30d
reject unknown metric
reject unknown groupBy dimension
reject unapproved tenant_id
reject SQL injection-like metric name
reject future timestamp too far ahead
reject export without export permission
```

Security test should be part of CI/CD, not only penetration test.

---

### 13.3 Producer Contract Tests

Producer must prove:

- table name is approved,
- column names are approved,
- types are stable,
- tenant_id is correct,
- timestamp is event-time and within allowed skew,
- symbol values are normalized,
- no PII leaks into tag/symbol fields,
- retry is idempotent where needed.

---

## 14. Operational Security Runbooks

### 14.1 Credential Leak

Immediate actions:

1. identify credential and privilege,
2. revoke/rotate credential,
3. identify clients using it,
4. inspect access logs/metrics if available,
5. check unusual query volume/export,
6. rotate related secrets,
7. invalidate cached connections,
8. document blast radius,
9. review why credential leaked.

---

### 14.2 Suspicious Query Volume

Symptoms:

- sudden PGWire query spike,
- long-range scans,
- high network egress,
- dashboard role querying raw tables,
- disk/page cache pressure from unknown source.

Actions:

1. identify source IP/service account,
2. classify query class,
3. block at network/security group if malicious,
4. revoke credential if compromised,
5. reduce role privilege,
6. add query guardrails,
7. check exported data path.

---

### 14.3 Bad Producer Writes Sensitive Data

Actions:

1. stop producer credential/network path,
2. identify affected table/partition/time range,
3. determine if data must be deleted, masked, or quarantined,
4. assess backup/cold storage exposure,
5. update schema validation,
6. add contract test,
7. rotate downstream views if sensitive data leaked to derived tables.

Important:

```text
If sensitive data entered raw table,
check materialized views, backups, replication targets, exports, and cold storage too.
```

---

## 15. Anti-Patterns

### Anti-Pattern 1 — Admin Credential Everywhere

```text
One admin credential for app, Grafana, producers, scripts.
```

Failure:

- impossible to audit,
- huge blast radius,
- rotation painful,
- least privilege impossible.

---

### Anti-Pattern 2 — Tenant Isolation Only in UI

```text
Frontend hides tenant dropdown,
backend accepts arbitrary tenant_id.
```

Failure:

- direct API call can query other tenant,
- SQL injection or parameter tampering becomes cross-tenant leak.

---

### Anti-Pattern 3 — Public Web Console

```text
QuestDB console exposed via public domain for convenience.
```

Failure:

- high-value attack surface,
- brute force/auth bypass risk,
- accidental admin operations.

---

### Anti-Pattern 4 — Grafana With Raw Admin Access

```text
Grafana datasource uses admin credentials.
```

Failure:

- dashboard editor becomes database admin,
- raw data export possible,
- accidental expensive queries.

---

### Anti-Pattern 5 — Unbounded Query API

```text
/query?sql=SELECT * FROM table
```

Failure:

- data exfiltration,
- query storm,
- noisy neighbor,
- expensive scans.

---

### Anti-Pattern 6 — Backup Bucket Treated as Low Risk

```text
Production DB protected, backups open to broad cloud account.
```

Failure:

- full historical leak bypasses database security.

---

### Anti-Pattern 7 — Letting Producers Define Schema Freely

```text
Any producer can create any metric/table/column.
```

Failure:

- metric swamp,
- cardinality explosion,
- sensitive data leakage,
- broken queries.

---

## 16. Production Security Checklist

### 16.1 Network

- [ ] PGWire is private, not internet-facing.
- [ ] HTTP/Web Console is admin-only.
- [ ] ILP endpoint is producer-subnet-only or behind ingestion gateway.
- [ ] Metrics endpoint is monitoring-subnet-only.
- [ ] Object storage access is private and least-privilege.
- [ ] TLS is enabled or compensating control is documented.
- [ ] Security groups/firewall rules are reviewed.

### 16.2 Identity and Access

- [ ] No shared admin credential for services.
- [ ] Separate credentials per service.
- [ ] Producer credentials cannot query broadly.
- [ ] Dashboard credential is read-only and scoped.
- [ ] Admin access is named, audited, and break-glass controlled.
- [ ] Credential rotation process is tested.
- [ ] Default credentials are changed/disabled according to edition capability.

### 16.3 Query Controls

- [ ] Product users cannot submit arbitrary SQL.
- [ ] Every query template includes tenant scope.
- [ ] Every query template includes bounded time range.
- [ ] Max range differs by query class.
- [ ] Max result/export size is enforced.
- [ ] Raw export has separate permission.
- [ ] Sensitive columns are hidden behind views/curated APIs.

### 16.4 Ingestion Controls

- [ ] Producers are authenticated.
- [ ] Producer-to-table mapping is explicit.
- [ ] Schema registry/allowlist exists.
- [ ] Timestamp skew is validated.
- [ ] Tenant_id is assigned or validated server-side.
- [ ] Cardinality budget is enforced.
- [ ] Rate limit exists.
- [ ] Invalid events go to DLQ/quarantine.

### 16.5 Multi-Tenancy

- [ ] Tenant isolation model is explicit.
- [ ] Blast radius of one tenant credential is documented.
- [ ] Cross-tenant access tests exist.
- [ ] Tenant-specific retention/legal hold is supported if required.
- [ ] Noisy neighbor controls exist for large tenants.

### 16.6 Backup and DR

- [ ] Backup is encrypted.
- [ ] Backup IAM is least privilege.
- [ ] Restore environment is secure.
- [ ] Backup access is audited.
- [ ] Object storage lifecycle does not violate retention/legal hold.
- [ ] Test restore does not leak production data to dev.

---

## 17. Architecture Review Questions

Use these questions in design review:

1. Which QuestDB endpoints are exposed to which network zones?
2. Can any user or service run arbitrary SQL?
3. What is the maximum time range a normal user can query?
4. What prevents tenant A from querying tenant B?
5. Does Grafana read raw tables or curated views?
6. Can a producer create new columns/tables in production?
7. What happens if a producer sends high-cardinality symbols?
8. Are credentials per service or shared?
9. How are secrets rotated?
10. Are backups protected as strongly as the database?
11. Is Web Console accessible only through admin boundary?
12. Are query/export operations audited?
13. Does security differ between dev/staging/prod?
14. Can support engineers access customer raw data?
15. Is there a break-glass process?

---

## 18. Summary

QuestDB security is not a single feature. It is a system design property.

Core invariants:

```text
1. Treat PGWire, HTTP, ILP, metrics, and object storage as separate security surfaces.
2. Do not expose QuestDB ports publicly by default.
3. Separate ingestion privilege from query privilege.
4. Do not give dashboard tools admin/raw access by default.
5. Tenant isolation must be explicit and tested.
6. Time range is a security boundary in TSDB.
7. Backup security must match production database security.
8. Producers need validation, not blind trust.
9. Secrets must be per-service, rotated, and never logged.
10. If users need flexible query, prefer curated views or controlled query builders over arbitrary SQL.
```

A secure QuestDB deployment is not defined by whether it has a password. It is defined by whether a compromised user, producer, dashboard, or service account has a **bounded blast radius**.

---

## 19. Next Part

Next:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-026.md
Java Application Integration Patterns
```

Part berikutnya akan membahas bagaimana aplikasi Java berinteraksi dengan QuestDB secara production-grade:

- Spring Boot ingestion service,
- ILP Sender lifecycle,
- JDBC/PGWire query service,
- retry/circuit breaker,
- query guardrails,
- DTO/request design,
- async export,
- error handling,
- observability,
- integration tests,
- deployment topology.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-024.md">⬅️ Part 024 — Backup, Restore, Replication, and Disaster Recovery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-026.md">Part 026 — Java Application Integration Patterns ➡️</a>
</div>
