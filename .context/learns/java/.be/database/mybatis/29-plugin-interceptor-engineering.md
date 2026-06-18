# Part 29 — Plugin and Interceptor Engineering

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `29-plugin-interceptor-engineering.md`  
> Target: Java 8 sampai Java 25  
> Status: Advanced

---

## 0. Tujuan Pembelajaran

Di bagian sebelumnya kita sudah membahas mapper design, dynamic SQL, transaction, caching, observability, testing, security, multi-tenancy, large result, dan governance codebase besar. Sekarang kita masuk ke salah satu extension point MyBatis yang paling kuat sekaligus paling berbahaya: **plugin/interceptor**.

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. memahami posisi plugin dalam pipeline eksekusi MyBatis;
2. membedakan kapan interceptor layak dipakai dan kapan harus dihindari;
3. memilih interception point yang benar: `Executor`, `StatementHandler`, `ParameterHandler`, atau `ResultSetHandler`;
4. membuat interceptor yang aman, deterministic, testable, dan observable;
5. memahami risiko SQL mutation tersembunyi;
6. mendesain interceptor untuk logging, metrics, tenant guardrail, data masking, audit, pagination, dan security check;
7. menilai failure mode plugin di production;
8. menerapkan governance agar plugin tidak menjadi “magic global behavior” yang merusak maintainability.

---

## 1. Mental Model: Apa Itu Plugin MyBatis?

MyBatis plugin adalah mekanisme untuk **menginterupsi method call tertentu di dalam runtime MyBatis**.

Secara sederhana:

```text
Mapper Method
  -> MappedStatement
  -> Executor
  -> StatementHandler
  -> ParameterHandler
  -> JDBC PreparedStatement/CallableStatement
  -> Database
  -> ResultSetHandler
  -> Java Object
```

Plugin memungkinkan kita menyisipkan logic di titik tertentu dalam pipeline itu.

Dokumentasi resmi MyBatis menjelaskan bahwa plugin dapat mengintercept method call pada empat interface utama:

```text
Executor
ParameterHandler
ResultSetHandler
StatementHandler
```

Masing-masing punya method tertentu yang bisa diintercept, misalnya `Executor.update`, `Executor.query`, `StatementHandler.prepare`, `ParameterHandler.setParameters`, dan `ResultSetHandler.handleResultSets`.

Poin penting:

> Plugin bukan “event listener biasa”. Plugin masuk ke pipeline eksekusi SQL. Kesalahan kecil bisa memengaruhi semua query aplikasi.

---

## 2. Kenapa Plugin Menarik?

Plugin terlihat menarik karena memberi kontrol global.

Contoh kebutuhan:

- log semua SQL;
- hitung durasi query;
- tambahkan metric per mapper statement;
- enforce tenant predicate;
- enforce soft-delete predicate;
- rewrite pagination;
- mask field sensitif;
- audit DML;
- capture affected rows;
- menolak query tanpa scope;
- inject comment/correlation id ke SQL;
- validasi statement id naming convention;
- block full table update/delete;
- trace query count per request;
- deteksi N+1.

Namun kekuatan ini punya harga:

- behavior menjadi tersembunyi;
- SQL di XML tidak lagi sama dengan SQL final;
- debugging makin sulit;
- test harus mencakup plugin chain;
- performa bisa turun;
- plugin order bisa memengaruhi hasil;
- bug plugin bisa berdampak sistemik;
- security interceptor yang salah bisa memberi rasa aman palsu.

---

## 3. Prinsip Utama Plugin Engineering

Plugin MyBatis harus diperlakukan seperti infrastructure component, bukan helper biasa.

Gunakan prinsip berikut:

```text
Explicit over magical.
Observable over invisible.
Fail-fast over silent bypass.
Narrow scope over global mutation.
Validation before rewriting.
Testing before rollout.
```

Plugin yang baik biasanya:

- punya tujuan spesifik;
- tidak mengubah semantik SQL tanpa alasan kuat;
- mudah dimatikan dengan konfigurasi;
- logikanya deterministic;
- tidak bergantung pada request object secara langsung;
- tidak menyimpan mutable state per request di field instance;
- thread-safe;
- punya metric dan log saat menolak/mengubah query;
- diuji dengan query nyata, bukan hanya unit test mock.

---

## 4. Titik Intercept Resmi MyBatis

### 4.1 `Executor`

`Executor` adalah layer yang mengeksekusi mapped statement.

Bisa dipakai untuk:

- mengukur durasi query/update;
- menghitung query count per request;
- membaca `MappedStatement.getId()`;
- membedakan command type: SELECT/INSERT/UPDATE/DELETE;
- menolak statement tertentu;
- audit DML;
- enforce naming convention;
- capture rows affected;
- tagging metric per statement id.

Cocok untuk observability dan high-level governance.

Contoh method umum:

```text
Executor.query(...)
Executor.update(...)
Executor.flushStatements(...)
Executor.commit(...)
Executor.rollback(...)
```

Kelebihan:

- punya akses ke `MappedStatement`;
- tahu statement id;
- relatif cocok untuk metrics;
- tidak perlu memanipulasi SQL string.

Kekurangan:

- tidak selalu mudah mengakses SQL final;
- query overload method bisa berbeda;
- jika terlalu banyak logic, semua mapper terdampak.

---

### 4.2 `StatementHandler`

`StatementHandler` menangani pembuatan dan eksekusi JDBC statement.

Bisa dipakai untuk:

- membaca `BoundSql` final;
- menambahkan SQL comment;
- pagination rewrite;
- block SQL shape berbahaya;
- inspect final SQL untuk tenant predicate;
- set query timeout/fetch size secara dinamis;
- vendor-specific SQL mutation.

Contoh method:

```text
StatementHandler.prepare(Connection, Integer)
StatementHandler.parameterize(Statement)
StatementHandler.query(Statement, ResultHandler)
StatementHandler.update(Statement)
StatementHandler.batch(Statement)
```

Kelebihan:

- dekat dengan SQL final;
- cocok untuk SQL inspection;
- bisa melihat `BoundSql`.

Kekurangan:

- SQL rewriting sangat rapuh;
- struktur internal seperti `RoutingStatementHandler` sering membutuhkan unwrapping;
- manipulasi `BoundSql.sql` biasanya memakai reflection jika tidak dirancang hati-hati;
- plugin pagination custom bisa kalah stabil dibanding query eksplisit.

