# learn-java-sql-jdbc-hikaricp-part-009

# SQLException Mastery: SQLState, Vendor Code, Warnings, and Recovery

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `009 / 029`  
> Fokus: mengubah cara berpikir dari “catch database error” menjadi “membaca sinyal kegagalan database dan memilih respons yang benar”.

---

## 0. Kenapa Part Ini Penting

Di banyak aplikasi Java enterprise, error JDBC biasanya diperlakukan seperti ini:

```java
try {
    // database operation
} catch (SQLException e) {
    throw new RuntimeException(e);
}
```

Secara teknis ini “bekerja”. Tetapi dari perspektif production engineering, ini miskin informasi.

`SQLException` bukan hanya exception. Ia adalah envelope yang membawa beberapa sinyal:

1. **Apa jenis kegagalan yang terjadi.**
2. **Apakah operasi mungkin bisa diulang.**
3. **Apakah koneksi masih bisa dipakai.**
4. **Apakah error berasal dari SQL, constraint, lock, network, auth, timeout, atau database engine.**
5. **Apakah error bersifat portable atau vendor-specific.**
6. **Apakah aplikasi harus retry, rollback, reconnect, reject request, atau escalate.**

Engineer yang matang tidak hanya menangkap `SQLException`; ia membangun **failure taxonomy**.

---

## 1. Mental Model Utama

### 1.1 `SQLException` adalah sinyal dari beberapa layer sekaligus

Saat JDBC call gagal, penyebabnya bisa berasal dari banyak lapisan:

```text
Application Java code
  ↓
JDBC API
  ↓
JDBC driver
  ↓
Network / TLS / socket
  ↓
Database listener / proxy / pooler
  ↓
Database session
  ↓
SQL parser / optimizer / executor
  ↓
Storage engine / lock manager / constraint engine
```

Tetapi ke aplikasi Java, banyak kegagalan itu muncul sebagai `SQLException`.

Artinya, `SQLException` bukan satu jenis error. Ia adalah bentuk umum untuk banyak kondisi kegagalan.

---

### 1.2 Jangan treat semua `SQLException` sama

Contoh beberapa error yang sama-sama `SQLException`:

```text
Duplicate key
Deadlock
Lock timeout
Syntax error
Table not found
Connection reset
Database unavailable
Login failed
Query timeout
Serialization failure
Column value too large
Foreign key violation
Permission denied
```

Respons yang benar untuk tiap error berbeda:

| Error | Respons yang mungkin benar |
|---|---|
| Duplicate key | return conflict / idempotency handling |
| Deadlock | rollback + retry transaction secara hati-hati |
| Syntax error | bug, jangan retry |
| Connection reset | discard connection, mungkin retry at safe boundary |
| Login failed | configuration/secrets issue, jangan retry agresif |
| Lock timeout | tergantung use case, retry/backoff atau fail fast |
| Serialization failure | retry whole transaction |
| Permission denied | deployment/configuration defect |
| Data too long | validation bug / schema mismatch |

Jadi tujuan part ini adalah membuat kamu bisa membaca sinyal error dengan presisi.

---

## 2. Anatomy of `SQLException`

`SQLException` membawa beberapa informasi utama.

Secara konseptual:

```text
SQLException
├── message / reason
├── SQLState
├── vendor error code
├── cause
├── next exception chain
└── subclass type
```

Contoh inspeksi dasar:

```java
catch (SQLException e) {
    System.err.println("Message      : " + e.getMessage());
    System.err.println("SQLState     : " + e.getSQLState());
    System.err.println("Vendor code  : " + e.getErrorCode());
    System.err.println("Class        : " + e.getClass().getName());

    Throwable cause = e.getCause();
    if (cause != null) {
        System.err.println("Cause        : " + cause.getClass().getName() + ": " + cause.getMessage());
    }

    for (Throwable t : e) {
        System.err.println("Chained      : " + t.getClass().getName() + ": " + t.getMessage());
    }
}
```

---

## 3. `SQLState`: Portable Error Classification

### 3.1 Apa itu SQLState

`SQLState` adalah kode 5 karakter yang mengikuti konvensi SQL standard atau konvensi vendor.

Format umum:

```text
CCSSS
```

Dengan:

```text
CC    = class, dua karakter pertama
SSS   = subclass, tiga karakter berikutnya
```

Contoh:

```text
23505
23 = integrity constraint violation class
505 = specific duplicate key / unique violation, tergantung DB
```

Contoh umum:

| SQLState | Makna umum |
|---|---|
| `00000` | success |
| `01000` | warning |
| `02000` | no data |
| `08000` | connection exception |
| `22000` | data exception |
| `23000` | integrity constraint violation |
| `25000` | invalid transaction state |
| `28000` | invalid authorization specification |
| `40001` | serialization failure |
| `42000` | syntax error or access rule violation |

---

### 3.2 Dua karakter pertama sering cukup untuk klasifikasi awal

Daripada langsung hardcode semua kode vendor, mulai dari SQLState class:

```java
static String sqlStateClass(SQLException e) {
    String state = e.getSQLState();
    if (state == null || state.length() < 2) {
        return null;
    }
    return state.substring(0, 2);
}
```

Contoh classification awal:

```java
static boolean isConnectionException(SQLException e) {
    return "08".equals(sqlStateClass(e));
}

static boolean isIntegrityViolation(SQLException e) {
    return "23".equals(sqlStateClass(e));
}

static boolean isTransactionRollback(SQLException e) {
    return "40".equals(sqlStateClass(e));
}

static boolean isSyntaxOrAccessRuleViolation(SQLException e) {
    return "42".equals(sqlStateClass(e));
}
```

Ini belum sempurna, tetapi lebih baik daripada hanya membaca message.

---

### 3.3 Jangan bergantung pada message string

Ini buruk:

```java
if (e.getMessage().contains("duplicate key")) {
    // handle conflict
}
```

Kenapa buruk?

1. Message bisa berubah antar versi driver/database.
2. Message bisa berbeda bahasa/localization.
3. Message bisa berbeda antar vendor.
4. Message sering mengandung detail schema yang tidak stabil.
5. Message bukan kontrak programmatic.

Gunakan urutan preferensi:

```text
1. SQLException subclass
2. SQLState
3. Vendor error code
4. Driver-specific exception metadata
5. Message string sebagai fallback paling akhir
```

---

## 4. Vendor Error Code

### 4.1 Apa itu vendor code

`SQLException#getErrorCode()` mengembalikan error code spesifik vendor.

Contoh tipikal:

```text
Oracle ORA-00001  -> unique constraint violated
Oracle ORA-00060  -> deadlock detected
Oracle ORA-01017  -> invalid username/password
MySQL 1062        -> duplicate entry
MySQL 1213        -> deadlock
PostgreSQL        -> sering lebih mengandalkan SQLState daripada integer vendor code
```

Vendor code berguna, tetapi tidak portable.

---

### 4.2 Kapan vendor code perlu dipakai

Pakai vendor code jika:

1. SQLState terlalu generik.
2. Aplikasi memang terikat ke vendor tertentu.
3. Kamu perlu membedakan error spesifik yang tidak cukup jelas dari SQLState.
4. Kamu membuat adapter per database.
5. Kamu butuh classification yang operationally reliable untuk database tertentu.

Contoh:

```java
static boolean isOracleUniqueViolation(SQLException e) {
    return e.getErrorCode() == 1; // ORA-00001
}

static boolean isOracleDeadlock(SQLException e) {
    return e.getErrorCode() == 60; // ORA-00060
}
```

Tetapi jangan campur vendor code secara liar di business logic.

Lebih baik:

```text
Repository / JDBC adapter
  ↓
SQLExceptionClassifier
  ↓
Domain/application exception
```

---

## 5. SQLException Subclass Hierarchy

JDBC menyediakan beberapa subclass untuk memberi classification lebih portable.

Simplified hierarchy:

```text
SQLException
├── SQLTransientException
│   ├── SQLTimeoutException
│   ├── SQLTransactionRollbackException
│   └── SQLTransientConnectionException
│
├── SQLNonTransientException
│   ├── SQLDataException
│   ├── SQLFeatureNotSupportedException
│   ├── SQLIntegrityConstraintViolationException
│   ├── SQLInvalidAuthorizationSpecException
│   ├── SQLNonTransientConnectionException
│   └── SQLSyntaxErrorException
│
├── SQLRecoverableException
│
└── BatchUpdateException
```

Catatan penting:

> Tidak semua driver selalu melempar subclass paling spesifik. Banyak driver tetap melempar `SQLException` biasa dengan SQLState/vendor code.

Jadi subclass berguna, tetapi jangan menjadi satu-satunya mekanisme.

---

## 6. Transient vs Non-Transient vs Recoverable

### 6.1 Transient

`SQLTransientException` berarti operasi yang gagal **mungkin berhasil jika dicoba lagi tanpa memperbaiki penyebab aplikasi**.

Contoh:

```text
Deadlock
Serialization failure
Temporary connection issue
Timeout tertentu
Resource temporarily unavailable
```

Tetapi “transient” tidak otomatis berarti “retry sekarang juga”.

Retry tetap harus mempertimbangkan:

1. Apakah operasi idempotent?
2. Apakah transaction sudah partial success?
3. Apakah safe retry di boundary yang benar?
4. Apakah retry akan memperburuk overload?
5. Apakah perlu rollback dulu?

---

### 6.2 Non-transient

`SQLNonTransientException` berarti operasi kemungkinan tidak akan berhasil jika diulang tanpa perubahan penyebab.

Contoh:

```text
Syntax error
Invalid column
Constraint violation
Invalid authorization
Unsupported feature
Data too long
Permission denied
```

Untuk ini, retry biasanya salah.

Respons lebih tepat:

```text
- reject request
- return validation/conflict error
- fix query/code/config
- migrate schema
- correct privilege
```

---

### 6.3 Recoverable

`SQLRecoverableException` berarti operasi mungkin berhasil jika aplikasi melakukan recovery step tertentu.

Contoh recovery step:

```text
- close/discard current connection
- obtain new connection
- re-authenticate
- re-establish session
```

Dalam konteks pool, ini penting:

```text
SQLRecoverableException sering berarti connection yang sedang dipakai tidak bisa dipercaya lagi.
```

Aplikasi tidak boleh asal lanjut memakai connection yang sama.

---

## 7. Warning: `SQLWarning` Bukan Exception Biasa

### 7.1 Apa itu SQLWarning

`SQLWarning` adalah subclass dari `SQLException`, tetapi biasanya tidak dilempar sebagai exception fatal. Warning menempel pada object JDBC seperti:

```text
Connection
Statement
ResultSet
```

Contoh warning:

```text
Data truncation warning
Privilege warning
Plan warning
Cursor warning
Vendor-specific warning
```

Membaca warning:

```java
try (Statement st = connection.createStatement();
     ResultSet rs = st.executeQuery("select ...")) {

    SQLWarning statementWarning = st.getWarnings();
    while (statementWarning != null) {
        log.warn("JDBC statement warning. state={}, code={}, message={}",
                statementWarning.getSQLState(),
                statementWarning.getErrorCode(),
                statementWarning.getMessage());
        statementWarning = statementWarning.getNextWarning();
    }
}
```

---

### 7.2 Kenapa warning sering diabaikan

Karena warning tidak selalu menggagalkan operasi.

Tetapi dalam sistem serius, warning bisa menjadi sinyal:

1. Data truncation.
2. Implicit conversion.
3. Deprecated feature.
4. Cursor behavior berubah.
5. Database memberi sinyal anomali non-fatal.

Tidak semua aplikasi perlu membaca warning di semua query. Tetapi untuk batch, migration, import, reporting, dan critical data pipeline, warning harus dipertimbangkan.

---

## 8. Chained Exceptions

### 8.1 `getNextException()` dan iterator

`SQLException` dapat memiliki chain exception.

Contoh:

```java
catch (SQLException e) {
    SQLException current = e;
    while (current != null) {
        log.error("SQL error. class={}, state={}, code={}, message={}",
                current.getClass().getName(),
                current.getSQLState(),
                current.getErrorCode(),
                current.getMessage());
        current = current.getNextException();
    }
}
```

Sejak Java modern, `SQLException` juga implement `Iterable<Throwable>`:

```java
catch (SQLException e) {
    for (Throwable t : e) {
        log.error("SQL throwable in chain", t);
    }
}
```

---

### 8.2 Kenapa chain penting

Batch execution, stored procedure, dan driver-level failure kadang membawa banyak error sekaligus.

Contoh:

```text
Top-level: BatchUpdateException
Next exception 1: duplicate key on row X
Next exception 2: foreign key violation on row Y
Cause: socket read failed
```

Kalau hanya log `e.getMessage()`, informasi penting hilang.

---

## 9. Common Error Categories

### 9.1 Constraint violation

Biasanya SQLState class:

```text
23xxx
```

Contoh:

```text
Unique constraint violation
Foreign key violation
Not null violation
Check constraint violation
Exclusion constraint violation
```

Respons aplikasi:

```text
- map ke domain conflict / validation error
- jangan retry blind
- jangan expose raw constraint name ke user tanpa sanitasi
- untuk idempotency, duplicate key bisa menjadi expected path
```

Contoh classifier:

```java
static boolean isConstraintViolation(SQLException e) {
    String state = e.getSQLState();
    return state != null && state.startsWith("23");
}
```

---

### 9.2 Duplicate key / unique violation

Duplicate key adalah subclass khusus dari constraint violation secara konseptual.

Pola desain:

```text
INSERT business_key
  ↓
if duplicate key
  ↓
interpret as conflict or idempotent replay
```

Contoh domain:

```text
- create case with external reference number
- create payment record with idempotency key
- create user with unique email
- insert event with event_id unique
```

Untuk idempotency:

```text
Duplicate key tidak selalu error fatal.
Kadang ia berarti request pernah berhasil sebelumnya.
```

Tapi hati-hati:

```text
Duplicate key pada idempotency key aman hanya jika payload/result juga diverifikasi konsisten.
```

---

### 9.3 Syntax error / invalid object

Biasanya SQLState class:

```text
42xxx
```

Contoh:

```text
Syntax error
Table not found
Column not found
Ambiguous column
Insufficient privilege, tergantung vendor
```

Respons:

```text
- jangan retry
- treat as bug/deployment/schema mismatch
- alert engineering
- check migration version
```

Ini biasanya bukan runtime business exception.

---

### 9.4 Invalid authorization

Biasanya SQLState class:

```text
28xxx
```

Contoh:

```text
Invalid username
Invalid password
Expired credential
Authentication rejected
```

Respons:

```text
- jangan retry agresif
- fail fast
- alert secret/configuration owner
- rotate/refresh credential if supported
```

Dalam pool, auth failure saat membuat koneksi baru bisa menyebabkan startup failure atau pool unable to grow.

---

### 9.5 Connection exception

Biasanya SQLState class:

```text
08xxx
```

Contoh:

```text
Connection refused
Connection reset
Connection does not exist
Connection failure
Communication link failure
Database restart
Network partition
TLS failure
```

Respons:

```text
- connection kemungkinan tidak reusable
- rollback mungkin gagal
- close/discard connection
- retry hanya di safe boundary
- gunakan backoff
- jangan menciptakan retry storm
```

Important distinction:

```text
Connection failure before statement execution
  ≠
Connection failure after statement reached database
```

Kalau koneksi putus saat query sedang dieksekusi, aplikasi kadang tidak tahu apakah database sempat melakukan perubahan.

Untuk write operation, ini adalah ambiguity problem.

---

### 9.6 Transaction rollback

SQLState class:

```text
40xxx
```

Contoh penting:

```text
40001 = serialization failure
40P01 = PostgreSQL deadlock detected
```

Respons:

```text
- rollback transaction
- retry whole transaction, bukan hanya statement terakhir
- butuh idempotency atau deterministic transaction function
- pakai bounded retry + jitter
```

Kenapa whole transaction?

Karena isolation anomaly/rollback terjadi pada unit transaction. Mengulang hanya satu statement bisa melanggar invariant.

---

### 9.7 Timeout

Timeout bisa muncul dari banyak layer:

```text
Pool borrow timeout
Driver login timeout
Socket connect timeout
Socket read timeout
Statement query timeout
Database statement timeout
Lock wait timeout
Transaction timeout
Application request timeout
```

Tidak semua timeout sama.

Contoh mapping:

| Timeout | Makna | Respons |
|---|---|---|
| Pool borrow timeout | tidak dapat connection dari pool | backpressure / fail fast / tune pool or query duration |
| Query timeout | statement terlalu lama | cancel statement, check connection validity |
| Lock timeout | menunggu lock terlalu lama | retry mungkin aman jika whole transaction |
| Socket timeout | network/read stuck | discard connection, ambiguous write |
| Login timeout | gagal connect/auth dalam waktu tertentu | config/network/db availability issue |

Jangan hanya membuat class `DatabaseTimeoutException` tanpa preserving original signal.

---

## 10. Retry: Prinsip yang Sering Salah

### 10.1 Retry bukan obat umum

Retry bisa memperbaiki transient failure, tetapi bisa memperburuk sistem saat overload.

Retry buruk:

```text
DB mulai lambat
  ↓
request timeout
  ↓
semua service retry 3x
  ↓
DB menerima traffic lebih besar
  ↓
latency makin buruk
  ↓
pool penuh
  ↓
incident membesar
```

Retry harus bounded, selective, dan aware terhadap idempotency.

---

### 10.2 Retry boundary yang benar

Untuk read-only query:

```text
retry statement mungkin cukup, jika connection masih valid
```

Untuk transaction write:

```text
retry whole transaction function
```

Contoh transaction retry skeleton:

```java
public <T> T executeWithSerializableRetry(TransactionCallback<T> callback) throws SQLException {
    int maxAttempts = 3;
    SQLException last = null;

    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
        try (Connection con = dataSource.getConnection()) {
            con.setAutoCommit(false);
            con.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);

            try {
                T result = callback.execute(con);
                con.commit();
                return result;
            } catch (SQLException e) {
                safeRollback(con, e);

                if (!isRetryableTransactionFailure(e) || attempt == maxAttempts) {
                    throw e;
                }

                last = e;
                sleepBackoff(attempt);
            }
        }
    }

    throw last;
}
```

Helper:

```java
static boolean isRetryableTransactionFailure(SQLException e) {
    String state = e.getSQLState();
    if (state == null) {
        return false;
    }

    return state.equals("40001")     // serialization failure
        || state.equals("40P01")     // PostgreSQL deadlock detected
        || state.startsWith("40");   // transaction rollback class, evaluate per DB
}

static void safeRollback(Connection con, SQLException original) {
    try {
        con.rollback();
    } catch (SQLException rollbackFailure) {
        original.addSuppressed(rollbackFailure);
    }
}

static void sleepBackoff(int attempt) {
    try {
        long baseMillis = 50L * attempt;
        long jitterMillis = java.util.concurrent.ThreadLocalRandom.current().nextLong(25L);
        Thread.sleep(baseMillis + jitterMillis);
    } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
    }
}
```

Catatan:

1. Ini skeleton edukatif.
2. Production code perlu deadline/request timeout awareness.
3. Jangan sleep di event loop.
4. Jangan retry jika operasi tidak aman diulang.
5. Jangan retry infinite.

---

### 10.3 Ambiguous commit problem

Kasus berbahaya:

```text
Application sends COMMIT
  ↓
Network connection breaks
  ↓
Application receives SQLException
  ↓
Apakah commit berhasil di DB?
```

Jawabannya bisa ambigu.

Kalau aplikasi langsung retry seluruh operasi, bisa terjadi double effect.

Mitigasi:

1. Gunakan idempotency key.
2. Gunakan unique business key.
3. Gunakan outbox/inbox pattern.
4. Buat operasi write deterministic.
5. Setelah failure ambigu, reconcile state dengan read by business key.
6. Jangan rely pada “exception means nothing happened”.

Mental model:

```text
SQLException on write does not always mean database state unchanged.
```

---

## 11. Exception Translation Layer

### 11.1 Kenapa perlu translation

Jangan biarkan seluruh aplikasi bergantung langsung pada vendor-specific `SQLException`.

Lebih baik buat lapisan terkontrol:

```text
SQLException
  ↓
JdbcErrorClassifier
  ↓
Application/DataAccess exception
  ↓
Service-level decision
  ↓
HTTP/API/domain response
```

Contoh domain exception:

```java
sealed class DataAccessFailure extends RuntimeException
        permits ConstraintConflictFailure,
                RetriableDataAccessFailure,
                NonRetriableDataAccessFailure,
                DatabaseUnavailableFailure,
                DataAccessBugFailure {

    DataAccessFailure(String message, Throwable cause) {
        super(message, cause);
    }
}

final class ConstraintConflictFailure extends DataAccessFailure {
    ConstraintConflictFailure(String message, Throwable cause) {
        super(message, cause);
    }
}

final class RetriableDataAccessFailure extends DataAccessFailure {
    RetriableDataAccessFailure(String message, Throwable cause) {
        super(message, cause);
    }
}

final class NonRetriableDataAccessFailure extends DataAccessFailure {
    NonRetriableDataAccessFailure(String message, Throwable cause) {
        super(message, cause);
    }
}

final class DatabaseUnavailableFailure extends DataAccessFailure {
    DatabaseUnavailableFailure(String message, Throwable cause) {
        super(message, cause);
    }
}

final class DataAccessBugFailure extends DataAccessFailure {
    DataAccessBugFailure(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Classifier sederhana:

```java
final class JdbcErrorClassifier {

    DataAccessFailure translate(SQLException e) {
        String state = e.getSQLState();
        String stateClass = state != null && state.length() >= 2 ? state.substring(0, 2) : null;

        if (e instanceof SQLIntegrityConstraintViolationException || "23".equals(stateClass)) {
            return new ConstraintConflictFailure("Database constraint violation", e);
        }

        if (e instanceof SQLTransientConnectionException || "08".equals(stateClass)) {
            return new DatabaseUnavailableFailure("Database connection failure", e);
        }

        if (e instanceof SQLTransactionRollbackException || "40".equals(stateClass)) {
            return new RetriableDataAccessFailure("Transaction rollback failure", e);
        }

        if (e instanceof SQLSyntaxErrorException || "42".equals(stateClass)) {
            return new DataAccessBugFailure("SQL syntax or schema/access rule failure", e);
        }

        if (e instanceof SQLInvalidAuthorizationSpecException || "28".equals(stateClass)) {
            return new DataAccessBugFailure("Database authorization failure", e);
        }

        if (e instanceof SQLTransientException) {
            return new RetriableDataAccessFailure("Transient database failure", e);
        }

        if (e instanceof SQLNonTransientException) {
            return new NonRetriableDataAccessFailure("Non-transient database failure", e);
        }

        return new NonRetriableDataAccessFailure("Unclassified database failure", e);
    }
}
```

Ini masih general. Untuk production, tambahkan adapter vendor-specific.

---

### 11.2 Jangan hilangkan detail asli

Salah:

```java
throw new DatabaseException("Database error");
```

Benar:

```java
throw new DatabaseException("Database error", e);
```

Lebih baik lagi, preserve structured fields:

```java
record JdbcFailureInfo(
        String sqlState,
        int vendorCode,
        String exceptionClass,
        String operation,
        boolean retryable,
        boolean connectionSuspect
) {}
```

---

## 12. Logging SQLException dengan Aman

### 12.1 Informasi yang perlu dilog

Log minimal untuk `SQLException` serius:

```text
- operation name
- SQLState
- vendor error code
- exception class
- transient/retryable classification
- connection suspect flag
- query name, bukan raw SQL penuh jika sensitif
- elapsed time
- attempt number
- correlation id / request id
- database name / pool name
```

Contoh:

```java
log.error("JDBC operation failed. operation={}, sqlState={}, vendorCode={}, exceptionClass={}, retryable={}, connectionSuspect={}, elapsedMs={}",
        operationName,
        e.getSQLState(),
        e.getErrorCode(),
        e.getClass().getName(),
        retryable,
        connectionSuspect,
        elapsedMillis,
        e);
