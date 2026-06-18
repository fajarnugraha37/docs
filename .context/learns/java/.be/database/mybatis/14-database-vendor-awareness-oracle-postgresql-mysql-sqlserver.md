# Part 14 — Database Vendor Awareness: Oracle, PostgreSQL, MySQL, SQL Server

**Series:** `learn-java-mybatis-sql-mapper-persistence-engineering`  
**File:** `14-database-vendor-awareness-oracle-postgresql-mysql-sqlserver.md`  
**Target Java:** Java 8 sampai Java 25  
**Prerequisite:** Part 0–13  
**Status:** Part 14 dari 34

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan tidak lagi melihat SQL sebagai sesuatu yang “portable by default”. MyBatis memberi kita kontrol penuh terhadap SQL, tetapi kontrol itu datang bersama tanggung jawab: setiap database punya dialek, optimizer, tipe data, locking behavior, pagination behavior, generated key behavior, dan error semantics yang berbeda.

Bagian ini membangun mental model untuk menjawab pertanyaan seperti:

- Apakah satu mapper XML bisa aman dipakai untuk Oracle, PostgreSQL, MySQL, dan SQL Server?
- Kapan SQL sebaiknya dibuat portable, dan kapan vendor-specific justru lebih benar?
- Bagaimana desain mapper agar perbedaan vendor eksplisit, bukan tersembunyi?
- Bagaimana menangani pagination, locking, upsert, generated key, sequence, CLOB/BLOB, boolean, date/time, dan identifier quoting?
- Bagaimana menggunakan `databaseIdProvider` tanpa membuat mapper sulit dirawat?
- Bagaimana menjaga application service tetap stabil ketika SQL berbeda per database?

Prinsip utama bagian ini:

> MyBatis tidak mengabstraksi database vendor. MyBatis memberi tempat yang rapi untuk mengelola vendor-specific SQL secara eksplisit.

---

## 1. Mental Model: SQL Mapper Berarti Vendor Awareness

Di JPA/Hibernate, sebagian perbedaan vendor disembunyikan oleh dialect. Walaupun tetap tidak sempurna, banyak SQL dihasilkan oleh ORM.

Di MyBatis, SQL hampir selalu ditulis oleh engineer. Artinya:

```text
Java method
  -> Mapper statement
  -> SQL text
  -> JDBC driver
  -> Database optimizer
  -> Vendor-specific behavior
```

MyBatis tidak tahu bahwa:

- `LIMIT/OFFSET` bukan syntax Oracle lama.
- `MERGE` Oracle tidak sama dengan SQL Server `MERGE` dari sisi caveat dan locking.
- PostgreSQL `INSERT ... ON CONFLICT` tidak ada di Oracle.
- MySQL `AUTO_INCREMENT` berbeda dari Oracle `SEQUENCE`.
- SQL Server memakai `TOP`, `OFFSET FETCH`, `OUTPUT inserted.id`, dan locking hints yang khas.
- Boolean native ada di PostgreSQL, tetapi Oracle SQL historis sering memakai `NUMBER(1)` atau `CHAR(1)`.
- Empty string di Oracle diperlakukan seperti `NULL`, sementara di PostgreSQL/MySQL tidak.

Karena itu, top-tier MyBatis engineer tidak hanya bertanya:

> “SQL ini jalan atau tidak?”

Tetapi:

> “SQL ini benar untuk vendor apa, versi apa, isolation apa, index apa, dan failure behavior apa?”

---

## 2. Portability vs Vendor-Specific Correctness

Ada dua pendekatan ekstrem yang sama-sama berbahaya.

### 2.1 Semua Harus Portable

Pendekatan ini ingin semua SQL sama untuk semua database.

Kelebihan:

- Mapper lebih sedikit.
- Testing lintas vendor terlihat mudah.
- Vendor migration tampak lebih murah.

Kelemahan:

- SQL menjadi lowest-common-denominator.
- Tidak memakai fitur database yang penting.
- Performance bisa buruk.
- Locking semantics bisa salah.
- Query kompleks menjadi aneh.
- Engineer bisa merasa portable padahal sebenarnya tidak.

Contoh masalah:

```sql
SELECT *
FROM cases
WHERE status = #{status}
ORDER BY created_at DESC
```

Query ini terlihat portable, tetapi belum tentu benar karena:

- `created_at` precision bisa berbeda.
- collation sort string bisa berbeda.
- pagination belum portable.
- enum/status representation bisa berbeda.
- quoted identifier behavior bisa berbeda.
- index strategy vendor-specific.

### 2.2 Semua Dibiarkan Vendor-Specific Tanpa Boundary

Pendekatan ini membiarkan setiap mapper bebas memakai syntax vendor apa pun.

Kelebihan:

- Cepat untuk delivery awal.
- SQL bisa optimal untuk vendor saat ini.

Kelemahan:

- Sulit migrasi database.
- Sulit review.
- Sulit test.
- Sulit tahu statement mana vendor-specific.
- Business service bisa bergantung ke detail vendor.

### 2.3 Pendekatan Profesional

Gunakan prinsip:

```text
Portable where semantics are truly portable.
Vendor-specific where correctness, performance, or operational behavior requires it.
```

Boundary yang sehat:

- Business service tidak tahu vendor.
- Mapper method contract stabil.
- SQL statement boleh berbeda per vendor.
- Vendor-specific SQL diberi nama dan struktur jelas.
- Testing dilakukan pada vendor target, bukan hanya H2.

Contoh:

```java
public interface CaseQueueMapper {
    List<CaseQueueItem> claimNextCases(CaseClaimCommand command);
}
```

Contract Java tetap sama.

Oracle SQL boleh:

```sql
SELECT id, case_no, status
FROM cases
WHERE status = 'READY'
ORDER BY priority DESC, created_at ASC
FETCH FIRST #{limit} ROWS ONLY
FOR UPDATE SKIP LOCKED
```

PostgreSQL SQL boleh:

```sql
SELECT id, case_no, status
FROM cases
WHERE status = 'READY'
ORDER BY priority DESC, created_at ASC
LIMIT #{limit}
FOR UPDATE SKIP LOCKED
```

Application service tidak perlu tahu detail syntax, tetapi mapper layer tahu.

---

## 3. MyBatis `databaseIdProvider`

MyBatis menyediakan mekanisme `databaseIdProvider` untuk memilih statement berdasarkan vendor database.

Secara mental:

```text
DataSource/JDBC metadata
  -> database product name
  -> databaseIdProvider mapping
  -> databaseId, misalnya oracle/postgresql/mysql/sqlserver
  -> MyBatis memilih statement yang sesuai databaseId
```

Konfigurasi contoh:

```xml
<databaseIdProvider type="DB_VENDOR">
  <property name="Oracle" value="oracle"/>
  <property name="PostgreSQL" value="postgresql"/>
  <property name="MySQL" value="mysql"/>
  <property name="Microsoft SQL Server" value="sqlserver"/>
</databaseIdProvider>
```

Contoh mapper:

```xml
<select id="findRecentCases" resultMap="CaseRowMap">
  SELECT id, case_no, status, created_at
  FROM cases
  ORDER BY created_at DESC
</select>

<select id="findRecentCases" databaseId="oracle" resultMap="CaseRowMap">
  SELECT id, case_no, status, created_at
  FROM cases
  ORDER BY created_at DESC
  FETCH FIRST 50 ROWS ONLY
</select>

<select id="findRecentCases" databaseId="postgresql" resultMap="CaseRowMap">
  SELECT id, case_no, status, created_at
  FROM cases
  ORDER BY created_at DESC
  LIMIT 50
</select>
```

Aturan penting:

- Jika ada statement dengan `databaseId` yang cocok, MyBatis memakai statement itu.
- Jika ada statement generic tanpa `databaseId`, itu bisa menjadi fallback.
- Jangan membuat fallback generic untuk operasi yang behavior-nya tidak benar secara lintas vendor.
- Jangan memakai `databaseIdProvider` untuk menyembunyikan perbedaan besar tanpa dokumentasi.

### 3.1 Kapan Menggunakan `databaseIdProvider`

Gunakan untuk:

- pagination syntax;
- sequence/generated key;
- upsert;
- locking;
- stored procedure call;
- date/time function;
- LOB-specific operation;
- optimizer hint;
- vendor-specific query performance;
- recursive query syntax jika berbeda;
- JSON operator jika berbeda.

Hindari untuk:

- statement sederhana yang memang portable;
- semua query secara membabi buta;
- mengganti business behavior per vendor;
- workaround yang tidak terdokumentasi.

### 3.2 Alternative: Mapper Per Vendor

Untuk perbedaan besar, kadang lebih jelas memakai mapper XML berbeda.

```text
mapper/
  oracle/CaseQueueMapper.xml
  postgresql/CaseQueueMapper.xml
  mysql/CaseQueueMapper.xml
  sqlserver/CaseQueueMapper.xml
```

Atau package Java berbeda:

```text
com.example.persistence.casequeue
  CaseQueueMapper.java

resources/mapper/oracle
  CaseQueueMapper.xml

resources/mapper/postgresql
  CaseQueueMapper.xml
```

Kelebihan:

- SQL vendor-specific lebih mudah dicari.
- File tidak penuh dengan banyak versi statement.
- Review per vendor lebih jelas.

Kekurangan:

- Risiko statement drift.
- Perlu test suite per vendor.
- Perlu governance agar contract mapper tetap sama.

---

## 4. Compatibility Matrix Vendor Concern

| Concern | Oracle | PostgreSQL | MySQL | SQL Server |
|---|---|---|---|---|
| Pagination modern | `OFFSET ... FETCH`, `FETCH FIRST` | `LIMIT/OFFSET`, keyset | `LIMIT/OFFSET`, keyset | `OFFSET ... FETCH`, `TOP` |
| Generated key | sequence, identity, `RETURNING` depending version/use case | identity/serial, `RETURNING` | `AUTO_INCREMENT`, JDBC generated keys | identity, `OUTPUT inserted.id`, JDBC generated keys |
| Upsert | `MERGE`, newer syntax depending version | `ON CONFLICT` | `ON DUPLICATE KEY UPDATE`, `REPLACE` caveat | `MERGE` caveat, update-then-insert alternatives |
| Boolean | often `NUMBER(1)`/`CHAR(1)` in SQL schemas | native `boolean` | `TINYINT(1)` commonly | `BIT` |
| Empty string | often treated as `NULL` | distinct from `NULL` | distinct from `NULL` | distinct from `NULL` |
| Lock skip | `FOR UPDATE SKIP LOCKED` | `FOR UPDATE SKIP LOCKED` | `FOR UPDATE SKIP LOCKED` in InnoDB modern versions | hints like `READPAST`, `UPDLOCK`, `ROWLOCK` |
| JSON | JSON support depends version; often CLOB/BLOB/native JSON in newer versions | `json`/`jsonb` operators | JSON type/functions | JSON functions over text storage style |
| Identifier quoting | `"Name"` | `"name"` | backtick or ANSI mode | `[Name]` or quoted identifier |
| Case folding | unquoted uppercase | unquoted lowercase | filesystem/collation dependent behavior for table names | usually case-insensitive depending collation |
| Date/time | `DATE`, `TIMESTAMP`, timezone-specific types | rich date/time/timestamptz | datetime/timestamp caveats | datetime2/datetimeoffset |
| LOB | CLOB/BLOB strong presence | text/bytea/large object | text/blob variants | varchar(max)/varbinary(max) |

Matrix ini bukan hafalan syntax, melainkan sinyal desain: setiap concern di atas harus punya keputusan eksplisit pada mapper layer.

---

## 5. Pagination Vendor Awareness

Pagination adalah contoh klasik SQL yang terlihat sederhana tetapi sering salah.

### 5.1 Offset Pagination

Semantik umum:

```text
Ambil halaman N dengan ukuran M.
Lewati (N-1)*M row.
Ambil M row berikutnya.
```

Masalah:

- Semakin jauh halaman, semakin mahal.
- Jika data berubah saat user berpindah halaman, row bisa hilang atau muncul dua kali.
- Sorting harus stabil.
- Count query bisa lebih mahal dari data query.

### 5.2 PostgreSQL / MySQL

```sql
SELECT id, case_no, status, created_at
FROM cases
WHERE status = #{status}
ORDER BY created_at DESC, id DESC
LIMIT #{limit}
OFFSET #{offset}
```

### 5.3 Oracle 12c+

```sql
SELECT id, case_no, status, created_at
FROM cases
WHERE status = #{status}
ORDER BY created_at DESC, id DESC
OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
```

### 5.4 SQL Server 2012+

```sql
SELECT id, case_no, status, created_at
FROM cases
WHERE status = #{status}
ORDER BY created_at DESC, id DESC
OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
```

SQL Server biasanya membutuhkan `ORDER BY` untuk `OFFSET FETCH`.

### 5.5 Legacy Oracle dengan `ROWNUM`

Untuk sistem lama:

```sql
SELECT *
FROM (
  SELECT inner_query.*, ROWNUM rn
  FROM (
    SELECT id, case_no, status, created_at
    FROM cases
    WHERE status = #{status}
    ORDER BY created_at DESC, id DESC
  ) inner_query
  WHERE ROWNUM &lt;= #{endRow}
)
WHERE rn &gt; #{startRow}
```

Kesalahan umum:

```sql
SELECT id, case_no, status, created_at
FROM cases
WHERE status = #{status}
  AND ROWNUM &lt;= #{limit}
ORDER BY created_at DESC
```

Ini salah karena `ROWNUM` diterapkan sebelum sorting final pada banyak pola eksekusi yang tidak sesuai ekspektasi pagination.

### 5.6 Keyset Pagination

Keyset pagination lebih stabil dan efisien untuk infinite scroll atau queue.

PostgreSQL/MySQL style:

```sql
SELECT id, case_no, status, created_at
FROM cases
WHERE status = #{status}
  AND (
    created_at &lt; #{lastCreatedAt}
    OR (created_at = #{lastCreatedAt} AND id &lt; #{lastId})
  )
ORDER BY created_at DESC, id DESC
LIMIT #{limit}
```

