# Part 30 — Multi-Tenancy, Security, Filters, Row-Level Isolation, and Data Leakage Prevention

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `30-multi-tenancy-security-filters-row-level-isolation-data-leakage.md`  
> Target pembaca: Java engineer yang sudah memahami JPA/Jakarta Persistence dasar dan ingin memahami multi-tenancy ORM sebagai masalah correctness, security, and production isolation.  
> Baseline: Java 8–25, JPA 2.2 `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, EclipseLink 2/3/4/5.

---

## 1. Why This Matters

Multi-tenancy adalah kemampuan satu sistem melayani banyak tenant, agency, organization, branch, hospital, company, customer, regulator unit, atau logical partition dalam satu platform.

Pada level permukaan, multi-tenancy terlihat seperti masalah sederhana:

```text
Tambahkan tenant_id ke semua tabel.
Setiap query harus WHERE tenant_id = currentTenant.
Selesai.
```

Dalam production system, terutama sistem regulatory, enforcement, case management, SaaS enterprise, atau platform pemerintahan, asumsi itu terlalu berbahaya.

Multi-tenancy bukan hanya query filtering. Ia adalah **data isolation contract**.

Data isolation contract berarti:

```text
User dari tenant A tidak boleh bisa melihat, mengubah, menghapus, menghitung,
mengekspor, meng-cache, mengindeks, mengaudit, atau menginfer data tenant B.
```

Kata pentingnya bukan hanya “melihat”. Data leakage juga bisa terjadi melalui:

- jumlah record,
- autocomplete result,
- cache hit,
- error message,
- audit trail,
- search index,
- batch job,
- report export,
- notification,
- async process,
- background scheduler,
- native SQL,
- database view,
- second-level cache,
- object graph lazy loading,
- detached entity merge,
- ID guessing,
- cross-tenant association,
- soft-deleted data,
- admin bypass yang tidak dikendalikan.

Top engineer tidak melihat multi-tenancy sebagai fitur minor di repository layer. Top engineer melihatnya sebagai **security boundary yang harus dibuktikan di setiap jalur akses data**.

---

## 2. Core Mental Model

### 2.1 Multi-tenancy is partitioned state plus scoped execution

ORM bekerja dengan state:

```text
Database rows
  -> SQL result set
  -> entity instances
  -> persistence context
  -> first-level cache
  -> second-level cache
  -> detached objects
  -> API responses
```

Multi-tenancy menambahkan satu invariant:

```text
Setiap state yang masuk, keluar, atau disimpan oleh persistence layer
harus berada dalam tenant scope yang benar.
```

Artinya tenant scope harus ikut dalam:

- connection resolution,
- SQL generation,
- query predicates,
- entity loading,
- association traversal,
- cache keys,
- transaction boundaries,
- async execution context,
- batch processing context,
- auditing,
- search indexing,
- report queries,
- native queries,
- admin override.

Kalau tenant scope hanya ada di controller atau service method, sistem rapuh.

### 2.2 Multi-tenancy is not the same as authorization

Multi-tenancy menjawab:

```text
Data partition mana yang boleh disentuh oleh execution context ini?
```

Authorization menjawab:

```text
Apa aksi yang boleh dilakukan actor ini terhadap resource ini?
```

Contoh:

```text
Tenant: Agency A
Actor: officer-123
Role: reviewer
Resource: case-987
Action: approve
```

Tenant isolation memastikan `case-987` berada di Agency A. Authorization memastikan officer tersebut boleh approve case itu.

Keduanya berbeda tetapi saling mengunci.

```text
Tenant isolation tanpa authorization:
  user bisa melihat semua data dalam tenant.

Authorization tanpa tenant isolation:
  rule bisa salah mengevaluasi resource dari tenant lain.
```

### 2.3 ORM filters are convenience, not always security boundary

Hibernate `@Filter`, provider tenant discriminator, `@Where`, repository base predicates, atau Spring Data specification bisa membantu. Tetapi jangan menganggap semuanya sebagai security boundary mutlak.

Alasannya:

- native query bisa bypass filter,
- bulk update/delete bisa bypass entity lifecycle,
- second-level cache bisa salah dikonfigurasi,
- association bisa memuat entity lintas tenant,
- admin query bisa lupa scope,
- async job bisa kehilangan tenant context,
- database user masih bisa membaca semua row,
- report query bisa tidak lewat ORM.

Untuk data yang benar-benar sensitif, tenant isolation paling kuat biasanya dibangun berlapis:

```text
Application tenant context
  + ORM-level tenant handling/filtering
  + database constraints
  + database row-level security or schema/database isolation
  + cache key separation
  + audit and test enforcement
```

---

## 3. Three Main Multi-Tenancy Models

Secara praktis ada tiga model utama.

```text
1. Database per tenant
2. Schema per tenant
3. Shared schema with tenant discriminator column
```

Kadang ada variasi hybrid, misalnya:

- enterprise tenant besar diberi database sendiri,
- tenant kecil berbagi schema,
- archive dipisah per tenant,
- reporting warehouse menggunakan partitioning berbeda,
- operational DB shared tetapi document store per tenant.

### 3.1 Database per tenant

Setiap tenant punya database sendiri.

```text
Tenant A -> db_tenant_a
Tenant B -> db_tenant_b
Tenant C -> db_tenant_c
```

Keunggulan:

- isolasi kuat,
- backup/restore per tenant mudah,
- noisy neighbor lebih terkendali,
- compliance lebih mudah dijelaskan,
- risiko cross-tenant row leakage kecil,
- bisa upgrade/migrate tenant tertentu secara bertahap.

Kelemahan:

- operational overhead tinggi,
- connection pool per tenant bisa mahal,
- migration harus dijalankan ke banyak database,
- reporting lintas tenant lebih sulit,
- provisioning tenant lebih kompleks,
- biaya infrastruktur lebih tinggi,
- failover/backup policy lebih banyak variasinya.

Cocok untuk:

- tenant enterprise besar,
- high compliance,
- data residency kuat,
- regulator/agency isolation,
- tenant dengan custom lifecycle,
- sistem yang membutuhkan restore per tenant.

Risiko ORM:

- salah resolve datasource,
- tenant context tidak ada saat membuka session,
- connection leak antar tenant,
- background job memakai default tenant,
- migration version mismatch antar database.

### 3.2 Schema per tenant

Satu database, banyak schema.

```text
Database: appdb
  schema tenant_a
  schema tenant_b
  schema tenant_c
```

Keunggulan:

- isolasi lebih kuat daripada shared table,
- migration masih relatif terpusat,
- connection bisa berbagi database,
- constraint/index per schema,
- backup dapat lebih terarah tergantung database.

Kelemahan:

- jumlah schema besar bisa berat,
- migration perlu loop per schema,
- search path/current schema harus aman,
- connection state harus di-reset dengan benar,
- cross-schema reporting tetap kompleks.

Cocok untuk:

- tenant sedang/besar,
- butuh isolasi kuat tapi tidak ingin database per tenant,
- database mendukung schema dengan baik,
- operasi tenant masih manageable.

Risiko ORM:

- connection dari pool membawa schema tenant sebelumnya,
- `SET SCHEMA` tidak di-reset,
- native query memakai schema hardcoded,
- cache key tidak memasukkan tenant,
- batch job salah schema.

### 3.3 Shared schema with tenant discriminator

Semua tenant berbagi tabel yang sama, setiap row punya `tenant_id`.

```text
case
  id | tenant_id | status | created_at | ...
