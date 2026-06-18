# Part 13 — TypeHandler Engineering: Domain Types, Enum, JSON, Array, Vendor Types

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `13-typehandler-engineering-domain-types-enum-json-array-vendor-types.md`  
> Target: Java 8 sampai Java 25  
> Status seri: **belum selesai** — ini adalah Part 13 dari 34

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas:

- mapper sebagai contract;
- statement mapping;
- parameter binding;
- result mapping;
- dynamic SQL;
- Spring Boot integration;
- transaction boundary.

Bagian ini masuk ke area yang sering terlihat kecil, tetapi sangat menentukan kualitas persistence layer jangka panjang: **TypeHandler engineering**.

Banyak engineer mengenal `TypeHandler` hanya sebagai “converter dari DB ke Java”. Itu benar, tetapi terlalu dangkal. Di sistem enterprise, `TypeHandler` adalah salah satu tempat paling strategis untuk menjaga batas antara:

```text
Database physical representation
  <-> JDBC type system
  <-> MyBatis parameter/result pipeline
  <-> Java technical type
  <-> Domain semantic type
```

Kalau boundary ini tidak disiplin, akibatnya biasanya muncul sebagai:

- enum ordinal rusak setelah urutan enum berubah;
- `String` status tersebar di service layer;
- JSON column parsing tidak konsisten;
- CLOB/BLOB membuat memory spike;
- null handling berbeda antara read dan write;
- database vendor-specific type bocor ke business logic;
- mapper XML penuh `javaType`, `jdbcType`, dan converter ad-hoc;
- migrasi schema menjadi berisiko tinggi;
- security masking dan audit sulit dijaga.

Tujuan akhir Part 13 adalah membuat kita mampu mendesain `TypeHandler` bukan hanya agar query berjalan, tetapi agar persistence layer memiliki **semantic correctness**, **database portability boundary**, **testability**, dan **production resilience**.

---

## 1. Definisi Singkat: Apa Itu TypeHandler?

Dalam MyBatis, `TypeHandler` dipakai ketika MyBatis perlu:

1. mengisi nilai Java ke `PreparedStatement` / `CallableStatement`; dan
2. membaca nilai dari `ResultSet` / `CallableStatement` kembali ke Java object.

Secara mental:

```text
Write path:
Java value
  -> TypeHandler.setParameter(...)
  -> JDBC PreparedStatement
  -> database column

Read path:
database column
  -> JDBC ResultSet
  -> TypeHandler.getResult(...)
  -> Java value
```

MyBatis sudah menyediakan banyak built-in type handler untuk tipe umum seperti `String`, `Integer`, `Long`, `BigDecimal`, `Boolean`, `Date`, `LocalDate`, `LocalDateTime`, enum, byte array, dan lain-lain. Tetapi sistem besar hampir selalu butuh custom handler untuk tipe seperti:

- status code;
- value object;
- JSON payload;
- encrypted field;
- masked value;
- money/currency;
- tenant id;
- agency/module code;
- yes/no flag;
- Oracle CLOB;
- PostgreSQL JSONB;
- PostgreSQL array;
- database-specific enum;
- custom identifier type.

---

## 2. Mental Model: TypeHandler Bukan Business Logic

`TypeHandler` adalah **representation translator**, bukan tempat business rule.

Perbedaan penting:

| Kategori | Cocok di TypeHandler? | Contoh |
|---|---:|---|
| Representasi teknis | Ya | `"A"` di DB menjadi `Status.ACTIVE` |
| Parsing format storage | Ya | JSON string menjadi `AddressSnapshot` |
| Normalisasi storage sederhana | Ya, hati-hati | trim DB code, uppercase code |
| Validasi domain kompleks | Tidak | apakah case boleh pindah status |
| Authorization | Tidak | apakah user boleh lihat row |
| Enrichment eksternal | Tidak | call service untuk melengkapi data |
| Query tambahan | Tidak | lookup reference table dari handler |
| Audit side-effect | Tidak | insert audit trail saat membaca field |

Rule of thumb:

```text
TypeHandler boleh menjawab:
“Bagaimana nilai ini direpresentasikan di DB?”

TypeHandler tidak boleh menjawab:
“Apa keputusan bisnis yang harus terjadi karena nilai ini?”
```

Kalau `TypeHandler` mulai butuh dependency ke service, repository, HTTP client, cache, atau security context, hampir pasti desainnya salah.

---

## 3. Kenapa TypeHandler Penting untuk Engineer Level Tinggi?

Engineer biasa biasanya puas dengan:

```java
private String status;
```

Engineer yang lebih matang bertanya:

- Apakah `status` hanya string teknis atau domain state?
- Apakah semua value valid diketahui?
- Apa yang terjadi jika DB berisi unknown legacy code?
- Apakah enum disimpan dengan `name`, `ordinal`, atau business code?
- Apakah perubahan nama enum akan merusak data lama?
- Apakah kode status harus tetap backward-compatible selama migrasi?
- Apakah status bisa dipakai di audit/reporting tanpa object domain penuh?
- Apakah null punya arti “unknown”, “not applicable”, atau “not provided”?

`TypeHandler` adalah salah satu alat untuk memaksa jawaban desain tersebut menjadi eksplisit.

---

## 4. Pipeline Internal MyBatis yang Melibatkan TypeHandler

Secara ringkas:

```text
Mapper method call
  -> MappedStatement
  -> BoundSql
  -> ParameterMapping
  -> TypeHandlerRegistry chooses TypeHandler
  -> ParameterHandler sets PreparedStatement value
  -> JDBC executes SQL
  -> ResultSetHandler maps rows
  -> ResultMapping chooses TypeHandler
  -> Java object populated
```

Ada dua sisi utama:

### 4.1 Parameter Mapping Side

Contoh XML:

```xml
<select id="findByStatus" resultMap="caseRowMap">
  SELECT id, status_code
  FROM case_record
  WHERE status_code = #{status, typeHandler=com.acme.mybatis.CaseStatusTypeHandler}
</select>
```

Saat `#{status}` diproses, MyBatis membuat parameter mapping yang berisi metadata seperti:

- property name;
- Java type;
- JDBC type;
- mode untuk stored procedure;
- numeric scale;
- TypeHandler.

Kemudian handler mengisi value ke `PreparedStatement`.

### 4.2 Result Mapping Side

Contoh:

```xml
<resultMap id="caseRowMap" type="com.acme.caseapp.CaseRow">
  <id property="id" column="id" />
  <result property="status" column="status_code"
          typeHandler="com.acme.mybatis.CaseStatusTypeHandler" />
</resultMap>
```

Saat membaca `status_code`, MyBatis memakai handler untuk mengubah value database menjadi tipe Java yang tepat.

---

## 5. TypeHandlerRegistry: Cara MyBatis Memilih Handler

MyBatis memiliki `TypeHandlerRegistry`. Registry ini menyimpan mapping antara:

```text
Java type + JDBC type -> TypeHandler
```

Contoh konseptual:

```text
String + VARCHAR       -> StringTypeHandler
Integer + INTEGER      -> IntegerTypeHandler
LocalDate + DATE       -> LocalDateTypeHandler
CaseStatus + VARCHAR   -> CaseStatusTypeHandler
```

Handler bisa dipilih melalui beberapa cara:

1. eksplisit di XML `typeHandler="..."`;
2. eksplisit di parameter placeholder;
3. registered globally via configuration;
4. registered via Spring Boot `type-handlers-package`;
5. annotation `@MappedTypes` dan `@MappedJdbcTypes`;
6. fallback ke unknown/default handler.

Prinsip desain:

```text
Semakin domain-specific handler-nya,
semakin aman jika binding-nya eksplisit atau package registration-nya terkontrol.
```

Untuk handler yang sangat umum seperti enum-by-code, global registration bisa berguna. Untuk handler yang riskan seperti encrypted field, JSON variant, atau vendor-specific object, explicit mapping sering lebih aman.

---

## 6. Built-in TypeHandler yang Perlu Dipahami

MyBatis sudah punya handler default untuk banyak tipe. Beberapa yang penting:

| Java Type | Typical JDBC Type | Catatan |
|---|---|---|
| `String` | `VARCHAR`, `CHAR`, `CLOB` | `CLOB` bisa butuh perhatian memory |
| `Integer`, `Long` | `INTEGER`, `BIGINT`, `NUMERIC` | numeric precision harus jelas |
| `BigDecimal` | `DECIMAL`, `NUMERIC` | penting untuk uang/jumlah |
| `Boolean` | `BOOLEAN`, `BIT` | vendor DB berbeda-beda |
| `Date` | `TIMESTAMP`, `DATE` | legacy Java date API |
| `LocalDate` | `DATE` | JSR-310 support modern |
| `LocalDateTime` | `TIMESTAMP` | tanpa timezone |
| `OffsetDateTime` | `TIMESTAMP_WITH_TIMEZONE` | vendor support berbeda |
| `byte[]` | `BLOB`, `VARBINARY` | large binary risk |
| enum | `VARCHAR` atau ordinal | default perlu dipahami |

Catatan penting: tipe date/time modern seperti `LocalDate`, `LocalDateTime`, dan keluarga JSR-310 sudah didukung default di MyBatis modern. Namun “didukung” tidak berarti semua semantics waktu sudah aman. Time zone, database session time zone, driver behavior, dan column type tetap harus dipahami.

---

