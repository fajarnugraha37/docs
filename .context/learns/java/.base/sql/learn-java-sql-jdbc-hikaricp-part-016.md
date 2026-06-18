# learn-java-sql-jdbc-hikaricp-part-016

# Stored Procedures and `CallableStatement`

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `016 / 029`  
> Topik: Stored Procedure, Function, `CallableStatement`, OUT parameter, cursor return, multiple result sets, transaction boundary, error propagation, versioning, dan architectural trade-off.

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya kita sudah membangun fondasi:

1. JDBC sebagai boundary Java ↔ database.
2. Anatomi `java.sql` / `javax.sql`.
3. Driver sebagai implementasi protocol database.
4. `Connection` sebagai database session.
5. `Statement` / `PreparedStatement` execution model.
6. `ResultSet` sebagai cursor/fetching abstraction.
7. Type mapping.
8. Transaction, isolation, locking, error handling, resource lifecycle.
9. `DataSource`, batch, LOB, metadata, dan advanced type features.

Part ini masuk ke salah satu area yang sering membuat desain enterprise menjadi kuat atau justru sangat kusut: **stored procedure dan `CallableStatement`**.

Di permukaan, `CallableStatement` terlihat seperti variasi kecil dari `PreparedStatement`:

```java
try (CallableStatement cs = connection.prepareCall("{call approve_case(?, ?)}")) {
    cs.setLong(1, caseId);
    cs.setString(2, officerId);
    cs.execute();
}
```

Tetapi secara arsitektur, procedure call bisa berarti banyak hal:

- hanya wrapper untuk satu query;
- command transactional yang mengubah banyak tabel;
- domain service yang hidup di database;
- integration boundary untuk legacy system;
- reporting/bulk-processing engine;
- security boundary;
- atau black box yang menyembunyikan coupling, lock, side effect, dan error contract.

Jadi target part ini bukan sekadar “cara memanggil stored procedure dari Java”, tetapi memahami:

> Apa konsekuensi ketika sebagian logic aplikasi dipindahkan ke database, lalu dipanggil melalui JDBC?

---

## 1. Mental Model Utama

### 1.1 `CallableStatement` adalah Prepared Statement untuk Routine Call

Secara hierarchy JDBC:

```text
Statement
  └── PreparedStatement
        └── CallableStatement
```

Artinya `CallableStatement` mewarisi banyak sifat `PreparedStatement`:

- SQL/call text dikirim sebagai statement yang bisa memiliki parameter.
- Parameter input di-bind dengan `setXxx()`.
- Execution menghasilkan update count, result set, atau output parameter.
- Resource harus ditutup.
- Error tetap muncul sebagai `SQLException`.
- Perilaku detail tetap driver/database-specific.

Tetapi ada perbedaan penting:

`PreparedStatement` biasanya mengeksekusi SQL DML/query langsung:

```sql
select * from cases where id = ?
update cases set status = ? where id = ?
insert into audit_trail (...) values (...)
```

`CallableStatement` mengeksekusi **routine**:

```sql
call approve_case(?, ?)
? = call calculate_penalty(?)
```

Routine itu bisa berupa:

- stored procedure;
- stored function;
- PL/SQL procedure/function;
- database package procedure;
- database-specific routine;
- routine yang mengembalikan cursor/result set.

---

### 1.2 Procedure Call adalah RPC ke Database Session

Mental model yang lebih tepat:

```text
Java method
  -> JDBC CallableStatement
    -> database routine invocation
      -> routine runs inside database engine
        -> may read/write tables
        -> may acquire locks
        -> may allocate cursors
        -> may call other routines
        -> may raise database exception
        -> may return OUT values / result sets / update counts
```

Jadi procedure call mirip **remote procedure call**, tetapi targetnya bukan service HTTP/gRPC, melainkan database session.

Konsekuensinya:

1. Ia punya latency network.
2. Ia memakai connection/session tertentu.
3. Ia hidup dalam transaction context connection itu.
4. Ia bisa meninggalkan session state jika tidak hati-hati.
5. Ia bisa mengunci data seperti query biasa.
6. Ia bisa gagal dengan error database-specific.
7. Ia harus diperlakukan sebagai boundary kontrak.

---

### 1.3 Procedure Bukan Magic Performance Button

Salah satu asumsi lemah yang sering muncul:

> “Kalau logic dipindahkan ke stored procedure pasti lebih cepat.”

Ini tidak selalu benar.

Stored procedure bisa lebih cepat jika:

- mengurangi round-trip Java ↔ database;
- melakukan operasi bulk dekat dengan data;
- menghindari transfer row besar ke aplikasi;
- memakai fitur database engine secara optimal;
- menjalankan logic set-based, bukan row-by-row;
- mengurangi chattiness antar layer.

Tetapi stored procedure bisa lebih lambat/berbahaya jika:

- logic procedural di database melakukan loop row-by-row;
- execution plan buruk tetapi tersembunyi;
- procedure terlalu besar dan sulit diobservasi;
- lock ditahan terlalu lama;
- result set besar tetap dikirim ke Java;
- error handling tidak eksplisit;
- versioning tidak dikelola;
- aplikasi kehilangan kontrol transaction boundary.

Kunci berpikirnya:

> Stored procedure bukan optimisasi otomatis. Ia adalah pemindahan execution boundary ke database. Benefit-nya tergantung work shape.

---

## 2. Istilah: Procedure, Function, Package, Routine

### 2.1 Stored Procedure

Stored procedure adalah routine yang disimpan di database dan dipanggil untuk menjalankan operasi.

Karakter umum:

- bisa memiliki parameter IN, OUT, INOUT;
- bisa melakukan DML;
- bisa memanggil procedure lain;
- bisa mengembalikan result set tergantung database;
- biasanya dipanggil dengan syntax `CALL` atau block database-specific.

Contoh konseptual:

```sql
CREATE PROCEDURE approve_case(
    IN p_case_id BIGINT,
    IN p_officer_id VARCHAR(100)
)
BEGIN
    UPDATE cases
       SET status = 'APPROVED', approved_by = p_officer_id
     WHERE id = p_case_id;

    INSERT INTO audit_trail(case_id, activity)
    VALUES (p_case_id, 'APPROVED');
END;
```

---

### 2.2 Stored Function

Stored function biasanya mengembalikan nilai.

Contoh:

```sql
CREATE FUNCTION calculate_penalty(p_case_id BIGINT)
RETURNS DECIMAL(18, 2)
...
```

Dipanggil dari JDBC dengan escape syntax function:

```java
try (CallableStatement cs = connection.prepareCall("{? = call calculate_penalty(?)}")) {
    cs.registerOutParameter(1, Types.DECIMAL);
    cs.setLong(2, caseId);
    cs.execute();
    BigDecimal penalty = cs.getBigDecimal(1);
}
```

Tetapi jangan samakan semua database:

- Ada database yang membedakan procedure dan function dengan ketat.
- Ada yang historisnya lebih function-oriented.
- Ada yang mendukung result set dari procedure.
- Ada yang function returning set sebaiknya dipanggil sebagai query biasa, bukan `CallableStatement`.
- Ada database-specific syntax yang lebih stabil daripada JDBC escape syntax untuk kasus tertentu.

---

### 2.3 Package / Module Routine

Pada Oracle, routine bisa berada dalam package:

```sql
BEGIN
    case_workflow_pkg.approve_case(?, ?);
END;
```