```

Keunggulan:

- paling sederhana secara provisioning,
- efisien untuk banyak tenant kecil,
- migration hanya satu schema,
- reporting lintas tenant mudah,
- operasional awal lebih murah.

Kelemahan:

- isolasi paling lemah jika hanya bergantung aplikasi,
- setiap query harus tenant-aware,
- semua unique constraint harus tenant-aware,
- semua FK harus tenant-aware atau divalidasi,
- cache leakage lebih mudah terjadi,
- accidental full-table cross-tenant query sangat mungkin,
- tenant besar bisa menjadi noisy neighbor,
- delete/archive per tenant lebih sulit.

Cocok untuk:

- SaaS dengan banyak tenant kecil,
- data tidak terlalu sensitif,
- tenant lifecycle sederhana,
- platform yang butuh analytics lintas tenant,
- tim memiliki testing dan observability kuat.

Risiko ORM:

- missing tenant predicate,
- native query bypass,
- collection/association lintas tenant,
- `findById(id)` tidak cukup,
- second-level cache key salah,
- soft delete + tenant filter conflict,
- bulk update/delete lupa tenant predicate.

---

## 4. Model Selection Matrix

| Criterion | Database per Tenant | Schema per Tenant | Shared Schema + Tenant Column |
|---|---:|---:|---:|
| Isolation strength | Very high | High | Medium unless DB RLS used |
| Operational complexity | High | Medium-high | Low-medium |
| Migration complexity | High | Medium-high | Low |
| Tenant provisioning | Slow/heavy | Medium | Fast |
| Per-tenant backup/restore | Strong | Medium | Hard |
| Cross-tenant analytics | Hard | Medium | Easy |
| Cost efficiency | Lower | Medium | High |
| Risk of missing tenant predicate | Low | Low-medium | High |
| Noisy neighbor risk | Low | Medium | High |
| ORM complexity | Datasource/schema routing | Schema routing | filtering/discriminator/cache discipline |
| Best for | regulated/large tenants | moderate isolation | many small tenants |

Rule of thumb:

```text
If tenant data leakage is catastrophic, avoid relying only on ORM filters.
```

For high-assurance systems, prefer:

```text
database per tenant > schema per tenant > shared schema + DB RLS > shared schema + ORM filter only
```

But architecture is not only about security. You must balance:

- tenant count,
- data sensitivity,
- operational team size,
- migration frequency,
- reporting needs,
- cost envelope,
- legal/regulatory obligations,
- recovery requirements,
- failure blast radius.

---

## 5. JPA/Jakarta Persistence Baseline

Jakarta Persistence defines ORM mapping and persistence context behavior. It standardizes things like:

- entity mapping,
- persistence context,
- entity manager,
- JPQL,
- Criteria API,
- lifecycle callbacks,
- locking,
- cache modes,
- schema generation options.

However, multi-tenancy is not deeply standardized as a full portable feature in JPA/Jakarta Persistence. Most serious multi-tenancy support is provider-specific.

This means:

```text
Jakarta Persistence gives you portable persistence primitives.
Hibernate/EclipseLink give you multi-tenancy mechanisms.
Your architecture must define the actual isolation contract.
```

Portable JPA tools that still matter:

- `@Cacheable(false)` for entities that must not be shared-cache candidates,
- persistence unit shared cache mode,
- entity listeners for audit context,
- `EntityManager` properties,
- `@NamedQuery`/Criteria for predictable query structure,
- lock modes for tenant-local concurrency,
- transaction-scoped persistence context.

But tenant isolation itself generally comes from:

- provider multi-tenancy,
- provider filters,
- database schema/database separation,
- database RLS,
- application query discipline.

---

## 6. Hibernate Multi-Tenancy Mental Model

Hibernate has historically supported multi-tenancy primarily through:

```text
1. separate database
2. separate schema
3. discriminator-based / tenant-id style approaches in newer lines
4. filters for application-defined scoping
```

The exact support and recommended APIs differ across Hibernate major versions. Therefore, in production migration, do not assume behavior from Hibernate 5 applies unchanged to Hibernate 6/7.

### 6.1 Database/schema multi-tenancy in Hibernate

For database/schema separation, Hibernate needs a way to obtain the right connection for the current tenant.

Conceptually:

```java
String tenantId = TenantContext.requireTenantId();
EntityManager em = entityManagerFactory.createEntityManager(
    Map.of("hibernate.tenant_identifier_resolver", tenantId)
);
```

Real implementations usually involve:

- `CurrentTenantIdentifierResolver`,
- `MultiTenantConnectionProvider`,
- framework integration,
- datasource routing,
- transaction synchronization.

Conceptual flow:

```text
Request enters application
  -> tenant is resolved from trusted source
  -> tenant context is set
  -> transaction starts
  -> EntityManager/Session obtains tenant-aware connection
  -> SQL executes against correct DB/schema
  -> transaction ends
  -> tenant context cleared
```

Critical invariant:

```text
Tenant must be known before opening the persistence context/session.
```

If the tenant is changed after the session is already open, behavior can become unsafe or undefined from an application correctness perspective.

### 6.2 Discriminator/shared-table tenancy

Shared-table tenancy stores all tenants in the same physical table with a tenant discriminator column.

Example:

```java
@Entity
@Table(name = "case_file")
public class CaseFile {
    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private String tenantId;

    @Column(name = "case_no", nullable = false)
    private String caseNo;
}
```

The dangerous repository method:

```java
Optional<CaseFile> findById(Long id);
```

Why dangerous?

Because `id` alone may not be enough to prove tenant ownership unless primary keys are globally unique and every access path is otherwise tenant-scoped.

Safer query shape:

```java
Optional<CaseFile> findByTenantIdAndId(String tenantId, Long id);
```

Even better: avoid allowing arbitrary tenant ID from request body. Tenant ID must come from trusted execution context, not client input.

```java
public CaseFile getCaseFile(Long id) {
    String tenantId = TenantContext.requireTenantId();
    return caseFileRepository.findByTenantIdAndId(tenantId, id)
        .orElseThrow(NotFoundException::new);
}
```

Return 404 instead of 403 is often appropriate to avoid confirming existence of cross-tenant data, depending on product/security policy.

### 6.3 Hibernate filters

Hibernate filters allow enabling a named filter at session level and applying it to entities/collections.

Conceptual example:

```java
@FilterDef(
    name = "tenantFilter",
    parameters = @ParamDef(name = "tenantId", type = String.class)
)
@Filter(
    name = "tenantFilter",
    condition = "tenant_id = :tenantId"
)
@Entity
@Table(name = "case_file")
public class CaseFile {
    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private String tenantId;
}
```

Enable per session:

```java
Session session = entityManager.unwrap(Session.class);
session.enableFilter("tenantFilter")
       .setParameter("tenantId", TenantContext.requireTenantId());
```

Strengths:

- centralizes tenant predicate,
- can apply to multiple entities,
- can be enabled/disabled explicitly,
- useful for tenant and soft-delete filters.

Weaknesses:

- not JPA portable,
- must be enabled before queries/load paths,
- native SQL may bypass it,
- bulk queries require caution,
- filters may not protect all association/query patterns unless mapped thoroughly,
- admin bypass must be explicit and audited.

### 6.4 `@Where` style static restrictions

Static restrictions such as provider-specific `@Where`-like mapping can be useful for soft delete, but they are dangerous as tenant security boundary.

Why?

Because tenant ID is dynamic. Static clauses work for constants like:

```sql
deleted = false
```

But tenant filtering requires runtime parameter:

```sql
tenant_id = :currentTenant
```

Also, static clauses are easy to forget in native queries and bulk operations.

### 6.5 Hibernate cache and tenant separation

With multi-tenancy, cache keys must be tenant-aware. If the same entity ID can exist in multiple tenants, then cache key must distinguish:

```text
(tenant_id, entity_name, entity_id)
```

not merely:

```text
(entity_name, entity_id)
```

Otherwise:

```text
Tenant A loads CaseFile#100
  -> L2 cache stores CaseFile#100
