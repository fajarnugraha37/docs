# 09 — MyBatis Dynamic SQL Library: Type-Safe Query Generation

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> Bagian: 09 dari 33  
> Topik: MyBatis Dynamic SQL sebagai SQL DSL/type-safe query generation untuk Java 8 sampai Java 25

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita membahas **Dynamic SQL XML**: `if`, `choose`, `where`, `set`, `trim`, `foreach`, `bind`, `sql`, dan `include`. Itu adalah cara MyBatis klasik untuk membuat SQL dinamis di XML.

Bagian ini membahas jalur lain: **MyBatis Dynamic SQL library**.

Library ini bukan pengganti total MyBatis XML. Ia adalah **SQL DSL** di Java/Kotlin yang menghasilkan SQL dan parameter object untuk dieksekusi oleh MyBatis atau Spring JDBC. Secara mental, ia berada di antara:

```text
Plain SQL string
  -> fleksibel, tetapi rawan stringly typed

MyBatis XML Dynamic SQL
  -> eksplisit, familiar, tetapi kompleks bila branching banyak

MyBatis Dynamic SQL DSL
  -> type-safer, composable, refactorable, tetapi menambah layer abstraksi

jOOQ-like DSL
  -> lebih kaya sebagai SQL DSL, tetapi berbeda filosofi dan dependency model
```

Target akhir bagian ini bukan sekadar tahu syntax. Targetnya adalah memahami:

1. kapan MyBatis Dynamic SQL memberi nilai nyata;
2. kapan XML tetap lebih tepat;
3. bagaimana DSL ini menghasilkan SQL dan binding parameter;
4. bagaimana membuat table/column metadata yang maintainable;
5. bagaimana mendesain query object, criteria builder, dan reusable predicates;
6. bagaimana menjaga SQL tetap dapat dibaca, diuji, dan aman;
7. bagaimana menghindari codebase berubah dari “XML spaghetti” menjadi “Java DSL spaghetti”.

---

## 1. Posisi MyBatis Dynamic SQL dalam Ekosistem MyBatis

MyBatis core melakukan beberapa hal utama:

1. mengeksekusi SQL melalui JDBC;
2. mengikat parameter ke prepared statement;
3. memetakan `ResultSet` ke Java object;
4. mendukung SQL dinamis melalui XML atau mekanisme templating lain.

MyBatis Dynamic SQL memanfaatkan tiga hal pertama, lalu mengganti sebagian fungsi templating XML dengan **DSL Java/Kotlin**.

Artinya, alur mentalnya seperti ini:

```text
Java DSL expression
  -> render menjadi SQL string + parameter map
  -> dikirim ke mapper method
  -> MyBatis bind parameter
  -> JDBC execute
  -> MyBatis result mapping
  -> Java result object
```

Jangan salah memahami: MyBatis Dynamic SQL tidak membuat database menjadi object-oriented. Ia tetap SQL-first. Bedanya, SQL dibentuk lewat API Java, bukan lewat XML tag.

---

## 2. Core Mental Model

### 2.1 XML Dynamic SQL

Di XML, SQL adalah template utama.

```xml
<select id="searchCases" resultMap="CaseListingRowMap">
  SELECT
    c.case_id,
    c.case_no,
    c.status
  FROM case_file c
  <where>
    <if test="status != null">
      c.status = #{status}
    </if>
    <if test="agencyId != null">
      AND c.agency_id = #{agencyId}
    </if>
  </where>
</select>
```

Mental model:

```text
SQL template + conditional XML nodes -> final SQL
```

### 2.2 MyBatis Dynamic SQL

Di MyBatis Dynamic SQL, Java/Kotlin expression adalah pembentuk SQL.

```java
SelectStatementProvider selectStatement = select(caseId, caseNo, status)
    .from(caseFile)
    .where(status, isEqualToWhenPresent(criteria.status()))
    .and(agencyId, isEqualTo(criteria.agencyId()))
    .build()
    .render(RenderingStrategies.MYBATIS3);
```

Mental model:

```text
Java DSL object graph -> rendered SQL + parameter map
```

Yang penting: hasil akhirnya tetap SQL.

---

## 3. Apa yang Sebenarnya “Type-Safe”?

Istilah “type-safe” sering disalahpahami.

MyBatis Dynamic SQL membantu type-safety pada level:

1. referensi kolom tidak ditulis sebagai string bebas di banyak tempat;
2. operasi terhadap kolom memakai object `SqlColumn<T>`;
3. tipe Java kolom bisa membantu memilih predicate/value yang lebih masuk akal;
4. refactor nama field Java lebih mudah dibanding search string XML;
5. reusable predicate bisa dikomposisi sebagai fungsi/objek.

Namun ia tidak otomatis menjamin:

1. query pasti optimal;
2. index pasti dipakai;
3. join pasti benar secara bisnis;
4. result mapping pasti benar;
5. transaction pasti benar;
6. authorization scope pasti aman;
7. generated SQL pasti mudah dibaca;
8. semua vendor SQL feature bisa diekspresikan.

Jadi, type-safe di sini berarti **lebih aman dari kesalahan string-construction**, bukan “database correctness fully guaranteed”.

---

## 4. Kapan Menggunakan MyBatis Dynamic SQL

Gunakan MyBatis Dynamic SQL ketika:

### 4.1 Query Banyak Kombinasi Predicate

Contoh:

- search screen dengan 15 filter opsional;
- filter berbeda tergantung role;
- query builder untuk advanced search;
- reusable predicate lintas query;
- conditional joins atau conditional where yang masih wajar.

XML bisa menangani ini, tetapi setelah kombinasi banyak, XML dapat berubah menjadi sulit dibaca.

### 4.2 Query Dibangun dari Object Model

Contoh:

```text
CaseSearchCriteria
  status
  agencyId
  officerId
  createdFrom
  createdTo
  keyword
  overdueOnly
  assignedToMe
```

Dynamic SQL library cocok jika criteria object diterjemahkan secara sistematis menjadi predicate.

### 4.3 Butuh Reusable Predicate

Contoh:

```java
public static WhereApplier tenantScope(Long agencyId) {
    return where -> where.and(agencyIdColumn, isEqualTo(agencyId));
}
```

Atau:

```java
public static BasicColumn[] listingColumns() {
    return new BasicColumn[] { caseId, caseNo, status, createdAt };
}
```

### 4.4 Ingin Refactorability Lebih Baik

Kalau nama kolom/table metadata berubah di satu tempat, compiler dapat membantu menemukan efeknya.

XML juga bisa di-refactor, tetapi lebih bergantung pada tooling, naming discipline, dan test.

### 4.5 Tim Nyaman Membaca DSL Java

Ini bukan detail kecil. Jika tim lebih nyaman membaca SQL literal, DSL bisa menurunkan maintainability.

MyBatis Dynamic SQL bagus jika tim memiliki discipline untuk tetap memikirkan SQL sebagai SQL, bukan sebagai “object chaining magic”.

---

## 5. Kapan XML Lebih Tepat

Gunakan XML ketika:

### 5.1 SQL Sangat Vendor-Specific

Contoh:

- Oracle hierarchical query;
- complex window function;
- `MODEL` clause;
- query hint kompleks;
- vendor-specific lock mode;
- stored procedure call;
- complex CTE recursion.

DSL bisa mendukung banyak common SQL, tetapi tidak semua kemungkinan SQL.

### 5.2 Query Perlu Dibaca DBA atau Reviewer Non-Java

SQL literal di XML lebih mudah direview oleh DBA, performance engineer, atau engineer lintas bahasa.

### 5.3 Query Sangat Stabil dan Tidak Banyak Branch

Untuk query yang sederhana dan stabil:

```sql
SELECT case_id, case_no, status
FROM case_file
WHERE case_id = #{caseId}
```

XML lebih langsung dan lebih mudah dibaca.

### 5.4 Query Sangat Panjang Tapi Struktur Tetap

SQL report panjang dengan banyak join, CTE, aggregation, dan hint bisa lebih baik di XML/file SQL daripada DSL chain.

### 5.5 Tim Sudah Punya XML Governance yang Baik

Jika XML mapper sudah tertata, diuji, dan direview dengan baik, migrasi ke DSL tidak otomatis memberi value.

---

## 6. Kapan Plain JDBC atau Spring JDBC Lebih Tepat

MyBatis Dynamic SQL juga bisa merender statement untuk Spring JDBC template. Tetapi pertanyaannya: apakah butuh MyBatis?

Gunakan Spring JDBC/plain JDBC ketika:

1. mapping sangat sederhana;
2. tidak butuh mapper XML/interface;
3. ingin kontrol penuh pada streaming/batch low-level;
4. query generator dipakai oleh komponen non-MyBatis;
5. library internal ingin menghasilkan SQL untuk beberapa executor.

Tetapi jika aplikasi sudah menggunakan MyBatis untuk mapping dan transaction integration, MyBatis Dynamic SQL bisa menjadi extension natural.

---

## 7. Komponen Utama MyBatis Dynamic SQL

Secara konseptual, komponen yang harus dipahami:

```text
SqlTable
  representasi table/view

SqlColumn<T>
  representasi kolom beserta tipe Java/JDBC metadata

Condition
  representasi predicate seperti =, <, >, like, in, between, is null

Statement Builder
  select, insert, update, delete builder

Statement Provider
  object hasil build yang berisi SQL + parameter map

Rendering Strategy
  aturan bagaimana placeholder parameter dirender
```

---

## 8. Table dan Column Metadata

### 8.1 Contoh Table Metadata

Misal tabel:

```sql
CREATE TABLE case_file (
  case_id       BIGINT       NOT NULL,
  case_no       VARCHAR(50)  NOT NULL,
  agency_id     BIGINT       NOT NULL,
  status        VARCHAR(30)  NOT NULL,
  priority      VARCHAR(20)  NOT NULL,
  assigned_to   BIGINT       NULL,
  created_at    TIMESTAMP    NOT NULL,
  updated_at    TIMESTAMP    NOT NULL,
  version       BIGINT       NOT NULL,
  deleted       CHAR(1)      NOT NULL,
  PRIMARY KEY (case_id)
);
```

Metadata Java:

```java
import java.sql.JDBCType;
import java.time.LocalDateTime;
import org.mybatis.dynamic.sql.SqlColumn;
import org.mybatis.dynamic.sql.SqlTable;

public final class CaseFileDynamicSqlSupport {
    public static final CaseFile caseFile = new CaseFile();

    public static final SqlColumn<Long> caseId = caseFile.caseId;
    public static final SqlColumn<String> caseNo = caseFile.caseNo;
    public static final SqlColumn<Long> agencyId = caseFile.agencyId;
    public static final SqlColumn<String> status = caseFile.status;
    public static final SqlColumn<String> priority = caseFile.priority;
    public static final SqlColumn<Long> assignedTo = caseFile.assignedTo;
    public static final SqlColumn<LocalDateTime> createdAt = caseFile.createdAt;
    public static final SqlColumn<LocalDateTime> updatedAt = caseFile.updatedAt;
    public static final SqlColumn<Long> version = caseFile.version;
    public static final SqlColumn<String> deleted = caseFile.deleted;

    public static final class CaseFile extends SqlTable {
        public final SqlColumn<Long> caseId = column("case_id", JDBCType.BIGINT);
        public final SqlColumn<String> caseNo = column("case_no", JDBCType.VARCHAR);
        public final SqlColumn<Long> agencyId = column("agency_id", JDBCType.BIGINT);
        public final SqlColumn<String> status = column("status", JDBCType.VARCHAR);
        public final SqlColumn<String> priority = column("priority", JDBCType.VARCHAR);
        public final SqlColumn<Long> assignedTo = column("assigned_to", JDBCType.BIGINT);
        public final SqlColumn<LocalDateTime> createdAt = column("created_at", JDBCType.TIMESTAMP);
        public final SqlColumn<LocalDateTime> updatedAt = column("updated_at", JDBCType.TIMESTAMP);
        public final SqlColumn<Long> version = column("version", JDBCType.BIGINT);
        public final SqlColumn<String> deleted = column("deleted", JDBCType.CHAR);

        public CaseFile() {
            super("case_file");
        }
    }

    private CaseFileDynamicSqlSupport() {
    }
}
```

### 8.2 Kenapa Metadata Penting

Metadata table/column adalah pusat reuse. Tanpa discipline, ia bisa menjadi tempat kekacauan baru.

Prinsip:

1. satu table satu support class;
2. jangan campur metadata dengan query logic;
3. nama Java mengikuti domain readability;
4. nama SQL tetap eksplisit;
5. semua kolom yang dipakai query harus ada di metadata;
6. jangan expose metadata yang belum jelas ownership-nya;
7. generated metadata boleh, tetapi hasilnya harus direview.

---

## 9. Select Statement Dasar

### 9.1 Mapper Interface

```java
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.SelectProvider;
import org.mybatis.dynamic.sql.select.render.SelectStatementProvider;
import org.mybatis.dynamic.sql.util.SqlProviderAdapter;

@Mapper
public interface CaseFileDynamicMapper {

    @SelectProvider(type = SqlProviderAdapter.class, method = "select")
    List<CaseListingRow> selectMany(SelectStatementProvider selectStatement);
}
```

### 9.2 Query Builder

```java
import static org.mybatis.dynamic.sql.SqlBuilder.*;
import static com.acme.casefile.CaseFileDynamicSqlSupport.*;

import java.util.List;
import org.mybatis.dynamic.sql.render.RenderingStrategies;
import org.mybatis.dynamic.sql.select.render.SelectStatementProvider;

public final class CaseFileQueries {

    public SelectStatementProvider listOpenCases(long agencyIdValue) {
        return select(caseId, caseNo, status, priority, assignedTo, createdAt)
            .from(caseFile)
            .where(agencyId, isEqualTo(agencyIdValue))
            .and(status, isIn("NEW", "IN_REVIEW", "PENDING_INFO"))
            .and(deleted, isEqualTo("N"))
            .orderBy(createdAt.descending(), caseId.descending())
            .build()
            .render(RenderingStrategies.MYBATIS3);
    }
}
```

