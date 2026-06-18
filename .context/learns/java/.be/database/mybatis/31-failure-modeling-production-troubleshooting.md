# Part 31 — Failure Modeling and Production Troubleshooting

**Series:** `learn-java-mybatis-sql-mapper-persistence-engineering`  
**File:** `31-failure-modeling-production-troubleshooting.md`  
**Target:** Java 8–25, MyBatis 3.x, MyBatis-Spring, Spring Boot integration  
**Prerequisite:** Part 0–30

---

## 1. Tujuan Bagian Ini

Bagian ini membahas MyBatis dari sudut pandang yang sering membedakan engineer biasa dan engineer senior: **apa yang rusak di production, bagaimana membaca sinyalnya, bagaimana mempersempit kemungkinan, dan bagaimana memperbaiki tanpa menambah kerusakan baru**.

Di level dasar, orang belajar MyBatis sebagai:

```text
mapper method -> SQL -> result object
```

Di production, bentuk realitanya lebih seperti:

```text
HTTP/request/job/event
  -> service transaction boundary
  -> mapper proxy
  -> MappedStatement lookup
  -> dynamic SQL rendering
  -> parameter binding
  -> JDBC driver
  -> database parser/optimizer/executor
  -> ResultSet
  -> result mapping
  -> object graph/lazy loading/cache
  -> response/audit/event/commit
```

Masalah bisa muncul di setiap titik. Maka troubleshooting MyBatis bukan sekadar membaca stack trace, tetapi membangun **failure model**.

Mental model utama bagian ini:

```text
Setiap mapper method adalah executable contract.
Jika contract rusak, cari di lapisan mana ia rusak:

1. wiring/configuration
2. statement resolution
3. SQL rendering
4. parameter binding
5. database execution
6. result mapping
7. transaction/session/cache
8. performance/resource
9. concurrency/consistency
10. security/scope
```

---

## 2. Apa Itu Failure Modeling?

Failure modeling adalah cara berpikir sistematis untuk menjawab:

1. Apa invariant yang seharusnya dijaga?
2. Apa observable symptom yang terlihat?
3. Di lapisan mana invariant kemungkinan pecah?
4. Bukti apa yang bisa membedakan penyebab A dari penyebab B?
5. Fix apa yang memperbaiki root cause, bukan hanya symptom?

Contoh sederhana:

```text
Symptom:
  User A melihat case milik agency B.

Bad troubleshooting:
  "Mungkin query salah. Tambah filter agency_id di service."

Better troubleshooting:
  Invariant:
    Semua query case harus scoped by agency_id dan visibility role.

  Possible failure layer:
    - mapper method tidak menerima DataScope
    - SQL fragment scope tidak di-include
    - dynamic SQL menghilangkan filter saat parameter null
    - cache key tidak memasukkan agencyId
    - reporting mapper memang cross-agency tapi dipakai di endpoint normal
    - interceptor tenant guard tidak aktif untuk datasource tertentu

  Evidence:
    - statement id mana yang jalan?
    - BoundSql final seperti apa?
    - parameter agencyId ada atau null?
    - cache hit atau DB hit?
    - endpoint memakai mapper yang mana?
```

Failure modeling membuat debugging menjadi proses eliminasi berbasis bukti.

---

## 3. Lapisan Failure MyBatis

### 3.1 Configuration/Wiring Failure

Masalah terjadi sebelum SQL benar-benar dieksekusi.

Contoh:

- mapper tidak ter-scan;
- XML tidak ditemukan;
- namespace mismatch;
- duplicate statement id;
- type alias tidak terdaftar;
- type handler tidak terdaftar;
- mapper masuk ke `SqlSessionFactory` yang salah;
- multi-datasource salah wiring;
- environment profile salah.

### 3.2 Statement Resolution Failure

Mapper method dipanggil, tetapi MyBatis tidak menemukan mapped statement yang cocok.

Contoh:

```text
Invalid bound statement (not found): com.example.CaseMapper.findById
```

Kemungkinan:

- namespace XML tidak sama dengan fully qualified mapper interface;
- id statement tidak sama dengan method name;
- XML tidak masuk classpath;
- mapper interface memakai method overload yang membingungkan;
- resource path salah;
- build tool tidak copy XML ke output;
- mapper memakai annotation tetapi XML override tidak ada.

### 3.3 SQL Rendering Failure

Mapped statement ditemukan, tetapi SQL final yang dihasilkan salah.

Contoh:

- `WHERE AND status = ?`;
- `IN ()`;
- trailing comma pada `SET`;
- dynamic `ORDER BY` kosong;
- condition hilang karena OGNL expression salah;
- SQL vendor-specific jalan di database yang salah;
- `${}` menghasilkan identifier invalid atau injection.

### 3.4 Parameter Binding Failure

SQL shape benar, tetapi parameter tidak bisa di-bind atau nilainya salah.

Contoh:

- `Parameter 'id' not found`;
- `There is no getter for property named ...`;
- `Invalid column type`;
- `ORA-17004 Invalid column type`;
- enum code salah;
- null butuh `jdbcType`;
- `@Param` tidak sesuai nama di XML;
- primitive null problem.

### 3.5 Database Execution Failure