```

---

### 12.2 Jangan sembarang log bind value

Berbahaya:

```text
SQL: insert into person(nric, name, email, dob) values('...', '...', '...', '...')
```

Risiko:

1. PII leakage.
2. Credential leakage.
3. Audit issue.
4. Log retention problem.
5. Security incident.

Lebih aman:

```text
queryName=createPerson
parameterProfile={nric=present, email=present, dob=present}
```

Atau:

```text
queryHash=abc123
bindCount=4
```

Untuk debug di lower environment, boleh ada feature flag dengan masking ketat.

---

## 13. Mapping ke HTTP/API Response

Jika JDBC dipakai di backend API, jangan leak `SQLException` ke API response.

Contoh mapping:

| JDBC failure | API response |
|---|---|
| Unique violation pada business key | `409 Conflict` |
| FK violation karena invalid reference dari client | `400 Bad Request` atau `409 Conflict` |
| Syntax error | `500 Internal Server Error` |
| DB unavailable | `503 Service Unavailable` |
| Pool exhausted | `503 Service Unavailable` atau `429/503` tergantung policy |
| Serialization failure after retries exhausted | `503` atau domain-specific retry response |
| Permission denied DB | `500` plus alert |
| Data too long karena validation miss | `400` jika input salah, `500` jika schema mismatch |

Tetapi mapping harus mempertimbangkan domain.

Contoh:

```text
Duplicate application number pada create application
  -> 409 Conflict

Duplicate event id pada event consumer
  -> success/idempotent skip

Duplicate audit id
  -> 500 atau operational alert
```

Error database yang sama bisa punya makna domain berbeda.

---

## 14. Database-Specific Examples

### 14.1 PostgreSQL

PostgreSQL sangat kuat dalam SQLState classification.

Contoh umum:

```text
23505 = unique_violation
23503 = foreign_key_violation
23502 = not_null_violation
40001 = serialization_failure
40P01 = deadlock_detected
55P03 = lock_not_available
57014 = query_canceled
08006 = connection_failure
```

Pola recovery:

| SQLState | Makna | Retry? |
|---|---|---|
| `23505` | unique violation | biasanya tidak, kecuali idempotency path |
| `40001` | serialization failure | ya, whole transaction |
| `40P01` | deadlock detected | sering ya, whole transaction + backoff |
| `55P03` | lock not available | tergantung use case |
| `57014` | query canceled | tergantung penyebab cancellation |
| `08006` | connection failure | connection suspect, retry only safe boundary |

---

### 14.2 Oracle

Oracle sering dikenal lewat ORA code.

Contoh umum:

```text
ORA-00001 = unique constraint violated
ORA-00054 = resource busy and acquire with NOWAIT specified or timeout expired
ORA-00060 = deadlock detected
ORA-01017 = invalid username/password
ORA-01400 = cannot insert NULL
ORA-01403 = no data found, mostly PL/SQL context
ORA-01438 = value larger than specified precision
ORA-01555 = snapshot too old
ORA-12170 = connect timeout occurred
ORA-12514 = listener does not currently know requested service
ORA-12541 = no listener
```

Pola recovery:

| Oracle condition | Respons |
|---|---|
| unique constraint | conflict/idempotency handling |
| deadlock | rollback + retry transaction if safe |
| resource busy NOWAIT | backoff/retry or fail fast |
| invalid password | config/secrets incident |
| snapshot too old | query/undo/tuning issue, not blind retry only |
| listener/service unavailable | DB/network availability issue |

---

### 14.3 MySQL / MariaDB

Contoh umum MySQL:

```text
1062 = duplicate entry
1213 = deadlock found
1205 = lock wait timeout exceeded
1045 = access denied
2006 = MySQL server has gone away
2013 = lost connection during query
```

SQLState juga tersedia, tetapi banyak engineer MySQL memakai vendor error code karena dokumentasi dan praktik historis.

Pola recovery:

| Error | Respons |
|---|---|
| 1062 duplicate | conflict/idempotency |
| 1213 deadlock | retry whole transaction |
| 1205 lock wait timeout | maybe retry, investigate locks |
| 2006/2013 connection lost | discard connection, ambiguous write risk |
| 1045 access denied | config/secrets issue |

---

## 15. BatchUpdateException

### 15.1 Kenapa batch berbeda

Batch bisa sukses sebagian sebelum gagal, tergantung:

1. Driver.
2. Database.
3. Auto-commit.
4. Transaction boundary.
5. Batch rewrite optimization.
6. Statement type.

`BatchUpdateException` membawa `updateCounts`.

Contoh:

```java
catch (BatchUpdateException e) {
    int[] counts = e.getUpdateCounts();
    for (int i = 0; i < counts.length; i++) {
        int count = counts[i];
        if (count == Statement.EXECUTE_FAILED) {
            log.warn("Batch item failed at index {}", i);
        } else if (count == Statement.SUCCESS_NO_INFO) {
            log.info("Batch item succeeded but affected row count unknown at index {}", i);
        } else {
            log.info("Batch item index {} affected {} rows", i, count);
        }
    }

    throw e;
}
```

---

### 15.2 Safe batch design

Untuk batch write penting:

```text
- always use explicit transaction unless partial commit is intended
- choose batch size carefully
- log batch item identity safely
- preserve updateCounts
- design idempotency for retries
- consider deadlock amplification
- avoid huge transaction if rollback cost is too high
```

Jika auto-commit true, batch behavior bisa mengejutkan.

Rule sederhana:

```text
Batch critical data write sebaiknya explicit transaction.
```

---

## 16. Connection Health After SQLException

Tidak semua `SQLException` membuat connection rusak.

Contoh connection biasanya masih bisa dipakai:

```text
Unique violation
Syntax error
Data too long
Foreign key violation
```

Contoh connection patut dicurigai:

```text
Connection reset
Socket timeout
Database restart
Protocol error
SQLRecoverableException
SQLTransientConnectionException
SQLNonTransientConnectionException
SQLState class 08
```

Dalam pool, jika connection rusak, jangan dikembalikan sebagai healthy.

Biasanya:

```java
try (Connection con = dataSource.getConnection()) {
    // work
} catch (SQLException e) {
    // Pool/driver may detect broken connection on close or validation.
    // But application classification still matters for retry and logging.
}
```

Pool seperti HikariCP akan melakukan validasi dan eviction berdasarkan sinyal tertentu, tetapi aplikasi tetap perlu memahami semantic error.

---

## 17. Timeout, Cancellation, dan Poisoned Connection

Saat query timeout terjadi, beberapa kemungkinan:

```text
1. Statement berhasil dibatalkan dan connection tetap usable.
2. Statement dibatalkan tetapi transaction berada dalam aborted state.
3. Driver tidak berhasil membatalkan query.
4. Socket read timeout membuat connection tidak terpercaya.
5. Database masih menjalankan query walau client sudah timeout.
```

Karena itu setelah timeout:

```text
- rollback transaction jika ada
- jangan lanjut transaction yang sama
- pertimbangkan connection suspect untuk socket/protocol timeout
- monitor database-side long-running query
```

Timeout akan dibahas lebih dalam di Part 022, tetapi dari sisi exception handling, poin pentingnya:

> Timeout adalah symptom, bukan root cause.

---

## 18. Transaction State After Error

Beberapa database membuat transaction masuk state aborted setelah error tertentu.

Contoh pola:

```text
BEGIN
  statement 1 succeeds
  statement 2 fails
  statement 3 attempted
  database rejects because transaction is aborted