Atau memakai escape syntax jika cocok:

```java
connection.prepareCall("{call case_workflow_pkg.approve_case(?, ?)}");
```

Package memberi namespace dan bisa mengelompokkan procedure/function terkait. Tetapi dari sisi Java, package routine tetap callable unit dengan kontrak parameter, transaction behavior, dan error behavior.

---

### 2.4 Routine sebagai Contract

Dalam desain production, procedure/function harus diperlakukan seperti API:

```text
Name
Parameters
Types
Nullability
Default behavior
Transaction expectation
Locking behavior
Result shape
Error codes
Idempotency
Versioning policy
Performance budget
Security/grant model
```

Jika procedure dianggap “sekadar script DB”, maka integrasi Java akan rapuh.

---

## 3. JDBC Call Syntax

### 3.1 JDBC Escape Syntax untuk Procedure

Bentuk umum procedure:

```java
CallableStatement cs = connection.prepareCall("{call procedure_name(?, ?, ?)}");
```

Parameter `?` dapat mewakili:

- IN parameter;
- OUT parameter;
- INOUT parameter.

Untuk IN:

```java
cs.setLong(1, caseId);
```

Untuk OUT:

```java
cs.registerOutParameter(2, Types.VARCHAR);
```

Untuk INOUT:

```java
cs.setInt(1, currentValue);
cs.registerOutParameter(1, Types.INTEGER);
```

---

### 3.2 JDBC Escape Syntax untuk Function

Bentuk umum function:

```java
CallableStatement cs = connection.prepareCall("{? = call function_name(?)}");
```

Parameter pertama adalah return value:

```java
cs.registerOutParameter(1, Types.INTEGER);
cs.setLong(2, caseId);
cs.execute();
int result = cs.getInt(1);
```

Perhatikan index:

```text
{? = call function_name(?)}
 ^                        ^
 index 1 return           index 2 input
```

Kesalahan umum adalah menganggap input pertama tetap index 1.

---

### 3.3 Database-Specific Call Syntax

Beberapa database mendukung atau menganjurkan syntax khusus.

Contoh Oracle PL/SQL block:

```java
try (CallableStatement cs = connection.prepareCall("begin case_pkg.approve_case(?, ?); end;")) {
    cs.setLong(1, caseId);
    cs.setString(2, officerId);
    cs.execute();
}
```

Contoh generic escape:

```java
try (CallableStatement cs = connection.prepareCall("{call case_pkg.approve_case(?, ?)}")) {
    cs.setLong(1, caseId);
    cs.setString(2, officerId);
    cs.execute();
}
```

Mana yang dipilih?

Gunakan prinsip:

1. Jika butuh portability dasar, mulai dari JDBC escape syntax.
2. Jika menggunakan fitur vendor seperti package, cursor, record/object type, atau PL/SQL block, database-specific syntax sering lebih jelas.
3. Jangan berpura-pura portable jika routine sendiri sudah vendor-specific.

---

### 3.4 Named Parameter vs Positional Parameter

JDBC `CallableStatement` punya method untuk parameter bernama, seperti:

```java
cs.setString("officer_id", officerId);
cs.registerOutParameter("result_code", Types.INTEGER);
```

Namun dukungannya tidak selalu konsisten antar driver.

Rekomendasi praktis:

- Untuk portability dan predictable behavior, gunakan positional parameter.
- Untuk database/driver yang memang matang named parameter-nya, boleh dipakai, tetapi bungkus dalam adapter dan test integrasi.
- Jangan campur positional dan named parameter dalam satu style kecuali driver jelas mendukung.

---

## 4. Basic CallableStatement Patterns

### 4.1 Procedure dengan IN Parameter

```java
public void approveCase(Connection connection, long caseId, String officerId) throws SQLException {
    String sql = "{call approve_case(?, ?)}";

    try (CallableStatement cs = connection.prepareCall(sql)) {
        cs.setLong(1, caseId);
        cs.setString(2, officerId);
        cs.execute();
    }
}
```

Mental model:

```text
Java binds caseId/officerId
  -> database receives call
  -> procedure executes in same connection transaction
  -> no Java-visible return except success/failure
```

Use case cocok:

- command yang seluruh side effect-nya ada di database;
- procedure tidak perlu mengembalikan data besar;
- Java hanya perlu tahu berhasil/gagal.

---

### 4.2 Procedure dengan OUT Parameter

```java
public ApprovalResult approveCase(Connection connection, long caseId, String officerId) throws SQLException {
    String sql = "{call approve_case(?, ?, ?, ?)}";

    try (CallableStatement cs = connection.prepareCall(sql)) {
        cs.setLong(1, caseId);
        cs.setString(2, officerId);
        cs.registerOutParameter(3, Types.INTEGER); // result code
        cs.registerOutParameter(4, Types.VARCHAR); // message

        cs.execute();

        int code = cs.getInt(3);
        String message = cs.getString(4);

        return new ApprovalResult(code, message);
    }
}

public record ApprovalResult(int code, String message) {}
```

Rule penting:

1. Register OUT parameter sebelum `execute()`.
2. Baca OUT parameter setelah `execute()`.
3. Gunakan SQL type yang sesuai.
4. Handle NULL dengan benar.

---

### 4.3 INOUT Parameter

INOUT berarti parameter punya nilai awal dari Java dan nilai akhir dari database.

```java
try (CallableStatement cs = connection.prepareCall("{call increment_counter(?)}")) {
    cs.setInt(1, 10);
    cs.registerOutParameter(1, Types.INTEGER);

    cs.execute();

    int updated = cs.getInt(1);
}
```

INOUT bisa membuat kontrak kurang jelas jika berlebihan. Untuk API procedure yang maintainable, lebih baik gunakan:

```text
IN input_1, input_2, ...
OUT output_1, output_2, ...
```

Daripada banyak parameter INOUT yang mengubah makna sebelum/sesudah.

---

### 4.4 Function Return Value

```java
public BigDecimal calculatePenalty(Connection connection, long caseId) throws SQLException {
    String sql = "{? = call calculate_penalty(?)}";

    try (CallableStatement cs = connection.prepareCall(sql)) {
        cs.registerOutParameter(1, Types.DECIMAL);
        cs.setLong(2, caseId);

        cs.execute();

        return cs.getBigDecimal(1);
    }
}
```

Function cocok untuk:

- deterministic computation dekat dengan data;
- lookup sederhana;
- expression yang bisa dipakai SQL;
- business calculation yang memang database-owned.

Tetapi hati-hati:

- Function yang melakukan write side effect sering membingungkan.
- Function yang melakukan query kompleks bisa tersembunyi dari application observability.
- Function yang dipanggil per-row dalam query bisa sangat mahal.

---

### 4.5 Procedure yang Mengembalikan ResultSet

Beberapa database/driver memungkinkan procedure mengembalikan result set.

Pattern generic:

```java
try (CallableStatement cs = connection.prepareCall("{call search_cases(?)}")) {
    cs.setString(1, status);

    boolean hasResultSet = cs.execute();

    if (hasResultSet) {
        try (ResultSet rs = cs.getResultSet()) {
            while (rs.next()) {
                long id = rs.getLong("id");
                String title = rs.getString("title");
                // map row
            }
        }
    }
}
```

Tetapi detailnya sangat vendor-specific:

- Oracle sering memakai `REF CURSOR` sebagai OUT parameter.
- PostgreSQL punya function returning `refcursor`, `SETOF`, atau procedure behavior berbeda.
- MySQL procedure dapat menghasilkan result set dari `SELECT` di dalam procedure.

Jangan buat abstraction yang menganggap semua database sama.

---

## 5. Execution Methods: `execute`, `executeQuery`, `executeUpdate`

Karena `CallableStatement` extends `PreparedStatement`, ia punya beberapa method execution.

### 5.1 `execute()`

`execute()` adalah pilihan paling umum untuk procedure karena procedure bisa menghasilkan:

- result set;
- update count;
- OUT parameter;
- multiple result sets;
- kombinasi beberapa output.

```java
boolean hasResultSet = cs.execute();
```

Return value:

```text
true  -> first result is ResultSet
false -> first result is update count or no result
```

Setelah itu bisa pakai:

```java
cs.getResultSet();
cs.getUpdateCount();
cs.getMoreResults();
```

---

### 5.2 `executeQuery()`

Gunakan jika kontrak procedure/function jelas menghasilkan single `ResultSet`.

```java
try (CallableStatement cs = connection.prepareCall("{call list_open_cases()}")) {
    try (ResultSet rs = cs.executeQuery()) {
        while (rs.next()) {
            // map
        }
    }
}
```

Hati-hati: tidak semua procedure yang menghasilkan cursor cocok dipanggil `executeQuery()` tergantung driver.

---

### 5.3 `executeUpdate()`

Gunakan jika kontrak routine jelas hanya menghasilkan update count / DML effect.

```java
try (CallableStatement cs = connection.prepareCall("{call archive_old_cases(?)}")) {
    cs.setDate(1, Date.valueOf(cutoffDate));
    int count = cs.executeUpdate();
}
```

Namun banyak stored procedure tidak mengembalikan update count dengan cara yang portable. Untuk command procedure, `execute()` sering lebih aman.

---

## 6. OUT Parameter Deep Dive

### 6.1 Register dengan SQL Type

OUT parameter harus didaftarkan dengan SQL type:

```java
cs.registerOutParameter(2, Types.VARCHAR);
cs.registerOutParameter(3, Types.INTEGER);
cs.registerOutParameter(4, Types.TIMESTAMP);
```

SQL type harus sesuai dengan tipe yang dikembalikan routine.

Kesalahan umum:

```java
cs.registerOutParameter(1, Types.VARCHAR);
int value = cs.getInt(1); // mismatch konseptual
```

Kadang driver melakukan konversi, kadang gagal, kadang menghasilkan truncation/rounding. Untuk production, jangan bergantung pada coercion implisit.

---

### 6.2 OUT Parameter NULL

Untuk output object getter:

```java
String msg = cs.getString(2); // returns null if SQL NULL
```

Untuk primitive getter:

```java
int code = cs.getInt(3);
if (cs.wasNull()) {
    // SQL NULL, bukan angka 0
}
```

Lebih aman untuk value nullable:

```java
Integer code = (Integer) cs.getObject(3);
```

Atau JDBC 4.1+ typed object jika didukung:

```java
Integer code = cs.getObject(3, Integer.class);
```

Tetapi support driver untuk typed getter harus diuji.

---

### 6.3 Scale untuk Numeric OUT Parameter

Beberapa overload `registerOutParameter` menerima scale:

```java
cs.registerOutParameter(1, Types.DECIMAL, 2);
```

Gunakan ketika numeric scale penting, tetapi tetap validasi dengan driver/database. Untuk uang/penalty/fee, mapping paling aman biasanya `BigDecimal`.

---

### 6.4 OUT Parameter sebagai Error Contract

Banyak sistem legacy memakai pola:

```text
OUT result_code
OUT result_message
```

Contoh:

```java
cs.registerOutParameter(3, Types.VARCHAR); // status
cs.registerOutParameter(4, Types.VARCHAR); // message
cs.execute();

String status = cs.getString(3);
String message = cs.getString(4);

if (!"OK".equals(status)) {
    throw new ProcedureBusinessException(status, message);
}
```

Pola ini bisa valid, tetapi jangan campur tanpa aturan dengan exception database.

Harus jelas:

```text
Business rejection -> OUT status/result code
Technical failure  -> SQLException / database exception
```

Jika semua hal dikembalikan sebagai `status = ERROR`, Java sulit membedakan:

- validation error;
- duplicate request;
- lock timeout;
- deadlock;
- data corruption;
- missing grant;
- syntax/runtime bug procedure.

---

## 7. Result Set dari Stored Procedure

### 7.1 SELECT di Dalam Procedure

Beberapa database mengizinkan procedure seperti:

```sql
CREATE PROCEDURE list_open_cases()
BEGIN
    SELECT id, title, status
      FROM cases
     WHERE status = 'OPEN';
END;
```

Java:

```java
try (CallableStatement cs = connection.prepareCall("{call list_open_cases()}")) {
    boolean hasResultSet = cs.execute();

    if (!hasResultSet) {
        throw new SQLException("Expected result set from list_open_cases");
    }

    try (ResultSet rs = cs.getResultSet()) {
        while (rs.next()) {
            // map row
        }
    }
}
```

Kelemahan:

- result shape bisa berubah tanpa compiler error di Java;
- metadata tidak selalu cukup untuk kontrak stabil;
- filtering/pagination bisa tersembunyi;
- query plan observability pindah ke DB side;
- consumer Java harus tahu ordering/result columns.

---

### 7.2 Cursor OUT Parameter

Di database tertentu, procedure mengembalikan cursor sebagai OUT parameter.

Conceptual pattern:

```java
try (CallableStatement cs = connection.prepareCall("{call open_case_cursor(?)}")) {
    cs.registerOutParameter(1, Types.REF_CURSOR); // JDBC 4.2+ where supported
    cs.execute();

    try (ResultSet rs = (ResultSet) cs.getObject(1)) {
        while (rs.next()) {
            // map
        }
    }
}
```

Vendor-specific caveat:

- Oracle historically used `OracleTypes.CURSOR` before standard `Types.REF_CURSOR` support became common.
- PostgreSQL refcursor has transaction implications; cursor may require transaction scope to remain open.
- Support for `Types.REF_CURSOR` varies by driver version.

Rule:

> Cursor returned from procedure is still a database resource. Treat it with the same discipline as `ResultSet`: consume within scope, close properly, do not leak outside repository boundary.

---

### 7.3 Function Returning Set

Beberapa database punya function returning set/table.

Sering kali lebih natural dipanggil sebagai query biasa:

```java
try (PreparedStatement ps = connection.prepareStatement(
        "select * from search_cases(?)"
)) {
    ps.setString(1, keyword);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            // map
        }
    }
}
```

Daripada:

```java
connection.prepareCall("{call search_cases(?)}")
```

Alasannya:

- result set adalah query result;
- lebih mudah diberi pagination/order/filter;
- lebih jelas untuk optimizer/query logging;
- lebih cocok dengan mapping pipeline Java.

---

## 8. Multiple Result Sets dan Update Counts

### 8.1 Kenapa Multiple Results Bisa Muncul?

Procedure bisa melakukan beberapa statement:

```sql
UPDATE cases SET status = 'CLOSED' WHERE id = p_case_id;
SELECT * FROM cases WHERE id = p_case_id;
SELECT * FROM audit_trail WHERE case_id = p_case_id;
```

Dari sisi JDBC, ini bisa muncul sebagai sequence:

```text
update count
result set 1
result set 2
no more result
```