## 7. Default Enum Mapping: Jangan Asal Pakai

Enum adalah salah satu sumber bug paling mahal.

Misalnya:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Jika disimpan sebagai `name()`:

```text
SUBMITTED
APPROVED
REJECTED
```

Risiko:

- rename enum merusak data lama;
- nama Java menjadi kontrak database;
- enum refactoring menjadi migration event.

Jika disimpan sebagai ordinal:

```text
0, 1, 2, 3
```

Risiko jauh lebih buruk:

- menyisipkan enum baru di tengah mengubah arti data lama;
- data menjadi tidak self-describing;
- debugging SQL/reporting sulit;
- migration audit lebih berisiko.

Untuk enterprise system, terutama regulatory/case-management, pattern yang lebih defensible adalah **business code enum**.

Contoh:

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUB"),
    UNDER_REVIEW("UR"),
    APPROVED("APP"),
    REJECTED("REJ"),
    CLOSED("CLS");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static CaseStatus fromCode(String code) {
        for (CaseStatus value : values()) {
            if (value.code.equals(code)) {
                return value;
            }
        }
        throw new IllegalArgumentException("Unknown CaseStatus code: " + code);
    }
}
```

Lalu `TypeHandler` menghubungkan `CaseStatus` dengan DB `VARCHAR`.

---

## 8. Custom Enum-by-Code TypeHandler

Contoh Java 8-compatible:

```java
package com.acme.persistence.mybatis.type;

import com.acme.caseapp.domain.CaseStatus;
import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;
import org.apache.ibatis.type.MappedJdbcTypes;
import org.apache.ibatis.type.MappedTypes;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

@MappedTypes(CaseStatus.class)
@MappedJdbcTypes(JdbcType.VARCHAR)
public final class CaseStatusTypeHandler extends BaseTypeHandler<CaseStatus> {

    @Override
    public void setNonNullParameter(
            PreparedStatement ps,
            int i,
            CaseStatus parameter,
            JdbcType jdbcType
    ) throws SQLException {
        ps.setString(i, parameter.code());
    }

    @Override
    public CaseStatus getNullableResult(ResultSet rs, String columnName) throws SQLException {
        String code = rs.getString(columnName);
        return toStatus(code);
    }

    @Override
    public CaseStatus getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        String code = rs.getString(columnIndex);
        return toStatus(code);
    }

    @Override
    public CaseStatus getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        String code = cs.getString(columnIndex);
        return toStatus(code);
    }

    private CaseStatus toStatus(String code) {
        if (code == null) {
            return null;
        }
        return CaseStatus.fromCode(code);
    }
}
```

XML usage:

```xml
<resultMap id="caseRowMap" type="com.acme.caseapp.CaseRow">
  <id property="id" column="id" />
  <result property="status"
          column="status_code"
          typeHandler="com.acme.persistence.mybatis.type.CaseStatusTypeHandler" />
</resultMap>

<select id="findByStatus" resultMap="caseRowMap">
  SELECT id, status_code
  FROM case_record
  WHERE status_code = #{status, typeHandler=com.acme.persistence.mybatis.type.CaseStatusTypeHandler}
</select>
```

Jika handler didaftarkan global, XML bisa lebih ringkas:

```xml
<result property="status" column="status_code" />
```

Namun ringkas tidak selalu lebih aman. Untuk field yang penting, explicit mapping sering lebih mudah direview.

---

## 9. Generic CodeEnum TypeHandler: Powerful, tetapi Hati-Hati

Di banyak sistem, banyak enum punya pola sama:

```java
public interface CodeEnum {
    String code();
}
```

```java
public enum CaseStatus implements CodeEnum {
    DRAFT("DRAFT"), SUBMITTED("SUB"), APPROVED("APP");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    @Override
    public String code() {
        return code;
    }
}
```

Kita bisa membuat base handler generic:

```java
public abstract class AbstractCodeEnumTypeHandler<E extends Enum<E> & CodeEnum>
        extends BaseTypeHandler<E> {

    private final Class<E> enumType;

    protected AbstractCodeEnumTypeHandler(Class<E> enumType) {
        this.enumType = enumType;
    }

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, E parameter, JdbcType jdbcType)
            throws SQLException {
        ps.setString(i, parameter.code());
    }

    @Override
    public E getNullableResult(ResultSet rs, String columnName) throws SQLException {
        return fromCode(rs.getString(columnName));
    }

    @Override
    public E getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        return fromCode(rs.getString(columnIndex));
    }

    @Override
    public E getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        return fromCode(cs.getString(columnIndex));
    }

    private E fromCode(String code) {
        if (code == null) {
            return null;
        }
        for (E value : enumType.getEnumConstants()) {
            if (value.code().equals(code)) {
                return value;
            }
        }
        throw new IllegalArgumentException(
                "Unknown code '" + code + "' for enum " + enumType.getName()
        );
    }
}
```

Concrete handler:

```java
@MappedTypes(CaseStatus.class)
@MappedJdbcTypes(JdbcType.VARCHAR)
public final class CaseStatusTypeHandler extends AbstractCodeEnumTypeHandler<CaseStatus> {
    public CaseStatusTypeHandler() {
        super(CaseStatus.class);
    }
}
```

Keuntungan:

- logic mapping konsisten;
- mudah diuji;
- mengurangi copy-paste;
- setiap enum tetap punya concrete handler yang jelas.

Risiko:

- terlalu generic bisa menyembunyikan behavior spesifik;
- unknown code policy mungkin beda per enum;
- legacy code alias mungkin perlu special case;
- error message harus cukup jelas.

---

## 10. Unknown Code Policy

Apa yang harus dilakukan jika DB berisi kode yang tidak dikenal?

Pilihan umum:

| Policy | Behavior | Cocok untuk |
|---|---|---|
| Fail fast | throw exception | data harus ketat, corruption harus terlihat |
| Return `UNKNOWN` enum | toleran | legacy/integration data |
| Return raw wrapper | preserve unknown | migration/reporting |
| Log and return null | tidak disarankan | bisa menyembunyikan bug |

Contoh fail fast:

```java
throw new IllegalArgumentException("Unknown CaseStatus code: " + code);
```

Contoh unknown enum:

```java
public enum ExternalDecisionCode implements CodeEnum {
    APPROVED("A"),
    REJECTED("R"),
    UNKNOWN("?");

    // fromCode returns UNKNOWN if not found
}
```

Untuk regulatory system, jangan otomatis memilih `UNKNOWN` hanya agar aplikasi tidak error. Kadang lebih defensible untuk gagal cepat agar data corruption tidak diam-diam masuk ke laporan, enforcement decision, atau audit trail.

Decision rule:

```text
Jika field mempengaruhi keputusan hukum, status lifecycle, authorization, atau SLA:
  prefer fail fast atau explicit unknown handling yang terlihat.

Jika field berasal dari external non-critical feed:
  boleh pakai UNKNOWN, tetapi harus observable.
```

---

## 11. Null Handling: Bagian yang Sering Diremehkan

Sejak MyBatis 3.5.0, `BaseTypeHandler` tidak otomatis memanggil `ResultSet.wasNull()` atau `CallableStatement.wasNull()` untuk subclass. Artinya custom handler harus sadar sendiri bagaimana menangani SQL `NULL`.

Untuk `String` read:

```java
String code = rs.getString(columnName);
if (code == null) {
    return null;
}
```

Untuk primitive-like read misalnya `int`:

```java
int value = rs.getInt(columnName);
if (rs.wasNull()) {
    return null;
}
return SomeValue.of(value);
```

Kenapa penting?

Karena JDBC method seperti `getInt()` mengembalikan `0` saat SQL NULL, sehingga tanpa `wasNull()`, NULL bisa berubah menjadi nilai valid palsu.

Contoh bug:

```java
int score = rs.getInt("risk_score");
return RiskScore.of(score);
```

Jika `risk_score` NULL, `score` menjadi `0`. Apakah `0` berarti “no risk”, “not assessed”, atau “unknown”? Bug seperti ini bisa mempengaruhi keputusan workflow.

Rule:

```text
Untuk tipe reference/string/object:
  cek null langsung.

Untuk JDBC primitive getter seperti getInt/getLong/getBoolean:
  gunakan wasNull() jika null valid secara schema.
```

---

## 12. `jdbcType` untuk Nullable Parameter

Saat menulis parameter null, JDBC sering butuh informasi tipe kolom.

Contoh:

```xml
UPDATE case_record
SET closed_reason = #{closedReason, jdbcType=VARCHAR}
WHERE id = #{id}
```

Tanpa `jdbcType`, driver tertentu bisa gagal saat `closedReason == null` karena `PreparedStatement.setNull()` butuh SQL type.

Prinsip:

```text
Jika parameter bisa null dan dikirim ke DB:
  tentukan jdbcType secara eksplisit.
```

Terutama untuk:

- Oracle;
- stored procedure;
- nullable CLOB/BLOB;
- nullable numeric;
- nullable date/time;
- custom TypeHandler;
- vendor-specific type.

---

## 13. Registration Pattern

### 13.1 XML Configuration

```xml
<configuration>
  <typeHandlers>
    <typeHandler javaType="com.acme.caseapp.domain.CaseStatus"
                 jdbcType="VARCHAR"
                 handler="com.acme.persistence.mybatis.type.CaseStatusTypeHandler"/>
  </typeHandlers>
