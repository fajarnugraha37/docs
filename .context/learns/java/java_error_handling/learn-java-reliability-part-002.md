# learn-java-reliability-part-002.md

# Part 002 — Java Exception Semantics Deep Dive

> Seri: Graceful Shutdown, Error Handling, Exceptions, and Reliability  
> Status: Part 002 / 030  
> Topik: Java exception semantics, propagation, checked/unchecked exception, cause chain, suppressed exception, try-with-resources, and production-grade exception design foundations.

---

## 0. Tujuan Bagian Ini

Bagian ini membangun pemahaman mendalam tentang **exception semantics di Java**.

Banyak developer memakai exception hanya sebagai alat untuk “menangkap error”. Engineer yang lebih matang melihat exception sebagai:

1. **control boundary** — mekanisme memutus alur normal ketika kontrak tidak terpenuhi;
2. **semantic signal** — bahasa yang menjelaskan jenis kegagalan;
3. **causal evidence** — jejak penyebab yang membantu investigasi;
4. **API contract** — bagian dari cara method/class/module berkomunikasi dengan caller;
5. **reliability primitive** — fondasi retry, rollback, compensation, observability, and incident response.

Setelah bagian ini, targetnya bukan sekadar tahu `try-catch`, tetapi mampu menjawab:

- Exception jenis apa yang harus dilempar?
- Apakah exception ini checked atau unchecked?
- Apakah harus dibungkus, diterjemahkan, atau dibiarkan propagate?
- Apakah cause chain masih utuh?
- Apakah stack trace masih berguna?
- Apakah suppressed exception hilang?
- Apakah caller bisa membuat keputusan recovery dari exception ini?
- Apakah exception ini bagian dari domain contract atau hanya detail teknis internal?

---

## 1. Core Problem

Problem utama error handling di Java bukan karena Java kekurangan fitur. Problem utamanya adalah **semantic collapse**.

Semantic collapse terjadi ketika banyak jenis failure yang berbeda akhirnya diperlakukan sebagai hal yang sama.

Contoh buruk:

```java
try {
    processApplication(command);
} catch (Exception e) {
    log.error("Error", e);
    return ResponseEntity.internalServerError().body("Failed");
}
```

Kode ini terlihat “aman” karena exception tertangkap. Tetapi secara reliability, ini merusak banyak hal:

- validation error menjadi 500;
- business rule violation menjadi 500;
- optimistic locking conflict menjadi 500;
- external timeout menjadi 500 tanpa retriable signal;
- authorization failure mungkin bocor sebagai internal error;
- invariant breach terlihat sama dengan user mistake;
- caller tidak tahu apakah boleh retry;
- operator tidak tahu apakah ini incident, data issue, dependency issue, atau bug;
- metrics menjadi noise;
- incident analysis menjadi lebih sulit.

Masalahnya bukan “exception tidak ditangkap”. Masalahnya adalah **exception kehilangan makna**.

---

## 2. Mental Model: Exception sebagai Non-Normal Completion

Di Java, eksekusi program normalnya berjalan dari statement ke statement. Exception adalah mekanisme untuk menghentikan alur normal dan memindahkan kontrol ke handler yang cocok.

Model mentalnya:

```text
normal flow
   |
   v
statement A -> statement B -> statement C -> return normally

exceptional flow
   |
   v
statement A -> statement B throws -> stack unwinds -> matching catch/finally -> maybe recover / translate / propagate
```

Exception bukan sekadar “objek error”. Exception adalah **perubahan jalur eksekusi**.

Saat exception dilempar:

1. method saat ini berhenti normal;
2. Java mencari `catch` yang cocok di stack frame saat ini;
3. jika tidak ada, method keluar secara exceptional;
4. caller juga dicari handler-nya;
5. proses berlanjut sampai ditemukan handler atau thread berakhir;
6. `finally` atau cleanup resource bisa tetap dijalankan sesuai aturan bahasa;
7. stack trace menyimpan jejak lokasi exception dibuat/dilempar.

Artinya, exception membawa dua dimensi sekaligus:

- **control transfer**: mengubah alur eksekusi;
- **diagnostic evidence**: membawa konteks kegagalan.

Engineer senior harus menjaga keduanya.

---

## 3. Throwable Hierarchy

Struktur dasar Java exception:

```text
java.lang.Object
  └── java.lang.Throwable
        ├── java.lang.Error
        └── java.lang.Exception
              └── java.lang.RuntimeException
```

Secara konseptual:

```text
Throwable
├── Error
│   ├── OutOfMemoryError
│   ├── StackOverflowError
│   ├── LinkageError
│   └── ...
└── Exception
    ├── checked exceptions
    │   ├── IOException
    │   ├── SQLException
    │   └── ...
    └── RuntimeException
        ├── NullPointerException
        ├── IllegalArgumentException
        ├── IllegalStateException
        ├── IndexOutOfBoundsException
        └── ...
```

`Throwable` adalah superclass untuk semua object yang dapat dilempar oleh Java `throw` statement atau JVM. `Throwable` dapat membawa message, stack trace, cause, dan suppressed exceptions.

Referensi resmi Java SE 25 menjelaskan bahwa `Throwable` dapat berisi snapshot execution stack, message string, suppressed throwables, dan cause throwable.

---

## 4. Throwable Bukan Selalu Exception

Ini penting.

Semua exception adalah throwable, tetapi tidak semua throwable adalah exception.

```java
Throwable t1 = new Exception("business failure");
Throwable t2 = new Error("serious JVM/system problem");
```

Perbedaan praktis:

| Type | Umumnya berarti | Biasanya ditangani aplikasi? |
|---|---|---|
| `Exception` | kondisi gagal yang mungkin bisa dimodelkan aplikasi | Ya, tergantung jenisnya |
| `RuntimeException` | bug, invalid state, invalid usage, atau unchecked failure | Kadang di boundary, jarang lokal sembarangan |
| `Error` | kondisi serius level JVM/runtime/platform | Hampir tidak pernah ditangani untuk recovery bisnis |

Contoh `Error`:

- `OutOfMemoryError`
- `StackOverflowError`
- `NoClassDefFoundError`
- `ExceptionInInitializerError`

Anti-pattern:

```java
try {
    runBusinessFlow();
} catch (Throwable t) {
    log.error("Caught everything", t);
}
```

Kenapa buruk?

Karena `catch (Throwable)` juga menangkap `Error`. Ini bisa membuat aplikasi mencoba lanjut dalam kondisi runtime sudah tidak sehat. Dalam banyak kasus, lebih aman membiarkan proses crash, restart, atau masuk fail-fast path.

Exception rule:

> Tangkap failure yang kamu pahami dan punya strategi untuk diproses. Jangan tangkap semua hanya agar aplikasi terlihat tidak crash.

---

## 5. Checked vs Unchecked Exception

Java membagi exception menjadi:

1. **checked exception**;
2. **unchecked exception**.

Checked exception adalah subclass `Exception` yang bukan subclass `RuntimeException`. Checked exception harus dideklarasikan di `throws` atau ditangkap.

Unchecked exception mencakup:

- `RuntimeException` dan subclass-nya;
- `Error` dan subclass-nya.

Contoh checked:

```java
public String readConfig(Path path) throws IOException {
    return Files.readString(path);
}
```

Contoh unchecked:

```java
public Money withdraw(Money amount) {
    if (amount.isNegative()) {
        throw new IllegalArgumentException("amount must be positive");
    }
    // ...
}
```

### 5.1 Apa Makna Checked Exception?