SQL dan parameter sampai ke database, tetapi database menolak atau gagal menjalankan.

Contoh:

- syntax error;
- constraint violation;
- deadlock;
- lock timeout;
- statement timeout;
- permission denied;
- invalid object/table/view;
- sequence missing;
- duplicate key;
- foreign key violation;
- numeric overflow;
- date conversion error.

### 3.6 Result Mapping Failure

Database mengembalikan row, tetapi MyBatis gagal atau salah memetakan.

Contoh:

- invalid column name;
- unknown column warning/fail;
- null masuk primitive;
- enum unknown code;
- constructor arg mismatch;
- `TooManyResultsException`;
- nested collection duplicate salah collapse;
- column alias collision;
- resultMap reuse salah.

### 3.7 Transaction/Session/Cache Failure

SQL berhasil, tetapi consistency rusak karena lifecycle session/transaction/cache.

Contoh:

- query membaca data stale dari local cache;
- second-level cache invalidation salah;
- mapper dipanggil di luar transaction yang diharapkan;
- self-invocation membuat `@Transactional` tidak aktif;
- `REQUIRES_NEW` memecah atomicity;
- batch belum di-flush;
- cursor dipakai setelah session tertutup;
- lazy loading jalan setelah transaction selesai.

### 3.8 Performance/Resource Failure

Correctness tidak langsung gagal, tetapi aplikasi lambat atau resource habis.

Contoh:

- slow query;
- unbounded `selectList`;
- full table scan;
- N+1 query;
- heap spike;
- connection pool exhausted;
- database CPU tinggi;
- lock wait tinggi;
- large LOB loaded unintentionally;
- batch terlalu besar;
- fetch size tidak sesuai.

### 3.9 Concurrency/Consistency Failure

Sistem berjalan benar saat single user, tapi salah saat concurrent.

Contoh:

- lost update;
- double approval;
- duplicate event processing;
- worker claim race;
- deadlock;
- stale decision;
- idempotency failure;
- audit tidak atomic dengan state change.

### 3.10 Security/Scope Failure

Query berhasil secara teknis, tapi melanggar security boundary.

Contoh:

- SQL injection;
- tenant leakage;
- row-level authorization bypass;
- over-fetching sensitive columns;
- log leakage;
- cache leakage;
- generic mapper dipakai tanpa scope.

---

## 4. Troubleshooting Rule: Jangan Mulai dari Tebakan

Production troubleshooting harus dimulai dari bukti minimum:

```text
1. Endpoint/job/event apa yang memicu?
2. Correlation/request id apa?
3. Mapper statement id apa?
4. Final SQL shape apa?
5. Parameter penting apa? Jangan log PII mentah.
6. Transaction boundary aktif atau tidak?
7. Database error code apa?
8. Rows affected berapa?
9. Execution time berapa?
10. Perubahan terbaru apa? Code, schema, config, data volume, index, deployment.
```

Tanpa ini, engineer akan cenderung melakukan fix spekulatif.

---

## 5. Mapper Not Found / Invalid Bound Statement

### 5.1 Symptom

Error umum:

```text
org.apache.ibatis.binding.BindingException:
Invalid bound statement (not found): com.acme.case.CaseMapper.findById
```

### 5.2 Meaning

Mapper proxy menerima call ke method `findById`, lalu mencari `MappedStatement` dengan key:

```text
com.acme.case.CaseMapper.findById
```

Jika key tidak ada di `Configuration`, error muncul.

### 5.3 Kemungkinan Penyebab

#### 5.3.1 Namespace XML Salah

Interface:

```java
package com.acme.caseapp.persistence;

public interface CaseMapper {
    CaseRow findById(Long id);
}
```

XML salah:

```xml
<mapper namespace="com.acme.caseapp.CaseMapper">
```

Harus:

```xml
<mapper namespace="com.acme.caseapp.persistence.CaseMapper">
```

#### 5.3.2 Statement ID Tidak Sama

Method:

```java
CaseRow findById(Long id);
```

XML:

```xml
<select id="selectById" resultMap="CaseRowMap">
```

Mapper proxy akan mencari `findById`, bukan `selectById`.

#### 5.3.3 XML Tidak Masuk Classpath

Sering terjadi pada Maven/Gradle multi-module.

Expected layout:

```text
src/main/resources/mapper/case/CaseMapper.xml
```

Spring Boot property:

```yaml
mybatis:
  mapper-locations: classpath*:mapper/**/*.xml
```

Jika XML ada di `src/main/java`, belum tentu ikut resource output kecuali build dikonfigurasi khusus.

#### 5.3.4 Mapper Scan Salah Package

```java
@MapperScan("com.acme.user.persistence")
```

Padahal `CaseMapper` ada di:

```text
com.acme.caseapp.persistence
```

#### 5.3.5 Multi-Datasource Salah Factory

Mapper Oracle terdaftar di PostgreSQL `SqlSessionFactory`, atau sebaliknya.

Symptom bisa berupa:

- statement not found;
- table not found;
- syntax error vendor;
- transaction manager tidak sesuai.

### 5.4 Debug Checklist