</configuration>
```

### 13.2 Package Scan in Spring Boot

```yaml
mybatis:
  type-handlers-package: com.acme.persistence.mybatis.type
```

### 13.3 Java Configuration Customizer

```java
@Bean
ConfigurationCustomizer mybatisTypeHandlerCustomizer() {
    return configuration -> {
        configuration.getTypeHandlerRegistry()
            .register(CaseStatus.class, JdbcType.VARCHAR, new CaseStatusTypeHandler());
    };
}
```

### 13.4 Explicit XML Mapping

```xml
<result property="status"
        column="status_code"
        typeHandler="com.acme.persistence.mybatis.type.CaseStatusTypeHandler" />
```

### 13.5 Which One Should We Use?

| Strategy | Kelebihan | Risiko | Cocok untuk |
|---|---|---|---|
| XML explicit | paling jelas di mapper | verbose | field kritis |
| global registration | ringkas | hidden mapping | handler umum |
| package scan | mudah Boot setup | scan terlalu luas | aplikasi terkontrol |
| Java customizer | eksplisit programmatic | boilerplate | multi-datasource/config kompleks |

Untuk codebase besar:

```text
Gunakan package registration untuk handler standar,
tetapi tetap explicit di XML untuk field riskan seperti status lifecycle, JSON, encrypted value, CLOB, vendor-specific type.
```

---

## 14. Value Object Mapping

Daripada memakai `String` untuk semua hal, domain yang matang sering memakai value object.

Contoh:

```java
public final class CaseNumber {
    private final String value;

    private CaseNumber(String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("CaseNumber must not be blank");
        }
        this.value = value;
    }

    public static CaseNumber of(String value) {
        return new CaseNumber(value);
    }

    public String value() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }
}
```

Handler:

```java
@MappedTypes(CaseNumber.class)
@MappedJdbcTypes(JdbcType.VARCHAR)
public final class CaseNumberTypeHandler extends BaseTypeHandler<CaseNumber> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, CaseNumber parameter, JdbcType jdbcType)
            throws SQLException {
        ps.setString(i, parameter.value());
    }

    @Override
    public CaseNumber getNullableResult(ResultSet rs, String columnName) throws SQLException {
        return ofNullable(rs.getString(columnName));
    }

    @Override
    public CaseNumber getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        return ofNullable(rs.getString(columnIndex));
    }

    @Override
    public CaseNumber getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        return ofNullable(cs.getString(columnIndex));
    }

    private CaseNumber ofNullable(String value) {
        return value == null ? null : CaseNumber.of(value);
    }
}
```

Keuntungan:

- tidak semua `String` dianggap sama;
- invalid data terlihat cepat;
- mapper contract lebih semantik;
- service layer lebih aman;
- refactoring lebih terkendali.

Risiko:

- terlalu banyak value object bisa menambah noise;
- constructor validation bisa mematahkan read legacy data;
- serialization DTO perlu dipikirkan;
- query criteria object perlu jelas.

Pattern yang sehat:

```text
Gunakan value object untuk identifier, code, amount, dan field yang punya invariant kuat.
Jangan value-object-kan semua kolom tanpa alasan.
```

---

## 15. Money Mapping

Uang tidak boleh dianggap sekadar `BigDecimal` tanpa konteks.

Minimal ada dua representasi:

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;
}
```

Schema bisa berupa:

```sql
amount        NUMBER(19, 4)
currency_code VARCHAR2(3)
```

Pertanyaan desain:

- Apakah `Money` dimapping dari satu kolom atau dua kolom?
- Jika dua kolom, apakah `TypeHandler` cocok?
- Apakah lebih baik pakai resultMap constructor mapping?

`TypeHandler` biasanya cocok untuk **satu kolom ke satu value object**.

Contoh single-column amount:

```java
public final class Amount {
    private final BigDecimal value;

    public static Amount of(BigDecimal value) {
        if (value == null) {
            throw new IllegalArgumentException("Amount must not be null");
        }
        return new Amount(value);
    }

    private Amount(BigDecimal value) {
        this.value = value;
    }

    public BigDecimal value() {
        return value;
    }
}
```

Handler:

```java
@MappedTypes(Amount.class)
@MappedJdbcTypes(JdbcType.DECIMAL)
public final class AmountTypeHandler extends BaseTypeHandler<Amount> {
    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, Amount parameter, JdbcType jdbcType)
            throws SQLException {
        ps.setBigDecimal(i, parameter.value());
    }

    @Override
    public Amount getNullableResult(ResultSet rs, String columnName) throws SQLException {
        BigDecimal value = rs.getBigDecimal(columnName);
        return value == null ? null : Amount.of(value);
    }

    @Override
    public Amount getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        BigDecimal value = rs.getBigDecimal(columnIndex);
        return value == null ? null : Amount.of(value);
    }

    @Override
    public Amount getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        BigDecimal value = cs.getBigDecimal(columnIndex);
        return value == null ? null : Amount.of(value);
    }
}
```

Untuk `Money(amount, currency)`, lebih baik:

```xml
<resultMap id="invoiceAmountMap" type="com.acme.InvoiceAmountRow">
  <result property="amount" column="amount" />
  <result property="currencyCode" column="currency_code" />
</resultMap>
```

atau constructor mapping ke DTO, lalu domain assembly di service/domain layer.

Jangan memaksa `TypeHandler` membaca dua kolom dari `ResultSet` untuk membuat satu object. Secara teknis bisa diakali, tetapi tidak selaras dengan model MyBatis TypeHandler yang normalnya berbasis satu column/property mapping.

---

## 16. Boolean dan Flag Vendor-Specific

Tidak semua database punya boolean native yang sama.

Representasi umum:

| DB Column | Java | Contoh |
|---|---|---|
| `CHAR(1)` | `Boolean` | `Y` / `N` |
| `NUMBER(1)` | `Boolean` | `1` / `0` |
| `VARCHAR` | enum | `YES` / `NO` / `UNKNOWN` |
| native boolean | `Boolean` | PostgreSQL |

Handler `Y/N`:

```java
@MappedTypes(Boolean.class)
@MappedJdbcTypes(JdbcType.CHAR)
public final class YesNoBooleanTypeHandler extends BaseTypeHandler<Boolean> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, Boolean parameter, JdbcType jdbcType)
            throws SQLException {
        ps.setString(i, parameter ? "Y" : "N");
    }

    @Override
    public Boolean getNullableResult(ResultSet rs, String columnName) throws SQLException {
        return parse(rs.getString(columnName));
    }

    @Override
    public Boolean getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        return parse(rs.getString(columnIndex));
    }

    @Override
    public Boolean getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        return parse(cs.getString(columnIndex));
    }

    private Boolean parse(String value) {
        if (value == null) {
            return null;
        }
        switch (value) {
            case "Y": return Boolean.TRUE;
            case "N": return Boolean.FALSE;
            default: throw new IllegalArgumentException("Invalid Y/N boolean value: " + value);
        }
    }
}
```

Namun hati-hati jika mendaftarkan handler ini global untuk `Boolean.class + CHAR`, karena bisa mempengaruhi semua boolean CHAR. Dalam codebase besar, lebih aman pakai value object atau explicit mapping untuk kolom legacy.

---

## 17. JSON Column Mapping

JSON column sering menggoda karena fleksibel. Tetapi tanpa disiplin, ia berubah menjadi “schema gelap” di dalam database.

Pertanyaan sebelum membuat JSON `TypeHandler`:

- Apakah JSON hanya snapshot read-only?
- Apakah field di dalam JSON perlu difilter/query?
- Apakah perlu index JSON path?
- Apakah schema JSON versioned?
- Apakah backward-compatible saat DTO berubah?
- Apakah JSON mengandung PII?
- Apakah parsing failure harus fail-fast?
- Apakah field unknown harus dipertahankan?

### 17.1 JSON sebagai Snapshot Value

Contoh domain DTO:

```java
public final class ApplicantSnapshot {
    private String name;
    private String idNumber;
    private String nationality;

    public ApplicantSnapshot() {
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getIdNumber() {
        return idNumber;
    }

    public void setIdNumber(String idNumber) {
        this.idNumber = idNumber;
    }

    public String getNationality() {
        return nationality;
    }

    public void setNationality(String nationality) {
        this.nationality = nationality;
    }
}
```

Handler dengan Jackson:

```java
@MappedTypes(ApplicantSnapshot.class)
@MappedJdbcTypes(JdbcType.VARCHAR)
public final class ApplicantSnapshotJsonTypeHandler extends BaseTypeHandler<ApplicantSnapshot> {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper()
            .findAndRegisterModules();

    @Override
    public void setNonNullParameter(
            PreparedStatement ps,
            int i,
            ApplicantSnapshot parameter,
            JdbcType jdbcType
    ) throws SQLException {
        ps.setString(i, toJson(parameter));
    }

    @Override
    public ApplicantSnapshot getNullableResult(ResultSet rs, String columnName) throws SQLException {
        return fromJson(rs.getString(columnName));
    }

    @Override
    public ApplicantSnapshot getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        return fromJson(rs.getString(columnIndex));
    }

    @Override
    public ApplicantSnapshot getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        return fromJson(cs.getString(columnIndex));
    }

    private String toJson(ApplicantSnapshot value) throws SQLException {
        try {
            return OBJECT_MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new SQLException("Failed to serialize ApplicantSnapshot to JSON", e);
        }
    }

    private ApplicantSnapshot fromJson(String json) throws SQLException {
        if (json == null || json.trim().isEmpty()) {
            return null;
        }
        try {
            return OBJECT_MAPPER.readValue(json, ApplicantSnapshot.class);
        } catch (IOException e) {
            throw new SQLException("Failed to deserialize ApplicantSnapshot JSON", e);
        }
    }
}
```

