# learn-java-sql-jdbc-hikaricp-part-019

# Part 019 — HikariCP Architecture and Design Philosophy

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Bagian: `019 / 029`  
> Topik: HikariCP architecture, lifecycle, internal model, design philosophy, operational implications  
> Sasaran: memahami HikariCP bukan hanya sebagai konfigurasi Spring Boot, tetapi sebagai concurrency boundary antara aplikasi Java dan database.

---

## 0. Posisi Part Ini dalam Seri

Kita sudah membangun fondasi berikut:

- `Connection` bukan sekadar pipe, tetapi database session.
- `Statement`, `PreparedStatement`, dan `ResultSet` adalah resource yang hidup di atas connection.
- Transaction state menempel pada connection.
- Resource leak dapat menyebabkan pool exhaustion.
- `DataSource` adalah boundary modern untuk memperoleh connection.
- Connection pool adalah concurrency governor, bukan penambah kapasitas database.

Part ini mulai masuk ke HikariCP secara spesifik.

Namun fokus Part 019 **bukan dulu konfigurasi satu per satu**. Itu akan masuk Part 020.

Part ini menjawab:

1. HikariCP itu sebenarnya melakukan apa?
2. Kenapa desainnya berbeda dari pool yang penuh konfigurasi?
3. Apa yang terjadi saat aplikasi memanggil `dataSource.getConnection()`?
4. Kenapa connection yang kita terima bukan physical JDBC connection asli?
5. Apa peran `HikariConfig`, `HikariDataSource`, `HikariPool`, proxy connection, housekeeper, validation, dan state reset?
6. Apa konsekuensi desain HikariCP terhadap reliability production?

Mental model utama:

```text
HikariCP is not a database performance booster.
HikariCP is a carefully engineered connection lifecycle manager and concurrency boundary.
```

---

## 1. HikariCP dalam Satu Kalimat

HikariCP adalah implementasi `javax.sql.DataSource` yang mengelola sekumpulan physical JDBC connections agar aplikasi dapat memperoleh logical connection dengan cepat, aman, dan konsisten.

Lebih tepatnya:

```text
Application code
    -> asks HikariDataSource for a Connection
    -> receives a proxy/logical Connection
    -> uses it like normal JDBC Connection
    -> closes it
    -> HikariCP returns the physical connection to the pool instead of closing the database session
```

Jadi ketika memakai HikariCP:

```java
try (Connection connection = dataSource.getConnection()) {
    // use connection
}
```

`connection.close()` tidak selalu berarti:

```text
close TCP socket to database
terminate database session
free database backend process/thread
```

Dalam konteks pooled connection, `close()` biasanya berarti:

```text
return this logical connection handle back to the pool
so the underlying physical connection can be reused
```

Ini adalah perbedaan fundamental.

---

## 2. HikariCP Bukan Bagian dari JDBC Standard

JDBC standard menyediakan kontrak seperti:

- `java.sql.Connection`
- `java.sql.Statement`
- `java.sql.PreparedStatement`
- `java.sql.ResultSet`
- `javax.sql.DataSource`
- `javax.sql.ConnectionPoolDataSource`
- `javax.sql.PooledConnection`

Namun HikariCP adalah library eksternal dari package:

```java
com.zaxxer.hikari
```

Class yang paling sering terlihat:

```java
com.zaxxer.hikari.HikariConfig
com.zaxxer.hikari.HikariDataSource
```

Artinya:

```text
JDBC defines the contracts.
Driver implements database communication.
HikariCP manages connection reuse and lifecycle.
Your application consumes DataSource/Connection.
```

Diagram:

```text
+------------------------------+
| Application / Repository     |
+------------------------------+
              |
              | DataSource.getConnection()
              v
+------------------------------+
| HikariDataSource             |
| - owns HikariPool            |
| - exposes javax.sql.DataSource|
+------------------------------+
              |
              | borrow logical connection
              v
+------------------------------+
| Hikari Pool                  |
| - idle physical connections  |
| - active borrowed handles    |
| - waiters                    |
| - lifecycle management       |
+------------------------------+
              |
              | physical JDBC connection
              v
+------------------------------+
| JDBC Driver                  |
+------------------------------+
              |
              | database protocol
              v
+------------------------------+
| Database Session             |
+------------------------------+
```

---

## 3. Kenapa HikariCP Populer?

Alasan teknis utama:

1. Fast borrow/return path.
2. Minimal object allocation pada jalur panas.
3. Konfigurasi relatif sedikit.
4. Default yang cukup aman untuk banyak aplikasi.
5. Validasi connection yang pragmatis.
6. Leak detection.
7. Metrics/JMX integration.
8. Stabil di production.
9. Menjadi default pool di Spring Boot modern.
10. Tidak mencoba menjadi abstraction database yang terlalu luas.

Namun alasan yang lebih penting:

```text
HikariCP is opinionated about simplicity.
```

Pool yang memiliki terlalu banyak knob sering menciptakan ilusi kontrol. Banyak konfigurasi justru menjadi sumber error karena engineer mengubah hal yang tidak benar-benar dipahami.

HikariCP mengambil pendekatan:

```text
Make the common path fast.
Make lifecycle rules strict.
Expose only knobs that matter.
Fail loudly enough when something is wrong.
```

---

## 4. Filosofi Desain: Simplicity as Reliability

HikariCP sering diasosiasikan dengan prinsip:

```text
Simplicity is prerequisite for reliability.
```

Maknanya dalam connection pooling:

1. Pool tidak boleh memiliki state machine yang terlalu kompleks.
2. Borrow dan return connection harus predictable.
3. Pool tidak boleh menyembunyikan masalah database terlalu lama.
4. Pool tidak boleh membuka connection tanpa batas.
5. Pool tidak boleh menjadi retry engine yang agresif.
6. Pool tidak boleh mencoba memperbaiki query buruk.
7. Pool tidak boleh menggantikan capacity planning.

HikariCP bukan:

```text
- ORM
- query optimizer
- transaction manager penuh
- database failover framework universal
- load balancer database
- distributed transaction coordinator
- SQL firewall
- backpressure system lengkap untuk seluruh aplikasi
```

HikariCP adalah:

```text
- DataSource implementation
- connection lifecycle manager
- physical connection reuse mechanism
- concurrent borrow/return coordinator
- basic validation and retirement manager
- metrics source for pool behavior
```

---

## 5. Object Model Utama HikariCP

