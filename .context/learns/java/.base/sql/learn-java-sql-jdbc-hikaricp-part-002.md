# learn-java-sql-jdbc-hikaricp-part-002

# Part 002 — JDBC Driver Architecture: Dari Interface Java ke Protocol Database

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Bagian: `002 / 029`  
> Status: Selesai untuk Part 002, seri belum selesai  
> Fokus: memahami JDBC driver sebagai jembatan nyata antara kontrak `java.sql` dan protokol database vendor.

---

## 0. Kenapa Part Ini Penting?

Pada part sebelumnya kita sudah memetakan anatomi API: `Connection`, `Statement`, `PreparedStatement`, `ResultSet`, `DataSource`, `SQLException`, metadata, LOB, dan abstraction lain.

Tetapi ada satu realita penting:

```text
JDBC API bukan koneksi database.
JDBC API hanya kontrak Java.
Yang benar-benar berbicara ke database adalah JDBC driver.
```

Artinya, saat kode Java memanggil:

```java
Connection connection = dataSource.getConnection();
```

atau:

```java
Connection connection = DriverManager.getConnection(url, username, password);
```

Java tidak sedang “langsung” membuka koneksi database secara generik. Java sedang menyerahkan request ke implementasi driver tertentu, misalnya:

```text
Oracle JDBC Driver
PostgreSQL JDBC Driver
MySQL Connector/J
Microsoft SQL Server JDBC Driver
MariaDB JDBC Driver
H2 JDBC Driver
```

Driver inilah yang memahami:

```text
- format JDBC URL
- cara autentikasi
- wire protocol database
- cara encode/decode SQL dan parameter
- cara fetch row
- cara handle cursor
- cara map SQL type ke Java type
- cara translate error database menjadi SQLException
- cara reconnect atau tidak reconnect
- cara validasi koneksi
- cara menafsirkan timeout
```

Inilah alasan kenapa engineer yang hanya tahu interface JDBC sering bingung saat production incident. Kode Java-nya terlihat sama, tetapi behavior-nya berbeda antar database dan driver.

Contoh:

```java
preparedStatement.setFetchSize(1000);
```

Secara API tampak portable. Tetapi efek nyatanya bisa berbeda:

```text
Oracle     : dapat memengaruhi row prefetch.
PostgreSQL : streaming butuh kondisi tertentu, misalnya autocommit false dan fetch size positif.
MySQL      : historically punya behavior khusus untuk streaming result set.
H2         : mungkin tidak relevan karena in-memory/local behavior.
```

Maka mental model yang benar adalah:

```text
Application Code
   ↓ calls JDBC API
JDBC Interface Contract
   ↓ implemented by
Vendor JDBC Driver
   ↓ speaks
Database Wire Protocol / Native Client / Middleware
   ↓ reaches
Database Listener / Server Process / Session
```

Top 1% engineer tidak berhenti di `Connection`, tetapi paham lapisan di bawahnya.

---

## 1. JDBC Driver Adalah Implementasi Kontrak

`java.sql.Driver` adalah interface yang harus diimplementasikan oleh driver JDBC. Java SQL framework memungkinkan banyak driver tersedia sekaligus; saat request koneksi dibuat, framework akan mencoba driver yang cocok dengan URL yang diberikan.

Secara sederhana:

```java
public interface Driver {
    Connection connect(String url, Properties info) throws SQLException;
    boolean acceptsURL(String url) throws SQLException;
    DriverPropertyInfo[] getPropertyInfo(String url, Properties info) throws SQLException;
    int getMajorVersion();
    int getMinorVersion();
    boolean jdbcCompliant();
    Logger getParentLogger() throws SQLFeatureNotSupportedException;
}
```

Yang penting bukan hafal method-nya, tetapi paham perannya:

```text
Driver = plugin yang mengubah permintaan koneksi JDBC menjadi koneksi nyata ke data source tertentu.
```

JDBC API menyediakan bentuk umum:

```java
Connection
PreparedStatement
ResultSet
SQLException
```

Driver menyediakan isi aktualnya:

```text
oracle.jdbc.driver.T4CConnection
org.postgresql.jdbc.PgConnection
com.mysql.cj.jdbc.ConnectionImpl
com.microsoft.sqlserver.jdbc.SQLServerConnection
```

Aplikasi biasanya memegang tipe interface:

```java
java.sql.Connection
```

Tetapi object runtime-nya adalah class vendor.

Contoh mental model:

```text
Connection interface
   ↑
   │ implemented by
   │
OracleConnection / PgConnection / MySQL ConnectionImpl / SQLServerConnection
```

Karena itu method yang sama bisa punya biaya dan behavior berbeda.

---

## 2. JDBC API Portable, JDBC Behavior Tidak Selalu Portable

Salah satu janji JDBC adalah aplikasi Java bisa memakai API yang sama untuk database berbeda. Itu benar pada level source code dasar.

Contoh portable:

```java
try (Connection c = dataSource.getConnection();
     PreparedStatement ps = c.prepareStatement("select id, name from users where id = ?")) {

    ps.setLong(1, 100L);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            long id = rs.getLong("id");
            String name = rs.getString("name");
        }
    }
}
```

Kode ini bisa terlihat sama di Oracle, PostgreSQL, MySQL, SQL Server.

Tetapi behavior di bawahnya bisa berbeda pada aspek berikut:

```text
1. SQL dialect
2. identifier quoting
3. pagination syntax
4. auto-generated key retrieval
5. upsert syntax
6. time zone conversion
7. boolean representation
8. UUID handling
9. JSON handling
10. CLOB/BLOB handling
11. cursor behavior
12. fetch size behavior
13. prepared statement caching
14. transaction isolation semantics
15. DDL auto-commit behavior
16. lock timeout behavior
17. deadlock error code
18. connection validation query
19. network timeout support
20. socket property name
```

Jadi portable API bukan berarti portable semantics.

Prinsip yang harus dipegang:

```text
JDBC standardizes the shape of interaction.
The database and driver still define the semantics of many details.
```

---

## 3. Historical Driver Types: Type 1, Type 2, Type 3, Type 4

Secara historis JDBC driver dibagi menjadi empat tipe. Di modern production, mayoritas yang dipakai adalah Type 4, tetapi memahami sejarahnya membantu membaca dokumentasi lama dan memahami trade-off.

---

### 3.1 Type 1 — JDBC-ODBC Bridge

Model:

```text
Java Application
   ↓ JDBC
JDBC-ODBC Bridge
   ↓ ODBC
ODBC Driver
   ↓ native protocol
Database
```

Karakteristik:

```text
- menggunakan ODBC sebagai perantara
- butuh native ODBC driver di machine
- portability buruk
- tidak cocok untuk production Java modern
- sudah obsolete dalam konteks Java modern
```

Mental model:

```text
JDBC hanya membungkus API database generik lain, yaitu ODBC.
```

Kelemahan:

```text
- dependency native
- deployment kompleks
- performance overhead
- behavior makin sulit diprediksi karena ada banyak layer
```

---

### 3.2 Type 2 — Native API Driver

Model:

```text
Java Application
   ↓ JDBC
Vendor JDBC Driver
   ↓ JNI / native library
Vendor Native Client
   ↓ native protocol
Database
```

Contoh historically:

```text
Oracle OCI driver
DB2 native driver
```

Karakteristik:

```text
- memakai native client library vendor
- bisa mendukung fitur tertentu yang tidak ada di thin driver
- butuh instalasi native library
- deployment lebih sulit di container/Kubernetes
- portability OS lebih rendah
```

Kapan relevan?

```text
- legacy enterprise environment
- fitur vendor tertentu hanya tersedia via native client
- integrasi dengan client stack yang sudah ada
```

Tetapi untuk aplikasi cloud-native modern, ini biasanya dihindari kecuali ada kebutuhan spesifik.

---

### 3.3 Type 3 — Middleware / Network Protocol Driver

Model:

```text
Java Application
   ↓ JDBC
JDBC Middleware Driver
   ↓ middleware protocol
Middleware Server
   ↓ database native protocol
Database
```

