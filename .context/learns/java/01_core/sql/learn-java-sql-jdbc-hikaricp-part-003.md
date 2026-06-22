# learn-java-sql-jdbc-hikaricp-part-003

# Connection Is a Database Session, Not Just a Pipe

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `003 / 029`  
> Topik: `java.sql.Connection`, database session, transaction carrier, session state, connection lifecycle, pooling risk, dan failure model koneksi  
> Target pembaca: Java engineer yang ingin memahami JDBC pada level production, bukan hanya tahu cara memanggil `dataSource.getConnection()`.

---

## 0. Posisi Part Ini dalam Seri

Di Part 000 kita membangun mental model besar bahwa JDBC adalah boundary antara Java process dan database engine.

Di Part 001 kita memetakan anatomi `java.sql` dan `javax.sql`.

Di Part 002 kita melihat bahwa JDBC driver adalah implementasi konkret yang menerjemahkan interface Java menjadi protocol database.

Sekarang kita masuk ke salah satu konsep paling penting di seluruh JDBC:

> `Connection` bukan sekadar “jalur koneksi”.  
> `Connection` adalah handle Java terhadap sebuah database session dengan state, transaction context, resource ownership, dan failure mode.

Kalau mental model ini salah, hampir semua hal setelahnya akan rapuh:

- transaction bocor,
- pool exhausted,
- session state tercampur antar request,
- query read-only tiba-tiba ikut transaction lama,
- isolation level berubah tanpa sadar,
- schema tenant salah,
- connection dianggap sehat padahal socket sudah half-open,
- aplikasi restart terus karena database failover,
- HikariCP disalahkonfigurasi karena pool dianggap sekadar cache koneksi.

Part ini adalah fondasi sebelum masuk `Statement`, `PreparedStatement`, `ResultSet`, transaction, isolation, pooling, dan HikariCP.

---

## 1. Definisi Resmi: Connection adalah Session

Dokumentasi Java SE mendefinisikan `java.sql.Connection` sebagai:

> A connection (session) with a specific database. SQL statements are executed and results are returned within the context of a connection.

Artinya, `Connection` bukan hanya object transport. Ia adalah konteks tempat SQL statement dijalankan dan result dikembalikan. Di dalam konteks itu ada banyak state: auto-commit, isolation level, catalog, schema, read-only flag, holdability, warnings, savepoint, network timeout, client info, transaction state, dan state vendor/database-specific. Referensi: Java SE `Connection` API. [Oracle Java SE 25 Connection API](https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Connection.html)

Kalimat “within the context of a connection” adalah kunci.

Ketika aplikasi mengeksekusi:

```java
try (Connection connection = dataSource.getConnection()) {
    // use connection
}
```

Yang didapat bukan “query executor stateless”. Yang didapat adalah handle ke sebuah session yang mungkin punya state sebelumnya, sedang punya transaction, punya server-side resource, dan berada dalam lifecycle pool.

---

## 2. Mental Model Utama

Bayangkan ada empat lapisan:

```text
Java application thread
        |
        v
java.sql.Connection object / proxy
        |
        v
JDBC driver connection implementation
        |
        v
TCP/TLS socket + database wire protocol
        |
        v
Database server process/session/backend
```

Pada aplikasi sederhana tanpa pool, `Connection` Java bisa cukup dekat dengan physical database connection.

Pada aplikasi production dengan pool seperti HikariCP, object yang diterima aplikasi biasanya adalah proxy/logical connection:

```text
Application code
  gets: logical/proxy Connection
        |
        v
HikariCP pool
  owns: physical JDBC connection
        |
        v
Driver
        |
        v
Database session
```

Saat aplikasi memanggil `connection.close()` pada pooled connection, biasanya physical connection tidak benar-benar ditutup. Ia dikembalikan ke pool agar bisa dipakai request lain.

Ini menghasilkan aturan penting:

> Di aplikasi dengan pool, `close()` berarti “saya selesai memakai session ini; silakan reset/return ke pool”, bukan selalu “matikan koneksi ke database”.

---

## 3. Physical Connection vs Logical Connection

### 3.1 Physical connection

Physical connection adalah koneksi nyata dari driver ke database:

```text
JDBC driver object
TCP/TLS socket
DB authentication/session
server-side process/backend/session state
```

Membuat physical connection mahal karena biasanya melibatkan:

1. DNS lookup.
2. TCP handshake.
3. TLS negotiation jika enabled.
4. Database protocol handshake.
5. Authentication.
6. Session initialization.
7. Potential server process/thread allocation.
8. Applying session properties.

Karena mahal, aplikasi production hampir selalu memakai connection pool.

### 3.2 Logical connection

Logical connection adalah object `Connection` yang diberikan pool kepada aplikasi.

Di HikariCP, aplikasi menerima proxy connection. Proxy ini mengontrol perilaku seperti:

- tracking apakah connection sudah closed,
- tracking dirty state,
- mengembalikan connection ke pool saat `close()`,
- melakukan rollback jika connection dikembalikan dalam dirty transaction state,
- reset state tertentu sebelum connection dipakai kembali,
- mendeteksi leak jika connection tidak dikembalikan.

### 3.3 Konsekuensi desain

Kode aplikasi tidak boleh menyimpan `Connection` sebagai singleton/global field.

Buruk:

```java
public final class BadUserRepository {
    private final Connection connection;

    public BadUserRepository(Connection connection) {
        this.connection = connection;
    }
}
```

Kenapa buruk?

Karena `Connection` adalah resource scoped, stateful, dan biasanya borrowed dari pool. Ia bukan dependency stateless.

Lebih sehat:

```java
public final class UserRepository {
    private final DataSource dataSource;

    public UserRepository(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public User findById(long id) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            return findById(connection, id);
        }
    }

    public User findById(Connection connection, long id) throws SQLException {
        // actual SQL operation using caller-owned connection
        throw new UnsupportedOperationException("example");
    }
}
```

Catatan: pada aplikasi dengan transaction manager, acquisition/ownership connection sering dikelola framework. Tetapi prinsipnya tetap sama: connection punya scope dan owner.

---

## 4. Connection State: Apa Saja yang Bisa Menempel?

Sebuah database session dapat membawa state. Sebagian state terlihat di JDBC API, sebagian vendor-specific.

### 4.1 State yang umum di JDBC

| State | API JDBC | Risiko jika bocor di pool |
|---|---|---|
| Auto-commit | `setAutoCommit(boolean)` | Request berikutnya ikut mode transaction yang salah |
| Transaction isolation | `setTransactionIsolation(int)` | Query berikutnya lebih lambat/kurang konsisten dari expected |
| Read-only flag | `setReadOnly(boolean)` | Write berikutnya bisa gagal atau diarahkan berbeda oleh driver/DB |
| Catalog | `setCatalog(String)` | Query berjalan di catalog salah |
| Schema | `setSchema(String)` | Multi-tenant/schema routing salah |
| Network timeout | `setNetworkTimeout(...)` | Timeout behavior request berikutnya berubah |
| Holdability | `setHoldability(int)` | Cursor lifecycle berubah across commit |
| Client info | `setClientInfo(...)` | Observability/correlation salah |
| Warnings | `getWarnings()`, `clearWarnings()` | Diagnostic misleading |
| Savepoint | `setSavepoint()` | Transaction flow kacau jika tidak jelas boundary-nya |

HikariCP secara internal mengenali beberapa state penting untuk reset ketika connection dikembalikan ke pool, termasuk readOnly, autoCommit, isolation, catalog, network timeout, dan schema. Referensi source HikariCP menunjukkan daftar reset state tersebut. [HikariCP PoolBase source](https://github.com/brettwooldridge/HikariCP/blob/dev/src/main/java/com/zaxxer/hikari/pool/PoolBase.java)

### 4.2 State vendor/database-specific

Selain state JDBC standar, database dapat punya session state seperti:

- Oracle `ALTER SESSION SET CURRENT_SCHEMA = ...`
- Oracle module/action/client identifier
- PostgreSQL `search_path`
- PostgreSQL session variables/settings
- MySQL session variables
- temporary tables
- prepared statement server-side cache
- advisory locks
- time zone setting
- language/locale setting
- role setting
- optimizer/session parameters

JDBC pool tidak selalu tahu semua state vendor-specific yang Anda ubah lewat SQL langsung.

Contoh berbahaya:

```java
try (Connection connection = dataSource.getConnection();
     Statement statement = connection.createStatement()) {
    statement.execute("ALTER SESSION SET CURRENT_SCHEMA = TENANT_A");
    // do work
}
```

Jika pool tidak tahu state itu perlu direset, connection berikutnya bisa memakai schema/session setting yang tertinggal.

Karena itu, untuk state yang punya method JDBC resmi, gunakan method JDBC, bukan SQL langsung.

Lebih baik:

```java
connection.setSchema("TENANT_A");
```

Tetapi bahkan ini perlu discipline. Jangan ubah schema connection secara ad hoc tanpa reset strategy yang jelas.

---

## 5. Auto-Commit: Default yang Sering Disalahpahami

Secara default, JDBC `Connection` berada dalam auto-commit mode. Dalam mode ini, setiap SQL statement dianggap sebagai transaction tersendiri dan otomatis committed setelah statement selesai, sesuai dokumentasi `Connection`. [Oracle Java SE 25 Connection API](https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Connection.html)

Contoh:

```java
try (Connection connection = dataSource.getConnection()) {
    // default usually true
    try (PreparedStatement ps = connection.prepareStatement(
            "update account set balance = balance - ? where id = ?"
    )) {
        ps.setBigDecimal(1, amount);
        ps.setLong(2, accountId);
        ps.executeUpdate(); // committed automatically if autoCommit=true
    }
}
```

### 5.1 Auto-commit true

Auto-commit true cocok untuk operasi tunggal yang tidak perlu digabung dengan operasi lain.

Contoh:

```java
insert audit log only
select lookup value
update last_seen_at for one user
```

Namun auto-commit true tidak cocok jika beberapa statement harus atomic bersama.

Buruk:

```java
try (Connection connection = dataSource.getConnection()) {
    debit(connection, fromAccount, amount);  // auto committed
    credit(connection, toAccount, amount);  // could fail after debit committed
}
```

### 5.2 Auto-commit false

Untuk transaction multi-statement:

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setAutoCommit(false);

    try {
        debit(connection, fromAccount, amount);
        credit(connection, toAccount, amount);
        insertLedgerEntry(connection, fromAccount, toAccount, amount);

        connection.commit();
    } catch (SQLException e) {
        connection.rollback();
        throw e;
    }
}
```

### 5.3 Trap: mengubah auto-commit punya efek transaction

Mengubah auto-commit bukan sekadar flag lokal Java. Ia memengaruhi transaction behavior pada database session.

Yang harus diingat:

- `setAutoCommit(false)` membuat statement berikutnya masuk transaction eksplisit.
- `commit()` hanya valid saat auto-commit disabled.
- `rollback()` hanya meaningful saat transaction eksplisit aktif.
- mengembalikan connection ke pool dalam state auto-commit false atau dirty transaction adalah bug serius.

### 5.4 Trap: auto-commit false global di pool

Beberapa tim mengatur pool default `autoCommit=false` karena ingin “semua aman dalam transaction”. Ini sering menimbulkan efek samping:

- SELECT sederhana ikut membuka transaction.
- Connection bisa idle in transaction.
- MVCC bloat/undo retention meningkat.
- Lock atau snapshot bertahan lebih lama.
- HikariCP harus rollback saat connection dikembalikan dalam dirty state.
- Request read-only bisa menahan database resource.

Default yang umum lebih aman adalah membiarkan auto-commit true di pool, lalu transaction manager/service boundary mematikan auto-commit hanya saat diperlukan.

Pengecualian ada, misalnya framework tertentu sengaja mengelola connection lifecycle dengan asumsi auto-commit false. Tapi itu harus explicit dan dipahami.

---

## 6. Transaction State Hidup di Connection

Ini invariant yang sangat penting:

> Transaction di JDBC bukan milik `PreparedStatement`.  
> Transaction bukan milik repository method.  
> Transaction bukan milik SQL string.  
> Transaction hidup pada `Connection` / database session.

Contoh:

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setAutoCommit(false);

    updateApplicationStatus(connection, applicationId, "APPROVED");
    insertAuditTrail(connection, applicationId, "APPROVED_BY_OFFICER");
    insertOutboxEvent(connection, applicationId, "ApplicationApproved");

    connection.commit();
}
```