Secara konseptual, object penting HikariCP:

```text
HikariConfig
    configuration object

HikariDataSource
    public DataSource implementation used by application

HikariPool
    internal pool manager

PoolEntry
    wrapper around one physical JDBC connection and metadata

ProxyConnection
    logical Connection returned to application

ConcurrentBag
    internal concurrent structure for borrowing/returning entries

HouseKeeper
    scheduled maintenance task
```

Nama internal dapat berubah antar versi, tetapi mental model-nya stabil.

---

## 6. HikariConfig: Configuration Object

`HikariConfig` adalah object konfigurasi.

Contoh sederhana:

```java
HikariConfig config = new HikariConfig();
config.setJdbcUrl("jdbc:postgresql://localhost:5432/app");
config.setUsername("app_user");
config.setPassword("secret");
config.setMaximumPoolSize(10);
config.setPoolName("app-main-pool");

HikariDataSource dataSource = new HikariDataSource(config);
```

Perhatikan pemisahan:

```text
HikariConfig describes how the pool should be built.
HikariDataSource is the running pool-facing DataSource.
```

Prinsip penting:

```text
After the pool starts, treat pool configuration as operational state, not casual mutable application state.
```

Beberapa property dapat terekspos melalui JMX/MXBean, tetapi arsitektur aplikasi yang baik tidak mengandalkan perubahan konfigurasi pool secara sembarangan pada runtime kecuali memang ada operational control yang jelas.

---

## 7. HikariDataSource: Boundary yang Dilihat Aplikasi

Aplikasi biasanya hanya melihat:

```java
DataSource dataSource;
```

Walaupun implementasinya:

```java
HikariDataSource
```

Itu bagus karena repository/service tidak perlu tahu detail HikariCP.

Contoh desain yang baik:

```java
public final class CaseRepository {
    private final DataSource dataSource;

    public CaseRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource);
    }

    public CaseRecord findById(long id) throws SQLException {
        String sql = """
            select id, status, assigned_to, updated_at
            from cases
            where id = ?
            """;

        try (Connection connection = dataSource.getConnection();
             PreparedStatement ps = connection.prepareStatement(sql)) {

            ps.setLong(1, id);

            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                return mapCase(rs);
            }
        }
    }
}
```

Repository cukup bergantung pada `DataSource`, bukan `HikariDataSource`.

Kenapa?

1. Test lebih mudah.
2. Pool bisa diganti.
3. Kode domain tidak tercampur konfigurasi infrastructure.
4. Boundary JDBC lebih bersih.

---

## 8. Apa yang Terjadi Saat HikariDataSource Dibuat?

Secara konseptual:

```text
new HikariDataSource(config)
    -> validate configuration
    -> initialize pool
    -> possibly create initial connections depending on config
    -> start housekeeping/scheduled tasks
    -> expose DataSource API
```

Namun detail timing bergantung pada konfigurasi seperti:

- `initializationFailTimeout`
- `minimumIdle`
- `maximumPoolSize`
- driver behavior
- database availability

Dua mode konseptual:

### 8.1 Fail Fast

Aplikasi gagal start jika pool tidak bisa memperoleh connection awal.

Cocok untuk:

```text
- service yang tidak berguna tanpa database
- environment production dengan orchestration restart
- deployment yang harus gagal jelas jika secret/URL/DB salah
```

### 8.2 Lazy/Lenient Initialization

Aplikasi dapat start walaupun DB sementara belum siap, lalu connection dibuat saat dibutuhkan.

Cocok untuk sebagian kasus:

```text
- local development
- optional database feature
- app yang punya mode degradasi
```

Namun di production, terlalu lenient bisa menyembunyikan misconfiguration sampai traffic masuk.

---

## 9. Apa yang Terjadi Saat getConnection() Dipanggil?

Kode aplikasi:

```java
Connection connection = dataSource.getConnection();
```

Secara mental model:

```text
1. Application thread asks pool for a connection.
2. Pool checks whether an idle PoolEntry is available.
3. If available, pool marks it as in-use.
4. Pool wraps physical connection in a proxy logical connection.
5. Proxy connection is returned to application.
6. Application uses it as java.sql.Connection.
```

Jika tidak ada idle connection:

```text
1. If total connections < maximumPoolSize, pool may create a new physical connection.
2. If total connections == maximumPoolSize, caller waits up to connectionTimeout.
3. If timeout is exceeded, getConnection() fails.
```

Diagram:

```text
Thread A
  |
  | getConnection()
  v
HikariPool
  |
  +-- idle available? yes -> borrow immediately
  |
  +-- idle available? no
       |
       +-- can create? yes -> create physical connection -> return proxy
       |
       +-- can create? no  -> wait -> timeout or borrow later
```

Kesimpulan penting:

```text
connectionTimeout is not database query timeout.
connectionTimeout is the maximum time waiting to acquire a connection from the pool.
```

---

## 10. Logical Connection vs Physical Connection

Ini inti HikariCP.

Physical connection:

```text
Actual driver connection connected to database session.
```

Logical/proxy connection:

```text
Object returned to application that implements java.sql.Connection.
close() returns the underlying physical connection to the pool.
```

Diagram:

```text
Application receives:

    ProxyConnection
        implements java.sql.Connection
        delegates most calls to physical connection
        intercepts close()
        tracks dirty state
        tracks open statements
        participates in leak detection/metrics

ProxyConnection wraps:

    DriverConnection
        actual vendor JDBC connection
        actual socket/session/protocol object
```

Mengapa proxy diperlukan?

1. Agar `close()` bisa berarti return-to-pool.
2. Agar HikariCP bisa reset state sebelum connection dipakai ulang.
3. Agar HikariCP bisa melacak usage time.
4. Agar HikariCP bisa mendeteksi leak.
5. Agar HikariCP bisa menutup statement yang masih terbuka jika perlu.
6. Agar metrics bisa dikumpulkan.

---

## 11. Kenapa close() Tidak Boleh Dilewatkan

Dengan pool, sebagian developer berpikir:

```text
Karena connection dipool, tidak apa-apa tidak close.
```

Ini salah total.

Justru pada pooled environment, `close()` adalah cara mengembalikan connection ke pool.

Jika tidak close:

```text
borrowed connection remains active
pool thinks connection is still in use
other threads cannot use it
pending threads grow
eventually getConnection() times out
```

Bug ini sering muncul sebagai:

```text
java.sql.SQLTransientConnectionException: ... Connection is not available, request timed out after ... ms
```

Padahal root cause-nya bisa:

```text
- missing try-with-resources
- long transaction
- blocked query
- code path exception sebelum close
- streaming ResultSet keluar dari scope
- transaction manager misuse
```

---

## 12. Borrow/Use/Return Lifecycle

Lifecycle ideal:

```text
borrow connection
    configure only what is needed
    execute SQL
    commit/rollback if transaction owner
return connection
    close logical connection
pool resets state
connection becomes idle again
```

Dengan code:

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setAutoCommit(false);

    try {
        updateCase(connection, command);
        insertAudit(connection, command);
        connection.commit();
    } catch (SQLException ex) {
        connection.rollback();
        throw ex;
    }
}
```

State yang harus jelas:

```text
Who owns the transaction?
Who commits?
Who rolls back?
Who closes?
Can the connection escape this method?
```

Top 1% engineer tidak hanya bertanya:

```text
Does this code work?
```

Tapi:

```text
Under exception, timeout, cancellation, and concurrent load, is the connection returned in a clean state?
```

---

## 13. State Reset: Kenapa Penting?

Karena physical connection dipakai ulang, maka state dari peminjam sebelumnya tidak boleh bocor ke peminjam berikutnya.

Contoh state connection:

- auto-commit
- transaction isolation
- read-only
- catalog
- schema
- network timeout
- holdability
- warnings
- session variables tertentu
- open statements/result sets
- uncommitted transaction

Bayangkan:

```java
try (Connection c = dataSource.getConnection()) {
    c.setReadOnly(true);
    c.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
    // execute read query
}
```

Jika state tidak direset, peminjam berikutnya bisa mendapat connection dengan:

```text
readOnly = true
isolation = SERIALIZABLE
```

Akibatnya:

```text
- write tiba-tiba gagal
- lock lebih berat
- latency meningkat
- deadlock meningkat
- behavior susah dijelaskan
```

HikariCP menggunakan proxy dan internal tracking untuk mengembalikan state penting ke baseline konfigurasi pool.

Namun ada batas penting:

```text
HikariCP cannot magically understand every database-specific session mutation you execute manually.
```

Misalnya:

```sql
alter session set current_schema = X
set role Y
set search_path to tenant_a
set application_name = 'job-runner'
set time zone 'UTC'
create temporary table ...
```

Beberapa state bisa driver/pool reset, beberapa tidak. Karena itu session-level mutation harus diperlakukan sebagai operasi berbahaya di pooled environment.

---

## 14. Clean Connection Invariant

Invariant penting:

```text
Every borrowed connection must be returned as if it had never been borrowed,
except for committed durable database changes.
```

Lebih formal:

```text
For every borrow-return cycle:

before borrow:
    connection state == pool baseline

during use:
    application may mutate state within owned scope

before return:
    application must finish transaction and release JDBC resources

after return/reset:
    connection state must be safe for next borrower
```

Pelanggaran invariant:

```text
- open transaction
- changed schema/search_path
- changed role
- changed isolation
- changed autocommit
- pending warnings ignored
- open server cursor
- unclosed LOB stream
```

Top 1% review question:

```text
What state can this JDBC code leave behind on the session?
```

---

## 15. PoolEntry: Physical Connection + Metadata

Secara mental model, HikariCP tidak hanya menyimpan `Connection` biasa.

Ia menyimpan entry seperti:

```text
PoolEntry
    physical JDBC connection
    creation timestamp
    last access timestamp
    state: idle / in-use / removed / reserved
    expiration/lifetime info
    association with pool