Oracle/SQL Server style berbeda hanya di limit syntax:

```sql
SELECT id, case_no, status, created_at
FROM cases
WHERE status = #{status}
  AND (
    created_at &lt; #{lastCreatedAt}
    OR (created_at = #{lastCreatedAt} AND id &lt; #{lastId})
  )
ORDER BY created_at DESC, id DESC
FETCH FIRST #{limit} ROWS ONLY
```

Invariant penting:

```text
ORDER BY columns harus sama dengan seek predicate columns.
Sorting harus deterministic.
Tie-breaker wajib, biasanya primary key.
```

---

## 6. Sorting dan Collation

Sorting bukan hanya `ORDER BY`.

Hal yang perlu dipikirkan:

- Case sensitivity.
- Accent sensitivity.
- Locale/collation.
- NULL ordering.
- Stable ordering.
- Index support.

Contoh perbedaan `NULL` ordering:

```sql
ORDER BY submitted_at DESC NULLS LAST
```

Oracle dan PostgreSQL mendukung `NULLS FIRST/LAST`. MySQL lama sering butuh ekspresi tambahan:

```sql
ORDER BY submitted_at IS NULL ASC, submitted_at DESC
```

SQL Server bisa memakai ekspresi:

```sql
ORDER BY CASE WHEN submitted_at IS NULL THEN 1 ELSE 0 END, submitted_at DESC
```

Mapper API sebaiknya tidak menerima raw order by:

```java
public enum CaseSortField {
    CREATED_AT,
    CASE_NO,
    STATUS,
    PRIORITY
}
```

Lalu mapper layer menerjemahkan ke vendor-safe SQL fragment.

---

## 7. Generated Key dan Identity Strategy

Generated key adalah area yang sering terlihat sama di Java tetapi berbeda di database.

### 7.1 MySQL Auto Increment

```xml
<insert id="insertCase"
        parameterType="CaseCreateCommand"
        useGeneratedKeys="true"
        keyProperty="id">
  INSERT INTO cases (case_no, status, created_at)
  VALUES (#{caseNo}, #{status}, #{createdAt})
</insert>
```

### 7.2 PostgreSQL Identity / Serial

Sering bisa memakai JDBC generated keys:

```xml
<insert id="insertCase"
        parameterType="CaseCreateCommand"
        useGeneratedKeys="true"
        keyProperty="id"
        keyColumn="id">
  INSERT INTO cases (case_no, status, created_at)
  VALUES (#{caseNo}, #{status}, #{createdAt})
</insert>
```

Atau memakai `RETURNING` dengan statement yang dipetakan sebagai select-like operation pada beberapa style.

```sql
INSERT INTO cases (case_no, status, created_at)
VALUES (#{caseNo}, #{status}, #{createdAt})
RETURNING id
```

### 7.3 Oracle Sequence dengan `selectKey`

```xml
<insert id="insertCase" parameterType="CaseCreateCommand">
  <selectKey keyProperty="id" resultType="long" order="BEFORE">
    SELECT cases_seq.NEXTVAL FROM dual
  </selectKey>

  INSERT INTO cases (id, case_no, status, created_at)
  VALUES (#{id}, #{caseNo}, #{status}, #{createdAt})
</insert>
```

### 7.4 SQL Server Identity

Bisa memakai generated keys atau `OUTPUT inserted.id`.

```sql
INSERT INTO cases (case_no, status, created_at)
OUTPUT inserted.id
VALUES (#{caseNo}, #{status}, #{createdAt})
```

### 7.5 Design Rule

Jangan biarkan service layer tahu caranya ID dibuat.

Buruk:

```java
if (vendor == ORACLE) {
    command.setId(sequenceService.nextVal());
}
caseMapper.insert(command);
```

Lebih baik:

```java
caseMapper.insert(command);
Long id = command.id(); // atau returned generated id pattern
```

Atau:

```java
Long id = caseMapper.insertReturningId(command);
```

Tetapi pastikan contract sama untuk semua vendor.

---

## 8. Upsert Vendor Awareness

Upsert berarti:

```text
Insert jika belum ada.
Update jika sudah ada.
```

Namun database berbeda punya syntax dan edge case berbeda.

### 8.1 PostgreSQL `ON CONFLICT`

```sql
INSERT INTO external_event_processed (
  event_id,
  source_system,
  processed_at
)
VALUES (
  #{eventId},
  #{sourceSystem},
  #{processedAt}
)
ON CONFLICT (event_id, source_system)
DO NOTHING
```

Untuk update:

```sql
INSERT INTO case_summary (
  case_id,
  open_task_count,
  updated_at
)
VALUES (
  #{caseId},
  #{openTaskCount},
  #{updatedAt}
)
ON CONFLICT (case_id)
DO UPDATE SET
  open_task_count = EXCLUDED.open_task_count,
  updated_at = EXCLUDED.updated_at
```

### 8.2 MySQL `ON DUPLICATE KEY UPDATE`

```sql
INSERT INTO case_summary (
  case_id,
  open_task_count,
  updated_at
)
VALUES (
  #{caseId},
  #{openTaskCount},
  #{updatedAt}
)
ON DUPLICATE KEY UPDATE
  open_task_count = VALUES(open_task_count),
  updated_at = VALUES(updated_at)
```

Catatan: syntax `VALUES(col)` memiliki perubahan/deprecation nuance di MySQL versi baru; untuk production, validasi pada versi MySQL target.

### 8.3 Oracle `MERGE`

```sql
MERGE INTO case_summary target
USING (
  SELECT
    #{caseId} AS case_id,
    #{openTaskCount} AS open_task_count,
    #{updatedAt} AS updated_at
  FROM dual
) source
ON (target.case_id = source.case_id)
WHEN MATCHED THEN
  UPDATE SET
    target.open_task_count = source.open_task_count,
    target.updated_at = source.updated_at
WHEN NOT MATCHED THEN
  INSERT (case_id, open_task_count, updated_at)
  VALUES (source.case_id, source.open_task_count, source.updated_at)
```

### 8.4 SQL Server `MERGE` Caveat

SQL Server punya `MERGE`, tetapi di banyak organisasi production, `MERGE` diperlakukan hati-hati karena sejarah bug/caveat dan concurrency complexity. Alternatif yang sering lebih mudah diaudit:

```sql
UPDATE case_summary
SET open_task_count = #{openTaskCount},
    updated_at = #{updatedAt}
WHERE case_id = #{caseId};

IF @@ROWCOUNT = 0
BEGIN
  INSERT INTO case_summary (case_id, open_task_count, updated_at)
  VALUES (#{caseId}, #{openTaskCount}, #{updatedAt});
END
```

Tetapi multi-statement seperti ini tidak selalu nyaman di MyBatis dan perlu transaction + race handling.

### 8.5 Upsert Correctness Questions

Sebelum membuat upsert mapper, jawab:

1. Conflict key apa?
2. Jika conflict, semua field diupdate atau hanya field tertentu?
3. Apakah update boleh overwrite value lebih baru?
4. Apakah butuh optimistic condition?
5. Apakah operation idempotent?
6. Apakah rows affected punya semantic sama lintas vendor?
7. Apakah trigger/audit column berubah?
8. Apakah concurrency race aman?

---

## 9. Locking Vendor Awareness

Locking adalah area yang sangat penting untuk case management, queue processing, enforcement lifecycle, assignment, dan state transition.

### 9.1 Pessimistic Lock Basic

Oracle/PostgreSQL/MySQL:

```sql
SELECT id, status, version
FROM cases
WHERE id = #{id}
FOR UPDATE
```

Makna umum:

- Ambil row.
- Lock row sampai transaction selesai.
- Transaction lain yang ingin update/lock bisa menunggu atau gagal tergantung option.

### 9.2 NOWAIT

Oracle/PostgreSQL/MySQL modern memiliki variasi:

```sql
SELECT id, status, version
FROM cases
WHERE id = #{id}
FOR UPDATE NOWAIT
```

Semantik:

```text
Jika row sedang dikunci, jangan tunggu; langsung error.
```

Gunakan untuk:

- UI action yang sebaiknya cepat gagal.
- workflow assignment yang tidak boleh menggantung.
- menghindari thread pool habis karena blocking lock.

### 9.3 SKIP LOCKED

```sql
SELECT id, case_no, priority
FROM cases
WHERE status = 'READY'
ORDER BY priority DESC, created_at ASC
FETCH FIRST #{limit} ROWS ONLY
FOR UPDATE SKIP LOCKED
```

Semantik:

```text
Coba lock row kandidat.
Jika row sudah dikunci transaksi lain, lewati.
```

Gunakan untuk:

- multi-consumer queue;
- batch worker;
- assignment worker;
- background processor.

Risiko:

- Tidak menjamin fairness sempurna.
- Row tertentu bisa terus dilewati jika selalu terkunci.
- Harus disertai retry/requeue strategy.
- Harus berada dalam transaction yang benar.

### 9.4 SQL Server Locking Hints

SQL Server menggunakan hints seperti:

```sql
SELECT TOP (#{limit}) id, case_no, priority
FROM cases WITH (UPDLOCK, READPAST, ROWLOCK)
WHERE status = 'READY'
ORDER BY priority DESC, created_at ASC
```

Approximation:

- `UPDLOCK`: ambil update lock.
- `READPAST`: skip row yang terkunci.
- `ROWLOCK`: prefer row-level lock.

Tapi behavior tetap tergantung isolation level, index, optimizer, dan lock escalation.

### 9.5 Locking Mapper Contract

Jangan pakai nama method generik:

```java
CaseRow findById(Long id);
```

Untuk lock, nama harus eksplisit:

```java
CaseRow lockByIdForUpdate(Long id);
List<CaseQueueItem> claimReadyCasesForUpdateSkipLocked(ClaimCommand command);
```

Kenapa?

Karena method lock punya konsekuensi:

- harus dipanggil dalam transaction;
- bisa block;
- bisa timeout;
- bisa deadlock;
- bisa mengubah throughput sistem.

---

## 10. Boolean Representation

Boolean tampak sederhana di Java, tetapi tidak seragam di database.

### 10.1 PostgreSQL

```sql
is_active BOOLEAN NOT NULL
```

Mapping Java:

```java
Boolean active;
```

### 10.2 MySQL

Sering:

```sql
is_active TINYINT(1) NOT NULL
```

Java bisa tetap `Boolean`, tetapi pastikan driver/type handler behavior jelas.

### 10.3 Oracle

Pada banyak schema enterprise:

```sql
is_active NUMBER(1) NOT NULL
-- atau
is_active CHAR(1) CHECK (is_active IN ('Y', 'N'))
```

Gunakan TypeHandler:

```java
public final class YesNoBooleanTypeHandler extends BaseTypeHandler<Boolean> {
    @Override
    public void setNonNullParameter(
            PreparedStatement ps,
            int i,
            Boolean parameter,
            JdbcType jdbcType
    ) throws SQLException {
        ps.setString(i, Boolean.TRUE.equals(parameter) ? "Y" : "N");
    }

    @Override
    public Boolean getNullableResult(ResultSet rs, String columnName) throws SQLException {
        String value = rs.getString(columnName);
        if (value == null) return null;
        return switch (value) {
            case "Y" -> true;
            case "N" -> false;
            default -> throw new SQLException("Unknown boolean code: " + value);
        };
    }

    @Override
    public Boolean getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        String value = rs.getString(columnIndex);
        if (value == null) return null;
        return switch (value) {
            case "Y" -> true;
            case "N" -> false;
            default -> throw new SQLException("Unknown boolean code: " + value);
        };
    }

    @Override
    public Boolean getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        String value = cs.getString(columnIndex);
        if (value == null) return null;
        return switch (value) {
            case "Y" -> true;
            case "N" -> false;
            default -> throw new SQLException("Unknown boolean code: " + value);
        };
    }
}
```

Untuk Java 8, ganti `switch` expression dengan `if/else`.

### 10.4 Design Rule

Jangan biarkan boolean vendor-specific bocor ke service:

Buruk:

```java
if ("Y".equals(row.getActiveFlag())) { ... }
```

Lebih baik:

```java
if (Boolean.TRUE.equals(row.active())) { ... }
```

---

## 11. Date/Time Vendor Awareness

Date/time adalah sumber bug yang mahal.

### 11.1 Java Types

Rekomendasi umum:

| Meaning | Java type |
|---|---|
| tanggal saja | `LocalDate` |
| waktu lokal tanpa timezone | `LocalDateTime` |
| instant global | `Instant` |
| waktu dengan offset | `OffsetDateTime` |
| legacy compatibility | `java.sql.Timestamp`, `java.util.Date` jika terpaksa |

### 11.2 Database Types

Oracle:

- `DATE` menyimpan date + time sampai detik.
- `TIMESTAMP` menyimpan fractional seconds.
- `TIMESTAMP WITH TIME ZONE` dan `TIMESTAMP WITH LOCAL TIME ZONE` punya semantics berbeda.

PostgreSQL:

- `timestamp without time zone`.
- `timestamp with time zone` (`timestamptz`) disimpan/ditampilkan dengan conversion semantics.

MySQL:

- `DATETIME` vs `TIMESTAMP` punya perbedaan timezone/conversion dan range.

SQL Server:

- `datetime`, `datetime2`, `datetimeoffset`.

### 11.3 MyBatis Design Rule

Jangan pakai database function sembarangan jika application time harus konsisten.

Contoh ambigu:

```sql
INSERT INTO audit_log (created_at)
VALUES (CURRENT_TIMESTAMP)
```

Pertanyaan:

- Timezone database apa?
- Apakah app server dan DB timezone sama?
- Apakah audit timestamp harus DB-time atau app-time?
- Bagaimana test deterministik?

Untuk audit yang butuh DB authoritative time, DB function bisa benar.

