# Part 27 — Observability: SQL Logging, Statistics, Metrics, Tracing, and Production Diagnosis

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> Bagian: 27 dari 34  
> Fokus: observability ORM provider, SQL logging, statistics, metrics, tracing, correlation, dan diagnosis production  
> Target Java: 8 sampai 25  
> Target API/provider: JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, EclipseLink 2/3/4/5

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas mapping, association, fetch plan, query, bulk operation, transaction, concurrency, cache, schema, enhancement, Hibernate internals, EclipseLink internals, dan perbedaan provider.

Bagian ini menjawab pertanyaan yang sangat production-oriented:

> Ketika endpoint lambat, database CPU naik, connection pool habis, user melihat stale data, atau sistem tiba-tiba mengeksekusi ribuan SQL, bagaimana kita membuktikan akar masalahnya dari sisi ORM?

Observability ORM bukan sekadar menyalakan `show_sql=true`.

Observability ORM adalah kemampuan untuk menghubungkan:

```text
HTTP request / message / batch job
        ↓
service method / use case
        ↓
transaction boundary
        ↓
persistence context lifecycle
        ↓
flush / query execution / lazy loading
        ↓
Hibernate Session / EclipseLink UnitOfWork
        ↓
JDBC statement
        ↓
connection pool
        ↓
database execution plan
        ↓
row scan / lock / wait / IO / CPU
```

Tanpa rantai ini, diagnosis biasanya berubah menjadi tebakan:

- “Mungkin query-nya lambat.”
- “Mungkin database-nya penuh.”
- “Mungkin Hibernate lambat.”
- “Mungkin cache tidak jalan.”
- “Mungkin connection pool kurang besar.”

Engineer level tinggi tidak berhenti di “mungkin”. Ia membangun bukti.

---

## 1. Core Mental Model: ORM Observability Is Causality Reconstruction

Observability di ORM adalah usaha membangun ulang sebab-akibat antara operasi aplikasi dan efek database.

ORM menyembunyikan banyak operasi database di balik object graph. Ini berguna untuk produktivitas, tetapi berbahaya untuk diagnosis karena SQL bisa terjadi dari banyak sumber:

1. explicit query,
2. lazy loading,
3. flush sebelum query,
4. cascade persist/remove,
5. orphan removal,
6. dirty checking,
7. collection initialization,
8. second-level cache miss,
9. query cache invalidation,
10. merge detached graph,
11. lifecycle listener,
12. entity graph/fetch profile,
13. provider enhancement/weaving behavior,
14. transaction synchronization sebelum commit.

Jadi ketika kita melihat SQL:

```sql
select c.id, c.status, c.created_at
from case_file c
where c.id = ?
```

pertanyaan yang benar bukan hanya:

> SQL ini cepat atau lambat?

Tetapi:

> SQL ini muncul karena apa, dari use case mana, dalam transaction boundary mana, dengan persistence context sebesar apa, karena explicit query atau lazy load, sebelum flush atau setelah flush, cache hit atau miss, dan apakah query ini memang dibutuhkan untuk memenuhi user journey?

### 1.1 Observability Harus Menjawab 8 Pertanyaan

Untuk production ORM, observability yang baik minimal bisa menjawab:

| Pertanyaan | Kenapa penting |
|---|---|
| Request/use case mana yang menghasilkan SQL ini? | Tanpa correlation, SQL log tidak actionable. |
| SQL ini explicit query atau lazy loading? | Fix-nya berbeda total. |
| SQL ini terjadi sebelum, selama, atau setelah flush? | Flush surprise sering disalahartikan sebagai query lambat. |
| Berapa jumlah SQL per request? | Untuk deteksi N+1 dan chatty persistence. |
| Berapa rows returned vs rows scanned? | Untuk membedakan query shape vs index problem. |
| Berapa entity/collection yang di-load? | Untuk object hydration dan memory diagnosis. |
| Cache hit/miss/put/evict bagaimana? | Untuk correctness dan performance cache. |
| Connection pool wait time berapa? | Untuk membedakan DB slow vs pool starvation. |

### 1.2 Observability Bukan Logging Saja

Logging menjawab “apa yang terjadi”.

Metrics menjawab “berapa sering dan seberapa besar”.

Tracing menjawab “di mana dalam request path”.

Profiling menjawab “biaya CPU/memory di mana”.

Database execution plan menjawab “bagaimana database mengeksekusi SQL”.

ORM production diagnosis butuh semuanya, tetapi tidak selalu dinyalakan dengan level detail sama.

```text
Logging   = event detail
Metrics   = aggregate signal
Tracing   = causality path
Profiling = runtime cost attribution
Plan      = database execution mechanics
```

---

## 2. Observability Layers dalam Aplikasi ORM

Bayangkan sistem dengan endpoint:

```text
GET /cases/{id}/summary
```

Endpoint ini memanggil:

```text
CaseSummaryService.getSummary(caseId)
```

Lalu service melakukan:

```java
CaseFile caseFile = caseRepository.findById(caseId);
return mapper.toSummary(caseFile);
```

Secara kode terlihat sederhana. Tetapi ORM bisa melakukan:

```text
1 select case_file
1 select applicant
1 select agency
1 select tasks
N select task.assignee
N select task.comments
1 flush unexpected audit update
1 select second-level cache miss
```

Agar observable, kita perlu melihat layer berikut.

## 2.1 Application Layer

Yang harus terlihat:

- request id,
- user journey,
- endpoint,
- use case/service method,
- tenant/agency context jika multi-tenant,
- transaction boundary,
- read/write classification,
- batch job id/message id.

Contoh log context:

```text
requestId=8f7a
module=CASE
useCase=GetCaseSummary
caseId=CASE-2026-000123
agency=CEA
transaction=readOnly
```

Tanpa ini, SQL log hanya menjadi noise.

## 2.2 Transaction Layer

Yang harus terlihat:

- transaction started/ended,
- rollback/commit,
- rollback-only marker,
- flush before commit,
- propagation boundary,
- read-only flag,
- duration.

Banyak masalah ORM sebenarnya adalah masalah transaction boundary:

- transaction terlalu lebar,
- transaction terlalu sempit,
- lazy loading di luar transaction,
- flush terjadi di titik yang tidak diduga,
- rollback-only akibat exception yang tertelan.

## 2.3 Persistence Context Layer

Yang harus terlihat:

- jumlah entity managed,
- jumlah collection loaded,
- jumlah entity inserted/updated/deleted,
- flush count,
- dirty checking cost,
- entity load/fetch count,
- collection fetch count.

Hibernate menyediakan statistics API untuk banyak sinyal ini. EclipseLink menyediakan logging/profiling dan session-level instrumentation.

## 2.4 SQL/JDBC Layer

Yang harus terlihat:

- SQL template,
- bind parameter secara aman,
- execution time,
- row count,
- batch size,
- statement count,
- slow query,
- exception SQLState/vendor code.

## 2.5 Connection Pool Layer

Yang harus terlihat:

- active connections,
- idle connections,
- pending threads,
- acquisition time,
- timeout count,
- max lifetime/eviction,
- leak detection.

ORM lambat sering tampak seperti DB lambat, padahal thread menunggu koneksi.

## 2.6 Database Layer

Yang harus terlihat:

- execution plan,
- rows estimated vs actual,
- index usage,
- lock wait,
- deadlock,
- buffer reads,
- physical reads,
- temp space,
- CPU time,
- wait events.

ORM observability selesai hanya jika SQL dari aplikasi bisa dikorelasikan ke database plan/wait.

---

## 3. Logging SQL: Useful, Dangerous, and Often Misused

SQL logging adalah alat paling cepat untuk melihat ORM behavior, tetapi juga paling sering disalahgunakan.

### 3.1 `show_sql` Bukan Observability Production

Di Hibernate, banyak developer menyalakan:

```properties
hibernate.show_sql=true
hibernate.format_sql=true
```

Ini berguna untuk belajar lokal, tetapi buruk untuk production karena:

1. output biasanya ke stdout,
2. tidak selalu masuk structured logging pipeline,
3. sulit dikorelasikan dengan request id,
4. bisa sangat noisy,
5. tidak selalu menampilkan bind values,
6. tidak memberi duration,
7. tidak memberi row count,
8. bisa membuat false confidence.

Lebih baik gunakan logger category/provider integration.

Contoh konsep logging Hibernate:

```properties
# development only-ish
org.hibernate.SQL=DEBUG
org.hibernate.orm.jdbc.bind=TRACE
```

Catatan versi:

- Hibernate 5 memakai category bind yang berbeda seperti `org.hibernate.type.descriptor.sql.BasicBinder`.
- Hibernate 6/7 memakai category baru seperti `org.hibernate.orm.jdbc.bind`.

Jangan copy-paste config lintas versi tanpa verifikasi.

### 3.2 SQL Template vs Bind Parameter

ORM biasanya menghasilkan SQL dengan placeholder:

```sql
select c.id, c.status
from case_file c
where c.id = ?
```

Bind value ada di layer JDBC:

```text
binding parameter [1] as [VARCHAR] - [CASE-2026-000123]
```

Untuk diagnosis, kita butuh keduanya, tetapi production harus hati-hati karena bind value bisa mengandung:

- NRIC/NIK/passport,
- email,
- phone,
- address,
- free-text complaint,
- legal note,
- medical-like content,
- credentials/token jika bug.

Rule aman:

```text
Log SQL shape by default.
Log bind values only in controlled lower environment or redacted production diagnostic window.
```

### 3.3 SQL Shape Fingerprint

Untuk production, sering lebih berguna menyimpan fingerprint daripada full literal SQL.

Contoh:

```sql
select c.id, c.status from case_file c where c.id = ?
```

Fingerprint:

```text
SQL_HASH=9f14ab32
operation=SELECT
main_table=CASE_FILE
where=id_eq
```

Dengan fingerprint, kita bisa aggregate:

- count per SQL shape,
- p50/p95/p99 duration,
- error rate,
- rows returned,
- source endpoint,
- source service.

Ini lebih actionable daripada ribuan SQL literal.

### 3.4 StatementInspector di Hibernate

Hibernate menyediakan `StatementInspector` untuk menginspeksi atau memproses SQL sebelum JDBC statement disiapkan. Javadoc Hibernate menjelaskan bahwa inspector dapat dipakai bersama oleh semua session dari sebuah `SessionFactory` sehingga harus thread-safe, atau dapat diregister untuk session tertentu.

Contoh minimal:

```java
public final class CorrelatingStatementInspector implements org.hibernate.resource.jdbc.spi.StatementInspector {

    @Override
    public String inspect(String sql) {
        String requestId = RequestContext.currentRequestIdOrNull();
        String useCase = RequestContext.currentUseCaseOrNull();

        SqlObservation.recordSqlShape(
            requestId,
            useCase,
            normalize(sql)
        );

        return sql;
    }

    private String normalize(String sql) {
        return sql
            .replaceAll("\\s+", " ")
            .trim();
    }
}
```

Configuration idea:

```properties
hibernate.session_factory.statement_inspector=com.acme.persistence.CorrelatingStatementInspector
```

Important:

- Jangan melakukan blocking I/O berat di `StatementInspector`.
- Jangan mengubah SQL kecuali benar-benar perlu dan teruji.
- Jika instance global, pastikan thread-safe.
- Jangan simpan request context di field instance global.
- Gunakan MDC/thread-local/context propagation dengan hati-hati.

### 3.5 Kenapa StatementInspector Tidak Sama dengan Slow Query Logger

`StatementInspector` melihat SQL sebelum execution. Ia tidak otomatis tahu:

- execution duration,
- row count,
- exception,
- bind values,
- database wait.

Untuk duration, kita butuh instrumentasi di level JDBC driver/proxy, datasource, OpenTelemetry instrumentation, p6spy/datasource-proxy, atau provider statistics.

### 3.6 EclipseLink Logging

EclipseLink memiliki logging framework sendiri dan juga mendukung profiling. Logging level dapat digunakan untuk melihat SQL dan bind parameter tergantung konfigurasi.

Konsep penting EclipseLink:

- session logging,
- SQL logging,
- parameter logging,
- performance profiler,
- query monitor/profiler extension,
- shared cache logging.

Contoh property umum:

```properties
eclipselink.logging.level=FINE
eclipselink.logging.level.sql=FINE
eclipselink.logging.parameters=true
```

Production caution sama:

- parameter logging dapat membocorkan data sensitif,
- logging terlalu detail dapat menambah overhead,
- output harus masuk structured pipeline.

---

## 4. Structured Logging untuk ORM

SQL log tanpa struktur sulit dianalisis. Production log sebaiknya structured.

Contoh log event untuk SQL execution:

```json
{
  "event": "orm.sql.execute",
  "requestId": "8f7a",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "module": "CASE",
  "useCase": "GetCaseSummary",
  "provider": "hibernate",
  "providerVersion": "7.x",
  "operation": "SELECT",
  "sqlHash": "9f14ab32",
  "mainTable": "CASE_FILE",
  "durationMs": 12,
  "rows": 1,
  "connectionWaitMs": 2,
  "transactionReadOnly": true
}
```

Untuk flush:

```json
{
  "event": "orm.flush",
  "requestId": "8f7a",
  "useCase": "UpdateCaseStatus",
  "managedEntities": 158,
  "entityInsertCount": 1,
  "entityUpdateCount": 4,
  "entityDeleteCount": 0,
  "collectionUpdateCount": 2,
  "flushDurationMs": 48
}
```

Untuk lazy load:

```json
{
  "event": "orm.lazy_load",
  "requestId": "8f7a",
  "entity": "Task.assignee",
  "trigger": "dto_mapping",
  "useCase": "GetCaseSummary"
}
```

Lazy load trigger ini tidak selalu mudah didapat dari provider standard. Tetapi kita bisa mendekati dengan kombinasi:

- SQL count per request,
- stack trace sampling saat query count melewati threshold,
- DTO mapper instrumentation,
- Hibernate statistics,
- test SQL count assertion,
- OpenTelemetry spans.

---

## 5. Hibernate Statistics

Hibernate memiliki statistics API untuk melihat behavior internal seperti entity load, query execution, second-level cache, collection fetch, flush, dan lainnya.

### 5.1 Enable Statistics

Contoh property:

```properties
hibernate.generate_statistics=true
```

Di Spring Boot modern:

```properties
spring.jpa.properties.hibernate.generate_statistics=true
```