ROLLBACK required
```

Jangan asumsikan setelah `SQLException`, kamu bisa lanjut memakai transaction yang sama.

Rule aman:

```text
Jika error terjadi dalam explicit transaction, rollback transaction kecuali kamu benar-benar tahu database behavior dan error class-nya aman untuk dilanjutkan.
```

Contoh:

```java
Connection con = dataSource.getConnection();
try {
    con.setAutoCommit(false);

    doStep1(con);
    doStep2(con);
    doStep3(con);

    con.commit();
} catch (SQLException e) {
    try {
        con.rollback();
    } catch (SQLException rollbackFailure) {
        e.addSuppressed(rollbackFailure);
    }
    throw e;
} finally {
    con.close();
}
```

---

## 19. Designing a Practical JDBC Failure Taxonomy

Untuk sistem production, taxonomy yang lebih berguna daripada nama class exception:

```text
JdbcFailureCategory
├── CONSTRAINT_CONFLICT
├── VALIDATION_OR_DATA_ERROR
├── SQL_OR_SCHEMA_BUG
├── AUTHORIZATION_OR_SECRET_FAILURE
├── CONNECTION_FAILURE
├── DATABASE_UNAVAILABLE
├── POOL_EXHAUSTED
├── LOCK_TIMEOUT
├── DEADLOCK
├── SERIALIZATION_FAILURE
├── QUERY_TIMEOUT
├── FEATURE_UNSUPPORTED
├── BATCH_PARTIAL_FAILURE
└── UNKNOWN
```

Dengan flags:

```text
retryable: true/false
retryBoundary: NONE / STATEMENT / TRANSACTION / CONNECTION_RECREATE / REQUEST
connectionSuspect: true/false
userVisible: true/false
action: CONFLICT / BAD_REQUEST / RETRY / FAIL_FAST / ALERT / RECONCILE
```

Contoh record:

```java
record JdbcFailureClassification(
        JdbcFailureCategory category,
        boolean retryable,
        RetryBoundary retryBoundary,
        boolean connectionSuspect,
        boolean safeToExposeToClient,
        String sqlState,
        int vendorCode
) {}

enum RetryBoundary {
    NONE,
    STATEMENT,
    TRANSACTION,
    CONNECTION_RECREATE,
    REQUEST_RECONCILIATION
}

enum JdbcFailureCategory {
    CONSTRAINT_CONFLICT,
    VALIDATION_OR_DATA_ERROR,
    SQL_OR_SCHEMA_BUG,
    AUTHORIZATION_OR_SECRET_FAILURE,
    CONNECTION_FAILURE,
    DATABASE_UNAVAILABLE,
    LOCK_TIMEOUT,
    DEADLOCK,
    SERIALIZATION_FAILURE,
    QUERY_TIMEOUT,
    FEATURE_UNSUPPORTED,
    BATCH_PARTIAL_FAILURE,
    UNKNOWN
}
```

---

## 20. Example: Classifier yang Lebih Serius

```java
final class DefaultJdbcFailureClassifier {

    JdbcFailureClassification classify(SQLException e) {
        String state = e.getSQLState();
        String stateClass = stateClass(state);
        int vendorCode = e.getErrorCode();

        if (e instanceof BatchUpdateException) {
            return of(JdbcFailureCategory.BATCH_PARTIAL_FAILURE, false, RetryBoundary.NONE, false, e);
        }

        if (isUniqueViolation(state, vendorCode)) {
            return of(JdbcFailureCategory.CONSTRAINT_CONFLICT, false, RetryBoundary.NONE, false, e);
        }

        if ("23".equals(stateClass) || e instanceof SQLIntegrityConstraintViolationException) {
            return of(JdbcFailureCategory.CONSTRAINT_CONFLICT, false, RetryBoundary.NONE, false, e);
        }

        if (isSerializationFailure(state)) {
            return of(JdbcFailureCategory.SERIALIZATION_FAILURE, true, RetryBoundary.TRANSACTION, false, e);
        }

        if (isDeadlock(state, vendorCode)) {
            return of(JdbcFailureCategory.DEADLOCK, true, RetryBoundary.TRANSACTION, false, e);
        }

        if (isLockTimeout(state, vendorCode)) {
            return of(JdbcFailureCategory.LOCK_TIMEOUT, true, RetryBoundary.TRANSACTION, false, e);
        }

        if ("08".equals(stateClass)
                || e instanceof SQLTransientConnectionException
                || e instanceof SQLNonTransientConnectionException
                || e instanceof SQLRecoverableException) {
            return of(JdbcFailureCategory.CONNECTION_FAILURE, true, RetryBoundary.CONNECTION_RECREATE, true, e);
        }

        if (e instanceof SQLTimeoutException) {
            return of(JdbcFailureCategory.QUERY_TIMEOUT, true, RetryBoundary.TRANSACTION, true, e);
        }

        if ("28".equals(stateClass) || e instanceof SQLInvalidAuthorizationSpecException) {
            return of(JdbcFailureCategory.AUTHORIZATION_OR_SECRET_FAILURE, false, RetryBoundary.NONE, true, e);
        }

        if ("42".equals(stateClass) || e instanceof SQLSyntaxErrorException) {
            return of(JdbcFailureCategory.SQL_OR_SCHEMA_BUG, false, RetryBoundary.NONE, false, e);
        }

        if ("22".equals(stateClass) || e instanceof SQLDataException) {
            return of(JdbcFailureCategory.VALIDATION_OR_DATA_ERROR, false, RetryBoundary.NONE, false, e);
        }

        if (e instanceof SQLFeatureNotSupportedException) {
            return of(JdbcFailureCategory.FEATURE_UNSUPPORTED, false, RetryBoundary.NONE, false, e);
        }

        if (e instanceof SQLTransientException) {
            return of(JdbcFailureCategory.UNKNOWN, true, RetryBoundary.TRANSACTION, false, e);
        }

        return of(JdbcFailureCategory.UNKNOWN, false, RetryBoundary.NONE, false, e);
    }

