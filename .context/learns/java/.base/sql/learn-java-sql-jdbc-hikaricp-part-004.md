# learn-java-sql-jdbc-hikaricp-part-004.md

# Part 004 — Statement, PreparedStatement, CallableStatement: Execution Model

> Seri: **learn-java-sql-jdbc-hikaricp**  
> Bagian: **004 dari 029**  
> Topik: **`Statement`, `PreparedStatement`, `CallableStatement`, dan model eksekusi JDBC**  
> Level: **Advanced / Production Engineer**

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah melihat bahwa `Connection` bukan sekadar pipa jaringan, tetapi representasi logical handle terhadap database session. Sekarang kita turun satu lapisan: bagaimana aplikasi Java mengirim perintah ke database.

Di JDBC, tiga interface utama untuk mengirim SQL adalah:

1. `Statement`
2. `PreparedStatement`
3. `CallableStatement`

Secara permukaan, ketiganya terlihat hanya sebagai variasi cara menjalankan SQL. Namun secara mental model production, ketiganya mewakili perbedaan penting dalam:

1. bagaimana SQL dikirim ke driver,
2. kapan SQL diparse,
3. bagaimana parameter dibind,
4. apakah database dapat melakukan reuse execution plan,
5. bagaimana result dikembalikan,
6. bagaimana timeout diterapkan,
7. bagaimana batch dijalankan,
8. bagaimana stored procedure dipanggil,
9. bagaimana error dan partial failure muncul,
10. bagaimana resource harus ditutup.

Bagian ini bertujuan membuat Anda tidak hanya tahu “pakai `PreparedStatement` untuk menghindari SQL injection”, tetapi paham **execution pipeline** dari sisi Java, JDBC driver, network protocol, dan database engine.

---

## 1. Peta Besar: Command Object di JDBC

Di JDBC, `Connection` membuat object command. Command object inilah yang mengirim perintah ke database.

```java
try (Connection connection = dataSource.getConnection()) {
    try (Statement statement = connection.createStatement()) {
        try (ResultSet rs = statement.executeQuery("select id, name from users")) {
            while (rs.next()) {
                long id = rs.getLong("id");
                String name = rs.getString("name");
            }
        }
    }
}
```

Dengan parameter:

```java
String sql = "select id, name from users where status = ? and created_at >= ?";

try (Connection connection = dataSource.getConnection();
     PreparedStatement ps = connection.prepareStatement(sql)) {

    ps.setString(1, "ACTIVE");
    ps.setObject(2, cutoffDateTime);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            // map row
        }
    }
}
```

Dengan stored procedure:

```java
try (Connection connection = dataSource.getConnection();
     CallableStatement cs = connection.prepareCall("{ call recalculate_score(?, ?) }") ) {

    cs.setLong(1, caseId);
    cs.registerOutParameter(2, Types.INTEGER);

    cs.execute();

    int score = cs.getInt(2);
}
```

Secara inheritance:

```text
Statement
  └── PreparedStatement
        └── CallableStatement
```

Maknanya:

1. `PreparedStatement` adalah `Statement` yang SQL-nya sudah diketahui saat object dibuat dan dapat memiliki parameter placeholder.
2. `CallableStatement` adalah `PreparedStatement` khusus untuk memanggil stored procedure/function.
3. Semua memiliki lifecycle resource dan harus ditutup.

Namun inheritance ini tidak berarti semua method `Statement` baik dipakai pada `PreparedStatement`. Banyak bug muncul karena developer mencampur mental model `Statement` dan `PreparedStatement`.

---

## 2. Mental Model Eksekusi: Parse, Bind, Execute, Fetch

Untuk memahami `Statement` dan `PreparedStatement`, gunakan pipeline berikut:

```text
Java code
  ↓
JDBC command object
  ↓
Driver translates call into database protocol
  ↓
Database receives SQL/request
  ↓
Parse
  ↓
Bind parameters
  ↓
Optimize / choose plan
  ↓
Execute
  ↓
Fetch rows / return update count / return generated keys
  ↓
Driver exposes result as ResultSet / update count / output parameter
```

Tidak semua database dan driver memisahkan fase ini secara eksplisit, tetapi mental model ini sangat berguna.

### 2.1 Parse

Database membaca SQL text, memvalidasi syntax, nama table/column, privilege, dan menyiapkan representasi internal.

Contoh:

```sql
select id, name from users where status = ?
```

Database perlu memahami:

1. table `users`,
2. column `id`, `name`, `status`,
3. operator `=`,
4. placeholder parameter,
5. tipe yang mungkin dipakai,
6. plan candidate.

### 2.2 Bind

Parameter aktual dikirim.

```java
ps.setString(1, "ACTIVE");
```

Bind bukan string concatenation. Driver mengirim nilai parameter sebagai nilai terpisah dari SQL structure, walaupun detailnya bergantung driver/protocol.

### 2.3 Optimize / Plan

Database memilih execution plan.

Contoh pilihan:

1. full table scan,
2. index range scan,
3. nested loop join,
4. hash join,
5. bitmap index,
6. partition pruning,
7. parallel execution.

Prepared statement dapat membantu reuse, tetapi reuse plan tidak selalu otomatis dan tidak selalu lebih baik. Ada database yang memilih generic plan setelah threshold tertentu, ada yang tetap custom plan, ada yang melakukan bind peeking, ada yang plan cache-nya sensitif terhadap session setting.

### 2.4 Execute

Database menjalankan operasi.

Untuk `select`, hasilnya cursor/row stream. Untuk DML, hasilnya update count. Untuk procedure, hasilnya bisa campuran: update count, result set, output parameter, atau exception.

### 2.5 Fetch

Untuk query yang mengembalikan banyak row, row tidak selalu langsung dikirim semua sekaligus. Driver dapat melakukan fetch bertahap.

Di sinilah `ResultSet`, fetch size, cursor, memory pressure, dan network round-trip mulai relevan.

---

## 3. `Statement`: Dynamic SQL Tanpa Parameter Binding

`Statement` digunakan untuk menjalankan SQL text langsung.

```java
try (Statement st = connection.createStatement()) {
    boolean hasResultSet = st.execute("select id, name from users");
}
```

### 3.1 Kapan `Statement` Masuk Akal?

`Statement` masih valid untuk:

1. SQL statis tanpa input user.
2. DDL dalam migration/test utility.
3. Query metadata/debugging sederhana.
4. Database maintenance script internal.
5. SQL yang memang tidak membutuhkan parameter.

Contoh aman:

```java
try (Statement st = connection.createStatement()) {
    st.execute("create index idx_users_status on users(status)");
}
```

Contoh berbahaya:

```java
String sql = "select * from users where username = '" + username + "'";
st.executeQuery(sql);
```

Bug-nya bukan hanya SQL injection. Ada juga masalah:

1. quote escaping salah,
2. date/time formatting salah,
3. decimal separator salah,
4. encoding issue,
5. plan cache buruk,
6. log berisi data sensitif,
7. query text unik terlalu banyak.

### 3.2 `Statement.executeQuery()`

Dipakai untuk SQL yang diharapkan menghasilkan satu `ResultSet`.

```java
try (Statement st = connection.createStatement();
     ResultSet rs = st.executeQuery("select id, name from users")) {
    while (rs.next()) {
        // read row
    }
}
```

Jika SQL tidak menghasilkan result set, driver dapat melempar `SQLException`.

### 3.3 `Statement.executeUpdate()`

Dipakai untuk SQL yang menghasilkan update count.

```java
int updated = st.executeUpdate("update users set status = 'INACTIVE' where last_login_at < current_date - 365");
```

Return value biasanya jumlah row yang terpengaruh. Untuk DDL, beberapa driver mengembalikan `0`.

### 3.4 `Statement.execute()`

Dipakai saat Anda tidak tahu apakah hasilnya result set, update count, atau kombinasi.