Untuk workflow business time yang harus testable, app-provided `Instant` bisa lebih baik.

```sql
INSERT INTO case_event (case_id, event_type, occurred_at)
VALUES (#{caseId}, #{eventType}, #{occurredAt})
```

### 11.4 Date Range Query

Anti-pattern:

```sql
WHERE TRUNC(created_at) = #{date}
```

Masalah:

- function pada column bisa mengganggu index usage;
- vendor-specific;
- timezone ambiguity.

Lebih baik:

```sql
WHERE created_at &gt;= #{startInclusive}
  AND created_at &lt; #{endExclusive}
```

Invariant:

```text
Use half-open interval: [start, end)
```

---

## 12. String, Empty String, Case Sensitivity

Oracle historically treats empty string as `NULL` in SQL.

Artinya:

```sql
INSERT INTO person (middle_name) VALUES ('')
```

Bisa tersimpan sebagai `NULL`.

Di PostgreSQL/MySQL/SQL Server, empty string biasanya berbeda dari `NULL`.

Konsekuensi untuk MyBatis:

```java
String remarks;
```

Perlu semantics jelas:

- `null` berarti absent?
- `""` berarti intentionally empty?
- whitespace dianggap empty?
- Oracle target database bisa membedakannya atau tidak?

Untuk enterprise system, lebih baik normalisasi di boundary:

```java
public static String normalizeOptionalText(String input) {
    if (input == null) return null;
    String trimmed = input.trim();
    return trimmed.isEmpty() ? null : trimmed;
}
```

Tetapi jangan lakukan normalisasi diam-diam pada field yang memang membutuhkan empty string sebagai value bermakna.

---

## 13. Identifier Quoting dan Case Folding

Jangan sembarangan quote identifier.

### 13.1 Unquoted Identifier

Oracle:

```sql
SELECT case_no FROM cases
```

Unquoted identifier biasanya difold ke uppercase secara internal.

PostgreSQL:

```sql
SELECT case_no FROM cases
```

Unquoted identifier difold ke lowercase.

### 13.2 Quoted Identifier

```sql
SELECT "CaseNo" FROM "Cases"
```

Quoted identifier menjadi case-sensitive dan sering membuat hidup lebih sulit.

### 13.3 Design Rule

Untuk schema enterprise yang bisa kamu kendalikan:

- gunakan lowercase snake_case untuk PostgreSQL/MySQL;
- gunakan uppercase/snake_case normal untuk Oracle jika mengikuti convention lama;
- hindari quoted mixed-case identifier;
- selalu gunakan alias eksplisit untuk result mapping.

Contoh aman:

```sql
SELECT
  c.case_id AS case_id,
  c.case_no AS case_no,
  c.created_at AS created_at
FROM cases c
```

---

## 14. LOB: CLOB, BLOB, TEXT, BYTEA, MAX Types

LOB handling vendor-specific dan berdampak ke memory.

### 14.1 Oracle

- `CLOB` untuk text besar.
- `BLOB` untuk binary besar.
- LOB bisa punya storage behavior khusus.
- Fetching LOB besar dalam listing query adalah anti-pattern.

### 14.2 PostgreSQL

- `text` sering cukup untuk text besar.
- `bytea` untuk binary.
- Large object API ada, tetapi tidak selalu diperlukan.

### 14.3 MySQL

- `TEXT`, `MEDIUMTEXT`, `LONGTEXT`.
- `BLOB`, `MEDIUMBLOB`, `LONGBLOB`.

### 14.4 SQL Server

- `varchar(max)`, `nvarchar(max)`, `varbinary(max)`.

### 14.5 Mapper Design Rule

Pisahkan listing query dari detail query.

Buruk:

```sql
SELECT id, case_no, status, full_payload, serialized_changes
FROM audit_trail
ORDER BY created_at DESC
```

Lebih baik:

```sql
SELECT id, case_no, status, created_at, actor_name
FROM audit_trail
ORDER BY created_at DESC
```

Detail:

```sql
SELECT id, full_payload, serialized_changes
FROM audit_trail
WHERE id = #{id}
```

Untuk large export:

- gunakan cursor/fetch size;
- hindari materialisasi semua row;
- pertimbangkan streaming di service;
- pastikan transaction/session lifecycle benar.

---

## 15. JSON Vendor Awareness

JSON support berbeda jauh.

PostgreSQL:

```sql
metadata JSONB
```

Query:

```sql
WHERE metadata -&gt;&gt; 'sourceSystem' = #{sourceSystem}
```

MySQL:

```sql
WHERE JSON_EXTRACT(metadata, '$.sourceSystem') = #{sourceSystem}
```

Oracle:

```sql
WHERE JSON_VALUE(metadata, '$.sourceSystem') = #{sourceSystem}
```

SQL Server:

```sql
WHERE JSON_VALUE(metadata, '$.sourceSystem') = #{sourceSystem}
```

Design question:

- Apakah JSON hanya payload audit yang jarang difilter?
- Apakah JSON menjadi queryable field?
- Apakah butuh index pada JSON path?
- Apakah field sebaiknya dipromosikan menjadi column normal?

Rule:

```text
Jika field sering dipakai untuk filter/join/sort/security, jangan sembunyikan hanya di JSON kecuali vendor-specific indexing strategy sudah jelas.
```

---

## 16. Case-Insensitive Search

Search nama atau case number terlihat sederhana, tetapi vendor-specific.

Portable-ish pattern:

```sql
WHERE LOWER(applicant_name) LIKE LOWER(#{keywordLike})
```

Masalah:

- function pada column bisa mengganggu index;
- collation berbeda;
- Unicode/case folding tidak selalu sama;
- accent sensitivity berbeda.

PostgreSQL punya `ILIKE`:

```sql
WHERE applicant_name ILIKE #{keywordLike}
```

Oracle bisa memakai function-based index:

```sql
WHERE UPPER(applicant_name) LIKE UPPER(#{keywordLike})
```

SQL Server bisa bergantung collation:

```sql
WHERE applicant_name COLLATE Latin1_General_CI_AI LIKE #{keywordLike}
```

Design rule:

- Untuk search serius, pertimbangkan dedicated search engine atau full-text search.
- Untuk search sederhana, buat vendor-specific query dan index strategy eksplisit.
- Jangan asumsikan `LOWER()` portable secara semantic untuk semua bahasa.

---

## 17. Numeric dan Decimal Precision

Java `BigDecimal` harus dipakai untuk money/amount.

Database:

```sql
amount DECIMAL(19, 4)
-- atau NUMBER(19,4)
-- atau NUMERIC(19,4)
```

Risiko:

- precision mismatch;
- scale rounding;
- driver conversion;
- `double` accidentally used;
- aggregate sum overflow;
- currency minor unit berbeda.

Mapper rule:

```java
BigDecimal amount;
```

Jangan:

```java
double amount;
```

Untuk count:

- `COUNT(*)` bisa melebihi `Integer` pada table besar.
- Gunakan `long`/`Long` untuk count.

```java
long countByCriteria(CaseSearchCriteria criteria);
```

---

