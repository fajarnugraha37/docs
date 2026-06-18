# Learn Java Part 008 — Error Handling, Exceptions, dan Reliability Engineering

> Target: Java hingga versi 25  
> Audience: software engineer yang ingin memahami Java bukan hanya sebagai bahasa, tetapi sebagai platform untuk membangun sistem yang benar, tahan gagal, observable, dan mudah dirawat.  
> Fokus bagian ini: `Throwable`, checked/unchecked exception, error boundary, resource cleanup, suppressed exception, interruption/cancellation, retryability, failure model, dan desain error handling production-grade.

---

## 0. Posisi Bagian Ini dalam Roadmap

Pada bagian sebelumnya kita sudah membahas:

- syntax dan semantics Java;
- object model;
- type system dan generics;
- modern language features;
- functional programming;
- collections dan data structures.

Sekarang kita masuk ke area yang sering terlihat sederhana tetapi justru sangat menentukan kualitas sistem: **error handling**.

Banyak engineer mengira error handling berarti:

```java
try {
    doSomething();
} catch (Exception e) {
    log.error("error", e);
}
```

Padahal di sistem production, error handling adalah tentang:

- menjaga invariant;
- membedakan failure yang bisa dipulihkan dan yang tidak;
- menjaga transaksi agar tidak commit dalam state rusak;
- menjaga resource agar tidak leak;
- menjaga thread agar bisa dibatalkan;
- menjaga retry agar tidak memperparah masalah;
- menjaga observability agar root cause bisa ditemukan;
- menjaga API boundary agar caller tahu apa yang harus dilakukan;
- menjaga audit trail agar keputusan sistem bisa dipertanggungjawabkan.

Exception bukan hanya mekanisme bahasa. Exception adalah **control transfer mechanism untuk abnormal completion**.

---

## 1. Mental Model Utama Error Handling di Java

### 1.1 Normal completion vs abrupt completion

Dalam Java, sebuah statement/expression/method dapat selesai secara normal atau abrupt.

Contoh normal completion:

```java
int parseAge(String input) {
    return Integer.parseInt(input);
}
```

Contoh abrupt completion:

```java
int parseAge(String input) {
    return Integer.parseInt(input); // bisa throw NumberFormatException
}
```

Kalau exception terjadi, eksekusi tidak “lanjut ke baris berikutnya”. JVM melakukan stack unwinding:

```text
method paling dalam throw exception
        ↓
keluar dari frame method tersebut
        ↓
jalankan finally / close resource jika ada
        ↓
cari catch yang cocok
        ↓
kalau tidak ada, naik ke caller
        ↓
terus sampai thread boundary
```

Mental model yang benar:

> Exception adalah sinyal bahwa alur normal tidak dapat dilanjutkan dengan aman pada level abstraction saat ini.

Artinya, ketika exception muncul, pertanyaan utamanya bukan “bagaimana catch exception ini?”, tetapi:

1. **Apakah level ini mampu memulihkan masalah?**
2. **Apakah level ini punya informasi cukup untuk mengubah exception menjadi error domain?**
3. **Apakah level ini hanya perlu cleanup lalu propagate?**
4. **Apakah level ini harus membatalkan transaksi/operasi?**
5. **Apakah failure ini perlu dicatat untuk audit/observability?**

---

## 2. Peta Besar Throwable Hierarchy

Semua object yang dapat dilempar oleh `throw` atau ditangkap oleh `catch` harus merupakan instance dari `Throwable` atau subclass-nya.

```text
java.lang.Object
└── java.lang.Throwable
    ├── java.lang.Error
    │   ├── OutOfMemoryError
    │   ├── StackOverflowError
    │   ├── LinkageError
    │   └── ...
    │
    └── java.lang.Exception
        ├── IOException
        ├── SQLException
        ├── InterruptedException
        ├── ReflectiveOperationException
        └── RuntimeException
            ├── NullPointerException
            ├── IllegalArgumentException
            ├── IllegalStateException
            ├── IndexOutOfBoundsException
            ├── UnsupportedOperationException
            ├── ClassCastException
            └── ...
```

### 2.1 `Throwable`

`Throwable` adalah superclass untuk semua error dan exception.

Sebuah `Throwable` membawa:

- type exception;
- message;
- cause;
- stack trace;
- suppressed exceptions;
- opsi advanced: suppression dan writable stack trace.

Contoh:

```java
try {
    loadCase("CASE-123");
} catch (IOException e) {
    throw new CaseLoadException("Failed to load case CASE-123", e);
}
```

Di sini `CaseLoadException` punya:

```text
message : "Failed to load case CASE-123"
cause   : IOException asli
stack   : lokasi CaseLoadException dibuat
```

Cause penting karena tanpa cause, root cause hilang.

Buruk:

```java
catch (IOException e) {
    throw new CaseLoadException("Failed to load case");
}
```

Lebih baik:

```java
catch (IOException e) {
    throw new CaseLoadException("Failed to load case", e);
}
```

### 2.2 `Error`

`Error` dipakai untuk masalah serius yang secara umum tidak seharusnya ditangkap oleh aplikasi normal.

Contoh:

- `OutOfMemoryError`
- `StackOverflowError`
- `NoClassDefFoundError`
- `ExceptionInInitializerError`
- `LinkageError`

Secara praktis:

```java
try {
    process();
} catch (Throwable t) { // hampir selalu salah
    log.error("Caught everything", t);
}
```

Kenapa berbahaya?

Karena kamu juga menangkap `OutOfMemoryError`, `StackOverflowError`, `ThreadDeath`, atau error VM/linkage yang biasanya menandakan runtime tidak lagi berada dalam kondisi normal.

Aturan umum:

> Jangan catch `Throwable`, kecuali kamu sedang menulis framework boundary, executor boundary, test runner, container runtime, atau instrumentation layer yang benar-benar perlu menangkap semua sinyal untuk cleanup/logging lalu biasanya rethrow/terminate.

### 2.3 `Exception`

`Exception` adalah superclass untuk kondisi abnormal yang biasanya berkaitan dengan operasi aplikasi.

Contoh checked exception:

- `IOException`
- `SQLException`
- `InterruptedException`
- `ClassNotFoundException`

Contoh unchecked exception melalui subclass `RuntimeException`:

- `IllegalArgumentException`
- `IllegalStateException`
- `NullPointerException`
- `NumberFormatException`

### 2.4 Checked vs unchecked

Java membagi exception untuk compile-time checking:

```text
Unchecked:
- RuntimeException dan subclass-nya
- Error dan subclass-nya

Checked:
- Throwable subclass yang bukan RuntimeException dan bukan Error
```

Contoh checked:

```java
void readFile(Path path) throws IOException {
    Files.readString(path);
}
```

Caller harus:

```java
try {
    readFile(path);
} catch (IOException e) {
    // handle
}
```

atau propagate:

```java
void load() throws IOException {
    readFile(path);
}
```

Contoh unchecked:

```java
int divide(int a, int b) {
    return a / b; // ArithmeticException unchecked
}
```

Caller tidak wajib catch/declare.

---

## 3. Checked Exception: Kapan Berguna, Kapan Merusak

Checked exception adalah salah satu fitur Java yang paling kontroversial.

### 3.1 Tujuan checked exception

Checked exception memaksa API memberi tahu caller:

> “Operasi ini punya failure mode yang wajar, terduga, dan caller mungkin perlu memutuskan responsnya.”

Contoh bagus:

```java
interface DocumentStorage {
    InputStream open(DocumentId id) throws DocumentNotFoundException, StorageUnavailableException;
}
```

