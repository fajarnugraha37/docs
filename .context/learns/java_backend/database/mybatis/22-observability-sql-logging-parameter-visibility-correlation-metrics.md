# Part 22 — Observability: SQL Logging, Parameter Visibility, Correlation ID, Metrics

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `22-observability-sql-logging-parameter-visibility-correlation-metrics.md`  
> Target: Java 8 sampai Java 25  
> Level: Advanced / production engineering

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan tidak hanya bisa menyalakan log SQL MyBatis, tetapi mampu mendesain **observability model** untuk persistence layer yang aman, berguna saat incident, dan tidak membocorkan data sensitif.

Kita akan membahas:

1. Apa arti observability untuk MyBatis.
2. Perbedaan logging, metrics, tracing, profiling, dan audit.
3. Bagaimana MyBatis melakukan logging.
4. Cara melihat SQL statement tanpa membocorkan PII/secrets.
5. Cara menghubungkan request log, service log, mapper log, dan database incident lewat correlation id.
6. Cara mendeteksi N+1 query, query storm, slow SQL, row explosion, batch anomaly, dan mapping overhead.
7. Bagaimana membuat interceptor/plugin secara aman untuk observability.
8. Bagaimana observability berubah antara Java 8 legacy stack dan Java 17/21/25 modern stack.

Observability bukan fitur kosmetik. Untuk MyBatis, observability adalah bagian dari correctness. Query bisa benar di unit test, tetapi salah dalam produksi karena:

- parameter yang masuk berbeda dari asumsi,
- filter tenant hilang,
- query count meledak,
- pagination tidak stabil,
- result terlalu besar,
- index tidak dipakai,
- SQL dinamis menghasilkan bentuk query yang tidak pernah diuji,
- transaksi menahan lock terlalu lama,
- batch gagal sebagian,
- logging terlalu bising sehingga sinyal penting tertutup.

---

## 1. Mental Model: Observability untuk SQL-First Persistence

MyBatis adalah framework SQL-first. Artinya, runtime MyBatis memberi wrapper di sekitar SQL, tetapi perilaku produksi tetap sangat ditentukan oleh:

```text
mapper method
  -> mapped statement id
  -> rendered SQL / BoundSql
  -> parameter binding
  -> JDBC statement
  -> database execution plan
  -> result set
  -> result mapping
  -> Java object
```

Observability yang baik harus bisa menjawab pertanyaan di setiap titik tersebut.

### 1.1 Pertanyaan yang Harus Bisa Dijawab

Saat incident, engineer top-tier tidak cukup bertanya:

```text
Query mana yang lambat?
```

Pertanyaan yang lebih tepat:

```text
Request mana yang memicu query lambat?
Mapper method mana?
Mapped statement id apa?
SQL shape-nya seperti apa?
Parameter kategorinya apa, tanpa membocorkan PII?
Berapa kali query itu dipanggil dalam satu request?
Berapa row yang dikembalikan?
Berapa lama database execution vs result mapping?
Apakah query memakai index yang diharapkan?
Apakah ada lock wait?
Apakah ada retry?
Apakah transaction boundary terlalu besar?
Apakah query ini muncul karena lazy loading/N+1?
Apakah filter tenant/security ikut terbawa?
```

Observability layer yang matang harus membuat jawaban-jawaban ini murah didapat.

---

## 2. Logging, Metrics, Tracing, Audit: Jangan Dicampur

Banyak sistem kacau karena semua hal dianggap “log”. Padahal fungsi masing-masing berbeda.

| Mekanisme | Fungsi Utama | Contoh | Retention | Risiko |
|---|---|---|---|---|
| Logging | Narasi event detail | SQL statement id, error, parameter summary | Menengah | Bocor PII, bising |
| Metrics | Agregasi numerik | latency p95, query count, error rate | Panjang | Kehilangan detail individual |
| Tracing | Hubungan antar operasi | request span -> service span -> DB span | Pendek-menengah | Cardinality tinggi, biaya besar |
| Audit | Bukti bisnis/legal | siapa mengubah status case | Panjang | Harus immutable/defensible |
| Profiling | Analisis runtime detail | CPU allocation, stack sampling | Sementara | Overhead, tidak selalu aktif |

### 2.1 Kesalahan Umum

Kesalahan umum di production system:

```text
Menganggap SQL log = audit trail.
```

SQL log bukan audit trail. SQL log adalah diagnostic artifact. Audit trail harus menjawab pertanyaan bisnis/legal:

```text
Siapa melakukan apa, terhadap entity mana, kapan, dari state apa ke state apa, dengan alasan apa?
```

SQL log menjawab pertanyaan teknis:

```text
Statement apa dieksekusi, berapa lama, dengan bentuk query apa, dan gagal di mana?
```

Keduanya bisa memakai correlation id yang sama, tetapi tujuannya berbeda.

---

## 3. MyBatis Logging Model

MyBatis memiliki logging abstraction sendiri. Ia bisa menggunakan beberapa backend logging seperti SLF4J, Log4J2, JDK logging, commons logging, stdout logging, no logging, atau implementasi custom.

Dalam aplikasi modern Spring Boot, pilihan paling umum adalah:

```text
MyBatis -> SLF4J -> Logback/Log4j2 -> stdout/file/collector
```

### 3.1 Konfigurasi `logImpl`

Contoh `mybatis-config.xml`:

```xml
<configuration>
  <settings>
    <setting name="logImpl" value="SLF4J"/>
  </settings>
</configuration>
```

Contoh Spring Boot property:

```yaml
mybatis:
  configuration:
    log-impl: org.apache.ibatis.logging.slf4j.Slf4jImpl
```

Untuk local debugging, ada yang memakai:

```yaml
mybatis:
  configuration:
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl
```

Namun `STDOUT_LOGGING` tidak cocok untuk production governance karena:

- sulit dikontrol per logger/category,
- sulit dimasking secara konsisten,
- format bisa tidak sesuai log collector,
- raw SQL/parameter bisa bocor ke stdout.

### 3.2 Logger Name Strategy

MyBatis logging sering muncul berdasarkan package/class mapper atau statement namespace.

Contoh logback:

```xml
<configuration>
  <logger name="com.company.aceas.case.mapper" level="DEBUG"/>
  <logger name="org.mybatis" level="INFO"/>
</configuration>
```

Dalam production, jangan aktifkan DEBUG untuk semua mapper secara global kecuali sangat sementara.

Lebih aman:

```xml
<logger name="com.company.aceas.case.mapper.CaseSearchMapper" level="DEBUG"/>
```

atau aktifkan lewat runtime config/feature flag observability.

---

## 4. Apa yang Biasanya Dilog oleh MyBatis

Saat level DEBUG/TRACE aktif, MyBatis bisa menampilkan pola seperti:

```text
==>  Preparing: SELECT id, status FROM case_file WHERE id = ?
==> Parameters: C-2026-000123(String)
<==      Total: 1
```

Ini berguna untuk debugging, tetapi berbahaya bila parameter berisi:

- NRIC/NIK/passport,
- email,
- phone,
- address,
- token,
- API key,
- financial amount sensitif,
- case description,
- complaint content,
- free text evidence,
- CLOB/JSON besar.

### 4.1 Masalah Parameter Visibility

Ada dua ekstrem yang sama-sama buruk:

```text
Tidak melihat parameter sama sekali
  -> sulit debug query dinamis dan data-dependent incident.

Melihat semua parameter mentah
  -> risiko PII/secrets leak, compliance issue, dan log volume explosion.
```

Pendekatan yang benar adalah **parameter observability by classification**.

---

## 5. Parameter Observability by Classification

Parameter harus dikategorikan, bukan sekadar di-print.

| Kategori | Contoh | Logging Policy |
|---|---|---|
| Safe identifier internal | UUID teknis, synthetic id | boleh log sebagian/penuh sesuai policy |
| Business identifier sensitif | case no, license no | mask sebagian atau hash |
| PII | name, email, phone, address | mask/hide |
| Secret | password, token, credential | never log |
| Free text | description, comment, complaint | never log raw; log length/hash |
| Large payload | CLOB, JSON, BLOB | never log raw; log size/hash |
| Enum/status | APPROVED, PENDING | boleh log |
| Numeric operational | page size, limit | boleh log dengan bound |

### 5.1 Contoh Parameter Summary

Daripada log seperti ini:

```text
Parameters: 1234567890(String), Ahmad Fajar(String), 08123456789(String), complaint text...(String)
```

Lebih aman:

```json
{
  "statementId": "CaseSearchMapper.searchCases",
  "parameterSummary": {
    "agencyId": "CEA",
    "status": "OPEN",
    "caseNoHash": "sha256:8f1a...",
    "keywordPresent": true,
    "keywordLength": 12,
    "pageSize": 50,
    "sort": "CREATED_DESC"
  }
}
```

Ini menjaga diagnostic value tanpa membuka isi sensitif.

---

## 6. Correlation ID: Tulang Punggung Troubleshooting

Correlation ID adalah identitas teknis yang menghubungkan semua event dalam satu flow.

Contoh:

```text
HTTP request
  correlationId=REQ-9f43
    service log
      mapper log
        SQL metric
          DB session/action
            audit event
```

### 6.1 Correlation ID yang Baik

Correlation ID harus:

- dibuat di edge jika belum ada,
- diteruskan ke downstream call,
- masuk ke MDC logging context,
- muncul di error response internal/log,
- masuk ke SQL observability event,
- idealnya masuk ke database session metadata bila database mendukung.

### 6.2 Spring Filter untuk MDC

Java 8-compatible contoh:

```java
public class CorrelationIdFilter implements javax.servlet.Filter {
    private static final String HEADER = "X-Correlation-Id";

    @Override
    public void doFilter(
            javax.servlet.ServletRequest request,
            javax.servlet.ServletResponse response,
            javax.servlet.FilterChain chain
    ) throws java.io.IOException, javax.servlet.ServletException {
        javax.servlet.http.HttpServletRequest httpRequest =
                (javax.servlet.http.HttpServletRequest) request;
        javax.servlet.http.HttpServletResponse httpResponse =
                (javax.servlet.http.HttpServletResponse) response;

        String correlationId = httpRequest.getHeader(HEADER);
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = java.util.UUID.randomUUID().toString();
        }

        org.slf4j.MDC.put("correlationId", correlationId);
        httpResponse.setHeader(HEADER, correlationId);

        try {
            chain.doFilter(request, response);
        } finally {
            org.slf4j.MDC.remove("correlationId");
        }
    }
}
```

Untuk Java 8, ganti `isBlank()`:

```java
if (correlationId == null || correlationId.trim().isEmpty()) {
    correlationId = UUID.randomUUID().toString();
}
```

### 6.3 Logback Pattern

```xml
<encoder>
  <pattern>%d{ISO8601} %-5level [%thread] correlationId=%X{correlationId} traceId=%X{traceId} %logger - %msg%n</pattern>
</encoder>
```

---

## 7. Statement ID sebagai Observability Key

Dalam MyBatis, key observability paling penting bukan nama SQL mentah, tetapi:

```text
mappedStatementId = namespace + statementId
```

Contoh:

```text
com.company.aceas.case.mapper.CaseSearchMapper.searchCases
```

Kenapa ini penting?

Karena SQL bisa berubah karena dynamic SQL. Tetapi statement id tetap menjadi ownership key.

```text
Incident: query lambat
  -> cari mappedStatementId
  -> cari mapper XML
  -> cari owner module
  -> cari use case
  -> cari test
  -> cari index assumption
```

### 7.1 Naming yang Mendukung Observability

Buruk:

```text
CommonMapper.selectList
BaseMapper.query
GenericMapper.find
CaseMapper.search
```

Baik:

```text
CaseSearchMapper.searchVisibleCasesForOfficer
CaseAssignmentMapper.claimNextPendingCaseForWorker
CaseStateTransitionMapper.approveCaseIfVersionMatches
AuditTrailMapper.insertCaseStatusChangeEvent
```

Nama method adalah diagnostic signal.

---

## 8. Logging SQL Shape vs SQL Instance

Ada dua hal berbeda:

### 8.1 SQL Shape