---

### 8.2 Membaca Multiple Results

Pattern:

```java
try (CallableStatement cs = connection.prepareCall("{call close_case_and_fetch_details(?)}")) {
    cs.setLong(1, caseId);

    boolean hasResultSet = cs.execute();

    while (true) {
        if (hasResultSet) {
            try (ResultSet rs = cs.getResultSet()) {
                while (rs.next()) {
                    // map current result set
                }
            }
        } else {
            int updateCount = cs.getUpdateCount();
            if (updateCount == -1) {
                break;
            }
            // process update count if needed
        }

        hasResultSet = cs.getMoreResults();
    }
}
```

### 8.3 Recommendation

Multiple result sets bisa valid untuk integration/reporting, tetapi kontraknya harus sangat eksplisit:

```text
Result #1: summary row, exactly 1 row
Result #2: detail rows, 0..N rows
Result #3: warnings, 0..N rows
Update counts ignored
```

Tanpa kontrak seperti itu, Java code akan fragile.

Untuk domain command, lebih baik procedure mengembalikan satu DTO-like output kecil atau satu result set jelas.

---

## 9. Transaction Boundary

### 9.1 Procedure Berjalan dalam Transaction Connection

Ini rule paling penting:

> Stored procedure yang dipanggil via JDBC berjalan dalam transaction context milik `Connection` yang memanggilnya.

Jika `autoCommit = true`, behavior-nya kira-kira:

```text
call procedure
  -> database executes routine
  -> statement selesai
  -> commit otomatis oleh driver/database semantics
```

Jika `autoCommit = false`:

```text
connection.setAutoCommit(false)
call procedure
call another statement
commit or rollback explicitly
```

Contoh:

```java
connection.setAutoCommit(false);
try {
    callApproveCase(connection, caseId, officerId);
    insertOutboxEvent(connection, caseId, "CASE_APPROVED");
    connection.commit();
} catch (SQLException e) {
    connection.rollback();
    throw e;
}
```

---

### 9.2 Procedure yang Melakukan COMMIT/ROLLBACK Sendiri

Beberapa stored procedure melakukan:

```sql
COMMIT;
```

atau:

```sql
ROLLBACK;
```

di dalam body procedure.

Ini sangat berbahaya jika Java mengira ia memegang transaction boundary.

Contoh bug:

```java
connection.setAutoCommit(false);
try {
    callProcedureThatCommitsInternally(connection);
    insertAudit(connection); // Java pikir ini satu transaction
    connection.rollback();  // tidak bisa membatalkan commit internal procedure
} catch (...) { ... }
```

Dari perspektif service, atomicity rusak.

Rekomendasi:

1. Untuk OLTP application procedure, hindari commit/rollback internal.
2. Transaction owner harus jelas: Java service atau database routine.
3. Jika procedure memang self-committing untuk batch/admin job, namai dan dokumentasikan eksplisit.
4. Jangan campur self-committing procedure dengan application transaction biasa.

---

### 9.3 Savepoint dan Procedure

Jika procedure dipanggil dalam transaction besar, Java bisa membuat savepoint sebelum memanggilnya:

```java
Savepoint sp = connection.setSavepoint("before_procedure");
try {
    callRiskyProcedure(connection, id);
} catch (SQLException e) {
    connection.rollback(sp);
    // continue or translate
}
```

Tetapi ini hanya aman jika procedure tidak melakukan commit/rollback internal.

---

### 9.4 Long-Running Procedure Menahan Connection dan Lock

Procedure yang lama akan:

- menahan borrowed connection dari pool;
- mungkin menahan transaction open;
- mungkin menahan lock;
- membuat thread Java blocked;
- meningkatkan pending connection requests;
- menyebabkan pool exhaustion.

Jika procedure menjalankan batch 10 menit, jangan panggil dari request thread OLTP biasa tanpa desain khusus.

Desain yang lebih baik:

```text
HTTP request
  -> enqueue job / create batch command row
  -> worker calls long procedure using dedicated pool
  -> progress/status polled separately
```

---

## 10. Error Propagation

### 10.1 Database Exception Menjadi SQLException

Jika procedure raise error, driver akan menerjemahkannya menjadi `SQLException` dengan:

- message;
- SQLState;
- vendor error code;
- chained exception;
- possible subclass.

Contoh:

```java
try {
    callApproveCase(connection, caseId, officerId);
} catch (SQLException e) {
    String sqlState = e.getSQLState();
    int vendorCode = e.getErrorCode();
    throw translateProcedureException(e);
}
```

---

### 10.2 Jangan Parse Message sebagai Kontrak Utama

Anti-pattern:

```java
if (e.getMessage().contains("CASE_ALREADY_APPROVED")) {
    throw new CaseAlreadyApprovedException();
}
```

Lebih baik:

- gunakan vendor error code custom jika database mendukung;
- gunakan SQLState/classification;
- gunakan OUT result code untuk business rejection;
- gunakan error table/result contract;
- gunakan constrained exception translation layer.

Parsing message rapuh karena:

- bahasa message bisa berubah;
- driver version bisa mengubah format;
- database patch bisa mengubah teks;
- message bisa mengandung dynamic data.

---

### 10.3 Business Failure vs Technical Failure

Procedure call harus membedakan:

```text
Business failure:
- case already closed
- user not allowed for this transition
- missing mandatory document
- duplicate submission

Technical failure:
- connection lost
- deadlock
- lock timeout
- syntax error in procedure
- missing privilege
- invalid object
- numeric overflow
- cursor limit reached
```

Contoh kontrak yang lebih baik:

```sql
-- OUT result_code examples
OK
CASE_ALREADY_CLOSED
INVALID_TRANSITION
MISSING_DOCUMENT
```

Technical failure tetap exception.

Java translation:

```java
String resultCode = cs.getString(3);
String resultMessage = cs.getString(4);

switch (resultCode) {
    case "OK" -> { return; }
    case "CASE_ALREADY_CLOSED" -> throw new CaseAlreadyClosedException(resultMessage);
    case "INVALID_TRANSITION" -> throw new InvalidTransitionException(resultMessage);
    default -> throw new UnknownProcedureResultException(resultCode, resultMessage);
}
```

---

### 10.4 Retriable Procedure Calls

Retry procedure call jauh lebih berbahaya daripada retry SELECT.

Sebelum retry, jawab:

1. Apakah procedure idempotent?
2. Apakah procedure sudah melakukan sebagian write sebelum error?
3. Apakah transaction rollback otomatis terjadi?
4. Apakah connection masih valid?
5. Apakah error terjadi sebelum atau setelah commit?
6. Apakah procedure punya request id/idempotency key?

Safe retry pattern:

```text
procedure input includes request_id
procedure first checks if request_id already processed
procedure writes idempotency record in same transaction
procedure returns existing result for duplicate request_id
```

Tanpa ini, retry bisa menggandakan side effect.

---

## 11. Parameter Type and Mapping Issues

### 11.1 IN Parameter Binding

Gunakan setter yang semantik tipenya jelas:

```java
cs.setLong(1, caseId);
cs.setString(2, officerId);
cs.setBigDecimal(3, amount);
cs.setObject(4, LocalDate.now());
```

Hindari `setObject()` sembarangan untuk semua hal jika driver behavior belum diuji.

---

### 11.2 NULL Parameter

Untuk input nullable:

```java
if (reason == null) {
    cs.setNull(3, Types.VARCHAR);
} else {
    cs.setString(3, reason);
}
```

Jangan mengandalkan:

```java
cs.setObject(3, null);
```

Karena SQL type hilang dan beberapa driver butuh tipe eksplisit, terutama untuk procedure overload atau type-specific binding.

---

### 11.3 Overloaded Procedure

Database tertentu mendukung procedure overload:

```sql
approve_case(p_case_id NUMBER)
approve_case(p_case_id NUMBER, p_reason VARCHAR2)
```

Dengan JDBC, overload bisa menjadi masalah jika parameter NULL atau type inference ambigu.

Rule:

- Hindari overload untuk procedure yang dipanggil aplikasi Java enterprise.
- Gunakan nama berbeda atau signature eksplisit.
- Jika terpaksa overload, pastikan binding type sangat eksplisit.

---

### 11.4 Date/Time Parameter

Gunakan Java time API jika driver mendukung:

```java
cs.setObject(1, LocalDate.now());
cs.setObject(2, LocalDateTime.now());
cs.setObject(3, OffsetDateTime.now());
```

Tetapi untuk procedure, test secara spesifik:

- apakah database type `DATE` menyimpan time?
- apakah timezone dipreservasi?
- apakah driver mengubah ke session timezone?
- apakah OUT timestamp dikembalikan sebagai `Timestamp`, `LocalDateTime`, atau vendor type?

Untuk sistem regulatory/case-management, timestamp semantics harus eksplisit:

```text
created_at: instant/server timestamp?
due_date: local date without timezone?
submitted_at: citizen-facing timezone?
approved_at: database server time or app time?
```

---

### 11.5 Complex Types

Procedure bisa memakai array, struct/object, JSON, XML, cursor, table-valued parameter, vendor type.

Rekomendasi:

1. Jangan jadikan complex DB type sebagai public application boundary kecuali manfaatnya jelas.
2. Untuk portability, gunakan scalar parameters atau JSON dengan schema validation.
3. Untuk Oracle object/collection, isolasi di adapter khusus.
4. Untuk PostgreSQL array/jsonb, test binding dan indexing behavior.
5. Untuk SQL Server TVP, gunakan driver-specific feature secara sadar.

---

## 12. CallableStatement dan Resource Lifecycle

### 12.1 Close CallableStatement

`CallableStatement` adalah resource:

```java
try (CallableStatement cs = connection.prepareCall("{call p(?)}")) {
    cs.setLong(1, id);
    cs.execute();
}
```

Jangan simpan `CallableStatement` sebagai field singleton/service.

Alasan:

- bound to connection;
- not generally thread-safe;
- can hold cursor/server-side resources;
- can hold parameter/result state;
- invalid after connection close/return.

---

### 12.2 Close ResultSet dari Procedure

Jika procedure menghasilkan `ResultSet`, close result set:

```java
try (CallableStatement cs = connection.prepareCall("{call list_cases()}")) {
    try (ResultSet rs = cs.executeQuery()) {
        while (rs.next()) {
            // map
        }
    }
}
```

Jika cursor diperoleh via OUT param:

```java
try (CallableStatement cs = connection.prepareCall("{call open_cursor(?)}")) {
    cs.registerOutParameter(1, Types.REF_CURSOR);
    cs.execute();

    try (ResultSet rs = (ResultSet) cs.getObject(1)) {
        while (rs.next()) {
            // map
        }
    }
}
```

---

### 12.3 Jangan Return ResultSet ke Layer Atas

Anti-pattern:

```java
public ResultSet listCases(Connection connection) throws SQLException {
    CallableStatement cs = connection.prepareCall("{call list_cases()}");
    return cs.executeQuery();
}
```

Masalah:

- siapa menutup `CallableStatement`?
- siapa menutup `ResultSet`?
- connection tetap borrowed;
- transaction mungkin tetap open;
- cursor bisa bocor;
- caller bisa lupa consume.

Lebih baik:

```java
public List<CaseSummary> listCases(Connection connection) throws SQLException {
    List<CaseSummary> result = new ArrayList<>();

    try (CallableStatement cs = connection.prepareCall("{call list_cases()}")) {
        try (ResultSet rs = cs.executeQuery()) {
            while (rs.next()) {
                result.add(mapCaseSummary(rs));
            }
        }
    }

    return result;
}
```

Untuk data besar, gunakan callback/streaming dengan ownership jelas:

```java
public void forEachCase(Connection connection, Consumer<CaseSummary> consumer) throws SQLException {
    try (CallableStatement cs = connection.prepareCall("{call list_cases()}")) {
        try (ResultSet rs = cs.executeQuery()) {
            while (rs.next()) {
                consumer.accept(mapCaseSummary(rs));
            }
        }
    }
}
```

---

## 13. Procedure sebagai Domain Boundary

### 13.1 Kapan Procedure Masuk Akal?

Stored procedure bisa masuk akal jika:

1. Data dan logic sangat dekat.
2. Operasi membutuhkan banyak DML kecil yang bisa dikurangi round-trip-nya.
3. Operasi bulk/reporting lebih efisien di database.
4. Legacy system sudah expose contract melalui procedure.
5. Security model mengharuskan aplikasi hanya execute procedure, bukan direct table access.
6. Data correction/admin operation harus controlled dan auditable.
7. Operasi membutuhkan fitur database khusus.

Contoh masuk akal:

```text
approve_case_transactionally(case_id, officer_id)
- validate current state
- insert transition row
- update case status
- insert audit trail
- write outbox row
- return result code
```

Jika semua data ada di DB yang sama dan transition harus atomic, procedure bisa menjadi boundary kuat.

---

### 13.2 Kapan Procedure Menjadi Masalah?

Stored procedure bermasalah jika:

1. Business logic terpecah antara Java dan DB tanpa ownership jelas.
2. Procedure memanggil procedure lain secara dalam dan tidak terdokumentasi.
3. Versioning dilakukan manual tanpa migration discipline.
4. Error hanya berupa string message.
5. Query plan/performance tidak dimonitor.
6. Procedure melakukan commit internal tanpa Java tahu.
7. Testing sulit dan tidak masuk CI.
8. Developer aplikasi tidak bisa membaca/mereview logic DB.
9. Deployment aplikasi dan database tidak sinkron.
10. Procedure menjadi dumping ground untuk semua rule.

---

### 13.3 Rule of Ownership

Gunakan aturan ini:

```text
Jika rule ada di Java, Java harus menjadi source of truth.
Jika rule ada di database procedure, procedure harus menjadi source of truth.
Jangan implementasi rule yang sama secara berbeda di dua tempat.
```

Contoh buruk:

```text
Java checks: OPEN -> APPROVED allowed
Procedure checks: OPEN/PENDING_REVIEW -> APPROVED allowed
```

Akhirnya behavior tergantung entry point.

Lebih baik:

```text
Java validates user intent and request shape.
Procedure validates authoritative state transition using current DB state.
Java translates procedure result into domain response.
```

---

## 14. Stored Procedure API Design

### 14.1 Treat Procedure Like Public API

Desain procedure sebaiknya punya contract document:

```text
Name:
  case_workflow.approve_case

Purpose:
  Atomically approves a case if current state allows approval.

Inputs:
  p_case_id       NUMBER      not null
  p_actor_id      VARCHAR2    not null
  p_request_id    VARCHAR2    not null, idempotency key

Outputs:
  p_result_code   VARCHAR2
  p_result_msg    VARCHAR2

Transaction:
  Does not commit or rollback.
  Caller owns transaction.

Locks:
  Locks target case row using SELECT FOR UPDATE.

Errors:
  Business errors returned as result_code.
  Technical errors raised as database exceptions.

Performance budget:
  P95 < 100ms for normal case.

Version:
  v1 stable since migration 2026_06_001.
```

---

### 14.2 Parameter Naming and Ordering

Good:

```text
p_case_id
p_actor_id
p_request_id
p_result_code
p_result_message
```

Bad:

```text
p1
p2
x
out1
msg
```

Ordering recommendation:

```text
IN business identifiers
IN actor/context
IN optional flags
OUT result code
OUT result message
OUT generated ids/summary
```

Example:

```java
try (CallableStatement cs = connection.prepareCall("{call approve_case(?, ?, ?, ?, ?)}")) {
    cs.setLong(1, caseId);
    cs.setString(2, actorId);
    cs.setString(3, requestId);
    cs.registerOutParameter(4, Types.VARCHAR);
    cs.registerOutParameter(5, Types.VARCHAR);
    cs.execute();
}
```

---

### 14.3 Stable Result Codes

Do not use free-form English messages as machine contract.

Good:

```text
OK
CASE_NOT_FOUND
INVALID_CURRENT_STATE
MISSING_REQUIRED_DOCUMENT
DUPLICATE_REQUEST
ACTOR_NOT_AUTHORIZED
```

Bad:

```text
Success
Case is not found.
This case cannot be approved right now.
Something wrong.
```

Message can be human-readable, but code must be stable.

---

### 14.4 Idempotency Key

For command procedure that may be retried, include idempotency key:

```text
p_request_id
```

Procedure behavior:

```text
if request_id already processed:
  return previous result
else:
  process command
  store request_id + outcome
```

This is especially important when Java sees:

- network timeout;
- connection reset;
- unknown commit outcome;
- application retry;
- message redelivery;
- scheduled job retry.

---

## 15. Versioning Stored Procedures

### 15.1 Procedure Changes Are API Changes

Changing any of these is breaking:

- parameter order;
- parameter type;
- parameter nullability;
- result code semantics;
- result set columns;
- transaction behavior;
- commit/rollback behavior;
- lock behavior;
- security grants;
- performance characteristics if callers depend on latency.

---

### 15.2 Versioning Strategies

#### Strategy A — In-place Compatible Change

Safe if only adding internal logic without contract change.

Example:

```text
approve_case stays same signature
new audit insert added internally
same result codes
same transaction behavior
```

Risk: hidden performance/lock behavior still changes.

---

#### Strategy B — Add Optional Parameter with Default

Database-specific and risky for JDBC because call signatures are positional.

```sql
approve_case(p_case_id, p_actor_id, p_reason default null)
```

Java call with old signature may or may not work depending database syntax/driver.

For enterprise stability, prefer explicit new procedure.

---

#### Strategy C — New Versioned Procedure

```text
approve_case_v1
approve_case_v2
```

Pros:

- clear migration;
- old caller remains stable;
- rollback easier.

Cons:

- clutter;
- duplicated logic unless factored internally.

---

#### Strategy D — Package Versioning

```text
case_workflow_v1.approve_case
case_workflow_v2.approve_case
```

Good for large contracts.

---

### 15.3 Migration Discipline

Procedure changes should be managed like schema migration:

```text
V2026_06_001__create_case_workflow_pkg.sql
V2026_06_002__add_approve_case_v2.sql
V2026_06_003__grant_execute_case_workflow.sql
```

Never manually patch production procedure without source control and deployment trace unless emergency process explicitly allows it.

---

## 16. Security Model

### 16.1 Execute Grant vs Table Grant

One advantage of stored procedure:

```text
Application user can EXECUTE procedure
but cannot directly UPDATE table
```

This can enforce database-side access boundary.

Example:

```text
GRANT EXECUTE ON case_workflow_pkg TO app_user;
-- no direct grant to update cases table
```

Benefits:

- restricts surface area;
- centralizes write logic;
- easier audit of allowed operations;
- protects tables from arbitrary app SQL.

Trade-off:

- application flexibility decreases;
- DB code becomes core application code;
- testing/versioning must be mature.

---

### 16.2 Definer Rights vs Invoker Rights

Some databases distinguish whether procedure runs with owner privileges or caller privileges.

Architecture implication:

```text
Definer rights:
  app can execute procedure that accesses tables via procedure owner privileges.

Invoker rights:
  app privileges matter directly during procedure execution.
```

Choose intentionally. Misconfigured rights can cause:

- privilege escalation;
- production-only failure;
- procedure works in DBA session but fails for app user;
- hidden dependency on schema owner.

---

### 16.3 SQL Injection Inside Procedure

Using `CallableStatement` protects Java parameter binding into the call, but does not automatically protect dynamic SQL inside the procedure.

Bad inside procedure:

```sql
EXECUTE IMMEDIATE 'select * from ' || p_table_name || ' where id = ' || p_id;
```

Safer:

- whitelist identifiers;
- bind values inside dynamic SQL;
- avoid dynamic SQL if static SQL works;
- validate input shape;
- keep procedure privileges minimal.

Remember:

> `CallableStatement` prevents injection at Java call boundary, not inside arbitrary dynamic SQL written in the stored procedure.

---

## 17. Performance Model

### 17.1 Procedure Can Reduce Round Trips

Without procedure:

```text
Java -> SELECT case
Java -> UPDATE case
Java -> INSERT audit
Java -> INSERT outbox
Java -> SELECT result
```

With procedure:

```text
Java -> CALL approve_case
```

This can reduce network round trips.

But procedure body still performs database work. Performance improves only if round-trip/chattiness was significant and DB execution remains efficient.

---

### 17.2 Procedure Can Increase Lock Duration

A large procedure might do:

```text
lock row A
query many rows
update child rows
call another procedure
insert audit
compute summary
return cursor
```

If it holds locks across all steps, concurrency suffers.

Design principle:

```text
Acquire lock as late as possible.
Release through commit as soon as possible.
Keep transaction body minimal.
Avoid user/network calls inside database transaction.
```

Database routine should not call external network services in OLTP transaction unless architecture explicitly accepts the risk.

---

### 17.3 Procedure Can Hide N+1

Stored procedure can contain cursor loops:

```sql
FOR r IN (SELECT id FROM cases) LOOP
    SELECT ... INTO ... FROM details WHERE case_id = r.id;
END LOOP;
```

From Java, it looks like one call. From database, it may be N+1 internally.

Observability must inspect database execution, not only Java call count.

---

### 17.4 Statement Cache and Procedure Calls

Procedure call statements may benefit from:

- driver statement cache;
- database library cache/plan cache;
- server-side prepared/call caching;
- package/procedure compiled form.

But do not manually cache `CallableStatement` objects across requests. Let driver/pool/database caching mechanisms handle it.

---

## 18. Observability

### 18.1 Log Procedure Name, Not Full Sensitive Parameters

Good log:

```text
procedure=case_workflow.approve_case
case_id=12345
request_id=REQ-2026-0001
elapsed_ms=84
result_code=OK
```

Bad log:

```text
CALL approve_case(12345, 'NRIC...', 'full citizen data...', ...)
```

Avoid logging sensitive bind values.

---

### 18.2 Metrics

Track:

```text
procedure call count
procedure latency p50/p95/p99
procedure error count by SQLState/vendor code
business result code count
pool acquisition time
connection usage time
transaction duration
rows returned
update count when meaningful
```

Distinguish:

```text
procedure latency = time from execute start to execute end/result consumption
pool acquisition latency = time waiting for connection
transaction duration = time connection is in transaction
```

---

### 18.3 Database-Side Correlation

For production debugging, correlate Java request to database session.

Possible techniques:

- set application name/module/action if driver/database supports;
- set client info on `Connection`;
- pass request id as procedure parameter;
- write request id to audit/outbox table;
- include correlation id in DB session context where supported.

Example conceptual:

```java
connection.setClientInfo("ApplicationName", "case-service");
```

Support varies. Always test driver/database behavior.

---

## 19. Testing Stored Procedure Calls

### 19.1 Do Not Only Mock CallableStatement

Mocking `CallableStatement` can test mapping code, but not real behavior:

- parameter binding;
- OUT parameter registration;
- cursor behavior;
- transaction behavior;
- driver-specific syntax;
- SQLState/vendor error;
- grants;
- procedure compilation;
- result set order.

For serious procedure integration, use real database integration tests.

---

### 19.2 Test Matrix

Minimum test cases:

```text
success path
business rejection path
not found
invalid state
NULL input
large input
OUT parameter NULL
procedure raises technical error
transaction rollback
procedure called twice with same idempotency key
concurrent calls on same entity
deadlock/lock timeout behavior where feasible
permission/grant test
schema migration deployment test
```

---

### 19.3 Transaction Test

Example test idea:

```text
begin transaction
call procedure that updates case
rollback
assert case not updated
```

This catches hidden commit inside procedure.

Pseudo-Java:

```java
connection.setAutoCommit(false);
try {
    callApproveCase(connection, caseId, actorId);
    connection.rollback();
}

try (PreparedStatement ps = connection.prepareStatement(
        "select status from cases where id = ?")) {
    ps.setLong(1, caseId);
    try (ResultSet rs = ps.executeQuery()) {
        rs.next();
        assertEquals("OPEN", rs.getString(1));
    }
}
```

---

### 19.4 Concurrency Test

For workflow state transition:

```text
Thread A calls approve_case(case_id)
Thread B calls reject_case(case_id)
Only one transition may win.
Loser gets stable business result or retriable lock error.
Final state must be valid.
Audit trail must match final state.
```

This is where stored procedure can be powerful: state validation and update can happen atomically near data.

---

## 20. Example: Robust Procedure Caller

Below is a plain JDBC pattern that treats procedure result as a contract.

```java
import java.sql.CallableStatement;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Duration;
import java.util.Objects;

public final class CaseWorkflowProcedures {

    public ApprovalOutcome approveCase(
            Connection connection,
            long caseId,
            String actorId,
            String requestId
    ) throws SQLException {
        Objects.requireNonNull(connection, "connection");
        Objects.requireNonNull(actorId, "actorId");
        Objects.requireNonNull(requestId, "requestId");

        String sql = "{call approve_case(?, ?, ?, ?, ?)}";

        long startNanos = System.nanoTime();

        try (CallableStatement cs = connection.prepareCall(sql)) {
            cs.setLong(1, caseId);
            cs.setString(2, actorId);
            cs.setString(3, requestId);
            cs.registerOutParameter(4, Types.VARCHAR); // result code
            cs.registerOutParameter(5, Types.VARCHAR); // result message

            cs.execute();

            String resultCode = cs.getString(4);
            String resultMessage = cs.getString(5);
            long elapsedMillis = Duration.ofNanos(System.nanoTime() - startNanos).toMillis();

            if (resultCode == null || resultCode.isBlank()) {
                throw new ProcedureContractException("approve_case returned empty result_code");
            }

            return switch (resultCode) {
                case "OK" -> ApprovalOutcome.approved(elapsedMillis);
                case "CASE_NOT_FOUND" -> ApprovalOutcome.rejected("CASE_NOT_FOUND", resultMessage, elapsedMillis);
                case "INVALID_CURRENT_STATE" -> ApprovalOutcome.rejected("INVALID_CURRENT_STATE", resultMessage, elapsedMillis);
                case "DUPLICATE_REQUEST" -> ApprovalOutcome.rejected("DUPLICATE_REQUEST", resultMessage, elapsedMillis);
                default -> throw new ProcedureContractException(
                        "Unknown approve_case result_code: " + resultCode
                );
            };
        }
    }

    public record ApprovalOutcome(
            boolean approved,
            String code,
            String message,
            long elapsedMillis
    ) {
        public static ApprovalOutcome approved(long elapsedMillis) {
            return new ApprovalOutcome(true, "OK", null, elapsedMillis);
        }

        public static ApprovalOutcome rejected(String code, String message, long elapsedMillis) {
            return new ApprovalOutcome(false, code, message, elapsedMillis);
        }
    }

    public static final class ProcedureContractException extends RuntimeException {
        public ProcedureContractException(String message) {
            super(message);
        }
    }
}
```

Points:

1. Procedure call is scoped.
2. `CallableStatement` is closed.
3. OUT params are registered before execution.
4. Result code is treated as stable contract.
5. Unknown result code fails fast.
6. No transaction commit/rollback is hidden here; caller owns it.

---

## 21. Example: Transaction Boundary Around Procedure + Outbox

A common enterprise pattern:

```text
1. Call DB procedure to transition case.
2. Insert outbox event in same transaction.
3. Commit.
4. Separate publisher sends event after commit.
```

Java:

```java
public void approveAndEmit(
        DataSource dataSource,
        long caseId,
        String actorId,
        String requestId
) throws SQLException {
    try (Connection connection = dataSource.getConnection()) {
        boolean originalAutoCommit = connection.getAutoCommit();
        connection.setAutoCommit(false);

        try {
            CaseWorkflowProcedures procedures = new CaseWorkflowProcedures();
            CaseWorkflowProcedures.ApprovalOutcome outcome =
                    procedures.approveCase(connection, caseId, actorId, requestId);

            if (!outcome.approved()) {
                connection.rollback();
                throw new IllegalStateException("Approval rejected: " + outcome.code());
            }

            insertOutboxEvent(connection, caseId, requestId);

            connection.commit();
        } catch (SQLException | RuntimeException e) {
            try {
                connection.rollback();
            } catch (SQLException rollbackError) {
                e.addSuppressed(rollbackError);
            }
            throw e;
        } finally {
            connection.setAutoCommit(originalAutoCommit);
        }
    }
}

private void insertOutboxEvent(Connection connection, long caseId, String requestId) throws SQLException {
    String sql = """
            insert into outbox_event(request_id, aggregate_type, aggregate_id, event_type)
            values (?, ?, ?, ?)
            """;

    try (PreparedStatement ps = connection.prepareStatement(sql)) {
        ps.setString(1, requestId);
        ps.setString(2, "CASE");
        ps.setLong(3, caseId);
        ps.setString(4, "CASE_APPROVED");
        ps.executeUpdate();
    }
}
```

Important:

- Procedure must not commit internally.
- Outbox insert must be same transaction.
- If commit fails with unknown outcome, idempotency key matters.
- Connection state restored before returning to pool.

---

## 22. Anti-Patterns

### 22.1 Procedure as Hidden Monolith

Symptoms:

```text
one procedure has thousands of lines
calls dozens of other procedures
no contract docs
no tests
no source-controlled migration
Java team afraid to change it
DBA manually patches production
```

