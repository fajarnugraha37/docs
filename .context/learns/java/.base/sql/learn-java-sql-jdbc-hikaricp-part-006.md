# learn-java-sql-jdbc-hikaricp-part-006

# JDBC Type System: SQL Types, Java Types, and Conversion Traps

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `006 / 029`  
> Topik: JDBC Type System, SQL Types, Java Types, Conversion, NULL, Temporal, Numeric, Vendor Type  
> Level: Advanced / Production Engineer  
> Prasyarat: Part 000-005

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya, kita sudah membangun mental model bahwa JDBC bukan sekadar API untuk “menjalankan query”, tetapi boundary antara:

```text
Java object world
  ↓
JDBC API contract
  ↓
JDBC driver implementation
  ↓
wire protocol / database protocol
  ↓
database session, parser, executor, type system, storage engine
```

Part ini membahas satu boundary yang sering terlihat sederhana tetapi sangat sering menjadi sumber bug production: **type conversion**.

Di Java, kita punya `String`, `int`, `long`, `BigDecimal`, `LocalDate`, `OffsetDateTime`, `byte[]`, `UUID`, enum, object, dan sebagainya.

Di database, kita punya `VARCHAR`, `CHAR`, `NUMBER`, `NUMERIC`, `DECIMAL`, `INTEGER`, `BIGINT`, `DATE`, `TIMESTAMP`, `TIMESTAMP WITH TIME ZONE`, `BLOB`, `CLOB`, `JSON`, `XML`, `UUID`, vendor-specific type, dan user-defined type.

JDBC berdiri di tengah melalui beberapa abstraction:

```text
java.sql.Types / JDBCType
PreparedStatement.setXxx(...)
PreparedStatement.setObject(...)
ResultSet.getXxx(...)
ResultSet.getObject(...)
ResultSetMetaData
ParameterMetaData
Driver-specific conversion rules
```

Masalahnya: **JDBC menyediakan kontrak umum, tetapi database dan driver punya perilaku konkret yang tidak selalu identik.**

Itulah sebabnya engineer yang kuat di JDBC tidak hanya hafal `setString()` atau `getInt()`. Ia memahami:

1. SQL type berbeda dari Java type.
2. JDBC type adalah layer normalisasi, bukan representasi sempurna semua vendor type.
3. Driver boleh melakukan conversion, tetapi conversion bisa kehilangan precision, timezone, scale, encoding, atau semantic meaning.
4. NULL di SQL tidak sama dengan `null` Java secara operasional.
5. Temporal type adalah area paling rawan karena melibatkan calendar, timezone, database semantics, dan driver behavior.
6. `setObject()` terlihat fleksibel, tetapi justru harus dipakai dengan disiplin tinggi.
7. `getObject()` tanpa target class bisa mengembalikan type yang berbeda antar driver.

---

## 1. Mental Model: Ada 4 Type System, Bukan 2

Kesalahan umum adalah mengira mapping JDBC hanya:

```text
SQL type ↔ Java type
```

Model yang lebih akurat adalah:

```text
[1] Database native type
        ↓
[2] JDBC generic type
        ↓
[3] Driver conversion type
        ↓
[4] Application domain type
```

Contoh:

```text
Oracle NUMBER(19, 0)
        ↓
java.sql.Types.NUMERIC
        ↓
BigDecimal / Long / Integer depending getter
        ↓
CaseId, UserId, MoneyAmount, VersionNumber, etc.
```

Atau:

```text
PostgreSQL uuid
        ↓
Types.OTHER or vendor-specific mapping
        ↓
java.util.UUID or String depending driver/getter
        ↓
ApplicationId / TenantId / CorrelationId
```

Atau:

```text
MySQL TINYINT(1)
        ↓
Types.TINYINT / BIT / BOOLEAN depending driver config
        ↓
Boolean / Integer / Byte
        ↓
Domain flag: active, deleted, locked
```

Jadi, top 1% mental model-nya bukan:

> “Kolom ini integer, ambil pakai `getInt()`.”

Melainkan:

> “Kolom ini native type apa, JDBC type-nya dilaporkan apa, driver mengembalikan Java type apa, apakah ada precision/null/timezone/encoding issue, dan domain object apa yang seharusnya merepresentasikan value ini?”

---

## 2. `java.sql.Types` dan `JDBCType`

### 2.1 `java.sql.Types`

`java.sql.Types` berisi konstanta integer yang merepresentasikan generic SQL/JDBC types.

Contoh umum:

```java
Types.VARCHAR
Types.CHAR
Types.INTEGER
Types.BIGINT
Types.NUMERIC
Types.DECIMAL
Types.DATE
Types.TIME
Types.TIMESTAMP
Types.BOOLEAN
Types.BLOB
Types.CLOB
Types.ARRAY
Types.STRUCT
Types.SQLXML
Types.OTHER
```

`Types` bukan enum. Ia class berisi konstanta `int`.

Contoh penggunaan:

```java
preparedStatement.setNull(1, Types.VARCHAR);
preparedStatement.setObject(2, value, Types.NUMERIC);
```

### 2.2 `JDBCType`

Java modern juga menyediakan `java.sql.JDBCType`, sebuah enum yang mengimplementasikan `SQLType`.

Contoh:

```java
preparedStatement.setObject(1, amount, JDBCType.NUMERIC);
```

`JDBCType` lebih type-safe daripada integer `Types`, tetapi banyak API dan library lama masih memakai `Types`.

### 2.3 `Types` adalah generic type, bukan vendor type

`Types.NUMERIC` bisa berarti banyak hal:

```text
Oracle NUMBER(10, 0)
Oracle NUMBER(19, 0)
Oracle NUMBER(19, 4)
PostgreSQL numeric(19, 4)
MySQL DECIMAL(19, 4)
SQL Server decimal(19, 4)
```

Semua bisa dilihat sebagai `NUMERIC` atau `DECIMAL`, tetapi semantic-nya belum tentu sama dari sisi:

1. precision,
2. scale,
3. overflow behavior,
4. rounding behavior,
5. default mapping,
6. performance,
7. storage,
8. index selectivity,
9. driver conversion.

---

## 3. Direction Matters: Binding vs Reading

Mapping type terjadi dalam dua arah:

```text
Java → JDBC driver → database
```

Ini terjadi saat:

```java
ps.setString(...)
ps.setInt(...)
ps.setLong(...)
ps.setBigDecimal(...)
ps.setObject(...)
ps.setNull(...)
```

Dan:

```text
database → JDBC driver → Java
```

Ini terjadi saat:

```java
rs.getString(...)
rs.getInt(...)
rs.getLong(...)
rs.getBigDecimal(...)
rs.getObject(...)
rs.getObject(..., SomeClass.class)
```

Kedua arah ini tidak selalu simetris.

Contoh:

```java
ps.setObject(1, UUID.randomUUID());
```

Mungkin bekerja di PostgreSQL untuk kolom `uuid`, tetapi belum tentu bekerja sama di MySQL atau Oracle tanpa explicit conversion.

Contoh lain:

```java
BigDecimal value = rs.getBigDecimal("amount");
ps.setBigDecimal(1, value);
```

Ini terlihat aman, tetapi tetap perlu memperhatikan scale:

```text
DB column: DECIMAL(19, 2)
Java value: BigDecimal("10.999")
```

Driver/database bisa:

1. membulatkan,
2. menolak,
3. truncate,
4. menerima lalu menyimpan scale berbeda,
5. memberi warning,
6. melempar exception.

---

## 4. Getter dan Setter JDBC: Jangan Pilih Berdasarkan “Bisa Jalan”

### 4.1 Setter spesifik

Contoh setter spesifik:

```java
ps.setString(1, name);
ps.setInt(2, age);
ps.setLong(3, id);
ps.setBigDecimal(4, amount);
ps.setBoolean(5, active);
ps.setBytes(6, payload);
```

Kelebihan:

1. intent jelas,
2. mengurangi ambiguity,
3. lebih mudah direview,
4. lebih predictable,
5. lebih mudah dikaitkan dengan schema.

Kekurangan:

1. tidak semua type modern/vendor punya setter khusus,
2. kadang perlu `setObject`,
3. primitive setter tidak bisa menerima `null`.

### 4.2 Getter spesifik

Contoh:

```java
String name = rs.getString("name");
long id = rs.getLong("id");
BigDecimal amount = rs.getBigDecimal("amount");
boolean active = rs.getBoolean("active");
```

Kelebihan:

1. jelas,
2. cepat dipahami,
3. mapping eksplisit.

Kekurangan:

1. primitive getter punya masalah NULL,
2. driver conversion bisa terjadi diam-diam,
3. salah getter bisa menyebabkan truncation/overflow/rounding.

### 4.3 `setObject()`

`setObject()` berguna ketika:

1. value type tidak punya setter khusus,
2. ingin memakai JDBC 4.2 temporal mapping,
3. ingin binding vendor-specific type,
4. generic DAO/mapping layer,
5. nullable value handling.

Tetapi `setObject()` juga rawan karena driver harus menebak target SQL type jika tidak diberi SQL type.

Kurang aman:

```java
ps.setObject(1, null);
ps.setObject(2, someEnum);
ps.setObject(3, someJsonObject);
ps.setObject(4, localDateTime);
```

Lebih aman:

```java
ps.setNull(1, Types.VARCHAR);
ps.setString(2, status.name());
ps.setObject(3, jsonString, Types.OTHER);        // if driver/db expects OTHER
ps.setObject(4, localDateTime, JDBCType.TIMESTAMP);
```

### 4.4 `getObject()`

Ada dua model:

```java
Object value = rs.getObject("created_at");
```

Dan:

```java
LocalDateTime value = rs.getObject("created_at", LocalDateTime.class);
```

Model kedua lebih eksplisit, tetapi tetap bergantung pada driver support.

Prinsip praktis:

```text
Use getObject(column, TargetClass.class) when the driver supports it and the target type is clear.
Use specific getters for common scalar types.
Avoid raw getObject() in domain code unless followed by explicit type validation.
```

---

## 5. NULL Semantics: SQL NULL Bukan Sekadar Java null

### 5.1 Problem primitive getter

JDBC primitive getter tidak bisa mengembalikan `null`.

Contoh:

```java
int score = rs.getInt("score");
```

Jika kolom `score` adalah SQL `NULL`, `getInt()` akan mengembalikan `0`.

Untuk tahu apakah value sebenarnya NULL, harus panggil:

```java
int score = rs.getInt("score");
if (rs.wasNull()) {
    // score was SQL NULL, not actual 0
}
```

Ini salah satu trap JDBC paling klasik.

### 5.2 Wrapper getter pattern

Daripada:

```java
int retryCount = rs.getInt("retry_count");
```

Gunakan helper:

```java
static Integer getNullableInt(ResultSet rs, String column) throws SQLException {
    int value = rs.getInt(column);
    return rs.wasNull() ? null : value;
}
```

Untuk long:

```java
static Long getNullableLong(ResultSet rs, String column) throws SQLException {
    long value = rs.getLong(column);
    return rs.wasNull() ? null : value;
}
```

Untuk boolean:

```java
static Boolean getNullableBoolean(ResultSet rs, String column) throws SQLException {
    boolean value = rs.getBoolean(column);
    return rs.wasNull() ? null : value;
}
```

### 5.3 `getObject(..., Integer.class)` untuk nullable

Pada driver modern, ini sering lebih nyaman:

```java
Integer retryCount = rs.getObject("retry_count", Integer.class);
Long version = rs.getObject("version", Long.class);
Boolean active = rs.getObject("active", Boolean.class);
```

Tetapi tetap harus dites pada driver yang dipakai.

### 5.4 Binding NULL harus typed

Salah:

```java
ps.setObject(1, null);
```

Lebih benar:

```java
ps.setNull(1, Types.VARCHAR);
```

Atau:

```java
ps.setObject(1, null, JDBCType.VARCHAR);
```

Mengapa?

Karena database perlu tahu type parameter. SQL `NULL` tanpa type bisa ambigu, terutama pada prepared statement, function overload, expression, atau vendor-specific type.

Contoh ambiguity:

```sql
where deleted_at = ?
```

Jika parameter null tanpa type, driver/database bisa tidak tahu apakah ini `TIMESTAMP`, `DATE`, `VARCHAR`, atau type lain.

Namun ada problem lebih besar: secara SQL, ini juga salah secara semantics:

```sql
where deleted_at = null
```

Harusnya:

```sql
where deleted_at is null
```

Jadi binding NULL bukan hanya masalah JDBC type, tetapi juga SQL semantics.

---

## 6. String, CHAR, VARCHAR, NCHAR, NVARCHAR, CLOB

### 6.1 `String` terlihat mudah, tapi banyak trap

Umum:

```java
ps.setString(1, name);
String name = rs.getString("name");
```

Tetapi di database, text bisa berupa:

```text
CHAR
VARCHAR
VARCHAR2
TEXT
CLOB
NCHAR
NVARCHAR
NVARCHAR2
NCLOB
JSON stored as text
XML stored as text
```

### 6.2 `CHAR` padding

`CHAR(n)` biasanya fixed-length dan bisa dipadding spasi.

Contoh:

```text
DB value: 'A    '
Java String: "A    " or sometimes logically compared differently by DB
```

Trap:

```java
if (status.equals("A")) { ... }
```

Jika value mengandung trailing space, hasilnya false.

Praktik:

1. Gunakan `VARCHAR` untuk kebanyakan data textual.
2. Hindari `CHAR` kecuali benar-benar fixed-code dan behavior padding dipahami.
3. Jangan `trim()` membabi buta untuk semua field karena whitespace bisa bermakna pada beberapa domain.

### 6.3 Unicode and national character types

`NCHAR`, `NVARCHAR`, `NCLOB` dipakai untuk national character set di beberapa database.

JDBC punya API:

```java
ps.setNString(1, value);
String value = rs.getNString("name");
```

Tetapi support dan kebutuhan bergantung database/driver.

Prinsip:

```text
Jangan asumsikan String Java = semua encoding problem selesai.
Pastikan database character set, column type, driver encoding, dan app input/output konsisten.
```

### 6.4 CLOB bukan String biasa

Untuk small text, `getString()` sering cukup.

Untuk huge text, seperti audit full payload, document body, serialized changes:

```java
Clob clob = rs.getClob("payload");
try (Reader reader = clob.getCharacterStream()) {
    // stream content
}
```

Masalah jika langsung:

```java
String payload = rs.getString("payload");
```

Untuk CLOB besar, ini bisa:

1. allocate memory besar,
2. memperlambat query,
3. meningkatkan GC pressure,
4. membuat API response terlalu berat,
5. menghabiskan network bandwidth,
6. menyebabkan timeout.

---

## 7. Numeric Types: Precision, Scale, Overflow, and Money

### 7.1 Integer family

Mapping umum:

```text
SQL SMALLINT → Java short / Short
SQL INTEGER  → Java int / Integer
SQL BIGINT   → Java long / Long
```

Tetapi driver bisa mengizinkan conversion lain.

Contoh berbahaya:

```java
int id = rs.getInt("id");
```

Jika DB column adalah `BIGINT` dan value melebihi `Integer.MAX_VALUE`, bisa terjadi overflow/truncation/error tergantung driver.

Lebih aman:

```java
long id = rs.getLong("id");
```

Atau untuk nullable:

```java
Long id = rs.getObject("id", Long.class);
```

### 7.2 Decimal and numeric

Untuk uang, rate, percentage, score presisi tinggi:

```java
BigDecimal amount = rs.getBigDecimal("amount");
ps.setBigDecimal(1, amount);
```

