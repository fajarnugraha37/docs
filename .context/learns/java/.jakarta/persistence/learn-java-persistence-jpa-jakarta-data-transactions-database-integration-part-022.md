# Part 022 — Multi-Tenancy, Multi-Schema, Multi-Database, and Data Partitioning

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Part: `022 / 032`  
> Range Java: 8 sampai 25  
> Fokus: Jakarta/Javax Persistence, Hibernate ORM, Spring Data JPA, Jakarta Data, Jakarta Transactions, dan integrasi database production-grade

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **multi-tenancy**, **multi-schema**, **multi-database**, **partitioning**, **sharding**, dan **data isolation**.
2. Memilih strategi tenant isolation yang tepat berdasarkan risiko bisnis, regulasi, biaya operasional, performa, dan kompleksitas migration.
3. Mendesain persistence layer yang mencegah **tenant data leakage**.
4. Memahami opsi multi-tenancy di Hibernate/JPA ecosystem:
   - discriminator/partitioned data,
   - schema per tenant,
   - database per tenant,
   - hybrid strategy.
5. Mendesain tenant resolution, tenant context propagation, connection routing, dan transaction boundary secara aman.
6. Menghindari jebakan umum seperti:
   - lupa tenant predicate,
   - tenant context bocor antar thread,
   - cache key tidak tenant-aware,
   - schema migration tidak seragam,
   - query reporting cross-tenant yang tidak terkontrol,
   - tenant filter bypass oleh native SQL/bulk query.
7. Memahami hubungan antara multi-tenancy dan:
   - authorization,
   - indexing,
   - caching,
   - audit trail,
   - outbox/inbox,
   - testing,
   - observability,
   - incident response.

---

## 2. Mental Model: Multi-Tenancy Bukan Sekadar `tenant_id`

Multi-tenancy sering disederhanakan menjadi:

```text
Tambahkan kolom tenant_id di semua tabel.
```

Itu bisa benar untuk sistem sederhana, tetapi untuk sistem enterprise atau regulatory, mental model tersebut terlalu dangkal.

Multi-tenancy sebenarnya adalah desain tentang **siapa boleh melihat/mengubah data apa, melalui boundary apa, dengan bukti apa, dan jika terjadi bug, seberapa luas dampaknya**.

Model yang lebih tepat:

```text
Multi-tenancy = data isolation + execution isolation + operational isolation + security isolation + governance isolation
```

Artinya, kita perlu berpikir dalam beberapa lapisan:

```text
Request
  -> Authentication identity
  -> Authorization scope
  -> Tenant resolution
  -> Tenant context
  -> Repository/query predicate
  -> Connection/schema/database routing
  -> Transaction boundary
  -> Cache key
  -> Audit context
  -> Outbox/event context
  -> Observability context
```

Jika satu lapisan lupa tenant awareness, tenant leakage bisa terjadi.

Contoh kecil:

```java
List<Application> findByStatus(ApplicationStatus status);
```

Di sistem single-tenant, method ini mungkin aman.

Di sistem multi-tenant discriminator, method ini berbahaya jika tidak otomatis menambahkan:

```sql
where tenant_id = ?
```

Tetapi masalahnya bukan hanya query. Perhatikan juga:

```java
@Cacheable("applicationSummary")
public ApplicationSummary getSummary(Long applicationId) { ... }
```

Jika cache key hanya `applicationId`, tenant A bisa menerima data tenant B ketika id sama atau endpoint salah authorize.

Key yang lebih aman:

```text
applicationSummary::{tenantId}::{applicationId}
```

Multi-tenancy harus dianggap sebagai **invariant global**, bukan fitur lokal di repository.

---

## 3. Terminologi Dasar

### 3.1 Tenant

Tenant adalah boundary logis kepemilikan/akses data.

Contoh tenant:

- company/customer dalam SaaS,
- agency dalam government platform,
- branch/regional office,
- organization unit,
- marketplace seller,
- school/university,
- jurisdiction,
- business domain yang perlu isolation.

Tenant tidak selalu sama dengan user role. Satu user bisa memiliki akses ke banyak tenant.

Contoh:

```text
User: regional-admin@example.com
Tenants: AGENCY_A, AGENCY_B, AGENCY_C
Role: REGIONAL_ADMIN
```

Maka tenant resolution tidak bisa hanya dari user id. Harus jelas tenant aktif dalam request.

---

### 3.2 Multi-Tenancy

Multi-tenancy adalah arsitektur di mana satu aplikasi atau platform melayani banyak tenant dengan bentuk isolasi tertentu.

Ada beberapa tingkat isolasi:

```text
Shared application + shared database + shared schema
Shared application + shared database + separate schema
Shared application + separate database per tenant
Separate application deployment + separate database
Hybrid
```

---

### 3.3 Multi-Schema

Multi-schema berarti satu database instance memiliki banyak schema, biasanya satu schema per tenant.

```text
Database: aceas_prod
  Schema: agency_a
  Schema: agency_b
  Schema: agency_c
```

Aplikasi memilih schema berdasarkan tenant context.

---

### 3.4 Multi-Database

Multi-database berarti tenant dipisah ke database berbeda.

```text
Tenant A -> jdbc:postgresql://db-a/prod
Tenant B -> jdbc:postgresql://db-b/prod
Tenant C -> jdbc:postgresql://db-c/prod
```

Database bisa berada pada instance/server yang sama atau berbeda.

---

### 3.5 Partitioning

Partitioning adalah pemecahan data secara fisik/logis di dalam database untuk performa/operability.

Contoh:

```text
application table partitioned by created_year
application table partitioned by agency_id
application table partitioned by hash(application_id)
```

Partitioning bukan selalu multi-tenancy. Bisa digunakan untuk data lifecycle, archival, atau query pruning.

---

### 3.6 Sharding

Sharding adalah membagi data ke beberapa database/node berdasarkan shard key.

```text
agency_id 1..100   -> shard_01
agency_id 101..200 -> shard_02
agency_id 201..300 -> shard_03
```

Sharding adalah bentuk horizontal scale yang jauh lebih kompleks daripada partitioning biasa.

---

### 3.7 Data Isolation vs Execution Isolation

Data isolation menjawab:

```text
Apakah data tenant A bisa tercampur dengan tenant B?
```

Execution isolation menjawab:

```text
Apakah workload tenant A bisa mengganggu tenant B?
```

Contoh:

- Shared schema dengan `tenant_id` memiliki data isolation logis, tetapi execution isolation rendah.
- Database per tenant memiliki data isolation tinggi dan execution isolation lebih baik.
- Separate deployment per tenant memiliki isolation tertinggi tetapi biaya paling besar.

---

## 4. Strategi Utama Multi-Tenancy

Ada tiga strategi fundamental.

```text
1. Discriminator / shared schema / tenant_id column
2. Schema per tenant
3. Database per tenant
```

Hibernate documentation juga mengenali pendekatan separate database, separate schema, dan partitioned/discriminator data sebagai pendekatan utama multi-tenancy.

---

## 5. Strategy 1 — Shared Schema dengan `tenant_id` / Discriminator

### 5.1 Bentuk Schema

```sql
create table application (
    id bigint primary key,
    tenant_id varchar(64) not null,
    application_no varchar(64) not null,
    status varchar(32) not null,
    created_at timestamp not null,
    constraint uq_application_tenant_no unique (tenant_id, application_no)
);

create index idx_application_tenant_status
    on application (tenant_id, status);
```

Semua tenant tinggal di tabel yang sama, dibedakan oleh `tenant_id`.

---

### 5.2 Kelebihan

Shared schema cocok ketika:

- jumlah tenant besar,
- tenant kecil-kecil,
- biaya database harus rendah,
- schema semua tenant sama,
- reporting cross-tenant sering dibutuhkan,
- deployment harus sederhana,
- onboarding tenant harus cepat,
- operational team kecil.

Kelebihan:

```text
+ Satu schema mudah dimigrasikan
+ Satu connection pool
+ Satu deployment path
+ Cross-tenant reporting relatif mudah
+ Resource utilization efisien
+ Tenant onboarding cepat
+ Cocok untuk SaaS dengan banyak tenant kecil
```