```text
[ ] Apakah mapper interface menjadi Spring bean?
[ ] Apakah XML masuk target/classes?
[ ] Apakah namespace = fully qualified mapper interface?
[ ] Apakah statement id = method name?
[ ] Apakah mapper-locations memakai classpath* untuk multi-module jar?
[ ] Apakah mapper masuk ke SqlSessionFactory yang benar?
[ ] Apakah ada duplicate namespace/statement conflict?
```

### 5.5 Prevention

Tambahkan startup test:

```java
@SpringBootTest
class MyBatisWiringTest {

    @Autowired
    org.apache.ibatis.session.SqlSessionFactory sqlSessionFactory;

    @Test
    void requiredStatementsExist() {
        var config = sqlSessionFactory.getConfiguration();

        assertThat(config.hasStatement(
            "com.acme.caseapp.persistence.CaseMapper.findById"
        )).isTrue();
    }
}
```

Untuk codebase besar, buat inventory statement id saat startup di non-prod.

---

## 6. XML Parse Error Saat Startup

### 6.1 Symptom

Contoh:

```text
Error parsing Mapper XML
Cause: org.apache.ibatis.builder.BuilderException
```

Atau:

```text
The content of element type "select" must match ...
```

### 6.2 Penyebab Umum

- tag XML tidak valid;
- `<` dalam SQL tidak di-escape;
- `&` tidak di-escape;
- resultMap reference tidak ada;
- type alias tidak ditemukan;
- duplicate resultMap id;
- duplicate statement id;
- SQL fragment include tidak ditemukan.

### 6.3 Escape XML

Salah:

```xml
<select id="findOldCases">
  SELECT * FROM cases WHERE created_at < #{cutoff}
</select>
```

Benar:

```xml
<select id="findOldCases">
  SELECT * FROM cases WHERE created_at &lt; #{cutoff}
</select>
```

Atau gunakan CDATA secara hati-hati:

```xml
<select id="findOldCases">
  <![CDATA[
    SELECT * FROM cases WHERE created_at < #{cutoff}
  ]]>
</select>
```

CDATA jangan dipakai untuk membungkus dynamic tag MyBatis secara sembarangan, karena tag seperti `<if>` harus tetap diproses sebagai XML element.

### 6.4 Prevention

```text
[ ] Jalankan test context minimal.
[ ] Validasi semua mapper XML di CI.
[ ] Hindari type alias ambigu.
[ ] Hindari duplicate id lintas copy-paste.
[ ] Jangan menaruh SQL XML besar tanpa test parse.
```

---

## 7. Parameter Not Found

### 7.1 Symptom

```text
Parameter 'status' not found. Available parameters are [arg1, arg0, param1, param2]
```

### 7.2 Penyebab

Method:

```java
List<CaseRow> search(String status, Long agencyId);
```

XML:

```xml
WHERE status = #{status}
  AND agency_id = #{agencyId}
```

Tanpa `@Param`, MyBatis tidak selalu tahu nama parameter Java, terutama pada Java 8 legacy/build tanpa `-parameters`.

### 7.3 Fix Aman

```java
List<CaseRow> search(
    @Param("status") String status,
    @Param("agencyId") Long agencyId
);
```

Lebih baik untuk criteria kompleks:

```java
List<CaseRow> search(CaseSearchCriteria criteria);
```

XML:

```xml
WHERE status = #{status}
  AND agency_id = #{agencyId}
```

Jika parameter object punya property tersebut.

### 7.4 Rule

```text
Jika mapper method punya lebih dari satu scalar parameter,
wajib pakai @Param atau ubah menjadi parameter object.
```

Untuk production-grade mapper, parameter object biasanya lebih maintainable.

---

## 8. There Is No Getter for Property

### 8.1 Symptom

```text
There is no getter for property named 'caseId' in class java.lang.Long
```

### 8.2 Penyebab

Method:

```java
CaseRow findById(Long id);
```

XML:

```xml
WHERE case_id = #{caseId}
```

Parameter sebenarnya adalah `Long`, bukan object dengan getter `getCaseId()`.

### 8.3 Fix

Pilihan 1:

```xml
WHERE case_id = #{value}
```

Tapi ini kurang eksplisit.

Pilihan 2:

```java
CaseRow findById(@Param("caseId") Long caseId);
```

XML:

```xml
WHERE case_id = #{caseId}
```

Pilihan 3 untuk contract lebih kuat:

```java
record CaseId(long value) {}
```

Dengan TypeHandler bila perlu.

---

## 9. SQL Syntax Error

### 9.1 Symptom

```text
SQLSyntaxErrorException
BadSqlGrammarException
ORA-00933: SQL command not properly ended
ERROR: syntax error at or near ...
```

### 9.2 Kemungkinan Penyebab MyBatis-Specific

- dynamic SQL menghasilkan token tidak valid;
- `<where>` tidak dipakai sehingga `WHERE AND`;
- `<set>` tidak dipakai sehingga trailing comma;
- `foreach` menghasilkan `IN ()`;
- `${sort}` berisi string invalid;
- vendor SQL salah database;
- XML entity escape salah;
- fragment include menghasilkan clause ganda.

### 9.3 Cara Debug

Ambil final SQL dari log atau `BoundSql`.