---

### 4.3 `ParameterHandler`

`ParameterHandler` bertanggung jawab mengisi parameter ke `PreparedStatement`.

Bisa dipakai untuk:

- inspect parameter object;
- masking atau encryption sebelum binding;
- validasi parameter wajib;
- dynamic tenant context injection;
- observability parameter shape.

Contoh method:

```text
ParameterHandler.getParameterObject()
ParameterHandler.setParameters(PreparedStatement)
```

Kelebihan:

- dekat dengan proses binding;
- bisa digunakan untuk parameter-level policy.

Kekurangan:

- raw mutation parameter object bisa sangat berbahaya;
- sulit membedakan intentional null vs absent;
- jangan dipakai untuk business validation;
- encryption/decryption di sini bisa membuat data contract tersembunyi.

---

### 4.4 `ResultSetHandler`

`ResultSetHandler` menangani mapping `ResultSet` menjadi object.

Bisa dipakai untuk:

- post-processing result;
- decrypt field;
- masking output;
- metrics jumlah row;
- guard result size;
- transform result tertentu.

Contoh method:

```text
ResultSetHandler.handleResultSets(Statement)
ResultSetHandler.handleOutputParameters(CallableStatement)
```

Kelebihan:

- berada setelah database mengembalikan result;
- bisa mengukur jumlah result object;
- bisa cocok untuk masking/decryption tertentu.

Kekurangan:

- post-processing global sangat rawan;
- masking di result layer bisa terlambat jika field sudah ter-log sebelumnya;
- bisa merusak type safety;
- bisa mahal untuk result besar.

---

## 5. Anatomy Interceptor

Contoh skeleton interceptor:

```java
import org.apache.ibatis.executor.Executor;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.plugin.Interceptor;
import org.apache.ibatis.plugin.Intercepts;
import org.apache.ibatis.plugin.Invocation;
import org.apache.ibatis.plugin.Signature;

@Intercepts({
    @Signature(
        type = Executor.class,
        method = "update",
        args = {MappedStatement.class, Object.class}
    )
})
public final class UpdateMetricsInterceptor implements Interceptor {

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        long startNanos = System.nanoTime();
        MappedStatement ms = (MappedStatement) invocation.getArgs()[0];

        try {
            Object result = invocation.proceed();
            long elapsedNanos = System.nanoTime() - startNanos;

            // record metric: ms.getId(), elapsedNanos, result rows affected
            return result;
        } catch (Throwable ex) {
            long elapsedNanos = System.nanoTime() - startNanos;

            // record error metric: ms.getId(), ex class, elapsedNanos
            throw ex;
        }
    }
}
```

Komponen penting:

- `@Intercepts`: daftar signature yang diintercept.
- `@Signature`: target type, method, dan argument types.
- `intercept(Invocation)`: logic sebelum/sesudah invocation.
- `invocation.proceed()`: melanjutkan pipeline MyBatis.

Rule paling penting:

> Jika tidak memanggil `invocation.proceed()`, berarti kamu memutus eksekusi MyBatis.

Itu kadang valid, misalnya circuit breaker internal, tetapi hampir selalu berbahaya.

---

## 6. Registrasi Plugin

### 6.1 XML Configuration

```xml
<configuration>
  <plugins>
    <plugin interceptor="com.example.mybatis.UpdateMetricsInterceptor">
      <property name="enabled" value="true"/>
    </plugin>
  </plugins>
</configuration>
```

### 6.2 Spring Boot Bean

Pada integrasi Spring Boot, interceptor dapat diregistrasi sebagai bean dan dimasukkan ke konfigurasi MyBatis melalui auto-configuration/customizer.

Contoh:

```java
@Configuration
public class MyBatisPluginConfig {

    @Bean
    public Interceptor updateMetricsInterceptor() {
        return new UpdateMetricsInterceptor();
    }
}
```

Untuk konfigurasi lebih eksplisit:

```java
@Bean
ConfigurationCustomizer mybatisConfigurationCustomizer(
        UpdateMetricsInterceptor interceptor
) {
    return configuration -> configuration.addInterceptor(interceptor);
}
```

Untuk multi-datasource, jangan asal global bean. Pastikan interceptor didaftarkan ke `SqlSessionFactory` yang tepat.

---

## 7. Plugin Order

Jika ada banyak plugin, order bisa memengaruhi hasil.

Misalnya:

```text
TenantSqlGuardInterceptor
PaginationRewriteInterceptor
SqlMetricsInterceptor
```

Pertanyaan penting:

- Apakah metrics mengukur SQL sebelum atau sesudah rewrite?
- Apakah tenant guard berjalan sebelum pagination wrapper?
- Apakah SQL comment ditambahkan sebelum atau sesudah query hash dihitung?
- Apakah masking berjalan sebelum logging?

Rule:

```text
Validation and guardrail should happen before transformation.
Transformation should happen before execution.
Observation should be explicit about pre/post state.
```

Contoh order yang lebih aman:

```text
1. statement metadata validation
2. tenant/security guard validation
3. safe SQL transformation if absolutely needed
4. metrics/logging around execution
5. result post-processing if necessary
```

---

## 8. Use Case 1 — Metrics Interceptor

Metrics adalah salah satu penggunaan plugin yang paling defensible.

Tujuan:

- ukur durasi query/update;
- tag by statement id;
- tag by command type;
- tag by success/error;
- record affected rows untuk DML;
- record query count per request.

Contoh high-level design:

```text
Executor.query/update intercepted
  -> read MappedStatement.id
  -> read SqlCommandType
  -> start timer
  -> proceed
  -> record duration
  -> record result size/affected rows if safe
  -> propagate exception unchanged
```

Contoh interceptor:

```java
@Intercepts({
    @Signature(
        type = Executor.class,
        method = "update",
        args = {MappedStatement.class, Object.class}
    )
})
public final class DmlMetricsInterceptor implements Interceptor {

    private final SqlMetricRecorder recorder;

    public DmlMetricsInterceptor(SqlMetricRecorder recorder) {
        this.recorder = recorder;
    }

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        MappedStatement ms = (MappedStatement) invocation.getArgs()[0];
        Object parameter = invocation.getArgs()[1];

        long start = System.nanoTime();
        boolean success = false;
        try {
            Object result = invocation.proceed();
            success = true;

            int affectedRows = result instanceof Integer ? (Integer) result : -1;
            recorder.recordDml(
                ms.getId(),
                ms.getSqlCommandType().name(),
                affectedRows,
                System.nanoTime() - start,
                null
            );
            return result;
        } catch (Throwable ex) {
            recorder.recordDml(
                ms.getId(),
                ms.getSqlCommandType().name(),
                -1,
                System.nanoTime() - start,
                ex.getClass().getName()
            );
            throw ex;
        }
    }
}
```

Design notes:

- jangan log parameter penuh;
- tag cardinality harus dibatasi agar metric cardinality tidak meledak;
- gunakan statement id, bukan raw SQL full sebagai tag utama;
- raw SQL hash boleh dipakai sebagai secondary signal;
- jangan swallow exception.

---

## 9. Use Case 2 — Query Count Per Request

N+1 query sering sulit terlihat dari satu SQL log.

Kita bisa menghitung jumlah query per request.

Mental model:

```text
HTTP Request starts
  -> initialize request SQL counter in context/MDC/request scope
  -> each Executor.query increments counter
  -> request ends
  -> log summary if count > threshold
```

Pseudo-code:

```java
public final class SqlRequestCounter {
    private static final ThreadLocal<Integer> QUERY_COUNT = ThreadLocal.withInitial(() -> 0);

    public static void increment() {
        QUERY_COUNT.set(QUERY_COUNT.get() + 1);
    }

    public static int get() {
        return QUERY_COUNT.get();
    }

    public static void clear() {
        QUERY_COUNT.remove();
    }
}
```

Interceptor:

```java
@Intercepts({
    @Signature(
        type = Executor.class,
        method = "query",
        args = {
            MappedStatement.class,
            Object.class,
            RowBounds.class,
            ResultHandler.class
        }
    )
})
public final class QueryCountInterceptor implements Interceptor {

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        SqlRequestCounter.increment();
        return invocation.proceed();
    }
}
```

Caveat Java 21+:

- `ThreadLocal` masih bekerja pada virtual thread, tetapi jangan mengasumsikan thread pool reuse seperti platform thread lama.
- Untuk reactive/asynchronous boundary, ThreadLocal bisa hilang.
- Untuk request correlation, gunakan framework context propagation bila tersedia.

---

## 10. Use Case 3 — SQL Comment Injection

Kadang kita ingin menambahkan comment ke SQL agar terlihat di database monitoring:

```sql
/* app=case-service, statement=CaseMapper.searchCases, trace=abc123 */
SELECT ...
```

Manfaat:

- korelasi query di DB dengan aplikasi;
- troubleshooting slow query;
- tracing statement id.

Risiko:

- SQL mutation;
- raw trace id harus disanitasi;
- comment bisa memengaruhi SQL text hash di DB;
- terlalu banyak variasi comment bisa merusak plan cache di beberapa database/driver;
- jangan masukkan user input.

Safer approach:

- comment hanya memakai fixed app name + sanitized statement id;
- trace id bisa dipertimbangkan jika database monitoring memang butuh, tetapi pahami efek ke SQL text uniqueness;
- jangan inject PII.

Contoh helper sanitize:

```java
static String safeSqlCommentValue(String value) {
    if (value == null) {
        return "unknown";
    }
    return value.replaceAll("[^a-zA-Z0-9_.:-]", "_");
}
```

---

## 11. Use Case 4 — Tenant Guard Interceptor

Tenant interceptor sering terlihat menarik:

```text
Semua SELECT harus punya tenant_id predicate.
```

Namun ada dua pendekatan berbeda:

### 11.1 Mutation Approach

Interceptor otomatis menambahkan:

```sql
AND tenant_id = ?
```

Masalah:

- parsing SQL sulit;
- nested query sulit;
- alias table sulit;
- join query sulit;
- `WHERE` vs no `WHERE`;
- `UNION`;
- subquery;
- vendor syntax;
- bisa salah menambahkan predicate ke table yang salah;
- mapper XML terlihat aman padahal sebenarnya bergantung pada magic.

### 11.2 Validation Approach

Interceptor tidak menambahkan predicate, hanya memvalidasi:

```text
Statement id masuk kategori tenant-scoped,
SQL final harus mengandung predicate/scope marker tertentu,
jika tidak: fail-fast.
```

Ini lebih aman sebagai guardrail.

Contoh convention:

```sql
/* scope:tenant */
SELECT ...
FROM cases c
WHERE c.tenant_id = #{scope.tenantId}
```

Interceptor mengecek:

- statement id pattern;
- SQL comment marker;
- parameter object punya `scope`;
- SQL mengandung `tenant_id` atau marker yang disetujui;
- exclude statement tertentu dengan annotation/config whitelist.

Prinsip:

> Untuk security-critical predicate, lebih baik mapper eksplisit + interceptor validasi, bukan interceptor rewrite diam-diam.

---

## 12. Tenant Guard Example

Contoh sederhana berbasis `StatementHandler.prepare`:

```java
@Intercepts({
    @Signature(
        type = StatementHandler.class,
        method = "prepare",
        args = {Connection.class, Integer.class}
    )
})
public final class TenantScopeGuardInterceptor implements Interceptor {

    private final Set<String> excludedStatementIds;

    public TenantScopeGuardInterceptor(Set<String> excludedStatementIds) {
        this.excludedStatementIds = excludedStatementIds;
    }

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        StatementHandler handler = (StatementHandler) invocation.getTarget();
        BoundSql boundSql = handler.getBoundSql();
        String sql = normalize(boundSql.getSql());

        // In real implementation, retrieve MappedStatement id through MetaObject
        // or use Executor-level validation where MappedStatement is directly available.
        if (requiresTenantScope(sql) && !containsTenantPredicate(sql)) {
            throw new TenantScopeViolationException(
                "Tenant-scoped SQL is missing tenant predicate"
            );
        }

        return invocation.proceed();
    }

    private static String normalize(String sql) {
        return sql == null ? "" : sql.replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }

    private static boolean requiresTenantScope(String sql) {
        return sql.contains("/* scope:tenant */");
    }

    private static boolean containsTenantPredicate(String sql) {
        return sql.contains("tenant_id") || sql.contains("agency_id");
    }
}
```