---

### 5.3 Kekurangan

Risiko utama:

```text
- Tenant leakage jika query lupa tenant predicate
- Unique constraint harus tenant-scoped
- Index harus tenant-aware
- Cache key harus tenant-aware
- Native SQL/bulk query mudah bypass filter
- Tenant besar bisa mengganggu tenant kecil
- Backup/restore per tenant sulit
- Data residency per tenant sulit
- Delete/export tenant data sulit jika relasi kompleks
- Security boundary lebih bergantung pada aplikasi
```

---

### 5.4 Entity Mapping Sederhana

```java
@Entity
@Table(
    name = "application",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uq_application_tenant_no",
            columnNames = {"tenant_id", "application_no"}
        )
    },
    indexes = {
        @Index(name = "idx_application_tenant_status", columnList = "tenant_id, status")
    }
)
public class Application {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "application_seq")
    @SequenceGenerator(name = "application_seq", sequenceName = "application_seq", allocationSize = 50)
    private Long id;

    @Column(name = "tenant_id", nullable = false, length = 64, updatable = false)
    private String tenantId;

    @Column(name = "application_no", nullable = false, length = 64)
    private String applicationNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private ApplicationStatus status;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    protected Application() {
    }

    public Application(String tenantId, String applicationNo) {
        this.tenantId = requireTenantId(tenantId);
        this.applicationNo = requireApplicationNo(applicationNo);
        this.status = ApplicationStatus.DRAFT;
    }

    private static String requireTenantId(String tenantId) {
        if (tenantId == null || tenantId.isBlank()) {
            throw new IllegalArgumentException("tenantId is required");
        }
        return tenantId;
    }

    private static String requireApplicationNo(String applicationNo) {
        if (applicationNo == null || applicationNo.isBlank()) {
            throw new IllegalArgumentException("applicationNo is required");
        }
        return applicationNo;
    }
}
```

Hal penting:

```text
unique(application_no)                  SALAH
unique(tenant_id, application_no)       BENAR
index(status)                           sering kurang efektif
index(tenant_id, status)                lebih benar untuk tenant-scoped query
```

---

### 5.5 Repository Harus Tenant-Scoped

Buruk:

```java
Optional<Application> findByApplicationNo(String applicationNo);
```

Lebih aman:

```java
Optional<Application> findByTenantIdAndApplicationNo(String tenantId, String applicationNo);
```

Tetapi untuk codebase besar, mengulang `tenantId` di semua method rawan lupa.

Bisa dibuat tenant-aware repository wrapper:

```java
public final class TenantScopedApplicationRepository {

    private final ApplicationJpaRepository delegate;
    private final TenantContext tenantContext;

    public TenantScopedApplicationRepository(
            ApplicationJpaRepository delegate,
            TenantContext tenantContext
    ) {
        this.delegate = delegate;
        this.tenantContext = tenantContext;
    }

    public Optional<Application> findByApplicationNo(String applicationNo) {
        return delegate.findByTenantIdAndApplicationNo(
            tenantContext.requiredTenantId(),
            applicationNo
        );
    }

    public Page<ApplicationSummary> search(ApplicationSearchCriteria criteria, Pageable pageable) {
        return delegate.search(
            tenantContext.requiredTenantId(),
            criteria.status(),
            criteria.createdFrom(),
            criteria.createdTo(),
            pageable
        );
    }
}
```

Aplikasi layer tidak perlu mengingat predicate tenant di setiap query.

---

## 6. Tenant Context

### 6.1 Apa Itu Tenant Context?

Tenant context adalah informasi tenant aktif untuk eksekusi saat ini.

```java
public record TenantContextValue(
    String tenantId,
    String actorUserId,
    Set<String> roles,
    String requestId
) {
    public TenantContextValue {
        if (tenantId == null || tenantId.isBlank()) {
            throw new IllegalArgumentException("tenantId is required");
        }
    }
}
```

Tenant context biasanya berasal dari:

- token claim,
- session,
- request header yang sudah diverifikasi,
- path parameter,
- selected tenant in UI,
- message metadata,
- batch job parameter,
- scheduler config.

---

### 6.2 Jangan Percaya Header Mentah

Buruk:

```http
X-Tenant-Id: agency-a
```

lalu aplikasi langsung percaya.

Lebih aman:

```text
1. Authenticate user/token.
2. Ambil tenant yang user boleh akses dari claim/session/authorization service.
3. Jika request memilih tenant, validasi tenant tersebut ada dalam allowed tenants.
4. Set TenantContext dari hasil validasi, bukan dari input mentah.
```

Contoh:

```java
public TenantContextValue resolve(HttpServletRequest request, AuthenticatedUser user) {
    String requestedTenant = request.getHeader("X-Tenant-Id");

    if (requestedTenant == null || requestedTenant.isBlank()) {
        throw new MissingTenantException();
    }

    if (!user.allowedTenantIds().contains(requestedTenant)) {
        throw new ForbiddenTenantException(requestedTenant);
    }

    return new TenantContextValue(
        requestedTenant,
        user.userId(),
        user.roles(),
        request.getHeader("X-Request-Id")
    );
}
```

---

### 6.3 ThreadLocal Tenant Context

Di aplikasi servlet tradisional, TenantContext sering disimpan di `ThreadLocal` selama request.

```java
public final class TenantContextHolder {

    private static final ThreadLocal<TenantContextValue> CURRENT = new ThreadLocal<>();

    private TenantContextHolder() {
    }

    public static void set(TenantContextValue context) {
        CURRENT.set(Objects.requireNonNull(context));
    }

    public static TenantContextValue required() {
        TenantContextValue context = CURRENT.get();
        if (context == null) {
            throw new IllegalStateException("Tenant context is not set");
        }
        return context;
    }

    public static String requiredTenantId() {
        return required().tenantId();
    }

    public static void clear() {
        CURRENT.remove();
    }
}
```

Filter harus selalu clear di `finally`:

```java
public final class TenantContextFilter extends OncePerRequestFilter {

    private final TenantContextResolver resolver;

    public TenantContextFilter(TenantContextResolver resolver) {
        this.resolver = resolver;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        try {
            TenantContextHolder.set(resolver.resolve(request));
            filterChain.doFilter(request, response);
        } finally {
            TenantContextHolder.clear();
        }
    }
}
```

Tanpa `clear()`, tenant context bisa bocor ke request berikutnya pada thread pool.

---

### 6.4 Tenant Context dan Virtual Threads

Pada Java modern, virtual threads membuat request-per-thread murah, tetapi tidak otomatis menyelesaikan semua masalah context propagation.

Hal yang tetap harus diperhatikan:

- `ThreadLocal` pada virtual thread tetap bisa dipakai, tetapi harus tetap clear.
- Jangan bergantung pada inherited thread local tanpa kontrol.
- Untuk async task, message listener, scheduled job, tenant context harus dipasang eksplisit.
- Structured concurrency/scoped value dapat menjadi model yang lebih aman pada Java modern, tetapi integrasi framework perlu dievaluasi.

Prinsipnya:

```text
Tenant context harus eksplisit di boundary asynchronous.
```

---

## 7. Tenant-Aware Query Filter

### 7.1 Manual Predicate

Paling eksplisit:

```java
@Query("""
    select a
    from Application a
    where a.tenantId = :tenantId
      and a.status = :status
    order by a.createdAt desc
""")
Page<Application> findByTenantAndStatus(
    @Param("tenantId") String tenantId,
    @Param("status") ApplicationStatus status,
    Pageable pageable
);
```

Kelebihan:

```text
+ Sangat jelas
+ Mudah review SQL/JPQL
+ Tidak magic
+ Native SQL juga bisa dikontrol
```

Kekurangan:

```text
- Mudah lupa di method baru
- Banyak boilerplate
- Cross-cutting concern tersebar
```

---

### 7.2 Base Entity dengan Tenant Field

```java
@MappedSuperclass
public abstract class TenantScopedEntity {

    @Column(name = "tenant_id", nullable = false, updatable = false, length = 64)
    private String tenantId;

    protected TenantScopedEntity() {
    }

    protected TenantScopedEntity(String tenantId) {
        this.tenantId = tenantId;
    }

    public String tenantId() {
        return tenantId;
    }
}
```