```java
MappedStatement ms = sqlSessionFactory.getConfiguration()
    .getMappedStatement("com.acme.CaseMapper.search");

BoundSql boundSql = ms.getBoundSql(criteria);

System.out.println(boundSql.getSql());
System.out.println(boundSql.getParameterMappings());
```

Jangan hanya lihat XML, karena dynamic SQL bisa berbeda per input.

### 9.4 Test Branch Dynamic SQL

```java
@ParameterizedTest
@MethodSource("criteriaCases")
void searchSqlShouldBeValid(CaseSearchCriteria criteria) {
    BoundSql sql = mappedStatement.getBoundSql(criteria);

    assertThat(sql.getSql()).doesNotContain("WHERE AND");
    assertThat(sql.getSql()).doesNotContain("IN ()");
    assertThat(sql.getSql()).doesNotContain(", WHERE");
}
```

---

## 10. Too Many Results

### 10.1 Symptom

```text
org.apache.ibatis.exceptions.TooManyResultsException:
Expected one result (or null) to be returned by selectOne(), but found: 2
```

### 10.2 Meaning

Mapper method mengharapkan cardinality `0..1`, tetapi database mengembalikan lebih dari satu row.

### 10.3 Root Cause Biasa

- WHERE tidak unique;
- tenant/agency scope hilang;
- soft-deleted row ikut terbaca;
- join menghasilkan duplicate root row;
- data corruption;
- unique constraint tidak ada;
- mapper method salah memakai single return.

### 10.4 Jangan Fix Dengan `LIMIT 1` Sembarangan

Bad fix:

```sql
SELECT ... FROM cases WHERE reference_no = #{referenceNo} FETCH FIRST 1 ROW ONLY
```

Ini menyembunyikan data corruption atau scope bug.

Better:

```text
1. Pastikan invariant unique secara database constraint.
2. Pastikan query memakai tenant/agency/scope predicate.
3. Jika memang multi-row, return List, bukan single object.
4. Jika mengambil latest, order by harus deterministic dan nama method jelas.
```

Contoh method jelas:

```java
Optional<CaseRow> findLatestByReferenceNo(CaseReferenceNo referenceNo);
```

SQL:

```sql
ORDER BY created_at DESC, case_id DESC
FETCH FIRST 1 ROW ONLY
```

---

## 11. Null Primitive Error

### 11.1 Symptom

Mapping gagal atau value default misleading karena kolom nullable dipetakan ke primitive.

```java
private int retryCount;
private boolean active;
```

Jika DB mengembalikan `NULL`, primitive tidak bisa merepresentasikan unknown.

### 11.2 Rule

```text
Kolom nullable harus dipetakan ke wrapper type:
Integer, Long, Boolean, BigDecimal, LocalDateTime, dll.
```

Primitive hanya aman jika:

- kolom `NOT NULL`;
- result query selalu `COALESCE`;
- default semantic memang benar.

### 11.3 Example

```sql
SELECT COALESCE(retry_count, 0) AS retry_count
FROM job_queue
```

Baru boleh:

```java
private int retryCount;
```

---

## 12. Invalid Column Name / Column Not Found

### 12.1 Symptom

```text
Invalid column name
Column 'case_id' not found
```

### 12.2 Penyebab

- SQL tidak select kolom yang di-resultMap;
- alias tidak sama;
- query join punya duplicate column name;
- resultMap reuse untuk query projection berbeda;
- vendor driver memakai column label berbeda;
- `SELECT *` berubah setelah schema migration.

### 12.3 Fix Pattern

Gunakan explicit alias:

```sql
SELECT
  c.case_id       AS case_id,
  c.reference_no  AS reference_no,
  c.status_code   AS status_code,
  a.agency_id     AS agency_id,
  a.name          AS agency_name
FROM cases c
JOIN agencies a ON a.agency_id = c.agency_id
```

Result map:

```xml
<resultMap id="CaseDetailMap" type="CaseDetailRow">
  <id property="caseId" column="case_id"/>
  <result property="referenceNo" column="reference_no"/>
  <result property="statusCode" column="status_code"/>
  <association property="agency" javaType="AgencyRow">
    <id property="agencyId" column="agency_id"/>
    <result property="name" column="agency_name"/>
  </association>
</resultMap>
```

---

## 13. Enum Mapping Failure

### 13.1 Symptom

```text
No enum constant com.acme.CaseStatus.PENDING_APPROVAL
```

Atau status salah tanpa error.

### 13.2 Penyebab

- DB menyimpan code `P`, Java enum bernama `PENDING`;
- DB menyimpan display label;
- enum rename di Java mematahkan historical data;
- unknown code tidak ditangani;
- default EnumTypeHandler tidak cocok.

### 13.3 Better Pattern

```java
public enum CaseStatus implements CodeEnum {
    DRAFT("D"),
    PENDING_APPROVAL("P"),
    APPROVED("A"),
    REJECTED("R");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static CaseStatus fromCode(String code) {
        for (CaseStatus status : values()) {
            if (status.code.equals(code)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown CaseStatus code: " + code);
    }
}
```

Gunakan `TypeHandler` explicit untuk code mapping.

---

## 14. Rows Affected Tidak Sesuai

