# Part 11 — `Throwable`: Exception Object Model, Stack Trace, Causality, Suppression

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `11-throwable-exception-object-model-causality-stacktrace-suppression.md`  
> Scope: Java 8 hingga Java 25  
> Status: Part 11 dari 32

---

## 1. Tujuan Part Ini

Part ini membahas `java.lang.Throwable` sebagai **object model untuk kegagalan** di Java.

Banyak developer memahami exception hanya sebagai “cara melempar error”. Itu terlalu sempit. Di sistem production, `Throwable` adalah:

1. **struktur data kegagalan**;
2. **carrier causal chain**;
3. **snapshot eksekusi**;
4. **kontrak observability**;
5. **boundary antara domain failure, programming failure, infrastructure failure, dan VM failure**;
6. **alat komunikasi antar layer**;
7. **sumber sinyal untuk retry, rollback, alerting, audit, dan debugging**.

Kalau salah mendesain exception, dampaknya bukan hanya “kode kurang rapi”. Dampaknya bisa berupa:

- root cause hilang;
- retry salah dilakukan;
- transaction rollback salah;
- log penuh noise;
- alert tidak actionable;
- user mendapat error misleading;
- bug susah direproduce;
- stack trace terlalu mahal di hot path;
- detail sensitif bocor ke log/API;
- failure domain bercampur antara business rejection dan system incident.

Target akhir part ini: kamu bisa melihat `Throwable` bukan sebagai syntax `try-catch`, tetapi sebagai **runtime object contract** yang harus didesain dengan invariants yang jelas.

---

## 2. Mental Model Utama

### 2.1 `Throwable` adalah object graph, bukan sekadar pesan error

Secara konseptual, sebuah `Throwable` dapat dilihat seperti ini:

```text
Throwable
├── type/class
├── message
├── cause
│   └── Throwable
│       └── cause ...
├── suppressed[]
│   ├── Throwable
│   └── Throwable
├── stackTrace[]
│   ├── StackTraceElement
│   └── StackTraceElement
└── implementation-specific VM state
```

Jadi exception yang bagus bukan hanya:

```text
"Failed"
```

Tetapi:

```text
BusinessOperationException
├── message: "Failed to approve application APP-123 because payment status cannot be verified"
├── cause: PaymentGatewayTimeoutException
│   └── cause: SocketTimeoutException
├── suppressed: []
└── stack trace: where failure was observed/created
```

Perbedaan ini penting.

Kalimat `"Failed"` tidak menjawab:

- gagal apa?
- di boundary mana?
- apakah retryable?
- apakah user salah input?
- apakah dependency down?
- apakah state domain invalid?
- apakah data corrupt?
- apakah operation sudah partial commit?
- apakah aman ditampilkan ke user?
- apakah aman dicatat di audit log?

`Throwable` adalah media untuk membawa jawaban-jawaban itu.

---

### 2.2 Throwing exception adalah perubahan control flow yang mahal secara semantik

Ketika sebuah method melempar exception, ia tidak mengembalikan value normal.

```java
Result result = service.execute(command);
```

Normal path:

```text
caller -> callee -> return value -> caller continues
```

Exceptional path:

```text
caller -> callee -> throw -> stack unwinds -> nearest matching catch/finally
```

Stack unwinding berarti:

- frame method dilewati;
- `finally` dan try-with-resources cleanup dieksekusi;
- control flow lompat ke handler;
- state lokal hilang;
- caller harus menerima fakta bahwa operasi tidak selesai normal.

Karena itu, exception bukan “if statement yang lebih keren”. Exception adalah mekanisme untuk kondisi yang memutus kontrak normal method.

---

### 2.3 Exception punya dua dimensi: cause dan responsibility

Ada dua pertanyaan berbeda:

```text
Apa penyebab teknis terdalamnya?
Siapa yang bertanggung jawab merespons?
```

Contoh:

```text
SQLException: ORA-00001 unique constraint violated
```

Penyebab teknis: constraint violation.

Responsibility bisa berbeda:

- kalau duplicate request ID dari client: client/domain validation issue;
- kalau retry message menyebabkan duplicate insert: idempotency design issue;
- kalau sequence corrupt: database/system issue;
- kalau race condition: concurrency design issue.

Karena itu, jangan hanya membungkus semua error teknis menjadi `RuntimeException`. Layer aplikasi harus menerjemahkan failure ke kategori operasional yang tepat.

---

### 2.4 Stack trace adalah observability, bukan business data

Stack trace menjawab:

```text
Di jalur kode mana Throwable dibuat/dilempar?
```

Stack trace tidak selalu menjawab:

```text
Business object mana yang gagal?
User siapa?
Request ID apa?
Tenant apa?
External dependency apa?
Retryable atau tidak?
```

Itu harus ditambahkan lewat:

- message yang baik;
- structured log;
- correlation ID;
- error code;
- domain exception fields;
- metrics/tags;
- tracing span.

Stack trace penting, tapi tidak cukup.

---

## 3. Posisi `Throwable` dalam Java Platform

### 3.1 Hierarchy dasar

```text
java.lang.Object
└── java.lang.Throwable
    ├── java.lang.Error
    └── java.lang.Exception
        └── java.lang.RuntimeException
```