```sql
SELECT id, status
FROM case_file
WHERE agency_id = ?
  AND status = ?
ORDER BY created_at DESC
FETCH FIRST ? ROWS ONLY
```

SQL shape aman relatif karena parameter belum muncul.

### 8.2 SQL Instance

```sql
SELECT id, status
FROM case_file
WHERE agency_id = 'CEA'
  AND status = 'OPEN'
ORDER BY created_at DESC
FETCH FIRST 50 ROWS ONLY
```

SQL instance lebih mudah dicopy ke DB console, tetapi lebih berbahaya.

Production rule:

```text
Default: log SQL shape + parameter summary.
Exception: raw parameter hanya boleh untuk local/dev/test atau incident window terbatas dengan approval dan masking.
```

---

## 9. Safe SQL Logging Policy

### 9.1 Environment Policy

| Environment | SQL Shape | Parameter Raw | Parameter Summary | Slow SQL | Notes |
|---|---:|---:|---:|---:|---|
| Local | Yes | Optional | Yes | Optional | developer productivity |
| DEV | Yes | Limited | Yes | Yes | no production PII |
| SIT/UAT | Yes | Masked only | Yes | Yes | data may still be sensitive |
| PROD | On demand | No raw | Yes | Yes | strict masking |

### 9.2 Jangan Pernah Log

```text
password
access token
refresh token
authorization header
session id
private key
secret key
OTP
full PII/free text evidence
BLOB/CLOB content
large JSON payload raw
```

### 9.3 Log yang Boleh

```text
statement id
module name
operation category
elapsed ms
row count
affected rows
page size
sort key enum
status enum
tenant/agency code bila non-PII
parameter presence flags
payload size
hash of sensitive identifier
```

---

## 10. Mapper Metrics

Logging membantu melihat event individual. Metrics membantu melihat pola.

Minimal metric untuk MyBatis mapper:

```text
mybatis.mapper.calls.total
mybatis.mapper.errors.total
mybatis.mapper.duration
mybatis.mapper.rows.returned
mybatis.mapper.rows.affected
mybatis.mapper.query.count.per.request
mybatis.mapper.slow.calls.total
mybatis.mapper.batch.flush.total
mybatis.mapper.batch.size
```

Label/tag yang berguna:

```text
statementId
mapper
module
operation=select|insert|update|delete|procedure
outcome=success|error
exceptionClass
```

### 10.1 Cardinality Warning

Jangan jadikan parameter value sebagai metric label.

Buruk:

```text
mybatis.mapper.duration{caseNo="C-2026-000123"}
```

Ini menyebabkan high-cardinality explosion.

Baik:

```text
mybatis.mapper.duration{statementId="CaseSearchMapper.searchCases", outcome="success"}
```

---

## 11. Query Count per Request

Salah satu observability paling bernilai untuk MyBatis adalah menghitung jumlah query per HTTP request/job execution.

Kenapa?

Karena N+1 sering tidak muncul sebagai satu query lambat. Ia muncul sebagai banyak query kecil.

Contoh buruk:

```text
GET /cases?page=1&pageSize=50
  1 query list case
  50 query officer
  50 query document count
  50 query latest note
  total: 151 query
```

Masing-masing query mungkin hanya 5 ms. Tetapi total latency dan DB load besar.

### 11.1 ThreadLocal Request SQL Counter

Java 8-compatible contoh sederhana:

```java
public final class SqlObservationContext {
    private static final ThreadLocal<Counter> HOLDER = ThreadLocal.withInitial(Counter::new);

    private SqlObservationContext() {}

    public static void increment(String statementId, long elapsedMs) {
        HOLDER.get().increment(statementId, elapsedMs);
    }

    public static Counter current() {
        return HOLDER.get();
    }

    public static void clear() {
        HOLDER.remove();
    }

    public static final class Counter {
        private int totalCount;
        private long totalElapsedMs;
        private final Map<String, Integer> countByStatement = new LinkedHashMap<>();

        void increment(String statementId, long elapsedMs) {
            totalCount++;
            totalElapsedMs += elapsedMs;
            countByStatement.merge(statementId, 1, Integer::sum);
        }

        public int getTotalCount() {
            return totalCount;
        }

        public long getTotalElapsedMs() {
            return totalElapsedMs;
        }

        public Map<String, Integer> getCountByStatement() {
            return Collections.unmodifiableMap(countByStatement);
        }
    }
}
```

Untuk Java 21 virtual threads, ThreadLocal tetap bekerja per virtual thread, tetapi desain harus hati-hati bila context berpindah ke async/reactive execution.

---

## 12. MyBatis Interceptor untuk Observability

MyBatis plugin/interceptor dapat mengintercept beberapa komponen seperti `Executor`, `StatementHandler`, `ParameterHandler`, dan `ResultSetHandler`.

Untuk observability mapper-level, titik paling umum adalah `Executor`.

### 12.1 Intercept Executor Query/Update

Contoh skeleton:

```java
@org.apache.ibatis.plugin.Intercepts({
    @org.apache.ibatis.plugin.Signature(
        type = org.apache.ibatis.executor.Executor.class,
        method = "query",
        args = {
            org.apache.ibatis.mapping.MappedStatement.class,
            Object.class,
            org.apache.ibatis.session.RowBounds.class,
            org.apache.ibatis.session.ResultHandler.class
        }
    ),
    @org.apache.ibatis.plugin.Signature(
        type = org.apache.ibatis.executor.Executor.class,
        method = "update",
        args = {
            org.apache.ibatis.mapping.MappedStatement.class,
            Object.class
        }
    )
})
public class MyBatisObservationInterceptor implements org.apache.ibatis.plugin.Interceptor {

    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(MyBatisObservationInterceptor.class);

    @Override
    public Object intercept(org.apache.ibatis.plugin.Invocation invocation) throws Throwable {
        Object[] args = invocation.getArgs();
        org.apache.ibatis.mapping.MappedStatement mappedStatement =
                (org.apache.ibatis.mapping.MappedStatement) args[0];

        String statementId = mappedStatement.getId();
        String operation = mappedStatement.getSqlCommandType().name();
        long startNanos = System.nanoTime();

        try {
            Object result = invocation.proceed();
            long elapsedMs = java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);

            int resultSize = estimateResultSize(result);
            SqlObservationContext.increment(statementId, elapsedMs);

            log.debug(
                "mybatis statementId={} operation={} elapsedMs={} resultSize={}",
                statementId,
                operation,
                elapsedMs,
                resultSize
            );

            return result;
        } catch (Throwable ex) {
            long elapsedMs = java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);

            log.warn(
                "mybatis failed statementId={} operation={} elapsedMs={} exception={}",
                statementId,
                operation,
                elapsedMs,
                ex.getClass().getName()
            );

            throw ex;
        }
    }

    private int estimateResultSize(Object result) {
        if (result == null) {
            return 0;
        }
        if (result instanceof java.util.Collection<?>) {
            return ((java.util.Collection<?>) result).size();
        }
        if (result instanceof Number) {
            return ((Number) result).intValue();
        }
        return 1;
    }

    @Override
    public Object plugin(Object target) {
        return org.apache.ibatis.plugin.Plugin.wrap(target, this);
    }

    @Override
    public void setProperties(java.util.Properties properties) {
        // optional config
    }
}
```

### 12.2 Kelemahan Interceptor Sederhana

Interceptor di atas belum cukup untuk semua kasus:

- tidak mengukur database execution terpisah dari result mapping,
- tidak melihat SQL shape,
- tidak tahu parameter summary,
- tidak cocok untuk streaming/cursor result,
- result size untuk cursor tidak diketahui di awal,
- bisa menambah overhead bila logging berat.

Tetapi sebagai baseline, ia sangat berguna untuk:

- statement latency,
- query count per request,
- error by statement id,
- slow statement detection.

---

## 13. Observing BoundSql

`BoundSql` adalah hasil SQL final setelah dynamic SQL diproses, berisi SQL shape dan parameter mapping.

Contoh mengambil `BoundSql`:

```java
org.apache.ibatis.mapping.BoundSql boundSql =
    mappedStatement.getBoundSql(parameterObject);

String sqlShape = normalizeWhitespace(boundSql.getSql());
List<org.apache.ibatis.mapping.ParameterMapping> mappings =
    boundSql.getParameterMappings();
```

### 13.1 Jangan Sembarangan Render Parameter

Parameter mapping tidak berarti kamu aman merender value mentah.

Yang aman:

```java
log.debug("statementId={} sqlShape={} parameterCount={}",
    statementId,
    sqlShape,
    mappings.size());
```

Yang berisiko:

```java
log.debug("statementId={} sql={} params={}", statementId, sqlShape, rawParams);
```

### 13.2 SQL Normalization

Agar log dan metric tidak terlalu bising, normalize whitespace:

```java
private String normalizeWhitespace(String sql) {
    if (sql == null) {
        return null;
    }
    return sql.replaceAll("\\s+", " ").trim();
}
```

Untuk production, pertimbangkan limit panjang:

```java
private String abbreviate(String text, int maxLength) {
    if (text == null || text.length() <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength) + "...";
}
```

---

## 14. Slow SQL Detection

Slow SQL tidak harus hanya dideteksi di database. Aplikasi juga perlu tahu mapper mana yang lambat.

### 14.1 Threshold Per Operation

Jangan pakai satu threshold untuk semua.

| Operation | Default Warning Threshold |
|---|---:|
| simple lookup by id | 50–100 ms |
| listing page | 300–800 ms |
| report query | 2–10 s |
| batch chunk | tergantung size |
| stored procedure | tergantung SLA |

Threshold harus disesuaikan dengan SLA domain.

### 14.2 Slow SQL Log Format

```json
{
  "event": "mybatis.slow_statement",
  "correlationId": "REQ-9f43",
  "statementId": "CaseSearchMapper.searchVisibleCasesForOfficer",
  "operation": "SELECT",
  "elapsedMs": 1482,
  "rowCount": 50,
  "parameterSummary": {
    "agencyId": "CEA",
    "status": "OPEN",
    "pageSize": 50,
    "sort": "CREATED_DESC",
    "keywordPresent": false
  }
}
```

---

## 15. Row Count Observability

Latency tanpa row count sering misleading.

Contoh:

```text
Query A: 700 ms, 1 row
Query B: 700 ms, 50,000 rows
```

Keduanya berbeda masalah.

Query A mungkin:

- index tidak dipakai,
- lock wait,
- plan buruk,
- network stall.

Query B mungkin:

- result terlalu besar,
- export/reporting wajar,
- pagination hilang,
- mapper salah return `List` unbounded.

### 15.1 Batas Row Count

Untuk method listing, buat invariant:

```text
Any UI listing mapper must be bounded by page size.
```

Contoh observability alert:

```text
statementId=CaseSearchMapper.searchCases returnedRows=10000 threshold=500
```

---

## 16. Affected Rows Observability

Untuk `insert`, `update`, `delete`, affected rows adalah correctness signal.

Contoh update optimistic locking:

```sql
UPDATE case_file
SET status = #{newStatus}, version = version + 1
WHERE id = #{caseId}
  AND version = #{expectedVersion}
  AND status = #{expectedStatus}
```

Observability:

```json
{
  "statementId": "CaseStateTransitionMapper.approveIfVersionMatches",
  "affectedRows": 0,
  "reasonCategory": "guard_not_matched"
}
```

`affectedRows=0` bukan selalu error. Dalam state transition, itu bisa berarti:

- version stale,
- status sudah berubah,
- user tidak punya scope,
- entity tidak ditemukan,
- soft-deleted.

Mapper/service perlu menerjemahkan ini menjadi domain outcome.

---

## 17. Detecting N+1 Query

N+1 query bisa dideteksi dengan threshold per request.

Contoh rule:

```text
If one HTTP request executes the same statementId more than 20 times, warn.
```

Contoh log:

```json
{
  "event": "mybatis.repeated_statement",
  "correlationId": "REQ-9f43",
  "statementId": "OfficerMapper.findById",
  "count": 50,
  "requestPath": "/cases"
}
```

### 17.1 False Positive