```

Kenapa metadata penting?

1. Untuk tahu connection sudah terlalu tua.
2. Untuk tahu connection sedang idle atau active.
3. Untuk tahu connection harus divalidasi atau diretire.
4. Untuk metrics.
5. Untuk lifecycle close physical connection.

Tanpa metadata, pool hanya menjadi list connection biasa.

Pool production butuh state machine.

---

## 16. Concurrent Borrowing: Kenapa Pool Sulit Dibuat Sendiri

Connection pool terlihat sederhana:

```text
put connections in queue
threads take connection
threads return connection
```

Namun production reality:

```text
- many threads borrow concurrently
- many threads return concurrently
- some threads timeout while waiting
- connection creation is slow
- database may reject new connections
- connections may die while idle
- app may close DataSource while threads are waiting
- pool must retire old connections without breaking active borrowers
- metrics must stay accurate
- leak detection must avoid false positives as much as possible
```

Membuat pool sendiri hampir selalu buruk kecuali untuk eksperimen belajar.

Masalah yang tampak kecil bisa menjadi race condition:

```text
Thread A waits for connection.
Thread B returns connection.
Thread C closes pool.
Housekeeper retires connection.
Driver validates connection slowly.
Database kills idle session.
```

Pool harus menjaga state transisi tetap konsisten.

---

## 17. Fast Path Borrow

HikariCP dioptimalkan untuk common path:

```text
idle connection available -> borrow quickly -> return proxy
```

Kenapa ini penting?

Dalam aplikasi OLTP, `getConnection()` dapat dipanggil sangat sering.

Jika setiap borrow butuh lock berat, allocation besar, atau validation query mahal, maka pool sendiri menjadi bottleneck.

Target desain:

```text
Borrowing an already healthy idle connection should be cheap.
```

Namun cepat bukan berarti sembarangan.

HikariCP tetap harus mempertimbangkan:

- apakah connection masih valid
- apakah connection sudah melewati max lifetime
- apakah pool sedang shutdown
- apakah connection perlu dibuat baru
- apakah caller sudah timeout menunggu

---

## 18. Return Path

Saat aplikasi memanggil:

```java
connection.close();
```

Proxy connection melakukan kira-kira:

```text
1. Mark logical connection as closed.
2. Close/cleanup tracked statements if needed.
3. Roll back if necessary depending on state and pool semantics.
4. Reset dirty state to baseline.
5. Record usage metrics.
6. Return PoolEntry to idle bag.
7. Wake waiting borrower if any.
```

Dari sisi aplikasi:

```text
close is cheap and mandatory.
```

Dari sisi pool:

```text
close is the handoff point where correctness is restored.
```

---

## 19. Housekeeper Thread

HikariCP memiliki scheduled maintenance task yang biasa disebut housekeeper.

Perannya secara konseptual:

```text
periodically inspect pool state
retire idle connections if idleTimeout applies
retire connections that exceed maxLifetime
maintain minimumIdle if configured
perform housekeeping around pool health
```

Housekeeper bukan query optimizer.

Housekeeper bukan background healer untuk semua masalah.

Ia tidak bisa memperbaiki:

```text
- query lambat
- transaction terlalu panjang
- leaked connection yang masih dianggap active
- database saturated
- network partition yang belum terdeteksi
- application threads yang menggantung
```

Namun ia penting untuk lifecycle hygiene.

---

## 20. Max Lifetime: Kenapa Connection Harus Dipensiunkan

Physical connection tidak sebaiknya hidup selamanya.

Alasan:

1. Database dapat memiliki server-side idle/session timeout.
2. Load balancer/firewall/NAT dapat memotong idle TCP connection.
3. Database failover dapat membuat connection lama tidak valid.
4. Driver/session state jangka panjang meningkatkan risiko anomali.
5. Credential atau network policy bisa berubah.

`maxLifetime` adalah mekanisme agar connection lama dipensiunkan secara terkontrol.

Mental model:

```text
A connection should die on the pool's schedule,
not randomly during a business request.
```

Namun:

```text
maxLifetime must be shorter than database/network imposed lifetime.
```

Jika database membunuh connection pada 30 menit, dan pool baru retire pada 60 menit, maka aplikasi bisa meminjam connection yang sudah mati.

---

## 21. Idle Timeout

`idleTimeout` mengontrol berapa lama connection idle bisa tetap berada di pool sebelum boleh ditutup, dengan catatan konfigurasi lain seperti `minimumIdle` dan `maximumPoolSize`.

Mental model:

```text
idleTimeout controls resource shrinkage.
maxLifetime controls maximum age.
connectionTimeout controls borrow wait.
```

Jangan dicampur.

Contoh salah kaprah:

```text
Saya mau query timeout 5 detik, jadi saya set idleTimeout 5000.
```

Itu salah.

`idleTimeout` tidak membatasi durasi query.

---

## 22. Keepalive

`keepaliveTime` digunakan untuk menjaga idle connection tetap hidup dengan melakukan aktivitas ringan sebelum infrastruktur eksternal menganggap connection mati.

Mental model:

```text
keepalive is a preventive ping for idle connections.
```

Namun keepalive bukan pengganti:

- TCP keepalive OS
- driver socket timeout
- database HA config
- validation on borrow
- sane maxLifetime

Keepalive juga tidak boleh terlalu agresif karena bisa menciptakan noise ke database.

---

## 23. Validation Strategy

Sebelum memberikan connection ke aplikasi, pool perlu yakin connection layak dipakai.

Validasi bisa berupa:

```text
Connection.isValid(timeout)
```

atau query test seperti:

```sql
select 1
```

HikariCP umumnya mendorong penggunaan mekanisme driver JDBC modern (`isValid`) kecuali driver tertentu membutuhkan query test.

Pertimbangan:

```text
validation too often -> overhead
validation too weak  -> dead connection leaks into request path
```

Validation strategy harus mempertimbangkan:

- driver database
- network behavior
- database/server timeout
- failover behavior
- latency budget

---

## 24. Leak Detection

HikariCP menyediakan leak detection threshold.

Mental model:

```text
If a connection has been borrowed longer than threshold,
log a warning with stack trace of borrow site.
```

Ini berguna untuk menemukan:

```text
- missing close
- query terlalu lama
- transaction terlalu panjang
- blocking external call inside transaction
- streaming response sambil menahan connection
```

Namun leak detection tidak selalu berarti connection benar-benar leak.

Jika threshold 2 detik dan ada report query 10 detik, maka warning muncul walaupun connection akhirnya dikembalikan.

Jadi interpretasi:

```text
leak detection warning = connection was held longer than expected
```

Bukan otomatis:

```text
connection was never returned
```

Cara membaca:

1. Lihat stack trace borrow site.
2. Lihat durasi query/transaction.
3. Lihat active connection metric.
4. Lihat pending threads.
5. Lihat DB wait event.
6. Bedakan long legitimate usage vs actual leak.

---

## 25. Metrics Model

HikariCP dapat diekspos melalui metrics/JMX tergantung integrasi.

Metric konseptual:

```text
Active connections   = sedang dipinjam aplikasi
Idle connections     = siap dipinjam
Total connections    = active + idle
Pending threads      = thread menunggu connection
Max pool size        = batas total connection
```

Interpretasi:

```text
active high + pending high + idle zero
    -> pool saturated

active low + pending high
    -> kemungkinan borrow path/lock/validation/creation bermasalah atau metric perlu dicek

idle high + DB CPU high
    -> pool bukan bottleneck; query/workload/database mungkin bottleneck

active high + DB idle
    -> aplikasi mungkin menahan connection sambil tidak menjalankan SQL
