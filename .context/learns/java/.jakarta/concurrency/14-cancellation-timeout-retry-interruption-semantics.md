# Part 14 — Cancellation, Timeout, Retry, and Interruption Semantics

Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
File: `14-cancellation-timeout-retry-interruption-semantics.md`  
Scope: Java 8–25, Java EE/Jakarta EE managed concurrency, Jakarta Batch, production enterprise workloads

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **cancellation**, **timeout**, **retry**, dan **interruption** sebagai konsep yang berbeda, bukan satu mekanisme yang sama.
2. Mendesain task asynchronous yang benar-benar bisa berhenti secara aman, bukan hanya “dibatalkan di level `Future`”.
3. Memahami konsekuensi `Future.cancel`, `CompletableFuture.cancel`, `Thread.interrupt`, transaction timeout, HTTP timeout, DB timeout, dan batch stop.
4. Mendesain retry yang tidak menciptakan retry storm, duplicate side effect, atau pelanggaran audit.
5. Membuat workload yang **timeout-aware**, **cancellation-aware**, **idempotent**, **observable**, dan **restartable**.
6. Menentukan kapan failure harus di-retry, di-skip, di-stop, di-dead-letter, atau di-compensate.
7. Menghubungkan model cancellation Java SE dengan Jakarta managed executor dan Jakarta Batch.

Bagian ini penting karena banyak sistem enterprise tampak sudah “punya async”, tetapi gagal ketika harus menghadapi realitas production:

- downstream lambat,
- DB lock menunggu terlalu lama,
- request dibatalkan user,
- job harus dihentikan operator,
- pod/container akan shutdown,
- external API mengembalikan 429,
- task tidak pernah selesai,
- retry menambah beban hingga sistem makin jatuh.

Top-tier engineer tidak hanya bisa menjalankan work secara parallel. Ia harus bisa menjawab:

> “Bagaimana pekerjaan ini berhenti, kapan harus berhenti, siapa yang berhak menghentikan, apa yang sudah berubah sebelum berhenti, dan apakah aman dijalankan ulang?”

---

## 2. Problem yang Diselesaikan

Dalam aplikasi enterprise, asynchronous work sering ditulis seperti ini:

```java
Future<?> future = executor.submit(() -> {
    callExternalApi();
    updateDatabase();
});
```

Atau:

```java
CompletableFuture
    .supplyAsync(() -> fetchData(), executor)
    .thenApply(this::transform)
    .thenAccept(this::save);
```

Sekilas terlihat benar. Tetapi pertanyaan production-nya jauh lebih keras:

1. Apa yang terjadi jika `fetchData()` hang selama 10 menit?
2. Apa yang terjadi jika user membatalkan request?
3. Apa yang terjadi jika operator ingin menghentikan job?
4. Apa yang terjadi jika task sedang menulis 10.000 record dan berhenti di record ke-6.212?
5. Apa yang terjadi jika `Future.cancel(true)` dipanggil?
6. Apakah thread benar-benar berhenti?
7. Apakah database transaction ikut rollback?
8. Apakah external API call ikut abort?
9. Apakah retry akan membuat duplicate email, duplicate payment, duplicate case escalation, atau duplicate audit log?
10. Apakah sistem punya evidence kenapa task dihentikan?

Bagian ini menyelesaikan problem tersebut dengan mental model:

> Cancellation adalah sinyal. Timeout adalah deadline. Retry adalah policy. Interruption adalah salah satu mekanisme kooperatif di level thread. Restartability adalah desain state. Idempotency adalah perlindungan terhadap eksekusi ulang.

---

## 3. Mental Model Utama

### 3.1 Cancellation bukan pembunuhan paksa

Banyak developer mengira `cancel(true)` berarti “matikan task sekarang”. Itu salah.

Di Java, cancellation umumnya bersifat **cooperative**:

1. Satu pihak memberi sinyal bahwa pekerjaan tidak lagi diperlukan.
2. Task harus secara berkala memeriksa sinyal tersebut.
3. Task harus berhenti di titik aman.
4. Task harus membersihkan resource.
5. Task harus melaporkan status akhir.

Dengan kata lain:

> Cancellation tidak menghentikan kode yang tidak mau berhenti.

Jika task sedang:

- blocked di socket read tanpa timeout,
- menunggu DB query tanpa query timeout,
- memegang lock tanpa timeout,
- looping CPU tanpa check interruption,
- memanggil library yang mengabaikan interruption,

maka cancellation bisa gagal secara praktis.

---

### 3.2 Timeout bukan cancellation lengkap

Timeout menjawab:

> “Berapa lama caller bersedia menunggu?”

Tetapi timeout belum tentu menjawab:

> “Apakah pekerjaan di belakang benar-benar dihentikan?”

Contoh:

```java
CompletableFuture<String> result = CompletableFuture
    .supplyAsync(this::slowOperation, executor)
    .orTimeout(3, TimeUnit.SECONDS);
```

Jika timeout terjadi, `CompletableFuture` bisa completed exceptionally. Tetapi underlying work bisa saja masih berjalan, tergantung bagaimana task dibuat dan apakah ada cancellation path yang benar.

Timeout punya beberapa level:

| Level | Contoh | Tujuan |
|---|---|---|
| Caller wait timeout | `future.get(3, SECONDS)` | Caller berhenti menunggu |
| Future completion timeout | `orTimeout` | Future dianggap gagal |
| Task deadline | explicit deadline object | Task berhenti sendiri |
| HTTP client timeout | connect/read/request timeout | I/O tidak hang |
| DB query timeout | JDBC/query timeout | query tidak menunggu selamanya |
| Transaction timeout | JTA timeout | transaksi tidak hidup terlalu lama |
| Batch step timeout | custom policy/operator stop | job berhenti di checkpoint aman |

Top-tier design biasanya menggabungkan beberapa layer timeout, bukan hanya satu.

---

### 3.3 Retry bukan recovery universal

Retry hanya benar jika failure kemungkinan **transient** dan operasi aman diulang.

Retry salah jika:

- error bersifat validasi permanen,
- data business memang invalid,
- external side effect sudah terjadi tetapi response hilang,
- sistem downstream overload dan retry menambah tekanan,
- operasi tidak idempotent,
- retry dilakukan oleh banyak layer sekaligus tanpa koordinasi.

Mental model:

> Retry adalah amplifier. Ia bisa memperbesar reliability, tetapi juga bisa memperbesar outage.

---

### 3.4 Interruption adalah sinyal level thread, bukan exception bisnis

`Thread.interrupt()` mengatur interrupt flag pada thread. Banyak blocking API Java merespons interrupt dengan `InterruptedException`. Tetapi tidak semua operasi merespons interruption.

Prinsip penting:

1. Jangan menelan `InterruptedException` diam-diam.
2. Restore interrupt flag jika tidak bisa langsung berhenti.
3. Perlakukan interruption sebagai sinyal lifecycle/cancellation, bukan error bisnis biasa.
4. Pastikan cleanup idempotent.

Contoh buruk:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    // BAD: interrupt signal hilang
}
```

Contoh lebih benar:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new TaskCancelledException("Task interrupted", e);
}
```

---