Tidak semua repeated query salah.

Contoh yang mungkin valid:

- chunk processing,
- batch worker,
- retry operation,
- explicit per-item authorization check.

Karena itu, rule harus configurable per statement/use case.

---

## 18. Observability untuk Dynamic SQL

Dynamic SQL menyebabkan satu `statementId` punya banyak SQL shape.

Contoh:

```text
CaseSearchMapper.searchCases
  shape A: agency + status
  shape B: agency + status + keyword
  shape C: agency + date range
  shape D: agency + officer + status + date range + keyword
```

### 18.1 SQL Shape Fingerprint

Buat fingerprint dari SQL shape yang sudah dinormalisasi.

```java
private String sqlFingerprint(String normalizedSql) {
    try {
        java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(normalizedSql.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 8 && i < hash.length; i++) {
            sb.append(String.format("%02x", hash[i]));
        }
        return sb.toString();
    } catch (java.security.NoSuchAlgorithmException e) {
        throw new IllegalStateException(e);
    }
}
```

Log:

```json
{
  "statementId": "CaseSearchMapper.searchCases",
  "sqlShapeHash": "a91f20cc",
  "elapsedMs": 712
}
```

Ini membantu melihat dynamic branch mana yang lambat tanpa menyimpan full SQL terus-menerus.

---

## 19. Observability untuk Transaction Boundary

Mapper latency saja tidak cukup. Perlu tahu transaction duration.

Contoh masalah:

```text
@Transactional service method
  SELECT case FOR UPDATE       20 ms
  external API call          3000 ms
  UPDATE case                  30 ms
commit
```

Mapper log terlihat cepat, tetapi lock ditahan 3 detik.

### 19.1 Transaction Observability

Log di service boundary:

```json
{
  "event": "transaction.completed",
  "operation": "ApproveCaseService.approve",
  "elapsedMs": 3260,
  "queryCount": 3,
  "lockUsed": true,
  "outcome": "success"
}
```

Rule:

```text
Jangan hanya ukur query. Ukur transaction scope.
```

---

## 20. Observability untuk Lock Wait dan Deadlock

Lock wait sering muncul sebagai slow query, tetapi akar masalahnya concurrency.

Signal yang perlu dicatat:

- statement id,
- operation type,
- elapsed time,
- exception SQL state/vendor code,
- retry attempt,
- entity key hash,
- transaction operation name,
- lock mode expectation.

Contoh log:

```json
{
  "event": "mybatis.lock_timeout",
  "statementId": "CaseAssignmentMapper.claimNextCaseForWorker",
  "elapsedMs": 5000,
  "sqlState": "55P03",
  "retryable": true,
  "attempt": 1
}
```

Vendor code berbeda-beda. Karena itu mapper observability sebaiknya tidak hanya menyimpan class exception, tetapi juga SQL state/vendor code.

---

## 21. Exception Translation dan Error Classification

MyBatis-Spring dapat menerjemahkan exception persistence ke Spring `DataAccessException`. Observability harus tetap menjaga akar exception.

Klasifikasi umum:

| Category | Example | Retry? |
|---|---|---:|
| syntax/config error | bad SQL, mapper not found | No |
| constraint violation | duplicate key, FK violation | Usually no / domain handling |
| deadlock | DB deadlock | Sometimes yes |
| lock timeout | lock wait timeout | Sometimes yes |
| connection timeout | pool exhausted/network | Depends |
| query timeout | statement timeout | Maybe no, tune query |
| data mapping error | invalid column/type mismatch | No |
| too many results | `selectOne` multiple rows | No |

### 21.1 Error Log Format

```json
{
  "event": "mybatis.statement_failed",
  "statementId": "CaseMapper.findRequiredByCaseNo",
  "operation": "SELECT",
  "exceptionClass": "org.springframework.dao.DataIntegrityViolationException",
  "rootExceptionClass": "java.sql.SQLIntegrityConstraintViolationException",
  "sqlState": "23000",
  "vendorCode": 1,
  "retryable": false
}
```

---

## 22. OpenTelemetry dan JDBC Spans

OpenTelemetry Java dapat digunakan untuk menghasilkan traces, metrics, dan logs. Java agent zero-code instrumentation dapat menangkap telemetry tanpa perubahan kode besar, termasuk instrumentasi terkait JDBC bila diaktifkan dalam ekosistem instrumentasi yang didukung.

Namun untuk MyBatis, tracing JDBC saja sering belum cukup.

### 22.1 Kesenjangan JDBC Span

JDBC span biasanya tahu:

```text
db.system
db.name
db.statement/sql shape
duration
connection info
```

Tetapi sering tidak tahu secara eksplisit:

```text
MyBatis mappedStatementId
mapper method
module owner
parameter summary
business operation
query count per request
```

Karena itu, MyBatis-level observability tetap diperlukan.

### 22.2 Bridge ke Current Span

Pseudo-code:

```java
Span current = Span.current();
if (current.getSpanContext().isValid()) {
    current.setAttribute("mybatis.statement_id", statementId);
    current.setAttribute("mybatis.operation", operation);
    current.setAttribute("mybatis.sql_shape_hash", sqlShapeHash);
}
```

Jangan set high-cardinality parameter value sebagai span attribute.

---

## 23. Database Session Metadata

Untuk incident database, DBA sering melihat session, SQL id, wait event, blocking session.

Aplikasi bisa membantu dengan mengirim metadata ke database session bila vendor mendukung.

Contoh konsep:

```text
application_name = aceas-case-service
module = CaseApprovalService
action = approveCase
client_identifier = correlationId/userHash
```

Vendor-specific:

- Oracle: `DBMS_APPLICATION_INFO.SET_MODULE`, `SET_ACTION`, client identifier.
- PostgreSQL: `application_name` connection parameter, comments, session variables pattern.
- SQL Server: application name connection property, session context.

Jangan terlalu sering melakukan roundtrip hanya untuk set metadata per query. Biasanya cukup per transaction/request atau gunakan connection pool hooks bila memungkinkan.

---

## 24. Observability dan Connection Pool

Banyak “query lambat” sebenarnya connection pool wait.

Pisahkan:

```text
pool acquisition time
  + SQL execution time
  + result fetch time
  + mapping time
  = observed mapper/service latency
```

Jika hanya mengukur dari interceptor `Executor`, kamu mungkin tidak menangkap waktu menunggu connection jika connection sudah diambil sebelum executor call.

HikariCP metrics yang penting:

- active connections,
- idle connections,
- pending threads,
- acquisition time,
- usage time,
- timeout count.

Correlate dengan MyBatis slow statements.

---

## 25. Observability untuk Result Mapping Cost

Tidak semua latency ada di database.

Contoh:

```text
DB execution: 120 ms
fetch 50,000 rows: 800 ms
mapping Java object: 1000 ms
serialization JSON: 1500 ms
```

Mapper-level timer mungkin menunjukkan 1920 ms, tetapi database AWR/pg_stat_statements menunjukkan query cepat.

Signal:

- returned row count,
- selected column count,
- nested mapping used,
- large object present,
- collection mapping present,
- result type.

### 25.1 Practical Rule

Untuk endpoint biasa:

```text
If returnedRows > pageSizeBound, investigate mapper contract.
```

Untuk export/report:

```text
Use cursor/streaming/chunk strategy and expose export-specific metrics.
```

---

## 26. Observability untuk Batch

Batch perlu metric berbeda.

```text
batch.chunk.size
batch.flush.count
batch.flush.duration
batch.rows.affected
batch.partial.failure.count
batch.retry.count
batch.deadletter.count
```

Contoh log:

```json
{
  "event": "mybatis.batch_flush",
  "statementId": "AuditTrailMapper.insertBatch",
  "chunkSize": 500,
  "elapsedMs": 820,
  "rowsAffected": 500,
  "attempt": 1
}
```

Untuk batch, jangan log setiap row kecuali failure spesifik dan sudah dimasking.

---

## 27. Observability untuk Stored Procedure

Stored procedure sering menyembunyikan banyak kerja di database.

Mapper log hanya melihat:

```text
CALL approve_case(?, ?, ?, ?)
```

Padahal di dalamnya bisa ada:

- validation query,
- insert audit,
- update many rows,
- send notification queue,
- commit internal,
- exception handling.

Observability minimum:

```json
{
  "statementId": "CaseProcedureMapper.approveCase",
  "procedureName": "APPROVE_CASE",
  "elapsedMs": 2120,
  "resultCode": "SUCCESS",
  "outcome": "success"
}
```

Jika procedure mengembalikan business error code via OUT parameter, log category-nya, bukan raw payload sensitif.

---

## 28. Observability untuk Security dan Tenant Scope

Untuk sistem multi-tenant/agency/module, observability harus bisa membuktikan bahwa query membawa scope.

Jangan log semua tenant data, tetapi log scope presence:

```json
{
  "statementId": "CaseSearchMapper.searchCases",
  "scope": {
    "tenantScoped": true,
    "agencyScoped": true,
    "roleScoped": true
  }
}
```

Untuk mapper sensitif, bisa ada validator di test/interceptor:

```text
statementId matches sensitive namespace
  -> SQL must contain agency_id predicate or use approved bypass annotation
```

Hati-hati: SQL parser yang robust sulit. Untuk governance awal, test berbasis convention dan review checklist sering lebih realistis.

---

## 29. Observability untuk Audit Trail

Audit trail insertion juga perlu observability.

Contoh:

```json
{
  "event": "audit.persisted",
  "auditType": "CASE_STATUS_CHANGE",
  "entityType": "CASE",
  "entityIdHash": "sha256:...",
  "correlationId": "REQ-9f43",
  "statementId": "AuditTrailMapper.insertCaseStatusChange"
}
```

Yang tidak boleh:

```text
Log full serialized audit payload kalau mengandung PII/free text besar.
```

Untuk audit payload besar, log:

- payload type,
- payload size,
- schema version,
- hash,
- storage outcome.

---

## 30. Production Log Format

Gunakan structured logging bila memungkinkan.

Buruk:

```text
SQL slow! query CaseMapper.search took long!!!
```

Baik:

```json
{
  "timestamp": "2026-06-17T10:15:30.120Z",
  "level": "WARN",
  "event": "mybatis.slow_statement",
  "service": "case-service",
  "module": "case",
  "correlationId": "REQ-9f43",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "statementId": "CaseSearchMapper.searchVisibleCasesForOfficer",
  "operation": "SELECT",
  "elapsedMs": 1420,
  "rowCount": 50,
  "sqlShapeHash": "a91f20cc",
  "parameterSummary": {
    "agencyPresent": true,
    "status": "OPEN",
    "keywordPresent": false,
    "pageSize": 50,
    "sort": "CREATED_DESC"
  }
}
```

---

## 31. Local Developer Experience

Observability tidak boleh hanya production-oriented. Developer juga butuh feedback cepat.

Local profile:

```yaml
logging:
  level:
    com.company.aceas.case.mapper: DEBUG
    org.mybatis: INFO

mybatis:
  configuration:
    log-impl: org.apache.ibatis.logging.slf4j.Slf4jImpl
```

Tambahkan test helper untuk print `BoundSql` pada failing test.

Contoh helper:

```java
public final class BoundSqlDebug {
    private BoundSqlDebug() {}

    public static String sqlOf(
            org.apache.ibatis.session.SqlSessionFactory factory,
            String statementId,
            Object parameter
    ) {
        org.apache.ibatis.mapping.MappedStatement statement =
                factory.getConfiguration().getMappedStatement(statementId);
        org.apache.ibatis.mapping.BoundSql boundSql = statement.getBoundSql(parameter);
        return boundSql.getSql().replaceAll("\\s+", " ").trim();
    }
}
```

---

## 32. Observability Tests

Observability juga perlu diuji.

### 32.1 Test Query Count

```java
@Test
void searchCasesShouldNotTriggerNPlusOne() {
    SqlObservationContext.clear();

    caseSearchService.search(criteria);

    SqlObservationContext.Counter counter = SqlObservationContext.current();

    assertThat(counter.getTotalCount()).isLessThanOrEqualTo(3);
    assertThat(counter.getCountByStatement())
        .doesNotContainKey("OfficerMapper.findById");
}
```