Checked exception adalah cara Java memaksa caller untuk mengakui bahwa method bisa gagal dengan cara tertentu.

Model mental:

```text
checked exception = recoverable or expected failure that is part of method contract
```

Contoh:

- file tidak ada;
- network IO gagal;
- parsing external input gagal;
- database driver operation gagal;
- certificate loading gagal.

Tetapi hati-hati: “checked” tidak otomatis berarti “recoverable”. Banyak checked exception di library Java lama merepresentasikan detail teknis, bukan keputusan domain yang benar-benar bisa dipulihkan caller.

Contoh:

```java
public void submitApplication(ApplicationCommand command) throws SQLException
```

Ini buruk untuk service/domain API karena:

- caller dipaksa tahu detail persistence;
- API bocor implementation detail;
- SQLException tidak memberi semantic domain;
- caller mungkin tidak tahu mana constraint violation, deadlock, connection failure, atau syntax error.

Lebih baik:

```java
public void submitApplication(ApplicationCommand command)
        throws ApplicationSubmissionException
```

atau jika menggunakan unchecked domain exception:

```java
public void submitApplication(ApplicationCommand command) {
    // throws ApplicationConflictException, ApplicationInvariantViolationException, etc.
}
```

### 5.2 Apa Makna Unchecked Exception?

Unchecked exception tidak dipaksa compiler untuk ditangkap/dideklarasikan.

Model mental:

```text
unchecked exception = caller is not mechanically forced to handle it
```

Namun, itu bukan berarti exception tersebut tidak penting.

Unchecked exception sering digunakan untuk:

- programming error;
- invalid method argument;
- illegal object state;
- domain rule violation di architecture tertentu;
- infrastructure failure yang ditangani di boundary;
- framework-level propagation.

Contoh:

```java
public final class ApplicationAlreadySubmittedException extends RuntimeException {
    public ApplicationAlreadySubmittedException(String applicationId) {
        super("Application already submitted: " + applicationId);
    }
}
```

Ini bisa valid jika architecture kamu memutuskan domain exception adalah unchecked dan akan diterjemahkan di API boundary.

### 5.3 Checked vs Unchecked: Decision Matrix

Gunakan checked exception ketika:

| Kondisi | Checked cocok? |
|---|---:|
| Caller benar-benar bisa melakukan recovery lokal | Ya |
| Failure adalah bagian eksplisit dari API low-level | Ya |
| Kamu ingin compiler memaksa caller mengakui failure | Ya |
| Exception akan sering diteruskan tanpa tindakan | Tidak ideal |
| Exception hanya detail technical dependency | Tidak ideal di boundary high-level |
| Exception terjadi karena bug programmer | Tidak |

Gunakan unchecked exception ketika:

| Kondisi | Unchecked cocok? |
|---|---:|
| Invalid argument / invalid state | Ya |
| Domain rule violation ditangani centralized | Bisa |
| Infrastructure failure diterjemahkan di boundary | Bisa |
| Caller tidak bisa recovery lokal | Ya |
| Exception harus menjadi bagian eksplisit compile-time contract | Tidak |
| Kamu ingin semua caller dipaksa catch | Tidak |

Heuristik kuat:

> Checked exception cocok untuk API yang caller-nya memang punya pilihan recovery lokal. Unchecked exception cocok untuk failure yang sebaiknya diproses di boundary atau menunjukkan kontrak pemakaian dilanggar.

---

## 6. Exception as Contract

Setiap method punya contract. Contract bukan hanya input dan return value, tetapi juga failure mode.

Contoh method:

```java
Application submit(SubmitApplicationCommand command);
```

Pertanyaan contract:

- Apa yang terjadi jika command invalid?
- Apa yang terjadi jika application sudah submitted?
- Apa yang terjadi jika applicant tidak punya permission?
- Apa yang terjadi jika database down?
- Apa yang terjadi jika external screening timeout?
- Apa yang terjadi jika duplicate idempotency key?
- Apa yang terjadi jika state transition tidak valid?

Jika exception tidak dirancang, caller hanya melihat “something failed”.

Lebih baik exception contract dipikirkan eksplisit:

```java
Application submit(SubmitApplicationCommand command)
        throws ApplicationValidationException,
               ApplicationStateConflictException,
               ApplicationDependencyUnavailableException;
```

Atau jika menggunakan unchecked:

```java
Application submit(SubmitApplicationCommand command);

// May throw:
// - ApplicationValidationException
// - ApplicationStateConflictException
// - DependencyUnavailableException
// - InvariantViolationException
```

Pada API internal modern, banyak tim memilih unchecked domain exception agar method signature tidak terlalu noisy. Itu boleh, tetapi dokumentasi dan mapping boundary harus kuat.

Unchecked bukan berarti undocumented.

---

## 7. Exception as Semantic Signal

Exception harus memberi sinyal keputusan.

Sinyal minimal yang harus bisa disimpulkan:

1. **Siapa yang bisa memperbaiki?**
   - user;
   - caller/client;
   - operator;
   - developer;
   - dependency owner.

2. **Apakah boleh retry?**
   - tidak;
   - ya segera;
   - ya dengan backoff;
   - ya setelah dependency pulih;
   - hanya jika idempotent.

3. **Apakah state mungkin berubah?**
   - pasti belum berubah;
   - mungkin sudah sebagian;
   - commit uncertain;
   - side effect external mungkin sudah terjadi.

4. **Apakah ini expected?**
   - business-as-usual;
   - unusual but known;
   - incident candidate;
   - invariant breach;
   - security event.

5. **Apa response boundary yang tepat?**
   - 400;
   - 401;
   - 403;
   - 404;
   - 409;
   - 422;
   - 429;
   - 500;
   - 502;
   - 503;
   - 504.

Exception yang baik bukan hanya punya nama bagus. Exception yang baik membantu sistem mengambil keputusan.

---

## 8. Stack Trace as Evidence

Stack trace bukan untuk user. Stack trace adalah evidence untuk engineer dan operator.

Contoh:

```text
java.lang.IllegalStateException: Application is already approved
    at com.example.application.Application.approve(Application.java:88)
    at com.example.application.ApplicationService.approve(ApplicationService.java:44)
    at com.example.api.ApplicationController.approve(ApplicationController.java:27)
```

Stack trace menjawab:

- exception dibuat di mana;
- jalur call apa yang menyebabkan failure;
- apakah failure berasal dari domain, infrastructure, atau framework;
- apakah exception dibungkus dengan benar;
- apakah root cause masih terlihat.

### 8.1 Jangan Hancurkan Stack Trace

Anti-pattern:

```java
catch (IOException e) {
    throw new RuntimeException(e.getMessage());
}
```

Masalah:

- cause hilang;
- stack trace root cause hilang;
- debugging menjadi jauh lebih sulit.

Lebih baik:

```java
catch (IOException e) {
    throw new ConfigLoadException("Failed to load config from " + path, e);
}
```

Exception baru memberi semantic context, cause tetap disimpan.

### 8.2 Jangan Membuat Stack Trace Palsu

Anti-pattern:

```java
catch (SQLException e) {
    log.error("DB failed", e);
    throw new DatabaseUnavailableException("DB failed");
}
```

Masalahnya mirip: root cause hilang.

Better:

```java
catch (SQLException e) {
    throw new DatabaseUnavailableException("Database unavailable while submitting application", e);
}
```

### 8.3 Stack Trace Bisa Mahal