Jangan asal aktifkan di production permanen tanpa mengukur overhead. Untuk banyak sistem, overhead-nya acceptable jika hanya aggregate counter, tetapi tetap harus diuji.

### 5.2 Access Statistics

Contoh:

```java
SessionFactory sessionFactory = entityManagerFactory.unwrap(SessionFactory.class);
Statistics stats = sessionFactory.getStatistics();

long entityLoadCount = stats.getEntityLoadCount();
long entityFetchCount = stats.getEntityFetchCount();
long queryExecutionCount = stats.getQueryExecutionCount();
long flushCount = stats.getFlushCount();
long secondLevelCacheHitCount = stats.getSecondLevelCacheHitCount();
```

### 5.3 Important Counters

| Counter | Meaning | Diagnosis |
|---|---|---|
| `EntityLoadCount` | entity loaded from result set | object hydration volume |
| `EntityFetchCount` | additional entity fetches | lazy/entity fetch issue |
| `CollectionLoadCount` | collections loaded | collection materialization |
| `CollectionFetchCount` | additional collection fetches | N+1 collection issue |
| `QueryExecutionCount` | queries executed | query volume |
| `FlushCount` | flush occurrences | unexpected flush / transaction behavior |
| `EntityInsertCount` | inserted entities | write volume |
| `EntityUpdateCount` | updated entities | dirty checking/cascade issue |
| `EntityDeleteCount` | deleted entities | cascade/orphan issue |
| `SecondLevelCacheHitCount` | L2 hits | cache effectiveness |
| `SecondLevelCacheMissCount` | L2 misses | cache churn/misconfiguration |
| `SecondLevelCachePutCount` | L2 puts | cache population/write pressure |
| `OptimisticFailureCount` | optimistic lock failures | concurrency conflict |

### 5.4 Per-Request Statistics Snapshot

Global statistics berguna, tetapi sering kurang actionable. Kita ingin delta per request.

Pseudo-code:

```java
public final class HibernateStatsSnapshot {
    final long queryExecutionCount;
    final long entityLoadCount;
    final long entityFetchCount;
    final long collectionFetchCount;
    final long flushCount;
    final long secondLevelCacheHitCount;
    final long secondLevelCacheMissCount;

    static HibernateStatsSnapshot take(Statistics s) {
        return new HibernateStatsSnapshot(
            s.getQueryExecutionCount(),
            s.getEntityLoadCount(),
            s.getEntityFetchCount(),
            s.getCollectionFetchCount(),
            s.getFlushCount(),
            s.getSecondLevelCacheHitCount(),
            s.getSecondLevelCacheMissCount()
        );
    }

    HibernateStatsDelta diff(HibernateStatsSnapshot after) {
        return new HibernateStatsDelta(
            after.queryExecutionCount - this.queryExecutionCount,
            after.entityLoadCount - this.entityLoadCount,
            after.entityFetchCount - this.entityFetchCount,
            after.collectionFetchCount - this.collectionFetchCount,
            after.flushCount - this.flushCount,
            after.secondLevelCacheHitCount - this.secondLevelCacheHitCount,
            after.secondLevelCacheMissCount - this.secondLevelCacheMissCount
        );
    }
}
```

Filter/interceptor concept:

```java
public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) {
    Statistics stats = sessionFactory.getStatistics();
    HibernateStatsSnapshot before = HibernateStatsSnapshot.take(stats);
    long start = System.nanoTime();

    try {
        chain.doFilter(req, res);
    } finally {
        HibernateStatsSnapshot after = HibernateStatsSnapshot.take(stats);
        HibernateStatsDelta delta = before.diff(after);
        long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);

        OrmRequestLogger.log(RequestContext.current(), delta, durationMs);
    }
}
```

Caution:

- Global counters in concurrent application make exact per-request delta noisy.
- For strict per-request SQL count, use JDBC proxy/tracing per thread/request.
- Statistics delta still useful as trend or in lower environment.

### 5.5 Session Metrics Log

Hibernate can log session-level metrics such as JDBC connection acquisition, statement preparation/execution, flushes, L2 cache operations, etc., depending on configuration/version. This is very useful in dev/test/staging.

The important lesson:

```text
Do not only log SQL text.
Log session behavior: statement count, flush count, entity/collection count, cache count.
```

---

## 6. EclipseLink Profiling and Monitoring

EclipseLink has mature concepts around Session, UnitOfWork, logging, shared cache, and profiler.

### 6.1 EclipseLink Performance Profiler

EclipseLink documentation describes a performance profiler that logs performance statistics for every executed query in a session. This is especially useful to identify expensive query execution paths and session-level query behavior.

Conceptual config:

```properties
eclipselink.profiler=PerformanceProfiler
```

Or programmatically depending on deployment style.

The profiler can help answer:

- which query executed,
- how long it took,
- how many objects were built,
- cache interaction,
- time spent in different internal phases.

### 6.2 EclipseLink Logging Levels

Common levels:

```text
OFF
SEVERE
WARNING
INFO
CONFIG
FINE
FINER
FINEST
ALL
```

Commonly useful categories:

- SQL,
- transaction,
- cache,
- query,
- connection,
- metadata.

Example:

```properties
eclipselink.logging.level=INFO
eclipselink.logging.level.sql=FINE
eclipselink.logging.parameters=false
```

### 6.3 EclipseLink Session and Cache Observability

Because EclipseLink shared cache is central to its architecture, observability must include:

- cache hit/miss,
- identity map size,
- invalidation,
- refresh behavior,
- isolated vs shared entity settings,
- query cache if used.

Cache bugs can become data correctness bugs, not only performance bugs.

### 6.4 EclipseLink vs Hibernate Observability Difference

Hibernate observability often starts from:

```text
SessionFactory statistics + SQL logs + interceptors
```

EclipseLink observability often starts from:

```text
Session logging + profiler + descriptors/cache/session monitoring
```

Same goal, different hooks.

---

## 7. Metrics: What to Measure Continuously

Logs are too expensive and too verbose to answer aggregate questions. Production needs metrics.

### 7.1 Request-Level ORM Metrics

Recommended per endpoint/use case:

| Metric | Type | Meaning |
|---|---|---|
| `orm.sql.count` | distribution | SQL statements per request |
| `orm.sql.duration` | timer | total SQL time per request |
| `orm.flush.count` | counter/distribution | flushes per request |
| `orm.flush.duration` | timer | flush cost |
| `orm.entity.load.count` | distribution | hydrated entity count |
| `orm.collection.fetch.count` | distribution | collection lazy fetch count |
| `orm.l2.hit.count` | counter | second-level cache hits |
| `orm.l2.miss.count` | counter | second-level cache misses |
| `orm.connection.wait` | timer | wait time acquiring JDBC connection |
| `orm.optimistic.failure` | counter | optimistic lock failures |
| `orm.pessimistic.timeout` | counter | lock timeout |

### 7.2 SQL Shape Metrics

Per SQL fingerprint:

| Metric | Meaning |
|---|---|
| execution count | frequency |
| p50/p95/p99 duration | latency profile |
| error count | failures |
| rows returned | result size |
| source endpoint | causality |
| source use case | owner |
| table touched | blast radius |

Example metric dimensions:

```text
sql_hash=9f14ab32
operation=SELECT
main_table=CASE_FILE
provider=hibernate
endpoint=/cases/{id}/summary
```

