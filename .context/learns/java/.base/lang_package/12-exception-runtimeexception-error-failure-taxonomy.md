# Part 12 — `Exception`, `RuntimeException`, `Error`: Failure Taxonomy for Serious Systems

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> Part: 12 / 32  
> Scope: Java 8–25  
> Packages/classes mainly covered: `java.lang.Exception`, `java.lang.RuntimeException`, `java.lang.Error`, selected major subclasses, and their role in production failure design.

---

## 1. Tujuan Part Ini

Di Part 11 kita membahas `Throwable` sebagai object model kegagalan: message, cause, stack trace, suppressed exceptions, dan cost diagnostik. Part 12 naik satu level: **bagaimana mengklasifikasikan failure** supaya sistem Java yang besar tidak memperlakukan semua kegagalan dengan cara yang sama.

Tujuan bagian ini:

1. memahami perbedaan konseptual dan operasional antara `Exception`, `RuntimeException`, dan `Error`;
2. memahami checked vs unchecked exception secara lebih matang daripada sekadar “harus ditangkap” vs “tidak harus ditangkap”;
3. membangun taxonomy failure untuk sistem production: domain rejection, programming error, infrastructure failure, environmental failure, platform failure, dan VM-level failure;
4. memahami kapan sebuah failure boleh di-retry, boleh ditranslate, boleh ditampilkan ke user, boleh memicu rollback, atau harus membuat process/container mati;
5. menghindari anti-pattern seperti `catch (Throwable)`, `catch (Exception)` terlalu luas, swallow exception, retry non-retryable failure, dan menyembunyikan `Error`;
6. merancang exception hierarchy yang berguna untuk API, service layer, transaction boundary, observability, dan incident response.

Part ini bukan hanya tentang “syntax exception handling”. Fokusnya adalah **failure modelling**.

---

## 2. Mental Model Utama

### 2.1 Exception hierarchy adalah taxonomy, bukan sekadar inheritance tree

Secara sederhana:

```text
Throwable
├── Error
└── Exception
    └── RuntimeException
```

Tetapi di sistem serius, hierarchy ini harus dibaca sebagai sinyal desain:

```text
Throwable
│
├── Error
│   └── Masalah serius pada VM, linkage, resource fatal, assertion, atau platform state.
│       Biasanya reasonable application tidak mencoba recover lokal.
│
└── Exception
    ├── Checked Exception
    │   └── Failure yang API ingin paksa caller akui sebagai bagian dari contract.
    │
    └── RuntimeException
        └── Unchecked Exception:
            - programming error,
            - invalid state,
            - invalid argument,
            - domain rejection yang sengaja dibuat unchecked,
            - infrastructure wrapper,
            - framework boundary failure.
```

Jadi pertanyaan penting bukan:

> “Ini checked atau unchecked?”

Melainkan:

> “Failure ini mewakili apa, siapa yang bisa mengambil keputusan, dan keputusan apa yang valid?”

---

### 2.2 Recovery adalah property dari boundary, bukan property absolut dari class

Banyak engineer berpikir:

```text
Exception = bisa direcover
RuntimeException = bug
Error = fatal
```

Itu berguna sebagai intuisi awal, tetapi terlalu kasar.

Contoh:

- `NumberFormatException` adalah `RuntimeException`, tetapi di boundary input user, itu bisa menjadi validasi 400 Bad Request.
- `IllegalArgumentException` sering programming error, tetapi di API adapter, bisa menjadi external input rejection.
- `IOException` adalah checked exception, tetapi pada write audit log ke disk yang mandatory, failure-nya bisa fatal untuk request.
- `OutOfMemoryError` umumnya fatal, tetapi JVM mungkin masih melemparkannya sebagai object; mencoba “recover” lokal biasanya berbahaya.

Maka recovery harus dilihat dari boundary:

```text
Where did it happen?
Who owns the decision?
Can the operation be retried safely?
Can the caller change the input?
Is the process still trustworthy?
```

---

### 2.3 Exception design harus menjawab empat pertanyaan

Untuk setiap exception yang kamu desain atau tangani, tanyakan:

1. **What happened?**  
   Apa jenis kegagalannya?

2. **Who can act?**  
   Caller? User? Operator? Developer? Scheduler? Transaction manager? Tidak ada?

3. **What action is safe?**  
   Retry, reject, compensate, rollback, alert, ignore, kill process?

4. **What evidence is needed?**  
   Message, cause, error code, correlation id, entity id, operation name, remote status, retry-after, validation field, location?

Exception yang baik bukan hanya “terlempar”. Exception yang baik membawa informasi yang cukup untuk membuat keputusan aman.

---

## 3. Konsep Fundamental

## 3.1 `Exception`

`Exception` adalah subclass dari `Throwable` yang merepresentasikan kondisi yang reasonable application mungkin ingin catch.

Secara Java language rules:

- `Exception` yang bukan subclass `RuntimeException` disebut **checked exception**;
- checked exception harus dideklarasikan di `throws` clause atau ditangani, bila bisa propagate keluar method/constructor;
- `RuntimeException` dan subclass-nya adalah unchecked exception.

Contoh checked exception umum:

```text
IOException
SQLException
ClassNotFoundException
InterruptedException
ReflectiveOperationException
ParseException
```

Checked exception cocok ketika failure adalah bagian eksplisit dari API contract dan caller realistis bisa memilih tindakan.

Contoh:

```java
public CustomerDocument loadDocument(DocumentId id) throws IOException {
    // reading from file/blob/object storage
}
```

Signature tersebut memberi sinyal:

```text
Operasi ini berinteraksi dengan resource eksternal.
Caller harus sadar bahwa I/O bisa gagal.
```

Tetapi checked exception tidak selalu cocok untuk setiap business failure. Bila semua layer hanya membungkus atau melempar ulang tanpa keputusan, checked exception berubah menjadi noise.

---

## 3.2 `RuntimeException`

`RuntimeException` adalah superclass untuk exception yang bisa terjadi selama operasi normal JVM dan bersifat unchecked.

Unchecked berarti:

```text
Compiler tidak memaksa method mendeklarasikan atau menangkapnya.
```

Unchecked tidak berarti:

```text
Tidak penting.
Tidak perlu dipikirkan.
Selalu bug.
Selalu boleh dibiarkan crash.
```

Contoh `RuntimeException` umum:

```text
NullPointerException
IllegalArgumentException
IllegalStateException
IndexOutOfBoundsException
ClassCastException
NumberFormatException
UnsupportedOperationException
SecurityException
ArithmeticException
ConcurrentModificationException
```

Runtime exception sering dipakai untuk:

1. programming errors;
2. invalid arguments;
3. invalid object state;
4. impossible state violations;
5. unsupported operation;
6. framework boundary failures;
7. domain exception yang ingin dibuat unchecked;
8. wrapping checked exception yang tidak ingin dipaksa di setiap layer.

Contoh:

```java
public Money add(Money other) {
    if (!this.currency.equals(other.currency())) {
        throw new IllegalArgumentException(
            "Cannot add different currencies: " + this.currency + " and " + other.currency()
        );
    }
    return new Money(this.amount.add(other.amount()), this.currency);
}
```

Ini unchecked karena caller yang memanggil `add` dengan currency berbeda melanggar precondition method.

---

## 3.3 `Error`

`Error` merepresentasikan masalah serius yang reasonable application biasanya tidak mencoba catch.

Contoh `Error` penting:

```text
OutOfMemoryError
StackOverflowError
VirtualMachineError
LinkageError
NoClassDefFoundError
ExceptionInInitializerError
AssertionError
ThreadDeath
UnsatisfiedLinkError
UnsupportedClassVersionError
```

Error bukan “exception biasa yang lebih parah”. `Error` sering menandakan:

- VM tidak bisa mengalokasikan object;
- stack habis;
- class linkage gagal;
- binary incompatible;
- native library tidak tersedia;
- static initializer gagal;
- invariant internal yang diasumsikan benar ternyata salah.

Kebijakan umum:

```text
Jangan catch Error untuk recovery lokal.
Biarkan naik ke boundary tertinggi, dicatat oleh infrastructure, lalu biarkan process/container/pod restart bila perlu.
```

Ada pengecualian sangat terbatas untuk boundary observability, misalnya:

```java
try {
    runWorkerLoop();
} catch (Throwable t) {
    logFatal(t);
    throw t;
}
```

Tujuannya bukan recover, tetapi memastikan fatal evidence tercatat sebelum process mati.

---

## 4. Checked vs Unchecked: Cara Berpikir yang Lebih Dewasa

### 4.1 Checked exception: caller dipaksa mengakui contract

Checked exception bermanfaat ketika:

1. failure adalah bagian normal dari interaksi eksternal;
2. caller punya keputusan bermakna;
3. caller perlu membedakan failure type;
4. failure tidak selalu programming bug;
5. API berada dekat dengan resource boundary.

Contoh cocok:

```java
public byte[] readObject(String key) throws IOException;

public Class<?> loadPluginClass(String className) throws ClassNotFoundException;

public void waitForSignal() throws InterruptedException;
```

Kelebihan checked exception:

- API contract eksplisit;
- caller tidak mudah lupa failure;
- berguna untuk boundary rendah seperti I/O, reflection, parsing, blocking operation;
- dokumentasi compiler-enforced.

Kekurangan:

- bisa menghasilkan boilerplate;
- bisa bocor melewati layer yang tidak peduli;
- bisa menyebabkan wrapping tanpa makna;
- buruk untuk lambda/stream API;
- sulit berevolusi karena menambah checked exception mengubah source compatibility.

---

### 4.2 Unchecked exception: failure tetap penting, tetapi tidak menjadi signature burden

Unchecked exception cocok ketika:

1. failure adalah programming error/precondition violation;
2. caller tidak realistis bisa recover secara lokal;
3. exception akan ditangani oleh framework/global handler;
4. failure adalah domain rejection yang ingin dikonversi di boundary aplikasi;
5. menambahkan checked exception akan merusak ergonomics tanpa memberi keputusan baru.

Contoh:

```java
public final class DuplicateCaseTransitionException extends RuntimeException {
    public DuplicateCaseTransitionException(String caseId, String transitionId) {
        super("Duplicate transition " + transitionId + " for case " + caseId);
    }
}
```

Di service layer, ini bukan “bug JVM”. Ini domain/runtime rejection yang nanti diterjemahkan menjadi conflict response, audit note, atau failed command.

---

### 4.3 Jangan memilih checked/unchecked hanya berdasarkan “business vs technical”

Premis yang sering salah:

```text
Business exception harus checked.
Technical exception harus unchecked.
```

Tidak selalu.

Lebih tepat:

```text
Jika caller langsung perlu mengambil keputusan dan exception adalah bagian stabil dari API contract, checked bisa masuk akal.
Jika exception akan ditangani di boundary lebih tinggi atau merepresentasikan precondition/invariant violation, unchecked sering lebih baik.
```

Contoh business checked yang masuk akal:

```java
public ApprovalResult approve(ApplicationId id) throws ApplicationAlreadyDecidedException;
```

Cocok bila API ini adalah library/domain API yang caller-nya memang harus branch.

Contoh business unchecked yang juga masuk akal:

```java
public void approve(ApplicationId id) {
    if (alreadyDecided(id)) {
        throw new ApplicationAlreadyDecidedException(id);
    }
}
```

Cocok bila command handler global menerjemahkan exception menjadi outcome standar.

---

## 5. Failure Taxonomy untuk Serious Systems

Agar exception design tidak acak, gunakan taxonomy operasional berikut.

---

## 5.1 Domain rejection

Failure terjadi karena input/command melanggar aturan domain.

Contoh:

```text
Application already approved
Case status does not allow escalation
Document type not accepted for this workflow stage
Deadline has passed
Duplicate submission
```

Karakteristik:

- bukan bug sistem;
- caller/user mungkin bisa memperbaiki;
- sebaiknya menghasilkan error code stabil;
- perlu auditability;
- biasanya tidak perlu stack trace noise tinggi untuk kasus normal;
- bisa checked atau unchecked tergantung API style.

Contoh class:

```java
public abstract class DomainException extends RuntimeException {
    private final String code;

    protected DomainException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}

public final class InvalidCaseTransitionException extends DomainException {
    public InvalidCaseTransitionException(String caseId, String from, String to) {
        super(
            "CASE_INVALID_TRANSITION",
            "Case " + caseId + " cannot transition from " + from + " to " + to
        );
    }
}
```

Boundary handling:

```java
try {
    commandHandler.handle(command);
} catch (DomainException e) {
    return ApiError.conflict(e.code(), e.getMessage());
}
```

Design note:

```text
Domain rejection harus jelas untuk caller, tetapi tidak boleh membocorkan internal stack/SQL/framework.
```

---

## 5.2 Validation failure

Failure terjadi karena bentuk input salah atau incomplete.

Contoh:

```text
Missing required field
Invalid email format
Postal code not numeric
Date range invalid
Payload too large
```

Karakteristik:

- biasanya user-actionable;
- sering menghasilkan 400 Bad Request;
- perlu field-level detail;
- tidak seharusnya menjadi incident;
- stack trace biasanya tidak perlu untuk setiap occurrence.

Contoh:

```java
public final class ValidationException extends RuntimeException {
    private final List<FieldViolation> violations;

    public ValidationException(List<FieldViolation> violations) {
        super("Validation failed with " + violations.size() + " violation(s)");
        this.violations = List.copyOf(violations);
    }

    public List<FieldViolation> violations() {
        return violations;
    }
}

public record FieldViolation(String field, String code, String message) {}
```

Boundary:

```text
ValidationException -> 400
DomainException     -> 409 / 422 / domain-specific response
SystemException     -> 500
```

---

## 5.3 Programming error

Failure terjadi karena code melanggar precondition, invariant, atau contract internal.

Contoh Java standard:

```text
NullPointerException
IllegalArgumentException
IllegalStateException
IndexOutOfBoundsException
ClassCastException
AssertionError
```

Karakteristik:

- biasanya developer-actionable;
- tidak boleh disembunyikan sebagai normal domain result;
- perlu stack trace;
- biasanya tidak retryable;
- harus masuk error monitoring.

Contoh:

```java
public void assignOwner(User owner) {
    if (owner == null) {
        throw new NullPointerException("owner");
    }
    if (!owner.isActive()) {
        throw new IllegalArgumentException("owner must be active");
    }
    this.owner = owner;
}
```

Atau modern style:

```java
public void assignOwner(User owner) {
    this.owner = Objects.requireNonNull(owner, "owner");
    if (!owner.isActive()) {
        throw new IllegalArgumentException("owner must be active");
    }
}
```

Important distinction:

```text
IllegalArgumentException dari public API input bisa dipetakan ke client error.
IllegalArgumentException dari internal invariant harus diperlakukan sebagai bug.
```

Class sama, meaning beda tergantung boundary.

---

## 5.4 Infrastructure transient failure

Failure terjadi karena dependency eksternal sementara bermasalah.

Contoh:

```text
DB connection timeout
HTTP 503 from remote service
RabbitMQ temporarily unavailable
Redis timeout
S3 throttling
DNS resolution failure
```

Karakteristik:

- kadang retryable;
- retry harus bounded dan idempotency-aware;
- perlu metric;
- perlu cause asli;
- perlu klasifikasi transient/permanent;
- bisa menyebabkan circuit breaker open.

Contoh wrapper:

```java
public final class ExternalDependencyUnavailableException extends RuntimeException {
    private final String dependency;
    private final boolean retryable;

    public ExternalDependencyUnavailableException(
            String dependency,
            boolean retryable,
            String message,
            Throwable cause
    ) {
        super(message, cause);
        this.dependency = dependency;
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

Boundary:

```java
try {
    return remoteClient.fetchProfile(id);
} catch (SocketTimeoutException e) {
    throw new ExternalDependencyUnavailableException(
        "profile-service",
        true,
        "Profile service timed out while fetching " + id,
        e
    );
}
```

Caveat:

```text
Retryable exception bukan berarti selalu retry.
Retry membutuhkan idempotency, budget, timeout, dan backoff.
```

---

## 5.5 Infrastructure permanent failure

Failure terjadi karena dependency menolak secara permanen atau konfigurasi salah.

Contoh:

```text
Authentication failed to external API
Permission denied
Invalid remote request contract
Schema mismatch
Unsupported protocol
Unknown host due to bad config
```

Karakteristik:

- biasanya tidak retryable;
- perlu alert/operator action;
- bisa menjadi deployment/config incident;
- message harus menyebut dependency dan operation;
- jangan expose secret.

Contoh:

```java
public final class ExternalDependencyConfigurationException extends RuntimeException {
    public ExternalDependencyConfigurationException(String dependency, String reason, Throwable cause) {
        super("External dependency misconfigured: " + dependency + "; reason=" + reason, cause);
    }
}
```

---

## 5.6 Data consistency failure

Failure terjadi karena asumsi data tidak terpenuhi.

Contoh:

```text
Expected one active case, found many
Reference row missing
Optimistic locking conflict
Unique constraint violation
Invalid historical state
```

Karakteristik:

- bisa domain conflict atau system bug;
- perlu entity id dan invariant name;
- sering butuh audit/incident investigation;
- transaction rollback hampir selalu diperlukan.

Contoh:

```java
public final class DataInvariantViolationException extends RuntimeException {
    public DataInvariantViolationException(String invariant, String details) {
        super("Data invariant violated: " + invariant + "; " + details);
    }
}
```

Design note:

```text
Unique constraint violation karena duplicate user command mungkin domain conflict.
Unique constraint violation karena bug generator id mungkin system incident.
```

Lagi-lagi: class exception saja tidak cukup; boundary dan context menentukan meaning.

---

## 5.7 Platform/runtime failure

Failure berasal dari class loading, linkage, unsupported Java version, missing classes, static init, atau module boundary.

Contoh:

```text
ClassNotFoundException
NoClassDefFoundError
ClassCastException due to class loader split
LinkageError
UnsupportedClassVersionError
ExceptionInInitializerError
IllegalAccessError
NoSuchMethodError
```

Karakteristik:

- sering deployment/build/runtime mismatch;
- biasanya tidak recoverable dalam request;
- perlu fail fast;
- di plugin system, mungkin isolated plugin bisa dinonaktifkan;
- di monolith/service biasa, biasanya fatal deployment bug.

Contoh scenario:

```text
Service compiled with Java 21 class files,
running on Java 17 runtime:
UnsupportedClassVersionError
```

Boundary:

```text
Request handler tidak semestinya catch dan return success fallback.
Startup health check harus gagal.
Deployment harus dihentikan/rollback.
```

---

## 5.8 VM/resource fatal failure

Contoh:

```text
OutOfMemoryError
StackOverflowError
InternalError
UnknownError
```

Karakteristik:

- process mungkin tidak lagi trustworthy;
- logging pun bisa gagal karena butuh allocation;
- recovery lokal berbahaya;
- orchestrator/container restart lebih aman;
- postmortem evidence: heap dump, thread dump, GC logs, metrics.

Kebijakan umum:

```text
Do not catch for business recovery.
At most log at top-level fatal boundary and rethrow.
```

---

## 6. `Error` yang Wajib Dipahami

### 6.1 `OutOfMemoryError`

`OutOfMemoryError` terjadi ketika JVM tidak bisa mengalokasikan object karena memory habis dan GC tidak bisa menyediakan memory lagi.

Contoh penyebab:

```text
Heap leak
Huge allocation
Metaspace leak
Direct buffer leak
Native memory pressure
Too many threads
Container memory limit
```

Beberapa OOME berbeda:

```text
java.lang.OutOfMemoryError: Java heap space
java.lang.OutOfMemoryError: Metaspace
java.lang.OutOfMemoryError: Direct buffer memory
java.lang.OutOfMemoryError: unable to create native thread
GC overhead limit exceeded
```

Jangan tulis:

```java
try {
    processHugeFile(file);
} catch (OutOfMemoryError e) {
    System.gc();
    processSmallFallback(file);
}
```

Masalahnya:

- object graph mungkin corrupt secara logical;
- partial mutation sudah terjadi;
- catch block sendiri butuh allocation;
- thread lain juga mungkin terdampak;
- request-level recovery bisa menyembunyikan incident besar.

Better:

```text
- Batasi input size sebelum processing.
- Gunakan streaming parser.
- Gunakan backpressure.
- Set memory limit realistis.
- Aktifkan heap dump on OOME bila sesuai.
- Biarkan orchestrator restart bila process tidak sehat.
```

---

### 6.2 `StackOverflowError`

Terjadi ketika stack habis, biasanya karena recursion terlalu dalam.

Contoh:

```java
int size(Node node) {
    return 1 + size(node.next()); // no base case
}
```

Atau recursion valid tapi data terlalu dalam:

```text
XML/JSON/tree with extreme depth
Recursive graph traversal without visited set
Recursive equals/toString on cyclic object graph
```

Policy:

```text
Jangan recover lokal.
Perbaiki algorithm: iterative traversal, depth limit, visited set.
```

---

### 6.3 `LinkageError`

`LinkageError` menandakan class punya dependency terhadap class lain, tetapi setelah compilation ada binary linkage problem.

Subclass penting:

```text
NoClassDefFoundError
NoSuchMethodError
NoSuchFieldError
IllegalAccessError
IncompatibleClassChangeError
UnsupportedClassVersionError
UnsatisfiedLinkError
```

Contoh penyebab:

```text
Dependency version mismatch
Class removed at runtime
Different jar version in container
Compiled against newer API
Native library missing
JPMS boundary issue
```

Policy:

```text
Treat as deployment/build/runtime compatibility incident.
Do not convert to business error.
```

---

### 6.4 `NoClassDefFoundError` vs `ClassNotFoundException`

`ClassNotFoundException` adalah checked exception. Biasanya terjadi ketika code secara eksplisit meminta load class by name:

```java
Class.forName("com.example.Plugin");
```

`NoClassDefFoundError` adalah `Error`. Biasanya terjadi ketika class yang dibutuhkan saat runtime tidak tersedia/linkable, padahal compilation pernah berhasil.

Mental model:

```text
ClassNotFoundException:
    "Saya mencoba mencari class secara eksplisit, tidak ketemu."