### 17.2 JSON Handler Design Rules

```text
1. Jangan simpan object graph besar tanpa alasan.
2. Jangan gunakan JSON column untuk field yang sering difilter kecuali DB punya JSON index strategy.
3. Jangan silently ignore parse error untuk data critical.
4. Version-kan JSON jika shape-nya bisa berubah.
5. Jangan log JSON penuh jika mengandung PII.
6. Hindari ObjectMapper baru per row.
7. Buat test backward compatibility JSON.
```

---

## 18. PostgreSQL JSONB Mapping

PostgreSQL memiliki `jsonb`. Driver PostgreSQL sering memakai `PGobject` untuk tipe khusus.

Contoh handler konseptual:

```java
public final class JsonbTypeHandler<T> extends BaseTypeHandler<T> {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper().findAndRegisterModules();
    private final Class<T> type;

    public JsonbTypeHandler(Class<T> type) {
        this.type = type;
    }

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, T parameter, JdbcType jdbcType)
            throws SQLException {
        PGobject jsonObject = new PGobject();
        jsonObject.setType("jsonb");
        jsonObject.setValue(toJson(parameter));
        ps.setObject(i, jsonObject);
    }

    @Override
    public T getNullableResult(ResultSet rs, String columnName) throws SQLException {
        return fromObject(rs.getObject(columnName));
    }

    @Override
    public T getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        return fromObject(rs.getObject(columnIndex));
    }

    @Override
    public T getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        return fromObject(cs.getObject(columnIndex));
    }

    private T fromObject(Object value) throws SQLException {
        if (value == null) {
            return null;
        }
        return fromJson(value.toString());
    }

    private String toJson(T value) throws SQLException {
        try {
            return OBJECT_MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new SQLException("Failed to serialize JSONB", e);
        }
    }

    private T fromJson(String json) throws SQLException {
        try {
            return OBJECT_MAPPER.readValue(json, type);
        } catch (IOException e) {
            throw new SQLException("Failed to deserialize JSONB", e);
        }
    }
}
```

Catatan:

- Generic handler dengan constructor parameter tidak selalu mudah dipakai via package scan.
- Sering lebih praktis membuat concrete handler per JSON type.
- Hindari dependency PostgreSQL-specific class jika module harus database-agnostic.
- Jika module memang PostgreSQL-specific, buat package vendor boundary yang jelas.

---

## 19. Oracle CLOB JSON Mapping

Oracle sering memakai `CLOB` untuk payload besar, termasuk JSON di sistem lama.

Risiko utama:

- memory besar saat baca semua CLOB;
- driver behavior berbeda;
- conversion ke `String` bisa mahal;
- logging payload sangat berbahaya;
- update CLOB dalam batch bisa berat;
- audit trail CLOB bisa mendominasi storage.

Handler sederhana untuk CLOB ke JSON object:

```java
@MappedTypes(ApplicantSnapshot.class)
@MappedJdbcTypes(JdbcType.CLOB)
public final class ApplicantSnapshotClobTypeHandler extends BaseTypeHandler<ApplicantSnapshot> {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper().findAndRegisterModules();

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, ApplicantSnapshot parameter, JdbcType jdbcType)
            throws SQLException {
        ps.setString(i, toJson(parameter));
    }

    @Override
    public ApplicantSnapshot getNullableResult(ResultSet rs, String columnName) throws SQLException {
        Clob clob = rs.getClob(columnName);
        return fromClob(clob);
    }

    @Override
    public ApplicantSnapshot getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        Clob clob = rs.getClob(columnIndex);
        return fromClob(clob);
    }

    @Override
    public ApplicantSnapshot getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        Clob clob = cs.getClob(columnIndex);
        return fromClob(clob);
    }

    private ApplicantSnapshot fromClob(Clob clob) throws SQLException {
        if (clob == null) {
            return null;
        }
        long length = clob.length();
        if (length > Integer.MAX_VALUE) {
            throw new SQLException("CLOB too large to materialize safely: " + length);
        }
        String json = clob.getSubString(1, (int) length);
        return fromJson(json);
    }

    private String toJson(ApplicantSnapshot value) throws SQLException {
        try {
            return OBJECT_MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new SQLException("Failed to serialize ApplicantSnapshot", e);
        }
    }

    private ApplicantSnapshot fromJson(String json) throws SQLException {
        if (json == null || json.trim().isEmpty()) {
            return null;
        }
        try {
            return OBJECT_MAPPER.readValue(json, ApplicantSnapshot.class);
        } catch (IOException e) {
            throw new SQLException("Failed to deserialize ApplicantSnapshot", e);
        }
    }
}
```

Untuk large audit/reporting, jangan selalu map CLOB ke object. Kadang lebih baik:

- list query tidak select CLOB;
- detail query select CLOB;
- export memakai streaming/cursor;
- CLOB parsing dilakukan hanya jika benar-benar dibutuhkan.

---

## 20. Array Mapping

Array mapping sangat vendor-specific.

### 20.1 PostgreSQL Text Array

Contoh column:

```sql
tags text[]
```

Java:

```java
private List<String> tags;
```

Handler konseptual:

```java
@MappedTypes(List.class)
@MappedJdbcTypes(JdbcType.ARRAY)
public final class StringListArrayTypeHandler extends BaseTypeHandler<List<String>> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, List<String> parameter, JdbcType jdbcType)
            throws SQLException {
        Array array = ps.getConnection().createArrayOf("text", parameter.toArray(new String[0]));
        ps.setArray(i, array);
    }

    @Override
    public List<String> getNullableResult(ResultSet rs, String columnName) throws SQLException {
        return toList(rs.getArray(columnName));
    }

    @Override
    public List<String> getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        return toList(rs.getArray(columnIndex));
    }

    @Override
    public List<String> getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        return toList(cs.getArray(columnIndex));
    }

    private List<String> toList(Array array) throws SQLException {
        if (array == null) {
            return null;
        }
        Object raw = array.getArray();
        if (raw instanceof String[]) {
            return Arrays.asList((String[]) raw);
        }
        Object[] values = (Object[]) raw;
        List<String> result = new ArrayList<String>(values.length);
        for (Object value : values) {
            result.add(value == null ? null : value.toString());
        }
        return result;
    }
}
```

Risiko:

- generic `List.class` registration bisa terlalu luas;
- element type hilang karena type erasure;
- better buat wrapper `TagList` daripada `List<String>` mentah.

Wrapper:

```java
public final class TagList {
    private final List<String> values;

    public TagList(List<String> values) {
        this.values = Collections.unmodifiableList(new ArrayList<String>(values));
    }

    public List<String> values() {
        return values;
    }
}
```

Lebih aman:

```text
TagList + TagListArrayTypeHandler
```

daripada:

```text
List<String> + global List TypeHandler
```

---

## 21. Encrypted Field TypeHandler

Kadang field disimpan terenkripsi di DB.

Contoh:

```java
public final class EncryptedIdNumber {
    private final String plainText;

    private EncryptedIdNumber(String plainText) {
        this.plainText = plainText;
    }

    public static EncryptedIdNumber ofPlainText(String value) {
        return new EncryptedIdNumber(value);
    }

    public String plainText() {
        return plainText;
    }
}
```

Handler bisa mengenkripsi saat write dan decrypt saat read. Tetapi ini sangat sensitif.

Design rules:

```text
1. Jangan hardcode key di TypeHandler.
2. Jangan log plaintext/ciphertext.
3. Jangan inject service berat sembarangan.
4. Pastikan deterministic vs non-deterministic encryption jelas.
5. Jika field perlu equality search, desain cryptographic model-nya dulu.
6. Failure decrypt harus observable.
7. Pertimbangkan key rotation.
8. Pastikan masking di DTO/API/logging tetap terpisah.
```

Secara praktik, TypeHandler dengan dependency ke crypto service sulit jika diinstansiasi oleh MyBatis via no-args constructor. Dengan Spring Boot, registration programmatic via `ConfigurationCustomizer` bisa membantu.

Contoh konseptual:

```java
@Bean
ConfigurationCustomizer encryptedTypeHandlerCustomizer(CryptoService cryptoService) {
    return configuration -> configuration.getTypeHandlerRegistry()
        .register(EncryptedIdNumber.class, JdbcType.VARCHAR,
                  new EncryptedIdNumberTypeHandler(cryptoService));
}
```

Tapi hati-hati: semakin kompleks dependency handler, semakin besar risiko hidden behavior. Untuk field sensitif, biasanya perlu design review khusus.

---

## 22. Masked Value vs Encrypted Value

Jangan samakan masking dan encryption.

| Concern | Lokasi umum | Tujuan |
|---|---|---|
| Encryption | persistence/storage boundary | melindungi data at rest |
| Masking | response/log/UI boundary | membatasi exposure |
| Hashing | lookup/integrity boundary | compare tanpa plaintext |
| Tokenization | integration/security boundary | mengganti data sensitif dengan token |