### 9.3 Generated SQL Mental Model

Hasil render kira-kira:

```sql
select case_id, case_no, status, priority, assigned_to, created_at
from case_file
where agency_id = #{parameters.p1,jdbcType=BIGINT}
  and status in (#{parameters.p2,jdbcType=VARCHAR}, #{parameters.p3,jdbcType=VARCHAR}, #{parameters.p4,jdbcType=VARCHAR})
  and deleted = #{parameters.p5,jdbcType=CHAR}
order by created_at DESC, case_id DESC
```

Nama parameter bisa berbeda tergantung versi/implementation, tetapi mental model-nya sama: SQL + parameter map.

---

## 10. Query Object dan Criteria Translation

Jangan biarkan service membangun DSL langsung secara liar.

Kurang ideal:

```java
public List<CaseListingRow> search(CaseSearchRequest request) {
    var stmt = select(...)
        .from(caseFile)
        .where(status, isEqualToWhenPresent(request.getStatus()))
        .and(agencyId, isEqualTo(request.getAgencyId()))
        .and(createdAt, isGreaterThanOrEqualToWhenPresent(request.getCreatedFrom()))
        .and(createdAt, isLessThanWhenPresent(request.getCreatedTo()))
        .build()
        .render(RenderingStrategies.MYBATIS3);

    return mapper.selectMany(stmt);
}
```

Lebih baik buat translator khusus:

```java
public final class CaseSearchSqlBuilder {

    public SelectStatementProvider build(CaseSearchCriteria criteria, PageRequest page) {
        return select(listingColumns())
            .from(caseFile)
            .where(agencyId, isEqualTo(criteria.agencyId()))
            .and(deleted, isEqualTo("N"))
            .and(status, isEqualToWhenPresent(criteria.status()))
            .and(priority, isEqualToWhenPresent(criteria.priority()))
            .and(assignedTo, isEqualToWhenPresent(criteria.assignedTo()))
            .and(createdAt, isGreaterThanOrEqualToWhenPresent(criteria.createdFrom()))
            .and(createdAt, isLessThanWhenPresent(criteria.createdToExclusive()))
            .orderBy(resolveSort(page.sort()))
            .limit(page.limit())
            .offset(page.offset())
            .build()
            .render(RenderingStrategies.MYBATIS3);
    }

    private BasicColumn[] listingColumns() {
        return new BasicColumn[] {
            caseId,
            caseNo,
            status,
            priority,
            assignedTo,
            createdAt,
            updatedAt
        };
    }
}
```

Tugas translator:

1. menerjemahkan request menjadi predicate;
2. menambahkan invariant scope seperti tenant/deleted;
3. menjaga sort whitelist;
4. memilih columns;
5. memilih pagination strategy;
6. menyembunyikan detail DSL dari service.

---

## 11. `isEqualToWhenPresent` dan Optional Predicate

DSL menyediakan pattern “when present” untuk menghilangkan predicate ketika value null.

Contoh:

```java
.where(status, isEqualToWhenPresent(criteria.status()))
.and(priority, isEqualToWhenPresent(criteria.priority()))
.and(assignedTo, isEqualToWhenPresent(criteria.assignedTo()))
```

Mental model:

```text
value present
  -> predicate dirender

value null
  -> predicate tidak dirender
```

Ini berguna, tetapi harus hati-hati.

### 11.1 Bahaya Null sebagai “Tidak Ada Filter”

Null bisa berarti:

1. user tidak mengirim filter;
2. user ingin mencari row dengan column `IS NULL`;
3. bug mapping request;
4. unauthorized filter hilang;
5. default value lupa di-set.

Karena itu jangan pakai `WhenPresent` untuk security scope.

Salah:

```java
.where(agencyId, isEqualToWhenPresent(criteria.agencyId()))
```

Jika `agencyId` null, tenant filter hilang.

Benar:

```java
.where(agencyId, isEqualTo(requiredAgencyId))
```

Atau validasi sebelum build:

```java
if (criteria.agencyId() == null) {
    throw new IllegalArgumentException("agencyId is required");
}
```

---

## 12. Safe Sorting

Sorting adalah tempat raw SQL substitution sering muncul di XML (`${orderBy}`). Dengan Dynamic SQL, kita bisa membuat whitelist lebih rapi.

### 12.1 Sort Key Enum

```java
public enum CaseSortKey {
    CREATED_AT,
    UPDATED_AT,
    PRIORITY,
    CASE_NO
}
```

### 12.2 Resolve Sort

```java
import org.mybatis.dynamic.sql.SortSpecification;

public final class CaseSortResolver {

    public SortSpecification resolve(CaseSort sort) {
        boolean descending = sort.direction() == SortDirection.DESC;

        switch (sort.key()) {
            case CREATED_AT:
                return descending ? createdAt.descending() : createdAt;
            case UPDATED_AT:
                return descending ? updatedAt.descending() : updatedAt;
            case PRIORITY:
                return descending ? priority.descending() : priority;
            case CASE_NO:
                return descending ? caseNo.descending() : caseNo;
            default:
                throw new IllegalArgumentException("Unsupported sort key: " + sort.key());
        }
    }
}
```

### 12.3 Stable Sort

Pagination butuh sort stabil. Jangan hanya:

```java
.orderBy(createdAt.descending())
```

Lebih aman:

```java
.orderBy(createdAt.descending(), caseId.descending())
```

Karena `created_at` bisa sama untuk banyak row. `case_id` menjadi tiebreaker.

---

## 13. Pagination dengan Dynamic SQL

### 13.1 Offset Pagination

```java
return select(listingColumns())
    .from(caseFile)
    .where(agencyId, isEqualTo(criteria.agencyId()))
    .and(deleted, isEqualTo("N"))
    .orderBy(createdAt.descending(), caseId.descending())
    .limit(page.limit())
    .offset(page.offset())
    .build()
    .render(RenderingStrategies.MYBATIS3);
```

Offset pagination cocok untuk:

1. halaman kecil;
2. admin UI biasa;
3. dataset sedang;
4. kebutuhan lompat halaman.

Risiko:

1. lambat untuk offset besar;
2. bisa tidak stabil saat ada insert/update concurrent;
3. count query bisa mahal.

### 13.2 Keyset Pagination

Keyset pagination lebih stabil untuk daftar besar.

Contoh semantik:

```sql
WHERE
  agency_id = ?
  AND deleted = 'N'
  AND (
    created_at < ?
    OR (created_at = ? AND case_id < ?)
  )
ORDER BY created_at DESC, case_id DESC
FETCH FIRST ? ROWS ONLY
```

Dengan DSL, predicate bisa dibuat sebagai function khusus. Jangan paksa kalau DSL menjadi terlalu sulit dibaca; XML bisa lebih jelas untuk keyset kompleks.

### 13.3 Count Query