Tenant B loads CaseFile#100
  -> receives Tenant A data
```

That is catastrophic.

Even if provider supports tenant-aware cache keys for built-in multi-tenancy, you must validate your configuration, especially when:

- using custom cache keys,
- using external cache region provider,
- using query cache,
- using natural ID cache,
- using manual cache access,
- using application-level cache outside Hibernate.

---

## 7. EclipseLink Multi-Tenancy Mental Model

EclipseLink has strong provider-specific multi-tenancy features, including annotations such as:

- `@Multitenant`,
- `@TenantDiscriminatorColumn`,
- tenant context properties,
- table-per-tenant related mechanisms.

### 7.1 Single-table multi-tenancy in EclipseLink

Single-table multi-tenancy is similar to shared schema with discriminator column.

Conceptually:

```java
@Entity
@Multitenant(MultitenantType.SINGLE_TABLE)
@TenantDiscriminatorColumn(
    name = "TENANT_ID",
    contextProperty = "tenant.id"
)
@Table(name = "case_file")
public class CaseFile {
    @Id
    private Long id;

    private String caseNo;
}
```

Then the tenant context is supplied to the persistence context:

```java
Map<String, Object> properties = new HashMap<>();
properties.put("tenant.id", TenantContext.requireTenantId());

EntityManager em = emf.createEntityManager(properties);
```

Conceptual invariant:

```text
The persistence context must be created with the correct tenant property.
```

If a persistence context is created without tenant property, or with wrong tenant property, provider-level discriminator cannot protect the operation correctly.

### 7.2 Table-per-tenant style

EclipseLink has historically supported table-per-tenant strategies through table discriminator concepts where tenant tables may be selected by prefix, suffix, or schema.

Conceptually:

```text
tenant A -> A_CASE_FILE or tenant_a.case_file
tenant B -> B_CASE_FILE or tenant_b.case_file
```

This can be useful when:

- tenants share entity model,
- each tenant table/schema is separate,
- tenant count is manageable,
- DBAs require physical separation.

But it increases:

- DDL complexity,
- migration complexity,
- metadata customization complexity,
- testing matrix.

### 7.3 EclipseLink shared cache risk

EclipseLink has a shared cache concept. In multi-tenant systems, shared cache must be evaluated carefully:

- Is cache tenant-aware?
- Are tenant-discriminated entities safe to cache?
- Are shared reference entities truly global?
- Are tenant-specific lookup values accidentally marked global?
- Does native update invalidate cache?

For sensitive tenant-specific data, conservative rule:

```text
Disable shared cache for tenant-owned mutable entities unless correctness is proven.
```

Performance lost from disabling cache is usually cheaper than cross-tenant leakage.

---

## 8. Tenant Context Design

Tenant context is the execution-scoped tenant identity.

Common bad version:

```java
public class TenantContext {
    public static String tenantId;
}
```

This is unsafe because global static mutable state is shared across threads.

Better for classic servlet thread-per-request:

```java
public final class TenantContext {
    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private TenantContext() {}

    public static void set(String tenantId) {
        if (tenantId == null || tenantId.isBlank()) {
            throw new IllegalArgumentException("tenantId is required");
        }
        CURRENT.set(tenantId);
    }

    public static String requireTenantId() {
        String tenantId = CURRENT.get();
        if (tenantId == null) {
            throw new IllegalStateException("No tenant bound to current execution");
        }
        return tenantId;
    }

    public static void clear() {
        CURRENT.remove();
    }
}
```

Filter pattern:

```java
public class TenantBindingFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request,
                         ServletResponse response,
                         FilterChain chain)
            throws IOException, ServletException {
        try {
            String tenantId = resolveTrustedTenant((HttpServletRequest) request);
            TenantContext.set(tenantId);
            chain.doFilter(request, response);
        } finally {
            TenantContext.clear();
        }
    }
}
```

Critical part:

```java
finally {
    TenantContext.clear();
}
```

Without clearing ThreadLocal, pooled server threads may leak tenant context into next request.

### 8.1 Trusted tenant source

Tenant ID should come from trusted source:

- authenticated token claim validated by IdP,
- server-side session,
- mTLS client mapping,
- API gateway verified header,
- domain/subdomain resolved by trusted routing layer,
- organization membership table after authentication.

Tenant ID should not blindly come from:

- request body,
- query parameter,
- arbitrary header from public client,
- UI-hidden field,
- local storage,
- cookie not integrity-protected.

Bad:

```http
GET /cases/100?tenantId=agency-b
```

Good:

```text
JWT says user belongs to agency-a.
Server resolves tenant agency-a.
Repository never accepts client-supplied tenant override.
```

### 8.2 Async context propagation

ThreadLocal fails when execution moves threads.

Examples:

- `@Async`,
- CompletableFuture,
- executor service,
- scheduler,
- message listener,
- reactive pipeline,
- virtual threads if context binding is not designed,
- batch job partitioning.

Bad:

```java
CompletableFuture.runAsync(() -> {
    repository.findCases(); // tenant context missing or wrong
});
```

Better:

```java
String tenantId = TenantContext.requireTenantId();
CompletableFuture.runAsync(() -> {
    try {
        TenantContext.set(tenantId);
        repository.findCases();
    } finally {
        TenantContext.clear();
    }
}, executor);
```

For platform engineering, prefer framework-level context propagation rather than ad hoc copying everywhere.

### 8.3 Java 21+ note: ScopedValue and structured concurrency

For Java 21+, `ScopedValue` can be a better conceptual fit than `ThreadLocal` for immutable scoped context in structured execution.

Conceptually:

```java
public final class TenantScope {
    public static final ScopedValue<String> TENANT_ID = ScopedValue.newInstance();
}
```

Usage pattern:

```java
ScopedValue.where(TenantScope.TENANT_ID, tenantId)
    .run(() -> service.handleRequest(command));
```

But integration with frameworks, persistence providers, and transaction boundaries must be verified. Do not migrate from ThreadLocal to ScopedValue just because it is modern. The test is:

```text
Can every ORM session/transaction/query reliably read the tenant at the point it needs it?
```

---

## 9. Shared Schema Design Rules

When using `tenant_id` column, schema design must make tenant isolation structurally difficult to violate.

### 9.1 Primary key strategy

Option A: globally unique ID.

```sql
case_file (
  id bigint primary key,
  tenant_id varchar(64) not null,
  case_no varchar(64) not null
)
```

Pros:

- simple FK,
- simple entity ID,
- lower collision risk,
- easier caching.

Cons:

- `findById(id)` can still leak if authorization absent,
- ID guessing may reveal existence,
- tenant-local uniqueness still needs tenant-aware unique constraints.

Option B: composite tenant-aware identity.

```sql
case_file (
  tenant_id varchar(64) not null,
  id bigint not null,
  case_no varchar(64) not null,
  primary key (tenant_id, id)
)
```

Pros:

- database structurally enforces tenant in identity,
- FKs can include tenant,
- cross-tenant association harder.

Cons:

- ORM composite ID complexity,
- APIs need composite addressing or opaque IDs,
- more verbose mapping.

Option C: globally unique public opaque ID plus internal tenant key.

```sql
case_file (
  id bigint primary key,
  public_id uuid not null unique,
  tenant_id varchar(64) not null,
  case_no varchar(64) not null
)
```

Pros:

- external API avoids sequential ID guessing,
- internal joins remain simple,
- tenant predicate still needed.

Cons:

- dual identity complexity,
- unique constraints need discipline.

### 9.2 Unique constraints must include tenant

Bad:

```sql
unique (case_no)
```

This prevents two tenants from using same case number.

Better:

```sql
unique (tenant_id, case_no)
```

For regulatory systems, case number format may be tenant-specific. The DB must encode that reality.

### 9.3 Foreign keys should prevent cross-tenant references

Bad design:

```sql
case_file (
  id bigint primary key,
  tenant_id varchar(64) not null
)