`TypeHandler` bisa cocok untuk encryption storage representation. Tetapi masking response sebaiknya tidak dilakukan di TypeHandler, karena:

- service mungkin butuh plaintext untuk logic legitimate;
- audit/reporting mungkin punya rule berbeda;
- masking bergantung role/user/context;
- TypeHandler tidak punya konteks authorization yang sehat.

---

## 23. Vendor-Specific Type Boundary

Database vendor punya tipe khusus:

- Oracle `CLOB`, `BLOB`, `STRUCT`, `ARRAY`, `NUMBER`, `TIMESTAMP WITH TIME ZONE`;
- PostgreSQL `jsonb`, `uuid`, `inet`, `array`, `enum`;
- MySQL `json`, `bit`, `set`, `enum`;
- SQL Server `uniqueidentifier`, `xml`, `datetimeoffset`.

Pertanyaan utama:

```text
Apakah aplikasi ingin database-agnostic,
atau memang menerima vendor-specific persistence layer?
```

Jika database-agnostic:

- isolasi handler vendor-specific di package khusus;
- hindari vendor driver class di domain/application layer;
- gunakan interface/wrapper semantik;
- buat test per vendor jika mendukung multi DB.

Jika vendor-specific:

- jangan pura-pura portable;
- tulis eksplisit di mapper dan dokumentasi;
- optimalkan sesuai vendor;
- pastikan migration/runbook tahu ketergantungan vendor.

---

## 24. UUID Mapping

UUID bisa direpresentasikan sebagai:

| DB Representation | Java | Catatan |
|---|---|---|
| PostgreSQL `uuid` | `UUID` | native, bagus |
| `CHAR(36)` | `UUID` | portable, lebih besar |
| `RAW(16)` / binary | `UUID` | compact, butuh handler |
| `VARCHAR(36)` | `UUID` | mudah dibaca |

Contoh binary UUID handler:

```java
@MappedTypes(UUID.class)
@MappedJdbcTypes(JdbcType.BINARY)
public final class BinaryUuidTypeHandler extends BaseTypeHandler<UUID> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, UUID parameter, JdbcType jdbcType)
            throws SQLException {
        ByteBuffer buffer = ByteBuffer.allocate(16);
        buffer.putLong(parameter.getMostSignificantBits());
        buffer.putLong(parameter.getLeastSignificantBits());
        ps.setBytes(i, buffer.array());
    }

    @Override
    public UUID getNullableResult(ResultSet rs, String columnName) throws SQLException {
        return fromBytes(rs.getBytes(columnName));
    }

    @Override
    public UUID getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        return fromBytes(rs.getBytes(columnIndex));
    }

    @Override
    public UUID getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        return fromBytes(cs.getBytes(columnIndex));
    }

    private UUID fromBytes(byte[] bytes) throws SQLException {
        if (bytes == null) {
            return null;
        }
        if (bytes.length != 16) {
            throw new SQLException("Invalid UUID binary length: " + bytes.length);
        }
        ByteBuffer buffer = ByteBuffer.wrap(bytes);
        return new UUID(buffer.getLong(), buffer.getLong());
    }
}
```

Caveat:

- byte order harus konsisten;
- migration antar DB perlu jelas;
- index locality UUID random bisa buruk;
- UUIDv7/ordered UUID bisa jadi pertimbangan modern, tetapi itu keputusan identifier strategy, bukan TypeHandler saja.

---

## 25. Date/Time TypeHandler: Jangan Sembunyikan Time Zone Bug

Java modern punya:

- `LocalDate`;
- `LocalTime`;
- `LocalDateTime`;
- `Instant`;
- `OffsetDateTime`;
- `ZonedDateTime`.

Database punya:

- `DATE`;
- `TIME`;
- `TIMESTAMP`;
- `TIMESTAMP WITH TIME ZONE`;
- vendor-specific semantics.

Danger zone:

```text
LocalDateTime != Instant
TIMESTAMP without timezone != absolute time
database session timezone can affect interpretation
```

Mapping guideline:

| Meaning | Java Type | DB Type |
|---|---|---|
| tanggal kalender | `LocalDate` | `DATE` |
| waktu lokal tanpa zona | `LocalTime` | `TIME` |
| waktu lokal kejadian | `LocalDateTime` | `TIMESTAMP` |
| waktu absolut | `Instant` | `TIMESTAMP` convention UTC / with timezone |
| waktu dengan offset | `OffsetDateTime` | `TIMESTAMP WITH TIME ZONE` jika didukung |

Jangan membuat custom TypeHandler untuk “memperbaiki” time zone tanpa desain sistem. Tentukan dulu invariant:

```text
Semua persisted instant disimpan UTC?
DB session timezone dikunci?
API menerima offset atau local time?
Audit timestamp memakai DB time atau app time?
```

---

## 26. TypeHandler untuk Domain ID

Di codebase besar, ID sering lebih aman jika tidak semua `Long` dianggap sama.

```java
public final class CaseId {
    private final Long value;

    private CaseId(Long value) {
        if (value == null || value <= 0) {
            throw new IllegalArgumentException("Invalid CaseId: " + value);
        }
        this.value = value;
    }

    public static CaseId of(Long value) {
        return new CaseId(value);
    }

    public Long value() {
        return value;
    }
}
```

Handler:

```java
@MappedTypes(CaseId.class)
@MappedJdbcTypes(JdbcType.BIGINT)
public final class CaseIdTypeHandler extends BaseTypeHandler<CaseId> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, CaseId parameter, JdbcType jdbcType)
            throws SQLException {
        ps.setLong(i, parameter.value());
    }

    @Override
    public CaseId getNullableResult(ResultSet rs, String columnName) throws SQLException {
        long value = rs.getLong(columnName);
        return rs.wasNull() ? null : CaseId.of(value);
    }

    @Override
    public CaseId getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        long value = rs.getLong(columnIndex);
        return rs.wasNull() ? null : CaseId.of(value);
    }

    @Override
    public CaseId getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        long value = cs.getLong(columnIndex);
        return cs.wasNull() ? null : CaseId.of(value);
    }
}
```

Benefit:

- method signature lebih aman:

```java
CaseRow findById(CaseId caseId);
```

daripada:

```java
CaseRow findById(Long id);
```

- tidak tertukar antara `CaseId`, `UserId`, `ApplicationId`;
- lebih jelas untuk API internal.

Trade-off:

- mapper XML lebih verbose jika belum global registered;
- JSON serialization perlu dukungan;
- DTO boundary harus disepakati;
- untuk query ad-hoc/reporting, wrapper ID bisa terasa berat.

---

## 27. TypeHandler dan Dynamic SQL Library

Dalam MyBatis Dynamic SQL, column metadata bisa membawa `jdbcType` dan `typeHandler`.

Contoh konseptual:

```java
public final class CaseRecordDynamicSqlSupport {
    public static final CaseRecord caseRecord = new CaseRecord();
    public static final SqlColumn<Long> id = caseRecord.id;
    public static final SqlColumn<CaseStatus> status = caseRecord.status;

    public static final class CaseRecord extends SqlTable {
        public final SqlColumn<Long> id = column("id", JDBCType.BIGINT);
        public final SqlColumn<CaseStatus> status = column(
                "status_code",
                JDBCType.VARCHAR,
                "com.acme.persistence.mybatis.type.CaseStatusTypeHandler"
        );

        public CaseRecord() {
            super("case_record");
        }
    }
}
```

Keuntungan:

- handler dekat dengan column definition;
- query DSL tidak perlu ulang mapping;
- lebih type-safe dibanding stringly XML.

Risiko:

- class metadata menjadi panjang;
- type handler class name string bisa rapuh;
- generic handler lebih sulit;
- vendor-specific handler masuk ke DSL metadata.

Rule:

```text
Untuk Dynamic SQL, perlakukan SqlColumn metadata sebagai schema contract.
Jangan asal generate tanpa review tipe domain dan handler.
```

---

## 28. TypeHandler dan ResultMap: Explicit vs Implicit

Misalnya handler sudah global registered.

Kita bisa menulis:

```xml
<result property="status" column="status_code" />
```

Atau:

```xml
<result property="status"
        column="status_code"
        javaType="com.acme.caseapp.domain.CaseStatus"
        jdbcType="VARCHAR"
        typeHandler="com.acme.persistence.mybatis.type.CaseStatusTypeHandler" />
```

Mana yang benar?

Jawabannya tergantung risiko.

| Field | Rekomendasi |
|---|---|
| simple scalar | implicit OK |
| domain status penting | explicit lebih baik |
| enum lifecycle | explicit lebih baik |
| JSON | explicit wajib/strongly recommended |
| CLOB/BLOB | explicit wajib/strongly recommended |
| encrypted | explicit wajib |
| vendor-specific | explicit wajib |
| nullable primitive-like | explicit `jdbcType` penting |

Dalam codebase besar, explicit mapping adalah bentuk dokumentasi operasional.

---

## 29. Anti-Pattern: One Handler to Rule Them All

Contoh buruk:

```java
public final class UniversalJsonTypeHandler extends BaseTypeHandler<Object> {
    // parse everything into Map or Object
}
```

Masalah:

- kehilangan tipe compile-time;
- JSON shape tidak jelas;
- parsing runtime risk;
- result object menjadi `Map` liar;
- schema evolution tidak terkontrol;
- security review sulit;
- test sulit spesifik.

Lebih baik:

```text
ApplicantSnapshotJsonTypeHandler
DecisionPayloadJsonTypeHandler
AuditMetadataJsonTypeHandler
NotificationRequestJsonTypeHandler
```

Walaupun lebih banyak file, contract lebih jelas.

---

## 30. Anti-Pattern: Enum Ordinal

Contoh:

```xml
<typeHandler javaType="com.acme.CaseStatus"
             handler="org.apache.ibatis.type.EnumOrdinalTypeHandler" />
```

Masalah:

- ordinal berubah jika enum order berubah;
- data DB tidak readable;
- migration sulit;
- audit trail ambigu;
- reporting external sulit.

Kecuali ada alasan kuat dan immutable enum contract, hindari ordinal untuk enterprise system.

Untuk status, decision, workflow state, regulatory type: gunakan code eksplisit.

---

## 31. Anti-Pattern: Silent Null Coercion

Contoh buruk:

```java
private RiskLevel parse(String code) {
    if (code == null) {
        return RiskLevel.LOW;
    }
    return RiskLevel.fromCode(code);
}
```

Masalah:

- NULL berubah menjadi LOW;
- missing assessment terlihat sebagai low risk;
- workflow decision bisa salah;
- audit/reporting misleading.

Lebih baik:

```java
if (code == null) {
    return null;
}
```

atau:

```java
if (code == null) {
    return RiskLevel.NOT_ASSESSED;
}
```

Tetapi hanya jika `NOT_ASSESSED` memang domain value yang eksplisit.

---

## 32. Anti-Pattern: Heavy Logic di TypeHandler

Contoh buruk:

```java
public Decision getNullableResult(ResultSet rs, String columnName) {
    String code = rs.getString(columnName);
    Decision decision = decisionService.findByCode(code);
    auditService.logRead(decision);
    return decision;
}
```

Masalah:

- query tambahan per row;
- N+1 tersembunyi;
- side effect saat mapping;
- transaction semantics kacau;
- sulit test;
- mapper read menjadi tidak pure;
- performance tidak terlihat dari SQL mapper.

TypeHandler harus pure dan deterministic sejauh mungkin:

```text
same DB value -> same Java value
same Java value -> same DB representation
```

---

## 33. Error Handling Strategy

Handler method melempar `SQLException`. Tetapi parsing bisa menghasilkan `IllegalArgumentException`, `JsonProcessingException`, dll.

Pattern yang sehat:

```java
private ApplicantSnapshot fromJson(String json) throws SQLException {
    try {
        return OBJECT_MAPPER.readValue(json, ApplicantSnapshot.class);
    } catch (IOException e) {
        throw new SQLException("Failed to parse applicant_snapshot JSON", e);
    }
}
```

Jangan:

```java
catch (Exception e) {
    return null;
}
```

Karena itu menyembunyikan data corruption.

Error message harus cukup membantu tetapi tidak bocorkan data sensitif.

Baik:

```text
Failed to parse applicant_snapshot JSON for column applicant_snapshot
```

Buruk:

```text
Failed to parse JSON: {"idNumber":"S1234567A", ...}
```

---

## 34. Observability TypeHandler

TypeHandler bukan tempat logging verbose per row. Tetapi failure-nya harus observable.

Guideline:

- jangan log setiap conversion sukses;
- jangan log plaintext sensitive value;
- error message berisi column/type context;
- metric failure bisa dipasang di higher layer;
- testing harus mencakup invalid DB value;
- SQL logging jangan expose parameter sensitif.

Untuk handler sensitif, pertimbangkan exception khusus:

```java
public final class PersistenceValueMappingException extends SQLException {
    public PersistenceValueMappingException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Namun pastikan exception translation Spring/MyBatis tetap dipahami.

---

## 35. Performance Considerations

### 35.1 ObjectMapper Reuse

Buruk:

```java
ObjectMapper mapper = new ObjectMapper(); // per row
```

Baik:

```java
private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper().findAndRegisterModules();
```

Atau inject configured ObjectMapper via custom registration.

### 35.2 Large Result Mapping

Jika query mengambil 100.000 row dan setiap row punya JSON/CLOB:

```text
100.000 rows x parse JSON
= CPU tinggi + memory pressure + GC pressure
```

Solusi:

- jangan select JSON/CLOB di listing;
- gunakan projection ringan;
- parse detail on demand;
- gunakan cursor/fetch size untuk export;
- pertimbangkan streaming parser untuk JSON besar;
- hindari nested object besar di resultMap.

### 35.3 TypeHandler Allocation

Handler sebaiknya stateless atau thread-safe.

Jangan simpan mutable state per conversion:

```java
private String lastValue; // buruk
```

Handler bisa dipakai berulang oleh MyBatis. Perlakukan sebagai singleton-like object kecuali tahu lifecycle-nya.

---

## 36. Thread Safety

Custom TypeHandler harus thread-safe.

Aman:

- stateless handler;
- immutable dependencies;
- thread-safe `ObjectMapper` setelah konfigurasi selesai;
- immutable lookup map.

Tidak aman:

- mutable field per row;
- `SimpleDateFormat` static;
- shared buffer mutable;
- cache tanpa synchronization;
- dependency yang tidak thread-safe.

Untuk Java 8 legacy, hindari `SimpleDateFormat` di handler. Gunakan `java.time` jika bisa, atau buat formatter immutable/thread-safe.

---

## 37. Testing TypeHandler

Testing handler tidak boleh hanya lewat mapper integration test. Buat unit test langsung untuk:

- null input;
- valid value;
- invalid value;
- unknown code;
- write parameter;
- read by column name;
- read by column index;
- read callable statement jika dipakai;
- JDBC primitive `wasNull` behavior;
- JSON backward compatibility;
- large payload boundary;
- vendor-specific behavior with real DB if needed.

### 37.1 Unit Test Enum Handler

Dengan Mockito-style pseudo example:

```java
@Test
void readNullStatusReturnsNull() throws Exception {
    ResultSet rs = mock(ResultSet.class);
    when(rs.getString("status_code")).thenReturn(null);

    CaseStatusTypeHandler handler = new CaseStatusTypeHandler();

    assertNull(handler.getNullableResult(rs, "status_code"));
}

@Test
void readUnknownStatusFailsFast() throws Exception {
    ResultSet rs = mock(ResultSet.class);
    when(rs.getString("status_code")).thenReturn("BAD");

    CaseStatusTypeHandler handler = new CaseStatusTypeHandler();

    assertThrows(IllegalArgumentException.class,
        () -> handler.getNullableResult(rs, "status_code"));
}
```

### 37.2 Integration Test

Unit test tidak cukup untuk vendor-specific handler:

- PostgreSQL JSONB;
- PostgreSQL array;
- Oracle CLOB;
- SQL Server `uniqueidentifier`;
- stored procedure OUT parameter.

Untuk itu gunakan real database integration test, idealnya Testcontainers jika memungkinkan.

---

## 38. TypeHandler Review Checklist

Gunakan checklist ini saat review PR:

```text
[ ] Apakah handler hanya melakukan representation mapping?
[ ] Apakah tidak ada business logic/service call/query tambahan?
[ ] Apakah null read ditangani eksplisit?
[ ] Apakah nullable primitive getter memakai wasNull()?
[ ] Apakah nullable write punya jdbcType jelas?
[ ] Apakah unknown/invalid DB value policy eksplisit?
[ ] Apakah exception tidak membocorkan PII/secrets?
[ ] Apakah handler stateless/thread-safe?
[ ] Apakah ObjectMapper/formatter tidak dibuat per row?
[ ] Apakah registration scope aman?
[ ] Apakah field kritis memakai explicit mapping?
[ ] Apakah enum tidak memakai ordinal kecuali ada alasan kuat?
[ ] Apakah JSON punya schema/version compatibility test?
[ ] Apakah CLOB/BLOB tidak ikut listing query tanpa alasan?
[ ] Apakah vendor-specific dependency terisolasi?
[ ] Apakah mapper integration test mencakup handler?
```

---

## 39. Design Matrix: Kapan Pakai TypeHandler?

| Kebutuhan | TypeHandler? | Alternatif |
|---|---:|---|
| `VARCHAR` code ke enum | Ya | manual mapping di service, kurang ideal |
| satu kolom ke value object | Ya | constructor mapping manual |
| dua kolom ke satu object | Biasanya tidak | resultMap constructor/domain assembler |
| JSON snapshot ke DTO | Ya, hati-hati | manual parse di service |
| field perlu query JSON path | Mungkin | normalized table/materialized view |
| encryption at rest | Mungkin | DB encryption, app service encryption |
| role-based masking | Tidak | API/DTO layer |
| lookup reference data | Tidak | join/query/service layer |
| complex validation | Tidak | domain/application layer |
| database vendor object | Ya, jika terisolasi | SQL/vendor adapter layer |
| stored procedure OUT custom type | Ya | manual CallableStatement handling |

---

## 40. Example: Production-Grade CaseStatus Mapping

### 40.1 Domain Enum

```java
public enum CaseStatus {
    DRAFT("DRAFT", false),
    SUBMITTED("SUB", false),
    UNDER_REVIEW("UR", false),
    APPROVED("APP", true),
    REJECTED("REJ", true),
    CLOSED("CLS", true);

    private final String code;
    private final boolean terminal;

    CaseStatus(String code, boolean terminal) {
        this.code = code;
        this.terminal = terminal;
    }