## 4. Peta Konsep

```text
+-----------------------+
| Caller / Operator     |
| request timeout       |
| user cancel           |
| admin stop            |
+-----------+-----------+
            |
            v
+-----------------------+
| Cancellation Policy   |
| - reason              |
| - deadline            |
| - force? no/limited   |
| - audit               |
+-----------+-----------+
            |
            v
+-----------------------+
| Task Execution        |
| ManagedExecutorService|
| CompletableFuture     |
| Jakarta Batch Step    |
+-----------+-----------+
            |
            v
+-----------------------+
| Cooperative Points    |
| - check cancelled     |
| - check deadline      |
| - interrupt aware     |
| - I/O timeout         |
| - DB timeout          |
+-----------+-----------+
            |
            v
+-----------------------+
| Safe Stop Boundary    |
| - transaction rollback|
| - checkpoint          |
| - idempotent state    |
| - cleanup             |
+-----------------------+
```

---

## 5. Vocabulary yang Harus Presisi

### 5.1 Cancellation

Cancellation adalah permintaan agar pekerjaan berhenti karena hasilnya tidak lagi dibutuhkan atau pekerjaan tidak boleh dilanjutkan.

Contoh alasan:

- user membatalkan request,
- admin menghentikan job,
- deadline habis,
- application shutdown,
- parent task gagal,
- workload kalah prioritas,
- tenant quota habis,
- duplicate job terdeteksi.

Cancellation sebaiknya membawa **reason**:

```java
public enum CancellationReason {
    USER_CANCELLED,
    DEADLINE_EXCEEDED,
    ADMIN_STOP,
    SHUTDOWN,
    PARENT_FAILED,
    DUPLICATE_REQUEST,
    QUOTA_EXCEEDED
}
```

Tanpa reason, audit dan diagnosis menjadi lemah.

---

### 5.2 Timeout

Timeout adalah batas waktu. Ada dua bentuk:

1. **Duration-based timeout**: “maksimal 5 detik dari sekarang”.
2. **Absolute deadline**: “harus selesai sebelum 10:00:00 UTC”.

Untuk sistem kompleks, deadline biasanya lebih baik daripada duration karena bisa diwariskan antar layer.

Contoh:

```text
Request received at 10:00:00
Overall SLA: 5s
DB budget: 1s
External API budget: 2s
Transform budget: 500ms
Response safety margin: 500ms
```

Jika setiap layer memakai timeout 5 detik sendiri-sendiri, total latency bisa jauh melebihi SLA.

---

### 5.3 Retry

Retry adalah percobaan ulang setelah failure.

Retry policy minimal harus mendefinisikan:

- exception/status apa yang retryable,
- maksimum attempt,
- delay/backoff,
- jitter,
- deadline total,
- idempotency requirement,
- observability event,
- escalation setelah gagal.

---

### 5.4 Interruption

Interruption adalah mekanisme Java untuk memberi sinyal ke thread.

Karakteristik:

- bukan forced kill,
- flag bisa dicek dengan `Thread.currentThread().isInterrupted()`,
- beberapa blocking method melempar `InterruptedException`,
- interrupt flag bisa clear ketika `InterruptedException` dilempar,
- harus di-handle secara disiplin.

---

### 5.5 Stop

Dalam Jakarta Batch, `stop` adalah permintaan ke runtime/job agar eksekusi berhenti. Stop bukan berarti proses langsung mati di instruksi saat itu juga. Job/step harus mencapai titik aman sesuai model batch, listener, checkpoint, dan implementasi artifact.

---

### 5.6 Abort, Abandon, Fail, Skip, Dead-letter

| Istilah | Makna |
|---|---|
| Abort | Menghentikan secara keras/cepat, sering tanpa clean business completion |
| Fail | Menandai execution gagal |
| Stop | Menghentikan dengan kemungkinan restart |
| Abandon | Menandai execution tidak akan direstart |
| Skip | Melewati item bermasalah dan lanjut |
| Dead-letter | Memindahkan work item gagal ke tempat investigasi/reprocessing |
| Compensate | Membuat aksi pembalik/penyeimbang setelah side effect terjadi |

---

## 6. Java SE Cancellation Semantics

### 6.1 `Future.cancel(boolean mayInterruptIfRunning)`

`Future.cancel` punya kontrak penting:

```java
boolean cancelled = future.cancel(true);
```

Parameter:

- `false`: jika task belum mulai, boleh dicegah agar tidak dijalankan; jika sudah running, tidak diinterrupt.
- `true`: jika task sudah running, executor boleh mencoba menginterrupt thread yang menjalankan task.

Tetapi:

- return `true` berarti cancellation request diterima pada level `Future`, bukan berarti task sudah berhenti total.
- interrupt hanya efektif jika task/libraries merespons interrupt.
- jika task sudah selesai, cancellation gagal.
- jika task sedang melakukan blocking call yang tidak interruptible, task bisa tetap berjalan.

Mental model:

```text
Future.cancel(true)
        |
        v
Future state may become cancelled
        |
        v
Thread may be interrupted
        |
        v
Task may or may not stop depending on code
```

---

### 6.2 Cancellation-aware `Callable`

Contoh buruk:

```java
public Integer processAll(List<Record> records) {
    int count = 0;
    for (Record record : records) {
        process(record);
        count++;
    }
    return count;
}
```

Kode ini tidak punya titik berhenti kooperatif.

Contoh lebih baik:

```java
public Integer processAll(List<Record> records) {
    int count = 0;

    for (Record record : records) {
        if (Thread.currentThread().isInterrupted()) {
            throw new TaskCancelledException("Interrupted before record " + record.id());
        }

        process(record);
        count++;
    }

    return count;
}
```

Lebih baik lagi, gunakan explicit cancellation token agar cancellation tidak bergantung hanya pada interrupt:

```java
public final class CancellationToken {
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private volatile String reason;

    public void cancel(String reason) {
        this.reason = reason;
        this.cancelled.set(true);
    }

    public boolean isCancelled() {
        return cancelled.get();
    }

    public String reason() {
        return reason;
    }

    public void throwIfCancelled() {
        if (isCancelled()) {
            throw new TaskCancelledException(reason);
        }
    }
}
```

Task:

```java
public Integer processAll(List<Record> records, CancellationToken token) {
    int count = 0;

    for (Record record : records) {
        token.throwIfCancelled();

        if (Thread.currentThread().isInterrupted()) {
            token.cancel("Thread interrupted");
            token.throwIfCancelled();
        }

        process(record);
        count++;
    }

    return count;
}
```

Mengapa token berguna?

- Bisa membawa reason.
- Bisa dicek oleh banyak komponen tanpa bergantung pada thread tertentu.
- Cocok untuk structured work tree.
- Cocok untuk batch artifact yang perlu flag business-level.
- Cocok untuk shutdown hook/application lifecycle.

---

### 6.3 Jangan bergantung pada `Thread.stop`

`Thread.stop` secara historis berbahaya karena bisa membunuh thread ketika sedang memegang lock atau sedang memodifikasi state, sehingga invariant object rusak. Untuk desain modern, forced thread kill bukan solusi normal.

Prinsip:

> Jika satu-satunya cara menghentikan task adalah membunuh thread secara paksa, desain task tersebut belum production-grade.

---

## 7. Interruption Semantics Mendalam

### 7.1 Interrupt flag

Setiap thread punya interrupt status.

```java
Thread.currentThread().interrupt();
boolean interrupted = Thread.currentThread().isInterrupted();
```

Beberapa method blocking seperti `Thread.sleep`, `Object.wait`, dan sebagian operasi blocking queue akan melempar `InterruptedException` ketika thread diinterrupt.

Setelah `InterruptedException`, interrupt status sering sudah clear. Maka jika caller lebih atas perlu tahu bahwa thread diinterrupt, restore flag:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new TaskCancelledException("Interrupted", e);
}
```

---

### 7.2 Kapan restore interrupt flag?

Restore interrupt flag jika:

- method tidak bisa melempar `InterruptedException` karena signature tidak memungkinkan,
- kamu membungkusnya menjadi runtime exception,
- layer lebih atas perlu membaca status interrupted,
- kamu akan keluar dari task tetapi ingin executor/container tahu bahwa thread pernah diinterrupt.

Contoh:

```java
public void waitForPermit(Semaphore semaphore) {
    try {
        semaphore.acquire();
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new TaskCancelledException("Interrupted while waiting for permit", e);
    }
}
```

---

### 7.3 Kapan tidak cukup hanya restore?

Restore interrupt flag saja tidak cukup jika task harus melakukan cleanup business.

Contoh:

```java
public void exportFile(JobContext ctx) {
    Path temp = createTempFile();
    try {
        writeLargeFile(temp);
        moveAtomically(temp, finalPath);
    } catch (TaskCancelledException e) {
        deleteQuietly(temp);
        throw e;
    }
}
```

Jika cancellation terjadi, kamu perlu:

- hapus temporary file,
- rollback transaction,
- release lock,
- update job status,
- kirim audit event,
- jangan publish file partial.

---

### 7.4 Interruption dan blocking I/O

Tidak semua blocking I/O responsif terhadap interruption. Untuk I/O, lebih aman gunakan timeout eksplisit:

- HTTP connect timeout,
- HTTP read/response timeout,
- JDBC query timeout,
- socket timeout,
- lock timeout,
- pool acquisition timeout.

Interruption adalah sinyal tambahan, bukan pengganti timeout I/O.

---

## 8. Timeout Design

### 8.1 Timeout harus berlapis

Sistem enterprise biasanya membutuhkan timeout pada beberapa layer:

```text
Browser/client timeout
  -> API gateway timeout
    -> Servlet/JAX-RS request timeout
      -> Application service deadline
        -> Executor task timeout
          -> DB pool acquisition timeout
          -> DB query timeout
          -> HTTP client timeout
          -> Transaction timeout
```

Jika hanya layer atas yang punya timeout, work di layer bawah bisa tetap berjalan dan membakar resource.

---

### 8.2 Timeout budget

Jangan set timeout secara random.

Gunakan budget:

```text
Endpoint SLA: 3 seconds
- auth/context setup: 100ms
- DB read: 500ms
- external API: 1200ms
- transform: 300ms
- DB write: 500ms
- safety margin: 400ms
```

Jika external API sudah memakai 1.1 detik, DB write tidak boleh tetap diberi timeout 2 detik penuh jika SLA endpoint tinggal 400ms.

Gunakan deadline absolut:

```java
public final class Deadline {
    private final Instant expiresAt;

    public Deadline(Instant expiresAt) {
        this.expiresAt = Objects.requireNonNull(expiresAt);
    }

    public static Deadline after(Duration duration) {
        return new Deadline(Instant.now().plus(duration));
    }

    public Duration remaining() {
        Duration remaining = Duration.between(Instant.now(), expiresAt);
        return remaining.isNegative() ? Duration.ZERO : remaining;
    }

    public boolean expired() {
        return !Instant.now().isBefore(expiresAt);
    }

    public void throwIfExpired() {
        if (expired()) {
            throw new DeadlineExceededException("Deadline exceeded at " + expiresAt);
        }
    }
}
```

Usage:

```java
Deadline deadline = Deadline.after(Duration.ofSeconds(3));

String data = externalClient.fetch(input, deadline.remaining());
deadline.throwIfExpired();
repository.save(result, deadline.remaining());
```

---

### 8.3 `Future.get(timeout)`

```java
try {
    Result result = future.get(3, TimeUnit.SECONDS);
} catch (TimeoutException e) {
    future.cancel(true);
    throw new DeadlineExceededException("Task exceeded 3 seconds", e);
}
```

Perhatikan:

- `get(timeout)` hanya membatasi caller menunggu.
- Perlu `future.cancel(true)` jika ingin memberi sinyal cancellation.
- Task tetap harus interruption-aware.
- Downstream I/O tetap butuh timeout sendiri.

---

### 8.4 `CompletableFuture.orTimeout` dan `completeOnTimeout`

Modern Java menyediakan timeout composition pada `CompletableFuture`:

```java
CompletableFuture<Result> future = CompletableFuture
    .supplyAsync(() -> callService(), executor)
    .orTimeout(3, TimeUnit.SECONDS);
```

`orTimeout` membuat future complete exceptionally jika timeout.

```java
CompletableFuture<Result> future = CompletableFuture
    .supplyAsync(() -> callService(), executor)
    .completeOnTimeout(Result.fallback(), 3, TimeUnit.SECONDS);