```

Metric yang lebih berguna:

```text
connection acquisition time
connection usage time
connection creation time
connection timeout count
```

Karena jumlah connection saja tidak cukup.

---

## 26. Pool Name sebagai Observability Primitive

`poolName` terlihat sepele, tetapi penting di production.

Contoh:

```java
config.setPoolName("aceas-case-oltp-pool");
```

Nama pool yang baik membantu:

- log troubleshooting
- metrics dashboard
- multi-datasource app
- read/write split
- worker vs API pool
- tenant pool
- identifying which pool exhausted

Nama buruk:

```text
HikariPool-1
HikariPool-2
pool
main
```

Nama baik:

```text
aceas-api-oltp
aceas-report-readonly
aceas-batch-archive
case-service-write
screening-worker-read
```

---

## 27. HikariCP dan Transaction Manager

HikariCP bukan transaction manager.

Ia tidak menentukan business transaction boundary.

Dalam framework seperti Spring:

```text
Transaction manager obtains connection from DataSource
binds it to current thread/context
repository calls reuse same connection within transaction
commit/rollback occurs at transaction boundary
connection returned to pool after transaction completes
```

HikariCP tetap melakukan pooling, tetapi transaction semantics dikelola oleh transaction manager/framework.

Bahaya:

```text
- manually closing framework-managed connection
- mixing manual transaction and @Transactional carelessly
- borrowing extra connection inside existing transaction unexpectedly
- async execution inside transaction scope
```

Rule:

```text
The owner of the transaction boundary must also own commit/rollback semantics.
```

HikariCP hanya menyediakan connection.

---

## 28. HikariCP dan Statement Caching

HikariCP tidak bertujuan menjadi statement cache utama.

Prepared statement caching biasanya lebih tepat berada di:

```text
JDBC driver
or database server
```

Kenapa?

1. Driver tahu protocol/database-specific behavior.
2. Database tahu server-side prepared statement/plan cache.
3. Pool-level statement caching bisa menciptakan kompleksitas besar.
4. Cache statement lintas logical borrower rawan state/ownership problem.

Praktik umum:

```text
configure statement caching at driver/database layer if needed
use HikariCP for connection lifecycle
```

Contoh driver property bisa berbeda:

```text
PostgreSQL: prepared statement threshold/cache behavior
MySQL: cachePrepStmts, prepStmtCacheSize, useServerPrepStmts
Oracle: implicit statement cache
```

Detail ini masuk part konfigurasi/performance lanjutan.

---

## 29. HikariCP dan Blocking JDBC

JDBC tradisional bersifat blocking.

Artinya saat thread melakukan:

```java
ps.executeQuery();
```

Thread tersebut menunggu sampai driver menerima respons, timeout, atau error.

HikariCP tidak mengubah JDBC menjadi non-blocking.

Dengan virtual threads sekalipun:

```text
JDBC call tetap blocking dari sisi semantic API.
```

Virtual threads dapat mengurangi biaya thread platform, tetapi tidak menghilangkan:

- database max sessions
- pool max size
- query latency
- lock wait
- transaction duration
- connection starvation

Maka pool tetap diperlukan sebagai boundary.

```text
Virtual threads may increase request concurrency.
The database connection pool must still limit database concurrency.
```

---

## 30. Fixed Size vs Elastic Pool

Banyak engineer ingin pool sangat elastic:

```text
minimumIdle = 0
maximumPoolSize = 200
```

Dengan harapan:

```text
hemat saat idle, kuat saat spike
```

Namun connection creation bisa mahal. Saat spike, membuat connection baru secara massal dapat memperburuk latency dan membebani database.

Fixed-size atau near-fixed-size pool sering lebih predictable untuk OLTP.

Contoh:

```text
maximumPoolSize = 16
minimumIdle = 16
```

Keuntungan:

1. Latency borrow lebih stabil.
2. Connection sudah warm.
3. DB capacity lebih predictable.
4. Tidak ada storm connection creation saat traffic naik.

Kerugian:

1. Resource idle lebih banyak.
2. Kurang hemat untuk workload jarang.

Elastic pool cocok jika:

- workload jarang/sporadis
- connection creation murah
- DB session budget longgar
- spike tidak terlalu tajam
- latency awal dapat diterima

Production OLTP sering lebih suka predictable capacity daripada ilusi hemat.

---

## 31. Why Smaller Pool Can Be Faster

Ini kontra-intuitif.

Lebih banyak connection tidak selalu lebih cepat.

Database punya resource terbatas:

- CPU cores
- memory
- buffer cache
- disk IO
- network bandwidth
- lock manager
- worker process/thread
- latch/internal synchronization

Jika pool terlalu besar:

```text
more concurrent queries
    -> more context switching
    -> more lock contention
    -> more IO contention
    -> more memory pressure
    -> worse cache locality
    -> slower queries
    -> connections held longer
    -> pool pressure increases
```

Causal loop:

```text
pool too large
  -> DB overloaded
  -> queries slower
  -> connections held longer
  -> active connections remain high
  -> app opens/uses more concurrent DB work
  -> DB more overloaded
