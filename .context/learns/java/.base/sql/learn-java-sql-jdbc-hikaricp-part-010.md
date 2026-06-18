# learn-java-sql-jdbc-hikaricp-part-010

# Resource Lifecycle: Closing, Try-With-Resources, Leaks, and Ownership

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `010 / 029`  
> Level: Advanced  
> Fokus: lifecycle resource JDBC, ownership, `try-with-resources`, leak, close semantics, pooled connection, suppressed exception, dan diagnosis production.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Memahami bahwa objek JDBC bukan sekadar object Java biasa, tetapi handle terhadap resource eksternal.
2. Membedakan ownership antara `Connection`, `Statement`, `PreparedStatement`, `CallableStatement`, `ResultSet`, stream LOB, dan object vendor-specific.
3. Menulis kode JDBC yang aman dari leak menggunakan `try-with-resources`.
4. Memahami urutan close yang benar dan kenapa urutan itu penting.
5. Memahami arti `close()` pada pooled connection seperti HikariCP.
6. Mendesain boundary repository/service supaya resource tidak bocor ke layer lain.
7. Menghindari anti-pattern seperti mengembalikan `ResultSet` dari DAO, menyimpan `Connection` sebagai field, atau melakukan lazy stream tanpa lifecycle owner yang jelas.
8. Mendiagnosis gejala production seperti pool exhaustion, open cursor exceeded, idle-in-transaction, connection leak, dan thread menunggu koneksi.
9. Memahami bagaimana exception saat close diperlakukan oleh `try-with-resources`, termasuk suppressed exception.
10. Membentuk mental model resource lifecycle yang akan menjadi fondasi untuk HikariCP, transaction, timeout, dan observability pada part berikutnya.

---

## 1. Kenapa Resource Lifecycle JDBC Layak Dibahas Serius?

Banyak engineer menganggap JDBC lifecycle sederhana:

```java
Connection c = dataSource.getConnection();
PreparedStatement ps = c.prepareStatement(sql);
ResultSet rs = ps.executeQuery();
...
c.close();
```

Secara API memang terlihat sederhana. Tetapi secara runtime, baris-baris itu bisa melibatkan:

1. koneksi TCP ke database,
2. database session,
3. transaction state,
4. server cursor,
5. prepared statement handle,
6. buffer row di client driver,
7. buffer row di database server,
8. memory native/heap,
9. lock yang masih dipegang,
10. temporary segment,
11. LOB locator,
12. pool slot,
13. thread aplikasi yang menunggu resource lain.

Maka `close()` bukan formalitas. `close()` adalah mekanisme pelepasan kontrak antara aplikasi Java, JDBC driver, connection pool, dan database.

Di sistem kecil, salah lifecycle mungkin hanya menghasilkan warning. Di sistem production dengan traffic tinggi, salah lifecycle bisa menjadi:

- pool exhaustion,
- database max session reached,
- open cursor exceeded,
- transaction menggantung,
- lock tidak dilepas,
- memory naik perlahan,
- CPU database melonjak karena session zombie,
- request timeout massal,
- retry storm,
- cascading failure antar service.

Top 1% engineer bukan hanya tahu “pakai try-with-resources”. Ia tahu **kenapa scope resource harus mengikuti scope business operation dan transaction boundary**.

---

## 2. Mental Model: JDBC Object Adalah Handle, Bukan Data Murni

Objek seperti `Connection`, `Statement`, dan `ResultSet` adalah object Java, tetapi tidak boleh diperlakukan seperti POJO biasa.

Secara konseptual:

```text
Java Object            External Thing It Represents
------------------------------------------------------------
Connection             DB session / pooled logical connection
Statement              executable command handle
PreparedStatement      prepared command + parameter binder
CallableStatement      procedure/function call handle
ResultSet              cursor/fetch stream over query result
Blob/Clob              LOB locator or materialized LOB handle
InputStream/Reader     active stream over DB/driver data
```

Artinya, object Java tersebut memiliki hubungan dengan resource di luar heap Java.

Contoh:

```java
ResultSet rs = statement.executeQuery("select * from audit_trail");
```

`rs` bukan `List<Row>`. Ia bisa merepresentasikan cursor aktif yang masih perlu fetch row dari database. Jika kamu lupa menutupnya, database/driver mungkin tetap mempertahankan state cursor.

`Connection` juga bukan hanya object pembungkus URL. Dokumentasi Java menyebut `Connection` sebagai session dengan database; statement dieksekusi dan result dikembalikan dalam konteks connection tersebut. Jadi ketika connection belum ditutup/dikembalikan, session state dan pool slot masih aktif.

---

## 3. Core Invariant: Yang Membuka Resource Bertanggung Jawab Menutup Resource

Invariant pertama:

> Pemilik lifecycle adalah code yang membuka resource, kecuali ownership secara eksplisit dipindahkan.

Contoh benar:

```java
public User findById(long id) throws SQLException {
    String sql = "select id, username, status from users where id = ?";

    try (Connection con = dataSource.getConnection();
         PreparedStatement ps = con.prepareStatement(sql)) {

        ps.setLong(1, id);

        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return null;
            }
            return mapUser(rs);
        }
    }
}
```

Di sini method membuka:

- `Connection`,
- `PreparedStatement`,
- `ResultSet`.

Maka method yang sama menutup semuanya.

Contoh buruk:

```java
public ResultSet findUsers() throws SQLException {
    Connection con = dataSource.getConnection();
    PreparedStatement ps = con.prepareStatement("select * from users");
    return ps.executeQuery();
}
```

Masalahnya: siapa yang bertanggung jawab menutup `ResultSet`, `PreparedStatement`, dan `Connection`?

Caller hanya menerima `ResultSet`. Caller mungkin tidak punya reference ke `PreparedStatement` dan `Connection`. Akibatnya ownership tidak jelas.

Ini bukan sekadar masalah style. Ini bug desain.

---

## 4. Resource Hierarchy: Connection > Statement > ResultSet

Secara praktis, resource JDBC membentuk hirarki:

```text
Connection
  └── Statement / PreparedStatement / CallableStatement
        └── ResultSet
```

Konsekuensinya:

1. `ResultSet` bergantung pada statement yang membuatnya.
2. `Statement` bergantung pada connection.
3. Jika parent ditutup, child biasanya ikut tidak valid.
4. Menutup child lebih dulu biasanya lebih eksplisit dan lebih aman.

Urutan close yang disarankan:

```text
ResultSet -> Statement -> Connection
```

`try-with-resources` menutup resource dalam urutan kebalikan dari deklarasi.

Contoh:

```java
try (Connection con = dataSource.getConnection();
     PreparedStatement ps = con.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {

    while (rs.next()) {
        // map row
    }
}
```