Pada contoh ini:

- dokumen tidak ditemukan adalah outcome bisnis/operasional yang masuk akal;
- storage unavailable adalah technical failure yang mungkin bisa retry/fallback;
- caller perlu tahu perbedaannya.

### 3.2 Checked exception bagus bila caller bisa melakukan sesuatu

Contoh:

```java
try {
    Document doc = storage.load(documentId);
    display(doc);
} catch (DocumentNotFoundException e) {
    showNotFoundPage(documentId);
} catch (StorageUnavailableException e) {
    showTemporaryUnavailableMessage();
}
```

Di sini caller memang punya tindakan berbeda.

### 3.3 Checked exception buruk bila hanya bocor detail implementation

Buruk:

```java
interface CaseRepository {
    CaseRecord findById(CaseId id) throws SQLException;
}
```

Masalah:

- API domain bocor detail database;
- kalau besok pindah dari JDBC ke HTTP service, API harus berubah;
- caller dipaksa tahu `SQLException`, padahal caller domain tidak peduli SQL.

Lebih baik:

```java
interface CaseRepository {
    Optional<CaseRecord> findById(CaseId id) throws CaseRepositoryException;
}
```

atau unchecked dengan boundary yang jelas:

```java
interface CaseRepository {
    Optional<CaseRecord> findById(CaseId id);
}

final class CaseRepositoryException extends RuntimeException {
    CaseRepositoryException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Pilihan checked/unchecked bergantung pada kontrak API.

### 3.4 Rule of thumb checked exception

Gunakan checked exception bila:

- failure adalah bagian eksplisit dari kontrak API;
- caller secara realistis bisa recover;
- kamu ingin compiler memaksa caller berpikir;
- API berada di boundary yang relatif stabil;
- exception bukan detail implementation yang sering berubah.

Hindari checked exception bila:

- caller hampir selalu hanya log/rethrow;
- exception berasal dari detail infrastructure;
- API akan dipakai dalam lambda/stream yang sulit membawa checked exception;
- exception membuat signature berantai dan noisy;
- failure lebih cocok dimodelkan sebagai domain result.

---

## 4. RuntimeException: Sinyal Bug, Invalid State, atau Boundary Failure?

`RuntimeException` dan subclass-nya adalah unchecked exception.

Namun unchecked bukan berarti “bebas dilempar sembarangan”.

### 4.1 `IllegalArgumentException`

Gunakan ketika caller memberikan argument yang tidak valid.

```java
public CaseId(String value) {
    if (value == null || value.isBlank()) {
        throw new IllegalArgumentException("case id must not be blank");
    }
    this.value = value;
}
```

Makna:

> Caller melanggar precondition method/constructor.

### 4.2 `IllegalStateException`

Gunakan ketika object berada dalam state yang tidak memungkinkan operasi dilakukan.

```java
final class CaseRecord {
    private CaseStatus status;