Karakteristik:

```text
- driver berbicara ke middleware, bukan langsung ke database
- middleware menerjemahkan request ke database
- bisa menyediakan routing, security, multiplexing, atau abstraction
- menambah operational component baru
```

Kelebihan:

```text
- centralized access control
- abstraction multi-database
- mungkin cocok untuk environment lama
```

Kekurangan:

```text
- tambahan latency
- tambahan failure point
- behavior debugging lebih sulit
```

---

### 3.4 Type 4 — Pure Java / Thin Driver

Model:

```text
Java Application
   ↓ JDBC
Pure Java JDBC Driver
   ↓ database wire protocol over socket/TLS
Database Listener / Server
```

Karakteristik:

```text
- implementasi Java murni
- berbicara langsung ke database protocol
- tidak butuh native library
- paling umum untuk modern application
- cocok untuk server, container, Kubernetes, cloud
```

Contoh:

```text
Oracle JDBC Thin Driver
PostgreSQL JDBC Driver
MySQL Connector/J
Microsoft SQL Server JDBC Driver
MariaDB Connector/J
```

Inilah model yang paling penting untuk seri ini.

Oracle misalnya menjelaskan JDBC Thin driver sebagai driver yang melakukan direct connection ke database dengan implementasi Oracle Net Services di atas Java sockets, mendukung TCP/IP, dan membutuhkan listener database pada socket TCP/IP.

Mental model Type 4:

```text
Driver = Java implementation of database network client.
```

Bukan sekadar wrapper.

---

## 4. Modern JDBC Driver: Apa yang Sebenarnya Dilakukan?

Sebuah JDBC driver modern biasanya melakukan banyak pekerjaan sekaligus:

```text
1. menerima JDBC URL
2. parsing host, port, database/service, parameter
3. membuka TCP socket
4. melakukan TLS negotiation bila aktif
5. melakukan authentication handshake
6. membuat database session
7. mengirim SQL text atau prepared statement request
8. mengirim bind parameter
9. menerima metadata kolom
10. menerima row data
11. decode binary/text protocol menjadi Java object
12. mengelola cursor/fetch buffer
13. mengelola transaction commands
14. mengirim commit/rollback
15. melakukan cancel query bila didukung
16. mengubah database error menjadi SQLException
17. menangani network timeout/socket error
18. menutup session dan socket
```

Dari perspektif aplikasi, semua itu tersembunyi di balik:

```java
ps.executeQuery();
```

Tapi dari perspektif production, detail ini menentukan:

```text
- latency
- throughput
- memory usage
- timeout behavior
- retry safety
- pool health
- observability
- failure recovery
```

---

## 5. End-to-End Flow: `getConnection()`

Mari uraikan apa yang mungkin terjadi saat aplikasi meminta koneksi.

Kode:

```java
Connection connection = DriverManager.getConnection(
        "jdbc:postgresql://db.example.com:5432/app",
        "app_user",
        "secret"
);
```

Flow konseptual:

```text
Application Thread
   ↓
DriverManager.getConnection(url, properties)
   ↓
DriverManager mencari registered driver
   ↓
Driver.acceptsURL(url)
   ↓
Driver.connect(url, properties)
   ↓
Driver parse URL
   ↓
DNS resolution db.example.com
   ↓
TCP connect ke host:port
   ↓
TLS handshake bila SSL aktif
   ↓
database protocol startup packet
   ↓
authentication exchange
   ↓
session created on database side
   ↓
Connection implementation returned
```

Jika memakai pool seperti HikariCP:

```java
Connection connection = hikariDataSource.getConnection();
```

Flow-nya berbeda:

```text
Application Thread
   ↓
HikariDataSource.getConnection()
   ↓
Pool mencari idle physical connection
   ↓
Jika ada: return proxy logical connection
   ↓
Jika tidak ada dan pool belum penuh: create physical connection via driver
   ↓
Jika pool penuh: wait sampai connection returned atau connectionTimeout
```

Perbedaan penting:

```text
DriverManager.getConnection() biasanya membuat physical connection baru.
Pool DataSource.getConnection() biasanya meminjam logical connection dari pool.
```

Ini fundamental.

Saat memakai HikariCP, `connection.close()` bukan berarti selalu:

```text
socket ke database ditutup
```

Melainkan biasanya:

```text
logical connection dikembalikan ke pool
```

Physical connection baru ditutup saat:

```text
- pool shutdown
- maxLifetime tercapai
- idleTimeout policy berlaku
- connection dianggap broken
- credential/validation failure
- pool resizing/eviction
```

---

## 6. Driver Discovery dan Registration

Sebelum JDBC 4, aplikasi sering menulis:

```java
Class.forName("oracle.jdbc.OracleDriver");
```

atau:

```java
Class.forName("org.postgresql.Driver");
```

Tujuannya bukan “memakai class” secara langsung, tetapi memicu class loading agar static initializer driver mendaftarkan diri ke `DriverManager`.

Modern JDBC mendukung auto-loading via Service Provider mechanism. Driver JAR menyediakan metadata seperti:

```text
META-INF/services/java.sql.Driver
```

Isinya misalnya:

```text
org.postgresql.Driver
```

Saat `DriverManager` inisialisasi, driver yang tersedia di classpath/module path dapat ditemukan dan dimuat.

Mental model:

```text
Driver JAR on classpath/module path
   ↓
Service provider metadata
   ↓
DriverManager discovers driver
   ↓
Driver registered
   ↓
DriverManager can delegate connection request
```

Konsekuensi praktis:

```text
- Di aplikasi modern, Class.forName biasanya tidak diperlukan.
- Tetapi di environment lama, custom classloader, app server, plugin architecture, atau test framework tertentu, explicit loading kadang masih muncul.
- Masalah driver tidak ditemukan sering terkait classpath, dependency scope, shading, module path, atau classloader isolation.
```

---

## 7. DriverManager Selection Algorithm: Siapa yang Menang?

Saat memanggil:

```java
DriverManager.getConnection(url, props);
```

`DriverManager` akan mencoba driver yang terdaftar. Driver yang menerima URL akan mencoba membuat koneksi.

Konsep penting:

```text
URL prefix menentukan driver yang cocok.
```

Contoh:

```text
jdbc:postgresql://localhost:5432/app
jdbc:mysql://localhost:3306/app
jdbc:oracle:thin:@//localhost:1521/FREEPDB1
jdbc:sqlserver://localhost:1433;databaseName=app
```

Setiap driver punya implementasi:

```java
boolean acceptsURL(String url)
```

Jika URL tidak cocok, driver mengembalikan false atau connect mengembalikan null.

Praktisnya:

```text
- Prefix URL salah → No suitable driver.
- Driver JAR tidak ada → No suitable driver.
- Driver ada tapi classloader tidak melihat → No suitable driver.
- URL cocok tapi host salah → connection/network/auth error, bukan no suitable driver.
```

Bedakan dua kategori error:

```text
No suitable driver
  = Java tidak menemukan driver yang bisa menangani URL.

Connection refused / timeout / authentication failed
  = driver ditemukan, tapi koneksi nyata gagal.
```

Ini sangat membantu debugging.

---

## 8. Anatomy of JDBC URL

JDBC URL tidak sepenuhnya distandardisasi sampai detail vendor. Format umumnya:

```text
jdbc:<subprotocol>:<subname>
```

Tetapi detail `<subname>` vendor-specific.

Contoh:

```text
PostgreSQL:
jdbc:postgresql://host:5432/database?ssl=true&connectTimeout=10

MySQL:
jdbc:mysql://host:3306/database?useSSL=true&serverTimezone=UTC

Oracle service name:
jdbc:oracle:thin:@//host:1521/service_name

Oracle TNS style:
jdbc:oracle:thin:@(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=host)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=service)))

SQL Server:
jdbc:sqlserver://host:1433;databaseName=app;encrypt=true;trustServerCertificate=false
```

JDBC URL biasanya membawa beberapa kategori informasi:

```text
1. driver family / subprotocol
2. host
3. port
4. database name / service name / SID
5. routing information
6. TLS setting
7. timeout setting
8. socket option
9. authentication option
10. session initialization option
11. performance option
12. compatibility option
```

Contoh mental model:

```text
jdbc:postgresql://db.internal:5432/aceas?sslmode=require&connectTimeout=5&socketTimeout=30
│    │             │           │    │     │              │                │
│    │             │           │    │     │              │                └─ socket read timeout
│    │             │           │    │     │              └─ connection timeout
│    │             │           │    │     └─ TLS mode
│    │             │           │    └─ database
│    │             │           └─ port
│    │             └─ host
│    └─ subprotocol / driver family
└─ JDBC scheme
```

Pitfall:

```text
- Property name berbeda antar driver.
- Satuan waktu bisa berbeda: detik, milidetik, atau format string.
- Default TLS behavior berbeda antar versi driver.
- Default timezone behavior bisa berubah antar versi.
- URL parameter typo sering silently ignored atau baru ketahuan saat runtime.
```

Karena itu engineer harus membaca dokumentasi driver yang spesifik, bukan hanya dokumentasi `java.sql`.

---

## 9. Authentication Handshake

Saat aplikasi meminta koneksi, authentication bukan sekadar mengirim username/password.

Flow generik:

```text
TCP/TLS established
   ↓
client sends startup/auth request
   ↓
server responds with auth method/challenge
   ↓
client sends credential proof/token/certificate response
   ↓
server validates
   ↓
server creates session
   ↓
connection ready
```

Bentuk authentication bisa berupa:

```text
- username/password
- password hash challenge-response
- Kerberos/GSSAPI
- certificate-based authentication
- IAM token / cloud database token
- wallet-based authentication
- integrated security
- OAuth/token-based extension in some ecosystems
```

Implikasi production:

```text
- Credential rotation bisa memengaruhi pembuatan koneksi baru, bukan koneksi lama yang sudah established.
- Pool bisa tetap sehat sementara koneksi lama masih valid, tetapi gagal membuat koneksi baru setelah password berubah.
- Jika database memaksa session disconnect saat credential expired, pool bisa mendadak penuh broken connections.
- Cloud IAM token punya expiry; pool maxLifetime harus diselaraskan dengan umur token.
```

Contoh failure scenario:

```text
1. Aplikasi start dengan password lama.
2. Pool membuat 20 physical connections.
3. Password dirotasi di secret manager dan database.
4. Existing sessions masih hidup.
5. Saat HikariCP retire connection karena maxLifetime, ia mencoba membuat connection baru.
6. Jika aplikasi belum reload secret, koneksi baru gagal.
7. Pool perlahan kehilangan healthy connection.
8. Traffic naik → pool exhaustion.
```

Lesson:

```text
Credential rotation is a pool lifecycle problem, not just a secret storage problem.
```

---

## 10. Network Socket, TLS, and Database Listener

Driver Type 4 berbicara ke database melalui jaringan.

Flow fisik:

```text
JVM process
   ↓
OS socket
   ↓
node network stack
   ↓
VPC/VNet/subnet/security group/firewall/NAT
   ↓
load balancer/proxy/listener if any
   ↓
database listener
   ↓
database server process/session
```

Koneksi JDBC bisa gagal di banyak titik:

```text
1. DNS resolution failure
2. TCP connect timeout
3. connection refused
4. firewall drop
5. TLS handshake failure
6. certificate validation failure
7. database listener unavailable
8. authentication failure
9. database max sessions reached
10. database process crash
11. network partition
12. idle connection killed by firewall/NAT
13. socket half-open
```

Aplikasi sering hanya melihat:

```java
SQLException
```

Tetapi penyebabnya bisa berada di:

```text
- aplikasi
- driver
- JVM security/TLS config
- DNS
- Kubernetes networking
- cloud security group
- database listener
- database instance
- database account
- database resource limit
```

Top 1% engineer tidak berhenti pada stacktrace. Ia mengklasifikasikan failure berdasarkan lapisan.

---

## 11. Wire Protocol: Text, Binary, Parse, Bind, Execute, Fetch

Setiap database punya protocol. Detailnya vendor-specific, tetapi pola umum dapat dipahami.

Untuk query sederhana:

```text
Client sends SQL text
   ↓
Server parses
   ↓
Server plans
   ↓
Server executes
   ↓
Server sends result metadata
   ↓
Server sends rows
   ↓
Client decodes rows
```

Untuk prepared statement:

```text
Client sends prepare/parse request
   ↓
Server parses SQL with placeholders
   ↓
Server may create statement handle / plan
   ↓
Client sends bind values
   ↓
Server executes with bind values
   ↓
Client fetches rows
```

Namun ada variasi:

```text
- Some drivers use server-side prepare only after threshold.
- Some emulate prepared statement client-side.
- Some cache prepared statements.
- Some rely on database plan cache.
- Some rewrite SQL for batch performance.
- Some send parameters in text mode, others binary mode.
```

Karena itu `PreparedStatement` punya beberapa manfaat yang berbeda:

```text
Security benefit:
  parameter binding helps separate SQL structure from values.

Correctness benefit:
  driver can encode values according to SQL type.

Performance benefit:
  possible parse/plan reuse, but not guaranteed in the same way across drivers.
```

Jangan menyederhanakan menjadi:

```text
PreparedStatement is always faster.
```

Lebih akurat:

```text
PreparedStatement is primarily a safe parameterization mechanism.
It may also enable server/client statement reuse depending on driver and database configuration.
```

---

## 12. Client-Side vs Server-Side Prepared Statement

Ini salah satu area yang sering disalahpahami.

Dari sisi Java:

```java
PreparedStatement ps = connection.prepareStatement(
        "select * from users where email = ?"
);
```

Tetapi implementasi driver dapat memilih beberapa strategi.

---

### 12.1 Client-Side Prepared Statement

Model:

```text
Java PreparedStatement object
   ↓
driver stores SQL template
   ↓
driver safely encodes parameters
   ↓
driver sends final request to server
```

Karakteristik:

```text
- server mungkin tidak menyimpan prepared statement handle
- keamanan tetap bisa baik jika driver melakukan parameter binding/protocol dengan benar
- performance parse reuse mungkin tidak sebesar server-side prepare
```

---

### 12.2 Server-Side Prepared Statement

Model:

```text
prepare SQL on server
   ↓
server returns statement handle/name
   ↓
bind values repeatedly
   ↓
execute repeatedly
```

Karakteristik:

```text
- bisa mengurangi parse overhead
- bisa memanfaatkan plan cache tertentu
- ada lifecycle statement di server
- bisa mengonsumsi resource server
- perlu deallocate/close
```

---

### 12.3 Prepare Threshold

Beberapa driver tidak langsung memakai server-side prepare sejak eksekusi pertama. Mereka bisa menunggu statement dieksekusi beberapa kali.

Mental model:

```text
Execution 1-4 : simple/client-side path
Execution 5+  : server-side prepared path
```

Tujuannya menghindari overhead server-side prepare untuk query yang hanya sekali jalan.

Implikasi:

```text
Benchmark satu-dua eksekusi bisa misleading.
Behavior production bisa berbeda saat query sering dieksekusi.
```

---

## 13. Statement Cache vs Plan Cache vs Pool

Tiga hal ini sering tercampur.

```text
Connection pool
  Menyimpan physical database connections agar tidak dibuat ulang terus.

Statement cache
  Menyimpan prepared/callable statement handle di client/driver atau pool layer.

Database plan cache
  Menyimpan parsed/optimized execution plan di database server.
```

Diagram:

```text
Application
   ↓
HikariCP Pool
   ↓ contains
Physical Connection
   ↓ may have
Driver Statement Cache
   ↓ maps to
Server Prepared Statement / Cursor
   ↓ may use
Database Plan Cache
```

HikariCP secara filosofi tidak ingin menjadi statement cache kompleks. Banyak dokumentasi HikariCP menganjurkan statement caching dikonfigurasi di driver, bukan di pool, karena driver dapat mengoptimalkan per database.

