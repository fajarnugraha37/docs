# learn-java-sql-jdbc-hikaricp-part-014

# Part 014 — Metadata APIs: `DatabaseMetaData`, `ResultSetMetaData`, `ParameterMetaData`

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Fokus: Java SQL Package, JDBC, JDBC Driver Behavior, dan HikariCP  
> Posisi: Part 014 dari 029  
> Status seri: belum selesai

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami metadata API JDBC sebagai mekanisme introspection, bukan sebagai sumber kebenaran absolut.
2. Membedakan peran `DatabaseMetaData`, `ResultSetMetaData`, dan `ParameterMetaData`.
3. Menggunakan metadata API untuk schema discovery, capability detection, dynamic mapping, code generation, migration tooling, dan runtime validation.
4. Mengetahui batas portability metadata antar database/driver.
5. Menghindari jebakan production seperti metadata query yang terlalu mahal, pattern pencarian schema yang terlalu luas, result metadata yang misleading, dan parameter metadata yang tidak tersedia.
6. Mendesain abstraction yang aman ketika aplikasi perlu membaca struktur database secara dinamis.

---

## 1. Mental Model: Metadata Adalah Data Tentang Kontrak, Bukan Data Domain

Pada part sebelumnya kita fokus pada data operasional:

```text
SQL query -> ResultSet -> row -> value
```

Metadata berada di level berbeda:

```text
Database / statement / result -> description of structure, capability, and shape
```

Jadi metadata bukan jawaban terhadap pertanyaan bisnis seperti:

```text
Berapa jumlah case yang overdue?
```

Metadata menjawab pertanyaan struktural seperti:

```text
Database ini produk apa?
Schema apa saja yang tersedia?
Table ini punya kolom apa saja?
Kolom ini nullable atau tidak?
Primary key table ini apa?
Result query ini punya berapa kolom?
Kolom ke-2 bertipe SQL apa?
PreparedStatement ini punya berapa parameter?
Database ini support batch update atau tidak?
Database ini support transaction isolation tertentu atau tidak?
```

Model sederhananya:

```text
+---------------------+--------------------------------------------+
| Metadata Object     | Pertanyaan Utama                           |
+---------------------+--------------------------------------------+
| DatabaseMetaData    | Database/driver/schema support apa?        |
| ResultSetMetaData   | Result query ini bentuk kolomnya apa?      |
| ParameterMetaData   | Parameter statement ini bentuknya apa?     |
+---------------------+--------------------------------------------+
```

Metadata API sangat berguna untuk tooling, tetapi berbahaya jika dianggap selalu murah, selalu lengkap, dan selalu konsisten lintas driver.

---

## 2. Posisi Metadata API di JDBC

Di JDBC, metadata API utama adalah:

```java
java.sql.DatabaseMetaData
java.sql.ResultSetMetaData
java.sql.ParameterMetaData
```

Relasinya:

```text
Connection
  └── getMetaData()
        └── DatabaseMetaData

ResultSet
  └── getMetaData()
        └── ResultSetMetaData

PreparedStatement
  └── getParameterMetaData()
        └── ParameterMetaData
```

Secara konseptual:

```text
Connection-level metadata  -> DatabaseMetaData
Result-level metadata      -> ResultSetMetaData
Parameter-level metadata   -> ParameterMetaData
```

Yang perlu langsung diingat:

1. `DatabaseMetaData` biasanya bisa memicu query ke system catalog database.
2. `ResultSetMetaData` biasanya tersedia setelah statement disiapkan/dieksekusi, tergantung driver.
3. `ParameterMetaData` adalah yang paling sering terbatas atau tidak akurat di beberapa driver.
4. Metadata API adalah bagian JDBC standard, tetapi detail realisasinya banyak bergantung pada driver.

---

## 3. `DatabaseMetaData`: Metadata Tentang Database, Driver, dan Capability

`DatabaseMetaData` diperoleh dari `Connection`:

```java
try (Connection connection = dataSource.getConnection()) {
    DatabaseMetaData meta = connection.getMetaData();

    System.out.println(meta.getDatabaseProductName());
    System.out.println(meta.getDatabaseProductVersion());
    System.out.println(meta.getDriverName());
    System.out.println(meta.getDriverVersion());
}
```

`DatabaseMetaData` menjawab beberapa kategori pertanyaan besar:

```text
1. Identity
   - Database product name
   - Database product version
   - Driver name
   - Driver version
   - JDBC major/minor version

2. Capability
   - Supports transactions?
   - Supports batch updates?
   - Supports savepoints?
   - Supports stored procedures?
   - Supports result set type?
   - Supports isolation level?

3. Naming and syntax rules
   - Identifier quote string
   - SQL keywords
   - Catalog/schema support
   - Case sensitivity

4. Schema structure
   - Catalogs
   - Schemas
   - Tables
   - Columns
   - Primary keys
   - Foreign keys
   - Indexes
   - Procedures/functions
```

---

## 4. Kenapa `DatabaseMetaData` Penting?

Dalam aplikasi biasa, kamu mungkin jarang memanggil `DatabaseMetaData` secara langsung. Namun banyak tool penting bergantung pada API ini atau konsep serupa:

1. Migration tool.
2. ORM schema validator.
3. Code generator.
4. Admin console.
5. Dynamic report builder.
6. Low-code/internal tooling.
7. Data catalog.
8. Schema diff tool.
9. JDBC driver compatibility checker.
10. Application startup validation.

Contoh penggunaan nyata:

```text
- Cek apakah table tertentu sudah ada sebelum menjalankan setup.
- Generate Java record/DTO dari table structure.
- Validasi bahwa migration sudah menambahkan kolom wajib.
- Deteksi primary key untuk generic repository tool.
- Menentukan apakah database support batch update.
- Menentukan apakah driver support generated keys.
- Menampilkan dynamic result table di UI admin.
```

Tetapi di production business path, metadata call harus hati-hati karena bisa mahal dan unpredictable.

---

## 5. Capability Detection

Salah satu kegunaan paling aman dari `DatabaseMetaData` adalah capability detection.

Contoh:

```java
try (Connection connection = dataSource.getConnection()) {
    DatabaseMetaData meta = connection.getMetaData();

    boolean supportsBatch = meta.supportsBatchUpdates();
    boolean supportsTransactions = meta.supportsTransactions();
    boolean supportsSavepoints = meta.supportsSavepoints();
    boolean supportsGeneratedKeys = meta.supportsGetGeneratedKeys();

    System.out.printf("batch=%s tx=%s savepoint=%s generatedKeys=%s%n",
            supportsBatch,
            supportsTransactions,
            supportsSavepoints,
            supportsGeneratedKeys);
}
```

Namun jangan membuat kesimpulan terlalu jauh.

Jika `supportsBatchUpdates()` bernilai `true`, itu hanya berarti driver/database mengklaim support batch update. Itu tidak otomatis berarti:

```text
- batch tersebut optimal,
- batch akan direwrite menjadi multi-row insert,
- generated keys batch akan reliable,
- partial failure behavior sama antar database,
- semua SQL statement cocok dibatch.
```

Capability detection menjawab pertanyaan:

```text
Apakah fitur ini tersedia secara kontrak?
```

Bukan:

```text
Apakah fitur ini performanya bagus untuk workload saya?
```

Untuk performa, tetap perlu benchmark.

---

## 6. Database Identity: Berguna, Tapi Jangan Overfit

Contoh:

```java
String product = meta.getDatabaseProductName();
String version = meta.getDatabaseProductVersion();
String driver = meta.getDriverName();
String driverVersion = meta.getDriverVersion();
```

Ini berguna untuk logging startup:

```text
Connected to PostgreSQL 17.x using PostgreSQL JDBC Driver 42.x
Connected to Oracle Database 19c using Oracle JDBC driver xx.x
Connected to MySQL 8.x using MySQL Connector/J xx.x
```

Tetapi jangan membuat business logic terlalu bergantung pada string produk mentah.

Contoh yang rapuh:

```java
if (meta.getDatabaseProductName().equals("PostgreSQL")) {
    // do vendor-specific behavior
}
```

Lebih baik isolate vendor-specific behavior:

```java
enum DatabaseDialect {
    POSTGRESQL,
    ORACLE,
    MYSQL,
    SQL_SERVER,
    UNKNOWN
}
```

Lalu mapping string metadata dilakukan satu kali di boundary:

```java
static DatabaseDialect detectDialect(DatabaseMetaData meta) throws SQLException {
    String name = meta.getDatabaseProductName().toLowerCase(Locale.ROOT);

    if (name.contains("postgresql")) return DatabaseDialect.POSTGRESQL;
    if (name.contains("oracle")) return DatabaseDialect.ORACLE;
    if (name.contains("mysql")) return DatabaseDialect.MYSQL;
    if (name.contains("microsoft sql server")) return DatabaseDialect.SQL_SERVER;

    return DatabaseDialect.UNKNOWN;
}
```

Prinsipnya:

```text
Metadata boleh dipakai untuk mendeteksi environment.
Jangan sebarkan string detection di seluruh codebase.
```

---

## 7. Schema, Catalog, dan Table: Jangan Samakan Antar Database

Salah satu sumber kebingungan terbesar adalah istilah:

```text
catalog
schema
table
```

Di JDBC, banyak method memakai parameter:

```java
getTables(String catalog, String schemaPattern, String tableNamePattern, String[] types)
getColumns(String catalog, String schemaPattern, String tableNamePattern, String columnNamePattern)
getPrimaryKeys(String catalog, String schema, String table)
getImportedKeys(String catalog, String schema, String table)
```

Tetapi mapping-nya berbeda antar database.

Contoh mental model umum:

```text
PostgreSQL:
  database ~ catalog
  schema   ~ schema
  table    ~ table

Oracle:
  schema sering setara dengan owner/user
  catalog biasanya tidak digunakan seperti PostgreSQL

MySQL:
  database sering diperlakukan seperti catalog
  schema sering alias database
```

Jadi kode metadata yang portable harus menghindari asumsi bahwa `catalog` dan `schema` selalu berarti hal yang sama.

---

## 8. Mengambil Daftar Table

Contoh dasar:

```java
try (Connection connection = dataSource.getConnection()) {
    DatabaseMetaData meta = connection.getMetaData();

    try (ResultSet tables = meta.getTables(null, "PUBLIC", "%", new String[] {"TABLE"})) {
        while (tables.next()) {
            String tableCatalog = tables.getString("TABLE_CAT");
            String tableSchema = tables.getString("TABLE_SCHEM");
            String tableName = tables.getString("TABLE_NAME");
            String tableType = tables.getString("TABLE_TYPE");

            System.out.printf("%s.%s.%s [%s]%n",
                    tableCatalog,
                    tableSchema,
                    tableName,
                    tableType);
        }
    }
}
```

Penting:

1. `getTables(...)` mengembalikan `ResultSet` metadata, bukan list biasa.
2. Kolom hasil metadata punya nama standar tertentu seperti `TABLE_CAT`, `TABLE_SCHEM`, `TABLE_NAME`, `TABLE_TYPE`.
3. Driver boleh menambahkan kolom ekstra.
4. Untuk kolom standar, gunakan column label, bukan index.

Kenapa column label lebih aman?

```java
String tableName = tables.getString("TABLE_NAME");
```

Lebih jelas daripada:

```java
String tableName = tables.getString(3);
```

Karena metadata result set memang struktur kontrak-nya berbasis kolom bernama.

---

## 9. Pattern Parameter Bisa Sangat Mahal

Method seperti ini tampak sederhana:

```java
meta.getTables(null, null, "%", new String[] {"TABLE"});
```

Namun ini bisa berarti:

```text
Ambil semua table yang terlihat oleh user ini di semua schema yang relevan.
```

Di database besar, itu bisa mahal.

Lebih buruk lagi:

```java
meta.getColumns(null, null, "%", "%");
```

Ini berpotensi membaca metadata seluruh kolom dari banyak schema/table.

Di production database dengan ribuan table, view, synonym, dan privilege, metadata query dapat menjadi lambat dan berat.

Prinsip aman:

```text
Selalu persempit metadata query.
```

Lebih baik:

```java
meta.getColumns(null, "ACEAS", "CASE_APPLICATION", "%");
```

Daripada:

```java
meta.getColumns(null, null, "%", "%");
```

Checklist:

```text
- Tentukan schema jika bisa.
- Tentukan table jika bisa.
- Tentukan type jika bisa.
- Hindari wildcard luas di runtime path.
- Cache hasil metadata jika struktur jarang berubah.
- Jangan panggil metadata query per request kecuali benar-benar perlu.
```

---

## 10. Mengambil Column Metadata

Contoh:

```java
try (Connection connection = dataSource.getConnection()) {
    DatabaseMetaData meta = connection.getMetaData();

    try (ResultSet columns = meta.getColumns(null, "ACEAS", "CASE_APPLICATION", "%")) {
        while (columns.next()) {
            String columnName = columns.getString("COLUMN_NAME");
            int dataType = columns.getInt("DATA_TYPE");
            String typeName = columns.getString("TYPE_NAME");
            int columnSize = columns.getInt("COLUMN_SIZE");
            int decimalDigits = columns.getInt("DECIMAL_DIGITS");
            int nullable = columns.getInt("NULLABLE");

            System.out.printf("%s %s jdbcType=%d size=%d scale=%d nullable=%d%n",
                    columnName,
                    typeName,
                    dataType,
                    columnSize,
                    decimalDigits,
                    nullable);
        }
    }
}
```

`DATA_TYPE` biasanya merujuk ke konstanta `java.sql.Types`:

```java
Types.VARCHAR
Types.INTEGER
Types.TIMESTAMP
Types.CLOB
Types.NUMERIC
```

Tetapi `TYPE_NAME` adalah nama tipe vendor/database:

```text
PostgreSQL: varchar, int4, timestamptz, jsonb
Oracle: VARCHAR2, NUMBER, TIMESTAMP, CLOB
MySQL: VARCHAR, INT, DATETIME, JSON
```

Mental model:

```text
DATA_TYPE -> tipe JDBC standard-ish
TYPE_NAME -> tipe vendor/database actual
```

Untuk portability, jangan hanya simpan salah satu. Simpan keduanya jika membangun schema tooling.

---

## 11. Nullability Metadata Tidak Selalu Berarti Runtime Value Tidak Null

Column metadata biasanya memberi informasi:

```java
int nullable = columns.getInt("NULLABLE");
```

Nilainya dapat dibandingkan dengan:

```java
DatabaseMetaData.columnNoNulls
DatabaseMetaData.columnNullable
DatabaseMetaData.columnNullableUnknown
```

Namun ada beberapa jebakan:

1. Kolom `NOT NULL` di table bisa menjadi nullable dalam hasil query karena outer join.
2. Expression seperti `COUNT(*)` punya metadata berbeda dari table column.
3. View dapat menyembunyikan constraint asli.
4. Driver mungkin tidak tahu nullability expression.
5. `columnNullableUnknown` harus diperlakukan sebagai unknown, bukan nullable atau non-nullable.

Contoh:

```sql
SELECT c.case_id, a.appeal_id
FROM case c
LEFT JOIN appeal a ON a.case_id = c.case_id
```