Semua statement atomic karena memakai connection yang sama dan transaction yang sama.

Jika masing-masing method mengambil connection sendiri, transaction atomic hilang.

Buruk:

```java
public void approveApplication(long applicationId) throws SQLException {
    updateApplicationStatus(applicationId, "APPROVED"); // opens own connection
    insertAuditTrail(applicationId, "APPROVED_BY_OFFICER"); // opens own connection
    insertOutboxEvent(applicationId, "ApplicationApproved"); // opens own connection
}
```

Masing-masing bisa auto-commit sendiri. Jika insert outbox gagal setelah status approved, sistem masuk state inkonsisten.

Lebih benar:

```java
public void approveApplication(long applicationId) throws SQLException {
    try (Connection connection = dataSource.getConnection()) {
        connection.setAutoCommit(false);
        try {
            applicationRepository.updateStatus(connection, applicationId, "APPROVED");
            auditRepository.insert(connection, applicationId, "APPROVED_BY_OFFICER");
            outboxRepository.insert(connection, applicationId, "ApplicationApproved");
            connection.commit();
        } catch (SQLException e) {
            connection.rollback();
            throw e;
        }
    }
}
```

Framework seperti Spring menyembunyikan passing `Connection`, tetapi secara internal prinsipnya sama: transaction manager mengikat connection ke execution context tertentu.

---

## 7. Connection Lifecycle Tanpa Pool

Untuk memahami pool, pahami dulu lifecycle tanpa pool:

```text
DriverManager/DataSource creates physical connection
        |
        v
application configures connection
        |
        v
application creates statement
        |
        v
statement executes SQL
        |
        v
result consumed
        |
        v
commit/rollback if needed
        |
        v
connection.close()
        |
        v
physical DB session/socket closed
```

Kode sederhana:

```java
try (Connection connection = DriverManager.getConnection(url, user, password)) {
    connection.setAutoCommit(false);
    try {
        // work
        connection.commit();
    } catch (SQLException e) {
        connection.rollback();
        throw e;
    }
}
```

Tanpa pool, `close()` biasanya benar-benar menutup physical connection.

Masalahnya: membuat connection setiap request sangat mahal dan bisa membebani database.

---

## 8. Connection Lifecycle dengan Pool

Dengan pool:

```text
Application starts
        |
        v
HikariDataSource initializes pool
        |
        v
Physical connections are created lazily/eagerly depending config
        |
        v
Request borrows logical/proxy Connection
        |
        v
Application uses Connection
        |
        v
Application calls close()
        |
        v
Pool validates/resets/returns physical connection
        |
        v
Another request borrows it later
```

`close()` menjadi return-to-pool.

```java
try (Connection connection = dataSource.getConnection()) {
    // use connection
} // returns to pool, not necessarily closes physical DB session
```

Ini sangat penting untuk ownership.

Aplikasi tetap wajib `close()` connection. Jangan berpikir “karena pool yang punya, saya tidak perlu close”. Justru pada pool, tidak close berarti tidak mengembalikan connection ke pool.

Leak sederhana:

```java
Connection connection = dataSource.getConnection();
// do work
// forgot connection.close()
```

Akibatnya:

```text
borrowed connection count naik
idle connection count turun
pending thread naik
request mulai timeout menunggu connection
DB mungkin terlihat tidak sibuk, tapi aplikasi tetap macet
```

---

## 9. Connection State Leakage di Pool

Karena physical connection dipakai ulang, state leakage adalah salah satu bug paling berbahaya.

### 9.1 Contoh leakage auto-commit