Urutan close otomatis:

```text
rs.close()
ps.close()
con.close()
```

Ini alasan deklarasi resource biasanya dibuat dari parent ke child.

---

## 5. `try-with-resources`: Bukan Gula Sintaks, Tapi Safety Contract

Java `try-with-resources` menutup semua resource yang mengimplementasikan `AutoCloseable` saat block selesai, baik selesai normal maupun karena exception.

Objek JDBC utama seperti `Connection`, `Statement`, dan `ResultSet` mengimplementasikan `AutoCloseable`, sehingga cocok dipakai dalam pattern ini.

Pattern dasar:

```java
try (Connection con = dataSource.getConnection()) {
    // use connection
}
```

Pattern lengkap:

```java
String sql = "select id, name from customer where status = ?";

try (Connection con = dataSource.getConnection();
     PreparedStatement ps = con.prepareStatement(sql)) {

    ps.setString(1, "ACTIVE");

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            long id = rs.getLong("id");
            String name = rs.getString("name");
            // process row
        }
    }
}
```

Kenapa `ResultSet` sering dibuat dalam nested try?

Karena `executeQuery()` bukan expression yang bisa dideklarasikan sebelum parameter diset.

Kamu tidak bisa melakukan ini untuk prepared statement yang butuh bind parameter:

```java
try (Connection con = dataSource.getConnection();
     PreparedStatement ps = con.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) { // parameter belum diset
    ...
}
```

Maka pattern aman:

```java
try (Connection con = dataSource.getConnection();
     PreparedStatement ps = con.prepareStatement(sql)) {

    ps.setLong(1, id);

    try (ResultSet rs = ps.executeQuery()) {
        ...
    }
}
```

---

## 6. Suppressed Exception: Bug yang Sering Hilang dari Log

`try-with-resources` punya perilaku penting: jika exception terjadi di body dan exception lain terjadi saat `close()`, exception saat close akan menjadi **suppressed exception**.

Contoh:

```java
try (Connection con = dataSource.getConnection();
     PreparedStatement ps = con.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {

    throw new IllegalStateException("mapping failed");
}
```

Jika `rs.close()` atau `ps.close()` juga gagal, exception utama tetap `IllegalStateException`, sedangkan exception close masuk ke `getSuppressed()`.

Contoh logging yang lebih baik:

```java
catch (Exception e) {
    log.error("JDBC operation failed", e);
    for (Throwable suppressed : e.getSuppressed()) {
        log.warn("Suppressed exception during resource close", suppressed);
    }
    throw e;
}
```

Dalam banyak kasus, logging framework sudah menampilkan suppressed exception jika stacktrace penuh dicetak. Tetapi jika kamu melakukan custom error wrapping buruk, suppressed exception bisa hilang.

Anti-pattern:

```java
catch (SQLException e) {
    throw new RuntimeException(e.getMessage()); // stacktrace dan suppressed hilang
}
```

Lebih baik:

```java
catch (SQLException e) {
    throw new DataAccessFailureException("Failed to query customer", e);
}
```

---

## 7. Arti `close()` pada Pooled Connection

Ini salah satu mental model terpenting.

Saat memakai pool seperti HikariCP:

```java
Connection con = dataSource.getConnection();
con.close();
```

`con.close()` **biasanya tidak menutup koneksi fisik ke database**.

Yang terjadi secara konseptual:

```text
application calls close()
        |
        v
Hikari proxy intercepts close()
        |
        v
connection state is cleaned/reset as needed
        |
        v
logical connection returned to pool
        |
        v
physical database connection remains open for reuse
```

Maka `close()` pada pooled connection lebih tepat dimaknai sebagai:

> “Saya selesai memakai koneksi ini. Kembalikan ke pool.”

Bukan:

> “Putuskan socket database sekarang.”

Inilah mengapa lupa `close()` pada pooled connection sangat fatal. Bukan hanya satu socket bocor, tetapi satu slot pool aktif terus. Jika pool size 10 dan ada 10 request lupa close, semua request berikutnya akan menunggu koneksi sampai timeout.

---

## 8. Close Tidak Selalu Sama dengan Commit atau Rollback

Jangan mengandalkan `close()` sebagai transaction manager.

Jika `autoCommit=false`, maka kode harus eksplisit:

```java
try (Connection con = dataSource.getConnection()) {
    con.setAutoCommit(false);

    try {
        // do multiple statements
        con.commit();
    } catch (Exception e) {
        con.rollback();
        throw e;
    }
}
```

Pertanyaan penting:

> Kalau connection ditutup saat transaction masih aktif, apakah driver/pool akan rollback?

Banyak pool/driver akan mencoba membersihkan state, dan rollback open transaction sebelum connection dikembalikan. Tetapi engineer yang matang tidak menjadikan ini sebagai business logic. Cleanup pool adalah safety net, bukan transaction design.

Pattern buruk:

```java
try (Connection con = dataSource.getConnection()) {
    con.setAutoCommit(false);
    updateA(con);
    updateB(con);
    // lupa commit atau rollback
}
```

Kode seperti ini membuat hasil bergantung pada cleanup behavior. Dalam production, ambiguity seperti ini berbahaya.

Rule:

```text
Jika kamu mematikan auto-commit, kamu wajib punya jalur eksplisit commit dan rollback.
```

---

## 9. Statement Close dan ResultSet Close

Menurut kontrak JDBC, `ResultSet` yang dibuat oleh `Statement` akan otomatis ditutup saat `Statement` ditutup, saat statement dieksekusi ulang, atau saat statement dipakai untuk mengambil result berikutnya dalam kondisi tertentu.

Namun, top 1% engineer tetap menulis kode eksplisit:

```java
try (ResultSet rs = ps.executeQuery()) {
    ...
}
```

Kenapa?

Karena explicit scope membuat ownership terlihat, mengurangi ketergantungan pada perilaku implisit, dan mempermudah reasoning saat ada multiple result set, streaming result, driver-specific behavior, atau error di tengah mapping.

Pattern aman:

```java
try (PreparedStatement ps = con.prepareStatement(sql)) {
    ps.setLong(1, id);
    try (ResultSet rs = ps.executeQuery()) {
        ...
    }
}
```

Pattern yang secara praktis sering berjalan, tetapi kurang eksplisit:

```java
try (PreparedStatement ps = con.prepareStatement(sql)) {
    ResultSet rs = ps.executeQuery();
    while (rs.next()) {
        ...
    }
}
```

Pada pattern kedua, `rs` kemungkinan tertutup saat `ps.close()`, tetapi scope `ResultSet` tidak terlihat sebagai resource yang dimiliki.