## 18. Vendor Error Code dan Exception Semantics

Spring dapat menerjemahkan banyak database exception menjadi `DataAccessException`, tetapi vendor error detail tetap penting.

Contoh kategori:

- unique constraint violation;
- foreign key violation;
- deadlock;
- lock timeout;
- serialization failure;
- connection failure;
- syntax error;
- invalid column;
- permission denied.

Design rule:

- Jangan parsing error message bebas jika tidak perlu.
- Untuk business conflict, lebih baik desain SQL yang mengembalikan rows affected atau memakai explicit existence check dengan unique constraint sebagai final guard.
- Untuk retry, hanya retry error yang benar-benar transient.

Contoh optimistic update:

```xml
<update id="approveIfPending" parameterType="ApproveCommand">
  UPDATE cases
  SET status = 'APPROVED',
      approved_by = #{actorId},
      approved_at = #{approvedAt},
      version = version + 1
  WHERE id = #{caseId}
    AND status = 'PENDING_APPROVAL'
    AND version = #{expectedVersion}
</update>
```

Service:

```java
int updated = caseMapper.approveIfPending(command);
if (updated != 1) {
    throw new OptimisticStateTransitionException(command.caseId());
}
```

Ini lebih portable daripada mengandalkan error vendor untuk normal business conflict.

---

## 19. Optimizer Hints dan Plan Control

Vendor-specific hints kadang diperlukan.

Oracle:

```sql
SELECT /*+ INDEX(c IDX_CASE_STATUS_CREATED) */
  c.id, c.case_no, c.status
FROM cases c
WHERE c.status = #{status}
ORDER BY c.created_at DESC
```

SQL Server:

```sql
SELECT id, case_no, status
FROM cases WITH (INDEX(IX_CASE_STATUS_CREATED))
WHERE status = #{status}
```

MySQL:

```sql
SELECT id, case_no, status
FROM cases FORCE INDEX (idx_case_status_created)
WHERE status = #{status}
```

PostgreSQL tidak punya optimizer hint built-in seperti Oracle; biasanya tuning dilakukan lewat index/statistics/query rewrite/configuration atau extension tertentu.

Rule:

- Hint adalah production medicine, bukan default seasoning.
- Dokumentasikan kenapa hint dipakai.
- Tambahkan test/performance evidence.
- Review ulang setelah data distribution berubah.
- Jangan pakai hint untuk menutupi index/design buruk tanpa analisis.

---

## 20. `databaseIdProvider` Example: Pagination Statement

Mapper interface:

```java
public interface CaseListingMapper {
    List<CaseListRow> search(CaseSearchCriteria criteria);
}
```

XML:

```xml
<select id="search" databaseId="postgresql" resultMap="CaseListRowMap">
  SELECT
    c.id AS id,
    c.case_no AS case_no,
    c.status AS status,
    c.created_at AS created_at
  FROM cases c
  WHERE c.tenant_id = #{tenantId}
  <if test="status != null">
    AND c.status = #{status}
  </if>
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT #{limit}
  OFFSET #{offset}
</select>

<select id="search" databaseId="oracle" resultMap="CaseListRowMap">
  SELECT
    c.id AS id,
    c.case_no AS case_no,
    c.status AS status,
    c.created_at AS created_at
  FROM cases c
  WHERE c.tenant_id = #{tenantId}
  <if test="status != null">
    AND c.status = #{status}
  </if>
  ORDER BY c.created_at DESC, c.id DESC
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>

<select id="search" databaseId="sqlserver" resultMap="CaseListRowMap">
  SELECT
    c.id AS id,
    c.case_no AS case_no,
    c.status AS status,
    c.created_at AS created_at
  FROM cases c
  WHERE c.tenant_id = #{tenantId}
  <if test="status != null">
    AND c.status = #{status}
  </if>
  ORDER BY c.created_at DESC, c.id DESC
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>

<select id="search" databaseId="mysql" resultMap="CaseListRowMap">
  SELECT
    c.id AS id,
    c.case_no AS case_no,
    c.status AS status,
    c.created_at AS created_at
  FROM cases c
  WHERE c.tenant_id = #{tenantId}
  <if test="status != null">
    AND c.status = #{status}
  </if>
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT #{limit}
  OFFSET #{offset}
</select>
```

Notice:

- Java method sama.
- Result map sama.
- Parameter object sama.
- SQL berbeda hanya pada syntax pagination.
- Tenant condition tidak hilang di salah satu vendor.

Governance requirement:

```text
Jika satu statement punya 4 vendor variant, security predicate wajib identik di semua variant.
```

---

## 21. Dynamic SQL dan Vendor-Specific Fragments

Kamu bisa memakai `<sql>` fragment per vendor, tetapi hati-hati.

Contoh:

```xml
<sql id="Pagination_postgresql">
  LIMIT #{limit} OFFSET #{offset}
</sql>

<sql id="Pagination_oracle">
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</sql>
```

Namun MyBatis `<include>` tidak otomatis memilih fragment berdasarkan `databaseId` sefleksibel statement. Sering lebih jelas membuat statement variant lengkap untuk vendor-specific part penting.

Prinsip:

```text
Prefer duplication of small SQL structure over dangerous hidden abstraction.
```

Duplikasi kecil bisa lebih aman daripada fragment yang terlalu pintar.

---

## 22. Testing Vendor-Specific Mapper

H2 tidak cukup untuk validasi vendor-specific mapper.

### 22.1 Test Level

| Test | Purpose |
|---|---|
| XML parse test | mapper valid secara MyBatis |
| BoundSql test | generated SQL sesuai branch |
| Integration test with real DB | syntax, type, lock, generated key benar |
| Performance smoke test | index dan plan tidak jelas-jelas buruk |
| Concurrency test | locking/upsert/idempotency benar |

### 22.2 Testcontainers Strategy

Untuk PostgreSQL/MySQL/SQL Server, Testcontainers relatif umum.

Untuk Oracle, opsi lebih berat:

- Oracle Free/Express image;
- shared integration DB;
- pipeline khusus;
- nightly test;
- vendor certification environment.

### 22.3 Minimum Test untuk Vendor-Specific Statement

Untuk setiap statement vendor-specific:

1. XML loaded.
2. Statement resolved untuk `databaseId` yang tepat.
3. Query jalan di DB target.
4. Parameter null jalan jika didukung.
5. Result mapping benar.
6. Edge case syntax diuji.
7. Security predicate tidak hilang.
8. Pagination/locking/upsert behavior diuji jika relevan.

---

## 23. Java 8 sampai Java 25 Considerations

Vendor awareness lebih banyak terkait SQL/JDBC daripada syntax Java, tetapi Java version tetap memengaruhi desain.

### 23.1 Java 8

Gunakan:

- POJO DTO.
- `Optional` secara hati-hati untuk mapper return.
- `java.time` sudah tersedia.
- No record.
- No switch expression.

```java
public final class CaseListRow {
    private final Long id;
    private final String caseNo;
    private final String status;

    public CaseListRow(Long id, String caseNo, String status) {
        this.id = id;
        this.caseNo = caseNo;
        this.status = status;
    }

    public Long getId() { return id; }
    public String getCaseNo() { return caseNo; }
    public String getStatus() { return status; }
}
```