Be careful with high-cardinality labels. Do not put raw SQL or entity id in metric labels.

### 7.3 Cache Metrics

For L2 cache:

```text
hit ratio = hits / (hits + misses)
```

But hit ratio alone is dangerous.

A 99% hit ratio may still be bad if:

- stale data correctness is wrong,
- misses occur on the hottest endpoint,
- cache puts are huge,
- invalidation causes cluster storm,
- cache region memory grows without bound.

Measure:

- hit,
- miss,
- put,
- evict,
- region size,
- entry count,
- eviction reason,
- serialization cost if distributed,
- cross-tenant isolation if multi-tenant.

### 7.4 Flush Metrics

Flush is where ORM writes become SQL. Track:

- flush count,
- flush duration,
- entity inserts,
- entity updates,
- entity deletes,
- collection recreates,
- collection updates,
- collection removes,
- statement batch count,
- optimistic failures.

Unexpected flush during read endpoint is a red flag.

### 7.5 Connection Pool Metrics

For HikariCP-like pools:

- active,
- idle,
- pending,
- max,
- acquisition time,
- timeout count,
- usage duration,
- creation count,
- leak detection warnings.

Interpretation:

| Symptom | Possible meaning |
|---|---|
| high pending threads | pool starvation |
| high acquisition time | connections held too long or DB slow |
| active=max constantly | pool saturated |
| idle=0 often | not enough pool or too slow DB |
| connection timeout | user-facing failures likely |
| long usage duration | transaction too wide / slow query / remote call inside tx |

### 7.6 Database Metrics

At minimum:

- CPU,
- active sessions,
- waits,
- locks,
- deadlocks,
- slow SQL,
- buffer reads,
- physical reads,
- temp usage,
- redo/log writes,
- row lock wait.

ORM metric without DB metric often ends with wrong fix.

---

## 8. Distributed Tracing for ORM

Tracing answers:

> In this request, where was time spent?

A good trace shows:

```text
HTTP GET /cases/{id}/summary        480ms
  Auth filter                         20ms
  CaseSummaryService                 430ms
    Transaction begin                  2ms
    Repository.findById               12ms
      SQL select case_file             8ms
    DTO mapping                      350ms
      SQL select tasks                20ms
      SQL select assignee x 40       250ms
      SQL select comments x 40        70ms
    Transaction commit                 5ms
```

Without tracing, logs may show 82 SQL statements, but not why.

### 8.1 Span Design

Recommended spans:

- request/message span,
- service/use case span,
- transaction span,
- repository/query span,
- SQL/JDBC span,
- flush span if possible,
- cache span if significant,
- external call span.

### 8.2 SQL Span Attributes

Useful attributes:

```text
db.system=oracle/postgresql/mysql/mssql
db.operation=SELECT/INSERT/UPDATE/DELETE
db.sql.table=CASE_FILE
db.statement.hash=9f14ab32
orm.provider=hibernate
orm.entity=CaseFile
orm.use_case=GetCaseSummary
```

Avoid raw SQL with sensitive values.

### 8.3 Tracing Lazy Loading

Lazy loading often appears as SQL spans under unexpected parent span:

```text
DTOMapper.toResponse
  SQL select task_comment where task_id=?
  SQL select task_comment where task_id=?
  SQL select task_comment where task_id=?
```

This is excellent evidence that DTO mapping triggers N+1.

### 8.4 Tracing Flush

Flush can happen:

- before query,
- before commit,
- manual `flush()`.

If possible, instrument flush as separate span/event:

```text
orm.flush
  managed_entities=420
  inserts=0
  updates=35
  deletes=0
  collections_updated=12
```

This immediately reveals “read query is slow” was actually “flush before query is slow”.

---

## 9. SQL Count Assertions in Tests

Production observability is reactive. Tests can prevent regressions.

### 9.1 Why SQL Count Tests Matter

An endpoint may pass functional test but regress from 3 SQL to 303 SQL.

Functional output same. Production behavior catastrophic.

SQL count assertion catches this.

### 9.2 Test Pattern

Pseudo-test:

```java
@Test
void getCaseSummary_shouldNotExecuteMoreThanExpectedQueries() {
    sqlCounter.reset();

    CaseSummary result = service.getCaseSummary(caseId);

    assertThat(result).isNotNull();
    assertThat(sqlCounter.getSelectCount()).isLessThanOrEqualTo(5);
}
```

### 9.3 What to Assert

Good:

- maximum SELECT count,
- no SQL during JSON serialization,
- no flush in read-only use case,
- no collection fetch N+1,
- no update during GET/read use case.

Bad:

- asserting exact SQL string across provider versions,
- asserting too tightly on harmless provider difference,
- using H2 when production DB is Oracle/Postgres and query shape differs.

### 9.4 SQL Count for DTO Mapper Boundary

A powerful test:

```java
@Test
void mappingToResponse_shouldNotTriggerDatabaseAccess() {
    CaseFile caseFile = repository.loadForSummary(caseId);

    sqlCounter.reset();
    CaseSummaryResponse response = mapper.toResponse(caseFile);

    assertThat(sqlCounter.total()).isZero();
}
```

This enforces:

```text
Fetch plan must be explicit before leaving repository/application query boundary.
DTO mapping must not secretly lazy-load.
```

---

## 10. Diagnosing N+1 with Evidence

N+1 diagnosis should show pattern, not only count.

### 10.1 Signal

```text
Endpoint: GET /cases/search
SQL count: 251
Rows returned by root query: 50
Repeated SQL hash: a81cc12 executed 200 times
Parent span: CaseSearchResponseMapper.toDto
```

This is strong evidence.

### 10.2 Typical Log Pattern

```sql
select c.id, c.status from case_file c where c.status=? fetch first 50 rows only;

select t.id, t.case_id, t.status from task t where t.case_id=?;
select t.id, t.case_id, t.status from task t where t.case_id=?;
select t.id, t.case_id, t.status from task t where t.case_id=?;
...
```

### 10.3 Root Cause Classification

| Root cause | Fix direction |
|---|---|
| lazy collection accessed in loop | batch fetch, entity graph, DTO query |
| lazy `ManyToOne` accessed for each row | join fetch, batch fetch, projection |
| mapper touches full object graph | mapping boundary redesign |
| serializer touches lazy field | DTO response, Jackson Hibernate module with caution |
| OSIV hides lazy loading | disable OSIV / explicit fetch plan |

### 10.4 Do Not Fix Blindly with Join Fetch

Join fetch can cause cartesian explosion.

Example:

```text
50 cases
x 20 tasks
x 10 comments
= 10,000 joined rows
```

Maybe 251 SQL was bad, but 10,000 row duplication can also be bad.

Observability must measure:

- SQL count,
- rows returned,
- payload size,
- object hydration count,
- DB CPU,
- app memory.

---

## 11. Diagnosing Cartesian Explosion

Cartesian explosion happens when one query joins too many multi-valued associations.

### 11.1 Signal

```text
SQL count: 1
DB duration: 1.8s
Rows returned: 120,000
Root entities returned: 100
Heap allocation spike: 800MB
GC pause increased
```

A naive dashboard may say “only 1 query”, but it is terrible.

### 11.2 Query Shape

```sql
select c.*, t.*, cm.*, d.*
from case_file c
left join task t on t.case_id = c.id
left join comment cm on cm.task_id = t.id
left join document d on d.case_id = c.id
where c.status = ?
```

