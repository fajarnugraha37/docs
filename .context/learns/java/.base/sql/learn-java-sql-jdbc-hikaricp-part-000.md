# learn-java-sql-jdbc-hikaricp-part-000.md

# Part 000 — Orientation: Mental Model JDBC sebagai Boundary antara Java dan Database

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `000`  
> Status: Fondasi awal seri  
> Target pembaca: Java engineer yang sudah kuat di Java core, concurrency, reliability, security, DSA, I/O, Jakarta/JAX-RS, dan ingin naik ke level production-grade JDBC/HikariCP engineer.

---

## 0. Tujuan Part Ini

Part ini bukan dimaksudkan untuk langsung menghafal seluruh method `java.sql.Connection`, `PreparedStatement`, atau konfigurasi HikariCP.

Part ini adalah **fondasi mental model**.

JDBC terlihat sederhana:

```java
try (Connection connection = dataSource.getConnection();
     PreparedStatement ps = connection.prepareStatement("select * from users where id = ?")) {

    ps.setLong(1, userId);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            // map row
        }
    }
}
```

Tetapi di balik kode pendek itu ada banyak hal yang bergerak:

```text
Java thread
  -> DataSource / connection pool
  -> logical connection proxy
  -> physical JDBC connection
  -> JDBC driver
  -> database wire protocol
  -> TCP socket / TLS
  -> database listener
  -> database process/thread/session
  -> parser / optimizer / executor
  -> transaction engine
  -> lock manager / MVCC engine
  -> buffer cache / storage engine
  -> result cursor
  -> fetch packets
  -> ResultSet mapping back to Java
```

Engineer yang hanya melihat JDBC sebagai “cara Java menjalankan SQL” akan sering terjebak pada bug production seperti:

- connection pool exhausted;
- transaction menggantung;
- deadlock tidak diretry dengan benar;
- query timeout tetapi statement masih berjalan di database;
- `Connection.close()` disalahpahami sebagai menutup koneksi fisik;
- fetch result besar membuat heap meledak;
- autocommit bocor ke request berikutnya;
- pool terlalu besar sampai database lebih lambat;
- failover database membuat aplikasi penuh stale connection;
- log SQL membocorkan PII;
- retry membuat double insert;
- batch partial failure tidak ditangani;
- `PreparedStatement` dianggap otomatis menyelesaikan semua performance dan security issue.

Tujuan part ini adalah membentuk cara berpikir berikut:

> JDBC adalah boundary kritis antara **application runtime**, **database session**, **transaction semantics**, **network behavior**, dan **production reliability**.

Kalau mental model ini benar, detail API pada part berikutnya akan jauh lebih mudah dipahami.

---

## 1. Apa Itu JDBC Secara Konseptual?

JDBC adalah standar API Java untuk mengakses dan memproses data dari data source tabular, biasanya relational database. Dalam Java SE modern, modul `java.sql` mendefinisikan JDBC API dan mengekspor package `java.sql` serta `javax.sql`. Package `java.sql` berisi API utama seperti `Connection`, `Statement`, `PreparedStatement`, `ResultSet`, dan `SQLException`, sedangkan `javax.sql` melengkapi dengan API seperti `DataSource`, pooling, distributed transaction, dan row set.

Secara praktis, JDBC adalah **kontrak Java-side**.

Kontrak ini berkata:

```text
Kalau ada database driver yang mengimplementasikan interface JDBC,
Java application bisa menggunakan bentuk API yang relatif konsisten
untuk membuka connection, menjalankan statement, membaca result,
dan mengelola transaction.
```

Namun penting:

> JDBC bukan database engine. JDBC bukan query optimizer. JDBC bukan ORM. JDBC bukan magic abstraction yang menghapus perbedaan Oracle, PostgreSQL, MySQL, SQL Server, DB2, atau database lain.

JDBC memberi vocabulary umum:

```text
Connection
Statement
PreparedStatement
CallableStatement
ResultSet
SQLException
DataSource
Savepoint
Blob
Clob
DatabaseMetaData
```

Tetapi behavior aktual banyak dipengaruhi oleh:

```text
JDBC driver implementation
Database vendor
Database version
Server configuration
Network path
Connection pool
Transaction manager
SQL dialect
Isolation level
Session state
```

Jadi, JDBC itu portable secara API, tetapi tidak selalu portable secara behavior.

---

## 2. JDBC Bukan ORM

Sebelum masuk lebih jauh, kita harus menempatkan JDBC pada posisi yang benar.

JDBC bekerja pada level:

```text
SQL command
parameter binding
connection/session
transaction
cursor/result set
error code
metadata
```

ORM seperti Hibernate/JPA bekerja pada level:

```text
entity
persistence context
dirty checking
relationship mapping
lazy loading
first-level cache
second-level cache
JPQL/HQL
unit of work
```

Spring JDBC bekerja pada level:

```text
JdbcTemplate
RowMapper
exception translation
resource management helper
simplified callback
```

jOOQ bekerja pada level:

```text
type-safe SQL DSL
generated schema model
SQL rendering
record mapping
vendor-aware SQL generation
```

MyBatis bekerja pada level:

```text
SQL mapper
XML/annotation mapping
parameter mapping
result mapping
```

Tetapi semuanya pada akhirnya tetap berdiri di atas konsep yang mirip:

```text
DataSource -> Connection -> Statement -> ResultSet -> SQLException
```

Bahkan kalau kamu memakai Hibernate, pool yang dipakai sering tetap HikariCP. Query yang dihasilkan Hibernate tetap lewat JDBC driver. Transaction manager tetap mengikat connection. Database session tetap ada. Lock tetap terjadi. Timeout tetap harus dipahami.

Karena itu, memahami JDBC adalah memahami fondasi dari sebagian besar persistence stack Java.

---

## 3. Mental Model Besar: Dari Method Call ke Database Work

Mari lihat satu operasi sederhana:

```java
public Optional<User> findById(long id) throws SQLException {
    String sql = """
        select id, name, email, status
        from app_user
        where id = ?
        """;

    try (Connection connection = dataSource.getConnection();
         PreparedStatement ps = connection.prepareStatement(sql)) {

        ps.setLong(1, id);

        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return Optional.empty();
            }

            User user = new User(
                rs.getLong("id"),
                rs.getString("name"),
                rs.getString("email"),
                rs.getString("status")
            );

            return Optional.of(user);
        }
    }
}
```

Secara source code, ini tampak linear.

Secara runtime, urutannya lebih kompleks:

```text
1. Java thread masuk method findById.
2. dataSource.getConnection() dipanggil.
3. Kalau DataSource adalah HikariDataSource, thread mencoba borrow connection dari pool.
4. Pool memberikan logical/proxy Connection.
5. Proxy itu membungkus physical JDBC connection.
6. prepareStatement(sql) dipanggil.
7. Driver menerima SQL string.
8. Driver mungkin membuat client-side prepared statement atau server-side prepared statement.
9. ps.setLong(1, id) mengikat parameter.
10. executeQuery() mengirim command ke database.
11. Database menerima command lewat wire protocol.
12. Database melakukan parse/bind/execute/fetch sesuai vendor.
13. Optimizer memilih execution plan.
14. Executor membaca index/table/block/buffer cache.
15. Lock/MVCC/isolation semantics berlaku.
16. Database mengembalikan cursor/result data.
17. Driver menerima packet data.
18. ResultSet mengekspos row-by-row cursor API.
19. Java code membaca kolom.
20. Mapping ke object dilakukan manual.
21. ResultSet ditutup.
22. PreparedStatement ditutup.
23. Connection.close() dipanggil.
24. Karena connection berasal dari pool, close mengembalikan logical connection ke pool, bukan selalu menutup socket fisik.
```

Dari sini ada satu prinsip penting:

> Kode JDBC kecil bisa menyentuh banyak subsistem production sekaligus.

Itulah kenapa bug JDBC sering terasa “aneh”: stack trace ada di Java, tetapi akar masalahnya bisa di database lock, network timeout, pool configuration, transaction leak, driver behavior, atau query plan.

---

## 4. Lima Boundary Utama dalam JDBC

Agar tidak tersesat, kita akan memakai lima boundary sepanjang seri ini.

```text
Boundary 1: Java object boundary
Boundary 2: JDBC API boundary
Boundary 3: Driver/protocol boundary
Boundary 4: Database session/transaction boundary
Boundary 5: Production runtime boundary
```

### 4.1 Boundary 1 — Java Object Boundary

Di sisi Java, kamu punya:

```text
Thread
method call
object
exception
try-with-resources
heap memory
classloader
ExecutorService / virtual thread / request thread
```

Bug yang muncul di boundary ini biasanya:

```text
resource leak
wrong object lifetime
holding ResultSet outside scope
mapping null incorrectly
integer overflow
BigDecimal scale issue
timezone conversion bug
blocking JDBC call inside wrong execution model
```

Contoh:

```java
int amount = rs.getInt("amount");
```

Kelihatannya aman. Tetapi kalau kolom `amount` bernilai SQL `NULL`, `getInt()` mengembalikan `0`, lalu kamu harus memanggil:

```java
boolean wasNull = rs.wasNull();
```

Kalau tidak, kamu bisa salah membedakan:

```text
NULL amount
vs
0 amount
```

Ini bukan masalah database saja. Ini masalah mapping boundary antara SQL type dan Java type.

### 4.2 Boundary 2 — JDBC API Boundary

Di boundary ini kamu berhadapan dengan interface:

```text
Connection
PreparedStatement
ResultSet
SQLException
DataSource
```

API ini memberi kontrak, tetapi sering memberi ruang bagi perbedaan implementasi.

Contoh:

```java
ps.setFetchSize(1000);
```

Banyak engineer menganggap ini berarti:

```text
Database pasti mengirim 1000 row per fetch.
```

Padahal tidak selalu. Actual behavior bergantung pada driver dan database. Pada beberapa driver, fetch size efektif hanya dalam kondisi tertentu. Pada driver lain, result bisa tetap dibuffer besar di client. Pada kasus lain, butuh konfigurasi tambahan agar server-side cursor benar-benar dipakai.

Jadi, di JDBC boundary, jangan hanya bertanya:

```text
Method ini namanya apa?
```

Tanya juga:

```text
Apakah method ini mandatory?
Apakah driver saya mendukung?
Apa default behavior-nya?
Apa behavior saat autocommit true?
Apa behavior saat result besar?
Apa behavior saat query timeout?
```

### 4.3 Boundary 3 — Driver/Protocol Boundary

JDBC driver adalah penerjemah.

```text
Java method call
  -> driver implementation
  -> database wire protocol
```

Driver melakukan hal-hal seperti:

```text
parse JDBC URL
open socket
TLS negotiation
authentication
encode parameter
send SQL command
receive result packet
convert database type to Java type
translate server error to SQLException
manage statement cache or cursor behavior
```

Ini berarti driver adalah bagian dari runtime critical path.

Driver version matters.

Contoh issue driver-level:

```text
old driver tidak cocok dengan JDK baru
old driver tidak support authentication mode baru
driver default timezone berbeda
driver buffering behavior berubah
socket timeout property salah
prepared statement cache default berubah
LOB handling berbeda
```

Di production, upgrade database tanpa upgrade driver bisa menyebabkan behavior aneh. Upgrade driver tanpa load test juga bisa mengubah behavior runtime.

### 4.4 Boundary 4 — Database Session/Transaction Boundary

Ini bagian yang paling sering disalahpahami.

`Connection` bukan sekadar “pipa untuk kirim SQL”.

Secara konseptual, `Connection` mewakili interaksi dengan **database session**.

Session punya state:

```text
autocommit mode
current transaction
isolation level
read-only flag
schema/catalog
session variables
temporary tables
prepared statement handles
server cursor
locks held
NLS/timezone settings
application/client identifier
```

Karena itu, connection pooling menjadi sensitif.

Kalau request A mengubah session state lalu connection dikembalikan ke pool tanpa reset yang benar, request B bisa terkena efeknya.

Contoh:

```java
connection.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
```

Kalau setelah itu connection kembali ke pool dan isolation tidak dikembalikan, request berikutnya bisa tiba-tiba berjalan di isolation level berbeda.

Inilah yang disebut **connection state leakage**.

### 4.5 Boundary 5 — Production Runtime Boundary

Di production, JDBC tidak hidup sendirian.

Ia hidup di tengah:

```text
HTTP server thread pool
application worker pool
scheduler
message consumer
Kubernetes replica
connection pool
DB max sessions
load balancer
firewall
NAT gateway
DNS
TLS cert
secret rotation
database failover
monitoring system
```

Bug production sering muncul karena interaksi boundary ini.

Contoh:

```text
maximumPoolSize = 30
replica = 20 pods
service A saja bisa membuka 600 DB connections
```

Kalau database hanya aman menangani 300 active sessions, aplikasi yang tampaknya “benar” secara kode bisa menjatuhkan database karena pool multiplication.

---

## 5. Apa yang Sebenarnya Terjadi Saat `getConnection()`?

Banyak engineer membayangkan:

```java
Connection c = dataSource.getConnection();
```

berarti:

```text
Buka koneksi baru ke database.
```

Itu hanya benar kalau DataSource tidak memakai pool, atau pool sedang membuat physical connection baru.

Pada aplikasi modern dengan HikariCP, biasanya terjadi:

```text
1. Thread meminta connection ke HikariDataSource.
2. Pool mencari idle connection yang tersedia.
3. Kalau ada, pool memberi proxy/logical connection.
4. Kalau tidak ada dan total connection < maximumPoolSize, pool mungkin membuat physical connection baru.
5. Kalau pool sudah penuh, thread menunggu sampai connection dikembalikan.
6. Kalau menunggu melebihi connectionTimeout, getConnection() gagal.
```

Jadi `getConnection()` bisa berarti:

```text
borrow existing connection
atau
create physical connection
atau
wait in pool queue
atau
fail because timeout
```

Ini sangat penting.

Ketika aplikasi lambat di `getConnection()`, masalahnya mungkin bukan membuka TCP connection lambat. Bisa jadi semua connection sedang dipakai oleh request lain.

Maka metrik pentingnya bukan hanya:

```text
query latency
```

Tetapi juga:

```text
connection acquisition time
active connections
idle connections
pending threads
connection usage time
```

---

## 6. Apa yang Sebenarnya Terjadi Saat `prepareStatement()`?

Kode:

```java
PreparedStatement ps = connection.prepareStatement(
    "select * from app_user where email = ?"
);
```

Secara konsep, `PreparedStatement` memisahkan SQL structure dari parameter value.

Mental model sederhana:

```text
SQL template:
select * from app_user where email = ?

Bind value:
? = "alice@example.com"
```

Ini penting untuk:

```text
SQL injection prevention
proper type binding
possible statement reuse
possible execution plan reuse
```

Namun ada jebakan.

Prepared statement bisa diproses dengan beberapa cara bergantung driver/database:

```text
client-side emulation
server-side prepared statement
server-side cursor
statement cache
plan cache
```

Jadi jangan menyimpulkan:

```text
PreparedStatement selalu lebih cepat.
```

Yang lebih benar:

> `PreparedStatement` adalah default aman untuk parameterized SQL. Performance benefit bergantung pada driver, database, cache, query shape, dan eksekusi berulang.

Security benefit-nya juga ada batas.

Parameter binding hanya bisa untuk value:

```sql
where email = ?
```

Bukan untuk identifier:

```sql
select * from ?       -- salah mental model
order by ?           -- sering tidak sesuai ekspektasi
```

Nama table, nama column, arah sort, fragment SQL dinamis harus divalidasi dengan whitelist, bukan binding biasa.

---

## 7. Apa yang Sebenarnya Terjadi Saat `executeQuery()`?

Kode:

```java
ResultSet rs = ps.executeQuery();
```

Di sini banyak pekerjaan terjadi:

```text
1. Driver memastikan parameter sudah siap.
2. Driver encode command dan bind value.
3. Command dikirim lewat socket.
4. Database menerima command.
5. Database parse SQL jika perlu.
6. Database validasi object dan permission.
7. Database pilih execution plan.
8. Database execute plan.
9. Database membaca index/table/block.
10. Database menerapkan isolation/MVCC/lock semantics.
11. Database membuat result cursor/stream.
12. Driver menerima metadata dan data awal.
13. Java mendapat ResultSet.
```

Beberapa database/driver mungkin mengambil seluruh result lebih awal. Yang lain mengambil bertahap.

Karena itu, `executeQuery()` selesai bukan selalu berarti semua row sudah ada di Java heap. Kadang row baru diambil saat `rs.next()`.

Ini menjelaskan kenapa error bisa muncul di beberapa titik berbeda:

```text
prepareStatement() gagal karena SQL syntax atau metadata tertentu
executeQuery() gagal karena permission, timeout, network, deadlock, invalid object
rs.next() gagal karena fetch berikutnya error, network putus, cursor invalid
rs.getXxx() gagal karena conversion issue
close() gagal karena cleanup protocol issue
```

Engineer yang matang tidak hanya menaruh try-catch di sekitar execute. Ia mendesain lifecycle dan error handling untuk seluruh operasi.

---

## 8. Apa yang Sebenarnya Terjadi Saat `commit()`?

Dengan autocommit false:

```java
connection.setAutoCommit(false);

try {
    // multiple SQL operations
    connection.commit();
} catch (SQLException e) {
    connection.rollback();
    throw e;
}
```

`commit()` bukan formalitas.

Commit berarti:

```text
Minta database membuat semua perubahan dalam transaction ini menjadi durable dan visible sesuai isolation/consistency rules.
```

Tergantung database, commit bisa melibatkan:

```text
write-ahead log / redo log flush
transaction table update
lock release
MVCC visibility update
replication interaction
constraint finalization
deferred trigger/check behavior
```

Commit juga bisa gagal.

Contoh:

```text
network putus saat commit response dikirim
primary database failover saat commit
transaction serialization failure
constraint deferred sampai commit
```

Kasus paling sulit adalah:

```text
Aplikasi tidak tahu apakah commit berhasil atau gagal.
```

Misalnya:

```text
Java mengirim COMMIT.
Database berhasil commit.
Sebelum response sampai ke Java, network putus.
Java menerima SQLException.
```

Kalau aplikasi langsung retry insert tanpa idempotency, bisa terjadi duplikasi.

Maka topik transaction tidak bisa dipisahkan dari idempotency, retry, dan business key.

---

## 9. Apa yang Sebenarnya Terjadi Saat `close()`?

Kode:

```java
connection.close();
```

Kalau connection didapat dari HikariCP, biasanya `close()` pada object yang kamu pegang berarti:

```text
Return logical connection to pool.
```

Bukan:

```text
Always close physical socket to database.
```

Ini sangat penting.

Kalau kamu tidak memanggil `close()`, kamu bukan sekadar “lupa cleanup object Java”. Kamu menahan connection dari pool. Akibatnya:

```text
active connection tidak turun
idle connection habis
pending threads naik
request mulai timeout di getConnection()
DB session tetap terbuka
transaction mungkin tetap menggantung
lock mungkin tetap tertahan
```

Dengan pooling, `close()` adalah operasi ownership release.

Aturan penting:

> Siapa yang borrow resource, dia yang bertanggung jawab mengembalikan resource pada scope yang sama.

Karena itu, pola benar:

```java
try (Connection connection = dataSource.getConnection()) {
    // use connection
}
```

Bukan:

```java
Connection connection = dataSource.getConnection();
return connection; // bocor ownership ke layer lain tanpa kontrak jelas
```