Jangan gunakan `double` untuk uang.

Salah:

```java
double amount = 0.1 + 0.2;
```

Benar:

```java
BigDecimal amount = new BigDecimal("0.30");
```

Atau:

```java
BigDecimal amount = BigDecimal.valueOf(30, 2); // 0.30
```

### 7.3 Precision vs scale

```text
DECIMAL(19, 2)
```

Artinya biasanya:

```text
precision = total significant digits = 19
scale     = digits after decimal point = 2
```

Value:

```text
12345678901234567.89
```

Masih 19 digits total.

Value:

```text
123456789012345678.90
```

Bisa overflow.

### 7.4 BigDecimal equality trap

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00")) // false
new BigDecimal("1.0").compareTo(new BigDecimal("1.00")) == 0 // true
```

Mengapa?

`equals()` memperhitungkan scale.

Dalam domain money, biasanya gunakan:

```java
amount.compareTo(expected) == 0
```

Atau normalisasi scale:

```java
amount = amount.setScale(2, RoundingMode.UNNECESSARY);
```

`RoundingMode.UNNECESSARY` berguna untuk memaksa validasi bahwa value memang sudah sesuai scale.

### 7.5 Rounding should be explicit

Jangan biarkan database/driver diam-diam membulatkan.

Lebih baik:

```java
BigDecimal normalized = amount.setScale(2, RoundingMode.HALF_UP);
ps.setBigDecimal(1, normalized);
```

Atau untuk domain yang tidak boleh rounding:

```java
BigDecimal normalized = amount.setScale(2, RoundingMode.UNNECESSARY);
```

Jika scale tidak valid, Java akan throw `ArithmeticException`, sehingga bug tertangkap sebelum masuk DB.

---

## 8. Boolean Mapping: Sederhana di Java, Beragam di Database

Java:

```java
boolean active;
Boolean activeNullable;
```

Database bisa punya:

```text
BOOLEAN
BIT
TINYINT(1)
NUMBER(1)
CHAR(1) -- Y/N
VARCHAR -- TRUE/FALSE
```

JDBC:

```java
ps.setBoolean(1, active);
boolean active = rs.getBoolean("active");
```

Trap:

1. `getBoolean()` untuk NULL mengembalikan false, perlu `wasNull()`.
2. Database lama mungkin tidak punya native boolean.
3. `CHAR(1)` Y/N tidak selalu dimapping otomatis ke boolean.
4. `NUMBER(1)` bisa berisi selain 0/1 jika constraint tidak ketat.

Praktik domain yang kuat:

```sql
active_flag char(1) check (active_flag in ('Y', 'N'))
```

Mapper eksplisit:

```java
static boolean getRequiredYn(ResultSet rs, String column) throws SQLException {
    String value = rs.getString(column);
    if (value == null) {
        throw new SQLException("Required Y/N column is NULL: " + column);
    }
    return switch (value) {
        case "Y" -> true;
        case "N" -> false;
        default -> throw new SQLException("Invalid Y/N value for " + column + ": " + value);
    };
}
```

Untuk write:

```java
ps.setString(1, active ? "Y" : "N");
```

Ini lebih eksplisit daripada berharap driver menebak semantic.

---

## 9. Temporal Types: Bagian Paling Berbahaya

Temporal mapping adalah area yang sering membuat bug sulit direproduksi karena dipengaruhi oleh:

1. database column type,
2. database session timezone,
3. JVM default timezone,
4. driver behavior,
5. legacy `java.sql.*` class,
6. `java.time.*` class,
7. serialization API,
8. business meaning.

### 9.1 Jangan mulai dari class Java; mulai dari semantic

Pertanyaan pertama bukan:

> “Pakai `LocalDateTime` atau `OffsetDateTime`?”

Pertanyaan pertama adalah:

> “Value ini merepresentasikan apa?”

Ada beberapa semantic berbeda:

```text
Calendar date tanpa waktu
Example: birth date, due date, license expiry date
Java: LocalDate
SQL: DATE

Local wall-clock time tanpa tanggal
Example: office opens at 09:00
Java: LocalTime
SQL: TIME

Local date-time tanpa offset/timezone
Example: appointment at local office time
Java: LocalDateTime
SQL: TIMESTAMP WITHOUT TIME ZONE / TIMESTAMP

Instant global di timeline
Example: event created at exact moment
Java: Instant / OffsetDateTime
SQL: TIMESTAMP WITH TIME ZONE or DB-specific representation

Date-time dengan original user offset
Example: user submitted form at 2026-06-16T10:15+07:00 and offset matters legally
Java: OffsetDateTime plus maybe original zone/offset
SQL: TIMESTAMP WITH TIME ZONE or separate fields

Recurring zoned business time
Example: every Monday 09:00 Asia/Jakarta
Java: LocalTime + ZoneId + recurrence rule
SQL: multiple fields, not just TIMESTAMP
```

### 9.2 Legacy JDBC temporal classes

JDBC lama memakai:

```java
java.sql.Date
java.sql.Time
java.sql.Timestamp
```

Masalah:

1. Mereka historically wrapper di atas millisecond/time representation.
2. Nama class mirip SQL type tetapi behavior Java-nya tidak selalu intuitif.
3. `Timestamp` punya nanoseconds handling tambahan.
4. Interaksi dengan timezone bisa membingungkan saat convert ke/from `java.util.Date`.

### 9.3 Java Time API with JDBC 4.2+

Dengan JDBC modern, driver dapat mendukung:

```java
ps.setObject(1, LocalDate.now());
ps.setObject(2, LocalDateTime.now());
ps.setObject(3, OffsetDateTime.now());

LocalDate date = rs.getObject("business_date", LocalDate.class);
LocalDateTime created = rs.getObject("created_at", LocalDateTime.class);
OffsetDateTime submitted = rs.getObject("submitted_at", OffsetDateTime.class);
```

Tetapi:

```text
Dukungan dan mapping detail bergantung pada driver.
```

Jadi untuk production code, test mapping temporal pada database/driver real adalah wajib.

### 9.4 `LocalDate`

Untuk SQL `DATE` yang benar-benar tanggal tanpa waktu:

```java
LocalDate expiryDate = rs.getObject("expiry_date", LocalDate.class);
ps.setObject(1, expiryDate, JDBCType.DATE);
```

Good use cases:

1. tanggal lahir,
2. tanggal jatuh tempo,
3. tanggal izin berlaku,
4. tanggal kalender bisnis.

Hindari menyimpan date-only sebagai midnight timestamp:

```text
2026-06-16T00:00:00
```

Karena timezone conversion bisa menggeser tanggal.

### 9.5 `LocalDateTime`

`LocalDateTime` tidak punya offset dan tidak punya timezone.

Ini bukan instant global.

```java
LocalDateTime ldt = LocalDateTime.of(2026, 6, 16, 10, 0);
```

Tanpa konteks zone, kita tidak tahu ini moment mana di timeline.

Valid untuk:

1. local appointment,
2. local office workflow time,
3. legacy database timestamp tanpa timezone,
4. value yang memang tidak boleh dikonversi timezone.

Berbahaya untuk:

1. event audit timestamp global,
2. distributed tracing timestamp,
3. security token expiry,
4. SLA measurement lintas timezone,
5. ordering event global.

### 9.6 `Instant`

`Instant` adalah point di timeline UTC.

Bagus untuk:

1. created_at,
2. updated_at,
3. event_at,
4. audit_at,
5. token expiry,
6. distributed event ordering.

Namun JDBC support langsung untuk `Instant` tidak selalu sebagus `OffsetDateTime` atau `Timestamp`, tergantung driver.

Pattern umum:

```java
Instant now = clock.instant();
OffsetDateTime odt = now.atOffset(ZoneOffset.UTC);
ps.setObject(1, odt, JDBCType.TIMESTAMP_WITH_TIMEZONE);
```

Saat baca:

```java
OffsetDateTime odt = rs.getObject("created_at", OffsetDateTime.class);
Instant instant = odt.toInstant();
```

Atau jika database/driver hanya mendukung `Timestamp`:

```java
Timestamp ts = Timestamp.from(instant);
ps.setTimestamp(1, ts);