    public String code() {
        return code;
    }

    public boolean isTerminal() {
        return terminal;
    }

    public static CaseStatus fromCode(String code) {
        for (CaseStatus value : values()) {
            if (value.code.equals(code)) {
                return value;
            }
        }
        throw new IllegalArgumentException("Unknown CaseStatus code: " + code);
    }
}
```

### 40.2 TypeHandler

```java
@MappedTypes(CaseStatus.class)
@MappedJdbcTypes(JdbcType.VARCHAR)
public final class CaseStatusTypeHandler extends BaseTypeHandler<CaseStatus> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, CaseStatus parameter, JdbcType jdbcType)
            throws SQLException {
        ps.setString(i, parameter.code());
    }

    @Override
    public CaseStatus getNullableResult(ResultSet rs, String columnName) throws SQLException {
        return parse(rs.getString(columnName));
    }

    @Override
    public CaseStatus getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        return parse(rs.getString(columnIndex));
    }

    @Override
    public CaseStatus getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        return parse(cs.getString(columnIndex));
    }

    private CaseStatus parse(String code) throws SQLException {
        if (code == null) {
            return null;
        }
        try {
            return CaseStatus.fromCode(code);
        } catch (IllegalArgumentException e) {
            throw new SQLException("Invalid case status code from database", e);
        }
    }
}
```

### 40.3 Mapper XML

```xml
<resultMap id="caseSummaryMap" type="com.acme.caseapp.query.CaseSummaryRow">
  <id property="id" column="case_id" />
  <result property="caseNumber" column="case_number" />
  <result property="status"
          column="status_code"
          javaType="com.acme.caseapp.domain.CaseStatus"
          jdbcType="VARCHAR"
          typeHandler="com.acme.persistence.mybatis.type.CaseStatusTypeHandler" />
  <result property="createdAt" column="created_at" />
</resultMap>

<select id="findCaseSummaryById" resultMap="caseSummaryMap">
  SELECT
    c.id AS case_id,
    c.case_number AS case_number,
    c.status_code AS status_code,
    c.created_at AS created_at
  FROM case_record c
  WHERE c.id = #{caseId}
</select>

<update id="transitionStatus">
  UPDATE case_record
  SET
    status_code = #{toStatus,
                   javaType=com.acme.caseapp.domain.CaseStatus,
                   jdbcType=VARCHAR,
                   typeHandler=com.acme.persistence.mybatis.type.CaseStatusTypeHandler},
    updated_by = #{actorUserId},
    updated_at = CURRENT_TIMESTAMP
  WHERE id = #{caseId}
    AND status_code = #{fromStatus,
                       javaType=com.acme.caseapp.domain.CaseStatus,
                       jdbcType=VARCHAR,
                       typeHandler=com.acme.persistence.mybatis.type.CaseStatusTypeHandler}
    AND version = #{expectedVersion}
</update>
```

### 40.4 Service Interpretation

```java
int updated = caseMapper.transitionStatus(command);
if (updated == 0) {
    throw new ConcurrentCaseTransitionException(command.caseId());
}
```

Perhatikan pemisahannya:

- `TypeHandler` hanya mengubah enum ↔ code;
- mapper SQL menjaga compare-and-set transition;
- service menafsirkan rows affected;
- domain menentukan allowed transition;
- transaction boundary di service.

Ini desain yang jauh lebih bersih dibanding menyebar `"SUB"`, `"APP"`, `"REJ"` ke seluruh service.

---

## 41. Example: JSON Snapshot dengan Versioning

Masalah umum: JSON shape berubah.

Versi awal:

```json
{
  "name": "Alice",
  "idNumber": "S1234567A"
}
```

Versi baru:

```json
{
  "schemaVersion": 2,
  "name": "Alice",
  "identity": {
    "type": "NRIC",
    "number": "S1234567A"
  }
}
```

Kalau handler langsung parse ke DTO v2, data lama bisa gagal.

Pattern lebih aman:

```java
public final class ApplicantSnapshotEnvelope {
    private int schemaVersion;
    private JsonNode payload;
}
```

Atau buat deserializer backward-compatible.

Guideline:

```text
Jika JSON persisted lebih lama dari satu release,
perlakukan JSON sebagai schema yang harus versioned.
```

TypeHandler tidak boleh menjadi tempat migration kompleks, tetapi boleh memanggil parser yang sadar versi. Migration besar tetap sebaiknya dilakukan dengan data migration script yang eksplisit.

---

## 42. Multi-Datasource Consideration

Jika aplikasi punya banyak datasource:

```text
mainDataSource
reportingDataSource
archiveDataSource
```

Masing-masing bisa punya `SqlSessionFactory`. TypeHandler registration harus jelas per factory.

Risiko:

- handler hanya registered di main factory;
- reporting mapper gagal saat read;
- archive DB punya representation berbeda;
- package scan terlalu luas;
- vendor-specific handler masuk factory yang salah.

Pattern:

```java
@Bean
SqlSessionFactory mainSqlSessionFactory(
        @Qualifier("mainDataSource") DataSource dataSource,
        CaseStatusTypeHandler caseStatusTypeHandler
) {
    SqlSessionFactoryBean bean = new SqlSessionFactoryBean();
    bean.setDataSource(dataSource);
    bean.setTypeHandlers(new TypeHandler[] { caseStatusTypeHandler });
    // ...
    return bean.getObject();
}
```

Untuk multi-vendor, jangan gunakan satu package scan vendor-specific untuk semua factory.

---

## 43. Java 8 sampai Java 25 Considerations

### Java 8

- gunakan POJO/value object biasa;
- tidak ada record;
- `java.time` sudah tersedia;
- hindari API modern seperti `List.of`;
- hati-hati dengan module split legacy.

### Java 11

- tidak banyak perubahan khusus TypeHandler;
- runtime lebih modern;
- masih cocok untuk POJO immutable.

### Java 17

- baseline umum untuk Spring Boot 3;
- record bisa dipakai untuk DTO, tetapi TypeHandler tetap biasanya mapping satu value;
- sealed interface bisa berguna untuk domain state, tetapi mapping polymorphic perlu desain.

### Java 21

- virtual threads tidak mengubah TypeHandler contract;
- handler harus tetap thread-safe;
- blocking JDBC tetap blocking, hanya carrier model berbeda;
- heavy JSON parsing tetap CPU-bound.

### Java 25

- prinsip sama;
- manfaat utama ada di language/runtime maturity;
- jangan memakai fitur bahasa terbaru jika library/platform baseline enterprise belum siap.

Prinsip lintas versi:

```text
TypeHandler API tetap berbasis JDBC.
Modern Java membantu model domain,
tetapi tidak menghapus kewajiban memahami JDBC null, type, driver, dan vendor behavior.
```

---

## 44. Common Failure Model

### 44.1 Handler Not Found

Gejala:

```text
No typehandler found for property ...
```

Penyebab:

- handler belum registered;
- package scan salah;
- generic type tidak terdeteksi;
- wrong `javaType`;
- multi-datasource factory salah.

### 44.2 Wrong Handler Used

Gejala:

- data berubah format;
- enum parse gagal;
- boolean `Y/N` salah;
- JSON handler dipakai ke tipe lain.

Penyebab:

- global registration terlalu luas;
- `@MappedTypes` terlalu generic;
- `List.class` handler;
- `Boolean.class + CHAR` handler dipakai semua field.

### 44.3 Null Becomes Default Value

Gejala:

- NULL integer menjadi 0;
- NULL boolean menjadi false;
- NULL risk score menjadi LOW.

Penyebab:

- tidak memakai `wasNull()`.

### 44.4 Invalid Legacy Code Breaks Application

Gejala:

- query gagal setelah data lama dibaca;
- production error hanya untuk row tertentu.

Penyebab:

- fail-fast handler benar menemukan data yang selama ini kotor;
- migration belum dilakukan;
- enum code list tidak lengkap.

Solusi bukan selalu melemahkan handler. Bisa jadi perlu data remediation.

### 44.5 JSON Parse Failure

Penyebab:

- schema berubah;
- data manual corrupt;
- encoding issue;
- field required hilang;
- DTO tidak backward-compatible.

### 44.6 CLOB Memory Spike

Penyebab:

- listing query select CLOB;
- handler materialize semua payload;
- result list besar;
- JSON parse per row.

---

## 45. Production Troubleshooting Flow

```text
Type conversion error occurred
  |
  +-- During parameter binding?
  |     |
  |     +-- Check mapper parameter type
  |     +-- Check #{... javaType jdbcType typeHandler}
  |     +-- Check null parameter and jdbcType
  |     +-- Check handler registration in correct SqlSessionFactory
  |
  +-- During result mapping?
        |
        +-- Check resultMap column alias
        +-- Check javaType/property type
        +-- Check handler used
        +-- Check DB value actual content
        +-- Check null/wasNull handling
        +-- Check unknown enum code
        +-- Check JSON/CLOB content
```

For multi-datasource:

```text
Same mapper works in module A but fails in module B
  -> inspect SqlSessionFactory
  -> inspect typeHandlers package/customizer
  -> inspect mapper scan ownership
  -> inspect DB vendor/column type difference