---

## 10. Connection: Handle, Session, Transaction Carrier

`Connection` punya tiga wajah:

```text
1. Java handle
2. database session representation
3. transaction carrier
```

### 10.1 Connection sebagai Java Handle

Di Java, `Connection` adalah object/interface yang kamu pakai untuk memanggil method.

```java
connection.prepareStatement(sql);
connection.setAutoCommit(false);
connection.commit();
connection.rollback();
connection.close();
```

Kalau memakai pool, object ini sering proxy.

### 10.2 Connection sebagai Database Session

Di database, connection diasosiasikan dengan session atau backend process/thread.

Session bisa punya state:

```text
current user
current schema
transaction status
NLS/timezone
application name
client identifier
temporary objects
server-side prepared statement
cursor
locks
```

### 10.3 Connection sebagai Transaction Carrier

Transaction di JDBC melekat pada connection.

Artinya:

```text
Kalau dua SQL harus berada dalam satu transaction,
mereka harus memakai connection yang sama,
dalam transaction boundary yang sama.
```

Contoh:

```java
connection.setAutoCommit(false);

insertCase(connection, command);
insertAuditTrail(connection, command);
updateCaseState(connection, command);

connection.commit();
```

Kalau masing-masing method diam-diam memanggil `dataSource.getConnection()` sendiri, belum tentu mereka berada dalam transaction yang sama.

Inilah alasan framework transaction manager biasanya mengikat connection ke thread/context selama transaction berlangsung.

---

## 11. Statement: Command Carrier

Statement adalah pembawa command SQL.

Ada tiga bentuk utama:

```text
Statement
PreparedStatement
CallableStatement
```

### 11.1 Statement

Dipakai untuk SQL tanpa parameter binding:

```java
try (Statement st = connection.createStatement();
     ResultSet rs = st.executeQuery("select current_date")) {
    ...
}
```

Risiko bila dipakai untuk input user:

```java
String sql = "select * from app_user where email = '" + email + "'";
```

Ini membuka SQL injection.

### 11.2 PreparedStatement

Default untuk query dengan parameter:

```java
PreparedStatement ps = connection.prepareStatement(
    "select * from app_user where email = ?"
);
ps.setString(1, email);
```

### 11.3 CallableStatement

Dipakai untuk stored procedure/function:

```java
CallableStatement cs = connection.prepareCall("{ call close_case(?) }");
cs.setLong(1, caseId);
cs.execute();
```

Statement bukan hanya string SQL. Ia punya lifecycle, timeout, fetch size, generated keys, result set mode, dan resource cleanup.

---

## 12. ResultSet: Cursor, Bukan Collection

`ResultSet` sering disalahpahami sebagai list rows.

Lebih akurat:

> `ResultSet` adalah cursor-like view terhadap hasil query.

Kode:

```java
while (rs.next()) {
    long id = rs.getLong("id");
    String name = rs.getString("name");
}
```

`rs.next()` bisa berarti:

```text
move pointer to already-buffered row
atau
fetch next packet from database
atau
trigger conversion/IO/driver work
```

Karena ResultSet bisa bergantung pada Statement dan Connection, jangan mengembalikannya keluar dari scope:

```java
// buruk
public ResultSet findUsers() {
    Connection c = dataSource.getConnection();
    PreparedStatement ps = c.prepareStatement("select * from users");
    return ps.executeQuery();
}
```

Masalah:

```text
Siapa yang close ResultSet?
Siapa yang close Statement?
Siapa yang close Connection?
Apa yang terjadi kalau caller lupa?
Berapa lama DB cursor terbuka?
Berapa lama connection tertahan?
```

Pola lebih sehat:

```java
public List<User> findUsers() throws SQLException {
    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement("select id, name from users");
         ResultSet rs = ps.executeQuery()) {

        List<User> users = new ArrayList<>();
        while (rs.next()) {
            users.add(mapUser(rs));
        }
        return users;
    }
}
```

Untuk result sangat besar, jangan langsung list semua. Gunakan paging, streaming terkontrol, server-side cursor yang benar, atau desain proses batch.

---

## 13. SQLException: Bukan Sekadar Error Database

`SQLException` membawa beberapa informasi:

```text
message
SQLState
vendor error code
chained exception
cause
```

Kesalahan umum:

```java
catch (SQLException e) {
    throw new RuntimeException(e);
}
```

Ini kadang perlu, tetapi kalau dilakukan tanpa klasifikasi, aplikasi kehilangan kemampuan membedakan:

```text
syntax error
constraint violation
duplicate key
deadlock
lock timeout
query timeout
connection failure
login failure
serialization failure
permission denied
object not found
```

Padahal recovery-nya berbeda.

Contoh:

```text
duplicate key
  -> biasanya bukan retry buta

serialization failure
  -> bisa retry transaction jika idempotent

deadlock
  -> bisa retry transaction dengan backoff

login failure
  -> jangan retry cepat terus-menerus

connection timeout dari pool
  -> mungkin backpressure/pool exhaustion

socket read timeout
  -> status query/transaction perlu dipikirkan
```

Top 1% engineer tidak hanya bertanya:

```text
Exception-nya apa?
```

Tetapi:

```text
Apakah transaction outcome diketahui?
Apakah safe untuk retry?
Apakah error transient?
Apakah connection masih valid?
Apakah perlu rollback?
Apakah error ini menunjukkan bug data, bug SQL, atau kondisi runtime?
```

---

## 14. Autocommit: Default Sederhana yang Sering Menipu

Secara default, banyak JDBC connection berada pada `autoCommit=true`.

Artinya, setiap statement individual dianggap sebagai transaction sendiri.

Contoh:

```java
connection.setAutoCommit(true);

insertOrder(connection, order);
insertOrderItem(connection, item1);
insertOrderItem(connection, item2);
```

Dengan autocommit true, masing-masing statement bisa commit sendiri.

Kalau insert item kedua gagal:

```text
order sudah commit
item1 sudah commit
item2 gagal
```

Mungkin ini tidak konsisten secara business.

Untuk unit perubahan yang harus atomic:

```java
connection.setAutoCommit(false);
try {
    insertOrder(connection, order);
    insertOrderItem(connection, item1);
    insertOrderItem(connection, item2);
    connection.commit();
} catch (SQLException e) {
    connection.rollback();
    throw e;
}
```

Tetapi autocommit false juga berbahaya kalau lifecycle salah:

```text
transaction lupa commit/rollback
connection dikembalikan ke pool dalam state kotor
lock tertahan
idle in transaction
pool starvation
```