    void approve() {
        if (status != CaseStatus.SUBMITTED) {
            throw new IllegalStateException("case can only be approved from SUBMITTED state");
        }
        status = CaseStatus.APPROVED;
    }
}
```

Makna:

> Operasi valid secara bentuk, tetapi tidak valid untuk state object saat ini.

Namun dalam domain serius, pertimbangkan apakah rejection lebih baik sebagai domain result, bukan exception.

```java
sealed interface ApprovalResult {
    record Approved(CaseRecord caseRecord) implements ApprovalResult {}
    record Rejected(String reason) implements ApprovalResult {}
}
```

### 4.3 `NullPointerException`

Jangan sengaja melempar `NullPointerException` untuk validasi domain biasa. Lebih baik:

```java
this.name = Objects.requireNonNull(name, "name must not be null");
```

`Objects.requireNonNull` memang melempar `NullPointerException`, tetapi konteksnya jelas: null melanggar precondition reference.

Untuk domain input dari user, gunakan validation error, bukan NPE.

### 4.4 `UnsupportedOperationException`

Gunakan ketika operasi tidak didukung oleh implementation.

```java
class ReadOnlyCaseRepository implements CaseRepository {
    @Override
    public void save(CaseRecord caseRecord) {
        throw new UnsupportedOperationException("read-only repository does not support save");
    }
}
```

Namun hati-hati: kalau interface terlalu banyak method sehingga implementation harus banyak throw `UnsupportedOperationException`, mungkin interface-nya melanggar Interface Segregation Principle.

### 4.5 Custom runtime exception

Contoh:

```java
final class CaseRepositoryException extends RuntimeException {
    CaseRepositoryException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Custom runtime exception berguna untuk:

- memberikan abstraction boundary;
- menghindari bocornya detail implementation;
- memberi type yang bisa ditangkap di boundary;
- memperkaya message dengan context.

Tapi jangan membuat terlalu banyak class exception tanpa nilai desain.

Buruk:

```text
CaseCouldNotBeLoadedBecauseDatabaseConnectionWasClosedException
```

Lebih baik:

```java
final class CaseRepositoryException extends RuntimeException {
    private final CaseId caseId;

    CaseRepositoryException(CaseId caseId, String message, Throwable cause) {
        super(message, cause);
        this.caseId = caseId;
    }

    CaseId caseId() {
        return caseId;
    }
}
```

---

## 5. Error Boundary: Di Mana Exception Harus Ditangkap?

Pertanyaan penting bukan “exception ini harus checked atau unchecked?”, tetapi:

> Di boundary mana exception ini harus berubah menjadi keputusan sistem?

### 5.1 Layer rendah: cleanup dan wrap

Contoh repository:

```java
final class JdbcCaseRepository implements CaseRepository {
    private final DataSource dataSource;

    @Override
    public Optional<CaseRecord> findById(CaseId id) {
        String sql = """
            select id, status, assigned_officer
            from cases
            where id = ?
            """;

        try (Connection connection = dataSource.getConnection();
             PreparedStatement ps = connection.prepareStatement(sql)) {

            ps.setString(1, id.value());

            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(mapRow(rs));
            }
        } catch (SQLException e) {
            throw new CaseRepositoryException(
                    id,
                    "Failed to load case " + id.value(),
                    e
            );
        }
    }
}
```

Layer ini:

- tahu SQL/JDBC;
- tahu cara cleanup resource;
- tidak tahu user-facing response;
- tidak boleh menelan error.

### 5.2 Application service: translate technical failure ke use-case response

```java
final class AssignOfficerUseCase {
    private final CaseRepository repository;
    private final AuditLog auditLog;

    AssignOfficerResult assign(CaseId id, OfficerId officerId) {
        try {
            CaseRecord record = repository.findById(id)
                    .orElseThrow(() -> new CaseNotFoundException(id));

            record.assignTo(officerId);
            repository.save(record);
            auditLog.recordAssignment(id, officerId);

            return AssignOfficerResult.success(id, officerId);
        } catch (CaseNotFoundException e) {
            return AssignOfficerResult.rejected("CASE_NOT_FOUND");
        } catch (CaseRepositoryException e) {
            return AssignOfficerResult.failed("TEMPORARY_STORAGE_FAILURE");
        }
    }
}
```

Layer ini:

- tahu use case;
- tahu domain rejection vs technical failure;
- bisa memutuskan result;
- bisa membuat audit trail.

### 5.3 API boundary: translate ke protocol

```java
@PostMapping("/cases/{caseId}/assignments")
ResponseEntity<AssignOfficerResponse> assign(
        @PathVariable String caseId,
        @RequestBody AssignOfficerRequest request
) {
    AssignOfficerResult result = useCase.assign(new CaseId(caseId), new OfficerId(request.officerId()));

    return switch (result) {
        case AssignOfficerResult.Success success -> ResponseEntity.ok(...);
        case AssignOfficerResult.Rejected rejected -> ResponseEntity.badRequest().body(...);
        case AssignOfficerResult.Failed failed -> ResponseEntity.status(503).body(...);
    };
}
```

Boundary ini:

- tahu HTTP;
- tahu status code;
- tahu response format;
- tidak boleh expose stack trace ke user;
- boleh memasukkan correlation id.

### 5.4 Worker boundary: retry/DLQ

```java
void consume(Message message) {
    try {
        handler.handle(message);
        ack(message);
    } catch (DomainRejectionException e) {
        publishRejectedEvent(message, e);
        ack(message); // jangan retry domain rejection
    } catch (TransientInfrastructureException e) {
        retryLater(message, e); // retry terbatas
    } catch (Exception e) {
        sendToDlq(message, e);
        ack(message);
    }
}
```

Worker boundary berbeda dengan HTTP boundary. Di sini keputusan penting adalah:

- ack atau tidak;
- retry atau tidak;
- DLQ atau tidak;
- publish failure event atau tidak;
- apakah processing idempotent.

---

## 6. `try`, `catch`, `finally`: Semantics yang Harus Presisi

### 6.1 Basic try-catch

```java
try {
    riskyOperation();
} catch (IOException e) {
    recoverFromIo(e);
}
```

`catch` hanya menangkap exception yang type-nya cocok dengan parameter catch.

```java
try {
    riskyOperation();
} catch (FileNotFoundException e) {
    handleMissingFile(e);
} catch (IOException e) {
    handleGeneralIo(e);
}
```

Order penting. Subclass harus lebih dulu.

Buruk:

```java
try {
    riskyOperation();
} catch (IOException e) {
    handleGeneralIo(e);
} catch (FileNotFoundException e) { // unreachable
    handleMissingFile(e);
}
```

### 6.2 Multi-catch

```java
try {
    parseAndLoad(input);
} catch (IOException | ParseException e) {
    throw new ImportException("Failed to import data", e);
}
```

Gunakan multi-catch bila tindakan sama.

Jangan gunakan bila tindakan seharusnya berbeda.

Buruk:

```java
catch (IOException | ValidationException e) {
    retry(); // ValidationException tidak boleh retry
}
```

### 6.3 `finally`

`finally` dijalankan saat control keluar dari try/catch, baik normal maupun abrupt.

```java
Lock lock = new ReentrantLock();
lock.lock();
try {
    updateState();
} finally {
    lock.unlock();
}
```

Ini pattern valid untuk resource yang tidak implement `AutoCloseable`.

### 6.4 Jangan return dari finally

Sangat buruk:

```java
int compute() {
    try {
        throw new IllegalStateException("broken");
    } finally {
        return 42;
    }
}
```

Exception tertelan. Caller melihat `42`, bukan failure.

Aturan:

> `finally` untuk cleanup, bukan untuk mengubah hasil kontrol alur.

### 6.5 Jangan throw exception baru dari finally tanpa hati-hati

```java
try {
    process(); // throw A
} finally {
    cleanup(); // throw B
}
```

Jika `cleanup()` throw, exception A bisa tertutup oleh B pada manual finally.

Karena itu untuk resource yang `AutoCloseable`, gunakan try-with-resources agar suppressed exception dikelola dengan benar.

---

## 7. Try-With-Resources dan Resource Safety

### 7.1 Resource harus punya lifecycle eksplisit

Resource adalah object yang memegang sesuatu di luar heap Java atau sesuatu yang terbatas:

- file descriptor;
- socket;
- database connection;
- result set;
- lock tertentu;
- native memory;
- stream;
- temporary file handle;
- transaction/session.

Jika tidak ditutup, sistem bisa gagal walaupun heap masih sehat.

Contoh leak:

```java
InputStream in = Files.newInputStream(path);
byte[] data = in.readAllBytes();
// lupa in.close()
```

Lebih baik:

```java
try (InputStream in = Files.newInputStream(path)) {
    byte[] data = in.readAllBytes();
}
```

### 7.2 `AutoCloseable`

Object bisa dipakai di try-with-resources jika implement `AutoCloseable`.

```java
final class CaseLock implements AutoCloseable {
    private final Lock lock;

    CaseLock(Lock lock) {
        this.lock = lock;
        this.lock.lock();
    }

    @Override
    public void close() {
        lock.unlock();
    }
}
```

Pemakaian:

```java
try (CaseLock ignored = new CaseLock(lock)) {
    updateCase();
}
```

Dengan Java modern, unnamed variable `_` dapat dipakai dalam konteks tertentu jika enabled sesuai versi/feature, tetapi untuk Java production biasa gunakan nama yang jelas atau `ignored` jika value tidak dipakai.

### 7.3 Close order

Resource ditutup dalam urutan kebalikan dari deklarasi.

```java
try (ResourceA a = openA();
     ResourceB b = openB();
     ResourceC c = openC()) {
    use(a, b, c);
}
```

Urutan close:

```text
c.close()
b.close()
a.close()
```

Ini penting bila resource bergantung satu sama lain.

Contoh JDBC:

```java
try (Connection connection = dataSource.getConnection();
     PreparedStatement ps = connection.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    ...
}
```

`ResultSet` ditutup dulu, lalu `PreparedStatement`, lalu `Connection`.

### 7.4 Suppressed exception

Kasus:

```java
try (BrokenResource resource = new BrokenResource()) {
    throw new IllegalStateException("failure in body");
}
```

Lalu `resource.close()` juga throw exception.

Java harus memilih satu exception utama untuk dipropagasikan. Dalam try-with-resources:

- exception dari body menjadi primary exception;
- exception dari `close()` menjadi suppressed exception.

Contoh inspeksi:

```java
try {
    run();
} catch (Exception e) {
    log.error("main failure", e);
    for (Throwable suppressed : e.getSuppressed()) {
        log.error("suppressed failure", suppressed);
    }
}
```

Suppressed exception sering sangat penting untuk debugging resource cleanup.

### 7.5 Jangan abaikan close failure tanpa alasan

Untuk beberapa resource, failure saat close bisa berarti data belum flush.

Contoh:

```java
try (BufferedWriter writer = Files.newBufferedWriter(path)) {
    writer.write(payload);
}
```

Jika `close()` gagal, data mungkin belum benar-benar tertulis. Jangan anggap close failure selalu tidak penting.

### 7.6 Resource wrapper yang aman

Kadang kamu perlu membuat wrapper:

```java
final class TemporaryDirectory implements AutoCloseable {
    private final Path path;

    private TemporaryDirectory(Path path) {
        this.path = path;
    }

    static TemporaryDirectory create(String prefix) throws IOException {
        return new TemporaryDirectory(Files.createTempDirectory(prefix));
    }

    Path path() {
        return path;
    }

    @Override
    public void close() throws IOException {
        deleteRecursively(path);
    }

    private static void deleteRecursively(Path root) throws IOException {
        if (!Files.exists(root)) {
            return;
        }
        try (Stream<Path> paths = Files.walk(root)) {
            List<Path> ordered = paths
                    .sorted(Comparator.reverseOrder())
                    .toList();
            for (Path path : ordered) {
                Files.deleteIfExists(path);
            }
        }
    }
}
```

Pemakaian:

```java
try (TemporaryDirectory temp = TemporaryDirectory.create("case-import-")) {
    Path workspace = temp.path();
    processImport(workspace);
}
```

---

## 8. Exception Message: Detail yang Sering Menentukan Debugging

### 8.1 Message harus membawa context operasional

Buruk:

```java
throw new CaseRepositoryException("Failed to load case", e);
```

Lebih baik:

```java
throw new CaseRepositoryException(
        "Failed to load case id=" + id.value() + ", tenant=" + tenantId.value(),
        e
);
```

Namun jangan masukkan secret atau PII sensitif sembarangan.

### 8.2 Message bukan tempat structured data utama

Message membantu manusia, tetapi machine processing sebaiknya pakai field/code.

```java
final class DomainRejectionException extends RuntimeException {
    private final String code;
    private final Map<String, String> details;

    DomainRejectionException(String code, String message, Map<String, String> details) {
        super(message);
        this.code = code;
        this.details = Map.copyOf(details);
    }

    String code() {
        return code;
    }

    Map<String, String> details() {
        return details;
    }
}
```

### 8.3 Jangan hilangkan cause

Buruk:

```java
catch (SQLException e) {
    throw new RuntimeException("db failed");
}
```

Lebih baik:

```java
catch (SQLException e) {
    throw new CaseRepositoryException("DB failed while loading case " + id.value(), e);
}
```

### 8.4 Jangan log lalu throw sembarangan

Buruk:

```java
catch (SQLException e) {
    log.error("failed", e);
    throw new CaseRepositoryException("failed", e);
}
```

Jika boundary atas juga log, akan terjadi duplicate log.

Rule:

> Log di boundary yang membuat keputusan akhir, atau log saat menambahkan konteks penting yang tidak tersedia di atas. Jangan log di setiap catch.

---

## 9. Exception sebagai API Design

### 9.1 Exception adalah bagian dari kontrak

Method ini:

```java
CaseRecord load(CaseId id);
```

secara signature tidak menjelaskan failure mode. Caller harus membaca dokumentasi atau tahu convention.

Alternatif:

```java
Optional<CaseRecord> findById(CaseId id);
```

Ini menyatakan “not found” bukan exception.

Alternatif:

```java
CaseRecord getById(CaseId id) throws CaseNotFoundException;
```

Ini menyatakan “not found” adalah exceptional pada operasi `get`.

Naming penting:

```text
findById -> Optional.empty() masuk akal
getById  -> exception jika tidak ada masuk akal
load     -> ambigu
```

### 9.2 Domain rejection bukan selalu exception

Dalam domain case management/enforcement, banyak “gagal” sebenarnya bukan error sistem.

Contoh:

- case tidak bisa approved karena evidence belum lengkap;
- status transition tidak valid;
- officer tidak punya authority;
- SLA escalation belum jatuh tempo;
- document type tidak sesuai requirement.

Ini adalah **domain rejection**, bukan crash.

Model result bisa lebih baik:

```java
sealed interface SubmitCaseResult permits SubmitCaseResult.Accepted, SubmitCaseResult.Rejected {
    record Accepted(CaseId caseId) implements SubmitCaseResult {}
    record Rejected(String code, String reason) implements SubmitCaseResult {}
}
```

Pemakaian:

```java
SubmitCaseResult result = useCase.submit(command);

return switch (result) {
    case SubmitCaseResult.Accepted accepted -> ok(accepted);
    case SubmitCaseResult.Rejected rejected -> badRequest(rejected);
};
```

Keuntungan:

- eksplisit;
- type-safe;
- cocok untuk expected business outcome;
- tidak mengandalkan stack trace untuk alur bisnis normal.

### 9.3 Exception cocok untuk invariant violation

Kalau object domain masuk state yang mustahil, exception tepat.

```java
void markClosed() {
    if (status == CaseStatus.DRAFT) {
        throw new IllegalStateException("DRAFT case must not be closed directly");
    }
    status = CaseStatus.CLOSED;
}
```

Namun jika invalid transition berasal dari input user yang wajar, pertimbangkan result:

```java
TransitionResult transitionTo(CaseStatus target) {
    if (!policy.allows(status, target)) {
        return TransitionResult.rejected("INVALID_TRANSITION");
    }
    status = target;
    return TransitionResult.applied(status, target);
}
```

### 9.4 Technical failure biasanya exception

Contoh:

- database unavailable;
- Kafka broker unavailable;
- file permission denied;
- network timeout;
- serialization bug;
- disk full;
- DNS failure.

Ini biasanya bukan domain result. Ini technical failure yang perlu:

- retry;
- fallback;
- circuit breaker;
- alert;
- failed event;
- 5xx response;
- DLQ.

---

## 10. Classification: Recoverable, Retryable, Fatal, Domain

Top-tier engineer tidak hanya bertanya “exception class apa?”, tetapi “kategori failure apa?”.

### 10.1 Failure taxonomy

```text
1. Domain rejection
   Sistem sehat, request ditolak karena aturan bisnis.

2. Validation failure
   Input tidak valid secara struktur/format.

3. Authorization failure
   Actor tidak boleh melakukan aksi.

4. Not found / conflict
   Resource tidak ada atau state berubah.

5. Transient infrastructure failure
   Sementara: timeout, connection reset, throttling.

6. Persistent infrastructure failure
   Config salah, table hilang, schema mismatch.

7. Programmer bug
   NPE, assertion failed, impossible state.

8. Fatal runtime failure
   OOM, linkage error, stack overflow.
```

### 10.2 Mapping ke tindakan

| Kategori | Retry? | HTTP umum | Worker action | Log level | Alert? |
|---|---:|---:|---|---|---|
| Validation failure | Tidak | 400 | Ack/reject | INFO/WARN | Tidak |
| Domain rejection | Tidak | 409/422/400 | Publish rejected / ack | INFO | Biasanya tidak |
| Authorization failure | Tidak | 401/403 | Ack/reject | WARN | Kadang |
| Not found | Tidak | 404 | Ack/reject | INFO | Tidak |
| Conflict/concurrency | Kadang | 409 | Retry terbatas jika safe | WARN | Jika spike |
| Timeout transient | Ya, terbatas | 503/504 | Retry with backoff | WARN | Jika rate tinggi |
| Throttling/rate limit | Ya, backoff | 429/503 | Delay/retry | WARN | Jika persistent |
| Config/schema bug | Tidak | 500 | DLQ/fail fast | ERROR | Ya |
| Programmer bug | Tidak | 500 | DLQ/fail fast | ERROR | Ya |
| Fatal runtime | Tidak normal | N/A | Process restart | ERROR/FATAL | Ya |

### 10.3 Retryability bukan property exception class saja

`IOException` bisa retryable atau tidak:

- connection reset: mungkin retryable;
- file not found: biasanya tidak;
- permission denied: tidak;
- disk full: retry hanya setelah kondisi eksternal membaik.

Karena itu retry decision harus mempertimbangkan:

- operation idempotent atau tidak;
- side effect sudah terjadi atau belum;
- error code/status;
- number of attempts;
- elapsed time budget;
- system load;
- backoff policy;
- circuit breaker state.

---

## 11. Retry, Timeout, Backoff, dan Idempotency

### 11.1 Retry tanpa timeout adalah jebakan

Buruk:

```java
while (true) {
    try {
        return client.call();
    } catch (IOException e) {
        // retry forever
    }
}
```

Masalah:

- thread bisa tertahan selamanya;
- upstream makin terbebani;
- caller tidak punya deadline;
- graceful shutdown terhambat;
- incident makin parah.

### 11.2 Retry harus punya budget

```java
final class RetryPolicy {
    private final int maxAttempts;
    private final Duration initialDelay;
    private final Duration maxDelay;

    RetryPolicy(int maxAttempts, Duration initialDelay, Duration maxDelay) {
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("maxAttempts must be >= 1");
        }
        this.maxAttempts = maxAttempts;
        this.initialDelay = initialDelay;
        this.maxDelay = maxDelay;
    }
}
```

Pseudo:

```java
<T> T retry(Supplier<T> operation, RetryPolicy policy) {
    RuntimeException last = null;

    for (int attempt = 1; attempt <= policy.maxAttempts(); attempt++) {
        try {
            return operation.get();
        } catch (TransientFailureException e) {
            last = e;
            if (attempt == policy.maxAttempts()) {
                break;
            }
            sleep(backoff(attempt));
        }
    }

    throw new RetryExhaustedException("Retry exhausted", last);
}
```

### 11.3 Retry harus interrupt-aware

Buruk:

```java
try {
    Thread.sleep(delay.toMillis());
} catch (InterruptedException e) {
    // ignore
}
```

Ini merusak cancellation.

Lebih baik:

```java
try {
    Thread.sleep(delay.toMillis());
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationCancelledException("Interrupted during retry backoff", e);
}
```

### 11.4 Idempotency menentukan keamanan retry

Retry aman bila operasi idempotent atau memiliki idempotency key.

Tidak aman:

```text
POST /payments
```

Jika timeout terjadi setelah server memproses payment tetapi sebelum response diterima, retry bisa membuat double charge.

Lebih aman:

```text
POST /payments
Idempotency-Key: 8f9d...
```

Server menyimpan hasil berdasarkan idempotency key.

Dalam domain case management:

```text
CommandId: CMD-123
CaseId: CASE-001
Action: SUBMIT_CASE
```

Jika command yang sama dikirim ulang, sistem mengembalikan hasil lama, bukan menerapkan transisi dua kali.

### 11.5 Backoff dan jitter

Retry serentak dari banyak instance bisa menyebabkan thundering herd.

Gunakan:

- exponential backoff;
- jitter/randomization;
- max delay;
- circuit breaker;
- queue-based retry bila async.

Contoh backoff sederhana:

```java
Duration computeBackoff(int attempt, Duration initial, Duration max) {
    long base = initial.toMillis();
    long exponential = base * (1L << Math.min(attempt - 1, 10));
    long capped = Math.min(exponential, max.toMillis());
    long jitter = ThreadLocalRandom.current().nextLong(0, Math.max(1, capped / 4));
    return Duration.ofMillis(capped + jitter);
}
```

---

## 12. Timeout dan Cancellation

### 12.1 Timeout bukan hanya exception

Timeout adalah desain kontrak waktu.

Pertanyaan:

- timeout siapa?
- timeout operasi apa?
- apakah timeout membatalkan pekerjaan bawahnya?
- apakah resource ditutup?
- apakah thread di-interrupt?
- apakah caller menerima partial result?
- apakah retry dilakukan?
- apakah deadline total dihormati?

### 12.2 Timeout per call vs deadline total

Buruk:

```text
operation total budget: tidak ada
retry 3x
setiap HTTP call timeout 10s
backoff 5s
```

Worst-case bisa:

```text
10s + 5s + 10s + 5s + 10s = 40s
```

Jika upstream caller hanya punya timeout 15s, ini sia-sia.

Lebih baik:

```java
final class Deadline {
    private final Instant expiresAt;

    Deadline(Duration budget) {
        this.expiresAt = Instant.now().plus(budget);
    }

    Duration remaining() {
        Duration remaining = Duration.between(Instant.now(), expiresAt);
        return remaining.isNegative() ? Duration.ZERO : remaining;
    }

    boolean expired() {
        return !remaining().isPositive();
    }
}
```

### 12.3 CompletableFuture timeout

`CompletableFuture` punya `orTimeout` dan `completeOnTimeout`.

```java
CompletableFuture<CaseRecord> future = CompletableFuture
        .supplyAsync(() -> repository.getById(caseId), executor)
        .orTimeout(500, TimeUnit.MILLISECONDS);
```

Namun pahami jebakannya:

> Timeout pada `CompletableFuture` menyelesaikan future secara exceptional, tetapi tidak selalu menghentikan pekerjaan underlying yang sedang berjalan.

Jika task sedang blocking I/O dan tidak interrupt-aware, pekerjaan bisa tetap berjalan.

### 12.4 Cancellation harus didesain end-to-end

`Future.cancel(true)` mencoba interrupt thread bila memungkinkan.

Namun interruption hanya bekerja jika task:

- memanggil method interruptible;
- mengecek interrupt status;
- tidak menelan `InterruptedException`;
- tidak blocked di API yang tidak merespons interrupt.

Contoh task yang baik:

```java
void processLargeFile(Path path) throws IOException, InterruptedException {
    try (BufferedReader reader = Files.newBufferedReader(path)) {
        String line;
        while ((line = reader.readLine()) != null) {
            if (Thread.currentThread().isInterrupted()) {
                throw new InterruptedException("Interrupted while processing " + path);
            }
            processLine(line);
        }
    }
}
```

---

## 13. InterruptedException: Salah Satu Exception Paling Penting

`InterruptedException` terjadi ketika thread sedang waiting/sleeping/blocked dalam aktivitas tertentu dan thread tersebut diinterrupt.

### 13.1 Apa itu interrupt?

Interrupt bukan “kill thread”. Interrupt adalah request kooperatif:

> “Tolong berhenti atau batalkan aktivitasmu jika aman.”

### 13.2 Jangan swallow interrupt

Sangat buruk:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    // ignore
}
```

Akibat:

- caller mengira task dibatalkan;
- task tetap lanjut;
- shutdown bisa lambat;
- structured concurrency/cancellation rusak;
- thread pool bisa tertahan.

### 13.3 Jika bisa, propagate

```java
void waitForPermit() throws InterruptedException {
    semaphore.acquire();
}
```

### 13.4 Jika tidak bisa declare, restore interrupt status

```java
void runWorker() {
    try {
        queue.take();
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new WorkerCancelledException("Worker interrupted", e);
    }
}
```

Kenapa restore?

Karena banyak method yang throw `InterruptedException` juga clear interrupt status. Dengan `Thread.currentThread().interrupt()`, kamu memberi sinyal ke layer atas bahwa thread tetap interrupted.

### 13.5 Jangan convert interruption menjadi “normal failure” sembarangan

Buruk:

```java
catch (InterruptedException e) {
    throw new RuntimeException("failed", e);
}
```

Lebih baik:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationCancelledException("operation interrupted", e);
}
```