Makna umumnya:

| Type | Makna umum | Biasanya ditangani aplikasi? |
|---|---|---|
| `Throwable` | semua object yang bisa dilempar | jarang catch langsung |
| `Error` | masalah serius level VM/linkage/resource | biasanya tidak |
| `Exception` | kondisi yang mungkin ingin ditangani aplikasi | ya |
| `RuntimeException` | unchecked exception, sering programming/contract violation | tergantung boundary |

`Throwable` adalah superclass dari semua error dan exception. Hanya instance `Throwable` atau subclass-nya yang bisa dilempar oleh JVM atau `throw` statement.

---

### 3.2 Checked vs unchecked bukan berarti recoverable vs unrecoverable

Java membagi exception menjadi:

```text
Checked:
- Exception selain RuntimeException
- harus declared/caught

Unchecked:
- RuntimeException
- Error
- tidak wajib declared/caught
```

Namun ini hanya aturan compile-time.

Contoh checked tetapi sering tidak recoverable secara lokal:

```java
IOException while writing response body
SQLException because database connection is broken
ClassNotFoundException during boot
```

Contoh unchecked tetapi bisa ditangani pada boundary tertentu:

```java
IllegalArgumentException from user-provided parameter parsing
DateTimeParseException from API input
CompletionException wrapping retryable remote failure
```

Jadi jangan menyederhanakan:

```text
checked = recoverable
unchecked = bug
```

Lebih tepat:

```text
checked = compiler forces caller to acknowledge possibility
unchecked = caller not forced by compiler
```

Keputusan desain tetap harus berdasarkan domain dan boundary.

---

## 4. Anatomy `Throwable`

### 4.1 Message

Message adalah detail manusiawi:

```java
throw new IllegalArgumentException("applicationId must not be blank");
```

Message yang baik:

- spesifik;
- menyebut invariant yang gagal;
- menyebut context aman;
- tidak membocorkan secret;
- tidak terlalu panjang;
- tidak memaksa parser machine membaca free text.

Buruk:

```java
throw new RuntimeException("Error");
throw new RuntimeException("Failed");
throw new RuntimeException("Invalid");
```

Lebih baik:

```java
throw new IllegalArgumentException("applicationId must not be blank");
throw new InvalidApplicationStateException(
    "Cannot approve application APP-123 from state CANCELLED"
);
```

Namun untuk production, jangan hanya mengandalkan message. Gunakan error code/structured metadata bila dibutuhkan.

---

### 4.2 Cause

Cause menyimpan `Throwable` yang menyebabkan `Throwable` ini.

```java
try {
    repository.save(entity);
} catch (SQLException e) {
    throw new DataAccessException("Failed to save application " + entity.id(), e);
}
```

Tanpa cause:

```java
throw new DataAccessException("Failed to save application");
```

Root cause hilang.

Dengan cause:

```text
DataAccessException
└── caused by SQLException
    └── caused by SocketTimeoutException
```

Rule penting:

> Saat menerjemahkan exception antar layer, pertahankan cause kecuali ada alasan kuat untuk tidak melakukannya.

---

### 4.3 Stack trace

Stack trace biasanya diisi saat `Throwable` dibuat, melalui `fillInStackTrace()`.

```java
Throwable t = new RuntimeException("boom");
```

Pada titik constructor dipanggil, VM meng-capture stack execution saat itu.

Artinya:

```java
RuntimeException e = new RuntimeException("created here");

someOtherMethod(e);

throw e;
```

Stack trace cenderung menunjukkan lokasi creation, bukan selalu lokasi `throw` terakhir. Ini penting saat kamu menyimpan exception lalu melemparnya belakangan.

---

### 4.4 Suppressed exceptions

Suppressed exception digunakan ketika ada exception utama dan exception tambahan yang terjadi saat cleanup.

Contoh paling umum: try-with-resources.

```java
try (Resource r = open()) {
    r.use(); // throws primary exception
}
```

Jika `use()` melempar exception, lalu `close()` juga melempar exception, Java tidak bisa melempar dua exception sekaligus. Maka exception dari `close()` disimpan sebagai suppressed pada exception utama.

Model:

```text
PrimaryException: failure during use
└── suppressed:
    └── CloseException: failure during close
```

Tanpa suppressed exception, failure cleanup akan hilang.

---

## 5. Constructor `Throwable` dan Implikasinya

### 5.1 Constructor umum

Bentuk umum:

```java
new Throwable()
new Throwable(String message)
new Throwable(String message, Throwable cause)
new Throwable(Throwable cause)
```

Sebagian subclass juga menyediakan constructor serupa.

Pola ideal custom exception:

```java
public class PaymentGatewayException extends RuntimeException {
    public PaymentGatewayException(String message) {
        super(message);
    }

    public PaymentGatewayException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Minimal, sediakan constructor `(String message, Throwable cause)` untuk exception translation.

---

### 5.2 Constructor advanced: suppression dan writable stack trace

`Throwable` punya protected constructor:

```java
protected Throwable(
    String message,
    Throwable cause,
    boolean enableSuppression,
    boolean writableStackTrace
)
```

Ini memungkinkan membuat exception tanpa suppression atau tanpa writable stack trace.

Contoh:

```java
public final class FastPathRejectedException extends RuntimeException {
    public FastPathRejectedException(String message) {
        super(message, null, false, false);
    }
}
```

Namun hati-hati. Exception tanpa stack trace mengorbankan observability.

Gunakan hanya jika:

- exception memang bagian dari hot-path control signal;
- failure location sudah jelas dari call-site;
- ada metrics/logging lain;
- bukan error production yang perlu debugging mendalam.

Untuk business/system failure biasa, jangan matikan stack trace.

---

## 6. Causality: Cara Mendesain Cause Chain yang Berguna

### 6.1 Layer translation yang benar

Misal flow:

```text
Controller
└── ApplicationService
    └── Repository
        └── JDBC Driver
```

JDBC melempar:

```text
SQLTimeoutException
```

Repository sebaiknya menerjemahkan:

```java
throw new RepositoryUnavailableException(
    "Timed out while loading application " + applicationId,
    e
);
```

Application service bisa menerjemahkan lagi jika perlu:

```java
throw new ApplicationLoadException(
    "Cannot process approval because application could not be loaded: " + applicationId,
    e
);
```

Namun jangan terlalu banyak wrapping jika tidak menambah makna.

Buruk:

```text
RuntimeException: failed
└── RuntimeException: failed
    └── RuntimeException: failed
        └── SQLTimeoutException
```

Baik:

```text
ApplicationLoadException: Cannot process approval because application could not be loaded: APP-123
└── RepositoryUnavailableException: Timed out while loading application APP-123
    └── SQLTimeoutException: ...
```

Setiap layer menambah makna:

- operation;
- domain object;
- boundary;
- dependency;
- retry classification.

---

### 6.2 Jangan kehilangan root cause

Anti-pattern:

```java
catch (IOException e) {
    throw new RuntimeException("Failed to read config");
}
```

Root cause hilang.

Benar:

```java
catch (IOException e) {
    throw new RuntimeException("Failed to read config", e);
}
```

Anti-pattern lain:

```java
catch (Exception e) {
    log.error("Failed", e);
    throw new RuntimeException(e.getMessage());
}
```

Masalah:

- type root cause hilang;
- stack trace baru tidak punya cause;
- message root cause belum tentu cukup;
- observability rusak.

---

### 6.3 Cause bukan tempat untuk semua context

Jangan membuat cause chain palsu.

Buruk:

```java
throw new BusinessException(
    "Invalid state",
    new RuntimeException("applicationId=APP-123")
);
```

Context bukan exception.

Lebih baik:

```java
throw new InvalidApplicationStateException(
    "Cannot approve application APP-123 from state CANCELLED"
);
```

Atau exception dengan field:

```java
public final class InvalidApplicationStateException extends RuntimeException {
    private final String applicationId;
    private final String currentState;
    private final String attemptedAction;

    public InvalidApplicationStateException(
            String applicationId,
            String currentState,
            String attemptedAction
    ) {
        super("Cannot " + attemptedAction + " application " + applicationId
                + " from state " + currentState);
        this.applicationId = applicationId;
        this.currentState = currentState;
        this.attemptedAction = attemptedAction;
    }

    public String applicationId() {
        return applicationId;
    }

    public String currentState() {
        return currentState;
    }

    public String attemptedAction() {
        return attemptedAction;
    }
}
```

---

## 7. Suppressed Exceptions dan Try-With-Resources

### 7.1 Problem sebelum try-with-resources

Manual cleanup klasik:

```java
Resource r = null;
try {
    r = open();
    r.use();
} finally {
    if (r != null) {
        r.close();
    }
}
```

Jika `use()` throw, lalu `close()` throw, exception dari `close()` bisa menimpa exception utama tergantung implementasi.

Try-with-resources memperbaiki ini:

```java
try (Resource r = open()) {
    r.use();
}
```

Jika body dan close sama-sama gagal:

```text
body exception = primary
close exception = suppressed
```

---

### 7.2 Membaca suppressed exceptions

```java
catch (Exception e) {
    System.err.println("Primary: " + e);
    for (Throwable suppressed : e.getSuppressed()) {
        System.err.println("Suppressed: " + suppressed);
    }
}
```

Ini penting saat debugging resource cleanup.

---

### 7.3 Suppressed exception bukan cause

Cause menjawab:

```text
Apa yang menyebabkan exception ini?
```

Suppressed menjawab:

```text
Exception tambahan apa yang terjadi tetapi tidak menjadi primary thrown exception?
```

Contoh:

```text
IOException: failed while writing file
├── caused by: DiskFullException
└── suppressed:
    └── IOException: failed to close file handle