Catatan:

- contoh ini belum production-grade;
- SQL text check sederhana bisa false positive/negative;
- production guard sebaiknya memakai convention kuat + statement registry;
- jangan mengandalkan substring check sebagai satu-satunya security layer.

---

## 13. Use Case 5 — Block Dangerous Update/Delete

Interceptor bisa mencegah:

```sql
UPDATE cases SET status = 'CLOSED'
```

atau:

```sql
DELETE FROM cases
```

tanpa `WHERE`.

Namun jangan terlalu naif.

Contoh problem:

```sql
UPDATE cases
SET deleted = 1
WHERE 1 = 1
```

Secara sintaks ada `WHERE`, tapi secara semantik tetap full table update.

Guardrail minimal:

- block UPDATE/DELETE tanpa `WHERE`;
- block `WHERE 1=1` untuk DML tertentu;
- block DML pada table sensitif tanpa primary key/tenant predicate;
- require statement id whitelist untuk bulk operation;
- require special comment marker untuk intentional bulk DML:

```sql
/* bulk-approved:ACEAS-1234 */
UPDATE ...
```

Lebih baik lagi:

- bulk operation memakai mapper khusus;
- mapper method name jelas;
- input object membawa reason/correlation id;
- audit table mencatat bulk operation.

---

## 14. Use Case 6 — Pagination Interceptor

Banyak framework membuat pagination interceptor yang mengubah SQL:

```sql
SELECT ... FROM ... WHERE ...
```

menjadi:

```sql
SELECT ... FROM ... WHERE ... LIMIT ? OFFSET ?
```

atau vendor-specific syntax.

Ini bisa berguna, tapi berisiko.

Masalah umum:

- query sudah punya `ORDER BY` atau belum;
- query punya `UNION`;
- query punya CTE;
- query punya nested order;
- count query auto-generated salah;
- one-to-many join membuat pagination salah;
- vendor syntax berbeda;
- SQL parser dependency berat;
- result order tidak deterministic.

Rule advanced:

> Untuk critical listing/search query, lebih baik pagination eksplisit di SQL mapper daripada interceptor auto-magic.

Pagination interceptor layak jika:

- query sederhana;
- standard internal CRUD/admin;
- tim punya SQL parser yang reliable;
- semua query diuji;
- ada escape hatch;
- tidak dipakai untuk complex reporting/regulatory search.

---

## 15. Use Case 7 — Data Masking Interceptor

Masking bisa dilakukan di beberapa layer:

```text
Database view / SQL projection
Mapper result mapping
Service DTO assembly
Serialization layer
ResultSetHandler interceptor
```

ResultSetHandler interceptor terlihat menarik, tapi sering bukan tempat terbaik.

Kenapa?

- field sensitif mungkin sudah terambil dari DB;
- field sensitif mungkin sudah masuk object sebelum masking;
- logging sebelum masking bisa bocor;
- reflection-based masking mahal dan rapuh;
- role/context authorization sulit tersedia di MyBatis layer;
- masking rule sering business/security policy, bukan persistence concern.

Kapan interceptor masking layak?

- masking teknis yang universal, misalnya redaction untuk debug result;
- field-level encryption/decryption boundary yang sangat jelas;
- result object punya marker annotation;
- performance sudah diuji;
- tidak menggantikan authorization.

Lebih aman:

```text
SQL projection hanya memilih field yang boleh dilihat.
DTO berbeda per use case.
Service layer menentukan visibility.
Serialization layer menghindari accidental leak.
```

---

## 16. Use Case 8 — Encryption/Decryption Plugin

Ada sistem yang memakai interceptor untuk encrypt parameter sebelum write dan decrypt result setelah read.

Ini harus sangat hati-hati.

Pertanyaan desain:

- encryption deterministic atau randomized?
- butuh query by encrypted field?
- index masih bisa dipakai?
- key rotation bagaimana?
- null dan empty string bagaimana?
- field sudah terenkripsi atau belum?
- bagaimana migration data lama?
- bagaimana audit/logging?
- siapa pemilik key?

Risiko interceptor:

- behavior tersembunyi dari mapper;
- sulit test query by encrypted field;
- result post-processing reflection mahal;
- double encryption jika object lewat dua kali;
- decryption failure bisa muncul jauh dari boundary.

Alternatif sering lebih baik:

- explicit `TypeHandler` per encrypted value object;
- domain type `EncryptedString`;
- database function jika sesuai;
- service-level crypto boundary.

Untuk MyBatis, `TypeHandler` sering lebih jelas daripada interceptor untuk konversi field tunggal.

---

## 17. Statement ID sebagai Control Plane

`MappedStatement.getId()` biasanya berbentuk:

```text
com.example.case.CaseMapper.searchCases
```

Ini sangat berguna untuk:

- metrics tag;
- policy registry;
- allowlist/denylist;
- tenant-scope rule;
- bulk-operation approval;
- timeout policy;
- fetch-size policy;
- query category;
- ownership mapping.

Contoh registry:

```java
public enum StatementPolicy {
    TENANT_SCOPED,
    PUBLIC_LOOKUP,
    BULK_OPERATION,
    REPORTING,
    INTERNAL_MIGRATION
}
```

Map:

```java
Map<String, StatementPolicy> policyByStatementId = Map.of(
    "com.example.case.CaseMapper.searchCases", StatementPolicy.TENANT_SCOPED,
    "com.example.lookup.LookupMapper.listCountries", StatementPolicy.PUBLIC_LOOKUP
);
```

Untuk codebase besar, registry bisa di-generate dari convention atau metadata file.

Contoh metadata YAML:

```yaml
statements:
  com.example.case.CaseMapper.searchCases:
    owner: case-module
    category: TENANT_SCOPED
    maxRows: 500
    timeoutMs: 3000
  com.example.report.ReportMapper.exportCases:
    owner: report-module
    category: REPORTING
    maxRows: 1000000
    timeoutMs: 60000
```

---

## 18. Timeout Policy Interceptor

Kadang semua query tidak bisa memakai timeout sama.

Contoh:

```text
Default online query: 3s
Search listing: 5s
Report export: 60s
Admin maintenance: 120s
```

StatementHandler interceptor bisa mengatur timeout di `prepare` atau statement metadata.

Namun hati-hati:

- MyBatis statement XML sudah punya `timeout` attribute;
- JDBC driver behavior berbeda;
- database resource manager juga punya timeout;
- transaction timeout bisa lebih pendek;
- network timeout beda lagi;
- jangan membuat timeout global yang membunuh legitimate batch/export.

Lebih baik:

- timeout policy eksplisit per statement category;
- default ketat;
- exception untuk report/batch harus jelas;
- metric untuk timeout.

---

## 19. Fetch Size Policy Interceptor

`fetchSize` dapat membantu large result query.

Policy contoh:

```text
Small online query: default
Search listing: 100–500
Export cursor: 500–2000 depending driver/database
LOB query: careful, test vendor behavior
```

Interceptor dapat membaca statement category dan set fetch size.

Tapi:

- `fetchSize` hanya hint ke driver;
- vendor behavior berbeda;
- MySQL/PostgreSQL/Oracle punya detail masing-masing;
- autocommit/transaction mode bisa memengaruhi streaming behavior;
- terlalu besar meningkatkan memory;
- terlalu kecil meningkatkan round trip.

Dalam mapper penting:

```xml
<select id="streamAuditRows" resultMap="AuditExportRowMap" fetchSize="1000">
  SELECT ...
</select>
```

Interceptor sebaiknya hanya fallback atau governance, bukan mengganti semua statement tanpa review.

---

## 20. Plugin dan `BoundSql`

`BoundSql` berisi SQL final setelah dynamic SQL diproses dan parameter mapping dibuat.

Berguna untuk:

- observability;
- SQL shape hash;
- guardrail;
- debugging dynamic SQL;
- SQL comment injection;
- pagination rewrite.

Namun mutation `BoundSql` rawan karena SQL string dan additional parameters punya struktur internal.

Jika kamu harus melakukan SQL rewrite:

- isolasi logic di class khusus;
- test banyak SQL shape;
- jangan pakai regex untuk SQL kompleks;
- pertimbangkan SQL parser;
- selalu simpan original SQL untuk debug;
- expose metric rewrite success/failure;
- sediakan bypass/disable switch;
- jangan rewrite query security-sensitive tanpa explicit approval.

---

## 21. Jangan Membuat Business Rule di Interceptor

Contoh buruk:

```text
Jika user role = OFFICER, tambahkan status != 'DRAFT'
Jika role = MANAGER, tambahkan agency_id = currentAgency
Jika module = COMPLIANCE, ganti query X menjadi query Y
```

Ini salah layer.

Masalah:

- business behavior tersembunyi dari service;
- sulit test use-case;
- authorization tidak eksplisit;
- SQL mapper terlihat salah/tidak lengkap;
- behavior bergantung pada global context;
- debugging incident sulit.

Business/security scope sebaiknya masuk sebagai explicit parameter:

```java
List<CaseRow> searchCases(CaseSearchCriteria criteria, DataScope scope);
```

SQL eksplisit:

```xml
WHERE c.agency_id = #{scope.agencyId}
  AND c.visibility_level IN
  <foreach collection="scope.allowedVisibilityLevels" item="level" open="(" separator="," close=")">
    #{level}
  </foreach>
```

Interceptor boleh memvalidasi bahwa scope ada, bukan menciptakan business filter diam-diam.

---

## 22. Thread Safety

Interceptor instance biasanya singleton dalam MyBatis/Spring configuration.

Jangan simpan state per query di field instance:

```java
// Buruk
private String currentStatementId;
private long startTime;
```

Karena semua thread berbagi instance yang sama.

Gunakan local variable:

```java
@Override
public Object intercept(Invocation invocation) throws Throwable {
    long start = System.nanoTime();
    String statementId = ...;
    return invocation.proceed();
}
```

Jika butuh request context:

- gunakan MDC dengan cleanup jelas;
- gunakan request-scoped context;
- gunakan framework context propagation;
- hati-hati dengan async/virtual thread.

---

## 23. Exception Handling

Interceptor tidak boleh mengubah exception sembarangan.

Buruk:

```java
try {
    return invocation.proceed();
} catch (Exception e) {
    return Collections.emptyList();
}
```

Ini menghancurkan correctness.

Lebih baik:

```java
try {
    return invocation.proceed();
} catch (Throwable ex) {
    recorder.recordFailure(statementId, ex);
    throw ex;
}
```

Jika perlu custom exception:

- hanya untuk policy violation milik interceptor;
- jangan wrap semua SQL exception;
- jangan hilangkan root cause;
- pastikan Spring exception translation tetap bekerja bila diperlukan.

---

## 24. Fail Open vs Fail Closed

Untuk observability:

```text
Jika metrics recorder gagal, query mungkin tetap boleh jalan.
```

Untuk security:

```text
Jika tenant guard gagal memvalidasi, query harus ditolak.
```

Klasifikasi:

| Plugin Type | Failure Policy |
|---|---|
| Metrics | Usually fail open |
| Logging | Fail open |
| SQL comment | Fail open or disable transformation |
| Tenant guard | Fail closed |
| Dangerous DML blocker | Fail closed |
| Masking | Usually fail closed for sensitive endpoints |
| Encryption | Fail closed |
| Pagination rewrite | Fail closed or fallback explicitly |

Jangan mencampur policy ini.

---

## 25. SQL Rewriting: Kenapa Sulit?

SQL bukan string sederhana.

Contoh query:

```sql
WITH latest AS (
  SELECT case_id, max(created_at) created_at
  FROM case_events
  GROUP BY case_id
)
SELECT c.id, c.status
FROM cases c
JOIN latest l ON l.case_id = c.id
WHERE c.agency_id = ?
ORDER BY l.created_at DESC
```

Menambahkan pagination, tenant predicate, atau wrapping count query tidak trivial.

Masalah:

- CTE;
- subquery;
- aliases;
- window function;
- vendor syntax;
- `ORDER BY` di subquery;
- `UNION`;
- `GROUP BY`;
- `DISTINCT`;
- `FOR UPDATE`;
- comments;
- string literal yang mengandung kata `where`.

Regex-based SQL rewrite hanya aman untuk subset kecil.

Rule:

> Jangan membangun platform security atau correctness di atas regex SQL rewrite global.

---

## 26. Plugin untuk Audit DML

Kebutuhan audit:

- statement id;
- command type;
- actor id;
- tenant id;
- rows affected;
- correlation id;
- timestamp;
- success/failure.

Executor update interceptor cocok untuk mencatat metadata DML.

Namun audit detail seperti old value/new value tidak mudah di plugin.

Kenapa?

- plugin tidak tahu domain semantics;
- parameter object bisa berbeda-beda;
- update bisa bulk;
- old value perlu query tambahan;
- query tambahan di interceptor bisa memicu recursion;
- transaction boundary harus jelas.

Lebih baik:

- service/domain layer mencatat business audit;
- database trigger jika perlu low-level DB audit;
- interceptor hanya mencatat technical audit.

Technical audit example:

```text
statementId=CaseMapper.transitionStatus
command=UPDATE
rowsAffected=1
actor=officer-123
correlationId=req-abc
elapsedMs=12
```

Business audit example:

```text
Case CASE-001 moved from SUBMITTED to UNDER_REVIEW by officer-123
reason=Manual assignment
```

Jangan mengganti business audit dengan interceptor.

---

## 27. Plugin untuk Soft Delete

Ada dua pola:

### Pola buruk

Interceptor otomatis menambahkan:

```sql
deleted = 0
```

ke semua select.

Masalah:

- table yang tidak punya `deleted` column;
- alias tidak diketahui;
- report/admin butuh include deleted;
- subquery/join rumit;
- query XML tidak eksplisit.

### Pola lebih baik

Mapper eksplisit:

```xml
WHERE c.deleted = 0
```

Interceptor validasi:

```text
Statement category ACTIVE_ONLY harus mengandung deleted predicate.
```

Atau gunakan database view:

```sql
CREATE VIEW active_cases AS
SELECT * FROM cases WHERE deleted = 0;
```

Lalu mapper query ke view.

---

## 28. Plugin untuk Read/Write Routing

Kadang orang ingin memakai interceptor untuk route SELECT ke replica dan DML ke primary.

Ini biasanya bukan tanggung jawab MyBatis interceptor langsung.

Lebih umum:

- `AbstractRoutingDataSource` di Spring;
- transaction read-only flag;
- service-level routing annotation;
- separate mapper/session factory untuk read/write;
- database proxy.

Risiko read replica:

- replication lag;
- read-your-own-write tidak terjamin;
- transaction semantics;
- SELECT FOR UPDATE harus ke primary;
- procedure bisa write;
- reporting query bisa membebani replica.

Interceptor dapat membantu observability atau validation, tapi jangan menjadikannya satu-satunya routing policy.

---

## 29. Plugin dan Multi-Datasource

Dalam multi-datasource setup:

```text
caseSqlSessionFactory
reportSqlSessionFactory
auditSqlSessionFactory
```

Pertanyaan:

- plugin mana berlaku untuk factory mana?
- tenant guard berlaku untuk reporting?
- SQL comment berlaku semua?
- timeout policy berbeda?
- metrics tag perlu datasource name?
- encryption handler/plugin tersedia di semua factory?

Rule:

```text
Register plugin explicitly per SqlSessionFactory.
Avoid accidental global plugin registration.
```

Contoh:

```java
@Bean
SqlSessionFactory caseSqlSessionFactory(
        DataSource caseDataSource,
        TenantScopeGuardInterceptor tenantGuard,
        SqlMetricsInterceptor metrics
) throws Exception {
    SqlSessionFactoryBean bean = new SqlSessionFactoryBean();
    bean.setDataSource(caseDataSource);
    bean.setPlugins(tenantGuard, metrics);
    return bean.getObject();
}
```

---

## 30. Plugin dan Cache

Interceptor yang mengubah SQL atau parameter dapat memengaruhi cache key.

Jika SQL berubah setelah cache key dihitung, hasil bisa salah.

Pertanyaan:

- cache key dibuat sebelum atau sesudah plugin mutation?
- apakah additional parameter ikut cache key?
- apakah tenant context masuk parameter eksplisit?
- apakah SQL comment memengaruhi cache?
- apakah rewrite pagination mengubah cache key?

Rule:

> Security scope harus menjadi parameter eksplisit, bukan hidden context, agar cache key benar.

Buruk:

```text
Tenant id diambil dari ThreadLocal interceptor, tidak ada di parameter mapper.
```

Risiko:

- cache antar tenant bocor;
- test sulit;
- SQL log tidak lengkap.

Baik:

```java
searchCases(criteria, dataScope)
```

Tenant id muncul sebagai bound parameter.

---

## 31. Plugin dan Dynamic SQL

Dynamic SQL membuat SQL final tergantung parameter.

Plugin guard harus memvalidasi SQL final, bukan template XML.

Contoh:

```xml
<where>
  <if test="scope != null and scope.tenantId != null">
    c.tenant_id = #{scope.tenantId}
  </if>
</where>
```

Jika `scope` null, predicate hilang.

Interceptor bisa menangkap ini pada `BoundSql` final.

Namun lebih baik mapper input contract mencegah `scope` null sejak service layer.

Testing harus mencakup:

- scope null;
- scope valid;
- optional filter kosong;
- empty list;
- dynamic branch yang menghilangkan predicate;
- DML tanpa expected WHERE.

---

## 32. Production-Grade Plugin Design Checklist

Sebelum membuat plugin, jawab pertanyaan ini:

```text
1. Problem apa yang diselesaikan?
2. Apakah bisa diselesaikan lebih eksplisit di mapper/service?
3. Apakah plugin validasi atau mutation?
4. Apa interception point yang paling sempit?
5. Apa fail-open/fail-closed policy?
6. Bagaimana plugin dimatikan jika ada incident?
7. Apa metric/log saat plugin bekerja?
8. Apa test coverage untuk query shape penting?
9. Bagaimana plugin bekerja dengan multi-datasource?
10. Bagaimana plugin bekerja dengan cache?
11. Apakah plugin thread-safe?
12. Apakah plugin menyimpan request-specific state?
13. Apakah plugin aman untuk Java 8 dan Java modern?
14. Apakah plugin behavior terdokumentasi?
15. Apakah tim tahu plugin ini ada?
```

---

## 33. Testing Interceptor

### 33.1 Unit Test

Unit test cocok untuk:

- helper sanitize;
- statement id policy registry;
- SQL normalization;
- allowlist/denylist;
- exception policy;
- metric tag generation.