### 14.1 Symptom

Update berhasil tanpa exception, tetapi data tidak berubah.

```java
mapper.approve(command); // return int ignored
```

### 14.2 Rule

Untuk DML penting, `int rowsAffected` adalah signal correctness.

```java
int updated = mapper.approve(command);

if (updated != 1) {
    throw new ConcurrentModificationException("Case was not in approvable state");
}
```

### 14.3 Interpretasi

```text
0 rows:
  - row tidak ada
  - tenant scope salah
  - status guard tidak cocok
  - version stale
  - already processed
  - soft-deleted

1 row:
  - expected success untuk single-row command

>1 rows:
  - WHERE terlalu luas
  - missing id/scope predicate
  - dangerous production bug
```

### 14.4 Statement Aman

```xml
<update id="approve">
  UPDATE cases
  SET status_code = 'APPROVED',
      version = version + 1,
      approved_by = #{actorUserId},
      approved_at = #{now}
  WHERE case_id = #{caseId}
    AND agency_id = #{agencyId}
    AND status_code = 'PENDING_APPROVAL'
    AND version = #{expectedVersion}
</update>
```

---

## 15. Deadlock

### 15.1 Symptom

- database deadlock error;
- transaction rollback;
- intermittent under load;
- sulit direproduksi single-thread.

### 15.2 Common MyBatis Scenario

Transaction A:

```text
update case 1
update case 2
```

Transaction B:

```text
update case 2
update case 1
```

Terjadi circular wait.

### 15.3 Fix Pattern

Lock/update dalam urutan deterministik:

```java
List<Long> sortedIds = ids.stream().sorted().toList();
mapper.bulkUpdate(sortedIds);
```

SQL:

```sql
WHERE case_id IN (...)
ORDER BY tidak selalu menentukan order update internal semua vendor.
```

Untuk operasi kritis, pertimbangkan claim/lock rows dengan order deterministic lalu update by claimed IDs.

### 15.4 Retry Boundary

Deadlock biasanya boleh retry jika operation idempotent.

```text
Retry aman jika:
  - command punya idempotency key;
  - tidak mengirim external side effect sebelum commit;
  - audit/event/outbox tidak duplicate;
  - transaction rollback penuh.
```

Jangan retry membabi-buta pada operation non-idempotent.

---

## 16. Lock Timeout

### 16.1 Symptom

- request menggantung;
- timeout dari DB/JDBC/app;
- database session menunggu lock.

### 16.2 Penyebab

- transaction terlalu panjang;
- external API call di dalam transaction;
- user interaction menahan transaction;
- batch besar mengunci banyak row;
- missing index menyebabkan banyak row terkunci;
- update predicate terlalu luas.

### 16.3 Fix Pattern

```text
[ ] Pendekkan transaction.
[ ] Jangan panggil external service saat lock masih ditahan.
[ ] Pastikan predicate update indexed.
[ ] Gunakan optimistic locking bila bisa.
[ ] Gunakan NOWAIT/SKIP LOCKED untuk worker pattern.
[ ] Pecah batch menjadi chunk.
[ ] Tambahkan lock timeout yang eksplisit.
```

---

## 17. Connection Pool Exhausted

### 17.1 Symptom

```text
Connection is not available, request timed out
HikariPool - Connection is not available
```

### 17.2 MyBatis-Related Causes

- cursor tidak ditutup;
- ResultHandler processing terlalu lama sambil menahan connection;
- transaction panjang;
- slow query;
- N+1 membuat banyak query dalam request;
- pool terlalu kecil untuk concurrency;
- leak karena manual SqlSession tidak ditutup;
- streaming HTTP response menahan DB connection.

### 17.3 Cursor Safe Usage

```java
try (Cursor<AuditRow> cursor = mapper.streamAudit(criteria)) {
    for (AuditRow row : cursor) {
        writer.write(row);
    }
}
```

Dalam Spring, pastikan session/transaction tetap aktif selama cursor dikonsumsi.

### 17.4 Diagnosis

```text
[ ] Pool active/idle/pending metrics.
[ ] Slow SQL log.
[ ] Thread dump: thread menunggu connection atau DB response?
[ ] Query count per request.
[ ] Cursor/stream usage.
[ ] Transaction duration metrics.
```

---

## 18. Batch Partial Failure

### 18.1 Symptom

Batch insert/update gagal di tengah.

Error bisa muncul saat:

```java
sqlSession.flushStatements();
```

bukan saat mapper method dipanggil.

### 18.2 Common Mistake

```java
for (Item item : items) {
    mapper.insert(item); // terlihat sukses
}
// error baru muncul saat commit/flush
```

### 18.3 Safe Batch Model

```text
batch = chunk + transaction + flush + verify + checkpoint
```

Pseudo:

```java
for (List<Item> chunk : chunks(items, 500)) {
    transactionTemplate.execute(status -> {
        for (Item item : chunk) {
            mapper.insert(item);
        }
        sqlSession.flushStatements();
        return null;
    });
}
```

### 18.4 Idempotent Batch

Gunakan natural key atau idempotency key:

```sql
UNIQUE (source_system, external_event_id)
```

Supaya retry tidak duplicate.

---