### 23.2 Java 17+

Bisa memakai record untuk projection:

```java
public record CaseListRow(
    Long id,
    String caseNo,
    String status,
    Instant createdAt
) {}
```

Tetapi pastikan constructor mapping dan parameter name behavior sesuai konfigurasi MyBatis.

### 23.3 Java 21/25

Virtual threads tidak mengubah SQL vendor behavior.

Jangan berpikir:

```text
Virtual threads solve slow SQL.
```

Yang benar:

```text
Virtual threads may reduce thread-blocking cost, but database connection, lock wait, query plan, and transaction duration still define throughput.
```

Jika memakai virtual threads dengan MyBatis/JDBC:

- connection pool tetap bottleneck;
- long lock wait tetap berbahaya;
- fetch large result tetap memakan memory/network;
- transaction duration tetap harus pendek;
- driver behavior perlu divalidasi.

---

## 24. Multi-Database Support Architecture

### 24.1 Single Runtime, One Active Vendor

Aplikasi deploy ke satu vendor per environment.

```text
DEV: PostgreSQL
UAT: PostgreSQL
PROD: PostgreSQL
```

Vendor awareness tetap penting, tetapi SQL bisa fokus ke satu vendor.

### 24.2 Same Product, Different Customer Vendors

Satu codebase harus support banyak vendor.

```text
Customer A: Oracle
Customer B: PostgreSQL
Customer C: SQL Server
```

Butuh:

- `databaseIdProvider`;
- vendor-specific mapper test;
- migration script per vendor;
- feature support matrix;
- strict SQL governance.

### 24.3 Runtime Multi-Database

Satu aplikasi bicara ke banyak database vendor sekaligus.

```text
Core DB: Oracle
Reporting DB: PostgreSQL
Legacy DB: SQL Server
```

Butuh:

- multiple `DataSource`;
- multiple `SqlSessionFactory`;
- mapper scan per datasource;
- transaction manager per datasource;
- no accidental cross-wiring.

Package structure:

```text
com.example.persistence.core.oracle
com.example.persistence.reporting.postgresql
com.example.persistence.legacy.sqlserver
```

Atau berdasarkan datasource:

```text
mapper/core/...
mapper/reporting/...
mapper/legacy/...
```

---

## 25. Migration Between Vendors

Jika suatu sistem berpindah vendor, misalnya Oracle ke PostgreSQL, masalahnya bukan hanya syntax.

Checklist migrasi:

- DDL type mapping.
- Sequence/identity behavior.
- Empty string vs null.
- Date/time semantics.
- Timezone behavior.
- Boolean representation.
- Pagination syntax.
- Locking syntax.
- Upsert syntax.
- Stored procedures.
- Functions.
- Triggers.
- Views/materialized views.
- CLOB/BLOB handling.
- Case-sensitive identifiers.
- Constraint names.
- Error codes.
- Index strategy.
- Execution plans.
- Transaction isolation differences.
- Collation/search behavior.

Migration strategy:

```text
1. Freeze mapper contract.
2. Inventory vendor-specific SQL.
3. Classify each statement: portable / rewrite / redesign.
4. Create target vendor mapper variants.
5. Build integration tests on target vendor.
6. Validate data type conversion.
7. Validate concurrency behavior.
8. Validate performance plans.
9. Run dual-read or shadow validation where possible.
10. Cut over with rollback plan.
```

---

## 26. Anti-Patterns

### 26.1 Fake Portable SQL

```sql
SELECT * FROM cases LIMIT #{limit}
```

Works in some databases, not all.

### 26.2 Vendor Branch in Service Layer

```java
if (vendor.equals("oracle")) {
    mapper.searchOracle(criteria);
} else {
    mapper.searchPostgres(criteria);
}
```

Service should express business intent, not SQL dialect.

### 26.3 Generic Mapper with Raw SQL

```java
List<Map<String, Object>> query(String sql);
```

This destroys:

- security;
- observability;
- mapping contract;
- reviewability;
- testability;
- vendor governance.

### 26.4 H2 as Proof of Vendor Correctness

If production is Oracle/PostgreSQL/MySQL/SQL Server, H2 test cannot prove:

- locking behavior;
- generated key behavior;
- JSON operator;
- LOB behavior;
- execution plan;
- collation;
- timezone;
- procedure behavior.

### 26.5 Unreviewed `${}` for Vendor Syntax

```xml
ORDER BY ${sortColumn}
```

Vendor-specific sorting should still be whitelist-controlled.

---

## 27. Production Review Checklist

Sebelum menerima mapper yang vendor-specific, tanyakan:

### 27.1 Contract

- Apakah Java mapper method tetap vendor-neutral?
- Apakah return type sama untuk semua vendor?
- Apakah rows affected semantics sama atau didokumentasikan?
- Apakah generated key behavior sama?

### 27.2 SQL Correctness

- Apakah syntax valid pada versi database target?
- Apakah pagination stabil?
- Apakah ordering deterministic?
- Apakah locking semantics sesuai use case?
- Apakah upsert aman terhadap race condition?

### 27.3 Security

- Apakah tenant/agency/security predicate ada di semua variant?
- Apakah dynamic identifier whitelist?
- Apakah tidak ada raw `${}` dari input user?
- Apakah data masking/visibility sama lintas vendor?

### 27.4 Performance

- Apakah index mendukung predicate dan order by?
- Apakah function pada column mengganggu index?
- Apakah count query mahal?
- Apakah query large result memakai streaming/fetch strategy?
- Apakah hint punya alasan?

### 27.5 Operations

- Apakah slow query bisa dilacak ke statement id?
- Apakah error vendor-specific ditangani?
- Apakah lock timeout/deadlock punya retry boundary?
- Apakah integration test berjalan pada vendor target?

### 27.6 Maintainability

- Apakah vendor-specific SQL mudah ditemukan?
- Apakah statement variant tidak drift?
- Apakah duplicated SQL masih terkendali?
- Apakah komentar menjelaskan vendor-specific decision?

---

## 28. Mini Case Study: Claim Queue Across Vendors

### 28.1 Business Requirement

Worker mengambil maksimal N case yang statusnya `READY`, mengunci row agar worker lain tidak mengambil case sama, lalu mengubah status menjadi `PROCESSING`.

Requirements:

- Multi-worker safe.
- Tidak double claim.
- Tidak menunggu lock terlalu lama.
- Fair enough by priority and created time.
- Tenant scoped.

Mapper API:

```java
public interface CaseQueueMapper {
    List<CaseQueueItem> lockReadyCasesForClaim(CaseClaimCommand command);
    int markClaimed(CaseMarkClaimedCommand command);
}
```

### 28.2 PostgreSQL