---

## 10. Ownership Boundary pada Layered Architecture

Di aplikasi enterprise, JDBC biasanya tersembunyi di balik repository/DAO.

Boundary yang sehat:

```text
Service method
  └── Transaction boundary
        └── Repository method
              └── JDBC resource scope
```

Repository harus mengembalikan data yang sudah dimaterialisasi ke object/domain model, bukan resource JDBC mentah.

Benar:

```java
public Optional<Customer> findCustomer(long id) throws SQLException {
    String sql = "select id, name, status from customer where id = ?";

    try (Connection con = dataSource.getConnection();
         PreparedStatement ps = con.prepareStatement(sql)) {

        ps.setLong(1, id);

        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return Optional.empty();
            }
            return Optional.of(mapCustomer(rs));
        }
    }
}
```

Buruk:

```java
public ResultSet findCustomer(long id) throws SQLException {
    Connection con = dataSource.getConnection();
    PreparedStatement ps = con.prepareStatement(sql);
    ps.setLong(1, id);
    return ps.executeQuery();
}
```

Lebih buruk lagi:

```java
class CustomerRepository {
    private Connection con;
}
```

Menyimpan `Connection` sebagai field di singleton repository hampir selalu salah karena:

1. connection tidak thread-safe untuk dipakai bebas oleh banyak request,
2. transaction state bisa bercampur,
3. session state bisa bocor,
4. lifecycle tidak jelas,
5. pool tidak bisa mengatur borrow/return dengan benar.

---

## 11. Streaming Data: Resource Scope Lebih Sulit

Kadang kita ingin memproses data besar secara streaming, misalnya export audit trail.

Naif:

```java
public Stream<AuditRow> streamAuditRows() throws SQLException {
    Connection con = dataSource.getConnection();
    PreparedStatement ps = con.prepareStatement("select * from audit_trail");
    ResultSet rs = ps.executeQuery();

    return StreamSupport.stream(new ResultSetSpliterator(rs), false)
        .map(this::mapAuditRow);
}
```

Masalah:

- Siapa menutup `ResultSet`?
- Siapa menutup `PreparedStatement`?
- Siapa mengembalikan `Connection` ke pool?
- Apa yang terjadi jika stream tidak dikonsumsi sampai selesai?
- Apa yang terjadi jika consumer exception di tengah?

Jika ingin mengembalikan `Stream`, wajib memasang close handler:

```java
public Stream<AuditRow> streamAuditRows() throws SQLException {
    Connection con = dataSource.getConnection();
    PreparedStatement ps = con.prepareStatement("select id, action from audit_trail");
    ResultSet rs = ps.executeQuery();

    Stream<AuditRow> stream = StreamSupport
        .stream(new AuditRowSpliterator(rs), false)
        .onClose(() -> closeAll(rs, ps, con));

    return stream;
}
```

Tetapi pattern ini tetap berisiko karena caller wajib melakukan:

```java
try (Stream<AuditRow> rows = repository.streamAuditRows()) {
    rows.forEach(this::process);
}
```

Jika caller lupa menutup stream, resource bocor.

Alternatif yang lebih aman adalah callback style:

```java
public void forEachAuditRow(Consumer<AuditRow> consumer) throws SQLException {
    String sql = "select id, action from audit_trail";

    try (Connection con = dataSource.getConnection();
         PreparedStatement ps = con.prepareStatement(sql);
         ResultSet rs = ps.executeQuery()) {

        while (rs.next()) {
            consumer.accept(mapAuditRow(rs));
        }
    }
}
```

Dengan callback style, repository tetap menjadi owner resource.

Trade-off:

```text
Return Stream
  + composable
  + familiar to Java API users
  - lifecycle ownership mudah bocor
  - caller wajib close
  - transaction/connection terbuka selama stream hidup

Callback
  + ownership jelas
  + resource pasti tertutup
  + cocok untuk batch/export controlled processing
  - kurang fleksibel
  - consumer logic masuk callback
```

Untuk sistem enterprise yang reliability-nya penting, callback sering lebih aman.

---

## 12. LOB Stream: Jangan Tutup Terlambat

LOB seperti `Blob`, `Clob`, `NClob`, dan stream dari database punya lifecycle lebih sensitif.

Contoh:

```java
try (Connection con = dataSource.getConnection();
     PreparedStatement ps = con.prepareStatement("select payload from document where id = ?")) {

    ps.setLong(1, id);

    try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
            try (InputStream in = rs.getBinaryStream("payload")) {
                copyToFile(in, target);
            }
        }
    }
}
```

Jangan lakukan ini:

```java
public InputStream getDocumentStream(long id) throws SQLException {
    Connection con = dataSource.getConnection();
    PreparedStatement ps = con.prepareStatement("select payload from document where id = ?");
    ps.setLong(1, id);
    ResultSet rs = ps.executeQuery();
    rs.next();
    return rs.getBinaryStream("payload");
}
```

Masalahnya sama: caller menerima stream, tetapi connection/statement/resultset masih harus hidup. Jika caller tidak menutup semua parent resource, bocor. Jika parent ditutup terlalu cepat, stream bisa gagal saat dibaca.

Untuk LOB besar, desain API harus jelas:

1. callback streaming,
2. copy ke output stream yang disediakan caller,
3. materialize ke byte array hanya jika ukuran kecil dan bounded,
4. gunakan object storage jika ukuran data sangat besar dan access pattern bukan relational.

Contoh callback output:

```java
public void writeDocumentPayload(long id, OutputStream out) throws SQLException, IOException {
    String sql = "select payload from document where id = ?";

    try (Connection con = dataSource.getConnection();
         PreparedStatement ps = con.prepareStatement(sql)) {

        ps.setLong(1, id);

        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                throw new NoSuchElementException("document not found: " + id);
            }

            try (InputStream in = rs.getBinaryStream("payload")) {
                in.transferTo(out);
            }
        }
    }
}
```

---

## 13. Multiple ResultSet dan `getMoreResults()`

Pada stored procedure atau statement yang menghasilkan multiple results, lifecycle makin rumit.

Contoh konseptual:

```java
try (CallableStatement cs = con.prepareCall("{ call report_proc(?) }")) {
    cs.setLong(1, reportId);

    boolean hasResultSet = cs.execute();

    while (true) {
        if (hasResultSet) {
            try (ResultSet rs = cs.getResultSet()) {
                while (rs.next()) {
                    // process current result set
                }
            }
        } else {
            int updateCount = cs.getUpdateCount();
            if (updateCount == -1) {
                break;
            }
        }

        hasResultSet = cs.getMoreResults(Statement.CLOSE_CURRENT_RESULT);
    }
}
```