```

`completeOnTimeout` memberi fallback value.

Tetapi jangan lupa:

- completion timeout bukan jaminan underlying supplier berhenti,
- fallback bisa menyembunyikan failure jika tidak diaudit,
- timeout chain harus tetap terhubung ke cancellation token atau cancel handle.

---

### 8.5 Timeout tidak boleh membuat side effect ambigu

Contoh:

```java
PaymentResponse response = paymentClient.charge(request, timeout);
```

Jika timeout terjadi, ada tiga kemungkinan:

1. request tidak pernah sampai,
2. request sampai dan gagal,
3. request sampai, sukses, tetapi response hilang.

Untuk operasi side effect eksternal, timeout tidak boleh langsung diartikan “belum terjadi”.

Solusi:

- gunakan idempotency key,
- simpan operation request durable,
- lakukan reconciliation,
- gunakan status query,
- jangan retry buta tanpa key.

---

## 9. Retry Taxonomy

### 9.1 Klasifikasi failure

| Failure | Contoh | Retry? |
|---|---|---|
| Transient network | connection reset, temporary DNS issue | Ya, terbatas |
| Downstream overload | 429, 503 | Ya, dengan backoff dan respect `Retry-After` |
| Timeout ambiguous | response tidak diterima | Hati-hati, butuh idempotency/reconciliation |
| Validation error | invalid field, bad format | Tidak |
| Authorization error | 403 | Biasanya tidak |
| Authentication expired | 401 token expired | Refresh token lalu retry terbatas |
| Optimistic conflict | version mismatch | Tergantung use case |
| Deadlock/serialization failure | DB deadlock | Ya, terbatas |
| Unique constraint duplicate | duplicate idempotency key | Bukan retry; resolve state |
| Poison message/record | data selalu gagal diproses | Skip/dead-letter |
| Bug | NullPointerException karena kode | Tidak, fail fast |

---

### 9.2 Retry harus punya deadline total

Buruk:

```java
for (int i = 0; i < 5; i++) {
    try {
        return call();
    } catch (Exception e) {
        Thread.sleep(1000);
    }
}
```

Masalah:

- tidak check cancellation,
- tidak ada jitter,
- tidak ada klasifikasi exception,
- tidak ada deadline total,
- semua error dianggap sama,
- menelan interruption.

Lebih baik:

```java
public <T> T retry(
        Callable<T> operation,
        RetryPolicy policy,
        Deadline deadline,
        CancellationToken token) {

    int attempt = 0;
    Throwable last = null;

    while (attempt < policy.maxAttempts()) {
        token.throwIfCancelled();
        deadline.throwIfExpired();
        attempt++;

        try {
            return operation.call();
        } catch (Throwable t) {
            last = t;

            if (!policy.isRetryable(t)) {
                throw propagate(t);
            }

            if (attempt >= policy.maxAttempts()) {
                break;
            }

            Duration delay = policy.delayForAttempt(attempt);
            sleepInterruptibly(min(delay, deadline.remaining()), token);
        }
    }

    throw new RetryExhaustedException("Retry exhausted after " + attempt + " attempts", last);
}
```

Sleep helper:

```java
private void sleepInterruptibly(Duration delay, CancellationToken token) {
    long millis = delay.toMillis();
    long end = System.currentTimeMillis() + millis;

    while (System.currentTimeMillis() < end) {
        token.throwIfCancelled();
        long remaining = end - System.currentTimeMillis();
        try {
            Thread.sleep(Math.min(remaining, 200));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new TaskCancelledException("Interrupted during retry backoff", e);
        }
    }
}
```

---

### 9.3 Exponential backoff + jitter

Tanpa jitter, semua caller bisa retry pada waktu yang sama.

```text
t=0s      all fail
t=1s      all retry
t=3s      all retry
t=7s      all retry
```

Ini menciptakan retry wave.

Gunakan jitter:

```java
public Duration delayForAttempt(int attempt) {
    long baseMillis = 200L;
    long maxMillis = 5_000L;

    long exponential = Math.min(maxMillis, baseMillis * (1L << Math.min(attempt - 1, 10)));
    long jitter = ThreadLocalRandom.current().nextLong(0, exponential + 1);

    return Duration.ofMillis(jitter);
}
```

Jenis jitter:

| Strategy | Karakteristik |
|---|---|
| Fixed delay | sederhana, rawan sync wave |
| Exponential backoff | mengurangi tekanan bertahap |
| Full jitter | delay random 0..backoff |
| Equal jitter | separuh delay tetap + random separuh |
| Decorrelated jitter | bagus untuk long-lived retry streams |

---

### 9.4 Layered retry problem

Retry bisa ada di:

- HTTP client,
- service method,
- message consumer,
- batch step,
- database driver,
- API gateway,
- load balancer,
- Kubernetes probe/restart,
- operator rerun.

Jika semua layer retry 3 kali, total attempt bisa meledak:

```text
3 HTTP client retries
x 3 service retries
x 3 batch retries
= 27 downstream calls
```

Prinsip:

> Satu operation harus punya satu retry owner yang jelas.

Layer lain boleh punya very small retry untuk transport glitch, tetapi business retry harus terpusat.

---

## 10. Jakarta Concurrency Perspective

### 10.1 Managed executor tidak menghapus tanggung jawab cancellation

`ManagedExecutorService` menyediakan executor yang dikelola container. Tetapi logic task tetap harus cancellation-aware.

Contoh:

```java
@Resource
ManagedExecutorService executor;

public Future<ImportSummary> startImport(ImportRequest request) {
    CancellationToken token = new CancellationToken();

    return executor.submit(() -> importService.importData(request, token));
}
```

Masalah: caller tidak punya akses ke token.

Lebih baik buat handle:

```java
public final class TaskHandle<T> {
    private final Future<T> future;
    private final CancellationToken token;

    public TaskHandle(Future<T> future, CancellationToken token) {
        this.future = future;
        this.token = token;
    }

    public void cancel(String reason) {
        token.cancel(reason);
        future.cancel(true);
    }

    public boolean isDone() {
        return future.isDone();
    }

    public T get(Duration timeout) throws Exception {
        return future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
    }
}
```

Service:

```java
public TaskHandle<ImportSummary> startImport(ImportRequest request) {
    CancellationToken token = new CancellationToken();

    Future<ImportSummary> future = executor.submit(() -> {
        return importService.importData(request, token);
    });

    return new TaskHandle<>(future, token);
}
```

---

### 10.2 Rejection is also a control signal

Cancellation dan timeout sering dibahas setelah task diterima. Tetapi task juga bisa ditolak sejak awal jika kapasitas tidak tersedia.

```java
try {
    Future<?> future = executor.submit(task);
} catch (RejectedExecutionException e) {
    throw new ServiceUnavailableException("Async capacity exhausted", e);
}
```

Dalam container, detail rejection bisa bergantung konfigurasi executor vendor/server. Tetapi secara desain, rejection harus diperlakukan sebagai sinyal backpressure:

- jangan retry tight loop,
- jangan fallback ke unmanaged thread,
- jangan masukkan queue lain tanpa limit,
- return 503/429 untuk request interactive,
- persist job request untuk background durable workload.

---

### 10.3 Shutdown cancellation

Saat application shutdown/redeploy, container harus mengelola lifecycle resource. Tetapi application task tetap harus bisa berhenti cepat.

Checklist task shutdown-aware:

- loop check cancellation/interruption,
- I/O punya timeout pendek/terbatas,
- lock acquisition punya timeout,
- batch step punya checkpoint,
- temporary resource dibersihkan,
- status update atomic,
- long retry sleep bisa dibangunkan oleh interrupt,
- tidak membuat unmanaged thread baru.

---

## 11. `CompletableFuture` Cancellation Semantics

### 11.1 `CompletableFuture.cancel`

`CompletableFuture.cancel` menyelesaikan future dengan `CancellationException` jika belum selesai. Dependent stages yang belum selesai juga dapat complete exceptionally.

Tetapi ada jebakan besar:

> `CompletableFuture` adalah completion abstraction. Ia tidak selalu punya kendali langsung atas task fisik yang sedang berjalan.

Contoh:

```java
CompletableFuture<Result> cf = CompletableFuture.supplyAsync(() -> slowCall(), executor);
cf.cancel(true);
```

Untuk `CompletableFuture`, parameter `mayInterruptIfRunning` tidak selalu memberi efek yang sama seperti `FutureTask` biasa. Karena itu, jangan mengandalkan `CompletableFuture.cancel(true)` sebagai satu-satunya mekanisme menghentikan underlying operation.

Gunakan explicit cancellation token:

```java
CancellationToken token = new CancellationToken();

CompletableFuture<Result> cf = CompletableFuture
    .supplyAsync(() -> service.call(token), executor)
    .orTimeout(3, TimeUnit.SECONDS)
    .whenComplete((result, error) -> {
        if (error != null) {
            token.cancel("CompletableFuture completed with error: " + error.getClass().getSimpleName());
        }
    });
