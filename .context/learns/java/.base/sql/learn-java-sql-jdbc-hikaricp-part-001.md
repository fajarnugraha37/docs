# learn-java-sql-jdbc-hikaricp-part-001

# Part 001 — Anatomy of `java.sql` and `javax.sql`

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Target: advanced Java engineer / tech lead yang ingin memahami JDBC bukan sebagai “template koneksi database”, tetapi sebagai kontrak runtime antara aplikasi Java, driver, database session, transaction, network, dan connection pool.  
> Status: Part 001 dari 029. Seri belum selesai.

---

## 0. Tujuan Part Ini

Part 000 membangun mental model besar: JDBC adalah boundary antara aplikasi Java dan database. Part ini mulai membedah anatomi API-nya.

Tujuan utama Part 001:

1. Memahami peta besar `java.sql` dan `javax.sql`.
2. Membedakan mana API inti, mana API server-side/pooling, mana advanced/optional/vendor-sensitive.
3. Memahami peran setiap interface/class penting tanpa langsung tenggelam ke detail implementasi.
4. Mengerti bahwa JDBC adalah kumpulan kontrak, bukan library tunggal yang “melakukan semuanya”.
5. Membentuk vocabulary yang presisi untuk part berikutnya: connection, statement, result set, metadata, transaction, exception, LOB, wrapper, datasource, XA, pooled connection.

Yang belum menjadi fokus detail di part ini:

1. Belum deep dive `Connection` lifecycle. Itu Part 003.
2. Belum deep dive `PreparedStatement`. Itu Part 004.
3. Belum deep dive `ResultSet`. Itu Part 005.
4. Belum deep dive transaction/isolation. Itu Part 007–008.
5. Belum deep dive HikariCP. Itu Part 019–023.

Part ini adalah **peta wilayah**. Tanpa peta ini, banyak engineer bisa menulis JDBC code, tetapi sulit memahami kenapa production issue terjadi.

---

## 1. Sumber Kebenaran: JDBC Ada di Module `java.sql`

Sejak Java 9 modularization, JDBC API berada di module:

```java
module java.sql
```

Module ini mengekspor dua package utama:

```text
java.sql
javax.sql
```

Secara konseptual:

```text
java.sql
  Core JDBC API.
  Fokus: koneksi, statement, result, metadata, transaction, SQL type, exception.

javax.sql
  Extension/server-side API.
  Fokus: DataSource, pooling, distributed transaction, row set event/listener.
```

Dokumentasi resmi Java SE menjelaskan `java.sql` sebagai API untuk mengakses dan memproses data dari data source, biasanya relational database, menggunakan Java. API ini menyediakan framework agar driver berbeda dapat diinstal secara dinamis untuk mengakses data source berbeda. `javax.sql` melengkapi `java.sql` untuk server-side data source access dan processing.

Mental model awal:

```text
Application Code
   |
   | uses JDBC contracts
   v
java.sql / javax.sql interfaces
   |
   | implemented by
   v
JDBC Driver / Pool / Container
   |
   | speaks database protocol
   v
Database Server
```

Jadi ketika kita menulis:

```java
Connection connection = dataSource.getConnection();
PreparedStatement ps = connection.prepareStatement(sql);
ResultSet rs = ps.executeQuery();
```

kita **bukan memakai implementasi dari JDK untuk database tertentu**. Kita memakai interface standar. Implementasi aktualnya berasal dari driver/pool:

```text
Connection       -> usually driver connection or pool proxy
PreparedStatement-> driver statement/proxy statement
ResultSet        -> driver result/cursor abstraction
DataSource       -> driver datasource or pool datasource
```

Ini penting karena banyak perilaku runtime bukan ditentukan oleh JDK, tetapi oleh kombinasi:

1. JDBC spec/API contract.
2. Driver database.
3. Database engine.
4. Pooling implementation.
5. Configuration.
6. Network environment.

---

## 2. Kenapa API-nya Berupa Interface?

Mayoritas tipe penting JDBC adalah interface:

```java
Connection
Statement
PreparedStatement
CallableStatement
ResultSet
DatabaseMetaData
ResultSetMetaData
ParameterMetaData
Blob
Clob
Array
Struct
SQLXML
DataSource
```

Ini bukan kebetulan. JDBC dirancang sebagai **service provider contract**.

Aplikasi mengandalkan kontrak:

```text
"Saya butuh Connection yang bisa create Statement, mengatur transaction, commit, rollback, close."
```

Driver menyediakan implementasi:

```text
"Saya implementasikan Connection untuk PostgreSQL/Oracle/MySQL/SQL Server."
```

Pool membungkus implementasi:

```text
"Saya berikan Connection proxy. Ketika close() dipanggil, saya tidak benar-benar menutup socket, tapi mengembalikan connection ke pool."
```

Container/framework mengatur lifecycle:

```text
"Saya inject DataSource, manage transaction, bind Connection ke request/thread/transaction scope."
```

Karena itu, code berikut terlihat sederhana:

```java
try (Connection c = dataSource.getConnection()) {
    // use connection
}
```

Tetapi object aktualnya bisa berupa:

```text
com.zaxxer.hikari.pool.HikariProxyConnection
  wrapping org.postgresql.jdbc.PgConnection

com.zaxxer.hikari.pool.HikariProxyConnection
  wrapping oracle.jdbc.driver.T4CConnection

com.zaxxer.hikari.pool.HikariProxyConnection
  wrapping com.mysql.cj.jdbc.ConnectionImpl
```

Konsekuensinya:

1. Jangan berasumsi class konkret.
2. Jangan cast sembarangan ke class driver.
3. Gunakan `unwrap()` bila memang butuh fitur vendor-specific.
4. Pahami bahwa `close()` pada pooled connection bukan physical close.
5. Pahami bahwa behavior detail bisa berbeda antar driver.

---

## 3. Pembagian Besar JDBC API

Kita bisa mengelompokkan JDBC API menjadi beberapa zona:

```text
1. Driver discovery and connection acquisition
   - Driver
   - DriverManager
   - DataSource

2. Connection/session and transaction
   - Connection
   - Savepoint

3. SQL execution
   - Statement
   - PreparedStatement
   - CallableStatement

4. Result consumption
   - ResultSet
   - ResultSetMetaData

5. Metadata/introspection
   - DatabaseMetaData
   - ResultSetMetaData
   - ParameterMetaData

6. Type mapping
   - Types
   - SQLType
   - JDBCType
   - Date / Time / Timestamp
   - Blob / Clob / NClob / SQLXML
   - Array / Struct / Ref / RowId

7. Exception and warning model
   - SQLException
   - SQLWarning
   - SQLTransientException
   - SQLNonTransientException
   - SQLRecoverableException
   - more specific subclasses

8. Extension and pooling
   - DataSource
   - ConnectionPoolDataSource
   - PooledConnection
   - XADataSource
   - XAConnection

9. Wrapper/vendor extension escape hatch
   - Wrapper
   - unwrap()
   - isWrapperFor()
```

Pemetaan ini akan terus dipakai sepanjang seri.

---

## 4. `Driver`: Kontrak Paling Bawah untuk Membuka Koneksi

`java.sql.Driver` adalah interface yang diimplementasikan oleh vendor JDBC driver.

Secara konseptual, driver menjawab pertanyaan:

```text
"Apakah saya bisa menangani URL JDBC ini? Jika iya, saya bisa membuat Connection."
```

Contoh URL:

```text
jdbc:postgresql://localhost:5432/appdb
jdbc:mysql://localhost:3306/appdb
jdbc:oracle:thin:@//host:1521/service
jdbc:sqlserver://host:1433;databaseName=appdb
```

Driver punya responsibility seperti:

1. Mengenali URL.
2. Membaca properties.
3. Membuka network connection.
4. Melakukan authentication handshake.
5. Negosiasi protocol feature.
6. Mengembalikan object `Connection`.

Contoh penggunaan eksplisit yang jarang dipakai di aplikasi modern:

```java
Driver driver = new org.postgresql.Driver();
Properties props = new Properties();
props.setProperty("user", "app");
props.setProperty("password", "secret");

try (Connection c = driver.connect(
        "jdbc:postgresql://localhost:5432/appdb", props)) {
    // use connection
}
```

Namun aplikasi modern biasanya tidak memanggil `Driver` langsung.