Key point:

- Satu statement bisa menghasilkan lebih dari satu result.
- `getMoreResults()` punya mode close current/all/keep.
- Jangan mengabaikan result set tambahan jika procedure memang menghasilkannya.
- Resource cleanup harus eksplisit.

---

## 14. Anti-Pattern: Connection Dibuka Terlalu Awal

Contoh buruk:

```java
public void processRequest(Request req) throws SQLException {
    try (Connection con = dataSource.getConnection()) {
        validateRequest(req);             // CPU only
        callExternalService(req);         // network call 2 seconds
        calculateSomething(req);          // CPU only
        insertResult(con, req);           // DB work 20 ms
    }
}
```

Masalah:

- Connection dipinjam selama validasi, external call, dan kalkulasi.
- Pool slot tertahan padahal DB belum dipakai.
- Jika external service lambat, pool ikut habis.

Lebih baik:

```java
public void processRequest(Request req) throws SQLException {
    validateRequest(req);
    ExternalData data = callExternalService(req);
    Result result = calculateSomething(req, data);

    try (Connection con = dataSource.getConnection()) {
        insertResult(con, result);
    }
}
```

Rule:

```text
Pinjam connection sedekat mungkin dengan operasi database.
Kembalikan secepat mungkin setelah operasi database selesai.
```

Pengecualian: jika ada transaction yang memang harus membungkus beberapa operasi DB. Namun jangan memasukkan operasi non-DB lambat ke dalam transaction kecuali benar-benar perlu.

---

## 15. Anti-Pattern: External Call di Dalam Transaction

Contoh buruk:

```java
try (Connection con = dataSource.getConnection()) {
    con.setAutoCommit(false);

    updateCaseStatus(con, caseId, "APPROVED");

    // External call while transaction and connection are still open
    notificationClient.sendApprovalNotification(caseId);

    insertAudit(con, caseId, "APPROVED");
    con.commit();
}
```

Jika notification service lambat 5 detik, maka selama 5 detik:

- DB transaction masih terbuka,
- connection pool slot masih aktif,
- lock mungkin masih dipegang,
- row version mungkin tertahan,
- request lain bisa ikut terdampak.

Pattern lebih baik untuk banyak kasus:

```text
1. Begin transaction
2. Update business state
3. Insert outbox event
4. Commit
5. Async worker publishes notification after commit
```

JDBC resource lifecycle tidak bisa dipisahkan dari architecture. Cara kamu menempatkan connection scope menentukan failure mode sistem.

---

## 16. Anti-Pattern: `finally` Manual yang Salah

Sebelum Java 7, pattern manual seperti ini umum:

```java
Connection con = null;
PreparedStatement ps = null;
ResultSet rs = null;

try {
    con = dataSource.getConnection();
    ps = con.prepareStatement(sql);
    rs = ps.executeQuery();
    ...
} finally {
    rs.close();
    ps.close();
    con.close();
}
```

Ini bug-prone karena jika `rs` null, `rs.close()` menghasilkan `NullPointerException`, lalu `ps` dan `con` tidak ditutup.

Versi manual yang lebih aman:

```java
finally {
    closeQuietly(rs);
    closeQuietly(ps);
    closeQuietly(con);
}
```

Tetapi di Java modern, gunakan `try-with-resources`.

```java
try (Connection con = dataSource.getConnection();
     PreparedStatement ps = con.prepareStatement(sql)) {
    ...
}
```

Manual close hanya layak jika kamu menulis abstraction khusus yang memang harus mengelola lifecycle dinamis.

---

## 17. Exception Saat `close()`: Jangan Ditelan Sembarangan

Utility seperti `closeQuietly()` kadang diperlukan, tetapi berbahaya jika dipakai sembarangan.

Contoh utility:

```java
static void closeQuietly(AutoCloseable closeable) {
    if (closeable == null) {
        return;
    }
    try {
        closeable.close();
    } catch (Exception e) {
        log.warn("Failed to close resource", e);
    }
}
```

Minimal log warning. Jangan silent total.

Kenapa?

Karena close failure bisa mengindikasikan:

- network problem,
- driver problem,
- DB session already broken,
- rollback-on-close failure,
- LOB cleanup failure.

Namun jangan juga membuat close failure menutupi exception utama. Ini alasan `try-with-resources` lebih baik karena ia mempertahankan exception utama dan memasukkan close failure sebagai suppressed exception.

---

## 18. Pool Exhaustion: Gejala Paling Umum dari Connection Leak

Connection leak di pooled environment berarti aplikasi meminjam connection tetapi tidak mengembalikannya.

Gejala:

```text
- Hikari active connections naik sampai maximumPoolSize
- idle connections turun ke 0
- pending threads naik
- request latency naik
- akhirnya timeout saat getConnection()
```

Typical error:

```text
Connection is not available, request timed out after ... ms
```

Penyebab umum:

1. Lupa `close()` connection.
2. Method return sebelum close karena branch tertentu.
3. Exception terjadi sebelum close dan tidak ada `finally`/try-with-resources.
4. Stream/iterator berbasis `ResultSet` tidak ditutup.
5. Transaction manager tidak menyelesaikan transaction.
6. Connection disimpan di field/cache.
7. Thread berhenti/hang saat memegang connection.
8. External call dilakukan saat connection masih dipinjam.
9. Deadlock/lock wait lama membuat connection tampak “leak” padahal masih aktif dipakai.

Penting:

> Tidak semua “apparent leak” adalah lupa close. Bisa jadi connection memang sedang dipakai terlalu lama.

Karena itu diagnosis harus melihat:

- stack trace leak detection,
- query latency,
- transaction duration,
- thread dump,
- DB session view,
- lock wait,
- pool metrics.

---

## 19. HikariCP Leak Detection: Safety Net, Bukan Solusi

HikariCP menyediakan `leakDetectionThreshold`. Jika connection dipinjam lebih lama dari threshold, Hikari dapat mencatat warning “apparent connection leak”.

Contoh konfigurasi:

```properties
maximumPoolSize=20
connectionTimeout=30000
leakDetectionThreshold=60000
```

Makna:

```text
Jika connection dipinjam lebih dari 60 detik, log stack trace borrow point.
```

Interpretasi yang benar:

- Ini tidak membuktikan leak absolut.
- Ini menunjukkan connection dipinjam terlalu lama melebihi threshold.
- Bisa karena lupa close.
- Bisa karena query lama.
- Bisa karena lock wait.
- Bisa karena external call di dalam scope connection.
- Bisa karena streaming/export memang lama.

Jangan memasang threshold terlalu kecil di production normal, karena long-running query legitimate bisa menghasilkan noise.