Prinsip:

```text
Pool manages connections.
Driver/database manage statement/protocol-specific caching.
```

Anti-pattern:

```text
Menganggap maximumPoolSize besar akan otomatis mempercepat prepared statements.
```

Realitanya:

```text
Jika statement cache per connection, maka memperbesar pool dapat menyebar query ke lebih banyak connection, membuat cache lebih dingin.
```

Contoh:

```text
Pool 5 connections:
  query A sering reuse pada 5 connection → statement cache relatif hangat.

Pool 50 connections:
  query A tersebar ke 50 connection → cache per connection lebih mudah dingin.
```

Lagi-lagi: bigger pool is not always better.

---

## 14. Result Fetching: Driver Tidak Selalu Mengambil Satu Row Saja

Saat kode memanggil:

```java
while (rs.next()) {
    process(rs);
}
```

Kita sering membayangkan setiap `next()` mengambil satu row dari database.

Itu biasanya salah.

Model yang lebih benar:

```text
Driver fetches rows in chunks/batches.
ResultSet.next() consumes rows from local fetch buffer.
When buffer empty, driver asks server for more rows.
```

Diagram:

```text
Database cursor/result
   ↓ fetch 100 rows
Driver buffer
   ↓ next()
Application row processing
```

`fetchSize` memberi hint:

```java
statement.setFetchSize(500);
```

Tetapi:

```text
- Tidak semua driver memperlakukan fetchSize sama.
- Ada driver yang mengabaikan atau membatasi.
- Ada driver yang butuh mode cursor tertentu.
- Ada driver yang default-nya mengambil seluruh result set.
- Ada driver yang streaming tetapi butuh autocommit false.
```

Implikasi production:

```text
Query yang mengembalikan 2 juta row bisa menyebabkan:
- heap pressure di JVM
- network burst
- database cursor lama terbuka
- transaction lama
- pool connection tertahan lama
```

Top 1% engineer memikirkan result set sebagai stream/cursor/fetch buffer, bukan list.

---

## 15. Transaction Commands: Driver Mengirim Perintah ke Session

JDBC transaction control:

```java
connection.setAutoCommit(false);
// work
connection.commit();
```

Di bawahnya driver harus mengatur session database.

Kemungkinan command/protocol:

```text
BEGIN / START TRANSACTION
COMMIT
ROLLBACK
SET TRANSACTION ISOLATION LEVEL ...
SAVEPOINT ...
ROLLBACK TO SAVEPOINT ...
```

Tetapi detail berbeda antar database.

Contoh variasi:

```text
- Ada database yang implicit begin saat statement pertama dijalankan.
- Ada database yang DDL menyebabkan implicit commit.
- Ada database yang isolation level berlaku untuk transaction berikutnya.
- Ada database yang readOnly hanya hint.
- Ada database yang mengoptimalkan read-only transaction.
```

Dari sisi JDBC:

```java
connection.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
```

Dari sisi nyata:

```text
Driver menerjemahkan ini menjadi protocol command/vendor SQL/session setting.
```

Karena itu transaction adalah area di mana API portable, tetapi behavior harus divalidasi per database.

---

## 16. Error Translation: Dari Database Error ke SQLException

Database mengembalikan error dalam format vendor.

Contoh kategori:

```text
- syntax error
- constraint violation
- duplicate key
- foreign key violation
- deadlock detected
- lock timeout
- serialization failure
- connection lost
- authentication failed
- invalid object/table
- permission denied
- data truncation
```

Driver menerjemahkan menjadi:

```java
SQLException
```

Dengan informasi:

```java
String sqlState = ex.getSQLState();
int vendorCode = ex.getErrorCode();
SQLException next = ex.getNextException();
```

Kadang juga subclass:

```text
SQLIntegrityConstraintViolationException
SQLTransientConnectionException
SQLTimeoutException
SQLSyntaxErrorException
SQLRecoverableException
```

Tetapi jangan mengandalkan subclass saja.

Prinsip production:

```text
For robust error handling, inspect at least:
- exception class
- SQLState
- vendor error code
- driver/database documentation
- operation context
```

Contoh:

```text
Deadlock di Oracle, PostgreSQL, MySQL, SQL Server punya error code berbeda.
Retry classification harus database-aware.
```

---

## 17. Driver-Specific Behavior: Oracle JDBC

Oracle JDBC ecosystem memiliki beberapa karakteristik penting.

### 17.1 Thin vs OCI

Secara modern, Oracle Thin driver umum dipakai karena pure Java dan tidak membutuhkan Oracle Client native library.

Model Thin:

```text
Java application
   ↓
Oracle JDBC Thin Driver
   ↓ Oracle Net over Java sockets
Oracle Database Listener
   ↓
Database session
```

Model OCI:

```text
Java application
   ↓ JDBC
Oracle OCI JDBC Driver
   ↓ native OCI library
Oracle Client
   ↓ Oracle Net
Oracle Database
```

Thin biasanya lebih cocok untuk:

```text
- container
- Kubernetes
- cloud deployment
- simpler dependency
- standard application server deployment
```

OCI bisa relevan untuk fitur khusus tertentu, tetapi deployment-nya lebih berat.

### 17.2 URL Sensitivity

Oracle punya beberapa style URL:

```text
Service name:
jdbc:oracle:thin:@//host:1521/service

SID legacy style:
jdbc:oracle:thin:@host:1521:SID

TNS descriptor:
jdbc:oracle:thin:@(DESCRIPTION=...)
```

Kesalahan service/SID sering menyebabkan error yang membingungkan.

### 17.3 Row Prefetch

Oracle driver punya konsep row prefetch/fetch size. Ini penting untuk query besar karena memengaruhi round-trip dan memory.

Mental model:

```text
fetch too small  → terlalu banyak round-trip
fetch too large  → memory pressure dan latency burst
```

### 17.4 LOB Handling

Oracle LOB dapat memiliki behavior locator/session/transaction-sensitive. Jika aplikasi membaca CLOB/BLOB besar, pastikan resource dan transaction scope benar.

### 17.5 Session State

Oracle punya banyak session state penting:

```text
- current schema
- NLS settings
- module/action/client identifier
- package state
- temporary table state
```

Dalam pool, session state leakage bisa berbahaya.

---

## 18. Driver-Specific Behavior: PostgreSQL JDBC

PostgreSQL JDBC driver memiliki beberapa aspek penting.

### 18.1 URL

```text
jdbc:postgresql://host:5432/database
```

Dengan properties misalnya:

```text
sslmode
connectTimeout
socketTimeout
applicationName
currentSchema
reWriteBatchedInserts
```

### 18.2 Server-Side Prepare and Threshold

PostgreSQL driver historically memiliki konsep prepare threshold. Server-side prepared statement bisa muncul setelah statement dieksekusi beberapa kali.

Implikasi:

```text
- performance berbeda antara cold path dan hot path
- plan caching bisa berdampak baik atau buruk tergantung data distribution
- query dengan parameter skew bisa terkena generic plan issue
```

### 18.3 Streaming ResultSet

Untuk result set besar, PostgreSQL JDBC streaming biasanya membutuhkan fetch size positif dan kondisi transaction tertentu. Jika autocommit true, seluruh result bisa saja diambil sekaligus tergantung mode.

Prinsip:

```text
Jangan menganggap setFetchSize cukup tanpa memahami driver docs.
```

### 18.4 Application Name

PostgreSQL mendukung `application_name`, berguna untuk observability database-side.

Contoh:

```text
jdbc:postgresql://db:5432/app?ApplicationName=case-service
```

atau property driver.

Tujuan:

```text
DBA dapat melihat session berasal dari service mana.
```

---

## 19. Driver-Specific Behavior: MySQL Connector/J

MySQL Connector/J juga punya banyak property yang sangat memengaruhi behavior.

### 19.1 URL

```text
jdbc:mysql://host:3306/database?useSSL=true&serverTimezone=UTC
```