If average:

```text
case: 100
tasks/case: 20
comments/task: 5
documents/case: 10
```

Then row multiplication can become huge.

### 11.3 Fix Direction

- split query by aggregate boundary,
- batch fetch selected collections,
- use projection/read model,
- load root page first then secondary query by IDs,
- avoid multiple bag/multi-collection join fetch,
- use database-specific aggregation only when appropriate,
- use separate endpoint sections.

---

## 12. Diagnosing Slow Flush

Slow flush is commonly misdiagnosed because it occurs before a query or commit.

### 12.1 Symptom

```text
User clicks Save Case Status.
Endpoint takes 5 seconds.
Slow SQL log shows many updates.
Developer says: database slow.
```

But root cause may be:

- persistence context contains 10,000 managed entities,
- dirty checking scans too many snapshots,
- large collection diff,
- cascade merge of detached graph,
- audit listener loads extra data,
- batch disabled due to ID strategy,
- versioned update conflict retry.

### 12.2 Evidence to Capture

At flush:

```text
managed entity count
insert/update/delete count
collection recreate/update/remove count
flush duration
SQL count generated by flush
batch execution count
entity names updated
```

Hibernate statistics can help. Provider event listener can help in advanced setup.

### 12.3 Slow Flush Pattern

```text
Read phase loads huge graph.
User modifies one field.
Flush scans huge graph.
Many entities marked dirty due to mutable value/converter/equals issue.
Flush emits many updates.
```

### 12.4 Fix Direction

- reduce persistence context scope,
- use DTO projection for read-only views,
- split read/write use cases,
- avoid merging huge detached graph,
- use explicit update command,
- improve dirty tracking/enhancement if appropriate,
- fix mutable value type equality,
- flush/clear in batch jobs.

---

## 13. Diagnosing Unexpected Updates

Unexpected updates are serious because they can corrupt audit trail and trigger concurrency conflicts.

### 13.1 Signal

```text
GET /cases/{id} generated UPDATE statement
Read-only endpoint increments version
Audit table records change although user only viewed data
```

### 13.2 Common Causes

- entity listener changes field on load,
- getter mutates state,
- converter returns mutable object,
- collection helper normalizes collection during read,
- `@PreUpdate` side effect,
- timestamp updated by application incorrectly,
- bidirectional association sync inside getter,
- read service calls domain method that mutates,
- flush before query inside same transaction.

### 13.3 Evidence

Log flush with updated entity names:

```text
flush updates=1 entity=CaseFile id=CASE-123 dirtyFields=[lastViewedAt]
```

Hibernate can expose dirty attributes through interceptors/listeners/custom event handling in advanced setups. EclipseLink change tracking/profiler can help identify changed mappings.

### 13.4 Fix Direction

- no mutation in getter,
- separate command method from query method,
- use read-only transaction and provider read-only hint where appropriate,
- use DTO projection for read endpoint,
- mark immutable entities where appropriate,
- review lifecycle callbacks,
- enforce SQL count/no-update tests for read use cases.

---

## 14. Diagnosing Connection Pool Exhaustion

Connection pool exhaustion often looks like “database is slow”. It may be ORM transaction design.

### 14.1 Signal

```text
HikariPool-1 - Connection is not available, request timed out after 30000ms
active=max
idle=0
pending high
DB CPU moderate
```

If DB CPU is not high but pool is exhausted, likely connections are held too long.

### 14.2 Common ORM Causes

- transaction wraps remote API call,
- OSIV keeps session/connection longer than needed,
- stream result not closed,
- long-running batch transaction,
- lock wait inside transaction,
- slow query due to N+1,
- connection acquired early and released late,
- leak due to manual JDBC work inside ORM session.

### 14.3 Evidence

Need correlate:

```text
request duration
transaction duration
connection acquisition time
connection usage duration
SQL duration
remote call duration
```

If:

```text
transaction duration = 8s
SQL total = 200ms
remote call = 7s
```

then DB connection is being held while waiting for remote service. The fix is not increasing pool size.

### 14.4 Fix Direction

- move remote call outside DB transaction,
- reduce transaction boundary,
- use outbox pattern for side effects,
- paginate batch job,
- close streams,
- set query timeout,
- set lock timeout,
- inspect OSIV.

---

## 15. Diagnosing Stale Data and Cache Issues

Stale data diagnosis must distinguish:

- persistence context stale,
- second-level cache stale,
- query cache stale,
- database isolation snapshot,
- replica lag,
- application-level read model lag.

### 15.1 Persistence Context Stale

Within one persistence context:

```java
CaseFile c1 = em.find(CaseFile.class, id);
// external transaction updates row
CaseFile c2 = em.find(CaseFile.class, id);
```

`c1 == c2`, and state may remain old unless refreshed.

Evidence:

- same persistence context long-lived,
- no SQL on second find,
- refresh fixes issue.

Fix:

- shorten persistence context,
- use `refresh()` intentionally,
- avoid long conversational persistence context unless designed,
- use versioning.

### 15.2 L2 Cache Stale

Evidence:

- SQL not executed,
- L2 cache hit,
- DB row newer,
- cache region not invalidated,
- external writer bypasses ORM.

Fix:

- disable cache for frequently externally-updated entity,
- evict region on external update,
- use proper cache concurrency strategy,
- avoid query cache for volatile data,
- use database CDC/invalidation if needed.

### 15.3 Query Cache Stale

Query cache caches result identifiers/keys, not magically the entire truth. It depends on invalidation/update timestamps. Misuse can serve stale or misleading results depending on provider/cache strategy.

Good candidate:

- reference data,
- mostly static lookup,
- repeated query with same parameters.

Bad candidate:

- active case search,
- task inbox,
- workflow queue,
- compliance dashboard,
- user-specific volatile data.

---

## 16. Diagnosing Deadlocks and Lock Waits

ORM can cause deadlocks due to SQL ordering, cascade, flush timing, and inconsistent aggregate update order.

### 16.1 Signal

- database deadlock report,
- SQLState/vendor deadlock code,
- transaction rollback,
- user sees intermittent failure,
- high lock wait.

### 16.2 Evidence Needed

- deadlock graph from DB,
- SQL statements involved,
- transaction/use case for each side,
- entity/aggregate IDs,
- flush order,
- lock mode,
- indexes used,
- update order in code.

### 16.3 Common ORM Causes

- two transactions update same tables in different order,
- collection delete/reinsert pattern,
- cascading updates across large graph,
- missing index on FK causing lock escalation/wider scans,
- pessimistic lock order inconsistent,
- bulk update competes with entity update,
- flush before query acquires locks earlier than expected.

### 16.4 Fix Direction

- enforce deterministic update order,
- reduce aggregate boundary,
- add proper indexes,
- avoid collection wholesale replacement,
- use optimistic locking where possible,
- set lock timeout,
- retry idempotent transaction safely,
- split large transaction.

---

## 17. Diagnosing Memory Bloat from ORM

ORM memory issues usually come from object hydration and persistence context retention.

### 17.1 Signal

```text
Heap usage grows during batch job.
GC pressure high.
No obvious Java collection leak.
Hibernate Session / persistence context contains many entities.
```

### 17.2 Common Causes