Gunakan leak detection sebagai alat investigasi sementara atau guardrail terbatas, bukan pengganti lifecycle design.

---

## 20. Open Cursor Leak

Beberapa database memiliki limit cursor per session. Di Oracle misalnya, masalah “maximum open cursors exceeded” sering berkaitan dengan statement/resultset yang tidak ditutup atau statement cache yang tidak dipahami.

Gejala:

```text
ORA-01000: maximum open cursors exceeded
```

Penyebab umum:

1. `PreparedStatement` tidak ditutup.
2. `ResultSet` tidak ditutup.
3. Statement dibuat dalam loop tanpa close.
4. Reusable connection menyimpan cursor akibat statement cache/driver behavior.
5. Stored procedure membuka cursor dan tidak dikonsumsi/ditutup.

Contoh buruk:

```java
try (Connection con = dataSource.getConnection()) {
    for (long id : ids) {
        PreparedStatement ps = con.prepareStatement("select * from item where id = ?");
        ps.setLong(1, id);
        ResultSet rs = ps.executeQuery();
        // process
        // lupa close rs dan ps
    }
}
```

Benar:

```java
String sql = "select * from item where id = ?";

try (Connection con = dataSource.getConnection();
     PreparedStatement ps = con.prepareStatement(sql)) {

    for (long id : ids) {
        ps.setLong(1, id);
        try (ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                // process
            }
        }
    }
}
```

Lebih baik lagi jika query bisa dibatch atau menggunakan `where id in (...)` dengan batas yang aman.

---

## 21. Idle in Transaction: Resource Leak yang Secara Logis Lebih Berbahaya

Connection bisa tidak bocor secara teknis, tetapi transaction-nya dibiarkan terbuka terlalu lama.

Contoh:

```java
try (Connection con = dataSource.getConnection()) {
    con.setAutoCommit(false);
    updateSomething(con);

    // menunggu input, external service, atau proses panjang
    Thread.sleep(60_000);

    con.commit();
}
```

Gejala database:

```text
session idle in transaction
```

Dampak:

- lock bisa tertahan,
- vacuum/cleanup MVCC bisa terganggu,
- row version menumpuk,
- connection pool slot tertahan,
- request lain menunggu lock,
- deadlock/timeout meningkat.

Ini bukan leak object, tetapi leak transaction lifetime.

Rule:

```text
Transaction harus sesingkat mungkin, deterministic, dan tidak menunggu operasi non-DB yang tidak perlu.
```

---

## 22. Resource Scope dan Transaction Scope Harus Selaras

Ada dua scope:

```text
Resource scope     : kapan connection/statement/resultset dibuka dan ditutup
Transaction scope  : kapan commit/rollback boundary berlaku
```

Kadang sama:

```java
try (Connection con = dataSource.getConnection()) {
    con.setAutoCommit(false);
    try {
        updateA(con);
        updateB(con);
        con.commit();
    } catch (Exception e) {
        con.rollback();
        throw e;
    }
}
```

Kadang transaction scope dikelola framework, sedangkan repository hanya memakai connection yang terikat ke current transaction.

Dalam Spring misalnya, repository mungkin tidak memanggil `con.close()` langsung jika connection dikelola transaction manager. Tetapi secara mental model tetap sama: ada owner resource di atasnya.

Yang berbahaya adalah tidak tahu siapa owner-nya.

Pertanyaan desain yang harus selalu dijawab:

```text
1. Siapa membuka connection?
2. Siapa menutup/mengembalikan connection?
3. Siapa memulai transaction?
4. Siapa commit?
5. Siapa rollback?
6. Apakah ResultSet hidup melewati transaction boundary?
7. Apakah resource bisa keluar dari method ini?
```

Jika jawaban tidak jelas, desainnya rapuh.

---

## 23. Pattern: Repository Menggunakan Connection dari Caller

Untuk transaction multi-repository, repository sering menerima `Connection` dari caller.

Contoh:

```java
public void approveCase(long caseId, long actorId) throws SQLException {
    try (Connection con = dataSource.getConnection()) {
        con.setAutoCommit(false);
        try {
            caseRepository.updateStatus(con, caseId, "APPROVED");
            auditRepository.insertAudit(con, caseId, actorId, "APPROVED");
            outboxRepository.insertEvent(con, caseId, "CASE_APPROVED");
            con.commit();
        } catch (Exception e) {
            con.rollback();
            throw e;
        }
    }
}
```

Repository:

```java
public void updateStatus(Connection con, long caseId, String status) throws SQLException {
    String sql = "update regulatory_case set status = ? where id = ?";

    try (PreparedStatement ps = con.prepareStatement(sql)) {
        ps.setString(1, status);
        ps.setLong(2, caseId);
        ps.executeUpdate();
    }
}
```

Di sini repository tidak menutup `Connection`, karena ia bukan owner connection. Ia hanya menutup statement yang ia buka sendiri.

Invariant:

```text
Jika method menerima Connection dari luar, method tidak boleh close Connection itu kecuali kontraknya eksplisit mengatakan demikian.
```

---

## 24. Pattern: Repository Membuka Connection Sendiri

Untuk operasi single-query non-transactional atau auto-commit, repository bisa membuka connection sendiri.

```java
public Optional<CaseSummary> findSummary(long caseId) throws SQLException {
    String sql = "select id, status, created_at from regulatory_case where id = ?";

    try (Connection con = dataSource.getConnection();
         PreparedStatement ps = con.prepareStatement(sql)) {

        ps.setLong(1, caseId);

        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return Optional.empty();
            }
            return Optional.of(mapSummary(rs));
        }
    }
}
```

Rule:

```text
Method yang membuka Connection sendiri harus menutup Connection sendiri.
```

Jangan campur dua model tanpa jelas, misalnya kadang repository membuka connection sendiri, kadang ikut transaction caller, tapi signature-nya sama. Itu membuat transaction boundary sulit dipahami.

---

## 25. Pattern: Unit of Work Manual

Untuk plain JDBC application tanpa Spring/Jakarta transaction manager, kamu bisa membuat helper unit-of-work.

```java
@FunctionalInterface
public interface SqlWork<T> {
    T execute(Connection con) throws Exception;
}
```

```java
public <T> T inTransaction(SqlWork<T> work) throws Exception {
    try (Connection con = dataSource.getConnection()) {
        boolean originalAutoCommit = con.getAutoCommit();
        con.setAutoCommit(false);
        try {
            T result = work.execute(con);
            con.commit();
            return result;
        } catch (Exception e) {
            try {
                con.rollback();
            } catch (SQLException rollbackError) {
                e.addSuppressed(rollbackError);
            }
            throw e;
        } finally {
            try {
                con.setAutoCommit(originalAutoCommit);
            } catch (SQLException resetError) {
                // Usually log. In pooled env, pool may also reset, but do not hide it.
                log.warn("Failed to restore autoCommit", resetError);
            }
        }
    }
}
```