`appeal_id` mungkin berasal dari kolom `appeal.appeal_id NOT NULL`, tetapi karena `LEFT JOIN`, hasil query bisa `NULL`.

Jadi metadata table-level tidak otomatis sama dengan metadata result-level.

---

## 12. Primary Key Metadata

Contoh:

```java
try (ResultSet pk = meta.getPrimaryKeys(null, "ACEAS", "CASE_APPLICATION")) {
    while (pk.next()) {
        String columnName = pk.getString("COLUMN_NAME");
        short keySeq = pk.getShort("KEY_SEQ");
        String pkName = pk.getString("PK_NAME");

        System.out.printf("pk=%s column=%s seq=%d%n", pkName, columnName, keySeq);
    }
}
```

Primary key bisa composite:

```text
PK_ORDER_LINE(order_id, line_no)
```

Jangan asumsikan primary key selalu satu kolom bernama `id`.

Untuk generic tooling, simpan urutan `KEY_SEQ`:

```java
record PrimaryKeyColumn(
        String pkName,
        String columnName,
        short keySeq
) {}
```

Lalu sort by `keySeq`.

---

## 13. Foreign Key Metadata

Ada dua arah utama:

```java
getImportedKeys(catalog, schema, table)
getExportedKeys(catalog, schema, table)
```

Mental model:

```text
Imported keys:
  FK yang dimiliki table ini, menunjuk ke table lain.

Exported keys:
  FK dari table lain yang menunjuk ke table ini.
```

Contoh:

```text
CASE_APPLICATION(id)
CASE_DOCUMENT(case_id -> CASE_APPLICATION.id)
```

Untuk `CASE_DOCUMENT`:

```text
imported key = case_id -> CASE_APPLICATION.id
```

Untuk `CASE_APPLICATION`:

```text
exported key = CASE_DOCUMENT.case_id -> id
```

Contoh kode:

```java
try (ResultSet fks = meta.getImportedKeys(null, "ACEAS", "CASE_DOCUMENT")) {
    while (fks.next()) {
        String fkName = fks.getString("FK_NAME");
        String fkColumn = fks.getString("FKCOLUMN_NAME");
        String pkTable = fks.getString("PKTABLE_NAME");
        String pkColumn = fks.getString("PKCOLUMN_NAME");
        short keySeq = fks.getShort("KEY_SEQ");

        System.out.printf("%s: %s -> %s.%s seq=%d%n",
                fkName,
                fkColumn,
                pkTable,
                pkColumn,
                keySeq);
    }
}
```

Use case:

1. Dependency graph.
2. Delete ordering.
3. Data archival planning.
4. ERD generator.
5. Impact analysis.
6. Referential integrity validation.

Namun constraint tidak selalu lengkap di database legacy. Banyak sistem enterprise punya relasi logis yang tidak dideklarasikan sebagai FK fisik.

Jadi:

```text
FK metadata tells declared relationship, not all real business relationship.
```

---

## 14. Index Metadata

Contoh:

```java
try (ResultSet indexes = meta.getIndexInfo(null, "ACEAS", "CASE_APPLICATION", false, false)) {
    while (indexes.next()) {
        String indexName = indexes.getString("INDEX_NAME");
        boolean nonUnique = indexes.getBoolean("NON_UNIQUE");
        String columnName = indexes.getString("COLUMN_NAME");
        short ordinal = indexes.getShort("ORDINAL_POSITION");

        System.out.printf("index=%s column=%s ordinal=%d nonUnique=%s%n",
                indexName,
                columnName,
                ordinal,
                nonUnique);
    }
}
```

Index metadata berguna untuk:

```text
- schema review,
- migration validation,
- query plan readiness,
- uniqueness detection,
- reporting expected access path,
- impact analysis sebelum drop column/table.
```

Namun jangan pakai index metadata untuk menyimpulkan performa query secara final. Index ada belum tentu optimizer memilih index tersebut.

Yang metadata tidak beri secara lengkap:

```text
- histogram,
- cardinality aktual terbaru,
- clustering factor,
- table bloat,
- partition pruning,
- bind selectivity,
- stale statistics,
- execution plan aktual.
```

Jadi index metadata menjawab:

```text
Index apa yang ada?
```

Bukan:

```text
Query ini pasti cepat?
```

---

## 15. `ResultSetMetaData`: Shape dari Hasil Query

`ResultSetMetaData` diperoleh dari `ResultSet`:

```java
try (PreparedStatement ps = connection.prepareStatement("SELECT id, name FROM users")) {
    try (ResultSet rs = ps.executeQuery()) {
        ResultSetMetaData meta = rs.getMetaData();
        int columnCount = meta.getColumnCount();

        for (int i = 1; i <= columnCount; i++) {
            System.out.printf("%d label=%s name=%s type=%s%n",
                    i,
                    meta.getColumnLabel(i),
                    meta.getColumnName(i),
                    meta.getColumnTypeName(i));
        }
    }
}
```

Perhatikan index JDBC dimulai dari 1, bukan 0.

```java
for (int i = 1; i <= columnCount; i++) {
    // correct
}
```

Bukan:

```java
for (int i = 0; i < columnCount; i++) {
    // wrong for JDBC column access
}
```

---

## 16. Column Name vs Column Label

Ini penting.

```java
meta.getColumnName(i)
meta.getColumnLabel(i)
```

Mental model:

```text
Column name  -> nama kolom asal, jika diketahui.
Column label -> nama yang seharusnya digunakan untuk display/access; biasanya alias SQL.
```

Contoh:

```sql
SELECT case_id AS id, applicant_name AS name
FROM case_application
```

Kemungkinan:

```text
getColumnName(1)  -> case_id
getColumnLabel(1) -> id
getColumnName(2)  -> applicant_name
getColumnLabel(2) -> name
```

Untuk dynamic mapper, biasanya gunakan `getColumnLabel`, karena user/query memilih alias.

Contoh:

```java
String key = meta.getColumnLabel(i);
Object value = rs.getObject(i);
row.put(key, value);
```

Jika pakai `getColumnName`, query expression/alias bisa kacau.

Contoh:

```sql
SELECT COUNT(*) AS total FROM case_application
```

Untuk expression seperti `COUNT(*)`, `getColumnName()` bisa tidak berguna atau driver-specific. `getColumnLabel()` lebih sesuai karena alias `total` adalah kontrak output query.

---

## 17. Dynamic Result Mapper

Salah satu use case `ResultSetMetaData` adalah dynamic result mapping.

Contoh sederhana:

```java
public static List<Map<String, Object>> queryAsMaps(
        Connection connection,
        String sql
) throws SQLException {
    try (PreparedStatement ps = connection.prepareStatement(sql);
         ResultSet rs = ps.executeQuery()) {

        ResultSetMetaData meta = rs.getMetaData();
        int columnCount = meta.getColumnCount();

        List<Map<String, Object>> rows = new ArrayList<>();

        while (rs.next()) {
            Map<String, Object> row = new LinkedHashMap<>();

            for (int i = 1; i <= columnCount; i++) {
                String label = meta.getColumnLabel(i);
                Object value = rs.getObject(i);
                row.put(label, value);
            }

            rows.add(row);
        }

        return rows;
    }
}
```

Ini berguna untuk:

```text
- admin query tool,
- generic report preview,
- dynamic CSV export,
- debugging utility,
- migration inspection.
```

Namun buruk untuk core domain code jika semua query diproses sebagai `Map<String, Object>`.

Kenapa?

```text
- Tidak ada compile-time safety.
- Rename kolom baru gagal di runtime.
- Type conversion tersebar.
- Refactoring sulit.
- Domain invariant tidak jelas.
```