```

Jangan gunakan suppressed sebagai tempat menyimpan “daftar error validasi” kecuali kamu punya alasan desain yang sangat jelas. Untuk validation errors, lebih baik gunakan domain object seperti:

```java
record ValidationError(String field, String code, String message) {}
```

---

## 8. Stack Trace: Cost, Meaning, dan Pitfalls

### 8.1 Stack trace capture punya biaya

Membuat exception umumnya lebih mahal daripada membuat object biasa karena VM perlu menangkap stack trace.

Buruk untuk hot-path normal control flow:

```java
try {
    return cache.get(key);
} catch (KeyNotFoundException e) {
    return loadFromDatabase(key);
}
```

Jika cache miss adalah kondisi normal, jangan jadikan exception sebagai jalur normal.

Lebih baik:

```java
Optional<Value> cached = cache.find(key);
if (cached.isPresent()) {
    return cached.get();
}
return loadFromDatabase(key);
```

Atau:

```java
Value value = cache.getOrNull(key);
if (value != null) {
    return value;
}
return loadFromDatabase(key);
```

---

### 8.2 Stack trace bisa sangat panjang dan noisy

Framework modern bisa menghasilkan stack trace panjang:

```text
Controller
SecurityFilter
TransactionInterceptor
Proxy
Reflection
Dispatcher
...
```

Tugas engineer senior bukan sekadar membaca stack trace dari atas ke bawah, tetapi mencari:

1. exception type pertama yang meaningful;
2. message yang domain-relevant;
3. root cause;
4. boundary crossing;
5. first application frame;
6. repeated wrapper patterns;
7. suppressed exception;
8. thread/request context;
9. correlation id;
10. whether error is deterministic or environmental.

---

### 8.3 Re-throw tanpa kehilangan stack

Benar:

```java
catch (IOException e) {
    throw e;
}
```

Atau translate with cause:

```java
catch (IOException e) {
    throw new ConfigLoadException("Failed to load config", e);
}
```

Buruk:

```java
catch (IOException e) {
    throw new IOException(e.getMessage());
}
```

Ini membuat exception baru dan kehilangan cause.

---

### 8.4 `fillInStackTrace()`

`fillInStackTrace()` mengisi ulang stack trace ke lokasi saat method itu dipanggil.

Kadang subclass override untuk performance:

```java
@Override
public synchronized Throwable fillInStackTrace() {
    return this;
}
```

Namun ini berbahaya untuk debugging. Lebih jelas menggunakan constructor advanced `writableStackTrace=false`.

Gunakan hanya untuk exception yang benar-benar bukan diagnostic failure, misalnya internal sentinel di parser/hot path.

---

## 9. Helpful NullPointerException

Sejak Java 14, JVM dapat memberikan detail lebih baik pada `NullPointerException` dengan menganalisis bytecode untuk menentukan ekspresi mana yang null.

Contoh lama:

```text
NullPointerException
```

Lebih helpful:

```text
Cannot invoke "User.name()" because "user" is null
```

Ini membantu debugging, tetapi jangan jadikan NPE sebagai validation mechanism.

Buruk:

```java
public void approve(Application application) {
    application.owner().email().send(...); // biarkan NPE kalau null
}
```

Lebih baik:

```java
public void approve(Application application) {
    Objects.requireNonNull(application, "application must not be null");
    Objects.requireNonNull(application.owner(), "application.owner must not be null");

    application.owner().email().send(...);
}
```

Untuk boundary publik, NPE detail bukan pengganti kontrak input.

---

## 10. Exception Design: Domain, Application, Infrastructure, Programming

### 10.1 Empat kategori praktis

Untuk sistem production, lebih berguna mengklasifikasi failure seperti ini:

| Kategori | Contoh | Respons umum |
|---|---|---|
| Domain rejection | state tidak valid, business rule gagal | 4xx/domain response, no retry |
| Application conflict | idempotency conflict, stale version | retry terbatas atau user action |
| Infrastructure failure | DB timeout, remote service down | retry/circuit breaker/alert |
| Programming error | invariant broken, null unexpected | fail fast, fix code |

Contoh:

```text
Cannot approve CANCELLED application
```

Itu bukan `RuntimeException("Failed")`. Itu domain rejection.

```java
throw new InvalidApplicationStateException(
    applicationId,
    currentState,
    "approve"
);
```

Contoh infrastructure:

```java
throw new PaymentGatewayUnavailableException(
    "Payment gateway timed out while verifying payment for application " + applicationId,
    e
);
```

Contoh programming error:

```java
throw new IllegalStateException(
    "Approval workflow reached APPROVED without assigned approver"
);
```

---

### 10.2 Domain exception sebaiknya tidak terlalu teknis

Buruk:

```java
throw new SQLException("Cannot approve application");
```

Domain layer tidak seharusnya membocorkan SQL.

Lebih baik:

```java
throw new ApplicationApprovalException(
    "Cannot approve application " + applicationId,
    cause
);
```

Namun hati-hati: jangan sembunyikan root cause dari log internal.

---

### 10.3 Exception fields vs message

Untuk machine handling:

```java
public final class RuleViolationException extends RuntimeException {
    private final String ruleCode;
    private final String entityId;

    public RuleViolationException(String ruleCode, String entityId, String message) {
        super(message);
        this.ruleCode = ruleCode;
        this.entityId = entityId;
    }

    public String ruleCode() {
        return ruleCode;
    }