This is not a database feature problem. It is an ownership/process problem.

---

### 22.2 Procedure with Internal Commit in OLTP Flow

Bad:

```text
Java service thinks operation A + B + C are atomic.
Procedure A commits internally.
B fails.
Java rollback cannot undo A.
```

---

### 22.3 Returning Huge Result Set from Procedure

Bad:

```text
CALL generate_full_audit_report()
returns 5 million rows through JDBC ResultSet
request thread waits
connection held
pool exhausted
memory grows
```

Better:

```text
submit report job
procedure writes result to report table/object storage
worker streams/export with pagination
client downloads asynchronously
```

---

### 22.4 Business Error as Text Message Only

Bad:

```text
OUT message = 'Case cannot be approved because status is Closed'
```

Good:

```text
OUT result_code = 'INVALID_CURRENT_STATE'
OUT result_message = 'Case cannot be approved because status is Closed'
```

---

### 22.5 Duplicated Rules in Java and Procedure

Bad:

```text
Java validates state transition.
Procedure validates state transition differently.
Another batch job updates state directly.
```

Good:

```text
Authoritative state transition is centralized.
Java may pre-validate for UX, but DB procedure enforces final invariant.
```

---

### 22.6 Procedure Per Row from Java Loop

Bad:

```java
for (Long id : ids) {
    callProcedure(connection, id);
}
```

This creates N round trips.

Better options:

- batch table input;
- temporary table;
- array/table-valued parameter where supported;
- procedure accepts set of IDs;
- set-based SQL.

---

## 23. Decision Matrix

### 23.1 Use Plain SQL/PreparedStatement When

```text
- operation is simple CRUD/query
- result shape is naturally relational
- Java owns business logic
- portability matters
- query should be visible/tunable in application layer
```

### 23.2 Use Stored Procedure When

```text
- operation is strongly database-owned
- multi-step write must happen atomically near data
- round-trip reduction is significant
- security model requires execute-only access
- legacy integration exposes procedure contract
- bulk operation benefits from DB engine
- DB-specific capability is intentionally used
```

### 23.3 Avoid Stored Procedure When

```text
- only reason is “stored procedure is faster” without measurement
- logic changes frequently with application release
- team lacks DB testing/deployment discipline
- procedure would duplicate Java domain logic
- transaction boundary would become unclear
- observability would become worse
```

---

## 24. Review Checklist

Before approving a `CallableStatement` integration, check:

```text
[ ] Is the procedure/function name stable?
[ ] Is the parameter order documented?
[ ] Are SQL types explicit?
[ ] Are nullable inputs handled with setNull(type)?
[ ] Are OUT params registered before execute?
[ ] Are result codes stable and documented?
[ ] Are business errors separated from technical errors?
[ ] Does the procedure avoid internal commit/rollback unless explicitly intended?
[ ] Is transaction owner clear?
[ ] Is idempotency needed and implemented?
[ ] Are ResultSet/cursor resources closed?
[ ] Are multiple result sets documented if used?
[ ] Is driver/database-specific behavior integration-tested?
[ ] Are grants included in migration?
[ ] Is procedure source controlled?
[ ] Is performance/lock behavior understood?
[ ] Are metrics/logs/correlation in place?
[ ] Is sensitive parameter logging avoided?
[ ] Is retry policy safe?
[ ] Is rollback behavior tested?
```

---

## 25. Case Study: Regulatory Case State Transition

Suppose a case management system has transition:

```text
UNDER_REVIEW -> APPROVED
```

Invariants:

1. Only assigned officer can approve.
2. Case must be in `UNDER_REVIEW`.
3. Mandatory documents must exist.
4. Audit trail must be inserted.
5. Outbox event must be emitted after commit.
6. Concurrent approval/rejection must not both win.

### Option A — Java-Orchestrated SQL

Java:

```text
select case for update
validate state
check assignment
check documents
update case
insert audit
insert outbox
commit
```

Pros:

- logic visible in Java;
- easier unit/integration test for Java team;
- easier to refactor with domain model.

Cons:

- more round trips unless optimized;
- application needs table privileges;
- multiple services may duplicate logic if not centralized.

### Option B — Stored Procedure Command

Procedure:

```text
approve_case(case_id, actor_id, request_id, out result_code, out result_message)
```

Inside DB:

```text
lock case row
validate state
validate assignment/document
update case
insert audit
return result
```

Java:

```text
begin transaction
call approve_case
if OK insert outbox
commit
```

Pros:

- authoritative invariant close to data;
- fewer round trips;
- strong DB-level enforcement;
- good for shared DB legacy environment.

Cons:

- domain logic split;
- procedure must be tested/versioned;
- Java must translate result codes;
- outbox atomicity requires no internal commit.

### Preferred Decision

For a regulatory system where database is the system of record and multiple entry points may modify case state, a stored procedure can be justified **if** the team treats it as a first-class API with tests, migration, observability, and transaction contract.

If only one Java service owns all writes and the team has strong application-domain discipline, Java-orchestrated SQL may be cleaner.

The correct answer depends less on technology preference and more on ownership/invariant boundary.

---

## 26. Key Takeaways

1. `CallableStatement` is a JDBC interface for invoking database routines.
2. It extends `PreparedStatement`, but procedure calls have richer output shapes and stronger architectural implications.
3. Procedure call is effectively RPC into a database session.
4. Transaction belongs to the calling `Connection` unless the routine commits/rolls back internally.
5. Internal commit inside procedure can break Java-side atomicity.
6. OUT parameters must be registered before execution.
7. Cursor/result set returned from procedure is still a resource and must be closed.
8. Multiple result sets are possible but should be avoided unless contract is explicit.
9. Business failure and technical failure should be separated.
10. Retry requires idempotency, especially for write procedures.
11. Procedure contracts must be versioned like APIs.
12. Stored procedure can be excellent for database-owned atomic operations, bulk processing, security boundaries, and legacy integration.
13. Stored procedure can be harmful when it hides logic, duplicates rules, obscures transaction boundaries, or lacks testing.
14. `CallableStatement` mastery is not about memorizing syntax; it is about understanding where application responsibility ends and database responsibility begins.

---

## 27. References

- Java SE 25 `java.sql` package summary — `CallableStatement` is the interface used to call database stored procedures and extends `PreparedStatement`.
- Java SE `Connection.prepareCall(...)` API documentation.
- Oracle JDBC tutorial: using stored procedures with `CallableStatement`, IN/OUT parameters, and `registerOutParameter`.
- Oracle JDBC documentation: PL/SQL procedure/function call syntax and Oracle callable statement behavior.
- Oracle JDBC documentation: REF CURSOR support and vendor-specific cursor behavior.
- PostgreSQL JDBC documentation: calling stored functions/procedures and guidance around functions returning sets.
- MySQL Connector/J Developer Guide: using JDBC `CallableStatement` to execute stored procedures.

---

# End of Part 016

Part 016 selesai.  
Seri belum selesai.  
Part berikutnya: **Part 017 — Performance Model of JDBC Calls**.  
File berikutnya: `learn-java-sql-jdbc-hikaricp-part-017.md`.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-sql-jdbc-hikaricp-part-015](./learn-java-sql-jdbc-hikaricp-part-015.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-sql-jdbc-hikaricp-part-017](./learn-java-sql-jdbc-hikaricp-part-017.md)

</div>