```java
boolean hasResultSet = st.execute(sql);

if (hasResultSet) {
    try (ResultSet rs = st.getResultSet()) {
        // process result set
    }
} else {
    int updateCount = st.getUpdateCount();
}
```

Ini penting untuk stored procedure atau statement vendor-specific yang bisa mengembalikan multiple results.

### 3.5 Large Update Count

Untuk operasi yang bisa mempengaruhi lebih dari `Integer.MAX_VALUE` row, JDBC menyediakan varian `executeLargeUpdate()` dan `getLargeUpdateCount()`.

```java
long count = st.executeLargeUpdate("delete from audit_archive where created_at < date '2010-01-01'");
```

Di banyak aplikasi OLTP biasa ini jarang dipakai, tetapi untuk archival, migration, purge job, dan data warehouse operation, ini lebih tepat daripada `int`.

---

## 4. `PreparedStatement`: Parameterized Command Object

`PreparedStatement` dibuat dari SQL template.

```java
String sql = "select id, name from users where status = ?";
PreparedStatement ps = connection.prepareStatement(sql);
```

Parameter placeholder `?` kemudian diisi dengan setter.

```java
ps.setString(1, "ACTIVE");
```

Eksekusi tidak lagi membawa SQL string:

```java
try (ResultSet rs = ps.executeQuery()) {
    // process
}
```

Perhatikan perbedaan ini:

```java
// Benar
ps.executeQuery();

// Buruk / salah mental model
ps.executeQuery(sql);
```

`PreparedStatement` mengikat SQL pada saat object dibuat. Jangan memperlakukan `PreparedStatement` seperti `Statement` biasa.

---

## 5. Kenapa `PreparedStatement` Penting?

Ada empat alasan utama.

### 5.1 Safety: Memisahkan SQL Structure dari Value

Dengan prepared statement, value tidak disisipkan sebagai bagian dari SQL syntax.

Buruk:

```java
String sql = "select * from users where username = '" + username + "'";
```

Baik:

```java
String sql = "select * from users where username = ?";
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setString(1, username);
}
```

Jika `username` berisi:

```text
' or '1'='1
```

Pada prepared statement, itu diperlakukan sebagai nilai string, bukan bagian dari struktur SQL.

Namun prepared statement **tidak bisa** mengikat identifier.

Tidak valid:

```java
String sql = "select * from ? where id = ?";
ps.setString(1, tableName);
```

Nama table, nama column, `order by` direction, schema, dan fragment SQL lain tidak bisa diamankan dengan bind parameter. Untuk itu perlu whitelist.

Contoh aman untuk dynamic order by:

```java
private static final Map<String, String> ALLOWED_SORT_COLUMNS = Map.of(
    "createdAt", "created_at",
    "name", "name",
    "status", "status"
);

String requestedSort = request.sort();
String sortColumn = ALLOWED_SORT_COLUMNS.get(requestedSort);
if (sortColumn == null) {
    throw new IllegalArgumentException("Unsupported sort column: " + requestedSort);
}

String direction = request.ascending() ? "asc" : "desc";
String sql = "select id, name, status from users order by " + sortColumn + " " + direction;
```

Prinsipnya:

```text
Values -> bind parameter
SQL structure / identifiers -> whitelist, not bind
```

### 5.2 Correctness: Type Binding

Prepared statement memungkinkan driver tahu tipe parameter.

```java
ps.setLong(1, userId);
ps.setObject(2, LocalDate.now());
ps.setBigDecimal(3, amount);
```

Ini lebih benar daripada mengubah semuanya menjadi string.

Buruk:

```java
String sql = "insert into payment(amount, paid_at) values ('" + amount + "', '" + timestamp + "')";
```

Masalah yang bisa muncul:

1. decimal formatting,
2. time zone,
3. implicit cast,
4. index tidak dipakai karena tipe mismatch,
5. date literal vendor-specific,
6. precision loss.

### 5.3 Performance: Potensi Reuse Parse/Plan

Prepared statement dapat memungkinkan reuse parse/plan. Tetapi kata kuncinya: **dapat**, bukan **pasti**.

Faktor yang mempengaruhi:

1. driver menggunakan server-side prepared statement atau tidak,
2. database punya plan cache atau tidak,
3. SQL text identik atau tidak,
4. parameter type stabil atau tidak,
5. statement cache aktif atau tidak,
6. connection/session sama atau tidak,
7. prepared statement ditutup atau tidak,
8. driver punya threshold sebelum server prepare,
9. database memilih generic/custom plan.

Contoh penting: PostgreSQL JDBC memakai extended protocol untuk `PreparedStatement`, dan driver dapat berpindah ke named server-side prepared statement setelah `prepareThreshold` tertentu. Dokumentasi pgJDBC menyebut default threshold ini 5 eksekusi. Artinya, pada PostgreSQL, “pakai `PreparedStatement`” tidak selalu berarti statement langsung menjadi server-side named prepared statement sejak eksekusi pertama.

### 5.4 Observability: Query Shape Stabil

Prepared statement membuat query shape lebih stabil.

Alih-alih log query seperti:

```sql
select * from users where id = 1
select * from users where id = 2
select * from users where id = 3
```

Anda punya query shape:

```sql
select * from users where id = ?
```

Ini membantu:

1. query fingerprinting,
2. slow query grouping,
3. database performance analysis,
4. APM aggregation,
5. plan cache hit,
6. security review.

---

## 6. PreparedStatement Tidak Otomatis Berarti Server-Side Prepared Statement

Ini salah satu jebakan terbesar.

Di Java code, `PreparedStatement` adalah interface JDBC. Tetapi implementasinya bisa berbeda:

```text
Java PreparedStatement
  could mean:
    1. client-side parameter substitution by driver
    2. protocol-level bind without named server prepared statement
    3. server-side unnamed prepared statement
    4. server-side named prepared statement
    5. cached prepared statement by driver
    6. cached statement by pool/driver/database
```

Implikasinya:

1. Jangan berasumsi setiap `PreparedStatement` mengurangi parse cost.
2. Jangan berasumsi semua driver punya behavior sama.
3. Jangan berasumsi closing `PreparedStatement` selalu langsung menghapus server resource.
4. Jangan berasumsi prepared statement selalu lebih cepat untuk one-off query.
5. Jangan berasumsi prepared statement cache aktif.

### 6.1 PostgreSQL Example

pgJDBC memiliki konsep `prepareThreshold`. Setelah statement dieksekusi beberapa kali, driver dapat menggunakan named server-side prepared statement. Ini penting untuk memahami kenapa microbenchmark prepared statement kadang terlihat tidak memberi benefit pada eksekusi awal.

### 6.2 MySQL Example

MySQL Connector/J memiliki properti seperti `useServerPrepStmts`, `cachePrepStmts`, dan `rewriteBatchedStatements`. Untuk batch insert, `rewriteBatchedStatements=true` dapat mengubah banyak insert menjadi bentuk multi-value insert pada kondisi tertentu. Ini bukan sekadar “PreparedStatement lebih cepat”, tetapi driver melakukan rewrite tertentu.

### 6.3 Oracle Example

Oracle JDBC dan Oracle Database memiliki konsep statement cache, cursor, dan shared pool yang punya karakteristik sendiri. Pada Oracle, jumlah open cursor, parse call, session cursor cache, dan statement cache bisa sangat relevan.

Pelajaran utamanya:

```text
JDBC API portable.
Driver behavior tidak sepenuhnya portable.
Production tuning wajib membaca dokumentasi driver/database spesifik.
```

---

## 7. Parameter Binding: Index, Type, Null, dan Kesalahan Umum

Parameter JDBC memakai index 1-based.

```java
PreparedStatement ps = connection.prepareStatement(
    "select * from users where status = ? and created_at >= ?"
);

ps.setString(1, "ACTIVE");
ps.setObject(2, cutoff);
```