```

---

### 11.2 Timeout pada chain tidak otomatis menghentikan semua branch

Fan-out:

```java
CompletableFuture<A> a = CompletableFuture.supplyAsync(this::loadA, executor);
CompletableFuture<B> b = CompletableFuture.supplyAsync(this::loadB, executor);
CompletableFuture<C> c = CompletableFuture.supplyAsync(this::loadC, executor);

CompletableFuture<Result> result = CompletableFuture
    .allOf(a, b, c)
    .thenApply(v -> combine(a.join(), b.join(), c.join()))
    .orTimeout(2, TimeUnit.SECONDS);
```

Jika `result` timeout, branch `a`, `b`, `c` tidak otomatis berhenti dengan benar.

Lebih baik:

```java
CancellationToken token = new CancellationToken();
Deadline deadline = Deadline.after(Duration.ofSeconds(2));

CompletableFuture<A> a = CompletableFuture.supplyAsync(() -> loadA(token, deadline), executor);
CompletableFuture<B> b = CompletableFuture.supplyAsync(() -> loadB(token, deadline), executor);
CompletableFuture<C> c = CompletableFuture.supplyAsync(() -> loadC(token, deadline), executor);

CompletableFuture<Result> result = CompletableFuture
    .allOf(a, b, c)
    .thenApply(v -> combine(a.join(), b.join(), c.join()))
    .orTimeout(2, TimeUnit.SECONDS)
    .whenComplete((r, e) -> {
        if (e != null) {
            token.cancel("Parent future failed or timed out");
            a.cancel(true);
            b.cancel(true);
            c.cancel(true);
        }
    });
```

---

### 11.3 Partial result policy

Ketika fan-out sebagian gagal, jangan otomatis pilih satu pola. Tentukan policy:

| Policy | Cocok untuk |
|---|---|
| Fail-fast | data harus konsisten lengkap |
| Best-effort | dashboard, enrichment opsional |
| Fallback | reference data/cache tersedia |
| Partial response | UI bisa menampilkan incomplete state |
| Defer/retry async | operation bisa selesai belakangan |
| Compensate | side effect sudah sebagian terjadi |

Contoh regulatory system:

- case escalation decision: **fail-fast** jika data wajib tidak lengkap.
- UI enrichment nama/alamat: mungkin **partial/fallback**.
- external notification: bisa **outbox + retry async**.
- enforcement status update: harus **transactional/idempotent**.

---

## 12. Jakarta Batch Stop, Restart, and Timeout Thinking

### 12.1 Batch stop bukan sama dengan interrupt thread

Jakarta Batch punya runtime lifecycle. Operator dapat menghentikan job execution melalui `JobOperator.stop(executionId)`. Tetapi artifact batch harus didesain agar bisa mencapai titik berhenti aman.

Pada chunk-oriented step, titik aman biasanya berkaitan dengan checkpoint/commit boundary.

Mental model:

```text
stop requested
   -> runtime marks stopping intent
   -> current unit/chunk may complete or fail
   -> checkpoint/status updated
   -> execution becomes STOPPED/FAILED depending condition
   -> restart can continue from checkpoint if supported
```

---

### 12.2 Batchlet stop

Batchlet punya method `stop()`.

Contoh desain:

```java
@Named
public class ReportGenerationBatchlet extends AbstractBatchlet {

    private final AtomicBoolean stopRequested = new AtomicBoolean(false);

    @Override
    public String process() throws Exception {
        for (ReportSection section : sections()) {
            if (stopRequested.get()) {
                return "STOPPED";
            }

            generate(section);
        }
        return "COMPLETED";
    }