    private static String stateClass(String state) {
        return state != null && state.length() >= 2 ? state.substring(0, 2) : null;
    }

    private static boolean isUniqueViolation(String state, int vendorCode) {
        return "23505".equals(state)      // PostgreSQL unique_violation
                || vendorCode == 1       // Oracle ORA-00001
                || vendorCode == 1062;   // MySQL duplicate entry
    }

    private static boolean isSerializationFailure(String state) {
        return "40001".equals(state);
    }

    private static boolean isDeadlock(String state, int vendorCode) {
        return "40P01".equals(state)     // PostgreSQL deadlock_detected
                || vendorCode == 60      // Oracle ORA-00060
                || vendorCode == 1213;   // MySQL deadlock
    }

    private static boolean isLockTimeout(String state, int vendorCode) {
        return "55P03".equals(state)     // PostgreSQL lock_not_available
                || vendorCode == 54      // Oracle ORA-00054
                || vendorCode == 1205;   // MySQL lock wait timeout
    }

    private static JdbcFailureClassification of(
            JdbcFailureCategory category,
            boolean retryable,
            RetryBoundary retryBoundary,
            boolean connectionSuspect,
            SQLException e
    ) {
        return new JdbcFailureClassification(
                category,
                retryable,
                retryBoundary,
                connectionSuspect,
                false,
                e.getSQLState(),
                e.getErrorCode()
        );
    }
}
```

Catatan penting:

1. Ini contoh edukatif.
2. Kode vendor harus divalidasi terhadap database/driver yang dipakai.
3. Jangan masukkan semua vendor dalam satu class besar jika sistem kamu hanya memakai satu database.
4. Untuk multi-database, buat strategy per vendor.

---

## 21. Recovery Decision Matrix

| Category | Retry? | Boundary | Connection suspect? | Human action? |
|---|---:|---|---:|---|
| Unique violation | No | None | No | Maybe business conflict |
| FK violation | No | None | No | Validate input/data flow |
| Syntax/schema error | No | None | No | Fix code/migration |
| Invalid auth | No | None | Yes | Fix secret/privilege |
| Connection failure | Maybe | Reconnect/request | Yes | Check DB/network |
| Query timeout | Maybe | Transaction/request | Maybe | Tune query/timeout |
| Lock timeout | Maybe | Transaction | No/Maybe | Check contention |
| Deadlock | Yes | Transaction | No | Check lock order |
| Serialization failure | Yes | Transaction | No | Expected under serializable |
| Pool exhausted | Maybe later | Request | No | Tune pool/query/concurrency |
| Batch partial failure | Usually no blind retry | Batch-specific | Maybe | Reconcile item-level result |

---

## 22. Anti-Patterns

### 22.1 Catch and hide

```java
catch (SQLException e) {
    return Optional.empty();
}
```

Ini sangat berbahaya.

`Optional.empty()` bisa berarti:

```text
- data memang tidak ada
- query gagal
- database mati
- permission error
- schema mismatch
```

Jangan ubah failure menjadi absence.

---

### 22.2 Retry all SQLExceptions

```java
catch (SQLException e) {
    retry();
}
```

Buruk karena:

```text
- syntax error tidak akan sembuh
- auth error tidak akan sembuh
- constraint violation tidak akan sembuh
- retry bisa menggandakan side effect
- retry bisa memperparah overload
```

---

### 22.3 Log only message

```java
log.error("DB error: {}", e.getMessage());
```

Kurang.

Minimal log:

```text
SQLState, vendorCode, exceptionClass, operation, elapsed time, correlation id
```

---

### 22.4 Expose raw database error to client

Buruk:

```json
{
  "error": "ORA-00001: unique constraint (APP.UK_PERSON_NRIC) violated"
}
```

Masalah:

```text
- leaks schema name
- leaks table/index naming
- exposes database vendor
- may expose sensitive business details
```

Lebih baik:

```json
{
  "error": "CONFLICT",
  "message": "The requested resource already exists."
}
```

---

### 22.5 Continue transaction after unknown error

Buruk:

```java
try {
    step1(con);
    step2(con);
} catch (SQLException e) {
    log.warn("Step failed, continuing", e);
}
step3(con);
con.commit();
```

Kecuali kamu benar-benar tahu error tersebut aman, ini bisa merusak invariant.

---

## 23. Production Checklist

Gunakan checklist ini untuk review aplikasi JDBC.

### 23.1 Classification

```text
[ ] Apakah SQLException diklasifikasikan, bukan hanya dibungkus RuntimeException?
[ ] Apakah SQLState dicatat?
[ ] Apakah vendor error code dicatat?
[ ] Apakah subclass SQLException digunakan sebagai sinyal tambahan?
[ ] Apakah chained exceptions ikut dilog?
[ ] Apakah BatchUpdateException ditangani khusus?
```

### 23.2 Retry

```text
[ ] Apakah retry hanya untuk error yang benar-benar retryable?
[ ] Apakah retry boundary benar: statement vs transaction vs request?
[ ] Apakah write operation punya idempotency key?
[ ] Apakah retry bounded?
[ ] Apakah retry memakai backoff dan jitter?
[ ] Apakah retry menghormati request deadline?
[ ] Apakah ambiguous commit dipikirkan?
```

### 23.3 Transaction

```text
[ ] Apakah rollback dilakukan setelah SQLException dalam explicit transaction?
[ ] Apakah rollback failure tidak menutupi original failure?
[ ] Apakah connection ditutup di finally/try-with-resources?
[ ] Apakah transaction tidak dilanjutkan setelah unknown SQLException?
```

### 23.4 Logging and Security

```text
[ ] Apakah log tidak membocorkan PII/bind value sensitif?
[ ] Apakah raw SQL tidak dilog sembarangan di production?
[ ] Apakah queryName/queryHash tersedia?
[ ] Apakah correlation id tersedia?
[ ] Apakah pool name/database target dilog?
```

### 23.5 Operational Response

```text
[ ] Apakah DB unavailable dipetakan ke response yang benar?
[ ] Apakah constraint violation dipetakan ke domain conflict/validation?
[ ] Apakah syntax/schema error memicu alert engineering?
[ ] Apakah auth/secret failure memicu alert configuration/security?
[ ] Apakah deadlock/serialization failure punya metric tersendiri?
[ ] Apakah timeout punya metric per jenis timeout?
```

---

## 24. Case Study: Workflow State Transition

Bayangkan sistem regulatory case management.

Operasi:

```text
1. User claims case
2. System validates current state
3. System updates assignee
4. System inserts audit trail
5. System emits outbox event
6. Commit
```

Kemungkinan error:

### 24.1 Unique violation pada outbox event id

Makna:

```text
Mungkin duplicate event creation.
```

Respons:

```text
- jika event_id deterministic/idempotent, treat as already inserted
- jika tidak, treat as bug
```

### 24.2 Serialization failure

Makna:

```text
Concurrent state transition conflict under isolation.
```

Respons:

```text
- rollback
- retry whole transaction
- reload current case state
- re-evaluate transition guard
```

### 24.3 Deadlock

Makna:

```text
Two transactions acquired locks in conflicting order.
```

Respons:

```text
- rollback
- retry bounded
- investigate lock ordering
- ensure all state transition code locks rows in consistent order
```

### 24.4 Connection reset during commit

Makna:

```text
Commit result may be unknown.
```

Respons:

```text
- do not blindly retry transition
- reconcile by business operation id
- check case state/audit/outbox by idempotency key
- return uncertain/retry-safe response depending API contract
```

Ini level pemikiran yang membedakan engineer biasa dari engineer yang paham failure semantics.

---

## 25. Mini Reference: What to Inspect from SQLException

Saat menerima `SQLException`, tanya:

```text
1. Apa class exception-nya?
2. Apa SQLState-nya?
3. Apa SQLState class-nya?
4. Apa vendor code-nya?
5. Apakah ada next exception?
6. Apakah ada cause socket/network?
7. Apakah operasi read atau write?
8. Apakah dalam transaction?
9. Apakah commit sudah dikirim?
10. Apakah connection masih bisa dipercaya?
11. Apakah operation idempotent?
12. Apakah retry memperbaiki atau memperburuk?
13. Apa response domain/API yang benar?
14. Apa metric/alert yang perlu naik?
```

---

## 26. Latihan

### Latihan 1 — Classify error

Diberikan error berikut:

```text
SQLState=23505
Message=duplicate key value violates unique constraint
```

Tentukan:

```text
category
retryable?
API response?
connection suspect?
```

Jawaban yang diharapkan:

```text
category: constraint conflict / unique violation
retryable: no, kecuali idempotency path
API response: 409 Conflict atau idempotent success tergantung operation
connection suspect: no
```

---

### Latihan 2 — Deadlock

Diberikan:

```text
SQLState=40P01
Message=deadlock detected
```

Tentukan recovery.

Jawaban:

```text
rollback transaction
retry whole transaction dengan bounded attempts + backoff
investigate lock ordering jika sering terjadi
```

---

### Latihan 3 — Connection failure during write

Diberikan:

```text
SQLState=08006
Operation=submit payment
Failure occurred while committing
```

Apa risiko utama?

Jawaban:

```text
ambiguous commit
aplikasi tidak boleh mengasumsikan write gagal sepenuhnya
perlu reconciliation via business key/idempotency key
```

---

### Latihan 4 — Syntax error in production

Diberikan:

```text
SQLState=42601
Operation=findApplicationByStatus
```

Apa respons?

Jawaban:

```text
jangan retry
treat as code/deployment/schema bug
alert engineering
return 500/internal failure ke client
```

---

## 27. Ringkasan Mental Model

`SQLException` harus dibaca sebagai structured operational signal.

Model ringkas:

```text
SQLException
  ↓