Bukan 0-based.

```java
// Salah
ps.setString(0, "ACTIVE");
```

### 7.1 Pilih Setter yang Tepat

Contoh:

```java
ps.setLong(1, id);
ps.setString(2, name);
ps.setBigDecimal(3, amount);
ps.setObject(4, LocalDateTime.now());
```

Jangan otomatis memakai `setString` untuk semua tipe.

Buruk:

```java
ps.setString(1, String.valueOf(id));
ps.setString(2, amount.toString());
```

Dampaknya bisa:

1. implicit conversion di database,
2. index tidak terpakai,
3. error regional format,
4. precision issue,
5. query plan berbeda.

### 7.2 `setObject()`

`setObject()` fleksibel, tetapi harus hati-hati.

```java
ps.setObject(1, localDate);
```

JDBC 4.2 mendukung banyak tipe Java time API, tetapi dukungan detail tetap driver-specific.

Untuk nilai yang ambiguous, lebih baik beri SQL type:

```java
ps.setObject(1, value, Types.TIMESTAMP);
```

atau:

```java
ps.setNull(1, Types.TIMESTAMP);
```

### 7.3 Null Binding

Ini penting.

Buruk:

```java
ps.setObject(1, null);
```

Kadang bisa jalan, kadang driver tidak tahu SQL type.

Lebih eksplisit:

```java
ps.setNull(1, Types.VARCHAR);
```

atau:

```java
ps.setObject(1, null, Types.VARCHAR);
```

Rule praktis:

```text
Untuk nullable parameter, application code harus tahu SQL type-nya.
```

### 7.4 Reusing PreparedStatement

Anda bisa reuse object `PreparedStatement` untuk banyak eksekusi:

```java
String sql = "insert into user_event(user_id, event_type, created_at) values (?, ?, ?)";

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    for (UserEvent event : events) {
        ps.setLong(1, event.userId());
        ps.setString(2, event.type());
        ps.setObject(3, event.createdAt());
        ps.executeUpdate();
    }
}
```

Tapi hati-hati: parameter lama bisa tetap ada jika tidak di-set ulang.

Buruk:

```java
PreparedStatement ps = connection.prepareStatement(
    "insert into t(a, b, c) values (?, ?, ?)"
);

ps.setString(1, "a1");
ps.setString(2, "b1");
ps.setString(3, "c1");
ps.executeUpdate();

ps.setString(1, "a2");
ps.setString(2, "b2");
// lupa set parameter 3
ps.executeUpdate(); // c masih bisa c1 tergantung state object
```

Gunakan disiplin:

1. set semua parameter setiap eksekusi,
2. atau panggil `clearParameters()`,
3. atau buat helper binder yang eksplisit.

---

## 8. Command Execution Method Matrix

Gunakan method yang sesuai.

| Method | Dipakai untuk | Return |
|---|---|---|
| `executeQuery()` | `SELECT` yang menghasilkan `ResultSet` tunggal | `ResultSet` |
| `executeUpdate()` | `INSERT`, `UPDATE`, `DELETE`, DDL | `int` update count |
| `executeLargeUpdate()` | DML besar | `long` update count |
| `execute()` | SQL/procedure yang bisa menghasilkan result set/update count/multiple result | `boolean` apakah result pertama adalah `ResultSet` |
| `executeBatch()` | batch command | `int[]` update counts |
| `executeLargeBatch()` | batch besar | `long[]` update counts |

### 8.1 Kesalahan Umum

Buruk:

```java
ps.execute();
// ignore result
```

Jika Anda tahu operasi adalah update, pakai:

```java
int updated = ps.executeUpdate();
```

Jika Anda tahu operasi query, pakai:

```java
try (ResultSet rs = ps.executeQuery()) {
    // process
}
```

Kenapa penting?

1. Lebih jelas untuk reader.
2. Lebih mudah validasi expected result.
3. Menghindari result tidak dikonsumsi.
4. Menghindari bug multiple results.
5. Lebih mudah instrumentasi.

---

## 9. Query Timeout: Bukan Sekadar Angka Ajaib

`Statement` punya `setQueryTimeout(int seconds)`.

```java
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setQueryTimeout(5);
    try (ResultSet rs = ps.executeQuery()) {
        // process
    }
}
```

Timeout ini meminta driver membatasi waktu eksekusi statement. Namun behavior detail bergantung driver dan database.

Hal yang harus dipahami:

1. Timeout bisa diimplementasikan driver-side.
2. Timeout bisa dikirim ke database sebagai cancel request.
3. Timeout bisa tidak menghentikan query di server secara instan.
4. Connection bisa berada dalam state tidak aman setelah timeout.
5. Timeout query berbeda dari socket timeout.
6. Timeout query berbeda dari lock timeout.
7. Timeout query berbeda dari transaction timeout.
8. Timeout query berbeda dari request timeout HTTP.

Misalnya, request HTTP timeout 10 detik tetapi query timeout 60 detik berarti user sudah mendapat timeout, tetapi query bisa masih berjalan di database. Ini menciptakan zombie query.

Rule praktis:

```text
Timeout harus disusun berlapis:
request timeout > transaction timeout > statement timeout > lock/socket timeout,
dengan margin yang jelas dan behavior cancel yang diuji.
```

Pembahasan detail timeout akan masuk Part 022, tetapi dari sekarang penting memahami bahwa `setQueryTimeout` adalah bagian dari command execution contract, bukan solusi lengkap.

---

## 10. Fetch Size: Mengontrol Cara Row Diambil, Bukan Membatasi Total Row

`setFetchSize()` memberi hint kepada driver tentang jumlah row yang di-fetch per round-trip.

```java
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setFetchSize(500);
    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            // process row
        }
    }
}
```

Fetch size bukan `LIMIT`.

```text
LIMIT / FETCH FIRST / ROWNUM -> membatasi total row dari SQL
setFetchSize -> memberi hint batch fetch dari result cursor
```

Jika query menghasilkan 1 juta row, `setFetchSize(500)` tidak membuat total row menjadi 500. Ia hanya memberi sinyal agar row diambil dalam chunk sekitar 500, jika driver mendukung.

### 10.1 Kenapa Ini Penting?

Fetch size mempengaruhi trade-off:

1. memory client,
2. network round-trip,
3. cursor lifetime,
4. transaction duration,
5. database resource,
6. perceived latency.

Fetch size terlalu kecil:

```text
banyak round-trip
latency tinggi
```

Fetch size terlalu besar:

```text
memory client tinggi
response awal lambat
buffering besar
```

### 10.2 Driver Behavior Berbeda

Beberapa driver menghormati fetch size langsung. Beberapa membutuhkan setting tambahan. Beberapa default-nya buffer semua row. Karena itu, streaming query production harus diuji dengan driver yang dipakai, bukan hanya dibaca dari API.

---

## 11. Max Rows: Membatasi Row dari Sisi Statement

`setMaxRows()` membatasi jumlah maksimum row yang dihasilkan statement.

```java
try (Statement st = connection.createStatement()) {
    st.setMaxRows(1000);
    try (ResultSet rs = st.executeQuery("select * from audit_log order by created_at desc")) {
        // max 1000 rows exposed by JDBC
    }
}
```

Namun untuk production, lebih baik membatasi di SQL:

```sql
select *
from audit_log
order by created_at desc
fetch first 1000 rows only
```

Kenapa SQL-level limit lebih baik?

1. Database optimizer tahu limit.
2. Database bisa stop lebih awal.
3. Network lebih efisien.
4. Execution plan bisa berubah lebih optimal.
5. Lebih eksplisit di SQL.

`setMaxRows()` lebih cocok sebagai guardrail tambahan, bukan pengganti pagination/limit.

---

## 12. Generated Keys

Untuk insert yang menghasilkan primary key, JDBC menyediakan generated keys.