## 19. Cache Stale Data

### 19.1 Symptom

- user melihat data lama setelah update;
- query di transaction yang sama tidak melihat perubahan eksternal;
- node A update, node B masih membaca stale cache;
- permission berubah tapi cache masih menampilkan data lama.

### 19.2 First-Level Cache

Default local cache scope `SESSION` bisa mengembalikan object yang sama dalam satu `SqlSession`.

Jika transaction panjang:

```java
CaseRow a = mapper.findById(id);
// external update by another transaction
CaseRow b = mapper.findById(id); // bisa stale dalam session yang sama
```

### 19.3 Second-Level Cache

Risiko:

- invalidation per namespace terlalu kasar atau terlalu sempit;
- multi-node stale jika cache local in-memory;
- cache key tidak memasukkan tenant/security dimension;
- object mutable dimodifikasi setelah dibaca.

### 19.4 Debug Checklist

```text
[ ] Statement memakai useCache=true?
[ ] DML flushCache=true?
[ ] Namespace cache aktif?
[ ] localCacheScope SESSION atau STATEMENT?
[ ] Ada cache-ref antar namespace?
[ ] Cache key memasukkan parameter scope?
[ ] Ada multi-node deployment?
```

---

## 20. N+1 Query Production Incident

### 20.1 Symptom

- endpoint lambat hanya saat result banyak;
- DB query count meledak;
- mapper method child dipanggil berulang;
- CPU app tinggi karena mapping/serialization.

### 20.2 Penyebab

Nested select:

```xml
<collection property="documents"
            column="case_id"
            select="selectDocumentsByCaseId"/>
```

Untuk 100 case, query menjadi:

```text
1 query root + 100 query document
```

### 20.3 Fix Pattern

Root-first pagination + batch child fetch:

```java
List<CaseRow> cases = caseMapper.searchPage(criteria);
List<Long> caseIds = cases.stream().map(CaseRow::caseId).toList();
List<DocumentRow> docs = documentMapper.findByCaseIds(scope, caseIds);
return assembler.attachDocuments(cases, docs);
```

SQL child:

```xml
<select id="findByCaseIds" resultMap="DocumentRowMap">
  SELECT ...
  FROM documents
  WHERE agency_id = #{scope.agencyId}
    AND case_id IN
    <foreach collection="caseIds" item="id" open="(" separator="," close=")">
      #{id}
    </foreach>
</select>
```

### 20.4 Prevention

- query count metric per request;
- test query count for common page size;
- avoid lazy nested graph on listing page;
- projection-first API design.

---

## 21. Dynamic SQL Logic Bug

### 21.1 Symptom

Query tidak error, tetapi hasil salah.

Contoh:

```xml
<if test="status != null or status != ''">
  AND status_code = #{status}
</if>
```

Bug: expression `or` membuat kondisi hampir selalu true.

Harus:

```xml
<if test="status != null and status != ''">
  AND status_code = #{status}
</if>
```

### 21.2 Testing

Buat matrix criteria:

```text
status null
status empty
status valid
agency only
date only
keyword only
all filters
no filters
```

Untuk setiap branch, assert:

- SQL contains expected predicate;
- SQL does not contain unexpected predicate;
- parameter mapping sesuai;
- hasil query benar pada dataset kecil.

---

## 22. SQL Injection Incident

### 22.1 Symptom

- query error dengan token aneh;
- log menunjukkan `ORDER BY status desc; drop table ...`;
- data scope bypass;
- security scan menemukan `${}`.

### 22.2 Root Cause

Unsafe:

```xml
ORDER BY ${sortColumn} ${sortDirection}
```

### 22.3 Fix

Whitelist di Java:

```java
public enum CaseSortField {
    CREATED_AT("c.created_at"),
    STATUS("c.status_code"),
    PRIORITY("c.priority");

    private final String sql;

    CaseSortField(String sql) {
        this.sql = sql;
    }

    public String sql() {
        return sql;
    }
}
```

Criteria hanya menerima enum, bukan raw string.

XML:

```xml
ORDER BY ${sortField.sql} ${sortDirection.sql}
```

Catatan: `${}` masih dipakai, tetapi input sudah bukan user string mentah; ia berasal dari enum whitelist internal.

### 22.4 Prevention

```text
[ ] Ban raw ${} dari user input.
[ ] Static scan semua mapper XML.
[ ] Review semua ORDER BY dynamic.
[ ] Test injection payload.
[ ] Jangan pakai Map bebas untuk criteria external.
```

---

## 23. Tenant Leakage Incident

### 23.1 Symptom

User melihat data tenant/agency lain.

### 23.2 Root Cause Pattern

```xml
<select id="findById" resultMap="CaseMap">
  SELECT ... FROM cases WHERE case_id = #{caseId}
</select>
```

Method tidak menerima scope.

### 23.3 Correct Pattern

```java
Optional<CaseRow> findById(
    @Param("scope") DataScope scope,
    @Param("caseId") Long caseId
);
```

```xml
<select id="findById" resultMap="CaseMap">
  SELECT ...
  FROM cases
  WHERE case_id = #{caseId}
    AND agency_id = #{scope.agencyId}
</select>
```

### 23.4 Stronger Contract