Untuk business-critical path, lebih baik explicit mapper.

---

## 18. ResultSet Metadata Tidak Sama dengan Table Metadata

Contoh:

```sql
SELECT
    c.case_id,
    c.status,
    COUNT(d.id) AS document_count
FROM case_application c
LEFT JOIN document d ON d.case_id = c.case_id
GROUP BY c.case_id, c.status
```

`ResultSetMetaData` menjelaskan hasil query:

```text
case_id
status
document_count
```

Bukan struktur table asli secara penuh.

Ia tidak menjawab:

```text
Table CASE_APPLICATION punya semua kolom apa?
Document table punya FK apa?
Index apa yang tersedia?
```

Untuk itu gunakan `DatabaseMetaData` atau system catalog.

Perbedaan:

```text
DatabaseMetaData:
  struktur database/catalog/schema/table.

ResultSetMetaData:
  struktur hasil query tertentu.
```

---

## 19. Type Info di `ResultSetMetaData`

Method penting:

```java
int sqlType = meta.getColumnType(i);
String typeName = meta.getColumnTypeName(i);
String className = meta.getColumnClassName(i);
int precision = meta.getPrecision(i);
int scale = meta.getScale(i);
int displaySize = meta.getColumnDisplaySize(i);
boolean nullable = meta.isNullable(i) == ResultSetMetaData.columnNullable;
boolean autoIncrement = meta.isAutoIncrement(i);
boolean signed = meta.isSigned(i);
```

Contoh output:

```text
label=amount
sqlType=2              // Types.NUMERIC
vendorType=NUMBER
className=java.math.BigDecimal
precision=18
scale=2
```

Gunakan metadata ini untuk dynamic renderer atau exporter.

Contoh:

```text
- Jika sqlType numeric, align kanan di CSV preview.
- Jika sqlType timestamp, format sebagai ISO-8601.
- Jika sqlType CLOB, jangan materialize penuh di preview.
- Jika sqlType BLOB, tampilkan placeholder.
```

Namun untuk domain mapper, tetap lebih aman explicit type mapping.

---

## 20. `getColumnClassName()` Harus Dipakai Hati-Hati

`getColumnClassName(i)` memberi nama class Java yang akan dipakai `ResultSet.getObject(i)` menurut driver.

Contoh kemungkinan:

```text
java.lang.String
java.lang.Integer
java.lang.Long
java.math.BigDecimal
java.sql.Timestamp
java.time.LocalDateTime
byte[]
```

Namun ini bergantung driver dan versi JDBC.

Jangan jadikan `getColumnClassName()` sebagai kontrak domain yang permanen.

Lebih aman:

```text
For dynamic tool:
  boleh dipakai sebagai hint.

For domain logic:
  gunakan explicit getter atau explicit conversion.
```

---

## 21. `ParameterMetaData`: Metadata Tentang Placeholder `?`

`ParameterMetaData` diperoleh dari `PreparedStatement`:

```java
try (PreparedStatement ps = connection.prepareStatement(
        "SELECT * FROM users WHERE status = ? AND created_at >= ?"
)) {
    ParameterMetaData pmeta = ps.getParameterMetaData();
    int count = pmeta.getParameterCount();

    for (int i = 1; i <= count; i++) {
        int type = pmeta.getParameterType(i);
        String typeName = pmeta.getParameterTypeName(i);
        int mode = pmeta.getParameterMode(i);

        System.out.printf("param %d type=%d typeName=%s mode=%d%n",
                i,
                type,
                typeName,
                mode);
    }
}
```

Secara teori, ini berguna untuk:

```text
- dynamic SQL builder validation,
- generic bind UI,
- stored procedure tooling,
- prepared statement inspection,
- diagnostics.
```

Namun dalam praktik, `ParameterMetaData` sering lebih terbatas dibanding `DatabaseMetaData` dan `ResultSetMetaData`.

---

## 22. Kenapa `ParameterMetaData` Sering Tidak Reliable?

Parameter placeholder `?` tidak selalu punya tipe yang bisa diketahui sebelum bind atau execute.

Contoh:

```sql
SELECT * FROM users WHERE id = ?
```

Jika driver melakukan parse/describe ke server, mungkin tipe `id` bisa diketahui.

Tetapi untuk query seperti:

```sql
SELECT ?
```

Tipe parameter tidak jelas.

Atau:

```sql
SELECT * FROM case_application WHERE created_at >= ?
```

Driver mungkin perlu bertanya ke database untuk mengetahui tipe `created_at`, atau mungkin tidak melakukan itu karena mahal.

Beberapa alasan keterbatasan:

1. Driver tidak melakukan server-side prepare saat `prepareStatement()`.
2. Driver menunda parse sampai execute.
3. Database protocol tidak menyediakan info parameter dengan mudah.
4. SQL mengandung expression ambigu.
5. Parameter berada di posisi yang tidak menentukan tipe secara tunggal.
6. Driver memilih mengembalikan `Types.OTHER` atau melempar `SQLFeatureNotSupportedException`.

Prinsip:

```text
ParameterMetaData is useful when available, but must not be the only source of truth for binding correctness.
```

Untuk application code, lebih baik kamu tahu tipe parameter dari query contract.

---

## 23. Metadata API dan Driver-Specific Behavior

JDBC metadata API memberikan interface umum, tetapi implementasi berbeda.

Contoh perbedaan yang mungkin muncul:

```text
- Schema/catalog interpretation berbeda.
- Case sensitivity nama table/kolom berbeda.
- Pattern matching `%` dan `_` mengikuti aturan metadata API, bukan selalu SQL LIKE biasa.
- Table type berbeda: TABLE, VIEW, SYSTEM TABLE, SYNONYM, MATERIALIZED VIEW.
- Oracle synonym bisa muncul/atau tidak tergantung driver/config/privilege.
- PostgreSQL schema visibility bergantung search_path dan privilege.
- MySQL database/schema/catalog naming berbeda.
- ParameterMetaData bisa lengkap di satu driver, terbatas di driver lain.
- ResultSetMetaData untuk expression bisa memberi type/label berbeda.
```

Karena itu metadata-based tooling harus punya test matrix per database yang didukung.

---

## 24. Case Sensitivity dan Identifier Normalization

Database punya aturan identifier berbeda.

Contoh umum:

```text
PostgreSQL unquoted identifiers -> lower-case
Oracle unquoted identifiers     -> upper-case
MySQL behavior                  -> dipengaruhi filesystem/config untuk table name
```

`DatabaseMetaData` menyediakan method seperti:

```java
meta.storesLowerCaseIdentifiers();
meta.storesUpperCaseIdentifiers();
meta.storesMixedCaseIdentifiers();
meta.supportsMixedCaseQuotedIdentifiers();
meta.getIdentifierQuoteString();
```

Gunakan ini untuk tooling.

Contoh:

```java
String quote = meta.getIdentifierQuoteString();
```

Namun hati-hati: quote string bisa berupa spasi jika quoting tidak didukung atau tidak relevan menurut driver.

Untuk aplikasi production, strategi terbaik:

```text
- Standardisasi naming convention.
- Hindari quoted identifiers kecuali benar-benar perlu.
- Hindari nama table/kolom case-sensitive.
- Jangan buat object name yang butuh escape rumit.
```

Jangan membangun sistem yang sangat bergantung pada nama kolom seperti:

```sql
"CaseStatus"
"User"
"Order"
```

Itu meningkatkan friction di SQL, tooling, migration, metadata, dan portability.

---

## 25. Metadata ResultSet Adalah Resource

Banyak method `DatabaseMetaData` mengembalikan `ResultSet`.

Contoh:

```java
ResultSet tables = meta.getTables(...);
```

Ini tetap resource JDBC.

Artinya harus ditutup:

```java
try (ResultSet tables = meta.getTables(null, schema, "%", new String[] {"TABLE"})) {
    while (tables.next()) {
        // read metadata
    }
}
```

Jangan:

```java
ResultSet tables = meta.getTables(null, schema, "%", null);
while (tables.next()) {
    // read
}
// forgot close
```

Metadata leak tetap bisa menyebabkan:

```text
- cursor leak,
- statement leak internal,
- connection tidak cepat kembali sehat,
- resource pressure di driver/database.
```

---

## 26. Metadata Query Bisa Memakai Connection yang Sama

`DatabaseMetaData` berasal dari `Connection`.

Artinya metadata query memakai session/context connection tersebut.

Konsekuensi:

1. Privilege metadata sesuai user connection.
2. Current schema/search path bisa memengaruhi hasil tertentu.
3. Transaction visibility bisa berpengaruh di beberapa database.
4. Metadata query ikut memakai resource connection yang sedang dipinjam.
5. Jika dilakukan di tengah transaction bisnis, bisa memperpanjang transaction.

Anti-pattern:

```java
connection.setAutoCommit(false);
performBusinessUpdate(connection);
validateSchemaWithManyMetadataQueries(connection);
connection.commit();
```

Kenapa buruk?

```text
Business transaction menjadi lebih panjang.
Lock ditahan lebih lama.
Pool connection dipinjam lebih lama.
Metadata query bisa lambat.
Failure metadata bisa membatalkan transaction bisnis.
```

Lebih baik schema validation dilakukan saat startup atau maintenance path, bukan di dalam transaction bisnis.

---

## 27. Startup Validation dengan Metadata

Metadata sering dipakai saat startup untuk memastikan database sesuai ekspektasi.

Contoh sederhana:

```java
public final class SchemaValidator {
    private final DataSource dataSource;

    public SchemaValidator(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public void validateRequiredColumns() throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            DatabaseMetaData meta = connection.getMetaData();

            Set<String> columns = new HashSet<>();

            try (ResultSet rs = meta.getColumns(null, "ACEAS", "CASE_APPLICATION", "%")) {
                while (rs.next()) {
                    columns.add(rs.getString("COLUMN_NAME").toUpperCase(Locale.ROOT));
                }
            }

            require(columns, "CASE_ID");
            require(columns, "STATUS");
            require(columns, "CREATED_DATE_TIME");
        }
    }

    private static void require(Set<String> columns, String column) {
        if (!columns.contains(column)) {
            throw new IllegalStateException("Missing required column: " + column);
        }
    }
}
```

Kapan ini masuk akal?

```text
- Internal platform yang harus validasi database eksternal.
- Plugin architecture.
- Multi-tenant schema yang dibuat dinamis.
- Legacy database yang migration ownership-nya tidak penuh.
```

Kapan tidak perlu?

```text
- Aplikasi normal dengan migration tool kuat seperti Flyway/Liquibase.
- Schema dikontrol penuh oleh deployment pipeline.
- Validasi metadata membuat startup lambat tanpa benefit nyata.
```

---

## 28. Code Generation dan Metadata

Metadata berguna untuk code generation.

Contoh pipeline:

```text
DatabaseMetaData.getTables()
  -> list table
DatabaseMetaData.getColumns()
  -> list column
DatabaseMetaData.getPrimaryKeys()
  -> PK
DatabaseMetaData.getImportedKeys()
  -> FK
Generate:
  - Java record/entity
  - mapper
  - query DSL
  - documentation
  - dependency graph
```

Namun generator serius biasanya tidak hanya memakai JDBC metadata. Ia sering juga membaca system catalog langsung karena butuh detail vendor-specific:

```text
- PostgreSQL enum/jsonb/array/domain type,
- Oracle sequence/synonym/package/object type,
- MySQL unsigned/generated column/collation,
- SQL Server identity/computed column/schema details.
```

JDBC metadata memberi baseline portable. System catalog memberi detail presisi.

---

## 29. Metadata untuk Dynamic UI dan Report Builder

Misalnya kamu membangun internal reporting tool:

```text
User memilih query -> backend execute -> UI render table result dinamis
```

`ResultSetMetaData` membantu menentukan:

```text
- jumlah kolom,
- label kolom,
- tipe kolom,
- display size,
- numeric/date/binary/text rendering,
- export behavior.
```

Contoh safe preview:

```java
public static List<ColumnDescriptor> describe(ResultSet rs) throws SQLException {
    ResultSetMetaData meta = rs.getMetaData();
    int count = meta.getColumnCount();

    List<ColumnDescriptor> columns = new ArrayList<>();

    for (int i = 1; i <= count; i++) {
        columns.add(new ColumnDescriptor(
                i,
                meta.getColumnLabel(i),
                meta.getColumnType(i),
                meta.getColumnTypeName(i),
                meta.getPrecision(i),
                meta.getScale(i),
                meta.isNullable(i)
        ));
    }

    return columns;
}

record ColumnDescriptor(
        int index,
        String label,
        int jdbcType,
        String vendorType,
        int precision,
        int scale,
        int nullable
) {}
```

Dynamic UI harus tetap punya guardrail:

```text
- max rows,
- query timeout,
- read-only connection,
- allowed schema/table whitelist,
- no arbitrary DML/DDL,
- LOB preview limit,
- audit logging,
- PII masking.
```

Metadata membantu rendering, bukan menggantikan authorization.

---

## 30. Metadata dan Security

Metadata dapat membocorkan struktur database.

Contoh informasi sensitif:

```text
- table name,
- column name,
- relationship,
- audit table,
- user/role-related table,
- token/session table,
- hidden operational table,
- naming of sensitive domain concepts.
```

Jadi jangan expose metadata API mentah ke user/client.

Anti-pattern:

```http
GET /api/metadata/tables
GET /api/metadata/columns?schema=...
```

Jika endpoint seperti itu ada, pastikan:

```text
- authentication kuat,
- authorization granular,
- schema whitelist,
- table whitelist,
- rate limit,
- audit log,
- no system schema exposure,
- no internal credential/session table exposure,
- no sensitive column detail for unauthorized users.
```

Metadata adalah attack surface.

---

## 31. Metadata dan Performance: Hidden Query Cost

Banyak developer mengira:

```java
connection.getMetaData()
```

hanya membaca object lokal dari driver. Kadang benar untuk sebagian field, tetapi banyak method metadata melakukan query ke system catalog.

Contoh metadata calls yang bisa berat:

```java
meta.getTables(null, null, "%", null);
meta.getColumns(null, null, "%", "%");
meta.getImportedKeys(null, null, table);
meta.getIndexInfo(null, schema, table, false, false);
```

Kemungkinan cost:

```text
- query system catalog,
- join catalog table internal,
- filter privilege,
- resolve synonym/view,
- network round-trip,
- sort result metadata,
- materialize banyak row metadata.
```

Praktik production:

```text
Do:
  - run metadata discovery at startup/admin path,
  - cache result,
  - restrict schema/table pattern,
  - use timeout if possible,
  - monitor slow metadata operations.

Don't:
  - call broad metadata query per request,
  - discover entire database repeatedly,
  - run metadata query inside hot transaction,
  - expose metadata discovery to untrusted users.
```

---

## 32. Caching Metadata

Schema biasanya berubah lebih jarang dibanding request traffic.

Jadi metadata bisa dicache:

```text
Application startup:
  read required metadata
  build immutable schema model
  use cached model at runtime
```

Contoh model:

```java
record TableModel(
        String schema,
        String name,
        List<ColumnModel> columns,
        List<String> primaryKeyColumns
) {}

record ColumnModel(
        String name,
        int jdbcType,
        String vendorType,
        int size,
        int scale,
        boolean nullable
) {}
```

Cache invalidation strategy:

```text
- Reload on application restart.
- Reload after migration completion.
- Reload through admin-only endpoint.
- Version cache by schema migration version.
- Avoid auto-refresh per request.
```

Jika memakai Flyway/Liquibase, metadata cache bisa dikaitkan dengan migration version.

---

## 33. Metadata dan Migration Tooling

Migration tool perlu tahu struktur sebelum/sesudah perubahan.

Contoh validasi pasca migration:

```text
Expected:
  table CASE_APPLICATION has column INTERNET_SOURCE nullable=false
  index IDX_CASE_APP_STATUS_CREATED exists
  FK CASE_DOCUMENT.CASE_ID -> CASE_APPLICATION.CASE_ID exists

Actual:
  read via metadata/system catalog

Compare:
  fail deployment if mismatch
```

Namun untuk migration serius, jangan hanya bergantung pada metadata JDBC portable. Vendor-specific DDL detail sering hilang.

Contoh detail yang mungkin tidak cukup dari standard metadata:

```text
- check constraint expression,
- partial index predicate,
- function-based index expression,
- partition definition,
- trigger body,
- generated column expression,
- identity/sequence behavior detail,
- materialized view refresh mode,
- tablespace/storage parameter.
```

JDBC metadata cocok untuk baseline validation. Untuk full schema diff, baca system catalog vendor.

---

## 34. Metadata dan `unwrap()`

Karena JDBC interface umum tidak selalu cukup, driver bisa menyediakan class vendor-specific.

JDBC menyediakan `Wrapper`:

```java
<T> T unwrap(Class<T> iface) throws SQLException;
boolean isWrapperFor(Class<?> iface) throws SQLException;
```

Contoh konseptual:

```java
DatabaseMetaData meta = connection.getMetaData();

if (meta.isWrapperFor(oracle.jdbc.OracleDatabaseMetaData.class)) {
    oracle.jdbc.OracleDatabaseMetaData oracleMeta =
            meta.unwrap(oracle.jdbc.OracleDatabaseMetaData.class);
    // use Oracle-specific metadata methods carefully
}
```

Prinsip:

```text
unwrap is an escape hatch, not the default path.
```

Gunakan jika:

```text
- kamu memang membangun vendor-specific integration,
- ada fitur penting yang tidak tersedia di JDBC standard,
- code dipisahkan dalam dialect adapter,
- ada fallback jika driver berbeda.
```

Jangan sebar `unwrap()` di business logic.

---

## 35. Designing a Metadata Abstraction

Jika aplikasi membutuhkan metadata serius, jangan expose raw `DatabaseMetaData` ke seluruh code.

Lebih baik buat abstraction:

```java
public interface SchemaIntrospector {
    Optional<TableModel> findTable(String schema, String tableName) throws SQLException;
    List<ColumnModel> findColumns(String schema, String tableName) throws SQLException;
    List<String> findPrimaryKeyColumns(String schema, String tableName) throws SQLException;
}
```

Implementasi:

```text
JdbcSchemaIntrospector
  - uses DatabaseMetaData portable baseline

PostgresSchemaIntrospector
  - uses DatabaseMetaData + pg_catalog when needed

OracleSchemaIntrospector
  - uses DatabaseMetaData + ALL_TAB_COLUMNS/ALL_CONSTRAINTS when needed
```

Layering:

```text
Business code
  -> SchemaIntrospector
       -> JDBC metadata / system catalog / vendor adapter
```

Jangan:

```text
Business code
  -> raw DatabaseMetaData everywhere
```

Kenapa?

```text
- Lebih mudah test.
- Vendor-specific behavior terisolasi.
- Caching lebih mudah.
- Security whitelist lebih mudah.
- Error handling lebih konsisten.
```

---

## 36. Example: Portable Table Existence Check

Naive approach:

```java
boolean existsTable(Connection connection, String table) throws SQLException {
    DatabaseMetaData meta = connection.getMetaData();
    try (ResultSet rs = meta.getTables(null, null, table, new String[] {"TABLE"})) {
        return rs.next();
    }
}
```

Masalah:

```text
- schema terlalu luas,
- case sensitivity bermasalah,
- table name mungkin harus uppercase/lowercase,
- bisa menemukan table di schema lain,
- privilege bisa memengaruhi hasil.
```

Versi lebih baik:

```java
boolean existsTable(
        Connection connection,
        String schema,
        String table
) throws SQLException {
    DatabaseMetaData meta = connection.getMetaData();

    String normalizedTable = normalizeIdentifierForLookup(meta, table);
    String normalizedSchema = schema == null ? null : normalizeIdentifierForLookup(meta, schema);

    try (ResultSet rs = meta.getTables(
            connection.getCatalog(),
            normalizedSchema,
            normalizedTable,
            new String[] {"TABLE"}
    )) {
        while (rs.next()) {
            String foundSchema = rs.getString("TABLE_SCHEM");
            String foundTable = rs.getString("TABLE_NAME");

            if (equalsIgnoreCaseSafe(foundSchema, normalizedSchema)
                    && equalsIgnoreCaseSafe(foundTable, normalizedTable)) {
                return true;
            }
        }
        return false;
    }
}

private static String normalizeIdentifierForLookup(
        DatabaseMetaData meta,
        String identifier
) throws SQLException {
    if (identifier == null) return null;

    if (meta.storesUpperCaseIdentifiers()) {
        return identifier.toUpperCase(Locale.ROOT);
    }
    if (meta.storesLowerCaseIdentifiers()) {
        return identifier.toLowerCase(Locale.ROOT);
    }
    return identifier;
}

private static boolean equalsIgnoreCaseSafe(String a, String b) {
    if (a == null || b == null) return Objects.equals(a, b);
    return a.equalsIgnoreCase(b);
}
```

Tetap tidak sempurna untuk semua database, tetapi mental model-nya lebih benar.

---

## 37. Example: Build Schema Model from Metadata

```java
public final class JdbcSchemaIntrospector {
    private final DataSource dataSource;

    public JdbcSchemaIntrospector(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public TableModel loadTable(String schema, String table) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            DatabaseMetaData meta = connection.getMetaData();

            List<ColumnModel> columns = loadColumns(meta, schema, table);
            List<String> primaryKeys = loadPrimaryKeys(meta, schema, table);

            return new TableModel(schema, table, columns, primaryKeys);
        }
    }

    private List<ColumnModel> loadColumns(
            DatabaseMetaData meta,
            String schema,
            String table
    ) throws SQLException {
        List<ColumnModel> columns = new ArrayList<>();

        try (ResultSet rs = meta.getColumns(null, schema, table, "%")) {
            while (rs.next()) {
                int nullable = rs.getInt("NULLABLE");

                columns.add(new ColumnModel(
                        rs.getString("COLUMN_NAME"),
                        rs.getInt("DATA_TYPE"),
                        rs.getString("TYPE_NAME"),
                        rs.getInt("COLUMN_SIZE"),
                        rs.getInt("DECIMAL_DIGITS"),
                        nullable == DatabaseMetaData.columnNullable
                ));
            }
        }

        return List.copyOf(columns);
    }

    private List<String> loadPrimaryKeys(
            DatabaseMetaData meta,
            String schema,
            String table
    ) throws SQLException {
        List<PkColumn> pk = new ArrayList<>();

        try (ResultSet rs = meta.getPrimaryKeys(null, schema, table)) {
            while (rs.next()) {
                pk.add(new PkColumn(
                        rs.getString("COLUMN_NAME"),
                        rs.getShort("KEY_SEQ")
                ));
            }
        }

        return pk.stream()
                .sorted(Comparator.comparingInt(PkColumn::keySeq))
                .map(PkColumn::columnName)
                .toList();
    }

    private record PkColumn(String columnName, short keySeq) {}
}

record TableModel(
        String schema,
        String table,
        List<ColumnModel> columns,
        List<String> primaryKeyColumns
) {}

record ColumnModel(
        String name,
        int jdbcType,
        String vendorType,
        int size,
        int scale,
        boolean nullable
) {}
```