Jangan selalu generate count otomatis. Count adalah query terpisah dengan cost sendiri.

```java
SelectStatementProvider countStatement = select(count())
    .from(caseFile)
    .where(agencyId, isEqualTo(criteria.agencyId()))
    .and(deleted, isEqualTo("N"))
    .and(status, isEqualToWhenPresent(criteria.status()))
    .build()
    .render(RenderingStrategies.MYBATIS3);
```

Prinsip:

1. count query harus punya predicate sama dengan listing;
2. count tidak perlu `order by`;
3. count join harus diminimalkan;
4. count untuk search kompleks bisa mahal;
5. pertimbangkan “has next page” daripada total count.

---

## 14. Insert Statement

### 14.1 Single Insert

```java
InsertStatementProvider<CaseFileRecord> insertStatement = insert(row)
    .into(caseFile)
    .map(caseId).toProperty("caseId")
    .map(caseNo).toProperty("caseNo")
    .map(agencyId).toProperty("agencyId")
    .map(status).toProperty("status")
    .map(priority).toProperty("priority")
    .map(assignedTo).toPropertyWhenPresent("assignedTo", row::getAssignedTo)
    .map(createdAt).toProperty("createdAt")
    .map(updatedAt).toProperty("updatedAt")
    .map(version).toProperty("version")
    .map(deleted).toConstant("'N'")
    .build()
    .render(RenderingStrategies.MYBATIS3);
```

Mapper:

```java
@InsertProvider(type = SqlProviderAdapter.class, method = "insert")
int insert(InsertStatementProvider<CaseFileRecord> insertStatement);
```

### 14.2 Insert Design Rules

1. `toProperty` untuk required field.
2. `toPropertyWhenPresent` untuk optional field.
3. Jangan pakai default database tanpa sadar.
4. Audit column harus jelas ownership-nya: app atau DB.
5. Generated key harus diuji per database vendor.
6. Idempotency sebaiknya memakai unique constraint.

### 14.3 Insert Selective Risk

Selective insert bisa menyembunyikan bug.

Contoh: `status` null karena bug, lalu kolom tidak dikirim, database default menjadi `NEW`. Apakah itu benar?

Jika status wajib secara business invariant, gunakan `toProperty`, bukan `toPropertyWhenPresent`.

---

## 15. Update Statement

### 15.1 Basic Update

```java
UpdateStatementProvider updateStatement = update(caseFile)
    .set(status).equalTo("IN_REVIEW")
    .set(updatedAt).equalTo(now)
    .where(caseId, isEqualTo(command.caseId()))
    .and(agencyId, isEqualTo(command.agencyId()))
    .and(deleted, isEqualTo("N"))
    .build()
    .render(RenderingStrategies.MYBATIS3);
```

### 15.2 Optimistic Locking

```java
UpdateStatementProvider updateStatement = update(caseFile)
    .set(status).equalTo(command.newStatus())
    .set(updatedAt).equalTo(command.updatedAt())
    .set(version).equalToConstant("version + 1")
    .where(caseId, isEqualTo(command.caseId()))
    .and(agencyId, isEqualTo(command.agencyId()))
    .and(version, isEqualTo(command.expectedVersion()))
    .and(status, isEqualTo(command.expectedStatus()))
    .and(deleted, isEqualTo("N"))
    .build()
    .render(RenderingStrategies.MYBATIS3);
```

Rows affected harus ditafsirkan:

```java
int updated = mapper.update(updateStatement);
if (updated == 0) {
    throw new OptimisticLockException("Case was modified or transition is invalid");
}
if (updated > 1) {
    throw new IllegalStateException("Primary key update affected more than one row");
}
```

### 15.3 State Transition Update

Untuk sistem case management/regulatory enforcement, update status sebaiknya membawa expected state.

```java
.where(caseId, isEqualTo(command.caseId()))
.and(status, isIn(command.allowedSourceStatuses()))
```

Ini membuat database menjadi penjaga invariant terakhir.

---

## 16. Delete Statement

### 16.1 Hard Delete

```java
DeleteStatementProvider deleteStatement = deleteFrom(caseFile)
    .where(caseId, isEqualTo(caseIdValue))
    .and(agencyId, isEqualTo(agencyIdValue))
    .build()
    .render(RenderingStrategies.MYBATIS3);
```

Hard delete jarang cocok untuk enterprise case data, audit data, regulatory lifecycle, atau data yang punya evidentiary value.

### 16.2 Soft Delete sebagai Update

```java
UpdateStatementProvider softDelete = update(caseFile)
    .set(deleted).equalTo("Y")
    .set(updatedAt).equalTo(now)
    .where(caseId, isEqualTo(command.caseId()))
    .and(agencyId, isEqualTo(command.agencyId()))
    .and(deleted, isEqualTo("N"))
    .build()
    .render(RenderingStrategies.MYBATIS3);
```

Prinsip:

1. semua read mapper harus punya `deleted = 'N'` jika soft delete aktif;
2. admin/audit mapper boleh membaca deleted row dengan method terpisah;
3. soft delete harus masuk test isolation;
4. jangan jadikan soft delete filter optional.

---

## 17. Reusable Predicate Pattern

Dynamic SQL menjadi kuat ketika predicate bisa dikomposisi. Tetapi komposisi harus disiplin.

### 17.1 Tenant Scope

```java
public final class CasePredicates {

    public static WhereApplier scopedToAgency(long agencyIdValue) {
        return where -> where.and(agencyId, isEqualTo(agencyIdValue));
    }

    public static WhereApplier notDeleted() {
        return where -> where.and(deleted, isEqualTo("N"));
    }

    private CasePredicates() {
    }
}
```

Catatan: API detail bisa berbeda sesuai versi library. Yang penting adalah pattern: invariant predicate jangan diduplikasi manual di semua query jika bisa dibuat reusable dengan aman.

### 17.2 Search Predicate

```java
public static WhereApplier matchesKeyword(String keyword) {
    if (keyword == null || keyword.isBlank()) {
        return where -> where;
    }

    String pattern = "%" + escapeLike(keyword.trim()) + "%";

    return where -> where.and(caseNo, isLike(pattern));
}
```

Untuk Java 8, ganti `isBlank()` dengan utility sendiri.

### 17.3 Jangan Over-Abstract

Buruk:

```java
QuerySpec spec = QuerySpec.where("status", "=", request.getStatus())
    .and("agency_id", "=", request.getAgencyId())
    .orderBy(request.getSort());
```

Ini membuang type-safety dan kembali ke stringly typed.

---

## 18. Metadata Generation vs Manual Metadata

Ada dua pendekatan:

### 18.1 Manual Metadata

Kelebihan:

1. eksplisit;
2. mudah disesuaikan naming;
3. cocok untuk table penting;
4. reviewer paham.

Kekurangan:

1. banyak boilerplate;
2. rawan lupa update saat schema berubah;
3. perlu discipline.

### 18.2 Generated Metadata

Kelebihan:

1. cepat untuk banyak table;
2. konsisten;
3. cocok untuk legacy schema besar;
4. mengurangi typo.