Jangan beri nama generic `findById` jika data scoped.

```java
Optional<CaseRow> findVisibleCaseById(DataScope scope, CaseId caseId);
```

---

## 24. Schema Migration Breaks Mapper

### 24.1 Symptom

Setelah deployment/migration:

- invalid column;
- null pointer;
- unknown enum code;
- resultMap gagal;
- insert gagal karena NOT NULL column baru;
- old pod gagal karena schema baru.

### 24.2 Root Cause

Migration tidak backward-compatible.

Bad:

```sql
ALTER TABLE cases RENAME COLUMN status_code TO lifecycle_status_code;
```

Old mapper masih membaca `status_code`.

### 24.3 Safer Expand-Migrate-Contract

1. Add new column nullable.
2. Write application to fill both old and new.
3. Backfill data.
4. Read from new with fallback if needed.
5. Deploy all app versions.
6. Remove old column later.

### 24.4 Mapper Compatibility Test

Di CI:

```text
old mapper + expanded schema
new mapper + expanded schema
new mapper + contracted schema only after old version gone
```

---

## 25. Troubleshooting Decision Tree

### 25.1 Startup Fails

```text
Startup fails
  -> XML parse error?
      -> validate mapper XML syntax/resource path
  -> Bean creation error?
      -> mapper scan / SqlSessionFactory / datasource wiring
  -> Type alias/type handler error?
      -> check package scanning and classpath
  -> Duplicate statement/resultMap?
      -> check copy-paste namespace/id
```

### 25.2 Request Fails Immediately

```text
Mapper method call fails
  -> Invalid bound statement?
      -> namespace/id/mapper-locations
  -> Parameter not found?
      -> @Param / parameter object / property name
  -> Getter not found?
      -> XML property doesn't match object
```

### 25.3 Database Error

```text
Database returns error
  -> Syntax error?
      -> inspect BoundSql final SQL
  -> Constraint violation?
      -> inspect data invariant and migration
  -> Permission/table missing?
      -> datasource/schema/user/profile
  -> Deadlock/timeout?
      -> lock order, transaction duration, indexes
```

### 25.4 Wrong Data

```text
Wrong result
  -> Result mapping issue?
      -> alias/resultMap/auto mapping
  -> Scope issue?
      -> tenant/agency/authorization predicate
  -> Cache issue?
      -> local/second-level cache
  -> Dynamic SQL branch issue?
      -> criteria matrix test
  -> Concurrency issue?
      -> version/state guard/idempotency
```

### 25.5 Slow Request

```text
Slow request
  -> One slow query?
      -> execution plan/index/selectivity
  -> Many queries?
      -> N+1/query count
  -> Large result?
      -> pagination/cursor/fetch size
  -> Lock wait?
      -> transaction/locking
  -> Pool exhausted?
      -> connection usage/slow SQL/cursor leak
```

---

## 26. Production Evidence Template

Saat incident, kumpulkan:

```text
Incident ID:
Time window:
Environment:
Endpoint/job:
Correlation ID:
User/tenant/agency scope:
Mapper statement id:
Final SQL shape:
Parameter summary:
Rows affected/result count:
Execution time:
DB error code:
Transaction duration:
Connection pool status:
Recent deployment/migration/config change:
Impact:
Temporary mitigation:
Root cause:
Permanent fix:
Regression test:
```

Parameter summary harus aman:

```text
caseId=12345
agencyId=CEA
status=PENDING_APPROVAL
keywordLength=12
fromDate=2026-01-01
toDateExclusive=2026-02-01
```

Jangan:

```text
fullName, NRIC, email body, access token, raw JSON payload, CLOB audit content
```

---

## 27. Mapper-Level Regression Test Setelah Incident

Setiap production bug harus meninggalkan regression test.

Contoh tenant leakage:

```java
@Test
void findByIdShouldNotReturnCaseFromAnotherAgency() {
    insertCase(caseId(1), agency("A"));

    Optional<CaseRow> result = mapper.findById(
        new DataScope("B"),
        caseId(1)
    );

    assertThat(result).isEmpty();
}
```

Contoh dynamic SQL empty list:

```java
@Test
void searchWithEmptyStatusesShouldReturnEmptyResultNotAllRows() {
    CaseSearchCriteria criteria = CaseSearchCriteria.builder()
        .agencyId("A")
        .statuses(List.of())
        .build();

    List<CaseRow> rows = mapper.search(criteria);

    assertThat(rows).isEmpty();
}
```

Contoh optimistic lock:

```java
@Test
void approveShouldFailWhenVersionIsStale() {
    int updated = mapper.approve(new ApproveCaseCommand(
        caseId,
        agencyId,
        expectedVersion - 1,
        actorId,
        now
    ));

    assertThat(updated).isZero();
}
```

---

## 28. Severity Model

Tidak semua MyBatis bug sama severity-nya.

| Severity | Example | Response |
|---|---|---|
| Critical | tenant data leakage, SQL injection, destructive update without scope | immediate mitigation, disable endpoint/job, audit access |
| High | lost update, double approval, incorrect financial/regulatory state | stop affected workflow, data reconciliation |
| Medium | slow query, N+1, timeout under load | tune/index/refactor, rate limit if needed |
| Low | mapper naming issue, duplicate fragment, minor parse fail in dev | normal fix |