```

Pool yang lebih kecil dapat memberikan backpressure lebih awal.

```text
Better to queue briefly in application than saturate database until everyone is slow.
```

---

## 32. HikariCP sebagai Backpressure Boundary

Saat semua connection aktif dan thread baru memanggil `getConnection()`, thread tersebut menunggu sampai:

```text
- ada connection dikembalikan
- connection baru dibuat jika masih di bawah max
- connectionTimeout tercapai
```

Ini adalah bentuk backpressure.

Tanpa pool limit, aplikasi bisa membuka terlalu banyak DB sessions dan menghancurkan database.

Dengan pool limit:

```text
database concurrency is capped
excess demand waits or fails fast
```

Desain production harus memilih:

```text
Do we want requests to queue?
For how long?
When should they fail?
What error should caller see?
Should upstream retry?
Will retry amplify load?
```

HikariCP menyediakan primitive. Aplikasi tetap harus mendesain policy.

---

## 33. Pool Exhaustion: Symptom, Not Root Cause

Saat muncul:

```text
Connection is not available, request timed out
```

Jangan langsung menaikkan `maximumPoolSize`.

Kemungkinan root cause:

1. Query lambat.
2. Lock wait.
3. Deadlock/retry storm.
4. Connection leak.
5. Transaction terlalu panjang.
6. External HTTP call dilakukan di dalam transaction.
7. Batch job memakai pool OLTP.
8. Report query mengambil semua connection.
9. DB CPU/IO saturated.
10. Database connection limit tercapai.
11. Network timeout menggantung.
12. Pool terlalu kecil untuk workload valid.

Urutan diagnosis:

```text
pending threads?
active connections?
usage time?
acquisition time?
DB active sessions?
slow queries?
lock waits?
leak detection logs?
thread dumps?
recent deployment/config changes?
```

Baru setelah itu bicara pool size.

---

## 34. HikariCP Tidak Menyembuhkan Query Buruk

Jika query:

```sql
select * from audit_trail
where lower(description) like '%keyword%'
order by created_date_time desc
```

terhadap tabel besar dengan CLOB/LOB dan index tidak sesuai, maka HikariCP tidak akan membuatnya cepat.

Yang terjadi:

```text
query lambat
connection held longer
active pool grows
pending threads grow
timeout occurs
```

Engineer yang salah fokus akan berkata:

```text
Naikkan maximumPoolSize.
```

Engineer yang matang akan bertanya:

```text
Why is connection usage time high?
Which SQL holds connections?
Is this OLTP pool being used for reporting?
Is the DB waiting on CPU, IO, lock, or network?
```

---

## 35. Connection Creation Path

Saat pool perlu membuat connection baru:

```text
HikariCP -> DriverDataSource/driver -> JDBC driver -> database authentication -> session initialization -> return physical connection
```

Biaya connection creation dapat mencakup:

- DNS lookup
- TCP connect
- TLS handshake
- authentication
- database process/thread allocation
- session initialization
- driver setup
- validation

Karena itu connection pooling ada.

Namun jika database lambat membuat connection, pool juga akan lambat recover dari empty/low idle condition.

Praktik:

```text
Do not rely on rapid connection creation during traffic spike unless measured.
```

---

## 36. Minimum Idle

`minimumIdle` menentukan jumlah idle connection yang pool berusaha pertahankan.

Dua model:

### 36.1 Fixed/Near-Fixed Pool

```text
minimumIdle = maximumPoolSize
```

Karakternya:

- predictable
- warm
- cocok OLTP steady traffic
- resource lebih banyak saat idle

### 36.2 Elastic Pool

```text
minimumIdle < maximumPoolSize
```

Karakternya:

- hemat idle resource
- dapat grow saat demand
- spike awal bisa lebih lambat
- connection creation path lebih sering terlihat

HikariCP sering menyarankan membiarkan `minimumIdle` tidak diset untuk fixed-size behavior default yang lebih predictable, tergantung versi/default konfigurasi yang dipakai. Dalam Spring Boot, default juga dapat dipengaruhi auto-configuration.

Prinsip:

```text
Set minimumIdle deliberately, not by copy-paste.
```

---

## 37. Pool Shutdown

`HikariDataSource` harus ditutup saat aplikasi shutdown:

```java
dataSource.close();
```

Dalam framework seperti Spring Boot, lifecycle ini biasanya dikelola container.

Shutdown konseptual:

```text
1. Stop accepting new borrows.
2. Close idle physical connections.
3. Wait/handle active borrowed connections according to lifecycle.
4. Close pool resources/schedulers.
```

Jika DataSource dibuat manual, pemilik object harus menutupnya.

Anti-pattern:

```java
public Connection getConnection() {
    HikariConfig config = new HikariConfig();
    HikariDataSource ds = new HikariDataSource(config);
    return ds.getConnection();
}
```

Ini sangat buruk karena membuat pool baru setiap kali.

Rule:

```text
Create one DataSource per intended pool lifecycle.
Reuse it.
Close it on application shutdown.
```

---

## 38. Multiple Pools

Kadang satu aplikasi membutuhkan lebih dari satu pool.

Contoh:

```text
main OLTP write pool
readonly reporting pool
batch worker pool
audit archive pool
```

Keuntungan:

1. Bulk/reporting tidak menghabiskan connection OLTP.
2. Timeout bisa berbeda.
3. Pool size bisa berbeda.
4. Credentials bisa berbeda.
5. Read-only routing lebih eksplisit.
6. Failure domain lebih terisolasi.

Kerugian:

1. Total DB connection budget meningkat.
2. Config lebih kompleks.
3. Transaction lintas pool tidak otomatis atomic.
4. Monitoring harus lebih rapi.

Rule:

```text
Use multiple pools to isolate workload classes, not because configuration is messy.
```

---

## 39. HikariCP dalam Kubernetes/Microservices

Dalam Kubernetes, pool size harus dikalikan jumlah pod.

Jika:

```text
maximumPoolSize = 20
replicas = 10
```

Maka potensi connection:

```text
20 * 10 = 200 database connections
```

Jika ada 5 microservices masing-masing 10 pod:

```text
5 * 10 * 20 = 1000 potential connections
```

Pool size yang tampak kecil per service bisa besar secara platform.

Pertanyaan production:

```text
What is the total database connection budget across all pods and services?
```

Bukan hanya:

```text
What is maxPoolSize in this application.yml?
```

---

## 40. HikariCP dan Database Failover

HikariCP dapat mendeteksi connection invalid melalui validation/exception path dan membuat connection baru.

Namun failover behavior terutama bergantung pada:

- JDBC driver
- database HA feature
- connection URL
- DNS behavior
- TCP timeout
- socket timeout
- validation timeout
- maxLifetime
- keepalive
- app retry policy

HikariCP bukan universal HA layer.

Contoh:

```text
Database primary failover occurs.
Existing physical connections become invalid.
Borrowed requests fail.
Pool retires broken connections as they are detected.
New borrows eventually create connections to new primary if driver/URL resolves correctly.
Application must decide retry boundary.
```

Top 1% concern:

```text
Can this operation be safely retried after connection failure?
Was commit outcome known or unknown?
```

Pool recovery tidak sama dengan business operation recovery.

---

## 41. HikariCP dan Credential Rotation

Credential rotation dapat memengaruhi pool.

Scenario:

```text
DB password changes.
Existing physical connections may continue to work until closed.
New connection creation fails if app still has old password.
```

Akibat:

```text
pool appears healthy while idle connections exist
then starts failing when it needs to create replacement connections
```

Desain rotation harus menjawab:

1. Bagaimana secret diperbarui di aplikasi?
2. Apakah DataSource perlu direstart?
3. Apakah pool bisa rebuild dengan credential baru?
4. Apa urutan rotasi DB user/password?
5. Berapa maxLifetime agar old connection retired?
6. Bagaimana monitoring connection creation failure?

HikariCP tidak otomatis membaca ulang secret dari secret manager kecuali aplikasi/framework membangun mekanismenya.

---

## 42. Request Boundary Support dan JDBC 4.3

JDBC modern mengenal request boundary melalui method seperti `beginRequest()` dan `endRequest()` pada `Connection`.

Konsepnya:

```text
A logical request starts using a connection.
A logical request ends using that connection.
Driver/database may use this signal for request-scoped behavior.
```

Pada database/driver tertentu, request boundary dapat membantu fitur availability/replay atau session cleanup.

Namun ini bukan pengganti transaction boundary.

```text
request boundary != commit/rollback
request boundary != HTTP request automatically
request boundary != distributed tracing span
```

HikariCP versi modern memiliki dukungan terkait request boundary pada konteks tertentu, tetapi nilainya bergantung pada driver dan database.

---

## 43. HikariCP dan Oracle UCP: Kapan HikariCP Tidak Cukup?

HikariCP adalah general-purpose pool.

Untuk Oracle Database dengan kebutuhan mission-critical tertentu, Oracle UCP menyediakan fitur Oracle-specific seperti:

- RAC integration
- Runtime Load Balancing
- Fast Connection Failover
- Application Continuity / Transparent Application Continuity integration
- DRCP integration
- XA-oriented capabilities
- deeper Oracle HA semantics

HikariCP tetap valid untuk banyak aplikasi Oracle, terutama jika kebutuhan HA tidak membutuhkan fitur Oracle-specific yang advanced.

Decision question:

```text
Do we need a fast general-purpose JDBC pool,
or do we need database-vendor-specific HA semantics?
```

Jangan memilih pool hanya karena benchmark umum. Pilih berdasarkan failure mode yang harus ditangani.

---

## 44. Anti-Pattern: Treating HikariCP as Magic Spring Boot Default

Banyak aplikasi memakai HikariCP karena Spring Boot default.

Anti-pattern:

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 100
      minimum-idle: 100
      connection-timeout: 30000
```