Kenapa tetap penting dipahami?

Karena `DriverManager` dan banyak `DataSource` pada akhirnya tetap bergantung pada driver untuk membuat physical connection.

---

## 5. `DriverManager`: Mekanisme Klasik Connection Acquisition

`DriverManager` adalah API lama/klasik untuk memperoleh connection:

```java
try (Connection c = DriverManager.getConnection(
        "jdbc:postgresql://localhost:5432/appdb",
        "app",
        "secret")) {
    // use connection
}
```

Mental model:

```text
DriverManager
   |
   | has registered drivers
   v
Find driver accepting jdbcUrl
   |
   v
Call driver.connect(url, properties)
   |
   v
Return Connection
```

Dulu, code sering berisi:

```java
Class.forName("org.postgresql.Driver");
```

Pada JDBC modern, driver bisa ditemukan melalui service provider mechanism ketika driver jar ada di classpath/module path. Jadi explicit `Class.forName` biasanya tidak dibutuhkan untuk driver modern.

`DriverManager` cocok untuk:

1. Demo sederhana.
2. CLI kecil.
3. Tool internal yang tidak butuh pooling.
4. Test cepat.

Tetapi untuk aplikasi server, `DriverManager` bukan boundary ideal karena:

1. Tidak merepresentasikan lifecycle pool.
2. Sulit di-inject dan di-test.
3. Cenderung membuat credential/config tersebar.
4. Tidak memberi abstraction untuk connection reuse.
5. Tidak cocok untuk container-managed resource.

Untuk aplikasi production, boundary yang lebih baik adalah `DataSource`.

---

## 6. `DataSource`: Boundary Modern untuk Connection Acquisition

`javax.sql.DataSource` adalah factory untuk `Connection`.

Contoh:

```java
try (Connection c = dataSource.getConnection()) {
    // use connection
}
```

Dibanding `DriverManager`, `DataSource` lebih cocok sebagai application dependency:

```java
public final class CaseRepository {
    private final DataSource dataSource;

    public CaseRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource);
    }

    public CaseRecord findById(long id) throws SQLException {
        String sql = """
            select id, status, assigned_to
            from case_table
            where id = ?
            """;

        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setLong(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                return new CaseRecord(
                    rs.getLong("id"),
                    rs.getString("status"),
                    rs.getString("assigned_to")
                );
            }
        }
    }
}
```

Kenapa `DataSource` lebih baik?

```text
DriverManager
  Global/static style connection acquisition.
  Kurang cocok sebagai dependency object.

DataSource
  Object-oriented resource factory.
  Bisa di-inject.
  Bisa di-wrap oleh pool.
  Bisa dikelola framework/container.
  Bisa berbeda per environment/tenant/workload.
```

Tiga bentuk umum `DataSource`:

```text
1. Basic driver DataSource
   Membuat physical connection baru setiap getConnection().

2. Pool-backed DataSource
   getConnection() borrow dari pool.
   close() return ke pool.

3. Container-managed DataSource
   JNDI/server/framework menyediakan resource.
```

Contoh HikariCP sebagai pool-backed `DataSource`:

```java
HikariConfig config = new HikariConfig();
config.setJdbcUrl("jdbc:postgresql://localhost:5432/appdb");
config.setUsername("app");
config.setPassword("secret");
config.setMaximumPoolSize(10);

DataSource dataSource = new HikariDataSource(config);
```

Aplikasi repository/service seharusnya tidak peduli apakah `dataSource` berasal dari HikariCP, application server, test container, atau fake implementation.

Itulah nilai arsitektural `DataSource`.

---

## 7. `Connection`: Handle ke Database Session

`java.sql.Connection` adalah interface paling sentral dalam JDBC.

Banyak pemula menganggap connection sebagai “kabel” atau “socket”. Itu terlalu sempit.

Mental model yang lebih tepat:

```text
Connection = handle Java ke database session/logical session.
```

Sebuah `Connection` membawa state seperti:

1. Auto-commit mode.
2. Transaction state.
3. Isolation level.
4. Read-only hint.
5. Current catalog/schema.
6. Network timeout.
7. Client info.
8. Holdability.
9. Statement creation capability.
10. Driver/database session association.

Method penting:

```java
Statement createStatement() throws SQLException;
PreparedStatement prepareStatement(String sql) throws SQLException;
CallableStatement prepareCall(String sql) throws SQLException;

void setAutoCommit(boolean autoCommit) throws SQLException;
boolean getAutoCommit() throws SQLException;

void commit() throws SQLException;
void rollback() throws SQLException;

Savepoint setSavepoint() throws SQLException;
void rollback(Savepoint savepoint) throws SQLException;
void releaseSavepoint(Savepoint savepoint) throws SQLException;

void setTransactionIsolation(int level) throws SQLException;
int getTransactionIsolation() throws SQLException;

void setReadOnly(boolean readOnly) throws SQLException;
boolean isReadOnly() throws SQLException;

void setSchema(String schema) throws SQLException;
String getSchema() throws SQLException;

boolean isValid(int timeout) throws SQLException;
void close() throws SQLException;
boolean isClosed() throws SQLException;
```

Di aplikasi dengan pool, `Connection` yang diterima aplikasi biasanya bukan physical connection asli, melainkan proxy:

```text
Application
   |
   v
HikariProxyConnection
   |
   v
Driver Connection
   |
   v
Database session/socket
```

Saat aplikasi memanggil:

```java
connection.close();
```

pada pooled connection, artinya biasanya:

```text
Return logical connection to pool.
```

bukan:

```text
Close physical database socket immediately.
```

Konsekuensi besar:

1. `close()` tetap wajib dipanggil.
2. Tidak memanggil `close()` berarti leak logical connection dari pool.
3. Pool perlu mereset state connection sebelum dipinjam ulang.
4. Connection state leakage bisa menyebabkan bug lintas request.

Contoh bug:

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);
    // do work
    c.commit();
}
```

Jika sebelum close terjadi exception dan rollback/reset tidak benar, connection bisa kembali ke pool dalam state transaction/read-only/schema/isolation yang salah. Pool modern seperti HikariCP berusaha mengatasi state reset, tetapi aplikasi tetap harus mendesain transaction boundary secara eksplisit.

---

## 8. `Statement`: Eksekusi SQL Tanpa Parameter Binding

`Statement` adalah interface untuk menjalankan SQL string langsung.

Contoh:

```java
try (Statement st = connection.createStatement();
     ResultSet rs = st.executeQuery("select id, name from users")) {
    while (rs.next()) {
        long id = rs.getLong("id");
        String name = rs.getString("name");
    }
}
```

Method penting:

```java
ResultSet executeQuery(String sql) throws SQLException;
int executeUpdate(String sql) throws SQLException;
boolean execute(String sql) throws SQLException;
long executeLargeUpdate(String sql) throws SQLException;

void setQueryTimeout(int seconds) throws SQLException;
void setMaxRows(int max) throws SQLException;
void setFetchSize(int rows) throws SQLException;

ResultSet getResultSet() throws SQLException;
int getUpdateCount() throws SQLException;
boolean getMoreResults() throws SQLException;
```

`Statement` cocok untuk:

1. SQL statis yang tidak menerima input.
2. DDL/migration script internal.
3. Administrative commands.
4. Test setup sederhana.

`Statement` berbahaya untuk dynamic input:

```java
String sql = "select * from users where username = '" + username + "'";
```

Masalah:

1. SQL injection.
2. Escaping sulit benar secara universal.
3. Type conversion ambigu.
4. Query plan reuse lebih buruk di banyak skenario.

Default pilihan untuk SQL dengan input adalah `PreparedStatement`.

---

## 9. `PreparedStatement`: SQL dengan Parameter Binding

`PreparedStatement` adalah subtype dari `Statement` yang menerima SQL dengan parameter placeholder:

```java
String sql = "select id, name from users where username = ?";

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setString(1, username);
    try (ResultSet rs = ps.executeQuery()) {
        // consume rows
    }
}
```

Mental model:

```text
SQL template:
  select id, name from users where username = ?

Parameter binding:
  parameter 1 = username value

Driver/database:
  parse/bind/execute depending on driver mode and DB protocol