NoClassDefFoundError:
    "Runtime mencoba resolve class yang seharusnya ada berdasarkan binary dependency, tapi gagal."
```

Implication:

```text
CNFE bisa normal di plugin discovery.
NCDFE sering deployment corruption / missing dependency.
```

---

### 6.5 `ExceptionInInitializerError`

Terjadi ketika static initializer atau static field initialization gagal.

Contoh:

```java
public final class ConfigHolder {
    static final Config CONFIG = loadConfig(); // throws runtime exception
}
```

Dampak:

- class initialization gagal;
- subsequent access bisa menghasilkan `NoClassDefFoundError`;
- failure sering terjadi saat startup atau first use;
- sulit didiagnosis jika static init terlalu banyak melakukan I/O/config parsing.

Rule:

```text
Hindari heavy logic di static initializer.
Prefer explicit startup initialization with clear error handling.
```

---

### 6.6 `AssertionError`

`AssertionError` biasanya dilempar oleh statement `assert` ketika assertion enabled.

Contoh:

```java
assert amount.signum() >= 0 : "amount must not be negative";
```

Assertion cocok untuk internal invariant yang seharusnya mustahil dilanggar, bukan validasi input user.

Jangan gunakan `assert` untuk business validation karena assertion bisa disabled.

Buruk:

```java
assert request.userId() != null;
```

Baik:

```java
if (request.userId() == null) {
    throw new ValidationException(...);
}
```

---

## 7. Exception Mapping di Layered Architecture

### 7.1 Jangan biarkan low-level exception bocor ke boundary luar

Buruk:

```java
public CaseDetail getCase(String id) throws SQLException {
    return repository.findCase(id);
}
```

Jika ini service API, `SQLException` membocorkan detail persistence.

Lebih baik:

```java
public CaseDetail getCase(String id) {
    try {
        return repository.findCase(id);
    } catch (SQLException e) {
        throw new DataAccessFailureException("Failed to load case " + id, e);
    }
}
```

Dengan custom unchecked:

```java
public final class DataAccessFailureException extends RuntimeException {
    public DataAccessFailureException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Tujuan wrapping:

```text
Preserve cause, but translate abstraction.
```

Jangan wrapping hanya untuk mengganti nama tanpa context.

---

### 7.2 Boundary translation pattern

Gunakan pola:

```text
Low-level exception -> layer-specific exception -> external response/event
```

Contoh:

```text
SQLException
    -> DataAccessFailureException
        -> 500 INTERNAL_ERROR

SQLIntegrityConstraintViolationException unique case number
    -> DuplicateCaseNumberException
        -> 409 CASE_DUPLICATE

SocketTimeoutException from OneMap
    -> ExternalDependencyUnavailableException("onemap", retryable=true)
        -> 503 DEPENDENCY_TIMEOUT
```

Pattern ini menjaga:

- encapsulation;
- observability;
- stable external contract;
- cause chain;
- domain meaning.

---

### 7.3 Exception mapping table

Contoh mapping untuk API/service boundary:

| Category | Example | Retry? | User Response | Operator Signal | Stack Trace? |
|---|---|---:|---|---|---|
| Validation | missing field | No | 400 | No | Usually no |
| Domain rejection | invalid transition | No | 409/422 | Usually no | Usually no/low |
| Auth/authz | forbidden action | No | 401/403 | Maybe security metric | Usually no |
| Conflict | optimistic lock | Maybe after reload | 409 | Metric | Maybe |
| Transient dependency | timeout | Maybe | 503 | Yes if elevated | Yes sampled/full |
| Permanent dependency | bad credential | No | 500/503 | Yes | Yes |
| Programming error | NPE | No | 500 | Yes | Yes |
| Data invariant | duplicate active row | No | 500/409 depending meaning | Yes | Yes |
| Linkage/runtime | NoSuchMethodError | No | 500/startup fail | Critical | Yes |
| VM fatal | OOME | No local | Process unhealthy | Critical | Best effort |

---

## 8. Transaction Boundary Implications

Exception classification sangat penting untuk transaction handling.

### 8.1 Runtime exception biasanya rollback di banyak framework

Banyak framework transaction Java melakukan rollback by default untuk unchecked exception, tetapi tidak selalu untuk checked exception kecuali dikonfigurasi.

Konsekuensi desain:

```java
@Transactional
public void approve(String caseId) throws ApprovalCheckedException {
    caseRepository.markApproved(caseId);
    auditRepository.insertAudit(caseId);
    throw new ApprovalCheckedException(...);
}
```

Jika framework tidak rollback untuk checked exception, partial write bisa commit.

Lesson:

```text
Exception taxonomy harus align dengan transaction policy.
```

Jika kamu membuat checked domain exception, pastikan transaction boundary tahu apakah harus rollback.

---

### 8.2 Jangan catch lalu return success palsu

Buruk:

```java
@Transactional
public ApprovalResult approve(String id) {
    try {
        repository.approve(id);
        audit.write(id);
        return ApprovalResult.success();
    } catch (Exception e) {
        log.warn("Approval failed", e);
        return ApprovalResult.success(); // catastrophic lie
    }
}
```

Ini membuat:

- data mungkin partial;
- caller percaya berhasil;
- audit misleading;
- retry logic tidak jalan;
- incident tersembunyi.

Lebih baik:

```java
@Transactional
public ApprovalResult approve(String id) {
    repository.approve(id);
    audit.write(id);
    return ApprovalResult.success();
}
```

Biarkan exception propagate ke boundary yang benar.

---

### 8.3 Catch untuk compensate harus sempit dan eksplisit

Kadang catch diperlukan untuk compensation.

Contoh:

```java
public void publishAfterCommit(CaseApproved event) {
    try {
        messageBus.publish(event);
    } catch (MessageBusUnavailableException e) {
        outboxRepository.save(event);
        metrics.increment("case.approved.outbox_fallback");
    }
}
```

Ini valid karena:

- catch spesifik;
- ada action aman;
- tidak menyembunyikan failure;
- ada fallback durable;
- ada metric.

---

## 9. Retryability: Jangan Retry Berdasarkan Class Saja

### 9.1 Retry membutuhkan lima syarat

Sebelum retry, jawab:

1. Operation idempotent?
2. Failure transient?
3. Ada timeout budget?
4. Ada backoff/jitter?
5. Ada limit dan observability?

Buruk:

```java
while (true) {
    try {
        client.call();
        break;
    } catch (Exception e) {
        // retry forever
    }
}
```

Baik:

```java
public <T> T retryTransient(Supplier<T> operation) {
    RuntimeException last = null;

    for (int attempt = 1; attempt <= 3; attempt++) {
        try {
            return operation.get();
        } catch (ExternalDependencyUnavailableException e) {
            if (!e.retryable()) {
                throw e;
            }
            last = e;
            sleepBackoff(attempt);
        }
    }

    throw new RetryExhaustedException("Retry exhausted after 3 attempts", last);
}
```

---

### 9.2 Non-retryable by default

Default aman:

```text
Do not retry unless explicitly classified retryable.
```

Jangan retry:

```text
ValidationException
IllegalArgumentException
NullPointerException
Authentication failure
Authorization failure
Schema mismatch
LinkageError
OutOfMemoryError
```

Mungkin retry:

```text
Socket timeout
HTTP 503
HTTP 429 with Retry-After
Deadlock loser
Optimistic lock with reload strategy
Temporary DNS failure
Connection reset
```

Tetapi “mungkin” berarti perlu konteks operation.

---

## 10. Designing a Production Exception Hierarchy

### 10.1 Jangan terlalu banyak class, jangan terlalu sedikit

Terlalu sedikit:

```java
throw new RuntimeException("Failed");
```

Masalah:

- tidak ada classification;
- tidak ada code;
- tidak ada retryability;
- sulit mapping;
- sulit alert filtering.

Terlalu banyak:

```text
CaseApprovalDatabaseReadTimeoutAfterStatusValidationException
CaseApprovalDatabaseReadTimeoutBeforeStatusValidationException
CaseApprovalDatabaseWriteTimeoutException
...
```

Masalah:

- hierarchy sulit dipakai;
- class explosion;
- mapping brittle;
- developer bingung.

Cari level yang memisahkan action.

---

### 10.2 Contoh hierarchy seimbang

```java
public abstract class ApplicationException extends RuntimeException {
    private final String code;

    protected ApplicationException(String code, String message) {
        super(message);
        this.code = code;
    }

    protected ApplicationException(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String code() {
        return code;
    }
}

public abstract class ClientCorrectableException extends ApplicationException {
    protected ClientCorrectableException(String code, String message) {
        super(code, message);
    }
}

public abstract class DomainException extends ClientCorrectableException {
    protected DomainException(String code, String message) {
        super(code, message);
    }
}

public final class ValidationException extends ClientCorrectableException {
    private final List<FieldViolation> violations;

    public ValidationException(List<FieldViolation> violations) {
        super("VALIDATION_FAILED", "Validation failed");
        this.violations = List.copyOf(violations);
    }

    public List<FieldViolation> violations() {
        return violations;
    }
}

public abstract class SystemFailureException extends ApplicationException {
    protected SystemFailureException(String code, String message, Throwable cause) {
        super(code, message, cause);
    }
}

public final class DependencyFailureException extends SystemFailureException {
    private final String dependency;
    private final boolean retryable;

    public DependencyFailureException(
            String dependency,
            boolean retryable,
            String message,
            Throwable cause
    ) {
        super("DEPENDENCY_FAILURE", message, cause);
        this.dependency = dependency;
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

Mapping becomes straightforward:

```java
public ApiError map(Throwable t) {
    if (t instanceof ValidationException e) {
        return ApiError.badRequest(e.code(), e.violations());
    }
    if (t instanceof DomainException e) {
        return ApiError.conflict(e.code(), e.getMessage());
    }
    if (t instanceof DependencyFailureException e) {
        return ApiError.serviceUnavailable(e.code(), e.getMessage());
    }
    if (t instanceof ApplicationException e) {
        return ApiError.internal(e.code());
    }
    return ApiError.internal("INTERNAL_ERROR");
}
```

---

### 10.3 Use error code for external contract, class for internal control

Exception class name adalah internal API. External clients sebaiknya menerima stable error code.

Internal:

```java
throw new InvalidCaseTransitionException(caseId, from, to);
```

External:

```json
{
  "code": "CASE_INVALID_TRANSITION",
  "message": "Case cannot transition from SUBMITTED to CLOSED",
  "correlationId": "..."
}
```

Kenapa?

- class bisa rename/refactor;
- code bisa didokumentasikan;
- clients tidak bergantung pada Java type;
- localization/message bisa berubah tanpa memecah contract.

---

## 11. Standard Runtime Exceptions: Kapan Dipakai?

### 11.1 `IllegalArgumentException`

Gunakan ketika argument method tidak memenuhi precondition.

```java
public PageRequest(int page, int size) {
    if (page < 0) {
        throw new IllegalArgumentException("page must be >= 0");
    }
    if (size <= 0 || size > 100) {
        throw new IllegalArgumentException("size must be between 1 and 100");
    }
}
```

Jangan gunakan untuk semua domain failure.

Kurang baik:

```java
throw new IllegalArgumentException("Case already approved");
```

Lebih baik:

```java
throw new CaseAlreadyApprovedException(caseId);
```

---

### 11.2 `IllegalStateException`

Gunakan ketika object/system state tidak memungkinkan operasi dilakukan.

```java
public void start() {
    if (started) {
        throw new IllegalStateException("Service already started");
    }
    started = true;
}
```

Perbedaan sederhana:

```text
IllegalArgumentException = input/parameter salah.
IllegalStateException    = receiver/object/system sedang dalam state yang salah.
```

---

### 11.3 `UnsupportedOperationException`

Gunakan ketika operasi tidak didukung oleh implementation.

```java
public final class ReadOnlyCaseRepository implements CaseRepository {
    @Override
    public void save(Case c) {
        throw new UnsupportedOperationException("Read-only repository does not support save");
    }
}
```

Caveat:

```text
Jangan gunakan UOE sebagai pengganti TODO di production path.
```

---

### 11.4 `NullPointerException`

NPE sering terjadi otomatis, tetapi boleh dilempar eksplisit untuk parameter null jika contract melarang null.

```java
this.caseId = Objects.requireNonNull(caseId, "caseId");
```

Untuk public API, kadang `IllegalArgumentException` dipakai untuk invalid input termasuk null, tetapi Java standard library sering menggunakan `NullPointerException` untuk null yang tidak diizinkan.

Consistency lebih penting daripada debat absolut.

---

### 11.5 `ClassCastException`

Biasanya jangan dilempar manual kecuali membuat type abstraction rendah. Jika sering muncul, biasanya ada masalah generic/type modelling.

Contoh penyebab:

```java
Object value = "123";
Integer number = (Integer) value; // ClassCastException
```

Di framework/deserializer, lebih baik translate menjadi mapping exception dengan field path.

---

### 11.6 `IndexOutOfBoundsException`

Cocok untuk index/range invalid.

```java
if (index < 0 || index >= size) {
    throw new IndexOutOfBoundsException("index=" + index + ", size=" + size);
}
```

Message harus membantu debugging.

---

### 11.7 `ArithmeticException`

Contoh umum:

```java
int x = 10 / 0; // ArithmeticException
```

Juga bisa muncul dari exact arithmetic:

```java
Math.addExact(Integer.MAX_VALUE, 1); // ArithmeticException
```

Cocok untuk numeric invariant violation.

---

### 11.8 `SecurityException`

Historically berkaitan dengan Security Manager. Namun di Java modern, Security Manager sudah deprecated for removal dan semakin tidak menjadi mekanisme sandbox utama.

Tetap mungkin muncul dari API tertentu atau library, tetapi desain security modern biasanya tidak bergantung pada menangkap `SecurityException` sebagai authorization model aplikasi.

---

## 12. Catching Strategy

### 12.1 Catch only what you can handle

Rule paling penting:

```text
Catch exception hanya jika kamu bisa melakukan action yang benar di level itu.
```

Action yang valid:

```text
translate
retry
compensate
rollback/mark failed
add context and rethrow
close resource
convert to response
record metric/audit
```

Action yang tidak valid:

```text
log and ignore tanpa reason
return null
return success
retry forever
hide cause
wrap tanpa context
catch Throwable untuk business flow
```

---

### 12.2 `catch (Exception)` boleh, tapi hanya di boundary tertentu

Valid di top-level boundary:

```java
public ApiResponse handle(Request request) {
    try {
        return dispatch(request);
    } catch (ValidationException e) {
        return badRequest(e);
    } catch (DomainException e) {
        return conflict(e);
    } catch (Exception e) {
        log.error("Unhandled request failure", e);
        return internalError();
    }
}
```

Kenapa valid?

- ini boundary terakhir sebelum response;
- ada mapping jelas;
- exception tidak disembunyikan;
- observability dilakukan;
- `Error` tidak dicatch.

Tidak valid di domain logic:

```java
public void approve(Case c) {
    try {
        c.approve();
    } catch (Exception e) {
        // ignore
    }
}
```

---

### 12.3 `catch (Throwable)` hampir selalu salah

Buruk:

```java
try {
    runJob();
} catch (Throwable t) {
    log.error("Job failed", t);
}
```

Masalah:

- menangkap `OutOfMemoryError`;
- menangkap `StackOverflowError`;
- menangkap `ThreadDeath`;
- process bisa lanjut dalam kondisi tidak trustworthy;
- orchestrator tidak tahu harus restart.

Jika benar-benar perlu top-level fatal logging:

```java
try {
    runMainLoop();
} catch (Throwable t) {
    try {
        logFatalBestEffort(t);
    } finally {
        throw t;
    }
}
```

Tujuannya: **observe then die**, bukan recover.

---

### 12.4 Multi-catch untuk action yang sama

```java
try {
    parse(input);
} catch (NumberFormatException | DateTimeParseException e) {
    throw new ValidationException(List.of(
        new FieldViolation("date", "INVALID_FORMAT", "Invalid date format")
    ));
}
```

Gunakan multi-catch ketika handling sama. Jangan gabungkan exception yang action-nya berbeda.

---

### 12.5 Rethrow with context

Buruk:

```java
catch (IOException e) {
    throw new RuntimeException(e);
}
```

Lebih baik:

```java
catch (IOException e) {
    throw new DocumentStorageException(
        "Failed to read document " + documentId + " from bucket " + bucketName,
        e
    );
}
```

Context harus cukup untuk debugging, tetapi tidak membocorkan secret.

---

## 13. Exception Message Design

### 13.1 Message harus actionable

Buruk:

```text
Failed
Error occurred
Invalid
Could not process
```

Baik:

```text
Cannot approve case CASE-123 because current status is CLOSED
Timed out calling OneMap geocode endpoint after 2000 ms
Expected exactly one active license for salesperson SP-88, found 3
```

---

### 13.2 Message bukan external contract tunggal

Message boleh berubah. Untuk external API, gunakan code.

```java
throw new DomainException("CASE_INVALID_STATUS", "Cannot approve closed case");
```

External clients bergantung pada `CASE_INVALID_STATUS`, bukan English sentence.

---

### 13.3 Jangan masukkan secret/PII sembarangan

Hindari:

```text
password
access token
full NRIC/passport
session cookie
private key
complete payload with PII
```

Gunakan redaction:

```java
throw new ExternalDependencyConfigurationException(
    "onemap",
    "authentication failed for configured client id " + mask(clientId),
    e
);
```

---

## 14. Observability: Logging, Metrics, Tracing, and Alerting

### 14.1 Tidak semua exception perlu log error

Validation/domain rejection dalam volume tinggi tidak selalu incident.

Contoh policy:

```text
ValidationException      -> no error log, metric counter
DomainException          -> warn/debug depending business criticality
DependencyFailure        -> warn/error depending retry exhausted
Programming bug          -> error log
Data invariant violation -> error log + alert
VM Error                 -> fatal/best effort
```

---

### 14.2 Jangan log lalu rethrow di setiap layer

Buruk:

```java
catch (Exception e) {
    log.error("Repository failed", e);
    throw e;
}
```

Lalu service log lagi, controller log lagi, global handler log lagi.

Akibat:

- log duplicate;
- noise;
- biaya observability naik;
- root cause sulit dibaca.

Better:

```text
Lower layer adds context via wrapping.
Boundary layer logs once.
```

---

### 14.3 Metrics by class saja kurang cukup

Metric bagus:

```text
exception.category=validation/domain/dependency/programming/data_invariant
exception.code=CASE_INVALID_TRANSITION
operation=approve_case
dependency=onemap
retryable=true/false
```

Jangan gunakan raw exception message sebagai metric label karena high cardinality.

Buruk:

```text
exception_message="Case CASE-123 cannot transition..."
```

Baik:

```text
exception_code="CASE_INVALID_TRANSITION"
```

---

## 15. Failure Modelling for Workflow/Regulatory Systems

Untuk sistem regulatory/case management, exception taxonomy harus mendukung defensibility.

Contoh command:

```text
ApproveApplicationCommand
EscalateCaseCommand
AssignOfficerCommand
GenerateNoticeCommand
SubmitAppealCommand
```

Setiap command bisa gagal karena kategori berbeda:

```text
Validation:
    missing mandatory field

Domain rejection:
    case status does not allow escalation

Authorization:
    officer has no permission for agency/module

Conflict:
    case was updated by another officer

Dependency:
    template service unavailable

Data invariant:
    active assignment record duplicated

Programming bug:
    null policy object
```

Masing-masing membutuhkan response berbeda.

Contoh taxonomy:

```java
public sealed abstract class CaseCommandException extends RuntimeException
        permits CaseValidationException,
                CaseDomainException,
                CaseConflictException,
                CaseSystemException {

    private final String code;
    private final String caseId;

    protected CaseCommandException(String code, String caseId, String message) {
        super(message);
        this.code = code;
        this.caseId = caseId;
    }

    public String code() { return code; }
    public String caseId() { return caseId; }
}
```

Note: sealed hierarchy hanya cocok jika exception categories stabil dan owned di satu module/package. Jangan overuse jika ecosystem eksternal perlu extend.

---

## 16. Checked Exception in Public Library API

Jika kamu membuat library, checked exception bisa berguna.

Contoh XML parser utility:

```java
public Document parse(InputStream input) throws XmlParseException, IOException;
```

Tapi pertimbangkan:

- apakah caller bisa recover dari parse error?
- apakah parse error ingin menjadi validation result?
- apakah API akan banyak dipakai di lambda/stream?
- apakah exception type stabil?

Alternative result object:

```java
public ParseResult<Document> parse(InputStream input);
```

Dengan:

```java
public sealed interface ParseResult<T> {
    record Success<T>(T value) implements ParseResult<T> {}
    record Failure<T>(String code, String message, int line, int column) implements ParseResult<T> {}
}
```

Exception cocok untuk exceptional control flow. Result object cocok bila failure adalah expected business outcome dan caller selalu perlu branch.

---

## 17. Exception vs Result Type

Gunakan exception ketika:

- failure memotong normal flow;
- handling terpusat di boundary;
- failure jarang dibanding success;
- stack trace penting;
- nested calls tidak ingin pass result terus-menerus.

Gunakan result type ketika:

- failure adalah expected outcome;
- caller harus branch secara eksplisit;
- volume failure tinggi;
- stack trace tidak berguna;
- ingin modelling exhaustive dengan sealed interface;
- validasi batch perlu semua errors, bukan fail fast.

Contoh validation batch lebih cocok result:

```java
public ValidationResult validate(ApplicationForm form) {
    List<FieldViolation> violations = new ArrayList<>();

    if (form.name() == null || form.name().isBlank()) {
        violations.add(new FieldViolation("name", "REQUIRED", "Name is required"));
    }
    if (form.postalCode() == null || !form.postalCode().matches("\\d{6}")) {
        violations.add(new FieldViolation("postalCode", "INVALID", "Postal code must be 6 digits"));
    }

    return violations.isEmpty()
            ? ValidationResult.valid()
            : ValidationResult.invalid(violations);
}
```

Exception validation cocok jika ingin abort command:

```java
ValidationResult result = validator.validate(form);
if (!result.isValid()) {
    throw new ValidationException(result.violations());
}
```

---

## 18. Java 8–25 Evolution Notes

### 18.1 Core hierarchy stabil

`Throwable`, `Exception`, `RuntimeException`, dan `Error` tetap fundamental dari Java 8 sampai Java 25.

Yang berubah lebih banyak adalah:

- API tambahan di sekitar diagnostics;
- helpful NullPointerException;
- records/sealed/pattern matching yang membantu modelling result/error;
- module system yang memunculkan failure baru seperti illegal access/linkage/module boundary;
- Security Manager deprecation/removal trajectory;
- virtual threads yang mengubah konteks beberapa exception handling patterns di concurrent execution.

---

### 18.2 Helpful NullPointerException

Java modern dapat memberikan message NPE yang lebih informatif, misalnya expression mana yang null. Ini membantu debugging, tetapi jangan jadikan NPE sebagai validasi bisnis.

NPE tetap sinyal:

```text
Ada null contract yang dilanggar.
```

---

### 18.3 Records and sealed types improve error modelling

Record membantu membuat payload error immutable-ish:

```java
public record ErrorResponse(
        String code,
        String message,
        String correlationId,
        List<FieldViolation> violations
) {}
```

Sealed interface membantu modelling result:

```java
public sealed interface CommandOutcome
        permits CommandOutcome.Accepted,
                CommandOutcome.Rejected,
                CommandOutcome.Failed {

    record Accepted(String id) implements CommandOutcome {}
    record Rejected(String code, String message) implements CommandOutcome {}
    record Failed(String code, String message) implements CommandOutcome {}
}
```

Tetapi jangan mengganti semua exception dengan sealed result. Gunakan sesuai boundary.

---

## 19. Common Anti-Patterns

### 19.1 Swallowing exception

```java
try {
    audit.write(event);
} catch (Exception ignored) {
}
```

Masalah:

- audit hilang;
- compliance risk;
- tidak ada evidence;
- caller tidak tahu.

Jika audit optional, eksplisitkan:

```java
try {
    audit.write(event);
} catch (AuditSinkUnavailableException e) {
    metrics.increment("audit.write.failed");
    log.warn("Optional audit sink unavailable; eventId={}", event.id(), e);
}
```

Jika audit mandatory, jangan swallow.

---

### 19.2 Throwing `Exception`

Buruk:

```java
public void approve(String id) throws Exception
```

Masalah:

- caller tidak tahu failure contract;
- semua handling jadi broad;
- documentation lemah.

Lebih baik:

```java
public void approve(String id) throws ApprovalConflictException
```

Atau unchecked domain exception dengan documented behavior.

---

### 19.3 Throwing `RuntimeException` directly everywhere

Buruk:

```java
throw new RuntimeException("Invalid transition");
```

Lebih baik:

```java
throw new InvalidCaseTransitionException(caseId, from, to);
```

---

### 19.4 Catching and replacing without cause

Buruk:

```java
catch (IOException e) {
    throw new DocumentException("Cannot load document");
}
```

Cause hilang.

Baik:

```java
catch (IOException e) {
    throw new DocumentException("Cannot load document " + id, e);
}
```

---

### 19.5 Using exception for normal loop control in hot path

Buruk:

```java
for (String s : values) {
    try {
        numbers.add(Integer.parseInt(s));
    } catch (NumberFormatException e) {
        // common path
    }
}
```

Jika invalid values sangat umum dan performance penting, pertimbangkan precheck/parser result.

---

### 19.6 Catching `InterruptedException` incorrectly

Buruk:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    log.warn("Interrupted", e);
}
```

Interrupt status hilang.

Baik:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationInterruptedException("Operation interrupted", e);
}
```

`InterruptedException` adalah checked exception yang sangat penting secara control-flow. Jangan swallow.

---

### 19.7 Retrying after `Error`

Buruk:

```java
catch (Throwable t) {
    retry();
}
```

Ini bisa retry setelah OOME/StackOverflow/LinkageError. Jangan.

---

## 20. Production Checklist

Gunakan checklist ini saat mendesain exception/failure layer.

### 20.1 Classification

- [ ] Apakah failure termasuk validation, domain, conflict, dependency, data invariant, programming bug, platform, atau VM fatal?
- [ ] Apakah caller benar-benar bisa recover?
- [ ] Apakah failure retryable? Berdasarkan apa?
- [ ] Apakah failure harus rollback transaction?
- [ ] Apakah failure harus alert operator?

### 20.2 Exception type

- [ ] Apakah checked exception memberikan keputusan nyata ke caller?
- [ ] Apakah unchecked lebih cocok karena handling dilakukan di boundary?
- [ ] Apakah `Error` dibiarkan propagate?
- [ ] Apakah standard runtime exception cukup, atau perlu custom type?
- [ ] Apakah custom hierarchy tidak terlalu granular?

### 20.3 Message and metadata

- [ ] Apakah message actionable?
- [ ] Apakah cause asli dipertahankan?
- [ ] Apakah error code stabil tersedia untuk external contract?
- [ ] Apakah entity id/operation/dependency cukup jelas?
- [ ] Apakah secret/PII tidak bocor?

### 20.4 Boundary handling

- [ ] Apakah low-level exception ditranslate di boundary layer yang benar?
- [ ] Apakah global handler log sekali saja?
- [ ] Apakah validation/domain rejection tidak menjadi noisy incident?
- [ ] Apakah data invariant/programming bug masuk monitoring?
- [ ] Apakah fatal error tidak disembunyikan?

### 20.5 Retry and compensation

- [ ] Apakah retry bounded?
- [ ] Apakah operation idempotent?
- [ ] Apakah ada backoff/jitter?
- [ ] Apakah retry exhaustion punya exception jelas?
- [ ] Apakah compensation durable dan observable?

---

## 21. Thought Exercises

### Exercise 1 — Classify failures

Untuk setiap failure berikut, tentukan category, retryability, response, dan logging policy:

1. User submit form tanpa mandatory field.
2. Case sudah `CLOSED`, tetapi command `approve` dikirim.
3. DB connection timeout selama 2 detik.
4. Unique constraint violation saat create case number.
5. `NullPointerException` di `CasePolicyEvaluator`.
6. `NoSuchMethodError` setelah deployment.
7. `OutOfMemoryError: Java heap space` saat import XML besar.
8. Remote service return HTTP 429.
9. `InterruptedException` saat worker menunggu queue.
10. `ExceptionInInitializerError` saat startup membaca config.

Jawaban yang matang tidak hanya menyebut exception class, tetapi action:

```text
retry / reject / rollback / alert / fail startup / kill process / compensate
```

---

### Exercise 2 — Refactor bad exception handling

Kode buruk:

```java
public void process(String caseId) {
    try {
        Case c = repository.find(caseId);
        service.approve(c);
        audit.write(c);
    } catch (Exception e) {
        e.printStackTrace();
    }
}
```

Refactor dengan:

- exception taxonomy;
- cause preservation;
- boundary handling;
- audit mandatory vs optional decision;
- transaction semantics.

---

### Exercise 3 — Design an exception hierarchy

Desain exception hierarchy untuk workflow engine yang punya:

```text
Invalid transition
Unauthorized action
Optimistic lock conflict
External notification timeout
Template rendering failure
Data invariant violation
```

Tentukan:

- checked atau unchecked;
- error code;
- retryability;
- mapping ke API response;
- logging/alert policy.

---

## 22. Ringkasan

`Exception`, `RuntimeException`, dan `Error` bukan sekadar tiga class di hierarchy `Throwable`. Mereka adalah fondasi cara Java membedakan kegagalan yang bisa dipulihkan, kegagalan yang harus diakui caller, kegagalan akibat contract violation, dan kegagalan fatal platform/runtime.

Pemahaman top-tier bukan berhenti pada:

```text
checked harus ditangkap, unchecked tidak harus ditangkap
```

Melainkan:

```text
Failure ini berarti apa?
Siapa yang bisa mengambil tindakan?
Tindakan apa yang aman?
Apakah transaction harus rollback?
Apakah retry valid?
Apakah user bisa memperbaiki input?
Apakah operator perlu alert?
Apakah process masih trustworthy?
```

Prinsip utama:

1. gunakan checked exception jika caller perlu mengakui contract dan punya keputusan nyata;
2. gunakan unchecked exception untuk precondition violation, domain rejection yang ditangani di boundary, dan system failure wrapper;
3. jangan catch `Error` untuk business recovery;
4. jangan hilangkan cause;
5. jangan log di setiap layer;
6. jangan retry tanpa klasifikasi dan idempotency;
7. gunakan error code untuk external contract;
8. buat exception hierarchy berdasarkan action, bukan berdasarkan nama teknis semata;
9. bedakan validation/domain rejection dari programming bug dan platform failure;
10. biarkan fatal VM/runtime failure terlihat sebagai fatal.

Jika Part 11 mengajarkan anatomi `Throwable`, Part 12 mengajarkan **governance atas failure**. Inilah perbedaan antara code yang “bisa jalan” dan sistem yang bisa dioperasikan, diaudit, di-debug, dan dipertahankan di production.

---

## 23. Apa Berikutnya

Part berikutnya:

```text
Part 13 — System: Standard Streams, Properties, Environment, Time, Array Copy, Logger
File: 13-system-standard-streams-properties-env-time-arraycopy-logger.md
```

Kita akan membahas `System` sebagai gateway global JVM: standard streams, properties, environment variables, wall-clock vs monotonic time, native array copy, identity hash, logger, global state, testability, container deployment, dan security-sensitive implications.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 11 — `Throwable`: Exception Object Model, Stack Trace, Causality, Suppression](./11-throwable-exception-object-model-causality-stacktrace-suppression.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 13 — `System`: Standard Streams, Properties, Environment, Time, Array Copy, Logger](./13-system-standard-streams-properties-env-time-arraycopy-logger.md)