```xml
<select id="lockReadyCasesForClaim" databaseId="postgresql" resultMap="CaseQueueItemMap">
  SELECT
    c.id AS id,
    c.case_no AS case_no,
    c.priority AS priority,
    c.created_at AS created_at
  FROM cases c
  WHERE c.tenant_id = #{tenantId}
    AND c.status = 'READY'
  ORDER BY c.priority DESC, c.created_at ASC, c.id ASC
  LIMIT #{limit}
  FOR UPDATE SKIP LOCKED
</select>
```

### 28.3 Oracle

```xml
<select id="lockReadyCasesForClaim" databaseId="oracle" resultMap="CaseQueueItemMap">
  SELECT
    c.id AS id,
    c.case_no AS case_no,
    c.priority AS priority,
    c.created_at AS created_at
  FROM cases c
  WHERE c.tenant_id = #{tenantId}
    AND c.status = 'READY'
  ORDER BY c.priority DESC, c.created_at ASC, c.id ASC
  FETCH FIRST #{limit} ROWS ONLY
  FOR UPDATE SKIP LOCKED
</select>
```

### 28.4 MySQL

```xml
<select id="lockReadyCasesForClaim" databaseId="mysql" resultMap="CaseQueueItemMap">
  SELECT
    c.id AS id,
    c.case_no AS case_no,
    c.priority AS priority,
    c.created_at AS created_at
  FROM cases c
  WHERE c.tenant_id = #{tenantId}
    AND c.status = 'READY'
  ORDER BY c.priority DESC, c.created_at ASC, c.id ASC
  LIMIT #{limit}
  FOR UPDATE SKIP LOCKED
</select>
```

### 28.5 SQL Server

```xml
<select id="lockReadyCasesForClaim" databaseId="sqlserver" resultMap="CaseQueueItemMap">
  SELECT TOP (#{limit})
    c.id AS id,
    c.case_no AS case_no,
    c.priority AS priority,
    c.created_at AS created_at
  FROM cases c WITH (UPDLOCK, READPAST, ROWLOCK)
  WHERE c.tenant_id = #{tenantId}
    AND c.status = 'READY'
  ORDER BY c.priority DESC, c.created_at ASC, c.id ASC
</select>
```

### 28.6 Service Boundary

```java
@Transactional
public List<CaseQueueItem> claim(CaseClaimCommand command) {
    List<CaseQueueItem> locked = caseQueueMapper.lockReadyCasesForClaim(command);

    if (locked.isEmpty()) {
        return List.of();
    }

    int updated = caseQueueMapper.markClaimed(
        new CaseMarkClaimedCommand(
            command.tenantId(),
            locked.stream().map(CaseQueueItem::id).toList(),
            command.workerId(),
            command.now()
        )
    );

    if (updated != locked.size()) {
        throw new IllegalStateException("Claim update count mismatch");
    }

    return locked;
}
```

Untuk Java 8, ganti `toList()` dengan `collect(Collectors.toList())`.

Key insight:

```text
Vendor SQL berbeda, tetapi service invariant sama:
locked rows count == updated rows count.
```

---

## 29. Decision Framework

Saat menulis MyBatis statement, pakai pertanyaan ini:

```text
1. Apakah statement ini benar-benar portable?
   Jika ya, pakai SQL generic.

2. Apakah syntax vendor berbeda tetapi semantic sama?
   Gunakan databaseId variant.

3. Apakah semantic vendor berbeda?
   Buat explicit design decision dan test vendor-specific behavior.

4. Apakah business behavior mulai berbeda per vendor?
   Stop. Naikkan ke architecture discussion.

5. Apakah performance butuh vendor-specific feature?
   Gunakan feature itu, tetapi dokumentasikan evidence dan fallback.
```

---

## 30. Ringkasan

MyBatis membuat database vendor awareness menjadi bagian eksplisit dari persistence engineering.

Hal yang harus diingat:

- SQL tidak otomatis portable.
- MyBatis tidak menyembunyikan dialect database.
- `databaseIdProvider` berguna, tetapi bukan alasan untuk membuat mapper kacau.
- Pagination, generated key, upsert, locking, boolean, date/time, LOB, JSON, collation, dan identifier behavior adalah area utama vendor-specific.
- Service layer harus tetap vendor-neutral.
- Mapper layer boleh vendor-specific, tetapi harus terstruktur dan teruji.
- H2 bukan bukti correctness untuk production vendor.
- Top-tier engineer tidak takut vendor-specific SQL; mereka membuat boundary-nya jelas, testable, dan operable.

Mental model akhir:

```text
Application service expresses business intent.
Mapper interface expresses persistence contract.
Mapper XML expresses vendor-aware SQL.
Database executes vendor-specific semantics.
Tests prove the contract on the real vendor.
```

---

## 31. Latihan

### Latihan 1 — Pagination Variant

Buat mapper method:

```java
List<CaseListRow> searchCases(CaseSearchCriteria criteria);
```

Buat SQL variant untuk:

- Oracle;
- PostgreSQL;
- MySQL;
- SQL Server.

Syarat:

- tenant scoped;
- optional status;
- stable ordering by `created_at DESC, id DESC`;
- limit/offset;
- no `${}`.

### Latihan 2 — Generated Key Strategy

Desain insert mapper untuk table:

```sql
cases(id, case_no, status, created_at)
```

Buat strategi untuk:

- Oracle sequence;
- PostgreSQL identity;
- MySQL auto increment;
- SQL Server identity.

Tuliskan contract Java yang sama untuk semua vendor.

### Latihan 3 — Queue Claim

Implementasikan claim ready cases dengan semantics:

- multi-worker;
- skip locked;
- max N rows;
- tenant scoped;
- update status menjadi `PROCESSING` dalam transaction yang sama.

Bandingkan SQL Oracle/PostgreSQL/MySQL/SQL Server.

### Latihan 4 — Vendor Migration Inventory

Ambil 10 mapper statement dari project nyata. Klasifikasikan:

```text
portable
pagination-specific
lock-specific
upsert-specific
function-specific
type-specific
LOB-specific
JSON-specific
unsafe/unknown
```

Lalu tuliskan refactoring plan.

---

## 32. Referensi

- MyBatis 3 — Configuration: `databaseIdProvider`, settings, type handlers.
- MyBatis 3 — Mapper XML: statement attributes, `databaseId`, generated keys, result mapping.
- MyBatis 3 — Java API: session and statement execution model.
- MyBatis Dynamic SQL — Insert/update/select rendering and generated value notes.
- Oracle SQL documentation — `SELECT`, `FOR UPDATE`, `SKIP LOCKED`, row limiting clauses.
- PostgreSQL documentation — `INSERT ... ON CONFLICT`, locking clauses, date/time behavior.
- MySQL documentation — InnoDB locking reads, `NOWAIT`, `SKIP LOCKED`, `ON DUPLICATE KEY UPDATE`.
- SQL Server documentation — `OFFSET FETCH`, `TOP`, locking hints, identity/output behavior.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 13 — TypeHandler Engineering: Domain Types, Enum, JSON, Array, Vendor Types](./13-typehandler-engineering-domain-types-enum-json-array-vendor-types.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 15 — Pagination, Sorting, Search Query, and Count Strategy](./15-pagination-sorting-search-query-and-count-strategy.md)