case_task (
  id bigint primary key,
  tenant_id varchar(64) not null,
  case_file_id bigint not null references case_file(id)
)
```

This allows task tenant A to reference case tenant B unless application prevents it.

Better with composite tenant-aware FK:

```sql
case_file (
  tenant_id varchar(64) not null,
  id bigint not null,
  primary key (tenant_id, id)
)

case_task (
  tenant_id varchar(64) not null,
  id bigint not null,
  case_file_id bigint not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, case_file_id)
      references case_file(tenant_id, id)
)
```

This makes cross-tenant association structurally invalid.

### 9.4 Indexes must be tenant-first for tenant-scoped queries

Typical tenant query:

```sql
select *
from case_file
where tenant_id = ?
  and status = ?
  and created_at >= ?
order by created_at desc
fetch first 50 rows only
```

Useful index shape:

```sql
create index idx_case_file_tenant_status_created
on case_file (tenant_id, status, created_at desc);
```

But not all queries should blindly put tenant first. Evaluate actual query patterns:

- point lookup by global UUID,
- tenant dashboard by status,
- tenant export by date,
- global admin monitoring,
- archival job per tenant,
- report by agency group.

The rule:

```text
Tenant predicate must be supported by index strategy, not just correctness logic.
```

Without indexing, tenant filter can become full-table scan across all tenants.

---

## 10. Application-Level Query Discipline

### 10.1 Repository methods must encode tenant scope

Bad:

```java
interface CaseFileRepository extends JpaRepository<CaseFile, Long> {
    List<CaseFile> findByStatus(CaseStatus status);
}
```

Better:

```java
interface CaseFileRepository extends JpaRepository<CaseFile, Long> {
    Optional<CaseFile> findByTenantIdAndId(String tenantId, Long id);

    Page<CaseFile> findByTenantIdAndStatus(
        String tenantId,
        CaseStatus status,
        Pageable pageable
    );
}
```

Even better, hide tenant parameter from business service:

```java
public final class TenantScopedCaseRepository {
    private final CaseFileRepository delegate;

    public Optional<CaseFile> findById(Long id) {
        return delegate.findByTenantIdAndId(TenantContext.requireTenantId(), id);
    }

    public Page<CaseFile> findByStatus(CaseStatus status, Pageable pageable) {
        return delegate.findByTenantIdAndStatus(
            TenantContext.requireTenantId(),
            status,
            pageable
        );
    }
}
```

This prevents business code from passing arbitrary tenant IDs.

### 10.2 Never trust entity ID alone

In shared schema, this is dangerous:

```java
CaseFile caseFile = entityManager.find(CaseFile.class, id);
```

If provider-level filter/discriminator is not guaranteed for `find`, or if cache is wrong, this can leak.

Safer:

```java
CaseFile caseFile = entityManager.createQuery("""
    select c
    from CaseFile c
    where c.id = :id
      and c.tenantId = :tenantId
    """, CaseFile.class)
    .setParameter("id", id)
    .setParameter("tenantId", TenantContext.requireTenantId())
    .getSingleResult();
```

### 10.3 Count queries can leak

Data leakage is not only row content.

Bad:

```java
long count = caseRepository.countByStatus(PENDING);
```

If this returns global pending count, tenant can infer system-wide workload.

Better:

```java
long count = caseRepository.countByTenantIdAndStatus(
    TenantContext.requireTenantId(),
    PENDING
);
```

### 10.4 Autocomplete and search can leak

Autocomplete query:

```sql
select applicant_name
from case_file
where applicant_name like 'Joh%'
limit 10
```

Must become:

```sql
select applicant_name
from case_file
where tenant_id = ?
  and applicant_name like ?
fetch first 10 rows only
```

Search indexes must also be tenant-scoped. If Elasticsearch/OpenSearch/Solr/Lucene is used, every document should carry tenant ID and every query must include tenant filter.

---

## 11. Native SQL, Views, Stored Procedures, and Reporting

ORM filters often do not protect native SQL automatically.

Bad:

```java
@Query(value = """
    select *
    from case_file
    where status = :status
    order by created_at desc
    """, nativeQuery = true)
List<CaseFile> findNativeByStatus(String status);
```

Better:

```java
@Query(value = """
    select *
    from case_file
    where tenant_id = :tenantId
      and status = :status
    order by created_at desc
    """, nativeQuery = true)
List<CaseFile> findNativeByTenantAndStatus(String tenantId, String status);
```

But method signature can still be misused. Prefer wrapping tenant resolution:

```java
public List<CaseFile> findNativeByStatus(CaseStatus status) {
    return delegate.findNativeByTenantAndStatus(
        TenantContext.requireTenantId(),
        status.name()
    );
}
```

### 11.1 Database views

Views can centralize tenant predicates only if the database knows current tenant.

Example concept with session variable:

```sql
create view tenant_case_file as
select *
from case_file
where tenant_id = current_setting('app.tenant_id');
```

Then application must set tenant variable per connection/transaction:

```sql
set local app.tenant_id = 'agency-a';
```

Risk:

- connection pool reuse,
- forgetting to set session variable,
- setting global instead of transaction-local variable,
- DB-specific behavior,
- admin connection bypass.

### 11.2 Stored procedures

Stored procedures must accept tenant explicitly or read trusted session context.

Bad:

```sql
call close_expired_cases();
```

Better:

```sql
call close_expired_cases(:tenant_id);
```

Or for global scheduler:

```text
for each active tenant:
  bind tenant context
  run tenant-scoped procedure
  audit result
```

### 11.3 Reporting

Reporting is one of the most common leakage channels.

Risky reports:

- dropdown options from all tenants,
- total counts without tenant predicate,
- export job using admin datasource,
- report cache keyed only by report name,
- temporary table shared across tenants,
- asynchronous report generated under wrong context,
- file name or S3 path not tenant-separated.

Report cache key should include:

```text
tenant_id + report_type + parameters + actor_scope + data_version/window
```

---

## 12. Database Row-Level Security

Database row-level security, often called RLS, moves tenant predicate enforcement into the database.

Conceptual policy:

```sql
tenant_id = current_database_tenant_context()
```

Strengths:

- protects native SQL,
- protects ad hoc query paths,
- reduces reliance on developer discipline,
- creates database-level defense-in-depth,
- useful for shared schema sensitive systems.

Weaknesses:

- database-specific,
- operationally complex,
- needs reliable session variable handling,
- can surprise ORM if not tested,
- admin/bypass roles must be controlled,
- execution plans can be affected,
- migrations/tests need special setup.

Recommended pattern:

```text
Application resolves trusted tenant
  -> transaction starts
  -> connection is acquired
  -> set transaction-local DB tenant context
  -> ORM/native queries execute
  -> DB policy enforces tenant_id
  -> transaction ends and context resets
```

Do not set tenant context globally on pooled connection without guaranteed reset.

### 12.1 RLS and Hibernate/EclipseLink

With RLS, ORM may not see the tenant predicate in generated SQL, but database enforces it.

Generated SQL:

```sql
select * from case_file where id = ?
```

Database effectively applies:

```sql
select * from case_file
where id = ?
  and tenant_id = current_setting('app.tenant_id')