Maka transaction manual harus selalu punya struktur jelas.

---

## 15. Pooling: Optimization dan Governor

Connection creation mahal karena bisa melibatkan:

```text
TCP connection
TLS handshake
authentication
session allocation
server process/thread allocation
initial session setup
```

Connection pool menjaga sejumlah physical connection agar bisa dipakai ulang.

Namun connection pool bukan magic untuk menambah kapasitas database.

Pool punya dua fungsi besar:

```text
1. Mengurangi latency connection acquisition dengan reuse.
2. Membatasi concurrency database agar aplikasi tidak membanjiri DB.
```

Yang kedua sering dilupakan.

Kalau pool terlalu kecil:

```text
thread menunggu connection
request timeout di aplikasi
throughput terbatas
```

Kalau pool terlalu besar:

```text
database kebanjiran session
context switching naik
lock contention naik
memory database naik
query makin lambat
failure cascade lebih besar
```

Jadi `maximumPoolSize` bukan angka “semakin besar semakin bagus”.

Ia adalah concurrency limit terhadap database.

---

## 16. HikariCP dalam Mental Model Ini

HikariCP adalah JDBC connection pool yang production-ready, ringan, dan populer di ekosistem Java modern.

Dalam mental model kita, HikariCP berada di antara application code dan JDBC driver:

```text
Application code
  -> HikariDataSource
  -> Hikari pool
  -> proxy Connection
  -> physical JDBC Connection
  -> JDBC driver
  -> database
```

HikariCP tidak mengoptimalkan query SQL. Ia tidak memperbaiki index. Ia tidak menghapus lock. Ia tidak membuat database bisa menerima infinite connection.

Yang HikariCP lakukan:

```text
manage connection lifecycle
borrow/return connection
validate connection
retire old connection
keep idle connection when configured
apply timeout on acquisition
expose pool metrics
help detect leak
reset connection state
```

Kalau query lambat karena full table scan, HikariCP tidak menyelesaikan akar masalah.

Kalau transaction terlalu panjang, HikariCP hanya akan menunjukkan symptom seperti active connection tinggi dan pending thread naik.

Jadi HikariCP harus dipahami sebagai:

> pool lifecycle manager dan backpressure boundary, bukan performance silver bullet.

---

## 17. Perbedaan Physical Connection dan Logical Connection

Ini konsep wajib.

Tanpa pool:

```text
Connection.close()
  -> tutup physical connection ke database
```

Dengan pool:

```text
Connection yang diterima aplikasi = logical/proxy connection
Physical connection tetap dimiliki pool
Connection.close()
  -> return logical connection ke pool
  -> physical connection biasanya tetap hidup
```

Diagram:

```text
Application Thread
    |
    | borrow
    v
Proxy Connection --------------+
    |                           |
    | delegates                 |
    v                           |
Physical JDBC Connection <------+ owned by pool
    |
    v
Database Session
```

Saat aplikasi memanggil:

```java
connection.close();
```

Pool melakukan kira-kira:

```text
mark logical connection closed
cleanup statements if needed
rollback/reset if needed
reset autocommit/readOnly/isolation/schema if changed
return physical connection to idle bag
```

Actual detail bergantung pool dan driver, tetapi mental model ini cukup untuk memahami lifecycle.

---

## 18. Session State Leakage

Karena physical connection dipakai ulang, state leakage adalah risiko utama.

Contoh buruk:

```java
try (Connection c = dataSource.getConnection()) {
    c.setReadOnly(true);
    c.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
    // query
}
```

Kalau pool/driver tidak reset atau ada state yang tidak diketahui pool, request berikutnya bisa menerima connection dengan state berbeda.

State yang perlu diwaspadai:

```text
autocommit
readOnly
transaction isolation
schema/catalog
network timeout
session variables
temporary tables
application context/client identifier
role setting
NLS/timezone setting
```

Beberapa state bisa diketahui dan direset pool. Beberapa state yang diubah lewat SQL vendor-specific mungkin tidak diketahui pool.

Contoh:

```sql
alter session set current_schema = SOME_SCHEMA
```

atau:

```sql
set search_path to tenant_a
```

Kalau ini dilakukan sembarangan pada pooled connection, tenant/request berikutnya bisa terkena state yang salah.

Prinsip:

> Jangan mengubah session state pada pooled connection tanpa strategi reset yang eksplisit dan teruji.

---

## 19. Transaction Boundary Harus Lebih Tinggi dari DAO Tunggal

Kesalahan desain umum:

```java
class UserDao {
    void createUser(User user) {
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            insertUser(c, user);
            c.commit();
        }
    }
}
```

Sekilas rapi. Tetapi kalau business operation membutuhkan beberapa DAO?

```text
create user
assign role
create audit trail
send outbox event
```

Kalau masing-masing DAO membuka dan commit connection sendiri, atomicity pecah.

Lebih baik transaction boundary berada di service/use-case layer:

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);
    try {
        userRepository.insert(c, user);
        roleRepository.assign(c, user.id(), role);
        auditRepository.insert(c, audit);
        outboxRepository.insert(c, event);
        c.commit();
    } catch (Exception e) {
        c.rollback();
        throw e;
    }
}
```

Pada framework seperti Spring, ini biasanya diwakili oleh `@Transactional`, tetapi konsep dasarnya tetap:

```text
satu transaction = satu connection/session yang sama selama boundary transaction
```

---

## 20. Contoh Mental Model: Regulatory Case State Transition

Karena banyak sistem enterprise/regulatory berpusat pada lifecycle, mari pakai contoh.

Misal ada command:

```text
Approve Case
```

Operasi business:

```text
1. Load case by id.
2. Validate current state = PENDING_REVIEW.
3. Validate actor has authority.
4. Update case state to APPROVED.
5. Insert audit trail.
6. Insert outbox event CASE_APPROVED.
7. Commit.
```

JDBC-level requirement:

```text
Semua perubahan harus atomic.
Concurrent approval harus dicegah.
Audit harus konsisten dengan state change.
Event tidak boleh publish sebelum commit.
Retry tidak boleh double approve.
```

Naive implementation:

```java
Case c = caseDao.findById(caseId);       // connection A
caseDao.updateStatus(caseId, APPROVED);  // connection B, autocommit
 auditDao.insert(...);                   // connection C, autocommit