Membuat exception mengisi stack trace punya cost. Pada hot path ekstrem, beberapa library memakai exception tanpa writable stack trace.

Contoh constructor `Throwable` mendukung konfigurasi suppression dan writable stack trace.

Namun, hati-hati:

- jangan mematikan stack trace untuk business/domain failure yang perlu audit/debug;
- jangan pakai exception sebagai control flow di hot loop;
- jangan optimasi stack trace sebelum ada bukti.

Rule:

> Stack trace adalah biaya yang biasanya layak dibayar untuk correctness dan supportability. Optimasi hanya untuk path yang terbukti panas dan aman secara observability.

---

## 9. Cause Chain

Cause chain adalah rantai penyebab exception.

Contoh:

```java
try {
    repository.save(application);
} catch (DataAccessException e) {
    throw new ApplicationSubmissionException(
        "Failed to submit application " + application.id(),
        e
    );
}
```

Di sini:

```text
ApplicationSubmissionException
  caused by DataAccessException
    caused by SQLException
```

Cause chain memungkinkan kita mempertahankan dua hal sekaligus:

- semantic abstraction di layer atas;
- diagnostic detail di layer bawah.

### 9.1 Kapan Wrapping Benar?

Wrapping benar ketika exception melewati boundary semantic.

Contoh boundary:

| Dari | Ke | Perlu translate? |
|---|---|---:|
| JDBC | Repository | Ya, ke persistence exception |
| Repository | Domain service | Ya, jika ingin domain/infrastructure semantic |
| Domain service | API controller | Ya, ke HTTP error contract |
| External client | Use case | Ya, ke dependency failure |
| Validation library | Domain command | Ya, ke validation/domain error |

### 9.2 Kapan Wrapping Berlebihan?

Anti-pattern:

```text
RuntimeException
  caused by ServiceException
    caused by ApplicationException
      caused by RepositoryException
        caused by DataAccessException
          caused by SQLException
```

Jika setiap layer membungkus tanpa menambah semantic meaning, cause chain menjadi noisy.

Wrapping harus menambah salah satu dari ini:

- domain meaning;
- operation context;
- boundary translation;
- recovery classification;
- observability metadata;
- security-safe abstraction.

Jika tidak menambah value, jangan wrap.

---

## 10. Suppressed Exceptions

Suppressed exception sering dilupakan, padahal penting untuk resource cleanup.

Kasus klasik:

```java
try (Resource r = openResource()) {
    use(r); // throws primary exception
}
```

Jika `use(r)` melempar exception dan `r.close()` juga melempar exception, exception dari `close()` tidak menggantikan primary exception. Ia disimpan sebagai **suppressed exception**.

Model:

```text
PrimaryException: failure while using resource
  Suppressed: CloseException: failure while closing resource
```

Ini lebih baik daripada `finally` manual yang bisa menutupi exception utama.

### 10.1 Problem dengan finally Manual

Anti-pattern:

```java
Resource r = null;
try {
    r = openResource();
    use(r); // throws A
} finally {
    if (r != null) {
        r.close(); // throws B
    }
}
```

Jika `use(r)` melempar A, lalu `close()` melempar B, B bisa menggantikan A sebagai exception yang terlihat. Root cause utama bisa hilang.

Try-with-resources menyimpan B sebagai suppressed agar A tetap primary.

### 10.2 Cara Membaca Suppressed Exception

```java
catch (Exception e) {
    log.error("Operation failed", e);

    for (Throwable suppressed : e.getSuppressed()) {
        log.warn("Suppressed exception", suppressed);
    }
}
```

Biasanya logging framework sudah mencetak suppressed exception saat stack trace dicetak. Namun saat membuat custom serialization/reporting, jangan lupa suppressed exception.

### 10.3 Suppressed Exception dalam Reliability

Suppressed exception penting karena cleanup failure bisa menunjukkan masalah production:

- connection gagal close;
- stream gagal flush;
- transaction cleanup gagal;
- file handle gagal dilepas;
- temporary file gagal delete;
- resource pool rusak.

Jangan abaikan suppressed exception jika sedang investigasi incident.

---

## 11. try, catch, finally: Semantics yang Sering Salah Dipahami

### 11.1 catch Memilih Tipe yang Cocok

```java
try {
    risky();
} catch (ValidationException e) {
    handleValidation(e);
} catch (BusinessConflictException e) {
    handleConflict(e);
} catch (Exception e) {
    handleUnexpected(e);
}
```

Urutan catch penting. Yang lebih spesifik harus di atas.

Ini tidak valid karena catch umum lebih dulu:

```java
try {
    risky();
} catch (Exception e) {
    handleUnexpected(e);
} catch (ValidationException e) { // unreachable
    handleValidation(e);
}
```

### 11.2 finally Hampir Selalu Jalan, Tetapi Tidak Selalu

`finally` biasanya dijalankan baik terjadi exception maupun tidak.

Tetapi jangan menganggap finally selalu guaranteed dalam semua kondisi. Contoh yang bisa mencegah:

- JVM process dihentikan paksa;
- `SIGKILL`;
- runtime crash;
- severe JVM error;
- host mati;
- container killed setelah grace period habis;
- infinite loop/deadlock sebelum keluar try;
- `Runtime.halt`.

Reliability implication:

> Jangan menggantungkan correctness utama hanya pada finally jika proses bisa mati paksa. Gunakan durable state, transaction boundary, idempotency, dan recovery/reconciliation.

### 11.3 finally Jangan Melempar Exception Baru Sembarangan

Anti-pattern:

```java
try {
    process();
} finally {
    cleanup(); // may throw
}
```

Jika `cleanup()` melempar exception, primary exception dari `process()` bisa tertutup.

Lebih aman:

```java
Throwable primary = null;
try {
    process();
} catch (Throwable t) {
    primary = t;
    throw t;
} finally {
    try {
        cleanup();
    } catch (Throwable cleanupFailure) {
        if (primary != null) {
            primary.addSuppressed(cleanupFailure);
        } else {
            throw cleanupFailure;
        }
    }
}
```

Namun dalam praktik modern, gunakan try-with-resources jika resource-nya cocok.

---

## 12. try-with-resources

Try-with-resources digunakan untuk resource yang mengimplementasikan `AutoCloseable`.

Contoh:

```java
try (InputStream input = Files.newInputStream(path)) {
    return input.readAllBytes();
}
```

Semantics penting:

- resource ditutup otomatis;
- resource ditutup setelah block selesai;
- jika ada lebih dari satu resource, ditutup dalam urutan terbalik dari deklarasi;
- exception dari close bisa menjadi suppressed jika block utama sudah melempar exception;
- catch/finally setelah try-with-resources dijalankan setelah resource ditutup.

Contoh multi-resource:

```java
try (
    InputStream input = Files.newInputStream(source);
    OutputStream output = Files.newOutputStream(target)
) {
    input.transferTo(output);
}
```

Close order:

```text
output.close()
input.close()
```

### 12.1 AutoCloseable Design

Jika membuat resource sendiri:

```java
public final class ProcessingLease implements AutoCloseable {
    private final LeaseClient client;
    private final String leaseId;
    private boolean closed;

    public ProcessingLease(LeaseClient client, String leaseId) {
        this.client = Objects.requireNonNull(client);
        this.leaseId = Objects.requireNonNull(leaseId);
    }

    @Override
    public void close() {
        if (closed) {
            return;
        }
        closed = true;
        client.release(leaseId);
    }
}
```

Design rule:

- `close()` sebaiknya idempotent;
- `close()` sebaiknya tidak melakukan operasi kompleks berisiko tinggi tanpa batas waktu;
- jika `close()` bisa gagal, pikirkan apakah caller perlu tahu;
- jangan sembunyikan cleanup failure yang penting secara reliability;
- jangan membuat `close()` block selamanya.

---

## 13. The Danger of Catching Too Broadly

### 13.1 `catch (Exception e)`

Tidak selalu salah, tetapi sering salah tempat.

Valid di boundary:

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemResponse> unexpected(Exception e) {
        log.error("Unexpected failure", e);
        return ResponseEntity.internalServerError().body(
            ProblemResponse.internalError("UNEXPECTED_ERROR")
        );
    }
}
```

Buruk di domain logic:

```java
public void approve(Application app) {
    try {
        validate(app);
        app.approve();
        repository.save(app);
    } catch (Exception e) {
        // hides validation, invariant, persistence, and concurrency semantics
        throw new RuntimeException("Approve failed");
    }
}
```

Heuristik:

> Broad catch boleh di boundary yang memang bertugas mengubah semua unexpected failure menjadi safe response. Broad catch buruk di tengah business flow karena menghapus makna.

### 13.2 `catch (Throwable t)`

Hampir selalu buruk untuk business code.

Boleh dipertimbangkan hanya untuk:

- top-level thread boundary;
- logging before process death;
- framework/container boundary;
- cleanup best-effort yang tidak mencoba recovery bisnis;
- test harness;
- isolated supervisor yang memang memahami konsekuensinya.

Contoh top-level worker guard:

```java
public void runWorkerLoop() {
    try {
        workerLoop();
    } catch (Throwable t) {
        log.error("Worker crashed with unrecoverable throwable", t);
        throw t;
    }
}
```

Bahkan di sini, tidak ditelan.

---

## 14. Swallowing Exception

Swallowing exception adalah menangkap exception lalu tidak melakukan apa-apa atau hanya log tanpa mengubah state/response.

Anti-pattern:

```java
try {
    auditTrail.write(event);
} catch (Exception ignored) {
}
```

Ini berbahaya jika audit trail adalah requirement penting.

Versi sedikit lebih baik tapi masih bisa buruk:

```java
try {
    auditTrail.write(event);
} catch (Exception e) {
    log.warn("Audit failed", e);
}
```

Pertanyaan yang harus dijawab:

- Apakah operasi utama boleh tetap sukses jika audit gagal?
- Apakah perlu retry async?
- Apakah perlu dead letter?
- Apakah perlu alert?
- Apakah response harus gagal?
- Apakah compliance mengizinkan audit loss?
- Apakah ada reconciliation?

Kalau tidak ada jawaban, jangan swallow.

Rule:

> Exception boleh ditelan hanya jika loss-nya sudah disengaja, terdokumentasi, terukur, dan aman.

---

## 15. Logging Exception: Log Once, At the Right Boundary

Anti-pattern:

```java
try {
    service.process(command);
} catch (Exception e) {
    log.error("Controller failed", e);
    throw e;
}
```

Lalu service juga log:

```java
try {
    repository.save(entity);
} catch (Exception e) {
    log.error("Service failed", e);
    throw e;
}
```

Lalu global handler juga log:

```java
@ExceptionHandler(Exception.class)
public ResponseEntity<?> handle(Exception e) {
    log.error("Unexpected", e);
    return ...;
}
```

Hasil:

- satu failure menghasilkan banyak error log;
- alert menjadi noisy;
- incident timeline penuh duplikasi;
- root cause sulit dibaca;
- metrics bisa double count.

Heuristik:

```text
Log exception once at the boundary where you have enough context and where the exception is finally classified.
```

Layer bawah boleh menambah context dengan wrapping, bukan selalu log.

Better:

```java
catch (SQLException e) {
    throw new ApplicationPersistenceException(
        "Failed to persist application id=" + applicationId,
        e
    );
}
```

Lalu global handler/classifier log sekali:

```java
@ExceptionHandler(ApplicationPersistenceException.class)
public ResponseEntity<ProblemResponse> handle(ApplicationPersistenceException e) {
    log.error("Persistence failure during application operation", e);
    return ResponseEntity.status(503).body(...);
}
```

---

## 16. Exception Message Design

Exception message harus membantu engineer memahami konteks tanpa membocorkan data sensitif.

Buruk:

```java
throw new ApplicationException("Failed");
```

Lebih baik:

```java
throw new ApplicationSubmissionException(
    "Failed to submit applicationId=" + applicationId + " during persistence step",
    cause
);
```

Namun jangan begini jika data sensitif:

```java
throw new ApplicationSubmissionException(
    "Failed for applicant NRIC=S1234567A token=eyJhbGciOi...",
    cause
);
```

Guidelines:

- sertakan operation context;
- sertakan stable identifier yang aman;
- sertakan state atau step jika relevan;
- jangan sertakan password/token/secret;
- jangan sertakan PII kecuali memang aman dan sesuai policy;
- jangan membuat message terlalu generik;
- jangan membuat message berisi internal SQL lengkap untuk response user;
- bedakan message internal dengan response external.

---

## 17. Domain Exception vs Technical Exception

### 17.1 Technical Exception

Technical exception berasal dari mekanisme teknis:

- `SQLException`
- `IOException`
- `TimeoutException`
- `ConnectException`
- `JsonProcessingException`
- `DataAccessException`
- `OptimisticLockingFailureException`

Technical exception menjawab: **teknologi apa yang gagal?**

### 17.2 Domain Exception

Domain exception berasal dari aturan bisnis/domain:

- `ApplicationAlreadySubmittedException`
- `InvalidStateTransitionException`
- `ApplicantNotEligibleException`
- `CaseAlreadyAssignedException`
- `ApprovalLimitExceededException`

Domain exception menjawab: **aturan apa yang dilanggar?**

### 17.3 Jangan Campur Sembarangan

Buruk:

```java
throw new SQLException("Application already approved");
```

Buruk juga:

```java
throw new ApplicationAlreadySubmittedException("Database connection refused");
```

Exception type harus merepresentasikan semantic failure.

---

## 18. Common Java Runtime Exceptions and Their Meaning

### 18.1 NullPointerException

Biasanya berarti:

- programming bug;
- missing validation;
- invalid assumption;
- broken invariant;
- dependency returned unexpected null.

Jangan ubah semua NPE jadi 400.

Jika input user null, validasi di boundary dan hasilkan validation error.

Jika domain object field null padahal invariant melarang, itu bug/invariant breach.

### 18.2 IllegalArgumentException

Cocok saat caller memberi argument yang tidak memenuhi method contract.

```java
public void setPriority(int priority) {
    if (priority < 1 || priority > 5) {
        throw new IllegalArgumentException("priority must be between 1 and 5");
    }
}
```

Tetapi untuk user-facing domain validation, sering lebih baik custom validation exception.

### 18.3 IllegalStateException

Cocok saat object/system berada dalam state yang tidak valid untuk operasi tersebut.

```java
public void approve() {
    if (status != Status.SUBMITTED) {
        throw new IllegalStateException("Only submitted application can be approved");
    }
    status = Status.APPROVED;
}
```

Namun untuk domain state conflict, custom exception bisa lebih jelas:

```java
throw new InvalidApplicationStateTransitionException(current, target);
```

### 18.4 UnsupportedOperationException

Cocok ketika operasi memang tidak didukung oleh implementation.

Hati-hati jangan dipakai sebagai placeholder yang lolos ke production.

### 18.5 ConcurrentModificationException

Sering berarti koleksi dimodifikasi saat iterasi tidak sesuai kontrak. Jangan ditangkap untuk recovery bisnis; perbaiki desain iterasi/mutasi.

### 18.6 CompletionException / ExecutionException

Sering muncul dari asynchronous computation.

- `ExecutionException` membungkus exception saat `Future.get()`.
- `CompletionException` sering dipakai `CompletableFuture` untuk unchecked wrapping.

Rule:

> Saat menangani async exception, unwrap cause dengan hati-hati agar semantic root tidak hilang.

Contoh:

```java
try {
    return future.join();
} catch (CompletionException e) {
    Throwable cause = e.getCause();
    if (cause instanceof ApplicationConflictException conflict) {
        throw conflict;
    }
    throw e;
}
```

---

## 19. Exception Translation Patterns

### 19.1 Low-Level to High-Level Translation

```java
public Application findById(ApplicationId id) {
    try {
        return jdbcTemplate.queryForObject(...);
    } catch (EmptyResultDataAccessException e) {
        throw new ApplicationNotFoundException(id, e);
    } catch (DataAccessResourceFailureException e) {
        throw new PersistenceUnavailableException("Database unavailable", e);
    } catch (DataAccessException e) {
        throw new PersistenceFailureException("Database failure while loading application " + id, e);
    }
}
```

Manfaat:

- caller tidak tahu detail JDBC/Spring;
- semantic lebih jelas;
- HTTP mapper bisa bedakan 404 vs 503 vs 500;
- metrics bisa lebih akurat.

### 19.2 External Dependency Translation

```java
try {
    ScreeningResult result = screeningClient.screen(applicant);
    return result;
} catch (HttpClientErrorException.TooManyRequests e) {
    throw new DependencyRateLimitedException("screening-service", e);
} catch (ResourceAccessException e) {
    throw new DependencyTimeoutException("screening-service", e);
} catch (HttpServerErrorException e) {
    throw new DependencyUnavailableException("screening-service", e);
}
```

Jangan biarkan HTTP client exception mentah menyebar ke domain.

### 19.3 Domain to API Translation

```java
@ExceptionHandler(ApplicationNotFoundException.class)
ResponseEntity<ProblemResponse> notFound(ApplicationNotFoundException e) {
    return ResponseEntity.status(404).body(
        ProblemResponse.of("APPLICATION_NOT_FOUND", "Application not found")
    );
}