```

This is powerful, but tests must verify:

- `findById` cannot cross tenant,
- association loading cannot cross tenant,
- native query cannot cross tenant,
- bulk update cannot cross tenant,
- count cannot cross tenant,
- cache does not leak,
- admin mode is explicit and audited.

### 12.2 RLS and second-level cache warning

RLS protects database access. It does not automatically protect application cache.

If ORM second-level cache serves an entity without hitting DB, RLS may not run.

Therefore:

```text
RLS + unsafe L2 cache can still leak.
```

Conservative approach:

- disable L2 cache for tenant-owned entities,
- or prove tenant-aware cache keys,
- or use separate cache regions per tenant,
- or use cache only for global immutable reference data.

---

## 13. Soft Delete + Tenant Isolation

Soft delete often uses:

```sql
deleted = false
```

Tenant isolation uses:

```sql
tenant_id = :tenantId
```

Combined predicate:

```sql
tenant_id = :tenantId
and deleted = false
```

Potential bugs:

- tenant filter applied but soft delete filter missing,
- soft delete filter applied but tenant filter missing,
- admin recovery query sees all tenants,
- unique constraint ignores deleted rows incorrectly,
- deleted child still visible through association,
- bulk update restores rows across tenants.

### 13.1 Unique constraint with soft delete

Business rule:

```text
Case number must be unique among active cases within a tenant.
```

Naive constraint:

```sql
unique (tenant_id, case_no)
```

This prevents reusing case number after soft delete.

Possible options:

- include deleted flag depending on DB semantics,
- partial unique index where `deleted = false`,
- never allow reuse and keep simple unique constraint,
- use business lifecycle state instead of soft delete.

Example partial unique index concept:

```sql
create unique index ux_case_file_active_case_no
on case_file (tenant_id, case_no)
where deleted = false;
```

Database support varies.

### 13.2 Soft delete is not audit

Soft delete says:

```text
This row should be hidden from normal active queries.
```

Audit says:

```text
Who changed what, when, why, from what value to what value, under what authority?
```

Do not treat soft delete as audit trail.

---

## 14. Cross-Tenant Association Prevention

Cross-tenant association is one of the worst data integrity bugs.

Example:

```text
CaseFile(tenant=A, id=100)
Task(tenant=B, caseFile=100)
```

If FK only references `case_file(id)`, the database may allow this.

### 14.1 Application-level invariant

In domain code:

```java
public void assignTask(CaseTask task) {
    if (!this.tenantId.equals(task.getTenantId())) {
        throw new IllegalArgumentException("Cross-tenant task assignment is not allowed");
    }
    this.tasks.add(task);
    task.setCaseFile(this);
}
```

But application-level invariant is not enough.

### 14.2 Database-level invariant

Prefer tenant-aware FK:

```sql
foreign key (tenant_id, case_file_id)
references case_file(tenant_id, id)
```

This enforces tenant consistency even if:

- native SQL inserts data,
- batch job has bug,
- ORM association bug occurs,
- import process maps wrong IDs.

### 14.3 ORM mapping challenge

Tenant-aware composite FK may make mapping more verbose.

But this verbosity buys correctness.

Simplified example:

```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumns({
    @JoinColumn(name = "tenant_id", referencedColumnName = "tenant_id", insertable = false, updatable = false),
    @JoinColumn(name = "case_file_id", referencedColumnName = "id", insertable = false, updatable = false)
})
private CaseFile caseFile;
```

Design rule:

```text
Do not optimize away tenant-aware constraints merely to make ORM mapping prettier.
```

---

## 15. Admin Mode and Support Mode

Many systems need admin/support users who can access multiple tenants.

This is dangerous if implemented as:

```text
if admin: disable tenant filter
```

That creates broad unbounded access.

Better model:

```text
Normal mode:
  exactly one active tenant

Delegated admin mode:
  admin explicitly selects tenant
  all actions scoped to selected tenant
  reason/ticket required
  audit event emitted

Global platform mode:
  only for limited platform operations
  read-only where possible
  strongly audited
  separate permission
```

Admin access should have:

- explicit tenant selection,
- clear UI indication,
- reason code,
- time-bounded session,
- audit trail,
- break-glass policy,
- least privilege,
- no accidental default “all tenants”.

### 15.1 Avoid ambiguous tenant context

Bad:

```java
Optional<String> tenantId = TenantContext.getTenantId();
if (tenantId.isPresent()) {
    query.where(tenant_id = tenantId.get());
}
// else global query
```

This makes missing tenant context silently become global access.

Better:

```java
TenantScope scope = TenantContext.requireScope();

switch (scope.kind()) {
    case SINGLE_TENANT -> applyTenantPredicate(scope.tenantId());
    case GLOBAL_ADMIN -> requireGlobalAdminPermissionAndAudit();
    default -> throw new IllegalStateException();
}
```

Missing tenant should fail closed.

```text
No tenant context -> error
not -> global access
```

---

## 16. Cache Leakage Patterns

### 16.1 ORM second-level cache

Tenant-owned mutable entities are risky cache candidates.

Bad assumption:

```text
DB has tenant_id, therefore cache is safe.
```

Cache may not query DB.

Safer policy:

```text
Cache global immutable reference data.
Avoid caching tenant-owned mutable operational data unless tenant-aware keying is proven.
```

Examples of global cache-safe data:

- country list,
- currency code,
- static classification type,
- immutable public reference data.

Examples of risky cache data:

- case file,
- application,
- user profile,
- task assignment,
- correspondence,
- document metadata,
- audit trail,
- tenant-specific lookup.

### 16.2 Application cache

Application-level cache is often more dangerous than ORM cache.

Bad:

```java
@Cacheable("caseSummary")
public CaseSummary getSummary(Long caseId) { ... }
```

Cache key is only `caseId`.

Better:

```java
@Cacheable(
    value = "caseSummary",
    key = "T(com.example.TenantContext).requireTenantId() + ':' + #caseId"
)
public CaseSummary getSummary(Long caseId) { ... }
```

Or better, create a typed key:

```java
record TenantCacheKey(String tenantId, String resourceType, Object resourceId) {}
```

### 16.3 Query cache

Query cache must include tenant parameter as part of cache key. If tenant filter is implicit and not part of key, verify provider behavior.

Bad conceptual key:

```text
query: find pending cases
params: status=PENDING
```

Good conceptual key:

```text
query: find pending cases
params: tenant=A, status=PENDING
```

### 16.4 External document/file cache

Files and generated reports should include tenant in storage path or metadata.

Risky:

```text
s3://bucket/reports/case-summary-2026-06.csv
```

Safer:

```text
s3://bucket/tenants/{tenantId}/reports/{reportId}/case-summary.csv
```

Also enforce access control at object layer, not just path convention.

---

## 17. ID Guessing and Object Reference Security

Shared schema systems often use numeric IDs.

```http
GET /cases/100
GET /cases/101
GET /cases/102
```

Even with tenant filtering, predictable IDs can enable:

- existence probing,
- timing attacks,
- log correlation,
- support ticket confusion,
- enumeration attempts.

Use opaque external identifiers:

```text
/cases/01JXYZ8Y6Z2ZCQ2HB6EEXAMPLE
```

or UUID:

```text
/cases/550e8400-e29b-41d4-a716-446655440000
```

But opaque IDs do not replace tenant checks.

```text
Opaque ID reduces guessability.
Tenant check enforces isolation.
Authorization check enforces permission.
```

All three can be needed.

---

## 18. Multi-Tenancy and Persistence Context

Persistence context has first-level cache.

Within one `EntityManager`/`Session`, entity identity is managed by entity type and ID. In multi-tenant systems, the persistence context itself must be tenant-scoped.

Danger:

```text
Use one extended persistence context across tenant switch.
```

Example bad flow:

```text
Admin opens tenant A case.
Same long-lived session switches to tenant B.
Persistence context still contains tenant A entity.
Lazy association or flush now mixes state.
```

Rule:

```text
Never reuse one persistence context across tenant scope changes.
```

When admin switches tenant:

- close current persistence context,
- clear first-level cache,
- start a new transaction/session under selected tenant,
- reload data under new tenant scope.

### 18.1 Detached entities across tenant boundary

Detached entity carries data but not active tenant enforcement.

Bad:

```java
CaseFile detached = apiPayload.toEntity();
entityManager.merge(detached);
```

If detached object contains ID from another tenant, merge can overwrite wrong data unless tenant predicate/version/authorization is enforced.

Safer:

```java
CaseFile managed = repository.findByTenantIdAndId(
    TenantContext.requireTenantId(),
    command.caseId()
).orElseThrow(NotFoundException::new);