publisher.publish(...);                  // external side effect
```

Masalah:

```text
Tidak atomic.
Concurrent request bisa sama-sama approve.
Audit bisa gagal setelah state berubah.
Event bisa terkirim walau transaction gagal.
```

Lebih benar:

```text
Borrow one connection.
Start transaction.
Lock or conditionally update row.
Insert audit.
Insert outbox event.
Commit.
Publisher membaca outbox after commit.
Return connection.
```

Pseudo-code:

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);

    try {
        CaseRecord caseRecord = caseRepository.findForUpdate(c, caseId);

        if (!caseRecord.status().equals("PENDING_REVIEW")) {
            throw new InvalidStateTransitionException();
        }

        int updated = caseRepository.transition(
            c,
            caseId,
            "PENDING_REVIEW",
            "APPROVED"
        );

        if (updated != 1) {
            throw new ConcurrentTransitionException();
        }

        auditRepository.insert(c, Audit.approved(caseId, actorId));
        outboxRepository.insert(c, Outbox.caseApproved(caseId));

        c.commit();
    } catch (Exception e) {
        safeRollback(c, e);
        throw e;
    }
}
```

Di sini JDBC bukan sekadar query. JDBC menjadi alat menjaga invariants.

Invariant yang dijaga:

```text
A case cannot move from PENDING_REVIEW to APPROVED without audit.
A CASE_APPROVED event cannot exist unless state transition is committed.
Concurrent approval cannot produce duplicate state transition.
```

---

## 21. Cost Model: JDBC Operation Tidak Gratis

Setiap JDBC operation punya cost.

### 21.1 Connection Acquisition Cost

Bisa berupa:

```text
pool wait
physical connection creation
authentication
validation query
```

### 21.2 Statement Preparation Cost

Bisa berupa:

```text
client object creation
server parse
plan cache lookup
statement handle allocation
```

### 21.3 Execution Cost

Bisa berupa:

```text
network round-trip
database CPU
lock wait
IO wait
query execution
trigger/procedure execution
```

### 21.4 Fetch Cost

Bisa berupa:

```text
network packet transfer
row decoding
type conversion
heap allocation
mapper cost
```

### 21.5 Commit Cost

Bisa berupa:

```text
redo/WAL flush
replication acknowledgment
lock release
transaction cleanup
```

Ketika performance buruk, jangan langsung menyalahkan satu layer.

Gunakan pertanyaan diagnosis:

```text
Apakah lambat sebelum dapat connection?
Apakah lambat saat execute?
Apakah lambat saat fetch?
Apakah lambat saat mapping?
Apakah lambat saat commit?
Apakah lambat karena lock wait?
Apakah lambat karena DB CPU?
Apakah lambat karena network?
Apakah lambat karena pool queue?
```

---

## 22. Failure Model: Bagaimana JDBC Bisa Gagal?

JDBC call bisa gagal di banyak titik.

### 22.1 Sebelum Connection Didapat

```text
pool exhausted
connectionTimeout
DB unavailable
DNS failure
login failure
credential expired
TLS failure
max DB sessions reached
```

### 22.2 Saat Statement Disiapkan

```text
SQL syntax error
invalid object
permission error
driver unsupported feature
connection already closed
```

### 22.3 Saat Execute

```text
constraint violation
deadlock
lock timeout
query timeout
network error
server killed session
database restart
serialization failure
```

### 22.4 Saat Fetch

```text
network interrupted mid-result
cursor invalid
LOB stream error
conversion error
client memory pressure
```

### 22.5 Saat Commit/Rollback

```text
commit outcome unknown
rollback failed because connection broken
network error after commit sent
server failover
```

### 22.6 Saat Close

```text
cleanup failed
connection already broken
statement close error
suppressed exception
```

Karena banyak kemungkinan, production-grade JDBC code harus punya pola:

```text
clear resource ownership
clear transaction boundary
safe rollback
error classification
retry only when safe
observability around acquisition/execution/commit
```

---

## 23. Retry: Tidak Semua SQLException Boleh Diretry

Retry adalah salah satu sumber bug paling berbahaya.

Pertanyaan sebelum retry:

```text
Apakah operation idempotent?
Apakah transaction outcome diketahui?
Apakah error transient?
Apakah retry akan memperparah load?
Apakah ada unique business key?
Apakah ada outbox/idempotency key?
```

Contoh safe-ish retry:

```text
serialization failure pada transaction read-modify-write yang idempotent

deadlock pada transaction pendek dengan backoff

connection acquisition gagal karena transient failover, dengan circuit breaker dan bounded retry
```

Contoh dangerous retry:

```text
insert payment tanpa idempotency key

commit timeout dengan unknown outcome

batch insert partial failure tanpa mengetahui row mana sukses

retry cepat saat database sedang overload
```

Rule of thumb:

> Retry transaction, bukan random individual SQL, dan hanya jika business operation aman untuk diulang.

---

## 24. JDBC dan Blocking Model

JDBC adalah API blocking.

Ketika thread memanggil:

```java
ps.executeQuery();
```

thread tersebut menunggu sampai operation selesai, timeout, atau gagal.

Dengan platform threads, terlalu banyak blocking thread bisa mahal.

Dengan virtual threads, blocking menjadi lebih murah dari sisi Java thread, tetapi bukan berarti database capacity menjadi infinite.

Virtual threads dapat membuat aplikasi mampu membuat jauh lebih banyak concurrent blocking operations. Kalau tidak dibatasi oleh pool, ini bisa membanjiri database.

Karena itu, bahkan pada era virtual threads:

```text
connection pool tetap penting sebagai database concurrency governor
```

Virtual thread menyelesaikan masalah scalability thread Java, bukan masalah:

```text
DB CPU
DB locks
DB sessions
query plans
network bandwidth
transaction contention
```

---

## 25. JDBC vs R2DBC

JDBC blocking. R2DBC reactive/non-blocking.

Namun pilihan tidak sesederhana:

```text
Reactive selalu lebih baik.
```

JDBC masih sangat kuat untuk:

```text
classic OLTP service
transactional enterprise systems
mature driver ecosystem
JPA/Hibernate/jOOQ/Spring JDBC
stable blocking architecture
virtual-thread friendly workloads
```

R2DBC relevan jika:

```text
stack end-to-end reactive
perlu non-blocking DB access
mampu menerima trade-off maturity/ecosystem
transaction semantics dipahami dengan baik dalam reactive context
```

Dalam seri ini kita fokus JDBC dan HikariCP. R2DBC hanya dibahas sebagai pembanding pada part modern integration nanti.

---

## 26. Portable API, Vendor-Specific Reality

JDBC memberi API umum, tetapi database berbeda dalam banyak hal:

```text
SQL dialect
identifier quoting
pagination syntax
boolean type
UUID type
JSON type
array support
stored procedure syntax
generated keys behavior
timezone handling
transaction isolation semantics
locking behavior
DDL transaction behavior
savepoint support
LOB behavior
fetch size behavior
batch rewrite behavior
error code
SQLState consistency
```