Common properties:

```text
useSSL / sslMode
serverTimezone
connectTimeout
socketTimeout
rewriteBatchedStatements
cachePrepStmts
prepStmtCacheSize
prepStmtCacheSqlLimit
useServerPrepStmts
```

### 19.2 Time Zone Trap

MySQL applications sering mengalami bug pada:

```text
- TIMESTAMP vs DATETIME
- server time zone
- JVM default time zone
- session time zone
- driver conversion
```

Lesson:

```text
Time zone correctness must be explicitly designed, not assumed.
```

### 19.3 Batch Rewrite

`rewriteBatchedStatements` dapat mengubah batch insert menjadi multi-value insert untuk performance.

Contoh konseptual:

```sql
insert into t(a,b) values (?,?)
insert into t(a,b) values (?,?)
insert into t(a,b) values (?,?)
```

Direwrite menjadi:

```sql
insert into t(a,b) values (?,?), (?,?), (?,?)
```

Kuat untuk throughput, tetapi perlu memahami:

```text
- generated keys behavior
- packet size
- partial failure
- lock amplification
```

### 19.4 Prepared Statement Cache

MySQL driver sering dikonfigurasi dengan prepared statement cache. Ini driver-level concern, bukan HikariCP concern.

---

## 20. Driver-Specific Behavior: Microsoft SQL Server JDBC

SQL Server JDBC driver punya karakteristik tersendiri.

### 20.1 URL

```text
jdbc:sqlserver://host:1433;databaseName=app;encrypt=true;trustServerCertificate=false
```

Common properties:

```text
encrypt
trustServerCertificate
hostNameInCertificate
loginTimeout
queryTimeout
applicationName
integratedSecurity
authentication
```

### 20.2 TLS Defaults

Beberapa versi driver SQL Server memperketat default encryption behavior. Upgrade driver bisa mengubah kebutuhan certificate/trust configuration.

Lesson:

```text
Driver upgrade is a security and connectivity event, not only dependency housekeeping.
```

### 20.3 Integrated Authentication

SQL Server banyak dipakai dengan integrated authentication/Kerberos/AD. Ini membawa dependency tambahan pada environment, principal, dan native library dalam beberapa mode.

---

## 21. Compatibility Matrix

Salah satu kesalahan serius adalah menganggap driver JAR bisa di-upgrade sembarang.

Minimal matrix yang harus dicek:

```text
JDK version
JDBC API level
driver version
minimum supported Java version by driver
database server version
cloud database engine version
TLS/cipher compatibility
authentication method
framework version
connection pool version
observability agent instrumentation version
```

Contoh matrix:

```text
Application JDK      : Java 21
Framework            : Spring Boot 3.4.x
Pool                 : HikariCP 5.x/6.x depending dependency tree
Database             : Oracle 19c
Driver               : ojdbc11 version X
Deployment           : EKS
TLS                  : enabled
Auth                 : username/password from secret manager
```

Pertanyaan review:

```text
1. Apakah driver mendukung JDK yang dipakai?
2. Apakah driver mendukung database server version?
3. Apakah database server mendukung TLS/cipher yang digunakan JVM?
4. Apakah framework override driver properties?
5. Apakah pool configuration kompatibel dengan auth token lifetime?
6. Apakah observability agent mendukung driver version?
7. Apakah driver upgrade mengubah default SSL/timezone/prepared statement behavior?
```

---

## 22. Classpath, Module Path, and ClassLoader Pitfalls

JDBC driver discovery bergantung pada driver JAR terlihat oleh classloader yang tepat.

Common failure:

```text
java.sql.SQLException: No suitable driver found for jdbc:postgresql://...
```

Kemungkinan penyebab:

```text
1. dependency driver belum ditambahkan
2. dependency scope test/provided salah
3. JAR tidak masuk final artifact
4. shading/relocation merusak service provider metadata
5. module path tidak membaca module driver
6. app server classloader isolation
7. duplicate old driver menang lebih dulu
8. URL prefix salah
```

Di Spring Boot fat jar, biasanya driver ikut karena dependency runtime.

Di application server/Jakarta EE:

```text
- driver bisa dipasang di server-level lib
- DataSource dikelola container
- classloader aplikasi mungkin berbeda dari classloader server
```

Di plugin architecture:

```text
- driver mungkin perlu loaded/unloaded dinamis
- DriverManager dapat menyimpan reference ke driver dan classloader
- deregistration penting untuk menghindari classloader leak
```

---

## 23. Driver and Connection Pool Interaction

HikariCP tidak menggantikan driver. HikariCP menggunakan driver.

Flow:

```text
HikariCP
   ↓ calls
Driver/DataSource
   ↓ creates
Physical Connection
   ↓ wraps as
Proxy Connection
   ↓ returned to app
```

Pool bergantung pada driver untuk:

```text
- physical connection creation
- validation
- network timeout support
- isValid()
- connection properties
- transaction isolation support
- read-only support
- schema/catalog support
- exception signals
```

Jika driver `isValid(timeout)` tidak bekerja baik, pool validation bisa bermasalah.

Jika driver tidak mendukung `setNetworkTimeout`, timeout semantics bisa tidak sesuai harapan.

Jika driver mengabaikan `readOnly`, aplikasi tidak boleh menganggap database otomatis read-only.

Jadi saat tuning HikariCP, sebenarnya kita tuning kombinasi:

```text
Application concurrency
+ HikariCP config
+ JDBC driver behavior
+ database server capacity
+ network behavior
```

Bukan HikariCP saja.

---

## 24. Why `DataSource` Is Preferred over `DriverManager`

`DriverManager` adalah basic service untuk mengelola driver dan membuat koneksi. Tetapi untuk aplikasi modern, `DataSource` lebih disukai.

Kenapa?

```text
DriverManager:
- static global access
- configuration sering tersebar
- sulit dependency injection
- biasanya membuat koneksi baru langsung
- kurang ideal untuk pooling abstraction

DataSource:
- object dependency
- bisa diinject
- bisa pool-backed
- bisa container-managed
- bisa tenant-aware
- bisa dibungkus observability/proxy
- lebih cocok untuk production application
```

Contoh boundary yang baik:

```java
public final class UserRepository {
    private final DataSource dataSource;

    public UserRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource);
    }
}
```

Bukan:

```java
public final class Db {
    public static Connection getConnection() throws SQLException {
        return DriverManager.getConnection(URL, USER, PASSWORD);
    }
}
```

Mengapa static helper buruk?

```text
- menyembunyikan lifecycle
- sulit testing
- sulit observability
- sulit multi-database
- sulit pooling control
- sulit secret rotation
- sulit graceful shutdown
```

---

## 25. Deployment Model: Bare Metal, App Server, Container, Kubernetes

Driver architecture juga dipengaruhi deployment.

---

### 25.1 Bare Metal / VM

```text
- driver JAR di aplikasi
- network ke database relatif stabil
- DNS mungkin jarang berubah
- long-lived process
```

Risiko:

```text
- stale connection karena firewall idle timeout
- manual driver upgrade
- OS/JVM TLS compatibility
```

---

### 25.2 App Server / Jakarta EE

```text
- DataSource bisa dikelola server
- pool mungkin server-managed
- driver bisa dipasang di server library
- transaction bisa JTA/XA
```

Risiko:

```text
- classloader isolation
- duplicate driver
- config tersembunyi di server
- app tidak mengontrol pool lifecycle langsung
```

---

### 25.3 Container

```text
- driver packaged with application image
- immutable dependency
- environment variable/secrets injection
- process restart cheap
```

Risiko:

```text
- image lama membawa driver lama
- secret rotation perlu restart/reload strategy
- DNS/cache behavior perlu diperhatikan
```

---

### 25.4 Kubernetes

```text
- banyak replica berarti pool size dikali replica
- pod restart menciptakan connection churn
- node/network/DNS issue dapat memengaruhi koneksi
- readiness/liveness harus tidak menghancurkan DB saat incident
```

Contoh:

```text
10 pods × maximumPoolSize 30 = 300 possible DB connections
```

Jika database max session 200, konfigurasi ini sudah salah bahkan sebelum traffic datang.

Driver architecture + pool sizing + deployment scaling harus dibaca bersama.

---

## 26. DNS, Failover, and Driver Behavior

Database cloud sering memakai endpoint DNS:

```text
mydb.cluster-xxxx.ap-southeast-1.rds.amazonaws.com
```

Saat failover:

```text
DNS record dapat berubah ke primary baru.
```

Tetapi aplikasi punya beberapa cache:

```text
- JVM DNS cache
- OS DNS cache
- container/node resolver cache
- driver internal behavior
- pool existing physical connections
```

Skenario:

```text
1. Primary DB gagal.
2. Cloud provider mengarahkan DNS endpoint ke primary baru.
3. Existing physical connections ke old primary mati/stale.
4. Pool harus mendeteksi broken connections.
5. New connections harus resolve DNS baru.
6. Jika DNS cache terlalu lama, aplikasi terus mencoba IP lama.
```

Lesson:

```text
Failover is not only database-side.
It is driver + DNS + pool + JVM + application timeout behavior.
```

Checklist:

```text
- Apakah driver mendukung multi-host/failover URL?
- Apakah DNS TTL sesuai?
- Apakah JVM DNS cache tidak terlalu panjang?
- Apakah connection validation cukup cepat?
- Apakah connectionTimeout tidak terlalu lama?
- Apakah maxLifetime/keepaliveTime membantu membersihkan stale connection?
- Apakah retry dilakukan pada boundary yang aman?
```

---

## 27. TLS and Certificate Validation

TLS ke database bukan hanya `ssl=true`.

Ada beberapa aspek:

```text
1. encryption enabled atau tidak
2. server certificate validation
3. hostname verification
4. truststore
5. client certificate bila mutual TLS
6. TLS protocol version
7. cipher suite
8. cloud CA rotation
```

Risky configuration:

```text
trustServerCertificate=true
sslmode=disable
sslmode=require without verify-full, depending database
custom truststore tidak diperbarui saat CA rotation
```

Production principle:

```text
Encryption without identity verification protects against passive sniffing,
but may not fully protect against active man-in-the-middle.
```

Untuk regulated system, pahami apakah policy mewajibkan:

```text
- encryption in transit
- certificate validation
- hostname verification
- CA rotation process
- audit proof
```

Driver property TLS sangat vendor-specific, jadi tidak cukup membaca `java.sql` API.

---

## 28. Timeout: Driver Properties vs JDBC API

Timeout di JDBC stack punya banyak lapisan:

```text
1. DNS timeout
2. TCP connect timeout
3. TLS handshake timeout
4. login/auth timeout
5. pool connectionTimeout
6. JDBC Statement queryTimeout
7. socket read timeout
8. database statement timeout
9. lock timeout
10. transaction timeout
11. HTTP request timeout
```

Driver biasanya punya property seperti:

```text
connectTimeout
socketTimeout
loginTimeout
queryTimeout
```

Tetapi nama dan satuan berbeda.

Contoh konseptual:

```text
connectTimeout = berapa lama menunggu TCP connect/login path
socketTimeout  = berapa lama read dari socket boleh blocking
queryTimeout   = berapa lama statement boleh berjalan sebelum cancel
```

Jangan samakan:

```text
Hikari connectionTimeout != database query timeout
```

Hikari `connectionTimeout` adalah waktu maksimal thread menunggu mendapatkan connection dari pool. Itu bukan waktu maksimal SQL berjalan.

Mental model:

```text
Pool acquisition timeout protects app threads from waiting pool forever.
Driver/socket/query timeout protects app from waiting database/network forever.
Database lock/statement timeout protects database from runaway work.
```

Part timeout akan dibahas sangat detail di Part 022.

---

## 29. Cancellation Semantics

Saat query timeout terjadi, apa yang sebenarnya terjadi?

Kemungkinan:

```text
1. driver mengirim cancel request ke server
2. server menghentikan query
3. query tetap berjalan sampai mencapai cancellation point
4. socket ditutup paksa
5. connection dianggap broken
6. transaction berada dalam failed state
```

Tidak semua database/driver sama.

Production risk:

```text
Aplikasi timeout, tetapi query masih berjalan di database.
```

Akibat:

```text
- lock tetap tertahan
- CPU database tetap jalan
- user retry menciptakan duplicate workload
- pool connection tidak segera reusable
```

Karena itu query timeout harus dikombinasikan dengan:

```text
- database-side statement timeout
- transaction timeout
- cancellation-aware error handling
- idempotency design
- observability database-side
```

---

## 30. Unwrapping Vendor Connection

JDBC menyediakan `Wrapper`:

```java
<T> T unwrap(Class<T> iface) throws SQLException;
boolean isWrapperFor(Class<?> iface) throws SQLException;
```

Tujuannya: mendapatkan object vendor-specific saat perlu fitur non-standard.

Contoh:

```java
OracleConnection oracleConnection = connection.unwrap(OracleConnection.class);
```

Atau:

```java
PGConnection pgConnection = connection.unwrap(PGConnection.class);
```

Kapan valid?

```text
- butuh fitur driver-specific yang tidak ada di JDBC standard
- setting advanced vendor property
- bulk copy API
- database notification/listen API
- Oracle-specific LOB/object handling
```

Risiko:

```text
- kode tidak portable
- coupling ke driver vendor
- sulit test dengan database lain
- bisa pecah saat driver upgrade
- bisa bypass pool proxy behavior jika tidak hati-hati
```

Prinsip:

```text
Unwrap only at infrastructure boundary.
Never scatter vendor-specific code across business logic.
```

Desain yang lebih baik:

```text
Business Service
   ↓
Repository Interface
   ↓
Database Adapter
   ↓
Vendor-Specific JDBC Extension isolated here
```

---

## 31. Multi-Host and Cluster-Aware URLs

Beberapa driver mendukung multi-host URL.

Contoh konseptual:

```text
jdbc:postgresql://host1:5432,host2:5432/app?targetServerType=primary
```

Atau database vendor/cloud-specific routing.

Fungsi:

```text
- failover
- load balancing read replica
- primary/secondary selection
- availability zone routing
```

Tetapi hati-hati:

```text
Driver-level failover tidak otomatis membuat transaction safe.
```

Jika koneksi mati di tengah transaction:

```text
- transaction context hilang
- statement terakhir mungkin berhasil atau gagal ambigu
- retry harus dilakukan di operation boundary yang idempotent
```

Prinsip:

```text
Connection failover can restore connectivity.
It cannot magically preserve in-flight transaction semantics.
```

---

## 32. Read/Write Splitting: Driver vs Application

Beberapa arsitektur menggunakan:

```text
primary database untuk write
read replica untuk read
```

Routing bisa dilakukan oleh:

```text
1. application code
2. framework routing DataSource
3. driver multi-host feature
4. database proxy
5. service mesh/proxy layer
```

Trade-off:

```text
Application routing:
  + eksplisit
  + domain-aware
  - butuh disiplin transaction boundary

Driver routing:
  + transparan
  - behavior vendor-specific
  - sulit memahami consistency

Proxy routing:
  + central control
  - tambahan failure point
  - transaction/session affinity kompleks
```

Consistency problem:

```text
Write to primary
   ↓
Immediate read from replica
   ↓
Data might not be visible due to replication lag
```

JDBC driver tidak menghilangkan masalah consistency ini.

---

## 33. Driver Logging and Diagnosability

Driver sering punya logging sendiri, tetapi harus digunakan hati-hati.

Yang ingin didiagnosis:

```text
- connection creation
- connection close
- SQL execution
- bind values
- protocol errors
- SSL errors
- failover behavior
- timeout/cancel behavior
```

Risiko logging:

```text
- PII leakage
- credential leakage
- huge log volume
- performance overhead
- log injection
```

Prinsip:

```text
Enable verbose JDBC driver logging only temporarily and in controlled environment,
unless already sanitized and approved.
```