```

Method binding umum:

```java
setString(int parameterIndex, String x)
setInt(int parameterIndex, int x)
setLong(int parameterIndex, long x)
setBigDecimal(int parameterIndex, BigDecimal x)
setBoolean(int parameterIndex, boolean x)
setDate(int parameterIndex, Date x)
setTimestamp(int parameterIndex, Timestamp x)
setObject(int parameterIndex, Object x)
setNull(int parameterIndex, int sqlType)
```

Mulai JDBC modern, `setObject` dan `getObject` juga mendukung sebagian Java Time API tergantung driver:

```java
ps.setObject(1, LocalDate.now());
ps.setObject(2, OffsetDateTime.now());

LocalDate d = rs.getObject("business_date", LocalDate.class);
```

Namun mapping detail tetap driver/database-sensitive.

Hal penting:

`PreparedStatement` **bisa mengikat value**, bukan identifier SQL.

Valid:

```java
select * from users where status = ?
```

Tidak valid untuk binding table/column/order direction:

```java
select * from ? where ? = ?
order by ? ?
```

Jika perlu dynamic identifier, gunakan whitelist:

```java
enum SortColumn {
    CREATED_AT("created_at"),
    STATUS("status");

    final String sql;

    SortColumn(String sql) {
        this.sql = sql;
    }
}
```

Lalu compose SQL dari nilai yang sudah dikontrol, bukan dari raw user input.

---

## 10. `CallableStatement`: Stored Procedure / Function Boundary

`CallableStatement` digunakan untuk memanggil stored procedure atau function.

Contoh umum:

```java
try (CallableStatement cs = connection.prepareCall("{ call approve_case(?, ?) }")) {
    cs.setLong(1, caseId);
    cs.setString(2, officerId);
    cs.execute();
}
```

Dengan OUT parameter:

```java
try (CallableStatement cs = connection.prepareCall("{ call create_case(?, ?) }")) {
    cs.setString(1, applicantName);
    cs.registerOutParameter(2, Types.BIGINT);
    cs.execute();

    long generatedCaseId = cs.getLong(2);
}
```

Fungsi:

```java
try (CallableStatement cs = connection.prepareCall("{ ? = call calculate_score(?) }")) {
    cs.registerOutParameter(1, Types.INTEGER);
    cs.setLong(2, applicationId);
    cs.execute();

    int score = cs.getInt(1);
}
```

`CallableStatement` penting di enterprise karena banyak sistem legacy dan database-centric memakai stored procedure sebagai boundary business logic.

Namun perlu hati-hati:

1. Transaction boundary bisa tersembunyi.
2. Error handling bisa vendor-specific.
3. Result cursor return berbeda antar database.
4. Parameter naming/positioning tidak selalu portable.
5. Procedure bisa menyembunyikan side effect besar.

---

## 11. `ResultSet`: Cursor, Bukan Collection

`ResultSet` merepresentasikan hasil query.

Contoh:

```java
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setString(1, status);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            long id = rs.getLong("id");
            String name = rs.getString("name");
        }
    }
}
```

Mental model penting:

```text
ResultSet bukan List<Row>.
ResultSet adalah cursor/handle untuk membaca data hasil query.
```

Default umum:

```text
TYPE_FORWARD_ONLY
CONCUR_READ_ONLY
```

Artinya:

1. Cursor maju satu arah.
2. Tidak bisa update row via result set.
3. Lebih cocok untuk query biasa.

JDBC juga punya opsi scrollable/updatable:

```java
Statement st = connection.createStatement(
    ResultSet.TYPE_SCROLL_INSENSITIVE,
    ResultSet.CONCUR_READ_ONLY
);
```

Tetapi fitur seperti scrollable/updatable bisa mahal, tidak selalu didukung sama, dan jarang ideal untuk OLTP service modern.

Hal penting tentang getter:

```java
long id = rs.getLong("id");
String name = rs.getString("name");
BigDecimal amount = rs.getBigDecimal("amount");
LocalDate date = rs.getObject("business_date", LocalDate.class);
```

Null trap:

```java
long value = rs.getLong("optional_number");
if (rs.wasNull()) {
    // actual SQL value was NULL
}
```

Untuk nullable numeric, sering lebih aman:

```java
Long value = rs.getObject("optional_number", Long.class);
```

Tetapi support target type tetap perlu diuji pada driver.

---

## 12. `ResultSetMetaData`: Metadata Kolom Hasil Query

`ResultSetMetaData` menjawab pertanyaan:

```text
Kolom apa saja yang ada di ResultSet ini?
Tipe SQL-nya apa?
Nama labelnya apa?
Precision/scale-nya apa?
Nullable atau tidak?
```

Contoh:

```java
try (ResultSet rs = ps.executeQuery()) {
    ResultSetMetaData md = rs.getMetaData();
    int columnCount = md.getColumnCount();

    for (int i = 1; i <= columnCount; i++) {
        String label = md.getColumnLabel(i);
        String typeName = md.getColumnTypeName(i);
        int jdbcType = md.getColumnType(i);
        int precision = md.getPrecision(i);
        int scale = md.getScale(i);
    }
}
```

Kegunaan:

1. Generic query tool.
2. CSV/export writer.
3. Dynamic mapper.
4. Debugging.
5. Schema drift detection sederhana.
6. Data migration helper.

Namun metadata tidak gratis. Jangan memanggil metadata secara berulang di hot path bila tidak perlu.

---

## 13. `ParameterMetaData`: Metadata Parameter Prepared Statement

`ParameterMetaData` mencoba menjawab:

```text
PreparedStatement ini punya berapa parameter?
Parameter ke-N SQL type-nya apa?
Nullable atau tidak?
Mode-nya apa?
```

Contoh:

```java
ParameterMetaData pmd = ps.getParameterMetaData();
int count = pmd.getParameterCount();
for (int i = 1; i <= count; i++) {
    int type = pmd.getParameterType(i);
    String typeName = pmd.getParameterTypeName(i);
}
```

Secara teori menarik. Dalam praktik:

1. Tidak semua driver mendukung lengkap.
2. Bisa membutuhkan server round-trip.
3. Bisa gagal untuk SQL kompleks.
4. Tidak sebaik explicit binding di application code.

Karena itu, jangan membangun correctness utama aplikasi pada `ParameterMetaData` kecuali sudah diuji untuk driver/database yang digunakan.

---

## 14. `DatabaseMetaData`: Introspection Database dan Driver Capability

`DatabaseMetaData` diperoleh dari `Connection`:

```java
DatabaseMetaData md = connection.getMetaData();
```

Informasi yang bisa didapat:

1. Database product name/version.
2. Driver name/version.
3. Supported SQL features.
4. Transaction isolation support.
5. Table list.
6. Column list.
7. Primary keys.
8. Foreign keys.
9. Index info.
10. Procedure/function info.

Contoh:

```java
DatabaseMetaData md = connection.getMetaData();

System.out.println(md.getDatabaseProductName());
System.out.println(md.getDatabaseProductVersion());
System.out.println(md.getDriverName());
System.out.println(md.getDriverVersion());
System.out.println(md.supportsTransactions());
System.out.println(md.supportsBatchUpdates());
```

Query table metadata:

```java
try (ResultSet tables = md.getTables(null, "public", "%", new String[] {"TABLE"})) {
    while (tables.next()) {
        String tableName = tables.getString("TABLE_NAME");
    }
}
```

Kegunaan:

1. Migration tool.
2. Schema documentation generator.
3. Runtime compatibility check.
4. Database explorer.
5. Code generation.
6. Integration test assertion.

Tetapi ada caveat:

1. Metadata naming case berbeda antar database.
2. Schema/catalog semantics berbeda.
3. Performance bisa buruk pada database besar.
4. Permission database bisa membatasi visibility.
5. Driver bisa mengembalikan data yang tidak 100% konsisten dengan expectation aplikasi.

---

## 15. Type System: `Types`, `SQLType`, dan `JDBCType`

JDBC harus menjembatani dua dunia:

```text
Java type system
  String, int, long, BigDecimal, LocalDate, byte[], InputStream, etc.

SQL/database type system
  VARCHAR, NUMBER, NUMERIC, TIMESTAMP, DATE, BLOB, CLOB, UUID, JSON, etc.