### 33.2 Integration Test

Wajib untuk:

- plugin dipanggil di pipeline MyBatis nyata;
- mapper XML nyata;
- `BoundSql` nyata;
- transaction nyata;
- multi-datasource setup;
- query success/failure;
- DML blocked/allowed.

Contoh test matrix:

| Scenario | Expected |
|---|---|
| tenant-scoped select with predicate | allowed |
| tenant-scoped select without predicate | rejected |
| public lookup select | allowed |
| update without where | rejected |
| approved bulk update marker | allowed |
| metrics recorder failure | query still succeeds if fail-open |
| security guard internal failure | query rejected if fail-closed |

---

## 34. Observability untuk Plugin

Plugin harus terlihat.

Minimal:

- counter plugin invocation;
- counter violation;
- timer overhead;
- statement id tag;
- datasource tag;
- command type tag;
- config version;
- fail-open/fail-closed count;
- rewrite count jika ada SQL mutation;
- skipped/bypassed count.

Contoh log policy violation:

```json
{
  "event": "mybatis_policy_violation",
  "plugin": "TenantScopeGuardInterceptor",
  "statementId": "com.example.case.CaseMapper.searchCases",
  "command": "SELECT",
  "reason": "missing_tenant_predicate",
  "correlationId": "req-123"
}
```

Jangan log raw SQL penuh jika mengandung data sensitif.

Bisa log:

- statement id;
- command type;
- normalized SQL hash;
- safe snippet tanpa parameter;
- policy name.

---

## 35. Performance Cost

Interceptor menambah overhead di setiap query.

Overhead bisa berasal dari:

- reflection;
- SQL string normalization;
- regex;
- SQL parser;
- metric emission;
- logging;
- MDC lookup;
- context lookup;
- result object reflection;
- additional query.

Rule:

```text
Hot path interceptor must be allocation-conscious.
Avoid heavy parsing per query unless necessary.
Cache policy metadata by statement id.
Do not perform database query inside interceptor unless extremely controlled.
```

Contoh cache metadata:

```java
private final ConcurrentMap<String, StatementPolicy> policyCache = new ConcurrentHashMap<>();
```

Namun cache harus bounded/controlled jika statement id bisa dynamic. Biasanya statement id static sehingga aman.

---

## 36. Common Anti-Patterns

### 36.1 Global SQL Rewrite untuk Security

```text
Interceptor otomatis menambahkan tenant_id ke semua SQL.
```

Bahaya karena SQL grammar kompleks.

### 36.2 Swallow Exception

```text
Jika query gagal, return empty list.
```

Mengubah data corruption menjadi silence.

### 36.3 Logging Semua Parameter

```text
Log full bound parameter untuk semua query.
```

Risiko PII, secret, token, free text, password, payload besar.

### 36.4 Business Authorization di Interceptor

```text
Role user menentukan filter SQL secara tersembunyi.
```

Membuat authorization tidak eksplisit dan sulit diaudit.

### 36.5 Mutable Shared State

```text
Interceptor menyimpan current user/statement di field singleton.
```

Race condition.

### 36.6 SQL Parsing Berat di Semua Query

Membuat overhead besar.

### 36.7 Plugin Tidak Bisa Dimatikan

Saat incident, tidak ada feature flag/config untuk disable.

### 36.8 Tidak Ada Test Query Nyata

Plugin diuji mock saja, lalu gagal pada XML dynamic SQL nyata.

---

## 37. Java 8 sampai Java 25 Considerations

### Java 8

- gunakan class final biasa;
- hindari records/sealed classes;
- hati-hati dependency modern;
- ThreadLocal umum digunakan, tetapi cleanup wajib;
- metrics library harus compatible.

### Java 11

- baseline transitional;
- bisa memakai `var` lokal di test/code internal jika source level mendukung, tetapi enterprise library sering tetap Java 8 style.

### Java 17

- baseline modern Spring Boot 3;
- records bisa dipakai untuk immutable policy metadata;
- sealed interface bisa bagus untuk policy classification;
- pattern matching sederhana membantu readability;
- module system jika dipakai bisa memengaruhi reflection.

### Java 21

- virtual threads membuat blocking JDBC lebih scalable secara thread, tetapi database tetap bottleneck;
- ThreadLocal tetap harus dipakai hati-hati;
- jangan menganggap plugin overhead hilang karena virtual thread;
- context propagation tetap penting.

### Java 25

- prinsip sama: plugin harus thread-safe, explicit, observable;
- gunakan fitur bahasa modern untuk memperjelas policy model, bukan untuk membuat runtime magic lebih kompleks.

---

## 38. Mini Case Study — Tenant Scope Guard + Metrics

### Context

Sistem case management multi-agency punya mapper:

```text
CaseSearchMapper.searchCases
CaseDetailMapper.findCaseDetail
LookupMapper.listStatuses
ReportMapper.exportCases
```

Requirement:

- semua query case harus scoped by agency;
- lookup public boleh tanpa agency;
- report export punya scope khusus;
- semua query harus punya metrics;
- query tanpa scope harus fail-fast.

### Design

Gunakan dua interceptor:

```text
1. SqlMetricsInterceptor
2. StatementPolicyGuardInterceptor
```

Policy registry:

```yaml
statements:
  com.example.case.CaseSearchMapper.searchCases:
    category: TENANT_SCOPED
    requiredSqlMarker: "scope:agency"
  com.example.case.CaseDetailMapper.findCaseDetail:
    category: TENANT_SCOPED
    requiredSqlMarker: "scope:agency"
  com.example.lookup.LookupMapper.listStatuses:
    category: PUBLIC_LOOKUP
  com.example.report.ReportMapper.exportCases:
    category: REPORTING_SCOPED
    requiredSqlMarker: "scope:report"
```

Mapper SQL:

```xml
<select id="searchCases" resultMap="CaseSearchRowMap">
  /* scope:agency */
  SELECT
      c.case_id,
      c.status,
      c.created_at
  FROM cases c
  WHERE c.agency_id = #{scope.agencyId}
    AND c.deleted = 0
  ORDER BY c.created_at DESC, c.case_id DESC
</select>
```

Guard behavior:

```text
If category TENANT_SCOPED:
  require parameter object has scope
  require required marker exists
  require BoundSql contains agency_id or approved alias predicate
  otherwise throw policy violation
```