Interruption adalah cancellation signal, bukan sekadar technical failure biasa.

---

## 14. CompletableFuture Exception Semantics

`CompletableFuture` sering membuat error handling lebih sulit karena exception muncul di pipeline asynchronous.

### 14.1 `get()` vs `join()`

```java
future.get();  // checked: InterruptedException, ExecutionException
future.join(); // unchecked: CompletionException
```

Jika future selesai exceptional:

- `get()` membungkus cause dalam `ExecutionException`;
- `join()` membungkus cause dalam `CompletionException`.

### 14.2 `exceptionally`

```java
CompletableFuture<CaseRecord> future = loadCase(caseId)
        .exceptionally(ex -> fallbackCase(caseId));
```

`exceptionally` mengubah failure menjadi success fallback.

Gunakan hati-hati. Jangan sembunyikan failure penting.

### 14.3 `handle`

```java
CompletableFuture<Result> future = loadCase(caseId)
        .handle((value, ex) -> {
            if (ex != null) {
                return Result.failed(ex);
            }
            return Result.success(value);
        });
```

`handle` selalu dipanggil baik success maupun failure.

### 14.4 `whenComplete`

```java
CompletableFuture<CaseRecord> future = loadCase(caseId)
        .whenComplete((value, ex) -> {
            if (ex != null) {
                log.warn("Failed to load case {}", caseId, ex);
            }
        });
```