```

Class/enum penting:

```java
java.sql.Types
java.sql.SQLType
java.sql.JDBCType
```

`Types` berisi constant int klasik:

```java
Types.INTEGER
Types.BIGINT
Types.VARCHAR
Types.NUMERIC
Types.TIMESTAMP
Types.DATE
Types.BLOB
Types.CLOB
Types.OTHER
```

`JDBCType` adalah enum modern yang mengimplementasikan `SQLType`:

```java
JDBCType.INTEGER
JDBCType.BIGINT
JDBCType.VARCHAR
JDBCType.TIMESTAMP
JDBCType.BLOB
JDBCType.OTHER
```

Contoh typed null:

```java
ps.setNull(1, Types.VARCHAR);
```

Atau dengan `SQLType` pada method modern tertentu:

```java
ps.setObject(1, value, JDBCType.VARCHAR);
```

Kenapa typed null penting?

Karena SQL `NULL` tidak membawa tipe sendiri dari sisi Java object.

Ambigu:

```java
ps.setObject(1, null);
```

Lebih eksplisit:

```java
ps.setNull(1, Types.TIMESTAMP);
```

atau:

```java
ps.setObject(1, null, JDBCType.TIMESTAMP);
```

Top 1% engineer tidak hanya tahu “pakai `setObject` saja”, tetapi paham kapan binding perlu explicit SQL type agar driver/database tidak salah inferensi.

---

## 16. Legacy Date/Time JDBC Classes

JDBC punya class date/time legacy:

```java
java.sql.Date
java.sql.Time
java.sql.Timestamp
```

Secara historis, ini dipakai sebelum `java.time` hadir.

Mapping kasar:

```text
java.sql.Date       -> SQL DATE
java.sql.Time       -> SQL TIME
java.sql.Timestamp  -> SQL TIMESTAMP
```

Contoh lama:

```java
ps.setDate(1, java.sql.Date.valueOf(LocalDate.now()));
ps.setTimestamp(2, Timestamp.valueOf(LocalDateTime.now()));
```

Modern JDBC mendukung `java.time` melalui `setObject`/`getObject` pada banyak driver:

```java
ps.setObject(1, LocalDate.now());
ps.setObject(2, LocalDateTime.now());
ps.setObject(3, OffsetDateTime.now());

LocalDate d = rs.getObject("business_date", LocalDate.class);
OffsetDateTime odt = rs.getObject("created_at", OffsetDateTime.class);
```

Namun jangan asal percaya. Harus diuji untuk:

1. Database type.
2. Driver version.
3. Time zone setting JVM.
4. Time zone setting DB session.
5. Column type: `TIMESTAMP`, `TIMESTAMP WITH TIME ZONE`, `DATE`, dll.

Date/time adalah salah satu sumber bug paling mahal di sistem regulasi, audit, SLA, expiry, dan workflow.

---

## 17. LOB Types: `Blob`, `Clob`, `NClob`, `SQLXML`

JDBC menyediakan object untuk large object:

```java
Blob
Clob
NClob
SQLXML
```

Mental model:

```text
LOB object bisa berupa locator/handle, bukan selalu seluruh isi di memory.
```

`Blob` untuk binary large object:

```java
Blob blob = rs.getBlob("file_content");
try (InputStream in = blob.getBinaryStream()) {
    // stream bytes
}
```

`Clob` untuk character large object:

```java
Clob clob = rs.getClob("audit_payload");
try (Reader reader = clob.getCharacterStream()) {
    // stream chars
}
```

`NClob` untuk national character set LOB.

`SQLXML` untuk XML.

Caveat LOB:

1. Bisa terikat transaction/session.
2. Bisa butuh resource release.
3. Bisa materialized oleh driver jika salah pakai getter.
4. Bisa menyebabkan memory explosion.
5. Bisa memperlambat query jika LOB ada di hot path.
6. Bisa butuh strategi storage/indexing terpisah.

Detail LOB akan dibahas di Part 013.

---

## 18. Advanced SQL Types: `Array`, `Struct`, `Ref`, `RowId`, `SQLData`

JDBC juga punya tipe untuk fitur SQL/database yang lebih advanced:

```java
Array
Struct
Ref
RowId
SQLData
SQLInput
SQLOutput
```

Kegunaan:

1. SQL array/collection.
2. Object-relational database type.
3. User-defined type.
4. Database row identifier.
5. Vendor-specific object mapping.

Contoh `Array`:

```java
Array sqlArray = connection.createArrayOf("varchar", new String[] {"A", "B"});
ps.setArray(1, sqlArray);
```

Namun portability terbatas:

1. Tidak semua database punya SQL array dengan semantics sama.
2. Type name berbeda.
3. Driver support bervariasi.
4. ORM/framework sering punya abstraction sendiri.

Untuk OLTP enterprise yang perlu maintainability tinggi, fitur ini dipakai selektif. Jangan membuat domain model inti terlalu bergantung pada fitur vendor-specific kecuali memang keputusan arsitektural sadar.

---

## 19. `Savepoint`: Partial Rollback dalam Transaction

`Savepoint` memungkinkan rollback sebagian dalam transaction:

```java
connection.setAutoCommit(false);

try {
    updateMainRecord(connection);

    Savepoint sp = connection.setSavepoint("after_main_record");

    try {
        insertOptionalAuditDetail(connection);
    } catch (SQLException e) {
        connection.rollback(sp);
    }

    connection.commit();
} catch (SQLException e) {
    connection.rollback();
    throw e;
}
```

Savepoint berguna untuk:

1. Partial failure handling.
2. Batch processing dengan unit kecil.
3. Optional side effect di dalam transaction.
4. Complex import/correction flow.

Tetapi perlu hati-hati:

1. Tidak menggantikan desain transaction yang jelas.
2. Bisa membuat logic sulit diaudit.
3. Bisa memiliki overhead database.
4. Bisa tidak cocok jika business event harus atomic secara keseluruhan.

Detail transaction/savepoint akan dibahas di Part 007 dan Part 015.

---

## 20. Exception Hierarchy: `SQLException` Bukan Sekadar Exception Biasa

Semua operasi JDBC utama bisa melempar `SQLException`.

`SQLException` membawa informasi penting:

```java
String sqlState = e.getSQLState();
int vendorCode = e.getErrorCode();
SQLException next = e.getNextException();
```

JDBC punya subclass untuk klasifikasi:

```text
SQLException
  SQLTransientException
    SQLTimeoutException
    SQLTransactionRollbackException
    SQLTransientConnectionException

  SQLNonTransientException
    SQLDataException
    SQLIntegrityConstraintViolationException
    SQLInvalidAuthorizationSpecException
    SQLNonTransientConnectionException
    SQLSyntaxErrorException

  SQLRecoverableException

  BatchUpdateException

  SQLFeatureNotSupportedException
```

Mental model:

```text
SQLException is not just "database failed".
It is a structured signal:
  - transient or non-transient?
  - connection or statement?
  - syntax or constraint?
  - timeout or deadlock?
  - retryable or not?