Tanpa tahu:

- jumlah pod
- DB max sessions
- query latency
- transaction duration
- lock profile
- timeout budget
- workload split

HikariCP default bukan alasan untuk tidak memahami pool.

Spring Boot membuat penggunaan mudah, bukan membuat capacity planning otomatis benar.

---

## 45. Anti-Pattern: One Pool for Everything

Satu pool untuk:

- API OLTP
- scheduled batch
- report export
- data migration
- audit search
- event sync
- reconciliation job

sering menyebabkan starvation.

Contoh:

```text
Report export uses 10 long-running connections.
Pool maximum is 10.
API requests cannot borrow connection.
User-facing system appears down.
```

Solusi bukan selalu menaikkan pool ke 50.

Solusi bisa:

```text
separate reporting pool
limit report concurrency
use read replica
stream carefully
precompute report
move export to async job
set different timeout
```

---

## 46. Anti-Pattern: External Call While Holding DB Connection

Contoh buruk:

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);

    updateCase(c, command);

    // BAD: external HTTP call while transaction and connection are open
    notificationClient.send(command);

    insertAudit(c, command);
    c.commit();
}
```

Masalah:

```text
DB connection held during network call
transaction open longer
locks held longer
pool active time increases
failure handling becomes ambiguous
```

Lebih baik:

```text
transaction:
    update DB
    insert outbox event
    commit

after commit:
    async dispatcher sends notification
```

Pool health sering rusak bukan karena SQL banyak, tetapi karena connection ditahan saat aplikasi melakukan hal non-DB.

---

## 47. Anti-Pattern: Oversized Pool as Retry Compensation

Kadang pool dinaikkan karena retry storm:

```text
DB slow -> request timeout -> upstream retry -> more requests -> more DB work -> pool exhausted
```

Menaikkan pool dapat memperburuk storm.

Lebih baik:

```text
bounded retry
circuit breaker
shorter timeout budget
idempotency key
bulkhead pool
load shedding
query optimization
```

HikariCP memberi sinyal pressure melalui pending/acquisition timeout. Jangan selalu menonaktifkan sinyal itu dengan pool besar.

---

## 48. Production Invariants untuk HikariCP

Gunakan invariant berikut saat review sistem:

### 48.1 Pool Capacity Invariant

```text
sum(maximumPoolSize across all app instances) <= database connection budget
```

### 48.2 Transaction Duration Invariant

```text
connection usage time should roughly match DB work time,
not include unrelated external work.
```

### 48.3 Clean Return Invariant

```text
connections are returned with no open transaction, no leaked resources,
and no unsafe session state mutation.
```

### 48.4 Timeout Ordering Invariant

```text
connection acquisition timeout < request timeout
query/statement timeout fits within request timeout
socket timeout prevents indefinite blocking
transaction timeout fits business expectation
```

### 48.5 Workload Isolation Invariant

```text
long-running workload must not starve latency-sensitive workload.
```

### 48.6 Observability Invariant

```text
for every pool, we can see active, idle, pending,
acquisition time, usage time, creation time, and timeout/error count.
```

---

## 49. Example: Minimal Plain Java HikariCP Setup

```java
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;

public final class HikariPlainJavaExample {

    public static void main(String[] args) throws SQLException {
        HikariConfig config = new HikariConfig();
        config.setPoolName("example-main-oltp");
        config.setJdbcUrl("jdbc:postgresql://localhost:5432/example");
        config.setUsername("app_user");
        config.setPassword("app_password");
        config.setMaximumPoolSize(10);
        config.setConnectionTimeout(Duration.ofSeconds(3).toMillis());
        config.setMaxLifetime(Duration.ofMinutes(25).toMillis());

        try (HikariDataSource dataSource = new HikariDataSource(config)) {
            runQuery(dataSource, 1001L);
        }
    }

    static void runQuery(DataSource dataSource, long caseId) throws SQLException {
        String sql = """
            select id, status
            from cases
            where id = ?
            """;

        try (Connection connection = dataSource.getConnection();
             PreparedStatement ps = connection.prepareStatement(sql)) {

            ps.setLong(1, caseId);

            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    long id = rs.getLong("id");
                    String status = rs.getString("status");
                    System.out.printf("case=%d status=%s%n", id, status);
                }
            }
        }
    }
}
```

Catatan:

```text
try-with-resources on HikariDataSource -> close pool at application shutdown
try-with-resources on Connection       -> return logical connection to pool
try-with-resources on PreparedStatement/ResultSet -> release JDBC resources
```

---

## 50. Example: Bad vs Good Transaction Scope

### 50.1 Bad

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);

    CaseData data = loadCase(c, caseId);

    // External service call while holding DB connection and transaction.
    RiskScore score = riskService.calculate(data);

    updateRiskScore(c, caseId, score);
    c.commit();
}
```

Masalah:

```text
riskService.calculate may take 500ms, 5s, or fail
connection is held during that time
transaction is open during that time
locks/snapshot/resources may be held during that time
```

### 50.2 Better

```java
CaseData data;

try (Connection c = dataSource.getConnection()) {
    data = loadCase(c, caseId);
}

RiskScore score = riskService.calculate(data);

try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);
    try {
        updateRiskScore(c, caseId, score);
        insertAudit(c, caseId, "RISK_SCORE_UPDATED");
        c.commit();
    } catch (SQLException ex) {
        c.rollback();
        throw ex;
    }
}
```

Lebih baik lagi untuk consistency tertentu:

```text
use optimistic locking/version check
or transactional outbox
or state transition guard
```

Tergantung requirement.

---

## 51. Example: Regulatory Case Workflow Pool Thinking

Misal operasi:

```text
Officer claims case.
System validates current status.
System changes assignee.
System inserts audit trail.
System emits event.
```

Naive implementation:

```text
open connection
begin transaction
select case
call external identity/profile service
update case
insert audit CLOB
publish RabbitMQ event
commit
close connection
```