@ExceptionHandler(ApplicationStateConflictException.class)
ResponseEntity<ProblemResponse> conflict(ApplicationStateConflictException e) {
    return ResponseEntity.status(409).body(
        ProblemResponse.of("APPLICATION_STATE_CONFLICT", e.safeMessage())
    );
}
```

API boundary adalah tempat exception berubah menjadi external contract.

---

## 20. Exception and Transaction Boundary

Exception sering memengaruhi transaction rollback.

Di Spring, secara default transaction rollback untuk unchecked exception (`RuntimeException`) dan `Error`, tetapi checked exception tidak otomatis rollback kecuali dikonfigurasi.

Konsekuensi desain:

```java
@Transactional
public void submit(Command command) throws BusinessCheckedException {
    repository.save(entity);
    if (ruleBroken) {
        throw new BusinessCheckedException("Rule broken");
    }
}
```

Jika tidak dikonfigurasi, checked exception bisa tidak memicu rollback sesuai ekspektasi developer.

Solusi:

```java
@Transactional(rollbackFor = BusinessCheckedException.class)
public void submit(Command command) throws BusinessCheckedException {
    ...
}
```

Atau gunakan unchecked domain exception bila architecture kamu memang menghendaki rollback default.

Rule:

> Exception design tidak boleh dipisahkan dari transaction semantics.

Saat memilih checked/unchecked, pikirkan:

- apakah transaksi harus rollback?
- apakah exception muncul sebelum atau sesudah side effect?
- apakah caller bisa retry?
- apakah failure menunjukkan conflict, invalid input, atau infrastructure problem?

---

## 21. Exception and API Boundary

Exception internal tidak boleh bocor mentah ke client.

Buruk:

```json
{
  "error": "org.postgresql.util.PSQLException: duplicate key value violates unique constraint app_idx"
}
```

Masalah:

- membocorkan internal schema;
- tidak stabil sebagai contract;
- tidak user-friendly;
- sulit dipakai client;
- bisa menjadi security leak.

Lebih baik:

```json
{
  "code": "APPLICATION_DUPLICATE_SUBMISSION",
  "message": "Application has already been submitted.",
  "correlationId": "01J...",
  "retriable": false
}
```

Internal logs tetap menyimpan cause chain lengkap.

External response cukup aman dan actionable.

---

## 22. Exception and Retry Semantics

Tidak semua exception boleh diretry.

Contoh non-retriable:

- validation error;
- unauthorized;
- forbidden;
- not found karena resource memang tidak ada;
- business rule violation;
- invalid state transition;
- duplicate command tanpa idempotency.

Contoh possibly retriable:

- timeout;
- temporary network failure;
- 429 with backoff;
- 503 dependency unavailable;
- deadlock;
- optimistic locking conflict jika command idempotent dan reload state;
- connection pool temporary exhaustion.

Exception type harus membantu retry classifier.

Contoh:

```java
public interface RetriableFailure {
    RetryPolicy retryPolicy();
}

public final class DependencyTimeoutException
        extends RuntimeException
        implements RetriableFailure {

    private final String dependency;

    public DependencyTimeoutException(String dependency, Throwable cause) {
        super("Dependency timed out: " + dependency, cause);
        this.dependency = dependency;
    }

    @Override
    public RetryPolicy retryPolicy() {
        return RetryPolicy.exponentialBackoff();
    }
}
```

Tidak semua tim perlu interface seperti ini, tetapi mental model-nya penting:

> Exception harus bisa diklasifikasikan menjadi retryable atau non-retryable.

---

## 23. Exception and Idempotency

Retry hanya aman jika operasi idempotent atau punya deduplication.

Exception seperti `TimeoutException` punya makna rumit:

```text
client timed out waiting for response
```

Itu tidak otomatis berarti operasi gagal.

Kemungkinan:

1. request belum sampai;
2. request sampai tetapi belum diproses;
3. request diproses lalu response hilang;
4. request commit sukses tetapi client timeout;
5. request menghasilkan side effect sebagian.

Karena itu, exception timeout harus dipasangkan dengan idempotency design.

Misalnya:

```java
public final class CommitUnknownException extends RuntimeException {
    public CommitUnknownException(String operationId, Throwable cause) {
        super("Commit status unknown for operationId=" + operationId, cause);
    }
}
```

`CommitUnknownException` lebih jujur daripada `OperationFailedException` jika sistem tidak tahu outcome sebenarnya.

Top-tier reliability rule:

> Jangan menamai exception `Failed` jika outcome-nya sebenarnya unknown.

---

## 24. Exception and State Machines

Untuk sistem lifecycle/case management, banyak failure adalah invalid transition.

Contoh:

```text
DRAFT -> SUBMITTED -> IN_REVIEW -> APPROVED
                         |              |
                         v              v
                      REJECTED        ACTIVE
```

Jika command `approve` dikirim saat status masih `DRAFT`, itu bukan `NullPointerException`, bukan `RuntimeException` generik, dan bukan `500`.

Itu state conflict/domain violation.

```java
public final class InvalidStateTransitionException extends RuntimeException {
    private final String entityType;
    private final String entityId;
    private final String currentState;
    private final String attemptedAction;