Instant read = rs.getTimestamp("created_at").toInstant();
```

Tetapi pastikan timezone/session semantics driver dipahami.

### 9.7 `OffsetDateTime`

`OffsetDateTime` punya offset, misalnya:

```text
2026-06-16T10:00:00+07:00
```

Namun offset bukan full timezone region. `+07:00` tidak sama dengan `Asia/Jakarta` secara semantic jangka panjang karena timezone region punya history/rules.

Good for:

1. representing instant with explicit offset,
2. DB `TIMESTAMP WITH TIME ZONE` where driver maps to `OffsetDateTime`,
3. API boundary that needs offset.

Trap:

1. beberapa DB tidak menyimpan timezone/offset asli meskipun nama type-nya “with time zone”,
2. beberapa DB normalize ke UTC/session timezone,
3. saat dibaca, offset yang kembali bisa bukan offset original.

### 9.8 `ZonedDateTime`

`ZonedDateTime` punya `ZoneId`, misalnya:

```text
2026-06-16T10:00:00 Asia/Jakarta
```

JDBC support untuk `ZonedDateTime` tidak universal.

Jika zone region penting, sering lebih aman menyimpan:

```text
instant_utc      timestamp/instant
zone_id          varchar
local_date_time  optional, if business reconstruction needed
```

Contoh:

```sql
submitted_at_utc timestamp not null,
submitted_zone_id varchar(64) not null
```

Domain object:

```java
record SubmittedAt(Instant instant, ZoneId zoneId) {
    ZonedDateTime asZonedDateTime() {
        return instant.atZone(zoneId);
    }
}
```

---

## 10. Temporal Design Patterns

### 10.1 Audit timestamp pattern

Untuk audit event:

```java
Instant now = clock.instant();
```

Database options:

1. `TIMESTAMP WITH TIME ZONE` if semantics clear and driver tested.
2. `TIMESTAMP` normalized to UTC by convention.
3. database-generated timestamp using `CURRENT_TIMESTAMP`, but beware DB server timezone and consistency.

Application binding:

```java
ps.setObject(1, OffsetDateTime.ofInstant(now, ZoneOffset.UTC), JDBCType.TIMESTAMP_WITH_TIMEZONE);
```

Or fallback:

```java
ps.setTimestamp(1, Timestamp.from(now));
```

Rule:

```text
For distributed audit ordering, store instant semantics, not local wall-clock semantics.
```

### 10.2 Business date pattern

For license expiry:

```java
LocalDate expiryDate = LocalDate.of(2026, 12, 31);
ps.setObject(1, expiryDate, JDBCType.DATE);
```

Do not:

```java
ps.setTimestamp(1, Timestamp.valueOf(expiryDate.atStartOfDay()));
```

Because date-only semantic should not be vulnerable to timezone shifts.

### 10.3 SLA deadline pattern

SLA can be tricky.

If SLA is “within 3 business days in Singapore calendar”, store:

```text
received_at_instant
jurisdiction/business_calendar
computed_due_date or due_instant
computation_version
```

Do not assume one timestamp column captures full business rule.

---

## 11. Enum Mapping

Java enum:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Database options:

1. `VARCHAR` storing enum name.
2. `CHAR` storing code.
3. native enum type.
4. lookup table.
5. integer ordinal.

### 11.1 Avoid ordinal

Bad:

```java
ps.setInt(1, status.ordinal());
```

Because reordering enum breaks data.

### 11.2 Stable code pattern

Better:

```java
enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED"),
    UNDER_REVIEW("UNDER_REVIEW"),
    APPROVED("APPROVED"),
    REJECTED("REJECTED");

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

Binding:

```java
ps.setString(1, status.code());
```

Reading:

```java
CaseStatus status = CaseStatus.fromCode(rs.getString("status"));
```

### 11.3 Database constraint

Use constraint:

```sql
check (status in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'))
```

Or lookup table:

```sql
case_status_dim(status_code primary key, description, active_flag)
```

Rule:

```text
The Java enum and DB allowed values must evolve together.
```

---

## 12. UUID Mapping

Java:

```java
UUID id = UUID.randomUUID();
```

Database options:

```text
PostgreSQL uuid
MySQL binary(16)
MySQL char(36)
Oracle raw(16)
SQL Server uniqueidentifier
VARCHAR(36)
```

### 12.1 String storage

Simple:

```java
ps.setString(1, id.toString());
UUID id = UUID.fromString(rs.getString("id"));
```

Pros:

1. human-readable,
2. easy debugging,
3. portable.

Cons:

1. larger storage,
2. larger indexes,
3. slower comparison than binary/native.

### 12.2 Native/vendor storage

PostgreSQL may support:

```java
ps.setObject(1, id);
UUID id = rs.getObject("id", UUID.class);
```

But this is driver-specific enough that you should test it.

### 12.3 Binary storage

For `BINARY(16)`/`RAW(16)`:

```java
static byte[] uuidToBytes(UUID uuid) {
    ByteBuffer buffer = ByteBuffer.allocate(16);
    buffer.putLong(uuid.getMostSignificantBits());
    buffer.putLong(uuid.getLeastSignificantBits());
    return buffer.array();
}

static UUID bytesToUuid(byte[] bytes) {
    ByteBuffer buffer = ByteBuffer.wrap(bytes);
    return new UUID(buffer.getLong(), buffer.getLong());
}
```

Binding:

```java
ps.setBytes(1, uuidToBytes(id));
```

Reading:

```java
UUID id = bytesToUuid(rs.getBytes("id"));
```

Important:

```text
Define byte order explicitly and never change it.
```

---

## 13. JSON Mapping

JDBC has no universal first-class JSON type abstraction equivalent to `Blob` or `SQLXML`.

Database possibilities:

```text
PostgreSQL json / jsonb
MySQL JSON
Oracle JSON stored in VARCHAR2/CLOB/BLOB/native JSON depending version
SQL Server JSON text functions
```

Application options:

1. store as String,
2. store as driver-specific object,
3. use `Types.OTHER`,
4. use library/ORM/jOOQ support,
5. map to domain object before/after JDBC.

### 13.1 Portable string pattern

```java
String json = objectMapper.writeValueAsString(payload);
ps.setString(1, json);
```

Reading:

```java
String json = rs.getString("payload_json");
Payload payload = objectMapper.readValue(json, Payload.class);
```

Pros:

1. simple,
2. portable,
3. easy to reason.

Cons:

1. may not use native JSON operators/indexes,
2. DB validation may be weaker unless constraint exists,
3. large JSON can become CLOB issue.

### 13.2 PostgreSQL-style `Types.OTHER` pattern

Some drivers require:

```java
ps.setObject(1, json, Types.OTHER);
```

But avoid pretending this is portable.

### 13.3 Domain guidance

For OLTP systems:

```text
Use JSON for genuinely flexible/append-only/details payload.
Do not hide core queryable state inside JSON if it participates in workflows, authorization, SLA, reporting, or regulatory audit.
```

---

## 14. XML Mapping

JDBC has `SQLXML`:

```java
SQLXML xml = connection.createSQLXML();
xml.setString(xmlString);
ps.setSQLXML(1, xml);
```

Reading:

```java
SQLXML xml = rs.getSQLXML("payload_xml");
String value = xml.getString();
xml.free();
```

Important:

1. call `free()` when appropriate,
2. avoid loading huge XML blindly,
3. beware XXE/security when parsing XML outside JDBC,
4. understand DB XML type/index support.

---

## 15. Binary Data: `byte[]`, `InputStream`, BLOB

### 15.1 Small binary

```java
ps.setBytes(1, bytes);
byte[] bytes = rs.getBytes("content");
```