Ini membantu konsistensi field, tetapi tidak otomatis menambahkan predicate ke semua query.

---

### 7.3 Hibernate Filter

Hibernate memiliki filter provider-specific.

```java
@FilterDef(
    name = "tenantFilter",
    parameters = @ParamDef(name = "tenantId", type = String.class)
)
@Filter(
    name = "tenantFilter",
    condition = "tenant_id = :tenantId"
)
@MappedSuperclass
public abstract class TenantScopedEntity {

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private String tenantId;
}
```

Enable filter per session:

```java
@Component
public class TenantFilterEnabler {

    @PersistenceContext
    private EntityManager entityManager;

    public void enable() {
        Session session = entityManager.unwrap(Session.class);
        session.enableFilter("tenantFilter")
            .setParameter("tenantId", TenantContextHolder.requiredTenantId());
    }
}
```

Risiko:

```text
- Filter harus di-enable pada session yang benar
- Native SQL bisa bypass
- Bulk update/delete bisa bypass/berperilaku beda
- Admin cross-tenant query perlu disable/filter khusus
- Salah konfigurasi bisa silent leakage
```

Filter bisa membantu, tetapi tidak boleh menjadi satu-satunya kontrol keamanan tanpa test dan guard lain.

---

### 7.4 Database Row-Level Security

Database tertentu seperti PostgreSQL mendukung Row-Level Security.

Konsep:

```sql
alter table application enable row level security;

create policy application_tenant_policy on application
using (tenant_id = current_setting('app.tenant_id'));
```

Aplikasi set session variable:

```sql
set app.tenant_id = 'agency-a';
```

Kelebihan:

```text
+ Proteksi di database, bukan hanya aplikasi
+ Query yang lupa tenant predicate tetap bisa dibatasi
+ Cocok untuk defense-in-depth
```

Kekurangan:

```text
- Database-specific
- Perlu disiplin connection/session variable
- Connection pool harus reset variable
- Debugging lebih kompleks
- Migration/test lebih rumit
```

Untuk sistem high-risk, RLS bisa menjadi lapisan tambahan yang sangat kuat.

---

## 8. Strategy 2 — Schema per Tenant

### 8.1 Bentuk Schema

```text
Database: case_management_prod

schema agency_a:
  application
  case_file
  audit_trail

schema agency_b:
  application
  case_file
  audit_trail

schema agency_c:
  application
  case_file
  audit_trail
```

Setiap tenant punya struktur tabel sama, tetapi schema berbeda.

---

### 8.2 Kelebihan

```text
+ Data isolation lebih kuat daripada shared schema
+ Query tidak selalu perlu tenant_id predicate
+ Backup/export per tenant lebih mudah daripada shared schema
+ Restore tenant tertentu lebih feasible
+ Privilege bisa schema-scoped
+ Noisy tenant bisa lebih mudah dianalisis
+ Constraint/index lebih sederhana per tenant
```

---

### 8.3 Kekurangan

```text
- Migration harus dijalankan ke semua schema tenant
- Jumlah schema besar dapat menyulitkan operasi
- Cross-tenant reporting lebih sulit
- Connection/schema routing lebih kompleks
- Schema drift antar tenant bisa terjadi
- Onboarding tenant perlu create schema + run migration
- Monitoring per tenant lebih kompleks
```

---

### 8.4 Hibernate Schema-Based Multi-Tenancy

Secara umum, schema-based multi-tenancy membutuhkan:

1. Tenant identifier resolver.
2. Multi-tenant connection provider.
3. Cara mengatur schema untuk connection yang dipakai.

Pseudo-code konseptual:

```java
public final class CurrentTenantIdentifierResolverImpl
        implements CurrentTenantIdentifierResolver<String> {

    @Override
    public String resolveCurrentTenantIdentifier() {
        return TenantContextHolder.requiredTenantId();
    }

    @Override
    public boolean validateExistingCurrentSessions() {
        return true;
    }
}
```

Connection provider concept:

```java
public final class SchemaPerTenantConnectionProvider
        implements MultiTenantConnectionProvider<String> {

    private final DataSource dataSource;
    private final TenantSchemaRegistry schemaRegistry;

    public SchemaPerTenantConnectionProvider(
            DataSource dataSource,
            TenantSchemaRegistry schemaRegistry
    ) {
        this.dataSource = dataSource;
        this.schemaRegistry = schemaRegistry;
    }

    @Override
    public Connection getConnection(String tenantIdentifier) throws SQLException {
        Connection connection = dataSource.getConnection();
        String schema = schemaRegistry.schemaForTenant(tenantIdentifier);
        connection.setSchema(schema);
        return connection;
    }

    @Override
    public void releaseConnection(String tenantIdentifier, Connection connection) throws SQLException {
        try {
            connection.setSchema(schemaRegistry.defaultSchema());
        } finally {
            connection.close();
        }
    }

    // Other required methods omitted for brevity.
}
```

Hal penting:

```text
Connection dari pool harus dikembalikan ke default schema saat release.
```

Jika tidak, connection bisa dipakai tenant lain dengan schema tenant sebelumnya.

---

### 8.5 Search Path / Current Schema Risk

Database berbeda punya mekanisme berbeda:

- PostgreSQL: `search_path` / `set schema` / `Connection#setSchema`
- Oracle: current schema bisa diubah dengan `ALTER SESSION SET CURRENT_SCHEMA = ...`
- SQL Server: schema usually part of object naming; default schema per user
- MySQL: database/catalog selection via `USE database`

Risiko:

```text
- Session state tidak direset oleh pool
- Migration tool menggunakan schema salah
- Native SQL hardcode schema
- Stored procedure mengakses schema tetap
- Search path injection jika nama schema dari input tidak divalidasi
```

Tenant-to-schema mapping harus berasal dari registry yang aman, bukan langsung dari input.

Buruk:

```java
connection.createStatement().execute("alter session set current_schema = " + tenantId);
```

Aman secara konsep:

```java
String schema = tenantSchemaRegistry.schemaForTenant(tenantId);
if (!schema.matches("[A-Z0-9_]+")) {
    throw new IllegalStateException("Invalid schema name in registry");
}
connection.createStatement().execute("alter session set current_schema = " + schema);
```

Lebih baik lagi: schema name tidak pernah berasal dari request, hanya dari table registry.

---

## 9. Strategy 3 — Database per Tenant

### 9.1 Bentuk Arsitektur

```text
Tenant A -> db-agency-a
Tenant B -> db-agency-b
Tenant C -> db-agency-c
```

Bisa satu aplikasi shared yang memilih `DataSource` berdasarkan tenant.

---

### 9.2 Kelebihan

```text
+ Data isolation paling kuat di antara shared app strategies
+ Backup/restore per tenant lebih mudah
+ Per-tenant scaling lebih mudah
+ Noisy tenant lebih mudah dipisah
+ Compliance/data residency lebih mudah
+ Maintenance window bisa tenant-specific
+ Encryption key/credential bisa tenant-specific
```

---

### 9.3 Kekurangan

```text
- Banyak DataSource/connection pool
- Migration harus multi-database
- Cross-tenant reporting sulit
- Tenant onboarding mahal
- Operational overhead tinggi
- Connection explosion jika tenant banyak
- Version drift lebih mungkin
- Deployment rollback lebih kompleks
```

---

### 9.4 DataSource Routing

Spring-style conceptual routing:

```java
public final class TenantRoutingDataSource extends AbstractRoutingDataSource {

    @Override
    protected Object determineCurrentLookupKey() {
        return TenantContextHolder.requiredTenantId();
    }
}
```

Tetapi ini hanya aman jika:

```text
- TenantContext sudah valid sebelum transaction dimulai
- Transaction tidak berpindah tenant di tengah eksekusi
- Routing key stabil sepanjang transaction
- Async/message boundary set TenantContext eksplisit
- DataSource registry tidak menerima arbitrary tenant id
```

---