Kekurangan:

1. hasil bisa terlalu luas;
2. naming bisa tidak sesuai domain;
3. generated code bisa dianggap “tidak perlu direview”;
4. perubahan schema bisa menghasilkan diff besar.

### 18.3 Strategy Enterprise

Untuk sistem besar:

```text
core transactional tables
  -> manual/reviewed metadata atau generated lalu curated

lookup/reference tables
  -> generated acceptable

reporting/view metadata
  -> manual supaya projection jelas

legacy 200+ tables
  -> generated, tetapi expose hanya subset yang dipakai
```

---

## 19. Mapper API Design dengan Statement Provider

### 19.1 Generic Mapper Method

```java
@SelectProvider(type = SqlProviderAdapter.class, method = "select")
List<CaseListingRow> selectMany(SelectStatementProvider selectStatement);
```

Kelebihan:

1. reusable;
2. DSL builder bebas membuat banyak query;
3. mapper interface kecil.

Kekurangan:

1. contract mapper menjadi terlalu generic;
2. service bisa mengirim statement apapun;
3. security scope bisa bypass jika builder tidak dikontrol;
4. sulit audit “query apa saja yang ada”.

### 19.2 Domain-Specific Gateway

Lebih aman buat facade/repository:

```java
@Repository
public class CaseFileQueryRepository {
    private final CaseFileDynamicMapper mapper;
    private final CaseSearchSqlBuilder searchSqlBuilder;

    public List<CaseListingRow> search(CaseSearchCriteria criteria, PageRequest page) {
        SelectStatementProvider statement = searchSqlBuilder.build(criteria, page);
        return mapper.selectMany(statement);
    }
}
```

Service tidak melihat `SelectStatementProvider`.

Ini memberi boundary:

```text
Service
  -> speaks use-case language

Repository/facade
  -> speaks persistence language

Dynamic SQL builder
  -> translates criteria into SQL DSL

Mapper
  -> executes rendered SQL
```

---

## 20. Result Mapping dengan Dynamic SQL

Dynamic SQL hanya menghasilkan SQL. Result mapping tetap perlu didesain.

Pilihan:

1. annotation result mapping;
2. XML resultMap;
3. constructor mapping;
4. record mapping;
5. simple auto mapping dengan alias discipline.

Contoh annotation sederhana:

```java
@Results(id = "CaseListingRowResult", value = {
    @Result(column = "case_id", property = "caseId", id = true),
    @Result(column = "case_no", property = "caseNo"),
    @Result(column = "status", property = "status"),
    @Result(column = "priority", property = "priority"),
    @Result(column = "assigned_to", property = "assignedTo"),
    @Result(column = "created_at", property = "createdAt")
})
@SelectProvider(type = SqlProviderAdapter.class, method = "select")
List<CaseListingRow> selectMany(SelectStatementProvider selectStatement);
```

Untuk mapping kompleks, XML resultMap tetap sering lebih jelas.

Prinsip:

```text
Dynamic SQL solves SQL construction.
It does not remove result mapping responsibility.
```

---

## 21. XML + Dynamic SQL Hybrid

Tidak perlu memilih salah satu secara ideologis.

Arsitektur realistis:

```text
Simple stable query
  -> XML

Long report SQL
  -> XML

Complex dynamic search
  -> MyBatis Dynamic SQL

Batch insert/update generated statements
  -> MyBatis Dynamic SQL atau XML tergantung vendor

Stored procedure
  -> XML

Vendor-specific tuning query
  -> XML
```

### 21.1 Hybrid Module Example

```text
case/
  mapper/
    CaseFileMapper.java                # XML-backed transactional mapper
    CaseFileDynamicMapper.java         # Dynamic SQL provider mapper
    CaseFileReportMapper.java          # XML-backed report mapper
  sql/
    CaseFileDynamicSqlSupport.java     # table/column metadata
    CaseSearchSqlBuilder.java          # dynamic query translator
  repository/
    CaseFileRepository.java            # use-case facade
```

Jangan pakai Dynamic SQL untuk semua hal hanya karena library tersedia.

---

## 22. Dynamic SQL vs XML: Decision Matrix

| Situation | XML Dynamic SQL | MyBatis Dynamic SQL |
|---|---:|---:|
| Query sangat sederhana | Sangat cocok | Bisa, tapi overkill |
| Banyak optional filters | Bisa, tapi XML panjang | Cocok |
| Banyak reusable predicates | Cukup sulit | Cocok |
| SQL vendor-specific kompleks | Sangat cocok | Bisa terbatas/kurang natural |
| DBA review penting | Sangat cocok | Kurang langsung |
| Refactor column references | Lemah-sedang | Kuat |
| Query perlu dibaca sebagai SQL literal | Kuat | Sedang |
| Criteria object driven | Sedang | Kuat |
| Generated CRUD style | Sedang | Kuat |
| Complex report query | Kuat | Lemah-sedang |
| Need to avoid XML | Lemah | Kuat |
| Team SQL-first non-Java review | Kuat | Sedang |

---

## 23. Query Plan Stability

Dynamic SQL dapat menghasilkan variasi SQL berbeda sesuai filter yang ada.

Contoh criteria A:

```sql
WHERE agency_id = ? AND status = ?
```

Criteria B:

```sql
WHERE agency_id = ? AND priority = ? AND created_at >= ?
```

Criteria C:

```sql
WHERE agency_id = ? AND assigned_to = ? AND status = ? AND priority = ?
```

Setiap bentuk SQL dapat punya plan berbeda. Ini bukan bug, tapi harus dipahami.

Prinsip:

1. index harus didesain untuk kombinasi filter paling umum;
2. jangan bangun 40 kombinasi predicate tanpa observability;
3. log generated SQL shape, bukan semua value sensitif;
4. test explain plan untuk query penting;
5. batasi filter yang tidak index-friendly;
6. gunakan search backend bila kebutuhan query terlalu bebas.

---

## 24. Security Boundary

Dynamic SQL membantu menghindari raw string substitution, tetapi tetap bisa tidak aman jika dipakai sembarangan.

### 24.1 Aman

```java
.where(status, isEqualTo(request.status()))
```

Value menjadi parameter binding.

### 24.2 Berbahaya

```java
.orderBy(sortColumnFromRequest)
```

Jika sort column berasal dari request mentah, itu berisiko.

### 24.3 Rule

Semua input user harus masuk sebagai:

```text
value predicate parameter
```

Bukan sebagai:

```text
SQL identifier
SQL fragment
operator string
order by fragment
table name
schema name
```

Jika memang butuh identifier dinamis, gunakan enum/whitelist.

---

## 25. Tenant dan Authorization Scope

Dynamic query builder harus selalu memasukkan scope.

Contoh:

```java
return select(listingColumns())
    .from(caseFile)
    .where(agencyId, isEqualTo(userContext.agencyId()))
    .and(deleted, isEqualTo("N"))
    .and(status, isEqualToWhenPresent(criteria.status()))
    .build()
    .render(RenderingStrategies.MYBATIS3);
```

Jangan:

```java
.where(agencyId, isEqualToWhenPresent(criteria.agencyId()))
```

Karena request criteria bukan authority source. Authority source harus datang dari authenticated context, bukan request filter biasa.

### 25.1 Admin Override

Jika admin bisa cross-agency search, buat method berbeda:

```java
public SelectStatementProvider buildAdminSearch(AdminCaseSearchCriteria criteria) { ... }
```

Jangan satu method dengan optional scope yang rawan lupa.

---

## 26. Audit dan Traceability

Salah satu kekurangan query DSL adalah SQL tidak terlihat langsung di source sebagai SQL utuh. Maka auditability harus dibangun.

Praktik:

1. builder class diberi nama sesuai use-case;
2. tiap query penting punya test yang snapshot generated SQL shape;
3. log query name/use-case, bukan hanya SQL;
4. comment business invariant di builder;
5. jangan membuat anonymous query chain di service;
6. generated SQL untuk query kritikal didokumentasikan.

Contoh:

```java
public SelectStatementProvider buildOfficerWorkQueue(OfficerWorkQueueCriteria criteria) {
    // Invariant:
    // - officer can see only agency-scoped, non-deleted cases
    // - terminal statuses are excluded from active work queue
    // - ordering must be stable for pagination
    return select(workQueueColumns())
        .from(caseFile)
        .where(agencyId, isEqualTo(criteria.agencyId()))
        .and(deleted, isEqualTo("N"))
        .and(status, isNotIn("CLOSED", "WITHDRAWN", "REJECTED"))
        .and(assignedTo, isEqualTo(criteria.officerId()))
        .orderBy(priority.descending(), createdAt, caseId)
        .limit(criteria.limit())
        .build()
        .render(RenderingStrategies.MYBATIS3);
}
```

---

## 27. Testing MyBatis Dynamic SQL

### 27.1 Test Builder Output Shape

Tujuannya bukan mengunci setiap nama parameter internal, tetapi memastikan predicate utama ada.

```java
@Test
void searchCases_shouldIncludeAgencyScopeAndSoftDelete() {
    CaseSearchCriteria criteria = new CaseSearchCriteria(
        100L,
        "IN_REVIEW",
        null,
        null,
        null
    );

    SelectStatementProvider statement = builder.build(criteria, PageRequest.first(20));

    String sql = statement.getSelectStatement();

    assertThat(sql).contains("from case_file");
    assertThat(sql).contains("agency_id");
    assertThat(sql).contains("deleted");
    assertThat(sql).contains("status");
    assertThat(sql).contains("order by");
}
```

### 27.2 Test Parameter Presence

```java
assertThat(statement.getParameters()).isNotEmpty();
```

### 27.3 Integration Test dengan Database Asli

Builder unit test tidak cukup. Tetap butuh integration test:

1. apply schema migration;
2. insert dataset;
3. execute mapper;
4. assert rows;
5. assert tenant isolation;
6. assert pagination stable;
7. assert rows affected for update;
8. assert generated key behavior.

### 27.4 Test Dynamic Branches

Untuk 10 optional filters, jangan test semua 2^10 kombinasi. Test:

1. no optional filter;
2. each important filter individually;
3. common combinations;
4. security invariant always present;
5. invalid sort rejected;
6. empty list behavior;
7. boundary date range;
8. pagination order stable.

---

## 28. Empty List Semantics

`IN ()` invalid di banyak database. Dynamic SQL builder harus punya semantic yang jelas.

Untuk filter optional:

```text
statuses = null
  -> no status filter

statuses = []
  -> return no rows or reject request?

statuses = [A, B]
  -> status in (A, B)
```

Jangan samakan null dan empty list tanpa sadar.

Pattern:

```java
if (criteria.statuses() != null && criteria.statuses().isEmpty()) {
    return noRowsStatement();
}
```

Atau validasi:

```java
if (criteria.statuses() != null && criteria.statuses().isEmpty()) {
    throw new IllegalArgumentException("statuses must be null or non-empty");
}
```

Untuk authorization scope, empty list bisa berarti user tidak punya akses. Maka safest behavior adalah return no rows.

---

## 29. LIKE Query dan Escaping

Dynamic SQL tidak otomatis membuat LIKE aman secara semantik. Parameter binding mencegah injection value, tetapi wildcard `%` dan `_` tetap punya arti.

Jika user mencari literal `_`, query `LIKE '%_%'` akan match hampir semua string.

Pattern:

```java
public static String escapeLike(String raw) {
    return raw
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_");
}
```

Lalu SQL perlu `ESCAPE` clause. Jika DSL tidak nyaman untuk vendor-specific escape syntax, XML bisa lebih jelas.

Prinsip:

1. trim input;
2. batasi panjang keyword;
3. escape wildcard;
4. hindari leading wildcard untuk kolom besar jika index penting;
5. gunakan full-text search jika kebutuhan search kompleks.

---

## 30. Date Range Semantics

Salah satu bug umum adalah inclusive end date.

Kurang aman:

```java
.and(createdAt, isLessThanOrEqualTo(criteria.createdTo()))
```

Lebih baik gunakan exclusive upper bound:

```java
.and(createdAt, isGreaterThanOrEqualToWhenPresent(criteria.createdFrom()))
.and(createdAt, isLessThanWhenPresent(criteria.createdToExclusive()))
```

Untuk input tanggal UI:

```text
fromDate = 2026-06-01
toDate   = 2026-06-30
```

Terjemahkan menjadi:

```text
created_at >= 2026-06-01T00:00:00
created_at <  2026-07-01T00:00:00
```

Ini menghindari masalah presisi timestamp.

---

## 31. Update Selective dan PATCH Semantics

Dynamic SQL memudahkan `toPropertyWhenPresent` atau conditional set. Tetapi PATCH semantics harus membedakan:

1. field tidak dikirim;
2. field dikirim dengan value null;
3. field dikirim dengan value kosong;
4. field dikirim dengan value valid.

Java `null` saja tidak cukup.

Gunakan wrapper:

```java
public final class PatchField<T> {
    private final boolean present;
    private final T value;

    public boolean isPresent() { return present; }
    public T value() { return value; }
}
```

Atau command object yang eksplisit:

```java
public final class UpdateCaseAssignmentCommand {
    private final long caseId;
    private final long agencyId;
    private final AssignmentChange assignmentChange;
}
```

Jangan membuat update DSL yang diam-diam mengabaikan null padahal user ingin clear value.

---

## 32. Batch dan Multi-Row Operation

Dynamic SQL mendukung statement insert, multi-row insert, update, delete, tetapi batch behavior tetap bergantung JDBC, MyBatis executor, dan database vendor.

Pertimbangan:

1. multi-row insert bisa menghasilkan SQL sangat panjang;
2. JDBC batch bisa lebih stabil untuk jumlah besar;
3. generated keys pada batch berbeda antar vendor;
4. transaction size harus dibatasi;
5. partial failure harus dimodelkan;
6. idempotency harus memakai unique key.

Untuk batch besar, jangan hanya bertanya “bisa dibuat dengan DSL?”. Tanya:

```text
Apakah SQL size aman?
Apakah parameter count limit aman?
Apakah rollback size aman?
Apakah driver mendukung generated key mode ini?
Apakah retry idempotent?
```

---

## 33. Common Anti-Patterns

### 33.1 DSL di Controller/Service

Buruk:

```java
@GetMapping
public List<Row> search(Request request) {
    var stmt = select(...).from(...).where(...).build().render(...);
    return mapper.selectMany(stmt);
}
```

Service/controller menjadi SQL builder. Boundary bocor.

### 33.2 Generic Query Builder Buatan Sendiri

Buruk:

```java
builder.where(request.getField(), request.getOperator(), request.getValue());
```

Ini menghilangkan manfaat DSL dan membuka injection/authorization risk.

### 33.3 Semua Query Dipaksa ke DSL

Tidak semua SQL cocok jadi chain Java. Report query panjang bisa lebih jelas di XML.

### 33.4 Predicate Security Optional

Buruk:

```java
.and(agencyId, isEqualToWhenPresent(criteria.agencyId()))
```

Untuk security scope, jangan optional.

### 33.5 Snapshot Test Terlalu Rapuh

Jangan test string SQL penuh termasuk nama parameter internal untuk semua query. Test invariant penting dan integration behavior.

### 33.6 Mengabaikan Generated SQL

DSL bukan alasan untuk tidak membaca SQL. Selalu lihat generated SQL untuk query kritikal.

---

## 34. Java 8 sampai Java 25 Considerations

### 34.1 Java 8

Gunakan:

1. POJO criteria;
2. builder pattern manual;
3. utility method untuk blank string;
4. no records;
5. no switch expression;
6. careful lambda readability.

Contoh:

```java
public final class CaseSearchCriteria {
    private final Long agencyId;
    private final String status;

    public CaseSearchCriteria(Long agencyId, String status) {
        this.agencyId = agencyId;
        this.status = status;
    }

    public Long getAgencyId() { return agencyId; }
    public String getStatus() { return status; }
}
```

### 34.2 Java 11

Sedikit lebih nyaman:

1. `String.isBlank()`;
2. `var` untuk local variable jika dipakai hati-hati;
3. better HTTP/tooling ecosystem.

### 34.3 Java 17

Bisa memakai:

1. records untuk immutable criteria/projection;
2. sealed type untuk sort/filter model;
3. switch expression;
4. stronger baseline untuk Spring Boot 3.

Contoh:

```java
public record CaseSearchCriteria(
    long agencyId,
    String status,
    String priority,
    Long assignedTo
) {}
```

### 34.4 Java 21

Virtual threads bisa membantu blocking JDBC workload tertentu, tetapi:

1. JDBC driver tetap blocking;
2. connection pool tetap bottleneck;
3. virtual thread bukan pengganti index;
4. jangan menaikkan concurrency tanpa database capacity model.

Dynamic SQL tidak berubah karena virtual threads. Yang berubah adalah execution concurrency model di service layer.

### 34.5 Java 25

Gunakan prinsip sama: jangan memakai fitur bahasa baru di shared library jika masih harus dikonsumsi Java lama. Pisahkan module modern-only dari module compatibility.

---

## 35. Production-Grade Design Example

### 35.1 Criteria

```java
public record CaseSearchCriteria(
    long agencyId,
    String status,
    String priority,
    Long assignedTo,
    LocalDateTime createdFrom,
    LocalDateTime createdToExclusive,
    String keyword
) {}
```

### 35.2 Page Request

```java
public record PageRequest(
    int limit,
    int offset,
    CaseSort sort
) {
    public PageRequest {
        if (limit < 1 || limit > 200) {
            throw new IllegalArgumentException("limit must be between 1 and 200");
        }
        if (offset < 0) {
            throw new IllegalArgumentException("offset must be non-negative");
        }
    }
}
```

### 35.3 Sort Model

```java
public record CaseSort(CaseSortKey key, SortDirection direction) {}

public enum CaseSortKey {
    CREATED_AT,
    UPDATED_AT,
    CASE_NO,
    PRIORITY
}

public enum SortDirection {
    ASC,
    DESC
}
```

### 35.4 SQL Builder

```java
public final class CaseSearchSqlBuilder {

    public SelectStatementProvider build(CaseSearchCriteria criteria, PageRequest page) {
        validate(criteria);

        return select(columns())
            .from(caseFile)
            .where(agencyId, isEqualTo(criteria.agencyId()))
            .and(deleted, isEqualTo("N"))
            .and(status, isEqualToWhenPresent(normalize(criteria.status())))
            .and(priority, isEqualToWhenPresent(normalize(criteria.priority())))
            .and(assignedTo, isEqualToWhenPresent(criteria.assignedTo()))
            .and(createdAt, isGreaterThanOrEqualToWhenPresent(criteria.createdFrom()))
            .and(createdAt, isLessThanWhenPresent(criteria.createdToExclusive()))
            .and(caseNo, isLikeWhenPresent(keywordPattern(criteria.keyword())))
            .orderBy(resolvePrimarySort(page.sort()), caseId.descending())
            .limit(page.limit())
            .offset(page.offset())
            .build()
            .render(RenderingStrategies.MYBATIS3);
    }

    private void validate(CaseSearchCriteria criteria) {
        if (criteria.agencyId() <= 0) {
            throw new IllegalArgumentException("agencyId is required");
        }
    }

    private BasicColumn[] columns() {
        return new BasicColumn[] {
            caseId,
            caseNo,
            status,
            priority,
            assignedTo,
            createdAt,
            updatedAt
        };
    }

    private String normalize(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
    }

    private String keywordPattern(String keyword) {
        String normalized = normalize(keyword);
        if (normalized == null) {
            return null;
        }
        return "%" + escapeLike(normalized) + "%";
    }

    private SortSpecification resolvePrimarySort(CaseSort sort) {
        if (sort == null) {
            return createdAt.descending();
        }

        boolean desc = sort.direction() == SortDirection.DESC;

        return switch (sort.key()) {
            case CREATED_AT -> desc ? createdAt.descending() : createdAt;
            case UPDATED_AT -> desc ? updatedAt.descending() : updatedAt;
            case CASE_NO -> desc ? caseNo.descending() : caseNo;
            case PRIORITY -> desc ? priority.descending() : priority;
        };
    }
}
```

Untuk Java 8, ganti record, switch expression, dan `isBlank()` dengan POJO, switch statement, dan utility method.

### 35.5 Repository Facade

```java
@Repository
public class CaseSearchRepository {
    private final CaseFileDynamicMapper mapper;
    private final CaseSearchSqlBuilder builder;

    public CaseSearchRepository(CaseFileDynamicMapper mapper,
                                CaseSearchSqlBuilder builder) {
        this.mapper = mapper;
        this.builder = builder;
    }

    public List<CaseListingRow> search(CaseSearchCriteria criteria, PageRequest page) {
        SelectStatementProvider statement = builder.build(criteria, page);
        return mapper.selectMany(statement);
    }
}
```