```java
String sql = "insert into users(name, status) values (?, ?)";

try (PreparedStatement ps = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
    ps.setString(1, "Alice");
    ps.setString(2, "ACTIVE");

    int inserted = ps.executeUpdate();
    if (inserted != 1) {
        throw new IllegalStateException("Expected 1 inserted row, got " + inserted);
    }

    try (ResultSet keys = ps.getGeneratedKeys()) {
        if (!keys.next()) {
            throw new IllegalStateException("No generated key returned");
        }
        long id = keys.getLong(1);
    }
}
```

### 12.1 Generated Keys Tidak Sepenuhnya Portable

Beberapa hal berbeda antar database/driver:

1. auto-increment vs sequence,
2. identity column,
3. trigger-generated key,
4. composite key,
5. multiple generated columns,
6. batch insert generated keys,
7. insert returning syntax,
8. column name requirement.

Alternatif:

```java
String[] generatedColumns = {"id"};
PreparedStatement ps = connection.prepareStatement(sql, generatedColumns);
```

Untuk database seperti PostgreSQL, sering ada `returning`:

```sql
insert into users(name, status) values (?, ?) returning id
```

Dengan JDBC, itu bisa dieksekusi sebagai query.

```java
try (PreparedStatement ps = connection.prepareStatement(
        "insert into users(name, status) values (?, ?) returning id")) {
    ps.setString(1, "Alice");
    ps.setString(2, "ACTIVE");

    try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
            long id = rs.getLong(1);
        }
    }
}
```

Rule praktis:

```text
Generated keys adalah area yang harus diuji per database/driver, terutama untuk batch.
```

---

## 13. Batch Execution Model

Batch mengumpulkan banyak command lalu mengirimnya sebagai satu batch execution.

```java
String sql = "insert into user_event(user_id, event_type, created_at) values (?, ?, ?)";

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    for (UserEvent event : events) {
        ps.setLong(1, event.userId());
        ps.setString(2, event.type());
        ps.setObject(3, event.createdAt());
        ps.addBatch();
    }

    int[] counts = ps.executeBatch();
}
```

### 13.1 Batch Bukan Transaction Otomatis

Jika auto-commit true, behavior dapat berbeda dan kurang ideal. Untuk batch write, biasanya explicit transaction lebih tepat.

```java
boolean originalAutoCommit = connection.getAutoCommit();
connection.setAutoCommit(false);

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    for (UserEvent event : events) {
        ps.setLong(1, event.userId());
        ps.setString(2, event.type());
        ps.setObject(3, event.createdAt());
        ps.addBatch();
    }

    ps.executeBatch();
    connection.commit();
} catch (SQLException e) {
    connection.rollback();
    throw e;
} finally {
    connection.setAutoCommit(originalAutoCommit);
}
```

Nanti ketika memakai pool, reset state harus sangat hati-hati. Biasanya application framework/transaction manager membantu, tapi mental model tetap wajib jelas.

### 13.2 Batch Size

Jangan batch 1 juta row sekaligus.

Gunakan chunk:

```java
int batchSize = 500;
int pending = 0;

for (UserEvent event : events) {
    bind(ps, event);
    ps.addBatch();
    pending++;

    if (pending == batchSize) {
        ps.executeBatch();
        ps.clearBatch();
        pending = 0;
    }
}

if (pending > 0) {
    ps.executeBatch();
}
```

Trade-off batch size:

| Batch terlalu kecil | Batch terlalu besar |
|---|---|
| round-trip banyak | memory besar |
| throughput rendah | packet besar |
| parse/execute overhead tinggi | lock duration panjang |
| kurang efisien | partial failure lebih mahal |

Mulai dari 100–1000 sering masuk akal untuk banyak workload, tapi angka final harus diuji.

### 13.3 BatchUpdateException

Jika batch gagal sebagian, JDBC melempar `BatchUpdateException` yang membawa update counts.

```java
try {
    ps.executeBatch();
} catch (BatchUpdateException e) {
    int[] counts = e.getUpdateCounts();
    // classify partial success/failure
    throw e;
}
```

Nilai update count bisa berupa:

1. jumlah row yang affected,
2. `Statement.SUCCESS_NO_INFO`,
3. `Statement.EXECUTE_FAILED`.

Jangan berasumsi semua driver memberi detail sempurna.

### 13.4 Batch dan Driver Rewrite

Batch JDBC belum tentu dikirim sebagai satu SQL multi-row. Bisa saja driver mengirim banyak execute dalam protokol yang lebih efisien. Bisa juga driver rewrite menjadi SQL multi-value.

Contoh MySQL Connector/J memiliki properti `rewriteBatchedStatements` untuk mengoptimalkan batch tertentu. Ini berarti performa batch sangat bergantung pada driver property.

Rule praktis:

```text
Batch performance = JDBC API + driver property + database protocol + SQL shape + transaction size.
```

---

## 14. `CallableStatement`: Stored Procedure dan Function Call

`CallableStatement` dipakai untuk stored procedure/function.

```java
try (CallableStatement cs = connection.prepareCall("{ call update_case_status(?, ?) }")) {
    cs.setLong(1, caseId);
    cs.setString(2, "APPROVED");
    cs.execute();
}
```

Dengan output parameter:

```java
try (CallableStatement cs = connection.prepareCall("{ call calculate_score(?, ?) }")) {
    cs.setLong(1, caseId);
    cs.registerOutParameter(2, Types.INTEGER);

    cs.execute();

    int score = cs.getInt(2);
}
```

Dengan function return:

```java
try (CallableStatement cs = connection.prepareCall("{ ? = call calculate_score(?) }")) {
    cs.registerOutParameter(1, Types.INTEGER);
    cs.setLong(2, caseId);

    cs.execute();

    int score = cs.getInt(1);
}
```

### 14.1 Escape Syntax

JDBC menyediakan escape syntax untuk procedure/function call:

```text
{ call procedure_name(?, ?) }
{ ? = call function_name(?) }
```

Driver menerjemahkannya ke syntax database spesifik.

### 14.2 Output Parameter

Output parameter harus diregister sebelum eksekusi.

```java
cs.registerOutParameter(2, Types.VARCHAR);
```

Jika lupa, biasanya error.

### 14.3 Stored Procedure Bisa Menghasilkan Multiple Results

Procedure bisa menghasilkan:

1. output parameter,
2. update count,
3. satu atau lebih result set,
4. warning,
5. exception.

Maka kadang perlu memakai `execute()` dan iterasi result.

```java
boolean hasResultSet = cs.execute();

while (true) {
    if (hasResultSet) {
        try (ResultSet rs = cs.getResultSet()) {
            while (rs.next()) {
                // process
            }
        }
    } else {
        int updateCount = cs.getUpdateCount();
        if (updateCount == -1) {
            break;
        }
        // process update count
    }

    hasResultSet = cs.getMoreResults();
}
```

### 14.4 CallableStatement Trade-Off

Stored procedure bisa sangat berguna ketika:

1. logic harus dekat dengan data,
2. operasi bulk lebih efisien di database,
3. legacy system sudah expose procedure,
4. security model memakai procedure grants,
5. reporting/ETL logic database-heavy,
6. consistency membutuhkan single database-side operation.

Tetapi bisa menjadi masalah ketika:

1. business logic tersebar antara Java dan DB,
2. testing sulit,
3. versioning procedure tidak sinkron dengan application deploy,
4. observability buruk,
5. error semantics tidak jelas,
6. transaction boundary tersembunyi,
7. vendor lock-in meningkat.

Stored procedure bukan anti-pattern mutlak. Yang berbahaya adalah stored procedure tanpa ownership, contract, versioning, observability, dan migration discipline.

---

## 15. Multiple Results: `getMoreResults()` dan Update Count

Beberapa SQL/procedure dapat mengembalikan lebih dari satu hasil.