Request A:

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setAutoCommit(false);
    updateSomething(connection);
    // forgot commit/rollback
}
```

Jika pool tidak melakukan proteksi, Request B bisa menerima connection yang masih punya transaction state tidak bersih.

HikariCP berusaha mencegah sebagian kerusakan dengan reset/rollback tertentu, tetapi engineer tidak boleh mengandalkan pool untuk memperbaiki desain transaction yang buruk.

### 9.2 Contoh leakage isolation

Request A:

```java
connection.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
```

Request B mengira pakai default read committed, tapi menerima connection dengan serializable jika tidak direset.

Akibat:

- performa turun,
- lock/serialization error meningkat,
- behavior berbeda secara sporadis,
- bug sulit direproduksi.

### 9.3 Contoh leakage schema

Request A tenant A:

```java
connection.setSchema("TENANT_A");
```

Request B tenant B memakai connection yang sama tetapi schema tidak direset.

Akibat:

- data tenant salah,
- pelanggaran security,
- audit/regulatory incident.

### 9.4 Aturan desain

Jika Anda mengubah state connection:

1. Pastikan scope-nya sangat pendek.
2. Pastikan dikembalikan ke default.
3. Pastikan pool tahu state tersebut jika memungkinkan.
4. Jangan ubah state vendor-specific lewat SQL tanpa reset hook.
5. Lebih baik pisahkan pool/DataSource untuk workload yang butuh default state berbeda.

---

## 10. `close()` Bukan Hal Kecil

`Connection.close()` punya makna operasional.

Pada non-pooled connection:

```text
close => physical connection closed
```

Pada pooled connection:

```text
close => return logical connection to pool
      => maybe rollback dirty transaction
      => reset dirty state
      => mark available
      => physical connection remains open
```

Karena itu, jangan pernah melakukan ini:

```java
public Connection getConnectionForLaterUse() throws SQLException {
    try (Connection connection = dataSource.getConnection()) {
        return connection;
    }
}
```

Connection yang dikembalikan sudah closed secara logical.

Juga jangan simpan connection lintas request:

```java
class BadSessionCache {
    private Connection connection;
}
```

Connection harus dianggap sebagai resource scoped, bukan object domain.

---

## 11. Thread Safety: Jangan Share Connection Antar Thread

Walaupun beberapa driver mungkin melakukan sinkronisasi internal, desain aplikasi tidak boleh mengandalkan `Connection` sebagai thread-safe concurrent object.

Buruk:

```java
Connection connection = dataSource.getConnection();

CompletableFuture<Void> a = CompletableFuture.runAsync(() -> updateA(connection));
CompletableFuture<Void> b = CompletableFuture.runAsync(() -> updateB(connection));
```

Masalah:

- transaction state dipakai bersama,
- statement interleaving tidak jelas,
- result set/cursor lifecycle kacau,
- driver behavior bisa berbeda,
- exception satu thread bisa merusak state thread lain,
- commit/rollback race.

Aturan:

> Satu `Connection` sebaiknya dimiliki oleh satu execution flow transaction yang jelas.

Jika perlu parallel query, biasanya gunakan connection terpisah dan transaction boundary berbeda. Jika harus satu transaction, parallelisme database operation dalam satu connection biasanya bukan model yang aman.

---

## 12. `Connection` dan Virtual Threads

Dengan Java modern, virtual threads membuat blocking code lebih murah dari sisi Java thread. Tetapi JDBC tetap blocking I/O pada banyak driver mainstream.

Artinya:

```text
virtual thread banyak
        tidak berarti
DB connection bisa banyak tanpa batas
```

Pool tetap menjadi batas concurrency ke database.

Jika aplikasi memakai virtual threads dan menerima 10.000 request concurrent, tetapi HikariCP maximumPoolSize = 30, maka hanya sekitar 30 database operations yang bisa memegang connection secara bersamaan. Sisanya menunggu pool.

Ini bukan masalah. Ini justru backpressure.

Yang berbahaya adalah menaikkan pool size menjadi 1000 karena “virtual threads mampu”. Database mungkin tidak mampu menangani 1000 active sessions dengan baik.

Invariant:

> Virtual threads mengurangi biaya waiting di JVM.  
> Virtual threads tidak mengurangi biaya database session, lock, CPU database, I/O database, atau network round trip.

---

## 13. Connection Configuration: Gunakan JDBC API Jika Ada

Jika ingin mengubah konfigurasi connection, gunakan method JDBC ketika tersedia.

Lebih baik:

```java
connection.setAutoCommit(false);
connection.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
connection.setReadOnly(true);
connection.setSchema("REPORTING");
connection.setNetworkTimeout(executor, 5_000);
```

Kurang baik:

```java
statement.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
statement.execute("ALTER SESSION SET CURRENT_SCHEMA = REPORTING");
```

Alasannya:

1. Pool dapat melacak beberapa state JDBC standar.
2. Driver dapat menerjemahkan sesuai database.
3. Kode lebih portable.
4. Reset behavior lebih predictable.
5. Observability/debugging lebih mudah.

Tetapi tidak semua setting punya method JDBC. Untuk state vendor-specific, buat wrapper/protocol yang jelas.

Contoh pattern:

```java
public final class TenantConnectionScope implements AutoCloseable {
    private final Connection connection;
    private final String previousSchema;

    public TenantConnectionScope(Connection connection, String tenantSchema) throws SQLException {
        this.connection = connection;
        this.previousSchema = connection.getSchema();
        connection.setSchema(tenantSchema);
    }

    @Override
    public void close() throws SQLException {
        connection.setSchema(previousSchema);
    }
}
```

Pemakaian:

```java
try (Connection connection = dataSource.getConnection();
     TenantConnectionScope ignored = new TenantConnectionScope(connection, "TENANT_A")) {
    // tenant-scoped work
}
```

Namun untuk multi-tenant production, sering lebih aman memakai strategi yang tidak bergantung pada mutable session state, misalnya explicit schema-qualified SQL yang dikontrol ketat, separate DataSource, atau database-level tenant isolation.

---

## 14. Read-Only Flag: Hint, Contract, atau Enforcement?

`connection.setReadOnly(true)` sering disalahpahami.

Di JDBC, read-only flag memberi indikasi bahwa connection berada pada mode read-only. Namun efektivitasnya tergantung driver dan database.

Kemungkinan behavior:

1. Hanya hint optimisasi.
2. Diterjemahkan menjadi session/transaction read-only.
3. Digunakan routing oleh driver/proxy.
4. Write operation benar-benar ditolak.
5. Diabaikan sebagian.

Jangan membangun security hanya dari `setReadOnly(true)`.

Untuk security, gunakan database privilege:

```text
read-only application user:
  SELECT grants only