```

---

## 46. Mini Case Study: Enforcement Action Type

### Problem

Database stores enforcement action type as `VARCHAR2(20)`:

```text
WARN
FINE
SUSP
REVOKE
```

Old code uses:

```java
private String actionType;
```

Problem muncul:

- typo string di service;
- UI menerima value yang tidak valid;
- report query memakai label berbeda;
- transition logic membandingkan string;
- test tidak menangkap invalid action type.

### Improved Design

```java
public enum EnforcementActionType {
    WARNING("WARN"),
    FINE("FINE"),
    SUSPENSION("SUSP"),
    REVOCATION("REVOKE");

    private final String code;

    EnforcementActionType(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static EnforcementActionType fromCode(String code) {
        for (EnforcementActionType value : values()) {
            if (value.code.equals(code)) {
                return value;
            }
        }
        throw new IllegalArgumentException("Unknown action type: " + code);
    }
}
```

Handler:

```java
@MappedTypes(EnforcementActionType.class)
@MappedJdbcTypes(JdbcType.VARCHAR)
public final class EnforcementActionTypeHandler extends BaseTypeHandler<EnforcementActionType> {
    @Override
    public void setNonNullParameter(PreparedStatement ps, int i,
                                    EnforcementActionType parameter, JdbcType jdbcType)
            throws SQLException {
        ps.setString(i, parameter.code());
    }

    @Override
    public EnforcementActionType getNullableResult(ResultSet rs, String columnName)
            throws SQLException {
        return parse(rs.getString(columnName));
    }

    @Override
    public EnforcementActionType getNullableResult(ResultSet rs, int columnIndex)
            throws SQLException {
        return parse(rs.getString(columnIndex));
    }

    @Override
    public EnforcementActionType getNullableResult(CallableStatement cs, int columnIndex)
            throws SQLException {
        return parse(cs.getString(columnIndex));
    }

    private EnforcementActionType parse(String code) throws SQLException {
        if (code == null) {
            return null;
        }
        try {
            return EnforcementActionType.fromCode(code);
        } catch (IllegalArgumentException e) {
            throw new SQLException("Invalid enforcement action type code", e);
        }
    }
}
```

Mapper:

```xml
<result property="actionType"
        column="action_type_code"
        typeHandler="com.acme.persistence.mybatis.type.EnforcementActionTypeHandler" />
```

Now service code becomes:

```java
if (action.actionType() == EnforcementActionType.REVOCATION) {
    requireSeniorOfficerApproval(command.actor());
}
```

Lebih aman daripada:

```java
if ("REVOKE".equals(action.getActionType())) {
    ...
}
```

---

## 47. Mini Case Study: Audit Metadata JSON

Audit table:

```sql
audit_trail (
  id NUMBER,
  module_code VARCHAR2(50),
  activity VARCHAR2(100),
  metadata CLOB,
  created_at TIMESTAMP
)
```

Untuk listing audit:

```sql
SELECT id, module_code, activity, created_at
FROM audit_trail
ORDER BY created_at DESC
```

Jangan select `metadata`.

Untuk detail:

```sql
SELECT id, module_code, activity, metadata, created_at
FROM audit_trail
WHERE id = #{id}
```

Handler CLOB JSON hanya dipakai detail.

DTO split:

```java
public final class AuditTrailListRow {
    private Long id;
    private String moduleCode;
    private String activity;
    private LocalDateTime createdAt;
}

public final class AuditTrailDetailRow {
    private Long id;
    private String moduleCode;
    private String activity;
    private AuditMetadata metadata;
    private LocalDateTime createdAt;
}
```

Ini jauh lebih baik daripada satu DTO besar untuk semua query.

---

## 48. Governance untuk TypeHandler di Codebase Besar

Struktur package yang disarankan:

```text
com.acme.persistence.mybatis.type
  common/
    CodeEnum.java
    AbstractCodeEnumTypeHandler.java
  caseapp/
    CaseStatusTypeHandler.java
    CaseNumberTypeHandler.java
  enforcement/
    EnforcementActionTypeHandler.java
  json/
    ApplicantSnapshotJsonTypeHandler.java
    AuditMetadataClobTypeHandler.java
  vendor/postgresql/
    JsonbTypeHandler.java
    StringArrayTypeHandler.java
  vendor/oracle/
    OracleClobJsonTypeHandler.java
```

Jangan campur semua handler dalam satu package datar jika sistem besar.

Dokumentasikan:

```text
- Java type
- DB column type
- DB representation
- null policy
- unknown value policy
- registration location
- used by mapper/resultMap
- test class
```

Contoh dokumentasi singkat:

```java
/**
 * Maps CaseStatus <-> VARCHAR status_code.
 *
 * DB representation:
 * - DRAFT
 * - SUB
 * - UR
 * - APP
 * - REJ
 * - CLS
 *
 * Null policy:
 * - read null -> null
 * - write null handled by MyBatis with jdbcType=VARCHAR when nullable
 *
 * Unknown code policy:
 * - fail fast with SQLException wrapping IllegalArgumentException
 */
public final class CaseStatusTypeHandler extends BaseTypeHandler<CaseStatus> {
    ...
}
```

---

## 49. Practical Decision Framework

Saat ingin membuat `TypeHandler`, tanyakan:

```text
1. Apakah mapping ini satu kolom ke satu Java value?
   - Ya: TypeHandler cocok.
   - Tidak: pertimbangkan resultMap/assembler.

2. Apakah tipe Java punya semantics domain?
   - Ya: TypeHandler bisa menjaga boundary.
   - Tidak: built-in handler mungkin cukup.

3. Apakah DB representation stabil?
   - Ya: aman.
   - Tidak: perlu versioning/backward compatibility.

4. Apakah field critical?
   - Ya: explicit mapping + fail-fast + test.
   - Tidak: global registration mungkin cukup.

5. Apakah vendor-specific?
   - Ya: isolasi package/config.

6. Apakah value besar/sensitif?
   - Ya: hati-hati logging, memory, query selection.
```

---

## 50. Ringkasan Mental Model

`TypeHandler` adalah lapisan kecil tetapi berdampak besar.

Model akhirnya:

```text
Database column representation
  -> JDBC value
  -> TypeHandler
  -> Java semantic type
  -> Mapper contract
  -> Service/domain logic
```

`TypeHandler` yang baik:

- pure;
- deterministic;
- stateless;
- thread-safe;
- eksplisit soal null;
- eksplisit soal unknown value;
- tidak menyimpan business logic;
- tidak melakukan query tambahan;
- tidak membocorkan PII di error/log;
- punya test unit dan integration jika vendor-specific;
- menjaga domain dari primitive obsession;
- menjaga database-specific representation agar tidak bocor ke seluruh aplikasi.

`TypeHandler` yang buruk:

- terlalu generic;
- diam-diam convert invalid value;
- menyembunyikan null;
- memakai enum ordinal;
- parsing JSON tanpa versioning;
- materialize CLOB besar di listing;
- punya dependency/service call;
- punya mutable state;
- registration-nya terlalu luas;
- tidak dites dengan data invalid.

---

## 51. Apa yang Harus Dikuasai Setelah Part 13

Setelah bagian ini, kita harus bisa:

1. menjelaskan kapan custom `TypeHandler` diperlukan;
2. membedakan representational mapping vs business logic;
3. membuat enum-by-code handler yang aman;
4. membuat value object handler;
5. memahami null handling dan `wasNull()`;
6. memakai `jdbcType` dengan benar untuk nullable parameter;
7. menentukan registration strategy;
8. mendesain JSON/CLOB mapping dengan sadar risiko;
9. mengisolasi vendor-specific handler;
10. menguji handler secara unit dan integration;
11. mereview handler dalam codebase enterprise;
12. menghindari anti-pattern seperti enum ordinal, universal JSON handler, dan heavy logic di handler.

---

## 52. Referensi Resmi

- MyBatis Configuration — `typeHandlers`, settings, registry behavior: <https://mybatis.org/mybatis-3/configuration.html>
- MyBatis Mapper XML — `javaType`, `jdbcType`, `typeHandler`, parameter/result mapping: <https://mybatis.org/mybatis-3/sqlmap-xml.html>
- MyBatis `BaseTypeHandler` API — null handling note since 3.5.0: <https://mybatis.org/mybatis-3/apidocs/org/apache/ibatis/type/BaseTypeHandler.html>
- MyBatis Dynamic SQL — column metadata and type handler support: <https://mybatis.org/mybatis-dynamic-sql/docs/introduction.html>
- MyBatis Spring Boot Autoconfigure — configuration customizer and type handler package registration: <https://mybatis.org/spring-boot-starter/mybatis-spring-boot-autoconfigure/>

---

## 53. Status Seri

Progress seri sejauh ini:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
```

Seri **belum selesai**.

Part berikutnya:

```text
14-database-vendor-awareness-oracle-postgresql-mysql-sqlserver.md
```

Topik berikutnya akan membahas database vendor awareness: Oracle, PostgreSQL, MySQL, SQL Server, pagination differences, generated keys, sequence/identity, locking syntax, upsert, CLOB/BLOB behavior, boolean/date/time differences, `databaseIdProvider`, dan desain portability boundary yang realistis.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 12 — Spring Boot Integration: Auto Configuration, Mapper Scan, Configuration Customizer](./12-spring-boot-integration-autoconfiguration-mapperscan-customizer.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 14 — Database Vendor Awareness: Oracle, PostgreSQL, MySQL, SQL Server](./14-database-vendor-awareness-oracle-postgresql-mysql-sqlserver.md)

</div>