### 9.5 Transaction Boundary dengan Database per Tenant

Dalam satu transaction lokal, umumnya hanya satu database tenant yang dipakai.

Buruk:

```java
@Transactional
public void moveCase(String sourceTenant, String targetTenant, Long caseId) {
    TenantContextHolder.set(sourceTenant);
    CaseFile source = caseRepository.findById(caseId).orElseThrow();

    TenantContextHolder.set(targetTenant);
    caseRepository.save(source.copyToTargetTenant());
}
```

Masalah:

- transaction mungkin sudah bind connection ke tenant pertama,
- persistence context bisa berisi entity dari tenant berbeda,
- correctness tidak jelas,
- rollback semantics lintas database tidak aman tanpa distributed transaction.

Lebih baik:

```text
1. Export source case dalam transaction tenant source.
2. Tulis transfer request/outbox.
3. Import ke tenant target dalam transaction tenant target.
4. Gunakan idempotency key.
5. Audit kedua sisi.
```

---

## 10. Hybrid Multi-Tenancy

Di sistem nyata, sering kali strategi hybrid lebih masuk akal.

Contoh:

```text
Small tenants  -> shared schema dengan tenant_id
Large tenants  -> dedicated schema
Premium tenant -> dedicated database
Regulated tenant -> dedicated database/region
Archived data -> partitioned historical store
```

Hybrid memungkinkan optimasi biaya dan isolation.

Tetapi hybrid juga membuat application logic lebih kompleks.

Butuh registry:

```sql
create table tenant_registry (
    tenant_id varchar(64) primary key,
    isolation_strategy varchar(32) not null,
    datasource_key varchar(128),
    schema_name varchar(128),
    status varchar(32) not null,
    created_at timestamp not null
);
```

Contoh Java model:

```java
public enum TenantIsolationStrategy {
    SHARED_SCHEMA,
    SCHEMA_PER_TENANT,
    DATABASE_PER_TENANT
}

public record TenantRoutingInfo(
    String tenantId,
    TenantIsolationStrategy strategy,
    String dataSourceKey,
    String schemaName
) {
}
```

Semua routing harus melalui registry ini.

---

## 11. Tenant Registry

Tenant registry adalah source of truth untuk metadata tenant.

Isi minimal:

```text
tenant_id
status: ACTIVE/SUSPENDED/DELETED/MIGRATING
isolation_strategy
datasource_key
schema_name
region
plan/tier
created_at
updated_at
migration_version
feature flags
retention policy
encryption key reference
```

Contoh:

```sql
create table tenant_registry (
    tenant_id varchar(64) primary key,
    display_name varchar(255) not null,
    status varchar(32) not null,
    isolation_strategy varchar(32) not null,
    datasource_key varchar(128),
    schema_name varchar(128),
    region varchar(64),
    migration_version varchar(64),
    created_at timestamp not null,
    updated_at timestamp not null
);
```

Tenant registry tidak boleh dicampur sembarangan dengan tenant data biasa.

Pilihan storage:

```text
- control database terpisah
- schema management khusus
- configuration service
- secure parameter store untuk credential
```

---

## 12. Tenant Lifecycle

Multi-tenancy bukan hanya query. Tenant punya lifecycle.

```text
PROVISIONING
  -> ACTIVE
  -> SUSPENDED
  -> MIGRATING
  -> ARCHIVING
  -> DELETED
```

### 12.1 Provisioning

Untuk shared schema:

```text
1. Insert tenant registry.
2. Create default tenant configuration rows.
3. Create admin user mapping.
4. Initialize feature flags.
5. Emit tenant-created event.
```

Untuk schema per tenant:

```text
1. Create schema.
2. Run migration to latest version.
3. Seed reference data.
4. Register tenant routing.
5. Smoke test tenant schema.
6. Activate tenant.
```

Untuk database per tenant:

```text
1. Create database or clone template.
2. Create users/credentials.
3. Run migration.
4. Configure connection secret.
5. Register DataSource key.
6. Smoke test.
7. Activate tenant.
```

---

### 12.2 Suspension

Tenant suspended berarti user tidak boleh melakukan operasi tertentu.

Tetapi biasanya masih boleh:

- login admin,
- export data,
- pay invoice,
- read-only access,
- system archival job.

Jangan hanya menghapus tenant routing.

Lebih baik:

```java
public void assertTenantWritable(String tenantId) {
    TenantMetadata tenant = tenantRegistry.get(tenantId);
    if (tenant.status() != TenantStatus.ACTIVE) {
        throw new TenantNotWritableException(tenantId, tenant.status());
    }
}
```

---

### 12.3 Deletion

Tenant deletion sulit karena:

- audit retention,
- legal hold,
- backup retention,
- outbox/event history,
- cross-tenant references,
- reporting snapshots,
- object storage/file attachments,
- search index/cache.

Untuk regulatory system, deletion sering berarti:

```text
Disable access + archive + retain audit according to policy
```

bukan hard delete penuh.

---

## 13. Multi-Tenancy dan Authorization

Tenant isolation tidak sama dengan authorization.

Tenant predicate menjawab:

```text
Apakah data ini milik tenant aktif?
```

Authorization menjawab:

```text
Apakah actor ini boleh melakukan action pada resource ini?
```

Contoh:

```java
public ApplicationDetail getDetail(String applicationNo) {
    Application application = applicationRepository
        .findByTenantIdAndApplicationNo(currentTenantId(), applicationNo)
        .orElseThrow(NotFoundException::new);

    authorizationService.assertCanView(application);

    return mapper.toDetail(application);
}
```

Urutan aman:

```text
1. Tenant-scoped load
2. Resource-specific authorization
3. Return data
```

Jangan return `403` untuk resource yang berada di tenant lain jika itu membocorkan existence.

Banyak sistem memilih:

```text
Tenant mismatch -> 404 Not Found
Same tenant but insufficient permission -> 403 Forbidden
```

---

## 14. Multi-Tenancy dan Primary Key Design

Ada dua model umum.

### 14.1 Global ID

```text
application.id unique global
```

Kelebihan:

```text
+ Simpler references
+ Easier outbox/event correlation
+ Easier cross-tenant admin tooling
```

Kekurangan:

```text
- ID bisa reveal global scale jika sequential exposed
- Still need tenant check
```

---

### 14.2 Tenant-Scoped ID

```text
(tenant_id, local_id) sebagai identity logis
```

Kelebihan:

```text
+ Natural untuk tenant-local numbering
+ Bisa menghindari global sequence bottleneck
+ Cocok untuk schema/database per tenant
```

Kekurangan:

```text
- Foreign key lebih lebar
- Application reference harus selalu membawa tenant_id
- Cross-tenant tooling lebih rumit
```

Praktisnya, banyak sistem memakai:

```text
internal global surrogate id
+ tenant_id
+ tenant-scoped business number
+ public opaque id jika expose ke client
```

Contoh:

```sql
id bigint primary key,
tenant_id varchar(64) not null,
application_no varchar(64) not null,
public_id uuid not null,
unique(tenant_id, application_no),
unique(public_id)
```

---

## 15. Multi-Tenancy dan Foreign Key

Dalam shared schema, foreign key harus menjaga tenant consistency.

Buruk:

```sql
create table case_file (
    id bigint primary key,
    tenant_id varchar(64) not null,
    application_id bigint not null references application(id)
);
```

Masalah:

```text
case_file.tenant_id = A bisa refer application.id milik tenant B
```

Solusi lebih kuat:

```sql
create table application (
    id bigint not null,
    tenant_id varchar(64) not null,
    application_no varchar(64) not null,
    primary key (id),
    unique (tenant_id, id),
    unique (tenant_id, application_no)
);

create table case_file (
    id bigint primary key,
    tenant_id varchar(64) not null,
    application_id bigint not null,
    constraint fk_case_application_same_tenant
        foreign key (tenant_id, application_id)
        references application (tenant_id, id)
);
```

Ini membuat tenant mismatch mustahil di level database.

Trade-off:

```text
+ Stronger correctness
- More complex FK/index
- Wider child table indexes
```

Untuk sistem high-risk, composite FK tenant-aware sangat layak dipertimbangkan.