### 32.2 Test Sensitive Parameter Not Logged

Buat unit test untuk masker:

```java
@Test
void shouldMaskSensitiveFields() {
    ParameterSummary summary = summarizer.summarize(new SearchCriteria("secret keyword", "081234567"));

    assertThat(summary.toLogMap()).doesNotContainValue("secret keyword");
    assertThat(summary.toLogMap()).doesNotContainValue("081234567");
    assertThat(summary.toLogMap()).containsEntry("keywordPresent", true);
}
```

---

## 33. Parameter Summarizer Pattern

Jangan taruh masking logic tersebar di interceptor.

Desain lebih baik:

```text
Parameter object implements/has observer summary
```

Contoh interface:

```java
public interface ObservableSqlParameter {
    Map<String, Object> toSqlObservationSummary();
}
```

Criteria:

```java
public final class CaseSearchCriteria implements ObservableSqlParameter {
    private final String agencyId;
    private final String status;
    private final String keyword;
    private final int pageSize;
    private final SortOption sort;

    // constructor/getter omitted

    @Override
    public Map<String, Object> toSqlObservationSummary() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("agencyPresent", agencyId != null);
        map.put("status", status);
        map.put("keywordPresent", keyword != null && !keyword.trim().isEmpty());
        map.put("keywordLength", keyword == null ? 0 : keyword.length());
        map.put("pageSize", pageSize);
        map.put("sort", sort == null ? null : sort.name());
        return map;
    }
}
```

Interceptor:

```java
private Map<String, Object> summarize(Object parameterObject) {
    if (parameterObject instanceof ObservableSqlParameter) {
        return ((ObservableSqlParameter) parameterObject).toSqlObservationSummary();
    }
    return Collections.singletonMap("parameterClass", parameterObject == null ? "null" : parameterObject.getClass().getName());
}
```

Ini membuat masking menjadi explicit contract.

---

## 34. Advanced: Annotation untuk Observability Policy

Untuk codebase besar, setiap mapper method bisa punya policy.

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface SqlObservationPolicy {
    boolean logSqlShape() default true;
    boolean logParameterSummary() default true;
    int slowThresholdMs() default 500;
    boolean sensitive() default false;
}
```

Contoh:

```java
public interface CaseSearchMapper {

    @SqlObservationPolicy(slowThresholdMs = 800, sensitive = true)
    List<CaseRow> searchVisibleCasesForOfficer(CaseSearchCriteria criteria);
}
```

Caveat: MyBatis interceptor melihat `MappedStatement`, bukan langsung Java method dalam semua kondisi. Mapping statement id ke method reflection bisa dilakukan, tetapi harus ditulis hati-hati dan di-cache.

---

## 35. Java 8 sampai Java 25 Considerations

### 35.1 Java 8

Gunakan:

- SLF4J MDC,
- ThreadLocal context,
- servlet filter,
- Dropwizard/Micrometer tergantung stack,
- POJO parameter summary.

Hindari ketergantungan pada fitur modern.

### 35.2 Java 11

Tidak banyak perubahan spesifik MyBatis, tetapi runtime lebih baik untuk TLS, container awareness, dan library modern.

### 35.3 Java 17

Baseline umum Spring Boot 3. Bisa memakai:

- records untuk immutable parameter/result object,
- sealed class untuk result/outcome model,
- pattern matching sederhana,
- modern logging libraries.

### 35.4 Java 21

Virtual threads membuat blocking JDBC lebih scalable dari sisi thread cost, tetapi tidak menghapus bottleneck database.

Observability tetap perlu:

- pool metrics,
- query count,
- DB saturation,
- transaction duration.

Virtual thread bisa memperbanyak concurrency sehingga query storm lebih mudah terjadi bila tidak ada backpressure.

### 35.5 Java 25

Untuk Java 25+, prinsipnya sama: gunakan fitur bahasa modern untuk clarity, tetapi jangan membuat mapper observability bergantung pada fitur yang tidak tersedia bila codebase masih harus support Java 8.

---

## 36. Anti-Patterns

### 36.1 Enable Full SQL DEBUG in Production Forever

```text
logging.level.com.company.mapper=TRACE
```

Risiko:

- PII leak,
- log cost besar,
- performance overhead,
- sinyal penting tertutup.

### 36.2 Log Raw Parameter Map

```java
log.info("params={}", parameterObject);
```

Jika `toString()` DTO mencetak semua field, ini langsung bocor.

### 36.3 Use Case Tidak Punya Statement ID yang Jelas

```text
GenericMapper.query
```

Sulit ownership dan troubleshooting.

### 36.4 Metrics dengan Parameter Value

```text
status okay, caseNo tidak okay.
```

High cardinality dan sensitive data.

### 36.5 Mengandalkan Database Monitoring Saja

Database tahu SQL, tapi tidak selalu tahu:

- request path,
- user journey,
- mapper id,
- module owner,
- feature flag,
- business operation.

Aplikasi harus memberi konteks.

---

## 37. Production Readiness Checklist

### 37.1 Logging

- [ ] MyBatis memakai SLF4J/logging backend terkontrol.
- [ ] `STDOUT_LOGGING` tidak dipakai di production.
- [ ] SQL DEBUG tidak aktif global secara permanen.
- [ ] Raw parameter tidak dilog di production.
- [ ] Sensitive fields dimasking/hide.
- [ ] Log format structured atau minimal konsisten.

### 37.2 Correlation

- [ ] Setiap request/job punya correlation id.
- [ ] Correlation id masuk MDC.
- [ ] Correlation id muncul di mapper slow/error log.
- [ ] Trace id bila ada masuk log.
- [ ] Audit event bisa dikaitkan ke correlation id.

### 37.3 Metrics

- [ ] Mapper latency per statement id.
- [ ] Error count per statement id.
- [ ] Query count per request.
- [ ] Slow query count.
- [ ] Row count / affected row signal.
- [ ] Batch chunk/flush metric.

### 37.4 Security

- [ ] PII tidak masuk log raw.
- [ ] Secret tidak pernah masuk log.
- [ ] Large CLOB/BLOB/JSON tidak masuk log raw.
- [ ] Parameter summary sudah diklasifikasi.
- [ ] Metric labels tidak high-cardinality.

### 37.5 Troubleshooting

- [ ] Dari slow query log bisa menemukan mapper XML/method.
- [ ] Dari mapper method bisa menemukan owner module.
- [ ] Dari statement id bisa mencari test terkait.
- [ ] Bisa membedakan pool wait, DB execution, mapping, dan serialization issue.
- [ ] Ada cara melihat SQL shape/fingerprint.

---

## 38. Mini Case Study: Case Search Slow in Production

### 38.1 Symptom

```text
Endpoint /cases/search kadang lambat sampai 8 detik.
Database CPU naik.
Tidak ada error.
```

### 38.2 Tanpa Observability

Engineer hanya tahu:

```text
Aplikasi lambat.
Mungkin database lambat.
```

Lalu debugging menjadi spekulatif:

- tambah connection pool,
- restart pod,
- tambah index random,
- blame network,
- enable full SQL log dan bocor data.

### 38.3 Dengan Observability

Slow log:

```json
{
  "event": "mybatis.slow_statement",
  "correlationId": "REQ-7a21",
  "statementId": "CaseSearchMapper.searchVisibleCasesForOfficer",
  "elapsedMs": 8120,
  "rowCount": 50,
  "sqlShapeHash": "f13abc92",
  "parameterSummary": {
    "agencyPresent": true,
    "status": "OPEN",
    "keywordPresent": true,
    "keywordLength": 3,
    "pageSize": 50,
    "sort": "CREATED_DESC"
  }
}
```

Request summary:

```json
{
  "event": "request.sql_summary",
  "correlationId": "REQ-7a21",
  "queryCount": 151,
  "topStatements": {
    "CaseSearchMapper.searchVisibleCasesForOfficer": 1,
    "OfficerMapper.findById": 50,
    "DocumentMapper.countByCaseId": 50,
    "NoteMapper.findLatestByCaseId": 50
  }
}
```

Root cause menjadi jelas:

```text
Bukan hanya query search lambat.
Endpoint terkena N+1 untuk officer, document count, dan latest note.
```

Fix:

- root query tetap paginated,
- officer di-fetch batch by officer ids,
- document count di-aggregate `GROUP BY case_id`,
- latest note memakai analytic/window function atau precomputed read model,
- test query count ditambahkan.

---

## 39. Mini Case Study: Tenant Leakage Prevention

### 39.1 Risk

Mapper:

```xml
<select id="findById" resultMap="CaseDetailMap">
  SELECT id, agency_id, status, title
  FROM case_file
  WHERE id = #{caseId}