Security/scope/correctness bug lebih penting daripada performance bug biasa.

---

## 29. Production Mitigation Patterns

### 29.1 Disable Dangerous Path

Jika endpoint melakukan destructive update salah:

```text
- disable feature flag
- block job scheduler
- set route maintenance
- revoke permission temporarily
```

### 29.2 Add Guardrail Query

Untuk update/delete, tambahkan emergency scope guard.

```sql
AND agency_id = #{agencyId}
```

Tapi jangan berhenti di patch cepat; tetap cari mengapa scope bisa hilang.

### 29.3 Add Index

Untuk slow query karena missing index, index bisa jadi mitigation cepat, tapi tetap review query shape.

### 29.4 Reduce Batch Size

Untuk lock timeout/batch memory:

```text
chunk 5000 -> 500
parallelism 8 -> 2
```

### 29.5 Turn Off Second-Level Cache

Jika stale/security cache issue:

```xml
<!-- remove or disable mapper cache -->
```

Atau set `useCache=false` pada query sensitive.

---

## 30. Java 8 sampai Java 25 Considerations

### Java 8

- gunakan POJO/immutable class manual;
- `Optional` boleh untuk return single optional, hati-hati serialization;
- parameter name reflection tidak selalu aman tanpa `-parameters`;
- gunakan `@Param` eksplisit.

### Java 11

- baseline runtime lebih stabil;
- masih banyak enterprise legacy MyBatis/Spring Boot 2.

### Java 17

- baseline modern Spring Boot 3;
- record bisa dipakai untuk DTO read model;
- stronger sealed/value-like modeling untuk command/scope.

### Java 21

- virtual thread bukan pengganti query optimization;
- virtual thread tetap menahan DB connection saat query blocking;
- observability transaction/connection duration tetap wajib.

### Java 25

- gunakan modern language features untuk contract clarity;
- jangan membuat mapper bergantung pada fitur source terlalu baru jika library/shared module masih Java 8.

---

## 31. Production Troubleshooting Checklist

```text
Statement identification
[ ] statement id diketahui
[ ] mapper method diketahui
[ ] XML/annotation source diketahui

SQL evidence
[ ] final SQL shape diketahui
[ ] dynamic branch dipahami
[ ] parameter summary aman tersedia

Database evidence
[ ] DB error code tersedia
[ ] execution time tersedia
[ ] rows affected/result count tersedia
[ ] execution plan tersedia untuk slow query

Transaction/session
[ ] @Transactional aktif?
[ ] propagation sesuai?
[ ] transaction duration diketahui?
[ ] cursor/lazy loading masih dalam session?

Scope/security
[ ] tenant/agency predicate ada?
[ ] authorization predicate ada?
[ ] cache key aman?
[ ] log tidak membocorkan data sensitive?

Performance/resource
[ ] query count per request diketahui
[ ] connection pool metrics diketahui
[ ] result size diketahui
[ ] fetch size/cursor usage jelas

Regression
[ ] root cause diterjemahkan menjadi test
[ ] test mencakup branch dynamic SQL terkait
[ ] test mencakup data boundary terkait
```

---

## 32. Ringkasan Mental Model

Production troubleshooting MyBatis harus dimulai dari statement id dan final SQL, lalu bergerak lapis demi lapis:

```text
mapper call
  -> statement resolution
  -> dynamic SQL rendering
  -> parameter binding
  -> database execution
  -> result mapping
  -> transaction/session/cache
  -> caller semantics
```

Bug paling berbahaya bukan selalu yang melempar exception. Yang lebih berbahaya adalah:

```text
query berhasil tetapi scope salah
update berhasil tetapi rows affected diabaikan
result mapping berhasil tetapi kolom salah
cache hit berhasil tetapi data stale/security-leaking
pagination berhasil tetapi tidak stabil
retry berhasil tetapi side effect duplicate
```

Top-tier engineer tidak hanya bertanya:

```text
"Kenapa error?"
```

Tetapi:

```text
"Invariant apa yang pecah, di layer mana pecah, bukti apa yang membedakan root cause, dan test apa yang mencegah regresi?"
```

---

## 33. Apa yang Dilanjutkan di Part 32

Part 31 membahas bagaimana membaca dan memperbaiki failure saat terjadi.

Part 32 akan membahas bagaimana **merefactor legacy MyBatis system** yang sudah penuh:

- mapper XML raksasa;
- copy-paste SQL;
- unsafe `${}`;
- `Map<String,Object>`;
- resultMap tidak jelas;
- query tanpa test;
- dynamic SQL sulit dipahami;
- generic CRUD mapper;
- tenant/scope predicate tidak konsisten;
- performance bug tersembunyi.

Tujuannya bukan rewrite total, tetapi refactoring bertahap yang aman untuk production.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 30 — Advanced Patterns: CQRS Read Models, Projection Mapper, Reporting Queries](./30-advanced-patterns-cqrs-read-models-projection-reporting-queries.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 32 — Refactoring Legacy MyBatis Systems](./32-refactoring-legacy-mybatis-systems.md)