Good for small payloads.

### 15.2 Large binary

Use streams:

```java
try (InputStream in = Files.newInputStream(path)) {
    ps.setBinaryStream(1, in, Files.size(path));
    ps.executeUpdate();
}
```

Reading:

```java
try (InputStream in = rs.getBinaryStream("content")) {
    in.transferTo(outputStream);
}
```

Or use `Blob`:

```java
Blob blob = rs.getBlob("content");
try (InputStream in = blob.getBinaryStream()) {
    in.transferTo(outputStream);
} finally {
    blob.free();
}
```

Guidance:

```text
Do not use byte[] for unbounded BLOB data.
```

---

## 16. Arrays and Structured Types

Some databases support arrays or structured/object types.

JDBC API:

```java
Array array = connection.createArrayOf("VARCHAR", new String[] {"A", "B"});
ps.setArray(1, array);
```

Reading:

```java
Array array = rs.getArray("tags");
String[] tags = (String[]) array.getArray();
array.free();
```

Caveat:

1. element type name is database-specific,
2. support varies heavily,
3. arrays can hurt portability,
4. arrays can be appropriate for PostgreSQL-specific systems,
5. arrays are usually less portable than join tables.

Rule:

```text
Use SQL arrays when the database is a deliberate platform choice, not when portability matters.
```

---

## 17. User Defined Types and `SQLData`

JDBC supports custom mapping of SQL user-defined types through:

```java
SQLData
SQLInput
SQLOutput
Connection.getTypeMap()
Connection.setTypeMap(...)
```

Conceptually:

```java
public final class Address implements SQLData {
    private String street;
    private String city;

    @Override
    public String getSQLTypeName() {
        return "APP.ADDRESS_TYPE";
    }

    @Override
    public void readSQL(SQLInput stream, String typeName) throws SQLException {
        street = stream.readString();
        city = stream.readString();
    }

    @Override
    public void writeSQL(SQLOutput stream) throws SQLException {
        stream.writeString(street);
        stream.writeString(city);
    }
}
```

But in modern enterprise apps, this is less common because:

1. it couples Java model to database object type,
2. portability is low,
3. tooling support is uneven,
4. versioning UDTs can be painful,
5. JSON/normalized relational design may be simpler.

Still, top-level understanding is useful because it explains why JDBC has `Struct`, `Ref`, `SQLData`, and type maps.

---

## 18. `ResultSetMetaData` and Type Discovery

You can inspect returned column types:

```java
ResultSetMetaData md = rs.getMetaData();
int count = md.getColumnCount();

for (int i = 1; i <= count; i++) {
    String label = md.getColumnLabel(i);
    int jdbcType = md.getColumnType(i);
    String typeName = md.getColumnTypeName(i);
    int precision = md.getPrecision(i);
    int scale = md.getScale(i);
    String className = md.getColumnClassName(i);

    System.out.printf(
        "%s type=%d typeName=%s precision=%d scale=%d class=%s%n",
        label, jdbcType, typeName, precision, scale, className
    );
}
```

Useful for:

1. debugging driver mapping,
2. generic CSV/export tools,
3. schema validation,
4. dynamic report builders,
5. migration verification.

But do not rely blindly on metadata for hot paths unless performance is measured.

---

## 19. `ParameterMetaData`: Useful but Often Limited

Prepared statement parameters can be inspected:

```java
ParameterMetaData pmd = ps.getParameterMetaData();
int count = pmd.getParameterCount();
for (int i = 1; i <= count; i++) {
    int type = pmd.getParameterType(i);
    String typeName = pmd.getParameterTypeName(i);
}
```

However:

1. some drivers do not fully support it,
2. some databases cannot know parameter types before parse/describe,
3. complex SQL can produce unknown parameter metadata,
4. calling it may require round-trip,
5. support varies by driver.

Therefore, do not design a critical mapper that depends entirely on `ParameterMetaData` unless tested heavily.

---

## 20. Conversion Anti-Patterns

### 20.1 Raw `getObject()` everywhere

Bad:

```java
Object value = rs.getObject(column);
```

Then later:

```java
if (value instanceof BigDecimal bd) {
    return bd.longValue();
}
```

Why dangerous:

1. driver-specific object class,
2. hidden conversion,
3. runtime class surprises,
4. harder code review,
5. weak domain guarantees.

### 20.2 `getString()` for everything

Bad:

```java
String amount = rs.getString("amount");
String createdAt = rs.getString("created_at");
String active = rs.getString("active");
```

Why dangerous:

1. loses numeric type guarantees,
2. date parsing depends formatting,
3. locale/timezone risks,
4. harder validation,
5. hides DB type bugs.

`getString()` is fine for textual values. It is not a universal mapping strategy.

### 20.3 `double` for money

Bad:

```java
double fee = rs.getDouble("fee");
```

Better:

```java
BigDecimal fee = rs.getBigDecimal("fee");
```

### 20.4 Enum ordinal

Bad:

```java
ps.setInt(1, status.ordinal());
```

Better:

```java
ps.setString(1, status.code());
```

### 20.5 Untyped NULL

Bad:

```java
ps.setObject(1, null);
```

Better:

```java
ps.setNull(1, Types.TIMESTAMP);
```

### 20.6 Implicit timezone semantics

Bad:

```java
LocalDateTime now = LocalDateTime.now();
ps.setObject(1, now);
```

For audit timestamp, better:

```java
Instant now = clock.instant();
ps.setObject(1, now.atOffset(ZoneOffset.UTC), JDBCType.TIMESTAMP_WITH_TIMEZONE);
```

Or with tested fallback.

---

## 21. Designing a Type Mapping Layer

For serious systems, do not scatter type conversion everywhere.

Bad repository style:

```java
caseObj.setId(rs.getLong("id"));
caseObj.setStatus(CaseStatus.valueOf(rs.getString("status")));
caseObj.setCreatedAt(rs.getTimestamp("created_at").toInstant());
caseObj.setAmount(rs.getBigDecimal("amount"));
caseObj.setActive("Y".equals(rs.getString("active_flag")));
```

This is tolerable in small code, but across many modules it becomes inconsistent.

Better pattern:

```java
final class JdbcColumnReaders {
    private JdbcColumnReaders() {}

    static long requiredLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        if (rs.wasNull()) {
            throw new SQLException("Required column is NULL: " + column);
        }
        return value;
    }

    static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    static String requiredString(ResultSet rs, String column) throws SQLException {
        String value = rs.getString(column);
        if (value == null) {
            throw new SQLException("Required column is NULL: " + column);
        }
        return value;
    }

    static BigDecimal requiredMoney(ResultSet rs, String column) throws SQLException {
        BigDecimal value = rs.getBigDecimal(column);
        if (value == null) {
            throw new SQLException("Required money column is NULL: " + column);
        }
        return value.setScale(2, RoundingMode.UNNECESSARY);
    }

    static Instant requiredInstantUtc(ResultSet rs, String column) throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        if (value == null) {
            throw new SQLException("Required timestamp column is NULL: " + column);
        }
        return value.toInstant();
    }

    static boolean requiredYn(ResultSet rs, String column) throws SQLException {
        String value = requiredString(rs, column);
        return switch (value) {
            case "Y" -> true;
            case "N" -> false;
            default -> throw new SQLException("Invalid Y/N value in " + column + ": " + value);
        };
    }
}
```

Binding layer:

```java
final class JdbcParameterBinders {
    private JdbcParameterBinders() {}

    static void setNullableString(PreparedStatement ps, int index, String value) throws SQLException {
        if (value == null) {
            ps.setNull(index, Types.VARCHAR);
        } else {
            ps.setString(index, value);
        }
    }

    static void setNullableLong(PreparedStatement ps, int index, Long value) throws SQLException {
        if (value == null) {
            ps.setNull(index, Types.BIGINT);
        } else {
            ps.setLong(index, value);
        }
    }

    static void setMoney(PreparedStatement ps, int index, BigDecimal value) throws SQLException {
        if (value == null) {
            ps.setNull(index, Types.DECIMAL);
        } else {
            ps.setBigDecimal(index, value.setScale(2, RoundingMode.UNNECESSARY));
        }
    }

    static void setInstantUtc(PreparedStatement ps, int index, Instant value) throws SQLException {
        if (value == null) {
            ps.setNull(index, Types.TIMESTAMP_WITH_TIMEZONE);
        } else {
            ps.setObject(index, value.atOffset(ZoneOffset.UTC), JDBCType.TIMESTAMP_WITH_TIMEZONE);
        }
    }

    static void setYn(PreparedStatement ps, int index, Boolean value) throws SQLException {
        if (value == null) {
            ps.setNull(index, Types.CHAR);
        } else {
            ps.setString(index, value ? "Y" : "N");
        }
    }
}
```

This layer gives:

1. consistent NULL handling,
2. explicit scale validation,
3. consistent enum/flag mapping,
4. consistent temporal mapping,
5. easier driver migration,
6. easier code review,
7. better error message.

---

## 22. Schema Contract Should Drive Java Mapping

A robust JDBC application should have a schema contract.

Example:

```sql
create table enforcement_case (
    id              number(19, 0)      not null,
    case_no         varchar2(50)       not null,
    status          varchar2(30)       not null,
    created_at      timestamp          not null,
    submitted_at    timestamp          null,
    total_fee       number(19, 2)      not null,
    active_flag     char(1)            not null,
    payload_json    clob               null,
    constraint pk_enforcement_case primary key (id),
    constraint ck_case_status check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
    constraint ck_case_active check (active_flag in ('Y', 'N'))
);
```

Mapping decision table:

| Column | DB Type | Java Domain Type | JDBC Read | JDBC Write | Notes |
|---|---:|---|---|---|---|
| `id` | `NUMBER(19,0)` | `long` / `CaseId` | `getLong + wasNull` | `setLong` | Avoid `int` |
| `case_no` | `VARCHAR2(50)` | `String` / `CaseNo` | `getString` | `setString` | Validate length in domain |
| `status` | `VARCHAR2(30)` | `CaseStatus` | `getString → fromCode` | `setString(status.code())` | No ordinal |
| `created_at` | `TIMESTAMP` | `Instant` or `LocalDateTime` depending convention | tested mapping | tested binding | Define UTC or local convention |
| `submitted_at` | `TIMESTAMP` nullable | nullable temporal | `getObject` or `getTimestamp` | typed null | No primitive equivalent |
| `total_fee` | `NUMBER(19,2)` | `Money` / `BigDecimal` | `getBigDecimal` | `setBigDecimal` | Scale validation |
| `active_flag` | `CHAR(1)` | `boolean` | Y/N mapper | Y/N binder | Constraint required |
| `payload_json` | `CLOB` | JSON domain payload | stream/string based on size | stream/string | Avoid loading if not needed |

This table is not bureaucracy. It prevents production bugs.

---

## 23. Driver-Specific Reality

### 23.1 Oracle

Oracle has rich native type system:

```text
NUMBER
VARCHAR2
NVARCHAR2
DATE
TIMESTAMP
TIMESTAMP WITH TIME ZONE
TIMESTAMP WITH LOCAL TIME ZONE
RAW
BLOB
CLOB
NCLOB
ROWID
STRUCT/OBJECT
ARRAY/VARRAY
REF CURSOR
```

Important Oracle traps:

1. `NUMBER` can map to many Java numeric types.
2. Oracle `DATE` historically contains date and time components, unlike pure date-only semantic in some systems.
3. `TIMESTAMP WITH LOCAL TIME ZONE` has normalization/session behavior that must be understood.
4. CLOB/BLOB handling can have locator/resource implications.
5. REF CURSOR maps to `ResultSet` in stored procedure scenarios.

### 23.2 PostgreSQL

PostgreSQL has native types such as:

```text
uuid
json/jsonb
array
numeric
text
bytea
timestamp
timestamptz
inet
hstore extension
```

Important traps:

1. `timestamp with time zone` / `timestamptz` naming can mislead; understand actual storage/display/session behavior.
2. `uuid` often works well with `UUID`, but test driver mapping.
3. `jsonb` commonly requires `Types.OTHER` or driver-specific handling in plain JDBC.
4. arrays are powerful but reduce portability.
5. `text` often maps as `VARCHAR`/String but has different DB semantics than bounded `varchar(n)`.

### 23.3 MySQL

Important traps:

1. `TINYINT(1)` and boolean mapping.
2. `DATETIME` vs `TIMESTAMP` semantics.
3. zero dates in legacy systems.
4. `DECIMAL` should map to `BigDecimal` for precision.
5. `JSON` native type may appear through driver as String or other representation.
6. Connector/J is flexible in conversions, which is convenient but can hide precision/overflow bugs.

### 23.4 SQL Server

Important traps:

1. `uniqueidentifier` mapping to UUID/String.
2. `datetime` vs `datetime2` precision.
3. `bit` mapping to boolean.
4. `decimal/numeric` precision.
5. `nvarchar` and Unicode behavior.
6. `datetimeoffset` mapping with `OffsetDateTime` depending driver support.

---

## 24. Type Safety at the Domain Boundary

A strong application should not expose primitive obsession everywhere.

Instead of:

```java
record CaseRecord(long id, String status, BigDecimal amount) {}
```

Consider:

```java
record CaseId(long value) {
    CaseId {
        if (value <= 0) {
            throw new IllegalArgumentException("CaseId must be positive");
        }
    }
}

record Money(BigDecimal value) {
    Money {
        Objects.requireNonNull(value, "value");
        value = value.setScale(2, RoundingMode.UNNECESSARY);
    }
}

record CaseRecord(CaseId id, CaseStatus status, Money amount) {}
```

JDBC mapper:

```java
static CaseRecord mapCase(ResultSet rs) throws SQLException {
    return new CaseRecord(
        new CaseId(JdbcColumnReaders.requiredLong(rs, "id")),
        CaseStatus.fromCode(JdbcColumnReaders.requiredString(rs, "status")),
        new Money(JdbcColumnReaders.requiredMoney(rs, "total_fee"))
    );
}
```

This catches invalid data closer to boundary.

Trade-off:

1. more code,
2. more explicit mapping,
3. better invariants,
4. better refactoring safety,
5. better auditability.

For regulatory/lifecycle systems, this is usually worth it for core domain entities.

---

## 25. Type Conversion and Query Plans

Type binding is not only correctness. It can affect performance.

Example:

```sql
where case_no = ?
```

If `case_no` is `VARCHAR`, binding string is expected:

```java
ps.setString(1, caseNo);
```

But if code binds wrong type:

```java
ps.setObject(1, 12345);
```

Database may need implicit conversion:

```sql
to_number(case_no) = 12345
```

Or:

```sql
case_no = to_char(12345)
```

Depending DB, this can:

1. prevent index usage,
2. cause full table scan,
3. throw conversion error for non-numeric rows,
4. produce different cardinality estimate,
5. destabilize query plan.

Another example:

```sql
where created_at >= ?
```

If bound as string:

```java
ps.setString(1, "2026-06-16");
```

The DB may perform implicit date parsing depending session format.

Better:

```java
ps.setObject(1, LocalDate.of(2026, 6, 16), JDBCType.DATE);
```

Or timestamp type as appropriate.

Rule:

```text
Bind values using the same logical type as the indexed column.
```

---

## 26. Length, Precision, and Validation Before Database

Database constraints are necessary, but domain/application validation should catch invalid data before hitting DB when possible.

Example:

```sql
case_no varchar(50) not null
```

Java value:

```java
String caseNo = veryLongInput;
ps.setString(1, caseNo);
```

Possible results:

1. database throws truncation/error,
2. driver throws `DataTruncation`,
3. value is truncated depending DB/config,
4. statement fails late after doing other work.