```

Contoh handling buruk:

```java
catch (SQLException e) {
    throw new RuntimeException(e);
}
```

Masalah:

1. SQLState hilang dari log/metric.
2. Vendor code tidak diklasifikasi.
3. Retry policy tidak bisa akurat.
4. Constraint violation bisa tercampur dengan connection failure.
5. Deadlock tidak dibedakan dari syntax error.

Handling lebih matang:

```java
catch (SQLIntegrityConstraintViolationException e) {
    throw new DuplicateBusinessKeyException("Duplicate case reference", e);
} catch (SQLTransientException e) {
    throw new RetriableDatabaseException("Temporary database failure", e);
} catch (SQLException e) {
    throw new DatabaseAccessException(
        "Database operation failed. sqlState=" + e.getSQLState()
            + ", vendorCode=" + e.getErrorCode(),
        e
    );
}
```

Detail exception mastery akan dibahas di Part 009.

---

## 21. `SQLWarning`: Sinyal Non-Fatal yang Sering Diabaikan

Selain exception, JDBC punya `SQLWarning`.

Warning bisa muncul pada:

```java
Connection.getWarnings()
Statement.getWarnings()
ResultSet.getWarnings()
```

Contoh:

```java
SQLWarning warning = statement.getWarnings();
while (warning != null) {
    log.warn("SQL warning: state={}, code={}, message={}",
        warning.getSQLState(),
        warning.getErrorCode(),
        warning.getMessage());
    warning = warning.getNextWarning();
}
```

Warning bisa merepresentasikan hal seperti:

1. Data truncation warning.
2. Feature fallback.
3. Non-fatal conversion issue.
4. Database-specific warnings.

Dalam banyak aplikasi, warning diabaikan. Itu tidak selalu salah. Tetapi untuk sistem regulasi/audit/data quality, warning bisa menjadi sinyal penting bahwa operasi “berhasil” tetapi tidak sepenuhnya bersih.

---

## 22. `Wrapper`: Escape Hatch ke Vendor-Specific API

Banyak JDBC interface extends `Wrapper`.

Method penting:

```java
<T> T unwrap(Class<T> iface) throws SQLException;
boolean isWrapperFor(Class<?> iface) throws SQLException;
```

Tujuan:

```text
Jika object JDBC adalah wrapper/proxy, aplikasi bisa meminta object underlying tertentu secara aman.
```

Contoh konseptual:

```java
if (connection.isWrapperFor(oracle.jdbc.OracleConnection.class)) {
    oracle.jdbc.OracleConnection oracleConnection =
        connection.unwrap(oracle.jdbc.OracleConnection.class);
    // use Oracle-specific feature
}
```

Kapan boleh?

1. Fitur penting tidak tersedia di standard JDBC.
2. Aplikasi memang database-specific.
3. Ada abstraction layer agar vendor-specific code tidak menyebar.
4. Ada fallback/guard.
5. Ada test integration khusus.

Kapan jangan?

1. Untuk convenience kecil yang bisa dilakukan dengan standard JDBC.
2. Di domain service secara langsung.
3. Jika ingin database portability.
4. Jika tidak tahu apakah connection adalah proxy pool.

`unwrap()` adalah pisau bedah. Berguna, tetapi harus terkendali.

---

## 23. `javax.sql` Selain `DataSource`

Package `javax.sql` tidak hanya berisi `DataSource`.

Tipe penting:

```java
DataSource
ConnectionPoolDataSource
PooledConnection
XADataSource
XAConnection
RowSet
RowSetEvent
RowSetListener
StatementEvent
StatementEventListener
```

Untuk seri ini, yang paling penting:

```text
DataSource
ConnectionPoolDataSource
PooledConnection
XADataSource
XAConnection
```

Karena ini berkaitan dengan pool dan transaction.

---

## 24. `ConnectionPoolDataSource` dan `PooledConnection`

`ConnectionPoolDataSource` adalah factory untuk `PooledConnection`.

Mental model:

```text
ConnectionPoolDataSource
   creates
PooledConnection
   provides
logical Connection handles
```

`PooledConnection` bukan connection yang biasanya dipakai application code langsung. Ini lebih untuk pool/container implementation.

Pool bisa menggunakan mekanisme ini untuk:

1. Mendapat physical connection dari driver.
2. Mengelola event ketika logical connection ditutup.
3. Mengelola statement event/listener.
4. Mengembalikan logical connection ke pool.

Dalam aplikasi modern dengan HikariCP, biasanya kita langsung memakai `HikariDataSource`, bukan berinteraksi manual dengan `ConnectionPoolDataSource`.

Tetapi memahami tipe ini membantu membedakan:

```text
Application-facing abstraction:
  DataSource -> Connection

Pool/provider-facing abstraction:
  ConnectionPoolDataSource -> PooledConnection -> Connection
```

---

## 25. `XADataSource` dan `XAConnection`

`XADataSource` dan `XAConnection` berkaitan dengan distributed transaction / XA transaction.

Mental model:

```text
Satu transaction global melibatkan lebih dari satu transactional resource:
  - database A
  - database B
  - message broker
  - etc.
```

XA memungkinkan coordinator mengatur two-phase commit.

Namun distributed transaction membawa kompleksitas besar:

1. Coordinator diperlukan.
2. Recovery log diperlukan.
3. Timeout dan heuristic outcome rumit.
4. Lock bisa tertahan lama.
5. Operational debugging sulit.
6. Tidak semua resource/driver sama kualitas support-nya.

Di microservices modern, banyak sistem memilih pola lain:

1. Outbox pattern.
2. Saga.
3. Idempotent message processing.
4. Compensation.
5. Transactional boundary per service.

Namun XA masih relevan di beberapa enterprise/container/database-centric environment. Seri ini akan menyebut XA bila perlu, tetapi fokus utama tetap local transaction dan pool non-XA karena itu yang paling sering dipakai bersama HikariCP.

---

## 26. RowSet: Disconnected/JavaBean-style Result Abstraction

`javax.sql.RowSet` adalah extension dari `ResultSet` dengan model JavaBean/event.

Jenis RowSet berada di package lain seperti `javax.sql.rowset`, misalnya:

```text
JdbcRowSet
CachedRowSet
WebRowSet
FilteredRowSet
JoinRowSet
```

RowSet historically berguna untuk:

1. Disconnected row data.
2. JavaBeans-style data binding.
3. Cached tabular data.
4. XML representation.

Namun pada service backend modern, RowSet relatif jarang dipakai dibanding:

1. Explicit DTO mapping.
2. jOOQ records.
3. Spring RowMapper.
4. ORM entities.
5. Custom projection.

Kita tidak akan fokus panjang pada RowSet kecuali saat membahas peta API dan metadata.

---

## 27. Object Lifecycle: Siapa Membuat Siapa?

Pahami graph object JDBC:

```text
DriverManager / DataSource
        |
        v
    Connection
        |
        +--> Statement
        |
        +--> PreparedStatement
        |
        +--> CallableStatement
                    |
                    v
                ResultSet
```

Metadata:

```text
Connection
   +--> DatabaseMetaData

Statement/PreparedStatement
   +--> ParameterMetaData

ResultSet
   +--> ResultSetMetaData
```

Resource ownership umum:

```text
Connection owns statements created from it.
Statement owns result sets created from it.
ResultSet is valid while its statement/connection remains valid.
```

Karena itu resource scope ideal:

```java
try (Connection c = dataSource.getConnection();
     PreparedStatement ps = c.prepareStatement(sql)) {

    ps.setLong(1, id);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            // map row
        }
    }
}
```

Urutan close otomatis:

```text
ResultSet closes first
PreparedStatement closes second
Connection closes last
```

Karena try-with-resources menutup resource dalam urutan terbalik dari deklarasi.

---

## 28. Execution Lifecycle: Dari `DataSource` sampai Row Mapping

Mari lihat flow eksekusi query sederhana.

Code:

```java
String sql = """
    select id, status, assigned_to
    from case_table
    where id = ?
    """;

try (Connection c = dataSource.getConnection();
     PreparedStatement ps = c.prepareStatement(sql)) {

    ps.setLong(1, caseId);

    try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
            return Optional.empty();
        }

        return Optional.of(new CaseRecord(
            rs.getLong("id"),
            rs.getString("status"),
            rs.getString("assigned_to")
        ));
    }
}
```

Runtime mental model:

```text
1. dataSource.getConnection()
   - If pool: borrow logical connection.
   - If no pool: create physical connection.

2. connection.prepareStatement(sql)
   - Driver creates statement handle.
   - May or may not prepare server-side immediately.

3. ps.setLong(1, caseId)
   - Bind Java long to SQL parameter.

4. ps.executeQuery()
   - Driver sends parse/bind/execute/fetch protocol as applicable.
   - Database executes query.
   - Driver returns ResultSet handle.

5. rs.next()
   - Move cursor to next row.
   - May fetch data from driver buffer or database cursor.

6. rs.getXxx(...)
   - Convert SQL value to Java value.

7. close ResultSet
   - Release cursor/result resources.

8. close PreparedStatement
   - Release statement resources or return to statement cache depending driver/pool.

9. close Connection
   - If pool: return to pool.
   - If non-pool: close physical connection.
```

Setiap step punya potensi failure:

```text
getConnection
  - pool timeout
  - login failure
  - network failure
  - database unavailable

prepareStatement
  - syntax check depending driver/database
  - unsupported feature
  - closed connection

executeQuery
  - syntax error
  - constraint/permission error
  - timeout
  - deadlock/lock timeout
  - connection lost

rs.next/getXxx
  - conversion error
  - stream/LOB failure
  - connection lost during fetch