- batch job loads entities without `clear()`,
- huge read query returns entities instead of projection,
- join fetch duplicates rows and hydrates big graph,
- L2 cache region too large,
- collection loaded accidentally,
- OSIV keeps session until view serialization,
- DTO mapper retains entity graph.

### 17.3 Evidence

- entity load count,
- persistence context managed entity count,
- heap dump dominator tree,
- collection wrapper count,
- query result size,
- endpoint trace memory allocation if available.

### 17.4 Fix Direction

- projection for read-only screen,
- pagination/keyset pagination,
- stream carefully with transaction and fetch size,
- flush/clear batch loop,
- stateless session for suitable bulk work,
- disable unnecessary L2 cache region,
- split graph loading.

---

## 18. Safe Production SQL Logging Policy

A mature team defines logging policy before incident.

### 18.1 Default Production

Default:

```text
SQL shape/fingerprint: enabled
SQL duration: enabled
SQL count per request: enabled
Bind values: disabled/redacted
Slow query sample: enabled
Trace correlation: enabled
Entity/collection stats: sampled or endpoint-level
```

### 18.2 Diagnostic Window

During incident, temporarily enable:

```text
specific endpoint/use case
specific user/session only if allowed
specific SQL hash
limited duration
redacted bind values
higher sampling
```

Never enable full bind logging globally for sensitive systems.

### 18.3 Redaction Rules

Redact:

- identity numbers,
- email,
- phone,
- address,
- free text,
- tokens/secrets,
- document content,
- complaint text,
- legal notes.

Safer representation:

```text
param[1]=CASE_ID(hash=ab31)
param[2]=STATUS(value=APPROVED)
param[3]=TEXT(redacted,length=482)
```

### 18.4 Retention Rules

SQL diagnostic logs may become sensitive operational data. Define:

- retention period,
- access control,
- masking,
- incident reference,
- deletion policy.

---

## 19. Observability for Regulatory / Case Management Systems

For regulatory systems, observability is not just performance. It supports defensibility.

You need to prove:

- which use case changed a case,
- which transaction wrote audit trail,
- whether stale data was served,
- whether a workflow transition happened once,
- whether retry caused duplicate side effect,
- whether concurrent approval was prevented,
- whether task inbox query is complete and timely,
- whether archival/query model lag caused user-visible issue.

### 19.1 Case Management Observability Dimensions

| Dimension | Example |
|---|---|
| Case id | `CASE-2026-000123` |
| Module | Application, Compliance, Appeal, Enforcement |
| Use case | Approve application, assign officer, issue notice |
| Actor | officer/system/batch, but avoid overlogging PII |
| Transaction | command id, correlation id |
| State transition | `DRAFT -> SUBMITTED -> UNDER_REVIEW` |
| ORM action | insert/update/delete/lazy load/flush |
| SQL shape | update `CASE_FILE`, insert `AUDIT_TRAIL` |
| Outcome | committed/rolled back/optimistic conflict |

### 19.2 Audit Trail vs Observability Log

Do not confuse audit trail with observability log.

Audit trail:

```text
business/legal record of what changed
```

Observability log:

```text
technical evidence of how system executed
```

Audit trail should not depend only on SQL logs. SQL logs are operational, not business evidence.

---

## 20. Java 8–25 Compatibility Notes

### 20.1 Java 8 Legacy Stack

Common stack:

```text
Java 8
JPA 2.1/2.2 javax.persistence
Hibernate 5.x or EclipseLink 2.x
Spring Boot 1/2 or Jakarta EE/Java EE container
```

Observability notes:

- logging categories differ,
- older Hibernate statistics APIs differ slightly,
- OpenTelemetry support may require more manual integration,
- MDC thread-local works for servlet threads but not automatically for async/reactive,
- bytecode/proxy behavior may differ,
- javax namespace.

### 20.2 Java 11/17 Modern Baseline

Common transition:

```text
Java 11/17
Jakarta Persistence 3.x
Hibernate 6.x or EclipseLink 4.x
Spring Boot 3.x / Jakarta EE 10/11
```

Observability notes:

- namespace is `jakarta.persistence`,
- Hibernate 6 query/type/dialect internals changed from 5.x,
- logging categories changed,
- Micrometer/OpenTelemetry integration is easier,
- structured logging expected,
- container/cloud metrics normal.

### 20.3 Java 21/25 Modern Runtime

Common direction:

```text
Java 21/25
Hibernate 6/7 or EclipseLink 4/5 depending platform alignment
virtual threads possible in surrounding application
modern GC and container runtime
```

Observability notes:

- do not assume ThreadLocal/MDC propagation works automatically across all async/virtual-thread boundaries,
- connection pool sizing model may change if virtual threads increase concurrency,
- database is still finite even if Java can create many virtual threads,
- tracing context propagation becomes more important,
- allocation profiling is useful because ORM hydration creates many objects,
- Java Flight Recorder can help identify allocation/lock/blocking hotspots.

### 20.4 Virtual Threads Warning

Virtual threads can make blocking cheaper for Java threads, but they do not make database connections infinite.

Bad interpretation:

```text
We use virtual threads, so ORM blocking is fine and pool can be huge.
```

Correct interpretation:

```text
Virtual threads reduce platform-thread pressure, but DB connection, transaction duration, lock contention, query plan, and row scan remain hard constraints.
```

Metrics still must track:

- active connections,
- pending connection acquisition,
- DB active sessions,
- transaction duration,
- SQL count per request.

---

## 21. Anti-Patterns

## 21.1 `show_sql=true` in Production and Calling It Observability

Problem:

- noisy,
- unstructured,
- no correlation,
- no duration,
- possible sensitive leak.

Better:

- SQL fingerprint,
- duration,
- trace id,
- request/use case,
- slow SQL sampling.

## 21.2 Logging Bind Values Globally

Problem:

- PII leakage,
- credential leakage,
- compliance risk.

Better:

- redaction,
- controlled diagnostic window,
- hash selected identifiers.

## 21.3 Only Looking at Slow Query Log

Slow query log misses:

- N+1 many fast queries,
- connection wait,
- slow flush before query,
- object hydration CPU,
- cache miss storm,
- app-side mapping overhead.

## 21.4 Increasing Connection Pool Without Causality

If connection pool exhausted because transactions hold connection during remote calls, increasing pool delays failure and increases DB pressure.

## 21.5 Treating Cache Hit Ratio as Success

High cache hit ratio can hide stale data, tenant leakage, or wrong cache region.

## 21.6 Not Testing SQL Count

Functional tests pass while performance collapses.

## 21.7 No Request Correlation

SQL logs without request id are often useless during incident.

## 21.8 Ignoring Flush

Many “slow query” problems are slow flush problems.

---

## 22. Production Diagnosis Playbooks

## 22.1 Endpoint Slow

Checklist:

```text
1. Which endpoint/use case?
2. p95/p99 latency increased or all requests?
3. SQL count per request changed?
4. Total SQL duration vs total request duration?
5. Connection wait time?
6. Flush count/duration?
7. Entity/collection load count?
8. Repeated SQL hash?
9. DB execution plan changed?
10. Recent deploy/schema/index/statistics change?
```

Decision:

| Evidence | Likely root |
|---|---|
| many repeated SQL | N+1 |
| one SQL many rows | cartesian / missing filter / large result |
| SQL time low, request high | mapping/serialization/remote call |
| connection wait high | pool starvation |
| flush high before query | dirty checking / persistence context |
| DB CPU high | query plan/index/row scan |
| lock wait high | concurrency/transaction order |

## 22.2 DB CPU High

Checklist:

```text
1. Top SQL by CPU/elapsed?
2. Which app endpoint generates it?
3. SQL hash introduced recently?
4. Execution count increased or per-execution cost increased?
5. Rows scanned vs returned?
6. Index used?
7. Bind parameter selectivity issue?
8. ORM fetch plan changed?
9. Batch job running?
10. Query cache disabled/enabled recently?
```

Fix candidates:

- index,
- query rewrite,
- projection,
- pagination,
- fetch plan redesign,
- batch job throttling,
- statistics refresh,
- plan stability management.

## 22.3 Connection Pool Exhausted

Checklist:

```text
1. Active=max?
2. Pending threads?
3. Acquisition p95/p99?
4. Longest connection usage?
5. Transaction duration?
6. SQL duration inside transaction?
7. Remote calls inside transaction?
8. Streaming result not closed?
9. Lock wait?
10. Recent traffic spike?
```

Fix candidates:

- reduce transaction duration,
- move remote call out of transaction,
- close streams,
- optimize slow SQL,
- split batch transaction,
- tune pool only after root cause.

## 22.4 Stale Data

Checklist:

```text
1. Same transaction/persistence context?
2. L2 cache enabled for entity?
3. Query cache involved?
4. External writer bypassing ORM?
5. Replica/read model lag?
6. Isolation level snapshot?
7. Missing refresh/clear?
8. Tenant/cache region issue?
```

Fix candidates:

- shorter persistence context,
- cache eviction/invalidation,
- disable cache for volatile entity,
- version checks,
- read-after-write routing,
- refresh intentionally.

## 22.5 Unexpected Delete

Checklist:

```text
1. Which request/use case committed delete?
2. Was delete direct, cascade, orphanRemoval, or DB ON DELETE?
3. Which entity graph was managed/merged?
4. Was collection replaced wholesale?
5. Was shared child incorrectly modeled as owned?
6. Did lifecycle listener remove entity?
7. Was soft delete filter involved?
```

Fix candidates:

- audit ORM action source,
- remove cascade remove across aggregate boundary,
- fix orphan semantics,
- avoid detached graph merge,
- command-based child removal,
- DB FK restrictions.

---

## 23. Implementation Blueprint

This is a practical observability blueprint for enterprise ORM applications.

### 23.1 Baseline Always-On

Enable:

- request id / trace id,
- structured logs,
- connection pool metrics,
- datasource/JDBC timing,
- slow SQL log with SQL hash,
- SQL count per request sampling,
- DB top SQL monitoring,
- error SQLState/vendor code,
- transaction duration metric.

Avoid by default:

- global bind parameter logging,
- full SQL text as high-cardinality metric label,
- stack trace for every query,
- DEBUG SQL logging permanently.

### 23.2 Lower Environment Deep Diagnostics

Enable in dev/staging/performance:

- Hibernate statistics,
- EclipseLink profiler,
- SQL bind values with test data,
- query plan capture,
- SQL count tests,
- N+1 detection,
- flush stats,
- heap allocation profiling.

### 23.3 Incident Mode

Enable temporarily:

- SQL logs for specific module/use case,
- bind redaction,
- trace sampling 100% for affected endpoint,
- database execution plan capture,
- lock/deadlock diagnostics,
- connection pool leak detection,
- per-request ORM counters.

### 23.4 Post-Incident Hardening

After fixing:

- add SQL count regression test,
- add dashboard alert,
- add query/fetch plan documentation,
- add migration/index note,
- add production runbook entry,
- add ownership to SQL hash/use case.

---

## 24. Example: Building a Minimal ORM Observation Layer

### 24.1 Request Context

```java
public final class RequestContext {
    private static final ThreadLocal<Context> CURRENT = new ThreadLocal<>();

    public static void set(Context context) {
        CURRENT.set(context);
    }

    public static Context currentOrUnknown() {
        Context context = CURRENT.get();
        return context != null ? context : Context.unknown();
    }

    public static void clear() {
        CURRENT.remove();
    }

    public record Context(
        String requestId,
        String traceId,
        String module,
        String useCase,
        String tenant
    ) {
        static Context unknown() {
            return new Context("unknown", "unknown", "unknown", "unknown", "unknown");
        }
    }
}
```

Caution:

- ThreadLocal must be cleared.
- Async execution needs propagation.
- Virtual threads need explicit context strategy depending framework.

### 24.2 SQL Fingerprint

```java
public final class SqlFingerprint {

    public static String fingerprint(String sql) {
        String normalized = sql
            .replaceAll("'[^']*'", "?")
            .replaceAll("\\b\\d+\\b", "?")
            .replaceAll("\\s+", " ")
            .trim()
            .toLowerCase(Locale.ROOT);

        return sha256Short(normalized);
    }

    private static String sha256Short(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 6; i++) {
                sb.append(String.format("%02x", bytes[i]));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
```

### 24.3 Hibernate StatementInspector

```java
public final class ObservedStatementInspector implements StatementInspector {

    @Override
    public String inspect(String sql) {
        RequestContext.Context context = RequestContext.currentOrUnknown();
        String hash = SqlFingerprint.fingerprint(sql);

        OrmSqlShapeRecorder.record(
            context.requestId(),
            context.traceId(),
            context.module(),
            context.useCase(),
            hash,
            inferOperation(sql),
            inferMainTableBestEffort(sql)
        );

        return sql;
    }

    private String inferOperation(String sql) {
        String s = sql.stripLeading().toLowerCase(Locale.ROOT);
        if (s.startsWith("select")) return "SELECT";
        if (s.startsWith("insert")) return "INSERT";
        if (s.startsWith("update")) return "UPDATE";
        if (s.startsWith("delete")) return "DELETE";
        return "OTHER";
    }

    private String inferMainTableBestEffort(String sql) {
        // In real production code, use a proper parser or keep this best-effort only.
        return "unknown";
    }
}
```

### 24.4 SQL Count Guard

```java
public final class SqlCountGuard {
    private static final ThreadLocal<Integer> COUNT = ThreadLocal.withInitial(() -> 0);

    public static void increment() {
        COUNT.set(COUNT.get() + 1);
    }

    public static int get() {
        return COUNT.get();
    }

    public static void reset() {
        COUNT.set(0);
    }

    public static void clear() {
        COUNT.remove();
    }
}
```

Can be wired through:

- JDBC proxy,
- Hibernate StatementInspector for shape count only,
- datasource proxy listener,
- test extension.

### 24.5 Endpoint Threshold Alert

Example policy:

```text
GetCaseSummary:
  max_select_count_p95: 10
  max_total_sql_duration_p95: 100ms
  max_entity_load_p95: 50

SearchCases:
  max_select_count_p95: 5
  max_total_sql_duration_p95: 500ms
  max_rows_returned: page_size * bounded_multiplier

UpdateCaseStatus:
  max_flush_count: 1
  max_update_count_expected: 3
  optimistic_failure_expected: low but tracked
```

Do not use one global threshold for all endpoints. Different use cases have different legitimate ORM profiles.

---

## 25. Reading ORM Logs Like an Investigator