Better domain value:

```java
record CaseNo(String value) {
    CaseNo {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) {
            throw new IllegalArgumentException("CaseNo must not be blank");
        }
        if (value.length() > 50) {
            throw new IllegalArgumentException("CaseNo too long");
        }
    }
}
```

Then:

```java
ps.setString(1, caseNo.value());
```

Do not rely exclusively on database exception for predictable validation rules.

---

## 27. Typed NULL and Dynamic Query Design

A common bug occurs with optional filters.

Bad:

```sql
where (? is null or status = ?)
```

Java:

```java
ps.setObject(1, status);
ps.setObject(2, status);
```

Issues:

1. untyped null,
2. poor query plan,
3. optimizer may not handle optional predicate well,
4. index usage can degrade,
5. generic query becomes hard to tune.

Better for dynamic search:

```java
StringBuilder sql = new StringBuilder("select * from case where 1=1");
List<SqlBinder> binders = new ArrayList<>();

if (status != null) {
    sql.append(" and status = ?");
    binders.add((ps, i) -> ps.setString(i, status.code()));
}

if (submittedFrom != null) {
    sql.append(" and submitted_at >= ?");
    binders.add((ps, i) -> ps.setObject(i, submittedFrom.atOffset(ZoneOffset.UTC), JDBCType.TIMESTAMP_WITH_TIMEZONE));
}
```

This keeps SQL type and predicates explicit.

---

## 28. Building a Small Type-Safe Binder Abstraction

A practical pattern:

```java
@FunctionalInterface
interface SqlBinder {
    void bind(PreparedStatement ps, int index) throws SQLException;
}
```

Factory:

```java
final class Binders {
    static SqlBinder varchar(String value) {
        return (ps, i) -> {
            if (value == null) ps.setNull(i, Types.VARCHAR);
            else ps.setString(i, value);
        };
    }

    static SqlBinder bigint(Long value) {
        return (ps, i) -> {
            if (value == null) ps.setNull(i, Types.BIGINT);
            else ps.setLong(i, value);
        };
    }

    static SqlBinder decimal(BigDecimal value, int scale) {
        return (ps, i) -> {
            if (value == null) {
                ps.setNull(i, Types.DECIMAL);
            } else {
                ps.setBigDecimal(i, value.setScale(scale, RoundingMode.UNNECESSARY));
            }
        };
    }

    static SqlBinder instantUtc(Instant value) {
        return (ps, i) -> {
            if (value == null) {
                ps.setNull(i, Types.TIMESTAMP_WITH_TIMEZONE);
            } else {
                ps.setObject(i, value.atOffset(ZoneOffset.UTC), JDBCType.TIMESTAMP_WITH_TIMEZONE);
            }
        };
    }
}
```

Usage:

```java
List<SqlBinder> binders = List.of(
    Binders.varchar(caseNo.value()),
    Binders.varchar(status.code()),
    Binders.decimal(amount.value(), 2),
    Binders.instantUtc(clock.instant())
);

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    for (int i = 0; i < binders.size(); i++) {
        binders.get(i).bind(ps, i + 1);
    }
    ps.executeUpdate();
}
```

This is plain JDBC, but much safer than scattered ad-hoc binding.

---

## 29. Reading Rows with Explicit Required/Nullable Contract

A good row mapper should make nullability visible.

Bad:

```java
CaseDto dto = new CaseDto(
    rs.getLong("id"),
    rs.getString("case_no"),
    rs.getString("status"),
    rs.getTimestamp("submitted_at").toInstant()
);
```

Bug: `submitted_at` can be null, so `getTimestamp(...).toInstant()` can NPE.

Better:

```java
static Instant nullableTimestampAsInstant(ResultSet rs, String column) throws SQLException {
    Timestamp ts = rs.getTimestamp(column);
    return ts == null ? null : ts.toInstant();
}
```

Then:

```java
CaseDto dto = new CaseDto(
    new CaseId(JdbcColumnReaders.requiredLong(rs, "id")),
    new CaseNo(JdbcColumnReaders.requiredString(rs, "case_no")),
    CaseStatus.fromCode(JdbcColumnReaders.requiredString(rs, "status")),
    nullableTimestampAsInstant(rs, "submitted_at")
);
```

Even better: encode nullable in domain:

```java
record CaseSubmission(Optional<Instant> submittedAt) {}
```

But do not overuse `Optional` as entity field if your project convention avoids it. The important thing is explicit nullability.

---

## 30. Testing Type Mapping

For every critical table, test type mapping with the actual driver and DB.

### 30.1 Numeric tests

Test:

1. max allowed value,
2. min allowed value,
3. overflow value,
4. scale exact,
5. scale too large,
6. nullable numeric,
7. zero vs null.

Example:

```java
@Test
void moneyScaleMustBeExactlyTwo() {
    assertThrows(ArithmeticException.class, () ->
        new Money(new BigDecimal("10.999"))
    );
}
```

### 30.2 Temporal tests

Test:

1. date-only does not shift,
2. instant round trip remains same instant,
3. nullable timestamp,
4. DST boundary if relevant,
5. JVM timezone changed,
6. DB session timezone changed.

Example concept:

```java
TimeZone original = TimeZone.getDefault();
try {
    TimeZone.setDefault(TimeZone.getTimeZone("Asia/Jakarta"));
    // insert/read

    TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
    // read same row and assert semantic
} finally {
    TimeZone.setDefault(original);
}
```

### 30.3 String tests

Test:

1. max length,
2. over max length,
3. Unicode characters,
4. emoji if supported,
5. trailing spaces,
6. empty string vs null.

Important Oracle-specific note: empty string handling may differ from other databases.

### 30.4 Boolean/flag tests

Test:

1. true,
2. false,
3. null if nullable,
4. invalid DB value if constraint absent,
5. lower-case unexpected value.

---

## 31. Production Failure Examples

### 31.1 `getInt()` hides NULL

Column:

```sql
retry_count integer null
```

Code:

```java
int retryCount = rs.getInt("retry_count");
```

Bug:

```text
NULL becomes 0.
System treats “not configured” as “configured with zero retry”.
```

Fix:

```java
Integer retryCount = rs.getObject("retry_count", Integer.class);
```

Or `wasNull()` helper.

### 31.2 Money rounded silently

Column:

```sql
fee decimal(10, 2)
```

Code:

```java
ps.setBigDecimal(1, new BigDecimal("10.999"));
```

Bug:

```text
Depending DB/driver, value may be rounded/rejected/truncated.
```

Fix:

```java
ps.setBigDecimal(1, fee.setScale(2, RoundingMode.UNNECESSARY));
```

### 31.3 Audit timestamp stored as local time

Code:

```java
ps.setObject(1, LocalDateTime.now());
```

Bug:

```text
Service A runs in UTC.
Service B runs in Asia/Jakarta.
Rows cannot be reliably ordered.
```

Fix:

```java
Instant now = clock.instant();
ps.setObject(1, now.atOffset(ZoneOffset.UTC), JDBCType.TIMESTAMP_WITH_TIMEZONE);
```

Or project-wide UTC timestamp convention.

### 31.4 Dynamic query binds string to date column

Code:

```java
ps.setString(1, "2026-06-16");
```

Bug:

```text
Works in DEV, fails in PROD because session date format differs.
```

Fix:

```java
ps.setObject(1, LocalDate.of(2026, 6, 16), JDBCType.DATE);
```

### 31.5 Enum rename breaks historical data

Old enum:

```java
UNDER_REVIEW
```

New enum:

```java
IN_REVIEW
```

If database stores enum name directly, old rows break.

Fix:

Use stable code and migration strategy:

```java
UNDER_REVIEW("UNDER_REVIEW")
```

Even if Java constant is renamed:

```java
IN_REVIEW("UNDER_REVIEW")
```

---

## 32. Type Mapping Checklist