write application user:
  SELECT/INSERT/UPDATE/DELETE grants as needed
```

Read-only flag berguna untuk:

- dokumentasi intent,
- membantu framework/driver melakukan optimisasi,
- membedakan workload,
- mencegah sebagian kesalahan write jika database mendukung.

Tetapi bukan pengganti authorization database.

---

## 15. Catalog dan Schema

`catalog` dan `schema` sering membingungkan karena database berbeda memetakannya secara berbeda.

Secara konseptual:

```text
catalog: container lebih besar, sering database/catalog
schema : namespace object seperti table/view/procedure
```

Namun vendor berbeda:

- PostgreSQL punya database dan schema; `setSchema` relevan.
- Oracle secara historis schema dekat dengan user; current schema bisa diubah.
- MySQL sering memetakan database sebagai catalog; schema/database sering dipakai bergantian.
- SQL Server punya database dan schema.

Aturan:

> Jangan asumsikan semantics catalog/schema portable penuh antar database.

Untuk aplikasi enterprise, tentukan secara eksplisit:

1. Apakah aplikasi bergantung pada default schema?
2. Apakah SQL harus schema-qualified?
3. Apakah schema dipakai untuk tenant?
4. Siapa yang boleh mengubah schema state?
5. Bagaimana pool mereset schema?
6. Bagaimana test memverifikasi tidak ada cross-tenant leakage?

---

## 16. Network Timeout dan Socket Reality

`Connection.setNetworkTimeout(...)` mengatur timeout untuk operasi database tertentu pada connection menurut JDBC API. Tetapi timeout adalah area yang sangat driver-specific.

Ada beberapa timeout berbeda:

```text
pool connectionTimeout      = berapa lama thread menunggu borrow connection dari pool
login/connect timeout       = berapa lama membuat koneksi baru boleh berlangsung
socket connect timeout      = timeout saat membuka socket
socket read timeout         = timeout menunggu data dari database
query timeout               = timeout statement execution
network timeout             = timeout operasi network pada connection
transaction timeout         = timeout logical business transaction
request timeout             = timeout HTTP/API request
```

Jangan campuradukkan.

Contoh kesalahan:

```text
Hikari connectionTimeout = 30s
```

Lalu engineer mengira query akan timeout setelah 30s.

Padahal `connectionTimeout` HikariCP biasanya berarti maksimum waktu menunggu connection dari pool. Setelah connection didapat, query bisa berjalan lebih lama jika query/statement/socket/database timeout tidak dikonfigurasi.

Part timeout akan dibahas khusus di Part 022.

Di Part ini cukup pahami:

> Connection memiliki dimensi network dan timeout, tapi pool timeout bukan query timeout.

---

## 17. Client Info dan Observability

`Connection` menyediakan `setClientInfo(...)`. Dukungan detailnya tergantung driver/database.

Tujuannya adalah memberi metadata ke database session, misalnya:

- application name,
- module,
- action,
- client id,
- request id,
- user id internal,
- tenant id.

Secara production, ini sangat bernilai.

Jika database session bisa dikorelasikan dengan request aplikasi, diagnosis jauh lebih mudah:

```text
API request id: req-123
application module: case-management
business action: approve-application
DB session id: 847
SQL running: update application set status = ? where id = ?
```

Tanpa korelasi:

```text
DBA: ada session blocking
App team: dari endpoint mana?
DBA: tidak tahu
App team: user siapa?
DBA: tidak tahu
```

Namun hati-hati:

- Jangan taruh PII sensitif sembarangan.
- Pastikan client info direset atau ditimpa untuk request berikutnya.
- Jika memakai pool, jangan biarkan correlation id request A terlihat pada request B.

---

## 18. Temporary Tables, Cursors, dan Server-Side Resources

Connection/session dapat membawa server-side resources:

- temporary table data,
- open cursor,
- server-side prepared statement,
- advisory lock,
- transaction lock,
- LOB locator,
- session variables.

Jika resource ini tidak dibersihkan, connection yang kembali ke pool bisa membawa beban tersembunyi.

Contoh:

```java
try (Connection connection = dataSource.getConnection();
     Statement statement = connection.createStatement()) {
    statement.execute("create temporary table tmp_ids(id bigint)");
    statement.execute("insert into tmp_ids values (1)");
    // connection returned to pool
}
```

Apa yang terjadi pada temporary table tergantung database. Ada yang temporary table-nya session-scoped, ada yang transaction-scoped, ada yang data-nya hilang on commit, ada yang tidak.

Aturan:

> Kalau memakai fitur session-scoped, Anda harus tahu persis lifecycle-nya terhadap commit, rollback, dan pooled connection reuse.

---

## 19. Connection Failure Model

Connection bisa gagal dalam banyak cara. Tidak semua kegagalan terlihat saat itu juga.

### 19.1 Closed by application

Aplikasi sudah memanggil `close()` lalu memakai lagi:

```java
Connection connection = dataSource.getConnection();
connection.close();
connection.prepareStatement("select 1"); // error
```

Ini bug aplikasi.

### 19.2 Closed by database

Database bisa menutup session karena:

- idle timeout,
- admin kill session,
- database restart,
- failover,
- resource manager,
- max session policy,
- network disconnect.

Aplikasi baru tahu ketika memakai connection.

### 19.3 Half-open TCP

Salah satu failure paling menyebalkan:

```text
Java side thinks socket is open
network path silently broken
DB side gone or unreachable
read/write hangs or fails late
```

Ini bisa terjadi karena firewall/NAT/load balancer idle timeout atau network partition.

### 19.4 Stale connection in pool

Pool menyimpan physical connection yang terlihat idle. Saat dipinjam dan dipakai, ternyata database sudah menutupnya.

Pool modern melakukan validation/keepalive/retirement untuk mengurangi risiko, tetapi konfigurasi harus cocok dengan environment.

### 19.5 Authentication/credential failure

Connection creation bisa gagal karena:

- password salah,
- password expired,
- secret rotated tapi aplikasi belum refresh,
- account locked,
- certificate invalid,
- TLS truststore salah.

### 19.6 Database overloaded

Connection bisa berhasil dibuat, tetapi query lambat karena:

- CPU database penuh,
- I/O wait,
- lock wait,
- active session terlalu banyak,
- bad execution plan,
- buffer/cache pressure.

Aplikasi sering salah diagnosis sebagai “pool problem”, padahal pool hanya menunjukkan gejala.

---

## 20. Connection Validation: Sehat Itu Relatif

Pertanyaan “connection ini sehat?” tidak sesederhana terlihat.

Kemungkinan health level:

```text
Object Java belum closed             -> isClosed false
Socket masih terbuka                 -> OS thinks open
Driver bisa kirim ping               -> protocol OK
Database bisa execute SELECT 1       -> basic query OK
Database bisa access target schema   -> privilege/schema OK
Database bisa write business table   -> business path OK
Database latency normal              -> performance OK
```

`Connection.isValid(timeout)` dapat dipakai untuk validasi sesuai driver support. Pool juga dapat memakai validation query jika dibutuhkan.

Tetapi validasi punya biaya. Melakukan validation terlalu sering dapat membebani DB. Tidak melakukan validation sama sekali dapat membuat stale connection terdeteksi oleh request user.

Trade-off ini akan dibahas detail di HikariCP configuration.

---

## 21. Anti-Pattern Penting

### 21.1 Static global connection

```java
public final class Db {
    public static Connection CONNECTION;
}
```

Masalah:

- shared mutable state,
- tidak thread-safe secara desain,
- transaction bercampur,
- failure recovery buruk,
- tidak kompatibel dengan pool,
- sulit test.

### 21.2 One connection per application lifetime

```java
Connection connection = DriverManager.getConnection(...);
// used forever
```

Masalah:

- database restart membuat connection mati,
- stale session state,
- no concurrency control,
- no pool health management,
- bottleneck tunggal.

### 21.3 Open connection too early

```java
try (Connection connection = dataSource.getConnection()) {
    validateLargeJson(payload);
    callExternalApi();
    doCpuHeavyWork();
    updateDatabase(connection);
}
```

Connection dipinjam terlalu lama padahal database hanya dipakai di akhir.

Lebih baik:

```java
validateLargeJson(payload);
ExternalResult externalResult = callExternalApi();
ProcessedData processed = doCpuHeavyWork(externalResult);