JDBC model:

1. `execute()` mengembalikan apakah result pertama adalah `ResultSet`.
2. `getResultSet()` mengambil result set saat ini.
3. `getUpdateCount()` mengambil update count saat ini.
4. `getMoreResults()` pindah ke hasil berikutnya.
5. Jika tidak ada lagi hasil, `getUpdateCount()` biasanya `-1`.

Pattern:

```java
boolean hasResultSet = statement.execute(sql);

while (true) {
    if (hasResultSet) {
        try (ResultSet rs = statement.getResultSet()) {
            while (rs.next()) {
                // consume row
            }
        }
    } else {
        int updateCount = statement.getUpdateCount();
        if (updateCount == -1) {
            break;
        }
        // consume update count
    }

    hasResultSet = statement.getMoreResults();
}
```

Jika Anda tidak consume result dengan benar, beberapa driver/database dapat menahan resource atau membuat command berikutnya bermasalah.

---

## 16. ResultSet Type, Concurrency, dan Holdability Saat Membuat Statement

Saat membuat `Statement`/`PreparedStatement`, Anda bisa menentukan karakteristik result set.

```java
PreparedStatement ps = connection.prepareStatement(
    sql,
    ResultSet.TYPE_FORWARD_ONLY,
    ResultSet.CONCUR_READ_ONLY,
    ResultSet.CLOSE_CURSORS_AT_COMMIT
);
```

### 16.1 Type

| Type | Makna |
|---|---|
| `TYPE_FORWARD_ONLY` | Cursor maju saja |
| `TYPE_SCROLL_INSENSITIVE` | Bisa scroll, tidak sensitif terhadap perubahan setelah query |
| `TYPE_SCROLL_SENSITIVE` | Bisa scroll, sensitif terhadap perubahan, jika didukung |

Untuk production OLTP, default terbaik biasanya forward-only.

Scrollable result set bisa mahal karena driver/database perlu buffering atau cursor khusus.

### 16.2 Concurrency

| Concurrency | Makna |
|---|---|
| `CONCUR_READ_ONLY` | Result set hanya dibaca |
| `CONCUR_UPDATABLE` | Result set bisa dipakai update row |

Updatable result set jarang dipakai di sistem enterprise modern karena:

1. kurang eksplisit,
2. sulit di-review,
3. tidak cocok dengan repository/service design,
4. vendor behavior berbeda,
5. locking semantics tidak selalu jelas.

Lebih baik pakai SQL update eksplisit.

### 16.3 Holdability

| Holdability | Makna |
|---|---|
| `HOLD_CURSORS_OVER_COMMIT` | Cursor tetap terbuka setelah commit |
| `CLOSE_CURSORS_AT_COMMIT` | Cursor ditutup saat commit |

Holdability sangat terkait database cursor dan transaction semantics. Untuk sistem OLTP, cursor panjang melewati commit biasanya perlu dihindari kecuali benar-benar paham konsekuensinya.

---

## 17. Statement Configuration yang Sering Terlupakan

### 17.1 `setQueryTimeout`

```java
ps.setQueryTimeout(10);
```

Batas waktu eksekusi statement dalam detik.

### 17.2 `setFetchSize`

```java
ps.setFetchSize(500);
```

Hint jumlah row per fetch.

### 17.3 `setMaxRows`

```java
ps.setMaxRows(1000);
```

Batas maksimum row yang dikembalikan.

### 17.4 `setFetchDirection`

```java
ps.setFetchDirection(ResultSet.FETCH_FORWARD);
```

Hint arah fetch. Jarang berdampak besar pada driver modern, tetapi tetap bagian dari API.

### 17.5 `closeOnCompletion`

```java
statement.closeOnCompletion();
```

Statement akan ditutup ketika semua dependent result set ditutup. Ini bisa membantu, tetapi jangan jadikan pengganti disiplin try-with-resources.

---

## 18. Lifecycle: Statement dan ResultSet Ownership

Resource ownership paling aman:

```java
try (Connection connection = dataSource.getConnection();
     PreparedStatement ps = connection.prepareStatement(sql)) {

    bind(ps, request);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            // map
        }
    }
}
```

Ownership chain:

```text
Connection owns Statement
Statement owns ResultSet
ResultSet depends on Statement and Connection
```

Maka jangan return `ResultSet` dari method repository.

Buruk:

```java
public ResultSet findUsers() throws SQLException {
    Connection c = dataSource.getConnection();
    PreparedStatement ps = c.prepareStatement("select * from users");
    return ps.executeQuery();
}
```

Masalah:

1. siapa menutup `ResultSet`?
2. siapa menutup `PreparedStatement`?
3. siapa menutup `Connection`?
4. bagaimana jika caller lupa?
5. bagaimana jika exception saat mapping?
6. berapa lama connection tertahan?

Lebih baik:

```java
public List<User> findUsers() throws SQLException {
    String sql = "select id, name, status from users";

    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(sql);
         ResultSet rs = ps.executeQuery()) {

        List<User> users = new ArrayList<>();
        while (rs.next()) {
            users.add(mapUser(rs));
        }
        return users;
    }
}
```

Untuk streaming, gunakan callback yang menjaga resource tetap scoped:

```java
public void streamUsers(UserConsumer consumer) throws SQLException {
    String sql = "select id, name, status from users";

    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(sql)) {

        ps.setFetchSize(500);

        try (ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                consumer.accept(mapUser(rs));
            }
        }
    }
}
```

---

## 19. Execution Pattern untuk Query Tunggal

Contoh repository method yang defensif:

```java
public Optional<User> findById(long id) throws SQLException {
    String sql = """
        select id, username, status, created_at
        from app_user
        where id = ?
        """;

    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(sql)) {

        ps.setLong(1, id);
        ps.setQueryTimeout(3);

        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return Optional.empty();
            }

            User user = mapUser(rs);

            if (rs.next()) {
                throw new IllegalStateException("Expected at most one user for id=" + id);
            }

            return Optional.of(user);
        }
    }
}
```

Kenapa cek row kedua?

Karena method bernama `findById` punya invariant: maksimal satu row. Jika database constraint rusak atau query salah join, bug harus terlihat cepat.

Top 1% engineer tidak hanya “mapping row”. Ia menjaga invariant.

---

## 20. Execution Pattern untuk Update dengan Expected Count

```java
public void approveCase(long caseId, long approverId) throws SQLException {
    String sql = """
        update case_file
        set status = ?, approved_by = ?, approved_at = current_timestamp
        where id = ? and status = ?
        """;

    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(sql)) {

        ps.setString(1, "APPROVED");
        ps.setLong(2, approverId);
        ps.setLong(3, caseId);
        ps.setString(4, "PENDING_APPROVAL");

        int updated = ps.executeUpdate();

        if (updated == 0) {
            throw new OptimisticStateTransitionException(
                "Case is not in PENDING_APPROVAL or does not exist: " + caseId
            );
        }
        if (updated > 1) {
            throw new IllegalStateException("Expected one case row, updated=" + updated);
        }
    }
}
```

Perhatikan pattern ini:

```sql
where id = ? and status = ?
```

Ini membuat state transition atomic di database. Tidak perlu select dulu lalu update tanpa guard.

Buruk:

```java
// 1. select status
// 2. if pending, update by id only
```

Race condition:

```text
Thread A reads PENDING
Thread B reads PENDING
Thread A updates APPROVED
Thread B updates REJECTED
```

Lebih aman:

```sql
update case_file
set status = 'APPROVED'
where id = ? and status = 'PENDING'
```

Update count menjadi signal concurrency correctness.

---

## 21. Execution Pattern untuk Insert dengan Generated Key dan Transaction