close
  - network/resource cleanup error
  - transaction rollback failure
```

Top-level lesson:

```text
JDBC code that looks linear is actually a distributed protocol interaction.
```

---

## 29. Interface vs Implementation: Apa yang Standard, Apa yang Tidak?

JDBC memberi standard untuk API shape dan sebagian semantic. Tetapi tidak semua detail portable.

Relatif standard:

1. Interface names.
2. Method signatures.
3. Basic connection/statement/result flow.
4. Basic transaction methods.
5. Basic SQL type constants.
6. Exception structure.
7. Metadata interface.

Sering driver/database-specific:

1. JDBC URL format.
2. Authentication property names.
3. Server-side prepare behavior.
4. Statement cache behavior.
5. Fetch size semantics.
6. Generated keys behavior.
7. Batch rewrite behavior.
8. Timeout enforcement.
9. Cancel query behavior.
10. Time zone mapping.
11. JSON/UUID/array mapping.
12. LOB streaming behavior.
13. Metadata completeness.
14. Scrollable/updatable result sets.
15. SQLState/vendor code mapping.

Inilah kenapa “menguasai JDBC” bukan menghafal method. Yang penting adalah memahami:

```text
API contract + driver behavior + database behavior + pool behavior + production constraints.
```

---

## 30. Common Misreadings of JDBC API

### 30.1 “`Connection` adalah koneksi fisik”

Kadang benar tanpa pool. Tetapi dalam aplikasi production dengan pool, `Connection` yang diterima aplikasi sering logical/proxy connection.

Lebih akurat:

```text
Connection adalah handle JDBC ke database session, bisa langsung atau diproxy.
```

### 30.2 “`close()` berarti mematikan koneksi DB”

Pada pooled connection, `close()` biasanya mengembalikan connection ke pool.

Lebih akurat:

```text
close() berarti aplikasi selesai menggunakan resource tersebut.
Implementasi menentukan apakah physical resource ditutup atau dikembalikan.
```

### 30.3 “`PreparedStatement` selalu lebih cepat”

Tidak selalu. Prepared statement lebih aman untuk parameter binding dan bisa membantu plan reuse. Tetapi performance tergantung driver, server-side prepare threshold, statement cache, database plan cache, query shape, dan workload.

Lebih akurat:

```text
PreparedStatement adalah default untuk parameterized SQL karena correctness/security.
Performance benefit adalah context-dependent.
```

### 30.4 “`ResultSet` sudah ada semua datanya di memory”

Tidak selalu. Bisa buffered, bisa cursor/streaming, bisa fetch bertahap.

Lebih akurat:

```text
ResultSet adalah cursor abstraction; buffering/fetching detail tergantung driver, statement config, dan database.
```

### 30.5 “`SQLException` cukup dilog message-nya”

Tidak cukup untuk production.

Lebih akurat:

```text
SQLException membawa SQLState, vendor code, subclass, chained exception, dan retry signal.
```

### 30.6 “`DataSource` pasti connection pool”

Tidak selalu. `DataSource` adalah factory. Implementasinya bisa pool, non-pool, container-managed, driver-native.

Lebih akurat:

```text
DataSource adalah abstraction untuk memperoleh Connection. Pool adalah salah satu implementasi/behavior.
```

---

## 31. How Frameworks Sit on Top of JDBC

Banyak framework yang sering dipakai tetap berada di atas JDBC.

```text
Spring JDBC
   -> DataSource
   -> Connection
   -> PreparedStatement
   -> ResultSet

jOOQ
   -> JDBC Connection/DataSource
   -> SQL rendering/binding/execution
   -> ResultSet mapping

Hibernate/JPA
   -> JDBC Connection/DataSource
   -> SQL generation/execution
   -> ResultSet hydration
   -> transaction integration

MyBatis
   -> JDBC Connection/DataSource
   -> mapped SQL statements
   -> PreparedStatement/ResultSet
```

Jadi walaupun sehari-hari memakai JPA/Hibernate, JDBC tetap penting karena banyak production issue muncul di bawah ORM:

1. Pool exhausted.
2. Slow query.
3. Transaction too long.
4. Batch not rewritten.
5. Fetch size ignored.
6. LOB memory blow-up.
7. Time zone mapping salah.
8. Generated key behavior berbeda.
9. Connection leak.
10. Deadlock retry salah.

Engineer yang hanya paham framework akan berhenti di permukaan. Engineer yang paham JDBC bisa turun satu lapis dan melihat mekanisme nyata.

---

## 32. Minimal Plain JDBC Example yang “Benar Secara Bentuk”

Contoh query:

```java
public Optional<CaseRecord> findCaseById(DataSource dataSource, long caseId)
        throws SQLException {

    String sql = """
        select id, case_reference, status, assigned_to
        from case_table
        where id = ?
        """;

    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(sql)) {

        ps.setLong(1, caseId);

        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return Optional.empty();
            }

            CaseRecord record = new CaseRecord(
                rs.getLong("id"),
                rs.getString("case_reference"),
                rs.getString("status"),
                rs.getString("assigned_to")
            );

            return Optional.of(record);
        }
    }
}
```

Kenapa bentuk ini baik?

1. `DataSource` di-inject/diberikan dari luar.
2. SQL parameterized.
3. Resource ditutup deterministik.
4. `ResultSet` tidak keluar dari method.
5. Mapping dilakukan dalam scope resource.
6. Tidak memakai static global connection.
7. Tidak menyimpan `Connection` sebagai field singleton.

Tetapi ini belum cukup untuk production penuh. Kita masih perlu:

1. Transaction boundary.
2. Timeout.
3. Error translation.
4. Metrics.
5. Pool config.
6. Retry classification.
7. Logging/correlation.
8. Test strategy.

Itu semua akan muncul pada part berikutnya.

---

## 33. Minimal Transaction Example yang “Benar Secara Bentuk”

Contoh sederhana:

```java
public void assignCase(DataSource dataSource, long caseId, String officerId)
        throws SQLException {

    String updateSql = """
        update case_table
        set assigned_to = ?, status = ?
        where id = ? and status = ?
        """;

    String auditSql = """
        insert into audit_trail(case_id, activity, actor)
        values (?, ?, ?)
        """;

    try (Connection c = dataSource.getConnection()) {
        boolean previousAutoCommit = c.getAutoCommit();
        c.setAutoCommit(false);

        try {
            try (PreparedStatement ps = c.prepareStatement(updateSql)) {
                ps.setString(1, officerId);
                ps.setString(2, "ASSIGNED");
                ps.setLong(3, caseId);
                ps.setString(4, "NEW");

                int updated = ps.executeUpdate();
                if (updated != 1) {
                    throw new IllegalStateException("Case is not assignable");
                }
            }

            try (PreparedStatement ps = c.prepareStatement(auditSql)) {
                ps.setLong(1, caseId);
                ps.setString(2, "ASSIGN_CASE");
                ps.setString(3, officerId);
                ps.executeUpdate();
            }

            c.commit();
        } catch (Exception e) {
            try {
                c.rollback();
            } catch (SQLException rollbackError) {
                e.addSuppressed(rollbackError);
            }
            throw e;
        } finally {
            c.setAutoCommit(previousAutoCommit);
        }
    }
}
```

Catatan:

1. Ini contoh plain JDBC untuk memahami mekanisme.
2. Framework transaction manager biasanya menangani sebagian pola ini.
3. Di pooled environment, reset state penting.
4. Jangan membuka transaction lalu memanggil operasi lambat eksternal.
5. Jangan return connection sebelum transaction selesai.

Detail transaction akan dibahas lebih dalam nanti.

---

## 34. Apa yang Harus Diingat dari `java.sql`

Ringkasan `java.sql`:

```text
Driver
  Implemented by database driver. Knows how to create Connection for JDBC URL.

DriverManager
  Static manager for registered drivers. Classic connection acquisition.

Connection
  Handle to DB session and transaction context.

Statement
  Executes raw SQL string.

PreparedStatement
  Executes parameterized SQL with bind values.

CallableStatement
  Calls stored procedures/functions.

ResultSet
  Cursor over query results.

DatabaseMetaData
  Database/driver/schema/capability introspection.

ResultSetMetaData
  Column metadata for a result set.