    public String entityId() {
        return entityId;
    }
}
```

Keuntungan:

- API response bisa memakai `ruleCode`;
- log bisa structured;
- metrics bisa tag by low-cardinality code;
- message tetap human-readable.

Jangan parsing message untuk logic:

```java
if (e.getMessage().contains("DUPLICATE")) { ... }
```

Itu brittle.

---

## 11. Checked Exception: Kapan Berguna, Kapan Mengganggu

### 11.1 Checked exception berguna untuk boundary yang caller harus akui

Contoh:

```java
public Config load(Path path) throws IOException
```

Caller memang harus memutuskan:

- fallback?
- fail startup?
- use default?
- show config error?

Checked exception dapat memaksa awareness.

---

### 11.2 Checked exception mengganggu jika terlalu rendah level

Buruk:

```java
public void approve(ApplicationId id)
        throws SQLException, IOException, TimeoutException, ParserConfigurationException
```

Ini membocorkan implementasi.

Lebih baik:

```java
public void approve(ApplicationId id) throws ApprovalException
```

Atau unchecked application exception jika boundary desainnya demikian:

```java
public void approve(ApplicationId id)
```

dengan failure handled at application boundary.

---

### 11.3 Library vs application berbeda

Library publik sering lebih cocok memakai checked exception bila caller dapat recover dengan jelas.

Application internal sering lebih cocok memakai unchecked exception dengan boundary handler, karena:

- call chain panjang;
- wrapping checked exception di setiap layer noisy;
- recovery biasanya di boundary, bukan di tengah-tengah.

Namun jangan dogmatis. Keputusan harus berdasarkan contract.

---

## 12. `InterruptedException`: Exception yang Sering Dirusak

Walaupun concurrency sudah dibahas di seri lain, `InterruptedException` wajib disebut karena ini salah satu exception paling sering salah ditangani.

Buruk:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    // ignore
}
```

Ini menghapus sinyal cancellation.

Lebih baik jika method bisa throw:

```java
public void waitForCompletion() throws InterruptedException {
    Thread.sleep(1000);
}
```

Jika tidak bisa throw:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationCancelledException("Interrupted while waiting for completion", e);
}
```

Invariant:

> Jika menangkap `InterruptedException` dan tidak melemparkannya lagi, restore interrupt status kecuali kamu benar-benar consume interrupt dengan alasan eksplisit.

---

## 13. Exception Translation di Layered Architecture

### 13.1 Repository layer

```java
public Application findById(ApplicationId id) {
    try {
        return jdbcFind(id);
    } catch (SQLException e) {
        throw new RepositoryException(
            "Failed to load application " + id.value(),
            e
        );
    }
}
```

Repository menerjemahkan SQL-specific failure menjadi persistence boundary failure.

---

### 13.2 Application service layer

```java
public void approve(ApplicationId id, UserId approver) {
    Application app;
    try {
        app = repository.findById(id);
    } catch (RepositoryException e) {
        throw new ApplicationProcessingException(
            "Cannot approve application " + id.value()
                    + " because it could not be loaded",
            e
        );
    }

    app.approve(approver);
    repository.save(app);
}
```

Application service memberi context operation.

---

### 13.3 API boundary

```java
try {
    approvalService.approve(id, user);
    return Response.noContent().build();
} catch (InvalidApplicationStateException e) {
    return domainError(409, e.ruleCode(), e.getMessage());
} catch (ApplicationProcessingException e) {
    log.error("Application approval failed", e);
    return serverError("APPROVAL_FAILED");
}
```

Boundary menerjemahkan internal exception ke response contract.

---

## 14. Logging Exception dengan Benar

### 14.1 Log sekali di boundary yang bertanggung jawab

Anti-pattern:

```java
catch (Exception e) {
    log.error("Repository failed", e);
    throw e;
}
```

Lalu service:

```java
catch (Exception e) {
    log.error("Service failed", e);
    throw e;
}
```

Lalu controller:

```java
catch (Exception e) {
    log.error("Request failed", e);
    return 500;
}
```

Hasilnya satu failure menghasilkan tiga log error.

Lebih baik:

- lower layer menambah context via exception;
- boundary yang memutuskan response/retry/logging melakukan log utama.

---

### 14.2 Jangan log secret di message

Buruk:

```java
throw new AuthenticationException(
    "Login failed for username=" + username + ", password=" + password
);
```

Buruk:

```java
throw new ApiException("Token rejected: " + token);
```

Lebih baik:

```java
throw new AuthenticationException(
    "Login failed for username=" + username
);
```

Atau log masked/hashed identifiers bila perlu.

---

### 14.3 Message high-cardinality

Message seperti ini bisa membuat metrics/log aggregation berat:

```java
"Failed for payload: " + hugeJson
```

Lebih baik:

```java
"Failed to process payment verification response"
```

Context detail masuk structured log dengan kontrol ukuran/sanitization:

```java
log.error("Payment verification failed: applicationId={}, gateway={}, statusCode={}",
        applicationId, gatewayName, statusCode, e);