    public InvalidStateTransitionException(
            String entityType,
            String entityId,
            String currentState,
            String attemptedAction
    ) {
        super("Invalid state transition for " + entityType
                + " id=" + entityId
                + ", currentState=" + currentState
                + ", attemptedAction=" + attemptedAction);
        this.entityType = entityType;
        this.entityId = entityId;
        this.currentState = currentState;
        this.attemptedAction = attemptedAction;
    }

    public String errorCode() {
        return "INVALID_STATE_TRANSITION";
    }
}
```

Mapping API:

```text
409 Conflict
```

Bukan 500.

---

## 25. Designing Custom Exceptions

### 25.1 Basic Custom Exception

```java
public class ApplicationException extends RuntimeException {
    public ApplicationException(String message) {
        super(message);
    }

    public ApplicationException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

### 25.2 Domain Base Exception

```java
public abstract class DomainException extends RuntimeException {
    private final String code;

    protected DomainException(String code, String message) {
        super(message);
        this.code = code;
    }

    protected DomainException(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String code() {
        return code;
    }

    public boolean retriable() {
        return false;
    }
}
```

Example:

```java
public final class ApplicationAlreadySubmittedException extends DomainException {
    public ApplicationAlreadySubmittedException(String applicationId) {
        super(
            "APPLICATION_ALREADY_SUBMITTED",
            "Application already submitted: " + applicationId
        );
    }
}
```

### 25.3 Infrastructure Base Exception

```java
public abstract class InfrastructureException extends RuntimeException {
    private final String code;
    private final boolean retriable;

    protected InfrastructureException(
            String code,
            String message,
            boolean retriable,
            Throwable cause
    ) {
        super(message, cause);
        this.code = code;
        this.retriable = retriable;
    }

    public String code() {
        return code;
    }

    public boolean retriable() {
        return retriable;
    }
}
```

Example:

```java
public final class DependencyUnavailableException extends InfrastructureException {
    public DependencyUnavailableException(String dependency, Throwable cause) {
        super(
            "DEPENDENCY_UNAVAILABLE",
            "Dependency unavailable: " + dependency,
            true,
            cause
        );
    }
}
```

### 25.4 Jangan Terlalu Banyak Exception Class

Terlalu sedikit exception menyebabkan semantic collapse.

Terlalu banyak exception menyebabkan taxonomy chaos.

Balance:

- buat exception class jika caller/boundary perlu membedakan tindakan;
- jangan buat class baru hanya untuk variasi message;
- gunakan error code untuk variasi yang masih satu semantic family;
- bedakan domain, validation, conflict, dependency, invariant, security.

---

## 26. Exception Hierarchy Design

Contoh hierarchy enterprise:

```text
BaseApplicationException
├── DomainException
│   ├── BusinessRuleViolationException
│   ├── InvalidStateTransitionException
│   ├── EntityNotFoundException
│   └── DomainConflictException
├── ValidationException
│   ├── CommandValidationException
│   └── FieldValidationException
├── SecurityFailureException
│   ├── AuthenticationRequiredException
│   └── AccessDeniedDomainException
├── InfrastructureException
│   ├── PersistenceException
│   ├── DependencyUnavailableException
│   ├── DependencyTimeoutException
│   └── RateLimitedException
└── InvariantViolationException
```

Namun jangan langsung copy ini ke semua project. Gunakan sebagai thinking model.

Decision axis:

| Axis | Contoh |
|---|---|
| Source | domain, validation, persistence, dependency, security |
| Corrector | user, client, operator, developer |
| Retryability | retriable, non-retriable, unknown |
| State effect | no mutation, partial, committed, unknown |
| Boundary mapping | 400, 401, 403, 404, 409, 422, 429, 500, 503, 504 |
| Severity | expected, warning, incident, critical |

Exception hierarchy sebaiknya mengikuti keputusan sistem, bukan organisasi package saja.

---

## 27. Precise Exception Type vs Error Code

Ada dua pendekatan:

### 27.1 Many Specific Types

```java
throw new ApplicationAlreadySubmittedException(id);
throw new ApplicationExpiredException(id);
throw new ApplicationLockedException(id);
```

Kelebihan:

- type-safe;
- mudah catch spesifik;
- jelas di code.

Kekurangan:

- class banyak;
- taxonomy bisa meledak;
- perubahan rule bisa butuh class baru.

### 27.2 Fewer Types + Error Code

```java
throw new DomainConflictException(
    "APPLICATION_ALREADY_SUBMITTED",
    "Application already submitted: " + id
);
```

Kelebihan:

- class lebih sedikit;
- error code stabil untuk API;
- cocok untuk katalog error besar.

Kekurangan:

- tidak se-type-safe;
- caller bisa bergantung pada string code;
- compile-time catch kurang spesifik.

### 27.3 Hybrid Approach

Rekomendasi banyak enterprise system:

- gunakan type untuk kategori besar yang memengaruhi control flow;
- gunakan code untuk variasi domain spesifik.

Contoh:

```java
DomainConflictException(code="APPLICATION_ALREADY_SUBMITTED")
ValidationException(code="INVALID_POSTAL_CODE")
DependencyUnavailableException(code="ONEMAP_UNAVAILABLE")
```

---

## 28. Exception Handling in Layered Architecture

Model layer:

```text
Controller/API Boundary
        |
Application Service / Use Case
        |
Domain Model
        |
Repository / Gateway / Client
        |
Database / External System
```

Exception responsibility:

| Layer | Responsibility |
|---|---|
| Controller/API | translate exception to response contract |
| Application service | orchestrate, classify, preserve operation context |
| Domain model | enforce invariants and state rules |
| Repository | translate persistence technical failure |
| External gateway | translate provider/client failure |
| Infrastructure | expose technical cause safely upward |

Anti-pattern:

- controller knows SQL exceptions;
- domain throws HTTP exceptions;
- repository throws business rule exceptions it cannot know;
- external client leaks raw provider response to user;
- service catches everything and returns boolean.

---

## 29. Return Codes vs Exceptions

Java code kadang memakai return value untuk failure.

Contoh:

```java
boolean success = service.submit(command);
```

Masalah:

- kenapa gagal tidak jelas;
- caller sering lupa check;
- no causal evidence;
- tidak ada stack trace;
- failure mudah silent.

Lebih baik untuk command yang bisa gagal dengan banyak semantic:

```java
Application result = service.submit(command);
```

Jika gagal, lempar exception yang meaningful.

Namun return type bisa valid untuk expected branch:

```java
Optional<Application> findById(ApplicationId id);
```

`not found` pada query bisa menjadi `Optional.empty()`.

Tetapi pada command:

```java
approve(applicationId)
```

Jika application tidak ditemukan, itu sering exception/domain error karena command tidak bisa dipenuhi.

Guideline:

| Situation | Prefer |
|---|---|
| Expected absence in query | `Optional` |
| Validation result with many fields | result object |
| Command cannot be fulfilled | exception/domain error |
| Hot-path parser with common failure | result object may be better |
| Programmer contract violation | unchecked exception |
| Infrastructure failure | exception |

---

## 30. Exception vs Result Type

Beberapa ecosystem lebih suka `Result<T, E>`. Di Java, bisa juga:

```java
sealed interface Result<T> permits Success, Failure {}
record Success<T>(T value) implements Result<T> {}
record Failure<T>(String code, String message) implements Result<T> {}
```

Kapan result type cocok:

- validation aggregate;
- parsing user input;
- business decision yang expected dan frequent;
- workflow engine yang perlu menyimpan failure sebagai state;
- batch processing per item;
- tidak ingin stack trace untuk branch normal.

Kapan exception lebih cocok:

- invariant breach;
- infrastructure failure;
- unexpected path;
- aborting current operation;
- preserving causal evidence;
- crossing many stack frames.

Top-tier view:

> Exception dan result type bukan agama. Gunakan exception untuk exceptional control transfer dan diagnostic evidence. Gunakan result type untuk expected decision outcome yang merupakan bagian normal dari domain flow.

---

## 31. Anti-Patterns

### 31.1 Catch and Return Null

```java
try {
    return repository.find(id);
} catch (Exception e) {
    return null;
}
```

Dampak:

- root cause hilang;
- NPE muncul di tempat lain;
- caller salah menyimpulkan not found;
- incident tertunda.

### 31.2 Catch and Return False

```java
try {
    email.send(message);
    return true;
} catch (Exception e) {
    return false;
}
```

Masalah:

- false tidak menjelaskan temporary/permanent failure;
- caller tidak tahu retry;
- evidence hilang.

### 31.3 Throw Generic RuntimeException Everywhere

```java
throw new RuntimeException("failed");
```

Dampak:

- classification impossible;
- API mapping buruk;
- observability buruk;
- retry logic rapuh.

### 31.4 Wrap Without Cause

```java
throw new ServiceException("failed");
```

Root cause hilang.

### 31.5 Log and Throw Everywhere

```java
log.error("failed", e);
throw e;
```

Membuat duplicate log.

### 31.6 Use Exception for Normal Loop Control

```java
while (true) {
    try {
        process(next());
    } catch (NoMoreItemsException e) {
        break;
    }
}
```

Jika kondisi normal dan sering terjadi, gunakan API yang lebih eksplisit.

### 31.7 Convert All Exceptions to 500

```java
catch (Exception e) {
    return 500;
}
```

Semantic collapse.

### 31.8 Convert All Exceptions to Business Error

```java
catch (Exception e) {
    throw new BusinessException("Cannot process");
}
```

Infrastructure incident bisa terlihat seperti user error.

### 31.9 Ignore InterruptedException

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    // ignore
}
```

Ini buruk karena interrupt adalah cancellation signal.

Better:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationInterruptedException("Operation interrupted", e);
}
```