```java
public long createCase(CreateCaseCommand command) throws SQLException {
    String insertCaseSql = """
        insert into case_file(reference_no, applicant_id, status, created_at)
        values (?, ?, ?, current_timestamp)
        """;

    String insertAuditSql = """
        insert into case_audit(case_id, action, actor_id, created_at)
        values (?, ?, ?, current_timestamp)
        """;

    try (Connection c = dataSource.getConnection()) {
        boolean originalAutoCommit = c.getAutoCommit();
        c.setAutoCommit(false);

        try {
            long caseId;

            try (PreparedStatement ps = c.prepareStatement(
                    insertCaseSql,
                    Statement.RETURN_GENERATED_KEYS)) {

                ps.setString(1, command.referenceNo());
                ps.setLong(2, command.applicantId());
                ps.setString(3, "DRAFT");

                int inserted = ps.executeUpdate();
                if (inserted != 1) {
                    throw new IllegalStateException("Expected one inserted case, got " + inserted);
                }

                try (ResultSet keys = ps.getGeneratedKeys()) {
                    if (!keys.next()) {
                        throw new IllegalStateException("No generated case id returned");
                    }
                    caseId = keys.getLong(1);
                }
            }

            try (PreparedStatement ps = c.prepareStatement(insertAuditSql)) {
                ps.setLong(1, caseId);
                ps.setString(2, "CREATE_CASE");
                ps.setLong(3, command.actorId());
                int inserted = ps.executeUpdate();
                if (inserted != 1) {
                    throw new IllegalStateException("Expected one audit row, got " + inserted);
                }
            }

            c.commit();
            return caseId;
        } catch (Exception e) {
            c.rollback();
            throw e;
        } finally {
            c.setAutoCommit(originalAutoCommit);
        }
    }
}
```

Ini masih plain JDBC. Pada framework seperti Spring, transaction boundary biasanya diurus transaction manager. Tetapi mental model-nya sama:

```text
dua statement berbeda
satu connection sama
satu transaction sama
commit hanya setelah semua invariant sukses
rollback jika salah satu gagal
```

---

## 22. Dynamic SQL yang Aman

Kadang dynamic SQL tidak bisa dihindari.

Contoh filtering optional:

```java
StringBuilder sql = new StringBuilder("""
    select id, username, status, created_at
    from app_user
    where 1 = 1
    """);

List<SqlBinder> binders = new ArrayList<>();

if (filter.status() != null) {
    sql.append(" and status = ?");
    binders.add(ps -> ps.setString(binders.size() + 1, filter.status()));
}

if (filter.createdAfter() != null) {
    sql.append(" and created_at >= ?");
    binders.add(ps -> ps.setObject(binders.size() + 1, filter.createdAfter()));
}

sql.append(" order by created_at desc");

try (PreparedStatement ps = connection.prepareStatement(sql.toString())) {
    for (int i = 0; i < binders.size(); i++) {
        binders.get(i).bind(ps, i + 1);
    }
}
```

Namun pattern di atas punya bug potensial jika `binders.size()` dipakai saat lambda dibuat. Lebih aman gunakan helper builder.

```java
final class SqlBuilder {
    private final StringBuilder sql = new StringBuilder();
    private final List<ParameterBinder> binders = new ArrayList<>();

    SqlBuilder append(String fragment) {
        sql.append(fragment);
        return this;
    }

    SqlBuilder bind(ParameterBinder binder) {
        binders.add(binder);
        return this;
    }

    PreparedStatement prepare(Connection c) throws SQLException {
        PreparedStatement ps = c.prepareStatement(sql.toString());
        for (int i = 0; i < binders.size(); i++) {
            binders.get(i).bind(ps, i + 1);
        }
        return ps;
    }

    String sql() {
        return sql.toString();
    }
}

@FunctionalInterface
interface ParameterBinder {
    void bind(PreparedStatement ps, int index) throws SQLException;
}
```

Pemakaian:

```java
SqlBuilder builder = new SqlBuilder()
    .append("select id, username, status from app_user where 1 = 1");

if (filter.status() != null) {
    builder.append(" and status = ?")
           .bind((ps, i) -> ps.setString(i, filter.status()));
}

if (filter.createdAfter() != null) {
    builder.append(" and created_at >= ?")
           .bind((ps, i) -> ps.setObject(i, filter.createdAfter()));
}

builder.append(" order by created_at desc");

try (PreparedStatement ps = builder.prepare(connection);
     ResultSet rs = ps.executeQuery()) {
    // process
}
```

Untuk sort column, tetap whitelist:

```java
String sortColumn = switch (filter.sortBy()) {
    case "username" -> "username";
    case "createdAt" -> "created_at";
    case "status" -> "status";
    default -> throw new IllegalArgumentException("Unsupported sort: " + filter.sortBy());
};

String direction = filter.asc() ? "asc" : "desc";
builder.append(" order by ").append(sortColumn).append(" ").append(direction);
```

---

## 23. Statement Cache vs PreparedStatement Object

Ini sering rancu.

Ada beberapa level cache:

```text
Application variable holding PreparedStatement
  ↓
JDBC driver statement cache
  ↓
Connection pool statement cache, if any
  ↓
Database session cursor cache
  ↓
Database shared plan cache
```

Tidak semua ada. Tidak semua aktif. Tidak semua aman dipakai.

### 23.1 Jangan Cache PreparedStatement Global

Buruk:

```java
class UserRepository {
    private PreparedStatement findByIdStatement;
}
```

Kenapa buruk?

1. `PreparedStatement` terikat ke `Connection` tertentu.
2. Connection dari pool bisa dipinjam/dikembalikan.
3. Statement tidak thread-safe.
4. Transaction state bisa berbeda.
5. Statement bisa invalid setelah connection close/evict.
6. Resource leak.

Yang boleh di-cache adalah SQL string atau compiled query abstraction yang aman, bukan JDBC statement object mentah.

Baik:

```java
private static final String FIND_BY_ID_SQL = """
    select id, username, status
    from app_user
    where id = ?
    """;
```

### 23.2 Statement Cache Harus Driver/Pool-Aware

Jika ingin statement caching, gunakan fitur driver/database/pool yang memang dirancang untuk itu. Tetapi HikariCP sendiri secara prinsip tidak menyediakan prepared statement cache di pool layer karena statement cache lebih tepat dilakukan driver-level per connection.

Rule:

```text
Application code should not hold JDBC Statement beyond its resource scope.
```

---

## 24. Thread Safety

`Statement`, `PreparedStatement`, `CallableStatement`, dan `ResultSet` tidak boleh dipakai secara concurrent oleh banyak thread.

Buruk:

```java
PreparedStatement ps = connection.prepareStatement(sql);

executor.submit(() -> {
    ps.setLong(1, 1L);
    ps.executeQuery();
});

executor.submit(() -> {
    ps.setLong(1, 2L);
    ps.executeQuery();
});
```

Masalah:

1. parameter race,
2. protocol interleaving,
3. result set corrupt,
4. transaction state tidak jelas,
5. connection tidak thread-safe untuk penggunaan seperti ini.

Rule:

```text
One JDBC command object belongs to one thread of execution at a time.
```

Jika ingin parallel query, pakai connection/statement terpisah dan pahami pool capacity.

---

## 25. Anti-Pattern Besar di Execution Layer

### 25.1 String Concatenation untuk Value

```java
String sql = "select * from user where email = '" + email + "'";
```

Risiko:

1. SQL injection,
2. syntax error karena quote,
3. implicit conversion,
4. plan cache pollution,
5. logging sensitive data.

### 25.2 PreparedStatement tapi Masih Concatenate Value

```java
String sql = "select * from user where email = '" + email + "' and status = ?";
PreparedStatement ps = connection.prepareStatement(sql);
ps.setString(1, status);
```

Ini masih salah.

### 25.3 Salah Menggunakan Placeholder untuk Identifier

```java
String sql = "select * from users order by ?";
ps.setString(1, "created_at");
```