try (Connection connection = dataSource.getConnection()) {
    updateDatabase(connection, processed);
}
```

Prinsip:

> Borrow connection as late as possible, return as early as possible, while preserving transaction correctness.

### 21.4 Holding connection across remote call

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setAutoCommit(false);
    updateCaseStatus(connection, caseId, "PENDING_PAYMENT");

    paymentGateway.charge(...); // remote call while transaction open

    insertPaymentRecord(connection, caseId);
    connection.commit();
}
```

Masalah:

- transaction terbuka lama,
- lock bertahan selama network call,
- pool slot tertahan,
- remote retry bisa memperpanjang lock,
- failure boundary kabur.

Lebih baik gunakan pattern seperti outbox/saga tergantung kebutuhan konsistensi.

### 21.5 Passing connection through arbitrary layers

Passing connection eksplisit bisa sehat jika boundary jelas. Tapi buruk jika connection disebar ke mana-mana tanpa ownership.

Buruk:

```java
serviceA.doSomething(connection);
serviceB.doSomethingElse(connection);
helper.maybeCommit(connection);
randomUtility.changeIsolation(connection);
```

Aturan:

- Hanya owner transaction yang boleh commit/rollback.
- Lower-level repository tidak boleh diam-diam commit.
- Helper tidak boleh mengubah isolation/autocommit tanpa restore.
- Connection scope harus bisa dibaca dari struktur kode.

---

## 22. Good Pattern: Explicit Transaction Owner

Plain JDBC pattern:

```java
public final class JdbcTransactionRunner {
    private final DataSource dataSource;

    public JdbcTransactionRunner(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public <T> T inTransaction(SqlCallable<T> callable) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            boolean previousAutoCommit = connection.getAutoCommit();
            connection.setAutoCommit(false);

            try {
                T result = callable.call(connection);
                connection.commit();
                return result;
            } catch (SQLException | RuntimeException e) {
                try {
                    connection.rollback();
                } catch (SQLException rollbackFailure) {
                    e.addSuppressed(rollbackFailure);
                }
                throw e;
            } finally {
                try {
                    connection.setAutoCommit(previousAutoCommit);
                } catch (SQLException resetFailure) {
                    // In real infrastructure code, log this and let pool decide whether to evict.
                    // Avoid swallowing silently.
                    throw resetFailure;
                }
            }
        }
    }

    @FunctionalInterface
    public interface SqlCallable<T> {
        T call(Connection connection) throws SQLException;
    }
}
```

Pemakaian:

```java
Application approved = txRunner.inTransaction(connection -> {
    Application app = applicationRepository.lockById(connection, applicationId);

    if (!app.canApprove()) {
        throw new IllegalStateException("Application cannot be approved from state " + app.status());
    }

    applicationRepository.updateStatus(connection, applicationId, "APPROVED");
    auditRepository.insert(connection, applicationId, "APPROVED_BY_OFFICER");
    outboxRepository.insert(connection, "ApplicationApproved", applicationId);

    return app.approve();
});
```

Catatan:

- Dalam real production dengan Spring/JTA, transaction runner biasanya digantikan transaction manager.
- Namun pattern ini mengajarkan invariant: transaction owner jelas, commit/rollback hanya di satu tempat, repository memakai connection yang diberikan.

---

## 23. Good Pattern: Non-Transactional Single Query

Untuk operasi read sederhana:

```java
public Optional<User> findById(long id) throws SQLException {
    String sql = """
            select id, username, status
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
            return Optional.of(new User(
                    rs.getLong("id"),
                    rs.getString("username"),
                    rs.getString("status")
            ));
        }
    }
}
```

Dalam auto-commit true, SELECT tunggal biasanya cukup sederhana. Namun database tertentu tetap dapat membuat transaction/snapshot tergantung isolation dan driver behavior.

Jika read harus konsisten dengan beberapa SELECT, gunakan transaction eksplisit.

---

## 24. Good Pattern: Restore Mutable Connection State

Jika harus mengubah state:

```java
public <T> T withReadOnly(Connection connection, SqlCallable<T> callable) throws SQLException {
    boolean previousReadOnly = connection.isReadOnly();
    connection.setReadOnly(true);
    try {
        return callable.call(connection);
    } finally {
        connection.setReadOnly(previousReadOnly);
    }
}
```

Untuk isolation:

```java
public <T> T withIsolation(Connection connection, int isolation, SqlCallable<T> callable) throws SQLException {
    int previousIsolation = connection.getTransactionIsolation();
    connection.setTransactionIsolation(isolation);
    try {
        return callable.call(connection);
    } finally {
        connection.setTransactionIsolation(previousIsolation);
    }
}
```

Namun hati-hati: mengubah isolation di tengah transaction bisa tidak valid atau punya efek database-specific. Idealnya set isolation sebelum transaction dimulai.

---

## 25. Connection dan Regulatory Workflow Case Study

Misalkan sistem case management punya flow:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> CLOSED
```

Operation: officer approve application.

Business invariant:

1. Application harus sedang `UNDER_REVIEW`.
2. Hanya officer assigned yang boleh approve.
3. Status update, audit trail, dan outbox event harus atomic.
4. Tidak boleh dua officer approve case yang sama bersamaan.
5. Event hanya boleh terbit setelah commit sukses.

JDBC design:

```java
public void approve(long applicationId, long officerId) throws SQLException {
    txRunner.inTransaction(connection -> {
        Application app = applicationRepository.lockForUpdate(connection, applicationId);

        if (!app.isAssignedTo(officerId)) {
            throw new ForbiddenOperationException("Officer is not assigned");
        }

        if (!app.status().equals("UNDER_REVIEW")) {
            throw new InvalidStateTransitionException(app.status(), "APPROVED");
        }

        applicationRepository.updateStatus(connection, applicationId, "APPROVED");
        auditRepository.insert(connection, applicationId, officerId, "APPROVED");
        outboxRepository.insert(connection, "ApplicationApproved", applicationId);

        return null;
    });
}
```

Kenapa connection penting?

Karena semua operasi harus memakai connection yang sama:

```text
same connection
same transaction
same lock context
same commit/rollback fate
```

Jika audit insert memakai connection lain, audit bisa commit saat status rollback.

Jika outbox insert memakai connection lain, event bisa terbit untuk state yang tidak pernah commit.

Jika lock query memakai connection lain, lock tidak melindungi update berikutnya.

---

## 26. Pool Exhaustion sebagai Gejala Connection Ownership Buruk

Pool exhaustion sering bukan karena pool terlalu kecil. Sering karena connection dipinjam terlalu lama.

Contoh buruk:

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setAutoCommit(false);

    Application app = applicationRepository.find(connection, id);

    // User-defined rule engine takes 3 seconds
    Decision decision = ruleEngine.evaluate(app);

    // External API takes 5 seconds
    ExternalCheck check = externalSystem.check(app.referenceNo());

    applicationRepository.updateDecision(connection, id, decision, check);
    connection.commit();
}
```

Connection ditahan selama 8+ detik, padahal database mungkin hanya dipakai ratusan milidetik.

Dampaknya:

```text
maximumPoolSize = 20
20 concurrent requests enter slow external call while holding connection
all pool slots occupied
new requests wait
connectionTimeout reached
API returns 500/timeout
DB may be mostly idle
```

Solusi bukan otomatis menaikkan pool ke 200. Solusi mungkin:

- pindahkan external call sebelum transaction,
- gunakan reservation/state transition pattern,
- gunakan outbox/saga,
- kurangi transaction duration,
- pisahkan workload,
- review locking semantics.

---

## 27. Debugging Connection Problem: Pertanyaan yang Harus Ditanyakan

Ketika ada masalah JDBC connection, jangan langsung “pool kurang besar”. Tanyakan:

1. Berapa active connection?
2. Berapa idle connection?
3. Berapa pending thread menunggu connection?
4. Berapa acquisition time?
5. Berapa usage time?
6. Query mana yang lama?
7. Transaction mana yang lama?
8. Apakah connection leak?
9. Apakah ada idle in transaction?
10. Apakah DB session blocked by lock?
11. Apakah DB CPU tinggi?
12. Apakah DB I/O tinggi?
13. Apakah terjadi network timeout?
14. Apakah database restart/failover?
15. Apakah credential baru dirotasi?
16. Apakah schema/isolation/readOnly berubah?
17. Apakah ada external call saat transaction terbuka?
18. Apakah pool size dikalikan jumlah pod/replica masih masuk DB limit?