Lebih aman untuk production:

```text
- pool metrics
- query duration metrics
- SQL template/hash, not raw sensitive bind values
- SQLState/vendor error code
- database session correlation
- slow query log database-side
```

---

## 34. Driver Upgrade Risk Model

Driver upgrade sering dianggap dependency maintenance biasa. Itu keliru.

Driver upgrade dapat mengubah:

```text
1. default TLS behavior
2. supported authentication methods
3. timezone conversion
4. prepared statement behavior
5. batch rewrite behavior
6. error code mapping
7. query cancellation behavior
8. LOB streaming behavior
9. metadata behavior
10. minimum JDK version
11. performance characteristics
12. class names/internal APIs
13. logging behavior
14. default socket timeout behavior
```

Review sebelum upgrade:

```text
- baca release notes
- cek breaking changes
- cek security changes
- jalankan integration test real DB
- test TLS connection
- test time zone/date values
- test batch insert
- test generated keys
- test LOB read/write
- test failover/restart database
- test pool validation
- test timeout/cancel
- compare latency/throughput
```

Production deployment:

```text
- canary if possible
- observe pool metrics
- observe DB sessions
- observe SQL errors by SQLState/vendor code
- rollback plan
```

---

## 35. Minimal Plain JDBC Driver Example

Contoh ini bukan rekomendasi production final, tetapi membantu memahami driver path.

```java
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Properties;

public final class DriverManagerExample {

    public static void main(String[] args) throws SQLException {
        String url = "jdbc:postgresql://localhost:5432/app";

        Properties props = new Properties();
        props.setProperty("user", "app_user");
        props.setProperty("password", "secret");
        props.setProperty("ApplicationName", "jdbc-learning");

        try (Connection connection = DriverManager.getConnection(url, props);
             PreparedStatement ps = connection.prepareStatement(
                     "select id, username from app_user where id = ?"
             )) {

            ps.setLong(1, 100L);

            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    long id = rs.getLong("id");
                    String username = rs.getString("username");
                    System.out.println(id + " " + username);
                }
            }
        }
    }
}
```

Apa yang terjadi:

```text
1. DriverManager mencari driver untuk jdbc:postgresql.
2. PostgreSQL driver menerima URL.
3. Driver membuka koneksi TCP/TLS sesuai config.
4. Driver melakukan auth.
5. Driver mengembalikan Connection implementation.
6. PreparedStatement dibuat.
7. Parameter di-bind.
8. Query dikirim ke database.
9. Result rows diterima dan decoded.
10. Resource ditutup.
```

Untuk production application, biasanya gunakan `DataSource`/pool, bukan raw `DriverManager` di business code.

---

## 36. Minimal HikariCP + Driver Mental Model

Contoh sederhana:

```java
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public final class HikariDriverExample {

    public static void main(String[] args) throws SQLException {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://localhost:5432/app");
        config.setUsername("app_user");
        config.setPassword("secret");
        config.setMaximumPoolSize(10);
        config.setPoolName("app-main-pool");
        config.addDataSourceProperty("ApplicationName", "case-service");

        try (HikariDataSource dataSource = new HikariDataSource(config)) {
            findUser(dataSource, 100L);
        }
    }

    private static void findUser(DataSource dataSource, long userId) throws SQLException {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement ps = connection.prepareStatement(
                     "select id, username from app_user where id = ?"
             )) {

            ps.setLong(1, userId);

            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    System.out.println(rs.getLong("id") + " " + rs.getString("username"));
                }
            }
        }
    }
}
```

Flow saat startup:

```text
HikariDataSource starts
   ↓
Hikari creates physical connections using PostgreSQL driver
   ↓
Driver opens TCP/TLS/auth/session
   ↓
Pool stores physical connections
```

Flow saat request:

```text
Application calls dataSource.getConnection()
   ↓
Hikari returns proxy logical connection
   ↓
Application uses JDBC API
   ↓
Driver sends protocol messages over physical connection
   ↓
Application closes connection
   ↓
Hikari resets state and returns it to pool
```

---

## 37. Common Production Incidents Caused by Driver Misunderstanding

### 37.1 “No Suitable Driver” After Deployment

Symptom:

```text
java.sql.SQLException: No suitable driver found for jdbc:oracle:thin:@//...
```

Likely causes:

```text
- driver dependency missing in runtime image
- wrong dependency scope
- shaded JAR lost META-INF/services/java.sql.Driver
- URL prefix typo
- driver incompatible with module/classloader setup
```

Not likely:

```text
- database down
- password wrong
```

Because those happen after driver selection.

---

### 37.2 Pool Healthy, New Connections Fail After Password Rotation

Symptom:

```text
Existing traffic works for a while.
Then slowly connection acquisition starts failing.
```

Possible flow:

```text
- existing physical sessions still authenticated
- new connection creation uses old secret
- maxLifetime retires old connections
- pool cannot replace them
- active capacity shrinks
```

Fix direction:

```text
- secret reload/restart strategy
- coordinate DB credential rotation
- validate new connection after rotation
- monitor connection creation failure
```

---

### 37.3 Query Timeout Does Not Stop Database Work

Symptom:

```text
HTTP request timed out at app layer,
but database still shows query running.
```

Possible causes:

```text
- app timeout shorter than JDBC/database timeout
- driver cancel failed
- database cancellation delayed
- query stuck on uninterruptible operation
```

Fix direction:

```text
- align timeout budget
- set database statement timeout
- monitor database sessions
- design idempotent retry
```

---

### 37.4 Fetch Size Ignored, JVM OOM

Symptom:

```text
Large export query causes heap spike/OOM.
```

Possible causes:

```text
- driver buffers all rows
- fetchSize not configured correctly for driver
- autocommit mode prevents cursor streaming
- ORM/JDBC template collects all rows into List
```

Fix direction:

```text
- read driver docs
- stream with correct transaction/fetch mode
- process rows incrementally
- paginate/chunk safely
- separate reporting workload pool
```

---

### 37.5 Driver Upgrade Breaks TLS

Symptom:

```text
After driver upgrade, connection fails with certificate or encryption error.
```

Possible causes:

```text
- driver default encryption changed
- hostname verification stricter
- truststore missing CA
- cloud database CA rotated
- old property deprecated
```

Fix direction:

```text
- review release notes
- configure truststore properly
- avoid unsafe trustServerCertificate except temporary emergency
- test TLS in staging
```

---

## 38. Practical Debugging Framework

Saat JDBC connection problem terjadi, pecah menjadi lapisan.

```text
Layer 1 — Application configuration
  URL, username, password, driver dependency, pool config.

Layer 2 — Driver discovery
  Is correct driver loaded and selected?

Layer 3 — Network reachability
  DNS, TCP, firewall, security group, Kubernetes network policy.

Layer 4 — TLS
  protocol, certificate, truststore, hostname verification.

Layer 5 — Authentication
  credential, account status, auth method, token expiry.

Layer 6 — Database resource
  max sessions, listener, instance state, CPU/memory/storage.

Layer 7 — Session initialization
  schema, role, isolation, NLS/timezone, app name.

Layer 8 — Query execution
  SQL syntax, bind type, plan, lock, timeout, cursor.

Layer 9 — Pool behavior
  active/idle/pending, leak, validation, retirement, maxLifetime.
```

Pertanyaan diagnosis:

```text
1. Apakah error terjadi sebelum atau sesudah driver selection?
2. Apakah hanya new connection yang gagal, atau existing connection juga?
3. Apakah error terjadi saat connect, auth, execute, fetch, commit, atau close?
4. Apakah error transient atau deterministic?
5. Apakah terjadi setelah deploy/driver upgrade/DB failover/secret rotation?
6. Apakah semua pods terdampak atau hanya sebagian node?
7. Apakah database melihat session masuk?
8. Apakah SQLState/vendor code menunjukkan retryable condition?
9. Apakah pool pending threads naik?
10. Apakah DB active sessions naik atau justru connection creation gagal?
```

---