Ini tidak menjadi `order by created_at`. Itu menjadi order by literal value di banyak database, atau error.

### 25.4 Mengabaikan Update Count

```java
ps.executeUpdate();
```

Untuk state transition, update count adalah signal penting.

```java
int updated = ps.executeUpdate();
if (updated != 1) {
    throw new IllegalStateException(...);
}
```

### 25.5 Query Tanpa Limit pada Endpoint UI

```java
select * from audit_trail order by created_at desc
```

Jika table besar, ini bisa menghancurkan memory dan database IO.

### 25.6 Batch Tanpa Chunk

```java
for (Item item : millionItems) {
    ps.addBatch();
}
ps.executeBatch();
```

Risiko:

1. memory besar,
2. packet besar,
3. lock lama,
4. rollback mahal,
5. partial failure sulit.

### 25.7 Menelan SQLException

```java
try {
    ps.executeUpdate();
} catch (SQLException e) {
    log.warn("failed");
}
```

Ini membuat data consistency tidak jelas.

### 25.8 Reuse Statement Cross Request

Statement object bukan singleton dan bukan cache application-level.

---

## 26. Design Invariant untuk Repository JDBC

Repository JDBC yang matang harus punya invariant berikut:

1. Setiap method menentukan ownership connection dengan jelas.
2. Setiap statement berada dalam try-with-resources.
3. Setiap result set dikonsumsi dan ditutup dalam scope yang sama.
4. Value selalu bound via parameter.
5. Identifier dynamic selalu whitelist.
6. Update count divalidasi sesuai intent.
7. Query besar punya pagination/limit/streaming strategy.
8. Batch punya chunk size.
9. Timeout tidak dibiarkan default tanpa sadar.
10. SQLState/vendor code tidak dibuang jika penting.
11. Transaction boundary tidak tersembunyi sembarangan.
12. Method name sesuai cardinality result.
13. Mapping row eksplisit dan typed.
14. Tidak return JDBC object mentah ke layer atas.

---

## 27. Cardinality Pattern: `one`, `optional`, `many`, `exists`

Top 1% engineer membuat cardinality eksplisit.

### 27.1 Optional One

```java
public Optional<User> findByEmail(String email) throws SQLException {
    String sql = "select id, email, status from app_user where email = ?";

    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(sql)) {
        ps.setString(1, email);

        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return Optional.empty();
            }
            User user = mapUser(rs);
            if (rs.next()) {
                throw new IllegalStateException("Expected unique email: " + email);
            }
            return Optional.of(user);
        }
    }
}
```

### 27.2 Required One

```java
public User getById(long id) throws SQLException {
    return findById(id).orElseThrow(() -> new NotFoundException("User not found: " + id));
}
```

### 27.3 Many with Limit

```java
public List<User> findRecentUsers(int limit) throws SQLException {
    String sql = """
        select id, email, status
        from app_user
        order by created_at desc
        fetch first ? rows only
        """;

    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(sql)) {
        ps.setInt(1, limit);

        try (ResultSet rs = ps.executeQuery()) {
            List<User> result = new ArrayList<>();
            while (rs.next()) {
                result.add(mapUser(rs));
            }
            return result;
        }
    }
}
```

Catatan: tidak semua database menerima parameter pada `fetch first ? rows only`. Ada yang butuh syntax berbeda. Ini contoh konsep, bukan portability guarantee.

### 27.4 Exists

```java
public boolean existsByEmail(String email) throws SQLException {
    String sql = "select 1 from app_user where email = ? fetch first 1 row only";

    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(sql)) {
        ps.setString(1, email);

        try (ResultSet rs = ps.executeQuery()) {
            return rs.next();
        }
    }
}
```

Jangan ambil seluruh row hanya untuk cek eksistensi.

---

## 28. Command Object dan Transaction Boundary

Statement hanya command object. Transaction tetap milik connection.

```text
Connection
  ├── PreparedStatement A
  ├── PreparedStatement B
  └── CallableStatement C

All participate in the same transaction if executed on same connection with autoCommit=false.
```

Contoh:

```java
connection.setAutoCommit(false);

try (PreparedStatement updateCase = connection.prepareStatement(updateSql);
     PreparedStatement insertAudit = connection.prepareStatement(auditSql)) {

    updateCase.executeUpdate();
    insertAudit.executeUpdate();

    connection.commit();
} catch (SQLException e) {
    connection.rollback();
    throw e;
}
```

Jika statement berbeda memakai connection berbeda, maka tidak otomatis satu transaction.

Buruk:

```java
caseRepository.updateStatus(caseId); // get connection sendiri
caseAuditRepository.insertAudit(caseId); // get connection lain
```

Jika masing-masing membuka connection sendiri tanpa transaction manager bersama, atomicity hilang.

Rule:

```text
Atomic operation requires shared transaction boundary.
Shared transaction boundary in JDBC means shared connection/session or transaction manager that binds connection correctly.
```

---

## 29. Interaction dengan Connection Pool

Saat memakai HikariCP atau pool lain, `Connection` yang Anda dapat biasanya proxy.

```java
Connection c = dataSource.getConnection();
```

`PreparedStatement` juga bisa berupa wrapper/proxy dari driver/pool.

Ketika Anda menutup `PreparedStatement`, resource statement dilepas. Ketika Anda menutup `Connection`, logical connection kembali ke pool. Physical connection tidak selalu ditutup.

Implikasi:

1. Statement tidak boleh hidup lebih lama dari borrowed connection.
2. ResultSet tidak boleh dibaca setelah connection ditutup.
3. Long-running result set menahan connection dari pool.
4. Streaming response HTTP sambil memegang ResultSet bisa menghabiskan pool.
5. Batch besar menahan connection lama.
6. Query lambat bukan hanya masalah database, tapi juga pool starvation.

Contoh buruk:

```java
Stream<User> stream = repository.streamUsers();
// Stream lazy memegang ResultSet dan Connection di luar repository scope
```

Jika caller lambat atau lupa close stream, connection leak terjadi.

Jika memang ingin stream, desain harus eksplisit:

```java
try (Stream<User> users = repository.streamUsers()) {
    users.forEach(...);
}
```

Tetapi implementasi ini sulit dibuat benar dengan JDBC mentah. Callback sering lebih aman.

---

## 30. Execution Layer Observability

Pada layer statement, minimal ukur:

1. SQL shape/fingerprint,
2. execution time,
3. rows returned,
4. update count,
5. batch size,
6. query timeout occurrence,
7. SQLState,
8. vendor error code,
9. connection acquisition time,
10. transaction duration.

Jangan log bind value sensitif secara mentah.

Buruk:

```text
select * from user where nric = 'S1234567A'
```

Lebih aman:

```text
sql="select * from user where nric = ?", bindTypes=[VARCHAR], bindValueClasses=[String]
```

Untuk debugging terbatas, bisa pakai redaction:

```text
nric=<redacted>, email=<redacted>, status=ACTIVE
```

Prinsip:

```text
Observe query behavior, not leak user data.
```

---

## 31. Review Checklist untuk Statement Layer

Gunakan checklist ini saat review PR.

### 31.1 Safety

- [ ] Tidak ada string concatenation untuk value.
- [ ] Dynamic identifier memakai whitelist.
- [ ] Sensitive bind value tidak dilog mentah.
- [ ] SQL injection boundary jelas.

### 31.2 Correctness

- [ ] Parameter index benar dan semua parameter di-set.
- [ ] Null parameter memakai SQL type eksplisit.
- [ ] Update count divalidasi.
- [ ] Cardinality result dicek.
- [ ] Generated keys dicek ada/tidak.
- [ ] Multiple results dikonsumsi jika memakai procedure.

### 31.3 Resource