Use this checklist when reviewing JDBC code.

### 32.1 For every parameter binding

Ask:

1. What is the database column/native type?
2. What JDBC type should represent it?
3. Is the Java value nullable?
4. If nullable, is NULL typed explicitly?
5. Is `setObject()` given a target type where needed?
6. Is precision/scale validated before bind?
7. Is timezone semantic explicit?
8. Is enum/code stable?
9. Is binary/text size bounded?
10. Could binding wrong type hurt index usage?

### 32.2 For every column read

Ask:

1. Is the column nullable?
2. Is primitive getter hiding NULL?
3. Is `getObject(..., TargetClass.class)` supported by this driver?
4. Is BigDecimal scale normalized?
5. Is timestamp semantic preserved?
6. Is CLOB/BLOB loaded safely?
7. Is enum value validated?
8. Is invalid DB state detected early?
9. Is column label stable?
10. Is conversion centralized or scattered?

### 32.3 For every schema change

Ask:

1. Did precision change?
2. Did scale change?
3. Did nullability change?
4. Did length change?
5. Did type family change?
6. Did timezone semantic change?
7. Did enum allowed values change?
8. Did JSON shape become query-critical?
9. Did index depend on type-specific comparison?
10. Did integration tests cover real driver behavior?

---

## 33. Practical Rules of Thumb

1. Use `String` for textual data, but do not use `getString()` for everything.
2. Use `BigDecimal` for money and exact decimal values.
3. Use `long`/`Long` for large identifiers, not `int`, unless schema guarantees integer range.
4. For nullable primitive-like values, use wrapper or `wasNull()` helper.
5. Always bind NULL with explicit SQL/JDBC type.
6. Avoid enum ordinal storage.
7. Use stable string/code for enum-like values.
8. Treat temporal type mapping as architecture decision, not small implementation detail.
9. Store date-only values as date-only types.
10. Store audit/event time as instant semantics.
11. Test temporal mapping with real driver and database.
12. Avoid loading large CLOB/BLOB as `String`/`byte[]` unless bounded.
13. Do not rely on implicit DB conversion for indexed predicates.
14. Centralize conversion rules for core domain types.
15. Document schema-to-Java mapping for critical tables.

---

## 34. Mini Case Study: Regulatory Case Table Mapping

Suppose we have:

```sql
create table regulatory_case (
    case_id              number(19, 0)      not null,
    case_number          varchar2(40)       not null,
    status_code          varchar2(30)       not null,
    assigned_officer_id  number(19, 0)      null,
    created_at           timestamp          not null,
    submitted_at         timestamp          null,
    due_date             date               null,
    penalty_amount       number(19, 2)      null,
    locked_flag          char(1)            not null,
    metadata_json        clob               null,
    version_no           number(19, 0)      not null,
    constraint ck_reg_case_locked check (locked_flag in ('Y', 'N'))
);
```

Possible domain model:

```java
record RegulatoryCase(
    CaseId caseId,
    CaseNumber caseNumber,
    CaseStatus status,
    OfficerId assignedOfficerId,
    Instant createdAt,
    Instant submittedAt,
    LocalDate dueDate,
    Money penaltyAmount,
    boolean locked,
    String metadataJson,
    long version
) {}
```

But note nullable fields:

```text
assignedOfficerId nullable
submittedAt nullable
penaltyAmount nullable
dueDate nullable
metadataJson nullable
```

Maybe better:

```java
record RegulatoryCase(
    CaseId caseId,
    CaseNumber caseNumber,
    CaseStatus status,
    Optional<OfficerId> assignedOfficerId,
    Instant createdAt,
    Optional<Instant> submittedAt,
    Optional<LocalDate> dueDate,
    Optional<Money> penaltyAmount,
    boolean locked,
    Optional<String> metadataJson,
    long version
) {}
```

Mapping code must make those choices explicit.

Example row mapper:

```java
static RegulatoryCase map(ResultSet rs) throws SQLException {
    return new RegulatoryCase(
        new CaseId(JdbcColumnReaders.requiredLong(rs, "case_id")),
        new CaseNumber(JdbcColumnReaders.requiredString(rs, "case_number")),
        CaseStatus.fromCode(JdbcColumnReaders.requiredString(rs, "status_code")),
        Optional.ofNullable(JdbcColumnReaders.nullableLong(rs, "assigned_officer_id"))
            .map(OfficerId::new),
        readRequiredInstant(rs, "created_at"),
        Optional.ofNullable(readNullableInstant(rs, "submitted_at")),
        Optional.ofNullable(rs.getObject("due_date", LocalDate.class)),
        Optional.ofNullable(JdbcColumnReaders.nullableMoney(rs, "penalty_amount"))
            .map(Money::new),
        JdbcColumnReaders.requiredYn(rs, "locked_flag"),
        Optional.ofNullable(rs.getString("metadata_json")),
        JdbcColumnReaders.requiredLong(rs, "version_no")
    );
}
```

This code is longer than naive JDBC, but much more honest.

---

## 35. What Top 1% Engineers Do Differently

A mediocre JDBC implementation asks:

```text
Which getter makes this code compile?
```

A strong JDBC implementation asks:

```text
What is the semantic contract of this value across Java, JDBC, driver, database, query planner, storage, timezone, nullability, precision, and domain invariants?
```

The difference appears in production:

1. fewer timezone bugs,
2. fewer silent NULL bugs,
3. fewer precision bugs,
4. fewer query plan regressions,
5. fewer driver migration surprises,
6. clearer schema contracts,
7. safer refactoring,
8. better incident diagnosis.

Type mapping is not “plumbing”. It is part of your system’s correctness boundary.

---

## 36. Summary

In this part, we learned:

1. JDBC type mapping involves database native type, JDBC generic type, driver conversion type, and application domain type.
2. `java.sql.Types` and `JDBCType` represent generic SQL/JDBC types, not full vendor semantics.
3. Binding and reading are separate directions and not always symmetric.
4. `setObject()` and `getObject()` are powerful but must be used explicitly.
5. SQL NULL requires careful handling, especially with primitive getters.
6. Numeric values need precision and scale discipline.
7. Money should use `BigDecimal`, not `double`.
8. Boolean mapping varies across databases.
9. Temporal mapping must start from business semantic, not class preference.
10. Date-only, local date-time, instant, offset date-time, and zoned date-time are different concepts.
11. Enum, UUID, JSON, XML, CLOB, BLOB, array, and UDT mapping require deliberate design.
12. Type mismatch can affect query plans, not only correctness.
13. Serious systems benefit from centralized JDBC binder/reader helpers.
14. Real driver/database integration tests are mandatory for critical type mapping.

---

## 37. References

1. Java SE 25 API Documentation — `java.sql` package summary.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/package-summary.html

2. Java SE 25 API Documentation — `java.sql.Types`, `JDBCType`, `PreparedStatement`, `ResultSet`.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/package-summary.html

3. Oracle JDBC Developer's Guide — JDBC Reference Information and SQL-JDBC Data Type Mappings.  
   https://docs.oracle.com/en/database/oracle/oracle-database/26/jjdbc/JDBC-reference-information.html

4. MySQL Connector/J Developer Guide — Java, JDBC, and MySQL Types.  
   https://dev.mysql.com/doc/connector-j/en/connector-j-reference-type-conversions.html

5. PostgreSQL JDBC Documentation.  
   https://jdbc.postgresql.org/documentation/

---

## 38. Status Seri

```text
Part 006 dari 029 selesai.
Seri belum selesai.
Part berikutnya: Part 007 — Transaction Fundamentals in JDBC
File berikutnya: learn-java-sql-jdbc-hikaricp-part-007.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: ResultSet Deep Dive: Cursor, Fetching, Streaming, and Memory](./learn-java-sql-jdbc-hikaricp-part-005.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 007 — Transaction Fundamentals in JDBC](./learn-java-sql-jdbc-hikaricp-part-007.md)