`whenComplete` cocok untuk side effect seperti logging/metrics, tetapi tidak secara utama recover.

### 14.5 Async executor trap

```java
CompletableFuture.supplyAsync(() -> blockingCall())
```

Tanpa executor eksplisit, async task memakai default executor, yaitu common pool dalam banyak kasus. Untuk blocking I/O, ini bisa berbahaya.

Lebih baik:

```java
CompletableFuture.supplyAsync(() -> blockingCall(), blockingIoExecutor)
```

### 14.6 Exception wrapping helper

```java
static Throwable unwrapCompletion(Throwable throwable) {
    if (throwable instanceof CompletionException || throwable instanceof ExecutionException) {
        Throwable cause = throwable.getCause();
        return cause == null ? throwable : cause;
    }
    return throwable;
}
```

Gunakan saat mapping error di async boundary.

---

## 15. Exception dalam Stream dan Lambda

Java functional interfaces standar tidak declare checked exception.

Contoh masalah:

```java
List<String> lines = paths.stream()
        .map(path -> Files.readString(path)) // compile error: IOException
        .toList();
```

### 15.1 Jangan wrap asal-asalan

```java
.map(path -> {
    try {
        return Files.readString(path);
    } catch (IOException e) {
        throw new RuntimeException(e);
    }
})
```