- [ ] `Connection`, `Statement`, `ResultSet` ditutup dalam scope jelas.
- [ ] Tidak return `ResultSet` mentah.
- [ ] Tidak cache `PreparedStatement` global.
- [ ] Streaming result punya ownership close eksplisit.

### 31.4 Performance

- [ ] Query besar punya limit/pagination/streaming.
- [ ] Fetch size dipertimbangkan untuk result besar.
- [ ] Batch memakai chunk.
- [ ] Prepared statement digunakan untuk repeated parameterized query.
- [ ] Driver behavior khusus dicek untuk batch/prepared statement performance.

### 31.5 Reliability

- [ ] Query timeout dipertimbangkan.
- [ ] SQLException tidak ditelan.
- [ ] Batch partial failure dipikirkan.
- [ ] Long-running statement tidak menahan pool sembarangan.

---

## 32. Studi Kasus: Regulatory Case State Transition

Bayangkan sistem case management dengan state:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED / REJECTED
```

Requirement:

1. Hanya case `UNDER_REVIEW` yang boleh di-approve.
2. Harus insert audit trail.
3. Harus atomic.
4. Jika dua officer approve/reject bersamaan, hanya satu menang.

Naive implementation:

```java
Case c = caseRepository.findById(caseId);
if (!c.status().equals("UNDER_REVIEW")) {
    throw new InvalidStateException();
}
caseRepository.updateStatus(caseId, "APPROVED");
auditRepository.insert(caseId, "APPROVE");
```

Masalah:

1. Race condition antara read dan update.
2. Transaction boundary bisa terpisah.
3. Audit bisa berhasil saat update gagal atau sebaliknya.
4. Update count tidak dicek.

JDBC-aware implementation:

```java
public void approve(long caseId, long officerId) throws SQLException {
    String updateSql = """
        update case_file
        set status = ?, approved_by = ?, approved_at = current_timestamp
        where id = ? and status = ?
        """;

    String auditSql = """
        insert into case_audit(case_id, action, actor_id, created_at)
        values (?, ?, ?, current_timestamp)
        """;

    try (Connection c = dataSource.getConnection()) {
        boolean originalAutoCommit = c.getAutoCommit();
        c.setAutoCommit(false);

        try {
            try (PreparedStatement ps = c.prepareStatement(updateSql)) {
                ps.setString(1, "APPROVED");
                ps.setLong(2, officerId);
                ps.setLong(3, caseId);
                ps.setString(4, "UNDER_REVIEW");

                int updated = ps.executeUpdate();
                if (updated == 0) {
                    throw new InvalidStateTransitionException(
                        "Case is not UNDER_REVIEW: " + caseId
                    );
                }
                if (updated != 1) {
                    throw new IllegalStateException("Expected 1 updated row, got " + updated);
                }
            }

            try (PreparedStatement ps = c.prepareStatement(auditSql)) {
                ps.setLong(1, caseId);
                ps.setString(2, "APPROVE");
                ps.setLong(3, officerId);

                int inserted = ps.executeUpdate();
                if (inserted != 1) {
                    throw new IllegalStateException("Expected 1 audit row, got " + inserted);
                }
            }

            c.commit();
        } catch (Exception e) {
            c.rollback();
            throw e;
        } finally {
            c.setAutoCommit(originalAutoCommit);
        }
    }
}
```

Mental model:

```text
State transition correctness is encoded in SQL predicate.
Update count is the concurrency signal.
Audit insert shares the same transaction.
PreparedStatement binds values safely.
Connection carries the transaction.
```

Ini bukan sekadar “JDBC code”. Ini adalah enforcement lifecycle correctness.

---

## 33. Ringkasan Mental Model

Setelah bagian ini, model Anda harus seperti ini:

```text
Connection = database session / transaction carrier
Statement = command object for raw SQL
PreparedStatement = command object for parameterized SQL
CallableStatement = command object for stored procedure/function
ResultSet = cursor-like result view
```

Execution pipeline:

```text
prepare/create command
  -> bind parameters
  -> execute
  -> consume result/update count/output parameter
  -> close result
  -> close statement
  -> commit/rollback if transaction
  -> close/return connection
```

Prinsip production:

1. Gunakan `PreparedStatement` untuk semua SQL dengan value dinamis.
2. Jangan bind identifier; whitelist identifier.
3. Validasi update count.
4. Jangan return JDBC resource mentah ke layer atas.
5. Jangan cache statement object global.
6. Pahami bahwa prepared statement behavior bergantung driver.
7. Batch harus chunked dan transaction-aware.
8. Query timeout, fetch size, max rows adalah control surface, bukan magic.
9. Stored procedure harus diperlakukan sebagai contract boundary, bukan tempat menyembunyikan logic tanpa governance.
10. Statement execution adalah tempat correctness, performance, security, dan reliability bertemu.

---

## 34. Referensi Resmi dan Lanjutan

Referensi yang relevan untuk bagian ini:

1. Java SE API Documentation — `java.sql.Statement`, `PreparedStatement`, `CallableStatement`, `Connection`, `ResultSet`.
2. Oracle JDBC Tutorial — menggunakan prepared statement, stored procedure, batch update, dan generated keys.
3. PostgreSQL JDBC Documentation — server prepared statements dan `prepareThreshold`.
4. MySQL Connector/J Documentation — configuration properties seperti prepared statement cache dan batch rewrite.
5. Dokumentasi driver database yang dipakai di production, karena behavior prepared statement, batch, generated keys, timeout, dan fetch size sangat driver-specific.

---

## 35. Apa yang Tidak Dibahas Panjang di Part Ini

Agar tidak overlap dengan bagian lain:

1. Detail `ResultSet` cursor, streaming, scrollability, null getter, dan memory akan dibahas di Part 005.
2. SQL type mapping mendalam akan dibahas di Part 006.
3. Transaction detail akan dibahas di Part 007.
4. Isolation/locking akan dibahas di Part 008.
5. SQLException taxonomy akan dibahas di Part 009.
6. Resource lifecycle dan leak akan dibahas lagi lebih sistematis di Part 010.
7. Batch lebih advanced akan dibahas di Part 012.
8. Stored procedure lebih advanced akan dibahas di Part 016.
9. Performance model akan dibahas di Part 017.
10. HikariCP dan pooling akan masuk mulai Part 018.

---

## 36. Latihan Praktis

Untuk menguatkan pemahaman, coba implementasikan mini repository JDBC mentah dengan method berikut:

1. `Optional<User> findById(long id)`
2. `List<User> findByStatus(String status, int limit)`
3. `long insertUser(CreateUserCommand command)` dengan generated key
4. `boolean transitionStatus(long id, String fromStatus, String toStatus)` berbasis update count
5. `void insertEvents(List<Event> events)` dengan chunked batch
6. `int callRecalculateScore(long caseId)` dengan `CallableStatement`

Constraint:

1. Semua value harus pakai bind parameter.
2. Dynamic sort harus whitelist.
3. Semua resource harus try-with-resources.
4. Semua update count harus dicek.
5. Batch size tidak boleh lebih dari 1000.
6. Query yang bisa besar harus punya limit atau fetch size.
7. Tidak boleh return `ResultSet`, `Statement`, atau `Connection` dari repository.

Jika latihan ini terasa “terlalu manual”, itu normal. Justru dari sini Anda akan lebih paham apa yang disederhanakan oleh Spring JDBC, jOOQ, MyBatis, Hibernate, dan transaction manager.

---

# Status Seri

```text
Part 004 dari 029 selesai.
Seri belum selesai.
Part berikutnya: Part 005 — ResultSet Deep Dive: Cursor, Fetching, Streaming, and Memory
File berikutnya: learn-java-sql-jdbc-hikaricp-part-005.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-sql-jdbc-hikaricp-part-003](./learn-java-sql-jdbc-hikaricp-part-003.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-sql-jdbc-hikaricp-part-005](./learn-java-sql-jdbc-hikaricp-part-005.md)