Service tidak tahu MyBatis Dynamic SQL.

---

## 36. How to Review a Dynamic SQL Builder

Saat review code Dynamic SQL, jangan hanya tanya “compile atau tidak”. Tanyakan:

### 36.1 Correctness

1. Apakah semua mandatory predicate selalu ada?
2. Apakah optional filter benar-benar optional?
3. Apakah null dan empty list punya semantics jelas?
4. Apakah date range inclusive/exclusive benar?
5. Apakah sort stabil?
6. Apakah rows affected dicek untuk update/delete?

### 36.2 Security

1. Apakah tenant/agency scope tidak optional?
2. Apakah authorization source bukan dari request mentah?
3. Apakah sort key whitelisted?
4. Apakah table/column name tidak berasal dari user input?
5. Apakah LIKE wildcard di-escape jika perlu?

### 36.3 Performance

1. Apakah predicate index-friendly?
2. Apakah leading wildcard diperlukan?
3. Apakah offset besar mungkin terjadi?
4. Apakah count query mahal?
5. Apakah generated SQL shape terlalu banyak variasi?
6. Apakah query besar punya explain plan?

### 36.4 Maintainability

1. Apakah builder punya nama use-case?
2. Apakah service tidak membangun DSL langsung?
3. Apakah metadata table rapi?
4. Apakah reusable predicate tidak over-abstract?
5. Apakah SQL masih bisa dipahami reviewer?
6. Apakah test mencakup dynamic branches penting?

---

## 37. Failure Model

| Failure | Penyebab Umum | Mitigasi |
|---|---|---|
| Tenant leakage | scope predicate optional | required security context, test invariant |
| Wrong rows returned | criteria translation salah | builder tests + integration tests |
| SQL not readable | DSL chain terlalu panjang | split builder, use XML for complex query |
| Slow query | optional predicate tidak index-friendly | explain plan, index design |
| Sort injection | raw sort string | enum whitelist |
| Empty list bug | `IN ()` atau filter hilang | explicit empty list semantics |
| Null ignored incorrectly | `WhenPresent` dipakai untuk required field | validation + command design |
| Update lost update | no version/status predicate | optimistic locking update |
| Over-abstraction | generic query builder | use-case builder pattern |
| Mapping mismatch | SQL generated benar, resultMap salah | mapping tests |

---

## 38. Checklist Produksi

Sebelum query Dynamic SQL masuk production:

```text
[ ] Builder class punya nama use-case yang jelas
[ ] Service/controller tidak membangun DSL langsung
[ ] Mandatory tenant/security predicate selalu ada
[ ] Soft delete visibility eksplisit
[ ] Optional filter null semantics jelas
[ ] Empty list semantics jelas
[ ] Date range memakai exclusive upper bound bila timestamp
[ ] Sort key whitelisted
[ ] Sort stabil untuk pagination
[ ] Limit maksimum divalidasi
[ ] Generated SQL pernah dibaca manusia
[ ] Query penting punya explain plan
[ ] Query penting punya integration test
[ ] Result mapping diuji
[ ] Update/delete mengecek rows affected
[ ] LIKE wildcard di-handle sesuai kebutuhan
[ ] Count query tidak otomatis diasumsikan murah
[ ] Vendor-specific syntax tidak dipaksa jika XML lebih jelas
[ ] Logging tidak membocorkan PII/secret
```

---

## 39. Kesimpulan

MyBatis Dynamic SQL adalah alat yang kuat untuk membangun SQL secara programmatic, type-safer, dan composable. Nilainya paling terasa ketika query banyak kombinasi predicate, membutuhkan reuse, atau criteria object driven.

Tetapi library ini bukan pengganti pemahaman SQL. Ia tidak otomatis memperbaiki indexing, transaction correctness, authorization scope, result mapping, atau schema evolution. Bahkan, jika dipakai tanpa discipline, ia hanya memindahkan kompleksitas dari XML ke Java chain.

Mental model yang tepat:

```text
MyBatis Dynamic SQL is not a magic ORM.
It is a structured SQL generator.

The database still sees SQL.
The optimizer still optimizes SQL.
The mapper still maps rows.
The transaction still defines consistency.
The engineer still owns correctness.
```

Untuk engineer level tinggi, pertanyaan utamanya bukan “bisa dibuat dengan DSL atau tidak”, tetapi:

```text
Apakah DSL membuat query lebih aman, lebih mudah diuji, lebih mudah direfactor,
dan tetap mudah dipahami sebagai SQL?
```

Jika jawabannya ya, gunakan MyBatis Dynamic SQL. Jika tidak, XML atau plain SQL bisa menjadi pilihan yang lebih jujur.

---

## 40. Hubungan ke Bagian Berikutnya

Bagian ini menutup pembahasan fondasi SQL generation. Berikutnya kita masuk ke desain API mapper:

```text
Part 10 — Mapper Method API Design: Return Type, Optional, List, Cursor, Stream
```

Di sana kita akan membahas bagaimana method mapper harus menyatakan contract secara jernih:

1. single row vs optional row;
2. list vs stream/cursor;
3. update count sebagai invariant;
4. `find`, `getRequired`, `exists`, `lock`, `updateIfVersionMatches`;
5. bagaimana return type memengaruhi correctness dan failure handling.

---

## Referensi

- MyBatis Dynamic SQL Introduction — https://mybatis.org/mybatis-dynamic-sql/docs/introduction.html
- MyBatis Dynamic SQL How It Works — https://mybatis.org/mybatis-dynamic-sql/docs/howItWorks.html
- MyBatis Dynamic SQL Quick Start — https://mybatis.org/mybatis-dynamic-sql/docs/quickStart.html
- MyBatis Dynamic SQL Database Object Representation — https://mybatis.org/mybatis-dynamic-sql/docs/databaseObjects.html
- MyBatis Dynamic SQL Select Statements — https://mybatis.org/mybatis-dynamic-sql/docs/select.html
- MyBatis Dynamic SQL Insert Statements — https://mybatis.org/mybatis-dynamic-sql/docs/insert.html
- MyBatis Dynamic SQL Update Statements — https://mybatis.org/mybatis-dynamic-sql/docs/update.html
- MyBatis Dynamic SQL Specialized Support for MyBatis3 — https://mybatis.org/mybatis-dynamic-sql/docs/mybatis3.html
- MyBatis Dynamic SQL Extending / Rendering Strategy — https://mybatis.org/mybatis-dynamic-sql/docs/extending.html
- MyBatis 3 Dynamic SQL XML — https://mybatis.org/mybatis-3/dynamic-sql.html
- MyBatis 3 Mapper XML — https://mybatis.org/mybatis-3/sqlmap-xml.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 8 — Dynamic SQL XML: `if`, `choose`, `where`, `set`, `trim`, `foreach`](./08-dynamic-sql-xml-if-choose-where-set-trim-foreach.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 10 — Mapper Method API Design: Return Type, Optional, List, Cursor, Stream](./10-mapper-method-api-design-return-type-optional-list-cursor-stream.md)