Masalah:

```text
external service and RabbitMQ publish happen while DB connection is held
transaction outcome and event outcome can diverge
connection usage time includes non-DB work
pool pressure increases under latency spike
```

Better architecture:

```text
open connection
begin transaction
select case for update / optimistic guard
validate allowed transition
update case
insert audit row
insert outbox event
commit
close connection

separate dispatcher reads outbox and publishes event
```

HikariCP implication:

```text
Connection usage time becomes bounded by actual DB transaction work.
Pool throughput improves.
Failure recovery is cleaner.
```

---

## 52. HikariCP Failure Model

HikariCP can fail in several places:

### 52.1 During Pool Initialization

```text
invalid JDBC URL
wrong driver
wrong credential
database unavailable
network unavailable
validation failure
```

### 52.2 During Borrow

```text
pool exhausted
connection creation fails
borrow timeout
pool shutdown
validation fails repeatedly
```

### 52.3 During Use

```text
query timeout
connection reset
database kills session
failover disconnect
socket read timeout
transaction aborted
```

### 52.4 During Return

```text
rollback fails
state reset fails
physical connection determined broken
connection closed instead of returned idle
```

### 52.5 During Housekeeping

```text
connection retired
idle connection closed
new connection creation fails
clock/system scheduling delay
```

Aplikasi harus mengerti bahwa tidak semua error dari `getConnection()` sama dengan query error.

---

## 53. Error Boundary: Acquisition vs Execution

Dua jenis error harus dibedakan:

### 53.1 Acquisition Error

Terjadi saat:

```java
Connection c = dataSource.getConnection();
```

Makna:

```text
application could not get a usable connection
```

Kemungkinan:

- pool exhausted
- DB down
- credential invalid
- connection creation timeout
- validation failure

### 53.2 Execution Error

Terjadi saat:

```java
ps.executeQuery();
ps.executeUpdate();
connection.commit();
```

Makna:

```text
connection was obtained, but SQL/transaction operation failed
```

Kemungkinan:

- SQL syntax
- constraint violation
- deadlock
- lock timeout
- query timeout
- connection dropped during query
- unknown commit result

Retry policy berbeda.

---

## 54. HikariCP Operational Checklist

Untuk setiap pool, jawab:

```text
1. Apa nama pool ini?
2. Workload apa yang memakai pool ini?
3. Berapa maximumPoolSize?
4. Berapa jumlah pod/instance?
5. Berapa total potential DB connections?
6. Berapa DB max sessions/connections?
7. Apakah minimumIdle disengaja?
8. Apakah maxLifetime lebih pendek dari DB/network timeout?
9. Apakah keepalive diperlukan?
10. Apakah connectionTimeout lebih kecil dari request timeout?
11. Apakah query timeout diatur di layer lain?
12. Apakah leakDetectionThreshold aktif di non-prod/load test?
13. Apakah metrics aktif?
14. Apakah active/idle/pending terlihat di dashboard?
15. Apakah slow query bisa dikorelasikan dengan pool usage?
16. Apakah long-running workload terisolasi?
17. Apakah failover/DB restart pernah diuji?
18. Apakah credential rotation pernah diuji?
```

---

## 55. Mental Model Summary

Ringkasan:

```text
HikariDataSource is the public pool-backed DataSource.
HikariConfig describes the pool.
HikariPool manages physical connection lifecycle.
Application receives proxy logical connections.
close() returns connection to pool, not necessarily database.
Pool size caps database concurrency.
Pool exhaustion is a symptom, not a diagnosis.
State reset protects next borrower from previous borrower.
Housekeeper maintains lifecycle hygiene.
maxLifetime retires old connections before infrastructure does.
keepalive prevents idle death in selected scenarios.
metrics reveal pressure and misuse.
HikariCP is not a transaction manager, ORM, query optimizer, or HA framework.
```

One sentence:

```text
HikariCP makes connection reuse fast and safe, but it cannot make unsafe database usage correct.
```

---

## 56. What Top 1% Engineers Internalize

A strong engineer using HikariCP understands:

1. Pool size is a capacity decision, not a random config.
2. Connection usage time is often more important than connection count.
3. A pool protects the database from unlimited concurrency.
4. Too many connections can reduce throughput.
5. `close()` is a semantic return-to-pool operation.
6. Connection state must not leak between borrowers.
7. External calls inside DB transaction are pool killers.
8. Long-running reporting and OLTP should often be isolated.
9. Pool metrics must be correlated with database wait events.
10. Failover recovery requires driver/database/app retry design, not just pool config.
11. Spring Boot default does not eliminate the need for operational understanding.
12. HikariCP is intentionally simple; do not demand it solve the wrong layer.

---

## 57. References

- HikariCP GitHub README: https://github.com/brettwooldridge/HikariCP
- HikariCP Wiki — About Pool Sizing: https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing
- HikariCP Javadoc: https://www.javadoc.io/doc/com.zaxxer/HikariCP
- Oracle Developers Blog — HikariCP Best Practices for Oracle Database and Spring Boot: https://blogs.oracle.com/developers/hikaricp-best-practices-for-oracle-database-and-spring-boot
- Java SE `DataSource`: https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/javax/sql/DataSource.html
- Java SE `Connection`: https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Connection.html

---

## 58. Penutup Part 019

Part ini membangun mental model HikariCP sebagai:

```text
connection lifecycle manager + concurrency boundary + pool observability source
```

Kita belum membahas semua property konfigurasi secara detail. Itu sengaja ditahan agar konsep arsitektur tidak tercampur dengan hafalan parameter.

Part berikutnya:

```text
Part 020 — HikariCP Configuration Deep Dive
```

Di sana kita akan membedah:

- `jdbcUrl`
- `dataSourceClassName`
- `maximumPoolSize`
- `minimumIdle`
- `connectionTimeout`
- `idleTimeout`
- `maxLifetime`
- `keepaliveTime`
- `validationTimeout`
- `initializationFailTimeout`
- `connectionTestQuery`
- `autoCommit`
- `readOnly`
- `transactionIsolation`
- `schema`
- `catalog`
- `poolName`
- `leakDetectionThreshold`
- `dataSourceProperties`
- `allowPoolSuspension`
- `registerMbeans`
- dangerous combinations
- production configuration patterns

Status seri:

```text
Part 019 selesai.
Seri belum selesai.
Masih lanjut ke Part 020 sampai Part 029.
```