Ini kadang acceptable untuk boundary kecil, tapi message kurang context.

Lebih baik:

```java
.map(path -> {
    try {
        return Files.readString(path);
    } catch (IOException e) {
        throw new FileLoadException("Failed to read file " + path, e);
    }
})
```

### 15.2 Pertimbangkan loop untuk error handling kompleks

Stream buruk jika perlu:

- partial success;
- collect multiple errors;
- retry per item;
- cleanup per item;
- detailed audit;
- continue-on-error;
- cancellation checks.

Lebih baik loop:

```java
List<ImportResult> results = new ArrayList<>();

for (Path path : paths) {
    try {
        String content = Files.readString(path);
        results.add(ImportResult.success(path, content));
    } catch (IOException e) {
        results.add(ImportResult.failed(path, e));
    }
}
```

Top-tier engineer tidak memaksa stream jika loop lebih jelas dan lebih reliable.

---

## 16. Error Handling dan Transaction Boundary

Exception sering menentukan rollback/commit.

### 16.1 Transaction harus punya boundary jelas

Pseudo:

```java
transaction.execute(() -> {
    CaseRecord record = repository.getById(id);
    record.approve();
    repository.save(record);
    outbox.publish(new CaseApprovedEvent(id));
});
```

Jika exception terjadi sebelum transaction commit, transaction harus rollback.

### 16.2 Jangan catch exception di dalam transaction lalu lanjut commit

Buruk:

```java
transaction.execute(() -> {
    repository.save(record);

    try {
        outbox.publish(event);
    } catch (Exception e) {
        log.error("Failed to publish event", e);
    }

    // transaction commit, tapi event hilang
});
```

Lebih baik:

```java
transaction.execute(() -> {
    repository.save(record);
    outbox.store(event); // bagian dari DB transaction
});
```

Event publisher async membaca outbox setelah commit.

### 16.3 Domain rejection vs rollback

Domain rejection sebelum mutation:

```java
if (!policy.canApprove(record)) {
    return ApprovalResult.rejected("MISSING_EVIDENCE");
}
```

Technical exception saat mutation:

```java
repository.save(record); // exception -> rollback
```

Jangan campur:

```java
throw new RuntimeException("missing evidence"); // untuk domain rejection expected
```

Ini membuat domain flow terlihat seperti crash.

---

## 17. Observability: Log, Metrics, Trace, dan Error Code

### 17.1 Exception tanpa observability adalah mystery

Minimal yang harus ada saat boundary menangani failure:

- correlation id / trace id;
- operation name;
- entity id;
- actor id jika relevan;
- error code;
- exception type;
- message;
- cause stack trace;
- retry attempt;
- elapsed time;
- remote system name;
- input classification, bukan raw sensitive input.

### 17.2 Log level guideline

| Situation | Level |
|---|---|
| Expected validation/domain rejection | INFO atau WARN tergantung konteks |
| User/action denied | WARN jika security relevant |
| Transient dependency failure recovered by retry | WARN atau DEBUG dengan metric |
| Retry exhausted | ERROR |
| Programmer bug | ERROR |
| Fatal runtime / repeated infrastructure failure | ERROR/FATAL + alert |

### 17.3 Jangan log sensitive data

Buruk:

```java
log.error("Failed login password={} token={}", password, token, e);
```

Lebih baik:

```java
log.warn("Failed login userId={} reason={}", userId, reasonCode);
```

### 17.4 Metrics

Exception yang penting harus punya metric:

```text
case_assignment_failed_total{reason="repository_unavailable"}
case_assignment_rejected_total{reason="missing_authority"}
external_api_timeout_total{system="onemap"}
retry_attempt_total{operation="load_case"}
dlq_message_total{topic="case.commands"}
```

### 17.5 Trace

Trace span sebaiknya mencatat:

- exception event;
- status error;
- retry attempts;
- dependency call;
- timeout/deadline;
- relevant attributes.

---

## 18. Designing Custom Exceptions

### 18.1 Minimal template

```java
public final class CaseRepositoryException extends RuntimeException {
    public CaseRepositoryException(String message) {
        super(message);
    }

    public CaseRepositoryException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

### 18.2 Dengan context field

```java
public final class CaseRepositoryException extends RuntimeException {
    private final CaseId caseId;
    private final String operation;

    public CaseRepositoryException(CaseId caseId, String operation, String message, Throwable cause) {
        super(message, cause);
        this.caseId = Objects.requireNonNull(caseId);
        this.operation = Objects.requireNonNull(operation);
    }

    public CaseId caseId() {
        return caseId;
    }

    public String operation() {
        return operation;
    }
}
```

### 18.3 Base exception? Hati-hati

Kadang organisasi membuat:

```java
abstract class ApplicationException extends RuntimeException {
    private final String code;
}
```

Ini bisa berguna, tetapi jangan sampai semua exception dipaksa masuk hierarchy yang terlalu umum.

Pertanyaan sebelum membuat base exception:

- Apakah boundary memang akan catch base type ini?
- Apakah semua subclass punya semantic yang sama?
- Apakah code/error response handling menjadi lebih jelas?
- Apakah justru menyembunyikan perbedaan domain vs technical?

### 18.4 Exception class jangan mutable

Buruk:

```java
class MyException extends RuntimeException {
    public String code;
}
```

Lebih baik:

```java
final class MyException extends RuntimeException {
    private final String code;

    MyException(String code, String message) {
        super(message);
        this.code = code;
    }