Kita akan bahas cancellation lebih dalam di part timeout/cancellation.

---

## 32. Production-Grade Exception Classification

Buat classifier internal:

```java
public enum FailureCategory {
    VALIDATION,
    AUTHENTICATION,
    AUTHORIZATION,
    NOT_FOUND,
    CONFLICT,
    RATE_LIMITED,
    DEPENDENCY_TIMEOUT,
    DEPENDENCY_UNAVAILABLE,
    PERSISTENCE_FAILURE,
    INVARIANT_VIOLATION,
    UNEXPECTED
}
```

Contoh classifier:

```java
public final class FailureClassifier {

    public FailureCategory classify(Throwable t) {
        Throwable root = unwrap(t);

        if (root instanceof ValidationException) {
            return FailureCategory.VALIDATION;
        }
        if (root instanceof AuthenticationException) {
            return FailureCategory.AUTHENTICATION;
        }
        if (root instanceof AccessDeniedException) {
            return FailureCategory.AUTHORIZATION;
        }
        if (root instanceof EntityNotFoundException) {
            return FailureCategory.NOT_FOUND;
        }
        if (root instanceof DomainConflictException) {
            return FailureCategory.CONFLICT;
        }
        if (root instanceof DependencyTimeoutException) {
            return FailureCategory.DEPENDENCY_TIMEOUT;
        }
        if (root instanceof DependencyUnavailableException) {
            return FailureCategory.DEPENDENCY_UNAVAILABLE;
        }
        if (root instanceof InvariantViolationException) {
            return FailureCategory.INVARIANT_VIOLATION;
        }
        return FailureCategory.UNEXPECTED;
    }

    private Throwable unwrap(Throwable t) {
        if (t instanceof java.util.concurrent.CompletionException && t.getCause() != null) {
            return unwrap(t.getCause());
        }
        if (t instanceof java.util.concurrent.ExecutionException && t.getCause() != null) {
            return unwrap(t.getCause());
        }
        return t;
    }
}
```

Classifier berguna untuk:

- API response mapping;
- metrics label;
- alert routing;
- retry decision;
- audit/event decision;
- batch item outcome;
- dead letter reason.

Hati-hati cardinality metrics. Jangan jadikan exception message sebagai label.

---

## 33. Exception Metadata

Kadang exception butuh metadata.

Contoh:

```java
public interface CodedException {
    String code();
}

public interface RetriableException {
    boolean retriable();
}

public interface SafeMessageException {
    String safeMessage();
}
```

Custom exception:

```java
public final class ExternalServiceException extends RuntimeException
        implements CodedException {

    private final String code;
    private final String dependency;
    private final boolean retriable;

    public ExternalServiceException(
            String code,
            String dependency,
            boolean retriable,
            String message,
            Throwable cause
    ) {
        super(message, cause);
        this.code = code;
        this.dependency = dependency;
        this.retriable = retriable;
    }

    public String code() {
        return code;
    }

    public String dependency() {
        return dependency;
    }

    public boolean retriable() {
        return retriable;
    }
}
```

Tetapi jangan berlebihan. Exception bukan database record lengkap.

Metadata yang umum berguna:

- stable error code;
- entity type;
- entity id aman;
- operation;
- dependency name;
- retriable flag;
- retry-after jika ada;
- correlation id biasanya dari context/log, bukan harus di exception;
- safe external message.

---

## 34. Example: Bad vs Better Exception Design

### 34.1 Bad

```java
public void submit(String applicationId) {
    try {
        Application app = repository.find(applicationId);
        if (app == null) {
            throw new RuntimeException("not found");
        }
        if (!app.canSubmit()) {
            throw new RuntimeException("bad state");
        }
        externalClient.check(app);
        app.submit();
        repository.save(app);
    } catch (Exception e) {
        log.error("submit error", e);
        throw new RuntimeException("submit failed");
    }
}
```

Problems:

- null for not found;
- generic runtime exceptions;
- external failure not classified;
- domain conflict not distinct;
- cause chain partly lost;
- log duplicated if boundary logs again;
- caller cannot map correctly;
- retry decision impossible.

### 34.2 Better

```java
public void submit(String applicationId) {
    Application app = repository.findById(ApplicationId.of(applicationId))
        .orElseThrow(() -> new ApplicationNotFoundException(applicationId));

    if (!app.canSubmit()) {
        throw new InvalidStateTransitionException(
            "Application",
            applicationId,
            app.status().name(),
            "SUBMIT"
        );
    }

    try {
        screeningGateway.check(app);
    } catch (DependencyTimeoutException | DependencyUnavailableException e) {
        throw e;
    } catch (RuntimeException e) {
        throw new DependencyFailureException(
            "screening-service",
            "Unexpected screening dependency failure",
            e
        );
    }

    app.submit();

    try {
        repository.save(app);
    } catch (OptimisticLockingConflictException e) {
        throw new ApplicationConcurrentModificationException(applicationId, e);
    } catch (PersistenceUnavailableException e) {
        throw e;
    } catch (PersistenceException e) {
        throw new ApplicationSubmissionPersistenceException(applicationId, e);
    }
}
```