---

## 16. Multi-Tenancy dan Index Design

Shared schema hampir selalu membutuhkan tenant-first indexes.

Contoh query:

```sql
select *
from application
where tenant_id = ?
  and status = ?
order by created_at desc
fetch first 50 rows only;
```

Index:

```sql
create index idx_application_tenant_status_created
    on application (tenant_id, status, created_at desc);
```

Namun urutan column harus mengikuti query pattern.

Jika tenant kecil banyak:

```text
tenant_id leading column biasanya baik
```

Jika satu tenant sangat besar dan query mostly by status/time:

```text
mungkin perlu composite/index tambahan atau partitioning
```

Checklist:

```text
- Semua unique business key tenant-scoped?
- Semua list query punya tenant leading predicate?
- Semua FK join query punya index tenant-aware?
- Cross-tenant admin query punya index terpisah?
- Soft delete included in unique/index strategy?
- Time-range query punya composite index benar?
```

---

## 17. Multi-Tenancy dan Partitioning

Partitioning dapat digunakan bersama multi-tenancy.

### 17.1 Partition by Tenant

```text
application partitioned by tenant_id
```

Kelebihan:

```text
+ Query tenant-scoped bisa partition prune
+ Drop/archive tenant lebih mudah
```

Kekurangan:

```text
- Tenant banyak bisa membuat partition terlalu banyak
- Tenant size imbalance
- DDL partition management kompleks
```

---

### 17.2 Partition by Time

```text
application partitioned by created_year / created_month
```

Kelebihan:

```text
+ Archival mudah
+ Time-range reporting efisien
+ Retention policy mudah
```

Kekurangan:

```text
- Tenant query tetap perlu index tenant_id
- Recent partition bisa hot
```

---

### 17.3 Composite Partition

Contoh:

```text
range(created_month) + hash(tenant_id)
```

Ini powerful, tapi sangat database-specific.

Prinsip:

```text
Partitioning dipilih berdasarkan lifecycle dan dominant query pattern, bukan karena terlihat advanced.
```

---

## 18. Multi-Tenancy dan Sharding

Sharding diperlukan ketika satu database tidak cukup secara kapasitas/throughput/operability.

Shard key umum:

```text
tenant_id
organization_id
account_id
region + tenant_id
```

Keputusan shard key sangat sulit diubah.

Masalah sharding:

```text
- Cross-shard transaction sulit
- Cross-shard query mahal
- Rebalancing tenant sulit
- Global unique constraint sulit
- Global ordering sulit
- Reporting harus data warehouse/search system
- Operational complexity tinggi
```

Shard-aware routing:

```java
public record TenantShardInfo(
    String tenantId,
    String shardId,
    String dataSourceKey
) {
}
```

Prinsip:

```text
Shard hanya ketika problem nyata sudah tidak bisa diselesaikan oleh index, partitioning, read replica, scaling vertical, archival, atau workload isolation yang lebih sederhana.
```

---

## 19. Multi-Tenancy dan Cache

Cache adalah salah satu sumber tenant leakage paling umum.

Buruk:

```java
@Cacheable(cacheNames = "application", key = "#applicationId")
public ApplicationDetail getDetail(Long applicationId) { ... }
```

Aman:

```java
@Cacheable(
    cacheNames = "application",
    key = "T(com.example.TenantContextHolder).requiredTenantId() + ':' + #applicationId"
)
public ApplicationDetail getDetail(Long applicationId) { ... }
```

Lebih eksplisit:

```java
public record TenantCacheKey(
    String tenantId,
    String resourceType,
    String resourceId
) {
}
```

Cache key harus mencakup:

```text
- tenant id
- actor/role/scope jika data authorization-dependent
- locale jika localized
- filter/sort/page jika listing
- version jika schema/value berubah
```

Second-level cache juga perlu tenant awareness. Jangan aktifkan cache entity multi-tenant tanpa memahami provider behavior.

---

## 20. Multi-Tenancy dan Query Cache

Query cache sangat riskan.

Query:

```sql
select application where status = APPROVED
```

Jika cache key tidak mencakup tenant, hasil tenant A bisa dipakai tenant B.

Selain itu query cache invalidation pada shared table bisa menyebabkan invalidation luas.

Rule praktis:

```text
Untuk multi-tenant high-risk system, hindari query cache kecuali benar-benar dipahami, diukur, dan ditest tenant isolation-nya.
```

Gunakan cache eksplisit untuk read model yang jelas key-nya.

---

## 21. Multi-Tenancy dan Audit Trail

Audit harus tenant-aware.

Minimal:

```sql
create table audit_trail (
    id bigint primary key,
    tenant_id varchar(64) not null,
    actor_user_id varchar(128) not null,
    action varchar(128) not null,
    resource_type varchar(128) not null,
    resource_id varchar(128) not null,
    before_json clob,
    after_json clob,
    request_id varchar(128),
    created_at timestamp not null
);

create index idx_audit_tenant_created
    on audit_trail (tenant_id, created_at desc);
```

Audit harus menjawab:

```text
Who did what, to which tenant/resource, when, from where, and why?
```

Untuk admin cross-tenant action:

```text
tenant_id = affected tenant
actor_scope = platform admin / support / regulator
reason_code mandatory
approval/case reference optional/mandatory depending policy
```

Jangan hanya audit actor. Audit tenant yang terkena dampak.

---

## 22. Multi-Tenancy dan Outbox/Event

Outbox event harus membawa tenant id.

```sql
create table outbox_event (
    id uuid primary key,
    tenant_id varchar(64) not null,
    aggregate_type varchar(128) not null,
    aggregate_id varchar(128) not null,
    event_type varchar(128) not null,
    payload_json clob not null,
    status varchar(32) not null,
    created_at timestamp not null
);

create index idx_outbox_status_created
    on outbox_event (status, created_at);

create index idx_outbox_tenant_aggregate
    on outbox_event (tenant_id, aggregate_type, aggregate_id);
```

Event consumer harus validate tenant:

```java
public void handle(ApplicationApprovedEvent event) {
    TenantContextHolder.set(systemContextForTenant(event.tenantId()));
    try {
        // process tenant-scoped side effect
    } finally {
        TenantContextHolder.clear();
    }
}
```

Message metadata juga harus tenant-aware:

```text
headers:
  tenant-id: agency-a
  correlation-id: ...
  causation-id: ...
  actor-id: ...
```

Jangan hanya menyimpan tenant id di payload jika router/consumer/filter membutuhkannya di header.

---

## 23. Multi-Tenancy dan Search Index

Jika memakai Elasticsearch/OpenSearch/Solr:

Opsi:

```text
1. Shared index with tenant_id field
2. Index per tenant
3. Hybrid
```

Shared index:

```text
+ Simple operation
+ Efficient for many small tenants
- Query harus selalu include tenant filter
- Cache/security risk
```

Index per tenant:

```text
+ Isolation lebih kuat
+ Per-tenant lifecycle lebih mudah
- Banyak index
- Cluster overhead
- Cross-tenant search sulit
```

Search query harus tenant-scoped:

```json
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "agency-a" } },
        { "term": { "status": "APPROVED" } }
      ],
      "must": [
        { "match": { "title": "licence" } }
      ]
    }
  }
}
```

Search index bukan source of truth. Tenant mismatch antara DB dan index harus dideteksi.

---

## 24. Multi-Tenancy dan File/Object Storage

File attachment sering luput dari tenant model.

Buruk:

```text
s3://bucket/documents/{documentId}.pdf
```

Lebih aman:

```text
s3://bucket/tenants/{tenantId}/documents/{documentId}.pdf
```

Metadata table:

```sql
create table document_metadata (
    id uuid primary key,
    tenant_id varchar(64) not null,
    object_key varchar(1024) not null,
    file_name varchar(255) not null,
    content_type varchar(128) not null,
    size_bytes bigint not null,
    checksum_sha256 varchar(64) not null,
    created_at timestamp not null,
    unique (tenant_id, id)
);
```

Pre-signed URL generation harus validate tenant.