Catatan:

```text
- Ini bagus sebagai baseline.
- Untuk production-grade multi-database tool, tambahkan dialect adapter.
- Tambahkan cache.
- Tambahkan timeout/observability.
- Tambahkan schema whitelist.
```

---

## 38. Example: Dynamic CSV Export with ResultSetMetaData

```java
public static void exportCsv(ResultSet rs, Writer writer) throws SQLException, IOException {
    ResultSetMetaData meta = rs.getMetaData();
    int columnCount = meta.getColumnCount();

    for (int i = 1; i <= columnCount; i++) {
        if (i > 1) writer.write(',');
        writer.write(escapeCsv(meta.getColumnLabel(i)));
    }
    writer.write('\n');

    while (rs.next()) {
        for (int i = 1; i <= columnCount; i++) {
            if (i > 1) writer.write(',');

            int type = meta.getColumnType(i);

            if (type == Types.BLOB || type == Types.BINARY || type == Types.VARBINARY) {
                writer.write("[binary]");
            } else if (type == Types.CLOB || type == Types.NCLOB) {
                String value = rs.getString(i);
                writer.write(escapeCsv(truncate(value, 4096)));
            } else {
                Object value = rs.getObject(i);
                writer.write(escapeCsv(value == null ? "" : String.valueOf(value)));
            }
        }
        writer.write('\n');
    }
}

private static String truncate(String value, int max) {
    if (value == null) return null;
    return value.length() <= max ? value : value.substring(0, max) + "...[truncated]";
}

private static String escapeCsv(String value) {
    if (value == null) return "";
    boolean mustQuote = value.contains(",") || value.contains("\"") || value.contains("\n") || value.contains("\r");
    String escaped = value.replace("\"", "\"\"");
    return mustQuote ? "\"" + escaped + "\"" : escaped;
}
```

Poin penting:

```text
- Metadata dipakai untuk memahami tipe output.
- LOB/binary tidak diperlakukan seperti string biasa.
- Column label dipakai sebagai header.
- Export tetap streaming row-by-row.
```

---

## 39. Metadata API dalam Sistem Regulatory/Case Management

Untuk sistem seperti case management, enforcement lifecycle, atau regulatory platform, metadata bisa berguna untuk:

```text
1. Impact analysis
   - table/column apa yang terdampak CR?

2. Data archival
   - table dependency dari FK metadata,
   - primary key untuk chunking,
   - index metadata untuk strategy extraction.

3. Audit/reporting
   - dynamic report preview,
   - column masking,
   - sensitive field classification.

4. Migration validation
   - pastikan field baru ada sebelum feature enabled.

5. Operational diagnostics
   - log connected database product/version,
   - detect driver feature support,
   - validate expected schema.
```

Namun jangan mengira metadata cukup untuk memahami domain.

Contoh:

```text
Metadata tahu table CASE_APPLICATION punya STATUS.
Metadata tidak tahu state machine valid dari Draft -> Submitted -> Approved.
```

Untuk domain understanding, metadata harus digabung dengan:

```text
- code flow,
- migration history,
- domain documentation,
- event schema,
- audit trail,
- workflow definition,
- business rules.
```

---

## 40. Anti-Patterns

### Anti-pattern 1: Metadata Query Per Request

Buruk:

```java
public Response handleRequest(...) {
    validateTableStructureUsingMetadata();
    runBusinessQuery();
}
```

Lebih baik:

```text
Validate once at startup or deployment stage.
Use cached schema model.
```

---

### Anti-pattern 2: Wildcard Terlalu Luas

Buruk:

```java
meta.getColumns(null, null, "%", "%");
```

Lebih baik:

```java
meta.getColumns(null, "ACEAS", "CASE_APPLICATION", "%");
```

---

### Anti-pattern 3: Menganggap Metadata Portable 100%

Buruk:

```text
Kalau berjalan di PostgreSQL, pasti sama di Oracle/MySQL.
```

Lebih baik:

```text
Treat metadata API as portable baseline with vendor-specific edge cases.
```

---

### Anti-pattern 4: Menggunakan `ParameterMetaData` untuk Semua Binding

Buruk:

```java
int type = ps.getParameterMetaData().getParameterType(i);
ps.setObject(i, value, type);
```

Ini bisa gagal jika parameter metadata tidak tersedia/ambiguous.

Lebih baik:

```java
ps.setLong(1, caseId);
ps.setString(2, status);
ps.setObject(3, createdAt, Types.TIMESTAMP_WITH_TIMEZONE);
```

Atau gunakan query contract eksplisit.

---

### Anti-pattern 5: Expose Metadata Mentah ke Client

Buruk:

```text
Client bebas query table/column metadata.
```

Lebih baik:

```text
Expose curated metadata model with authorization and masking.
```

---

### Anti-pattern 6: Menggunakan ResultSetMetaData sebagai Domain Contract

Buruk:

```java
Map<String, Object> row = dynamicMap(rs);
processBusinessRule(row);
```

Lebih baik:

```java
CaseApplication app = mapCaseApplication(rs);
processBusinessRule(app);
```

Dynamic map cocok untuk tools, bukan domain invariant.

---

## 41. Checklist Penggunaan Metadata API

Gunakan checklist ini sebelum memakai metadata di aplikasi production.

```text
Scope:
[ ] Metadata ini dipakai untuk tooling/startup/admin path, bukan hot business path?
[ ] Schema/table pattern sudah dipersempit?
[ ] Tidak memakai wildcard luas tanpa alasan?

Resource:
[ ] Semua ResultSet metadata ditutup dengan try-with-resources?
[ ] Connection tidak ditahan terlalu lama?
[ ] Metadata query tidak berjalan di tengah transaction bisnis panjang?

Portability:
[ ] Schema/catalog difference sudah dipertimbangkan?
[ ] Identifier case sensitivity sudah dipertimbangkan?
[ ] Vendor-specific behavior diisolasi?
[ ] Ada test untuk database/driver target?

Correctness:
[ ] Column label vs column name dipilih dengan sadar?
[ ] Nullability unknown ditangani?
[ ] Composite primary key ditangani?
[ ] FK fisik tidak dianggap sama dengan semua relasi domain?

Performance:
[ ] Metadata result dicache jika sering dipakai?
[ ] Ada observability untuk metadata discovery lambat?
[ ] Tidak melakukan metadata discovery per request?

Security:
[ ] Metadata tidak diexpose mentah ke user?
[ ] Ada schema/table whitelist?
[ ] Sensitive column tidak bocor?
[ ] Akses metadata diaudit jika via admin endpoint?
```

---

## 42. Design Heuristics

Beberapa aturan praktis:

### 42.1 Metadata is for tools, not for core domain by default

Metadata sangat kuat untuk tooling. Namun domain logic lebih baik explicit.

```text
Tooling: dynamic, introspective, metadata-driven.
Domain: explicit, typed, invariant-driven.
```

---

### 42.2 Prefer ResultSetMetaData for output shape

Jika kamu ingin render hasil query dinamis, gunakan `ResultSetMetaData`.

Jangan paksa `DatabaseMetaData` untuk menebak shape query join/expression.