Read class + SQLState + vendor code + chain
  ↓
Classify category
  ↓
Decide connection health
  ↓
Decide retry boundary
  ↓
Rollback/reconnect/reconcile if needed
  ↓
Map to domain/API response
  ↓
Emit metric/log/alert safely
```

Prinsip utama:

1. Jangan treat semua `SQLException` sama.
2. SQLState adalah sinyal portable paling penting.
3. Vendor code berguna, tetapi harus dilokalisasi.
4. Message string bukan kontrak.
5. Retry harus selective, bounded, dan idempotency-aware.
6. Error dalam transaction hampir selalu butuh rollback.
7. Connection failure pada write bisa ambiguous.
8. Batch failure perlu handling khusus.
9. Logging harus structured tetapi tidak membocorkan data sensitif.
10. Exception translation harus mempertahankan root cause.

---

## 28. Hubungan dengan Part Berikutnya

Part ini membangun kemampuan membaca kegagalan. Part berikutnya akan membahas resource lifecycle:

```text
Part 010 — Resource Lifecycle: Closing, Try-With-Resources, Leaks, and Ownership
```

Kenapa urutannya demikian?

Karena setelah memahami error, kita perlu memastikan resource JDBC tetap ditutup dengan benar bahkan ketika error terjadi:

```text
SQLException terjadi
  ↓
transaction harus rollback
  ↓
statement/resultset/connection harus close
  ↓
connection pool tidak boleh bocor
  ↓
root cause tidak boleh tertutup close exception
```

---

## 29. Status Seri

```text
Part 009 dari 029 selesai.
Seri belum selesai.
Part berikutnya: Part 010 — Resource Lifecycle: Closing, Try-With-Resources, Leaks, and Ownership
File berikutnya: learn-java-sql-jdbc-hikaricp-part-010.md
```