```java
public PresignedUrl createDownloadUrl(UUID documentId) {
    DocumentMetadata metadata = documentRepository
        .findByTenantIdAndId(currentTenantId(), documentId)
        .orElseThrow(NotFoundException::new);

    authorizationService.assertCanDownload(metadata);

    return objectStorage.presign(metadata.objectKey());
}
```

---

## 25. Multi-Tenancy dan Migration

### 25.1 Shared Schema Migration

Lebih sederhana:

```text
Run migration once.
All tenants affected.
```

Risiko:

```text
- Migration failure impacts all tenants
- Backfill must be throttled tenant-aware
- Lock/DDL impacts all tenants
```

---

### 25.2 Schema per Tenant Migration

Perlu migration orchestrator.

```text
for each active tenant schema:
  acquire migration lock
  run migration
  verify version
  record result
```

Failure handling:

```text
- tenant A migrated success
- tenant B failed
- tenant C not started
```

Aplikasi harus bisa menangani mixed migration version jika rollout bertahap.

---

### 25.3 Database per Tenant Migration

Lebih kompleks:

```text
- credential per tenant
- network per tenant
- version drift
- tenant-specific maintenance window
- partial rollout
- rollback per tenant
```

Migration metadata penting:

```sql
create table tenant_migration_status (
    tenant_id varchar(64) not null,
    target_version varchar(64) not null,
    actual_version varchar(64) not null,
    status varchar(32) not null,
    started_at timestamp,
    finished_at timestamp,
    error_message varchar(4000),
    primary key (tenant_id, target_version)
);
```

---

## 26. Multi-Tenancy dan Reporting

Cross-tenant reporting adalah kebutuhan umum tapi berisiko.

Pertanyaan desain:

```text
Siapa boleh melihat cross-tenant report?
Apakah data harus aggregated/anonymized?
Apakah tenant id boleh terlihat?
Apakah row-level detail boleh diekspor?
Apakah report harus real-time?
Apakah report query mengganggu OLTP workload?
```

Opsi desain:

```text
1. Query OLTP langsung dengan tenant scope
2. Dedicated reporting replica
3. Materialized view
4. Data warehouse/lake
5. Periodic aggregate table
6. Per-tenant export + central report ingestion
```

Untuk schema/database per tenant, cross-tenant reporting sering lebih baik lewat data warehouse atau ETL/CDC, bukan join runtime lintas database.

---

## 27. Multi-Tenancy dan Archival

Archival bisa berdasarkan tenant, waktu, status, atau regulatory retention.

Contoh policy:

```text
Tenant A: retain approved case 7 years
Tenant B: retain approved case 10 years
Tenant C: legal hold, no deletion
```

Archival table harus tetap tenant-aware.

```sql
create table archived_case_file (
    id bigint primary key,
    tenant_id varchar(64) not null,
    original_case_id bigint not null,
    archived_at timestamp not null,
    archive_reason varchar(128) not null,
    payload_json clob not null
);
```

Untuk shared schema, archival query harus chunked tenant-aware:

```sql
select id
from case_file
where tenant_id = ?
  and status = 'CLOSED'
  and closed_at < ?
order by id
fetch first 500 rows only;
```

Jangan menjalankan archival cross-tenant besar tanpa throttle.

---

## 28. Multi-Tenancy dan Testing

Testing tenant isolation harus eksplisit.

### 28.1 Test Tenant Leakage

```java
@Test
void tenantAShouldNotSeeTenantBApplication() {
    createApplication("tenant-a", "APP-001");
    createApplication("tenant-b", "APP-001");

    asTenant("tenant-a", () -> {
        ApplicationDetail detail = service.getByApplicationNo("APP-001");
        assertThat(detail.tenantId()).isEqualTo("tenant-a");
    });
}
```

### 28.2 Test Cache Leakage

```java
@Test
void cacheKeyMustIncludeTenant() {
    createSummary("tenant-a", 100L, "Tenant A Summary");
    createSummary("tenant-b", 100L, "Tenant B Summary");

    asTenant("tenant-a", () -> assertThat(service.getSummary(100L).title())
        .isEqualTo("Tenant A Summary"));

    asTenant("tenant-b", () -> assertThat(service.getSummary(100L).title())
        .isEqualTo("Tenant B Summary"));
}
```

### 28.3 Test Async Context

```java
@Test
void asyncJobMustSetTenantContextExplicitly() {
    TenantJobMessage message = new TenantJobMessage("tenant-a", "job-123");
    handler.handle(message);

    assertThat(auditRepository.findByTenantId("tenant-a")).isNotEmpty();
    assertThat(auditRepository.findByTenantId("tenant-b")).isEmpty();
}
```

### 28.4 Test Native Query

Native SQL harus direview dan ditest tenant predicate-nya.

```java
@Test
void nativeSearchMustBeTenantScoped() {
    seedTenantAAndTenantBMatchingRows();

    asTenant("tenant-a", () -> {
        List<Result> results = reportRepository.nativeSearch("same keyword");
        assertThat(results).allMatch(r -> r.tenantId().equals("tenant-a"));
    });
}
```

---

## 29. Observability untuk Multi-Tenancy

Semua log/metric/tracing harus bisa dikaitkan dengan tenant, tapi hati-hati cardinality.

### 29.1 Logging

Log context:

```text
tenant_id
request_id
actor_id
operation
resource_type
resource_id
transaction_id
```

Contoh:

```json
{
  "level": "INFO",
  "tenant_id": "agency-a",
  "request_id": "req-123",
  "actor_id": "user-456",
  "operation": "APPROVE_APPLICATION",
  "application_id": "789",
  "message": "Application approved"
}
```

Jangan log data sensitif tenant.

---

### 29.2 Metrics

Metric bagus:

```text
requests_total{operation, status}
transaction_duration_seconds{operation}
db_query_duration_seconds{operation, query_name}
tenant_routing_failures_total
forbidden_tenant_access_total
migration_failures_total
```

Metric dengan `tenant_id` label bisa menyebabkan cardinality explosion jika tenant banyak.

Alternatif:

```text
- sample tenant-level metrics
- tenant tier label
- top-N tenant reporting via logs/analytics
- dedicated per-tenant dashboard untuk premium tenant
```

---

### 29.3 Tracing

Trace attribute:

```text
app.tenant_id
app.tenant_strategy
app.request_id
app.operation
```

Tetapi tenant id bisa dianggap sensitive metadata di beberapa organisasi. Ikuti policy internal.

---

## 30. Failure Modes

### 30.1 Tenant Predicate Missing

Gejala:

```text
User tenant A melihat row tenant B.
```

Penyebab:

```text
- Repository method lupa tenant_id
- Native query lupa tenant predicate
- Admin endpoint salah expose
- Filter tidak enable
```

Mitigasi:

```text
- Tenant-scoped repository wrapper
- Static analysis/code review rule
- Integration test tenant leakage
- Database RLS/composite FK where possible
- Query convention
```

---

### 30.2 Tenant Context Leak

Gejala:

```text
Request tenant B diproses dengan tenant A.
```

Penyebab:

```text
- ThreadLocal tidak clear
- Async task inherit context salah
- Message handler tidak set context
```

Mitigasi:

```text
- clear in finally
- explicit context in async boundary
- test concurrent request
- MDC cleanup
```

---

### 30.3 Cache Leakage

Gejala:

```text
Data tenant A muncul di tenant B hanya setelah cache hit.
```

Penyebab:

```text
- Cache key tidak include tenant
- Query cache tidak tenant-aware
- Shared cache region salah
```

Mitigasi:

```text
- TenantCacheKey
- Cache test per tenant
- Disable query cache unless proven safe
- Tenant-aware eviction
```

---

### 30.4 Schema Routing Leak

Gejala:

```text
Tenant B membaca schema tenant A.
```

Penyebab:

```text
- connection.setSchema tidak reset
- connection pool reused session state
- tenant registry salah
```

Mitigasi:

```text
- reset schema on release
- connection validation
- smoke test routing
- restricted schema naming registry
```

---

### 30.5 Migration Drift

Gejala:

```text
Tenant A schema version 100, tenant B version 98.
Aplikasi gagal hanya untuk tenant B.
```