### 25.1 Bad Reading

```text
There are many SQL logs. Hibernate is bad.
```

### 25.2 Better Reading

```text
Endpoint `GET /cases/search` executes 1 root query and 100 repeated collection queries under DTO mapping. The repeated SQL hash is `a81cc12`, selecting from `TASK` by `case_id`. This is an N+1 introduced after mapper started accessing `case.tasks`. Fix should be explicit fetch plan or separate task-count projection, not global EAGER mapping.
```

### 25.3 Best Reading

```text
After release 2026.06.17, p95 latency for `GET /cases/search` increased from 320ms to 2.8s. SQL count p95 increased from 4 to 204. Trace shows repeated `select task where case_id=?` under `CaseSearchMapper.toDto`. DB CPU increased due to high execution count, but each query is individually fast. Root cause is mapper access to lazy collection. We will replace entity response mapping with DTO projection containing task count and add SQL count regression test <= 5.
```

This is evidence-driven.

---

## 26. Design Rules

1. Every production SQL should be attributable to a request/use case/batch job.
2. SQL text without duration is incomplete.
3. SQL duration without SQL count is incomplete.
4. SQL count without row count can hide cartesian explosion.
5. Slow query log alone cannot detect N+1.
6. Flush must be observable separately from query execution.
7. Bind values must be treated as sensitive data.
8. Cache metrics must be interpreted with correctness, not only hit ratio.
9. Connection pool metrics are ORM metrics too.
10. DTO mapping should not trigger database access unless intentionally designed.
11. Read endpoints should have no unexpected writes.
12. Batch jobs need persistence context size observability.
13. Provider statistics should be used in lower environments and selectively in production.
14. Database execution plans must be linked to ORM-generated SQL shape.
15. Every fixed ORM incident should produce a regression test or dashboard guard.

---

## 27. Diagnostic Checklist

### 27.1 For Any ORM Production Incident

```text
[ ] What exact endpoint/use case/job is affected?
[ ] What changed recently? deploy, mapping, query, schema, index, data volume, provider version?
[ ] SQL count per request?
[ ] Top repeated SQL hash?
[ ] Top slow SQL hash?
[ ] Total SQL time vs request time?
[ ] Flush count and duration?
[ ] Entity load count?
[ ] Collection fetch count?
[ ] L2 cache hit/miss/put?
[ ] Connection acquisition wait?
[ ] Transaction duration?
[ ] DB execution plan/wait events?
[ ] Any lock/deadlock?
[ ] Any unexpected update/delete?
[ ] Any lazy loading during serialization/mapping?
[ ] Any external writer/cache invalidation issue?
```

### 27.2 For Performance Regression

```text
[ ] Compare before/after SQL count.
[ ] Compare before/after SQL hash set.
[ ] Compare before/after p95/p99 SQL duration.
[ ] Compare entity/collection load count.
[ ] Compare heap allocation/GC.
[ ] Compare DB rows scanned/returned.
[ ] Compare connection wait time.
[ ] Compare cache hit/miss.
[ ] Check query plan changed.
[ ] Check data volume changed.
```

### 27.3 For Correctness Incident

```text
[ ] Was data stale or wrongly written?
[ ] Was persistence context reused too long?
[ ] Was L2/query cache involved?
[ ] Was merge called with detached graph?
[ ] Was cascade/orphanRemoval involved?
[ ] Was version check present?
[ ] Was bulk update/delete used?
[ ] Was native query bypassing filters/cache/version?
[ ] Was transaction rolled back or committed?
[ ] Does audit trail match ORM action log?
```

---

## 28. Practice Scenarios

### Scenario 1: Read Endpoint Executes Update

You see:

```text
GET /cases/123
SQL:
select ... from case_file where id=?
update case_file set last_accessed_at=?, version=? where id=? and version=?
```

Questions:

1. Which code mutates `lastAccessedAt`?
2. Is it in getter, mapper, listener, domain method, or audit hook?
3. Should view tracking be part of same entity?
4. Should it use separate table/event instead?
5. Should read endpoint be DTO projection?

### Scenario 2: Search Endpoint Has 1 Query but Is Slow

You see:

```text
SQL count=1
rows returned=80,000
root result=100 cases
heap spike=600MB
```

Likely:

- cartesian explosion from join fetching multiple collections.

Fix:

- split fetch,
- projection,
- batch fetch,
- separate endpoint detail loading.

### Scenario 3: Connection Pool Exhaustion During Integration Call

Trace:

```text
transaction=8s
SQL total=100ms
external call=7.5s
connection active duration=8s
```

Likely:

- transaction wraps external call.

Fix:

- move external call before/after transaction,
- use outbox,
- split command phases.

### Scenario 4: Batch Job OutOfMemory

Metrics:

```text
processed rows=200,000
managed entities increasing linearly
flush count=1 at end
```

Likely:

- no flush/clear loop.

Fix:

```java
for (int i = 0; i < items.size(); i++) {
    process(items.get(i));
    if (i % 500 == 0) {
        em.flush();
        em.clear();
    }
}
```

Or use provider-specific stateless/bulk strategy if lifecycle/cascade not needed.

### Scenario 5: User Sees Old Case Status

Facts:

```text
DB row status=APPROVED
API returns status=UNDER_REVIEW
No SQL executed on second read
L2 cache hit observed
```

Likely:

- persistence context or L2 cache stale.

Need determine:

- same request/session?
- external writer?
- cache invalidation?
- read replica?

---

## 29. Summary

ORM observability is not about making logs verbose. It is about reconstructing causality.

A production-grade persistence engineer must be able to answer:

```text
Which business operation caused this SQL?
Why did this SQL execute?
Was it explicit query, lazy load, or flush?
How many times did it execute?
How many rows did it return and scan?
How many objects did ORM hydrate?
Was cache involved?
Was connection pool waiting?
Was database locked or scanning?
Was transaction boundary correct?
Did the behavior match the use case contract?
```

Key mental models:

- SQL logging is necessary but insufficient.
- Metrics reveal volume and trend.
- Tracing reveals causality.
- Provider statistics reveal ORM internal behavior.
- Database plans reveal execution mechanics.
- Cache metrics must be judged by correctness, not hit ratio alone.
- Flush must be observable as a first-class event.
- SQL count tests prevent performance regressions.
- Production logging must protect sensitive data.

If earlier parts taught how ORM works, this part teaches how to prove what ORM did in production.

---

## 30. References

- Jakarta Persistence 3.2 specification and API documentation.
- Hibernate ORM documentation and User Guide.
- Hibernate `StatementInspector` Javadocs.
- Hibernate statistics and SessionFactory monitoring concepts.
- EclipseLink documentation for logging, profiling, sessions, and performance monitoring.
- OpenTelemetry semantic conventions for database spans.
- Connection pool metrics practices, especially HikariCP-style active/idle/pending/acquisition metrics.
- Database execution plan and wait-event tooling for Oracle, PostgreSQL, MySQL/MariaDB, and SQL Server.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./26-hibernate-vs-eclipselink-behavioral-differences-that-matter.md">⬅️ Part 26 — Hibernate vs EclipseLink: Behavioral Differences That Matter</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./28-performance-engineering-cost-model-object-graph-to-database-work.md">Part 28 — Performance Engineering: Cost Model from Object Graph to Database Work ➡️</a>
</div>