managed.apply(command);
```

Do not merge arbitrary detached graphs from API boundary.

---

## 19. Bulk Operations in Multi-Tenant Systems

Bulk operations are high-risk because they bypass normal entity loading and lifecycle.

Bad:

```java
@Modifying
@Query("""
    update CaseFile c
    set c.status = 'EXPIRED'
    where c.expiryDate < :today
    """)
int expireCases(LocalDate today);
```

This updates all tenants.

Better:

```java
@Modifying
@Query("""
    update CaseFile c
    set c.status = 'EXPIRED'
    where c.tenantId = :tenantId
      and c.expiryDate < :today
    """)
int expireCases(String tenantId, LocalDate today);
```

For scheduler:

```java
for (Tenant tenant : tenantRegistry.activeTenants()) {
    TenantContext.runAs(tenant.id(), () -> {
        caseMaintenanceService.expireCasesForCurrentTenant(today);
    });
}
```

### 19.1 Bulk delete

Bulk delete without tenant predicate is catastrophic.

```sql
delete from notification where created_at < ?
```

Should be:

```sql
delete from notification
where tenant_id = ?
  and created_at < ?
```

For global housekeeping, prove that table is truly global or partitioned safely.

### 19.2 Batch jobs

Every batch job should declare its scope:

```text
Scope: single tenant
Scope: tenant loop
Scope: global metadata only
Scope: platform admin with audited reason
```

No batch job should have ambiguous scope.

---

## 20. Multi-Tenancy and Messaging/Eventing

Messages must carry tenant context.

Bad event:

```json
{
  "caseId": 100,
  "eventType": "CASE_APPROVED"
}
```

Better:

```json
{
  "tenantId": "agency-a",
  "caseId": 100,
  "eventType": "CASE_APPROVED",
  "occurredAt": "2026-06-17T10:15:30Z"
}
```

Consumer must validate:

- tenant exists,
- event source is trusted,
- case belongs to tenant,
- idempotency key includes tenant,
- cache keys include tenant,
- dead-letter handling does not expose cross-tenant payload.

Idempotency key:

```text
tenant_id + event_id
```

not only:

```text
event_id
```

unless event IDs are globally guaranteed.

---

## 21. Multi-Tenancy and Auditing

Audit record must include tenant context.

Minimum audit fields:

```text
tenant_id
action
actor_id
actor_type
resource_type
resource_id
before_state/after_state or diff
reason/context
correlation_id
occurred_at
source_ip/client/application
```

Audit queries must also be tenant-scoped.

Bad:

```sql
select *
from audit_trail
where resource_id = ?
order by occurred_at desc
```

Better:

```sql
select *
from audit_trail
where tenant_id = ?
  and resource_id = ?
order by occurred_at desc
```

### 21.1 Admin audit

When admin accesses tenant data:

```text
tenant_id = target tenant
actor_id = admin user
actor_scope = delegated-admin/platform-admin
reason = ticket/reference
```

Do not store admin audit as global without target tenant. It becomes hard to reconstruct accountability.

---

## 22. Multi-Tenancy and Regulatory Defensibility

In regulatory systems, you may need to explain isolation in audits.

A defensible design can answer:

1. How is tenant determined?
2. Which sources are trusted?
3. Where is tenant context bound?
4. What prevents tenant context from leaking across requests?
5. How do ORM queries enforce tenant scope?
6. How do native SQL/reporting/batch jobs enforce tenant scope?
7. Are database constraints tenant-aware?
8. Is cache tenant-aware?
9. Is search index tenant-aware?
10. How is admin access constrained and audited?
11. How are tests proving no cross-tenant access?
12. What happens if tenant context is missing?
13. Can DBAs or support roles bypass tenant controls?
14. Are cross-tenant operations explicit and approved?
15. How are incidents detected?

If your design cannot answer these, it is not defensible yet.

---

## 23. Testing Multi-Tenant Isolation

### 23.1 Baseline fixture

Create at least two tenants:

```text
Tenant A:
  case id=100, caseNo=A-001
  applicant=Alice A

Tenant B:
  case id=100 or id=200, caseNo=B-001
  applicant=Alice B