    @Override
    public void stop() throws Exception {
        stopRequested.set(true);
    }
}
```

Tetapi ini masih belum cukup jika `generate(section)` bisa hang. Maka `generate` juga harus timeout-aware.

---

### 12.3 Chunk stop dan checkpoint

Chunk processing lebih natural untuk stop/restart karena runtime punya checkpoint boundary.

Tetapi kamu tetap harus memastikan:

- reader menyimpan posisi aman,
- writer idempotent,
- processor tidak menyimpan state volatile yang tidak bisa direkonstruksi,
- commit interval tidak terlalu besar,
- side effect eksternal tidak dilakukan sembarangan di processor,
- stop tidak membuat output partial yang dianggap final.

---

### 12.4 Batch timeout policy

Jakarta Batch tidak otomatis menyelesaikan semua problem timeout bisnis. Kamu bisa menambahkan policy:

- max job duration,
- max step duration,
- max item processing duration,
- max retry duration,
- no-progress timeout,
- external call timeout.

Contoh no-progress:

```text
If processed_count does not increase for 10 minutes,
mark step as suspected stuck and alert operator.
```

No-progress timeout sering lebih berguna daripada total duration karena batch besar memang bisa lama, tetapi tidak boleh diam tanpa progress.

---

## 13. Transaction Timeout

### 13.1 Transaction timeout bukan task timeout

Transaction timeout berarti transaksi tidak boleh berjalan melebihi batas tertentu. Jika timeout terjadi, transaction manager bisa menandai transaksi rollback-only.

Tetapi:

- task bisa tetap berjalan setelah transaksi rollback-only,
- code bisa baru tahu saat commit,
- external side effect di luar DB tidak otomatis rollback,
- long transaction bisa menahan lock dan undo/redo resource.

Prinsip:

> Jangan gunakan transaction timeout sebagai satu-satunya mekanisme menghentikan task.

---

### 13.2 Layer timeout untuk DB work

Untuk DB-heavy async/batch:

1. pool acquisition timeout,
2. query timeout,
3. lock timeout,
4. transaction timeout,
5. task deadline,
6. batch checkpoint.

Contoh masalah:

```text
Task timeout: 10s
Transaction timeout: 60s
JDBC query timeout: none
```

Jika query hang 2 menit, task timeout di layer Java tidak cukup jika thread stuck di driver/query. Query timeout harus diset sesuai budget.

---

### 13.3 Commit interval dan timeout

Dalam chunk batch:

```text
commit interval = 1000 items
average item = 100ms
chunk duration ≈ 100 seconds
transaction timeout = 60 seconds
```

Ini hampir pasti bermasalah.

Tuning harus mempertimbangkan:

- rata-rata item duration,
- p95/p99 item duration,
- DB lock behavior,
- transaction timeout,
- memory footprint,
- restart cost,
- duplicate/replay risk.

---

## 14. HTTP/API Timeout and Cancellation

### 14.1 Timeout harus eksplisit

Untuk external API:

- connect timeout,
- TLS handshake timeout jika tersedia,
- request timeout,
- response/read timeout,
- pool acquisition timeout,
- total deadline.

Jangan biarkan default library menentukan nasib production.

---

### 14.2 Respect `Retry-After`

Jika downstream mengembalikan 429/503 dengan `Retry-After`, retry policy harus mempertimbangkannya.

Pseudo:

```java
if (response.statusCode() == 429 || response.statusCode() == 503) {
    Optional<Duration> retryAfter = parseRetryAfter(response);
    Duration delay = retryAfter.orElse(policy.delayForAttempt(attempt));
    sleepInterruptibly(delayWithJitter(delay), token);
}
```

Tetapi tetap batasi:

- max delay,
- max total deadline,
- max attempts,
- tenant quota,
- global concurrency.

---

### 14.3 Ambiguous timeout with side effect

Contoh external notification:

```text
POST /send-email
-> client timeout after 2s
```

Email mungkin sudah terkirim. Jika retry tanpa idempotency, user bisa menerima email ganda.

Solusi:

- client-generated idempotency key,
- deduplication table,
- outbox event ID,
- status query,
- exactly-once tidak diasumsikan.

---

## 15. Database Retry and Lock Handling

### 15.1 Retryable DB errors

Beberapa error database bisa transient:

- deadlock detected,
- serialization failure,
- lock timeout,
- connection lost,
- failover event,
- temporary resource unavailable.

Tetapi jangan retry semua `SQLException`.

Klasifikasi harus berbasis:

- SQLState,
- vendor error code,
- operation type,
- idempotency,
- transaction state,
- business consequence.

---

### 15.2 Retrying transaction block

Jika transaction gagal karena deadlock, retry harus mengulang **seluruh transaction unit**, bukan melanjutkan dari tengah.

Buruk:

```java
try {
    repo.updateA();
    repo.updateB();
} catch (DeadlockException e) {
    repo.updateB(); // BAD: transaction state ambigu
}
```

Lebih benar:

```java
retry(() -> transactionalService.performWholeUnit(command), policy, deadline, token);
```

Unit transaksi harus deterministic dan idempotent.

---

### 15.3 Lock timeout bukan selalu failure teknis

Dalam domain case management, lock timeout bisa berarti:

- case sedang diedit user lain,
- escalation sedang dihitung job lain,
- approval sedang berjalan,
- duplicate process mencoba mengubah state yang sama.

Jadi response-nya bisa:

- retry pendek,
- defer,
- skip item untuk batch berikutnya,
- mark conflict,
- alert jika repeated.

---

## 16. Idempotency sebagai Syarat Retry

### 16.1 Idempotency definition

Operasi idempotent berarti eksekusi ulang dengan input/logical key yang sama menghasilkan efek akhir yang sama, bukan efek tambahan.

Contoh:

```text
set case status to ESCALATED with transitionId=T123
```

lebih idempotent daripada:

```text
insert new escalation event every time method called
```

---

### 16.2 Idempotency key

Untuk side effect:

```java
public record ExternalCommand(
    String idempotencyKey,
    String targetSystem,
    String operationType,
    String payloadHash
) {}
```

DB table:

```sql
CREATE TABLE external_operation_dedup (
    idempotency_key VARCHAR(100) PRIMARY KEY,
    operation_type   VARCHAR(50) NOT NULL,
    payload_hash     VARCHAR(128) NOT NULL,
    status           VARCHAR(30) NOT NULL,
    response_ref      VARCHAR(200),
    created_at        TIMESTAMP NOT NULL,
    updated_at        TIMESTAMP NOT NULL
);
```

Flow:

```text
1. Generate stable idempotency key.
2. Insert operation record if absent.
3. If exists with same payload hash, resume/check status.
4. If exists with different payload hash, reject as conflict.
5. Execute external operation.
6. Store result.
7. Retry can safely resume.
```

---

### 16.3 Idempotent writer in batch

Batch writer should be safe across restart:

```java
@Named
public class CaseEscalationWriter extends AbstractItemWriter {

    @Inject
    CaseEscalationRepository repository;

    @Override
    public void writeItems(List<Object> items) {
        for (Object item : items) {
            EscalationCommand command = (EscalationCommand) item;
            repository.upsertEscalation(command.transitionId(), command.caseId(), command.reason());
        }
    }
}
```

Instead of blind insert:

```java
repository.insertEscalation(caseId, reason); // duplicate risk
```

---

## 17. Cancellation-safe Resource Management

### 17.1 Resource cleanup must be deterministic

Task bisa dibatalkan di banyak titik. Maka resource harus dikelola dengan `try/finally` atau structured resource block.

```java
public void processFile(Path source, CancellationToken token) {
    Path temp = createTempPath(source);
    boolean published = false;

    try {
        token.throwIfCancelled();
        transform(source, temp, token);
        token.throwIfCancelled();
        publishAtomically(temp, finalPath(source));
        published = true;
    } finally {
        if (!published) {
            deleteQuietly(temp);
        }
    }
}
```

---

### 17.2 Lock handling

```java
Lock lock = lockRegistry.lock(key);
boolean acquired = false;
try {
    acquired = lock.tryLock(deadline.remaining().toMillis(), TimeUnit.MILLISECONDS);
    if (!acquired) {
        throw new LockUnavailableException(key);
    }
    doWork();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new TaskCancelledException("Interrupted while acquiring lock", e);
} finally {
    if (acquired) {
        lock.unlock();
    }
}
```

Never:

- acquire lock without timeout in cancellable task,
- sleep forever while holding lock,
- call remote API while holding DB lock unless unavoidable,
- retry lock acquisition aggressively.

---

## 18. Designing Cancellable Loops

### 18.1 CPU loop

```java
for (int i = 0; i < items.size(); i++) {
    if ((i & 0xFF) == 0) { // every 256 items
        token.throwIfCancelled();
        if (Thread.currentThread().isInterrupted()) {
            throw new TaskCancelledException("Interrupted");
        }
    }

    process(items.get(i));
}
```

Checking every item may be fine for I/O-heavy tasks. For very tight CPU loops, check periodically to reduce overhead.

---

### 18.2 Pagination loop

```java
String cursor = null;
while (true) {
    token.throwIfCancelled();
    deadline.throwIfExpired();

    Page<Record> page = client.fetchPage(cursor, deadline.remaining());
    if (page.items().isEmpty()) {
        break;
    }

    writer.write(page.items());
    cursor = page.nextCursor();

    checkpoint.save(cursor);
}
```

Cancellation boundary naturally appears between pages.

---

### 18.3 Queue consumer loop

```java
while (!token.isCancelled()) {
    try {
        WorkItem item = queue.poll(500, TimeUnit.MILLISECONDS);
        if (item == null) {
            continue;
        }
        process(item, token);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        token.cancel("Interrupted while polling queue");
    }
}
```

Avoid `take()` forever unless interruption is reliably handled.

---

## 19. Error Handling Matrix

| Situation | Recommended response |
|---|---|
| User cancelled before task starts | mark cancelled, do not execute |
| User cancelled during task | cooperative stop, cleanup, audit |
| Timeout waiting for future | cancel task, return timeout, task cleans up |
| DB query timeout | rollback current transaction, classify retry/defer |
| HTTP 429 | backoff, respect retry-after, global rate limit |
| HTTP 401 token expired | refresh once, retry once/few |
| HTTP 403 | do not retry, fail authorization |
| Validation error | do not retry, mark business failure |
| Deadlock | retry transaction unit with jitter |
| Pod shutdown | stop accepting new work, cancel/stop running work safely |
| Batch poison item | skip/dead-letter based on policy |
| Batch no progress | alert/stop depending severity |
| Retry exhausted | mark failed, preserve evidence, allow operator action |

---

## 20. Cancellation, Timeout, Retry in Regulatory Workflows

Dalam regulatory case management, konsekuensi failure bukan hanya teknis.

Misalnya job melakukan escalation:

```text
1. Find cases ageing beyond threshold.
2. Evaluate eligibility.
3. Create escalation event.
4. Notify officer.
5. Update case state.
6. Write audit trail.
```

Jika timeout terjadi setelah step 3 tetapi sebelum step 4, sistem harus tahu:

- apakah escalation event sudah dibuat,
- apakah officer sudah diberi notifikasi,
- apakah case state sudah berubah,
- apakah audit trail mencerminkan partial execution,
- apakah retry akan membuat escalation kedua,
- apakah operator boleh restart,
- apakah restart dari checkpoint aman.

Desain yang lebih defensible:

```text
Transaction 1:
- select eligible cases
- create escalation command with idempotency key
- write audit: ESCALATION_REQUESTED
- commit