Metrics behavior:

```text
Always measure statement id, command type, success/error, elapsed time.
Do not log parameter values.
```

### Why This Design Works

- security predicate remains explicit in SQL;
- interceptor validates, not magically mutates;
- lookup query can be explicitly public;
- report query has separate policy;
- observability exists for all statements;
- policy metadata is reviewable.

---

## 39. Mini Case Study — Dangerous DML Blocker

Requirement:

- prevent accidental full-table update/delete;
- allow approved bulk operation only in maintenance mapper;
- record audit metadata.

Policy:

```text
For UPDATE/DELETE:
  if no WHERE -> reject
  if statement id not in bulk allowlist and SQL contains bulk-approved marker -> reject
  if statement id in bulk allowlist but no reason parameter -> reject
  else proceed
```

Mapper:

```xml
<update id="bulkCloseExpiredDraftCases">
  /* bulk-approved:CASE-MAINTENANCE */
  UPDATE cases
  SET status = 'EXPIRED',
      updated_by = #{actorId},
      updated_at = CURRENT_TIMESTAMP
  WHERE status = 'DRAFT'
    AND created_at &lt; #{cutoff}
    AND agency_id = #{agencyId}
</update>
```

Important:

- bulk operation still has scope;
- marker is not enough;
- statement id must be allowlisted;
- input has actor/reason;
- rows affected logged.

---

## 40. Decision Framework: Should This Be a Plugin?

Gunakan decision tree berikut:

```text
Is it pure observation?
  Yes -> plugin is likely acceptable.

Is it validation of technical invariant?
  Yes -> plugin may be acceptable if fail policy is clear.

Is it SQL mutation?
  Maybe -> prefer explicit mapper SQL unless mutation is narrow and heavily tested.

Is it business logic?
  No -> do not put it in plugin.

Is it security-critical?
  Prefer explicit SQL + validation plugin, not hidden mutation.

Does it depend on current user/request?
  Prefer explicit parameter. Use context only for observability metadata.

Does it need vendor-specific parsing/rewrite?
  Prefer mapper/databaseIdProvider or explicit SQL variant.
```

---

## 41. Practical Recommendation

Untuk production-grade MyBatis system, plugin yang paling aman dan bernilai biasanya:

```text
Recommended:
  - metrics interceptor
  - query count interceptor
  - statement policy validation interceptor
  - dangerous DML guard
  - safe SQL comment interceptor with strict sanitization

Use with caution:
  - pagination rewrite
  - tenant predicate injection
  - encryption/decryption
  - result masking
  - dynamic timeout/fetch size policy

Avoid in most cases:
  - business authorization rewrite
  - regex-based global SQL mutation
  - returning fallback data on SQL error
  - hidden service call from interceptor
  - DB query inside interceptor
```

---

## 42. Final Mental Model

Plugin/interceptor adalah **cross-cutting hook** di runtime MyBatis.

Namun dalam sistem besar, plugin tidak boleh menjadi tempat “menyembunyikan desain”.

Model yang benar:

```text
Mapper XML/interface:
  owns explicit SQL contract.

Service layer:
  owns business transaction and authorization decision.

Interceptor:
  observes, validates, guards, and occasionally transforms narrowly.

Database:
  enforces constraints, indexes, locks, and optionally row-level security.
```

Jika interceptor membuat SQL yang terlihat di mapper menjadi tidak benar secara mental, maka plugin itu sudah terlalu magical.

Top-tier engineer tidak hanya bertanya:

```text
Can I intercept this?
```

Tetapi:

```text
Should this behavior be globally hidden?
What invariant am I enforcing?
What happens during incident?
Can someone debug this from logs and statement id?
Can this be tested with real SQL?
Will this still be safe with tenant, cache, dynamic SQL, batch, and multi-datasource?
```

Itulah cara memperlakukan MyBatis plugin sebagai engineering tool, bukan shortcut.

---

## 43. Checklist Ringkas

Sebelum merge plugin MyBatis:

```text
[ ] Tujuan plugin jelas.
[ ] Interception point paling sempit sudah dipilih.
[ ] Tidak ada mutable shared state.
[ ] Fail-open/fail-closed policy jelas.
[ ] Tidak log PII/secret/raw large payload.
[ ] Statement id digunakan sebagai control plane.
[ ] Multi-datasource behavior jelas.
[ ] Cache interaction dipahami.
[ ] Dynamic SQL branch sudah diuji.
[ ] Query nyata sudah diuji via integration test.
[ ] Plugin bisa dimatikan/configurable.
[ ] Metric dan log policy tersedia.
[ ] Security behavior explicit, bukan hanya mutation tersembunyi.
[ ] Documentation tersedia untuk tim.
```

---

## 44. Penutup Part 29

Di Part 29 ini kita sudah membahas plugin/interceptor engineering sebagai extension point MyBatis yang powerful tetapi harus dipakai dengan disiplin tinggi.

Kita sudah membahas:

- plugin mental model;
- interception point resmi;
- `Executor`, `StatementHandler`, `ParameterHandler`, `ResultSetHandler`;
- anatomy interceptor;
- registrasi Spring Boot;
- plugin order;
- metrics;
- query count;
- SQL comment;
- tenant guard;
- dangerous DML blocker;
- pagination rewrite;
- masking;
- encryption;
- statement policy registry;
- timeout/fetch size policy;
- `BoundSql`;
- cache interaction;
- dynamic SQL interaction;
- testing;
- observability;
- performance;
- anti-pattern;
- Java 8 sampai Java 25 considerations;
- mini case study.

Bagian berikutnya akan masuk ke:

```text
Part 30 — Advanced Patterns: CQRS Read Models, Projection Mapper, Reporting Queries
```

Di sana kita akan membahas bagaimana MyBatis digunakan secara strategis untuk read-heavy system, listing/search/reporting, CQRS read model, projection-first mapper, dashboard query, materialized view, dan integrasi dengan sistem enterprise yang kompleks.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 28 — Modularization and Codebase Governance for Large Mapper Systems](./28-modularization-codebase-governance-large-mapper-systems.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 30 — Advanced Patterns: CQRS Read Models, Projection Mapper, Reporting Queries](./30-advanced-patterns-cqrs-read-models-projection-reporting-queries.md)

</div>