ParameterMetaData
  Parameter metadata for prepared/callable statement.

SQLException
  Structured error signal from JDBC operations.

SQLWarning
  Non-fatal warning chain.

Types / JDBCType / SQLType
  SQL type representation.

Blob / Clob / NClob / SQLXML
  Large object and XML support.

Array / Struct / Ref / RowId
  Advanced SQL/vendor type support.

Savepoint
  Partial rollback marker inside transaction.

Wrapper
  Standard escape hatch to underlying implementation.
```

---

## 35. Apa yang Harus Diingat dari `javax.sql`

Ringkasan `javax.sql`:

```text
DataSource
  Preferred connection factory abstraction.
  Can be driver-backed, pool-backed, or container-managed.

ConnectionPoolDataSource
  Factory for PooledConnection, mostly for pool/container internals.

PooledConnection
  Physical/logical pooled connection abstraction used by pooling implementations.

XADataSource
  Factory for XAConnection for distributed transactions.

XAConnection
  Connection participating in XA transaction coordination.

RowSet
  JavaBean-style ResultSet extension; less central in modern backend services.

StatementEvent / listeners
  Event mechanism relevant to pooling/statement lifecycle.
```

Most application code should depend on:

```java
javax.sql.DataSource
```

not on:

```java
DriverManager
ConnectionPoolDataSource
PooledConnection
XADataSource
```

unless building infrastructure/framework/container-level code.

---

## 36. Design Principle: Keep JDBC Objects at the Boundary

A clean application should avoid spreading JDBC objects deep into domain logic.

Bad shape:

```java
public class CaseService {
    public void approveCase(ResultSet rs) {
        // domain logic reading from JDBC cursor
    }
}
```

Better shape:

```java
public class CaseService {
    public Decision approveCase(CaseRecord record) {
        // domain logic uses domain/application data
    }
}
```

Repository boundary:

```java
public final class CaseRepository {
    private final DataSource dataSource;

    public Optional<CaseRecord> findById(long id) {
        // JDBC here
    }
}
```

Why?

1. JDBC resources have lifecycle constraints.
2. `ResultSet` depends on open statement/connection.
3. Domain logic should not know cursor semantics.
4. Testing becomes easier.
5. Transaction boundary becomes clearer.
6. Resource leak risk decreases.

JDBC belongs at infrastructure/data access boundary. Domain/application layer should receive values, not cursors.

---

## 37. Design Principle: Do Not Store `Connection` as a Singleton Field

Bad:

```java
public final class BadRepository {
    private final Connection connection;

    public BadRepository(Connection connection) {
        this.connection = connection;
    }
}
```

Problems:

1. `Connection` is not generally thread-safe as shared mutable session.
2. It carries transaction state.
3. It can become stale/closed.
4. It couples repository lifetime to DB session lifetime.
5. It breaks pool borrow/return semantics.
6. It risks cross-request state leakage.

Better:

```java
public final class GoodRepository {
    private final DataSource dataSource;

    public GoodRepository(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public Optional<Record> findById(long id) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            // use connection within scope
        }
    }
}
```

Store `DataSource`, not `Connection`.

---

## 38. Design Principle: Transaction Boundary Must Be Explicit Somewhere

JDBC transaction boundary exists at `Connection`.

Even if using framework, the physical/logical reality remains:

```text
A transaction is associated with a database connection/session.
```

Dangerous ambiguity:

```java
repository.updateCase(caseId);
repository.insertAudit(caseId);
```

Are these in one transaction or two? Depends on how repository obtains connection and whether a transaction manager binds one connection to the current scope.

Plain JDBC explicit transaction:

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);
    try {
        repository.updateCase(c, caseId);
        repository.insertAudit(c, caseId);
        c.commit();
    } catch (Exception e) {
        c.rollback();
        throw e;
    }
}
```

Framework style:

```java
@Transactional
public void assignCase(...) {
    repository.updateCase(...);
    repository.insertAudit(...);
}
```

But under the hood, framework still needs:

1. A `DataSource`.
2. A `Connection`.
3. Transaction demarcation.
4. Commit/rollback.
5. Connection cleanup.

Top 1% engineer can reason through both the abstraction and the underlying mechanism.

---

## 39. API Map by Responsibility

Use this as quick map.

| Responsibility | Primary JDBC Type | Typical Owner |
|---|---:|---|
| Load/recognize DB driver | `Driver` | Driver vendor |
| Classic connection acquisition | `DriverManager` | Application/tooling |
| Modern connection acquisition | `DataSource` | App/framework/pool/container |
| DB session handle | `Connection` | Driver/pool proxy |
| Transaction boundary | `Connection` | App/framework transaction manager |
| Raw SQL execution | `Statement` | Application/repository |
| Parameterized SQL | `PreparedStatement` | Application/repository |
| Stored procedure/function | `CallableStatement` | Application/repository |
| Query result cursor | `ResultSet` | Driver |
| Result column metadata | `ResultSetMetaData` | Driver |
| Statement parameter metadata | `ParameterMetaData` | Driver |
| Database/schema metadata | `DatabaseMetaData` | Driver/database |
| SQL error signal | `SQLException` | Driver/database |
| SQL warning signal | `SQLWarning` | Driver/database |
| SQL type constants | `Types`, `JDBCType` | JDK API |
| LOB | `Blob`, `Clob`, `NClob` | Driver/database |
| XML | `SQLXML` | Driver/database |
| Partial rollback | `Savepoint` | Database/driver |
| Pool internals | `ConnectionPoolDataSource`, `PooledConnection` | Pool/container |
| XA distributed transaction | `XADataSource`, `XAConnection` | Transaction manager/container |
| Vendor escape hatch | `Wrapper.unwrap()` | Application/infrastructure code |

---

## 40. Practical Reading Strategy for JDBC Javadocs

JDBC Javadocs can feel huge. Read them with this order:

```text
1. DataSource
2. Connection
3. PreparedStatement
4. ResultSet
5. SQLException
6. Types/JDBCType
7. DatabaseMetaData
8. Statement
9. CallableStatement
10. Blob/Clob/SQLXML
11. Wrapper
12. ConnectionPoolDataSource / XADataSource only if needed
```

When reading any JDBC method, ask:

1. Does this operate on client object, driver object, or database server state?
2. Can this cause network round-trip?
3. Can this block?
4. Can this throw `SQLException`?
5. Does this depend on current transaction?
6. Does this mutate connection/session state?
7. Does pooling change the meaning of this method?
8. Is this guaranteed by JDBC or driver-specific?
9. What happens if connection is closed/killed?
10. What is the cleanup responsibility?

This questioning style is more valuable than memorizing method lists.

---

## 41. Production Lens: Where Bugs Hide in the API Map

Common production issues and the API zone involved:

| Symptom | Likely API Zone | Example Root Cause |
|---|---|---|
| Pool exhausted | `DataSource`, `Connection` | connection not closed, long transaction |
| Idle in transaction | `Connection` | autoCommit false, no commit/rollback |
| SQL injection | `Statement`, `PreparedStatement` | concatenated user input |
| Memory blow-up | `ResultSet`, `Blob`, `Clob` | huge result materialized |
| Wrong date/time | `Types`, `Timestamp`, `setObject/getObject` | timezone/type mismatch |
| Duplicate key not handled | `SQLException` | no constraint classification |
| Deadlock retry wrong | `SQLException`, transaction | retrying non-idempotent operation |
| Slow query cascade | `PreparedStatement`, `ResultSet`, pool | no timeout/backpressure |
| Cross-request schema bug | `Connection` | schema changed and leaked through pool |
| Generated key missing | `PreparedStatement` | wrong `RETURN_GENERATED_KEYS` usage/driver behavior |
| Batch partial failure | `PreparedStatement`, `BatchUpdateException` | assuming all-or-nothing without transaction |
| DB failover not recovered | `DataSource`, pool, driver | stale physical connections |
| Metadata tool slow | `DatabaseMetaData` | scanning huge schema at runtime |

This is why Part 001 matters: every future failure mode maps back to these API zones.

---

## 42. Advanced Mental Model: JDBC as Four Contracts

JDBC is not one contract. It is at least four contracts stacked together.