Diagnosis connection adalah diagnosis lintas layer:

```text
application code
pool metrics
JDBC driver behavior
network
database session
database locks
database resource
```

---

## 28. Mini Checklist Desain Connection

Gunakan checklist ini saat review kode JDBC:

```text
[ ] Connection diperoleh dari DataSource, bukan static global DriverManager helper.
[ ] Connection scope jelas dan pendek.
[ ] Connection selalu ditutup dengan try-with-resources atau transaction manager.
[ ] Tidak ada connection yang disimpan sebagai field singleton.
[ ] Tidak ada connection yang dipakai lintas thread tanpa desain eksplisit.
[ ] Transaction owner jelas.
[ ] Commit/rollback hanya dilakukan di boundary yang benar.
[ ] Repository tidak diam-diam commit transaction milik caller.
[ ] Auto-commit tidak diubah tanpa restore/reset.
[ ] Isolation tidak diubah tanpa alasan dan tanpa restore.
[ ] Schema/catalog tidak diubah sembarangan.
[ ] Read-only flag tidak dianggap security control.
[ ] External call tidak dilakukan sambil menahan transaction kecuali benar-benar didesain.
[ ] Long CPU work tidak dilakukan sambil menahan connection.
[ ] Pool size tidak dianggap solusi utama untuk transaction yang terlalu lama.
[ ] Timeout dipahami sesuai jenisnya.
[ ] Failure connection diklasifikasikan: pool wait, login, socket, query, lock, transaction, DB overload.
```

---

## 29. Ringkasan Mental Model

`Connection` adalah database session handle.

Ia membawa:

```text
transaction context
session state
configuration state
server-side resources
network relationship
failure possibility
pool ownership contract
```

Dalam aplikasi non-pooled, `close()` biasanya menutup physical connection.

Dalam aplikasi pooled, `close()` mengembalikan logical connection ke pool.

Transaction hidup pada connection. Semua operasi yang harus atomic harus memakai connection yang sama.

Connection state dapat bocor antar request jika tidak direset.

Connection harus dipinjam sependek mungkin, tapi transaction correctness tidak boleh dikorbankan.

Pool bukan magic capacity multiplier. Pool adalah concurrency boundary dan resource governor.

Kalau engineer benar-benar memahami `Connection`, ia akan lebih mudah memahami:

- `PreparedStatement`,
- `ResultSet`,
- transaction,
- isolation,
- lock,
- timeout,
- connection pool,
- HikariCP,
- database failover,
- production diagnosis.

---

## 30. Latihan Pemahaman

### Latihan 1

Apa yang salah dari kode berikut?

```java
public void process(long id) throws SQLException {
    try (Connection connection = dataSource.getConnection()) {
        connection.setAutoCommit(false);
        repository.updateStatus(connection, id, "PROCESSING");
        externalApi.notify(id);
        repository.updateStatus(connection, id, "DONE");
        connection.commit();
    }
}
```

Hal yang harus dianalisis:

- connection ditahan saat remote call,
- transaction terbuka saat remote call,
- lock bisa bertahan lama,
- failure external API membuat transaction ambiguity,
- perlu outbox/saga/reservation pattern tergantung business invariant.

### Latihan 2

Apa risiko kode berikut dalam pooled environment?

```java
try (Connection connection = dataSource.getConnection();
     Statement statement = connection.createStatement()) {
    statement.execute("ALTER SESSION SET CURRENT_SCHEMA = TENANT_A");
    repository.querySomething(connection);
}
```

Hal yang harus dianalisis:

- session state vendor-specific,
- pool belum tentu tahu harus reset,
- request berikutnya bisa memakai schema salah,
- cross-tenant data leakage,
- lebih baik pakai controlled schema strategy.

### Latihan 3

Kenapa ini bukan transaction atomic?

```java
public void approve(long applicationId) throws SQLException {
    applicationRepository.updateStatus(applicationId, "APPROVED");
    auditRepository.insert(applicationId, "APPROVED");
    outboxRepository.insert("ApplicationApproved", applicationId);
}
```

Kemungkinan alasan:

- setiap repository mungkin membuka connection sendiri,
- masing-masing auto-commit,
- failure di tengah menghasilkan partial commit,
- harus ada transaction boundary dengan connection yang sama.

---

## 31. Referensi

1. Oracle Java SE 25 API — `java.sql.Connection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Connection.html

2. Oracle Java SE 25 API — `java.sql` package summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/package-summary.html

3. HikariCP GitHub README  
   https://github.com/brettwooldridge/HikariCP

4. HikariCP PoolBase source — connection reset state reference  
   https://github.com/brettwooldridge/HikariCP/blob/dev/src/main/java/com/zaxxer/hikari/pool/PoolBase.java

---

## 32. Status Seri

```text
Part 003 dari 029 selesai.
Seri belum selesai.

Part berikutnya:
Part 004 — Statement, PreparedStatement, CallableStatement: Execution Model

File berikutnya:
learn-java-sql-jdbc-hikaricp-part-004.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-sql-jdbc-hikaricp-part-002.md">⬅️ Part 002 — JDBC Driver Architecture: Dari Interface Java ke Protocol Database</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-sql-jdbc-hikaricp-part-004.md">Part 004 — Statement, PreparedStatement, CallableStatement: Execution Model ➡️</a>
</div>