```

Use same IDs if your schema permits tenant-local IDs. This catches cache/key bugs.

### 23.2 Repository isolation tests

Test every query pattern:

```java
@Test
void findByIdDoesNotCrossTenant() {
    runAsTenant("tenant-a", () -> {
        assertThat(service.getCase(caseIdOfTenantB)).isNotFound();
    });
}
```

Test:

- find by ID,
- list by status,
- count,
- search,
- autocomplete,
- association load,
- lazy collection,
- projection query,
- native query,
- bulk update,
- bulk delete,
- report export,
- cache hit after tenant switch.

### 23.3 Cache isolation test

```java
@Test
void secondLevelCacheDoesNotReturnOtherTenantEntity() {
    runAsTenant("tenant-a", () -> service.getCase(100));
    runAsTenant("tenant-b", () -> {
        CaseDto dto = service.getCase(100);
        assertThat(dto.tenantId()).isEqualTo("tenant-b");
    });
}
```

### 23.4 Missing tenant test

```java
@Test
void missingTenantFailsClosed() {
    TenantContext.clear();
    assertThrows(NoTenantContextException.class,
        () -> service.listCases());
}
```

Expected behavior:

```text
Missing tenant -> fail
not -> global query
```

### 23.5 Admin mode test

Verify:

- admin must select tenant,
- global admin access requires separate permission,
- reason is required,
- audit event is emitted,
- disabling tenant filter is not silent.

### 23.6 Static analysis

Search for risky patterns:

```text
findById(
entityManager.find(
createNativeQuery(
@Query(nativeQuery = true)
update ... where
 delete ... where
@Cacheable
@Where
clearAutomatically
```

Require review checklist for each.

---

## 24. Observability and Detection

Multi-tenancy failure detection should not rely only on user reports.

### 24.1 SQL observability

Logs/traces should show tenant context, but avoid PII.

Example structured fields:

```json
{
  "correlationId": "req-123",
  "tenantIdHash": "t:8f12...",
  "actorIdHash": "u:91aa...",
  "operation": "CaseSearch",
  "entity": "CaseFile",
  "queryName": "CaseFile.searchByStatus",
  "rowCount": 50,
  "durationMs": 42
}
```

Do not log raw sensitive tenant names if policy disallows it. Use stable hash/token where appropriate.

### 24.2 Query anomaly detection

Detect:

- query without tenant predicate on tenant-owned table,
- unexpectedly high row count,
- query scanning many tenants,
- admin global queries,
- cache hit under unexpected tenant,
- report generated without tenant scope,
- tenant context missing.

### 24.3 Database auditing

For high-risk systems, consider DB-level audit for:

- session tenant context,
- DB user,
- query source,
- global admin bypass,
- cross-tenant table access.

---

## 25. Production Failure Modes

### Failure 1: Missing tenant predicate in repository query

Symptom:

- tenant sees records from another tenant,
- counts look too high,
- search returns unexpected names.

Root cause:

```java
findByStatus(status)
```

instead of:

```java
findByTenantIdAndStatus(tenantId, status)
```

Fix:

- tenant-scoped repository wrapper,
- static analysis,
- integration tests with two tenants,
- DB RLS if risk is high.

### Failure 2: `findById` leaks cross-tenant data

Symptom:

- direct URL with another ID loads foreign data.

Root cause:

- ID treated as authorization proof,
- no tenant predicate,
- cache returns entity by ID.

Fix:

- query by tenant + ID,
- opaque IDs,
- tenant-aware cache,
- authorization check,
- DB constraints/RLS.

### Failure 3: ThreadLocal tenant leakage

Symptom:

- request after tenant A randomly runs as tenant A even for tenant B.

Root cause:

- ThreadLocal not cleared in pooled thread.

Fix:

- always clear in `finally`,
- test request sequence,
- framework interceptor,
- avoid static mutable global state.

### Failure 4: Async job loses tenant

Symptom:

- scheduler updates all tenants or no tenants.

Root cause:

- ThreadLocal does not propagate to executor thread,
- job has ambiguous scope.

Fix:

- explicit tenant loop,
- context propagation wrapper,
- fail-closed missing tenant,
- batch job scope declaration.

### Failure 5: Native query bypass

Symptom:

- normal ORM query safe, report/export leaks.

Root cause:

- native SQL lacks tenant predicate,
- provider filter not applied.

Fix:

- tenant SQL review checklist,
- DB RLS,
- repository wrapper,
- native query tests.

### Failure 6: Second-level cache leakage

Symptom:

- tenant B sees tenant A object only after tenant A accessed it first.

Root cause:

- cache key missing tenant,
- tenant-owned entity cached unsafely.

Fix:

- disable L2 for tenant-owned entities,
- tenant-aware cache key,
- test with same ID across tenants,
- separate cache region.

### Failure 7: Cross-tenant association

Symptom:

- task from tenant A appears under case tenant B,
- lazy association loads unexpected tenant data.

Root cause:

- FK not tenant-aware,
- application allowed wrong association assignment.

Fix:

- composite tenant-aware FK,
- domain invariant,
- association tests,
- data repair migration.

### Failure 8: Admin bypass too broad

Symptom:

- support/admin user accidentally exports all tenant data.

Root cause:

- disabling tenant filter means global access,
- no explicit selected tenant,
- report default scope is global.

Fix:

- delegated admin mode,
- explicit tenant selection,
- separate global permission,
- reason + audit,
- UI warning.

---

## 26. Design Patterns

### 26.1 Tenant-scoped service boundary

```java
public final class TenantScopedExecutor {
    public <T> T call(String tenantId, Supplier<T> work) {
        try {
            TenantContext.set(tenantId);
            return work.get();
        } finally {
            TenantContext.clear();
        }
    }
}
```

Use for:

- request binding,
- batch tenant loop,
- message consumer,
- report generator.

### 26.2 Tenant-aware repository facade

```java
public class CaseFileTenantRepository {
    private final CaseFileJpaRepository repository;

    public CaseFile getRequired(Long id) {
        return repository.findByTenantIdAndId(
            TenantContext.requireTenantId(),
            id
        ).orElseThrow(NotFoundException::new);
    }

    public Page<CaseFile> search(CaseSearchCriteria criteria, Pageable pageable) {
        return repository.search(
            TenantContext.requireTenantId(),
            criteria,
            pageable
        );
    }
}
```

The business layer never chooses tenant manually.

### 26.3 Fail-closed tenant resolver

```java
public String requireTenant(HttpServletRequest request) {
    AuthenticatedPrincipal principal = authentication.requirePrincipal();

    if (principal.tenants().isEmpty()) {
        throw new AccessDeniedException("No tenant membership");
    }

    if (principal.tenants().size() == 1) {
        return principal.tenants().getFirst();
    }

    String selectedTenant = request.getHeader("X-Selected-Tenant");
    if (!principal.tenants().contains(selectedTenant)) {
        throw new AccessDeniedException("Invalid tenant selection");
    }

    return selectedTenant;
}
```

Never default to all tenants.

### 26.4 Tenant-aware cache key

```java
public record TenantResourceKey(
    String tenantId,
    String resourceType,
    String resourceId
) {}
```

### 26.5 Tenant-aware event envelope

```java
public record TenantEvent<T>(
    String tenantId,
    String eventId,
    String eventType,
    Instant occurredAt,
    T payload
) {}
```

Consumer binds tenant before processing.

---

## 27. Anti-Patterns

### Anti-pattern 1: Tenant ID from request body

```json
{
  "tenantId": "agency-b",
  "caseId": 123
}
```

Request body is not trusted for tenant identity.

### Anti-pattern 2: Optional tenant predicate

```java
if (tenantId != null) {
    where.add(cb.equal(root.get("tenantId"), tenantId));
}
```

Missing tenant becomes global query.

### Anti-pattern 3: Global admin by disabling filter

```java
session.disableFilter("tenantFilter");
```

Without explicit audited scope, this is dangerous.

### Anti-pattern 4: Shared cache for tenant-owned mutable data

```java
@Cacheable
@Entity
public class CaseFile { ... }
```

Unless tenant-aware caching is proven, this is unsafe.

### Anti-pattern 5: Cross-tenant FK not structurally prevented

```sql
foreign key (case_file_id) references case_file(id)
```

In shared schema, this may be insufficient.

### Anti-pattern 6: One persistence context across tenant switch

Extended persistence context and tenant switching is a high-risk combination.

### Anti-pattern 7: Native report query with no tenant predicate

Report/export code often bypasses ORM protections.

### Anti-pattern 8: Soft delete as security

Soft delete hides normal rows. It does not enforce tenant isolation or authorization.

---

## 28. Java 8–25 Compatibility Notes

### Java 8

- Common with JPA 2.1/2.2 and Hibernate 5.x/EclipseLink 2.x.
- Uses `javax.persistence`.
- ThreadLocal request context common.
- No virtual threads or ScopedValue.
- More likely to have older provider limitations.

### Java 11

- Common migration baseline for Jakarta-era frameworks.
- EclipseLink 4.0 supports Java 11/17 context.
- Still often uses thread-per-request.

### Java 17

- Strong baseline for Spring Boot 3/Jakarta stacks.
- `jakarta.persistence` namespace common.
- Hibernate 6 widely used.

### Java 21

- Virtual threads available.
- Scoped values preview/modern context patterns may appear depending on exact JDK feature state.
- Be careful with ThreadLocal assumptions under high-concurrency virtual-thread usage.

### Java 25

- Treat as modern LTS target.
- Provider compatibility must be checked against actual Hibernate/EclipseLink version.
- Do not assume older bytecode enhancement/weaving works without verification.

General rule:

```text
Java version upgrade is not only JVM upgrade.
For ORM multi-tenancy, verify provider, bytecode enhancement, classloading, cache provider,
and framework transaction integration.
```

---

## 29. Hibernate vs EclipseLink Summary

| Area | Hibernate | EclipseLink |
|---|---|---|
| Spec baseline | JPA/Jakarta Persistence provider | JPA/Jakarta Persistence provider / RI history |
| Multi-tenancy style | DB/schema provider APIs, filters, tenant-id/discriminator support in modern versions | Strong provider-specific multitenancy annotations such as `@Multitenant`, tenant discriminator mechanisms |
| Filters | Hibernate `@Filter` and session-enabled filters | Different provider extension model; descriptors/session customization |
| Weaving/enhancement | Bytecode enhancement/proxies | Dynamic/static weaving and indirection |
| Cache | L2/query/natural ID cache with region provider | Shared cache/session cache model |
| Portability | Provider extensions common in real systems | Provider extensions common in real systems |
| Security boundary | Must be architected, not assumed | Must be architected, not assumed |

Do not choose provider based only on annotation familiarity. Choose based on:

- required isolation model,
- cache correctness,
- existing platform integration,
- migration path,
- team expertise,
- observability needs,
- provider behavior under your database.

---

## 30. Diagnostic Checklist

Before approving a multi-tenant ORM design, ask:

### Tenant resolution

- Is tenant resolved from trusted identity/session/gateway data?
- Is client-supplied tenant rejected or validated?
- Does missing tenant fail closed?
- Is tenant context cleared after request?
- Is tenant context propagated to async/message/batch paths?

### ORM access

- Are repository methods tenant-scoped?
- Are `findById` and `EntityManager.find` safe?
- Are lazy associations tenant-safe?
- Are entity graphs/fetch joins tenant-safe?
- Are bulk updates/deletes tenant-scoped?

### Native/reporting

- Do all native queries include tenant predicate or DB RLS?
- Do views/stored procedures enforce tenant context?
- Are report/export caches tenant-keyed?
- Are temporary files and object storage tenant-separated?

### Database

- Are unique constraints tenant-aware?
- Are foreign keys tenant-aware where needed?
- Are indexes designed for tenant predicates?
- Is DB RLS used where required?
- Are admin DB roles controlled?

### Cache

- Are tenant-owned entities cached?
- Are cache keys tenant-aware?
- Is query cache tenant-safe?
- Are application caches tenant-keyed?
- Are search indexes tenant-filtered?

### Admin/support

- Is admin mode explicit?
- Is selected tenant required?
- Is global mode separate and audited?
- Is reason/ticket captured?
- Is break-glass controlled?

### Testing

- Are there two-tenant fixtures?
- Are same-ID-across-tenant scenarios tested?
- Are native/bulk/report paths tested?
- Is cache leakage tested?
- Is missing tenant tested?

---

## 31. Practice Scenarios

### Scenario 1: Shared schema case management

You have:

```text
case_file(id, tenant_id, case_no, status)
case_task(id, tenant_id, case_file_id, assignee_id)
```

Question:

```text
How do you prevent task from tenant A referencing case from tenant B?
```

Expected answer:

- domain invariant,
- tenant-aware FK,
- tenant-scoped repository,
- integration test,
- migration check for existing invalid rows.

### Scenario 2: Support user can access multiple agencies

Bad design:

```text
Support role disables tenant filter.
```

Better design:

- support selects agency,
- session enters delegated tenant mode,
- every query still scoped to selected tenant,
- global access requires separate permission,
- audit captures reason.

### Scenario 3: Report export leaks data

Root cause:

- native SQL report query lacked tenant predicate,
- report cache key did not include tenant,
- generated file path was global.

Fix:

- tenant-aware SQL,
- report cache key includes tenant,
- file path includes tenant,
- DB RLS for defense-in-depth,
- regression test.

### Scenario 4: Cache returns wrong tenant object

Root cause:

- same local entity ID in two tenants,
- cache key did not include tenant,
- L2 cache enabled for tenant-owned entity.

Fix:

- disable cache for entity or tenant-aware cache key,
- test same-ID scenario,
- clear invalid cache,
- incident review.

### Scenario 5: Async notification wrong tenant

Root cause:

- event carried case ID but not tenant ID,
- consumer used default tenant context,
- notification template loaded from wrong tenant.

Fix:

- tenant-aware event envelope,
- consumer binds tenant explicitly,
- idempotency key includes tenant,
- template query tenant-scoped.

---

## 32. Design Rules

1. Treat tenant isolation as security boundary, not repository convenience.
2. Tenant context must come from trusted source.
3. Missing tenant context must fail closed.
4. Do not reuse persistence context across tenant scope changes.
5. Do not trust entity ID alone in shared schema.
6. Use tenant-aware unique constraints.
7. Use tenant-aware foreign keys where cross-tenant references are possible.
8. Native SQL must be explicitly tenant-scoped or protected by DB RLS.
9. Bulk update/delete must always declare tenant scope.
10. Cache keys must include tenant for tenant-owned data.
11. Search index documents and queries must include tenant.
12. Admin access must be explicit, scoped, and audited.
13. Async, scheduler, and message consumers must carry tenant context.
14. Test with at least two tenants and overlapping IDs.
15. Prefer database-enforced isolation when leakage impact is severe.

---

## 33. Summary

Multi-tenancy in ORM is not just adding `tenant_id` columns. It is a cross-cutting isolation contract spanning:

- identity resolution,
- request context,
- transaction boundary,
- ORM provider behavior,
- SQL generation,
- native query paths,
- database constraints,
- cache keys,
- association integrity,
- async jobs,
- report exports,
- audit trail,
- admin workflows,
- test strategy.

Hibernate and EclipseLink provide useful mechanisms, but neither removes the need for architectural discipline. Provider filters, tenant discriminators, and cache settings are tools. They are not automatically complete security boundaries.

For high-assurance systems, the safest mindset is:

```text
Every tenant-owned data access must prove its scope.
Every bypass must be explicit.
Every global operation must be rare, authorized, and audited.
Every cache/search/report path must be tenant-aware.
Every missing tenant context must fail closed.
```

The goal is not just to prevent obvious bugs. The goal is to make cross-tenant leakage structurally difficult, observable, testable, and defensible.

---

## 34. References

- Jakarta Persistence 3.2 Specification: https://jakarta.ee/specifications/persistence/3.2/
- Jakarta Persistence 3.2 Specification Document: https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2
- Hibernate ORM User Guide: https://docs.hibernate.org/stable/orm/userguide/html_single/
- Hibernate ORM Documentation: https://hibernate.org/orm/documentation/
- Hibernate ORM Releases: https://hibernate.org/orm/releases/
- Hibernate ORM 7 Introduction: https://docs.hibernate.org/orm/7.1/introduction/html_single/
- Hibernate `@Filter` Javadocs: https://docs.hibernate.org/orm/7.4/javadocs/org/hibernate/annotations/Filter.html
- EclipseLink Project: https://eclipse.dev/eclipselink/
- EclipseLink Documentation: https://eclipse.dev/eclipselink/documentation/
- EclipseLink JPA Extensions: https://eclipse.dev/eclipselink/documentation/4.0/jpa/extensions/jpa-extensions.html
- EclipseLink `@TenantDiscriminatorColumn`: https://eclipse.dev/eclipselink/documentation/2.5/jpa/extensions/a_tenantdiscriminatorcolumn.htm
- EclipseLink Table-Per-Tenant Multi-Tenancy: https://eclipse.dev/eclipselink/documentation/2.7/solutions/multitenancy003.htm

---

## Status Seri

Bagian ini adalah **Part 30 dari 34**.

Seri **belum selesai**.

Bagian berikutnya:

```text
31-testing-orm-correctness-beyond-repository-happy-path.md
```