Pemakaian:

```java
inTransaction(con -> {
    caseRepository.updateStatus(con, caseId, "APPROVED");
    auditRepository.insert(con, caseId, "APPROVED");
    return null;
});
```

Catatan:

- Hati-hati mengubah state connection.
- Pastikan state dipulihkan atau pool melakukan reset.
- Jangan return resource hidup dari `work`.

---

## 26. Connection State Leakage

Connection pool menggunakan kembali physical connection. Maka state yang tertinggal dari peminjam sebelumnya bisa mempengaruhi peminjam berikutnya jika tidak direset.

State yang rawan bocor:

1. `autoCommit`,
2. isolation level,
3. read-only flag,
4. schema/catalog,
5. session variables,
6. temporary table,
7. role/current user setting,
8. client info,
9. lock timeout/statement timeout setting,
10. NLS/date format setting pada beberapa database.

Contoh bahaya:

```java
try (Connection con = dataSource.getConnection()) {
    con.setReadOnly(true);
    runReport(con);
}

// Jika tidak direset, borrower berikutnya bisa menerima readOnly=true
```

Pool modern seperti HikariCP berusaha menjaga/reset state tertentu. Namun engineer yang baik tetap tidak sembarangan mengubah session state tanpa mengembalikannya, terutama state vendor-specific yang tidak diketahui pool.

Pattern aman:

```java
String originalSchema = con.getSchema();
try {
    con.setSchema("tenant_a");
    runTenantQuery(con);
} finally {
    con.setSchema(originalSchema);
}
```

Untuk multi-tenant schema switching, lebih baik desain routing/pool/transaction boundary dengan sangat eksplisit.

---

## 27. Cancellation dan Resource Cleanup

Jika thread request di-cancel, timeout, atau interrupted, resource JDBC tidak otomatis selalu bersih sesuai harapan.

Contoh skenario:

```text
HTTP request timeout at API gateway after 30s
application thread still running query for 120s
connection remains active
pool slot remains active
DB query still consuming CPU/lock
```

Karena itu resource lifecycle harus dikaitkan dengan timeout design.

Beberapa mekanisme:

1. `Statement.setQueryTimeout(seconds)`.
2. Driver socket timeout.
3. Database-side statement timeout.
4. Transaction timeout dari framework.
5. Explicit `Statement.cancel()` dalam kasus tertentu.
6. Closing connection saat operation aborted.

Namun cancellation JDBC adalah topik tricky karena driver/database berbeda. Yang penting untuk part ini:

```text
Timeout tanpa cleanup bisa tetap meninggalkan resource aktif.
Cleanup tanpa timeout bisa membuat thread menunggu terlalu lama.
```

Part 022 nanti akan membahas timeout secara khusus.

---

## 28. Thread Boundary: Jangan Memindahkan Resource JDBC Sembarangan

JDBC connection, statement, dan resultset tidak dirancang untuk dipakai bebas lintas thread.

Contoh buruk:

```java
Connection con = dataSource.getConnection();
executor.submit(() -> repository.updateA(con));
executor.submit(() -> repository.updateB(con));
```

Masalah:

- race pada connection state,
- transaction boundary kacau,
- statement/resultset interleaving,
- driver tidak menjamin safety,
- debugging sangat sulit.

Rule:

```text
Satu borrowed connection sebaiknya dimiliki oleh satu logical execution flow.
```

Jika butuh parallelism, tiap task harus punya resource sendiri, dan transaction consistency harus didesain ulang.

Virtual threads tidak mengubah aturan ini. Virtual thread membuat blocking lebih murah di sisi Java scheduler, tetapi database connection tetap resource terbatas.

---

## 29. Lifecycle dalam Kubernetes dan Microservices

Dalam monolith kecil, leak 5 connection mungkin masih terlihat kecil. Dalam Kubernetes, dampaknya dikalikan jumlah pod.

Misal:

```text
maximumPoolSize = 20
replicas = 10
services = 5
```

Potensi koneksi:

```text
20 * 10 * 5 = 1000 database connections
```

Jika setiap pod punya leak kecil, total leak bisa cepat menghabiskan database session.

Karena itu lifecycle bukan isu lokal per method saja, tetapi capacity issue:

- setiap pod harus mengembalikan connection cepat,
- long-running job sebaiknya punya pool terpisah,
- readiness/liveness restart tidak boleh menjadi satu-satunya solusi leak,
- shutdown harus graceful agar resource ditutup,
- pool metrics harus dipantau per pod dan agregat.

---

## 30. Graceful Shutdown dan JDBC Resource

Saat aplikasi shutdown:

1. berhenti menerima request baru,
2. biarkan request aktif selesai dalam batas waktu,
3. hentikan scheduler/worker,
4. tutup datasource/pool,
5. lepaskan physical connection.

Untuk HikariCP, `HikariDataSource` juga perlu ditutup saat aplikasi berhenti jika lifecycle tidak dikelola framework.

Contoh plain Java:

```java
HikariDataSource ds = new HikariDataSource(config);

Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    ds.close();
}));
```

Dalam Spring Boot, datasource biasanya dikelola application context dan akan ditutup saat context shutdown.

Jangan membuat banyak `HikariDataSource` sementara tanpa menutupnya. Itu akan membuat pool fisik baru dan session database baru.

Anti-pattern:

```java
public Connection getConnection() {
    HikariDataSource ds = new HikariDataSource(config); // salah jika per call
    return ds.getConnection();
}
```

Pool harus long-lived, bukan dibuat per query.

---

## 31. Diagnostic Playbook: Ketika Pool Exhausted

Ketika muncul error connection timeout dari pool, jangan langsung menaikkan `maximumPoolSize`.

Gunakan langkah diagnosis:

### 31.1. Lihat Hikari Metrics

Periksa:

```text
active connections
idle connections
pending threads
total connections
connection acquisition time
connection usage time
```

Interpretasi awal:

```text
active=max, idle=0, pending>0
=> semua connection sedang dipinjam
```

Pertanyaan berikutnya:

```text
Dipinjam karena query lama, lock wait, external call, atau leak?
```

### 31.2. Ambil Thread Dump

Cari thread yang berada di:

- JDBC driver execute,
- socket read,
- waiting for Hikari connection,
- external HTTP call sambil memegang connection,
- application code yang memproses result besar.

### 31.3. Cek Database Session

Di database, cari:

- session aktif,
- query berjalan lama,
- lock wait,
- idle in transaction,
- blocked/blocking session,
- open cursor count,
- client application name/module jika ada.

### 31.4. Aktifkan Leak Detection Sementara

Jika belum jelas, aktifkan `leakDetectionThreshold` dengan nilai realistis.

Misalnya:

```properties
leakDetectionThreshold=60000
```

Jangan terlalu kecil seperti 2 detik jika aplikasi memang punya query valid di atas 2 detik.

### 31.5. Review Code Path

Cari pattern:

```text
getConnection tanpa try-with-resources
return sebelum close
stream dari repository
external call dalam connection scope
manual finally yang salah
connection disimpan sebagai field
transaction tanpa commit/rollback eksplisit
```

### 31.6. Baru Putuskan Tuning

Jika ternyata pool exhausted karena concurrency memang tinggi dan database masih punya headroom, barulah sizing dibahas.

Jika pool exhausted karena query lambat/leak, menaikkan pool size hanya menunda kegagalan.

---

## 32. Code Review Checklist

Gunakan checklist berikut saat review kode JDBC.

### 32.1. Connection

```text
[ ] Apakah Connection selalu ditutup/dikembalikan?
[ ] Apakah Connection dibuka sedekat mungkin dengan operasi DB?
[ ] Apakah Connection tidak disimpan sebagai field/static/global?
[ ] Apakah Connection tidak dipakai lintas thread?
[ ] Jika Connection diterima dari caller, apakah method tidak menutupnya sembarangan?
```

### 32.2. Statement

```text
[ ] Apakah Statement/PreparedStatement selalu ditutup?
[ ] Apakah statement tidak dibuat dalam loop tanpa close?
[ ] Apakah PreparedStatement direuse dalam loop jika SQL sama?
[ ] Apakah query timeout dipertimbangkan untuk operasi berisiko lama?
```

### 32.3. ResultSet

```text
[ ] Apakah ResultSet selalu ditutup?
[ ] Apakah ResultSet tidak dikembalikan keluar repository?
[ ] Apakah mapping dilakukan dalam scope ResultSet?
[ ] Apakah result besar diproses streaming dengan lifecycle jelas?
[ ] Apakah primitive getter disertai wasNull() jika null bermakna?
```

### 32.4. Transaction

```text
[ ] Jika autoCommit=false, apakah commit dan rollback eksplisit?
[ ] Apakah rollback failure tidak menutupi exception utama?
[ ] Apakah transaction scope tidak mencakup external call lambat?
[ ] Apakah state connection dikembalikan jika diubah?
```

### 32.5. Pool

```text
[ ] Apakah DataSource/pool dibuat sekali dan long-lived?
[ ] Apakah HikariDataSource ditutup saat shutdown jika dikelola manual?
[ ] Apakah leakDetectionThreshold digunakan dengan bijak?
[ ] Apakah pool metrics tersedia?
```

---

## 33. Reference Implementation: Query Single Row

```java
public Optional<UserAccount> findUserAccount(long userId) throws SQLException {
    String sql = """
        select id, username, status, created_at
        from user_account
        where id = ?
        """;

    try (Connection con = dataSource.getConnection();
         PreparedStatement ps = con.prepareStatement(sql)) {

        ps.setLong(1, userId);

        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return Optional.empty();
            }

            UserAccount account = new UserAccount(
                rs.getLong("id"),
                rs.getString("username"),
                rs.getString("status"),
                rs.getObject("created_at", java.time.OffsetDateTime.class)
            );

            if (rs.next()) {
                throw new IllegalStateException("Expected one row, got multiple rows for userId=" + userId);
            }

            return Optional.of(account);
        }
    }
}
```

Kenapa bagus:

1. semua resource ditutup,
2. mapping selesai dalam scope result set,
3. invariant one-row dicek,
4. tidak mengembalikan resource mentah,
5. connection dipinjam hanya selama query.

---

## 34. Reference Implementation: Transaction Manual Aman

```java
public void approveCase(long caseId, long actorId) throws Exception {
    try (Connection con = dataSource.getConnection()) {
        boolean originalAutoCommit = con.getAutoCommit();
        con.setAutoCommit(false);

        try {
            updateCaseStatus(con, caseId, "APPROVED");
            insertAudit(con, caseId, actorId, "CASE_APPROVED");
            insertOutboxEvent(con, caseId, "CASE_APPROVED");

            con.commit();
        } catch (Exception e) {
            try {
                con.rollback();
            } catch (SQLException rollbackFailure) {
                e.addSuppressed(rollbackFailure);
            }
            throw e;
        } finally {
            try {
                con.setAutoCommit(originalAutoCommit);
            } catch (SQLException resetFailure) {
                log.warn("Failed to restore autoCommit", resetFailure);
            }
        }
    }
}
```

Repository method:

```java
private void updateCaseStatus(Connection con, long caseId, String status) throws SQLException {
    String sql = "update regulatory_case set status = ? where id = ?";

    try (PreparedStatement ps = con.prepareStatement(sql)) {
        ps.setString(1, status);
        ps.setLong(2, caseId);

        int updated = ps.executeUpdate();
        if (updated != 1) {
            throw new IllegalStateException("Expected to update one case, updated=" + updated);
        }
    }
}
```

Key point:

- service owns connection and transaction,
- repository owns statement,
- rollback explicit,
- suppressed rollback failure preserved,
- resource returned to pool via try-with-resources.

---

## 35. Case Study: Regulatory Case Approval dengan Audit dan Outbox

Misal operasi bisnis:

```text
Approve case
  1. validate transition
  2. update case status
  3. insert audit trail
  4. insert outbox event
  5. commit
  6. event publisher sends notification asynchronously
```

Lifecycle yang benar:

```text
validate pure input before connection
borrow connection
begin transaction
execute DB writes
commit
return connection
publish external side effect after commit via outbox worker
```

Lifecycle yang buruk:

```text
borrow connection
begin transaction
call external service
wait for user/file/network
update database
commit maybe
return connection maybe
```

Dampak buruk:

- pool slot tertahan,
- transaction panjang,
- lock panjang,
- failure external service bisa menyebabkan rollback bisnis yang sebenarnya sudah valid,
- retry bisa menggandakan side effect,
- debugging sulit.

Resource lifecycle adalah bagian dari domain correctness, bukan hanya technical cleanup.

---

## 36. Common Misconceptions

### 36.1. “Kalau Connection ditutup, Statement dan ResultSet pasti aman.”

Secara umum parent close membuat child tidak valid. Tetapi jangan jadikan itu alasan untuk tidak menutup resource yang kamu buka. Explicit close membuat scope lebih jelas dan mengurangi edge case.