---

### 42.3 Prefer DatabaseMetaData for structural discovery

Jika ingin tahu struktur table/constraint/index, gunakan `DatabaseMetaData` sebagai baseline.

Jika butuh detail vendor, tambahkan system catalog query di dialect adapter.

---

### 42.4 Treat ParameterMetaData as optional help

Jangan bangun correctness utama di atas `ParameterMetaData`.

Gunakan explicit binding contract.

---

### 42.5 Cache metadata intentionally

Metadata bukan data real-time business.

Cache dengan strategi jelas:

```text
- startup,
- migration version,
- manual refresh,
- admin-only reload.
```

---

### 42.6 Do not hide metadata cost

Jika library kamu melakukan metadata query otomatis, dokumentasikan.

Contoh:

```text
On startup, this component reads table/column metadata for configured schemas.
It does not perform metadata discovery per request.
```

Ini penting untuk production predictability.

---

## 43. Mini Case Study: Data Archival Dependency Graph

Misalnya kamu ingin membuat data archival untuk case management.

Target:

```text
Archive CASE_APPLICATION older than 7 years.
Also archive dependent rows safely.
```

Metadata yang bisa dipakai:

```text
DatabaseMetaData.getPrimaryKeys()
  -> tahu key utama CASE_APPLICATION.

DatabaseMetaData.getExportedKeys()
  -> tahu table mana yang punya FK ke CASE_APPLICATION.

DatabaseMetaData.getIndexInfo()
  -> tahu apakah column filter/archive punya index.

DatabaseMetaData.getColumns()
  -> tahu tipe column CREATED_DATE_TIME, CASE_ID, STATUS.
```

Tapi metadata saja tidak cukup.

Yang masih perlu domain knowledge:

```text
- Case status apa yang boleh diarchive?
- Apakah appeal/legal/correspondence harus ikut?
- Apakah audit trail harus disimpan lebih lama?
- Apakah document binary perlu lifecycle berbeda?
- Apakah ada soft delete?
- Apakah external reference masih aktif?
- Apakah FK fisik lengkap?
```

Kesimpulan:

```text
Metadata gives structural graph.
Domain model gives legal/business eligibility.
Operational model gives safe execution strategy.
```

Inilah cara engineer matang memakai metadata: sebagai evidence, bukan satu-satunya truth.

---

## 44. Mini Case Study: Dynamic Admin Query Preview

Kebutuhan:

```text
Admin internal ingin menjalankan SELECT read-only dan melihat preview hasil.
```

Solusi metadata-aware:

```text
1. Gunakan read-only DataSource/user.
2. Batasi hanya SELECT.
3. Set query timeout.
4. Set max rows.
5. Execute query.
6. Ambil ResultSetMetaData.
7. Render column label/type.
8. Mask kolom sensitif berdasarkan label/policy.
9. Untuk BLOB/CLOB, tampilkan preview terbatas.
10. Audit query dan user.
```

`ResultSetMetaData` membantu rendering:

```text
- header kolom,
- tipe kolom,
- numeric/date formatting,
- LOB handling.
```

Tetapi security tetap harus datang dari policy layer, bukan metadata mentah.

---

## 45. Summary Mental Model

Ringkasan paling penting:

```text
DatabaseMetaData:
  Metadata tentang database, driver, capability, schema, table, column, key, index.

ResultSetMetaData:
  Metadata tentang shape hasil query tertentu.

ParameterMetaData:
  Metadata tentang placeholder parameter PreparedStatement, tetapi support-nya sering terbatas.
```

Prinsip utama:

```text
1. Metadata is introspection.
2. Introspection has cost.
3. Metadata is driver-specific in practice.
4. Metadata result is still JDBC resource.
5. Metadata should be cached if used repeatedly.
6. Metadata is useful evidence, not complete domain truth.
7. Metadata should not be exposed without authorization.
8. Dynamic tools can be metadata-driven; business logic should remain explicit.
```

Jika part sebelumnya membahas bagaimana membaca row, part ini membahas bagaimana memahami bentuk dari database/query itu sendiri.

Metadata API adalah fondasi untuk membuat tooling yang matang: schema validator, report builder, code generator, migration checker, archival impact analyzer, dan operational diagnostics.

Namun engineer top-level tahu batasnya: metadata bisa membantu melihat struktur, tetapi tidak otomatis memahami domain, performance, atau business correctness.

---

## 46. Latihan

### Latihan 1 — Schema Reader

Buat utility yang menerima:

```text
schema name
table name
```

Lalu menampilkan:

```text
- columns,
- JDBC type,
- vendor type,
- size,
- scale,
- nullable,
- primary key columns.
```

Pastikan:

```text
- ResultSet metadata ditutup,
- schema/table tidak wildcard luas,
- composite primary key diurutkan dengan KEY_SEQ.
```

---

### Latihan 2 — Dynamic Result Printer

Buat method:

```java
void printResultSet(ResultSet rs)
```

Yang menggunakan `ResultSetMetaData` untuk:

```text
- print header dari column label,
- print value row-by-row,
- membatasi CLOB/BLOB preview,
- handle null.
```

---

### Latihan 3 — Capability Report

Buat startup log yang menampilkan:

```text
- database product/version,
- driver name/version,
- supports transactions,
- supports batch updates,
- supports savepoints,
- supports generated keys,
- default transaction isolation.
```

Jangan gunakan hasil ini untuk membuat klaim performa. Gunakan hanya sebagai diagnostic context.

---

### Latihan 4 — Metadata Cache

Buat `SchemaCache` immutable yang di-load saat startup dari `DatabaseMetaData`, lalu digunakan oleh runtime code.

Pertimbangkan:

```text
- kapan refresh,
- apa key cache,
- bagaimana jika migration berubah,
- bagaimana menangani schema not found.
```

---

### Latihan 5 — Metadata Threat Modeling

Desain endpoint internal:

```http
GET /admin/schema/{schema}/{table}
```

Tentukan:

```text
- siapa yang boleh akses,
- schema/table apa yang boleh dilihat,
- field apa yang harus dimasking,
- audit log apa yang perlu dicatat,
- rate limit apa yang masuk akal.
```

---

## 47. Referensi

Referensi utama yang relevan untuk bagian ini:

1. Java SE API — `java.sql.DatabaseMetaData`  
   `https://docs.oracle.com/javase/8/docs/api/java/sql/DatabaseMetaData.html`

2. Java SE API — JDBC package overview  
   `https://docs.oracle.com/javase/8/docs/technotes/guides/jdbc/`

3. Oracle JDBC API — `OracleDatabaseMetaData`  
   `https://docs.oracle.com/en/database/oracle/oracle-database/18/jajdb/oracle/jdbc/OracleDatabaseMetaData.html`

4. PostgreSQL JDBC API — `PgDatabaseMetaData`  
   `https://jdbc.postgresql.org/documentation/publicapi/org/postgresql/jdbc/PgDatabaseMetaData.html`

5. PostgreSQL JDBC API — `PgResultSetMetaData`  
   `https://jdbc.postgresql.org/documentation/publicapi/org/postgresql/jdbc/PgResultSetMetaData.html`

---

## 48. Status Seri

```text
Part 014 dari 029 selesai.
Seri belum selesai.
Part berikutnya: Part 015 — Advanced JDBC Features: Savepoint, Array, Struct, Ref, RowId, SQLData
File berikutnya: learn-java-sql-jdbc-hikaricp-part-015.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-sql-jdbc-hikaricp-part-013](./learn-java-sql-jdbc-hikaricp-part-013.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-sql-jdbc-hikaricp-part-015](./learn-java-sql-jdbc-hikaricp-part-015.md)

</div>