```text
1. Source acquisition contract
   DataSource / DriverManager / Driver

2. Session and transaction contract
   Connection / Savepoint

3. Execution and data contract
   Statement / PreparedStatement / CallableStatement / ResultSet / Types

4. Diagnostics and capability contract
   SQLException / SQLWarning / Metadata / Wrapper
```

When debugging, identify which contract is failing.

Example:

```text
"getConnection timeout"
  Source acquisition / pool contract.

"deadlock detected"
  Transaction/execution/database concurrency contract.

"invalid column type"
  Type mapping contract.

"connection is closed"
  Session lifecycle contract.

"feature not supported"
  Capability/driver contract.
```

This prevents random fixes.

Bad debugging:

```text
"Database error. Increase pool size."
```

Better debugging:

```text
"Threads are waiting at DataSource.getConnection because active connections are held for >30s by long report query transactions. Increasing pool size may amplify DB load. Separate reporting pool or reduce transaction duration."
```

---

## 43. Checklist: What You Should Be Able to Explain After This Part

Setelah Part 001, kamu harus bisa menjawab:

1. Apa beda `java.sql` dan `javax.sql`?
2. Kenapa mayoritas JDBC API berupa interface?
3. Apa peran `Driver`?
4. Apa kelemahan `DriverManager` untuk aplikasi server?
5. Kenapa `DataSource` adalah boundary modern?
6. Apa makna `Connection` dalam konteks session/transaction?
7. Apa beda `Statement`, `PreparedStatement`, dan `CallableStatement`?
8. Kenapa `ResultSet` bukan `List`?
9. Apa fungsi `DatabaseMetaData`, `ResultSetMetaData`, dan `ParameterMetaData`?
10. Apa fungsi `Types`, `JDBCType`, dan `SQLType`?
11. Kenapa SQL NULL perlu typed null?
12. Apa risiko date/time mapping?
13. Kapan memakai `Blob`/`Clob`?
14. Apa itu `Savepoint`?
15. Kenapa `SQLException` harus diklasifikasi?
16. Apa itu `Wrapper.unwrap()`?
17. Apa bedanya `DataSource` dan `ConnectionPoolDataSource`?
18. Apa itu `XADataSource`?
19. Kenapa jangan menyimpan `Connection` sebagai singleton?
20. Kenapa JDBC objects sebaiknya tetap di infrastructure boundary?

Jika belum bisa menjawab, ulang bagian terkait sebelum masuk Part 002.

---

## 44. Mini Exercise

### Exercise 1 — Identify API Zones

Untuk flow berikut:

```java
try (Connection c = dataSource.getConnection();
     PreparedStatement ps = c.prepareStatement("select * from case_table where status = ?")) {
    ps.setString(1, "NEW");
    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            System.out.println(rs.getLong("id"));
        }
    }
}
```

Jawab:

1. Object mana yang berasal dari `javax.sql`?
2. Object mana yang berasal dari `java.sql`?
3. Di titik mana pool mungkin terlibat?
4. Di titik mana network round-trip kemungkinan terjadi?
5. Di titik mana SQL type conversion terjadi?
6. Di titik mana resource harus dilepas?

Jawaban ringkas:

```text
1. DataSource.
2. Connection, PreparedStatement, ResultSet.
3. dataSource.getConnection() dan connection.close().
4. getConnection jika physical creation/validation terjadi; executeQuery; rs.next jika fetch tambahan dibutuhkan; close bisa juga melakukan protocol cleanup.
5. ps.setString dan rs.getLong/getString/getObject.
6. ResultSet, PreparedStatement, Connection.
```

### Exercise 2 — Refactor Bad Code

Bad code:

```java
public final class UserRepository {
    private final Connection connection;

    public UserRepository(Connection connection) {
        this.connection = connection;
    }

    public User find(String username) throws SQLException {
        Statement st = connection.createStatement();
        ResultSet rs = st.executeQuery(
            "select id, username from users where username = '" + username + "'"
        );
        rs.next();
        return new User(rs.getLong(1), rs.getString(2));
    }
}
```

Masalah:

1. Menyimpan `Connection` sebagai field.
2. Tidak menutup `Statement` dan `ResultSet`.
3. SQL injection.
4. Tidak handle not found.
5. Mengandalkan column index tanpa alasan kuat.
6. Tidak ada resource scope.

Refactor:

```java
public final class UserRepository {
    private final DataSource dataSource;

    public UserRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource);
    }

    public Optional<User> find(String username) throws SQLException {
        String sql = """
            select id, username
            from users
            where username = ?
            """;

        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {

            ps.setString(1, username);

            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }

                return Optional.of(new User(
                    rs.getLong("id"),
                    rs.getString("username")
                ));
            }
        }
    }
}
```

---

## 45. Key Takeaways

1. `java.sql` adalah core JDBC API: connection, statement, result, transaction, metadata, type, exception.
2. `javax.sql` melengkapi JDBC untuk `DataSource`, pooling-facing API, XA, dan RowSet/event model.
3. `DataSource` adalah boundary modern untuk memperoleh connection; application code sebaiknya bergantung pada `DataSource`, bukan `DriverManager` atau singleton `Connection`.
4. `Connection` adalah handle ke database session dan transaction context, bukan sekadar socket.
5. `Statement`, `PreparedStatement`, dan `CallableStatement` adalah tiga model eksekusi berbeda.
6. `ResultSet` adalah cursor abstraction, bukan collection biasa.
7. Metadata API kuat tetapi tidak selalu murah atau portable sempurna.
8. JDBC type mapping adalah salah satu sumber bug paling penting, terutama null, numeric precision, date/time, LOB, JSON/UUID/vendor type.
9. `SQLException` membawa struktur diagnostik yang harus dipakai untuk classification, logging, metric, dan retry decision.
10. `Wrapper.unwrap()` adalah escape hatch untuk vendor-specific feature; pakai terkendali.
11. Pooling mengubah makna praktis `Connection.close()`: dari physical close menjadi return-to-pool.
12. Menguasai JDBC berarti memahami standard API sekaligus batas driver/database/pool behavior.

---

## 46. Referensi Resmi dan Lanjutan

1. Oracle Java SE `java.sql` package documentation  
   https://docs.oracle.com/en/java/javase/24/docs/api/java.sql/java/sql/package-summary.html

2. Oracle Java SE `javax.sql` package documentation  
   https://docs.oracle.com/en/java/javase/24/docs/api/java.sql/javax/sql/package-summary.html

3. Oracle Java SE `java.sql` module documentation  
   https://docs.oracle.com/en/java/javase/24/docs/api/java.sql/module-summary.html

4. Oracle Java Tutorials — JDBC Basics  
   https://docs.oracle.com/javase/tutorial/jdbc/basics/index.html

5. Oracle Java Tutorials — JDBC Introduction  
   https://docs.oracle.com/javase/tutorial/jdbc/overview/index.html

6. HikariCP Official GitHub README  
   https://github.com/brettwooldridge/HikariCP

---

## 47. Penutup Part 001

Part ini membangun peta anatomi JDBC. Kita belum mencoba mengoptimasi apa pun. Kita belum membahas HikariCP detail. Kita juga belum membahas transaction/isolation secara mendalam.

Tetapi sekarang kita sudah punya vocabulary presisi:

```text
DataSource obtains Connection.
Connection carries session and transaction.
Statement family executes SQL.
ResultSet exposes cursor.
Metadata describes capabilities and shape.
Types bridge SQL and Java.
SQLException communicates structured failure.
Pool wraps and manages lifecycle.
Driver implements database-specific behavior.
```

Part berikutnya akan turun satu layer lebih bawah:

```text
Part 002 — JDBC Driver Architecture: Dari Interface Java ke Protocol Database
```

Di sana kita akan membahas bagaimana driver bekerja: registration, JDBC URL, protocol, authentication, TLS, server-side prepare, database-specific behavior, dan kenapa “JDBC portable” tidak berarti semua behavior identik antar database.

---

# Status Seri

```text
Part 001 dari 029 selesai.
Seri belum selesai.
Part berikutnya: Part 002 — JDBC Driver Architecture: Dari Interface Java ke Protocol Database.
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-sql-jdbc-hikaricp-part-000.md](./learn-java-sql-jdbc-hikaricp-part-000.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-sql-jdbc-hikaricp-part-002](./learn-java-sql-jdbc-hikaricp-part-002.md)

</div>