Async/outbox:
- process escalation command
- upsert state transition by transitionId
- send notification with idempotency key
- write audit: ESCALATION_EXECUTED or ESCALATION_FAILED
```

Jika external notification timeout:

- command tetap durable,
- idempotency key sama,
- retry tidak membuat duplicate logical notification,
- audit bisa menjelaskan status.

---

## 21. Stop vs Pause vs Cancel vs Resume

Jangan samakan semua operator action.

| Action | Meaning | Restartable? | Typical use |
|---|---|---|---|
| Cancel | work no longer desired | usually no | duplicate request, user abort |
| Stop | pause/stop safely | often yes | maintenance window, operator stop |
| Fail | mark failed | maybe manual restart | unrecoverable error |
| Pause | stop fetching new work but keep state | yes | throttling, downstream issue |
| Resume | continue from state | yes | after issue resolved |
| Abandon | do not restart | no | corrupted/obsolete execution |

Untuk batch, “stop” lebih dekat ke controlled stop. Untuk request async, “cancel” sering berarti caller tidak lagi butuh hasil. Untuk durable job, “pause/resume” sering lebih useful daripada cancel.

---

## 22. Production Patterns

### 22.1 Deadline propagation pattern

```text
Incoming request creates deadline.
Every internal call receives remaining budget.
Every external call has timeout <= remaining budget.
Every retry checks deadline before sleeping.
```

Code:

```java
public Response handle(Request request) {
    Deadline deadline = Deadline.after(Duration.ofSeconds(5));
    CancellationToken token = new CancellationToken();

    Result result = service.process(request, deadline, token);
    return Response.ok(result).build();
}
```

---

### 22.2 Cancellation token + interrupt pattern

```text
Cancel handle:
1. token.cancel(reason)
2. future.cancel(true)
3. audit cancellation requested
4. task sees token/interrupt
5. task cleans up
6. task records final status
```

---

### 22.3 Retry with idempotency pattern

```text
Before external side effect:
- create operation record with idempotency key
- execute operation with same key
- store result
On retry:
- check operation record
- resume or reconcile
```

---

### 22.4 Circuit breaker + retry pattern

Retry per caller is not enough. If downstream is down, system should stop hammering it.

```text
Failure rate high
-> circuit opens
-> new calls fail fast or route to queue
-> after cooldown, allow limited probe
-> close if healthy
```

Retry and circuit breaker must cooperate.

---

### 22.5 Durable retry pattern

For long-running or important side effects, in-memory retry is weak.

Use durable state:

```sql
CREATE TABLE job_attempt (
    job_id          VARCHAR(100),
    attempt_no      INTEGER,
    status          VARCHAR(30),
    error_code      VARCHAR(100),
    error_message   VARCHAR(1000),
    next_run_at     TIMESTAMP,
    created_at      TIMESTAMP,
    PRIMARY KEY (job_id, attempt_no)
);
```

This supports:

- process restart,
- operator visibility,
- delayed retry,
- audit,
- backoff persisted,
- no retry loss after pod crash.

---

## 23. Anti-Patterns

### 23.1 Timeout only at API gateway

```text
Gateway returns 504 after 30 seconds,
but app thread, DB query, and external calls continue running.
```

Effect:

- resource leak,
- duplicate user retry,
- hidden DB pressure,
- inconsistent side effect.

---

### 23.2 Catching `Exception` and retrying everything

```java
catch (Exception e) {
    retry();
}
```

Danger:

- retries bugs,
- retries validation errors,
- retries authorization failures,
- hides root cause,
- creates load amplification.

---

### 23.3 Swallowing `InterruptedException`

```java
catch (InterruptedException ignored) {
}
```

Danger:

- task refuses shutdown,
- executor thread reused with lost signal,
- cancellation appears successful but work continues.

---

### 23.4 Retrying non-idempotent side effects

```java
sendEmail();
// timeout
sendEmail();
```

Effect:

- duplicate email,
- duplicate notification,
- duplicate external mutation,
- audit confusion.

---

### 23.5 Infinite retry inside request thread

Interactive request should usually not perform long retry. Better:

- return accepted and process asynchronously,
- persist job request,
- expose status endpoint,
- notify when complete.

---

### 23.6 Batch commit interval too large

Large chunk:

- slow stop,
- large rollback,
- long locks,
- high memory,
- expensive retry,
- poor progress visibility.

---

### 23.7 Sleeping while holding scarce resource

Bad:

```java
Connection c = dataSource.getConnection();
try {
    callExternalApiWithRetry(); // includes sleeps
} finally {
    c.close();
}
```

During retry sleep, DB connection is wasted.

---

## 24. Testing Strategy

### 24.1 Cancellation tests

Test cases:

1. cancel before task starts,
2. cancel during CPU loop,
3. cancel during retry backoff,
4. cancel during external API call,
5. cancel during DB wait,
6. cancel during file write,
7. cancel during batch processing,
8. cancel during shutdown.

Assert:

- task stops within expected window,
- resource cleaned,
- status correct,
- audit written,
- no partial final output,
- retry not continued after cancel.

---

### 24.2 Timeout tests

Inject slow dependencies:

```java
class SlowExternalClient implements ExternalClient {
    public Response call() {
        sleep(Duration.ofSeconds(30));
        return Response.ok();
    }
}
```

Verify:

- caller receives timeout,
- future cancellation requested,
- underlying task stops or at least releases resource,
- no duplicate side effect on retry,
- metrics record timeout.

---

### 24.3 Retry tests

Test matrix:

| Scenario | Expected |
|---|---|
| transient fail then success | retry succeeds |
| validation fail | no retry |
| 429 with retry-after | waits policy-compliant delay |
| repeated timeout | retry exhausted |
| interrupted during backoff | stops immediately |
| deadline expires before next attempt | no further retry |
| duplicate idempotency key | resume/reconcile |

---

### 24.4 Batch restart tests

For chunk job:

1. process 1000 items,
2. fail at item 450,
3. verify checkpoint,
4. restart,
5. verify no duplicate writes for items 1–449,
6. verify job completes,
7. verify audit sequence.

---

## 25. Observability

### 25.1 Metrics

Track:

- task cancellation requested count,
- task cancellation completed count,
- cancellation latency,
- timeout count by dependency,
- retry attempts by operation,
- retry exhausted count,
- interruption count,
- stuck task count,
- no-progress batch duration,
- average attempts per success,
- duplicate idempotency key count,
- rejected execution count.

---

### 25.2 Logs

Cancellation log should include:

```text
correlationId
jobId/taskId
requestedBy
reason
currentPhase
processedCount
checkpoint
elapsedTime
threadName
executorName
```

Avoid vague log:

```text
Task failed
```

Use precise log:

```text
CaseAgeingJob stop requested by operator=jdoe reason=MAINTENANCE_WINDOW executionId=123 processed=84210 checkpoint=caseId:ACE-2026-84210 elapsed=PT12M33S
```

---

### 25.3 Audit

Audit should distinguish:

- cancellation requested,
- cancellation observed,
- cancellation completed,
- task stopped at checkpoint,
- task failed during cancellation,
- task restarted.

For regulatory defensibility, “job stopped” is not enough. You need evidence of what was processed and what remains pending.

---

## 26. Design Checklist

For every async/batch workload, answer:

### Cancellation

- Who can cancel/stop it?
- How is cancellation requested?
- Is cancellation reason recorded?
- How often does task check cancellation?
- What happens if task is blocked?
- What is safe stop boundary?
- Is cleanup deterministic?

### Timeout

- What is total deadline?
- What are per-dependency timeouts?
- Are DB/API/pool/lock timeouts configured?
- What happens after caller timeout?
- Does underlying work stop?
- Is timeout ambiguous for side effects?

### Retry

- Which errors are retryable?
- Which errors are not retryable?
- Who owns retry?
- Is there max attempts?
- Is there max elapsed time?
- Is jitter used?
- Is downstream `Retry-After` respected?
- Is operation idempotent?

### Interruption

- Does code handle `InterruptedException`?
- Is interrupt flag restored?
- Are blocking calls interruptible or timeout-bound?
- Does retry sleep respond to interrupt?

### Batch

- Is checkpoint state sufficient?
- Is writer idempotent?
- Can job restart after stop/failure?
- Is skip/retry policy explicit?
- Are poison records isolated?
- Is progress observable?

---

## 27. Summary

Cancellation, timeout, retry, dan interruption adalah empat konsep yang saling berhubungan tetapi tidak sama.

Ringkasan mental model:

1. **Cancellation** adalah permintaan berhenti.
2. **Timeout** adalah batas waktu.
3. **Retry** adalah keputusan mencoba ulang.
4. **Interruption** adalah sinyal thread-level.
5. **Idempotency** adalah syarat agar retry/restart aman.
6. **Checkpoint** adalah syarat agar batch bisa lanjut dari titik aman.
7. **Deadline** lebih kuat daripada timeout lokal yang tersebar.
8. **Managed executor** tidak otomatis membuat task cancellable.
9. **CompletableFuture timeout** tidak otomatis menghentikan underlying work.
10. **Transaction timeout** bukan pengganti task timeout.
11. **External side effect timeout** selalu ambiguous sampai ada idempotency/reconciliation.
12. **Retry tanpa backoff/jitter/circuit breaker** bisa memperparah outage.
13. **Swallowing InterruptedException** adalah bug lifecycle.
14. **Production-grade async work harus bisa dihentikan, diobservasi, diaudit, dan dijalankan ulang secara aman.**

---

## 28. Thought Experiments

### Exercise 1 — External API Timeout

Sebuah batch mengirim 50.000 notification ke external API. API kadang timeout setelah 2 detik. Tidak ada idempotency key.

Jawab:

1. Apakah aman retry otomatis?
2. Apa risiko duplicate?
3. Data apa yang perlu disimpan sebelum call?
4. Bagaimana desain reconciliation?
5. Apa metric yang harus dipantau?

---

### Exercise 2 — Cancel Running Import

User upload file 2 juta row. Import berjalan di `ManagedExecutorService`. Setelah 5 menit, user cancel.

Rancang:

1. cancellation token,
2. checkpoint strategy,
3. temporary table/file cleanup,
4. audit event,
5. status akhir,
6. apakah bisa resume atau harus restart dari awal.

---

### Exercise 3 — Retry Storm

Downstream registry API down 10 menit. Ada 20 pods, masing-masing menjalankan 50 async task, masing-masing retry 5 kali dengan fixed delay 1 detik.

Hitung:

1. potensi request storm,
2. kenapa fixed delay buruk,
3. bagaimana backoff+jitter membantu,
4. kapan circuit breaker harus open,
5. kapan workload harus dipindah ke durable queue/job.

---

### Exercise 4 — Batch Stop Boundary

Chunk job memakai commit interval 5000. Setiap item memakan 200ms.

Jawab:

1. Berapa estimasi durasi chunk?
2. Apa dampaknya terhadap stop latency?
3. Apa dampaknya terhadap transaction timeout?
4. Bagaimana tuning commit interval?
5. Apa trade-off antara throughput dan restart cost?

---

## 29. Closing Note

Engineer biasa bertanya:

> “Bagaimana menjalankan task asynchronous?”

Engineer senior bertanya:

> “Bagaimana task ini berhenti ketika dunia tidak ideal?”

Engineer top-tier bertanya lebih jauh:

> “Jika task berhenti di titik terburuk, state apa yang sudah berubah, siapa yang tahu, bagaimana kita membuktikannya, dan apakah eksekusi ulang aman?”

Itulah inti Part 14.

---

## 30. Status Seri

Seri **belum selesai**.

Bagian yang sudah dibuat:

- Part 0 — Orientation: Enterprise Concurrency & Batch Mental Model
- Part 1 — Historical Map: Java EE Concurrency Utilities to Jakarta Concurrency
- Part 2 — Container Integrity: Why Managed Concurrency Exists
- Part 3 — ManagedExecutorService Deep Dive
- Part 4 — ManagedScheduledExecutorService and Time-Based Workloads
- Part 5 — ManagedThreadFactory and Thread Creation Without Losing Container Semantics
- Part 6 — ContextService and Context Propagation
- Part 7 — Transactions Across Asynchronous Boundaries
- Part 8 — Security, Identity, and Authorization in Async Execution
- Part 9 — CDI, Interceptors, Events, and Async Boundaries
- Part 10 — CompletableFuture in Jakarta EE Without Breaking the Container
- Part 11 — Virtual Threads, Jakarta EE, and Managed Concurrency
- Part 12 — Structured Concurrency and Scoped Values for Enterprise Java
- Part 13 — Concurrency Control: Capacity, Backpressure, Bulkheads, and Fairness
- Part 14 — Cancellation, Timeout, Retry, and Interruption Semantics

Bagian berikutnya:

**Part 15 — Observability for Managed Async Workloads**  
File: `15-observability-for-managed-async-workloads.md`

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 13 — Concurrency Control: Capacity, Backpressure, Bulkheads, and Fairness](./13-concurrency-control-capacity-backpressure-bulkheads.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 15 — Observability for Managed Async Workloads](./15-observability-for-managed-async-workloads.md)

</div>