```

---

## 15. API Response dan Exception

Exception internal tidak boleh otomatis menjadi API response.

Buruk:

```json
{
  "error": "java.sql.SQLTimeoutException: ORA-01013..."
}
```

Masalah:

- leakage;
- coupling internal;
- security risk;
- unstable contract;
- user tidak paham.

Lebih baik:

```json
{
  "code": "APPLICATION_APPROVAL_TEMPORARILY_UNAVAILABLE",
  "message": "The application could not be approved at this time. Please try again later.",
  "correlationId": "..."
}
```

Untuk domain rejection:

```json
{
  "code": "APPLICATION_STATE_INVALID",
  "message": "Application cannot be approved from CANCELLED state.",
  "details": {
    "applicationId": "APP-123",
    "currentState": "CANCELLED"
  }
}
```

---

## 16. Exception dan Transaction Boundary

Exception sering menentukan rollback.

Framework seperti Spring biasanya rollback untuk unchecked exception secara default, tetapi tidak selalu untuk checked exception kecuali dikonfigurasi. Walaupun ini bukan seri Spring, mental modelnya penting:

```text
exception type -> transaction interceptor decision -> commit/rollback
```

Jadi exception taxonomy punya konsekuensi data consistency.

Contoh bahaya:

```java
try {
    debit();
    credit();
} catch (Exception e) {
    log.error("Transfer failed", e);
}
```

Jika exception ditelan, transaction boundary mungkin menganggap method sukses.

Lebih baik:

```java
try {
    debit();
    credit();
} catch (Exception e) {
    throw new TransferFailedException("Transfer failed", e);
}
```

Atau return explicit failure result jika transaction boundary memang didesain begitu.

---

## 17. Exception dan Retry Semantics

Retry seharusnya tidak berdasarkan “semua exception”.

Buruk:

```java
retry(() -> service.call());
```

tanpa filtering.

Lebih baik klasifikasi:

```java
boolean retryable(Throwable t) {
    Throwable root = rootCause(t);

    return root instanceof SocketTimeoutException
        || root instanceof ConnectException
        || t instanceof TemporarilyUnavailableException;
}
```

Namun juga hati-hati. Tidak semua timeout aman di-retry. Jika operation punya side effect, retry butuh idempotency key atau deduplication.

Exception taxonomy sebaiknya membawa semantic:

```java
interface RetryableFailure {}

public final class PaymentGatewayTimeoutException
        extends RuntimeException
        implements RetryableFailure {
    ...
}
```

Atau field:

```java
enum RetryPolicy {
    NEVER,
    SAFE_IMMEDIATE,
    SAFE_WITH_BACKOFF,
    ONLY_IF_IDEMPOTENT
}
```

---

## 18. Utility untuk Root Cause dan Causal Chain

### 18.1 Root cause extraction

```java
public static Throwable rootCause(Throwable throwable) {
    Throwable current = Objects.requireNonNull(throwable, "throwable");
    while (current.getCause() != null && current.getCause() != current) {
        current = current.getCause();
    }
    return current;
}
```

Hati-hati dengan cycle. `Throwable.initCause` mencegah self-causation, tetapi defensive utility tetap baik.

---

### 18.2 Walk causal chain

```java
public static List<Throwable> causalChain(Throwable throwable) {
    Objects.requireNonNull(throwable, "throwable");

    List<Throwable> result = new ArrayList<>();
    Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());

    Throwable current = throwable;
    while (current != null && seen.add(current)) {
        result.add(current);
        current = current.getCause();
    }

    return result;
}
```

Kenapa `IdentityHashMap`?

Karena exception identity lebih relevan daripada `equals`. Sebagian exception bisa override equality, walaupun jarang.

---

## 19. Custom Exception: Template yang Lebih Aman

### 19.1 Simple unchecked exception

```java
public class ApplicationProcessingException extends RuntimeException {
    public ApplicationProcessingException(String message) {
        super(message);
    }