Boundary mapping:

| Exception | HTTP | Retriable | Meaning |
|---|---:|---:|---|
| `ApplicationNotFoundException` | 404 | No | target resource absent |
| `InvalidStateTransitionException` | 409 | No | current state cannot accept command |
| `DependencyTimeoutException` | 504 | Maybe | dependency slow/timeout |
| `DependencyUnavailableException` | 503 | Maybe | dependency unavailable |
| `ApplicationConcurrentModificationException` | 409 | Maybe with reload | concurrent update |
| `ApplicationSubmissionPersistenceException` | 500/503 | Depends | persistence failure |

---

## 35. Testing Exception Semantics

Test bukan hanya “exception thrown”. Test semantic.

### 35.1 Test Type

```java
@Test
void submit_shouldThrowNotFound_whenApplicationMissing() {
    when(repository.findById(id)).thenReturn(Optional.empty());

    assertThrows(ApplicationNotFoundException.class,
        () -> service.submit(id.value()));
}
```

### 35.2 Test Cause Preservation

```java
@Test
void save_shouldPreserveCause_whenDatabaseFails() {
    SQLException sql = new SQLException("connection refused");
    when(jdbc.update(anyString())).thenThrow(new DataAccessResourceFailureException("db", sql));

    PersistenceUnavailableException ex = assertThrows(
        PersistenceUnavailableException.class,
        () -> repository.save(entity)
    );

    assertSame(sql, rootCause(ex));
}
```

### 35.3 Test API Mapping

```java
@Test
void api_shouldReturn409_forInvalidStateTransition() throws Exception {
    doThrow(new InvalidStateTransitionException("Application", "A-1", "DRAFT", "APPROVE"))
        .when(service).approve("A-1");

    mockMvc.perform(post("/applications/A-1/approve"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("INVALID_STATE_TRANSITION"));
}
```

### 35.4 Test Suppressed Exception

```java
@Test
void tryWithResources_shouldPreserveSuppressedCloseFailure() {
    Exception ex = assertThrows(Exception.class, () -> {
        try (FailingResource ignored = new FailingResource()) {
            throw new IllegalStateException("primary");
        }
    });

    assertEquals("primary", ex.getMessage());
    assertEquals(1, ex.getSuppressed().length);
}
```

---

## 36. Operational Checklist

Gunakan checklist ini saat review code:

### Exception Type

- [ ] Apakah exception type merepresentasikan semantic failure?
- [ ] Apakah domain failure berbeda dari technical failure?
- [ ] Apakah invalid state berbeda dari validation error?
- [ ] Apakah dependency timeout berbeda dari dependency 4xx/5xx?
- [ ] Apakah invariant breach tidak disamakan dengan user error?

### Cause Chain

- [ ] Apakah wrapping menyimpan cause?
- [ ] Apakah root cause masih bisa dilihat?
- [ ] Apakah tidak ada wrapping tanpa value?
- [ ] Apakah async wrapper seperti `CompletionException` ditangani?

### Logging

- [ ] Apakah exception hanya di-log sekali di boundary yang tepat?
- [ ] Apakah log punya operation context?
- [ ] Apakah log tidak membocorkan secret/PII?
- [ ] Apakah expected business error tidak di-log sebagai incident error?

### API Mapping

- [ ] Apakah validation menjadi 400/422 sesuai contract?
- [ ] Apakah auth/authz menjadi 401/403?
- [ ] Apakah state conflict menjadi 409?
- [ ] Apakah dependency timeout menjadi 504?
- [ ] Apakah dependency unavailable menjadi 503?
- [ ] Apakah unexpected bug menjadi 500?

### Retryability

- [ ] Apakah exception bisa diklasifikasikan retryable/non-retryable?
- [ ] Apakah timeout tidak langsung dianggap failure pasti?
- [ ] Apakah retry hanya dilakukan untuk operasi idempotent?
- [ ] Apakah duplicate/conflict tidak diretry buta?

### Resource Safety

- [ ] Apakah resource memakai try-with-resources?
- [ ] Apakah close failure tidak menutupi primary failure?
- [ ] Apakah suppressed exception masih terlihat?
- [ ] Apakah cleanup tidak block tanpa batas?

### Transaction

- [ ] Apakah checked exception memicu rollback jika diperlukan?
- [ ] Apakah exception dilempar sebelum side effect external jika memungkinkan?
- [ ] Apakah commit-unknown case dimodelkan dengan jujur?

---

## 37. Review Questions

Jawab pertanyaan ini untuk menguji pemahaman:

1. Mengapa `catch (Exception e)` di controller advice bisa valid, tetapi di domain service sering buruk?
2. Apa perbedaan semantic antara `IllegalArgumentException`, validation exception, dan domain rule violation?
3. Kapan checked exception lebih cocok daripada unchecked exception?
4. Apa bahaya wrapping exception tanpa cause?
5. Apa suppressed exception dan mengapa penting untuk try-with-resources?
6. Mengapa timeout tidak selalu berarti operasi gagal?
7. Mengapa `catch (Throwable)` hampir selalu buruk di business code?
8. Bagaimana exception design memengaruhi transaction rollback?
9. Mengapa exception message internal dan API error message sebaiknya berbeda?
10. Apa bedanya not found pada query dan not found pada command?
11. Kapan result type lebih cocok daripada exception?
12. Bagaimana exception membantu retry classifier?
13. Apa yang membuat exception hierarchy terlalu granular?
14. Bagaimana cara menjaga error metrics agar tidak high-cardinality?
15. Mengapa invariant violation biasanya lebih serius daripada validation error?

---

## 38. Key Takeaways

1. Exception adalah control transfer plus diagnostic evidence.
2. Semua exception adalah `Throwable`, tetapi tidak semua `Throwable` layak ditangkap aplikasi.
3. Checked exception adalah compile-time contract; unchecked exception adalah runtime propagation tanpa mechanical handling requirement.
4. Checked vs unchecked bukan soal “serius atau tidak”, tetapi soal API contract dan recovery model.
5. Exception type harus membawa semantic signal.
6. Cause chain harus dipertahankan agar root cause tidak hilang.
7. Suppressed exception penting untuk cleanup/resource failure.
8. Broad catch hanya layak di boundary yang memang melakukan classification/translation.
9. Jangan swallow exception kecuali loss-nya disengaja, aman, terukur, dan terdokumentasi.
10. Log exception sekali, pada boundary yang tepat.
11. Exception design terkait langsung dengan API response, retry, transaction rollback, observability, dan incident response.
12. Timeout bisa berarti outcome unknown, bukan pasti failed.
13. Exception hierarchy harus mengikuti keputusan sistem, bukan hanya kategori teknis.
14. Return value, result type, dan exception masing-masing punya tempat.
15. Top-tier engineer menjaga makna failure agar tidak collapse menjadi “something failed”.

---

## 39. References

- Oracle Java SE 25 API — `Throwable`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Throwable.html
- Oracle Java SE 25 API — `Exception`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Exception.html
- Oracle Java SE 25 API — `RuntimeException`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/RuntimeException.html
- Oracle Java Language Specification SE 25 — Exceptions and try statements: https://docs.oracle.com/javase/specs/jls/se25/html/index.html
- Oracle Java Tutorial — Try-with-resources and suppressed exceptions: https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html

---

## 40. Status Seri

```text
Part 002 / 030 completed
Seri belum selesai.
```

Bagian berikutnya:

```text
Part 003 — Exception Taxonomy for Enterprise Systems
```