</select>
```

Bug:

```text
User dari agency A bisa membaca case agency B bila tahu id.
```

### 39.2 Observability Improvement

Parameter summary:

```json
{
  "statementId": "CaseDetailMapper.findVisibleById",
  "scope": {
    "agencyScoped": true,
    "roleScoped": true
  }
}
```

Mapper contract:

```java
Optional<CaseDetail> findVisibleById(CaseVisibilityQuery query);
```

SQL:

```xml
<select id="findVisibleById" resultMap="CaseDetailMap">
  SELECT id, agency_id, status, title
  FROM case_file
  WHERE id = #{caseId}
    AND agency_id = #{agencyId}
    AND deleted = 0
</select>
```

Test:

```text
different agency -> empty result
same agency -> returns result
```

Observability tidak menggantikan security test, tetapi membantu mendeteksi dan menegakkan pattern.

---

## 40. Decision Framework

Gunakan pertanyaan ini saat mendesain observability mapper:

```text
1. Apakah statement id cukup spesifik untuk ownership?
2. Apakah query ini sensitive?
3. Parameter mana yang aman dilog?
4. Parameter mana yang harus diringkas/hash/mask?
5. Apa threshold lambat yang realistis?
6. Apakah row count penting?
7. Apakah affected rows adalah correctness signal?
8. Apakah query ini bisa muncul berkali-kali dalam satu request?
9. Apakah SQL shape dinamis perlu fingerprint?
10. Apakah database monitoring bisa dikaitkan ke request/correlation id?
11. Apakah log/metric punya cardinality terkendali?
12. Apakah observability ini masih aman untuk production?
```

---

## 41. Ringkasan

MyBatis observability bukan hanya menyalakan log SQL. Engineer yang matang harus bisa membangun sistem yang menjawab:

```text
statement apa berjalan,
dari request/job mana,
oleh use case mana,
dengan parameter kategori apa,
berapa lama,
berapa row,
berapa kali dipanggil,
apakah lambat karena DB, mapping, pool, lock, atau N+1,
apakah aman dari PII leak,
dan siapa owner mapper-nya.
```

Prinsip utama:

```text
Log SQL shape, bukan raw sensitive SQL instance.
Log parameter summary, bukan parameter mentah.
Metric pakai statement id, bukan parameter value.
Trace hubungkan request-service-mapper-database.
Audit bukan SQL log.
Observability harus aman, murah, dan actionable.
```

Jika Part 21 mengajarkan cara membuat query cepat, Part 22 mengajarkan cara mengetahui **mengapa query lambat, kapan lambat, siapa pemicunya, dan bagaimana membuktikannya tanpa membocorkan data**.

---

## 42. Referensi

- MyBatis 3 Documentation — Logging: https://mybatis.org/mybatis-3/logging.html
- MyBatis 3 Documentation — Mapper XML Files: https://mybatis.org/mybatis-3/sqlmap-xml.html
- MyBatis 3 Documentation — Configuration: https://mybatis.org/mybatis-3/configuration.html
- MyBatis 3 Documentation — Java API: https://mybatis.org/mybatis-3/java-api.html
- MyBatis Spring Boot Starter Autoconfigure: https://mybatis.org/spring-boot-starter/mybatis-spring-boot-autoconfigure/
- OpenTelemetry Java Documentation: https://opentelemetry.io/docs/languages/java/
- OpenTelemetry Java Agent: https://opentelemetry.io/docs/zero-code/java/agent/