    public ApplicationProcessingException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

---

### 19.2 Domain exception dengan code

```java
public abstract class DomainException extends RuntimeException {
    private final String code;

    protected DomainException(String code, String message) {
        super(message);
        this.code = Objects.requireNonNull(code, "code");
    }

    public String code() {
        return code;
    }
}
```

```java
public final class InvalidApplicationStateException extends DomainException {
    private final String applicationId;
    private final String currentState;
    private final String attemptedAction;

    public InvalidApplicationStateException(
            String applicationId,
            String currentState,
            String attemptedAction
    ) {
        super(
            "APPLICATION_STATE_INVALID",
            "Cannot " + attemptedAction + " application " + applicationId
                    + " from state " + currentState
        );
        this.applicationId = Objects.requireNonNull(applicationId, "applicationId");
        this.currentState = Objects.requireNonNull(currentState, "currentState");
        this.attemptedAction = Objects.requireNonNull(attemptedAction, "attemptedAction");
    }

    public String applicationId() {
        return applicationId;
    }

    public String currentState() {
        return currentState;
    }

    public String attemptedAction() {
        return attemptedAction;
    }
}
```

---

### 19.3 Infrastructure exception with retry hint

```java
public final class ExternalDependencyException extends RuntimeException {
    private final String dependency;
    private final boolean retryable;

    public ExternalDependencyException(
            String dependency,
            boolean retryable,
            String message,
            Throwable cause
    ) {
        super(message, cause);
        this.dependency = Objects.requireNonNull(dependency, "dependency");
        this.retryable = retryable;
    }

    public String dependency() {
        return dependency;
    }

    public boolean retryable() {
        return retryable;
    }
}
```

---

## 20. Exception vs Result Type

Exception bukan satu-satunya cara merepresentasikan failure.

### 20.1 Gunakan exception untuk kontrak gagal yang memutus normal flow

Contoh:

```java
application.approve(approver);
```

Jika approve dari state invalid adalah pelanggaran invariant domain, exception masuk akal.

---

### 20.2 Gunakan result untuk expected alternative outcome

Contoh validasi batch:

```java
ValidationResult result = validator.validate(command);
if (!result.isValid()) {
    return result;
}
```

Atau parser yang expected gagal banyak kali:

```java
ParseResult result = parser.tryParse(input);
```

Jangan melempar exception untuk setiap row invalid dalam file 1 juta baris jika invalid row adalah outcome expected. Itu akan mahal dan noisy.

---

### 20.3 Hybrid

Boundary command:

```java
ValidationResult validation = validator.validate(command);
if (!validation.isValid()) {
    throw new CommandValidationException(validation);
}
```

Internal validator memakai result, application boundary memakai exception untuk stop flow.

---

## 21. Failure Modes yang Sering Terjadi

### 21.1 Swallowing exception

```java
catch (Exception e) {
}
```

Efek:

- failure hilang;
- data mungkin inconsistent;
- caller menganggap success;
- debug hampir mustahil.

Jika memang sengaja ignore, tulis alasan:

```java
catch (NoSuchFileException e) {
    // File is optional. Absence means default configuration will be used.
}
```

---

### 21.2 Log and throw everywhere

```java
catch (Exception e) {
    log.error("Failed", e);
    throw e;
}
```

Efek:

- duplicate logs;
- alert noise;
- error budget misleading.

---

### 21.3 Wrapping without cause

```java
throw new RuntimeException("Failed");
```

Efek:

- root cause hilang.

---

### 21.4 Catching `Throwable`

```java
catch (Throwable t) {
    ...
}
```

Berbahaya karena menangkap `Error`.

Hanya gunakan di boundary sangat spesifik:

- top-level thread boundary;
- executor boundary;
- test harness;
- framework container;
- logging emergency before termination.

Bahkan di sana, sering perlu rethrow `Error`.

---

### 21.5 Catching `Exception` terlalu luas

```java
catch (Exception e) {
    return false;
}
```

Masalah:

- NPE/programming bug berubah jadi business false;
- infrastructure failure disembunyikan;
- security exception bisa tertelan;
- data quality issue tidak terlihat.

---

### 21.6 Exception as normal branch

```java
try {
    return map.get(key);
} catch (NoSuchElementException e) {
    return defaultValue;
}
```

Jika missing key normal, gunakan API yang mengekspresikan normal absence.

---

### 21.7 Throwing generic `RuntimeException`

```java
throw new RuntimeException("Invalid state");
```

Masalah:

- handler tidak bisa distinguish;
- retry/rollback/response mapping tidak jelas;
- observability lemah.

---

### 21.8 High-cardinality messages

```java
throw new RuntimeException("Payload failed: " + requestBody);
```

Masalah:

- log besar;
- PII leak;
- metrics cardinality explosion;
- security issue.

---

## 22. Production Checklist

Gunakan checklist ini saat mendesain exception:

### 22.1 Untuk setiap custom exception

- [ ] Apakah namanya menjelaskan kategori failure?
- [ ] Apakah ada constructor `(String message, Throwable cause)`?
- [ ] Apakah cause dipertahankan saat translation?
- [ ] Apakah message actionable?
- [ ] Apakah message bebas secret/PII?
- [ ] Apakah ada error code jika perlu machine handling?
- [ ] Apakah exception taxonomy memengaruhi rollback/retry/API response?
- [ ] Apakah exception terlalu generic?
- [ ] Apakah checked/unchecked dipilih berdasarkan contract, bukan selera?

### 22.2 Untuk setiap catch block

- [ ] Apakah catch ini benar-benar bisa menangani error?
- [ ] Apakah catch terlalu luas?
- [ ] Apakah exception ditelan?
- [ ] Apakah cause dipertahankan jika dibungkus?
- [ ] Apakah `InterruptedException` ditangani benar?
- [ ] Apakah log dilakukan di boundary yang tepat?
- [ ] Apakah retry aman dan idempotent?
- [ ] Apakah transaction akan rollback sesuai harapan?

### 22.3 Untuk observability

- [ ] Ada correlation/request ID?
- [ ] Ada domain identifier yang aman?
- [ ] Ada dependency name untuk external failure?
- [ ] Ada error code stabil?
- [ ] Stack trace tidak dimatikan untuk failure penting?
- [ ] Suppressed exceptions tidak diabaikan?
- [ ] Log tidak bocor secret?
- [ ] Message tidak terlalu besar/high-cardinality?

---

## 23. Java 8–25 Evolution Notes

### 23.1 Java 7 baseline relevance

Walaupun seri ini Java 8–25, suppressed exceptions dan try-with-resources berasal dari Java 7, sehingga di Java 8 sudah tersedia.

Artinya semua sistem Java 8+ harus memahami:

- `getSuppressed()`;
- `addSuppressed()`;
- try-with-resources behavior.

---

### 23.2 Java 9+

Java 9 memperkenalkan module system. Exception stack trace bisa memperlihatkan module/class loader information pada format tertentu, dan reflective access failure menjadi lebih relevan pada dunia JPMS.

---

### 23.3 Java 14+

Helpful NullPointerException diperkenalkan untuk meningkatkan diagnostic NPE. Ini mengubah kualitas message NPE, tetapi bukan kontrak validasi yang boleh diandalkan untuk API publik.

---

### 23.4 Java 21–25

Pada Java modern:

- virtual threads membuat stack trace dan thread context tetap penting;
- structured concurrency dapat membungkus failure dari task subtasks;
- framework modern banyak memakai wrapper exception (`CompletionException`, `ExecutionException`, framework-specific wrappers);
- observability/tracing membuat exception classification semakin penting.

Walaupun banyak fitur bukan bagian langsung dari `java.lang.Throwable`, desain exception harus kompatibel dengan cara runtime modern menjalankan task.

---

## 24. Latihan Pemahaman

### Latihan 1 — Perbaiki exception translation

Kode awal:

```java
try {
    jdbc.update(sql);
} catch (SQLException e) {
    throw new RuntimeException("Failed");
}
```

Tingkatkan menjadi:

- mempertahankan cause;
- menyebut operation;
- menyebut entity ID aman;
- memakai custom exception.

Contoh jawaban:

```java
try {
    jdbc.update(sql);
} catch (SQLException e) {
    throw new RepositoryException(
        "Failed to update application " + applicationId,
        e
    );
}
```

---

### Latihan 2 — Tentukan exception atau result

Kasus:

1. User memasukkan tanggal invalid di form.
2. Database connection timeout.
3. Method internal menerima null padahal kontrak melarang null.
4. Batch import menemukan 2.000 row invalid dari 1 juta row.
5. Workflow approve dipanggil pada state `CANCELLED`.

Diskusikan apakah pakai exception, result, atau kombinasi.

Jawaban yang masuk akal:

| Kasus | Representasi |
|---|---|
| tanggal invalid di form | validation result/domain error |
| DB timeout | exception |
| null internal unexpected | `NullPointerException`/`IllegalArgumentException`/`Objects.requireNonNull` |
| batch invalid rows | result/report, bukan exception per row |
| approve from CANCELLED | domain exception atau domain result tergantung style boundary |

---

### Latihan 3 — Baca causal chain

Diberikan:

```text
ApplicationProcessingException: Cannot approve APP-123
Caused by: RepositoryException: Failed to load APP-123
Caused by: SQLTimeoutException: query timed out
```

Jawab:

- root cause?
- operation gagal?
- layer mana yang memberi context domain?
- apakah retry mungkin?
- data apa yang perlu dicari di log?

---

## 25. Ringkasan

`Throwable` adalah fondasi object model untuk kegagalan di Java.

Poin terpenting:

1. `Throwable` menyimpan message, cause, suppressed exceptions, dan stack trace.
2. Cause chain harus dipertahankan saat exception translation.
3. Suppressed exceptions penting untuk cleanup failure, terutama try-with-resources.
4. Stack trace berguna tetapi punya biaya; jangan gunakan exception untuk normal hot-path branching.
5. Checked vs unchecked adalah aturan compile-time, bukan jaminan recoverability.
6. Exception taxonomy harus mendukung retry, rollback, API response, audit, dan observability.
7. Jangan menelan exception tanpa alasan eksplisit.
8. Jangan log dan throw di semua layer.
9. Jangan membocorkan secret/PII dalam exception message.
10. `InterruptedException` harus diperlakukan sebagai cancellation signal.
11. Helpful NPE membantu debugging, tetapi bukan pengganti input contract.
12. Exception yang baik membawa makna operasional, bukan hanya teks `"failed"`.

---

## 26. Hubungan ke Part Berikutnya

Part ini membahas `Throwable` sebagai object model.

Part berikutnya akan memperluas ke taxonomy lebih besar:

```text
Throwable
├── Error
├── Exception
└── RuntimeException
```

Kita akan membahas kapan catching `Error` berbahaya, bagaimana membedakan recoverable/unrecoverable failure, `LinkageError`, `OutOfMemoryError`, `StackOverflowError`, `AssertionError`, serta bagaimana membuat failure taxonomy yang defensible untuk sistem enterprise.

---

## 27. Status Seri

Progress:

```text
[x] Part 0  — Orientation
[x] Part 1  — java.lang as Platform Root Contract
[x] Part 2  — Object
[x] Part 3  — Class<T>
[x] Part 4  — String
[x] Part 5  — CharSequence/StringBuilder/StringBuffer
[x] Part 6  — Primitive Wrappers
[x] Part 7  — Boolean/Character
[x] Part 8  — Enum
[x] Part 9  — Record
[x] Part 10 — Sealed Types
[x] Part 11 — Throwable
[ ] Part 12 — Exception, RuntimeException, Error
...
[ ] Part 32 — Capstone
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./10-sealed-types-runtime-view-permitted-subclasses-exhaustiveness.md">⬅️ Part 10 — Sealed Types Runtime View: `Class`, Permitted Subclasses, and Exhaustiveness</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./12-exception-runtimeexception-error-failure-taxonomy.md">Part 12 — `Exception`, `RuntimeException`, `Error`: Failure Taxonomy for Serious Systems ➡️</a>
</div>