## 39. Design Rules for Driver-Aware JDBC Engineering

Gunakan aturan ini sebagai baseline engineering standard.

### Rule 1 — Treat JDBC URL as Code

JDBC URL bukan string config biasa. Ia mengandung behavior.

Review:

```text
- TLS mode
- timeout
- timezone
- application name
- batch/prepared statement properties
- failover settings
```

### Rule 2 — Pin Driver Version Intentionally

Jangan biarkan driver version berubah tanpa review.

```text
Driver version is part of runtime behavior.
```

### Rule 3 — Do Not Assume API Semantics Equal Database Semantics

Contoh:

```text
setReadOnly(true) may be hint.
setFetchSize(n) may be hint.
setQueryTimeout(n) may depend on driver cancellation support.
setNetworkTimeout may not behave identically across drivers.
```

### Rule 4 — Isolate Vendor-Specific Code

Jika memakai `unwrap()` atau vendor extension, lokalisasi di infrastructure adapter.

### Rule 5 — Test With the Real Driver and Real Database

Mock JDBC tidak cukup untuk:

```text
- transaction isolation
- locks
- SQLState
- generated keys
- batch behavior
- time zone
- LOB
- fetch streaming
- timeout
- failover
```

### Rule 6 — Observe Both Pool and Database

Aplikasi hanya melihat sebagian cerita. Database session view memberi sisi lain.

Correlate:

```text
- pool active connection
- DB active session
- query latency
- wait event
- lock holder/blocker
- SQLState/vendor error
```

### Rule 7 — Align Pool Lifecycle with Driver/Auth/Network Reality

Konfigurasi penting:

```text
- maxLifetime
- keepaliveTime
- validationTimeout
- connectionTimeout
- driver socket timeout
- database idle session timeout
- firewall/NAT idle timeout
- credential/token lifetime
```

---

## 40. Mini Case Study: Regulatory Case Management Service

Bayangkan service `case-management` memakai Java 21, Spring Boot, HikariCP, dan Oracle/PostgreSQL.

Use case:

```text
Officer submits enforcement decision.
System updates case state.
System inserts audit trail.
System writes correspondence record.
System commits transaction.
System publishes event after commit.
```

Naive mental model:

```text
Java sends SQL. Database saves it.
```

Driver-aware mental model:

```text
1. Request thread borrows logical connection from HikariCP.
2. Logical connection maps to physical database session.
3. Session has state: schema, isolation, autocommit, readOnly, timezone, application name.
4. Prepared statements are created through driver.
5. Bind values are encoded according to driver/database type mapping.
6. SQL reaches database via network protocol.
7. Database may lock case row.
8. Audit CLOB insert may use LOB-specific path.
9. Commit is sent through same session.
10. If connection breaks after commit request but before response, result can be ambiguous.
11. Connection close returns to pool, not necessarily physical socket close.
12. Pool may reset state before reuse.
```

Failure example:

```text
Network drops after COMMIT sent but before client receives success.
```

Question:

```text
Did the transaction commit?
```

Answer:

```text
Unknown from application perspective without reconciliation.
```

This is why robust systems need:

```text
- idempotency key
- unique business command id
- audit trail
- outbox pattern
- post-failure reconciliation
- retry only at safe boundary
```

JDBC driver architecture directly affects business correctness.

---

## 41. Mental Model Summary

Simpan model ini:

```text
JDBC API
  adalah kontrak Java.

JDBC Driver
  adalah implementasi vendor yang berbicara ke database.

Connection
  adalah handle ke database session, sering dibungkus pool proxy.

PreparedStatement
  adalah API parameterized execution, tetapi server/client behavior driver-specific.

ResultSet
  adalah cursor/fetch abstraction, bukan list.

SQLException
  adalah hasil translation dari database/driver/network failure.

DataSource/Pool
  mengatur lifecycle physical connections, tetapi tetap bergantung pada driver.
```

Dan model end-to-end:

```text
Application Thread
   ↓
DataSource / HikariCP
   ↓
JDBC Driver
   ↓
JVM/OS Socket/TLS
   ↓
Network / DNS / Firewall
   ↓
Database Listener
   ↓
Database Session
   ↓
SQL Engine / Transaction / Locks / Storage
```

Kalau terjadi incident, cari lapisannya. Jangan semua disebut “JDBC error”.

---

## 42. Checklist: Apa yang Harus Kamu Bisa Setelah Part Ini?

Setelah Part 002, kamu seharusnya bisa menjelaskan:

```text
[ ] JDBC driver adalah implementasi kontrak, bukan sekadar library pasif.
[ ] Perbedaan API portability dan behavior portability.
[ ] Type 1/2/3/4 driver dan kenapa Type 4 dominan modern.
[ ] Flow getConnection dari DriverManager.
[ ] Flow getConnection dari HikariCP.
[ ] Cara DriverManager memilih driver berdasarkan URL.
[ ] Kenapa No suitable driver berbeda dari connection refused.
[ ] Kenapa JDBC URL harus direview seperti kode.
[ ] Kenapa prepared statement bisa client-side atau server-side.
[ ] Perbedaan connection pool, statement cache, dan database plan cache.
[ ] Kenapa fetchSize tidak universal.
[ ] Kenapa driver upgrade berisiko production.
[ ] Kenapa DataSource lebih baik dari DriverManager untuk aplikasi modern.
[ ] Bagaimana classpath/classloader bisa menyebabkan driver tidak ditemukan.
[ ] Bagaimana DNS/failover/TLS/auth memengaruhi koneksi JDBC.
[ ] Bagaimana mengklasifikasikan JDBC incident berdasarkan layer.
```

Jika checklist ini sudah masuk akal, kamu siap masuk Part 003: `Connection` sebagai database session.

---

## 43. Anti-Pattern yang Harus Dihindari

```text
1. Menggunakan DriverManager static helper di seluruh aplikasi production.
2. Menganggap driver behavior semua database sama.
3. Menganggap PreparedStatement selalu server-side dan selalu lebih cepat.
4. Menganggap close connection selalu menutup socket fisik.
5. Menganggap fetchSize pasti streaming.
6. Menganggap query timeout pasti membunuh query database.
7. Menganggap driver upgrade aman tanpa integration test.
8. Menganggap pool config cukup tanpa driver socket timeout.
9. Menganggap TLS aktif berarti certificate validation benar.
10. Mengabaikan classloader saat deploy di app server/plugin runtime.
11. Menaruh vendor-specific unwrap di business logic.
12. Mengabaikan total connection count saat scale Kubernetes replicas.
```

---

## 44. Referensi Resmi dan Bacaan Lanjutan

Referensi utama untuk part ini:

1. Oracle Java SE API — `java.sql` package summary.
2. Oracle Java SE API — `java.sql.Driver`.
3. Oracle Java SE API — `java.sql.DriverManager`.
4. Oracle Database JDBC Developer's Guide — Introducing JDBC / Oracle JDBC drivers.
5. Dokumentasi resmi masing-masing driver:
   - Oracle JDBC
   - PostgreSQL JDBC
   - MySQL Connector/J
   - Microsoft SQL Server JDBC Driver
6. HikariCP official documentation untuk interaksi pool dan driver-level properties.

Catatan penting:

```text
java.sql documentation tells you the standard contract.
Driver documentation tells you the production behavior.
Database documentation tells you the actual semantics.
```

Ketiganya harus dibaca bersama.

---

# Status Seri

```text
Part 002 selesai.
Seri belum selesai.

Selesai:
- Part 000 — Orientation: Mental Model JDBC sebagai Boundary antara Java dan Database
- Part 001 — Anatomy of java.sql and javax.sql
- Part 002 — JDBC Driver Architecture: Dari Interface Java ke Protocol Database

Berikutnya:
- Part 003 — Connection Is a Database Session, Not Just a Pipe
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-sql-jdbc-hikaricp-part-001](./learn-java-sql-jdbc-hikaricp-part-001.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-sql-jdbc-hikaricp-part-003](./learn-java-sql-jdbc-hikaricp-part-003.md)