    String code() {
        return code;
    }
}
```

### 18.5 Serializable concern

`Throwable` implements `Serializable`. Banyak custom exception menambahkan field yang tidak serializable. Dalam modern app biasanya ini jarang masalah kecuali exception dikirim lewat serialization/RMI/legacy framework. Namun compiler bisa memberi warning `serialVersionUID`.

Untuk aplikasi biasa, kamu bisa menambahkan:

```java
private static final long serialVersionUID = 1L;
```

Tetapi jangan jadikan serialization exception sebagai desain utama kecuali memang ada kebutuhan.

---

## 19. Anti-Pattern Error Handling

### 19.1 Catch-all lalu diam

```java
try {
    process();
} catch (Exception e) {
    // ignore
}
```

Ini hampir selalu salah.

Jika memang sengaja ignore, dokumentasikan alasannya:

```java
try {
    cache.invalidate(key);
} catch (CacheUnavailableException e) {
    log.debug("Cache invalidation failed; safe to ignore because cache is best-effort", e);
}
```

### 19.2 Catch `Exception` terlalu bawah

Buruk:

```java
void repositoryMethod() {
    try {
        jdbcCall();
    } catch (Exception e) {
        throw new RuntimeException(e);
    }
}
```

Tangkap exception spesifik.

```java
catch (SQLException e) {
    throw new CaseRepositoryException("Failed to query case", e);
}
```

### 19.3 Menggunakan exception untuk alur normal

Buruk:

```java
try {
    CaseRecord record = repository.getById(id);
} catch (CaseNotFoundException e) {
    return Optional.empty();
}
```

Jika not found sering terjadi dan normal:

```java
Optional<CaseRecord> record = repository.findById(id);
```

### 19.4 Throw `Exception`

Buruk:

```java
void process() throws Exception
```

Caller tidak tahu failure mode.

Lebih baik:

```java
void process() throws ImportException
```

atau gunakan unchecked spesifik.

### 19.5 Wrap tanpa context

Buruk:

```java
throw new RuntimeException(e);
```

Lebih baik:

```java
throw new ImportException("Failed to import file " + path, e);
```

### 19.6 Duplicate logging

Buruk:

```java
catch (Exception e) {
    log.error("failed at repository", e);
    throw e;
}
```

Jika tidak menambah nilai, jangan log di sini.

### 19.7 Swallow interrupt

Sudah dibahas, tetapi sangat penting.

```java
catch (InterruptedException e) {
    // ignore
}
```

Harus:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationCancelledException("Interrupted", e);
}
```

### 19.8 Retry semua exception

Buruk:

```java
catch (Exception e) {
    retry();
}
```

Jangan retry:

- validation error;
- authorization error;
- domain rejection;
- programmer bug;
- non-idempotent operation tanpa key;
- schema/config error.

### 19.9 Melempar exception dari `toString`, `equals`, `hashCode`

Sangat berbahaya karena method ini sering dipanggil oleh logging, collection, debugger, framework.

Jaga agar method ini relatif aman.

---

## 20. Error Handling dalam Domain Case Management

Contoh domain: enforcement lifecycle.

### 20.1 State transition

```java
sealed interface TransitionResult permits TransitionResult.Applied, TransitionResult.Rejected {
    record Applied(CaseStatus from, CaseStatus to) implements TransitionResult {}
    record Rejected(String code, String reason) implements TransitionResult {}
}
```

```java
final class CaseRecord {
    private CaseStatus status;

    TransitionResult transitionTo(CaseStatus target, Actor actor) {
        if (!actor.canTransition(status, target)) {
            return new TransitionResult.Rejected(
                    "ACTOR_NOT_AUTHORIZED",
                    "Actor cannot transition case from " + status + " to " + target
            );
        }

        if (!CaseTransitionPolicy.allows(status, target)) {
            return new TransitionResult.Rejected(
                    "INVALID_TRANSITION",
                    "Cannot transition case from " + status + " to " + target
            );
        }

        CaseStatus previous = status;
        status = target;
        return new TransitionResult.Applied(previous, target);
    }
}
```

Di sini invalid transition adalah expected domain outcome.

### 20.2 Technical persistence failure

```java
try {
    repository.save(caseRecord);
} catch (CaseRepositoryException e) {
    return SubmitResult.failed("CASE_PERSISTENCE_FAILURE");
}
```

Ini technical failure, bukan domain rejection.

### 20.3 Audit failure

Audit bisa punya policy berbeda.

Dalam sistem regulatory, audit sering critical. Jika audit gagal, mungkin command harus gagal.

```java
transaction.execute(() -> {
    repository.save(caseRecord);
    auditRepository.append(auditEntry); // jika gagal, rollback semua
});
```

Jika audit best-effort, dokumentasikan secara eksplisit. Untuk regulatory system, best-effort audit biasanya lemah secara defensibility.

### 20.4 External notification failure

Email gagal terkirim tidak selalu harus rollback case transition.

Pattern:

```java
transaction.execute(() -> {
    repository.save(caseRecord);
    outbox.store(new CaseSubmittedEvent(caseId));
});
```

Email sender async membaca event. Jika email gagal:

- retry;
- DLQ;
- alert;
- operational dashboard.

Case transition tetap valid karena event tersimpan durable.

---

## 21. Exception Testing

### 21.1 Assert exception type dan message

JUnit contoh:

```java
@Test
void rejectsBlankCaseId() {
    IllegalArgumentException exception = assertThrows(
            IllegalArgumentException.class,
            () -> new CaseId(" ")
    );

    assertEquals("case id must not be blank", exception.getMessage());
}
```

### 21.2 Assert cause

```java
@Test
void wrapsSqlException() {
    SQLException sqlException = new SQLException("connection closed");

    CaseRepositoryException exception = assertThrows(
            CaseRepositoryException.class,
            () -> repositoryThatFailsWith(sqlException).findById(new CaseId("CASE-1"))
    );

    assertSame(sqlException, exception.getCause());
}
```

### 21.3 Assert suppressed exception

```java
@Test
void recordsSuppressedCloseFailure() {
    Exception exception = assertThrows(Exception.class, () -> {
        try (BrokenResource ignored = new BrokenResource()) {
            throw new IllegalStateException("body failure");
        }
    });

    assertEquals("body failure", exception.getMessage());
    assertEquals(1, exception.getSuppressed().length);
}
```

### 21.4 Test interruption

```java
@Test
void restoresInterruptStatus() {
    Thread.currentThread().interrupt();

    try {
        OperationCancelledException exception = assertThrows(
                OperationCancelledException.class,
                () -> service.operationThatChecksInterrupt()
        );
        assertTrue(Thread.currentThread().isInterrupted());
    } finally {
        // clear interrupt for test runner hygiene
        Thread.interrupted();
    }
}
```

---

## 22. Decision Framework

### 22.1 Exception atau result object?

Gunakan result object bila:

- outcome expected;
- caller selalu harus branch;
- tidak butuh stack trace;
- failure adalah bagian domain;
- kamu ingin exhaustive handling dengan sealed type/switch.

Gunakan exception bila:

- operasi tidak bisa lanjut normal;
- failure jarang/abnormal;
- perlu unwind stack;
- perlu rollback;
- failure berasal dari technical boundary;
- caller terdekat tidak bisa recover.

### 22.2 Checked atau unchecked?

Gunakan checked bila:

- recoverability adalah bagian kontrak;
- caller realistis bisa handle;
- abstraction stabil;
- tidak membuat API/lambda terlalu noisy.

Gunakan unchecked bila:

- programming error/precondition violation;
- infrastructure exception dibungkus di boundary;
- caller mayoritas tidak bisa recover;
- failure ditangani di framework/application boundary.

### 22.3 Catch atau propagate?

Catch bila:

- bisa recover;
- bisa translate ke abstraction lebih tinggi;
- bisa add context lalu wrap;
- perlu cleanup;
- berada di boundary final untuk response/logging/retry/DLQ.

Propagate bila:

- tidak punya informasi cukup;
- tidak bisa recover;
- catch hanya akan log lalu throw tanpa nilai;
- boundary atas lebih tepat mengambil keputusan.

---

## 23. Production Checklist

Gunakan checklist ini saat review kode Java:

### 23.1 API design

- Apakah method name mencerminkan failure mode? `find` vs `get` vs `load`?
- Apakah expected domain rejection dimodelkan sebagai result, bukan exception?
- Apakah checked exception benar-benar actionable?
- Apakah infrastructure exception tidak bocor ke domain API?
- Apakah custom exception punya message dan cause?

### 23.2 Catch block

- Apakah catch menangkap type spesifik?
- Apakah catch melakukan recover/translate/add context?
- Apakah catch tidak duplicate logging?
- Apakah catch tidak swallow exception?
- Apakah catch `InterruptedException` restore interrupt status?

### 23.3 Resource safety

- Apakah resource ditutup dengan try-with-resources?
- Apakah close order benar?
- Apakah suppressed exception tidak hilang?
- Apakah resource ownership jelas?
- Apakah cleanup failure dianggap sesuai risiko?

### 23.4 Retry/timeout

- Apakah timeout jelas?
- Apakah retry punya max attempt?
- Apakah retry punya backoff dan jitter?
- Apakah operation idempotent?
- Apakah interruption/cancellation dihormati?
- Apakah retry metrics ada?

### 23.5 Observability

- Apakah boundary final log failure dengan context cukup?
- Apakah correlation id/trace id tersedia?
- Apakah error code stabil?
- Apakah log tidak mengandung secret/PII?
- Apakah metrics membedakan domain rejection vs technical failure?

### 23.6 Transaction/failure consistency

- Apakah exception menyebabkan rollback yang benar?
- Apakah catch di dalam transaction tidak membuat partial commit berbahaya?
- Apakah event/notification memakai outbox bila perlu atomicity?
- Apakah audit failure policy eksplisit?

---

## 24. Latihan Bertahap

### Latihan 1 — Throwable anatomy

Buat program yang:

1. melempar exception dengan cause;
2. mencetak message;
3. mencetak cause;
4. mencetak stack trace;
5. membandingkan `throw new RuntimeException(e)` vs `throw new RuntimeException("message", e)`.

Tujuan:

- paham message vs cause;
- paham stack trace;
- paham wrapping.

### Latihan 2 — Try-with-resources dan suppressed exception

Buat `AutoCloseable` yang `close()` selalu throw.

Lalu buat body try yang juga throw.

Pastikan kamu bisa membaca:

```java
exception.getSuppressed()
```

Tujuan:

- paham primary vs suppressed exception;
- paham close order.

### Latihan 3 — Custom domain result

Modelkan use case:

```text
Submit case
- reject jika evidence kosong
- reject jika actor tidak punya authority
- success jika valid
- failed jika repository error
```

Gunakan sealed interface untuk result.

Tujuan:

- membedakan domain rejection dan technical failure.

### Latihan 4 — Interrupt-aware retry

Buat retry helper yang:

- max attempt 3;
- exponential backoff;
- restore interrupt status jika sleep interrupted;
- hanya retry `TransientFailureException`.

Tujuan:

- paham retry budget;
- paham interruption;
- paham retry classification.

### Latihan 5 — Worker boundary

Simulasikan message consumer yang:

- ack untuk domain rejection;
- retry untuk transient failure;
- DLQ untuk unknown failure;
- tidak retry validation error;
- mencatat metric counter.

Tujuan:

- paham failure handling async;
- paham worker boundary;
- paham DLQ decision.

---

## 25. Mini Project: Case Command Failure Engine

Buat mini project kecil:

```text
case-command-engine/
  src/main/java/
    domain/
      CaseId.java
      CaseStatus.java
      CaseRecord.java
      TransitionResult.java
      CaseTransitionPolicy.java
    application/
      SubmitCaseCommand.java
      SubmitCaseResult.java
      SubmitCaseUseCase.java
    infrastructure/
      CaseRepository.java
      InMemoryCaseRepository.java
      FlakyCaseRepository.java
      CaseRepositoryException.java
    worker/
      CommandMessage.java
      CommandConsumer.java
      RetryPolicy.java
      DeadLetterQueue.java
```

### Requirements

1. `SubmitCaseUseCase` menolak command invalid sebagai domain rejection.
2. Repository bisa dibuat flaky untuk melempar `TransientInfrastructureException`.
3. Worker melakukan retry terbatas untuk transient failure.
4. Worker mengirim unknown failure ke DLQ.
5. Semua exception wrapping mempertahankan cause.
6. Retry sleep harus interrupt-aware.
7. Tidak boleh ada `catch (Exception e)` kecuali di worker boundary final.
8. Tidak boleh ada swallowed exception.
9. Domain rejection tidak boleh dilempar sebagai generic `RuntimeException`.
10. Log harus menyertakan command id dan case id.

### Expected learning

Setelah mini project ini, kamu harus bisa menjelaskan:

- perbedaan domain rejection dan technical failure;
- kenapa retry butuh idempotency;
- kenapa worker boundary boleh catch broad exception;
- kenapa layer repository tidak boleh mengembalikan HTTP response;
- kenapa interruption harus dihormati;
- kenapa exception cause tidak boleh hilang.

---

## 26. Ringkasan Mental Model

Error handling Java yang kuat bukan soal banyak `try-catch`.

Error handling yang kuat berarti:

```text
1. Failure diklasifikasi dengan benar.
2. Expected domain outcome tidak diperlakukan sebagai crash.
3. Technical failure tidak disembunyikan.
4. Resource selalu ditutup.
5. Cause dan context tidak hilang.
6. Interruption tidak ditelan.
7. Retry punya batas, backoff, jitter, dan idempotency.
8. Transaction boundary tidak menghasilkan partial commit berbahaya.
9. Boundary sistem menerjemahkan failure ke response/retry/DLQ/audit dengan jelas.
10. Observability cukup untuk menemukan root cause.
```

Top-tier Java engineer tidak hanya bisa menulis:

```java
catch (Exception e)
```

Mereka tahu **di mana exception harus ditangkap, bagaimana diterjemahkan, kapan harus dipropagasikan, kapan harus dimodelkan sebagai result, dan apa konsekuensinya terhadap reliability sistem**.

---

## 27. Referensi Resmi dan Bacaan Lanjutan

Sumber utama:

- Java Language Specification SE 25 — Exceptions dan try statement:  
  https://docs.oracle.com/javase/specs/jls/se25/html/index.html

- Java SE 25 `Throwable`:  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Throwable.html

- Java SE 25 `Exception`:  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Exception.html

- Java SE 25 `RuntimeException`:  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/RuntimeException.html

- Java SE 25 `Error`:  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Error.html

- Java SE 25 `AutoCloseable`:  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/AutoCloseable.html

- Java SE 25 `InterruptedException`:  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/InterruptedException.html

- Java SE 25 `CompletableFuture`:  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html

- OpenJDK JDK 25 project page:  
  https://openjdk.org/projects/jdk/25/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-part-007.md">⬅️ Learn Java Part 007 — Collections, Data Structures, dan Performance Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../index.md">🏠 Home</a>
<a href="./learn-java-part-009.md">Learn Java Part 009 — Java Memory Model dan Concurrency Fundamental ➡️</a>
</div>