Mitigasi:

```text
- Tenant migration status table
- Expand/contract compatible deployment
- Migration orchestrator
- Startup validation
- Feature flag by migration version
```

---

### 30.6 Cross-Tenant Reporting Overload

Gejala:

```text
Admin report membuat DB OLTP lambat untuk semua tenant.
```

Mitigasi:

```text
- read replica
- materialized view
- warehouse
- throttling
- async export
- pagination/keyset
```

---

## 31. Design Decision Matrix

| Criterion | Shared Schema | Schema per Tenant | Database per Tenant |
|---|---:|---:|---:|
| Cost efficiency | High | Medium | Low |
| Operational simplicity | High | Medium | Low |
| Data isolation | Low-Medium | Medium-High | High |
| Execution isolation | Low | Medium | High |
| Cross-tenant reporting | Easy | Medium | Hard |
| Tenant onboarding | Easy | Medium | Hard |
| Per-tenant backup/restore | Hard | Medium | Easy |
| Migration complexity | Low | Medium-High | High |
| Tenant count scalability | High | Medium | Low-Medium |
| Regulatory isolation | Weak-Medium | Medium | Strong |
| Query safety burden | High | Medium | Medium |
| Cache leakage risk | High | Medium | Medium |
| Noisy neighbor risk | High | Medium | Low |

Rule kasar:

```text
Banyak tenant kecil + cost-sensitive       -> shared schema
Tenant sedang + isolation penting          -> schema per tenant
Tenant besar/regulatory/premium            -> database per tenant
Skala sangat besar                         -> hybrid + partitioning/sharding + warehouse
```

---

## 32. Design Pattern untuk Case Management / Regulatory Platform

Untuk sistem case management multi-agency, desain yang cukup defensible:

```text
Control DB:
  tenant_registry
  tenant_feature_flag
  tenant_migration_status
  platform_user_tenant_access

Tenant data:
  application
  case_file
  case_assignment
  correspondence
  document_metadata
  audit_trail
  outbox_event
```

Jika shared schema:

```text
Semua tabel tenant-owned wajib punya tenant_id.
Semua unique business key tenant-scoped.
Semua FK penting tenant-aware.
Semua query use tenant-scoped repository.
Semua cache key include tenant.
Audit/outbox include tenant.
```

Jika schema/database per tenant:

```text
Tenant registry wajib kuat.
Routing harus terjadi sebelum transaction.
Connection/schema state harus reset.
Migration harus orchestrated.
Cross-tenant reporting jangan langsung join runtime.
```

---

## 33. Example: Tenant-Scoped Application Service

```java
@Service
public class ApplicationCommandService {

    private final TenantAccessGuard tenantAccessGuard;
    private final ApplicationRepository applicationRepository;
    private final AuditTrailRepository auditTrailRepository;
    private final OutboxRepository outboxRepository;

    public ApplicationCommandService(
            TenantAccessGuard tenantAccessGuard,
            ApplicationRepository applicationRepository,
            AuditTrailRepository auditTrailRepository,
            OutboxRepository outboxRepository
    ) {
        this.tenantAccessGuard = tenantAccessGuard;
        this.applicationRepository = applicationRepository;
        this.auditTrailRepository = auditTrailRepository;
        this.outboxRepository = outboxRepository;
    }

    @Transactional
    public SubmitApplicationResult submit(SubmitApplicationCommand command) {
        TenantContextValue context = TenantContextHolder.required();
        tenantAccessGuard.assertWritable(context.tenantId());

        Application application = applicationRepository
            .findByTenantIdAndApplicationNo(context.tenantId(), command.applicationNo())
            .orElseThrow(NotFoundException::new);

        application.submit(command.submittedAt(), context.actorUserId());

        auditTrailRepository.save(AuditTrail.submitted(
            context.tenantId(),
            context.actorUserId(),
            application.id(),
            context.requestId()
        ));

        outboxRepository.save(OutboxEvent.applicationSubmitted(
            context.tenantId(),
            application.id(),
            application.version()
        ));

        return new SubmitApplicationResult(application.applicationNo(), application.status());
    }
}
```

Key point:

```text
- TenantContext resolved before transaction.
- Repository query tenant-scoped.
- Write guard checks tenant status.
- Audit includes tenant.
- Outbox includes tenant.
- Transaction atomic for state + audit + outbox.
```

---

## 34. Example: Tenant-Aware Specification

```java
public final class ApplicationSpecifications {

    private ApplicationSpecifications() {
    }

    public static Specification<Application> visibleToCurrentTenant() {
        return (root, query, cb) -> cb.equal(
            root.get("tenantId"),
            TenantContextHolder.requiredTenantId()
        );
    }

    public static Specification<Application> hasStatus(ApplicationStatus status) {
        return (root, query, cb) -> status == null
            ? cb.conjunction()
            : cb.equal(root.get("status"), status);
    }

    public static Specification<Application> createdBetween(Instant from, Instant to) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (from != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.get("createdAt"), from));
            }
            if (to != null) {
                predicates.add(cb.lessThan(root.get("createdAt"), to));
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        };
    }
}
```

Usage:

```java
Specification<Application> spec = Specification
    .where(ApplicationSpecifications.visibleToCurrentTenant())
    .and(ApplicationSpecifications.hasStatus(criteria.status()))
    .and(ApplicationSpecifications.createdBetween(criteria.from(), criteria.to()));
```

Pastikan `visibleToCurrentTenant()` selalu menjadi base spec.

---

## 35. Example: Guard untuk Cross-Tenant Admin Query

Cross-tenant query harus explicit dan auditable.

```java
@Service
public class PlatformReportService {

    private final PlatformAuthorizationService authorizationService;
    private final PlatformAuditRepository platformAuditRepository;
    private final ReportRepository reportRepository;

    @Transactional(readOnly = true)
    public Page<AgencySummaryRow> searchAcrossTenants(CrossTenantReportCommand command) {
        AuthenticatedUser user = CurrentUser.required();

        authorizationService.assertCanRunCrossTenantReport(user, command.reasonCode());

        platformAuditRepository.save(PlatformAudit.crossTenantReportAccessed(
            user.userId(),
            command.reasonCode(),
            command.tenantIds(),
            command.requestId()
        ));

        return reportRepository.searchAcrossTenants(
            command.tenantIds(),
            command.status(),
            command.pageable()
        );
    }
}
```

Prinsip:

```text
Cross-tenant access tidak boleh terjadi secara accidental.
Harus menggunakan API/service khusus, permission khusus, dan audit khusus.
```

---

## 36. Anti-Pattern

### 36.1 Tenant ID dari Request Langsung Dipercaya

```java
String tenantId = request.getHeader("X-Tenant-Id");
TenantContextHolder.set(new TenantContextValue(tenantId, ...));
```

Masalah: user bisa mengganti header.

---

### 36.2 Repository Method Tidak Tenant-Scoped

```java
Optional<Application> findById(Long id);
```

Untuk endpoint tenant-scoped, lebih aman:

```java
Optional<Application> findByTenantIdAndId(String tenantId, Long id);
```

---

### 36.3 Cache Key Tanpa Tenant

```java
key = "#id"
```

Harus:

```java
key = "#tenantId + ':' + #id"
```

---

### 36.4 Native Query Bypass Filter

```java
select * from application where status = ?
```

Harus:

```java
select * from application where tenant_id = ? and status = ?
```

---

### 36.5 Connection Schema Tidak Direset

Schema per tenant tanpa reset connection adalah bug berbahaya.

---

### 36.6 Cross-Tenant Admin Endpoint Tanpa Audit

Platform admin access harus lebih diawasi daripada user biasa.

---

### 36.7 Sharding Terlalu Dini

Sharding sebelum ada kebutuhan nyata biasanya hanya menambah irreversible complexity.

---

## 37. Checklist Desain Multi-Tenancy

### 37.1 Data Model

- [ ] Semua tenant-owned table punya tenant marker atau berada di tenant schema/database.
- [ ] Business unique constraint tenant-scoped.
- [ ] FK penting tenant-aware.
- [ ] Index sesuai query tenant-scoped.
- [ ] Audit/outbox/document metadata include tenant.
- [ ] Soft delete tidak merusak uniqueness.