Contoh:

```sql
select * from users limit 10 offset 20
```

valid di PostgreSQL/MySQL, tetapi tidak universal di semua database lama.

Contoh lain:

```text
READ_COMMITTED pada Oracle tidak identik secara internal dengan READ_COMMITTED pada PostgreSQL atau SQL Server.
```

Maka top 1% JDBC engineer menulis abstraction dengan sadar:

```text
mana yang portable JDBC
mana yang vendor-specific
mana yang harus dites integration dengan database asli
mana yang harus dikunci dalam coding standard
```

---

## 27. Observability: Tanpa Data, JDBC Diagnosis Buta

Kalau aplikasi mengalami:

```text
HTTP 504
latency spike
DB CPU naik
pool exhausted
```

log stack trace saja tidak cukup.

Minimal observability JDBC/pool:

```text
pool active connections
pool idle connections
pool pending threads
pool total connections
connection acquisition time
connection usage time
connection creation time
query execution time
transaction duration
rows fetched
SQL operation name/template
SQLState/vendor code count
rollback count
commit latency
slow query correlation id
```

Yang sering hilang:

```text
Waktu tunggu di pool vs waktu query di database.
```

Tanpa membedakan ini, engineer bisa salah diagnosis.

Contoh:

```text
Request lambat 5 detik.
Query actual hanya 50 ms.
Ternyata 4.95 detik menunggu connection dari pool.
```

Solusinya bukan index query, tetapi mencari kenapa connection tertahan:

```text
transaction terlalu panjang
connection leak
pool terlalu kecil
DB lambat sehingga usage time naik
background job memonopoli pool
```

---

## 28. Anti-Pattern yang Akan Kita Bongkar Sepanjang Seri

### 28.1 Static Connection Helper

```java
public static Connection getConnection() { ... }
```

Masalah:

```text
sulit test
sulit configure
sulit observe
sulit manage lifecycle
raw DriverManager usage tersebar
```

### 28.2 DAO Membuka Transaction Sendiri-Sendiri

Masalah:

```text
business operation tidak atomic
cross-repository consistency lemah
retry boundary salah
```

### 28.3 Menelan SQLException

```java
catch (SQLException e) {
    log.error("DB error", e);
}
```

Masalah:

```text
caller menganggap operation sukses
transaction state tidak jelas
rollback mungkin tidak terjadi
```

### 28.4 Query Tanpa Timeout

Masalah:

```text
thread bisa menunggu terlalu lama
connection tertahan
cascade ke pool exhaustion
```

### 28.5 Pool Besar Tanpa Database Budget

Masalah:

```text
semua pod dikalikan maximumPoolSize
DB session meledak
latency lebih buruk
```

### 28.6 ResultSet Keluar Scope

Masalah:

```text
resource ownership kabur
cursor dan connection leak
```

### 28.7 Logging Full Bind Values

Masalah:

```text
PII leakage
credential leakage
compliance issue
```

### 28.8 Dynamic SQL Tanpa Whitelist

Masalah:

```text
SQL injection pada identifier/order/filter fragment
PreparedStatement tidak membantu untuk semua bentuk dynamic SQL
```

---

## 29. Production Checklist Awal

Sebelum masuk detail API, ini checklist awal untuk menilai maturitas JDBC layer.

### 29.1 Connection Acquisition

```text
[ ] Semua connection didapat dari DataSource, bukan DriverManager random.
[ ] Semua borrow memakai try-with-resources atau ownership jelas.
[ ] Pool metrics aktif.
[ ] connectionTimeout diset masuk akal.
[ ] maximumPoolSize dihitung berdasarkan DB budget dan jumlah replica.
```

### 29.2 Transaction

```text
[ ] Transaction boundary berada di use-case/service layer.
[ ] Semua autocommit false punya commit/rollback path.
[ ] Rollback dilakukan pada exception.
[ ] Long transaction dimonitor.
[ ] Retry hanya dilakukan untuk operation idempotent/safe.
```

### 29.3 Statement

```text
[ ] Input value memakai PreparedStatement.
[ ] Dynamic identifier memakai whitelist.
[ ] Query timeout/statement timeout dipikirkan.
[ ] Batch partial failure ditangani.
```

### 29.4 ResultSet

```text
[ ] ResultSet tidak keluar dari resource scope.
[ ] Result besar tidak dikumpulkan sembarangan ke List.
[ ] Null mapping eksplisit.
[ ] Timezone/date-time mapping diuji.
```

### 29.5 Error Handling

```text
[ ] SQLException diklasifikasi.
[ ] SQLState/vendor code dilog secara aman.
[ ] Constraint violation dibedakan dari transient failure.
[ ] Deadlock/serialization failure punya policy.
```

### 29.6 Observability

```text
[ ] Acquisition time dipisahkan dari execution time.
[ ] Pool active/idle/pending dimonitor.
[ ] Query latency punya template/tag.
[ ] Transaction duration dimonitor.
[ ] Connection leak detection tersedia di non-prod/load test.
```

---

## 30. Mini Lab Mental: Baca Kode Ini

Perhatikan kode berikut:

```java
public void approveCase(long caseId, long actorId) throws SQLException {
    Connection c = dataSource.getConnection();

    PreparedStatement ps1 = c.prepareStatement(
        "update case_file set status = 'APPROVED' where id = ?"
    );
    ps1.setLong(1, caseId);
    ps1.executeUpdate();

    PreparedStatement ps2 = c.prepareStatement(
        "insert into audit_trail(case_id, actor_id, activity) values (?, ?, 'APPROVE')"
    );
    ps2.setLong(1, caseId);
    ps2.setLong(2, actorId);
    ps2.executeUpdate();

    c.close();
}
```

Apa masalahnya?

Minimal:

```text
1. Tidak memakai try-with-resources.
2. PreparedStatement tidak ditutup.
3. Kalau ps1 sukses lalu ps2 gagal, consistency bergantung autocommit default.
4. Tidak ada rollback.
5. Tidak ada validasi state transition.
6. Tidak ada concurrency guard.
7. Tidak ada affected row check.
8. Tidak ada timeout.
9. Jika exception terjadi sebelum c.close(), connection leak.
10. Error tidak diklasifikasi.
```

Versi lebih baik, masih plain JDBC:

```java
public void approveCase(long caseId, long actorId) throws SQLException {
    String transitionSql = """
        update case_file
        set status = 'APPROVED', updated_by = ?, updated_at = current_timestamp
        where id = ?
          and status = 'PENDING_REVIEW'
        """;

    String auditSql = """
        insert into audit_trail(case_id, actor_id, activity, created_at)
        values (?, ?, 'APPROVE', current_timestamp)
        """;

    try (Connection c = dataSource.getConnection()) {
        c.setAutoCommit(false);

        try (PreparedStatement transition = c.prepareStatement(transitionSql);
             PreparedStatement audit = c.prepareStatement(auditSql)) {

            transition.setLong(1, actorId);
            transition.setLong(2, caseId);

            int updated = transition.executeUpdate();
            if (updated != 1) {
                throw new IllegalStateException(
                    "Case is not in PENDING_REVIEW or does not exist: " + caseId
                );
            }

            audit.setLong(1, caseId);
            audit.setLong(2, actorId);
            audit.executeUpdate();

            c.commit();
        } catch (Exception e) {
            try {
                c.rollback();
            } catch (SQLException rollbackFailure) {
                e.addSuppressed(rollbackFailure);
            }
            throw e;
        }
    }
}
```

Ini masih belum sempurna. Pada part berikutnya kita akan bahas lebih detail:

```text
SQLException handling
transaction helper abstraction
query timeout
idempotency
outbox
lock behavior
pool metrics
```

Tetapi versi ini sudah memperlihatkan mental model yang lebih matang.

---

## 31. Pertanyaan Diagnosis yang Harus Menjadi Refleks

Saat melihat kode JDBC, tanyakan:

```text
1. Siapa pemilik Connection?
2. Kapan Connection dikembalikan?
3. Apakah Connection ini pooled atau physical?
4. Apakah operation ini autocommit atau explicit transaction?
5. Apakah semua statement dalam unit business memakai connection yang sama?
6. Apakah rollback pasti terjadi saat gagal?
7. Apakah transaction outcome diketahui saat error?
8. Apakah retry aman?
9. Apakah ResultSet bisa besar?
10. Apakah fetch behavior dipahami?
11. Apakah null/type/timezone mapping aman?
12. Apakah SQL dynamic aman?
13. Apakah query punya timeout?
14. Apakah connection acquisition dimonitor?
15. Apakah pool size sesuai DB capacity?
16. Apakah error diklasifikasi?
17. Apakah session state bisa bocor?
18. Apakah code ini tetap aman saat concurrency tinggi?
19. Apakah code ini tetap aman saat DB lambat?
20. Apakah code ini tetap aman saat network putus?
```

Kalau pertanyaan ini menjadi refleks, kamu mulai berpikir bukan sebagai “pemakai JDBC API”, tetapi sebagai engineer yang memahami boundary database.

---

## 32. Roadmap Seri Setelah Part Ini

Part ini membangun fondasi. Berikutnya kita akan turun ke detail API dan behavior:

```text
Part 001 — Anatomy of java.sql and javax.sql
Part 002 — JDBC Driver Architecture
Part 003 — Connection Is a Database Session
Part 004 — Statement, PreparedStatement, CallableStatement
Part 005 — ResultSet Deep Dive
Part 006 — JDBC Type System
Part 007 — Transaction Fundamentals in JDBC
Part 008 — Isolation Levels, Locking, and Observable Anomalies
Part 009 — SQLException Mastery
Part 010 — Resource Lifecycle
Part 011 — DataSource over DriverManager
Part 012 — Batch Operations
Part 013 — Large Objects and Streaming
Part 014 — Metadata APIs
Part 015 — Advanced JDBC Features
Part 016 — Stored Procedures and CallableStatement
Part 017 — Performance Model of JDBC Calls
Part 018 — Connection Pooling Fundamentals
Part 019 — HikariCP Architecture
Part 020 — HikariCP Configuration Deep Dive
Part 021 — Pool Sizing
Part 022 — Timeout Design
Part 023 — Transaction and Pool Interaction
Part 024 — Observability
Part 025 — Failure Modes and Recovery Patterns
Part 026 — Security and Integrity at JDBC Boundary
Part 027 — Testing JDBC Code Properly
Part 028 — JDBC in Modern Java Applications
Part 029 — Production Playbook
```

---

## 33. Ringkasan Mental Model

Simpan model ini:

```text
JDBC code is not just Java code that sends SQL.

It is a boundary where:

Java thread
  meets
connection pool
  meets
JDBC driver
  meets
database protocol
  meets
database session
  meets
transaction engine
  meets
lock/MVCC model
  meets
network failure
  meets
production capacity.
```

Atau lebih pendek:

> `Connection` adalah session/transaction carrier.  
> `Statement` adalah command carrier.  
> `ResultSet` adalah cursor/result carrier.  
> `SQLException` adalah failure signal yang harus diklasifikasi.  
> `DataSource` adalah acquisition boundary.  
> `HikariCP` adalah lifecycle manager dan concurrency governor.  
> Transaction correctness lebih penting daripada sekadar query berhasil.  
> Pooling mempercepat reuse, tetapi juga harus membatasi concurrency.  
> Retry tanpa idempotency adalah bug generator.  
> Observability adalah syarat diagnosis, bukan aksesori.

---

## 34. Referensi Resmi dan Bacaan Lanjutan

Referensi utama untuk part ini:

1. Oracle Java SE 24 API — `java.sql` package summary.  
   Menjelaskan bahwa `java.sql` menyediakan API untuk mengakses dan memproses data dari data source, biasanya relational database.

2. Oracle Java SE 24 API — `javax.sql` package summary.  
   Menjelaskan bahwa `javax.sql` melengkapi `java.sql` untuk server-side data source access, `DataSource`, pooling, distributed transactions, dan row set.

3. Oracle Java Tutorials — JDBC Basics: Establishing a Connection.  
   Menjelaskan penggunaan `DriverManager.getConnection()` dan JDBC URL.

4. Oracle Java Tutorials — JDBC Basics: Connecting with DataSource Objects.  
   Menjelaskan penggunaan `DataSource`, connection pooling, dan distributed transactions.

5. HikariCP official GitHub README.  
   Menjelaskan HikariCP sebagai JDBC connection pool production-ready yang ringan, cepat, sederhana, dan reliable.

---

## 35. Status Seri

Seri **belum selesai**.

Part ini adalah:

```text
Part 000 dari 029
```

Part berikutnya:

```text
Part 001 — Anatomy of java.sql and javax.sql
File: learn-java-sql-jdbc-hikaricp-part-001.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-security-cryptography-integrity-part-034](../security/learn-java-security-cryptography-integrity-part-034.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-sql-jdbc-hikaricp-part-001](./learn-java-sql-jdbc-hikaricp-part-001.md)

</div>