### 36.2. “Pooled connection tidak perlu ditutup karena pool yang mengurus.”

Salah. Justru pooled connection wajib di-`close()` agar kembali ke pool.

### 36.3. “Leak detection berarti pasti ada leak.”

Tidak selalu. Bisa jadi connection dipakai terlalu lama karena query, lock wait, streaming, atau external call di dalam scope connection.

### 36.4. “Naikkan maximumPoolSize menyelesaikan pool exhaustion.”

Kadang, tetapi sering hanya menunda masalah. Jika akar masalahnya leak atau query lambat, pool lebih besar bisa membuat database semakin terbebani.

### 36.5. “ResultSet bisa dikirim ke layer atas supaya fleksibel.”

Itu memindahkan resource ownership secara buruk. Layer atas menjadi tergantung detail JDBC dan rawan leak.

### 36.6. “`closeQuietly` membuat kode aman.”

Tidak jika exception ditelan tanpa log dan tanpa mempertahankan exception utama.

---

## 37. Practical Rules of Thumb

1. Gunakan `try-with-resources` untuk semua `Connection`, `Statement`, dan `ResultSet` yang kamu buka.
2. Jangan return `ResultSet`, `Statement`, atau `Connection` dari repository kecuali membuat API low-level dengan kontrak close yang sangat eksplisit.
3. Jangan simpan `Connection` di field singleton.
4. Jangan memegang connection saat melakukan external HTTP call, sleep, heavy CPU work, atau menunggu user input.
5. Jika `autoCommit=false`, selalu punya `commit` dan `rollback` eksplisit.
6. Jika method menerima `Connection`, method biasanya tidak boleh menutupnya.
7. Jika method membuka `Connection`, method wajib menutupnya.
8. Untuk streaming data besar, gunakan callback atau pastikan `Stream` wajib ditutup dengan `try-with-resources`.
9. Gunakan leak detection sebagai alat diagnosis, bukan desain utama.
10. Saat pool exhausted, cari root cause sebelum menaikkan pool size.

---

## 38. Mini Exercise

### Exercise 1

Temukan bug pada kode berikut:

```java
public List<Customer> findActiveCustomers() throws SQLException {
    Connection con = dataSource.getConnection();
    PreparedStatement ps = con.prepareStatement(
        "select id, name from customer where status = 'ACTIVE'"
    );
    ResultSet rs = ps.executeQuery();

    List<Customer> customers = new ArrayList<>();
    while (rs.next()) {
        customers.add(new Customer(rs.getLong(1), rs.getString(2)));
    }
    return customers;
}
```

Masalah:

- `ResultSet` tidak ditutup.
- `PreparedStatement` tidak ditutup.
- `Connection` tidak ditutup/dikembalikan ke pool.
- Jika exception terjadi di tengah, semua resource bocor.

Perbaikan:

```java
public List<Customer> findActiveCustomers() throws SQLException {
    String sql = "select id, name from customer where status = 'ACTIVE'";

    try (Connection con = dataSource.getConnection();
         PreparedStatement ps = con.prepareStatement(sql);
         ResultSet rs = ps.executeQuery()) {

        List<Customer> customers = new ArrayList<>();
        while (rs.next()) {
            customers.add(new Customer(rs.getLong(1), rs.getString(2)));
        }
        return customers;
    }
}
```

### Exercise 2

Apa masalah kode berikut?

```java
try (Connection con = dataSource.getConnection()) {
    ExternalProfile profile = profileClient.getProfile(userId);
    insertProfile(con, profile);
}
```

Masalah:

- connection dipinjam sebelum external call,
- jika external call lambat, pool slot tertahan tanpa perlu.

Perbaikan:

```java
ExternalProfile profile = profileClient.getProfile(userId);

try (Connection con = dataSource.getConnection()) {
    insertProfile(con, profile);
}
```

### Exercise 3

Apa masalah kode berikut?

```java
public Stream<Order> streamOrders() throws SQLException {
    try (Connection con = dataSource.getConnection();
         PreparedStatement ps = con.prepareStatement("select * from orders");
         ResultSet rs = ps.executeQuery()) {

        return toStream(rs).map(this::mapOrder);
    }
}
```

Masalah:

- resource ditutup sebelum stream dikonsumsi,
- caller menerima stream yang backed by closed resultset.

Solusi:

- jangan return stream seperti ini,
- gunakan callback,
- atau return stream dengan ownership close eksplisit dan jangan tutup resource sebelum stream selesai.

---

## 39. Ringkasan Mental Model

Resource lifecycle JDBC dapat diringkas sebagai:

```text
Connection adalah borrowed session handle.
Statement adalah executable command handle.
ResultSet adalah cursor/fetch handle.
Semua punya resource eksternal.
Resource harus punya owner.
Owner harus menutup resource.
Pooled close berarti return to pool.
Transaction harus selesai sebelum connection dikembalikan.
Resource scope yang terlalu panjang menciptakan latency, lock, dan pool pressure.
Resource scope yang tidak jelas menciptakan leak.
```

Top 1% JDBC engineer bukan hanya menulis:

```java
try (Connection con = ds.getConnection()) { ... }
```

Ia tahu:

- kenapa connection harus dipinjam sesingkat mungkin,
- kapan repository boleh atau tidak boleh menutup connection,
- bagaimana transaction scope berhubungan dengan resource scope,
- bagaimana streaming mengubah ownership,
- bagaimana pool exhaustion didiagnosis,
- bagaimana close failure tidak boleh menghilangkan exception utama,
- bagaimana resource lifecycle mempengaruhi reliability seluruh sistem.

---

## 40. Referensi

- Java SE API Documentation — `java.sql.Connection`, `Statement`, `ResultSet`, `SQLException`, and related JDBC interfaces.
- Oracle Java Tutorials — `try-with-resources` and automatic resource management.
- Oracle JDBC documentation — JDBC resource handling and transaction behavior.
- HikariCP official README and configuration documentation — pool lifecycle, leak detection, and connection pool behavior.
- PostgreSQL JDBC and database documentation — transaction/session behavior and cursor/fetch implications.
- MySQL Connector/J documentation — result streaming and statement/result lifecycle caveats.

---

# Status Seri

```text
Part 010 dari 029 selesai.
Seri belum selesai.
Part berikutnya: Part 011 — DataSource over DriverManager: Modern Connection Acquisition
File berikutnya: learn-java-sql-jdbc-hikaricp-part-011.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-sql-jdbc-hikaricp-part-009.md">⬅️ SQLException Mastery: SQLState, Vendor Code, Warnings, and Recovery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-sql-jdbc-hikaricp-part-011.md">DataSource over DriverManager: Modern Connection Acquisition ➡️</a>
</div>