### 37.2 Application Layer

- [ ] Tenant resolved dari authenticated/authorized source.
- [ ] Tenant context diset sebelum transaction.
- [ ] Tenant context cleared di `finally`.
- [ ] Async/message/scheduler set tenant context eksplisit.
- [ ] Cross-tenant operation punya service khusus.

### 37.3 Repository/Query

- [ ] Query tenant-scoped by default.
- [ ] Native SQL direview tenant predicate-nya.
- [ ] Bulk update/delete tenant-scoped.
- [ ] Reporting query punya access guard.
- [ ] Projection tidak bypass authorization.

### 37.4 Transaction

- [ ] Satu transaction tidak berpindah tenant.
- [ ] Database per tenant tidak dipakai lintas tenant dalam satu local transaction.
- [ ] Outbox/inbox include tenant.
- [ ] Retry tenant-aware dan idempotent.

### 37.5 Cache

- [ ] Cache key include tenant.
- [ ] Authorization-dependent cache include scope/role/actor bila perlu.
- [ ] Query cache dihindari atau terbukti tenant-aware.
- [ ] Eviction tenant-aware.

### 37.6 Operations

- [ ] Tenant registry ada dan aman.
- [ ] Migration status per tenant tercatat.
- [ ] Observability bisa filter tenant tanpa cardinality explosion.
- [ ] Incident playbook tenant leakage ada.
- [ ] Backup/restore/export policy jelas.

---

## 38. Latihan / Scenario

### Scenario 1 — Shared Schema Case Management

Kamu punya tabel:

```text
application(id, tenant_id, application_no, status)
case_file(id, tenant_id, application_id, status)
audit_trail(id, tenant_id, resource_id, action)
```

Tugas:

1. Desain unique constraint untuk `application_no`.
2. Desain FK agar `case_file` tidak bisa refer application tenant lain.
3. Desain index untuk listing application by status.
4. Desain repository method untuk detail application.
5. Desain test tenant leakage.

---

### Scenario 2 — Schema per Tenant Migration

Ada 500 tenant schema. Migration menambah kolom `priority` pada `case_file`, lalu backfill berdasarkan rule.

Tugas:

1. Buat strategi expand-migrate-contract.
2. Buat migration orchestration flow.
3. Tentukan failure handling jika tenant ke-230 gagal.
4. Tentukan bagaimana aplikasi berjalan saat sebagian tenant belum selesai.
5. Tentukan metrics/log yang dibutuhkan.

---

### Scenario 3 — Database per Tenant dan Cross-Tenant Report

Platform admin butuh report jumlah case per agency.

Tugas:

1. Jelaskan kenapa query langsung ke semua DB tenant secara synchronous berisiko.
2. Desain alternatif dengan warehouse/materialized aggregate.
3. Tentukan audit requirement untuk platform admin.
4. Tentukan data masking jika report diekspor.

---

### Scenario 4 — Cache Leakage Incident

Tenant B melihat summary milik tenant A selama 5 menit setelah deployment.

Tugas:

1. Identifikasi kemungkinan root cause.
2. Buat immediate mitigation.
3. Buat permanent fix.
4. Buat test regression.
5. Buat observability improvement.

---

## 39. Ringkasan

Multi-tenancy adalah salah satu area persistence yang paling berbahaya karena bug-nya bukan hanya bug teknis, tetapi bisa menjadi incident security, privacy, compliance, dan reputasi.

Mental model utama:

```text
Multi-tenancy bukan fitur repository.
Multi-tenancy adalah invariant lintas authentication, authorization, query, transaction, cache, audit, event, migration, observability, dan operation.
```

Tiga strategi utama:

```text
Shared schema dengan tenant_id:
  murah, sederhana, tetapi tenant leakage risk tinggi.

Schema per tenant:
  isolation lebih kuat, migration/operation lebih kompleks.

Database per tenant:
  isolation paling kuat, cost dan operation paling mahal.
```

Prinsip desain senior:

1. Tenant context harus berasal dari sumber yang sudah diautentikasi dan diautorisasi.
2. Tenant context harus diset sebelum transaction dan tidak berubah selama transaction.
3. Query tenant-scoped harus menjadi default, cross-tenant query harus explicit dan auditable.
4. Cache key harus tenant-aware.
5. Audit, outbox, document metadata, dan search index harus membawa tenant id.
6. Unique constraint, foreign key, dan index harus tenant-aware pada shared schema.
7. Schema/database routing harus reset session/connection state dengan benar.
8. Migration tenant harus observable dan bisa menangani partial failure.
9. Testing tenant leakage harus menjadi bagian wajib integration test.
10. Strategi isolation harus dipilih berdasarkan risiko, bukan hanya convenience.

Jika kamu bisa mendesain multi-tenancy dengan benar, kamu sudah melampaui level “bisa pakai JPA” dan mulai masuk ke level engineer yang memahami persistence sebagai security boundary dan operational boundary.

---

## 40. Referensi

- Jakarta Persistence 3.2 Specification — `https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2`
- Jakarta Persistence 3.2 Project Page — `https://jakarta.ee/specifications/persistence/3.2/`
- Hibernate ORM User Guide — `https://docs.hibernate.org/stable/orm/userguide/html_single/`
- Hibernate ORM Multi-Tenancy Documentation — `https://docs.hibernate.org/orm/5.0/userguide/html_single/chapters/multitenancy/MultiTenancy.html`
- Spring Framework Reference: Transaction Management — `https://docs.spring.io/spring-framework/reference/data-access/transaction.html`
- Spring Framework Reference: Cache Abstraction — `https://docs.spring.io/spring-framework/reference/integration/cache.html`

---

## 41. Status Seri

Seri belum selesai.

Part yang sudah dibuat sampai bagian ini:

```text
Part 000 — Big Picture: Persistence as a Boundary, Not a CRUD Layer
Part 001 — Evolution Map: JDBC, JPA, Hibernate, Spring Data, Jakarta Data, Jakarta Transactions
Part 002 — Persistence Architecture: Layering, Boundaries, and Dependency Direction
Part 003 — Entity Identity: Object Identity, Database Identity, Business Identity
Part 004 — Entity Lifecycle and Persistence Context Internals
Part 005 — Mapping Fundamentals Done Correctly
Part 006 — Relationship Mapping: One-to-One, Many-to-One, One-to-Many, Many-to-Many
Part 007 — Fetching Strategy: Lazy, Eager, N+1, Entity Graph, Fetch Join
Part 008 — Query Model: JPQL, HQL, Criteria, Native SQL, QuerySpecification
Part 009 — Projection, DTO, Read Model, and Reporting Queries
Part 010 — Transaction Fundamentals: ACID, Local Transactions, JTA, Resource Managers
Part 011 — Transaction Boundary Design in Real Applications
Part 012 — Isolation Levels and Concurrency Anomalies
Part 013 — Optimistic Locking, Versioning, and State Machine Persistence
Part 014 — Pessimistic Locking, Deadlocks, and High-Contention Workloads
Part 015 — Flush, Dirty Checking, Write-Behind, and SQL Generation
Part 016 — Batch Processing and High-Volume Persistence
Part 017 — Schema Generation, Migration, and Database Contract
Part 018 — Constraints, Invariants, and Validation Across Layers
Part 019 — Caching: First-Level Cache, Second-Level Cache, Query Cache, External Cache
Part 020 — Advanced Mapping: Inheritance, Polymorphism, JSON, LOB, Custom Types
Part 021 — Auditing, Temporal Data, Soft Delete, and Historical Correctness
Part 022 — Multi-Tenancy, Multi-Schema, Multi-Database, and Data Partitioning
```

Bagian berikutnya:

```text
Part 023 — Repository Patterns: DAO, Repository, Spring Data JPA, Jakarta Data
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 021 — Auditing, Temporal Data, Soft Delete, and Historical Correctness](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-021.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 023 — Repository Patterns: DAO, Repository, Spring Data JPA, Jakarta Data](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-023.md)

</div>